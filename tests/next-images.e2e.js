import { test, expect } from '@playwright/test';

/**
 * Image generation in the modern frontend.
 *
 * Needs a built bundle (`npm run next:build`), a running server, and a ComfyUI
 * stand-in on 127.0.0.1:8188 answering /system_stats, /prompt,
 * /history/{id} and /view — `tests/util/mock-comfy.mjs`.
 *
 * The assertions that matter are geometric: a render's box has to be reserved
 * at the right shape *before* the bytes arrive, which is what stops the
 * message from growing under the reader. The classic renderer instead measures
 * scrollHeight before and after each load and corrects the scroll position
 * afterwards.
 */

const COMFY_URL = 'http://127.0.0.1:8188';

const AVATAR = 'default_Seraphina.png';

/** 832×1216 — NovelAI's portrait default, and the shape most renders use. */
const PORTRAIT_RATIO = 832 / 1216;

/**
 * Opens a chat of this test's own, by navigating to an id nothing else uses.
 *
 * Clicking through the character list lands in whichever chat is *newest*,
 * which is server state shared by every worker: another spec creating a chat
 * between the click and the render steals the one this test is asserting on.
 * A chat file that does not exist yet is simply an empty chat.
 */
async function freshChat(page, request, testInfo) {
    const chatId = `e2e-images-${testInfo.testId}`;

    // Seeded with one message rather than left empty: an image is attached to
    // a message, so an empty chat has nothing to illustrate.
    const token = await (await request.get('/csrf-token')).json();
    const response = await request.post('/api/chats/save', {
        headers: { 'X-CSRF-Token': token.token },
        data: {
            ch_name: 'Seraphina',
            file_name: chatId,
            avatar_url: AVATAR,
            force: true,
            chat: [
                {
                    user_name: 'User',
                    character_name: 'Seraphina',
                    create_date: '2026-09-10@05h00m00s',
                    chat_metadata: {},
                },
                {
                    name: 'Seraphina',
                    is_user: false,
                    send_date: '2026-09-10 @05h 00m 00s 000ms',
                    mes: 'She looks up as you arrive.',
                },
            ],
        },
    });
    expect(response.ok()).toBeTruthy();

    await page.goto(`/next/chat/${encodeURIComponent(AVATAR)}/${encodeURIComponent(chatId)}`);
    await expect(page.locator('textarea[aria-label="Message"]')).toBeVisible();
    await expect(page.locator('article').first()).toBeVisible();
    return chatId;
}

/** Fills in the ComfyUI provider and prompt, then renders. */
async function render(page, prompt, { preset = 'Portrait 832×1216' } = {}) {
    await page.getByLabel('Image provider').click();
    await page.getByRole('option', { name: /ComfyUI/ }).click();
    await page.getByLabel('ComfyUI server URL').fill(COMFY_URL);
    await page.getByLabel('Image prompt').fill(prompt);
    await page.getByRole('button', { name: preset }).click();
    await page.getByRole('button', { name: 'Render', exact: true }).click();
}

test.describe('image generation', () => {
    test('reserves the box at the render\'s own shape before it loads', async ({ page, request }, testInfo) => {
        await freshChat(page, request, testInfo);
        await page.getByRole('button', { name: 'Generate an image' }).click();
        await render(page, 'a fox girl with orange hair');

        // The placeholder stands in at the requested aspect ratio, so the
        // finished image lands in the space its own skeleton occupied.
        const pending = page.locator('.media-pending');
        await expect(pending).toBeVisible();
        const pendingBox = await pending.boundingBox();
        expect(pendingBox.width / pendingBox.height).toBeCloseTo(PORTRAIT_RATIO, 2);

        const figure = page.locator('.media-figure').first();
        await expect(figure.locator('img')).toBeVisible({ timeout: 30000 });

        // The frame carries the border and background, so it has to end where
        // the image does — a frame at full column width leaves a visible band
        // beside a portrait render.
        const figureBox = await figure.boundingBox();
        expect(figureBox.width / figureBox.height).toBeCloseTo(PORTRAIT_RATIO, 2);
        expect(Math.abs(figureBox.width - pendingBox.width)).toBeLessThan(2);
        await expect(figure).toHaveAttribute('data-orientation', 'portrait');

        // The legacy sharpening hint the classic renderer applies exaggerates
        // diffusion noise; the browser default resamples properly.
        await expect(figure.locator('img')).toHaveCSS('image-rendering', 'auto');
    });

    test('records the seed so a render can be reproduced', async ({ page, request }, testInfo) => {
        await freshChat(page, request, testInfo);
        await page.getByRole('button', { name: 'Generate an image' }).click();
        await render(page, 'a quiet forest clearing');

        const image = page.locator('.media-figure img').first();
        await expect(image).toBeVisible({ timeout: 30000 });
        await image.click();

        await expect(page.locator('.lightbox-stage')).toBeVisible();
        await page.getByRole('button', { name: 'Show details' }).click();

        const details = page.getByRole('dialog').locator('aside');
        await expect(details.getByText('Seed')).toBeVisible();
        // Never the -1 that was requested: the resolved seed travels back.
        const seed = await details.locator('dd').filter({ hasText: /^\d+$/ }).first().innerText();
        expect(Number(seed)).toBeGreaterThan(0);
        await expect(details.getByText('ComfyUI')).toBeVisible();
    });

    test('zooms and pans in the lightbox', async ({ page, request }, testInfo) => {
        await freshChat(page, request, testInfo);
        await page.getByRole('button', { name: 'Generate an image' }).click();
        await render(page, 'a stone bridge');

        const image = page.locator('.media-figure img').first();
        await expect(image).toBeVisible({ timeout: 30000 });
        await image.click();

        const stage = page.locator('.lightbox-stage');
        await expect(stage).toHaveAttribute('data-zoomed', 'false');
        await page.getByRole('button', { name: 'Zoom in' }).click();
        await expect(stage).toHaveAttribute('data-zoomed', 'true');
        await expect(page.locator('.lightbox-image')).toHaveAttribute(
            'style',
            /scale\(1\.4\)/,
        );

        await page.getByRole('button', { name: 'Reset zoom' }).click();
        await expect(stage).toHaveAttribute('data-zoomed', 'false');
    });

    test('switches a message to a gallery once it holds several renders', async ({ page, request }, testInfo) => {
        await freshChat(page, request, testInfo);
        await page.getByRole('button', { name: 'Generate an image' }).click();
        await render(page, 'first render');
        await expect(page.locator('.media-figure img').first()).toBeVisible({ timeout: 30000 });

        await page.getByRole('button', { name: 'Generate an image' }).click();
        await render(page, 'second render');
        // A second render is a variation of the first, so the message shows one
        // at a time with a filmstrip rather than stacking two full-size images.
        await expect(page.getByRole('tablist', { name: 'Renders in this message' })).toBeVisible({
            timeout: 30000,
        });
        await expect(page.getByRole('tab')).toHaveCount(2);
        await expect(page.locator('.media-figure')).toHaveCount(1);
    });

    test('moves the image and the text around each other', async ({ page, request }, testInfo) => {
        await freshChat(page, request, testInfo);
        await page.getByRole('button', { name: 'Generate an image' }).click();
        await render(page, 'a lantern in the dark');
        await expect(page.locator('.media-figure img').first()).toBeVisible({ timeout: 30000 });

        const article = page.locator('article').first();
        const proseFirst = async () => {
            const order = await article.evaluate((element) => {
                const nodes = [...element.querySelectorAll('.prose-message, .media-figure')];
                return nodes.map((node) => (node.classList.contains('prose-message') ? 'text' : 'image'));
            });
            return order[0];
        };

        // Default: the reply stays put and the image follows it.
        expect(await proseFirst()).toBe('text');

        await article.getByRole('button', { name: 'More actions' }).click();
        await page.getByRole('menuitem', { name: 'As a caption' }).click();
        expect(await proseFirst()).toBe('image');

        // `Image only` collapses the text rather than deleting it, which is
        // what the classic UI's inline_image=false does.
        await article.getByRole('button', { name: 'More actions' }).click();
        await page.getByRole('menuitem', { name: 'Image only' }).click();
        await expect(article.locator('.prose-message')).toHaveCount(0);
        await article.getByRole('button', { name: 'Show the text' }).click();
        await expect(article.locator('.prose-message')).toHaveCount(1);
    });

    test('persists the attachment in the shape the classic UI reads', async ({ page, request }, testInfo) => {
        const chatFile = await freshChat(page, request, testInfo);

        await page.getByRole('button', { name: 'Generate an image' }).click();
        await render(page, 'a persisted render');
        await expect(page.locator('.media-figure img').first()).toBeVisible({ timeout: 30000 });

        const token = await (await request.get('/csrf-token')).json();
        /** Every message in the saved file that carries an attachment. */
        const readMediaLines = async () => {
            const response = await request.post('/api/chats/get', {
                headers: { 'X-CSRF-Token': token.token },
                data: { ch_name: 'Seraphina', file_name: chatFile, avatar_url: 'default_Seraphina.png' },
            });
            const lines = await response.json();
            return [lines].flat().filter((line) => [line?.extra?.media].flat().filter(Boolean).length > 0);
        };

        // The save is debounced, so poll rather than guessing at a delay.
        await expect
            .poll(async () => (await readMediaLines()).length, {
                message: 'the chat file should carry the attachment',
                timeout: 10000,
            })
            .toBe(1);

        const [withMedia] = await readMediaLines();

        const [attachment] = withMedia.extra.media;
        // These four fields are what public/script.js reads.
        expect(attachment.url).toMatch(/^\/user\/images\//);
        expect(attachment.type).toBe('image');
        expect(attachment.title).toBe('a persisted render');
        expect(attachment.source).toBe('generated');
        // And the boolean the classic UI uses to decide about the text.
        expect(withMedia.extra.inline_image).toBe(true);
        // Recorded so the box can be reserved on the next load.
        expect(attachment.width).toBe(832);
        expect(attachment.height).toBe(1216);
        expect(typeof attachment.seed).toBe('number');
    });
});


/**
 * The images side panel.
 *
 * Inline rendering answers "what did this message look like"; it does not
 * answer "where is the render from twenty messages ago", and scrolling is the
 * only alternative. The panel is a navigator for that, so the assertions that
 * matter are about getting *back* to a message — including one that has
 * scrolled out of the bounded render window and so is not in the DOM at all.
 */
test.describe('image panel', () => {
    /** A 1x1 PNG, so a seeded attachment points at a file that exists. */
    const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/'
        + 'q842iQAAAABJRU5ErkJggg==';

    /** Writes a chat file directly: the window case needs more than 120 messages. */
    async function seedChat(request, { fileName, images, filler }) {
        const token = await (await request.get('/csrf-token')).json();

        // Without the files on disk the folder tab would list nothing and the
        // tiles would render their failure state.
        for (const image of images) {
            const name = image.url.split('/').pop().replace(/\.png$/, '');
            const upload = await request.post('/api/images/upload', {
                headers: { 'X-CSRF-Token': token.token },
                data: { image: PIXEL, format: 'png', ch_name: 'Seraphina', filename: name },
            });
            expect(upload.ok()).toBeTruthy();
        }

        const message = (mes, media) => ({
            name: 'Seraphina',
            is_user: false,
            send_date: '2026-09-10 @04h 10m 00s 000ms',
            mes,
            ...(media ? { extra: { media, media_layout: 'inline', inline_image: true } } : {}),
        });
        const chat = [
            {
                user_name: 'User',
                character_name: 'Seraphina',
                create_date: '2026-09-10@04h10m00s',
                chat_metadata: {},
            },
            message('The oldest render.', [images[0]]),
            ...Array.from({ length: filler }, (_, i) => message(`Filler ${i}.`)),
            message('A pair in one message.', images.slice(1)),
        ];
        const response = await request.post('/api/chats/save', {
            headers: { 'X-CSRF-Token': token.token },
            data: { ch_name: 'Seraphina', file_name: fileName, avatar_url: AVATAR, chat, force: true },
        });
        expect(response.ok()).toBeTruthy();
        return chat;
    }

    /** An attachment record, as a render writes one. */
    function attachment(name, { width, height, title, seed }) {
        return {
            url: `/user/images/Seraphina/${name}`,
            type: 'image',
            source: 'generated',
            title,
            width,
            height,
            seed,
            provider: 'comfyui',
            steps: 24,
            cfgScale: 5,
        };
    }

    async function openPanel(page, fileName) {
        await page.goto(`/next/chat/${encodeURIComponent(AVATAR)}/${encodeURIComponent(fileName)}`);
        await expect(page.locator('article').first()).toBeVisible();
        await page.getByRole('button', { name: 'Show the side panel' }).click();
        await page.getByRole('radio', { name: 'Images' }).click();
        return page.getByRole('complementary', { name: 'Chat details' });
    }

    test('lists the chat\'s renders newest first, captioned by prompt', async ({ page, request }) => {
        const images = [
            attachment('panel-a.png', { width: 832, height: 1216, title: 'the oldest one', seed: 1 }),
            attachment('panel-b.png', { width: 1216, height: 832, title: 'the middle one', seed: 2 }),
            attachment('panel-c.png', { width: 1024, height: 1024, title: 'the newest one', seed: 3 }),
        ];
        await seedChat(request, { fileName: 'Panel list', images, filler: 2 });
        const panel = await openPanel(page, 'Panel list');

        await expect(panel.locator('figure')).toHaveCount(3);
        // Newest first, and captioned by the prompt: sender and time are
        // identical on every tile in a one-to-one chat and identify nothing.
        await expect(panel.locator('figcaption')).toHaveText([
            'the newest one',
            'the middle one',
            'the oldest one',
        ]);
        await expect(page.getByRole('radio', { name: 'This chat (3)' })).toBeVisible();
    });

    test('jumps back to a message that is outside the render window', async ({ page, request }) => {
        const images = [
            attachment('panel-a.png', { width: 832, height: 1216, title: 'far back', seed: 1 }),
            attachment('panel-b.png', { width: 1216, height: 832, title: 'recent one', seed: 2 }),
            attachment('panel-c.png', { width: 1024, height: 1024, title: 'recent two', seed: 3 }),
        ];
        // 130 filler messages, so message 1 sits past the 120-message window.
        await seedChat(request, { fileName: 'Panel jump', images, filler: 130 });
        const panel = await openPanel(page, 'Panel jump');

        // The oldest message is not rendered at all to begin with.
        await expect(page.locator('[data-message-index="1"]')).toHaveCount(0);

        const oldest = panel.locator('figure').last();
        await oldest.hover();
        await oldest.getByRole('button', { name: 'Go to this message' }).click();

        // The window has to widen for the message to exist before it can be
        // scrolled to — a jump that silently does nothing would be worse than
        // no jump at all.
        await expect(page.locator('[data-message-index="1"]')).toBeVisible();
        // Polled rather than snapshotted: the scroll settles over a frame or
        // two once the heights either side of the target have resolved.
        const viewport = page.viewportSize();
        await expect
            .poll(async () => {
                const box = await page.locator('[data-message-index="1"]').boundingBox();
                return box.y > -100 && box.y < viewport.height;
            }, { message: 'the revealed message should be in view', timeout: 10000 })
            .toBe(true);
    });

    test('lists the character folder and pairs settings for renders from this chat', async ({ page, request }) => {
        const images = [
            attachment('panel-a.png', { width: 832, height: 1216, title: 'from this chat', seed: 4242 }),
            attachment('panel-b.png', { width: 1216, height: 832, title: 'also this chat', seed: 2 }),
            attachment('panel-c.png', { width: 1024, height: 1024, title: 'and this one', seed: 3 }),
        ];
        await seedChat(request, { fileName: 'Panel folder', images, filler: 2 });
        const panel = await openPanel(page, 'Panel folder');

        await page.getByRole('radio', { name: /^All of/ }).click();
        // The folder holds every render from every chat, so it is at least as
        // large as this chat's own list.
        await expect(panel.locator('figure').first()).toBeVisible();
        expect(await panel.locator('figure').count()).toBeGreaterThanOrEqual(3);

        // A bare file carries no seed; pairing it with the chat attachment
        // recovers one.
        await panel.getByRole('button', { name: 'View from this chat' }).click();
        await expect(page.locator('.lightbox-stage')).toBeVisible();
        await page.getByRole('button', { name: 'Show details' }).click();
        await expect(page.getByRole('dialog').getByText('4242')).toBeVisible();
    });

    test('removing from the panel removes it from the message', async ({ page, request }) => {
        const images = [
            attachment('panel-a.png', { width: 832, height: 1216, title: 'keep me', seed: 1 }),
            attachment('panel-b.png', { width: 1216, height: 832, title: 'delete me', seed: 2 }),
            attachment('panel-c.png', { width: 1024, height: 1024, title: 'keep me too', seed: 3 }),
        ];
        await seedChat(request, { fileName: 'Panel remove', images, filler: 2 });
        const panel = await openPanel(page, 'Panel remove');

        const target = panel.locator('figure').filter({ hasText: 'delete me' });
        await target.hover();
        await target.getByRole('button', { name: 'Remove from the message' }).click();

        await expect(panel.locator('figure')).toHaveCount(2);
        await expect(panel.locator('figure').filter({ hasText: 'delete me' })).toHaveCount(0);
        // And gone from the message itself, not just the panel. Two remain:
        // one in the oldest message and one left in the pair.
        await expect(page.locator('.media-figure')).toHaveCount(2);
    });

    test('is reachable at phone width, where it used to be hidden entirely', async ({ page, request }) => {
        const images = [
            attachment('panel-a.png', { width: 832, height: 1216, title: 'one', seed: 1 }),
            attachment('panel-b.png', { width: 1216, height: 832, title: 'two', seed: 2 }),
            attachment('panel-c.png', { width: 1024, height: 1024, title: 'three', seed: 3 }),
        ];
        await seedChat(request, { fileName: 'Panel phone', images, filler: 2 });

        await page.setViewportSize({ width: 400, height: 860 });
        await page.goto(`/next/chat/${encodeURIComponent(AVATAR)}/${encodeURIComponent('Panel phone')}`);
        await expect(page.locator('article').first()).toBeVisible();

        // The toggle used to carry `max-xl:hidden`, so on a phone pressing it
        // did nothing and the panel was unreachable.
        await page.getByRole('button', { name: 'Show the side panel' }).click();
        const drawer = page.getByRole('dialog');
        await expect(drawer).toBeVisible();
        await page.getByRole('radio', { name: 'Images' }).click();
        await expect(drawer.locator('figure')).toHaveCount(3);

        // Nothing may scroll sideways at phone width. Measured through a
        // locator rather than `page.evaluate`, so no browser globals are
        // referenced in a file linted as Node.
        const overflow = await page.locator('html').evaluate(
            (element) => element.scrollWidth - element.clientWidth,
        );
        expect(overflow).toBe(0);

        // The drawer covers the chat it points at, so jumping closes it.
        const tile = drawer.locator('figure').first();
        await tile.hover();
        await tile.getByRole('button', { name: 'Go to this message' }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });
});
