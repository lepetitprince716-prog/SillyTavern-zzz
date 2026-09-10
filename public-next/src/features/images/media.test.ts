import { describe, expect, it } from 'vitest';
import type { ChatMessageExtra, MediaAttachment } from '@/api/types';
import {
    aspectRatioOf,
    imageFileName,
    inlineImageFor,
    mediaBox,
    mediaColumns,
    mediaDisplay,
    mediaIndex,
    mediaLayout,
    mediaUrl,
    messageMedia,
    metadataRows,
    orientationOf,
} from './media';

function image(patch: Partial<MediaAttachment> = {}): MediaAttachment {
    return { url: '/user/images/x.png', type: 'image', ...patch };
}

describe('aspectRatioOf', () => {
    it('divides width by height', () => {
        expect(aspectRatioOf({ width: 1024, height: 512 })).toBe(2);
    });

    it('is null when the size is unknown', () => {
        expect(aspectRatioOf({})).toBeNull();
        expect(aspectRatioOf({ width: 512 })).toBeNull();
        expect(aspectRatioOf({ width: 512, height: 0 })).toBeNull();
        expect(aspectRatioOf({ width: -512, height: 512 })).toBeNull();
    });
});

describe('orientationOf', () => {
    it('classifies the NovelAI defaults', () => {
        // 832x1216 portrait and 1216x832 landscape.
        expect(orientationOf(832 / 1216)).toBe('portrait');
        expect(orientationOf(1216 / 832)).toBe('landscape');
        expect(orientationOf(1)).toBe('square');
    });

    it('treats a near-square image as square', () => {
        expect(orientationOf(1024 / 960)).toBe('square');
        expect(orientationOf(960 / 1024)).toBe('square');
    });

    it('is unknown without a ratio', () => {
        expect(orientationOf(null)).toBe('unknown');
        expect(orientationOf(Number.NaN)).toBe('unknown');
    });
});

describe('mediaBox', () => {
    it('reserves the box so the message does not grow under the reader', () => {
        expect(mediaBox(image({ width: 832, height: 1216 })).aspectRatio).toBe('832 / 1216');
    });

    it('leaves the ratio undefined when the size was never recorded', () => {
        expect(mediaBox(image()).aspectRatio).toBeUndefined();
    });

    it('gives a portrait render more height than a landscape one', () => {
        const portrait = mediaBox(image({ width: 832, height: 1216 }));
        const landscape = mediaBox(image({ width: 1216, height: 832 }));
        expect(portrait.orientation).toBe('portrait');
        expect(landscape.orientation).toBe('landscape');
        // The classic renderer caps both at 40vh, which is what squashes the
        // portrait one; the budgets have to differ for that to be fixed.
        expect(portrait.maxHeight).not.toBe(landscape.maxHeight);
    });

    it('caps the width at the height budget through the ratio', () => {
        // `max-height` alone leaves the box at full column width, so the frame
        // ends up wider than the image inside it. The width has to be the
        // capped dimension.
        const portrait = mediaBox(image({ width: 832, height: 1216 }));
        expect(portrait.maxWidth).toBe('min(100%, calc(min(68svh, 40rem) * 0.6842))');
        const landscape = mediaBox(image({ width: 1216, height: 832 }));
        expect(landscape.maxWidth).toBe('min(100%, calc(min(46svh, 30rem) * 1.4615))');
    });

    it('falls back to the full width when the size is unknown', () => {
        expect(mediaBox(image()).maxWidth).toBe('100%');
    });

    it('derives the width cap from the shared budget in a row', () => {
        const paired = mediaBox(image({ width: 832, height: 1216 }), 2);
        expect(paired.maxWidth).toContain(paired.maxHeight);
    });

    it('shrinks the budget once attachments share a row', () => {
        const alone = mediaBox(image({ width: 832, height: 1216 }), 1);
        const paired = mediaBox(image({ width: 832, height: 1216 }), 2);
        expect(paired.maxHeight).not.toBe(alone.maxHeight);
        expect(paired.maxWidth).not.toBe(alone.maxWidth);
    });

    it('makes a contact sheet of uniform square cells past two images', () => {
        const portrait = mediaBox(image({ width: 832, height: 1216 }), 3);
        const landscape = mediaBox(image({ width: 1216, height: 832 }), 3);
        // Square by intent. Inheriting the first image's shape would crop
        // every other image in the sheet to it.
        expect(portrait.aspectRatio).toBe('1 / 1');
        expect(landscape.aspectRatio).toBe('1 / 1');
        expect(portrait.maxWidth).toBe('100%');
        // The cell height follows from the column width, so no cap applies.
        expect(portrait.maxHeight).toBe('none');
    });

    it('keeps each shape when only two images share the row', () => {
        const portrait = mediaBox(image({ width: 832, height: 1216 }), 2);
        const landscape = mediaBox(image({ width: 1216, height: 832 }), 2);
        // Two renders are variations being compared; cropping them to a
        // common cell defeats the comparison.
        expect(portrait.aspectRatio).toBe('832 / 1216');
        expect(landscape.aspectRatio).toBe('1216 / 832');
        expect(portrait.maxWidth).not.toBe(landscape.maxWidth);
    });

    it('still reports the orientation inside a contact sheet', () => {
        // The cell is square, but the metadata is about the image.
        expect(mediaBox(image({ width: 1216, height: 832 }), 5).orientation).toBe('landscape');
    });
});

describe('mediaColumns', () => {
    it('gives a lone image the whole column', () => {
        expect(mediaColumns(0)).toBe(1);
        expect(mediaColumns(1)).toBe(1);
    });

    it('pairs two up so they can be compared', () => {
        expect(mediaColumns(2)).toBe(2);
    });

    it('keeps three or four two-up, so each is still large enough to judge', () => {
        expect(mediaColumns(3)).toBe(2);
        expect(mediaColumns(4)).toBe(2);
    });

    it('goes three-up past four', () => {
        expect(mediaColumns(5)).toBe(3);
        expect(mediaColumns(12)).toBe(3);
    });
});

describe('mediaDisplay', () => {
    it('defaults to a list', () => {
        expect(mediaDisplay(undefined)).toBe('list');
        expect(mediaDisplay({})).toBe('list');
    });

    it('reads the gallery mode the classic UI writes', () => {
        expect(mediaDisplay({ media_display: 'gallery' })).toBe('gallery');
    });

    it('rejects a value it cannot render', () => {
        // A chat file written by an extension can carry anything at all here.
        expect(mediaDisplay({ media_display: 'carousel' } as unknown as ChatMessageExtra)).toBe('list');
    });
});

describe('mediaIndex', () => {
    const media = [image(), image(), image()];

    it('is zero without media', () => {
        expect(mediaIndex(undefined)).toBe(0);
        expect(mediaIndex({ media: [] })).toBe(0);
    });

    it('reads a valid index', () => {
        expect(mediaIndex({ media, media_index: 2 })).toBe(2);
    });

    it('clamps an index past the end, which a deleted attachment leaves behind', () => {
        expect(mediaIndex({ media, media_index: 7 })).toBe(0);
        expect(mediaIndex({ media, media_index: -1 })).toBe(0);
        expect(mediaIndex({ media, media_index: 1.5 })).toBe(0);
    });
});

describe('mediaLayout', () => {
    it('defaults to showing the image with the text', () => {
        expect(mediaLayout(undefined)).toBe('inline');
        expect(mediaLayout({})).toBe('inline');
    });

    it('reads the explicit layout', () => {
        expect(mediaLayout({ media_layout: 'caption' })).toBe('caption');
        expect(mediaLayout({ media_layout: 'cover' })).toBe('cover');
    });

    it('maps the classic inline_image boolean onto a layout', () => {
        // The classic UI's only way of saying "the image replaces the text".
        expect(mediaLayout({ inline_image: false })).toBe('cover');
        expect(mediaLayout({ inline_image: true })).toBe('inline');
    });

    it('prefers the explicit layout over the boolean', () => {
        expect(mediaLayout({ media_layout: 'caption', inline_image: false })).toBe('caption');
    });

    it('round-trips through the boolean the classic UI understands', () => {
        for (const layout of ['inline', 'caption', 'cover'] as const) {
            const extra: ChatMessageExtra = { media_layout: layout, inline_image: inlineImageFor(layout) };
            expect(mediaLayout(extra)).toBe(layout);
        }
        // Only `cover` hides the text, matching what the classic UI does.
        expect(inlineImageFor('cover')).toBe(false);
        expect(inlineImageFor('inline')).toBe(true);
        expect(inlineImageFor('caption')).toBe(true);
    });
});

describe('messageMedia', () => {
    it('is empty for a message without media', () => {
        expect(messageMedia(undefined)).toEqual([]);
        expect(messageMedia({ extra: {} })).toEqual([]);
    });

    it('drops entries with no url instead of rendering a broken image', () => {
        const media = [image(), { type: 'image' } as MediaAttachment, null as unknown as MediaAttachment];
        expect(messageMedia({ extra: { media } })).toHaveLength(1);
    });
});

describe('metadataRows', () => {
    it('is empty for an attachment with no recorded settings', () => {
        expect(metadataRows(image())).toEqual([]);
    });

    it('reports the seed, so a render can be reproduced', () => {
        const rows = metadataRows(image({ seed: 12345 }));
        expect(rows).toContainEqual({ label: 'Seed', value: '12345' });
    });

    it('keeps a seed of zero, which is a real seed', () => {
        expect(metadataRows(image({ seed: 0 }))).toContainEqual({ label: 'Seed', value: '0' });
    });

    it('gives the prompt a full-width row so it stays readable', () => {
        const rows = metadataRows(image({ title: 'a cat, oil painting' }));
        expect(rows[0]).toEqual({ label: 'Prompt', value: 'a cat, oil painting', wide: true });
    });

    it('names the providers properly', () => {
        expect(metadataRows(image({ provider: 'comfyui' }))).toContainEqual({
            label: 'Provider',
            value: 'ComfyUI',
        });
        expect(metadataRows(image({ provider: 'novelai' }))).toContainEqual({
            label: 'Provider',
            value: 'NovelAI',
        });
    });

    it('passes an unknown provider through rather than dropping it', () => {
        expect(metadataRows(image({ provider: 'sdnext' }))).toContainEqual({
            label: 'Provider',
            value: 'sdnext',
        });
    });

    it('trims the workflow extension', () => {
        expect(metadataRows(image({ workflow: 'Default_Comfy_Workflow.json' }))).toContainEqual({
            label: 'Workflow',
            value: 'Default_Comfy_Workflow',
        });
    });

    it('formats the duration in seconds', () => {
        expect(metadataRows(image({ durationMs: 8420 }))).toContainEqual({ label: 'Took', value: '8.4s' });
    });
});

describe('imageFileName', () => {
    it('leads with a slug of the prompt so the gallery is browsable', () => {
        expect(imageFileName('A cat, oil painting!', 42, 1700000000000)).toBe(
            'a-cat-oil-painting_1700000000000_s42',
        );
    });

    it('never emits a dot, which the server would read as an extension', () => {
        expect(imageFileName('shot at f/1.8', 1, 1700000000000)).not.toContain('.');
    });

    it('keeps non-latin prompts instead of reducing them to nothing', () => {
        expect(imageFileName('橙色的狐狸', 7, 1700000000000)).toBe('橙色的狐狸_1700000000000_s7');
    });

    it('falls back to a fixed stem for a prompt with no usable characters', () => {
        expect(imageFileName('!!! ???', undefined, 1700000000000)).toBe('image_1700000000000');
    });

    it('omits a seed it cannot use', () => {
        expect(imageFileName('cat', -1, 1700000000000)).toBe('cat_1700000000000');
        expect(imageFileName('cat', Number.NaN, 1700000000000)).toBe('cat_1700000000000');
    });

    it('bounds the slug so the name stays a legal file name', () => {
        const name = imageFileName('word '.repeat(60), 1, 1700000000000);
        const [slug] = name.split('_');
        expect(slug!.length).toBeLessThanOrEqual(48);
        expect(slug!.endsWith('-')).toBe(false);
    });
});

describe('mediaUrl', () => {
    it('leaves an absolute path alone', () => {
        expect(mediaUrl('/user/images/a.png')).toBe('/user/images/a.png');
    });

    it('roots a relative path, which would otherwise resolve under /next/', () => {
        expect(mediaUrl('user/images/a.png')).toBe('/user/images/a.png');
    });

    it('leaves other schemes alone', () => {
        expect(mediaUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
        expect(mediaUrl('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
        expect(mediaUrl('blob:http://localhost/abc')).toBe('blob:http://localhost/abc');
    });
});
