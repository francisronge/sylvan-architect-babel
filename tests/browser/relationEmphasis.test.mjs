import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { buildQualificationReviewRuntime } from '../../scripts/buildContractQualificationReviewRuntime.mjs';
import { prepareReplay } from '../../replay/prepareReplay.ts';

// Run explicitly with Node's test runner; the offline gate needs no browser install.
test('relation emphasis survives a redraw, and hovering quiet ink preserves its geometry', async () => {
  const tree = { id: 'vp', label: 'VP', children: [
    { id: 'v', label: 'V', word: 'read' }, { id: 'dp', label: 'DP', word: 'books' }
  ] };
  const stages = [{ statement: 'Build a phrase.', stageRecord: 'Two independent authored claims.', workspaceForest: [tree], relations: [
    { relation: 'ThetaAssignment', anchors: { predicate: 'v', Theme: 'dp' } },
    { relation: 'An open Case claim', anchors: { source: 'v', recipient: 'dp' }, values: { case: 'accusative' } }
  ] }];
  const steps = prepareReplay({ sentence: 'read books', derivationStages: stages, includePlayback: true }).playbackSteps;
  const moment = steps.findIndex(step => step.replayRelationIdentity?.relationIndex === 1);
  assert(moment >= 0);
  const runtime = await buildQualificationReviewRuntime();
  const compiled = await build({ absWorkingDir: new URL('../../', import.meta.url).pathname,
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import TreeVisualizer from './components/TreeVisualizer';
      createRoot(document.getElementById('root')).render(<TreeVisualizer data={${JSON.stringify(tree)}}
        derivationStages={${JSON.stringify(stages)}} sentence="read books" animated />);`, loader: 'tsx', resolveDir: new URL('../../', import.meta.url).pathname },
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
    await page.evaluate(() => document.fonts.ready);
    await page.locator('input[type=range]').fill(String(moment));
    await page.waitForFunction(i => document.querySelector('svg[data-babel-rendered-step]')?.getAttribute('data-babel-rendered-step') === String(i), moment);
    const quiet = page.locator('svg .vr-item[data-vr-stage-index="0"][data-vr-relation-index="0"]').first();
    await quiet.waitFor();
    const old = await svg.locator(':scope > g').elementHandle();
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.waitForFunction(old => !old.isConnected && document.querySelector('svg[data-babel-rendered-step]'), old);
    await page.waitForFunction(() => document.querySelector('svg .vr-relation-quiet'));
    const measure = element => {
      const { x, y, width, height } = element.getBBox();
      return { opacity: getComputedStyle(element).opacity, filter: getComputedStyle(element).filter,
        box: [x, y, width, height], paths: [...element.querySelectorAll('path')].map(path => [path.getAttribute('d'), getComputedStyle(path).strokeWidth]) };
    };
    assert.equal(await page.locator('svg .vr-relation-active').first().evaluate(element => getComputedStyle(element).opacity), '1');
    const before = await quiet.evaluate(measure);
    assert.equal(before.opacity, '0.3');
    await quiet.dispatchEvent('mousemove', { clientX: 200, clientY: 250 });
    await page.waitForFunction(() => document.querySelector('svg .vr-relation-hovered'));
    const after = await quiet.evaluate(measure);
    assert.match(after.filter, /drop-shadow/);
    assert.deepEqual({ ...after, filter: before.filter }, before);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
