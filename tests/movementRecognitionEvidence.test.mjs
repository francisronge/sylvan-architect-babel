import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';

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
