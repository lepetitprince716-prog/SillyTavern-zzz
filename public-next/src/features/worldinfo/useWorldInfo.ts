/**
 * Resolving, indexing and activating world info for a chat.
 *
 * Splits into three steps so each can fail on its own: load the active books,
 * optionally score them semantically, then run the pure engine. A failure in
 * the semantic step degrades to keyword-only matching rather than taking world
 * info down with it.
 */

import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys, useWorldInfoList } from '@/api/queries';
import type { Character } from '@/api/types';
import { bookCollectionId, hashVectorText, insertVectors, listVectorHashes, queryVectors } from '@/api/vectors';
import { fetchWorldInfoBook, type WorldInfoBook } from '@/api/worldinfo';
import { useSessionStore } from '@/store/session';
import { buildQueryText, flattenBooks, resolveActiveBooks, type ActiveEntry } from './books';
import { activateWorldInfo, type ActivationResult } from './engine';

export interface WorldInfoState {
    /** Books actually in play, character book first. */
    bookNames: string[];
    /** Every candidate entry across those books. */
    entries: ActiveEntry[];
    /** Null when world info is off or there is nothing to activate. */
    result: ActivationResult | null;
    isLoading: boolean;
    /** True while the semantic index is being built or queried. */
    isScoring: boolean;
    /** Set when semantic matching failed; keyword matching still ran. */
    semanticError: string | null;
}

/**
 * Brings a book's entries up to date in the vector index, then queries it.
 *
 * Only entries whose hash the index has not seen are embedded, so an edit costs
 * one entry rather than a whole book.
 */
async function scoreBook(
    bookName: string,
    entries: ActiveEntry[],
    queryText: string,
    signal: AbortSignal,
): Promise<Map<number, number>> {
    const collectionId = bookCollectionId(bookName);
    const byHash = new Map<number, number>();
    const items = entries
        .filter((entry) => (entry.content ?? '').trim())
        .map((entry) => {
            const hash = hashVectorText(entry.sourceUid, entry.content ?? '');
            byHash.set(hash, entry.uid);
            return { hash, text: entry.content ?? '', index: entry.sourceUid };
        });

    if (items.length === 0) {
        return new Map();
    }

    const known = new Set(await listVectorHashes(collectionId));
    const missing = items.filter((item) => !known.has(item.hash));
    if (missing.length > 0) {
        await insertVectors(collectionId, missing);
    }

    const response = await queryVectors(collectionId, queryText, {
        topK: Math.min(items.length, 50),
        threshold: 0,
        signal,
    });

    const similarities = new Map<number, number>();
    for (const { hash, score } of response.scores ?? []) {
        const uid = byHash.get(hash);
        if (uid !== undefined) {
            similarities.set(uid, score);
        }
    }
    return similarities;
}

/**
 * The world info state for a chat.
 * @param messages Rendered message texts, oldest first.
 */
export function useWorldInfo(character: Character | null, messages: string[]): WorldInfoState {
    const settings = useSessionStore((state) => state.worldInfo);
    const { data: available } = useWorldInfoList();

    const characterBook = useMemo(() => {
        const world = character?.data?.extensions?.['world'];
        return typeof world === 'string' ? world : undefined;
    }, [character]);

    const bookNames = useMemo(
        () =>
            settings.enabled
                ? resolveActiveBooks({
                    characterBook,
                    selected: settings.books,
                    useCharacterBook: settings.useCharacterBook,
                    available: (available ?? []).map((entry) => entry.file_id),
                })
                : [],
        [settings.enabled, settings.books, settings.useCharacterBook, characterBook, available],
    );

    const bookQueries = useQueries({
        queries: bookNames.map((name) => ({
            queryKey: queryKeys.worldInfoBook(name),
            queryFn: ({ signal }: { signal: AbortSignal }) => fetchWorldInfoBook(name, signal),
            staleTime: Number.POSITIVE_INFINITY,
        })),
    });

    const booksLoading = bookQueries.some((query) => query.isPending);
    const bookData = bookQueries.map((query) => query.data as WorldInfoBook | undefined);

    /**
     * One string that changes whenever any active book is written, including
     * through `setQueryData` from the editor. A dependency list must have a
     * constant length, so the per-book data cannot be spread into it.
     */
    const booksVersion = bookQueries.map((query) => query.dataUpdatedAt).join(',');

    const entries = useMemo(
        () => flattenBooks(bookNames.map((name, index) => ({ name, book: bookData[index] }))),
        // bookData is a fresh array every render; booksVersion is the signal
        // that the contents actually changed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [bookNames, booksVersion],
    );

    // The semantic query reads the same window as the keyword scan. Two
    // different look-back distances would make "why did this fire" harder to
    // answer, which is the opposite of the point.
    const queryText = useMemo(
        () => buildQueryText(messages, settings.scanDepth),
        [messages, settings.scanDepth],
    );

    /**
     * A cheap identity for the indexed content, so editing an entry
     * re-queries but an unrelated re-render does not.
     */
    const contentFingerprint = useMemo(
        () => entries.map((entry) => hashVectorText(entry.uid, entry.content ?? '')).join(','),
        [entries],
    );

    const semanticEnabled = settings.enabled && settings.semanticEnabled && entries.length > 0 && Boolean(queryText);

    const semanticQuery = useQuery({
        queryKey: ['worldinfo-semantic', bookNames, contentFingerprint, queryText],
        queryFn: async ({ signal }) => {
            const merged = new Map<number, number>();
            for (const name of bookNames) {
                const scoped = entries.filter((entry) => entry.sourceBook === name);
                const scores = await scoreBook(name, scoped, queryText, signal);
                for (const [uid, score] of scores) {
                    merged.set(uid, score);
                }
            }
            return merged;
        },
        enabled: semanticEnabled,
        staleTime: 5 * 60_000,
        // Embedding is expensive; a failure should not be retried in a loop.
        retry: false,
    });

    const result = useMemo(() => {
        if (!settings.enabled || entries.length === 0) {
            return null;
        }
        // Wait for scores before activating, or a semantic-only entry would be
        // reported as a miss and then flip a moment later.
        if (semanticEnabled && semanticQuery.isPending) {
            return null;
        }
        return activateWorldInfo({
            entries,
            messages,
            settings: {
                budgetTokens: settings.budgetTokens,
                scanDepth: settings.scanDepth,
                maxRecursionRounds: settings.maxRecursionRounds,
                semanticThreshold: settings.semanticThreshold,
                semanticTopK: settings.semanticTopK,
            },
            ...(semanticQuery.data ? { similarities: semanticQuery.data } : {}),
        });
    }, [
        settings.enabled,
        settings.budgetTokens,
        settings.scanDepth,
        settings.maxRecursionRounds,
        settings.semanticThreshold,
        settings.semanticTopK,
        entries,
        messages,
        semanticEnabled,
        semanticQuery.isPending,
        semanticQuery.data,
    ]);

    return {
        bookNames,
        entries,
        result,
        isLoading: booksLoading,
        isScoring: semanticEnabled && semanticQuery.isFetching,
        semanticError:
            semanticQuery.error instanceof Error
                ? semanticQuery.error.message
                : semanticQuery.error
                    ? String(semanticQuery.error)
                    : null,
    };
}
