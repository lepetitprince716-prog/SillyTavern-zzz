/**
 * Character card creation and editing.
 *
 * The backend rebuilds a card from a flat, snake_case form body, using
 * `json_data` as the base so fields it does not model survive the round trip.
 * Getting that payload wrong silently drops data from someone's card, so the
 * conversion lives in pure functions here and is covered by tests.
 */

import { apiPost, apiPostBlob, apiPostForm } from './client';
import type { Character } from './types';

/** Where a depth prompt is injected from. */
export type DepthPromptRole = 'system' | 'user' | 'assistant';

/** A card as the editor holds it: camelCase, no nesting, no optionals. */
export interface CharacterDraft {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    firstMessage: string;
    messageExample: string;
    creatorNotes: string;
    systemPrompt: string;
    postHistoryInstructions: string;
    alternateGreetings: string[];
    tags: string[];
    creator: string;
    characterVersion: string;
    /** 0–1; how eagerly the character speaks in group chats. */
    talkativeness: number;
    favourite: boolean;
    /** Name of a world info book bound to this card. */
    world: string;
    depthPromptText: string;
    depthPromptDepth: number;
    depthPromptRole: DepthPromptRole;
}

export const EMPTY_DRAFT: CharacterDraft = {
    name: '',
    description: '',
    personality: '',
    scenario: '',
    firstMessage: '',
    messageExample: '',
    creatorNotes: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    alternateGreetings: [],
    tags: [],
    creator: '',
    characterVersion: '',
    talkativeness: 0.5,
    favourite: false,
    world: '',
    depthPromptText: '',
    depthPromptDepth: 4,
    depthPromptRole: 'system',
};

function readExtension(character: Character, key: string): unknown {
    return character.data?.extensions?.[key];
}

function asRole(value: unknown): DepthPromptRole {
    return value === 'user' || value === 'assistant' ? value : 'system';
}

/**
 * Reads a card into an editor draft.
 * V2 `data` fields win over the legacy root fields, which is the precedence
 * every V2-aware client uses.
 */
export function characterToDraft(character: Character): CharacterDraft {
    const data = character.data;
    const depthPrompt = readExtension(character, 'depth_prompt') as
        | { prompt?: string; depth?: number; role?: string }
        | undefined;
    const talkativeness = Number(
        readExtension(character, 'talkativeness') ?? character.talkativeness ?? 0.5,
    );

    const tags = [...new Set([...(data?.tags ?? []), ...(character.tags ?? [])])].filter(
        (tag) => typeof tag === 'string' && tag.trim(),
    );

    return {
        name: data?.name ?? character.name ?? '',
        description: data?.description ?? character.description ?? '',
        personality: data?.personality ?? character.personality ?? '',
        scenario: data?.scenario ?? character.scenario ?? '',
        firstMessage: data?.first_mes ?? character.first_mes ?? '',
        messageExample: data?.mes_example ?? character.mes_example ?? '',
        creatorNotes: data?.creator_notes ?? character.creatorcomment ?? '',
        systemPrompt: data?.system_prompt ?? '',
        postHistoryInstructions: data?.post_history_instructions ?? '',
        alternateGreetings: [...(data?.alternate_greetings ?? [])],
        tags,
        creator: data?.creator ?? '',
        characterVersion: data?.character_version ?? '',
        talkativeness: Number.isFinite(talkativeness) ? talkativeness : 0.5,
        favourite: character.fav === true || character.fav === 'true',
        world: String(readExtension(character, 'world') ?? ''),
        depthPromptText: depthPrompt?.prompt ?? '',
        depthPromptDepth: Number.isFinite(Number(depthPrompt?.depth)) ? Number(depthPrompt?.depth) : 4,
        depthPromptRole: asRole(depthPrompt?.role),
    };
}

/** The flat body the create and edit endpoints consume. */
export type CharacterPayload = Record<string, string | number | string[]>;

/**
 * Builds the request body for `/create` or `/edit`.
 *
 * @param draft The edited values.
 * @param original The card being edited, when there is one. Its `json_data`
 * carries fields the server does not model — third-party extension data, for
 * instance — and passing it back is the only thing that keeps them.
 */
export function draftToPayload(draft: CharacterDraft, original?: Character): CharacterPayload {
    const payload: CharacterPayload = {
        ch_name: draft.name.trim(),
        description: draft.description,
        personality: draft.personality,
        scenario: draft.scenario,
        first_mes: draft.firstMessage,
        mes_example: draft.messageExample,
        creator_notes: draft.creatorNotes,
        system_prompt: draft.systemPrompt,
        post_history_instructions: draft.postHistoryInstructions,
        alternate_greetings: draft.alternateGreetings.filter((greeting) => greeting.trim()),
        tags: draft.tags.map((tag) => tag.trim()).filter(Boolean),
        creator: draft.creator,
        character_version: draft.characterVersion,
        talkativeness: draft.talkativeness,
        // The server compares this against the string 'true'.
        fav: draft.favourite ? 'true' : 'false',
        world: draft.world,
        depth_prompt_prompt: draft.depthPromptText,
        depth_prompt_depth: draft.depthPromptDepth,
        depth_prompt_role: draft.depthPromptRole,
    };

    if (original) {
        payload.avatar_url = original.avatar;
        if (typeof original.json_data === 'string') {
            payload.json_data = original.json_data;
        }
        // The server regenerates both unless they are sent back, which would
        // detach the card from its current chat and reset its creation date.
        payload.chat = original.chat ?? '';
        payload.create_date = String(original.create_date ?? '');
    }

    return payload;
}

/** Creates a new character. Returns its avatar file name. */
export async function createCharacter(draft: CharacterDraft): Promise<string> {
    const result = await apiPost<string>('/api/characters/create', draftToPayload(draft));
    return typeof result === 'string' ? result : '';
}

/** Saves edits to an existing character. */
export async function updateCharacter(original: Character, draft: CharacterDraft): Promise<void> {
    await apiPost('/api/characters/edit', draftToPayload(draft, original));
}

/** Replaces a character's avatar image. */
export async function uploadCharacterAvatar(avatar: string, file: File): Promise<void> {
    const form = new FormData();
    form.append('avatar', file);
    form.append('avatar_url', avatar);
    await apiPostForm('/api/characters/edit-avatar', form);
}

/** Formats a character card file can be imported from. */
const IMPORT_FORMATS = new Set(['png', 'json', 'yaml', 'yml', 'charx', 'byaf']);

/** The `file_type` the import endpoint expects for a given file. */
export function importFormatForFile(fileName: string): string | null {
    const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
    return IMPORT_FORMATS.has(extension) ? extension : null;
}

/**
 * Imports a character card file.
 * @returns The new character's file name.
 * @throws If the file extension is not a supported card format.
 */
export async function importCharacter(file: File): Promise<string> {
    const format = importFormatForFile(file.name);
    if (!format) {
        throw new Error(
            `${file.name} is not a character card. Supported: PNG, JSON, YAML, CHARX, BYAF.`,
        );
    }
    const form = new FormData();
    form.append('avatar', file);
    form.append('file_type', format);
    const result = await apiPostForm<{ file_name?: string; error?: boolean }>(
        '/api/characters/import',
        form,
    );
    if (!result?.file_name) {
        throw new Error('The server could not read that card.');
    }
    return result.file_name;
}

/** Downloads a character card. */
export async function exportCharacter(character: Character, format: 'png' | 'json'): Promise<void> {
    const blob = await apiPostBlob('/api/characters/export', {
        avatar_url: character.avatar,
        format,
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${character.name || 'character'}.${format}`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

/** Deletes a character, and optionally its chats. */
export async function deleteCharacter(avatar: string, deleteChats: boolean): Promise<void> {
    await apiPost('/api/characters/delete', { avatar_url: avatar, delete_chats: deleteChats });
}

/** Copies a character. Returns the new avatar file name. */
export async function duplicateCharacter(avatar: string): Promise<string> {
    const result = await apiPost<{ path?: string } | string>('/api/characters/duplicate', {
        avatar_url: avatar,
    });
    if (typeof result === 'string') {
        return result;
    }
    return result?.path ?? '';
}

/** Renames a character, moving its chat folder with it. */
export async function renameCharacter(avatar: string, newName: string): Promise<string> {
    const result = await apiPost<{ avatar?: string }>('/api/characters/rename', {
        avatar_url: avatar,
        new_name: newName,
    });
    return result?.avatar ?? '';
}
