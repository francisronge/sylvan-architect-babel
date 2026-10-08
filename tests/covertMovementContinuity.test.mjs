import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { adaptDerivationStagesForReplay, getFrameRelations } from '../replay/replayCompiler.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';

const load = name => JSON.parse(readFileSync(new URL(`../fixtures/replay-regressions/${name}.json`, import.meta.url)));
const prior = load('pf-correspondence-evidence').examples.filter(example => example.id.startsWith('old/sol-spanish-scope/'));
const current = load('qualified-quantifier-binding').stages;
const nodes = forest => forest.flatMap(node => [node, ...nodes(node.children ?? [])]);
const recover = (before, after) => {
  const frames = adaptDerivationStagesForReplay([before, after]);
  return getFrameRelations(frames[1], null, frames[0].workspaceForest)[0].recoveredMovement;
};
const dispatch = (before, after) => dispatchRelationClaims({ relation: after.relations[0],
  currentForest: after.workspaceForest, priorForest: before.workspaceForest, stageIndex: 1, relationIndex: 0 });

for (const [index, after] of current.entries()) {
  test(`saved Sol Spanish reading ${index + 1}: QR preserves its exact LF source alongside the unchanged PF copy`, () => {
    const before = prior.find(example => example.analysisIndex === index).stage;
    const stages = [before, after], original = structuredClone(stages);
    const movement = recover(before, after);
    assert.equal(movement?.transition, true);
    assert.deepEqual([movement.priorSourceNodeId, movement.sourceNodeId, movement.targetNodeId], ['lobj', 'lto', 'lobj']);
    assert.equal(movement.drawTrajectory, false, 'QR owns its covert drawing');
    const scope = dispatch(before, after).facets.find(facet => facet.recipe.id === 'scope.movement');
    assert.deepEqual(scope.evaluation.earnedTransitions, ['movement']);
    const replay = prepareReplay({ sentence: prior[index].sentence, derivationStages: stages, includePlayback: true });
    const stageSteps = replay.playbackSteps.filter(step => step.replayFrameIndex === 1);
    assert.deepEqual(stageSteps.map(step => step.replayKind), ['relation', 'relation', 'macro'],
      'the trace and landing attachment belong to QR, not ordinary selection or merge');
    const moment = stageSteps[0], preceding = replay.playbackSteps[replay.playbackSteps.indexOf(moment) - 1];
    assert(!preceding.replayVisibleNodeIds.includes('lto'));
    assert(moment.replayVisibleNodeIds.includes('lto'));
    const beforeNodes = nodes([preceding.replayCanvasData]), afterNodes = nodes([moment.replayCanvasData]);
    assert.deepEqual(beforeNodes.find(node => node.id === 'lvbar').children.map(node => node.id), ['ltv', 'lobj']);
    assert.deepEqual(afterNodes.find(node => node.id === 'lvbar').children.map(node => node.id), ['ltv', 'lto']);
    const landing = afterNodes.find(node => node.id === after.relations[0].anchors.adjunction_site);
    assert(landing.children.some(node => node.id === 'lobj'));
    const pfIds = nodes([before.workspaceForest[0]]).map(node => node.id);
    assert(pfIds.every(id => moment.replayVisibleNodeIds.includes(id)), 'the independently pronounced PF forest remains visible');
    const qr = replay.relationRenderPlan.frames[1].items.filter(item => item.kind === 'quantifier-raising');
    assert.equal(qr.length, 1);
    assert.deepEqual([qr[0].pronouncedNodeId, qr[0].lfNodeId], ['lto', 'lobj']);
    assert.deepEqual(stages, original, 'authored PF and LF stages are unchanged');
  });
}

test('covert continuity is exact and independent of forest order', () => {
  const before = structuredClone(prior[0].stage), after = structuredClone(current[0]);
  before.workspaceForest.reverse();
  after.workspaceForest.reverse();
  assert.equal(recover(before, after).transition, true);
  after.relations[0].relation = 'covert object Internal Merge';
  assert.equal(recover(before, after).transition, true, 'the proof does not depend on the saved QR label');
});

test('a repeated QR claim does not perform the same movement again', () => {
  const after = structuredClone(current[0]);
  delete after.relations[0].priorAnchors;
  assert.notEqual(recover(after, after)?.transition, true);
});

test('a denied or unproved source cannot earn QR movement from other same-lineage copies', () => {
  for (const change of [
    (before, after) => { after.relations[0].values.status = 'denied'; },
    (before, after) => { after.relations[0].values.status = 'pending'; },
    (before, after) => { after.relations[0].priorAnchors.source_DP = 'obj'; },
    (before, after) => { nodes(after.workspaceForest).find(node => node.id === 'lto').lineageId = 'other'; },
    (before, after) => { nodes(after.workspaceForest).find(node => node.id === 'lvbar').children.reverse(); },
    (before, after) => { before.workspaceForest.push(structuredClone(nodes(before.workspaceForest).find(node => node.id === 'lobj'))); }
  ]) {
    const before = structuredClone(prior[0].stage), after = structuredClone(current[0]);
    change(before, after);
    const scopes = dispatch(before, after).facets.filter(facet => facet.recipe.id === 'scope.movement');
    assert(scopes.every(facet => !facet.evaluation.earnedTransitions.includes('movement')));
    assert.notEqual(recover(before, after)?.transition, true);
  }
});
