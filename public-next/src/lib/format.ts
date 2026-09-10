/** Small formatting helpers shared across the UI. */

/**
 * The timestamp format SillyTavern writes into chat files, e.g.
 * `2026-09-10 @12h 30m 15s 250ms`. Kept byte-compatible so files stay readable
 * by the legacy UI.
 */
export function formatSendDate(date = new Date()): string {
    const pad = (value: number, width = 2) => String(value).padStart(width, '0');
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const time = `${pad(date.getHours())}h ${pad(date.getMinutes())}m ${pad(date.getSeconds())}s ${pad(date.getMilliseconds(), 3)}ms`;
    return `${day} @${time}`;
}

/** Parses {@link formatSendDate} output, falling back to `Date` parsing. */
export function parseSendDate(value: string | undefined): Date | null {
    if (!value) {
        return null;
    }
    const match = /^(\d{4})-(\d{2})-(\d{2}) @(\d{1,2})h (\d{1,2})m (\d{1,2})s(?: (\d{1,3})ms)?$/.exec(value);
    if (match) {
        const [, year, month, day, hour, minute, second, ms] = match;
        return new Date(
            Number(year),
            Number(month) - 1,
            Number(day),
            Number(hour),
            Number(minute),
            Number(second),
            Number(ms ?? 0),
        );
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const DIVISIONS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.35],
    ['month', 12],
    ['year', Number.POSITIVE_INFINITY],
];

/**
 * `3 minutes ago`, `last week`, … from a timestamp or ST date string.
 * @param reference The instant to measure against. Pass a shared clock (see
 * `useNow`) where several of these are shown together, so they agree.
 */
export function relativeTime(
    value: string | number | Date | undefined,
    reference: number = Date.now(),
): string {
    const date =
        value instanceof Date
            ? value
            : typeof value === 'number'
                ? new Date(value)
                : parseSendDate(value);
    if (!date) {
        return '';
    }

    let duration = (date.getTime() - reference) / 1000;

    // Everything inside a minute reads the same. Two reasons: a shared
    // reference is necessarily a coarse one, and second-level precision here
    // only ever made neighbouring messages disagree — including reading as the
    // future when the reference was rounded down past them.
    if (Math.abs(duration) < 60) {
        return RELATIVE.format(0, 'second');
    }

    for (const [unit, size] of DIVISIONS) {
        if (Math.abs(duration) < size) {
            return RELATIVE.format(Math.round(duration), unit);
        }
        duration /= size;
    }
    return '';
}

/** ISO 8601 for a `<time datetime>` attribute, or `undefined` if unparseable. */
export function isoTime(value: string | number | Date | undefined): string | undefined {
    const date =
        value instanceof Date
            ? value
            : typeof value === 'number'
                ? new Date(value)
                : parseSendDate(value);
    return date ? date.toISOString() : undefined;
}

/** Absolute time for tooltips. */
export function absoluteTime(value: string | number | Date | undefined): string {
    const date =
        value instanceof Date
            ? value
            : typeof value === 'number'
                ? new Date(value)
                : parseSendDate(value);
    return date ? date.toLocaleString() : '';
}

/** `1.2k`, `13.4k` — compact counts for token and message badges. */
export function compactNumber(value: number): string {
    return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

/**
 * A fast, dependency-free token estimate for the composer's live counter.
 *
 * Real counts come from `/api/tokenizers`; this exists so typing does not fire
 * a request per keystroke. Roughly 4 characters per token for Latin scripts,
 * ~1.6 for CJK, which tracks BPE tokenisers closely enough for a hint.
 */
export function estimateTokens(text: string): number {
    if (!text) {
        return 0;
    }
    let cjk = 0;
    for (const character of text) {
        const code = character.codePointAt(0) ?? 0;
        if (
            (code >= 0x3040 && code <= 0x30ff) ||
            (code >= 0x3400 && code <= 0x4dbf) ||
            (code >= 0x4e00 && code <= 0x9fff) ||
            (code >= 0xac00 && code <= 0xd7af) ||
            (code >= 0xf900 && code <= 0xfaff)
        ) {
            cjk++;
        }
    }
    const latin = text.length - cjk;
    return Math.ceil(latin / 4 + cjk / 1.6);
}

/** `12.3 KB` from a byte count. */
export function formatBytes(bytes: number): string {
    if (!bytes) {
        return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / 1024 ** exponent;
    return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
