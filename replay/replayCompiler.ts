/** Compile completed authored stages through stage preparation, construction, and relation scheduling. */
import { resolveSavedInputTokens } from '../server/babelParser/surfaceTokens.js';
import { createReplayCompilation, type ReplayCompilationInput } from './compilationContext.ts';
import { buildKernelStageSteps, carryRelationLinks, kernelContinuations, replayKernelEnabled } from './constructionKernel.ts';
import { displayContinuedOccurrences } from './continuedOccurrences.ts';
import { normalizePlaybackSequence, recountReplayProgress } from './playbackVisibility.ts';
import { attachReplayRealizations } from './realizationReplay.ts';
import { normalizeReplaySentenceInitialCasing, type ReplayCasingContext, stageCasingContext } from './replayCasing.ts';
import { retainRestatementsUntilOwningStep } from './restatementTiming.ts';
import { buildStageConstruction } from './stageConstruction.ts';
import { prepareReplayStage } from './stageContext.ts';
import { orderDetachedReplayWorkspaces } from './stageLayout.ts';
import { finalizeStageReplay } from './stageScheduling.ts';
import type { SyntaxNode } from '../types.ts';
import type { PlaybackStep } from './types.ts';

export const buildPlaybackStepsFromDerivationFrames = (input: ReplayCompilationInput): PlaybackStep[] => {
  if (replayKernelEnabled())
    return buildKernelPlaybackSteps(input);
  const compilation = createReplayCompilation(input);
  const { frames, sentence, replayPlan, inputTokens } = input;
  const frameBackedSteps = frames.flatMap((frame, index) => {
    const stage = prepareReplayStage(compilation, frame, index);
    const construction = buildStageConstruction(compilation, stage);
    const stageSteps = construction.finalize
      ? finalizeStageReplay(compilation, stage, construction.steps)
      : construction.steps;
    compilation.previousWorkspaceRootIds = stage.currentWorkspaceRootIds;
    compilation.previousVisibleNodeIds = stage.currentFrameVisibleNodeIds;
    return stageSteps;
  });
  const { pendingProjectionReveals, sentenceInitialSurface } = compilation;
  const countedSteps = normalizePlaybackSequence(frameBackedSteps, pendingProjectionReveals, replayPlan);
  const positionedSteps = orderDetachedReplayWorkspaces(countedSteps, frames);
  const retainedSteps = retainRestatementsUntilOwningStep(positionedSteps, frames, compilation.resolveFrameRelations);
  const timedSteps = retainedSteps.length === positionedSteps.length ? retainedSteps : recountReplayProgress(retainedSteps, replayPlan);
  const realizedSteps = attachReplayRealizations(normalizeReplaySentenceInitialCasing(timedSteps, sentenceInitialSurface), frames, resolveSavedInputTokens(sentence, inputTokens));
  return displayContinuedOccurrences(realizedSteps, frames, compilation.continuedOccurrenceIds, compilation.identity);
};

/** The casing context of each kernel Replay, for prepareReplay's second casing pass. */
export const kernelCasingContexts = new WeakMap<PlaybackStep[], ReplayCasingContext>();

/** The construction kernel's path: frame content comes only from adjacent stages; see constructionKernel.ts. */
const buildKernelPlaybackSteps = (input: ReplayCompilationInput): PlaybackStep[] => {
  const compilation = createReplayCompilation(input);
  const { frames, sentence, replayPlan, inputTokens } = input;
  const topologies: Array<{ before: SyntaxNode[]; after: SyntaxNode[] }> = [];
  const steps = frames.flatMap((frame, index) => {
    const stage = prepareReplayStage(compilation, frame, index);
    topologies[index] = { before: stage.structuralLayoutScaffold || stage.structuralWorkspaceRoots, after: stage.futureLayoutScaffold || stage.workspaceRoots };
    const stageSteps = buildKernelStageSteps(compilation, stage) ?? (() => {
      const construction = buildStageConstruction(compilation, stage);
      return construction.finalize ? finalizeStageReplay(compilation, stage, construction.steps) : construction.steps;
    })();
    compilation.previousWorkspaceRootIds = stage.currentWorkspaceRootIds;
    compilation.previousVisibleNodeIds = stage.currentFrameVisibleNodeIds;
    return stageSteps;
  });
  const positioned = orderDetachedReplayWorkspaces(recountReplayProgress(carryRelationLinks(steps), replayPlan), frames);
  // A kernel frame shows a word not yet merged as its own root; casing still follows the
  // stage's layout topology, as on main: the pre-movement one until a moment changes syntax.
  const moved = new Set<string>(), stepKey = (step: PlaybackStep) => `${step.replayFrameIndex}:${step.replayStageStepIndex}`;
  positioned.forEach((step, position) => {
    const before = positioned[position - 1];
    if (before && (before.replayFrameIndex === step.replayFrameIndex && moved.has(stepKey(before))
      || step.replayKind === 'relation' && JSON.stringify(before.replayVisibleNodeIds) !== JSON.stringify(step.replayVisibleNodeIds))) moved.add(stepKey(step));
  });
  const casing = stageCasingContext(step => {
    const topology = topologies[step.replayFrameIndex ?? -1];
    return !topology ? [] : moved.has(stepKey(step)) || step.replayKind === 'macro' ? topology.after : topology.before;
  });
  const realized = attachReplayRealizations(normalizeReplaySentenceInitialCasing(positioned, compilation.sentenceInitialSurface, casing), frames,
    resolveSavedInputTokens(sentence, inputTokens));
  const displayed = displayContinuedOccurrences(realized, frames, index => kernelContinuations(compilation, index), compilation.identity);
  kernelCasingContexts.set(displayed, casing);
  return displayed;
};
