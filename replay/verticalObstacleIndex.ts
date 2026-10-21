type VerticalRect = { y: number; height: number };
type Rect = VerticalRect & { x: number; width: number };
type Query<T, Box> = (box: Box, visit: (obstacle: T) => boolean) => boolean;
/** Whether obstacles spanning `left` (their least `x`) to `right` (their greatest
 * `x + width`) can contain one the visit accepts. */
type Admits = (left: number, right: number) => boolean;
type Branch = { top: number; bottom: number; left: number; right: number; start: number; end: number; lower?: Branch; upper?: Branch };

function index<T extends VerticalRect>(obstacles: readonly T[], horizontal: boolean) {
  const rects = obstacles as unknown as readonly Rect[];
  // A branch's bounds combine its halves; minima and maxima are exact in any order.
  const build = (start: number, end: number): Branch => {
    if (end - start > 8) {
      const middle = (start + end) >>> 1, lower = build(start, middle), upper = build(middle, end);
      return { top: Math.min(lower.top, upper.top), bottom: Math.max(lower.bottom, upper.bottom),
        left: Math.min(lower.left, upper.left), right: Math.max(lower.right, upper.right), start, end, lower, upper };
    }
    let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
    for (let index = start; index < end; index++) {
      top = Math.min(top, obstacles[index].y);
      bottom = Math.max(bottom, obstacles[index].y + obstacles[index].height);
      if (horizontal) {
        left = Math.min(left, rects[index].x);
        right = Math.max(right, rects[index].x + rects[index].width);
      }
    }
    return { top, bottom, left, right, start, end };
  };
  const root = build(0, obstacles.length);
  return (box: VerticalRect, visit: (obstacle: T) => boolean, admits?: Admits): boolean => {
    const bottom = box.y + box.height;
    const scan = (branch: Branch): boolean => {
      if (bottom <= branch.top || box.y >= branch.bottom || admits && !admits(branch.left, branch.right)) return false;
      if (branch.lower) return scan(branch.lower) || scan(branch.upper!);
      for (let index = branch.start; index < branch.end; index++) {
        const other = obstacles[index];
        if (bottom <= other.y || box.y >= other.y + other.height) continue;
        if (admits && !admits(rects[index].x, rects[index].x + rects[index].width)) continue;
        if (visit(other)) return true;
      }
      return false;
    };
    return scan(root);
  };
}

/** Skip only vertically disjoint ranges. Leaves retain input order so callers'
 * first collision and floating-point overlap sums stay exactly the same.
 *
 * With `overlapOnly`, every visit accepts only a positive horizontal overlap,
 * `min(a.x + a.width, b.x + b.width) - max(a.x, b.x) > epsilon` with
 * `epsilon >= 0`, so obstacles wholly at or beyond either side of the box are
 * skipped too. Both sides are the same sums the visits compute, so the result is
 * unchanged. A scan that also reads horizontally separate obstacles, such as a
 * clearance or forbidden-shift scan, keeps the vertical-only index. NaN bounds
 * never prune. */
export function verticalObstacleIndex<T extends VerticalRect>(obstacles: readonly T[]): Query<T, VerticalRect>;
export function verticalObstacleIndex<T extends Rect>(obstacles: readonly T[], options: { overlapOnly: true }): Query<T, Rect>;
export function verticalObstacleIndex<T extends VerticalRect>(obstacles: readonly T[], { overlapOnly = false }: { overlapOnly?: boolean } = {}): Query<T, VerticalRect> {
  const query = index(obstacles, overlapOnly);
  if (!overlapOnly) return (box, visit) => query(box, visit);
  return (box, visit) => {
    const { x, width } = box as Rect, right = x + width;
    return query(box, visit, (left, extent) => !(right <= left || x >= extent));
  };
}

/** The vertical index with each range's horizontal extent. A query's `admits`
 * skips ranges and obstacles the visit cannot accept; it must be exact for the
 * visit's own arithmetic, for example a bound that rounding cannot cross. */
export function boundedObstacleIndex<T extends Rect>(obstacles: readonly T[]): (box: Rect, visit: (obstacle: T) => boolean, admits: Admits) => boolean {
  return index(obstacles, true);
}

export type ObstacleExtent = { left: number; right: number; top: number; bottom: number };
const extents = new WeakMap<readonly Rect[], ObstacleExtent>();
/** The least `x`/`y` and greatest `x + width`/`y + height` of an immutable box
 * list, computed with the same sums pair checks use. Any NaN makes the extent
 * NaN. Rounding is monotone, so no pair of boxes from two lists overlaps more
 * than `extentOverlap` of their extents; a caller may skip the pairs only with
 * a comparison that NaN fails. */
export function obstacleExtent(boxes: readonly Rect[]): ObstacleExtent {
  let extent = extents.get(boxes);
  if (!extent) {
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const box of boxes) {
      left = Math.min(left, box.x); right = Math.max(right, box.x + box.width);
      top = Math.min(top, box.y); bottom = Math.max(bottom, box.y + box.height);
    }
    extents.set(boxes, extent = { left, right, top, bottom });
  }
  return extent;
}
/** `min(right) - max(left)` and the same vertically, as pair checks compute them. */
export const extentOverlap = (a: ObstacleExtent, b: ObstacleExtent) => ({
  x: Math.min(a.right, b.right) - Math.max(a.left, b.left),
  y: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
});
