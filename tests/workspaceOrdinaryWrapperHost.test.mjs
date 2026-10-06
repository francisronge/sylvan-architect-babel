import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { reserveCompleteComponentLifetime } from '../replay/workspaceComponentLifetime.ts';

const atom = (id, extra = {}) => ({ id, label: id, ...extra });
const branch = (id, children) => ({ id, label: id, children });
function example({ direction = 'ltr', wrongTarget = false, relation = false, changedWord = false,
  changedOwner = false, otherAddition = false, loose = false, ownerRelabelled = false, reserveContainer = false, shiftPeer = false } = {}) {
  const host = prior => branch('host', [atom('word', { word: prior && changedWord ? 'old' : 'current' })]);
  const peer = () => shiftPeer ? branch('peer', [atom('peerWord', { word: 'peer word' })]) : atom('peer');
  const first = loose ? branch('forest', [host(true), peer()])
    : branch(changedOwner ? 'oldParent' : 'parent', [peer(), host(true)]);
  const after = () => ({ ...branch('parent', [peer(), branch('wrapper', [host(false), atom('arrival')]),
    ...(otherAddition ? [atom('unrelatedNew')] : [])]), ...(ownerRelabelled ? { label: 'changed parent' } : {}) });
  const canvases = [first, after(), branch('forest', [after(), atom('selected')])];
  const base = new Map();
  const scenes = canvases.map((canvas, index) => {
    const root = d3.hierarchy(canvas); applyVizIds(root);
    const coordinates = new Map(root.descendants().map(node => {
      const id = getNodeId(node), x = id === 'peer' || id === 'peerWord' ? shiftPeer && index ? 500 : 100 : id === 'wrapper' ? 2000
        : id === 'host' || id === 'word' ? index ? 1500 : 900 : id === 'arrival' ? 2500 : 4000;
      const y = id === 'peerWord' ? 200 : id === 'peer' || id === 'wrapper' ? 100 : id === 'host' ? index ? 200 : 100
        : id === 'word' ? index ? 300 : 200 : id === 'arrival' ? 200 : 0;
      return [id, { x: direction === 'rtl' ? 6000 - x : x, y }];
    }));
    base.set(canvas, coordinates);
    const nodes = new Map(root.descendants().filter(node => getNodeId(node) !== 'forest').map(node => {
      const point = coordinates.get(getNodeId(node));
      return [getNodeId(node), Object.assign(node, { x: direction === 'rtl' ? 6000 - point.x : point.x, y: point.y })];
    }));
    return { canvas, nodes, coordinates, size: [6000, 2000], step: index === 1 && relation
      ? { replayKind: 'relation' } : { replayKind: 'micro', operation: index === 1 ? 'ExternalMerge' : 'LexicalSelect',
        targetNodeId: index === 1 ? wrongTarget ? 'unrelated' : 'wrapper' : 'selected' } };
  });
  const render = (scene, positions) => {
    const root = d3.hierarchy(scene.canvas); applyVizIds(root);
    return root.descendants().filter(node => scene.nodes.has(getNodeId(node))).map(node => {
      const point = positions.get(getNodeId(node));
      return Object.assign(node, { x: direction === 'rtl' ? 6000 - point.x : point.x, y: point.y });
    });
  };
  const authored = JSON.stringify(canvases);
  const result = reserveCompleteComponentLifetime(scenes, base, direction, 2, reserveContainer ? 'parent' : 'host', render, { throughRelations: true });
  assert.equal(JSON.stringify(canvases), authored);
  return { before: result.get(canvases[0]), after: result.get(canvases[1]) };
}
for (const direction of ['ltr', 'rtl']) {
  test(`${direction}: a complete nested child reserves its attachment x on its current row`, () => {
    const { before, after } = example({ direction });
    assert.equal(before.get('host').x, after.get('host').x);
    assert.equal(before.get('host').y, after.get('wrapper').y);
    assert.equal(before.get('host').y, before.get('peer').y);
    assert.notEqual(before.get('host').x, after.get('wrapper').x);
    for (const axis of ['x', 'y']) assert.equal(before.get('word')[axis] - before.get('host')[axis],
      after.get('word')[axis] - after.get('host')[axis]);
  });
  for (const [name, option] of [['different target', { wrongTarget: true }], ['relation moment', { relation: true }],
    ['changed child material', { changedWord: true }], ['different parent', { changedOwner: true }],
    ['another new sibling', { otherAddition: true }], ['independent prior child', { loose: true }],
    ['relabelled parent', { ownerRelabelled: true }]]) test(`${direction}: ${name} cannot claim the nested ordinary wrapper slot`, () => {
      const { before, after } = example({ direction, ...option });
      assert.notDeepEqual(before.get('host'), after.get('wrapper'));
    });
}

for (const direction of ['ltr', 'rtl']) {
  test(`${direction}: a containing reservation uses the same wrapper slot at its recursive child boundary`, () => {
    const { before, after } = example({ direction, reserveContainer: true });
    assert.equal(before.get('host').x, after.get('host').x);
    assert.equal(before.get('host').y, after.get('wrapper').y);
    assert.equal(before.get('host').y, before.get('peer').y);
    for (const axis of ['x', 'y']) assert.equal(before.get('word')[axis] - before.get('host')[axis],
      after.get('word')[axis] - after.get('host')[axis]);
  });
  test(`${direction}: a containing reservation keeps its maximal unchanged sister stationary during an internal join`, () => {
    const { before, after } = example({ direction, reserveContainer: true, shiftPeer: true });
    assert.deepEqual(before.get('peer'), after.get('peer'));
    assert.deepEqual(before.get('peerWord'), after.get('peerWord'));
  });
}
