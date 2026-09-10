import { Dialog as RadixDialog } from 'radix-ui';
import {
    LayoutGrid,
    Library,
    MessageSquarePlus,
    Moon,
    Puzzle,
    Search,
    Settings2,
    Sun,
    Type,
    User,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { avatarUrl, characterTags } from '@/api/characters';
import { useCharacters } from '@/api/queries';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/cn';
import { fuzzyFilter } from '@/lib/search';
import { useUiStore } from '@/store/ui';

interface Command {
    id: string;
    label: string;
    hint?: string;
    icon: ReactNode;
    group: 'Characters' | 'Actions';
    run(): void;
}

/**
 * The palette body.
 *
 * Rendered only while the dialog is open, so query and highlight state start
 * clean on every open without an effect to reset them.
 */
function PaletteBody({
    close,
    onOpenSettings,
}: {
    close(): void;
    onOpenSettings(): void;
}) {
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const [lastQuery, setLastQuery] = useState('');
    const navigate = useNavigate();
    const { data: characters } = useCharacters();
    const theme = useUiStore((state) => state.theme);
    const setTheme = useUiStore((state) => state.setTheme);
    const proseFont = useUiStore((state) => state.proseFont);
    const setProseFont = useUiStore((state) => state.setProseFont);
    const listRef = useRef<HTMLDivElement>(null);

    // Adjusting state during render, rather than in an effect: React re-runs
    // this component before painting, so the highlight never shows a stale row.
    if (query !== lastQuery) {
        setLastQuery(query);
        setActive(0);
    }

    const commands = useMemo<Command[]>(() => {
        const characterCommands: Command[] = (characters ?? []).map((character) => ({
            id: `character:${character.avatar}`,
            label: character.name,
            hint: characterTags(character).slice(0, 2).join(' · '),
            icon: (
                <Avatar src={avatarUrl(character.avatar)} name={character.name} size="xs" rounded="card" />
            ),
            group: 'Characters',
            run: () => {
                void navigate(`/chat/${encodeURIComponent(character.avatar)}`);
                close();
            },
        }));

        const actions: Command[] = [
            {
                id: 'action:library',
                label: 'Open character library',
                icon: <LayoutGrid className="size-4" />,
                group: 'Actions',
                run: () => {
                    void navigate('/characters');
                    close();
                },
            },
            {
                id: 'action:worldinfo',
                label: 'Open lorebooks',
                icon: <Library className="size-4" />,
                group: 'Actions',
                run: () => {
                    void navigate('/worldinfo');
                    close();
                },
            },
            {
                id: 'action:extensions',
                label: 'Open extensions',
                icon: <Puzzle className="size-4" />,
                group: 'Actions',
                run: () => {
                    void navigate('/extensions');
                    close();
                },
            },
            {
                id: 'action:settings',
                label: 'Open settings',
                icon: <Settings2 className="size-4" />,
                group: 'Actions',
                run: () => {
                    onOpenSettings();
                    close();
                },
            },
            {
                id: 'action:theme',
                label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
                icon: theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />,
                group: 'Actions',
                run: () => {
                    setTheme(theme === 'dark' ? 'light' : 'dark');
                    close();
                },
            },
            {
                id: 'action:font',
                label: proseFont === 'serif' ? 'Use a sans-serif message font' : 'Use a serif message font',
                icon: <Type className="size-4" />,
                group: 'Actions',
                run: () => {
                    setProseFont(proseFont === 'serif' ? 'sans' : 'serif');
                    close();
                },
            },
            {
                id: 'action:classic',
                label: 'Open the classic interface',
                icon: <User className="size-4" />,
                group: 'Actions',
                run: () => {
                    window.location.assign('/');
                },
            },
        ];

        return [...characterCommands, ...actions];
    }, [characters, close, navigate, onOpenSettings, proseFont, setProseFont, setTheme, theme]);

    const results = useMemo(
        () => fuzzyFilter(commands, query, (command) => [command.label, command.hint ?? '']).slice(0, 40),
        [commands, query],
    );

    // Keep the highlighted row in view as the selection moves by keyboard.
    useEffect(() => {
        listRef.current
            ?.querySelector(`[data-index="${active}"]`)
            ?.scrollIntoView({ block: 'nearest' });
    }, [active]);

    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((index) => (index + 1) % Math.max(results.length, 1));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => (index - 1 + results.length) % Math.max(results.length, 1));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            results[active]?.run();
        }
    };

    let lastGroup = '';

    return (
        <RadixDialog.Portal>
            <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
            <RadixDialog.Content
                onKeyDown={onKeyDown}
                className={cn(
                    'fixed left-1/2 top-[12vh] z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2',
                    'overflow-hidden rounded-xl border border-border bg-surface shadow-pop',
                )}
            >
                <RadixDialog.Title className="sr-only">Command palette</RadixDialog.Title>
                <RadixDialog.Description className="sr-only">
                        Search characters and run actions.
                </RadixDialog.Description>

                <div className="flex items-center gap-2.5 border-b border-border px-4">
                    <Search className="size-4 shrink-0 text-subtle" />
                    <input
                        autoFocus
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search characters or run a command…"
                        aria-label="Search characters or run a command"
                        className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
                    />
                    <kbd className="rounded border border-border px-1.5 py-0.5 text-[0.625rem] text-subtle">
                            Esc
                    </kbd>
                </div>

                <div ref={listRef} className="max-h-[min(24rem,60dvh)] overflow-y-auto p-1.5">
                    {results.length === 0 ? (
                        <p className="px-3 py-8 text-center text-sm text-subtle">No matches.</p>
                    ) : (
                        results.map((command, index) => {
                            const showGroup = command.group !== lastGroup;
                            lastGroup = command.group;
                            return (
                                <div key={command.id}>
                                    {showGroup ? (
                                        <p className="px-2.5 pb-1 pt-2 text-[0.625rem] font-semibold uppercase tracking-wide text-subtle">
                                            {command.group}
                                        </p>
                                    ) : null}
                                    <button
                                        type="button"
                                        data-index={index}
                                        onMouseMove={() => setActive(index)}
                                        onClick={() => command.run()}
                                        className={cn(
                                            'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                                            index === active ? 'bg-surface-2' : 'hover:bg-surface-2/60',
                                        )}
                                    >
                                        <span className="shrink-0 text-subtle">{command.icon}</span>
                                        <span className="min-w-0 flex-1 truncate text-[0.8125rem]">
                                            {command.label}
                                        </span>
                                        {command.hint ? (
                                            <span className="shrink-0 truncate text-[0.6875rem] text-subtle">
                                                {command.hint}
                                            </span>
                                        ) : null}
                                    </button>
                                </div>
                            );
                        })
                    )}
                </div>

                <div className="flex items-center gap-3 border-t border-border bg-surface-2/50 px-4 py-2 text-[0.625rem] text-subtle">
                    <span>↑↓ navigate</span>
                    <span>↩ open</span>
                    <span className="ml-auto inline-flex items-center gap-1">
                        <MessageSquarePlus className="size-3" />
                            Pick a character to start chatting
                    </span>
                </div>
            </RadixDialog.Content>
        </RadixDialog.Portal>
    );
}

export function CommandPalette({
    open,
    onOpenChange,
    onOpenSettings,
}: {
    open: boolean;
    onOpenChange(open: boolean): void;
    onOpenSettings(): void;
}) {
    const close = useCallback(() => onOpenChange(false), [onOpenChange]);
    return (
        <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
            {open ? <PaletteBody close={close} onOpenSettings={onOpenSettings} /> : null}
        </RadixDialog.Root>
    );
}
