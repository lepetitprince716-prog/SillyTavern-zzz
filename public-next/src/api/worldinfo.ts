/**
 * World info (lorebook) transport and the on-disk entry format.
 *
 * Books live at `data/<user>/worlds/<name>.json` and are read and written whole.
 * The field names here are the ones actually on disk — camelCase, and not always
 * consistent (`keysecondary`, `addMemo`) — because this app shares those files
 * with the classic interface and must not reshape them.
 */

import { apiPost, apiPostForm } from './client';

/** Where an activated entry is inserted into the prompt. */
export const WI_POSITION = {
    beforeCharacter: 0,
    afterCharacter: 1,
    authorNoteTop: 2,
    authorNoteBottom: 3,
    atDepth: 4,
    exampleMessagesTop: 5,
    exampleMessagesBottom: 6,
    outlet: 7,
} as const;

export type WiPosition = (typeof WI_POSITION)[keyof typeof WI_POSITION];

/** How secondary keys combine with the primary ones. */
export const WI_LOGIC = {
    /** Any secondary key present. */
    andAny: 0,
    /** Not all secondary keys present. */
    notAll: 1,
    /** No secondary key present. */
    notAny: 2,
    /** All secondary keys present. */
    andAll: 3,
} as const;

export type WiLogic = (typeof WI_LOGIC)[keyof typeof WI_LOGIC];

/**
 * One lorebook entry, as stored.
 *
 * Almost everything is optional: books in the wild come from many versions of
 * SillyTavern and from third-party editors.
 */
export interface WorldInfoEntry {
    uid: number;
    /** Primary trigger keys. */
    key?: string[];
    /** Secondary keys, combined per {@link selectiveLogic}. */
    keysecondary?: string[];
    /** Author's label for the entry. Not sent to the model. */
    comment?: string;
    content?: string;
    /** Always inserted, no keyword needed. */
    constant?: boolean;
    /** Secondary keys are in play. */
    selective?: boolean;
    selectiveLogic?: WiLogic;
    /** Insertion order within a position. */
    order?: number;
    position?: WiPosition;
    /** Depth for `atDepth` positions. */
    depth?: number;
    /** Message role for `atDepth` insertions. */
    role?: number | null;
    /** True when the entry is switched off. */
    disable?: boolean;
    probability?: number;
    useProbability?: boolean;
    /** Per-entry override for how many recent messages are scanned. */
    scanDepth?: number | null;
    caseSensitive?: boolean | null;
    matchWholeWords?: boolean | null;
    excludeRecursion?: boolean;
    preventRecursion?: boolean;
    delayUntilRecursion?: boolean | number;
    /** Display order in the classic editor. */
    displayIndex?: number;
    addMemo?: boolean;
    group?: string;
    groupOverride?: boolean;
    groupWeight?: number;
    useGroupScoring?: boolean | null;
    sticky?: number;
    cooldown?: number;
    delay?: number;
    vectorized?: boolean;
    automationId?: string;
    /** Namespaced extras. This app writes under `st_next`. */
    extensions?: Record<string, unknown>;
    [key: string]: unknown;
}

/** A lorebook file. */
export interface WorldInfoBook {
    name?: string;
    entries: Record<string, WorldInfoEntry>;
    extensions?: Record<string, unknown>;
    [key: string]: unknown;
}

/** A book as listed, without its entries. */
export interface WorldInfoSummary {
    file_id: string;
    name: string;
    extensions?: Record<string, unknown>;
}

export function fetchWorldInfoList(signal?: AbortSignal): Promise<WorldInfoSummary[]> {
    return apiPost<WorldInfoSummary[]>('/api/worldinfo/list', {}, { signal });
}

export function fetchWorldInfoBook(name: string, signal?: AbortSignal): Promise<WorldInfoBook> {
    return apiPost<WorldInfoBook>('/api/worldinfo/get', { name }, { signal });
}

/** Writes a book back. The whole file is replaced. */
export function saveWorldInfoBook(name: string, data: WorldInfoBook): Promise<void> {
    return apiPost('/api/worldinfo/edit', { name, data });
}

export function deleteWorldInfoBook(name: string): Promise<void> {
    return apiPost('/api/worldinfo/delete', { name });
}

/** Imports a lorebook file. Returns the stored book name. */
export async function importWorldInfoBook(file: File): Promise<string> {
    const form = new FormData();
    form.append('avatar', file);
    const result = await apiPostForm<{ name?: string }>('/api/worldinfo/import', form);
    if (!result?.name) {
        throw new Error('The server could not read that lorebook.');
    }
    return result.name;
}

/** The next free uid in a book. */
export function nextEntryUid(book: WorldInfoBook): number {
    const used = Object.values(book.entries ?? {}).map((entry) => Number(entry.uid) || 0);
    return used.length === 0 ? 0 : Math.max(...used) + 1;
}

/** A blank entry, with the defaults the classic editor also writes. */
export function createEntry(uid: number): WorldInfoEntry {
    return {
        uid,
        key: [],
        keysecondary: [],
        comment: '',
        content: '',
        constant: false,
        selective: true,
        selectiveLogic: WI_LOGIC.andAny,
        order: 100,
        position: WI_POSITION.beforeCharacter,
        depth: 4,
        disable: false,
        probability: 100,
        useProbability: true,
        addMemo: true,
        displayIndex: uid,
        excludeRecursion: false,
        preventRecursion: false,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
    };
}
