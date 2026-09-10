/**
 * This app's own per-entry settings.
 *
 * Stored under `entry.extensions.st_next` so the classic interface, which
 * ignores extension keys it does not know, keeps working on the same book file.
 */

import type { WorldInfoEntry } from '@/api/worldinfo';

const NAMESPACE = 'st_next';

export interface NextEntrySettings {
    /**
     * Whether this entry may activate on meaning as well as on keys.
     * Defaults to true, so turning semantic matching on works without editing
     * every entry, and an author can opt a precise entry back out.
     */
    allowSemantic?: boolean;
}

/** Reads this app's settings off an entry. */
export function readEntrySettings(entry: WorldInfoEntry): NextEntrySettings {
    const bag = entry.extensions?.[NAMESPACE];
    return bag && typeof bag === 'object' ? (bag as NextEntrySettings) : {};
}

/** True unless the entry has explicitly opted out of semantic activation. */
export function allowsSemantic(entry: WorldInfoEntry): boolean {
    return readEntrySettings(entry).allowSemantic !== false;
}

/** Returns a copy of the entry with this app's settings patched. */
export function writeEntrySettings(
    entry: WorldInfoEntry,
    patch: NextEntrySettings,
): WorldInfoEntry {
    return {
        ...entry,
        extensions: {
            ...(entry.extensions ?? {}),
            [NAMESPACE]: { ...readEntrySettings(entry), ...patch },
        },
    };
}
