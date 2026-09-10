// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { markQuotedSpeech, renderMessage, splitReasoning } from './markdown';

describe('markQuotedSpeech', () => {
    it('wraps quoted speech', () => {
        expect(markQuotedSpeech('She said "hello" softly.')).toBe(
            'She said <span class="quoted">"hello"</span> softly.',
        );
    });

    it('leaves fenced code alone', () => {
        const input = '```\nconst a = "b";\n```';
        expect(markQuotedSpeech(input)).toBe(input);
    });

    it('leaves inline code alone', () => {
        expect(markQuotedSpeech('use `x = "y"` here')).toBe('use `x = "y"` here');
    });

    it('does not span across lines', () => {
        expect(markQuotedSpeech('a "b\nc" d')).toBe('a "b\nc" d');
    });

    it('leaves quoted HTML attributes intact', () => {
        expect(markQuotedSpeech('<span class="x">hi</span>')).toBe('<span class="x">hi</span>');
    });
});

describe('splitReasoning', () => {
    it('extracts a think block', () => {
        const result = splitReasoning('<think>plan it</think>The answer.');
        expect(result).toEqual({ content: 'The answer.', reasoning: 'plan it' });
    });

    it('handles an unterminated block mid-stream', () => {
        expect(splitReasoning('<thinking>still going').reasoning).toBe('still going');
    });

    it('passes through text with no blocks', () => {
        expect(splitReasoning('plain')).toEqual({ content: 'plain', reasoning: '' });
    });
});

describe('renderMessage', () => {
    it('renders markdown emphasis', () => {
        expect(renderMessage('*waves*')).toContain('<em>waves</em>');
    });

    it('turns single newlines into line breaks', () => {
        expect(renderMessage('a\nb')).toContain('<br>');
    });

    it('strips script tags', () => {
        const html = renderMessage('hi <script>alert(1)</script>');
        expect(html).not.toContain('<script');
        expect(html).not.toContain('alert(1)');
    });

    it('strips event handler attributes but keeps the element', () => {
        const html = renderMessage('<img src=x onerror="alert(1)">');
        expect(html).not.toContain('onerror');
        expect(html).toContain('<img');
    });

    it('strips javascript: URLs', () => {
        expect(renderMessage('[click](javascript:alert(1))')).not.toContain('javascript:');
    });

    it('opens links in a new tab safely', () => {
        const html = renderMessage('[docs](https://example.com)');
        expect(html).toContain('target="_blank"');
        expect(html).toContain('rel="noreferrer noopener"');
    });

    it('marks quoted speech by default and skips it on request', () => {
        expect(renderMessage('"hi"')).toContain('class="quoted"');
        expect(renderMessage('"hi"', { highlightQuotes: false })).not.toContain('class="quoted"');
    });

    it('renders partial markdown from a stream without throwing', () => {
        expect(() => renderMessage('**unclosed bold and `code')).not.toThrow();
    });

    it('returns an empty string for empty input', () => {
        expect(renderMessage('')).toBe('');
    });
});
