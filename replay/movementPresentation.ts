/** Convert established movement links into display arrows and terminal indices. */
import { type ResolvedRelationLink } from '../relationLinks.ts';
import { type SyntaxNode } from '../types.ts';
import { getNodeId } from './displayIdentity.ts';
import { isHeadLikeResolvedRelation, isResolvedMovementLink, normalizeTrajectoryKind } from './movementLinks.ts';
import { buildStructuralReplayFallback } from './playbackFormatting.ts';
import {
  extractMovementIndex,
  formatTraceSurfaceForDisplayValue,
  isTraceLike,
  normalizeTraceIndexForDisplay
} from './replaySurfaceNotation.ts';
import { isLexicalLeaf, isNotationLeaf, replayEffectiveSilence } from './syntaxForest.ts';
import { type HierNode, type MovementArrow, type PlaybackStep } from './types.ts';

type MovementCopyTraceCandidate = {
  arrow: MovementArrow;
  authoredOrder: number;
  commonLineageIds: Set<string>;
  sourceNodeCount: number;
  lexicalLeaves: HierNode[];
};

export const MOVEMENT_ARROW_COLOR = '#10b981';

export const MOVEMENT_ARC_STROKE = 2.6;

export const decoratePlaybackStepsWithTraceIndices = (steps: PlaybackStep[], traceIndexByNodeId: Map<string, string>): PlaybackStep[] => {
  if (steps.length === 0 || traceIndexByNodeId.size === 0)
    return steps;
  const formatIndexedTraceLabel = (label?: string, nodeId?: string): string => {
    const rawLabel = String(label || '').trim();
    if (!rawLabel || !isTraceLike(rawLabel))
      return rawLabel;
    const fallbackIndex = nodeId ? traceIndexByNodeId.get(String(nodeId || '')) : undefined;
    return formatTraceSurfaceForDisplayValue(rawLabel, fallbackIndex || extractMovementIndex(rawLabel));
  };
  return steps.map((step) => {
    const nextTargetLabel = formatIndexedTraceLabel(step.targetLabel, step.targetNodeId) || step.targetLabel;
    const nextSourceLabels = Array.isArray(step.sourceLabels)
      ? step.sourceLabels.map((label, index) => formatIndexedTraceLabel(label, step.sourceNodeIds?.[index]) || label)
      : step.sourceLabels;
    const labelsChanged = nextTargetLabel !== step.targetLabel
      || JSON.stringify(nextSourceLabels || []) !== JSON.stringify(step.sourceLabels || []);
    const nextRecipe = labelsChanged
      ? buildStructuralReplayFallback(step.operation, nextTargetLabel, nextSourceLabels || [])
      : step.recipe;
    return {
      ...step,
      targetLabel: nextTargetLabel,
      sourceLabels: nextSourceLabels,
      recipe: nextRecipe
    };
  });
};

export const buildNodeStepIndex = (steps: PlaybackStep[]): Map<string, number> => {
  return new Map(steps.map((step, idx) => [step.targetNodeId, idx]));
};

export const buildFirstRevealNodeStepIndex = (steps: PlaybackStep[]): Map<string, number> => {
  const stepIndex = new Map<string, number>();
  steps.forEach((step, idx) => {
    const nodeId = String(step?.targetNodeId || '');
    if (!nodeId || stepIndex.has(nodeId))
      return;
    stepIndex.set(nodeId, idx);
  });
  return stepIndex;
};

const resolveMovementStepForLink = (
  link: ResolvedRelationLink,
  nodeStepIndex: Map<string, number>,
  lastStep: number
): number | undefined => {
  const sourceNodeId = String(link.sourceNodeId || '');
  const targetNodeId = String(link.targetNodeId || '');
  const traceNodeId = String(link.witnessNodeId || '');
  const sourceStep = sourceNodeId ? nodeStepIndex.get(sourceNodeId) : undefined;
  const targetStep = targetNodeId ? nodeStepIndex.get(targetNodeId) : undefined;
  const traceStep = traceNodeId ? nodeStepIndex.get(traceNodeId) : undefined;
  const rawStep = Number(link.stepIndex);
  const explicitStep = Number.isInteger(rawStep) && rawStep >= 0 ? Math.min(rawStep, lastStep) : undefined;
  const anchoredCandidates = [sourceStep, targetStep, traceStep].filter((step): step is number => step !== undefined);
  const anchoredStep = anchoredCandidates.length > 0 ? Math.max(...anchoredCandidates) : undefined;
  if (anchoredStep !== undefined && explicitStep !== undefined) {
    return Math.max(explicitStep, anchoredStep);
  }
  if (anchoredStep !== undefined)
    return anchoredStep;
  if (explicitStep !== undefined)
    return explicitStep;
  return undefined;
};

const resolveVisibleMovementTargetNode = (nodeById: Map<string, HierNode>, link: ResolvedRelationLink): HierNode | undefined => nodeById.get(String(link?.targetNodeId || ''));

export const buildDisplayRelationLinks = (resolvedRelationLinks: ResolvedRelationLink[] | undefined): ResolvedRelationLink[] => (resolvedRelationLinks || []).map((link) => ({
  ...link,
  relationIndex: String(link?.relationIndex || '').trim(),
  relation: String(link?.relation || link?.operation || '').trim() || undefined,
  sourceNodeId: String(link?.sourceNodeId || ''),
  targetNodeId: String(link?.targetNodeId || ''),
  witnessNodeId: String(link?.witnessNodeId || '') || undefined,
  renderFamily: link?.renderFamily || 'trajectory',
  trajectoryKind: normalizeTrajectoryKind(link?.trajectoryKind) || undefined,
  chainId: String(link?.chainId || '') || undefined
}));

export const buildMovementArrowsFromLinks = (
  visibleNodes: HierNode[],
  resolvedRelationLinks: ResolvedRelationLink[] | undefined,
  nodeStepIndex: Map<string, number>,
  playbackSteps: PlaybackStep[]
): MovementArrow[] => {
  if (!resolvedRelationLinks || resolvedRelationLinks.length === 0)
    return [];
  const nodeById = new Map(visibleNodes.map((node) => [getNodeId(node), node]));
  const pickTraceLikeLeafDescendant = (node?: HierNode): HierNode | undefined => {
    if (!node)
      return undefined;
    return node
      .descendants()
      .find((candidate) => isNotationLeaf(candidate.data));
  };
  /*
   * The fail-closed endpoint law, preserving Babel's established head-versus-
   * phrasal endpoint convention.
   *
   * - Phrasal movement departs from the authored lower trace TERMINAL (the
   *   witness's display leaf) and lands on the authored landing PHRASE SHELL.
   *   A phrasal link without a resolvable witness draws nothing — no other
   *   leaf or shell is ever substituted.
   * - Head movement (including reverse-direction head lowering) runs
   *   terminal-to-terminal: from the trace terminal to the pronounced head
   *   terminal, never a C/T/V preterminal shell.
   *
   * The only descent permitted is display resolution *inside the anchored
   * node's own subtree*: an authored anchor often names a preterminal whose
   * visible word replay materialized as a terminal child, and resolving that
   * child is deterministic interpretation of the same authored anchor. The
   * old ladder — any trace-like leaf anywhere, else any overt leaf, else an
   * ancestor phrase shell — chose endpoints the analysis never pointed at,
   * and is gone.
   */
  const pickOvertLeafDescendant = (node?: HierNode): HierNode | undefined => {
    if (!node)
      return undefined;
    return node
      .descendants()
      .find((candidate) => isLexicalLeaf(candidate.data));
  };
  const resolveWitnessDisplayLeaf = (node?: HierNode): HierNode | undefined => {
    if (!node)
      return undefined;
    return pickTraceLikeLeafDescendant(node) || node;
  };
  const resolveHeadTerminalDisplayLeaf = (node?: HierNode, preferTrace = false): HierNode | undefined => {
    if (!node)
      return undefined;
    if (!(node.children || []).length)
      return node;
    return preferTrace
      ? (pickTraceLikeLeafDescendant(node) || pickOvertLeafDescendant(node))
      : (pickOvertLeafDescendant(node) || pickTraceLikeLeafDescendant(node));
  };
  const displayLinks = buildDisplayRelationLinks(resolvedRelationLinks);
  const arrows: MovementArrow[] = [];
  const seen = new Set<string>();
  const lastStep = playbackSteps.length > 0 ? playbackSteps.length - 1 : 0;
  displayLinks.filter(isResolvedMovementLink).forEach((link) => {
    const rawSource = nodeById.get(String(link.sourceNodeId || ''));
    const rawTarget = resolveVisibleMovementTargetNode(nodeById, link);
    const authoredWitnessId = String(link.witnessNodeId || '');
    const rawTraceNode = authoredWitnessId
      ? nodeById.get(authoredWitnessId) || undefined
      : undefined;
    // An authored witness that does not resolve fails the arrow closed.
    if (authoredWitnessId && !rawTraceNode)
      return;
    const traceLeaf = rawTraceNode ? pickTraceLikeLeafDescendant(rawTraceNode) : undefined;
    const traceNode = traceLeaf || rawTraceNode;
    const linkLooksHeadLike = isHeadLikeResolvedRelation(link, nodeById);
    /*
     * Head movement runs terminal-to-terminal: the trace terminal (witness
     * first, else the source anchor's own display terminal) to the pronounced
     * head terminal inside the authored target — never a preterminal shell.
     * Phrasal movement departs from the witness's trace terminal and lands on
     * the authored landing phrase shell; without a resolvable witness the
     * phrasal drawing is refused rather than repaired from another node.
     */
    const displaySource = linkLooksHeadLike
      ? (resolveWitnessDisplayLeaf(rawTraceNode) || resolveHeadTerminalDisplayLeaf(rawSource, true))
      : resolveWitnessDisplayLeaf(rawTraceNode);
    const displayTarget = linkLooksHeadLike
      ? resolveHeadTerminalDisplayLeaf(rawTarget)
      : rawTarget;
    if (!displaySource || !displayTarget)
      return;
    const sourceId = getNodeId(displaySource);
    const targetId = getNodeId(displayTarget);
    if (sourceId === targetId)
      return;
    const key = `${sourceId}->${targetId}`;
    if (seen.has(key))
      return;
    seen.add(key);
    const step = resolveMovementStepForLink({
      ...link,
      sourceNodeId: sourceId,
      targetNodeId: targetId,
      witnessNodeId: traceNode ? getNodeId(traceNode) : undefined
    }, nodeStepIndex, lastStep);
    if (step === undefined)
      return;
    arrows.push({
      source: displaySource,
      sourceOccurrence: rawSource,
      target: displayTarget,
      traceNode: traceNode || undefined,
      step,
      index: null,
      operation: link.operation,
      trajectoryKind: normalizeTrajectoryKind(link.trajectoryKind) || (linkLooksHeadLike ? 'head' : 'phrasal')
    });
  });
  const arrowsByDisplayOrder = [...arrows].sort((a, b) => {
    if (a.step !== b.step)
      return a.step - b.step;
    const aSourceY = Number(a.source?.y || 0);
    const bSourceY = Number(b.source?.y || 0);
    if (aSourceY !== bSourceY)
      return bSourceY - aSourceY;
    const aSourceX = Number(a.source?.x || 0);
    const bSourceX = Number(b.source?.x || 0);
    if (aSourceX !== bSourceX)
      return aSourceX - bSourceX;
    const aTargetX = Number(a.target?.x || 0);
    const bTargetX = Number(b.target?.x || 0);
    return aTargetX - bTargetX;
  });
  const arrowParent = new Map<string, string>();
  const findArrowRoot = (nodeId: string): string => {
    const currentParent = arrowParent.get(nodeId);
    if (!currentParent) {
      arrowParent.set(nodeId, nodeId);
      return nodeId;
    }
    if (currentParent === nodeId)
      return nodeId;
    const root = findArrowRoot(currentParent);
    arrowParent.set(nodeId, root);
    return root;
  };
  const unionArrowNodes = (left: string, right: string) => {
    if (!left || !right)
      return;
    const leftRoot = findArrowRoot(left);
    const rightRoot = findArrowRoot(right);
    if (leftRoot !== rightRoot)
      arrowParent.set(rightRoot, leftRoot);
  };
  arrowsByDisplayOrder.forEach((arrow) => {
    const sourceOccurrenceId = arrow.sourceOccurrence
      ? getNodeId(arrow.sourceOccurrence)
      : getNodeId(arrow.source);
    unionArrowNodes(sourceOccurrenceId, getNodeId(arrow.target));
  });
  const displayIndexByComponent = new Map<string, string>();
  /*
   * Chain indices express authored relation order, not where a source happens
   * to land on the canvas. Keep the spatial sort for painting only; assigning
   * numbers from it reverses nested remnant, roll-up, and smuggling chains.
   */
  arrows.forEach((arrow) => {
    const sourceOccurrenceId = arrow.sourceOccurrence
      ? getNodeId(arrow.sourceOccurrence)
      : getNodeId(arrow.source);
    const root = findArrowRoot(sourceOccurrenceId);
    if (!displayIndexByComponent.has(root)) {
      displayIndexByComponent.set(root, String(displayIndexByComponent.size + 1));
    }
    arrow.index = displayIndexByComponent.get(root) || '1';
  });
  return arrows;
};

const collectHierarchyLineageIds = (root?: HierNode): Set<string> => new Set((root ? root.descendants() : [])
  .map((candidate) => String(candidate.data?.lineageId || ''))
  .filter(Boolean));

const collectHierarchyLineageContext = (node: HierNode): Set<string> => {
  const lineageIds = new Set<string>();
  let current: HierNode | null = node;
  while (current) {
    const lineageId = String(current.data?.lineageId || '');
    if (lineageId)
      lineageIds.add(lineageId);
    current = current.parent;
  }
  return lineageIds;
};

/**
 * Resolve each silent terminal to the smallest moved constituent that owns its
 * lineage. A larger remnant/carrier movement must not overwrite a nested
 * object's chain number, while a later movement of that nested object must
 * update every occurrence of its own lineage.
 */
export const buildMovementCopyTraceIndexByTerminalId = (movementArrows: MovementArrow[]): Map<string, string> => {
  const traceIndexByTerminalId = new Map<string, string>();
  const phrasalArrows = movementArrows.filter((arrow) => normalizeTrajectoryKind(arrow.trajectoryKind) === 'phrasal');
  const candidates: MovementCopyTraceCandidate[] = [];
  phrasalArrows.forEach((arrow, authoredOrder) => {
    const sourceOccurrence = arrow.sourceOccurrence;
    if (!sourceOccurrence || !(sourceOccurrence.children || []).length)
      return;
    const lexicalLeaves = sourceOccurrence.descendants().filter((candidate) => isLexicalLeaf(candidate.data));
    if (lexicalLeaves.length === 0)
      return;
    const whollySilentLexicalCopy = lexicalLeaves.every((leaf) => {
      const path: SyntaxNode[] = [];
      let current: HierNode | null = leaf;
      while (current) {
        path.push(current.data);
        if (current === sourceOccurrence)
          break;
        current = current.parent;
      }
      return path.reverse().reduce((silent, data) => replayEffectiveSilence(data, silent), false);
    });
    if (!whollySilentLexicalCopy)
      return;
    const sourceLineageIds = collectHierarchyLineageIds(sourceOccurrence);
    const targetLineageIds = collectHierarchyLineageIds(arrow.target);
    const commonLineageIds = new Set(Array.from(sourceLineageIds).filter((lineageId) => targetLineageIds.has(lineageId)));
    candidates.push({
      arrow,
      authoredOrder,
      commonLineageIds,
      sourceNodeCount: sourceOccurrence.descendants().length,
      lexicalLeaves
    });
  });
  const eligibleLeaves = new Map<string, HierNode>();
  candidates.forEach((candidate) => {
    candidate.lexicalLeaves.forEach((leaf) => eligibleLeaves.set(getNodeId(leaf), leaf));
  });
  eligibleLeaves.forEach((leaf, leafId) => {
    const lineageContext = collectHierarchyLineageContext(leaf);
    const matchingCandidates = candidates.filter((candidate) => (candidate.lexicalLeaves.some((candidateLeaf) => getNodeId(candidateLeaf) === leafId)
      || Array.from(lineageContext).some((lineageId) => candidate.commonLineageIds.has(lineageId))));
    matchingCandidates.sort((left, right) => (left.sourceNodeCount - right.sourceNodeCount
      || left.commonLineageIds.size - right.commonLineageIds.size
      || left.authoredOrder - right.authoredOrder));
    const chosen = matchingCandidates[0];
    const index = normalizeTraceIndexForDisplay(chosen?.arrow.index) || '';
    if (chosen && index)
      traceIndexByTerminalId.set(leafId, index);
  });
  return traceIndexByTerminalId;
};
