import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { buildQualificationReviewRuntime } from '../../scripts/buildContractQualificationReviewRuntime.mjs';
import { blockedOutcomeFixtures } from '../helpers/blockedOutcomeFixtures.mjs';

test('blocked outcomes survive production path finalization, Replay seeking, zoom and Fit', {
  timeout: 180_000
}, async () => {
  const cases = blockedOutcomeFixtures();
  assert.equal(cases.length, 6);
  const runtime = await buildQualificationReviewRuntime({ entrySource: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import TreeVisualizer from './components/TreeVisualizer';
    import {displayTreeForAnalysis} from './replay/finalForest';
    import './styles.css';
    const specimen = ${JSON.stringify(cases).replaceAll('<', '\\u003c')}.find(item => item.id === window.blockedSpecimenId);
    const analysis = specimen.bundle.analyses[0];
    createRoot(document.getElementById('root')).render(<TreeVisualizer
      data={displayTreeForAnalysis(analysis)} derivationStages={analysis.derivationStages}
      sentence={specimen.bundle.sentence} inputTokens={specimen.bundle.inputTokens} animated autoPlay={false}/>);
  ` });
  const output = process.env.BABEL_OUTCOME_EVIDENCE || await fs.mkdtemp(path.join(os.tmpdir(), 'babel-outcome-paint-'));
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [], requests = [], evidence = [];
  const settle = async (page, index) => {
    await page.waitForFunction(index => {
      const svg = document.querySelector('svg[data-babel-rendered-step]');
      return svg?.dataset.babelRenderedStep === String(index) && svg.dataset.babelCameraSettledStep === String(index);
    }, index);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => {
      const svg = document.querySelector('svg[data-babel-rendered-step]');
      const panel = document.querySelector('[data-babel-replay-panel]');
      const animations = [...svg.getAnimations({ subtree: true }), ...(panel?.getAnimations({ subtree: true }) || [])];
      return !animations.some(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)
        && (animation.pending || animation.playState === 'running'));
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const painted = async page => page.locator('path.babel-trajectory-path[data-trajectory-kind]').evaluateAll(paths => paths.map(element => {
    const style = getComputedStyle(element);
    const shadow = element.parentElement.querySelector('.babel-trajectory-path-shadow');
    const owners = new Set();
    for (let current = element; current; current = current.parentElement) {
      (current.getAttribute('data-vr-owner-refs') || '').split(/\s+/).filter(Boolean).forEach(owner => owners.add(owner));
    }
    return { kind: element.dataset.trajectoryKind, failed: element.classList.contains('babel-locality-path-failed'),
      marker: element.getAttribute('marker-end'), dash: style.strokeDasharray, shadowDash: shadow && getComputedStyle(shadow).strokeDasharray,
      from: element.dataset.trajectoryFrom, to: element.dataset.trajectoryTo, length: element.getTotalLength(), owners: [...owners] };
  }));
  const verify = async (page, entry) => {
    const paths = await painted(page); assert.equal(paths.length, 1);
    for (const item of paths) {
      assert(item.failed); assert.equal(item.marker, null);
      assert.notEqual(item.dash, 'none'); assert.equal(item.dash, item.shadowDash);
      assert(item.from && item.to && Number.isFinite(item.length) && item.length > 0);
      assert.equal(item.from, entry.from); assert.equal(item.to, entry.to); assert.equal(item.kind, entry.kind);
      assert(item.owners.includes(entry.owner), 'Blocked path belongs to its exact authored claim');
    }
    return paths;
  };
  try {
    for (const entry of cases) for (const width of [1600, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      page.setDefaultTimeout(20_000);
      page.on('pageerror', error => errors.push({ id: entry.id, width, message: String(error) }));
      await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
      const { moment } = entry;
      try {
        await page.setContent(`<style>${runtime.css}</style><div id="root" style="height:100vh"></div>
          <script>window.blockedSpecimenId=${JSON.stringify(entry.id)}</script><script>${runtime.js.replace(/<\/script/gi, '<\\/script')}</script>`);
        await settle(page, 0);
        const slider = page.getByRole('slider', { name: 'Replay frame' });
        await slider.fill(String(moment - 1)); await settle(page, moment - 1);
        assert.equal((await painted(page)).length, 0, 'blocked path must not appear before its relation');
        await slider.fill(String(moment)); await settle(page, moment);
        const before = await verify(page, entry);
        await page.screenshot({ path: path.join(output, `${entry.id}-${width}-after.png`) });
        const box = await page.locator('svg[data-babel-tree]').boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
        const transform = await page.locator('svg[data-babel-tree] > g').getAttribute('transform');
        await page.mouse.wheel(0, -250);
        await page.waitForFunction(previous => document.querySelector('svg[data-babel-tree] > g')?.getAttribute('transform') !== previous, transform);
        await settle(page, moment); await verify(page, entry);
        const beforeFit = await page.locator('svg[data-babel-tree] > g').elementHandle();
        await page.getByRole('button', { name: /fit/i }).click();
        await page.waitForFunction(previous => !previous.isConnected, beforeFit);
        await settle(page, moment); await verify(page, entry);
        await slider.fill(String(entry.final)); await settle(page, entry.final); await verify(page, entry);
        await slider.fill(String(moment - 1)); await settle(page, moment - 1);
        assert.equal((await painted(page)).length, 0, 'rewinding removes blocked marks');
        await slider.fill(String(moment)); await settle(page, moment); await verify(page, entry);
        assert(await page.getByRole('button', { name: 'Next', exact: true }).isVisible());
        await page.mouse.move(width - 10, 20);
        await page.screenshot({ path: path.join(output, `${entry.id}-${width}-after-fit.png`) });
        evidence.push({ id: entry.id, width, before, replaySeek: true, zoom: true, fit: true, persistence: true });
      } catch (error) {
        await page.screenshot({ path: path.join(output, `${entry.id}-${width}-failure.png`) }).catch(() => {});
        throw error;
      } finally { await page.close(); }
    }
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, 'outcome-paint.json'), JSON.stringify({ runtime: runtime.metadata,
      evidence, errors, requests, closed: true }, null, 2));
  }
});
