import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadCorpusManifest } from '../scripts/replayCorpusInputs.mjs';
import { buildCorpusSnapshot } from '../scripts/replayCorpusSnapshot.mjs';
import { replayMotionFaults } from '../scripts/replayMotionContinuity.mjs';

// Fixtures measured on the corpus gate's layout (1600x948), each at the movement
// where a waiting source or receiving host stood where the movement then moved
// its parent (retainMovementSourceSlots). Frame numbers are 1-based.
const root = fileURLToPath(new URL('../', import.meta.url));
const cases = {
  source: { source: 'fixtures/movement/source-occurrence-ownership.json', selector: '/1' },
  tense: { source: 'fixtures/replay-regressions/unrendered-head-movement.json', selector: '' },
  question: { source: 'fixtures/replay-regressions/shared-landing-source.json', selector: '' },
};
const manifest = path.join(await mkdtemp(path.join(tmpdir(), 'waiting-slots-')), 'manifest.json');
await writeFile(manifest, JSON.stringify({ schemaVersion: 1, records: Object.entries(cases)
  .map(([id, record]) => ({ id, source: path.join(root, record.source), selector: record.selector })) }));
const { records: inputs } = await loadCorpusManifest(manifest);
const { records } = await buildCorpusSnapshot(root, inputs.map(record => ({ id: record.id, input: record.input, expect: {} })),
  { width: 1600, height: 948, direction: 'ltr' });
const measured = Object.fromEntries(records.map(record => [record.id, record]));
const fault = (id, frame, node) => replayMotionFaults(measured[id]).find(item => item.frame === frame && item.node === node)?.distance ?? 0;
const x = (id, frame, node) => measured[id].frames[frame - 1].points.find(point => point.id === node).x;

test('the fixtures were measured', () => {
  for (const record of records) assert.equal(record.error, undefined, `${record.id}: ${record.error}`);
});

// The expletive keeps its ID around its new trace. It waits at that trace's slot
// from its selection, so its departure moves nothing in IP.
test('a source that keeps its ID around its lower occurrence waits at that occurrence\'s slot', () => {
  assert.ok(Math.abs(x('source', 30, 'subjectLow') - x('source', 31, 'subjectLow')) < 1, 'the expletive slot moves at its departure');
  assert.deepEqual(replayMotionFaults(measured.source).filter(item => item.frame === 31 && item.distance >= 20), []);
});

// When the honorific head leaves its phrase, that phrase recentres left; tense,
// which its new head complex wraps, no longer waits in the complex's slot, which
// would move I′ the whole of half that recentring.
test('a receiving host does not wait where its wrapper moves the parent farther', () => {
  assert.ok(fault('tense', 37, 'inflectionBar') < 88, `I′ shape-motion ${fault('tense', 37, 'inflectionBar')}`);
});

// The interrogative C waits as its own workspace; its complex forms far to the
// left of it once the auxiliary arrives. It waits nearer that slot, so C′ moves less.
test('a receiving host waiting as its own workspace waits nearer the slot that keeps its parent still', () => {
  assert.ok(fault('question', 42, 'matrixCBar') < 157, `C′ shape-motion ${fault('question', 42, 'matrixCBar')}`);
});
