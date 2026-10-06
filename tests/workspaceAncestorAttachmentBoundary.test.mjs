import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { reserveCompleteComponentLifetime } from '../replay/workspaceComponentLifetime.ts';

const atom = id => ({ id, label: id });
const branch = (id, children) => ({ id, label: id, children });
function example({ direction = 'ltr', attaches = true, hidden = false } = {}) {
  const container = () => branch('container', [atom('child'), atom('peer')]);
  const wrapped = () => hidden ? branch('upper', [branch('invisible', [container()])]) : container();
  const canvases = [branch('forest', [wrapped()]), branch('forest', [wrapped(), atom('selected')]),
    attaches ? branch('newOwner', [wrapped(), atom('arrival')]) : branch('forest', [wrapped(), atom('selected'), atom('arrival')])];
  const base = new Map();
  const scenes = canvases.map((canvas, index) => {
    const root = d3.hierarchy(canvas); applyVizIds(root);
    const coordinates = new Map(root.descendants().map(node => {
      const id = getNodeId(node), shift = index === 2 ? 540 : index === 1 ? 40 : 0;
      const x = id === 'child' ? 100 + shift : id === 'peer' ? 900 + shift : ['selected', 'arrival'].includes(id) ? 6000 : 500 + shift;
      const placedX = hidden && id === 'upper' ? 8000 : x;
      return [id, { x: direction === 'rtl' ? 10000 - placedX : placedX, y: hidden && id === 'newOwner' ? 1000 : hidden && ['upper', 'arrival'].includes(id) ? 1500 : ['child', 'peer'].includes(id) ? 200 : 0 }];
    }));
    base.set(canvas, coordinates);
    const nodes = new Map(root.descendants().filter(node => !['forest', 'invisible'].includes(getNodeId(node))).map(node => {
      const point = coordinates.get(getNodeId(node));
      return [getNodeId(node), Object.assign(node, { x: direction === 'rtl' ? 10000 - point.x : point.x, y: point.y })];
    }));
    return { canvas, coordinates, nodes, size: [10000, 3000], step: { replayKind: 'micro',
      operation: index === 2 && attaches ? 'ExternalMerge' : 'LexicalSelect', targetNodeId: index === 2 && attaches ? 'newOwner' : 'selected' } };
  });
  const render = (scene, positions) => {
    const root = d3.hierarchy(scene.canvas); applyVizIds(root);
    return root.descendants().filter(node => scene.nodes.has(getNodeId(node))).map(node => {
      const point = positions.get(getNodeId(node));
      return Object.assign(node, { x: direction === 'rtl' ? 10000 - point.x : point.x, y: point.y });
    });
  };
  const result = reserveCompleteComponentLifetime(scenes, base, direction, 1, 'child', render, { throughRelations: true });
  return { points: index => result.get(canvases[index]), base: index => base.get(canvases[index]) };
}
for (const direction of ['ltr', 'rtl']) {
  test(`${direction}: a descendant's absolute reference stops before its unchanged containing tree attaches`, () => {
    const { points, base } = example({ direction });
    assert.deepEqual(points(0).get('child'), base(1).get('child'));
    assert.deepEqual(points(1).get('child'), base(1).get('child'));
    for (const [id, point] of base(2)) assert.deepEqual(points(2).get(id), point, 'the later whole-tree pose remains native');
  });
  test(`${direction}: unrelated selection can extend the same contained lifetime`, () => {
    const { points, base } = example({ direction, attaches: false });
    assert.deepEqual(points(0).get('child'), base(2).get('child'));
  });
  test(`${direction}: attachment above an invisible parent cannot bound a separate visible lifetime`, () => {
    const { points, base } = example({ direction, hidden: true });
    assert.deepEqual(points(0).get('child'), base(2).get('child'));
  });
}
