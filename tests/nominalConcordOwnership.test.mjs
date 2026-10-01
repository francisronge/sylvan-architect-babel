import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const forest = [{ id: 'dp', label: 'DP', children: [
  { id: 'd', label: 'D', word: 'these' }, { id: 'n', label: 'N', word: 'books' }
] }];
const relation = { relation: 'determiner–nominal number agreement',
  anchors: { determiner: 'd', nominalHead: 'n' }, values: { number: 'plural' } };
const dispatch = record => dispatchRelationClaims({ relation: record, currentForest: forest, stageIndex: 0, relationIndex: 0 });
const items = record => compileRelationRenderPlan([{ statement: '', stageRecord: '', workspaceForest: forest, relations: [record] }]).frames[0].items;
const recipes = record => dispatch(record).facets.map(facet => facet.recipe.id);

test('one nominal concord claim owns one vine without a second generic connector', () => {
  const before = structuredClone(relation);
  for (const record of [relation, { ...relation, values: { number: 'plural', gender: 'masculine' } },
    { ...relation, values: { ...relation.values, status: 'licensed' } }]) {
    assert(recipes(record).includes('feature-sharing'));
    assert(!recipes(record).includes('feature.dependency'));
    assert.equal(items(record).filter(item => item.linkStyle === 'feature-sharing').length, 1);
    assert(!items(record).some(item => item.pathStyle === 'case-agree'));
  }
  assert.deepEqual(relation, before);
});

test('failed nominal agreement keeps its outcome connector and cannot acquire a successful vine', () => {
  for (const status of ['failed', 'blocked', 'unlicensed']) {
    const record = { ...relation, values: { ...relation.values, status } };
    assert(recipes(record).includes('feature.dependency'));
    assert(!recipes(record).includes('feature-sharing'));
  }
  for (const status of ['pending', ['licensed', 'failed']])
    assert(!recipes({ ...relation, values: { ...relation.values, status } }).includes('feature-sharing'));
});

test('explicit directed roles and independent Case rows are not suppressed by nominal membership', () => {
  const directed = { relation: 'nominal agreement', anchors: { agreementHost: 'd', agreementController: 'n' }, values: { number: 'plural' } };
  assert(recipes(directed).includes('feature.dependency'));
  assert(!recipes(directed).includes('feature-sharing'));
  const both = { ...relation, values: { number: 'plural', case: 'accusative' } };
  assert(recipes(both).includes('feature.dependency'));
  assert(items(both).some(item => item.kind === 'node-plaque' && item.rows.some(row => row.value === 'accusative')));
  const extraDirection = { ...relation, anchors: { ...relation.anchors, licenser: 'n', recipient: 'd' }, values: { number: 'plural', case: 'accusative' } };
  assert(!recipes(extraDirection).includes('feature-sharing'));
});

test('undirected concord accepts a branching bare nominal container with the same exact ownership', () => {
  for (const label of ['N', 'D', 'K', 'NP', 'DP', 'KP']) {
    const workspaceForest = [{ ...forest[0], label }];
    const result = dispatchRelationClaims({ relation, currentForest: workspaceForest, stageIndex: 0, relationIndex: 0 });
    assert(result.facets.some(facet => facet.recipe.id === 'feature-sharing'), label);
  }
  for (const workspaceForest of [
    [{ id: 'clause', label: 'CP', children: structuredClone(forest[0].children) }],
    [{ id: 'nominal', label: 'D', children: [forest[0].children[0], { id: 'clause', label: 'TP', children: [forest[0].children[1]] }] }],
    [...structuredClone(forest), structuredClone(forest[0].children[1])],
    structuredClone(forest[0].children)
  ]) assert(!dispatchRelationClaims({ relation, currentForest: workspaceForest, stageIndex: 0, relationIndex: 0 })
    .facets.some(facet => facet.recipe.id === 'feature-sharing'));
  const directed = { relation: 'nominal concord', anchors: { controller: 'noun', targets: ['adjective'] }, values: { number: 'plural' } };
  const retained = [{ id: 'noun', label: 'N', word: 'books', children: [{ id: 'adjective', label: 'A', word: 'old' }] }];
  assert(dispatchRelationClaims({ relation: directed, currentForest: retained, stageIndex: 0, relationIndex: 0 })
    .facets.some(facet => facet.recipe.id === 'feature.dependency'));
});
