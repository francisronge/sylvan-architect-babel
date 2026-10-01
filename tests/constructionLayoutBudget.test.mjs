import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { stageTreeLayoutSize, treeLayoutSize } from '../replay/stageCamera.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';

const node = (id, children = []) => ({ id, label: 'XP', children });
const forest = children => ({ id: 'workspace', label: '', replayOrigin: { kind: 'workspace' }, children });
const step = (replayCanvasData, replayKind) => ({ replayFrameIndex: 0, replayCanvasData, replayKind });

test('a temporary construction forest does not add a node to a completed single-tree budget', () => {
  const a = node('a'), b = node('b'), inner = node('inner', [a]), outer = node('outer', [inner, b]);
  const steps = [step(forest([inner, node('outer', [b])]), 'micro'), step(outer, 'macro')];
  assert.deepEqual(stageTreeLayoutSize(steps, 0, 100, 100), treeLayoutSize(4, 2, 100, 100));
});

test('genuine completed workspace forests retain their existing layout budget', () => {
  const canvas = forest([node('a'), node('b', [node('c')])]);
  const steps = [step(canvas, 'micro'), step(canvas, 'macro')];
  assert.deepEqual(stageTreeLayoutSize(steps, 0, 100, 100), treeLayoutSize(4, 2, 100, 100));
});

test('an unfinished sequence without a completed stage keeps its original forest budget', () => {
  const canvas = forest([node('a'), node('b')]);
  assert.deepEqual(stageTreeLayoutSize([step(canvas, 'micro')], 0, 100, 100), treeLayoutSize(3, 1, 100, 100));
});

test('review #8 preserves its completed layout dimensions after retaining the earlier IP branch', () => {
  const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/adjunct-attachment-continuity.json', import.meta.url)));
  const steps = prepareReplay({ ...record, includePlayback: true }).playbackSteps;
  const completed = d3.hierarchy(steps.at(-1).replayCanvasData);
  assert.equal(completed.descendants().length, 44);
  assert.equal(d3.hierarchy(steps[51].replayCanvasData).descendants().length, 45,
    'the construction canvas needs a synthetic container while the wrapper is unbuilt');
  for (const [width, height] of [[1600, 1100], [390, 844]]) {
    assert.deepEqual(stageTreeLayoutSize(steps, 4, width, height),
      treeLayoutSize(44, completed.height, width, height));
  }
});

test('a shallow pending wrapper cannot compress an unchanged deeper sister in the completed tree', () => {
  const syntax = (id, children = [], word) => ({ id, label: 'XP', children, ...(word ? { word } : {}) });
  const deep = syntax('deep', [syntax('d1', [syntax('d2', [syntax('d3', [], 'one')])])]);
  const shallow = syntax('shallow', [syntax('v', [], 'two')]);
  const stage = workspaceForest => ({ statement: 'Extend a shallow branch.',
    stageRecord: 'The deep branch is unchanged.', relations: [], workspaceForest });
  const record = { sentence: 'one two too', derivationStages: [
    stage([syntax('p', [deep, shallow])]),
    stage([syntax('p', [deep, syntax('wrapper', [shallow, syntax('adj', [], 'too')])])])
  ] };
  const steps = prepareReplay({ ...record, includePlayback: true }).playbackSteps;
  const final = steps.at(-1), finalRoot = d3.hierarchy(final.replayCanvasData);
  assert(steps.some(step => step.replayFrameIndex === 1
    && d3.hierarchy(step.replayCanvasData).height > finalRoot.height),
  'the temporary forest has one extra container level');
  for (const [width, height] of [[1600, 1100], [390, 844]]) for (const direction of ['ltr', 'rtl']) {
    const sizeFor = stage => stageTreeLayoutSize(steps, stage, width, height);
    const size = sizeFor(1);
    const reservations = buildStageCoordinateReservations(steps, 1, size, sizeFor, direction);
    const expected = buildStageCoordinateReservations([final], 1, size);
    const actual = reservations.get(final.replayCanvasData);
    for (const node of finalRoot.descendants()) {
      assert.equal(actual.get(node.data.id).y, expected.get(final.replayCanvasData).get(node.data.id).y,
        `${node.data.id} keeps the completed tree's vertical geometry`);
    }
  }
});

for (const [width, height] of [[1600, 1100], [390, 844]]) for (const direction of ['ltr', 'rtl']) {
  test(`review #8, ${width}px ${direction}: a pending adjunct wrapper adds no early branch rank`, () => {
    const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/adjunct-attachment-continuity.json', import.meta.url)));
    const steps = prepareReplay({ ...record, includePlayback: true }).playbackSteps;
    const sizeFor = stage => stageTreeLayoutSize(steps, stage, width, height);
    const positions = frame => {
      const step = steps[frame - 1], size = sizeFor(step.replayFrameIndex);
      const reservations = buildStageCoordinateReservations(steps, step.replayFrameIndex, size, sizeFor, direction);
      const root = d3.hierarchy(step.replayCanvasData); applyVizIds(root);
      const visible = new Set(step.replayVisibleNodeIds);
      return new Map(layoutSyntaxTree(root, size, direction, reservations.get(step.replayCanvasData), visible)
        .descendants().filter(node => visible.has(getNodeId(node))).map(node => [getNodeId(node), node]));
    };
    for (const frame of [43, 51, 52, 55]) {
      const nodes = positions(frame);
      assert.equal(nodes.get('subjB').y, nodes.get('ibarB').y, `frame ${frame}: current sisters share one rank`);
    }
    const previous = positions(51), before = positions(55), after = positions(56);
    for (const [id, point] of previous) {
      assert.equal(before.get(id).x, point.x, `${id} keeps its x across the construction boundary`);
      assert.equal(before.get(id).y, point.y, `${id} keeps its y across the construction boundary`);
    }
    const dy = after.get('ibarB').y - before.get('ibarB').y;
    assert(dy > 0, 'the new wrapper adds its level only at the merge');
    for (const node of before.get('ibarB').descendants()) {
      assert(Math.abs(after.get(getNodeId(node)).y - node.y - dy) < 1e-8,
        'the existing predicate translates as a whole and preserves its internal branch lengths');
    }
  });
}
