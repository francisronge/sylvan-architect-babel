import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { planItemRelationRefs, isPlanItemRevealed } from '../replay/relations/renderPlan.ts';

const saved = JSON.parse(readFileSync(new URL('../fixtures/movement/restated-chains.json', import.meta.url)));
// The authored claims naming each record's movement: [stageIndex, relationIndex], movement first.
const claims = {
  'raising-control-xbar-sol': [[3, 7], [3, 11]],
  'english-negation-minimalism-sol': [[4, 5], [5, 5]],
  'english-negation-minimalism-astra': [[3, 0], [4, 1]],
  'english-passive-minimalism-astra': [[4, 1], [4, 3]]
};
for (const record of saved) test(`${record.name}: a later stage's chain description shares the movement's one curve; one of the same stage draws none`, () => {
  const before = structuredClone(record);
  const replay = prepareReplay({ ...record, includePlayback: true });
  const paths = replay.relationRenderPlan.frames.at(-1).items.filter(item => item.kind === 'trajectory'
    && item.sourceNodeId === record.source && item.targetNodeId === record.target);
  assert.equal(paths.length, 1);
  const [[movementStage, movementRelation], [laterStage, laterRelation]] = claims[record.name];
  const owners = planItemRelationRefs(paths[0]).map(ref => [ref.stageIndex, ref.relationIndex]);
  assert.deepEqual(owners, laterStage === movementStage ? [[movementStage, movementRelation]] : claims[record.name]);
  claims[record.name].forEach(([stageIndex, relationIndex]) => {
    assert(replay.playbackSteps.some(step => step.replayRelationIdentity?.stageIndex === stageIndex
      && step.replayRelationIdentity?.relationIndex === relationIndex), 'both authored claims retain a Replay moment');
  });
  const movementFrame = replay.relationRenderPlan.frames[movementStage];
  const path = movementFrame.items.find(item => item.kind === 'trajectory' && item.sourceNodeId === record.source && item.targetNodeId === record.target);
  assert(isPlanItemRevealed(path, movementStage, new Set([movementRelation])));
  if (laterStage === movementStage)
    assert(!movementFrame.items.some(item => item.kind === 'trajectory' && planItemRelationRefs(item)
      .some(ref => ref.stageIndex === laterStage && ref.relationIndex === laterRelation)), 'the same stage\'s later claim draws no second arrow');
  replay.relationRenderPlan.frames.forEach((frame, i) => frame.items.forEach(item =>
    planItemRelationRefs(item).forEach(ref => assert(ref.stageIndex <= i, 'no later owner leaks into an earlier stage'))));
  assert.deepEqual(record, before);
});
