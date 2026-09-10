import { describe, expect, it } from 'vitest';
import type { Character, ChatMessage } from '@/api/types';
import type { PromptSettings } from '@/store/session';
import { activeMessageText, buildPrompt, selectHistory, splitExamples } from './prompt';

const character: Character = {
    avatar: 'Seraphina.png',
    name: 'Seraphina',
    data: {
        description: 'A guardian of the forest who watches over {{user}}.',
        personality: 'Warm, protective, a little formal.',
        scenario: 'The glade at dusk.',
        first_mes: 'Welcome, traveller.',
        mes_example: '<START>\n{{user}}: Hello.\n{{char}}: Well met.',
    },
};

const settings: PromptSettings = {
    systemPrompt: 'Play {{char}} talking to {{user}}.',
    jailbreak: '',
    includeExamples: false,
    historyDepth: 0,
};

function message(text: string, isUser: boolean, extra: Partial<ChatMessage> = {}): ChatMessage {
    return { name: isUser ? 'Alex' : 'Seraphina', is_user: isUser, mes: text, ...extra };
}

const options = { character, userName: 'Alex', messages: [] as ChatMessage[], settings };

describe('activeMessageText', () => {
    it('falls back to `mes` when there are no swipes', () => {
        expect(activeMessageText(message('hello', false))).toBe('hello');
    });

    it('returns the selected swipe', () => {
        const withSwipes = message('first', false, { swipes: ['first', 'second'], swipe_id: 1 });
        expect(activeMessageText(withSwipes)).toBe('second');
    });

    it('falls back to the first swipe when the index is out of range', () => {
        const withSwipes = message('first', false, { swipes: ['first'], swipe_id: 7 });
        expect(activeMessageText(withSwipes)).toBe('first');
    });
});

describe('splitExamples', () => {
    it('splits on the START separator', () => {
        expect(splitExamples('<START>\nA\n<START>\nB')).toEqual(['A', 'B']);
    });

    it('returns nothing for empty example text', () => {
        expect(splitExamples('   ')).toEqual([]);
    });
});

describe('selectHistory', () => {
    const history = [message('a', true), message('b', false), message('c', true)];

    it('keeps everything when depth is 0', () => {
        expect(selectHistory(history, 0)).toHaveLength(3);
    });

    it('keeps only the most recent messages when depth is set', () => {
        expect(selectHistory(history, 2).map((m) => m.mes)).toEqual(['b', 'c']);
    });

    it('drops system messages', () => {
        const withSystem = [...history, message('note', false, { is_system: true })];
        expect(selectHistory(withSystem, 0)).toHaveLength(3);
    });
});

describe('buildPrompt', () => {
    it('opens with a system block containing the card definition', () => {
        const prompt = buildPrompt(options);
        expect(prompt[0]?.role).toBe('system');
        expect(prompt[0]?.content).toContain('Play Seraphina talking to Alex.');
        expect(prompt[0]?.content).toContain('A guardian of the forest who watches over Alex.');
        expect(prompt[0]?.content).toContain('Warm, protective');
        expect(prompt[0]?.content).toContain('The glade at dusk.');
    });

    it('maps history onto user and assistant roles', () => {
        const prompt = buildPrompt({
            ...options,
            messages: [message('Hi there', true), message('Well met.', false)],
        });
        expect(prompt.slice(1)).toEqual([
            { role: 'user', content: 'Hi there' },
            { role: 'assistant', content: 'Well met.' },
        ]);
    });

    it('uses the selected swipe for history text', () => {
        const prompt = buildPrompt({
            ...options,
            messages: [message('old', false, { swipes: ['old', 'new'], swipe_id: 1 })],
        });
        expect(prompt.at(-1)?.content).toBe('new');
    });

    it('lets a card system_prompt override the user default', () => {
        const prompt = buildPrompt({
            ...options,
            character: { ...character, data: { ...character.data, system_prompt: 'Card rules win.' } },
        });
        expect(prompt[0]?.content).toContain('Card rules win.');
        expect(prompt[0]?.content).not.toContain('Play Seraphina');
    });

    it('includes example dialogue only when asked', () => {
        const without = buildPrompt(options);
        expect(without.some((m) => m.content.includes('Example conversations'))).toBe(false);

        const withExamples = buildPrompt({
            ...options,
            settings: { ...settings, includeExamples: true },
        });
        const examples = withExamples.find((m) => m.content.includes('Example conversations'));
        expect(examples?.content).toContain('Alex: Hello.');
        expect(examples?.content).toContain('Seraphina: Well met.');
    });

    it('appends the jailbreak after the history', () => {
        const prompt = buildPrompt({
            ...options,
            messages: [message('Hi', true)],
            settings: { ...settings, jailbreak: 'Stay in character as {{char}}.' },
        });
        expect(prompt.at(-1)).toEqual({
            role: 'system',
            content: 'Stay in character as Seraphina.',
        });
    });

    it('appends post-history instructions from the card', () => {
        const prompt = buildPrompt({
            ...options,
            character: {
                ...character,
                data: { ...character.data, post_history_instructions: 'Reply in one paragraph.' },
            },
        });
        expect(prompt.at(-1)?.content).toBe('Reply in one paragraph.');
    });

    it('includes the persona description', () => {
        const prompt = buildPrompt({ ...options, personaDescription: 'A weary cartographer.' });
        expect(prompt[0]?.content).toContain("Alex's persona:\nA weary cartographer.");
    });

    it('skips messages that are empty after substitution', () => {
        const prompt = buildPrompt({ ...options, messages: [message('   ', true), message('real', false)] });
        expect(prompt.filter((m) => m.role !== 'system')).toEqual([
            { role: 'assistant', content: 'real' },
        ]);
    });

    it('falls back to legacy root fields when the card has no data block', () => {
        const legacy: Character = {
            avatar: 'Old.png',
            name: 'Old',
            description: 'Legacy description.',
        };
        const prompt = buildPrompt({ ...options, character: legacy });
        expect(prompt[0]?.content).toContain('Legacy description.');
    });
});
