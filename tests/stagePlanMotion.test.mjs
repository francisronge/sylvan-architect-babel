import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { getNodeId } from '../replay/displayIdentity.ts';
import { motionFrame, replayMotionFaults } from '../replay/motionContinuity.ts';
import { layoutMeasuredScenes, prepareVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';

// Stage planning chooses between its established, aligned and slotted plans by
// the Replay motion rule over each plan's painted frames, as the screen shows
// them. These committed analyses each had one plan without the deformation the
// established plan painted, which the earlier planner's own measure could not see.
const paintedFaults = record => {
  const { scenes } = layoutMeasuredScenes(prepareVisualRecord(record), VIEWPORTS[0]);
  return replayMotionFaults({ frames: scenes.map(scene => ({ ...motionFrame(scene.step, scene.nodes, getNodeId),
    relationIndex: scene.step.replayRelationIdentity?.relationIndex })) });
};
const fixture = (file, index) => JSON.parse(fs.readFileSync(new URL(`../fixtures/${file}`, import.meta.url))).cases[index];

test('a clitic-doubled predicate keeps its shape while the clitic and its double are built', () => {
  // Τον είδα τον Γιάννη. The established plan bent the adjectival predicate at frames 17 and 24.
  assert.deepEqual(paintedFaults(fixture('showcase/relatives-and-clitics.json', 2)).map(({ frame, node, kind }) => `${frame}:${node}:${kind}`), []);
});

test('a VP keeps its shape across the relation step that holds a plaque pocket', () => {
  // The established plan bent the VP 65.6 units at frame 30.
  assert.deepEqual(paintedFaults(fixture('replay-regressions/plaque-hold-pockets.json', 3)).map(({ frame, node, kind }) => `${frame}:${node}:${kind}`), []);
});
