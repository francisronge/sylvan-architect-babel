/** Resolve authored frame relations and accumulate their anchored visual links. */
import { type ResolvedRelationLink } from '../relationLinks.ts';
import { type DerivationStageRelation, type SyntaxNode } from '../types.ts';
import { readCategoryLabel } from './categoryLabel.ts';
import { buildMovementChainIndexCatalogue, type MovementChainIndexCatalogue } from './movementIndices.ts';
import { getReplayPlanStage } from './playbackFormatting.ts';
import {
  findResolvedReplayAnchorByRoles,
  getResolvedReplayRelationAnchors,
  relationAnchorNodeIds
} from './relationAnchors.ts';
import { productionRelationRegistry } from './relationDispatch/productionRegistry.js';
import { findRelationRegistryEntry } from './relationDispatch/relationRegistry.js';
import {
  getAuthoredFrameRelations,
  relationStagesFromFrames,
  type DispatchedRelationStages
} from './relationStages.ts';
import { isPriorMovementContextFailure } from './relations/movementDiagnosticOwnership.ts';
import { type RecoveredMovement } from './relations/movementEvidence.ts';
import { registeredTrajectoryDisplayKind } from './relations/movementIdentities.ts';
import { type RelationClaimDispatch } from './relations/relationClaims.ts';
import { dispatchRelationStagesForPlan } from './relations/renderPlanCompiler.ts';
import {
  PRODUCTION_RENDER_FAMILIES,
  TRAJECTORY_SOURCE_ROLES,
  TRAJECTORY_TARGET_ROLES,
  TRAJECTORY_WITNESS_ROLES
} from './relations/renderFamilies.ts';
import {
  dispatchRelationClaims,
  recoveredClaimMovements
} from './relations/tier2RelationDispatch.ts';
import { recoveredCovertMovement } from './relations/tier2Transitions.ts';
import {
  collectExactSubtreeNodeIds,
  collectSyntaxSubtreeNodeIds,
  findExactNodeByIdInForest,
  findExactNodesByIdInForest,
  indexExactForestNodeLocations
} from './syntaxForest.ts';
import {
  anchoredCopyDisplacement,
  movementLandingWrapper,
  priorWitnessWrapperNodeIds,
  resolveFallbackTreeTransitionOwnership
} from './treeTransitions.ts';
import {
  type DerivationReplayPlan,
  type DerivationReplayPlanStage,
  type DerivationReplayPlanStep,
  type ReplayAuthoredRelationLink,
  type ReplayDerivationFrame
} from './types.ts';

/** One immutable preparation request shares its ordered relation recovery
 * across the final links, chain catalogue, and playback construction. Pass the
 * dispatches the relation render plan compiled so both read every claim once. */
export const createFrameRelationResolver = (
  frames: ReplayDerivationFrame[],
  replayPlan?: DerivationReplayPlan | null,
  relationClaims: DispatchedRelationStages = dispatchRelationStagesForPlan(relationStagesFromFrames(frames, replayPlan))
) => {
  const { dispatches } = relationClaims;
  const resolved = new Map<number, DerivationReplayPlanStep[]>();
  return (index: number) => {
    if (!resolved.has(index))
      resolved.set(index, getFrameRelations(frames[index], getReplayPlanStage(replayPlan, index), frames[index - 1]?.workspaceForest || [], dispatches[index]));
    return resolved.get(index)!;
  };
};

/** A later chain can describe a member already carried inside an earlier
 * head movement. Only an unchanged lower witness and an unchanged, ordered
 * head assembly establish this ownership; containment alone does not. */
const isCarriedHeadMemberTransition = (
  movement: RecoveredMovement,
  earlierMovements: readonly RecoveredMovement[],
  previousForest: SyntaxNode[],
  currentForest: SyntaxNode[]
): boolean => {
  if (movement.trajectoryKind !== 'head'
    || !earlierMovements.some(earlier => earlier.transition && earlier.trajectoryKind === 'head'))
    return false;
  const previous = indexExactForestNodeLocations(previousForest);
  const current = indexExactForestNodeLocations(currentForest);
  const lowerBefore = previous.get(movement.sourceNodeId);
  const lowerAfter = current.get(movement.sourceNodeId);
  if (!lowerBefore || !lowerAfter || lowerBefore.parentId !== lowerAfter.parentId
    || lowerBefore.childIndex !== lowerAfter.childIndex
    || !lowerBefore.parentId && lowerBefore.rootIndex !== lowerAfter.rootIndex
    || JSON.stringify(lowerBefore.node) !== JSON.stringify(lowerAfter.node))
    return false;
  const matchesCarriedAssembly = (before: SyntaxNode, after: SyntaxNode): boolean => {
    if (readCategoryLabel(before.label)?.kind !== 'head' || readCategoryLabel(after.label)?.kind !== 'head'
      || before.id !== after.id && (!before.lineageId || before.lineageId !== after.lineageId))
      return false;
    const keys = Object.keys(before).filter(key => key !== 'id' && key !== 'children');
    if (keys.length !== Object.keys(after).filter(key => key !== 'id' && key !== 'children').length
      || !keys.every(key => JSON.stringify(before[key as keyof SyntaxNode]) === JSON.stringify(after[key as keyof SyntaxNode])))
      return false;
    const beforeChildren = before.children || [], afterChildren = after.children || [];
    return beforeChildren.length === afterChildren.length
      && beforeChildren.every((child, index) => matchesCarriedAssembly(child, afterChildren[index]));
  };
  const containsCarriedMember = (before: SyntaxNode, after: SyntaxNode): boolean => after.id === movement.targetNodeId && Boolean(before.lineageId && before.lineageId === after.lineageId)
    || Boolean(before.children?.some((child, index) => containsCarriedMember(child, after.children![index])));
  return earlierMovements.some(earlier => {
    if (!earlier.transition || earlier.trajectoryKind !== 'head'
      || earlier.priorSourceNodeId === movement.priorSourceNodeId)
      return false;
    const before = previous.get(earlier.priorSourceNodeId)?.node;
    const after = current.get(earlier.targetNodeId)?.node;
    return Boolean(before && after && after.id !== movement.targetNodeId
      && matchesCarriedAssembly(before, after) && containsCarriedMember(before, after));
  });
};

export const getFrameRelations = (
  frame?: ReplayDerivationFrame | null,
  plannedStage?: DerivationReplayPlanStage | null,
  previousForest: SyntaxNode[] = [],
  claimDispatches?: RelationClaimDispatch[]
): DerivationReplayPlanStep[] => {
  const currentForest = frame?.workspaceForest || frame?.after?.workspaceForest || [];
  const authored = getAuthoredFrameRelations(frame, plannedStage).map((authoredStep, relationIndex) => {
    const unresolved = Array.isArray(authoredStep.unresolvedAnchors) ? authoredStep.unresolvedAnchors : [];
    if (unresolved.length === 0)
      return authoredStep;
    // The relation keeps its Replay moment. Each missing witness is named at
    // its authored field so the reader sees exactly what did not resolve.
    const stageNumber = (plannedStage?.stageIndex ?? 0) + 1;
    const relationNumber = (authoredStep.authoredRelationIndex ?? relationIndex) + 1;
    return {
      ...authoredStep,
      movementDiagnostics: [...(authoredStep.movementDiagnostics ?? []), ...unresolved.map((anchor) => `RELATION_ANCHOR_UNRESOLVED: Stage ${stageNumber}, relation ${relationNumber} (${authoredStep.relation}) ${anchor.fieldPath} names ${JSON.stringify(anchor.nodeId)}, which is not in this stage's expanded workspace. The anchor was not replaced; the relation is shown without it.`)
      ]
    };
  });
  // Each proved movement's key, with the authored relation whose moment makes it. A later claim
  // of the same moved phrase, source and landing is a true duplicate and shares that moment.
  const ownedMovements = new Map<string, number>();
  const earlierMovements: RecoveredMovement[] = [];
  const recovered = authored.map((authoredStep, relationIndex) => {
    const input = {
      relation: authoredStep as DerivationStageRelation,
      currentForest, priorForest: previousForest,
      currentRealizations: frame?.after?.realizations ?? plannedStage?.realizations,
      stageIndex: plannedStage?.stageIndex ?? 0, relationIndex
    };
    const dispatch = claimDispatches?.[relationIndex] ?? dispatchRelationClaims(input);
    const evidence = dispatch.evidence;
    const transitionAnchors = { ...dispatch.primaryRelation.anchors };
    const transitionPriorAnchors = { ...dispatch.primaryRelation.priorAnchors };
    // A recovered rewrite consumes its lexical witnesses as drawing evidence.
    // They still own the corresponding word change in this Replay moment.
    // The envelope's PF host may instead be a containing head complex.
    dispatch.facets.filter(facet => facet.recipe.id === 'pf.rewrite' && facet.evidence).forEach(facet => {
      const scoped = facet.evidence!;
      for (const [entries, concept, destination] of [
        [scoped.authoredCurrentAnchors, 'rewrite.output', transitionAnchors],
        [scoped.authoredPriorAnchors, 'rewrite.input', transitionPriorAnchors]
      ] as const)
        entries?.filter(entry => entry.concepts.includes(concept)).forEach(entry => {
          destination[entry.key] = entry.items.length === 1 ? entry.items[0] : [...entry.items];
        });
    });
    if (dispatch.primaryClaim?.tier === 3 && relationAnchorNodeIds(authoredStep.priorAnchors).length) {
      const priorLocations = indexExactForestNodeLocations(previousForest);
      const currentLocations = indexExactForestNodeLocations(currentForest);
      const priorParticipants = relationAnchorNodeIds(authoredStep.priorAnchors)
        .map(id => priorLocations.get(id)).filter(location => location != null);
      // Drawing ownership does not erase a structural witness. An explicit
      // new result can still own the merge of its authored prior participants,
      // even when a sibling drawing has consumed their role associations.
      const resultDescendants = new Set(relationAnchorNodeIds(transitionAnchors).flatMap(id => {
        const current = currentLocations.get(id);
        return current && !priorLocations.has(id) ? [...collectExactSubtreeNodeIds(current.node)] : [];
      }));
      Object.entries(authoredStep.priorAnchors ?? {}).forEach(([key, value]) => {
        if (key in transitionPriorAnchors)
          return;
        const ids = Array.isArray(value) ? value : [value];
        if (ids.length && ids.every(id => resultDescendants.has(id) && priorLocations.get(id))) {
          transitionPriorAnchors[key] = value;
        }
      });
      // A drawing can consume an authored replacement witness. Keep that
      // exact slot replacement in the transition, without absorbing independent
      // sibling claims merely because they share this relation moment.
      Object.entries(input.relation.anchors).forEach(([key, value]) => {
        if (key in transitionAnchors)
          return;
        const ids = (Array.isArray(value) ? value : [value]).filter(id => {
          const current = currentLocations.get(id);
          return current && priorParticipants.some(prior => prior.node.id !== id
            && current.parentId === prior.parentId && current.childIndex === prior.childIndex
            && current.rootIndex === prior.rootIndex);
        });
        if (ids.length)
          transitionAnchors[key] = Array.isArray(value) ? ids : ids[0];
      });
    }
    const interpretedStep = dispatch.primaryClaim?.tier === 3 ? {
      ...authoredStep,
      neutralTransitionEvidence: {
        anchors: transitionAnchors,
        priorAnchors: transitionPriorAnchors
      }
    } : authoredStep;
    const boundStep = dispatch.primaryClaim?.tier === 1 ? {
      ...interpretedStep,
      registeredEntryId: dispatch.primaryClaim.registryEntryId,
      resolvedAnchors: authoredStep.resolvedAnchors?.map(anchor => {
        const binding = dispatch.tier1Dispatch.roleBindings.find(binding => binding.field === 'anchors' && binding.authoredRole === anchor.role);
        return binding && binding.role !== anchor.role
          ? { ...anchor, role: binding.role, authoredRole: anchor.role } : anchor;
      })
    } : interpretedStep;
    const pronunciationNodeIds = dispatch.primaryClaim?.tier === 1
      && PRODUCTION_RENDER_FAMILIES[dispatch.primaryClaim.registryEntryId]?.transitionKinds?.includes('pronunciation')
      ? relationAnchorNodeIds(dispatch.boundPrimaryRelation.anchors)
      : [...new Set(dispatch.facets.filter(f => f.recipe.id === 'pf.structured' || f.recipe.id === 'pf.rewrite')
        .flatMap(f => (f.evidence ?? evidence).currentAnchors['rewrite.output'] || []))];
    const landingIds = evidence.currentAnchors['movement.landing'] ?? [];
    const unprovenNewLandingNodeId = evidence.movementFailure === 'MOVEMENT_PRIOR_SOURCE_UNPROVEN'
      && landingIds.length === 1
      && findExactNodesByIdInForest(currentForest, landingIds[0]).length === 1
      && !findExactNodesByIdInForest(previousForest, landingIds[0]).length
      ? landingIds[0] : undefined;
    const step = {
      ...boundStep,
      ...(pronunciationNodeIds.length ? { pronunciationNodeIds } : {}),
      ...(unprovenNewLandingNodeId ? { unprovenNewLandingNodeId } : {})
    };
    const registeredEntry = findRelationRegistryEntry(productionRelationRegistry, String(step.relation || ''));
    const facet = dispatch.facets.find(f => f.recipe.id === 'movement.path' || f.recipe.id === 'scope.movement');
    const covert = facet?.recipe.id === 'scope.movement';
    const groupedMovements = recoveredClaimMovements(dispatch);
    if (!registeredEntry && groupedMovements.length > 1) {
      const movements = groupedMovements.map(movement => {
        const owner = dispatch.facets.find(item => item.recipe.id === 'movement.path'
          && item.evidence?.movement === movement);
        const key = JSON.stringify([movement.priorSourceNodeId, movement.sourceNodeId, movement.targetNodeId]);
        const transition = !ownedMovements.has(key)
          && !isCarriedHeadMemberTransition(movement, earlierMovements, previousForest, currentForest)
          && Boolean(owner?.evaluation.earnedTransitions.includes('movement'));
        if (transition) {
          ownedMovements.set(key, relationIndex);
          earlierMovements.push(movement);
        }
        return { ...movement, transition, drawTrajectory: Boolean(owner) };
      });
      const sharedOwners = new Set(groupedMovements.map(movement => ownedMovements.get(JSON.stringify([movement.priorSourceNodeId, movement.sourceNodeId, movement.targetNodeId]))));
      const sharedMomentOf = movements.every(movement => !movement.transition) && sharedOwners.size === 1 ? [...sharedOwners][0] : undefined;
      const diagnostics = dispatch.facets.flatMap(facet => facet.evidence?.movementDiagnostics ?? []);
      return {
        ...step, recoveredMovement: movements.find(movement => movement.transition) ?? movements[0], recoveredMovements: movements,
        ...(sharedMomentOf !== undefined && sharedMomentOf !== relationIndex ? { sharedMomentOf } : {}),
        ...(diagnostics.length ? { movementDiagnostics: [...new Set(diagnostics)] } : {}),
        sourceNodeIds: movements.map(movement => movement.sourceNodeId), targetNodeId: movements[0].targetNodeId
      };
    }
    if (registeredEntry && !PRODUCTION_RENDER_FAMILIES[registeredEntry.id]?.trajectoryKind && !facet)
      return step;
    const movementDiagnostics = isPriorMovementContextFailure(input.relation, dispatch, earlierMovements)
      ? [] : evidence.movementDiagnostics;
    const covertEvidence = facet?.evidence ?? evidence;
    const movement: RecoveredMovement | undefined = covert ? recoveredCovertMovement(covertEvidence) ?? {
      priorSourceNodeId: evidence.currentAnchors['scope.source'][0],
      sourceNodeId: evidence.currentAnchors['scope.source'][0],
      targetNodeId: evidence.currentAnchors['scope.landing'][0],
      witnessNodeId: evidence.currentAnchors['scope.source'][0],
      trajectoryKind: 'phrasal', transition: facet.evaluation.earnedTransitions.includes('movement'), roles: {}
    } : evidence.movement;
    const priorDiagnostics = [...(Array.isArray(step.movementDiagnostics) ? step.movementDiagnostics : []),
    ...(movementDiagnostics || [])];
    if (!movement) {
      return priorDiagnostics.length ? { ...step, movementDiagnostics: priorDiagnostics } : step;
    }
    // A proved tree transition and permission to draw a trajectory are separate.
    // Fallback may reveal the authored landing without rescuing a Tier 1 recipe.
    // Specialized drawing kinds still prove either a head or a phrasal transition.
    const registeredKind = registeredTrajectoryDisplayKind(step.relation);
    const movementKey = JSON.stringify([movement.priorSourceNodeId, movement.sourceNodeId, movement.targetNodeId]);
    const transition = !ownedMovements.has(movementKey)
      && !isCarriedHeadMemberTransition(movement, earlierMovements, previousForest, currentForest)
      && (facet ? facet.evaluation.earnedTransitions.includes('movement') : movement.transition);
    // A kind conflict refuses the movement. When no other claim applies its
    // change, that change stays this claim's neutral output.
    if ((registeredKind === 'head' || registeredKind === 'phrasal') && registeredKind !== movement.trajectoryKind)
      return {
        ...step,
        recoveredMovement: { ...movement, transition: false, drawTrajectory: false },
        ...(transition ? { refusedMovementTransition: true as const } : {}),
        movementDiagnostics: [...priorDiagnostics, `MOVEMENT_KIND_CONFLICT: ${step.relation} selects ${registeredKind} movement, but the anchored context was recovered as ${movement.trajectoryKind}. No recovered transition was applied.`]
      };
    const primaryMovement = dispatch.primaryClaim?.tier === 1 && registeredKind === movement.trajectoryKind;
    if (dispatch.primaryClaim?.tier === 1 && !primaryMovement)
      return step;
    const drawingDiagnostics = !facet && !primaryMovement ? [
      `Stage ${input.stageIndex + 1}, relation ${relationIndex + 1} (${step.relation}): movement endpoints ${movement.sourceNodeId} -> ${movement.targetNodeId} are identifiable, but the drawing was not licensed: ${dispatch.primaryClaim && 'reason' in dispatch.primaryClaim ? dispatch.primaryClaim.reason : 'no-movement-facet'}. The authored analysis is unchanged.`,
      ...(dispatch.tier1Dispatch.signatureIssues || []).map(issue => `Tier 1 signature: ${JSON.stringify(issue)}`)
    ] : [];
    // Later claims may inspect the same dependency; its structural change occurs once.
    const sharedMomentOf = transition ? undefined : ownedMovements.get(movementKey);
    if (transition) {
      ownedMovements.set(movementKey, relationIndex);
      earlierMovements.push(movement);
    }
    return {
      ...step,
      ...(sharedMomentOf !== undefined ? { sharedMomentOf } : {}),
      ...((priorDiagnostics.length || drawingDiagnostics.length)
        ? { movementDiagnostics: [...priorDiagnostics, ...drawingDiagnostics] } : {}),
      recoveredMovement: { ...movement, transition, drawTrajectory: !covert && Boolean(facet || primaryMovement) },
      sourceNodeIds: [movement.sourceNodeId], targetNodeId: movement.targetNodeId
    };
  });
  // A neutral claim's copy is its displacement only outside every recovered
  // movement of the stage, which owns both of its occurrences, and outside
  // what an earlier claim already establishes.
  const movementOccurrenceNodeIds = [...new Set(recovered.flatMap(step => (step.recoveredMovements ?? [step.recoveredMovement]))
    .filter(movement => movement?.transition).flatMap(movement => [
      ...[movement!.sourceNodeId, movement!.targetNodeId].flatMap(id => collectSyntaxSubtreeNodeIds(findExactNodeByIdInForest(currentForest, id))),
      ...collectSyntaxSubtreeNodeIds(findExactNodeByIdInForest(previousForest, movement!.priorSourceNodeId))
    ]))];
  const claimedNodeIds = new Set(movementOccurrenceNodeIds);
  // What the stage's recovered movements own at their moments: their current
  // landing and lower-occurrence subtrees, the earlier material of a moved
  // phrase that no longer exists (the moment replaces it), and the new parent a
  // movement moment introduces to attach its landing above the landing host's
  // earlier children. Earlier material of a moved phrase that ends up elsewhere
  // is not theirs.
  const currentIds = new Set(currentForest.flatMap(root => collectSyntaxSubtreeNodeIds(root)));
  const movementOwnedIds = new Set(recovered.flatMap(step => (step.recoveredMovements ?? [step.recoveredMovement]))
    .filter(movement => movement?.transition).flatMap((movement) => {
      const wrapper = movementLandingWrapper(currentForest, previousForest, movement!.targetNodeId);
      return [...[movement!.sourceNodeId, movement!.targetNodeId].flatMap(id => collectSyntaxSubtreeNodeIds(findExactNodeByIdInForest(currentForest, id))),
        ...collectSyntaxSubtreeNodeIds(findExactNodeByIdInForest(previousForest, movement!.priorSourceNodeId)).filter(id => !currentIds.has(id)),
        ...(wrapper ? [wrapper.wrapperId] : [])];
    }));
  return recovered.map((step, relationIndex) => {
    const anchoredCopy = anchoredCopyDisplacement(step, previousForest, currentForest, claimedNodeIds);
    const ambiguous = anchoredCopy?.copies.filter(copy => !copy.earlierNodeId).map(copy => copy.nodeId) ?? [];
    // Ordinary construction builds a new parent around a restated witness only
    // when nothing else there changes outside the stage's movements.
    const witnessWrapperNodeIds = anchoredCopy ? [] : priorWitnessWrapperNodeIds(step,
      recovered.filter((_other, otherIndex) => otherIndex !== relationIndex), previousForest, currentForest, movementOwnedIds);
    const wrapping = {
      ...step,
      ...(witnessWrapperNodeIds.length ? { witnessWrapperNodeIds } : {}),
      ...(movementOccurrenceNodeIds.length && !(step.recoveredMovements ?? [step.recoveredMovement]).some(movement => movement?.transition)
        ? { movementOccurrenceNodeIds } : {})
    };
    const displaced = anchoredCopy ? { ...wrapping, anchoredCopyDisplacement: anchoredCopy, ...(ambiguous.length ? { movementDiagnostics: [
      ...(step.movementDiagnostics ?? []),
      `COPY_SOURCE_AMBIGUOUS: Stage ${(plannedStage?.stageIndex ?? 0) + 1}, relation ${(step.authoredRelationIndex ?? relationIndex) + 1} (${step.relation}) relates ${ambiguous.join(', ')} to more than one earlier occurrence of the same object, and no single one is displaced. No earlier form stands in for a later pronunciation.`
    ] } : {}) } : wrapping;
    resolveFallbackTreeTransitionOwnership(displaced, previousForest, currentForest)?.currentNodeIds
      .forEach(id => claimedNodeIds.add(id));
    return displaced;
  });
};

/**
 * An authored relation owns a Replay moment whenever it has a name. Anchors
 * that fail to resolve are diagnosed on that moment; they do not erase it.
 */
export const isRenderableReplayRelation = (relation?: DerivationReplayPlanStep | null): boolean => Boolean(String(relation?.relation || '').trim());

const getSharedAuthoredLineageIdentity = (forest: SyntaxNode[], anchorNodeIds: string[]): string => {
  if (anchorNodeIds.length < 2)
    return '';
  const lineageSets = anchorNodeIds.map((nodeId) => {
    const lineageIds = new Set<string>();
    const visit = (node?: SyntaxNode | null) => {
      if (!node)
        return;
      const lineageId = String(node.lineageId || '');
      if (lineageId)
        lineageIds.add(lineageId);
      (Array.isArray(node.children) ? node.children : []).forEach(visit);
    };
    visit(findExactNodeByIdInForest(forest, nodeId));
    return lineageIds;
  });
  const [firstLineages, ...remainingLineages] = lineageSets;
  const sharedLineages = Array.from(firstLineages)
    .filter((lineageId) => (remainingLineages.every((lineages) => lineages.has(lineageId))))
    .sort();
  return sharedLineages.length > 0
    ? `identity:lineage:${sharedLineages.join('|')}`
    : '';
};

export interface AuthoredRelationLinksInput {
  frames: ReplayDerivationFrame[];
  replayPlan: DerivationReplayPlan | null | undefined;
  activeFrameIndex: number;
  forest: SyntaxNode[];
  currentFrameRelationLimit?: number;
  frameRelations?: (frameIndex: number) => DerivationReplayPlanStep[];
}

export const buildAuthoredRelationLinksForFrames = ({
  frames,
  replayPlan,
  activeFrameIndex,
  forest,
  currentFrameRelationLimit = Number.POSITIVE_INFINITY,
  frameRelations
}: AuthoredRelationLinksInput): ResolvedRelationLink[] => {
  if (!Array.isArray(frames) || activeFrameIndex < 0)
    return [];
  const links: ResolvedRelationLink[] = [];
  const resolveRelations = frameRelations ?? createFrameRelationResolver(frames, replayPlan);
  for (let frameIndex = 0; frameIndex <= Math.min(activeFrameIndex, frames.length - 1); frameIndex += 1) {
    const relations = resolveRelations(frameIndex);
    const relationLimit = frameIndex === activeFrameIndex
      ? currentFrameRelationLimit
      : Number.POSITIVE_INFINITY;
    relations.flatMap((relation, relationIndex) => relation.recoveredMovements?.length
      ? relation.recoveredMovements.map(movement => ({ relation: { ...relation, recoveredMovement: movement }, relationIndex }))
      : [{ relation, relationIndex }]).forEach(({ relation, relationIndex }) => {
        const authoredRelationIndex = Number.isInteger(relation.authoredRelationIndex)
          ? Number(relation.authoredRelationIndex)
          : relationIndex;
        if (authoredRelationIndex > relationLimit || !isRenderableReplayRelation(relation))
          return;
        const relationLabel = String(relation.relation || '').trim();
        const resolvedAnchors = getResolvedReplayRelationAnchors(relation)
          .filter((anchor) => (Boolean(findExactNodeByIdInForest(forest, String(anchor.nodeId || '')))));
        if (resolvedAnchors.length === 0)
          return;
        const [firstAnchor, secondAnchor] = resolvedAnchors;
        const trajectoryKind = relation.recoveredMovement?.drawTrajectory === false
          ? '' : relation.recoveredMovement?.trajectoryKind || registeredTrajectoryDisplayKind(relationLabel, resolvedAnchors);
        const registeredTrajectoryCapability = Boolean(registeredTrajectoryDisplayKind(relationLabel));
        const registryEntry = findRelationRegistryEntry(productionRelationRegistry, relationLabel);
        const operatorVariableBinding = registryEntry?.id === 'scope.operator-variable';
        const movementRelation = Boolean(trajectoryKind);
        const registeredEndpointRoles = movementRelation
          || registeredTrajectoryCapability
          || operatorVariableBinding;
        const movement = relation.recoveredMovement;
        // Recovery already proves the current endpoints from the authored prior
        // source and forest. They need not repeat the current anchor fields.
        // Retained links must still bind one exact occurrence in this forest.
        if (movement && [movement.sourceNodeId, movement.targetNodeId, movement.witnessNodeId]
          .some(id => findExactNodesByIdInForest(forest, id).length !== 1))
          return;
        const sourceNodeId = movement
          ? movement.sourceNodeId
          : registeredEndpointRoles
            ? (findResolvedReplayAnchorByRoles(resolvedAnchors, TRAJECTORY_SOURCE_ROLES) || firstAnchor)?.nodeId
            : firstAnchor?.nodeId;
        const targetNodeId = movement
          ? movement.targetNodeId
          : registeredEndpointRoles
            ? (findResolvedReplayAnchorByRoles(resolvedAnchors, TRAJECTORY_TARGET_ROLES) || secondAnchor)?.nodeId
            : secondAnchor?.nodeId;
        const witnessNodeId = movement
          ? movement.witnessNodeId
          : movementRelation || operatorVariableBinding
            ? findResolvedReplayAnchorByRoles(resolvedAnchors, TRAJECTORY_WITNESS_ROLES)?.nodeId
            : undefined;
        if (!sourceNodeId || (movement && !targetNodeId))
          return;
        const identityKey = getSharedAuthoredLineageIdentity(forest, resolvedAnchors.map((anchor) => String(anchor.nodeId || '')));
        const link: ReplayAuthoredRelationLink = {
          relationIndex: String(links.length + 1),
          relationIndexProvenance: 'derived-presentation',
          relation: relationLabel,
          anchors: resolvedAnchors.map((anchor) => ({
            role: anchor.role,
            ...(anchor.authoredRole ? { authoredRole: anchor.authoredRole } : {}),
            nodeId: anchor.nodeId
          })),
          // Authored optional blocks travel verbatim on the link.
          ...(relation.priorAnchors && typeof relation.priorAnchors === 'object'
            ? { priorAnchors: structuredClone(relation.priorAnchors) }
            : {}),
          ...(relation.values && typeof relation.values === 'object'
            ? { values: structuredClone(relation.values) }
            : {}),
          authoredRelationIndex,
          authoredRelationKey: `${frameIndex}:${authoredRelationIndex}`,
          ...(movement
            ? { priorSourceNodeId: movement.priorSourceNodeId, movementTransition: movement.transition }
            : {}),
          ...(targetNodeId
            ? {
              sourceNodeId,
              targetNodeId,
              ...(witnessNodeId ? { witnessNodeId } : {}),
              endpointOrderProvenance: movement ? 'recovered-movement' : registeredEndpointRoles
                ? 'registered-role-order'
                : 'authored-anchor-order'
            }
            : {}),
          renderFamily: movementRelation
            ? 'trajectory'
            : operatorVariableBinding
              ? 'operator-variable-binding'
              : (targetNodeId ? 'authored-anchor-link' : 'authored-anchor-evidence'),
          ...(trajectoryKind ? { trajectoryKind } : {}),
          stepIndex: frameIndex,
          operation: 'Relation',
          ...(identityKey
            ? {
              identityKey,
              identityProvenance: 'authored-shared-lineage'
            }
            : {})
        };
        links.push(link);
      });
  }
  return links;
};

export const buildMovementChainIndexCatalogueForFrames = (
  frames: ReplayDerivationFrame[],
  replayPlan: DerivationReplayPlan | null | undefined,
  frameRelations?: (frameIndex: number) => DerivationReplayPlanStep[]
): MovementChainIndexCatalogue => {
  const resolveRelations = frameRelations ?? createFrameRelationResolver(frames, replayPlan);
  const links = frames.flatMap((frame, stageIndex) => {
    const relations = resolveRelations(stageIndex);
    return buildAuthoredRelationLinksForFrames({
      frames,
      replayPlan,
      activeFrameIndex: stageIndex,
      forest: frame.workspaceForest || [],
      currentFrameRelationLimit: Number.POSITIVE_INFINITY,
      frameRelations: index => index === stageIndex ? relations : []
    });
  });
  return buildMovementChainIndexCatalogue(frames.map(frame => frame.workspaceForest || []), links);
};
