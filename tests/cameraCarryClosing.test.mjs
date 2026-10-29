import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as d3 from 'd3';
import { carriedShift, paintedShift } from '../replay/cameraCarry.ts';
import { buildCorpusSnapshot } from '../scripts/replayCorpusSnapshot.mjs';
import { replayMotionFaults } from '../scripts/replayMotionContinuity.mjs';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';

/* The camera carry of a stage crossing takes the median shift of the syntax the
 * crossing leaves in place. With an even count whose middle shifts differ, it
 * takes their midpoint, as on main, except where the stage plan's own closing
 * moves one side of a movement's room across that crossing: there it keeps the
 * block that holds still. The plan records those crossings (closesOnEntry), and
 * stage alignment (carriedShift) and the screen (paintedShift) read the same rule. */

// Three nodes hold still, two close by 150 and one by 60: the middle two shifts are -60 and 0.
const shifts = { a: 0, b: 0, c: 0, d: -150, e: -150, f: -60 };
const before = new Map(Object.keys(shifts).map((id, index) => [id, { x: index * 100, y: 100, parentId: null }]));
const after = new Map(Object.entries(shifts).map(([id, dx], index) => [id, { x: index * 100 + dx, y: 100, parentId: null }]));
const hierarchy = points => {
  const root = d3.hierarchy({ id: 'root', children: Object.keys(shifts).map(id => ({ id })) });
  return new Map(root.children.map(node => { const point = points.get(node.data.id); node.x = point.x; node.y = point.y; return [node.data.id, node]; }));
};

test('a tied crossing without a closing keeps the midpoint, in both carries', () => {
  assert.deepEqual(paintedShift(before, after), { x: -30, y: 0 });
  assert.deepEqual(carriedShift(hierarchy(before), hierarchy(after)), { x: -30, y: 0 });
});

test('a tied crossing the plan closed at keeps the block that holds still, in both carries', () => {
  assert.deepEqual(paintedShift(before, after, { closing: true }), { x: 0, y: 0 });
  assert.deepEqual(carriedShift(hierarchy(before), hierarchy(after), { closing: true }), { x: 0, y: 0 });
});

const root = fileURLToPath(new URL('../', import.meta.url));
const { analyses } = JSON.parse(await readFile(new URL('./data/stage-layout-regressions.json', import.meta.url), 'utf8'));
const holdout = loadFixtureAnalyses().records.find(entry => entry.id === 'movement/holdout-transitions.json#/0').record;
const { records } = await buildCorpusSnapshot(root, [
  { id: 'n4-12', input: { ...(({ source, ...input }) => input)(analyses[18]), includePlayback: true }, expect: {} },
  { id: 'holdout', input: { ...holdout, includePlayback: true }, expect: {} }
], { width: 1600, height: 948, direction: 'ltr' });
const measured = Object.fromEntries(records.map(record => [record.id, record]));
const painted = frame => new Map(frame.points.map(point => [point.id, { x: point.x, y: point.y, parentId: point.parent }]));
// Frame numbers are 1-based, as Replay shows them.
const crossing = (id, frame) => [measured[id].frames[frame - 2], measured[id].frames[frame - 1]];

test('Arabic holdout: the tied crossing into frame 34 has no closing and keeps the midpoint carry', () => {
  const [from, to] = crossing('holdout', 34);
  assert.notEqual(from.stage, to.stage);
  assert.equal(to.closing, undefined, 'the plan records no closing at this crossing');
  const midpoint = paintedShift(painted(from), painted(to)), tie = paintedShift(painted(from), painted(to), { closing: true });
  assert.ok(Math.abs(midpoint.x - tie.x) > 100, 'the crossing is tied');
  assert.equal(midpoint.x, -22.5);
});

test('Opus n4-12: the plan records its closing at the crossing into frame 81, and the carry it reads keeps the motion rule clean', () => {
  const [from, to] = crossing('n4-12', 81);
  assert.notEqual(from.stage, to.stage);
  assert.equal(to.closing, true, 'the plan records the closing at this crossing');
  const faults = record => replayMotionFaults(record).filter(fault => fault.frame === 81 && fault.distance >= 20);
  assert.deepEqual(faults(measured['n4-12']), []);
  const unrecorded = { ...measured['n4-12'], frames: measured['n4-12'].frames.map(({ closing, ...frame }) => frame) };
  assert.ok(faults(unrecorded).length, 'without the record the midpoint carry jumps the attached syntax');
});
