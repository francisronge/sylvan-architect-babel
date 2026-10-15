import { inlineWorkerPlugin } from '../../scripts/inlineWorkerPlugin.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { buildQualificationReviewRuntime } from '../../scripts/buildContractQualificationReviewRuntime.mjs';
import { prepareReplay } from '../../replay/prepareReplay.ts';
import { persistentCaseMovement } from '../helpers/persistentCaseMovement.mjs';
import { waitForReplayPaint } from '../../scripts/captureReadiness.mjs';

test('Case arrow and plaque persist through construction before head movement in both engines', { timeout: 180_000 }, async () => {
  const runtime = await buildQualificationReviewRuntime({ entrySource: `
    import React from 'react';import {flushSync} from 'react-dom';import {createRoot} from 'react-dom/client';
    import TreeVisualizer from './components/AsyncTreeVisualizer';import {buildDerivationCanvasData} from './replay/replayCanvas.ts';
    import './styles.css';const root=createRoot(document.getElementById('root'));
    window.mount=record=>flushSync(()=>root.render(<TreeVisualizer key={String(record.exact)}
      data={buildDerivationCanvasData(record.derivationStages.at(-1).workspaceForest)} sentence={record.sentence}
      derivationStages={record.derivationStages} animated autoPlay={false}/>));window.mount(window.record);` });
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const width of [1200, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = [];
        page.on('pageerror', error => errors.push(String(error)));
        try {
          for (const exact of [false, true]) {
            const input = { ...persistentCaseMovement(exact), exact };
            const steps = prepareReplay({ ...input, includePlayback: true }).playbackSteps;
            await page.setContent(`<style>${runtime.css}html,body,#root{height:100%;margin:0}</style><div id="root"></div>
              <script>window.record=${JSON.stringify(input)}</script><script>${runtime.js}</script>`);
            await waitForReplayPaint(page, 0);
            const movement = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1);
            const first = steps.findIndex(step => step.replayFrameIndex === 1);
            for (const index of [...Array.from({ length: movement - first + 2 }, (_, i) => first - 1 + i),
              steps.length - 1, movement - 1]) {
              await page.getByRole('slider', { name: 'Replay frame', exact: true }).fill(String(index));
              await waitForReplayPaint(page, index);
              const state = await page.evaluate(() => {
                const owned = element => {
                  for (let current = element; current; current = current.parentElement)
                    if ((current.dataset.vrOwnerRefs ?? '').split(/\s+/).includes('0:0')) return true;
                  return false;
                };
                const paths = [...document.querySelectorAll('.babel-case-assignment-path')].filter(owned);
                const rows = [...document.querySelectorAll('.babel-feature-row')].filter(owned);
                const grids = [...document.querySelectorAll('.babel-theta-grid-shell')];
                const painted = element => {
                  for (let current = element; current; current = current.parentElement) {
                    const style = getComputedStyle(current);
                    if (style.display === 'none' || Number(style.opacity) === 0) return false;
                  }
                  return true;
                };
                return { paths: paths.length, rows: rows.length, grids: grids.length,
                  painted: [...paths, ...rows, ...grids].every(painted),
                  bearer: rows[0]?.dataset.featureAnchor, text: rows[0]?.textContent,
                  arrow: paths[0]?.getAttribute('marker-end') };
              });
              assert.equal(state.paths, 1, `frame ${index + 1}: the established arrow exists`);
              assert.equal(state.rows, 1, `frame ${index + 1}: the established plaque exists`);
              assert.equal(state.grids, 1, `frame ${index + 1}: the earlier theta grid also persists`);
              assert(state.painted && state.arrow, `frame ${index + 1}: both pieces are painted`);
              assert.equal(state.bearer, 'object');
              assert(state.text.includes('objective'));
            }
          }
          assert.deepEqual(errors, []);
        } finally { await page.close(); }
      }
    } finally { await browser.close(); }
  }
});

test('standalone and Case-composed feature plaques keep row attachment through Replay, zoom, hover and mobile', async () => {
  const tree = { id: 'root', label: 'PP', children: [{ id: 'p', label: 'P', word: 'with' }, { id: 'k', label: 'KP', children: [
    { id: 'num', label: 'Num', word: 'books' }, { id: 'n', label: 'N' }
  ] }] };
  const agreement = { relation: 'An open agreement', anchors: { probe: 'k', goal: 'num' }, values: { agreement: ['inclusive', 'dual'] } };
  const caseRelation = { relation: 'CaseAssignment', anchors: { assigner: 'p', bearer: 'k' }, values: { feature: 'Case', value: 'DAT' } };
  const runtime = await buildQualificationReviewRuntime();
  const evidence = process.env.BABEL_BROWSER_EVIDENCE
    ? path.join(process.env.BABEL_BROWSER_EVIDENCE, 'feature-composition') : null;
  if (evidence) await mkdir(evidence, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const variant of ['standalone', 'bearer', 'same-pair', 'native-bearer', 'native-same-pair']) {
      const combined = variant !== 'standalone';
      const samePair = variant.endsWith('same-pair');
      const native = variant.startsWith('native-');
      const agreementIndex = samePair ? 2 : Number(combined);
      const relations = [...(samePair ? [{ relation: 'Finite specification', anchors: { finiteHead: 'p' },
        values: { number: 'singular', person: 'third' } }] : []), ...(combined ? [caseRelation] : []),
        { ...agreement,
          relation: native ? 'Agree' : agreement.relation,
          anchors: samePair ? native ? { probe: 'p', goal: 'k' } : { head: 'p', specifier: 'k' } : agreement.anchors
        }, { relation: 'Another description', anchors: { participant: 'n' } }];
      const stages = [{ statement: 'Features.', stageRecord: 'Independent moments.', workspaceForest: [tree], relations }];
      const steps = prepareReplay({ sentence: 'with books', derivationStages: stages, includePlayback: true }).playbackSteps;
      const moment = steps.findIndex(step => step.replayRelationIdentity?.relationIndex === agreementIndex);
      const next = steps.findIndex(step => step.replayRelationIdentity?.relationIndex === agreementIndex + 1);
      const compiled = await build({
        plugins: [inlineWorkerPlugin()], absWorkingDir: new URL('../../', import.meta.url).pathname,
        stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import TreeVisualizer from './components/TreeVisualizer';
          createRoot(document.getElementById('root')).render(<TreeVisualizer data={${JSON.stringify(tree)}} derivationStages={${JSON.stringify(stages)}} sentence="with books" animated />);`,
        loader: 'tsx', resolveDir: new URL('../../', import.meta.url).pathname },
        bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
      const page = await browser.newPage({ viewport: { width: 1200, height: 900 },
        ...(evidence && variant === 'bearer' ? { recordVideo: { dir: evidence } } : {}) });
      const errors = []; page.on('pageerror', error => errors.push(String(error)));
      await page.setContent(`<style>${runtime.css}</style><div id="root" style="height:900px"></div><script>${compiled.outputFiles[0].text}</script>`);
      await page.locator('svg[data-babel-rendered-step]').waitFor();
      if (await page.getByRole('button', { name: 'Pause', exact: true }).count()) await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await page.evaluate(() => document.fonts.ready);
      const go = async index => { await page.locator('input[type=range]').fill(String(index));
        await waitForReplayPaint(page, index); };
      let earlierShell;
      if (samePair) {
        await go(steps.findIndex(step => step.replayRelationIdentity?.relationIndex === 0));
        await page.locator('.babel-feature-row[data-feature-label="number"]').waitFor();
        assert.equal(await page.locator('.babel-feature-plaque').count(), 1);
        assert.equal(await page.locator('.babel-case-assignment-path').count(), 0, 'an earlier feature row must not reveal the Case arrow');
        assert.equal(await page.locator('.babel-feature-row[data-feature-label="Case"]').count(), 0);
        earlierShell = await page.locator('.babel-feature-plaque-shell').evaluate(e => ['x', 'y', 'width', 'height'].map(k => e.getAttribute(k)));
      }
      if (combined) {
        await go(steps.findIndex(step => step.replayRelationIdentity?.relationIndex === (samePair ? 1 : 0)));
        assert.equal(await page.locator('.babel-case-collection-path').count(), 0);
        assert(!await page.locator('.babel-feature-plaque').innerText().catch(() => page.locator('.babel-feature-plaque').textContent()).then(text => /inclusive|dual/.test(text)));
      }
      const read = () => page.evaluate(() => {
        const shell = document.querySelector('.babel-feature-plaque-shell');
        const rect = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, +shell.getAttribute(key)]));
        const paths = [...document.querySelectorAll('.babel-case-collection-path')].map(path => ({ d: path.getAttribute('d'),
          start: { x: path.getPointAtLength(0).x, y: path.getPointAtLength(0).y },
          owner: path.getAttribute('data-vr-owner-refs'), marker: path.getAttribute('marker-end') }));
        return { rect, paths };
      });
      for (const width of [1200, 390]) {
        if (page.viewportSize().width !== width) {
          const old = await page.locator('svg > g').first().elementHandle();
          await page.setViewportSize({ width, height: 900 });
          await page.waitForFunction(old => !old.isConnected && document.querySelector('svg[data-babel-rendered-step]'), old);
        }
        await go(moment);
        await page.waitForFunction(() => document.querySelectorAll('.babel-case-collection-path').length === 2);
        assert.equal(await page.locator('.babel-feature-plaque').count(), 1);
        assert.equal(await page.locator('.babel-case-assignment-path').count(), Number(combined));
        const state = await read();
        if (evidence && variant === 'bearer') await page.screenshot({ path: path.join(evidence, `before-zoom-${width}.png`) });
        if (samePair) {
          if (width === 1200) assert.deepEqual(await page.locator('.babel-feature-plaque-shell').evaluate(e =>
            ['x', 'y', 'width', 'height'].map(k => e.getAttribute(k))), earlierShell, 'later rows and arrows cannot relocate or resize the shared plaque');
          const caseRow = page.locator('.babel-feature-row[data-feature-label="Case"]');
          const agreementRows = page.locator('.babel-feature-row[data-feature-label="agreement"]');
          assert.equal(await caseRow.getAttribute('data-feature-anchor'), 'k');
          assert.equal(await caseRow.getAttribute('data-vr-owner-refs'), '0:1');
          assert.equal(await caseRow.getAttribute('data-vr-emphasis'), 'quiet');
          assert.equal(await agreementRows.first().getAttribute('data-feature-anchor'), 'p');
          assert.equal(await agreementRows.first().getAttribute('data-feature-source'), 'k');
          assert.equal(await agreementRows.first().getAttribute('data-vr-owner-refs'), '0:2');
          assert.equal(await agreementRows.first().getAttribute('data-vr-emphasis'), 'active');
        }
        assert.notEqual(state.paths[0].d, state.paths[1].d, 'two rows cannot collapse into one curve');
        for (const path of state.paths) {
          assert.match(path.d, /^M [-\d.]+ [-\d.]+ C [-\d.]+ [-\d.]+, [-\d.]+ [-\d.]+, [-\d.]+ [-\d.]+$/,
            'the painted collection must use the shallow Orchard D6 curve');
          assert.equal(path.owner, `0:${agreementIndex}`);
          assert.equal(path.marker, null, 'collection has no assignment arrowhead');
          const side = (Math.abs(path.start.x - state.rect.x + 12) < 1
            || Math.abs(path.start.x - state.rect.x - state.rect.width - 12) < 1)
            && path.start.y > state.rect.y && path.start.y < state.rect.y + state.rect.height;
          const vertical = (Math.abs(path.start.y - state.rect.y + 12) < 1
            || Math.abs(path.start.y - state.rect.y - state.rect.height - 12) < 1)
            && path.start.x >= state.rect.x + 23 && path.start.x <= state.rect.x + state.rect.width - 23;
          assert(side || vertical, JSON.stringify({ variant, width, path, plaque: state.rect }));
        }
        const [a, b] = state.paths.map(path => path.start);
        if (Math.abs(a.y - b.y) < 1) assert(Math.abs(a.x - b.x) >= 23,
          JSON.stringify({ variant, width, reason: 'vertical collectors keep separate reserved ports', state }));
        const treeTransform = await page.locator('svg > g').first().getAttribute('transform');
        await page.mouse.move(width / 2, 350); await page.mouse.wheel(0, -160);
        await page.waitForFunction(previous => document.querySelector('svg > g')?.getAttribute('transform') !== previous, treeTransform);
        assert.deepEqual(await read(), state, 'zoom preserves plaque and connector coordinates together');
        await go(next);
        const plaque = page.locator(combined ? '.babel-feature-plaque-frame' : '.babel-feature-plaque');
        assert.equal(await plaque.evaluate(e => getComputedStyle(e.closest('.vr-item')).opacity), '0.3');
        const quiet = await read();
        await plaque.dispatchEvent('mousemove', { clientX: 200, clientY: 250 });
        await page.waitForFunction(() => document.querySelector('svg .vr-relation-hovered'));
        assert.deepEqual(await read(), quiet, 'quiet hover does not move a connector or plaque');
        await go(moment);
        const restored = await read();
        if (evidence && variant === 'bearer') await page.screenshot({ path: path.join(evidence, `after-rewind-${width}.png`) });
        assert.deepEqual(restored.rect, state.rect, 'reverse scrubbing preserves the plaque reservation');
        const screenScale = await page.locator('.babel-case-collection-path').first().evaluate(e => Math.abs(e.getScreenCTM().a));
        restored.paths.forEach((path, index) => {
          const coordinates = path.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
          const original = state.paths[index].d.match(/-?\d+(?:\.\d+)?/g).map(Number);
          assert(coordinates.every((value, i) => Math.abs(value - original[i]) * screenScale < 0.75), JSON.stringify({ width, combined, original, coordinates }));
        });
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});


test('painted syntax glyph bounds stay in tree space across native zoom and refresh on repaint', async () => {
  const runtime = await buildQualificationReviewRuntime({ entrySource: `
    import {select} from 'd3';
    import {createTreeGraphicsMeasure,measureTreeGraphics} from './components/renderer/treeMeasurements.ts';
    import './styles.css';
    const g=select(document.querySelector('#tree'));
    const labels=[...document.querySelectorAll('#tree text')];
    window.capture=()=>{window.measure=createTreeGraphicsMeasure(g)};
    window.read=()=>labels.map(label=>({stable:window.measure([label]),live:measureTreeGraphics(g,[label])}));` });
  const observations = [];
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      await page.setContent(`<style>${runtime.css}</style><svg width="1200" height="900"><g id="tree">
        <text class="category-label" x="300" y="150" style="font:900 42px Quicksand,sans-serif">KP</text>
        <text class="terminal-label" x="300" y="300" style="font:italic 900 56px Quicksand,sans-serif">books</text>
        </g></svg><script>${runtime.js}</script>`);
      await page.evaluate(async () => {
        await Promise.all([document.fonts.load('900 42px Quicksand', 'KP'),
          document.fonts.load('italic 900 56px Quicksand', 'books')]);
        await document.fonts.ready;
        window.capture();
      });
      const initial = await page.evaluate(() => window.read());
      for (const scale of [0.25, 0.7, 1.25, 2]) {
        const sample = await page.evaluate(scale => {
          document.querySelector('#tree').setAttribute('transform', `translate(35,40) scale(${scale})`);
          return window.read();
        }, scale);
        observations.push({ engine: engine.name(), scale, initial, sample });
        for (let i = 0; i < sample.length; i++) for (const key of ['x', 'y', 'width', 'height']) {
          assert(Math.abs(sample[i].stable[key] - initial[i].stable[key]) < 1e-4,
            JSON.stringify({ engine: engine.name(), scale, label: i, key, initial, sample }));
        }
      }
      const repainted = await page.evaluate(() => {
        document.querySelector('#tree').removeAttribute('transform');
        document.querySelector('.category-label').textContent = 'TP [finite]';
        window.capture();
        return window.read();
      });
      assert(repainted[0].stable.width > initial[0].stable.width + 20,
        'a new paint must measure changed glyphs rather than reusing an old frame');
    } finally { await browser.close(); }
  }
  if (process.env.BABEL_BROWSER_EVIDENCE) {
    await mkdir(process.env.BABEL_BROWSER_EVIDENCE, { recursive: true });
    await writeFile(path.join(process.env.BABEL_BROWSER_EVIDENCE, 'syntax-glyph-zoom.json'), JSON.stringify(observations, null, 2));
  }
});
