import { ArrowUpDown, Menu as MenuIcon, Search, Settings2, Star, Upload, UserPlus, Users } from 'lucide-react';
import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { avatarUrl, cardField, characterTags } from '@/api/characters';
import { useCharacters } from '@/api/queries';
import type { Character } from '@/api/types';
import { Avatar } from '@/components/ui/Avatar';
import { Select } from '@/components/ui/controls';
import { Badge, Button, EmptyState, IconButton, Input, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { fuzzyFilter } from '@/lib/search';
import { useUiStore } from '@/store/ui';
import { GroupCreateButton } from '@/features/groups/GroupList';
import { CharacterActions } from './CharacterActions';
import { CharacterEditor, FavouriteButton } from './CharacterEditor';
import { useCharacterMutations } from './useCharacterMutations';
import { isFavourite } from './utils';

type SortKey = 'recent' | 'name' | 'added';

const SORT_OPTIONS = [
    { value: 'recent', label: 'Recently used' },
    { value: 'name', label: 'Name (A–Z)' },
    { value: 'added', label: 'Recently added' },
];

function sortCharacters(list: Character[], key: SortKey): Character[] {
    const copy = [...list];
    switch (key) {
        case 'name':
            return copy.sort((a, b) => a.name.localeCompare(b.name));
        case 'added':
            return copy.sort((a, b) => (b.date_added ?? 0) - (a.date_added ?? 0));
        case 'recent':
        default:
            return copy.sort((a, b) => (b.date_last_chat ?? 0) - (a.date_last_chat ?? 0));
    }
}

function CharacterCard({
    character,
    onEdit,
}: {
    character: Character;
    onEdit(character: Character): void;
}) {
    const tags = characterTags(character).slice(0, 3);
    const blurb = cardField(character, 'description').replace(/\s+/g, ' ').trim();

    return (
        <div className="group relative">
            <Link
                to={`/chat/${encodeURIComponent(character.avatar)}`}
                className={cn(
                    'flex h-full flex-col gap-3 rounded-card border border-border bg-surface p-4',
                    'transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-panel',
                    'focus-visible:ring-2 focus-visible:ring-accent/40',
                )}
            >
                <div className="flex items-start gap-3">
                    <Avatar
                        src={avatarUrl(character.avatar)}
                        name={character.name}
                        size="lg"
                        rounded="card"
                        className="transition-transform duration-200 group-hover:scale-[1.03]"
                    />
                    <div className="min-w-0 flex-1 pr-14">
                        <div className="flex items-center gap-1.5">
                            <h3 className="truncate text-sm font-semibold">{character.name}</h3>
                            {isFavourite(character) ? (
                                <Star className="size-3.5 shrink-0 fill-warning text-warning" />
                            ) : null}
                        </div>
                        {character.data?.creator ? (
                            <p className="truncate text-[0.6875rem] text-subtle">by {character.data.creator}</p>
                        ) : null}
                        {character.date_last_chat ? (
                            <p className="mt-1 text-[0.6875rem] text-subtle">
                                {relativeTime(character.date_last_chat)}
                            </p>
                        ) : null}
                    </div>
                </div>

                {blurb ? (
                    <p className="line-clamp-3 text-xs leading-relaxed text-muted">{blurb}</p>
                ) : (
                    <p className="text-xs italic text-subtle">No description.</p>
                )}

                {tags.length > 0 ? (
                    <div className="mt-auto flex flex-wrap gap-1 pt-1">
                        {tags.map((tag) => (
                            <Badge key={tag}>{tag}</Badge>
                        ))}
                    </div>
                ) : null}
            </Link>

            {/* Sits above the link so its clicks do not open the chat. */}
            <div className="absolute right-2 top-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-sm:opacity-100">
                <FavouriteButton character={character} />
                <CharacterActions character={character} onEdit={onEdit} compact />
            </div>
        </div>
    );
}

export function CharacterLibrary({ onOpenSettings }: { onOpenSettings(): void }) {
    const toggleSidebar = useUiStore((state) => state.toggleSidebar);
    const [query, setQuery] = useState('');
    const [sort, setSort] = useState<SortKey>('recent');
    const [editing, setEditing] = useState<Character | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [dragging, setDragging] = useState(false);
    const deferredQuery = useDeferredValue(query);
    const { data, isPending, isError, error } = useCharacters();
    const { importFiles } = useCharacterMutations();
    const fileInput = useRef<HTMLInputElement>(null);
    const navigate = useNavigate();

    const results = useMemo(() => {
        const filtered = fuzzyFilter(data ?? [], deferredQuery, (character) => [
            character.name,
            ...characterTags(character),
            character.data?.creator ?? '',
            cardField(character, 'description'),
        ]);
        return deferredQuery.trim() ? filtered : sortCharacters(filtered, sort);
    }, [data, deferredQuery, sort]);

    const openEditor = useCallback((character: Character | null) => {
        setEditing(character);
        setEditorOpen(true);
    }, []);

    const onDrop = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault();
            setDragging(false);
            const files = [...event.dataTransfer.files];
            if (files.length > 0) {
                void importFiles(files);
            }
        },
        [importFiles],
    );

    return (
        <div
            className="relative flex min-h-0 flex-1 flex-col"
            onDragOver={(event) => {
                // Only react to a file drag, not to text selection dragging.
                if (event.dataTransfer.types.includes('Files')) {
                    event.preventDefault();
                    setDragging(true);
                }
            }}
            onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setDragging(false);
                }
            }}
            onDrop={onDrop}
        >
            <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-2 lg:hidden">
                <IconButton label="Toggle character list" variant="ghost" onClick={() => toggleSidebar()}>
                    <MenuIcon className="size-4.5" />
                </IconButton>
                <span className="flex-1 text-sm font-semibold">Characters</span>
                <IconButton label="Settings" variant="ghost" onClick={onOpenSettings}>
                    <Settings2 className="size-4.5" />
                </IconButton>
            </div>

            <div className="mx-auto w-full max-w-6xl flex-1 overflow-y-auto px-4 py-6 sm:px-6">
                <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <h1 className="text-xl font-semibold max-lg:sr-only">Characters</h1>
                        <p className="mt-0.5 text-[0.8125rem] text-muted">
                            {isPending ? 'Loading your library…' : `${results.length} in your library`}
                        </p>
                    </div>

                    <div className="flex w-full items-center gap-2 sm:w-auto">
                        <GroupCreateButton />
                        <div className="relative flex-1 sm:w-56">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
                            <Input
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder="Search name, tag, creator…"
                                aria-label="Search the character library"
                                className="pl-8"
                            />
                        </div>
                        <div className="w-40 shrink-0 max-sm:hidden">
                            <Select
                                value={sort}
                                onValueChange={(value) => setSort(value as SortKey)}
                                options={SORT_OPTIONS}
                                aria-label="Sort characters"
                            />
                        </div>
                        <input
                            ref={fileInput}
                            type="file"
                            hidden
                            multiple
                            accept=".png,.json,.yaml,.yml,.charx,.byaf"
                            onChange={(event) => {
                                const files = [...(event.target.files ?? [])];
                                event.target.value = '';
                                if (files.length > 0) {
                                    void importFiles(files);
                                }
                            }}
                        />
                        <Button variant="secondary" onClick={() => fileInput.current?.click()}>
                            <Upload className="size-4" />
                            <span className="max-sm:sr-only">Import</span>
                        </Button>
                        <Button variant="primary" onClick={() => openEditor(null)}>
                            <UserPlus className="size-4" />
                            <span className="max-sm:sr-only">New</span>
                        </Button>
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

                {isPending ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {Array.from({ length: 6 }, (_, index) => (
                            <Skeleton key={index} className="h-44 rounded-card" />
                        ))}
                    </div>
                ) : isError ? (
                    <EmptyState
                        title="Could not load your library"
                        description={error instanceof Error ? error.message : 'Unknown error.'}
                    />
                ) : results.length === 0 ? (
                    <EmptyState
                        icon={query ? <Search /> : <Users />}
                        title={query ? 'No characters match that search' : 'Your library is empty'}
                        description={
                            query
                                ? 'Try a shorter query, or search by tag or creator.'
                                : 'Create a character, or drop a card file anywhere on this page to import it.'
                        }
                        action={
                            query ? null : (
                                <Button variant="primary" onClick={() => openEditor(null)}>
                                    <UserPlus className="size-4" />
                                    New character
                                </Button>
                            )
                        }
                    />
                ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {results.map((character) => (
                            <CharacterCard
                                key={character.avatar}
                                character={character}
                                onEdit={openEditor}
                            />
                        ))}
                    </div>
                )}

                {!isPending && !isError && results.length > 0 ? (
                    <p className="mt-6 flex items-center justify-center gap-1.5 text-[0.6875rem] text-subtle">
                        <ArrowUpDown className="size-3" />
                        Sorted by {SORT_OPTIONS.find((option) => option.value === sort)?.label.toLowerCase()}
                    </p>
                ) : null}
            </div>

            {dragging ? (
                <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-card border-2 border-dashed border-accent bg-accent-soft/60 backdrop-blur-sm">
                    <p className="text-sm font-medium text-accent">Drop character cards to import</p>
                </div>
            ) : null}

            <CharacterEditor
                open={editorOpen}
                onOpenChange={setEditorOpen}
                character={editing}
                onCreated={(avatar) => void navigate(`/chat/${encodeURIComponent(avatar)}`)}
            />
        </div>
    );
}
