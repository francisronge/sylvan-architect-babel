import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  canonicalFrame, compareSnapshots, describeComparison, frameRanges, readSnapshot
} from './helpers/layoutSnapshot.mjs';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import { prepareVisualRecord, snapshotVisualRecord } from './helpers/visualFrames.mjs';

const SNAPSHOT = readSnapshot(fileURLToPath(new URL('../fixtures/replay-snapshots/fixture-layout.json', import.meta.url)));
const SAMPLE = ['normalized/what-did-mia-see.xbar.json#/analyses/0', 'replay-regressions/visual-human-catalog.json#/cases/5/analyses/0'];
const RECORDS = new Map(loadFixtureAnalyses().records.map(({ id, record }) => [id, record]));
const snapshotOf = record => snapshotVisualRecord(prepareVisualRecord(record));

// npm run verify:visual-offline checks every fixture; these keep a quick local proof.
test('committed fingerprints match a movement analysis and a plaque-heavy analysis', () => {
  for (const id of SAMPLE) assert.deepEqual(snapshotOf(RECORDS.get(id)), SNAPSHOT[id], id);
});

test('a changed word or relation changes the fingerprint where it shows', () => {
  const id = SAMPLE[0], record = RECORDS.get(id), before = SNAPSHOT[id];
  assert.match(JSON.stringify(record.derivationStages.at(-1).workspaceForest), /"Mia"/, 'the control word is in the final stage');
  const reword = { ...record, sentence: record.sentence.replace('Mia', 'Miabella'),
    derivationStages: JSON.parse(JSON.stringify(record.derivationStages).replaceAll('"Mia"', '"Miabella"')) };
  const { changed: [words] } = compareSnapshots({ [id]: before }, { [id]: snapshotOf(reword) });
  assert.ok(words.frames.length && words.canopy, 'a wider word moves frames and the Canopy');

  const unrelated = structuredClone(record);
  unrelated.derivationStages.at(-1).relations = [];
  const { changed: [relations] } = compareSnapshots({ [id]: before }, { [id]: snapshotOf(unrelated) });
  assert.ok(relations.tiers.removed.length && !relations.tiers.added.length, 'removed relations leave the tier list');
  assert.notDeepEqual(relations.frameCount[0], relations.frameCount[1], 'their Replay moments leave the frame list');
});

test('rounding noise and painting order do not count; a hundredth of a unit does', () => {
  const frame = { zoom: 0.5, chrome: { canvas: { x: 0, y: 0, width: 10, height: 10 } }, plaques: [], lines: [],
    texts: [{ id: 'b', boxes: [{ x: 1, y: 2, width: 3, height: 4 }] }, { id: 'a', boxes: [{ x: 5, y: 6, width: 7, height: 8 }] }] };
  const shifted = by => ({ ...frame, texts: [{ ...frame.texts[0], boxes: [{ ...frame.texts[0].boxes[0], x: 1 + by }] }, frame.texts[1]] });
  assert.equal(canonicalFrame(frame), canonicalFrame({ ...frame, texts: [...frame.texts].reverse() }));
  assert.equal(canonicalFrame(frame), canonicalFrame(shifted(0.004)));
  assert.notEqual(canonicalFrame(frame), canonicalFrame(shifted(0.01)));
  assert.notEqual(canonicalFrame(frame), canonicalFrame({ ...frame, zoom: 0.51 }));
  assert.notEqual(canonicalFrame(frame, { heading: 'Merge' }), canonicalFrame(frame, { heading: 'Move' }));
});

test('a comparison names changed frames, tiers and analyses', () => {
  const before = { a: { frames: 'x1 x2 x3 x4 x5', canopy: 'c', tiers: ['0:0 T1 node-plaque', '0:1 T3 fallback'] },
    b: { frames: 'y1', canopy: 'c', tiers: [] }, gone: { frames: 'z', canopy: null, tiers: [] } };
  const after = { a: { frames: 'x1 q2 q3 x4 x5 q6', canopy: 'c', tiers: ['0:0 T2 node-plaque', '0:1 T3 fallback'] },
    b: { frames: 'y1', canopy: 'c', tiers: [] }, fresh: { frames: 'n', canopy: null, tiers: [] } };
  const comparison = compareSnapshots(before, after);
  assert.deepEqual(comparison.changed, [{ id: 'a', frames: [2, 3, 6], frameCount: [5, 6], canopy: false,
    tiers: { removed: ['0:0 T1 node-plaque'], added: ['0:0 T2 node-plaque'] } }]);
  assert.deepEqual([comparison.added, comparison.removed], [['fresh'], ['gone']]);
  assert.deepEqual(compareSnapshots(before, after, { complete: false }).removed, []);
  assert.deepEqual(describeComparison(comparison).slice(0, 4),
    ['  a', '    frames 2–3, 6 (was 5 frames, now 6)', '    - 0:0 T1 node-plaque', '    + 0:0 T2 node-plaque']);
  assert.equal(frameRanges([1, 2, 3, 7, 9, 10]), '1–3, 7, 9–10');
});
