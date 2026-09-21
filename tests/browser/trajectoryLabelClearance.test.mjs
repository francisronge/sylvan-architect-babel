import { inlineWorkerPlugin } from '../../scripts/inlineWorkerPlugin.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { buildQualificationReviewRuntime } from '../../scripts/buildContractQualificationReviewRuntime.mjs';
import { prepareReplay } from '../../replay/prepareReplay.ts';

test('movement keeps its curve and puts visible labels in front through zoom and Fit', async () => {
  const tree = { id: 'clause', label: 'TP', children: [
    { id: 'high', label: 'DP', lineageId: 'subject', children: [{ id: 'name', label: 'D', word: 'Mia', lineageId: 'subject' }] },
    { id: 'vp', label: 'VP', children: [{ id: 'v', label: 'V', word: 'left' },
      { id: 'low', label: 'DP', lineageId: 'subject', children: [
        { id: 'trace', label: 'D', word: 't1', silent: true, lineageId: 'subject' }
      ] }] }
  ] };
  const stages = [{ statement: 'A movement chain.', stageRecord: 'The chain has two occurrences.', workspaceForest: [tree],
    relations: [{ relation: 'subject movement chain', anchors: { source: 'low', landing: 'high', traceWitness: 'trace' } }] }];
  const steps = prepareReplay({ sentence: 'Mia left', derivationStages: stages, includePlayback: true }).playbackSteps;
  const moment = steps.findIndex(step => step.replayRelationIdentity);
  const runtime = await buildQualificationReviewRuntime();
  const compiled = await build({
    plugins: [inlineWorkerPlugin()], absWorkingDir: new URL('../../', import.meta.url).pathname,
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import TreeVisualizer from './components/TreeVisualizer';
      createRoot(document.getElementById('root')).render(<TreeVisualizer data={${JSON.stringify(tree)}}
        derivationStages={${JSON.stringify(stages)}} sentence="Mia left" animated />);`,
    loader: 'tsx', resolveDir: new URL('../../', import.meta.url).pathname },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.setContent(`<style>${runtime.css}</style><div id="root" style="height:900px"></div><script>${compiled.outputFiles[0].text}</script>`);
    const svg = page.locator('svg[data-babel-rendered-step]');
    await svg.waitFor();
    if (await page.getByRole('button', { name: 'Pause', exact: true }).count()) await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.locator('input[type=range]').fill(String(moment));
    await page.waitForFunction(i => document.querySelector('svg[data-babel-rendered-step]')?.getAttribute('data-babel-rendered-step') === String(i), moment);
    const inspect = () => page.evaluate(() => {
      const path = document.querySelector('.babel-trajectory-path');
      const mask = document.getElementById(path.getAttribute('mask').slice(5, -1));
      const parent = document.querySelector('svg > g');
      const inverse = parent.getCTM().inverse();
      const labels = [...parent.querySelectorAll('.category-label,.terminal-label')]
        .filter(label => label.closest('.node-group').getAttribute('opacity') !== '0');
      const holes = [...mask.querySelectorAll('.trajectory-label-clearance')].map(rect => ({
        x: +rect.getAttribute('x'), y: +rect.getAttribute('y'), w: +rect.getAttribute('width'), h: +rect.getAttribute('height')
      }));
      return { d: path.getAttribute('d'), transform: parent.getAttribute('transform'), count: holes.length, labels: labels.length,
        clear: labels.every(label => {
          const r = label.getBBox(), m = label.getCTM();
          const p = new DOMPoint(r.x, r.y).matrixTransform(m).matrixTransform(inverse);
          const q = new DOMPoint(r.x + r.width, r.y + r.height).matrixTransform(m).matrixTransform(inverse);
          return holes.some(h => h.x <= p.x && h.y <= p.y && h.x + h.w >= q.x && h.y + h.h >= q.y);
        }) };
    });
    const before = await inspect();
    assert(before.clear);
    assert.equal(before.count, before.labels, 'future labels must not cut holes');
    await page.mouse.move(600, 300);
    await page.mouse.wheel(0, -220);
    await page.waitForFunction(t => document.querySelector('svg > g').getAttribute('transform') !== t, before.transform);
    const zoomed = await inspect();
    assert(zoomed.clear);
    assert.equal(zoomed.d, before.d, 'zoom and clearance preserve the accepted curve');
    await page.getByRole('button', { name: /fit/i }).click();
    await page.waitForFunction(t => document.querySelector('svg > g').getAttribute('transform') !== t, zoomed.transform);
    await page.waitForFunction(() => document.querySelector('.babel-trajectory-path')?.hasAttribute('mask'));
    assert((await inspect()).clear);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
