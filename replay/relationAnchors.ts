/** Resolve exact relation participants; display aliases do not create new authored anchors. */
import { type SyntaxNode } from '../types.ts';
import { normalizeTier2Synonym } from './relations/tier2Synonyms.ts';
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

/**
 * Membership of an authored role name in a renderer role list. Both sides use
 * the shared normalization of case, separators and camelCase, so `lowerCopy`,
 * `lower copy` and `lower-copy` are one role; spelling never decides a role.
 */
export const authoredRoleMatcher = (roles: readonly string[]): (role: unknown) => boolean => {
  const wanted = new Set(roles.map(normalizeTier2Synonym));
  return (role) => wanted.has(normalizeTier2Synonym(role));
};

export const findResolvedReplayAnchorByRoles = (anchors: ReplayResolvedRelationAnchor[], roles: readonly string[]): ReplayResolvedRelationAnchor | undefined => {
  const wanted = authoredRoleMatcher(roles);
  return anchors.find((anchor) => wanted(anchor.role));
};

export const findResolvedReplayAnchorsByRoles = (anchors: ReplayResolvedRelationAnchor[], roles: readonly string[]): ReplayResolvedRelationAnchor[] => {
  const wanted = authoredRoleMatcher(roles);
  return anchors.filter((anchor) => wanted(anchor.role));
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
