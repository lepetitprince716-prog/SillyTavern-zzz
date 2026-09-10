import { test, expect } from '@playwright/test';

/**
 * Smoke tests for the modern frontend at /next.
 *
 * These need a built bundle (`npm run next:build`) and a running server. They
 * are deliberately shallow: enough to catch the shell failing to boot, chat
 * navigation leaking DOM, or a crash on the main surfaces.
 */
test.describe('next frontend', () => {
    /** Console errors seen during a test, asserted at the end. */
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

    test('serves the app shell and lands on the character library', async ({ page }) => {
        await page.goto('/next/');
        await expect(page).toHaveTitle('SillyTavern');
        await expect(page).toHaveURL(/\/next\/characters$/);
        await expect(page.getByRole('heading', { name: 'Characters' })).toBeVisible();
        expect(consoleErrors).toEqual([]);
    });

    test('answers a deep link with the same shell', async ({ page }) => {
        const response = await page.goto('/next/chat/does-not-exist.png');
        expect(response?.status()).toBe(200);
        await expect(page.getByText('Character not found')).toBeVisible();
    });

    test('opens a chat and keeps exactly one message list across chat switches', async ({ page }) => {
        await page.goto('/next/characters');
        const characters = page.locator('nav[aria-label="Characters"] a');
        await expect(characters.first()).toBeVisible();

        await characters.first().click();
        await expect(page.locator('textarea[aria-label="Message"]')).toBeVisible();
        await expect(page.locator('[role="log"]')).toHaveCount(1);

        // Switching chats must replace the message list, not add another.
        // Sibling components once shared a React key, which left the displaced
        // subtree mounted and stacked old messages under the new chat.
        for (let i = 0; i < 3; i++) {
            await page.getByRole('button', { name: 'New chat' }).click();
            await expect(page.locator('[role="log"]')).toHaveCount(1);
            await expect(page.locator('textarea[aria-label="Message"]')).toHaveCount(1);
        }

        // A fresh chat shows only the character's greeting.
        await expect(page.locator('article')).toHaveCount(1);
        expect(consoleErrors).toEqual([]);
    });

    test('manages lorebooks in plain language', async ({ page }) => {
        await page.goto('/next/worldinfo');

        const editor = page.locator('div.max-w-2xl');
        // A fresh install may have no lorebooks; the editor only exists once
        // there is a book to open.
        const hasBooks = await editor
            .waitFor({ state: 'visible', timeout: 5000 })
            .then(() => true, () => false);
        test.skip(!hasBooks, 'No lorebook on this install to open in the editor.');

        // The editor must describe what each field does rather than expose the
        // stored integers: `position: 0` and `selectiveLogic: 2` tell a reader
        // nothing about what they do.
        await expect(editor).toContainText(/when it fires/i);
        await expect(editor).toContainText(/what it says/i);
        await expect(editor).toContainText(/where it goes/i);
        await expect(editor).not.toContainText(/selectiveLogic/);

        // The second condition stays hidden until it is switched on, and then
        // reads as a sentence. The switch and the panel must agree: an entry
        // with `selective` set but no secondary keys has no condition at all.
        await expect(editor).not.toContainText(/Fire only if/);
        await page.getByLabel('Also require a second condition').click();
        await expect(editor).toContainText(/Fire only if/);
        await expect(editor).toContainText(/at least one of these also appears/);
        await page.getByLabel('Also require a second condition').click();
        await expect(editor).not.toContainText(/Fire only if/);

        expect(consoleErrors).toEqual([]);
    });

    test('accounts for every world info entry in the activation trace', async ({ page }) => {
        // The inspector holds the trace and is closed by default, and it only
        // lays out at xl and wider.
        await page.setViewportSize({ width: 1500, height: 900 });
        // Passed as source text rather than a function: this file is linted as
        // Node, where `localStorage` does not exist. `Eldoria` ships as default
        // content, so activating it keeps the test meaningful rather than
        // depending on whichever book a card happens to name.
        await page.addInitScript({
            content:
                'localStorage.setItem("st-next:ui", JSON.stringify(' +
                '{ version: 1, state: { inspectorOpen: true, sidebarOpen: true } }));' +
                'localStorage.setItem("st-next:session", JSON.stringify(' +
                '{ version: 1, state: { worldInfo: { enabled: true, books: ["Eldoria"], ' +
                'useCharacterBook: true, budgetTokens: 1024, scanDepth: 4, maxRecursionRounds: 1, ' +
                'semanticEnabled: false, semanticThreshold: 0.3, semanticTopK: 3 } } }));',
        });

        await page.goto('/next/characters');
        await page.locator('nav[aria-label="Characters"] a').first().click();
        await expect(page.locator('textarea[aria-label="Message"]')).toBeVisible();

        const trace = page.locator('aside').filter({ hasText: /world info/i });
        await expect(trace).toBeVisible();

        const summary = await trace.innerText();
        test.skip(/No lorebook is active/.test(summary), 'No lorebook bound to this character.');

        // The whole point of the panel: every candidate entry is accounted
        // for, either active or listed as not included with a reason.
        const active = /(\d+) of (\d+) entries active/.exec(summary);
        expect(active, `expected an entry count in: ${summary.slice(0, 200)}`).not.toBeNull();
        const includedCount = Number(active?.[1]);
        const total = Number(active?.[2]);
        const skipped = /(\d+) not included/.exec(summary);
        expect(includedCount + (skipped ? Number(skipped[1]) : 0)).toBe(total);

        expect(consoleErrors).toEqual([]);
    });

    test('opens the command palette, settings and the character panel', async ({ page }) => {
        await page.goto('/next/characters');
        await page.locator('nav[aria-label="Characters"] a').first().click();
        await expect(page.locator('textarea[aria-label="Message"]')).toBeVisible();

        await page.keyboard.press('ControlOrMeta+k');
        const search = page.getByLabel('Search characters or run a command');
        await expect(search).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(search).toBeHidden();

        await page.keyboard.press('ControlOrMeta+,');
        await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
        for (const tab of ['Sampling', 'Prompt', 'Lore', 'You', 'Look', 'API']) {
            await page.getByRole('tab', { name: tab }).click();
        }
        await page.keyboard.press('Escape');

        await page.getByRole('button', { name: /character panel/ }).click();
        await page.getByRole('button', { name: 'Inspect prompt' }).click();
        await expect(page.getByRole('heading', { name: 'Prompt preview' })).toBeVisible();
        await page.keyboard.press('Escape');

        expect(consoleErrors).toEqual([]);
    });
});
