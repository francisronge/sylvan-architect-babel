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

/** A letter is not drawn when another mark, or its label's written text, shows
 * it. A drawn letter also shows the claims of the listed frame items. */
export type IndexLetterDraw = { draw: false } | { draw: true; alsoFor: readonly number[] };
export type IndexLetterPlan = (letter: IndexLetter) => IndexLetterDraw;

export interface IndexLetterContext {
  /** The label an identity coindex is written into, or null when no single label can show it. */
  identityLabel(nodeId: string): string | null;
  /** The index a label already shows as a written subscript, such as Opᵢ. */
  writtenSubscript(labelNodeId: string): string | null;
  /** Higher ranks are more prominent at the current Replay step. */
  emphasisRank(item: RelationPlanItem): number;
}

// An inline coindex is reserved label text. A binding index is placed clear of
// the binding path that ends at its label, so it holds over other beside letters.
const ROLE_ORDER: Record<IndexLetterRole, number> = { identity: 0, operator: 1, variable: 1, pronounced: 2, lf: 2, badge: 2 };
const letterKey = ({ itemIndex, role, nodeId }: IndexLetter) => JSON.stringify([itemIndex, role, nodeId]);

/** Assigns each (label, letter) of the drawable primitives to one painter.
 * Within one role order the most prominent owner holds, so a binding restated
 * by another facet, which keeps its own path, follows the active claim. Asking
 * about a letter outside these primitives is an error. */
export function planIndexLetters(
  primitives: readonly BoundPrimitive[], items: readonly RelationPlanItem[], context: IndexLetterContext
): IndexLetterPlan {
  const groups = new Map<string, IndexLetter[]>();
  for (const letter of primitives.flatMap(primitiveIndexLetters)) {
    const label = letter.role === 'identity' ? context.identityLabel(letter.nodeId) : letter.nodeId;
    if (label === null) continue;
    const key = JSON.stringify([label, letter.index]);
    groups.set(key, [...(groups.get(key) ?? []), letter]);
  }
  const draws = new Map<string, IndexLetterDraw>();
  for (const [key, group] of groups) {
    const [label, index] = JSON.parse(key) as [string, string];
    const [holder, ...others] = [...group].sort((left, right) => ROLE_ORDER[left.role] - ROLE_ORDER[right.role]
      || context.emphasisRank(items[right.itemIndex]) - context.emphasisRank(items[left.itemIndex])
      || left.itemIndex - right.itemIndex);
    const written = holder.role !== 'identity' && context.writtenSubscript(label) === index;
    for (const other of others) draws.set(letterKey(other), { draw: false });
    draws.set(letterKey(holder), written ? { draw: false }
      : { draw: true, alsoFor: [...new Set(others.map(other => other.itemIndex))].filter(item => item !== holder.itemIndex) });
  }
  return (letter) => {
    const draw = draws.get(letterKey(letter));
    if (!draw) throw new Error(`Index letter ${letterKey(letter)} is not among the drawable primitives`);
    return draw;
  };
}
