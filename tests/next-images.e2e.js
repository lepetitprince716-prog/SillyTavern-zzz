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

/** 832×1216 — NovelAI's portrait default, and the shape most renders use. */
const PORTRAIT_RATIO = 832 / 1216;

/** Opens the newest chat of the first character. */
async function openChat(page) {
    await page.goto('/next/characters');
    const characters = page.locator('nav[aria-label="Characters"] a');
    await expect(characters.first()).toBeVisible();
    await characters.first().click();
    await expect(page.locator('textarea[aria-label="Message"]')).toBeVisible();
}

/** Starts a fresh chat so each test has its own message to illustrate. */
async function freshChat(page) {
    await openChat(page);
    await page.getByRole('button', { name: 'New chat' }).click();
    await expect(page.locator('article')).toHaveCount(1);
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
    test('reserves the box at the render\'s own shape before it loads', async ({ page }) => {
        await freshChat(page);
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

    test('records the seed so a render can be reproduced', async ({ page }) => {
        await freshChat(page);
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

    test('zooms and pans in the lightbox', async ({ page }) => {
        await freshChat(page);
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

    test('switches a message to a gallery once it holds several renders', async ({ page }) => {
        await freshChat(page);
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

    test('moves the image and the text around each other', async ({ page }) => {
        await freshChat(page);
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

    test('persists the attachment in the shape the classic UI reads', async ({ page, request }) => {
        await freshChat(page);
        const chatFile = decodeURIComponent(new URL(page.url()).pathname.split('/').pop());

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
