/**
 * One clock, shared by everything that shows a relative time.
 *
 * `relativeTime(date)` is computed during render, so its output freezes at
 * whatever the clock said the last time that component rendered. In a message
 * list, where each bubble re-renders on its own schedule, that produces
 * timestamps that disagree with each other: a message can read "8 seconds ago"
 * directly under a newer one reading "now", which the reader can only take as
 * the history being out of order.
 *
 * Subscribing to a single interval fixes it at the source — every subscriber
 * formats against the same instant, and they all move together.
 */

import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

/** How coarse the shared instant is. Nothing on screen is finer-grained. */
const BUCKET_MS = 15_000;
/** Polled more often than the bucket, so a tick never lands just short of one. */
const TICK_MS = BUCKET_MS / 3;

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    if (timer === undefined) {
        timer = setInterval(() => {
            for (const notify of listeners) {
                notify();
            }
        }, TICK_MS);
    }
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== undefined) {
            clearInterval(timer);
            timer = undefined;
        }
    };
}

/**
 * The wall clock, rounded down to the bucket.
 *
 * Derived rather than stored so it cannot go stale — a stored value read
 * before the first tick is behind the messages it is measuring, which comes
 * out as a timestamp in the *future* ("in 1 second"). Rounding keeps it equal
 * between ticks, which is what stops it causing renders of its own.
 */
function getSnapshot(): number {
    return Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;
}

/**
 * The current time, updated periodically.
 *
 * The value is stable between ticks, so it does not itself cause renders — it
 * only makes the renders that happen agree with each other.
 */
export function useNow(): number {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
