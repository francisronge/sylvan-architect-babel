/** Classify resolved movement claims and choose their active Replay links. */
import { type ResolvedRelationLink } from '../relationLinks.ts';
import { type DerivationOperation, type SyntaxNode } from '../types.ts';
import {
  isFrontingMovementIdentity,
  isMovementIdentity,
  isRegisteredTrajectoryRelation,
  movementIdentityKind
} from './relations/movementIdentities.ts';
import { isHeadShellLabel, isPhraseShellLabel, isTraceLike } from './replaySurfaceNotation.ts';
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

const isNodeOrImmediateParentHeadShellInForest = (forest: SyntaxNode[], nodeId?: string): boolean => {
  const normalizedNodeId = String(nodeId || '');
  if (!normalizedNodeId)
    return false;
  const nodePath = findNodePathInForest(forest, normalizedNodeId);
  const node = getNodeAtForestPath(forest, nodePath);
  if (node && isPhraseShellLabel(node.label))
    return false;
  if (node && isHeadShellLabel(node.label))
    return true;
  if (!Array.isArray(nodePath) || nodePath.length < 2)
    return false;
  const parent = getNodeAtForestPath(forest, nodePath.slice(0, -1));
  return Boolean(parent && isHeadShellLabel(parent.label));
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
  const targetLooksHeadLike = isNodeOrImmediateParentHeadShellInForest(forest, targetNodeId);
  const sourceLooksHeadLike = isNodeOrImmediateParentHeadShellInForest(forest, sourceNodeId)
    || isNodeOrImmediateParentHeadShellInForest(forest, traceNodeId);
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
  const targetLooksHeadLike = Boolean(targetNode && isHeadShellLabel(targetNode.data?.label));
  const sourceLooksHeadLike = Boolean((sourceNode && isHeadShellLabel(sourceNode.data?.label))
    || (traceNode && isHeadShellLabel(traceNode.data?.label))
    || (sourceNode?.parent && isHeadShellLabel(sourceNode.parent.data?.label))
    || (traceNode?.parent && isHeadShellLabel(traceNode.parent.data?.label)));
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
  const linkKinds = Array.isArray(step?.replayRelationLinks)
    ? step.replayRelationLinks
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
  (Array.isArray(resolvedRelationLinks) ? resolvedRelationLinks : []).forEach((link) => {
    if (!isResolvedMovementLink(link))
      return;
    const sourceId = String(link?.sourceNodeId || '');
    const targetId = String(link?.targetNodeId || '');
    if (!sourceId || !targetId || sourceId === targetId)
      return;
    const step = Number.isInteger(link?.stepIndex) ? Number(link.stepIndex) : 0;
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
