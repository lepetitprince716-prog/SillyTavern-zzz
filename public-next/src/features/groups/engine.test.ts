import { describe, expect, it } from 'vitest';
import type { Character, ChatMessage } from '@/api/types';
import {
    activationFromNumber,
    explainDecision,
    findMentions,
    generationModeFromNumber,
    isMentioned,
    planTurn,
    spokenSinceUser,
    type PlanTurnOptions,
} from './engine';

function character(name: string, talkativeness?: number): Character {
    return {
        avatar: `${name.toLowerCase().replace(/\s+/g, '-')}.png`,
        name,
        ...(talkativeness === undefined ? {} : { talkativeness }),
    };
}

function reply(name: string, avatar: string): ChatMessage {
    return { name, is_user: false, mes: 'said something', original_avatar: avatar };
}

function userSaid(text: string): ChatMessage {
    return { name: 'User', is_user: true, mes: text };
}

/** A sequence of rolls, so a turn is reproducible. */
function rolls(...values: number[]): () => number {
    let index = 0;
    return () => values[index++] ?? 0;
}

function plan(patch: Partial<PlanTurnOptions> = {}) {
    return planTurn({
        members: [character('Alice', 1), character('Bob', 1)],
        disabled: [],
        strategy: 'natural',
        messages: [],
        allowSelfResponses: false,
        random: rolls(0, 0),
        ...patch,
    });
}

describe('activationFromNumber', () => {
    it('reads the integer the group file stores', () => {
        expect(activationFromNumber(0)).toBe('natural');
        expect(activationFromNumber(1)).toBe('list');
        expect(activationFromNumber(2)).toBe('manual');
        expect(activationFromNumber(3)).toBe('pooled');
    });

    it('falls back rather than producing a strategy that does not exist', () => {
        expect(activationFromNumber(undefined)).toBe('natural');
        expect(activationFromNumber(99)).toBe('natural');
        expect(activationFromNumber('nonsense')).toBe('natural');
    });
});

describe('generationModeFromNumber', () => {
    it('reads the integer the group file stores', () => {
        expect(generationModeFromNumber(0)).toBe('swap');
        expect(generationModeFromNumber(1)).toBe('join');
        expect(generationModeFromNumber(2)).toBe('joinAll');
        expect(generationModeFromNumber(undefined)).toBe('swap');
    });
});

describe('isMentioned', () => {
    it('matches a whole name', () => {
        expect(isMentioned('Alice, what do you think?', 'Alice')).toBe(true);
    });

    it('is case insensitive', () => {
        expect(isMentioned('ALICE!', 'Alice')).toBe(true);
    });

    it('does not match a name inside a longer word', () => {
        // Otherwise "Ali" would answer whenever anyone said "alias".
        expect(isMentioned('check the alias', 'Ali')).toBe(false);
        expect(isMentioned('a palisade', 'Ali')).toBe(false);
    });

    it('matches a name next to punctuation', () => {
        expect(isMentioned('(Alice)', 'Alice')).toBe(true);
        expect(isMentioned('"Alice?"', 'Alice')).toBe(true);
        expect(isMentioned('Alice—wait', 'Alice')).toBe(true);
    });

    it('matches a Chinese name, which the classic engine cannot', () => {
        // `extractAllWords` matches /\b\w+\b/, and `\w` is [A-Za-z0-9_], so a
        // CJK name produces an empty word list there and naming the character
        // has no effect at all.
        expect(isMentioned('小明，你怎么看？', '小明')).toBe(true);
        expect(isMentioned('你怎么看？', '小明')).toBe(false);
    });

    it('matches Japanese and Korean names', () => {
        expect(isMentioned('さくら、おはよう', 'さくら')).toBe(true);
        expect(isMentioned('민준아 안녕', '민준')).toBe(true);
    });

    it('matches a Cyrillic name, and respects its boundaries', () => {
        expect(isMentioned('Аня, привет', 'Аня')).toBe(true);
        // `\b` is defined against `\w`, so the classic pattern would fire in
        // the middle of a Cyrillic word.
        expect(isMentioned('Анянский', 'Аня')).toBe(false);
    });

    it('matches an accented name without breaking on the accent', () => {
        expect(isMentioned('Zoë, over here', 'Zoë')).toBe(true);
        expect(isMentioned('Zoëtrope', 'Zoë')).toBe(false);
    });

    it('is false for empty input either side', () => {
        expect(isMentioned('', 'Alice')).toBe(false);
        expect(isMentioned('Alice', '')).toBe(false);
        expect(isMentioned('Alice', '   ')).toBe(false);
    });

    it('does not treat a name as a regular expression', () => {
        expect(isMentioned('a.c', 'A.C')).toBe(true);
        expect(isMentioned('abc', 'A.C')).toBe(false);
    });
});

describe('findMentions', () => {
    const members = [
        { avatar: 'alice.png', name: 'Alice' },
        { avatar: 'alice-smith.png', name: 'Alice Smith' },
        { avatar: 'bob.png', name: 'Bob' },
    ];

    it('finds every member named, not just the first', () => {
        // The classic loop breaks after the first member matching a word, so
        // in this group saying either name activates whichever sits earlier in
        // the member list.
        const found = findMentions('Alice Smith, and Alice too', members);
        expect([...found.keys()].sort()).toEqual(['alice-smith.png', 'alice.png']);
    });

    it('prefers a full-name match over a name part', () => {
        const found = findMentions('Alice Smith, what do you think?', members);
        // "Alice" matches too, as a substring of the full name, and that is
        // correct — both are genuinely named. What must not happen is a *part*
        // match ("Smith") overriding it.
        expect(found.get('alice-smith.png')?.matched).toBe('Alice Smith');
    });

    it('falls back to a name part when no full name matched', () => {
        const found = findMentions('Smith, over here', members);
        expect(found.get('alice-smith.png')?.matched).toBe('Smith');
        expect(found.has('alice.png')).toBe(false);
    });

    it('ignores a one-letter name part, which would match everything', () => {
        const found = findMentions('a quiet room', [{ avatar: 'x.png', name: 'A Cooper' }]);
        expect(found.size).toBe(0);
    });

    it('is empty when nobody is named', () => {
        expect(findMentions('hello everyone', members).size).toBe(0);
        expect(findMentions('', members).size).toBe(0);
    });

    it('records where each name was found', () => {
        const found = findMentions('First Bob, then Alice', members);
        expect(found.get('bob.png')?.at).toBeLessThan(found.get('alice.png')?.at ?? 0);
    });
});

describe('spokenSinceUser', () => {
    it('is empty for a chat that ends with the user', () => {
        expect(spokenSinceUser([reply('Alice', 'a.png'), userSaid('hi')])).toEqual([]);
    });

    it('lists the replies after the last user message, newest first', () => {
        const messages = [
            reply('Alice', 'a.png'),
            userSaid('hi'),
            reply('Bob', 'b.png'),
            reply('Cara', 'c.png'),
        ];
        expect(spokenSinceUser(messages)).toEqual(['c.png', 'b.png']);
    });

    it('skips system messages, which are not a member speaking', () => {
        const messages = [
            userSaid('hi'),
            { name: 'System', is_user: false, is_system: true, mes: 'note' },
            reply('Bob', 'b.png'),
        ];
        expect(spokenSinceUser(messages)).toEqual(['b.png']);
    });

    it('ignores a reply with no recorded speaker', () => {
        const messages = [userSaid('hi'), { name: 'Bob', is_user: false, mes: 'hi' }];
        expect(spokenSinceUser(messages)).toEqual([]);
    });
});

describe('planTurn: everyone gets a decision', () => {
    it('accounts for every member, speaking or not', () => {
        const members = [character('Alice', 1), character('Bob', 0), character('Cara', 0)];
        const result = plan({ members, random: rolls(0.1, 0.9, 0.9) });
        expect(result.decisions).toHaveLength(3);
        // The count reconciles: no member is silently dropped.
        expect(result.decisions.filter((entry) => entry.speaking)).toHaveLength(
            result.speakers.length,
        );
    });

    it('reports the decisions in the group\'s own member order', () => {
        const members = [character('Cara'), character('Alice'), character('Bob')];
        const result = plan({ members, random: rolls(0, 0, 0) });
        expect(result.decisions.map((entry) => entry.name)).toEqual(['Cara', 'Alice', 'Bob']);
    });

    it('gives a disabled member a reason rather than omitting them', () => {
        const result = plan({ disabled: ['bob.png'] });
        const bob = result.decisions.find((entry) => entry.name === 'Bob');
        expect(bob).toMatchObject({ speaking: false, reason: 'disabled' });
    });

    it('explains every reason it can produce', () => {
        const reasons = [
            'mentioned', 'talkative', 'quiet', 'listed', 'pooled', 'spoke-recently',
            'back-to-back', 'disabled', 'not-asked', 'not-chosen', 'fallback', 'chosen',
        ] as const;
        for (const reason of reasons) {
            const text = explainDecision({
                avatar: 'a.png', name: 'Alice', speaking: false, reason, order: null,
                roll: 0.4, talkativeness: 0.5,
            });
            expect(text, reason).not.toBe('');
        }
    });
});

describe('planTurn: natural order', () => {
    it('activates a member who was named', () => {
        const result = plan({
            members: [character('Alice', 0), character('Bob', 0)],
            input: 'Bob, your turn',
            random: rolls(0.9, 0.9),
        });
        expect(result.speakers.map((entry) => entry.name)).toEqual(['Bob']);
        expect(result.speakers[0]?.reason).toBe('mentioned');
        expect(result.speakers[0]?.matched).toBe('Bob');
    });

    it('activates a Chinese-named member who was named', () => {
        const members = [character('小明'), character('Bob', 0)];
        const result = plan({
            members,
            input: '小明，你怎么看？',
            random: rolls(0.9, 0.9),
        });
        expect(result.speakers.map((entry) => entry.name)).toEqual(['小明']);
        expect(result.speakers[0]?.reason).toBe('mentioned');
    });

    it('rolls talkativeness for anyone not named, and records the numbers', () => {
        const members = [character('Alice', 0.8), character('Bob', 0.2)];
        const result = plan({ members, input: 'hello', random: rolls(0.5, 0.5) });
        const alice = result.decisions.find((entry) => entry.name === 'Alice');
        const bob = result.decisions.find((entry) => entry.name === 'Bob');
        expect(alice).toMatchObject({ speaking: true, reason: 'talkative', roll: 0.5, talkativeness: 0.8 });
        expect(bob).toMatchObject({ speaking: false, reason: 'quiet', roll: 0.5, talkativeness: 0.2 });
    });

    it('uses the classic default talkativeness for a card that states none', () => {
        const result = plan({
            members: [character('Alice')],
            input: 'hello',
            random: rolls(0.49),
        });
        expect(result.decisions[0]).toMatchObject({ speaking: true, talkativeness: 0.5 });
    });

    it('clamps a talkativeness outside 0..1 instead of trusting the card', () => {
        const result = plan({
            members: [character('Alice', 5), character('Bob', -3)],
            input: 'hello',
            random: rolls(0.99, 0.001),
        });
        expect(result.decisions[0]).toMatchObject({ talkativeness: 1, speaking: true });
        expect(result.decisions[1]).toMatchObject({ talkativeness: 0, speaking: false });
    });

    it('replies in a deliberate order, mentions first', () => {
        // The classic engine shuffles, so a deliberate exchange comes out in a
        // different order every turn for no stated reason.
        const members = [character('Alice', 1), character('Bob', 1), character('Cara', 1)];
        const result = plan({ members, input: 'Cara?', random: rolls(0, 0, 0) });
        expect(result.speakers.map((entry) => entry.name)).toEqual(['Cara', 'Alice', 'Bob']);
        expect(result.speakers.map((entry) => entry.order)).toEqual([0, 1, 2]);
    });

    it('orders several mentions by where they appear in the message', () => {
        // Their position in the member list has nothing to do with what was
        // said, so it must not decide who answers first.
        const members = [character('Alice', 0), character('Bob', 0), character('Cara', 0)];
        const result = plan({ members, input: 'Cara, then Bob', random: rolls(0.9, 0.9, 0.9) });
        expect(result.speakers.map((entry) => entry.name)).toEqual(['Cara', 'Bob']);
    });

    it('is reproducible from the same rolls', () => {
        const members = [character('Alice', 0.5), character('Bob', 0.5)];
        const once = planTurn({
            members, disabled: [], strategy: 'natural', messages: [],
            input: 'hello', allowSelfResponses: false, random: rolls(0.4, 0.6),
        });
        const twice = planTurn({
            members, disabled: [], strategy: 'natural', messages: [],
            input: 'hello', allowSelfResponses: false, random: rolls(0.4, 0.6),
        });
        expect(once).toEqual(twice);
    });
});

describe('planTurn: replying to yourself', () => {
    const members = [character('Alice', 1), character('Bob', 1)];

    it('blocks the member who spoke last from speaking again', () => {
        const result = plan({
            members,
            messages: [userSaid('hi'), reply('Alice', 'alice.png')],
            random: rolls(0, 0),
        });
        const alice = result.decisions.find((entry) => entry.name === 'Alice');
        expect(alice).toMatchObject({ speaking: false, reason: 'back-to-back' });
        expect(result.speakers.map((entry) => entry.name)).toEqual(['Bob']);
    });

    it('allows it when the group says so', () => {
        const result = plan({
            members,
            messages: [userSaid('hi'), reply('Alice', 'alice.png')],
            allowSelfResponses: true,
            random: rolls(0, 0),
        });
        expect(result.speakers.map((entry) => entry.name)).toEqual(['Alice', 'Bob']);
    });

    it('does not block anyone on a turn the user started', () => {
        // The user spoke last; nobody is replying to themselves.
        const result = plan({
            members,
            messages: [reply('Alice', 'alice.png'), userSaid('hi')],
            input: 'hi',
            random: rolls(0, 0),
        });
        expect(result.speakers.map((entry) => entry.name)).toEqual(['Alice', 'Bob']);
    });
});

describe('planTurn: list order', () => {
    it('activates every enabled member, in list order', () => {
        const members = [character('Alice'), character('Bob'), character('Cara')];
        const result = plan({ members, strategy: 'list', disabled: ['bob.png'] });
        expect(result.speakers.map((entry) => entry.name)).toEqual(['Alice', 'Cara']);
        expect(result.speakers.every((entry) => entry.reason === 'listed')).toBe(true);
    });

    it('ignores talkativeness entirely', () => {
        const members = [character('Alice', 0), character('Bob', 0)];
        const result = plan({ members, strategy: 'list' });
        expect(result.speakers).toHaveLength(2);
        expect(result.decisions.every((entry) => entry.roll === undefined)).toBe(true);
    });
});

describe('planTurn: manual', () => {
    it('activates nobody', () => {
        const result = plan({ strategy: 'manual' });
        expect(result.speakers).toEqual([]);
        expect(result.decisions.every((entry) => entry.reason === 'not-asked')).toBe(true);
    });

    it('still activates a member asked for by hand', () => {
        const result = plan({ strategy: 'manual', forceMember: 'bob.png' });
        expect(result.speakers.map((entry) => entry.name)).toEqual(['Bob']);
        expect(result.speakers[0]?.reason).toBe('chosen');
    });

    it('lets a hand-picked member override any strategy, disabled included', () => {
        const result = plan({
            strategy: 'natural',
            disabled: ['bob.png'],
            forceMember: 'bob.png',
        });
        expect(result.speakers.map((entry) => entry.name)).toEqual(['Bob']);
    });
});

describe('planTurn: picking one member by hand', () => {
    it('does not tell the others the group is manual', () => {
        // The trace is read next to the group's strategy, so reporting
        // `not-asked` here says "this group only replies when you pick
        // someone" about a group that in fact replies on its own.
        const result = plan({ strategy: 'natural', forceMember: 'bob.png' });
        const alice = result.decisions.find((entry) => entry.name === 'Alice');
        expect(alice).toMatchObject({ speaking: false, reason: 'not-chosen' });
        expect(explainDecision(alice!)).not.toMatch(/only replies/);
    });

    it('keeps `not-asked` for a group that really is manual', () => {
        const result = plan({ strategy: 'manual' });
        expect(result.decisions.every((entry) => entry.reason === 'not-asked')).toBe(true);
    });

    it('reports a switched-off member as switched off, not as passed over', () => {
        const members = [character('Alice'), character('Bob'), character('Cara')];
        const result = plan({ members, disabled: ['cara.png'], forceMember: 'bob.png' });
        const cara = result.decisions.find((entry) => entry.name === 'Cara');
        expect(cara).toMatchObject({ speaking: false, reason: 'disabled' });
    });

    it('still accounts for every member', () => {
        const members = [character('Alice'), character('Bob'), character('Cara')];
        const result = plan({ members, forceMember: 'bob.png' });
        expect(result.decisions).toHaveLength(3);
    });
});

describe('planTurn: pooled', () => {
    const members = [character('Alice'), character('Bob'), character('Cara')];

    it('picks someone who has not spoken since the user', () => {
        const result = plan({
            members,
            strategy: 'pooled',
            messages: [userSaid('hi'), reply('Alice', 'alice.png')],
            random: rolls(0),
        });
        // Alice spoke last, so she is blocked; Bob and Cara are waiting.
        expect(result.speakers).toHaveLength(1);
        expect(['Bob', 'Cara']).toContain(result.speakers[0]?.name);
        expect(result.speakers[0]?.reason).toBe('pooled');
    });

    it('tells the ones who already spoke why they are not speaking', () => {
        const result = plan({
            members,
            strategy: 'pooled',
            messages: [userSaid('hi'), reply('Alice', 'alice.png'), reply('Bob', 'bob.png')],
            random: rolls(0),
        });
        const alice = result.decisions.find((entry) => entry.name === 'Alice');
        expect(alice?.reason).toBe('spoke-recently');
        expect(result.speakers.map((entry) => entry.name)).toEqual(['Cara']);
    });

    it('starts a fresh pool on a turn the user began', () => {
        const result = plan({
            members,
            strategy: 'pooled',
            messages: [reply('Alice', 'alice.png'), userSaid('hi')],
            input: 'hi',
            random: rolls(0),
        });
        expect(result.speakers).toHaveLength(1);
        expect(result.speakers[0]?.name).toBe('Alice');
    });

    it('falls back when the pool has drained', () => {
        const result = plan({
            members,
            strategy: 'pooled',
            messages: [
                userSaid('hi'),
                reply('Alice', 'alice.png'),
                reply('Bob', 'bob.png'),
                reply('Cara', 'cara.png'),
            ],
            random: rolls(0),
        });
        expect(result.speakers).toHaveLength(1);
        expect(result.speakers[0]?.reason).toBe('fallback');
    });
});

describe('planTurn: the fallback', () => {
    it('picks somebody when every roll failed', () => {
        const members = [character('Alice', 0.1), character('Bob', 0.1)];
        const result = plan({ members, input: 'hello', random: rolls(0.9, 0.9, 0) });
        // A turn where nobody speaks leaves the user's message hanging.
        expect(result.speakers).toHaveLength(1);
        expect(result.speakers[0]?.reason).toBe('fallback');
    });

    it('keeps the roll that failed, so the trace still explains itself', () => {
        const members = [character('Alice', 0.1)];
        const result = plan({ members, input: 'hello', random: rolls(0.9, 0) });
        expect(result.speakers[0]).toMatchObject({
            reason: 'fallback',
            roll: 0.9,
            talkativeness: 0.1,
        });
    });

    it('prefers a member who is at least willing to talk', () => {
        const members = [character('Silent', 0), character('Alice', 0.1)];
        const result = plan({ members, input: 'hello', random: rolls(0.9, 0.9, 0) });
        expect(result.speakers[0]?.name).toBe('Alice');
    });

    it('picks a silent member rather than nobody, when that is all there is', () => {
        const members = [character('Silent', 0)];
        const result = plan({ members, input: 'hello', random: rolls(0.9, 0) });
        expect(result.speakers.map((entry) => entry.name)).toEqual(['Silent']);
    });

    it('activates nobody when every member is disabled', () => {
        const result = plan({ disabled: ['alice.png', 'bob.png'], input: 'hello' });
        expect(result.speakers).toEqual([]);
        expect(result.decisions.every((entry) => entry.reason === 'disabled')).toBe(true);
    });

    it('activates nobody for an empty group', () => {
        const result = plan({ members: [], input: 'hello' });
        expect(result.speakers).toEqual([]);
        expect(result.decisions).toEqual([]);
    });
});
