import { cubicIntersectsRect, type Cubic } from './curveClearance.ts';

export type ObstacleRect = { x: number; y: number; width: number; height: number; extendsDownward?: boolean;
  curve?: Cubic; curvePadding?: number };

export const plaquesOverlap = (a: ObstacleRect, b: ObstacleRect, gap = 24): boolean =>
  a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
  && (b.extendsDownward || a.y < b.y + b.height + gap)
  && (a.extendsDownward || a.y + a.height + gap > b.y)
  && (!b.curve || cubicIntersectsRect(b.curve, a, b.curvePadding ?? 0))
  && (!a.curve || cubicIntersectsRect(a.curve, b, a.curvePadding ?? 0));

/** Immutable lifetime obstacles carry their precise curves with their bounds.
 * An unchanged translation retains the shared geometry of a stationary scene. */
export function translateObstacle<T extends ObstacleRect>(box: T, dx: number, dy: number): T {
  const point = (p: { x: number; y: number }) => {
    const x = p.x + dx, y = p.y + dy;
    return Object.is(x, p.x) && Object.is(y, p.y) ? p : { x, y };
  };
  const x = box.x + dx, y = box.y + dy;
  let curve = box.curve;
  if (curve) {
    const source = point(curve.source), control1 = point(curve.control1);
    const control2 = point(curve.control2), target = point(curve.target);
    if (source !== curve.source || control1 !== curve.control1 || control2 !== curve.control2 || target !== curve.target)
      curve = { source, control1, control2, target };
  }
  return Object.is(x, box.x) && Object.is(y, box.y) && curve === box.curve ? box
    : { ...box, x, y, ...(curve ? { curve } : {}) };
}

/** A schedule revisits immutable scene arrays at the same anchor offsets.
 * Keep the translations local to that schedule, including signed-zero offsets. */
export function prepareImmutableObstacleTranslations() {
  const translated = new WeakMap<readonly ObstacleRect[], Array<{ dx: number; dy: number; boxes: ObstacleRect[] }>>();
  return <T extends ObstacleRect>(obstacles: readonly T[], dx: number, dy: number): T[] => {
    let offsets = translated.get(obstacles);
    const prior = offsets?.find(entry => Object.is(entry.dx, dx) && Object.is(entry.dy, dy));
    if (prior) return prior.boxes as T[];
    const boxes = obstacles.map(box => translateObstacle(box, dx, dy));
    if (!offsets) translated.set(obstacles, offsets = []);
    offsets.push({ dx, dy, boxes });
    return boxes;
  };
}

/** Boolean placement queries need spatial rejection, not sorted witness order.
 * Partition one private array in place; every leaf keeps the exact predicate. */
export function preparePlaqueOverlapIndex(obstacles: readonly ObstacleRect[]) {
  const linear = (box: ObstacleRect, gap: number) => obstacles.some(other => plaquesOverlap(box, other, gap));
  const boxes = obstacles.map(obstacle => ({ obstacle,
    right: obstacle.x + obstacle.width, bottom: obstacle.y + obstacle.height }));
  if (boxes.some(({ obstacle, right, bottom }) =>
    !Number.isFinite(obstacle.x) || !Number.isFinite(obstacle.y)
    || !Number.isFinite(right) || !Number.isFinite(bottom) || obstacle.width < 0 || obstacle.height < 0))
    return { overlaps: (box: ObstacleRect, gap = 24) => linear(box, gap) };
  type Branch = { x: number; y: number; right: number; bottom: number; extendsDownward: boolean;
    start: number; end: number; leaf: boolean; skip: number };
  const branches: Branch[] = [];
  const build = (start: number, end: number) => {
    let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity, extendsDownward = false;
    for (let i = start; i < end; i++) {
      const box = boxes[i];
      x = Math.min(x, box.obstacle.x); y = Math.min(y, box.obstacle.y);
      right = Math.max(right, box.right); bottom = Math.max(bottom, box.bottom);
      extendsDownward ||= Boolean(box.obstacle.extendsDownward);
    }
    const branch: Branch = { x, y, right, bottom, extendsDownward, start, end, leaf: end - start <= 8, skip: 0 };
    branches.push(branch);
    if (!branch.leaf) {
      const horizontal = right - x >= bottom - y;
      // Half-sums avoid overflowing otherwise finite extreme coordinates.
      const middle = horizontal ? x / 2 + right / 2 : y / 2 + bottom / 2;
      let left = start, last = end - 1;
      while (left <= last) {
        const box = boxes[left];
        const center = horizontal ? box.obstacle.x / 2 + box.right / 2 : box.obstacle.y / 2 + box.bottom / 2;
        if (center < middle) left++;
        else { const other = boxes[last]; boxes[last--] = box; boxes[left] = other; }
      }
      // Coincident centers still form a bounded tree without a sorting phase.
      const split = left === start || left === end ? (start + end) >>> 1 : left;
      build(start, split); build(split, end);
    }
    branch.skip = branches.length;
  };
  if (boxes.length) build(0, boxes.length);
  return { overlaps: (box: ObstacleRect, gap = 24): boolean => {
    if (box.curve || !Number.isFinite(box.x) || !Number.isFinite(box.y)
      || !Number.isFinite(box.width) || !Number.isFinite(box.height) || box.width < 0 || box.height < 0
      || !Number.isFinite(gap) || gap < 0) return linear(box, gap);
    const right = box.x + box.width + gap, bottom = box.y + box.height + gap;
    for (let index = 0; index < branches.length;) {
      const branch = branches[index];
      if (!(box.x < branch.right + gap && right > branch.x
        && (branch.extendsDownward || box.y < branch.bottom + gap)
        && (box.extendsDownward || bottom > branch.y))) { index = branch.skip; continue; }
      if (branch.leaf) for (let i = branch.start; i < branch.end; i++) {
        const { obstacle, right: edge, bottom: floor } = boxes[i];
        if (box.x < edge + gap && right > obstacle.x
          && (obstacle.extendsDownward || box.y < floor + gap)
          && (box.extendsDownward || bottom > obstacle.y)
          && (!obstacle.curve || cubicIntersectsRect(obstacle.curve, box, obstacle.curvePadding ?? 0))) return true;
      }
      index++;
    }
    return false;
  } };
}

/** Immutable broad-phase lookup. Exact edge and gap rules still come from plaquesOverlap. */
export function preparePlaqueObstacleIndex<T extends ObstacleRect>(obstacles: readonly T[]) {
  type Branch = { bounds: ObstacleRect; boxes?: readonly T[]; left?: Branch; right?: Branch };
  const build = (boxes: T[], sortedAxis?: 'x' | 'y'): Branch | null => {
    if (!boxes.length) return null;
    let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity, extendsDownward = false;
    for (const box of boxes) {
      x = Math.min(x, box.x); y = Math.min(y, box.y);
      right = Math.max(right, box.x + box.width); bottom = Math.max(bottom, box.y + box.height);
      extendsDownward ||= Boolean(box.extendsDownward);
    }
    // Union subtraction/addition can round an outer edge inward. Only the broad
    // bounds get this margin; leaf rectangles retain the exact collision rule.
    const marginX = Math.max(1, Math.abs(x), Math.abs(right)) * Number.EPSILON * 4;
    const marginY = Math.max(1, Math.abs(y), Math.abs(bottom)) * Number.EPSILON * 4;
    const bounds = { x, y, width: right - x + marginX, height: bottom - y + marginY, extendsDownward };
    if (boxes.length <= 8) return { bounds, boxes };
    const axis = bounds.width >= bounds.height ? 'x' : 'y';
    const extent = axis === 'x' ? 'width' : 'height';
    if (axis !== sortedAxis) {
      boxes.sort((a, b) => (a[axis] + a[extent] / 2) - (b[axis] + b[extent] / 2));
      sortedAxis = boxes.every(box => Number.isFinite(box[axis] + box[extent] / 2)) ? axis : undefined;
    }
    const mid = Math.floor(boxes.length / 2);
    // Contiguous slices retain the parent's stable finite ordering. A changed
    // axis or exceptional center still takes the original comparator path.
    return { bounds, left: build(boxes.slice(0, mid), sortedAxis)!, right: build(boxes.slice(mid), sortedAxis)! };
  };
  const root = build([...obstacles]);
  type Entry = { branch: Branch; right: number; bottom: number; skip: number;
    leaves?: { obstacle: T; right: number; bottom: number }[] };
  const entries: Entry[] = [];
  const ranges = new WeakMap<Branch, { start: number; end: number }>();
  const flatten = (branch: Branch) => {
    const start = entries.length;
    const entry = { branch, right: branch.bounds.x + branch.bounds.width,
      bottom: branch.bounds.y + branch.bounds.height, skip: 0,
      leaves: branch.boxes?.map(obstacle => ({ obstacle,
        right: obstacle.x + obstacle.width, bottom: obstacle.y + obstacle.height })) };
    entries.push(entry);
    if (branch.left) flatten(branch.left);
    if (branch.right) flatten(branch.right);
    entry.skip = entries.length;
    ranges.set(branch, { start, end: entry.skip });
  };
  if (root) flatten(root);
  // Rectangle queries share exact broad bounds and left-first traversal.
  // Curved queries keep the branch-level cubic test in the recursive path.
  const acceptsAny = () => true;
  const scanRectangles = (box: ObstacleRect, gap: number, predicate: (obstacle: T) => boolean,
    branch: Branch | null): boolean => {
    if (!branch) return false;
    const right = box.x + box.width + gap, bottom = box.y + box.height + gap;
    const { start, end } = ranges.get(branch)!;
    for (let index = start; index < end;) {
      const entry = entries[index], bounds = entry.branch.bounds;
      if (!(box.x < entry.right + gap && right > bounds.x
        && (bounds.extendsDownward || box.y < entry.bottom + gap)
        && (box.extendsDownward || bottom > bounds.y))) {
        index = entry.skip;
        continue;
      }
      if (entry.leaves) {
        for (const leaf of entry.leaves) {
          const obstacle = leaf.obstacle;
          // These immutable edges retain plaquesOverlap's addition order. Curve
          // and predicate checks still run only after the same strict bounds.
          if (box.x < leaf.right + gap && right > obstacle.x
            && (obstacle.extendsDownward || box.y < leaf.bottom + gap)
            && (box.extendsDownward || bottom > obstacle.y)
            && (!obstacle.curve || cubicIntersectsRect(obstacle.curve, box, obstacle.curvePadding ?? 0))
            && predicate(obstacle)) return true;
        }
      }
      index++;
    }
    return false;
  };
  const overlaps = (box: ObstacleRect, gap = 24, branch = root): boolean => {
    if (!box.curve) return scanRectangles(box, gap, acceptsAny, branch);
    if (!branch || !plaquesOverlap(box, branch.bounds, gap)) return false;
    return branch.boxes ? branch.boxes.some(obstacle => plaquesOverlap(box, obstacle, gap))
      : overlaps(box, gap, branch.left) || overlaps(box, gap, branch.right);
  };
  const some = (box: ObstacleRect, predicate: (obstacle: T) => boolean, branch = root): boolean => {
    if (!box.curve) return scanRectangles(box, 0, predicate, branch);
    if (!branch || !plaquesOverlap(box, branch.bounds, 0)) return false;
    return branch.boxes ? branch.boxes.some(obstacle => plaquesOverlap(box, obstacle, 0) && predicate(obstacle))
      : some(box, predicate, branch.left) || some(box, predicate, branch.right);
  };
  const inColumn = (x: number, width: number, gap = 24): T[] => {
    const matches: T[] = [];
    const intersects = (box: ObstacleRect) => x < box.x + box.width + gap && x + width + gap > box.x;
    const visit = (branch: Branch | null | undefined) => {
      if (!branch || !intersects(branch.bounds)) return;
      if (branch.boxes) branch.boxes.forEach(box => { if (intersects(box)) matches.push(box); });
      else { visit(branch.left); visit(branch.right); }
    };
    visit(root);
    return matches;
  };
  return { overlaps, inColumn, some };
}

/** Vertical order is fixed while a plaque searches different horizontal pockets. */
export function preparePlaqueColumnIntervals(obstacles: readonly ObstacleRect[], height: number, gap = 24) {
  const ordered = obstacles.map(box => ({ x: box.x, right: box.x + box.width + gap,
    low: box.y - height - gap, high: box.extendsDownward ? Infinity : box.y + box.height + gap }))
    .sort((a, b) => a.low - b.low);
  return (x: number, width: number): number[][] => {
    const right = x + width + gap;
    const merged: number[][] = [];
    for (const interval of ordered) {
      if (!(x < interval.right && right > interval.x)) continue;
      const last = merged[merged.length - 1];
      if (last && interval.low < last[1]) last[1] = Math.max(last[1], interval.high);
      else merged.push([interval.low, interval.high]);
    }
    return merged;
  };
}

/** Intervals are sorted, disjoint and open: touching edges remain usable lanes. */
export function plaqueColumnContains(intervals: readonly (readonly number[])[], y: number): boolean {
  let low = 0, high = intervals.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (intervals[middle][0] < y) low = middle + 1;
    else high = middle;
  }
  return low > 0 && y < intervals[low - 1][1];
}
