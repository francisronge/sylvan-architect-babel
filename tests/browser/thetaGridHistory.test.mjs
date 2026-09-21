import { inlineWorkerPlugin } from '../../scripts/inlineWorkerPlugin.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { buildQualificationReviewRuntime } from '../../scripts/buildContractQualificationReviewRuntime.mjs';
import { prepareReplay } from '../../replay/prepareReplay.ts';

// Run explicitly with Node's test runner; the offline gate needs no browser install.
test('one theta grid gains rows at their own moments and hovers them independently', async () => {
  const tree = { id: 'vp', label: 'VP', children: [
    { id: 'agent', label: 'DP', word: 'Mia' },
    { id: 'bar', label: "V'", children: [{ id: 'v', label: 'V', word: 'bought' }, { id: 'theme', label: 'DP', word: 'books' }] }
  ] };
  const relations = [
    { relation: 'ThetaAssignment', anchors: { predicate: 'v', Theme: 'theme' } },
    { relation: 'ThetaAssignment', anchors: { predicate: 'v', Agent: 'agent', Theme: 'theme' } },
    { relation: 'CaseAssignment', anchors: { assigner: 'v', bearer: 'theme' }, values: { case: 'accusative' } }
  ];
  const stages = [{ statement: 'A phrase', stageRecord: 'Independent authored moments.', workspaceForest: [tree], relations }];
  const steps = prepareReplay({ sentence: 'Mia bought books', derivationStages: stages, includePlayback: true }).playbackSteps;
  const moment = ri => steps.findIndex(step => step.replayRelationIdentity?.relationIndex === ri);
  const runtime = await buildQualificationReviewRuntime();
  const compiled = await build({
    plugins: [inlineWorkerPlugin()], absWorkingDir: new URL('../../', import.meta.url).pathname,
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import TreeVisualizer from './components/TreeVisualizer';
      createRoot(document.getElementById('root')).render(<TreeVisualizer data={${JSON.stringify(tree)}}
        derivationStages={${JSON.stringify(stages)}} sentence="Mia bought books" animated />);`, loader: 'tsx', resolveDir: new URL('../../', import.meta.url).pathname },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.setContent(`<style>${runtime.css}</style><div id="root" style="height:900px"></div><script>${compiled.outputFiles[0].text}</script>`);
    await page.locator('svg[data-babel-rendered-step]').waitFor();
    if (await page.getByRole('button', { name: 'Pause', exact: true }).count()) await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.evaluate(() => document.fonts.ready);
    const seek = async ri => {
      await page.locator('input[type=range]').fill(String(moment(ri)));
      await page.waitForFunction(i => document.querySelector('svg[data-babel-rendered-step]')?.getAttribute('data-babel-rendered-step') === String(i), moment(ri));
    };
    const grid = page.locator('.babel-theta-grid-plate');
    const labels = () => grid.locator('.babel-theta-grid-role').allTextContents();
    const origin = () => grid.locator('.babel-theta-grid-shell').evaluate(el => [el.getAttribute('x'), el.getAttribute('y')]);
    await seek(0);
    assert.equal(await grid.count(), 1);
    assert.deepEqual(await labels(), ['Theme']);
    const first = await origin();
    await seek(1);
    assert.equal(await grid.count(), 1);
    assert.deepEqual(await labels(), ['Theme', 'Agent']);
    assert.deepEqual(await origin(), first);
    await seek(0);
    assert.deepEqual(await labels(), ['Theme']);
    await seek(2);
    const theme = grid.locator('.babel-theta-grid-column').filter({ hasText: 'Theme' });
    const agent = grid.locator('.babel-theta-grid-column').filter({ hasText: 'Agent' });
    const measure = el => { const b = el.getBBox(); return { opacity: getComputedStyle(el).opacity,
      filter: getComputedStyle(el).filter, box: [b.x, b.y, b.width, b.height] }; };
    const beforeTheme = await theme.evaluate(measure), beforeAgent = await agent.evaluate(measure);
    assert.equal(beforeTheme.opacity, '0.3');
    assert.equal(beforeAgent.opacity, '0.3');
    await theme.dispatchEvent('mousemove', { clientX: 200, clientY: 250 });
    await page.waitForFunction(() => document.querySelector('.babel-theta-grid-column.vr-relation-hovered'));
    const hovered = await theme.evaluate(measure);
    assert.match(hovered.filter, /drop-shadow/);
    assert.deepEqual({ ...hovered, filter: beforeTheme.filter }, beforeTheme);
    assert.deepEqual(await agent.evaluate(measure), beforeAgent, 'earlier Theme hover must not highlight the later Agent');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
