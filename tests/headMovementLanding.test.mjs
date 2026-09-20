import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileRelationRenderPlan, resolveDisplayedTrajectoryAttachments } from '../replay/relations/renderPlanCompiler.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';

const record = JSON.parse(fs.readFileSync(new URL('../fixtures/visual-relations/successive-head-movement.json', import.meta.url)));
const index = forest => {
  const nodes = new Map();
  const visit = n => { nodes.set(n.id, n); (n.children || []).forEach(visit); };
  forest.forEach(visit); return nodes;
};
const trajectory = (plan, frame, stage, relation) => plan.frames[frame].items.find(item =>
  item.kind === 'trajectory' && item.relationRef.stageIndex === stage && item.relationRef.relationIndex === relation);

for (const renamed of [false, true]) {
  test(`successive head movement preserves each landing position${renamed ? ' with renamed IDs and open relation names' : ''}`, () => {
    const input = structuredClone(record);
    const id = x => renamed ? `different-${x}` : x;
    if (renamed) for (const s of input.derivationStages) {
      for (const n of index(s.workspaceForest).values()) {
        n.id = id(n.id);
        if (n.lineageId) n.lineageId = id(n.lineageId);
      }
      for (const r of s.relations) {
        r.relation = 'Authored dependency';
        for (const field of ['anchors', 'priorAnchors']) for (const [key, value] of Object.entries(r[field] || {}))
          r[field][key] = Array.isArray(value) ? value.map(id) : id(value);
      }
    }
    const original = JSON.stringify(input);
    const plan = compileRelationRenderPlan(input.derivationStages);
    const at = (item, frame, played) => resolveDisplayedTrajectoryAttachments(item,
      nodeId => index(input.derivationStages[frame].workspaceForest).get(nodeId),
      { stageIndex: frame, playedRelationIndices: played });
    for (const [firstRelation, nextRelation, firstTarget, witness, finalTarget] of [
      [0, 0, 'vm', 'tim', 'ihm'], [1, 2, 'vl', 'til', 'ihl']
    ]) {
      const first = trajectory(plan, 1, 1, firstRelation);
      assert.equal(at(first, 1, null).targetNodeId, id(firstTarget));
      assert.equal(at(first, 1, null).targetAttachment, 'terminal');
      assert.equal(at(first, 1, null), first, 'the first movement instance keeps its original attachment unchanged');
      assert.deepEqual(first.headLandingSite.transfers, [], 'future witnesses cannot leak into an earlier stage');
      const carried = trajectory(plan, 2, 1, firstRelation);
      assert.equal(at(carried, 2, new Set()).targetNodeId, id(firstTarget), 'do not retarget before the movement moment, even if future nodes are measured');
      assert.equal(at(carried, 2, new Set([nextRelation])).targetNodeId, id(witness));
      const next = trajectory(plan, 2, 2, nextRelation);
      assert.equal(at(next, 2, null).targetNodeId, id(finalTarget));
      assert.equal(at(next, 2, null).targetAttachment, 'terminal');
      assert.equal(at(next, 2, null), next, 'the later movement keeps its original terminal attachment too');
      assert.equal(at(carried, 2, null).targetNodeId, id(witness), 'the completed stage retains the intermediate stop');
    }
    assert.equal(JSON.stringify(input), original);
  });
}

test('a head without a structurally established adjunction site keeps its exact authored endpoint', () => {
  const node = { id: 'word', label: 'V', word: 'word' };
  const item = { kind: 'trajectory', trajectoryKind: 'head', sourceNodeId: 'trace', targetNodeId: 'word', sourceAttachment: 'shell-bottom', targetAttachment: 'terminal' };
  assert.equal(resolveDisplayedTrajectoryAttachments(item, id => id === 'word' ? node : undefined), item);
});

test('the saved sequence introduces each lower witness at its own movement frame', () => {
  const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
  for (const [relation, witness] of [[0, 'tim'], [2, 'til']]) {
    const moment = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 2 && s.replayRelationIdentity.relationIndex === relation);
    assert(moment > 0);
    assert(!steps[moment - 1].replayVisibleNodeIds.includes(witness));
    assert(steps[moment].replayVisibleNodeIds.includes(witness));
  }
});
