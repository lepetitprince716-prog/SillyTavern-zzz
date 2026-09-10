/**
 * Image generation and image storage.
 *
 * Generation goes through `/api/image-generation`, which speaks one request
 * and one response shape for every provider and reports the seed it used.
 * Storage goes through the pre-existing `/api/images/upload`, which is what
 * the classic UI writes to as well — so a render made here shows up in the
 * classic gallery and in a chat opened in the classic UI.
 */

import { ApiError, apiPost } from './client';
import type { MediaAttachment } from './types';

/** Providers this frontend drives. */
export const IMAGE_PROVIDERS = ['novelai', 'comfyui'] as const;

export type ImageProvider = (typeof IMAGE_PROVIDERS)[number];

export interface ProviderStatus {
    id: ImageProvider;
    label: string;
    /** Whether the server side of this provider is ready to be called. */
    configured: boolean;
    /** What the provider still needs: a token, or a server URL. */
    requires: 'token' | 'url';
}

/** Parameters shared by both providers. */
export interface ImageRequest {
    provider: ImageProvider;
    prompt: string;
    negativePrompt: string;
    width: number;
    height: number;
    steps: number;
    cfgScale: number;
    /** `-1` asks the provider to roll one; the response reports what it used. */
    seed: number;
    sampler?: string;
    scheduler?: string;
    model?: string;
    novelai?: {
        sm: boolean;
        smDyn: boolean;
        decrisper: boolean;
        varietyBoost: boolean;
        upscaleRatio: number;
    };
    comfyui?: {
        url: string;
        auth?: string;
        workflow: string;
        denoise?: number;
        clipSkip?: number;
    };
}

/** What `/generate` answers with. */
export interface ImageResult {
    image: { format: string; data: string };
    meta: {
        provider: ImageProvider;
        prompt: string;
        negativePrompt: string;
        width: number;
        height: number;
        steps: number;
        cfgScale: number;
        /** The seed actually used, never `-1`. */
        seed: number;
        sampler?: string;
        scheduler?: string;
        model?: string;
        workflow?: string;
        upscaled?: boolean;
        durationMs: number;
    };
}

/** Error body shape from the image routes. */
interface ImageErrorBody {
    error?: { message?: string; provider?: string; upstreamStatus?: number };
}

/**
 * Turns a failed image request into a message worth showing.
 *
 * The routes answer `{ error: { message } }` carrying the provider's own
 * words, which is far more useful than "request failed" — a NovelAI refusal
 * says whether the account is out of credits, and a ComfyUI failure carries
 * the node traceback.
 */
export function imageErrorMessage(error: unknown): string {
    if (error instanceof ApiError) {
        const body = error.body as ImageErrorBody | undefined;
        const message = body?.error?.message;
        if (typeof message === 'string' && message.trim()) {
            return message.trim();
        }
        if (error.status === 499) {
            return 'The generation was cancelled.';
        }
        return `The image server answered ${error.status}.`;
    }
    if (error instanceof Error && error.name === 'AbortError') {
        return 'The generation was cancelled.';
    }
    return error instanceof Error ? error.message : 'The image could not be generated.';
}

export function fetchImageProviders(): Promise<ProviderStatus[]> {
    return apiPost<ProviderStatus[]>('/api/image-generation/providers', {});
}

export function fetchComfyWorkflows(): Promise<string[]> {
    return apiPost<string[]>('/api/image-generation/comfyui/workflows', {});
}

/**
 * Reports which placeholders a workflow actually substitutes.
 *
 * Used to grey out controls a workflow ignores, rather than presenting a full
 * panel where half the settings quietly do nothing.
 */
export function fetchComfyPlaceholders(workflow: string): Promise<string[]> {
    return apiPost<string[]>('/api/image-generation/comfyui/placeholders', { workflow });
}

export function pingComfy(url: string, auth?: string): Promise<{ ok: boolean }> {
    return apiPost<{ ok: boolean }>('/api/image-generation/comfyui/ping', { url, auth });
}

export function generateImage(request: ImageRequest, signal?: AbortSignal): Promise<ImageResult> {
    return apiPost<ImageResult, ImageRequest>('/api/image-generation/generate', request, { signal });
}

/**
 * Writes a generated image into the user's image directory.
 *
 * Generated images are stored as files rather than kept as data URIs in the
 * chat file: a base64 PNG inflates the `.jsonl` by megabytes per render, has
 * to be re-parsed on every chat load, and cannot be cached by the browser.
 *
 * @returns The server-relative path to use as the attachment `url`.
 */
export async function saveGeneratedImage(options: {
    data: string;
    format: string;
    characterName?: string;
    fileName?: string;
}): Promise<string> {
    const { path } = await apiPost<{ path: string }>('/api/images/upload', {
        image: options.data,
        format: options.format,
        ch_name: options.characterName,
        filename: options.fileName,
    });
    return path;
}

/** Builds the attachment record for a finished render. */
export function attachmentFromResult(result: ImageResult, url: string): MediaAttachment {
    const { meta } = result;
    return {
        url,
        type: 'image',
        source: 'generated',
        title: meta.prompt,
        width: meta.width,
        height: meta.height,
        negative: meta.negativePrompt || undefined,
        seed: meta.seed,
        provider: meta.provider,
        model: meta.model || undefined,
        steps: meta.steps,
        cfgScale: meta.cfgScale,
        sampler: meta.sampler || undefined,
        scheduler: meta.scheduler || undefined,
        workflow: meta.workflow || undefined,
        durationMs: meta.durationMs,
    };
}
