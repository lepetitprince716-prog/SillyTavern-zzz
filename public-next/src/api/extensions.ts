/**
 * Extension management.
 *
 * The server already exposes everything needed to manage extensions —
 * `/api/extensions/discover`, `install`, `update`, `version`, `move`,
 * `branches`, `switch` and `delete` — and the enabled/disabled list lives in
 * the same `settings.json` the classic interface owns. So management needs no
 * new endpoint.
 *
 * What it does *not* give you is the manifests: `discover` returns folder
 * names and where they came from, nothing else. The classic UI fetches each
 * `manifest.json` from the static path afterwards, and so does this — those
 * files are served by the same route that serves the extension's own scripts,
 * including the per-user and global third-party directories.
 */

import { apiGet, apiPost } from './client';
import { updateSettings } from './settings';

/** Where an extension is installed. */
export type ExtensionScope =
    /** Bundled with SillyTavern, under `public/scripts/extensions`. */
    | 'system'
    /** Installed by this user, under `data/<user>/extensions`. */
    | 'local'
    /** Installed for everyone, under `public/scripts/extensions/third-party`. */
    | 'global';

/** One entry of `GET /api/extensions/discover`. */
export interface DiscoveredExtension {
    type: ExtensionScope;
    /** Folder name; third-party ones are prefixed `third-party/`. */
    name: string;
}

/**
 * An extension's `manifest.json`.
 *
 * Every field is optional because these files are written by hand by many
 * different people: the loader tolerates a manifest that is missing anything
 * but `js`, and so must a reader.
 */
export interface ExtensionManifest {
    display_name?: string;
    version?: string;
    author?: string;
    homePage?: string;
    /** Lower loads earlier, which decides who patches what first. */
    loading_order?: number;
    /** Extras API modules without which the extension will not load. */
    requires?: string[];
    /** Extras API modules it can use if present. */
    optional?: string[];
    /** Other extensions that must be installed *and* enabled. */
    dependencies?: string[];
    minimum_client_version?: string;
    /** Named function that rewrites the prompt during generation. */
    generate_interceptor?: string;
    js?: string;
    css?: string;
    [key: string]: unknown;
}

export function fetchDiscoveredExtensions(signal?: AbortSignal): Promise<DiscoveredExtension[]> {
    return apiGet<DiscoveredExtension[]>('/api/extensions/discover', signal ? { signal } : {});
}

/** The static URL an extension's files are served from. */
export function extensionAssetUrl(name: string, file: string): string {
    const segments = name.split('/').map(encodeURIComponent).join('/');
    return `/scripts/extensions/${segments}/${file}`;
}

/**
 * Loads the manifests for the given extensions.
 *
 * A manifest that is missing or unreadable comes back as `null` rather than
 * failing the batch: one broken third-party folder should not empty the list,
 * and "this extension has no readable manifest" is itself worth showing.
 */
export async function fetchManifests(
    names: string[],
    signal?: AbortSignal,
): Promise<Record<string, ExtensionManifest | null>> {
    const entries = await Promise.all(
        names.map(async (name) => {
            try {
                const response = await fetch(extensionAssetUrl(name, 'manifest.json'), {
                    ...(signal ? { signal } : {}),
                });
                if (!response.ok) {
                    return [name, null] as const;
                }
                const manifest = (await response.json()) as unknown;
                if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
                    return [name, null] as const;
                }
                return [name, manifest as ExtensionManifest] as const;
            } catch {
                return [name, null] as const;
            }
        }),
    );
    return Object.fromEntries(entries);
}

/** The corner of `settings.json` that holds the disabled list. */
interface ExtensionSettingsDocument {
    extension_settings?: {
        disabledExtensions?: string[];
        apiUrl?: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

/**
 * Turns an extension on or off in a settings document.
 *
 * Pure, and returns a new document: `POST /api/settings/save` replaces the
 * whole file, so every change is a read-modify-write over a blob full of keys
 * this app knows nothing about.
 */
export function patchDisabledExtensions(
    settings: ExtensionSettingsDocument,
    name: string,
    disabled: boolean,
): ExtensionSettingsDocument {
    const extensionSettings = { ...(settings.extension_settings ?? {}) };
    const current = Array.isArray(extensionSettings.disabledExtensions)
        ? extensionSettings.disabledExtensions
        : [];
    const next = disabled
        ? current.includes(name) ? current : [...current, name]
        : current.filter((entry) => entry !== name);

    return { ...settings, extension_settings: { ...extensionSettings, disabledExtensions: next } };
}

/** Reads the disabled list and the Extras URL out of a raw settings blob. */
export function extensionStateFromSettings(settingsJson: string): {
    disabled: string[];
    extrasUrl: string;
} {
    try {
        const parsed = JSON.parse(settingsJson) as ExtensionSettingsDocument;
        const settings = parsed.extension_settings ?? {};
        return {
            disabled: Array.isArray(settings.disabledExtensions) ? settings.disabledExtensions : [],
            extrasUrl: typeof settings.apiUrl === 'string' ? settings.apiUrl : '',
        };
    } catch {
        return { disabled: [], extrasUrl: '' };
    }
}

/**
 * Enables or disables an extension, preserving the rest of the settings file.
 *
 * Through the shared queue: switching two extensions off in quick succession
 * is two read-modify-write cycles over one file, and unqueued the second
 * silently undoes the first.
 */
export function setExtensionDisabled(name: string, disabled: boolean): Promise<void> {
    return updateSettings<ExtensionSettingsDocument>(
        (settings) => patchDisabledExtensions(settings, name, disabled),
    );
}

export interface InstallResult {
    version?: string;
    author?: string;
    display_name?: string;
    extensionPath?: string;
    folderName?: string;
}

export function installExtension(options: {
    url: string;
    global?: boolean;
    branch?: string;
}): Promise<InstallResult> {
    return apiPost<InstallResult>('/api/extensions/install', {
        url: options.url,
        global: Boolean(options.global),
        ...(options.branch ? { branch: options.branch } : {}),
    });
}

export interface UpdateResult {
    shortCommitHash?: string;
    extensionPath?: string;
    isUpToDate?: boolean;
    remoteUrl?: string;
}

export function updateExtension(name: string, global: boolean): Promise<UpdateResult> {
    return apiPost<UpdateResult>('/api/extensions/update', {
        extensionName: folderOf(name),
        global,
    });
}

export interface VersionInfoResult {
    currentBranchName: string;
    currentCommitHash: string;
    isUpToDate: boolean;
    remoteUrl: string;
}

/**
 * Reads an extension's git state.
 *
 * One call per extension, and each one runs `git fetch origin` server-side, so
 * this is asked for on demand rather than for the whole list at once.
 */
export function fetchExtensionVersion(name: string, global: boolean): Promise<VersionInfoResult> {
    return apiPost<VersionInfoResult>('/api/extensions/version', {
        extensionName: folderOf(name),
        global,
    });
}

export function deleteExtension(name: string, global: boolean): Promise<void> {
    return apiPost('/api/extensions/delete', { extensionName: folderOf(name), global });
}

export function moveExtension(name: string, to: ExtensionScope): Promise<void> {
    return apiPost('/api/extensions/move', {
        extensionName: folderOf(name),
        source: to === 'global' ? 'local' : 'global',
        destination: to,
    });
}

/** One branch from `POST /api/extensions/branches`. */
export interface ExtensionBranch {
    name: string;
    label: string;
    commit: string;
    current: boolean;
}

/**
 * Lists an extension's branches.
 *
 * The route unshallows the clone first, so this is slow on a large repository
 * and is only asked for when the branch picker is opened.
 */
export function fetchExtensionBranches(name: string, global: boolean): Promise<ExtensionBranch[]> {
    return apiPost<ExtensionBranch[]>('/api/extensions/branches', {
        extensionName: folderOf(name),
        global,
    });
}

export function switchExtensionBranch(
    name: string,
    global: boolean,
    branch: string,
): Promise<void> {
    return apiPost('/api/extensions/switch', {
        extensionName: folderOf(name),
        global,
        branch,
    });
}

/**
 * The folder name the git routes expect.
 *
 * `discover` reports third-party extensions as `third-party/<folder>` because
 * that is their URL, but the routes take the folder alone — they resolve it
 * against the user or global extension directory themselves, and `sanitize`
 * would strip the slash.
 */
export function folderOf(name: string): string {
    return name.startsWith('third-party/') ? name.slice('third-party/'.length) : name;
}

/** Probes an Extras server for the modules it provides. */
export async function fetchExtrasModules(url: string, signal?: AbortSignal): Promise<string[]> {
    const base = url.replace(/\/+$/, '');
    const response = await fetch(`${base}/api/modules`, { ...(signal ? { signal } : {}) });
    if (!response.ok) {
        throw new Error(`The Extras server answered ${response.status}.`);
    }
    const body = (await response.json()) as { modules?: unknown };
    return Array.isArray(body.modules) ? body.modules.filter((m): m is string => typeof m === 'string') : [];
}
