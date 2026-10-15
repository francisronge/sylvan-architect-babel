import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';
import type { DerivationStage } from '../types.ts';
import { compileRelationRenderPlan } from './relations/renderPlanCompiler.ts';
import { adaptDerivationStagesForReplay } from './authoredFrames.ts';
import { applyPreFrontingSentenceInitialCasing } from './replayCasing.ts';
import { buildAuthoredRelationLinksForFrames, buildMovementChainIndexCatalogueForFrames, createFrameRelationResolver } from './frameRelations.ts';
import { buildPlaybackStepsFromDerivationFrames } from './replayCompiler.ts';
import { buildResolvedLinkTraceIndexMap } from './movementIndices.ts';
import { decoratePlaybackStepsWithTraceIndices } from './movementPresentation.ts';
import { type DerivationReplayPlan, type PlaybackStep } from './types.ts';

export interface ReplayPreparationInput {
  derivationStages?: DerivationStage[];
  sentence: string;
  inputTokens?: string[];
  includePlayback: boolean;
}

/** Shared by the app worker and standalone, synchronous review renderers. */
export const prepareReplay = ({ derivationStages, sentence, inputTokens, includePlayback }: ReplayPreparationInput) => {
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
  const frameRelations = createFrameRelationResolver(replayDerivationFrames, derivationReplayPlan);
  const committedDerivationVisualLinks = finalFrame
    ? buildAuthoredRelationLinksForFrames({
      frames: replayDerivationFrames,
      replayPlan: derivationReplayPlan,
      activeFrameIndex: finalIndex,
      forest: finalFrame.workspaceForest || [],
      currentFrameRelationLimit: Number.POSITIVE_INFINITY,
      frameRelations
    })
    : [];
  const movementChainIndexCatalogue = buildMovementChainIndexCatalogueForFrames(
    replayDerivationFrames, derivationReplayPlan, frameRelations);
  let playbackSteps: PlaybackStep[] = [];
  if (includePlayback && finalFrame) {
    const traceIndexByNodeId = buildResolvedLinkTraceIndexMap(
      finalFrame.workspaceForest || [], movementChainIndexCatalogue.links, Number.MAX_SAFE_INTEGER,
      movementChainIndexCatalogue
    );
    const steps = buildPlaybackStepsFromDerivationFrames({
      frames: replayDerivationFrames,
      sentence,
      replayPlan: derivationReplayPlan,
      inputTokens,
      frameRelations
    });
    playbackSteps = applyPreFrontingSentenceInitialCasing(
      decoratePlaybackStepsWithTraceIndices(steps, traceIndexByNodeId), sentence, inputTokens
    );
  }
  return { replayDerivationFrames, derivationReplayPlan, relationRenderPlan, committedDerivationVisualLinks,
    movementChainIndexCatalogue, playbackSteps };
};

export type PreparedReplay = ReturnType<typeof prepareReplay>;
