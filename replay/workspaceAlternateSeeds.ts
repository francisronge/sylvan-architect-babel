import type { LifetimeContour, Point } from './workspaceLifetimeContours.ts';

type Preferences = ReadonlyMap<number, ReadonlyMap<string, Point>>;
export const WORKSPACE_ALTERNATE_SEED_LIMIT = 2;

/** Offer two whole-plan gap preferences using already measured intrinsic
 * contours. These are inputs to composition, never interpolated render maps:
 * every retained child is recomposed rigidly and every current Y stays native. */
export function workspaceAlternateSeeds(native: Preferences, contours: Iterable<LifetimeContour>): Preferences[] {
  const forks: Array<{ part: LifetimeContour; points: ReadonlyMap<string, Point>; origin: Point; intrinsicOrigin: Point }> = [];
  const seen = new Set<number>();
  for (const part of contours) {
    if (seen.has(part.incarnation) || part.children.length < 2) continue;
    seen.add(part.incarnation);
    const points = native.get(part.incarnation), origin = points?.get(part.id), intrinsicOrigin = part.members.get(part.id);
    if (!points || !origin || !intrinsicOrigin || ![origin.x, origin.y, intrinsicOrigin.x].every(Number.isFinite)) return [];
    let previousNative = -Infinity, previousIntrinsic = -Infinity;
    for (const child of part.children) {
      const before = points.get(child.id), compact = part.members.get(child.id);
      if (!before || !compact || ![before.x, before.y, compact.x].every(Number.isFinite)
        || before.x <= previousNative || compact.x <= previousIntrinsic) return [];
      previousNative = before.x; previousIntrinsic = compact.x;
    }
    forks.push({ part, points, origin, intrinsicOrigin });
  }
  const seeds: Preferences[] = [];
  for (const fraction of [.5, 1]) {
    const seed = new Map(native);
    let changed = false;
    for (const { part, points, origin, intrinsicOrigin } of forks) {
      const next = new Map(points);
      let changedFork = false;
      for (const child of part.children) {
        const before = points.get(child.id)!, compact = part.members.get(child.id)!;
        const target = origin.x + compact.x - intrinsicOrigin.x;
        const x = fraction === 1 ? target : before.x + fraction * (target - before.x);
        if (!Number.isFinite(x)) return [];
        if (!Object.is(x, before.x)) {
          next.set(child.id, { x, y: before.y }); changedFork = true;
        }
      }
      if (changedFork) { seed.set(part.incarnation, next); changed = true; }
    }
    if (changed) seeds.push(seed);
  }
  return seeds;
}
