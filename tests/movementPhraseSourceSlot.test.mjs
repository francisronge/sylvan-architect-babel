import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import * as d3 from '../node_modules/d3/src/index.js';
import { prepareReplay } from '../replay/prepareReplay.ts';
import * as coordinates from '../replay/stageCoordinates.ts';
import * as camera from '../replay/stageCamera.ts';
import * as layout from '../replay/treeLayout.ts';
import * as display from '../replay/displayIdentity.ts';
import { layoutReplayFrames } from '../scripts/replayFrameLayout.mjs';
import { motionFrame, replayMotionFaults } from '../scripts/replayMotionContinuity.mjs';

const fixture = (file, ...path) => path.reduce((value, key) => value[key],
  JSON.parse(fs.readFileSync(new URL(`../fixtures/${file}`, import.meta.url))));
const shapeFaults = (analysis, [width, height]) => {
  const { playbackSteps: steps } = prepareReplay({ ...analysis, includePlayback: true });
  const { scenes } = layoutReplayFrames({ steps, stages: analysis.derivationStages, width, height, direction: 'ltr' },
    { coordinates, camera, layout, display, d3 });
  return replayMotionFaults({ frames: scenes.map(scene => motionFrame(scene.step, scene.nodes, display.getNodeId)) })
    .filter(fault => fault.kind === 'shape-motion').map(fault => `${fault.frame}:${fault.node}`);
};

// A complete phrase that moves away waits, from its first frame, in the smaller
// slot its lower occurrence takes, so its parent and the clause above keep
// their shape at the movement. Planning keeps that slot only where the Replay
// then moves less, with no motion new or larger anywhere.
for (const size of [[1440, 900], [390, 844]]) {
  test(`${size[0]}px: a moving subject phrase waits in its lower occurrence's slot`, () => {
    // Before: subjectLow, externalArgumentStructure and perfect deformed at the
    // subject's Internal Merge (frame 30).
    assert.deepEqual(shapeFaults(fixture('movement/restated-chains.json', 2), size), []);
  });
  test(`${size[0]}px: a wh phrase that leaves keeps its clause's shape at its movement`, () => {
    // Before: whMatrixV and the clause above it deformed at frame 43.
    assert.deepEqual(shapeFaults(fixture('replay-regressions/compact-current-root.json', 'cases', 0), size).filter(id => id.startsWith('43:')), []);
  });
}
