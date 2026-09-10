/**
 * TanStack Query bindings.
 *
 * Query keys live here so that cache invalidation after a mutation cannot drift
 * from the keys the readers use.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { fetchCharacterChats, fetchCharacters } from './characters';
import { fetchChat, type LoadedChat } from './chats';
import { fetchModels } from './generate';
import {
    defaultPersonaAvatar,
    fetchCurrentUser,
    fetchPersonaAvatars,
    fetchSecretState,
    fetchSettings,
    fetchVersion,
    personasFromSettings,
    type Persona,
    type SecretState,
} from './settings';
import type { Character, ChatCompletionSource, ChatSummary, UserProfile, VersionInfo } from './types';
import { fetchWorldInfoBook, fetchWorldInfoList, type WorldInfoBook, type WorldInfoSummary } from './worldinfo';

export const queryKeys = {
    characters: ['characters'] as const,
    characterChats: (avatar: string) => ['characters', avatar, 'chats'] as const,
    chat: (avatar: string, fileName: string) => ['chat', avatar, fileName] as const,
    models: (source: ChatCompletionSource, customUrl: string) => ['models', source, customUrl] as const,
    secrets: ['secrets'] as const,
    personas: ['personas'] as const,
    user: ['user'] as const,
    version: ['version'] as const,
    worldInfoList: ['worldinfo'] as const,
    worldInfoBook: (name: string) => ['worldinfo', name] as const,
};

/** The character library. Cached aggressively — it changes only on import. */
export function useCharacters(): UseQueryResult<Character[]> {
    return useQuery({
        queryKey: queryKeys.characters,
        queryFn: ({ signal }) => fetchCharacters(signal),
        staleTime: 60_000,
    });
}

export function useCharacterChats(avatar: string | null): UseQueryResult<ChatSummary[]> {
    return useQuery({
        queryKey: queryKeys.characterChats(avatar ?? ''),
        queryFn: ({ signal }) => fetchCharacterChats(avatar as string, signal),
        enabled: Boolean(avatar),
        staleTime: 15_000,
    });
}

/**
 * A chat's messages.
 *
 * `staleTime: Infinity` is deliberate: while a generation streams, this cache
 * entry is the source of truth and is written through by the send/swipe
 * mutations. A background refetch would clobber in-flight edits.
 */
export function useChat(avatar: string | null, fileName: string | null): UseQueryResult<LoadedChat> {
    return useQuery({
        queryKey: queryKeys.chat(avatar ?? '', fileName ?? ''),
        queryFn: ({ signal }) => fetchChat(avatar as string, fileName as string, signal),
        enabled: Boolean(avatar && fileName),
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: 10 * 60_000,
    });
}

/**
 * The provider's model list.
 * @param enabled Pass false to skip the request entirely — used when no API key
 * is configured yet, so the settings panel does not fire a call that is certain
 * to fail.
 */
export function useModels(
    source: ChatCompletionSource,
    customUrl: string,
    enabled = true,
): UseQueryResult<string[]> {
    return useQuery({
        queryKey: queryKeys.models(source, customUrl),
        queryFn: ({ signal }) => fetchModels(source, customUrl || undefined, signal),
        enabled,
        staleTime: 5 * 60_000,
        retry: false,
    });
}

export function useSecretState(): UseQueryResult<SecretState> {
    return useQuery({
        queryKey: queryKeys.secrets,
        queryFn: ({ signal }) => fetchSecretState(signal),
        staleTime: 30_000,
    });
}

export interface PersonaList {
    personas: Persona[];
    defaultAvatar: string | null;
}

/**
 * Personas, assembled from the avatar list and the legacy settings blob so the
 * two interfaces agree on names and descriptions.
 */
export function usePersonas(): UseQueryResult<PersonaList> {
    return useQuery({
        queryKey: queryKeys.personas,
        queryFn: async ({ signal }) => {
            const [avatars, settings] = await Promise.all([
                fetchPersonaAvatars(signal),
                fetchSettings(signal),
            ]);
            return {
                personas: personasFromSettings(settings.settings, avatars),
                defaultAvatar: defaultPersonaAvatar(settings.settings),
            } satisfies PersonaList;
        },
        staleTime: 60_000,
    });
}

export function useCurrentUser(): UseQueryResult<UserProfile> {
    return useQuery({
        queryKey: queryKeys.user,
        queryFn: ({ signal }) => fetchCurrentUser(signal),
        staleTime: 5 * 60_000,
        retry: false,
    });
}

/** The lorebooks on disk, without their entries. */
export function useWorldInfoList(): UseQueryResult<WorldInfoSummary[]> {
    return useQuery({
        queryKey: queryKeys.worldInfoList,
        queryFn: ({ signal }) => fetchWorldInfoList(signal),
        staleTime: 30_000,
    });
}

/**
 * One lorebook, with entries.
 *
 * `staleTime: Infinity` because the editor writes through this cache entry; a
 * background refetch would discard edits that have not been saved yet.
 */
export function useWorldInfoBook(name: string | null): UseQueryResult<WorldInfoBook> {
    return useQuery({
        queryKey: queryKeys.worldInfoBook(name ?? ''),
        queryFn: ({ signal }) => fetchWorldInfoBook(name as string, signal),
        enabled: Boolean(name),
        staleTime: Number.POSITIVE_INFINITY,
    });
}

export function useVersion(): UseQueryResult<VersionInfo> {
    return useQuery({
        queryKey: queryKeys.version,
        queryFn: ({ signal }) => fetchVersion(signal),
        staleTime: Number.POSITIVE_INFINITY,
        retry: false,
    });
}
