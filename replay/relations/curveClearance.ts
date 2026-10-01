import type { Point, Rect } from './overlayGeometry.ts';

export type Cubic = { source: Point; control1: Point; control2: Point; target: Point };

/** Subdivide the curve, not its coarse sample boxes, when testing nearby ink. */
export function cubicIntersectsRect(curve: Cubic, rect: Rect, padding: number): boolean {
  const left = rect.x - padding, right = rect.x + rect.width + padding;
  const top = rect.y - padding, bottom = rect.y + rect.height + padding;
  // Carry scalars through subdivision to avoid allocating six point objects at
  // every split. Midpoint arithmetic, traversal and boundary tolerance stay exact.
  const intersects = (ax: number, ay: number, bx: number, by: number,
    cx: number, cy: number, dx: number, dy: number, depth: number): boolean => {
    const minX = Math.min(ax, bx, cx, dx), maxX = Math.max(ax, bx, cx, dx);
    const minY = Math.min(ay, by, cy, dy), maxY = Math.max(ay, by, cy, dy);
    if (maxX < left || minX > right || maxY < top || minY > bottom) return false;
    if ((ax >= left && ax <= right && ay >= top && ay <= bottom)
      || (dx >= left && dx <= right && dy >= top && dy <= bottom)) return true;
    // Keep unresolved boundary contact conservatively at the precision/depth limit.
    if (depth === 20 || Math.max(maxX - minX, maxY - minY) < 0.01) return true;
    const abx = (ax + bx) / 2, aby = (ay + by) / 2;
    const bcx = (bx + cx) / 2, bcy = (by + cy) / 2;
    const cdx = (cx + dx) / 2, cdy = (cy + dy) / 2;
    const abcx = (abx + bcx) / 2, abcy = (aby + bcy) / 2;
    const bcdx = (bcx + cdx) / 2, bcdy = (bcy + cdy) / 2;
    const splitx = (abcx + bcdx) / 2, splity = (abcy + bcdy) / 2;
    return intersects(ax, ay, abx, aby, abcx, abcy, splitx, splity, depth + 1)
      || intersects(splitx, splity, bcdx, bcdy, cdx, cdy, dx, dy, depth + 1);
  };
  return intersects(curve.source.x, curve.source.y, curve.control1.x, curve.control1.y,
    curve.control2.x, curve.control2.y, curve.target.x, curve.target.y, 0);
}
