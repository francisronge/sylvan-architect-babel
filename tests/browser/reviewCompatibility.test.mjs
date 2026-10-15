import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium, webkit } from 'playwright';
import { normalizeParseBundle } from '../../server/babelParser/parseNormalization.js';
import { prepareReplay } from '../../replay/prepareReplay.ts';
import { buildQualificationReviewRuntime } from '../../scripts/buildContractQualificationReviewRuntime.mjs';
import { buildQualificationReviewHtml } from '../../contractQualification/reviewPage.js';
import { buildReviewComparisonHtml, inspectComparisonImage, comparisonImageFits } from '../../scripts/reviewComparisonPage.mjs';

async function settle(page, index) {
  await page.waitForFunction(index => {
    const svg = document.querySelector('svg[data-babel-rendered-step]');
    return svg?.dataset.babelRenderedStep === String(index) && svg.dataset.babelCameraSettledStep === String(index);
  }, index);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !document.querySelector('svg[data-babel-tree]')
    .getAnimations({ subtree: true }).some(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)
      && (animation.pending || animation.playState === 'running')));
}

async function treeEvidence(page) {
  return page.evaluate(() => {
    const rect = element => { const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height }; };
    const svg = document.querySelector('svg[data-babel-tree]');
    const labels = [...svg.querySelectorAll('.terminal-label')].filter(label => {
      const box = label.getBoundingClientRect(), style = getComputedStyle(label);
      return box.width > 0 && box.height > 0 && style.display !== 'none' && Number(style.opacity) > 0;
    });
    return { svg: rect(svg), view: { width: innerWidth, height: innerHeight }, fonts: document.fonts.status,
      labels: labels.map(label => ({ text: label.textContent, ...rect(label) })),
      transform: svg.querySelector(':scope > g')?.getAttribute('transform'),
      paths: [...svg.querySelectorAll('.babel-trajectory-path')].map(element => {
        const marker = element.getAttribute('marker-end');
        const markerId = marker?.match(/^url\(#(.+)\)$/)?.[1];
        return { d: element.getAttribute('d'), length: element.getTotalLength(), marker,
          arrowhead: Boolean(markerId && document.getElementById(markerId)?.querySelector('path[d]')),
          from: element.dataset.trajectoryFrom, to: element.dataset.trajectoryTo };
      }) };
  });
}

function assertVisibleTree(state) {
  assert.equal(state.fonts, 'loaded');
  assert(state.labels.some(label => label.text.includes('Boken')), 'Visible Swedish lexical material');
  assert(state.labels.every(label => [label.x, label.y, label.width, label.height].every(Number.isFinite)), 'Finite font-sensitive label bounds');
  const visible = state.labels.filter(label => label.x >= state.svg.x - 2 && label.x + label.width <= state.svg.x + state.svg.width + 2
    && label.y >= state.svg.y - 2 && label.y + label.height <= state.svg.y + state.svg.height + 2);
  assert.equal(visible.length, state.labels.length, 'Fit must put the tree inside its usable canvas');
  assert(state.svg.y >= 0 && state.svg.y + state.svg.height <= state.view.height + 2, 'Review canvas inside viewport');
}

test('production review Replay and captured comparisons remain visible in Chromium and WebKit', { timeout: 180_000 }, async t => {
  const record = JSON.parse(await readFile(new URL('../../fixtures/movement/displayed-endpoints.json', import.meta.url), 'utf8'))
    .find(record => record.id === 'astra-swedish-passive/0');
  assert(record, 'Missing saved Swedish movement control');
  const bundle = normalizeParseBundle({ derivationStages: record.derivationStages }, record.framework, record.sentence, 'grok', true);
  const steps = prepareReplay({ sentence: record.sentence, inputTokens: record.inputTokens,
    derivationStages: bundle.analyses[0].derivationStages, includePlayback: true }).playbackSteps;
  const moment = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1 && step.replayRelationIdentity?.relationIndex === 1);
  assert(moment > 0);
  const data = { attempts: [{ attemptId: 'saved-swedish-control', framework: record.framework, sentence: record.sentence,
    outcome: { status: 'normalized' }, receipt: { ingress: { repairDiagnostics: [] } }, normalizedRecord: bundle,
    analyses: [{ analysisIndex: 0, replay: { frameCount: steps.length } }] }] };
  const runtime = await buildQualificationReviewRuntime();
  const review = buildQualificationReviewHtml(data, runtime);
  const output = process.env.BABEL_COMPATIBILITY_EVIDENCE || await mkdtemp(path.join(os.tmpdir(), 'babel-review-compatibility-'));
  await mkdir(output, { recursive: true });
  const evidence = [];
  for (const [engine, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await browserType.launch({ headless: true });
    try {
      for (const width of [1200, 390]) await t.test(`${engine} ${width}`, async () => {
        const errors = [], requests = [];
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await context.newPage();
        page.setDefaultTimeout(20_000);
        page.on('pageerror', error => errors.push(String(error)));
        await page.route('**/*', route => {
          // WebKit exposes the inlined worker's blob fetch to routing, while
          // Chromium does not. It is part of this loaded runtime, not a network dependency.
          const url = new URL(route.request().url());
          if (['blob:', 'data:'].includes(url.protocol)) return route.continue();
          requests.push(url.href); return route.abort();
        });
        const receipt = { engine, browserVersion: browser.version(), width, states: [], comparison: [], errors, requests };
        evidence.push(receipt);
        try {
          await page.setContent(review); await settle(page, 0);
          const slider = page.getByRole('slider', { name: 'Replay frame' });
          const seek = async index => { await slider.fill(String(index)); await settle(page, index); };
          await seek(moment - 1);
          assertVisibleTree(await treeEvidence(page));
          const before = `data:image/png;base64,${(await page.screenshot()).toString('base64')}`;
          await seek(moment);
          const active = await treeEvidence(page); assertVisibleTree(active);
          assert(active.paths.some(item => item.from === 'bookObjectTrace' && item.to === 'book' && item.arrowhead), 'Actual movement arrow and arrowhead');
          assert(active.paths.every(item => item.length > 0 && Number.isFinite(item.length) && !/NaN|Infinity/.test(item.d)));
          receipt.states.push({ kind: 'relation', ...active });
          const after = `data:image/png;base64,${(await page.screenshot({ path: path.join(output, `${engine}-${width}-replay.png`) })).toString('base64')}`;
          const box = await page.locator('svg[data-babel-tree]').boundingBox();
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
          await page.mouse.wheel(0, -180);
          await page.waitForFunction(previous => document.querySelector('svg[data-babel-tree] > g')?.getAttribute('transform') !== previous, active.transform);
          const beforeFit = await page.locator('svg[data-babel-tree] > g').elementHandle();
          await page.getByRole('button', { name: /fit/i }).click();
          await page.waitForFunction(previous => !previous.isConnected, beforeFit); await settle(page, moment);
          assertVisibleTree(await treeEvidence(page));
          await seek(steps.length - 1); assertVisibleTree(await treeEvidence(page));
          await seek(moment - 1); await seek(moment);
          assert((await treeEvidence(page)).paths.some(item => item.from === 'bookObjectTrace' && item.to === 'book' && item.arrowhead));
          // A new page also disposes the renderer's workers, observers and camera
          // callbacks before static comparison markup replaces the document.
          await page.close();
          const comparison = await context.newPage();
          comparison.on('pageerror', error => errors.push(String(error)));
          try {
            await comparison.setContent(buildReviewComparisonHtml({ title: 'Saved Swedish Replay', before, after }));
            await comparison.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
            for (const variant of ['before', 'after']) {
              await comparison.getByRole('button', { name: variant === 'before' ? 'Before' : 'After', exact: true }).click();
              const state = await comparison.evaluate(inspectComparisonImage);
              receipt.comparison.push(state);
              assert.equal(state.variant, variant);
              assert(comparisonImageFits(state), `Visible comparison ${JSON.stringify(state)}`);
            }
            // The historical rule decoded a valid image while stretching it
            // below the figure. Prove that our visibility check catches it.
            await comparison.locator('[data-comparison-image="after"]').evaluate(image => {
              image.style.position = 'relative'; image.style.height = '2300.4375px';
            });
            const overflow = await comparison.evaluate(inspectComparisonImage);
            receipt.overflowControl = overflow;
            assert.equal(overflow.decoded, true);
            assert.equal(comparisonImageFits(overflow), false, 'Loaded overflow must fail visible-viewport proof');
            await comparison.screenshot({ path: path.join(output, `${engine}-${width}-overflow-control.png`) });
            await comparison.locator('[data-comparison-image="after"]').evaluate(image => image.removeAttribute('style'));
            assert(comparisonImageFits(await comparison.evaluate(inspectComparisonImage)));
            await comparison.screenshot({ path: path.join(output, `${engine}-${width}-comparison.png`) });
          } catch (error) {
            await comparison.screenshot({ path: path.join(output, `${engine}-${width}-comparison-failure.png`) }).catch(() => {});
            throw error;
          } finally { await comparison.close(); }
          assert.deepEqual(errors, []); assert.deepEqual(requests, []);
        } catch (error) {
          receipt.failure = String(error);
          if (!page.isClosed()) await page.screenshot({ path: path.join(output, `${engine}-${width}-failure.png`) }).catch(() => {});
          throw error;
        } finally {
          await context.close();
          await writeFile(path.join(output, 'compatibility.json'), JSON.stringify({ runtime: runtime.metadata, evidence }, null, 2));
        }
      });
    } finally { await browser.close(); }
  }
});
