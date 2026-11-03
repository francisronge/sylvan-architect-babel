/** Build the ordinary candidate micro-steps before relation ownership schedules them. */
import type { ReplayCompilation } from './compilationContext.ts';
import type { ReplayStageContext } from './stageContext.ts';
import { buildStructuralDerivationPlaybackSteps } from './structuralPlayback.ts';
import { type PlaybackStep } from './types.ts';

export const buildStageConstruction = (compilation: ReplayCompilation, stage: ReplayStageContext): {
  steps: PlaybackStep[];
  finalize: boolean;
} => {
  const { frames, sentence, inputTokens, identity } = compilation;
  const {
    index,
    relocationReplacesConstruction,
    structuralWorkspaceRoots,
    priorVisibleNodeIds,
    earlierStageRelationLinks,
    structuralLayoutScaffold,
    frameIsPureVisualTrajectoryStage,
    frameSemanticStep,
    frameCarriesAuthoredEffect,
    plannedStage,
    frameRelationSteps
  } = stage;
  // Built even for a stage that plays none of them: construction allocates
  // the compilation's display ids in stage order.
  const structuralMicrosteps = !relocationReplacesConstruction
    ? buildStructuralDerivationPlaybackSteps({
      forest: structuralWorkspaceRoots,
      frameIndex: index,
      previousVisibleNodeIds: priorVisibleNodeIds,
      resolvedRelationLinks: earlierStageRelationLinks,
      derivationFrames: frames,
      sentence,
      layoutScaffoldForest: structuralLayoutScaffold || undefined,
      identity,
      inputTokens,
      continuedOccurrenceIds: compilation.continuedOccurrenceIds(index)
    })
    : [];
  if (frameIsPureVisualTrajectoryStage) {
    return { steps: [], finalize: true };
  }
  if (structuralMicrosteps.length > 1) {
    return { steps: structuralMicrosteps, finalize: true };
  }
  if (structuralMicrosteps.length > 0 && frameCarriesAuthoredEffect) {
    return { steps: structuralMicrosteps, finalize: true };
  }
  /*
   * A PLANNED stage with no structural microsteps still owns a reachable
   * final Stage Record state. Two such shapes exist:
   * - a relations-only stage, whose authored relation moments must not be
   *   dropped with the microsteps;
   * - a stage whose only tree delta is the REMOVAL of material (e.g. an
   *   anchored node vanishing). A bare 'Other' step for that state would
   *   be deleted by the overt-loss guard, making the whole stage
   *   unreachable and leaving the previous stage's relation on screen.
   * Both route through the finalizer with zero structural steps: relation
   * moments (if any) place first, then the stage's authoritative macro
   * carries the stage's own complete canvas. The overt-material guards
   * already treat a Stage Record as authoritative, so this weakens no
   * transient-microstep protection — it only makes every authored stage's
   * final state reachable.
   */
  if (plannedStage && (frameRelationSteps.length > 0 || structuralMicrosteps.length === 0)) {
    return { steps: [], finalize: true };
  }
  return { steps: [frameSemanticStep], finalize: false };
};
