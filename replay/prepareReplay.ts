import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';
import { canonicalizeMovementIdentity, stageIdRenames } from '../server/babelParser/movementIdentity.js';
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

/**
 * Shared by the app worker and standalone, synchronous review renderers.
 * Replay reads the stages with canonical movement identity (see
 * server/babelParser/movementIdentity.js), so it never depends on which
 * occurrence of a moved constituent the model let keep its id. The result
 * returns those stages: whatever pairs stage ids with Replay's steps (the
 * panel, checks) reads them, never the stages as passed in, and
 * `idRenamesByStage`, whose last entry (`finalStageIdRenames`) renames a final
 * tree built from the authored stages.
 */
export const prepareReplay = ({ derivationStages: inputStages, sentence, inputTokens, includePlayback }: ReplayPreparationInput) => {
  const canonical = canonicalizeMovementIdentity(inputStages);
  const derivationStages = canonical.stages as DerivationStage[] | undefined;
  // Each stage's renamed ids ({ authoredId: canonicalId }); the final tree a
  // caller holds keeps the authored ids, and the last entry renames it.
  const idRenamesByStage = (inputStages ?? []).map((_stage, index) => stageIdRenames(canonical.renames, index));
  const finalStageIdRenames = idRenamesByStage.at(-1) ?? {};
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
  // Replay's steps carry the order in which each stage plays its relation
  // moments, which the plan's rail bands follow (anchorRailBands.ts). They are
  // scheduled whether or not playback is requested, so the plan never depends
  // on that flag.
  const scheduledSteps = finalFrame ? buildPlaybackStepsFromDerivationFrames({
    frames: replayDerivationFrames,
    sentence,
    replayPlan: derivationReplayPlan,
    inputTokens,
    frameRelations
  }) : [];
  let playbackSteps: PlaybackStep[] = [];
  if (includePlayback && finalFrame) {
    const traceIndexByNodeId = buildResolvedLinkTraceIndexMap(
      finalFrame.workspaceForest || [], movementChainIndexCatalogue.links, Number.MAX_SAFE_INTEGER,
      movementChainIndexCatalogue
    );
    playbackSteps = applyPreFrontingSentenceInitialCasing(
      decoratePlaybackStepsWithTraceIndices(scheduledSteps, traceIndexByNodeId), sentence, inputTokens
    );
  }
  const relationPlan = hasStages ? compileDispatchedRelationRenderPlan(relationClaims,
    { relationMomentOrders: relationMomentOrders(scheduledSteps, replayDerivationFrames.length) }) : null;
  // Realized forms join the plan once Replay has decided when each association is active.
  const relationRenderPlan = relationPlan && withRealizationDisplays(relationPlan, replayDerivationFrames,
    { sentence, inputTokens, ...(includePlayback ? { steps: playbackSteps } : {}) });
  return { derivationStages: derivationStages ?? [], idRenamesByStage, finalStageIdRenames, replayDerivationFrames, derivationReplayPlan, relationRenderPlan,
    committedDerivationVisualLinks, movementChainIndexCatalogue, playbackSteps };
};

export type PreparedReplay = ReturnType<typeof prepareReplay>;
