import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { unchangedSourceRankOffsets } from '../replay/sourceSiblingTranslation.ts';

function branch({ word = 'auxiliary', label = 'V', silent = false, extra = false } = {}) {
  return { id: 'source', label, silent, children: [
    { id: 'word', label: word, word }, ...(extra ? [{ id: 'future', label: 'T' }] : [])
  ] };
}
function nodes(data, gap, x = 0) {
  const root = d3.hierarchy(data); applyVizIds(root);
  return new Map(root.descendants().map(node => [getNodeId(node), Object.assign(node, { x, y: 100 + node.depth * gap })]));
}
for (const x of [0, 2000]) test(`${x}: an unchanged complete source keeps the landing's internal ranks at its current root slot`, () => {
  const current = nodes(branch(), 214.2857142857143, x), future = nodes(branch(), 214.6666666666667, x + 1000);
  const points = new Map([...future].map(([id, node]) => [id, { x: node.x, y: node.y }]));
  const before = JSON.stringify([...current].map(([id, node]) => [id, node.x, node.y]));
  const offsets = unchangedSourceRankOffsets(current.get('source'), current, future, points);
  assert.equal(offsets.get('source'), 0);
  assert.equal(offsets.get('word'), future.get('word').y - future.get('source').y);
  assert.notEqual(offsets.get('word'), current.get('word').y - current.get('source').y);
  assert.equal(JSON.stringify([...current].map(([id, node]) => [id, node.x, node.y])), before);
});
for (const [name, change] of [['different pronunciation', { word: 'changed' }], ['different category', { label: 'T' }],
  ['different silence', { silent: true }], ['unbuilt child', { extra: true }]]) test(`${name} cannot provide current source ranks`, () => {
  const current = nodes(branch(), 214), future = nodes(branch(change), 230);
  assert.equal(unchangedSourceRankOffsets(current.get('source'), current, future, future), undefined);
});
test('a missing member reservation cannot partially change a source grid', () => {
  const current = nodes(branch(), 214), future = nodes(branch(), 230), points = new Map(future);
  points.delete('word');
  assert.equal(unchangedSourceRankOffsets(current.get('source'), current, future, points), undefined);
});
test('a disconnected hidden wrapper cannot qualify as the same current branch', () => {
  const current = nodes(branch(), 214), future = nodes({ id: 'source', label: 'V', children: [
    { id: 'hidden', label: 'T', children: [{ id: 'word', label: 'auxiliary', word: 'auxiliary' }] }
  ] }, 230);
  future.delete('hidden');
  assert.equal(unchangedSourceRankOffsets(current.get('source'), current, future, future), undefined);
});
