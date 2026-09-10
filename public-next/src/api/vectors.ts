/**
 * Vector storage, used for semantic world info matching.
 *
 * The backend owns the embedding model and the index; this module only shuttles
 * text in and similarity scores out. The default source, `transformers`, runs a
 * local model, so semantic matching needs no API key - but the first call
 * downloads that model, which is why the feature is opt-in.
 */

import { apiPost } from './client';

/** Embedding backends the server supports. `transformers` is local. */
export type VectorSource = 'transformers' | 'openai' | 'cohere' | 'ollama' | 'llamacpp' | 'vllm';

export interface VectorItem {
    /** Stable id for the text. Changing the text must change the hash. */
    hash: number;
    text: string;
    /** Caller-defined ordinal, echoed back in metadata. */
    index: number;
}

export interface VectorQueryResult {
    /** Metadata of items that cleared the threshold. */
    metadata: Array<{ hash?: number; index?: number; [key: string]: unknown }>;
    /** Every hash the query touched, best first. */
    hashes: number[];
    /** Similarity per hash. Added by this fork so matches can be explained. */
    scores?: Array<{ hash: number; score: number }>;
}

/**
 * A stable 32-bit hash of an entry's identity and content.
 *
 * Editing the content changes the hash, which is what makes incremental
 * re-indexing possible: a hash the index has not seen needs embedding.
 */
export function hashVectorText(uid: number, text: string): number {
    const input = `${uid} ${text}`;
    // FNV-1a, kept in the positive 31-bit range because the server coerces the
    // hash through Number and compares it numerically.
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 1;
}

/** Collection name for a lorebook's entries. */
export function bookCollectionId(bookName: string): string {
    return `st-next-wi-${bookName}`;
}

export function insertVectors(
    collectionId: string,
    items: VectorItem[],
    source: VectorSource = 'transformers',
): Promise<void> {
    return apiPost('/api/vector/insert', { collectionId, items, source });
}

export async function listVectorHashes(
    collectionId: string,
    source: VectorSource = 'transformers',
): Promise<number[]> {
    const hashes = await apiPost<number[]>('/api/vector/list', { collectionId, source });
    return Array.isArray(hashes) ? hashes : [];
}

export function queryVectors(
    collectionId: string,
    searchText: string,
    options: { topK?: number; threshold?: number; source?: VectorSource; signal?: AbortSignal } = {},
): Promise<VectorQueryResult> {
    return apiPost<VectorQueryResult>(
        '/api/vector/query',
        {
            collectionId,
            searchText,
            topK: options.topK ?? 20,
            threshold: options.threshold ?? 0,
            source: options.source ?? 'transformers',
        },
        options.signal ? { signal: options.signal } : {},
    );
}

/** Removes a collection, e.g. after a book is deleted. */
export function purgeVectors(collectionId: string, source: VectorSource = 'transformers'): Promise<void> {
    return apiPost('/api/vector/purge', { collectionId, source });
}
