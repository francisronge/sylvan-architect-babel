import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const example = (label = 'AgrO⁰') => ({
  relation: { relation: 'object agreement', anchors: { agreementHead: 'host', controller: 'nominal' },
    values: { nounClass: 'opaque class', number: 'plural' } },
  forest: [{ id: 'root', label: 'XP', children: [
    { id: 'host', label, word: 'agreement' },
    { id: 'nominal', label: 'NP', children: [{ id: 'noun', label: 'N', word: 'books' }] }
  ] }]
});
const dispatch = ({relation, forest}) => dispatchRelationClaims({relation, currentForest: forest, stageIndex: 0, relationIndex: 0});
const dependencies = input => dispatch(input).claims.filter(claim => claim.tier === 2 && claim.facet.recipe.id === 'feature.dependency');
const plan = ({relation, forest}) => compileRelationRenderPlan([{statement: '', stageRecord: '', workspaceForest: forest, relations: [relation]}]).frames[0].items;

for (const label of ['AgrO⁰', 'AgrS°', 'AgrObj^0', 'AgrSubj0', 'AgrNumber', 'AgrO [class: 8]', 'AgrO: object agreement']) {
  test(`a qualified agreement head ${label} retains the exact controller and rows`, () => {
    const input = example(label), original = structuredClone(input);
    const claims = dependencies(input);
    assert.equal(claims.length, 1);
    assert.deepEqual(claims[0].facet.evidence.currentAnchors['feature.source'], ['host']);
    assert.deepEqual(claims[0].facet.evidence.currentAnchors['feature.target'], ['nominal']);
    assert.deepEqual(claims[0].consumedEvidence.filter(ref => ref.field === 'values').map(ref => ref.key).sort(), ['nounClass', 'number']);
    const paths = plan(input).filter(item => item.kind === 'directed-path');
    assert.equal(paths.length, 2);
    assert(paths.every(path => path.fromNodeId === 'host' && path.toNodeId === 'nominal'));
    assert.equal(new Set(paths.map(path => path.tier2ClaimIdentity)).size, 1);
    assert.deepEqual(paths.map(path => path.featureRow), [
      {label: 'nounClass', value: 'opaque class'}, {label: 'number', value: 'plural'}
    ]);
    assert.deepEqual(input, original);
  });
}

test('existing inflectional labels keep the same agreement claim', () => {
  for (const label of ['T⁰', 'I⁰', 'Infl', 'Agr', 'Agr_O']) assert.equal(dependencies(example(label)).length, 1, label);
});

for (const label of ['AgrOP', 'AgrSP', 'AgrO′', 'AgrS\'', 'AgrO+V', 'AgrO (projection)', 'Agriculture', 'N', 'V', 'NP', 'Unknown']) {
  test(`the head-family repair does not promote ${label}`, () => {
    assert.equal(dependencies(example(label)).length, 0);
  });
}

test('new agreement categories do not override ambiguity or unasserted claims', () => {
  const input = example();
  for (const mutate of [
    value => value.forest[0].children.push({id: 'host', label: 'AgrO'}),
    value => value.forest[0].children.push({id: 'nominal', label: 'NP'}),
    value => { value.relation.anchors.controller = 'missing'; },
    value => { value.relation.anchors.controller = ['nominal', 'noun']; },
    value => { value.relation.anchors.agreementHead = ['host', 'noun']; },
    value => { value.relation.anchors.goal = 'noun'; },
    value => { value.relation.anchors.mediator = 'noun'; },
    value => { value.relation.relation = 'possible object agreement'; },
    value => { value.relation.values = {}; }
  ]) {
    const changed = structuredClone(input); mutate(changed);
    assert.equal(dependencies(changed).length, 0, JSON.stringify(changed));
  }
});

test('the repair keeps occurrence IDs, relation wording and feature values open', () => {
  const input = example('AgrObject');
  input.forest[0].children[0].id = 'opaque-head'; input.forest[0].children[1].id = 'opaque-goal';
  input.relation.anchors = {controller: 'opaque-goal', agreementHead: 'opaque-head'};
  input.relation.relation = 'local nominal agreement';
  input.relation.values = {number: 'dual', nounClass: 'authored value'};
  assert.equal(dependencies(input).length, 1);
  const path = plan(input).find(item => item.kind === 'directed-path');
  assert.deepEqual([path.fromNodeId, path.toNodeId], ['opaque-head', 'opaque-goal']);
});

test('an incomplete exact Agree claim remains an exact-signature failure', () => {
  const input = example(); input.relation.relation = 'Agree';
  const result = dispatch(input);
  assert.equal(result.primaryClaim.tier, 3);
  assert.equal(result.primaryClaim.reason, 'registered-signature-incomplete');
  assert.equal(dependencies(input).length, 0);
});
