import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { retainUnchangedComponentLifetime } from '../replay/workspaceComponentLifetime.ts';

const branch = (word = 'name', silent) => ({ id: 'a', label: 'NP', children: [{ id: 'word', label: word, word, silent }] });
const forest = a => ({ id: 'workspace', label: '', replayOrigin: { kind: 'workspace' }, children: [a, { id: 'head', label: 'T' }] });
function setup(canvases, direction) {
  const base = new Map();
  const scenes = canvases.map((canvas, index) => {
    const h = d3.hierarchy(canvas); applyVizIds(h);
    const visible = new Set(h.descendants().map(getNodeId).filter(id => id !== 'workspace'));
    const coordinates = base.get(canvas) ?? new Map(h.descendants().map((node, i) => [getNodeId(node), { x: 100 + index * 300 + i * 90, y: 100 + node.depth * 100 }]));
    base.set(canvas, coordinates);
    const t = layoutSyntaxTree(h, [2000, 1500], direction, coordinates, visible);
    return { canvas, size: [2000, 1500], coordinates, nodes: new Map(t.descendants().filter(n => visible.has(getNodeId(n))).map(n => [getNodeId(n), n])), step: {} };
  });
  const render = (scene, coordinates) => {
    const h = d3.hierarchy(scene.canvas); applyVizIds(h);
    return layoutSyntaxTree(h, scene.size, direction, coordinates, new Set(scene.nodes.keys())).descendants().filter(n => scene.nodes.has(getNodeId(n)));
  };
  return { scenes, base, render };
}
for (const direction of ['ltr', 'rtl']) {
  test(`${direction}: bounded retention keeps the whole unchanged component fixed and leaves its real attachment native`, () => {
    const shared = forest(branch());
    const attached = { id: 'parent', label: 'TP', children: [branch(), { id: 'head', label: 'T' }] };
    const run = setup([branch(), shared, shared, attached], direction);
    const original = JSON.stringify([...run.base].map(([canvas, coordinates]) => [canvas, [...coordinates]]));
    const result = retainUnchangedComponentLifetime(run.scenes, run.base, direction, 1, 'a', run.render);
    const before = new Map(run.render(run.scenes[0], run.base.get(run.scenes[0].canvas)).map(n => [getNodeId(n), n]));
    for (const scene of run.scenes.slice(1, 3)) for (const node of run.render(scene, result.get(scene.canvas))) {
      if (!before.has(getNodeId(node))) continue;
      const old = before.get(getNodeId(node));
      assert.equal(node.x, old.x); assert.equal(node.y, old.y);
    }
    assert.strictEqual(result.get(attached), run.base.get(attached), 'retention ends before the component acquires a parent');
    assert.equal(JSON.stringify([...run.base].map(([canvas, coordinates]) => [canvas, [...coordinates]])), original);
  });
  for (const [name, next] of [
    ['authored word change', branch('changed')],
    ['source becoming silent', branch('name', true)],
    ['new child', { id: 'a', label: 'NP', children: [...branch().children, { id: 'new', label: 'AP' }] }]
  ]) test(`${direction}: bounded retention stops at ${name}`, () => {
    const exit = forest(next), run = setup([branch(), forest(branch()), exit], direction);
    const result = retainUnchangedComponentLifetime(run.scenes, run.base, direction, 1, 'a', run.render);
    assert.strictEqual(result.get(exit), run.base.get(exit));
  });
}
