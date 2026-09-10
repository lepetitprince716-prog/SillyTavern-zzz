/**
 * Groups: several characters in one chat.
 *
 * A group is a JSON file in `data/<user>/groups/`, and its chats are `.jsonl`
 * files in `group chats/` keyed by id rather than by character. The shape here
 * is the file's, integer enums included, so a group created in either
 * interface opens in the other.
 */

import { apiPost } from './client';
import type { ChatMessage } from './types';
import {
    activationFromNumber,
    GROUP_ACTIVATION,
    GROUP_GENERATION_MODE,
    generationModeFromNumber,
    type ActivationStrategy,
    type GenerationMode,
} from '@/features/groups/engine';

/** A group, exactly as `data/<user>/groups/<id>.json` stores it. */
export interface Group {
    id: string;
    name: string;
    /** Avatar file names, in speaking order. */
    members: string[];
    /** Thumbnail for the group itself, if one was set. */
    avatar_url?: string;
    allow_self_responses: boolean;
    /** See `GROUP_ACTIVATION`. Stored as an integer. */
    activation_strategy: number;
    /** See `GROUP_GENERATION_MODE`. Stored as an integer. */
    generation_mode: number;
    /** Members switched off without being removed. */
    disabled_members: string[];
    fav?: boolean;
    /** The chat file currently open. */
    chat_id: string;
    /** Every chat file belonging to this group. */
    chats: string[];
    /** Seconds between replies in auto mode. */
    auto_mode_delay: number;
    /** Wrappers around each member's block when the cards are joined. */
    generation_mode_join_prefix: string;
    generation_mode_join_suffix: string;

    /** Added by `/all`, not stored. */
    date_added?: number;
    create_date?: string;
    date_last_chat?: number;
    chat_size?: number;
}

export function fetchGroups(signal?: AbortSignal): Promise<Group[]> {
    return apiPost<Group[]>('/api/groups/all', {}, signal ? { signal } : {});
}

/** What the create route accepts. Everything it omits gets a server default. */
export interface NewGroup {
    name: string;
    members: string[];
    allow_self_responses?: boolean;
    activation_strategy?: number;
    generation_mode?: number;
    disabled_members?: string[];
    auto_mode_delay?: number;
    generation_mode_join_prefix?: string;
    generation_mode_join_suffix?: string;
}

export function createGroup(group: NewGroup): Promise<Group> {
    return apiPost<Group, NewGroup>('/api/groups/create', group);
}

/**
 * Saves a group.
 *
 * The route writes the request body to the file wholesale, so a partial object
 * would silently drop every field it omits — including the chat list. Callers
 * pass the whole group.
 */
export function saveGroup(group: Group): Promise<{ ok: boolean }> {
    return apiPost<{ ok: boolean }, Group>('/api/groups/edit', group);
}

export function deleteGroup(id: string): Promise<unknown> {
    return apiPost<unknown>('/api/groups/delete', { id });
}

/** A group chat, as stored: a header line then the messages. */
export interface LoadedGroupChat {
    header: { chat_metadata?: Record<string, unknown> } | null;
    messages: ChatMessage[];
}

/**
 * Loads a group chat.
 *
 * The route answers `{}` for a chat that does not exist yet, which is what a
 * freshly created group has, so an empty result is a new chat and not an
 * error.
 */
export async function fetchGroupChat(chatId: string, signal?: AbortSignal): Promise<LoadedGroupChat> {
    const lines = await apiPost<unknown>('/api/chats/group/get', { id: chatId }, signal ? { signal } : {});
    if (!Array.isArray(lines) || lines.length === 0) {
        return { header: null, messages: [] };
    }

    const [first, ...rest] = lines as Array<Record<string, unknown>>;
    // The header is the only line carrying `chat_metadata`; a chat saved by an
    // older version may not have one at all.
    const hasHeader = Boolean(first && typeof first === 'object' && 'chat_metadata' in first);
    return {
        header: hasHeader ? (first as LoadedGroupChat['header']) : null,
        messages: (hasHeader ? rest : (lines as unknown[])) as ChatMessage[],
    };
}

export function saveGroupChat(options: {
    chatId: string;
    messages: ChatMessage[];
    metadata?: Record<string, unknown>;
}): Promise<{ ok: boolean }> {
    const header = {
        user_name: 'You',
        character_name: '',
        create_date: new Date().toISOString(),
        chat_metadata: options.metadata ?? {},
    };
    return apiPost<{ ok: boolean }>('/api/chats/group/save', {
        id: options.chatId,
        chat: [header, ...options.messages],
        force: true,
    });
}

export function deleteGroupChat(chatId: string): Promise<unknown> {
    return apiPost<unknown>('/api/chats/group/delete', { id: chatId });
}

/** The group's strategy, as a name rather than an integer. */
export function groupStrategy(group: Group): ActivationStrategy {
    return activationFromNumber(group.activation_strategy);
}

export function groupGenerationMode(group: Group): GenerationMode {
    return generationModeFromNumber(group.generation_mode);
}

/** Applies a strategy back onto the group, as the integer the file stores. */
export function withStrategy(group: Group, strategy: ActivationStrategy): Group {
    return { ...group, activation_strategy: GROUP_ACTIVATION[strategy] };
}

export function withGenerationMode(group: Group, mode: GenerationMode): Group {
    return { ...group, generation_mode: GROUP_GENERATION_MODE[mode] };
}

/** A new chat id for a group. The classic UI uses a millisecond timestamp. */
export function newGroupChatId(now = Date.now()): string {
    return String(now);
}
