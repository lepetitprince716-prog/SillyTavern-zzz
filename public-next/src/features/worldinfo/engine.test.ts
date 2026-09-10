import { describe, expect, it } from 'vitest';
import { WI_LOGIC, WI_POSITION, createEntry, type WorldInfoEntry } from '@/api/worldinfo';
import {
    activateWorldInfo,
    DEFAULT_ENGINE_SETTINGS,
    explainDecision,
    findIgnoredFields,
    keyMatches,
    secondaryKeysSatisfied,
    type EngineSettings,
} from './engine';

function entry(uid: number, overrides: Partial<WorldInfoEntry> = {}): WorldInfoEntry {
    return { ...createEntry(uid), content: `content ${uid}`, ...overrides };
}

/** Deterministic settings: no dice, generous budget. */
const settings: EngineSettings = {
    ...DEFAULT_ENGINE_SETTINGS,
    budgetTokens: 10_000,
    random: () => 0,
};

function run(entries: WorldInfoEntry[], messages: string[], overrides: Partial<EngineSettings> = {}) {
    return activateWorldInfo({ entries, messages, settings: { ...settings, ...overrides } });
}

function decisionFor(result: ReturnType<typeof run>, uid: number) {
    return result.decisions.find((decision) => decision.entry.uid === uid);
}

describe('keyMatches', () => {
    it('matches case-insensitively by default', () => {
        expect(keyMatches('The Forest is dark', 'forest', { caseSensitive: false, wholeWords: false })).toBe(true);
    });

    it('respects case sensitivity', () => {
        expect(keyMatches('the forest', 'Forest', { caseSensitive: true, wholeWords: false })).toBe(false);
        expect(keyMatches('the Forest', 'Forest', { caseSensitive: true, wholeWords: false })).toBe(true);
    });

    it('matches a substring when whole words are off', () => {
        expect(keyMatches('deforestation', 'forest', { caseSensitive: false, wholeWords: false })).toBe(true);
    });

    it('does not match a substring when whole words are on', () => {
        expect(keyMatches('deforestation', 'forest', { caseSensitive: false, wholeWords: true })).toBe(false);
        expect(keyMatches('the forest', 'forest', { caseSensitive: false, wholeWords: true })).toBe(true);
    });

    it('still matches CJK keys when whole words are on', () => {
        // A word boundary never matches around CJK, so applying it there would
        // silently disable the key.
        expect(keyMatches('这是森林深处', '森林', { caseSensitive: false, wholeWords: true })).toBe(true);
    });

    it('treats a blank key as no match', () => {
        expect(keyMatches('anything', '   ', { caseSensitive: false, wholeWords: false })).toBe(false);
    });

    it('does not break on regex metacharacters in a key', () => {
        expect(keyMatches('cost is $5 (net)', '$5 (net)', { caseSensitive: false, wholeWords: false })).toBe(true);
    });
});

describe('secondaryKeysSatisfied', () => {
    const options = { caseSensitive: false, wholeWords: false };
    // Multi-character keys on purpose: a single letter would substring-match
    // the surrounding prose and the fixture would prove nothing.
    const keys = ['night', 'storm'];

    it('AND_ANY needs one', () => {
        expect(secondaryKeysSatisfied('at night', keys, WI_LOGIC.andAny, options)).toBe(true);
        expect(secondaryKeysSatisfied('at noon', keys, WI_LOGIC.andAny, options)).toBe(false);
    });

    it('AND_ALL needs every one', () => {
        expect(secondaryKeysSatisfied('a storm at night', keys, WI_LOGIC.andAll, options)).toBe(true);
        expect(secondaryKeysSatisfied('at night', keys, WI_LOGIC.andAll, options)).toBe(false);
    });

    it('NOT_ANY needs none', () => {
        expect(secondaryKeysSatisfied('at noon', keys, WI_LOGIC.notAny, options)).toBe(true);
        expect(secondaryKeysSatisfied('at night', keys, WI_LOGIC.notAny, options)).toBe(false);
    });

    it('NOT_ALL needs at least one missing', () => {
        expect(secondaryKeysSatisfied('at night', keys, WI_LOGIC.notAll, options)).toBe(true);
        expect(secondaryKeysSatisfied('a storm at night', keys, WI_LOGIC.notAll, options)).toBe(false);
    });
});

describe('activateWorldInfo — every entry gets a reason', () => {
    it('reports a decision for every entry, included or not', () => {
        const entries = [
            entry(0, { constant: true }),
            entry(1, { key: ['forest'] }),
            entry(2, { key: ['dragon'] }),
            entry(3, { disable: true }),
            entry(4, { content: '   ' }),
        ];
        const result = run(entries, ['We walk in the forest.']);
        expect(result.decisions).toHaveLength(5);
        expect(new Set(result.decisions.map((d) => d.entry.uid))).toEqual(new Set([0, 1, 2, 3, 4]));
    });

    it('names the reason for each outcome', () => {
        const entries = [
            entry(0, { constant: true }),
            entry(1, { key: ['forest'] }),
            entry(2, { key: ['dragon'] }),
            entry(3, { disable: true }),
            entry(4, { content: '' }),
            entry(5, { key: [] }),
        ];
        const result = run(entries, ['We walk in the forest.']);
        expect(decisionFor(result, 0)?.reason).toBe('always');
        expect(decisionFor(result, 1)?.reason).toBe('keyword');
        expect(decisionFor(result, 2)?.reason).toBe('no-keyword-match');
        expect(decisionFor(result, 3)?.reason).toBe('disabled');
        expect(decisionFor(result, 4)?.reason).toBe('empty');
        expect(decisionFor(result, 5)?.reason).toBe('no-keys');
    });

    it('records which keys matched', () => {
        const result = run([entry(0, { key: ['forest', 'wood', 'dragon'] })], ['A forest of wood.']);
        expect(decisionFor(result, 0)?.matchedKeys.sort()).toEqual(['forest', 'wood']);
    });

    it('explains a decision in words', () => {
        const result = run([entry(0, { key: ['forest'] })], ['the forest']);
        expect(explainDecision(decisionFor(result, 0)!)).toBe('Matched "forest"');
    });
});

describe('activateWorldInfo — scan window', () => {
    const entries = [entry(0, { key: ['ancient'] })];

    it('only scans the configured number of recent messages', () => {
        const messages = ['an ancient tale', 'b', 'c', 'd', 'e'];
        expect(decisionFor(run(entries, messages, { scanDepth: 2 }), 0)?.included).toBe(false);
        expect(decisionFor(run(entries, messages, { scanDepth: 5 }), 0)?.included).toBe(true);
    });

    it('honours a per-entry scan depth override', () => {
        const messages = ['an ancient tale', 'b', 'c', 'd', 'e'];
        const deep = [entry(0, { key: ['ancient'], scanDepth: 5 })];
        expect(decisionFor(run(deep, messages, { scanDepth: 1 }), 0)?.included).toBe(true);
    });

    it('scans nothing at depth 0', () => {
        expect(decisionFor(run(entries, ['an ancient tale'], { scanDepth: 0 }), 0)?.included).toBe(false);
    });
});

describe('activateWorldInfo — secondary keys and probability', () => {
    it('rejects when the secondary condition fails', () => {
        const entries = [
            entry(0, {
                key: ['forest'],
                keysecondary: ['night'],
                selective: true,
                selectiveLogic: WI_LOGIC.andAny,
            }),
        ];
        const result = run(entries, ['a forest at noon']);
        expect(decisionFor(result, 0)?.reason).toBe('secondary-keys');
    });

    it('accepts when the secondary condition holds', () => {
        const entries = [
            entry(0, { key: ['forest'], keysecondary: ['night'], selective: true }),
        ];
        expect(decisionFor(run(entries, ['a forest at night']), 0)?.included).toBe(true);
    });

    it('ignores secondary keys when selective is off', () => {
        const entries = [entry(0, { key: ['forest'], keysecondary: ['night'], selective: false })];
        expect(decisionFor(run(entries, ['a forest at noon']), 0)?.included).toBe(true);
    });

    it('drops an entry that loses its probability roll', () => {
        const entries = [entry(0, { key: ['forest'], probability: 50, useProbability: true })];
        const result = run(entries, ['the forest'], { random: () => 0.9 });
        expect(decisionFor(result, 0)?.reason).toBe('probability');
    });

    it('keeps an entry that wins its roll', () => {
        const entries = [entry(0, { key: ['forest'], probability: 50, useProbability: true })];
        const result = run(entries, ['the forest'], { random: () => 0.1 });
        expect(decisionFor(result, 0)?.included).toBe(true);
    });

    it('never rolls when probability is disabled', () => {
        const entries = [entry(0, { key: ['forest'], probability: 1, useProbability: false })];
        const result = run(entries, ['the forest'], { random: () => 0.99 });
        expect(decisionFor(result, 0)?.included).toBe(true);
    });
});

describe('activateWorldInfo — recursion', () => {
    const chain = [
        entry(0, { key: ['forest'], content: 'The forest hides the Shadowfangs.' }),
        entry(1, { key: ['shadowfangs'], content: 'The Shadowfangs are wolves.' }),
    ];

    it('activates a chained entry in a later round', () => {
        const result = run(chain, ['we enter the forest'], { maxRecursionRounds: 1 });
        expect(decisionFor(result, 1)?.included).toBe(true);
        expect(decisionFor(result, 1)?.round).toBe(1);
        expect(decisionFor(result, 0)?.round).toBe(0);
    });

    it('does not chain when recursion is off', () => {
        const result = run(chain, ['we enter the forest'], { maxRecursionRounds: 0 });
        expect(decisionFor(result, 1)?.included).toBe(false);
    });

    it('respects excludeRecursion on the source entry', () => {
        const entries = [
            entry(0, { key: ['forest'], content: 'Mentions Shadowfangs.', excludeRecursion: true }),
            entry(1, { key: ['shadowfangs'] }),
        ];
        expect(decisionFor(run(entries, ['the forest'], { maxRecursionRounds: 2 }), 1)?.included).toBe(false);
    });

    it('respects preventRecursion on the target entry, and still reports it', () => {
        const entries = [
            entry(0, { key: ['forest'], content: 'Mentions Shadowfangs.' }),
            entry(1, { key: ['shadowfangs'], preventRecursion: true }),
        ];
        const result = run(entries, ['the forest'], { maxRecursionRounds: 2 });
        const blocked = decisionFor(result, 1);
        // Rule 1: an entry barred from recursion is still accounted for.
        expect(blocked).toBeDefined();
        expect(blocked?.included).toBe(false);
        expect(blocked?.reason).toBe('no-keyword-match');
    });

    it('penalises a recursive activation in the score', () => {
        const result = run(chain, ['we enter the forest'], { maxRecursionRounds: 1 });
        expect(decisionFor(result, 1)!.score.recursion).toBe(25);
        expect(decisionFor(result, 1)!.score.total).toBeLessThan(decisionFor(result, 0)!.score.total);
    });

    it('terminates on a self-referential pair', () => {
        const loop = [
            entry(0, { key: ['alpha'], content: 'mentions beta' }),
            entry(1, { key: ['beta'], content: 'mentions alpha' }),
        ];
        const result = run(loop, ['alpha'], { maxRecursionRounds: 5 });
        expect(result.included).toHaveLength(2);
    });
});

describe('activateWorldInfo — semantic activation', () => {
    it('activates on similarity above the threshold with no key match', () => {
        const entries = [entry(0, { key: ['shadowfangs'] })];
        const result = activateWorldInfo({
            entries,
            messages: ['tell me about the dark wolves'],
            settings: { ...settings, semanticThreshold: 0.6 },
            similarities: new Map([[0, 0.82]]),
        });
        expect(decisionFor(result, 0)?.reason).toBe('semantic');
        expect(decisionFor(result, 0)?.similarity).toBe(0.82);
    });

    it('reports being below the threshold rather than a plain miss', () => {
        const result = activateWorldInfo({
            entries: [entry(0, { key: ['shadowfangs'] })],
            messages: ['unrelated'],
            settings: { ...settings, semanticThreshold: 0.6 },
            similarities: new Map([[0, 0.2]]),
        });
        expect(decisionFor(result, 0)?.reason).toBe('below-similarity');
    });

    it('prefers a keyword reason when both would fire', () => {
        const result = activateWorldInfo({
            entries: [entry(0, { key: ['wolves'] })],
            messages: ['the wolves howl'],
            settings,
            similarities: new Map([[0, 0.9]]),
        });
        expect(decisionFor(result, 0)?.reason).toBe('keyword');
        expect(decisionFor(result, 0)!.score.semantic).toBe(90);
    });

    it('activates a keyless entry on similarity alone', () => {
        const result = activateWorldInfo({
            entries: [entry(0, { key: [] })],
            messages: ['anything'],
            settings,
            similarities: new Map([[0, 0.95]]),
        });
        expect(decisionFor(result, 0)?.reason).toBe('semantic');
    });
});

describe('activateWorldInfo — budget by relevance', () => {
    it('spends the budget on the highest-scoring entries', () => {
        const long = 'x'.repeat(400); // ~100 tokens each
        const entries = [
            // Low order would win under the classic engine's ordering.
            entry(0, { key: ['dragon'], content: long, order: 0 }),
            entry(1, { key: ['forest'], content: long, order: 500 }),
        ];
        const result = run(entries, ['a quiet forest'], { budgetTokens: 120 });
        expect(decisionFor(result, 1)?.included).toBe(true);
        expect(decisionFor(result, 0)?.included).toBe(false);
    });

    it('names the budget as the reason for a drop', () => {
        const long = 'x'.repeat(400);
        const entries = [entry(0, { key: ['forest'], content: long }), entry(1, { key: ['forest'], content: long })];
        const result = run(entries, ['the forest'], { budgetTokens: 120 });
        const dropped = result.decisions.filter((d) => d.reason === 'budget');
        expect(dropped).toHaveLength(1);
        expect(result.budget.dropped).toBe(1);
    });

    it('never drops an always-on entry for a keyword match', () => {
        const long = 'x'.repeat(400);
        const entries = [
            entry(0, { constant: true, content: long }),
            entry(1, { key: ['forest'], content: long }),
        ];
        const result = run(entries, ['the forest'], { budgetTokens: 120 });
        expect(decisionFor(result, 0)?.included).toBe(true);
        expect(decisionFor(result, 1)?.reason).toBe('budget');
    });

    it('reports the budget that was actually used', () => {
        const result = run([entry(0, { key: ['forest'], content: 'x'.repeat(400) })], ['forest'], {
            budgetTokens: 500,
        });
        expect(result.budget.limit).toBe(500);
        expect(result.budget.used).toBeGreaterThan(0);
        expect(result.budget.used).toBeLessThanOrEqual(500);
    });

    it('ranks a more recent match above an older one', () => {
        const entries = [entry(0, { key: ['old'] }), entry(1, { key: ['new'] })];
        const result = run(entries, ['an old thing', 'filler', 'a new thing'], { scanDepth: 3 });
        expect(decisionFor(result, 1)!.score.recency).toBeGreaterThan(
            decisionFor(result, 0)!.score.recency,
        );
    });

    it('ranks more matched keys higher', () => {
        const entries = [entry(0, { key: ['forest'] }), entry(1, { key: ['forest', 'wood', 'glade'] })];
        const result = run(entries, ['a forest of wood in a glade']);
        expect(decisionFor(result, 1)!.score.keyMatches).toBeGreaterThan(
            decisionFor(result, 0)!.score.keyMatches,
        );
    });

    it('uses order only as a tiebreak, never to outrank a match', () => {
        const entries = [entry(0, { key: ['forest'], order: 0 }), entry(1, { key: ['forest'], order: 1000 })];
        const result = run(entries, ['the forest']);
        const a = decisionFor(result, 0)!;
        const b = decisionFor(result, 1)!;
        expect(a.score.total).toBeGreaterThan(b.score.total);
        // The gap is small: order cannot beat an extra key match, worth 10.
        expect(a.score.total - b.score.total).toBeLessThanOrEqual(10);
    });
});

describe('activateWorldInfo — prompt assembly', () => {
    it('groups content by insertion position', () => {
        const entries = [
            entry(0, { key: ['a'], content: 'before', position: WI_POSITION.beforeCharacter }),
            entry(1, { key: ['a'], content: 'after', position: WI_POSITION.afterCharacter }),
        ];
        const result = run(entries, ['a']);
        expect(result.blocks.get(WI_POSITION.beforeCharacter)).toBe('before');
        expect(result.blocks.get(WI_POSITION.afterCharacter)).toBe('after');
    });

    it('orders content within a position by order', () => {
        const entries = [
            entry(0, { key: ['a'], content: 'second', order: 200 }),
            entry(1, { key: ['a'], content: 'first', order: 100 }),
        ];
        const result = run(entries, ['a']);
        expect(result.blocks.get(WI_POSITION.beforeCharacter)).toBe('first\nsecond');
    });

    it('collects atDepth entries by depth', () => {
        const entries = [
            entry(0, { key: ['a'], content: 'deep', position: WI_POSITION.atDepth, depth: 2 }),
            entry(1, { key: ['a'], content: 'shallow', position: WI_POSITION.atDepth, depth: 0 }),
        ];
        const result = run(entries, ['a']);
        expect(result.depthBlocks.get(2)).toBe('deep');
        expect(result.depthBlocks.get(0)).toBe('shallow');
        expect(result.blocks.size).toBe(0);
    });

    it('leaves the blocks empty when nothing activates', () => {
        const result = run([entry(0, { key: ['dragon'] })], ['a forest']);
        expect(result.blocks.size).toBe(0);
        expect(result.included).toHaveLength(0);
    });
});

describe('findIgnoredFields', () => {
    it('lists the legacy fields this engine does not apply', () => {
        const legacy = entry(0, { sticky: 3, cooldown: 5, group: 'wolves', automationId: 'qr' });
        expect(findIgnoredFields(legacy).sort()).toEqual(['automationId', 'cooldown', 'group', 'sticky']);
    });

    it('says nothing for an entry that uses none of them', () => {
        expect(findIgnoredFields(entry(0, { key: ['a'] }))).toEqual([]);
    });

    it('ignores zero and empty-string defaults', () => {
        expect(findIgnoredFields(entry(0, { sticky: 0, cooldown: 0, group: '' }))).toEqual([]);
    });

    it('surfaces them on the decision so the UI can warn', () => {
        const result = run([entry(0, { key: ['forest'], sticky: 3 })], ['the forest']);
        expect(decisionFor(result, 0)?.ignoredFields).toEqual(['sticky']);
    });
});

describe('activateWorldInfo — per-entry semantic opt-out', () => {
    it('does not activate an entry that opted out, even above the threshold', () => {
        const optedOut: WorldInfoEntry = {
            ...createEntry(0),
            content: 'lore',
            key: ['nothing'],
            extensions: { st_next: { allowSemantic: false } },
        };
        const result = activateWorldInfo({
            entries: [optedOut],
            messages: ['unrelated but similar'],
            settings: { ...settings, semanticThreshold: 0.5 },
            similarities: new Map([[0, 0.99]]),
        });
        expect(decisionFor(result, 0)?.included).toBe(false);
    });

    it('activates by default when no opt-out is set', () => {
        const result = activateWorldInfo({
            entries: [entry(0, { key: ['nothing'] })],
            messages: ['unrelated'],
            settings: { ...settings, semanticThreshold: 0.5 },
            similarities: new Map([[0, 0.99]]),
        });
        expect(decisionFor(result, 0)?.reason).toBe('semantic');
    });

    it('still lets an opted-out entry match by key', () => {
        const optedOut: WorldInfoEntry = {
            ...createEntry(0),
            content: 'lore',
            key: ['forest'],
            extensions: { st_next: { allowSemantic: false } },
        };
        const result = activateWorldInfo({
            entries: [optedOut],
            messages: ['the forest'],
            settings,
            similarities: new Map([[0, 0.99]]),
        });
        expect(decisionFor(result, 0)?.reason).toBe('keyword');
    });
});

describe('activateWorldInfo — semantic ranking', () => {
    /** Four entries, none of whose keys appear in the message. */
    const candidates = [
        entry(0, { key: ['aaa'], content: 'first' }),
        entry(1, { key: ['bbb'], content: 'second' }),
        entry(2, { key: ['ccc'], content: 'third' }),
        entry(3, { key: ['ddd'], content: 'fourth' }),
    ];

    function withScores(scores: Array<[number, number]>, overrides: Partial<EngineSettings> = {}) {
        return activateWorldInfo({
            entries: candidates,
            messages: ['nothing matching any key'],
            settings: { ...settings, semanticThreshold: 0.3, semanticTopK: 2, ...overrides },
            similarities: new Map(scores),
        });
    }

    it('activates only the closest entries, up to the limit', () => {
        const result = withScores([
            [0, 0.9],
            [1, 0.8],
            [2, 0.7],
            [3, 0.6],
        ]);
        expect(result.included.map((decision) => decision.entry.uid).sort()).toEqual([0, 1]);
    });

    it('says an entry was outranked rather than calling it a miss', () => {
        const result = withScores([
            [0, 0.9],
            [1, 0.8],
            [2, 0.7],
        ]);
        expect(decisionFor(result, 2)?.reason).toBe('semantic-rank');
        expect(explainDecision(decisionFor(result, 2)!)).toContain('outranked');
    });

    it('separates being below the floor from being outranked', () => {
        const result = withScores([
            [0, 0.9],
            [1, 0.8],
            [2, 0.5],
            [3, 0.05],
        ]);
        expect(decisionFor(result, 2)?.reason).toBe('semantic-rank');
        expect(decisionFor(result, 3)?.reason).toBe('below-similarity');
    });

    it('reports an entry with no score at all as a plain miss', () => {
        const result = withScores([[0, 0.9]]);
        expect(decisionFor(result, 1)?.reason).toBe('no-keyword-match');
    });

    it('never lets meaning add anything when the limit is zero', () => {
        const result = withScores([[0, 0.9]], { semanticTopK: 0 });
        expect(result.included).toHaveLength(0);
        expect(decisionFor(result, 0)?.reason).toBe('semantic-rank');
    });

    it('does not spend a semantic slot on an entry that matched by key anyway', () => {
        const mixed = [
            entry(0, { key: ['forest'], content: 'keyword hit' }),
            entry(1, { key: ['zzz'], content: 'semantic hit' }),
            entry(2, { key: ['yyy'], content: 'weaker semantic' }),
        ];
        const result = activateWorldInfo({
            entries: mixed,
            messages: ['walking in the forest'],
            settings: { ...settings, semanticThreshold: 0.3, semanticTopK: 1 },
            // The keyword entry also scores highest semantically.
            similarities: new Map([
                [0, 0.9],
                [1, 0.8],
                [2, 0.4],
            ]),
        });
        // uid 0 matched by key, so it does not consume the single semantic
        // slot; uid 1, the closest entry the keys missed, gets it.
        expect(decisionFor(result, 0)?.reason).toBe('keyword');
        expect(decisionFor(result, 1)?.reason).toBe('semantic');
        expect(decisionFor(result, 2)?.reason).toBe('semantic-rank');
    });

    it('still records a keyword match\'s similarity in its score', () => {
        const result = activateWorldInfo({
            entries: [entry(0, { key: ['forest'] })],
            messages: ['the forest'],
            settings: { ...settings, semanticThreshold: 0.3, semanticTopK: 3 },
            similarities: new Map([[0, 0.7]]),
        });
        const decision = decisionFor(result, 0)!;
        expect(decision.reason).toBe('keyword');
        // Similarity still contributes to ranking for the budget.
        expect(decision.score.semantic).toBe(70);
    });

    it('activates a keyless entry through the semantic pass', () => {
        const result = activateWorldInfo({
            entries: [entry(0, { key: [] })],
            messages: ['anything'],
            settings: { ...settings, semanticThreshold: 0.3, semanticTopK: 1 },
            similarities: new Map([[0, 0.8]]),
        });
        expect(decisionFor(result, 0)?.reason).toBe('semantic');
    });

    it('reports a keyless entry with no scores as having no trigger', () => {
        const result = run([entry(0, { key: [] })], ['anything']);
        expect(decisionFor(result, 0)?.reason).toBe('no-keys');
    });
});
