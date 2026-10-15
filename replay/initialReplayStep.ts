import type { PlaybackStep } from './types.ts';

/** Restore a bounded saved frame, or locate an explicitly requested authored moment. */
export const initialReplayStepIndex = (
  steps: readonly PlaybackStep[],
  relation?: { stageIndex: number; relationIndex: number },
  savedStep?: number
): number => {
  if (Number.isSafeInteger(savedStep) && savedStep >= 0) {
    return Math.min(savedStep, Math.max(0, steps.length - 1));
  }
  if (!relation) return 0;
  const index = steps.findIndex(step => step.replayKind === 'relation'
    && step.replayRelationIdentity?.stageIndex === relation.stageIndex
    && step.replayRelationIdentity?.relationIndex === relation.relationIndex);
  return Math.max(0, index);
};

/** Reset playback when its source or start request changes. Static and empty
 * views stay at frame zero and cannot autoplay. */
export const replayStartState = ({ animated, autoPlay, stepCount, initialStepIndex }: {
  animated: boolean;
  autoPlay: boolean;
  stepCount: number;
  initialStepIndex: number;
}): { stepIndex: number; isPlaying: boolean } => !animated || stepCount === 0
  ? { stepIndex: 0, isPlaying: false }
  : { stepIndex: initialStepIndex, isPlaying: autoPlay };
