/**
 * One painted index letter per occurrence label.
 *
 * The dependency-index allocator gives one chain one letter, so co-visible marks
 * can assert the same letter at the same occurrence: a QR relation's covert
 * path and binding path both index its operator and variable, and a silent
 * occurrence's label may already show the letter. The binding painters draw
 * exactly the letters listed here, and only those assigned to them.
 */
import type { BoundPrimitive } from '../../replay/relations/boundGeometry.ts';
import type { RelationPlanItem } from '../../replay/relations/renderPlan.ts';

export type IndexLetterRole = 'pronounced' | 'lf' | 'operator' | 'variable' | 'badge' | 'identity';
export interface IndexLetter { itemIndex: number; role: IndexLetterRole; nodeId: string; index: string }

/** Every letter a binding painter can draw for one primitive, in drawing order. */
export const primitiveIndexLetters = (primitive: BoundPrimitive): IndexLetter[] => {
  const at = (role: IndexLetterRole, nodeId: string | undefined, index: string): IndexLetter[] =>
    nodeId && index ? [{ itemIndex: primitive.itemIndex, role, nodeId, index }] : [];
  switch (primitive.type) {
    case 'quantifier-raising':
      return [...at('pronounced', primitive.pronouncedNodeId, primitive.index), ...at('lf', primitive.lfNodeId, primitive.index)];
    case 'operator-variable-binding':
      return [...at('operator', primitive.operatorNodeId, primitive.index),
        ...at('variable', primitive.traceWitnessNodeId || primitive.variableNodeId, primitive.index)];
    case 'index-badge': return at('badge', primitive.nodeId, primitive.index);
    case 'identity-lens': return primitive.nodeIds.flatMap(nodeId => at('identity', nodeId, primitive.index));
    default: return [];
  }
};

/** `none`: another letter shows it. `glyph`: draw this letter. `label`: the
 * label's written subscript already shows it, so decorate that label instead.
 * A drawn or decorated letter also carries the claims of `alsoFor`. */
export type IndexLetterDraw<Label> = { draw: 'none' } | { draw: 'glyph' | 'label'; label: Label; alsoFor: readonly number[] };
export type IndexLetterPlan<Label> = (letter: IndexLetter) => IndexLetterDraw<Label>;

export interface IndexLetterContext<Label> {
  /** The physical label a letter is drawn in or beside, or null when an
   * identity coindex has no single label to show it. */
  labelOf(letter: IndexLetter, primitive: BoundPrimitive): Label | null;
  /** The index a label already shows as a written subscript, such as Opᵢ. */
  writtenSubscript(label: Label): string | null;
  /** Higher ranks are more prominent at the current Replay step. */
  emphasisRank(item: RelationPlanItem): number;
}

// After inline coindices, a binding index holds over other beside letters
// because its placement clears the binding path that ends at its label.
const ROLE_ORDER: Record<IndexLetterRole, number> = { identity: 0, operator: 1, variable: 1, pronounced: 2, lf: 2, badge: 2 };
const letterKey = ({ itemIndex, role, nodeId }: IndexLetter) => JSON.stringify([itemIndex, role, nodeId]);

/** Assigns each (label, letter) of the drawable primitives to one painter. An
 * inline coindex is label text, so it holds. Otherwise the most prominent owner
 * holds: a letter drawn inside a dimmed owner's group cannot be brightened.
 * Asking about a letter outside these primitives is an error. */
export function planIndexLetters<Label>(
  primitives: readonly BoundPrimitive[], items: readonly RelationPlanItem[], context: IndexLetterContext<Label>
): IndexLetterPlan<Label> {
  const groups = new Map<Label, Map<string, IndexLetter[]>>();
  for (const primitive of primitives) for (const letter of primitiveIndexLetters(primitive)) {
    const label = context.labelOf(letter, primitive);
    if (label === null) continue;
    const letters = groups.get(label) ?? new Map<string, IndexLetter[]>();
    letters.set(letter.index, [...(letters.get(letter.index) ?? []), letter]);
    groups.set(label, letters);
  }
  const draws = new Map<string, IndexLetterDraw<Label>>();
  for (const [label, letters] of groups) for (const [index, group] of letters) {
    const [holder, ...others] = [...group].sort((left, right) =>
      Number(right.role === 'identity') - Number(left.role === 'identity')
      || context.emphasisRank(items[right.itemIndex]) - context.emphasisRank(items[left.itemIndex])
      || ROLE_ORDER[left.role] - ROLE_ORDER[right.role] || left.itemIndex - right.itemIndex);
    const written = holder.role !== 'identity' && context.writtenSubscript(label) === index;
    for (const other of others) draws.set(letterKey(other), { draw: 'none' });
    draws.set(letterKey(holder), { draw: written ? 'label' : 'glyph', label,
      alsoFor: [...new Set(others.map(other => other.itemIndex))].filter(item => item !== holder.itemIndex) });
  }
  return (letter) => {
    const draw = draws.get(letterKey(letter));
    if (!draw) throw new Error(`Index letter ${letterKey(letter)} is not among the drawable primitives`);
    return draw;
  };
}
