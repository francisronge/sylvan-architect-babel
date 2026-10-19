import type { DerivationStage, SyntaxNode } from '../../types.ts';
import { collectAuthoredSilentSubtreeIds } from './authoredSilence.ts';
import { featureCollectionSupersessions } from './featureCollectionContinuity.ts';
import { movementContextFailure } from './movementEvidence.ts';
import { collectRemnantDepartureLeafIds, collectSubtreeIds } from './planSyntax.ts';
import { realizationPlatePredecessors } from './realizationContinuity.ts';
import type { RelationClaimDispatch } from './relationClaims.ts';
import {
  planItemDependencyNodeIds,
  remapPlanOccurrence,
  type AnchorSetPlanItem,
  type PlanDiagnostic,
  type PlanRelationRef,
  type RelationPlanItem,
  type RelationRenderPlan,
  type TrajectoryPlanItem
} from './renderPlan.ts';
import { recoveredClaimMovements } from './tier2RelationDispatch.ts';

/** Materialize authored claim lifetimes and exact occurrence transfers.
 * Each frame receives its own mark objects before visual composition. */
/** Several claims of one stage can describe the same proved transition, such
 * as a chain claim restating the stage's movement. As in Replay, where the
 * first claim owns that structural change, they are one transfer at the
 * earliest claim; different destinations remain ambiguous. */
const distinctTransitions = <T extends { relationIndex: number }>(candidates: T[], key: (candidate: T) => string): T[] =>
  candidates.filter((candidate, index) => candidates.findIndex(other => key(other) === key(candidate)) === index);

export function materializePlanFrames(
  items: RelationPlanItem[],
  stageList: DerivationStage[],
  stageDispatches: RelationClaimDispatch[][],
  stageNodeMaps: Map<string, SyntaxNode>[],
  organizationCompanions: Map<RelationPlanItem, AnchorSetPlanItem[]>,
  diagnostics: PlanDiagnostic[]
): RelationRenderPlan['frames'] {
  // Track the enclosing head position without changing the initial terminal attachment.
  // Later movement can leave an exact authored witness at that landing position.
  // Notation proves the complex here; a prose-labelled complex keeps the site
  // that its own movement evidence proved structurally.
  const headLandingSites = new Map<TrajectoryPlanItem, string>();
  items.forEach(item => {
    if (item.kind !== 'trajectory' || item.trajectoryKind !== 'head') return;
    const forest = stageList[item.appearsAtStage].workspaceForest;
    const dispatch = stageDispatches[item.relationRef.stageIndex]?.[item.relationRef.relationIndex];
    const provedSites = new Set((dispatch ? recoveredClaimMovements(dispatch) : []).flatMap(movement =>
      movement.trajectoryKind === 'head' && movement.targetNodeId === item.targetNodeId
        && movement.structuralHeadComplexNodeId ? [movement.structuralHeadComplexNodeId] : []));
    const candidates = [...stageNodeMaps[item.appearsAtStage].values()].filter(node =>
      node.children?.some(child => child.id === item.targetNodeId)
      && (provedSites.has(node.id)
        || movementContextFailure(forest, item.targetNodeId, node.id, 'head-complex', stageList[item.appearsAtStage - 1]?.workspaceForest) === undefined));
    if (candidates.length === 1) headLandingSites.set(item, candidates[0].id);
  });
  const headLandingForFrame = (item: TrajectoryPlanItem, frameIndex: number): TrajectoryPlanItem['headLandingSite'] => {
    const site = headLandingSites.get(item);
    if (!site) return undefined;
    let currentSite = site;
    const transfers: NonNullable<TrajectoryPlanItem['headLandingSite']>['transfers'] = [];
    for (let stageIndex = item.appearsAtStage + 1; stageIndex <= frameIndex; stageIndex++) {
      const candidates = distinctTransitions(stageDispatches[stageIndex].flatMap((dispatch, relationIndex) => {
        return recoveredClaimMovements(dispatch).flatMap(movement => movement.transition && movement.trajectoryKind === 'head'
          && movement.priorSourceNodeId === currentSite
          ? [{ nodeId: movement.witnessNodeId, stageIndex, relationIndex }] : []);
      }), candidate => candidate.nodeId);
      if (candidates.length === 1) {
        transfers.push(candidates[0]);
        currentSite = candidates[0].nodeId;
      }
    }
    return { nodeId: site, transfers };
  };

  /* Materialize into per-stage frames per persistence, before coalescing. */
  for (const [item, predecessor] of realizationPlatePredecessors(items, stageList)) {
    if (predecessor) item.replacementPredecessorGroup = predecessor;
    else delete item.replacementPredecessorGroup;
  }
  const collectionSupersessions = featureCollectionSupersessions(items, stageList);
  const stageCount = stageList.length;
  const frames = Array.from({ length: stageCount }, (_unused, stageIndex) => ({
    stageIndex,
    items: [] as RelationPlanItem[]
  }));
  /* A disappearing anchor or earlier trajectory landing stays at an authored
   * lower witness when later movement proves that exact slot replacement.
   * A landing can retain its ID while moving again; other surviving anchors
   * still follow their own occurrences. Shared lineage alone proves neither. */
  const stageNodeIdSets = stageNodeMaps.map((nodesById) => new Set(nodesById.keys()));
  const vanishedAnchorIds = (item: RelationPlanItem, frameIndex: number): string[] => {
    if (frameIndex === item.appearsAtStage) return [];
    const frameNodes = stageNodeIdSets[frameIndex];
    if (!frameNodes) return [];
    return planItemDependencyNodeIds(item).filter((nodeId) => !frameNodes.has(nodeId));
  };
  const transferOccurrences = (item: RelationPlanItem, frameIndex: number): RelationPlanItem => {
    let projected = item;
    const transfers: NonNullable<RelationPlanItem['occurrenceTransfers']> = [];
    for (let stageIndex = item.appearsAtStage + 1; stageIndex <= frameIndex; stageIndex++) {
      const replaceable = planItemDependencyNodeIds(projected).filter(id => !stageNodeIdSets[stageIndex].has(id)
        || (projected.kind === 'trajectory' && projected.targetNodeId === id));
      for (const fromNodeId of replaceable) {
        const candidates = distinctTransitions(stageDispatches[stageIndex].flatMap((dispatch, relationIndex) =>
          recoveredClaimMovements(dispatch).flatMap(movement => movement.transition
            && movement.priorSourceNodeId === fromNodeId && movement.witnessNodeId !== fromNodeId
            ? [{ fromNodeId, toNodeId: movement.witnessNodeId, stageIndex, relationIndex }] : [])), candidate => candidate.toNodeId);
        if (candidates.length !== 1) continue;
        const transfer = candidates[0];
        projected = remapPlanOccurrence(projected, transfer.fromNodeId, transfer.toNodeId);
        transfers.push(transfer);
      }
      // A missing occurrence cannot skip an unsupported stage and reappear later.
      if (planItemDependencyNodeIds(projected).some(id => !stageNodeIdSets[stageIndex].has(id))) break;
    }
    return transfers.length ? { ...projected, occurrenceTransfers: transfers } : projected;
  };
  /* An anchor the stage no longer authors may still be on screen until a
   * movement of that stage carries it away: it lies inside the movement's
   * preceding source, which keeps its form until the movement's moment. The
   * mark then stays until that moment and yields with the anchor, instead of
   * ending at the stage's first step. Returns the earliest such moment that
   * accounts for every missing anchor, or undefined. */
  const removingMovement = (missing: string[], frameIndex: number): PlanRelationRef | undefined => {
    if (frameIndex < 1 || !missing.every(id => stageNodeIdSets[frameIndex - 1].has(id))) return undefined;
    const removals = stageDispatches[frameIndex].flatMap((dispatch, relationIndex) => recoveredClaimMovements(dispatch)
      .filter(movement => movement.transition)
      .map(movement => ({ relationIndex, ids: new Set(collectSubtreeIds(stageNodeMaps[frameIndex - 1].get(movement.priorSourceNodeId))) })));
    if (!missing.every(id => removals.some(removal => removal.ids.has(id)))) return undefined;
    const relationIndex = Math.min(...removals.filter(removal => missing.some(id => removal.ids.has(id))).map(removal => removal.relationIndex));
    const relation = stageList[frameIndex].relations[relationIndex];
    return { stageIndex: frameIndex, relationIndex, relation: relation.relation, anchors: relation.anchors,
      ...(relation.priorAnchors ? { priorAnchors: relation.priorAnchors } : {}), ...(relation.values ? { values: relation.values } : {}) };
  };
  const earlierMoment = (left: PlanRelationRef | undefined, right: PlanRelationRef | undefined) => !left || !right ? left ?? right
    : left.stageIndex !== right.stageIndex ? (left.stageIndex < right.stageIndex ? left : right)
      : left.relationIndex <= right.relationIndex ? left : right;
  const reportedVanished = new Set<string>();
  const materializeIntoFrame = (
    item: RelationPlanItem,
    frameIndex: number,
    supersededAt?: PlanRelationRef
  ) => {
    const projected = transferOccurrences(item, frameIndex);
    const missing = vanishedAnchorIds(projected, frameIndex);
    const removal = missing.length ? removingMovement(missing, frameIndex) : undefined;
    if (missing.length > 0) {
      const dedupeKey = [
        frameIndex,
        item.relationRef.stageIndex,
        item.relationRef.relationIndex,
        [...missing].sort().join(',')
      ].join('|');
      if (!reportedVanished.has(dedupeKey)) {
        reportedVanished.add(dedupeKey);
        diagnostics.push({
          stageIndex: frameIndex,
          relationIndex: item.relationRef.relationIndex,
          relation: item.relationRef.relation,
          kind: 'anchor-vanished',
          detail: `persistent mark from stage ${item.appearsAtStage + 1} is not drawn at stage `
            + `${frameIndex + 1}: anchored node(s) ${missing.join(', ')} no longer exist in this `
            + 'stage\'s forest; the mark keeps its earlier history and is never retargeted'
            + (removal ? `, and stays until relation ${removal.relationIndex + 1} (${removal.relation}) moves them` : '')
        });
      }
      if (!removal) return;
      supersededAt = earlierMoment(supersededAt, removal);
    }
    /*
     * Each frame owns its own item instance. Persistence used to push ONE
     * shared object into every licensed frame, so a later frame's
     * coalescing pass — which records contributing authored references on
     * the surviving item — leaked FUTURE references backward into earlier
     * frames through the shared object. A frame-local shallow copy makes
     * provenance frame-local: coalescing reassigns `coalescedRefs` on the
     * frame's own copy, and nested authored payloads stay shared read-only.
     *
     * Declared subtree-derived geometry refreshes from the CURRENT frame's
     * exact anchored root: a persistent Phase arc describes the domain as
     * it stands in the frame it draws in, never the authoring-stage
     * snapshot. The root itself is a dependency, so a vanished root fails
     * the mark closed above — this is refresh, never retargeting.
     */
    const frameLocal: RelationPlanItem = {
      ...projected,
      ...(item.kind === 'trajectory' && headLandingSites.has(item)
        ? { headLandingSite: headLandingForFrame(item, frameIndex) } : {}),
      ...(supersededAt ? { supersededAt } : {})
    };
    // A mark awaiting the movement that removes its anchor keeps its snapshot.
    if (!removal && frameIndex > item.appearsAtStage && projected.subtreeDerived) {
      const frameNodes = stageNodeMaps[frameIndex];
      projected.subtreeDerived.forEach((declaration) => {
        const rootNode = frameNodes?.get(declaration.rootNodeId);
        (frameLocal as unknown as Record<string, unknown>)[declaration.field] =
          declaration.mode === 'authored-silent'
            ? collectAuthoredSilentSubtreeIds(rootNode)
            : collectSubtreeIds(rootNode);
      });
    }
    frames[frameIndex].items.push(frameLocal);
    for (const companion of organizationCompanions.get(item) ?? []) {
      let projectedCompanion = transferOccurrences(companion, frameIndex);
      // Also use the owner's exact transfers for a moving landing whose ID
      // survives; the rail must follow the same proved lower occurrence.
      for (const transfer of projected.occurrenceTransfers ?? []) {
        projectedCompanion = remapPlanOccurrence(projectedCompanion, transfer.fromNodeId, transfer.toNodeId);
      }
      const companionMissing = vanishedAnchorIds(projectedCompanion, frameIndex);
      const companionRemoval = companionMissing.length ? removingMovement(companionMissing, frameIndex) : undefined;
      if (companionMissing.length && !companionRemoval) continue;
      const companionYield = earlierMoment(supersededAt, companionRemoval);
      const occurrenceTransfers = [...new Map([...(projectedCompanion.occurrenceTransfers ?? []),
      ...(projected.occurrenceTransfers ?? [])].map(transfer => [JSON.stringify(transfer), transfer])).values()];
      frames[frameIndex].items.push({
        ...projectedCompanion,
        ...(occurrenceTransfers.length ? { occurrenceTransfers } : {}),
        ...(companionYield ? { supersededAt: companionYield } : {})
      });
    }
  };
  items.forEach((item) => {
    if (item.appearsAtStage >= stageCount) return;
    if (item.persistence === 'stage-only' || item.persistence === 'relation-only') {
      materializeIntoFrame(item, item.appearsAtStage);
      return;
    }
    if (item.persistence === 'replace-prior-stage') {
      for (let frameIndex = item.appearsAtStage; frameIndex < stageCount; frameIndex += 1) {
        const replacement = items.find((candidate) =>
          candidate.familyId === item.familyId
          && candidate.tier2FacetId === item.tier2FacetId
          && candidate.appearsAtStage > item.appearsAtStage
          && candidate.appearsAtStage <= frameIndex);
        if (replacement) {
          materializeIntoFrame(item, frameIndex, replacement.relationRef);
          break;
        }
        materializeIntoFrame(item, frameIndex);
      }
      return;
    }
    if (item.persistence === 'replace-previous-instance') {
      const collectionSupersession = collectionSupersessions.get(item);
      for (let frameIndex = item.appearsAtStage; frameIndex < stageCount; frameIndex += 1) {
        const sameMovementAfterAttachment = (candidate: RelationPlanItem): boolean => {
          if (item.kind !== 'trajectory' || candidate.kind !== 'trajectory'
            || item.trajectoryKind !== 'sideward' || candidate.trajectoryKind !== 'head'
            || item.sourceNodeId !== candidate.sourceNodeId
            || item.targetNodeId !== candidate.targetNodeId
            || item.witnessNodeId !== candidate.witnessNodeId) return false;
          return [item.sourceNodeId, item.targetNodeId, item.witnessNodeId].filter(Boolean).every(id => {
            const lineage = stageNodeMaps[item.appearsAtStage].get(id!)?.lineageId;
            return Boolean(lineage) && stageNodeMaps.slice(item.appearsAtStage, candidate.appearsAtStage + 1)
              .every(nodes => nodes.get(id!)?.lineageId === lineage);
          });
        };
        const replacement = items.find((candidate) =>
          candidate !== item
          && candidate.appearsAtStage > item.appearsAtStage
          && candidate.appearsAtStage <= frameIndex
          && (candidate.replacementGroup === item.replacementGroup
            || (Boolean(candidate.replacementPredecessorGroup)
              && candidate.replacementPredecessorGroup === item.replacementGroup)
            || (collectionSupersession?.stageIndex === candidate.relationRef.stageIndex
              && collectionSupersession?.relationIndex === candidate.relationRef.relationIndex)
            || sameMovementAfterAttachment(candidate)));
        if (replacement) {
          materializeIntoFrame(item, frameIndex, replacement.relationRef);
          break;
        }
        materializeIntoFrame(item, frameIndex);
      }
      return;
    }
    for (let frameIndex = item.appearsAtStage; frameIndex < stageCount; frameIndex += 1) {
      materializeIntoFrame(item, frameIndex);
    }
  });

  /*
   * Remnant paths depart from the footprint of the material vacated by that
   * movement, not from a nested object's earlier evacuation site. Derive that
   * footprint from the current frame's tree plus the other visible trajectory
   * sources. This remains renderer metadata: the model authors only the open
   * relation and its syntax-node anchors.
   */
  frames.forEach((frame, frameIndex) => {
    const nodes = stageNodeMaps[frameIndex];
    const trajectories = frame.items.filter(
      (item): item is TrajectoryPlanItem => item.kind === 'trajectory'
    );
    trajectories.forEach((trajectory) => {
      if (trajectory.trajectoryKind !== 'remnant') return;
      const sourceRoot = nodes?.get(trajectory.sourceNodeId);
      const sourceIds = new Set(collectSubtreeIds(sourceRoot));
      const nestedSources = trajectories
        .filter((candidate) => candidate !== trajectory)
        .map((candidate) => nodes?.get(candidate.sourceNodeId))
        .filter((candidate): candidate is SyntaxNode => Boolean(
          candidate?.id && sourceIds.has(String(candidate.id))
        ));
      trajectory.orthogonalDepartureNodeIds = collectRemnantDepartureLeafIds(
        sourceRoot,
        nestedSources
      );
    });
  });

  return frames;
}
