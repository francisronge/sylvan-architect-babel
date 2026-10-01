import assert from 'node:assert/strict';
import test from 'node:test';
import { readCategoryLabel } from '../replay/categoryLabel.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const head = (id, label, lineageId, children = []) => ({ id, label, lineageId, children });
const recover = input => recoverMovementEvidence(input.relation, input.currentForest, input.priorForest);
const dispatch = input => dispatchRelationClaims({ ...input, stageIndex: 1, relationIndex: 0 });
const find = (forest, id) => forest.flatMap(node => [node, ...flatten(node.children ?? [])]).find(node => node.id === id);
const flatten = forest => forest.flatMap(node => [node, ...flatten(node.children ?? [])]);

test('balanced trailing parenthetical annotations preserve the category and displayed label', () => {
  for (const [label, kind] of [['I (finite, present, third-person singular)', 'head'],
    ['V (future auxiliary, finite)', 'head'], ['NP (embedded subject)', 'phrase'],
    ['V′ (intermediate structure)', 'bar'], ['V (projection)', 'bar']]) {
    assert.equal(readCategoryLabel(label)?.kind, kind, label);
  }
  for (const label of ['V (finite', 'V finite)', 'V ()', 'V (finite) prose', 'VP+T (finite)', 'V+TP (finite)'])
    assert.equal(readCategoryLabel(label), undefined, label);
});

const nestedComplex = () => {
  const lower = head('low', 'T', 'finite', [head('lowV', 'V', 'verb'), head('lowT', 'T', 'tense')]);
  const host = head('host', 'C', undefined);
  return { priorForest: [{ id: 'domain', label: 'TP', children: [structuredClone(lower)] }, structuredClone(host)],
    currentForest: [{ id: 'clause', label: 'CP', children: [head('complex', 'C', undefined,
      [head('high', 'T', 'finite', [head('highV', 'V', 'verb'), head('highT', 'T', 'tense')]), host]),
    { id: 'domain', label: 'TP', children: [{ ...lower, silent: true }] }] }],
    relation: { relation: 'T-to-C head movement', anchors: { lowerHeadOccurrence: 'low', lowerVerbOccurrence: 'lowV',
      lowerTenseOccurrence: 'lowT', higherHeadOccurrence: 'high', higherVerbOccurrence: 'highV',
      higherTenseOccurrence: 'highT', target: 'host' }, priorAnchors: { source: 'low', target: 'host' } } };
};

test('a uniquely prior-bound head complex keeps nested members as context for one exact trajectory', () => {
  const input = nestedComplex(), original = structuredClone(input), movement = recover(input).movement;
  assert.equal(movement?.sourceNodeId, 'low'); assert.equal(movement?.targetNodeId, 'high');
  assert.equal(movement?.trajectoryKind, 'head');
  assert.deepEqual(movement.context.filter(item => item.kind === 'head-member').map(item => item.nodeId).sort(),
    ['lowV', 'lowT', 'highV', 'highT'].sort());
  const result = dispatch(input);
  assert.equal(result.facets.filter(facet => facet.recipe.id === 'movement.path').length, 1);
  assert(!result.claims.some(claim => claim.tier === 3 && claim.consumedEvidence.some(field =>
    field.field === 'anchors' && /(?:Verb|Tense)Occurrence/u.test(field.key))));
  assert.deepEqual(input, original);
});

test('nested head evidence cannot collapse competing, reordered, missing or duplicated members', () => {
  for (const mutate of [
    input => { find(input.currentForest, 'high').children.reverse(); },
    input => { find(input.currentForest, 'highV').lineageId = 'unrelated'; },
    input => { find(input.currentForest, 'highT').label = 'TP'; },
    input => { input.currentForest.push(structuredClone(find(input.currentForest, 'highV'))); },
    input => { input.priorForest.push(structuredClone(find(input.priorForest, 'lowV'))); },
    input => { input.relation.anchors.higherHeadOccurrence = ['high', 'another']; },
    input => { delete find(input.priorForest, 'low').lineageId; },
    input => { input.relation.anchors.landingOccurrence = 'other'; input.currentForest.push(head('other', 'T', 'finite')); }
  ]) {
    const input = nestedComplex(); mutate(input);
    assert.equal(recover(input).movement, undefined, mutate.toString());
  }
});

const containedCarrier = () => {
  const verb = { ...head('verb', 'V', 'lexical'), word: 'read' };
  const lowerContainer = head('inflection', 'I', undefined, [verb]);
  return { priorForest: [{ id: 'domain', label: 'IP', children: [structuredClone(lowerContainer)] }],
    currentForest: [{ id: 'clause', label: 'CP', children: [head('complementizer', 'C', undefined, [verb]),
      { id: 'domain', label: 'IP', children: [head('inflection', 'I', undefined,
        [head('trace', 'V', 'lexical')])] }] }],
    relation: { relation: 'I-to-C head movement', anchors: { movedHead: 'verb', sourceTrace: 'trace', landingHead: 'complementizer' },
      priorAnchors: { sourceHead: 'inflection', containedVerb: 'verb' } } };
};

test('a lineage-free prior head container scopes its one explicitly anchored lexical carrier', () => {
  const input = containedCarrier(), original = structuredClone(input), movement = recover(input).movement;
  assert.equal(movement?.priorSourceNodeId, 'verb');
  assert.equal(movement?.sourceNodeId, 'trace'); assert.equal(movement?.targetNodeId, 'verb');
  assert(movement?.priorContextKeys.includes('sourceHead'));
  assert(!movement?.priorAnchorKeys?.includes('sourceHead'));
  const result = dispatch(input);
  const container = result.evidenceCoverage.fields.find(field => field.field === 'priorAnchors' && field.key === 'sourceHead');
  assert.deepEqual(container.unrecoveredItemIndices, []);
  const listed = structuredClone(input); listed.relation.priorAnchors.sourceHead = ['inflection'];
  assert.deepEqual(dispatch(listed).evidenceCoverage.fields.find(field => field.field === 'priorAnchors' && field.key === 'sourceHead')
    .unrecoveredItemIndices, []);
  const stages = [input.priorForest, input.currentForest].map((workspaceForest, index) => ({
    statement: '', stageRecord: '', workspaceForest, relations: index ? [input.relation] : [] }));
  const paths = compileRelationRenderPlan(stages).frames[1].items.filter(item => item.kind === 'trajectory');
  assert.equal(paths.length, 1); assert.equal(paths[0].sourceNodeId, 'trace'); assert.equal(paths[0].targetNodeId, 'verb');
  assert.deepEqual(input, original);
});

test('prior container evidence requires unique member identity, exact preceding slot and head paths', () => {
  for (const mutate of [
    input => { find(input.priorForest, 'inflection').label = 'IP'; },
    input => { delete find(input.priorForest, 'verb').lineageId; },
    input => { find(input.currentForest, 'trace').lineageId = 'different'; },
    input => { input.currentForest.push(structuredClone(find(input.currentForest, 'trace'))); },
    input => { input.priorForest.push(structuredClone(find(input.priorForest, 'verb'))); },
    input => { input.priorForest = []; },
    input => { find(input.currentForest, 'inflection').children.unshift(head('other', 'Agr', 'other')); }
  ]) {
    const input = containedCarrier(); mutate(input);
    assert.equal(recover(input).movement, undefined, mutate.toString());
  }
});

test('head recovery preserves the malformed exact Tier 1 primary guard', () => {
  const input = nestedComplex(); input.relation.relation = 'Head movement';
  const result = dispatch(input);
  assert.equal(result.primaryClaim.tier, 3);
  assert(!result.facets.some(facet => facet.recipe.id === 'movement.path'));
});

test('generic Tier 1 landing-head context can name the exact complex without loosening explicit host roles', () => {
  const low = head('low', 'V', 'verb'), host = head('host', 'v', undefined);
  const input = { priorForest: [{ id: 'domain', label: 'VP', children: [structuredClone(low)] }, structuredClone(host)],
    currentForest: [{ id: 'phrase', label: 'vP', children: [head('complex', 'v', undefined,
      [host, head('high', 'V', 'verb')]), { id: 'domain', label: 'VP', children: [low] }] }],
    relation: { relation: 'head movement', anchors: { lowerOccurrence: 'low', higherOccurrence: 'high', landingHead: 'complex' },
      priorAnchors: { source: 'low', target: 'host' } } };
  assert.equal(dispatch(input).primaryClaim.tier, 1);
  for (const anchors of [{ ...input.relation.anchors, landingHead: 'phrase' },
    { lowerOccurrence: 'low', higherOccurrence: 'high', hostHead: 'complex' },
    { lowerOccurrence: 'low', landingHead: 'complex' }])
    assert.equal(dispatch({ ...input, relation: { ...input.relation, anchors } }).primaryClaim.tier, 3);
  assert.equal(dispatch({ ...input, currentForest: [...input.currentForest, structuredClone(input.currentForest[0].children[0])] }).primaryClaim.tier, 3);
});
