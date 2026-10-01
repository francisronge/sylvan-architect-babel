import type { SurfaceRealization, SyntaxNode } from '../types.ts';

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
