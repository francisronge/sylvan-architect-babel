import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, realpath, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { buildQualificationReviewRuntime } from './buildContractQualificationReviewRuntime.mjs';
import { assessRendererPerformance, rendererPerformancePolicy as policy } from './rendererPerformanceBudget.mjs';

const { values } = parseArgs({ options: {
  'baseline-root': { type: 'string' }, 'self-check': { type: 'boolean' }, report: { type: 'string' }
} });
const root = path.resolve(import.meta.dirname, '..');
if (!values['baseline-root'] && !values['self-check']) throw Error('Provide --baseline-root, or --self-check for local instrumentation validation.');
const baselineRoot = await realpath(values['baseline-root'] ?? root);
if (baselineRoot === await realpath(root) && !values['self-check']) throw Error('Base and candidate must be separate checkouts.');
const fixtureBytes = await readFile(path.join(root, 'fixtures/performance/german-embedded.json'));
const fixture = JSON.parse(fixtureBytes);
const fixtureSha256 = createHash('sha256').update(fixtureBytes).digest('hex');
const reportPath = path.resolve(values.report ?? path.join(os.tmpdir(), `babel-renderer-performance-${process.pid}.json`));
const report = { schemaVersion: 1, fixtureSha256, policy, selfCheck: Boolean(values['self-check']),
  environment: { node: process.version, platform: process.platform, arch: process.arch, viewport: { width: 1600, height: 1000 } },
  samples: { base: [], candidate: [] } };

// Both revisions receive the same authored record and entry code. Preparation,
// native font measurement, worker delivery and the actual renderer remain timed.
const entrySource = `import React from 'react';
import {createRoot} from 'react-dom/client';
import TreeVisualizer from './components/AsyncTreeVisualizer';
import {buildDerivationCanvasData} from './replay/replayCompiler';
import './styles.css';
const record=${JSON.stringify(fixture)};
createRoot(document.getElementById('root')).render(<TreeVisualizer
 data={buildDerivationCanvasData(record.derivationStages.at(-1).workspaceForest)}
 sentence={record.sentence} inputTokens={record.inputTokens}
 derivationStages={record.derivationStages} animated autoPlay={false}/>);`;

// This is installed before application code, so a late automation poll cannot
// inflate the opening time. Completion is separately checked after first paint.
function observeOpening() {
  const state = window.__rendererBenchmark = { readyMs: null, settledStep: null, complete: null, workers: [] };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      const record = { terminated: false }; state.workers.push(record); this.record = record;
      this.addEventListener('message', ({ data }) => {
        const coordinates = data?.result?.coordinates;
        if (!(coordinates instanceof Map)) {
          // The pre-optimization base returns only the completed plaque schedule;
          // its coordinates were prepared on the main thread.
          if (Array.isArray(data?.result?.stages) && data.result.steps instanceof Map) {
            state.complete = { at: performance.now(), stages: data.result.stages.length, legacySchedule: true };
          }
          return;
        }
        let points = 0, invalid = 0;
        for (const canvases of coordinates.values()) for (const nodes of canvases.values()) for (const point of nodes.values()) {
          points++; if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) invalid++;
        }
        state.complete = { at: performance.now(), stages: coordinates.size, points, invalid };
      });
    }
    terminate() { this.record.terminated = true; return super.terminate(); }
  };
  let consecutive = 0, previous = null;
  const tick = () => {
    const svg = document.querySelector('svg[data-babel-tree]');
    const step = svg?.dataset.babelRenderedStep;
    const camera = svg?.querySelector(':scope > g')?.getAttribute('transform');
    const ready = document.fonts.status === 'loaded' && step !== undefined && camera
      && !/NaN|Infinity/.test(camera)
      && svg.querySelector('.node-group text')?.textContent.trim();
    const signature = ready ? `${step}:${camera}` : null;
    consecutive = signature ? signature === previous ? consecutive + 1 : 1 : 0;
    previous = signature;
    state.settledStep = consecutive >= 2 ? step : null;
    if (state.settledStep === '0' && state.readyMs === null) state.readyMs = performance.now();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

let browser, server;
try {
  const assets = new Map();
  report.builds = {};
  for (const [name, source] of [['base', baselineRoot], ['candidate', root]]) {
    const runtime = await buildQualificationReviewRuntime({ root: source, entrySource });
    report.builds[name] = { jsSha256: runtime.metadata.jsSha256, cssSha256: runtime.metadata.cssSha256 };
    assets.set(`/${name}/runtime.js`, ['text/javascript', runtime.js]);
    assets.set(`/${name}/runtime.css`, ['text/css', runtime.css]);
    assets.set(`/${name}/`, ['text/html', `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="runtime.css"><style>html,body,#root{width:100%;height:100%;margin:0}</style>
</head><body><div id="root"></div><script src="runtime.js"></script></body></html>`]);
  }
  server = createServer((req, res) => {
    const asset = assets.get(req.url);
    res.writeHead(asset ? 200 : 404, { 'Content-Type': asset?.[0] ?? 'text/plain', 'Cache-Control': 'no-store' });
    res.end(asset?.[1] ?? 'Not found');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  browser = await chromium.launch({ headless: true });
  report.environment.browser = browser.version();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const measure = async name => {
    const context = await browser.newContext({ viewport: report.environment.viewport, serviceWorkers: 'block' });
    try {
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      await page.route('**/*', route => {
        const url = route.request().url();
        if (!url.startsWith(origin + '/')) { errors.push(`Unexpected external request: ${url}`); return route.abort(); }
        return route.continue();
      });
      await page.addInitScript(observeOpening);
      await page.goto(`${origin}/${name}/`);
      await page.waitForFunction(() => window.__rendererBenchmark.readyMs !== null
        && window.__rendererBenchmark.complete && window.__rendererBenchmark.workers.every(w => w.terminated), null, { timeout: 20000 });
      const sample = await page.evaluate(() => window.__rendererBenchmark);
      assert.equal(sample.complete.stages, 6, 'all six stages must finish');
      if (name === 'candidate' || !sample.complete.legacySchedule) {
        assert(sample.complete.points > 0, 'a complete layout must contain coordinates');
        assert.equal(sample.complete.invalid, 0, 'layout coordinates must be finite');
      }
      const slider = page.getByRole('slider', { name: 'Replay frame', exact: true });
      assert.equal(await slider.getAttribute('max'), '73', 'the full 74-frame Replay remains available');
      await slider.press('End');
      await page.waitForFunction(() => window.__rendererBenchmark.settledStep === '73', null, { timeout: 10000 });
      const text = await page.locator('svg[data-babel-tree]').textContent();
      for (const word of ['Mara', 'glaubt', 'Lehrer', 'Bericht', 'lesen', 'wird']) assert(text.includes(word), `missing final word: ${word}`);
      assert.deepEqual(errors, [], 'no browser or external-resource errors');
      return { readyMs: sample.readyMs, completeMs: sample.complete.at, points: sample.complete.points ?? null,
        legacySchedule: sample.complete.legacySchedule ?? false };
    } finally { await context.close(); }
  };
  // Warm the browser process once per revision, but never reuse a document or
  // in-memory layout cache. Alternate order to reduce systematic thermal drift.
  await measure('base'); await measure('candidate');
  for (let round = 0; round < policy.samples; round++) {
    for (const name of round % 2 ? ['candidate', 'base'] : ['base', 'candidate']) {
      const sample = await measure(name); report.samples[name].push(sample);
      console.log(`${name} ${round + 1}/${policy.samples}: ${Math.round(sample.readyMs)} ms`);
    }
  }
  report.assessment = assessRendererPerformance(report.samples.base.map(s => s.readyMs), report.samples.candidate.map(s => s.readyMs));
  if (report.assessment.status !== 'passed') process.exitCode = 1;
} catch (error) {
  report.error = String(error?.stack ?? error); process.exitCode = 1;
} finally {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
}
const result = report.assessment;
const summary = result ? `Renderer performance: ${result.status}. Base median ${Math.round(result.base.medianMs)} ms; candidate ${Math.round(result.candidate.medianMs)} ms; allowed increase ${Math.round(result.allowedIncreaseMs)} ms.` : `Renderer performance: failed to measure. ${report.error}`;
console.log(summary + `\nReport: ${reportPath}`);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
  `### Renderer performance\n\n${summary}\n\nFixed German analysis, Chromium, 1600 × 1000. Five alternating fresh-context samples per revision; no retries. The local reference-device target is 2,000 ms. CI enforces the same-runner regression budget.\n`);
if (result?.status === 'regression') console.error('Reassess the PR and remove the slowdown. Do not relax the budget or replace the fixture to make it pass.');
if (result?.status === 'unstable') console.error('Runner timing was unstable. No performance pass was established; inspect the samples before rerunning CI.');
