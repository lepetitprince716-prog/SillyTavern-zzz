import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/api/types';
import { portraitPrompt, promptFromProse, promptSuggestions } from './prompts';

function message(patch: Partial<ChatMessage> = {}): ChatMessage {
    return { name: 'Seraphina', is_user: false, mes: '', ...patch };
}

describe('promptFromProse', () => {
    it('strips the markdown a diffusion model would read as weights', () => {
        expect(promptFromProse('*She turns slowly*, her **eyes** bright')).toBe(
            'She turns slowly, her eyes bright',
        );
    });

    it('drops dialogue quotes', () => {
        expect(promptFromProse('"Come in," she says')).toBe('Come in, she says');
        expect(promptFromProse('“Come in,” she says')).toBe('Come in, she says');
    });

    it('removes code, which never describes a scene', () => {
        expect(promptFromProse('a cat ```const x = 1``` on a mat')).toBe('a cat on a mat');
        expect(promptFromProse('a `cat` on a mat')).toBe('a on a mat');
    });

    it('keeps a link label and drops its target', () => {
        expect(promptFromProse('see [the garden](https://example.com/a)')).toBe('see the garden');
    });

    it('collapses the whitespace left behind', () => {
        expect(promptFromProse('a   cat\n\non   a  mat')).toBe('a cat on a mat');
    });

    it('is empty for text that was only markup', () => {
        expect(promptFromProse('***')).toBe('');
        expect(promptFromProse('   ')).toBe('');
    });

    it('cuts a long passage at a sentence end', () => {
        const sentence = 'The fox walks through the tall grass. ';
        const prompt = promptFromProse(sentence.repeat(40));
        expect(prompt.length).toBeLessThanOrEqual(480);
        expect(prompt.endsWith('.')).toBe(true);
    });

    it('still bounds a long passage with no sentence break', () => {
        const prompt = promptFromProse('fox '.repeat(400));
        expect(prompt.length).toBeLessThanOrEqual(480);
    });

    it('cuts CJK prose at its own full stop', () => {
        const prompt = promptFromProse('狐狸走过草地。'.repeat(120));
        expect(prompt.length).toBeLessThanOrEqual(480);
        expect(prompt.endsWith('。')).toBe(true);
    });
});

describe('portraitPrompt', () => {
    it('leads with the character name', () => {
        expect(portraitPrompt({ name: 'Seraphina' })).toBe('portrait of Seraphina');
    });

    it('adds the opening sentences of the description', () => {
        const prompt = portraitPrompt({
            name: 'Seraphina',
            description: 'A tall elf with silver hair. She wears green robes. '
                + 'Once she guarded the forest. Long ago, before the war, her people lived here.',
        });
        expect(prompt).toContain('portrait of Seraphina');
        expect(prompt).toContain('silver hair');
        // Backstory past the third sentence describes nothing visible.
        expect(prompt).not.toContain('before the war');
    });

    it('prefers the V2 data block over the legacy field', () => {
        const prompt = portraitPrompt({
            name: 'Seraphina',
            description: 'legacy text',
            data: { description: 'a fox girl with orange hair' },
        });
        expect(prompt).toContain('orange hair');
        expect(prompt).not.toContain('legacy');
    });
});

describe('promptSuggestions', () => {
    const character = { name: 'Seraphina', description: 'A tall elf with silver hair.' };

    it('offers nothing for an empty chat and no character', () => {
        expect(promptSuggestions(null, [], -1)).toEqual([]);
    });

    it('offers the message being illustrated first', () => {
        const messages = [message({ mes: 'first' }), message({ mes: '*she smiles*' })];
        const suggestions = promptSuggestions(character, messages, 1);
        expect(suggestions[0]).toEqual({ label: 'This message', prompt: 'she smiles' });
    });

    it('reads the selected swipe rather than the stored text', () => {
        const messages = [message({ mes: 'old', swipes: ['old', 'the chosen one'], swipe_id: 1 })];
        expect(promptSuggestions(null, messages, 0)[0]?.prompt).toBe('the chosen one');
    });

    it('does not offer the same message twice', () => {
        const messages = [message({ mes: 'only reply' })];
        const labels = promptSuggestions(null, messages, 0).map((entry) => entry.label);
        expect(labels).toEqual(['This message']);
    });

    it('offers the latest reply when illustrating nothing in particular', () => {
        const messages = [
            message({ mes: 'a reply' }),
            message({ mes: 'a question', is_user: true }),
        ];
        const labels = promptSuggestions(null, messages, -1).map((entry) => entry.label);
        // The user's own message is not a scene description.
        expect(labels).toEqual(['Latest reply']);
    });

    it('always offers the character portrait', () => {
        const suggestions = promptSuggestions(character, [], -1);
        expect(suggestions).toEqual([
            { label: 'Portrait of Seraphina', prompt: 'portrait of Seraphina, A tall elf with silver hair.' },
        ]);
    });

    it('skips a message whose text reduces to nothing', () => {
        const messages = [message({ mes: '***' })];
        expect(promptSuggestions(null, messages, 0)).toEqual([]);
    });
});
