import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';
import { buildQualificationReviewRuntime } from '../../scripts/buildContractQualificationReviewRuntime.mjs';
import { prepareReplay } from '../../replay/prepareReplay.ts';

const records = JSON.parse(readFileSync(new URL('../../fixtures/movement/displayed-endpoints.json', import.meta.url)));
const terminal = id => ({ id, kind: 'terminal' });
const shell = id => ({ id, kind: 'category' });
const cases = [
  {
    id: 'sol-indonesian-applicative/0', relation: [3, 0], later: [4, 0],
    source: terminal('h_baca_lower'), target: terminal('h_baca_middle'),
    laterTarget: shell('h_appl_head_lower')
  },
  {
    id: 'astra-romanian-dative/0', relation: [4, 0],
    source: { ...terminal('cliticLow'), word: 'I' }, target: shell('cliticHigh')
  },
  {
    id: 'astra-swedish-passive/0', relation: [1, 1], later: [3, 1],
    source: shell('bookObjectTrace'), target: shell('book'), laterTarget: shell('bookSubjectTrace'),
    laterArrow: { relation: [3, 1], source: shell('bookSubjectTrace'), target: shell('book') }
  }
];

function relationMoment(steps, [stageIndex, relationIndex]) {
  const index = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === stageIndex
    && step.replayRelationIdentity.relationIndex === relationIndex);
  assert(index > 0, `Missing relation moment ${stageIndex}:${relationIndex}`);
  return index;
}

async function seek(page, index) {
  await page.getByRole('slider', { name: 'Replay frame', exact: true }).fill(String(index));
  await page.waitForFunction(index => {
    const svg = document.querySelector('svg[data-babel-rendered-step]');
    return svg?.dataset.babelRenderedStep === String(index) && svg.dataset.babelCameraSettledStep === String(index);
  }, index);
  await page.waitForFunction(() => !document.querySelector('svg[data-babel-rendered-step]')
    .getAnimations({ subtree: true }).some(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)
      && (animation.pending || animation.playState === 'running')));
}

// Inspect native SVG output. Expected labels come from the authored fixture, not
// from the attachment resolver whose decision this test is checking.
async function inspectArrow(page, expected) {
  return page.evaluate(({ relation, source, target }) => {
    const owner = relation.join(':');
    const owned = element => {
      for (let current = element; current; current = current.parentElement) {
        if ((current.getAttribute('data-vr-owner-refs') || '').split(/\s+/).includes(owner)) return true;
      }
      return false;
    };
    const paths = [...document.querySelectorAll('.babel-trajectory-path')].filter(owned);
    if (paths.length !== 1) return { count: paths.length };
    const path = paths[0], matrix = path.getScreenCTM(), inverse = matrix.inverse();
    const length = path.getTotalLength();
    const point = offset => {
      const p = path.getPointAtLength(offset);
      return { x: p.x, y: p.y };
    };
    const visible = element => {
      for (let current = element; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      }
      return true;
    };
    const labelBox = expected => {
      const labels = [...document.querySelectorAll(`.${expected.kind}-label`)].filter(label => {
        const node = label.__data__?.data;
        return label.getAttribute('data-category-node-id') === expected.id
          || label.getAttribute('data-node-id') === expected.id
          || node?.replayOrigin?.ownerId === expected.id || node?.aliasIds?.includes(expected.id);
      }).filter(visible);
      if (labels.length !== 1) return { count: labels.length };
      const label = labels[0], box = label.getBBox(), labelMatrix = label.getScreenCTM();
      const points = [[box.x, box.y], [box.x + box.width, box.y + box.height]].map(([x, y]) =>
        new DOMPoint(x, y).matrixTransform(labelMatrix).matrixTransform(inverse));
      return { count: 1, left: points[0].x, right: points[1].x, bottom: points[1].y,
        text: label.textContent, word: label.__data__?.data.word };
    };
    const marker = path.getAttribute('marker-end');
    const markerId = marker?.match(/^url\(#(.+)\)$/)?.[1];
    const markerElement = markerId && document.getElementById(markerId);
    const box = path.getBoundingClientRect(), style = getComputedStyle(path);
    return {
      count: paths.length, from: path.dataset.trajectoryFrom, to: path.dataset.trajectoryTo,
      d: path.getAttribute('d'), length, start: point(0), end: point(length),
      source: labelBox(source), target: labelBox(target),
      painted: visible(path) && style.stroke !== 'none' && parseFloat(style.strokeWidth) > 0,
      arrowhead: markerElement?.tagName.toLowerCase() === 'marker' && Boolean(markerElement.querySelector('path[d]')),
      inViewport: box.right > 0 && box.left < innerWidth && box.bottom > 0 && box.top < innerHeight,
      transform: document.querySelector('svg[data-babel-rendered-step] > g').getAttribute('transform')
    };
  }, expected);
}

function assertArrow(state, expected, acceptedAttachment = state) {
  const description = `${expected.relation.join(':')}: ${expected.source.id} → ${expected.target.id}`;
  assert.equal(state.count, 1, `${description}: exactly one owned arrow`);
  assert.equal(state.from, expected.source.id, `${description}: authored source`);
  assert.equal(state.to, expected.target.id, `${description}: current landing`);
  assert(state.painted && state.arrowhead && state.inViewport, `${description}: visible curve and arrowhead`);
  assert(Number.isFinite(state.length) && state.length > 0, `${description}: finite curve`);
  assert.doesNotMatch(state.d, /NaN|Infinity/);
  for (const [name, point] of [['source', state.start], ['target', state.end]]) {
    const label = state[name];
    assert.equal(label.count, 1, `${description}: one exact ${name} label`);
    const bounds = acceptedAttachment[name];
    // Allow the arrow's small lateral and vertical clearance, but reject an
    // endpoint on a different projection or the distant terminal below it.
    assert(point.x >= bounds.left - 12 && point.x <= bounds.right + 12
      && point.y >= bounds.bottom && point.y <= bounds.bottom + 20,
    `${description}: ${name} endpoint misses its ${expected[name].kind} label: ${JSON.stringify({ point, bounds })}`);
    if (expected[name].word) assert.equal(label.word, expected[name].word);
  }
}

test('movement endpoints stay attached through later movement, seeking, zoom and Fit', { timeout: 180_000 }, async t => {
  const runtime = await buildQualificationReviewRuntime({ entrySource: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import TreeVisualizer from './components/TreeVisualizer';
    import {buildDerivationCanvasData} from './replay/replayCanvas.ts';
    import './styles.css';
    const records = ${JSON.stringify(records).replaceAll('<', '\\u003c')};
    const record = records.find(record => record.id === window.movementRecordId);
    createRoot(document.getElementById('root')).render(<TreeVisualizer
      data={buildDerivationCanvasData(record.derivationStages.at(-1).workspaceForest)}
      derivationStages={record.derivationStages} sentence={record.sentence}
      inputTokens={record.inputTokens} animated autoPlay={false}/>);
  ` });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const specimen of cases) await t.test(specimen.id, async () => {
      const record = records.find(record => record.id === specimen.id);
      assert(record, `Missing saved record ${specimen.id}`);
      const steps = prepareReplay({ ...record, includePlayback: true }).playbackSteps;
      const moment = relationMoment(steps, specimen.relation);
      const later = specimen.later ? relationMoment(steps, specimen.later) : steps.length - 1;
      const persistent = { ...specimen, target: specimen.laterTarget || specimen.target };
      for (const width of [1200, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const errors = [];
        page.on('pageerror', error => errors.push(String(error)));
        await page.route('**/*', route => { errors.push(`Unexpected request: ${route.request().url()}`); return route.abort(); });
        try {
          await page.setContent(`<style>${runtime.css}</style><div id="root" style="height:100vh"></div>
            <script>window.movementRecordId=${JSON.stringify(specimen.id)}</script><script>${runtime.js}</script>`);
          await page.locator('svg[data-babel-rendered-step]').waitFor();
          await page.evaluate(() => document.fonts.ready);
          await seek(page, moment - 1);
          assert.equal((await inspectArrow(page, specimen)).count, 0, 'No arrow before its owning relation');
          await seek(page, moment);
          assertArrow(await inspectArrow(page, specimen), specimen);
          await seek(page, later);
          assertArrow(await inspectArrow(page, persistent), persistent);
          if (specimen.laterArrow) assertArrow(await inspectArrow(page, specimen.laterArrow), specimen.laterArrow);
          await seek(page, steps.length - 1);
          const final = await inspectArrow(page, persistent);
          assertArrow(final, persistent);
          if (specimen.laterArrow) assertArrow(await inspectArrow(page, specimen.laterArrow), specimen.laterArrow);

          await page.mouse.move(width / 2, 300);
          await page.mouse.wheel(0, -160);
          await page.waitForFunction(transform => document.querySelector('svg[data-babel-rendered-step] > g')
            .getAttribute('transform') !== transform, final.transform);
          const zoomed = await inspectArrow(page, persistent);
          // Tiny text can acquire different glyph bounds after zoom. The
          // accepted curve keeps its geometry rather than chasing those bounds.
          assertArrow(zoomed, persistent, final);
          assert.equal(zoomed.d, final.d, 'Zoom preserves the accepted path');
          const beforeFit = await page.locator('svg[data-babel-rendered-step] > g').elementHandle();
          await page.getByRole('button', { name: /fit/i }).click();
          await page.waitForFunction(previous => !previous.isConnected, beforeFit);
          await page.waitForFunction(index => {
            const svg = document.querySelector('svg[data-babel-rendered-step]');
            return svg?.dataset.babelRenderedStep === String(index) && svg.dataset.babelCameraSettledStep === String(index);
          }, steps.length - 1);
          assertArrow(await inspectArrow(page, persistent), persistent);

          await seek(page, moment);
          assertArrow(await inspectArrow(page, specimen), specimen);
          await seek(page, moment - 1);
          assert.equal((await inspectArrow(page, specimen)).count, 0, 'Rewinding removes only this later claim');
          assert.deepEqual(errors, []);
        } finally { await page.close(); }
      }
    });
  } finally { await browser.close(); }
});
