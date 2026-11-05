import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { normalizeParseBundle } from '../../server/babelParser/parseNormalization.js';
import { startBrowserTestServer } from '../helpers/browserTestServer.mjs';
import { readTreeBankSnapshot } from '../helpers/browserTreeBank.mjs';

// This file serves public Babel; node --test runs each file in its own process.
process.env.BABEL_APP = 'public';

const root = fileURLToPath(new URL('../../', import.meta.url));
const saved = JSON.parse(await readFile(new URL('../../fixtures/normalized/mia-laughed.xbar.json', import.meta.url), 'utf8'));
const bundle = { ...normalizeParseBundle({ analyses: [{ derivationStages: saved.analyses[0].derivationStages }] },
  'minimalism', 'Mia laughed.', 'gpt', true), sentence: 'Mia laughed.' };

const starButton = page => page.getByRole('button', { name: 'Star', exact: true });
const replayShown = page => page.locator('[data-babel-replay-panel]').waitFor();
const works = async page => (await readTreeBankSnapshot(page)).savedWorks;

test('public Babel saves every finished parse, and the star keeps it across a reload', { timeout: 180_000 }, async t => {
  const server = await startBrowserTestServer({ root });
  try {
    for (const [name, engine, width] of [['chromium', chromium, 1440], ['webkit', webkit, 390]]) await t.test(`${name} ${width}px`, async () => {
      const browser = await engine.launch({ headless: true });
      let context;
      try {
        context = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await context.newPage(), errors = [];
        let requests = 0;
        page.on('pageerror', error => errors.push(String(error)));
        await context.route('**/api/parse', route => { requests++; return route.fulfill({ status: 200, json: bundle }); });
        await page.goto(server.url);
        await page.getByRole('textbox', { name: 'Sentence to analyze' }).fill('Mia laughed.');
        await page.getByRole('button', { name: 'Analyze sentence', exact: true }).click();
        await replayShown(page);

        // Saved as it arrives, unstarred, with nothing pressed.
        await page.getByRole('button', { name: 'Tree Bank, 1 saved', exact: true }).waitFor();
        const [first] = await works(page);
        assert.equal(first.sentence, 'Mia laughed.');
        assert.equal(first.framework, 'minimalism');
        assert.equal('kept' in first, false);
        assert.equal(await starButton(page).getAttribute('aria-pressed'), 'false');

        await starButton(page).click();
        await page.locator('button[aria-pressed="true"]', { hasText: 'Star' }).waitFor();
        const [starred] = await works(page);
        assert.equal(starred.kept, true);
        assert.equal(starred.updatedAt, first.updatedAt, 'starring keeps the order');

        // A second parse is a second entry, unstarred.
        await page.getByRole('button', { name: 'Babel, parse a new sentence' }).click();
        await page.getByRole('button', { name: 'Analyze sentence', exact: true }).click();
        await page.getByRole('button', { name: 'Tree Bank, 2 saved', exact: true }).waitFor();
        assert.equal(await starButton(page).getAttribute('aria-pressed'), 'false');
        assert.deepEqual((await works(page)).map(work => work.kept === true).sort(), [false, true]);

        // After a reload, the starred entry opens starred and unstarring is stored.
        await page.reload();
        await page.getByRole('button', { name: 'Tree Bank, 2 saved', exact: true }).click();
        const cards = page.getByRole('button', { name: 'Open Tree', exact: true });
        await cards.first().waitFor();
        const starredIndex = (await works(page)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || 0)
          .findIndex(work => work.kept === true);
        await cards.nth(starredIndex).click();
        await replayShown(page);
        await page.locator('button[aria-pressed="true"]', { hasText: 'Star' }).waitFor();
        await starButton(page).click();
        await page.locator('button[aria-pressed="false"]', { hasText: 'Star' }).waitFor();
        assert.ok((await works(page)).every(work => !('kept' in work)), 'unstarring removes the flag');
        assert.equal((await works(page)).length, 2, 'opening a saved entry saves nothing new');

        assert.equal(requests, 2);
        assert.deepEqual(errors, []);
      } finally { await context?.close(); await browser.close(); }
    });
  } finally { await server.close(); }
});

test('a reload while the tree grows picks the same parse back up, with no second start', { timeout: 120_000 }, async () => {
  const server = await startBrowserTestServer({ root });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage(), errors = [], sent = [];
    page.on('pageerror', error => errors.push(String(error)));
    let checks = 0;
    await context.route('**/api/parse', route => {
      const body = route.request().postDataJSON();
      sent.push(body);
      if (body.start) return route.fulfill({ status: 200, json: { status: 'pending', ticket: 'ticket-1' } });
      assert.deepEqual(body, { ticket: 'ticket-1' });
      checks++;
      // The first two checks find the model still writing.
      return route.fulfill({ status: 200, json: checks <= 2 ? { status: 'pending', ticket: 'ticket-1' } : bundle });
    });
    await page.goto(server.url);
    await page.getByRole('textbox', { name: 'Sentence to analyze' }).fill('Mia laughed.');
    await page.getByRole('button', { name: 'Analyze sentence', exact: true }).click();
    await page.locator('[data-babel-waiting-tree]').waitFor();
    await page.waitForFunction(() => window.sessionStorage.getItem('babel.pendingParse')?.includes('ticket-1'));
    while (checks < 1) await page.waitForTimeout(100);

    await page.reload();
    await page.locator('[data-babel-waiting-tree]').waitFor();
    assert.match(await page.locator('[data-babel-waiting-tree]').textContent(), /Mia laughed\./, 'the waiting screen names the resumed sentence');
    await replayShown(page);
    await page.getByRole('button', { name: 'Tree Bank, 1 saved', exact: true }).waitFor();
    assert.equal(sent.filter(body => body.start).length, 1, 'one start across the reload');
    assert.equal(await page.evaluate(() => window.sessionStorage.getItem('babel.pendingParse')), null, 'a finished parse is forgotten');
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); await server.close(); }
});

test('two tabs remember their own parses: one finishing never loses or replaces the other', { timeout: 120_000 }, async () => {
  const server = await startBrowserTestServer({ root });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const finished = new Set(), starts = [];
    await context.route('**/api/parse', route => {
      const body = route.request().postDataJSON();
      if (body.start) {
        const ticket = `ticket-${body.sentence.split(' ')[0]}`;
        starts.push(ticket);
        return route.fulfill({ status: 200, json: { status: 'pending', ticket } });
      }
      return route.fulfill({ status: 200, json: finished.has(body.ticket) ? bundle : { status: 'pending', ticket: body.ticket } });
    });
    const [first, second] = [await context.newPage(), await context.newPage()];
    for (const [page, sentence] of [[first, 'Mia laughed.'], [second, 'Nia laughed.']]) {
      await page.goto(server.url);
      await page.getByRole('textbox', { name: 'Sentence to analyze' }).fill(sentence);
      await page.getByRole('button', { name: 'Analyze sentence', exact: true }).click();
      await page.locator('[data-babel-waiting-tree]').waitFor();
    }
    while (starts.length < 2) await first.waitForTimeout(50);
    // The second tab's parse finishes; the first is still being written.
    finished.add('ticket-Nia');
    await replayShown(second);
    await first.reload();
    await first.locator('[data-babel-waiting-tree]').waitFor();
    assert.match(await first.locator('[data-babel-waiting-tree]').textContent(), /Mia laughed\./, 'the first tab resumes its own sentence');
    finished.add('ticket-Mia');
    await replayShown(first);
    assert.deepEqual(starts, ['ticket-Mia', 'ticket-Nia'], 'no tab started again');
    await context.close();
  } finally { await browser.close(); await server.close(); }
});

test('a failed parse shows its failure screen; Try again parses the same sentence and Edit returns to it', { timeout: 120_000 }, async () => {
  const server = await startBrowserTestServer({ root });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [], sent = [];
    page.on('pageerror', error => errors.push(String(error)));
    const replies = [
      { status: 502, json: { error: { code: 'BAD_MODEL_RESPONSE', message: 'scripted provider text',
        failure: { class: 'linguistic_failure', ruleId: 'SPELLOUT_MISMATCH', stageIndex: null, fieldPath: '$', offendingValue: null } } } },
      { status: 200, json: bundle },
      { status: 503, json: { error: { code: 'PROVIDER_UNAVAILABLE', message: 'scripted' } } },
      { status: 429, json: { error: { code: 'RATE_LIMITED_DAILY', message: 'scripted' } } }
    ];
    await context.route('**/api/parse', route => { sent.push(route.request().postDataJSON()); return route.fulfill(replies.shift()); });
    await page.goto(server.url);
    await page.getByRole('textbox', { name: 'Sentence to analyze' }).fill('Mia laughed.');
    await page.getByRole('button', { name: 'Analyze sentence', exact: true }).click();

    // The model's analysis was unusable: the broken tree, and another try.
    const screen = page.locator('[data-babel-failure-screen]');
    await page.locator('[data-babel-failure-screen="broken"]').waitFor();
    assert.match(await screen.innerText(), /This tree came out broken\.[\s\S]*didn't hold together/);
    assert.ok(!(await screen.innerText()).includes('scripted provider text'), 'the provider text never shows');
    assert.equal(await page.getByRole('textbox', { name: 'Sentence to analyze' }).count(), 0, 'the screen replaces the sentence bar');
    const retry = page.getByRole('button', { name: 'Try again', exact: true });
    assert.equal(await retry.evaluate(button => button === document.activeElement), true, 'focus moves to the first action');
    await retry.click();
    await replayShown(page);
    assert.equal(sent[1].sentence, 'Mia laughed.', 'Try again parses the same sentence');
    await page.getByRole('button', { name: 'Tree Bank, 1 saved', exact: true }).waitFor();

    // No answer: Edit returns to the sentence box with the sentence.
    await page.getByRole('button', { name: 'Babel, parse a new sentence' }).click();
    await page.getByRole('textbox', { name: 'Sentence to analyze' }).fill('Nia smiled.');
    await page.getByRole('button', { name: 'Analyze sentence', exact: true }).click();
    await page.locator('[data-babel-failure-screen="noAnswer"]').waitFor();
    await page.getByRole('button', { name: 'Edit sentence', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: 'Sentence to analyze' }).inputValue(), 'Nia smiled.');
    assert.equal(await screen.count(), 0);

    // Today's parses are used: no retry, the Tree Bank instead.
    await page.getByRole('button', { name: 'Analyze sentence', exact: true }).click();
    await page.locator('[data-babel-failure-screen="visitorLimit"]').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Try again', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Open Tree Bank', exact: true }).click();
    await page.getByRole('button', { name: 'Open Tree', exact: true }).first().waitFor();
    assert.equal(await screen.count(), 0);

    // The sentence box stops a sentence the server would refuse.
    await page.getByRole('button', { name: 'Babel, parse a new sentence' }).click();
    await page.getByRole('textbox', { name: 'Sentence to analyze' }).fill('a'.repeat(700));
    assert.equal((await page.getByRole('textbox', { name: 'Sentence to analyze' }).inputValue()).length, 600);
    assert.equal(sent.length, 4);
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); await server.close(); }
});
