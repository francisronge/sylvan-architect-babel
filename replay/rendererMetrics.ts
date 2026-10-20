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
  quadraticBellyPerSpan: 0.2
} as const;

/** Control-point depth of a quadratic trajectory: it deepens with horizontal span. */
export const quadraticTrajectoryBellyY = (start: { x: number; y: number }, end: { x: number; y: number }) =>
  Math.max(start.y, end.y) + Math.max(TRAJECTORY_ROUTES.quadraticMinimumBelly,
    Math.abs(end.x - start.x) * TRAJECTORY_ROUTES.quadraticBellyPerSpan);

/** Margin a camera fit keeps around a plaque. */
export const PLAQUE_FIT_MARGIN = 24;

/** Markers stay screen-sized as the tree zooms out, up to this multiple. */
export const MAX_MARKER_SCALE = 3;
export const markerScaleAtZoom = (zoom: number) => Math.min(1 / zoom, MAX_MARKER_SCALE);

/** Viewports narrower than this use the compact camera and overlay placement. */
export const COMPACT_VIEWPORT_WIDTH = 500;
export const isCompactViewport = (width: number) => width < COMPACT_VIEWPORT_WIDTH;

/**
 * A fresh fit never goes below `minimumFitScale`; containment may shrink a
 * retained fit further. Wheel and pinch zoom keep to `userZoomExtent`, widened
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
