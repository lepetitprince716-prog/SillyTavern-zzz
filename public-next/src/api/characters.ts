import { apiPost } from './client';
import type { Character, ChatSummary } from './types';

/** Loads every character in the user's library. */
export function fetchCharacters(signal?: AbortSignal): Promise<Character[]> {
    return apiPost<Character[]>('/api/characters/all', { shallow: false }, { signal });
}

/** Loads one character with all card fields populated. */
export function fetchCharacter(avatar: string, signal?: AbortSignal): Promise<Character> {
    return apiPost<Character>('/api/characters/get', { avatar_url: avatar }, { signal });
}

/**
 * Lists a character's saved chats, newest first.
 * The endpoint answers `{ error: true }` when the character has no chat folder
 * yet, which is a normal state rather than a failure.
 */
export async function fetchCharacterChats(
    avatar: string,
    signal?: AbortSignal,
): Promise<ChatSummary[]> {
    const result = await apiPost<ChatSummary[] | { error: true }>(
        '/api/characters/chats',
        { avatar_url: avatar },
        { signal },
    );
    return Array.isArray(result) ? result : [];
}

/** URL of a character's avatar thumbnail. */
export function avatarUrl(avatar: string | undefined): string {
    if (!avatar || avatar === 'none') {
        return '';
    }
    return `/thumbnail?type=avatar&file=${encodeURIComponent(avatar)}`;
}

/** URL of a persona avatar thumbnail. */
export function personaAvatarUrl(avatar: string | undefined): string {
    if (!avatar) {
        return '';
    }
    return `/thumbnail?type=persona&file=${encodeURIComponent(avatar)}`;
}

/** Reads a card field, preferring the V2 `data` block over the legacy root. */
export function cardField(
    character: Character | undefined,
    field: 'description' | 'personality' | 'scenario' | 'first_mes' | 'mes_example',
): string {
    if (!character) {
        return '';
    }
    return character.data?.[field] ?? character[field] ?? '';
}

/** Greetings available for a character: the primary one plus alternates. */
export function greetings(character: Character | undefined): string[] {
    if (!character) {
        return [];
    }
    const primary = cardField(character, 'first_mes');
    const alternates = character.data?.alternate_greetings ?? [];
    return [primary, ...alternates].filter((greeting) => greeting.trim().length > 0);
}

/** All tags on a character, de-duplicated. */
export function characterTags(character: Character): string[] {
    const merged = [...(character.tags ?? []), ...(character.data?.tags ?? [])];
    return [...new Set(merged.filter((tag) => typeof tag === 'string' && tag.trim()))];
}
