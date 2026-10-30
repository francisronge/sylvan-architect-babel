/** Assign stable display indices to authored movement chains and witnesses. */
import { type ResolvedRelationLink } from '../relationLinks.ts';
import { type SyntaxNode } from '../types.ts';
import { getNodeId } from './displayIdentity.ts';
import { isHeadLikeResolvedRelation, isResolvedMovementLink } from './movementLinks.ts';
import { authoredRoleMatcher } from './relationAnchors.ts';
import { TRAJECTORY_SOURCE_ROLES, TRAJECTORY_WITNESS_ROLES } from './relations/renderFamilies.ts';
import {
  extractMovementIndex,
  isNullLike,
  isStructuralCategorySurface,
  isTraceLike,
  isWordlessCategoryLeaf,
  normalizeTraceIndexForDisplay,
  shouldExpandPreterminalLeaf
} from './replaySurfaceNotation.ts';
import { collectLeafSyntaxNodes, collectSubtreeNodeIds, findNodeByIdInForest } from './syntaxForest.ts';
import { type HierNode, type ReplayAuthoredRelationLink } from './types.ts';

export const resolveLexicalMovementTraceDisplayIndex = (
  surface: string,
  traceIndex?: string | null
): string => {
  const trimmed = String(surface || '').trim();
  if (!trimmed
    || isTraceLike(trimmed)
    || isNullLike(trimmed)
    || isStructuralCategorySurface(trimmed)) {
    return '';
  }
  // Membership in an established movement chain is independent of pronunciation.
  return normalizeTraceIndexForDisplay(traceIndex);
};

export const resolveTraceIndexFromNodeContext = (
  node: HierNode,
  primaryMap: Map<string, string>,
  secondaryMap?: Map<string, string>
): string | undefined => {
  let current: HierNode | null = node;
  while (current) {
    const nodeId = getNodeId(current);
    const primary = primaryMap.get(nodeId);
    if (primary)
      return primary;
    const secondary = secondaryMap?.get(nodeId);
    if (secondary)
      return secondary;
    current = current.parent;
  }
  return undefined;
};

export interface MovementChainIndexCatalogue {
  forest: SyntaxNode[];
  links: ResolvedRelationLink[];
  authoredIndicesByNodeId?: Map<string, Set<string>>;
}

/** Retain disappeared occurrences and authored indices without changing any stage. */
export const buildMovementChainIndexCatalogue = (forests: SyntaxNode[][], links: ResolvedRelationLink[] = []): MovementChainIndexCatalogue => {
  const forest: SyntaxNode[] = [];
  const retainedIds = new Set<string>();
  const authoredIndicesByNodeId = new Map<string, Set<string>>();
  const retain = (node: SyntaxNode) => {
    if (!retainedIds.has(node.id)) {
      forest.push(node);
      collectSubtreeNodeIds(node).forEach(id => retainedIds.add(id));
    }
    const index = normalizeTraceIndexForDisplay(extractMovementIndex(String(node.word || node.label || '')));
    if (/^\d+$/.test(index)) {
      const indices = authoredIndicesByNodeId.get(node.id) ?? new Set<string>();
      indices.add(index);
      authoredIndicesByNodeId.set(node.id, indices);
    }
    (node.children || []).forEach(retain);
  };
  for (let stage = forests.length - 1; stage >= 0; stage -= 1)
    forests[stage].forEach(retain);
  return { forest, links, authoredIndicesByNodeId };
};

/**
 * Where each established chain index is shown. `terminals` holds the index a
 * terminal's text carries, read through `resolveTraceIndexFromNodeContext`;
 * `phrases` holds the index a category label carries, read for that node only.
 */
export interface MovementChainIndices {
  terminals: Map<string, string>;
  phrases: Map<string, string>;
}

/** The index a category label shows: a moved phrase and each of its copies. */
export const phraseChainLabelIndex = (node: HierNode, phrases?: Map<string, string>): string =>
  normalizeTraceIndexForDisplay(phrases?.get(getNodeId(node)));

export const buildResolvedLinkTraceIndexMap = (
  currentForest: SyntaxNode[],
  resolvedRelationLinks: ResolvedRelationLink[] | undefined,
  activeStepIndex: number,
  catalogue?: MovementChainIndexCatalogue
): Map<string, string> => buildResolvedLinkChainIndices(currentForest, resolvedRelationLinks, activeStepIndex, catalogue).terminals;

/**
 * The textbook placement of chain indices. A moved phrase carries its index
 * once, on the category label of each occurrence ([DP which book]₁ … DP₁), so
 * the words inside it carry none; a word inside it with its own chain keeps
 * that chain's index. A moved head carries its index on its words (V₁ … t₁).
 * An occurrence without a category label of its own, a bare word or trace,
 * carries it on its text, where authored trace notation stays as written.
 */
export const buildResolvedLinkChainIndices = (
  currentForest: SyntaxNode[],
  resolvedRelationLinks: ResolvedRelationLink[] | undefined,
  activeStepIndex: number,
  catalogue?: MovementChainIndexCatalogue
): MovementChainIndices => {
  const traceIndexByNodeId = new Map<string, string>();
  const phraseIndexByNodeId = new Map<string, string>();
  const links = Array.isArray(resolvedRelationLinks) ? resolvedRelationLinks : [];
  const catalogueForest = catalogue?.forest ?? currentForest;
  const movementLinks = (catalogue?.links ?? links).filter(isResolvedMovementLink)
    .sort((left, right) => (left.stepIndex ?? 0) - (right.stepIndex ?? 0));
  const partialDeletionNodeIds = new Set<string>();
  links.forEach((link) => {
    const relationName = String(link?.relation || link?.operation || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z]/g, '');
    if (relationName !== 'partialcopydeletion')
      return;
    (Array.isArray(link?.anchors) ? link.anchors : []).forEach((anchor) => {
      const role = String(anchor?.role || '').trim().toLowerCase();
      if (role !== 'deletedsubconstituent' && role !== 'deleted')
        return;
      const deletedNode = findNodeByIdInForest(currentForest, String(anchor?.nodeId || ''));
      collectSubtreeNodeIds(deletedNode).forEach((nodeId) => partialDeletionNodeIds.add(nodeId));
    });
  });
  /*
   * An index marks chain membership, so the first chain to claim a position
   * keeps it. Chains are processed in authored order, and a chain that vacated
   * a position is always authored before a later chain whose moved constituent
   * merely contains that position (the object leaves before the remnant VP
   * fronts). Without this guard the later, larger constituent repaints the
   * inner gap with its own index — the accidental all-t₂ remnant display.
   */
  const assignIndexIfUnclaimed = (rawId: string, index: string, target = traceIndexByNodeId) => {
    const id = String(rawId || '');
    if (!id || traceIndexByNodeId.has(id) || phraseIndexByNodeId.has(id))
      return;
    target.set(id, index);
  };
  /*
   * A phrasal occurrence that has a category label (a parent, a category over
   * its own word, or a wordless category) carries the index on that label.
   * One without, a bare word or trace, carries it on its text.
   */
  const phrasalTextIds = new Set<string>();
  const assignIndexToPhraseOccurrence = (nodeId: string, index: string): boolean => {
    const node = findNodeByIdInForest(currentForest, nodeId);
    if (!node || !(node.children?.length || shouldExpandPreterminalLeaf(node) || isWordlessCategoryLeaf(node)))
      return false;
    assignIndexIfUnclaimed(nodeId, index, phraseIndexByNodeId);
    return true;
  };
  const assignIndexToHeadAndLeaves = (nodeId: string, index: string) => {
    const normalizedNodeId = String(nodeId || '');
    const normalizedIndex = String(index || '').trim();
    if (!normalizedNodeId || !normalizedIndex)
      return;
    assignIndexIfUnclaimed(normalizedNodeId, normalizedIndex);
    const node = findNodeByIdInForest(currentForest, normalizedNodeId);
    if (!node)
      return;
    collectLeafSyntaxNodes(node)
      .map((leaf) => String(leaf?.id || ''))
      .filter(Boolean)
      .forEach((leafId) => assignIndexIfUnclaimed(leafId, normalizedIndex));
  };
  const assignIndexToHeadSource = (nodeId: string, index: string) => {
    const normalizedNodeId = String(nodeId || '');
    const normalizedIndex = String(index || '').trim();
    if (!normalizedNodeId || !normalizedIndex)
      return;
    const node = findNodeByIdInForest(currentForest, normalizedNodeId);
    if (!node)
      return;
    const sourceContainsPartialDeletion = collectSubtreeNodeIds(node)
      .some((sourceNodeId) => partialDeletionNodeIds.has(sourceNodeId));
    if (!sourceContainsPartialDeletion) {
      assignIndexToHeadAndLeaves(normalizedNodeId, normalizedIndex);
      return;
    }
    collectLeafSyntaxNodes(node)
      .map((leaf) => String(leaf?.id || ''))
      .filter((leafId) => Boolean(leafId) && !partialDeletionNodeIds.has(leafId))
      .forEach((leafId) => assignIndexIfUnclaimed(leafId, normalizedIndex));
  };
  /*
   * Multi-source trajectories (across-the-board, and any authored array of
   * source/witness anchors) carry only their first pair in the scalar
   * sourceNodeId/witnessNodeId fields. The full authored anchor list travels
   * on the link, so chain indexing reads every source and witness from it —
   * one dependency, one index, every conjunct.
   */
  const linkAnchorIdsByRoles = (link: ResolvedRelationLink, roles: readonly string[]): string[] => {
    const wanted = authoredRoleMatcher(roles);
    const anchors = (link as ReplayAuthoredRelationLink)?.anchors;
    if (!Array.isArray(anchors))
      return [];
    return anchors
      .filter((anchor) => wanted((anchor as {
        role?: string;
      })?.role))
      .map((anchor) => String((anchor as {
        nodeId?: string;
      })?.nodeId || ''))
      .filter(Boolean);
  };
  const movementParent = new Map<string, string>();
  const findMovementRoot = (nodeId: string): string => {
    const currentParent = movementParent.get(nodeId);
    if (!currentParent) {
      movementParent.set(nodeId, nodeId);
      return nodeId;
    }
    if (currentParent === nodeId)
      return nodeId;
    const root = findMovementRoot(currentParent);
    movementParent.set(nodeId, root);
    return root;
  };
  const unionMovementNodes = (left: string, right: string) => {
    if (!left || !right)
      return;
    const leftRoot = findMovementRoot(left);
    const rightRoot = findMovementRoot(right);
    if (leftRoot !== rightRoot)
      movementParent.set(rightRoot, leftRoot);
  };
  const movementNodeIds = (link: ResolvedRelationLink): string[] => Array.from(new Set([
    link.sourceNodeId,
    link.targetNodeId,
    link.witnessNodeId,
    ...linkAnchorIdsByRoles(link, TRAJECTORY_SOURCE_ROLES),
    ...linkAnchorIdsByRoles(link, TRAJECTORY_WITNESS_ROLES)
  ].map((nodeId) => String(nodeId || '')).filter(Boolean)));
  movementLinks.forEach((link) => {
    const nodeIds = movementNodeIds(link);
    nodeIds.forEach((nodeId) => findMovementRoot(nodeId));
    nodeIds.slice(1).forEach((nodeId) => unionMovementNodes(nodeIds[0], nodeId));
  });
  const authoredIndices = new Map<string, Set<string>>();
  const reservedIndices = new Set<string>();
  const authoredIndex = (node: SyntaxNode): string => {
    const index = normalizeTraceIndexForDisplay(extractMovementIndex(String(node.word || node.label || '')));
    return /^\d+$/.test(index) ? index : '';
  };
  const reserveAuthoredIndices = (node: SyntaxNode) => {
    const index = authoredIndex(node);
    if (index)
      reservedIndices.add(index);
    (node.children || []).forEach(reserveAuthoredIndices);
  };
  catalogueForest.forEach(reserveAuthoredIndices);
  catalogue?.authoredIndicesByNodeId?.forEach(indices => indices.forEach(index => reservedIndices.add(index)));
  movementLinks.forEach((link) => {
    const nodeIds = movementNodeIds(link);
    const root = nodeIds[0] ? findMovementRoot(nodeIds[0]) : '';
    if (!root)
      return;
    const indices = authoredIndices.get(root) ?? new Set<string>();
    const collect = (node: SyntaxNode) => {
      // An embedded gap keeps the index of its own chain, not its carrier's.
      if (movementParent.has(node.id) && findMovementRoot(node.id) !== root)
        return;
      const index = authoredIndex(node);
      if (index)
        indices.add(index);
      catalogue?.authoredIndicesByNodeId?.get(node.id)?.forEach(index => indices.add(index));
      (node.children || []).forEach(collect);
    };
    nodeIds.forEach((nodeId) => {
      const node = findNodeByIdInForest(catalogueForest, nodeId);
      if (node)
        collect(node);
    });
    authoredIndices.set(root, indices);
  });
  // Number complete connected chains once. Relation position, drawing tier and
  // the currently visible prefix do not determine chain identity or numbering.
  const componentIndices = new Map<string, string>();
  let nextIndex = 1;
  authoredIndices.forEach((indices, root) => {
    if (indices.size > 1)
      return; // Conflicting authored indices are not repaired.
    if (indices.size === 1) {
      componentIndices.set(root, indices.values().next().value as string);
      return;
    }
    while (reservedIndices.has(String(nextIndex)))
      nextIndex += 1;
    const index = String(nextIndex++);
    reservedIndices.add(index);
    componentIndices.set(root, index);
  });
  links.forEach((link) => {
    /* A resolved relation is not automatically a movement chain. */
    if (!isResolvedMovementLink(link))
      return;
    const phrasal = !isHeadLikeResolvedRelation(link);
    const assignIndexToNodeAndLeaves = (nodeId: string, index: string) => {
      if (phrasal && assignIndexToPhraseOccurrence(String(nodeId || ''), String(index || '').trim()))
        return;
      if (phrasal)
        phrasalTextIds.add(String(nodeId || ''));
      assignIndexToHeadAndLeaves(nodeId, index);
    };
    const assignIndexToMovementSource = (nodeId: string, index: string) => {
      if (phrasal && assignIndexToPhraseOccurrence(String(nodeId || ''), String(index || '').trim()))
        return;
      if (phrasal)
        phrasalTextIds.add(String(nodeId || ''));
      assignIndexToHeadSource(nodeId, index);
    };
    const traceId = String(link?.witnessNodeId || '');
    const sourceId = String(link?.sourceNodeId || '');
    const movedId = String(link?.targetNodeId || '');
    const componentNodeId = sourceId || movedId || traceId;
    const componentIndex = componentNodeId
      ? componentIndices.get(findMovementRoot(componentNodeId))
      : '';
    const index = componentIndex;
    const stepIndex = Number.isInteger(link?.stepIndex) ? Number(link.stepIndex) : 0;
    if (!index || stepIndex > activeStepIndex)
      return;
    if (traceId)
      assignIndexToNodeAndLeaves(traceId, index);
    if (sourceId)
      assignIndexToMovementSource(sourceId, index);
    // Every additional authored source/witness of a multi-source trajectory
    // shares the same chain index as the first pair.
    linkAnchorIdsByRoles(link, TRAJECTORY_WITNESS_ROLES)
      .filter((nodeId) => nodeId !== traceId)
      .forEach((nodeId) => assignIndexToNodeAndLeaves(nodeId, index));
    linkAnchorIdsByRoles(link, TRAJECTORY_SOURCE_ROLES)
      .filter((nodeId) => nodeId !== sourceId)
      .forEach((nodeId) => assignIndexToMovementSource(nodeId, index));
    if (movedId)
      assignIndexToNodeAndLeaves(movedId, index);
  });
  /*
   * An anchor inside an occurrence whose label already shows the same index,
   * such as a trace witness authored inside its lower copy, is part of that
   * occurrence and repeats nothing.
   */
  if (phraseIndexByNodeId.size) {
    const insideIndexedOccurrence = (index: string, ancestors: SyntaxNode[]) =>
      ancestors.some(ancestor => phraseIndexByNodeId.get(ancestor.id) === index);
    const visit = (node: SyntaxNode, ancestors: SyntaxNode[]) => {
      const phraseIndex = phraseIndexByNodeId.get(node.id);
      if (phraseIndex && insideIndexedOccurrence(phraseIndex, ancestors))
        phraseIndexByNodeId.delete(node.id);
      const textIndex = phrasalTextIds.has(node.id) ? traceIndexByNodeId.get(node.id) : undefined;
      if (textIndex && insideIndexedOccurrence(textIndex, ancestors))
        traceIndexByNodeId.delete(node.id);
      (node.children || []).forEach(child => visit(child, [...ancestors, node]));
    };
    currentForest.forEach(tree => visit(tree, []));
  }
  return { terminals: traceIndexByNodeId, phrases: phraseIndexByNodeId };
};

export const buildResolvedLinkRawTraceAliasMap = (
  currentForest: SyntaxNode[],
  resolvedRelationLinks: ResolvedRelationLink[] | undefined,
  activeStepIndex: number
): Map<string, string> => {
  const rawAliasByIndex = new Map<string, string>();
  const links = Array.isArray(resolvedRelationLinks) ? resolvedRelationLinks : [];
  const assignFromNode = (nodeId?: string, index?: string) => {
    const normalizedNodeId = String(nodeId || '');
    const normalizedIndex = normalizeTraceIndexForDisplay(index);
    if (!normalizedNodeId || !normalizedIndex)
      return;
    const node = findNodeByIdInForest(currentForest, normalizedNodeId);
    if (!node)
      return;
    collectLeafSyntaxNodes(node).forEach((leaf) => {
      const rawSurface = String(leaf?.word || leaf?.label || '').trim();
      const rawAlias = extractMovementIndex(rawSurface);
      if (!rawAlias)
        return;
      const normalizedAlias = String(rawAlias).trim().toLowerCase();
      if (!normalizedAlias || rawAliasByIndex.has(normalizedAlias))
        return;
      rawAliasByIndex.set(normalizedAlias, normalizedIndex);
    });
  };
  links.forEach((link) => {
    const stepIndex = Number.isInteger(link?.stepIndex) ? Number(link.stepIndex) : 0;
    if (stepIndex > activeStepIndex)
      return;
    assignFromNode(link?.witnessNodeId, link?.relationIndex);
    assignFromNode(link?.sourceNodeId, link?.relationIndex);
  });
  return rawAliasByIndex;
};
