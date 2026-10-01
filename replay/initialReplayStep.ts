import type { PlaybackStep } from './replayCompiler.ts';

/** Select a requested authored moment without relying on generated frame counts. */
export const initialReplayStepIndex = (
  steps: readonly PlaybackStep[],
  relation?: { stageIndex: number; relationIndex: number }
): number => {
  if (!relation) return 0;
  const index = steps.findIndex(step => step.replayKind === 'relation'
    && step.replayRelationIdentity?.stageIndex === relation.stageIndex
    && step.replayRelationIdentity?.relationIndex === relation.relationIndex);
  return Math.max(0, index);
};
