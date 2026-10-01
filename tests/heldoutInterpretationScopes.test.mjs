import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTier2FacetEvidence, dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { recoverPredication } from '../replay/relations/predicationRecovery.ts';
import { recoverInterpretedOperatorBinding } from '../replay/relations/interpretedBindingEvidence.ts';

const leaf = (id, label, extra = {}) => ({ id, label, ...extra });
const toughForest = [{ id: 'matrix', label: 'PredP', children: [leaf('subject', 'DP'), {
  id: 'adjective', label: 'AP', children: [leaf('a', 'A'), { id: 'embedded', label: 'CP', children: [
    leaf('operator', 'D[operator]', { silent: true, lineageId: 'operator-chain' }),
    { id: 'clause', label: 'TP', children: [leaf('variable', 'D[operator]', { silent: true, lineageId: 'operator-chain' })] }
  ] }]
}] }, leaf('other', 'DP'), leaf('wrong-domain', 'CP')];
const tough = { relation: 'tough predication linkage', anchors: {
  adjectivalPredicate: 'adjective', matrixSubject: 'subject', operator: 'operator', embeddedVariable: 'variable'
}, values: { dependencyType: 'Matrix predication linked to an embedded operator-bound object variable.', interpretation: 'authored interpretation' } };
const relativeForest = [{ id: 'nominal', label: 'D', children: [
  { id: 'relative', label: 'C', children: [leaf('operator', 'D', { silent: true })] },
  { id: 'determiner', label: 'D', children: [leaf('noun', 'N')] }
] }, leaf('other', 'DP')];
const relative = { relation: 'relative predication', anchors: {
  modifiedNominal: 'nominal', nominalHead: 'noun', relativeOperator: 'operator'
}, values: { interpretation: 'authored restrictive property' } };
const resumptionForest = [{ id: 'root', label: 'Top', children: [leaf('topic', 'D'), {
  id: 'comment', label: 'T', children: [leaf('pronoun', 'D', { silent: true }), leaf('topic-head', 'Top', { silent: true })]
}] }, leaf('other', 'D')];
const resumption = { relation: 'topic-linked null-object resumption', anchors: {
  topic: 'topic', resumptivePronoun: 'pronoun', comment: 'comment', topicHead: 'topic-head'
}, values: { dependency: 'discourse-anaphoric coreference, not syntactic occurrence identity', interpretation: 'base-generated aboutness topic' } };
const dispatch = (relation, currentForest) => dispatchRelationClaims({ relation, currentForest, stageIndex: 0, relationIndex: 0 });
const by = (relation, forest, recipe) => dispatch(relation, forest).claims.filter(claim => claim.tier === 2 && claim.facet.recipe.id === recipe);
const evidence = (relation, currentForest) => buildTier2FacetEvidence({ relation, currentForest });

test('tough predication earns two independent native claims with no matrix-subject movement', () => {
  const result = dispatch(tough, toughForest);
  const claims = result.claims.filter(claim => claim.tier === 2);
  assert.deepEqual(claims.map(claim => claim.facet.recipe.id), ['predication.dependency', 'operator-binding']);
  assert.deepEqual(claims.map(claim => claim.facet.evidence.currentAnchors), [
    { predicate: ['adjective'], predicand: ['subject'] }, { operator: ['operator'], variable: ['variable'] }
  ]);
  assert.deepEqual(result.evidenceCoverage.fields.filter(field => field.field === 'values').map(field => [field.key, field.unrecoveredItemIndices]),
    [['dependencyType', [0]], ['interpretation', [0]]]);
  for (const key of ['adjectivalPredicate', 'matrixSubject', 'operator', 'embeddedVariable']) {
    const changed = structuredClone(tough);
    changed.anchors[key] = 'absent';
    assert.equal(by(changed, toughForest, ['adjectivalPredicate', 'matrixSubject'].includes(key) ? 'predication.dependency' : 'operator-binding').length, 0);
  }
});

test('qualified predication rejects competing owners, repeated IDs, wrong categories, and provisional assertions', () => {
  for (const [relation, forest] of [[tough, toughForest], [relative, relativeForest]]) {
    for (const extra of [{ predicate: 'other' }, { predicand: 'other' }, { recipient: 'other' }])
      assert.equal(recoverPredication(evidence({ ...relation, anchors: { ...relation.anchors, ...extra } }, forest)).length, 0);
    for (const prefix of ['No', 'Not', 'Pending', 'Possible', 'Required', 'Rejected'])
      assert.equal(by({ ...relation, relation: `${prefix} ${relation.relation}` }, forest, 'predication.dependency').length, 0);
    assert.equal(by({ ...relation, relation: `${relation.relation} if licensed` }, forest, 'predication.dependency').length, 0);
    assert.equal(by({ ...relation, values: { ...relation.values, status: 'pending' } }, forest, 'predication.dependency').length, 0);
  }
  assert.equal(by(tough, [...toughForest, leaf('adjective', 'AP')], 'predication.dependency').length, 0);
  const wrong = structuredClone(toughForest); wrong[0].children[1].label = 'VP';
  assert.equal(by(tough, wrong, 'predication.dependency').length, 0);
});

test('tough operator linkage needs an explicit binding assertion and a unique current lineage pair', () => {
  for (const dependencyType of ['operator and object variable', 'No operator-bound object variable',
    'Possible operator-bound object variable', 'operator-bound object variable if licensed'])
    assert.equal(by({ ...tough, values: { ...tough.values, dependencyType } }, toughForest, 'operator-binding').length, 0);
  assert.equal(by({ ...tough, values: { interpretation: 'operator-bound object variable' } }, toughForest, 'operator-binding').length, 0);
  for (const extra of [{ variable: 'other' }, { relativeOperator: 'other' }, { scopeDomain: 'wrong-domain' }])
    assert.equal(by({ ...tough, anchors: { ...tough.anchors, ...extra } }, toughForest, 'operator-binding').length, 0);
  assert.equal(by(tough, [...toughForest, leaf('variable', 'D', { lineageId: 'operator-chain' })], 'operator-binding').length, 0);
  const changed = structuredClone(toughForest); changed[0].children[1].children[1].children[1].children[0].lineageId = 'other-chain';
  assert.equal(by(tough, changed, 'operator-binding').length, 0);
  delete changed[0].children[1].children[1].children[1].children[0].lineageId;
  assert.equal(by(tough, changed, 'operator-binding').length, 0);
  assert.equal(recoverInterpretedOperatorBinding(evidence({ ...tough, anchors: { ...tough.anchors, variable: 'other' } }, toughForest)).length, 0);
});

test('operator linkage preserves its optional native domain and index', () => {
  const relation = { ...tough, anchors: { ...tough.anchors, scopeDomain: 'embedded' }, values: { ...tough.values, variableIndex: 'j' } };
  const claims = by(relation, toughForest, 'operator-binding');
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0].facet.evidence.currentAnchors['scope.domain'], ['embedded']);
  assert.deepEqual(claims[0].facet.evidence.values.index, ['j']);
  assert(claims[0].consumedEvidence.some(ref => ref.key === 'variableIndex'));
  for (const values of [{ ...relation.values, index: 'k' }, { ...relation.values, variableIndex: ['j', 'k'] }, { ...relation.values, variableIndex: '' }])
    assert.equal(by({ ...relation, values }, toughForest, 'operator-binding').length, 0);
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

test('discourse coreference survives denial of syntactic identity without creating binding or movement', () => {
  const result = dispatch(resumption, resumptionForest), claims = result.claims.filter(claim => claim.tier === 2);
  assert.deepEqual(claims.map(claim => claim.facet.recipe.id), ['coreference.coindex']);
  assert.deepEqual(claims[0].facet.evidence.currentAnchors['coreference.participants'], ['topic', 'pronoun']);
  const indexed = by({ ...resumption, values: { ...resumption.values, index: 'k' } }, resumptionForest, 'coreference.coindex');
  assert.deepEqual(indexed[0].facet.evidence.values.index, ['k']);
  for (const dependency of ['no discourse-anaphoric coreference', 'possible discourse-anaphoric coreference',
    'discourse-anaphoric coreference if licensed', 'discourse-anaphoric coreference, not reference',
    'not syntactic occurrence identity', 'syntactically licensed topic binding'])
    assert.equal(by({ ...resumption, values: { ...resumption.values, dependency } }, resumptionForest, 'coreference.coindex').length, 0);
  for (const extra of [{ antecedent: 'other' }, { pronoun: 'other' }, { binder: 'other' }, { coreferents: ['topic', 'other'] }])
    assert.equal(by({ ...resumption, anchors: { ...resumption.anchors, ...extra } }, resumptionForest, 'coreference.coindex').length, 0);
  assert.equal(by(resumption, [...resumptionForest, leaf('pronoun', 'D')], 'coreference.coindex').length, 0);
  assert.equal(by({ ...resumption, values: { ...resumption.values, status: 'pending' } }, resumptionForest, 'coreference.coindex').length, 0);
  assert.equal(by({ ...resumption, values: { ...resumption.values, index: ['j', 'k'] } }, resumptionForest, 'coreference.coindex').length, 0);
  const residual = result.evidenceCoverage.fields.filter(field => field.unrecoveredItemIndices.length).map(field => field.key);
  assert(residual.includes('dependency') && residual.includes('interpretation') && residual.includes('comment') && residual.includes('topicHead'));
});

test('interrogative binding uses the question head and wh determiner without inventing a variable or movement', () => {
  const forest = [{ id: 'clause', label: 'CP', children: [leaf('question', 'C: interrogative'), {
    id: 'phrase', label: 'KP', children: [{ id: 'determiners', label: 'DetP', children: [leaf('wh', 'Det')] }, leaf('noun', 'N')]
  }] }, leaf('other', 'D'), leaf('wrong-domain', 'CP')];
  const relation = { relation: 'interrogative binding', anchors: { questionHead: 'question', whDeterminer: 'wh', whPhrase: 'phrase' },
    values: { interpretation: 'authored question interpretation', scope: 'matrix question' } };
  const claims = dispatch(relation, forest).claims.filter(claim => claim.tier === 2);
  assert.deepEqual(claims.map(claim => claim.facet.recipe.id), ['binding.dependency']);
  assert.deepEqual(claims[0].facet.evidence.currentAnchors, { binder: ['question'], dependent: ['wh'] });
  const indexed = { ...relation, anchors: { ...relation.anchors, domain: 'clause' }, values: { ...relation.values, index: 'j' } };
  assert.deepEqual(by(indexed, forest, 'binding.dependency')[0].facet.evidence.values.index, ['j']);
  assert.deepEqual(by(indexed, forest, 'binding.dependency')[0].facet.evidence.currentAnchors.domain, ['clause']);
  for (const extra of [{ binder: 'other' }, { dependent: 'other' }, { variable: 'other' }, { operator: 'other' }, { domain: 'wrong-domain' }])
    assert.equal(by({ ...relation, anchors: { ...relation.anchors, ...extra } }, forest, 'binding.dependency').length, 0);
  for (const prefix of ['No', 'Not', 'Pending', 'Possible', 'Required', 'Rejected'])
    assert.equal(by({ ...relation, relation: `${prefix} interrogative binding` }, forest, 'binding.dependency').length, 0);
  assert.equal(by({ ...relation, relation: 'interrogative binding if licensed' }, forest, 'binding.dependency').length, 0);
  assert.equal(by({ ...relation, values: { ...relation.values, status: 'pending' } }, forest, 'binding.dependency').length, 0);
  assert.equal(by(relation, [...forest, leaf('wh', 'Det')], 'binding.dependency').length, 0);
  for (const label of ['T[Q]', 'CP[Q]', 'C: declarative', 'C: not interrogative', 'C: possible interrogative']) {
    const changed = structuredClone(forest); changed[0].children[0].label = label;
    assert.equal(by(relation, changed, 'binding.dependency').length, 0);
  }
  for (const label of ['C[+Q]', 'C[Q]', 'Q']) {
    const changed = structuredClone(forest); changed[0].children[0].label = label;
    assert.equal(by(relation, changed, 'binding.dependency').length, 1);
  }
  const detached = structuredClone(forest); detached.push(detached[0].children[1].children[0].children.pop());
  assert.equal(by(relation, detached, 'binding.dependency').length, 0);
  const residual = dispatch(relation, forest).evidenceCoverage.fields.filter(field => field.unrecoveredItemIndices.length).map(field => field.key);
  assert.deepEqual(residual, ['whPhrase', 'interpretation', 'scope']);
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
