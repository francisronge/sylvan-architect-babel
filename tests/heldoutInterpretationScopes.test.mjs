import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTier2FacetEvidence } from '../replay/relations/relationEvidence.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { recoverPredication } from '../replay/relations/predicationRecovery.ts';

const leaf = (id, label, extra = {}) => ({ id, label, ...extra });
const relativeForest = [{ id: 'nominal', label: 'D', children: [
  { id: 'relative', label: 'C', children: [leaf('operator', 'D', { silent: true })] },
  { id: 'determiner', label: 'D', children: [leaf('noun', 'N')] }
] }, leaf('other', 'DP')];
const relative = { relation: 'relative predication', anchors: {
  modifiedNominal: 'nominal', nominalHead: 'noun', relativeOperator: 'operator'
}, values: { interpretation: 'authored restrictive property' } };
const dispatch = (relation, currentForest) => dispatchRelationClaims({ relation, currentForest, stageIndex: 0, relationIndex: 0 });
const by = (relation, forest, recipe) => dispatch(relation, forest).claims.filter(claim => claim.tier === 2 && claim.facet.recipe.id === recipe);
const evidence = (relation, currentForest) => buildTier2FacetEvidence({ relation, currentForest });

test('qualified predication rejects competing owners, repeated IDs, wrong categories, and provisional assertions', () => {
  for (const extra of [{ predicate: 'other' }, { predicand: 'other' }, { recipient: 'other' }])
    assert.equal(recoverPredication(evidence({ ...relative, anchors: { ...relative.anchors, ...extra } }, relativeForest)).length, 0);
  for (const prefix of ['No', 'Not', 'Pending', 'Possible', 'Required', 'Rejected'])
    assert.equal(by({ ...relative, relation: `${prefix} ${relative.relation}` }, relativeForest, 'predication.dependency').length, 0);
  assert.equal(by({ ...relative, relation: `${relative.relation} if licensed` }, relativeForest, 'predication.dependency').length, 0);
  assert.equal(by({ ...relative, values: { ...relative.values, status: 'pending' } }, relativeForest, 'predication.dependency').length, 0);
  const wrong = structuredClone(relativeForest); wrong[0].label = 'VP';
  assert.equal(by(relative, wrong, 'predication.dependency').length, 0);
});

test('relative predication uses the explicit nominal and operator while verifying nested head context', () => {
  const claims = by(relative, relativeForest, 'predication.dependency');
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0].facet.evidence.currentAnchors, { predicate: ['operator'], predicand: ['nominal'] });
  assert.equal(by({ ...relative, anchors: { ...relative.anchors, nominalHead: 'other' } }, relativeForest, 'predication.dependency').length, 0);
  assert.equal(by(relative, [...relativeForest, leaf('operator', 'D')], 'predication.dependency').length, 0);
  const detached = structuredClone(relativeForest); detached.push(detached[0].children[0].children.pop());
  assert.equal(by(relative, detached, 'predication.dependency').length, 0);
  const result = dispatch(relative, relativeForest);
  for (const key of ['nominalHead', 'interpretation'])
    assert(result.evidenceCoverage.fields.find(field => field.key === key).unrecoveredItemIndices.length);
});

test('external relative predication preserves its exact NP and operator and the proved sister attachment', () => {
  const forest = [{ id: 'modified', label: 'NP', children: [
    { id: 'relative-clause', label: 'CP: relative adjunct', children: [leaf('relative-operator', 'NP: null relative operator', { silent: true })] },
    { id: 'head', label: 'NP', children: [leaf('noun', 'N')] }
  ] }, leaf('other', 'NP')];
  const relation = { relation: 'relative predication', anchors: { nominalHead: 'head', operator: 'relative-operator', relativeClause: 'relative-clause' },
    values: { interpretation: 'authored restrictive property' } };
  const claims = dispatch(relation, forest).claims.filter(claim => claim.tier === 2);
  assert.deepEqual(claims.map(claim => claim.facet.recipe.id), ['predication.dependency', 'pair-merge']);
  assert.deepEqual(claims.map(claim => claim.facet.evidence.currentAnchors), [
    { predicate: ['relative-operator'], predicand: ['head'] }, { host: ['head'], 'pair.member': ['relative-clause'] }
  ]);
  for (const extra of [{ predicand: 'other' }, { predicate: 'other' }, { relativeOperator: 'other' }])
    assert.equal(recoverPredication(evidence({ ...relation, anchors: { ...relation.anchors, ...extra } }, forest)).length, 0);
  for (const anchors of [{ ...relation.anchors, nominalHead: 'noun' }, { ...relation.anchors, operator: 'other' }, { ...relation.anchors, relativeClause: 'other' }]) {
    const changed = { ...relation, anchors };
    assert.equal(by(changed, forest, 'predication.dependency').length, 0);
    assert.equal(by(changed, forest, 'pair-merge').length, 0);
  }
  assert.equal(by(relation, [...forest, leaf('relative-operator', 'NP')], 'predication.dependency').length, 0);
  const separated = structuredClone(forest); separated.push(separated[0].children.pop());
  assert.equal(by(relation, separated, 'predication.dependency').length, 0);
  assert.equal(by(relation, separated, 'pair-merge').length, 0);
  for (const label of ['No relative predication', 'Possible relative predication', 'relative predication if licensed'])
    assert.equal(by({ ...relation, relation: label }, forest, 'pair-merge').length, 0);
  assert.equal(by({ ...relation, values: { ...relation.values, status: 'pending' } }, forest, 'predication.dependency').length, 0);
});
