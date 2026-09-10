/**
 * The images side panel.
 *
 * Two lists, because they answer different questions. **This chat** is every
 * render in the open conversation, newest first, and each tile can jump back
 * to the message it belongs to — that is the panel's real job, since finding a
 * render otherwise means scrolling the chat. **All of {character}** is the
 * whole `user/images/<name>` folder, where every render from every chat with
 * them lands, for the one from last week.
 */

import { CornerUpLeft, ImageOff, Images, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiPost } from '@/api/client';
import type { MediaAttachment } from '@/api/types';
import { SegmentedControl } from '@/components/ui/controls';
import { Tooltip } from '@/components/ui/overlays';
import { EmptyState, IconButton, Skeleton } from '@/components/ui/primitives';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Lightbox } from './Lightbox';
import { collectGalleryImages, enrichFolderAttachments } from './gallery';
import { mediaUrl } from './media';
import type { ChatMessage } from '@/api/types';

type Source = 'chat' | 'character';

export interface ImagePanelProps {
    /** The open chat, oldest first. */
    messages: ChatMessage[];
    characterName: string;
    /** Scrolls the chat to a message and highlights it. */
    onJumpToMessage(index: number): void;
    /** Removes one attachment from a message. Chat images only. */
    onRemove?(messageIndex: number, attachmentIndex: number): void;
    onReuseSeed?(item: MediaAttachment): void;
}

/** Lists a character's image folder. */
function useCharacterImages(characterName: string, enabled: boolean) {
    return useQuery({
        queryKey: ['character-images', characterName],
        queryFn: () => apiPost<string[]>('/api/images/list', {
            folder: characterName,
            sortField: 'date',
            sortOrder: 'desc',
        }),
        enabled: enabled && Boolean(characterName),
        // Cheap to re-check, and a render made moments ago should show up.
        staleTime: 10_000,
    });
}

function Tile({
    attachment,
    caption,
    context,
    onOpen,
    actions,
}: {
    attachment: MediaAttachment;
    /** Shown under the tile. The prompt, when there is one. */
    caption: string;
    /** Who and when, for the tooltip. Identical across tiles in a 1:1 chat. */
    context?: string;
    onOpen(): void;
    actions?: React.ReactNode;
}) {
    const [failed, setFailed] = useState(false);

    return (
        <figure className="group/tile relative">
            <button
                type="button"
                onClick={onOpen}
                title={[caption, context].filter(Boolean).join('\n')}
                aria-label={caption ? `View ${caption}` : 'View image'}
                className={cn(
                    'block w-full cursor-zoom-in overflow-hidden rounded-lg border border-border',
                    'bg-surface-3 transition-colors hover:border-border-strong',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                )}
                // Square tiles: a contact sheet of mixed shapes is hard to
                // scan, and the lightbox is where the real proportions live.
                style={{ aspectRatio: '1' }}
            >
                {failed ? (
                    <span className="grid size-full place-items-center text-subtle">
                        <ImageOff className="size-5" />
                    </span>
                ) : (
                    <img
                        src={mediaUrl(attachment.url)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        onError={() => setFailed(true)}
                        className="size-full object-cover"
                    />
                )}
            </button>

            {actions ? (
                <div
                    className={cn(
                        'absolute right-1 top-1 flex gap-0.5',
                        'opacity-0 transition-opacity group-hover/tile:opacity-100',
                        'focus-within:opacity-100 max-sm:opacity-100',
                    )}
                >
                    {actions}
                </div>
            ) : null}

            {/* The prompt, not the sender and time: in a one-to-one chat those
                are identical on every tile and identify nothing. */}
            <figcaption className="mt-1 truncate text-[0.625rem] leading-tight text-subtle">
                {caption || context}
            </figcaption>
        </figure>
    );
}

export function ImagePanel({
    messages,
    characterName,
    onJumpToMessage,
    onRemove,
    onReuseSeed,
}: ImagePanelProps) {
    const [source, setSource] = useState<Source>('chat');
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

    const chatImages = useMemo(() => collectGalleryImages(messages), [messages]);
    const folder = useCharacterImages(characterName, source === 'character');

    const folderImages = useMemo(
        () => enrichFolderAttachments(characterName, folder.data ?? [], chatImages),
        [characterName, folder.data, chatImages],
    );

    const onChat = source === 'chat';
    // The lightbox steps through whichever list is showing.
    const lightboxItems = onChat ? chatImages.map((entry) => entry.attachment) : folderImages;

    const counts = {
        chat: chatImages.length,
        character: folder.data?.length ?? 0,
    };

    return (
        <div className="space-y-3">
            <SegmentedControl<Source>
                label="Image source"
                value={source}
                onValueChange={setSource}
                options={[
                    { value: 'chat', label: `This chat${counts.chat ? ` (${counts.chat})` : ''}` },
                    {
                        value: 'character',
                        label: characterName ? `All of ${characterName}` : 'All images',
                        title: 'Every render in this character’s image folder, from every chat',
                    },
                ]}
            />

            {onChat ? (
                chatImages.length === 0 ? (
                    <EmptyState
                        icon={<Images />}
                        title="No images in this chat"
                        description="Renders made here show up in this list, with a way back to the message they belong to."
                    />
                ) : (
                    <div className="grid grid-cols-2 gap-2">
                        {chatImages.map((entry) => (
                            <Tile
                                key={`${entry.messageIndex}:${entry.attachmentIndex}:${entry.attachment.url}`}
                                attachment={entry.attachment}
                                caption={entry.attachment.title ?? ''}
                                context={[entry.from, entry.sentAt ? relativeTime(entry.sentAt) : '']
                                    .filter(Boolean)
                                    .join(' · ')}
                                onOpen={() => setLightboxIndex(chatImages.indexOf(entry))}
                                actions={
                                    <>
                                        <Tooltip content="Go to this message">
                                            <IconButton
                                                label="Go to this message"
                                                size="icon-sm"
                                                variant="ghost"
                                                className="bg-black/45 text-white backdrop-blur-sm hover:bg-black/65 hover:text-white"
                                                onClick={() => onJumpToMessage(entry.messageIndex)}
                                            >
                                                <CornerUpLeft className="size-3.5" />
                                            </IconButton>
                                        </Tooltip>
                                        {onRemove ? (
                                            <Tooltip content="Remove from the message">
                                                <IconButton
                                                    label="Remove from the message"
                                                    size="icon-sm"
                                                    variant="ghost"
                                                    className="bg-black/45 text-white backdrop-blur-sm hover:bg-danger hover:text-white"
                                                    onClick={() =>
                                                        onRemove(entry.messageIndex, entry.attachmentIndex)}
                                                >
                                                    <Trash2 className="size-3.5" />
                                                </IconButton>
                                            </Tooltip>
                                        ) : null}
                                    </>
                                }
                            />
                        ))}
                    </div>
                )
            ) : folder.isPending ? (
                <div className="grid grid-cols-2 gap-2">
                    {[0, 1, 2, 3].map((row) => (
                        <Skeleton key={row} className="aspect-square rounded-lg" />
                    ))}
                </div>
            ) : folderImages.length === 0 ? (
                <EmptyState
                    icon={<Images />}
                    title="No images saved yet"
                    description="Renders are written to this character’s own folder, so they outlive the chat they were made in."
                />
            ) : (
                <div className="grid grid-cols-2 gap-2">
                    {folderImages.map((attachment, index) => (
                        <Tile
                            key={attachment.url}
                            attachment={attachment}
                            caption={attachment.title ?? ''}
                            onOpen={() => setLightboxIndex(index)}
                        />
                    ))}
                </div>
            )}

            {!onChat && folderImages.length > 0 ? (
                <p className="text-[0.625rem] leading-relaxed text-subtle">
                    Settings are shown for renders made in this chat. A file on its own carries no
                    seed or prompt — those live in the chat file it came from.
                </p>
            ) : null}

            <Lightbox
                items={lightboxItems}
                index={lightboxIndex}
                onIndexChange={setLightboxIndex}
                {...(onReuseSeed ? { onReuseSeed } : {})}
            />
        </div>
    );
}
