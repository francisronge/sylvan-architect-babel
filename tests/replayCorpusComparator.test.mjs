import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadCorpusManifest, compareCorpusSnapshots, selectRecord } from '../scripts/replayCorpusInputs.mjs';
import { buildCorpusSnapshot } from '../scripts/replayCorpusSnapshot.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = path.join(root, 'fixtures/replay-corpus/manifest.json');
const corpus = await loadCorpusManifest(manifestPath);
const records = corpus.records.filter(record => ['spanish-head-and-ordinary-wrapper',
  'tier2-witness-persistence', 'malformed-exact-with-independent-verdict'].includes(record.id));
const snapshot = await buildCorpusSnapshot(root, records, { width: 1600, height: 948, direction: 'ltr' });
const compare = candidate => compareCorpusSnapshots(snapshot, candidate, records);
const faults = results => results.flatMap(record => record.violations.map(fault => fault.kind));

test('the maintained fixture controls exercise a real movement, ordinary construction, persistence and malformed exact claim', () => {
  assert(snapshot.identity.sources.some(([name]) => name === 'replay/workspaceComponentLifetime.ts'));
  assert(snapshot.identity.sources.some(([name]) => name === 'package-lock.json'));
  assert.equal(snapshot.records.some(record => record.error), false);
  assert.deepEqual(faults(compare(structuredClone(snapshot))), []);
  assert.equal(snapshot.records[0].evidence.movementMoments, 1,
    'later persisted trajectory links must not be counted as fresh movement moments');
  assert(snapshot.records[0].evidence.merges > 0);
  assert(snapshot.records[1].evidence.planStages[1].facets.includes('identity.occurrences'));
  assert(!snapshot.records[1].evidence.planStages[2].facets.includes('identity.occurrences'));
  assert(snapshot.records[2].evidence.planStages[0].fallbackRelations.includes(0));
  assert(snapshot.records[2].evidence.planStages[0].facets.includes('judgment.verdict'));
});

test('a stretched completed branch and displaced final point fail while an earlier corrected point is reviewable', () => {
  const corrected = structuredClone(snapshot);
  corrected.records[0].frames[0].points[0].x -= 20;
  const accepted = compare(corrected);
  assert.deepEqual(faults(accepted), []);
  assert.equal(accepted[0].changedFrames.length, 1);
  const stretched = structuredClone(snapshot), frame = stretched.records[0].frames.at(-1);
  frame.widths[0].width += 200;
  frame.points[0].x += 200;
  const rejected = compare(stretched);
  assert(faults(rejected).includes('completed-width-growth'));
  assert(faults(rejected).includes('final-coordinate-change'));
  assert.notDeepEqual(rejected[0].finalCoordinates.before, rejected[0].finalCoordinates.after);
});

test('semantic, authored, continuity, finite-geometry and witness-control failures cannot become a clean comparison', () => {
  const bad = structuredClone(snapshot), record = bad.records[0];
  record.replaySha256 = 'changed Replay'; record.planSha256 = 'changed plan';
  record.authoredAfterSha256 = 'mutated authored state'; record.inputSha256 = 'different input';
  record.continuity.push({ index: 1, rootId: 'i_v', kind: 'unowned-component-motion' });
  record.invalid.push({ frame: 2, id: 'i_v', kind: 'nonfinite' });
  record.expectationFailures.push('a required persistent drawing disappeared');
  assert.deepEqual(new Set(faults(compare(bad))), new Set(['input-mismatch', 'authored-mutation', 'replay-change',
    'relation-plan-change', 'new-continuity-fault', 'invalid-geometry', 'mechanism-control-failed']));
});

test('JSON pointers and legacy private-index paths resolve exactly without evaluating selectors', () => {
  const document = { attempts: [{ normalizedRecord: { response: { analyses: [{ value: 'selected' }] } } }], 'a/b': { '~key': 3 } };
  assert.equal(selectRecord(document, 'attempts[0].normalizedRecord.response.analyses[0]').value, 'selected');
  assert.equal(selectRecord(document, '/a~1b/~0key'), 3);
  assert.throws(() => selectRecord(document, 'attempts[0];process.exit()'), /Invalid selector/);
  assert.throws(() => selectRecord(document, '/attempts/9'), /does not resolve/);
});

test('the actual CLI retains evidence and exits nonzero when a required control fails', async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'babel-corpus-test-'));
  try {
    const original = JSON.parse(await readFile(manifestPath, 'utf8'));
    const record = original.records.find(record => record.id === 'tier2-witness-persistence');
    record.source = path.resolve(path.dirname(manifestPath), record.source);
    const manifest = path.join(scratch, 'manifest.json'), output = path.join(scratch, 'report.json');
    await writeFile(manifest, JSON.stringify({ records: [record] }));
    const args = [path.join(root, 'scripts/compareReplayCorpus.mjs'), '--baseline-root', root, '--candidate-root', root,
      '--manifest', manifest, '--output', output];
    execFileSync(process.execPath, args, { timeout: 30000, stdio: 'pipe' });
    const good = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(good.ok, true); assert.equal(good.summary.analyses, 1);
    assert.equal(good.baseline.sha256, good.candidate.sha256);
    assert.equal(good.records[0].rawSha256, records[1].rawSha256);
    record.expect.facets[1].present = false;
    await writeFile(manifest, JSON.stringify({ records: [record] }));
    const failed = spawnSync(process.execPath, args, { timeout: 30000, encoding: 'utf8' });
    assert.equal(failed.status, 1, failed.stderr);
    const bad = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(bad.ok, false);
    assert.equal(bad.records[0].violations[0].kind, 'mechanism-control-failed');
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
