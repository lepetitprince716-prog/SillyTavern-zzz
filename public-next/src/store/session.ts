import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatCompletionSource } from '@/api/types';

/** Everything needed to talk to a provider, minus the API key. */
export interface ConnectionSettings {
    source: ChatCompletionSource;
    model: string;
    /** Base URL for the `custom` source. */
    customUrl: string;
}

/** Sampling knobs exposed in the UI. */
export interface SamplingSettings {
    temperature: number;
    maxTokens: number;
    topP: number;
    frequencyPenalty: number;
    presencePenalty: number;
    stream: boolean;
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

    /** Avatar file name of the active persona, or null for the plain default. */
    personaAvatar: string | null;
    /** Display name used for the user's messages. */
    userName: string;
    /** Persona description injected into the prompt. */
    personaDescription: string;

    setConnection(patch: Partial<ConnectionSettings>): void;
    setSampling(patch: Partial<SamplingSettings>): void;
    setPrompt(patch: Partial<PromptSettings>): void;
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
            },
            sampling: {
                temperature: 0.9,
                maxTokens: 900,
                topP: 1,
                frequencyPenalty: 0,
                presencePenalty: 0,
                stream: true,
            },
            prompt: {
                systemPrompt: DEFAULT_SYSTEM_PROMPT,
                jailbreak: '',
                includeExamples: true,
                historyDepth: 0,
            },

            personaAvatar: null,
            userName: 'User',
            personaDescription: '',

            setConnection: (patch) => set((state) => ({ connection: { ...state.connection, ...patch } })),
            setSampling: (patch) => set((state) => ({ sampling: { ...state.sampling, ...patch } })),
            setPrompt: (patch) => set((state) => ({ prompt: { ...state.prompt, ...patch } })),
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
        },
    ),
);
