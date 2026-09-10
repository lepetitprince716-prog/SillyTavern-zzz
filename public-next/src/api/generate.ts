import { apiPost, apiStream } from './client';
import type { ChatCompletionSource, GenerateRequest, PromptMessage, StatusResponse } from './types';

export interface GenerateOptions {
    source: ChatCompletionSource;
    messages: PromptMessage[];
    model: string;
    temperature: number;
    maxTokens: number;
    topP: number;
    frequencyPenalty: number;
    presencePenalty: number;
    stream: boolean;
    /** Base URL for the `custom` source, e.g. a local llama.cpp server. */
    customUrl?: string;
    characterName?: string;
    userName?: string;
    signal?: AbortSignal;
}

function buildBody(options: GenerateOptions): GenerateRequest {
    const body: GenerateRequest = {
        messages: options.messages,
        chat_completion_source: options.source,
        model: options.model,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        top_p: options.topP,
        frequency_penalty: options.frequencyPenalty,
        presence_penalty: options.presencePenalty,
        stream: options.stream,
    };
    if (options.source === 'custom' && options.customUrl) {
        body.custom_url = options.customUrl;
    }
    if (options.characterName) {
        body.char_name = options.characterName;
    }
    if (options.userName) {
        body.user_name = options.userName;
    }
    return body;
}

/** Starts a streaming generation. The caller consumes `response.body`. */
export function generateStream(options: GenerateOptions): Promise<Response> {
    return apiStream('/api/backends/chat-completions/generate', buildBody({ ...options, stream: true }), {
        signal: options.signal,
    });
}

/** Runs a non-streaming generation and returns the completed text. */
export async function generateOnce(options: GenerateOptions): Promise<string> {
    const payload = await apiPost<unknown>(
        '/api/backends/chat-completions/generate',
        buildBody({ ...options, stream: false }),
        { signal: options.signal },
    );
    return extractCompletion(payload);
}

function read(value: unknown, key: string): unknown {
    return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
}

/**
 * Pulls the assistant text out of a non-streamed completion.
 * Handles the OpenAI, Anthropic and Google response envelopes.
 */
export function extractCompletion(payload: unknown): string {
    const choices = read(payload, 'choices');
    if (Array.isArray(choices) && choices.length > 0) {
        const first = choices[0];
        const message = read(first, 'message');
        const content = read(message, 'content') ?? read(first, 'text');
        if (typeof content === 'string') {
            return content;
        }
        if (Array.isArray(content)) {
            return content.map((part) => String(read(part, 'text') ?? '')).join('');
        }
    }

    // Anthropic: { content: [{ type: 'text', text }] }
    const content = read(payload, 'content');
    if (Array.isArray(content)) {
        return content
            .filter((part) => read(part, 'type') !== 'thinking')
            .map((part) => String(read(part, 'text') ?? ''))
            .join('');
    }

    // Google: { candidates: [{ content: { parts: [{ text }] } }] }
    const candidates = read(payload, 'candidates');
    if (Array.isArray(candidates) && candidates.length > 0) {
        const parts = read(read(candidates[0], 'content'), 'parts');
        if (Array.isArray(parts)) {
            return parts.map((part) => String(read(part, 'text') ?? '')).join('');
        }
    }

    if (typeof read(payload, 'text') === 'string') {
        return String(read(payload, 'text'));
    }
    return '';
}

/**
 * Sources whose model list the backend can enumerate via `/status`.
 *
 * Anthropic and Google are absent on purpose: the endpoint has no branch for
 * them and answers 400, so asking would only produce a failed request.
 */
export const SOURCES_WITH_MODEL_LIST: ReadonlySet<ChatCompletionSource> = new Set([
    'openai',
    'openrouter',
    'mistralai',
    'deepseek',
    'xai',
    'cohere',
    'custom',
]);

/**
 * Convenience starting points for sources with no enumeration.
 *
 * This list is a shortcut, not an authority — providers ship models faster than
 * a hard-coded list can track, so the UI always allows typing a model id.
 */
export const SUGGESTED_MODELS: Partial<Record<ChatCompletionSource, string[]>> = {
    claude: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
    makersuite: ['gemini-2.5-pro', 'gemini-2.5-flash'],
};

/**
 * Lists models the provider offers.
 * Returns an empty array when the provider cannot enumerate or has no key —
 * callers fall back to {@link SUGGESTED_MODELS}.
 */
export async function fetchModels(
    source: ChatCompletionSource,
    customUrl?: string,
    signal?: AbortSignal,
): Promise<string[]> {
    if (!SOURCES_WITH_MODEL_LIST.has(source)) {
        return [];
    }
    try {
        const response = await apiPost<StatusResponse>(
            '/api/backends/chat-completions/status',
            { chat_completion_source: source, ...(customUrl ? { custom_url: customUrl } : {}) },
            { signal },
        );
        const models = (response.data ?? [])
            .map((entry) => entry.id ?? entry.model)
            .filter((id): id is string => typeof id === 'string' && id.length > 0);
        return [...new Set(models)].sort((a, b) => a.localeCompare(b));
    } catch {
        return [];
    }
}
