/**
 * Text completion transport.
 *
 * Four server routes, ten wire vocabularies. The classic UI copes by sending
 * every alias for every backend in one body — `rep_pen` and
 * `repetition_penalty` and `repeat_penalty`, `max_tokens` and `max_length` and
 * `n_predict` and `num_predict` — and letting the target pick out what it
 * recognises. That works, but it is also why its sampler panel cannot tell you
 * which control has any effect, and it means each request carries dozens of
 * fields the server will never read.
 *
 * This maps each canonical sampler onto the one name the chosen backend uses,
 * and sends nothing else. What a backend cannot use is not sent, and the panel
 * disables the control instead of pretending.
 */

import { apiPost, apiStream } from './client';
import {
    BACKENDS,
    isNeutral,
    SUPPORTED_SAMPLERS,
    type Sampler,
    type SamplerValues,
    type TextBackend,
} from '@/features/textcompletion/backends';

/** Per-backend field name for each sampler. */
const WIRE_NAMES: Record<TextBackend, Partial<Record<Sampler, string>>> = {
    // The OpenAI-compatible route: ooba's own parameter names.
    ooba: {
        temperature: 'temperature',
        top_p: 'top_p',
        top_k: 'top_k',
        min_p: 'min_p',
        top_a: 'top_a',
        typical_p: 'typical_p',
        tfs: 'tfs',
        repetition_penalty: 'repetition_penalty',
        repetition_penalty_range: 'repetition_penalty_range',
        frequency_penalty: 'frequency_penalty',
        presence_penalty: 'presence_penalty',
        mirostat_mode: 'mirostat_mode',
        mirostat_tau: 'mirostat_tau',
        mirostat_eta: 'mirostat_eta',
        seed: 'seed',
    },
    tabby: {
        temperature: 'temperature',
        top_p: 'top_p',
        top_k: 'top_k',
        min_p: 'min_p',
        top_a: 'top_a',
        typical_p: 'typical',
        tfs: 'tfs',
        repetition_penalty: 'repetition_penalty',
        repetition_penalty_range: 'repetition_penalty_range',
        frequency_penalty: 'frequency_penalty',
        presence_penalty: 'presence_penalty',
        mirostat_mode: 'mirostat_mode',
        mirostat_tau: 'mirostat_tau',
        mirostat_eta: 'mirostat_eta',
        seed: 'seed',
    },
    // llama.cpp uses its own spellings throughout.
    llamacpp: {
        temperature: 'temperature',
        top_p: 'top_p',
        top_k: 'top_k',
        min_p: 'min_p',
        typical_p: 'typical_p',
        tfs: 'tfs_z',
        repetition_penalty: 'repeat_penalty',
        repetition_penalty_range: 'repeat_last_n',
        frequency_penalty: 'frequency_penalty',
        presence_penalty: 'presence_penalty',
        mirostat_mode: 'mirostat',
        mirostat_tau: 'mirostat_tau',
        mirostat_eta: 'mirostat_eta',
        seed: 'seed',
    },
    // Ollama's `options` object; names from OLLAMA_KEYS in src/constants.js.
    ollama: {
        temperature: 'temperature',
        top_p: 'top_p',
        top_k: 'top_k',
        min_p: 'min_p',
        typical_p: 'typical_p',
        tfs: 'tfs_z',
        repetition_penalty: 'repeat_penalty',
        repetition_penalty_range: 'repeat_last_n',
        frequency_penalty: 'frequency_penalty',
        presence_penalty: 'presence_penalty',
        seed: 'seed',
    },
    // VLLM_KEYS: no mirostat, tfs, typical or top_a.
    vllm: {
        temperature: 'temperature',
        top_p: 'top_p',
        top_k: 'top_k',
        min_p: 'min_p',
        repetition_penalty: 'repetition_penalty',
        frequency_penalty: 'frequency_penalty',
        presence_penalty: 'presence_penalty',
        seed: 'seed',
    },
    // OPENAI_KEYS: the completions API's own parameters and nothing else.
    generic: {
        temperature: 'temperature',
        top_p: 'top_p',
        frequency_penalty: 'frequency_penalty',
        presence_penalty: 'presence_penalty',
        seed: 'seed',
    },
    // The whitelist `/api/backends/kobold/generate` builds its body from.
    kobold: {
        temperature: 'temperature',
        top_p: 'top_p',
        top_k: 'top_k',
        min_p: 'min_p',
        top_a: 'top_a',
        typical_p: 'typical',
        tfs: 'tfs',
        repetition_penalty: 'rep_pen',
        repetition_penalty_range: 'rep_pen_range',
        mirostat_mode: 'mirostat',
        mirostat_tau: 'mirostat_tau',
        mirostat_eta: 'mirostat_eta',
        seed: 'sampler_seed',
    },
    novel: {
        temperature: 'temperature',
        top_p: 'top_p',
        top_k: 'top_k',
        min_p: 'min_p',
        top_a: 'top_a',
        typical_p: 'typical_p',
        tfs: 'tail_free_sampling',
        repetition_penalty: 'repetition_penalty',
        repetition_penalty_range: 'repetition_penalty_range',
    },
    horde: {
        temperature: 'temperature',
        top_p: 'top_p',
        top_k: 'top_k',
        min_p: 'min_p',
        top_a: 'top_a',
        typical_p: 'typical',
        tfs: 'tfs',
        repetition_penalty: 'rep_pen',
        repetition_penalty_range: 'rep_pen_range',
    },
};

/** Per-backend name for the response-length and context-length limits. */
const LENGTH_NAMES: Record<TextBackend, { max: string; context?: string }> = {
    ooba: { max: 'max_tokens', context: 'truncation_length' },
    tabby: { max: 'max_tokens' },
    llamacpp: { max: 'n_predict', context: 'num_ctx' },
    ollama: { max: 'num_predict', context: 'num_ctx' },
    vllm: { max: 'max_tokens' },
    generic: { max: 'max_tokens' },
    kobold: { max: 'max_length', context: 'max_context_length' },
    novel: { max: 'max_length' },
    horde: { max: 'max_length', context: 'max_context_length' },
};

export interface TextRequest {
    backend: TextBackend;
    prompt: string;
    /** Stop strings, already assembled from the templates. */
    stop: string[];
    maxTokens: number;
    maxContext: number;
    samplers: SamplerValues;
    stream: boolean;
    /** Server URL, for the backends that need one. */
    url?: string;
    model?: string;
    /**
     * Stop strings pre-tokenised, for NovelAI — its API takes token id arrays
     * rather than strings. Ignored by every other backend.
     */
    stopTokens?: number[][];
    /** Worker and model selection, for Horde. */
    hordeModels?: string[];
}

/** A request ready to send: which route, and the body for it. */
export interface WireRequest {
    path: string;
    body: Record<string, unknown>;
}

/**
 * Collects the sampler fields a backend understands.
 *
 * A sampler at its neutral value is left out rather than sent explicitly:
 * `top_k: 0` means "no limit" to one backend and "keep zero tokens" to
 * another, and omitting it is the only reading everybody agrees on.
 */
function samplerFields(backend: TextBackend, values: SamplerValues): Record<string, number> {
    const names = WIRE_NAMES[backend];
    const supported = SUPPORTED_SAMPLERS[backend];
    const fields: Record<string, number> = {};

    for (const sampler of supported) {
        const name = names[sampler];
        const value = values[sampler];
        if (!name || !Number.isFinite(value) || isNeutral(sampler, value)) {
            continue;
        }
        fields[name] = value;
    }

    return fields;
}

/** Builds the request for the route that serves this backend. */
export function buildTextRequest(request: TextRequest): WireRequest {
    const info = BACKENDS[request.backend];
    const lengths = LENGTH_NAMES[request.backend];
    const samplers = samplerFields(request.backend, request.samplers);

    const lengthFields: Record<string, number> = { [lengths.max]: request.maxTokens };
    if (lengths.context) {
        lengthFields[lengths.context] = request.maxContext;
    }

    switch (info.transport) {
        case 'kobold':
            return {
                path: '/api/backends/kobold/generate',
                body: {
                    prompt: request.prompt,
                    api_server: request.url ?? '',
                    streaming: request.stream,
                    // Lets the route send /extra/abort when the client leaves.
                    can_abort: true,
                    gui_settings: false,
                    stop_sequence: request.stop,
                    ...lengthFields,
                    ...samplers,
                },
            };

        case 'novel':
            return {
                path: '/api/novelai/generate',
                body: {
                    // NovelAI calls the prompt `input`.
                    input: request.prompt,
                    model: request.model ?? 'llama-3-erato-v1',
                    streaming: request.stream,
                    use_string: true,
                    generate_until_sentence: true,
                    return_full_text: false,
                    use_cache: false,
                    // Strings would be rejected; the caller tokenises them.
                    ...(request.stopTokens?.length ? { stop_sequences: request.stopTokens } : {}),
                    ...lengthFields,
                    ...samplers,
                },
            };

        case 'horde':
            return {
                path: '/api/horde/generate-text',
                body: {
                    prompt: request.prompt,
                    // Horde nests the sampler settings.
                    params: {
                        n: 1,
                        ...lengthFields,
                        ...samplers,
                    },
                    ...(request.hordeModels?.length ? { models: request.hordeModels } : {}),
                    trusted_workers: false,
                },
            };

        case 'textgen':
        default:
            return {
                path: '/api/backends/text-completions/generate',
                body: {
                    prompt: request.prompt,
                    // The route multiplexes on these two, then forwards the rest.
                    api_type: info.apiType,
                    api_server: request.url ?? '',
                    ...(request.model ? { model: request.model } : {}),
                    stream: request.stream,
                    stop: request.stop,
                    ...lengthFields,
                    ...samplers,
                },
            };
    }
}

/**
 * Pulls the generated text out of a non-streaming response.
 *
 * Each backend answers in its own shape, and the route does not normalise
 * them: OpenAI-compatible servers use `choices[0].text`, llama.cpp uses
 * `content`, Kobold uses `results[0].text`, and NovelAI uses `output`.
 */
export function extractTextResult(backend: TextBackend, payload: unknown): string {
    if (!payload || typeof payload !== 'object') {
        return '';
    }
    const body = payload as Record<string, unknown>;

    if (backend === 'kobold') {
        const results = body.results;
        if (Array.isArray(results) && results[0] && typeof results[0] === 'object') {
            const text = (results[0] as Record<string, unknown>).text;
            return typeof text === 'string' ? text : '';
        }
        return '';
    }

    if (backend === 'novel') {
        return typeof body.output === 'string' ? body.output : '';
    }

    // llama.cpp's own /completion route.
    if (typeof body.content === 'string') {
        return body.content;
    }

    const choices = body.choices;
    if (Array.isArray(choices) && choices[0] && typeof choices[0] === 'object') {
        const choice = choices[0] as Record<string, unknown>;
        if (typeof choice.text === 'string') {
            return choice.text;
        }
        // Some servers answer a completions request in chat shape.
        const message = choice.message;
        if (message && typeof message === 'object') {
            const content = (message as Record<string, unknown>).content;
            return typeof content === 'string' ? content : '';
        }
    }

    return '';
}

/** One decoded streaming frame. */
export interface TextDelta {
    text: string;
    /** Reasoning tokens, which Ollama reports separately. */
    reasoning: string;
    done: boolean;
}

const EMPTY_DELTA: TextDelta = { text: '', reasoning: '', done: false };

/**
 * Decodes one streaming frame.
 *
 * The frames differ per backend even though they all arrive as SSE: Kobold
 * streams `{ token }`, NovelAI streams `{ token }` too but ends on
 * `{ final: true }`, llama.cpp streams `{ content, stop }`, and the
 * OpenAI-compatible servers stream `{ choices: [{ text }] }`. The Ollama route
 * rewraps its own format into the OpenAI shape server-side, but keeps
 * `thinking` alongside the text.
 */
export function extractTextDelta(backend: TextBackend, payload: unknown): TextDelta {
    if (!payload || typeof payload !== 'object') {
        return EMPTY_DELTA;
    }
    const body = payload as Record<string, unknown>;

    if (backend === 'kobold' || backend === 'novel') {
        const token = body.token;
        return {
            text: typeof token === 'string' ? token : '',
            reasoning: '',
            done: body.final === true,
        };
    }

    if (typeof body.content === 'string') {
        return { text: body.content, reasoning: '', done: body.stop === true };
    }

    const choices = body.choices;
    if (Array.isArray(choices) && choices[0] && typeof choices[0] === 'object') {
        const choice = choices[0] as Record<string, unknown>;
        const text = typeof choice.text === 'string' ? choice.text : '';
        const thinking = typeof choice.thinking === 'string' ? choice.thinking : '';
        return {
            text,
            reasoning: thinking,
            done: typeof choice.finish_reason === 'string' && choice.finish_reason.length > 0,
        };
    }

    return EMPTY_DELTA;
}

/**
 * Pulls an error message out of a failed generation.
 *
 * The routes are inconsistent here too: some answer `{ error: { message } }`,
 * Kobold's answers `{ error: true }` with the reason only in the server log,
 * and the text-completions route answers a bare status for some failures.
 */
export function extractTextError(payload: unknown): string {
    if (!payload || typeof payload !== 'object') {
        return '';
    }
    const error = (payload as Record<string, unknown>).error;
    if (typeof error === 'string') {
        return error;
    }
    if (error && typeof error === 'object') {
        const message = (error as Record<string, unknown>).message;
        if (typeof message === 'string' && message) {
            return message;
        }
        return 'The backend reported an error but did not say what it was.';
    }
    return '';
}

/** Non-streaming generation. */
export async function generateText(request: TextRequest, signal?: AbortSignal): Promise<string> {
    const wire = buildTextRequest({ ...request, stream: false });
    const payload = await apiPost<unknown>(wire.path, wire.body, signal ? { signal } : {});
    const error = extractTextError(payload);
    if (error) {
        throw new Error(error);
    }
    return extractTextResult(request.backend, payload);
}

/** Opens a streaming generation. Returns the raw response for the SSE reader. */
export function streamText(request: TextRequest, signal?: AbortSignal): Promise<Response> {
    const wire = buildTextRequest({ ...request, stream: true });
    return apiStream(wire.path, wire.body, signal ? { signal } : {});
}

/** Model list and reachability for a text-completion server. */
export interface BackendStatus {
    /** The loaded model, or a placeholder the server uses when it cannot say. */
    result: string;
    models: string[];
}

/**
 * Checks a backend and lists its models.
 *
 * The status routes answer inconsistently — `/api/backends/text-completions/status`
 * returns `{ result, data }` where `result` may be the literal string `Valid`
 * or `None`, and the Kobold route returns version fields instead — so this
 * normalises both into one shape and lets the caller decide what to show.
 */
export async function fetchBackendStatus(
    backend: TextBackend,
    url: string,
    signal?: AbortSignal,
): Promise<BackendStatus> {
    const info = BACKENDS[backend];

    if (info.transport === 'kobold') {
        const status = await apiPost<{ model?: string; koboldCppVersion?: string }>(
            '/api/backends/kobold/status',
            { api_server: url },
            signal ? { signal } : {},
        );
        const model = status.model ?? '';
        return {
            // The route says `no_connection` rather than failing the request.
            result: model && model !== 'no_connection' ? model : '',
            models: model && model !== 'no_connection' ? [model] : [],
        };
    }

    if (info.transport === 'horde') {
        const models = await apiPost<Array<{ name?: string }>>(
            '/api/horde/text-models',
            {},
            signal ? { signal } : {},
        );
        const names = models.map((entry) => entry.name ?? '').filter(Boolean);
        return { result: names[0] ?? '', models: names };
    }

    if (info.transport === 'novel') {
        // NovelAI has a fixed model list and no status route worth calling;
        // `/api/novelai/status` only reports the subscription.
        return { result: '', models: NOVEL_MODELS.map((model) => model.id) };
    }

    const status = await apiPost<{ result?: string; data?: Array<{ id?: string }> }>(
        '/api/backends/text-completions/status',
        { api_server: url, api_type: info.apiType },
        signal ? { signal } : {},
    );
    const models = (status.data ?? []).map((entry) => entry.id ?? '').filter(Boolean);
    // `Valid` and `None` are the route's placeholders for "reachable but the
    // model is unknown"; showing them as a model name would be a lie.
    const result = status.result && !['Valid', 'None'].includes(status.result) ? status.result : '';
    return { result, models };
}

/** NovelAI's text models, with the tokenizer each one needs. */
export const NOVEL_MODELS = [
    { id: 'llama-3-erato-v1', label: 'Erato', tokenizer: 'llama3' },
    { id: 'kayra-v1', label: 'Kayra', tokenizer: 'nerdstash_v2' },
    { id: 'clio-v1', label: 'Clio', tokenizer: 'nerdstash' },
] as const;

/** The tokenizer a NovelAI model uses, for stop-sequence encoding. */
export function novelTokenizer(model: string): string {
    return NOVEL_MODELS.find((entry) => entry.id === model)?.tokenizer ?? 'llama3';
}

/**
 * Encodes stop strings into token ids.
 *
 * NovelAI's API takes `stop_sequences` as token id arrays, so a stop string
 * sent as text is silently ignored — which is why a NovelAI generation can
 * otherwise run on past the point it should have stopped.
 */
export async function encodeStopSequences(
    tokenizer: string,
    strings: string[],
    signal?: AbortSignal,
): Promise<number[][]> {
    const encoded = await Promise.all(strings.map(async (text) => {
        try {
            const { ids } = await apiPost<{ ids?: number[] }>(
                `/api/tokenizers/${tokenizer}/encode`,
                { text },
                signal ? { signal } : {},
            );
            return Array.isArray(ids) ? ids : [];
        } catch {
            // A stop string that cannot be encoded is dropped, not fatal.
            return [];
        }
    }));
    return encoded.filter((ids) => ids.length > 0);
}

/** A queued Horde job. */
export interface HordeTask {
    id: string;
}

export interface HordeTaskStatus {
    done: boolean;
    faulted: boolean;
    queue_position?: number;
    wait_time?: number;
    generations?: Array<{ text?: string; model?: string; worker_name?: string }>;
    message?: string;
}

export async function queueHordeTask(request: TextRequest, signal?: AbortSignal): Promise<HordeTask> {
    const wire = buildTextRequest({ ...request, stream: false });
    const payload = await apiPost<{ id?: string; message?: string }>(
        wire.path,
        wire.body,
        signal ? { signal } : {},
    );
    const error = extractTextError(payload);
    if (error) {
        throw new Error(error);
    }
    if (!payload.id) {
        throw new Error(payload.message || 'The Horde did not accept the request.');
    }
    return { id: payload.id };
}

export function fetchHordeTask(taskId: string, signal?: AbortSignal): Promise<HordeTaskStatus> {
    return apiPost<HordeTaskStatus>('/api/horde/task-status', { taskId }, signal ? { signal } : {});
}

export function cancelHordeTask(taskId: string): Promise<unknown> {
    return apiPost<unknown>('/api/horde/cancel-task', { taskId });
}
