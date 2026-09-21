import type { Point, Rect } from './overlayGeometry.ts';

type Cubic = { source: Point; control1: Point; control2: Point; target: Point };

/** Subdivide the curve, not its coarse sample boxes, when testing nearby ink. */
export function cubicIntersectsRect(curve: Cubic, rect: Rect, padding: number): boolean {
  const left = rect.x - padding, right = rect.x + rect.width + padding;
  const top = rect.y - padding, bottom = rect.y + rect.height + padding;
  const middle = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const intersects = (a: Point, b: Point, c: Point, d: Point, depth: number): boolean => {
    const minX = Math.min(a.x, b.x, c.x, d.x), maxX = Math.max(a.x, b.x, c.x, d.x);
    const minY = Math.min(a.y, b.y, c.y, d.y), maxY = Math.max(a.y, b.y, c.y, d.y);
    if (maxX < left || minX > right || maxY < top || minY > bottom) return false;
    if ((a.x >= left && a.x <= right && a.y >= top && a.y <= bottom)
      || (d.x >= left && d.x <= right && d.y >= top && d.y <= bottom)) return true;
    // Keep unresolved boundary contact conservatively at the precision/depth limit.
    if (depth === 20 || Math.max(maxX - minX, maxY - minY) < 0.01) return true;
    const ab = middle(a, b), bc = middle(b, c), cd = middle(c, d);
    const abc = middle(ab, bc), bcd = middle(bc, cd), split = middle(abc, bcd);
    return intersects(a, ab, abc, split, depth + 1) || intersects(split, bcd, cd, d, depth + 1);
  };
  return intersects(curve.source, curve.control1, curve.control2, curve.target, 0);
}
