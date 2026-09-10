import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/api/types';
import bundled from './__fixtures__/templates.json';
import {
    buildTextPrompt,
    finalTurnLine,
    normalizeContext,
    normalizeInstruct,
    renderStoryString,
    stopSequences,
    turnFromMessage,
    wrapTurn,
    type ContextTemplate,
    type InstructTemplate,
} from './templates';

/**
 * Every instruct and context template SillyTavern ships, snapshotted from
 * `default/content/presets/`. The point of testing against the real corpus is
 * that these files are not uniform — older ones omit fields added later — so a
 * reader that only handles the tidy ones would pass a hand-written fixture and
 * fail on a user's actual install.
 */
const INSTRUCT_TEMPLATES = bundled.instruct as unknown[];
const CONTEXT_TEMPLATES = bundled.context as unknown[];

function instruct(patch: Partial<InstructTemplate> = {}): InstructTemplate {
    return { ...normalizeInstruct({ name: 'Test' }), ...patch };
}

function context(patch: Partial<ContextTemplate> = {}): ContextTemplate {
    return { ...normalizeContext({ name: 'Test' }), ...patch };
}

const CHATML = normalizeInstruct(
    INSTRUCT_TEMPLATES.find((t) => (t as { name: string }).name === 'ChatML'),
);
const CHATML_CONTEXT = normalizeContext(
    CONTEXT_TEMPLATES.find((t) => (t as { name: string }).name === 'ChatML'),
);

describe('the bundled corpus', () => {
    it('ships templates to read', () => {
        expect(INSTRUCT_TEMPLATES.length).toBeGreaterThan(30);
        expect(CONTEXT_TEMPLATES.length).toBeGreaterThan(30);
    });

    it('normalises every instruct template without throwing or leaving undefined', () => {
        for (const raw of INSTRUCT_TEMPLATES) {
            const template = normalizeInstruct(raw);
            expect(template.name).toBeTruthy();
            for (const [key, value] of Object.entries(template)) {
                expect(value, `${template.name}.${key}`).toBeDefined();
                expect(value, `${template.name}.${key}`).not.toBeNull();
            }
        }
    });

    it('normalises every context template and keeps a usable story string', () => {
        for (const raw of CONTEXT_TEMPLATES) {
            const template = normalizeContext(raw);
            expect(template.name).toBeTruthy();
            expect(typeof template.story_string).toBe('string');
        }
    });

    it('leaves no placeholder unresolved in any story string', () => {
        const values = {
            system: 'SYSTEM',
            description: 'DESCRIPTION',
            personality: 'PERSONALITY',
            scenario: 'SCENARIO',
            persona: 'PERSONA',
            wiBefore: 'WI_BEFORE',
            wiAfter: 'WI_AFTER',
            anchorBefore: 'ANCHOR_BEFORE',
            anchorAfter: 'ANCHOR_AFTER',
            char: 'Seraphina',
            user: 'User',
        };
        for (const raw of CONTEXT_TEMPLATES) {
            const template = normalizeContext(raw);
            const rendered = renderStoryString(template.story_string, values);
            expect(rendered, template.name).not.toMatch(/\{\{|\}\}/);
        }
    });

    it('renders every story string to nothing when every slot is empty', () => {
        for (const raw of CONTEXT_TEMPLATES) {
            const template = normalizeContext(raw);
            // A template that emits its scaffolding with no content would put
            // stray punctuation at the top of every prompt.
            expect(renderStoryString(template.story_string, {}).trim(), template.name).toBe('');
        }
    });

    it('builds a prompt with every instruct template that ends where the model takes over', () => {
        for (const raw of INSTRUCT_TEMPLATES) {
            const template = normalizeInstruct(raw);
            const { prompt } = buildTextPrompt({
                instructEnabled: true,
                instruct: template,
                context: CHATML_CONTEXT,
                story: { description: 'A tall elf.' },
                examples: [],
                turns: [
                    { role: 'user', name: 'User', content: 'Hello?' },
                    { role: 'assistant', name: 'Seraphina', content: 'Hello.' },
                    { role: 'user', name: 'User', content: 'How are you?' },
                ],
                userName: 'User',
                charName: 'Seraphina',
            });
            expect(prompt, template.name).toContain('A tall elf.');
            expect(prompt, template.name).toContain('How are you?');
            expect(prompt, template.name).not.toMatch(/\{\{name\}\}/i);
        }
    });

    it('never produces a whitespace-only stop string, which would stop everything', () => {
        for (const raw of INSTRUCT_TEMPLATES) {
            const template = normalizeInstruct(raw);
            const stops = stopSequences({
                instruct: template,
                context: CHATML_CONTEXT,
                userName: 'User',
                charName: 'Seraphina',
            });
            for (const stop of stops) {
                expect(stop.trim(), `${template.name}: ${JSON.stringify(stop)}`).not.toBe('');
            }
        }
    });
});

describe('normalizeInstruct', () => {
    it('defaults wrap and macro on, which is what an older file meant', () => {
        const template = normalizeInstruct({ name: 'Old' });
        expect(template.wrap).toBe(true);
        expect(template.macro).toBe(true);
        expect(template.sequences_as_stop_strings).toBe(true);
    });

    it('keeps an explicit false', () => {
        expect(normalizeInstruct({ wrap: false }).wrap).toBe(false);
    });

    it('rejects a names_behavior it does not implement', () => {
        expect(normalizeInstruct({ names_behavior: 'always' }).names_behavior).toBe('always');
        expect(normalizeInstruct({ names_behavior: 'sometimes' }).names_behavior).toBe('none');
    });

    it('survives junk instead of a template', () => {
        expect(normalizeInstruct(null).name).toBe('Unnamed');
        expect(normalizeInstruct('nonsense').input_sequence).toBe('');
        expect(normalizeInstruct({ input_sequence: 42 }).input_sequence).toBe('');
    });
});

describe('renderStoryString', () => {
    it('drops a conditional block whose slot is empty', () => {
        expect(renderStoryString('{{#if a}}A={{a}}{{/if}}B', { a: '' })).toBe('B');
        expect(renderStoryString('{{#if a}}A={{a}}{{/if}}B', { a: 'x' })).toBe('A=xB');
    });

    it('treats whitespace as empty', () => {
        expect(renderStoryString('{{#if a}}kept{{/if}}', { a: '   \n ' })).toBe('');
    });

    it('handles nested conditionals', () => {
        const template = '{{#if a}}[{{#if b}}{{b}}{{/if}}]{{/if}}';
        expect(renderStoryString(template, { a: 'y', b: 'inner' })).toBe('[inner]');
        expect(renderStoryString(template, { a: 'y' })).toBe('[]');
        expect(renderStoryString(template, {})).toBe('');
    });

    it('eats the newlines around the trim marker', () => {
        expect(renderStoryString('a\n\n{{trim}}\n\nb', {})).toBe('ab');
    });

    it('leaves an unknown placeholder empty rather than printing it', () => {
        expect(renderStoryString('[{{nope}}]', {})).toBe('[]');
    });

    it('collapses the blank run an empty slot leaves behind', () => {
        const template = '{{#if a}}{{a}}\n{{/if}}{{#if b}}{{b}}\n{{/if}}{{#if c}}{{c}}\n{{/if}}';
        expect(renderStoryString(template, { a: 'one', c: 'three' })).toBe('one\nthree\n');
    });

    it('terminates on an unbalanced template instead of looping', () => {
        expect(() => renderStoryString('{{#if a}}no end', { a: 'x' })).not.toThrow();
    });
});

describe('wrapTurn', () => {
    const options = { instruct: CHATML, userName: 'User', charName: 'Seraphina' };

    it('wraps a user turn in the input sequences', () => {
        expect(wrapTurn({ role: 'user', name: 'User', content: 'hi' }, options))
            .toBe('<|im_start|>user\nhi<|im_end|>\n');
    });

    it('wraps an assistant turn in the output sequences', () => {
        expect(wrapTurn({ role: 'assistant', name: 'Seraphina', content: 'hi' }, options))
            .toBe('<|im_start|>assistant\nhi<|im_end|>\n');
    });

    it('wraps a system turn in the system sequences', () => {
        expect(wrapTurn({ role: 'system', name: '', content: 'be nice' }, options))
            .toBe('<|im_start|>system\nbe nice<|im_end|>\n');
    });

    it('sends a system turn as a user turn when the template has no system role', () => {
        const template = instruct({
            input_sequence: '[INST]',
            input_suffix: '[/INST]',
            system_sequence: 'SYS',
            system_same_as_user: true,
        });
        expect(wrapTurn({ role: 'system', name: '', content: 'be nice' }, { ...options, instruct: template }))
            .toBe('[INST]\nbe nice[/INST]');
    });

    it('adds a newline suffix when wrap is on and the template gives none', () => {
        const template = instruct({ input_sequence: '### Instruction:', input_suffix: '' });
        expect(wrapTurn({ role: 'user', name: 'User', content: 'hi' }, { ...options, instruct: template }))
            .toBe('### Instruction:\nhi\n');
    });

    it('runs the sequence and the text together when wrap is off', () => {
        const template = instruct({ input_sequence: '<user>', input_suffix: '</user>', wrap: false });
        expect(wrapTurn({ role: 'user', name: 'User', content: 'hi' }, { ...options, instruct: template }))
            .toBe('<user>hi</user>');
    });

    it('prefixes the speaker name only when the template asks for it always', () => {
        const named = instruct({ input_sequence: 'U:', names_behavior: 'always' });
        expect(wrapTurn({ role: 'user', name: 'Alice', content: 'hi' }, { ...options, instruct: named }))
            .toContain('Alice: hi');
        const unnamed = instruct({ input_sequence: 'U:', names_behavior: 'force' });
        expect(wrapTurn({ role: 'user', name: 'Alice', content: 'hi' }, { ...options, instruct: unnamed }))
            .not.toContain('Alice:');
    });

    it('never prefixes a name onto a system turn', () => {
        const named = instruct({ system_sequence: 'S:', names_behavior: 'always' });
        expect(wrapTurn({ role: 'system', name: 'System', content: 'x' }, { ...options, instruct: named }))
            .not.toContain('System: x');
    });

    it('substitutes {{name}} inside a sequence', () => {
        const template = instruct({ output_sequence: '{{name}} says:' });
        expect(wrapTurn({ role: 'assistant', name: 'Seraphina', content: 'hi' }, { ...options, instruct: template }))
            .toContain('Seraphina says:');
    });

    it('leaves {{name}} alone when the template opts out of macros', () => {
        const template = instruct({ output_sequence: '{{name}} says:', macro: false });
        expect(wrapTurn({ role: 'assistant', name: 'Seraphina', content: 'hi' }, { ...options, instruct: template }))
            .toContain('{{name}} says:');
    });

    it('prefers the first-turn sequence for the first turn of that role', () => {
        const template = instruct({ output_sequence: 'OUT', first_output_sequence: 'FIRST' });
        const withOptions = { ...options, instruct: template };
        expect(wrapTurn({ role: 'assistant', name: 'S', content: 'x' }, { ...withOptions, isFirst: true }))
            .toContain('FIRST');
        expect(wrapTurn({ role: 'assistant', name: 'S', content: 'x' }, withOptions)).toContain('OUT');
    });

    it('prefers the last-turn sequence for the last turn of that role', () => {
        const template = instruct({ input_sequence: 'IN', last_input_sequence: 'LAST' });
        expect(wrapTurn(
            { role: 'user', name: 'U', content: 'x' },
            { ...options, instruct: template, isLast: true },
        )).toContain('LAST');
    });
});

describe('finalTurnLine', () => {
    it('ends the prompt with the assistant sequence, on its own line', () => {
        // The trailing newline is deliberate and matches the classic UI: with
        // no name to follow the sequence, the model's first token should land
        // on a fresh line rather than immediately after `assistant`.
        expect(finalTurnLine(CHATML, 'Seraphina', 'User')).toBe('\n<|im_start|>assistant\n');
    });

    it('prefers the last-output sequence when one exists', () => {
        const template = instruct({ output_sequence: 'OUT', last_output_sequence: 'LAST' });
        expect(finalTurnLine(template, 'S', 'U')).toContain('LAST');
    });

    it('appends the name when the template names every turn', () => {
        const template = instruct({ output_sequence: 'OUT', names_behavior: 'always' });
        expect(finalTurnLine(template, 'Seraphina', 'User')).toBe('\nOUT\nSeraphina:');
    });

    it('carries a trailing space from output_sequence to a last_output_sequence lacking one', () => {
        // Mistral's templates end output_sequence with a space; without the
        // filler the name runs straight into the sequence.
        const template = instruct({
            output_sequence: '[/INST] ',
            last_output_sequence: '[/INST]',
            names_behavior: 'always',
        });
        expect(finalTurnLine(template, 'Seraphina', 'User')).toBe('\n[/INST]\n Seraphina:');
    });
});

describe('stopSequences', () => {
    it('includes the template stop sequence with a leading newline', () => {
        const stops = stopSequences({
            instruct: instruct({ stop_sequence: '</s>' }),
            context: context(),
            userName: 'User',
            charName: 'Seraphina',
        });
        expect(stops).toContain('\n</s>');
    });

    it('omits the newline when the template does not wrap', () => {
        const stops = stopSequences({
            instruct: instruct({ stop_sequence: '</s>', wrap: false }),
            context: context(),
            userName: 'User',
            charName: 'Seraphina',
        });
        expect(stops).toContain('</s>');
        expect(stops).not.toContain('\n</s>');
    });

    it('adds the turn sequences when the template asks for it', () => {
        const stops = stopSequences({
            instruct: instruct({ input_sequence: '### Instruction:', sequences_as_stop_strings: true }),
            context: context(),
            userName: 'User',
            charName: 'Seraphina',
        });
        expect(stops).toContain('\n### Instruction:');
    });

    it('leaves the turn sequences out when it does not', () => {
        const stops = stopSequences({
            instruct: instruct({ input_sequence: '### Instruction:', sequences_as_stop_strings: false }),
            context: context(),
            userName: 'User',
            charName: 'Seraphina',
        });
        expect(stops).not.toContain('\n### Instruction:');
    });

    it('splits a multi-line sequence into one stop string per line', () => {
        const stops = stopSequences({
            instruct: instruct({ stop_sequence: '</s>\n<|end|>' }),
            context: context(),
            userName: 'User',
            charName: 'Seraphina',
        });
        expect(stops).toContain('\n</s>');
        expect(stops).toContain('\n<|end|>');
    });

    it("stops the model writing the human's line", () => {
        const stops = stopSequences({
            instruct: instruct(),
            context: context({ names_as_stop_strings: true }),
            userName: 'Alice',
            charName: 'Seraphina',
        });
        expect(stops).toContain('\nAlice:');
        // The character's own name is only a stop string when turns are named;
        // otherwise it would cut a reply that merely mentions them.
        expect(stops).not.toContain('\nSeraphina:');
    });

    it('resolves an innermost conditional before the one wrapping it', () => {
        // Not exercised by the bundled corpus, which never nests.
        const template = '{{#if a}}<{{#if b}}{{b}}{{/if}}|{{#if c}}{{c}}{{/if}}>{{/if}}';
        expect(renderStoryString(template, { a: 'y', b: 'B', c: 'C' })).toBe('<B|C>');
        expect(renderStoryString(template, { a: 'y', c: 'C' })).toBe('<|C>');
    });

    it('adds the character name too when turns are named', () => {
        const stops = stopSequences({
            instruct: instruct({ names_behavior: 'always' }),
            context: context({ names_as_stop_strings: true }),
            userName: 'Alice',
            charName: 'Seraphina',
        });
        expect(stops).toContain('\nSeraphina:');
    });

    it('adds the context markers only when asked', () => {
        const withStrings = stopSequences({
            instruct: instruct(),
            context: context({ use_stop_strings: true, chat_start: '***', example_separator: 'EXAMPLES' }),
            userName: 'User',
            charName: 'Seraphina',
        });
        expect(withStrings).toContain('\n***');
        expect(withStrings).toContain('\nEXAMPLES');
    });

    it('appends the user\'s own stop strings and drops empties', () => {
        const stops = stopSequences({
            instruct: instruct(),
            context: context({ names_as_stop_strings: false }),
            userName: 'User',
            charName: 'Seraphina',
            custom: ['STOP', ''],
        });
        expect(stops).toContain('STOP');
        expect(stops).not.toContain('');
    });

    it('de-duplicates', () => {
        const stops = stopSequences({
            instruct: instruct({ stop_sequence: '</s>' }),
            context: context({ names_as_stop_strings: false }),
            userName: 'User',
            charName: 'Seraphina',
            custom: ['\n</s>'],
        });
        expect(stops.filter((value) => value === '\n</s>')).toHaveLength(1);
    });
});

describe('buildTextPrompt', () => {
    const base = {
        instructEnabled: true,
        instruct: CHATML,
        context: CHATML_CONTEXT,
        story: { description: 'A tall elf with silver hair.' },
        examples: [],
        turns: [
            { role: 'user' as const, name: 'User', content: 'Hello?' },
            { role: 'assistant' as const, name: 'Seraphina', content: 'Hello.' },
        ],
        userName: 'User',
        charName: 'Seraphina',
    };

    it('puts the definition first and the handover last', () => {
        const { prompt } = buildTextPrompt(base);
        expect(prompt.indexOf('A tall elf')).toBeLessThan(prompt.indexOf('Hello?'));
        // Trailing newline included — see finalTurnLine above.
        expect(prompt.endsWith('<|im_start|>assistant\n')).toBe(true);
    });

    it('wraps the definition in the story-string sequences', () => {
        const { prompt } = buildTextPrompt(base);
        expect(prompt.startsWith('<|im_start|>system\nA tall elf')).toBe(true);
    });

    it('omits the definition block entirely when every slot is empty', () => {
        const { prompt } = buildTextPrompt({ ...base, story: {} });
        expect(prompt).not.toContain('<|im_start|>system');
    });

    it('heads each example block with <START> in instruct mode', () => {
        // Not the context template's separator: that is prose written for a
        // plain-completion prompt, and inside instruct markers it reads as
        // part of the conversation. `parseMesExamples` makes the same choice.
        const { prompt } = buildTextPrompt({
            ...base,
            context: context({ ...CHATML_CONTEXT, example_separator: 'EXAMPLES' }),
            examples: ['User: hi\nSeraphina: hello'],
        });
        expect(prompt).toContain('<START>\nUser: hi\nSeraphina: hello\n');
        expect(prompt).not.toContain('EXAMPLES');
    });

    it('inserts the chat-start marker between the definition and the chat', () => {
        const { prompt } = buildTextPrompt({
            ...base,
            context: context({ ...CHATML_CONTEXT, chat_start: '***' }),
        });
        expect(prompt.indexOf('A tall elf')).toBeLessThan(prompt.indexOf('***'));
        expect(prompt.indexOf('***')).toBeLessThan(prompt.indexOf('Hello?'));
    });

    it('ignores always_force_name2 in instruct mode, where the sequence is the handover', () => {
        // The classic UI gates the forced name on `!isInstruct`; appending a
        // name after `<|im_start|>assistant` would corrupt the turn.
        const { prompt } = buildTextPrompt({
            ...base,
            context: context({ ...CHATML_CONTEXT, always_force_name2: true }),
        });
        expect(prompt.endsWith('<|im_start|>assistant\n')).toBe(true);
        expect(prompt).not.toContain('assistant\nSeraphina:');
    });

    it('adds nothing between blocks beyond what the templates define', () => {
        // Every block carries its own terminator and they are concatenated
        // with nothing between them, exactly as `getCombinedPrompt` does with
        // `.join('')`. Adding a separator as well would put a blank line
        // between each pair — wasted context, and a deviation for any template
        // whose markers are newline-sensitive. Pinned as an exact string
        // because a `toContain` assertion cannot see an extra newline.
        const { prompt } = buildTextPrompt(base);
        expect(prompt).toBe(
            '<|im_start|>system\nA tall elf with silver hair.<|im_end|>\n'
            + '<|im_start|>user\nHello?<|im_end|>\n'
            + '<|im_start|>assistant\nHello.<|im_end|>\n'
            + '\n<|im_start|>assistant\n',
        );
    });

    it('reproduces Alpaca exactly, blank lines included', () => {
        // Alpaca's own `story_string_suffix` and `output_suffix` are both
        // "\n\n", so the blank lines here are the template author's intent
        // and not slack in the assembly. Pinned so a future tidy-up cannot
        // quietly "fix" them.
        const alpaca = normalizeInstruct(
            INSTRUCT_TEMPLATES.find((t) => (t as { name: string }).name === 'Alpaca'),
        );
        const alpacaContext = normalizeContext(
            CONTEXT_TEMPLATES.find((t) => (t as { name: string }).name === 'Alpaca'),
        );
        const { prompt } = buildTextPrompt({
            ...base,
            instruct: alpaca,
            context: alpacaContext,
            story: { description: 'A tall elf.' },
        });
        expect(prompt).toBe(
            'A tall elf.\n\n'
            + '### Instruction:\nHello?\n\n'
            + '### Response:\nHello.\n\n'
            + '\n### Response:\n',
        );
    });

    it('returns the stop strings alongside the prompt', () => {
        const { stop } = buildTextPrompt(base);
        expect(stop).toContain('\n<|im_end|>');
        expect(stop).toContain('\nUser:');
    });
});

describe('buildTextPrompt with instruct mode off', () => {
    const base = {
        instructEnabled: false,
        instruct: CHATML,
        context: context({ ...CHATML_CONTEXT, chat_start: '***', always_force_name2: true }),
        story: { description: 'A tall elf with silver hair.' },
        examples: [],
        turns: [
            { role: 'user' as const, name: 'User', content: 'Hello?' },
            { role: 'assistant' as const, name: 'Seraphina', content: 'Hello.' },
        ],
        userName: 'User',
        charName: 'Seraphina',
    };

    it('renders plain labelled dialogue with no instruct sequences', () => {
        const { prompt } = buildTextPrompt(base);
        expect(prompt).toBe(
            'A tall elf with silver hair.\n***\nUser: Hello?\nSeraphina: Hello.\nSeraphina:',
        );
    });

    it('heads example blocks with the context separator outside instruct mode', () => {
        // Here the separator is exactly right: the prompt is prose, so a line
        // of prose introducing the examples is what the model reads.
        const { prompt } = buildTextPrompt({
            ...base,
            context: context({ ...CHATML_CONTEXT, example_separator: 'EXAMPLES' }),
            examples: ['User: hi\nSeraphina: hello'],
        });
        expect(prompt).toContain('EXAMPLES\nUser: hi\nSeraphina: hello\n');
        expect(prompt).not.toContain('<START>');
    });

    it('leaves the definition block unwrapped', () => {
        const { prompt } = buildTextPrompt(base);
        expect(prompt).not.toContain('<|im_start|>');
    });

    it('hands the turn over with the character name', () => {
        expect(buildTextPrompt(base).prompt.endsWith('\nSeraphina:')).toBe(true);
    });

    it('omits the name when the context template does not ask for it', () => {
        const { prompt } = buildTextPrompt({
            ...base,
            context: context({ ...CHATML_CONTEXT, always_force_name2: false }),
        });
        expect(prompt.endsWith('Seraphina: Hello.\n')).toBe(true);
    });

    it('drops the instruct sequences from the stop strings', () => {
        const { stop } = buildTextPrompt(base);
        expect(stop).not.toContain('\n<|im_end|>');
        // Both speakers' labels still stop it, since the turns are labelled.
        expect(stop).toContain('\nUser:');
        expect(stop).toContain('\nSeraphina:');
    });

    it('renders an unnamed turn as bare text', () => {
        const { prompt } = buildTextPrompt({
            ...base,
            turns: [{ role: 'system', name: '', content: 'A note.' }],
        });
        expect(prompt).toContain('\nA note.\n');
    });
});

describe('turnFromMessage', () => {
    function message(patch: Partial<ChatMessage> = {}): ChatMessage {
        return { name: 'Seraphina', is_user: false, mes: 'text', ...patch };
    }

    it('reads the role off the message flags', () => {
        expect(turnFromMessage(message(), 'x').role).toBe('assistant');
        expect(turnFromMessage(message({ is_user: true }), 'x').role).toBe('user');
        expect(turnFromMessage(message({ is_system: true }), 'x').role).toBe('system');
    });

    it('takes the text it is given rather than the stored message', () => {
        // The caller resolves the active swipe; this must not second-guess it.
        expect(turnFromMessage(message({ mes: 'stored' }), 'active').content).toBe('active');
    });
});
