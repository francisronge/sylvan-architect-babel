import type {
  BindGeometryOptions,
  BoundAnchorSetBadge,
  BoundAnchorSetRail,
  BoundFallbackMark,
  BoundFrame,
  BoundPrimitive,
  BoundSegment,
  FallbackBracketEnd,
  FallbackBrackets
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

// Bracket shape in marker units: the end ticks' rise, and the drop from a
// bracket to the run joining the two brackets below it.
const BRACKET_TICK = 8;
const BRACKET_DROP = 16;

const endHull = (end: FallbackBracketEnd): [number, number] => end.tick !== null ? [end.tick, end.tick]
  : [Math.min(...end.runs.map(run => run.x1)), Math.max(...end.runs.map(run => run.x2))];
const endJoin = (end: FallbackBracketEnd): number => {
  const [x1, x2] = endHull(end);
  return (x1 + x2) / 2;
};
const bracketXs = (brackets: FallbackBrackets): number[] => brackets.ends.flatMap(endHull);

const fixed = (value: number) => value.toFixed(1);

/** A bracketed connector. Its run takes the lane a stem connector would run
 * along. Each participant's bracket runs under the words it covers one drop
 * above the lane, with a short tick rising at each end of every run; a
 * participant covering no painted word has one tick. Brackets of two separate
 * participants join by the run, through stems from each bracket's middle. When
 * one participant dominates the other, the inner bracket stays above and the
 * outer one, drawn along the lane and extended to the inner's middle, is
 * itself the run. */
function routeBrackets(segment: UnroutedFallbackSegment, lane: number, runY: number, markerScale: number): BoundSegment {
  const brackets = segment.brackets!;
  const tick = BRACKET_TICK * markerScale, drop = BRACKET_DROP * markerScale;
  const joins = brackets.ends.map(endJoin) as [number, number];
  const laneY = runY - drop;
  const levels: [number, number] = brackets.inner === null ? [laneY, laneY]
    : brackets.inner === 0 ? [laneY, runY] : [runY, laneY];
  const bracketPath = (end: FallbackBracketEnd, y: number, reach: number | null) => {
    if (end.tick !== null) return [`M ${fixed(end.tick)} ${fixed(y - tick)} L ${fixed(end.tick)} ${fixed(y)}`];
    const [x1, x2] = endHull(end);
    const left = reach === null ? x1 : Math.min(x1, reach), right = reach === null ? x2 : Math.max(x2, reach);
    return [`M ${fixed(left)} ${fixed(y)} L ${fixed(right)} ${fixed(y)}`,
      ...end.runs.map(run => `M ${fixed(run.x1)} ${fixed(y - tick)} L ${fixed(run.x1)} ${fixed(y)} M ${fixed(run.x2)} ${fixed(y)} L ${fixed(run.x2)} ${fixed(y - tick)}`)];
  };
  const pieces: string[] = [];
  if (brackets.inner === null) {
    const [left, right] = joins[0] <= joins[1] ? joins : [joins[1], joins[0]];
    const corner = Math.min(9 * markerScale, (right - left) / 2), rise = Math.min(8 * markerScale, corner);
    pieces.push(...bracketPath(brackets.ends[0], laneY, null), ...bracketPath(brackets.ends[1], laneY, null),
      `M ${fixed(left)} ${fixed(laneY)} L ${fixed(left)} ${fixed(runY - rise)}`,
      `Q ${fixed(left)} ${fixed(runY)} ${fixed(left + corner)} ${fixed(runY)}`,
      `L ${fixed(right - corner)} ${fixed(runY)}`,
      `Q ${fixed(right)} ${fixed(runY)} ${fixed(right)} ${fixed(runY - rise)}`,
      `L ${fixed(right)} ${fixed(laneY)}`);
  } else {
    const inner = brackets.inner, outer = inner === 0 ? 1 : 0;
    pieces.push(...bracketPath(brackets.ends[inner], laneY, null),
      `M ${fixed(joins[inner])} ${fixed(laneY)} L ${fixed(joins[inner])} ${fixed(runY)}`,
      ...bracketPath(brackets.ends[outer], runY, joins[inner]));
  }
  return { ...segment, lane, laneY: runY, d: pieces.join(' '), brackets: { ...brackets, joins, levels, runY } };
}

/** The boxes a routed counter-lane connector paints along, for text placement. */
export function counterLaneRouteBoxes(segment: BoundSegment, markerScale: number): Rect[] {
  const box = (x1: number, y1: number, x2: number, y2: number): Rect =>
    ({ x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) });
  const brackets = segment.brackets;
  if (!brackets?.levels || !brackets.joins || brackets.runY === undefined) {
    const points = [segment.from, { x: segment.from.x, y: segment.laneY! }, { x: segment.to.x, y: segment.laneY! }, segment.to];
    return points.slice(1).map((point, i) => box(points[i].x, points[i].y, point.x, point.y));
  }
  const tick = BRACKET_TICK * markerScale, [a, b] = brackets.joins, runY = brackets.runY;
  return [
    ...brackets.ends.map((end, index) => {
      const [x1, x2] = endHull(end), y = brackets.levels![index];
      const reach = brackets.inner !== null && brackets.inner !== index ? brackets.joins![brackets.inner] : x1;
      return box(Math.min(x1, reach), y - tick, Math.max(x2, reach), y);
    }),
    box(a, brackets.levels[0], a, runY), box(b, brackets.levels[1], b, runY),
    ...brackets.inner === null ? [box(a, runY, b, runY)] : []
  ];
}

// Connector text in marker units: the gap below the lowest line, and the rows a
// label may step down when no spot beside it is free.
const CONNECTOR_LABEL_GAP = 3;
const CONNECTOR_LABEL_ROWS = 3;

/** Where a bracketed connector's text may go, best first: under its lowest
 * line, centred under its own bracket's middle (an `end` label) or under the
 * middle of the run (the `relation` label); then that row half a label to
 * either side, the reading direction's first, and once more; for the relation, between the brackets above
 * the run; then beside its bracket's ends, at the bracket and then at the run,
 * out to two more label widths (beside the run's ends, at the run and then at
 * the brackets, for the relation); then one text row lower at a time. */
export function connectorLabelSpots(mark: Pick<BoundFallbackMark, 'connectorLabel' | 'nodeId' | 'textWidth' | 'textHeight'>,
  segment: BoundSegment, scale: number, direction: 'ltr' | 'rtl' = 'ltr'): Point[] {
  // Spots on the reading-direction side come first, so right to left reflects left to right.
  const reading = direction === 'rtl' ? -1 : 1;
  const brackets = segment.brackets!;
  const height = (mark.textHeight === undefined ? 24 : mark.textHeight + 4) * scale;
  const half = (mark.textWidth / 2 + 4) * scale, gap = CONNECTOR_LABEL_GAP * scale;
  const joins = brackets.joins!, levels = brackets.levels!, runY = brackets.runY!;
  const end = Math.max(0, brackets.ends.findIndex(candidate => candidate.nodeId === mark.nodeId));
  const outer = brackets.inner === null ? null : brackets.inner === 0 ? 1 : 0;
  const reach = (index: number): [number, number] => {
    const [x1, x2] = endHull(brackets.ends[index]);
    return index === outer ? [Math.min(x1, joins[brackets.inner!]), Math.max(x2, joins[brackets.inner!])] : [x1, x2];
  };
  const run: [number, number] = outer === null ? [Math.min(...joins), Math.max(...joins)] : reach(outer);
  const [x1, x2] = mark.connectorLabel === 'end' ? reach(end) : run;
  const x = mark.connectorLabel === 'end' ? (brackets.inner === end || outer === null ? joins[end] : (x1 + x2) / 2) : (x1 + x2) / 2;
  const bracketY = Math.min(...levels) - BRACKET_TICK * scale / 2;
  const besideY = mark.connectorLabel === 'end' ? [levels[end] - BRACKET_TICK * scale / 2, runY] : [runY, bracketY];
  const y = runY + (FALLBACK_STROKE_WIDTHS['counter-lane'].shadow / 2) * scale + gap + height / 2;
  return [
    { x, y }, { x: x + reading * half, y }, { x: x - reading * half, y },
    { x: x + reading * 2 * half, y }, { x: x - reading * 2 * half, y },
    ...mark.connectorLabel === 'relation' ? [{ x, y: bracketY }] : [],
    ...besideY.flatMap(at => [0, 1, 2].flatMap(step => {
      const after = { x: x2 + gap * 2 + (1 + 2 * step) * half, y: at }, before = { x: x1 - gap * 2 - (1 + 2 * step) * half, y: at };
      return reading > 0 ? [after, before] : [before, after];
    })),
    ...Array.from({ length: CONNECTOR_LABEL_ROWS }, (_, row) => ({ x, y: y + (row + 1) * height }))
  ];
}

/** Place one bracketed connector's text at its first free spot inside the
 * viewport and reserve it. Without one, a participant's text goes beside its
 * own label as a role does (placeFallbackMark); the relation's takes the free
 * spot that leaves the viewport least, else where it overlaps least. */
export function placeConnectorLabel(mark: BoundFallbackMark, segment: BoundSegment, scale: number,
  occupied: Rect[], viewport?: Rect, direction: 'ltr' | 'rtl' = 'ltr'): Point {
  const spots = connectorLabelSpots(mark, segment, scale, direction);
  const boxFor = (point: Point) => fallbackLabelRect({ ...mark, ...point }, scale);
  const protrusion = (point: Point) => {
    if (!viewport) return 0;
    const box = boxFor(point);
    return Math.max(0, viewport.x - box.x, viewport.y - box.y,
      box.x + box.width - viewport.x - viewport.width, box.y + box.height - viewport.y - viewport.height);
  };
  const overlap = (point: Point) => Math.max(0, ...occupied.map(other => overlapDepth(boxFor(point), other)));
  const free = spots.filter(point => overlap(point) <= 0.5);
  // A connector Fit leaves near the viewport's edge keeps its text as far inside as it can.
  const inside = free.find(point => protrusion(point) === 0);
  // A participant's text with no room there returns beside its own label.
  if (!inside && viewport && mark.connectorLabel === 'end') return placeFallbackMark(mark, scale, occupied, viewport, direction);
  const chosen = inside
    ?? free.reduce<Point | undefined>((best, point) => !best || protrusion(point) < protrusion(best) ? point : best, undefined)
    ?? [...spots].sort((a, b) => overlap(a) - overlap(b) || protrusion(a) - protrusion(b))[0];
  occupied.push(boxFor(chosen));
  return chosen;
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
  const extent = (segment: UnroutedFallbackSegment): [number, number] => {
    const xs = segment.brackets ? bracketXs(segment.brackets) : [segment.from.x, segment.to.x];
    return [Math.min(...xs), Math.max(...xs)];
  };
  const lanes = allocateSpanLanes(counterSegments.map(segment => {
    const [start, end] = extent(segment);
    return { start, end };
  }), laneGap);
  // Brackets go below all painted syntax over them, labels and branches, so
  // they never cross it. Syntax a later step of the stage adds is not on screen
  // with them: a connector shows only at its own relation moment.
  const overBrackets = counterSegments.filter(segment => segment.brackets).flatMap(segment => {
    const [x1, x2] = extent(segment);
    const measured = options.fallbackMeasurements;
    return [...measured?.visibleLabels ?? measured?.labels ?? [], ...measured?.branches ?? []]
      .filter(box => box.x < x2 && box.x + box.width > x1).map(box => box.y + box.height);
  });
  const participantBottom = counterSegments.length > 0
    ? Math.max(...counterSegments.flatMap(segment => [segment.from.y, segment.to.y]), ...overBrackets) : 0;
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
  // Brackets stand one drop above their lane, so their ticks reach that much higher.
  const rise = counterSegments.some(segment => segment.brackets) ? (BRACKET_DROP + BRACKET_TICK) * markerScale - turn : 0;
  const deepestLane = Math.max(0, ...lanes) * laneGap;
  const crosses = (box: Rect, gap: number) => counterSegments.some(segment => box.x - gap < extent(segment)[1]
    && box.x + box.width + gap > extent(segment)[0]);
  // Only boxes above a bracket need the brackets' extra rise.
  const bracketHulls = counterSegments.flatMap(segment => segment.brackets?.ends.map(endHull) ?? []);
  const riseOver = (box: Rect, gap: number) => bracketHulls.some(([x1, x2]) => box.x - gap < x2 && box.x + box.width + gap > x1) ? rise : 0;
  const floorBelow = (labels: readonly Rect[]) => {
    let floor = localFloor;
    for (const { box, label } of [...(options.obstacles ?? []).map(box => ({ box, label: false })),
      ...labels.map(box => ({ box, label: true }))].sort((a, b) => a.box.y - b.box.y)) {
      if (!label && box.y - clearance <= floor + deepestLane && crosses(box, clearance))
        floor = Math.max(floor, box.y + box.height + clearance + riseOver(box, clearance));
      const above = label ? riseOver(box, labelClearance + stroke) : 0;
      if (label && box.y - labelClearance < floor + deepestLane + stroke
        && box.y + box.height + labelClearance > floor - turn - above - stroke && crosses(box, labelClearance + stroke))
        floor = box.y + box.height + labelClearance + turn + above + stroke;
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
    const lane = lanes[counterIndex++];
    if (segment.brackets) return routeBrackets(segment, lane, measuredBaseline + lane * laneGap, markerScale);
    const from = segment.from.x <= segment.to.x ? segment.from : segment.to;
    const to = from === segment.from ? segment.to : segment.from;
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

/** Place a connector's text against everything reserved, its own lines by their
 * painted width rather than the clearance other text keeps from them. */
export function placeConnectorLabelAmong(mark: BoundFallbackMark, segment: BoundSegment, scale: number, occupied: Rect[],
  own: ReadonlySet<Rect> | undefined, viewport?: Rect, direction: 'ltr' | 'rtl' = 'ltr'): Point {
  const lines = counterLaneRouteBoxes(segment, scale).map(box => inflateRect(box, FALLBACK_STROKE_WIDTHS['counter-lane'].shadow / 2 * scale));
  const others = [...own ? occupied.filter(box => !own.has(box)) : occupied, ...lines];
  const point = placeConnectorLabel(mark, segment, scale, others, viewport, direction);
  occupied.push(others.at(-1)!);
  return point;
}

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
  // around long text or allowing later role labels to cover its stems. A
  // bracketed connector's own text keeps only its painted width from its lines.
  const ownRoutes = new Map<number, Set<Rect>>();
  for (const segment of routed) {
    const boxes = counterLaneRouteBoxes(segment, scale).map(box => inflateRect(box, ROUTE_CLEARANCE * scale));
    occupied.push(...boxes);
    ownRoutes.set(segment.itemIndex, new Set(boxes));
  }
  const bracketed = new Map(routed.filter(segment => segment.brackets).map(segment => [segment.itemIndex, segment]));
  const updates = new Map<BoundFallbackMark | BoundSegment | BoundAnchorSetRail, BoundFallbackMark | BoundSegment | BoundAnchorSetRail>();
  const centers = new Map<number, Point>();
  frame.primitives.filter((mark): mark is BoundFallbackMark => mark.type === 'fallback-mark')
    .sort((a, b) => a.allocationOrder - b.allocationOrder).forEach(mark => {
      const segment = mark.connectorLabel ? bracketed.get(mark.itemIndex) : undefined;
      const point = segment ? placeConnectorLabelAmong(mark, segment, scale, occupied, ownRoutes.get(mark.itemIndex),
        options.fittedViewport, options.direction)
        : placeFallbackMark(mark, scale, occupied, options.fittedViewport, options.direction);
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
