/**
 * Why each extension is, or is not, doing anything.
 *
 * The classic loader gates every extension on four conditions and then reports
 * the failures as a flat list of sentences in one error block at the bottom of
 * the panel, detached from the rows they are about. Three of the four are only
 * ever reported there: the extension's own row shows missing Extras modules
 * and nothing else, so an extension held back by a dependency or by a client
 * version requirement simply looks switched off.
 *
 * The gates, in the order the loader applies them, are:
 *
 * 1. `minimum_client_version` against the running build,
 * 2. `requires` — Extras API modules, without which it will not load,
 * 3. `dependencies` — other extensions, which must be installed *and* enabled,
 * 4. the user's own `disabledExtensions` list.
 *
 * There is a fifth condition the classic UI has no reason to state and this
 * one does: an extension's code is written against the classic DOM and the
 * globals in `script.js`, so it does not run in this interface at all. An
 * extension that is enabled and healthy is still not affecting what you read
 * here — unless this frontend implements the same thing natively, which for a
 * few of them it does.
 */

import type { ExtensionManifest, ExtensionScope } from '@/api/extensions';

/** What is stopping an extension from doing anything, or nothing. */
export type ExtensionState =
    /** Loads in the classic interface. */
    | 'active'
    /** Switched off by the user. */
    | 'disabled'
    /** Needs Extras modules that are not available. */
    | 'missing-modules'
    /** Needs extensions that are not installed. */
    | 'missing-dependencies'
    /** Needs extensions that are installed but switched off. */
    | 'disabled-dependencies'
    /** Needs a newer SillyTavern than this one. */
    | 'client-too-old'
    /** The folder has no readable `manifest.json`. */
    | 'no-manifest';

/** How much of the extension applies to the modern frontend. */
export type ModernSupport =
    /** This interface implements the same thing itself. */
    | 'native'
    /** Its own settings and effects are in the classic interface only. */
    | 'classic-only';

export interface ExtensionStatus {
    name: string;
    folder: string;
    scope: ExtensionScope;
    displayName: string;
    manifest: ExtensionManifest | null;
    state: ExtensionState;
    /** True when nothing is holding it back in the classic interface. */
    active: boolean;
    disabled: boolean;
    /** Third-party extensions can be updated, moved and deleted. */
    installed: boolean;
    support: ModernSupport;
    /** Where the same capability lives here, when `support` is `native`. */
    nativeAt?: { label: string; path: string };
    /** Extras modules it needs that are not available. */
    missingModules: string[];
    /** Extras modules it can use that are not available. */
    missingOptional: string[];
    /** Dependencies that are not installed. */
    missingDependencies: string[];
    /** Dependencies that are installed but switched off. */
    disabledDependencies: string[];
    /** Rewrites the prompt during generation in the classic interface. */
    interceptsGeneration: boolean;
    loadingOrder: number;
}

/**
 * The bundled extensions whose job this frontend does itself.
 *
 * Deliberately short and specific. Claiming coverage that does not exist is
 * worse than saying nothing: the reader would leave an extension switched off
 * expecting this interface to cover it.
 */
export const NATIVE_EQUIVALENTS: Record<string, { label: string; path: string }> = {
    'stable-diffusion': { label: 'Image generation', path: '/characters' },
    vectors: { label: 'World info, matching by meaning', path: '/worldinfo' },
};

/**
 * Compares versions the way the classic loader does.
 *
 * `localeCompare` with numeric collation, matching `versionCompare` in
 * `public/scripts/utils.js` exactly — including that it reads `1.18.0-rc1` as
 * newer than `1.18.0`. The two interfaces have to agree on whether an
 * extension can load; being right about prereleases matters less than that.
 */
export function meetsClientVersion(current: string, minimum: string): boolean {
    return (current || '0.0.0').localeCompare(minimum, undefined, {
        numeric: true,
        sensitivity: 'base',
    }) > -1;
}

export interface DiagnoseOptions {
    extensions: Array<{ name: string; type: ExtensionScope }>;
    manifests: Record<string, ExtensionManifest | null>;
    /** `extension_settings.disabledExtensions`. */
    disabled: string[];
    /** Modules an Extras server reported, or an empty list when there is none. */
    modules: string[];
    /** `pkgVersion` from `/version`. */
    clientVersion: string;
}

/**
 * Works out the state of every extension.
 *
 * Sorted by loading order, then name — the order the loader activates them in,
 * which is the order in which one extension can override another.
 */
export function diagnoseExtensions(options: DiagnoseOptions): ExtensionStatus[] {
    const { extensions, manifests, disabled, modules, clientVersion } = options;
    const disabledSet = new Set(disabled);
    const installedNames = new Set(extensions.map((entry) => entry.name));
    const available = new Set(modules);

    const statuses = extensions.map((entry) => {
        const manifest = manifests[entry.name] ?? null;
        const folder = entry.name.startsWith('third-party/')
            ? entry.name.slice('third-party/'.length)
            : entry.name;
        const isDisabled = disabledSet.has(entry.name);
        const native = NATIVE_EQUIVALENTS[folder];

        const base = {
            name: entry.name,
            folder,
            scope: entry.type,
            displayName: manifest?.display_name?.trim() || folder,
            manifest,
            disabled: isDisabled,
            installed: entry.type !== 'system',
            support: (native ? 'native' : 'classic-only') as ModernSupport,
            ...(native ? { nativeAt: native } : {}),
            interceptsGeneration: typeof manifest?.generate_interceptor === 'string',
            loadingOrder: Number.isFinite(Number(manifest?.loading_order))
                ? Number(manifest?.loading_order)
                : 0,
        };

        // A folder with no readable manifest cannot be loaded or explained, and
        // the loader skips it silently.
        if (!manifest) {
            return {
                ...base,
                state: 'no-manifest' as ExtensionState,
                active: false,
                missingModules: [],
                missingOptional: [],
                missingDependencies: [],
                disabledDependencies: [],
            };
        }

        // Only checked where the field is an array. The loader warns and allows
        // loading when it is not, so a malformed field must not read as a
        // failed requirement here either.
        const requires = Array.isArray(manifest.requires) ? manifest.requires : [];
        const optional = Array.isArray(manifest.optional) ? manifest.optional : [];
        const dependencies = Array.isArray(manifest.dependencies) ? manifest.dependencies : [];

        const missingModules = requires.filter((module) => !available.has(module));
        const missingOptional = optional.filter((module) => !available.has(module));
        const missingDependencies = dependencies.filter((dep) => !installedNames.has(dep));
        const disabledDependencies = dependencies.filter(
            (dep) => installedNames.has(dep) && disabledSet.has(dep),
        );

        const minimum = manifest.minimum_client_version;
        const tooOld = typeof minimum === 'string' && minimum !== ''
            && !meetsClientVersion(clientVersion, minimum);

        // The loader's own order: modules, then dependencies, then version,
        // then the manual switch. Reporting them in a different order would
        // send someone to fix the wrong thing.
        const state: ExtensionState = missingModules.length > 0
            ? 'missing-modules'
            : missingDependencies.length > 0
                ? 'missing-dependencies'
                : disabledDependencies.length > 0
                    ? 'disabled-dependencies'
                    : tooOld
                        ? 'client-too-old'
                        : isDisabled
                            ? 'disabled'
                            : 'active';

        return {
            ...base,
            state,
            active: state === 'active',
            missingModules,
            missingOptional,
            missingDependencies,
            disabledDependencies,
        };
    });

    return statuses.sort(
        (a, b) => a.loadingOrder - b.loadingOrder || a.displayName.localeCompare(b.displayName),
    );
}

/** Plain-language reason, for the row. */
export function explainState(status: ExtensionStatus, clientVersion: string): string {
    switch (status.state) {
        case 'active':
            return status.support === 'native'
                ? 'Loaded in the classic interface. This interface covers the same ground itself.'
                : 'Loaded in the classic interface.';
        case 'disabled':
            return 'Switched off. It will not load in either interface.';
        case 'missing-modules':
            return `Needs the Extras API to provide ${list(status.missingModules)}.`;
        case 'missing-dependencies':
            return `Needs ${list(status.missingDependencies)}, which ${
                status.missingDependencies.length === 1 ? 'is' : 'are'
            } not installed.`;
        case 'disabled-dependencies':
            return `Needs ${list(status.disabledDependencies)}, which ${
                status.disabledDependencies.length === 1 ? 'is' : 'are'
            } switched off. Enable ${
                status.disabledDependencies.length === 1 ? 'it' : 'them'
            } first.`;
        case 'client-too-old':
            return `Needs SillyTavern ${status.manifest?.minimum_client_version} or newer; this is ${clientVersion}.`;
        case 'no-manifest':
            return 'No readable manifest.json, so nothing can load it.';
        default:
            return '';
    }
}

function list(values: string[]): string {
    if (values.length <= 1) {
        return values[0] ?? '';
    }
    return `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`;
}

/** Counts for the page header. */
export function summarise(statuses: ExtensionStatus[]): {
    total: number;
    active: number;
    disabled: number;
    blocked: number;
    native: number;
} {
    return {
        total: statuses.length,
        active: statuses.filter((status) => status.active).length,
        disabled: statuses.filter((status) => status.state === 'disabled').length,
        blocked: statuses.filter((status) => !status.active && status.state !== 'disabled').length,
        native: statuses.filter((status) => status.support === 'native').length,
    };
}
