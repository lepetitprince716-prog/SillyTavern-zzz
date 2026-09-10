import { test, expect } from '@playwright/test';

/**
 * The extension manager in the modern frontend.
 *
 * Needs a built bundle (`npm run next:build`) and a running server. No mock:
 * the bundled extensions under `public/scripts/extensions` are the fixture,
 * and the assertions are about what the page says of them.
 *
 * Two things are worth asserting beyond the list rendering. The state of every
 * extension has to be attributed to its own row — the classic panel puts three
 * of its four reasons in one error block at the bottom — and enabling or
 * disabling has to survive a reload, because it is a read-modify-write of the
 * whole `settings.json` and the failure mode is a change that silently
 * disappears.
 */

/** Bundled with SillyTavern, so present in every checkout. */
const KNOWN = { folder: 'gallery', displayName: 'Gallery' };
/** Reimplemented natively in this frontend, so marked as covered here. */
const NATIVE = { folder: 'vectors', displayName: 'Vector Storage' };

async function csrf(request) {
    const token = await (await request.get('/csrf-token')).json();
    return { 'X-CSRF-Token': token.token };
}

/** The `disabledExtensions` list as stored on the server. */
async function disabledList(request) {
    const headers = await csrf(request);
    const response = await request.post('/api/settings/get', { headers, data: {} });
    const settings = JSON.parse((await response.json()).settings);
    return settings.extension_settings?.disabledExtensions ?? [];
}

/** Puts the list back, so a run leaves the install as it found it. */
async function setDisabledList(request, list) {
    const headers = await csrf(request);
    const response = await request.post('/api/settings/get', { headers, data: {} });
    const settings = JSON.parse((await response.json()).settings);
    settings.extension_settings = { ...settings.extension_settings, disabledExtensions: list };
    const saved = await request.post('/api/settings/save', { headers, data: settings });
    expect(saved.ok()).toBeTruthy();
}

function row(page, name) {
    return page.getByRole('listitem').filter({ hasText: name }).first();
}

test.use({ viewport: { width: 1440, height: 1000 } });

// Serial, because every test here reads and writes the one `settings.json`:
// run in parallel they would restore each other's baseline mid-assertion.
test.describe.configure({ mode: 'serial' });

test.describe('extensions', () => {
    let consoleErrors;
    let originalDisabled;

    test.beforeEach(async ({ page, request }) => {
        consoleErrors = [];
        page.on('console', (message) => {
            if (message.type() === 'error') {
                consoleErrors.push(message.text());
            }
        });
        page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
        originalDisabled = await disabledList(request);
        // A known baseline: these tests assert on what switching an extension
        // off does, so they cannot start from whatever the install happens to
        // have off. `afterEach` puts the real list back.
        await setDisabledList(request, []);
    });

    test.afterEach(async ({ request }) => {
        await setDisabledList(request, originalDisabled);
    });

    test.afterEach(() => {
        expect(consoleErrors).toEqual([]);
    });

    test('lists every extension with its own state and folder', async ({ page }) => {
        await page.goto('/next/extensions');
        await expect(page.getByRole('heading', { name: 'Extensions' })).toBeVisible();

        const rows = page.getByRole('listitem');
        await expect(rows.first()).toBeVisible();
        const count = await rows.count();
        expect(count).toBeGreaterThan(5);

        // The counts in the header reconcile with the list.
        const summary = await page.getByText(/installed ·/).innerText();
        const [total, loads, off, held] = summary.match(/\d+/g).map(Number);
        expect(total).toBe(count);
        expect(loads + off + held).toBe(total);

        await expect(row(page, KNOWN.displayName)).toContainText(KNOWN.folder);
    });

    test('says which extensions this interface covers itself', async ({ page }) => {
        await page.goto('/next/extensions');
        await expect(row(page, NATIVE.displayName)).toContainText('Covered here');
        // And does not claim it for one it has not reimplemented.
        await expect(row(page, KNOWN.displayName)).not.toContainText('Covered here');
    });

    test('switching an extension off survives a reload', async ({ page, request }) => {
        await page.goto('/next/extensions');
        const target = row(page, KNOWN.displayName);
        await expect(target.getByRole('switch')).toHaveAttribute('aria-checked', 'true');

        await target.getByRole('switch').click();
        await expect(target).toContainText('Switched off');
        await expect.poll(() => disabledList(request)).toContain(KNOWN.folder);

        await page.reload();
        await expect(row(page, KNOWN.displayName).getByRole('switch'))
            .toHaveAttribute('aria-checked', 'false');
    });

    test('two changes in a row do not undo each other', async ({ page, request }) => {
        // Each toggle is a read-modify-write of the whole settings file, so
        // without a queue the second read precedes the first write and the
        // first change is lost.
        await page.goto('/next/extensions');
        await expect(row(page, KNOWN.displayName).getByRole('switch')).toBeVisible();

        await row(page, KNOWN.displayName).getByRole('switch').click();
        await row(page, NATIVE.displayName).getByRole('switch').click();

        await expect
            .poll(() => disabledList(request))
            .toEqual(expect.arrayContaining([KNOWN.folder, NATIVE.folder]));
    });

    test('a switched-off extension reports being switched off, not held back', async ({ page, request }) => {
        await setDisabledList(request, [KNOWN.folder]);
        await page.goto('/next/extensions');

        await expect(row(page, KNOWN.displayName)).toContainText('Switched off');
        const summary = await page.getByText(/installed ·/).innerText();
        expect(summary).toMatch(/1 off/);
        expect(summary).toMatch(/0 held back/);
    });

    test('filters and searches, at phone width too', async ({ page, request }) => {
        await setDisabledList(request, [KNOWN.folder]);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/next/extensions');

        const filter = page.getByRole('combobox', { name: 'Filter extensions' });
        // The filter used to be desktop-only, which made the most useful view
        // of this page unreachable on a phone.
        await expect(filter).toBeVisible();
        await filter.click();
        await page.getByRole('option', { name: 'Switched off' }).click();
        await expect(page.getByRole('listitem')).toHaveCount(1);
        await expect(page.getByRole('listitem').first()).toContainText(KNOWN.displayName);

        await filter.click();
        await page.getByRole('option', { name: 'Everything' }).click();
        await page.getByRole('textbox', { name: 'Search extensions' }).fill(NATIVE.folder);
        await expect(page.getByRole('listitem')).toHaveCount(1);
        await expect(page.getByRole('listitem').first()).toContainText(NATIVE.displayName);
    });

    test('warns what an extension can reach before installing one', async ({ page }) => {
        await page.goto('/next/extensions');
        await page.getByRole('button', { name: 'Install' }).click();

        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('textbox', { name: 'Repository URL' })).toBeVisible();
        await expect(dialog).toContainText(/runs its own code in your browser/);
        // Nothing to install until a URL is given.
        await expect(dialog.getByRole('button', { name: 'Install' })).toBeDisabled();
    });
});
