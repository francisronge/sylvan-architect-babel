import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const forest = [{ id: 'r9', label: 'CP', children: [
  { id: 'n7', label: 'DP', word: 'α' },
  { id: 'q2', label: 'TP', children: [
    { id: 'z4', label: 'DP', silent: true },
    { id: 'p8', label: 'V', word: 'β' }
  ] }
] }];
const inspect = (relation, workspaceForest = forest) => {
  const before = structuredClone(relation);
  const dispatch = dispatchRelationClaims({ relation, currentForest: workspaceForest, stageIndex: 0, relationIndex: 0 });
  const plan = compileRelationRenderPlan([{ statement: 'A completed state.', stageRecord: 'The authored record.',
    workspaceForest, relations: [relation] }]);
  assert.deepEqual(relation, before);
  return { dispatch, items: plan.frames[0].items };
};

test('binding-qualified objects retain their declared role without requiring movement identity', () => {
  for (const role of ['anaphoricTrace', 'bound_occurrence', 'BOUND-COPY', 'anaphoric expression', 'boundNominal', 'anaphoricPronoun']) {
    for (const name of ['An unfamiliar claim', 'Binding']) {
      const anchors = { binder: 'n7', [role]: 'z4', localDomain: 'q2' };
      for (const entries of [Object.entries(anchors), Object.entries(anchors).reverse()]) {
        const relation = { relation: name, anchors: Object.fromEntries(entries) };
        const { dispatch, items } = inspect(relation);
        assert.equal(dispatch.primaryClaim?.tier ?? 2, name === 'Binding' ? 1 : 2);
        const binding = items.find(item => item.kind === 'binding-domain');
        assert.ok(binding, JSON.stringify(relation));
        assert.equal(binding.binderNodeId, 'n7');
        assert.equal(binding.boundNodeId, 'z4');
        assert.equal(binding.domainNodeId, 'q2');
        assert.equal(items.some(item => item.kind === 'trajectory'), false);
      }
    }
  }
});

test('operator variables preserve explicit qualification, independent sibling claims, and neutral context', () => {
  for (const variable of ['argumentVariable', 'scope_variable', 'BOUND VARIABLE']) {
    for (const name of ['A new description', 'OperatorVariableBinding']) {
      const anchors = { operator: 'n7', [variable]: 'z4', clauseContext: 'r9', featureBearers: ['n7', 'p8'] };
      for (const entries of [Object.entries(anchors), Object.entries(anchors).reverse()]) {
        const relation = { relation: name, anchors: Object.fromEntries(entries), values: { features: 'plural', interpretation: 'Authored explanation.' } };
        const { dispatch, items } = inspect(relation);
        const binding = items.filter(item => item.kind === 'operator-variable-binding');
        assert.equal(binding.length, 1);
        assert.equal(binding[0].operatorNodeId, 'n7');
        assert.equal(binding[0].variableNodeId, 'z4');
        assert(items.some(item => item.kind === 'undirected-link' && item.linkStyle === 'feature-sharing'), 'the independent feature-sharing claim survives');
        assert(items.some(item => item.kind === 'fallback'), 'uninterpreted context remains available');
        const context = dispatch.evidenceCoverage.fields.find(field => field.key === 'clauseContext');
        assert.deepEqual(context.unrecoveredItemIndices, [0]);
        assert(dispatch.claims.some(claim => claim.tier === (name === 'OperatorVariableBinding' ? 1 : 2)));
        assert.equal(binding[0].relationRef.anchors[variable], 'z4');
        for (const [role, ids] of Object.entries(relation.anchors)) {
          assert(items.some(item => JSON.stringify(item.relationRef.anchors[role]) === JSON.stringify(ids)), role);
        }
      }
    }
  }
});

test('reference qualifiers do not infer a binder, variable, or domain from prose, lineage, or ambiguous endpoints', () => {
  const sharedLineage = structuredClone(forest);
  sharedLineage[0].children[0].lineageId = 'shared';
  sharedLineage[0].children[1].children[0].lineageId = 'shared';
  for (const anchors of [
    { binder: 'n7', trace: 'z4', localDomain: 'q2' },
    { binder: 'n7', notAnaphoricTrace: 'z4', localDomain: 'q2' },
    { binder: 'n7', unboundOccurrence: 'z4', localDomain: 'q2' },
    { binder: 'n7', anaphoricTrace: ['z4', 'p8'], localDomain: 'q2' },
    { binder: 'n7', anaphoricTrace: 'missing', localDomain: 'q2' },
    { binder: 'n7', anaphoricTrace: 'z4', localDomain: 'p8' },
    { binder: 'n7', anaphoricTrace: 'z4', boundOccurrence: 'p8', localDomain: 'q2' },
    { operator: 'n7', participant: 'z4' },
    { operator: 'n7', notArgumentVariable: 'z4' },
    { operator: 'n7', argumentVariable: ['z4', 'p8'] },
    { operator: 'n7', argumentVariable: 'missing' },
    { operator: 'n7', argumentVariable: 'z4', scopeVariable: 'p8' },
    { argumentVariable: 'z4', context: 'n7' }
  ]) {
    const relation = { relation: 'Binding and operator-variable relation', anchors,
      values: { explanation: 'The binder and operator bind the lower trace and variable.' } };
    const { items } = inspect(relation, sharedLineage);
    assert.equal(items.some(item => item.kind === 'binding-domain' || item.kind === 'operator-variable-binding'), false, JSON.stringify(anchors));
  }
  for (const relation of [
    { relation: 'Binding', anchors: { binder: 'n7', anaphoricTrace: 'z4' } },
    { relation: 'OperatorVariableBinding', anchors: { argumentVariable: 'z4' } }
  ]) {
    const { dispatch, items } = inspect(relation);
    assert.equal(dispatch.primaryClaim.tier, 3);
    assert.equal(items.some(item => item.kind === 'binding-domain' || item.kind === 'operator-variable-binding'), false);
  }
});

test('a finite head and one controller with typed features establish agreement, preserving lexical context', () => {
  for (const name of ['An unfamiliar name', 'Agree']) {
    for (const features of [{ gender: 'feminine', number: 'singular' }, { features: 'dual' }]) {
      for (const anchors of [
        { finiteHead: 'n7', controller: 'z4', lexicalVerb: 'p8' },
        { lexicalVerb: 'p8', controller: ['z4'], finiteHead: 'n7' }
      ]) {
        const relation = { relation: name, anchors, values: features };
        const { dispatch, items } = inspect(relation);
        assert.equal(dispatch.evidence.currentAnchors['feature.source'][0], 'n7');
        assert.deepEqual(dispatch.evidence.currentAnchors['feature.target'], ['z4']);
        assert(dispatch.claims.some(claim => claim.tier === (name === 'Agree' ? 1 : 2)));
        assert(items.some(item => item.kind === 'node-plaque' && item.plaqueStyle === 'feature'));
        assert(!items.some(item => item.kind === 'undirected-link' && item.linkStyle === 'feature-sharing'));
        assert.deepEqual(dispatch.evidenceCoverage.fields.find(field => field.key === 'lexicalVerb').unrecoveredItemIndices, [0]);
      }
    }
  }
  for (const relation of [
    { anchors: { finiteHead: 'n7', controller: 'z4' } },
    { anchors: { head: 'n7', controller: 'z4' }, values: { gender: 'feminine' } },
    { anchors: { finiteHead: 'n7', controller: ['z4', 'p8'] }, values: { number: 'dual' } },
    { anchors: { finiteHead: 'n7', controller: 'z4', goal: 'p8' }, values: { number: 'singular' } },
    { anchors: { finiteHead: 'n7', controller: 'z4', controlledSubject: 'p8' }, values: { number: 'singular' } },
    { anchors: { finiteHead: 'n7', controller: 'missing' }, values: { number: 'singular' } }
  ]) {
    const { dispatch } = inspect({ relation: 'Finite agreement', ...relation });
    assert(!dispatch.facets.some(facet => facet.recipe.id === 'feature.dependency'), JSON.stringify(relation));
  }
});

test('inflection and participial hosts retain complete feature participants without using titles or node labels', () => {
  const renamed = structuredClone(forest);
  const ids = { r9: 'a12', n7: 'b63', q2: 'c28', z4: 'd41', p8: 'e07' };
  const rename = node => { node.id = ids[node.id]; node.label = 'Opaque category'; node.children?.forEach(rename); };
  renamed.forEach(rename);
  for (const [host, participant] of [
    ['inflection', 'subject'], ['inflectionalHead', 'subject'],
    ['inflection', 'controller'], ['inflectionalHead', 'controller'],
    ['participle', 'controller'], ['participial_head', 'controller']
  ]) {
    for (const reversed of [false, true]) {
      const anchors = { [host]: 'b63', [participant]: 'd41', intermediateTrace: 'e07' };
      const relation = { relation: reversed ? 'Renamed unfamiliar claim' : 'New description',
        anchors: Object.fromEntries(reversed ? Object.entries(anchors).reverse() : Object.entries(anchors)),
        values: { features: 'dual' } };
      const { dispatch, items } = inspect(relation, renamed);
      assert.deepEqual(dispatch.evidence.currentAnchors['feature.source'], ['b63']);
      assert.deepEqual(dispatch.evidence.currentAnchors['feature.target'], ['d41']);
      assert(dispatch.facets.some(facet => facet.recipe.id === 'feature.dependency'));
      assert.equal(items.filter(item => item.kind === 'node-plaque' && item.plaqueStyle === 'feature').length, 1);
      assert(!items.some(item => item.kind === 'undirected-link' && item.linkStyle === 'feature-sharing'));
      assert.deepEqual(dispatch.evidenceCoverage.fields.find(field => field.key === 'intermediateTrace').unrecoveredItemIndices, [0]);
    }
  }
});

test('feature-host recovery rejects competing participants, mediation, absent features and prose-only roles', () => {
  for (const relation of [
    { anchors: { inflection: 'n7', subject: 'z4' } },
    { anchors: { inflection: 'n7', controller: 'z4' }, values: { explanation: 'The controller has feminine plural features.' } },
    { anchors: { inflection: ['n7', 'p8'], subject: 'z4' }, values: { features: 'dual' } },
    { anchors: { inflection: 'n7', finiteHead: 'p8', controller: 'z4' }, values: { features: 'dual' } },
    { anchors: { inflection: 'n7', controller: 'z4', subject: 'p8' }, values: { features: 'dual' } },
    { anchors: { inflection: 'n7', controller: ['z4', 'p8'] }, values: { features: 'dual' } },
    { anchors: { inflection: 'n7', controller: 'missing' }, values: { features: 'dual' } },
    { anchors: { participle: 'n7', subject: 'z4' }, values: { features: 'dual' } },
    { anchors: { participle: 'n7', controller: 'z4', goal: 'p8' }, values: { features: 'dual' } },
    { anchors: { participle: 'n7', controller: 'z4', agreementMediator: 'p8' }, values: { features: 'dual' } },
    { anchors: { participle: 'n7', controller: 'z4', featureMediator: 'p8' }, values: { features: 'dual' } },
    { anchors: { participle: 'n7', objectClitic: 'z4' }, values: { features: 'dual', controller: 'direct object, not subject' } },
    { anchors: { participle: 'n7', controller: 'z4', controlledSubject: 'p8' }, values: { features: 'dual' } }
  ]) {
    const { dispatch } = inspect({ relation: 'Finite or participial agreement', ...relation });
    assert(!dispatch.facets.some(facet => facet.recipe.id === 'feature.dependency'), JSON.stringify(relation));
  }
});
