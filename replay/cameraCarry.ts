import type * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { getNodeId } from './displayIdentity.ts';

/** The shared-ancestor shift, after minus before, that aligns stage coordinates
 * and that cross-stage planning measures crossings by: the median shift of
 * shared syntax whose shared ancestors are unchanged. A moved or reattached
 * constituent is left out unless nothing else is shared. The renderer's camera
 * carry (carryCamera in components/treeViewport.ts, carryReference below)
 * equals it except where a crossing lowers syntax under an inserted parent;
 * there the camera holds the syntax it does not lower. Stage alignment keeps
 * this reference because the cross-stage reservations of waiting workspaces
 * are planned against it. */
export function carriedShift(before: ReadonlyMap<string, d3.HierarchyPointNode<SyntaxNode>>, after: ReadonlyMap<string, d3.HierarchyPointNode<SyntaxNode>>) {
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
  const median = (values: number[]) => {
    values.sort((a, b) => a - b);
    return (values[(values.length - 1) >> 1] + values[values.length >> 1]) / 2;
  };
  return { x: median(reference.map(id => after.get(id)!.x - before.get(id)!.x)), y: median(reference.map(id => after.get(id)!.y - before.get(id)!.y)) };
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
 * out when its ancestors shared by both frames change (a moved constituent). It
 * is also left out when it is lowered: a parent is inserted or removed between
 * it and its old root, so its painted ancestry before no longer begins its
 * ancestry after (growth above the old root is not lowering). The ancestors of
 * lowered syntax are left out with it, since a parent recentres over its
 * children. With too little syntax left, the shared-ancestor rule alone decides;
 * with none of that, every shared node does. */
export function carryReference(before: PaintedNodes, after: PaintedNodes) {
  const shared = [...after.keys()].filter(id => before.has(id));
  const unmoved = shared.filter(id => {
    const prior = lineage(before, id).filter(ancestor => after.has(ancestor));
    const current = lineage(after, id).filter(ancestor => before.has(ancestor));
    return prior.length === current.length && prior.every((ancestor, index) => ancestor === current[index]);
  });
  const lowered = new Set(unmoved.filter(id => {
    const prior = lineage(before, id), current = lineage(after, id);
    return prior.some((ancestor, index) => ancestor !== current[index]);
  }));
  if (!lowered.size) return unmoved.length ? unmoved : shared;
  const over = new Set([...lowered].flatMap(id => lineage(after, id)));
  const held = unmoved.filter(id => !lowered.has(id) && !over.has(id));
  return held.length > MIN_HELD ? held : unmoved;
}

/** The median shift, after minus before, of the camera's carry reference.
 * With an even count whose middle shifts differ, every shift between them moves
 * the reference as little in total; the carry then takes the end that more of
 * the reference shares (within CARRY_TOLERANCE), if at least a quarter of it
 * does, so a block of syntax that holds together stays still, and otherwise
 * their midpoint. */
const CARRY_TOLERANCE = 1;
export function paintedShift(before: PaintedNodes, after: PaintedNodes) {
  const reference = carryReference(before, after);
  if (!reference.length) return { x: 0, y: 0 };
  const median = (values: number[]) => {
    values.sort((a, b) => a - b);
    const low = values[(values.length - 1) >> 1], high = values[values.length >> 1];
    if (high - low <= CARRY_TOLERANCE) return (low + high) / 2;
    const near = (value: number) => values.filter(other => Math.abs(other - value) <= CARRY_TOLERANCE).length;
    const lows = near(low), highs = near(high), block = values.length / 4;
    return lows > highs && lows >= block ? low : highs > lows && highs >= block ? high : (low + high) / 2;
  };
  return { x: median(reference.map(id => after.get(id)!.x - before.get(id)!.x)), y: median(reference.map(id => after.get(id)!.y - before.get(id)!.y)) };
}

