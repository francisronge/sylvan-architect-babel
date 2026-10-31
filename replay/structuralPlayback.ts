/** Schedule forward construction: terminals, projection, and merge. */
import * as d3 from 'd3';
import { type ResolvedRelationLink } from '../relationLinks.ts';
import { isPronouncedLeaf } from '../server/babelParser/nodePronunciation.js';
import { resolveSavedInputTokens } from '../server/babelParser/surfaceTokens.js';
import { type DerivationOperation, type SyntaxNode } from '../types.ts';
import {
  constructionAttachmentUpdates,
  hasConstructionWrapperInsertions,
  preserveConstructionAttachments,
  regroupingParents,
  replacedChildren,
  restoreRegroupedConstituents,
  restoreReplacedChildren
} from './constructionAttachments.ts';
import { continuedLexicalLeafIds, renameContinuedOccurrences } from './continuedOccurrences.ts';
import { applyVizIds, createReplayIdentityContext, getNodeId, type ReplayIdentityContext } from './displayIdentity.ts';
import { buildResolvedLinkTraceIndexMap, resolveTraceIndexFromNodeContext } from './movementIndices.ts';
import { buildStructuralReplayFallback } from './playbackFormatting.ts';
import {
  buildDerivationReplaySnapshot,
  buildRenderableDerivationCanvasData,
  buildVisibleSyntaxSnapshotFromHierarchy,
  extractReplayWorkspaceLabels,
  isSyntheticWorkspaceRootNode
} from './replayCanvas.ts';
import { hasDeterminerNominalComplement, maybeLowercaseSentenceInitialFunctionSurface } from './replayCasing.ts';
import {
  extractMovementIndex,
  formatTraceSurfaceForDisplayValue,
  isTraceLike,
  resolveLeafSurface
} from './replaySurfaceNotation.ts';
import { forestCanUseCurrentMaterialLayoutScaffold } from './stageLayout.ts';
import { readStructuralHeads, type StructuralHeads } from './structuralHeads.ts';
import {
  cloneSyntaxTree,
  collectForestNodesById,
  collectPronouncedLeafNodeIdsInOrder,
  collectReplayContinuitySubtreeSignatures,
  collectSubtreeNodeIds,
  collectUniqueReplayContinuitySubtrees,
  indexExactForestNodeLocations,
  isLexicalLeaf,
  isNotationLeaf,
  resolveNodeLabel,
  subtreeHasOvertYield
} from './syntaxForest.ts';
import { type HierNode, type PlaybackStep, type ReplayDerivationFrame } from './types.ts';

/*
 * Construction order inside one parent, read from shape (see structuralHeads),
 * as bottom-up Merge builds it: when a head projects the parent, its
 * complement is built first and the head is then selected to merge with it;
 * when a larger projection does (T′, a lower segment), that projection is
 * built first and a specifier or adjunct after it. Without a projecting
 * daughter, branching overt material comes first, silent notation last, and
 * the rest in authored order.
 */
const getDerivationalChildRankForOrdering = (heads: StructuralHeads, parent: HierNode, child: HierNode, childIndex: number): number => {
  const projecting = heads.projectingDaughter(parent.data);
  if (projecting) {
    const headIsMinimal = heads.minimal(projecting);
    if (child.data === projecting)
      return headIsMinimal ? 3 : 0;
    return headIsMinimal ? 0 : 4;
  }
  if (child.children?.length && subtreeHasOvertYield(child.data))
    return 0;
  if (isNotationLeaf(child.data))
    return 3;
  return childIndex;
};

const buildBottomUpSequence = (root: HierNode, visibleIds: Set<string>): HierNode[] => {
  const sequence: HierNode[] = [];
  const heads = readStructuralHeads(isSyntheticWorkspaceRootNode(root) ? root.data.children || [] : [root.data]);
  const visit = (node: HierNode) => {
    const syntheticWorkspaceRoot = isSyntheticWorkspaceRootNode(node);
    if (!syntheticWorkspaceRoot && !visibleIds.has(getNodeId(node)))
      return;
    const visibleChildren = (node.children || [])
      .filter((child) => visibleIds.has(getNodeId(child)))
      .map((child, index) => ({ child, index }))
      .sort((left, right) => {
        const leftRank = getDerivationalChildRankForOrdering(heads, node, left.child, left.index);
        const rightRank = getDerivationalChildRankForOrdering(heads, node, right.child, right.index);
        return leftRank === rightRank ? left.index - right.index : leftRank - rightRank;
      })
      .map(({ child }) => child);
    visibleChildren.forEach(visit);
    if (!syntheticWorkspaceRoot && visibleIds.has(getNodeId(node))) {
      sequence.push(node);
    }
  };
  visit(root);
  return sequence.filter((node) => visibleIds.has(getNodeId(node)));
};

export interface StructuralPlaybackInput {
  forest: SyntaxNode[];
  frameIndex: number;
  previousVisibleNodeIds: Set<string>;
  resolvedRelationLinks?: ResolvedRelationLink[];
  derivationFrames?: ReplayDerivationFrame[];
  sentence?: string;
  layoutScaffoldForest?: SyntaxNode[];
  identity?: ReplayIdentityContext;
  inputTokens?: string[];
  /** Preceding ids this stage continues under new ids; see `continuedOccurrences`. */
  continuedOccurrenceIds?: ReadonlyMap<string, string>;
}

export const buildStructuralDerivationPlaybackSteps = ({
  forest,
  frameIndex,
  previousVisibleNodeIds,
  resolvedRelationLinks,
  derivationFrames,
  sentence,
  layoutScaffoldForest,
  identity = createReplayIdentityContext(derivationFrames?.flatMap(frame => frame.workspaceForest || []) ?? forest),
  inputTokens,
  continuedOccurrenceIds = new Map()
}: StructuralPlaybackInput): PlaybackStep[] => {
  const sentenceInitialSurface = String(resolveSavedInputTokens(sentence, inputTokens)[0] || '').trim();
  const canvas = buildRenderableDerivationCanvasData(forest, identity);
  const cloned = cloneSyntaxTree(canvas);
  if (!cloned)
    return [];
  const hierarchy: HierNode = d3.hierarchy<SyntaxNode>(cloned);
  applyVizIds(hierarchy);
  const visibleNodes: HierNode[] = hierarchy
    .descendants()
    .filter((node) => !isSyntheticWorkspaceRootNode(node));
  const visibleNodeById = new Map<string, HierNode>(visibleNodes.map((node) => [getNodeId(node), node] as const));
  const visibleIds = new Set<string>(visibleNodes.map((node) => getNodeId(node)));
  const rawNodeById = collectForestNodesById(forest);
  // Construction reads a continued occurrence as the preceding node itself, so
  // a renamed node is retained in place exactly as if its id had been kept.
  const previousConstructionForest = renameContinuedOccurrences(
    frameIndex > 0 ? derivationFrames?.[frameIndex - 1]?.workspaceForest || [] : [], continuedOccurrenceIds);
  const continuedLeafIds = continuedLexicalLeafIds(cloned, continuedOccurrenceIds, identity);
  const previousVisibleConstructionIds = new Set(Array.from(previousVisibleNodeIds,
    id => continuedOccurrenceIds.get(id) ?? continuedLeafIds.get(id) ?? id));
  const pendingAttachmentNodeIds = constructionAttachmentUpdates(previousConstructionForest, forest);
  const hasAttachmentUpdates = pendingAttachmentNodeIds.size > 0;
  const hasAttachmentContinuity = hasAttachmentUpdates
    || hasConstructionWrapperInsertions(previousConstructionForest, forest);
  const continuityVisibleNodeIds = (() => {
    const seeded = new Set(previousVisibleConstructionIds);
    const hasOvertReplayDescendant = (node: HierNode): boolean => node.descendants().some((descendant) => !isSyntheticWorkspaceRootNode(descendant) && isLexicalLeaf(descendant.data));
    const previousFrameForest = previousConstructionForest;
    // Lineage continuity is lineage-to-lineage: an occurrence continues a
    // previously visible object when some previously visible occurrence
    // carried the same authored lineageId. Node ids are a different concept.
    // An earlier occurrence that stays unchanged where it was (a root may gain
    // a parent) continues as itself; another occurrence of its material beside
    // it is a second occurrence, which its own construction builds unless a
    // claim or movement introduces it.
    const previousShapes = collectReplayContinuitySubtreeSignatures(previousFrameForest, 0);
    const rawShapes = collectReplayContinuitySubtreeSignatures(forest, 0);
    const previousLocations = indexExactForestNodeLocations(previousFrameForest);
    const currentLocations = indexExactForestNodeLocations(forest);
    const staysInPlace = (previousNode: SyntaxNode, nodeId: string): boolean => {
      const before = previousLocations.get(nodeId), after = currentLocations.get(nodeId);
      return Boolean(before && after) && (!before!.parentId || before!.parentId === after!.parentId)
        && previousShapes.get(previousNode) === rawShapes.get(after!.node);
    };
    const previousVisibleLineageShapes = new Map<string, Set<string>>();
    const currentShapes = collectReplayContinuitySubtreeSignatures([cloned], 0);
    collectForestNodesById(previousFrameForest).forEach((previousNode, previousNodeId) => {
      const previousLineageId = String(previousNode?.lineageId || '');
      if (previousLineageId && previousVisibleConstructionIds.has(previousNodeId) && !staysInPlace(previousNode, previousNodeId)) {
        const shapes = previousVisibleLineageShapes.get(previousLineageId) || new Set<string>();
        shapes.add(previousShapes.get(previousNode) || '');
        previousVisibleLineageShapes.set(previousLineageId, shapes);
      }
    });
    visibleNodes.forEach((node) => {
      const nodeId = getNodeId(node);
      const lineageId = String((node.data as SyntaxNode)?.lineageId
        || rawNodeById.get(nodeId)?.lineageId
        || '');
      if (!lineageId || !previousVisibleLineageShapes.get(lineageId)?.has(currentShapes.get(node.data) || ''))
        return;
      if (!hasOvertReplayDescendant(node))
        return;
      node.descendants().forEach((descendant) => {
        if (!isSyntheticWorkspaceRootNode(descendant)) {
          seeded.add(getNodeId(descendant));
        }
      });
    });
    const previousContinuitySubtrees = collectUniqueReplayContinuitySubtrees(previousFrameForest);
    const previousFrameNodeIds = new Set(collectForestNodesById(previousFrameForest).keys());
    const currentContinuitySubtrees = new Map<string, HierNode[]>();
    const continuitySignatures = collectReplayContinuitySubtreeSignatures([cloned]);
    visibleNodes.forEach((node) => {
      const signature = continuitySignatures.get(node.data as SyntaxNode);
      if (!signature || !previousContinuitySubtrees.has(signature))
        return;
      const entries = currentContinuitySubtrees.get(signature) || [];
      entries.push(node);
      currentContinuitySubtrees.set(signature, entries);
    });
    currentContinuitySubtrees.forEach((nodes, signature) => {
      if (nodes.length !== 1)
        return;
      const previousNode = previousContinuitySubtrees.get(signature);
      const previousSubtreeIds = new Set(collectSubtreeNodeIds(previousNode));
      const previousSubtreeWasVisible = Array.from(previousSubtreeIds).some((nodeId) => previousVisibleConstructionIds.has(nodeId));
      if (!previousSubtreeWasVisible)
        return;
      // A new node that takes over the earlier node's own children, while that
      // node keeps its ID elsewhere, is an inserted segment rather than the
      // earlier node renamed. Its children continue; it waits for its own step.
      const currentId = String(nodes[0].data?.id || ''), previousId = String(previousNode?.id || '');
      const newBesideEarlier = currentId !== previousId && !previousFrameNodeIds.has(currentId) && rawNodeById.has(previousId);
      const insertedSegment = newBesideEarlier
        && (rawNodeById.get(currentId)?.children || []).every((child) => previousFrameNodeIds.has(String(child.id || '')));
      // Otherwise a new node beside the earlier one that repeats its earlier
      // material is a second occurrence, which its own construction builds.
      if (newBesideEarlier && !insertedSegment)
        return;
      nodes[0].descendants().forEach((descendant) => {
        if (!isSyntheticWorkspaceRootNode(descendant) && !(insertedSegment && descendant === nodes[0])) {
          seeded.add(getNodeId(descendant));
        }
      });
    });
    return seeded;
  })();
  const traceIndexByNodeId = buildResolvedLinkTraceIndexMap(forest, resolvedRelationLinks || [], frameIndex);
  const getReplayNodeLabel = (node: HierNode): string => {
    const surface = resolveLeafSurface(node);
    if (isPronouncedLeaf(node.data) || !isTraceLike(surface))
      return resolveNodeLabel(node);
    const inheritedTraceIndex = resolveTraceIndexFromNodeContext(node, traceIndexByNodeId);
    return formatTraceSurfaceForDisplayValue(surface, inheritedTraceIndex || extractMovementIndex(surface));
  };
  const sequence = buildBottomUpSequence(hierarchy, visibleIds)
    .filter((node) => !isSyntheticWorkspaceRootNode(node));
  // A regrouping parent keeps each preceding branch until the new child that
  // regroups its material is built; the last such step completes the regrouping.
  const pendingRegroupings = frameIndex > 0 ? regroupingParents(previousConstructionForest, forest) : new Map<string, Set<string>>();
  // A replaced daughter of a shown parent stays in its slot until its
  // replacement's own construction step swaps the replacement in.
  const pendingReplacements = frameIndex > 0
    ? new Map([...replacedChildren(previousConstructionForest, forest)].filter(([replacementId, { parentId, replacedId }]) =>
      !pendingRegroupings.has(parentId) && previousVisibleConstructionIds.has(parentId) && previousVisibleConstructionIds.has(replacedId)
      && !continuityVisibleNodeIds.has(replacementId)))
    : new Map<string, { parentId: string; replacedId: string }>();
  const nodesToReveal = sequence.filter((node) =>
    frameIndex === 0 || !continuityVisibleNodeIds.has(getNodeId(node)) || pendingAttachmentNodeIds.has(getNodeId(node))
  );
  const cumulativeVisibleNodeIds = new Set(continuityVisibleNodeIds);
  const isUnrevealedClauseProjectionRoot = (node: HierNode | null | undefined, visibleNodeIdsForStep: Set<string>): boolean => {
    if (!node || isSyntheticWorkspaceRootNode(node))
      return false;
    const nodeId = getNodeId(node);
    if (!nodeId || visibleNodeIdsForStep.has(nodeId))
      return false;
    const label = String(node.data?.label || '').trim();
    const children = Array.isArray(node.children) ? node.children : [];
    const hasCHead = children.some((child) => String(child.data?.label || '').trim() === 'C');
    const hasInflComplement = children.some((child) => /^(Infl|InflP|TP|IP|T)$/i.test(String(child.data?.label || '').trim()));
    return (/^cp(?:_|$)/i.test(nodeId)
      || (label === 'C' && hasCHead && hasInflComplement));
  };
  const addReplayLayoutForNode = (
    layoutVisibleNodeIds: Set<string>,
    node: HierNode,
    visibleNodeIdsForStep: Set<string>,
    expandedLayoutRoots: Set<HierNode>
  ) => {
    let topRenderableAncestor: HierNode = node;
    while (topRenderableAncestor.parent
      && !isSyntheticWorkspaceRootNode(topRenderableAncestor.parent)) {
      topRenderableAncestor = topRenderableAncestor.parent;
    }
    if (isUnrevealedClauseProjectionRoot(topRenderableAncestor, visibleNodeIdsForStep)) {
      if (topRenderableAncestor === node && !visibleNodeIdsForStep.has(getNodeId(node)))
        return;
      layoutVisibleNodeIds.add(getNodeId(topRenderableAncestor));
      node.descendants().forEach((descendant) => {
        if (!isSyntheticWorkspaceRootNode(descendant)) {
          layoutVisibleNodeIds.add(getNodeId(descendant));
        }
      });
      let current: HierNode | null = node.parent || null;
      while (current && current !== topRenderableAncestor) {
        if (!isSyntheticWorkspaceRootNode(current) && visibleNodeIdsForStep.has(getNodeId(current))) {
          layoutVisibleNodeIds.add(getNodeId(current));
        }
        current = current.parent;
      }
      return;
    }
    // Every node in this workspace requests the same complete layout. Expand
    // it once per step; the partial clause-projection case above stays separate.
    if (expandedLayoutRoots.has(topRenderableAncestor))
      return;
    expandedLayoutRoots.add(topRenderableAncestor);
    topRenderableAncestor
      .descendants()
      .forEach((descendant) => {
        if (!isSyntheticWorkspaceRootNode(descendant)) {
          layoutVisibleNodeIds.add(getNodeId(descendant));
        }
      });
  };
  const playbackSteps: PlaybackStep[] = nodesToReveal.flatMap((node) => {
    const nodeId = getNodeId(node);
    cumulativeVisibleNodeIds.add(nodeId);
    const updatesAttachment = pendingAttachmentNodeIds.delete(nodeId);
    const parentId = String(node.parent?.data?.id || '');
    const unbuilt = pendingRegroupings.get(parentId);
    if (unbuilt?.delete(nodeId) && !unbuilt.size)
      pendingRegroupings.delete(parentId);
    pendingReplacements.delete(String(node.data?.id || ''));
    const surface = resolveLeafSurface(node);
    const layoutVisibleNodeIds = new Set(cumulativeVisibleNodeIds);
    const expandedLayoutRoots = new Set<HierNode>();
    Array.from(cumulativeVisibleNodeIds).forEach((visibleNodeId) => {
      const visibleNode = visibleNodeById.get(visibleNodeId);
      if (!visibleNode)
        return;
      addReplayLayoutForNode(layoutVisibleNodeIds, visibleNode, cumulativeVisibleNodeIds, expandedLayoutRoots);
    });
    const currentRevealIndex = nodesToReveal.findIndex((candidate) => getNodeId(candidate) === nodeId);
    const pendingRevealNodes = currentRevealIndex >= 0
      ? nodesToReveal.slice(currentRevealIndex + 1)
      : [];
    pendingRevealNodes.forEach((pendingNode) => {
      addReplayLayoutForNode(layoutVisibleNodeIds, pendingNode, cumulativeVisibleNodeIds, expandedLayoutRoots);
    });
    const childNodes = (node.children || []).filter((child) => visibleIds.has(getNodeId(child)));
    const operation: DerivationOperation = childNodes.length === 0
      ? 'LexicalSelect'
      : (childNodes.length === 1 ? 'Project' : 'ExternalMerge');
    const snapshotVisibleNodeIds = new Set(cumulativeVisibleNodeIds);
    const attachedForest = hasAttachmentContinuity
      ? preserveConstructionAttachments(forest, previousConstructionForest, pendingAttachmentNodeIds, snapshotVisibleNodeIds)
      : forest;
    const constructionForest = restoreReplacedChildren(
      restoreRegroupedConstituents(attachedForest, previousConstructionForest, pendingRegroupings, snapshotVisibleNodeIds),
      previousConstructionForest, pendingReplacements);
    // A held attachment keeps its new child a separate root until the parent's
    // merge. Stage reservations keep its slot; the scaffold cannot attach it early.
    const activeLayoutScaffold = layoutScaffoldForest
      && forestCanUseCurrentMaterialLayoutScaffold(constructionForest, layoutScaffoldForest,
        hasAttachmentContinuity ? pendingAttachmentNodeIds : undefined)
      ? layoutScaffoldForest
      : undefined;
    const frameReplaySnapshot = buildDerivationReplaySnapshot({
      forest: constructionForest,
      activeFrameIndex: frameIndex,
      relationLinks: resolvedRelationLinks,
      visibleNodeIds: snapshotVisibleNodeIds,
      layoutNodeIds: layoutVisibleNodeIds,
      derivationFrames,
      layoutScaffoldForest: activeLayoutScaffold,
      identity
    });
    const constructionHierarchy = hasAttachmentContinuity && frameReplaySnapshot.canvasData
      ? d3.hierarchy(frameReplaySnapshot.canvasData) : hierarchy;
    if (constructionHierarchy !== hierarchy)
      applyVizIds(constructionHierarchy);
    const visibleWorkspaceSnapshot = buildVisibleSyntaxSnapshotFromHierarchy({
      root: constructionHierarchy,
      visibleNodeIds: new Set(frameReplaySnapshot.visibleNodeIds),
      identity
    });
    const workspaceAfter = extractReplayWorkspaceLabels(visibleWorkspaceSnapshot);
    const visibleOvertLeafIds = collectPronouncedLeafNodeIdsInOrder(visibleWorkspaceSnapshot);
    const rawTargetLabel = getReplayNodeLabel(node);
    const targetLabel = childNodes.length === 0 && !isNotationLeaf(node.data)
      ? maybeLowercaseSentenceInitialFunctionSurface({
        surface: rawTargetLabel,
        sentenceInitialSurface,
        nodeId,
        parentLabel: String(node.parent?.data?.label || '').trim(),
        visibleOvertLeafIds,
        hasNominalComplement: hasDeterminerNominalComplement(node.parent?.data, node.parent?.parent?.data),
        isWorkspaceForest: visibleWorkspaceSnapshot?.replayOrigin?.kind === 'workspace'
      })
      : rawTargetLabel;
    const preFrontingLexicalTargetLabel = targetLabel;
    const sourceNodeIds = childNodes.map((child) => getNodeId(child));
    const sourceLabels = childNodes.length > 0
      ? childNodes.map((child) => getReplayNodeLabel(child)).filter(Boolean)
      : [
        isNotationLeaf(node.data) && isTraceLike(surface)
          ? preFrontingLexicalTargetLabel
          : maybeLowercaseSentenceInitialFunctionSurface({
            surface: String(node.data.word || preFrontingLexicalTargetLabel || '').trim(),
            sentenceInitialSurface,
            nodeId,
            parentLabel: String(node.parent?.data?.label || '').trim(),
            visibleOvertLeafIds,
            hasNominalComplement: hasDeterminerNominalComplement(node.parent?.data, node.parent?.parent?.data),
            isWorkspaceForest: visibleWorkspaceSnapshot?.replayOrigin?.kind === 'workspace'
          })
      ].filter(Boolean);
    return [{
      operation,
      sourceFrameIndex: frameIndex,
      visualFrameIndex: frameIndex,
      targetNodeId: nodeId,
      targetLabel: preFrontingLexicalTargetLabel,
      sourceNodeIds,
      sourceLabels,
      recipe: buildStructuralReplayFallback(operation, preFrontingLexicalTargetLabel, sourceLabels),
      workspaceAfter,
      replayFrameIndex: frameIndex,
      replayCanvasData: frameReplaySnapshot.canvasData,
      replayVisibleNodeIds: frameReplaySnapshot.visibleNodeIds,
      replayRelationLinks: frameReplaySnapshot.relationLinks,
      replayUsesFutureLayoutScaffold: Boolean(activeLayoutScaffold),
      replayPendingAttachmentNodeIds: hasAttachmentContinuity ? Array.from(pendingAttachmentNodeIds) : undefined,
      preserveReplayStep: updatesAttachment || undefined
    }];
  });
  return playbackSteps;
};
