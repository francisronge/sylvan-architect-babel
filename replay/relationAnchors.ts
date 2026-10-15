/** Resolve exact relation participants; display aliases do not create new authored anchors. */
import { type SyntaxNode } from '../types.ts';
import { findExactNodeByIdInForest } from './syntaxForest.ts';
import { type DerivationReplayPlanStep, type ReplayResolvedRelationAnchor } from './types.ts';

export const relationAnchorNodeIds = (block?: Record<string, unknown>): string[] => Object.values(block || {})
  .flatMap((value) => Array.isArray(value) ? value : [value])
  .map((value) => String(value || ''))
  .filter((id) => Boolean(id.trim()));

export const getResolvedReplayRelationAnchors = (relation?: DerivationReplayPlanStep | null): ReplayResolvedRelationAnchor[] => (Array.isArray(relation?.resolvedAnchors)
  ? relation.resolvedAnchors
    .filter((anchor) => Boolean(String(anchor?.nodeId || '')))
    .map((anchor) => ({
      ...anchor,
      role: String(anchor.role || ''),
      nodeId: String(anchor.nodeId || '')
    }))
  : []);

export const getRelationTargetNodeId = (relation?: DerivationReplayPlanStep | null): string => String(relation?.targetNodeId || '');

export const getRelationSourceNodeIds = (relation?: DerivationReplayPlanStep | null): string[] => (Array.isArray(relation?.sourceNodeIds)
  ? relation.sourceNodeIds
    .map((nodeId) => String(nodeId || ''))
    .filter(Boolean)
  : []);

export const getRelationAllAnchorNodeIds = (relation?: DerivationReplayPlanStep | null): string[] => getResolvedReplayRelationAnchors(relation)
  .map((anchor) => String(anchor.nodeId || ''))
  .filter(Boolean);

export const findResolvedReplayAnchorByRoles = (anchors: ReplayResolvedRelationAnchor[], roles: readonly string[]): ReplayResolvedRelationAnchor | undefined => {
  const wantedRoles = new Set(roles.map((role) => role.toLowerCase()));
  return anchors.find((anchor) => wantedRoles.has(String(anchor.role || '').trim().toLowerCase()));
};

export const findResolvedReplayAnchorsByRoles = (anchors: ReplayResolvedRelationAnchor[], roles: readonly string[]): ReplayResolvedRelationAnchor[] => {
  const wantedRoles = new Set(roles.map((role) => role.toLowerCase()));
  return anchors.filter((anchor) => wantedRoles.has(String(anchor.role || '').trim().toLowerCase()));
};

export const relationAnchorsExistInForest = (
  forest: SyntaxNode[],
  targetNodeId: string,
  sourceNodeId: string
): boolean => (Boolean(targetNodeId)
  && Boolean(sourceNodeId)
  && Boolean(findExactNodeByIdInForest(forest, targetNodeId))
  && Boolean(findExactNodeByIdInForest(forest, sourceNodeId)));

export const resolveRelationAnchorNodeId = (
  forest: SyntaxNode[],
  rawNodeId: string
): string => {
  const requestedNodeId = String(rawNodeId || '');
  if (!requestedNodeId)
    return '';
  const exactNode = findExactNodeByIdInForest(forest, requestedNodeId);
  return exactNode ? String(exactNode.id || requestedNodeId) : '';
};
