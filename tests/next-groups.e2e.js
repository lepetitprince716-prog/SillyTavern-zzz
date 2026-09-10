import { test, expect } from '@playwright/test';

/**
 * Group chats in the modern frontend.
 *
 * Needs a built bundle (`npm run next:build`), a running server, and the text
 * completion stand-in from `tests/util/mock-textgen.mjs` on 127.0.0.1:5100.
 *
 * The assertions are about the two things the classic group engine cannot
 * show you: *who* was picked to speak — a name outside the ASCII range can
 * never be matched by `/\b\w+\b/`, so naming such a character has no effect
 * at all — and *why*, which the classic implementation does not record. Plus
 * the prompt: joined member cards are unattributed by default, so the model
 * receives several descriptions run together with nothing saying whose is
 * whose.
 */

const OOBA_URL = 'http://127.0.0.1:5100';

/**
 * The three members, created once and shared.
 *
 * Fixed file names so repeated runs reuse the same cards instead of filling
 * the library, and `talkativeness: 0` so a natural turn activates exactly the
 * members that were named — a rolled turn cannot be asserted on.
 */
const MEMBERS = [
    { file: 'e2e-group-ada', name: 'Ada', description: 'Ada keeps the ledgers and misses nothing.' },
    { file: 'e2e-group-bram', name: 'Bram', description: 'Bram pours the drinks and hears everything.' },
    // A name with no ASCII letters, which is the case the classic matcher drops.
    { file: 'e2e-group-xiaoming', name: '小明', description: '小明 draws maps nobody asked for.' },
];

const AVATARS = MEMBERS.map((member) => `${member.file}.png`);

/** Groups this worker made, so a run does not leave a sidebar full of them. */
const createdGroups = new Set();

async function csrf(request) {
    const token = await (await request.get('/csrf-token')).json();
    return { 'X-CSRF-Token': token.token };
}

/** Creates the member cards, overwriting whatever a previous run left. */
async function createMembers(request) {
    const headers = await csrf(request);
    for (const member of MEMBERS) {
        // A JSON body, so `talkativeness` arrives as the number 0 rather than
        // the string "0": a form field is truthy either way, and it was
        // exactly the falsy zero that the endpoint used to discard.
        const response = await request.post('/api/characters/create', {
            headers,
            data: {
                ch_name: member.name,
                file_name: member.file,
                description: member.description,
                first_mes: `${member.name} looks up as you come in.`,
                personality: '',
                scenario: '',
                mes_example: '',
                talkativeness: 0,
            },
        });
        expect(response.ok(), `creating ${member.name}`).toBeTruthy();
    }
}

/**
 * Writes a group of this test's own.
 *
 * `POST /api/groups/create` names the file after `Date.now()`, which two
 * parallel workers can land on in the same millisecond; `/edit` takes the id,
 * so each test gets a group and a chat file nothing else touches.
 */
async function createGroup(request, testInfo, overrides = {}) {
    const id = `e2e-group-${testInfo.testId}`;
    createdGroups.add(id);
    const group = {
        id,
        name: 'The Crooked Oak',
        members: AVATARS,
        avatar_url: '',
        allow_self_responses: false,
        // Natural order, all cards joined into one prompt.
        activation_strategy: 0,
        generation_mode: 1,
        disabled_members: [],
        chat_id: id,
        chats: [id],
        auto_mode_delay: 5,
        generation_mode_join_prefix: '',
        generation_mode_join_suffix: '',
        ...overrides,
    };
    const response = await request.post('/api/groups/edit', {
        headers: await csrf(request),
        data: group,
    });
    expect(response.ok()).toBeTruthy();
    return group;
}

/**
 * The session state that points the app at the mock backend.
 *
 * Only the two groups this spec cares about: the store deep-merges a saved
 * state over its defaults, so a partial one leaves every other setting alone.
 */
const SEEDED_SESSION = {
    version: 1,
    state: {
        connection: {
            mode: 'text',
            source: 'openai',
            model: '',
            customUrl: '',
            useResponsesApi: false,
        },
        text: {
            backend: 'ooba',
            url: OOBA_URL,
            model: '',
            maxTokens: 80,
            maxContext: 4096,
            instructEnabled: true,
            instructName: 'ChatML',
            contextName: 'ChatML',
            customStops: [],
            hordeModels: [],
        },
    },
};

/**
 * Puts the app into text-completion mode against the mock backend.
 *
 * Seeded rather than clicked through the API drawer: that path is covered by
 * `next-text-completion.e2e.js`, and this spec is about the turn engine.
 *
 * Passed as source text rather than a function, as elsewhere in this suite:
 * the file is linted as Node, where the browser globals it needs do not exist.
 */
async function useMockBackend(page) {
    await page.addInitScript({
        content: `localStorage.setItem("st-next:session", ${
            JSON.stringify(JSON.stringify(SEEDED_SESSION))});`,
    });
}

/** The mock's most recent request whose prompt contains `marker`. */
async function requestContaining(request, marker) {
    const response = await request.get(
        `${OOBA_URL}/requests?contains=${encodeURIComponent(marker)}`,
    );
    return response.json();
}

/** Opens a group chat and waits for the composer. */
async function openGroup(page, request, testInfo, overrides) {
    const group = await createGroup(request, testInfo, overrides);
    await page.goto(`/next/group/${encodeURIComponent(group.id)}`);
    await expect(page.locator('textarea[aria-label="Message"]')).toBeVisible();
    return group;
}

/** The turn trace, which only has room to sit beside the chat when wide. */
function trace(page) {
    return page.getByRole('complementary', { name: 'Turn details' });
}

async function openTrace(page) {
    await page.getByRole('button', { name: 'Show the side panel' }).click();
    await expect(trace(page)).toBeVisible();
}

/** One member's row in the trace: the name, and the reason under it. */
function traceRow(page, name) {
    return trace(page).getByRole('listitem').filter({ hasText: name });
}

test.use({ viewport: { width: 1440, height: 950 } });

test.describe('group chats', () => {
    let consoleErrors;

    // A worker fixture, because `request` is per-test: the cards are identical
    // in every test, and `writeFileAtomicSync` makes concurrent workers writing
    // the same file harmless.
    test.beforeAll(async ({ playwright, baseURL }) => {
        const api = await playwright.request.newContext({ baseURL });
        await createMembers(api);
        await api.dispose();
    });

    test.beforeEach(async ({ page }) => {
        consoleErrors = [];
        page.on('console', (message) => {
            if (message.type() === 'error') {
                consoleErrors.push(message.text());
            }
        });
        page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
        await useMockBackend(page);
    });

    // Deleting the group takes its chat file with it, so a repeated run starts
    // from the same state rather than accumulating.
    test.afterEach(async ({ request }) => {
        const headers = await csrf(request);
        for (const id of createdGroups) {
            await request.post('/api/groups/delete', { headers, data: { id } });
        }
        createdGroups.clear();
    });

    test.afterEach(() => {
        expect(consoleErrors).toEqual([]);
    });

    test('keeps a talkativeness of zero instead of resetting it to the default', async ({ request }) => {
        // `charaFormatData` used `data.talkativeness || 0.5`, so the one value
        // that means "only speaks when named" could not be saved.
        const response = await request.post('/api/characters/all', {
            headers: await csrf(request),
            data: { shallow: false },
        });
        const characters = await response.json();
        for (const member of MEMBERS) {
            const card = characters.find((entry) => entry.avatar === `${member.file}.png`);
            expect(card, member.name).toBeTruthy();
            expect(Number(card.talkativeness), member.name).toBe(0);
        }
    });

    test('activates a member whose name has no ASCII letters', async ({ page, request }, testInfo) => {
        await openGroup(page, request, testInfo);
        await openTrace(page);

        await page.locator('textarea[aria-label="Message"]').fill('小明，你怎么看？');
        await page.keyboard.press('Enter');

        // Named, so first — and the only one, the rest being unwilling to talk.
        await expect(traceRow(page, '小明')).toContainText('Named in the message');
        await expect(traceRow(page, '小明')).toContainText('#1');
        await expect(trace(page)).toContainText('1 of 3 replied');

        // The reply is attributed to them, not to the group.
        await expect(page.locator('article').last().locator('header')).toContainText('小明');
    });

    test('gives every member a reason, whether they spoke or not', async ({ page, request }, testInfo) => {
        await openGroup(page, request, testInfo);
        await openTrace(page);

        await page.locator('textarea[aria-label="Message"]').fill('Bram, another round.');
        await page.keyboard.press('Enter');

        await expect(traceRow(page, 'Bram')).toContainText('Named in the message');
        // A member who says nothing still says why: the roll and the threshold
        // it was compared against.
        await expect(traceRow(page, 'Ada')).toContainText(/above their talkativeness of 0\.00/);
        await expect(traceRow(page, '小明')).toContainText(/above their talkativeness of 0\.00/);
        await expect(trace(page).getByRole('listitem')).toHaveCount(3);
    });

    test('sends each member\'s card under its own heading', async ({ page, request }, testInfo) => {
        await openGroup(page, request, testInfo);

        const marker = `oak-${testInfo.testId}`;
        await page.locator('textarea[aria-label="Message"]').fill(`Bram, ${marker}.`);
        await page.keyboard.press('Enter');
        await expect(page.locator('article').last().locator('header')).toContainText('Bram');

        const { body } = await requestContaining(request, marker);
        const prompt = body.prompt;
        // Joined with nothing to attribute them — the classic default — the
        // model gets three descriptions in a row and no way to tell them apart.
        for (const member of MEMBERS) {
            expect(prompt, member.name).toContain(`${member.name}'s description`);
            expect(prompt, member.name).toContain(member.description);
        }
    });

    test('does not claim the group is manual when you pick one member', async ({ page, request }, testInfo) => {
        await openGroup(page, request, testInfo);
        await openTrace(page);

        await page.getByRole('button', { name: 'Ask a member to reply' }).click();
        await page.getByRole('menuitem', { name: 'Bram' }).click();

        await expect(traceRow(page, 'Bram')).toContainText('You asked for this member');
        // This group replies on its own; only *this turn* was hand-picked, and
        // the trace has to say which.
        await expect(trace(page)).toContainText('You picked one member');
        await expect(traceRow(page, 'Ada')).toContainText('You picked another member for this turn');
        await expect(trace(page)).not.toContainText('only replies when you pick someone');
    });

    test('reports a silenced member as silenced, not as passed over', async ({ page, request }, testInfo) => {
        await openGroup(page, request, testInfo, { disabled_members: [AVATARS[2]] });
        await openTrace(page);

        await page.getByRole('button', { name: 'Ask a member to reply' }).click();
        await page.getByRole('menuitem', { name: 'Bram' }).click();

        await expect(traceRow(page, 'Bram')).toContainText('You asked for this member');
        await expect(traceRow(page, '小明')).toContainText('Switched off in this group');
    });

    test('opens with one greeting per member, each in their own voice', async ({ page, request }, testInfo) => {
        await openGroup(page, request, testInfo);

        await page.getByRole('button', { name: 'Let everyone say hello' }).click();

        await expect(page.locator('article')).toHaveCount(MEMBERS.length);
        for (const member of MEMBERS) {
            await expect(
                page.locator('article').filter({ hasText: `${member.name} looks up as you come in.` }),
            ).toHaveCount(1);
        }
    });

    test('describes what each setting does rather than what it is called', async ({ page, request }, testInfo) => {
        const group = await openGroup(page, request, testInfo);

        await page.getByRole('button', { name: 'Group settings' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();

        await expect(dialog.getByRole('combobox', { name: 'Who replies' }))
            .toContainText('Whoever the moment calls for');
        await expect(dialog.getByRole('combobox', { name: 'What the model is told' }))
            .toContainText('All cards together');
        // Every member is listed and can be reordered from the keyboard, which
        // is what makes "everyone, in order" a usable setting.
        for (const member of MEMBERS) {
            await expect(dialog.getByRole('button', { name: `Move ${member.name} down` })).toHaveCount(1);
        }

        await dialog.getByRole('textbox', { name: 'Name' }).fill('The Bent Elm');
        await dialog.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByRole('heading', { name: 'The Bent Elm' })).toBeVisible();

        // Saved, not just re-rendered.
        const saved = await (await request.post('/api/groups/all', {
            headers: await csrf(request),
            data: {},
        })).json();
        expect(saved.find((entry) => entry.id === group.id)?.name).toBe('The Bent Elm');
    });
});
