import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyScore } from './search';

describe('fuzzyScore', () => {
    it('ranks an exact match highest', () => {
        expect(fuzzyScore('Seraphina', 'seraphina')).toBe(1000);
    });

    it('prefers a prefix over a later substring', () => {
        const prefix = fuzzyScore('Serena', 'ser') ?? 0;
        const middle = fuzzyScore('Observer', 'ser') ?? 0;
        expect(prefix).toBeGreaterThan(middle);
    });

    it('prefers a word start over a mid-word substring', () => {
        const wordStart = fuzzyScore('The Serene Guide', 'ser') ?? 0;
        const midWord = fuzzyScore('Observer Guide', 'ser') ?? 0;
        expect(wordStart).toBeGreaterThan(midWord);
    });

    it('matches a subsequence', () => {
        expect(fuzzyScore('Seraphina the Guardian', 'sgd')).not.toBeNull();
    });

    it('rejects characters that are out of order', () => {
        expect(fuzzyScore('abc', 'cba')).toBeNull();
    });

    it('is case-insensitive', () => {
        expect(fuzzyScore('SERAPHINA', 'seraphina')).toBe(1000);
    });

    it('treats an empty query as a neutral match', () => {
        expect(fuzzyScore('anything', '')).toBe(0);
    });
});

describe('fuzzyFilter', () => {
    const items = [
        { name: 'Seraphina', tags: ['fantasy', 'guardian'] },
        { name: 'Coding Sensei', tags: ['assistant'] },
        { name: 'Aqua', tags: ['comedy'] },
    ];
    const fields = (item: (typeof items)[number]) => [item.name, ...item.tags];

    it('returns everything for an empty query', () => {
        expect(fuzzyFilter(items, '  ', fields)).toHaveLength(3);
    });

    it('ranks the best name match first', () => {
        expect(fuzzyFilter(items, 'sera', fields)[0]?.name).toBe('Seraphina');
    });

    it('surfaces an item by tag when the name does not match', () => {
        expect(fuzzyFilter(items, 'comedy', fields).map((i) => i.name)).toEqual(['Aqua']);
    });

    it('drops items with no matching field', () => {
        expect(fuzzyFilter(items, 'zzzz', fields)).toEqual([]);
    });

    it('does not mutate the input', () => {
        const copy = [...items];
        fuzzyFilter(items, 'sera', fields);
        expect(items).toEqual(copy);
    });
});
