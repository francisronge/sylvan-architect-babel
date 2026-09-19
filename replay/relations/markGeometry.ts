/**
 * Accepted mark geometry, extracted as pure rules from the accepted relation
 * lab. No DOM, no React:
 * every function maps measured rectangles/points to SVG path data so the
 * accepted shapes can be tested exactly and drawn by any renderer.
 *
 * Nothing here invents a convention: each builder carries the constants the
 * accepted drawing uses — the phase open arc, the dependent-Case
 * orthogonal elbow with filled circular endpoints, the anti-locality bar cap
 * and licensed check, the feature-sharing vine control points, the solid
 * Case path with its quieter dotted collection curves, and the routed
 * agreement curves.
 */
import type { Point, Rect } from './overlayGeometry.ts';

const fixed = (value: number): string => value.toFixed(1);

/** The accepted domain arc: a quadratic bow between two baseline points. */
export const openArcPath = (
  startX: number,
  endX: number,
  baseY: number,
  controlRise: number
): string => [
  `M ${fixed(startX)} ${fixed(baseY)}`,
  `Q ${fixed((startX + endX) / 2)} ${fixed(baseY - controlRise)}`,
  `${fixed(endX)} ${fixed(baseY)}`
].join(' ');

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * The phase arc: an open arc whose visible apex sits immediately above the
 * phase-head label, its width taken from the head-to-edge span (or from the
 * domain when no edge is authored), with the accepted clamps.
 */
export const phaseArcPath = (
  phaseHeadRect: Rect,
  domainRect: Rect,
  edgeRect: Rect | null,
  primary: boolean
): string => {
  const phaseCenterX = phaseHeadRect.x + phaseHeadRect.width / 2;
  const edgeCenterX = edgeRect ? edgeRect.x + edgeRect.width / 2 : phaseCenterX;
  const spanWidth = Math.abs(edgeCenterX - phaseCenterX);
  const arcWidth = edgeRect
    ? clamp(spanWidth + 260, primary ? 430 : 360, primary ? 680 : 560)
    : clamp(domainRect.width * 0.52 + 190, primary ? 430 : 360, primary ? 640 : 540);
  const arcHeight = clamp(domainRect.height * 0.14 + 84, 122, primary ? 188 : 158);
  const startX = phaseCenterX - arcWidth / 2;
  const endX = phaseCenterX + arcWidth / 2;
  // A quadratic Bezier reaches half its control-point rise at the apex; the
  // visible apex sits immediately above the phase-head label.
  const visualApexY = phaseHeadRect.y - 6;
  const baseY = visualApexY + arcHeight / 2;
  return openArcPath(startX, endX, baseY, arcHeight);
};

/**
 * The dependent-Case (and feature-checking) orthogonal elbow: down from the
 * upper point, then across to the lower point. Endpoints are filled circles;
 * there is never an arrowhead.
 */
export const orthogonalElbowPath = (upper: Point, lower: Point): string => [
  `M ${fixed(upper.x)} ${fixed(upper.y)}`,
  `L ${fixed(upper.x)} ${fixed(lower.y)}`,
  `L ${fixed(lower.x)} ${fixed(lower.y)}`
].join(' ');

/** Source-backed remnant, roll-up, and smuggling trajectory. */
export const orthogonalTrajectoryPath = (
  start: Point,
  end: Point,
  laneY: number
): string => [
  `M ${start.x.toFixed(1)} ${start.y.toFixed(1)}`,
  `L ${start.x.toFixed(1)} ${laneY.toFixed(1)}`,
  `L ${end.x.toFixed(1)} ${laneY.toFixed(1)}`,
  `L ${end.x.toFixed(1)} ${end.y.toFixed(1)}`
].join(' ');

/**
 * Split antecedence keeps the source's anaphor-to-antecedent direction. The
 * links leave separate points on one hollow square and run below the terminal
 * row so they remain distinct from shell-to-shell Agree curves.
 */
export const splitAntecedenceLinkPath = (
  origin: Point,
  target: Point,
  linkIndex: number,
  linkCount: number,
  screenScale = 1
): string => {
  const safeScale = Number.isFinite(screenScale) && screenScale > 0 ? screenScale : 1;
  const localPx = (pixels: number) => pixels / safeScale;
  const startOffset = (linkIndex - (linkCount - 1) / 2) * localPx(8);
  const start = { x: origin.x + startOffset, y: origin.y + localPx(2) };
  const deltaX = target.x - start.x;
  const horizontalSpan = Math.abs(deltaX) * safeScale;
  const verticalSpan = Math.abs(target.y - start.y) * safeScale;
  const firstProgress = clamp(0.383 - verticalSpan * 0.000638, 0.268, 0.356);
  const secondProgress = clamp(0.1356 - verticalSpan * 0.000184, 0.102, 0.128);
  const bellyY = Math.max(start.y, target.y)
    + localPx(clamp(horizontalSpan * 0.11322 + 1.2, 26, 62));
  const firstControl = {
    x: start.x + deltaX * firstProgress,
    y: bellyY
  };
  const secondControl = {
    x: target.x - deltaX * secondProgress,
    y: bellyY - localPx(clamp(horizontalSpan * 0.02514 + 0.5, 6, 14))
  };
  return [
    `M ${fixed(start.x)} ${fixed(start.y)}`,
    `C ${fixed(firstControl.x)} ${fixed(firstControl.y)},`,
    `${fixed(secondControl.x)} ${fixed(secondControl.y)},`,
    `${fixed(target.x)} ${fixed(target.y)}`
  ].join(' ');
};

export const ELBOW_ENDPOINT_RADIUS = 9;

/** Anti-locality's blocked bar cap: a horizontal stop at the endpoint. */
export const barCapPath = (endpoint: Point, halfWidth = 14): string => [
  `M ${fixed(endpoint.x - halfWidth)} ${fixed(endpoint.y)}`,
  `L ${fixed(endpoint.x + halfWidth)} ${fixed(endpoint.y)}`
].join(' ');

/** The licensed check mark used opposite the bar cap. */
export const checkMarkPath = (point: Point, size = 12): string => [
  `M ${fixed(point.x - size)} ${fixed(point.y)}`,
  `L ${fixed(point.x - size * 0.28)} ${fixed(point.y + size * 0.72)}`,
  `L ${fixed(point.x + size)} ${fixed(point.y - size)}`
].join(' ');

/**
 * A feature-sharing vine: the accepted cubic from a bearer's terminal down to
 * the shared convergence point.
 */
export const featureSharingVinePath = (start: Point, convergence: Point): string => {
  const spanY = convergence.y - start.y;
  const c1 = { x: start.x, y: start.y + spanY * 0.64 };
  const c2 = {
    x: convergence.x + (start.x - convergence.x) * 0.16,
    y: convergence.y - Math.max(22, spanY * 0.08)
  };
  return [
    `M ${fixed(start.x)} ${fixed(start.y)}`,
    `C ${fixed(c1.x)} ${fixed(c1.y)},`,
    `${fixed(c2.x)} ${fixed(c2.y)},`,
    `${fixed(convergence.x)} ${fixed(convergence.y)}`
  ].join(' ');
};

/** The convergence point of a vine set: mean bearer x, below the lowest. */
export const vineConvergence = (bearerRects: Rect[]): Point => ({
  x: bearerRects.reduce((sum, rect) => sum + rect.x + rect.width / 2, 0) / bearerRects.length,
  y: Math.max(...bearerRects.map((rect) => rect.y + rect.height)) + 156
});

/** Native plaque footprints are shared by painting and the stage camera reservation. */
export const featureSharingPlaqueRect = (bearerRects: Rect[]): Rect => {
  const convergence = vineConvergence(bearerRects);
  return { x: convergence.x - 124, y: convergence.y + 10, width: 248, height: 92 };
};

export const dependentCaseStatePlaques = (
  probe: Rect, goal: Rect, probeLabel: string, goalLabel: string, step: string, probeIsHigher: boolean
): { probe: Rect; goal: Rect } => {
  const state = (anchor: Rect, label: string, minimumCentreY = -Infinity): Rect => {
    const width = Math.min(340, Math.max(190, label.length * 22 + 40));
    return { x: Math.max(38, anchor.x + anchor.width / 2 - width / 2),
      y: Math.max(anchor.y + anchor.height + 80, minimumCentreY) - 34, width, height: 68 };
  };
  const probeFirst = step === '1' || probeIsHigher;
  const first = state(probeFirst ? probe : goal, probeFirst ? probeLabel : goalLabel);
  const second = state(probeFirst ? goal : probe, probeFirst ? goalLabel : probeLabel,
    first.y + (step === '1' ? first.height / 2 + 96 : first.height + 72));
  return probeFirst ? { probe: first, goal: second } : { probe: second, goal: first };
};

/**
 * The solid Case-assignment path: the accepted cubic from beneath the
 * assigner toward the bearer-side target, bowing with the direction of
 * travel.
 */
export const caseAssignmentPath = (source: Point, target: Point): string => {
  const direction = target.x < source.x ? -1 : 1;
  const verticalSpan = Math.abs(target.y - source.y);
  const c1 = { x: source.x + direction * 32, y: source.y + Math.max(58, verticalSpan * 0.52) };
  const c2 = { x: target.x - direction * 76, y: target.y + 22 };
  return [
    `M ${fixed(source.x)} ${fixed(source.y)}`,
    `C ${fixed(c1.x)} ${fixed(c1.y)},`,
    `${fixed(c2.x)} ${fixed(c2.y)},`,
    `${fixed(target.x)} ${fixed(target.y)}`
  ].join(' ');
};

/**
 * The quieter dotted collection curve (Agree feeding Case): a laned cubic
 * between the plaque-side point and the goal. Orient its handles along the
 * main separation axis so nearby vertical anchors cannot produce an S-loop.
 */
export const dottedCollectionControls = (
  from: Point,
  to: Point,
  laneIndex = 0
): [Point, Point] => {
  const laneOffset = 68 + laneIndex * 24;
  const vertical = Math.abs(to.y - from.y) > Math.abs(to.x - from.x);
  const span = vertical ? to.y - from.y : to.x - from.x;
  const offset = Math.sign(span) * Math.min(laneOffset, Math.abs(span) / 2);
  return vertical
    ? [{ x: from.x, y: from.y + offset }, { x: to.x, y: to.y - offset }]
    : [{ x: from.x + offset, y: from.y }, { x: to.x - offset, y: to.y }];
};

export const dottedCollectionPath = (
  from: Point,
  to: Point,
  laneIndex = 0
): string => {
  const [c1, c2] = dottedCollectionControls(from, to, laneIndex);
  return [
    `M ${fixed(from.x)} ${fixed(from.y)}`,
    `C ${fixed(c1.x)} ${fixed(c1.y)},`,
    `${fixed(c2.x)} ${fixed(c2.y)},`,
    `${fixed(to.x)} ${fixed(to.y)}`
  ].join(' ');
};

/**
 * A routed agreement curve: probe to goal with a sideways belly so multiple
 * fan-out or cycle curves stay individually legible; the caller offsets the
 * belly per path index.
 */
export const routedAgreementControls = (
  from: Point,
  to: Point,
  pathIndex = 0
): [Point, Point] => {
  const direction = to.x >= from.x ? 1 : -1;
  const belly = 46 + pathIndex * 26;
  return [
    { x: from.x + direction * belly, y: from.y + belly * 0.7 },
    { x: to.x - direction * belly * 0.6, y: to.y - belly * 0.5 }
  ];
};

export const routedAgreementPath = (
  from: Point,
  to: Point,
  pathIndex = 0
): string => {
  const [c1, c2] = routedAgreementControls(from, to, pathIndex);
  return [
    `M ${fixed(from.x)} ${fixed(from.y)}`,
    `C ${fixed(c1.x)} ${fixed(c1.y)},`,
    `${fixed(c2.x)} ${fixed(c2.y)},`,
    `${fixed(to.x)} ${fixed(to.y)}`
  ].join(' ');
};

/**
 * A generic sweeping movement-style curve for directed dependencies.
 * `extraBelly` deepens the bow deterministically so coincident but distinct
 * authored paths separate instead of overlapping.
 */
export const sweepingCurveControl = (from: Point, to: Point, extraBelly = 0): Point => ({
  x: (from.x + to.x) / 2,
  y: (from.y + to.y) / 2 + Math.max(36, Math.abs(to.x - from.x) * 0.12) + extraBelly
});

export const sweepingCurvePath = (from: Point, to: Point, extraBelly = 0): string => {
  const control = sweepingCurveControl(from, to, extraBelly);
  return `M ${fixed(from.x)} ${fixed(from.y)} Q ${fixed(control.x)} ${fixed(control.y)}, ${fixed(to.x)} ${fixed(to.y)}`;
};

/** Sample a routed curve's real geometry for collision planning. */
export const sampleQuadratic = (from: Point, control: Point, to: Point, samples = 16): Point[] =>
  Array.from({ length: samples + 1 }, (_unused, index) => {
    const t = index / samples;
    const u = 1 - t;
    return {
      x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
      y: u * u * from.y + 2 * u * t * control.y + t * t * to.y
    };
  });

export const sampleCubic = (
  from: Point,
  c1: Point,
  c2: Point,
  to: Point,
  samples = 16
): Point[] =>
  Array.from({ length: samples + 1 }, (_unused, index) => {
    const t = index / samples;
    const u = 1 - t;
    return {
      x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
      y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y
    };
  });

/**
 * A downward nesting arc for the strong-NPI containment curves: bows beneath
 * the anchored labels, deeper for outer nests.
 */
export const nestedUnderArcPath = (
  startX: number,
  endX: number,
  baseY: number,
  depth: number
): string => openArcPath(startX, endX, baseY, -depth);

/** The idiom interpretation bracket beneath the domain. */
export const domainBracketPath = (x1: number, x2: number, y: number, lip = 12): string => [
  `M ${fixed(x1)} ${fixed(y - lip)}`,
  `L ${fixed(x1)} ${fixed(y)}`,
  `L ${fixed(x2)} ${fixed(y)}`,
  `L ${fixed(x2)} ${fixed(y - lip)}`
].join(' ');

/**
 * Fong's Transfer/PIC tilted component arc: the cubic that sweeps up and
 * across a component head (the Phase around its phase head, the SOD around
 * the spell-out domain head), with the accepted offsets — start below-left of
 * the head, end above-right, controls at 74% of the rise on the start side
 * and 24%/16% pull on the end side.
 */
export const fongComponentArcPath = (headRect: Rect): string => {
  const centerX = headRect.x + headRect.width / 2;
  const start = { x: centerX - 150, y: headRect.y + headRect.height + 50 };
  const end = { x: centerX + 125, y: headRect.y - 62 };
  const span = Math.max(1, end.x - start.x);
  const rise = Math.max(1, start.y - end.y);
  return [
    `M ${fixed(start.x)} ${fixed(start.y)}`,
    `C ${fixed(start.x)} ${fixed(start.y - rise * 0.74)}`,
    `${fixed(end.x - span * 0.24)} ${fixed(end.y - rise * 0.16)}`,
    `${fixed(end.x)} ${fixed(end.y)}`
  ].join(' ');
};

/** Where the Fong component's label sits, relative to its head rect. */
export const fongComponentLabelPoint = (headRect: Rect): Point => ({
  x: headRect.x + headRect.width / 2 + 125 + 18,
  y: headRect.y - 62 + 8
});

/** The accepted Phase-edge outline box around the edge label. */
export const fongEdgeOutlineRect = (edgeRect: Rect): Rect => {
  const width = Math.max(164, edgeRect.width + 76);
  const height = Math.max(86, edgeRect.height + 58);
  return {
    x: edgeRect.x + edgeRect.width / 2 - width / 2,
    y: edgeRect.y - 24,
    width,
    height
  };
};

/**
 * The blocked post-Transfer access attempt: the dashed orthogonal lane that
 * drops from the prober, runs beneath the transferred domain, and rises to
 * the target — with the accepted lane depth.
 */
export const transferAccessLanePath = (
  start: Point,
  end: Point,
  domainBottomY: number
): { d: string; laneY: number } => {
  const laneY = Math.max(domainBottomY + 64, start.y + 54, end.y + 160);
  return {
    laneY,
    d: [
      `M ${fixed(start.x)} ${fixed(start.y)}`,
      `L ${fixed(start.x)} ${fixed(laneY)}`,
      `L ${fixed(end.x)} ${fixed(laneY)}`,
      `L ${fixed(end.x)} ${fixed(end.y)}`
    ].join(' ')
  };
};

/**
 * Phillips island path-node marks: the primary path's circle is an ellipse
 * enclosing the node label; the secondary path's square is the padded
 * rectangle. Pads are the accepted 11×8.
 */
export const pathNodeEllipse = (labelRect: Rect): { cx: number; cy: number; rx: number; ry: number } => ({
  cx: labelRect.x + labelRect.width / 2,
  cy: labelRect.y + labelRect.height / 2,
  rx: labelRect.width / 2 + 11,
  ry: labelRect.height / 2 + 8
});

export const pathNodeSquare = (labelRect: Rect): Rect => ({
  x: labelRect.x - 11,
  y: labelRect.y - 8,
  width: labelRect.width + 22,
  height: labelRect.height + 16
});

/**
 * The double slash across the blocked finite-relative-clause edge: two
 * parallel cuts perpendicular to the branch into the blocked node, at 58% of
 * its run, offset ±28 along the branch, each 40 long.
 */
export const blockedEdgeDoubleSlash = (
  parent: Point,
  child: Point
): Array<{ x1: number; y1: number; x2: number; y2: number }> => {
  const tangent = { x: child.x - parent.x, y: child.y - parent.y };
  const magnitude = Math.hypot(tangent.x, tangent.y) || 1;
  const tangentUnit = { x: tangent.x / magnitude, y: tangent.y / magnitude };
  const normal = { x: -tangentUnit.y, y: tangentUnit.x };
  const centre = {
    x: parent.x + tangent.x * 0.58,
    y: parent.y + tangent.y * 0.58
  };
  return [-28, 28].map((offset) => {
    const midpoint = {
      x: centre.x + tangentUnit.x * offset,
      y: centre.y + tangentUnit.y * offset
    };
    return {
      x1: midpoint.x - normal.x * 20,
      y1: midpoint.y - normal.y * 20,
      x2: midpoint.x + normal.x * 20,
      y2: midpoint.y + normal.y * 20
    };
  });
};
