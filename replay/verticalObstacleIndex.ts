type VerticalRect = { y: number; height: number };

/** Skip only vertically disjoint ranges. Leaves retain input order so callers'
 * first collision and floating-point overlap sums stay exactly the same. */
export function verticalObstacleIndex<T extends VerticalRect>(obstacles: readonly T[]) {
  type Branch = { top: number; bottom: number; start: number; end: number; left?: Branch; right?: Branch };
  const build = (start: number, end: number): Branch => {
    let top = Infinity, bottom = -Infinity;
    for (let index = start; index < end; index++) {
      top = Math.min(top, obstacles[index].y);
      bottom = Math.max(bottom, obstacles[index].y + obstacles[index].height);
    }
    const branch: Branch = { top, bottom, start, end };
    if (end - start > 8) {
      const middle = (start + end) >>> 1;
      branch.left = build(start, middle); branch.right = build(middle, end);
    }
    return branch;
  };
  const root = build(0, obstacles.length);
  return (box: VerticalRect, visit: (obstacle: T) => boolean): boolean => {
    const bottom = box.y + box.height;
    const scan = (branch: Branch): boolean => {
      if (bottom <= branch.top || box.y >= branch.bottom) return false;
      if (branch.left) return scan(branch.left) || scan(branch.right!);
      for (let index = branch.start; index < branch.end; index++) {
        const other = obstacles[index];
        if (!(bottom <= other.y || box.y >= other.y + other.height) && visit(other)) return true;
      }
      return false;
    };
    return scan(root);
  };
}
