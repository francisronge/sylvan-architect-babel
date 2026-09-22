import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import { getFrameRelations } from '../replay/replayCompiler.ts';

const example = () => ({
  relation: { relation: 'Open dependency', anchors: { lowerCopy: 'lower', traceWitness: 'lower', higherCopy: 'upper' } },
  priorForest: [{ id: 'lower', label: 'X', lineageId: 'same', word: 'token' }],
  currentForest: [{ id: 'root', label: 'ZP', children: [
    { id: 'complex', label: 'Z', children: [
      { id: 'upper', label: 'X', lineageId: 'same', word: 'token' },
      { id: 'host', label: 'Z', silent: true }
    ] },
    { id: 'lower', label: 'X', lineageId: 'same', silent: true },
    { id: 'other', label: 'YP' }
  ] }], stageIndex: 1, relationIndex: 0
});
const stage = (workspaceForest, relations = []) => ({ statement: 'State', stageRecord: '', workspaceForest, relations });
const plan = input => compileRelationRenderPlan([
  stage(input.priorForest), stage(input.currentForest, [input.relation])
]).frames.at(-1).items;

test('movement context reads feature-bearing head and phrase categories without changing them', () => {
  const input = example();
  input.currentForest[0].children[0].children[1].label = 'Z[Q]';
  const original = structuredClone(input);
  assert.equal(recoverMovementEvidence(input.relation, input.currentForest, input.priorForest).movement?.trajectoryKind, 'head');
  input.currentForest[0].children[0].label = 'Z′[Q]';
  assert.equal(recoverMovementEvidence(input.relation, input.currentForest, input.priorForest).movement, undefined);
  input.currentForest[0].children[0] = original.currentForest[0].children[0];
  assert.deepEqual(input, original);
  const phrase = relocatedPhrase('InternalMerge');
  phrase.currentForest[0].children[0].label = 'DP[wh]';
  assert.equal(recoverMovementEvidence(phrase.relation, phrase.currentForest, phrase.priorForest).movement?.trajectoryKind, 'phrasal');
});

test('movement refusals cannot be bypassed by another drawing or transition path', () => {
  for (const [code, change] of [
    ['MOVEMENT_ENDPOINT_CONTAINMENT', input => {
      input.currentForest = [{ id: 'lower', label: 'XP', lineageId: 'same', children: [
        { id: 'upper', label: 'YP', lineageId: 'same' }
      ] }];
    }],
    ['MOVEMENT_PRIOR_SOURCE_CONFLICT', input => {
      input.relation.priorAnchors = { source: 'other-prior' };
      input.priorForest.push({ id: 'other-prior', label: 'NP', lineageId: 'other' });
    }],
    ['MOVEMENT_CONTEXT_UNRESOLVED', input => {
      input.currentForest[0].children[0].children[1].label = 'W';
    }],
    ['MOVEMENT_CONTEXT_UNRESOLVED', input => {
      input.currentForest[0].children[0].children[1].label = 'W';
      input.priorForest = [];
    }]
  ]) {
    const input = example();
    change(input);
    const original = structuredClone(input);
    assert.equal(recoverMovementEvidence(input.relation, input.currentForest, input.priorForest).failure, code);
    const result = dispatchRelationClaims(input);
    assert.ok(!result.facets.some(facet => ['movement.path', 'movement.carrier'].includes(facet.recipe.id)), code);
    assert.ok(!plan(input).some(item => item.kind === 'trajectory'), code);
    assert.deepEqual(input, original);
  }
});

test('a valid movement cannot consume unrelated prior witnesses or landings as continuity', () => {
  for (const role of ['traceWitness', 'higherCopy']) {
    const input = example();
    input.priorForest.push({ id: 'unrelated', label: 'DP', lineageId: 'unrelated' });
    input.relation.priorAnchors = { [role]: 'unrelated' };
    const result = dispatchRelationClaims(input);
    const movement = result.facets.find(facet => facet.recipe.id === 'movement.path');
    assert.ok(movement?.evaluation.earnedTransitions.includes('movement'));
    assert.ok(!movement.evaluation.consumedEvidence.some(ref => ref.field === 'priorAnchors'));
    const trajectory = plan(input).find(item => item.kind === 'trajectory');
    assert.ok(trajectory);
    assert.ok(!trajectory.backward);
    assert.deepEqual(trajectory.priorWitnessNodeIds, []);
    assert.ok(result.claims.some(claim => claim.tier === 3
      && claim.consumedEvidence.some(ref => ref.field === 'priorAnchors' && ref.key === role)));
  }
});

test('complete current movement evidence can draw without inventing a transition or prior continuity', () => {
  for (const prior of ['absent', 'unresolved', 'established']) {
    const input = example();
    if (prior === 'established') input.priorForest = structuredClone(input.currentForest);
    else input.priorForest = [];
    if (prior === 'unresolved') input.relation.priorAnchors = { source: 'missing' };
    const result = dispatchRelationClaims(input);
    const movement = result.facets.find(facet => facet.recipe.id === 'movement.path');
    assert.ok(movement, prior);
    assert.deepEqual(movement.evaluation.earnedTransitions, [], prior);
    const trajectory = plan(input).find(item => item.kind === 'trajectory');
    assert.ok(trajectory, prior);
    if (prior !== 'established') {
      assert.ok(!trajectory.backward, prior);
      assert.ok(!trajectory.priorWitnessNodeIds?.length, prior);
      assert.ok(!movement.evaluation.consumedEvidence.some(ref => ref.field === 'priorAnchors'), prior);
    }
  }
});

test('a valid movement transition preserves the authored pronunciation and independent claims', () => {
  for (const silent of [false, true]) {
    const input = example();
    Object.assign(input.currentForest[0].children[1], { silent, word: 'token' });
    input.relation.anchors.boundary = 'other';
    input.relation.anchors.domain = 'root';
    const result = dispatchRelationClaims(input);
    const movement = result.facets.find(facet => facet.recipe.id === 'movement.path');
    assert.ok(movement?.evaluation.earnedTransitions.includes('movement'));
    assert.ok(result.facets.some(facet => facet.recipe.id === 'locality.boundary'));
    assert.equal(input.currentForest[0].children[1].silent, silent);
  }
});

const relocatedPhrase = relation => ({
  relation: { relation, anchors: { participantA: 'higher', participantB: 'lower' } },
  priorForest: [{ id: 'domain', label: 'VP', children: [
    { id: 'higher', label: 'DP', lineageId: 'chain', word: 'book' }
  ] }],
  currentForest: [{ id: 'landing-parent', label: 'CP', children: [
    { id: 'higher', label: 'DP', lineageId: 'chain', word: 'book' },
    { id: 'domain', label: 'VP', children: [
      { id: 'lower', label: 'DP', lineageId: 'chain', silent: true }
    ] }
  ] }], stageIndex: 1, relationIndex: 0
});

test('exact authored structure binds unfamiliar movement roles through both tiers', () => {
  for (const [name, tier] of [['wh-movement', 1], ['InternalMerge', 2]]) for (const silent of [false, true]) {
    const input = relocatedPhrase(name);
    Object.assign(input.currentForest[0].children[1].children[0], { silent, word: 'book' });
    input.currentForest[0].children.push({ id: 'context', label: 'C' });
    input.relation.anchors.unexplainedContext = 'context';
    const original = structuredClone(input);
    const dispatch = dispatchRelationClaims(input);
    assert.ok(dispatch.claims.some(claim => claim.tier === tier), `${name}: ${JSON.stringify(dispatch.tier1Dispatch.signatureIssues)}`);
    assert.ok(dispatch.claims.some(claim => claim.tier === 3
      && claim.consumedEvidence.some(ref => ref.key === 'unexplainedContext')), 'unrelated context remains neutral');
    const trajectory = plan(input).find(item => item.kind === 'trajectory');
    assert.equal(trajectory?.sourceNodeId, 'lower');
    assert.equal(trajectory?.targetNodeId, 'higher');
    assert.equal(trajectory?.witnessNodeId, 'lower');
    const { steps } = buildReplayPlayback({ sentence: 'book', analyses: [{ derivationStages: [
      stage(input.priorForest), stage(input.currentForest, [input.relation])
    ] }] });
    const moment = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1);
    assert.ok(moment > 0);
    assert.ok(!steps.slice(0, moment).some(step => step.replayVisibleNodeIds.includes('landing-parent')));
    assert.ok(steps[moment].replayVisibleNodeIds.includes('landing-parent'));
    assert.ok(steps[moment].replayRelationLinks.some(link => link.renderFamily === 'trajectory'
      && link.sourceNodeId === 'lower' && link.targetNodeId === 'higher'));
    assert.deepEqual(input, original);
  }
});

test('structural binding cannot invent movement meaning or choose among conflicting occurrences', () => {
  for (const change of [
    input => { input.relation.relation = 'CopySpellout'; },
    input => { input.priorForest = structuredClone(input.currentForest); },
    input => { input.currentForest[0].children[1].children[0].lineageId = 'different'; },
    input => { input.relation.anchors.participantB = ['lower', 'context']; },
    input => { input.relation.anchors.source = 'higher'; },
    input => {
      input.priorForest[0].children[0].id = 'lower';
      input.currentForest[0].children.push({ id: 'second-landing', label: 'DP', lineageId: 'chain', word: 'book' });
      input.relation.anchors.participantC = 'second-landing';
    }
  ]) {
    const input = relocatedPhrase('wh-movement');
    change(input);
    assert.equal(recoverMovementEvidence(input.relation, input.currentForest, input.priorForest).movement, undefined);
    assert.ok(!plan(input).some(item => item.kind === 'trajectory'));
  }
});

test('repeated scalar prior references preserve evidence while a repeated endpoint list stays ambiguous', () => {
  const input = relocatedPhrase('wh-movement');
  input.relation.priorAnchors = { source: 'higher', origin: 'higher' };
  assert.equal(dispatchRelationClaims(input).primaryClaim.tier, 1);
  input.relation.priorAnchors.source = ['higher', 'higher'];
  assert.equal(dispatchRelationClaims(input).primaryClaim.tier, 3);
});

test('explicit prior direction binds arbitrary current roles without a recognized relation name', () => {
  const input = relocatedPhrase('A previously unseen description');
  input.relation.priorAnchors = { movementSource: 'higher' };
  assert.equal(plan(input).find(item => item.kind === 'trajectory')?.sourceNodeId, 'lower');
  for (const change of [
    x => { x.relation.priorAnchors = { observation: 'higher' }; },
    x => { x.relation.priorAnchors.movementSource = ['higher', 'higher']; },
    x => { x.priorForest = structuredClone(x.currentForest); },
    x => { x.currentForest[0].children[1].id = 'different-slot'; },
    x => { x.currentForest[0].children.push({ id: 'rival', label: 'DP', lineageId: 'chain' }); x.relation.anchors.third = 'rival'; }
  ]) {
    const invalid = structuredClone(input);
    change(invalid);
    assert.ok(!plan(invalid).some(item => item.kind === 'trajectory'), JSON.stringify(invalid.relation));
  }
});

test('a successive step uses its explicit prior source and preserves the earlier lower copy as evidence', () => {
  const lower = { id: 'base', label: 'DP[wh]', lineageId: 'chain', silent: true };
  const edge = { id: 'edge', label: 'DP[wh]', lineageId: 'chain', word: 'book' };
  const priorForest = [{ id: 'domain', label: 'vP', children: [edge, lower] }];
  const currentForest = [{ id: 'root', label: 'CP', children: [
    { ...edge, id: 'upper' },
    { ...priorForest[0], children: [{ ...edge, silent: true }, lower] }
  ] }];
  const relation = { relation: 'Next dependency', anchors: { higherOccurrence: 'upper', baseCopy: 'base', observation: 'edge' },
    priorAnchors: { source: 'edge' } };
  const input = { relation, priorForest, currentForest, stageIndex: 1, relationIndex: 0 };
  const dispatch = dispatchRelationClaims(input);
  assert.equal(dispatch.evidence.movement.sourceNodeId, 'edge');
  assert.ok(dispatch.claims.some(claim => claim.tier === 3 && claim.consumedEvidence.some(ref => ref.key === 'baseCopy')));
  const conflict = structuredClone(input);
  conflict.currentForest[0].children[1].children[1].lineageId = 'other';
  assert.ok(!plan(conflict).some(item => item.kind === 'trajectory'));
});

test('the first supported relation owns movement and its pending parent; later inspection does not repeat it', () => {
  const input = relocatedPhrase('An open description');
  input.priorForest = [{ id: 'landing-parent', label: 'CP', children: input.priorForest }];
  input.relation.priorAnchors = { movementSource: 'higher' };
  const relations = [input.relation, { relation: 'Later inspection', anchors: { lowerCopy: 'lower', higherCopy: 'higher' } }];
  const stages = [stage(input.priorForest), stage(input.currentForest, relations)];
  const recovered = getFrameRelations({ workspaceForest: input.currentForest,
    change: { details: { derivationStageRelations: relations } } }, null, input.priorForest);
  assert.deepEqual(recovered.map(r => r.recoveredMovement?.transition), [true, false]);
  const { steps } = buildReplayPlayback({ sentence: 'book', analyses: [{ derivationStages: stages }] });
  const moment = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 1 && s.replayRelationIdentity.relationIndex === 0);
  assert.ok(moment > 0);
  assert.ok(!steps.slice(0, moment).some(s => s.replayVisibleNodeIds.includes('landing-parent')));
  assert.ok(steps[moment].replayVisibleNodeIds.includes('landing-parent'));
  assert.deepEqual(steps[moment + 1].replayVisibleNodeIds, steps[moment].replayVisibleNodeIds);
  assert.deepEqual(stages[0].workspaceForest, input.priorForest);
});

test('a landing site describes the parent, not the moved occurrence, across unfamiliar scalar roles', () => {
  for (const keepLowerId of [false, true]) {
    const input = relocatedPhrase('Unfamiliar claim');
    if (keepLowerId) input.priorForest[0].children[0].id = 'lower';
    input.relation = { relation: 'Unfamiliar claim', anchors: {
      observedObject: 'higher', landingSite: 'landing-parent', ...(keepLowerId ? {} : { trace: 'lower' })
    }, priorAnchors: { source: keepLowerId ? 'lower' : 'higher' } };
    const original = structuredClone(input);
    const movement = recoverMovementEvidence(input.relation, input.currentForest, input.priorForest).movement;
    assert.equal(movement?.sourceNodeId, 'lower');
    assert.equal(movement?.targetNodeId, 'higher');
    assert.deepEqual(movement?.context, [{ key: 'landingSite', nodeId: 'landing-parent', kind: 'site' }]);
    assert.ok(plan(input).some(item => item.kind === 'trajectory' && item.targetNodeId === 'higher'));
    assert.deepEqual(input, original);
    for (const change of [
      x => { x.relation.anchors.observedObject = ['higher', 'higher']; },
      x => { x.currentForest[0].children[0].lineageId = 'unrelated'; },
      x => { x.relation.anchors.landingSite = ['landing-parent', 'landing-parent']; },
      x => { x.currentForest = [{ id: 'outer', label: 'XP', children: x.currentForest }]; x.relation.anchors.landingSite = 'outer'; },
      x => { x.currentForest[0].children.push({ id: 'rival', label: 'DP', lineageId: 'chain' }); x.relation.anchors.anotherObject = 'rival'; }
    ]) {
      const conflicting = structuredClone(input);
      change(conflicting);
      assert.ok(!plan(conflicting).some(item => item.kind === 'trajectory'), JSON.stringify(conflicting.relation));
    }
  }
});

test('movement into a parent-owned empty position occurs at its first relation, keeping unrelated structure', () => {
  const input = relocatedPhrase('Unfamiliar claim');
  const unrelated = { id: 'unrelated', label: 'AP', children: [{ id: 'adj', label: 'A', word: 'new' }] };
  input.priorForest = [{ id: 'landing-parent', label: 'CP', children: [
    { id: 'empty', label: 'DP', silent: true }, input.priorForest[0], unrelated
  ] }];
  input.currentForest[0].children.push(unrelated);
  input.relation = { relation: 'Unfamiliar claim', anchors: {
    observedObject: 'higher', landingSite: 'landing-parent', trace: 'lower'
  }, priorAnchors: { source: 'higher', targetPosition: 'empty' } };
  const stages = [stage(input.priorForest), stage(input.currentForest, [input.relation,
    { relation: 'Later inspection', anchors: { higherCopy: 'higher', lowerCopy: 'lower' } }])];
  const { steps } = buildReplayPlayback({ sentence: 'book new', analyses: [{ derivationStages: stages }] });
  const moment = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 1 && s.replayRelationIdentity.relationIndex === 0);
  assert.ok(moment > 0);
  assert.ok(steps[moment - 1].replayVisibleNodeIds.includes('empty'));
  assert.ok(!steps[moment - 1].replayVisibleNodeIds.includes('lower'));
  assert.ok(!steps[moment].replayVisibleNodeIds.includes('empty'));
  assert.ok(steps[moment].replayVisibleNodeIds.includes('lower'));
  for (const id of ['unrelated', 'adj', 'domain', 'landing-parent', 'higher']) {
    assert.ok(steps[moment - 1].replayVisibleNodeIds.includes(id), id);
    assert.ok(steps[moment].replayVisibleNodeIds.includes(id), id);
  }
  assert.deepEqual(steps[moment + 1].replayVisibleNodeIds, steps[moment].replayVisibleNodeIds);
});

const successiveHeadExtraction = () => {
  const earlier = { id: 'original', label: 'D⁰[trace]', lineageId: 'chain', silent: true };
  const moving = { id: 'previous', label: 'D⁰[clitic]', lineageId: 'chain', word: 'les' };
  const lowerComplex = child => ({ id: 'lower-complex', label: 'V⁰[complex]', children: [
    child, { id: 'lower-host', label: 'V⁰[participle]', word: 'vus' }
  ] });
  const host = { id: 'higher-host', label: 'V⁰[auxiliary]', word: 'a' };
  return {
    relation: { relation: 'clitic excorporation', anchors: {
      movedHead: 'higher', intermediateTrace: 'lower', originalTrace: 'original', landingComplex: 'higher-complex'
    }, priorAnchors: { source: 'previous', sourceComplex: 'lower-complex', host: 'higher-host' } },
    priorForest: [{ id: 'root', label: 'VP', children: [host, lowerComplex(moving), earlier] }],
    currentForest: [{ id: 'root', label: 'VP', children: [
      { id: 'higher-complex', label: 'V⁰[complex]', children: [{ ...moving, id: 'higher' }, host] },
      lowerComplex({ id: 'lower', label: 'D⁰[intermediate trace]', lineageId: 'chain', silent: true }), earlier
    ] }], stageIndex: 1, relationIndex: 0
  };
};

test('successive head movement distinguishes occurrences from their complexes and retains earlier copies', () => {
  for (const reverse of [false, true]) {
    const input = successiveHeadExtraction();
    if (reverse) for (const block of ['anchors', 'priorAnchors']) {
      input.relation[block] = Object.fromEntries(Object.entries(input.relation[block]).reverse());
    }
    const original = structuredClone(input);
    const movement = recoverMovementEvidence(input.relation, input.currentForest, input.priorForest).movement;
    assert.equal(movement?.priorSourceNodeId, 'previous');
    assert.equal(movement?.sourceNodeId, 'lower');
    assert.equal(movement?.targetNodeId, 'higher');
    assert.equal(movement?.witnessNodeId, 'lower');
    assert.equal(movement?.trajectoryKind, 'head');
    const dispatch = dispatchRelationClaims(input);
    assert.ok(dispatch.facets.some(facet => facet.recipe.id === 'movement.path'));
    assert.ok(dispatch.claims.some(claim => claim.tier === 3
      && claim.consumedEvidence.some(ref => ref.field === 'anchors' && ref.key === 'originalTrace')));
    const trajectory = plan(input).find(item => item.kind === 'trajectory');
    assert.equal(trajectory?.sourceNodeId, 'lower');
    assert.equal(trajectory?.targetNodeId, 'higher');
    assert.deepEqual(input, original);
  }
});

test('a source complex cannot conceal conflicting, repeated or misplaced movement evidence', () => {
  for (const [name, change] of [
    ['unrelated complex', input => { input.relation.priorAnchors.sourceComplex = 'higher-host'; }],
    ['enclosing ancestor', input => { input.relation.priorAnchors.sourceComplex = 'root'; }],
    ['repeated source list', input => { input.relation.priorAnchors.source = ['previous', 'previous']; }],
    ['wrong source identity', input => { input.priorForest[0].children[1].children[0].lineageId = 'other'; }],
    ['different lower slot', input => { input.currentForest[0].children[1].children.reverse(); }],
    ['competing landing', input => {
      input.currentForest[0].children.push({ id: 'rival', label: 'DP', lineageId: 'chain' });
      input.relation.anchors.higherOccurrence = 'rival';
    }]
  ]) {
    const input = successiveHeadExtraction();
    change(input);
    assert.equal(recoverMovementEvidence(input.relation, input.currentForest, input.priorForest).movement, undefined, name);
    assert.ok(!plan(input).some(item => item.kind === 'trajectory'), name);
  }
});
