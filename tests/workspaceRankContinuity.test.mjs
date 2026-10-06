import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { getNodeId, applyVizIds } from '../replay/displayIdentity.ts';
import { reserveCompleteComponentLifetime } from '../replay/workspaceComponentLifetime.ts';

const leaf = (id, extra = {}) => ({ id, label: id, ...extra });
const branch = (id, children) => ({ id, label: id, children });

function example({ sister = () => branch('sister', [branch('sisterCore', [leaf('sisterWord')])]),
  singleRank = false, hiddenIsland = false, finalY = (node) => node.depth * 101 } = {}) {
  const full = () => singleRank ? leaf('source', { word: 'speak' }) : branch('source', [leaf('sourceWord', { word: 'speak' })]);
  const before = branch('predicate', [sister(), branch('core', [leaf('host'), full()])]);
  const after = () => branch('predicate', [sister(), branch('core', [branch('complexHead', [leaf('host'), branch('landing', [leaf('landingWord', { word: 'speak' })])]), leaf('source', { silent: true })])]);
  if (singleRank) {
    before.children = [leaf('sister'), full()];
  }
  const post = after();
  if (singleRank) post.children = [leaf('sister'), branch('complexHead', [leaf('host'), leaf('landing')]), leaf('source', { silent: true })];
  if (hiddenIsland) {
    for (const data of [before, post]) data.children.push(branch('hiddenFuture', [branch('island', [leaf('islandWord')])]));
  }
  const final = structuredClone(post);
  const roots = [before, post, branch('workspace', [final, leaf('newHead')])];
  const base = new Map();
  const scenes = roots.map((canvas, index) => {
    const root = d3.hierarchy(canvas); applyVizIds(root);
    const currentRoot = index === 2 ? root.children[0] : root;
    const rankOffset = currentRoot.depth;
    const coordinates = new Map(root.descendants().map(node => {
      const id = getNodeId(node), relative = { ...node, depth: node.depth - rankOffset };
      const x = id.startsWith('sister') ? 200 : id.startsWith('source') ? 1400 : id.startsWith('island') ? 4000 : id === 'newHead' ? 6000 : 900;
      const y = index === 2 ? finalY(relative) : relative.depth * 100;
      return [id, { x: x + (index === 2 && id !== 'newHead' ? 40 : 0), y }];
    }));
    const nodes = new Map(root.descendants().filter(node => !['workspace', 'hiddenFuture'].includes(getNodeId(node))).map(node => {
      Object.assign(node, coordinates.get(getNodeId(node)));
      return [getNodeId(node), node];
    }));
    base.set(canvas, coordinates);
    const step = index === 1 ? {
      replayKind: 'relation', replayRelationIdentity: { stageIndex: 1, relationIndex: 0 },
      replayRelationLinks: [{ authoredRelationKey: '1:0', renderFamily: 'trajectory', priorSourceNodeId: 'source', witnessNodeId: 'source', targetNodeId: 'landing' }]
    } : { replayKind: 'micro', operation: index === 2 ? 'LexicalSelect' : 'ExternalMerge', targetNodeId: index === 2 ? 'newHead' : 'predicate' };
    return { canvas, coordinates, nodes, size: [8000, 3000], step };
  });
  const render = (scene, coordinates) => {
    const root = d3.hierarchy(scene.canvas); applyVizIds(root);
    return root.descendants().filter(node => scene.nodes.has(getNodeId(node))).map(node => Object.assign(node, coordinates.get(getNodeId(node))));
  };
  const result = reserveCompleteComponentLifetime(scenes, base, 'ltr', 2, 'predicate', render, { throughRelations: true });
  return { base, scenes, result, points: index => result.get(scenes[index].canvas) };
}

test('a later complete workspace supplies one coherent current grid through an earlier head change', () => {
  const { points, base, scenes } = example();
  const before = points(0);
  assert.equal(before.get('sister').y, 101);
  assert.equal(before.get('core').y, 101, 'current sisters share a row');
  assert.equal(before.get('host').y, 202);
  assert.equal(before.get('source').y, 202);
  assert.equal(before.get('sourceWord').y, 303, 'full earlier source retains a complete one-rank stem');
  assert.equal(before.get('sourceWord').x - before.get('source').x, 0, 'vertical reconciliation does not bend the source stem');
  for (const [id, node] of scenes[1].nodes) assert.deepEqual(points(1).get(id), points(2).get(id), `${id} remains fixed during unrelated selection`);
  assert.equal(base.get(scenes[0].canvas).get('core').y, 100, 'source reservations remain immutable');
});

test('inconsistent retained ranks do not produce an invented compromise grid', () => {
  const { points } = example({ finalY: node => node.data.id === 'sisterWord' ? 320 : node.depth * 101 });
  assert.equal(points(0).get('core').y, 100, 'an unreserved current branch is not rescaled from conflicting samples');
});

test('a single retained rank cannot establish new spacing for the current parent', () => {
  const { points } = example({ singleRank: true, finalY: node => node.depth * 100 + 25 });
  assert.equal(points(0).get('predicate').y, 0);
  assert.equal(points(0).get('sister').y, 125);
  assert.equal(points(0).get('source').y, 125);
});

test('an invisible future parent keeps a separate visible island outside the current grid', () => {
  const { points, base, scenes } = example({ hiddenIsland: true });
  assert.equal(points(0).get('core').y, 101);
  for (const id of ['island', 'islandWord']) assert.deepEqual(points(0).get(id), base.get(scenes[0].canvas).get(id));
});
