// Runs one CI shard of `npm test`. CI passes the file list the shell expands for
// `npm test`; every file is assigned to exactly one shard by a deterministic
// greedy split over the weights below, so the shards together run that suite.
//   node scripts/ciTestShard.mjs 2/6 tests/*.test.mjs          run shard 2 of 6
//   node scripts/ciTestShard.mjs --list 2/6 tests/*.test.mjs   print its files
//   node scripts/ciTestShard.mjs --check 6 tests/*.test.mjs    verify 6 shards partition the files
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// Files run at once in a shard. `npm test` runs six on a developer machine; a
// CI runner has four vCPUs (about 2.5 cores of throughput), and the shard
// weights below are balanced for two at a time.
const CONCURRENCY = 2;

// Approximate standalone seconds of the files that take two or more, measured
// one file at a time on an M-series Mac (5 Nov 2026; 535 of 577 files, the
// rest kept their earlier weight); unlisted files weigh 1. CI runs the same
// shards about 2.4 times slower, in the same order. Weights only balance the
// shards. A stale or missing weight never drops a file.
const WEIGHTS = new Map([
  ['spelloutContract.test.mjs', 25],
  ['replayCorpusLayoutPart3.test.mjs', 22],
  ['replayInvariants.test.mjs', 22],
  ['replayCorpusLayoutPart2.test.mjs', 21],
  ['replayCorpusLayoutPart4.test.mjs', 20],
  ['replayCorpusLayoutPart1.test.mjs', 19],
  ['providerTransport.test.mjs', 18],
  ['publicBackgroundParse.test.mjs', 18],
  ['stageLayoutRegressions.test.mjs', 18],
  ['partsListContract.test.mjs', 16],
  ['bareLabelParity.test.mjs', 14],
  ['publicDisconnect.test.mjs', 14],
  ['closingPlaqueRoom.test.mjs', 10],
  ['offlineAuditPass.test.mjs', 10],
  ['canopyCameraFit.test.mjs', 9],
  ['replayCorpusComparator.test.mjs', 9],
  ['reviewWorkspaceBoundaries.test.mjs', 9],
  ['movementSlotClearance.test.mjs', 8],
  ['visualInvariants.test.mjs', 8],
  ['cameraInvariants.test.mjs', 7],
  ['workspaceHistoricalContinuity.test.mjs', 7],
  ['plaqueForeseenPocket.test.mjs', 6],
  ['plaqueLayoutJob.test.mjs', 6],
  ['stageCamera.test.mjs', 6],
  ['devPreviewBuild.test.mjs', 5],
  ['plaqueNearbyLifetime.test.mjs', 5],
  ['plaqueReach.test.mjs', 5],
  ['relocatedPlaqueAnchor.test.mjs', 5],
  ['appBundleSplit.test.mjs', 4],
  ['movementReceivingSlots.test.mjs', 4],
  ['plaqueLayoutInkJob.test.mjs', 4],
  ['plaquePlacement.test.mjs', 4],
  ['replayNamedAtlasRegressions.test.mjs', 4],
  ['workspaceArabicContinuity.test.mjs', 4],
  ['workspaceReservation.test.mjs', 4],
  ['closingKeepsWorkspaceWidths.test.mjs', 3],
  ['contractFingerprintCoverage.test.mjs', 3],
  ['currentRootCompaction.test.mjs', 3],
  ['parseTicket.test.mjs', 3],
  ['plaqueGeometrySchedule.test.mjs', 3],
  ['realizationPlateNearOwner.test.mjs', 3],
  ['rtlRelationMirror.test.mjs', 3],
  ['selectedHeadReceivesRaisedHead.test.mjs', 3],
  ['tier2ProviderFreeVerification.test.mjs', 3],
  ['workspaceComponentLifetime.test.mjs', 3],
  ['workspaceHistoryRefinement.test.mjs', 3],
  ['cameraCarryClosing.test.mjs', 2],
  ['canopyFinalReplayFrame.test.mjs', 2],
  ['casePlaqueMeasuredSource.test.mjs', 2],
  ['codexQualification.test.mjs', 2],
  ['contractQualificationLiveReview.test.mjs', 2],
  ['loweredSubtreeHold.test.mjs', 2],
  ['movementWaitingSlots.test.mjs', 2],
  ['nativePlaqueRendering.test.mjs', 2],
  ['plaqueAvoidsRegions.test.mjs', 2],
  ['plaqueHoldPockets.test.mjs', 2],
  ['plaqueLaterMarkPocket.test.mjs', 2],
  ['researchGeneration.test.mjs', 2],
  ['serverStaleDist.test.mjs', 2],
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
