import { useCallback, useSyncExternalStore } from 'react';

/**
 * Subscribes to a CSS media query.
 *
 * Used where a layout decision cannot be expressed in CSS alone — a portalled
 * overlay, for instance, cannot simply be hidden at a breakpoint.
 *
 * Built on `useSyncExternalStore` rather than an effect: `matchMedia` is an
 * external store, so reading it during render keeps the first paint correct
 * instead of rendering the wrong branch and correcting it afterwards.
 */
export function useMediaQuery(query: string): boolean {
    const subscribe = useCallback(
        (onChange: () => void) => {
            const list = window.matchMedia(query);
            list.addEventListener('change', onChange);
            return () => list.removeEventListener('change', onChange);
        },
        [query],
    );

    const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

    // No DOM on the server, so fall back to the narrow layout.
    const getServerSnapshot = () => false;

    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
