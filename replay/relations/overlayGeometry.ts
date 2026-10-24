/**
 * Pure overlay geometry for the production relation render plan, promoted
 * from the accepted relation-lab geometry.
 * No DOM, no rendering: everything is exact arithmetic on points and
 * rectangles so the drawing rules can be tested adversarially.
 */

import { dottedCollectionControls, sampleCubic } from './markGeometry.ts';
import { rectsIntersect } from './rectGeometry.ts';

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

/** Where a Case arrow leaves its source, the side facing the plaque or a stem
 * from the top or bottom, and how far its bend reaches between the plain curve
 * (`bend` 0) and the full bounded bow (`bend` 1). Without an exit the arrow
 * takes the preferred one; `{ bend: 0 }` alone is the plain curve, which
 * Babel draws wherever it already bends visibly. */
export type CaseArrowExit = 'side' | 'stem';
const SIDE: CaseArrowExit = 'side', STEM: CaseArrowExit = 'stem';
/** `mirror` bows an aligned arrow toward the other side: a right-to-left Replay
 * reflects the left-to-right allocation, and its bent arrows must reflect too. */
export type CaseArrowRoute = { exit?: CaseArrowExit; bend: number; mirror?: boolean };
export const PLAIN_CASE_ROUTE: CaseArrowRoute = Object.freeze({ bend: 0 });

const caseArrowTarget = (assigner: Rect, plaque: Rect, rowY: number) => {
  const centerX = assigner.x + assigner.width / 2;
  return centerX < plaque.x
    ? { x: plaque.x - 12, y: rowY, side: 'left' }
    : centerX > plaque.x + plaque.width
      ? { x: plaque.x + plaque.width + 12, y: rowY, side: 'right' }
      : { x: centerX, y: assigner.y < plaque.y ? plaque.y - 12 : plaque.y + plaque.height + 12, side: 'vertical' };
};
const caseArrowSideX = (assigner: Rect, side: string) =>
  side === 'left' ? assigner.x + assigner.width + 8 : assigner.x - 8;

/** The exits a Case arrow may take to this plaque, preferred first. A row beside
 * the word must leave its side, not the space beneath it, which may already
 * belong to the next category label; a row within reach of the word counts as
 * beside it. A row within twice that reach can also take the side exit, whose
 * bend lies elsewhere, when that exit faces the row and its arrow is no longer. */
export function caseAssignmentExits(assigner: Rect, plaque: Rect, rowY: number): CaseArrowExit[] {
  const target = caseArrowTarget(assigner, plaque, rowY);
  if (target.side === 'vertical') return [STEM];
  const reach = Math.min(76, Math.abs(target.x - caseArrowSideX(assigner, target.side)) / 4);
  const offset = Math.max(assigner.y - rowY, rowY - assigner.y - assigner.height, 0);
  if (offset <= reach) return [SIDE];
  if (offset > 2 * reach) return [STEM];
  const outward = (target.side === 'left' ? 1 : -1) * (target.x - caseArrowSideX(assigner, target.side)) > 0;
  return outward && curveLength(caseAssignmentPlaqueCurve(assigner, plaque, rowY, { exit: 'side', bend: 1 }))
    <= curveLength(caseAssignmentPlaqueCurve(assigner, plaque, rowY, { exit: 'stem', bend: 1 })) ? [STEM, SIDE] : [STEM];
}

type Cubic = Record<'source' | 'control1' | 'control2' | 'target', Point>;
const curveLength = ({ source, control1, control2, target }: Cubic) => {
  const points = sampleCubic(source, control1, control2, target, 16);
  return points.slice(1).reduce((length, point, i) => length + Math.hypot(point.x - points[i].x, point.y - points[i].y), 0);
};

/** A Case arrow bends visibly when it leaves its chord by a tenth of the chord's
 * length, or by 30 units on a long arrow. */
export function caseArrowBendsVisibly({ source, control1, control2, target }: Cubic): boolean {
  const length = Math.hypot(target.x - source.x, target.y - source.y);
  const needed = Math.min(length / 10, 30);
  return sampleCubic(source, control1, control2, target, 64).some(point =>
    Math.abs((target.x - source.x) * (source.y - point.y) - (source.x - point.x) * (target.y - source.y)) >= needed * length);
}

const CASE_ARROW_BENDS = [0, 1, 0.75, 0.5, 0.25];

/** The visibly bent routes for an arrow whose plain curve runs too straight,
 * in the order the allocator tries them at a pocket: each exit's plain curve
 * where it bends visibly, its full bend, then shallower bends that still bend
 * visibly. A pocket keeps its plaque when any of them clears, and the placement
 * records the route it took. Later routes are built only when earlier ones are
 * blocked. */
export function* caseAssignmentRoutes(assigner: Rect, plaque: Rect, rowY: number): Generator<CaseArrowRoute> {
  for (const exit of caseAssignmentExits(assigner, plaque, rowY)) {
    let previous: Cubic | undefined;
    for (const bend of CASE_ARROW_BENDS) {
      const route = { exit, bend }, curve = caseAssignmentPlaqueCurve(assigner, plaque, rowY, route);
      // Where the plain curve already bends enough, every bend draws the same curve.
      if (previous && curve.control1.x === previous.control1.x && curve.control1.y === previous.control1.y
        && curve.control2.x === previous.control2.x && curve.control2.y === previous.control2.y) continue;
      if (bend !== 1 && !caseArrowBendsVisibly(curve)) continue;
      previous = curve;
      yield route;
    }
  }
}

/** The route Babel draws to an unobstructed pocket: the plain curve where it
 * bends visibly, otherwise the first bent route. */
export function caseAssignmentDrawnRoute(assigner: Rect, plaque: Rect, rowY: number): CaseArrowRoute {
  if (caseArrowBendsVisibly(caseAssignmentPlaqueCurve(assigner, plaque, rowY))) return PLAIN_CASE_ROUTE;
  for (const route of caseAssignmentRoutes(assigner, plaque, rowY)) return route;
  return { bend: 1 };
}

/** Enter the plaque from the assigner's side; the curve stays outside its
 * rectangle. The route defaults to the plain curve, by which the allocator also
 * ranks pockets. */
export function caseAssignmentPlaqueCurve(assigner: Rect, plaque: Rect, rowY: number,
  { exit = caseAssignmentExits(assigner, plaque, rowY)[0], bend, mirror }: CaseArrowRoute = PLAIN_CASE_ROUTE) {
  const route = { exit, bend };
  const centerX = assigner.x + assigner.width / 2;
  const target = caseArrowTarget(assigner, plaque, rowY);
  const direction = target.side === 'left' ? 1 : -1;
  const sideX = caseArrowSideX(assigner, target.side);
  // Every Case arrow bends. The handle that carries the bend is at least the
  // bounded bow, a quarter of the arrow's larger span up to 76; the plain
  // handle lays the curve along its chord when the row is level with a top or
  // bottom exit, when a narrow gap meets a tall label, or across a long aligned
  // gap. A shallower route moves each handle that part of the way back.
  const span = (source: Point) => Math.max(Math.abs(target.x - source.x), Math.abs(target.y - source.y));
  const bowFrom = (source: Point) => Math.min(76, span(source) / 4);
  const toward = (plain: number, full: number) => plain + route.bend * (full - plain);
  if (route.exit === 'side' && target.side !== 'vertical') {
    const source = { x: sideX, y: assigner.y + assigner.height / 2 };
    const dx = Math.abs(target.x - source.x);
    const bow = toward(Math.min(76, dx / 4), bowFrom(source));
    // A row high above or below a tall word turns within a third of its span,
    // which keeps a narrow gap's S-curve off its chord and clear of the word.
    const approach = toward(Math.min(76, dx / 2), Math.min(76, Math.max(dx / 2, span(source) / 3)));
    // Bend above the gap, clear of the category below.
    return { source, target, control1: { x: source.x + direction * approach, y: source.y - bow },
      control2: { x: target.x - direction * approach, y: target.y - bow } };
  }
  const up = target.y < assigner.y;
  const source = { x: centerX, y: up ? assigner.y - 8 : assigner.y + assigner.height + 8 };
  const bow = bowFrom(source);
  // The stem leaves in its exit direction, even toward a row level with it.
  const plainBendY = (target.y - source.y) / 2;
  const bendY = toward(plainBendY, (up ? -1 : 1) * Math.max(Math.abs(plainBendY), bow));
  // A nearly aligned side attachment still needs room to turn into the row.
  // Its vertical span must not collapse the curve into a stem and tiny hook.
  const approach = Math.min(76, span(source) / 2);
  const approachX = target.side === 'left' ? -approach : target.side === 'right' ? approach : 0;
  // Aligned boxes keep the curve wholly within their vertical gap.
  const bowX = (mirror ? -1 : 1) * (target.side === 'vertical'
    ? toward(Math.min(32, Math.abs(plainBendY)), Math.max(Math.min(32, Math.abs(bendY)), bow)) : 0);
  const approachY = target.side === 'vertical' ? source.y + bendY : target.y;
  return { source, target, control1: { x: source.x + bowX, y: source.y + bendY },
    control2: { x: target.x + approachX, y: approachY } };
}

export function caseAssignmentPlaquePath(assigner: Rect, plaque: Rect, rowY: number, route?: CaseArrowRoute): string {
  const { source, target, control1, control2 } = caseAssignmentPlaqueCurve(assigner, plaque, rowY, route);
  return `M ${source.x.toFixed(1)} ${source.y.toFixed(1)} C ${control1.x.toFixed(1)} ${control1.y.toFixed(1)},`
    + ` ${control2.x.toFixed(1)} ${control2.y.toFixed(1)}, ${target.x.toFixed(1)} ${target.y.toFixed(1)}`;
}

export type CollectionEdge = 'left' | 'right' | 'top' | 'bottom' | 'side';

/** Prefer a vertical edge only when the label is outside the box and mostly above/below it. */
export function featureCollectionEdge(plaque: Rect, rowY: number, sourceRect: Rect): CollectionEdge {
  const dx = sourceRect.x + sourceRect.width / 2 - plaque.x - plaque.width / 2;
  const dy = sourceRect.y + sourceRect.height / 2 - rowY;
  if (Math.abs(dy) > Math.abs(dx)) {
    if (sourceRect.y > plaque.y + plaque.height + 24) return 'bottom';
    if (sourceRect.y + sourceRect.height < plaque.y - 24) return 'top';
  }
  return dx >= 0 ? 'right' : 'left';
}

/** Keep Orchard handles and lane spacing; the reserved edge determines the attachment. */
export function featureCollectionPlaqueCurve(plaque: Rect, rowY: number, sourceRect: Rect, lane = 0,
  edge = featureCollectionEdge(plaque, rowY, sourceRect), portX?: number) {
  if (edge === 'side') edge = sourceRect.x + sourceRect.width / 2 >= plaque.x + plaque.width / 2 ? 'right' : 'left';
  const vertical = edge === 'top' || edge === 'bottom';
  const centerX = sourceRect.x + sourceRect.width / 2;
  const source = vertical
    ? { x: Math.max(plaque.x + 24, Math.min(plaque.x + plaque.width - 24, portX === undefined ? centerX : plaque.x + portX)),
      y: edge === 'bottom' ? plaque.y + plaque.height + 12 : plaque.y - 12 }
    : { x: edge === 'right' ? plaque.x + plaque.width + 12 : plaque.x - 12, y: rowY };
  const target = vertical
    ? { x: centerX, y: edge === 'bottom' ? sourceRect.y : sourceRect.y + sourceRect.height }
    : { x: edge === 'right' ? sourceRect.x : sourceRect.x + sourceRect.width,
      y: sourceRect.y + sourceRect.height / 2 };
  const [control1, control2] = dottedCollectionControls(source, target, lane);
  return { source, target, control1, control2 };
}

export function featureCollectionPlaquePath(plaque: Rect, rowY: number, sourceRect: Rect, lane = 0, edge?: CollectionEdge, portX?: number): string {
  const { source, target, control1, control2 } = featureCollectionPlaqueCurve(plaque, rowY, sourceRect, lane, edge, portX);
  return `M ${source.x.toFixed(1)} ${source.y.toFixed(1)} C ${control1.x.toFixed(1)} ${control1.y.toFixed(1)},`
    + ` ${control2.x.toFixed(1)} ${control2.y.toFixed(1)}, ${target.x.toFixed(1)} ${target.y.toFixed(1)}`;
}

export type AnalysisVerdictAnchor = {
  analysisNodeId: string;
  desiredY: number;
  order: number;
};

export type AnalysisVerdictRow<T extends AnalysisVerdictAnchor = AnalysisVerdictAnchor> = T & {
  y: number;
};

/**
 * Keeps verdicts tied to their own analysis anchors while separating rows by
 * a stable distance in the same tree coordinate system as their anchors.
 */
export const planAnalysisVerdictRows = <T extends AnalysisVerdictAnchor>(
  anchors: readonly T[],
  minimumTreeGap = 190
): Array<AnalysisVerdictRow<T>> => {
  let previousY = Number.NEGATIVE_INFINITY;
  return [...anchors]
    .sort((left, right) => (
      left.desiredY - right.desiredY
      || left.analysisNodeId.localeCompare(right.analysisNodeId, 'en-US')
      || left.order - right.order
    ))
    .map((anchor) => {
      const y = Math.max(anchor.desiredY, previousY + minimumTreeGap);
      previousY = y;
      return { ...anchor, y };
    });
};

/** Places the complete measured verdict in a lane immediately outside the
 * tree. The compound's right edge, rather than the star's origin, owns the
 * gap, so an optional label can never spill back into the syntax. */
export const analysisVerdictCompoundOrigin = (
  treeRect: Rect,
  compoundRect: Rect,
  desiredCenterY: number,
  treeGap = 24
): Point => ({
  x: treeRect.x - treeGap - compoundRect.x - compoundRect.width,
  y: desiredCenterY - compoundRect.y - compoundRect.height / 2
});

/** Word verdicts use terminal-sized type; judgment symbols retain their larger
 * Orchard glyph. Initial fitting may reduce either, but never enlarge them
 * relative to the syntax. Manual zoom keeps the compound together. */
export const analysisVerdictInitialLocalScale = (
  initialCameraScale: number,
  judgment = '*'
): number => Math.min(
  /\p{L}/u.test(judgment) ? 56 / 160 : 1,
  28 / (Math.max(0.001, initialCameraScale || 1) * 160)
);

const rectOverlapArea = (left: Rect, right: Rect): number => {
  const overlapWidth = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)
  );
  const overlapHeight = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)
  );
  return overlapWidth * overlapHeight;
};

/**
 * Keeps the preferred first rectangle untouched and moves only later
 * colliding rectangles downward in deterministic authored order.
 */
export const placeRectBelowCollisions = (
  preferred: Rect,
  occupied: Rect[],
  gap = 14,
  collisionGap = 10
): Rect => {
  let placed = { ...preferred };
  for (let attempt = 0; attempt < occupied.length + 1; attempt += 1) {
    const blockers = occupied.filter((rect) => rectsIntersect(placed, rect, collisionGap));
    if (blockers.length === 0) break;
    placed = {
      ...placed,
      y: Math.max(...blockers.map((rect) => rect.y + rect.height)) + gap
    };
  }
  return placed;
};

/**
 * Places a measured plate after earlier plates that share its anchor.
 * The first plate is untouched. Later plates prefer down, up, right, then
 * left; occupied-plate overlap takes priority over incidental obstacles.
 */
export const placeStackedRect = (
  preferred: Rect,
  occupied: Rect[],
  viewport: Rect,
  obstacles: Rect[] = [],
  gap = 18
): Rect => {
  if (occupied.length === 0) return { ...preferred };

  const viewportRight = viewport.x + viewport.width;
  const viewportBottom = viewport.y + viewport.height;
  const clamp = (candidate: Rect): Rect => ({
    ...candidate,
    x: Math.max(viewport.x, Math.min(candidate.x, viewportRight - candidate.width)),
    y: Math.max(viewport.y, Math.min(candidate.y, viewportBottom - candidate.height))
  });
  const minX = Math.min(...occupied.map((rect) => rect.x));
  const maxX = Math.max(...occupied.map((rect) => rect.x + rect.width));
  const minY = Math.min(...occupied.map((rect) => rect.y));
  const maxY = Math.max(...occupied.map((rect) => rect.y + rect.height));
  const candidates = [
    clamp({ ...preferred, y: maxY + gap }),
    clamp({ ...preferred, y: minY - preferred.height - gap }),
    clamp({ ...preferred, x: maxX + gap }),
    clamp({ ...preferred, x: minX - preferred.width - gap })
  ].filter((candidate, index, all) => all.findIndex((other) =>
    other.x === candidate.x && other.y === candidate.y) === index);
  const score = (candidate: Rect) => ({
    occupied: occupied.reduce((total, rect) => total + rectOverlapArea(candidate, rect), 0),
    obstacles: obstacles.reduce((total, rect) => total + rectOverlapArea(candidate, rect), 0)
  });

  return candidates.reduce((best, candidate) => {
    const bestScore = score(best);
    const candidateScore = score(candidate);
    if (candidateScore.occupied !== bestScore.occupied) {
      return candidateScore.occupied < bestScore.occupied ? candidate : best;
    }
    return candidateScore.obstacles < bestScore.obstacles ? candidate : best;
  });
};

/**
 * Deterministic lane allocation for horizontal spans.
 *
 * Spans are processed strictly in the order given; each takes the lowest lane
 * none of whose occupants it overlaps once both are padded by `minGap`. Same
 * input always yields the same lanes — no randomness, no dependence on
 * anything but the caller's own ordering.
 */
export const allocateSpanLanes = (
  spans: Array<{ start: number; end: number }>,
  minGap = 0
): number[] => {
  const lanes: Array<Array<{ start: number; end: number }>> = [];
  return spans.map((span) => {
    const start = Math.min(span.start, span.end) - minGap;
    const end = Math.max(span.start, span.end) + minGap;
    let laneIndex = lanes.findIndex((lane) =>
      lane.every((occupant) => end < occupant.start || start > occupant.end));
    if (laneIndex === -1) {
      laneIndex = lanes.length;
      lanes.push([]);
    }
    lanes[laneIndex].push({ start, end });
    return laneIndex;
  });
};

/**
 * Layout plan for large authored anchor arrays. The caller measures real node
 * rectangles after layout and passes them in through `rectFor`; nothing here
 * reads a DOM or guesses an endpoint. Every resolved anchor with measurable
 * geometry is placed — the plan never truncates, never keeps only a first
 * element, and never overwrites an earlier mark: marks that share a node
 * stack in deterministic traversal order. Anchors that cannot be placed are
 * returned in `failed` with a concrete reason. Rails are organizational, not
 * semantic: no arrowheads, no relation-specific styling; colliding rail
 * spans receive distinct lanes deterministically.
 */
export type AnchorSetLayoutInput = Array<{
  relation: string;
  instanceIndex: number;
  roles: Array<{
    role: string;
    large: boolean;
    anchors: Array<{ nodeId: string; arrayIndex: number; resolved: boolean }>;
  }>;
}>;

export type AnchorSetBadge = {
  setIndex: number;
  role: string;
  nodeId: string;
  arrayIndex: number;
  /** How many earlier badges already sit on this node; 0 is the first. */
  stackIndex: number;
  x: number;
  y: number;
};

export type AnchorSetRail = {
  setIndex: number;
  role: string;
  lane: number;
  x1: number;
  x2: number;
};

export type AnchorSetLayout = {
  badges: AnchorSetBadge[];
  rails: AnchorSetRail[];
  failed: Array<{ setIndex: number; role: string; nodeId: string; reason: string }>;
};

export const planAnchorSetLayout = (
  sets: AnchorSetLayoutInput,
  rectFor: (nodeId: string) => Rect | null,
  config: { badgeOffsetY?: number; railGap?: number } = {}
): AnchorSetLayout => {
  const badgeOffsetY = config.badgeOffsetY ?? 14;
  const railGap = config.railGap ?? 12;
  const badges: AnchorSetBadge[] = [];
  const failed: AnchorSetLayout['failed'] = [];
  const stackCounts = new Map<string, number>();
  const railSpans: Array<{ setIndex: number; role: string; start: number; end: number }> = [];

  sets.forEach((set, setIndex) => {
    set.roles.forEach((roleGroup) => {
      if (!roleGroup.large) return;
      const placed: AnchorSetBadge[] = [];
      roleGroup.anchors.forEach((anchor) => {
        if (!anchor.resolved) {
          failed.push({
            setIndex,
            role: roleGroup.role,
            nodeId: anchor.nodeId,
            reason: 'anchor does not resolve in its stage; mark fails closed'
          });
          return;
        }
        const rect = rectFor(anchor.nodeId);
        if (!rect) {
          failed.push({
            setIndex,
            role: roleGroup.role,
            nodeId: anchor.nodeId,
            reason: 'no measured geometry for the anchored node; mark fails closed'
          });
          return;
        }
        const stackIndex = stackCounts.get(anchor.nodeId) ?? 0;
        stackCounts.set(anchor.nodeId, stackIndex + 1);
        const badge: AnchorSetBadge = {
          setIndex,
          role: roleGroup.role,
          nodeId: anchor.nodeId,
          arrayIndex: anchor.arrayIndex,
          stackIndex,
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height + badgeOffsetY * (stackIndex + 1)
        };
        placed.push(badge);
        badges.push(badge);
      });
      if (placed.length >= 2) {
        railSpans.push({
          setIndex,
          role: roleGroup.role,
          start: Math.min(...placed.map((badge) => badge.x)),
          end: Math.max(...placed.map((badge) => badge.x))
        });
      }
    });
  });

  const lanes = allocateSpanLanes(railSpans, railGap);
  const rails: AnchorSetRail[] = railSpans.map((span, index) => ({
    setIndex: span.setIndex,
    role: span.role,
    lane: lanes[index],
    x1: span.start,
    x2: span.end
  }));

  return { badges, rails, failed };
};
