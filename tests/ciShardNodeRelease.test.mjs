import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// A sharded CI check is judged as one run, so its shards and the job that merges
// them must run one Node.js release. The corpus comparison refuses shards whose
// harness (Node.js version included) differs, and runner images cache different
// Node.js 24 releases while a new image rolls out (run 41217284184: shard 2 ran
// 24.22.0, shard 1 and the merge 24.22.1). The workflow resolves the release once
// in node-release and every sharded or merging job installs exactly that one.
const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const jobs = new Map(workflow.split(/\n(?=  [a-z][a-z-]*:\n)/).slice(1)
  .map(block => [/^ {2}([a-z][a-z-]*):/.exec(block)[1], block]));
const needs = block => {
  const value = /\n {4}needs: (.+)\n/.exec(block)?.[1] ?? '';
  return value.replace(/^\[|\]$/g, '').split(',').map(name => name.trim()).filter(Boolean);
};

test('every sharded or merging CI job runs the one Node.js release node-release resolves', () => {
  assert.match(jobs.get('node-release') ?? '', /check-latest: true/, 'node-release resolves the newest Node.js 24 once');
  const sharded = [...jobs].filter(([, block]) => /--shard |--merge /.test(block)).map(([name]) => name);
  assert.deepEqual(sharded.sort(), ['corpus-motion', 'corpus-motion-shard', 'replay-offline', 'replay-offline-shard']);
  for (const name of sharded) {
    const block = jobs.get(name);
    assert(needs(block).includes('node-release'), `${name} needs node-release`);
    const versions = [...block.matchAll(/node-version: (.+)/g)].map(match => match[1].trim());
    assert.deepEqual(versions, ['${{ needs.node-release.outputs.version }}'], `${name} installs the resolved release, not a range`);
  }
  assert(needs(jobs.get('verify')).includes('node-release'), 'the required check fails when the release cannot be resolved');
});
