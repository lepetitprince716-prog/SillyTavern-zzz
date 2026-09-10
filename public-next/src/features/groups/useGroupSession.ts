/**
 * Group chat orchestration.
 *
 * A group turn is several replies, one per speaker the engine picked, each
 * generated with that member's card. The generation itself is
 * `features/chat/generate-turn.ts`, shared with single-character chats; what
 * lives here is the turn loop, the group's own chat file, and the trace.
 *
 * Two things the classic implementation does not do:
 *
 * - **The turn is explained.** `planTurn` returns a decision for every member,
 *   and it is kept so the trace can say why the character who answered did and
 *   the others did not.
 * - **A turn is abortable mid-way.** The classic loop generates for each
 *   activated member in sequence; stopping it leaves whatever already arrived.
 *   That is right, but here the remaining speakers are dropped rather than
 *   generated after the user has asked to stop.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { avatarUrl } from '@/api/characters';
import {
    fetchGroupChat,
    groupGenerationMode,
    groupStrategy,
    saveGroupChat,
    type Group,
    type LoadedGroupChat,
} from '@/api/groups';
import type { Character, ChatMessage } from '@/api/types';
import { formatSendDate } from '@/lib/format';
import { substituteMacros } from '@/lib/macros';
import { toast } from '@/lib/toast';
import { useReplyGenerator } from '@/features/chat/generate-turn';
import type { StreamingState } from '@/features/chat/useChatSession';
import { useSessionStore } from '@/store/session';
import { groupCharacterFor, membersForPrompt } from './cards';
import { planTurn, type MemberDecision, type TurnPlan } from './engine';

const SAVE_DEBOUNCE_MS = 900;

export interface GroupSession {
    messages: ChatMessage[];
    isLoading: boolean;
    isGenerating: boolean;
    streaming: StreamingState | null;
    /** Who is replying right now, when a turn is running. */
    speakingNow: string | null;
    /** The last turn's decisions, for the trace. */
    lastTurn: TurnPlan | null;
    /** Members resolved to cards, in the group's order. */
    members: Character[];

    send(text: string): void;
    /** Runs a turn with nobody speaking first — the group replies to itself. */
    advance(): void;
    /** Makes one member reply, whatever the strategy says. */
    askMember(avatar: string): void;
    regenerate(): void;
    stop(): void;
    editMessage(index: number, text: string): void;
    deleteMessage(index: number): void;
    truncateFrom(index: number): void;
    reset(): void;
}

/**
 * Waits, or resolves early when the turn is stopped.
 *
 * A bare `setTimeout` would keep a stopped turn hanging for the rest of the
 * pause before noticing, so the stop button would appear not to work.
 */
function pause(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal.aborted) {
            resolve();
            return;
        }
        const done = () => {
            window.clearTimeout(timer);
            signal.removeEventListener('abort', done);
            resolve();
        };
        // `done` reads `timer` below, and can only run once both exist: the
        // already-aborted case returned above.
        const timer = window.setTimeout(done, ms);
        signal.addEventListener('abort', done, { once: true });
    });
}

function userMessage(name: string, text: string): ChatMessage {
    return { name, is_user: true, send_date: formatSendDate(), mes: text, extra: {} };
}

/**
 * Builds a reply message for a group member.
 *
 * `original_avatar` is what identifies the speaker — `name` can be shared or
 * renamed — and it is the field the classic UI's own group logic keys on, so
 * writing it is what makes the chat readable in both interfaces.
 */
function memberMessage(character: Character, text: string, reasoning: string, model: string): ChatMessage {
    return {
        name: character.name,
        is_user: false,
        send_date: formatSendDate(),
        mes: text,
        original_avatar: character.avatar,
        force_avatar: avatarUrl(character.avatar),
        extra: {
            ...(reasoning ? { reasoning } : {}),
            ...(model ? { model } : {}),
            gen_id: Date.now(),
        },
    };
}

export function useGroupSession(group: Group | null, characters: Character[]): GroupSession {
    const queryClient = useQueryClient();
    const connection = useSessionStore((state) => state.connection);
    const userName = useSessionStore((state) => state.userName);
    const { generateReply, requireReady } = useReplyGenerator();

    const [isGenerating, setIsGenerating] = useState(false);
    const [streaming, setStreaming] = useState<StreamingState | null>(null);
    const [speakingNow, setSpeakingNow] = useState<string | null>(null);
    const [lastTurn, setLastTurn] = useState<TurnPlan | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const saveTimer = useRef<number | null>(null);

    const chatId = group?.chat_id ?? '';
    const queryKey = useMemo(() => ['group-chat', chatId] as const, [chatId]);

    const chatQuery = useQuery({
        queryKey,
        queryFn: () => fetchGroupChat(chatId),
        enabled: Boolean(chatId),
        staleTime: Infinity,
    });

    // Memoised so the fresh `[]` on a pending query does not make every
    // callback below unstable.
    const messages = useMemo(() => chatQuery.data?.messages ?? [], [chatQuery.data]);

    /** Members resolved to cards, skipping any that were deleted. */
    const members = useMemo(() => {
        if (!group) {
            return [];
        }
        return group.members
            .map((avatar) => characters.find((character) => character.avatar === avatar))
            .filter((character): character is Character => Boolean(character));
    }, [group, characters]);

    const writeMessages = useCallback(
        (update: (current: ChatMessage[]) => ChatMessage[]) => {
            queryClient.setQueryData<LoadedGroupChat>(queryKey, (current) => ({
                header: current?.header ?? null,
                messages: update(current?.messages ?? []),
            }));
        },
        [queryClient, queryKey],
    );

    const { mutate: persistChat } = useMutation({
        mutationFn: (payload: ChatMessage[]) => {
            if (!chatId) {
                return Promise.resolve({ ok: true });
            }
            return saveGroupChat({
                chatId,
                messages: payload,
                ...(chatQuery.data?.header?.chat_metadata
                    ? { metadata: chatQuery.data.header.chat_metadata }
                    : {}),
            });
        },
        onError: (error: Error) => toast.error('Could not save the group chat', error.message),
    });

    const scheduleSave = useCallback(() => {
        if (!chatId) {
            return;
        }
        if (saveTimer.current !== null) {
            window.clearTimeout(saveTimer.current);
        }
        saveTimer.current = window.setTimeout(() => {
            saveTimer.current = null;
            const current = queryClient.getQueryData<LoadedGroupChat>(queryKey)?.messages ?? [];
            persistChat(current);
        }, SAVE_DEBOUNCE_MS);
    }, [chatId, persistChat, queryClient, queryKey]);

    // Flush a pending save when the tab goes away, so the last reply of a turn
    // is not lost to the debounce.
    useEffect(() => {
        const flush = () => {
            if (saveTimer.current === null) {
                return;
            }
            window.clearTimeout(saveTimer.current);
            saveTimer.current = null;
            const current = queryClient.getQueryData<LoadedGroupChat>(queryKey)?.messages ?? [];
            if (current.length > 0) {
                persistChat(current);
            }
        };
        window.addEventListener('pagehide', flush);
        return () => window.removeEventListener('pagehide', flush);
    }, [persistChat, queryClient, queryKey]);

    /**
     * Runs one turn: plan it, then generate for each speaker in order.
     *
     * Each speaker sees the replies before theirs, which is what lets a group
     * hold a conversation rather than produce parallel monologues.
     */
    const runTurn = useCallback(
        async (options: { history: ChatMessage[]; input?: string; forceMember?: string }) => {
            if (!group || members.length === 0 || !requireReady()) {
                return;
            }

            const plan = planTurn({
                members,
                disabled: group.disabled_members ?? [],
                strategy: groupStrategy(group),
                messages: options.history,
                allowSelfResponses: Boolean(group.allow_self_responses),
                ...(options.input ? { input: options.input } : {}),
                ...(options.forceMember ? { forceMember: options.forceMember } : {}),
            });
            setLastTurn(plan);

            if (plan.speakers.length === 0) {
                // Not an error: manual mode means nobody replies until asked.
                if (groupStrategy(group) === 'manual') {
                    toast.info('Nobody replied', 'This group only replies when you pick someone.');
                }
                return;
            }

            const controller = new AbortController();
            abortRef.current = controller;
            setIsGenerating(true);

            const mode = groupGenerationMode(group);
            // `auto_mode_delay` paces the replies the group makes on its own.
            // A turn the user started is not paced: they are waiting for it.
            const paceMs = options.input || options.forceMember
                ? 0
                : Math.max(0, Number(group.auto_mode_delay ?? 0)) * 1000;
            // The history grows as the turn runs, so a later speaker can
            // answer an earlier one.
            let history = options.history;

            try {
                for (const [position, speaker] of plan.speakers.entries()) {
                    if (controller.signal.aborted) {
                        break;
                    }
                    const character = members.find((member) => member.avatar === speaker.avatar);
                    if (!character) {
                        continue;
                    }

                    // Named before the pause, so the wait reads as the next
                    // member taking their turn rather than as a stall.
                    setSpeakingNow(character.name);
                    if (paceMs > 0 && position > 0) {
                        await pause(paceMs, controller.signal);
                        if (controller.signal.aborted) {
                            break;
                        }
                    }
                    setStreaming({ text: '', reasoning: '', isSwipe: false });

                    const promptCharacter = groupCharacterFor(
                        character,
                        membersForPrompt({
                            mode,
                            members,
                            disabled: group.disabled_members ?? [],
                            speaker: character,
                        }),
                        {
                            ...(group.generation_mode_join_prefix
                                ? { prefix: group.generation_mode_join_prefix }
                                : {}),
                            ...(group.generation_mode_join_suffix
                                ? { suffix: group.generation_mode_join_suffix }
                                : {}),
                        },
                    );

                    const reply = await generateReply({
                        character: promptCharacter,
                        history,
                        onProgress: (text, reasoning) =>
                            setStreaming({ text, reasoning, isSwipe: false }),
                        signal: controller.signal,
                    });

                    const text = reply.text.trim();
                    if (!text) {
                        continue;
                    }
                    const message = memberMessage(character, text, reply.reasoning, connection.model);
                    history = [...history, message];
                    writeMessages((current) => [...current, message]);
                    scheduleSave();
                }
            } catch (error) {
                if (!controller.signal.aborted) {
                    toast.error(
                        'The group turn failed',
                        error instanceof Error ? error.message : String(error),
                    );
                }
            } finally {
                abortRef.current = null;
                setIsGenerating(false);
                setStreaming(null);
                setSpeakingNow(null);
            }
        },
        [
            connection.model,
            generateReply,
            group,
            members,
            requireReady,
            scheduleSave,
            writeMessages,
        ],
    );

    const send = useCallback(
        (text: string) => {
            const trimmed = text.trim();
            if (!trimmed || isGenerating) {
                return;
            }
            const outgoing = userMessage(userName, trimmed);
            const history = [...messages, outgoing];
            writeMessages((current) => [...current, outgoing]);
            scheduleSave();
            void runTurn({ history, input: trimmed });
        },
        [isGenerating, messages, runTurn, scheduleSave, userName, writeMessages],
    );

    const advance = useCallback(() => {
        if (isGenerating) {
            return;
        }
        void runTurn({ history: messages });
    }, [isGenerating, messages, runTurn]);

    const askMember = useCallback(
        (avatar: string) => {
            if (isGenerating) {
                return;
            }
            void runTurn({ history: messages, forceMember: avatar });
        },
        [isGenerating, messages, runTurn],
    );

    const regenerate = useCallback(() => {
        if (isGenerating || messages.length === 0) {
            return;
        }
        const last = messages.at(-1);
        if (!last || last.is_user) {
            return;
        }
        // Drop the reply and ask the same member again, rather than replanning
        // the turn: "regenerate" means this reply, not a different speaker.
        const history = messages.slice(0, -1);
        writeMessages(() => history);
        scheduleSave();
        void runTurn({
            history,
            ...(last.original_avatar ? { forceMember: last.original_avatar } : {}),
        });
    }, [isGenerating, messages, runTurn, scheduleSave, writeMessages]);

    const stop = useCallback(() => {
        abortRef.current?.abort();
    }, []);

    const editMessage = useCallback(
        (index: number, text: string) => {
            writeMessages((current) => {
                const target = current[index];
                if (!target) {
                    return current;
                }
                const copy = [...current];
                copy[index] = { ...target, mes: text };
                return copy;
            });
            scheduleSave();
        },
        [scheduleSave, writeMessages],
    );

    const deleteMessage = useCallback(
        (index: number) => {
            writeMessages((current) => current.filter((_, position) => position !== index));
            scheduleSave();
        },
        [scheduleSave, writeMessages],
    );

    const truncateFrom = useCallback(
        (index: number) => {
            writeMessages((current) => current.slice(0, index));
            scheduleSave();
        },
        [scheduleSave, writeMessages],
    );

    /**
     * Starts the chat over, with each member's greeting.
     *
     * A group has no single greeting, so every member who has one introduces
     * themselves — which is also how the reader learns who is in the room.
     */
    const reset = useCallback(() => {
        const greetings = members
            .map((member) => {
                const first = (member.data?.first_mes ?? member.first_mes ?? '').trim();
                if (!first) {
                    return null;
                }
                const text = substituteMacros(first, { char: member.name, user: userName });
                return memberMessage(member, text, '', '');
            })
            .filter((message): message is ChatMessage => Boolean(message));

        writeMessages(() => greetings);
        setLastTurn(null);
        scheduleSave();
    }, [members, scheduleSave, userName, writeMessages]);

    return {
        messages,
        isLoading: chatQuery.isPending && Boolean(chatId),
        isGenerating,
        streaming,
        speakingNow,
        lastTurn,
        members,
        send,
        advance,
        askMember,
        regenerate,
        stop,
        editMessage,
        deleteMessage,
        truncateFrom,
        reset,
    };
}

/** Re-export so the trace panel does not reach into the engine. */
export type { MemberDecision };
