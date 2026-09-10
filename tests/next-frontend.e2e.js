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
        for (const tab of ['Sampling', 'Prompt', 'You', 'Look', 'API']) {
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
