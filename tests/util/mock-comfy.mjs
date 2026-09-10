/**
 * Minimal ComfyUI stand-in for the image generation e2e tests.
 *
 * Answers /system_stats, /prompt, /history, /history/{prompt_id}, /view and
 * /interrupt, and encodes a real PNG at whatever size the submitted workflow
 * asks for. Real bytes matter: the tests check that the reserved box matches
 * the image's own aspect ratio, which a fixed-size placeholder image would
 * not exercise.
 *
 * Run it alongside the server before `npm run test:e2e`:
 *
 *     node tests/util/mock-comfy.mjs
 */
import http from 'node:http';
import zlib from 'node:zlib';

const jobs = new Map();
let counter = 0;

/** Builds an uncompressed-ish PNG of the given size, one flat colour. */
function png(width, height, [r, g, b]) {
    const chunks = [];
    const crcTable = [];
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
    }
    const crc32 = (buf) => {
        let c = 0xffffffff;
        for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type, data) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(body));
        return Buffer.concat([len, body, crc]);
    };

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 2;  // truecolour
    const raw = Buffer.alloc(height * (1 + width * 3));
    for (let y = 0; y < height; y++) {
        const row = y * (1 + width * 3);
        raw[row] = 0;
        for (let x = 0; x < width; x++) {
            const p = row + 1 + x * 3;
            // A gradient makes it obvious which way is up in the browser.
            raw[p] = (r + Math.floor((x / width) * 60)) & 0xff;
            raw[p + 1] = (g + Math.floor((y / height) * 60)) & 0xff;
            raw[p + 2] = b;
        }
    }
    chunks.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    chunks.push(chunk('IHDR', ihdr));
    chunks.push(chunk('IDAT', zlib.deflateSync(raw)));
    chunks.push(chunk('IEND', Buffer.alloc(0)));
    return Buffer.concat(chunks);
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/system_stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ system: { comfyui_version: 'mock' } }));
    }

    if (url.pathname === '/prompt' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        return req.on('end', () => {
            const id = `job-${++counter}`;
            let width = 512;
            let height = 512;
            try {
                const workflow = JSON.parse(body);
                for (const node of Object.values(workflow)) {
                    if (node?.inputs?.width && node?.inputs?.height) {
                        width = Number(node.inputs.width);
                        height = Number(node.inputs.height);
                        break;
                    }
                }
            } catch { /* fall back to the default size */ }
            jobs.set(id, { readyAt: Date.now() + 1200, width, height });
            console.log(`[mock-comfy] queued ${id} at ${width}x${height}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ prompt_id: id }));
        });
    }

    // Real ComfyUI serves both /history and /history/{prompt_id}.
    if (url.pathname === '/history' || url.pathname.startsWith('/history/')) {
        const wanted = url.pathname.startsWith('/history/')
            ? decodeURIComponent(url.pathname.slice('/history/'.length))
            : null;
        const history = {};
        for (const [id, job] of jobs) {
            if (wanted && id !== wanted) continue;
            if (Date.now() >= job.readyAt) {
                history[id] = {
                    status: { status_str: 'success' },
                    outputs: { 9: { images: [{ filename: `${id}.png`, subfolder: '', type: 'output' }] } },
                };
            }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(history));
    }

    if (url.pathname === '/view') {
        const id = (url.searchParams.get('filename') ?? '').replace(/\.png$/, '');
        const job = jobs.get(id) ?? { width: 512, height: 512 };
        const image = png(job.width, job.height, [90, 60, 160]);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': image.length });
        return res.end(image);
    }

    if (url.pathname === '/interrupt') {
        console.log('[mock-comfy] interrupted');
        res.writeHead(200);
        return res.end('{}');
    }

    res.writeHead(404);
    res.end('not found');
});

server.listen(8188, '127.0.0.1', () => console.log('[mock-comfy] listening on 8188'));
