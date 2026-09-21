export type ObstacleRect = { x: number; y: number; width: number; height: number; extendsDownward?: boolean };

export const plaquesOverlap = (a: ObstacleRect, b: ObstacleRect, gap = 24): boolean =>
  a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
  && (b.extendsDownward || a.y < b.y + b.height + gap)
  && (a.extendsDownward || a.y + a.height + gap > b.y);

/** Immutable broad-phase lookup. Exact edge and gap rules still come from plaquesOverlap. */
export function preparePlaqueObstacleIndex<T extends ObstacleRect>(obstacles: readonly T[]) {
  type Branch = { bounds: ObstacleRect; boxes?: readonly T[]; left?: Branch; right?: Branch };
  const build = (boxes: T[]): Branch | null => {
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
    boxes.sort((a, b) => (a[axis] + a[extent] / 2) - (b[axis] + b[extent] / 2));
    const mid = Math.floor(boxes.length / 2);
    return { bounds, left: build(boxes.slice(0, mid))!, right: build(boxes.slice(mid))! };
  };
  const root = build([...obstacles]);
  const overlaps = (box: ObstacleRect, gap = 24, branch = root): boolean => {
    if (!branch || !plaquesOverlap(box, branch.bounds, gap)) return false;
    return branch.boxes ? branch.boxes.some(obstacle => plaquesOverlap(box, obstacle, gap))
      : overlaps(box, gap, branch.left) || overlaps(box, gap, branch.right);
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
  return { overlaps, inColumn };
}
