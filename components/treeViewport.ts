export type ViewportRect = { left: number; top: number; right: number; bottom: number };

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
