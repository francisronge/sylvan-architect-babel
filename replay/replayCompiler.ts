/** Compile completed authored stages through stage preparation, construction, and relation scheduling. */
import { resolveSavedInputTokens } from '../server/babelParser/surfaceTokens.js';
import { createReplayCompilation, type ReplayCompilationInput } from './compilationContext.ts';
import { buildKernelStageSteps, carryRelationLinks, kernelContinuations } from './constructionKernel.ts';
import { displayContinuedOccurrences } from './continuedOccurrences.ts';
import { recountReplayProgress } from './playbackVisibility.ts';
import { attachReplayRealizations } from './realizationReplay.ts';
import { normalizeReplaySentenceInitialCasing } from './replayCasing.ts';
import { prepareReplayStage } from './stageContext.ts';
import { orderDetachedReplayWorkspaces } from './stageLayout.ts';
import type { PlaybackStep } from './types.ts';

/** Each stage's frames come only from it and its preceding stage; see constructionKernel.ts. */
export const buildPlaybackStepsFromDerivationFrames = (input: ReplayCompilationInput): PlaybackStep[] => {
  const compilation = createReplayCompilation(input);
  const { frames, sentence, replayPlan, inputTokens } = input;
  const steps = frames.flatMap((frame, index) => buildKernelStageSteps(compilation, prepareReplayStage(compilation, frame, index)));
  const positioned = orderDetachedReplayWorkspaces(recountReplayProgress(carryRelationLinks(steps), replayPlan), frames);
  const realized = attachReplayRealizations(normalizeReplaySentenceInitialCasing(positioned, compilation.sentenceInitialSurface), frames,
    resolveSavedInputTokens(sentence, inputTokens));
  return displayContinuedOccurrences(realized, frames, index => kernelContinuations(compilation, index), compilation.identity);
};
