import type { DerivationStageRelation, SyntaxNode } from '../../types.ts';
import { TRAJECTORY_WITNESS_ROLES } from './renderFamilies.ts';

export const flattenAnchorIds = (value: string | string[] | undefined): string[] =>
  (Array.isArray(value) ? value : [value])
    .map((item) => String(item || ''))
    .filter((id) => Boolean(id.trim()));

export const collectForest = (forest: readonly SyntaxNode[] | undefined): Map<string, SyntaxNode> => {
  const nodes = new Map<string, SyntaxNode>();
  const walk = (node: SyntaxNode) => {
    const id = String(node.id || '');
    if (id) nodes.set(id, node);
    (Array.isArray(node.children) ? node.children : []).forEach(walk);
  };
  (Array.isArray(forest) ? forest : []).forEach(walk);
  return nodes;
};

export const collectSubtreeIds = (node?: SyntaxNode): string[] => {
  if (!node) return [];
  const ids: string[] = [];
  const walk = (current: SyntaxNode) => {
    const id = String(current.id || '');
    if (id) ids.push(id);
    (Array.isArray(current.children) ? current.children : []).forEach(walk);
  };
  walk(node);
  return ids;
};

export const collectLexicalTerminalIds = (node?: SyntaxNode): string[] => {
  if (!node) return [];
  const ids: string[] = [];
  const walk = (current: SyntaxNode) => {
    const id = String(current.id || '');
    const children = current.children || [];
    const surface = String(current.word || (children.length === 0 ? current.label : '') || '').trim();
    if (id && children.length === 0 && surface) ids.push(id);
    children.forEach(walk);
  };
  walk(node);
  return ids;
};

export const collectSubtreeLeafIds = (node?: SyntaxNode): string[] => {
  if (!node) return [];
  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length === 0) {
    const id = String(node.id || '');
    return id ? [id] : [];
  }
  return children.flatMap(collectSubtreeLeafIds);
};

export const collectRemnantDepartureLeafIds = (
  root: SyntaxNode | undefined,
  excludedRoots: SyntaxNode[]
): string[] => {
  if (!root) return [];
  const excludedIds = new Set(excludedRoots.flatMap(collectSubtreeIds));
  const departureIds: string[] = [];
  const walk = (node: SyntaxNode) => {
    const children = Array.isArray(node.children) ? node.children : [];
    const id = String(node.id || '');
    if (
      children.length === 0
      && id
      && !excludedIds.has(id)
      && node.silent === true
      && String(node.label || '').trim() !== '∅'
    ) {
      departureIds.push(id);
    }
    children.forEach(walk);
  };
  walk(root);
  return departureIds;
};

export const structuralLeafCount = (node?: SyntaxNode): number => {
  if (!node) return 0;
  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length === 0) return 1;
  return children.reduce((count, child) => count + structuralLeafCount(child), 0);
};

export const firstRole = (
  anchors: Record<string, string | string[]>,
  roles: readonly string[]
): { role: string; nodeId: string } | null => {
  for (const role of roles) {
    const ids = flattenAnchorIds(anchors?.[role]);
    if (ids.length > 0) return { role, nodeId: ids[0] };
  }
  return null;
};

/**
 * Lowering head/phrase split by anchored topology and authored roles, never a
 * category-name pattern.
 */
export const loweringIsPhraseSized = (
  relation: DerivationStageRelation,
  nodes: Map<string, SyntaxNode>,
  sourceNodeId: string,
  targetNodeId: string
): boolean => {
  const dominatesInternalStructure = (nodeId: string): boolean => {
    const anchorNode = nodes.get(nodeId);
    return Boolean(anchorNode) && (anchorNode?.children || [])
      .some((child) => Array.isArray(child.children) && child.children.length > 0);
  };
  const authorsPhrasalRoles = TRAJECTORY_WITNESS_ROLES.some((role) => relation.anchors?.[role] !== undefined);
  return authorsPhrasalRoles
    || dominatesInternalStructure(sourceNodeId)
    || dominatesInternalStructure(targetNodeId);
};

/**
 * Chain identity, tightened to what authored data proves:
 * - Primary: the shared authored `lineageId` of the anchored occurrences.
 *   A lineage-keyed chain keeps its identity as its occurrence list grows
 *   or is reordered, because the lineage — not the list — is the key.
 * - Fallback (no shared lineage): the family tag plus the sorted anchored
 *   participant set. This is stable under harmless anchor-array
 *   reordering, but a no-lineage chain that GROWS is a new participant
 *   set — the compiler cannot prove it is the same chain and does not
 *   pretend to. Unrelated no-lineage chains are never merged.
 * Display numerals are allocated in first-encounter order within one
 * compilation; identity keys are stable, but reordering relations or
 * stages can renumber which chain gets which numeral.
 */
export const stableChainKey = (
  tag: string,
  nodes: Map<string, SyntaxNode>,
  ids: string[]
): string => {
  const lineageSets = ids.map((id) => {
    const lineages = new Set<string>();
    const anchorNode = nodes.get(id);
    if (anchorNode) {
      const walk = (current: SyntaxNode) => {
        const lineageId = String(current.lineageId || '');
        if (lineageId) lineages.add(lineageId);
        (Array.isArray(current.children) ? current.children : []).forEach(walk);
      };
      walk(anchorNode);
    }
    return lineages;
  });
  const shared = lineageSets.length > 0
    ? Array.from(lineageSets[0])
      .filter((lineageId) => lineageSets.every((set) => set.has(lineageId)))
      .sort()
      .join('|')
    : '';
  return shared
    ? `lineage:${shared}`
    : `${tag}:${Array.from(new Set(ids)).sort().join(',')}`;
};

