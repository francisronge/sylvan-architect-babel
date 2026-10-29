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
// `npm run verify:replay-offline` runs both of those audits in one pass, which
// prepares each record once and lays out the viewport they share once.
// `--snapshot FILE` also compares each analysis's desktop frames, Canopy, Replay
// panel text and relation tiers with the committed fingerprints
// (tests/helpers/layoutSnapshot.mjs) and fails on any difference;
// `--update-snapshot` rewrites the file from this run instead.
// verify:visual-offline and verify:replay-offline check fixtures/replay-snapshots/fixture-layout.json.
// `--shard I/N --results-out FILE` audits every Nth record and writes its raw
// results without judging them; `--merge FILE` (once per shard), given the same
// record and audit options, reads the N shards in place of auditing and judges
// the merged results exactly as one run does. CI splits verify:replay-offline so.
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { matchFindings, proposeExceptions } from '../tests/helpers/findings.mjs';
import { RULES, THRESHOLDS } from '../tests/helpers/visualRules.mjs';
import { CAMERA_RULES, CAMERA_THRESHOLDS } from '../tests/helpers/cameraInvariants.mjs';
import { compareSnapshots, describeComparison, readSnapshot, writeSnapshot } from '../tests/helpers/layoutSnapshot.mjs';

async function main() {
  const { values } = parseArgs({ allowNegative: true, options: {
    fixtures: { type: 'boolean', default: false }, runs: { type: 'string', multiple: true, default: [] },
    batches: { type: 'string', multiple: true, default: [] }, 'archive-manifest': { type: 'string', multiple: true, default: [] },
    only: { type: 'string' }, every: { type: 'string', default: '1' }, viewports: { type: 'string', multiple: true, default: [] },
    canopy: { type: 'boolean', default: true }, jobs: { type: 'string', default: '2' }, out: { type: 'string', multiple: true, default: [] },
    exceptions: { type: 'string', multiple: true, default: [] }, audit: { type: 'string', multiple: true, default: [] },
    snapshot: { type: 'string' }, 'update-snapshot': { type: 'boolean', default: false },
    shard: { type: 'string' }, 'results-out': { type: 'string' }, merge: { type: 'string', multiple: true, default: [] }
  } });
  const audits = auditsOf(values);
  if (!(values.fixtures || values.runs.length || values.batches.length || values['archive-manifest'].length))
    throw Error(USAGE);
  const every = Math.max(1, Number(values.every));
  const records = (await loadRecords(values)).filter((record, index) => index % every === 0 && (!values.only || record.id.includes(values.only)));
  const jobs = Math.max(1, Math.min(Number(values.jobs) || 1, availableParallelism()));
  const started = performance.now();
  const snapshotAudit = snapshotAuditOf(values, audits);
  const plan = { audits: audits.map(({ audit, viewports, canopy }, index) =>
    ({ audit, viewports, canopy, snapshot: index === snapshotAudit })) };
  const shard = shardOf(values);
  if (shard) {
    const own = shardRecords(records, shard);
    const results = await runWorkers(own.map(({ record }) => record), jobs, plan);
    writeFileSync(path.resolve(values['results-out']), `${JSON.stringify({ schemaVersion: 1, shard: values.shard, plan, jobs,
      ids: records.map(record => record.id), durationMs: Math.round(performance.now() - started),
      results: results.map((result, position) => ({ ...result, index: own[position].index })) })}\n`);
    console.log(`Audited shard ${values.shard}: ${own.length} of ${records.length} analyses; results in ${values['results-out']}.`);
    return;
  }
  const merged = values.merge.length ? mergeShards(values.merge, records, plan) : null;
  const results = merged ? merged.results : await runWorkers(records, jobs, plan);
  const durationMs = merged ? merged.durationMs : Math.round(performance.now() - started);
  const ran = merged ? `in ${merged.shards} shards, the slowest taking` : 'in', shownJobs = merged?.jobs ?? jobs;
  for (const [index, { audit, viewports, canopy, out, exceptions }] of audits.entries()) {
    const camera = audit === 'camera', own = results.map(({ id, error, audits: each }) => error ? { id, error } : { id, ...each[index] });
    const report = { schemaVersion: 2, audit, durationMs, viewports, canopy, jobs: shownJobs,
      ...(audits.length > 1 ? { sharedWith: audits.filter((_, other) => other !== index).map(other => other.audit) } : {}),
      thresholds: camera ? CAMERA_THRESHOLDS : THRESHOLDS, records: own.length, frames: own.reduce((sum, result) => sum + (result.frames ?? 0), 0),
      errors: own.filter(result => result.error).map(({ id, error }) => ({ id, error })),
      findings: own.flatMap(result => result.findings ?? []) };
    if (out) writeFileSync(path.resolve(out), `${JSON.stringify(report)}\n`);
    if (index) console.log('');
    console.log(`${camera ? 'Camera' : 'Visual'} audit: ${report.records} analyses, ${report.frames} laid-out frames (${viewports.join(', ')}`
      + `${canopy ? ' + Canopy' : ''}) ${ran} ${(durationMs / 1000).toFixed(1)}s with ${shownJobs} jobs${audits.length > 1 ? `, in one pass with the ${
        report.sharedWith.join(' and ')} audit` : ''}; ${report.errors.length} errors.`);
    report.errors.slice(0, 10).forEach(({ id, error }) => console.log(`  error ${id}: ${error}`));
    if (!exceptions) { summarize(report.findings, camera ? CAMERA_RULES : RULES); continue; }
    const { EXCEPTIONS } = await import(pathToFileURL(path.resolve(exceptions)).href);
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
  if (snapshotAudit >= 0) {
    console.log('');
    checkSnapshot(values, results.map(({ id, error, audits: each }) => error ? { id, error } : { id, ...each[snapshotAudit] }),
      every === 1 && !values.only);
  }
}

/** An analysis's audit cost estimate: its syntax nodes over every stage, which
 * tracks its laid-out frames. It orders and balances work, never what is audited. */
function auditCost(record) {
  let nodes = 0;
  const visit = node => { nodes++; (node.children ?? []).forEach(visit); };
  for (const stage of record.input.derivationStages ?? []) (stage.workspaceForest ?? []).forEach(visit);
  return nodes;
}

/** Shard `index` of `total`: each analysis, heaviest first, goes to the shard
 * with the least estimated cost so far (ties to the lower shard), so the shards
 * partition the analyses deterministically. */
function shardRecords(records, { index, total }) {
  const costs = records.map(auditCost), load = new Array(total).fill(0), own = [];
  const order = records.map((_, position) => position).sort((a, b) => costs[b] - costs[a] || a - b);
  for (const position of order) {
    const lightest = load.indexOf(Math.min(...load));
    load[lightest] += costs[position];
    if (lightest === index - 1) own.push({ record: records[position], index: position });
  }
  return own.sort((a, b) => a.index - b.index);
}

/** `--shard I/N`, which needs `--results-out` and excludes --merge and --update-snapshot, or null. */
function shardOf(values) {
  if (values.shard === undefined) {
    if (values['results-out']) throw Error('--results-out needs --shard I/N');
    return null;
  }
  const match = /^(\d+)\/(\d+)$/.exec(values.shard), index = Number(match?.[1]), total = Number(match?.[2]);
  if (!match || index < 1 || index > total) throw Error(`Invalid --shard ${values.shard}; expected I/N`);
  if (!values['results-out'] || values.merge.length || values['update-snapshot'])
    throw Error('--shard needs --results-out and cannot be combined with --merge or --update-snapshot');
  return { index, total };
}

/** The results of one run over `records`, from shard files. Each shard must
 * have audited the same records with the same audits, the shards must be 1..N
 * of one N, and together they must hold every record exactly once. */
function mergeShards(files, records, plan) {
  const shards = files.map(file => JSON.parse(readFileSync(path.resolve(file), 'utf8')));
  const ids = JSON.stringify(records.map(record => record.id)), names = shards.map(shard => shard.shard);
  const total = Number(/^\d+\/(\d+)$/.exec(names[0] ?? '')?.[1]);
  const expected = Array.from({ length: total }, (_, index) => `${index + 1}/${total}`);
  if (!total || JSON.stringify([...names].sort()) !== JSON.stringify(expected.sort()))
    throw Error(`--merge needs shards 1/N to N/N of one N, each once; got ${names.join(', ')}`);
  for (const shard of shards) {
    if (shard.schemaVersion !== 1 || JSON.stringify(shard.ids) !== ids)
      throw Error(`Shard ${shard.shard} audited other analyses than this run selects`);
    if (JSON.stringify(shard.plan) !== JSON.stringify(plan)) throw Error(`Shard ${shard.shard} ran other audits than this run names`);
  }
  const results = new Array(records.length);
  for (const { index, ...result } of shards.flatMap(shard => shard.results)) {
    if (results[index] || records[index]?.id !== result.id) throw Error(`Shard results repeat or misplace ${result.id}`);
    results[index] = result;
  }
  const missing = records.filter((_, index) => !results[index]);
  if (missing.length) throw Error(`Shards lack ${missing.length} analyses, such as ${missing[0].id}`);
  return { results, shards: shards.length, jobs: Math.max(...shards.map(shard => shard.jobs)),
    durationMs: Math.max(...shards.map(shard => shard.durationMs)) };
}

const USAGE = 'Usage: node scripts/auditReplayVisuals.mjs (--out report.json | --exceptions module.mjs) [--fixtures] [--runs DIR/runs ...] '
  + '[--batches CODEX_QUALIFICATION_ROOT ...] [--archive-manifest FILE ...] [--only TEXT] [--every N] [--jobs N] [--viewports a,b] [--no-canopy] '
  + '[--audit visual|camera] [--snapshot FILE [--update-snapshot]]; repeat --audit, each with its own --viewports and --exceptions or --out '
  + 'in the same order, to run several audits in one pass; [--shard I/N --results-out FILE] audits one shard, '
  + '[--merge FILE ...] judges the shards\' results';

/** The index of the visual audit that fingerprints frames, or -1. It needs the
 * desktop viewport and the Canopy. */
function snapshotAuditOf(values, audits) {
  if (!values.snapshot) { if (values['update-snapshot']) throw Error('--update-snapshot needs --snapshot FILE'); return -1; }
  const index = audits.findIndex(({ audit }) => audit === 'visual');
  if (index < 0 || !audits[index].viewports.includes('desktop') || !audits[index].canopy)
    throw Error('--snapshot needs the visual audit with the desktop viewport and the Canopy');
  return index;
}

/** Compares this run's fingerprints with the committed ones, or rewrites them.
 * A partial run (--only, --every) leaves analyses it did not audit untouched. */
function checkSnapshot(values, results, complete) {
  const file = path.resolve(values.snapshot);
  const actual = Object.fromEntries(results.filter(result => result.snapshot).map(({ id, snapshot }) => [id, snapshot]));
  const expected = existsSync(file) ? readSnapshot(file) : {};
  if (values['update-snapshot']) {
    const kept = complete ? {} : expected;
    for (const { id } of results.filter(result => result.error)) if (expected[id]) kept[id] = expected[id];
    writeSnapshot(file, { ...kept, ...actual });
    console.log(`Wrote fingerprints of ${Object.keys(actual).length} analyses to ${values.snapshot}; review its diff.`);
    return;
  }
  const comparison = compareSnapshots(expected, actual, { complete });
  const count = comparison.changed.length + comparison.added.length + comparison.removed.length;
  if (!count) { console.log(`Snapshot: ${Object.keys(actual).length} analyses unchanged (frames, Canopy, panel text, tiers).`); return; }
  console.log(`\nSnapshot: ${count} analyses differ from ${values.snapshot}. A difference is a behavior change: `
    + 'see what moved with scripts/explainLayoutChange.mjs --baseline-root BASE, then review and rerun with --update-snapshot.');
  console.log(describeComparison(comparison).join('\n'));
  process.exitCode = 1;
}
const DEFAULT_VIEWPORTS = 'desktop,desktop-large,mobile';

/** The audits to run. One `--audit` (default visual) takes at most one each of
 * --viewports, --exceptions and --out. Several share each record's preparation
 * and its measured layout at a viewport they have in common; each option given
 * then appears once per audit, paired by order. */
function auditsOf(values) {
  const names = values.audit.length ? values.audit : ['visual'];
  for (const name of names) if (!['visual', 'camera'].includes(name)) throw Error('--audit is visual or camera');
  if (new Set(names).size !== names.length) throw Error(`--audit names each audit once: ${names.join(', ')}`);
  const several = names.length > 1;
  const pair = (option, list) => {
    if (several ? list.length && list.length !== names.length : list.length > 1)
      throw Error(`Give --${option} ${several ? `once for each of the ${names.length} audits, in --audit order` : 'once'}. ${USAGE}`);
    return names.map((_, index) => list[index]);
  };
  const viewports = pair('viewports', values.viewports), outs = pair('out', values.out), exceptions = pair('exceptions', values.exceptions);
  return names.map((audit, index) => {
    if (!(outs[index] || exceptions[index])) throw Error(USAGE);
    return { audit, viewports: (viewports[index] ?? DEFAULT_VIEWPORTS).split(',').map(name => name.trim()).filter(Boolean),
      canopy: audit === 'camera' ? false : values.canopy, out: outs[index], exceptions: exceptions[index] };
  });
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
    // The heaviest analyses start first, so none is left running alone at the end.
    const costs = records.map(auditCost), order = records.map((_, index) => index).sort((a, b) => costs[b] - costs[a] || a - b);
    let next = 0, done = 0;
    if (!records.length) { resolve([]); return; }
    const workers = Array.from({ length: Math.min(jobs, records.length) }, () => new Worker(fileURLToPath(import.meta.url), { workerData: data }));
    const feed = worker => {
      if (next >= records.length) return;
      const index = order[next++];
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
  const { auditVisualRecord, prepareVisualRecord, VIEWPORTS } = await import('../tests/helpers/visualFrames.mjs');
  const { auditCameraRecord, CAMERA_VIEWPORTS } = await import('../tests/helpers/cameraTrace.mjs');
  const audits = workerData.audits.map(({ audit, viewports: names, canopy, snapshot }) => {
    const viewports = (audit === 'camera' ? CAMERA_VIEWPORTS : VIEWPORTS).filter(viewport => names.includes(viewport.name));
    if (viewports.length !== names.length) throw Error(`Unknown viewport in ${names.join(', ')}`);
    return { audit, viewports, canopy, snapshot };
  });
  const failure = error => ({ error: String(error?.stack ?? error).split('\n').slice(0, 3).join(' | ') });
  const attempt = run => { try { return run(); } catch (error) { return failure(error); } };
  parentPort.on('message', ({ index, id, input }) => {
    // One preparation per record; layoutMeasuredScenes keeps each canvas size's
    // layout on it, so audits that share a viewport lay it out once.
    let visual;
    try { visual = prepareVisualRecord(input); } catch (error) { parentPort.postMessage({ index, id, ...failure(error) }); return; }
    parentPort.postMessage({ index, id, audits: audits.map(({ audit, viewports, canopy, snapshot }) => attempt(() => audit === 'camera'
      ? auditCameraRecord(id, input, { viewports, visual }) : auditVisualRecord(id, input, { viewports, canopy, visual, snapshot }))) });
  });
} else await main();
