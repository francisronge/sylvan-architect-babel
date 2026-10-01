import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildReplaySnapshotProjection } from '../replay/replaySnapshot.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const normalizedDir = path.join(repoRoot, 'fixtures', 'normalized');
const snapshotDir = path.join(repoRoot, 'fixtures', 'replay-snapshots');
const fixtureNames = fs.readdirSync(normalizedDir)
  .filter((name) => name.endsWith('.json'))
  .sort();
const snapshotNames = fs.readdirSync(snapshotDir)
  .filter((name) => name.endsWith('.playback.json'))
  .sort();

test('replay compiler matches every committed fixture snapshot', () => {
  assert.deepEqual(
    snapshotNames,
    fixtureNames.map((name) => name.replace(/\.json$/, '.playback.json'))
  );
  for (const snapshotName of snapshotNames) {
    const fixtureName = snapshotName.replace(/\.playback\.json$/, '.json');
    const bundle = JSON.parse(fs.readFileSync(path.join(normalizedDir, fixtureName), 'utf8'));
    const expected = JSON.parse(fs.readFileSync(path.join(snapshotDir, snapshotName), 'utf8'));
    assert.deepEqual(
      buildReplaySnapshotProjection(bundle),
      expected,
      `${fixtureName} replay projection changed`
    );
  }
});

test('mia-laughed replay finishes with visible syntax', () => {
  const bundle = JSON.parse(
    fs.readFileSync(path.join(normalizedDir, 'mia-laughed.xbar.json'), 'utf8')
  );
  const snapshot = buildReplaySnapshotProjection(bundle);
  assert.ok(snapshot.stepCount > 0);
  assert.ok(snapshot.steps.at(-1)?.replayVisibleNodeIds.length > 0);
});


test('the question projection attaches at head movement rather than preceding its landing', () => {
  const bundle = JSON.parse(fs.readFileSync(path.join(normalizedDir, 'what-did-mia-see.xbar.json'), 'utf8'));
  const { steps } = buildReplaySnapshotProjection(bundle);
  const head = steps.findIndex(step => step.operation === 'auxiliary-head-movement');
  const phrase = steps.findIndex(step => step.operation === 'wh-movement');
  assert(head > phrase && phrase > 0);
  assert(!steps[phrase].replayVisibleNodeIds.includes('cbar_question'));
  assert(!steps[phrase].replayVisibleNodeIds.includes('c_question'));
  for (const id of ['cbar_question', 'c_question', 'did_terminal']) assert(steps[head].replayVisibleNodeIds.includes(id));
});
