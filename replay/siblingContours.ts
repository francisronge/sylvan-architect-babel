import type * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import type { TreeDirection } from './treeLayout.ts';

type Point = { x: number; y: number };

/** Sister subtrees keep their reading order on every row they share. Ordered
 * direct daughters do not imply this. A reservation can retain one subtree while
 * its sister was placed against another layout, and then a deeper node of either
 * passes under the other. A one-word specifier is enough, because its word leaf
 * sits one row below its category, beside a lower specifier.
 *
 * `current` holds the laid-out nodes painted in one frame. Future scaffolding and
 * workspace containers contribute no contour. Rows are matched by `y.toFixed(3)`,
 * which assumes the shared row grid of the stage layouts. */
export function siblingContoursOrdered<N extends d3.HierarchyNode<SyntaxNode> & Partial<Point>>(
  current: Iterable<N>, direction: TreeDirection = 'ltr', point: (node: N) => Point = node => ({ x: node.x!, y: node.y! })
): boolean {
  const syntax = new Set([...current].filter(node => !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace'));
  const sign = direction === 'rtl' ? -1 : 1;
  // Each contour maps a row to its [first, last] position in reading order.
  const contour = (node: N): Map<string, [number, number]> | null => {
    const own = point(node), x = own.x * sign;
    const result = new Map<string, [number, number]>([[own.y.toFixed(3), [x, x]]]);
    const earlier = new Map<string, number>();
    for (const child of (node.children ?? []) as N[]) {
      if (!syntax.has(child)) continue;
      const next = contour(child);
      if (!next) return null;
      for (const [row, [first]] of next) {
        const last = earlier.get(row);
        if (last !== undefined && first <= last + 1e-6) return null;
      }
      for (const [row, [first, last]] of next) {
        earlier.set(row, Math.max(earlier.get(row) ?? -Infinity, last));
        const span = result.get(row);
        result.set(row, span ? [Math.min(span[0], first), Math.max(span[1], last)] : [first, last]);
      }
    }
    return result;
  };
  for (const node of syntax) if ((!node.parent || !syntax.has(node.parent as N)) && !contour(node)) return false;
  return true;
}
