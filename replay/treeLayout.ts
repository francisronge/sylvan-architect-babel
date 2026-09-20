import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';

export type TreeDirection = 'ltr' | 'rtl';

/** Reflect coordinates, never child order or glyphs. All geometry binds after this layout. */
export function layoutSyntaxTree(root: d3.HierarchyNode<SyntaxNode>, size: [number, number], direction: TreeDirection = 'ltr') {
  const tree = d3.tree<SyntaxNode>().size(size)
    .separation((a, b) => a.parent === b.parent ? 2.5 : 3.5)(root);
  // Future siblings reserve their own positions, but cannot bend a currently
  // unary projection toward an empty landing. Its branch follows its real child.
  tree.eachAfter(node => {
    if (node.data.replayLayoutOnly || !node.children?.some(child => child.data.replayLayoutOnly)) return;
    const current = node.children.filter(child => !child.data.replayLayoutOnly);
    if (current.length === 1) node.x = current[0].x;
  });
  if (direction === 'rtl') tree.each(node => { node.x = size[0] - node.x; });
  return tree;
}
