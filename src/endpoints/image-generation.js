import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import fetch from 'node-fetch';
import sanitize from 'sanitize-filename';
import urlJoin from 'url-join';

import {
    findWorkflowPlaceholders,
    runComfyWorkflow,
    substituteWorkflow,
} from '../images/comfyui.js';
import { ImageGenerationError } from '../images/errors.js';
import { generateNovelAiImage, resolveSeed } from '../images/novelai.js';
import { getBasicAuthHeader } from '../util.js';
import { SECRET_KEYS, readSecret } from './secrets.js';

/**
 * Normalised image generation.
 *
 * The existing `/api/sd/*` routes grew one sub-router per provider, each with
 * its own request shape, its own response shape and its own idea of what an
 * error is: ComfyUI answers `{ format, data }` while NovelAI answers a bare
 * base64 string, and NovelAI's failures collapse to a status 500 that throws
 * away the reason. Neither reports the seed it actually used, so a render a
 * user liked cannot be reproduced.
 *
 * This router is the counterpart for the two providers the modern frontend
 * supports. One request shape, one response shape, upstream errors carried
 * through, and the resolved seed and settings returned alongside the image.
 * The old routes are untouched.
 */
export const router = express.Router();

/** Providers this router speaks. */
const PROVIDERS = /** @type {const} */ (['novelai', 'comfyui']);

/** Cap on requested dimensions, to keep a typo from asking for a 16k render. */
const MAX_DIMENSION = 4096;
const MAX_STEPS = 150;

/**
 * Reads and clamps a number from the request.
 * @param {unknown} value Raw value
 * @param {number} fallback Used when the value is unusable
 * @param {number} min Lower bound
 * @param {number} max Upper bound
 * @returns {number}
 */
function clampNumber(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, Math.round(parsed)));
}

/**
 * Normalises the shared generation parameters.
 * @param {any} body Request body
 * @returns {import('../images/novelai.js').ImageParams}
 */
function readParams(body) {
    return {
        prompt: String(body?.prompt ?? '').trim(),
        negativePrompt: String(body?.negativePrompt ?? ''),
        width: clampNumber(body?.width, 512, 64, MAX_DIMENSION),
        height: clampNumber(body?.height, 512, 64, MAX_DIMENSION),
        steps: clampNumber(body?.steps, 28, 1, MAX_STEPS),
        cfgScale: Number.isFinite(Number(body?.cfgScale)) ? Number(body.cfgScale) : 5,
        seed: Number.isFinite(Number(body?.seed)) ? Number(body.seed) : -1,
        sampler: body?.sampler ? String(body.sampler) : undefined,
        scheduler: body?.scheduler ? String(body.scheduler) : undefined,
        model: body?.model ? String(body.model) : undefined,
    };
}

/**
 * Sends an {@link ImageGenerationError} to the client with its reason intact.
 * @param {import('express').Response} response Express response
 * @param {unknown} error The thrown error
 * @param {string} provider Provider id
 */
function sendError(response, error, provider) {
    if (error instanceof ImageGenerationError) {
        console.warn(`Image generation failed (${error.provider ?? provider}):`, error.message);
        // 502 when the provider itself refused, 400 when the request could not
        // be built at all. Either way the message travels.
        const status = error.upstreamStatus ? 502 : 400;
        return response.status(status).send({
            error: {
                message: error.message,
                provider: error.provider ?? provider,
                upstreamStatus: error.upstreamStatus,
            },
        });
    }

    if (error instanceof Error && error.name === 'AbortError') {
        return response.status(499).send({
            error: { message: 'The generation was cancelled.', provider },
        });
    }

    console.error('Image generation failed unexpectedly:', error);
    return response.status(500).send({
        error: {
            message: error instanceof Error ? error.message : 'An unexpected error occurred.',
            provider,
        },
    });
}

/**
 * Loads a ComfyUI workflow by file name.
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @param {string} fileName Workflow file name
 * @returns {string} The workflow JSON as text
 */
function readWorkflow(directories, fileName) {
    const requested = path.join(directories.comfyWorkflows, sanitize(String(fileName ?? '')));
    const fallback = path.join(directories.comfyWorkflows, 'Default_Comfy_Workflow.json');
    const filePath = fileName && fs.existsSync(requested) ? requested : fallback;

    if (!fs.existsSync(filePath)) {
        throw new ImageGenerationError(
            `No ComfyUI workflow named "${fileName}" was found, and there is no default workflow.`,
            { provider: 'comfyui' },
        );
    }

    return fs.readFileSync(filePath, { encoding: 'utf-8' });
}

router.post('/providers', (request, response) => {
    const novelaiKey = readSecret(request.user.directories, SECRET_KEYS.NOVEL);
    return response.send([
        {
            id: 'novelai',
            label: 'NovelAI',
            configured: Boolean(novelaiKey),
            // NovelAI needs a token; ComfyUI needs a reachable server instead.
            requires: 'token',
        },
        {
            id: 'comfyui',
            label: 'ComfyUI',
            configured: true,
            requires: 'url',
        },
    ]);
});

router.post('/comfyui/ping', async (request, response) => {
    const url = String(request.body?.url ?? '');
    if (!url) {
        return response.status(400).send({ error: { message: 'No ComfyUI URL was provided.' } });
    }
    try {
        const result = await fetch(new URL(urlJoin(url, '/system_stats')), {
            headers: { 'Authorization': getBasicAuthHeader(request.body?.auth) },
        });
        if (!result.ok) {
            throw new ImageGenerationError(
                `ComfyUI answered ${result.status} ${result.statusText}.`,
                { provider: 'comfyui', upstreamStatus: result.status },
            );
        }
        return response.send({ ok: true });
    } catch (error) {
        return sendError(response, error, 'comfyui');
    }
});

router.post('/comfyui/workflows', (request, response) => {
    try {
        const directory = request.user.directories.comfyWorkflows;
        const files = fs
            .readdirSync(directory, { withFileTypes: true })
            .filter(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === '.json')
            .map(entry => entry.name)
            .sort((a, b) => a.localeCompare(b));
        return response.send(files);
    } catch (error) {
        return sendError(response, error, 'comfyui');
    }
});

/**
 * Reports the placeholders a workflow expects.
 *
 * The modern frontend uses this to show which of its settings a given workflow
 * actually consumes, instead of presenting every control and silently ignoring
 * most of them.
 */
router.post('/comfyui/placeholders', (request, response) => {
    try {
        const workflow = readWorkflow(request.user.directories, request.body?.workflow);
        return response.send(findWorkflowPlaceholders(workflow));
    } catch (error) {
        return sendError(response, error, 'comfyui');
    }
});

router.post('/generate', async (request, response) => {
    const provider = String(request.body?.provider ?? '');
    if (!PROVIDERS.includes(/** @type {any} */ (provider))) {
        return response.status(400).send({
            error: { message: `Unknown image provider "${provider}".`, provider },
        });
    }

    const params = readParams(request.body);
    if (!params.prompt) {
        return response.status(400).send({
            error: { message: 'An image needs a prompt.', provider },
        });
    }

    const controller = new AbortController();
    request.socket.removeAllListeners('close');
    request.socket.on('close', () => {
        if (!response.writableEnded) {
            controller.abort();
        }
    });

    const startedAt = Date.now();

    try {
        if (provider === 'novelai') {
            const options = request.body?.novelai ?? {};
            const result = await generateNovelAiImage(
                request.user.directories,
                {
                    ...params,
                    sm: Boolean(options.sm),
                    smDyn: Boolean(options.smDyn),
                    decrisper: Boolean(options.decrisper),
                    varietyBoost: Boolean(options.varietyBoost),
                    upscaleRatio: Number(options.upscaleRatio),
                },
                { signal: controller.signal },
            );

            return response.send({
                image: { format: result.format, data: result.data },
                meta: {
                    ...params,
                    provider,
                    seed: result.seed,
                    upscaled: result.upscaled,
                    durationMs: Date.now() - startedAt,
                },
            });
        }

        const options = request.body?.comfyui ?? {};
        const seed = resolveSeed(params.seed);
        const workflow = readWorkflow(request.user.directories, options.workflow);

        /** @type {Record<string, unknown>} */
        const values = {
            prompt: params.prompt,
            negative_prompt: params.negativePrompt,
            seed: seed,
            width: params.width,
            height: params.height,
            steps: params.steps,
            scale: params.cfgScale,
            sampler: params.sampler ?? '',
            scheduler: params.scheduler ?? '',
            model: params.model ?? '',
            denoise: Number.isFinite(Number(options.denoise)) ? Number(options.denoise) : 1,
            clip_skip: Number.isFinite(Number(options.clipSkip)) ? -Math.abs(Number(options.clipSkip)) : -1,
        };

        // Workflow-specific extras, so a custom template can be driven without
        // this endpoint knowing what it needs.
        for (const entry of Array.isArray(options.placeholders) ? options.placeholders : []) {
            if (entry && typeof entry.find === 'string' && entry.find) {
                values[entry.find] = entry.replace;
            }
        }

        const result = await runComfyWorkflow({
            url: String(options.url ?? ''),
            workflow: substituteWorkflow(workflow, values),
            auth: options.auth,
            signal: controller.signal,
            ...(Number.isFinite(Number(options.timeoutMs)) ? { timeoutMs: Number(options.timeoutMs) } : {}),
        });

        return response.send({
            image: { format: result.format, data: result.data },
            meta: {
                ...params,
                provider,
                seed,
                workflow: options.workflow,
                durationMs: Date.now() - startedAt,
            },
        });
    } catch (error) {
        return sendError(response, error, provider);
    }
});
