/**
 * Instruct and context templates: turning a message array into one string.
 *
 * A text completion endpoint takes a single prompt, so the message list has to
 * be flattened, and every model family disagrees about how. SillyTavern already
 * ships 38 instruct templates and 34 context templates describing exactly that,
 * and `POST /api/settings/get` returns both sets parsed. This module reads
 * those files rather than inventing a second vocabulary, so a template edited
 * in the classic UI applies here unchanged.
 *
 * The story string is a Handlebars template, but the bundled corpus uses only
 * three constructs — `{{#if name}}…{{/if}}`, `{{name}}` and `{{trim}}` — so a
 * bounded evaluator for that subset replaces the dependency. Every bundled
 * template is exercised in the tests.
 */

import type { ChatMessage } from '@/api/types';

/** How a template wants speaker names handled. */
export type NamesBehavior = 'none' | 'force' | 'always';

/**
 * An instruct template, as stored in `data/<user>/instruct/*.json`.
 *
 * Field names are the file's, not tidier ones: these objects are read from and
 * written back to the same files the classic UI owns.
 */
export interface InstructTemplate {
    name: string;
    /** Prefix before a user turn. */
    input_sequence: string;
    /** Prefix before an assistant turn. */
    output_sequence: string;
    /** Prefix before a system turn. */
    system_sequence: string;
    /** Overrides for the first and last turn of each role, when non-empty. */
    first_input_sequence: string;
    first_output_sequence: string;
    last_input_sequence: string;
    last_output_sequence: string;
    last_system_sequence: string;
    input_suffix: string;
    output_suffix: string;
    system_suffix: string;
    /** Wraps the story string, when the story string is not placed in-chat. */
    story_string_prefix: string;
    story_string_suffix: string;
    /** Newline-separated list of strings that end a turn. */
    stop_sequence: string;
    /** Put a newline between a sequence and the text it introduces. */
    wrap: boolean;
    /** Substitute macros inside the sequences themselves. */
    macro: boolean;
    names_behavior: NamesBehavior;
    /** Treat a system turn as a user turn. Some templates have no system role. */
    system_same_as_user: boolean;
    /** Also send every turn sequence as a stop string. */
    sequences_as_stop_strings: boolean;
    /** Leave example dialogue unwrapped. */
    skip_examples: boolean;
}

/** A context template, as stored in `data/<user>/context/*.json`. */
export interface ContextTemplate {
    name: string;
    /** Handlebars-ish template assembling the character definition block. */
    story_string: string;
    /** Heading placed before each example dialogue block. */
    example_separator: string;
    /** Marker placed between the definition block and the chat. */
    chat_start: string;
    /** Send `chat_start` and `example_separator` as stop strings too. */
    use_stop_strings: boolean;
    /** Send `Name:` as a stop string, so the model cannot write both sides. */
    names_as_stop_strings: boolean;
    /** Always end the prompt with the character's name. */
    always_force_name2: boolean;
    /** Cut the reply at the last complete sentence. */
    trim_sentences: boolean;
    /** Cut the reply at the first newline. */
    single_line: boolean;
}

const NAMES_BEHAVIORS: readonly string[] = ['none', 'force', 'always'];

function asString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function asBoolean(value: unknown, fallback = false): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

/**
 * Fills in the fields a template file omits.
 *
 * The bundled files are not uniform — older ones predate `input_suffix`,
 * `system_same_as_user` and the rest — so reading them needs defaults rather
 * than trust.
 */
export function normalizeInstruct(raw: unknown): InstructTemplate {
    const source = (raw ?? {}) as Record<string, unknown>;
    const behavior = asString(source.names_behavior);

    return {
        name: asString(source.name) || 'Unnamed',
        input_sequence: asString(source.input_sequence),
        output_sequence: asString(source.output_sequence),
        system_sequence: asString(source.system_sequence),
        first_input_sequence: asString(source.first_input_sequence),
        first_output_sequence: asString(source.first_output_sequence),
        last_input_sequence: asString(source.last_input_sequence),
        last_output_sequence: asString(source.last_output_sequence),
        last_system_sequence: asString(source.last_system_sequence),
        input_suffix: asString(source.input_suffix),
        output_suffix: asString(source.output_suffix),
        system_suffix: asString(source.system_suffix),
        story_string_prefix: asString(source.story_string_prefix),
        story_string_suffix: asString(source.story_string_suffix),
        stop_sequence: asString(source.stop_sequence),
        // `wrap` and `macro` default on: that is what a file written before
        // they existed meant.
        wrap: asBoolean(source.wrap, true),
        macro: asBoolean(source.macro, true),
        names_behavior: NAMES_BEHAVIORS.includes(behavior) ? (behavior as NamesBehavior) : 'none',
        system_same_as_user: asBoolean(source.system_same_as_user),
        sequences_as_stop_strings: asBoolean(source.sequences_as_stop_strings, true),
        skip_examples: asBoolean(source.skip_examples),
    };
}

export function normalizeContext(raw: unknown): ContextTemplate {
    const source = (raw ?? {}) as Record<string, unknown>;

    return {
        name: asString(source.name) || 'Unnamed',
        story_string: asString(source.story_string),
        example_separator: asString(source.example_separator),
        chat_start: asString(source.chat_start),
        use_stop_strings: asBoolean(source.use_stop_strings),
        names_as_stop_strings: asBoolean(source.names_as_stop_strings, true),
        always_force_name2: asBoolean(source.always_force_name2),
        trim_sentences: asBoolean(source.trim_sentences),
        single_line: asBoolean(source.single_line),
    };
}

/** The slots a story string can reference. */
export interface StoryValues {
    system: string;
    description: string;
    personality: string;
    scenario: string;
    persona: string;
    wiBefore: string;
    wiAfter: string;
    anchorBefore: string;
    anchorAfter: string;
    mesExamples: string;
    [key: string]: string;
}

/**
 * `{{#if key}}` … `{{/if}}` and `{{key}}`, nothing more.
 *
 * The body deliberately excludes a further `{{#if`, so a match is always the
 * *innermost* block. A plain non-greedy body would instead pair an outer
 * `{{#if}}` with an inner `{{/if}}` and silently truncate everything between
 * them — the bundled templates never nest, so only a user's own template would
 * have hit it, and it would have quietly dropped part of their prompt.
 */
const IF_BLOCK = /\{\{#if\s+([\w.]+)\s*\}\}((?:(?!\{\{#if\s)[\s\S])*?)\{\{\/if\}\}/g;
const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * Renders a story string.
 *
 * `{{#if}}` blocks resolve first so a conditional never leaves a stray
 * placeholder behind, innermost outwards, repeating until the pass stops
 * changing anything — bounded, because a template with unbalanced tags must
 * not loop forever.
 */
export function renderStoryString(template: string, values: Partial<StoryValues>): string {
    const truthy = (key: string) => Boolean(values[key]?.trim());

    let result = template;
    for (let pass = 0; pass < 8; pass += 1) {
        const next = result.replace(IF_BLOCK, (_, key: string, body: string) => (truthy(key) ? body : ''));
        if (next === result) {
            break;
        }
        result = next;
    }

    result = result.replace(PLACEHOLDER, (match, key: string) => {
        // `{{trim}}` is a marker, not a value; it is removed below along with
        // the blank lines around it.
        if (key === 'trim') {
            return match;
        }
        return values[key] ?? '';
    });

    // Matches the classic UI's own rule for the marker.
    result = result.replace(/(?:\r?\n)*\{\{trim\}\}(?:\r?\n)*/gi, '');

    // Leading newlines, from a leading slot that turned out empty, would push
    // the whole prompt down a line. Trailing whitespace is left alone: whether
    // the block ends with a newline is decided by the caller, which knows what
    // follows it.
    return result.replace(/^\n+/, '');
}

/** One turn, already reduced to a role and a body. */
export interface PromptTurn {
    role: 'system' | 'user' | 'assistant';
    name: string;
    content: string;
}

interface WrapOptions {
    instruct: InstructTemplate;
    /** True for the first turn of this role in the prompt. */
    isFirst?: boolean;
    /** True for the last turn of this role in the prompt. */
    isLast?: boolean;
    /** Names of the two speakers, for macro substitution inside sequences. */
    userName: string;
    charName: string;
}

/** Substitutes the macros a sequence may contain. */
function sequenceMacros(text: string, name: string, userName: string, charName: string): string {
    return text
        .replace(/\{\{name\}\}/gi, name || 'System')
        .replace(/\{\{user\}\}/gi, userName)
        .replace(/\{\{char\}\}/gi, charName);
}

/**
 * Wraps one turn in its instruct sequences.
 *
 * Mirrors `formatInstructModeChat` in `public/scripts/instruct-mode.js`,
 * including the detail that an empty suffix becomes a newline when `wrap` is
 * on — without it, turns run together on one line.
 */
export function wrapTurn(turn: PromptTurn, options: WrapOptions): string {
    const { instruct, isFirst, isLast, userName, charName } = options;
    const isSystem = turn.role === 'system';
    const isUser = turn.role === 'user';

    let prefix: string;
    let suffix: string;

    if (isSystem) {
        prefix = instruct.system_same_as_user
            ? instruct.input_sequence
            : (isLast && instruct.last_system_sequence) || instruct.system_sequence;
        suffix = instruct.system_same_as_user ? instruct.input_suffix : instruct.system_suffix;
    } else if (isUser) {
        prefix = (isFirst && instruct.first_input_sequence)
            || (isLast && instruct.last_input_sequence)
            || instruct.input_sequence;
        suffix = instruct.input_suffix;
    } else {
        prefix = (isFirst && instruct.first_output_sequence)
            || (isLast && instruct.last_output_sequence)
            || instruct.output_sequence;
        suffix = instruct.output_suffix;
    }

    if (instruct.macro) {
        prefix = sequenceMacros(prefix, turn.name, userName, charName);
        suffix = sequenceMacros(suffix, turn.name, userName, charName);
    }

    if (!suffix && instruct.wrap) {
        suffix = '\n';
    }

    const includeNames = !isSystem && instruct.names_behavior === 'always' && Boolean(turn.name);
    const body = includeNames ? `${turn.name}: ${turn.content}` : turn.content;
    const separator = instruct.wrap ? '\n' : '';

    return [prefix, body + suffix].filter(Boolean).join(separator);
}

/**
 * The trailing line that hands the turn to the model.
 *
 * Mirrors `formatInstructModePrompt`, including the space-filler hack: some
 * templates end `output_sequence` with a space but not `last_output_sequence`,
 * and without carrying that space over the name runs into the sequence.
 */
export function finalTurnLine(instruct: InstructTemplate, charName: string, userName: string): string {
    let sequence = instruct.last_output_sequence || instruct.output_sequence || '';
    const includeNames = instruct.names_behavior === 'always' && Boolean(charName);

    let nameFiller = '';
    if (
        includeNames
        && instruct.last_output_sequence
        && instruct.output_sequence
        && sequence === instruct.last_output_sequence
        && /\s$/.test(instruct.output_sequence)
        && !/\s$/.test(instruct.last_output_sequence)
    ) {
        nameFiller = instruct.output_sequence.slice(-1);
    }

    if (instruct.macro) {
        sequence = sequenceMacros(sequence, charName, userName, charName);
    }

    const separator = instruct.wrap ? '\n' : '';
    const text = includeNames
        ? separator + sequence + separator + nameFiller + `${charName}:`
        : separator + sequence;

    return (instruct.wrap ? text.trimEnd() : text) + (includeNames ? '' : separator);
}

/**
 * Every string that should end a generation.
 *
 * Mirrors `getInstructStoppingSequences`: the newline prefix matters, because
 * text-generation backends match a stop string literally and a template like
 * Metharme separates turns without one.
 */
export function stopSequences(options: {
    instruct: InstructTemplate;
    context: ContextTemplate;
    userName: string;
    charName: string;
    /** False leaves the instruct sequences out entirely. Defaults to true. */
    instructEnabled?: boolean;
    /** Extra strings from the user's own settings. */
    custom?: string[];
}): string[] {
    const { instruct, context, userName, charName, instructEnabled = true, custom = [] } = options;
    const result: string[] = [];
    const wrap = (value: string) => (instruct.wrap ? `\n${value}` : value);

    const named = (value: string, name: string) =>
        value.replace(/\{\{name\}\}/gi, name).replace(/\{\{user\}\}/gi, userName).replace(/\{\{char\}\}/gi, charName);

    if (instructEnabled) {
        const candidates = [instruct.stop_sequence];
        if (instruct.sequences_as_stop_strings) {
            candidates.push(
                named(instruct.input_sequence, userName),
                named(instruct.output_sequence, charName),
                named(instruct.first_output_sequence, charName),
                named(instruct.last_output_sequence, charName),
                named(instruct.system_sequence, 'System'),
                named(instruct.last_system_sequence, 'System'),
            );
        }

        // A sequence may itself be several lines; each line is its own stop string.
        for (const line of candidates.join('\n').split('\n')) {
            // A sequence that is only whitespace would stop every generation
            // immediately, so it is never a stop string.
            if (line.trim().length > 0) {
                result.push(wrap(line));
            }
        }
    }

    if (context.use_stop_strings) {
        if (context.chat_start) {
            result.push(`\n${context.chat_start}`);
        }
        if (context.example_separator) {
            result.push(`\n${context.example_separator}`);
        }
    }

    if (context.names_as_stop_strings) {
        // Stops the model writing the human's next line for them.
        result.push(`\n${userName}:`);
        // The character's own name only stops a generation when turns are
        // actually labelled; otherwise it would cut a reply that merely
        // mentions them.
        if (!instructEnabled || instruct.names_behavior === 'always') {
            result.push(`\n${charName}:`);
        }
    }

    result.push(...custom.filter((value) => value.length > 0));

    return [...new Set(result)];
}

/** Everything needed to flatten a chat into one prompt. */
export interface TextPromptInput {
    /**
     * Wrap each turn in the instruct template's sequences.
     *
     * Off is a real mode, not a degenerate case: a base model that was never
     * instruction-tuned usually continues plain `Name: text` dialogue far
     * better than it follows `<|im_start|>` scaffolding it has never seen. The
     * classic UI calls this instruct mode being disabled, and several of its
     * behaviours — `always_force_name2` among them — only apply there.
     */
    instructEnabled: boolean;
    instruct: InstructTemplate;
    context: ContextTemplate;
    /** Story-string slots, already substituted and world-info-filled. */
    story: Partial<StoryValues>;
    /** Example dialogue blocks, split on `<START>`. */
    examples: string[];
    turns: PromptTurn[];
    userName: string;
    charName: string;
    customStops?: string[];
}

export interface TextPrompt {
    prompt: string;
    stop: string[];
}

/**
 * Flattens a chat into a single prompt string.
 *
 * The order is the classic UI's: the story string, then example dialogue, then
 * the chat-start marker, then the turns, then the line that hands over to the
 * model.
 */
/**
 * The definition block, wrapped and terminated.
 *
 * The classic UI joins every block of the prompt with nothing at all — "right
 * now, everything is suffixed with a newline" — so each block is responsible
 * for its own terminator. The rule for this one is exactly
 * `renderStoryString`'s: append a single newline only when the block does not
 * already end with one *and* the template contributes no suffix of its own.
 */
function storyBlock(input: TextPromptInput): string {
    const { instructEnabled, instruct, context, story, userName, charName } = input;
    const separator = instruct.wrap ? '\n' : '';

    const rendered = renderStoryString(context.story_string, story).trimEnd();
    if (!rendered) {
        return '';
    }

    // Outside instruct mode the definition block is plain text: there are no
    // sequences to wrap it in.
    const prefix = !instructEnabled
        ? ''
        : instruct.macro
            ? sequenceMacros(instruct.story_string_prefix, 'System', userName, charName)
            : instruct.story_string_prefix;
    const suffix = !instructEnabled
        ? ''
        : instruct.macro
            ? sequenceMacros(instruct.story_string_suffix, 'System', userName, charName)
            : instruct.story_string_suffix;

    const block = [prefix, rendered].filter(Boolean).join(separator) + suffix;
    if (block.endsWith('\n')) {
        return block;
    }
    if (!instructEnabled || (instruct.wrap && !suffix)) {
        return `${block}\n`;
    }
    return block;
}

/**
 * Example dialogue blocks, each headed and terminated.
 *
 * In instruct mode the heading is the literal `<START>` marker rather than the
 * context template's separator, matching `parseMesExamples`: the separator is
 * prose meant for a plain-completion prompt, and inside instruct markers it
 * reads as part of the conversation.
 */
function exampleBlocks(input: TextPromptInput): string {
    const { instructEnabled, context, examples } = input;
    const heading = instructEnabled
        ? '<START>\n'
        : (context.example_separator ? `${context.example_separator}\n` : '');
    return examples
        .map((block) => block.trim())
        .filter(Boolean)
        .map((block) => `${heading}${block}\n`)
        .join('');
}

export function buildTextPrompt(input: TextPromptInput): TextPrompt {
    const { instructEnabled, instruct, context, turns, userName, charName } = input;

    const header = storyBlock(input) + exampleBlocks(input);
    // Matches the classic UI's `addChatsSeparator`.
    const chatStart = context.chat_start ? `${context.chat_start}\n` : '';

    if (!instructEnabled) {
        // Plain dialogue: every turn is `Name: text`, which is the shape a
        // base model continues.
        const lines = turns
            .map((turn) => (turn.name ? `${turn.name}: ${turn.content}` : turn.content))
            .filter(Boolean)
            .map((line) => `${line}\n`)
            .join('');

        let plain = header + chatStart + lines;
        if (context.always_force_name2) {
            // Hands the turn to the character. Without it a base model is as
            // likely to continue the human's line.
            plain += `${charName}:`;
        }
        return {
            prompt: plain,
            stop: stopSequences({
                instruct,
                context,
                userName,
                charName,
                instructEnabled: false,
                ...(input.customStops ? { custom: input.customStops } : {}),
            }),
        };
    }

    // First and last index per role, so the overriding sequences apply to the
    // right turns rather than to whichever happens to be first overall.
    const firstOf = new Map<string, number>();
    const lastOf = new Map<string, number>();
    turns.forEach((turn, index) => {
        if (!firstOf.has(turn.role)) {
            firstOf.set(turn.role, index);
        }
        lastOf.set(turn.role, index);
    });

    // Turns are concatenated with nothing between them: `wrapTurn` already
    // appended each turn's suffix, substituting a newline when the template
    // gives none. Joining them with a separator as well would add a blank line
    // per turn — which inflates the prompt and, for a template whose markers
    // are newline-sensitive, changes what the model sees.
    const body = turns
        .map((turn, index) => wrapTurn(turn, {
            instruct,
            isFirst: firstOf.get(turn.role) === index,
            isLast: lastOf.get(turn.role) === index,
            userName,
            charName,
        }))
        .join('');

    // `always_force_name2` is deliberately not applied here: in instruct mode
    // the template's own last-output sequence is the handover, and appending a
    // name after it is what the classic UI avoids with `!isInstruct`.
    const prompt = header + chatStart + body + finalTurnLine(instruct, charName, userName);

    return {
        prompt,
        stop: stopSequences({
            instruct,
            context,
            userName,
            charName,
            ...(input.customStops ? { custom: input.customStops } : {}),
        }),
    };
}

/** Reduces a chat message to a turn, resolving the active swipe. */
export function turnFromMessage(message: ChatMessage, activeText: string): PromptTurn {
    return {
        role: message.is_system ? 'system' : message.is_user ? 'user' : 'assistant',
        name: message.name ?? '',
        content: activeText,
    };
}
