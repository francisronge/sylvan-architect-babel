import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { buildQualificationReviewRuntime } from '../../scripts/buildContractQualificationReviewRuntime.mjs';
import { prepareReplay } from '../../replay/prepareReplay.ts';

test('standalone and Case-composed feature plaques keep row attachment through Replay, zoom, hover and mobile', async () => {
  const tree = { id: 'root', label: 'PP', children: [{ id: 'p', label: 'P', word: 'with' }, { id: 'k', label: 'KP', children: [
    { id: 'num', label: 'Num', word: 'books' }, { id: 'n', label: 'N' }
  ] }] };
  const agreement = { relation: 'An open agreement', anchors: { probe: 'k', goal: 'num' }, values: { agreement: ['inclusive', 'dual'] } };
  const caseRelation = { relation: 'CaseAssignment', anchors: { assigner: 'p', bearer: 'k' }, values: { feature: 'Case', value: 'DAT' } };
  const runtime = await buildQualificationReviewRuntime();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const variant of ['standalone', 'bearer', 'same-pair']) {
      const combined = variant !== 'standalone';
      const samePair = variant === 'same-pair';
      const agreementIndex = samePair ? 2 : Number(combined);
      const relations = [...(samePair ? [{ relation: 'Finite specification', anchors: { finiteHead: 'p' },
        values: { number: 'singular', person: 'third' } }] : []), ...(combined ? [caseRelation] : []),
        samePair ? { ...agreement, anchors: { head: 'p', specifier: 'k' } } : agreement, { relation: 'Another description', anchors: { participant: 'n' } }];
      const stages = [{ statement: 'Features.', stageRecord: 'Independent moments.', workspaceForest: [tree], relations }];
      const steps = prepareReplay({ sentence: 'with books', derivationStages: stages, includePlayback: true }).playbackSteps;
      const moment = steps.findIndex(step => step.replayRelationIdentity?.relationIndex === agreementIndex);
      const next = steps.findIndex(step => step.replayRelationIdentity?.relationIndex === agreementIndex + 1);
      const compiled = await build({ absWorkingDir: new URL('../../', import.meta.url).pathname,
        stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import TreeVisualizer from './components/TreeVisualizer';
          createRoot(document.getElementById('root')).render(<TreeVisualizer data={${JSON.stringify(tree)}} derivationStages={${JSON.stringify(stages)}} sentence="with books" animated />);`,
        loader: 'tsx', resolveDir: new URL('../../', import.meta.url).pathname },
        bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
      const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      const errors = []; page.on('pageerror', error => errors.push(String(error)));
      await page.setContent(`<style>${runtime.css}</style><div id="root" style="height:900px"></div><script>${compiled.outputFiles[0].text}</script>`);
      await page.locator('svg[data-babel-rendered-step]').waitFor();
      if (await page.getByRole('button', { name: 'Pause', exact: true }).count()) await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await page.evaluate(() => document.fonts.ready);
      const go = async index => { await page.locator('input[type=range]').fill(String(index));
        await page.waitForFunction(i => document.querySelector('svg[data-babel-rendered-step]')?.getAttribute('data-babel-rendered-step') === String(i), index); };
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
          assert(Math.abs(path.start.x - state.rect.x + 12) < 1 || Math.abs(path.start.x - state.rect.x - state.rect.width - 12) < 1);
          assert(path.start.y > state.rect.y && path.start.y < state.rect.y + state.rect.height);
        }
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
