import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { __test__ } from '../../server/babelParser.js';
import { prepareReplay } from '../../replay/prepareReplay.ts';
import { closeoutPayload, closeoutSentence } from '../helpers/rendererCloseoutFixture.mjs';

test('the app preserves multiple roots, revised plaques and malformed relation evidence through save/reopen', async () => {
  const bundle = __test__.normalizeParseBundle(closeoutPayload(), 'xbar', closeoutSentence, 'gpt', true);
  const stages = bundle.analyses[0].derivationStages;
  const steps = prepareReplay({ sentence: closeoutSentence, derivationStages: stages, includePlayback: true }).playbackSteps;
  const moment = (stageIndex, relationIndex = 0) => steps.findIndex(step => step.replayRelationIdentity?.stageIndex === stageIndex
    && step.replayRelationIdentity?.relationIndex === relationIndex);
  const evidence = process.env.BABEL_CLOSEOUT_EVIDENCE;
  if (evidence) await mkdir(evidence, { recursive: true });
  const server = await createServer({ root: new URL('../../', import.meta.url).pathname, server: { host: '127.0.0.1', port: 0 } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const report = [];
    for (const width of [1600, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 },
        ...(evidence && width === 1600 ? { recordVideo: { dir: evidence, size: { width, height: 1000 } } } : {}) });
      try {
        const page = await context.newPage(), errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        let calls = 0;
        await page.route('**/api/parse', route => { calls++; return route.fulfill({ json: bundle }); });
        await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
        await page.getByRole('textbox', { name: 'Sentence to analyze' }).fill(closeoutSentence);
        await page.getByRole('button', { name: 'Analyze sentence', exact: true }).click();
        await page.locator('svg[data-babel-tree="true"] text').first().waitFor();
        assert.match(await page.locator('svg[data-babel-tree="true"]').textContent(), /The/);
        assert.match(await page.locator('svg[data-babel-tree="true"]').textContent(), /slept/);
        if (evidence) await page.screenshot({ path: path.join(evidence, `app-two-roots-${width}.png`) });
        await page.getByRole('button', { name: 'Derivation Replay', exact: true }).click();
        await page.getByRole('slider', { name: 'Replay frame' }).waitFor();
        if (await page.getByRole('button', { name: 'Pause', exact: true }).count()) await page.getByRole('button', { name: 'Pause', exact: true }).click();
        const go = async index => {
          await page.getByRole('slider', { name: 'Replay frame' }).fill(String(index));
          await page.waitForFunction(i => document.querySelector('svg[data-babel-rendered-step]')?.getAttribute('data-babel-rendered-step') === String(i), index);
        };
        for (const [stage, expected] of [['number: singular'], ['number: plural'], ['number: plural', 'Case: nominative']].entries()) {
          await go(moment(stage));
          const text = await page.locator('.babel-feature-plaque').allTextContents();
          assert.equal(text.length, 1);
          for (const value of expected) assert(text[0].includes(value), text[0]);
          if (stage > 0) assert(!text[0].includes('singular'));
          if (evidence && width === 1600) await page.screenshot({ path: path.join(evidence, `app-value-stage-${stage + 1}.png`) });
        }
        await go(moment(1, 1));
        assert.match(await page.locator('[data-babel-replay-details]').textContent(), /Malformed value control/);
        await page.getByRole('button', { name: 'Next', exact: true }).click();
        const outlines = await page.locator('input[aria-label="Replay frame"], [data-babel-tree="true"]').evaluateAll(elements =>
          elements.map(element => ({ width: getComputedStyle(element).outlineWidth, style: getComputedStyle(element).outlineStyle })));
        assert(outlines.every(outline => outline.style === 'none' || outline.width === '0px'));
        await page.getByRole('button', { name: 'Save to Tree Bank', exact: true }).click();
        await page.getByRole('button', { name: 'Saved', exact: true }).waitFor();
        const stored = await page.evaluate(() => new Promise((resolve, reject) => {
          const request = indexedDB.open('sylvan-architect-babel');
          request.onsuccess = () => { const db = request.result, query = db.transaction('treeBank').objectStore('treeBank').getAll();
            query.onsuccess = () => { resolve(query.result); db.close(); }; query.onerror = () => reject(query.error); };
          request.onerror = () => reject(request.error);
        }));
        assert.equal(stored.length, 1);
        assert.deepEqual(stored[0].bundle.analyses[0].derivationStages, stages);
        await page.reload();
        await page.getByTitle('Open Tree Bank', { exact: true }).click();
        await page.getByRole('button', { name: 'Open Tree', exact: true }).click();
        await page.locator('svg[data-babel-tree="true"] text').first().waitFor();
        assert.match(await page.locator('svg[data-babel-tree="true"]').textContent(), /The/);
        await page.getByRole('button', { name: 'Derivation Replay', exact: true }).click();
        await go(moment(2));
        assert.match(await page.locator('.babel-feature-plaque').textContent(), /Case: nominative/);
        await go(moment(1, 1));
        assert.match(await page.locator('[data-babel-replay-details]').textContent(), /Malformed value control/);
        assert.equal(calls, 1);
        assert.deepEqual(errors, []);
        report.push({ width, saveReopen: true, allClaimMoments: true, multipleRoots: true, errors });
      } finally { await context.close(); }
    }
    if (evidence) await writeFile(path.join(evidence, 'app-verification.json'), JSON.stringify(report, null, 2));
  } finally { await browser?.close(); await server.close(); }
});
