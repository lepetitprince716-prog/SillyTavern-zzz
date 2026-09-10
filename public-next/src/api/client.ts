/**
 * Thin, typed transport for the SillyTavern backend.
 *
 * Everything the app sends goes through here so that CSRF handling, error
 * normalisation and the "session expired" redirect exist in exactly one place.
 */

/** An unsuccessful HTTP response. `body` is whatever the server sent back. */
export class ApiError extends Error {
    readonly status: number;
    readonly body: unknown;

    constructor(status: number, message: string, body: unknown) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.body = body;
    }

    /** True when the failure is worth retrying with a fresh CSRF token. */
    get isCsrfFailure(): boolean {
        return this.status === 403;
    }
}

let csrfToken: string | null = null;
let csrfPending: Promise<string> | null = null;

/**
 * Fetches the CSRF token, coalescing concurrent callers onto one request.
 * @param force Discard any cached token first.
 */
export async function getCsrfToken(force = false): Promise<string> {
    if (!force && csrfToken) {
        return csrfToken;
    }
    if (!force && csrfPending) {
        return csrfPending;
    }

    csrfPending = (async () => {
        const response = await fetch('/csrf-token', { credentials: 'same-origin' });
        if (!response.ok) {
            throw new ApiError(response.status, 'Could not obtain a CSRF token.', null);
        }
        const data = (await response.json()) as { token?: string };
        if (!data.token) {
            throw new ApiError(response.status, 'The CSRF token response was empty.', data);
        }
        csrfToken = data.token;
        return data.token;
    })();

    try {
        return await csrfPending;
    } finally {
        csrfPending = null;
    }
}

/** Sends the browser to the login page, preserving where the user was. */
function redirectToLogin(): void {
    const target = new URL('/login', window.location.origin);
    target.searchParams.set('from', window.location.pathname + window.location.search);
    window.location.assign(target.toString());
}

async function readBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
}

function describe(status: number, body: unknown): string {
    if (typeof body === 'string' && body.trim()) {
        return body.slice(0, 400);
    }
    if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        for (const key of ['error', 'message', 'detail'] as const) {
            const value = record[key];
            if (typeof value === 'string' && value) {
                return value;
            }
        }
    }
    return `Request failed with status ${status}.`;
}

export interface RequestOptions {
    signal?: AbortSignal;
    /** Set to false for endpoints that must not carry the session cookie. */
    credentials?: RequestCredentials;
}

/**
 * Issues a request with CSRF protection, retrying once if the token was stale.
 * Callers get parsed JSON, or a normalised {@link ApiError}.
 */
async function request(
    path: string,
    init: RequestInit,
    options: RequestOptions = {},
    isRetry = false,
): Promise<Response> {
    const token = await getCsrfToken();
    const headers = new Headers(init.headers);
    headers.set('X-CSRF-Token', token);
    if (init.body !== undefined && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(path, {
        ...init,
        headers,
        credentials: options.credentials ?? 'same-origin',
        signal: options.signal ?? null,
    });

    if (response.ok) {
        return response;
    }

    if (response.status === 401) {
        redirectToLogin();
        throw new ApiError(401, 'Your session has expired. Redirecting to sign in…', null);
    }

    // A rotated session cookie invalidates the cached token; one retry is enough.
    if (response.status === 403 && !isRetry) {
        await getCsrfToken(true);
        return request(path, init, options, true);
    }

    const body = await readBody(response);
    throw new ApiError(response.status, describe(response.status, body), body);
}

/** POSTs a JSON body and parses the JSON response. */
export async function apiPost<TResponse, TBody = unknown>(
    path: string,
    body?: TBody,
    options?: RequestOptions,
): Promise<TResponse> {
    const response = await request(
        path,
        { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) },
        options,
    );
    return (await readBody(response)) as TResponse;
}

/** GETs and parses the JSON response. */
export async function apiGet<TResponse>(path: string, options?: RequestOptions): Promise<TResponse> {
    const response = await request(path, { method: 'GET' }, options);
    return (await readBody(response)) as TResponse;
}

/**
 * POSTs and returns the raw {@link Response} so the caller can consume a
 * streaming body. Errors still surface as {@link ApiError}.
 */
export async function apiStream<TBody = unknown>(
    path: string,
    body: TBody,
    options?: RequestOptions,
): Promise<Response> {
    return request(path, { method: 'POST', body: JSON.stringify(body) }, options);
}
