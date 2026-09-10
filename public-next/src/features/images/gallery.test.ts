import { describe, expect, it } from 'vitest';
import type { ChatMessage, MediaAttachment } from '@/api/types';
import {
    collectGalleryImages,
    enrichFolderAttachments,
    folderAttachments,
    folderImageUrl,
} from './gallery';

function image(url: string, patch: Partial<MediaAttachment> = {}): MediaAttachment {
    return { url, type: 'image', ...patch };
}

function message(patch: Partial<ChatMessage> = {}): ChatMessage {
    return { name: 'Seraphina', is_user: false, mes: 'text', ...patch };
}

describe('collectGalleryImages', () => {
    it('is empty for a chat with no images', () => {
        expect(collectGalleryImages([])).toEqual([]);
        expect(collectGalleryImages([message(), message()])).toEqual([]);
    });

    it('lists the newest first', () => {
        const images = collectGalleryImages([
            message({ extra: { media: [image('/a.png')] } }),
            message(),
            message({ extra: { media: [image('/b.png')] } }),
        ]);
        expect(images.map((entry) => entry.attachment.url)).toEqual(['/b.png', '/a.png']);
    });

    it('keeps the order within a message', () => {
        const images = collectGalleryImages([
            message({ extra: { media: [image('/one.png'), image('/two.png')] } }),
        ]);
        // Reversing the whole list must not reverse a message's own gallery,
        // whose order is what the filmstrip shows.
        expect(images.map((entry) => entry.attachment.url)).toEqual(['/two.png', '/one.png']);
    });

    it('records where each image came from, so the panel can jump back', () => {
        const images = collectGalleryImages([
            message(),
            message({
                name: 'Alice',
                is_user: true,
                send_date: '2026-09-10 @03h 00m 00s 000ms',
                extra: { media: [image('/a.png'), image('/b.png')] },
            }),
        ]);
        expect(images[0]).toMatchObject({
            messageIndex: 1,
            attachmentIndex: 1,
            from: 'Alice',
            sentAt: '2026-09-10 @03h 00m 00s 000ms',
        });
        expect(images[1]).toMatchObject({ messageIndex: 1, attachmentIndex: 0 });
    });

    it('leaves video and audio attachments out of an image panel', () => {
        const media = [
            image('/a.png'),
            { url: '/b.mp4', type: 'video' as const },
            { url: '/c.mp3', type: 'audio' as const },
        ];
        const images = collectGalleryImages([message({ extra: { media } })]);
        expect(images.map((entry) => entry.attachment.url)).toEqual(['/a.png']);
    });

    it('drops an attachment with no url rather than listing a broken tile', () => {
        const media = [image('/a.png'), { type: 'image' } as MediaAttachment];
        expect(collectGalleryImages([message({ extra: { media } })])).toHaveLength(1);
    });

    it('survives a message whose name is missing', () => {
        const images = collectGalleryImages([
            message({ name: '', extra: { media: [image('/a.png')] } }),
        ]);
        expect(images[0]?.from).toBe('');
    });
});

describe('folderImageUrl', () => {
    it('builds the path the server serves the folder from', () => {
        expect(folderImageUrl('Seraphina', 'a.png')).toBe('/user/images/Seraphina/a.png');
    });

    it('encodes a name that would otherwise break the URL', () => {
        // `/api/images/list` answers with bare file names, and a prompt slug
        // can contain anything the file system allows.
        expect(folderImageUrl('Sera phina', 'a b#1.png')).toBe('/user/images/Sera%20phina/a%20b%231.png');
    });
});

describe('folderAttachments', () => {
    it('captions each file with its stem', () => {
        expect(folderAttachments('Seraphina', ['a-fox-girl_123_s7.png'])).toEqual([
            {
                url: '/user/images/Seraphina/a-fox-girl_123_s7.png',
                type: 'image',
                title: 'a-fox-girl_123_s7',
            },
        ]);
    });

    it('is empty for an empty folder', () => {
        expect(folderAttachments('Seraphina', [])).toEqual([]);
    });
});

describe('enrichFolderAttachments', () => {
    const chatImages = collectGalleryImages([
        message({
            extra: {
                media: [image('/user/images/Seraphina/a.png', { seed: 42, title: 'a fox girl' })],
            },
        }),
    ]);

    it('pairs a folder file with the chat attachment that has its settings', () => {
        const [enriched] = enrichFolderAttachments('Seraphina', ['a.png'], chatImages);
        // A file on disk carries no seed; the chat file does.
        expect(enriched).toMatchObject({ seed: 42, title: 'a fox girl' });
    });

    it('leaves a file from another chat bare', () => {
        const [enriched] = enrichFolderAttachments('Seraphina', ['old.png'], chatImages);
        expect(enriched?.seed).toBeUndefined();
        expect(enriched?.title).toBe('old');
    });

    it('matches even though the chat stores the path unencoded', () => {
        const spaced = collectGalleryImages([
            message({ extra: { media: [image('/user/images/Seraphina/a b.png', { seed: 7 })] } }),
        ]);
        const [enriched] = enrichFolderAttachments('Seraphina', ['a b.png'], spaced);
        expect(enriched?.seed).toBe(7);
    });
});
