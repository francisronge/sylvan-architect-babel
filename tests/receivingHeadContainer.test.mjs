import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { getNodeId } from '../replay/displayIdentity.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { motionFrame, replayMotionFaults } from '../scripts/replayMotionContinuity.mjs';
import { checkAttachAtMerge, checkNoEarlyReveal, checkStageCompletion } from './helpers/replayInvariants.mjs';
import { layoutMeasuredScenes, prepareVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';
import { canonicalId } from './helpers/canonicalIds.mjs';

// A receiving head that keeps its id as the new head complex's container gains
// a new inner head at the movement (Sol, Cantonese 佢食咗飯未呀？: Asp⁰
// "aspect" becomes [v, aspect-suffix]). That inner head arrives with the
// movement, so the completed stage shows it and no later step reveals it.
const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/receiving-head-container.json', import.meta.url)));

test('receiving-head-container.json: a retained receiving head shows its new inner head at the movement', () => {
  const replay = prepareReplay({ ...structuredClone(record), includePlayback: true });
  const steps = replay.playbackSteps, lower = canonicalId(replay, 'verb-trace', 1);
  const moment = steps.findIndex(step => step.replayKind === 'relation' && (step.replayRelationLinks ?? [])
    .some(link => link.renderFamily === 'trajectory' && link.priorSourceNodeId === 'v' && link.witnessNodeId === lower));
  assert.ok(moment > 0, 'the head movement has its moment');
  assert.ok(!steps[moment - 1].replayVisibleNodeIds.includes('aspect-suffix'), 'the inner head waits for the movement');
  assert.ok(steps[moment].replayVisibleNodeIds.includes('aspect-suffix'), 'the movement shows the inner head');
  const violations = [...checkStageCompletion(replay, record), ...checkNoEarlyReveal(replay), ...checkAttachAtMerge(replay)];
  assert.deepEqual(violations.map(violation => `${violation.rule} ${violation.frame} ${violation.detail}`), []);
});

// Asp′ keeps its children [aspect, vp] through the movement, so Asp⁰ has no
// reason to move within it: the fork before the movement already holds the slot
// the head complex is centred on.
test('receiving-head-container.json: the receiving head keeps its place in its unchanged fork at the movement', () => {
  const visual = prepareVisualRecord(structuredClone(record));
  const frames = layoutMeasuredScenes(visual, VIEWPORTS[0]).scenes.map(scene => ({
    ...motionFrame(scene.step, scene.nodes, getNodeId), relationIndex: scene.step.replayRelationIdentity?.relationIndex
  }));
  const moment = frames.findIndex(frame => frame.kind === 'relation' && frame.links.includes('verb-trace'));
  assert.ok(moment > 0, 'the head movement has its moment');
  const offset = index => {
    const point = id => frames[index].points.find(item => item.id === id);
    return point('aspect').x - point('aspbar').x;
  };
  assert.ok(Math.abs(offset(moment) - offset(moment - 1)) <= 1,
    `Asp⁰ stands at the same place under Asp′ (${offset(moment - 1).toFixed(1)} before, ${offset(moment).toFixed(1)} at the movement)`);
  assert.deepEqual(replayMotionFaults({ frames }).map(fault => `${fault.frame} ${fault.kind} ${fault.node}`), []);
});
