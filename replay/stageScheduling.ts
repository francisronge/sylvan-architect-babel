/** Interleave bottom-up construction with authored relation moments and one completed Stage Record. */
import { type DerivationOperation, type SyntaxNode } from '../types.ts';
import type { ReplayCompilation } from './compilationContext.ts';
import { constructionAttachmentUpdates } from './constructionAttachments.ts';
import { replayOwnerId } from './displayIdentity.ts';
import {
  buildReplayProgressLabel,
  buildStructuralReplayFallback,
  stripSemanticPayloadFromMicrostep
} from './playbackFormatting.ts';
import {
  getRelationAllAnchorNodeIds,
  relationAnchorNodeIds,
  resolveRelationAnchorNodeId
} from './relationAnchors.ts';
import { buildRenderableCommittedCanvasData } from './replayCanvas.ts';
import { mergeReplayDetailBlocks } from './replayPanelFormatting.ts';
import type { ReplayStageContext } from './stageContext.ts';
import { planStageRelations, type RelationPlacement } from './stageRelationPlan.ts';
import { createStageRelationSnapshots } from './stageRelationSnapshot.ts';
import {
  collectSyntaxSubtreeNodeIds,
  findExactNodeByIdInForest,
  findNodeByIdInForest,
  findParentNodeIdInForest,
  indexExactForestNodeLocations
} from './syntaxForest.ts';
import { keptIdLandingNodeIds, newReceivingHeadNodeIds } from './treeTransitions.ts';
import { type PlaybackStep } from './types.ts';

export const finalizeStageReplay = (
  compilation: ReplayCompilation,
  stage: ReplayStageContext,
  steps: PlaybackStep[]
): PlaybackStep[] => {
  const { plannedStageCount } = compilation;
  const {
    index,
    plannedStage,
    frameHasNonMovementTreeTransition,
    frameHasMovementPayload,
    frameRelationSteps,
    nonMovementTransitionNodeIds,
    workspaceRoots,
    previousFrameWorkspaceRoots,
    priorVisibleNodeIds,
    structuralWorkspaceRoots,
    frameSemanticStep,
    fallbackTransitionOwnership,
    frameReplaySnapshot,
    frameStageRecordBlocks,
    futureLayoutScaffold,
    frameCarriesAuthoredEffect
  } = stage;
  let structuralSteps = steps.map(stripSemanticPayloadFromMicrostep);
  if (plannedStage) {
    // The new parent of each kept-id landing, by the neutral rewrite whose moment introduces it.
    const transitionHostNodeIds = new Map<string, number>();
    if (frameHasNonMovementTreeTransition && !frameHasMovementPayload
      && !frameRelationSteps.some(relation => relation.recoveredMovement?.transition)) {
      const transitionNodeIds = new Set([...nonMovementTransitionNodeIds.values()].flatMap(ids => [...ids]));
      const prerequisiteIds = new Set(frameRelationSteps.flatMap(relation => getRelationAllAnchorNodeIds(relation)
        .filter(nodeId => !transitionNodeIds.has(nodeId))
        .flatMap(nodeId => collectSyntaxSubtreeNodeIds(findExactNodeByIdInForest(workspaceRoots, nodeId)))));
      const priorLocations = indexExactForestNodeLocations(previousFrameWorkspaceRoots);
      const currentLocations = indexExactForestNodeLocations(workspaceRoots);
      // A rewritten output may need a new parent above existing syntax. Build
      // that parent's other material first, as a recovered movement builds its
      // landing host; the parent itself appears with the output.
      transitionNodeIds.forEach((nodeId) => {
        const parentId = findParentNodeIdInForest(workspaceRoots, nodeId);
        if (!parentId || transitionNodeIds.has(parentId) || priorLocations.has(parentId))
          return;
        (findExactNodeByIdInForest(workspaceRoots, parentId)?.children || [])
          .filter(child => !transitionNodeIds.has(String(child.id || '')))
          .forEach(child => collectSyntaxSubtreeNodeIds(child).forEach(id => prerequisiteIds.add(id)));
      });
      // That holds when a claim names the parent of an occurrence that kept its
      // id at the landing, unless an earlier claim needs the parent as context.
      const anchoredBefore = (relationIndex: number, nodeId: string) => frameRelationSteps.slice(0, relationIndex)
        .some(relation => getRelationAllAnchorNodeIds(relation).some(id => collectSyntaxSubtreeNodeIds(findExactNodeByIdInForest(workspaceRoots, id)).includes(nodeId)));
      fallbackTransitionOwnership.forEach((ownership, relationIndex) => keptIdLandingNodeIds(ownership, previousFrameWorkspaceRoots, workspaceRoots)
        .forEach((nodeId) => {
          const parentId = findParentNodeIdInForest(workspaceRoots, nodeId);
          if (parentId && !transitionNodeIds.has(parentId) && !priorLocations.has(parentId)
            && !transitionHostNodeIds.has(parentId) && !anchoredBefore(relationIndex, parentId))
            transitionHostNodeIds.set(parentId, relationIndex);
        }));
      transitionHostNodeIds.forEach((_relationIndex, nodeId) => prerequisiteIds.delete(nodeId));
      // A higher merge of that parent stays ordinary construction after the moment.
      const availableContextIds = new Set([...previousFrameWorkspaceRoots.flatMap(collectSyntaxSubtreeNodeIds)
        .filter(nodeId => {
          if (!transitionNodeIds.has(nodeId))
            return true;
          const before = priorLocations.get(nodeId), after = currentLocations.get(nodeId);
          return Boolean(before && after && before.parentId === after.parentId
            && (!before.parentId || before.childIndex === after.childIndex));
        }), ...transitionHostNodeIds.keys()]);
      // A later rewrite can change an existing operand's fields without
      // owning new ordinary merges around it. Keep that construction, but
      // do not merge a new relation-owned output before its own moment.
      structuralSteps = structuralSteps.filter(step => {
        const nodeId = replayOwnerId(step.replayCanvasData, step.targetNodeId);
        if (transitionNodeIds.has(nodeId) || transitionHostNodeIds.has(nodeId))
          return false;
        const sources = (step.sourceNodeIds || []).map(id => replayOwnerId(step.replayCanvasData, id));
        const buildsAvailableContext = sources.length > 0
          && sources.every(id => availableContextIds.has(id));
        if (!prerequisiteIds.has(nodeId) && !buildsAvailableContext)
          return false;
        availableContextIds.add(nodeId);
        return true;
      });
    }
    const placements = planStageRelations(compilation, stage);
    const { relationPlacements, getMovementCreatedLandingHostNodeIds, getMovementCreatedLandingHostPaths } = placements;
    const shouldFoldStructuralStepIntoRelationFrame = (step: PlaybackStep): boolean => {
      const operation = String(step.operation || '').trim();
      if (!['LexicalSelect', 'Project', 'ExternalMerge'].includes(operation))
        return false;
      const stepTargetNodeId = replayOwnerId(step.replayCanvasData, String(step.targetNodeId || ''));
      if (!stepTargetNodeId)
        return false;
      return relationPlacements.some((placement) => {
        // Neutral transitions own their new structure just as recovered
        // movements do; emitting it separately can leave an empty step.
        if (!priorVisibleNodeIds.has(String(step.targetNodeId || ''))
          && nonMovementTransitionNodeIds.get(placement.relationIndex)?.has(stepTargetNodeId)) {
          return true;
        }
        if (!placement.renderableTrajectory && !placement.ownsPhrasalTreeTransition)
          return false;
        if ((placement.relation.recoveredMovements ?? [placement.relation.recoveredMovement]).flatMap(movement => newReceivingHeadNodeIds(movement, previousFrameWorkspaceRoots, workspaceRoots)).includes(stepTargetNodeId))
          return true;
        const relationTargetSubtreeIds = new Set(placement.authoredTargetNodeIds.flatMap(id => collectSyntaxSubtreeNodeIds(findNodeByIdInForest(workspaceRoots, id))));
        if (relationTargetSubtreeIds.has(stepTargetNodeId))
          return true;
        // The new attachment belongs to movement, not a later merge of
        // a temporarily detached landing complex.
        return getMovementCreatedLandingHostNodeIds(placement).includes(stepTargetNodeId);
      });
    };
    /*
     * Structural construction remains bottom-up, but Internal Merge owns
     * a landing host that did not exist in the preceding authored stage.
     * Play that relation after its lower source is complete and before the
     * first higher projection consumes the new host. Otherwise Replay
     * exposes a false hanging ancestor whose missing child is licensed only
     * by a later movement frame.
     */
    const activeRelationIndexes = new Set<number>();
    const normalizeWithheldLandingHostStep = (step: PlaybackStep): PlaybackStep => {
      const stepTargetNodeId = replayOwnerId(step.replayCanvasData, String(step.targetNodeId || ''));
      if (!stepTargetNodeId)
        return step;
      const withheldLandingNodeIds = new Set(relationPlacements
        .filter((placement) => placement.renderableTrajectory || placement.ownsPhrasalTreeTransition)
        .flatMap((placement) => placement.authoredTargetNodeIds.filter(id => findParentNodeIdInForest(workspaceRoots, id) === stepTargetNodeId))
        .filter(Boolean));
      if (withheldLandingNodeIds.size === 0)
        return step;
      const sourceNodeIds = Array.isArray(step.sourceNodeIds) ? step.sourceNodeIds : [];
      const sourceLabels = Array.isArray(step.sourceLabels) ? step.sourceLabels : [];
      const retainedSources = sourceNodeIds
        .map((nodeId, sourceIndex) => ({ nodeId, label: sourceLabels[sourceIndex] || '' }))
        .filter(({ nodeId }) => !withheldLandingNodeIds.has(nodeId));
      if (retainedSources.length === sourceNodeIds.length || retainedSources.length === 0)
        return step;
      const operation: DerivationOperation = retainedSources.length === 1
        ? 'Project'
        : 'ExternalMerge';
      const retainedLabels = retainedSources.map(({ label }) => label).filter(Boolean);
      return {
        ...step,
        operation,
        sourceNodeIds: retainedSources.map(({ nodeId }) => nodeId),
        sourceLabels: retainedLabels,
        recipe: buildStructuralReplayFallback(operation, String(step.targetLabel || '').trim(), retainedLabels)
      };
    };
    let precedingStructuralVisibleNodeIds = new Set(stage.currentFrameVisibleNodeIds);
    const structuralStepEntries = structuralSteps.map((step) => {
      const visibleNodeIds = new Set((Array.isArray(step.replayVisibleNodeIds) ? step.replayVisibleNodeIds : [])
        .map((nodeId) => String(nodeId || ''))
        .filter(Boolean));
      const introducedVisibleNodeIds = Array.from(visibleNodeIds)
        .filter((nodeId) => !precedingStructuralVisibleNodeIds.has(nodeId));
      precedingStructuralVisibleNodeIds = visibleNodeIds;
      return { step, introducedVisibleNodeIds };
    });
    let pendingStructuralStepEntries = structuralStepEntries
      .filter(({ step }) => !shouldFoldStructuralStepIntoRelationFrame(step))
      .map((entry) => ({
        ...entry,
        step: normalizeWithheldLandingHostStep(entry.step)
      }));
    const movementCreatedLandingHosts = [...new Set(relationPlacements.flatMap(placement => getMovementCreatedLandingHostPaths(placement).map(path => path.at(-1)!)))];
    const movementPrerequisiteNodeIds = new Set<string>();
    if (movementCreatedLandingHosts.length === 1) {
      const landingHostNodeId = movementCreatedLandingHosts[0];
      const landingPlacements = relationPlacements.filter((placement) => getMovementCreatedLandingHostPaths(placement).some(path => path.at(-1) === landingHostNodeId));
      const landingHostIds = new Set(landingPlacements.flatMap(getMovementCreatedLandingHostNodeIds));
      const landingTargetNodeIds = new Set(landingPlacements
        .flatMap((placement) => placement.authoredTargetNodeIds)
        .filter(Boolean));
      const addSubtree = (nodeId: string) => {
        collectSyntaxSubtreeNodeIds(findNodeByIdInForest(workspaceRoots, nodeId))
          .forEach((subtreeNodeId) => movementPrerequisiteNodeIds.add(subtreeNodeId));
      };
      Array.from(landingHostIds)
        .flatMap(nodeId => findNodeByIdInForest(workspaceRoots, nodeId)?.children || [])
        .map((child) => String(child?.id || ''))
        .filter((childNodeId) => Boolean(childNodeId) && !landingTargetNodeIds.has(childNodeId) && !landingHostIds.has(childNodeId))
        .forEach(addSubtree);
      landingPlacements.forEach((placement) => {
        placement.sourceNodeIds.forEach(addSubtree);
        getRelationAllAnchorNodeIds(placement.relation)
          .map((nodeId) => resolveRelationAnchorNodeId(workspaceRoots, nodeId))
          .filter(Boolean)
          .filter((nodeId) => !landingTargetNodeIds.has(nodeId))
          .filter((nodeId) => !placement.sourceNodeIds.includes(nodeId))
          .filter((nodeId) => !collectSyntaxSubtreeNodeIds(findNodeByIdInForest(workspaceRoots, nodeId)).some(id => landingHostIds.has(id)))
          .forEach(addSubtree);
      });
      const beforeMovement: typeof pendingStructuralStepEntries = [];
      const afterMovement: typeof pendingStructuralStepEntries = [];
      pendingStructuralStepEntries.forEach((entry) => {
        const stepTargetNodeId = replayOwnerId(entry.step.replayCanvasData, String(entry.step.targetNodeId || ''));
        (movementPrerequisiteNodeIds.has(stepTargetNodeId) ? beforeMovement : afterMovement).push(entry);
      });
      const deferredVisibleNodeIds = new Set(afterMovement.flatMap((entry) => entry.introducedVisibleNodeIds));
      const deferredStructuralTargetNodeIds = new Set(afterMovement
        .map((entry) => replayOwnerId(entry.step.replayCanvasData, String(entry.step.targetNodeId || '')))
        .filter(Boolean));
      const scrubDeferredVisibility = (entry: (typeof beforeMovement)[number]) => ({
        ...entry,
        step: {
          ...entry.step,
          replayVisibleNodeIds: (Array.isArray(entry.step.replayVisibleNodeIds)
            ? entry.step.replayVisibleNodeIds
            : []).filter((nodeId) => {
              const normalizedNodeId = String(nodeId || '');
              return !deferredVisibleNodeIds.has(normalizedNodeId)
                && !deferredStructuralTargetNodeIds.has(replayOwnerId(entry.step.replayCanvasData, normalizedNodeId));
            })
        }
      });
      pendingStructuralStepEntries = [
        ...beforeMovement.map(scrubDeferredVisibility),
        ...afterMovement
      ];
    }
    const pendingStructuralSteps = pendingStructuralStepEntries.map((entry) => entry.step);
    const ordinaryStructuralNodeIds = new Set<string>();
    pendingStructuralSteps.forEach(step => {
      const nodeId = replayOwnerId(step.replayCanvasData, step.targetNodeId);
      ordinaryStructuralNodeIds.add(nodeId);
      (findExactNodeByIdInForest(workspaceRoots, nodeId)?.children || [])
        .filter(child => findExactNodeByIdInForest(previousFrameWorkspaceRoots, child.id))
        .forEach(child => ordinaryStructuralNodeIds.add(child.id));
    });
    const { rebuildStructuralStepForActiveRelations, buildRelationPlaybackStep } = createStageRelationSnapshots(
      compilation, stage, placements, ordinaryStructuralNodeIds
    );
    const relationInsertionIndex = (placement: NonNullable<RelationPlacement>): number => {
      const landingHostNodeIds = getMovementCreatedLandingHostPaths(placement).map(path => path.at(-1)!);
      if (!landingHostNodeIds.length)
        return pendingStructuralSteps.length;
      if (movementCreatedLandingHosts.length === 1) {
        const firstNonPrerequisiteIndex = pendingStructuralSteps.findIndex((step) => {
          const stepTargetNodeId = replayOwnerId(step.replayCanvasData, String(step.targetNodeId || ''));
          return !movementPrerequisiteNodeIds.has(stepTargetNodeId);
        });
        return firstNonPrerequisiteIndex >= 0
          ? firstNonPrerequisiteIndex
          : pendingStructuralSteps.length;
      }
      const firstHigherProjectionIndex = pendingStructuralSteps.findIndex((step) => {
        const stepTargetNodeId = replayOwnerId(step.replayCanvasData, String(step.targetNodeId || ''));
        if (!stepTargetNodeId)
          return false;
        return landingHostNodeIds.some(id => collectSyntaxSubtreeNodeIds(findNodeByIdInForest(workspaceRoots, stepTargetNodeId)).includes(id));
      });
      return firstHigherProjectionIndex >= 0
        ? firstHigherProjectionIndex
        : pendingStructuralSteps.length;
    };
    const scheduledRelationPlacements = relationPlacements
      .map((placement) => ({
        placement,
        insertionIndex: relationInsertionIndex(placement)
      }))
      .sort((left, right) => left.insertionIndex === right.insertionIndex
        ? left.placement.relationIndex - right.placement.relationIndex
        : left.insertionIndex - right.insertionIndex);
    const stagePlaybackSteps: PlaybackStep[] = [];
    const availableNodeIds = new Set(previousFrameWorkspaceRoots.flatMap(root => collectSyntaxSubtreeNodeIds(buildRenderableCommittedCanvasData(root))));
    const structuralProducers = new Map(pendingStructuralSteps.map((step, stepIndex) => [step.targetNodeId, stepIndex]));
    const relationProducers = new Map<string, number>();
    relationPlacements.forEach((placement) => {
      const ownedIds = placement.renderableTrajectory || placement.ownsPhrasalTreeTransition
        ? [
          ...[...placement.authoredTargetNodeIds, ...placement.sourceNodeIds].flatMap(nodeId => collectSyntaxSubtreeNodeIds(findNodeByIdInForest(workspaceRoots, nodeId)))
            .filter(nodeId => !findExactNodeByIdInForest(structuralWorkspaceRoots, nodeId)),
          ...getMovementCreatedLandingHostNodeIds(placement),
          ...(placement.relation.recoveredMovements ?? [placement.relation.recoveredMovement]).flatMap(movement => newReceivingHeadNodeIds(movement, previousFrameWorkspaceRoots, workspaceRoots))
        ]
        : [...(nonMovementTransitionNodeIds.get(placement.relationIndex) || []),
          ...[...transitionHostNodeIds].filter(([, relationIndex]) => relationIndex === placement.relationIndex).map(([nodeId]) => nodeId)];
      ownedIds.filter(nodeId => !availableNodeIds.has(nodeId)).forEach(nodeId => {
        const existingOwner = relationProducers.get(nodeId);
        // Proven movement owns both new occurrences. A contextual claim
        // may mention either copy, but cannot steal its construction.
        if (existingOwner === undefined || (placement.relation.recoveredMovement?.transition
          && !frameRelationSteps[existingOwner].recoveredMovement?.transition)) {
          relationProducers.set(nodeId, placement.relationIndex);
        }
      });
    });
    const emittedStructuralSteps = new Set<number>();
    const visitingStructuralSteps = new Set<number>();
    let nextRelation = 0;
    const withPendingStructureHidden = (step: PlaybackStep): PlaybackStep => {
      const pendingIds = new Set([
        ...structuralProducers.keys(),
        ...relationProducers.keys()
      ].filter(nodeId => !availableNodeIds.has(nodeId)));
      // A relation-owned occurrence appears whole at its moment. Its derived
      // word leaf exists only on the canvas, so it waits with its owner.
      const waitingOwners = new Set([...relationProducers.keys()].filter(nodeId => pendingIds.has(nodeId)));
      const hideWaitingWords = (node: SyntaxNode) => (node.children || []).forEach((child) => {
        const owner = String(child.replayOrigin?.ownerId || node.id || '');
        if (child.replayOrigin?.kind === 'word' && waitingOwners.has(owner) && child.id !== step.targetNodeId)
          pendingIds.add(String(child.id || ''));
        hideWaitingWords(child);
      });
      if (waitingOwners.size && step.replayCanvasData)
        hideWaitingWords(step.replayCanvasData);
      return {
        ...step,
        replayVisibleNodeIds: (step.replayVisibleNodeIds || []).filter(nodeId => !pendingIds.has(nodeId)),
        replaySuppressAutoRevealNodeIds: Array.from(new Set([
          ...(step.replaySuppressAutoRevealNodeIds || []),
          ...pendingIds
        ]))
      };
    };
    // Preferred insertion positions control presentation, never authored
    // relation order. A prerequisite may pull independent tree-building
    // forward, but may not activate a later relation to satisfy an earlier one.
    const ensureNodeAvailable = (nodeId: string, forRelation?: number): string[] => {
      const structuralProducer = structuralProducers.get(nodeId);
      // Retaining an occurrence does not establish its new child attachment.
      if (availableNodeIds.has(nodeId)
        && (structuralProducer === undefined || emittedStructuralSteps.has(structuralProducer)))
        return [];
      const relationProducer = relationProducers.get(nodeId);
      if (relationProducer !== undefined) {
        if (forRelation !== undefined && relationProducer >= forRelation)
          return [nodeId];
        emitRelationsThrough(relationProducer);
        return availableNodeIds.has(nodeId) ? [] : [nodeId];
      }
      return structuralProducer === undefined ? [] : emitStructuralStep(structuralProducer, forRelation);
    };
    const emitStructuralStep = (stepIndex: number, forRelation?: number): string[] => {
      if (emittedStructuralSteps.has(stepIndex))
        return [];
      const step = pendingStructuralSteps[stepIndex];
      if (visitingStructuralSteps.has(stepIndex))
        return [step.targetNodeId];
      visitingStructuralSteps.add(stepIndex);
      const missing = (step.sourceNodeIds || [])
        .filter(nodeId => nodeId !== step.targetNodeId)
        .flatMap(nodeId => ensureNodeAvailable(nodeId, forRelation));
      visitingStructuralSteps.delete(stepIndex);
      if (missing.length)
        return missing;
      availableNodeIds.add(step.targetNodeId);
      pendingStructuralStepEntries[stepIndex].introducedVisibleNodeIds.forEach(id => availableNodeIds.add(id));
      const lastVisible = stagePlaybackSteps.at(-1)?.replayVisibleNodeIds || [];
      // A prerequisite can be pulled ahead of its original construction
      // position. Rebuild from available syntax so a still-pending wrapper
      // cannot replace a current edge and then be hidden after the rebuild.
      const availableStep = withPendingStructureHidden({
        ...step,
        replayVisibleNodeIds: Array.from(new Set([
          ...(step.replayVisibleNodeIds || []),
          ...lastVisible,
          step.targetNodeId
        ]))
      });
      const rebuilt = rebuildStructuralStepForActiveRelations({
        ...step, replayVisibleNodeIds: availableStep.replayVisibleNodeIds
      }, activeRelationIndexes);
      // Carried syntax that no longer exists, such as a dissolved constituent
      // after its regrouping, has no node in the rebuilt canvas to show.
      const canvasIds = new Set<string>();
      const indexCanvas = (node?: SyntaxNode | null) => {
        if (!node) return;
        canvasIds.add(String(node.id || ''));
        (node.aliasIds || []).forEach(alias => canvasIds.add(String(alias)));
        (node.children || []).forEach(indexCanvas);
      };
      indexCanvas(rebuilt.replayCanvasData);
      stagePlaybackSteps.push(withPendingStructureHidden({
        ...rebuilt,
        replayVisibleNodeIds: (rebuilt.replayVisibleNodeIds || []).filter(id => canvasIds.has(String(id)))
      }));
      emittedStructuralSteps.add(stepIndex);
      return [];
    };
    const emitRelationsThrough = (relationIndex: number) => {
      while (nextRelation < relationPlacements.length
        && relationPlacements[nextRelation].relationIndex <= relationIndex) {
        const placement = relationPlacements[nextRelation++];
        const landingHostIds = new Set(getMovementCreatedLandingHostNodeIds(placement));
        const attachmentPrerequisites = [...landingHostIds].flatMap(nodeId => findNodeByIdInForest(workspaceRoots, nodeId)?.children || [])
          .map(node => node.id)
          .filter(nodeId => !placement.authoredTargetNodeIds.includes(nodeId) && !landingHostIds.has(nodeId));
        getMovementCreatedLandingHostPaths(placement).forEach(path => {
          const outerLandingHost = path.at(-1)!;
          const attachmentParentId = findParentNodeIdInForest(workspaceRoots, outerLandingHost);
          const attachmentParent = findNodeByIdInForest(workspaceRoots, attachmentParentId);
          const structuralAttachment = findNodeByIdInForest(structuralWorkspaceRoots, attachmentParentId);
          if (structuralProducers.has(attachmentParentId)
            && !structuralAttachment?.children?.some(child => child.id === outerLandingHost)
            && attachmentParent?.children?.some(child => child.id !== outerLandingHost && collectSyntaxSubtreeNodeIds(child).some(id => availableNodeIds.has(id)))) {
            attachmentPrerequisites.push(attachmentParentId);
          }
        });
        const requiredIds = [...placement.relationAnchorNodeIds, ...attachmentPrerequisites].filter(nodeId => relationProducers.get(nodeId) !== placement.relationIndex);
        const missing = Array.from(new Set(requiredIds.flatMap(nodeId => ensureNodeAvailable(nodeId, placement.relationIndex))));
        if (missing.length) {
          const descriptions = missing.map(nodeId => {
            const owner = relationProducers.get(nodeId);
            return owner === undefined ? `${nodeId} before its structural prerequisites are available`
              : `${nodeId} before relation ${(frameRelationSteps[owner].authoredRelationIndex ?? owner) + 1} (${frameRelationSteps[owner].relation}) introduces it`;
          });
          const message = `RELATION_TIMING_CONFLICT: Stage ${index + 1}, relation ${(placement.relation.authoredRelationIndex ?? placement.relationIndex) + 1} (${placement.relationLabel}) requires ${descriptions.join('; ')}. Authored relation order is preserved; unavailable structure is not introduced early.`;
          const involvedRelations = new Set([
            placement.relationIndex,
            ...missing.map(nodeId => relationProducers.get(nodeId))
          ]);
          relationPlacements.filter(candidate => involvedRelations.has(candidate.relationIndex))
            .forEach(candidate => {
              candidate.relation = {
                ...candidate.relation, movementDiagnostics: [
                  ...(candidate.relation.movementDiagnostics || []), message
                ]
              };
            });
        }
        activeRelationIndexes.add(placement.relationIndex);
        relationProducers.forEach((owner, nodeId) => {
          if (owner === placement.relationIndex)
            availableNodeIds.add(nodeId);
        });
        // A recovered movement can stand independently of its envelope's
        // contextual claims. Diagnose unavailable current context without
        // delaying that movement or pulling a later occurrence forward.
        const unavailableContext = (placement.renderableTrajectory || placement.ownsPhrasalTreeTransition)
          ? [...new Set(relationAnchorNodeIds(placement.relation.anchors))].filter(nodeId => !placement.relationAnchorNodeIds.includes(nodeId) && !missing.includes(nodeId)
            && findExactNodeByIdInForest(workspaceRoots, nodeId) && !availableNodeIds.has(nodeId))
          : [];
        if (unavailableContext.length) {
          const descriptions = unavailableContext.map(nodeId => {
            const owner = relationProducers.get(nodeId);
            return owner === undefined ? `${nodeId} before its structural prerequisites are available`
              : `${nodeId} before relation ${(frameRelationSteps[owner].authoredRelationIndex ?? owner) + 1} (${frameRelationSteps[owner].relation}) introduces it`;
          });
          placement.relation = {
            ...placement.relation, movementDiagnostics: [
              ...(placement.relation.movementDiagnostics || []),
              `RELATION_TIMING_CONFLICT: Stage ${index + 1}, relation ${(placement.relation.authoredRelationIndex ?? placement.relationIndex) + 1} (${placement.relationLabel}) has unavailable authored context: ${descriptions.join('; ')}. Its proven movement and independent claims retain authored order; unavailable context is not introduced early.`
            ]
          };
        }
        const baseStep = stagePlaybackSteps.at(-1) ?? {
          ...frameSemanticStep,
          replayVisibleNodeIds: Array.from(availableNodeIds),
          replayPendingAttachmentNodeIds: structuralSteps.some(step => step.replayPendingAttachmentNodeIds)
            ? Array.from(constructionAttachmentUpdates(previousFrameWorkspaceRoots, structuralWorkspaceRoots)) : undefined
        };
        const relationStep = withPendingStructureHidden(buildRelationPlaybackStep(placement, activeRelationIndexes, baseStep));
        stagePlaybackSteps.push(relationStep);
        (relationStep.replayVisibleNodeIds || []).forEach(id => availableNodeIds.add(id));
      }
    };
    for (let structuralStepIndex = 0; structuralStepIndex <= pendingStructuralSteps.length; structuralStepIndex += 1) {
      scheduledRelationPlacements
        .filter(({ insertionIndex }) => insertionIndex === structuralStepIndex)
        .forEach(({ placement }) => {
          emitRelationsThrough(placement.relationIndex);
        });
      if (structuralStepIndex >= pendingStructuralSteps.length)
        continue;
      emitStructuralStep(structuralStepIndex);
    }
    const stageStepCount = stagePlaybackSteps.length + 1;
    let stageStepNumber = 1;
    const annotateStep = (step: PlaybackStep, replayKind: PlaybackStep['replayKind']): PlaybackStep => ({
      ...step,
      replayKind,
      replayProgressLabel: buildReplayProgressLabel(plannedStage, plannedStageCount, stageStepNumber++, stageStepCount)
    });
    const completedStageReplayStep = stagePlaybackSteps[stagePlaybackSteps.length - 1];
    const fallbackStageCompletionSnapshot = fallbackTransitionOwnership.size > 0
      ? frameReplaySnapshot
      : null;
    return [
      ...stagePlaybackSteps.map((step) => annotateStep(step, step.replayKind || 'micro')),
      annotateStep({
        ...frameSemanticStep,
        operation: 'StageRecord' as DerivationOperation,
        replayKind: 'macro',
        detailBlocks: mergeReplayDetailBlocks(frameStageRecordBlocks),
        note: undefined,
        recipe: String(plannedStage.statement || '').trim()
          || frameSemanticStep.recipe
          || `Stage ${plannedStage.stageNumber}`,
        replayCanvasData: fallbackStageCompletionSnapshot?.canvasData
          || completedStageReplayStep?.replayCanvasData
          || frameSemanticStep.replayCanvasData,
        replayVisibleNodeIds: fallbackStageCompletionSnapshot
          ? fallbackStageCompletionSnapshot.visibleNodeIds
          : Array.isArray(completedStageReplayStep?.replayVisibleNodeIds)
            ? completedStageReplayStep.replayVisibleNodeIds
            : frameSemanticStep.replayVisibleNodeIds,
        replayRelationLinks: fallbackStageCompletionSnapshot
          ? fallbackStageCompletionSnapshot.relationLinks
          : Array.isArray(completedStageReplayStep?.replayRelationLinks)
            ? completedStageReplayStep.replayRelationLinks
            : frameSemanticStep.replayRelationLinks,
        replayUsesFutureLayoutScaffold: (fallbackStageCompletionSnapshot ? Boolean(futureLayoutScaffold) : undefined)
          ?? completedStageReplayStep?.replayUsesFutureLayoutScaffold
          ?? frameSemanticStep.replayUsesFutureLayoutScaffold
      }, 'macro')
    ];
  }
  if (frameCarriesAuthoredEffect) {
    return [...structuralSteps, frameSemanticStep];
  }
  return structuralSteps;
};
