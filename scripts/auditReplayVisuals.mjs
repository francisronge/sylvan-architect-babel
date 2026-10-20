// Audit the static geometry of every Replay frame and the Canopy with the rules
// in tests/helpers/visualRules.mjs, laid out offline by tests/helpers/visualFrames.mjs.
// Text uses the bundled fonts, so a finding is a lead for a native capture, not
// proof of a pixel. Discovery over saved runs:
//   node scripts/auditReplayVisuals.mjs --fixtures \
//     --batches "$HOME/Library/Application Support/Babel/codex-qualification" --out /tmp/visual-audit.json
// `npm run verify:visual-offline` audits the committed fixtures with
// `--exceptions tests/helpers/visualExceptions.mjs` and fails on any finding the
// exceptions do not cover, on one beyond its bound, and on a stale exception.
// `--audit camera` instead checks the camera across steps with
// tests/helpers/cameraInvariants.mjs, traced by tests/helpers/cameraTrace.mjs;
// `npm run verify:camera-offline` matches the fixtures to tests/helpers/cameraExceptions.mjs.
import { mkdtempSync, readdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { matchFindings, proposeExceptions } from '../tests/helpers/findings.mjs';
import { RULES, THRESHOLDS } from '../tests/helpers/visualRules.mjs';
import { CAMERA_RULES, CAMERA_THRESHOLDS } from '../tests/helpers/cameraInvariants.mjs';

async function main() {
  const { values } = parseArgs({ allowNegative: true, options: {
    fixtures: { type: 'boolean', default: false }, runs: { type: 'string', multiple: true, default: [] },
    batches: { type: 'string', multiple: true, default: [] }, 'archive-manifest': { type: 'string', multiple: true, default: [] },
    only: { type: 'string' }, every: { type: 'string', default: '1' }, viewports: { type: 'string', default: 'desktop,desktop-large,mobile' },
    canopy: { type: 'boolean', default: true }, jobs: { type: 'string', default: '2' }, out: { type: 'string' }, exceptions: { type: 'string' },
    audit: { type: 'string', default: 'visual' }
  } });
  if (!['visual', 'camera'].includes(values.audit)) throw Error('--audit is visual or camera');
  const camera = values.audit === 'camera';
  if (camera) values.canopy = false;
  if (!(values.out || values.exceptions) || !(values.fixtures || values.runs.length || values.batches.length || values['archive-manifest'].length))
    throw Error('Usage: node scripts/auditReplayVisuals.mjs (--out report.json | --exceptions module.mjs) [--fixtures] [--runs DIR/runs ...] '
      + '[--batches CODEX_QUALIFICATION_ROOT ...] [--archive-manifest FILE ...] [--only TEXT] [--every N] [--jobs N] [--viewports a,b] [--no-canopy] [--audit visual|camera]');
  const every = Math.max(1, Number(values.every));
  const records = (await loadRecords(values)).filter((record, index) => index % every === 0 && (!values.only || record.id.includes(values.only)));
  const viewports = values.viewports.split(',').map(name => name.trim()).filter(Boolean);
  const jobs = Math.max(1, Math.min(Number(values.jobs) || 1, availableParallelism()));
  const started = performance.now();
  const results = await runWorkers(records, jobs, { viewports, canopy: values.canopy, audit: values.audit });
  const report = { schemaVersion: 2, audit: values.audit, durationMs: Math.round(performance.now() - started), viewports, canopy: values.canopy, jobs,
    thresholds: camera ? CAMERA_THRESHOLDS : THRESHOLDS, records: results.length, frames: results.reduce((sum, result) => sum + (result.frames ?? 0), 0),
    errors: results.filter(result => result.error).map(({ id, error }) => ({ id, error })),
    findings: results.flatMap(result => result.findings ?? []) };
  if (values.out) writeFileSync(path.resolve(values.out), `${JSON.stringify(report)}\n`);
  console.log(`${camera ? 'Camera' : 'Visual'} audit: ${report.records} analyses, ${report.frames} laid-out frames (${viewports.join(', ')}`
    + `${values.canopy ? ' + Canopy' : ''}) in ${(report.durationMs / 1000).toFixed(1)}s with ${jobs} jobs; ${report.errors.length} errors.`);
  report.errors.slice(0, 10).forEach(({ id, error }) => console.log(`  error ${id}: ${error}`));
  if (!values.exceptions) return summarize(report.findings, camera ? CAMERA_RULES : RULES);
  const { EXCEPTIONS } = await import(pathToFileURL(path.resolve(values.exceptions)).href);
  const { unexpected, exceeded, stale } = matchFindings(report.findings, EXCEPTIONS);
  const show = (title, lines) => { if (lines.length) console.log(`\n${title} (${lines.length}):\n${lines.slice(0, 40).join('\n')}`); };
  show('New findings; fix them (listing one needs the owner\'s approval: scripts/checkExceptionGrowth.mjs)',
    proposeExceptions(unexpected).map(entry => `  ${JSON.stringify(entry)}`));
  show('Findings beyond their bound; fix them (raising a bound needs the owner\'s approval)', exceeded.map(({ finding, bound }) =>
    `  ${finding.record} ${finding.rule} ${finding.subject} frame ${finding.frame} ${finding.viewport}: ${finding.measure} > ${bound}`));
  show('Stale exceptions; narrow or remove them', stale.map(({ exception, viewport, frame }) =>
    `  ${exception.record} ${exception.rule} ${exception.subject} frame ${frame} ${viewport}`));
  if (report.errors.length || unexpected.length || exceeded.length || stale.length) process.exitCode = 1;
  else console.log(`All ${report.findings.length} findings are listed exceptions within their bounds.`);
}

function summarize(findings, rules) {
  for (const rule of rules) {
    const own = findings.filter(finding => finding.rule === rule), subjects = proposeExceptions(own);
    console.log(`\n${rule}: ${own.length} findings, ${subjects.length} subjects, ${new Set(own.map(finding => finding.record)).size} analyses`);
    subjects.slice(0, 12).forEach(entry => console.log(`  ${entry.record} [${entry.subtype}] ${entry.subject} at ${JSON.stringify(entry.at)}`));
  }
}

async function loadRecords(values) {
  const records = [];
  if (values.fixtures) {
    const { loadFixtureAnalyses } = await import('../tests/helpers/replayInvariantCorpus.mjs');
    for (const { id, record } of loadFixtureAnalyses().records) records.push({ id, input: record });
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
    const workers = Array.from({ length: Math.min(jobs, records.length) }, () => new Worker(fileURLToPath(import.meta.url), { workerData: data }));
    const feed = worker => {
      if (next >= records.length) return;
      const index = next++;
      worker.postMessage({ index, id: records[index].id, input: records[index].input });
    };
    for (const worker of workers) {
      worker.on('message', result => {
        results[result.index] = result;
        if (++done % 50 === 0) process.stderr.write(`audited ${done}/${records.length}\n`);
        if (done === records.length) { workers.forEach(other => other.terminate()); resolve(results); } else feed(worker);
      });
      worker.on('error', reject);
      feed(worker);
    }
  });
}

if (!isMainThread) {
  const { auditVisualRecord, VIEWPORTS } = await import('../tests/helpers/visualFrames.mjs');
  const { auditCameraRecord, CAMERA_VIEWPORTS } = await import('../tests/helpers/cameraTrace.mjs');
  const camera = workerData.audit === 'camera';
  const viewports = (camera ? CAMERA_VIEWPORTS : VIEWPORTS).filter(viewport => workerData.viewports.includes(viewport.name));
  if (viewports.length !== workerData.viewports.length) throw Error(`Unknown viewport in ${workerData.viewports.join(', ')}`);
  parentPort.on('message', ({ index, id, input }) => {
    try {
      parentPort.postMessage({ index, id, ...(camera ? auditCameraRecord(id, input, { viewports })
        : auditVisualRecord(id, input, { viewports, canopy: workerData.canopy })) });
    } catch (error) {
      parentPort.postMessage({ index, id, error: String(error?.stack ?? error).split('\n').slice(0, 3).join(' | ') });
    }
  });
} else await main();
