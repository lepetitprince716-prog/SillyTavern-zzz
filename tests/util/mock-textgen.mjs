/**
 * Minimal stand-ins for the text-completion backends, for the e2e tests.
 *
 * Ports:
 *   5100  an OpenAI-compatible completions server (Text Generation WebUI shape)
 *   5101  KoboldAI / KoboldCpp's native API
 *
 * Each one keeps a short history of the requests it received, readable on a
 * side channel: `GET /last-request` for the most recent, and
 * `GET /requests?contains=<text>` for the most recent whose prompt contains
 * that text. The second exists because the specs run in parallel against one
 * mock, and a single "last request" slot means two workers overwrite each
 * other's — which looks exactly like a product bug.
 *
 * Run alongside the server before `npm run test:e2e`:
 *
 *     node tests/util/mock-textgen.mjs
 */
import http from 'node:http';

const REPLY = 'She looks up from the map and nods slowly.';

function readBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
            try {
                resolve(JSON.parse(body || '{}'));
            } catch {
                resolve({});
            }
        });
    });
}

function sseReply(res, frames) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });
    let index = 0;
    const timer = setInterval(() => {
        if (index >= frames.length) {
            clearInterval(timer);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
        }
        res.write(`data: ${JSON.stringify(frames[index++])}\n\n`);
    }, 20);
}

/** Splits the reply into a handful of streaming chunks. */
function chunks() {
    return REPLY.match(/.{1,12}/g) ?? [REPLY];
}

/** How many requests each mock remembers. */
const HISTORY_LIMIT = 40;

function makeServer({ port, name, handle }) {
    /** @type {Array<{path: string, body: any}>} */
    const history = [];

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');

        if (url.pathname === '/last-request') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(history.at(-1) ?? {}));
        }

        if (url.pathname === '/requests') {
            const contains = url.searchParams.get('contains') ?? '';
            // Newest first, so a test finds its own most recent request.
            const match = [...history].reverse().find((entry) => {
                const prompt = entry.body?.prompt ?? entry.body?.input ?? '';
                return String(prompt).includes(contains);
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(match ?? {}));
        }

        const body = req.method === 'POST' ? await readBody(req) : {};
        if (req.method === 'POST') {
            history.push({ path: url.pathname, body });
            if (history.length > HISTORY_LIMIT) {
                history.shift();
            }
            console.log(`[${name}] ${url.pathname} ${Object.keys(body).sort().join(',')}`);
        }
        handle({ url, req, res, body });
    });
    server.listen(port, '127.0.0.1', () => console.log(`[${name}] listening on ${port}`));
    return server;
}

// --- An OpenAI-compatible completions server -------------------------------
makeServer({
    port: 5100,
    name: 'mock-ooba',
    handle: ({ url, res, body }) => {
        if (url.pathname === '/v1/models') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ data: [{ id: 'mock-13b' }, { id: 'mock-7b' }] }));
        }
        if (url.pathname === '/v1/internal/model/info') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ model_name: 'mock-13b' }));
        }
        if (url.pathname === '/v1/completions') {
            if (body.stream) {
                return sseReply(res, chunks().map((text) => ({ choices: [{ text }] })));
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ choices: [{ text: REPLY }] }));
        }
        res.writeHead(404);
        res.end('not found');
    },
});

// --- KoboldAI / KoboldCpp's native API -------------------------------------
makeServer({
    port: 5101,
    name: 'mock-kobold',
    handle: ({ url, res, body }) => {
        if (url.pathname === '/v1/info/version') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ result: '1.2.5' }));
        }
        if (url.pathname === '/extra/version') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ result: 'KoboldCpp', version: '1.80' }));
        }
        if (url.pathname === '/v1/model') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ result: 'koboldcpp/mock-mistral' }));
        }
        if (url.pathname === '/v1/generate') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ results: [{ text: REPLY }] }));
        }
        if (url.pathname === '/extra/generate/stream') {
            // Kobold streams its own frame shape: { token }.
            return sseReply(res, [
                ...chunks().map((token) => ({ token })),
                { token: '', final: true },
            ]);
        }
        if (url.pathname === '/extra/abort') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true }));
        }
        res.writeHead(404);
        res.end('not found');
    },
});
