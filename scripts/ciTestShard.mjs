// Runs one CI shard of `npm test`. CI passes the file list the shell expands for
// `npm test`; every file is assigned to exactly one shard by a deterministic
// greedy split over the weights below, so the shards together run that suite.
//   node scripts/ciTestShard.mjs 2/6 tests/*.test.mjs          run shard 2 of 6
//   node scripts/ciTestShard.mjs --list 2/6 tests/*.test.mjs   print its files
//   node scripts/ciTestShard.mjs --check 6 tests/*.test.mjs    verify 6 shards partition the files
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// Matches `npm test`, which CI runs with its compile cache; the CI workflow
// fails if that script changes.
const CONCURRENCY = 2;

// Approximate standalone seconds of the files that take two or more (measured
// one file at a time on an M-series Mac, three at once); unlisted files weigh 1.
// Weights only balance the shards. A stale or missing weight never drops a file.
const WEIGHTS = new Map([
  ['replayCorpusLayoutPart1.test.mjs', 20],
  ['replayCorpusLayoutPart2.test.mjs', 20],
  ['replayCorpusLayoutPart3.test.mjs', 20],
  ['replayCorpusLayoutPart4.test.mjs', 20],
  ['spelloutContract.test.mjs', 21],
  ['bareLabelParity.test.mjs', 19],
  ['partsListContract.test.mjs', 19],
  ['publicBackgroundParse.test.mjs', 18],
  ['replayInvariants.test.mjs', 18],
  ['providerTransport.test.mjs', 16],
  ['publicDisconnect.test.mjs', 14],
  ['cameraInvariants.test.mjs', 9],
  ['visualInvariants.test.mjs', 9],
  ['canopyCameraFit.test.mjs', 8],
  ['movementSlotClearance.test.mjs', 8],
  ['reviewWorkspaceBoundaries.test.mjs', 8],
  ['devPreviewBuild.test.mjs', 7],
  ['plaqueLayoutJob.test.mjs', 7],
  ['replayNamedAtlasRegressions.test.mjs', 6],
  ['stageCamera.test.mjs', 6],
  ['workspaceArabicContinuity.test.mjs', 5],
  ['replayCorpusComparator.test.mjs', 13],
  ['movementReceivingSlots.test.mjs', 5],
  ['plaquePlacement.test.mjs', 4],
  ['workspaceHistoricalContinuity.test.mjs', 4],
  ['tier2ProviderFreeVerification.test.mjs', 4],
  ['rtlRelationMirror.test.mjs', 4],
  ['workspaceComponentLifetime.test.mjs', 4],
  ['workspaceReservation.test.mjs', 4],
  ['contractFingerprintCoverage.test.mjs', 3],
  ['offlineAuditPass.test.mjs', 11],
  ['plaqueLayoutInkJob.test.mjs', 3],
  ['plaqueNearbyLifetime.test.mjs', 3],
  ['workspaceHistoryRefinement.test.mjs', 3],
  ['plaqueReach.test.mjs', 3],
  ['contractQualificationLiveReview.test.mjs', 3],
  ['serverStaleDist.test.mjs', 3],
  ['relocatedPlaqueAnchor.test.mjs', 3],
  ['plaqueGeometrySchedule.test.mjs', 3],
  ['selectedHeadReceivesRaisedHead.test.mjs', 3],
  ['nativePlaqueRendering.test.mjs', 2],
  ['casePlaqueMeasuredSource.test.mjs', 2],
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
