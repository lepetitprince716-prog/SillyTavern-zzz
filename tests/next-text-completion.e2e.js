import { test, expect } from '@playwright/test';

/**
 * Text completion in the modern frontend.
 *
 * Needs a built bundle (`npm run next:build`), a running server, and the
 * backend stand-ins from `tests/util/mock-textgen.mjs` on 127.0.0.1:5100 and
 * :5101.
 *
 * The assertions that matter are about the request that reaches the backend:
 * that the prompt was flattened with the chosen instruct template, that the
 * stop strings came along, and that only the names *that* backend uses were
 * sent. The classic UI sends every alias for every backend at once, which is
 * why its sampler panel cannot say which control has any effect.
 */

const OOBA_URL = 'http://127.0.0.1:5100';
const KOBOLD_URL = 'http://127.0.0.1:5101';

/**
 * The mock backend's most recent request whose prompt contains `marker`.
 *
 * Not "the last request": these specs run in parallel against one mock, so a
 * single slot means another worker's generation can land between the send and
 * the read — which looks exactly like the product sending the wrong body.
 */
async function requestContaining(request, base, marker) {
    const response = await request.get(`${base}/requests?contains=${encodeURIComponent(marker)}`);
    return response.json();
}

async function openChat(page) {
    await page.goto('/next/characters');
    const characters = page.locator('nav[aria-label="Characters"] a');
    await expect(characters.first()).toBeVisible();
    await characters.first().click();
    await expect(page.locator('textarea[aria-label="Message"]')).toBeVisible();
    await page.getByRole('button', { name: 'New chat' }).click();
    // Waits for the greeting rather than asserting an exact message count:
    // these specs run in parallel against one server, so another worker may
    // have created a chat between the click and the assertion. The
    // "fresh chat holds only the greeting" property is asserted in
    // next-frontend.e2e.js, which owns it.
    await expect(page.locator('article').first()).toBeVisible();
}

/** Puts the app into text-completion mode against the given backend. */
async function useBackend(page, { backend, url }) {
    await page.keyboard.press('Control+,');
    await expect(page.getByRole('tab', { name: 'API' })).toBeVisible();
    await page.getByRole('tab', { name: 'API' }).click();
    await page.getByRole('radio', { name: 'Text completions' }).click();

    await page.getByLabel('Backend').click();
    await page.getByRole('option', { name: backend }).click();

    if (url) {
        await page.getByLabel('Server URL').fill(url);
        await page.getByRole('button', { name: 'Check' }).click();
        // The toast confirms the server answered.
        await expect(page.getByText(/answered/)).toBeVisible({ timeout: 10000 });
    }

    // Close the drawer.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tab', { name: 'API' })).toBeHidden();
}

test.describe('text completion', () => {
    let consoleErrors;

    test.beforeEach(async ({ page }) => {
        consoleErrors = [];
        page.on('console', (message) => {
            if (message.type() === 'error') {
                consoleErrors.push(message.text());
            }
        });
        page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
    });

    test('flattens the chat into one instruct-wrapped prompt', async ({ page, request }) => {
        await openChat(page);
        await useBackend(page, { backend: 'Text Generation WebUI', url: OOBA_URL });

        await page.locator('textarea[aria-label="Message"]').fill('Where are we going?');
        await page.keyboard.press('Enter');

        // The reply the mock returns.
        await expect(page.getByText(/looks up from the map/)).toBeVisible({ timeout: 20000 });

        const { path, body } = await requestContaining(request, OOBA_URL, 'Where are we going?');
        expect(path).toBe('/v1/completions');

        // One string, not a message array.
        expect(typeof body.prompt).toBe('string');
        expect(body.messages).toBeUndefined();

        // Wrapped with the default instruct template's sequences, and ending
        // where the model takes over.
        expect(body.prompt).toContain('<|im_start|>user');
        expect(body.prompt).toContain('Where are we going?');
        expect(body.prompt.trimEnd().endsWith('<|im_start|>assistant')).toBe(true);

        // Stop strings travel with it — without them the model writes both sides.
        expect(Array.isArray(body.stop)).toBe(true);
        expect(body.stop).toContain('\n<|im_end|>');

        // This route's own routing fields are not generation parameters and
        // must not reach the backend.
        expect(body.api_type).toBeUndefined();
        expect(body.api_server).toBeUndefined();

        expect(consoleErrors).toEqual([]);
    });

    test('sends each backend only the parameter names it uses', async ({ page, request }) => {
        await openChat(page);
        await useBackend(page, { backend: 'Text Generation WebUI', url: OOBA_URL });
        await page.locator('textarea[aria-label="Message"]').fill('Marker one.');
        await page.keyboard.press('Enter');
        await expect(page.getByText(/looks up from the map/)).toBeVisible({ timeout: 20000 });

        const ooba = (await requestContaining(request, OOBA_URL, 'Marker one.')).body;
        expect(ooba.max_tokens).toBeGreaterThan(0);
        expect(ooba.repetition_penalty).toBeGreaterThan(1);
        // llama.cpp's spellings must not also be present.
        expect(ooba.n_predict).toBeUndefined();
        expect(ooba.repeat_penalty).toBeUndefined();
        expect(ooba.max_length).toBeUndefined();

        // Now the same chat against Kobold's native API.
        await useBackend(page, { backend: 'KoboldAI / KoboldCpp', url: KOBOLD_URL });
        await page.locator('textarea[aria-label="Message"]').fill('Marker two.');
        await page.keyboard.press('Enter');
        await expect(page.getByText(/looks up from the map/).first()).toBeVisible({ timeout: 20000 });

        const kobold = (await requestContaining(request, KOBOLD_URL, 'Marker two.')).body;
        expect(kobold.max_length).toBeGreaterThan(0);
        expect(kobold.max_context_length).toBeGreaterThan(0);
        expect(kobold.rep_pen).toBeGreaterThan(1);
        // And ooba's spellings must not be present here.
        expect(kobold.max_tokens).toBeUndefined();
        expect(kobold.repetition_penalty).toBeUndefined();
        // Kobold has no frequency or presence penalty at all.
        expect(kobold.frequency_penalty).toBeUndefined();
        expect(kobold.presence_penalty).toBeUndefined();

        expect(consoleErrors).toEqual([]);
    });

    test('hides the samplers the chosen backend cannot use', async ({ page }) => {
        await openChat(page);
        await useBackend(page, { backend: 'Text Generation WebUI', url: OOBA_URL });

        await page.keyboard.press('Control+,');
        await page.getByRole('tab', { name: 'Sampling' }).click();
        // ooba implements all of them.
        await expect(page.getByRole('slider', { name: 'Mirostat', exact: true })).toBeVisible();
        await expect(page.getByRole('slider', { name: 'Tail-free sampling' })).toBeVisible();

        await page.getByRole('tab', { name: 'API' }).click();
        await page.getByLabel('Backend').click();
        await page.getByRole('option', { name: 'Any OpenAI-compatible endpoint' }).click();
        await page.getByRole('tab', { name: 'Sampling' }).click();

        // A generic completions endpoint has none of these, and the server
        // filters them out anyway — so showing them as working would be a lie.
        await expect(page.getByRole('slider', { name: 'Mirostat', exact: true })).toHaveCount(0);
        await expect(page.getByRole('slider', { name: /^Mirostat/ })).toHaveCount(0);
        await expect(page.getByRole('slider', { name: 'Tail-free sampling' })).toHaveCount(0);
        await expect(page.getByRole('slider', { name: 'Top K' })).toHaveCount(0);
        await expect(page.getByText(/has no/)).toBeVisible();
        // The ones it does have are still there.
        await expect(page.getByRole('slider', { name: 'Temperature' })).toBeVisible();
    });

    test('shows the flattened prompt in the inspector, not the message array', async ({ page }) => {
        await openChat(page);
        await useBackend(page, { backend: 'Text Generation WebUI', url: OOBA_URL });

        // The inspector is the right-hand panel, toggled from the header.
        await page.getByRole('button', { name: 'Show the side panel' }).click();
        await page.getByRole('button', { name: 'Inspect prompt' }).click();

        const dialog = page.getByRole('dialog');
        await expect(dialog).toContainText('One flattened prompt');
        await expect(dialog).toContainText('<|im_start|>');
        await expect(dialog).toContainText(/\d+ stop strings/);
    });

    test('names the backend in the chat header', async ({ page }) => {
        await openChat(page);
        await useBackend(page, { backend: 'KoboldAI / KoboldCpp', url: KOBOLD_URL });
        // The provider list does not apply in text mode, so the header has to
        // name the backend and its server instead.
        await expect(page.getByText('KoboldAI / KoboldCpp', { exact: false }).first()).toBeVisible();
    });
});
