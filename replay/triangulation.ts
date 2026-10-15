/** Collapse eligible phrases while preserving protected movement participants. */
import { type ResolvedRelationLink } from '../relationLinks.ts';
import { type SyntaxNode } from '../types.ts';
import { getNodeId } from './displayIdentity.ts';
import { type HierNode } from './types.ts';

const getTerminalWords = (node: SyntaxNode): string[] => {
  if (!node.children || node.children.length === 0) {
    return node.word ? [node.word] : [node.label];
  }
  return node.children.flatMap(getTerminalWords);
};

export const buildMovementProtectedNodeIds = (resolvedRelationLinks?: ResolvedRelationLink[]): Set<string> => {
  const protectedIds = new Set<string>();
  (resolvedRelationLinks || []).forEach((link) => {
    const sourceId = String(link.sourceNodeId || '');
    const movedId = String(link.targetNodeId || '');
    const traceId = String(link.witnessNodeId || '');
    if (sourceId)
      protectedIds.add(sourceId);
    if (movedId)
      protectedIds.add(movedId);
    if (traceId)
      protectedIds.add(traceId);
  });
  return protectedIds;
};

export const markTriangulatedNodes = (rootHierarchy: HierNode, protectedNodeIds?: Set<string>) => {
  rootHierarchy.each((d) => {
    const label = (d.data.label || "").trim().toUpperCase();
    const isBackbone = label.startsWith('CP') ||
      label.startsWith('INFLP') ||
      label.startsWith('TP') ||
      label.startsWith('VP') ||
      label.includes("'") ||
      label.includes("BAR") ||
      label === 'C' ||
      label === 'INFL' ||
      label === 'V' ||
      label === 'T' ||
      label === 'v';
    const isPhrase = label.endsWith('P');
    const terminals = getTerminalWords(d.data);
    const containsProtectedMovementNode = (protectedNodeIds?.size || 0) > 0
      ? d.descendants().some((descendant) => protectedNodeIds.has(getNodeId(descendant)))
      : false;
    if (isPhrase && !isBackbone && !containsProtectedMovementNode && terminals.length >= 2) {
      (d as any).isTriangulated = true;
      (d as any).triangulatedWords = terminals.join(' ');
    }
  });
};

export const isUnderTriangulation = (d: HierNode) => {
  let current = d.parent;
  while (current) {
    if ((current as any).isTriangulated)
      return true;
    current = current.parent;
  }
  return false;
};
