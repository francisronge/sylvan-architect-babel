import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { buildStageCameraBounds, buildStageLayoutGroups, stageTreeLayoutSize } from '../replay/stageCamera.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';

const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/review-final-framing.json', import.meta.url)))
  .cases.find(record => record.key === 'holdout/mandarin-negative-relative/0');
for (const [width, height] of [[1600, 1100], [390, 844]]) for (const direction of ['ltr', 'rtl']) {
  test(`${width}px ${direction}: completed Replay releases old movement positions while containing every current node`, () => {
    const replay = prepareReplay({ ...record, includePlayback: true }), steps = replay.playbackSteps;
    const last = steps.at(-1), layoutGroups = buildStageLayoutGroups(steps, replay.replayDerivationFrames);
    const input = { steps, stageIndex: last.replayFrameIndex, completedCanvas: last.replayCanvasData,
      plan: null, width, height, direction, layoutGroups, includeOverlays: false };
    const stage = buildStageCameraBounds(input), final = buildStageCameraBounds({ ...input, stepIndex: steps.length - 1 });
    assert(final.maxX - final.minX < (stage.maxX - stage.minX) * .8, 'completed fit releases substantial unused source space');
    const sizeFor = index => stageTreeLayoutSize(steps, index, width, height, layoutGroups);
    const coordinates = buildStageCoordinateReservations(steps, last.replayFrameIndex, sizeFor(last.replayFrameIndex), sizeFor, direction).get(last.replayCanvasData);
    const root = d3.hierarchy(last.replayCanvasData); applyVizIds(root);
    const visible = new Set(last.replayVisibleNodeIds);
    const tree = layoutSyntaxTree(root, sizeFor(last.replayFrameIndex), direction, coordinates, visible);
    for (const node of tree.descendants().filter(node => visible.has(getNodeId(node)))) {
      assert(node.x >= final.minX && node.x <= final.maxX);
      assert(node.y >= final.minY && node.y <= final.maxY);
    }
    assert.deepEqual(buildStageCameraBounds(input), stage, 'the construction stage retains its original common fit');
  });
}
