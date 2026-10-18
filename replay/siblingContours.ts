import type * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import type { TreeDirection } from './treeLayout.ts';
import { TREE_ROW_HEIGHT } from './treeSpacing.ts';

type Point = { x: number; y: number };
type Entry<N> = { node: N } | { row: string; position: number; entering: boolean };

/** Sister subtrees keep their reading order on every row they share. Ordered
 * direct daughters do not imply this. A reservation can retain one subtree while
 * its sister was placed against another layout, and then a deeper node of either
 * passes under the other. A one-word specifier is enough, because its word leaf
 * sits one row below its category, beside a lower specifier.
 *
 * A bare leaf between two sisters also occupies its column on every row below
 * it, down to its sisters' deepest row. Otherwise a sister's deeper descendant
 * can sit under the leaf, and the leaf's branch reads as that descendant's parent.
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
  const childrenOf = (node: N) => ((node.children ?? []) as N[]).filter(child => syntax.has(child));
  const roots = [...syntax].filter(node => !node.parent || !syntax.has(node.parent as N));
  // The deepest row of each current subtree, gathered children first.
  const order: N[] = [], deepest = new Map<N, number>();
  for (const pending = [...roots]; pending.length;) {
    const node = pending.pop()!;
    order.push(node);
    pending.push(...childrenOf(node));
  }
  for (const node of order.reverse())
    deepest.set(node, Math.max(point(node).y, ...childrenOf(node).map(child => deepest.get(child)!)));
  for (const root of roots) {
    // One pre-order walk per tree. When a node is entered, every finished node
    // lies in an earlier sister subtree of one of its ancestors, so the node must
    // follow the last finished position on its row. A leaf's column is walked
    // as if it were a chain of descendants.
    const finished = new Map<string, number>();
    const pending: Entry<N>[] = [{ node: root }];
    while (pending.length) {
      const entry = pending.pop()!;
      if (!('node' in entry) && !entry.entering) {
        finished.set(entry.row, Math.max(finished.get(entry.row) ?? -Infinity, entry.position));
        continue;
      }
      let row: string, position: number;
      const below: Entry<N>[] = [];
      if ('node' in entry) {
        const { x, y } = point(entry.node), children = childrenOf(entry.node);
        row = y.toFixed(3); position = x * sign;
        const sisters = entry.node.parent && syntax.has(entry.node.parent as N) ? childrenOf(entry.node.parent as N) : [];
        const index = sisters.indexOf(entry.node);
        if (!children.length && index > 0 && index < sisters.length - 1) {
          const bottom = Math.max(...sisters.map(sister => deepest.get(sister)!));
          for (let lower = y + TREE_ROW_HEIGHT; lower <= bottom + 1e-6; lower += TREE_ROW_HEIGHT)
            below.push({ row: lower.toFixed(3), position, entering: true });
        }
        for (let child = children.length - 1; child >= 0; child--) below.push({ node: children[child] });
      } else ({ row, position } = entry);
      const last = finished.get(row);
      if (last !== undefined && position <= last + 1e-6) return false;
      pending.push({ row, position, entering: false }, ...below);
    }
  }
  return true;
}
