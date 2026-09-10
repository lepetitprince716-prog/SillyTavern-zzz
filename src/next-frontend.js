import fs from 'node:fs';
import path from 'node:path';

import express from 'express';

import { serverDirectory } from './server-directory.js';
import { shouldRedirectToLogin } from './users.js';
import { color } from './util.js';

/** URL prefix the modern frontend is served from. */
export const NEXT_MOUNT_PATH = '/next';

/** Where `npm run next:build` writes its output. */
const NEXT_DIST_DIRECTORY = path.join(serverDirectory, 'public-next', 'dist');
const NEXT_INDEX_FILE = path.join(NEXT_DIST_DIRECTORY, 'index.html');

/**
 * Whether the modern frontend has been built and can be served.
 * @returns {boolean}
 */
export function isNextFrontendBuilt() {
    return fs.existsSync(NEXT_INDEX_FILE);
}

/**
 * Mounts the modern frontend at {@link NEXT_MOUNT_PATH}.
 *
 * The classic UI at `/` is untouched: this only adds a second, self-contained
 * bundle served from its own prefix. When the bundle has not been built, the
 * route answers with build instructions instead of a 404, because a missing
 * `dist` is a setup step rather than an error.
 *
 * @param {import('express').Express} app The Express app.
 * @returns {void}
 */
export function setupNextFrontend(app) {
    if (!isNextFrontendBuilt()) {
        app.use(NEXT_MOUNT_PATH, (request, response, next) => {
            if (request.method !== 'GET') {
                return next();
            }
            return response.status(503).type('text/plain').send(
                'The modern frontend has not been built yet.\n\n' +
                'Build it once with:\n' +
                '    npm run next:install\n' +
                '    npm run next:build\n\n' +
                'Then reload this page. The classic interface at / is unaffected.\n',
            );
        });
        return;
    }

    // Hashed asset file names make these safe to cache for a long time; the
    // entry HTML must not be cached or clients would pin an old bundle.
    app.use(
        NEXT_MOUNT_PATH,
        express.static(NEXT_DIST_DIRECTORY, {
            index: false,
            maxAge: '30d',
            immutable: true,
            setHeaders: (response, filePath) => {
                if (filePath === NEXT_INDEX_FILE) {
                    response.setHeader('Cache-Control', 'no-cache');
                }
            },
        }),
    );

    // Client-side routing: every unmatched path under the prefix gets the shell.
    app.use(NEXT_MOUNT_PATH, (request, response, next) => {
        if (request.method !== 'GET') {
            return next();
        }
        if (shouldRedirectToLogin(request)) {
            return response.redirect(`/login?from=${encodeURIComponent(request.originalUrl)}`);
        }
        response.setHeader('Cache-Control', 'no-cache');
        return response.sendFile(NEXT_INDEX_FILE);
    });

    console.log(`Modern frontend (preview) available at ${color.blue(NEXT_MOUNT_PATH)}`);
}
