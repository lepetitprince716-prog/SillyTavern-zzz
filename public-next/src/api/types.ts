/**
 * Types for the SillyTavern backend as it exists today.
 *
 * The server hands back data shaped by the Character Card V2/V3 spec and by
 * years of organic growth, so most fields are optional on purpose: this file
 * describes what the wire *actually* looks like rather than what would be
 * convenient. Normalisation into app-friendly shapes happens in the modules
 * that consume these types, never by lying in the declarations here.
 */

/** Character Card V2 `data` block. */
export interface CharacterCardData {
    name?: string;
    description?: string;
    personality?: string;
    scenario?: string;
    first_mes?: string;
    mes_example?: string;
    creator_notes?: string;
    system_prompt?: string;
    post_history_instructions?: string;
    alternate_greetings?: string[];
    tags?: string[];
    creator?: string;
    character_version?: string;
    extensions?: Record<string, unknown>;
}

/** A character as returned by `POST /api/characters/all`. */
export interface Character {
    /** Avatar file name, e.g. `Seraphina.png`. Doubles as the character's id. */
    avatar: string;
    name: string;
    description?: string;
    personality?: string;
    scenario?: string;
    first_mes?: string;
    mes_example?: string;
    creatorcomment?: string;
    /** File name (without extension) of the most recently used chat. */
    chat?: string;
    tags?: string[];
    fav?: boolean | string;
    talkativeness?: string | number;
    data?: CharacterCardData;
    create_date?: string | number;
    date_added?: number;
    date_last_chat?: number;
    chat_size?: number;
    json_data?: string;
}

/** Media kinds the chat file can carry. */
export type MediaType = 'image' | 'video' | 'audio';

/** Where a media attachment came from. Matches the classic UI's vocabulary. */
export type MediaSource = 'api' | 'upload' | 'generated' | 'captioned';

/**
 * One entry of `extra.media`.
 *
 * `url`, `title`, `type` and `source` are what the classic UI reads. The rest
 * is written by this frontend and ignored elsewhere: unknown keys survive the
 * round-trip through the chat file untouched, so recording how a render was
 * made costs nothing in compatibility.
 */
export interface MediaAttachment {
    /** Server-relative path, e.g. `user/images/Seraphina/1757...png`. */
    url: string;
    /** Shown as a caption and as the image's accessible name. */
    title?: string;
    type: MediaType;
    source?: MediaSource;
    /** Pixel size, when known. Lets the layout reserve the right box. */
    width?: number;
    height?: number;
    negative?: string;
    /** Seed actually used, so the render can be reproduced. */
    seed?: number;
    provider?: string;
    model?: string;
    steps?: number;
    cfgScale?: number;
    sampler?: string;
    scheduler?: string;
    workflow?: string;
    /** Wall-clock time the provider took, in milliseconds. */
    durationMs?: number;
}

/**
 * How a message lays its media out.
 *
 * The classic UI has one boolean, `inline_image`, which either shows the text
 * with the image or replaces the text entirely. `media_layout` is the finer
 * grained version; `inline_image` is kept in sync so the classic UI still does
 * something sensible with the same message.
 */
export type MediaLayout = 'inline' | 'caption' | 'cover';

/** Per-message metadata bag. Extensions write into this freely. */
export interface ChatMessageExtra {
    token_count?: number;
    reasoning?: string;
    reasoning_duration?: number;
    model?: string;
    api?: string;
    bias?: string;
    isSmallSys?: boolean;
    title?: string;
    media?: MediaAttachment[];
    /** `'list'` stacks every attachment; `'gallery'` shows one at a time. */
    media_display?: 'list' | 'gallery';
    /** Selected attachment in gallery display. */
    media_index?: number;
    /** Classic UI switch: false hides the message text. */
    inline_image?: boolean;
    media_layout?: MediaLayout;
    [key: string]: unknown;
}

/** One line of a `.jsonl` chat file, past the header. */
export interface ChatMessage {
    name: string;
    is_user: boolean;
    is_system?: boolean;
    /** Formatted timestamp string, e.g. `2026-09-10 @12h 30m 15s 250ms`. */
    send_date?: string;
    mes: string;
    extra?: ChatMessageExtra;
    swipe_id?: number;
    swipes?: string[];
    swipe_info?: Array<{ send_date?: string; gen_started?: string; gen_finished?: string; extra?: ChatMessageExtra } | null>;
    force_avatar?: string;
    /** Present on the header line only — used to tell it apart from messages. */
    chat_metadata?: Record<string, unknown>;
    user_name?: string;
    character_name?: string;
}

/** First line of a `.jsonl` chat file. */
export interface ChatHeader {
    user_name: string;
    character_name: string;
    create_date?: string;
    chat_metadata: Record<string, unknown>;
}

/** Chat summary from `POST /api/characters/chats`. */
export interface ChatSummary {
    /** File name including the `.jsonl` extension. */
    file_name: string;
    /** File name without the extension — the id used by the chat endpoints. */
    file_id?: string;
    file_size?: string;
    chat_items?: number;
    /** Preview of the last message in the file. */
    mes?: string;
    /** Modification time in milliseconds. */
    last_mes?: number;
    chat_metadata?: Record<string, unknown>;
}

/** A single OpenAI-style prompt message sent to the generation endpoint. */
export interface PromptMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
    name?: string;
}

/**
 * Chat completion sources understood by
 * `POST /api/backends/chat-completions/generate`. Only the subset this UI
 * exposes is listed; the backend accepts more.
 */
export const CHAT_COMPLETION_SOURCES = {
    openai: 'openai',
    claude: 'claude',
    openrouter: 'openrouter',
    makersuite: 'makersuite',
    deepseek: 'deepseek',
    mistralai: 'mistralai',
    xai: 'xai',
    cohere: 'cohere',
    custom: 'custom',
} as const;

export type ChatCompletionSource =
    (typeof CHAT_COMPLETION_SOURCES)[keyof typeof CHAT_COMPLETION_SOURCES];

/** Human-readable labels for the sources above. */
export const SOURCE_LABELS: Record<ChatCompletionSource, string> = {
    openai: 'OpenAI',
    claude: 'Anthropic Claude',
    openrouter: 'OpenRouter',
    makersuite: 'Google AI Studio',
    deepseek: 'DeepSeek',
    mistralai: 'Mistral AI',
    xai: 'xAI',
    cohere: 'Cohere',
    custom: 'Custom (OpenAI-compatible)',
};

/**
 * Reasoning budget, in the vocabulary the Responses API accepts.
 * `default` means "send nothing and let the model decide".
 */
export const REASONING_EFFORTS = ['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** Sampling parameters the UI lets the user drive. */
export interface GenerationParams {
    model: string;
    temperature: number;
    max_tokens: number;
    top_p: number;
    frequency_penalty: number;
    presence_penalty: number;
    stream: boolean;
}

/** Request body for `POST /api/backends/chat-completions/generate`. */
export interface GenerateRequest extends GenerationParams {
    messages: PromptMessage[];
    chat_completion_source: ChatCompletionSource;
    /** Base URL for `custom` sources. */
    custom_url?: string;
    reverse_proxy?: string;
    proxy_password?: string;
    char_name?: string;
    user_name?: string;
    /**
     * Route through the OpenAI Responses API (`/v1/responses`) instead of Chat
     * Completions. Supported for the `openai` and `custom` sources.
     */
    use_responses_api?: boolean;
    /** Reasoning budget. Omitted when the user has not chosen one. */
    reasoning_effort?: Exclude<ReasoningEffort, 'default'>;
    /** Ask for reasoning summaries alongside the answer. */
    include_reasoning?: boolean;
    /**
     * Let the provider retain the response. The Responses API defaults this to
     * true; the backend sends false unless it is explicitly set.
     */
    store?: boolean;
}

/** Response of `POST /api/backends/chat-completions/status`. */
export interface StatusResponse {
    data?: Array<{ id: string; model?: string; [key: string]: unknown }>;
    error?: unknown;
}

/** The logged-in user, from `GET /api/users/me`. */
export interface UserProfile {
    handle: string;
    name: string;
    avatar?: string;
    admin?: boolean;
}

/** `GET /version`. */
export interface VersionInfo {
    pkgVersion: string;
    gitRevision?: string | null;
    gitBranch?: string | null;
    isLatest?: boolean;
}
