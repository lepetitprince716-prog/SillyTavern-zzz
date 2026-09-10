/**
 * Persona management.
 *
 * Persona names and descriptions live inside the monolithic `settings.json`
 * that the classic interface owns, and `POST /api/settings/save` replaces that
 * whole file. So every change here is a read-modify-write: fetch the current
 * settings, patch only the persona keys, write it back. The patch itself is a
 * pure function so it can be tested without touching a file.
 */

import { apiPost, apiPostForm } from './client';
import { fetchSettings } from './settings';

/** The persona-related corner of the `power_user` settings block. */
export interface PersonaSettings {
    personas?: Record<string, string>;
    persona_descriptions?: Record<string, { description?: string; [key: string]: unknown }>;
    default_persona?: string | null;
    [key: string]: unknown;
}

/** The shape of settings.json that this module cares about. */
export interface SettingsDocument {
    power_user?: PersonaSettings;
    [key: string]: unknown;
}

export interface PersonaPatch {
    avatar: string;
    /** New display name. Omit to leave it alone. */
    name?: string;
    /** New description. Omit to leave it alone. */
    description?: string;
    /** Make this the default persona, or clear the default if it is this one. */
    isDefault?: boolean;
    /** Remove the persona's entries entirely. */
    remove?: boolean;
}

/**
 * Applies a persona change to a settings document.
 *
 * Returns a new document; the input is not mutated. Unknown keys — anywhere in
 * the file, and inside each persona description — are carried through, because
 * this file belongs to the classic interface and is full of fields this app
 * knows nothing about.
 */
export function patchPersonaSettings(
    settings: SettingsDocument,
    patch: PersonaPatch,
): SettingsDocument {
    const powerUser: PersonaSettings = { ...(settings.power_user ?? {}) };
    const personas: Record<string, string> = { ...(powerUser.personas ?? {}) };
    const descriptions: PersonaSettings['persona_descriptions'] = {
        ...(powerUser.persona_descriptions ?? {}),
    };

    if (patch.remove) {
        delete personas[patch.avatar];
        delete descriptions[patch.avatar];
        if (powerUser.default_persona === patch.avatar) {
            powerUser.default_persona = null;
        }
    } else {
        if (patch.name !== undefined) {
            personas[patch.avatar] = patch.name;
        }
        if (patch.description !== undefined) {
            descriptions[patch.avatar] = {
                ...(descriptions[patch.avatar] ?? {}),
                description: patch.description,
            };
        }
        if (patch.isDefault === true) {
            powerUser.default_persona = patch.avatar;
        } else if (patch.isDefault === false && powerUser.default_persona === patch.avatar) {
            powerUser.default_persona = null;
        }
    }

    powerUser.personas = personas;
    powerUser.persona_descriptions = descriptions;

    return { ...settings, power_user: powerUser };
}

/**
 * Reads the current settings, applies a persona change and writes it back.
 *
 * The read happens immediately before the write to keep the window in which
 * the classic interface could save over the same file as small as possible.
 */
export async function savePersonaPatch(patch: PersonaPatch): Promise<void> {
    const response = await fetchSettings();
    let settings: SettingsDocument;
    try {
        settings = JSON.parse(response.settings) as SettingsDocument;
    } catch {
        throw new Error('The settings file could not be read, so the persona was not saved.');
    }
    await apiPost('/api/settings/save', patchPersonaSettings(settings, patch));
}

/**
 * Uploads a persona avatar image.
 * @param overwriteName Existing file name to replace, for editing an avatar.
 * @returns The stored file name, which is also the persona's id.
 */
export async function uploadPersonaAvatar(file: File, overwriteName?: string): Promise<string> {
    const form = new FormData();
    form.append('avatar', file);
    if (overwriteName) {
        form.append('overwrite_name', overwriteName);
    }
    const result = await apiPostForm<{ path?: string }>('/api/avatars/upload', form);
    if (!result?.path) {
        throw new Error('The server did not accept that image.');
    }
    return result.path;
}

/** Deletes a persona avatar file. */
export async function deletePersonaAvatar(avatar: string): Promise<void> {
    await apiPost('/api/avatars/delete', { avatar });
}
