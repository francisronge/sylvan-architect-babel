import { cubicIntersectsRect } from './curveClearance.ts';
import type { Rect } from './overlayGeometry.ts';
import type { ObstacleRect } from './plaqueObstacleIndex.ts';

/** Smallest rectangle covering every input. Callers handle an empty list. */
export const boundingRect = (rects: readonly Rect[]): Rect => {
  const x = Math.min(...rects.map(rect => rect.x));
  const y = Math.min(...rects.map(rect => rect.y));
  return { x, y, width: Math.max(...rects.map(rect => rect.x + rect.width)) - x,
    height: Math.max(...rects.map(rect => rect.y + rect.height)) - y };
};

/** Whether the rectangles come closer than `gap`; exactly `gap` apart is clear. */
export const rectsIntersect = (left: Rect, right: Rect, gap = 0): boolean => !(
  left.x + left.width + gap <= right.x
  || right.x + right.width + gap <= left.x
  || left.y + left.height + gap <= right.y
  || right.y + right.height + gap <= left.y
);

/** Whether two ink boxes overlap by more than `epsilon` on both axes and each
 * carried curve meets the other box. */
export const inkBoxesCollide = (a: ObstacleRect, b: ObstacleRect, epsilon: number): boolean =>
  Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > epsilon
  && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > epsilon
  && (!a.curve || cubicIntersectsRect(a.curve, b, a.curvePadding))
  && (!b.curve || cubicIntersectsRect(b.curve, a, b.curvePadding));
