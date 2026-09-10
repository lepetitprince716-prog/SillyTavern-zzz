import { apiGet, apiPost } from './client';
import type { ChatCompletionSource, UserProfile, VersionInfo } from './types';

/** Secret keys, one per chat completion source. Mirrors `src/constants.js`. */
export const SECRET_KEY_BY_SOURCE: Record<ChatCompletionSource, string> = {
    openai: 'api_key_openai',
    claude: 'api_key_claude',
    openrouter: 'api_key_openrouter',
    makersuite: 'api_key_makersuite',
    deepseek: 'api_key_deepseek',
    mistralai: 'api_key_mistralai',
    xai: 'api_key_xai',
    cohere: 'api_key_cohere',
    custom: 'api_key_custom',
};

/**
 * Which secrets exist, keyed by secret name. The server never returns the
 * values themselves — only whether something is stored.
 */
export type SecretState = Record<string, unknown>;

export function fetchSecretState(signal?: AbortSignal): Promise<SecretState> {
    return apiPost<SecretState>('/api/secrets/read', {}, { signal });
}

/** Stores an API key server-side. The key never touches browser storage. */
export function writeSecret(key: string, value: string): Promise<{ id?: string }> {
    return apiPost<{ id?: string }>('/api/secrets/write', { key, value });
}

/** True when a key is configured for the given source. */
export function hasSecret(state: SecretState | undefined, source: ChatCompletionSource): boolean {
    if (!state) {
        return false;
    }
    const value = state[SECRET_KEY_BY_SOURCE[source]];
    if (Array.isArray(value)) {
        return value.length > 0;
    }
    return Boolean(value);
}

export function fetchCurrentUser(signal?: AbortSignal): Promise<UserProfile> {
    return apiGet<UserProfile>('/api/users/me', { signal });
}

export function fetchVersion(signal?: AbortSignal): Promise<VersionInfo> {
    return apiGet<VersionInfo>('/version', { signal });
}

/** A user persona: the name and avatar the human side of the chat uses. */
export interface Persona {
    /** Avatar file name, which is also the persona's id. */
    avatar: string;
    name: string;
    description: string;
}

/**
 * Lists persona avatars.
 * Persona names and descriptions live inside the monolithic settings blob;
 * `POST /api/avatars/get` only knows the files, so names default to the file
 * stem until {@link personasFromSettings} enriches them.
 */
export function fetchPersonaAvatars(signal?: AbortSignal): Promise<string[]> {
    return apiPost<string[]>('/api/avatars/get', {}, { signal });
}

/** The raw settings blob, as stored by the legacy UI. */
export interface SettingsResponse {
    settings: string;
    world_names?: string[];
    [key: string]: unknown;
}

export function fetchSettings(signal?: AbortSignal): Promise<SettingsResponse> {
    return apiPost<SettingsResponse>('/api/settings/get', {}, { signal });
}

interface PowerUserPersonas {
    personas?: Record<string, string>;
    persona_descriptions?: Record<string, { description?: string }>;
    default_persona?: string;
}

/**
 * Extracts personas from the settings blob written by the legacy UI, so both
 * interfaces show the same list.
 * @param settingsJson The `settings` string from {@link fetchSettings}.
 * @param avatars Avatar files from {@link fetchPersonaAvatars}.
 */
export function personasFromSettings(settingsJson: string, avatars: string[]): Persona[] {
    let powerUser: PowerUserPersonas = {};
    try {
        const parsed = JSON.parse(settingsJson) as { power_user?: PowerUserPersonas };
        powerUser = parsed.power_user ?? {};
    } catch {
        // A corrupt settings file should not take the persona picker down.
    }

    const names = powerUser.personas ?? {};
    const descriptions = powerUser.persona_descriptions ?? {};

    return avatars.map((avatar) => ({
        avatar,
        name: names[avatar] ?? avatar.replace(/\.[^.]+$/, ''),
        description: descriptions[avatar]?.description ?? '',
    }));
}

/** The persona the legacy UI has marked as default, if any. */
export function defaultPersonaAvatar(settingsJson: string): string | null {
    try {
        const parsed = JSON.parse(settingsJson) as { power_user?: PowerUserPersonas };
        return parsed.power_user?.default_persona ?? null;
    } catch {
        return null;
    }
}
