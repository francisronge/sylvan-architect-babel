import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTier2FacetEvidence } from '../replay/relations/relationEvidence.ts';
import { recoverResultAssignments } from '../replay/relations/resultAssignments.ts';
import { evaluateTier2FacetRecipe, TIER2_FACET_RECIPE_BY_ID } from '../replay/relations/tier2FacetRecipes.ts';

const forest = [{ id: 'clause', label: 'TP', children: [
  { id: 'finite', label: 'T[present, finite]', word: 'works' },
  { id: 'phrase', label: 'DP', word: 'she' }
] }];
const relation = {
  relation: 'T-subject Agree', anchors: { probe: 'finite', goal: 'phrase' },
  values: { result: ['third-person singular agreement on T', 'nominative Case on the subject DP'] }
};
const recover = (record = relation, workspace = forest) => recoverResultAssignments(record,
  buildTier2FacetEvidence({ relation: record, currentForest: workspace }));

test('result lists recover the existing Case and feature recipes with exact original item ownership', () => {
  const before = structuredClone({ relation, forest });
  const scopes = recover();
  assert.equal(scopes.length, 2);
  assert.deepEqual(scopes.map(scope => scope.origins), [
    { anchors: { probe: [0], goal: [0] }, values: { result: [0] } },
    { anchors: { probe: [0], goal: [0] }, values: { result: [1] } }
  ]);
  assert.deepEqual(scopes[0].evidence.values['feature.rows'], [relation.values.result[0]]);
  assert.deepEqual(scopes[1].evidence.values['case.literal'], [relation.values.result[1]]);
  for (const scope of scopes) {
    assert.equal(scope.kind, 'feature.dependency');
    assert.deepEqual(scope.evidence.currentAnchors, { 'feature.source': ['finite'], 'feature.target': ['phrase'] });
    assert.deepEqual(evaluateTier2FacetRecipe(TIER2_FACET_RECIPE_BY_ID.get(scope.kind), scope.evidence).failures, []);
  }
  assert.deepEqual({ relation, forest }, before);
});

test('ownership follows unique authored roles and categories across label and statement ordering changes', () => {
  const record = {
    relation: 'Inflection-object agreement', anchors: { probe: 'head', goal: 'object' },
    values: { result: ['accusative Case on the goal', 'feminine plural agreement on I'] }
  };
  const workspace = [{ id: 'head', label: 'I⁰[past]' }, { id: 'object', label: 'NP' }];
  const scopes = recover(record, workspace);
  assert.equal(scopes.length, 2);
  assert.deepEqual(scopes.map(scope => scope.origins.values.result), [[1], [0]]);
  for (const scope of scopes) assert.deepEqual(evaluateTier2FacetRecipe(
    TIER2_FACET_RECIPE_BY_ID.get(scope.kind), scope.evidence).failures, []);
  const categoryTarget = { ...record, values: { result: ['feminine plural agreement on probe', 'accusative Case on the object NP'] } };
  assert.equal(recover(categoryTarget, workspace).length, 2);
  assert.equal(recover({ ...categoryTarget, relation: 'Inflection-subject agreement' }, workspace).length, 0);
});

test('result lists reject prose, conditions, negation, contradictory outcomes and conflicting feature values', () => {
  for (const result of [
    ['if third-person singular agreement on T', relation.values.result[1]],
    ['no third-person singular agreement on T', relation.values.result[1]],
    ['third-person singular agreement on T unless the clause is embedded', relation.values.result[1]],
    [relation.values.result[0], 'possibly nominative Case on the subject DP'],
    [relation.values.result[0], 'nominative Case on the subject DP but agreement fails'],
    [relation.values.result[0], relation.values.result[1], 'The proposed agreement is not established.'],
    [relation.values.result[0], 'third-person plural agreement on T'],
    ['third-person singular plural agreement on T'],
    [relation.values.result[1], 'accusative Case on the subject DP'],
    ['first-person singular agreement on T', 'third-person singular agreement on T'],
    ['The head receives third-person singular agreement on T']
  ]) assert.deepEqual(recover({ ...relation, values: { result } }), [], JSON.stringify(result));
  for (const status of ['failed', 'blocked', 'pending', 'unknown', 'The agreement was not established'])
    assert.deepEqual(recover({ ...relation, values: { ...relation.values, status } }), [], status);
  for (const name of ['possible T-subject Agree', 'failed T-subject agreement', 'not T-subject agreement', 'hypothetical agreement'])
    assert.deepEqual(recover({ ...relation, relation: name }), [], name);
  assert.deepEqual(recover({ ...relation, relation: 'Unrelated commentary' }), []);
  assert.deepEqual(recover({ ...relation, values: { ...relation.values, number: 'plural' } }), []);
  assert.deepEqual(recover({ ...relation, values: { result: relation.values.result[0] } }), []);
});

test('a result owner cannot be guessed from competing, missing or incorrectly categorized participants', () => {
  for (const anchors of [
    { probe: 'missing', goal: 'phrase' },
    { probe: ['finite', 'phrase'], goal: 'phrase' },
    { probe: 'finite', goal: 'finite' },
    { probe: 'finite', goal: 'phrase', collector: 'other' },
    { probe: 'finite', goal: 'phrase', target: 'other' }
  ]) assert.deepEqual(recover({ ...relation, anchors }), [], JSON.stringify(anchors));
  assert.deepEqual(recover(relation, [...forest, { id: 'finite', label: 'T' }]), []);
  assert.deepEqual(recover({ ...relation, anchors: { ...relation.anchors, context: 'other' } },
    [...forest, { id: 'other', label: 'T' }]), []);
  assert.deepEqual(recover({ ...relation, anchors: { ...relation.anchors, subject: 'other' } },
    [...forest, { id: 'other', label: 'DP' }]), [], 'a named subject cannot be overridden by the relation-label qualifier');
  assert.deepEqual(recover(relation, [{ id: 'finite', label: 'V' }, { id: 'phrase', label: 'DP' }]), []);
  assert.deepEqual(recover(relation, [{ id: 'finite', label: 'T′' }, { id: 'phrase', label: 'DP' }]), []);
  assert.deepEqual(recover(relation, [{ id: 'finite', label: 'T' }, { id: 'phrase', label: 'PP' }]), []);
  assert.deepEqual(recover({ ...relation, values: { result: ['third-person singular agreement on DP', 'nominative Case on T'] } }), []);
});
