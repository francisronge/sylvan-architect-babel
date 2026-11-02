import type * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { getNodeId } from './displayIdentity.ts';

/** The shared-ancestor shift, after minus before, that aligns stage coordinates
 * and that cross-stage planning measures crossings by: the median shift of
 * shared syntax whose shared ancestors are unchanged. A moved or reattached
 * constituent is left out unless nothing else is shared. The renderer's camera
 * carry (carryCamera in components/treeViewport.ts, carryReference below)
 * equals it except where a crossing lowers syntax under an inserted parent,
 * where the camera holds the syntax it does not lower, and where a movement
 * empties a lower occurrence that keeps the moved phrase's id, which the
 * camera does not hold (carryReference). Stage alignment keeps
 * this reference because the cross-stage reservations of waiting workspaces
 * are planned against it. Both take their median by `carriedMedian`, with the
 * same `closing`, so planning predicts the carry the screen applies. */
export function carriedShift(before: ReadonlyMap<string, d3.HierarchyPointNode<SyntaxNode>>, after: ReadonlyMap<string, d3.HierarchyPointNode<SyntaxNode>>,
  { closing = false }: CarryOptions = {}) {
  const parentOf = (nodes: typeof before, id: string) => {
    const parent = nodes.get(id)!.parent;
    return parent && nodes.has(getNodeId(parent)) ? getNodeId(parent) : null;
  };
  const sharedAncestors = (nodes: typeof before, id: string) => {
    const ids: string[] = [];
    for (let parent = parentOf(nodes, id); parent; parent = parentOf(nodes, parent)) if (before.has(parent) && after.has(parent)) ids.push(parent);
    return ids.join(' ');
  };
  const shared = [...before.keys()].filter(id => after.has(id));
  const unmoved = shared.filter(id => sharedAncestors(before, id) === sharedAncestors(after, id));
  const reference = unmoved.length ? unmoved : shared;
  if (!reference.length) return { x: 0, y: 0 };
  return { x: carriedMedian(reference.map(id => after.get(id)!.x - before.get(id)!.x), closing),
    y: carriedMedian(reference.map(id => after.get(id)!.y - before.get(id)!.y), closing) };
}

/** One frame's painted syntax: tree-space position and hierarchy parent, keyed by display ID. */
export type PaintedNodes = ReadonlyMap<string, { x: number; y: number; parentId: string | null }>;

/** When a crossing lowers syntax, the camera holds the rest only if more than
 * this many nodes remain; otherwise the shared-ancestor reference decides, since
 * a lone head or two is too slight a reference to outvote the lowered subtree. */
const MIN_HELD = 3;

/** Painted ancestors of `id`, nearest first. */
function lineage(nodes: PaintedNodes, id: string) {
  const ids: string[] = [];
  for (let parent = nodes.get(id)!.parentId; parent && nodes.has(parent); parent = nodes.get(parent)!.parentId) ids.push(parent);
  return ids;
}

/** Shared syntax the camera holds still across a stage crossing. A node is left
 * out when its ancestors shared by both frames change (a moved constituent), or
 * when it painted daughters before and paints none now: the lower occurrence of
 * a movement that keeps the moved phrase's id while the movement takes its
 * material (or a moved head's word), held no more than the new lower
 * occurrence it would be had the landing kept the id. It
 * is also left out when it is lowered: a parent is inserted or removed between
 * it and its old root, so its painted ancestry before no longer begins its
 * ancestry after (growth above the old root is not lowering). The ancestors of
 * lowered syntax are left out with it, since a parent recentres over its
 * children. With too little syntax left, the shared-ancestor rule alone decides,
 * unless the lowered words keep their place beside what is left; with none of
 * that, every shared node does. */
export function carryReference(before: PaintedNodes, after: PaintedNodes) {
  return carryReferences(before, after).reference;
}

/** The carry reference (`carryReference`) and the shared syntax whose shared
 * ancestors are unchanged (`unmoved`), which it is drawn from. */
function carryReferences(before: PaintedNodes, after: PaintedNodes): { reference: string[]; unmoved: string[] } {
  const shared = [...after.keys()].filter(id => before.has(id));
  // Shared nodes that painted a daughter before and paint none now. A moved
  // head's word is renamed with its owner (`s::__leaf` becomes `L::__leaf`),
  // so no daughter id need survive.
  const parentsAfter = new Set([...after.values()].map(node => node.parentId));
  const emptied = new Set([...before.values()].map(node => node.parentId)
    .filter((id): id is string => Boolean(id) && before.has(id!) && after.has(id!) && !parentsAfter.has(id)));
  const unmoved = shared.filter(id => {
    if (emptied.has(id)) return false;
    const prior = lineage(before, id).filter(ancestor => after.has(ancestor));
    const current = lineage(after, id).filter(ancestor => before.has(ancestor));
    return prior.length === current.length && prior.every((ancestor, index) => ancestor === current[index]);
  });
  const lowered = new Set(unmoved.filter(id => {
    const prior = lineage(before, id), current = lineage(after, id);
    return prior.some((ancestor, index) => ancestor !== current[index]);
  }));
  if (!lowered.size) return { reference: unmoved.length ? unmoved : shared, unmoved };
  const over = new Set([...lowered].flatMap(id => lineage(after, id)));
  const held = unmoved.filter(id => !lowered.has(id) && !over.has(id));
  if (held.length > MIN_HELD) return { reference: held, unmoved };
  if (!held.length) return { reference: unmoved, unmoved };
  // A lowered subtree whose words keep their place beside the few held nodes
  // (the stage plan held it where it stands after the crossing): those nodes are
  // the reference, so the subtree only drops its row and nothing else moves.
  const parents = new Set([...lowered].map(id => after.get(id)!.parentId));
  const words = [...lowered].filter(id => !parents.has(id));
  const shift = (ids: string[]) => middle(ids.map(id => after.get(id)!.x - before.get(id)!.x));
  return { reference: Math.abs(shift(words) - shift(held)) <= CARRY_TOLERANCE ? held : unmoved, unmoved };
}

const middle = (values: number[]) => {
  values.sort((a, b) => a - b);
  return (values[(values.length - 1) >> 1] + values[values.length >> 1]) / 2;
};

/** `closing`: the stage plan closed a movement's room at this crossing
 * (closeMovementGaps records it; stageCoordinates.closesOnEntry reads it). */
export type CarryOptions = {
  closing?: boolean;
  /** The syntax the carry holds still: at a crossing whose movement closes the
   * room it leaves, the stage plan records the shared syntax that closing does
   * not move (stageCoordinates.entryCarry), so the closing side slides and the
   * rest stays where it was. */
  held?: readonly string[];
  /** Break a tie in a narrowed reference toward the wider unmoved syntax
   * (`paintedShift`); false takes the plain median, as the screen does where
   * the tie's end would paint shared syntax farther beyond its view. */
  tie?: boolean;
};

/** Shifts within this many tree units count as one block (`carriedMedian`). */
const CARRY_TOLERANCE = 1;

/** The median of a reference's shifts. With an even count whose middle shifts
 * differ, every shift between them moves the reference as little in total.
 * Ordinarily the carry takes their midpoint, which moves both blocks by half
 * their difference; given `tie`, the median shift of wider syntax the reference
 * was drawn from, it takes the end nearer that instead, so the block the rest
 * of the syntax agrees with stays still. At a crossing where the plan's own
 * closing moves one side of a movement's room (`closing`), the carry takes the
 * end that more of the reference shares (within CARRY_TOLERANCE), if at least a
 * quarter of it does, so the block that holds still stays still, and otherwise
 * the midpoint. */
export function carriedMedian(values: number[], closing = false, tie?: number) {
  values.sort((a, b) => a - b);
  const low = values[(values.length - 1) >> 1], high = values[values.length >> 1];
  if (high - low <= CARRY_TOLERANCE) return (low + high) / 2;
  const near = (value: number) => values.filter(other => Math.abs(other - value) <= CARRY_TOLERANCE).length;
  const lows = near(low), highs = near(high), block = values.length / 4;
  const byTie = () => tie === undefined || Math.abs(Math.abs(tie - low) - Math.abs(tie - high)) <= CARRY_TOLERANCE ? (low + high) / 2
    : Math.abs(tie - low) < Math.abs(tie - high) ? low : high;
  if (!closing) return byTie();
  return lows > highs && lows >= block ? low : highs > lows && highs >= block ? high : (low + high) / 2;
}

/** The median shift, after minus before, of the camera's carry reference
 * (`carriedMedian`), restricted to the plan's `held` syntax where it records
 * some. A tie in a reference narrower than the unmoved shared syntax (a lowered
 * crossing, or a held one) is broken toward the median of that unmoved syntax. */
export function paintedShift(before: PaintedNodes, after: PaintedNodes, { closing = false, held, tie = true }: CarryOptions = {}) {
  const references = carryReferences(before, after), { unmoved } = references;
  const keep = held && new Set(held), kept = keep ? references.reference.filter(id => keep.has(id)) : [];
  const reference = kept.length ? kept : references.reference;
  if (!reference.length) return { x: 0, y: 0 };
  const axis = (of: (point: { x: number; y: number }) => number) => {
    const shifts = (ids: string[]) => ids.map(id => of(after.get(id)!) - of(before.get(id)!));
    const wider = tie && reference.length < unmoved.length ? carriedMedian(shifts(unmoved)) : undefined;
    return carriedMedian(shifts(reference), closing, wider);
  };
  return { x: axis(point => point.x), y: axis(point => point.y) };
}
