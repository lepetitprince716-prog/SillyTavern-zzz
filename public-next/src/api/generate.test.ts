import { describe, expect, it } from 'vitest';
import { extractCompletion, RESPONSES_API_SOURCES } from './generate';

describe('RESPONSES_API_SOURCES', () => {
    it('covers openai and custom only', () => {
        expect([...RESPONSES_API_SOURCES].sort()).toEqual(['custom', 'openai']);
    });
});

describe('extractCompletion', () => {
    it('reads a Chat Completions message', () => {
        expect(extractCompletion({ choices: [{ message: { content: 'hi' } }] })).toBe('hi');
    });

    it('reads array-shaped Chat Completions content', () => {
        expect(
            extractCompletion({ choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }] } }] }),
        ).toBe('ab');
    });

    it('reads a legacy text completion choice', () => {
        expect(extractCompletion({ choices: [{ text: 'plain' }] })).toBe('plain');
    });

    it('reads an Anthropic content array and skips thinking blocks', () => {
        expect(
            extractCompletion({
                content: [
                    { type: 'thinking', thinking: 'hidden' },
                    { type: 'text', text: 'visible' },
                ],
            }),
        ).toBe('visible');
    });

    it('reads Google candidates', () => {
        expect(
            extractCompletion({ candidates: [{ content: { parts: [{ text: 'gem' }] } }] }),
        ).toBe('gem');
    });

    it('walks a Responses API output list', () => {
        const payload = {
            object: 'response',
            status: 'completed',
            output: [
                { type: 'reasoning', summary: [{ type: 'summary_text', text: 'thought' }] },
                {
                    type: 'message',
                    role: 'assistant',
                    content: [
                        { type: 'output_text', text: 'Hello ' },
                        { type: 'output_text', text: 'there.' },
                    ],
                },
            ],
        };
        expect(extractCompletion(payload)).toBe('Hello there.');
    });

    it('does not leak reasoning items into the Responses answer', () => {
        const payload = {
            object: 'response',
            output: [{ type: 'reasoning', summary: [{ type: 'summary_text', text: 'thought' }] }],
        };
        expect(extractCompletion(payload)).toBe('');
    });

    it('falls back to the Responses output_text convenience field', () => {
        expect(extractCompletion({ object: 'response', output: [], output_text: 'short' })).toBe('short');
    });

    it('returns an empty string for a shape it does not know', () => {
        expect(extractCompletion({ mystery: true })).toBe('');
        expect(extractCompletion(null)).toBe('');
    });
});
