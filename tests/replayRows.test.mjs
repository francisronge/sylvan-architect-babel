import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import * as d3 from '../node_modules/d3/src/index.js';
import { prepareReplay } from '../replay/prepareReplay.ts';
import * as coordinates from '../replay/stageCoordinates.ts';
import * as camera from '../replay/stageCamera.ts';
import * as layout from '../replay/treeLayout.ts';
import * as display from '../replay/displayIdentity.ts';
import * as canvas from '../replay/replayCanvas.ts';
import { layoutReplayFrames } from '../scripts/replayFrameLayout.mjs';

// 我昨天看见的那个人走了。: at frame 36, 昨天 joins under a new T above the
// matrix TP. The phrase under the new T is the larger side of that insertion,
// so it keeps its rows and the syntax above it rises; 我, a separate piece the
// step does not touch, and 昨天, waiting at the row it merges at, keep theirs.
const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/waiting-root-continuity.json', import.meta.url)));

for (const [width, height] of [[1440, 900], [390, 844]]) for (const direction of ['ltr', 'rtl']) {
  test(`${width}px ${direction}: a parent inserted above the larger side lets the smaller side rise`, () => {
    const steps = prepareReplay({ ...record, includePlayback: true }).playbackSteps;
    const { scenes } = layoutReplayFrames({ steps, stages: record.derivationStages, width, height, direction },
      { coordinates, camera, layout, display, d3, canvas });
    const y = (frame, id) => scenes[frame - 1].nodes.get(id)?.y;
    for (const id of ['matrixTP', 'matrixT', 'matrixVP', 'subjectHigher', 'see', 'topic', 'yesterday'])
      assert.equal(y(36, id), y(35, id), `${id} keeps its row at the insertion`);
    for (const id of ['matrixClause', 'le']) assert(y(36, id) < y(35, id), `${id}, above the new parent, rises`);
    for (const id of ['topic', 'yesterday']) for (let frame = 31; frame < 36; frame++)
      assert.equal(y(frame + 1, id), y(frame, id), `${id} keeps its row from frame ${frame} to ${frame + 1}`);
  });
}
