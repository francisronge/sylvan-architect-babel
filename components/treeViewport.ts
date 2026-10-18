export type ViewportRect = { left: number; top: number; right: number; bottom: number };
export type ViewportSize = { width: number; height: number };

/** Quiet period after the last canvas resize before the painted tree refits. */
export const VIEWPORT_SETTLE_MS = 120;

/**
 * Coalesces canvas resizes. Until a frame is painted, every size applies at
 * once, so opening keeps its first-paint path. After that, a burst of resizes
 * applies only its last size, once, after `delay` without another change; the
 * painted tree stays in place meanwhile. A settled burst always applies, even
 * if it returned to the committed size, so the caller can refit and clear its
 * pending state.
 */
export function createViewportSettler({ apply, painted, schedule, cancel, delay = VIEWPORT_SETTLE_MS }: {
  apply: (size: ViewportSize) => void;
  painted: () => boolean;
  schedule: (callback: () => void, delay: number) => number;
  cancel: (id: number) => void;
  delay?: number;
}) {
  let committed: ViewportSize | null = null;
  let latest: ViewportSize | null = null;
  let timer: number | null = null;
  const commit = (size: ViewportSize) => { committed = size; apply(size); };
  const stop = () => { if (timer !== null) cancel(timer); timer = null; };
  return {
    get pending() { return timer !== null; },
    get committed() { return committed; },
    observe(size: ViewportSize) {
      latest = size;
      const unchanged = committed?.width === size.width && committed.height === size.height;
      if (!painted()) {
        stop();
        if (!unchanged) commit(size);
        return;
      }
      if (unchanged && timer === null) return;
      stop();
      timer = schedule(() => { timer = null; commit(latest!); }, delay);
    },
    dispose: stop
  };
}

/** Playback does not zoom in merely because a later stage has more room.
 * Preserve the accepted pose until clearance needs a pan or smaller scale. */
export function advanceFittedCamera(
  previous: { x: number; y: number; k: number },
  fitted: { x: number; y: number; k: number },
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  view: ViewportRect
) {
  return previous.k <= fitted.k + 1e-7 ? containCamera(previous, bounds, view) : fitted;
}

/** Retain an accepted fit; correct overflow with the least translation and scale reduction. */
export function containCamera(
  preferred: { x: number; y: number; k: number },
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  view: ViewportRect
) {
  const epsilon = 1e-7;
  if (preferred.x + bounds.minX * preferred.k >= view.left - epsilon
    && preferred.x + bounds.maxX * preferred.k <= view.right + epsilon
    && preferred.y + bounds.minY * preferred.k >= view.top - epsilon
    && preferred.y + bounds.maxY * preferred.k <= view.bottom + epsilon) return preferred;
  const k = Math.min(preferred.k,
    Math.max(1, view.right - view.left) / Math.max(1, bounds.maxX - bounds.minX),
    Math.max(1, view.bottom - view.top) / Math.max(1, bounds.maxY - bounds.minY));
  // Keep the current viewport centre when scale has to change, then clamp only overflowing axes.
  const centerX = (view.left + view.right) / 2;
  const centerY = (view.top + view.bottom) / 2;
  const x = centerX + (preferred.x - centerX) * k / preferred.k;
  const y = centerY + (preferred.y - centerY) * k / preferred.k;
  return {
    x: Math.max(view.left - bounds.minX * k, Math.min(view.right - bounds.maxX * k, x)),
    y: Math.max(view.top - bounds.minY * k, Math.min(view.bottom - bounds.maxY * k, y)),
    k
  };
}

/** Canvas-local space left by the measured header, Replay panel and app controls. */
export function availableTreeViewport(
  width: number,
  height: number,
  obstacles: { headerBottom?: number; panelTop?: number; right?: number; bottom?: number } = {}
): ViewportRect {
  const inset = 16;
  return {
    left: inset,
    top: Math.min(height - inset, Math.max(inset, (obstacles.headerBottom ?? 0) + inset)),
    right: Math.max(inset, width - Math.max(inset, obstacles.right ?? 0)),
    bottom: Math.max(inset, Math.min(height - Math.max(inset, obstacles.bottom ?? 0), (obstacles.panelTop ?? height) - inset))
  };
}

/** Keep the existing two-column plate beside the tree, or fit both vertically on narrow canvases. */
export function linearizationViewport(view: ViewportRect, plateHeight: number) {
  const width = Math.max(1, view.right - view.left);
  const height = Math.max(1, view.bottom - view.top);
  const stacked = width < 350 + 260 + 24;
  const scale = Math.min(1, width / 350, stacked ? height / (plateHeight * 2) : height / plateHeight);
  return {
    scale,
    left: stacked ? view.left + (width - 350 * scale) / 2 : view.right - 350 * scale,
    top: view.top,
    treeTop: stacked ? view.top + plateHeight * scale + 24 : view.top,
    treeRight: stacked ? view.right : view.right - 350 * scale - 24
  };
}
