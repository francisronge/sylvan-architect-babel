import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { reserveCompleteComponentLifetime } from '../replay/workspaceComponentLifetime.ts';

const leaf = id => ({ id, label: id });
const branch = (id, children) => ({ id, label: id, children });
const object = () => branch('object', [{ ...leaf('determiner'), word: 'this' }, { ...leaf('noun'), word: 'book' }]);
const predicate = () => branch('predicate', [leaf('subject'), branch('verbDomain', [object(), leaf('verb')])]);

function example({ changedMaterial = false, changedParent = false } = {}) {
  const before = predicate();
  const after = () => {
    const old = predicate(), domain = old.children[1], lower = domain.children[0];
    if (changedMaterial) lower.silent = true;
    if (changedParent) domain.children[0] = branch('differentParent', [lower]);
    return branch('phaseEdge', [leaf('landing'), old]);
  };
  const merged = after(), canvases = [before, merged, branch('workspace', [after(), leaf('next')])];
  const base = new Map();
  const scenes = canvases.map((canvas, index) => {
    const root = d3.hierarchy(canvas); applyVizIds(root);
    const offset = index === 2 ? 1 : 0;
    const coordinates = new Map(root.descendants().map(node => {
      const id = getNodeId(node);
      const x = id === 'next' ? 8000 : id === 'subject' ? 600 : id === 'landing' ? 100 : id === 'object' ? (index ? 1900 : 1500)
        : id === 'determiner' ? (index ? 1650 : 1400) : id === 'noun' ? (index ? 2150 : 1600)
        : id === 'verb' ? 2800 : id === 'verbDomain' ? (index ? 2350 : 2150) : 1000;
      return [id, { x, y: (node.depth - offset) * 180 }];
    }));
    base.set(canvas, coordinates);
    const nodes = new Map(root.descendants().filter(node => getNodeId(node) !== 'workspace')
      .map(node => [getNodeId(node), Object.assign(node, coordinates.get(getNodeId(node)))]));
    const step = index === 1 ? {
      replayKind: 'relation', replayRelationIdentity: { stageIndex: 1, relationIndex: 0 },
      replayRelationLinks: [{ authoredRelationKey: '1:0', renderFamily: 'trajectory',
        priorSourceNodeId: 'object', witnessNodeId: 'object', targetNodeId: 'landing' }]
    } : { replayKind: 'micro', operation: index === 2 ? 'LexicalSelect' : 'ExternalMerge', targetNodeId: index === 2 ? 'next' : 'predicate' };
    return { canvas, nodes, coordinates, size: [9000, 4000], step };
  });
  const render = (scene, coordinates) => {
    const root = d3.hierarchy(scene.canvas); applyVizIds(root);
    return root.descendants().filter(node => scene.nodes.has(getNodeId(node)))
      .map(node => Object.assign(node, coordinates.get(getNodeId(node))));
  };
  const result = reserveCompleteComponentLifetime(scenes, base, 'ltr', 2, 'phaseEdge', render, { throughRelations: true });
  return { before: result.get(before), after: result.get(merged), original: base.get(before) };
}

test('an exact unchanged lower occurrence can carry its complete current component through copy creation', () => {
  const { before, after } = example();
  for (const id of ['verbDomain', 'object', 'determiner', 'noun', 'verb']) assert.deepEqual(before.get(id), after.get(id), `${id} stays in the same place`);
  assert.notDeepEqual(before.get('object'), after.get('landing'), 'the lower occurrence does not inherit its new landing');
});

test('a changed lower occurrence does not lend its new contour to the preceding pronounced source', () => {
  const { before, original } = example({ changedMaterial: true });
  assert.equal(before.get('noun').x - before.get('determiner').x, original.get('noun').x - original.get('determiner').x);
});

test('a same-ID occurrence under a different current parent is not an unchanged lower survivor', () => {
  const { before, original } = example({ changedParent: true });
  assert.equal(before.get('noun').x - before.get('determiner').x, original.get('noun').x - original.get('determiner').x);
});
