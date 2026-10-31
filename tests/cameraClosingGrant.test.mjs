import assert from 'node:assert/strict';
import test from 'node:test';
import { checkFirstPaintContinuity } from './helpers/cameraInvariants.mjs';
import { CAMERA_VIEWPORTS, traceCamera } from './helpers/cameraTrace.mjs';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import { prepareVisualRecord } from './helpers/visualFrames.mjs';

/* The camera audit counts syntax that a movement step's own closing moves (the
 * closing Francis approved on 25 October 2026: "yes, the closing the gap is
 * alright.") as moved. The grant only excuses: other syntax that jumps is still
 * reported, and a grant never raises the median the rule reads. */

const pose = { x: 0, y: 0, k: 1 };
const frame = (positions, closing) => ({ stage: 0, nodes: new Map(Object.entries(positions)
  .map(([id, x]) => [id, { x, y: 100, ancestors: ['root'] }]).concat([['root', { x: 300, y: 0, ancestors: [] }]])), closing });
const trace = (before, after) => ({ canvas: { width: 2000, height: 1000 }, frames: [before, after],
  passes: [{ name: 'forward', steps: [{ from: 0, to: 1, before: pose, first: pose, settled: pose }] }] });
const jumps = value => checkFirstPaintContinuity(value).filter(finding => finding.subtype.startsWith('jump:')).map(finding => finding.measure);

const still = { a: 100, b: 200 }, side = { c: 400, d: 500, e: 600 };
const closed = Object.fromEntries(Object.entries(side).map(([id, x]) => [id, x - 150]));

test('a closing side that is most of the tree is not a first-paint jump', () => {
  assert.deepEqual(jumps(trace(frame({ ...still, ...side }), frame({ ...still, ...closed }, new Set(Object.keys(side))))), []);
});

test('the same motion without the closing grant is a jump', () => {
  // Three of the six attached nodes moving 150 px: a median of 75 px.
  assert.deepEqual(jumps(trace(frame({ ...still, ...side }), frame({ ...still, ...closed }))), [75]);
});

test('syntax outside the closing that jumps is still reported', () => {
  const after = frame({ ...closed, a: 160, b: 260, c: 460 }, new Set(['d', 'e']));
  assert.deepEqual(jumps(trace(frame({ ...still, ...side }), after)), [60]);
});

test('a grant never raises the median the rule reads', () => {
  // Without the grant the median is 15 px; read only over the two that moved it would be 30.
  const after = frame({ a: 100, b: 200, c: 430, d: 530 }, new Set(['a', 'b']));
  assert.deepEqual(jumps(trace(frame({ a: 100, b: 200, c: 400, d: 500 }), after)), []);
});

test('Arabic relative: the audit grants the movement step its closing and would report it without', () => {
  const record = loadFixtureAnalyses().records.find(entry => entry.id === 'movement/holdout-transitions.json#/6').record;
  const real = traceCamera(prepareVisualRecord(record), CAMERA_VIEWPORTS.find(entry => entry.name === 'desktop'), { reversals: false });
  const forward = { ...real, passes: real.passes.filter(pass => pass.name === 'forward') };
  assert(real.frames[13].closing.size > 0, 'the movement closes the gap it leaves');
  assert.deepEqual(checkFirstPaintContinuity(forward).filter(finding => finding.frame === '13>14'), []);
  const ungranted = { ...forward, frames: forward.frames.map(entry => ({ ...entry, closing: undefined })) };
  assert(checkFirstPaintContinuity(ungranted).some(finding => finding.frame === '13>14' && finding.subtype === 'jump:relayout'));
});
