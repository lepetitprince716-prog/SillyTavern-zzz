import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'system' | 'light' | 'dark';
export type Density = 'compact' | 'comfortable' | 'spacious';
export type ProseFont = 'sans' | 'serif';
/** Which list the right-hand panel is showing. */
export type PanelTab = 'character' | 'images';

interface UiState {
    theme: ThemeMode;
    density: Density;
    proseFont: ProseFont;
    /** Hue angle (0–360) for the OKLCH accent ramp. */
    accentHue: number;
    /** Message body size in rem. */
    proseSize: number;
    /** Left rail open on desktop; on mobile it becomes an overlay. */
    sidebarOpen: boolean;
    /** Right inspector panel (character details, chat history, images). */
    inspectorOpen: boolean;
    panelTab: PanelTab;
    showTimestamps: boolean;
    showTokenCounts: boolean;
    /** Send on Enter; Shift+Enter inserts a newline. Inverted when false. */
    enterToSend: boolean;

    setTheme(theme: ThemeMode): void;
    setDensity(density: Density): void;
    setProseFont(font: ProseFont): void;
    setAccentHue(hue: number): void;
    setProseSize(size: number): void;
    toggleSidebar(open?: boolean): void;
    toggleInspector(open?: boolean): void;
    setPanelTab(tab: PanelTab): void;
    setShowTimestamps(value: boolean): void;
    setShowTokenCounts(value: boolean): void;
    setEnterToSend(value: boolean): void;
}

export const useUiStore = create<UiState>()(
    persist(
        (set) => ({
            theme: 'system',
            density: 'comfortable',
            proseFont: 'sans',
            accentHue: 285,
            proseSize: 1,
            sidebarOpen: true,
            inspectorOpen: false,
            panelTab: 'character',
            showTimestamps: true,
            showTokenCounts: false,
            enterToSend: true,

            setTheme: (theme) => set({ theme }),
            setDensity: (density) => set({ density }),
            setProseFont: (proseFont) => set({ proseFont }),
            setAccentHue: (accentHue) => set({ accentHue }),
            setProseSize: (proseSize) => set({ proseSize }),
            toggleSidebar: (open) => set((state) => ({ sidebarOpen: open ?? !state.sidebarOpen })),
            toggleInspector: (open) => set((state) => ({ inspectorOpen: open ?? !state.inspectorOpen })),
            setPanelTab: (panelTab) => set({ panelTab }),
            setShowTimestamps: (showTimestamps) => set({ showTimestamps }),
            setShowTokenCounts: (showTokenCounts) => set({ showTokenCounts }),
            setEnterToSend: (enterToSend) => set({ enterToSend }),
        }),
        {
            name: 'st-next:ui',
            version: 1,
            // `sidebarOpen` is intentionally persisted: returning to the layout
            // you left is less surprising than a reset on every reload.
        },
    ),
);

/**
 * Reflects appearance state onto the document element.
 *
 * The same attributes are set by the inline boot script in `index.html`; this
 * keeps them in sync as the user changes settings.
 */
export function applyAppearance(state: Pick<UiState, 'theme' | 'density' | 'proseFont' | 'accentHue' | 'proseSize'>): void {
    const root = document.documentElement;
    if (state.theme === 'system') {
        delete root.dataset.theme;
    } else {
        root.dataset.theme = state.theme;
    }
    root.dataset.density = state.density;
    root.dataset.proseFont = state.proseFont;
    root.style.setProperty('--accent-hue', String(state.accentHue));
    root.style.setProperty('--prose-size', `${state.proseSize}rem`);
}
