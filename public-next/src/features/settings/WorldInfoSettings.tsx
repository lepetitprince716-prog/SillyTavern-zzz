import { Info, Library } from 'lucide-react';
import { Link } from 'react-router';
import { useWorldInfoList } from '@/api/queries';
import { Slider, ToggleRow } from '@/components/ui/controls';
import { SectionLabel } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { useSessionStore } from '@/store/session';

/**
 * Engine settings for world info.
 *
 * These are the knobs that used to be scattered between a global panel, a
 * per-character field and each entry. Only the ones that change behaviour for
 * every entry live here; anything entry-specific belongs on the entry.
 */
export function WorldInfoSettings() {
    const settings = useSessionStore((state) => state.worldInfo);
    const setWorldInfo = useSessionStore((state) => state.setWorldInfo);
    const { data: books, isPending } = useWorldInfoList();

    const toggleBook = (name: string) => {
        setWorldInfo({
            books: settings.books.includes(name)
                ? settings.books.filter((entry) => entry !== name)
                : [...settings.books, name],
        });
    };

    return (
        <div className="space-y-5">
            <ToggleRow
                label="Use world info"
                description="Off means no lorebook content reaches the prompt, whatever is selected below."
                checked={settings.enabled}
                onCheckedChange={(enabled) => setWorldInfo({ enabled })}
            />

            <div className={cn('space-y-5', !settings.enabled && 'pointer-events-none opacity-50')}>
                <ToggleRow
                    label="Include the character's own book"
                    description="Cards can name a lorebook. This uses it whenever one is set."
                    checked={settings.useCharacterBook}
                    onCheckedChange={(useCharacterBook) => setWorldInfo({ useCharacterBook })}
                />

                <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                        <SectionLabel className="px-0">Always-active books</SectionLabel>
                        <Link
                            to="/worldinfo"
                            className="inline-flex items-center gap-1 text-[0.6875rem] text-accent transition-opacity hover:opacity-80"
                        >
                            <Library className="size-3" />
                            Manage
                        </Link>
                    </div>

                    {isPending ? (
                        <p className="text-xs text-subtle">Loading…</p>
                    ) : (books?.length ?? 0) === 0 ? (
                        <p className="text-xs leading-relaxed text-subtle">
                            No lorebooks yet. Create one from the Lore page.
                        </p>
                    ) : (
                        <div className="space-y-1">
                            {books?.map((entry) => {
                                const active = settings.books.includes(entry.file_id);
                                return (
                                    <button
                                        key={entry.file_id}
                                        type="button"
                                        role="checkbox"
                                        aria-checked={active}
                                        onClick={() => toggleBook(entry.file_id)}
                                        className={cn(
                                            'flex w-full items-center gap-2 rounded-lg border p-2 text-left transition-colors',
                                            active ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-2',
                                        )}
                                    >
                                        <span
                                            aria-hidden
                                            className={cn(
                                                'size-3.5 shrink-0 rounded border',
                                                active ? 'border-accent bg-accent' : 'border-border-strong',
                                            )}
                                        />
                                        <span className="truncate text-[0.8125rem]">
                                            {entry.name || entry.file_id}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="space-y-4 border-t border-border pt-4">
                    <Slider
                        label="Token budget"
                        value={settings.budgetTokens}
                        onValueChange={(budgetTokens) => setWorldInfo({ budgetTokens })}
                        min={128}
                        max={8192}
                        step={128}
                        format={(value) => `${value} tok`}
                    />
                    <p className="text-[0.6875rem] leading-relaxed text-subtle">
                        Entries compete for this budget by relevance, not by their order. The activation
                        trace in the character panel shows what fit and what did not.
                    </p>

                    <Slider
                        label="Messages scanned for keys"
                        value={settings.scanDepth}
                        onValueChange={(scanDepth) => setWorldInfo({ scanDepth })}
                        min={0}
                        max={40}
                        step={1}
                        format={(value) => (value === 0 ? 'none' : `last ${value}`)}
                    />

                    <Slider
                        label="Chained activations"
                        value={settings.maxRecursionRounds}
                        onValueChange={(maxRecursionRounds) => setWorldInfo({ maxRecursionRounds })}
                        min={0}
                        max={4}
                        step={1}
                        format={(value) => (value === 0 ? 'off' : `${value} round${value === 1 ? '' : 's'}`)}
                    />
                    <p className="text-[0.6875rem] leading-relaxed text-subtle">
                        How many times an activated entry may trigger further entries. Each round is shown in
                        the trace, so a chain stays legible.
                    </p>
                </div>

                <div className="space-y-4 border-t border-border pt-4">
                    <ToggleRow
                        label="Match by meaning as well as by key"
                        description="Lets an entry fire when the conversation is about it, even without an exact keyword."
                        checked={settings.semanticEnabled}
                        onCheckedChange={(semanticEnabled) => setWorldInfo({ semanticEnabled })}
                    />

                    {settings.semanticEnabled ? (
                        <>
                            <p className="flex items-start gap-1.5 rounded-lg bg-surface-2 px-3 py-2 text-[0.6875rem] leading-relaxed text-muted">
                                <Info className="mt-px size-3 shrink-0" />
                                Embeddings are computed on this machine by the server. The first run downloads
                                a small model, so the first reply after switching this on can take a while.
                                Individual entries can opt out.
                            </p>
                            <Slider
                                label="Entries meaning may add"
                                value={settings.semanticTopK}
                                onValueChange={(semanticTopK) => setWorldInfo({ semanticTopK })}
                                min={1}
                                max={10}
                                step={1}
                                format={(value) => `at most ${value}`}
                            />
                            <Slider
                                label="Similarity floor"
                                value={settings.semanticThreshold}
                                onValueChange={(semanticThreshold) => setWorldInfo({ semanticThreshold })}
                                min={0.05}
                                max={0.8}
                                step={0.05}
                                format={(value) => `${Math.round(value * 100)}%`}
                            />
                            <p className="text-[0.6875rem] leading-relaxed text-subtle">
                                The closest entries above the floor are added, up to the limit above. Absolute
                                similarity depends on the embedding model — the bundled local one scores
                                clearly related lore around 40% and unrelated lore around 10%, so the floor is
                                for filtering noise, not for judging confidence. The activation trace shows
                                every entry's real score.
                            </p>
                        </>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
