/**
 * Subsequence-based fuzzy matching for the character list and command palette.
 *
 * Small and dependency-free on purpose: the whole job is ranking a few hundred
 * short strings as the user types, which does not warrant a search library.
 */

export interface FuzzyMatch<T> {
    item: T;
    score: number;
}

/**
 * Scores `query` against `text`.
 *
 * Higher is better; `null` means no match. The scoring rewards, in order:
 * an exact prefix, a whole-word start, consecutive runs, and matches early in
 * the string — the signals that make a ranked list feel predictable.
 */
export function fuzzyScore(text: string, query: string): number | null {
    if (!query) {
        return 0;
    }
    const haystack = text.toLowerCase();
    const needle = query.toLowerCase();

    if (haystack === needle) {
        return 1000;
    }
    if (haystack.startsWith(needle)) {
        return 900 - haystack.length;
    }

    const wordStart = haystack.indexOf(` ${needle}`);
    if (wordStart !== -1) {
        return 800 - wordStart;
    }

    const substring = haystack.indexOf(needle);
    if (substring !== -1) {
        return 700 - substring;
    }

    // Fall back to a subsequence walk: every needle character must appear in
    // order, and adjacency is rewarded.
    let score = 0;
    let run = 0;
    let cursor = 0;
    for (const character of needle) {
        const found = haystack.indexOf(character, cursor);
        if (found === -1) {
            return null;
        }
        run = found === cursor ? run + 1 : 0;
        score += 10 + run * 6 - Math.min(found - cursor, 12);
        cursor = found + 1;
    }
    return score;
}

/**
 * Filters and ranks a list.
 * @param fields Extracts the searchable strings from an item; the best-scoring
 * field wins, so a tag match can surface an item its name would not.
 */
export function fuzzyFilter<T>(
    items: readonly T[],
    query: string,
    fields: (item: T) => string[],
): T[] {
    const trimmed = query.trim();
    if (!trimmed) {
        return [...items];
    }

    const matches: Array<FuzzyMatch<T>> = [];
    for (const item of items) {
        let best: number | null = null;
        for (const field of fields(item)) {
            if (!field) {
                continue;
            }
            const score = fuzzyScore(field, trimmed);
            if (score !== null && (best === null || score > best)) {
                best = score;
            }
        }
        if (best !== null) {
            matches.push({ item, score: best });
        }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.map((match) => match.item);
}
