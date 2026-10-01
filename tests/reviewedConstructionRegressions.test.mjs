import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { stageTreeLayoutSize, buildStageLayoutGroups } from '../replay/stageCamera.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';

const cases = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/reviewed-construction.json', import.meta.url))).cases;
const compiled = new Map();
function replay(number) {
  if (!compiled.has(number)) {
    const record = cases.find(entry => entry.reviewNumber === number);
    const original = structuredClone(record);
    const result = prepareReplay({ ...record, includePlayback: true });
    assert.deepEqual(record, original, 'regression compilation must not alter the saved analysis');
    compiled.set(number, { ...result, groups: buildStageLayoutGroups(result.playbackSteps, result.replayDerivationFrames) });
  }
  return compiled.get(number);
}
function positions(number, frame, width = 1596, height = 1016, direction = number === 30 ? 'rtl' : 'ltr') {
  const { playbackSteps: steps, groups } = replay(number), step = steps[frame - 1];
  const tree = d3.hierarchy(step.replayCanvasData); applyVizIds(tree);
  const size = stageTreeLayoutSize(steps, step.replayFrameIndex, width, height, groups);
  const visible = new Set(step.replayVisibleNodeIds);
  layoutSyntaxTree(tree, size, direction,
    buildStageCoordinateReservations(steps, step.replayFrameIndex, size,
      index => stageTreeLayoutSize(steps, index, width, height, groups), direction).get(step.replayCanvasData), visible);
  return new Map(tree.descendants().filter(node => visible.has(getNodeId(node))).map(node => [getNodeId(node), node]));
}

for (const [number, before, after, id, reference] of [
  [8, 28, 29, 'a', 'chegou']
]) test(`entry ${number}, frames ${before}–${after}: ${id} keeps its place relative to ${reference}`, () => {
  const a = positions(number, before), b = positions(number, after);
  for (const nodes of [a, b]) for (const key of [id, reference]) assert(nodes.has(key), `${key} must be visible`);
  const oldDistance = a.get(id).x - a.get(reference).x, newDistance = b.get(id).x - b.get(reference).x;
  assert(Math.abs(newDistance - oldDistance) < 0.01, `relative x changed from ${oldDistance} to ${newDistance}; camera transforms are excluded`);
  for (const key of [id, reference]) assert.deepEqual(
    { x: b.get(key).x, y: b.get(key).y }, { x: a.get(key).x, y: a.get(key).y },
    `${key} retains both coordinates at the stage boundary`);
});

test('entry 24, frames 22–25: the D and N of the students have equal sibling heights', () => {
  for (const frame of [22, 23, 24, 25]) {
    const nodes = positions(24, frame), d = nodes.get('dStudents'), n = nodes.get('nStudents');
    assert(d && n);
    assert.equal(d.parent.data.id, n.parent.data.id);
    assert.equal(d.depth, n.depth);
    assert.equal(d.y, n.y, `frame ${frame}: same-depth siblings differ`);
  }
});

test('entry 21: CP attachment beneath the retained V prime precedes adjunct merge', () => {
  const steps = replay(21).playbackSteps;
  assert.equal(steps.length, 44, 'retained VP context does not gain another merge frame');
  const stage = steps.filter(step => step.replayFrameIndex === 2);
  const cpAttach = stage.findIndex(step => step.replayKind === 'micro' && step.targetNodeId === 'mVbarCore');
  const adjunct = stage.findIndex(step => step.replayKind === 'micro' && step.targetNodeId === 'mVbar');
  assert(cpAttach >= 0, 'the CP attachment has no construction step');
  assert(adjunct > cpAttach);
  const find = (node, id) => node.id === id ? node : node.children?.map(child => find(child, id)).find(Boolean);
  const beforeAdjunction = stage[cpAttach], afterAdjunction = stage[adjunct];
  assert.equal(find(beforeAdjunction.replayCanvasData, 'cP').label, 'CP', 'the saved node label, not its ID, identifies CP');
  assert.deepEqual(find(beforeAdjunction.replayCanvasData, 'mVbarCore').children.map(child => child.id), ['mV', 'cP']);
  assert.deepEqual(find(beforeAdjunction.replayCanvasData, 'mVP').children.map(child => child.id), ['mLow', 'mVbarCore']);
  assert.equal(beforeAdjunction.replayVisibleNodeIds.includes('mVbar'), false, 'the adjunct wrapper is still unbuilt');
  assert.deepEqual(find(afterAdjunction.replayCanvasData, 'mVP').children.map(child => child.id), ['mLow', 'mVbar']);
  assert.equal(stage.some(step => step.replayKind === 'micro' && step.targetNodeId === 'mVP'), false, 'the retained VP is not recreated');
  for (const step of stage.slice(cpAttach, adjunct + 1)) {
    for (const id of ['mVP', 'mLow', 'mVbarCore']) assert(step.replayVisibleNodeIds.includes(id), 'existing VP context remains visible');
  }
});

for (const [width, height] of [[1596, 1016], [390, 844]]) for (const direction of ['ltr', 'rtl']) {
  test(`entry 25, ${width}px ${direction}: the infinitival fork is not stretched before its subject arrives`, () => {
    const before = positions(25, 22, width, height, direction);
    const after = positions(25, 23, width, height, direction);
    assert(!before.has('tBarInf'));
    assert(after.has('tBarInf'));
    assert.equal(before.get('tpInf').y, after.get('tBarInf').y);
    assert(Math.abs(before.get('tpInf').x - after.get('tBarInf').x) < 1e-8);
    for (const node of before.get('tpInf').descendants().slice(1)) {
      const next = after.get(getNodeId(node));
      assert(next, 'existing daughters survive the new projection');
      assert.equal(node.y, next.y, 'the earlier fork shortens without moving its daughters');
      assert.equal(node.x, next.x);
    }
  });
  test(`entry 21, ${width}px ${direction}: frame 37 does not reserve an unbuilt V prime rank`, () => {
    const before = positions(21, 37, width, height, direction);
    const after = positions(21, 38, width, height, direction);
    const parent = before.get('mVP'), subject = before.get('mLow'), predicate = before.get('mVbarCore');
    assert.equal(subject.parent, parent);
    assert.equal(predicate.parent, parent);
    assert.equal(predicate.y, subject.y, 'the current VP daughters must share a rank');
    assert.equal(after.get('mVbar').y, after.get('mLow').y, 'the built wrapper occupies that rank');
    assert.equal(before.has('mVbar'), false, 'the reserved parent remains invisible');
    const dy = after.get('mVbarCore').y - predicate.y;
    assert(dy > 0, 'the new wrapper adds its level only when built');
    for (const node of predicate.descendants()) {
      const next = after.get(getNodeId(node));
      assert(next, 'the existing subtree survives wrapper insertion');
      assert(Math.abs(next.y - node.y - dy) < 1e-8, 'the subtree translates without stretching its branches');
    }
  });
}

for (const number of [8, 21, 24, 25, 30]) for (const [width, height] of [[1596, 1016], [390, 844]]) {
  test(`entry ${number}, ${width}px: all construction scenes keep ordered siblings and downward branches`, () => {
    for (let frame = 1; frame <= replay(number).playbackSteps.length; frame++) {
      const nodes = positions(number, frame, width, height);
      for (const node of nodes.values()) {
        if (node.data.replayOrigin?.kind === 'workspace') continue;
        const children = (node.children ?? []).filter(child => nodes.has(getNodeId(child)));
        for (const child of children) assert(child.y > node.y, `${frame}: ${getNodeId(node)} → ${getNodeId(child)}`);
        for (let i = 1; i < children.length; i++) {
          assert(number === 30 ? children[i].x < children[i - 1].x : children[i].x > children[i - 1].x,
            `${frame}: ${getNodeId(node)} authored child order`);
        }
      }
    }
  });
}

test('entry 24: subject movement preserves the authored lower DP after its words move to the higher occurrence', () => {
  const record = cases.find(entry => entry.reviewNumber === 24);
  const find = (node, id) => node.id === id ? node : node.children?.map(child => find(child, id)).find(Boolean);
  const inForest = (forest, id) => forest.map(root => find(root, id)).find(Boolean);
  const originalLower = inForest(record.derivationStages[0].workspaceForest, 'dpStudentsBase');
  const authoredLower = inForest(record.derivationStages[1].workspaceForest, 'dpStudentsBase');
  assert.deepEqual(originalLower.children.map(child => child.id), ['dStudents', 'nStudents']);
  assert.deepEqual(authoredLower.children, []);
  assert.equal(authoredLower.silent, true);
  assert.equal(authoredLower.word, undefined);
  const steps = replay(24).playbackSteps;
  const movementIndex = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1
    && step.replayRelationIdentity.relationIndex === 0);
  assert.equal(movementIndex + 1, 19);
  assert.deepEqual(find(steps[movementIndex - 1].replayCanvasData, 'dpStudentsBase').children.map(child => child.id),
    ['dStudents', 'nStudents'], 'the full source remains until the movement moment');
  for (const step of steps.slice(movementIndex)) {
    const lower = find(step.replayCanvasData, 'dpStudentsBase');
    assert.ok(lower && step.replayVisibleNodeIds.includes('dpStudentsBase'), 'the lower DP label remains visible');
    assert.equal(lower.label, 'DP');
    assert.equal(lower.silent, true);
    assert.equal(lower.word, undefined);
    assert.equal(lower.children?.length || 0, 0, 'the renderer does not invent lower lexical copies');
    assert.deepEqual(find(step.replayCanvasData, 'dpStudentsHigh').children.map(child => child.id), ['dStudents', 'nStudents']);
  }
});
