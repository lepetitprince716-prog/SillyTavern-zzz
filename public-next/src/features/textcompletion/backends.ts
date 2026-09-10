/**
 * Text completion backends and what each one actually accepts.
 *
 * The classic UI presents one sampler panel for every backend and lets the
 * server drop what the target cannot use. That is why it shows a `mirostat`
 * slider against llama.cpp, which has no such parameter, and a `tfs` slider
 * against a vLLM server that ignores it: the control moves, the request goes
 * out, and nothing changes. Worse, `/api/backends/text-completions/generate`
 * forwards the whole request body verbatim for half the backends, so the
 * server receives fields like `api_server` and `api_type` it never asked for.
 *
 * The capability lists here come from `src/constants.js` — the `*_KEYS` arrays
 * the server filters with — and from each project's own documented parameter
 * set for the backends the server does not filter. A control the chosen
 * backend cannot use is disabled and says why, and the request carries only
 * the fields that backend understands.
 */

/** Backends this frontend drives. */
export const TEXT_BACKENDS = [
    'ooba',
    'kobold',
    'llamacpp',
    'ollama',
    'tabby',
    'vllm',
    'generic',
    'novel',
    'horde',
] as const;

export type TextBackend = (typeof TEXT_BACKENDS)[number];

/**
 * Which server route a backend talks to.
 *
 * `textgen` is `/api/backends/text-completions`, which multiplexes by
 * `api_type`; the other three have routers of their own.
 */
export type BackendTransport = 'textgen' | 'kobold' | 'novel' | 'horde';

export interface BackendInfo {
    id: TextBackend;
    label: string;
    transport: BackendTransport;
    /** `api_type` sent to the multiplexing route. */
    apiType?: string;
    /** Whether the user supplies a server URL. */
    needsUrl: boolean;
    /** Secret key name, for backends that authenticate. */
    secretKey?: string;
    /** One line for the picker, saying what this is. */
    hint: string;
}

export const BACKENDS: Record<TextBackend, BackendInfo> = {
    ooba: {
        id: 'ooba',
        label: 'Text Generation WebUI',
        transport: 'textgen',
        apiType: 'ooba',
        needsUrl: true,
        hint: 'oobabooga, and anything else serving its OpenAI-compatible API.',
    },
    llamacpp: {
        id: 'llamacpp',
        label: 'llama.cpp server',
        transport: 'textgen',
        apiType: 'llamacpp',
        needsUrl: true,
        hint: 'The `llama-server` binary from llama.cpp.',
    },
    ollama: {
        id: 'ollama',
        label: 'Ollama',
        transport: 'textgen',
        apiType: 'ollama',
        needsUrl: true,
        hint: 'Samplers go in an `options` object, and only Ollama’s own names are accepted.',
    },
    tabby: {
        id: 'tabby',
        label: 'TabbyAPI',
        transport: 'textgen',
        apiType: 'tabby',
        needsUrl: true,
        hint: 'ExLlamaV2 behind an OpenAI-compatible API.',
    },
    vllm: {
        id: 'vllm',
        label: 'vLLM',
        transport: 'textgen',
        apiType: 'vllm',
        needsUrl: true,
        hint: 'Also covers Aphrodite, which shares vLLM’s parameter set.',
    },
    generic: {
        id: 'generic',
        label: 'Any OpenAI-compatible endpoint',
        transport: 'textgen',
        apiType: 'generic',
        needsUrl: true,
        hint: 'Only the parameters the OpenAI completions API defines are sent.',
    },
    kobold: {
        id: 'kobold',
        label: 'KoboldAI / KoboldCpp',
        transport: 'kobold',
        needsUrl: true,
        // Deliberately the native API rather than KoboldCpp's
        // OpenAI-compatible one: it has a documented parameter set the server
        // already builds a whitelisted body from, it reports both the
        // KoboldAI United and the KoboldCpp version, and it can abort a
        // running generation when the client disconnects.
        hint: 'KoboldAI United and KoboldCpp, through their native API.',
    },
    novel: {
        id: 'novel',
        label: 'NovelAI',
        transport: 'novel',
        needsUrl: false,
        secretKey: 'api_key_novel',
        hint: 'Erato and Kayra. Needs a NovelAI subscription token.',
    },
    horde: {
        id: 'horde',
        label: 'AI Horde',
        transport: 'horde',
        needsUrl: false,
        secretKey: 'api_key_horde',
        hint: 'Volunteered GPUs. A request is queued, so replies are not immediate.',
    },
};

/**
 * Samplers the UI can offer.
 *
 * Ordered as the panel shows them: the ones every backend has first.
 */
export const SAMPLERS = [
    'temperature',
    'top_p',
    'top_k',
    'min_p',
    'top_a',
    'typical_p',
    'tfs',
    'repetition_penalty',
    'repetition_penalty_range',
    'frequency_penalty',
    'presence_penalty',
    'mirostat_mode',
    'mirostat_tau',
    'mirostat_eta',
    'seed',
] as const;

export type Sampler = (typeof SAMPLERS)[number];

/**
 * Which samplers each backend implements.
 *
 * Sources, so this can be checked rather than trusted:
 * - `vllm` and `generic` from the `VLLM_KEYS` and `OPENAI_KEYS` arrays the
 *   server filters requests with, in `src/constants.js`.
 * - `ollama` from `OLLAMA_KEYS`, which is that project's `options` set.
 * - `ooba` and `tabby` from their own APIs, which the server forwards
 *   unfiltered — so anything sent that they do not implement is simply
 *   ignored, silently, which is what this map exists to prevent.
 * - `kobold` from the whitelist `/api/backends/kobold/generate` builds its
 *   body from, which is KoboldCpp's and KoboldAI United's own field set.
 * - `novel` and `horde` from their published parameter sets.
 */
export const SUPPORTED_SAMPLERS: Record<TextBackend, readonly Sampler[]> = {
    ooba: [
        'temperature', 'top_p', 'top_k', 'min_p', 'top_a', 'typical_p', 'tfs',
        'repetition_penalty', 'repetition_penalty_range', 'frequency_penalty',
        'presence_penalty', 'mirostat_mode', 'mirostat_tau', 'mirostat_eta', 'seed',
    ],
    llamacpp: [
        'temperature', 'top_p', 'top_k', 'min_p', 'typical_p', 'tfs',
        'repetition_penalty', 'repetition_penalty_range',
        'frequency_penalty', 'presence_penalty',
        'mirostat_mode', 'mirostat_tau', 'mirostat_eta', 'seed',
    ],
    // OLLAMA_KEYS: no top_a, no mirostat in the options set the server passes.
    ollama: [
        'temperature', 'top_p', 'top_k', 'min_p', 'typical_p', 'tfs',
        'repetition_penalty', 'repetition_penalty_range',
        'frequency_penalty', 'presence_penalty', 'seed',
    ],
    tabby: [
        'temperature', 'top_p', 'top_k', 'min_p', 'top_a', 'typical_p', 'tfs',
        'repetition_penalty', 'repetition_penalty_range',
        'frequency_penalty', 'presence_penalty', 'mirostat_mode', 'mirostat_tau',
        'mirostat_eta', 'seed',
    ],
    // VLLM_KEYS: has repetition_penalty and min_p, but no mirostat, tfs,
    // typical or top_a.
    vllm: [
        'temperature', 'top_p', 'top_k', 'min_p',
        'repetition_penalty', 'frequency_penalty', 'presence_penalty', 'seed',
    ],
    // OPENAI_KEYS: the completions API's own parameters, nothing more.
    generic: ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'seed'],
    kobold: [
        'temperature', 'top_p', 'top_k', 'min_p', 'top_a', 'typical_p', 'tfs',
        'repetition_penalty', 'repetition_penalty_range',
        'mirostat_mode', 'mirostat_tau', 'mirostat_eta', 'seed',
    ],
    novel: [
        'temperature', 'top_p', 'top_k', 'min_p', 'top_a', 'typical_p', 'tfs',
        'repetition_penalty', 'repetition_penalty_range',
    ],
    horde: [
        'temperature', 'top_p', 'top_k', 'min_p', 'top_a', 'typical_p', 'tfs',
        'repetition_penalty', 'repetition_penalty_range',
    ],
};

export function supportsSampler(backend: TextBackend, sampler: Sampler): boolean {
    return SUPPORTED_SAMPLERS[backend].includes(sampler);
}

/** Display metadata for a sampler control. */
export interface SamplerMeta {
    label: string;
    min: number;
    max: number;
    step: number;
    /** Value that means "off", so the panel can say so. */
    neutral: number;
    hint?: string;
}

export const SAMPLER_META: Record<Sampler, SamplerMeta> = {
    temperature: { label: 'Temperature', min: 0, max: 4, step: 0.01, neutral: 1 },
    top_p: { label: 'Top P', min: 0, max: 1, step: 0.01, neutral: 1 },
    top_k: { label: 'Top K', min: 0, max: 200, step: 1, neutral: 0 },
    min_p: { label: 'Min P', min: 0, max: 1, step: 0.01, neutral: 0 },
    top_a: { label: 'Top A', min: 0, max: 1, step: 0.01, neutral: 0 },
    typical_p: { label: 'Typical P', min: 0, max: 1, step: 0.01, neutral: 1 },
    tfs: { label: 'Tail-free sampling', min: 0, max: 1, step: 0.01, neutral: 1 },
    repetition_penalty: { label: 'Repetition penalty', min: 1, max: 3, step: 0.01, neutral: 1 },
    repetition_penalty_range: {
        label: 'Repetition penalty range',
        min: 0,
        max: 4096,
        step: 16,
        neutral: 0,
        hint: 'How many recent tokens the penalty looks back over. 0 means the whole context.',
    },
    frequency_penalty: { label: 'Frequency penalty', min: -2, max: 2, step: 0.01, neutral: 0 },
    presence_penalty: { label: 'Presence penalty', min: -2, max: 2, step: 0.01, neutral: 0 },
    mirostat_mode: {
        label: 'Mirostat',
        min: 0,
        max: 2,
        step: 1,
        neutral: 0,
        hint: 'Targets a fixed perplexity instead of a fixed cutoff. Overrides Top P and Top K.',
    },
    mirostat_tau: { label: 'Mirostat target entropy', min: 0, max: 20, step: 0.1, neutral: 5 },
    mirostat_eta: { label: 'Mirostat learning rate', min: 0, max: 1, step: 0.01, neutral: 0.1 },
    seed: {
        label: 'Seed',
        min: -1,
        max: 2 ** 31 - 1,
        step: 1,
        neutral: -1,
        hint: '−1 rolls a new one each generation.',
    },
};

/** The sampler values a generation uses. */
export type SamplerValues = Record<Sampler, number>;

export const DEFAULT_SAMPLERS: SamplerValues = {
    temperature: 1,
    top_p: 1,
    top_k: 0,
    min_p: 0.05,
    top_a: 0,
    typical_p: 1,
    tfs: 1,
    repetition_penalty: 1.05,
    repetition_penalty_range: 1024,
    frequency_penalty: 0,
    presence_penalty: 0,
    mirostat_mode: 0,
    mirostat_tau: 5,
    mirostat_eta: 0.1,
    seed: -1,
};

/**
 * True when a sampler is at the value that disables it.
 *
 * Used to leave a neutral sampler out of the request entirely: sending
 * `top_k: 0` is not always the same as not sending `top_k`, and a backend that
 * treats 0 as "keep zero tokens" would return nothing at all.
 */
export function isNeutral(sampler: Sampler, value: number): boolean {
    return value === SAMPLER_META[sampler].neutral;
}
