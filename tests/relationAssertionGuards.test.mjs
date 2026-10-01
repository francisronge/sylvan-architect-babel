import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims, dispatchStageRelations } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { relationAssertionFailure, isUnestablishedOutcomeLiteral } from '../replay/relations/outcomeResolver.ts';

const forest = [{ id: 'tp', label: 'TP', children: [
  { id: 's', label: 'DP', word: 'they' }, { id: 't', label: 'T' }
] }];
const dispatch = relation => dispatchRelationClaims({ relation, currentForest: forest, stageIndex: 0, relationIndex: 0 });
const plan = relation => compileRelationRenderPlan([{
  statement: 'An authored claim.', stageRecord: '', workspaceForest: forest, relations: [relation]
}]).frames[0].items;
const has = (relation, recipe) => dispatch(relation).facets.some(facet => facet.recipe.id === recipe);

test('an absent or pending agreement label cannot turn participant features into collection', () => {
  for (const name of ['no agreement', 'absence of agreement', 'lack of agreement',
    'pending subject agreement', 'agreement not established', 'finite agreement absent']) {
    for (const fields of [
      { anchors: { auxiliary: 't', subject: 's' }, values: { subjectFeatures: 'plural' } },
      { anchors: { collector: 't', goal: 's' }, values: { features: 'plural' } }
    ]) {
      const relation = { relation: name, ...fields };
      const original = structuredClone(relation);
      assert(!has(relation, 'feature.dependency'), JSON.stringify(relation));
      assert(plan(relation).some(item => item.kind === 'fallback'), name);
      assert.deepEqual(relation, original);
    }
  }
});

test('label-only agreement failure cannot be painted as positive collection', () => {
  for (const name of ['failed agreement', 'agreement failure', 'blocked agreement', 'finite agreement failed',
    'unsuccessful subject agreement', 'agreement violation']) {
    for (const fields of [
      { anchors: { auxiliary: 't', subject: 's' }, values: { subjectFeatures: 'plural' } },
      { anchors: { collector: 't', goal: 's' }, values: { features: 'plural' } }
    ]) {
      const relation = { relation: name, ...fields };
      assert(!plan(relation).some(item => item.pathStyle === 'case-agree' && item.outcome !== 'blocked'), JSON.stringify(relation));
      assert(plan(relation).some(item => item.pathStyle === 'case-agree' && item.outcome === 'blocked'), JSON.stringify(relation));
    }
  }
});

test('label-only failed binding and failed Case assignment do not create positive geometry', () => {
  for (const name of ['failed binding', 'binding failure', 'blocked local binding'])
    for (const domain of [undefined, 'tp']) {
      const relation = { relation: name, anchors: { binder: 't', anaphor: 's', ...(domain ? { domain } : {}) } };
      assert.equal(has(relation, 'binding.dependency'), Boolean(domain), JSON.stringify(relation));
    }
  for (const name of ['failed Case assignment', 'Case assignment failure', 'blocked structural Case licensing']) {
    const relation = { relation: name, anchors: { assigner: 't', recipient: 's' }, values: { case: 'nominative' } };
    assert(!plan(relation).some(item => item.pathStyle === 'case-assignment' && item.outcome !== 'blocked'), JSON.stringify(relation));
  }
});

test('failed agreement preserves independently asserted Case and participant properties', () => {
  const relation = { relation: 'failed agreement; Case assignment',
    anchors: { caseAssigner: 't', caseRecipient: 's', subject: 's' },
    values: { case: 'nominative', subjectFeatures: 'plural' } };
  const items = plan(relation);
  assert(items.some(item => item.pathStyle === 'case-assignment' && item.outcome !== 'blocked'));
  assert(items.some(item => item.kind === 'node-plaque' && item.rows?.some(row => row.value === 'plural')));
  assert(items.some(item => item.pathStyle === 'case-agree' && item.outcome === 'blocked'));
});

test('explicit failed participant comparisons still receive their existing negative drawing', () => {
  const relation = { relation: 'failed agreement', anchors: { finiteHead: 't', subject: 's' },
    values: { finiteHeadFeatures: 'singular', subjectFeatures: 'plural' } };
  const items = plan(relation);
  assert(items.some(item => item.pathStyle === 'case-agree' && item.outcome === 'blocked'));
  assert(!items.some(item => item.pathStyle === 'case-agree' && item.outcome !== 'blocked'));
});

test('failed binding with an explicit negative outcome retains its supported negative domain', () => {
  const relation = { relation: 'failed binding', anchors: { binder: 't', anaphor: 's', domain: 'tp' },
    values: { status: 'failed' } };
  const result = dispatch(relation);
  const binding = result.facets.find(facet => facet.recipe.id === 'binding.dependency');
  assert(binding);
  assert.equal(binding.evaluation.outcomeConcept, 'failed');
});

test('pending and unestablished outcomes cannot disappear during evidence normalization', () => {
  for (const key of ['status', 'outcome', 'result']) {
    for (const status of ['pending', 'not established', 'not yet established', 'unresolved', 'absent']) {
      const relation = { relation: 'Authored feature collection', anchors: { collector: 't', goal: 's' },
        values: { features: 'plural', [key]: status } };
      const result = dispatch(relation);
      assert.deepEqual(result.evidence.values.outcome, [status], JSON.stringify(relation));
      assert(!has(relation, 'feature.dependency'), JSON.stringify(relation));
      assert(plan(relation).some(item => item.kind === 'fallback'), JSON.stringify(relation));
    }
  }
});

test('explicitly absent binding does not create a path or a binding domain', () => {
  for (const name of ['no binding', 'absence of binding', 'local binding not established', 'possible A-binding']) {
    for (const domain of [undefined, 'tp']) {
      const relation = { relation: name,
        anchors: { binder: 't', anaphor: 's', ...(domain ? { domain } : {}) } };
      assert(!has(relation, 'binding.dependency'), JSON.stringify(relation));
    }
  }
});

test('absence of agreement leaves independent Case, binding and participant properties intact', () => {
  const relation = { relation: 'no agreement',
    anchors: { caseAssigner: 't', caseRecipient: 's', binder: 't', anaphor: 's', subject: 's' },
    values: { case: 'nominative', subjectFeatures: 'plural' } };
  const items = plan(relation);
  assert(items.some(item => item.pathStyle === 'case-assignment' && item.fromNodeId === 't' && item.toNodeId === 's'));
  assert(items.some(item => item.kind === 'operator-variable-binding'));
  assert(items.some(item => item.kind === 'node-plaque' && item.rows?.some(row => row.value === 'plural')));
  assert(!items.some(item => item.pathStyle === 'case-agree'));
});

test('an independent Case value survives denied agreement without acquiring a feature connector', () => {
  const relation = { relation: 'no agreement; Case assignment',
    anchors: { caseAssigner: 't', caseRecipient: 's', subject: 's' },
    values: { case: 'nominative', subjectFeatures: 'plural' } };
  const items = plan(relation);
  assert(items.some(item => item.pathStyle === 'case-assignment'));
  assert(items.some(item => item.kind === 'node-plaque' && item.rows?.some(row => row.value === 'plural')));
  assert(!items.some(item => item.pathStyle === 'case-agree'));
});

test('denied binding leaves a separately authored agreement dependency intact', () => {
  const relation = { relation: 'no binding',
    anchors: { binder: 't', anaphor: 's', collector: 't', goal: 's' }, values: { features: 'plural' } };
  assert(has(relation, 'feature.dependency'));
  assert(!has(relation, 'binding.dependency'));
});

test('remembered Case cannot bypass a later explicit denial of that assignment', () => {
  const stages = [
    { statement: 'Assignment', stageRecord: '', workspaceForest: forest, relations: [
      { relation: 'Case assignment', anchors: { assigner: 't', recipient: 's' }, values: { case: 'nominative' } }
    ] },
    { statement: 'A later claim', stageRecord: '', workspaceForest: forest, relations: [
      { relation: 'no Case assignment', anchors: { assigner: 't', recipient: 's' }, values: { case: 'nominative' } }
    ] }
  ];
  const result = dispatchStageRelations(stages);
  assert(result[0][0].claims.some(claim => claim.tier < 3));
  assert(!result[1][0].facets.some(facet => facet.recipe.id === 'feature.dependency'));
});

test('failed and blocked authored outcomes retain the existing negative feature drawing', () => {
  for (const name of ['Authored comparison', 'no agreement', 'failed agreement', 'blocked agreement', 'agreement failure'])
    for (const status of ['failed', 'blocked', 'unlicensed', 'rejected']) {
      const relation = { relation: name, anchors: { collector: 't', goal: 's' },
        values: { features: 'plural', status } };
      const paths = plan(relation).filter(item => item.pathStyle === 'case-agree');
      assert.equal(paths.length, 1, JSON.stringify(relation));
      assert.equal(paths[0].outcome, 'blocked', JSON.stringify(relation));
    }
});

test('negative polarity and negative feature literals are content, not assertion denial', () => {
  for (const name of ['negative polarity agreement', 'agreement', 'A novel relation']) {
    for (const features of ['negative polarity', 'polarity: negative', 'no gender distinction', 'not specified']) {
      const relation = { relation: name, anchors: { collector: 't', goal: 's' }, values: { features } };
      assert(has(relation, 'feature.dependency'), JSON.stringify(relation));
    }
  }
  assert.equal(relationAssertionFailure('no change in agreement', 'agreement'), undefined);
  assert.equal(relationAssertionFailure('failed prediction about agreement', 'agreement'), undefined);
  assert.equal(relationAssertionFailure('agreement about a failure', 'agreement'), undefined);
  assert.equal(relationAssertionFailure('not failed agreement', 'agreement'), undefined);
  assert.equal(relationAssertionFailure('absence of agreement', 'binding'), undefined);
  assert.equal(relationAssertionFailure('no binding; Case assignment', 'case'), undefined);
  assert.equal(isUnestablishedOutcomeLiteral('blocked'), false);
  assert.equal(isUnestablishedOutcomeLiteral('negative'), false);
});
