import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { retainUnchangedComponentLifetime } from '../replay/workspaceComponentLifetime.ts';

function example(direction, childOffset) {
  const component = () => ({ id: 'a', label: 'NP', children: [{ id: 'word', label: 'name', word: 'name' }] });
  const head = () => ({ id: 'head', label: 'T' });
  const first = component();
  const waiting = { id: 'workspace', label: '', replayOrigin: { kind: 'workspace' }, children: [component(), head()] };
  const attached = { id: 'parent', label: 'TP', children: [component(), head()] };
  const coordinates = [
    new Map([['a', { x: 100, y: 0 }], ['word', { x: 100, y: 200 }]]),
    new Map([['a', { x: 500, y: 0 }], ['word', { x: 500, y: 200 }], ['head', { x: 1400, y: 0 }]]),
    new Map([['parent', { x: 1150, y: 800 }], ['a', { x: 900, y: 1000 }],
      ['word', { x: 900, y: 1000 + childOffset }], ['head', { x: 1400, y: 1000 }]])
  ];
  const canvases = [first, waiting, attached], base = new Map(canvases.map((canvas, index) => [canvas, coordinates[index]]));
  const scenes = canvases.map((canvas, index) => {
    const root = d3.hierarchy(canvas); applyVizIds(root);
    const visible = new Set(root.descendants().filter(node => node.data.replayOrigin?.kind !== 'workspace').map(getNodeId));
    const tree = layoutSyntaxTree(root, [2000, 2000], direction, coordinates[index], visible);
    const nodes = new Map(tree.descendants().filter(node => visible.has(getNodeId(node))).map(node => [getNodeId(node), node]));
    return { canvas, coordinates: coordinates[index], nodes, size: [2000, 2000], step: {
      replayFrameIndex: index, replayKind: index ? 'micro' : 'macro',
      operation: index === 1 ? 'LexicalSelect' : index === 2 ? 'ExternalMerge' : 'StageRecord',
      targetNodeId: index === 1 ? 'head' : index === 2 ? 'parent' : 'a'
    } };
  });
  const render = (scene, reservation) => {
    const root = d3.hierarchy(scene.canvas); applyVizIds(root);
    return layoutSyntaxTree(root, scene.size, direction, reservation, new Set(scene.nodes.keys())).descendants()
      .filter(node => scene.nodes.has(getNodeId(node)));
  };
  return { scenes, base, waiting, attached, render };
}

for (const direction of ['ltr', 'rtl']) {
  test(`${direction}: retaining a waiting component cannot defer its internal deformation to attachment`, () => {
    const run = example(direction, 400), original = JSON.stringify([...run.base].map(([canvas, points]) => [canvas, [...points]]));
    const result = retainUnchangedComponentLifetime(run.scenes, run.base, direction, 1, 'a', run.render);
    assert.equal(result, run.base, 'the unsafe fallback must decline so a complete attachment strategy can be tried');
    assert.equal(JSON.stringify([...run.base].map(([canvas, points]) => [canvas, [...points]])), original);
  });

  test(`${direction}: a rigid attachment keeps the valid waiting reservation`, () => {
    const run = example(direction, 200);
    const result = retainUnchangedComponentLifetime(run.scenes, run.base, direction, 1, 'a', run.render);
    assert.notEqual(result, run.base);
    assert.deepEqual(result.get(run.waiting).get('a'), { x: 100, y: 0 });
    assert.deepEqual(result.get(run.waiting).get('word'), { x: 100, y: 200 });
    assert.equal(result.get(run.attached), run.base.get(run.attached), 'the real attachment keeps its existing rigid translation');
  });
}
