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
