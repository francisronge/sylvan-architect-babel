import type { DerivationStageRelation, SurfaceRealization, SyntaxNode } from '../types.ts';
import { normalizeTier2Synonym } from './relations/tier2Synonyms.ts';

export const sameRealizationMembers = <T extends string | number>(left: readonly T[], right: readonly T[]): boolean =>
  left.length === right.length && new Set(left).size === left.length
  && new Set(right).size === right.length && left.every(value => right.includes(value));

/** Exact current syntax and a unique, non-overlapping input association prove a group. */
export function exactRealizationGroup(
  nodeIds: readonly string[],
  groups: readonly SurfaceRealization[] = [],
  forest: readonly SyntaxNode[] = []
): SurfaceRealization | undefined {
  if (!nodeIds.length || new Set(nodeIds).size !== nodeIds.length) return undefined;
  const counts = new Map<string, number>();
  const visit = (node: SyntaxNode) => {
    counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
    node.children?.forEach(visit);
  };
  forest.forEach(visit);
  if (nodeIds.some(id => counts.get(id) !== 1)) return undefined;
  const matches = groups.filter(group => sameRealizationMembers(group.nodeIds, nodeIds));
  if (matches.length !== 1) return undefined;
  const group = matches[0];
  if (!group.tokenIndices.length || new Set(group.tokenIndices).size !== group.tokenIndices.length
    || group.tokenIndices.some(index => !Number.isInteger(index) || index < 0)
    || groups.some(other => other !== group && other.tokenIndices.some(index => group.tokenIndices.includes(index)))) return undefined;
  return group;
}

/** A shared field qualifier binds an exact contributor inventory to its input
 * literal. Qualifiers are open; neither word concatenation nor prose supplies
 * a missing association. All named pairs must agree with the authored groups. */
export function namedInputRealizationGroups(
  relation: DerivationStageRelation, groups: readonly SurfaceRealization[],
  forest: readonly SyntaxNode[], inputTokens: readonly string[] = []
): SurfaceRealization[] {
  const anchors = Object.entries(relation.anchors ?? {});
  const tokens = new Map<string, string[]>();
  for (const [key, value] of Object.entries(relation.values ?? {})) {
    const qualifier = /^(.+?) (?:(?:input )?tokens?|spelling)$/u.exec(normalizeTier2Synonym(key))?.[1];
    if (!qualifier) continue;
    if (tokens.has(qualifier) || typeof value !== 'string' && !Array.isArray(value)) return [];
    const pieces = typeof value === 'string' ? [value] : value;
    if (!pieces.length || pieces.some(piece => typeof piece !== 'string' || !piece)) return [];
    tokens.set(qualifier, pieces as string[]);
  }
  const result: SurfaceRealization[] = [], qualifiers = new Set<string>();
  for (const [key, ids] of anchors) {
    const qualifier = /^(.+) (?:contributors?|token sources?)$/u.exec(normalizeTier2Synonym(key))?.[1];
    if (!qualifier || qualifiers.has(qualifier) || !Array.isArray(ids)) return [];
    qualifiers.add(qualifier);
    const group = exactRealizationGroup(ids, groups, forest), literal = tokens.get(qualifier);
    if (!group || !literal || result.includes(group)) return [];
    const positions = [...group.tokenIndices].sort((a, b) => a - b);
    if (literal.length !== positions.length || positions.some((position, i) => literal[i] !== inputTokens[position])) return [];
    result.push(group);
  }
  return result.length && qualifiers.size === tokens.size ? result : [];
}
