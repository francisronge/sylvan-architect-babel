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
  for (const label of ['D[topic, nominative]', 'DP', 'NP', 'N', 'KP']) {
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
