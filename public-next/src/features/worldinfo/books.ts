/**
 * Combining several lorebooks into one candidate list.
 *
 * Entry uids are only unique inside a book, so two active books will both have
 * a uid 0. The engine and the semantic index key everything by uid, so the
 * flattened entries get a synthetic uid that is unique across books, with the
 * original book name and uid kept alongside for display and for saving back.
 */

import type { WorldInfoBook, WorldInfoEntry } from '@/api/worldinfo';

/** Room for this many entries per book before uids would collide. */
const UID_STRIDE = 100_000;

export interface ActiveEntry extends WorldInfoEntry {
    /** Name of the book this entry came from. */
    sourceBook: string;
    /** The entry's uid within its own book. */
    sourceUid: number;
}

/**
 * Flattens loaded books into one list with collision-free uids.
 * @param books Book name to book, in the order they should be considered.
 */
export function flattenBooks(books: Array<{ name: string; book: WorldInfoBook | undefined }>): ActiveEntry[] {
    const flattened: ActiveEntry[] = [];

    books.forEach(({ name, book }, bookIndex) => {
        const entries = book?.entries ?? {};
        for (const entry of Object.values(entries)) {
            if (!entry || typeof entry !== 'object') {
                continue;
            }
            const sourceUid = Number(entry.uid) || 0;
            flattened.push({
                ...entry,
                uid: bookIndex * UID_STRIDE + sourceUid,
                sourceBook: name,
                sourceUid,
            });
        }
    });

    return flattened;
}

/** Splits a synthetic uid back into its book index and original uid. */
export function decodeUid(uid: number): { bookIndex: number; sourceUid: number } {
    return { bookIndex: Math.floor(uid / UID_STRIDE), sourceUid: uid % UID_STRIDE };
}

/** The text a semantic query is run against: the most recent messages. */
export function buildQueryText(messages: string[], depth: number): string {
    const limit = Math.max(1, Math.floor(depth));
    return messages.slice(-limit).join('\n').slice(-4000);
}

/**
 * Which books are active for a chat.
 *
 * The character's own bound book comes first so its entries win ties against
 * globally selected books.
 */
export function resolveActiveBooks(options: {
    characterBook: string | undefined;
    selected: string[];
    useCharacterBook: boolean;
    available: string[];
}): string[] {
    const names: string[] = [];
    const characterBook = options.characterBook?.trim();

    if (options.useCharacterBook && characterBook && options.available.includes(characterBook)) {
        names.push(characterBook);
    }
    for (const name of options.selected) {
        if (name !== characterBook && options.available.includes(name)) {
            names.push(name);
        }
    }
    return [...new Set(names)];
}
