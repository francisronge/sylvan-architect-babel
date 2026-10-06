import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { reserveCompleteComponentLifetime } from '../replay/workspaceComponentLifetime.ts';

function pronounce(direction, { owner = 'head', authoredChild = false, priorWord, changedSilence = false, displayWord = 'did' } = {}) {
  const peer = () => ({ id: 'peer', label: 'N' });
  const before = { id: 'phrase', label: 'P', children: [{ id: 'head', label: 'T', ...(priorWord ? { word: priorWord } : {}) }, peer()] };
  const after = () => ({ id: 'phrase', label: 'P', children: [{ id: 'head', label: 'T', word: 'did',
    ...(changedSilence ? { silent: true } : {}), children: [{ id: 'head-word', label: displayWord, word: displayWord,
      ...(!authoredChild ? { replayOrigin: { kind: 'word', ownerId: owner } } : {}) }] }, peer()] });
  const canvases = [before, after(), { id: 'workspace', label: '', children: [after(), { id: 'next', label: 'C' }] }];
  const size = [2400, 1000], base = new Map();
  const scenes = canvases.map((canvas, index) => {
    const root = d3.hierarchy(canvas); applyVizIds(root);
    const visible = new Set(root.descendants().map(getNodeId).filter(id => id !== 'workspace'));
    const coordinates = new Map([
      ['phrase', { x: index === 2 ? 900 : 600, y: 0 }],
      ['head', { x: index === 2 ? 600 : 300, y: 200 }],
      ['head-word', { x: index === 2 ? 600 : 300, y: 400 }],
      ['peer', { x: index === 2 ? 1200 : 900, y: 200 }], ['next', { x: 2000, y: 0 }]
    ]);
    base.set(canvas, coordinates);
    const nodes = new Map(layoutSyntaxTree(root, size, direction, coordinates, visible).descendants()
      .filter(node => visible.has(getNodeId(node))).map(node => [getNodeId(node), node]));
    return { canvas, coordinates, nodes, size, step: { replayKind: index === 1 ? 'relation' : 'micro',
      operation: index === 1 ? 'Realization' : 'LexicalSelect', targetNodeId: index === 1 ? 'head' : 'next' } };
  });
  const render = (scene, coordinates) => {
    const root = d3.hierarchy(scene.canvas); applyVizIds(root);
    return layoutSyntaxTree(root, size, direction, coordinates, new Set(scene.nodes.keys())).descendants()
      .filter(node => scene.nodes.has(getNodeId(node)));
  };
  const saved = structuredClone([...base].map(([canvas, points]) => [canvas, [...points]]));
  const result = reserveCompleteComponentLifetime(scenes, base, direction, 2, 'phrase', render, { throughRelations: true });
  const frame = index => new Map(render(scenes[index], result.get(canvases[index])).map(node => [getNodeId(node), node]));
  assert.deepEqual([...base].map(([canvas, points]) => [canvas, [...points]]), saved);
  return { frame, canvases };
}

for (const direction of ['ltr', 'rtl']) {
  test(`${direction}: an existing wordless head retains its position when its generated word appears`, () => {
    const { frame } = pronounce(direction), before = frame(0), after = frame(1);
    assert.equal(before.has('head-word'), false);
    assert.equal(before.get('head').data.word, undefined);
    assert.equal(after.get('head-word').data.word, 'did');
    for (const [id, node] of before) {
      assert.equal(after.get(id).x, node.x, `${id} keeps its current position`);
      assert.equal(after.get(id).y, node.y);
    }
  });
  for (const [description, options] of [
    ['authored child', { authoredChild: true }],
    ['another display owner', { owner: 'other-head' }],
    ['another displayed word', { displayWord: 'go' }],
    ['replacement of an existing word', { priorWord: 'will' }],
    ['pronunciation state change', { changedSilence: true }]
  ]) test(`${direction}: ${description} does not qualify as generated-word appearance`, () => {
    const { frame } = pronounce(direction, options);
    assert.notEqual(frame(0).get('head').x, frame(1).get('head').x);
  });
}
