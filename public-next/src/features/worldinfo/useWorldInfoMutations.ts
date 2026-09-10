/**
 * Writing lorebooks.
 *
 * A book file is replaced whole on every save, so edits are written through the
 * query cache first and flushed on a debounce: typing in an entry must not fire
 * a request per keystroke, and the cache is what the editor renders from.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { queryKeys } from '@/api/queries';
import { purgeVectors, bookCollectionId } from '@/api/vectors';
import {
    createEntry,
    deleteWorldInfoBook,
    importWorldInfoBook,
    nextEntryUid,
    saveWorldInfoBook,
    type WorldInfoBook,
    type WorldInfoEntry,
} from '@/api/worldinfo';
import { toast } from '@/lib/toast';

const SAVE_DEBOUNCE_MS = 800;

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export interface WorldInfoMutations {
    /** Applies a change to the cached book and schedules a save. */
    updateBook(name: string, update: (book: WorldInfoBook) => WorldInfoBook): void;
    /** Adds a blank entry and returns its uid. */
    addEntry(name: string): number | null;
    removeEntry(name: string, uid: number): void;
    patchEntry(name: string, uid: number, patch: Partial<WorldInfoEntry>): void;
    /** Replaces an entry wholesale, for edits that rewrite `extensions`. */
    replaceEntry(name: string, entry: WorldInfoEntry): void;
    createBook(name: string): Promise<void>;
    removeBook(name: string): Promise<void>;
    importBook(file: File): Promise<string>;
    /** True while a save is in flight or pending. */
    isSaving: boolean;
}

export function useWorldInfoMutations(): WorldInfoMutations {
    const queryClient = useQueryClient();
    const timers = useRef(new Map<string, number>());

    const { mutate: persist, isPending } = useMutation({
        mutationFn: ({ name, data }: { name: string; data: WorldInfoBook }) =>
            saveWorldInfoBook(name, data),
        onError: (error) => toast.error('Could not save the lorebook', describe(error)),
    });

    // Flush anything still pending when the editor goes away.
    useEffect(() => {
        const pending = timers.current;
        return () => {
            for (const handle of pending.values()) {
                window.clearTimeout(handle);
            }
            pending.clear();
        };
    }, []);

    const scheduleSave = useCallback(
        (name: string) => {
            const existing = timers.current.get(name);
            if (existing !== undefined) {
                window.clearTimeout(existing);
            }
            timers.current.set(
                name,
                window.setTimeout(() => {
                    timers.current.delete(name);
                    const data = queryClient.getQueryData<WorldInfoBook>(queryKeys.worldInfoBook(name));
                    if (data) {
                        persist({ name, data });
                    }
                }, SAVE_DEBOUNCE_MS),
            );
        },
        [persist, queryClient],
    );

    const updateBook = useCallback(
        (name: string, update: (book: WorldInfoBook) => WorldInfoBook) => {
            queryClient.setQueryData<WorldInfoBook>(queryKeys.worldInfoBook(name), (current) =>
                update(current ?? { entries: {} }),
            );
            scheduleSave(name);
        },
        [queryClient, scheduleSave],
    );

    const addEntry = useCallback(
        (name: string) => {
            const current = queryClient.getQueryData<WorldInfoBook>(queryKeys.worldInfoBook(name));
            if (!current) {
                return null;
            }
            const uid = nextEntryUid(current);
            updateBook(name, (book) => ({
                ...book,
                entries: { ...book.entries, [String(uid)]: createEntry(uid) },
            }));
            return uid;
        },
        [queryClient, updateBook],
    );

    const removeEntry = useCallback(
        (name: string, uid: number) => {
            updateBook(name, (book) => {
                const entries = { ...book.entries };
                delete entries[String(uid)];
                return { ...book, entries };
            });
        },
        [updateBook],
    );

    const replaceEntry = useCallback(
        (name: string, entry: WorldInfoEntry) => {
            updateBook(name, (book) => ({
                ...book,
                entries: { ...book.entries, [String(entry.uid)]: entry },
            }));
        },
        [updateBook],
    );

    const patchEntry = useCallback(
        (name: string, uid: number, patch: Partial<WorldInfoEntry>) => {
            updateBook(name, (book) => {
                const existing = book.entries[String(uid)];
                if (!existing) {
                    return book;
                }
                return {
                    ...book,
                    entries: { ...book.entries, [String(uid)]: { ...existing, ...patch } },
                };
            });
        },
        [updateBook],
    );

    const createBook = useCallback(
        async (name: string) => {
            const trimmed = name.trim();
            if (!trimmed) {
                throw new Error('A lorebook needs a name.');
            }
            await saveWorldInfoBook(trimmed, { name: trimmed, entries: {} });
            await queryClient.invalidateQueries({ queryKey: queryKeys.worldInfoList });
            toast.success('Lorebook created', trimmed);
        },
        [queryClient],
    );

    const removeBook = useCallback(
        async (name: string) => {
            await deleteWorldInfoBook(name);
            // Drop the embeddings too, or a book created later with the same
            // name would inherit stale vectors.
            await purgeVectors(bookCollectionId(name)).catch(() => undefined);
            queryClient.removeQueries({ queryKey: queryKeys.worldInfoBook(name) });
            await queryClient.invalidateQueries({ queryKey: queryKeys.worldInfoList });
            toast.success('Lorebook deleted', name);
        },
        [queryClient],
    );

    const importBook = useCallback(
        async (file: File) => {
            const name = await importWorldInfoBook(file);
            await queryClient.invalidateQueries({ queryKey: queryKeys.worldInfoList });
            toast.success('Lorebook imported', name);
            return name;
        },
        [queryClient],
    );

    return {
        updateBook,
        addEntry,
        removeEntry,
        patchEntry,
        replaceEntry,
        createBook,
        removeBook,
        importBook,
        isSaving: isPending,
    };
}
