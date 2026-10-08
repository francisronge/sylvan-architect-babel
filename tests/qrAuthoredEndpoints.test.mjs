import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { compileRelationRenderPlan, visiblePlanFrameItems } from '../replay/relations/renderPlanCompiler.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';

const nodes = forest => forest.flatMap(node => [node, ...nodes(node.children ?? [])]);
const fixtures = ['astra', 'sol'].map(model => ({ model,
  ...JSON.parse(fs.readFileSync(new URL(`../fixtures/replay-regressions/${model}-spanish-qr.json`, import.meta.url))) }));

for (const fixture of fixtures) for (const [analysisIndex, analysis] of fixture.analyses.entries()) {
  test(`saved ${fixture.model} Spanish ${analysisIndex + 1}: every QR has one covert drawing at its atomic landing`, () => {
    const original = structuredClone(analysis);
    const replay = prepareReplay({ sentence: fixture.sentence, derivationStages: analysis.derivationStages, includePlayback: true });
    const stageIndex = analysis.derivationStages.length - 1;
    const stage = analysis.derivationStages[stageIndex];
    const prior = analysis.derivationStages[stageIndex - 1].workspaceForest;
    const moments = stage.relations.filter(relation => /[Qq]uantifier [Rr]aising/u.test(relation.relation));
    assert.equal(moments.length, fixture.model === 'astra' ? 2 : 1);
    assert(!visiblePlanFrameItems(replay.relationRenderPlan, stageIndex, new Set()).some(item => item.kind === 'quantifier-raising'));
    for (const [relationIndex, relation] of moments.entries()) {
      const result = recoverMovementEvidence(relation, stage.workspaceForest, prior);
      assert.equal(result.movement?.trajectoryKind, 'phrasal');
      assert.equal(result.movement.transition, true);
      const { sourceNodeId, targetNodeId } = result.movement;
      const momentIndex = replay.playbackSteps.findIndex(step => step.replayRelationIdentity?.stageIndex === stageIndex
        && step.replayRelationIdentity.relationIndex === relationIndex);
      assert(momentIndex >= 0);
      const target = nodes(stage.workspaceForest).find(node => node.id === targetNodeId);
      const targetIds = nodes([target]).map(node => node.id);
      assert(replay.playbackSteps.slice(0, momentIndex).every(step =>
        targetIds.every(id => !step.replayVisibleNodeIds.includes(id))), 'no part of the future copy is constructed before its movement');
      const moment = replay.playbackSteps[momentIndex];
      assert(targetIds.every(id => moment.replayVisibleNodeIds.includes(id)), 'the complete authored landing appears together');
      assert(moment.replayVisibleNodeIds.includes(sourceNodeId));
      const items = visiblePlanFrameItems(replay.relationRenderPlan, stageIndex,
        new Set(Array.from({ length: relationIndex + 1 }, (_, index) => index)), relationIndex)
        .filter(item => item.relationRef.stageIndex === stageIndex && item.relationRef.relationIndex === relationIndex);
      const qr = items.filter(item => item.kind === 'quantifier-raising');
      assert.equal(qr.length, 1);
      assert.equal(qr[0].pronouncedNodeId, sourceNodeId);
      assert.equal(qr[0].lfNodeId, targetNodeId);
      assert.equal(qr[0].scopeDomainNodeId, relation.anchors.adjunctionDomain);
      assert(!items.some(item => item.kind === 'trajectory'), 'QR cannot also acquire an ordinary movement arrow');
    }
    assert.deepEqual(analysis, original, 'recognition and Replay preserve the original authored analyses');
  });
}

const input = () => {
  const lower = { id: 'lower', label: 'DP', lineageId: 'quantifier', children: [
    { id: 'd', label: 'D', word: 'every' }, { id: 'n', label: 'N', word: 'book' }
  ] };
  const body = { id: 'body', label: 'VP', children: [{ id: 'v', label: 'V', word: 'read' }, lower] };
  const upper = { ...structuredClone(lower), id: 'upper', silent: true,
    children: lower.children.map(node => ({ ...node, id: `${node.id}Upper` })) };
  return { priorForest: [body], currentForest: [{ id: 'outer', label: 'VP', children: [upper, structuredClone(body)] }],
    relation: { relation: 'LF Quantifier Raising', anchors: { lower: 'lower', upper: 'upper' } } };
};
const dispatch = value => dispatchRelationClaims({ ...value, stageIndex: 1, relationIndex: 0 });
const items = value => compileRelationRenderPlan([
  { statement: '', stageRecord: '', workspaceForest: value.priorForest, relations: [] },
  { statement: '', stageRecord: '', workspaceForest: value.currentForest, relations: [value.relation] }
]).frames[1].items;

test('asserted covert operations recover structurally proved endpoints with open participant names', () => {
  for (const relation of ['LF Quantifier Raising', 'covert object Internal Merge', 'Quantifier Raising and variable binding']) {
    for (const anchors of [{ lower: 'lower', upper: 'upper' }, { argument: 'lower', raisedArgument: 'upper' }]) {
      const value = input();
      value.relation = { relation, anchors };
      const movement = recoverMovementEvidence(value.relation, value.currentForest, value.priorForest).movement;
      assert.deepEqual([movement?.priorSourceNodeId, movement?.sourceNodeId, movement?.targetNodeId], ['lower', 'lower', 'upper']);
      assert.equal(dispatch(value).facets.filter(facet => facet.recipe.id === 'scope.movement').length, 1);
      assert.equal(items(value).filter(item => item.kind === 'quantifier-raising').length, 1);
    }
  }
});

test('lower and upper plus shared identity do not invent movement for unrelated claims', () => {
  for (const relation of ['Interpretation', 'Quantifier scope', 'agreement', 'A claim about Quantifier Raising']) {
    const value = input(); value.relation.relation = relation;
    assert.equal(recoverMovementEvidence(value.relation, value.currentForest, value.priorForest).movement, undefined, relation);
    assert(!items(value).some(item => ['quantifier-raising', 'trajectory'].includes(item.kind)), relation);
  }
});

test('denied, provisional and contradictory QR cannot earn covert or ordinary movement', () => {
  for (const relation of ['No LF Quantifier Raising', 'Possible LF Quantifier Raising', 'pending Quantifier Raising and variable binding',
    'Quantifier Raising; no quantifier raising', 'Quantifier Raising; covert movement is pending',
    'required Quantifier Raising', 'Quantifier Raising; possible LF movement']) {
    const value = input(); value.relation.relation = relation;
    const result = recoverMovementEvidence(value.relation, value.currentForest, value.priorForest);
    assert.equal(result.movement, undefined, relation);
    assert.equal(result.failure, 'MOVEMENT_NOT_ESTABLISHED', relation);
    assert(!items(value).some(item => ['quantifier-raising', 'trajectory'].includes(item.kind)), relation);
  }
  for (const status of ['pending', 'failed', 'possible', 'not established', 'blocked', 'denied']) {
    const value = input(); value.relation.values = { status };
    assert.equal(recoverMovementEvidence(value.relation, value.currentForest, value.priorForest).failure, 'MOVEMENT_NOT_ESTABLISHED');
    assert(!items(value).some(item => ['quantifier-raising', 'trajectory'].includes(item.kind)), status);
  }
  const successful = input(); successful.relation.values = { status: 'successful' };
  assert.equal(items(successful).filter(item => item.kind === 'quantifier-raising').length, 1);
});

test('registered QR names preserve denied outcomes as neutral authored claims', () => {
  for (const relation of ['QuantifierRaising', 'Quantifier Raising', 'QR']) {
    for (const status of ['failed', 'denied', 'pending']) {
      const value = input();
      value.relation = { relation, anchors: { pronouncedQP: 'lower', lfQP: 'upper', scopeDomain: 'body' }, values: { status } };
      const original = structuredClone(value.relation);
      const result = dispatch(value);
      assert.equal(result.primaryClaim.tier, 3);
      assert.equal(result.tier1Dispatch.outcome, 'signature-incomplete');
      assert(result.tier1Dispatch.signatureIssues.some(issue => issue.kind === 'covert-movement-not-established'));
      const drawing = items(value);
      assert(!drawing.some(item => ['quantifier-raising', 'trajectory'].includes(item.kind)), `${relation}: ${status}`);
      assert(drawing.some(item => item.kind === 'fallback' && item.relationRef.values.status === status));
      assert.deepEqual(value.relation, original);
    }
    const successful = input();
    successful.relation = { relation, anchors: { pronouncedQP: 'lower', lfQP: 'upper', scopeDomain: 'body' }, values: { status: 'successful' } };
    assert.equal(items(successful).filter(item => item.kind === 'quantifier-raising').length, 1);
  }
});

test('the covert description cannot replace exact occurrence and prior-position evidence', () => {
  for (const alter of [
    value => { delete value.currentForest[0].children[0].lineageId; },
    value => { value.currentForest[0].children[0].lineageId = 'different'; },
    value => { value.priorForest = []; },
    value => { value.currentForest[0].children[1].children.reverse(); },
    value => { value.currentForest.push(structuredClone(value.currentForest[0].children[0])); },
    value => { value.relation.anchors.upper = ['upper', 'v']; },
    value => { value.relation.priorAnchors = { source: 'v' }; }
  ]) {
    const value = input(); alter(value);
    assert.equal(recoverMovementEvidence(value.relation, value.currentForest, value.priorForest).movement, undefined);
    assert(!items(value).some(item => ['quantifier-raising', 'trajectory'].includes(item.kind)));
  }
});
