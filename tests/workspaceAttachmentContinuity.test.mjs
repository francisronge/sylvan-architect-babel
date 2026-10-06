import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import { buildStageLayoutGroups, stageTreeLayoutSize } from '../replay/stageCamera.ts';
import { visibleComponentNodes } from '../replay/visibleComponent.ts';
import { measureCategoryText, measureTreeInk } from './helpers/treeFontMetrics.mjs';

const { cases } = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/workspace-attachment-continuity.json', import.meta.url)));
for (const record of cases) for (const [width, height] of [[1600, 1100], [390, 844]]) for (const direction of ['ltr', 'rtl']) {
  test(`${width}px ${direction}: a completed clause retains its shape when another projection adopts it`, () => {
    const original = JSON.stringify(record), replay = prepareReplay({ ...record, includePlayback: true });
    const steps = replay.playbackSteps, groups = buildStageLayoutGroups(steps, replay.replayDerivationFrames);
    const sizeFor = stage => stageTreeLayoutSize(steps, stage, width, height, groups);
    const frame = number => {
      const step = steps[number - 1], size = sizeFor(step.replayFrameIndex), visible = new Set(step.replayVisibleNodeIds);
      const root = d3.hierarchy(step.replayCanvasData); applyVizIds(root);
      const coordinates = buildStageCoordinateReservations(steps, step.replayFrameIndex, size, sizeFor, direction,
        measureCategoryText, measureTreeInk).get(step.replayCanvasData);
      return new Map(layoutSyntaxTree(root, size, direction, coordinates, visible).descendants()
        .filter(node => visible.has(getNodeId(node))).map(node => [getNodeId(node), node]));
    };
    const before = frame(record.boundary.before), after = frame(record.boundary.after);
    const oldRoot = before.get(record.boundary.root), nextRoot = after.get(record.boundary.root);
    assert.equal(steps[record.boundary.after - 1].operation, 'ExternalMerge');
    assert.equal(getNodeId(nextRoot.parent), record.boundary.parent);
    const members = visibleComponentNodes(oldRoot, before); assert(members.length > 20);
    for (const node of members) {
      const next = after.get(getNodeId(node)); assert(next);
      assert(Math.hypot(next.x - nextRoot.x - (node.x - oldRoot.x), next.y - nextRoot.y - (node.y - oldRoot.y)) < 1e-6,
        `${getNodeId(node)} keeps its position within the unchanged clause`);
    }
    assert.equal(JSON.stringify(record), original);
  });
}
