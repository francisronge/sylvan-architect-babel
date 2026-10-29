import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';
import type { DerivationStage } from '../types.ts';
import { compileDispatchedRelationRenderPlan, dispatchRelationStagesForPlan } from './relations/renderPlanCompiler.ts';
import { relationMomentOrders } from './relations/anchorRailBands.ts';
import { adaptDerivationStagesForReplay } from './authoredFrames.ts';
import { applyPreFrontingSentenceInitialCasing } from './replayCasing.ts';
import { buildAuthoredRelationLinksForFrames, buildMovementChainIndexCatalogueForFrames, createFrameRelationResolver } from './frameRelations.ts';
import { relationStagesFromFrames } from './relationStages.ts';
import { withRealizationDisplays } from './realizationDisplay.ts';
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
  // The plan's drawings and Replay's relation moments share one dispatch of every claim.
  const relationClaims = dispatchRelationStagesForPlan(relationStagesFromFrames(replayDerivationFrames, derivationReplayPlan));
  const finalIndex = replayDerivationFrames.length - 1;
  const finalFrame = replayDerivationFrames[finalIndex];
  const frameRelations = createFrameRelationResolver(replayDerivationFrames, derivationReplayPlan, relationClaims);
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
  // The plan follows the order in which Replay plays each stage's moments.
  const relationPlan = hasStages ? compileDispatchedRelationRenderPlan(relationClaims,
    includePlayback ? { relationMomentOrders: relationMomentOrders(playbackSteps, replayDerivationFrames.length) } : {}) : null;
  // Realized forms join the plan once Replay has decided when each association is active.
  const relationRenderPlan = relationPlan && withRealizationDisplays(relationPlan, replayDerivationFrames,
    { sentence, inputTokens, ...(includePlayback ? { steps: playbackSteps } : {}) });
  return { replayDerivationFrames, derivationReplayPlan, relationRenderPlan, committedDerivationVisualLinks,
    movementChainIndexCatalogue, playbackSteps };
};

export type PreparedReplay = ReturnType<typeof prepareReplay>;
