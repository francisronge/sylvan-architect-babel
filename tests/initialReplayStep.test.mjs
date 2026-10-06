import assert from 'node:assert/strict';
import test from 'node:test';
import { initialReplayStepIndex } from '../replay/initialReplayStep.ts';

const steps = [
  { replayKind: 'micro' },
  { replayKind: 'relation', replayRelationIdentity: { stageIndex: 0, relationIndex: 0 } },
  { replayKind: 'relation', replayRelationIdentity: { stageIndex: 1, relationIndex: 0 } },
  { replayKind: 'relation', replayRelationIdentity: { stageIndex: 1, relationIndex: 1 } },
  { replayKind: 'macro', replayRelationIdentity: { stageIndex: 1, relationIndex: 1 } }
];

test('ordinary Replay keeps its first frame when no initial relation is requested', () => {
  assert.equal(initialReplayStepIndex(steps), 0);
  assert.equal(initialReplayStepIndex([]), 0);
});

test('saved Replay position restores structural steps and clamps to the current schedule', () => {
  assert.equal(initialReplayStepIndex(steps, undefined, 3), 3);
  assert.equal(initialReplayStepIndex(steps, undefined, 999), 4);
  assert.equal(initialReplayStepIndex([], undefined, 3), 0);
  assert.equal(initialReplayStepIndex(steps, undefined, -1), 0);
  assert.equal(initialReplayStepIndex(steps, undefined, NaN), 0);
  assert.equal(initialReplayStepIndex(steps, undefined, 1.5), 0);
});

test('initial relation selection distinguishes authored stages and relation order', () => {
  assert.equal(initialReplayStepIndex(steps, { stageIndex: 0, relationIndex: 0 }), 1);
  assert.equal(initialReplayStepIndex(steps, { stageIndex: 1, relationIndex: 0 }), 2);
  assert.equal(initialReplayStepIndex(steps, { stageIndex: 1, relationIndex: 1 }), 3);
});

test('absent or invalid initial moments return to the first frame, never Stage Record', () => {
  assert.equal(initialReplayStepIndex(steps, { stageIndex: 2, relationIndex: 0 }), 0);
  assert.equal(initialReplayStepIndex(steps, { stageIndex: -1, relationIndex: 0 }), 0);
  assert.equal(initialReplayStepIndex(steps, { stageIndex: 1, relationIndex: NaN }), 0);
  assert.equal(initialReplayStepIndex([steps[4]], { stageIndex: 1, relationIndex: 1 }), 0);
  assert.equal(initialReplayStepIndex([], { stageIndex: 1, relationIndex: 0 }), 0);
});
