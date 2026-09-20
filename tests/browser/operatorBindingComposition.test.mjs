import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { buildQualificationReviewRuntime } from '../../scripts/buildContractQualificationReviewRuntime.mjs';
import { prepareReplay } from '../../replay/prepareReplay.ts';

test('one binding curve serves both moments while the domain retains its own emphasis', async () => {
  const tree = { id: 'cp', label: 'CP', children: [
    { id: 'operator', label: 'D', lineageId: 'relative' },
    { id: 'domain', label: 'TP', children: [
      { id: 'subject', label: 'D', word: 'Mia' },
      { id: 'vp', label: 'VP', children: [{ id: 'verb', label: 'V', word: 'bought' },
        { id: 'variable', label: 'D[trace]', lineageId: 'relative' }] }
    ] }
  ] };
  const claim = { relation: 'relative abstraction', anchors: { operator: 'operator', variable: 'variable', domain: 'domain' } };
  const stages = [
    { statement: 'Bind the object.', stageRecord: 'An operator binds the object position.', workspaceForest: [tree], relations: [claim] },
    { statement: 'Restate the dependency.', stageRecord: 'The same binding continues.', workspaceForest: [tree],
      relations: [{ relation: 'relative operator dependency', anchors: { operator: 'operator', variable: 'variable' } }] }
  ];
  const steps = prepareReplay({ sentence: 'Mia bought', derivationStages: stages, includePlayback: true }).playbackSteps;
  const moments = [0, 1].map(stageIndex => steps.findIndex(step => step.replayRelationIdentity?.stageIndex === stageIndex));
  assert(moments.every(index => index >= 0));
  const runtime = await buildQualificationReviewRuntime();
  const compiled = await build({ absWorkingDir: new URL('../../', import.meta.url).pathname,
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import TreeVisualizer from './components/TreeVisualizer';
      createRoot(document.getElementById('root')).render(<TreeVisualizer data={${JSON.stringify(tree)}}
        derivationStages={${JSON.stringify(stages)}} sentence="Mia bought" animated />);`,
      loader: 'tsx', resolveDir: new URL('../../', import.meta.url).pathname },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.setContent(`<style>${runtime.css}</style><div id="root" style="height:900px"></div><script>${compiled.outputFiles[0].text}</script>`);
    await page.locator('svg[data-babel-rendered-step]').waitFor();
    if (await page.getByRole('button', { name: 'Pause', exact: true }).count()) await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const go = async index => {
      await page.locator('input[type=range]').fill(String(index));
      await page.waitForFunction(i => document.querySelector('svg[data-babel-rendered-step]')?.getAttribute('data-babel-rendered-step') === String(i), index);
    };
    const inspect = () => page.evaluate(() => {
      const path = document.querySelector('.babel-operator-variable-path');
      const domain = document.querySelector('.babel-operator-variable-domain');
      const owner = element => element.closest('.vr-item');
      return { count: document.querySelectorAll('.babel-operator-variable-path').length,
        domains: document.querySelectorAll('.babel-operator-variable-domain').length,
        d: path.getAttribute('d'), domainD: domain.getAttribute('d'),
        pathOwners: owner(path).getAttribute('data-vr-owner-refs'), domainOwners: owner(domain).getAttribute('data-vr-owner-refs'),
        pathOpacity: getComputedStyle(owner(path)).opacity, domainOpacity: getComputedStyle(owner(domain)).opacity,
        transform: document.querySelector('svg > g').getAttribute('transform') };
    });
    await go(moments[0]);
    const first = await inspect();
    assert.equal(first.count, 1); assert.equal(first.domains, 1);
    assert.equal(first.pathOpacity, '1'); assert.equal(first.domainOpacity, '1');
    await go(moments[1]);
    const restated = await inspect();
    assert.equal(restated.count, 1); assert.equal(restated.domains, 1);
    assert.deepEqual(restated.pathOwners.split(' ').sort(), ['0:0', '1:0']); assert.equal(restated.domainOwners, '0:0');
    assert.equal(restated.pathOpacity, '1'); assert.equal(restated.domainOpacity, '0.3');
    assert.equal(restated.d, first.d, 'sharing a path does not reroute it');
    const path = page.locator('.babel-operator-variable-path');
    await path.dispatchEvent('mousemove', { clientX: 450, clientY: 250 });
    await page.waitForFunction(() => document.querySelector('.babel-operator-variable-shared-path-layer.vr-relation-hovered'));
    assert.equal(await page.locator('.babel-operator-variable-domain').evaluate(e => Boolean(e.closest('.vr-relation-hovered'))), false,
      'hovering the shared path must not claim its earlier domain');
    assert.deepEqual(await inspect(), restated, 'hover does not change geometry or opacity');
    await page.mouse.move(600, 300); await page.mouse.wheel(0, -220);
    await page.waitForFunction(t => document.querySelector('svg > g').getAttribute('transform') !== t, restated.transform);
    const zoom = await inspect();
    assert.equal(zoom.count, 1); assert.equal(zoom.d, restated.d);
    await page.getByRole('button', { name: /fit/i }).click();
    await page.waitForFunction(t => document.querySelector('svg > g').getAttribute('transform') !== t, zoom.transform);
    await page.waitForFunction(() => document.querySelector('.babel-operator-variable-path')?.getAttribute('d')?.startsWith('M'));
    assert.equal((await inspect()).count, 1);
    await go(steps.length - 1);
    assert.equal((await inspect()).count, 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
