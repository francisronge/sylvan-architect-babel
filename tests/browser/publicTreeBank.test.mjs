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
    await page.waitForFunction(() => window.localStorage.getItem('babel.pendingParse')?.includes('ticket-1'));
    while (checks < 1) await page.waitForTimeout(100);

    await page.reload();
    await page.locator('[data-babel-waiting-tree]').waitFor();
    assert.match(await page.locator('[data-babel-waiting-tree]').textContent(), /Mia laughed\./, 'the waiting screen names the resumed sentence');
    await replayShown(page);
    await page.getByRole('button', { name: 'Tree Bank, 1 saved', exact: true }).waitFor();
    assert.equal(sent.filter(body => body.start).length, 1, 'one start across the reload');
    assert.equal(await page.evaluate(() => window.localStorage.getItem('babel.pendingParse')), null, 'a finished parse is forgotten');
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); await server.close(); }
});
