import type { PlaqueRect } from './relations/plaquePlacement.ts';
import type { Cubic } from './relations/curveClearance.ts';

/** Sampled branch rectangles share immutable curve geometry. Preserve that
 * sharing through one rigid translation, with fresh rectangles and curve points.
 * No geometry is retained across calls or across different offsets. */
export function translateWorkspaceObstacles(rectangles: readonly PlaqueRect[], dx: number, dy: number): PlaqueRect[] {
  return translateObstacles(rectangles, dx, dy);
}

/** Only the lifetime builder supplies these ranges, immediately after creating
 * native sampled branches. Their six-field shape is known without inspecting
 * every rectangle again at each ancestor. Other obstacles keep all metadata. */
export function translateWorkspaceContourObstacles(rectangles: readonly PlaqueRect[], dx: number, dy: number,
  sampledBranches: readonly (readonly [number, number])[]): PlaqueRect[] {
  return translateObstacles(rectangles, dx, dy, sampledBranches);
}

function translateObstacles(rectangles: readonly PlaqueRect[], dx: number, dy: number,
  sampledBranches: readonly (readonly [number, number])[] = []): PlaqueRect[] {
  const curves = new Map<Cubic, Cubic>();
  let previousCurve: Cubic | undefined, previousShifted: Cubic | undefined;
  let range = 0;
  return rectangles.map((rect, index) => {
    while (range < sampledBranches.length && index >= sampledBranches[range][1]) range++;
    const sampled = range < sampledBranches.length && index >= sampledBranches[range][0];
    const result = sampled
      ? { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height, curve: rect.curve, curvePadding: rect.curvePadding }
      : { ...rect, x: rect.x + dx, y: rect.y + dy };
    if (rect.curve) {
      let curve = rect.curve === previousCurve ? previousShifted : curves.get(rect.curve);
      if (!curve) {
        curve = {
          source: { x: rect.curve.source.x + dx, y: rect.curve.source.y + dy },
          control1: { x: rect.curve.control1.x + dx, y: rect.curve.control1.y + dy },
          control2: { x: rect.curve.control2.x + dx, y: rect.curve.control2.y + dy },
          target: { x: rect.curve.target.x + dx, y: rect.curve.target.y + dy }
        };
        curves.set(rect.curve, curve);
      }
      previousCurve = rect.curve; previousShifted = curve;
      result.curve = curve;
    }
    return result;
  });
}
