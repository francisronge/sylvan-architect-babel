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
const { records } = await buildCorpusSnapshot(root, Object.entries(analyses).map(([bug, { source, provenance, ...input }]) =>
  ({ id: bug, input: { ...input, includePlayback: true }, expect: {} })), { width: 1600, height: 948, direction: 'ltr' });
const measured = Object.fromEntries(records.map(record => [record.id, record]));
// Frame numbers are 1-based, as Replay shows them.
const point = (bug, frame, id) => measured[bug].frames[frame - 1].points.find(entry => entry.id === id);
const faultsAt = (bug, frame) => replayMotionFaults(measured[bug]).filter(fault => fault.frame === frame && fault.distance >= 20);
// A node's motion into `frame`, after the camera carry of a stage crossing.
const motion = (bug, frame, id) => {
  const [before, after] = [frame - 1, frame].map(index => measured[bug].frames[index - 1]);
  const painted = entry => new Map(entry.points.map(item => [item.id, { x: item.x, y: item.y, parentId: item.parent }]));
  const carry = before.stage !== after.stage ? paintedShift(painted(before), painted(after), { closing: Boolean(after.closing) }) : { x: 0, y: 0 };
  const a = point(bug, frame - 1, id), b = point(bug, frame, id);
  return Math.hypot(b.x - carry.x - a.x, b.y - carry.y - a.y);
};
const rowClearance = (bug, frame, ids) => Math.min(...ids.map(id => point(bug, frame, id)).flatMap(own =>
  measured[bug].frames[frame - 1].points.filter(other => !ids.includes(other.id) && Math.abs(other.y - own.y) < 1).map(other => Math.abs(other.x - own.x))));

test('the stage layouts were measured', () => {
  for (const record of records) assert.equal(record.error, undefined, `${record.id}: ${record.error}`);
});

test('Opus n3-75: the pro specifier stands a sibling unit from v′ before head movement, and nothing jumps when v moves', () => {
  assert.ok(point(15, 14, 'vbar').x - point(15, 14, 'pro1').x >= TREE_SIBLING_GAP - 1, 'v′/pro fork too tight at frame 14');
  assert.deepEqual(faultsAt(15, 15), []);
});

test('Opus n4-12: after the extraposition V′ closes on its sister NP ich at the movement itself', () => {
  assert.ok(point(18, 70, 'Vbar_gl').x - point(18, 70, 'NP_ich').x < 1000, 'V′ stands far from NP ich');
  assert.deepEqual(faultsAt(18, 69), []);
});

test('Opus n4-35: the new C head is built clear of the head that moves into it and stays put when it arrives', () => {
  assert.ok(rowClearance(21, 26, ['e_C', 'e_C::__leaf']) >= TREE_SIBLING_GAP - 1, 'ela built tight against Σ');
  assert.ok(motion(21, 27, 'e_C') <= 1, 'ela repositions at the head movement');
});

test('Sol n4-14: the parked temporal PP waits where it merges', () => {
  assert.ok(motion(27, 84, 'temporalPP') <= 1, 'the PP travels when it merges');
});

// The median travel into `frame`, after the carry, of the syntax painted in both
// frames under the same shared ancestors: what the camera audit's first paint reads.
const attachedTravel = (bug, frame) => {
  const [before, after] = [frame - 1, frame].map(index => measured[bug].frames[index - 1]);
  const painted = entry => new Map(entry.points.map(item => [item.id, { x: item.x, y: item.y, parentId: item.parent }]));
  const carry = before.stage !== after.stage ? paintedShift(painted(before), painted(after), { closing: Boolean(after.closing) }) : { x: 0, y: 0 };
  const [a, b] = [before, after].map(entry => new Map(entry.points.map(item => [item.id, item])));
  const shared = new Set([...b.keys()].filter(id => a.has(id)));
  const lineage = (map, id) => { const out = []; for (let at = map.get(id).parent; at; at = map.get(at)?.parent) if (shared.has(at)) out.push(at); return out.join(' '); };
  const travel = [...shared].filter(id => lineage(a, id) === lineage(b, id))
    .map(id => Math.hypot(b.get(id).x - carry.x - a.get(id).x, b.get(id).y - carry.y - a.get(id).y)).sort((u, v) => u - v);
  return (travel[(travel.length - 1) >> 1] + travel[travel.length >> 1]) / 2;
};

test('Opus n4-21: closing the room 本を leaves does not jump the clause it stays attached in', () => {
  assert.ok(attachedTravel(30, 51) < 20, 'the attached syntax jumps when the object scrambles');
});

test('Sol n4-36: the book NP waits near where the relative clause merges with it', () => {
  assert.ok(faultsAt(32, 51).every(fault => fault.distance < 1000), 'the book NP jumps when it merges');
});

// An analysis with the lower occurrence keeping the source ID: the movement that
// opens a stage owns no more syntax than it would with the landing keeping that ID.
test('Codex c1-007, source ID kept at the lower occurrence: the ba-object movement opening stage 4 moves nothing it does not own', () => {
  const [before, after] = [48, 49].map(frame => measured['c1-007-source-kept'].frames[frame - 1]);
  assert.notEqual(before.stage, after.stage);
  assert.deepEqual(faultsAt('c1-007-source-kept', 49).filter(fault => fault.kind === 'unowned-motion'), []);
});

// The compound verb 寄给 waits in its V′ through stages 2 and 3 and then moves to
// Asp, leaving t_V under the source ID. Refining that V′ against the final tree,
// where only t_V stands, must not widen the room the verb waits beside, which
// t_V would then cross at the movement.
test('Codex c1-007, source ID kept at the lower occurrence: the compound verb waits beside its VP and V-to-Asp moves nothing it does not own', () => {
  const bug = 'c1-007-source-kept';
  assert.ok(point(bug, 46, 'lowerVP').x - point(bug, 46, 'sendGiveV').x < 1500, 'the waiting verb stands far from its VP');
  assert.deepEqual(faultsAt(bug, 47), []);
});

// The same saved analyses with every hop rewritten so the lower occurrence
// keeps the source ID: Replay lays them out as it lays out the landing-kept
// form above. In n4-12 the extraposed clause leaves CP_emb behind as its trace;
// in n4-14 the head traces keep the verbs' IDs while the PP waits.
test('Opus n4-12, source ID kept at the lower occurrence: V′ closes on NP ich at the extraposition, and nothing jumps when ich moves', () => {
  const bug = 'n4-12-source-kept';
  assert.ok(point(bug, 70, 'Vbar_gl').x - point(bug, 70, 'NP_ich').x < 1000, 'V′ stands far from NP ich');
  assert.deepEqual(faultsAt(bug, 69), []);
  assert.deepEqual(faultsAt(bug, 77), []);
});

test('Sol n4-14, source ID kept at the lower occurrence: the parked temporal PP waits where it merges', () => {
  assert.ok(motion('n4-14-source-kept', 84, 'temporalPP') <= 1, 'the PP travels when it merges');
});
