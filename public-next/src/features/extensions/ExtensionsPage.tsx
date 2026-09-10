/**
 * The extension manager.
 *
 * Two things this page has to be honest about, and the classic panel has no
 * reason to say:
 *
 * - An extension's code targets the classic DOM and the globals in
 *   `script.js`. Enabled or not, it is not running here. Where this frontend
 *   implements the same capability itself, the row says so and links to it;
 *   where it does not, the row says the extension's controls and its effect on
 *   generation are in the classic interface.
 * - Why an extension is not loading, on the extension's own row. The classic
 *   panel puts three of the four reasons in one error block at the bottom.
 */

import {
    AlertTriangle,
    Check,
    Download,
    ExternalLink,
    FolderTree,
    GitBranch,
    Menu as MenuIcon,
    Plug,
    Puzzle,
    RefreshCw,
    Search,
    Settings2,
    Trash2,
} from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { extensionAssetUrl, extensionStateFromSettings, type ExtensionScope } from '@/api/extensions';
import { useCurrentUser, useSettings, useVersion } from '@/api/queries';
import { Select, Switch } from '@/components/ui/controls';
import { Modal, Tooltip } from '@/components/ui/overlays';
import {
    Badge,
    Button,
    EmptyState,
    Field,
    IconButton,
    Input,
    SectionLabel,
    Skeleton,
} from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { fuzzyFilter } from '@/lib/search';
import { useUiStore } from '@/store/ui';
import {
    diagnoseExtensions,
    explainState,
    summarise,
    type ExtensionStatus,
} from './diagnose';
import {
    useExtensionBranches,
    useExtensionCatalogue,
    useExtensionGit,
    useExtensionMutations,
    useExtrasModules,
} from './useExtensions';

const SCOPE_LABEL: Record<ExtensionScope, string> = {
    system: 'Bundled',
    local: 'Yours',
    global: 'Everyone',
};

const STATE_TONE: Record<ExtensionStatus['state'], 'success' | 'neutral' | 'warning' | 'danger'> = {
    active: 'success',
    disabled: 'neutral',
    'missing-modules': 'warning',
    'missing-dependencies': 'warning',
    'disabled-dependencies': 'warning',
    'client-too-old': 'danger',
    'no-manifest': 'danger',
};

const STATE_LABEL: Record<ExtensionStatus['state'], string> = {
    active: 'Loads',
    disabled: 'Off',
    'missing-modules': 'Held back',
    'missing-dependencies': 'Held back',
    'disabled-dependencies': 'Held back',
    'client-too-old': 'Too new for this build',
    'no-manifest': 'Broken',
};

type Filter = 'all' | 'installed' | 'held-back' | 'off';

const FILTERS = [
    { value: 'all', label: 'Everything' },
    { value: 'installed', label: 'Installed by you' },
    { value: 'held-back', label: 'Held back' },
    { value: 'off', label: 'Switched off' },
];

/** The git state and the actions for a third-party extension. */
function InstalledActions({
    status,
    isAdmin,
    expanded,
}: {
    status: ExtensionStatus;
    isAdmin: boolean;
    expanded: boolean;
}) {
    const git = useExtensionGit(status.name, status.scope, expanded);
    const { update, remove, move, switchBranch } = useExtensionMutations();
    const [branchOpen, setBranchOpen] = useState(false);
    const branches = useExtensionBranches(status.name, status.scope, branchOpen);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const canManageGlobal = status.scope !== 'global' || isAdmin;

    return (
        <div className="mt-2 space-y-2 border-t border-border pt-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-subtle">
                {git.isPending ? (
                    <span>Checking the repository…</span>
                ) : git.isError ? (
                    <span>Could not read its git state: {describe(git.error)}</span>
                ) : git.data ? (
                    <>
                        <span className="inline-flex items-center gap-1">
                            <GitBranch className="size-3" />
                            {git.data.currentBranchName || 'no branch'}
                        </span>
                        {git.data.currentCommitHash ? (
                            <span className="font-mono">{git.data.currentCommitHash.slice(0, 7)}</span>
                        ) : null}
                        <span className={git.data.isUpToDate ? undefined : 'text-warning'}>
                            {git.data.isUpToDate ? 'Up to date' : 'Update available'}
                        </span>
                        {git.data.remoteUrl ? (
                            <a
                                href={git.data.remoteUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-accent hover:underline"
                            >
                                Repository
                                <ExternalLink className="size-3" />
                            </a>
                        ) : null}
                    </>
                ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
                <Button
                    size="sm"
                    variant="secondary"
                    disabled={update.isPending || !canManageGlobal}
                    onClick={() => update.mutate({ name: status.name, scope: status.scope })}
                >
                    <Download className="size-3.5" />
                    Update
                </Button>
                {canManageGlobal ? (
                    <Button size="sm" variant="ghost" onClick={() => setBranchOpen(true)}>
                        <GitBranch className="size-3.5" />
                        Branch
                    </Button>
                ) : null}
                {isAdmin ? (
                    <Button
                        size="sm"
                        variant="ghost"
                        disabled={move.isPending}
                        onClick={() =>
                            move.mutate({
                                name: status.name,
                                to: status.scope === 'global' ? 'local' : 'global',
                            })}
                    >
                        <FolderTree className="size-3.5" />
                        {status.scope === 'global' ? 'Make it yours alone' : 'Install for everyone'}
                    </Button>
                ) : null}
                <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger hover:bg-danger-soft"
                    disabled={remove.isPending || !canManageGlobal}
                    onClick={() => setConfirmDelete(true)}
                >
                    <Trash2 className="size-3.5" />
                    Delete
                </Button>
            </div>

            <Modal
                open={branchOpen}
                onOpenChange={setBranchOpen}
                title={`Branches of ${status.displayName}`}
                description="Listing branches unshallows the clone, which can take a moment on a large repository."
                size="sm"
            >
                {branches.isPending ? (
                    <div className="space-y-1.5">
                        <Skeleton className="h-8" />
                        <Skeleton className="h-8" />
                    </div>
                ) : branches.isError ? (
                    <p className="text-xs text-danger">{describe(branches.error)}</p>
                ) : (branches.data ?? []).length === 0 ? (
                    <p className="text-xs text-subtle">No branches reported.</p>
                ) : (
                    <ul className="space-y-1">
                        {dedupeBranches(branches.data ?? []).map((branch) => (
                            <li key={branch.name}>
                                <button
                                    type="button"
                                    disabled={branch.current || switchBranch.isPending}
                                    onClick={() => {
                                        switchBranch.mutate({
                                            name: status.name,
                                            scope: status.scope,
                                            branch: branch.label,
                                        });
                                        setBranchOpen(false);
                                    }}
                                    className={cn(
                                        'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[0.8125rem]',
                                        branch.current
                                            ? 'bg-accent-soft text-accent'
                                            : 'hover:bg-surface-2',
                                    )}
                                >
                                    {branch.current ? <Check className="size-3.5" /> : null}
                                    <span className="min-w-0 flex-1 truncate">{branch.label}</span>
                                    <span className="shrink-0 font-mono text-[0.625rem] text-subtle">
                                        {branch.commit.slice(0, 7)}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </Modal>

            <Modal
                open={confirmDelete}
                onOpenChange={setConfirmDelete}
                title={`Delete ${status.displayName}?`}
                description="The folder is removed from disk. Any settings it stored stay in settings.json."
                size="sm"
                footer={
                    <div className="flex items-center gap-2">
                        <Button
                            variant="primary"
                            className="bg-danger hover:bg-danger"
                            onClick={() => {
                                remove.mutate({ name: status.name, scope: status.scope });
                                setConfirmDelete(false);
                            }}
                        >
                            Delete
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                            Cancel
                        </Button>
                    </div>
                }
            >
                <p className="text-[0.8125rem] text-muted">
                    This cannot be undone from here. Reinstalling from the same URL brings it back.
                </p>
            </Modal>
        </div>
    );
}

/** One extension. */
function ExtensionRow({
    status,
    isAdmin,
    clientVersion,
}: {
    status: ExtensionStatus;
    isAdmin: boolean;
    clientVersion: string;
}) {
    const { toggle } = useExtensionMutations();
    const [expanded, setExpanded] = useState(false);
    const manifest = status.manifest;

    return (
        <li
            className={cn(
                'rounded-card border border-border bg-surface p-3',
                !status.active && 'bg-surface-2/40',
            )}
        >
            <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="text-[0.8125rem] font-semibold">{status.displayName}</h3>
                        <Badge tone={STATE_TONE[status.state]}>{STATE_LABEL[status.state]}</Badge>
                        <Badge>{SCOPE_LABEL[status.scope]}</Badge>
                        {status.support === 'native' ? (
                            <Badge tone="accent">Covered here</Badge>
                        ) : null}
                        {status.interceptsGeneration ? (
                            <Tooltip content="Rewrites the prompt during generation in the classic interface.">
                                <Badge>Prompt</Badge>
                            </Tooltip>
                        ) : null}
                    </div>

                    {/* Only where it says something the badge does not. An
                        "it loaded" line under a "Loads" badge, repeated down a
                        list of forty, is what buries the four rows that do
                        have a reason worth reading. */}
                    {status.active ? null : (
                        <p className="mt-1 text-xs leading-relaxed text-muted">
                            {explainState(status, clientVersion)}
                        </p>
                    )}

                    {status.support === 'native' && status.nativeAt ? (
                        <p className="mt-1 text-[0.6875rem] text-subtle">
                            Covered here by{' '}
                            <Link to={status.nativeAt.path} className="text-accent hover:underline">
                                {status.nativeAt.label}
                            </Link>
                            ; the extension itself only affects the classic interface.
                        </p>
                    ) : null}

                    {status.missingOptional.length > 0 ? (
                        <p className="mt-1 text-[0.6875rem] text-subtle">
                            Optional Extras modules not available: {status.missingOptional.join(', ')}.
                        </p>
                    ) : null}

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.625rem] text-subtle">
                        <span className="font-mono">{status.folder}</span>
                        {manifest?.version ? <span>v{manifest.version}</span> : null}
                        {manifest?.author ? <span>by {manifest.author}</span> : null}
                        <span>load order {status.loadingOrder}</span>
                        {manifest?.homePage ? (
                            <a
                                href={manifest.homePage}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-accent hover:underline"
                            >
                                Home page
                                <ExternalLink className="size-3" />
                            </a>
                        ) : null}
                        <a
                            href={extensionAssetUrl(status.name, 'manifest.json')}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent hover:underline"
                        >
                            manifest.json
                        </a>
                    </div>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Tooltip content={status.disabled ? 'Switch on' : 'Switch off'}>
                        <span>
                            <Switch
                                checked={!status.disabled}
                                disabled={toggle.isPending || status.state === 'no-manifest'}
                                onCheckedChange={(on) =>
                                    toggle.mutate({ name: status.name, disabled: !on })}
                            />
                        </span>
                    </Tooltip>
                    {status.installed ? (
                        <Button size="sm" variant="ghost" onClick={() => setExpanded((open) => !open)}>
                            {expanded ? 'Hide' : 'Manage'}
                        </Button>
                    ) : null}
                </div>
            </div>

            {status.installed && expanded ? (
                <InstalledActions status={status} isAdmin={isAdmin} expanded={expanded} />
            ) : null}
        </li>
    );
}

/** Install from a git URL. */
function InstallDialog({ isAdmin }: { isAdmin: boolean }) {
    const [open, setOpen] = useState(false);
    const [url, setUrl] = useState('');
    const [branch, setBranch] = useState('');
    const [global, setGlobal] = useState(false);
    const { install } = useExtensionMutations();

    const submit = () => {
        const trimmed = url.trim();
        if (!trimmed) {
            return;
        }
        install.mutate(
            { url: trimmed, global, ...(branch.trim() ? { branch: branch.trim() } : {}) },
            {
                onSuccess: () => {
                    setUrl('');
                    setBranch('');
                    setOpen(false);
                },
            },
        );
    };

    return (
        <>
            <Button variant="primary" onClick={() => setOpen(true)}>
                <Plug className="size-4" />
                <span className="max-sm:sr-only">Install</span>
            </Button>
            <Modal
                open={open}
                onOpenChange={setOpen}
                title="Install an extension"
                description="Clones a git repository into your extensions folder."
                size="sm"
                footer={
                    <div className="flex items-center gap-2">
                        <Button
                            variant="primary"
                            disabled={!url.trim() || install.isPending}
                            onClick={submit}
                        >
                            {install.isPending ? 'Cloning…' : 'Install'}
                        </Button>
                        <Button variant="ghost" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                    </div>
                }
            >
                <div className="space-y-4">
                    <Field
                        label="Repository URL"
                        htmlFor="extension-url"
                        hint="An HTTP or HTTPS git URL. The folder is named after the repository."
                    >
                        <Input
                            id="extension-url"
                            value={url}
                            onChange={(event) => setUrl(event.target.value)}
                            placeholder="https://github.com/author/extension"
                            spellCheck={false}
                            autoFocus
                        />
                    </Field>
                    <Field
                        label="Branch"
                        htmlFor="extension-branch"
                        hint="Optional. Leave empty for the repository's default branch."
                    >
                        <Input
                            id="extension-branch"
                            value={branch}
                            onChange={(event) => setBranch(event.target.value)}
                            placeholder="main"
                            spellCheck={false}
                        />
                    </Field>
                    {isAdmin ? (
                        <label className="flex items-center gap-2 text-[0.8125rem]">
                            <Switch checked={global} onCheckedChange={setGlobal} />
                            Install for everyone on this server
                        </label>
                    ) : null}
                    <p className="text-[0.6875rem] leading-relaxed text-subtle">
                        An extension runs its own code in your browser with full access to your
                        chats and keys. Install ones you have reason to trust.
                    </p>
                </div>
            </Modal>
        </>
    );
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Local and remote listings both appear; the same branch need only show once. */
function dedupeBranches<T extends { label: string }>(branches: T[]): T[] {
    const seen = new Set<string>();
    return branches.filter((branch) => {
        const key = branch.label.replace(/^origin\//, '');
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

export function ExtensionsPage({ onOpenSettings }: { onOpenSettings(): void }) {
    const toggleSidebar = useUiStore((state) => state.toggleSidebar);
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState<Filter>('all');
    const [probeExtras, setProbeExtras] = useState(false);
    const deferredQuery = useDeferredValue(query);

    const catalogue = useExtensionCatalogue();
    const settings = useSettings();
    const version = useVersion();
    const user = useCurrentUser();

    const { disabled, extrasUrl } = useMemo(
        () => extensionStateFromSettings(settings.data?.settings ?? '{}'),
        [settings.data],
    );
    const extras = useExtrasModules(extrasUrl, probeExtras);

    const statuses = useMemo(
        () => diagnoseExtensions({
            extensions: catalogue.data?.extensions ?? [],
            manifests: catalogue.data?.manifests ?? {},
            disabled,
            modules: extras.data ?? [],
            clientVersion: version.data?.pkgVersion ?? '',
        }),
        [catalogue.data, disabled, extras.data, version.data],
    );

    const counts = summarise(statuses);

    const results = useMemo(() => {
        const scoped = statuses.filter((status) => {
            switch (filter) {
                case 'installed':
                    return status.installed;
                case 'held-back':
                    return !status.active && status.state !== 'disabled';
                case 'off':
                    return status.state === 'disabled';
                default:
                    return true;
            }
        });
        return fuzzyFilter(scoped, deferredQuery, (status) => [
            status.displayName,
            status.folder,
            status.manifest?.author ?? '',
        ]);
    }, [statuses, filter, deferredQuery]);

    const isAdmin = Boolean(user.data?.admin);
    // The whole router 404s when extensions are switched off in config.yaml.
    const switchedOffInConfig = catalogue.isError;

    return (
        <div className="relative flex min-h-0 flex-1 flex-col">
            <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-2 lg:hidden">
                <IconButton label="Toggle character list" variant="ghost" onClick={() => toggleSidebar()}>
                    <MenuIcon className="size-4.5" />
                </IconButton>
                <span className="flex-1 text-sm font-semibold">Extensions</span>
                <IconButton label="Settings" variant="ghost" onClick={onOpenSettings}>
                    <Settings2 className="size-4.5" />
                </IconButton>
            </div>

            <div className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto px-4 py-6 sm:px-6">
                <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
                    <div className="min-w-0">
                        <h1 className="text-xl font-semibold max-lg:sr-only">Extensions</h1>
                        <p className="mt-0.5 text-[0.8125rem] text-muted">
                            {catalogue.isPending
                                ? 'Reading the extensions folder…'
                                : `${counts.total} installed · ${counts.active} load · ${counts.disabled} off · ${counts.blocked} held back`}
                        </p>
                    </div>

                    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                        <div className="relative min-w-40 flex-1 sm:w-52">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
                            <Input
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder="Search name, folder, author…"
                                aria-label="Search extensions"
                                className="pl-8"
                            />
                        </div>
                        {/* Not hidden on a phone: "held back" is the filter
                            most worth having on a small screen, and a control
                            that is only there on a desktop is a control the
                            reader cannot rely on. */}
                        <div className="w-44 shrink-0 max-sm:order-last max-sm:w-full">
                            <Select
                                value={filter}
                                onValueChange={(value) => setFilter(value as Filter)}
                                options={FILTERS}
                                aria-label="Filter extensions"
                            />
                        </div>
                        <InstallDialog isAdmin={isAdmin} />
                        <IconButton
                            label="Settings"
                            variant="ghost"
                            onClick={onOpenSettings}
                            className="max-lg:hidden"
                        >
                            <Settings2 className="size-4.5" />
                        </IconButton>
                    </div>
                </header>

                <div className="mb-5 rounded-card border border-border bg-surface-2/40 p-3">
                    <p className="text-xs leading-relaxed text-muted">
                        Extensions run in the classic interface. Their code reaches into that
                        page's DOM and its globals, so switching one on here changes what happens
                        at <a href="/" className="text-accent hover:underline">/</a>, not in this
                        interface —{' '}
                        {counts.native > 0
                            ? `except for the ${counts.native} whose job this interface does natively, which are marked.`
                            : 'nothing here replaces one natively yet.'}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        {extrasUrl ? (
                            <>
                                <span className="text-[0.6875rem] text-subtle">
                                    Extras API: <span className="font-mono">{extrasUrl}</span>
                                    {extras.data ? ` · ${extras.data.length} modules` : ''}
                                    {extras.isError ? ' · did not answer' : ''}
                                </span>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={extras.isFetching}
                                    onClick={() => setProbeExtras(true)}
                                >
                                    <RefreshCw className={cn('size-3.5', extras.isFetching && 'animate-spin')} />
                                    Check its modules
                                </Button>
                            </>
                        ) : (
                            <span className="text-[0.6875rem] text-subtle">
                                No Extras API is configured, so an extension that requires one of
                                its modules cannot load.
                            </span>
                        )}
                    </div>
                </div>

                {switchedOffInConfig ? (
                    <EmptyState
                        icon={<AlertTriangle />}
                        title="Extensions are switched off on this server"
                        description="`extensions.enabled` is false in config.yaml, so the extension routes answer 404. Set it to true and restart to manage extensions."
                    />
                ) : catalogue.isPending ? (
                    // Not a list: five placeholders announced as "list, 5
                    // items" is a claim about content that does not exist yet.
                    <div className="space-y-2" aria-busy="true" aria-label="Loading extensions">
                        {[0, 1, 2, 3, 4].map((row) => (
                            <Skeleton key={row} className="h-24 rounded-card" />
                        ))}
                    </div>
                ) : results.length === 0 ? (
                    <EmptyState
                        icon={<Puzzle />}
                        title={query || filter !== 'all' ? 'Nothing matches' : 'No extensions installed'}
                        description={
                            query || filter !== 'all'
                                ? 'Try a different search, or widen the filter.'
                                : 'Install one from a git URL to get started.'
                        }
                    />
                ) : (
                    <>
                        <SectionLabel className="px-0 pb-1.5">
                            In load order — earlier ones can be overridden by later ones
                        </SectionLabel>
                        <ul className="space-y-2">
                            {results.map((status) => (
                                <ExtensionRow
                                    key={status.name}
                                    status={status}
                                    isAdmin={isAdmin}
                                    clientVersion={version.data?.pkgVersion ?? ''}
                                />
                            ))}
                        </ul>
                    </>
                )}
            </div>
        </div>
    );
}
