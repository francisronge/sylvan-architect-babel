/**
 * Shared index letters at one occurrence label.
 *
 * The dependency-index allocator gives one letter to the occurrences of one
 * chain, so several co-visible claims can assert the same letter at the same
 * occurrence. One QR relation earns both a covert path and a binding path, a
 * binding restatement repeats its operator and variable, and an identity
 * coindex can already sit inside a silent occurrence's label. Each claim keeps
 * its own marks, but one mark paints the letter at that label and every claim
 * asserting it owns that letter. Different letters at one occurrence stay separate.
 */
import type { BoundPrimitive } from './boundGeometry.ts';
import { planItemRelationRefs, type PlanRelationRef, type RelationPlanItem } from './renderPlan.ts';

export type IndexLetterRole = 'pronounced' | 'lf' | 'operator' | 'variable' | 'badge' | 'identity';

/** One letter that a drawable primitive paints beside, or inside, an exact occurrence label. */
export interface IndexLetterSlot {
  itemIndex: number;
  role: IndexLetterRole;
  /** The exact authored anchor whose letter this is. */
  nodeId: string;
  index: string;
  /** Inline letters are part of the label text; beside letters are separate glyphs. */
  inline: boolean;
}

/** Index-badge families whose painter reads this ownership. Other coindex
 * families are drawn by their own composed painters and keep their letters. */
const SHARED_BADGE_FAMILIES = new Set([
  'control.dependency', 'binding.domain', 'coreference.coindex', 'parasitic-gap.composition'
]);

/** The letters exactly as the production painters draw them for one primitive. */
export const primitiveIndexLetters = (primitive: BoundPrimitive, item: RelationPlanItem): IndexLetterSlot[] => {
  const slot = (role: IndexLetterRole, nodeId: string | undefined, index: string, inline = false): IndexLetterSlot[] =>
    nodeId && index ? [{ itemIndex: primitive.itemIndex, role, nodeId, index, inline }] : [];
  if (primitive.type === 'quantifier-raising') {
    return [...slot('pronounced', primitive.pronouncedNodeId, primitive.index), ...slot('lf', primitive.lfNodeId, primitive.index)];
  }
  if (primitive.type === 'operator-variable-binding') {
    // A suppressed restatement draws neither the shared path nor its indices.
    if (item.kind === 'operator-variable-binding' && item.bindingPathSuppressed) return [];
    return [...slot('operator', primitive.operatorNodeId, primitive.index),
      ...slot('variable', primitive.traceWitnessNodeId || primitive.variableNodeId, primitive.index)];
  }
  if (primitive.type === 'index-badge') {
    return SHARED_BADGE_FAMILIES.has(item.familyId || '') ? slot('badge', primitive.nodeId, primitive.index) : [];
  }
  if (primitive.type === 'identity-lens') {
    return primitive.nodeIds.flatMap(nodeId => slot('identity', nodeId, primitive.index, true));
  }
  return [];
};

export interface IndexLetterOwnershipOptions {
  /** Higher ranks hold a shared letter, so it takes the most prominent owner's emphasis. */
  emphasisRank?: (item: RelationPlanItem) => number;
  /** The occurrence whose label actually shows an inline letter, or null when
   * its painter cannot place it there. Beside letters use their own anchor. */
  inlineLabelNodeId?: (nodeId: string) => string | null;
}

export interface IndexLetterOwnership {
  /** Item indices owning the letter this slot paints, holder first; null when
   * another slot paints the same letter at this label. */
  owners(itemIndex: number, role: IndexLetterRole, nodeId: string): readonly number[] | null;
}

const slotKey = (itemIndex: number, role: IndexLetterRole, nodeId: string) => JSON.stringify([itemIndex, role, nodeId]);

/**
 * Inline letters hold, because they are reserved label text. Otherwise the
 * most prominent owner holds; a binding index holds over other beside letters
 * because its placement clears the binding path ending at that label.
 */
export const assignIndexLetterOwners = (
  marks: readonly { primitive: BoundPrimitive; item: RelationPlanItem }[],
  { emphasisRank = () => 0, inlineLabelNodeId = nodeId => nodeId }: IndexLetterOwnershipOptions = {}
): IndexLetterOwnership => {
  const groups = new Map<string, { slot: IndexLetterSlot; item: RelationPlanItem; order: number }[]>();
  let order = 0;
  for (const { primitive, item } of marks) {
    for (const slot of primitiveIndexLetters(primitive, item)) {
      const labelNodeId = slot.inline ? inlineLabelNodeId(slot.nodeId) : slot.nodeId;
      if (!labelNodeId) continue;
      const key = JSON.stringify([labelNodeId, slot.index]);
      const group = groups.get(key) ?? [];
      group.push({ slot, item, order: order++ });
      groups.set(key, group);
    }
  }
  const painterRank = (slot: IndexLetterSlot) => slot.inline ? 0 : slot.role === 'operator' || slot.role === 'variable' ? 1 : 2;
  const ownersBySlot = new Map<string, readonly number[] | null>();
  for (const group of groups.values()) {
    const ranked = [...group].sort((left, right) =>
      Number(right.slot.inline) - Number(left.slot.inline)
      || emphasisRank(right.item) - emphasisRank(left.item)
      || painterRank(left.slot) - painterRank(right.slot)
      || left.slot.itemIndex - right.slot.itemIndex
      || left.order - right.order);
    const [holder, ...shared] = ranked;
    const owners = [...new Set(ranked.map(entry => entry.slot.itemIndex))];
    ownersBySlot.set(slotKey(holder.slot.itemIndex, holder.slot.role, holder.slot.nodeId), owners);
    for (const entry of shared) {
      const key = slotKey(entry.slot.itemIndex, entry.slot.role, entry.slot.nodeId);
      // A repeated registration of the holder's own slot never silences it.
      if (!ownersBySlot.has(key)) ownersBySlot.set(key, null);
    }
  }
  return {
    owners: (itemIndex, role, nodeId) => {
      const owners = ownersBySlot.get(slotKey(itemIndex, role, nodeId));
      return owners === undefined ? [itemIndex] : owners;
    }
  };
};

/** The holder's item carrying every owning claim's relation references, so
 * hover and Replay emphasis reach the one painted letter from any owner. */
export const indexLetterOwner = (items: readonly RelationPlanItem[], owners: readonly number[]): RelationPlanItem | null => {
  const holder = items[owners[0]];
  if (!holder) return null;
  const refs = new Map<string, PlanRelationRef>();
  for (const owner of owners) {
    for (const ref of planItemRelationRefs(items[owner] ?? holder)) refs.set(`${ref.stageIndex}:${ref.relationIndex}`, ref);
  }
  const merged = [...refs.values()];
  return { ...holder, relationRef: merged[0], composedRefs: merged.slice(1), coalescedRefs: [] };
};
