/**
 * Loading and managing the extension list.
 *
 * `discover` and the manifests are one query: a list of folder names without
 * their manifests cannot be rendered, so fetching them separately would only
 * add a state where half the page exists. The git state of each third-party
 * extension is a second, on-demand query, because the route runs
 * `git fetch origin` per call.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    deleteExtension,
    fetchDiscoveredExtensions,
    fetchExtensionBranches,
    fetchExtensionVersion,
    fetchExtrasModules,
    fetchManifests,
    installExtension,
    moveExtension,
    setExtensionDisabled,
    switchExtensionBranch,
    updateExtension,
    type DiscoveredExtension,
    type ExtensionManifest,
    type ExtensionScope,
} from '@/api/extensions';
import { queryKeys } from '@/api/queries';
import { toast } from '@/lib/toast';

export const extensionKeys = {
    list: ['extensions'] as const,
    git: (name: string) => ['extensions', name, 'git'] as const,
    branches: (name: string) => ['extensions', name, 'branches'] as const,
    modules: (url: string) => ['extras-modules', url] as const,
};

export interface ExtensionCatalogue {
    extensions: DiscoveredExtension[];
    manifests: Record<string, ExtensionManifest | null>;
}

export function useExtensionCatalogue() {
    return useQuery<ExtensionCatalogue>({
        queryKey: extensionKeys.list,
        queryFn: async ({ signal }) => {
            const extensions = await fetchDiscoveredExtensions(signal);
            const manifests = await fetchManifests(
                extensions.map((entry) => entry.name),
                signal,
            );
            return { extensions, manifests };
        },
        staleTime: 60_000,
        retry: false,
    });
}

/** Git state for one installed extension. Only fetched when asked for. */
export function useExtensionGit(name: string, scope: ExtensionScope, enabled: boolean) {
    return useQuery({
        queryKey: extensionKeys.git(name),
        queryFn: () => fetchExtensionVersion(name, scope === 'global'),
        enabled: enabled && scope !== 'system',
        staleTime: 5 * 60_000,
        retry: false,
    });
}

export function useExtensionBranches(name: string, scope: ExtensionScope, enabled: boolean) {
    return useQuery({
        queryKey: extensionKeys.branches(name),
        queryFn: () => fetchExtensionBranches(name, scope === 'global'),
        enabled: enabled && scope !== 'system',
        staleTime: 60_000,
        retry: false,
    });
}

/** Modules an Extras server provides, for the `requires` diagnosis. */
export function useExtrasModules(url: string, enabled: boolean) {
    return useQuery({
        queryKey: extensionKeys.modules(url),
        queryFn: ({ signal }) => fetchExtrasModules(url, signal),
        enabled: enabled && url.length > 0,
        staleTime: 5 * 60_000,
        retry: false,
    });
}

export function useExtensionMutations() {
    const queryClient = useQueryClient();
    const invalidate = async () => {
        await queryClient.invalidateQueries({ queryKey: extensionKeys.list });
        // The disabled list lives in settings.json, which is its own query.
        await queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    };

    const toggle = useMutation({
        mutationFn: (options: { name: string; disabled: boolean }) =>
            setExtensionDisabled(options.name, options.disabled),
        onSuccess: async (_result, options) => {
            await invalidate();
            toast.info(
                options.disabled ? 'Extension switched off' : 'Extension switched on',
                'Reload the classic interface for it to take effect there.',
            );
        },
        onError: (error: Error) => toast.error('Could not change the extension', error.message),
    });

    const install = useMutation({
        mutationFn: (options: { url: string; global: boolean; branch?: string }) =>
            installExtension(options),
        onSuccess: async (result) => {
            await invalidate();
            toast.success(
                'Extension installed',
                `${result.display_name || result.folderName || 'It'} is ready. Reload the classic interface to load it.`,
            );
        },
        onError: (error: Error) => toast.error('Could not install the extension', error.message),
    });

    const update = useMutation({
        mutationFn: (options: { name: string; scope: ExtensionScope }) =>
            updateExtension(options.name, options.scope === 'global'),
        onSuccess: async (result, options) => {
            await queryClient.invalidateQueries({ queryKey: extensionKeys.git(options.name) });
            if (result.isUpToDate) {
                toast.info('Already up to date', 'Nothing to pull.');
                return;
            }
            toast.success('Extension updated', `Now at ${result.shortCommitHash ?? 'the latest commit'}.`);
        },
        onError: (error: Error) => toast.error('Could not update the extension', error.message),
    });

    const remove = useMutation({
        mutationFn: (options: { name: string; scope: ExtensionScope }) =>
            deleteExtension(options.name, options.scope === 'global'),
        onSuccess: async () => {
            await invalidate();
            toast.success('Extension deleted');
        },
        onError: (error: Error) => toast.error('Could not delete the extension', error.message),
    });

    const move = useMutation({
        mutationFn: (options: { name: string; to: ExtensionScope }) =>
            moveExtension(options.name, options.to),
        onSuccess: async (_result, options) => {
            await invalidate();
            toast.success(
                'Extension moved',
                options.to === 'global' ? 'It is now installed for everyone.' : 'It is now yours alone.',
            );
        },
        onError: (error: Error) => toast.error('Could not move the extension', error.message),
    });

    const switchBranch = useMutation({
        mutationFn: (options: { name: string; scope: ExtensionScope; branch: string }) =>
            switchExtensionBranch(options.name, options.scope === 'global', options.branch),
        onSuccess: async (_result, options) => {
            await queryClient.invalidateQueries({ queryKey: extensionKeys.git(options.name) });
            await invalidate();
            toast.success('Branch switched', options.branch);
        },
        onError: (error: Error) => toast.error('Could not switch the branch', error.message),
    });

    return { toggle, install, update, remove, move, switchBranch };
}
