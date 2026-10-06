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

test('an explicit agreeing-item inventory shares literal features within its authored nominal domain', () => {
  const nodes = [{ ...forest[0], children: [...forest[0].children, { id: 'a', label: 'A', word: 'new' }] }];
  const base = { relation: 'nominal concord', anchors: { agreeingItems: ['d', 'a', 'n'], nominal: 'dp' },
    values: { features: 'plural; nominative declensional forms' } };
  const inspect = (r, currentForest = nodes) => {
    const result = dispatchRelationClaims({ relation: r, currentForest, stageIndex: 0, relationIndex: 0 });
    const frame = compileRelationRenderPlan([{ statement: '', stageRecord: '', workspaceForest: currentForest, relations: [r] }]).frames[0];
    return { result, vines: frame.items.filter(item => item.linkStyle === 'feature-sharing') };
  };
  const before = structuredClone(base), { result, vines } = inspect(base);
  assert.equal(vines.length, 1);
  assert.deepEqual(vines[0].pairs, [{ fromNodeId: 'd', toNodeId: 'a' }, { fromNodeId: 'a', toNodeId: 'n' }]);
  assert(!result.facets.some(facet => facet.recipe.id === 'feature.dependency'));
  assert.deepEqual(base, before);
  assert.deepEqual(result.evidenceCoverage.fields.find(field => field.key === 'nominal').unrecoveredItemIndices, [0]);
  for (const r of [
    { ...base, relation: 'possible nominal concord' }, { ...base, relation: 'a nominal observation' },
    { ...base, values: {} }, { ...base, values: { features: '' } },
    { ...base, anchors: { ...base.anchors, controller: 'n' } },
    { ...base, anchors: { ...base.anchors, agreeingItems: ['d', 'd', 'n'] } },
    { ...base, anchors: { ...base.anchors, agreeingItems: ['d', 'missing'] } },
    { ...base, anchors: { ...base.anchors, nominal: 'n' } }
  ]) assert.equal(inspect(r).vines.length, 0, JSON.stringify(r));
  for (const currentForest of [
    [...nodes, { ...nodes[0].children[0] }],
    [{ ...nodes[0], label: 'CP' }],
    [{ ...nodes[0], children: [nodes[0].children[0], nodes[0].children[1], { id: 'clause', label: 'TP', children: [nodes[0].children[2]] }] }],
    [{ ...nodes[0], children: nodes[0].children.slice(0, 2) }, nodes[0].children[2]]
  ]) assert.equal(inspect(base, currentForest).vines.length, 0);
});

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
