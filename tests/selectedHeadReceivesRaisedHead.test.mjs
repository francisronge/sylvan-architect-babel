import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { checkFirstPaintContinuity } from './helpers/cameraInvariants.mjs';
import { CAMERA_VIEWPORTS, traceCamera } from './helpers/cameraTrace.mjs';
import { layoutMeasuredScenes, prepareVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';
import { canonicalId } from './helpers/canonicalIds.mjs';

// Stage 6 selects a silent Foc head beside the finite clause mTP, which waits as
// its own workspace from stage 5. T-to-Foc movement then builds the landing from
// the raised mTComplex and that head and attaches mTP below the new mFocCore.
// The phrase the head leaves must keep its place at that moment; only the moved
// head, its landing and the selected head that receives it may move.
const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/selected-head-receives-raised-head.json', import.meta.url)));
const visual = prepareVisualRecord(record);
const steps = visual.prepared.playbackSteps;
// Stage 6's ids as Replay names them: the raised head the model let keep "mTComplex".
const id = name => canonicalId(visual.prepared, name, 5);
const moment = steps.findIndex(step => step.replayKind === 'relation' && step.targetNodeId === id('mTComplex') && step.replayFrameIndex === 5);

test('selected-head-receives-raised-head.json: the waiting clause keeps its place when its head raises to the selected head', () => {
  assert(moment > 0 && steps[moment - 1].replayFrameIndex === 5 && steps[moment - 1].operation === 'LexicalSelect',
    'the movement directly follows the selection of its receiving head');
  const { scenes } = layoutMeasuredScenes(visual, VIEWPORTS.find(viewport => viewport.name === 'desktop'));
  const before = scenes[moment - 1].nodes, after = scenes[moment].nodes;
  // The movement's own occurrences: its landing and the selected head that
  // receives it, and its lower occurrence, which the moment turns into its trace
  // (authored as the new "mTTrace", so main compared it nowhere either).
  const landing = new Set([id('mTComplex'), id('mFocHead'), id('mTTrace')]);
  for (const id of landing) after.get(id).each(node => landing.add(node.data.id));
  const moved = [...after].filter(([id, node]) => before.has(id) && !landing.has(id) && id !== 'mTP'
    && Math.hypot(node.x - before.get(id).x, node.y - before.get(id).y) > 1e-6).map(([id]) => id);
  assert.deepEqual(moved, [], 'only the landing moves, and mTP recentres over its new daughters');
  // The selected head stands on the side of the clause it joins.
  assert(before.get('mFocHead').x < before.get('mvDomain').x);
  assert(after.get('mFocHead').x < after.get('mTP').x);
});

test('selected-head-receives-raised-head.json: no first-paint jump at the head movement in any camera viewport', () => {
  for (const viewport of CAMERA_VIEWPORTS) {
    const trace = traceCamera(visual, viewport, { reversals: false });
    const jumps = checkFirstPaintContinuity(trace).filter(finding => finding.subtype.startsWith('jump:'));
    assert.deepEqual(jumps, [], viewport.name);
  }
});
