import test from 'node:test';
import assert from 'node:assert/strict';
import * as d3 from '../node_modules/d3/src/index.js';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { unchangedWorkspaceShapeReflows, workspaceContinuityReflows } from '../replay/workspaceShapeReflows.ts';
import { planCoherentWorkspace } from '../replay/workspaceCoherentPlan.ts';

const atom = (id, word) => ({ id, label: id.toUpperCase(), ...(word ? { word } : {}) });
const fork = (id, ...children) => ({ id, label: id.toUpperCase(), children });
const forest = (...children) => ({ id: 'forest', label: 'Workspace', replayOrigin: { kind: 'workspace' }, children });
const subtree = () => fork('sub', atom('a'), atom('b'));
function fixture(canvases, positions, steps = []) {
  const render = (scene, points) => {
    const root = d3.hierarchy(scene.canvas); applyVizIds(root);
    const visible = new Set(scene.step.replayVisibleNodeIds);
    return root.descendants().filter(node => visible.has(getNodeId(node))).map(node => Object.assign(node, points.get(getNodeId(node))));
  };
  const scenes = canvases.map((canvas, index) => {
    const root = d3.hierarchy(canvas); applyVizIds(root);
    const visible = root.descendants().filter(node => node.data.replayOrigin?.kind !== 'workspace').map(getNodeId);
    const coordinates = new Map(Object.entries(positions[index]).map(([id, [x, y]]) => [id, { x, y }]));
    const step = { replayCanvasData: canvas, replayVisibleNodeIds: visible, replayKind: 'micro', replayFrameIndex: index,
      operation: 'LexicalSelect', targetNodeId: 'fresh', ...steps[index] };
    const scene = { canvas, step, size: [5000, 1800], coordinates, nodes: new Map() };
    scene.nodes = new Map(render(scene, coordinates).map(node => [getNodeId(node), node]));
    return scene;
  });
  return { scenes, baseline: new Map(scenes.map(scene => [scene.canvas, scene.coordinates])), render };
}
const detect = input => unchangedWorkspaceShapeReflows(input.scenes, input.baseline, input.render);
const common = { host: [0, 0], sub: [-400, 300], a: [-700, 600], b: [-100, 600], other: [400, 300] };

for (const operation of [
  { replayKind: 'micro', operation: 'Project' },
  { replayKind: 'relation', operation: 'PF realization', replayRelationIdentity: { stageIndex: 1, relationIndex: 0 } },
  { replayKind: 'macro', operation: 'StageRecord' },
]) test(`same-parent complete-subtree deformation triggers on ${operation.replayKind}`, () => {
  const before = fork('host', subtree(), atom('other')), after = structuredClone(before);
  after.children[1].word = 'new material outside the subtree';
  const input = fixture([before, after], [common, { ...common, a: [-850, 600], b: [50, 600] }], [{}, operation]);
  assert.deepEqual(detect(input), [{ index: 1, rootId: 'sub', kind: 'unchanged-subtree-shape' }]);
});

test('an unchanged parent reports the deformation once for its complete subtree', () => {
  const before = fork('host', subtree(), atom('other'));
  const input = fixture([before, structuredClone(before)], [common, { ...common, a: [-850, 600], b: [50, 600] }]);
  assert.deepEqual(detect(input), [{ index: 1, rootId: 'host', kind: 'unchanged-subtree-shape' }]);
});

test('complete rigid translation at an owned merge preserves the accepted plan by identity', () => {
  const input = fixture([forest(subtree(), atom('r')), fork('wrapper', subtree(), atom('r'))],
    [{ sub: [0, 0], a: [-300, 300], b: [300, 300], r: [2000, 0] },
      { wrapper: [1500, 0], sub: [1000, 300], a: [700, 600], b: [1300, 600], r: [2000, 300] }],
    [{}, { operation: 'ExternalMerge', targetNodeId: 'wrapper', sourceNodeIds: ['sub', 'r'] }]);
  assert.deepEqual(detect(input), []);
  const forbidden = () => { throw Error('valid plan must not measure'); };
  const result = planCoherentWorkspace(input.scenes, input.baseline, 'ltr', input.render,
    { measureCategoryText: forbidden, measureTreeInk: forbidden, measureTreeLabel: forbidden });
  assert.equal(result.coordinates, input.baseline); assert.equal(result.diagnostic.status, 'unchanged');
});

for (const change of ['word', 'label', 'silent', 'missing']) test(`changed ${change} material is not claimed as an unchanged complete subtree`, () => {
  const before = subtree(), after = structuredClone(before);
  if (change === 'missing') after.children.pop();
  else after.children[0][change] = change === 'silent' ? true : 'new authored material';
  const input = fixture([before, after], [{ sub: [0, 0], a: [-300, 300], b: [300, 300] },
    { sub: [0, 0], a: [-600, 300], b: [600, 300] }]);
  assert.deepEqual(detect(input), []);
});

test('generated display casing is compared through its current authored owner', () => {
  const before = fork('owner', { id: 'word', label: 'The', word: 'The', replayOrigin: { kind: 'word', ownerId: 'owner' } });
  before.word = 'the';
  const after = structuredClone(before); after.children[0].word = after.children[0].label = 'the';
  const input = fixture([before, after], [{ owner: [0, 0], word: [0, 300] }, { owner: [0, 0], word: [0, 500] }]);
  assert.deepEqual(detect(input), [{ index: 1, rootId: 'owner', kind: 'unchanged-subtree-shape' }]);
});

test('invisible future ancestors do not claim a disconnected visible subtree', () => {
  const before = fork('host', { ...fork('hidden', subtree()), replayLayoutOnly: true }), after = structuredClone(before);
  const input = fixture([before, after],
    [{ host: [0, 0], hidden: [0, 200], sub: [0, 400], a: [-300, 700], b: [300, 700] },
      { host: [1000, 0], hidden: [1000, 200], sub: [0, 400], a: [-600, 700], b: [600, 700] }]);
  assert.deepEqual(detect(input), [{ index: 1, rootId: 'sub', kind: 'unchanged-subtree-shape' }]);
});

test('an unrelated current movement grants no pose exemption to the detected branch', () => {
  const before = forest(subtree(), atom('source', 'move'));
  const after = forest(subtree(), { ...atom('source', 'trace'), silent: true }, atom('landing', 'move'));
  const input = fixture([before, after],
    [{ sub: [0, 0], a: [-300, 300], b: [300, 300], source: [2000, 900] },
      { sub: [700, 0], a: [250, 300], b: [1150, 300], source: [2000, 900], landing: [3000, 900] }],
    [{}, { replayKind: 'relation', replayRelationIdentity: { stageIndex: 1, relationIndex: 0 },
      replayRelationLinks: [{ authoredRelationKey: '1:0', renderFamily: 'trajectory', priorSourceNodeId: 'source', witnessNodeId: 'source', targetNodeId: 'landing' }] }]);
  const result = planCoherentWorkspace(input.scenes, input.baseline, 'ltr', input.render);
  assert.equal(result.diagnostic.status, 'resolved', JSON.stringify(result.diagnostic));
  assert.ok(result.diagnostic.reflows.some(seed => seed.kind === 'unchanged-subtree-shape'));
  const points = input.scenes.map(scene => result.coordinates.get(scene.canvas));
  for (const id of ['sub', 'a', 'b']) assert.deepEqual(points[0].get(id), points[1].get(id));
  assert.ok(Math.abs(points[1].get('landing').x - points[0].get('source').x) > 1);
});

test('maximal unchanged components render each adjacent scene only once', () => {
  let tree = atom('leaf');
  for (let index = 0; index < 200; index++) tree = fork(`p${index}`, tree);
  const base = Object.fromEntries(d3.hierarchy(tree).descendants().map((node, index) => [node.data.id, [0, index * 220]]));
  const canvases = Array.from({ length: 5 }, () => structuredClone(tree));
  const positions = canvases.map((_, index) => ({ ...base, leaf: [0, base.leaf[1] + index * 50] }));
  const input = fixture(canvases, positions); let renders = 0;
  const result = unchangedWorkspaceShapeReflows(input.scenes, input.baseline, (...args) => { renders++; return input.render(...args); });
  assert.equal(renders, 5); assert.equal(result.length, 4);
  assert.ok(result.every(seed => seed.rootId === 'p199'));
});

for (const replayKind of ['micro', 'relation', 'macro']) test(`rigid unowned subtree motion is detected on ${replayKind}`, () => {
  const tree = subtree(), first = { sub: [0, 0], a: [-300, 300], b: [300, 300] };
  const input = fixture([tree, structuredClone(tree)], [first, { sub: [150, 0], a: [-150, 300], b: [450, 300] }], [{}, { replayKind }]);
  assert.deepEqual(detect(input), []);
  assert.deepEqual(workspaceContinuityReflows(input.scenes, input.baseline, input.render),
    [{ index: 1, rootId: 'sub', kind: 'unowned-component-motion' }]);
});

test('a current movement does not hide an unchanged singleton sibling teleport', () => {
  const parent = fork('parent', atom('source'), atom('other'));
  const input = fixture([forest(parent), forest(structuredClone(parent), atom('landing'))],
    [{ parent: [0, 0], source: [-300, 300], other: [300, 300] },
      { parent: [100, 0], source: [-200, 300], other: [400, 300], landing: [2000, 0] }],
    [{}, { replayKind: 'relation', replayRelationIdentity: { stageIndex: 1, relationIndex: 0 },
      replayRelationLinks: [{ authoredRelationKey: '1:0', renderFamily: 'trajectory', priorSourceNodeId: 'source', witnessNodeId: 'source', targetNodeId: 'landing' }] }]);
  assert.deepEqual(workspaceContinuityReflows(input.scenes, input.baseline, input.render),
    [{ index: 1, rootId: 'other', kind: 'unowned-component-motion' }]);
});

test('PF spelling changes require a stable point without falsely claiming unchanged material', () => {
  const input = fixture([atom('word', 'old'), atom('word', 'new')], [{ word: [0, 0] }, { word: [40, 0] }],
    [{}, { replayKind: 'relation', operation: 'PF' }]);
  assert.deepEqual(detect(input), []);
  assert.deepEqual(workspaceContinuityReflows(input.scenes, input.baseline, input.render),
    [{ index: 1, rootId: 'word', kind: 'unowned-component-motion' }]);
});

test('missing material does not fabricate stationary points', () => {
  const input = fixture([atom('old'), atom('new')], [{ old: [0, 0] }, { new: [1000, 0] }]);
  assert.deepEqual(workspaceContinuityReflows(input.scenes, input.baseline, input.render), []);
});

test('an exact Project translation returns the existing plan by identity', () => {
  const input = fixture([atom('word'), fork('head', atom('word'))], [{ word: [0, 0] }, { head: [500, 0], word: [500, 300] }],
    [{}, { operation: 'Project', targetNodeId: 'head', sourceNodeIds: ['word'] }]);
  assert.deepEqual(workspaceContinuityReflows(input.scenes, input.baseline, input.render), []);
  const forbidden = () => { throw Error('valid Project must not measure'); };
  const result = planCoherentWorkspace(input.scenes, input.baseline, 'ltr', input.render, { measureCategoryText: forbidden });
  assert.equal(result.coordinates, input.baseline); assert.equal(result.diagnostic.status, 'unchanged');
});

test('same-canvas stable moments retain object identity and deterministic zero-work diagnostics', () => {
  const tree = subtree(), points = { sub: [0, 0], a: [-300, 300], b: [300, 300] };
  const input = fixture([tree, tree], [points, points], [{}, { replayKind: 'relation', operation: 'Agree' }]);
  const forbidden = () => { throw Error('unchanged canvas must not measure'); };
  for (let repeat = 0; repeat < 3; repeat++) {
    assert.deepEqual(workspaceContinuityReflows(input.scenes, input.baseline, input.render), []);
    const result = planCoherentWorkspace(input.scenes, input.baseline, 'ltr', input.render, { measureCategoryText: forbidden });
    assert.equal(result.coordinates, input.baseline);
    assert.deepEqual(result.diagnostic, { status: 'unchanged', reflows: [], evaluations: 0, corrections: 0 });
  }
});
