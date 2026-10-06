import type { PlaybackStep } from './replayCompiler.ts';

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
