export type ViewportRect = { left: number; top: number; right: number; bottom: number };
/** Painted tree-space positions of one frame's visible syntax, keyed by display ID. */
export type SyntaxAnchors = ReadonlyMap<string, { x: number; y: number }>;
type CameraPose = { x: number; y: number; k: number };

/** Playback does not zoom in merely because a later stage has more room.
 * Preserve the accepted pose until clearance needs a pan or smaller scale. */
export function advanceFittedCamera(
  previous: CameraPose,
  fitted: CameraPose,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  view: ViewportRect
) {
  return previous.k <= fitted.k + 1e-7 ? containCamera(previous, bounds, view) : fitted;
}

/** Median on-screen travel of the syntax two frames share, from where the accepted
 * camera showed it to where a candidate camera shows it; null when nothing is shared. */
export function sharedSyntaxTravel(accepted: CameraPose, before: SyntaxAnchors, candidate: CameraPose, after: SyntaxAnchors) {
  const travel: number[] = [];
  after.forEach((point, id) => {
    const prior = before.get(id);
    if (prior) travel.push(Math.hypot(candidate.x + point.x * candidate.k - (accepted.x + prior.x * accepted.k),
      candidate.y + point.y * candidate.k - (accepted.y + prior.y * accepted.k)));
  });
  if (!travel.length) return null;
  travel.sort((a, b) => a - b);
  return (travel[(travel.length - 1) >> 1] + travel[travel.length >> 1]) / 2;
}

/** Each stage lays out its syntax in its own coordinates, so a retained pose keeps
 * existing syntax still only where those coordinates agree. On stage entry, keep
 * the accepted view only when it moves the shared syntax no further than the
 * stage's own fit does; otherwise settle on that fit, as direct selection does. */
export function enterStageCamera(
  previous: CameraPose,
  fitted: CameraPose,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  view: ViewportRect,
  before: SyntaxAnchors,
  after: SyntaxAnchors
) {
  const advanced = advanceFittedCamera(previous, fitted, bounds, view);
  if (advanced === fitted) return fitted;
  const retainedTravel = sharedSyntaxTravel(previous, before, advanced, after);
  const fittedTravel = sharedSyntaxTravel(previous, before, fitted, after);
  return retainedTravel !== null && fittedTravel !== null && retainedTravel <= fittedTravel + 1e-7 ? advanced : fitted;
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
