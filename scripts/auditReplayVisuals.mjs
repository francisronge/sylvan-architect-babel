// Audit the static geometry of every Replay frame and the Canopy of committed
// fixtures and saved qualification runs with the visual invariants
// (tests/helpers/visualInvariants.mjs). Writes a JSON report and prints counts
// per rule with the records and frames that carry them. Provider-free and
// browser-free: text uses the bundled fonts, so a flag is a lead for a native
// capture, not proof of a pixel. Usage:
//   node scripts/auditReplayVisuals.mjs --fixtures \
//     --batches "$HOME/Library/Application Support/Babel/codex-qualification" --out /tmp/visual-audit.json
import { mkdtempSync, readdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { RULES, THRESHOLDS } from '../tests/helpers/visualInvariants.mjs';

async function main() {
  const { values } = parseArgs({ allowNegative: true, options: {
    fixtures: { type: 'boolean', default: false }, runs: { type: 'string', multiple: true, default: [] },
    batches: { type: 'string', multiple: true, default: [] }, 'archive-manifest': { type: 'string', multiple: true, default: [] },
    only: { type: 'string' }, every: { type: 'string', default: '1' }, viewports: { type: 'string', default: 'desktop,desktop-large,mobile' },
    canopy: { type: 'boolean', default: true }, jobs: { type: 'string', default: '2' }, out: { type: 'string' }
  } });
  if (!values.out || !(values.fixtures || values.runs.length || values.batches.length || values['archive-manifest'].length))
    throw Error('Usage: node scripts/auditReplayVisuals.mjs --out report.json [--fixtures] [--runs DIR/runs ...] '
      + '[--batches CODEX_QUALIFICATION_ROOT ...] [--archive-manifest FILE ...] [--only TEXT] [--every N] [--jobs N] [--viewports a,b] [--no-canopy]');
  const records = await loadRecords(values);
  const every = Math.max(1, Number(values.every));
  const selected = records.filter((record, index) => index % every === 0 && (!values.only || record.id.includes(values.only)));
  const viewports = values.viewports.split(',').map(name => name.trim()).filter(Boolean);
  const canopy = values.canopy, jobs = Math.max(1, Math.min(Number(values.jobs) || 1, availableParallelism()));
  const started = performance.now();
  const results = await runWorkers(selected, jobs, { viewports, canopy });
  const durationMs = Math.round(performance.now() - started);
  const report = summarize(results, { durationMs, viewports, canopy, thresholds: THRESHOLDS, jobs });
  writeFileSync(path.resolve(values.out), `${JSON.stringify(report, null, 1)}\n`);
  printSummary(report, path.resolve(values.out));
}

async function loadRecords(values) {
  const records = [];
  if (values.fixtures) {
    const { loadFixtureAnalyses } = await import('../tests/helpers/replayInvariantCorpus.mjs');
    for (const { id, record } of loadFixtureAnalyses().records) records.push({ id: `fixture:${id}`, input: record });
  }
  const { runRecords } = await import('./buildCorpusArchiveManifest.mjs');
  const { loadCorpusManifest } = await import('./replayCorpusInputs.mjs');
  const runDirectories = [...values.runs, ...values.batches.flatMap(root => readdirSync(root).sort()
    .map(batch => path.join(root, batch, 'runs')).filter(existsSync))];
  const manifests = [...values['archive-manifest']];
  const scratch = runDirectories.length ? mkdtempSync(path.join(tmpdir(), 'babel-visual-audit-')) : null;
  try {
    for (const [index, directory] of runDirectories.entries()) {
      const runs = runRecords(path.resolve(directory));
      if (!runs.length) continue;
      const file = path.join(scratch, `runs-${index}.json`);
      writeFileSync(file, JSON.stringify({ schemaVersion: 1, records: runs }));
      manifests.push(file);
    }
    for (const file of manifests) for (const record of (await loadCorpusManifest(file)).records)
      records.push({ id: record.id, input: { sentence: record.input.sentence, inputTokens: record.input.inputTokens,
        derivationStages: record.input.derivationStages } });
  } finally { if (scratch) rmSync(scratch, { recursive: true, force: true }); }
  const seen = new Set();
  return records.filter(record => !seen.has(record.id) && seen.add(record.id));
}

function runWorkers(records, jobs, data) {
  return new Promise((resolve, reject) => {
    const results = new Array(records.length);
    let next = 0, done = 0;
    if (!records.length) { resolve([]); return; }
    const workers = Array.from({ length: Math.min(jobs, records.length) }, () =>
      new Worker(fileURLToPath(import.meta.url), { workerData: data }));
    const feed = worker => {
      if (next >= records.length) { worker.terminate(); return; }
      const index = next++;
      worker.postMessage({ index, id: records[index].id, input: records[index].input });
    };
    for (const worker of workers) {
      worker.on('message', result => {
        results[result.index] = result;
        if (++done % 25 === 0) process.stderr.write(`audited ${done}/${records.length}\n`);
        if (done === records.length) { workers.forEach(other => other.terminate()); resolve(results); }
        else feed(worker);
      });
      worker.on('error', reject);
      feed(worker);
    }
  });
}

function summarize(results, meta) {
  const counts = Object.fromEntries(RULES.map(rule => [rule, { violations: 0, frames: 0, records: 0 }]));
  for (const result of results) for (const rule of RULES) {
    const own = result.violations.filter(violation => violation.rule === rule);
    if (!own.length) continue;
    counts[rule].violations += own.length;
    counts[rule].frames += new Set(own.map(violation => violation.frame)).size;
    counts[rule].records += 1;
  }
  return { schemaVersion: 1, ...meta, records: results.length, frames: results.reduce((sum, result) => sum + (result.frames ?? 0), 0),
    errors: results.filter(result => result.error).map(result => ({ id: result.id, error: result.error })),
    counts, results: results.map(({ index: _index, ...result }) => result) };
}

const frameRange = frames => {
  const numbers = frames.filter(frame => typeof frame === 'number').sort((a, b) => a - b);
  const spans = [];
  for (const frame of numbers) {
    const last = spans.at(-1);
    if (last && frame === last[1] + 1) last[1] = frame; else spans.push([frame, frame]);
  }
  return [...spans.map(([a, b]) => a === b ? `${a}` : `${a}-${b}`), ...(frames.includes('canopy') ? ['canopy'] : [])].join(',');
};

function printSummary(report, out) {
  console.log(`Visual audit: ${report.records} analyses, ${report.frames} laid-out frames (${report.viewports.join(', ')}`
    + `${report.canopy ? ' + Canopy' : ''}) in ${(report.durationMs / 1000).toFixed(1)}s with ${report.jobs} jobs; ${report.errors.length} errors.`);
  for (const rule of RULES) {
    const count = report.counts[rule];
    console.log(`\n${rule}: ${count.violations} violations, ${count.frames} frames, ${count.records} analyses`);
    const lines = report.results.flatMap(result => {
      const groups = new Map();
      for (const violation of result.violations.filter(item => item.rule === rule)) {
        const group = groups.get(violation.subject) ?? { violation, frames: [] };
        group.frames.push(violation.frame);
        groups.set(violation.subject, group);
      }
      return [...groups.values()].map(group => `  ${result.id} frames ${frameRange(group.frames)}: ${group.violation.detail}`);
    });
    lines.slice(0, 12).forEach(line => console.log(line));
    if (lines.length > 12) console.log(`  … ${lines.length - 12} more in ${out}`);
  }
  if (report.errors.length) console.log(`\nErrors:\n${report.errors.slice(0, 10).map(error => `  ${error.id}: ${error.error}`).join('\n')}`);
}

if (!isMainThread) {
  const { auditVisualRecord } = await import('../tests/helpers/visualAudit.mjs');
  const { VIEWPORTS } = await import('../tests/helpers/visualFrames.mjs');
  const viewports = VIEWPORTS.filter(viewport => workerData.viewports.includes(viewport.name));
  parentPort.on('message', ({ index, id, input }) => {
    const started = performance.now();
    try {
      const result = auditVisualRecord(input, { viewports, canopy: workerData.canopy });
      parentPort.postMessage({ index, id, ...result, ms: Math.round(performance.now() - started) });
    } catch (error) {
      parentPort.postMessage({ index, id, error: String(error?.stack ?? error).split('\n').slice(0, 3).join(' | '), violations: [],
        ms: Math.round(performance.now() - started) });
    }
  });
} else await main();
