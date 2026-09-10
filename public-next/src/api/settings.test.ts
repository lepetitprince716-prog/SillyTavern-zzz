// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateSettings } from './settings';

/**
 * A stand-in for `settings.json` behind the two routes that touch it.
 *
 * `/api/settings/get` hands out the file as a string; `/api/settings/save`
 * replaces it wholesale. `readDelay` models the round trip, which is where the
 * window for one change to overwrite another lives.
 */
let file: Record<string, unknown>;
let saves: number;
let readDelay: number;

function later<T>(value: T, ms: number): Promise<T> {
    return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

beforeEach(() => {
    file = { extension_settings: { disabledExtensions: [] }, untouched: { by: 'this app' } };
    saves = 0;
    readDelay = 5;
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init: RequestInit = {}) => {
            if (url === '/csrf-token') {
                return new Response(JSON.stringify({ token: 't' }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (url === '/api/settings/get') {
                const body = await later(JSON.stringify({ settings: JSON.stringify(file) }), readDelay);
                return new Response(body, {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (url === '/api/settings/save') {
                saves += 1;
                file = JSON.parse(String(init.body)) as Record<string, unknown>;
                return new Response(JSON.stringify({ result: 'ok' }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            throw new Error(`unexpected request to ${url}`);
        }),
    );
});

afterEach(() => vi.unstubAllGlobals());

function disabledList(): string[] {
    const settings = file.extension_settings as { disabledExtensions?: string[] };
    return settings.disabledExtensions ?? [];
}

/** Adds a name to the disabled list, the way the extension manager does. */
function disable(name: string) {
    return updateSettings<Record<string, unknown>>((settings) => {
        const extensions = { ...(settings.extension_settings as object) } as {
            disabledExtensions?: string[];
        };
        return {
            ...settings,
            extension_settings: {
                ...extensions,
                disabledExtensions: [...(extensions.disabledExtensions ?? []), name],
            },
        };
    });
}

describe('updateSettings', () => {
    it('reads, patches and writes the whole file', async () => {
        await disable('tts');
        expect(disabledList()).toEqual(['tts']);
        expect(file.untouched).toEqual({ by: 'this app' });
        expect(saves).toBe(1);
    });

    it('does not lose a change made while another is in flight', async () => {
        // Unqueued, both reads see an empty list and the second write puts back
        // a file that has never heard of the first change. That is what
        // switching two extensions off in quick succession used to do.
        await Promise.all([disable('tts'), disable('gallery')]);
        expect(disabledList()).toEqual(['tts', 'gallery']);
        expect(saves).toBe(2);
    });

    it('holds the order the changes were made in', async () => {
        const names = ['a', 'b', 'c', 'd'];
        await Promise.all(names.map((name) => disable(name)));
        expect(disabledList()).toEqual(names);
    });

    it('keeps going after a change fails', async () => {
        const failure = updateSettings(() => {
            throw new Error('patch exploded');
        });
        await expect(failure).rejects.toThrow('patch exploded');

        await disable('tts');
        expect(disabledList()).toEqual(['tts']);
    });

    it('rejects rather than writing when the file cannot be parsed', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                if (url === '/csrf-token') {
                    return new Response(JSON.stringify({ token: 't' }), { status: 200 });
                }
                return new Response(JSON.stringify({ settings: '{ not json' }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }),
        );
        await expect(updateSettings((settings) => settings)).rejects.toThrow(/could not be read/);
        expect(saves).toBe(0);
    });
});
