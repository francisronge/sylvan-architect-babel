import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { separateWorkspaceContours } from '../replay/workspaceContourClearance.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { plaqueTreeObstacles } from '../replay/relations/plaquePlacement.ts';

const leaf = id => ({ id, label: 'N', word: id });
const group = (id, child) => ({ id, label: 'NP', children: [leaf(child)] });
function scene(children, points) {
  const canvas = { id: 'workspace', label: 'Workspace', replayOrigin: { kind: 'workspace' }, children };
  const root = d3.hierarchy(canvas); applyVizIds(root);
  const nodes = new Map(root.descendants().map(node => [getNodeId(node), node]));
  return { canvas, nodes, visible: new Set([...nodes.keys()].filter(id => id !== 'workspace')),
    coordinates: new Map(Object.entries(points).map(([id, [x, y]]) => [id, { x, y }])) };
}

test('clearance moves independent components rigidly by one offset throughout the stage', () => {
  const scenes = [scene([group('a', 'a-word'), group('b', 'b-word')], {
    workspace: [0, 0], a: [0, 50], 'a-word': [0, 250], b: [50, 50], 'b-word': [50, 250]
  }), scene([leaf('a-word'), group('b', 'b-word')], {
    workspace: [0, 0], 'a-word': [0, 250], b: [50, 50], 'b-word': [50, 250]
  })];
  const original = structuredClone(scenes.map(scene => scene.coordinates)), data = JSON.stringify(scenes.map(scene => scene.canvas));
  const result = separateWorkspaceContours(scenes), dx = result[0].coordinates.get('b').x - original[0].get('b').x;
  assert(dx > 0, 'the current collision requires clearance');
  for (let i = 0; i < scenes.length; i++) {
    for (const id of ['b', 'b-word']) {
      assert.equal(result[i].coordinates.get(id).x - original[i].get(id).x, dx);
      assert.equal(result[i].coordinates.get(id).y, original[i].get(id).y);
    }
    assert.deepEqual(result[i].coordinates.get('a-word'), original[i].get('a-word'));
    assert.deepEqual(scenes[i].coordinates, original[i], 'input coordinates remain immutable');
    assert.equal(result[i].canvas, scenes[i].canvas, 'no layout scaffolding enters syntax');
  }
  assert.equal(JSON.stringify(scenes.map(scene => scene.canvas)), data);
});

test('an ambiguous earlier component cannot be assigned to either final workspace', () => {
  const final = scene([group('a', 'a-word'), group('b', 'b-word')], {
    workspace: [0, 0], a: [0, 50], 'a-word': [0, 250], b: [50, 50], 'b-word': [50, 250]
  });
  const prior = scene([{ id: 'mixed', label: 'XP', children: [leaf('a-word'), leaf('b-word')] }], {
    workspace: [0, 0], mixed: [0, 50], 'a-word': [-50, 250], 'b-word': [50, 250]
  });
  const scenes = [final, prior];
  assert.equal(separateWorkspaceContours(scenes), scenes, 'ambiguous membership retains the accepted plan');
});

/** The exhaustive pair search the bounded one must reproduce exactly. */
function exhaustiveSeparation(scenes) {
  const root = [...scenes[0].nodes.values()][0], groups = root.children;
  const membership = new Map(groups.flatMap((node, index) => node.descendants().map(node => [getNodeId(node), index])));
  const constraints = new Map();
  for (const scene of scenes) {
    const tree = d3.hierarchy(scene.canvas); applyVizIds(tree);
    tree.each(node => { const point = scene.coordinates.get(getNodeId(node)); if (point) { node.x = point.x; node.y = point.y; } });
    const visible = new Set(tree.descendants().filter(node => scene.visible.has(getNodeId(node))));
    const boxes = groups.map(() => []);
    for (const component of tree.descendants().filter(node => visible.has(node) && !visible.has(node.parent))) {
      const members = component.descendants().filter(node => visible.has(node));
      const owner = membership.get(getNodeId(members[0]));
      boxes[owner].push(...plaqueTreeObstacles(members));
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      let gap = 0;
      for (const a of boxes[i]) for (const b of boxes[j]) {
        if (Math.min(a.y + a.height, b.y + b.height) <= Math.max(a.y, b.y)) continue;
        gap = Math.max(gap, a.x + a.width + 34 - b.x);
      }
      if (gap > 0) constraints.set(`${i},${j}`, Math.max(constraints.get(`${i},${j}`) ?? 0, gap));
    }
  }
  const shifts = groups.map(() => 0);
  for (let j = 1; j < groups.length; j++) for (let i = 0; i < j; i++) shifts[j] = Math.max(shifts[j], shifts[i] + (constraints.get(`${i},${j}`) ?? 0));
  return scenes.map(scene => new Map([...scene.coordinates].map(([id, point]) => [id, { ...point, x: point.x + (shifts[membership.get(id) ?? -1] ?? 0) }])));
}

test('bounded clearance equals the exhaustive pair search for separate, touching and interleaved components', () => {
  let seed = 2027;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2**32);
  const tree = (id, depth) => depth ? { id, label: 'XP', children: [tree(`${id}l`, depth - 1), tree(`${id}r`, depth - 1)] } : leaf(id);
  let separated = 0;
  for (let trial = 0; trial < 60; trial++) {
    const children = ['a', 'b', 'c'].map(id => tree(id, 1 + trial % 3));
    const scenes = [0, 1].map(() => {
      const points = { workspace: [0, 0] };
      children.forEach((child, index) => {
        // Components start side by side, touching, overlapping or reversed.
        const origin = [index * 600, index * 180, index * 250 + random(), (2 - index) * 300][trial % 4];
        d3.hierarchy(child).each(node => { points[node.data.id] = [origin + (random() - 0.5) * 400 / (node.depth + 1), node.depth * 210]; });
      });
      return scene(children, points);
    });
    const result = separateWorkspaceContours(scenes).map(scene => scene.coordinates);
    assert.deepEqual(result, exhaustiveSeparation(scenes));
    if (result !== scenes.map(scene => scene.coordinates) && JSON.stringify([...result[0]]) !== JSON.stringify([...scenes[0].coordinates])) separated++;
  }
  assert.ok(separated > 10, `${separated} trials needed clearance`);
});
