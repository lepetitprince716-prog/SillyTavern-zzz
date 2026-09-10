/**
 * Collects a chat's images for the side panel.
 *
 * Inline rendering answers "what did this message look like". It does not
 * answer "where is the render I liked twenty messages ago", and today the only
 * way to find one is to scroll. A panel of every render in the chat is a
 * navigator for exactly that, so each entry has to carry the message it came
 * from — a wall of thumbnails with no way back to their context would just be
 * a second place to scroll.
 */

import type { ChatMessage, MediaAttachment } from '@/api/types';
import { messageMedia } from './media';

export interface GalleryImage {
    attachment: MediaAttachment;
    /** Index of the message this belongs to, for jumping back to it. */
    messageIndex: number;
    /** Position within that message's own media array. */
    attachmentIndex: number;
    /** Who sent the message, for the caption. */
    from: string;
    /** The message's timestamp, if it has one. */
    sentAt: string | undefined;
}

/**
 * Every image in the chat, newest first.
 *
 * Newest first because the panel is a way back to something recent far more
 * often than it is a way to the beginning of a long chat.
 */
export function collectGalleryImages(messages: ChatMessage[]): GalleryImage[] {
    const images: GalleryImage[] = [];

    messages.forEach((message, messageIndex) => {
        messageMedia(message).forEach((attachment, attachmentIndex) => {
            // Videos and audio can live in `extra.media` too; this panel is
            // about images and says so.
            if (attachment.type !== 'image') {
                return;
            }
            images.push({
                attachment,
                messageIndex,
                attachmentIndex,
                from: message.name || '',
                sentAt: message.send_date,
            });
        });
    });

    return images.reverse();
}

/**
 * Turns the file names `POST /api/images/list` returns into URLs.
 *
 * That route answers with bare file names, not paths — the directory is the
 * folder that was asked for.
 */
export function folderImageUrl(folder: string, fileName: string): string {
    return `/user/images/${encodeURIComponent(folder)}/${encodeURIComponent(fileName)}`;
}

/**
 * Builds the attachment records for a folder listing.
 *
 * A file on disk carries no generation settings — those live in the chat file
 * — so these are deliberately bare. The panel says as much rather than
 * showing an empty metadata table.
 */
export function folderAttachments(folder: string, fileNames: string[]): MediaAttachment[] {
    return fileNames.map((fileName) => ({
        url: folderImageUrl(folder, fileName),
        type: 'image' as const,
        // The stem is the prompt slug for anything this frontend rendered, so
        // it is a genuinely useful caption rather than filler.
        title: fileName.replace(/\.[^.]+$/, ''),
    }));
}

/**
 * Matches a folder file back to the chat image that has its settings.
 *
 * The same render appears in both lists — once as a chat attachment carrying
 * its seed and prompt, once as a bare file name. Pairing them lets the folder
 * tab show the real settings for anything from this chat instead of nothing.
 */
export function enrichFolderAttachments(
    folder: string,
    fileNames: string[],
    chatImages: GalleryImage[],
): MediaAttachment[] {
    const byUrl = new Map(chatImages.map((image) => [image.attachment.url, image.attachment]));
    return folderAttachments(folder, fileNames).map((bare) => {
        // The chat file stores the path unencoded, so compare on the decoded
        // form rather than the URL this module just built.
        const decoded = decodeURI(bare.url);
        return byUrl.get(decoded) ?? byUrl.get(bare.url) ?? bare;
    });
}
