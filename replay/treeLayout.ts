import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { getNodeId } from './displayIdentity.ts';

export type TreeDirection = 'ltr' | 'rtl';
export type TreeCoordinateReservation = Map<string, { x: number; y: number }>;

/** Reflect coordinates, never child order or glyphs. All geometry binds after this layout. */
export function layoutSyntaxTree(root: d3.HierarchyNode<SyntaxNode>, size: [number, number], direction: TreeDirection = 'ltr',
  reservation?: ReadonlyMap<string, { x: number; y: number }>, visibleIds?: ReadonlySet<string>) {
  const tree = d3.tree<SyntaxNode>().size(size)
    .separation((a, b) => a.parent === b.parent ? 2.5 : 3.5)(root);
  if (reservation) tree.each(node => {
    const position = reservation.get(getNodeId(node));
    if (position) { node.x = position.x; node.y = position.y; }
  });
  // A reservation places occurrences, never a future branch. Current parents
  // remain centered above their actual children as new structure appears.
  tree.eachAfter(node => {
    if (node.data.replayLayoutOnly || !node.children?.length || (visibleIds && !visibleIds.has(getNodeId(node)))) return;
    const current = node.children.filter(child => !child.data.replayLayoutOnly && (!visibleIds || visibleIds.has(getNodeId(child))));
    if (reservation && current.length) {
      const center = (current[0].x + current[current.length - 1].x) / 2;
      if (Math.abs(node.x - center) > 1e-8) node.x = center;
    }
    else if (current.length === 1 && current.length < node.children.length) node.x = current[0].x;
  });
  if (direction === 'rtl') tree.each(node => { node.x = size[0] - node.x; });
  return tree;
}
