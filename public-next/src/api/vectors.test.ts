import { describe, expect, it } from 'vitest';
import { bookCollectionId, hashVectorText } from './vectors';

describe('hashVectorText', () => {
    it('is stable for the same input', () => {
        expect(hashVectorText(1, 'hello')).toBe(hashVectorText(1, 'hello'));
    });

    it('changes when the content changes, so a stale index is detected', () => {
        expect(hashVectorText(1, 'hello')).not.toBe(hashVectorText(1, 'hello!'));
    });

    it('separates entries that share content', () => {
        expect(hashVectorText(1, 'same')).not.toBe(hashVectorText(2, 'same'));
    });

    it('cannot be confused by a uid that runs into the text', () => {
        // Without a separator, (uid 1, "23") and (uid 12, "3") would collide.
        expect(hashVectorText(1, '23')).not.toBe(hashVectorText(12, '3'));
    });

    it('stays a non-negative safe integer the server can round-trip', () => {
        for (const text of ['', 'a', 'x'.repeat(5000), 'the deep woods']) {
            const hash = hashVectorText(7, text);
            expect(Number.isSafeInteger(hash)).toBe(true);
            expect(hash).toBeGreaterThanOrEqual(0);
            expect(hash).toBeLessThanOrEqual(0x7fffffff);
        }
    });

    it('handles non-Latin content', () => {
        expect(hashVectorText(1, 'forest in CJK')).not.toBe(hashVectorText(1, 'sea in CJK'));
    });
});

describe('bookCollectionId', () => {
    it('namespaces collections so they cannot clash with the classic extension', () => {
        expect(bookCollectionId('Eldoria')).toBe('st-next-wi-Eldoria');
    });
});
