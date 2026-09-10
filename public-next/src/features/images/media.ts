/**
 * Layout rules for message media.
 *
 * The classic renderer sizes every attachment with one blunt rule:
 *
 *     .mes_img { max-width: 100%; max-height: 40vh; }
 *
 * which has three consequences worth fixing.
 *
 * 1. A portrait render loses. NovelAI's default is 832×1216; capped at 40vh
 *    that image is also capped at 27vw of width, so the subject of the picture
 *    ends up smaller than a landscape screenshot of the same pixel count. The
 *    cap has to depend on the shape of the image, not just its height.
 * 2. The box is not reserved. The image's size is unknown until it loads, so
 *    the message grows underneath the reader and the scroll position jumps.
 *    The classic UI works around this by measuring `scrollHeight` before and
 *    after every load and correcting afterwards; reserving the box with
 *    `aspect-ratio` means there is nothing to correct.
 * 3. Several attachments stack vertically at full size, so a message with four
 *    renders is four screens tall and comparing them means scrolling.
 *
 * Everything here is a pure function of the attachment and the count, so the
 * rules can be tested without a DOM.
 */

import type { ChatMessage, ChatMessageExtra, MediaAttachment, MediaLayout } from '@/api/types';

/** Ratios below this read as portrait, above as landscape. */
const PORTRAIT_MAX_RATIO = 0.85;
const LANDSCAPE_MIN_RATIO = 1.2;

export type MediaOrientation = 'portrait' | 'square' | 'landscape' | 'unknown';

export type MediaDisplay = 'list' | 'gallery';

/**
 * Height budget per orientation.
 *
 * `svh` rather than `vh`: on mobile browsers `vh` is the height *without* the
 * retracted toolbar, so a `vh` cap clips whenever the toolbar is showing.
 * Each budget is also capped in `rem` so the image stops growing on a very
 * tall monitor instead of turning the message into a poster.
 */
const HEIGHT_BUDGET: Record<MediaOrientation, string> = {
    // Tall images get the largest share: height is where their detail lives.
    portrait: 'min(68svh, 40rem)',
    square: 'min(54svh, 32rem)',
    // Wide images are limited by the column width long before height matters.
    landscape: 'min(46svh, 30rem)',
    unknown: 'min(54svh, 32rem)',
};

/** Aspect ratio of an attachment, or null when its size is not recorded. */
export function aspectRatioOf(item: Pick<MediaAttachment, 'width' | 'height'>): number | null {
    const { width, height } = item;
    if (!width || !height || width <= 0 || height <= 0) {
        return null;
    }
    return width / height;
}

export function orientationOf(ratio: number | null): MediaOrientation {
    if (ratio === null || !Number.isFinite(ratio)) {
        return 'unknown';
    }
    if (ratio <= PORTRAIT_MAX_RATIO) {
        return 'portrait';
    }
    if (ratio >= LANDSCAPE_MIN_RATIO) {
        return 'landscape';
    }
    return 'square';
}

/** The presentation box for one attachment. */
export interface MediaBox {
    /** `aspect-ratio` value, or undefined when the size is unknown. */
    aspectRatio: string | undefined;
    orientation: MediaOrientation;
    /** `max-height`, chosen from the orientation budget. */
    maxHeight: string;
    /**
     * `max-width`. For a sized attachment this is the height budget converted
     * through the aspect ratio, which is what actually constrains the box.
     *
     * `max-height` alone does not: an element with `aspect-ratio` and no
     * definite height still takes its width from its container, so the height
     * clamps at the budget while the width stays at full column — leaving a
     * portrait render in a box wider than itself, with a band of empty frame
     * beside it. Capping the width instead makes the used width
     * `min(column, budget × ratio)` and lets `aspect-ratio` derive a height
     * that is within budget by construction.
     */
    maxWidth: string;
}

/** At this many attachments the message becomes a contact sheet. */
const CONTACT_SHEET_FROM = 3;

/** Height budget for a pair sharing a row. */
const PAIRED_BUDGET = 'min(38svh, 22rem)';

/**
 * Sizes one attachment.
 *
 * @param item The attachment, whose recorded size drives the shape.
 * @param count How many attachments share the message. A pair keeps each
 * image's own shape, because two renders are almost always variations being
 * compared. Three or more become a uniform square contact sheet: a ragged row
 * of mixed shapes is hard to scan, and the lightbox is where an image's real
 * proportions get seen.
 */
export function mediaBox(item: Pick<MediaAttachment, 'width' | 'height'>, count = 1): MediaBox {
    const ratio = aspectRatioOf(item);
    const orientation = orientationOf(ratio);

    if (count >= CONTACT_SHEET_FROM) {
        return {
            // Square by intent, not by inheriting the first image's shape. The
            // cell height follows from the column width, so no cap is needed.
            aspectRatio: '1 / 1',
            orientation,
            maxHeight: 'none',
            maxWidth: '100%',
        };
    }

    // Sharing a row already limits the height through the width, so a shared
    // budget only needs to stop one tall image from dominating the row.
    const budget = count > 1 ? PAIRED_BUDGET : HEIGHT_BUDGET[orientation];

    return {
        aspectRatio: item.width && item.height ? `${item.width} / ${item.height}` : undefined,
        orientation,
        maxHeight: budget,
        maxWidth: ratio === null ? '100%' : `min(100%, calc(${budget} * ${ratio.toFixed(4)}))`,
    };
}

/**
 * How many columns a set of attachments should occupy.
 *
 * One image gets the full column. Two sit side by side, which is the
 * comparison a pair of renders is almost always for. Three or four stay
 * two-up so each is still large enough to judge; five or more go three-up,
 * narrowing to two on a phone (see `.media-grid` in theme.css).
 */
export function mediaColumns(count: number): number {
    if (count <= 1) {
        return 1;
    }
    if (count <= 4) {
        return 2;
    }
    return 3;
}

/** Reads the display mode, clamped to something renderable. */
export function mediaDisplay(extra: ChatMessageExtra | undefined): MediaDisplay {
    return extra?.media_display === 'gallery' ? 'gallery' : 'list';
}

/** Reads the selected gallery index, clamped into range. */
export function mediaIndex(extra: ChatMessageExtra | undefined): number {
    const media = extra?.media;
    if (!Array.isArray(media) || media.length === 0) {
        return 0;
    }
    const value = Number(extra?.media_index);
    if (!Number.isInteger(value) || value < 0 || value >= media.length) {
        return 0;
    }
    return value;
}

/**
 * Reads the layout, falling back to the classic `inline_image` boolean.
 *
 * A message written by the classic UI or by an older version of this one has
 * no `media_layout`, so `inline_image === false` — its only way of saying
 * "the image replaces the text" — maps onto `cover`.
 */
export function mediaLayout(extra: ChatMessageExtra | undefined): MediaLayout {
    const explicit = extra?.media_layout;
    if (explicit === 'inline' || explicit === 'caption' || explicit === 'cover') {
        return explicit;
    }
    return extra?.inline_image === false ? 'cover' : 'inline';
}

/**
 * The `inline_image` value that goes with a layout.
 *
 * Written alongside `media_layout` so the same message still behaves sensibly
 * in the classic UI, which only understands the boolean.
 */
export function inlineImageFor(layout: MediaLayout): boolean {
    return layout !== 'cover';
}

/** Attachments of a message, normalised to an array. */
export function messageMedia(message: Pick<ChatMessage, 'extra'> | undefined): MediaAttachment[] {
    const media = message?.extra?.media;
    if (!Array.isArray(media)) {
        return [];
    }
    return media.filter((item): item is MediaAttachment => Boolean(item && typeof item.url === 'string'));
}

/** One row of the metadata panel. */
export interface MetadataRow {
    label: string;
    value: string;
    /** Long free text gets its own full-width row and stays selectable. */
    wide?: boolean;
}

const PROVIDER_LABELS: Record<string, string> = {
    novelai: 'NovelAI',
    comfyui: 'ComfyUI',
};

/**
 * Describes how a render was made.
 *
 * The classic UI puts the prompt in a `title` attribute, which is invisible on
 * touch, unselectable, and cannot hold the rest of the settings at all. These
 * rows are rendered as real text so they can be read, selected and copied.
 */
export function metadataRows(item: MediaAttachment): MetadataRow[] {
    const rows: MetadataRow[] = [];

    if (item.title) {
        rows.push({ label: 'Prompt', value: item.title, wide: true });
    }
    if (item.negative) {
        rows.push({ label: 'Negative', value: item.negative, wide: true });
    }
    if (item.provider) {
        rows.push({ label: 'Provider', value: PROVIDER_LABELS[item.provider] ?? item.provider });
    }
    if (item.model) {
        rows.push({ label: 'Model', value: item.model });
    }
    if (item.workflow) {
        rows.push({ label: 'Workflow', value: item.workflow.replace(/\.json$/i, '') });
    }
    if (typeof item.seed === 'number' && Number.isFinite(item.seed)) {
        rows.push({ label: 'Seed', value: String(item.seed) });
    }
    if (item.width && item.height) {
        rows.push({ label: 'Size', value: `${item.width} × ${item.height}` });
    }
    if (typeof item.steps === 'number') {
        rows.push({ label: 'Steps', value: String(item.steps) });
    }
    if (typeof item.cfgScale === 'number') {
        rows.push({ label: 'CFG', value: String(item.cfgScale) });
    }
    if (item.sampler) {
        rows.push({ label: 'Sampler', value: item.sampler });
    }
    if (typeof item.durationMs === 'number' && item.durationMs > 0) {
        rows.push({ label: 'Took', value: `${(item.durationMs / 1000).toFixed(1)}s` });
    }

    return rows;
}

/**
 * A readable, unique file name for a render.
 *
 * The classic UI names generated files after `Date.now()`, so a folder of
 * renders is a wall of timestamps. Leading with a slug of the prompt makes the
 * gallery browsable, and the timestamp still guarantees uniqueness.
 */
export function imageFileName(prompt: string, seed?: number, now = Date.now()): string {
    const slug = prompt
        .toLowerCase()
        // Keep CJK and other letters; only punctuation and spacing collapse.
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48)
        .replace(/-+$/g, '');
    const parts = [slug || 'image', String(now)];
    if (typeof seed === 'number' && Number.isFinite(seed) && seed >= 0) {
        parts.push(`s${seed}`);
    }
    return parts.join('_');
}

/**
 * Resolves an attachment URL for the browser.
 *
 * The server returns paths relative to the user data root, which the classic
 * UI serves from `/`. This frontend is mounted at `/next/`, so a bare relative
 * path would resolve against that prefix and 404.
 */
export function mediaUrl(url: string): string {
    if (/^(?:https?:|data:|blob:|\/)/i.test(url)) {
        return url;
    }
    return `/${url}`;
}
