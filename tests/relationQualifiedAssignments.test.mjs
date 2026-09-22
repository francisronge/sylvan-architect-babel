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
    for (const source of ['introducer', 'introducingHead', 'introducing-predicate', 'thematicIntroducingHead', 'thetaHead', 'thematic_predicate', 'θ-introducer']) {
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

test('qualified scalar argument slots pair with their own role labels regardless of property order', () => {
  for (const qualifier of ['external', 'internal', 'recipient', 'unfamiliar']) {
    for (const suffix of ['Argument', 'ArgumentPosition', 'ThematicPosition', 'ThetaPosition']) {
      const key = `${qualifier}${suffix}`;
      const r = { relation: 'An independently named claim',
        anchors: { [key]: 'other', predicate: 'source', companionArgument: 'argument' },
        values: { companionRole: 'Theme', [`${qualifier}Role`]: 'Experiencer', context: 'Preserve this.' } };
      const original = structuredClone(r);
      const grids = plan(r).filter(item => item.plaqueStyle === 'theta-grid');
      assert.equal(grids.length, 1, JSON.stringify(r));
      assert.deepEqual(grids[0].thetaRoles.map(({ nodeId, label }) => ({ nodeId, label })),
        [{ nodeId: 'other', label: 'Experiencer' }, { nodeId: 'argument', label: 'Theme' }]);
      assert(plan(r).some(item => item.kind === 'fallback' && item.relationRef.values.context === 'Preserve this.'));
      assert.deepEqual(r, original);
    }
  }
});

test('qualified role pairing rejects competing labels, missing slots, and cross-field array pairing', () => {
  for (const r of [
    { anchors: { predicate: 'source', externalArgument: 'argument' }, values: { internalRole: 'Theme' } },
    { anchors: { predicate: 'source', externalArgument: 'argument' }, values: { externalRole: 'Agent', externalThetaRole: 'Theme' } },
    { anchors: { predicate: 'source', externalArgument: ['argument', 'other'] }, values: { externalRole: ['Agent', 'Theme'] } },
    { anchors: { predicate: 'source', externalArgument: 'argument' }, values: { externalArgument: [], externalRole: 'Agent' } },
    { anchors: { predicate: 'source', externalArgument: 'missing' }, values: { externalRole: 'Agent' } }
  ]) assert(!plan({ relation: 'A novel title', ...r }).some(item => item.plaqueStyle === 'theta-grid'), JSON.stringify(r));
});

test('scalar participant names pair with their explicitly qualified role value', () => {
  const r = { relation: 'A new title', anchors: { predicate: 'source', agent: 'other', theme: 'argument' },
    values: { themeRole: 'Theme', agentRole: 'Agent' } };
  const grid = plan(r).find(item => item.plaqueStyle === 'theta-grid');
  assert(grid);
  assert.deepEqual(grid.thetaRoles.map(({ nodeId, label }) => ({ nodeId, label })), [
    { nodeId: 'other', label: 'Agent' }, { nodeId: 'argument', label: 'Theme' }
  ]);
  assert(!plan({ ...r, values: { description: 'The agent receives Agent and the theme receives Theme.' } }).some(item => item.plaqueStyle === 'theta-grid'));
});

test('role-valued fields identify exact named participants across open field names', () => {
  const relation = { relation: 'An unfamiliar interpretation',
    anchors: { predicate: 'source', experiencer: 'other', stimulus: 'argument' },
    values: { objectRole: 'experiencer', subjectRole: 'stimulus' } };
  const grid = plan(relation).find(item => item.plaqueStyle === 'theta-grid');
  assert(grid);
  assert.deepEqual(grid.thetaRoles.map(({ nodeId, label }) => ({ nodeId, label })), [
    { nodeId: 'other', label: 'experiencer' }, { nodeId: 'argument', label: 'stimulus' }
  ]);
  assert(!plan({ ...relation, values: { objectRole: 'experiencer', subjectRole: 'experiencer' } })
    .some(item => item.plaqueStyle === 'theta-grid'));
  assert(!plan({ ...relation, anchors: { experiencer: 'other', stimulus: 'argument' } })
    .some(item => item.plaqueStyle === 'theta-grid'));
});

test('explicit thematic participant names support literal scalar or same-name role labels', () => {
  for (const source of ['predicate', 'introducer']) for (const recipient of ['theme', 'agent', 'patient', 'experiencer', 'location']) {
    const r = { relation: 'A novel label', anchors: { [source]: 'source', [recipient]: 'argument' }, values: { role: 'An authored thematic interpretation' } };
    const grid = plan(r).find(item => item.plaqueStyle === 'theta-grid');
    assert(grid, JSON.stringify(r));
    assert.deepEqual(grid.thetaRoles.map(({ nodeId, label }) => ({ nodeId, label })), [{ nodeId: 'argument', label: r.values.role }]);
    assert(plan({ ...r, values: { [recipient]: 'A literal role' } }).some(item => item.plaqueStyle === 'theta-grid'));
    for (const values of [{ interpretation: 'Agent of this event.' }, {}, { role: ['Role 1', 'Role 2'] }]) {
      assert(!plan({ ...r, values }).some(item => item.plaqueStyle === 'theta-grid'));
    }
  }
  for (const recipient of ['recipient', 'goal']) {
    const r = { relation: 'An unfamiliar claim', anchors: { predicate: 'source', [recipient]: 'argument' }, values: { role: 'A literal thematic role' } };
    assert(plan(r).some(item => item.plaqueStyle === 'theta-grid'));
    const generic = { ...r, anchors: { assigner: 'source', [recipient]: 'argument' } };
    assert(!plan(generic).some(item => item.plaqueStyle === 'theta-grid'), 'generic assignment roles do not establish a thematic domain');
    assert(!plan({ ...generic, values: { [recipient]: 'A literal interpretation' } }).some(item => item.plaqueStyle === 'theta-grid'));
  }
});

test('qualified recipient Case and same-name nominal lists keep exact literal pairing', () => {
  const compound = { relation: 'Unfamiliar', anchors: { caseLicenser: 'source', externalArgument: 'other', object: 'argument', verb: 'exponent' },
    values: { externalRole: 'Agent', objectRole: 'Theme', objectCase: 'An unfamiliar Case' } };
  const assignment = plan(compound).find(item => item.pathStyle === 'case-assignment');
  assert.equal(assignment?.fromNodeId, 'source'); assert.equal(assignment?.toNodeId, 'argument');
  assert.equal(assignment?.label, compound.values.objectCase);
  assert(plan(compound).some(item => item.kind === 'fallback' && item.relationRef.values.externalRole === 'Agent'));
  const list = { relation: 'Another novel title', anchors: { licenser: 'source', nominal: ['argument', 'other'] },
    values: { nominal: ['Authored Case A', 'Authored Case B'] } };
  assert.deepEqual(plan(list).filter(item => item.pathStyle === 'case-assignment').map(item => [item.toNodeId, item.label]),
    [['argument', 'Authored Case A'], ['other', 'Authored Case B']]);
  for (const r of [
    { ...list, values: { nominal: ['One value only'] } },
    { ...list, values: { anotherList: ['Authored Case A', 'Authored Case B'] } },
    { ...list, anchors: { licenser: ['source', 'exponent'], nominal: ['argument', 'other'] } },
    { ...compound, values: { ...compound.values, subjectCase: compound.values.objectCase, objectCase: '' } },
    { ...compound, anchors: { ...compound.anchors, caseLicenser: 'missing' } },
    { ...compound, anchors: { ...compound.anchors, object: ['argument', 'other'] } }
  ]) assert(!plan(r).some(item => item.pathStyle === 'case-assignment'), JSON.stringify(r));
});

test('explicit thematic labels disambiguate lexical predicates and nominal participants', () => {
  for (const participant of ['subject', 'nominalRestrictor']) {
    const r = { relation: 'An independently named claim', anchors: { [participant]: 'other', lexicalPredicate: 'source', extendedPredicate: 'vp' },
      values: { thetaRole: 'Experiencer' } };
    const grid = plan(r).find(item => item.plaqueStyle === 'theta-grid');
    assert(grid);
    assert.deepEqual(grid.anchorNodeIds, ['source']);
    assert.equal(grid.thetaRoles[0].nodeId, 'other');
    assert(plan(r).some(item => item.kind === 'fallback' && item.relationRef.anchors.extendedPredicate === 'vp'));
    assert(!plan({ ...r, values: { description: 'This is an Experiencer.' } }).some(item => item.plaqueStyle === 'theta-grid'));
    assert(!plan({ ...r, anchors: { ...r.anchors, predicate: 'argument' } }).some(item => item.plaqueStyle === 'theta-grid'));
  }
});

test('an explicit role binds one subject to one lexical predicate, including a later subject position', () => {
  for (const subjectRole of ['subject', 'subjectPosition']) {
    const relation = { relation: 'An unfamiliar claim',
      anchors: { lexicalPredicate: 'source', predicationDomain: 'vp', [subjectRole]: 'other' },
      values: { role: 'Agent' } };
    const grid = plan(relation).find(item => item.plaqueStyle === 'theta-grid');
    assert.ok(grid, JSON.stringify(relation));
    assert.deepEqual(grid.anchorNodeIds, ['source']);
    assert.deepEqual(grid.thetaRoles.map(({ nodeId, label }) => ({ nodeId, label })), [{ nodeId: 'other', label: 'Agent' }]);
    assert(plan(relation).some(item => item.kind === 'fallback' && item.relationRef.anchors.predicationDomain === 'vp'));
  }
  for (const anchors of [
    { lexicalPredicate: 'source', subject: ['argument', 'other'] },
    { lexicalPredicate: 'source', subject: 'other', subjectPosition: 'argument' },
    { lexicalPredicate: 'source', predicate: 'argument', subject: 'other' }
  ]) assert(!plan({ relation: 'Unfamiliar', anchors, values: { role: 'Agent' } }).some(item => item.plaqueStyle === 'theta-grid'));
});

test('an explicit thematic introducer and matching role term bind a novel participant name', () => {
  const relation = { relation: 'An unfamiliar claim',
    anchors: { introducer: 'source', predicate: 'exponent', stimulus: 'other' },
    values: { thetaRole: 'nonagentive stimulus' } };
  const grid = plan(relation).find(item => item.plaqueStyle === 'theta-grid');
  assert.ok(grid);
  assert.deepEqual(grid.anchorNodeIds, ['source']);
  assert.deepEqual(grid.thetaRoles.map(({ nodeId, label }) => ({ nodeId, label })), [{ nodeId: 'other', label: 'nonagentive stimulus' }]);
  assert(plan(relation).some(item => item.kind === 'fallback' && item.relationRef.anchors.predicate === 'exponent'));
  for (const values of [{ thetaRole: 'nonagentive experiencer' }, { role: 'nonagentive stimulus' },
    { thetaRole: 'nonagentive stimulus', case: 'accusative' }]) {
    assert(!plan({ ...relation, values }).some(item => item.plaqueStyle === 'theta-grid'), JSON.stringify(values));
  }
});

test('position qualifiers retain exact subject and finite head roles in Case and agreement', () => {
  for (const subjectRole of ['subject', 'subjectPosition']) {
    const relation = { relation: 'An unfamiliar claim',
      anchors: { finiteHeadPosition: 'source', [subjectRole]: 'other' },
      values: { agreement: 'third-person singular', case: 'nominative' } };
    const paths = plan(relation).filter(item => item.kind === 'directed-path');
    assert(paths.some(item => item.fromNodeId === 'source' && item.toNodeId === 'other'), JSON.stringify(relation));
  }
  for (const anchors of [
    { finiteHeadPosition: ['source', 'exponent'], subject: 'other' },
    { finiteHeadPosition: 'source', subject: 'other', subjectPosition: 'argument' },
    { finiteHeadPosition: 'source', subjectPosition: ['argument', 'other'] }
  ]) assert(!dispatch({ relation: 'An unfamiliar claim', anchors,
    values: { agreement: 'third-person singular', case: 'nominative' } }).facets.some(facet => facet.recipe.id === 'feature.dependency'));
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
    { relation: 'An unfamiliar name', anchors: { notThetaHead: 'source', argument: 'argument' }, values: { thetaRole: 'Agent' } },
    { relation: 'Open claim', anchors: { notIntroducingHead: 'source', argument: 'argument' }, values: { thetaRole: 'Agent' } },
    { relation: 'Open claim', anchors: { introducingHead: 'source', argument: 'argument' } },
    { relation: 'Open claim', anchors: { introducingHead: 'source', argument: 'argument' }, values: { case: 'ACC' } }
  ]) {
    assert.equal(plan(relation).some(item => item.plaqueStyle === 'theta-grid'), false, JSON.stringify(relation));
  }
});

test('an independently named probe and goal retain a feature origin inside that goal as exact context', () => {
  for (const name of ['Open agreement', 'Agree']) {
    for (const sourceRole of ['probe', 'searcher']) {
      const relation = { relation: name, anchors: { [sourceRole]: 'source', goal: 'argument', featureSource: 'exponent' },
        values: { gender: 'feminine', number: 'singular' } };
      const original = structuredClone(relation);
      const d = dispatch(relation);
      assert(d.claims.some(claim => claim.tier === (name === 'Agree' ? 1 : 2)));
      assert.deepEqual(d.evidence.currentAnchors['feature.source'], ['source']);
      assert.deepEqual(d.evidence.currentAnchors['feature.target'], ['argument']);
      assert.deepEqual(d.evidenceCoverage.fields.find(field => field.key === 'featureSource').unrecoveredItemIndices, [0]);
      const items = plan(relation);
      assert(items.some(item => item.kind === 'fallback' && item.relationRef.anchors.featureSource === 'exponent'));
      for (const path of items.filter(item => item.pathStyle === 'case-agree')) {
        assert.equal(path.fromNodeId, 'source');
        assert.equal(path.toNodeId, 'argument');
      }
      assert.deepEqual(relation, original);
    }
  }
  for (const anchors of [
    { probe: 'source', goal: 'argument', featureSource: 'other' },
    { probe: 'source', goal: ['argument', 'other'], featureSource: 'exponent' },
    { probe: ['source', 'other'], goal: 'argument', featureSource: 'exponent' },
    { probe: 'source', goal: 'argument', featureSource: 'missing' }
  ]) {
    const d = dispatch({ relation: 'Open agreement', anchors, values: { features: '3SG' } });
    assert(!d.facets.some(facet => facet.recipe.id === 'feature.dependency'), JSON.stringify(anchors));
  }
  const noValues = dispatch({ relation: 'Open agreement', anchors: { probe: 'source', goal: 'argument', featureSource: 'exponent' } });
  assert(!noValues.facets.some(facet => facet.recipe.id === 'feature.dependency'));
});

test('an explicit thematic introducer owns the assignment while its lexical predicate stays contextual', () => {
  for (const source of ['introducer', 'introducingHead', 'thetaAssigner', 'thematicSource', 'θ-introducer']) {
    for (const name of ['An unfamiliar claim', 'ThetaAssignment']) for (const entries of [[['predicate', 'other'], [source, 'source']], [[source, 'source'], ['predicate', 'other']]]) {
      const relation = { relation: name, anchors: { ...Object.fromEntries(entries), argument: 'argument' }, values: { role: 'Agent' } };
      const before = structuredClone(relation), d = dispatch(relation);
      const grid = plan(relation).find(item => item.plaqueStyle === 'theta-grid');
      assert(grid, JSON.stringify(relation));
      assert.deepEqual(grid.anchorNodeIds, ['source']);
      assert.deepEqual(grid.thetaRoles.map(({ nodeId, label }) => ({ nodeId, label })), [{ nodeId: 'argument', label: 'Agent' }]);
      assert.deepEqual(d.evidenceCoverage.fields.find(field => field.key === 'predicate').unrecoveredItemIndices, [0]);
      assert(plan(relation).some(item => item.kind === 'fallback' && item.relationRef.anchors.predicate === 'other'));
      assert.deepEqual(relation, before);
    }
  }
  for (const anchors of [
    { introducer: ['source', 'other'], predicate: 'vp', argument: 'argument' },
    { introducer: 'source', thetaAssigner: 'other', predicate: 'vp', argument: 'argument' }
  ]) assert(!plan({ relation: 'An unfamiliar claim', anchors, values: { role: 'Agent' } }).some(item => item.plaqueStyle === 'theta-grid'));
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

test('nominal agreement pairs use their explicit controller and feature host', () => {
  for (const [host, controller] of [['determiner', 'nominalController'], ['possessiveHead', 'possessor']]) {
    const r = { relation: 'Independent claim', anchors: { [controller]: 'other', [host]: 'source' },
      values: { features: ['third person', 'plural'], ...(controller === 'possessor' ? { possessorCase: 'genitive' } : {}) } };
    const d = dispatch(r);
    assert(d.facets.some(f => f.recipe.id === 'feature.dependency'));
    assert.deepEqual(d.evidence.currentAnchors['feature.source'], ['source']);
    assert.deepEqual(d.evidence.currentAnchors['feature.target'], ['other']);
    if (controller === 'possessor') assert.deepEqual(d.evidence.values['case.literal'], ['genitive']);
    for (const change of [
      { values: { explanation: 'The possessor or nominal controls agreement.' } },
      { anchors: { [controller]: ['other', 'argument'], [host]: 'source' } },
      { anchors: { [controller]: 'other', [host]: ['source', 'argument'] } },
      { anchors: { [controller]: 'other', [host]: 'missing' } },
      { anchors: { [controller]: 'other', unrelated: 'source' } }
    ]) assert(!dispatch({ ...r, ...change }).facets.some(f => f.recipe.id === 'feature.dependency'), JSON.stringify(change));
  }
  const unrelatedCase = dispatch({ relation: 'Independent claim', anchors: { probe: 'source', goal: 'other' },
    values: { features: 'plural', possessorCase: 'genitive' } });
  assert.equal(unrelatedCase.evidence.values['case.literal'], undefined);
  assert.deepEqual(unrelatedCase.evidenceCoverage.fields.find(f => f.key === 'possessorCase').unrecoveredItemIndices, [0]);
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
  for (const source of ['licensor', 'licenser', 'licensingHead', 'governor', 'caseAssigner', 'probe', 'collector', 'featureSource']) {
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

test('phi notation keeps the authored feature bundle beside Case and its exact source', () => {
  for (const key of ['phi', 'φ', 'ϕ', 'phiFeatures']) {
    for (const recipient of ['goal', 'subject', 'object', 'nominal']) {
      const relation = { relation: 'A new claim', anchors: { probe: 'source', [recipient]: 'argument', verb: 'other' },
        values: { case: 'nominative', [key]: 'third person plural; inclusive' } };
      const items = plan(relation);
      const assignment = items.find(item => item.pathStyle === 'case-assignment');
      const collector = items.find(item => item.pathStyle === 'case-agree');
      assert.equal(assignment?.fromNodeId, 'source');
      assert.equal(assignment?.toNodeId, 'argument');
      assert.equal(collector?.fromNodeId, 'source');
      assert.equal(collector?.toNodeId, 'argument');
      assert.deepEqual(collector?.featureRow, { label: key, value: relation.values[key] });
      assert.deepEqual(dispatch(relation).evidenceCoverage.fields.find(field => field.key === key).unrecoveredItemIndices, []);
    }
    const competing = { relation: 'A new claim', anchors: { probe: 'source', goal: 'argument' },
      values: { [key]: '3SG', agreement: '3PL' } };
    assert(!plan(competing).some(item => item.pathStyle === 'case-agree'), 'competing bundles must remain distinct and unresolved');
  }
});

test('qualified Case-value keys share the literal reader without turning overt marking into assignment', () => {
  for (const key of ['abstractCase', 'structural_case', 'INHERENT CASE']) {
    for (const name of ['Open licensing claim', 'CaseAssignment']) {
      const relation = { relation: name, anchors: { governor: 'source', nominal: 'argument', caseExponent: 'exponent' },
        values: { [key]: 'a new Case value', overtCaseMarking: 'none' } };
      const assignment = plan(relation).find(item => item.pathStyle === 'case-assignment');
      assert(assignment, `${name} ${key}`);
      assert.equal(assignment.fromNodeId, 'source');
      assert.equal(assignment.toNodeId, 'argument');
      assert.equal(assignment.featureRow?.value || assignment.label, 'a new Case value');
      assert.equal(relation.values.overtCaseMarking, 'none');
    }
  }
  for (const relation of [
    { anchors: { governor: 'source', nominal: 'argument' }, values: { overtCaseMarking: 'accusative' } },
    { anchors: { caseHead: 'source', nominal: 'argument' }, values: { inherentCase: 'ergative' } },
    { anchors: { governor: 'source', nominal: 'argument' }, values: { abstractCase: 'accusative', structuralCase: 'nominative' } }
  ]) assert(!plan({ relation: 'Open licensing claim', ...relation }).some(item => item.pathStyle === 'case-assignment'));
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

test('qualified Case direction requires its own Case-domain or matching literal evidence', () => {
  for (const [qualifier, value] of [['case', 'any Case label'], ['accusative', 'ACC'], ['ergative', 'ERG'], ['nom', 'nominative'],
    ['novel', 'novel'], ['外部 ', '外部'], ['structural case ', 'new Case distinction']]) {
    for (const noun of ['Goal', 'Recipient', 'Assignee', 'Bearer']) {
        const role = `${qualifier}${noun}`;
        const relation = { relation: 'Unfamiliar claim', anchors: { licensor: 'source', [role]: 'argument' }, values: { case: value } };
        const original = structuredClone(relation);
        const items = plan(relation);
        const assignment = items.find(item => item.pathStyle === 'case-assignment');
        assert(assignment, JSON.stringify(relation));
        assert.equal(assignment.fromNodeId, 'source');
        assert.equal(assignment.toNodeId, 'argument');
        assert.equal(assignment.label, value, 'the qualified role never supplies or changes the authored Case literal');
        assert.deepEqual(relation, original);
        assert(!plan({ ...relation, values: undefined }).some(item => item.pathStyle === 'case-assignment'));
    }
  }
  for (const anchors of [
    { structuralCaseAssigner: 'source', recipient: 'argument' },
    { goal: 'argument', accusativeLicensor: 'source' },
    { governor: 'source', caseRecipient: 'argument' },
    { licensor: 'source', accusativeGoals: ['argument'] }
  ]) {
    const relation = { relation: 'Open claim', anchors, values: { case: 'ACC' } };
    const assignment = plan(relation).find(item => item.pathStyle === 'case-assignment');
    assert(assignment, JSON.stringify(anchors));
    assert.equal(assignment.fromNodeId, 'source');
    assert.equal(assignment.toNodeId, 'argument');
  }
  const explicit = { relation: 'Open claim', anchors: { licensor: 'source', accusativeGoal: 'argument', subject: 'other' }, values: { case: 'ACC' } };
  assert.equal(plan(explicit).find(item => item.pathStyle === 'case-assignment').toNodeId, 'argument');
  assert.deepEqual(dispatch(explicit).evidenceCoverage.fields.find(field => field.key === 'subject').unrecoveredItemIndices, [0]);
});

test('unrelated qualified goals remain context beside a supported Case recipient', () => {
  const currentForest = [{ id: 'root', label: 'VP', children: [
    { id: 'v', label: 'V', word: 'sent' }, { id: 'dp', label: 'DP', word: 'books' },
    { id: 'pp', label: 'PP', children: [{ id: 'p', label: 'P', word: 'to' }, { id: 'mia', label: 'DP', word: 'Mia' }] }
  ] }];
  for (const name of ['Open joint claim', 'CaseAssignment']) for (const role of [
    'semanticGoal', 'spatialGoal', 'θ-goal', 'alternativeGoal', 'unknownRecipient', 'dativeGoal', 'novelGoal', '外部 Goal'
  ]) {
    const relation = { relation: name, anchors: { caseAssigner: 'v', object: 'dp', [role]: 'pp' }, values: { case: 'ACC' } };
    const original = structuredClone(relation);
    const d = dispatchRelationClaims({ relation, currentForest, stageIndex: 0, relationIndex: 0 });
    const items = compileRelationRenderPlan([{ statement: 'State', stageRecord: 'Authored', workspaceForest: currentForest, relations: [relation] }]).frames[0].items;
    const assignments = items.filter(item => item.pathStyle === 'case-assignment');
    assert.equal(assignments.length, 1, JSON.stringify(relation));
    assert.equal(assignments[0].fromNodeId, 'v');
    assert.equal(assignments[0].toNodeId, 'dp');
    assert.deepEqual(d.evidenceCoverage.fields.find(field => field.key === role).unrecoveredItemIndices, [0]);
    assert.deepEqual(relation, original);
    const unsupported = { ...relation, anchors: { caseAssigner: 'v', [role]: 'pp' } };
    const unsupportedPlan = compileRelationRenderPlan([{ statement: 'State', stageRecord: 'Authored', workspaceForest: currentForest, relations: [unsupported] }]);
    assert(!unsupportedPlan.frames[0].items.some(item => item.pathStyle === 'case-assignment'), JSON.stringify(unsupported));
  }
});

test('qualified Case roles preserve negation, prior context, competing participants and unresolved IDs', () => {
  for (const role of ['notGoal', 'nonRecipient', 'blockedGoal', 'candidateRecipient', 'priorGoal', 'formerBearer', 'inaccessibleGoal', 'alternativeGoal']) {
    const relation = { relation: 'Case assignment in the title', anchors: { licensor: 'source', [role]: 'argument' }, values: { case: 'ACC' } };
    assert(!plan(relation).some(item => item.pathStyle === 'case-assignment'), role);
    assert.deepEqual(dispatch(relation).evidenceCoverage.fields.find(field => field.key === role).unrecoveredItemIndices, [0]);
  }
  for (const anchors of [
    { licensor: 'source', accusativeGoal: 'argument', caseRecipient: 'other' },
    { licensor: 'source', caseAssigner: 'other', accusativeGoal: 'argument' },
    { head: 'source', accusativeGoal: 'argument' },
    { licensor: 'source', accusativeGoal: 'missing' },
    { licensor: 'source', accusativeGoal: 'source' }
  ]) {
    const relation = { relation: 'Open claim', anchors, values: { case: 'ACC' } };
    assert(!plan(relation).some(item => item.pathStyle === 'case-assignment'), JSON.stringify(anchors));
  }
});

test('a goal occurrence keeps its exact Case recipient under an explicit licensor', () => {
  const relation = { relation: 'An open Case claim', anchors: { licensor: 'source', goalOccurrence: 'argument' },
    values: { case: 'nominative' } };
  const path = plan(relation).find(item => item.pathStyle === 'case-assignment');
  assert.equal(path?.fromNodeId, 'source');
  assert.equal(path?.toNodeId, 'argument');
  assert(!plan({ ...relation, values: { description: 'nominative' } }).some(item => item.pathStyle === 'case-assignment'));
  assert(!plan({ ...relation, anchors: { goalOccurrence: 'argument' } }).some(item => item.pathStyle === 'case-assignment'));
});

test('a finite licensor explicitly assigns Case to its named recipient', () => {
  const relation = { relation: 'Unknown relation name', anchors: { finiteLicensor: 'source', recipient: 'argument' },
    values: { case: 'nominative' } };
  const path = plan(relation).find(item => item.pathStyle === 'case-assignment');
  assert.equal(path?.fromNodeId, 'source');
  assert.equal(path?.toNodeId, 'argument');
  assert(!plan({ ...relation, values: { description: 'nominative' } }).some(item => item.pathStyle === 'case-assignment'));
  assert(!plan({ ...relation, anchors: { finiteLicensor: 'source', recipient: ['argument', 'other'] } })
    .some(item => item.pathStyle === 'case-assignment'));
});

test('Case context cannot repurpose participants already qualified by another relation domain', () => {
  for (const role of ['thetaSource', 'thematicAssigner', 'movementSource', 'covertMovementSource', 'controlSource', 'bindingSource', 'scopeSource', 'correspondenceSource']) {
    const relation = { relation: 'Open compound claim', anchors: { [role]: 'source', recipient: 'argument' }, values: { case: 'ACC' } };
    assert(!plan(relation).some(item => item.pathStyle === 'case-assignment'), role);
    assert(!dispatch(relation).evidence.authoredCurrentAnchors.find(entry => entry.key === role).concepts.includes('feature.source'), role);
  }
  for (const role of ['thetaRecipient', 'movementGoal', 'controlRecipient', 'extractionTarget', 'bindingTarget']) {
    const relation = { relation: 'Open compound claim', anchors: { licensor: 'source', [role]: 'argument' }, values: { case: 'ACC' } };
    assert(!plan(relation).some(item => item.pathStyle === 'case-assignment'), role);
  }
});

test('an explicitly licensed nominal topic can receive Case without prescribing a topic analysis', () => {
  for (const label of ['D[topic, nominative]', 'DP', 'NP', 'N', 'KP', 'D⁰ [topic]', 'N^0', 'K0']) {
    const currentForest = structuredClone(forest);
    currentForest[0].children[1].label = label;
    for (const name of ['Open claim', 'CaseAssignment']) {
      const relation = { relation: name, anchors: { licensor: 'source', topic: 'argument' }, values: { case: 'authored Case', discourseFunction: 'aboutness' } };
      const items = compileRelationRenderPlan([{ statement: 'State', stageRecord: 'Authored', workspaceForest: currentForest, relations: [relation] }]).frames[0].items;
      const assignment = items.find(item => item.pathStyle === 'case-assignment');
      assert(assignment, `${name} ${label}`);
      assert.equal(assignment.fromNodeId, 'source');
      assert.equal(assignment.toNodeId, 'argument');
      assert.equal(assignment.featureRow?.value || assignment.label, 'authored Case');
    }
  }
  for (const label of ['CP', 'TP', 'VP', 'unknown category']) {
    const currentForest = structuredClone(forest);
    currentForest[0].children[1].label = label;
    const relation = { relation: 'Topic Case', anchors: { licensor: 'source', topic: 'argument' }, values: { case: 'NOM' } };
    assert(!dispatchRelationClaims({ relation, currentForest, stageIndex: 0, relationIndex: 0 }).facets.some(facet => facet.recipe.id === 'feature.dependency'));
  }
  for (const relation of [
    { anchors: { licensor: 'source', topic: 'argument' } },
    { anchors: { head: 'source', topic: 'argument' }, values: { case: 'NOM' } },
    { anchors: { licensor: 'source', topic: 'missing' }, values: { case: 'NOM' } },
    { anchors: { licensor: 'source', topic: 'argument', subject: 'other' }, values: { case: 'NOM' } },
    { anchors: { finiteHead: 'source', topic: 'argument' }, values: { agreement: '3SG' } }
  ]) assert(!plan({ relation: 'Open claim', ...relation }).some(item => item.pathStyle === 'case-assignment'));
});

test('Case recovery does not invent direction for finite-form and inflection claims', () => {
  for (const anchors of [
    { finiteVerb: 'argument', tenseAgreementHead: 'source' },
    { inflectedPredicate: 'argument', licensor: 'source' },
    { tenseHead: 'source', verb: 'argument' },
    { finiteHead: 'source', lexicalVerb: 'argument' },
    { tense: 'source', verb: 'argument' }
  ]) {
    const relation = { relation: 'Finite-form licensing', anchors, values: { agreement: '3SG', tense: 'past' } };
    assert(!plan(relation).some(item => item.kind === 'directed-path'));
    assert(dispatch(relation).claims.every(claim => claim.tier === 3));
  }
});


test('assigning head supplies Case direction while exponents and conditions retain their own roles', () => {
  for (const source of ['assigningHead', 'assigning-predicate']) {
    const r = { relation: 'Unfamiliar authored label', anchors: { [source]: 'source', argument: 'argument', caseHead: 'exponent', aspectLicensor: 'vp' },
      values: { case: 'An unfamiliar Case', configuration: 'An authored condition' } };
    const path = plan(r).find(item => item.pathStyle === 'case-assignment');
    assert.equal(path?.fromNodeId, 'source'); assert.equal(path?.toNodeId, 'argument');
    assert.equal(path?.label, r.values.case);
    assert.deepEqual(path.relationRef, plan({ ...r, anchors: Object.fromEntries(Object.entries(r.anchors).reverse()) }).find(item => item.pathStyle === 'case-assignment').relationRef);
    const d = dispatch(r);
    for (const key of ['caseHead', 'aspectLicensor']) assert(d.evidenceCoverage.fields.find(field => field.key === key).unrecoveredItemIndices.length);
    for (const bad of [
      { ...r, values: { description: 'This assigns Case' } },
      { ...r, anchors: { ...r.anchors, licensor: 'other' } },
      { ...r, anchors: { ...r.anchors, [source]: ['source', 'other'] } },
      { ...r, anchors: { ...r.anchors, [source]: 'missing' } },
      { ...r, anchors: { caseHead: 'exponent', argument: 'argument' } }
    ]) assert(!plan(bad).some(item => item.pathStyle === 'case-assignment'));
  }
});

test('an explicit verbal agreement target receives collection from its exact controller', () => {
  for (const target of ['verbalTarget', 'verbal_host', 'agreement-target']) {
    const r = { relation: 'An independent label', anchors: { controller: 'argument', finiteHead: 'other', [target]: 'source' },
      values: { checkedFeatures: ['feminine', 'singular'], wholeWordForm: 'An authored spelling' } };
    const original = structuredClone(r);
    for (const anchors of [r.anchors, Object.fromEntries(Object.entries(r.anchors).reverse())]) {
      const d = dispatch({ ...r, anchors });
      assert(d.facets.some(f => f.recipe.id === 'feature.dependency'));
      assert.deepEqual(d.evidence.currentAnchors['feature.source'], ['source']);
      assert.deepEqual(d.evidence.currentAnchors['feature.target'], ['argument']);
      const items = plan({ ...r, anchors });
      const path = items.find(item => item.pathStyle === 'case-agree');
      assert.equal(path?.fromNodeId, 'source'); assert.equal(path?.toNodeId, 'argument');
      assert(d.evidenceCoverage.fields.find(field => field.key === 'finiteHead').unrecoveredItemIndices.length);
      assert(d.evidenceCoverage.fields.find(field => field.key === 'wholeWordForm').unrecoveredItemIndices.length);
    }
    assert.deepEqual(r, original);
    for (const bad of [
      { ...r, values: { description: 'The controller determines agreement on the verb.' } },
      { ...r, anchors: { ...r.anchors, [target]: 'missing' } },
      { ...r, anchors: { ...r.anchors, [target]: ['source', 'other'] } },
      { ...r, anchors: { ...r.anchors, controller: ['argument', 'other'] } },
      { ...r, anchors: { ...r.anchors, verbalHost: 'other' } },
      { ...r, anchors: { ...r.anchors, agreementMediator: 'exponent' } },
      { ...r, anchors: { ...r.anchors, controllee: 'exponent' } },
      { ...r, anchors: { ...r.anchors, probe: 'exponent' } }
    ]) assert(!dispatch(bad).facets.some(f => f.recipe.id === 'feature.dependency'), JSON.stringify(bad));
  }
});


test('qualified predicates preserve argument roles without selecting a competing predicate', () => {
  for (const qualifier of ['passive', 'active', 'causative', 'applicative', 'nominal']) {
    const r = { relation: 'A novel title', anchors: { [`${qualifier}Predicate`]: 'source', agent: 'argument', agentPhrase: 'vp' }, values: { role: 'Agent' } };
    assert.equal(plan(r).find(item => item.plaqueStyle === 'theta-grid')?.thetaRoles[0].nodeId, 'argument');
    assert(plan({ ...r, anchors: Object.fromEntries(Object.entries(r.anchors).reverse()) }).some(item => item.plaqueStyle === 'theta-grid'));
    for (const bad of [
      { ...r, anchors: { ...r.anchors, predicate: 'other' } },
      { ...r, anchors: { ...r.anchors, [`${qualifier}Predicate`]: ['source', 'other'] } },
      { ...r, anchors: { ...r.anchors, [`${qualifier}Predicate`]: 'missing' } },
      { ...r, values: { description: 'Agent' } },
      { ...r, anchors: { unlicensedPredicate: 'source', agent: 'argument' } }
    ]) assert(!plan(bad).some(item => item.plaqueStyle === 'theta-grid'));
  }
});

test('qualified feature properties require a unique dependency or their exact named participant', () => {
  for (const key of ['subjectFeatures', 'objectFeatureBundle', 'novelParticipantFeatures']) {
    const r = { relation: 'Unfamiliar', anchors: { probe: 'source', goal: 'argument' }, values: { [key]: ['first', 'dual'] } };
    const d = dispatch(r);
    assert(d.facets.some(f => f.recipe.id === 'feature.dependency'));
    assert.deepEqual(d.evidenceCoverage.fields.find(f => f.key === key).unrecoveredItemIndices, []);
    const plaque = plan(r).find(item => item.plaqueStyle === 'feature');
    assert.deepEqual(plaque?.rows, [{ label: key, value: 'first' }, { label: key, value: 'dual' }]);
    for (const bad of [
      { ...r, anchors: { probe: 'source', goal: ['argument', 'other'] } },
      { ...r, anchors: { probe: 'source', unrelated: 'argument' } },
      { ...r, anchors: { probe: 'source', goal: 'argument', subject: 'other' } },
      { ...r, values: { [key]: ['first', 'dual'], features: ['third', 'singular'] } }
    ]) assert(!dispatch(bad).evidence.values['feature.rows']?.length || !dispatch(bad).facets.some(f => f.recipe.id === 'feature.dependency'));
  }
  const named = { relation: 'An unknown title', anchors: { probe: 'source', goal: 'argument', nominalParticipant: 'argument' }, values: { nominalParticipantFeatures: ['third', 'plural'] } };
  assert(dispatch(named).evidence.values['feature.rows']?.length);
  assert(!dispatch({ ...named, anchors: { ...named.anchors, nominalParticipant: 'other' } }).evidence.values['feature.rows']?.length);
});

test('agreement bearer and controller identify the explicit host despite a separately named finite probe', () => {
  for (const host of ['agreementBearer', 'verbalBearer']) for (const features of ['overtAgreement', 'covertAgreement', 'valuedAgreement']) {
    const r = { relation: 'An independently named dependency', anchors: { [host]: 'source', controller: 'argument', finiteProbe: 'other' }, values: { [features]: ['feminine', 'plural'] } };
    const d = dispatch(r);
    assert(d.facets.some(f => f.recipe.id === 'feature.dependency'));
    assert.deepEqual(d.evidence.currentAnchors['feature.source'], ['source']);
    assert.deepEqual(d.evidence.currentAnchors['feature.target'], ['argument']);
    assert.deepEqual(d.evidenceCoverage.fields.find(f => f.key === 'finiteProbe').unrecoveredItemIndices, [0]);
    for (const bad of [
      { ...r, anchors: { ...r.anchors, agreementTarget: 'other' } },
      { ...r, anchors: { ...r.anchors, controller: ['argument', 'other'] } },
      { ...r, anchors: { ...r.anchors, [host]: 'missing' } },
      { ...r, values: { description: 'The subject controls agreement.' } }
    ]) assert(!dispatch(bad).facets.some(f => f.recipe.id === 'feature.dependency'));
  }
});
