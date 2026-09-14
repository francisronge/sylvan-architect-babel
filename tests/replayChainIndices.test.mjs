import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import {
  buildResolvedLinkTraceIndexMap,
  buildMovementChainIndexCatalogue,
  formatIndexedSurfaceForDisplayValue,
  formatTraceSurfaceForDisplayValue
} from '../replay/replayCompiler.ts';

const occurrence = (id, word = 'word') => ({ id, label: 'DP', word });
const movement = (sourceNodeId, targetNodeId, stepIndex = 0, extra = {}) => ({
  relation: 'Internal Merge', sourceNodeId, targetNodeId,
  witnessNodeId: sourceNodeId, renderFamily: 'trajectory',
  trajectoryKind: 'phrasal', stepIndex, ...extra
});

test('separate movement chains have distinct indices at both ends, regardless of relation positions', () => {
  const forest = ['john-low', 'john-high', 'wh-low', 'wh-high', 'unrelated']
    .map(id => occurrence(id, 'John'));
  const links = [
    movement('john-low', 'john-high', 1, { relationIndex: '7' }),
    { relation: 'Agree', sourceNodeId: 'john-high', targetNodeId: 'unrelated', relationIndex: '8' },
    movement('wh-low', 'wh-high', 2, { relationIndex: '19' })
  ];
  const original = structuredClone({ forest, links });
  const map = buildResolvedLinkTraceIndexMap(forest, links, 2);
  assert.deepEqual([...map], [['john-low', '1'], ['john-high', '1'], ['wh-low', '2'], ['wh-high', '2']]);
  const renumbered = links.map(link => ({ ...link, relationIndex: '99' }));
  assert.deepEqual(buildResolvedLinkTraceIndexMap(forest, renumbered, 2), map);
  assert.deepEqual({ forest, links }, original);
});

test('complete chain membership keeps indices stable through successive movement and scrubbing', () => {
  const forest = ['base', 'middle', 'high', 'other-low', 'other-high'].map(id => occurrence(id));
  const first = movement('base', 'middle', 1);
  const other = movement('other-low', 'other-high', 2);
  const last = movement('middle', 'high', 3);
  const catalogue = { forest, links: [first, other, last] };
  for (const activeStep of [1, 2, 3, 2, 1]) {
    const played = catalogue.links.filter(link => link.stepIndex <= activeStep);
    const map = buildResolvedLinkTraceIndexMap(forest, played, activeStep, catalogue);
    assert.equal(map.get('base'), '1');
    assert.equal(map.get('middle'), '1');
    assert.equal(map.get('other-low'), activeStep >= 2 ? '2' : undefined);
    assert.equal(map.get('high'), activeStep >= 3 ? '1' : undefined);
  }
});

test('a movement chain keeps its number when its drawing tier changes', () => {
  const forest = ['lower', 'upper'].map(id => occurrence(id));
  const exact = movement('lower', 'upper', 0, { relation: 'wh-movement' });
  const fallback = { ...exact, authoredRelationKey: '0:0', anchors: [
    { role: 'source', nodeId: 'lower' }, { role: 'landing', nodeId: 'upper' },
    { role: 'traceWitness', nodeId: 'lower' }
  ], renderFamily: 'authored-anchor-link' };
  delete fallback.trajectoryKind;
  assert.deepEqual(
    buildResolvedLinkTraceIndexMap(forest, [fallback], 0),
    buildResolvedLinkTraceIndexMap(forest, [exact], 0)
  );
});

test('numeric authored indices take precedence and generated indices avoid their collisions', () => {
  const forest = [occurrence('a-low', 't_4'), occurrence('a-high'),
    occurrence('b-low'), occurrence('b-high'), occurrence('unrelated', 'word₁')];
  const links = [movement('b-low', 'b-high', 0), movement('a-low', 'a-high', 1)];
  const map = buildResolvedLinkTraceIndexMap(forest, links, 1);
  assert.equal(map.get('a-low'), '4');
  assert.equal(map.get('a-high'), '4');
  assert.equal(map.get('b-low'), '2');
  assert.equal(map.get('b-high'), '2');
  assert.equal(formatIndexedSurfaceForDisplayValue('John₄', '2'), 'John₄');
  assert.equal(formatTraceSurfaceForDisplayValue('t_4', '2'), 't₄');
});

test('conflicting authored chain indices are preserved without synthesizing a resolution', () => {
  const forest = [occurrence('low', 'word₁'), occurrence('middle'), occurrence('high', 'word₂')];
  const original = structuredClone(forest);
  const map = buildResolvedLinkTraceIndexMap(forest, [movement('low', 'middle'), movement('middle', 'high')], 0);
  assert.equal(map.size, 0);
  assert.deepEqual(forest, original);
});

test('shared spelling and lineage alone do not establish a movement chain', () => {
  const forest = [occurrence('left'), occurrence('right')].map(node => ({ ...node, lineageId: 'same' }));
  const link = { relation: 'uninterpreted claim', sourceNodeId: 'left', targetNodeId: 'right',
    renderFamily: 'authored-anchor-link', authoredRelationKey: '0:0' };
  assert.equal(buildResolvedLinkTraceIndexMap(forest, [link], 0).size, 0);
});

test('the catalogue preserves removed occurrences and numeric indices authored in any stage', () => {
  const earlier = [occurrence('low', 'word₇'), occurrence('high'), occurrence('removed')];
  const later = [occurrence('low'), occurrence('high'), occurrence('new')];
  const links = [movement('low', 'high')];
  const catalogue = buildMovementChainIndexCatalogue([earlier, later], links);
  assert.ok(catalogue.forest.some(node => node.id === 'removed'));
  const map = buildResolvedLinkTraceIndexMap(later, links, 0, catalogue);
  assert.equal(map.get('low'), '7');
  assert.equal(map.get('high'), '7');
});

test('disappeared parents are resolved in their own stage, never against a later version of their child', () => {
  const stages = [{
    statement: 'First state.', stageRecord: 'First state.',
    relations: [{ relation: 'uninterpreted claim', anchors: { first: 'old-parent', second: 'anchor' } }],
    workspaceForest: [
      { id: 'old-parent', label: 'XP', children: [{ ...occurrence('child'), lineageId: 'earlier' }] },
      { ...occurrence('anchor'), lineageId: 'earlier' }
    ]
  }, {
    statement: 'Second state.', stageRecord: 'Second state.', relations: [],
    workspaceForest: [
      { id: 'new-parent', label: 'XP', children: [{ ...occurrence('child'), lineageId: 'later' }] },
      { ...occurrence('anchor'), lineageId: 'earlier' }
    ]
  }];
  const prepared = prepareReplay({ derivationStages: stages, sentence: 'word word', includePlayback: false });
  const links = prepared.movementChainIndexCatalogue.links;
  assert.equal(links.length, 1);
  assert.equal(links[0].identityKey, 'identity:lineage:earlier');
  assert.equal(buildResolvedLinkTraceIndexMap(stages[1].workspaceForest, links, 1,
    prepared.movementChainIndexCatalogue).size, 0);
});
