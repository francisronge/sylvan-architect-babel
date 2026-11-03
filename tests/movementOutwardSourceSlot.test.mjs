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

// A lower occurrence whose own slot stands farther out than its source would
// pull their parent outward at the movement, and the clauses above it with it.
// The source waits in that slot from its first frame instead, where that clears,
// no completed tree or forest grows wider and the Replay then moves less, with no
// motion new or larger. The finished tree keeps its layout.
for (const size of [[1440, 900], [390, 844]]) {
  test(`${size[0]}px: a moved theme waits in its lower occurrence's farther slot`, () => {
    // Before: vbar and vp deformed at the theme's A-movement (frame 23).
    assert.deepEqual(shapeFaults(fixture('movement/independent-infl-context.json'), size).filter(id => id.startsWith('23:')), []);
  });
  test(`${size[0]}px: a raised auxiliary waits in its lower occurrence's farther slot`, () => {
    // Before: didLow and matrixTBase deformed at T-to-C movement (frame 42).
    assert.deepEqual(shapeFaults(fixture('replay-regressions/compact-current-root.json', 'cases', 0), size).filter(id => id.startsWith('42:')), []);
  });
}
