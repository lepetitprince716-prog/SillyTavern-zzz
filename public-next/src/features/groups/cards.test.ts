import { describe, expect, it } from 'vitest';
import type { Character } from '@/api/types';
import {
    DEFAULT_JOIN_PREFIX,
    groupCharacterFor,
    joinMemberCards,
    membersForPrompt,
} from './cards';

function character(name: string, patch: Partial<Character> = {}): Character {
    return {
        avatar: `${name.toLowerCase()}.png`,
        name,
        description: `${name} is a person.`,
        personality: `${name} is cheerful.`,
        scenario: `${name} is here.`,
        mes_example: `<START>\n${name}: hello`,
        ...patch,
    };
}

describe('joinMemberCards', () => {
    it('attributes each block by default', () => {
        // The classic wrappers default to empty strings, so the joined
        // description is three paragraphs about three people with nothing
        // saying which is which.
        const joined = joinMemberCards([character('Alice'), character('Bob')]);
        expect(joined.description).toBe(
            'Alice\'s description:\nAlice is a person.\n\nBob\'s description:\nBob is a person.\n',
        );
    });

    it('names the field in the wrapper', () => {
        const joined = joinMemberCards([character('Alice')]);
        expect(joined.personality).toContain('Alice\'s personality:');
        expect(joined.scenario).toContain('Alice\'s scenario:');
        expect(joined.mesExample).toContain('Alice\'s example dialogue:');
    });

    it('respects an explicit wrapper from the group file', () => {
        const joined = joinMemberCards([character('Alice')], {
            prefix: '## {{char}} — <FIELDNAME>\n',
            suffix: '\n---\n',
        });
        expect(joined.description).toBe('## Alice — description\nAlice is a person.\n---\n');
    });

    it('treats an empty wrapper as a deliberate choice, not a missing one', () => {
        // Otherwise a user who wants no attribution could not have it.
        const joined = joinMemberCards([character('Alice'), character('Bob')], {
            prefix: '',
            suffix: '',
        });
        expect(joined.description).toBe('Alice is a person.\nBob is a person.');
    });

    it('leaves out a member whose field is empty rather than emitting a bare heading', () => {
        const joined = joinMemberCards([
            character('Alice'),
            character('Bob', { description: '   ', data: undefined }),
        ]);
        expect(joined.description).toContain('Alice');
        expect(joined.description).not.toContain('Bob\'s description');
    });

    it('prefers the V2 data block over the legacy field', () => {
        const joined = joinMemberCards([
            character('Alice', { description: 'legacy', data: { description: 'from v2' } }),
        ]);
        expect(joined.description).toContain('from v2');
        expect(joined.description).not.toContain('legacy');
    });

    it('is empty for no members', () => {
        expect(joinMemberCards([])).toEqual({
            description: '',
            personality: '',
            scenario: '',
            mesExample: '',
        });
    });

    it('uses the same placeholders the classic wrappers do', () => {
        expect(DEFAULT_JOIN_PREFIX).toContain('{{char}}');
        expect(DEFAULT_JOIN_PREFIX).toContain('<FIELDNAME>');
    });
});

describe('groupCharacterFor', () => {
    const alice = character('Alice');
    const bob = character('Bob');

    it('returns the speaker untouched when no cards are joined', () => {
        // Swap mode: the model plays one character and the rest are history.
        expect(groupCharacterFor(alice, [])).toBe(alice);
    });

    it('keeps the speaker\'s identity while joining the cards', () => {
        const built = groupCharacterFor(alice, [alice, bob]);
        // The model answers *as* Alice, whatever else it was told about.
        expect(built.name).toBe('Alice');
        expect(built.avatar).toBe('alice.png');
        expect(built.description).toContain('Alice is a person.');
        expect(built.description).toContain('Bob is a person.');
    });

    it('writes the joined fields into both the V2 block and the legacy fields', () => {
        // Readers disagree about which to prefer, so both have to agree.
        const built = groupCharacterFor(alice, [alice, bob]);
        expect(built.data?.description).toBe(built.description);
        expect(built.data?.personality).toBe(built.personality);
        expect(built.data?.mes_example).toBe(built.mes_example);
    });

    it('leaves the speaker\'s greeting alone', () => {
        const withGreeting = character('Alice', { first_mes: 'Alice waves.' });
        const built = groupCharacterFor(withGreeting, [withGreeting, bob]);
        expect(built.first_mes).toBe('Alice waves.');
    });
});

describe('membersForPrompt', () => {
    const alice = character('Alice');
    const bob = character('Bob');
    const cara = character('Cara');
    const members = [alice, bob, cara];

    it('sends nobody\'s card in swap mode', () => {
        expect(membersForPrompt({ mode: 'swap', members, disabled: [], speaker: alice })).toEqual([]);
    });

    it('sends the enabled members in join mode', () => {
        const result = membersForPrompt({
            mode: 'join',
            members,
            disabled: ['bob.png'],
            speaker: alice,
        });
        expect(result.map((member) => member.name)).toEqual(['Alice', 'Cara']);
    });

    it('sends everyone in joinAll, which is what keeps a silenced character present', () => {
        const result = membersForPrompt({
            mode: 'joinAll',
            members,
            disabled: ['bob.png'],
            speaker: alice,
        });
        expect(result.map((member) => member.name)).toEqual(['Alice', 'Bob', 'Cara']);
    });

    it('always includes the speaker, even when they are disabled', () => {
        // They are the one replying; describing everyone but them would be
        // worse than describing nobody.
        const result = membersForPrompt({
            mode: 'join',
            members,
            disabled: ['bob.png'],
            speaker: bob,
        });
        expect(result.map((member) => member.name)).toEqual(['Alice', 'Bob', 'Cara']);
    });
});
