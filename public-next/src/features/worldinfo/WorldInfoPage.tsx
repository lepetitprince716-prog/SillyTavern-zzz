import {
    BookPlus,
    Circle,
    Library,
    Menu as MenuIcon,
    Plus,
    Search,
    Settings2,
    Trash2,
    Upload,
} from 'lucide-react';
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { useWorldInfoBook, useWorldInfoList } from '@/api/queries';
import type { WorldInfoEntry } from '@/api/worldinfo';
import { Select } from '@/components/ui/controls';
import { Modal } from '@/components/ui/overlays';
import {
    Button,
    EmptyState,
    Field,
    IconButton,
    Input,
    SectionLabel,
    Skeleton,
} from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { compactNumber, estimateTokens } from '@/lib/format';
import { fuzzyFilter } from '@/lib/search';
import { toast } from '@/lib/toast';
import { useSessionStore } from '@/store/session';
import { useUiStore } from '@/store/ui';
import { EntryEditor } from './EntryEditor';
import { useWorldInfoMutations } from './useWorldInfoMutations';

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** One row in the entry list. */
function EntryRow({
    entry,
    active,
    onSelect,
}: {
    entry: WorldInfoEntry;
    active: boolean;
    onSelect(): void;
}) {
    const keys = (entry.key ?? []).filter((key) => key.trim());
    const label = (entry.comment ?? '').trim() || keys[0] || `Entry ${entry.uid}`;
    const tokens = estimateTokens(entry.content ?? '');

    return (
        <button
            type="button"
            onClick={onSelect}
            className={cn(
                'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                active ? 'bg-accent-soft' : 'hover:bg-surface-2',
                entry.disable && 'opacity-50',
            )}
        >
            <Circle
                className={cn(
                    'mt-1 size-2 shrink-0',
                    entry.disable
                        ? 'text-subtle'
                        : entry.constant
                            ? 'fill-warning text-warning'
                            : 'fill-accent text-accent',
                )}
            />
            <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.8125rem] font-medium">{label}</span>
                <span className="block truncate text-[0.6875rem] text-subtle">
                    {entry.constant
                        ? 'Always on'
                        : keys.length > 0
                            ? keys.slice(0, 4).join(', ')
                            : 'No keys'}
                </span>
            </span>
            <span className="shrink-0 text-[0.625rem] tabular-nums text-subtle">
                {compactNumber(tokens)}
            </span>
        </button>
    );
}

/** Prompt for a new book name. */
function NewBookDialog({
    open,
    onOpenChange,
    onCreate,
}: {
    open: boolean;
    onOpenChange(open: boolean): void;
    onCreate(name: string): Promise<void>;
}) {
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        setBusy(true);
        try {
            await onCreate(name);
            setName('');
            onOpenChange(false);
        } catch (error) {
            toast.error('Could not create the lorebook', describe(error));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            open={open}
            onOpenChange={onOpenChange}
            title="New lorebook"
            description="Creates an empty book in your worlds folder. The classic interface sees it too."
            size="sm"
            footer={
                <>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button variant="primary" disabled={!name.trim() || busy} onClick={() => void submit()}>
                        {busy ? 'Creating…' : 'Create'}
                    </Button>
                </>
            }
        >
            <Field label="Name">
                <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && name.trim()) {
                            void submit();
                        }
                    }}
                    placeholder="Eldoria"
                    autoFocus
                />
            </Field>
        </Modal>
    );
}

/**
 * The lorebook manager.
 *
 * Three panes: which book, which entry, and the entry itself. The book is
 * saved on a debounce as you type, so there is no save button to forget.
 */
export function WorldInfoPage({ onOpenSettings }: { onOpenSettings(): void }) {
    const toggleSidebar = useUiStore((state) => state.toggleSidebar);
    const activeBooks = useSessionStore((state) => state.worldInfo.books);
    const semanticEnabled = useSessionStore((state) => state.worldInfo.semanticEnabled);
    const setWorldInfo = useSessionStore((state) => state.setWorldInfo);

    const { data: books, isPending: booksPending } = useWorldInfoList();
    const [selectedBook, setSelectedBook] = useState<string | null>(null);
    const bookName = selectedBook ?? books?.[0]?.file_id ?? null;
    const { data: book, isPending: bookPending } = useWorldInfoBook(bookName);

    const mutations = useWorldInfoMutations();
    const [selectedUid, setSelectedUid] = useState<number | null>(null);
    const [query, setQuery] = useState('');
    const [newBookOpen, setNewBookOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const deferredQuery = useDeferredValue(query);
    const fileInput = useRef<HTMLInputElement>(null);

    const entries = useMemo(
        () =>
            Object.values(book?.entries ?? {}).sort(
                (a, b) => (a.displayIndex ?? a.uid) - (b.displayIndex ?? b.uid),
            ),
        [book],
    );

    const visible = useMemo(
        () =>
            fuzzyFilter(entries, deferredQuery, (entry) => [
                entry.comment ?? '',
                ...(entry.key ?? []),
                ...(entry.keysecondary ?? []),
                entry.content ?? '',
            ]),
        [entries, deferredQuery],
    );

    const selected = entries.find((entry) => entry.uid === selectedUid) ?? visible[0] ?? null;

    const keySuggestions = useMemo(() => {
        const counts = new Map<string, number>();
        for (const entry of entries) {
            for (const key of entry.key ?? []) {
                if (key.trim()) {
                    counts.set(key, (counts.get(key) ?? 0) + 1);
                }
            }
        }
        return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
    }, [entries]);

    const bookOptions = (books ?? []).map((entry) => ({
        value: entry.file_id,
        label: entry.name || entry.file_id,
    }));

    const isActive = bookName !== null && activeBooks.includes(bookName);
    const totalTokens = entries.reduce((sum, entry) => sum + estimateTokens(entry.content ?? ''), 0);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-2 sm:px-3">
                <IconButton
                    label="Toggle character list"
                    variant="ghost"
                    className="lg:hidden"
                    onClick={() => toggleSidebar()}
                >
                    <MenuIcon className="size-4.5" />
                </IconButton>

                <Library className="size-4 shrink-0 text-accent" />
                <h1 className="shrink-0 text-sm font-semibold max-sm:sr-only">Lorebooks</h1>

                <div className="min-w-0 flex-1 sm:max-w-64">
                    {bookOptions.length > 0 ? (
                        <Select
                            value={bookName ?? ''}
                            onValueChange={(value) => {
                                setSelectedBook(value);
                                setSelectedUid(null);
                            }}
                            options={bookOptions}
                            placeholder="Pick a lorebook"
                            aria-label="Lorebook"
                        />
                    ) : null}
                </div>

                {bookName ? (
                    <Button
                        size="sm"
                        variant={isActive ? 'primary' : 'secondary'}
                        onClick={() =>
                            setWorldInfo({
                                books: isActive
                                    ? activeBooks.filter((name) => name !== bookName)
                                    : [...activeBooks, bookName],
                            })
                        }
                    >
                        {isActive ? 'Active in chats' : 'Use in chats'}
                    </Button>
                ) : null}

                <input
                    ref={fileInput}
                    type="file"
                    hidden
                    accept=".json,.png"
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (file) {
                            void mutations
                                .importBook(file)
                                .then((name) => setSelectedBook(name))
                                .catch((error: unknown) =>
                                    toast.error('Could not import that lorebook', describe(error)),
                                );
                        }
                    }}
                />
                <IconButton label="Import a lorebook" variant="ghost" onClick={() => fileInput.current?.click()}>
                    <Upload className="size-4" />
                </IconButton>
                <IconButton label="New lorebook" variant="ghost" onClick={() => setNewBookOpen(true)}>
                    <BookPlus className="size-4" />
                </IconButton>
                {bookName ? (
                    <IconButton
                        label="Delete this lorebook"
                        variant="ghost"
                        onClick={() => setDeleteOpen(true)}
                    >
                        <Trash2 className="size-4" />
                    </IconButton>
                ) : null}
                <IconButton label="Settings" variant="ghost" onClick={onOpenSettings}>
                    <Settings2 className="size-4.5" />
                </IconButton>
            </header>

            {booksPending ? (
                <div className="space-y-2 p-4">
                    <Skeleton className="h-9 w-64" />
                    <Skeleton className="h-40 w-full rounded-card" />
                </div>
            ) : bookOptions.length === 0 ? (
                <EmptyState
                    icon={<Library />}
                    title="No lorebooks yet"
                    description="A lorebook holds the background facts a character should know. Create one, or import a book you already have."
                    action={
                        <div className="flex gap-2">
                            <Button variant="primary" onClick={() => setNewBookOpen(true)}>
                                <BookPlus className="size-4" />
                                New lorebook
                            </Button>
                            <Button variant="secondary" onClick={() => fileInput.current?.click()}>
                                <Upload className="size-4" />
                                Import
                            </Button>
                        </div>
                    }
                />
            ) : (
                <div className="flex min-h-0 flex-1">
                    <aside className="flex w-72 shrink-0 flex-col border-r border-border max-md:w-56">
                        <div className="space-y-2 p-2.5">
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
                                <Input
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    placeholder="Search entries…"
                                    aria-label="Search lorebook entries"
                                    className="h-9 pl-8"
                                />
                            </div>
                            <Button
                                size="sm"
                                variant="secondary"
                                className="w-full"
                                onClick={() => {
                                    if (!bookName) {
                                        return;
                                    }
                                    const uid = mutations.addEntry(bookName);
                                    if (uid !== null) {
                                        setSelectedUid(uid);
                                        setQuery('');
                                    }
                                }}
                            >
                                <Plus className="size-3.5" />
                                New entry
                            </Button>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
                            <SectionLabel className="px-2.5 py-1.5">
                                {bookPending
                                    ? 'Loading'
                                    : `${visible.length} entr${visible.length === 1 ? 'y' : 'ies'} · ${compactNumber(totalTokens)} tok`}
                            </SectionLabel>
                            {visible.map((entry) => (
                                <EntryRow
                                    key={entry.uid}
                                    entry={entry}
                                    active={selected?.uid === entry.uid}
                                    onSelect={() => setSelectedUid(entry.uid)}
                                />
                            ))}
                            {!bookPending && visible.length === 0 ? (
                                <p className="px-2.5 py-4 text-xs leading-relaxed text-subtle">
                                    {query ? 'No entries match that search.' : 'This book has no entries yet.'}
                                </p>
                            ) : null}
                        </div>

                        {mutations.isSaving ? (
                            <p className="border-t border-border px-3 py-2 text-[0.6875rem] text-subtle">
                                Saving…
                            </p>
                        ) : null}
                    </aside>

                    <div className="min-w-0 flex-1 overflow-y-auto">
                        {selected && bookName ? (
                            <div className="mx-auto max-w-2xl p-4 sm:p-6">
                                <EntryEditor
                                    key={`${bookName}:${selected.uid}`}
                                    entry={selected}
                                    onPatch={(patch) => mutations.patchEntry(bookName, selected.uid, patch)}
                                    onReplace={(entry) => mutations.replaceEntry(bookName, entry)}
                                    onDelete={() => {
                                        mutations.removeEntry(bookName, selected.uid);
                                        setSelectedUid(null);
                                    }}
                                    keySuggestions={keySuggestions}
                                    semanticAvailable={semanticEnabled}
                                />
                            </div>
                        ) : (
                            <EmptyState
                                title="No entry selected"
                                description="Pick an entry on the left, or add one."
                            />
                        )}
                    </div>
                </div>
            )}

            <NewBookDialog
                open={newBookOpen}
                onOpenChange={setNewBookOpen}
                onCreate={async (name) => {
                    await mutations.createBook(name);
                    setSelectedBook(name.trim());
                    setSelectedUid(null);
                }}
            />

            {bookName ? (
                <Modal
                    open={deleteOpen}
                    onOpenChange={setDeleteOpen}
                    title={`Delete ${bookName}?`}
                    description="The book file and its embeddings are removed. This cannot be undone."
                    size="sm"
                    footer={
                        <>
                            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
                                Cancel
                            </Button>
                            <Button
                                variant="danger"
                                onClick={() => {
                                    void mutations
                                        .removeBook(bookName)
                                        .then(() => {
                                            setDeleteOpen(false);
                                            setSelectedBook(null);
                                            setSelectedUid(null);
                                            setWorldInfo({
                                                books: activeBooks.filter((name) => name !== bookName),
                                            });
                                        })
                                        .catch((error: unknown) =>
                                            toast.error('Could not delete the lorebook', describe(error)),
                                        );
                                }}
                            >
                                Delete
                            </Button>
                        </>
                    }
                >
                    <p className="text-[0.8125rem] leading-relaxed text-muted">
                        {entries.length} entr{entries.length === 1 ? 'y' : 'ies'} will be lost.
                    </p>
                </Modal>
            ) : null}
        </div>
    );
}
