import type { PlaybackStep } from './types.ts';

/** A step's place within its stage, as every stage layout pass reads it: its
 * stage step index, with a stage record that has none after every other step. */
export const stageStepOrder = (step: PlaybackStep) => step.replayStageStepIndex ?? (step.replayKind === 'macro' ? Infinity : 0);
