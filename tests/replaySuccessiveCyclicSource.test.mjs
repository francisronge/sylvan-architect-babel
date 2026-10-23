import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { resolveDisplayedTrajectoryAttachments } from '../replay/relations/renderPlan.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/successive-cyclic-source.json', import.meta.url), 'utf8'));
const prepared = new Map();
const replay = key => {
  if (!prepared.has(key)) prepared.set(key, prepareReplay({ ...structuredClone(fixture.cases.find(c => c.key === key)), includePlayback: true }));
  return prepared.get(key);
};
const moment = (steps, stageIndex, relationIndex) => {
  const index = steps.findIndex(step => step.replayKind === 'relation' && step.replayRelationIdentity?.stageIndex === stageIndex
    && step.replayRelationIdentity.relationIndex === relationIndex);
  assert.ok(index >= 0, `relation ${stageIndex}:${relationIndex} has a moment`);
  return index;
};
const arrows = (steps, stageIndex, relationIndex) => {
  const step = steps[moment(steps, stageIndex, relationIndex)];
  return step.replayRelationLinks.filter(link => link.renderFamily === 'trajectory'
    && link.authoredRelationKey === `${stageIndex}:${relationIndex}`)
    .map(link => `${link.sourceNodeId}->${link.targetNodeId}${link.movementTransition ? '' : ' without transition'}`);
};

test('each hop starts at the new trace in the moved operator\'s preceding slot, not an older trace', () => {
  const tough = replay('tough-relative').playbackSteps;
  assert.deepEqual(arrows(tough, 2, 0), ['toughEdgeTrace->toughOp']);
  assert.deepEqual(arrows(tough, 4, 0), ['firstEdgeTrace->firstRelOp']);
  assert.deepEqual(arrows(tough, 9, 0), ['secondUpperEdgeTrace->secondRelOp']);
  for (const [stageIndex, relationIndex] of [[2, 0], [4, 0], [9, 0]])
    assert.deepEqual(tough[moment(tough, stageIndex, relationIndex)].movementDiagnostics ?? [], []);
});

test('a second claim of the same hop draws no second arrow and keeps the earlier landing transfer at the hop', () => {
  const record = fixture.cases.find(c => c.key === 'object-wh-shared-hop');
  const original = structuredClone(record.derivationStages), plan = compileRelationRenderPlan(structuredClone(record.derivationStages));
  const nodes = stage => {
    const map = new Map(), visit = node => { map.set(node.id, node); node.children?.forEach(visit); };
    record.derivationStages[stage].workspaceForest.forEach(visit);
    return map;
  };
  const arrowsAt = stage => plan.frames[stage].items.filter(item => item.kind === 'trajectory');
  assert.deepEqual(arrowsAt(3).map(item => `${item.relationRef.stageIndex}:${item.relationRef.relationIndex}`), ['1:1', '3:0']);
  const shared = arrowsAt(3).find(item => item.relationRef.stageIndex === 3);
  assert.deepEqual([shared.sourceNodeId, shared.targetNodeId], ['npEdgeTrace', 'npWhat']);
  // Within its stage the hop's arrow is the earlier claim's alone (Francis, 23 Oct).
  assert.ok(!shared.coalescedRefs?.some(ref => ref.stageIndex === 3 && ref.relationIndex === 1), 'the restating claim draws no arrow of its own');
  assert.ok(plan.frames[3].items.some(item => item.relationRef.stageIndex === 3 && item.relationRef.relationIndex === 1),
    'the restating claim keeps its own marks');
  for (const stage of [3, 4, 5]) {
    const earlier = arrowsAt(stage).find(item => item.relationRef.stageIndex === 1);
    const at = played => resolveDisplayedTrajectoryAttachments(earlier, id => nodes(stage).get(id), { stageIndex: 3, playedRelationIndices: played });
    const endpoints = item => [item.sourceNodeId, item.targetNodeId];
    assert.deepEqual(earlier.occurrenceTransfers, [{ fromNodeId: 'npWhat', toNodeId: 'npEdgeTrace', stageIndex: 3, relationIndex: 0 }]);
    if (stage === 3) {
      assert.deepEqual(endpoints(at(new Set())), ['npObjectTrace', 'npWhat'], 'before the hop the earlier arrow still reaches the operator');
      assert.deepEqual(endpoints(at(new Set([0]))), ['npObjectTrace', 'npEdgeTrace'], 'its landing moves to the new trace at the hop');
      assert.deepEqual(endpoints(at(new Set([0, 1]))), ['npObjectTrace', 'npEdgeTrace'], 'the restating claim does not move it again');
      assert.deepEqual(endpoints(at(new Set())), ['npObjectTrace', 'npWhat'], 'rewinding restores the earlier landing');
    }
    assert.deepEqual(endpoints(resolveDisplayedTrajectoryAttachments(earlier, id => nodes(stage).get(id),
      { stageIndex: stage, playedRelationIndices: null })), ['npObjectTrace', 'npEdgeTrace'], `completed stage ${stage + 1}`);
  }
  assert.deepEqual(record.derivationStages, original);
});

// Prior stage: the operator sits at the lower edge above an older trace.
const hop = () => {
  const older = { id: 'older', label: 'DP trace', lineageId: 'op' };
  const prior = [{ id: 'cp', label: 'CP', children: [{ id: 'c', label: 'C' }, { id: 'edge', label: 'vP', children: [
    { id: 'op', label: 'DP', lineageId: 'op', word: 'who' }, { id: 'vp', label: 'VP', children: [{ id: 'v', label: 'V', word: 'saw' }, older] }] }] }];
  const current = [{ id: 'cp', label: 'CP', children: [{ id: 'op', label: 'DP', lineageId: 'op', word: 'who' }, { id: 'cbar', label: 'C′', children: [
    { id: 'c', label: 'C' }, { id: 'edge', label: 'vP', children: [
      { id: 'newer', label: 'DP trace', lineageId: 'op' }, { id: 'vp', label: 'VP', children: [{ id: 'v', label: 'V', word: 'saw' }, structuredClone(older)] }] }] }] }];
  return { prior, current };
};

test('an older foot cited in a source or witness field is context for the new hop', () => {
  const { prior, current } = hop();
  for (const anchors of [
    { operator: 'op', objectTrace: 'older', previousEdgeTrace: 'newer' },
    { operator: 'op', variable: 'older', edgeTrace: 'newer' },
    { landing: 'op', lowerTrace: 'older', sourceTrace: 'newer' }
  ]) {
    const movement = recoverMovementEvidence({ relation: 'operator chain', anchors }, current, prior).movement;
    assert.equal(movement?.sourceNodeId, 'newer', JSON.stringify(anchors));
    assert.equal(movement.priorSourceNodeId, 'op');
    assert.equal(movement.targetNodeId, 'op');
    assert.equal(movement.witnessNodeId, 'newer');
    assert.equal(movement.transition, true);
  }
});

test('the new-occurrence rule needs the exact preceding slot, an unchanged older foot and a cited source', () => {
  const claim = { relation: 'operator chain', anchors: { operator: 'op', objectTrace: 'older', previousEdgeTrace: 'newer' } };
  const recover = (relation, damage = () => {}) => {
    const { prior, current } = hop();
    damage({ prior, current });
    return recoverMovementEvidence(relation, current, prior).movement;
  };
  const find = (forest, id) => forest.map(node => node.id === id ? node : find(node.children ?? [], id)).find(Boolean);
  // The new trace elsewhere does not occupy the operator's preceding slot.
  assert.notEqual(recover(claim, ({ current }) => find(current, 'edge').children.reverse())?.sourceNodeId, 'newer');
  // A rewritten older trace is not an unchanged earlier copy, so it still competes.
  assert.notEqual(recover({ relation: 'operator chain', anchors: { landing: 'op', lowerTrace: 'older', sourceTrace: 'newer' } },
    ({ current }) => { find(current, 'older').label = 'DP copy'; })?.sourceNodeId, 'newer');
  // Without any source or witness field the claim does not become a movement.
  assert.equal(recover({ relation: 'operator chain', anchors: { operator: 'op', previousEdgeTrace: 'newer' } }), undefined);
});
