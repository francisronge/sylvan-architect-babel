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

test('identical collector curves preserve separate successful and blocked owners', () => {
  const success = claim('plural', 0), blocked = { ...claim('plural', 1), outcome: 'blocked' };
  const d = 'M 0 0 C 0 40 100 60 100 100';
  const paths = coalesceCollectionPaths([{ d, item: success }, { d, item: blocked }]);
  assert.equal(paths.length, 2);
  assert.deepEqual(paths.map(p => [p.item.outcome, planItemRelationRefs(p.item).map(r => r.relationIndex)]),
    [[undefined, [0]], ['blocked', [1]]]);
  const repeated = coalesceCollectionPaths([{ d, item: blocked }, { d, item: { ...blocked, relationRef: { stageIndex: 0, relationIndex: 2 } } }]);
  assert.equal(repeated.length, 1);
  assert.equal(repeated[0].item.outcome, 'blocked');
  assert.deepEqual(planItemRelationRefs(repeated[0].item).map(r => r.relationIndex), [1, 2]);
});

test('different feature rows of one exact failed comparison share a cue, not a path', () => {
  const first = { ...claim('plural'), outcome: 'blocked', tier2ClaimIdentity: 'comparison-a' };
  const second = { ...first, featureRow: { label: 'actual', value: 'singular' } };
  const paths = [{ d: 'M 20 0 C 20 40 100 60 100 100', item: first },
    { d: 'M 0 0 C 0 40 100 60 100 100', item: second }];
  const original = structuredClone(paths);
  const drawn = coalesceCollectionPaths(paths);
  assert.equal(drawn.length, 2);
  assert.deepEqual(drawn.map(path => path.item), paths.map(path => path.item));
  assert.deepEqual(drawn.map(path => path.d), paths.map(path => path.d));
  assert.equal(drawn.filter(path => path.failureCue !== false).length, 1);
  assert.deepEqual(drawn[0].failureCue, paths.map(path => path.d),
    'the shared cue must measure every row route in this exact comparison');
  assert.deepEqual(coalesceCollectionPaths([...paths].reverse())[0].failureCue,
    paths.map(path => path.d).reverse(), 'row order cannot choose which connector carries the comparison');
  assert.deepEqual(paths, original);
  assert.equal(coalesceCollectionPaths(paths.slice(1)).filter(path => path.failureCue !== false).length, 1,
    'a newly rendered plaque must own its cue independently of a prior render');
});

test('failure cues stay separate without identical compiled claims, endpoints and visible owners', () => {
  const item = { ...claim('plural'), outcome: 'blocked', tier2ClaimIdentity: 'comparison-a' };
  for (const other of [
    { ...item, tier2ClaimIdentity: 'comparison-b' },
    { ...item, toNodeId: 'another-nominal' },
    { ...item, fromNodeId: 'another-source' },
    { ...item, relationRef: { stageIndex: 0, relationIndex: 1 } },
    { ...item, composedRefs: [{ stageIndex: 1, relationIndex: 0 }] },
    { ...item, tier2ClaimIdentity: undefined }
  ]) {
    const drawn = coalesceCollectionPaths([{ d: 'M 20 0 C 20 40 100 60 100 100', item },
      { d: 'M 0 0 C 0 40 100 60 100 100', item: other }]);
    assert.equal(drawn.filter(path => path.failureCue !== false).length, 2);
    assert.deepEqual(drawn[0].failureCue, [drawn[0].d]);
    assert.deepEqual(drawn[1].failureCue ?? [drawn[1].d], [drawn[1].d]);
  }
});

test('a blocked Case and its feature rows share one failure cue while retaining their distinct native paths', () => {
  const comparison = { ...claim('singular'), outcome: 'blocked', tier2ClaimIdentity: 'failed-dependency' };
  const assignment = { ...comparison, pathStyle: 'case-assignment', label: 'nominative' };
  const input = [{ d: 'M 0 0 C 10 20 80 20 100 40', item: assignment },
    { d: 'M 0 50 C 10 60 80 60 100 70', item: comparison }];
  const original = structuredClone(input);
  const output = coalesceCollectionPaths(input);
  assert.equal(output.length, 2);
  assert.deepEqual(output.map(path => path.item.pathStyle), ['case-assignment', 'case-agree']);
  assert.deepEqual(output[0].failureCue, input.map(path => path.d));
  assert.equal(output[1].failureCue, false);
  assert.deepEqual(input, original);
  const sameInk = coalesceCollectionPaths(input.map(path => ({ ...path, d: input[0].d })));
  assert.equal(sameInk.length, 2, 'a solid assignment and dotted collection cannot replace each other');
  const independent = coalesceCollectionPaths([input[0], { ...input[1], item: {
    ...comparison, tier2ClaimIdentity: 'another-comparison' } }]);
  assert.equal(independent.filter(path => path.failureCue !== false).length, 2);
  const successfulCase = coalesceCollectionPaths([{ ...input[0], item: { ...assignment, outcome: 'licensed' } }, input[1]]);
  assert.equal(successfulCase[0].failureCue, undefined, 'independent successful Case acquires no failure cue');
  assert.deepEqual(successfulCase[1].failureCue, [input[1].d]);
});
