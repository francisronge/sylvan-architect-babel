import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { planItemRelationRefs, isPlanItemRevealed } from '../replay/relations/renderPlanCompiler.ts';

const saved = JSON.parse(readFileSync(new URL('../fixtures/movement/restated-chains.json', import.meta.url)));
for (const record of saved) test(`${record.name}: movement and its later chain description share one curve`, () => {
  const before = structuredClone(record);
  const replay = prepareReplay({ ...record, includePlayback: true });
  const paths = replay.relationRenderPlan.frames.at(-1).items.filter(item => item.kind === 'trajectory'
    && item.sourceNodeId === record.source && item.targetNodeId === record.target);
  assert.equal(paths.length, 1);
  const owners = planItemRelationRefs(paths[0]);
  assert.equal(owners.length, 2);
  assert(owners.some(ref => ref.priorAnchors) && owners.some(ref => !ref.priorAnchors));
  owners.forEach(ref => {
    assert(replay.playbackSteps.some(step => step.replayRelationIdentity?.stageIndex === ref.stageIndex
      && step.replayRelationIdentity?.relationIndex === ref.relationIndex), 'both authored claims retain a Replay moment');
    const frame = replay.relationRenderPlan.frames[ref.stageIndex];
    const path = frame.items.find(item => item.kind === 'trajectory' && item.sourceNodeId === record.source && item.targetNodeId === record.target);
    assert(isPlanItemRevealed(path, ref.stageIndex, new Set([ref.relationIndex])));
  });
  replay.relationRenderPlan.frames.forEach((frame, i) => frame.items.forEach(item =>
    planItemRelationRefs(item).forEach(ref => assert(ref.stageIndex <= i, 'no later owner leaks into an earlier stage'))));
  assert.deepEqual(record, before);
});
