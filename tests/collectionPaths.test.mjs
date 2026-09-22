import assert from 'node:assert/strict';
import test from 'node:test';
import { collectionPathAttachment, coalesceCollectionPaths } from '../components/collectionPaths.ts';
import { featureRowKey } from '../replay/relations/featureComposition.ts';
import { planItemRelationRefs } from '../replay/relations/renderPlanCompiler.ts';

const claim = (value, relationIndex = 0) => ({ kind: 'directed-path', pathStyle: 'case-agree',
  fromNodeId: 'possessive', toNodeId: 'nominal', featureRow: { label: 'features', value },
  relationRef: { stageIndex: 0, relationIndex } });

test('reserved collector ports follow exact features when measured row heights differ', () => {
  const feminine = claim('feminine'), singular = claim('singular');
  const box = { x: 0, y: 0, width: 480, height: 238, collectionRows: [
    { sourceNodeId: 'nominal', featureKey: featureRowKey(feminine.featureRow), y: 120, edge: 'top', portX: 188 },
    { sourceNodeId: 'nominal', featureKey: featureRowKey(singular.featureRow), y: 180, edge: 'top', portX: 212 }
  ] };
  assert.equal(collectionPathAttachment(box, feminine).portX, 188);
  assert.equal(collectionPathAttachment(box, singular).portX, 212);
  assert.equal(collectionPathAttachment(box, { ...singular, toNodeId: 'another-occurrence' }), undefined);
  assert.equal(collectionPathAttachment(box, claim('dual')), undefined);
});

test('one identical collector retains every visible owner without changing the feature claims', () => {
  const first = claim('feminine', 1), second = { ...claim('singular', 2),
    coalescedRefs: [{ stageIndex: 1, relationIndex: 3 }] };
  const paths = [{ d: 'M 200 250 C 200 318 200 882 200 950', item: first },
    { d: 'M 200 250 C 200 318 200 882 200 950', item: second }];
  const original = JSON.stringify(paths);
  const grouped = coalesceCollectionPaths(paths);
  assert.equal(grouped.length, 1);
  assert.deepEqual(planItemRelationRefs(grouped[0].item).map(ref => [ref.stageIndex, ref.relationIndex]), [[0, 1], [0, 2], [1, 3]]);
  assert.equal(JSON.stringify(paths), original, 'drawing consolidation must leave authored row claims intact');
  assert.deepEqual(planItemRelationRefs(coalesceCollectionPaths(paths.slice(0, 1))[0].item), [first.relationRef],
    'an unrevealed later collector cannot acquire ownership early');
});

test('different paths or exact endpoints remain separate, including the two D6 source rows', () => {
  const item = claim('plural');
  const paths = [
    { d: 'M 200 120 C 268 120 400 400 500 400', item },
    { d: 'M 200 180 C 268 180 400 400 500 400', item: claim('masculine') },
    { d: 'M 200 120 C 268 120 400 400 500 400', item: { ...item, toNodeId: 'another-occurrence' } },
    { d: 'M 200 120 C 268 120 400 400 500 400', item: { ...item, fromNodeId: 'another-holder' } }
  ];
  assert.deepEqual(coalesceCollectionPaths(paths), paths);
  assert.equal(coalesceCollectionPaths([paths[0]]).length + coalesceCollectionPaths([paths[0]]).length, 2,
    'separate plaques never share a drawing bucket');
});
