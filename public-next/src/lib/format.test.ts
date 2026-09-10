import { describe, expect, it } from 'vitest';
import { compactNumber, estimateTokens, formatBytes, formatSendDate, parseSendDate } from './format';

describe('formatSendDate / parseSendDate', () => {
    it('round-trips through the legacy timestamp format', () => {
        const date = new Date(2026, 8, 10, 12, 30, 15, 250);
        const formatted = formatSendDate(date);
        expect(formatted).toBe('2026-09-10 @12h 30m 15s 250ms');
        expect(parseSendDate(formatted)?.getTime()).toBe(date.getTime());
    });

    it('parses a timestamp with no milliseconds', () => {
        expect(parseSendDate('2026-09-10 @01h 02m 03s')?.getSeconds()).toBe(3);
    });

    it('falls back to Date parsing for ISO strings', () => {
        expect(parseSendDate('2026-09-10T00:00:00Z')).toBeInstanceOf(Date);
    });

    it('returns null for junk', () => {
        expect(parseSendDate('not a date')).toBeNull();
        expect(parseSendDate(undefined)).toBeNull();
    });
});

describe('estimateTokens', () => {
    it('is zero for empty input', () => {
        expect(estimateTokens('')).toBe(0);
    });

    it('approximates four characters per token for Latin text', () => {
        expect(estimateTokens('a'.repeat(40))).toBe(10);
    });

    it('counts CJK more densely than Latin', () => {
        expect(estimateTokens('你好世界')).toBeGreaterThan(estimateTokens('abcd'));
    });
});

describe('formatBytes', () => {
    it('formats across units', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(2048)).toBe('2.0 KB');
        expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    });
});

describe('compactNumber', () => {
    it('shortens large numbers', () => {
        expect(compactNumber(1200)).toMatch(/1\.2/);
    });
});
