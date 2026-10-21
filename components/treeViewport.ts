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

/** One frame's painted syntax: tree-space position and hierarchy parent, keyed by display ID. */
export type PaintedNodes = ReadonlyMap<string, { x: number; y: number; parentId: string | null }>;

/** Playback does not zoom in merely because a later stage has more room.
 * Preserve the accepted pose until clearance needs a pan or smaller scale.
 * Entering a new stage (`crossing`), an axis that clearance has to pan is
 * centred on the envelope instead of clamped to the edge it overflowed: the
 * camera moves on that axis anyway, and the stage then keeps the pose for all
 * its micro-steps. Within a stage the least pan remains. */
export function advanceFittedCamera(
  previous: { x: number; y: number; k: number },
  fitted: { x: number; y: number; k: number },
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  view: ViewportRect,
  { crossing = false }: { crossing?: boolean } = {}
) {
  if (previous.k > fitted.k + 1e-7) return fitted;
  const contained = containCamera(previous, bounds, view);
  if (!crossing || contained === previous) return contained;
  const epsilon = 1e-6, { k } = contained;
  // containCamera's position before clamping: scaled about the view centre.
  const centerX = (view.left + view.right) / 2, centerY = (view.top + view.bottom) / 2;
  const scaledX = centerX + (previous.x - centerX) * k / previous.k, scaledY = centerY + (previous.y - centerY) * k / previous.k;
  return {
    x: Math.abs(contained.x - scaledX) > epsilon ? centerX - (bounds.minX + bounds.maxX) / 2 * k : contained.x,
    y: Math.abs(contained.y - scaledY) > epsilon ? centerY - (bounds.minY + bounds.maxY) / 2 * k : contained.y,
    k
  };
}

/** Each stage lays out its syntax in its own coordinates. Translate a pose by the
 * median coordinate shift of the syntax both frames share, removing the common
 * translation between the two layouts; residual layout changes still move. A node
 * whose shared ancestors change (a reattached, moved constituent) is left out
 * unless nothing else is shared. */
export function carryCamera(pose: { x: number; y: number; k: number }, before: PaintedNodes, after: PaintedNodes) {
  const sharedAncestors = (nodes: PaintedNodes, id: string) => {
    const ids: string[] = [];
    for (let parent = nodes.get(id)!.parentId; parent; parent = nodes.get(parent)?.parentId ?? null) {
      if (before.has(parent) && after.has(parent)) ids.push(parent);
    }
    return ids;
  };
  const shared = [...after.keys()].filter(id => before.has(id));
  const unmoved = shared.filter(id => {
    const prior = sharedAncestors(before, id), current = sharedAncestors(after, id);
    return prior.length === current.length && prior.every((ancestor, index) => ancestor === current[index]);
  });
  const reference = unmoved.length ? unmoved : shared;
  if (!reference.length) return pose;
  const median = (values: number[]) => {
    values.sort((a, b) => a - b);
    return (values[(values.length - 1) >> 1] + values[values.length >> 1]) / 2;
  };
  return {
    x: pose.x + median(reference.map(id => before.get(id)!.x - after.get(id)!.x)) * pose.k,
    y: pose.y + median(reference.map(id => before.get(id)!.y - after.get(id)!.y)) * pose.k,
    k: pose.k
  };
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
