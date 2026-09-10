import { apiPost } from './client';
import type { ChatHeader, ChatMessage } from './types';

/** A chat file split into its header line and message lines. */
export interface LoadedChat {
    header: ChatHeader | null;
    messages: ChatMessage[];
}

/** True for the metadata line that leads every `.jsonl` chat file. */
function isHeaderLine(line: unknown): line is ChatHeader {
    return (
        !!line &&
        typeof line === 'object' &&
        'chat_metadata' in (line as Record<string, unknown>) &&
        !('mes' in (line as Record<string, unknown>))
    );
}

/**
 * Splits raw chat file lines into header and messages.
 *
 * Exported for tests and for callers that already hold the raw array.
 */
export function splitChatFile(lines: unknown[]): LoadedChat {
    if (!Array.isArray(lines) || lines.length === 0) {
        return { header: null, messages: [] };
    }
    const [first, ...rest] = lines;
    if (isHeaderLine(first)) {
        return { header: first, messages: rest as ChatMessage[] };
    }
    return { header: null, messages: lines as ChatMessage[] };
}

/**
 * Loads a chat by character avatar and file name (without the `.jsonl`).
 * A missing file yields an empty chat rather than an error — that is how the
 * backend reports "this character has no chats yet".
 */
export async function fetchChat(
    avatar: string,
    fileName: string,
    signal?: AbortSignal,
): Promise<LoadedChat> {
    const result = await apiPost<unknown[] | Record<string, never>>(
        '/api/chats/get',
        { avatar_url: avatar, file_name: fileName },
        { signal },
    );
    return splitChatFile(Array.isArray(result) ? result : []);
}

export interface SaveChatOptions {
    avatar: string;
    characterName: string;
    fileName: string;
    messages: ChatMessage[];
    metadata?: Record<string, unknown>;
    /** Overwrite even if the file changed underneath us. */
    force?: boolean;
}

/**
 * Persists a chat.
 *
 * The header line is written in the same shape the legacy UI uses, so chats
 * saved here open cleanly in the classic interface and vice versa.
 */
export async function saveChat(options: SaveChatOptions): Promise<void> {
    const header: ChatHeader = {
        user_name: 'unused',
        character_name: 'unused',
        chat_metadata: options.metadata ?? {},
    };

    await apiPost('/api/chats/save', {
        ch_name: options.characterName,
        file_name: options.fileName,
        avatar_url: options.avatar,
        chat: [header, ...options.messages],
        force: options.force ?? false,
    });
}

/** Renames a chat file. */
export function renameChat(avatar: string, from: string, to: string): Promise<void> {
    return apiPost('/api/chats/rename', {
        avatar_url: avatar,
        original_file: `${from}.jsonl`,
        renamed_file: `${to}.jsonl`,
    });
}

/** Deletes a chat file. */
export function deleteChat(avatar: string, fileName: string): Promise<void> {
    return apiPost('/api/chats/delete', {
        chatfile: `${fileName}.jsonl`,
        avatar_url: avatar,
    });
}

/**
 * Builds the file name for a new chat.
 * Matches the legacy convention — `<Character> - <timestamp>` — so both UIs
 * sort and display them identically.
 */
export function newChatFileName(characterName: string, date = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}@${pad(date.getHours())}h${pad(date.getMinutes())}m${pad(date.getSeconds())}s`;
    // The backend sanitises file names; strip separators up front so the name
    // the UI shows matches the name on disk.
    const safeName = characterName.replace(/[\\/:*?"<>|]/g, '').trim() || 'Chat';
    return `${safeName} - ${stamp}`;
}
