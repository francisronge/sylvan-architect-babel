/**
 * Pure overlay geometry for the production relation render plan, promoted
 * from the accepted relation-lab geometry.
 * No DOM, no rendering: everything is exact arithmetic on points and
 * rectangles so the drawing rules can be tested adversarially.
 */

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

/** Enter the plaque from the assigner's side; the curve stays outside its rectangle. */
export function caseAssignmentPlaquePath(assigner: Rect, plaque: Rect, rowY: number): string {
  const centerX = assigner.x + assigner.width / 2;
  const target = centerX < plaque.x
    ? { x: plaque.x - 12, y: rowY, side: 'left' }
    : centerX > plaque.x + plaque.width
      ? { x: plaque.x + plaque.width + 12, y: rowY, side: 'right' }
      : { x: centerX, y: assigner.y < plaque.y ? plaque.y - 12 : plaque.y + plaque.height + 12, side: 'vertical' };
  const source = { x: centerX, y: target.y < assigner.y
    ? assigner.y - 8 : assigner.y + assigner.height + 8 };
  const bendY = (target.y - source.y) / 2;
  const approachX = target.side === 'left' ? -Math.min(76, Math.abs(target.x - source.x) / 2)
    : target.side === 'right' ? Math.min(76, Math.abs(target.x - source.x) / 2) : 0;
  // Aligned boxes still get a short curve wholly within their vertical gap.
  const bowX = target.side === 'vertical' ? Math.min(32, Math.abs(bendY)) : 0;
  const approachY = target.side === 'vertical' ? source.y + bendY : target.y;
  return `M ${source.x.toFixed(1)} ${source.y.toFixed(1)} C ${(source.x + bowX).toFixed(1)} ${(source.y + bendY).toFixed(1)},`
    + ` ${(target.x + approachX).toFixed(1)} ${approachY.toFixed(1)}, ${target.x.toFixed(1)} ${target.y.toFixed(1)}`;
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

/** Normalizes the verdict once against a card's initial camera fit. The
 * renderer keeps this local scale unchanged afterward, so manual zoom still
 * scales and moves the verdict with the syntax. */
export const analysisVerdictInitialLocalScale = (
  initialCameraScale: number,
  targetJudgmentScreenPx = 28,
  judgmentTreeSize = 160
): number => targetJudgmentScreenPx
  / (Math.max(0.001, initialCameraScale || 1) * judgmentTreeSize);

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
    const blockers = occupied.filter((rect) => !(
      placed.x + placed.width + collisionGap <= rect.x
      || rect.x + rect.width + collisionGap <= placed.x
      || placed.y + placed.height + collisionGap <= rect.y
      || rect.y + rect.height + collisionGap <= placed.y
    ));
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
