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
import { waitForReplayPaint } from '../../scripts/captureReadiness.mjs';
import { startBrowserTestServer } from '../helpers/browserTestServer.mjs';
import { readTreeBankSnapshot } from '../helpers/browserTreeBank.mjs';
import { recordVideo } from '../helpers/browserVideo.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const saved = JSON.parse(await readFile(new URL('../../fixtures/normalized/mia-laughed.xbar.json', import.meta.url), 'utf8'));
const bundle = { ...saved, sentence: 'Mia laughed.', inputTokens: ['Mia', 'laughed', '.'],
  ambiguityDetected: true, analyses: [saved.analyses[0], saved.analyses[0]] };
const sentenceInput = page => page.getByRole('textbox', { name: 'Sentence to analyze' });

/** Replay is the only view, so it keeps the sentence input exactly as the
 * retired Canopy showed it: the same bar, centred at the bottom of the
 * workspace, with its collapse and hide controls, ready for the next sentence.
 * The tree measures the bar, so the Replay panel stands above it. */
async function assertReplayWithInput(page) {
  assert.ok(await sentenceInput(page).isVisible(), 'Replay keeps the sentence input');
  assert.ok(await sentenceInput(page).isEditable(), 'the sentence input accepts a new sentence in Replay');
  assert.ok(await page.getByRole('button', { name: 'Analyze sentence', exact: true }).isEnabled());
  for (const control of ['Collapse', 'Hide Control Panel']) {
    assert.ok(await page.getByTitle(control, { exact: true }).isVisible(), `the bar keeps its ${control} control`);
  }
  const layout = await page.locator('[data-babel-tree-controls="bottom"]').evaluate(bar => {
    const box = bar.getBoundingClientRect(), workspace = bar.closest('[data-babel-workspace]').getBoundingClientRect();
    const panel = document.querySelector('[data-babel-replay-panel]').getBoundingClientRect();
    return { centreOffset: box.left + box.width / 2 - (workspace.left + workspace.width / 2),
      width: box.width, maxWidth: Math.min(768, workspace.width), bottomGap: workspace.bottom - box.bottom,
      panelGap: box.top - panel.bottom, ariaHidden: bar.getAttribute('aria-hidden') };
  });
  assert.ok(Math.abs(layout.centreOffset) < 1, `the input bar stays centred: ${layout.centreOffset}px off`);
  assert.ok(Math.abs(layout.width - layout.maxWidth) < 1, `the input bar keeps its width: ${layout.width}px`);
  assert.ok(layout.bottomGap >= 0 && layout.bottomGap <= 40, `the input bar stays at the bottom: ${layout.bottomGap}px above it`);
  assert.equal(layout.ariaHidden, 'false', 'the bar is shown, not hidden');
  assert.ok(layout.panelGap >= 0, `the Replay panel stands above the input bar: ${layout.panelGap}px between them`);
}

/** Whatever the sentence bar shows (a failure, a short workspace), the side
 * control and the Replay panel's controls stay inside the workspace and on top
 * where they are drawn, so a pointer reaches them. */
async function assertReplayControlsReachable(page) {
  const reach = await page.evaluate(() => {
    const workspace = document.querySelector('[data-babel-workspace]').getBoundingClientRect();
    const panel = document.querySelector('[data-babel-replay-panel]').getBoundingClientRect();
    const targets = [document.querySelector('button[aria-label="Labeled Bracketing"]'),
      ...document.querySelectorAll('.babel-replay-controls > button'), document.querySelector('input[aria-label="Replay frame"]')];
    return { panelTop: panel.top - workspace.top, covered: targets.flatMap(element => {
      const box = element.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
      const hit = document.elementFromPoint(x, y);
      return element === hit || element.contains(hit) ? [] : [`${element.getAttribute('aria-label') || element.textContent.trim()} under ${hit?.outerHTML.slice(0, 80)}`];
    }) };
  });
  assert.ok(reach.panelTop >= 0, `the Replay panel starts inside the workspace: ${reach.panelTop}px`);
  assert.deepEqual(reach.covered, [], 'nothing covers the side control or the Replay controls');
}

/**
 * The frame is drawn and its camera settled, without requiring a visible
 * label. Only the cramped sizes use it (1440x460 with the bar expanded, a
 * 390x640 phone showing a failure): there the sentence bar leaves the tree no
 * room, which Francis deferred to the input-bar design (ROADMAP 3B.6, 31 Oct
 * 2026). Every other size keeps waitForReplayPaint and its label check.
 */
async function waitForSettledFrame(page, index) {
  await page.waitForFunction(index => {
    const svg = document.querySelector('svg[data-babel-tree]');
    const transform = svg?.querySelector(':scope > g')?.getAttribute('transform');
    return svg?.dataset.babelRenderedStep === String(index) && svg.dataset.babelCameraSettledStep === String(index)
      && !svg.hasAttribute('data-babel-viewport-pending') && document.fonts.status === 'loaded'
      && transform && !/NaN|Infinity/.test(transform);
  }, index);
  await page.waitForFunction(() => !document.getAnimations().some(animation =>
    Number.isFinite(animation.effect?.getComputedTiming().endTime) && (animation.pending || animation.playState === 'running')));
}

/** The tree shows: some label is drawn where a pointer reaches the tree itself,
 * not a panel or bar covering it. waitForReplayPaint counts painted labels only.
 * Used at 1440x1000. With the bar kept in Replay, smaller heights (1440x700,
 * 390x844, 390x1000) leave the tree little or no uncovered room today; that
 * belongs to the input-bar design (ROADMAP 3B.6). */
async function assertTreeUncovered(page) {
  const uncovered = await page.evaluate(() => [...document.querySelectorAll('svg[data-babel-tree] .node-group text')]
    .filter(label => {
      const box = label.getBoundingClientRect();
      if (!label.textContent.trim() || box.width <= 0 || box.height <= 0) return false;
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return Boolean(hit?.closest('svg[data-babel-tree]'));
    }).length);
  assert.ok(uncovered > 0, 'some tree label is visible and uncovered');
}

/** Prev, Next and Play answer a pointer: each moves Replay as it should. */
async function clickReplayControls(page, paint = waitForReplayPaint) {
  const frame = async () => Number(await page.getByRole('slider', { name: 'Replay frame' }).inputValue());
  await pauseReplayAt(page, 2, paint);
  await page.getByRole('button', { name: 'Prev', exact: true }).click();
  await paint(page, 1);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await paint(page, 2);
  assert.equal(await frame(), 2);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  assert.ok(await frame() >= 2, 'Play advanced or held Replay');
}

/** A new analysis opens in Replay and plays; pause it on a chosen frame. */
async function pauseReplayAt(page, frame, paint = waitForReplayPaint) {
  const slider = page.getByRole('slider', { name: 'Replay frame' });
  await slider.waitFor();
  if (await page.getByRole('button', { name: 'Pause', exact: true }).count()) await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const target = frame === 'last' ? Number(await slider.getAttribute('max')) : frame;
  await slider.fill(String(target));
  await paint(page, target);
  return target;
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
  const recovered = { ...normalizeParseBundle(payload, 'minimalism', sentence, 'gpt', true),
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
        await page.getByRole('slider', { name: 'Replay frame' }).waitFor();
        assert.equal(await page.getByRole('alert').count(), 0);
        await page.getByRole('button', { name: 'Parse 2', exact: true }).click();
        const finalFrame = await pauseReplayAt(page, 'last');
        assert.match(await page.locator('svg[data-babel-tree]').textContent(), /IP/);
        await assertReplayWithInput(page);
        if (width === 1440) await assertTreeUncovered(page);
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
  ] }, 'minimalism', 'Mia laughed.', 'gpt', true), sentence: 'Mia laughed.' };
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
            // Pausing on the finished tree keeps the header checks off a moving Replay.
            await pauseReplayAt(page, 'last');
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
                await page.getByRole('button', { name: 'Minimalist Program', exact: true }).click();
                await page.getByRole('button', { name: 'X-Bar Theory', exact: true }).waitFor();
                assert.ok(await page.getByRole('banner').evaluate(header => [...header.querySelectorAll('button,select')]
                  .every(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; })),
                  'the other framework name also fits');
                await page.getByRole('button', { name: 'X-Bar Theory', exact: true }).click();
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
            await pauseReplayAt(page, 'last');
            assert.match(await page.locator('svg[data-babel-tree]').textContent(), /TP/);
            await page.getByRole('button', { name: 'Parse 2', exact: true }).click();
            await pauseReplayAt(page, 'last');
            assert.match(await page.locator('svg[data-babel-tree]').textContent(), /IP/);
            await pauseReplayAt(page, 4);
            await assertReplayWithInput(page);
            if (width === 1440) await assertTreeUncovered(page);
            await page.screenshot({ path: path.join(output, `recovery-before-${engine}-${width}.png`) });
            // A new sentence is entered beside the paused Replay; each failure
            // returns to the same analysis and frame.
            const failedDraft = 'Nia laughed.';
            await sentenceInput(page).fill(failedDraft);
            for (const kind of ['connection-closed', 'invalid-json', 'empty-result', 'provider-unavailable', 'malformed-model-output']) {
              response = kind;
              const request = page.waitForRequest('**/api/parse');
              await page.getByRole('button', { name: 'Analyze sentence', exact: true }).click();
              await request;
              await page.getByRole('button', { name: 'Analyze sentence', exact: true }).waitFor();
              await waitForReplayPaint(page, 4);
              assert.equal(await page.getByRole('button', { name: 'Parse 2', exact: true }).getAttribute('aria-pressed'), 'true');
              assert.equal(await page.getByRole('slider', { name: 'Replay frame' }).inputValue(), '4');
              assert.equal(await page.getByRole('button', { name: 'Pause', exact: true }).count(), 0);
              assert.equal(await page.getByRole('button', { name: 'Play', exact: true }).count(), 1);
              assert.ok(await sentenceInput(page).isVisible(), 'a failure keeps the input in Replay');
              assert.equal(await sentenceInput(page).inputValue(), failedDraft);
              assert.equal(await page.getByRole('alert').count(), 1, 'failure remains visible and announced');
              await assertReplayControlsReachable(page);
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
                const inspection = page.getByRole('dialog', { name: 'Failed output inspection' });
                await page.getByRole('button', { name: 'Inspect failed output', exact: true }).click();
                await inspection.waitFor();
                await page.getByRole('button', { name: 'Close inspection', exact: true }).click();
                assert.equal(await page.getByRole('dialog').count(), 0);
                // With the bracketing open, Escape in the inspection closes only the inspection.
                const bracketing = page.getByRole('dialog', { name: 'Labeled Bracketing' });
                await page.getByRole('button', { name: 'Labeled Bracketing', exact: true }).click();
                await bracketing.waitFor();
                // The open panel may cover the button, so it is reached from the keyboard.
                await page.getByRole('button', { name: 'Inspect failed output', exact: true }).focus();
                await page.keyboard.press('Enter');
                await inspection.waitFor();
                await page.keyboard.press('Escape');
                await inspection.waitFor({ state: 'detached' });
                assert.ok(await bracketing.isVisible(), 'the inspection keeps its own Escape');
                await bracketing.getByRole('button', { name: 'Close labeled bracketing', exact: true }).click();
                await bracketing.waitFor({ state: 'detached' });
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
            await assertReplayWithInput(page);
            await pauseReplayAt(page, 'last');
            assert.match(await page.locator('svg[data-babel-tree]').textContent(), /IP/);
            response = 'complete';
            await page.getByRole('button', { name: 'Analyze sentence', exact: true }).click();
            await page.getByRole('slider', { name: 'Replay frame' }).waitFor();
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
        // A collapsed or hidden sentence panel stays mounted for its transition,
        // but its controls cannot receive focus.
        const sentenceFocusable = () => page.evaluate(() => {
          const box = document.querySelector('textarea[aria-label="Sentence to analyze"]');
          box.focus();
          const focused = document.activeElement === box;
          box.blur();
          return focused;
        });
        assert.equal(await sentenceFocusable(), true);
        await page.getByTitle('Collapse', { exact: true }).click();
        assert.equal(await sentenceFocusable(), false, 'the collapsed panel body is out of the focus order');
        await page.getByRole('button', { name: 'Expand Arbor Control', exact: true }).click();
        assert.equal(await sentenceFocusable(), true);
        await page.getByTitle('Hide Control Panel', { exact: true }).click();
        assert.equal(await sentenceFocusable(), false, 'the hidden panel is out of the focus order');
        await page.getByTitle('Restore Arboretum Link', { exact: true }).click();
        assert.equal(await sentenceFocusable(), true);
        // Minimalism is the default; this fixture is an X-bar analysis.
        await page.getByRole('button', { name: 'Minimalist Program', exact: true }).click();
        await page.getByRole('button', { name: 'X-Bar Theory', exact: true }).waitFor();
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
        // The bracketing opens over the paused Replay without moving it.
        const bracketingButton = page.getByRole('button', { name: 'Labeled Bracketing', exact: true });
        const bracketing = page.getByRole('dialog', { name: 'Labeled Bracketing' });
        await bracketingButton.click();
        await bracketing.waitFor();
        assert.equal(await bracketingButton.getAttribute('aria-expanded'), 'true');
        assert.equal(await page.locator('svg[data-babel-rendered-step]').getAttribute('data-babel-rendered-step'), '1');
        assert.ok(await sentenceInput(page).isVisible(), 'the bracketing leaves the sentence input in place');
        if (evidence) await page.screenshot({ path: path.join(evidence, `bracketing-${width}.png`) });
        await bracketing.getByRole('button', { name: 'Copy Bracketing', exact: true }).click();
        await bracketing.getByRole('button', { name: 'Copied to Soil', exact: true }).waitFor();
        assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Mia/);
        assert.equal(await page.getByText('Movement Indexed', { exact: false }).count(), 0, 'one final-tree bracketing');
        assert.equal(await bracketing.getByRole('link', { name: 'Miles Shang', exact: true }).getAttribute('href'), 'https://mshang.ca/syntree/');
        await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new DOMException('Denied', 'NotAllowedError')); });
        // The confirmed label reverts after two seconds; either label is the same button.
        await bracketing.getByRole('button', { name: /^(Copy Bracketing|Copied to Soil)$/ }).click();
        await page.getByRole('alert').filter({ hasText: 'The browser blocked clipboard access' }).waitFor();
        await bracketing.getByRole('button', { name: 'Copy Bracketing', exact: true }).waitFor();
        // Escape closes it and returns focus to the control that opened it.
        await page.keyboard.press('Escape');
        await bracketing.waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Labeled Bracketing');
        assert.equal(await page.locator('svg[data-babel-rendered-step]').getAttribute('data-babel-rendered-step'), '1');
        // The panel is not modal: after Tab leaves it, Escape still closes it,
        // and focus stays where the user moved it.
        await bracketingButton.click();
        await bracketing.waitFor();
        const focusInPanel = () => page.evaluate(() => Boolean(document.activeElement?.closest('#babel-bracketing')));
        for (let presses = 0; presses < 10 && await focusInPanel(); presses++) await page.keyboard.press('Tab');
        assert.equal(await focusInPanel(), false, 'Tab leaves the panel');
        const outside = await page.evaluate(() => {
          const element = document.activeElement;
          element.dataset.babelFocusProbe = 'outside';
          return element.outerHTML.slice(0, 120);
        });
        assert.ok(await bracketing.isVisible(), 'leaving the panel keeps it open');
        await page.keyboard.press('Escape');
        await bracketing.waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => document.activeElement?.dataset.babelFocusProbe), 'outside',
          `Escape from outside the panel leaves focus on ${outside}`);
        await page.evaluate(() => { delete document.activeElement.dataset.babelFocusProbe; });
        await page.getByTitle('Open Tree Bank', { exact: true }).click();
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
        // The confirmation is modal: focus starts on Cancel, Escape cancels, and
        // focus returns to the Delete control that opened it.
        const confirmation = page.getByRole('dialog', { name: 'Delete saved tree?' });
        await confirmation.waitFor();
        const focusedText = () => page.evaluate(() => document.activeElement?.textContent?.trim());
        assert.equal(await focusedText(), 'Cancel');
        await page.keyboard.press('Escape');
        await confirmation.waitFor({ state: 'detached' });
        assert.equal(await focusedText(), 'Delete');
        assert.deepEqual(await snapshot(), stored, 'cancelling deletes nothing');
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
        await confirmation.waitFor();
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

/** The bracketing panel is the top layer wherever it is drawn: inside the
 * workspace, clear of its own control, and above the sentence bar. Content
 * taller than the workspace scrolls inside the panel. */
async function assertBracketingOnTop(page, { scrolls }) {
  const bracketing = page.getByRole('dialog', { name: 'Labeled Bracketing' });
  const measure = () => bracketing.evaluate(panel => {
    const box = panel.getBoundingClientRect();
    const workspace = panel.closest('[data-babel-workspace]').getBoundingClientRect();
    const control = document.querySelector('button[aria-label="Labeled Bracketing"]').getBoundingClientRect();
    const bar = document.querySelector('[data-babel-tree-controls="bottom"]').getBoundingClientRect();
    const covered = [];
    for (const fx of [0.05, 0.5, 0.95]) for (const fy of [0.05, 0.5, 0.95]) {
      const x = box.left + box.width * fx, y = box.top + box.height * fy;
      if (!panel.contains(document.elementFromPoint(x, y))) covered.push([Math.round(x), Math.round(y)]);
    }
    return { box: { top: box.top, bottom: box.bottom, left: box.left, right: box.right }, covered,
      workspace: { top: workspace.top, bottom: workspace.bottom, left: workspace.left, right: workspace.right },
      clearOfControl: box.right <= control.left, overBar: box.bottom > bar.top && box.left < bar.right && box.right > bar.left,
      overflow: panel.scrollHeight - panel.clientHeight };
  });
  const before = await measure();
  for (const side of ['top', 'left']) assert.ok(before.box[side] >= before.workspace[side] - 1, `panel ${side} inside the workspace: ${JSON.stringify(before)}`);
  for (const side of ['bottom', 'right']) assert.ok(before.box[side] <= before.workspace[side] + 1, `panel ${side} inside the workspace: ${JSON.stringify(before)}`);
  assert.ok(before.clearOfControl, 'the panel leaves its control reachable');
  assert.deepEqual(before.covered, [], 'nothing covers the panel');
  if (scrolls) {
    assert.ok(before.overflow > 0, `long bracketing scrolls inside the panel: ${before.overflow}px`);
    await bracketing.evaluate(panel => { panel.scrollTop = panel.scrollHeight; });
    const end = await bracketing.evaluate(panel => {
      const code = panel.querySelector('code').getBoundingClientRect();
      const hit = document.elementFromPoint(code.left + 4, code.bottom - 4);
      return { reached: panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 1, visible: panel.contains(hit) };
    });
    assert.deepEqual(end, { reached: true, visible: true }, 'the end of the bracketing scrolls into view, uncovered');
  }
  return before;
}

test('the bracketing panel stays above the sentence bar and inside a short or overflowing workspace', { timeout: 120_000 }, async () => {
  // Forty long words make a bracketing taller than any workspace below.
  const words = Array.from({ length: 40 }, (_, index) => `extraordinarilyunpronounceable${String.fromCharCode(97 + (index % 26))}${index}`);
  const longSentence = words.join(' ');
  const long = { ...normalizeParseBundle({ analyses: [{ derivationStages: [
    { statement: 'Select the words.', stageRecord: 'The words enter the workspace.', relations: [],
      workspaceForest: words.map((word, index) => ({ id: `w${index}`, label: 'N', word, children: [] })) },
    { statement: 'Construct the phrase.', stageRecord: 'The words form one phrase.', relations: [], workspaceForest: [
      { id: 'phrase', label: 'NP', children: words.map((_, index) => ({ refId: `w${index}` })) }
    ] }
  ] }] }, 'minimalism', longSentence, 'gpt', true), sentence: longSentence };
  const server = await startBrowserTestServer({ root });
  const output = process.env.BABEL_WORKFLOW_EVIDENCE || await mkdtemp(path.join(os.tmpdir(), 'babel-bracketing-'));
  await mkdir(output, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    // At 1440x460 the parse selector, the Replay panel and the expanded
    // sentence bar cannot all fit: the panel's controls must still answer, but
    // the tree has no room until the input-bar design (ROADMAP 3B.6).
    for (const [name, viewport, analysis, sentence, scrolls] of [
      ['short', { width: 1440, height: 460 }, bundle, bundle.sentence, false],
      ['compact', { width: 1440, height: 700 }, bundle, bundle.sentence, false],
      ['long-desktop', { width: 1440, height: 900 }, long, longSentence, true],
      ['long-mobile', { width: 390, height: 844 }, long, longSentence, true]
    ]) {
      const paint = name === 'short' ? waitForSettledFrame : waitForReplayPaint;
      const context = await browser.newContext({ viewport });
      try {
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(String(error)));
        await context.route('**/api/parse', route => route.fulfill({ status: 200, json: analysis }));
        await page.goto(server.url);
        await sentenceInput(page).fill(sentence);
        await page.getByRole('button', { name: 'Analyze sentence', exact: true }).click();
        await pauseReplayAt(page, 'last', paint);
        assert.ok(await sentenceInput(page).isVisible(), 'the sentence bar stays expanded');
        await assertReplayControlsReachable(page);
        // The long cases test the bracketing's scrolling. Their flat 40-word
        // phrase is so wide that its early frames draw too small to count as
        // visible labels, so stepping is checked in the short and compact cases.
        if (!scrolls) {
          await clickReplayControls(page, paint);
          await pauseReplayAt(page, 'last', paint);
        }
        await page.getByRole('button', { name: 'Labeled Bracketing', exact: true }).click();
        await page.getByRole('dialog', { name: 'Labeled Bracketing' }).waitFor();
        const measured = await assertBracketingOnTop(page, { scrolls });
        if (name === 'short' || name === 'compact') assert.ok(measured.overBar, `the ${name} workspace puts the panel over the sentence bar`);
        await page.screenshot({ path: path.join(output, `bracketing-${name}-${viewport.width}x${viewport.height}.png`) });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  } finally {
    try { await browser?.close(); }
    finally { await server.close(); }
  }
});

// The tree has no room here until the input-bar design (ROADMAP 3B.6); the
// controls must still answer and stay on screen.
test('on a short phone showing a failure, Replay and the bracketing still answer a pointer', { timeout: 120_000 }, async () => {
  const server = await startBrowserTestServer({ root });
  const output = process.env.BABEL_WORKFLOW_EVIDENCE || await mkdtemp(path.join(os.tmpdir(), 'babel-short-phone-'));
  await mkdir(output, { recursive: true });
  try {
    for (const [engine, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await browserType.launch({ headless: true });
      try {
        const context = await browser.newContext({ viewport: { width: 390, height: 640 } });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(String(error)));
        let fail = false;
        await context.route('**/api/parse', route => fail
          ? route.fulfill({ status: 503, json: { error: { code: 'MODEL_UNAVAILABLE', message: 'Controlled provider interruption.' } } })
          : route.fulfill({ status: 200, json: bundle }));
        await page.goto(server.url);
        await sentenceInput(page).fill(bundle.sentence);
        await page.getByRole('button', { name: 'Analyze sentence', exact: true }).click();
        await pauseReplayAt(page, 2, waitForSettledFrame);
        fail = true;
        await sentenceInput(page).fill('Nia laughed.');
        await page.getByRole('button', { name: 'Analyze sentence', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: 'Controlled provider interruption.' }).waitFor();
        await waitForSettledFrame(page, 2);
        await page.screenshot({ path: path.join(output, `short-phone-failure-${engine}-390x640.png`) });
        await assertReplayControlsReachable(page);
        await clickReplayControls(page, waitForSettledFrame);
        await page.getByRole('button', { name: 'Labeled Bracketing', exact: true }).click();
        await page.getByRole('dialog', { name: 'Labeled Bracketing' }).waitFor();
        await page.screenshot({ path: path.join(output, `short-phone-bracketing-${engine}-390x640.png`) });
        assert.equal(await page.getByRole('alert').count(), 1, 'the failure stays shown');
        assert.deepEqual(errors, []);
        await context.close();
      } finally { await browser.close(); }
    }
  } finally { await server.close(); }
});

