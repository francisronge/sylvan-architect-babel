import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compareCorpusSnapshots, loadCorpusManifest, sha256 } from './replayCorpusInputs.mjs';
import { EXCEPTIONS as MOTION_EXCEPTIONS } from '../tests/helpers/motionExceptions.mjs';

const run = promisify(execFile), worker = fileURLToPath(new URL('./replayCorpusSnapshot.mjs', import.meta.url));
const defaultManifest = fileURLToPath(new URL('../fixtures/replay-corpus/manifest.json', import.meta.url));

/** Compares the baseline and candidate checkouts over the manifests' records.
 * With `shard` ({ index, total }) it measures only that shard's records in both
 * checkouts and writes them to `snapshotsOut` unjudged; with `merge` (shard
 * files) it reads every shard's measurements in place of measuring, and
 * compares and reports them exactly as one run does. */
export async function compareReplayCorpus({ baselineRoot, candidateRoot, manifest = defaultManifest,
  archiveManifest, output, width = 1600, height = 948, direction = 'ltr', timeout = 180000, jobs = defaultJobs(),
  shard, snapshotsOut, merge = [] }) {
  const manifests = await Promise.all([manifest, ...(archiveManifest ? [archiveManifest] : [])].map(loadCorpusManifest));
  const records = manifests.flatMap(value => value.records), ids = new Set(records.map(record => record.id));
  if (ids.size !== records.length) throw Error('Record IDs must be unique across manifests');
  allowAddedFixtures(records, baselineRoot, candidateRoot);
  allowFingerprintedFixtures(manifests.slice(1).flatMap(value => value.records), candidateRoot);
  const layout = { width, height, direction }, scratch = await mkdtemp(path.join(tmpdir(), 'babel-corpus-'));
  try {
    // Separate processes load each checkout's modules and dependency installation.
    // Inputs are selected once, so a baseline fixture cannot silently differ.
    const harness = await harnessSources();
    if (shard) {
      const own = shardRecords(records, shard);
      const snapshots = await measureCheckouts([baselineRoot, candidateRoot], own, layout, { scratch, timeout, jobs });
      await writeFile(path.resolve(snapshotsOut), JSON.stringify({ schemaVersion: 1, shard: `${shard.index}/${shard.total}`,
        ids: records.map(record => record.id), expects: records.map(record => record.expect), layout, harness, snapshots }));
      return { shard: `${shard.index}/${shard.total}`, analyses: own.length, of: records.length };
    }
    const snapshots = merge.length ? await mergeShards(merge, records, layout, harness)
      : await measureCheckouts([baselineRoot, candidateRoot], records, layout, { scratch, timeout, jobs });
    const compared = compareCorpusSnapshots(snapshots[0], snapshots[1], records, { motionExceptions: MOTION_EXCEPTIONS });
    const failures = compared.filter(record => record.violations.length);
    const report = { schemaVersion: 1, ok: failures.length === 0, layout,
      scope: 'Offline Replay and the measured tree layout the renderer paints, with text measured from the bundled fonts. Native text rendering, SVG painting, plaque/connector geometry, camera and interaction are separate browser gates.',
      manifests: manifests.map(({ filename, sha256, coverage }) => ({ filename, sha256, coverage })),
      harness,
      baseline: snapshots[0].identity, candidate: snapshots[1].identity,
      summary: { analyses: compared.length, frames: compared.reduce((count, record) => count + (record.frames ?? 0), 0),
        uniqueInputs: new Set(records.map(record => record.inputSha256)).size,
        recordsWithoutMechanismLabels: records.filter(record => !record.mechanisms.length).length,
        changedAnalyses: compared.filter(record => record.changedFrames?.length).length, failures: failures.length,
        toleratedMotionFaults: compared.reduce((count, record) => count + (record.motion?.tolerated.length ?? 0), 0),
        exceptedMotionFaults: compared.reduce((count, record) => count + (record.motion?.excepted.length ?? 0), 0),
        existingContinuityFaults: snapshots[0].records.reduce((count, record) => count + (record.continuity?.length ?? 0), 0),
        existingMotionFaults: motionCounts(compared, 'baseline'), candidateMotionFaults: motionCounts(compared, 'candidate') },
      records: compared };
    if (output) await writeFile(path.resolve(output), JSON.stringify(report, null, 2) + '\n');
    return report;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

/** The comparison harness: Node and the sources that measure and judge. */
async function harnessSources() {
  return { node: process.version, sources: await Promise.all([
    fileURLToPath(import.meta.url), worker, fileURLToPath(new URL('./replayCorpusInputs.mjs', import.meta.url)),
    fileURLToPath(new URL('./replayFrameLayout.mjs', import.meta.url)),
    fileURLToPath(new URL('./replayMotionContinuity.mjs', import.meta.url)),
    // Approved motion faults and how their bounds match.
    fileURLToPath(new URL('../tests/helpers/motionExceptions.mjs', import.meta.url)),
    fileURLToPath(new URL('../tests/helpers/findings.mjs', import.meta.url)),
    // The movement rule judges both checkouts' Replays.
    fileURLToPath(new URL('../tests/helpers/replayInvariants.mjs', import.meta.url)),
    // Both checkouts' text is measured from the bundled fonts.
    fileURLToPath(new URL('../tests/helpers/visualFontMetrics.mjs', import.meta.url)),
    // The motion rule, which replayMotionContinuity.mjs re-exports, and the
    // camera carry it measures stage crossings through, as the renderer applies it.
    fileURLToPath(new URL('../replay/motionRule.ts', import.meta.url)),
    fileURLToPath(new URL('../replay/cameraCarry.ts', import.meta.url)),
    fileURLToPath(new URL('../components/treeViewport.ts', import.meta.url))
  ].map(async filename => ({ filename, sha256: sha256(await readFile(filename)) }))) };
}

/** Records that share an input, which one chunk measures once, in record order. */
function inputGroups(records) {
  const groups = new Map();
  for (const record of records) groups.set(record.inputSha256, [...(groups.get(record.inputSha256) ?? []), record]);
  return [...groups.values()];
}

/** Shard `index` of `total`: input groups, heaviest first by syntax nodes over
 * their stages, each go to the shard with the least so far (ties to the lower
 * shard), so the shards partition the records deterministically. */
export function shardRecords(records, { index, total }) {
  const cost = ([record]) => {
    let nodes = 0;
    const visit = node => { nodes++; (node.children ?? []).forEach(visit); };
    for (const stage of record.input.derivationStages) stage.workspaceForest.forEach(visit);
    return nodes;
  };
  const groups = inputGroups(records), costs = groups.map(cost), load = new Array(total).fill(0), own = new Set();
  for (const position of groups.map((_, at) => at).sort((a, b) => costs[b] - costs[a] || a - b)) {
    const lightest = load.indexOf(Math.min(...load));
    load[lightest] += costs[position];
    if (lightest === index - 1) for (const record of groups[position]) own.add(record);
  }
  return records.filter(record => own.has(record));
}

/** Both checkouts' snapshots over `records`, from shard files. The shards must
 * be 1..N of one N, have selected the same records with the same mechanism
 * expectations (a shard judges them as it measures) at the same layout with
 * the same harness, report the same source identity for each checkout, and
 * together hold every record exactly once for each checkout. */
async function mergeShards(files, records, layout, harness) {
  const shards = await Promise.all(files.map(async file => JSON.parse(await readFile(path.resolve(file), 'utf8'))));
  const names = shards.map(shard => shard.shard), total = Number(/^\d+\/(\d+)$/.exec(names[0] ?? '')?.[1]);
  const expected = Array.from({ length: total }, (_, index) => `${index + 1}/${total}`);
  if (!total || JSON.stringify([...names].sort()) !== JSON.stringify(expected.sort()))
    throw Error(`--merge needs shards 1/N to N/N of one N, each once; got ${names.join(', ')}`);
  const ids = JSON.stringify(records.map(record => record.id)), expects = JSON.stringify(records.map(record => record.expect));
  for (const shard of shards) {
    if (shard.schemaVersion !== 1 || JSON.stringify(shard.ids) !== ids || JSON.stringify(shard.layout) !== JSON.stringify(layout))
      throw Error(`Shard ${shard.shard} measured other records or another layout than this run selects`);
    if (JSON.stringify(shard.expects) !== expects) throw Error(`Shard ${shard.shard} judged other mechanism expectations than this run selects`);
    if (JSON.stringify(shard.harness) !== JSON.stringify(harness)) throw Error(`Shard ${shard.shard} ran another harness`);
  }
  return [0, 1].map(side => {
    const identity = shards[0].snapshots[side].identity;
    if (shards.some(shard => shard.snapshots[side].identity.sha256 !== identity.sha256))
      throw Error(`The shards measured different ${side ? 'candidate' : 'baseline'} sources`);
    const measured = new Map();
    for (const record of shards.flatMap(shard => shard.snapshots[side].records)) {
      if (measured.has(record.id)) throw Error(`Shards repeat ${record.id}`);
      measured.set(record.id, record);
    }
    const missing = records.filter(record => !measured.has(record.id));
    if (missing.length || measured.size !== records.length)
      throw Error(`Shards lack ${missing.length} records, such as ${missing[0]?.id}, or hold others`);
    return { identity, records: records.map(record => measured.get(record.id)) };
  });
}

/** Up to four workers: each measures records independently, so the count
 * changes only the wall time, never a snapshot. */
const defaultJobs = () => Math.min(4, availableParallelism());

/** Each checkout's snapshot, as one process measuring every record in order
 * would write it. The records are cut into chunks, and both checkouts' chunks
 * share `jobs` worker processes. Records do not depend on one another, so the
 * chunks' results, put back in record order, are the same snapshot. Every chunk
 * must report the same source identity, so a checkout cannot change mid-run. */
export async function measureCheckouts(roots, records, layout, { scratch, timeout, jobs }) {
  // Records sharing an input stay in one chunk, which measures that input once.
  const units = inputGroups(records), size = Math.max(1, Math.ceil(units.length / Math.max(1, jobs * 4)));
  const chunks = [];
  for (let start = 0; start < units.length || start === 0; start += size)
    chunks.push(units.slice(start, start + size).flat());
  const tasks = roots.flatMap((root, side) => chunks.map((chunk, index) => ({ root: path.resolve(root), side, index, chunk })));
  const outputs = roots.map(() => new Array(chunks.length));
  let next = 0, failed = false;
  const work = async () => {
    while (!failed && next < tasks.length) {
      const { root, side, index, chunk } = tasks[next++];
      const request = path.join(scratch, `${side}-${index}-request.json`), snapshot = path.join(scratch, `${side}-${index}-snapshot.json`);
      await writeFile(request, JSON.stringify({ root, records: chunk, layout }));
      try { await run(process.execPath, [worker, request, snapshot], { cwd: root, timeout, maxBuffer: 1024 * 1024 }); }
      catch (error) { failed = true; throw error; }
      outputs[side][index] = JSON.parse(await readFile(snapshot, 'utf8'));
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, jobs), tasks.length) }, work));
  return outputs.map((parts, side) => {
    const identity = parts[0].identity;
    if (parts.some(part => part.identity.sha256 !== identity.sha256)) throw Error(`Sources changed while measuring ${roots[side]}`);
    const measured = new Map(parts.flatMap(part => part.records).map(record => [record.id, record]));
    return { identity, records: records.map(record => measured.get(record.id)) };
  });
}

/** `file` relative to `directory`, or null when it lies outside it. */
const inside = (directory, file) => {
  const relative = file && path.relative(path.resolve(directory), path.resolve(file));
  return !relative || relative.startsWith('..') || path.isAbsolute(relative) ? null : relative;
};

/** A record read from a file inside the candidate checkout that the base
 * checkout lacks (a fixture the change adds) cannot regress its Replay, relation
 * plan, final layout or completed widths from the base, which never had it: the
 * base's rendering of it is the behavior the change replaces. Those comparisons
 * are waived with that reason (`motionOnly`); its motion, continuity and
 * geometry are still judged against the base's layout of the same input.
 * Mutates `records`. */
export function allowAddedFixtures(records, baselineRoot, candidateRoot) {
  for (const record of records) {
    const relative = inside(candidateRoot, record.source);
    if (!relative || existsSync(path.join(path.resolve(baselineRoot), relative))) continue;
    record.motionOnly = `${relative} is new in this change; the base checkout has no copy to compare its Replay with.`;
  }
  return records;
}

/** An archive record of a committed fixture analysis the candidate's layout
 * fingerprint covers has its Replay, relation plan, final layout and widths
 * reviewed through that fingerprint (verify:replay-offline), so this
 * comparison judges it by motion, continuity, geometry and movement only.
 * The run decides this from the candidate's own fingerprint each time; no
 * manifest can claim it. Mutates `records`. */
export function allowFingerprintedFixtures(records, candidateRoot) {
  const fixtures = path.join(path.resolve(candidateRoot), 'fixtures');
  const file = path.join(fixtures, 'replay-snapshots', 'fixture-layout.json');
  const reviewed = new Set(existsSync(file) ? Object.keys(JSON.parse(readFileSync(file, 'utf8')).records ?? {}) : []);
  for (const record of records) {
    const relative = inside(fixtures, record.source)?.split(path.sep).join('/');
    if (!relative || !reviewed.has(`${relative}#${record.selector ?? ''}`)) continue;
    record.motionOnly ??= `A committed fixture: its Replay and layout changes are reviewed through fixtures/replay-snapshots/fixture-layout.json `
      + '(verify:replay-offline), so this comparison judges it by motion, continuity, geometry and movement only.';
  }
  return records;
}

/** Motion faults by kind, with the analyses and frames that contain any. */
function motionCounts(records, side) {
  const faults = records.flatMap(record => (record.motion?.[side] ?? []).map(fault => ({ ...fault, record: record.id })));
  const kinds = {};
  for (const fault of faults) kinds[fault.kind] = (kinds[fault.kind] ?? 0) + 1;
  return { faults: faults.length, kinds, analyses: new Set(faults.map(fault => fault.record)).size,
    frames: new Set(faults.map(fault => `${fault.record}#${fault.frame}`)).size };
}

function parseArgs(args) {
  const flags = { '--baseline-root': 'baselineRoot', '--candidate-root': 'candidateRoot', '--manifest': 'manifest',
    '--archive-manifest': 'archiveManifest', '--output': 'output', '--width': 'width', '--height': 'height',
    '--direction': 'direction', '--timeout-ms': 'timeout', '--jobs': 'jobs', '--shard': 'shard',
    '--snapshots-out': 'snapshotsOut', '--merge': 'merge' };
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = flags[args[index]], value = args[index + 1];
    if (!key || !value || value.startsWith('--')) throw Error(`Unknown or incomplete argument: ${args[index]}`);
    if (key === 'merge') { (options.merge ??= []).push(value); continue; }
    if (Object.hasOwn(options, key)) throw Error(`Duplicate argument: ${args[index]}`);
    options[key] = ['width', 'height', 'timeout', 'jobs'].includes(key) ? Number(value) : value;
  }
  if (options.shard !== undefined) {
    const match = /^(\d+)\/(\d+)$/.exec(options.shard), index = Number(match?.[1]), total = Number(match?.[2]);
    if (!match || index < 1 || index > total) throw Error(`Invalid --shard ${options.shard}; expected I/N`);
    if (!options.snapshotsOut || options.merge || options.output) throw Error('--shard needs --snapshots-out and takes neither --merge nor --output');
    options.shard = { index, total };
    if (!options.baselineRoot || !options.candidateRoot) throw Error('--shard needs --baseline-root and --candidate-root');
    return options;
  }
  if (options.snapshotsOut) throw Error('--snapshots-out needs --shard I/N');
  if (!options.baselineRoot || !options.candidateRoot || !options.output)
    throw Error('Usage: node scripts/compareReplayCorpus.mjs --baseline-root /base --candidate-root /candidate --output /tmp/report.json [--manifest /manifest.json] [--archive-manifest /private-index.json] [--jobs N] [--timeout-ms MS] [--shard I/N --snapshots-out FILE | --merge FILE ...]');
  if (options.jobs !== undefined && !(Number.isInteger(options.jobs) && options.jobs > 0)) throw Error('jobs must be a positive integer');
  for (const key of ['width', 'height', 'timeout'])
    if (options[key] !== undefined && (!Number.isFinite(options[key]) || options[key] <= 0)) throw Error(`${key} must be positive`);
  if (options.direction !== undefined && !['ltr', 'rtl'].includes(options.direction)) throw Error('direction must be ltr or rtl');
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseArgs(process.argv.slice(2)), report = await compareReplayCorpus(options);
    if (options.shard) console.log(JSON.stringify({ ...report, snapshots: path.resolve(options.snapshotsOut) }));
    else {
      console.log(JSON.stringify({ ...report.summary, ok: report.ok, output: path.resolve(options.output) }));
      if (!report.ok) process.exitCode = 1;
    }
  } catch (error) { console.error(error.stack ?? String(error)); process.exitCode = 1; }
}
