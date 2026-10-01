import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTier2FacetEvidence } from '../replay/relations/relationEvidence.ts';
import { recoverDeclarativeLicensing } from '../replay/relations/declarativeLicensing.ts';
import { evaluateTier2FacetRecipe, TIER2_FACET_RECIPE_BY_ID } from '../replay/relations/tier2FacetRecipes.ts';

const forest = [
  { id: 'cl', label: 'Cl⁰', word: 'le' },
  { id: 'dp', label: 'DP[dative]', children: [{ id: 'pro', label: 'pro', silent: true }] },
  { id: 'v', label: 'V', word: 'gave' }
];
const relation = { relation: 'dative clitic licensing',
  anchors: { clitic: 'cl', recipient: 'dp', predicate: 'v' },
  values: { features: 'third-person singular dative',
    status: 'The clitic licenses the silent recipient argument.' } };
const recover = (record = relation, workspace = forest) => recoverDeclarativeLicensing(
  buildTier2FacetEvidence({ relation: record, currentForest: workspace }));

test('explicit licensing preserves typed features and leaves the complete status neutral', () => {
  const before = structuredClone({ relation, forest });
  const scopes = recover();
  assert.equal(scopes.length, 1);
  const scope = scopes[0];
  assert.deepEqual(scope.evidence.currentAnchors, { 'feature.source': ['cl'], 'feature.target': ['dp'] });
  assert.deepEqual(scope.evidence.values, { 'feature.rows': ['third-person singular dative'] });
  assert.deepEqual(scope.origins, { anchors: { clitic: [0], recipient: [0] }, values: { features: [0] } });
  assert(!scope.evidence.authoredValues.some(entry => entry.key === 'status'));
  assert.deepEqual(evaluateTier2FacetRecipe(TIER2_FACET_RECIPE_BY_ID.get(scope.kind), scope.evidence).failures, []);
  assert.deepEqual({ relation, forest }, before);
});

test('licensing requires no particular relation name, language, node ID or endpoint role vocabulary', () => {
  const record = { relation: 'An authored dependency', anchors: { marker: 'x', dependent: 'y' },
    values: { features: 'plural', status: 'The marker licenses the dependent.' } };
  const scopes = recover(record, [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y', word: 'word' }]);
  assert.equal(scopes.length, 1);
  assert.deepEqual(scopes[0].evidence.currentAnchors, { 'feature.source': ['x'], 'feature.target': ['y'] });
  assert.deepEqual(scopes[0].evidence.values, { 'feature.rows': ['plural'] });
  const caseRecord = { ...record, values: { case: 'dative', status: record.values.status } };
  assert.deepEqual(recover(caseRecord, [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }])[0].evidence.values,
    { 'case.literal': ['dative'] });
});

test('negative, conditional, quoted, competing and contradictory licensing statements do not earn a scope', () => {
  for (const status of [
    'The clitic does not license the silent recipient argument.',
    'If the clitic licenses the silent recipient argument.',
    'The clitic may license the silent recipient argument.',
    'The clitic licenses the silent recipient argument unless agreement fails.',
    'The clitic licenses the silent recipient argument but the license fails.',
    'The clitic licenses the silent recipient argument and does not license it.',
    'The clitic licenses the silent recipient argument and this may be wrong.',
    'It is claimed that the clitic licenses the silent recipient argument.',
    '“The clitic licenses the silent recipient argument.”',
    'The clitic and predicate license the silent recipient argument.',
    'The unrelated head licenses the silent recipient argument.',
    'The clitic licenses the silent recipient argument. Actually, it does not.'
  ]) assert.deepEqual(recover({ ...relation, values: { ...relation.values, status } }), [], status);
  assert.deepEqual(recover({ ...relation, values: { status: relation.values.status } }), []);
  assert.deepEqual(recover({ ...relation, values: { ...relation.values, outcome: 'failed' } }), []);
  assert.deepEqual(recover({ ...relation, relation: 'Possible licensing' }), []);
  assert.deepEqual(recover({ ...relation, anchors: { ...relation.anchors, licensor: 'v' } }), []);
  assert.deepEqual(recover({ ...relation, anchors: { ...relation.anchors, goal: 'v' } }), []);
});

test('one additive property clause can share the exact source while all status text stays neutral', () => {
  for (const property of [
    'does not receive an additional theta role',
    'has a singular feature',
    'bears an independent property',
    'the clitic receives a morphological exponent',
    'the clitic does not have an independent feature'
  ]) {
    const status = `The clitic licenses the silent recipient argument and ${property}.`;
    const scopes = recover({ ...relation, values: { ...relation.values, status } });
    assert.equal(scopes.length, 1, status);
    assert.deepEqual(scopes[0].origins.values, { features: [0] });
    assert.equal(scopes[0].evidence.values['case.literal'], undefined);
  }
  for (const property of [
    'does not license it', 'the recipient licenses the clitic', 'the recipient has a feature',
    'it has a feature', 'they receive a feature', 'has its feature',
    'does not have a feature unless the recipient agrees', 'has a feature but the license fails',
    'has a feature and receives a role', 'has no licensing ability',
    'receives a blocked license', 'actually has a feature', 'does not receive a role if the dependency fails'
  ]) {
    const status = `The clitic licenses the silent recipient argument and ${property}.`;
    assert.deepEqual(recover({ ...relation, values: { ...relation.values, status } }), [], status);
  }
});

test('silent participant qualifications require authored silence throughout the exact uniquely resolved target', () => {
  for (const recipient of [
    { id: 'dp', label: 'DP' },
    { id: 'dp', label: 'DP', word: 'Ana' },
    { id: 'dp', label: 'DP', children: [{ id: 'one', label: 'D', silent: true }, { id: 'two', label: 'N', word: 'Ana' }] }
  ]) assert.deepEqual(recover(relation, [forest[0], recipient, forest[2]]), []);
  assert.equal(recover(relation, [forest[0], { id: 'dp', label: 'DP', silent: true }, forest[2]]).length, 1);
  assert.deepEqual(recover(relation, [...forest, { id: 'dp', label: 'DP', silent: true }]), []);
  assert.deepEqual(recover({ ...relation, anchors: { ...relation.anchors, 'silent recipient argument': 'v' } }), []);
  assert.deepEqual(recover({ ...relation, anchors: { ...relation.anchors, recipient: 'missing' } }), []);
});
