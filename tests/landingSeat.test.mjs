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
// corpus gate's layout (1600x948). Frame numbers are 1-based; frame 28 is the
// subject's A-movement, the first frame of its stage, and frame 31 the object's
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

// Una (D) and profesora's NP stand at the normal layout's spacing all their
// lives: a seat never narrows a fork inside the landing (Francis, 31 Oct 2026).
test('a landing keeps its own shape', () => {
  const spans = measured.frames.flatMap((frame, index) => {
    const d = point(index + 1, 'sd'), np = point(index + 1, 'snp');
    return d && np ? [Math.round(np.x - d.x)] : [];
  });
  assert.ok(spans.length > 20);
  assert.deepEqual([...new Set(spans)], [525]);
});

// From the subject's A-movement on, no node of the landed subject stands nearer
// a node of its row than ordinary sisters stand (375, centre to centre).
test('a landing never stands nearer its neighbours than ordinary sisters', () => {
  const landing = measured.frames.findIndex(frame => frame.points.some(item => item.id === 'sh'));
  assert.ok(landing > 0, 'the subject lands');
  for (let index = landing; index < measured.frames.length; index++) {
    const points = measured.frames[index].points, inside = new Set(['sh']);
    for (let grown = true; grown;) {
      grown = false;
      for (const item of points) if (item.parent && inside.has(item.parent) && !inside.has(item.id)) { inside.add(item.id); grown = true; }
    }
    const above = new Set();
    for (let id = 'sh'; id; id = points.find(item => item.id === id)?.parent) above.add(id);
    for (const a of points.filter(item => inside.has(item.id)))
      for (const b of points.filter(item => !inside.has(item.id) && !above.has(item.id) && Math.abs(item.y - a.y) < 1e-6))
        assert.ok(Math.abs(b.x - a.x) >= 375 - 1e-6, `frame ${index + 1}: ${a.id} ${Math.round(Math.abs(b.x - a.x))} from ${b.id}`);
  }
});

// At the Quantifier Raising crossing everything under the new IP segment drops a
// row while C keeps its own. C stays where it stands and the new segment, with
// all it carries, stands nearer it: C jumped 1110 relative to the syntax the
// camera follows.
test('a leaf that keeps its row across a crossing stays, and its sister side stands nearer it', () => {
  const c = replayMotionFaults(measured).find(fault => fault.frame === 31 && fault.node === 'c')?.distance ?? 0;
  assert.ok(c < 600, `C unowned motion ${c}`);
  assert.ok(Math.abs(point(31, 'c').x - point(30, 'c').x) < 1e-6, 'C stays where it stands');
});
