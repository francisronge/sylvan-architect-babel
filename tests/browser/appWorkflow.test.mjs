import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { normalizeParseBundle } from '../../server/babelParser/parseNormalization.js';
import { ParseApiError } from '../../server/babelParser/error.js';
import { parseModelJson } from '../../server/babelParser/modelJson.js';
import { attachGenerationFailureEvidence } from '../../server/babelParser/routeErrors.js';
import { formatApiError } from '../../server/parseApi.js';
import { createRawOutputArtifact } from '../../server/babelParser/validationErrors.js';
import { waitForCanopyPaint, waitForReplayPaint, waitForNotesPaint } from '../../scripts/captureReadiness.mjs';
import { startBrowserTestServer } from '../helpers/browserTestServer.mjs';
import { readTreeBankSnapshot } from '../helpers/browserTreeBank.mjs';
import { recordVideo } from '../helpers/browserVideo.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const saved = JSON.parse(await readFile(new URL('../../fixtures/normalized/mia-laughed.xbar.json', import.meta.url), 'utf8'));
const bundle = { ...saved, sentence: 'Mia laughed.', inputTokens: ['Mia', 'laughed', '.'],
  ambiguityDetected: true, analyses: [saved.analyses[0], saved.analyses[0]] };
const sentenceInput = page => page.getByRole('textbox', { name: 'Sentence to analyze' });

/** Replay gives the sentence input's place to the tree and its panel, and
 * leaves no hidden control behind to receive focus. */
async function assertReplayWithoutInput(page) {
  assert.equal(await sentenceInput(page).count(), 0, 'Replay removes the sentence input');
  assert.equal(await page.locator('[data-babel-tree-controls="bottom"]').count(), 0, 'Replay removes the input bar and its restore control');
  const clearance = await page.locator('[data-babel-replay-panel]').evaluate(panel =>
    panel.closest('[data-babel-workspace]').getBoundingClientRect().bottom - panel.getBoundingClientRect().bottom);
  assert.ok(clearance <= 24, `the Replay panel takes the input bar's place: ${clearance}px below it`);
}

test('recovered optional word addresses render quietly and survive Tree Bank reload', { timeout: 120_000 }, async () => {
  const sentence = 'Mia smiled.';
  const analysis = prefix => ({ derivationStages: [
    { statement: 'Select the words.', stageRecord: 'Mia and smiled enter the workspace.', relations: [], workspaceForest: [
      { id: `${prefix}subject`, label: 'N', word: 'Mia', tokenIndex: 1, children: [] },
      { id: `${prefix}verb`, label: 'V', word: 'smiled', tokenIndex: 0, children: [] }
    ] },
    { statement: 'Construct the clause.', stageRecord: 'Mia is the subject of smiled.', relations: [], workspaceForest: [
      { id: `${prefix}clause`, label: prefix === 'a' ? 'TP' : 'IP', children: [
        { refId: `${prefix}subject` }, { refId: `${prefix}verb` }
      ] }
    ] }
  ] });
  const payload = { analyses: [analysis('a'), analysis('b')] }, raw = JSON.stringify(payload);
  const recovered = { ...normalizeParseBundle(payload, 'xbar', sentence, 'gpt', true),
    sentence, rawModelOutput: createRawOutputArtifact(raw) };
  const server = await startBrowserTestServer({ root });
  const output = process.env.BABEL_WORKFLOW_EVIDENCE || await mkdtemp(path.join(os.tmpdir(), 'babel-token-recovery-'));
  await mkdir(output, { recursive: true });
  try {
    for (const [name, engine, width] of [['chromium', chromium, 1440], ['webkit', webkit, 390]]) {
      const browser = await engine.launch({ headless: true });
      let context;
      try {
        context = await browser.newContext({ viewport: { width, height: 1000 } });
        const page = await context.newPage(), errors = [];
        let requests = 0;
        page.on('pageerror', error => errors.push(String(error)));
        await context.route('**/api/parse', route => { requests++; return route.fulfill({ status: 200, json: recovered }); });
        await page.goto(server.url);
        await page.getByRole('textbox', { name: 'Sentence to analyze' }).fill(sentence);
        await page.getByRole('button', { name: 'Analyze sentence', exact: true }).click();
        await waitForCanopyPaint(page);
        assert.equal(await page.getByRole('alert').count(), 0);
        await page.getByRole('button', { name: 'Parse 2', exact: true }).click();
        await waitForCanopyPaint(page);
        assert.match(await page.locator('svg[data-babel-tree]').textContent(), /IP/);
        await page.getByRole('button', { name: 'Derivation Replay', exact: true }).click();
        await page.getByRole('button', { name: 'Pause', exact: true }).click();
        const slider = page.getByRole('slider', { name: 'Replay frame' });
        const finalFrame = Number(await slider.getAttribute('max'));
        await slider.fill(String(finalFrame));
        await waitForReplayPaint(page, finalFrame);
        await page.screenshot({ path: path.join(output, `token-recovery-${name}-${width}.png`) });
        await page.getByRole('button', { name: 'Save to Tree Bank', exact: true }).click();
        await page.getByRole('button', { name: 'Saved', exact: true }).waitFor();
        const stored = await readTreeBankSnapshot(page), work = stored.savedWorks[0];
        assert.deepEqual(work.analysisIds.map(id => stored.records.find(record => record.id === id).payload.provenance.tokenIndexCorrections),
          recovered.analyses.map(result => result.provenance.tokenIndexCorrections));
        const savedContext = stored.records.find(record => record.id === work.contextId).payload;
        assert.equal(Buffer.from(savedContext.rawModelOutput.data, 'base64').toString(), raw);
        await page.reload();
        await page.getByTitle('Open Tree Bank', { exact: true }).click();
        await page.getByRole('button', { name: 'Open Tree', exact: true }).click();
        await waitForReplayPaint(page, finalFrame);
        assert.equal(await page.getByRole('alert').count(), 0);
        assert.equal(requests, 1, 'recovery and saved reopening never request a replacement');
        assert.deepEqual(errors, []);
      } finally { await context?.close(); await browser.close(); }
    }
  } finally { await server.close(); }
});

test('failed submissions preserve the selected analysis and paused Replay, then a new submission recovers', { timeout: 180_000 }, async t => {
  const stages = structuredClone(saved.analyses[0].derivationStages);
  for (const stage of stages) for (const node of stage.workspaceForest) if (node.id === 'tp_root') node.label = 'IP';
  const distinct = { ...normalizeParseBundle({ analyses: [
    { derivationStages: saved.analyses[0].derivationStages }, { derivationStages: stages }
  ] }, 'xbar', 'Mia laughed.', 'gpt', true), sentence: 'Mia laughed.' };
  assert.notDeepEqual(distinct.analyses[0].finalForest, distinct.analyses[1].finalForest);
  const malformedText = 'not a JSON object 🙂\n';
  let malformed;
  try { parseModelJson(malformedText); assert.fail('Controlled output must be malformed.'); }
  catch (error) {
    assert.ok(error instanceof ParseApiError);
    malformed = formatApiError(attachGenerationFailureEvidence({ error, ParseApiError, rawText: malformedText,
      generationRecord: { provider: 'gpt', model: 'controlled-model', runId: 'controlled-malformed-output',
        outcome: { finishStatus: 'COMPLETED', attempts: [{ attemptNumber: 1, outcome: 'completed' }] } } }));
  }
  const server = await startBrowserTestServer({ root });
  const output = process.env.BABEL_WORKFLOW_EVIDENCE || await mkdtemp(path.join(os.tmpdir(), 'babel-recovery-'));
  await mkdir(output, { recursive: true });
  const observations = [];
  try {
    for (const [engine, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await browserType.launch({ headless: true });
      try {
        for (const width of [1440, 390]) await t.test(`${engine} ${width}px`, async () => {
          const context = await browser.newContext({ viewport: { width, height: 1000 },
            ...(process.env.BABEL_WORKFLOW_EVIDENCE && engine === 'chromium' && width === 1440
              ? recordVideo(output, { width, height: 1000 }) : {}) });
          const page = await context.newPage(), errors = [];
          let response = 'complete', requests = 0;
          page.on('pageerror', error => errors.push(String(error)));
          await context.route('**/api/parse', route => {
            requests++;
            if (response === 'connection-closed') return route.abort('connectionclosed');
            if (response === 'invalid-json') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"analyses":' });
            if (response === 'empty-result') return route.fulfill({ status: 200, json: { analyses: [] } });
            if (response === 'malformed-model-output') return route.fulfill({ status: malformed.status, json: malformed.body });
            if (response === 'provider-unavailable') return route.fulfill({ status: 503, json: {
              error: { code: 'MODEL_UNAVAILABLE', message: 'Controlled provider interruption.' }
            } });
            return route.fulfill({ status: 200, json: distinct });
          });
          try {
            await page.goto(server.url);
            await page.getByRole('textbox', { name: 'Sentence to analyze' }).fill(distinct.sentence);
            await page.getByRole('button', { name: 'Analyze sentence', exact: true }).click();
            await waitForCanopyPaint(page);
            const pollen = page.locator('.spore-layer .spore');
            const initialTransforms = await pollen.evaluateAll(elements => elements.map(element => getComputedStyle(element).transform));
            await page.waitForFunction(before => [...document.querySelectorAll('.spore-layer .spore')]
              .some((element, index) => getComputedStyle(element).transform !== before[index]), initialTransforms);
            // Spores move together, so a frame never changes only some of them.
            const movement = await page.evaluate(() => new Promise(resolve => {
              const spores = [...document.querySelectorAll('.spore-layer .spore')];
              let previous = spores.map(element => element.style.transform), frames = 0, moving = 0, partial = 0;
              const sample = () => {
                const current = spores.map(element => element.style.transform);
                const moved = current.filter((transform, index) => transform !== previous[index]).length;
                if (moved) moving += 1;
                if (moved && moved !== spores.length) partial += 1;
                previous = current;
                if (++frames < 120) requestAnimationFrame(sample); else resolve({ moving, partial });
              };
              requestAnimationFrame(sample);
            }));
            assert.ok(movement.moving > 0, 'the pollen keeps moving');
            assert.equal(movement.partial, 0, 'all spores move in the same frame');
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const stillTransforms = await pollen.evaluateAll(elements => elements.map(element => getComputedStyle(element).transform));
            await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 250)));
            assert.deepEqual(await pollen.evaluateAll(elements => elements.map(element => getComputedStyle(element).transform)),
              stillTransforms, 'the pollen respects reduced motion');
            await page.emulateMedia({ reducedMotion: 'no-preference' });
            for (const headerWidth of [768, 1024, 1063, 1280, 1440, 1536, 1600, 1920, 2560, width]) {
              await page.setViewportSize({ width: headerWidth, height: 1000 });
              await page.waitForFunction(() => !document.getAnimations().some(animation =>
                Number.isFinite(animation.effect?.getComputedTiming().endTime) && (animation.pending || animation.playState === 'running')));
              await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
              const clipped = await page.getByRole('banner').evaluate(header => [...header.querySelectorAll('button,select')]
                .filter(element => { const box = element.getBoundingClientRect(); return box.left < 0 || box.right > innerWidth; })
                .map(element => element.textContent.trim()));
              assert.deepEqual(clipped, [], `all header controls remain reachable at ${headerWidth}px`);
              if (headerWidth >= 1280) {
                const centers = await page.getByRole('banner').evaluate(header => [...header.querySelectorAll('button,select')]
                  .map(element => { const box = element.getBoundingClientRect(); return box.y + box.height / 2; }));
                assert.ok(Math.max(...centers) - Math.min(...centers) < 1, `desktop controls share one row at ${headerWidth}px: ${centers}`);
                const gap = await page.getByRole('banner').evaluate(header => {
                  const buttons = [...header.querySelectorAll('button')];
                  const glyphing = buttons.find(button => button.textContent.includes('Constituent Glyphing'));
                  const save = buttons.find(button => button.textContent.includes('Save to Tree Bank'));
                  return save.getBoundingClientRect().left - glyphing.getBoundingClientRect().right;
                });
                assert.ok(gap >= 8 && gap <= 16, `no expanding gap between Glyphing and Save: ${gap}px`);
                const remaining = await page.getByRole('banner').evaluate(header => {
                  const buttons = [...header.querySelectorAll('button')];
                  return innerWidth - parseFloat(getComputedStyle(header).paddingRight) - buttons.at(-1).getBoundingClientRect().right;
                });
                assert.ok(Math.abs(remaining) < 1, `controls fill the available header row at ${headerWidth}px: ${remaining}px unused`);
              }
              if (headerWidth >= 1600) assert.ok(await page.getByRole('banner').evaluate(header => header.getBoundingClientRect().height < 80),
                'the brand and desktop controls share one row');
              if (headerWidth >= 1280) {
                await page.getByRole('button', { name: 'X-Bar Theory', exact: true }).click();
                await page.getByRole('button', { name: 'Minimalist Program', exact: true }).waitFor();
                assert.ok(await page.getByRole('banner').evaluate(header => [...header.querySelectorAll('button,select')]
                  .every(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; })),
                  'the longer framework name also fits');
                await page.getByRole('button', { name: 'Minimalist Program', exact: true }).click();
              }
            }
            if (engine === 'chromium' && width === 1440) {
              await page.bringToFront();
              await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
              await page.getByRole('button', { name: 'Exit Fullscreen', exact: true }).waitFor();
              assert.equal(await page.evaluate(() => document.fullscreenElement === document.documentElement), true);
              await page.getByRole('button', { name: 'Exit Fullscreen', exact: true }).click();
              await page.getByRole('button', { name: 'Fullscreen', exact: true }).waitFor();
              assert.equal(await page.evaluate(() => document.fullscreenElement), null);
              await page.evaluate(() => {
                window.originalFullscreenRequest = document.documentElement.requestFullscreen;
                document.documentElement.requestFullscreen = () => Promise.reject(new TypeError('not granted'));
              });
              await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
              await page.getByRole('alert').filter({ hasText: 'The browser blocked fullscreen.' }).waitFor();
              await page.evaluate(() => {
                document.documentElement.requestFullscreen = window.originalFullscreenRequest;
                delete window.originalFullscreenRequest;
              });
              await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
              await page.getByRole('button', { name: 'Exit Fullscreen', exact: true }).waitFor();
              assert.equal(await page.getByRole('alert').count(), 0, 'a successful retry clears the fullscreen error');
              await page.getByRole('button', { name: 'Exit Fullscreen', exact: true }).click();
              await page.getByRole('button', { name: 'Fullscreen', exact: true }).waitFor();
            }
            assert.match(await page.locator('svg[data-babel-tree]').textContent(), /TP/);
            await page.getByRole('button', { name: 'Parse 2', exact: true }).click();
            await waitForCanopyPaint(page);
            assert.match(await page.locator('svg[data-babel-tree]').textContent(), /IP/);
            await page.getByRole('button', { name: 'Derivation Replay', exact: true }).click();
            await page.getByRole('button', { name: 'Pause', exact: true }).click();
            await page.getByRole('slider', { name: 'Replay frame' }).fill('4');
            await waitForReplayPaint(page, 4);
            await assertReplayWithoutInput(page);
            await page.screenshot({ path: path.join(output, `recovery-before-${engine}-${width}.png`) });
            // A new sentence is entered from Canopy. Its failure keeps the input
            // in Replay, so the later attempts are retried from there.
            await page.getByRole('button', { name: 'Canopy', exact: true }).click();
            await waitForCanopyPaint(page);
            const failedDraft = 'Nia laughed.';
            await sentenceInput(page).fill(failedDraft);
            for (const [attempt, kind] of ['connection-closed', 'invalid-json', 'empty-result', 'provider-unavailable', 'malformed-model-output'].entries()) {
              response = kind;
              const request = page.waitForRequest('**/api/parse');
              await page.getByRole('button', { name: 'Analyze sentence', exact: true }).click();
              await request;
              await page.getByRole('button', { name: 'Analyze sentence', exact: true }).waitFor();
              if (attempt === 0) {
                await waitForCanopyPaint(page);
                await page.getByRole('button', { name: 'Derivation Replay', exact: true }).click();
              }
              await waitForReplayPaint(page, 4);
              assert.equal(await page.getByRole('button', { name: 'Parse 2', exact: true }).getAttribute('aria-pressed'), 'true');
              assert.equal(await page.getByRole('slider', { name: 'Replay frame' }).inputValue(), '4');
              assert.equal(await page.getByRole('button', { name: 'Pause', exact: true }).count(), 0);
              assert.equal(await page.getByRole('button', { name: 'Play', exact: true }).count(), 1);
              assert.ok(await sentenceInput(page).isVisible(), 'a failure keeps the input in Replay');
              assert.equal(await sentenceInput(page).inputValue(), failedDraft);
              assert.equal(await page.getByRole('alert').count(), 1, 'failure remains visible and announced');
              if (kind === 'malformed-model-output') {
                // Choosing the next request's model or effort keeps this failure and its downloads.
                const [model, effort] = [0, 1].map(index => page.getByRole('banner').locator('select').nth(index));
                const selectAnother = async select => select.selectOption(await select.locator('option').evaluateAll(
                  (options, current) => options.map(option => option.value).find(value => value !== current), await select.inputValue()));
                const selectedModel = await model.inputValue();
                await selectAnother(model);
                await selectAnother(effort);
                await model.selectOption(selectedModel);
                assert.equal(await page.getByRole('alert').count(), 1, 'changing the model or effort keeps the failure');
                assert.equal(await page.getByRole('button', { name: /^Download raw output/ }).count(), 1);
                const rawDownload = page.waitForEvent('download');
                await page.getByRole('button', { name: /^Download raw output/ }).click();
                assert.equal(await readFile(await (await rawDownload).path(), 'utf8'), malformedText);
                const recordDownload = page.waitForEvent('download');
                await page.getByRole('button', { name: 'Download failure record', exact: true }).click();
                const retained = JSON.parse(await readFile(await (await recordDownload).path(), 'utf8'));
                assert.deepEqual(retained.failure, malformed.body.error.failure);
                assert.deepEqual(retained.rawOutput, malformed.body.error.rawOutput);
                assert.equal(retained.input.sentence, failedDraft);
                assert.equal(retained.generationRecord.runId, 'controlled-malformed-output');
                await page.getByRole('button', { name: 'Inspect failed output', exact: true }).click();
                await page.getByRole('dialog').waitFor();
                await page.getByRole('button', { name: 'Close inspection', exact: true }).click();
                assert.equal(await page.getByRole('dialog').count(), 0);
                await waitForReplayPaint(page, 4);
              }
              observations.push({ engine, width, kind, selectedAnalysis: 2, replayStep: 4, paused: true });
            }
            await page.screenshot({ path: path.join(output, `recovery-after-${engine}-${width}.png`) });
            await page.getByRole('button', { name: 'Save to Tree Bank', exact: true }).click();
            await page.getByRole('button', { name: 'Saved', exact: true }).waitFor();
            const stored = await readTreeBankSnapshot(page);
            assert.equal(stored.savedWorks.length, 1);
            const work = stored.savedWorks[0];
            assert.equal(work.sentence, distinct.sentence, 'the failed draft does not relabel the accepted work');
            assert.equal(work.activeParseIndex, 1);
            assert.equal(work.replayStep, 4);
            assert.deepEqual(work.analysisIds.map(id => stored.records.find(record => record.id === id).payload),
              JSON.parse(JSON.stringify(distinct.analyses)));
            await page.reload();
            await page.getByTitle('Open Tree Bank', { exact: true }).click();
            await page.getByRole('button', { name: 'Open Tree', exact: true }).click();
            await waitForReplayPaint(page, 4);
            assert.equal(await page.getByRole('button', { name: 'Parse 2', exact: true }).getAttribute('aria-pressed'), 'true');
            assert.equal(await page.getByRole('button', { name: 'Play', exact: true }).count(), 1);
            await assertReplayWithoutInput(page);
            await page.getByRole('button', { name: 'Notes', exact: true }).click();
            await waitForNotesPaint(page);
            assert.ok(await sentenceInput(page).isVisible(), 'Notes keeps the sentence input');
            await page.getByRole('button', { name: 'Canopy', exact: true }).click();
            await waitForCanopyPaint(page);
            assert.match(await page.locator('svg[data-babel-tree]').textContent(), /IP/);
            response = 'complete';
            await page.getByRole('button', { name: 'Analyze sentence', exact: true }).click();
            await waitForCanopyPaint(page);
            assert.equal(await page.getByRole('button', { name: 'Parse 1', exact: true }).getAttribute('aria-pressed'), 'true');
            assert.equal(await page.getByRole('alert').count(), 0);
            assert.equal(requests, 7, 'only the explicitly controlled submissions occurred');
            assert.deepEqual(errors, []);
          } catch (error) {
            await page.screenshot({ path: path.join(output, `recovery-failure-${engine}-${width}.png`) }).catch(() => {});
            throw error;
          } finally { await context.close(); }
        });
      } finally { await browser.close(); }
    }
  } finally {
    await server.close();
    await writeFile(path.join(output, 'recovery.json'), JSON.stringify(observations, null, 2));
  }
});

test('app survives failed requests and aborted Tree Bank writes, and reopens the saved analysis faithfully', async (t) => {
  const server = await startBrowserTestServer({ root });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const evidence = process.env.BABEL_WORKFLOW_EVIDENCE;
    if (evidence) await mkdir(evidence, { recursive: true });
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'],
        ...recordVideo(evidence, { width, height: 1000 }) });
      let page;
      const errors = [], consoleMessages = [], pendingRequests = new Set();
      try {
        page = await context.newPage();
        page.on('pageerror', error => errors.push(String(error)));
        page.on('console', message => consoleMessages.push({ type: message.type(), text: message.text() }));
        page.on('request', request => pendingRequests.add(request));
        page.on('requestfinished', request => pendingRequests.delete(request));
        page.on('requestfailed', request => pendingRequests.delete(request));
        let failRequest = true;
        const requests = [];
        await context.route('**/api/parse', route => {
          requests.push(route.request().postDataJSON());
          return route.fulfill({ status: failRequest ? 503 : 200,
            json: failRequest ? { error: { code: 'MODEL_UNAVAILABLE', message: 'Fixture request interrupted.' } } : bundle });
        });
        // Abort a real IndexedDB transaction after its individual request succeeds.
        await context.addInitScript(() => {
          for (const method of ['add', 'delete']) {
            const original = IDBObjectStore.prototype[method];
            IDBObjectStore.prototype[method] = function (...args) {
              const request = original.apply(this, args);
              request.addEventListener('success', () => {
                const operation = window.abortTreeBankOperation;
                if (this.transaction.db.name === 'sylvan-architect-babel'
                  && operation?.method === method && operation.store === this.name) {
                  window.abortTreeBankOperation = null;
                  window.abortedTreeBankOperation = operation;
                  this.transaction.abort();
                }
              });
              return request;
            };
          }
        });
        const snapshot = () => readTreeBankSnapshot(page);
        const emptyBank = { records: [], savedWorks: [], previews: [], treeBank: [] };
        const ready = () => page.locator('svg[data-babel-tree="true"]').waitFor();
        await page.goto(server.url);
        await page.getByRole('textbox', { name: 'Sentence to analyze' }).fill(bundle.sentence);
        // Enter that confirms an input-method candidate does not submit.
        await page.getByRole('textbox', { name: 'Sentence to analyze' }).evaluate(box => {
          for (const init of [{ isComposing: true, keyCode: 13 }, { isComposing: false, keyCode: 229 }]) {
            box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }));
          }
        });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(requests.length, 0, 'IME confirmation makes no request');
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
        await page.evaluate(() => { window.abortTreeBankOperation = { method: 'add', store: 'previews' }; });
        await page.getByRole('button', { name: 'Save to Tree Bank', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: 'Unable to save' }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Saved', exact: true }).count(), 0);
        assert.deepEqual(await page.evaluate(() => window.abortedTreeBankOperation), { method: 'add', store: 'previews' });
        assert.deepEqual(await snapshot(), emptyBank, 'an aborted save leaves no wrapper, content or preview');
        if (evidence) await page.screenshot({ path: path.join(evidence, `save-failed-${width}.png`) });
        await page.getByRole('button', { name: 'Save to Tree Bank', exact: true }).click();
        await page.getByRole('button', { name: 'Saved', exact: true }).waitFor();
        const stored = await snapshot();
        assert.equal(stored.savedWorks.length, 1);
        assert.deepEqual(stored.treeBank, [], 'new saves do not write the legacy bundle store');
        const work = stored.savedWorks[0];
        assert.equal(work.schemaVersion, 2);
        assert.equal(work.framework, 'xbar', 'changing the next request must not relabel the saved analysis');
        assert.equal(work.sentence, bundle.sentence);
        assert.equal(work.activeParseIndex, 1);
        assert.equal(work.view, 'derivation');
        assert.equal(work.replayStep, 1);
        assert.deepEqual(work.stageCounts, bundle.analyses.map(analysis => analysis.derivationStages.length));
        const byId = new Map(stored.records.map(record => [record.id, record]));
        assert.deepEqual(new Set(byId.keys()), new Set([...work.analysisIds, work.contextId]), 'every content record is referenced');
        assert.equal(byId.get(work.contextId).kind, 'context');
        const { analyses, ...expectedContext } = bundle;
        assert.deepEqual(byId.get(work.contextId).payload, expectedContext);
        assert.deepEqual(work.analysisIds.map(id => {
          const record = byId.get(id);
          assert.equal(record.kind, 'analysis');
          return record.payload;
        }), analyses, 'ordered alternative references preserve every complete analysis');
        assert.equal(stored.previews.length, 1);
        assert.equal(stored.previews[0].id, work.previewId);
        assert.match(stored.previews[0].dataUrl, /^data:image\/svg\+xml/);
        assert.equal(await page.getByRole('alert').count(), 0);
        await page.reload();
        await page.getByTitle('Open Tree Bank', { exact: true }).click();
        await page.getByRole('button', { name: 'Open Tree', exact: true }).waitFor();
        if (evidence) await page.screenshot({ path: path.join(evidence, `saved-${width}.png`) });
        await page.getByRole('button', { name: 'Open Tree', exact: true }).click();
        await ready();
        await page.getByRole('button', { name: 'X-Bar Theory', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Parse 2', exact: true }).getAttribute('aria-pressed'), 'true');
        await page.waitForFunction(() => document.querySelector('svg[data-babel-rendered-step]')?.getAttribute('data-babel-rendered-step') === '1');
        await page.getByRole('button', { name: 'Notes', exact: true }).click();
        await page.getByRole('button', { name: 'Copy Canopy', exact: true }).click();
        await page.getByRole('button', { name: 'Copied to Soil', exact: true }).waitFor();
        assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Mia/);
        assert.equal(await page.getByText('Movement Indexed', { exact: false }).count(), 0, 'Notes offers one final-tree bracketing');
        await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new DOMException('Denied', 'NotAllowedError')); });
        // The confirmed label reverts after two seconds; either label is the same button.
        await page.getByRole('button', { name: /^(Copy Canopy|Copied to Soil)$/ }).click();
        await page.getByRole('alert').filter({ hasText: 'The browser blocked clipboard access' }).waitFor();
        await page.getByRole('button', { name: 'Copy Canopy', exact: true }).waitFor();
        await page.getByTitle('Open Tree Bank', { exact: true }).click();
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
        await page.evaluate(() => { window.abortTreeBankOperation = { method: 'delete', store: 'savedWorks' }; });
        await page.getByRole('button', { name: 'Delete Tree', exact: true }).click();
        await page.getByText('Unable to delete this saved tree.', { exact: false }).waitFor();
        assert.deepEqual(await page.evaluate(() => window.abortedTreeBankOperation), { method: 'delete', store: 'savedWorks' });
        assert.deepEqual(await snapshot(), stored, 'an aborted deletion preserves every wrapper, content record and preview');
        await page.getByRole('button', { name: 'Delete Tree', exact: true }).click();
        await page.getByText('No saved trees yet', { exact: true }).waitFor();
        assert.deepEqual(await snapshot(), emptyBank, 'deleting the last work removes its unshared records and preview');
        assert.equal(requests.length, 2, 'only the two explicitly mocked submissions occurred');
        assert.equal(requests[1].framework, 'xbar');
        assert.deepEqual(errors, []);
      } catch (error) {
        const output = evidence || await mkdtemp(path.join(os.tmpdir(), 'babel-workflow-failure-'));
        const diagnostics = { width, url: page?.url(), error: String(error), pageErrors: errors, consoleMessages,
          pendingRequests: [...pendingRequests].map(request => ({ url: request.url(), type: request.resourceType() })),
          documentState: await page?.evaluate(() => document.readyState).catch(() => null) };
        const captures = await Promise.allSettled([
          writeFile(path.join(output, `failure-${width}.json`), JSON.stringify(diagnostics, null, 2)),
          page?.screenshot({ path: path.join(output, `failure-${width}.png`) })
        ]);
        t.diagnostic(`Browser failure evidence: ${output}\n${JSON.stringify(diagnostics)}`);
        for (const capture of captures) if (capture.status === 'rejected') t.diagnostic(String(capture.reason));
        throw error;
      } finally { await context.close(); }
    }
  } finally {
    try { await browser?.close(); }
    finally { await server.close(); }
  }
});
