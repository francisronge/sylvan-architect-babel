import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compareCorpusSnapshots, loadCorpusManifest, sha256 } from './replayCorpusInputs.mjs';

const run = promisify(execFile), worker = fileURLToPath(new URL('./replayCorpusSnapshot.mjs', import.meta.url));
const defaultManifest = fileURLToPath(new URL('../fixtures/replay-corpus/manifest.json', import.meta.url));

export async function compareReplayCorpus({ baselineRoot, candidateRoot, manifest = defaultManifest,
  archiveManifest, output, width = 1600, height = 948, direction = 'ltr', timeout = 180000 }) {
  const manifests = await Promise.all([manifest, ...(archiveManifest ? [archiveManifest] : [])].map(loadCorpusManifest));
  const records = manifests.flatMap(value => value.records), ids = new Set(records.map(record => record.id));
  if (ids.size !== records.length) throw Error('Record IDs must be unique across manifests');
  const layout = { width, height, direction }, scratch = await mkdtemp(path.join(tmpdir(), 'babel-corpus-'));
  try {
    const snapshots = [];
    // Separate processes load each checkout's modules and dependency installation.
    // Inputs are selected once, so a baseline fixture cannot silently differ.
    for (const [index, root] of [baselineRoot, candidateRoot].entries()) {
      const request = path.join(scratch, `${index}-request.json`), snapshot = path.join(scratch, `${index}-snapshot.json`);
      await writeFile(request, JSON.stringify({ root: path.resolve(root), records, layout }));
      await run(process.execPath, [worker, request, snapshot], { cwd: path.resolve(root), timeout, maxBuffer: 1024 * 1024 });
      snapshots.push(JSON.parse(await readFile(snapshot, 'utf8')));
    }
    const compared = compareCorpusSnapshots(snapshots[0], snapshots[1], records);
    const failures = compared.filter(record => record.violations.length);
    const report = { schemaVersion: 1, ok: failures.length === 0, layout,
      scope: 'Offline Replay and unmeasured tree reservations. Native text metrics, SVG painting, plaque/connector geometry, camera and interaction are separate browser gates.',
      manifests: manifests.map(({ filename, sha256, coverage }) => ({ filename, sha256, coverage })),
      harness: { node: process.version, sources: await Promise.all([
        fileURLToPath(import.meta.url), worker, fileURLToPath(new URL('./replayCorpusInputs.mjs', import.meta.url)),
        fileURLToPath(new URL('./replayFrameLayout.mjs', import.meta.url))
      ].map(async filename => ({ filename, sha256: sha256(await readFile(filename)) }))) },
      baseline: snapshots[0].identity, candidate: snapshots[1].identity,
      summary: { analyses: compared.length, frames: compared.reduce((count, record) => count + (record.frames ?? 0), 0),
        uniqueInputs: new Set(records.map(record => record.inputSha256)).size,
        recordsWithoutMechanismLabels: records.filter(record => !record.mechanisms.length).length,
        changedAnalyses: compared.filter(record => record.changedFrames?.length).length, failures: failures.length,
        existingContinuityFaults: snapshots[0].records.reduce((count, record) => count + (record.continuity?.length ?? 0), 0) },
      records: compared };
    if (output) await writeFile(path.resolve(output), JSON.stringify(report, null, 2) + '\n');
    return report;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

function parseArgs(args) {
  const flags = { '--baseline-root': 'baselineRoot', '--candidate-root': 'candidateRoot', '--manifest': 'manifest',
    '--archive-manifest': 'archiveManifest', '--output': 'output', '--width': 'width', '--height': 'height',
    '--direction': 'direction', '--timeout-ms': 'timeout' };
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = flags[args[index]], value = args[index + 1];
    if (!key || !value || value.startsWith('--')) throw Error(`Unknown or incomplete argument: ${args[index]}`);
    if (Object.hasOwn(options, key)) throw Error(`Duplicate argument: ${args[index]}`);
    options[key] = ['width', 'height', 'timeout'].includes(key) ? Number(value) : value;
  }
  if (!options.baselineRoot || !options.candidateRoot || !options.output)
    throw Error('Usage: node scripts/compareReplayCorpus.mjs --baseline-root /base --candidate-root /candidate --output /tmp/report.json [--manifest /manifest.json] [--archive-manifest /private-index.json]');
  for (const key of ['width', 'height', 'timeout'])
    if (options[key] !== undefined && (!Number.isFinite(options[key]) || options[key] <= 0)) throw Error(`${key} must be positive`);
  if (options.direction !== undefined && !['ltr', 'rtl'].includes(options.direction)) throw Error('direction must be ltr or rtl');
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseArgs(process.argv.slice(2)), report = await compareReplayCorpus(options);
    console.log(JSON.stringify({ ...report.summary, ok: report.ok, output: path.resolve(options.output) }));
    if (!report.ok) process.exitCode = 1;
  } catch (error) { console.error(error.stack ?? String(error)); process.exitCode = 1; }
}
