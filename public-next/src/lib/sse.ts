/**
 * Server-Sent Events plumbing for streamed generations.
 *
 * Split into three pure-ish pieces so each can be tested without a network:
 *  - {@link createSseSplitter} turns raw text chunks into discrete events,
 *  - {@link extractDelta} maps one provider payload onto `{ text, reasoning }`,
 *  - {@link streamCompletion} glues them to a `fetch` Response.
 */

import type { ChatCompletionSource } from '@/api/types';

export interface SseEvent {
    /** The `event:` field, or `'message'` when absent. */
    type: string;
    /** Concatenated `data:` lines with the trailing newline removed. */
    data: string;
}

/** Incremental text produced by one event. */
export interface Delta {
    text: string;
    /** Chain-of-thought tokens, when the provider streams them separately. */
    reasoning: string;
}

const EVENT_SEPARATOR = /\r\n\r\n|\n\n|\r\r/;
const LINE_SEPARATOR = /\r\n|\n|\r/;

/**
 * Creates a stateful splitter that accumulates text and emits whole events.
 *
 * SSE frames are separated by a blank line, so a chunk may end mid-frame; the
 * remainder is held until the next `push`, and released by `flush`.
 */
export function createSseSplitter(): {
    push(chunk: string): SseEvent[];
    flush(): SseEvent[];
    } {
    let buffer = '';

    function parseFrame(frame: string): SseEvent | null {
        let type = '';
        let data = '';
        let sawData = false;

        for (const line of frame.split(LINE_SEPARATOR)) {
            if (!line || line.startsWith(':')) {
                continue; // Comment or padding line.
            }
            const colon = line.indexOf(':');
            const field = colon === -1 ? line : line.slice(0, colon);
            // Per spec a single leading space after the colon is stripped.
            let value = colon === -1 ? '' : line.slice(colon + 1);
            if (value.startsWith(' ')) {
                value = value.slice(1);
            }

            if (field === 'event') {
                type = value;
            } else if (field === 'data') {
                data += sawData ? `\n${value}` : value;
                sawData = true;
            }
        }

        if (!sawData) {
            return null;
        }
        return { type: type || 'message', data };
    }

    function drain(final: boolean): SseEvent[] {
        const frames = buffer.split(EVENT_SEPARATOR);
        buffer = final ? '' : (frames.pop() ?? '');
        const events: SseEvent[] = [];
        for (const frame of frames) {
            if (!frame.trim()) {
                continue;
            }
            const event = parseFrame(frame);
            if (event) {
                events.push(event);
            }
        }
        return events;
    }

    return {
        push(chunk) {
            buffer += chunk;
            return drain(false);
        },
        flush() {
            if (!buffer.trim()) {
                buffer = '';
                return [];
            }
            return drain(true);
        },
    };
}

const EMPTY: Delta = { text: '', reasoning: '' };

function asString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function get(value: unknown, key: string): unknown {
    return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
}

/** OpenAI and every provider that mimics its `choices[].delta` envelope. */
function openAiDelta(payload: unknown): Delta {
    const choices = get(payload, 'choices');
    const choice = Array.isArray(choices) ? choices[0] : undefined;
    if (!choice) {
        return EMPTY;
    }
    const delta = get(choice, 'delta') ?? get(choice, 'message');
    const content = get(delta, 'content');
    // Some gateways send content as an array of parts rather than a string.
    const text = Array.isArray(content)
        ? content.map((part) => asString(get(part, 'text'))).join('')
        : asString(content) || asString(get(choice, 'text'));
    const reasoning =
        asString(get(delta, 'reasoning')) ||
        asString(get(delta, 'reasoning_content')) ||
        asString(get(get(delta, 'reasoning_details'), 'text'));
    return { text, reasoning };
}

/** Anthropic streams typed block deltas. */
function claudeDelta(payload: unknown): Delta {
    const delta = get(payload, 'delta');
    const kind = asString(get(delta, 'type'));
    if (kind === 'text_delta') {
        return { text: asString(get(delta, 'text')), reasoning: '' };
    }
    if (kind === 'thinking_delta') {
        return { text: '', reasoning: asString(get(delta, 'thinking')) };
    }
    // `content_block_start` may already carry the first token.
    const block = get(payload, 'content_block');
    if (block) {
        return { text: asString(get(block, 'text')), reasoning: '' };
    }
    return EMPTY;
}

/** Google AI Studio / Vertex candidates. */
function googleDelta(payload: unknown): Delta {
    const candidates = get(payload, 'candidates');
    const candidate = Array.isArray(candidates) ? candidates[0] : undefined;
    const parts = get(get(candidate, 'content'), 'parts');
    if (!Array.isArray(parts)) {
        return EMPTY;
    }
    let text = '';
    let reasoning = '';
    for (const part of parts) {
        const value = asString(get(part, 'text'));
        if (get(part, 'thought') === true) {
            reasoning += value;
        } else {
            text += value;
        }
    }
    return { text, reasoning };
}

/**
 * OpenAI Responses API events.
 *
 * A different endpoint from Chat Completions with its own event vocabulary:
 * semantic events named `response.*`, each carrying its increment in `delta`.
 * Only the `.delta` events are consumed — the matching `.done` events repeat
 * the whole value and would double the text.
 */
function responsesDelta(payload: unknown, eventType: string): Delta {
    const type = asString(get(payload, 'type')) || eventType;
    switch (type) {
        case 'response.output_text.delta':
        case 'response.refusal.delta':
            return { text: asString(get(payload, 'delta')), reasoning: '' };
        case 'response.reasoning_summary_text.delta':
        case 'response.reasoning_text.delta':
            return { text: '', reasoning: asString(get(payload, 'delta')) };
        default:
            return EMPTY;
    }
}

/** True for a payload or event name from the Responses API. */
export function isResponsesEvent(payload: unknown, eventType: string): boolean {
    const type = asString(get(payload, 'type')) || eventType;
    return type.startsWith('response.') || type === 'response';
}

/** Cohere's chat stream. */
function cohereDelta(payload: unknown): Delta {
    const eventType = asString(get(payload, 'event_type'));
    if (eventType && eventType !== 'text-generation') {
        return EMPTY;
    }
    return { text: asString(get(payload, 'text')), reasoning: '' };
}

/**
 * Normalises one parsed SSE payload into an incremental delta.
 *
 * Responses API events are recognised by their own event names before the
 * provider is consulted, so an OpenAI-compatible endpoint that implements that
 * API works without extra configuration. Unknown shapes yield empty strings
 * rather than throwing, so a provider we do not model yet degrades to "no
 * visible tokens" instead of a broken stream.
 *
 * @param eventType The SSE `event:` field, used when the payload omits `type`.
 */
export function extractDelta(
    source: ChatCompletionSource,
    payload: unknown,
    eventType = '',
): Delta {
    if (isResponsesEvent(payload, eventType)) {
        return responsesDelta(payload, eventType);
    }

    switch (source) {
        case 'claude':
            return claudeDelta(payload);
        case 'makersuite':
            return googleDelta(payload);
        case 'cohere':
            return cohereDelta(payload);
        default:
            return openAiDelta(payload);
    }
}

/**
 * Extracts a fatal error message from a stream payload, if it carries one.
 *
 * Three shapes appear in practice: an `{ error: … }` wrapper (Chat
 * Completions), a bare Responses `error` event, and a `response.failed` event
 * whose error hangs off the response object.
 * @returns The message, or null when the payload is not an error.
 */
export function extractStreamError(payload: unknown, eventType: string): string | null {
    const type = asString(get(payload, 'type')) || eventType;

    if (type === 'error') {
        return asString(get(payload, 'message')) || 'The provider reported an error.';
    }

    if (type === 'response.failed' || type === 'response.incomplete') {
        const inner = get(get(payload, 'response'), 'error') ?? get(get(payload, 'response'), 'incomplete_details');
        const message = asString(get(inner, 'message')) || asString(get(inner, 'reason'));
        return message || 'The provider did not finish the response.';
    }

    const error = get(payload, 'error');
    if (error) {
        return asString(get(error, 'message')) || JSON.stringify(error);
    }

    return null;
}

/** Reason a stream stopped, surfaced to the UI. */
export type StreamEnd = 'complete' | 'aborted';

export interface StreamChunk {
    /** Text accumulated so far, ready to render. */
    text: string;
    /** Reasoning accumulated so far. */
    reasoning: string;
    /** Just-arrived text, for callers that append rather than replace. */
    deltaText: string;
}

/**
 * Consumes a streaming generation response and yields cumulative snapshots.
 *
 * Errors embedded in the stream (some providers send `{ error: … }` mid-flight)
 * are thrown so the caller can surface them like any other failure.
 */
export async function* streamCompletion(
    response: Response,
    source: ChatCompletionSource,
): AsyncGenerator<StreamChunk, StreamEnd> {
    const body = response.body;
    if (!body) {
        throw new Error('The generation response had no body to stream.');
    }

    const reader = body.pipeThrough(new TextDecoderStream()).getReader();
    const splitter = createSseSplitter();
    let text = '';
    let reasoning = '';

    const handle = (events: SseEvent[]): StreamChunk | null => {
        let deltaText = '';
        let changed = false;
        for (const event of events) {
            if (event.data === '[DONE]' || event.type === 'message_stop') {
                continue;
            }
            let payload: unknown;
            try {
                payload = JSON.parse(event.data);
            } catch {
                continue; // Keep-alive noise or a partial frame we cannot use.
            }

            const error = extractStreamError(payload, event.type);
            if (error) {
                throw new Error(error);
            }

            const delta = extractDelta(source, payload, event.type);
            if (delta.text) {
                text += delta.text;
                deltaText += delta.text;
                changed = true;
            }
            if (delta.reasoning) {
                reasoning += delta.reasoning;
                changed = true;
            }
        }
        return changed ? { text, reasoning, deltaText } : null;
    };

    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            const chunk = handle(splitter.push(value));
            if (chunk) {
                yield chunk;
            }
        }
        const tail = handle(splitter.flush());
        if (tail) {
            yield tail;
        }
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            return 'aborted';
        }
        throw error;
    } finally {
        reader.releaseLock();
    }

    return 'complete';
}
