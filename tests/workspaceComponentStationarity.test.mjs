import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { workspaceComponentIsStationary } from '../replay/workspaceComponentLifetime.ts';

function nodes({ root = 0, child = 0, other = 0 } = {}) {
  const tree = d3.hierarchy({ id: 'workspace', children: [
    { id: 'root', children: [{ id: 'child' }] }, { id: 'other' }
  ] });
  applyVizIds(tree);
  return new Map(tree.descendants().filter(node => getNodeId(node) !== 'workspace').map(node => {
    const id = getNodeId(node);
    Object.assign(node, { x: { root, child, other }[id], y: id === 'child' ? 100 : 0 });
    return [id, node];
  }));
}

test('a cloned no-op plan does not resolve an existing component jump', () => {
  assert.equal(workspaceComponentIsStationary(nodes(), nodes({ root: 50, child: 50 }), 'root'), false);
});
test('fixing only the root or only another component does not resolve the seed', () => {
  assert.equal(workspaceComponentIsStationary(nodes(), nodes({ child: 50 }), 'root'), false);
  assert.equal(workspaceComponentIsStationary(nodes({ other: 50 }), nodes({ root: 50, child: 50 }), 'root'), false);
});
test('all unchanged current members must survive at the same coordinates', () => {
  const before = nodes(), after = nodes();
  assert.equal(workspaceComponentIsStationary(before, after, 'root'), true);
  after.delete('child');
  assert.equal(workspaceComponentIsStationary(before, after, 'root'), false);
  assert.equal(workspaceComponentIsStationary(before, after, 'missing'), false);
});
test('reserving both sides at the same translated position resolves the seed', () => {
  assert.equal(workspaceComponentIsStationary(nodes({ root: -70, child: -70 }),
    nodes({ root: -70, child: -70, other: 80 }), 'root'), true);
});
