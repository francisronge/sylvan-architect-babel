import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = new URL('../../', import.meta.url).pathname;
const saved = JSON.parse(await readFile(new URL('../../fixtures/normalized/mia-laughed.xbar.json', import.meta.url), 'utf8'));
const bundle = { ...saved, sentence: 'Mia laughed.', inputTokens: ['Mia', 'laughed', '.'],
  ambiguityDetected: true, analyses: [saved.analyses[0], saved.analyses[0]] };

test('app survives failed requests and aborted Tree Bank writes, and reopens the saved analysis faithfully', async () => {
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: false } });
  let browser;
  try {
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({ headless: true });
    const evidence = process.env.BABEL_WORKFLOW_EVIDENCE;
    if (evidence) await mkdir(evidence, { recursive: true });
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'],
        ...(evidence ? { recordVideo: { dir: evidence, size: { width, height: 1000 } } } : {}) });
      try {
        const page = await context.newPage();
        const errors = []; page.on('pageerror', error => errors.push(String(error)));
        let failRequest = true;
        const requests = [];
        await context.route('**/api/parse', route => {
          requests.push(route.request().postDataJSON());
          return route.fulfill({ status: failRequest ? 503 : 200,
            json: failRequest ? { error: { code: 'MODEL_UNAVAILABLE', message: 'Fixture request interrupted.' } } : bundle });
        });
        // Abort a real IndexedDB transaction after its individual request succeeds.
        await context.addInitScript(() => {
          for (const method of ['put', 'delete']) {
            const original = IDBObjectStore.prototype[method];
            IDBObjectStore.prototype[method] = function (...args) {
              const request = original.apply(this, args);
              request.addEventListener('success', () => {
                if (window.abortTreeBankOperation === method) {
                  window.abortTreeBankOperation = null;
                  this.transaction.abort();
                }
              });
              return request;
            };
          }
        });
        const entries = () => page.evaluate(() => new Promise((resolve, reject) => {
          const request = indexedDB.open('sylvan-architect-babel');
          request.onsuccess = () => {
            const db = request.result, query = db.transaction('treeBank').objectStore('treeBank').getAll();
            query.onsuccess = () => { resolve(query.result); db.close(); };
            query.onerror = () => { reject(query.error); db.close(); };
          };
          request.onerror = () => reject(request.error);
        }));
        const ready = () => page.locator('svg[data-babel-tree="true"]').waitFor();
        await page.goto(base);
        await page.getByRole('textbox', { name: 'Sentence to analyze' }).fill(bundle.sentence);
        await page.getByRole('button', { name: 'Analyze sentence', exact: true }).click();
        await page.getByText('Fixture request interrupted.', { exact: true }).waitFor();
        assert.equal(await page.getByRole('textbox', { name: 'Sentence to analyze' }).inputValue(), bundle.sentence);
        failRequest = false;
        await page.getByRole('button', { name: 'Analyze sentence', exact: true }).click();
        await ready();
        await page.getByRole('button', { name: 'Parse 2', exact: true }).click();
        await page.getByRole('button', { name: 'Derivation Replay', exact: true }).click();
        await page.getByRole('slider', { name: 'Replay frame' }).waitFor();
        if (await page.getByRole('button', { name: 'Pause', exact: true }).count()) await page.getByRole('button', { name: 'Pause', exact: true }).click();
        await page.getByRole('slider', { name: 'Replay frame' }).fill('0');
        await page.getByRole('button', { name: 'Next', exact: true }).focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('svg[data-babel-rendered-step]')?.getAttribute('data-babel-rendered-step') === '1');
        await page.getByRole('button', { name: 'X-Bar Theory', exact: true }).click();
        await page.evaluate(() => { window.abortTreeBankOperation = 'put'; });
        await page.getByRole('button', { name: 'Save to Tree Bank', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: 'Unable to save' }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Saved', exact: true }).count(), 0);
        assert.equal((await entries()).length, 0);
        if (evidence) await page.screenshot({ path: path.join(evidence, `save-failed-${width}.png`) });
        await page.getByRole('button', { name: 'Save to Tree Bank', exact: true }).click();
        await page.getByRole('button', { name: 'Saved', exact: true }).waitFor();
        const records = await entries();
        assert.equal(records.length, 1);
        assert.equal(records[0].framework, 'xbar', 'changing the next request must not relabel the saved analysis');
        assert.equal(records[0].activeParseIndex, 1);
        assert.deepEqual(records[0].bundle.inputTokens, bundle.inputTokens);
        assert.deepEqual(records[0].bundle.analyses.map(a => a.derivationStages), bundle.analyses.map(a => a.derivationStages));
        assert.match(records[0].treeSnapshotDataUrl, /^data:image\/svg\+xml/);
        assert.equal(await page.getByRole('alert').count(), 0);
        await page.reload();
        await page.getByTitle('Open Tree Bank', { exact: true }).click();
        await page.getByRole('button', { name: 'Open Tree', exact: true }).waitFor();
        if (evidence) await page.screenshot({ path: path.join(evidence, `saved-${width}.png`) });
        await page.getByRole('button', { name: 'Open Tree', exact: true }).click();
        await ready();
        await page.getByRole('button', { name: 'X-Bar Theory', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Parse 2', exact: true }).getAttribute('aria-pressed'), 'true');
        await page.getByRole('button', { name: 'Notes', exact: true }).click();
        await page.getByRole('button', { name: 'Copy Canopy', exact: true }).click();
        assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Mia/);
        await page.getByTitle('Open Tree Bank', { exact: true }).click();
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
        await page.evaluate(() => { window.abortTreeBankOperation = 'delete'; });
        await page.getByRole('button', { name: 'Delete Tree', exact: true }).click();
        await page.getByText('Unable to delete this saved tree.', { exact: true }).waitFor();
        assert.equal((await entries()).length, 1);
        await page.getByRole('button', { name: 'Delete Tree', exact: true }).click();
        await page.getByText('No saved trees yet', { exact: true }).waitFor();
        assert.equal((await entries()).length, 0);
        assert.equal(requests.length, 2, 'only the two explicitly mocked submissions occurred');
        assert.equal(requests[1].framework, 'xbar');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  } finally { await browser?.close(); await server.close(); }
});
