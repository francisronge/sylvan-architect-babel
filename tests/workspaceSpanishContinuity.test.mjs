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

const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/workspace-spanish-continuity.json', import.meta.url)));
const original = JSON.stringify(record);

for (const [width, height] of [[1600, 1100], [390, 844]]) for (const direction of ['ltr', 'rtl']) {
  const replay = prepareReplay({ ...record, includePlayback: true });
  const steps = replay.playbackSteps, frames = new Map();
  const groups = buildStageLayoutGroups(steps, replay.replayDerivationFrames);
  const sizeFor = stage => stageTreeLayoutSize(steps, stage, width, height, groups);
  const frame = number => {
    if (frames.has(number)) return frames.get(number);
    const step = steps[number - 1], size = sizeFor(step.replayFrameIndex);
    const root = d3.hierarchy(step.replayCanvasData); applyVizIds(root);
    const visible = new Set(step.replayVisibleNodeIds);
    const coordinates = buildStageCoordinateReservations(steps, step.replayFrameIndex, size, sizeFor, direction).get(step.replayCanvasData);
    const tree = layoutSyntaxTree(root, size, direction, coordinates, visible);
    const nodes = new Map(tree.descendants().filter(node => visible.has(getNodeId(node))
      && !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace').map(node => [getNodeId(node), node]));
    frames.set(number, { step, nodes }); return frames.get(number);
  };

  for (const [beforeFrame, afterFrame, rootId] of [[10, 11, 'b_embPred'], [32, 33, 'b_matrixPred']]) {
    test(`${width}px ${direction}: Spanish selection ${afterFrame} preserves the complete existing predicate`, () => {
      const before = frame(beforeFrame), after = frame(afterFrame);
      assert.equal(after.step.operation, 'LexicalSelect');
      const component = visibleComponentNodes(before.nodes.get(rootId), before.nodes);
      assert(component.length >= 10);
      for (const node of component) {
        const id = getNodeId(node), next = after.nodes.get(id);
        assert(next, `${id} remains visible`);
        assert(Math.hypot(node.x - next.x, node.y - next.y) < 1e-6, `${id} moves at ${beforeFrame}→${afterFrame}`);
      }
      assert.equal(JSON.stringify(record), original);
    });
  }

  test(`${width}px ${direction}: Spanish movement preserves the preceding full source and sister ranks`, () => {
    for (const [beforeFrame, afterFrame, source, landing] of [
      [8, 9, 'b_vengaLow', 'b_vengaAtv'], [30, 31, 'b_quieroLow', 'b_quieroAtv']
    ]) {
      const before = frame(beforeFrame), after = frame(afterFrame);
      assert(!before.nodes.has(landing));
      assert(after.nodes.has(landing));
      assert(!before.nodes.get(source).data.silent);
      assert(after.nodes.get(source).data.silent);
      assert.equal(after.nodes.get(`${landing}::__leaf`).data.word, before.nodes.get(`${source}::__leaf`).data.word);
      for (const parent of before.nodes.values()) {
        const children = (parent.children ?? []).filter(child => before.nodes.has(getNodeId(child)));
        if (children.length < 2) continue;
        assert(Math.max(...children.map(node => node.y)) - Math.min(...children.map(node => node.y)) < 1e-6,
          `${getNodeId(parent)} has unequal sister ranks before movement`);
      }
      const from = before.nodes.get(source), to = after.nodes.get(landing);
      assert(Math.hypot(to.x - from.x, to.y - from.y) > 1, 'actual head movement remains visible');
    }
    assert.equal(JSON.stringify(record), original);
  });
}
