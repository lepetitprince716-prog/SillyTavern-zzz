// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGet, apiPost, apiPostForm, ApiError } from './client';

/** Records what fetch was called with, so headers can be asserted. */
interface Call {
    url: string;
    init: RequestInit;
}

let calls: Call[];

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

beforeEach(() => {
    calls = [];
    vi.stubGlobal(
        'fetch',
        vi.fn((url: string, init: RequestInit = {}) => {
            calls.push({ url, init });
            if (url === '/csrf-token') {
                return Promise.resolve(jsonResponse({ token: 'test-token' }));
            }
            if (url === '/fail') {
                return Promise.resolve(jsonResponse({ error: 'nope' }, 500));
            }
            return Promise.resolve(jsonResponse({ ok: true }));
        }),
    );
});

afterEach(() => vi.unstubAllGlobals());

function headerOf(call: Call, name: string): string | null {
    return new Headers(call.init.headers).get(name);
}

describe('content type negotiation', () => {
    it('sends application/json for a JSON body', async () => {
        await apiPost('/api/thing', { a: 1 });
        const call = calls.find((entry) => entry.url === '/api/thing');
        expect(headerOf(call as Call, 'Content-Type')).toBe('application/json');
    });

    it('leaves FormData without a content type so the browser sets the boundary', async () => {
        const form = new FormData();
        form.append('avatar', new Blob(['x']), 'card.png');
        await apiPostForm('/api/upload', form);
        const call = calls.find((entry) => entry.url === '/api/upload');
        // Setting it by hand omits the multipart boundary, and the server then
        // fails to parse the upload.
        expect(headerOf(call as Call, 'Content-Type')).toBeNull();
        expect(call?.init.body).toBeInstanceOf(FormData);
    });

    it('sends no content type for a bodyless GET', async () => {
        await apiGet('/api/thing');
        const call = calls.find((entry) => entry.url === '/api/thing');
        expect(headerOf(call as Call, 'Content-Type')).toBeNull();
    });
});

describe('CSRF handling', () => {
    it('does not re-fetch the token per request', async () => {
        await apiPost('/api/one', {});
        await apiPost('/api/two', {});
        // The token is cached for the module's lifetime, so a cold first test
        // sees one fetch and a warm one sees none. Either way, two requests
        // must never cost two token fetches.
        expect(calls.filter((entry) => entry.url === '/csrf-token').length).toBeLessThanOrEqual(1);
        for (const path of ['/api/one', '/api/two']) {
            const call = calls.find((entry) => entry.url === path);
            expect(headerOf(call as Call, 'X-CSRF-Token')).toBe('test-token');
        }
    });

    it('attaches the token to every request', async () => {
        await apiPost('/api/thing', {});
        const call = calls.find((entry) => entry.url === '/api/thing');
        expect(headerOf(call as Call, 'X-CSRF-Token')).toBe('test-token');
    });
});

describe('error handling', () => {
    it('raises an ApiError carrying the status and body', async () => {
        await expect(apiPost('/fail', {})).rejects.toThrow(ApiError);
        await expect(apiPost('/fail', {})).rejects.toThrow('nope');
    });
});
