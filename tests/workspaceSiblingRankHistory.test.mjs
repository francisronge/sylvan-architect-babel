import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { reserveCompleteComponentLifetime } from '../replay/workspaceComponentLifetime.ts';

const leaf = (id, extra = {}) => ({ id, label: id, ...extra });
const branch = (id, children) => ({ id, label: id, children });
function example({ direction = 'ltr', changedWord = false, changedSilence = false, wrongOwner = false, relation = false, priorOwner = false } = {}) {
  const inner = prior => branch('inner', [leaf('word', {
    word: changedWord && prior ? 'old' : 'current', ...(changedSilence && prior ? { silent: true } : {}),
  })]);
  const left = prior => branch('left', [inner(prior)]);
  const right = () => branch('right', [leaf('rightWord')]);
  const together = () => branch('parent', [left(false), right()]);
  const canvases = [branch('forest', [inner(true), right()]), branch('forest', [priorOwner ? branch('oldOwner', [left(true)]) : left(true), right()]),
    together(), branch('forest', [together(), leaf('selected')])];
  const base = new Map();
  const scenes = canvases.map((canvas, index) => {
    const root = d3.hierarchy(canvas); applyVizIds(root);
    const coordinates = new Map(root.descendants().map(node => {
      const id = getNodeId(node);
      const rank = id === 'parent' ? 0 : ['left', 'right'].includes(id) ? 1
        : ['inner', 'rightWord'].includes(id) ? 2 : id === 'word' ? 3 : 0;
      const x = ['left', 'inner', 'word'].includes(id) ? 500 : id.startsWith('right') ? 4000 : 7000;
      return [id, { x: direction === 'rtl' ? 10000 - x : x, y: rank * (index === 3 ? 101 : 100) }];
    }));
    base.set(canvas, coordinates);
    const nodes = new Map(root.descendants().filter(node => getNodeId(node) !== 'forest').map(node => {
      const point = coordinates.get(getNodeId(node));
      return [getNodeId(node), Object.assign(node, { x: direction === 'rtl' ? 10000 - point.x : point.x, y: point.y })];
    }));
    return { canvas, nodes, coordinates, size: [10000, 3000], step: index === 2 && relation
      ? { replayKind: 'relation', replayRelationIdentity: { stageIndex: 1, relationIndex: 0 }, replayRelationLinks: [] }
      : { replayKind: 'micro', operation: index === 2 ? 'ExternalMerge' : index === 3 ? 'LexicalSelect' : 'Project',
        targetNodeId: index === 2 ? wrongOwner ? 'other' : 'parent' : index === 1 ? 'left' : index === 0 ? 'inner' : 'selected' } };
  });
  const render = (scene, coordinates) => {
    const root = d3.hierarchy(scene.canvas); applyVizIds(root);
    return root.descendants().filter(node => scene.nodes.has(getNodeId(node))).map(node => {
      const point = coordinates.get(getNodeId(node));
      return Object.assign(node, { x: direction === 'rtl' ? 10000 - point.x : point.x, y: point.y });
    });
  };
  const authored = JSON.stringify(canvases);
  const result = reserveCompleteComponentLifetime(scenes, base, direction, 3, 'right', render, { throughRelations: true });
  assert.equal(JSON.stringify(canvases), authored);
  return { points: index => result.get(canvases[index]), base: index => base.get(canvases[index]) };
}
for (const direction of ['ltr', 'rtl']) {
  test(`${direction}: a reconciled wrapper keeps its complete sibling contour through earlier construction`, () => {
    const { points, base } = example({ direction });
    for (const id of ['left', 'inner', 'word']) assert.deepEqual(points(1).get(id), points(2).get(id));
    for (const id of ['inner', 'word']) assert.deepEqual(points(0).get(id), points(1).get(id));
    assert.equal(points(0).get('word').y - points(0).get('inner').y, 101);
    assert.equal(base(0).get('word').y - base(0).get('inner').y, 100);
    for (const id of ['left', 'inner', 'word']) assert.equal(points(1).get(id).x, base(1).get(id).x);
  });
  for (const [name, option] of [['changed pronunciation', { changedWord: true }],
    ['changed silence', { changedSilence: true }], ['unowned wrapper', { wrongOwner: true }],
    ['relation moment', { relation: true }], ['previously contained fragment', { priorOwner: true }]]) test(`${direction}: ${name} cannot reserve an ordinary unchanged sibling contour`, () => {
    const { points, base } = example({ direction, ...option });
    for (const id of ['left', 'inner', 'word']) assert.deepEqual(points(1).get(id), base(1).get(id));
  });
}
