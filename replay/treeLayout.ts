import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';

export type TreeDirection = 'ltr' | 'rtl';

/** Reflect coordinates, never child order or glyphs. All geometry binds after this layout. */
export function layoutSyntaxTree(root: d3.HierarchyNode<SyntaxNode>, size: [number, number], direction: TreeDirection = 'ltr') {
  const tree = d3.tree<SyntaxNode>().size(size)
    .separation((a, b) => a.parent === b.parent ? 2.5 : 3.5)(root);
  if (direction === 'rtl') tree.each(node => { node.x = size[0] - node.x; });
  return tree;
}
