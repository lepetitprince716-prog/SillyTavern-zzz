import fetch from 'node-fetch';

import { SECRET_KEYS, readSecret } from '../endpoints/secrets.js';
import { extractFileFromZipBuffer } from '../util.js';
import { ImageGenerationError } from './errors.js';

const API_NOVELAI = 'https://api.novelai.net';
const IMAGE_NOVELAI = 'https://image.novelai.net';

// Constants for the skip_cfg_above_sigma (Variety+) calculation.
const REFERENCE_PIXEL_COUNT = 1011712; // 832 * 1216 reference image size
const SIGMA_MAGIC_NUMBER = 19; // Base sigma multiplier for V3 and V4 models
const SIGMA_MAGIC_NUMBER_V4_5 = 58; // Base sigma multiplier for V4.5 models

/** Largest seed NovelAI accepts. */
const MAX_SEED = 9_999_999_999;

/**
 * Scales the Variety+ sigma cutoff to the requested image size.
 * @param {number} width Image width
 * @param {number} height Image height
 * @param {string} modelName Model name
 * @returns {number} The sigma above which CFG is skipped
 */
export function calculateSkipCfgAboveSigma(width, height, modelName) {
    const magicConstant = modelName?.includes('nai-diffusion-4-5')
        ? SIGMA_MAGIC_NUMBER_V4_5
        : SIGMA_MAGIC_NUMBER;

    const pixelCount = width * height;
    const ratio = pixelCount / REFERENCE_PIXEL_COUNT;

    return Math.pow(ratio, 0.5) * magicConstant;
}

/**
 * Resolves a seed, replacing "random" with an actual number.
 *
 * The point of doing this here rather than inside the request body is that the
 * caller gets the number back: a user who likes a render can reproduce it. The
 * previous implementation rolled the seed inline and never reported it.
 *
 * @param {unknown} requested Requested seed; negative or absent means random
 * @param {() => number} [random] Injectable for tests
 * @returns {number} A concrete seed
 */
export function resolveSeed(requested, random = Math.random) {
    const seed = Number(requested);
    if (Number.isFinite(seed) && seed >= 0) {
        return Math.floor(seed);
    }
    return Math.floor(random() * MAX_SEED);
}

/**
 * Normalised generation parameters, shared by every provider.
 * @typedef {object} ImageParams
 * @property {string} prompt
 * @property {string} [negativePrompt]
 * @property {number} [width]
 * @property {number} [height]
 * @property {number} [steps]
 * @property {number} [cfgScale]
 * @property {number} [seed] Negative or absent for random
 * @property {string} [sampler]
 * @property {string} [scheduler]
 * @property {string} [model]
 */

/**
 * Builds the NovelAI request body.
 *
 * Split out from the request handler so the mapping from normalised parameters
 * to NovelAI's deeply nested payload can be tested without a network call or an
 * API key.
 *
 * @param {ImageParams & {sm?: boolean, smDyn?: boolean, decrisper?: boolean, varietyBoost?: boolean}} params
 * @param {number} seed Already-resolved seed
 * @returns {object} The request body
 */
export function buildNovelAiBody(params, seed) {
    const width = params.width ?? 512;
    const height = params.height ?? 512;
    const model = params.model ?? 'nai-diffusion';
    const prompt = params.prompt ?? '';
    const negativePrompt = params.negativePrompt ?? '';

    return {
        action: 'generate',
        input: prompt,
        model: model,
        parameters: {
            params_version: 3,
            prefer_brownian: true,
            negative_prompt: negativePrompt,
            height: height,
            width: width,
            scale: params.cfgScale ?? 9,
            seed: seed,
            sampler: params.sampler ?? 'k_dpmpp_2m',
            noise_schedule: params.scheduler ?? 'karras',
            steps: params.steps ?? 28,
            n_samples: 1,
            // NAI handholding for prompts
            ucPreset: 0,
            qualityToggle: false,
            add_original_image: false,
            controlnet_strength: 1,
            deliberate_euler_ancestral_bug: false,
            dynamic_thresholding: params.decrisper ?? false,
            legacy: false,
            legacy_v3_extend: false,
            sm: params.sm ?? false,
            sm_dyn: params.smDyn ?? false,
            uncond_scale: 1,
            skip_cfg_above_sigma: params.varietyBoost
                ? calculateSkipCfgAboveSigma(width, height, model)
                : null,
            use_coords: false,
            characterPrompts: [],
            reference_image_multiple: [],
            reference_information_extracted_multiple: [],
            reference_strength_multiple: [],
            v4_negative_prompt: {
                caption: {
                    base_caption: negativePrompt,
                    char_captions: [],
                },
            },
            v4_prompt: {
                caption: {
                    base_caption: prompt,
                    char_captions: [],
                },
                use_coords: false,
                use_order: true,
            },
        },
    };
}

/**
 * Generates an image with NovelAI.
 *
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @param {ImageParams & {sm?: boolean, smDyn?: boolean, decrisper?: boolean, varietyBoost?: boolean, upscaleRatio?: number}} params
 * @param {object} [options] Options
 * @param {AbortSignal} [options.signal] Cancels the request
 * @param {() => number} [options.random] Injectable seed source, for tests
 * @returns {Promise<{format: string, data: string, seed: number, upscaled: boolean}>}
 * @throws {ImageGenerationError} With the upstream reason attached
 */
export async function generateNovelAiImage(directories, params, { signal, random } = {}) {
    const key = readSecret(directories, SECRET_KEYS.NOVEL);
    if (!key) {
        throw new ImageGenerationError('No NovelAI access token is configured.', {
            provider: 'novelai',
        });
    }

    const seed = resolveSeed(params.seed, random);
    const headers = {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
    };

    const generateResult = await fetch(`${IMAGE_NOVELAI}/ai/generate-image`, {
        method: 'POST',
        headers,
        body: JSON.stringify(buildNovelAiBody(params, seed)),
        signal,
    });

    if (!generateResult.ok) {
        const text = await generateResult.text();
        // The upstream text is the only place a quota or content-policy reason
        // appears, so it is carried rather than collapsed into a bare 500.
        throw new ImageGenerationError(
            `NovelAI refused the request: ${text || generateResult.statusText}`,
            { provider: 'novelai', upstreamStatus: generateResult.status, detail: text },
        );
    }

    const archiveBuffer = await generateResult.arrayBuffer();
    const imageBuffer = await extractFileFromZipBuffer(archiveBuffer, '.png');

    if (!imageBuffer) {
        throw new ImageGenerationError(
            'NovelAI generated an image, but no PNG was found in the archive it returned.',
            { provider: 'novelai' },
        );
    }

    const originalBase64 = imageBuffer.toString('base64');
    const upscaleRatio = Number(params.upscaleRatio);

    if (!Number.isFinite(upscaleRatio) || upscaleRatio <= 1) {
        return { format: 'png', data: originalBase64, seed, upscaled: false };
    }

    try {
        // Upscaling deliberately targets api.novelai.net while generation uses
        // image.novelai.net, matching the long-standing behaviour here.
        const upscaleResult = await fetch(`${API_NOVELAI}/ai/upscale`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                image: originalBase64,
                height: params.height,
                width: params.width,
                scale: upscaleRatio,
            }),
            signal,
        });

        if (!upscaleResult.ok) {
            throw new Error(await upscaleResult.text());
        }

        const upscaledArchive = await upscaleResult.arrayBuffer();
        const upscaledBuffer = await extractFileFromZipBuffer(upscaledArchive, '.png');
        if (!upscaledBuffer) {
            throw new Error('The upscaled PNG was not found in the archive.');
        }

        return { format: 'png', data: upscaledBuffer.toString('base64'), seed, upscaled: true };
    } catch (error) {
        // A failed upscale is not a failed generation: return what we have.
        console.warn('NovelAI generated an image, but upscaling failed. Returning the original.', error);
        return { format: 'png', data: originalBase64, seed, upscaled: false };
    }
}
