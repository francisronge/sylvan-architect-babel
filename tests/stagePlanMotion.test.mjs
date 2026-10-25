import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { getNodeId } from '../replay/displayIdentity.ts';
import { motionFrame, replayMotionFaults } from '../replay/motionContinuity.ts';
import { layoutMeasuredScenes, prepareVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';

// Stage planning chooses between its established, aligned and slotted plans by
// the Replay motion rule over each plan's painted frames, as the screen shows
// them, with the camera carry at each stage crossing.
const paintedFaults = record => {
  const { scenes } = layoutMeasuredScenes(prepareVisualRecord(record), VIEWPORTS[0]);
  return replayMotionFaults({ frames: scenes.map(scene => ({ ...motionFrame(scene.step, scene.nodes, getNodeId),
    relationIndex: scene.step.replayRelationIdentity?.relationIndex })) });
};

test('a complementizer waiting across a stage crossing stays still as the next stage opens', () => {
  // Nobody saw anything. The established plan's stage 3 does not meet stage 4,
  // so the waiting complementizer jumped 663.8 units at frame 23.
  const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/waiting-complementizer-stage-crossing.json', import.meta.url)));
  assert.deepEqual(paintedFaults(record).map(({ frame, node, kind }) => `${frame}:${node}:${kind}`), []);
});
