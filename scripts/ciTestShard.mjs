// Runs one CI shard of `npm test`. CI passes the file list the shell expands for
// `npm test`; every file is assigned to exactly one shard by a deterministic
// greedy split over the weights below, so the shards together run that suite.
//   node scripts/ciTestShard.mjs 2/6 tests/*.test.mjs          run shard 2 of 6
//   node scripts/ciTestShard.mjs --list 2/6 tests/*.test.mjs   print its files
//   node scripts/ciTestShard.mjs --check 6 tests/*.test.mjs    verify 6 shards partition the files
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// Matches `npm test`; the CI workflow fails if that script changes.
const CONCURRENCY = 2;

// Approximate standalone seconds of the slowest files; unlisted files weigh 1.
// Weights only balance the shards. A stale or missing weight never drops a file.
const WEIGHTS = new Map([
  ['replaySiblingContours.test.mjs', 42],
  ['publicBackgroundParse.test.mjs', 19],
  ['spelloutContract.test.mjs', 16],
  ['providerTransport.test.mjs', 16],
  ['reviewWorkspaceBoundaries.test.mjs', 16],
  ['workspaceArabicContinuity.test.mjs', 15],
  ['publicDisconnect.test.mjs', 15],
  ['replayInvariants.test.mjs', 14],
  ['workspaceHistoricalContinuity.test.mjs', 9],
  ['cameraInvariants.test.mjs', 7],
  ['visualInvariants.test.mjs', 7],
  ['plaqueLayoutJob.test.mjs', 7],
  ['stageCamera.test.mjs', 6],
  ['researchGeneration.test.mjs', 6],
  ['replayNamedAtlasRegressions.test.mjs', 6],
  ['movementSlotClearance.test.mjs', 6],
  ['workspaceReservation.test.mjs', 6],
  ['replayCorpusComparator.test.mjs', 5],
  ['workspaceHistoryRefinement.test.mjs', 5],
  ['plaquePlacement.test.mjs', 5],
]);

const weight = file => WEIGHTS.get(path.basename(file)) ?? 1;

// Node runs a shard's files in sorted order, so its heaviest file may start
// last; a shard's cost is therefore its other files spread over the
// concurrency, plus that heaviest file.
function assign(files, total) {
  const shards = Array.from({ length: total }, () => ({ files: [], sum: 0, max: 0 }));
  const cost = (sum, max) => (sum - max) / CONCURRENCY + max;
  const ordered = [...new Set(files)].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : a > b ? 1 : 0));
  for (const file of ordered) {
    const w = weight(file);
    let best = shards[0];
    for (const shard of shards) {
      if (cost(shard.sum + w, Math.max(shard.max, w)) < cost(best.sum + w, Math.max(best.max, w))) best = shard;
    }
    best.files.push(file);
    best.sum += w;
    best.max = Math.max(best.max, w);
  }
  return shards.map(shard => shard.files.sort());
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const mode = args[0] === '--list' || args[0] === '--check' ? args.shift() : 'run';
const [spec, ...files] = args;
if (!files.length) fail('Usage: node scripts/ciTestShard.mjs [--list] INDEX/TOTAL FILE... | --check TOTAL FILE...');

if (mode === '--check') {
  const total = Number(spec);
  if (!Number.isInteger(total) || total < 1) fail(`Invalid shard total ${spec}`);
  const shards = assign(files, total);
  const assigned = shards.flat();
  const expected = [...new Set(files)].sort();
  if (shards.some(shard => !shard.length)) fail('A shard has no files.');
  if (assigned.length !== expected.length || [...assigned].sort().some((file, index) => file !== expected[index])) {
    fail('The shards do not partition the test files.');
  }
  shards.forEach((shard, index) => console.log(`shard ${index + 1}/${total}: ${shard.length} files, weight ${shard.reduce((sum, file) => sum + weight(file), 0)}`));
  console.log(`${expected.length} files, each in exactly one of ${total} shards.`);
  process.exit(0);
}

const match = /^(\d+)\/(\d+)$/.exec(spec ?? '');
const index = Number(match?.[1]), total = Number(match?.[2]);
if (!match || index < 1 || index > total) fail(`Invalid shard ${spec}; expected INDEX/TOTAL`);
const shard = assign(files, total)[index - 1];
// `node --test` with no files would run its default pattern instead.
if (!shard.length) fail(`Shard ${spec} has no files.`);
if (mode === '--list') {
  console.log(shard.join('\n'));
  process.exit(0);
}
const result = spawnSync(process.execPath, ['--test', `--test-concurrency=${CONCURRENCY}`, ...shard], { stdio: 'inherit' });
if (result.error) fail(String(result.error));
process.exit(result.status ?? 1);
