import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildCorpusSnapshot } from '../scripts/replayCorpusSnapshot.mjs';
import { paintedShift } from '../replay/cameraCarry.ts';
import { TREE_SIBLING_GAP } from '../replay/treeSpacing.ts';
import { replayMotionFaults } from '../scripts/replayMotionContinuity.mjs';

// Saved analyses measured on the corpus gate's layout (the plaque job's measured
// coordinates at 1600x948), each at the step where the stage layout failed.
const root = fileURLToPath(new URL('../', import.meta.url));
const { analyses } = JSON.parse(await readFile(new URL('./data/stage-layout-regressions.json', import.meta.url), 'utf8'));
const { records } = await buildCorpusSnapshot(root, Object.entries(analyses).map(([bug, { source, ...input }]) =>
  ({ id: bug, input: { ...input, includePlayback: true }, expect: {} })), { width: 1600, height: 948, direction: 'ltr' });
const measured = Object.fromEntries(records.map(record => [record.id, record]));
// Frame numbers are 1-based, as Replay shows them.
const point = (bug, frame, id) => measured[bug].frames[frame - 1].points.find(entry => entry.id === id);
const faultsAt = (bug, frame) => replayMotionFaults(measured[bug]).filter(fault => fault.frame === frame && fault.distance >= 20);
// A node's motion into `frame`, after the camera carry of a stage crossing.
const motion = (bug, frame, id) => {
  const [before, after] = [frame - 1, frame].map(index => measured[bug].frames[index - 1]);
  const painted = entry => new Map(entry.points.map(item => [item.id, { x: item.x, y: item.y, parentId: item.parent }]));
  const carry = before.stage !== after.stage ? paintedShift(painted(before), painted(after)) : { x: 0, y: 0 };
  const a = point(bug, frame - 1, id), b = point(bug, frame, id);
  return Math.hypot(b.x - carry.x - a.x, b.y - carry.y - a.y);
};
const rowClearance = (bug, frame, ids) => Math.min(...ids.map(id => point(bug, frame, id)).flatMap(own =>
  measured[bug].frames[frame - 1].points.filter(other => !ids.includes(other.id) && Math.abs(other.y - own.y) < 1).map(other => Math.abs(other.x - own.x))));

test('the stage layouts were measured', () => {
  for (const record of records) assert.equal(record.error, undefined, `${record.id}: ${record.error}`);
});

test('Opus n3-75: the pro specifier stands a sibling unit from v′ before head movement, and nothing jumps when v moves', () => {
  assert.ok(point(15, 16, 'vbar').x - point(15, 16, 'pro1').x >= TREE_SIBLING_GAP - 1, 'v′/pro fork too tight at frame 16');
  assert.deepEqual(faultsAt(15, 17), []);
});

test('Opus n4-12: after the extraposition V′ closes on its sister NP ich at the movement itself', () => {
  assert.ok(point(18, 82, 'Vbar_gl').x - point(18, 82, 'NP_ich').x < 1000, 'V′ stands far from NP ich');
  assert.deepEqual(faultsAt(18, 81), []);
});

test('Opus n4-35: the new C head is built clear of the head that moves into it and stays put when it arrives', () => {
  assert.ok(rowClearance(21, 33, ['e_C', 'e_C::__leaf']) >= TREE_SIBLING_GAP - 1, 'ela built tight against Σ');
  assert.ok(motion(21, 34, 'e_C') <= 1, 'ela repositions at the head movement');
});

test('Sol n4-14: the parked temporal PP waits where it merges', () => {
  assert.ok(motion(27, 101, 'temporalPP') <= 1, 'the PP travels when it merges');
});

// The median travel into `frame`, after the carry, of the syntax painted in both
// frames under the same shared ancestors: what the camera audit's first paint reads.
const attachedTravel = (bug, frame) => {
  const [before, after] = [frame - 1, frame].map(index => measured[bug].frames[index - 1]);
  const painted = entry => new Map(entry.points.map(item => [item.id, { x: item.x, y: item.y, parentId: item.parent }]));
  const carry = before.stage !== after.stage ? paintedShift(painted(before), painted(after)) : { x: 0, y: 0 };
  const [a, b] = [before, after].map(entry => new Map(entry.points.map(item => [item.id, item])));
  const shared = new Set([...b.keys()].filter(id => a.has(id)));
  const lineage = (map, id) => { const out = []; for (let at = map.get(id).parent; at; at = map.get(at)?.parent) if (shared.has(at)) out.push(at); return out.join(' '); };
  const travel = [...shared].filter(id => lineage(a, id) === lineage(b, id))
    .map(id => Math.hypot(b.get(id).x - carry.x - a.get(id).x, b.get(id).y - carry.y - a.get(id).y)).sort((u, v) => u - v);
  return (travel[(travel.length - 1) >> 1] + travel[travel.length >> 1]) / 2;
};

test('Opus n4-21: closing the room 本を leaves does not jump the clause it stays attached in', () => {
  assert.ok(attachedTravel(30, 63) < 20, 'the attached syntax jumps when the object scrambles');
});

test('Sol n4-36: the book NP waits near where the relative clause merges with it', () => {
  assert.ok(faultsAt(32, 60).every(fault => fault.distance < 1000), 'the book NP jumps when it merges');
});
