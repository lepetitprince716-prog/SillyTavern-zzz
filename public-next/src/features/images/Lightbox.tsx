/**
 * Full-size image viewer.
 *
 * The classic UI opens a generated image in a generic popup at whatever size
 * fits, with no way to inspect detail — which is the one thing you want from a
 * render. This adds zoom and pan, keyboard navigation across the message's
 * attachments, and the settings that produced the image as selectable text.
 */

import { ChevronLeft, ChevronRight, Download, Info, Minus, Plus, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog as RadixDialog } from 'radix-ui';
import type { MediaAttachment } from '@/api/types';
import { IconButton } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { toast } from '@/lib/toast';
import { mediaUrl, metadataRows } from './media';

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.4;

export interface LightboxProps {
    items: MediaAttachment[];
    /** Index to open at. `null` closes the viewer. */
    index: number | null;
    onIndexChange(index: number | null): void;
    /** Offered when the attachment records a seed. */
    onReuseSeed?(item: MediaAttachment): void;
}

interface Transform {
    zoom: number;
    x: number;
    y: number;
}

const IDENTITY: Transform = { zoom: 1, x: 0, y: 0 };

export function Lightbox({ items, index, onIndexChange, onReuseSeed }: LightboxProps) {
    const open = index !== null;
    const item = index === null ? undefined : items[index];

    const [transform, setTransform] = useState<Transform>(IDENTITY);
    const [showInfo, setShowInfo] = useState(false);
    const [dragging, setDragging] = useState(false);
    const dragOrigin = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
    const stageRef = useRef<HTMLDivElement>(null);

    // A new image should not inherit the previous one's zoom and pan.
    const shownUrl = item?.url;
    const lastUrl = useRef(shownUrl);
    if (lastUrl.current !== shownUrl) {
        lastUrl.current = shownUrl;
        if (transform !== IDENTITY) {
            setTransform(IDENTITY);
        }
    }

    const rows = useMemo(() => (item ? metadataRows(item) : []), [item]);
    const zoomed = transform.zoom > MIN_ZOOM;

    const step = useCallback(
        (delta: 1 | -1) => {
            if (index === null || items.length < 2) {
                return;
            }
            const next = (index + delta + items.length) % items.length;
            onIndexChange(next);
        },
        [index, items.length, onIndexChange],
    );

    const zoomBy = useCallback((factor: number) => {
        setTransform((current) => {
            const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.zoom * factor));
            if (zoom === MIN_ZOOM) {
                return IDENTITY;
            }
            // Keep the visible centre put as the scale changes.
            const scale = zoom / current.zoom;
            return { zoom, x: current.x * scale, y: current.y * scale };
        });
    }, []);

    useEffect(() => {
        if (!open) {
            return;
        }
        const onKeyDown = (event: KeyboardEvent) => {
            switch (event.key) {
                case 'ArrowRight':
                    event.preventDefault();
                    step(1);
                    break;
                case 'ArrowLeft':
                    event.preventDefault();
                    step(-1);
                    break;
                case '+':
                case '=':
                    event.preventDefault();
                    zoomBy(ZOOM_STEP);
                    break;
                case '-':
                    event.preventDefault();
                    zoomBy(1 / ZOOM_STEP);
                    break;
                case '0':
                    event.preventDefault();
                    setTransform(IDENTITY);
                    break;
                case 'i':
                    setShowInfo((value) => !value);
                    break;
                default:
                    break;
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, step, zoomBy]);

    const onWheel = (event: React.WheelEvent) => {
        event.preventDefault();
        zoomBy(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    };

    const onPointerDown = (event: React.PointerEvent) => {
        if (!zoomed) {
            return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        dragOrigin.current = {
            x: event.clientX,
            y: event.clientY,
            startX: transform.x,
            startY: transform.y,
        };
        setDragging(true);
    };

    const onPointerMove = (event: React.PointerEvent) => {
        const origin = dragOrigin.current;
        if (!origin) {
            return;
        }
        setTransform((current) => ({
            ...current,
            x: origin.startX + (event.clientX - origin.x),
            y: origin.startY + (event.clientY - origin.y),
        }));
    };

    const endDrag = () => {
        dragOrigin.current = null;
        setDragging(false);
    };

    const copyRow = async (row: { label: string; value: string }) => {
        try {
            await navigator.clipboard.writeText(row.value);
            toast.success(`${row.label} copied`);
        } catch {
            toast.error('Could not copy', 'The clipboard is unavailable in this context.');
        }
    };

    if (!item) {
        return null;
    }

    const source = mediaUrl(item.url);

    return (
        <RadixDialog.Root open={open} onOpenChange={(next) => !next && onIndexChange(null)}>
            <RadixDialog.Portal>
                <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm" />
                <RadixDialog.Content
                    className="fixed inset-0 z-50 flex flex-col outline-none"
                    // Arrow keys and +/- are handled globally above; letting
                    // Radix move focus into the stage would swallow them.
                    onOpenAutoFocus={(event) => event.preventDefault()}
                >
                    <RadixDialog.Title className="sr-only">
                        {item.title || 'Generated image'}
                    </RadixDialog.Title>

                    <header className="flex items-center gap-1 px-3 py-2 text-white/90">
                        <span className="min-w-0 flex-1 truncate text-xs">
                            {items.length > 1 ? (
                                <span className="mr-2 tabular-nums text-white/60">
                                    {(index ?? 0) + 1} / {items.length}
                                </span>
                            ) : null}
                            {item.title}
                        </span>
                        <span className="shrink-0 tabular-nums text-[0.6875rem] text-white/50">
                            {Math.round(transform.zoom * 100)}%
                        </span>
                        <IconButton
                            label="Zoom out"
                            variant="ghost"
                            size="icon-sm"
                            className="text-white/80 hover:bg-white/10 hover:text-white"
                            disabled={!zoomed}
                            onClick={() => zoomBy(1 / ZOOM_STEP)}
                        >
                            <Minus className="size-4" />
                        </IconButton>
                        <IconButton
                            label="Zoom in"
                            variant="ghost"
                            size="icon-sm"
                            className="text-white/80 hover:bg-white/10 hover:text-white"
                            onClick={() => zoomBy(ZOOM_STEP)}
                        >
                            <Plus className="size-4" />
                        </IconButton>
                        <IconButton
                            label="Reset zoom"
                            variant="ghost"
                            size="icon-sm"
                            className="text-white/80 hover:bg-white/10 hover:text-white"
                            disabled={!zoomed}
                            onClick={() => setTransform(IDENTITY)}
                        >
                            <RotateCcw className="size-4" />
                        </IconButton>
                        <IconButton
                            label={showInfo ? 'Hide details' : 'Show details'}
                            variant="ghost"
                            size="icon-sm"
                            className={cn(
                                'text-white/80 hover:bg-white/10 hover:text-white',
                                showInfo && 'bg-white/15 text-white',
                            )}
                            onClick={() => setShowInfo((value) => !value)}
                        >
                            <Info className="size-4" />
                        </IconButton>
                        <a
                            href={source}
                            download
                            aria-label="Download image"
                            title="Download image"
                            className="grid size-8 place-items-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                        >
                            <Download className="size-4" />
                        </a>
                        <RadixDialog.Close asChild>
                            <IconButton
                                label="Close"
                                variant="ghost"
                                size="icon-sm"
                                className="text-white/80 hover:bg-white/10 hover:text-white"
                            >
                                <X className="size-4" />
                            </IconButton>
                        </RadixDialog.Close>
                    </header>

                    <div className="relative flex min-h-0 flex-1">
                        <div
                            ref={stageRef}
                            className="lightbox-stage"
                            data-zoomed={zoomed}
                            data-dragging={dragging}
                            onWheel={onWheel}
                            onPointerDown={onPointerDown}
                            onPointerMove={onPointerMove}
                            onPointerUp={endDrag}
                            onPointerCancel={endDrag}
                            onDoubleClick={() => (zoomed ? setTransform(IDENTITY) : zoomBy(2.5))}
                        >
                            <img
                                src={source}
                                alt={item.title || 'Generated image'}
                                className="lightbox-image"
                                draggable={false}
                                style={{
                                    transform: `translate(-50%, -50%) translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
                                    maxHeight: '100%',
                                    maxWidth: '100%',
                                    // At 1x the image is letterboxed into the
                                    // stage; zoomed in it may exceed it, which
                                    // is what makes panning meaningful.
                                    objectFit: 'contain',
                                }}
                            />

                            {items.length > 1 ? (
                                <>
                                    <IconButton
                                        label="Previous image"
                                        variant="ghost"
                                        size="icon"
                                        className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/40 text-white hover:bg-black/60"
                                        onClick={() => step(-1)}
                                    >
                                        <ChevronLeft className="size-5" />
                                    </IconButton>
                                    <IconButton
                                        label="Next image"
                                        variant="ghost"
                                        size="icon"
                                        className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/40 text-white hover:bg-black/60"
                                        onClick={() => step(1)}
                                    >
                                        <ChevronRight className="size-5" />
                                    </IconButton>
                                </>
                            ) : null}
                        </div>

                        {showInfo ? (
                            <aside className="w-full max-w-xs shrink-0 overflow-y-auto border-l border-white/10 bg-black/60 p-4 text-white max-sm:absolute max-sm:inset-y-0 max-sm:right-0 max-sm:max-w-[85%]">
                                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/50">
                                    How this was made
                                </h2>
                                {rows.length === 0 ? (
                                    <p className="text-xs text-white/50">
                                        No generation settings were recorded for this image.
                                    </p>
                                ) : (
                                    <dl className="space-y-2.5 text-xs">
                                        {rows.map((row) => (
                                            <div key={row.label} className={row.wide ? '' : 'flex gap-2'}>
                                                <dt className="shrink-0 text-white/50">{row.label}</dt>
                                                <dd
                                                    className={cn(
                                                        'min-w-0 select-text break-words',
                                                        row.wide && 'mt-0.5 leading-relaxed',
                                                        !row.wide && 'ml-auto text-right tabular-nums',
                                                    )}
                                                >
                                                    {row.value}
                                                </dd>
                                            </div>
                                        ))}
                                    </dl>
                                )}
                                <div className="mt-4 flex flex-wrap gap-2">
                                    {item.title ? (
                                        <button
                                            type="button"
                                            onClick={() => void copyRow({ label: 'Prompt', value: item.title ?? '' })}
                                            className="rounded-md border border-white/20 px-2 py-1 text-[0.6875rem] text-white/80 transition-colors hover:bg-white/10"
                                        >
                                            Copy prompt
                                        </button>
                                    ) : null}
                                    {typeof item.seed === 'number' && onReuseSeed ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onReuseSeed(item);
                                                onIndexChange(null);
                                            }}
                                            className="rounded-md border border-white/20 px-2 py-1 text-[0.6875rem] text-white/80 transition-colors hover:bg-white/10"
                                        >
                                            Reuse these settings
                                        </button>
                                    ) : null}
                                </div>
                            </aside>
                        ) : null}
                    </div>
                </RadixDialog.Content>
            </RadixDialog.Portal>
        </RadixDialog.Root>
    );
}
