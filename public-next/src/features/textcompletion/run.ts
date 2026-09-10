/**
 * Runs one text-completion generation.
 *
 * Kept apart from the chat-completion path because the two differ in more than
 * the request body: Horde does not stream at all — a request is queued and
 * polled — and Kobold and NovelAI stream their own frame shapes. What the
 * caller sees is the same either way: deltas as they arrive, then the final
 * text.
 */

import {
    cancelHordeTask,
    encodeStopSequences,
    extractTextDelta,
    extractTextError,
    fetchHordeTask,
    generateText,
    novelTokenizer,
    queueHordeTask,
    streamText,
    type TextRequest,
} from '@/api/text-completion';
import { createSseSplitter } from '@/lib/sse';
import { BACKENDS } from './backends';

export interface RunHandlers {
    /** Called with the text so far, not the increment. */
    onProgress(text: string, reasoning: string): void;
    /** Called with a queue position while a Horde request waits. */
    onQueued?(position: number, waitSeconds: number): void;
}

export interface RunResult {
    text: string;
    reasoning: string;
    /** Which worker or model produced it, when the backend says. */
    producedBy?: string;
}

/** How often a queued Horde request is polled. */
const HORDE_POLL_MS = 2500;

/** Longest a queued Horde request is waited on. */
const HORDE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Decodes one SSE frame's payload, raising an error the backend reported.
 *
 * A frame that is not JSON is skipped rather than fatal: the splitter hands
 * over whatever it has, and the rest arrives with the next chunk.
 */
function decodeFrame(backend: TextRequest['backend'], data: string) {
    let payload: unknown;
    try {
        payload = JSON.parse(data);
    } catch {
        return { text: '', reasoning: '', done: false };
    }
    const error = extractTextError(payload);
    if (error) {
        throw new Error(error);
    }
    return extractTextDelta(backend, payload);
}

/**
 * Streams a generation, decoding whichever frame shape the backend sends.
 *
 * The server forwards the upstream SSE stream unchanged for most backends, so
 * the frames arriving here are the backend's own — see `extractTextDelta`.
 */
async function runStreaming(
    request: TextRequest,
    handlers: RunHandlers,
    signal: AbortSignal,
): Promise<RunResult> {
    const response = await streamText(request, signal);
    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error('The backend returned no stream.');
    }

    const decoder = new TextDecoder();
    const splitter = createSseSplitter();
    let text = '';
    let reasoning = '';

    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) {
                // A stream that ends without a terminator may still hold a
                // buffered frame.
                for (const frame of splitter.flush()) {
                    const delta = decodeFrame(request.backend, frame.data);
                    text += delta.text;
                    reasoning += delta.reasoning;
                }
                break;
            }
            for (const frame of splitter.push(decoder.decode(value, { stream: true }))) {
                if (frame.data === '[DONE]') {
                    return { text, reasoning };
                }
                const delta = decodeFrame(request.backend, frame.data);
                // Deltas are increments; the caller wants the running total.
                text += delta.text;
                reasoning += delta.reasoning;
                handlers.onProgress(text, reasoning);
                if (delta.done) {
                    return { text, reasoning };
                }
            }
        }
    } finally {
        reader.releaseLock();
    }

    return { text, reasoning };
}

/**
 * Queues a Horde request and waits for a worker to pick it up.
 *
 * The Horde is a queue of volunteered GPUs, so there is nothing to stream:
 * this polls until a generation appears. The wait is bounded and the task is
 * cancelled on abort, so leaving the page does not leave a job running on
 * somebody else's machine.
 */
async function runHorde(
    request: TextRequest,
    handlers: RunHandlers,
    signal: AbortSignal,
): Promise<RunResult> {
    const task = await queueHordeTask(request, signal);
    const startedAt = Date.now();

    const abandon = () => {
        void cancelHordeTask(task.id).catch(() => {
            // The task may already be gone; nothing useful to do.
        });
    };
    signal.addEventListener('abort', abandon, { once: true });

    try {
        for (;;) {
            if (signal.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }
            if (Date.now() - startedAt > HORDE_TIMEOUT_MS) {
                throw new Error('The Horde did not return a generation in ten minutes.');
            }

            const status = await fetchHordeTask(task.id, signal);
            if (status.faulted) {
                throw new Error(status.message || 'The Horde reported the request as faulted.');
            }
            if (status.done) {
                const generation = status.generations?.[0];
                const text = generation?.text ?? '';
                return {
                    text,
                    reasoning: '',
                    ...(generation?.worker_name ? { producedBy: generation.worker_name } : {}),
                };
            }

            handlers.onQueued?.(status.queue_position ?? 0, status.wait_time ?? 0);
            await new Promise((resolve) => window.setTimeout(resolve, HORDE_POLL_MS));
        }
    } finally {
        signal.removeEventListener('abort', abandon);
    }
}

/** Runs a generation, streaming when the backend supports it. */
export async function runTextCompletion(
    request: TextRequest,
    handlers: RunHandlers,
    signal: AbortSignal,
): Promise<RunResult> {
    const transport = BACKENDS[request.backend].transport;

    // NovelAI takes stop sequences as token ids; strings are ignored, which is
    // why a NovelAI generation otherwise runs past where it should stop.
    let prepared = request;
    if (transport === 'novel' && request.stop.length > 0) {
        const tokenizer = novelTokenizer(request.model ?? '');
        // NovelAI accepts up to 1024, and each one costs a tokenizer call.
        const stopTokens = await encodeStopSequences(tokenizer, request.stop.slice(0, 32), signal);
        prepared = { ...request, stopTokens };
    }

    if (transport === 'horde') {
        return runHorde(prepared, handlers, signal);
    }

    if (prepared.stream) {
        return runStreaming(prepared, handlers, signal);
    }

    return { text: await generateText(prepared, signal), reasoning: '' };
}
