/**
 * Renders a message's attachments.
 *
 * The layout rules and their reasoning live in `media.ts`; this component is
 * the DOM side of them. Three things it does that the classic renderer does
 * not:
 *
 * - Reserves the box from the recorded pixel size, so a message never grows
 *   under the reader while an image loads.
 * - Lays several attachments out as a grid rather than a vertical stack, so a
 *   set of renders can be compared without scrolling.
 * - Shows a failed load as a frame with a reason, instead of a broken-image
 *   glyph with an empty `alt`.
 */

import { AlertTriangle, Expand, Images, Rows3, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { MediaAttachment } from '@/api/types';
import { IconButton } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { Lightbox } from './Lightbox';
import { mediaBox, mediaColumns, mediaUrl, type MediaDisplay } from './media';

export interface MessageMediaProps {
    items: MediaAttachment[];
    display: MediaDisplay;
    /** Selected attachment in gallery display. */
    selected: number;
    onSelect?(index: number): void;
    onDisplayChange?(display: MediaDisplay): void;
    onRemove?(index: number): void;
    onReuseSeed?(item: MediaAttachment): void;
    /**
     * Reports the pixel size of an attachment that did not record one, so the
     * box can be reserved the next time the chat is opened.
     */
    onMeasure?(index: number, size: { width: number; height: number }): void;
}

/** One framed attachment, with its box reserved. */
function MediaFigure({
    item,
    count,
    onOpen,
    onRemove,
    onMeasure,
}: {
    item: MediaAttachment;
    count: number;
    onOpen(): void;
    onRemove?(): void;
    onMeasure?(size: { width: number; height: number }): void;
}) {
    const [failed, setFailed] = useState(false);
    const box = mediaBox(item, count);
    const sized = Boolean(box.aspectRatio);

    return (
        <figure
            className="media-figure group/media"
            data-orientation={box.orientation}
            // A frame with no image and no recorded size has no height at all,
            // which would hide the reason for the failure. See theme.css.
            data-failed={failed}
            // The frame carries the border and background, so it has to end
            // where the image does rather than filling the grid cell.
            style={{ maxWidth: box.maxWidth }}
        >
            <button
                type="button"
                onClick={onOpen}
                className="media-frame cursor-zoom-in appearance-none border-0 p-0 text-left"
                style={{
                    aspectRatio: box.aspectRatio,
                    maxHeight: box.maxHeight,
                    // The width cap is what constrains the box; the ratio then
                    // derives a height inside the budget. See mediaBox().
                    width: '100%',
                    maxWidth: box.maxWidth,
                }}
                aria-label={item.title ? `View image: ${item.title}` : 'View image'}
            >
                <img
                    src={mediaUrl(item.url)}
                    alt={item.title ?? ''}
                    loading="lazy"
                    decoding="async"
                    onError={() => setFailed(true)}
                    onLoad={(event) => {
                        setFailed(false);
                        // An attachment written by the classic UI records no
                        // pixel size, so its box cannot be reserved and the
                        // message shifts as it loads. Report the natural size
                        // once and every later load of this chat is stable.
                        if (sized || !onMeasure) {
                            return;
                        }
                        const { naturalWidth, naturalHeight } = event.currentTarget;
                        if (naturalWidth > 0 && naturalHeight > 0) {
                            onMeasure({ width: naturalWidth, height: naturalHeight });
                        }
                    }}
                    className={cn(
                        'media-image',
                        !sized && 'media-image--unsized',
                        failed && 'media-image--failed',
                    )}
                    style={sized ? undefined : { maxHeight: box.maxHeight }}
                />
            </button>

            {failed ? (
                <div className="pointer-events-none absolute inset-0 grid place-items-center p-4 text-center">
                    <div className="flex flex-col items-center gap-1.5 text-xs text-muted">
                        <AlertTriangle className="size-5 text-warning" />
                        <span>This image is no longer on disk.</span>
                    </div>
                </div>
            ) : null}

            <div
                className={cn(
                    'absolute right-1.5 top-1.5 flex gap-1',
                    'opacity-0 transition-opacity group-hover/media:opacity-100',
                    'focus-within:opacity-100 max-sm:opacity-100',
                )}
            >
                <IconButton
                    label="View full size"
                    size="icon-sm"
                    variant="ghost"
                    className="bg-black/45 text-white backdrop-blur-sm hover:bg-black/65 hover:text-white"
                    onClick={onOpen}
                >
                    <Expand className="size-3.5" />
                </IconButton>
                {onRemove ? (
                    <IconButton
                        label="Remove image"
                        size="icon-sm"
                        variant="ghost"
                        className="bg-black/45 text-white backdrop-blur-sm hover:bg-danger hover:text-white"
                        onClick={onRemove}
                    >
                        <Trash2 className="size-3.5" />
                    </IconButton>
                ) : null}
            </div>
        </figure>
    );
}

export function MessageMedia({
    items,
    display,
    selected,
    onSelect,
    onDisplayChange,
    onRemove,
    onReuseSeed,
    onMeasure,
}: MessageMediaProps) {
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

    if (items.length === 0) {
        return null;
    }

    const gallery = display === 'gallery' && items.length > 1;
    const shown = gallery ? [items[Math.min(selected, items.length - 1)]!] : items;
    const columns = gallery ? 1 : mediaColumns(items.length);

    return (
        <div className="mt-2.5 space-y-2">
            {/* The column count is an attribute rather than a custom property
                so a media query can narrow a three-up sheet on a phone. */}
            <div className="media-grid" data-columns={columns}>
                {shown.map((item, position) => {
                    const index = gallery ? Math.min(selected, items.length - 1) : position;
                    return (
                        <MediaFigure
                            // The url is what identifies an attachment; the
                            // index shifts when one is removed.
                            key={`${item.url}:${index}`}
                            item={item}
                            count={shown.length}
                            onOpen={() => setLightboxIndex(index)}
                            {...(onRemove ? { onRemove: () => onRemove(index) } : {})}
                            {...(onMeasure
                                ? { onMeasure: (size: { width: number; height: number }) => onMeasure(index, size) }
                                : {})}
                        />
                    );
                })}
            </div>

            {items.length > 1 ? (
                <div className="flex items-center gap-2">
                    {gallery ? (
                        <div
                            className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1"
                            role="tablist"
                            aria-label="Renders in this message"
                        >
                            {items.map((item, index) => (
                                <button
                                    key={`${item.url}:${index}`}
                                    type="button"
                                    role="tab"
                                    className="media-thumb"
                                    aria-current={index === selected}
                                    aria-selected={index === selected}
                                    aria-label={`Render ${index + 1}${item.title ? `: ${item.title}` : ''}`}
                                    onClick={() => onSelect?.(index)}
                                >
                                    <img src={mediaUrl(item.url)} alt="" loading="lazy" />
                                </button>
                            ))}
                        </div>
                    ) : (
                        <span className="flex-1 text-[0.6875rem] text-subtle">
                            {items.length} images
                        </span>
                    )}

                    {onDisplayChange ? (
                        <IconButton
                            label={gallery ? 'Show all images at once' : 'Show one image at a time'}
                            size="icon-sm"
                            variant="ghost"
                            className="shrink-0"
                            onClick={() => onDisplayChange(gallery ? 'list' : 'gallery')}
                        >
                            {gallery ? <Rows3 className="size-4" /> : <Images className="size-4" />}
                        </IconButton>
                    ) : null}
                </div>
            ) : null}

            <Lightbox
                items={items}
                index={lightboxIndex}
                onIndexChange={setLightboxIndex}
                {...(onReuseSeed ? { onReuseSeed } : {})}
            />
        </div>
    );
}

/**
 * Placeholder shown while a render is in flight.
 *
 * Sized to the *requested* aspect ratio, so the finished image lands in the
 * space its own skeleton occupied — the layout settles once, before the
 * request is even sent, rather than twice.
 */
export function MediaPending({
    width,
    height,
    elapsedMs,
    onCancel,
}: {
    width: number;
    height: number;
    elapsedMs: number;
    onCancel?(): void;
}) {
    const box = mediaBox({ width, height });

    return (
        <div className="mt-2.5">
            <div
                className="media-pending skeleton"
                style={{
                    aspectRatio: box.aspectRatio,
                    maxHeight: box.maxHeight,
                    width: '100%',
                    maxWidth: box.maxWidth,
                }}
                role="status"
                aria-live="polite"
                aria-label="Generating an image"
            >
                <div className="flex flex-col items-center gap-2 px-4 text-center">
                    <span className="text-xs font-medium text-muted">Rendering…</span>
                    <span className="tabular-nums text-[0.6875rem] text-subtle">
                        {(elapsedMs / 1000).toFixed(0)}s · {width}×{height}
                    </span>
                    {onCancel ? (
                        <button
                            type="button"
                            onClick={onCancel}
                            className="rounded-md border border-border px-2 py-1 text-[0.6875rem] text-muted transition-colors hover:border-border-strong hover:text-text"
                        >
                            Cancel
                        </button>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
