import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import { buildStageLayoutGroups, stageTreeLayoutSize } from '../replay/stageCamera.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';

const branch = (id, children) => ({ id, label: 'XP', children });
const leaf = id => ({ id, label: id });
const find = (node, id) => node.id === id ? node : node.children?.map(child => find(child, id)).find(Boolean);

function textScenes(word = 'the', displayed = 'The') {
  const determiner = { id: 'd', label: 'D', word, tokenIndex: 0, children: [{
    id: 'display-word', label: displayed, word: displayed, replayOrigin: { kind: 'word', ownerId: 'd' }
  }] };
  const subject = branch('dp', [determiner, branch('n', [leaf('students')])]);
  const predicate = branch('vp', [leaf('v'), leaf('object')]);
  return [branch('root', [subject, predicate]), branch('root', [subject,
    branch('cp', [leaf('c'), branch('tp', [leaf('t'), predicate])])])].map(canvas => structuredClone(canvas));
}

function stepsFor(canvases) {
  return canvases.map((replayCanvasData, replayStageStepIndex) => ({
    replayFrameIndex: 0, replayStageStepIndex, replayKind: 'micro', replayCanvasData,
    replayVisibleNodeIds: d3.hierarchy(replayCanvasData).descendants().map(node => node.data.id)
  }));
}

function positions(step, steps, size, stage = 0, direction = 'ltr', reserved = true) {
  const root = d3.hierarchy(step.replayCanvasData);
  applyVizIds(root);
  const coordinates = reserved ? buildStageCoordinateReservations(steps, stage, size).get(step.replayCanvasData) : undefined;
  layoutSyntaxTree(root, size, direction, coordinates, new Set(step.replayVisibleNodeIds));
  return new Map(root.descendants().map(node => [getNodeId(node), { x: node.x, y: node.y }]));
}

for (const [word, displayed] of [['the', 'The'], ['über', 'Über']]) {
  test(`${displayed} to ${word}: display casing alone keeps the unchanged subtree's geometry`, () => {
    const control = stepsFor(textScenes(word, displayed));
    const steps = structuredClone(control);
    Object.assign(find(steps[1].replayCanvasData, 'display-word'), { word, label: word });
    const original = structuredClone(steps);
    for (const size of [[1200, 800], [390, 700]]) for (const direction of ['ltr', 'rtl']) {
      for (let index = 0; index < steps.length; index++) {
        const actual = positions(steps[index], steps, size, 0, direction);
        assert.deepEqual(actual, positions(control[index], control, size, 0, direction),
          'changing only displayed capitalization has no geometry effect anywhere in the scene');
        assert.equal(actual.get('d').y, actual.get('n').y);
      }
    }
    assert.deepEqual(steps, original, 'reservation does not rewrite source or displayed spelling');
    assert.equal(find(steps[0].replayCanvasData, 'display-word').word, displayed);
    assert.equal(find(steps[1].replayCanvasData, 'display-word').word, word);
  });
}

const changes = [
  ['a changed authored word', canvases => {
    const d = find(canvases[1], 'd'); d.word = 'this';
    Object.assign(d.children[0], { word: 'This', label: 'This' });
  }],
  ['changed authored capitalization', canvases => { find(canvases[1], 'd').word = 'The'; }],
  ['a changed authored category', canvases => { find(canvases[1], 'd').label = 'D[plural]'; }],
  ['a changed token position', canvases => { find(canvases[1], 'd').tokenIndex = 1; }],
  ['a pronunciation change', canvases => { find(canvases[1], 'd').silent = true; }],
  ['a display child owned by another occurrence', canvases => {
    canvases.forEach(canvas => { find(canvas, 'display-word').replayOrigin.ownerId = 'n'; });
    Object.assign(find(canvases[1], 'display-word'), { word: 'the', label: 'the' });
  }],
  ['a non-word display origin', canvases => {
    canvases.forEach(canvas => { find(canvas, 'display-word').replayOrigin.kind = 'lexical'; });
    Object.assign(find(canvases[1], 'display-word'), { word: 'the', label: 'the' });
  }],
  ['casing beyond the first letter', canvases => {
    Object.assign(find(canvases[1], 'display-word'), { word: 'THE', label: 'THE' });
  }],
  ['a display annotation that differs from its word', canvases => {
    Object.assign(find(canvases[1], 'display-word'), { word: 'the', label: 'the[focus]' });
  }]
];

for (const [name, change] of changes) test(`${name} still invalidates unchanged-subtree retention`, () => {
  const canvases = textScenes(); change(canvases);
  const steps = stepsFor(canvases), original = structuredClone(steps), size = [1200, 800];
  const entry = positions(steps[0], steps, size, 0, 'ltr', false);
  const reserved = positions(steps[1], steps, size);
  assert.notEqual(reserved.get('d').y, entry.get('d').y,
    'the authored occurrence must not be classified as unchanged by the display-only exception');
  assert.deepEqual(steps, original);
});

test('entry 24 frames 22–25: displayed The/the does not split D and N ranks', () => {
  const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/reviewed-construction.json', import.meta.url)))
    .cases.find(entry => entry.reviewNumber === 24);
  const original = JSON.stringify(record);
  const result = prepareReplay({ ...record, includePlayback: true }), steps = result.playbackSteps;
  const snapshots = JSON.stringify(steps.map(step => step.replayCanvasData));
  const stage = 2, groups = buildStageLayoutGroups(steps, result.replayDerivationFrames);
  assert.equal(find(steps[21].replayCanvasData, 'dStudents').word, 'the');
  assert.equal(find(steps[21].replayCanvasData, 'dStudents::__leaf').word, 'The');
  assert.equal(find(steps[23].replayCanvasData, 'dStudents::__leaf').word, 'the');
  for (const [width, height] of [[1596, 1016], [390, 844]]) for (const direction of ['ltr', 'rtl']) {
    const size = stageTreeLayoutSize(steps, stage, width, height, groups);
    let entry;
    for (const frame of [22, 23, 24, 25]) {
      const actual = positions(steps[frame - 1], steps, size, stage, direction);
      assert.equal(actual.get('dStudents').y, actual.get('nStudents').y, `frame ${frame}: D and N share a rank`);
      if (!entry) entry = actual;
      for (const id of ['dStudents', 'dStudents::__leaf', 'nStudents', 'nStudents::__leaf']) {
        assert.deepEqual(actual.get(id), entry.get(id), `frame ${frame}: ${id} keeps its position`);
      }
    }
  }
  assert.equal(JSON.stringify(record), original, 'the model-authored record is byte-for-byte unchanged');
  assert.equal(JSON.stringify(steps.map(step => step.replayCanvasData)), snapshots, 'the displayed casing is unchanged');
});
