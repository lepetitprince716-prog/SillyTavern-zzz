import { LayoutGrid, Search, Star, Users, X } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { avatarUrl, characterTags } from '@/api/characters';
import { useCharacters } from '@/api/queries';
import type { Character } from '@/api/types';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState, IconButton, Input, SectionLabel, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { fuzzyFilter } from '@/lib/search';
import { isFavourite } from './utils';

function CharacterRow({ character, onNavigate }: { character: Character; onNavigate?(): void }) {
    return (
        <NavLink
            to={`/chat/${encodeURIComponent(character.avatar)}`}
            onClick={onNavigate}
            className={({ isActive }) =>
                cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
                    isActive ? 'bg-accent-soft text-text' : 'hover:bg-surface-2',
                )
            }
        >
            <Avatar src={avatarUrl(character.avatar)} name={character.name} size="sm" rounded="card" />
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                    <span className="truncate text-[0.8125rem] font-medium">{character.name}</span>
                    {isFavourite(character) ? (
                        <Star className="size-3 shrink-0 fill-warning text-warning" />
                    ) : null}
                </span>
                {character.date_last_chat ? (
                    <span className="block truncate text-[0.6875rem] text-subtle">
                        {relativeTime(character.date_last_chat)}
                    </span>
                ) : null}
            </span>
        </NavLink>
    );
}

export function CharacterSidebar({ onNavigate }: { onNavigate?(): void }) {
    const [query, setQuery] = useState('');
    const [favouritesOnly, setFavouritesOnly] = useState(false);
    const deferredQuery = useDeferredValue(query);
    const { data, isPending, isError, error } = useCharacters();
    const navigate = useNavigate();

    const results = useMemo(() => {
        const source = data ?? [];
        const scoped = favouritesOnly ? source.filter(isFavourite) : source;
        const filtered = fuzzyFilter(scoped, deferredQuery, (character) => [
            character.name,
            ...characterTags(character),
            character.data?.creator ?? '',
        ]);
        if (deferredQuery.trim()) {
            return filtered;
        }
        // Default order: most recently talked to first, then alphabetical.
        return [...filtered].sort((a, b) => {
            const diff = (b.date_last_chat ?? 0) - (a.date_last_chat ?? 0);
            return diff !== 0 ? diff : a.name.localeCompare(b.name);
        });
    }, [data, deferredQuery, favouritesOnly]);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="space-y-2 p-2.5">
                <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
                    <Input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && results[0]) {
                                void navigate(`/chat/${encodeURIComponent(results[0].avatar)}`);
                                onNavigate?.();
                            }
                        }}
                        placeholder="Search characters…"
                        aria-label="Filter the character list"
                        className="h-9 pl-8 pr-8"
                    />
                    {query ? (
                        <IconButton
                            label="Clear search"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setQuery('')}
                            className="absolute right-1 top-1/2 -translate-y-1/2"
                        >
                            <X className="size-3.5" />
                        </IconButton>
                    ) : null}
                </div>

                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => setFavouritesOnly((value) => !value)}
                        aria-pressed={favouritesOnly}
                        className={cn(
                            'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.6875rem] font-medium transition-colors',
                            favouritesOnly
                                ? 'bg-warning/15 text-warning'
                                : 'text-subtle hover:bg-surface-2 hover:text-text',
                        )}
                    >
                        <Star className={cn('size-3', favouritesOnly && 'fill-current')} />
                        Favourites
                    </button>
                    <NavLink
                        to="/characters"
                        onClick={onNavigate}
                        className={({ isActive }) =>
                            cn(
                                'ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.6875rem] font-medium transition-colors',
                                isActive ? 'text-accent' : 'text-subtle hover:bg-surface-2 hover:text-text',
                            )
                        }
                    >
                        <LayoutGrid className="size-3" />
                        Library
                    </NavLink>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
                <SectionLabel className="px-2.5 py-1.5">
                    {isPending ? 'Loading' : `${results.length} character${results.length === 1 ? '' : 's'}`}
                </SectionLabel>

                {isPending ? (
                    <div className="space-y-1 px-1">
                        {[0, 1, 2, 3, 4, 5].map((row) => (
                            <div key={row} className="flex items-center gap-2.5 px-1 py-2">
                                <Skeleton className="size-8 rounded-[0.625rem]" />
                                <Skeleton className="h-3 flex-1" />
                            </div>
                        ))}
                    </div>
                ) : isError ? (
                    <EmptyState
                        title="Could not load characters"
                        description={error instanceof Error ? error.message : 'Unknown error.'}
                    />
                ) : results.length === 0 ? (
                    <EmptyState
                        icon={<Users />}
                        title={query ? 'No matches' : 'No characters yet'}
                        description={
                            query
                                ? 'Try a different name, tag or creator.'
                                : 'Import a character card from the classic interface to get started.'
                        }
                    />
                ) : (
                    <nav className="space-y-0.5" aria-label="Characters">
                        {results.map((character) => (
                            <CharacterRow
                                key={character.avatar}
                                character={character}
                                {...(onNavigate ? { onNavigate } : {})}
                            />
                        ))}
                    </nav>
                )}
            </div>
        </div>
    );
}
