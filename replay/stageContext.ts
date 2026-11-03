/** Prepare the completed state and the preceding material needed to compile one stage. */
import { type SyntaxNode } from '../types.ts';
import { getDerivationFrameChange, getFrameStageRecordText } from './authoredFrames.ts';
import type { ReplayCompilation } from './compilationContext.ts';
import { renameContinuedOccurrences } from './continuedOccurrences.ts';
import {
  buildAuthoredRelationLinksForFrames,
  isRenderableReplayRelation
} from './frameRelations.ts';
import { normalizeTrajectoryKind } from './movementLinks.ts';
import { buildStructuralReplayFallback, getReplayPlanStage } from './playbackFormatting.ts';
import {
  findResolvedReplayAnchorByRoles,
  findResolvedReplayAnchorsByRoles,
  getRelationAllAnchorNodeIds,
  getRelationSourceNodeIds,
  getRelationTargetNodeId,
  getResolvedReplayRelationAnchors,
  relationAnchorNodeIds
} from './relationAnchors.ts';
import { isRegisteredTrajectoryRelation } from './relations/movementIdentities.ts';
import { buildDerivationReplaySnapshot, collectVisibleDerivationNodeIds } from './replayCanvas.ts';
import { buildFrameReplayBlocks, buildStageRecordReplayBlocks } from './replayPanel.ts';
import { mergeReplayDetailBlocks } from './replayPanelFormatting.ts';
import {
  buildCurrentMaterialLayoutScaffold,
  forestCanUseCurrentMaterialLayoutScaffold,
  inferFutureLayoutScaffold,
  inferFutureWorkspaceRootOrder,
  reorderWorkspaceRootsForReplay
} from './stageLayout.ts';
import {
  collectExactNodesByIdInForest,
  collectReplayOvertTokenMultisetKey,
  collectReplayRootStructuralKey,
  collectSyntaxSubtreeNodeIds,
  findExactNodeByIdInForest,
  findExactNodesByIdInForest,
  findNodeByIdInForest
} from './syntaxForest.ts';
import {
  buildPreMovementStructuralForest,
  type FallbackTreeTransitionOwnership,
  planNeutralTransitionAttachments,
  relationOwnedPhrasalSourceRoles,
  relationOwnedPhrasalTargetRoles,
  relationOwnsNonMovementTreeTransition,
  resolveFallbackTreeTransitionOwnership
} from './treeTransitions.ts';
import { type DerivationReplayPlanStep, type PlaybackStep, type ReplayDerivationFrame } from './types.ts';

export type IndexedRelationStep = DerivationReplayPlanStep & {
  authoredRelationIndex: number;
};

/**
 * A saved unary shell over a carried child gains its second child, the
 * landing a claim of this stage owns: withhold the shell from its first stage
 * until that claim's moment (`pendingProjectionReveals`), unless an earlier
 * claim already names it.
 */
const withholdUnaryLandingShells = (
  compilation: ReplayCompilation,
  index: number,
  plannedFrameRelations: DerivationReplayPlanStep[],
  previousFrameWorkspaceRoots: SyntaxNode[],
  workspaceRoots: SyntaxNode[]
) => {
  const { frames, plannedRelationsByFrame, pendingProjectionReveals } = compilation;
  plannedFrameRelations.forEach((relation, relationIndex) => {
    const movement = relation.recoveredMovement;
    const ownership = movement?.transition ? null : resolveFallbackTreeTransitionOwnership(relation, previousFrameWorkspaceRoots, workspaceRoots);
    if (!(movement?.transition && movement.trajectoryKind === 'phrasal') && !ownership)
      return;
    workspaceRoots.forEach(parent => {
      const previousParent = previousFrameWorkspaceRoots.find(root => root.id === parent.id);
      if (!parent.id || parent.word || parent.children?.length !== 2 || previousParent?.children?.length !== 1)
        return;
      const carriedChildId = previousParent.children[0].id;
      if (!parent.children.some(child => child.id === carriedChildId))
        return;
      const landing = parent.children.find(child => child.id !== carriedChildId);
      if (!landing?.id)
        return;
      const ownsLanding = movement?.transition
        ? movement.targetNodeId === landing.id
        : Boolean(landing.children?.length
          && ownership?.currentNodeIds.has(landing.id)
          && ownership.priorNodeIds.has(landing.id)
          && findExactNodesByIdInForest(previousFrameWorkspaceRoots, landing.id).length === 1
          && findExactNodesByIdInForest(workspaceRoots, landing.id).length === 1);
      if (!ownsLanding)
        return;
      const owner = relation.authoredRelationIndex ?? relationIndex;
      const pending = pendingProjectionReveals.find(reveal => reveal.nodeId === parent.id && reveal.stageIndex === index);
      // Another claim may own the same landing and play first.
      if (pending) {
        pending.relationIndexes.push(owner);
        return;
      }
      let firstStageIndex = index - 1;
      while (firstStageIndex > 0) {
        const earlier = frames[firstStageIndex - 1].workspaceForest?.find(root => root.id === parent.id);
        if (earlier?.children?.length !== 1 || earlier.children[0].id !== carriedChildId)
          break;
        firstStageIndex -= 1;
      }
      const precedingRelations = [
        ...plannedRelationsByFrame.slice(firstStageIndex, index).flat(),
        ...plannedFrameRelations.slice(0, relationIndex)
      ];
      if (precedingRelations.some(candidate => [
        ...getRelationAllAnchorNodeIds(candidate),
        ...relationAnchorNodeIds(candidate.priorAnchors),
        getRelationTargetNodeId(candidate),
        ...getRelationSourceNodeIds(candidate)
      ].includes(parent.id!)))
        return;
      // Withhold the saved unary shell until its second child attaches. A
      // fallback can own an exact node's relocation without proving a
      // linguistic movement drawing; earlier claims still retain their anchors.
      pendingProjectionReveals.push({ nodeId: parent.id, firstStageIndex, stageIndex: index, relationIndexes: [owner] });
    });
  });
};

/** A registered trajectory whose landing existed in the preceding stage and whose sources did not. */
const relocatesPriorLandingOccurrence = (relation: DerivationReplayPlanStep, previousFrameWorkspaceRoots: SyntaxNode[]): boolean => {
  if (!isRegisteredTrajectoryRelation(relation?.relation, relation?.anchors))
    return false;
  const resolvedAnchors = getResolvedReplayRelationAnchors(relation);
  const targetNodeId = getRelationTargetNodeId(relation)
    || String(findResolvedReplayAnchorByRoles(resolvedAnchors, relationOwnedPhrasalTargetRoles(relation))?.nodeId || '');
  const explicitSourceNodeIds = getRelationSourceNodeIds(relation);
  const sourceNodeIds = explicitSourceNodeIds.length > 0
    ? explicitSourceNodeIds
    : findResolvedReplayAnchorsByRoles(resolvedAnchors, relationOwnedPhrasalSourceRoles(relation))
      .map((anchor) => String(anchor.nodeId || ''))
      .filter(Boolean);
  return Boolean(targetNodeId)
    && Boolean(findNodeByIdInForest(previousFrameWorkspaceRoots, targetNodeId))
    && sourceNodeIds.length > 0
    && sourceNodeIds.every((sourceNodeId) => !findNodeByIdInForest(previousFrameWorkspaceRoots, sourceNodeId));
};

export const prepareReplayStage = (
  compilation: ReplayCompilation,
  frame: ReplayDerivationFrame,
  index: number
) => {
  const {
    frames,
    replayPlan,
    resolveFrameRelations,
    plannedRelationsByFrame,
    previousVisibleNodeIds,
    identity
  } = compilation;
  const plannedStage = getReplayPlanStage(replayPlan, index);
  const rawWorkspaceRoots = Array.isArray(frame.workspaceForest) ? frame.workspaceForest : [];
  // Anchor detached roots to explicit future daughter order as soon as a later
  // derivation frame makes that merge order unambiguous. This keeps bottom-up
  // workspace assembly visually aligned with the eventual tree without guessing.
  const preferredWorkspaceRootOrder = inferFutureWorkspaceRootOrder(rawWorkspaceRoots, frames, index);
  const workspaceRoots = reorderWorkspaceRootsForReplay(rawWorkspaceRoots, preferredWorkspaceRootOrder);
  let futureLayoutScaffold = inferFutureLayoutScaffold(workspaceRoots, frames, index);
  const rootLabels = workspaceRoots
    .map((node) => String(node?.label || '').trim())
    .filter(Boolean);
  const primaryRoot = workspaceRoots[0];
  const primaryRootId = String(primaryRoot?.id || '');
  const primaryRootLabel = String(primaryRoot?.label || '').trim() || 'Workspace';
  const structuralFallbackRecipe = buildStructuralReplayFallback('Other', primaryRootLabel, rootLabels);
  const previousFrameWorkspaceRoots = index > 0 && Array.isArray(frames[index - 1]?.workspaceForest)
    ? frames[index - 1].workspaceForest
    : [];
  const plannedFrameRelations = plannedStage
    ? resolveFrameRelations(index)
    : [];
  plannedRelationsByFrame[index] = plannedFrameRelations;
  withholdUnaryLandingShells(compilation, index, plannedFrameRelations, previousFrameWorkspaceRoots, workspaceRoots);
  const relocatingRelations = index > 0 && !plannedFrameRelations.some((relation) => relation?.relation === 'CopyOccurrence')
    ? plannedFrameRelations.filter(relation => relocatesPriorLandingOccurrence(relation, previousFrameWorkspaceRoots))
    : [];
  const frameRelocatesPriorLanding = relocatingRelations.length > 0;
  // A recovered movement whose landing keeps the moved occurrence's id is
  // undone by buildPreMovementStructuralForest, so the stage's other new
  // material still gets its ordinary construction steps.
  const relocationReplacesConstruction = relocatingRelations.some(relation => !relation.recoveredMovement?.transition);
  const frameCarriesAuthoredEffect = Boolean(String(getDerivationFrameChange(frame)?.statement || '').trim());
  const priorVisibleNodeIds = new Set(previousVisibleNodeIds);
  // The preceding forest as construction reads it: each occurrence this stage
  // continues under a new id already carries that id.
  const constructionPreviousWorkspaceRoots = renameContinuedOccurrences(previousFrameWorkspaceRoots, compilation.continuedOccurrenceIds(index));
  const frameRelationSteps: IndexedRelationStep[] = plannedStage
    ? plannedFrameRelations
      .map((relation, listIndex) => ({
        ...relation,
        // The authored array position is the relation's exact identity;
        // keep the plan's own index when present — a positional index
        // is wrong as soon as any upstream step was filtered.
        authoredRelationIndex: Number.isInteger(relation.authoredRelationIndex)
          ? (relation.authoredRelationIndex as number)
          : listIndex
      }))
      .filter(isRenderableReplayRelation)
    : [];
  const nonMovementTreeTransitionRelationIndexes = new Set(frameRelationSteps
    .map((relation, relationIndex) => (relationOwnsNonMovementTreeTransition(relation, previousFrameWorkspaceRoots, workspaceRoots) ? relationIndex : -1))
    .filter((relationIndex) => relationIndex >= 0));
  const fallbackTransitionOwnership = new Map<number, FallbackTreeTransitionOwnership>();
  frameRelationSteps.forEach((relation, relationIndex) => {
    if (relation.recoveredMovement?.transition)
      return;
    const ownership = resolveFallbackTreeTransitionOwnership(relation, previousFrameWorkspaceRoots, workspaceRoots);
    if (ownership)
      fallbackTransitionOwnership.set(relationIndex, ownership);
  });
  const frameHasNonMovementTreeTransition = index > 0
    && nonMovementTreeTransitionRelationIndexes.size > 0
    && JSON.stringify(previousFrameWorkspaceRoots) !== JSON.stringify(workspaceRoots);
  const nonMovementTransitionNodeIds = new Map<number, Set<string>>();
  nonMovementTreeTransitionRelationIndexes.forEach(relationIndex => {
    nonMovementTransitionNodeIds.set(relationIndex, fallbackTransitionOwnership.get(relationIndex)?.currentNodeIds || new Set(getRelationAllAnchorNodeIds(frameRelationSteps[relationIndex]).flatMap(nodeId => collectSyntaxSubtreeNodeIds(findExactNodeByIdInForest(workspaceRoots, nodeId)))));
  });
  if (frameHasNonMovementTreeTransition)
    planNeutralTransitionAttachments(frameRelationSteps, fallbackTransitionOwnership, [...nonMovementTreeTransitionRelationIndexes],
      previousFrameWorkspaceRoots, workspaceRoots);
  const frameIsPureVisualTrajectoryStage = frameRelocatesPriorLanding
    && collectReplayOvertTokenMultisetKey(previousFrameWorkspaceRoots) === collectReplayOvertTokenMultisetKey(workspaceRoots)
    && collectReplayRootStructuralKey(previousFrameWorkspaceRoots) === collectReplayRootStructuralKey(workspaceRoots);
  const earlierStageRelationLinks = plannedStage
    ? buildAuthoredRelationLinksForFrames({
      frames,
      replayPlan,
      activeFrameIndex: index - 1,
      forest: workspaceRoots,
      currentFrameRelationLimit: Number.POSITIVE_INFINITY,
      frameRelations: resolveFrameRelations
    })
    : [];
  const throughStageRelationLinks = plannedStage
    ? buildAuthoredRelationLinksForFrames({
      frames,
      replayPlan,
      activeFrameIndex: index,
      forest: workspaceRoots,
      currentFrameRelationLimit: Number.POSITIVE_INFINITY,
      frameRelations: resolveFrameRelations
    })
    : [];
  const currentFrameVisibleNodeIds = collectVisibleDerivationNodeIds(workspaceRoots, identity);
  const structuralWorkspaceRoots = buildPreMovementStructuralForest(workspaceRoots, frameRelationSteps, previousFrameWorkspaceRoots);
  const preauthorizedFramePlaceholderIds = new Set(Array.from(collectExactNodesByIdInForest(futureLayoutScaffold || workspaceRoots).values()).flat()
    .flatMap(node => node.replayOrigin?.kind === 'layout' && node.replayOrigin.authoredId ? [node.replayOrigin.authoredId] : []));
  // Ordinary construction needs one layout context before and after movement.
  // Switching to a distant future scaffold only after movement stretches the
  // earlier canvas across dimensions reserved for nodes it does not contain.
  if (futureLayoutScaffold && !frameRelocatesPriorLanding
    && !buildCurrentMaterialLayoutScaffold(structuralWorkspaceRoots, futureLayoutScaffold, preauthorizedFramePlaceholderIds) && !forestCanUseCurrentMaterialLayoutScaffold(structuralWorkspaceRoots, futureLayoutScaffold)) {
    futureLayoutScaffold = null;
  }
  const frameReplaySnapshot = buildDerivationReplaySnapshot({
    forest: workspaceRoots,
    activeFrameIndex: index,
    relationLinks: throughStageRelationLinks,
    visibleNodeIds: futureLayoutScaffold ? currentFrameVisibleNodeIds : undefined,
    derivationFrames: frames,
    layoutScaffoldForest: futureLayoutScaffold || undefined,
    identity
  });
  const frameReplayBlocks = buildFrameReplayBlocks(frame, frameReplaySnapshot.canvasData, plannedStage);
  const frameStageRecordBlocks = plannedStage
    ? buildStageRecordReplayBlocks(frame, plannedStage)
    : frameReplayBlocks;
  const frameLayoutTopology = futureLayoutScaffold || workspaceRoots;
  // Prefer a scaffold grafted from the snapshot's own material, which keeps
  // exactly the snapshot's edges among current nodes. Otherwise borrow the
  // stage's future scaffold when it fits the snapshot, including attachments
  // the snapshot still holds back (`heldParentIds`).
  const buildFrameLayoutScaffold = (snapshotRoots: SyntaxNode[], heldParentIds?: ReadonlySet<string>): SyntaxNode[] | undefined => {
    const scaffold = buildCurrentMaterialLayoutScaffold(snapshotRoots, frameLayoutTopology, preauthorizedFramePlaceholderIds);
    if (scaffold)
      return scaffold;
    return futureLayoutScaffold
      && forestCanUseCurrentMaterialLayoutScaffold(snapshotRoots, futureLayoutScaffold, heldParentIds)
      ? futureLayoutScaffold
      : undefined;
  };
  const structuralLayoutScaffold = buildFrameLayoutScaffold(structuralWorkspaceRoots);
  const mergedFrameDetailBlocks = mergeReplayDetailBlocks(frameStageRecordBlocks);
  const frameTrajectoryKind = frameRelocatesPriorLanding
    ? (frameReplaySnapshot.relationLinks?.some((link) => normalizeTrajectoryKind(link?.trajectoryKind) === 'head') ? 'head' : 'phrasal')
    : '';
  const frameSemanticStep: PlaybackStep = {
    operation: 'Other',
    sourceKind: 'derivation-effect',
    trajectoryKind: frameTrajectoryKind || undefined,
    sourceFrameIndex: index,
    visualFrameIndex: index,
    targetNodeId: frameRelocatesPriorLanding
      ? ''
      : (primaryRootId || frame.frameId || frame.stepId || `__derivation_${index}`),
    targetLabel: frameRelocatesPriorLanding
      ? ''
      : (rootLabels.length === 1 ? primaryRootLabel : 'Workspace'),
    sourceLabels: frameRelocatesPriorLanding ? [] : rootLabels,
    recipe: structuralFallbackRecipe,
    workspaceAfter: rootLabels,
    detailBlocks: mergedFrameDetailBlocks,
    replayKind: plannedStage ? 'macro' : undefined,
    stageRecord: getFrameStageRecordText(frame, plannedStage),
    stepId: frame.stepId,
    replayFrameIndex: index,
    replayCanvasData: frameReplaySnapshot.canvasData,
    replayVisibleNodeIds: frameReplaySnapshot.visibleNodeIds,
    replayRelationLinks: frameReplaySnapshot.relationLinks,
    replayUsesFutureLayoutScaffold: Boolean(futureLayoutScaffold)
  };
  return {
    frame,
    index,
    workspaceRoots,
    frameRelationSteps,
    previousFrameWorkspaceRoots,
    constructionPreviousWorkspaceRoots,
    structuralWorkspaceRoots,
    frameHasNonMovementTreeTransition,
    earlierStageRelationLinks,
    fallbackTransitionOwnership,
    nonMovementTreeTransitionRelationIndexes,
    frameIsPureVisualTrajectoryStage,
    currentFrameVisibleNodeIds,
    buildFrameLayoutScaffold,
    frameSemanticStep,
    plannedStage,
    frameRelocatesPriorLanding,
    relocationReplacesConstruction,
    priorVisibleNodeIds,
    structuralLayoutScaffold,
    frameCarriesAuthoredEffect,
    nonMovementTransitionNodeIds,
    frameReplaySnapshot,
    frameStageRecordBlocks,
    futureLayoutScaffold
  };
};

export type ReplayStageContext = ReturnType<typeof prepareReplayStage>;
