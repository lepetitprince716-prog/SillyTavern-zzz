import { ArrowUpDown, Menu as MenuIcon, Search, Settings2, Star, Users } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { avatarUrl, cardField, characterTags } from '@/api/characters';
import { useCharacters } from '@/api/queries';
import type { Character } from '@/api/types';
import { Avatar } from '@/components/ui/Avatar';
import { Select } from '@/components/ui/controls';
import { Badge, EmptyState, IconButton, Input, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { fuzzyFilter } from '@/lib/search';
import { useUiStore } from '@/store/ui';
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

function CharacterCard({ character }: { character: Character }) {
    const tags = characterTags(character).slice(0, 3);
    const blurb = cardField(character, 'description').replace(/\s+/g, ' ').trim();

    return (
        <Link
            to={`/chat/${encodeURIComponent(character.avatar)}`}
            className={cn(
                'group flex flex-col gap-3 rounded-card border border-border bg-surface p-4',
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
                <div className="min-w-0 flex-1">
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
    );
}

export function CharacterLibrary({ onOpenSettings }: { onOpenSettings(): void }) {
    const toggleSidebar = useUiStore((state) => state.toggleSidebar);
    const [query, setQuery] = useState('');
    const [sort, setSort] = useState<SortKey>('recent');
    const deferredQuery = useDeferredValue(query);
    const { data, isPending, isError, error } = useCharacters();

    const results = useMemo(() => {
        const filtered = fuzzyFilter(data ?? [], deferredQuery, (character) => [
            character.name,
            ...characterTags(character),
            character.data?.creator ?? '',
            cardField(character, 'description'),
        ]);
        return deferredQuery.trim() ? filtered : sortCharacters(filtered, sort);
    }, [data, deferredQuery, sort]);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-2 lg:hidden">
                <IconButton
                    label="Toggle character list"
                    variant="ghost"
                    onClick={() => toggleSidebar()}
                >
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
                        <div className="relative flex-1 sm:w-64">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
                            <Input
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder="Search name, tag, creator…"
                                aria-label="Search characters"
                                className="pl-8"
                            />
                        </div>
                        <div className="w-44 shrink-0 max-sm:hidden">
                            <Select
                                value={sort}
                                onValueChange={(value) => setSort(value as SortKey)}
                                options={SORT_OPTIONS}
                                aria-label="Sort characters"
                            />
                        </div>
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
                                : 'Import a character card from the classic interface and it will appear here.'
                        }
                    />
                ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {results.map((character) => (
                            <CharacterCard key={character.avatar} character={character} />
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
        </div>
    );
}
