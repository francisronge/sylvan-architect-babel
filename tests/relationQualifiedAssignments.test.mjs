import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const forest = [{ id: 'vp', label: 'VP', children: [
  { id: 'source', label: 'V', word: 'sent' },
  { id: 'argument', label: 'DP', children: [{ id: 'exponent', label: 'K', word: 'を' }] },
  { id: 'other', label: 'DP', word: 'Mia' }
] }];
const dispatch = relation => dispatchRelationClaims({ relation, currentForest: forest, stageIndex: 0, relationIndex: 0 });
const plan = relation => compileRelationRenderPlan([{
  statement: 'Assignment', stageRecord: 'The authored claim.', workspaceForest: forest, relations: [relation]
}]).frames[0].items;

test('thematic source and argument qualifications retain literal roles and exact participants', () => {
  for (const relationName of ['theta-role assignment', 'An unfamiliar name']) {
    for (const source of ['introducer', 'thetaHead', 'thematic_predicate', 'θ-introducer']) {
      for (const recipient of ['argument', 'internalArgument', 'external_argument']) {
        const relation = { relation: relationName, anchors: { [source]: 'source', [recipient]: 'argument' },
          values: { thetaRole: 'Experiencer' } };
        const original = structuredClone(relation);
        const grid = plan(relation).find(item => item.plaqueStyle === 'theta-grid');
        assert.ok(grid, JSON.stringify(relation));
        assert.deepEqual(grid.anchorNodeIds, ['source']);
        assert.deepEqual(grid.thetaRoles.map(({ nodeId, label }) => ({ nodeId, label })), [{ nodeId: 'argument', label: 'Experiencer' }]);
        assert.deepEqual(grid.relationRef.anchors, relation.anchors);
        assert.deepEqual(relation, original);
      }
    }
  }
});

test('introducer requires thematic evidence and cannot select a source from competing claims', () => {
  for (const relation of [
    { relation: 'theta-role assignment', anchors: { introducer: 'source', item: 'argument' } },
    { relation: 'A new structure', anchors: { introducer: 'source', argument: 'argument' } },
    { relation: 'A new structure', anchors: { introducer: 'source', item: 'argument' }, values: { role: 'Topic' } },
    { relation: 'An unfamiliar name', anchors: { introducer: 'source', argument: 'argument' }, values: { role: 'Agent', case: 'nominative' } },
    { relation: 'An unfamiliar name', anchors: { thetaHead: 'source', thetaPredicate: 'other', argument: 'argument' }, values: { thetaRole: 'Agent' } },
    { relation: 'An unfamiliar name', anchors: { thetaHead: ['source', 'other'], argument: 'argument' }, values: { thetaRole: 'Agent' } },
    { relation: 'An unfamiliar name', anchors: { thetaHead: 'source', argument: ['argument', 'other'] }, values: { thetaRole: 'Agent' } },
    { relation: 'An unfamiliar name', anchors: { notThetaHead: 'source', argument: 'argument' }, values: { thetaRole: 'Agent' } }
  ]) {
    assert.equal(plan(relation).some(item => item.plaqueStyle === 'theta-grid'), false, JSON.stringify(relation));
  }
});

test('licensed phrase identifies the Case recipient without consuming its distinct exponent', () => {
  for (const source of ['governor', 'licenser', 'licensor']) {
    for (const recipient of ['licensedPhrase', 'licensed_constituent', 'licensed-nominal', 'licensedDP', 'licensed-XP']) {
      const relation = { relation: 'An unfamiliar name', anchors: {
        [source]: 'source', [recipient]: 'argument', caseExponent: 'exponent'
      }, values: { Case: 'accusative' } };
      const d = dispatch(relation);
      const facet = d.facets.find(facet => facet.recipe.id === 'feature.dependency');
      assert.ok(facet, JSON.stringify(relation));
      assert.deepEqual(d.evidence.currentAnchors['feature.target'], ['argument']);
      const exponent = d.evidenceCoverage.fields.find(field => field.key === 'caseExponent');
      assert.deepEqual(exponent.recognizedBy, []);
      assert.deepEqual(exponent.unrecoveredItemIndices, [0]);
      const path = plan(relation).find(item => item.pathStyle === 'case-assignment');
      assert.ok(path);
      assert.equal(path.fromNodeId, 'source');
      assert.equal(path.toNodeId, 'argument');
      assert.equal(path.label, 'accusative');
    }
  }
  for (const relation of [
    { relation: 'Case in the title is not evidence', anchors: { governor: 'source', licensedPhrase: 'argument' } },
    { relation: 'An unfamiliar name', anchors: { governor: 'source', unlicensedPhrase: 'argument' }, values: { case: 'accusative' } },
    { relation: 'An unfamiliar name', anchors: { governor: ['source', 'other'], licensedPhrase: 'argument' }, values: { case: 'accusative' } },
    { relation: 'An unfamiliar name', anchors: { caseHead: 'source', licensedPhrase: 'argument' }, values: { case: 'accusative' } }
  ]) assert.equal(dispatch(relation).facets.some(f => f.recipe.id === 'feature.dependency'), false, JSON.stringify(relation));
});

test('phrasal movement recovers its path while retaining the attracting head as neutral context', () => {
  const low = { id: 'low', lineageId: 'chain', label: 'DP', word: 'Ali' };
  const priorForest = [{ id: 'vp', label: 'VP', children: [low, { id: 'v', label: 'V' }] }];
  const currentForest = [{ id: 'tp', label: 'TP', children: [
    { ...low, id: 'high' }, { id: 'tbar', label: 'T′', children: [
      { id: 'tense', label: 'T' }, { ...priorForest[0], children: [{ ...low, silent: true }, { id: 'v', label: 'V' }] }
    ] }
  ] }];
  const relation = { relation: 'Internal Merge', anchors: {
    attractingHead: 'tense', higherOccurrence: 'high', lowerOccurrence: 'low'
  }, priorAnchors: { sourceOccurrence: 'low' } };
  const d = dispatchRelationClaims({ relation, currentForest, priorForest, stageIndex: 1, relationIndex: 0 });
  assert.ok(d.facets.some(f => f.recipe.id === 'movement.path'));
  const context = d.evidenceCoverage.fields.find(f => f.key === 'attractingHead');
  assert.deepEqual(context.recognizedBy, []);
  assert.deepEqual(context.unrecoveredItemIndices, [0]);
  assert.equal(d.evidence.movement.targetNodeId, 'high');
});
