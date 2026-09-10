import { describe, expect, it } from 'vitest';
import { newChatFileName, splitChatFile } from './chats';

describe('splitChatFile', () => {
    it('separates the header line from the messages', () => {
        const result = splitChatFile([
            { user_name: 'unused', character_name: 'unused', chat_metadata: { note: 1 } },
            { name: 'Alex', is_user: true, mes: 'hi' },
        ]);
        expect(result.header?.chat_metadata).toEqual({ note: 1 });
        expect(result.messages).toHaveLength(1);
    });

    it('treats a headerless file as all messages', () => {
        const result = splitChatFile([{ name: 'Alex', is_user: true, mes: 'hi' }]);
        expect(result.header).toBeNull();
        expect(result.messages).toHaveLength(1);
    });

    it('does not mistake a message for a header', () => {
        // A message can legitimately carry chat_metadata; `mes` disambiguates.
        const result = splitChatFile([{ name: 'A', is_user: true, mes: 'x', chat_metadata: {} }]);
        expect(result.header).toBeNull();
        expect(result.messages).toHaveLength(1);
    });

    it('handles the empty response the backend sends for a new character', () => {
        expect(splitChatFile([])).toEqual({ header: null, messages: [] });
    });
});

describe('newChatFileName', () => {
    it('uses the legacy name and timestamp format', () => {
        const name = newChatFileName('Seraphina', new Date(2026, 8, 10, 12, 30, 5));
        expect(name).toBe('Seraphina - 2026-09-10@12h30m05s');
    });

    it('strips characters that are illegal in file names', () => {
        const name = newChatFileName('A/B:C', new Date(2026, 0, 1, 0, 0, 0));
        expect(name.startsWith('ABC - ')).toBe(true);
    });

    it('falls back to a default when the name is entirely stripped', () => {
        expect(newChatFileName('///').startsWith('Chat - ')).toBe(true);
    });
});
