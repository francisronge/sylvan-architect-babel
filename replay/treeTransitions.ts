/** Reconstruct relation-owned changes between completed forests atomically. */
import { type SyntaxNode } from '../types.ts';
import { readCategoryLabel } from './categoryLabel.ts';
import {
  findResolvedReplayAnchorByRoles,
  findResolvedReplayAnchorsByRoles,
  getRelationAllAnchorNodeIds,
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
import { type DerivationReplayPlanStep } from './types.ts';

// Dispatch has already resolved the authored name and validated its signature.
export const relationOwnsPhrasalTreeTransition = (relation: DerivationReplayPlanStep): boolean => relation.registeredEntryId === 'qr.covert';

/** The registered QR roles naming its lower (pronounced) and raised (LF) occurrences. */
export const QR_SOURCE_ROLES = ['pronouncedQP', 'source'] as const;
export const QR_TARGET_ROLES = ['lfQP', 'target'] as const;

export const relationOwnedPhrasalSourceRoles = (relation: DerivationReplayPlanStep): readonly string[] => relationOwnsPhrasalTreeTransition(relation) ? QR_SOURCE_ROLES : TRAJECTORY_SOURCE_ROLES;

export const relationOwnedPhrasalTargetRoles = (relation: DerivationReplayPlanStep): readonly string[] => relationOwnsPhrasalTreeTransition(relation) ? QR_TARGET_ROLES : TRAJECTORY_TARGET_ROLES;

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
  previousForest: SyntaxNode[] = [],
  /** The completed stage, when `forest` holds only part of it. */
  currentForest: SyntaxNode[] = forest
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
  // `proven`: recovered movement evidence already identified previousSource as
  // the preceding occurrence of currentSource (movementEvidence.ts), so a lower
  // copy relabelled as a trace still restores it.
  const restoreCurrentSourceState = (currentSource: SyntaxNode, previousSource: SyntaxNode, proven = false): SyntaxNode | null => {
    if (!proven && String(currentSource.label || '').trim() !== String(previousSource.label || '').trim()
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
  // A partial forest can omit a pending head landing while construction has
  // already placed the receiving head inside the landing's new complex.
  // Before the movement, that head stands alone.
  const restoreAbsentHeadLandingHost = (movement?: RecoveredMovement): void => {
    if (movement?.trajectoryKind === 'head' && !findNode(movement.targetNodeId))
      restoreHeadHost(findNode(findParentNodeIdInForest(currentForest, movement.targetNodeId)));
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
      || findResolvedReplayAnchorByRoles(anchors, targetRoles)?.nodeId
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
        return before && lower ? restoreCurrentSourceState(lower, before, true) : null;
      });
      // Another claim about the same landing may already have withdrawn it;
      // this movement still restores its own source.
      const withdrawn = !landing && Boolean(findNodeInForest(forest, movement.targetNodeId));
      if (!landing && !withdrawn)
        restoreAbsentHeadLandingHost(movement);
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
    if (!target)
      restoreAbsentHeadLandingHost(relation.recoveredMovement);
    if (sources.length !== sourceIds.length || sources.length === 0 || !target)
      return;
    const targetLineageId = String(target.lineageId || '');
    // A source's lineage is the one its stage authors: the lineage may be
    // declared as its first copy is made, which the restored preceding form lacks.
    if (!targetLineageId || sources.some((source) => {
      const sourceLineageId = String(findNodeInForest(currentForest, source.id)?.lineageId || source.lineageId || '');
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

/**
 * What one neutral claim's moment owns. The node sets are its output and
 * input; `copyPairs` say which earlier occurrence each new occurrence
 * continues, so later-owned pronunciation keeps that occurrence's preceding
 * form. `ambiguousCopyNodeIds` are new occurrences with several candidate
 * earlier occurrences: none of their forms stands in for a later owner's.
 * `hostNodeIds` and `attachments` are completed for the stage by
 * `planNeutralTransitionAttachments`.
 */
export type FallbackTreeTransitionOwnership = {
  currentNodeIds: Set<string>;
  priorNodeIds: Set<string>;
  copyPairs?: Array<{ priorSourceNodeId: string; sourceNodeId: string; targetNodeId: string }>;
  ambiguousCopyNodeIds?: string[];
  /** The new parents the moment introduces with its output. */
  hostNodeIds?: string[];
  /** Each preceding node such a parent attaches at the moment. `retained`
   * when it keeps its outer slot and changes only inside this claim's output,
   * which licenses its rigid motion. */
  attachments?: Array<{ host: string; wrapper: string; retained: boolean }>;
};

const ownNodeContent = (node: SyntaxNode): string => {
  const { children: _children, ...own } = node;
  return JSON.stringify(Object.keys(own).sort().map(key => [key, own[key as keyof typeof own]]));
};

const sameSubtree = (left: SyntaxNode, right: SyntaxNode): boolean => ownNodeContent(left) === ownNodeContent(right)
  && (left.children || []).length === (right.children || []).length
  && (left.children || []).every((child, index) => sameSubtree(child, right.children![index]));

type ForestLocations = Map<string, ExactForestNodeLocation | null>;

/**
 * Whether a preceding occurrence changes in the stage: it is removed or
 * repeated, its subtree changes, or it leaves its parent for another. A
 * preceding root that gains a parent is merged, not displaced.
 */
const displacedInStage = (
  node: SyntaxNode,
  previous: ForestLocations,
  current: ForestLocations
): boolean => {
  const before = previous.get(String(node.id || '')), after = current.get(String(node.id || ''));
  return !after || !sameSubtree(node, after.node) || Boolean(before?.parentId) && before!.parentId !== after.parentId;
};

/**
 * `displacedInStage`, apart from what the stage's recovered movements change.
 * An occurrence they relate (`moved`) that keeps its subtree and only leaves its
 * parent moves with them, an earlier one they replace is theirs, and a slot
 * whose earlier and current children are both their occurrences holds the copy
 * they exchanged. Any other change displaces the node.
 */
const displacedOutsideMovements = (
  node: SyntaxNode,
  previous: ForestLocations,
  current: ForestLocations,
  moved: ReadonlySet<string>
): boolean => {
  if (!moved.size)
    return displacedInStage(node, previous, current);
  const before = previous.get(String(node.id || '')), after = current.get(String(node.id || ''));
  if (!after)
    return !moved.has(String(node.id || ''));
  const unchanged = (left: SyntaxNode, right: SyntaxNode): boolean => ownNodeContent(left) === ownNodeContent(right)
    && (left.children || []).length === (right.children || []).length
    && (left.children || []).every((child, index) => moved.has(String(child.id || '')) && moved.has(String(right.children![index].id || ''))
      || unchanged(child, right.children![index]));
  return !unchanged(node, after.node)
    || Boolean(before?.parentId) && before!.parentId !== after.parentId && !moved.has(String(node.id || ''));
};

/**
 * True when a retained witness kept its own content and exact slot, and every
 * earlier descendant, in order and under its earlier parent, and gained only
 * new nodes or whole earlier workspaces. Ordinary construction builds that
 * growth, so a relation restating the witness does not own it. A change to
 * the witness itself, including its position, still belongs to the relation;
 * `witnessOnlyWrapped` covers a new parent that takes over the witness's slot.
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

/**
 * True when a retained witness's interior is unchanged apart from the stage's
 * recovered movements (`movementOwned`). Every other earlier descendant keeps
 * its own content, its order, and its earlier parent, with only
 * movement-owned new nodes between them, and everything new inside the
 * witness is movement-owned.
 */
const witnessInteriorPreserved = (before: SyntaxNode, after: SyntaxNode, movementOwned: ReadonlySet<string>,
  previousLocations: ForestLocations, currentLocations: ForestLocations): boolean => {
  const earlier = collectExactSubtreeNodeIds(before);
  const preserved = [...earlier].filter(id => id === before.id || !movementOwned.has(id));
  const now = [...collectExactSubtreeNodeIds(after)];
  if (now.some(id => !earlier.has(id) && !movementOwned.has(id)))
    return false;
  const kept = new Set(preserved);
  if (JSON.stringify(now.filter(id => kept.has(id))) !== JSON.stringify(preserved))
    return false;
  return preserved.every((id) => {
    const prior = previousLocations.get(id), current = currentLocations.get(id);
    if (!prior || !current || ownNodeContent(prior.node) !== ownNodeContent(current.node))
      return false;
    if (id === before.id)
      return true;
    for (let parentId = current.parentId; parentId !== prior.parentId; parentId = currentLocations.get(parentId)?.parentId ?? '')
      if (!parentId || previousLocations.has(parentId))
        return false;
    return true;
  });
};

/** Every node a claim names, in any of its anchor fields. */
const claimNodeIds = (relation: DerivationReplayPlanStep): string[] => [
  ...relationAnchorNodeIds(relation.anchors), ...relationAnchorNodeIds(relation.priorAnchors),
  ...relationAnchorNodeIds(relation.neutralTransitionEvidence?.anchors),
  ...relationAnchorNodeIds(relation.neutralTransitionEvidence?.priorAnchors),
  ...getRelationAllAnchorNodeIds(relation), ...(relation.pronunciationNodeIds ?? []),
  ...(relation.unprovenNewLandingNodeId ? [relation.unprovenNewLandingNodeId] : [])
];

/**
 * Whether a claim may own a change besides a recovered movement's: a
 * pronunciation or an unproven landing, or, without a movement transition, a
 * transition its relation registers, a preceding witness, or a new anchored
 * node with a lineage, which could be a copy.
 */
const claimMayOwnChange = (relation: DerivationReplayPlanStep, previousForest: SyntaxNode[], currentForest: SyntaxNode[]): boolean => {
  if (relation.pronunciationNodeIds?.length || relation.unprovenNewLandingNodeId)
    return true;
  if ((relation.recoveredMovements ?? [relation.recoveredMovement]).some(movement => movement?.transition))
    return false;
  return relationProductionTransitionKinds(relation).some(kind => kind !== 'movement')
    || relationAnchorNodeIds(relation.priorAnchors).length > 0
    || relationAnchorNodeIds(relation.neutralTransitionEvidence?.priorAnchors).length > 0
    || relationAnchorNodeIds(relation.anchors).some(id => !findExactNodesByIdInForest(previousForest, id).length
      && findExactNodesByIdInForest(currentForest, id).some(node => Boolean(node.lineageId)));
};

/**
 * True when `wrapper` is the only new or changed material around a claim's
 * one preceding witness, apart from what the stage's recovered movements own
 * at their moments (`movementOwned`). The wrapper is new and is no movement's
 * landing parent or copy of an earlier object. It holds the witness's slot:
 * both are workspace roots, in any order among the other roots, or the wrapper
 * stands where the witness stood among its earlier parent's children. Its
 * children are the witness and one or more earlier workspaces that join whole
 * and unchanged. The witness keeps its own content and its interior
 * (`witnessInteriorPreserved`). Neither this claim (beyond the wrapper and the
 * witness) nor any other claim that can own a change names that material, its
 * earlier form, or an ancestor of either. Every other node this claim names is
 * context it then only observes: earlier material, unchanged and under its
 * earlier parent. Anything else keeps the claim's atomic rewrite.
 */
const witnessOnlyWrapped = (wrapper: SyntaxNode, witnessId: string, claimIds: readonly string[],
  otherClaims: readonly DerivationReplayPlanStep[], movementOwned: ReadonlySet<string>,
  previousForest: SyntaxNode[], currentForest: SyntaxNode[]): boolean => {
  const previousLocations = indexExactForestNodeLocations(previousForest), currentLocations = indexExactForestNodeLocations(currentForest);
  const slot = currentLocations.get(wrapper.id), before = previousLocations.get(witnessId), after = currentLocations.get(witnessId);
  if (!slot || previousLocations.has(wrapper.id) || movementOwned.has(wrapper.id) || !before || !after || after.parentId !== wrapper.id
    || (wrapper.lineageId && [...previousLocations.values()].some(location => location?.node.lineageId === wrapper.lineageId)))
    return false;
  const childIds = (location: ExactForestNodeLocation) => (location.parent?.children ?? []).map(child => child.id);
  if (before.parentId !== slot.parentId || (slot.parentId
    && JSON.stringify(childIds(slot).map(id => id === wrapper.id ? witnessId : id)) !== JSON.stringify(childIds(before))))
    return false;
  const joining = (wrapper.children ?? []).filter(child => child.id !== witnessId);
  if (!joining.length || joining.some((child) => {
    const earlier = previousLocations.get(child.id);
    return !earlier || Boolean(earlier.parentId) || !sameSubtree(earlier.node, child)
      || [...collectExactSubtreeNodeIds(child)].some(id => !currentLocations.get(id) || movementOwned.has(id));
  }))
    return false;
  if (ownNodeContent(before.node) !== ownNodeContent(after.node)
    || !witnessInteriorPreserved(before.node, after.node, movementOwned, previousLocations, currentLocations))
    return false;
  const region = new Set([...collectExactSubtreeNodeIds(wrapper), ...collectExactSubtreeNodeIds(before.node),
    ...joining.flatMap(child => [...collectExactSubtreeNodeIds(previousLocations.get(child.id)!.node)])]);
  for (let id = slot.parentId; id; id = currentLocations.get(id)?.parentId ?? '')
    region.add(id);
  for (let id = before.parentId; id; id = previousLocations.get(id)?.parentId ?? '')
    region.add(id);
  const unchangedInPlace = (id: string) => {
    const prior = previousLocations.get(id), current = currentLocations.get(id);
    return Boolean(prior && current) && prior!.parentId === current!.parentId && sameSubtree(prior!.node, current!.node);
  };
  return !claimIds.some(id => id !== wrapper.id && id !== witnessId && (region.has(id) || !unchangedInPlace(id)))
    && !otherClaims.some(other => claimMayOwnChange(other, previousForest, currentForest)
      && claimNodeIds(other).some(id => region.has(id)));
};

/**
 * Whether a claim's change is neutral output. A claim restating a recovered
 * movement observes a transition that movement's own moment owns, in this
 * stage or an earlier one, and a registered recipe owns its claim's change.
 * A movement whose kind the recipe refuses, and that no other claim applies
 * (`refusedMovementTransition`), has neither owner, so its claim's change
 * stays neutral, like a claim that fell to Tier 3 or names no registered
 * relation.
 */
const ownsNeutralChange = (relation: DerivationReplayPlanStep): boolean => relation.refusedMovementTransition
  || !relation.recoveredMovement && (Boolean(relation.neutralTransitionEvidence)
    || !findRelationRegistryEntry(productionRelationRegistry, String(relation.relation || '').trim()));

/** The preceding witnesses and current anchors of a neutral claim that names both. */
const priorWitnessClaim = (relation: DerivationReplayPlanStep) => {
  if (!ownsNeutralChange(relation))
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
  return { priorAnchorIds, authoredCurrentIds, currentAnchorIds };
};

/**
 * The current anchor of a prior-witness claim that only wrapped its one
 * retained witness (`witnessOnlyWrapped`), which ordinary construction then
 * builds. `otherClaims` are the stage's other claims; `movementOwned` is what
 * its recovered movements own at their moments: their current landing and
 * lower-occurrence subtrees and the landing parent each introduces.
 * `getFrameRelations` records the result as the step's `witnessWrapperNodeIds`,
 * so every ownership query of the stage agrees.
 */
export const priorWitnessWrapperNodeIds = (
  relation: DerivationReplayPlanStep,
  otherClaims: readonly DerivationReplayPlanStep[],
  previousForest: SyntaxNode[],
  currentForest: SyntaxNode[],
  movementOwned: ReadonlySet<string>
): string[] => {
  const claim = priorWitnessClaim(relation);
  const witnessIds = new Set([...claim?.priorAnchorIds ?? [], ...relationAnchorNodeIds(relation.priorAnchors)]);
  if (!claim || witnessIds.size !== 1 || relation.pronunciationNodeIds?.length || relation.unprovenNewLandingNodeId)
    return [];
  const [witnessId] = witnessIds;
  const claimIds = [...new Set([...claimNodeIds(relation), ...claim.currentAnchorIds])];
  if (claim.currentAnchorIds.includes(witnessId) || claim.authoredCurrentIds.includes(witnessId))
    return [];
  return claim.currentAnchorIds.filter((id) => {
    const matches = findExactNodesByIdInForest(currentForest, id);
    return matches.length === 1 && witnessOnlyWrapped(matches[0], witnessId, claimIds, otherClaims, movementOwned, previousForest, currentForest);
  });
};

const resolvePriorWitnessTreeTransitionOwnership = (
  relation: DerivationReplayPlanStep,
  previousForest: SyntaxNode[],
  currentForest: SyntaxNode[]
): FallbackTreeTransitionOwnership | null => {
  const claim = priorWitnessClaim(relation);
  if (!claim)
    return null;
  const { priorAnchorIds, authoredCurrentIds, currentAnchorIds } = claim;
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
  // When the stage displaces no earlier node the claim covers (its witnesses,
  // its current anchors, the earlier material inside them, and the earlier
  // occurrences of a new node's lineage there), that material is merged as it
  // was: the stage's construction builds what now contains it, and the claim
  // owns only a copy it relates to its witnesses. What the stage's recovered
  // movements change is theirs, not this claim's displacement.
  const coveredCurrentIds = currentAnchors.flatMap(([node]) => [...collectExactSubtreeNodeIds(node)]);
  const copiedLineages = new Set(coveredCurrentIds.filter(id => !previousLocations.has(id))
    .map(id => currentLocations.get(id)?.node.lineageId).filter(Boolean));
  const coveredEarlierIds = new Set([...priorAnchorIds, ...coveredCurrentIds, ...[...previousLocations]
    .filter(([, location]) => location?.node.lineageId && copiedLineages.has(location.node.lineageId)).map(([id]) => id)]
    .filter(id => previousLocations.has(id)));
  const movementOccurrences = new Set(relation.movementOccurrenceNodeIds ?? []);
  const rewritesWitness = !retainedPriorAnchors || [...coveredEarlierIds].some(id => {
    const earlier = previousLocations.get(id);
    return !earlier || displacedOutsideMovements(earlier.node, previousLocations, currentLocations, movementOccurrences);
  });
  // When the preceding witnesses still exist, they identify the material
  // being updated. Other current anchors can supply its newly built context
  // (for example a licensing clause), rather than additional transition output.
  // A current anchor that only wrapped the retained witness restates it too.
  const wrappers = new Set(relation.witnessWrapperNodeIds ?? []);
  const wrapsPriorWitness = currentAnchors.some(([node]) => wrappers.has(node.id));
  const ownedCurrentAnchors = !rewritesWitness ? currentAnchors.filter(([node]) => copiedOutputs.has(node.id))
    : retainedPriorAnchors && (repeatsPriorWitness || wrapsPriorWitness)
    ? currentAnchors.filter(([node]) => {
      if (priorAnchorIds.includes(String(node.id || '')))
        return !retainedWitnessOnlyGrew(String(node.id || ''), previousForest, currentForest);
      if (wrappers.has(node.id))
        return false;
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

/** The same syntax and words, ignoring ids and which occurrence is pronounced or addressed. */
const sameMaterial = (left: SyntaxNode, right: SyntaxNode): boolean => {
  const own = ({ id: _id, children: _children, silent: _silent, tokenIndex: _tokenIndex, ...rest }: SyntaxNode) =>
    JSON.stringify(Object.keys(rest).sort().map(key => [key, rest[key as keyof typeof rest]]));
  return own(left) === own(right) && (left.children || []).length === (right.children || []).length
    && (left.children || []).every((child, index) => sameMaterial(child, right.children![index]));
};

/**
 * The occurrences a neutral claim establishes by relating them to an earlier
 * occurrence of the same object. A new anchored node is a copy when the claim
 * also anchors a preceding occurrence of its lineage that is displaced in this
 * stage (removed, rewritten, re-pronounced or given another parent) or whose
 * complete material the new node repeats where Internal Merge puts it; a
 * shared lineage alone, as for an identity or coreference observation over
 * different material, establishes nothing. Each copy names its earlier
 * occurrence when one candidate, or one displaced candidate, identifies it.
 * `earlierNodeIds` are the displaced occurrences, which change with the copy
 * and keep their preceding form until its moment. `claimedNodeIds`, what the
 * stage's recovered movements and earlier claims already own, are excluded.
 * Relation and field names play no part.
 */
export const anchoredCopyDisplacement = (
  relation: DerivationReplayPlanStep,
  previousForest: SyntaxNode[],
  currentForest: SyntaxNode[],
  claimedNodeIds: ReadonlySet<string> = new Set()
): DerivationReplayPlanStep['anchoredCopyDisplacement'] => {
  if (!ownsNeutralChange(relation))
    return undefined;
  const unique = (forest: SyntaxNode[], id: string): SyntaxNode | undefined => {
    const matches = findExactNodesByIdInForest(forest, id);
    return matches.length === 1 ? matches[0] : undefined;
  };
  const previous = indexExactForestNodeLocations(previousForest), current = indexExactForestNodeLocations(currentForest);
  const displaced = (node: SyntaxNode): boolean => displacedInStage(node, previous, current);
  const currentIds = [...new Set(relationAnchorNodeIds(relation.anchors))];
  const earlier = [...new Set([...currentIds, ...relationAnchorNodeIds(relation.priorAnchors)])]
    .map(id => unique(previousForest, id))
    .filter((node): node is SyntaxNode => Boolean(node?.lineageId));
  // A repeat is a copy only where Internal Merge puts it: merged beside an
  // object that contains the earlier occurrence. A repeat merged elsewhere,
  // such as an occurrence shared across conjuncts, is built there, even when
  // the stage then joins the conjuncts beneath one root.
  const repeatedInPlace = (occurrence: SyntaxNode, node: SyntaxNode): boolean => {
    const at = current.get(String(node.id || ''));
    return sameMaterial(occurrence, node) && (at?.parent?.children || [])
      .some(sister => sister !== at!.node && collectExactSubtreeNodeIds(sister).has(occurrence.id));
  };
  const copies = currentIds
    .filter(id => !claimedNodeIds.has(id) && !findExactNodesByIdInForest(previousForest, id).length)
    .map(id => unique(currentForest, id))
    .flatMap((node) => {
      const candidates = node?.lineageId ? earlier.filter(occurrence => occurrence.lineageId === node.lineageId
        && (displaced(occurrence) || repeatedInPlace(occurrence, node))) : [];
      if (!node || !candidates.length)
        return [];
      const sources = candidates.length === 1 ? candidates : candidates.filter(displaced);
      return [{ nodeId: node.id, ...(sources.length === 1 ? { earlierNodeId: sources[0].id } : {}) }];
    });
  if (copies.length === 0)
    return undefined;
  const lineages = new Set(copies.map(copy => unique(currentForest, copy.nodeId)!.lineageId));
  return {
    copies,
    earlierNodeIds: earlier.filter(node => lineages.has(node.lineageId) && !claimedNodeIds.has(node.id) && displaced(node))
      .map(node => node.id)
  };
};

const resolveAnchoredCopyOwnership = (
  relation: DerivationReplayPlanStep,
  previousForest: SyntaxNode[],
  currentForest: SyntaxNode[]
): FallbackTreeTransitionOwnership | null => {
  const displacement = relation.anchoredCopyDisplacement;
  if (!displacement)
    return null;
  const subtree = (forest: SyntaxNode[], id: string) => {
    const node = findExactNodeByIdInForest(forest, id);
    return node ? [...collectExactSubtreeNodeIds(node)] : [];
  };
  const previous = indexExactForestNodeLocations(previousForest), current = indexExactForestNodeLocations(currentForest);
  // An earlier occurrence that keeps its id at a new parent is the landing,
  // and the copy is its lower occurrence; otherwise the copy is the landing.
  const copyPairs = displacement.copies.flatMap(({ nodeId, earlierNodeId }) => {
    if (!earlierNodeId)
      return [];
    const before = previous.get(earlierNodeId), after = current.get(earlierNodeId);
    const keptAtLanding = Boolean(after && before?.parentId && before.parentId !== after.parentId);
    return [keptAtLanding ? { priorSourceNodeId: earlierNodeId, sourceNodeId: nodeId, targetNodeId: earlierNodeId }
      : { priorSourceNodeId: earlierNodeId, sourceNodeId: current.get(earlierNodeId) ? earlierNodeId : nodeId, targetNodeId: nodeId }];
  });
  const ambiguousCopyNodeIds = displacement.copies.filter(copy => !copy.earlierNodeId).map(copy => copy.nodeId);
  const currentNodeIds = new Set([...displacement.copies.map(copy => copy.nodeId), ...displacement.earlierNodeIds]
    .flatMap(id => subtree(currentForest, id)));
  return currentNodeIds.size ? {
    currentNodeIds,
    priorNodeIds: new Set(displacement.earlierNodeIds.flatMap(id => subtree(previousForest, id))),
    ...(copyPairs.length ? { copyPairs } : {}),
    ...(ambiguousCopyNodeIds.length ? { ambiguousCopyNodeIds } : {})
  } : null;
};

export const resolveFallbackTreeTransitionOwnership = (
  relation: DerivationReplayPlanStep,
  previousForest: SyntaxNode[],
  currentForest: SyntaxNode[]
): FallbackTreeTransitionOwnership | null => {
  if (relation.recoveredMovement && !relation.refusedMovementTransition)
    return null;
  const witnessed = resolvePriorWitnessTreeTransitionOwnership(relation, previousForest, currentForest);
  const copied = resolveAnchoredCopyOwnership(relation, previousForest, currentForest);
  if (witnessed && copied) {
    const copyPairs = [...witnessed.copyPairs ?? [], ...(copied.copyPairs ?? [])
      .filter(pair => !witnessed.copyPairs?.some(other => other.targetNodeId === pair.targetNodeId))];
    return {
      currentNodeIds: new Set([...witnessed.currentNodeIds, ...copied.currentNodeIds]),
      priorNodeIds: new Set([...witnessed.priorNodeIds, ...copied.priorNodeIds]),
      ...(copyPairs.length ? { copyPairs } : {}),
      ...(copied.ambiguousCopyNodeIds ? { ambiguousCopyNodeIds: copied.ambiguousCopyNodeIds } : {})
    };
  }
  if (witnessed || copied || !relation.unprovenNewLandingNodeId)
    return witnessed ?? copied;
  const landing = findExactNodesByIdInForest(currentForest, relation.unprovenNewLandingNodeId);
  if (landing.length !== 1 || findExactNodesByIdInForest(previousForest, relation.unprovenNewLandingNodeId).length)
    return null;
  // The authored new occurrence has a moment even when the missing earlier
  // state prevents movement recovery. Do not restore or modify its source.
  return { currentNodeIds: collectExactSubtreeNodeIds(landing[0]), priorNodeIds: new Set() };
};

/**
 * Landings of a neutral rewrite's copy pairs that kept the moved occurrence's
 * id while a new lower occurrence took its source slot. Only the rewrite's
 * moment relocates them to their new parent.
 */
export const keptIdLandingNodeIds = (
  ownership: FallbackTreeTransitionOwnership,
  previousForest: SyntaxNode[],
  currentForest: SyntaxNode[]
): string[] => {
  const previous = indexExactForestNodeLocations(previousForest);
  const current = indexExactForestNodeLocations(currentForest);
  return (ownership.copyPairs ?? []).filter(pair => pair.targetNodeId === pair.priorSourceNodeId).map(pair => pair.targetNodeId)
    .filter(nodeId => {
      const before = previous.get(nodeId), after = current.get(nodeId);
      return Boolean(before && after) && before!.parentId !== after!.parentId;
    });
};

/**
 * The receiving head of a head movement that keeps its id and becomes the new
 * complex's container in the completed stage, so its new inner material is
 * part of the movement's atomic landing. Before, it was either a bare head, or
 * a head whose daughters the completed stage re-wraps: every daughter beside
 * the landing is new and together they contain all of its old daughters
 * ([I Agr T] becomes [I [I Agr T] V]).
 */
const retainedReceivingHead = (
  movement: RecoveredMovement | undefined,
  previousForest: SyntaxNode[],
  currentForest: SyntaxNode[]
): SyntaxNode | undefined => {
  if (!movement?.transition || movement.trajectoryKind !== 'head')
    return undefined;
  const parentId = findParentNodeIdInForest(currentForest, movement.targetNodeId);
  const before = findExactNodeByIdInForest(previousForest, parentId);
  const after = findExactNodeByIdInForest(currentForest, parentId);
  if (!before || !after?.children?.length)
    return undefined;
  if (!before.children?.length)
    return after;
  const inner = after.children.filter(child => child.id !== movement.targetNodeId);
  const rewrapped = inner.every(child => !findExactNodeByIdInForest(previousForest, child.id))
    && before.children.every(old => inner.some(child => collectSyntaxSubtreeNodeIds(child).includes(old.id)));
  return rewrapped ? after : undefined;
};

export const newReceivingHeadNodeIds = (
  movement: RecoveredMovement | undefined,
  previousForest: SyntaxNode[],
  currentForest: SyntaxNode[]
): string[] => {
  const after = retainedReceivingHead(movement, previousForest, currentForest);
  if (!after)
    return [];
  return after.children!.filter(child => child.id !== movement!.targetNodeId)
    .flatMap(child => collectSyntaxSubtreeNodeIds(child))
    .filter(id => !findExactNodeByIdInForest(previousForest, id));
};

/**
 * The phrase a phrasal landing pied-pipes. Walking up from the landing, each
 * new parent whose other daughters are all wholly new in this stage, and match
 * the daughters beside the moved constituent in its preceding position (same
 * categories, in the same order), is part of the moved phrase rather than
 * receiving context built before it; the walk stops at the first parent that
 * is not. So only material that stood with the moved constituent before it
 * moved travels with it. The phrase counts only when that parent exists and so
 * attaches it to preceding structure: a landing in a wholly new workspace, as
 * in sideward movement, merges with independently selected material.
 * `sourceNodeIds` are the moved constituent's ids in `previousForest`.
 * `hostIds` are the pied-piped parents, lowest first, and `nodeIds` the
 * subtrees of their other daughters; the movement moment introduces both with
 * the landing.
 */
export const piedPipedPhrase = (
  currentForest: SyntaxNode[],
  previousForest: SyntaxNode[],
  landingNodeId: string,
  sourceNodeIds: readonly (string | undefined)[]
): { hostIds: string[]; nodeIds: string[] } => {
  const hostIds: string[] = [], nodeIds: string[] = [];
  const isNew = (id: string) => !findExactNodeByIdInForest(previousForest, id);
  type Shape = [string, Shape[]];
  const shape = (node: SyntaxNode): Shape => [node.label ?? '', (node.children || []).map(shape)];
  const others = (forest: SyntaxNode[], parentId: string, branchId: string) =>
    (findExactNodeByIdInForest(forest, parentId)?.children || []).filter(child => child.id !== branchId);
  let sources = [...new Set(sourceNodeIds.filter((id): id is string => Boolean(id && findExactNodeByIdInForest(previousForest, id))))]
    .map(id => ({ branch: id, parent: findParentNodeIdInForest(previousForest, id) }));
  let branchNodeId = landingNodeId, parentNodeId = findParentNodeIdInForest(currentForest, landingNodeId);
  for (; parentNodeId; branchNodeId = parentNodeId, parentNodeId = findParentNodeIdInForest(currentForest, parentNodeId)) {
    if (!isNew(parentNodeId)) break;
    const sisters = others(currentForest, parentNodeId, branchNodeId);
    if (!sisters.length || !sisters.every(child => collectSyntaxSubtreeNodeIds(child).every(isNew))) break;
    const sisterShape = JSON.stringify(sisters.map(shape));
    sources = sources.filter(source => source.parent
      && JSON.stringify(others(previousForest, source.parent, source.branch).map(shape)) === sisterShape);
    if (!sources.length) break;
    hostIds.push(parentNodeId);
    sisters.forEach(child => nodeIds.push(...collectSyntaxSubtreeNodeIds(child)));
    sources = sources.map(source => ({ branch: source.parent!, parent: findParentNodeIdInForest(previousForest, source.parent!) }));
  }
  return parentNodeId && hostIds.length ? { hostIds, nodeIds } : { hostIds: [], nodeIds: [] };
};

export const receivingHeadMaterialNodeId = (
  movement: RecoveredMovement | undefined,
  previousForest: SyntaxNode[],
  currentForest: SyntaxNode[]
): string | undefined => retainedReceivingHead(movement, previousForest, currentForest)?.id;

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
  /** `keptIdLandingNodeIds` of the relations not yet active. */
  pendingKeptIdLandingNodeIds?: Set<string>;
  /** Preceding nodes the active neutral claims' new parents attach. */
  attachedNodeIds?: Set<string>;
  /** Preceding nodes whose new parent's construction step has not yet run. */
  heldAttachmentNodeIds?: Set<string>;
}

export const buildAnchoredTreeTransitionForest = ({
  previousForest,
  currentForest,
  activeRelations,
  constructedNodeIds = new Set(),
  withheldNodeIds = new Set(),
  pendingKeptIdLandingNodeIds = new Set(),
  attachedNodeIds = new Set(),
  heldAttachmentNodeIds = new Set()
}: AnchoredTransitionInput): SyntaxNode[] => {
  const ownerships = activeRelations
    .map((relation) => {
      const movement = relation.recoveredMovement;
      if (movement?.transition) {
        return {
          currentNodeIds: new Set((relation.recoveredMovements ?? [movement]).flatMap(item => [item.sourceNodeId, item.targetNodeId,
          ...newReceivingHeadNodeIds(item, previousForest, currentForest),
          ...item.transition && item.trajectoryKind === 'phrasal' ? piedPipedPhrase(currentForest, previousForest, item.targetNodeId, [item.priorSourceNodeId, item.sourceNodeId]).nodeIds : []]).flatMap(id => {
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
  const attachmentNodeIds = new Set<string>(attachedNodeIds);
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
  // Construction of a pending rewrite's new parent cannot carry an occurrence
  // that kept its id at the landing there early: it keeps its preceding
  // position until the rewrite's moment.
  const heldNodeIds = new Set([...pendingKeptIdLandingNodeIds, ...heldAttachmentNodeIds].filter(nodeId => !activeCurrentNodeIds.has(nodeId)));
  const structuralNodeIds = new Set([...activeCurrentNodeIds, ...attachmentNodeIds,
    ...[...constructedNodeIds].filter(nodeId => !heldNodeIds.has(nodeId))]);
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
    // old slot. Attach its preceding contents with the relation's output, so
    // no branch spans the row the new parent adds. A later claim that owns a
    // sibling's change still owns its material, which keeps its preceding form
    // here; separate workspaces and pending movement are not attached.
    const retainedChildren = previousLocations.has(nodeId) ? [] : currentChildren.filter(child => {
      const previous = exactLocation(previousLocations, child.id);
      return currentLocation.parentId && previous?.parentId === currentLocation.parentId;
    });
    const replacesConsecutiveChildren = retainedChildren.every((child, offset) => exactLocation(previousLocations, child.id)?.childIndex === currentLocation.childIndex + offset);
    const retainedChildIds = new Set(replacesConsecutiveChildren ? retainedChildren
      .filter(child => ![...collectExactSubtreeNodeIds(child),
      ...collectExactSubtreeNodeIds(exactLocation(previousLocations, child.id)!.node)].some(id => withheldNodeIds.has(id) || heldNodeIds.has(id)))
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
    if (heldNodeIds.has(node.id))
      return null;
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
  if (!registryEntry || relation.neutralTransitionEvidence || relation.refusedMovementTransition) {
    return Boolean(resolveFallbackTreeTransitionOwnership(relation, previousForest, currentForest));
  }
  const transitionKinds = relationProductionTransitionKinds(relation);
  const nonMovementKinds = transitionKinds.filter((kind) => kind !== 'movement');
  if (nonMovementKinds.length === 0)
    return false;
  return true;
};

/**
 * The new ancestors that attach a landing to the workspace that held its prior
 * source: each parent absent from the preceding stage, up to the first whose
 * other material belongs to that workspace. When no such parent exists, only
 * the landing's own parent. `stopBefore` ends the path below a parent that must
 * be built first.
 */
export const landingAttachmentPath = (
  currentForest: SyntaxNode[],
  previousForest: SyntaxNode[],
  landingNodeId: string,
  priorSourceIds: readonly string[],
  stopBefore: (parentNodeId: string, branchNodeId: string, hostIds: readonly string[]) => boolean = () => false
): string[] => {
  const landingHostNodeId = findParentNodeIdInForest(currentForest, landingNodeId);
  const sourceWorkspaceIds = new Set(previousForest
    .filter(root => priorSourceIds.some(id => findNodeByIdInForest([root], id)))
    .flatMap(root => collectSyntaxSubtreeNodeIds(root)));
  const hostIds: string[] = [];
  let branchNodeId = landingNodeId;
  let parentNodeId = landingHostNodeId;
  while (parentNodeId && !findNodeByIdInForest(previousForest, parentNodeId)) {
    if (stopBefore(parentNodeId, branchNodeId, hostIds))
      return hostIds;
    hostIds.push(parentNodeId);
    const parent = findNodeByIdInForest(currentForest, parentNodeId);
    if ((parent?.children || []).some(child => child.id !== branchNodeId && collectSyntaxSubtreeNodeIds(child).some(nodeId => sourceWorkspaceIds.has(nodeId))))
      return hostIds;
    branchNodeId = parentNodeId;
    parentNodeId = findParentNodeIdInForest(currentForest, parentNodeId);
  }
  return parentNodeId || !landingHostNodeId ? hostIds : [landingHostNodeId];
};

/**
 * The new parents a neutral claim's moment introduces with its output: for
 * each owned occurrence that is new, or leaves one parent for another absent
 * from the preceding stage, the `landingAttachmentPath` to the workspace that
 * held the claim's preceding material. A preceding root that gains a parent
 * is merged by ordinary construction, as is everything above that path.
 */
export const neutralTransitionHostNodeIds = (
  relation: DerivationReplayPlanStep,
  ownership: FallbackTreeTransitionOwnership,
  previousForest: SyntaxNode[],
  currentForest: SyntaxNode[],
  stopBefore: (parentNodeId: string) => boolean = () => false
): string[] => {
  const previous = indexExactForestNodeLocations(previousForest);
  const current = indexExactForestNodeLocations(currentForest);
  const sourceIds = [...ownership.priorNodeIds, ...relationAnchorNodeIds(relation.anchors), ...relationAnchorNodeIds(relation.priorAnchors)]
    .filter(id => previous.get(id));
  return [...new Set([...ownership.currentNodeIds].flatMap((nodeId) => {
    const before = previous.get(nodeId), after = current.get(nodeId);
    if (!after?.parentId || ownership.currentNodeIds.has(after.parentId) || previous.get(after.parentId)
      || (before && (!before.parentId || before.parentId === after.parentId)))
      return [];
    return landingAttachmentPath(currentForest, previousForest, nodeId, before ? [nodeId, ...sourceIds] : sourceIds, stopBefore);
  }))];
};

/** Same own fields and child ids throughout, except inside `owned`. */
const retainedOutside = (before: SyntaxNode, after: SyntaxNode, owned: ReadonlySet<string>): boolean => owned.has(after.id)
  || ownNodeContent(before) === ownNodeContent(after) && (before.children || []).length === (after.children || []).length
  && (after.children || []).every((child, index) => child.id === before.children![index].id
    && retainedOutside(before.children![index], child, owned));

/**
 * Completes each neutral ownership of a stage, in authored order, with the new
 * parents its moment introduces (`neutralTransitionHostNodeIds`, stopping below
 * a parent an earlier claim anchors and leaving one another claim already
 * introduces) and the preceding nodes those parents attach at the moment. A
 * new parent takes over the consecutive slot its preceding children held, in
 * their order; a new workspace root joins only the preceding roots that held
 * the claim's material, never an unrelated workspace.
 */
export const planNeutralTransitionAttachments = (
  relations: readonly DerivationReplayPlanStep[],
  ownerships: Map<number, FallbackTreeTransitionOwnership>,
  relationIndexes: readonly number[],
  previousForest: SyntaxNode[],
  currentForest: SyntaxNode[]
): void => {
  const outputIds = new Set(relationIndexes.flatMap(index => [...ownerships.get(index)?.currentNodeIds ?? []]));
  const introduced = new Set<string>();
  const previous = indexExactForestNodeLocations(previousForest), current = indexExactForestNodeLocations(currentForest);
  const anchoredBefore = (relationIndex: number, nodeId: string) => relations.slice(0, relationIndex)
    .some(relation => getRelationAllAnchorNodeIds(relation).some(id => collectSyntaxSubtreeNodeIds(findExactNodeByIdInForest(currentForest, id)).includes(nodeId)));
  [...relationIndexes].sort((left, right) => left - right).forEach((relationIndex) => {
    const ownership = ownerships.get(relationIndex), relation = relations[relationIndex];
    if (!ownership)
      return;
    const hostNodeIds = neutralTransitionHostNodeIds(relation, ownership, previousForest, currentForest,
      parentNodeId => anchoredBefore(relationIndex, parentNodeId)).filter(id => !outputIds.has(id) && !introduced.has(id));
    hostNodeIds.forEach(id => introduced.add(id));
    const hosts = new Set(hostNodeIds), owned = new Set([...ownership.currentNodeIds, ...ownership.priorNodeIds]);
    const claimRoots = new Set([...ownership.priorNodeIds, ...relationAnchorNodeIds(relation.anchors), ...relationAnchorNodeIds(relation.priorAnchors)]
      .flatMap(id => { const location = previous.get(id); return location ? [String(previousForest[location.rootIndex]?.id || '')] : []; }));
    // The slot a path took over is held under its nearest preceding ancestor,
    // through any new outer projection that ordinary construction builds.
    const slotOf = (nodeId: string): { parentId: string; childId: string } => {
      let childId = nodeId;
      while (hosts.has(current.get(childId)?.parentId ?? ''))
        childId = current.get(childId)!.parentId;
      let parentId = current.get(childId)?.parentId ?? '';
      while (parentId && !previous.get(parentId)) {
        childId = parentId;
        parentId = current.get(parentId)?.parentId ?? '';
      }
      return { parentId, childId };
    };
    const attachments: NonNullable<FallbackTreeTransitionOwnership['attachments']> = [];
    hostNodeIds.forEach((wrapper) => {
      const { parentId, childId } = slotOf(wrapper);
      const preceding = (current.get(wrapper)?.node.children || [])
        .filter(child => !hosts.has(child.id) && !outputIds.has(child.id) && previous.get(child.id));
      const candidates = preceding.filter(child => previous.get(child.id)!.parentId === parentId && (parentId || claimRoots.has(child.id)));
      const taken = !parentId || candidates.every((child, offset) => previous.get(child.id)!.childIndex === current.get(childId)!.childIndex + offset)
        ? candidates : [];
      taken.forEach(child => attachments.push({ host: child.id, wrapper, retained: retainedOutside(previous.get(child.id)!.node, child, owned) }));
    });
    ownerships.set(relationIndex, { ...ownership, hostNodeIds, attachments });
  });
};

/**
 * The new parent below a landing parent that keeps its preceding id: the
 * landing's only sister, when that parent had two or more children in the
 * preceding stage and the sister holds them in order. A slot holds the earlier
 * child itself, or a node new in this stage that contains it, such as the
 * complex another movement of the stage forms on it. The sister only attaches
 * the landing above the earlier daughters, so the movement moment introduces
 * it, as `landingAttachmentPath` does when the new id is on the upper node.
 */
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
  if (!wrapper.children.every((child, index) => child.id === previousChildren[index].id
    || !findNodeByIdInForest(previousForest, child.id)
      && collectSyntaxSubtreeNodeIds(child).includes(previousChildren[index].id)))
    return null;
  return { parentId, wrapperId: wrapper.id };
};
