import { inlineWorkerPlugin } from '../../scripts/inlineWorkerPlugin.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { buildQualificationReviewRuntime } from '../../scripts/buildContractQualificationReviewRuntime.mjs';

test('neutral connectors pass under visible tree text through zoom and Fit', async () => {
  // Frame 41 holds a counter-lane connector for Principle B below the relative clause.
  const fixture = JSON.parse(await readFile(new URL('../../fixtures/replay-regressions/workspace-arabic-continuity.json', import.meta.url), 'utf8'));
  const { sentence, inputTokens, derivationStages } = fixture.cases[9];
  const runtime = await buildQualificationReviewRuntime();
  const compiled = await build({
    plugins: [inlineWorkerPlugin()], absWorkingDir: new URL('../../', import.meta.url).pathname,
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import TreeVisualizer from './components/TreeVisualizer';
      import {buildDerivationCanvasData} from './replay/replayCanvas.ts';
      const stages = ${JSON.stringify(derivationStages)};
      createRoot(document.getElementById('root')).render(<TreeVisualizer data={buildDerivationCanvasData(stages.at(-1).workspaceForest)}
        derivationStages={stages} sentence={${JSON.stringify(sentence)}} inputTokens={${JSON.stringify(inputTokens)}}
        animated autoPlay={false} initialReplayStep={40} />);`,
    loader: 'tsx', resolveDir: new URL('../../', import.meta.url).pathname },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.setContent(`<style>${runtime.css}</style><div id="root" style="height:900px"></div><script>${compiled.outputFiles[0].text}</script>`);
    await page.waitForFunction(() => document.querySelector('svg[data-babel-rendered-step]')?.getAttribute('data-babel-rendered-step') === '40'
      && document.querySelector('.vr-fallback-connector path[mask]'));
    const inspect = () => page.evaluate(() => {
      const paths = [...document.querySelectorAll('.vr-fallback-connector path')];
      const masks = new Set(paths.map(path => path.getAttribute('mask')));
      const mask = document.getElementById([...masks][0].slice(5, -1));
      const shown = [...document.querySelectorAll('.node-group .category-label, .node-group .terminal-label')]
        .filter(label => label.closest('.node-group').getAttribute('opacity') !== '0');
      const copies = [...mask.querySelectorAll('text')];
      const placed = shown.every(label => copies.some(copy => copy.textContent === label.textContent
        && copy.parentNode.getAttribute('transform') === label.closest('.node-group').getAttribute('transform')
        && copy.getAttribute('x') === label.getAttribute('x') && copy.getAttribute('y') === label.getAttribute('y')));
      return { masks: masks.size, copies: copies.length, labels: shown.length, placed,
        hidden: copies.every(copy => getComputedStyle(copy).fill === 'rgb(0, 0, 0)' && !copy.hasAttribute('class')),
        open: mask.querySelector('rect')?.getAttribute('fill'),
        d: paths.map(path => path.getAttribute('d')).join(' '), transform: document.querySelector('svg > g').getAttribute('transform') };
    });
    const check = state => {
      assert.equal(state.masks, 1, 'every connector path uses the text mask');
      assert.equal(state.open, 'white', 'the line shows outside the text');
      assert.equal(state.copies, state.labels, 'each visible label, and only those, masks the line');
      assert.ok(state.placed, 'each mask copy sits exactly on its label');
      assert.ok(state.hidden, 'mask copies hide the line and are not labels themselves');
    };
    const before = await inspect();
    check(before);
    await page.mouse.move(700, 300);
    await page.mouse.wheel(0, -220);
    await page.waitForFunction(t => document.querySelector('svg > g').getAttribute('transform') !== t, before.transform);
    const zoomed = await inspect();
    check(zoomed);
    assert.equal(zoomed.d, before.d, 'zoom keeps the connector geometry');
    await page.getByRole('button', { name: /fit/i }).first().click();
    await page.waitForFunction(t => document.querySelector('svg > g').getAttribute('transform') !== t, zoomed.transform);
    check(await inspect());
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
