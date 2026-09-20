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

test('explicit subject/head agreement pairs preserve scalar feature dimensions and exact endpoints', () => {
  for (const [anchors, values] of [
    [{ finiteHead: 'source', subject: 'argument' }, { features: 'third-person singular' }],
    [{ finiteHead: 'source', subject: 'argument', verb: 'exponent' }, { person: 'third', number: 'singular', gender: 'feminine' }],
    [{ head: 'source', specifier: 'argument' }, { agreement: '3SG' }]
  ]) {
    const relation = { relation: 'An unfamiliar name', anchors, values };
    const original = structuredClone(relation);
    const d = dispatch(relation);
    assert(d.facets.some(f => f.recipe.id === 'feature.dependency'));
    assert.deepEqual(d.evidence.currentAnchors['feature.source'], ['source']);
    assert.deepEqual(d.evidence.currentAnchors['feature.target'], ['argument']);
    const path = plan(relation).find(item => item.kind === 'directed-path');
    assert.equal(path.fromNodeId, 'source'); assert.equal(path.toNodeId, 'argument');
    assert.deepEqual(path.relationRef.values, values);
    assert.deepEqual(relation, original);
  }
  for (const relation of [
    { relation: 'subject agreement', anchors: { finiteHead: 'source', subject: 'argument' } },
    { relation: 'subject agreement', anchors: { finiteHead: 'source', topic: 'argument' }, values: { agreement: '3SG' } },
    { relation: 'subject agreement', anchors: { finiteHead: ['source', 'other'], subject: 'argument' }, values: { agreement: '3SG' } },
    { relation: 'subject agreement', anchors: { finiteHead: 'source', subject: 'argument' }, values: { features: '3SG', agreement: '3PL' } },
    { relation: 'specifier-head agreement', anchors: { head: 'source', specifier: 'argument' }, values: { features: 'unrelated description' } }
  ]) assert(!dispatch(relation).facets.some(f => f.recipe.id === 'feature.dependency'), JSON.stringify(relation));
});

test('an agreement-qualified goal works through the registered Agree signature', () => {
  for (const role of ['agreementGoal', 'goalAtAgreement']) {
    const relation = { relation: 'Agree', anchors: { probe: 'source', [role]: 'argument' },
      values: { case: 'nominative', phiFeatures: 'third-person singular' } };
    const d = dispatch(relation);
    assert.equal(d.primaryClaim.tier, 1);
    assert.equal(d.tier1Dispatch.boundRelation.anchors.goal, 'argument');
    assert.deepEqual(relation.anchors, { probe: 'source', [role]: 'argument' });
  }
});

test('qualified control roles name their exact occurrences without choosing from a chain', () => {
  for (const controller of ['controller', 'controllerThetaPosition', 'controllerChainHead']) {
    for (const controlled of ['controlee', 'controllee', 'controlledPRO', 'controlledNP']) {
      const relation = { relation: 'An unfamiliar name', anchors: { [controller]: 'source', [controlled]: 'argument' } };
      assert(dispatch(relation).facets.some(f => f.recipe.id === 'control.dependency'), JSON.stringify(relation));
      const path = plan(relation).find(item => item.pathStyle === 'control');
      assert.equal(path.fromNodeId, 'source'); assert.equal(path.toNodeId, 'argument');
    }
  }
  const direct = { relation: 'An unfamiliar name', anchors: { controller: 'source', controllerThematicOccurrence: 'other', controlledPRO: 'argument' } };
  const d = dispatch(direct);
  assert(d.facets.some(f => f.recipe.id === 'control.dependency'));
  assert.deepEqual(d.evidence.currentAnchors.controller, ['source']);
  assert.deepEqual(d.evidenceCoverage.fields.find(f => f.key === 'controllerThematicOccurrence').unrecoveredItemIndices, [0]);
  for (const anchors of [
    { controllerOccurrences: ['source', 'other'], controlledPRO: 'argument' },
    { controllerThetaPosition: 'source', controllerChainHead: 'other', controlledPRO: 'argument' },
    { antecedent: 'source', pro: 'argument' },
    { controller: 'source', notControlledPRO: 'argument' }
  ]) assert(!dispatch({ relation: 'Control only in the title', anchors }).facets.some(f => f.recipe.id === 'control.dependency'), JSON.stringify(anchors));
});

test('governing heads and governed complements require an explicit Case value', () => {
  for (const anchors of [
    { governor: 'source', governedComplement: 'argument' },
    { governingLowerHead: 'source', licensedDP: 'argument', raisedChainHead: 'other' },
    { governingLexicalHead: 'source', governedNP: 'argument' }
  ]) {
    const relation = { relation: 'An unfamiliar name', anchors, values: { Case: 'accusative' } };
    const path = plan(relation).find(item => item.pathStyle === 'case-assignment');
    assert(path, JSON.stringify(relation));
    assert.equal(path.fromNodeId, 'source'); assert.equal(path.toNodeId, 'argument');
    assert.equal(path.label, 'accusative');
    assert(!dispatch({ ...relation, values: undefined }).facets.some(f => f.recipe.id === 'feature.dependency'));
  }
});

test('Case licensing binds nominal roles consistently and preserves accompanying agreement', () => {
  for (const source of ['licensor', 'licenser', 'licensingHead', 'governor', 'caseAssigner']) {
    for (const recipient of ['nominal', 'subject', 'object', 'argument', 'internalArgument', 'external_argument']) {
      const relation = { relation: 'Unregistered claim', anchors: {
        [source]: 'source', [recipient]: 'argument', caseExponent: 'exponent'
      }, values: { case: 'authored Case', agreement: 'authored agreement' } };
      const before = structuredClone(relation);
      const items = plan(relation);
      const assignment = items.find(item => item.pathStyle === 'case-assignment');
      assert(assignment, JSON.stringify(relation));
      assert.equal(assignment.fromNodeId, 'source');
      assert.equal(assignment.toNodeId, 'argument');
      assert.equal(assignment.label, 'authored Case');
      const collection = items.find(item => item.pathStyle === 'case-agree');
      assert.equal(collection.fromNodeId, 'source');
      assert.equal(collection.toNodeId, 'argument');
      assert.deepEqual(collection.featureRow, { label: 'agreement', value: 'authored agreement' });
      assert.deepEqual(dispatch(relation).evidenceCoverage.fields.find(f => f.key === 'caseExponent').unrecoveredItemIndices, [0]);
      assert.deepEqual(relation, before);
    }
  }
});

test('an explicit Case recipient leaves other nominal participants as context', () => {
  for (const contextRole of ['nominal', 'subject', 'object', 'argument', 'internalArgument', 'external_argument']) {
    const relation = { relation: 'Unregistered claim', anchors: {
      licensor: 'source', recipient: 'argument', [contextRole]: 'other'
    }, values: { case: 'accusative' } };
    const paths = plan(relation).filter(item => item.pathStyle === 'case-assignment');
    assert.equal(paths.length, 1);
    assert.equal(paths[0].toNodeId, 'argument');
    assert.deepEqual(dispatch(relation).evidenceCoverage.fields.find(f => f.key === contextRole).unrecoveredItemIndices, [0]);
  }
});

test('nominal roles alone cannot establish or disambiguate Case licensing', () => {
  for (const relation of [
    { anchors: { licensor: 'source', subject: 'argument' } },
    { anchors: { head: 'source', subject: 'argument' }, values: { case: 'nominative' } },
    { anchors: { licensor: 'source', subject: 'argument', object: 'other' }, values: { case: 'nominative' } },
    { anchors: { licensor: ['source', 'other'], subject: 'argument' }, values: { case: 'nominative' } },
    { anchors: { licensor: 'source', subject: 'argument' }, values: { case: ['nominative', 'accusative'] } },
    { anchors: { licensor: 'source', subject: 'source' }, values: { case: 'nominative' } }
  ]) assert(!dispatch({ relation: 'Case licensing in the title', ...relation }).facets.some(f => f.recipe.id === 'feature.dependency'), JSON.stringify(relation));
});
