/**
 * Macro substitution for character cards and prompt templates.
 *
 * SillyTavern's macro language has grown large; this implements the subset that
 * appears in essentially every character card, plus the handful of dynamic
 * macros that are cheap to support. Unknown macros are left untouched so that
 * text round-trips instead of silently losing content.
 */

export interface MacroContext {
    /** Character name — `{{char}}`. */
    char: string;
    /** Persona name — `{{user}}`. */
    user: string;
    /** Character description — `{{description}}`. */
    description?: string;
    personality?: string;
    scenario?: string;
    /** Persona description — `{{persona}}`. */
    persona?: string;
    /** Example dialogue — `{{mesExamples}}`. */
    mesExamples?: string;
    /** Deterministic source for `{{random}}` / `{{roll}}`, for tests. */
    random?: () => number;
}

/** Matches `{{name}}` or `{{name:argument}}`, non-greedy, case-insensitive. */
const MACRO_PATTERN = /\{\{([a-z_][a-z0-9_]*)(?::([\s\S]*?))?\}\}/gi;

/** Splits a macro argument on commas or double-pipes, the two forms ST accepts. */
function splitChoices(argument: string): string[] {
    const parts = argument.includes('||') ? argument.split('||') : argument.split(',');
    return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function pick(choices: string[], random: () => number): string {
    if (choices.length === 0) {
        return '';
    }
    const index = Math.min(choices.length - 1, Math.floor(random() * choices.length));
    return choices[index] ?? '';
}

/** Rolls `NdM` or a plain `M`-sided die. Returns an empty string if unparsable. */
function roll(argument: string, random: () => number): string {
    const match = /^(?:(\d+)[d])?(\d+)$/i.exec(argument.trim());
    if (!match) {
        return '';
    }
    const count = Math.min(100, Math.max(1, Number(match[1] || '1')));
    const sides = Math.max(1, Number(match[2]));
    let total = 0;
    for (let i = 0; i < count; i++) {
        total += Math.floor(random() * sides) + 1;
    }
    return String(total);
}

/**
 * Replaces every known macro in `text`.
 *
 * Substitution runs a bounded number of passes so that a card whose
 * description itself contains `{{char}}` resolves, without letting a
 * self-referential macro loop forever.
 */
export function substituteMacros(text: string, context: MacroContext): string {
    if (!text || !text.includes('{{')) {
        return text ?? '';
    }

    const random = context.random ?? Math.random;
    const now = new Date();

    const statics = new Map<string, string>([
        ['char', context.char],
        ['bot', context.char],
        ['charname', context.char],
        ['user', context.user],
        ['username', context.user],
        ['description', context.description ?? ''],
        ['personality', context.personality ?? ''],
        ['scenario', context.scenario ?? ''],
        ['persona', context.persona ?? ''],
        ['mesexamples', context.mesExamples ?? ''],
        ['newline', '\n'],
        ['noop', ''],
        ['time', now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })],
        ['date', now.toLocaleDateString()],
        ['weekday', now.toLocaleDateString(undefined, { weekday: 'long' })],
        ['isotime', now.toISOString().slice(11, 19)],
        ['isodate', now.toISOString().slice(0, 10)],
    ]);

    let result = text;
    // Three passes resolve nested macros (card text containing {{char}}) while
    // keeping the work bounded for pathological input.
    for (let pass = 0; pass < 3; pass++) {
        let replaced = false;
        result = result.replace(MACRO_PATTERN, (match, rawName: string, rawArgument?: string) => {
            const name = rawName.toLowerCase();
            const argument = rawArgument ?? '';

            if (name === 'random' || name === 'pick') {
                replaced = true;
                return pick(splitChoices(argument), random);
            }
            if (name === 'roll') {
                replaced = true;
                return roll(argument, random);
            }

            const value = statics.get(name);
            if (value === undefined) {
                return match; // Not ours — leave it for another consumer.
            }
            replaced = true;
            return value;
        });

        if (!replaced || !result.includes('{{')) {
            break;
        }
    }

    return result;
}

/** Collapses runs of blank lines and trims, for prompt assembly. */
export function tidy(text: string): string {
    return text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
