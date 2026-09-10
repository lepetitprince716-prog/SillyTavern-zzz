import { Command, Sparkles } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useCurrentUser } from '@/api/queries';
import { CharacterSidebar } from '@/features/characters/CharacterSidebar';
import { SettingsDrawer } from '@/features/settings/SettingsDrawer';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useUiStore } from '@/store/ui';
import { CommandPalette } from './CommandPalette';
import { Drawer } from './ui/overlays';
import { Button } from './ui/primitives';

/** Matches the `lg` breakpoint, where the sidebar becomes a persistent rail. */
const DESKTOP_QUERY = '(min-width: 1024px)';

function SidebarBrand({ onOpenPalette }: { onOpenPalette(): void }) {
    const { data: user } = useCurrentUser();

    return (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <Link
                to="/characters"
                className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 transition-colors hover:bg-surface-2"
            >
                <Sparkles className="size-4 shrink-0 text-accent" />
                <span className="truncate text-[0.8125rem] font-semibold">SillyTavern</span>
            </Link>
            <Button
                size="sm"
                variant="ghost"
                onClick={onOpenPalette}
                className="ml-auto gap-1.5 px-2 text-subtle"
                title="Command palette (⌘K)"
            >
                <Command className="size-3" />
                <span className="text-[0.6875rem]">K</span>
            </Button>
            {user?.name ? (
                <span className="max-w-20 truncate text-[0.6875rem] text-subtle" title={user.name}>
                    {user.name}
                </span>
            ) : null}
        </div>
    );
}

/**
 * App frame: a persistent character rail on wide screens, the same list as an
 * overlay drawer on narrow ones, plus the palette and settings surfaces.
 *
 * `children` receives a callback to open settings, because the chat header needs
 * to reach it and threading a context through for one function is heavier than
 * the render prop.
 */
export function AppShell({ children }: { children: (open: { openSettings(): void }) => ReactNode }) {
    const isDesktop = useMediaQuery(DESKTOP_QUERY);
    const sidebarOpen = useUiStore((state) => state.sidebarOpen);
    const toggleSidebar = useUiStore((state) => state.toggleSidebar);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);

    // The rail's open state is persisted, which is right for desktop but would
    // otherwise greet a phone with an overlay on load.
    useEffect(() => {
        if (!isDesktop) {
            toggleSidebar(false);
        }
    }, [isDesktop, toggleSidebar]);

    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            const modifier = event.metaKey || event.ctrlKey;
            if (modifier && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                setPaletteOpen((open) => !open);
                return;
            }
            // Comma is the conventional settings shortcut on both platforms.
            if (modifier && event.key === ',') {
                event.preventDefault();
                setSettingsOpen(true);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    return (
        <div className="flex h-full overflow-hidden">
            {isDesktop ? (
                <aside
                    className={cn(
                        'flex shrink-0 flex-col border-r border-border bg-surface/50',
                        'transition-[width] duration-200',
                        sidebarOpen ? 'w-72' : 'w-0 overflow-hidden border-r-0',
                    )}
                >
                    <SidebarBrand onOpenPalette={() => setPaletteOpen(true)} />
                    <CharacterSidebar />
                </aside>
            ) : (
                <Drawer
                    open={sidebarOpen}
                    onOpenChange={(open) => toggleSidebar(open)}
                    title="Characters"
                    side="left"
                >
                    <div className="-mx-5 -my-4">
                        <CharacterSidebar onNavigate={() => toggleSidebar(false)} />
                    </div>
                </Drawer>
            )}

            <main className="flex min-w-0 flex-1 flex-col">
                {children({ openSettings: () => setSettingsOpen(true) })}
            </main>

            <CommandPalette
                open={paletteOpen}
                onOpenChange={setPaletteOpen}
                onOpenSettings={() => setSettingsOpen(true)}
            />
            <SettingsDrawer open={settingsOpen} onOpenChange={setSettingsOpen} />
        </div>
    );
}
