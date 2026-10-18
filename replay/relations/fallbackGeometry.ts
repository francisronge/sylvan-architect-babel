import type {
  BindGeometryOptions,
  BoundAnchorSetRail,
  BoundFallbackMark,
  BoundFrame,
  BoundPrimitive,
  BoundSegment
} from './boundGeometry.ts';
import type { Point, Rect } from './overlayGeometry.ts';
import { allocateSpanLanes } from './overlayGeometry.ts';
import type { PlaqueTextStyle } from './plaqueTextLayout.ts';

export const anchorSetRailPaths = (rail: BoundAnchorSetRail, markerScale: number, fallbackScale = markerScale) => ({
  rail: `M ${rail.x1} ${rail.y} H ${rail.x2}`,
  joins: rail.anchors.map(anchor => {
    const clearance = anchor.type === 'fallback-mark' ? 12 : anchor.badgeSize === 'compact' ? 7 : 9;
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

// Keep straight connectors intact outside the measured label rectangles.
export function clearLabelPath(from: Point, to: Point, boxes: readonly Rect[] = []): string {
  const dx = to.x - from.x, dy = to.y - from.y;
  let visible: Array<[number, number]> = [[0, 1]];
  for (const box of boxes) {
    let enter = 0, leave = 1;
    for (const [origin, delta, min, max] of [
      [from.x, dx, box.x, box.x + box.width],
      [from.y, dy, box.y, box.y + box.height]
    ]) {
      if (Math.abs(delta) < 1e-9) {
        if (origin < min || origin > max) { enter = 1; leave = 0; break; }
      } else {
        const a = (min - origin) / delta, b = (max - origin) / delta;
        enter = Math.max(enter, Math.min(a, b));
        leave = Math.min(leave, Math.max(a, b));
      }
    }
    if (enter >= leave) continue;
    visible = visible.flatMap<[number, number]>(([a, b]) => leave <= a || enter >= b ? [[a, b]]
      : [...(a < enter ? [[a, enter] as [number, number]] : []), ...(leave < b ? [[leave, b] as [number, number]] : [])]);
  }
  const point = (t: number) => `${(from.x + dx * t).toFixed(1)} ${(from.y + dy * t).toFixed(1)}`;
  return visible.map(([a, b]) => `M ${point(a)} L ${point(b)}`).join(' ');
}

/** Marker units between a straight fan spoke's cut end and a plaque it passes.
 * Plaques are not attachment points: the gap clears the round cap (0.75) and
 * shadow (1.8) and stays visible. Marker units keep the same screen gap at every
 * automatic Fit, and manual zoom scales it with the tree. Counter-lane stems
 * keep exact clipping because plaque placement already reserves them. */
export const FALLBACK_PLAQUE_GAP = 6;

export const routeFallbackSegments = (
  segments: UnroutedFallbackSegment[],
  options: FallbackRoutingOptions
): BoundSegment[] => {
  const markerScale = Math.max(0.1, options.markerScale ?? 1);
  const laneGap = options.laneGap ?? 24;
  const plaques = options.occlusions ?? options.obstacles ?? [];
  const clearances = [...(options.labelClearances ?? []), ...plaques];
  const plaqueGap = FALLBACK_PLAQUE_GAP * markerScale;
  const spokeClearances = [...(options.labelClearances ?? []), ...plaques.map(box => ({
    x: box.x - plaqueGap, y: box.y - plaqueGap, width: box.width + 2 * plaqueGap, height: box.height + 2 * plaqueGap
  }))];
  const counterSegments = segments.filter(segment => segment.route === 'counter-lane');
  const lanes = allocateSpanLanes(counterSegments.map(segment => ({
    start: Math.min(segment.from.x, segment.to.x),
    end: Math.max(segment.from.x, segment.to.x)
  })), laneGap);
  const participantBottom = counterSegments.length > 0
    ? Math.max(...counterSegments.flatMap(segment => [segment.from.y, segment.to.y])) : 0;
  // Measured endpoints already include their subtree bottoms. Unrelated
  // deeper syntax must not turn a local connection into a tree-height detour.
  let measuredBaseline = options.fallbackMeasurements
    ? participantBottom + 34 * markerScale
    : options.connectorBaselineY ?? participantBottom + 46 * markerScale;
  // Move the common floor, not individual lanes, so distinct links stay distinct.
  const clearance = 12 * markerScale;
  for (const box of [...(options.obstacles ?? [])].sort((a, b) => a.y - b.y)) {
    if (box.y - clearance <= measuredBaseline + Math.max(0, ...lanes) * laneGap
      && counterSegments.some(segment => box.x - clearance < Math.max(segment.from.x, segment.to.x)
        && box.x + box.width + clearance > Math.min(segment.from.x, segment.to.x)))
      measuredBaseline = Math.max(measuredBaseline, box.y + box.height + clearance);
  }
  let counterIndex = 0;
  return segments.map(segment => {
    if (segment.route === 'direct') {
      return { ...segment, lane: null, d: clearLabelPath(segment.from, segment.to, spokeClearances) };
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

/** Accepted Orchard side placement, reserving all marks before any relation is revealed. */
export const placeFallbackMark = (mark: Pick<BoundFallbackMark, 'labelRect' | 'textWidth' | 'textHeight'>,
  scale: number, occupied: Rect[], viewport?: Rect): Point => {
  const rect = mark.labelRect;
  const leftExtent = (mark.textWidth / 2 + 4) * scale;
  const rightExtent = leftExtent;
  const gap = (mark.textWidth / 2 + 7) * scale;
  const above = rect.y - 15 * scale;
  const boxFor = (point: Point): Rect => fallbackLabelRect({ ...mark, ...point }, scale);
  const candidates = [
    { x: rect.x + rect.width + gap, y: rect.y + rect.height / 2 },
    { x: rect.x - gap, y: rect.y + rect.height / 2 },
    { x: rect.x + rect.width / 2, y: above },
    { x: rect.x + rect.width + gap, y: above },
    { x: rect.x - gap, y: above }
  ];
  const free = (point: Point) => {
    const box = boxFor(point);
    return !occupied.some(other => box.x < other.x + other.width - 0.5
      && box.x + box.width > other.x + 0.5 && box.y < other.y + other.height - 0.5
      && box.y + box.height > other.y + 0.5);
  };
  // More than five relations can share a node. Continue outward only after the
  // Orchard's preferred positions are occupied; never place two marks together.
  let chosen = candidates.find(free);
  for (let offset = 1; !chosen; offset++) {
    chosen = candidates.map(point => ({ ...point, x: point.x + (rightExtent + leftExtent + 4 * scale) * offset })).find(free);
  }
  if (viewport) {
    const contained = (point: Point) => {
      const box = boxFor(point);
      return box.x >= viewport.x && box.y >= viewport.y
        && box.x + box.width <= viewport.x + viewport.width
        && box.y + box.height <= viewport.y + viewport.height;
    };
    if (!contained(chosen)) {
      // A long role may fit above or below its node even when neither side fits.
      // Keep normal placements intact; use text height for vertical clearance.
      const x = Math.max(viewport.x + leftExtent,
        Math.min(rect.x + rect.width / 2, viewport.x + viewport.width - rightExtent));
      const alternatives = [...candidates,
      { x, y: rect.y - 15 * scale },
      { x, y: rect.y + rect.height + 15 * scale }];
      chosen = alternatives.find(point => contained(point) && free(point)) ?? chosen;
    }
  }
  occupied.push(boxFor(chosen));
  return chosen;
};

/** Refit the same measured allocation, preserving claim ownership and stage-wide reservation. */
export const fitFallbackGeometry = (
  frame: BoundFrame,
  options: FallbackRoutingOptions & Pick<BindGeometryOptions, 'badgeGap' | 'railBaseY' | 'railLaneGap' | 'fallbackMeasurements' | 'separateFallbackMoments'>
    & { fittedMarkerScale: number; fittedAnchorScale?: number; fittedViewport?: Rect; relationInkObstacles?: Rect[] }
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
    { x: segment.to.x, y: segment.laneY! }, segment.to], pad = 12 * scale;
    points.slice(1).forEach((point, i) => occupied.push({
      x: Math.min(point.x, points[i].x) - pad, y: Math.min(point.y, points[i].y) - pad,
      width: Math.abs(point.x - points[i].x) + pad * 2, height: Math.abs(point.y - points[i].y) + pad * 2
    }));
  }
  const updates = new Map<BoundFallbackMark | BoundSegment | BoundAnchorSetRail, BoundFallbackMark | BoundSegment | BoundAnchorSetRail>();
  const centers = new Map<number, Point>();
  frame.primitives.filter((mark): mark is BoundFallbackMark => mark.type === 'fallback-mark')
    .sort((a, b) => a.allocationOrder - b.allocationOrder).forEach(mark => {
      const point = placeFallbackMark(mark, scale, occupied, options.fittedViewport);
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
      ...(options.fallbackMeasurements?.visibleLabels ?? options.fallbackMeasurements?.labels ?? []).map(rect => ({
        x: rect.x - 3 * scale, y: rect.y - 3 * scale,
        width: rect.width + 6 * scale, height: rect.height + 6 * scale
      })),
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
      : {
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
