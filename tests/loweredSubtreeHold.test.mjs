import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { carryReference } from '../replay/cameraCarry.ts';
import { buildCorpusSnapshot } from '../scripts/replayCorpusSnapshot.mjs';
import { loadCorpusManifest } from '../scripts/replayCorpusInputs.mjs';
import { replayMotionFaults } from '../scripts/replayMotionContinuity.mjs';

// Stage crossings that insert a parent above an existing subtree (an
// extraposition's new IP over the matrix IP), where the next stage lays the
// lowered subtree out again sideways and the camera, holding too few nodes,
// follows it, so the sister head jumps. Measured on the corpus gate's layout
// (1600x948); main 870b6d4 jumps the head by the distance named.
const root = fileURLToPath(new URL('../', import.meta.url));
const cases = [
  { id: 'clause-context/2', source: 'fixtures/movement/clause-context.json', selector: '/cases/2', frame: 55, node: 'matrixC', main: 573.67 },
  { id: 'turkish-embedded', source: 'fixtures/performance/turkish-embedded.json', selector: '', frame: 89, node: 'b-mc', main: 683.6 }
];
const manifest = path.join(mkdtempSync(path.join(tmpdir(), 'lowered-hold-')), 'manifest.json');
writeFileSync(manifest, JSON.stringify({ schemaVersion: 1, records: cases.map(({ id, source, selector }) =>
  ({ id, source: path.join(root, source), selector })) }));
const { records } = await buildCorpusSnapshot(root, (await loadCorpusManifest(manifest)).records, { width: 1600, height: 948, direction: 'ltr' });

for (const { id, frame, node, main } of cases) test(`${id}: the head beside the lowered subtree jumps less at frame ${frame}`, () => {
  const record = records.find(entry => entry.id === id);
  assert.ok(record && !record.error, `${id}: ${record?.error ?? 'not measured'}`);
  const jump = replayMotionFaults(record).find(fault => fault.frame === frame && fault.node === node)?.distance ?? 0;
  assert.ok(jump < 0.6 * main, `${node} at ${frame} moves ${jump.toFixed(1)} (main ${main})`);
});

test('the camera holds a lone sister when the lowered subtree beside it keeps its place', () => {
  // C stays; IP, lowered under a new IP', keeps its words' x and drops a row.
  const before = new Map([['CP', { x: 100, y: 0, parentId: null }], ['C', { x: 0, y: 100, parentId: 'CP' }],
    ['IP', { x: 200, y: 100, parentId: 'CP' }], ['NP', { x: 150, y: 200, parentId: 'IP' }], ['I', { x: 250, y: 200, parentId: 'IP' }]]);
  const after = new Map([['CP', { x: 150, y: 0, parentId: null }], ['C', { x: 0, y: 100, parentId: 'CP' }],
    ['IPx', { x: 300, y: 100, parentId: 'CP' }], ['IP', { x: 200, y: 200, parentId: 'IPx' }], ['CP2', { x: 400, y: 200, parentId: 'IPx' }],
    ['NP', { x: 150, y: 300, parentId: 'IP' }], ['I', { x: 250, y: 300, parentId: 'IP' }]]);
  assert.deepEqual(carryReference(before, after), ['C']);
  // Laid out sideways instead, the lowered words still decide, as before.
  const sideways = new Map([...after].map(([id, point]) => [id, ['IP', 'NP', 'I'].includes(id) ? { ...point, x: point.x - 300 } : point]));
  assert.notDeepEqual(carryReference(before, sideways), ['C']);
});
