/** Reconstruct relation-owned changes between completed forests atomically. */
import { type SyntaxNode } from '../types.ts';
import { readCategoryLabel } from './categoryLabel.ts';
import {
  findResolvedReplayAnchorsByRoles,
  getRelationSourceNodeIds,
  getRelationTargetNodeId,
  relationAnchorNodeIds
} from './relationAnchors.ts';
import { productionRelationRegistry } from './relationDispatch/productionRegistry.js';
import { findRelationRegistryEntry } from './relationDispatch/relationRegistry.js';
import { type RecoveredMovement } from './relations/movementEvidence.ts';
import { registeredTrajectoryDisplayKind } from './relations/movementIdentities.ts';
import { indexMovementOccurrences, sourceOccurrencePair } from './relations/movementSourceEvidence.ts';
import {
  PRODUCTION_RENDER_FAMILIES,
  type ProductionTransitionKind,
  TRAJECTORY_SOURCE_ROLES,
  TRAJECTORY_TARGET_ROLES
} from './relations/renderFamilies.ts';
import {
  cloneSyntaxForest,
  cloneSyntaxTree,
  collectExactSubtreeNodeIds,
  collectSyntaxSubtreeNodeIds,
  type ExactForestNodeLocation,
  findExactNodeByIdInForest,
  findExactNodesByIdInForest,
  findNodeByIdInForest,
  findParentNodeIdInForest,
  indexExactForestNodeLocations,
  type PendingSourceSyntaxNode,
  replayEffectiveSilence,
  syntaxNodeMaterialSignature
} from './syntaxForest.ts';
import { type DerivationReplayPlanStep, type ReplayResolvedRelationAnchor } from './types.ts';

// Dispatch has already resolved the authored name and validated its signature.
export const relationOwnsPhrasalTreeTransition = (relation: DerivationReplayPlanStep): boolean => relation.registeredEntryId === 'qr.covert';

export const relationOwnedPhrasalSourceRoles = (relation: DerivationReplayPlanStep): readonly string[] => relationOwnsPhrasalTreeTransition(relation) ? ['pronouncedQP', 'source'] : TRAJECTORY_SOURCE_ROLES;

export const relationOwnedPhrasalTargetRoles = (relation: DerivationReplayPlanStep): readonly string[] => relationOwnsPhrasalTreeTransition(relation) ? ['lfQP', 'target'] : TRAJECTORY_TARGET_ROLES;

/**
 * A final movement tree serializes the landed occurrence and silent lower
 * occurrence. Before the relation moment, Replay needs the inverse state: the
 * landing is still withheld and the lower occurrence is overt. Reconstruct
 * only what the authored contract proves — a registered phrasal trajectory
 * whose source and target nodes share exact lineage ids. Missing or ambiguous
 * lineage fails closed and leaves the authored tree unchanged.
 */
/** Split restoration by proved landing without splitting the authored relation moment. */
export const movementLandingGroups = (relation: DerivationReplayPlanStep): DerivationReplayPlanStep[] => {
  if (!relation.recoveredMovements) return [relation];
  const targets = [...new Set(relation.recoveredMovements.filter(movement => movement.transition).map(movement => movement.targetNodeId))];
  return targets.map(targetNodeId => {
    const movements = relation.recoveredMovements!.filter(movement => movement.transition && movement.targetNodeId === targetNodeId);
    return { ...relation, recoveredMovement: movements[0], recoveredMovements: movements,
      sourceNodeIds: movements.map(movement => movement.sourceNodeId), targetNodeId };
  });
};

export const buildPreMovementStructuralForest = (
  forest: SyntaxNode[],
  relations: DerivationReplayPlanStep[],
  previousForest: SyntaxNode[] = []
): SyntaxNode[] => {
  const structuralForest = cloneSyntaxForest(forest);
  const collectNodes = (root?: SyntaxNode | null): SyntaxNode[] => {
    if (!root)
      return [];
    const nodes: SyntaxNode[] = [];
    const visit = (node: SyntaxNode) => {
      nodes.push(node);
      (Array.isArray(node.children) ? node.children : []).forEach(visit);
    };
    visit(root);
    return nodes;
  };
  const findNode = (nodeId: string): SyntaxNode | null => {
    const normalizedNodeId = String(nodeId || '');
    if (!normalizedNodeId)
      return null;
    for (const root of structuralForest) {
      const found = collectNodes(root).find((node) => String(node.id || '') === normalizedNodeId);
      if (found)
        return found;
    }
    return null;
  };
  const findNodeInForest = (candidateForest: SyntaxNode[], nodeId: string): SyntaxNode | null => {
    const normalizedNodeId = String(nodeId || '');
    if (!normalizedNodeId)
      return null;
    for (const root of candidateForest) {
      const found = collectNodes(root).find((node) => String(node.id || '') === normalizedNodeId);
      if (found)
        return found;
    }
    return null;
  };
  const replaceStructuralNode = (nodeId: string, replacement: SyntaxNode): boolean => {
    const normalizedNodeId = String(nodeId || '');
    if (!normalizedNodeId)
      return false;
    const rootIndex = structuralForest.findIndex((root) => String(root.id || '') === normalizedNodeId);
    if (rootIndex >= 0) {
      structuralForest[rootIndex] = replacement;
      return true;
    }
    const visit = (node: SyntaxNode): boolean => {
      const children = Array.isArray(node.children) ? node.children : [];
      const childIndex = children.findIndex((child) => String(child.id || '') === normalizedNodeId);
      if (childIndex >= 0) {
        children[childIndex] = replacement;
        node.children = children;
        return true;
      }
      return children.some(visit);
    };
    return structuralForest.some(visit);
  };
  const restoreCurrentSourceState = (currentSource: SyntaxNode, previousSource: SyntaxNode): SyntaxNode | null => {
    if (String(currentSource.label || '').trim() !== String(previousSource.label || '').trim()
      && (!currentSource.lineageId || currentSource.lineageId !== previousSource.lineageId)) {
      return null;
    }
    // Before a later movement relation, the source is exactly the occurrence
    // authored in the preceding stage. This matters for remnant and roll-up
    // movement, where the relation frame relocates a previously derived subtree
    // and creates a differently shaped lower silent copy. Reusing the complete
    // prior occurrence keeps every lexical/structural change inside the movement
    // mesostep instead of leaking it into a fake construction microstep.
    const restored = cloneSyntaxTree(previousSource)!;
    const inheritedSilence = (nodeId: string, preceding: boolean): boolean => {
      const path: SyntaxNode[] = [];
      let parent = preceding ? previousLocations.get(nodeId)?.parent : findParent(nodeId);
      while (parent) {
        path.push(parent);
        parent = preceding ? previousLocations.get(parent.id)?.parent : findParent(parent.id);
      }
      return path.reverse().reduce((silent, node) => replayEffectiveSilence(node, silent), false);
    };
    const priorInherited = inheritedSilence(previousSource.id, true);
    if (priorInherited !== inheritedSilence(currentSource.id, false)) {
      (restored as PendingSourceSyntaxNode).replayPriorInheritedSilence = priorInherited;
    }
    return restored;
  };
  const findParent = (nodeId: string): SyntaxNode | null => {
    const normalizedNodeId = String(nodeId || '');
    if (!normalizedNodeId)
      return null;
    const visit = (node: SyntaxNode): SyntaxNode | null => {
      const children = Array.isArray(node.children) ? node.children : [];
      if (children.some((child) => String(child.id || '') === normalizedNodeId))
        return node;
      for (const child of children) {
        const found = visit(child);
        if (found)
          return found;
      }
      return null;
    };
    for (const root of structuralForest) {
      const found = visit(root);
      if (found)
        return found;
    }
    return null;
  };
  const previousLocations = indexExactForestNodeLocations(previousForest);
  const restoreHeadHost = (parent: SyntaxNode | null): void => {
    if (!parent || parent.children?.length !== 1)
      return;
    const precedingParent = previousLocations.get(parent.id)?.node;
    if (precedingParent) {
      if (!precedingParent.children?.length)
        replaceStructuralNode(parent.id, cloneSyntaxTree(precedingParent)!);
      return;
    }
    const host = parent.children[0];
    const prior = previousLocations.get(host.id);
    const grandparent = findParent(parent.id);
    const siblings = grandparent?.children || structuralForest;
    // Before adjunction, the receiving head is independently selected, whether
    // it came from the preceding stage or this stage's ordinary construction.
    const parentCategory = readCategoryLabel(parent.label);
    const hostCategory = readCategoryLabel(host.label);
    // Use the same open category notation that proved the head movement.
    // An independently selected Foc, Agr or other head is still available
    // before the later adjunction creates its complex.
    const newReceivingHead = !prior && parentCategory?.kind === 'head'
      && hostCategory?.kind === 'head' && parentCategory.head === hostCategory.head;
    const independentlySelectedHead = prior && !prior.parentId
      && parentCategory?.kind === 'head' && hostCategory?.kind === 'head'
      && parentCategory.head === hostCategory.head;
    if (newReceivingHead || independentlySelectedHead || (prior && prior.parentId === (grandparent?.id || '')
      && (grandparent ? prior.childIndex : prior.rootIndex) === siblings.indexOf(parent))) {
      replaceStructuralNode(parent.id, host);
    }
  };
  const precedingLandingSlot = (relation: DerivationReplayPlanStep, landing: SyntaxNode): SyntaxNode | null => {
    const parent = findParent(landing.id);
    const oldParent = parent && previousLocations.get(parent.id)?.node;
    if (!parent || !oldParent || parent.children?.length !== oldParent.children?.length)
      return null;
    const index = parent.children!.findIndex(child => child === landing);
    const slot = oldParent.children?.[index];
    // Restore only an explicitly referenced previous witness in the same
    // unchanged slot. An unrelated deletion is not part of this movement.
    if (!slot || findNode(slot.id) || !relationAnchorNodeIds(relation.priorAnchors).includes(slot.id)
      || parent.children!.some((child, i) => i !== index && child.id !== oldParent.children?.[i].id))
      return null;
    return cloneSyntaxTree(slot);
  };
  const restorePrecedingContainers = (sourceId: string): void => {
    // A rebuilt source path can differ only in its container IDs once the
    // movement is undone. Keep those exact preceding containers until the
    // relation owns their replacement. Stop at any independent tree change.
    while (sourceId) {
      const oldParent = previousLocations.get(sourceId)?.parent;
      const parent = findParent(sourceId);
      if (!oldParent || !parent)
        break;
      if (parent.id !== oldParent.id) {
        if (previousLocations.has(parent.id) || findNode(oldParent.id)
          || JSON.stringify({ ...parent, id: oldParent.id }) !== JSON.stringify(oldParent))
          break;
        replaceStructuralNode(parent.id, cloneSyntaxTree(oldParent)!);
      }
      sourceId = oldParent.id;
    }
  };
  const findAnchor = (anchors: ReplayResolvedRelationAnchor[], roles: readonly string[]): ReplayResolvedRelationAnchor | undefined => {
    const wanted = new Set(roles.map((role) => role.toLowerCase()));
    return anchors.find((anchor) => wanted.has(String(anchor.role || '').trim().toLowerCase()));
  };
  relations.flatMap(movementLandingGroups).reverse().forEach((relation) => {
    if (relation.recoveredMovement && !relation.recoveredMovement.transition)
      return;
    const anchors = Array.isArray(relation.resolvedAnchors)
      ? relation.resolvedAnchors
      : [];
    const sourceRoles = relationOwnedPhrasalSourceRoles(relation);
    const targetRoles = relationOwnedPhrasalTargetRoles(relation);
    const sourceIds = Array.from(new Set([
      ...(relation.recoveredMovements ? relation.recoveredMovements.filter(movement => movement.transition).map(movement => movement.sourceNodeId)
        : getRelationSourceNodeIds(relation)),
      ...(!relation.recoveredMovement ? findResolvedReplayAnchorsByRoles(anchors, sourceRoles)
        .map((anchor) => String(anchor.nodeId || '')) : [])
    ].filter(Boolean)));
    const targetId = String(getRelationTargetNodeId(relation)
      || findAnchor(anchors, targetRoles)?.nodeId
      || '');
    const trajectoryDisplayKind = relation.recoveredMovement?.trajectoryKind || registeredTrajectoryDisplayKind(relation.relation, relation.resolvedAnchors);
    if (trajectoryDisplayKind !== 'phrasal'
      && trajectoryDisplayKind !== 'head'
      && !relationOwnsPhrasalTreeTransition(relation))
      return;
    const movement = relation.recoveredMovement;
    const movements = relation.recoveredMovements?.filter(item => item.transition) ?? (movement ? [movement] : []);
    if (movement && movements.some(item => item.priorSourceNodeId !== item.sourceNodeId)) {
      const landing = findNode(movement.targetNodeId);
      const restoredSources = movements.map(item => {
        const before = findNodeInForest(previousForest, item.priorSourceNodeId);
        const lower = findNode(item.sourceNodeId);
        return before && lower ? restoreCurrentSourceState(lower, before) : null;
      });
      // Another claim about the same landing may already have withdrawn it;
      // this movement still restores its own source.
      const withdrawn = !landing && Boolean(findNodeInForest(forest, movement.targetNodeId));
      if ((!landing && !withdrawn) || restoredSources.some(restored => !restored))
        return;
      if (landing) {
        // The retained ID may currently be at the landing. Remove that occurrence
        // before restoring the complete prior object at its proven lower slot.
        const parent = findParent(movement.targetNodeId);
        const priorSlot = precedingLandingSlot(relation, landing);
        if (!relation.preserveMovementLanding) {
          if (priorSlot)
            replaceStructuralNode(landing.id, priorSlot);
          else if (parent)
            parent.children = parent.children?.filter(child => child !== landing);
          else
            structuralForest.splice(structuralForest.indexOf(landing), 1);
        }
        if (movement.trajectoryKind === 'head')
          restoreHeadHost(parent);
      }
      movements.forEach((item, index) => replaceStructuralNode(item.sourceNodeId, restoredSources[index]!));
      restoredSources.forEach(restored => restorePrecedingContainers(restored!.id));
      return;
    }
    const restoredFromPreviousStage = new Set<string>();
    sourceIds.forEach((sourceId) => {
      const previousSource = findNodeInForest(previousForest, sourceId);
      const currentSource = findNode(sourceId);
      if (!previousSource || !currentSource)
        return;
      const restoredSource = restoreCurrentSourceState(currentSource, previousSource);
      if (restoredSource && replaceStructuralNode(sourceId, restoredSource)) {
        restoredFromPreviousStage.add(sourceId);
      }
    });
    // The contract requires a moved occurrence to be shown in place by an
    // earlier stage. Every source is therefore restored exactly from the
    // preceding stage; when one is not there, this stage is shown as authored
    // and the movement check reports the unproven source. Nothing is
    // reconstructed from the landing.
    if (sourceIds.some((sourceId) => !restoredFromPreviousStage.has(sourceId)))
      return;
    if (relation.preserveMovementLanding)
      return;
    const sources = sourceIds
      .map((sourceId) => findNode(sourceId))
      .filter((source): source is SyntaxNode => Boolean(source));
    const target = findNode(targetId);
    if (sources.length !== sourceIds.length || sources.length === 0 || !target)
      return;
    const targetLineageId = String(target.lineageId || '');
    if (!targetLineageId || sources.some((source) => {
      const sourceLineageId = String(source.lineageId || '');
      return !sourceLineageId
        || sourceLineageId !== targetLineageId
        || source === target
        || collectNodes(source).includes(target)
        || collectNodes(target).includes(source);
    }))
      return;
    const targetParent = findParent(targetId);
    const targetRootIndex = structuralForest.findIndex((root) => String(root.id || '') === targetId);
    if (!targetParent && targetRootIndex < 0)
      return;
    const priorTarget = previousLocations.get(targetId)?.node;
    const priorSlot = precedingLandingSlot(relation, target)
      ?? (trajectoryDisplayKind === 'head' && relation.recoveredMovement && priorTarget && !sourceIds.includes(targetId)
        ? cloneSyntaxTree(priorTarget) : null);
    if (trajectoryDisplayKind === 'head' && !relation.recoveredMovement) {
      const targetChildren = Array.isArray(target.children) ? target.children : [];
      if (targetChildren.length > 0) {
        target.children = [];
      }
      else {
        delete target.word;
        target.label = String(target.label || '').trim() || '∅';
        target.silent = true;
      }
    }
    else if (priorSlot) {
      replaceStructuralNode(targetId, priorSlot);
    }
    else if (targetParent) {
      targetParent.children = (Array.isArray(targetParent.children) ? targetParent.children : [])
        .filter((child) => String(child.id || '') !== targetId);
    }
    else {
      structuralForest.splice(targetRootIndex, 1);
    }
    if (trajectoryDisplayKind === 'head' && relation.recoveredMovement)
      restoreHeadHost(targetParent);
    sourceIds.forEach(restorePrecedingContainers);
  });
  return structuralForest;
};

const relationProductionTransitionKinds = (relation: DerivationReplayPlanStep): readonly ProductionTransitionKind[] => {
  const entry = findRelationRegistryEntry(productionRelationRegistry, String(relation.relation || '').trim());
  return entry
    ? PRODUCTION_RENDER_FAMILIES[entry.id]?.transitionKinds || []
    : [];
};

export type FallbackTreeTransitionOwnership = {
  currentNodeIds: Set<string>;
  priorNodeIds: Set<string>;
  copyPairs?: Array<{ priorSourceNodeId: string; sourceNodeId: string; targetNodeId: string }>;
};

const ownNodeContent = (node: SyntaxNode): string => {
  const { children: _children, ...own } = node;
  return JSON.stringify(Object.keys(own).sort().map(key => [key, own[key as keyof typeof own]]));
};

const sameSubtree = (left: SyntaxNode, right: SyntaxNode): boolean => ownNodeContent(left) === ownNodeContent(right)
  && (left.children || []).length === (right.children || []).length
  && (left.children || []).every((child, index) => sameSubtree(child, right.children![index]));

/**
 * True when a retained witness kept its own content and exact slot, and every
 * earlier descendant, in order and under its earlier parent, and gained only
 * new nodes or whole earlier workspaces. Ordinary construction builds that
 * growth, so a relation restating the witness does not own it. A change to
 * the witness itself, including its position, still belongs to the relation.
 */
const retainedWitnessOnlyGrew = (nodeId: string, previousForest: SyntaxNode[], currentForest: SyntaxNode[]): boolean => {
  const prior = findExactNodesByIdInForest(previousForest, nodeId);
  const current = findExactNodesByIdInForest(currentForest, nodeId);
  if (prior.length !== 1 || current.length !== 1)
    return false;
  const previousLocations = indexExactForestNodeLocations(previousForest);
  const priorSlot = previousLocations.get(nodeId);
  const currentSlot = indexExactForestNodeLocations(currentForest).get(nodeId);
  if (!priorSlot || !currentSlot || priorSlot.parentId !== currentSlot.parentId
    || (priorSlot.parentId ? priorSlot.childIndex !== currentSlot.childIndex : currentSlot.parent !== null))
    return false;
  const order: string[] = [];
  const parents = new Map<string, string>();
  const nodes = new Map<string, SyntaxNode>();
  const index = (node: SyntaxNode, parentId: string) => {
    const id = String(node.id || '');
    order.push(id);
    parents.set(id, parentId);
    nodes.set(id, node);
    (node.children || []).forEach(child => index(child, id));
  };
  index(current[0], '');
  if (order.some(id => !id) || nodes.size !== order.length)
    return false;
  const dominates = (ancestorId: string, id: string) => {
    for (let parentId = parents.get(id); parentId; parentId = parents.get(parentId))
      if (parentId === ancestorId)
        return true;
    return false;
  };
  const priorIds = new Set<string>();
  let lastPosition = -1;
  const survives = (node: SyntaxNode, parentId: string): boolean => {
    const id = String(node.id || '');
    const survivor = nodes.get(id);
    const position = order.indexOf(id);
    if (!survivor || ownNodeContent(survivor) !== ownNodeContent(node) || position <= lastPosition
      || (parentId && !dominates(parentId, id)) || findExactNodesByIdInForest(currentForest, id).length !== 1)
      return false;
    priorIds.add(id);
    lastPosition = position;
    return (node.children || []).every(child => survives(child, id));
  };
  if (!survives(prior[0], ''))
    return false;
  return order.every(id => {
    if (priorIds.has(id))
      return true;
    const location = previousLocations.get(id);
    if (location === undefined)
      return true;
    // An existing node may join only with its whole earlier workspace.
    const rootId = location ? String(previousForest[location.rootIndex]?.id || '') : '';
    return Boolean(rootId) && nodes.has(rootId);
  });
};

const resolvePriorWitnessTreeTransitionOwnership = (
  relation: DerivationReplayPlanStep,
  previousForest: SyntaxNode[],
  currentForest: SyntaxNode[]
): FallbackTreeTransitionOwnership | null => {
  // A recovered chain restatement observes an already owned transition.
  if (relation.recoveredMovement)
    return null;
  if (!relation.neutralTransitionEvidence && findRelationRegistryEntry(productionRelationRegistry, String(relation.relation || '').trim()))
    return null;
  const evidence = relation.neutralTransitionEvidence ?? relation;
  const priorAnchorIds = relationAnchorNodeIds(evidence.priorAnchors);
  // Drawing the realization does not consume its ownership of the newly
  // pronounced word. Keep that proven output even when no neutral anchor remains.
  const residualCurrentIds = [...relationAnchorNodeIds(evidence.anchors),
  ...(relation.pronunciationNodeIds || [])];
  if (residualCurrentIds.length === 0)
    return null;
  const authoredCurrentIds = relationAnchorNodeIds(relation.anchors);
  const currentAnchorIds = Array.from(new Set([
    ...residualCurrentIds,
    // A recovered sibling drawing may consume the updated witness while
    // leaving its context neutral. That cannot turn the context into output.
    ...priorAnchorIds.filter(id => authoredCurrentIds.includes(id))
  ]));
  if (currentAnchorIds.length === 0 || priorAnchorIds.length === 0)
    return null;
  const currentAnchors = currentAnchorIds.map((nodeId) => findExactNodesByIdInForest(currentForest, nodeId));
  const priorAnchors = priorAnchorIds.map((nodeId) => findExactNodesByIdInForest(previousForest, nodeId));
  if (currentAnchors.some((matches) => matches.length !== 1)
    || priorAnchors.some((matches) => matches.length !== 1))
    return null;
  const retainedPriorAnchors = priorAnchorIds.every(nodeId => findExactNodesByIdInForest(currentForest, nodeId).length === 1);
  const repeatsPriorWitness = currentAnchors.some(([node]) => priorAnchorIds.includes(String(node.id || '')));
  const previousLocations = indexExactForestNodeLocations(previousForest);
  const currentLocations = indexExactForestNodeLocations(currentForest);
  const priorOccurrences = indexMovementOccurrences(previousForest);
  const currentOccurrences = indexMovementOccurrences(currentForest);
  const copyPairs = priorAnchorIds.flatMap(id => {
    const pair = sourceOccurrencePair(currentOccurrences, priorOccurrences, id, authoredCurrentIds);
    return pair && currentAnchorIds.includes(pair.source.id)
      ? [{ priorSourceNodeId: id, sourceNodeId: pair.source.id, targetNodeId: pair.landing.id }] : [];
  });
  const copiedOutputs = new Set(copyPairs.map(pair => pair.targetNodeId));
  // When the preceding witnesses still exist, they identify the material
  // being updated. Other current anchors can supply its newly built context
  // (for example a licensing clause), rather than additional transition output.
  const ownedCurrentAnchors = retainedPriorAnchors && repeatsPriorWitness
    ? currentAnchors.filter(([node]) => {
      if (priorAnchorIds.includes(String(node.id || '')))
        return !retainedWitnessOnlyGrew(String(node.id || ''), previousForest, currentForest);
      // A uniquely witnessed copy is output of the same authored change,
      // even when its category is insufficient to draw a movement trajectory.
      if (copiedOutputs.has(node.id))
        return true;
      const currentLocation = currentLocations.get(node.id);
      if (currentLocation && priorAnchorIds.some(id => {
        const previousLocation = previousLocations.get(id);
        // A new witness occupying a departed input's exact slot is part of
        // the same rewrite, even when that input survives elsewhere.
        return previousLocation && currentLocation.parentId === previousLocation.parentId
          && currentLocation.childIndex === previousLocation.childIndex
          && currentLocation.rootIndex === previousLocation.rootIndex;
      }))
        return true;
      const containsInputs = (candidate: SyntaxNode) => priorAnchorIds.every(id => collectExactSubtreeNodeIds(candidate).has(id));
      // An earlier constituent that is unchanged is not the output of a
      // rewrite of its own contents, even when ordinary construction merges it.
      const earlier = findExactNodesByIdInForest(previousForest, String(node.id || ''));
      return priorAnchorIds.length > 1 && containsInputs(node)
        && !(node.children || []).some(containsInputs)
        && !(earlier.length === 1 && sameSubtree(earlier[0], node));
    })
    : currentAnchors;
  if (ownedCurrentAnchors.length === 0)
    return null;
  const currentNodeIds = new Set(ownedCurrentAnchors.flatMap(([node]) => Array.from(collectExactSubtreeNodeIds(node))));
  const ownedCopyPairs = copyPairs.filter(pair => currentNodeIds.has(pair.sourceNodeId) && currentNodeIds.has(pair.targetNodeId));
  return {
    currentNodeIds,
    priorNodeIds: new Set(priorAnchors.flatMap(([node]) => Array.from(collectExactSubtreeNodeIds(node)))),
    ...(ownedCopyPairs.length ? { copyPairs: ownedCopyPairs } : {})
  };
};

export const resolveFallbackTreeTransitionOwnership = (
  relation: DerivationReplayPlanStep,
  previousForest: SyntaxNode[],
  currentForest: SyntaxNode[]
): FallbackTreeTransitionOwnership | null => {
  const witnessed = resolvePriorWitnessTreeTransitionOwnership(relation, previousForest, currentForest);
  if (witnessed || relation.recoveredMovement || !relation.unprovenNewLandingNodeId)
    return witnessed;
  const landing = findExactNodesByIdInForest(currentForest, relation.unprovenNewLandingNodeId);
  if (landing.length !== 1 || findExactNodesByIdInForest(previousForest, relation.unprovenNewLandingNodeId).length)
    return null;
  // The authored new occurrence has a moment even when the missing earlier
  // state prevents movement recovery. Do not restore or modify its source.
  return { currentNodeIds: collectExactSubtreeNodeIds(landing[0]), priorNodeIds: new Set() };
};

export const newReceivingHeadNodeIds = (
  movement: RecoveredMovement | undefined,
  previousForest: SyntaxNode[],
  currentForest: SyntaxNode[]
): string[] => {
  if (!movement?.transition || movement.trajectoryKind !== 'head')
    return [];
  const parentId = findParentNodeIdInForest(currentForest, movement.targetNodeId);
  const before = findExactNodeByIdInForest(previousForest, parentId);
  const after = findExactNodeByIdInForest(currentForest, parentId);
  // A retained head may become the complex's container in the completed
  // stage. Its new inner head is part of that same atomic landing.
  if (!before || before.children?.length || !after?.children?.length)
    return [];
  return after.children.filter(child => child.id !== movement.targetNodeId)
    .flatMap(child => collectSyntaxSubtreeNodeIds(child))
    .filter(id => !findExactNodeByIdInForest(previousForest, id));
};

export const receivingHeadMaterialNodeId = (
  movement: RecoveredMovement | undefined,
  previousForest: SyntaxNode[],
  currentForest: SyntaxNode[]
): string | undefined => {
  if (!movement?.transition || movement.trajectoryKind !== 'head')
    return undefined;
  const parentId = findParentNodeIdInForest(currentForest, movement.targetNodeId);
  const before = findExactNodeByIdInForest(previousForest, parentId);
  const after = findExactNodeByIdInForest(currentForest, parentId);
  return before && !before.children?.length && after?.children?.length ? parentId : undefined;
};

/**
 * Apply only the raw tree deltas witnessed by active relations.
 * A relation owns its current/prior anchor subtrees, never the whole
 * stage forest. It may add the minimum current ancestor chain needed to keep
 * those subtrees attached and retire removed prior containers exhausted by
 * those edits. Independently scheduled construction may supply additional
 * nodes, without applying another relation's pending output.
 */
export interface AnchoredTransitionInput {
  previousForest: SyntaxNode[];
  currentForest: SyntaxNode[];
  activeRelations: DerivationReplayPlanStep[];
  constructedNodeIds?: Set<string>;
  withheldNodeIds?: Set<string>;
  pendingTransitionNodeIds?: Set<string>;
}

export const buildAnchoredTreeTransitionForest = ({
  previousForest,
  currentForest,
  activeRelations,
  constructedNodeIds = new Set(),
  withheldNodeIds = new Set(),
  pendingTransitionNodeIds = new Set()
}: AnchoredTransitionInput): SyntaxNode[] => {
  const ownerships = activeRelations
    .map((relation) => {
      const movement = relation.recoveredMovement;
      if (movement?.transition) {
        return {
          currentNodeIds: new Set((relation.recoveredMovements ?? [movement]).flatMap(item => [item.sourceNodeId, item.targetNodeId,
          ...newReceivingHeadNodeIds(item, previousForest, currentForest)]).flatMap(id => {
            const node = findExactNodeByIdInForest(currentForest, id);
            return node ? [...collectExactSubtreeNodeIds(node)] : [];
          })),
          priorNodeIds: new Set((relation.recoveredMovements ?? [movement]).flatMap(item => [...collectExactSubtreeNodeIds(findExactNodeByIdInForest(previousForest, item.priorSourceNodeId)!)]))
        };
      }
      return resolveFallbackTreeTransitionOwnership(relation, previousForest, currentForest);
    })
    .filter((ownership): ownership is FallbackTreeTransitionOwnership => Boolean(ownership))
    .map(ownership => {
      if (withheldNodeIds.size === 0)
        return ownership;
      const available = (ids: Set<string>, forest: SyntaxNode[]) => new Set([...ids].filter(nodeId => !withheldNodeIds.has(nodeId) && !collectSyntaxSubtreeNodeIds(findExactNodeByIdInForest(forest, nodeId))
        .some(descendantId => withheldNodeIds.has(descendantId))));
      return {
        currentNodeIds: available(ownership.currentNodeIds, currentForest),
        priorNodeIds: available(ownership.priorNodeIds, previousForest)
      };
    });
  if (ownerships.length === 0 && constructedNodeIds.size === 0)
    return cloneSyntaxForest(previousForest);
  const activeCurrentNodeIds = new Set([...ownerships.flatMap((ownership) => Array.from(ownership.currentNodeIds)),
  ...Array.from(constructedNodeIds).filter(nodeId => !findExactNodeByIdInForest(previousForest, nodeId))]);
  const activePriorNodeIds = new Set(ownerships.flatMap((ownership) => Array.from(ownership.priorNodeIds)));
  const activeMaterialNodeIds = new Set([
    ...activeCurrentNodeIds,
    ...activeRelations.flatMap(relation => (relation.recoveredMovements ?? [relation.recoveredMovement])
      .map(movement => receivingHeadMaterialNodeId(movement, previousForest, currentForest))
      .filter((id): id is string => Boolean(id)))
  ]);
  const previousLocations = indexExactForestNodeLocations(previousForest);
  const currentLocations = indexExactForestNodeLocations(currentForest);
  const attachmentNodeIds = new Set<string>();
  activeRelations.flatMap(relation => relation.recoveredMovements ?? [relation.recoveredMovement]).forEach(movement => {
    if (!movement?.transition || movement.trajectoryKind !== 'head')
      return;
    const parent = currentLocations.get(movement.targetNodeId)?.parent;
    if (!parent || previousLocations.has(parent.id))
      return;
    // The receiving head joins the new complex at movement. Its later
    // pronunciation may belong to another relation and is left untouched here.
    parent.children?.filter(child => child.id !== movement.targetNodeId
      && previousLocations.get(child.id)).forEach(child => attachmentNodeIds.add(child.id));
  });
  const structuralNodeIds = new Set([...activeCurrentNodeIds, ...attachmentNodeIds, ...constructedNodeIds]);
  let result = cloneSyntaxForest(previousForest);
  const exactLocation = (locations: Map<string, ExactForestNodeLocation | null>, nodeId: string): ExactForestNodeLocation | null => locations.get(nodeId) || null;
  const hasOwnedAncestor = (
    location: ExactForestNodeLocation,
    ownedIds: Set<string>,
    locations: Map<string, ExactForestNodeLocation | null>,
    predicate: (nodeId: string) => boolean
  ): boolean => {
    let parentId = location.parentId;
    while (parentId) {
      if (ownedIds.has(parentId) && predicate(parentId))
        return true;
      parentId = exactLocation(locations, parentId)?.parentId || '';
    }
    return false;
  };
  const removeExactNode = (nodeId: string): SyntaxNode | null => {
    const location = exactLocation(indexExactForestNodeLocations(result), nodeId);
    if (!location)
      return null;
    if (location.parent) {
      const children = Array.isArray(location.parent.children) ? [...location.parent.children] : [];
      const [removed] = children.splice(location.childIndex, 1);
      location.parent.children = children;
      return removed || null;
    }
    const [removed] = result.splice(location.rootIndex, 1);
    return removed || null;
  };
  const insertExactNode = (node: SyntaxNode, parentId: string, childIndex: number, rootIndex: number): boolean => {
    if (!parentId) {
      result.splice(Math.min(Math.max(rootIndex, 0), result.length), 0, node);
      return true;
    }
    const parentLocation = exactLocation(indexExactForestNodeLocations(result), parentId);
    if (!parentLocation)
      return false;
    const children = Array.isArray(parentLocation.node.children)
      ? [...parentLocation.node.children]
      : [];
    children.splice(Math.min(Math.max(childIndex, 0), children.length), 0, node);
    parentLocation.node.children = children;
    return true;
  };
  const activeCurrentAncestorNodeIds = new Set<string>();
  structuralNodeIds.forEach((nodeId) => {
    let parentId = exactLocation(currentLocations, nodeId)?.parentId || '';
    while (parentId) {
      activeCurrentAncestorNodeIds.add(parentId);
      parentId = exactLocation(currentLocations, parentId)?.parentId || '';
    }
  });
  const ensureCurrentNodeShell = (nodeId: string, visiting = new Set<string>()): boolean => {
    if (!nodeId)
      return true;
    const currentLocation = exactLocation(currentLocations, nodeId);
    if (!currentLocation || visiting.has(nodeId))
      return false;
    visiting.add(nodeId);
    if (currentLocation.parentId
      && !ensureCurrentNodeShell(currentLocation.parentId, visiting))
      return false;
    const resultLocation = exactLocation(indexExactForestNodeLocations(result), nodeId);
    if (resultLocation) {
      if (resultLocation.parentId !== currentLocation.parentId) {
        const detachedNode = removeExactNode(nodeId);
        if (!detachedNode || !insertExactNode(detachedNode, currentLocation.parentId, currentLocation.childIndex, currentLocation.rootIndex))
          return false;
      }
      visiting.delete(nodeId);
      return true;
    }
    const currentMaterial = { ...currentLocation.node };
    delete currentMaterial.children;
    const shell = structuredClone(currentMaterial) as SyntaxNode;
    shell.children = [];
    if (!insertExactNode(shell, currentLocation.parentId, currentLocation.childIndex, currentLocation.rootIndex))
      return false;
    const currentChildren = Array.isArray(currentLocation.node.children)
      ? currentLocation.node.children
      : [];
    // Inserting a parent around an existing sibling occupies that sibling's
    // old slot. Attach its preceding contents with the relation's output;
    // otherwise the old child remains beside the new parent until Stage Record.
    // Separate workspaces and another relation's pending inputs are not part
    // of this local attachment.
    const retainedChildren = previousLocations.has(nodeId) ? [] : currentChildren.filter(child => {
      const previous = exactLocation(previousLocations, child.id);
      return currentLocation.parentId && previous?.parentId === currentLocation.parentId;
    });
    const replacesConsecutiveChildren = retainedChildren.every((child, offset) => exactLocation(previousLocations, child.id)?.childIndex === currentLocation.childIndex + offset);
    const retainedChildIds = new Set(replacesConsecutiveChildren ? retainedChildren
      .filter(child => ![...collectExactSubtreeNodeIds(child),
      ...collectExactSubtreeNodeIds(exactLocation(previousLocations, child.id)!.node)].some(id => withheldNodeIds.has(id) || pendingTransitionNodeIds.has(id)))
      .map(child => child.id) : []);
    for (const [childIndex, child] of currentChildren.entries()) {
      const childId = String(child.id || '');
      if (!childId)
        continue;
      if (!structuralNodeIds.has(childId)
        && !activeCurrentAncestorNodeIds.has(childId)
        && !retainedChildIds.has(childId))
        continue;
      const existingChild = exactLocation(indexExactForestNodeLocations(result), childId);
      if (!existingChild)
        continue;
      const detachedChild = removeExactNode(childId);
      if (!detachedChild || !insertExactNode(detachedChild, nodeId, childIndex, currentLocation.rootIndex))
        return false;
    }
    visiting.delete(nodeId);
    return true;
  };
  const removedNodeIds = Array.from(activePriorNodeIds).filter((nodeId) => Boolean(exactLocation(previousLocations, nodeId))
    && !exactLocation(currentLocations, nodeId));
  const movedNodeIds = Array.from(new Set([
    ...structuralNodeIds,
    ...activePriorNodeIds
  ])).filter((nodeId) => {
    const previous = exactLocation(previousLocations, nodeId);
    const current = exactLocation(currentLocations, nodeId);
    return Boolean(previous && current) && (previous!.parentId !== current!.parentId
      || (previous!.parentId === current!.parentId && previous!.childIndex !== current!.childIndex));
  });
  const topLevelMovedNodeIds = movedNodeIds
    .filter((nodeId) => {
      const location = exactLocation(currentLocations, nodeId);
      return Boolean(location) && !hasOwnedAncestor(location!, activeCurrentNodeIds, currentLocations, (ancestorId) => movedNodeIds.includes(ancestorId));
    })
    .sort((left, right) => ((exactLocation(currentLocations, left)?.depth || 0)
      - (exactLocation(currentLocations, right)?.depth || 0)));
  const addedNodeIds = Array.from(activeCurrentNodeIds).filter((nodeId) => Boolean(exactLocation(currentLocations, nodeId))
    && !exactLocation(previousLocations, nodeId));
  const topLevelAddedNodeIds = addedNodeIds
    .filter((nodeId) => {
      const location = exactLocation(currentLocations, nodeId);
      return Boolean(location) && !hasOwnedAncestor(location!, activeCurrentNodeIds, currentLocations, (ancestorId) => addedNodeIds.includes(ancestorId));
    })
    .sort((left, right) => ((exactLocation(currentLocations, left)?.depth || 0)
      - (exactLocation(currentLocations, right)?.depth || 0)));
  // A newly constructed ancestor may contain an existing subtree whose owned
  // output is also new. Complete those outputs before copying the ancestor.
  const addedCompletionNodeIds = constructedNodeIds.size > 0
    ? [...addedNodeIds].sort((left, right) => (exactLocation(currentLocations, right)?.depth || 0)
      - (exactLocation(currentLocations, left)?.depth || 0))
    : topLevelAddedNodeIds;
  const destinationParentIds = Array.from(new Set([
    ...topLevelMovedNodeIds,
    ...addedCompletionNodeIds
  ].map((nodeId) => exactLocation(currentLocations, nodeId)?.parentId || '')
    .filter(Boolean)));
  if (destinationParentIds.some((parentId) => !ensureCurrentNodeShell(parentId))) {
    return cloneSyntaxForest(previousForest);
  }
  removedNodeIds
    .filter((nodeId) => {
      const location = exactLocation(previousLocations, nodeId);
      return Boolean(location) && !hasOwnedAncestor(location!, activePriorNodeIds, previousLocations, (ancestorId) => removedNodeIds.includes(ancestorId));
    })
    .sort((left, right) => ((exactLocation(previousLocations, right)?.depth || 0)
      - (exactLocation(previousLocations, left)?.depth || 0)))
    .forEach((nodeId) => removeExactNode(nodeId));
  topLevelMovedNodeIds
    .forEach((nodeId) => {
      const destination = exactLocation(currentLocations, nodeId);
      if (destination?.parentId
        && !exactLocation(indexExactForestNodeLocations(result), destination.parentId))
        return;
      const moved = removeExactNode(nodeId);
      if (!destination || !moved)
        return;
      insertExactNode(moved, destination.parentId, destination.childIndex, destination.rootIndex);
    });
  const cloneAvailableSubtree = (node: SyntaxNode): SyntaxNode | null => {
    if (!activeCurrentNodeIds.has(node.id)) {
      return cloneSyntaxTree(exactLocation(indexExactForestNodeLocations(result), node.id)?.node);
    }
    return {
      ...structuredClone(node), ...(node.children ? {
        children: node.children.map(cloneAvailableSubtree).filter((child): child is SyntaxNode => Boolean(child))
      } : {})
    };
  };
  addedCompletionNodeIds
    .forEach((nodeId) => {
      const destination = exactLocation(currentLocations, nodeId);
      if (!destination)
        return;
      const shell = exactLocation(indexExactForestNodeLocations(result), nodeId);
      if (shell) {
        // Ancestor construction may already have attached existing children.
        // Finish only the available contents of the added subtree.
        Object.assign(shell.node, cloneAvailableSubtree(destination.node));
        return;
      }
      insertExactNode(cloneAvailableSubtree(destination.node) || destination.node, destination.parentId, destination.childIndex, destination.rootIndex);
    });
  Array.from(activeMaterialNodeIds).forEach((nodeId) => {
    const previous = exactLocation(previousLocations, nodeId);
    const current = exactLocation(currentLocations, nodeId);
    if (!previous || !current)
      return;
    if (syntaxNodeMaterialSignature(previous.node) === syntaxNodeMaterialSignature(current.node))
      return;
    const resultLocation = exactLocation(indexExactForestNodeLocations(result), nodeId);
    if (!resultLocation)
      return;
    const children = resultLocation.node.children;
    const currentMaterial = { ...current.node };
    delete currentMaterial.children;
    Object.keys(resultLocation.node).forEach((key) => {
      if (key !== 'children') {
        delete (resultLocation.node as unknown as Record<string, unknown>)[key];
      }
    });
    Object.assign(resultLocation.node, structuredClone(currentMaterial));
    if (children)
      resultLocation.node.children = children;
  });
  const pruneExhaustedPriorContainers = (forest: SyntaxNode[]): SyntaxNode[] => forest.filter((node) => {
    if (Array.isArray(node.children)) {
      node.children = pruneExhaustedPriorContainers(node.children);
    }
    const nodeId = String(node.id || '');
    const prior = exactLocation(previousLocations, nodeId);
    // Never infer deletion of an authored empty item or a surviving parent.
    // An absent former container can disappear only after its owned children
    // have actually left; any unowned sibling keeps it in this frame.
    return currentLocations.has(nodeId)
      || !prior?.node.children?.length
      || Boolean(node.children?.length);
  });
  return pruneExhaustedPriorContainers(result);
};

export const relationOwnsNonMovementTreeTransition = (
  relation: DerivationReplayPlanStep,
  previousForest: SyntaxNode[] = [],
  currentForest: SyntaxNode[] = []
): boolean => {
  if (relation.recoveredMovement?.transition)
    return false;
  const relationName = String(relation.relation || '').trim();
  const registryEntry = findRelationRegistryEntry(productionRelationRegistry, relationName);
  if (!registryEntry || relation.neutralTransitionEvidence) {
    return Boolean(resolveFallbackTreeTransitionOwnership(relation, previousForest, currentForest));
  }
  const transitionKinds = relationProductionTransitionKinds(relation);
  const nonMovementKinds = transitionKinds.filter((kind) => kind !== 'movement');
  if (nonMovementKinds.length === 0)
    return false;
  return true;
};

export const movementLandingWrapper = (
  currentForest: SyntaxNode[],
  previousForest: SyntaxNode[],
  landingNodeId: string
): {
  parentId: string;
  wrapperId: string;
} | null => {
  const parentId = findParentNodeIdInForest(currentForest, landingNodeId);
  const currentParent = findNodeByIdInForest(currentForest, parentId);
  const previousParent = findNodeByIdInForest(previousForest, parentId);
  const previousChildren = previousParent?.children || [];
  const currentChildren = currentParent?.children || [];
  if (previousChildren.length < 2 || currentChildren.length !== 2)
    return null;
  const wrapper = currentChildren.find(child => child.id !== landingNodeId);
  if (!wrapper || wrapper.children?.length !== previousChildren.length)
    return null;
  if (!wrapper.children.every((child, index) => child.id === previousChildren[index].id))
    return null;
  return { parentId, wrapperId: wrapper.id };
};
