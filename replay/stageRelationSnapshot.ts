/** Materialize a stage with exactly the active relation transitions and ordinary construction. */
import { type ResolvedRelationLink } from '../relationLinks.ts';
import { type DerivationOperation, type SyntaxNode } from '../types.ts';
import { getFrameStageRecordText } from './authoredFrames.ts';
import type { ReplayCompilation } from './compilationContext.ts';
import { preserveConstructionAttachments } from './constructionAttachments.ts';
import { replayOwnerId } from './displayIdentity.ts';
import { isHeadLikeResolvedRelation, isResolvedMovementLink } from './movementLinks.ts';
import { registeredTrajectoryDisplayKind } from './relations/movementIdentities.ts';
import { buildDerivationReplaySnapshot } from './replayCanvas.ts';
import {
  getReplayNodeCategoryFromCanvas,
  getReplayNodeDisplayFromCanvas,
  getReplayNodeOvertYieldFromCanvas
} from './replayNodeDescription.ts';
import { buildRelationReplayBlocks } from './replayPanel.ts';
import { mergeReplayDetailBlocks } from './replayPanelFormatting.ts';
import type { ReplayStageContext } from './stageContext.ts';
import type { RelationPlacement, StageRelationPlan } from './stageRelationPlan.ts';
import {
  collectSyntaxSubtreeNodeIds,
  findExactNodeByIdInForest,
  findNodeByIdInForest,
  findParentNodeIdInForest,
  resolvedRelationLinkKey
} from './syntaxForest.ts';
import {
  buildAnchoredTreeTransitionForest,
  buildPreMovementStructuralForest,
  keptIdLandingNodeIds,
  movementLandingWrapper,
  movementLandingGroups,
  receivingHeadMaterialNodeId
} from './treeTransitions.ts';
import { type PlaybackStep } from './types.ts';

export const createStageRelationSnapshots = (
  compilation: ReplayCompilation,
  stage: ReplayStageContext,
  placements: StageRelationPlan,
  ordinaryStructuralNodeIds: ReadonlySet<string>,
  /** Ordinary attachments whose construction step has not run. */
  heldAttachmentNodeIds: () => ReadonlySet<string> = () => new Set()
) => {
  const { frames, identity } = compilation;
  const {
    frame,
    index,
    previousFrameWorkspaceRoots,
    workspaceRoots,
    frameRelationSteps,
    authoredPreviousRelationRelationLinks,
    fallbackTransitionOwnership,
    nonMovementTreeTransitionRelationIndexes,
    frameHasNonMovementTreeTransition,
    frameIsPureVisualTrajectoryStage,
    currentFrameVisibleNodeIds,
    buildFrameLayoutScaffold,
    frameSemanticStep,
    plannedStage
  } = stage;
  const {
    relationPlacements,
    singleRelationLinksByIndex,
    getMovementCreatedLandingHostNodeIds,
    relationVisibleNodeIdsByIndex,
    relationLayoutNodeIds,
    frameHasTreeTransition,
    transitionHostNodeIds
  } = placements;
  const keptIdLandings = new Map([...fallbackTransitionOwnership].map(([relationIndex, ownership]) =>
    [relationIndex, keptIdLandingNodeIds(ownership, previousFrameWorkspaceRoots, workspaceRoots)]));
  const collectInactiveTrajectoryTargetNodeIds = (activeRelationIndexes: Set<number>, preservedForest: SyntaxNode[] = []): Set<string> => {
    const inactiveTargetNodeIds = new Set<string>();
    const activeTargetNodeIds = new Set(relationPlacements
      .filter((placement) => activeRelationIndexes.has(placement.relationIndex))
      .filter((placement) => placement.renderableTrajectory || placement.ownsPhrasalTreeTransition)
      .flatMap((placement) => placement.authoredTargetNodeIds)
      .filter(Boolean));
    const addInactiveTargetSubtree = (targetNodeId: string, preserveTargetShell = false) => {
      const normalizedTargetNodeId = String(targetNodeId || '');
      if (!normalizedTargetNodeId)
        return;
      const retainedSource = relationPlacements.some(placement => {
        const movements = placement.relation.recoveredMovements ?? (placement.relation.recoveredMovement ? [placement.relation.recoveredMovement] : []);
        return !activeRelationIndexes.has(placement.relationIndex)
          && movements.some(movement => movement.priorSourceNodeId === normalizedTargetNodeId
            && movement.sourceNodeId !== normalizedTargetNodeId)
          && Boolean(findNodeByIdInForest(preservedForest, normalizedTargetNodeId))
          && findParentNodeIdInForest(preservedForest, normalizedTargetNodeId)
          === findParentNodeIdInForest(previousFrameWorkspaceRoots, normalizedTargetNodeId);
      });
      if (retainedSource)
        return;
      const targetStillExists = Boolean(findNodeByIdInForest(preservedForest, normalizedTargetNodeId));
      collectSyntaxSubtreeNodeIds(findNodeByIdInForest(workspaceRoots, normalizedTargetNodeId)).forEach((nodeId) => {
        if (preserveTargetShell && nodeId === normalizedTargetNodeId)
          return;
        // Remnant and roll-up derivations may reuse canonical descendant
        // ids between the prior source and future landing. When the
        // landing root itself is absent, an id still present in the
        // reconstructed source belongs to that source and stays visible.
        if (!targetStillExists && findNodeByIdInForest(preservedForest, nodeId))
          return;
        inactiveTargetNodeIds.add(nodeId);
      });
    };
    frameRelationSteps
      .map((_relation, relationIndex) => relationIndex)
      .filter((relationIndex) => !activeRelationIndexes.has(relationIndex))
      .forEach((relationIndex) => {
        const placement = relationPlacements.find((candidate) => candidate.relationIndex === relationIndex);
        // A carried chain can still draw a trajectory without owning a
        // new tree transition. Its existing landing must stay visible.
        if (!placement?.renderableTrajectory && !placement?.ownsPhrasalTreeTransition)
          return;
        if (placement?.ownsPhrasalTreeTransition) {
          placement.authoredTargetNodeIds.filter(id => !activeTargetNodeIds.has(id)).forEach(id => addInactiveTargetSubtree(id));
        }
        (singleRelationLinksByIndex.get(relationIndex) || [])
          .filter(isResolvedMovementLink)
          .filter((link) => !activeTargetNodeIds.has(String(link?.targetNodeId || '')))
          .forEach((link) => {
            addInactiveTargetSubtree(String(link?.targetNodeId || ''), isHeadLikeResolvedRelation(link)
              && (!placement?.relation.recoveredMovement
                || Boolean(findNodeByIdInForest(previousFrameWorkspaceRoots, String(link.targetNodeId || '')))));
          });
      });
    return inactiveTargetNodeIds;
  };
  const collectInactivePhrasalLandingHostNodeIds = (activeRelationIndexes: Set<number>): Set<string> => {
    const activeLandingHostNodeIds = new Set(relationPlacements
      .filter((placement) => activeRelationIndexes.has(placement.relationIndex))
      .flatMap(getMovementCreatedLandingHostNodeIds)
      .filter(Boolean));
    return new Set(relationPlacements
      .filter((placement) => !activeRelationIndexes.has(placement.relationIndex))
      .flatMap(getMovementCreatedLandingHostNodeIds)
      .filter((nodeId) => Boolean(nodeId) && !activeLandingHostNodeIds.has(nodeId)));
  };
  const buildActiveRelationLinks = (activeRelationIndexes: Set<number>): ResolvedRelationLink[] => {
    const links: ResolvedRelationLink[] = [...authoredPreviousRelationRelationLinks];
    const seen = new Set(links.map((link) => resolvedRelationLinkKey(link)));
    Array.from(activeRelationIndexes)
      .sort((left, right) => left - right)
      .forEach((relationIndex) => {
        (singleRelationLinksByIndex.get(relationIndex) || []).forEach((link) => {
          const key = resolvedRelationLinkKey(link);
          if (seen.has(key))
            return;
          seen.add(key);
          links.push(link);
        });
      });
    return links;
  };
  const buildSnapshotForActiveRelations = (
    baseStep: PlaybackStep | undefined,
    activeRelationIndexes: Set<number>,
    extraVisibleNodeIds: string[] = []
  ) => {
    const activeFallbackTransitionRelations = frameRelationSteps.filter((_relation, relationIndex) => activeRelationIndexes.has(relationIndex)
      && fallbackTransitionOwnership.has(relationIndex));
    const activeMovementRelations = frameRelationSteps.filter((relation, relationIndex) => activeRelationIndexes.has(relationIndex) && relation.recoveredMovement?.transition);
    const registeredNonMovementTreeTransitionIsActive = Array.from(activeRelationIndexes)
      .some((relationIndex) => (nonMovementTreeTransitionRelationIndexes.has(relationIndex)
        && !fallbackTransitionOwnership.has(relationIndex)));
    const activeTreeTransitionTargetNodeIds = new Set(relationPlacements
      .filter((placement) => activeRelationIndexes.has(placement.relationIndex))
      .filter((placement) => placement.renderableTrajectory || placement.ownsPhrasalTreeTransition)
      .flatMap((placement) => placement.authoredTargetNodeIds)
      .filter(Boolean));
    const pendingMovementNodeIds = new Set(frameRelationSteps.flatMap((relation, relationIndex) => {
      if (activeRelationIndexes.has(relationIndex) || !relation.recoveredMovement?.transition)
        return [];
      return (relation.recoveredMovements ?? [relation.recoveredMovement]).flatMap(movement => [
        ...collectSyntaxSubtreeNodeIds(findExactNodeByIdInForest(previousFrameWorkspaceRoots, movement.priorSourceNodeId)),
        ...[movement.sourceNodeId, movement.targetNodeId].flatMap(nodeId => collectSyntaxSubtreeNodeIds(findExactNodeByIdInForest(workspaceRoots, nodeId)))
      ]);
    }));
    const nonMovementTransitionForest = !frameHasNonMovementTreeTransition
      || registeredNonMovementTreeTransitionIsActive
      ? workspaceRoots
      : buildAnchoredTreeTransitionForest({
        previousForest: previousFrameWorkspaceRoots,
        currentForest: workspaceRoots,
        activeRelations: [...activeFallbackTransitionRelations, ...activeMovementRelations],
        constructedNodeIds: new Set((baseStep?.replayVisibleNodeIds || [])
          .map(nodeId => replayOwnerId(baseStep?.replayCanvasData, nodeId))
          .filter(nodeId => ordinaryStructuralNodeIds.has(nodeId))),
        withheldNodeIds: pendingMovementNodeIds,
        pendingTransitionNodeIds: new Set(Array.from(fallbackTransitionOwnership).flatMap(([relationIndex, ownership]) => activeRelationIndexes.has(relationIndex) ? []
          : [...ownership.priorNodeIds, ...ownership.currentNodeIds])),
        pendingKeptIdLandingNodeIds: new Set([...keptIdLandings].flatMap(([relationIndex, nodeIds]) => activeRelationIndexes.has(relationIndex) ? [] : nodeIds)),
        attachedNodeIds: new Set([...fallbackTransitionOwnership].flatMap(([relationIndex, ownership]) => activeRelationIndexes.has(relationIndex)
          ? (ownership.attachments ?? []).map(attachment => attachment.host) : [])),
        heldAttachmentNodeIds: new Set(heldAttachmentNodeIds())
      });
    let snapshotWorkspaceRoots = buildPreMovementStructuralForest(nonMovementTransitionForest, frameRelationSteps.flatMap((relation, relationIndex) => {
      if (activeRelationIndexes.has(relationIndex))
        return [];
      return movementLandingGroups(relation).flatMap(group => {
        const targetId = group.recoveredMovement?.targetNodeId || relationPlacements.find(placement => placement.relationIndex === relationIndex)?.authoredTargetNodeIds[0];
        if (!activeTreeTransitionTargetNodeIds.has(targetId || '')) return [group];
        return group.recoveredMovement?.transition ? [{ ...group, preserveMovementLanding: true }] : [];
      });
    }), previousFrameWorkspaceRoots);
    relationPlacements
      .filter(placement => !activeRelationIndexes.has(placement.relationIndex))
      .forEach(placement => {
        placement.authoredTargetNodeIds.forEach(targetId => {
          const kind = (placement.relation.recoveredMovements?.find(movement => movement.targetNodeId === targetId) ?? placement.relation.recoveredMovement)?.trajectoryKind || registeredTrajectoryDisplayKind(placement.relationLabel, placement.relation.resolvedAnchors);
          if (kind !== 'phrasal') return;
          const wrapper = movementLandingWrapper(workspaceRoots, previousFrameWorkspaceRoots, targetId);
          if (!wrapper)
            return;
          const parent = findNodeByIdInForest(snapshotWorkspaceRoots, wrapper.parentId);
          const wrappedChild = parent?.children?.find(child => child.id === wrapper.wrapperId);
          if (parent && wrappedChild)
            parent.children = wrappedChild.children || [];
        });
      });
    // Copy construction and realization may share a completed stage. Preserve
    // the prior lexical fields until the later authored realization owns them.
    const retainPendingPronunciation = (nodeId: string, priorNodeId: string, ownerIndex: number, receivingHead = false) => {
      const realizationIndex = frameRelationSteps.findIndex((relation, relationIndex) => relationIndex > ownerIndex && relation.pronunciationNodeIds?.includes(nodeId));
      if (realizationIndex < 0 || activeRelationIndexes.has(realizationIndex))
        return;
      const prior = findExactNodeByIdInForest(previousFrameWorkspaceRoots, priorNodeId);
      const current = findExactNodeByIdInForest(snapshotWorkspaceRoots, nodeId);
      if (!prior || !current || prior.children?.length || !receivingHead && current.children?.length)
        return;
      if (prior.word === current.word && prior.tokenIndex === current.tokenIndex)
        return;
      if (prior.word === undefined)
        delete current.word;
      else
        current.word = prior.word;
      if (prior.tokenIndex === undefined)
        delete current.tokenIndex;
      else
        current.tokenIndex = prior.tokenIndex;
    };
    // A copied phrase continues its earlier occurrence position by position.
    // Until the claim that owns a node's pronunciation (by naming it or an
    // ancestor) reaches its moment, each node shows its exact counterpart's
    // pronunciation state: word, input address and silence on terminals, and
    // silence above them. Without an exact counterpart it shows none.
    const retainCopiedPronunciation = (nodeId: string, priorNodeId: string | null, ownerIndex: number) => {
      const pending = (id: string): boolean => {
        const named = new Set([id]);
        for (let parentId = findParentNodeIdInForest(workspaceRoots, id); parentId; parentId = findParentNodeIdInForest(workspaceRoots, parentId))
          named.add(parentId);
        const owner = frameRelationSteps.findIndex((relation, relationIndex) => relationIndex > ownerIndex
          && relation.pronunciationNodeIds?.some(named.has, named));
        return owner >= 0 && !activeRelationIndexes.has(owner);
      };
      const restore = (id: string, prior: SyntaxNode | null, keys: readonly ('word' | 'tokenIndex' | 'silent')[]) => {
        const current = findExactNodeByIdInForest(snapshotWorkspaceRoots, id) as unknown as Record<string, unknown> | null;
        keys.forEach(key => {
          if (current && prior?.[key] === undefined)
            delete current[key];
          else if (current)
            current[key] = prior![key];
        });
      };
      const walk = (node: SyntaxNode, prior: SyntaxNode | null): void => {
        const terminal = !node.children?.length, exact = prior && Boolean(prior.children?.length) !== terminal ? prior : null;
        if (pending(node.id))
          restore(node.id, exact, terminal ? ['word', 'tokenIndex', 'silent'] : ['silent']);
        const aligned = exact && exact.children?.length === node.children?.length ? exact.children! : null;
        (node.children || []).forEach((child, childIndex) => walk(child, aligned ? aligned[childIndex] : null));
      };
      const node = findExactNodeByIdInForest(workspaceRoots, nodeId);
      if (node)
        walk(node, priorNodeId === null ? null : findExactNodeByIdInForest(previousFrameWorkspaceRoots, priorNodeId) ?? null);
    };
    frameRelationSteps.forEach((movementRelation, movementIndex) => {
      (movementRelation.recoveredMovements ?? [movementRelation.recoveredMovement]).forEach(movement => {
        if (!movement?.transition || movement.trajectoryKind !== 'head'
          || !activeRelationIndexes.has(movementIndex))
          return;
        const receivingId = receivingHeadMaterialNodeId(movement, previousFrameWorkspaceRoots, workspaceRoots);
        [movement.targetNodeId, ...(receivingId ? [receivingId] : [])].forEach(nodeId => {
          retainPendingPronunciation(nodeId, nodeId === receivingId ? nodeId : movement.priorSourceNodeId, movementIndex, nodeId === receivingId);
        });
      });
    });
    fallbackTransitionOwnership.forEach((ownership, relationIndex) => {
      if (!activeRelationIndexes.has(relationIndex))
        return;
      ownership.copyPairs?.forEach(pair => retainCopiedPronunciation(pair.targetNodeId, pair.priorSourceNodeId, relationIndex));
      ownership.ambiguousCopyNodeIds?.forEach(nodeId => retainCopiedPronunciation(nodeId, null, relationIndex));
    });
    if (baseStep?.replayPendingAttachmentNodeIds) {
      // An active relation that owns a structural change makes its new nodes
      // current at this moment, so their edges cannot wait for a later step.
      const activeTransitionNodeIds = [...Array.from(fallbackTransitionOwnership)
        .flatMap(([relationIndex, ownership]) => activeRelationIndexes.has(relationIndex) ? [...ownership.currentNodeIds] : []),
      ...[...transitionHostNodeIds].flatMap(([nodeId, relationIndex]) => activeRelationIndexes.has(relationIndex) ? [nodeId] : [])];
      snapshotWorkspaceRoots = preserveConstructionAttachments(snapshotWorkspaceRoots, previousFrameWorkspaceRoots, new Set(baseStep.replayPendingAttachmentNodeIds), new Set([...(baseStep.replayVisibleNodeIds || []), ...extraVisibleNodeIds, ...activeTransitionNodeIds]));
    }
    const activeRelationLinks = buildActiveRelationLinks(activeRelationIndexes);
    const baseVisibleNodeIds = Array.isArray(baseStep?.replayVisibleNodeIds)
      ? baseStep.replayVisibleNodeIds
      : [];
    const fullFrameVisibleNodeIds = frameIsPureVisualTrajectoryStage
      ? Array.from(currentFrameVisibleNodeIds)
      : [];
    const activeRelationVisibleNodeIds = Array.from(activeRelationIndexes)
      .sort((left, right) => left - right)
      .flatMap((relationIndex) => relationVisibleNodeIdsByIndex.get(relationIndex) || []);
    const requestedVisibleNodeIds = new Set([
      ...baseVisibleNodeIds,
      ...fullFrameVisibleNodeIds,
      ...activeRelationVisibleNodeIds,
      ...extraVisibleNodeIds
    ].filter(Boolean));
    if (frameHasNonMovementTreeTransition
      && (registeredNonMovementTreeTransitionIsActive || activeFallbackTransitionRelations.length > 0)) {
      snapshotWorkspaceRoots.flatMap(collectSyntaxSubtreeNodeIds)
        .forEach(nodeId => requestedVisibleNodeIds.add(nodeId));
    }
    const inactiveTrajectoryTargetNodeIds = collectInactiveTrajectoryTargetNodeIds(activeRelationIndexes, snapshotWorkspaceRoots);
    inactiveTrajectoryTargetNodeIds.forEach((nodeId) => requestedVisibleNodeIds.delete(nodeId));
    const inactivePhrasalLandingHostNodeIds = collectInactivePhrasalLandingHostNodeIds(activeRelationIndexes);
    inactivePhrasalLandingHostNodeIds.forEach((nodeId) => requestedVisibleNodeIds.delete(nodeId));
    const requestedLayoutNodeIds = new Set([
      ...requestedVisibleNodeIds,
      ...collectSyntaxSubtreeNodeIds(baseStep?.replayCanvasData),
      ...relationLayoutNodeIds
    ].filter(Boolean));
    activeRelationLinks.filter(isResolvedMovementLink).forEach((link) => {
      [
        String(link?.sourceNodeId || ''),
        String(link?.targetNodeId || ''),
        String(link?.witnessNodeId || '')
      ].filter(Boolean).forEach((nodeId) => {
        collectSyntaxSubtreeNodeIds(findNodeByIdInForest(workspaceRoots, nodeId)).forEach((subtreeNodeId) => {
          requestedVisibleNodeIds.add(subtreeNodeId);
          requestedLayoutNodeIds.add(subtreeNodeId);
        });
        requestedVisibleNodeIds.add(nodeId);
        requestedLayoutNodeIds.add(nodeId);
        if (isHeadLikeResolvedRelation(link)) {
          requestedVisibleNodeIds.add(identity.allocate(`${nodeId}::__leaf`, { kind: 'word', ownerId: nodeId }));
          requestedLayoutNodeIds.add(identity.allocate(`${nodeId}::__leaf`, { kind: 'word', ownerId: nodeId }));
        }
      });
    });
    // Attachments held for construction stay held under the scaffold too.
    const activeFutureLayoutScaffold = buildFrameLayoutScaffold(snapshotWorkspaceRoots,
      new Set(baseStep?.replayPendingAttachmentNodeIds ?? []));
    const snapshotForest = buildDerivationReplaySnapshot({
      forest: snapshotWorkspaceRoots,
      activeFrameIndex: index,
      relationLinks: activeRelationLinks,
      visibleNodeIds: requestedVisibleNodeIds,
      layoutNodeIds: requestedLayoutNodeIds,
      derivationFrames: frames,
      layoutScaffoldForest: activeFutureLayoutScaffold,
      identity
    });
    return {
      ...snapshotForest,
      usesFutureLayoutScaffold: Boolean(activeFutureLayoutScaffold),
      visibleNodeIds: snapshotForest.visibleNodeIds.filter((nodeId) => !inactiveTrajectoryTargetNodeIds.has(replayOwnerId(snapshotForest.canvasData, String(nodeId || '')))
        && !inactivePhrasalLandingHostNodeIds.has(replayOwnerId(snapshotForest.canvasData, String(nodeId || '')))),
      activeRelationLinks,
      inactiveTrajectoryTargetNodeIds,
      inactivePhrasalLandingHostNodeIds
    };
  };
  const rebuildStructuralStepForActiveRelations = (step: PlaybackStep, activeRelationIndexes: Set<number>): PlaybackStep => {
    if (activeRelationIndexes.size === 0
      && relationLayoutNodeIds.length === 0
      && !frameHasTreeTransition) {
      return step;
    }
    const snapshot = buildSnapshotForActiveRelations(step, activeRelationIndexes);
    const inactiveTrajectoryTargetNodeIds = snapshot.inactiveTrajectoryTargetNodeIds;
    const inactivePhrasalLandingHostNodeIds = snapshot.inactivePhrasalLandingHostNodeIds;
    const suppressedInactiveTrajectoryNodeIds = new Set(inactiveTrajectoryTargetNodeIds);
    inactiveTrajectoryTargetNodeIds.forEach((nodeId) => {
      collectSyntaxSubtreeNodeIds(findNodeByIdInForest(step.replayCanvasData ? [step.replayCanvasData] : [], nodeId)).forEach((subtreeNodeId) => suppressedInactiveTrajectoryNodeIds.add(subtreeNodeId));
    });
    inactivePhrasalLandingHostNodeIds.forEach((nodeId) => {
      suppressedInactiveTrajectoryNodeIds.add(nodeId);
    });
    return {
      ...step,
      replayCanvasData: snapshot.canvasData,
      replayVisibleNodeIds: snapshot.visibleNodeIds,
      replayRelationLinks: snapshot.relationLinks,
      replayUsesFutureLayoutScaffold: snapshot.usesFutureLayoutScaffold,
      replaySuppressAutoRevealNodeIds: Array.from(new Set([
        ...(Array.isArray(step.replaySuppressAutoRevealNodeIds)
          ? step.replaySuppressAutoRevealNodeIds
          : []),
        ...suppressedInactiveTrajectoryNodeIds
      ]))
    };
  };
  const buildRelationPlaybackStep = (
    placement: RelationPlacement,
    activeRelationIndexes: Set<number>,
    baseStep?: PlaybackStep
  ): PlaybackStep => {
    const extraVisibleNodeIds = relationVisibleNodeIdsByIndex.get(placement.relationIndex) || [];
    const relationReplaySnapshot = buildSnapshotForActiveRelations(baseStep, activeRelationIndexes, extraVisibleNodeIds);
    const resolvedTargetNodeId = placement.authoredTargetNodeIds[0]
      || placement.relationAnchorNodeIds[0]
      || frameSemanticStep.targetNodeId;
    const resolvedSourceNodeIds = placement.renderableTrajectory
      ? placement.sourceNodeIds
      : placement.relationAnchorNodeIds.filter((nodeId) => nodeId !== resolvedTargetNodeId);
    const neutralOwnership = fallbackTransitionOwnership.get(placement.relationIndex);
    const authoredRelationIndex = Number.isInteger(placement.relation.authoredRelationIndex)
      ? placement.relation.authoredRelationIndex : placement.relationIndex;
    return {
      ...frameSemanticStep,
      ...(neutralOwnership ? {
        replayTreeTransition: {
          relationKey: `${index}:${authoredRelationIndex}`,
          currentNodeIds: [...neutralOwnership.currentNodeIds],
          priorNodeIds: [...neutralOwnership.priorNodeIds],
          ...(neutralOwnership.attachments?.some(attachment => attachment.retained) ? {
            attachments: neutralOwnership.attachments.filter(attachment => attachment.retained)
              .map(({ host, wrapper }) => ({ host, wrapper }))
          } : {})
        }
      } : {}),
      operation: placement.relationLabel as DerivationOperation,
      replayKind: 'relation',
      replayRelationIdentity: {
        stageIndex: index,
        relationIndex: Number.isInteger(placement.relation.authoredRelationIndex)
          ? placement.relation.authoredRelationIndex
          : placement.relationIndex
      },
      targetNodeId: resolvedTargetNodeId || frameSemanticStep.targetNodeId,
      targetLabel: getReplayNodeOvertYieldFromCanvas(relationReplaySnapshot.canvasData, resolvedTargetNodeId)
        || getReplayNodeDisplayFromCanvas(relationReplaySnapshot.canvasData, resolvedTargetNodeId)
        || getReplayNodeCategoryFromCanvas(relationReplaySnapshot.canvasData, resolvedTargetNodeId)
        || placement.relationLabel,
      sourceNodeIds: resolvedSourceNodeIds.length > 0
        ? resolvedSourceNodeIds
        : frameSemanticStep.sourceNodeIds,
      sourceLabels: resolvedSourceNodeIds
        .map((nodeId) => getReplayNodeOvertYieldFromCanvas(relationReplaySnapshot.canvasData, nodeId)
          || getReplayNodeDisplayFromCanvas(relationReplaySnapshot.canvasData, nodeId)
          || getReplayNodeCategoryFromCanvas(relationReplaySnapshot.canvasData, nodeId))
        .filter(Boolean),
      recipe: placement.relationLabel,
      movementDiagnostics: placement.relation.movementDiagnostics,
      note: undefined,
      preserveReplayStep: true,
      stageRecord: getFrameStageRecordText(frame, plannedStage),
      detailBlocks: mergeReplayDetailBlocks(buildRelationReplayBlocks([placement.relation], relationReplaySnapshot.canvasData), placement.relation.relationContractFailure ? [{
        title: 'Relation diagnostic',
        lines: placement.relation.relationContractFailure.issues.map(issue => issue.message)
      }] : undefined),
      replayCanvasData: relationReplaySnapshot.canvasData,
      replayVisibleNodeIds: relationReplaySnapshot.visibleNodeIds,
      replayRelationLinks: relationReplaySnapshot.relationLinks,
      replayUsesFutureLayoutScaffold: relationReplaySnapshot.usesFutureLayoutScaffold,
      replayPendingAttachmentNodeIds: baseStep?.replayPendingAttachmentNodeIds
    } satisfies PlaybackStep;
  };
  return { rebuildStructuralStepForActiveRelations, buildRelationPlaybackStep };
};
