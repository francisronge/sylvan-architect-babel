import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { reserveCompleteComponentLifetime } from '../replay/workspaceComponentLifetime.ts';

const atom = id => ({ id, label: id });
const branch = (id, children) => ({ id, label: id, children });

function example({ direction = 'ltr', retainedOwner = false, ownRelation = true } = {}) {
  const source = () => branch('mover', [atom('word')]);
  const priorHost = retainedOwner ? atom('compound') : atom('host');
  const currentHost = () => branch('compound', [atom('host'), source()]);
  const canvases = [
    branch('root', [priorHost, source()]),
    branch('root', [currentHost(), atom('lower')]),
    branch('root', [currentHost(), atom('lower'), atom('selected')]),
  ];
  const base = new Map();
  const scenes = canvases.map((canvas, index) => {
    const root = d3.hierarchy(canvas); applyVizIds(root);
    const coordinates = new Map(root.descendants().map(node => {
      const id = getNodeId(node);
      const x = id === 'compound' ? (index ? 2000 : 500)
        : id === 'host' ? (index ? 1800 : 500)
        : id === 'mover' || id === 'word' ? (index ? 2200 : 5000)
        : id === 'lower' ? 5000 : id === 'selected' ? 8000 : 3500;
      return [id, { x: direction === 'rtl' ? 10000 - x : x, y: node.depth * 200 }];
    }));
    base.set(canvas, coordinates);
    const nodes = new Map(root.descendants().map(node => {
      const point = coordinates.get(getNodeId(node));
      return [getNodeId(node), Object.assign(node, {
        x: direction === 'rtl' ? 10000 - point.x : point.x, y: point.y,
      })];
    }));
    return { canvas, nodes, coordinates, size: [10000, 4000], step: index === 1 ? {
      replayKind: 'relation', replayRelationIdentity: { stageIndex: 1, relationIndex: 0 },
      replayRelationLinks: [{ authoredRelationKey: ownRelation ? '1:0' : '1:1',
        renderFamily: 'trajectory', priorSourceNodeId: 'mover', witnessNodeId: 'lower', targetNodeId: 'mover' }],
    } : { replayKind: 'micro', operation: 'LexicalSelect', targetNodeId: 'selected' } };
  });
  const render = (scene, positions) => {
    const root = d3.hierarchy(scene.canvas); applyVizIds(root);
    return root.descendants().map(node => {
      const point = positions.get(getNodeId(node));
      return Object.assign(node, { x: direction === 'rtl' ? 10000 - point.x : point.x, y: point.y });
    });
  };
  const authored = JSON.stringify(canvases);
  const result = reserveCompleteComponentLifetime(scenes, base, direction, 2, 'compound', render, { throughRelations: true });
  assert.equal(JSON.stringify(canvases), authored);
  return { before: result.get(canvases[0]), after: result.get(canvases[1]), old: base.get(canvases[0]) };
}

for (const direction of ['ltr', 'rtl']) {
  for (const retainedOwner of [false, true]) test(`${direction}: landing-owned ${retainedOwner ? 'retained' : 'new'} host reserves its prior pose without owning the lower witness`, () => {
    const { before, after, old } = example({ direction, retainedOwner });
    assert.deepEqual(before.get(retainedOwner ? 'compound' : 'host'), after.get('compound'));
    assert.deepEqual(before.get('mover'), old.get('mover'), 'external prior source remains in its own pose');
    assert.deepEqual(before.get('word'), old.get('word'));
  });
  test(`${direction}: a different relation cannot claim the landing-owned host`, () => {
    const { before, old } = example({ direction, ownRelation: false });
    assert.deepEqual(before.get('host'), old.get('host'));
  });
}
