/**
 * Painted geometry shared by the D3 painter (`components/renderer/`), the
 * React-free camera and plaque allocation (`replay/`), and the offline audits.
 * The camera reserves what the painter draws only while both read the same
 * number, so change a value here rather than at a call site.
 *
 * Offsets are tree units from a node's layout point (node.x, node.y); positive
 * y is downward. This module imports nothing, so Node, workers and the browser
 * load the same values.
 */

const TREE_FONT_FAMILY = 'Quicksand, sans-serif';
const INDEX_FONT_FAMILY = "'Crimson Pro', Georgia, serif";

/** A category label: its last line's baseline, font and dark outline. */
export const CATEGORY_LABEL = { baselineY: -10, fontSize: 42, fontWeight: 900, strokeWidth: 10 } as const;
/** Baseline distance between the lines of a wrapped category label. */
export const CATEGORY_LINE_HEIGHT = 48;
export const CATEGORY_FONT = `${CATEGORY_LABEL.fontWeight} ${CATEGORY_LABEL.fontSize}px ${TREE_FONT_FAMILY}`;
/** Width per grapheme when no font measurement is available. */
export const CATEGORY_FALLBACK_GLYPH_WIDTH = 25;

/** Baseline of line `index` of a category label wrapped onto `count` lines. */
export const categoryLineBaselineY = (index: number, count: number) =>
  CATEGORY_LABEL.baselineY - (count - 1 - index) * CATEGORY_LINE_HEIGHT;

/** A terminal word or notation glyph below its leaf. */
export const TERMINAL_LABEL = { baselineY: 115, fontSize: 56, fontWeight: 900, strokeWidth: 8 } as const;
export const TERMINAL_FONT = `italic ${TERMINAL_LABEL.fontWeight} ${TERMINAL_LABEL.fontSize}px ${TREE_FONT_FAMILY}`;
/** The italic word string Constituent Glyphing paints below a triangulated phrase. */
export const TRIANGLE_WORDS = { baselineY: 155, fontSize: 52, fontWeight: 900, strokeWidth: 8 } as const;

/** Chain and theta indices painted after a label. A theta index is lowered by
 * `thetaDy`; an identity index uses the font's subscript baseline instead. */
export const INDEX_LABEL = {
  dx: 5,
  terminal: { fontSize: 30, thetaDy: 14 },
  category: { fontSize: 22, thetaDy: 9 }
} as const;
export const TERMINAL_INDEX_FONT = `italic 900 ${INDEX_LABEL.terminal.fontSize}px ${INDEX_FONT_FAMILY}`;
export const CATEGORY_INDEX_FONT = `italic 900 ${INDEX_LABEL.category.fontSize}px ${INDEX_FONT_FAMILY}`;

/** The dashed stem from a leaf's point to its word. */
export const TERMINAL_STEM = { topY: 20, bottomY: 65, strokeWidth: 3 } as const;

/** The painted stem, including its stroke, as an obstacle rectangle. */
export function terminalStemInk(node: { x: number; y: number }) {
  return {
    x: node.x - TERMINAL_STEM.strokeWidth / 2,
    y: node.y + (TERMINAL_STEM.topY - TERMINAL_STEM.strokeWidth / 2),
    width: TERMINAL_STEM.strokeWidth,
    height: TERMINAL_STEM.bottomY - TERMINAL_STEM.topY + TERMINAL_STEM.strokeWidth
  };
}

/** Nominal depth of a leaf's word below its point, for fits that read no glyphs. */
export const LEAF_INK_EXTENT_Y = 130;
/** Nominal point below a leaf's word where relations attach to the word. */
export const TERMINAL_ATTACHMENT_Y = 140;
/** Trajectories attach this far outside a shell's label: below its bottom, above its top. */
export const SHELL_ATTACHMENT_CLEARANCE = { bottom: 6, top: 8 } as const;

/** Unmeasured label box width: at least the minimum, else 40 units per UTF-16 unit. */
export const nominalLabelWidth = (text: string) => Math.max(150, text.length * 40);

/** Nominal relation label and lane sizes. The camera and the painter bind each
 * frame with the same values, so their marks have the same extents. */
export const RELATION_BINDING_METRICS = { labelWidth: 150, labelHeight: 70, badgeGap: 46, laneGap: 60 } as const;

/** A numbered anchor-set badge: a circle drawn in marker units, scaled by the
 * marker scale. Its outer radius includes half the stroke. */
export const ANCHOR_SET_BADGE = { radius: 9, compactRadius: 7, strokeWidth: 1.2 } as const;
export const anchorSetBadgeRadius = (badgeSize?: 'standard' | 'compact') =>
  badgeSize === 'compact' ? ANCHOR_SET_BADGE.compactRadius : ANCHOR_SET_BADGE.radius;
export const anchorSetBadgeOuterRadius = (badgeSize?: 'standard' | 'compact') =>
  anchorSetBadgeRadius(badgeSize) + ANCHOR_SET_BADGE.strokeWidth / 2;
/** Marker units a badge keeps from the labels and plaques it clears. */
export const ANCHOR_SET_BADGE_CLEARANCE = 1;
/** A painted tree label's glyph cell grown by the dark outline painted under it. */
export const outlinedTreeLabelCell = (cell: { x: number; y: number; width: number; height: number }, kind: 'category' | 'terminal') => {
  const outline = (kind === 'category' ? CATEGORY_LABEL : TERMINAL_LABEL).strokeWidth / 2;
  return { x: cell.x - outline, y: cell.y - outline, width: cell.width + 2 * outline, height: cell.height + 2 * outline };
};

/** Lanes below the frame's deepest node, as offsets from that node's y. */
export const RELATION_LANES_BELOW_DEEPEST_NODE = { trajectoryFloor: 180, connectorBaseline: 130, railBase: 240 } as const;

/**
 * Trajectory route laws. The binder (`replay/relations/pathGeometry.ts`) and the
 * painter's measured refinements (`components/renderer/trajectoryRefinements.ts`)
 * apply the same laws to different endpoints.
 *
 * The sideward ceiling has two bases that do not agree:
 * - the painter and offline audit measure the top of the painted tree text and
 *   rise `ceilingAboveTextTop` from it (`textTopFallbackY` when nothing is measured);
 * - the camera and plaque allocation read no glyphs and rise `ceilingAboveTopNode`
 *   from the topmost node point.
 * A one-line top label puts the painted text top about 56 units above its node,
 * so the camera's ceiling is about 14 units higher; each extra line raises the
 * painted ceiling by one category line height, and the camera's then lies lower.
 */
export const TRAJECTORY_ROUTES = {
  ceilingAboveTextTop: 90,
  textTopFallbackY: -90,
  ceilingAboveTopNode: 160,
  crestAboveEndpoint: 70,
  orthogonalLaneSpacing: 90,
  rollUpLaneOffset: 46,
  rollUpLaneStep: 12,
  quadraticEndpointInset: 8,
  quadraticMinimumBelly: 42,
  quadraticBellyPerSpan: 0.2,
  verticalColumnTolerance: 4,
  steepBowFullSlope: 0.3,
  steepBowEndSlope: 0.4,
  verticalBowPerRise: 0.25
} as const;

type RoutePoint = { x: number; y: number };

/** Control-point depth of a quadratic trajectory: it deepens with horizontal span. */
export const quadraticTrajectoryBellyY = (start: RoutePoint, end: RoutePoint) =>
  Math.max(start.y, end.y) + Math.max(TRAJECTORY_ROUTES.quadraticMinimumBelly,
    Math.abs(end.x - start.x) * TRAJECTORY_ROUTES.quadraticBellyPerSpan);

/**
 * A steep quadratic trajectory reads as a straight line with a hook below its
 * departure: its belly hangs only `quadraticMinimumBelly` below the lower end
 * of a long rise. It bows sideways instead, to `side` (`-1` left, `1` right).
 *
 * `weight` is 1 while the ends' horizontal offset is at most `steepBowFullSlope`
 * of the rise and falls smoothly to 0 at `steepBowEndSlope`; from there on the
 * belly law applies unchanged. In the fixtures and saved batches, slopes
 * run continuously up to 0.40 and then cluster at 0.415–0.43, where the
 * reviewed head hops of the human catalogue lie (187.5 across, 440 up), so
 * every arrow from 0.40 on keeps its exact path. A route that hardly rises
 * (`verticalColumnTolerance`) never bows.
 */
export type TrajectoryBowSide = -1 | 1;
export type TrajectoryBow = { side: TrajectoryBowSide; weight: number };

/** How fully a route between these centres bows: 0 keeps the belly law. */
export const steepTrajectoryBowWeight = (sourceCentre: RoutePoint, targetCentre: RoutePoint) => {
  const rise = Math.abs(targetCentre.y - sourceCentre.y);
  if (rise <= TRAJECTORY_ROUTES.verticalColumnTolerance) return 0;
  const slope = Math.abs(targetCentre.x - sourceCentre.x) / rise;
  const { steepBowFullSlope: full, steepBowEndSlope: end } = TRAJECTORY_ROUTES;
  if (slope >= end) return 0;
  if (slope <= full) return 1;
  const t = (end - slope) / (end - full);
  return t * t * (3 - 2 * t);
};

/** The side a steep route bows to when its departure's branch does not decide:
 * left, reflected to right in right-to-left Replay. */
export const defaultTrajectoryBowSide = (direction: 'ltr' | 'rtl' = 'ltr'): TrajectoryBowSide =>
  direction === 'rtl' ? 1 : -1;

/** A route prefers to bow away from the branch its departure hangs from, so
 * it does not cross it; under a parent in the same column, or no parent, it
 * takes `defaultTrajectoryBowSide`. `clearTrajectoryBowSide` may take the other side. */
export const trajectoryBowSide = (departure: RoutePoint, departureParent: RoutePoint | null,
  direction: 'ltr' | 'rtl' = 'ltr'): TrajectoryBowSide =>
  departureParent && Math.abs(departure.x - departureParent.x) > TRAJECTORY_ROUTES.verticalColumnTolerance
    ? (departure.x > departureParent.x ? 1 : -1)
    : defaultTrajectoryBowSide(direction);

const mix = (from: number, to: number, weight: number) => weight === 1 ? to : from + (to - from) * weight;

/**
 * Signed horizontal endpoint insets of a quadratic trajectory. The belly law
 * insets both ends toward each other; a full bow shifts both toward its side,
 * so the arc leaves beside the departure and arrives from the side it comes from.
 */
export const quadraticTrajectoryInsets = (sourceCentre: RoutePoint, targetCentre: RoutePoint,
  bow: TrajectoryBow | null) => {
  const inset = TRAJECTORY_ROUTES.quadraticEndpointInset;
  const direction = Math.sign(targetCentre.x - sourceCentre.x) || 1;
  if (!bow) return { start: inset * direction, end: -inset * direction };
  return { start: mix(inset * direction, inset * bow.side, bow.weight),
    end: mix(-inset * direction, inset * bow.side, bow.weight) };
};

/**
 * Control point of a quadratic trajectory between its inset ends. The belly
 * law hangs it below the lower end (plus `bellyOffset`); a full bow sets it
 * beside the vertical midpoint, `verticalBowPerRise` of the rise away, so the
 * arc stays between its ends' heights.
 */
export const quadraticTrajectoryControl = (start: RoutePoint, end: RoutePoint,
  bow: TrajectoryBow | null, bellyOffset = 0): RoutePoint => {
  const belly = { x: (start.x + end.x) / 2, y: quadraticTrajectoryBellyY(start, end) + bellyOffset };
  if (!bow) return belly;
  const bowed = { x: (start.x + end.x) / 2 + bow.side * Math.abs(end.y - start.y) * TRAJECTORY_ROUTES.verticalBowPerRise,
    y: (start.y + end.y) / 2 };
  return { x: mix(belly.x, bowed.x, bow.weight), y: mix(belly.y, bowed.y, bow.weight) };
};

/** The quadratic route between two attachment points, as the binder draws it. */
export const quadraticTrajectoryRoute = (from: RoutePoint, to: RoutePoint, bow: TrajectoryBow | null, fanOffset = 0) => {
  const insets = quadraticTrajectoryInsets(from, to, bow);
  const start = { x: from.x + insets.start, y: from.y + fanOffset };
  const end = { x: to.x + insets.end, y: to.y + fanOffset };
  return { start, end, control: quadraticTrajectoryControl(start, end, bow, fanOffset) };
};

type RouteRect = { x: number; y: number; width: number; height: number };

/** A label an endpoint attaches to: the endpoint hangs just below it. */
const attachesTo = (rect: RouteRect, point: RoutePoint) => point.x >= rect.x && point.x <= rect.x + rect.width
  && point.y >= rect.y && point.y <= rect.y + rect.height + 24;

const routeCrosses = ({ start, control, end }: ReturnType<typeof quadraticTrajectoryRoute>, rects: RouteRect[]) => {
  for (let index = 0; index <= 64; index += 1) {
    const t = index / 64, a = (1 - t) ** 2, b = 2 * t * (1 - t), c = t * t;
    const x = a * start.x + b * control.x + c * end.x, y = a * start.y + b * control.y + c * end.y;
    if (rects.some(rect => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height)) return true;
  }
  return false;
};

/**
 * The side a bowed route takes among tree labels. It keeps `bow.side` unless
 * that arc passes through a label the opposite arc clears; when both cross
 * labels, it keeps `bow.side`. Labels an endpoint attaches to do not count.
 */
export const clearTrajectoryBowSide = (from: RoutePoint, to: RoutePoint, bow: TrajectoryBow, fanOffset: number,
  labels: readonly RouteRect[]): TrajectoryBowSide => {
  const others = labels.filter(rect => !attachesTo(rect, from) && !attachesTo(rect, to));
  if (!others.length || !routeCrosses(quadraticTrajectoryRoute(from, to, bow, fanOffset), others)) return bow.side;
  const opposite = { side: (bow.side === 1 ? -1 : 1) as TrajectoryBowSide, weight: bow.weight };
  return routeCrosses(quadraticTrajectoryRoute(from, to, opposite, fanOffset), others) ? bow.side : opposite.side;
};

/** Margin a camera fit keeps around a plaque. */
export const PLAQUE_FIT_MARGIN = 24;

/** Markers stay screen-sized as the tree zooms out, up to this multiple. */
export const MAX_MARKER_SCALE = 3;
export const markerScaleAtZoom = (zoom: number) => Math.min(1 / zoom, MAX_MARKER_SCALE);

/** Viewports narrower than this use the compact camera and overlay placement. */
export const COMPACT_VIEWPORT_WIDTH = 500;
export const isCompactViewport = (width: number) => width < COMPACT_VIEWPORT_WIDTH;

/**
 * A fresh Replay fit never goes below `minimumFitScale`; containment may shrink
 * it, or a retained fit, further. The Canopy's fit has no minimum: it always
 * shows the whole tree. Wheel and pinch zoom keep to `userZoomExtent`, widened
 * by `userZoomExtentAt` to include the scale the camera actually applied.
 */
export const CAMERA_ZOOM = {
  minimumFitScale: { compact: 0.02, regular: 0.06 },
  userZoomExtent: [0.05, 10]
} as const;

/** d3 clamps every wheel and pinch step to the zoom extent, so an applied scale
 * outside it would jump to the boundary on the first gesture. */
export const userZoomExtentAt = (scale: number): [number, number] =>
  [Math.min(CAMERA_ZOOM.userZoomExtent[0], scale), Math.max(CAMERA_ZOOM.userZoomExtent[1], scale)];
