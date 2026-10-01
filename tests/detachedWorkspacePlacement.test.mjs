import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import { buildStageLayoutGroups, stageTreeLayoutSize } from '../replay/stageCamera.ts';

const word = id => ({ id, label: 'X', word: id });
const branch = (id, children) => ({ id, label: 'XP', children });
const stage = workspaceForest => ({ statement: 'Build.', stageRecord: 'Current syntax.', relations: [], workspaceForest });
const first = () => branch('p', [word('a'), word('b')]);
const wrapped = () => branch('p', [branch('bar', [word('a'), word('b')])]);
const stages = () => [[word('a'), word('b'), word('late')], [first(), word('late')],
  [wrapped(), word('late')], [branch('q', [word('late'), wrapped()])]].map(stage);
const compile = derivationStages => prepareReplay({ sentence: 'a b late', derivationStages, includePlayback: true });

function componentOrder(result) {
  const step = result.playbackSteps.find(step => step.replayFrameIndex === 0 && step.replayKind === 'macro');
  assert.equal(step.replayCanvasData.replayOrigin?.kind, 'workspace');
  return step.replayCanvasData.children.map(child => child.id);
}

test('detached placement looks through an intervening projection without changing selection order', () => {
  const input = stages(), original = structuredClone(input), result = compile(input);
  assert.deepEqual(componentOrder(result), ['late', 'p']);
  const selects = result.playbackSteps.filter(step => step.replayFrameIndex === 0 && step.operation === 'LexicalSelect');
  assert.deepEqual(selects.map(step => step.targetNodeId), ['a::__leaf', 'b::__leaf', 'late::__leaf']);
  for (const step of result.playbackSteps.filter(step => step.replayFrameIndex === 0)) {
    for (const id of ['p', 'bar', 'q']) assert(!step.replayVisibleNodeIds.includes(id), `${id} must remain unbuilt`);
  }
  assert.deepEqual(input, original);
});

for (const [name, change] of [
  ['relocation outside the first parent', input => { input[2].workspaceForest = [branch('p', [word('b')]), word('a'), word('late')]; }],
  ['a duplicate future occurrence', input => { input[3].workspaceForest[0].children.unshift(word('late')); }]
]) test(`${name} cannot supply the earlier detached placement`, () => {
  const input = stages(); change(input);
  assert.deepEqual(componentOrder(compile(input)), ['p', 'late']);
});

test('internal sibling changes do not reverse a separate component or leak future syntax', () => {
  const input = stages();
  input[2].workspaceForest[0] = branch('p', [branch('bar', [word('b'), word('a')])]);
  const original = structuredClone(input), result = compile(input);
  assert.deepEqual(componentOrder(result), ['late', 'p']);
  const firstStage = result.playbackSteps.filter(step => step.replayFrameIndex === 0);
  const group = firstStage.at(-1).replayCanvasData.children.find(child => child.id === 'p');
  assert.deepEqual(group.children.map(child => child.id), ['a', 'b'], 'only the outside placement comes from the later attachment');
  assert(firstStage.every(step => !step.replayVisibleNodeIds.includes('bar')));
  assert.deepEqual(input, original);
});

const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/reviewed-construction.json', import.meta.url)))
  .cases.find(entry => entry.reviewNumber === 25);
const result = prepareReplay({ ...record, includePlayback: true });
const groups = buildStageLayoutGroups(result.playbackSteps, result.replayDerivationFrames);
for (const [width, height] of [[1596, 1016], [390, 844]]) for (const direction of ['ltr', 'rtl']) {
  test(`modal frame 20 to 21, ${width}px ${direction}: the detached head stays on its eventual side`, () => {
    assert.equal(result.playbackSteps.length, 29);
    for (const frame of [20, 21]) {
      const step = result.playbackSteps[frame - 1];
      const tree = d3.hierarchy(step.replayCanvasData); applyVizIds(tree);
      const size = stageTreeLayoutSize(result.playbackSteps, step.replayFrameIndex, width, height, groups);
      layoutSyntaxTree(tree, size, direction,
        buildStageCoordinateReservations(result.playbackSteps, step.replayFrameIndex, size).get(step.replayCanvasData),
        new Set(step.replayVisibleNodeIds));
      const find = id => tree.descendants().find(node => getNodeId(node) === id);
      assert(direction === 'ltr' ? find('must').x < find('leave').x : find('must').x > find('leave').x);
      assert(!step.replayVisibleNodeIds.includes('tBarMatrix'), 'the modal has not merged yet');
    }
    assert.equal(result.playbackSteps[20].targetNodeId, 'tpInf');
  });
}

const arabic = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/reviewed-construction.json', import.meta.url)))
  .cases.find(entry => entry.reviewNumber === 30);
const arabicResult = prepareReplay({ ...arabic, includePlayback: true });
const arabicGroups = buildStageLayoutGroups(arabicResult.playbackSteps, arabicResult.replayDerivationFrames);
for (const [width, height] of [[1596, 1016], [390, 844]]) for (const direction of ['ltr', 'rtl']) {
  test(`Arabic loose Neg starts on its eventual outside edge, ${width}px ${direction}`, () => {
    assert.equal(arabicResult.playbackSteps.length, 31);
    for (const step of arabicResult.playbackSteps) {
      if (!step.replayVisibleNodeIds.includes('negA')) continue;
      const tree = d3.hierarchy(step.replayCanvasData); applyVizIds(tree);
      const size = stageTreeLayoutSize(arabicResult.playbackSteps, step.replayFrameIndex, width, height, arabicGroups);
      const visible = new Set(step.replayVisibleNodeIds);
      layoutSyntaxTree(tree, size, direction,
        buildStageCoordinateReservations(arabicResult.playbackSteps, step.replayFrameIndex, size).get(step.replayCanvasData), visible);
      const nodes = tree.descendants().filter(node => visible.has(getNodeId(node)));
      const neg = nodes.find(node => getNodeId(node) === 'negA');
      for (const node of nodes.filter(node => ['subjA', 'tenseA', 'lightA', 'vWordA', 'themeA'].includes(getNodeId(node)))) {
        assert(direction === 'rtl' ? neg.x > node.x : neg.x < node.x,
          `${step.replayFrameIndex}: Neg must not start among future clause members`);
      }
      if (step.replayFrameIndex < 6) assert(!visible.has('negPA'), 'future attachment must remain invisible');
    }
  });
}
