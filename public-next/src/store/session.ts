import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ImageProvider } from '@/api/images';
import type { ChatCompletionSource, MediaLayout, ReasoningEffort } from '@/api/types';

/** Everything needed to talk to a provider, minus the API key. */
export interface ConnectionSettings {
    source: ChatCompletionSource;
    model: string;
    /** Base URL for the `custom` source. */
    customUrl: string;
    /**
     * Route generations through the OpenAI Responses API instead of Chat
     * Completions. Only meaningful for the `openai` and `custom` sources.
     */
    useResponsesApi: boolean;
}

/** Sampling knobs exposed in the UI. */
export interface SamplingSettings {
    temperature: number;
    maxTokens: number;
    topP: number;
    frequencyPenalty: number;
    presencePenalty: number;
    stream: boolean;
    /** Reasoning budget; `default` leaves the choice to the model. */
    reasoningEffort: ReasoningEffort;
    /** Request reasoning summaries and show them above the reply. */
    includeReasoning: boolean;
}

/** Which lorebooks are active and how the engine runs. */
export interface WorldInfoSettings {
    /** Master switch. */
    enabled: boolean;
    /** Book names selected in addition to the one bound to the character card. */
    books: string[];
    /** Also use the book named in the character's card, when it has one. */
    useCharacterBook: boolean;
    /** Tokens world info may spend. */
    budgetTokens: number;
    /** Recent messages scanned for keys. */
    scanDepth: number;
    /** Recursion rounds after the initial scan. 0 disables it. */
    maxRecursionRounds: number;
    /** Match entries by meaning as well as by key. */
    semanticEnabled: boolean;
    /**
     * Noise floor for a semantic match, 0-1. Absolute similarity depends on the
     * embedding model, so this is a floor rather than a confidence level.
     */
    semanticThreshold: number;
    /** At most this many entries may activate on meaning alone. */
    semanticTopK: number;
}

/** Image generation settings, remembered between renders. */
export interface ImageSettings {
    provider: ImageProvider;
    negativePrompt: string;
    width: number;
    height: number;
    steps: number;
    cfgScale: number;
    /** `-1` rolls a new seed per render. */
    seed: number;
    sampler: string;
    scheduler: string;
    model: string;
    /** How a finished render sits in the message. */
    layout: MediaLayout;
    /** Stack every render in a message, or show one at a time. */
    display: 'list' | 'gallery';
    novelai: {
        sm: boolean;
        smDyn: boolean;
        decrisper: boolean;
        varietyBoost: boolean;
        upscaleRatio: number;
    };
    comfyui: {
        url: string;
        auth: string;
        workflow: string;
        denoise: number;
        clipSkip: number;
    };
}

/** How the character and persona are turned into a system prompt. */
export interface PromptSettings {
    /** Prepended before the character definition. */
    systemPrompt: string;
    /** Appended after the chat history, closest to the model's turn. */
    jailbreak: string;
    /** Include `mes_example` blocks in the prompt. */
    includeExamples: boolean;
    /** How many recent messages to send. 0 means "as many as fit". */
    historyDepth: number;
}

interface SessionState {
    connection: ConnectionSettings;
    sampling: SamplingSettings;
    prompt: PromptSettings;
    worldInfo: WorldInfoSettings;
    image: ImageSettings;

    /** Avatar file name of the active persona, or null for the plain default. */
    personaAvatar: string | null;
    /** Display name used for the user's messages. */
    userName: string;
    /** Persona description injected into the prompt. */
    personaDescription: string;

    setConnection(patch: Partial<ConnectionSettings>): void;
    setSampling(patch: Partial<SamplingSettings>): void;
    setPrompt(patch: Partial<PromptSettings>): void;
    setWorldInfo(patch: Partial<WorldInfoSettings>): void;
    setImage(patch: Partial<ImageSettings>): void;
    setPersona(persona: { avatar: string | null; name: string; description: string }): void;
}

export const DEFAULT_SYSTEM_PROMPT =
    'Write {{char}}\'s next reply in a fictional roleplay between {{char}} and {{user}}. ' +
    'Stay in character, write in third person past tense, and keep the reply to a few paragraphs. ' +
    'Describe actions and surroundings vividly. Never write {{user}}\'s dialogue or actions.';

export const useSessionStore = create<SessionState>()(
    persist(
        (set) => ({
            connection: {
                source: 'openai',
                model: '',
                customUrl: '',
                useResponsesApi: false,
            },
            sampling: {
                temperature: 0.9,
                maxTokens: 900,
                topP: 1,
                frequencyPenalty: 0,
                presencePenalty: 0,
                stream: true,
                reasoningEffort: 'default',
                includeReasoning: true,
            },
            prompt: {
                systemPrompt: DEFAULT_SYSTEM_PROMPT,
                jailbreak: '',
                includeExamples: true,
                historyDepth: 0,
            },
            worldInfo: {
                enabled: true,
                books: [],
                useCharacterBook: true,
                budgetTokens: 1024,
                scanDepth: 4,
                maxRecursionRounds: 1,
                semanticEnabled: false,
                // Calibrated against the bundled local embedding model, which
                // scores clearly related lore around 0.4 and unrelated lore
                // around 0.1. A higher floor would never fire.
                semanticThreshold: 0.3,
                semanticTopK: 3,
            },

            image: {
                provider: 'novelai',
                negativePrompt: '',
                // NovelAI's own portrait default, and the shape most character
                // renders want.
                width: 832,
                height: 1216,
                steps: 28,
                cfgScale: 5,
                seed: -1,
                sampler: '',
                scheduler: '',
                model: '',
                layout: 'inline',
                display: 'list',
                novelai: {
                    sm: false,
                    smDyn: false,
                    decrisper: false,
                    varietyBoost: false,
                    upscaleRatio: 0,
                },
                comfyui: {
                    url: 'http://127.0.0.1:8188',
                    auth: '',
                    workflow: 'Default_Comfy_Workflow.json',
                    denoise: 1,
                    clipSkip: 1,
                },
            },

            personaAvatar: null,
            userName: 'User',
            personaDescription: '',

            setConnection: (patch) => set((state) => ({ connection: { ...state.connection, ...patch } })),
            setSampling: (patch) => set((state) => ({ sampling: { ...state.sampling, ...patch } })),
            setPrompt: (patch) => set((state) => ({ prompt: { ...state.prompt, ...patch } })),
            setWorldInfo: (patch) => set((state) => ({ worldInfo: { ...state.worldInfo, ...patch } })),
            setImage: (patch) => set((state) => ({ image: { ...state.image, ...patch } })),
            setPersona: (persona) =>
                set({
                    personaAvatar: persona.avatar,
                    userName: persona.name,
                    personaDescription: persona.description,
                }),
        }),
        {
            name: 'st-next:session',
            version: 1,
            /**
             * Deep-merge the nested groups.
             *
             * The default merge is shallow, so a state saved before a new
             * setting existed would replace the whole group and leave that
             * setting undefined. Merging per group keeps new defaults intact
             * across upgrades.
             */
            merge: (persisted, current) => {
                const saved = (persisted ?? {}) as Partial<SessionState>;
                return {
                    ...current,
                    ...saved,
                    connection: { ...current.connection, ...saved.connection },
                    sampling: { ...current.sampling, ...saved.sampling },
                    prompt: { ...current.prompt, ...saved.prompt },
                    worldInfo: { ...current.worldInfo, ...saved.worldInfo },
                    image: {
                        ...current.image,
                        ...saved.image,
                        novelai: { ...current.image.novelai, ...saved.image?.novelai },
                        comfyui: { ...current.image.comfyui, ...saved.image?.comfyui },
                    },
                };
            },
        },
    ),
);
