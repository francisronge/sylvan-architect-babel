import type { DerivationStage } from '../types.ts';
import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';
import {
  adaptDerivationStagesForReplay,
  applyPreFrontingSentenceInitialCasing,
  buildAuthoredRelationLinksForFrames,
  buildMovementChainIndexCatalogueForFrames,
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
  if (!String(sentence || '').trim() && derivationStages?.some(stage => stage.realizations?.length)) {
    throw new Error('Replay with realization groups requires the original input sentence.');
  }
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
  const movementChainIndexCatalogue = buildMovementChainIndexCatalogueForFrames(
    replayDerivationFrames, derivationReplayPlan);
  let playbackSteps: PlaybackStep[] = [];
  if (includePlayback && finalFrame) {
    const traceIndexByNodeId = buildResolvedLinkTraceIndexMap(
      finalFrame.workspaceForest || [], movementChainIndexCatalogue.links, Number.MAX_SAFE_INTEGER,
      movementChainIndexCatalogue
    );
    const steps = buildPlaybackStepsFromDerivationFrames(replayDerivationFrames, sentence, derivationReplayPlan)
      .map(hidePendingInflSpecifierWrappersInStep);
    playbackSteps = applyPreFrontingSentenceInitialCasing(
      decoratePlaybackStepsWithTraceIndices(steps, traceIndexByNodeId), sentence
    );
  }
  return { replayDerivationFrames, derivationReplayPlan, relationRenderPlan, committedDerivationVisualLinks,
    movementChainIndexCatalogue, playbackSteps };
};

export type PreparedReplay = ReturnType<typeof prepareReplay>;
