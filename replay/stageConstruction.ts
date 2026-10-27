/** Build the ordinary candidate micro-steps before relation ownership schedules them. */
import type { ReplayCompilation } from './compilationContext.ts';
import { isMoveLikeOperation } from './movementLinks.ts';
import { buildStructuralReplayFallback } from './playbackFormatting.ts';
import { buildDerivationReplaySnapshot, getReplayLeafSelectionTarget } from './replayCanvas.ts';
import type { ReplayStageContext } from './stageContext.ts';
import { inferFutureWorkspaceRootOrder, reorderWorkspaceRootsForReplay } from './stageLayout.ts';
import { buildStructuralDerivationPlaybackSteps } from './structuralPlayback.ts';
import {
  collectSyntaxSubtreeNodeIds,
  countOvertLeafSyntaxNodes,
  hasBranchingSyntaxSubtree
} from './syntaxForest.ts';
import { type PlaybackStep } from './types.ts';

export const buildStageConstruction = (compilation: ReplayCompilation, stage: ReplayStageContext): {
  steps: PlaybackStep[];
  finalize: boolean;
} => {
  const { frames, sentence, inputTokens, identity, previousWorkspaceRootIds, getPreFrontingLexicalSurface } = compilation;
  const {
    index,
    frameMovementPayloadReplacesConstruction,
    fallbackOperation,
    structuralWorkspaceRoots,
    priorVisibleNodeIds,
    authoredPreviousRelationRelationLinks,
    structuralLayoutScaffold,
    frameIsPureVisualTrajectoryStage,
    nextFramePendingRootSubtreeIds,
    nextFrame,
    preferredWorkspaceRootSideHints,
    frameSemanticStep,
    frameCarriesAuthoredEffect,
    plannedStage,
    frameRelationSteps
  } = stage;
  const structuralMicrosteps = !frameMovementPayloadReplacesConstruction && !isMoveLikeOperation(fallbackOperation)
    ? buildStructuralDerivationPlaybackSteps({
      forest: structuralWorkspaceRoots,
      frameIndex: index,
      previousVisibleNodeIds: priorVisibleNodeIds,
      resolvedRelationLinks: authoredPreviousRelationRelationLinks,
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
  if (String(fallbackOperation || '').trim() === 'LexicalSelect') {
    const newlySelectedRoots = structuralWorkspaceRoots.filter((root) => {
      const rootId = String(root?.id || '');
      return rootId && !previousWorkspaceRootIds.has(rootId);
    });
    const packsInternalBaseGeneration = newlySelectedRoots.some((root) => countOvertLeafSyntaxNodes(root) > 1 || hasBranchingSyntaxSubtree(root));
    if (packsInternalBaseGeneration && structuralMicrosteps.length > 1) {
      return { steps: structuralMicrosteps, finalize: true };
    }
    if (newlySelectedRoots.length > 0) {
      const projectedRootIds = new Set(previousWorkspaceRootIds);
      const projectedRootSubtreeIds = new Set<string>();
      const lexicalSnapshotRoots = nextFramePendingRootSubtreeIds.size > 0 && Array.isArray(nextFrame?.workspaceForest)
        ? reorderWorkspaceRootsForReplay(nextFrame.workspaceForest, inferFutureWorkspaceRootOrder(nextFrame.workspaceForest, frames, index + 1))
        : structuralWorkspaceRoots;
      let lexicalStepCursor = 0;
      const buildWorkspaceLabelsForState = (
        activeRootId: string,
        activeLabel: string,
        mode: 'leaf' | 'projected'
      ): string[] => structuralWorkspaceRoots
        .map((candidateRoot) => {
          const candidateId = String(candidateRoot?.id || '');
          if (!candidateId)
            return '';
          if (candidateId === activeRootId) {
            return mode === 'leaf'
              ? activeLabel
              : String(candidateRoot?.label || '').trim();
          }
          if (!projectedRootIds.has(candidateId))
            return '';
          return String(candidateRoot?.label || '').trim();
        })
        .filter(Boolean);
      const lexicalReplaySteps = newlySelectedRoots.flatMap((root, rootIndex) => {
        const rootId = String(root?.id || '') || `__derivation_${index}_lex_${lexicalStepCursor + 1}`;
        const projectedLabel = String(root?.label || '').trim() || 'Workspace';
        const leafTarget = getReplayLeafSelectionTarget(root, identity);
        const rootSubtreeIds = collectSyntaxSubtreeNodeIds(root);
        const pendingRootSubtreeIds = newlySelectedRoots
          .slice(rootIndex + 1)
          .flatMap((pendingRoot) => collectSyntaxSubtreeNodeIds(pendingRoot));
        const lexicalSteps: PlaybackStep[] = [];
        if (leafTarget) {
          const leafSurface = getPreFrontingLexicalSurface(leafTarget.surface, index);
          const selectVisibleNodeIds = new Set<string>(projectedRootIds);
          selectVisibleNodeIds.add(leafTarget.nodeId);
          const selectLayoutNodeIds = new Set<string>(selectVisibleNodeIds);
          projectedRootSubtreeIds.forEach((subtreeNodeId) => selectLayoutNodeIds.add(subtreeNodeId));
          rootSubtreeIds.forEach((subtreeNodeId) => selectLayoutNodeIds.add(subtreeNodeId));
          pendingRootSubtreeIds.forEach((subtreeNodeId) => selectLayoutNodeIds.add(subtreeNodeId));
          nextFramePendingRootSubtreeIds.forEach((subtreeNodeId) => selectLayoutNodeIds.add(subtreeNodeId));
          const lexicalSelectSnapshot = buildDerivationReplaySnapshot({
            forest: lexicalSnapshotRoots,
            activeFrameIndex: index,
            relationLinks: authoredPreviousRelationRelationLinks,
            visibleNodeIds: selectVisibleNodeIds,
            layoutNodeIds: selectLayoutNodeIds,
            derivationFrames: frames,
            detachedRootSideHints: preferredWorkspaceRootSideHints,
            identity
          });
          lexicalStepCursor += 1;
          lexicalSteps.push({
            ...frameSemanticStep,
            targetNodeId: leafTarget.nodeId,
            targetLabel: leafSurface,
            sourceNodeIds: [leafTarget.nodeId],
            sourceLabels: [leafSurface],
            recipe: buildStructuralReplayFallback('LexicalSelect', leafSurface, [leafSurface]),
            workspaceAfter: buildWorkspaceLabelsForState(rootId, leafSurface, 'leaf'),
            replayCanvasData: lexicalSelectSnapshot.canvasData,
            replayVisibleNodeIds: lexicalSelectSnapshot.visibleNodeIds,
            replayRelationLinks: lexicalSelectSnapshot.relationLinks,
            stepId: frameSemanticStep.stepId ? `${frameSemanticStep.stepId}.${lexicalStepCursor}` : undefined
          } satisfies PlaybackStep);
        }
        projectedRootIds.add(rootId);
        rootSubtreeIds.forEach((subtreeNodeId) => projectedRootSubtreeIds.add(subtreeNodeId));
        const projectVisibleNodeIds = new Set<string>(projectedRootIds);
        const projectLayoutNodeIds = new Set<string>(projectVisibleNodeIds);
        projectedRootSubtreeIds.forEach((subtreeNodeId) => projectLayoutNodeIds.add(subtreeNodeId));
        pendingRootSubtreeIds.forEach((subtreeNodeId) => projectLayoutNodeIds.add(subtreeNodeId));
        nextFramePendingRootSubtreeIds.forEach((subtreeNodeId) => projectLayoutNodeIds.add(subtreeNodeId));
        const lexicalProjectSnapshot = buildDerivationReplaySnapshot({
          forest: lexicalSnapshotRoots,
          activeFrameIndex: index,
          relationLinks: authoredPreviousRelationRelationLinks,
          visibleNodeIds: projectVisibleNodeIds,
          layoutNodeIds: projectLayoutNodeIds,
          derivationFrames: frames,
          detachedRootSideHints: preferredWorkspaceRootSideHints,
          identity
        });
        lexicalStepCursor += 1;
        lexicalSteps.push({
          ...frameSemanticStep,
          operation: 'Project',
          targetNodeId: rootId,
          targetLabel: projectedLabel,
          sourceNodeIds: [rootId],
          sourceLabels: [projectedLabel],
          recipe: buildStructuralReplayFallback('Project', projectedLabel, [projectedLabel]),
          workspaceAfter: buildWorkspaceLabelsForState(rootId, projectedLabel, 'projected'),
          replayCanvasData: lexicalProjectSnapshot.canvasData,
          replayVisibleNodeIds: lexicalProjectSnapshot.visibleNodeIds,
          replayRelationLinks: lexicalProjectSnapshot.relationLinks,
          stepId: frameSemanticStep.stepId ? `${frameSemanticStep.stepId}.${lexicalStepCursor}` : undefined
        } satisfies PlaybackStep);
        return lexicalSteps;
      });
      return { steps: lexicalReplaySteps, finalize: true };
    }
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
