import type { TreeDirection } from './treeLayout.ts';

type Point = { x: number; y: number };

/** Sister subtrees keep their left-to-right order on every row they share.
 * Ordered direct daughters do not imply this: a reservation can retain one
 * subtree while its new sister was placed against another layout, and a
 * deeper node of either can then pass under the other. A one-word specifier
 * is enough, because its word leaf sits one row below its category. Callers
 * pass only current syntax; invisible future scaffolding has no contour. */
export function siblingContoursOrdered<N>(roots: Iterable<N>, children: (node: N) => readonly N[],
  point: (node: N) => Point, direction: TreeDirection = 'ltr'): boolean {
  const sign = direction === 'rtl' ? -1 : 1;
  const row = (y: number) => y.toFixed(3);
  // Each contour maps a row to the [leftmost, rightmost] reading-order position.
  const contour = (node: N): Map<string, [number, number]> | null => {
    const own = point(node), x = own.x * sign;
    const result = new Map<string, [number, number]>([[row(own.y), [x, x]]]);
    const earlier = new Map<string, number>();
    for (const child of children(node)) {
      const next = contour(child);
      if (!next) return null;
      for (const [key, [left]] of next) {
        const right = earlier.get(key);
        if (right !== undefined && left <= right + 1e-6) return null;
      }
      for (const [key, [left, right]] of next) {
        earlier.set(key, Math.max(earlier.get(key) ?? -Infinity, right));
        const current = result.get(key);
        result.set(key, current ? [Math.min(current[0], left), Math.max(current[1], right)] : [left, right]);
      }
    }
    return result;
  };
  for (const root of roots) if (!contour(root)) return false;
  return true;
}
