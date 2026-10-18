/** Resolve the exact node visibility and attachment owned by each relation moment. */
import { type ResolvedRelationLink } from '../relationLinks.ts';
import type { ReplayCompilation } from './compilationContext.ts';
import { buildAuthoredRelationLinksForFrames, isRenderableReplayRelation } from './frameRelations.ts';
import { isHeadLikeResolvedRelation, isResolvedMovementLink, normalizeTrajectoryKind } from './movementLinks.ts';
import {
  findResolvedReplayAnchorByRoles,
  findResolvedReplayAnchorsByRoles,
  getRelationAllAnchorNodeIds,
  getRelationSourceNodeIds,
  getRelationTargetNodeId,
  getResolvedReplayRelationAnchors,
  relationAnchorsExistInForest,
  resolveRelationAnchorNodeId
} from './relationAnchors.ts';
import {
  isRegisteredTrajectoryRelation,
  registeredTrajectoryDisplayKind
} from './relations/movementIdentities.ts';
import { isHeadShellLabel } from './replaySurfaceNotation.ts';
import type { IndexedRelationStep, ReplayStageContext } from './stageContext.ts';
import {
  collectSyntaxSubtreeNodeIds,
  findExactNodeByIdInForest,
  findNodeByIdInForest,
  findParentNodeIdInForest,
  resolvedRelationLinkKey
} from './syntaxForest.ts';
import {
  landingAttachmentPath,
  movementLandingWrapper,
  neutralTransitionHostNodeIds,
  relationOwnedPhrasalSourceRoles,
  relationOwnedPhrasalTargetRoles,
  relationOwnsPhrasalTreeTransition
} from './treeTransitions.ts';

export interface RelationPlacement {
  relation: IndexedRelationStep;
  relationIndex: number;
  relationLabel: string;
  sourceNodeIds: string[];
  authoredTargetNodeIds: string[];
  relationAnchorNodeIds: string[];
  renderableTrajectory: boolean;
  ownsPhrasalTreeTransition: boolean;
}

export const planStageRelations = (compilation: ReplayCompilation, stage: ReplayStageContext) => {
  const { frames, replayPlan, resolveFrameRelations, identity } = compilation;
  const {
    index,
    workspaceRoots,
    frameRelationSteps,
    previousFrameWorkspaceRoots,
    structuralWorkspaceRoots,
    frameHasNonMovementTreeTransition,
    fallbackTransitionOwnership,
    nonMovementTransitionNodeIds
  } = stage;
  const resolveRelationPlacement = (relation: IndexedRelationStep, relationIndex: number) => {
    const relationLabel = String(relation?.relation || '').trim() || 'Visual Relation';
    const resolvedAnchors = getResolvedReplayRelationAnchors(relation);
    const sourceRoles = relationOwnedPhrasalSourceRoles(relation);
    const targetRoles = relationOwnedPhrasalTargetRoles(relation);
    const registeredSourceAnchors = findResolvedReplayAnchorsByRoles(resolvedAnchors, sourceRoles);
    const registeredTargetAnchor = findResolvedReplayAnchorByRoles(resolvedAnchors, targetRoles);
    const explicitSourceNodeIds = getRelationSourceNodeIds(relation);
    const rawAuthoredTargetNodeId = getRelationTargetNodeId(relation)
      || String(registeredTargetAnchor?.nodeId || '');
    const rawSourceNodeIds = explicitSourceNodeIds.length > 0
      ? explicitSourceNodeIds
      : registeredSourceAnchors
        .map((anchor) => String(anchor.nodeId || ''))
        .filter(Boolean);
    // Trajectory placement semantics apply only when the plan authored
    // explicit source/target endpoints; every other renderable relation
    // keeps its own Replay moment anchored to its resolved anchors.
    const isTrajectoryRelation = isRenderableReplayRelation(relation)
      && (relation.recoveredMovement
        ? relation.recoveredMovement.transition
        : isRegisteredTrajectoryRelation(relationLabel, resolvedAnchors))
      && Boolean(rawAuthoredTargetNodeId)
      && rawSourceNodeIds.length > 0;
    const ownsPhrasalTreeTransition = Boolean(relation.recoveredMovement?.transition)
      || (relationOwnsPhrasalTreeTransition(relation)
        && Boolean(rawAuthoredTargetNodeId)
        && rawSourceNodeIds.length > 0);
    const ownsTrajectoryPlacement = isTrajectoryRelation || ownsPhrasalTreeTransition;
    const sourceNodeIds = rawSourceNodeIds
      .map((nodeId) => resolveRelationAnchorNodeId(workspaceRoots, nodeId))
      .filter(Boolean);
    const authoredTargetNodeIds = [...new Set((relation.recoveredMovements
      ? relation.recoveredMovements.filter(movement => movement.transition).map(movement => movement.targetNodeId)
      : [rawAuthoredTargetNodeId]).map(nodeId => resolveRelationAnchorNodeId(workspaceRoots, nodeId)).filter(Boolean))];
    const authoredTargetNodeId = authoredTargetNodeIds[0] || '';
    const sourceNodeId = ownsTrajectoryPlacement
      ? (sourceNodeIds.find((nodeId) => relationAnchorsExistInForest(workspaceRoots, authoredTargetNodeId, nodeId)) || sourceNodeIds[0] || '')
      : '';
    if (ownsTrajectoryPlacement) {
      if (!relationAnchorsExistInForest(workspaceRoots, authoredTargetNodeId, sourceNodeId))
        return null;
    }
    const relationAnchorNodeIds = ownsTrajectoryPlacement
      ? Array.from(new Set([...authoredTargetNodeIds, ...sourceNodeIds].filter(Boolean)))
      : getRelationAllAnchorNodeIds(relation)
        .map((nodeId) => resolveRelationAnchorNodeId(workspaceRoots, nodeId))
        .filter(Boolean);
    // A relation whose authored anchors all failed to resolve keeps its
    // moment: the diagnostics on the step say what is missing. Only a
    // relation that authored no anchors at all has nothing to place.
    const authoredUnresolved = Array.isArray(relation.unresolvedAnchors) && relation.unresolvedAnchors.length > 0;
    if (relationAnchorNodeIds.length === 0 && !authoredUnresolved && !relation.relationContractFailure)
      return null;
    return {
      relation,
      relationIndex,
      relationLabel,
      sourceNodeIds,
      authoredTargetNodeIds,
      relationAnchorNodeIds,
      renderableTrajectory: isTrajectoryRelation,
      ownsPhrasalTreeTransition
    };
  };
  const relationPlacements = frameRelationSteps
    .map((relation, relationIndex) => resolveRelationPlacement(relation, relationIndex))
    .filter((placement): placement is RelationPlacement => Boolean(placement))
    .sort((left, right) => left.relationIndex - right.relationIndex);
  const landingHostPath = (placement: RelationPlacement, authoredTargetNodeId: string): string[] => {
    if (!placement.renderableTrajectory && !placement.ownsPhrasalTreeTransition)
      return [];
    const trajectoryDisplayKind = (placement.relation.recoveredMovements?.find(movement => movement.targetNodeId === authoredTargetNodeId) ?? placement.relation.recoveredMovement)?.trajectoryKind || registeredTrajectoryDisplayKind(placement.relationLabel, placement.relation.resolvedAnchors);
    const ownsLandingConstruction = Boolean(placement.relation.recoveredMovement?.transition) || trajectoryDisplayKind === 'phrasal'
      || placement.ownsPhrasalTreeTransition;
    if (!ownsLandingConstruction)
      return [];
    const landingHostNodeId = findParentNodeIdInForest(workspaceRoots, authoredTargetNodeId);
    if (!landingHostNodeId)
      return [];
    const landingWrapper = movementLandingWrapper(workspaceRoots, previousFrameWorkspaceRoots, authoredTargetNodeId);
    if (landingWrapper)
      return [landingWrapper.wrapperId];
    const priorSourceIds = placement.relation.recoveredMovement
      ? (placement.relation.recoveredMovements ?? [placement.relation.recoveredMovement]).filter(movement => movement.targetNodeId === authoredTargetNodeId).map(movement => movement.priorSourceNodeId)
      : placement.sourceNodeIds;
    const earlierRelationNeedsContext = (contextId: string): boolean => relationPlacements
      .filter(candidate => candidate.relationIndex < placement.relationIndex)
      .some(candidate => {
        const landingContext = candidate.renderableTrajectory || candidate.ownsPhrasalTreeTransition
          ? candidate.authoredTargetNodeIds.flatMap(id => findNodeByIdInForest(workspaceRoots, findParentNodeIdInForest(workspaceRoots, id))?.children || [])
            .filter(child => !candidate.authoredTargetNodeIds.includes(child.id)).map(child => child.id) : [];
        const prerequisites = [...candidate.relationAnchorNodeIds, ...landingContext];
        return prerequisites.some(id => collectSyntaxSubtreeNodeIds(findNodeByIdInForest(workspaceRoots, id)).includes(contextId));
      });
    // Include only the new ancestor path needed to join the landing to
    // the source workspace. An old, separately selected head in the
    // landing complex does not yet attach it to that workspace.
    // Higher projections retain their own micro-steps.
    return landingAttachmentPath(workspaceRoots, previousFrameWorkspaceRoots, authoredTargetNodeId, priorSourceIds, (parentNodeId, branchNodeId, hostIds) => {
      const structuralParent = findNodeByIdInForest(structuralWorkspaceRoots, parentNodeId);
      // Keep the attachment atomic by default. An earlier authored claim
      // can require this independently buildable receiving context first.
      return (trajectoryDisplayKind === 'head' && hostIds.length > 0 || trajectoryDisplayKind === 'phrasal') && Boolean(structuralParent)
        && !(structuralParent!.children || []).some(child => child.id === branchNodeId)
        && earlierRelationNeedsContext(parentNodeId);
    });
  };
  const getMovementCreatedLandingHostPaths = (placement: RelationPlacement) => placement.authoredTargetNodeIds.map(id => landingHostPath(placement, id)).filter(path => path.length);
  const getMovementCreatedLandingHostNodeIds = (placement: RelationPlacement): string[] => [...new Set(getMovementCreatedLandingHostPaths(placement).flat())];
  const singleRelationLinksByIndex = new Map<number, ResolvedRelationLink[]>();
  frameRelationSteps.forEach((relation, relationIndex) => {
    const authoredRelationIndex = Number.isInteger(relation.authoredRelationIndex)
      ? relation.authoredRelationIndex
      : relationIndex;
    const throughRelationLinks = buildAuthoredRelationLinksForFrames({
      frames,
      replayPlan,
      activeFrameIndex: index,
      forest: workspaceRoots,
      currentFrameRelationLimit: authoredRelationIndex,
      frameRelations: resolveFrameRelations
    });
    const beforeRelationLinks = buildAuthoredRelationLinksForFrames({
      frames,
      replayPlan,
      activeFrameIndex: index,
      forest: workspaceRoots,
      currentFrameRelationLimit: authoredRelationIndex - 1,
      frameRelations: resolveFrameRelations
    });
    const beforeLinkKeys = new Set(beforeRelationLinks.map((link) => resolvedRelationLinkKey(link)));
    singleRelationLinksByIndex.set(relationIndex, throughRelationLinks.filter((link) => Number(link?.stepIndex) === index
      && !beforeLinkKeys.has(resolvedRelationLinkKey(link))));
  });
  const relationVisibleNodeIdsByIndex = new Map<number, string[]>();
  relationPlacements.forEach((placement) => {
    if (!placement.renderableTrajectory && !placement.ownsPhrasalTreeTransition) {
      relationVisibleNodeIdsByIndex.set(placement.relationIndex, []);
      return;
    }
    const placementRelationLinks = singleRelationLinksByIndex.get(placement.relationIndex) || [];
    const targets = placement.authoredTargetNodeIds.map(authoredTargetNodeId => {
      const targetParentNodeId = findParentNodeIdInForest(workspaceRoots, authoredTargetNodeId);
      const targetParent = findNodeByIdInForest(workspaceRoots, targetParentNodeId);
      const trajectoryKind = (placement.relation.recoveredMovements?.find(movement => movement.targetNodeId === authoredTargetNodeId) ?? placement.relation.recoveredMovement)?.trajectoryKind || registeredTrajectoryDisplayKind(placement.relationLabel, placement.relation.resolvedAnchors);
      const landingWrapper = trajectoryKind === 'phrasal'
        ? movementLandingWrapper(workspaceRoots, previousFrameWorkspaceRoots, authoredTargetNodeId)
        : null;
      const targetSubtreeNodeIds = collectSyntaxSubtreeNodeIds(findNodeByIdInForest(workspaceRoots, authoredTargetNodeId));
      return { authoredTargetNodeId, targetParentNodeId, targetParent, trajectoryKind, landingWrapper, targetSubtreeNodeIds };
    });
    const sourceSubtreeNodeIds = placement.sourceNodeIds.flatMap((nodeId) => collectSyntaxSubtreeNodeIds(findNodeByIdInForest(workspaceRoots, nodeId)));
    const targetSyntheticLeafNodeIds = targets.filter(({ authoredTargetNodeId }) => placementRelationLinks.some(link => link.targetNodeId === authoredTargetNodeId && (normalizeTrajectoryKind(link.trajectoryKind) === 'head' || isHeadLikeResolvedRelation(link))))
      .map(({ authoredTargetNodeId }) => identity.allocate(`${authoredTargetNodeId}::__leaf`, { kind: 'word', ownerId: authoredTargetNodeId }));
    // Restored preceding containers have their old IDs in the structural
    // forest. Their current replacements belong to this movement moment.
    const sourceContainerNodeIds: string[] = [];
    placement.sourceNodeIds.forEach(sourceId => {
      let parentId = findParentNodeIdInForest(workspaceRoots, sourceId);
      while (parentId) {
        if (!findNodeByIdInForest(structuralWorkspaceRoots, parentId)) {
          sourceContainerNodeIds.push(parentId);
        }
        parentId = findParentNodeIdInForest(workspaceRoots, parentId);
      }
    });
    relationVisibleNodeIdsByIndex.set(placement.relationIndex, Array.from(new Set([
      ...targets.flatMap(({ targetParentNodeId, landingWrapper, trajectoryKind, targetParent, targetSubtreeNodeIds }) => [
        targetParentNodeId, landingWrapper?.wrapperId, ...targetSubtreeNodeIds,
        ...(trajectoryKind === 'head' && isHeadShellLabel(targetParent?.label) ? collectSyntaxSubtreeNodeIds(targetParent) : [])
      ]),
      ...getMovementCreatedLandingHostNodeIds(placement),
      ...targetSyntheticLeafNodeIds,
      ...sourceSubtreeNodeIds,
      ...sourceContainerNodeIds,
      ...placement.sourceNodeIds
    ].filter(Boolean))));
  });
  // The new parents each neutral claim's moment introduces with its output,
  // by claim. The path stops below a parent an earlier claim needs as context.
  const transitionHostNodeIds = new Map<string, number>();
  if (frameHasNonMovementTreeTransition) {
    const transitionNodeIds = new Set([...nonMovementTransitionNodeIds.values()].flatMap(ids => [...ids]));
    const anchoredBefore = (relationIndex: number, nodeId: string) => frameRelationSteps.slice(0, relationIndex)
      .some(relation => getRelationAllAnchorNodeIds(relation).some(id => collectSyntaxSubtreeNodeIds(findExactNodeByIdInForest(workspaceRoots, id)).includes(nodeId)));
    nonMovementTransitionNodeIds.forEach((_nodeIds, relationIndex) => {
      const ownership = fallbackTransitionOwnership.get(relationIndex);
      if (!ownership)
        return;
      neutralTransitionHostNodeIds(frameRelationSteps[relationIndex], ownership, previousFrameWorkspaceRoots, workspaceRoots,
        parentNodeId => anchoredBefore(relationIndex, parentNodeId))
        .filter(hostId => !transitionNodeIds.has(hostId) && !transitionHostNodeIds.has(hostId))
        .forEach(hostId => transitionHostNodeIds.set(hostId, relationIndex));
    });
  }
  const relationLayoutNodeIds = Array.from(new Set(Array.from(relationVisibleNodeIdsByIndex.values()).flat().filter(Boolean)));
  const frameHasTreeTransition = Array.from(singleRelationLinksByIndex.values()).some((links) => links.some(isResolvedMovementLink))
    || relationPlacements.some((placement) => placement.ownsPhrasalTreeTransition)
    || frameHasNonMovementTreeTransition;
  return {
    relationPlacements,
    singleRelationLinksByIndex,
    getMovementCreatedLandingHostNodeIds,
    relationVisibleNodeIdsByIndex,
    relationLayoutNodeIds,
    frameHasTreeTransition,
    getMovementCreatedLandingHostPaths,
    transitionHostNodeIds
  };
};

export type StageRelationPlan = ReturnType<typeof planStageRelations>;
