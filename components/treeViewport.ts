export type ViewportRect = { left: number; top: number; right: number; bottom: number };

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
