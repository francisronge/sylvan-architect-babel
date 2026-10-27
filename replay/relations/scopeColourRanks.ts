import type { RelationPlanItem } from './renderPlan.ts';

type ScopeItem = Extract<RelationPlanItem, { kind: 'operator-variable-binding' }>;

/** Colour ranks of the operator-variable scope domains a step shows. A second
 * colour marks several domains on screen at once, so only revealed domains
 * count, and each keeps its rank in the order the domains appeared: a later
 * domain never recolours an earlier one. */
export function rankScopeDomains(frameItems: readonly RelationPlanItem[], revealed: ReadonlySet<number>) {
  const ranks = new Map<number, number>();
  const scopes = frameItems
    .map((item, itemIndex) => ({ item, itemIndex }))
    .filter((entry): entry is { item: ScopeItem; itemIndex: number } =>
      entry.item.kind === 'operator-variable-binding' && Boolean(entry.item.scopeDomainNodeId) && revealed.has(entry.itemIndex))
    .sort((left, right) => left.item.relationRef.stageIndex - right.item.relationRef.stageIndex
      || left.item.relationRef.relationIndex - right.item.relationRef.relationIndex
      || (right.item.scopeMemberNodeIds?.length || 0) - (left.item.scopeMemberNodeIds?.length || 0)
      || left.itemIndex - right.itemIndex);
  scopes.forEach((entry, rank) => ranks.set(entry.itemIndex, rank));
  return { ranks, scopes };
}
