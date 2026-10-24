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

