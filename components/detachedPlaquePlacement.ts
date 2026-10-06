type Rect = { x: number; y: number; width: number; height: number };
type Viewport = { left: number; top: number; right: number; bottom: number };

/** Keep a detached plaque's preferred position when clear; otherwise use the
 * nearest clear position in the available viewport. Never resize its contents. */
export function detachedPlaqueOrigin(preferred: Rect, viewport: Viewport, obstacles: readonly Rect[], gap: number) {
  const { width, height } = preferred;
  const valid = (x: number, y: number) => x >= viewport.left && y >= viewport.top
    && x + width <= viewport.right && y + height <= viewport.bottom
    && obstacles.every(rect => x + width + gap <= rect.x || x >= rect.x + rect.width + gap
      || y + height + gap <= rect.y || y >= rect.y + rect.height + gap);
  if (valid(preferred.x, preferred.y)) return { x: preferred.x, y: preferred.y };
  const xs = new Set([preferred.x, viewport.left, viewport.right - width,
    ...obstacles.flatMap(rect => [rect.x - width - gap, rect.x + rect.width + gap])]);
  const ys = new Set([preferred.y, viewport.top, viewport.bottom - height,
    ...obstacles.flatMap(rect => [rect.y - height - gap, rect.y + rect.height + gap])]);
  let best: { x: number; y: number } | null = null, distance = Infinity;
  for (const x of xs) for (const y of ys) {
    if (!valid(x, y)) continue;
    const next = (x - preferred.x) ** 2 + (y - preferred.y) ** 2;
    if (next < distance) { best = { x, y }; distance = next; }
  }
  return best;
}
