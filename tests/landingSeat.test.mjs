import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadCorpusManifest } from '../scripts/replayCorpusInputs.mjs';
import { buildCorpusSnapshot } from '../scripts/replayCorpusSnapshot.mjs';
import { replayMotionFaults } from '../scripts/replayMotionContinuity.mjs';

// The Spanish subject that raises to Spec-IP (sol-spanish-qr, analysis 1), on the
// corpus gate's layout (1600x948). Frame numbers are 1-based; frame 33 is the
// subject's A-movement, the first frame of its stage, and frame 36 the object's
// Quantifier Raising, which adjoins a new IP segment below C.
const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = path.join(await mkdtemp(path.join(tmpdir(), 'landing-seat-')), 'manifest.json');
await writeFile(manifest, JSON.stringify({ schemaVersion: 1, records: [{ id: 'subject',
  source: path.join(root, 'fixtures/replay-regressions/sol-spanish-qr.json'), selector: '/analyses/1' }] }));
const { records: inputs } = await loadCorpusManifest(manifest);
const { records: [measured] } = await buildCorpusSnapshot(root, inputs.map(record => ({ id: record.id, input: record.input, expect: {} })),
  { width: 1600, height: 948, direction: 'ltr' });
const point = (frame, node) => measured.frames[frame - 1].points.find(item => item.id === node);

test('the fixture was measured', () => assert.equal(measured.error, undefined, measured.error));

// Una (D) and profesora's NP stood 525 apart all their lives. The phrase keeps
// that fork at the sibling gap from its first frame, source and landing alike.
test('a landing\'s head and host keep the sibling gap over the phrase\'s whole life', () => {
  const spans = measured.frames.flatMap((frame, index) => {
    const d = point(index + 1, 'sd'), np = point(index + 1, 'snp');
    return d && np ? [Math.round(np.x - d.x)] : [];
  });
  assert.ok(spans.length > 20);
  assert.deepEqual([...new Set(spans)], [375]);
});

// Seated beside the raised verb, the subject moves IP's centre less at its
// movement: 307 before, and the corpus gate's bound against main is 210.28.
test('a landing stands near enough its sister that the phrase above keeps its shape', () => {
  const ip = replayMotionFaults(measured).find(fault => fault.frame === 33 && fault.node === 'ip')?.distance ?? 0;
  assert.ok(ip < 210.28, `IP shape-motion ${ip}`);
});

// At the Quantifier Raising crossing everything under the new IP segment drops a
// row while C keeps its own. C stays where it stands and the new segment, with
// all it carries, stands nearer it: C jumped 1110 relative to the syntax the
// camera follows.
test('a leaf that keeps its row across a crossing stays, and its sister side stands nearer it', () => {
  const c = replayMotionFaults(measured).find(fault => fault.frame === 36 && fault.node === 'c')?.distance ?? 0;
  assert.ok(c < 600, `C unowned motion ${c}`);
  assert.ok(Math.abs(point(36, 'c').x - point(35, 'c').x) < 1e-6, 'C stays where it stands');
});
