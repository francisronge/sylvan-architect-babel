import assert from 'node:assert/strict';
import test from 'node:test';
import { bindRelationRoles } from '../replay/relationDispatch/roleBinding.js';
import { productionRelationRegistry } from '../replay/relationDispatch/index.js';
import { PRODUCTION_RENDER_FAMILIES, PRODUCTION_SCALAR_VALUE_KEYS } from '../replay/relations/renderFamilies.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const forest = [{ id: 'domain', label: 'TP', children: ['a', 'b', 'c'].map(id => ({ id, label: 'D', word: id })) }];
const stage = relations => ({ statement: 'A state.', stageRecord: 'The authored state.', workspaceForest: forest, relations });

test('every native single-literal slot diagnoses lists without selecting or changing their entries', () => {
  let checks = 0;
  for (const entry of productionRelationRegistry.entries) {
    const family = PRODUCTION_RENDER_FAMILIES[entry.id]?.family;
    for (const key of PRODUCTION_SCALAR_VALUE_KEYS[family] || []) {
      for (const literals of [['blocked', 'blocked'], ['blocked', 'failed']]) {
        const relation = { relation: entry.identities[0].name, anchors: {}, values: { [key]: literals } };
        const before = structuredClone(relation);
        const result = bindRelationRoles(relation, entry, forest);
        const issue = result.issues.find(issue => issue.kind === 'drawing-value-cardinality' && issue.role === key);
        assert.ok(issue, `${entry.id}.${key}`);
        assert.deepEqual(issue.offendingValue, literals);
        assert.equal(issue.observedItems, 2);
        assert.deepEqual(relation, before);
        assert.deepEqual(result.relation.values, relation.values);
        checks++;
      }
      const single = { relation: entry.identities[0].name, anchors: {}, values: { [key]: ['blocked'] } };
      assert.equal(bindRelationRoles(single, entry, forest).issues.some(issue => issue.kind === 'drawing-value-cardinality'), false);
    }
  }
  assert.ok(checks > 50);
});

test('a Case list stays intact in fallback instead of painting its first value as the whole claim', () => {
  const relation = { relation: 'CaseAssignment', anchors: { assigner: 'a', bearer: 'b' }, values: { case: ['nominative', 'accusative'] } };
  const plan = compileRelationRenderPlan([stage([relation])]);
  assert.equal(plan.frames[0].items.some(item => item.pathStyle === 'case-assignment'), false);
  const fallback = plan.frames[0].items.find(item => item.kind === 'fallback');
  assert.ok(fallback);
  assert.deepEqual(fallback.relationRef.values, relation.values);
  const claim = dispatchRelationClaims({ relation, currentForest: forest, stageIndex: 0, relationIndex: 0 });
  assert.ok(claim.tier1Dispatch.signatureIssues.some(issue => issue.kind === 'drawing-value-cardinality'));
});

test('Agree keeps its complete plaque when the Case companion curve cannot carry all its values', () => {
  const assignment = { relation: 'CaseAssignment', anchors: { assigner: 'a', bearer: 'b' }, values: { case: 'nominative' } };
  for (const values of [
    { feature: ['person', 'number'], value: ['third', 'singular'] },
    { feature: 'person', value: 'third', locality: 'The model authored this qualification.' },
    { feature: [], value: 'third' }
  ]) {
    const agree = { relation: 'Agree', anchors: { probe: 'b', goal: 'c' }, values };
    for (const relations of [[assignment, agree], [agree, assignment]]) {
      const plan = compileRelationRenderPlan([stage(relations)]);
      assert.ok(plan.frames[0].items.some(item => item.pathStyle === 'case-assignment'));
      assert.equal(plan.frames[0].items.some(item => item.pathStyle === 'case-agree'), false);
      const plaque = plan.frames[0].items.find(item => item.kind === 'node-plaque' && item.relationRef.relation === 'Agree');
      assert.ok(plaque);
      assert.deepEqual(plaque.relationRef.values, values);
      assert.equal(plaque.relationRef.relationIndex, relations.indexOf(agree));
      for (const literal of Object.values(values).flat()) assert.ok(JSON.stringify(plaque.rows).includes(literal));
    }
  }
  const plan = compileRelationRenderPlan([stage([assignment,
    { relation: 'Agree', anchors: { probe: 'b', goal: 'c' }, values: { feature: ['person'], value: 'third' } }
  ])]);
  assert.ok(plan.frames[0].items.some(item => item.pathStyle === 'case-agree' && item.featureRow.value === 'third'));

  const mixed = compileRelationRenderPlan([stage([assignment, {
    relation: 'Agree', anchors: { probe: 'b', goal: 'c', domain: 'domain' },
    values: { feature: 'phi', value: '3sg', label: 'domain text' }
  }])]);
  assert.ok(mixed.frames[0].items.some(item => item.tier2FacetId === 'domain.annotation'));
  assert.ok(mixed.frames[0].items.some(item => item.kind === 'node-plaque' && item.relationRef.relation === 'Agree'),
    'both sides of composition must consult the same original, even after another facet consumes a value');
});

test('a full-row drawing keeps literal lists without selecting one as its title', () => {
  const relation = { relation: 'PhrasalSpellOut', anchors: { phrase: 'domain' }, values: { exponent: ['one', 'two'] } };
  const plan = compileRelationRenderPlan([stage([relation])]);
  const plaque = plan.frames[0].items.find(item => item.plaqueStyle === 'spellout-label');
  assert.ok(plaque);
  assert.equal(plaque.title, '');
  assert.deepEqual(plaque.rows.map(row => row.value), ['one', 'two']);
});

test('Tier 2 binding indices require one value, while the original list survives', () => {
  const relation = { relation: 'An open dependency', anchors: { binder: 'a', dependent: 'b', domain: 'domain' }, values: { index: ['x', 'y'] } };
  const dispatch = value => dispatchRelationClaims({ relation: { ...relation, values: { index: value } }, currentForest: forest, stageIndex: 0, relationIndex: 0 });
  assert.ok(dispatch('x').facets.some(facet => facet.recipe.id === 'binding.dependency'));
  assert.equal(dispatch(['x', 'y']).facets.some(facet => facet.recipe.id === 'binding.dependency'), false);
  const plan = compileRelationRenderPlan([stage([relation])]);
  assert.ok(plan.frames[0].items.some(item => item.kind === 'fallback' && JSON.stringify(item.relationRef.values).includes('y')));
});

test('Tier 2 covert movement does not choose one authored index from a list', () => {
  const currentForest = [{ id: 'root', label: 'XP', children: [
    { id: 'lower', label: 'DP', lineageId: 'same', silent: true },
    { id: 'higher', label: 'DP', lineageId: 'same', word: 'some' }
  ] }];
  const dispatch = index => dispatchRelationClaims({ relation: {
    relation: 'Open movement', anchors: { 'covert source': 'lower', 'covert landing': 'higher' }, values: { index }
  }, currentForest, stageIndex: 0, relationIndex: 0 });
  assert.ok(dispatch('k').facets.some(facet => facet.recipe.id === 'scope.movement'));
  assert.equal(dispatch(['k', 'l']).facets.some(facet => facet.recipe.id === 'scope.movement'), false);
});
