/**
 * Producing one reply.
 *
 * Extracted from `useChatSession` so a group chat can reuse it: a group turn
 * is several of these in sequence, each with a different member's card, and
 * the alternative was a second copy of the provider dispatch, the prompt
 * assembly and the abort handling.
 *
 * This module knows how to turn a character and a history into text. It knows
 * nothing about where that text is stored, which is what lets one chat write
 * it to a character's file and another to a group's.
 */

import { useCallback } from 'react';
import { generateOnce, generateStream } from '@/api/generate';
import type { Character, ChatMessage } from '@/api/types';
import { splitReasoning } from '@/lib/markdown';
import { streamCompletion } from '@/lib/sse';
import { toast } from '@/lib/toast';
import { assembleTextPrompt } from '@/features/textcompletion/assemble';
import { BACKENDS } from '@/features/textcompletion/backends';
import { runTextCompletion } from '@/features/textcompletion/run';
import { useTemplates } from '@/features/textcompletion/useTemplates';
import type { ActivationResult } from '@/features/worldinfo/engine';
import { useSessionStore } from '@/store/session';
import { buildPrompt } from './prompt';

export interface ReplyRequest {
    /** The card the model answers as. For a group, the joined card. */
    character: Character;
    /** Chat so far, oldest first. */
    history: ChatMessage[];
    /** Activated world info, if any. */
    worldInfo?: ActivationResult;
    /** Called with the running total, not the increment. */
    onProgress(text: string, reasoning: string): void;
    /** Reports a queue position, for the Horde. */
    onQueued?(position: number, waitSeconds: number): void;
    signal: AbortSignal;
}

export interface Reply {
    text: string;
    reasoning: string;
}

/** Why a generation cannot start. Null when it can. */
export type NotReady = { title: string; detail: string } | null;

export function useReplyGenerator() {
    const connection = useSessionStore((state) => state.connection);
    const sampling = useSessionStore((state) => state.sampling);
    const promptSettings = useSessionStore((state) => state.prompt);
    const textSettings = useSessionStore((state) => state.text);
    const userName = useSessionStore((state) => state.userName);
    const personaDescription = useSessionStore((state) => state.personaDescription);
    const { resolveInstruct, resolveContext } = useTemplates();

    /**
     * Whether a generation could run at all.
     *
     * Checked before a group turn starts rather than per speaker: telling the
     * user four times that no model is selected is worse than telling them
     * once and stopping.
     */
    const notReady = useCallback((): NotReady => {
        if (connection.mode === 'text') {
            const backend = BACKENDS[textSettings.backend];
            if (backend.needsUrl && !textSettings.url.trim()) {
                return {
                    title: `No ${backend.label} server`,
                    detail: 'Enter the server URL in Settings → Connection first.',
                };
            }
            return null;
        }
        if (!connection.model) {
            return {
                title: 'No model selected',
                detail: 'Pick a model in Settings → Connection first.',
            };
        }
        return null;
    }, [connection.mode, connection.model, textSettings.backend, textSettings.url]);

    const generateReply = useCallback(
        async (request: ReplyRequest): Promise<Reply> => {
            const { character, history, onProgress, signal } = request;

            if (connection.mode === 'text') {
                // Text completion flattens the chat into one string, so it
                // needs its own prompt assembly rather than the message array.
                const { prompt, stop } = assembleTextPrompt({
                    character,
                    messages: history,
                    userName,
                    personaDescription,
                    settings: promptSettings,
                    instruct: resolveInstruct(textSettings.instructName),
                    context: resolveContext(textSettings.contextName),
                    instructEnabled: textSettings.instructEnabled,
                    ...(request.worldInfo ? { worldInfo: request.worldInfo } : {}),
                    ...(textSettings.customStops.length ? { customStops: textSettings.customStops } : {}),
                });

                const result = await runTextCompletion(
                    {
                        backend: textSettings.backend,
                        prompt,
                        stop,
                        maxTokens: textSettings.maxTokens,
                        maxContext: textSettings.maxContext,
                        samplers: textSettings.samplers,
                        stream: sampling.stream,
                        url: textSettings.url,
                        ...(textSettings.model ? { model: textSettings.model } : {}),
                        ...(textSettings.hordeModels.length
                            ? { hordeModels: textSettings.hordeModels }
                            : {}),
                    },
                    {
                        onProgress: (text, reasoning) => {
                            const split = splitReasoning(text);
                            onProgress(split.content, reasoning || split.reasoning);
                        },
                        ...(request.onQueued ? { onQueued: request.onQueued } : {}),
                    },
                    signal,
                );
                const split = splitReasoning(result.text);
                return { text: split.content, reasoning: result.reasoning || split.reasoning };
            }

            const chatRequest = {
                source: connection.source,
                messages: buildPrompt({
                    character,
                    messages: history,
                    userName,
                    personaDescription,
                    settings: promptSettings,
                    ...(request.worldInfo ? { worldInfo: request.worldInfo } : {}),
                }),
                model: connection.model,
                temperature: sampling.temperature,
                maxTokens: sampling.maxTokens,
                topP: sampling.topP,
                frequencyPenalty: sampling.frequencyPenalty,
                presencePenalty: sampling.presencePenalty,
                stream: sampling.stream,
                characterName: character.name,
                userName,
                useResponsesApi: connection.useResponsesApi,
                reasoningEffort: sampling.reasoningEffort,
                includeReasoning: sampling.includeReasoning,
                signal,
                ...(connection.customUrl ? { customUrl: connection.customUrl } : {}),
            };

            if (sampling.stream) {
                const response = await generateStream(chatRequest);
                let text = '';
                let reasoning = '';
                for await (const chunk of streamCompletion(response, connection.source)) {
                    const split = splitReasoning(chunk.text);
                    text = split.content;
                    reasoning = chunk.reasoning || split.reasoning;
                    onProgress(text, reasoning);
                }
                return { text, reasoning };
            }

            const raw = await generateOnce(chatRequest);
            const split = splitReasoning(raw);
            return { text: split.content, reasoning: split.reasoning };
        },
        [
            connection.customUrl,
            connection.mode,
            connection.model,
            connection.source,
            connection.useResponsesApi,
            personaDescription,
            promptSettings,
            resolveContext,
            resolveInstruct,
            sampling,
            textSettings,
            userName,
        ],
    );

    /** Raises the not-ready reason as a toast. Returns true when ready. */
    const requireReady = useCallback((): boolean => {
        const reason = notReady();
        if (reason) {
            toast.error(reason.title, reason.detail);
            return false;
        }
        return true;
    }, [notReady]);

    return { generateReply, notReady, requireReady };
}
