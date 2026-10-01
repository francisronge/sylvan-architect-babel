import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const forest = [
  { id: 'negative', label: 'Neg', word: 'なかっ' },
  { id: 'condition', label: 'T[past]', word: 'た' },
  { id: 'topic', label: 'DP', children: [{ id: 'noun', label: 'N', word: 'books' }] },
  { id: 'pronoun', label: 'D[pronominal]', silent: true },
  { id: 'topicHead', label: 'Top', silent: true },
  { id: 'quantifier', label: 'Q', word: 'all' },
  { id: 'finite', label: 'I', silent: true }
];
const dispatch = (relation, currentForest = forest) => dispatchRelationClaims({
  relation, currentForest, stageIndex: 0, relationIndex: 0
});
const items = (relation, workspaceForest = forest) => compileRelationRenderPlan([
  { statement: '', stageRecord: '', workspaceForest, relations: [relation] }
]).frames[0].items;
const facet = (relation, kind, currentForest) => dispatch(relation, currentForest).facets.find(f => f.recipe.id === kind);
const allomorph = {
  relation: 'contextual negative allomorphy',
  anchors: { conditioner: 'condition', negative: 'negative' },
  values: { inputAssociation: 'なかっ corresponds collectively to なか and っ', realization: 'ない → なかっ before past た' }
};

test('an allomorphy claim names one lexical host and keeps its conditional form literal', () => {
  const original = structuredClone(allomorph), drawn = items(allomorph);
  const plate = drawn.find(i => i.tier2FacetId === 'pf.structured');
  assert.deepEqual(plate.anchorNodeIds, ['negative']);
  assert.deepEqual(plate.rows, [{ label: 'realization', value: original.values.realization }]);
  assert(!drawn.some(i => i.tier2FacetId === 'pf.rewrite'), 'a single current host does not establish two rewrite occurrences');
  assert.deepEqual(facet(allomorph, 'pf.structured').evaluation.consumedEvidence, [
    { field: 'anchors', key: 'negative', itemIndices: [0] }, { field: 'values', key: 'realization', itemIndices: [0] }
  ]);
  const neutral = drawn.find(i => i.kind === 'fallback').relationRef;
  assert.deepEqual(neutral.anchors, { conditioner: 'condition' });
  assert.deepEqual(neutral.values, { inputAssociation: original.values.inputAssociation });
  assert.deepEqual(allomorph, original);
});

test('named realization hosts are independent of language, IDs and field order', () => {
  const r = { relation: 'conditioned adjectival allomorphy',
    anchors: { adjectival: 'form', conditioner: 'environment' }, values: { realization: 'A → B in this environment' } };
  const f = [{ id: 'environment', label: 'D', word: 'the' }, { id: 'form', label: 'A', word: 'B' }];
  assert.deepEqual(items(r, f).find(i => i.tier2FacetId === 'pf.structured').anchorNodeIds, ['form']);
  assert(!facet({ ...r, relation: 'an observation about adjectival forms' }, 'pf.structured', f));
});

test('a named allomorph is not inferred from a missing, silent, nonlexical or ambiguous host', () => {
  for (const changed of [
    forest.filter(n => n.id !== 'negative'), [...forest, { id: 'negative', label: 'Neg', word: 'x' }],
    forest.map(n => n.id === 'negative' ? { ...n, silent: true } : n),
    forest.map(n => n.id === 'negative' ? { id: n.id, label: 'NegP', children: [{ id: 'inner', label: 'Neg', word: 'x' }] } : n),
    forest.map(n => n.id === 'negative' ? { id: n.id, label: 'Neg' } : n)
  ]) assert(!facet(allomorph, 'pf.structured', changed));
  for (const r of [
    { ...allomorph, anchors: { conditioner: 'condition' } },
    { ...allomorph, anchors: { ...allomorph.anchors, verb: 'condition' } },
    { ...allomorph, anchors: { ...allomorph.anchors, negative: ['negative', 'condition'] } },
    ...['failed', 'blocked', 'pending', 'not established'].map(status => ({ ...allomorph, values: { ...allomorph.values, status } })),
    ...['No', 'Possible', 'Failed', 'Required'].map(prefix => ({ ...allomorph, relation: `${prefix} ${allomorph.relation}` }))
  ]) assert(!items(r).some(i => i.tier2FacetId === 'pf.structured'
    && i.anchorNodeIds.includes('negative')), JSON.stringify(r));
});

const topicReference = {
  relation: 'Topic–subject anaphoric dependency',
  anchors: { pronominalSubject: 'pronoun', topic: 'topic', topicHead: 'topicHead' },
  values: { dependency: 'base-generated topic identifies a distinct null subject', agreementCompatibility: 'feminine singular' }
};

test('explicit anaphoric reference uses coindices without asserting a binding path or copy chain', () => {
  for (const r of [topicReference, {
    relation: 'Syntactic topic-resumption dependency',
    anchors: { quantifier: 'quantifier', resumptive: 'pronoun', topic: 'topic', topicLicensor: 'topicHead' },
    values: { construction: 'clitic left dislocation', interpretation: 'the pronoun denotes the topic referent' }
  }]) {
    const original = structuredClone(r), drawn = items(r);
    const index = drawn.find(i => i.familyId === 'coreference.coindex');
    assert.deepEqual(index.nodeIds, ['topic', 'pronoun']);
    assert(!drawn.some(i => ['binding.dependency', 'identity.occurrences'].includes(i.tier2FacetId)));
    assert.deepEqual(r, original);
    assert.deepEqual(drawn.find(i => i.kind === 'fallback').relationRef.values, r.values);
    assert.equal(facet(r, 'coreference.coindex').evaluation.consumedEvidence.length, 2);
  }
});

test('reference roles alone, denied associations and competing referents earn no coindex', () => {
  for (const r of [
    { ...topicReference, relation: 'Topic and subject configuration' },
    ...['No', 'Possible', 'Failed', 'Pending'].map(prefix => ({ ...topicReference, relation: `${prefix} ${topicReference.relation}` })),
    { ...topicReference, values: { status: 'failed' } },
    { ...topicReference, anchors: { ...topicReference.anchors, antecedent: 'noun' } },
    { ...topicReference, anchors: { ...topicReference.anchors, pronoun: 'noun' } },
    { ...topicReference, anchors: { topic: 'topic', pronominalSubject: 'missing' } },
    { ...topicReference, anchors: { topic: 'topic', pronominalSubject: 'topic' } }
  ]) assert(!facet(r, 'coreference.coindex'), JSON.stringify(r));
  assert(!facet(topicReference, 'coreference.coindex', forest.map(n => n.id === 'pronoun' ? { ...n, label: 'T' } : n)));
});

test('a qualified subject owns its features without turning default agreement into successful agreement', () => {
  const r = { relation: 'Default finite agreement', anchors: { finiteHead: 'finite', quirkySubject: 'topic' },
    values: { agreementStatus: 'default; the dative DP is not a nominative agreement controller',
      finiteFeatures: 'present, third-person singular', subjectFeatures: 'dative plural' } };
  const drawn = items(r);
  assert.deepEqual(drawn.filter(i => i.tier2FacetId === 'plaque.structured').map(i => [i.anchorNodeIds, i.rows]), [
    [['finite'], [{ label: 'finiteFeatures', value: 'present, third-person singular' }]],
    [['topic'], [{ label: 'subjectFeatures', value: 'dative plural' }]]
  ]);
  assert(!drawn.some(i => i.kind === 'directed-path'));
  const residual = drawn.find(i => i.kind === 'fallback').relationRef;
  assert.deepEqual(residual.values, { agreementStatus: r.values.agreementStatus });
  for (const anchors of [{ finiteHead: 'finite', lowerSubject: 'topic' },
    { ...r.anchors, subject: 'pronoun' }, { finiteHead: 'finite', quirkySubject: 'missing' }]) {
    assert(!items({ ...r, anchors }).some(i => i.tier2FacetId === 'plaque.structured'
      && i.rows.some(row => row.label === 'subjectFeatures')));
  }
});

test('a named object-clitic claim associates its pronominal features independently of the theta role', () => {
  const r = { relation: 'Object-clitic licensing', anchors: { inflectedVerb: 'negative', pronominalArgument: 'pronoun' },
    values: { objectFeatures: 'third person feminine singular', implementation: 'the suffix licenses a silent pronoun' } };
  const plate = items(r).find(i => i.tier2FacetId === 'plaque.structured');
  assert.deepEqual(plate.anchorNodeIds, ['pronoun']);
  assert.deepEqual(plate.rows, [{ label: 'objectFeatures', value: r.values.objectFeatures }]);
  assert(!items(r).some(i => i.kind === 'directed-path'));
  for (const changed of [
    { ...r, relation: 'argument licensing' }, { ...r, relation: 'No object-clitic licensing' },
    { ...r, relation: 'Possible object-clitic licensing' },
    { ...r, anchors: { ...r.anchors, resumptiveClitic: 'noun' } },
    { ...r, anchors: { ...r.anchors, pronominalArgument: 'missing' } }
  ]) assert(!items(changed).some(i => i.tier2FacetId === 'plaque.structured'
    && i.rows.some(row => row.label === 'objectFeatures')));
});
