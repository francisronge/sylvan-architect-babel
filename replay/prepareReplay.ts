import type { DerivationStage } from '../types.ts';
import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';
import {
  adaptDerivationStagesForReplay,
  applyPreFrontingSentenceInitialCasing,
  buildAuthoredRelationLinksForFrames,
  buildPlaybackStepsFromDerivationFrames,
  buildResolvedLinkTraceIndexMap,
  decoratePlaybackStepsWithTraceIndices,
  hidePendingInflSpecifierWrappersInStep,
  type DerivationReplayPlan,
  type PlaybackStep
} from './replayCompiler.ts';
import { compileRelationRenderPlan } from './relations/renderPlanCompiler.ts';

export interface ReplayPreparationInput {
  derivationStages?: DerivationStage[];
  sentence: string;
  includePlayback: boolean;
}

/** Shared by the app worker and standalone, synchronous review renderers. */
export const prepareReplay = ({ derivationStages, sentence, includePlayback }: ReplayPreparationInput) => {
  const replayDerivationFrames = adaptDerivationStagesForReplay(derivationStages);
  const hasStages = Array.isArray(derivationStages) && derivationStages.length > 0;
  const derivationReplayPlan = hasStages
    ? buildDerivationReplayPlan({ derivationStages }) as DerivationReplayPlan : null;
  const relationRenderPlan = hasStages ? compileRelationRenderPlan(derivationStages) : null;
  const finalIndex = replayDerivationFrames.length - 1;
  const finalFrame = replayDerivationFrames[finalIndex];
  const committedDerivationVisualLinks = finalFrame
    ? buildAuthoredRelationLinksForFrames(replayDerivationFrames, derivationReplayPlan, finalIndex, finalFrame.workspaceForest || [])
    : [];
  let playbackSteps: PlaybackStep[] = [];
  if (includePlayback && finalFrame) {
    const traceIndexByNodeId = buildResolvedLinkTraceIndexMap(
      finalFrame.workspaceForest || [], committedDerivationVisualLinks, Number.MAX_SAFE_INTEGER
    );
    const steps = buildPlaybackStepsFromDerivationFrames(replayDerivationFrames, sentence, derivationReplayPlan)
      .map(hidePendingInflSpecifierWrappersInStep);
    playbackSteps = applyPreFrontingSentenceInitialCasing(
      decoratePlaybackStepsWithTraceIndices(steps, traceIndexByNodeId), sentence
    );
  }
  return { replayDerivationFrames, derivationReplayPlan, relationRenderPlan, committedDerivationVisualLinks, playbackSteps };
};

export type PreparedReplay = ReturnType<typeof prepareReplay>;
