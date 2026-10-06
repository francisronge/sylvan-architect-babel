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
import { plaqueTreeObstacles } from '../replay/relations/plaquePlacement.ts';
import { workspaceComponentLifetimeSeeds } from '../replay/workspaceComponentLifetime.ts';
import { measureCategoryText, measureTreeInk } from './helpers/treeFontMetrics.mjs';

const cases = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/workspace-component-lifetime.json', import.meta.url))).cases;
const cache = new Map();
function setup(key, width, height, direction) {
  const id = JSON.stringify([key, width, height, direction]);
  if (cache.has(id)) return cache.get(id);
  const record = cases.find(row => row.key === key), original = JSON.stringify(record);
  const replay = prepareReplay({ ...record, includePlayback: true });
  const steps = replay.playbackSteps;
  const groups = buildStageLayoutGroups(steps, replay.replayDerivationFrames);
  const sizeFor = stage => stageTreeLayoutSize(steps, stage, width, height, groups);
  // This complete-lifetime repair needs the same ink bounds as the browser.
  // Missing metrics deliberately retain the conservative placement envelope.
  const metrics = key === 'english-late-adjunct/1' ? [measureCategoryText, measureTreeInk] : [];
  const frames = new Map();
  const frame = number => {
    if (frames.has(number)) return frames.get(number);
    const step = steps[number - 1], size = sizeFor(step.replayFrameIndex);
    const root = d3.hierarchy(step.replayCanvasData); applyVizIds(root);
    const visible = new Set(step.replayVisibleNodeIds);
    const coordinates = buildStageCoordinateReservations(steps, step.replayFrameIndex, size, sizeFor, direction, ...metrics).get(step.replayCanvasData);
    const tree = layoutSyntaxTree(root, size, direction, coordinates, visible);
    const nodes = new Map(tree.descendants().filter(node => visible.has(getNodeId(node))).map(node => [getNodeId(node), node]));
    const result = { step, nodes }; frames.set(number, result); return result;
  };
  const result = { frame, steps, immutable: () => assert.equal(JSON.stringify(record), original) };
  cache.set(id, result); return result;
}
function stationary(before, after) {
  let count = 0;
  for (const [id, node] of before.nodes) {
    const next = after.nodes.get(id);
    if (!next) continue;
    assert(Math.hypot(next.x - node.x, next.y - node.y) < 1e-6,
      `${id} moved from ${node.x},${node.y} to ${next.x},${next.y}`);
    count++;
  }
  assert(count >= 20, 'checks the complete existing scene');
}

for (const [width, height] of [[1600, 1100], [390, 844]]) for (const direction of ['ltr', 'rtl']) {
  for (const [key, boundaries] of [
    ['english-late-adjunct/1', [[47, 48]]],
    ['dutch-auxiliary/0', [[53, 54]]],
    ['hungarian-dative/1', [[33, 34], [38, 39]]],
    ['turkish-relative/0', [[49, 50], [55, 56]]]
  ]) test(`${width}px ${direction}: ${key} keeps unchanged syntax fixed at selection or relation-only entry`, () => {
    const run = setup(key, width, height, direction);
    for (const [a, b] of boundaries) stationary(run.frame(a), run.frame(b));
    run.immutable();
  });

  test(`${width}px ${direction}: the late adjunct keeps selection and its following merge continuous`, () => {
    const run = setup('english-late-adjunct/1', width, height, direction);
    stationary(run.frame(47), run.frame(48));
    const before = run.frame(48), after = run.frame(49);
    assert.equal(after.step.operation, 'ExternalMerge');
    assert.equal(after.step.targetNodeId, 'matrixIbar');
    const oldRoot = before.nodes.get('matrixVP'), newRoot = after.nodes.get('matrixVP');
    for (const node of visibleComponentNodes(oldRoot, before.nodes)) {
      const next = after.nodes.get(getNodeId(node)); assert(next);
      assert(Math.hypot(next.x - newRoot.x - (node.x - oldRoot.x),
        next.y - newRoot.y - (node.y - oldRoot.y)) < 1e-6,
      `${getNodeId(node)} must not defer its internal reflow from selection to the merge`);
    }
    run.immutable();
  });

  test(`${width}px ${direction}: the Turkish source and real movement remain authored`, () => {
    const run = setup('turkish-relative/0', width, height, direction);
    const before = run.frame(56), after = run.frame(57);
    assert(before.nodes.has('matrixVerb'));
    assert(!before.nodes.has('matrixVerbRaised'));
    assert.equal(before.nodes.get('matrixVerb::__leaf').data.word, 'okudu');
    assert(after.nodes.has('matrixVerbRaised'));
    assert.equal(after.nodes.get('matrixVerbRaised::__leaf').data.word, 'okudu');
    const a = before.nodes.get('matrixVerb'), b = after.nodes.get('matrixVerbRaised');
    assert(Math.hypot(a.x - b.x, a.y - b.y) > 1, 'the real head movement remains visible');
    run.immutable();
  });
}

test('current components stop at invisible canvas parents and include every visible node once', () => {
  const tree = d3.hierarchy({ id: 'a', label: 'A', children: [
    { id: 'visible-child', label: 'B' },
    { id: 'future-parent', label: 'P', children: [{ id: 'separate', label: 'C', children: [{ id: 'word', label: 'word' }] }] }
  ] }); applyVizIds(tree);
  const visible = new Map(tree.descendants().filter(node => getNodeId(node) !== 'future-parent').map(node => [getNodeId(node), node]));
  assert.deepEqual(visibleComponentNodes(tree, visible).map(getNodeId), ['a', 'visible-child']);
  const components = [...visible.values()].filter(node => !node.parent || !visible.has(getNodeId(node.parent)));
  const ids = components.flatMap(root => visibleComponentNodes(root, visible).map(getNodeId));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, visible.size);
});

test('deep unchanged components use a bounded structural signature and do not create seeds', () => {
  let data = { id: 'word', label: 'word' };
  for (let depth = 0; depth < 40; depth++) data = { id: `n${depth}`, label: 'N', children: [data] };
  const root = d3.tree().nodeSize([100, 100])(d3.hierarchy(data)); applyVizIds(root);
  const nodes = new Map(root.descendants().map(node => [getNodeId(node), node]));
  const coordinates = new Map([...nodes].map(([id, node]) => [id, { x: node.x, y: node.y }]));
  const scene = { canvas: data, nodes, coordinates, size: [1000, 1000], step: {} };
  assert.deepEqual(workspaceComponentLifetimeSeeds([scene, scene], new Map([[data, coordinates]]), () => [...nodes.values()]), []);
});

test('component clearance remains rigid across shared relation canvases', async () => {
  const { reserveCompleteComponentLifetime } = await import('../replay/workspaceComponentLifetime.ts');
  const a = () => ({ id: 'a', label: 'NP', children: [{ id: 'word', label: 'name', word: 'name' }] });
  const before = a();
  const forest = () => ({ id: 'workspace', label: '', replayOrigin: { kind: 'workspace' }, children: [a(), { id: 'head', label: 'T[finite]' }] });
  const first = forest(), shared = forest();
  const coordinates = new Map();
  const scenes = [before, first, shared, shared].map((canvas, index) => {
    const root = d3.hierarchy(canvas); applyVizIds(root);
    const visible = new Set(root.descendants().map(getNodeId).filter(id => id !== 'workspace'));
    const reservation = coordinates.get(canvas) ?? new Map([
      ['a', { x: index ? 500 : 0, y: 100 }],
      ['word', { x: index ? 500 : 0, y: 300 }],
      ['head', { x: 500, y: 100 }]
    ]);
    coordinates.set(canvas, reservation);
    const tree = layoutSyntaxTree(root, [2000, 1000], 'ltr', reservation, visible);
    const nodes = new Map(tree.descendants().filter(node => visible.has(getNodeId(node))).map(node => [getNodeId(node), node]));
    return { canvas, coordinates: reservation, nodes, size: [2000, 1000], step: { replayKind: index === 1 ? 'micro' : 'relation', operation: index === 1 ? 'LexicalSelect' : 'Observe', targetNodeId: 'head' } };
  });
  const render = (scene, reservation) => {
    const root = d3.hierarchy(scene.canvas); applyVizIds(root);
    return layoutSyntaxTree(root, scene.size, 'ltr', reservation, new Set(scene.nodes.keys())).descendants().filter(node => scene.nodes.has(getNodeId(node)));
  };
  const saved = JSON.stringify([...coordinates].map(([canvas, positions]) => [canvas, [...positions]]));
  const result = reserveCompleteComponentLifetime(scenes, coordinates, 'ltr', 1, 'a', render);
  assert.notEqual(result.get(first).get('a').x, 500, 'the reserved component receives clearance');
  assert.deepEqual(result.get(first).get('a'), result.get(shared).get('a'), 'shared relation frames do not add the offset twice');
  for (const scene of scenes.slice(1)) {
    const nodes = new Map(render(scene, result.get(scene.canvas)).map(node => [getNodeId(node), node]));
    const own = plaqueTreeObstacles(visibleComponentNodes(nodes.get('a'), nodes));
    const other = plaqueTreeObstacles([nodes.get('head')]);
    for (const a of own) for (const b of other) assert(
      Math.min(a.x + a.width, b.x + b.width) <= Math.max(a.x, b.x)
      || Math.min(a.y + a.height, b.y + b.height) <= Math.max(a.y, b.y), 'current components have clearance');
    assert.equal(nodes.get('word').x - nodes.get('a').x, 0, 'internal horizontal spacing is rigid');
    assert.equal(nodes.get('word').y - nodes.get('a').y, 200, 'internal branch height is rigid');
  }
  assert.equal(JSON.stringify([...coordinates].map(([canvas, positions]) => [canvas, [...positions]])), saved, 'source reservations remain immutable');
});
