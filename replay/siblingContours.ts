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
 * so this relies on the stage layouts' shared 220-unit row grid; the regression
 * suite checks that every committed fixture stays on it. */
export function siblingContoursOrdered<N extends d3.HierarchyNode<SyntaxNode> & Partial<Point>>(
  current: Iterable<N>, direction: TreeDirection = 'ltr', point: (node: N) => Point = node => ({ x: node.x!, y: node.y! })
): boolean {
  const syntax = new Set([...current].filter(node => !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace'));
  const sign = direction === 'rtl' ? -1 : 1;
  for (const root of syntax) {
    if (root.parent && syntax.has(root.parent as N)) continue;
    // One pre-order walk per tree. When a node is entered, every finished node
    // lies in an earlier sister subtree of one of its ancestors, so the node must
    // follow the last finished position on its row.
    const finished = new Map<string, number>();
    const pending: Array<{ node: N } | { row: string; position: number }> = [{ node: root }];
    while (pending.length) {
      const entry = pending.pop()!;
      if (!('node' in entry)) {
        finished.set(entry.row, Math.max(finished.get(entry.row) ?? -Infinity, entry.position));
        continue;
      }
      const { x, y } = point(entry.node), row = y.toFixed(3), position = x * sign;
      const last = finished.get(row);
      if (last !== undefined && position <= last + 1e-6) return false;
      pending.push({ row, position });
      const children = (entry.node.children ?? []) as N[];
      for (let index = children.length - 1; index >= 0; index--) {
        if (syntax.has(children[index])) pending.push({ node: children[index] });
      }
    }
  }
  return true;
}
