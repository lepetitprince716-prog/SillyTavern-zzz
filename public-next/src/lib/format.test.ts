import { describe, expect, it } from 'vitest';
import {
    compactNumber,
    estimateTokens,
    formatBytes,
    formatSendDate,
    isoTime,
    parseSendDate,
    relativeTime,
} from './format';

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

describe('relativeTime', () => {
    const at = (seconds: number) => formatSendDate(new Date(2026, 8, 10, 12, 0, seconds));
    const noon = new Date(2026, 8, 10, 12, 0, 0).getTime();

    it('measures against the reference it is given, not the wall clock', () => {
        expect(relativeTime(at(0), noon + 90_000)).toMatch(/minute/);
        expect(relativeTime(at(0), noon)).toMatch(/now/);
    });

    it('never reads as the future when the reference is rounded down past it', () => {
        // The shared clock is bucketed, so it can sit a few seconds behind the
        // message it is measuring. "in 1 second" is never the right answer for
        // something that already happened.
        expect(relativeTime(at(10), noon)).toMatch(/now/);
        expect(relativeTime(at(59), noon)).toMatch(/now/);
    });

    it('reads the same for everything inside a minute', () => {
        const reference = noon + 30_000;
        const texts = [at(0), at(15), at(30), at(45)].map((date) => relativeTime(date, reference));
        expect(new Set(texts).size).toBe(1);
    });

    it('never reports an older message as younger than a newer one', () => {
        // The defect this parameter exists for: computed per render, each
        // bubble measures against a different instant, so a message can show a
        // smaller age than the one above it and read as out of order.
        const reference = noon + 300_000;
        const ages = [at(0), at(30), at(60), at(120)].map((date) => {
            const parsed = parseSendDate(date);
            return reference - (parsed?.getTime() ?? 0);
        });
        expect([...ages].sort((a, b) => b - a)).toEqual(ages);
        expect(relativeTime(at(0), reference)).toBe(relativeTime(at(0), reference));
    });
});

describe('isoTime', () => {
    it('renders a chat timestamp as a machine-readable one', () => {
        const date = new Date(2026, 8, 10, 12, 30, 15, 250);
        expect(isoTime(formatSendDate(date))).toBe(date.toISOString());
    });

    it('is undefined rather than a wrong date when there is nothing to read', () => {
        expect(isoTime(undefined)).toBeUndefined();
        expect(isoTime('not a date')).toBeUndefined();
    });
});
