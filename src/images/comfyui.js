import path from 'node:path';

import fetch from 'node-fetch';
import urlJoin from 'url-join';

import { delay, getBasicAuthHeader, tryParse } from '../util.js';
import { ImageGenerationError } from './errors.js';

/** Longest a single ComfyUI generation may take before we give up on it. */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/** Poll interval bounds. Backs off so a slow render does not hammer the server. */
const POLL_MIN_MS = 150;
const POLL_MAX_MS = 2000;

/**
 * Substitutes `"%key%"` placeholders in a ComfyUI workflow.
 *
 * A workflow is stored as JSON text with quoted placeholders, so each one is
 * replaced by the JSON encoding of its value — `"%steps%"` becomes `28`, not
 * `"28"`. That is what lets a single template carry both numbers and strings.
 *
 * Substitution is deliberately single-pass: a replacement value containing
 * another placeholder is left alone rather than expanded, so workflow data can
 * never inject further substitutions.
 *
 * @param {string} workflow Workflow JSON as text
 * @param {Record<string, unknown>} values Placeholder name to value
 * @returns {string} The workflow with placeholders replaced
 */
export function substituteWorkflow(workflow, values) {
    if (typeof workflow !== 'string') {
        return '';
    }

    return workflow.replace(/"%([^%"\s]+)%"/g, (match, key) => {
        if (!Object.hasOwn(values, key)) {
            // Leave unknown placeholders in place: a workflow may declare ones
            // this caller does not fill, and silently emptying them would
            // produce a subtly wrong render instead of a clear failure.
            return match;
        }
        const value = values[key];
        return JSON.stringify(value === undefined ? null : value);
    });
}

/**
 * Lists the placeholders a workflow declares.
 * @param {string} workflow Workflow JSON as text
 * @returns {string[]} Unique placeholder names, in order of appearance
 */
export function findWorkflowPlaceholders(workflow) {
    if (typeof workflow !== 'string') {
        return [];
    }
    const found = [...workflow.matchAll(/"%([^%"\s]+)%"/g)].map(match => match[1]);
    return [...new Set(found)];
}

/**
 * Extracts the first image or animation from a ComfyUI history item.
 * @param {any} item History entry for a prompt
 * @returns {{filename: string, subfolder: string, type: string}|null}
 */
export function findWorkflowOutput(item) {
    const outputs = Object.values(item?.outputs ?? {});
    const images = outputs.flatMap(output => output?.images ?? []);
    const gifs = outputs.flatMap(output => output?.gifs ?? []);
    return images[0] ?? gifs[0] ?? null;
}

/**
 * Collects node tracebacks from a failed history item.
 * @param {any} item History entry for a prompt
 * @returns {string} One line per failing node, or an empty string
 */
export function describeWorkflowFailure(item) {
    const messages = item?.status?.messages;
    if (!Array.isArray(messages)) {
        return '';
    }
    return messages
        .filter(entry => entry[0] === 'execution_error')
        .map(entry => entry[1])
        .map(error => `${error.node_type} [${error.node_id}] ${error.exception_type}: ${error.exception_message}`)
        .join('\n');
}

/**
 * Runs a workflow on a ComfyUI server and returns the rendered image.
 *
 * Polling is bounded in both directions: the interval backs off from 150ms to
 * 2s so a long render does not generate thousands of requests, and the whole
 * wait is capped so a server that restarts mid-render fails the request instead
 * of leaving it pending forever. The old implementation polled every 100ms
 * inside `while (true)` with no timeout at all.
 *
 * @param {object} options Options
 * @param {string} options.url Base URL of the ComfyUI server
 * @param {string} options.workflow Workflow JSON as text, already substituted
 * @param {string} [options.auth] Basic auth credentials, `user:password`
 * @param {AbortSignal} [options.signal] Cancels the request and interrupts the server
 * @param {number} [options.timeoutMs] Overall deadline
 * @returns {Promise<{format: string, data: string}>} Base64 image and its format
 */
export async function runComfyWorkflow({ url, workflow, auth, signal, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    if (!url) {
        throw new ImageGenerationError('No ComfyUI server URL was configured.', { provider: 'comfyui' });
    }

    const headers = { 'Authorization': getBasicAuthHeader(auth) };
    const interrupt = () => {
        fetch(new URL(urlJoin(url, '/interrupt')), { method: 'POST', headers })
            .catch(() => undefined);
    };

    const submitResult = await fetch(new URL(urlJoin(url, '/prompt')), {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: workflow,
        signal,
    });

    if (!submitResult.ok) {
        const text = await submitResult.text();
        throw new ImageGenerationError(
            `ComfyUI rejected the workflow: ${text || submitResult.statusText}`,
            { provider: 'comfyui', upstreamStatus: submitResult.status, detail: tryParse(text) },
        );
    }

    /** @type {any} */
    const submitted = await submitResult.json();
    const promptId = submitted?.prompt_id;
    if (!promptId) {
        throw new ImageGenerationError('ComfyUI accepted the workflow but returned no prompt id.', {
            provider: 'comfyui',
        });
    }

    const historyUrl = new URL(urlJoin(url, '/history', String(promptId)));
    const deadline = Date.now() + timeoutMs;
    let interval = POLL_MIN_MS;
    let item;

    while (!item) {
        if (signal?.aborted) {
            interrupt();
            throw new ImageGenerationError('The generation was cancelled.', { provider: 'comfyui' });
        }
        if (Date.now() > deadline) {
            interrupt();
            throw new ImageGenerationError(
                `ComfyUI did not finish within ${Math.round(timeoutMs / 1000)}s.`,
                { provider: 'comfyui' },
            );
        }

        const historyResult = await fetch(historyUrl, { headers, signal });
        if (!historyResult.ok) {
            throw new ImageGenerationError(
                `ComfyUI history request failed: ${historyResult.statusText}`,
                { provider: 'comfyui', upstreamStatus: historyResult.status },
            );
        }

        /** @type {any} */
        const history = await historyResult.json();
        item = history?.[promptId];
        if (item) {
            break;
        }

        await delay(interval);
        interval = Math.min(interval * 2, POLL_MAX_MS);
    }

    if (item.status?.status_str === 'error') {
        const detail = describeWorkflowFailure(item);
        throw new ImageGenerationError(
            `ComfyUI could not run the workflow.${detail ? `\n\n${detail}` : ''}`,
            { provider: 'comfyui', detail },
        );
    }

    const output = findWorkflowOutput(item);
    if (!output) {
        throw new ImageGenerationError('ComfyUI produced no image output for that workflow.', {
            provider: 'comfyui',
        });
    }

    const imageUrl = new URL(urlJoin(url, '/view'));
    imageUrl.search = new URLSearchParams({
        filename: output.filename,
        subfolder: output.subfolder ?? '',
        type: output.type ?? 'output',
    }).toString();

    const imageResult = await fetch(imageUrl, { headers, signal });
    if (!imageResult.ok) {
        throw new ImageGenerationError(
            `ComfyUI would not serve the rendered image: ${imageResult.statusText}`,
            { provider: 'comfyui', upstreamStatus: imageResult.status },
        );
    }

    const buffer = await imageResult.arrayBuffer();
    const format = path.extname(output.filename).slice(1).toLowerCase() || 'png';
    return { format, data: Buffer.from(buffer).toString('base64') };
}
