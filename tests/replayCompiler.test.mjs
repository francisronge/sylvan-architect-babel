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


test('wh-movement authored first waits for the head movement that builds the C′ its landing attaches to', () => {
  const bundle = JSON.parse(fs.readFileSync(path.join(normalizedDir, 'what-did-mia-see.xbar.json'), 'utf8'));
  const { steps } = buildReplaySnapshotProjection(bundle);
  const head = steps.findIndex(step => step.operation === 'auxiliary-head-movement');
  const phrase = steps.findIndex(step => step.operation === 'wh-movement');
  assert(phrase === head + 1 && head > 0, 'wh-movement plays right after the head movement');
  for (const id of ['cbar_question', 'c_question', 'did_terminal']) {
    assert(!steps[head - 1].replayVisibleNodeIds.includes(id));
    assert(steps[head].replayVisibleNodeIds.includes(id));
  }
  for (const id of ['cp_question', 'dp_what_high', 'what_low']) {
    assert(!steps[head].replayVisibleNodeIds.includes(id), `${id} waits for wh-movement`);
    assert(steps[phrase].replayVisibleNodeIds.includes(id));
  }
});
