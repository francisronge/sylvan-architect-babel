import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';

// The saved provider-free review supplies six blocked-path fixtures. This test
// uses its production runtime and never starts a provider or development server.
const url = process.env.BABEL_OUTCOME_REVIEW_URL;

test('blocked outcomes survive production path finalization, Replay seeking, zoom and Fit', {
  skip: !url && 'Set BABEL_OUTCOME_REVIEW_URL to the served qualification review.', timeout: 120_000
}, async () => {
  const base = new URL(url.endsWith('/') ? url : `${url}/`);
  assert(['http:', 'https:'].includes(base.protocol));
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
  const read = async name => { const response = await fetch(new URL(name, base)); assert(response.ok); return response.json(); };
  const [catalog, frames] = await Promise.all([read('catalog.json'), read('frame-map.json')]);
  const cases = catalog.filter(entry => entry.id.startsWith('check-blocked-'));
  assert.equal(cases.length, 6);
  const output = process.env.BABEL_OUTCOME_EVIDENCE || await fs.mkdtemp(path.join(os.tmpdir(), 'babel-outcome-paint-'));
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [], requests = [], evidence = [];
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(20_000);
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/api/**', route => { requests.push(route.request().url()); return route.abort(); });
  const settle = async index => {
    await page.waitForFunction(index => document.querySelector('svg[data-babel-rendered-step]')?.getAttribute('data-babel-rendered-step') === String(index), index);
    await page.waitForFunction(() => {
      const svg = document.querySelector('svg[data-babel-rendered-step]');
      const panel = document.querySelector('[data-babel-replay-panel]');
      const animations = [...svg.getAnimations({ subtree: true }), ...(panel?.getAnimations({ subtree: true }) || [])];
      return !animations.some(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)
        && (animation.pending || animation.playState === 'running'));
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const painted = async () => page.locator('path.babel-trajectory-path[data-trajectory-kind]').evaluateAll(paths => paths.map(element => {
    const style = getComputedStyle(element);
    const shadow = element.parentElement.querySelector('.babel-trajectory-path-shadow');
    return { kind: element.dataset.trajectoryKind, failed: element.classList.contains('babel-locality-path-failed'),
      marker: element.getAttribute('marker-end'), dash: style.strokeDasharray, shadowDash: shadow && getComputedStyle(shadow).strokeDasharray,
      from: element.dataset.trajectoryFrom, to: element.dataset.trajectoryTo, length: element.getTotalLength() };
  }));
  const verify = async () => {
    const paths = await painted(); assert.equal(paths.length, 1);
    for (const item of paths) {
      assert(item.failed); assert.equal(item.marker, null);
      assert.notEqual(item.dash, 'none'); assert.equal(item.dash, item.shadowDash);
      assert(item.from && item.to && Number.isFinite(item.length) && item.length > 0);
    }
    return paths;
  };
  try {
    for (const entry of cases) {
      const moment = frames[entry.key].find(frame => frame.kind === 'relation').frameIndex;
      await page.goto(new URL(`${entry.replayFile}?analysis=0&frame=${moment}`, base).href);
      await settle(moment);
      const before = await verify();
      await page.screenshot({ path: path.join(output, `${entry.id}-after.png`) });
      const slider = page.getByRole('slider', { name: 'Replay frame' });
      await slider.fill(String(moment - 1)); await settle(moment - 1);
      assert.equal((await painted()).length, 0, 'blocked path must not appear before its relation');
      await slider.fill(String(moment)); await settle(moment); await verify();
      const box = await page.locator('svg[data-babel-tree]').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
      await page.mouse.wheel(0, -250);
      await settle(moment); await verify();
      await page.getByRole('button', { name: /fit/i }).click(); await settle(moment); await verify();
      assert(await page.getByRole('button', { name: 'Next', exact: true }).isVisible());
      await page.mouse.move(1550, 100);
      await page.screenshot({ path: path.join(output, `${entry.id}-after-fit.png`) });
      evidence.push({ id: entry.id, before, replaySeek: true, zoom: true, fit: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const first = cases[0], moment = frames[first.key].find(frame => frame.kind === 'relation').frameIndex;
    await page.goto(new URL(`${first.replayFile}?analysis=0&frame=${moment}`, base).href);
    await settle(moment); await verify();
    await page.screenshot({ path: path.join(output, 'blocked-narrow.png') });
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, 'outcome-paint.json'), JSON.stringify({ evidence, errors, requests, closed: true }, null, 2));
  }
});
