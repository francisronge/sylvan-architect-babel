/** Classify resolved movement claims and choose their active Replay links. */
import { type ResolvedRelationLink } from '../relationLinks.ts';
import { type DerivationOperation, type SyntaxNode } from '../types.ts';
import {
  isFrontingMovementIdentity,
  isMovementIdentity,
  isRegisteredTrajectoryRelation,
  movementIdentityKind
} from './relations/movementIdentities.ts';
import { isTraceLike } from './replaySurfaceNotation.ts';
import { readStructuralHeads } from './structuralHeads.ts';
import { collectForestNodesById, findNodePathInForest, getNodeAtForestPath } from './syntaxForest.ts';
import {
  type HierNode,
  type PlaybackStep,
  type ReplayAuthoredRelationLink,
  type ReplayDerivationFrame
} from './types.ts';

interface DerivationMovementTransition {
  authoredLink: ResolvedRelationLink;
  sourceId: string;
  targetId: string;
  traceId: string | null;
  step: number;
  index: string;
  chainId?: string | null;
  operation?: DerivationOperation;
  trajectoryKind?: ResolvedRelationLink['trajectoryKind'];
  note?: string;
}

export const normalizeTrajectoryKind = (kind?: ResolvedRelationLink['trajectoryKind'] | string): ResolvedRelationLink['trajectoryKind'] | '' => {
  const normalized = String(kind || '').trim().toLowerCase();
  if (normalized === 'head' || normalized === 'phrasal')
    return normalized;
  return '';
};

/*
 * Operation-label kind refinement is exact identity metadata, never a text
 * pattern. An unlisted name has no kind and no fronting flavor; structure
 * decides or nothing does.
 */
const isHeadLikeOperationLabel = (operation?: string): boolean => movementIdentityKind(operation) === 'head';

export const isPhrasalReplayMovement = (link: ResolvedRelationLink): boolean => normalizeTrajectoryKind(link.trajectoryKind) === 'phrasal';

export const isFrontingLikeOperationLabel = (operation?: string): boolean => isFrontingMovementIdentity(operation);

const isPhrasalTrajectoryOperationLabel = (operation?: string): boolean => movementIdentityKind(operation) === 'phrasal';

// Whether each node is a head, read from shape whatever its category is called.
const headPositionsInForest = (forest: SyntaxNode[]) => {
  const heads = readStructuralHeads(forest);
  return (nodeId?: string): boolean => {
    const node = nodeId ? getNodeAtForestPath(forest, findNodePathInForest(forest, nodeId)) : undefined;
    return Boolean(node) && heads.isHeadPosition(node!);
  };
};

export const inferHeadLikeTrajectoryKindFromForest = ({ forest, operation, sourceNodeId, targetNodeId, traceNodeId }: {
  forest: SyntaxNode[];
  operation?: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  traceNodeId?: string;
}): ResolvedRelationLink['trajectoryKind'] => {
  if (isHeadLikeOperationLabel(operation))
    return 'head';
  if (isPhrasalTrajectoryOperationLabel(operation))
    return 'phrasal';
  const isHeadAt = headPositionsInForest(forest);
  const targetLooksHeadLike = isHeadAt(targetNodeId);
  const sourceLooksHeadLike = isHeadAt(sourceNodeId) || isHeadAt(traceNodeId);
  return targetLooksHeadLike && sourceLooksHeadLike ? 'head' : 'phrasal';
};

const inferHeadLikeTrajectoryKindFromVisibleNodes = (nodeById: Map<string, HierNode>, link?: ResolvedRelationLink | null): ResolvedRelationLink['trajectoryKind'] | '' => {
  if (!link)
    return '';
  const explicitKind = normalizeTrajectoryKind(link.trajectoryKind);
  if (explicitKind)
    return explicitKind;
  if (isHeadLikeOperationLabel(link.operation))
    return 'head';
  const targetId = String(link.targetNodeId || '');
  const sourceId = String(link.sourceNodeId || '');
  const traceId = String(link.witnessNodeId || '');
  const targetNode = targetId ? nodeById.get(targetId) : undefined;
  const sourceNode = sourceId ? nodeById.get(sourceId) : undefined;
  const traceNode = traceId ? nodeById.get(traceId) : undefined;
  const root = (targetNode ?? sourceNode ?? traceNode)?.ancestors().at(-1);
  const heads = root ? readStructuralHeads([root.data]) : undefined;
  const looksHeadLike = (node: HierNode | undefined) => Boolean(node && heads?.isHeadPosition(node.data));
  const targetLooksHeadLike = looksHeadLike(targetNode);
  const sourceLooksHeadLike = looksHeadLike(sourceNode) || looksHeadLike(traceNode);
  if (targetLooksHeadLike && sourceLooksHeadLike)
    return 'head';
  return '';
};

export const isHeadLikeResolvedRelation = (link?: ResolvedRelationLink | null, nodeById?: Map<string, HierNode>): boolean => {
  const explicitKind = normalizeTrajectoryKind(link?.trajectoryKind);
  if (explicitKind)
    return explicitKind === 'head';
  if (nodeById) {
    const inferredKind = inferHeadLikeTrajectoryKindFromVisibleNodes(nodeById, link);
    if (inferredKind)
      return inferredKind === 'head';
  }
  return isHeadLikeOperationLabel(link?.operation);
};

const inferPlaybackStepTrajectoryKind = (step?: PlaybackStep | null): PlaybackStep['trajectoryKind'] | '' => {
  const explicitKind = normalizeTrajectoryKind(step?.trajectoryKind);
  if (explicitKind)
    return explicitKind;
  // A step's own claim decides; links of earlier moments still on screen
  // (an earlier head movement's arrow) describe other movements.
  const identity = step?.replayRelationIdentity;
  const key = identity && `${identity.stageIndex}:${identity.relationIndex}`;
  const links = Array.isArray(step?.replayRelationLinks) ? step.replayRelationLinks : [];
  const own = key ? links.filter((link) => link?.authoredRelationKey === key && normalizeTrajectoryKind(link?.trajectoryKind)) : [];
  const linkKinds = links.length
    ? (own.length ? own : links)
      .map((link) => normalizeTrajectoryKind(link?.trajectoryKind))
      .filter((kind): kind is NonNullable<ResolvedRelationLink['trajectoryKind']> => Boolean(kind))
    : [];
  if (linkKinds.includes('head'))
    return 'head';
  if (linkKinds.includes('phrasal'))
    return 'phrasal';
  return isHeadLikeOperationLabel(step?.operation) ? 'head' : '';
};

export const isHeadLikePlaybackStep = (step?: PlaybackStep | null): boolean => inferPlaybackStepTrajectoryKind(step) === 'head';

/**
 * Where a movement's landing stands once later movement takes it on. As in
 * the render plan's occurrence transfers (relations/planPersistence.ts), a
 * later proven movement whose preceding source is this landing and whose
 * lower witness is another occurrence moves the hop's end to that witness:
 * the occurrence the later movement leaves in the landing's slot, whether or
 * not the landing kept its id. Each later stage applies in order, and a stage
 * whose movements name different witnesses proves nothing. Only links whose
 * moments have played are present, so nothing changes before the later
 * movement's own moment, and the hop reads as one link in a chain.
 */
const transferredLandingId = (landingId: string, step: number, movementLinks: readonly ResolvedRelationLink[]): string => {
  const later = movementLinks.filter(link => link.movementTransition && Number(link.stepIndex) > step && link.witnessNodeId)
    .sort((left, right) => Number(left.stepIndex) - Number(right.stepIndex));
  let target = landingId;
  for (const stage of new Set(later.map(link => Number(link.stepIndex)))) {
    const witnesses = new Set(later.filter(link => Number(link.stepIndex) === stage
      && link.priorSourceNodeId === target && link.witnessNodeId !== target).map(link => link.witnessNodeId!));
    if (witnesses.size === 1) target = [...witnesses][0];
  }
  return target;
};

export const resolveDerivationMovementTransitions = (
  currentForest: SyntaxNode[],
  derivationFrames: ReplayDerivationFrame[] | undefined,
  activeStepIndex: number,
  resolvedRelationLinks?: ResolvedRelationLink[]
): DerivationMovementTransition[] => {
  const frames = Array.isArray(derivationFrames) ? derivationFrames : [];
  if (frames.length === 0)
    return [];
  const currentNodeIds = new Set(collectForestNodesById(currentForest).keys());
  const lastFrameIndex = Math.min(activeStepIndex, frames.length - 1);
  const transitions: DerivationMovementTransition[] = [];
  const transitionKeys = new Set<string>();
  const movementLinks = (Array.isArray(resolvedRelationLinks) ? resolvedRelationLinks : []).filter(isResolvedMovementLink);
  movementLinks.forEach((link) => {
    const sourceId = String(link?.sourceNodeId || '');
    const step = Number.isInteger(link?.stepIndex) ? Number(link.stepIndex) : 0;
    const authoredTargetId = String(link?.targetNodeId || '');
    const targetId = sourceId && authoredTargetId && sourceId !== authoredTargetId && step >= 0 && step <= lastFrameIndex
      ? transferredLandingId(authoredTargetId, step, movementLinks)
      : authoredTargetId;
    if (!sourceId || !targetId || sourceId === targetId)
      return;
    if (step < 0 || step > lastFrameIndex)
      return;
    if (!currentNodeIds.has(sourceId) || !currentNodeIds.has(targetId))
      return;
    const transitionKey = `${sourceId}->${targetId}@${step}`;
    if (transitionKeys.has(transitionKey))
      return;
    transitionKeys.add(transitionKey);
    transitions.push({
      authoredLink: link,
      sourceId,
      targetId,
      traceId: currentNodeIds.has(String(link?.witnessNodeId || ''))
        ? String(link.witnessNodeId)
        : null,
      step,
      index: String(link?.relationIndex || '').trim() || `${transitions.length + 1}`,
      chainId: String(link?.chainId || '') || null,
      operation: link?.relation || link?.operation,
      trajectoryKind: normalizeTrajectoryKind(link?.trajectoryKind) || undefined,
      note: link?.note
    });
  });
  return transitions;
};

/*
 * Exact folded-identity movement classification. The substring/regex fallback
 * that used to live here drew movement arrows for authored non-movement
 * relations (an authored `CliticCluster` or `FocusShift` matched the
 * pattern). Classification now consults the declared exact identity set and
 * nothing else. Unlisted names are not movement — they dispatch through the
 * exact registry and, when unregistered, take the neutral fallback
 * presentation.
 */
export const isMoveLikeOperation = (operation?: DerivationOperation | string): boolean => isMovementIdentity(String(operation || ''));

export const isResolvedMovementLink = (link?: ResolvedRelationLink | null): boolean => {
  if (!link)
    return false;
  if (link.renderFamily === 'trajectory')
    return true;
  if (normalizeTrajectoryKind(link.trajectoryKind))
    return true;
  if (String((link as ReplayAuthoredRelationLink).authoredRelationKey || '').trim()) {
    return isRegisteredTrajectoryRelation(link.relation, link.anchors);
  }
  return isMoveLikeOperation(link.relation || link.operation);
};

export const getActiveReplayRelationLinks = (step?: PlaybackStep | null): ResolvedRelationLink[] => {
  const links = Array.isArray(step?.replayRelationLinks) ? step.replayRelationLinks : [];
  if (links.length === 0)
    return [];
  const stageIndex = step?.replayRelationIdentity?.stageIndex;
  const relationIndex = step?.replayRelationIdentity?.relationIndex;
  const linkKey = (link: ResolvedRelationLink) => String((link as ReplayAuthoredRelationLink).authoredRelationKey || '').trim();
  const identified = Number.isInteger(stageIndex) && Number.isInteger(relationIndex);
  if (identified) {
    const exactLinks = links.filter((link) => linkKey(link) === `${stageIndex}:${relationIndex}`);
    if (exactLinks.length > 0)
      return exactLinks;
  }
  if (step?.replayKind === 'relation') {
    const authoredName = String(step.operation || '').trim();
    // An identified moment never borrows a same-named link that another
    // authored relation, such as an earlier stage's, owns.
    return links.filter((link) => (!identified || !linkKey(link)) && String(link?.relation || '').trim() === authoredName);
  }
  return !step?.replayKind ? links : [];
};

export const stepRepresentsMovement = (step?: PlaybackStep | null): boolean => {
  if (!step)
    return false;
  if (isMoveLikeOperation(step.operation))
    return true;
  if (getActiveReplayRelationLinks(step).some(isResolvedMovementLink))
    return true;
  if (String(step.chainId || ''))
    return true;
  if (isTraceLike(step.targetLabel))
    return true;
  return (Array.isArray(step.sourceLabels) ? step.sourceLabels : []).some((label) => isTraceLike(label));
};

export const relationMomentUsesMovementSupport = (step: PlaybackStep): boolean => {
  if (step.replayKind !== 'relation')
    return true;
  return getActiveReplayRelationLinks(step).some(isResolvedMovementLink);
};
