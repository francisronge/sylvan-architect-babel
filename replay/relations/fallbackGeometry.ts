import type {
  BindGeometryOptions,
  BoundAnchorSetBadge,
  BoundAnchorSetRail,
  BoundFallbackMark,
  BoundFrame,
  BoundPrimitive,
  BoundSegment
} from './boundGeometry.ts';
import type { Point, Rect } from './overlayGeometry.ts';
import { allocateSpanLanes } from './overlayGeometry.ts';
import { TREE_ROW_HEIGHT } from '../treeSpacing.ts';
import { anchorSetBadgeRadius } from '../rendererMetrics.ts';
import type { PlaqueTextStyle } from './plaqueTextLayout.ts';

export const anchorSetRailPaths = (rail: BoundAnchorSetRail, markerScale: number, fallbackScale = markerScale) => ({
  rail: `M ${rail.x1} ${rail.y} H ${rail.x2}`,
  joins: rail.anchors.map(anchor => {
    const clearance = anchor.type === 'fallback-mark' ? 12 : anchorSetBadgeRadius(anchor.badgeSize);
    return `M ${anchor.x} ${anchor.y + clearance * (anchor.type === 'fallback-mark' ? fallbackScale : markerScale)} V ${rail.y}`;
  }).join(' ')
});

export type UnroutedFallbackSegment = Omit<BoundSegment, 'd' | 'lane' | 'laneY'>;

type FallbackRoutingOptions = Pick<BindGeometryOptions, 'markerScale' | 'laneGap' | 'connectorBaselineY' | 'fallbackMeasurements'>
  & { labelClearances?: Rect[]; obstacles?: Rect[]; occlusions?: Rect[] };

export const FALLBACK_ROLE_STYLE: PlaqueTextStyle = {
  fontFamily: '"Crimson Pro", Georgia, serif', fontSize: 12, fontWeight: 600, letterSpacing: 0
};

export const fallbackLabelRect = (mark: Pick<BoundFallbackMark, 'x' | 'y' | 'textWidth' | 'textHeight'>, scale: number): Rect => {
  // Roles use a central baseline. Two units per side cover their three-unit
  // round outline; unmeasured callers retain the conservative reservation.
  const height = mark.textHeight === undefined ? 24 : mark.textHeight + 4;
  return {
    x: mark.x - (mark.textWidth / 2 + 4) * scale, y: mark.y - height / 2 * scale,
    width: (mark.textWidth + 8) * scale, height: height * scale
  };
};

/** Painted connector strokes in marker units; each round-capped line is drawn over its shadow. */
export const FALLBACK_STROKE_WIDTHS = {
  'direct': { line: 1.5, shadow: 3.6 },
  'counter-lane': { line: 1.9, shadow: 4.4 }
} as const;

// Connector clearances in marker units, so every automatic Fit keeps the same
// screen spacing and manual zoom scales it with the tree.
const LABEL_CLEARANCE = 3;
const ROUTE_CLEARANCE = 12;
// Dark space a spoke leaves between its shadow and a plaque it would meet.
const PLAQUE_VISIBLE_GAP = 4;

const inflateRect = (rect: Rect, by: number): Rect =>
  ({ x: rect.x - by, y: rect.y - by, width: rect.width + 2 * by, height: rect.height + 2 * by });

/** Parameters along from→to where the straight line is inside the box, if any. */
function lineInterval(from: Point, dx: number, dy: number, box: Rect): [number, number] | null {
  let enter = 0, leave = 1;
  for (const [origin, delta, min, max] of [
    [from.x, dx, box.x, box.x + box.width],
    [from.y, dy, box.y, box.y + box.height]
  ]) {
    if (Math.abs(delta) < 1e-9) {
      if (origin < min || origin > max) return null;
    } else {
      const a = (min - origin) / delta, b = (max - origin) / delta;
      enter = Math.max(enter, Math.min(a, b));
      leave = Math.min(leave, Math.max(a, b));
    }
  }
  return enter < leave ? [enter, leave] : null;
}

/** Euclidean distance between a straight piece and a rectangle; zero when they meet. */
function segmentRectDistance(p: Point, q: Point, box: Rect): number {
  const dx = q.x - p.x, dy = q.y - p.y, squared = dx * dx + dy * dy;
  if (lineInterval(p, dx, dy, box)) return 0;
  const toBox = (point: Point) => Math.hypot(Math.max(box.x - point.x, 0, point.x - box.x - box.width),
    Math.max(box.y - point.y, 0, point.y - box.y - box.height));
  const toPiece = (x: number, y: number) => {
    const t = squared ? Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / squared)) : 0;
    return Math.hypot(x - p.x - t * dx, y - p.y - t * dy);
  };
  return Math.min(toBox(p), toBox(q), toPiece(box.x, box.y), toPiece(box.x + box.width, box.y),
    toPiece(box.x, box.y + box.height), toPiece(box.x + box.width, box.y + box.height));
}

/** A plaque is not an attachment point. When the line left visible beside its
 * labels comes within `contact` of a plaque, it is cut wherever it lies inside
 * the plaque inflated by `gap`, so each cut end keeps at least that distance.
 * A line passing beside a plaque stays whole. No cut may remove the piece at
 * either labelled end or round it to nothing: the plaque then cuts at its own
 * edge, or not at all.
 * An isolated piece left between cuts, shorter than `minimum`, would paint as
 * a round-capped dot and is dropped. */
type PlaqueClearance = { boxes: readonly Rect[]; contact: number; gap: number; minimum: number };

type Interval = [number, number];
const removeInterval = (visible: Interval[], cut: Interval | null): Interval[] => !cut ? visible
  : visible.flatMap<Interval>(([a, b]) => cut[1] <= a || cut[0] >= b ? [[a, b]]
    : [...(a < cut[0] ? [[a, cut[0]] as Interval] : []), ...(cut[1] < b ? [[cut[1], b] as Interval] : [])]);

// Keep straight connectors intact outside the measured label rectangles.
export function clearLabelPath(from: Point, to: Point, boxes: readonly Rect[] = [], plaques?: PlaqueClearance): string {
  const dx = to.x - from.x, dy = to.y - from.y;
  const at = (t: number): Point => ({ x: from.x + dx * t, y: from.y + dy * t });
  const besideLabels = boxes.reduce<Interval[]>((parts, box) => removeInterval(parts, lineInterval(from, dx, dy, box)), [[0, 1]]);
  const start = besideLabels[0]?.[0], end = besideLabels.at(-1)?.[1];
  // SVG reads -0.0 and 0.0 as one coordinate; writing only 0.0 keeps equal points equal.
  const coordinate = (value: number) => value.toFixed(1).replace(/^-(0\.0)$/, '$1');
  const point = (t: number) => `${coordinate(at(t).x)} ${coordinate(at(t).y)}`;
  const length = Math.hypot(dx, dy);
  // Judge attachment on pieces as they are written, so the check and the path cannot disagree.
  const drawn = ([a, b]: Interval) => point(a) !== point(b);
  const ends = [(piece: Interval) => piece[0] === start, (piece: Interval) => piece[1] === end]
    .filter(atEnd => besideLabels.some(piece => atEnd(piece) && drawn(piece)));
  const attached = (parts: Interval[]) => ends.every(atEnd => parts.some(piece => atEnd(piece) && drawn(piece)));
  let visible = besideLabels;
  if (plaques) {
    const met = plaques.boxes.filter(box => besideLabels.some(([a, b]) => segmentRectDistance(at(a), at(b), box) < plaques.contact));
    // Attachment wins over clearance: keep the gap, else cut at the plaque's edge, else leave the spoke uncut.
    for (const box of met) visible = removeInterval(visible, [inflateRect(box, plaques.gap), box]
      .map(rect => lineInterval(from, dx, dy, rect)).find(cut => attached(removeInterval(visible, cut))) ?? null);
  }
  // A piece that still leaves a labelled end keeps the spoke attached, however short.
  const kept = ([a, b]: Interval) => a === start || b === end || besideLabels.some(([c, e]) => c === a && e === b)
    || drawn([a, b]) && (b - a) * length >= plaques!.minimum;
  return visible.filter(kept).map(([a, b]) => `M ${point(a)} L ${point(b)}`).join(' ');
}

export const routeFallbackSegments = (
  segments: UnroutedFallbackSegment[],
  options: FallbackRoutingOptions
): BoundSegment[] => {
  const markerScale = Math.max(0.1, options.markerScale ?? 1);
  const laneGap = options.laneGap ?? 24;
  const plaques = options.occlusions ?? options.obstacles ?? [];
  // Counter-lane stems keep exact clipping: plaque placement reserves them.
  const clearances = [...(options.labelClearances ?? []), ...plaques];
  const shadowReach = FALLBACK_STROKE_WIDTHS.direct.shadow / 2 * markerScale;
  const spokePlaques = { boxes: plaques, contact: shadowReach, gap: shadowReach + PLAQUE_VISIBLE_GAP * markerScale,
    minimum: FALLBACK_STROKE_WIDTHS.direct.line * markerScale };
  const counterSegments = segments.filter(segment => segment.route === 'counter-lane');
  const lanes = allocateSpanLanes(counterSegments.map(segment => ({
    start: Math.min(segment.from.x, segment.to.x),
    end: Math.max(segment.from.x, segment.to.x)
  })), laneGap);
  const participantBottom = counterSegments.length > 0
    ? Math.max(...counterSegments.flatMap(segment => [segment.from.y, segment.to.y])) : 0;
  // Measured endpoints already include their subtree bottoms. Unrelated
  // deeper syntax must not turn a local connection into a tree-height detour.
  const localFloor = options.fallbackMeasurements
    ? participantBottom + 34 * markerScale
    : options.connectorBaselineY ?? participantBottom + 46 * markerScale;
  // Move the common floor, not individual lanes, so distinct links stay distinct.
  // A plaque the lanes come near pushes it below the plaque. A tree label of the
  // stage pushes it when the lanes' turns or runs would cross the label's own
  // clearance, since stems are cut around labels but turns and runs are not.
  // Labels may lower the floor by at most one tree row; where unrelated text
  // leaves no gap that near, the lanes keep the floor plaques alone set.
  // Every label of the stage counts, so the floor holds while its nodes appear.
  const clearance = ROUTE_CLEARANCE * markerScale;
  const labelClearance = LABEL_CLEARANCE * markerScale;
  const turn = 8 * markerScale;
  const stroke = FALLBACK_STROKE_WIDTHS['counter-lane'].shadow / 2 * markerScale;
  const deepestLane = Math.max(0, ...lanes) * laneGap;
  const crosses = (box: Rect, gap: number) => counterSegments.some(segment => box.x - gap < Math.max(segment.from.x, segment.to.x)
    && box.x + box.width + gap > Math.min(segment.from.x, segment.to.x));
  const floorBelow = (labels: readonly Rect[]) => {
    let floor = localFloor;
    for (const { box, label } of [...(options.obstacles ?? []).map(box => ({ box, label: false })),
      ...labels.map(box => ({ box, label: true }))].sort((a, b) => a.box.y - b.box.y)) {
      if (!label && box.y - clearance <= floor + deepestLane && crosses(box, clearance))
        floor = Math.max(floor, box.y + box.height + clearance);
      if (label && box.y - labelClearance < floor + deepestLane + stroke
        && box.y + box.height + labelClearance > floor - turn - stroke && crosses(box, labelClearance + stroke))
        floor = box.y + box.height + labelClearance + turn + stroke;
    }
    return floor;
  };
  const plaqueFloor = floorBelow([]);
  const labelFloor = counterSegments.length ? floorBelow(options.fallbackMeasurements?.labels ?? []) : plaqueFloor;
  const measuredBaseline = labelFloor - plaqueFloor <= TREE_ROW_HEIGHT ? labelFloor : plaqueFloor;
  let counterIndex = 0;
  return segments.map(segment => {
    if (segment.route === 'direct') {
      return { ...segment, lane: null, d: clearLabelPath(segment.from, segment.to, options.labelClearances, spokePlaques) };
    }
    const from = segment.from.x <= segment.to.x ? segment.from : segment.to;
    const to = from === segment.from ? segment.to : segment.from;
    const lane = lanes[counterIndex++];
    const laneY = measuredBaseline + lane * laneGap;
    const stem = 6 * markerScale;
    const corner = 9 * markerScale;
    const leftTurn = { x: from.x, y: laneY - 8 * markerScale };
    const rightTurn = { x: to.x, y: leftTurn.y };
    const d = [
      clearLabelPath({ x: from.x, y: from.y + stem }, leftTurn, clearances),
      `M ${leftTurn.x.toFixed(1)} ${leftTurn.y.toFixed(1)}`,
      `Q ${from.x.toFixed(1)} ${laneY.toFixed(1)} ${(from.x + corner).toFixed(1)} ${laneY.toFixed(1)}`,
      `L ${(to.x - corner).toFixed(1)} ${laneY.toFixed(1)}`,
      `Q ${to.x.toFixed(1)} ${laneY.toFixed(1)} ${to.x.toFixed(1)} ${(laneY - 8 * markerScale).toFixed(1)}`,
      clearLabelPath(rightTurn, { x: to.x, y: to.y + stem }, clearances)
    ].join(' ');
    return { ...segment, from, to, lane, laneY, d };
  });
};

export const fallbackRailY = (
  rail: BoundAnchorSetRail,
  deepestConnectorLaneY: number,
  options: Pick<BindGeometryOptions, 'railBaseY' | 'railLaneGap'>
): number => Math.max(
  options.railBaseY ?? 0,
  deepestConnectorLaneY > 0 ? deepestConnectorLaneY + 90 : 0
) + rail.lane * (options.railLaneGap ?? 60);

/** Orchard sizing is selected at automatic Fit, then the whole annotation zooms with the tree. */
export const fallbackMarkerScale = (fitZoom: number, labelHeights: number[]): number => {
  const heights = labelHeights.filter(height => height > 0).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] ?? 42;
  return Math.min(13, Math.max(9, median * fitZoom * 1.15)) / (18 * fitZoom);
};

/** Overlap of two boxes in their shallower direction; zero when they do not meet. */
const overlapDepth = (a: Rect, b: Rect) => Math.max(0, Math.min(
  Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)));

// A role searches no farther than this multiple of its farthest preferred spot.
const ROLE_SEARCH_REACH = 2;

/** Accepted Orchard side placement, reserving all marks before any relation is
 * revealed. The first free preferred spot wins; the side after the node in
 * reading `direction` comes first, so right to left reflects left to right. When all are taken, the role
 * takes the nearest free spot on either side of its node or in the rows above
 * and below, searched in steps of its own height up to twice its farthest
 * preferred spot; it never drifts beyond that reach. With a viewport, a free
 * spot inside it comes first, then the free spot that leaves it least, unless
 * the role is larger than the viewport. When nothing within reach is free, the
 * role takes the spot there that overlaps least, inside the viewport first. */
export const placeFallbackMark = (mark: Pick<BoundFallbackMark, 'labelRect' | 'textWidth' | 'textHeight'>,
  scale: number, occupied: Rect[], viewport?: Rect, direction: 'ltr' | 'rtl' = 'ltr'): Point => {
  const rect = mark.labelRect, reading = direction === 'rtl' ? -1 : 1;
  const extent = (mark.textWidth / 2 + 4) * scale;
  const gap = (mark.textWidth / 2 + 7) * scale;
  const above = rect.y - 15 * scale;
  const below = rect.y + rect.height + 15 * scale;
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const boxFor = (point: Point): Rect => fallbackLabelRect({ ...mark, ...point }, scale);
  const after = reading > 0 ? rect.x + rect.width + gap : rect.x - gap;
  const before = reading > 0 ? rect.x - gap : rect.x + rect.width + gap;
  const preferred = [
    { x: after, y: center.y },
    { x: before, y: center.y },
    { x: center.x, y: above },
    { x: after, y: above },
    { x: before, y: above }
  ];
  const meets = (box: Rect, other: Rect) => box.x < other.x + other.width - 0.5
    && box.x + box.width > other.x + 0.5 && box.y < other.y + other.height - 0.5
    && box.y + box.height > other.y + 0.5;
  const contained = (point: Point) => {
    if (!viewport) return true;
    const box = boxFor(point);
    return box.x >= viewport.x && box.y >= viewport.y
      && box.x + box.width <= viewport.x + viewport.width
      && box.y + box.height <= viewport.y + viewport.height;
  };
  let chosen = preferred.find(point => contained(point) && !occupied.some(other => meets(boxFor(point), other)));
  if (!chosen) {
    const distance = (point: Point) => Math.hypot(point.x - center.x, point.y - center.y);
    const limit = ROLE_SEARCH_REACH * Math.max(...[...preferred, { x: center.x, y: below }].map(distance));
    const step = boxFor(center).height;
    const searched: Point[] = [];
    if (viewport) {
      // A long role may fit above or below its node even when neither side fits.
      const x = Math.max(viewport.x + extent, Math.min(center.x, viewport.x + viewport.width - extent));
      searched.push({ x, y: above }, { x, y: below });
    }
    // Equal distances go to rows above and to the reading-direction side, as the preferred spots run.
    const offsets = [0];
    for (let k = 1; k * step <= limit; k++) offsets.push(-k, k);
    for (const row of offsets) for (const column of offsets) {
      const point = { x: center.x - reading * column * step, y: center.y + row * step };
      if (distance(point) <= limit) searched.push(point);
    }
    const reachable = inflateRect(boxFor(center), limit);
    const nearby = occupied.filter(other => meets(reachable, other));
    // Preferred spots keep their order; searched spots go nearest first. A spot
    // covering the node's own label, or its edge outline, is never taken.
    const spots = [...preferred, ...searched.map(point => ({ point, far: distance(point) }))
      .sort((a, b) => a.far - b.far).map(({ point }) => point)]
      .filter(point => distance(point) <= limit && !meets(boxFor(point), rect));
    const free = (point: Point) => {
      const box = boxFor(point);
      return !nearby.some(other => meets(box, other));
    };
    // A role that could fit the viewport but finds no free spot inside takes the
    // free spot that leaves it least; one wider or taller than the viewport keeps
    // its nearest free spot, for panning.
    const box = boxFor(center);
    const protrusion = (point: Point) => {
      const placed = boxFor(point);
      return !viewport ? 0 : Math.max(0, viewport.x - placed.x, viewport.y - placed.y,
        placed.x + placed.width - viewport.x - viewport.width, placed.y + placed.height - viewport.y - viewport.height);
    };
    const fits = viewport && box.width <= viewport.width && box.height <= viewport.height;
    chosen = spots.find(point => contained(point) && free(point))
      ?? (fits ? spots.filter(free).reduce<Point | undefined>((best, point) =>
        !best || protrusion(point) < protrusion(best) ? point : best, undefined) : spots.find(free));
    if (!chosen) {
      const overlap = (point: Point) => {
        const box = boxFor(point);
        return Math.max(0, ...nearby.map(other => overlapDepth(box, other)));
      };
      chosen = spots.map(point => ({ point, outside: Number(!contained(point)), overlap: overlap(point) }))
        .sort((a, b) => a.outside - b.outside || a.overlap - b.overlap || distance(a.point) - distance(b.point))[0].point;
    }
  }
  occupied.push(boxFor(chosen));
  return chosen;
};

/** Refit the same measured allocation, preserving claim ownership and stage-wide reservation. */
export const fitFallbackGeometry = (
  frame: BoundFrame,
  options: FallbackRoutingOptions & Pick<BindGeometryOptions, 'badgeGap' | 'railBaseY' | 'railLaneGap' | 'fallbackMeasurements' | 'separateFallbackMoments' | 'direction'>
    & { fittedMarkerScale: number; fittedAnchorScale?: number; fittedViewport?: Rect; relationInkObstacles?: Rect[];
      /** Where Fit re-placed each anchor-set badge; a badge without an entry
       * keeps its nominal stack offset at `fittedAnchorScale`. */
      fittedAnchorSetBadges?: ReadonlyMap<BoundAnchorSetBadge, Point> }
): Map<BoundFallbackMark | BoundSegment | BoundAnchorSetRail, BoundFallbackMark | BoundSegment | BoundAnchorSetRail> => {
  if (options.separateFallbackMoments) {
    // Replay shows one neutral relation at a time. Invisible relations must
    // neither displace its labels nor cut holes in its connectors.
    const groups = new Map<number, BoundPrimitive[]>();
    frame.primitives.forEach(primitive => {
      if (!['fallback-mark', 'segment', 'anchor-set-rail'].includes(primitive.type)) return;
      const owner = primitive.type === 'anchor-set-rail'
        ? primitive.anchors.find(anchor => anchor.type === 'fallback-mark')?.itemIndex ?? primitive.itemIndex
        : primitive.itemIndex;
      const group = groups.get(owner) ?? [];
      group.push(primitive);
      groups.set(owner, group);
    });
    return new Map([...groups.values()].flatMap(primitives => [...fitFallbackGeometry(
      { ...frame, primitives }, { ...options, separateFallbackMoments: false }
    )]));
  }
  const scale = options.fittedMarkerScale;
  const anchorScale = options.fittedAnchorScale ?? scale;
  const occupied = [...(options.fallbackMeasurements?.labels ?? []), ...(options.fallbackMeasurements?.obstacles ?? []),
  ...(options.relationInkObstacles ?? [])];
  const segments = frame.primitives.filter((p): p is BoundSegment => p.type === 'segment');
  const routed = routeFallbackSegments(segments.filter(segment => segment.route === 'counter-lane'), {
    ...options, markerScale: scale, obstacles: options.fallbackMeasurements?.obstacles
  });
  // Place text around the complete reserved routes, rather than bending a link
  // around long text or allowing later role labels to cover its stems.
  for (const segment of routed) {
    const points = [segment.from, { x: segment.from.x, y: segment.laneY! },
    { x: segment.to.x, y: segment.laneY! }, segment.to];
    points.slice(1).forEach((point, i) => occupied.push(inflateRect({
      x: Math.min(point.x, points[i].x), y: Math.min(point.y, points[i].y),
      width: Math.abs(point.x - points[i].x), height: Math.abs(point.y - points[i].y)
    }, ROUTE_CLEARANCE * scale)));
  }
  const updates = new Map<BoundFallbackMark | BoundSegment | BoundAnchorSetRail, BoundFallbackMark | BoundSegment | BoundAnchorSetRail>();
  const centers = new Map<number, Point>();
  frame.primitives.filter((mark): mark is BoundFallbackMark => mark.type === 'fallback-mark')
    .sort((a, b) => a.allocationOrder - b.allocationOrder).forEach(mark => {
      const point = placeFallbackMark(mark, scale, occupied, options.fittedViewport, options.direction);
      updates.set(mark, { ...mark, ...point });
      centers.set(mark.allocationOrder, point);
    });
  const fitted = routeFallbackSegments(segments.map(segment => ({
    ...segment,
    ...(segment.route === 'direct' ? {
      from: centers.get(segment.fromMark!) ?? segment.from,
      to: centers.get(segment.toMark!) ?? segment.to
    } : {})
  })), {
    ...options, markerScale: scale,
    obstacles: options.fallbackMeasurements?.obstacles,
    occlusions: options.fallbackMeasurements?.visibleObstacles,
    labelClearances: [
      ...(options.fallbackMeasurements?.visibleLabels ?? options.fallbackMeasurements?.labels ?? [])
        .map(rect => inflateRect(rect, LABEL_CLEARANCE * scale)),
      ...[...updates.values()].filter((mark): mark is BoundFallbackMark => mark.type === 'fallback-mark')
        .map(mark => fallbackLabelRect(mark, scale))
    ]
  });
  segments.forEach((segment, index) => updates.set(segment, fitted[index]));
  const deepest = Math.max(0, ...fitted.map(segment => segment.laneY ?? 0));
  frame.primitives.forEach(rail => {
    if (rail.type !== 'anchor-set-rail') return;
    const anchors = rail.anchors.map(anchor => anchor.type === 'fallback-mark'
      ? updates.get(anchor) as BoundFallbackMark
      : options.fittedAnchorSetBadges?.has(anchor) ? { ...anchor, ...options.fittedAnchorSetBadges.get(anchor) } : {
        ...anchor, y: anchor.y + (anchor.stackIndex + 1) * (options.badgeGap ?? 22)
          * (anchorScale - (options.markerScale ?? 1))
      });
    updates.set(rail, {
      ...rail, anchors,
      x1: Math.min(...anchors.map(anchor => anchor.x)), x2: Math.max(...anchors.map(anchor => anchor.x)),
      y: fallbackRailY(rail, deepest, options)
    });
  });
  return updates;
};
