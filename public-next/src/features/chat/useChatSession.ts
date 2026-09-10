/**
 * Chat orchestration: the one place that mutates a chat.
 *
 * Messages live in the TanStack Query cache so every view of a chat sees the
 * same array, and this hook writes through that cache. Streaming text is kept
 * in local state and only committed to the cache when the generation settles,
 * which keeps a 60-chunks-per-second stream from re-rendering every consumer.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { greetings } from '@/api/characters';
import { saveChat, type LoadedChat } from '@/api/chats';
import { generateOnce, generateStream } from '@/api/generate';
import { queryKeys, useChat } from '@/api/queries';
import type { Character, ChatMessage } from '@/api/types';
import { formatSendDate } from '@/lib/format';
import { substituteMacros } from '@/lib/macros';
import { splitReasoning } from '@/lib/markdown';
import { streamCompletion } from '@/lib/sse';
import { useSessionStore } from '@/store/session';
import { toast } from '@/lib/toast';
import { activeMessageText, buildPrompt } from './prompt';

/** Text being streamed right now, before it becomes a real message. */
export interface StreamingState {
    text: string;
    reasoning: string;
    /** True while appending a swipe to the last message rather than adding one. */
    isSwipe: boolean;
}

export interface ChatSession {
    messages: ChatMessage[];
    isLoading: boolean;
    isGenerating: boolean;
    streaming: StreamingState | null;
    /** The prompt that would be sent right now, for the context inspector. */
    previewPrompt(): ReturnType<typeof buildPrompt>;

    send(text: string): void;
    regenerate(): void;
    swipe(delta: 1 | -1): void;
    stop(): void;
    editMessage(index: number, text: string): void;
    deleteMessage(index: number): void;
    /** Removes the message at `index` and everything after it. */
    truncateFrom(index: number): void;
    /** Replaces the chat with the character's greeting. */
    reset(greetingIndex?: number): void;
}

const SAVE_DEBOUNCE_MS = 900;

function userMessage(name: string, text: string): ChatMessage {
    return {
        name,
        is_user: true,
        is_system: false,
        send_date: formatSendDate(),
        mes: text,
        extra: {},
    };
}

function assistantMessage(name: string, text: string, reasoning: string, model: string): ChatMessage {
    const extra: ChatMessage['extra'] = { model };
    if (reasoning) {
        extra.reasoning = reasoning;
    }
    return {
        name,
        is_user: false,
        is_system: false,
        send_date: formatSendDate(),
        mes: text,
        extra,
        swipe_id: 0,
        swipes: [text],
        swipe_info: [{ send_date: formatSendDate(), extra }],
    };
}

/**
 * Batches stream updates to one render per animation frame.
 *
 * Providers emit tokens far faster than the display refreshes; without this the
 * markdown renderer runs hundreds of times per second on a growing string.
 */
function useFrameBuffer(): {
    value: StreamingState | null;
    set(next: StreamingState | null): void;
    flush(): void;
    } {
    const [value, setValue] = useState<StreamingState | null>(null);
    const pending = useRef<StreamingState | null>(null);
    const frame = useRef<number | null>(null);

    const commit = useCallback(() => {
        frame.current = null;
        setValue(pending.current);
    }, []);

    const set = useCallback(
        (next: StreamingState | null) => {
            pending.current = next;
            if (next === null) {
                if (frame.current !== null) {
                    cancelAnimationFrame(frame.current);
                    frame.current = null;
                }
                setValue(null);
                return;
            }
            if (frame.current === null) {
                frame.current = requestAnimationFrame(commit);
            }
        },
        [commit],
    );

    const flush = useCallback(() => {
        if (frame.current !== null) {
            cancelAnimationFrame(frame.current);
            frame.current = null;
        }
        setValue(pending.current);
    }, []);

    useEffect(
        () => () => {
            if (frame.current !== null) {
                cancelAnimationFrame(frame.current);
            }
        },
        [],
    );

    return { value, set, flush };
}

export function useChatSession(character: Character | null, fileName: string | null): ChatSession {
    const queryClient = useQueryClient();
    const avatar = character?.avatar ?? null;
    const chatQuery = useChat(avatar, fileName);
    const connection = useSessionStore((state) => state.connection);
    const sampling = useSessionStore((state) => state.sampling);
    const promptSettings = useSessionStore((state) => state.prompt);
    const userName = useSessionStore((state) => state.userName);
    const personaDescription = useSessionStore((state) => state.personaDescription);

    const [isGenerating, setIsGenerating] = useState(false);
    // Destructured so the setters stay referentially stable: `run` and friends
    // must not be rebuilt once per streamed frame, or every memoised message
    // bubble re-renders with them.
    const { value: streamingValue, set: setStreaming, flush: flushStreaming } = useFrameBuffer();
    const abortRef = useRef<AbortController | null>(null);
    const saveTimer = useRef<number | null>(null);

    const messages = useMemo(() => chatQuery.data?.messages ?? [], [chatQuery.data]);
    const queryKey = useMemo(() => queryKeys.chat(avatar ?? '', fileName ?? ''), [avatar, fileName]);

    /** Writes messages into the cache. */
    const writeMessages = useCallback(
        (update: (current: ChatMessage[]) => ChatMessage[]) => {
            queryClient.setQueryData<LoadedChat>(queryKey, (current) => ({
                header: current?.header ?? null,
                messages: update(current?.messages ?? []),
            }));
        },
        [queryClient, queryKey],
    );

    const { mutate: persistChat } = useMutation({
        mutationFn: (payload: ChatMessage[]) => {
            if (!character || !fileName) {
                return Promise.resolve();
            }
            return saveChat({
                avatar: character.avatar,
                characterName: character.name,
                fileName,
                messages: payload,
                metadata: chatQuery.data?.header?.chat_metadata ?? {},
            });
        },
        onError: (error: Error) => {
            toast.error('Could not save the chat', error.message);
        },
        onSuccess: () => {
            if (avatar) {
                void queryClient.invalidateQueries({ queryKey: queryKeys.characterChats(avatar) });
            }
        },
    });

    /** Debounced persist, so a burst of edits results in one write. */
    const scheduleSave = useCallback(() => {
        if (!character || !fileName) {
            return;
        }
        if (saveTimer.current !== null) {
            window.clearTimeout(saveTimer.current);
        }
        saveTimer.current = window.setTimeout(() => {
            saveTimer.current = null;
            const current = queryClient.getQueryData<LoadedChat>(queryKey)?.messages ?? [];
            persistChat(current);
        }, SAVE_DEBOUNCE_MS);
    }, [character, fileName, queryClient, queryKey, persistChat]);

    // Flush a pending save when the chat or character changes, and on unmount,
    // so switching away never drops the last few messages.
    useEffect(
        () => () => {
            if (saveTimer.current !== null) {
                window.clearTimeout(saveTimer.current);
                saveTimer.current = null;
            }
        },
        [avatar, fileName],
    );

    useEffect(() => {
        const flushOnHide = () => {
            if (saveTimer.current === null) {
                return;
            }
            window.clearTimeout(saveTimer.current);
            saveTimer.current = null;
            const current = queryClient.getQueryData<LoadedChat>(queryKey)?.messages ?? [];
            if (current.length > 0) {
                persistChat(current);
            }
        };
        window.addEventListener('pagehide', flushOnHide);
        return () => window.removeEventListener('pagehide', flushOnHide);
    }, [queryClient, queryKey, persistChat]);

    const buildFor = useCallback(
        (history: ChatMessage[]) => {
            if (!character) {
                return [];
            }
            return buildPrompt({
                character,
                messages: history,
                userName,
                personaDescription,
                settings: promptSettings,
            });
        },
        [character, userName, personaDescription, promptSettings],
    );

    /**
     * Runs one generation against `history` and commits the result.
     * @param mode `append` adds a new assistant message; `swipe` adds a swipe to
     * the last one.
     */
    const run = useCallback(
        async (history: ChatMessage[], mode: 'append' | 'swipe') => {
            if (!character) {
                return;
            }
            if (!connection.model) {
                toast.error('No model selected', 'Pick a model in Settings → Connection first.');
                return;
            }

            const controller = new AbortController();
            abortRef.current = controller;
            setIsGenerating(true);
            setStreaming({ text: '', reasoning: '', isSwipe: mode === 'swipe' });

            const request = {
                source: connection.source,
                messages: buildFor(history),
                model: connection.model,
                temperature: sampling.temperature,
                maxTokens: sampling.maxTokens,
                topP: sampling.topP,
                frequencyPenalty: sampling.frequencyPenalty,
                presencePenalty: sampling.presencePenalty,
                stream: sampling.stream,
                characterName: character.name,
                userName,
                signal: controller.signal,
                ...(connection.customUrl ? { customUrl: connection.customUrl } : {}),
            };

            let finalText = '';
            let finalReasoning = '';

            try {
                if (sampling.stream) {
                    const response = await generateStream(request);
                    for await (const chunk of streamCompletion(response, connection.source)) {
                        const split = splitReasoning(chunk.text);
                        finalText = split.content;
                        finalReasoning = chunk.reasoning || split.reasoning;
                        setStreaming({
                            text: finalText,
                            reasoning: finalReasoning,
                            isSwipe: mode === 'swipe',
                        });
                    }
                } else {
                    const raw = await generateOnce(request);
                    const split = splitReasoning(raw);
                    finalText = split.content;
                    finalReasoning = split.reasoning;
                }
            } catch (error) {
                const aborted = controller.signal.aborted;
                if (!aborted) {
                    toast.error(
                        'Generation failed',
                        error instanceof Error ? error.message : String(error),
                    );
                }
                // Whatever arrived before the failure is still worth keeping.
            } finally {
                abortRef.current = null;
                setIsGenerating(false);
                setStreaming(null);
            }

            const text = finalText.trim();
            if (!text) {
                return;
            }

            writeMessages((current) => {
                if (mode === 'swipe' && current.length > 0) {
                    const index = current.length - 1;
                    const target = current[index];
                    if (!target || target.is_user) {
                        return current;
                    }
                    const existing =
                        Array.isArray(target.swipes) && target.swipes.length > 0
                            ? target.swipes
                            : [target.mes];
                    const swipes = [...existing, text];
                    const info = [...(target.swipe_info ?? [])];
                    while (info.length < existing.length) {
                        info.push(null);
                    }
                    const extra: ChatMessage['extra'] = { ...target.extra, model: connection.model };
                    if (finalReasoning) {
                        extra.reasoning = finalReasoning;
                    } else {
                        delete extra.reasoning;
                    }
                    info.push({ send_date: formatSendDate(), extra });
                    const next = [...current];
                    next[index] = {
                        ...target,
                        mes: text,
                        extra,
                        swipes,
                        swipe_id: swipes.length - 1,
                        swipe_info: info,
                    };
                    return next;
                }
                return [
                    ...current,
                    assistantMessage(character.name, text, finalReasoning, connection.model),
                ];
            });
            scheduleSave();
        },
        [
            character,
            connection.customUrl,
            connection.model,
            connection.source,
            sampling,
            userName,
            buildFor,
            setStreaming,
            writeMessages,
            scheduleSave,
        ],
    );

    const send = useCallback(
        (text: string) => {
            const trimmed = text.trim();
            if (!trimmed || !character || isGenerating) {
                return;
            }
            const outgoing = userMessage(userName, trimmed);
            const history = [...messages, outgoing];
            writeMessages((current) => [...current, outgoing]);
            scheduleSave();
            void run(history, 'append');
        },
        [character, isGenerating, messages, run, scheduleSave, userName, writeMessages],
    );

    const regenerate = useCallback(() => {
        if (!character || isGenerating || messages.length === 0) {
            return;
        }
        const lastIndex = messages.length - 1;
        const last = messages[lastIndex];
        if (!last) {
            return;
        }
        // Drop a trailing assistant reply and ask again from the same history.
        const history = last.is_user ? messages : messages.slice(0, lastIndex);
        if (!last.is_user) {
            writeMessages((current) => current.slice(0, -1));
        }
        void run(history, 'append');
    }, [character, isGenerating, messages, run, writeMessages]);

    const swipe = useCallback(
        (delta: 1 | -1) => {
            if (!character || isGenerating || messages.length === 0) {
                return;
            }
            const index = messages.length - 1;
            const target = messages[index];
            if (!target || target.is_user) {
                return;
            }

            const swipes =
                Array.isArray(target.swipes) && target.swipes.length > 0 ? target.swipes : [target.mes];
            const current = target.swipe_id ?? 0;
            const next = current + delta;

            if (next < 0) {
                return;
            }

            if (next >= swipes.length) {
                // Past the last swipe: generate a fresh alternative.
                void run(messages.slice(0, index), 'swipe');
                return;
            }

            writeMessages((list) => {
                const copy = [...list];
                const item = copy[index];
                if (!item) {
                    return list;
                }
                const info = item.swipe_info?.[next];
                copy[index] = {
                    ...item,
                    swipe_id: next,
                    mes: swipes[next] ?? item.mes,
                    swipes,
                    ...(info?.extra ? { extra: info.extra } : {}),
                };
                return copy;
            });
            scheduleSave();
        },
        [character, isGenerating, messages, run, scheduleSave, writeMessages],
    );

    const stop = useCallback(() => {
        abortRef.current?.abort();
        flushStreaming();
    }, [flushStreaming]);

    const editMessage = useCallback(
        (index: number, text: string) => {
            writeMessages((current) => {
                const target = current[index];
                if (!target) {
                    return current;
                }
                const copy = [...current];
                const swipes = Array.isArray(target.swipes) ? [...target.swipes] : undefined;
                if (swipes) {
                    swipes[target.swipe_id ?? 0] = text;
                }
                copy[index] = { ...target, mes: text, ...(swipes ? { swipes } : {}) };
                return copy;
            });
            scheduleSave();
        },
        [scheduleSave, writeMessages],
    );

    const deleteMessage = useCallback(
        (index: number) => {
            writeMessages((current) => current.filter((_, i) => i !== index));
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

    const reset = useCallback(
        (greetingIndex = 0) => {
            if (!character) {
                return;
            }
            const available = greetings(character);
            const greeting = available[greetingIndex] ?? available[0] ?? '';
            const substituted = substituteMacros(greeting, {
                char: character.name,
                user: userName,
                persona: personaDescription,
            });
            writeMessages(() =>
                substituted
                    ? [assistantMessage(character.name, substituted, '', '')]
                    : [],
            );
            scheduleSave();
        },
        [character, personaDescription, scheduleSave, userName, writeMessages],
    );

    const previewPrompt = useCallback(() => buildFor(messages), [buildFor, messages]);

    return {
        messages,
        isLoading: chatQuery.isPending && Boolean(avatar && fileName),
        isGenerating,
        streaming: streamingValue,
        previewPrompt,
        send,
        regenerate,
        swipe,
        stop,
        editMessage,
        deleteMessage,
        truncateFrom,
        reset,
    };
}

/** Convenience re-export so views do not reach into the prompt module. */
export { activeMessageText };
