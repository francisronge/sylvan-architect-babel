import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// A sharded CI check is judged as one run, so its shards and the job that merges
// them must run one Node.js release. The corpus comparison refuses shards whose
// harness (Node.js version included) differs, and runner images cache different
// Node.js 24 releases while a new image rolls out (run 41217284184: shard 2 ran
// 24.22.0, shard 1 and the merge 24.22.1). The scope job resolves the release
// once and every sharded or merging job installs exactly that one.
const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const jobs = new Map(workflow.slice(workflow.indexOf('\njobs:\n')).split(/\n(?=  [a-z][a-z-]*:\n)/).slice(1)
  .map(block => [/^ {2}([a-z][a-z-]*):/.exec(block)[1], block]));
const needs = block => {
  const value = /\n {4}needs: (.+)\n/.exec(block)?.[1] ?? '';
  return value.replace(/^\[|\]$/g, '').split(',').map(name => name.trim()).filter(Boolean);
};
const sharded = [...jobs].filter(([, block]) => /--shard |--merge /.test(block)).map(([name]) => name).sort();
const RESOLVED = '${{ needs.scope.outputs.node-version }}';

test('every sharded or merging CI job runs the one Node.js release the scope job resolves', () => {
  const scope = jobs.get('scope') ?? '';
  assert.match(scope, /\n {6}node-version: \$\{\{ steps\.node\.outputs\.node-version \}\}\n/, 'scope publishes the release it resolved');
  assert.match(scope, /\n {8}id: node\n[\s\S]*?\n {10}node-version: 24\.x\n {10}check-latest: true\n/, 'scope resolves the newest Node.js 24 once');
  assert.deepEqual(sharded, ['corpus-motion', 'corpus-motion-shard', 'replay-offline', 'replay-offline-shard']);
  for (const name of sharded) {
    const block = jobs.get(name);
    assert(needs(block).includes('scope'), `${name} needs scope`);
    const versions = [...block.matchAll(/node-version: (.+)/g)].map(match => match[1].trim());
    assert.deepEqual(versions, [RESOLVED], `${name} installs the resolved release, not a range`);
  }
  // Only the shards decide whether to run; a merge runs exactly when its shards
  // succeeded, so a skipped shard skips its merge.
  for (const name of ['replay-offline-shard', 'corpus-motion-shard']) {
    assert.match(jobs.get(name), /\n {4}if: needs\.scope\.outputs\.replay == 'true'\n/, `${name} runs only when the change can affect Replay`);
  }
});

test('the required check accounts for every CI job, and only Replay jobs skip for a non-Replay change', () => {
  const verify = jobs.get('verify');
  assert.deepEqual(needs(verify).sort(), [...jobs.keys()].filter(name => name !== 'verify').sort(), 'verify needs every other job');
  const replayJobs = JSON.parse(/const replayJobs = new Set\((\[[^\]]*\])\)/.exec(verify)?.[1] ?? 'null');
  assert.deepEqual(replayJobs?.sort(), sharded, 'the jobs that may skip for a non-Replay change are exactly the Replay jobs');
});

test('each Replay shard matrix, its job name, its shard flag and its merge agree on one shard count', () => {
  for (const [shardJob, mergeJob] of [['replay-offline-shard', 'replay-offline'], ['corpus-motion-shard', 'corpus-motion']]) {
    const block = jobs.get(shardJob), merge = jobs.get(mergeJob);
    const matrix = JSON.parse(/\n {8}shard: (\[[\d, ]+\])\n/.exec(block)?.[1] ?? 'null');
    const total = matrix?.length;
    assert.deepEqual(matrix, Array.from({ length: total }, (_, index) => index + 1), `${shardJob} lists shards 1..N`);
    assert.match(block, new RegExp(`\\n {4}name: .*\\(\\$\\{\\{ matrix\\.shard \\}\\}/${total}\\)\\n`), `${shardJob} names ${total} shards`);
    assert.match(block, new RegExp(`--shard \\$\\{\\{ matrix\\.shard \\}\\}/${total} `), `${shardJob} runs shard I/${total}`);
    const merged = [...merge.matchAll(/--merge "[^"]*-(\d+)\.json"/g)].map(match => Number(match[1]));
    assert.deepEqual(merged, matrix, `${mergeJob} merges every shard once`);
  }
});
