import { describe, expect, it } from 'vitest';
import { createSseSplitter, extractDelta, extractStreamError, isResponsesEvent, streamCompletion } from './sse';

function textStream(chunks: string[]): Response {
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const encoder = new TextEncoder();
            for (const chunk of chunks) {
                controller.enqueue(encoder.encode(chunk));
            }
            controller.close();
        },
    });
    return new Response(stream);
}

describe('createSseSplitter', () => {
    it('emits one event per frame', () => {
        const splitter = createSseSplitter();
        expect(splitter.push('data: a\n\ndata: b\n\n')).toEqual([
            { type: 'message', data: 'a' },
            { type: 'message', data: 'b' },
        ]);
    });

    it('holds a partial frame until the rest arrives', () => {
        const splitter = createSseSplitter();
        expect(splitter.push('data: hel')).toEqual([]);
        expect(splitter.push('lo\n\n')).toEqual([{ type: 'message', data: 'hello' }]);
    });

    it('keeps the event name and joins multi-line data', () => {
        const splitter = createSseSplitter();
        expect(splitter.push('event: content_block_delta\ndata: one\ndata: two\n\n')).toEqual([
            { type: 'content_block_delta', data: 'one\ntwo' },
        ]);
    });

    it('ignores comments and keep-alive padding', () => {
        const splitter = createSseSplitter();
        expect(splitter.push(': ping\n\ndata: real\n\n')).toEqual([{ type: 'message', data: 'real' }]);
    });

    it('handles CRLF frame separators', () => {
        const splitter = createSseSplitter();
        expect(splitter.push('data: a\r\n\r\n')).toEqual([{ type: 'message', data: 'a' }]);
    });

    it('releases a trailing frame that never got its blank line', () => {
        const splitter = createSseSplitter();
        splitter.push('data: tail');
        expect(splitter.flush()).toEqual([{ type: 'message', data: 'tail' }]);
        expect(splitter.flush()).toEqual([]);
    });

    it('strips only one leading space after the colon', () => {
        const splitter = createSseSplitter();
        expect(splitter.push('data:  two spaces\n\n')).toEqual([
            { type: 'message', data: ' two spaces' },
        ]);
    });
});

describe('extractDelta', () => {
    it('reads OpenAI-style choice deltas', () => {
        const delta = extractDelta('openai', { choices: [{ delta: { content: 'Hi' } }] });
        expect(delta).toEqual({ text: 'Hi', reasoning: '' });
    });

    it('reads OpenRouter reasoning tokens', () => {
        const delta = extractDelta('openrouter', {
            choices: [{ delta: { content: '', reasoning: 'thinking…' } }],
        });
        expect(delta.reasoning).toBe('thinking…');
    });

    it('reads array-shaped content parts', () => {
        const delta = extractDelta('custom', {
            choices: [{ delta: { content: [{ text: 'a' }, { text: 'b' }] } }],
        });
        expect(delta.text).toBe('ab');
    });

    it('reads Anthropic text and thinking deltas', () => {
        expect(extractDelta('claude', { delta: { type: 'text_delta', text: 'x' } }).text).toBe('x');
        expect(
            extractDelta('claude', { delta: { type: 'thinking_delta', thinking: 'y' } }).reasoning,
        ).toBe('y');
    });

    it('separates Google thought parts from visible text', () => {
        const delta = extractDelta('makersuite', {
            candidates: [{ content: { parts: [{ text: 'why', thought: true }, { text: 'answer' }] } }],
        });
        expect(delta).toEqual({ text: 'answer', reasoning: 'why' });
    });

    it('only takes Cohere text-generation events', () => {
        expect(extractDelta('cohere', { event_type: 'text-generation', text: 'a' }).text).toBe('a');
        expect(extractDelta('cohere', { event_type: 'stream-start', text: 'a' }).text).toBe('');
    });

    it('returns empty strings for shapes it does not know', () => {
        expect(extractDelta('openai', { unexpected: true })).toEqual({ text: '', reasoning: '' });
        expect(extractDelta('openai', null)).toEqual({ text: '', reasoning: '' });
    });
});

describe('streamCompletion', () => {
    it('yields a cumulative snapshot per chunk', async () => {
        const response = textStream([
            'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
            'data: [DONE]\n\n',
        ]);
        const seen: string[] = [];
        for await (const chunk of streamCompletion(response, 'openai')) {
            seen.push(chunk.text);
        }
        expect(seen).toEqual(['Hel', 'Hello']);
    });

    it('reports the just-arrived text separately from the total', async () => {
        const response = textStream([
            'data: {"choices":[{"delta":{"content":"ab"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"cd"}}]}\n\n',
        ]);
        const deltas: string[] = [];
        for await (const chunk of streamCompletion(response, 'openai')) {
            deltas.push(chunk.deltaText);
        }
        expect(deltas).toEqual(['ab', 'cd']);
    });

    it('survives a frame split across network chunks', async () => {
        const response = textStream(['data: {"choices":[{"delta":{"con', 'tent":"split"}}]}\n\n']);
        const seen: string[] = [];
        for await (const chunk of streamCompletion(response, 'openai')) {
            seen.push(chunk.text);
        }
        expect(seen).toEqual(['split']);
    });

    it('throws when the provider reports an error mid-stream', async () => {
        const response = textStream(['data: {"error":{"message":"rate limited"}}\n\n']);
        await expect(async () => {
            for await (const _chunk of streamCompletion(response, 'openai')) {
                // consume
            }
        }).rejects.toThrow('rate limited');
    });

    it('ignores non-JSON keep-alive frames', async () => {
        const response = textStream(['data: OPENROUTER PROCESSING\n\n', 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n']);
        const seen: string[] = [];
        for await (const chunk of streamCompletion(response, 'openai')) {
            seen.push(chunk.text);
        }
        expect(seen).toEqual(['ok']);
    });

    it('accumulates reasoning alongside the visible text', async () => {
        const response = textStream([
            'event: content_block_delta\ndata: {"delta":{"type":"thinking_delta","thinking":"hm"}}\n\n',
            'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"done"}}\n\n',
        ]);
        let last = { text: '', reasoning: '' };
        for await (const chunk of streamCompletion(response, 'claude')) {
            last = chunk;
        }
        expect(last.reasoning).toBe('hm');
        expect(last.text).toBe('done');
    });
});

describe('Responses API events', () => {
    it('recognises an event by its payload type', () => {
        expect(isResponsesEvent({ type: 'response.output_text.delta' }, '')).toBe(true);
        expect(isResponsesEvent({}, 'response.completed')).toBe(true);
        expect(isResponsesEvent({ choices: [] }, 'message')).toBe(false);
    });

    it('reads output text deltas', () => {
        const delta = extractDelta('openai', { type: 'response.output_text.delta', delta: 'Hi' });
        expect(delta).toEqual({ text: 'Hi', reasoning: '' });
    });

    it('falls back to the SSE event name when the payload omits type', () => {
        const delta = extractDelta('openai', { delta: 'Hi' }, 'response.output_text.delta');
        expect(delta.text).toBe('Hi');
    });

    it('reads reasoning summary deltas as reasoning', () => {
        const delta = extractDelta('openai', {
            type: 'response.reasoning_summary_text.delta',
            delta: 'weighing options',
        });
        expect(delta).toEqual({ text: '', reasoning: 'weighing options' });
    });

    it('reads raw reasoning text deltas as reasoning', () => {
        const delta = extractDelta('openai', { type: 'response.reasoning_text.delta', delta: 'hm' });
        expect(delta.reasoning).toBe('hm');
    });

    it('surfaces a refusal as visible text', () => {
        const delta = extractDelta('openai', { type: 'response.refusal.delta', delta: 'I cannot' });
        expect(delta.text).toBe('I cannot');
    });

    it('ignores the done events so text is not duplicated', () => {
        expect(extractDelta('openai', { type: 'response.output_text.done', text: 'Hello' })).toEqual({
            text: '',
            reasoning: '',
        });
        expect(extractDelta('openai', { type: 'response.completed', response: {} })).toEqual({
            text: '',
            reasoning: '',
        });
    });

    it('is used for a custom source too, since the endpoint may implement it', () => {
        const delta = extractDelta('custom', { type: 'response.output_text.delta', delta: 'x' });
        expect(delta.text).toBe('x');
    });

    it('streams a full Responses sequence into cumulative text', async () => {
        const frames = [
            'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_1"}}\n\n',
            'event: response.output_item.added\ndata: {"type":"response.output_item.added"}\n\n',
            'event: response.reasoning_summary_text.delta\ndata: {"type":"response.reasoning_summary_text.delta","delta":"think"}\n\n',
            'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hel"}\n\n',
            'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"lo"}\n\n',
            'event: response.output_text.done\ndata: {"type":"response.output_text.done","text":"Hello"}\n\n',
            'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n',
        ];
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                const encoder = new TextEncoder();
                for (const frame of frames) {
                    controller.enqueue(encoder.encode(frame));
                }
                controller.close();
            },
        });

        let last = { text: '', reasoning: '' };
        for await (const chunk of streamCompletion(new Response(stream), 'openai')) {
            last = chunk;
        }
        expect(last.text).toBe('Hello');
        expect(last.reasoning).toBe('think');
    });

    it('throws on a bare Responses error event', async () => {
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(
                    new TextEncoder().encode('event: error\ndata: {"type":"error","code":"server_error","message":"boom"}\n\n'),
                );
                controller.close();
            },
        });
        await expect(async () => {
            for await (const _chunk of streamCompletion(new Response(stream), 'openai')) {
                // consume
            }
        }).rejects.toThrow('boom');
    });
});

describe('extractStreamError', () => {
    it('reads a Chat Completions error wrapper', () => {
        expect(extractStreamError({ error: { message: 'rate limited' } }, 'message')).toBe('rate limited');
    });

    it('reads a bare Responses error event', () => {
        expect(extractStreamError({ type: 'error', message: 'boom' }, 'error')).toBe('boom');
    });

    it('reads response.failed', () => {
        expect(
            extractStreamError({ type: 'response.failed', response: { error: { message: 'refused' } } }, ''),
        ).toBe('refused');
    });

    it('reads response.incomplete reasons', () => {
        expect(
            extractStreamError(
                { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } },
                '',
            ),
        ).toBe('max_output_tokens');
    });

    it('returns null for an ordinary delta', () => {
        expect(extractStreamError({ type: 'response.output_text.delta', delta: 'x' }, '')).toBeNull();
        expect(extractStreamError({ choices: [{ delta: { content: 'x' } }] }, 'message')).toBeNull();
    });
});
