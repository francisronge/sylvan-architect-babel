import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { retainCurrentRootFork } from '../replay/currentRootFork.ts';
import { applyVizIds } from '../replay/displayIdentity.ts';

const node = (id, children = []) => ({ id, label: id, children });
function scene(root, points) {
  const hierarchy = d3.hierarchy(root); applyVizIds(hierarchy);
  const nodes = new Map(hierarchy.descendants().map(node => [node.data.id, node]));
  return { nodes, visible: new Set(nodes.keys()),
    coordinates: new Map(Object.entries(points).map(([id, y]) => [id, { x: 0, y }])) };
}
function example() {
  const children = [node('head'), node('complement')];
  return {
    current: scene(node('root', children), { root: 0, head: 100, complement: 100 }),
    future: scene(node('root', [node('specifier'), node('fork', children)]),
      { root: 0, specifier: 50, fork: 50, head: 100, complement: 100 })
  };
}

test('root growth keeps the current fork above its retained daughters even after a rigid translation', () => {
  const { current, future } = example();
  current.coordinates.forEach(point => { point.y += 400; });
  const futureBefore = structuredClone(future.coordinates);
  retainCurrentRootFork(current, future);
  assert.equal(current.coordinates.get('root').y, 450);
  assert.equal(current.coordinates.get('head').y, 500);
  assert.equal(current.coordinates.get('complement').y, 500);
  assert.deepEqual(future.coordinates, futureBefore);
});

for (const [name, alter] of [
  ['an internal parent with an incoming branch', ({ current }) => {
    const parent = d3.hierarchy(node('outer', [current.nodes.get('root').data, node('sister')]));
    applyVizIds(parent);
    current.nodes = new Map(parent.descendants().map(node => [node.data.id, node]));
    current.visible = new Set(current.nodes.keys());
    current.coordinates.set('outer', { x: 0, y: -50 });
    current.coordinates.set('sister', { x: 0, y: 0 });
  }],
  ['a fork already visible in the current scene', ({ current }) => current.visible.add('fork')],
  ['daughters with different retained vertical offsets', ({ current }) => { current.coordinates.get('head').y += 30; }],
  ['a changed daughter order', ({ future }) => future.nodes.get('fork').children.reverse()],
  ['an extra future daughter', scenes => {
    scenes.future = scene(node('root', [node('specifier'), node('fork', [node('head'), node('complement'), node('extra')])]),
      { root: 0, specifier: 50, fork: 50, head: 100, complement: 100, extra: 100 });
  }],
  ['a future fork outside the old root', ({ future }) => { future.nodes.get('fork').parent = null; }]
]) test(`${name} does not borrow a future fork position`, () => {
  const scenes = example();
  alter(scenes);
  const before = structuredClone(scenes.current.coordinates);
  retainCurrentRootFork(scenes.current, scenes.future);
  assert.deepEqual(scenes.current.coordinates, before);
});
