import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, realpath, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';
import { chromium } from 'playwright';
import { buildQualificationReviewRuntime } from './buildContractQualificationReviewRuntime.mjs';
import { assessRendererPerformance, describeRendererPreparation, rendererPerformancePolicy as policy } from './rendererPerformanceBudget.mjs';
import { observeRendererOpening } from './rendererPerformanceObservation.mjs';
import { verifyRuntimeFreshness } from './reviewRuntimeProvenance.mjs';

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
const report = { schemaVersion: 2, fixtureSha256, policy, selfCheck: Boolean(values['self-check']),
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpus: os.availableParallelism(),
    loadAverageBefore: os.loadavg(), viewport: { width: 1600, height: 1000 } },
  samples: { base: [], candidate: [] } };

// Both revisions receive the same authored record and entry behavior. The canvas
// owner may have moved between revisions; preparation, fonts, workers, and the
// actual renderer remain inside the same timing boundary.
const entrySource = (canvasModule) => `import React from 'react';
import {createRoot} from 'react-dom/client';
import TreeVisualizer from './components/AsyncTreeVisualizer';
import { buildDerivationCanvasData } from '${canvasModule}';
import './styles.css';
const record=${JSON.stringify(fixture)};
createRoot(document.getElementById('root')).render(<TreeVisualizer
 data={buildDerivationCanvasData(record.derivationStages.at(-1).workspaceForest)}
 sentence={record.sentence} inputTokens={record.inputTokens}
 derivationStages={record.derivationStages} animated autoPlay={false}/>);`;

let browser, server;
try {
  const assets = new Map();
  const builds = new Map();
  report.builds = {};
  for (const [name, source] of [['base', baselineRoot], ['candidate', root]]) {
    const canvasModule = existsSync(path.join(source, 'replay/replayCanvas.ts'))
      ? './replay/replayCanvas.ts' : './replay/replayCompiler.ts';
    const entry = entrySource(canvasModule);
    const runtime = await buildQualificationReviewRuntime({ root: source, entrySource: entry });
    const revision = await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: source }).then(result => result.stdout.trim()).catch(() => null);
    report.builds[name] = { ...runtime.metadata, revision };
    builds.set(name, { source, entry, metadata: runtime.metadata });
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
      await page.addInitScript(observeRendererOpening);
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
  // Warm the browser process per revision and discard those rounds, but never
  // reuse a document or in-memory layout cache. Alternate order to reduce
  // systematic thermal drift.
  for (let round = 0; round < policy.warmupRounds; round++) {
    for (const name of round % 2 ? ['candidate', 'base'] : ['base', 'candidate']) await measure(name);
  }
  for (let round = 0; round < policy.samples; round++) {
    for (const name of round % 2 ? ['candidate', 'base'] : ['base', 'candidate']) {
      const sample = await measure(name); report.samples[name].push(sample);
      console.log(`${name} ${round + 1}/${policy.samples}: first paint ${Math.round(sample.readyMs)} ms; preparation ${Math.round(sample.completeMs)} ms`);
    }
  }
  report.assessment = assessRendererPerformance(report.samples.base.map(s => s.readyMs), report.samples.candidate.map(s => s.readyMs));
  report.preparation = describeRendererPreparation(report.samples.base, report.samples.candidate);
  report.inputFreshness = {};
  for (const [name, built] of builds) {
    const freshness = await verifyRuntimeFreshness(built.metadata, { root: built.source, entrySource: built.entry });
    report.inputFreshness[name] = freshness;
    assert(freshness.fresh, `${name} build inputs changed during measurement: ${freshness.mismatches.join(', ')}`);
  }
  if (report.assessment.status !== 'passed') process.exitCode = 1;
} catch (error) {
  report.error = String(error?.stack ?? error); process.exitCode = 1;
} finally {
  report.environment.loadAverageAfter = os.loadavg();
  for (const close of [() => browser?.close(), () => server?.listening
    ? new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) : undefined]) {
    try { await close(); }
    catch (error) {
      (report.cleanupErrors ??= []).push(String(error));
      report.error ??= `Owned benchmark resources did not close: ${error}`;
      process.exitCode = 1;
    }
  }
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
}
const result = report.assessment;
const summary = report.error ? `Renderer performance: failed to verify. ${report.error}` : result ? `Renderer performance: ${result.status}. Base median ${Math.round(result.base.medianMs)} ms; candidate ${Math.round(result.candidate.medianMs)} ms; allowed increase ${Math.round(result.allowedIncreaseMs)} ms.` : 'Renderer performance: no complete measurement.';
const preparation = report.preparation;
const preparationSummary = preparation ? `Full preparation (reporting only): base median ${Math.round(preparation.complete.base.medianMs)} ms, range ${Math.round(preparation.complete.base.minMs)}–${Math.round(preparation.complete.base.maxMs)} ms; candidate median ${Math.round(preparation.complete.candidate.medianMs)} ms, range ${Math.round(preparation.complete.candidate.minMs)}–${Math.round(preparation.complete.candidate.maxMs)} ms. Remaining after first paint: base ${Math.round(preparation.remainingAfterFirstPaint.base.medianMs)} ms; candidate ${Math.round(preparation.remainingAfterFirstPaint.candidate.medianMs)} ms. Completion samples ${preparation.complete.stable ? 'stable' : 'unstable'}; no completion budget has been calibrated.` : '';
console.log(summary + `\n${preparationSummary}\nReport: ${reportPath}`);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
  `### Renderer performance\n\n${summary}\n\n${preparationSummary}\n\nFixed German analysis, Chromium, 1600 × 1000. Five alternating fresh-context samples per revision; no retries. The local reference-device target is 2,000 ms. CI enforces the same-runner first-paint regression budget.\n`);
if (result?.status === 'regression') console.error('Reassess the PR and remove the slowdown. Do not relax the budget or replace the fixture to make it pass.');
if (result?.status === 'unstable') console.error('Runner timing was unstable. No performance pass was established; inspect the samples before rerunning CI.');
