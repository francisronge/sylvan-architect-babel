import assert from 'node:assert/strict';
import test from 'node:test';
import { replayStartState } from '../replay/initialReplayStep.ts';

test('playable review resets preserve the requested frame and explicit autoplay preference', () => {
  for (const initialStepIndex of [0, 2]) for (const autoPlay of [false, true]) {
    assert.deepEqual(replayStartState({ animated: true, autoPlay, stepCount: 4, initialStepIndex }),
      { stepIndex: initialStepIndex, isPlaying: autoPlay });
  }
});

test('static or empty review resets stay at frame zero and cannot start playback', () => {
  for (const [animated, stepCount] of [[false, 4], [true, 0], [false, 0]]) {
    for (const autoPlay of [false, true]) {
      assert.deepEqual(replayStartState({ animated, autoPlay, stepCount, initialStepIndex: 2 }),
        { stepIndex: 0, isPlaying: false });
    }
  }
});
