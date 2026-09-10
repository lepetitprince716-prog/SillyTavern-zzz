import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

/**
 * The SillyTavern server that the dev server proxies to. The legacy UI stays on
 * `/`; this app is mounted under `/next/` so both can be served side by side.
 */
const BACKEND = process.env.ST_BACKEND ?? 'http://127.0.0.1:8000';

/** Backend paths that must be forwarded verbatim during development. */
const PROXIED_PATHS = [
    '/api',
    '/csrf-token',
    '/version',
    '/thumbnail',
    '/characters',
    '/backgrounds',
    '/User Avatars',
    '/user',
    '/login',
    '/favicon.ico',
];

export default defineConfig({
    base: '/next/',
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    server: {
        port: 5173,
        proxy: Object.fromEntries(
            PROXIED_PATHS.map((path) => [path, { target: BACKEND, changeOrigin: false }]),
        ),
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        target: 'es2023',
        sourcemap: true,
        rollupOptions: {
            output: {
                // Keep the vendor runtime in long-lived chunks so app updates do
                // not invalidate it. Vite 8 bundles with Rolldown, whose chunk
                // grouping API is `codeSplitting` rather than `manualChunks`.
                codeSplitting: {
                    groups: [
                        { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/ },
                        { name: 'markdown', test: /[\\/]node_modules[\\/](marked|dompurify)[\\/]/ },
                    ],
                },
            },
        },
    },
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
});
