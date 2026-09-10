/**
 * Mutations for the character library.
 *
 * Every one of these writes a PNG on disk, so they share two rules: report
 * failure to the user rather than swallowing it, and invalidate the library
 * query afterwards so the UI reflects what is actually on disk instead of an
 * optimistic guess that could be wrong.
 */

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useCallback } from 'react';
import {
    characterToDraft,
    createCharacter,
    deleteCharacter,
    duplicateCharacter,
    importCharacter,
    updateCharacter,
    uploadCharacterAvatar,
    type CharacterDraft,
} from '@/api/character-edit';
import { fetchCharacter } from '@/api/characters';
import { queryKeys } from '@/api/queries';
import type { Character } from '@/api/types';
import { toast } from '@/lib/toast';

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export interface SaveCharacterInput {
    draft: CharacterDraft;
    /** Absent for a new character. */
    original?: Character;
    /** A replacement avatar image, if the user picked one. */
    avatarFile?: File | null;
}

export interface CharacterMutations {
    save: UseMutationResult<string, Error, SaveCharacterInput>;
    remove: UseMutationResult<void, Error, { avatar: string; deleteChats: boolean }>;
    duplicate: UseMutationResult<string, Error, string>;
    importFile: UseMutationResult<string, Error, File>;
    toggleFavourite: UseMutationResult<void, Error, Character>;
    /** Imports several files in sequence, reporting once at the end. */
    importFiles(files: File[]): Promise<void>;
}

export function useCharacterMutations(): CharacterMutations {
    const queryClient = useQueryClient();

    const refreshLibrary = useCallback(
        () => queryClient.invalidateQueries({ queryKey: queryKeys.characters }),
        [queryClient],
    );

    const save = useMutation<string, Error, SaveCharacterInput>({
        mutationFn: async ({ draft, original, avatarFile }) => {
            if (!draft.name.trim()) {
                throw new Error('A character needs a name.');
            }

            // The card is written first so a failed avatar upload cannot leave
            // the text edits unsaved.
            const avatar = original
                ? (await updateCharacter(original, draft), original.avatar)
                : await createCharacter(draft);

            if (!avatar) {
                throw new Error('The server did not return the new character.');
            }

            if (avatarFile) {
                await uploadCharacterAvatar(avatar, avatarFile);
            }

            return avatar;
        },
        onSuccess: async (_avatar, { original }) => {
            await refreshLibrary();
            toast.success(original ? 'Character saved' : 'Character created');
        },
        onError: (error) => toast.error('Could not save the character', describe(error)),
    });

    const remove = useMutation<void, Error, { avatar: string; deleteChats: boolean }>({
        mutationFn: ({ avatar, deleteChats }) => deleteCharacter(avatar, deleteChats),
        onSuccess: async (_result, { avatar }) => {
            await refreshLibrary();
            queryClient.removeQueries({ queryKey: queryKeys.characterChats(avatar) });
            toast.success('Character deleted');
        },
        onError: (error) => toast.error('Could not delete the character', describe(error)),
    });

    const duplicate = useMutation<string, Error, string>({
        mutationFn: (avatar) => duplicateCharacter(avatar),
        onSuccess: async () => {
            await refreshLibrary();
            toast.success('Character duplicated');
        },
        onError: (error) => toast.error('Could not duplicate the character', describe(error)),
    });

    const importFile = useMutation<string, Error, File>({
        mutationFn: (file) => importCharacter(file),
        onSuccess: async (fileName) => {
            await refreshLibrary();
            toast.success('Character imported', fileName);
        },
        onError: (error) => toast.error('Could not import that file', describe(error)),
    });

    const toggleFavourite = useMutation<void, Error, Character>({
        /**
         * Written as a full card edit rather than through
         * `/api/characters/edit-attribute`.
         *
         * The favourite flag really lives at `data.extensions.fav`, and the read
         * path always prefers that over the legacy top-level `fav`. The
         * attribute endpoint only writes the legacy field, so it leaves the card
         * inconsistent and the change invisible.
         */
        mutationFn: async (character) => {
            const full = await fetchCharacter(character.avatar);
            const draft = characterToDraft(full);
            await updateCharacter(full, { ...draft, favourite: !draft.favourite });
        },
        onSuccess: () => void refreshLibrary(),
        onError: (error) => toast.error('Could not update the favourite', describe(error)),
    });

    /**
     * Imports a batch sequentially.
     *
     * Sequential on purpose: each import writes a PNG and derives a unique file
     * name from what is already on disk, so parallel imports of same-named
     * cards can collide.
     */
    const importFiles = useCallback(
        async (files: File[]) => {
            const failures: string[] = [];
            let imported = 0;

            for (const file of files) {
                try {
                    await importCharacter(file);
                    imported++;
                } catch (error) {
                    failures.push(`${file.name}: ${describe(error)}`);
                }
            }

            await refreshLibrary();

            if (imported > 0) {
                toast.success(`Imported ${imported} character${imported === 1 ? '' : 's'}`);
            }
            if (failures.length > 0) {
                toast.error(
                    `${failures.length} file${failures.length === 1 ? '' : 's'} could not be imported`,
                    failures.slice(0, 3).join('\n'),
                );
            }
        },
        [refreshLibrary],
    );

    return { save, remove, duplicate, importFile, toggleFavourite, importFiles };
}
