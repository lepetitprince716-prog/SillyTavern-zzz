import { describe, expect, it } from 'vitest';
import {
    characterToDraft,
    draftToPayload,
    EMPTY_DRAFT,
    importFormatForFile,
    type CharacterDraft,
} from './character-edit';
import type { Character } from './types';

const card: Character = {
    avatar: 'Seraphina.png',
    name: 'Seraphina',
    chat: 'Seraphina - 2026-09-10@00h00m00s',
    create_date: '2026-01-01T00:00:00.000Z',
    fav: 'true',
    tags: ['legacy-tag'],
    json_data: '{"spec":"chara_card_v2","data":{"extensions":{"third_party":{"keep":1}}}}',
    data: {
        name: 'Seraphina',
        description: 'A guardian.',
        personality: 'Warm.',
        scenario: 'A glade.',
        first_mes: 'Welcome.',
        mes_example: '<START>\nhi',
        creator_notes: 'Be gentle.',
        system_prompt: 'Card rules.',
        post_history_instructions: 'One paragraph.',
        alternate_greetings: ['Another hello.'],
        tags: ['fantasy'],
        creator: 'OtisAlejandro',
        character_version: '1.0.0',
        extensions: {
            talkativeness: 0.7,
            world: 'Forest lore',
            depth_prompt: { prompt: 'Remember the forest.', depth: 2, role: 'user' },
        },
    },
};

describe('characterToDraft', () => {
    it('reads the V2 data block', () => {
        const draft = characterToDraft(card);
        expect(draft.name).toBe('Seraphina');
        expect(draft.description).toBe('A guardian.');
        expect(draft.systemPrompt).toBe('Card rules.');
        expect(draft.postHistoryInstructions).toBe('One paragraph.');
        expect(draft.alternateGreetings).toEqual(['Another hello.']);
        expect(draft.creator).toBe('OtisAlejandro');
        expect(draft.characterVersion).toBe('1.0.0');
    });

    it('merges legacy and V2 tags without duplicates', () => {
        const draft = characterToDraft(card);
        expect(draft.tags.sort()).toEqual(['fantasy', 'legacy-tag']);
    });

    it('reads extension fields', () => {
        const draft = characterToDraft(card);
        expect(draft.talkativeness).toBe(0.7);
        expect(draft.world).toBe('Forest lore');
        expect(draft.depthPromptText).toBe('Remember the forest.');
        expect(draft.depthPromptDepth).toBe(2);
        expect(draft.depthPromptRole).toBe('user');
    });

    it('treats the string "true" as a favourite', () => {
        expect(characterToDraft(card).favourite).toBe(true);
        expect(characterToDraft({ ...card, fav: false }).favourite).toBe(false);
        expect(characterToDraft({ ...card, fav: true }).favourite).toBe(true);
    });

    it('falls back to legacy root fields with no data block', () => {
        const legacy: Character = {
            avatar: 'Old.png',
            name: 'Old',
            description: 'Legacy description.',
            first_mes: 'Legacy greeting.',
        };
        const draft = characterToDraft(legacy);
        expect(draft.description).toBe('Legacy description.');
        expect(draft.firstMessage).toBe('Legacy greeting.');
        expect(draft.talkativeness).toBe(0.5);
        expect(draft.depthPromptDepth).toBe(4);
        expect(draft.depthPromptRole).toBe('system');
    });

    it('does not share the greetings array with the card', () => {
        const draft = characterToDraft(card);
        draft.alternateGreetings.push('mutated');
        expect(card.data?.alternate_greetings).toEqual(['Another hello.']);
    });

    it('coerces an unusable talkativeness to the default', () => {
        const broken: Character = {
            avatar: 'x.png',
            name: 'x',
            data: { extensions: { talkativeness: 'not a number' } },
        };
        expect(characterToDraft(broken).talkativeness).toBe(0.5);
    });

    it('coerces an unknown depth prompt role to system', () => {
        const broken: Character = {
            avatar: 'x.png',
            name: 'x',
            data: { extensions: { depth_prompt: { role: 'nonsense' } } },
        };
        expect(characterToDraft(broken).depthPromptRole).toBe('system');
    });
});

describe('draftToPayload', () => {
    const draft: CharacterDraft = { ...EMPTY_DRAFT, name: '  Seraphina  ', description: 'A guardian.' };

    it('maps to the snake_case names the server expects', () => {
        const payload = draftToPayload(draft);
        expect(payload.ch_name).toBe('Seraphina');
        expect(payload.description).toBe('A guardian.');
        expect(payload).toHaveProperty('first_mes');
        expect(payload).toHaveProperty('mes_example');
        expect(payload).toHaveProperty('post_history_instructions');
        expect(payload).toHaveProperty('depth_prompt_prompt');
    });

    it('sends fav as the string the server compares against', () => {
        expect(draftToPayload({ ...draft, favourite: true }).fav).toBe('true');
        expect(draftToPayload({ ...draft, favourite: false }).fav).toBe('false');
    });

    it('drops blank tags and greetings', () => {
        const payload = draftToPayload({
            ...draft,
            tags: [' fantasy ', '', '   '],
            alternateGreetings: ['Hello.', '  '],
        });
        expect(payload.tags).toEqual(['fantasy']);
        expect(payload.alternate_greetings).toEqual(['Hello.']);
    });

    it('omits card identity for a create', () => {
        const payload = draftToPayload(draft);
        expect(payload).not.toHaveProperty('avatar_url');
        expect(payload).not.toHaveProperty('json_data');
        expect(payload).not.toHaveProperty('chat');
    });

    it('round-trips json_data on an edit so unknown fields survive', () => {
        const payload = draftToPayload(draft, card);
        expect(payload.json_data).toBe(card.json_data);
        expect(payload.avatar_url).toBe('Seraphina.png');
    });

    it('preserves the current chat and creation date on an edit', () => {
        const payload = draftToPayload(draft, card);
        expect(payload.chat).toBe('Seraphina - 2026-09-10@00h00m00s');
        expect(payload.create_date).toBe('2026-01-01T00:00:00.000Z');
    });

    it('sends empty strings rather than undefined when the card lacks them', () => {
        const bare: Character = { avatar: 'a.png', name: 'a' };
        const payload = draftToPayload(draft, bare);
        expect(payload.chat).toBe('');
        expect(payload.create_date).toBe('');
        expect(payload).not.toHaveProperty('json_data');
    });

    it('survives a full round trip through draft and payload', () => {
        const payload = draftToPayload(characterToDraft(card), card);
        expect(payload.ch_name).toBe('Seraphina');
        expect(payload.system_prompt).toBe('Card rules.');
        expect(payload.world).toBe('Forest lore');
        expect(payload.depth_prompt_depth).toBe(2);
        expect(payload.depth_prompt_role).toBe('user');
        expect(payload.talkativeness).toBe(0.7);
        expect(payload.json_data).toBe(card.json_data);
    });
});

describe('importFormatForFile', () => {
    it('recognises the supported card formats', () => {
        expect(importFormatForFile('card.png')).toBe('png');
        expect(importFormatForFile('card.JSON')).toBe('json');
        expect(importFormatForFile('card.yaml')).toBe('yaml');
        expect(importFormatForFile('card.yml')).toBe('yml');
        expect(importFormatForFile('card.charx')).toBe('charx');
        expect(importFormatForFile('card.byaf')).toBe('byaf');
    });

    it('rejects anything else', () => {
        expect(importFormatForFile('notes.txt')).toBeNull();
        expect(importFormatForFile('noextension')).toBeNull();
    });
});
