import { describe, expect, it } from 'vitest';
import { createEntry, type WorldInfoBook } from '@/api/worldinfo';
import { buildQueryText, decodeUid, flattenBooks, resolveActiveBooks } from './books';

function book(uids: number[]): WorldInfoBook {
    const entries: WorldInfoBook['entries'] = {};
    for (const uid of uids) {
        entries[String(uid)] = { ...createEntry(uid), content: `content ${uid}` };
    }
    return { entries };
}

describe('flattenBooks', () => {
    it('keeps entries from two books apart even when their uids collide', () => {
        const flattened = flattenBooks([
            { name: 'Alpha', book: book([0, 1]) },
            { name: 'Beta', book: book([0, 1]) },
        ]);
        const uids = flattened.map((entry) => entry.uid);
        expect(new Set(uids).size).toBe(4);
    });

    it('records where each entry came from', () => {
        const flattened = flattenBooks([
            { name: 'Alpha', book: book([0]) },
            { name: 'Beta', book: book([0]) },
        ]);
        expect(flattened.map((entry) => entry.sourceBook)).toEqual(['Alpha', 'Beta']);
        expect(flattened.map((entry) => entry.sourceUid)).toEqual([0, 0]);
    });

    it('round-trips a synthetic uid', () => {
        const flattened = flattenBooks([
            { name: 'Alpha', book: book([0]) },
            { name: 'Beta', book: book([7]) },
        ]);
        const second = flattened[1]!;
        expect(decodeUid(second.uid)).toEqual({ bookIndex: 1, sourceUid: 7 });
    });

    it('tolerates a book that failed to load', () => {
        expect(flattenBooks([{ name: 'Alpha', book: undefined }])).toEqual([]);
    });

    it('skips malformed entries', () => {
        const broken = { entries: { a: null, b: { ...createEntry(1) } } } as unknown as WorldInfoBook;
        expect(flattenBooks([{ name: 'Alpha', book: broken }])).toHaveLength(1);
    });
});

describe('resolveActiveBooks', () => {
    const available = ['Eldoria', 'Shadowfangs', 'Ships'];

    it('puts the character book first', () => {
        const names = resolveActiveBooks({
            characterBook: 'Eldoria',
            selected: ['Ships'],
            useCharacterBook: true,
            available,
        });
        expect(names).toEqual(['Eldoria', 'Ships']);
    });

    it('omits the character book when that is switched off', () => {
        const names = resolveActiveBooks({
            characterBook: 'Eldoria',
            selected: ['Ships'],
            useCharacterBook: false,
            available,
        });
        expect(names).toEqual(['Ships']);
    });

    it('does not list a book twice', () => {
        const names = resolveActiveBooks({
            characterBook: 'Eldoria',
            selected: ['Eldoria'],
            useCharacterBook: true,
            available,
        });
        expect(names).toEqual(['Eldoria']);
    });

    it('drops names that no longer exist on disk', () => {
        const names = resolveActiveBooks({
            characterBook: 'Deleted',
            selected: ['AlsoGone', 'Ships'],
            useCharacterBook: true,
            available,
        });
        expect(names).toEqual(['Ships']);
    });

    it('handles a card with no book', () => {
        const names = resolveActiveBooks({
            characterBook: undefined,
            selected: [],
            useCharacterBook: true,
            available,
        });
        expect(names).toEqual([]);
    });
});

describe('buildQueryText', () => {
    it('uses the most recent messages', () => {
        expect(buildQueryText(['a', 'b', 'c'], 2)).toBe('b\nc');
    });

    it('always keeps at least the last message', () => {
        expect(buildQueryText(['a', 'b'], 0)).toBe('b');
    });

    it('caps the query length', () => {
        expect(buildQueryText(['x'.repeat(9000)], 1).length).toBe(4000);
    });
});
