import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFacetFixture, buildPublicFacetFixture } from './helpers/tier2PublicFixtures.mjs';
import { TIER2_FACET_RECIPES } from '../replay/relations/tier2FacetRecipes.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { __test__ } from '../server/babelParser.js';

const recipe = id => TIER2_FACET_RECIPES.find(recipe => recipe.id === id);
const siblings = ['movement.path', 'movement.carrier', 'binding.dependency', 'locality.boundary',
  'feature-sharing', 'agreement.cycle', 'feature.dependency', 'transfer.access', 'landing-candidates',
  'judgment.blocked', 'judgment.licensed', 'intervention', 'blocked-extraction', 'polarity.licensing'];
const negativeSiblings = ['locality.boundary', 'transfer.access', 'judgment.blocked', 'intervention', 'blocked-extraction'];
const fields = ['anchors', 'priorAnchors', 'values'];
const prefix = (fixture, prefix) => {
  const copy = structuredClone(fixture), visited = new WeakSet();
  const visit = node => {
    if (visited.has(node)) return;
    visited.add(node);
    node.id = prefix + node.id;
    if (node.lineageId) node.lineageId = prefix + node.lineageId;
    (node.children ?? []).forEach(visit);
  };
  copy.currentForest.forEach(visit);
  copy.priorForest.forEach(visit);
  for (const field of ['anchors', 'priorAnchors']) if (copy.relation[field]) {
    copy.relation[field] = Object.fromEntries(Object.entries(copy.relation[field]).map(([key, ids]) =>
      [key, Array.isArray(ids) ? ids.map(id => prefix + id) : prefix + ids]));
  }
  return copy;
};
const combine = (left, right) => ({
  relation: { relation: 'Two independent authored claims', ...Object.fromEntries(fields.map(field =>
    [field, { ...left.relation[field], ...right.relation[field] }]).filter(([, value]) => Object.keys(value).length > 0)) },
  currentForest: [...left.currentForest, ...right.currentForest],
  priorForest: [...left.priorForest, ...right.priorForest], activeLens: true, stageIndex: 1, relationIndex: 0
});

test('all fourteen outcome-bearing families compose with an independently authored PF rewrite', () => {
  for (const id of siblings) {
    const left = prefix(buildFacetFixture(recipe(id)), 'left:');
    const right = prefix(buildFacetFixture(recipe('pf.rewrite')), 'right:');
    for (const field of fields) assert.deepEqual(Object.keys(left.relation[field] ?? {})
      .filter(key => Object.hasOwn(right.relation[field] ?? {}, key)), [], `${id}: fixture fields must not collide`);
    const fixture = combine(left, right);
    const original = structuredClone(fixture);
    const result = dispatchRelationClaims(fixture);
    assert(result.facets.some(facet => facet.recipe.id === id), id);
    const rewrite = result.facets.find(facet => facet.recipe.id === 'pf.rewrite');
    assert(rewrite, `${id}: independent rewrite was suppressed`);
    assert(!rewrite.evaluation.consumedEvidence.some(ref => ref.field === 'values' && ref.key === 'outcome'), id);
    assert.deepEqual(fixture, original);
  }
});

for (const id of negativeSiblings) test(`public ${id} retains its blocked claim beside a complete native PF rewrite`, () => {
  const leftPublic = buildPublicFacetFixture(recipe(id)), rightPublic = buildPublicFacetFixture(recipe('pf.rewrite'));
  const left = prefix(leftPublic.fixture, 'left:'), right = prefix(rightPublic.fixture, 'right:');
  const fixture = combine(left, right);
  const stage = (workspaceForest, relations = []) => ({ statement: 'The authored claims hold.',
    stageRecord: 'Each claim names its own participants and literal content.', workspaceForest, relations });
  const prior = [...(left.priorForest.length ? left.priorForest : left.currentForest),
    ...(right.priorForest.length ? right.priorForest : right.currentForest)];
  const authored = { derivationStages: [stage(prior), stage(fixture.currentForest, [fixture.relation])] };
  const bundle = __test__.normalizeParseBundle(authored, 'xbar', `${leftPublic.sentence} ${rightPublic.sentence}`, 'grok', true);
  const items = compileRelationRenderPlan(bundle.analyses[0].derivationStages).frames[1].items;
  assert(items.some(item => item.tier2FacetId === id));
  const rewrite = items.filter(item => item.tier2FacetId === 'pf.rewrite');
  assert.equal(rewrite.length, 1);
  assert.deepEqual(rewrite[0].rows, [{ label: 'input 1', value: 'output 1' }]);
  assert.deepEqual(rewrite[0].realizationRowKinds, ['rewrite']);
  assert.deepEqual(rewrite[0].anchorNodeIds, right.relation.anchors['rewrite.output'] instanceof Array
    ? right.relation.anchors['rewrite.output'] : [right.relation.anchors['rewrite.output']]);
});

test('unassigned status remains literal while an explicitly denied mapping never borrows sibling success', () => {
  const currentForest = [{ id: 'r', label: 'XP', children: ['input', 'output', 'context'].map(id => ({ id, label: 'V', word: id, children: [] })) }];
  const input = { stageIndex: 0, relationIndex: 0, currentForest,
    relation: { relation: 'Two independent descriptions', anchors: { input: 'input', output: 'output', context: 'context' },
      values: { mapping: 'go -> went', status: 'pending' } } };
  const result = dispatchRelationClaims(input);
  assert(result.facets.some(facet => facet.recipe.id === 'pf.rewrite'));
  assert.equal(result.primaryRelation.values.status, 'pending');
  const denied = dispatchRelationClaims({ ...input, relation: { ...input.relation,
    relation: 'No PF rewrite; an independent successful claim', values: { ...input.relation.values, status: 'successful' } } });
  assert(!denied.facets.some(facet => facet.recipe.id === 'pf.rewrite'));
});

test('sole typed input/output roles bind a pending status even under an unfamiliar relation name', () => {
  const currentForest = [{ id: 'r', label: 'XP', children: ['input', 'output'].map(id => ({ id, label: 'V', word: id, children: [] })) }];
  for (const fields of [{ input: 'input', output: 'output' }, { underlyingForm: 'input', surfaceForm: 'output' }]) {
    const result = dispatchRelationClaims({ stageIndex: 0, relationIndex: 0, currentForest,
      relation: { relation: 'An unfamiliar description', anchors: fields, values: { mapping: 'go -> went', status: 'pending' } } });
    assert(!result.facets.some(facet => facet.recipe.id === 'pf.rewrite'));
    assert.equal(result.primaryRelation.values.status, 'pending');
  }
});
