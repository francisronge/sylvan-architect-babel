import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';

const ellipsis = () => ({ currentForest: [
  { id: 'first', label: 'v', children: [{ id: 'overt', label: 'V', word: 'read' }] },
  { id: 'second', label: 'v', silent: true, children: [{ id: 'silent', label: 'V', word: 'read', silent: true }] },
  { id: 'modal', label: 'T', word: 'will' }
], relation: { relation: 'verbal ellipsis licensing and antecedence',
  anchors: { antecedent: 'first', licensor: 'modal', target: 'second' },
  values: { identityCondition: 'same predicate', realization: 'target domain unpronounced' } }, stageIndex: 0, relationIndex: 0 });
const idiom = () => ({ currentForest: [{ id: 'domain', label: 'V′', children: [
  { id: 'predicate', label: 'V', word: 'verb' }, { id: 'argument', label: 'DP', word: 'object' },
  { id: 'prepositional', label: 'PP', word: 'phrase' }
] }], relation: { relation: 'lexically licensed idiomatic interpretation',
  anchors: { constructionDomain: 'domain', verb: 'predicate', object: 'argument', prepositionalArgument: 'prepositional' },
  values: { idiomaticMeaning: 'A jointly interpreted construction', literalMeaning: 'The same syntax also has a literal reading' } },
  stageIndex: 0, relationIndex: 0 });
const facets = input => dispatchRelationClaims(input).facets.map(f => f.recipe.id);

test('a compound verbal ellipsis claim depicts the exact silent target and independent antecedence', () => {
  const input = ellipsis(), original = structuredClone(input), output = dispatchRelationClaims(input);
  assert(facets(input).includes('ellipsis.site'));
  assert(facets(input).includes('correspondence.alignment'));
  assert.deepEqual(output.facets.find(f => f.recipe.id === 'ellipsis.site').evidence.currentAnchors['ellipsis.site'], ['second']);
  assert(!facets(input).includes('movement.path'));
  assert.deepEqual(input, original);
});

test('ellipsis never infers silence or arbitrarily selects a competing antecedent or site', () => {
  for (const mutate of [
    i => { i.relation.relation = 'possible verbal ellipsis licensing and antecedence'; },
    i => { i.relation.values.status = 'denied'; },
    i => { i.relation.anchors.target = ['second', 'first']; },
    i => { i.relation.anchors.identitySource = 'modal'; },
    i => { i.currentForest.push(structuredClone(i.currentForest[1])); }
  ]) {
    const i = ellipsis(); mutate(i);
    assert(!facets(i).includes('correspondence.alignment'), mutate.toString());
  }
  const audible = ellipsis(); delete audible.currentForest[1].silent; delete audible.currentForest[1].children[0].silent;
  assert(!facets(audible).includes('ellipsis.site'));
  assert(facets(audible).includes('correspondence.alignment'), 'antecedence does not itself assert deletion');
});

test('idiomatic interpretation groups exact disjoint pieces under their authored domain', () => {
  const input = idiom(), original = structuredClone(input), output = dispatchRelationClaims(input);
  const recovered = output.facets.find(f => f.recipe.id === 'idiom.chunks');
  assert(recovered);
  assert.deepEqual(new Set(recovered.evidence.currentAnchors.chunks), new Set(['predicate', 'argument', 'prepositional']));
  assert.deepEqual(recovered.evidence.currentAnchors['interpretation.domain'], ['domain']);
  for (const key of Object.keys(input.relation.anchors))
    assert.deepEqual(output.evidenceCoverage.fields.find(f => f.field === 'anchors' && f.key === key).unrecoveredItemIndices, []);
  assert.deepEqual(input, original);
});

test('idiom grouping rejects denied interpretations, unrelated, overlapping, missing or ambiguous participants', () => {
  for (const mutate of [
    i => { i.relation.relation = 'possible idiomatic interpretation'; },
    i => { i.relation.values.status = 'rejected'; },
    i => { i.currentForest.push({ id: 'outside', label: 'N' }); i.relation.anchors.extra = 'outside'; },
    i => { i.relation.anchors.verb = 'argument'; },
    i => { delete i.relation.anchors.constructionDomain; },
    i => { i.relation.anchors.otherDomain = 'domain'; },
    i => { i.currentForest.push(structuredClone(i.currentForest[0])); },
    i => { i.currentForest[0].children[1].children = [{ id: 'nested', label: 'N' }]; i.relation.anchors.extra = 'nested'; }
  ]) {
    const i = idiom(); mutate(i);
    assert(!facets(i).includes('idiom.chunks'), mutate.toString());
  }
});
