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
import { prepareSharedFeatureTextLayout, type PlaqueTextMeasure } from './plaqueTextLayout.ts';

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

/** Keep the index beside its label unless the binding path uses that side.
 * The cubic's y coordinates stay between its endpoints, so the upper index
 * clears above that interval and the lower index clears below. Glyph bounds
 * are baseline-relative in the same SVG space. Padding includes the existing
 * marker and index outlines; paths and node positions are not adjusted. */
export const operatorBindingIndexPoint = (
  label: Rect,
  glyph: Pick<Rect, 'y' | 'height'>,
  role: 'operator' | 'variable',
  direction: number,
  otherEndpointY: number
): Point => {
  const point = { x: label.x + label.width + 10, y: label.y + label.height * 0.72 };
  if (direction <= 0 || !Number.isFinite(glyph.y) || !(glyph.height > 0)) return point;
  const endpointY = label.y + label.height * (role === 'operator' ? 0.62 : 0.58);
  const arrowPaintHalfHeight = (4 + 1.15 / 2) * 11 / 10;
  const indexStrokeHalfWidth = 7 / 2;
  const clearance = arrowPaintHalfHeight + indexStrokeHalfWidth + 4;
  return { x: point.x, y: endpointY < otherEndpointY
    ? Math.min(point.y, endpointY - clearance - glyph.y - glyph.height)
    : Math.max(point.y, endpointY + clearance - glyph.y) };
};

/** Anti-locality's blocked bar cap: a horizontal stop at the endpoint. */
export const barCapPath = (endpoint: Point, halfWidth = 14): string => [
  `M ${fixed(endpoint.x - halfWidth)} ${fixed(endpoint.y)}`,
  `L ${fixed(endpoint.x + halfWidth)} ${fixed(endpoint.y)}`
].join(' ');

/** The native locality cross occupies a 34-unit square in tree coordinates. */
export const blockingCrossSegments = (point: Point, halfSize = 17): Array<{
  x1: number; y1: number; x2: number; y2: number;
}> => [-1, 1].map(direction => ({
  x1: point.x + direction * halfSize,
  y1: point.y - halfSize,
  x2: point.x - direction * halfSize,
  y2: point.y + halfSize
}));

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
const featureSharingVineControls = (start: Point, convergence: Point): [Point, Point] => {
  const spanY = convergence.y - start.y;
  const c1 = { x: start.x, y: start.y + spanY * 0.64 };
  const c2 = {
    x: convergence.x + (start.x - convergence.x) * 0.16,
    y: convergence.y - Math.max(22, spanY * 0.08)
  };
  return [c1, c2];
};

export const featureSharingVinePath = (start: Point, convergence: Point): string => {
  const [c1, c2] = featureSharingVineControls(start, convergence);
  return [
    `M ${fixed(start.x)} ${fixed(start.y)}`,
    `C ${fixed(c1.x)} ${fixed(c1.y)},`,
    `${fixed(c2.x)} ${fixed(c2.y)},`,
    `${fixed(convergence.x)} ${fixed(convergence.y)}`
  ].join(' ');
};

/** Keep accepted curves unless staggered bearer heights make them cross.
 * Delay their inward bend together, preserving endpoints and the shared plaque.
 * At full delay the curves share a starting level and retain horizontal order.
 * Returns each vine's bend: where its accepted curve begins below its start. */
const featureSharingVineBends = (starts: Point[], convergence: Point): Point[] => {
  const lowestY = Math.max(...starts.map(start => start.y));
  const ordered = [...starts].sort((a, b) => a.x - b.x);
  const delayed = (start: Point, delay: number): Point => ({ x: start.x, y: start.y + (lowestY - start.y) * delay });
  const xAtY = (start: Point, y: number): number => {
    if (y <= start.y) return start.x;
    const [c1, c2] = featureSharingVineControls(start, convergence);
    let low = 0, high = 1;
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const t = (low + high) / 2, u = 1 - t;
      const curveY = u ** 3 * start.y + 3 * u ** 2 * t * c1.y
        + 3 * u * t ** 2 * c2.y + t ** 3 * convergence.y;
      if (curveY < y) low = t; else high = t;
    }
    const t = (low + high) / 2, u = 1 - t;
    return u ** 3 * start.x + 3 * u ** 2 * t * c1.x
      + 3 * u * t ** 2 * c2.x + t ** 3 * convergence.x;
  };
  const crosses = (delay: number): boolean => ordered.some((left, index) => {
    const right = ordered[index + 1];
    if (!right || left.x === right.x) return false;
    const fromY = Math.max(left.y, right.y);
    const a = delayed(left, delay), b = delayed(right, delay);
    for (let sample = 0; sample < 64; sample += 1) {
      const y = fromY + (convergence.y - fromY) * sample / 64;
      if (xAtY(a, y) > xAtY(b, y) + 0.01) return true;
    }
    return false;
  });
  if (!crosses(0)) return starts;
  let low = 0, high = 1;
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const delay = (low + high) / 2;
    if (crosses(delay)) low = delay; else high = delay;
  }
  // A small margin avoids a near-tangent double stroke after coordinate rounding.
  const delay = Math.min(1, high + 0.08);
  return starts.map(start => delayed(start, delay));
};

/** A vine keeps the gap from another bearer's word that it keeps below its own. */
const VINE_WORD_CLEARANCE = 22;

type VineRoute = { d: string; points: Point[] };

const vineRoute = (start: Point, bend: Point, convergence: Point): VineRoute => {
  const curve = featureSharingVinePath(bend, convergence);
  const [c1, c2] = featureSharingVineControls(bend, convergence);
  return {
    d: bend.y === start.y ? curve
      : `M ${fixed(start.x)} ${fixed(start.y)} L ${fixed(bend.x)} ${fixed(bend.y)} ${curve.slice(curve.indexOf('C'))}`,
    points: [...(bend.y === start.y ? [] : [start]), ...sampleCubic(bend, c1, c2, convergence, 48)]
  };
};

/** The same vine passing beside a word in its way: an even sidestep with
 * vertical tangents to the word's side, straight past it, then the accepted
 * curve from below the word into the shared point. */
const vineRouteBeside = (start: Point, word: Rect, left: boolean, convergence: Point): VineRoute | null => {
  const x = left ? word.x - VINE_WORD_CLEARANCE : word.x + word.width + VINE_WORD_CLEARANCE;
  const top = word.y - VINE_WORD_CLEARANCE, bottom = word.y + word.height + VINE_WORD_CLEARANCE;
  const drop = top - start.y;
  // A sidestep steeper than one unit across per two down would read as a kink.
  if (drop < 2 * Math.abs(x - start.x) || bottom >= convergence.y) return null;
  const side = { c1: { x: start.x, y: start.y + drop / 2 }, c2: { x, y: top - drop / 2 }, end: { x, y: top } };
  const below = { x, y: bottom };
  const curve = featureSharingVinePath(below, convergence);
  const [c1, c2] = featureSharingVineControls(below, convergence);
  return {
    d: [`M ${fixed(start.x)} ${fixed(start.y)}`,
      `C ${fixed(side.c1.x)} ${fixed(side.c1.y)}, ${fixed(side.c2.x)} ${fixed(side.c2.y)}, ${fixed(x)} ${fixed(top)}`,
      `L ${fixed(x)} ${fixed(bottom)}`, curve.slice(curve.indexOf('C'))].join(' '),
    points: [...sampleCubic(start, side.c1, side.c2, side.end, 32), ...sampleCubic(below, c1, c2, convergence, 48)]
  };
};

const pointInRect = (point: Point, rect: Rect) => point.x > rect.x && point.x < rect.x + rect.width
  && point.y > rect.y && point.y < rect.y + rect.height;

const routeEnters = (points: Point[], rect: Rect): boolean => points.some((point, index) => {
  const previous = points[index - 1] ?? point;
  for (let step = 0; step <= 4; step += 1) {
    const t = step / 4;
    if (pointInRect({ x: previous.x + (point.x - previous.x) * t, y: previous.y + (point.y - previous.y) * t }, rect)) return true;
  }
  return false;
});

const segmentsCross = (a: Point, b: Point, c: Point, d: Point): boolean => {
  const side = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
};

/** Vines meet only at their shared point; samples near it are not compared. */
const routesCross = (a: VineRoute, b: VineRoute, convergence: Point): boolean => {
  const away = (points: Point[]) => points.filter(point => Math.hypot(point.x - convergence.x, point.y - convergence.y) > 4);
  const first = away(a.points), second = away(b.points);
  for (let i = 1; i < first.length; i += 1) for (let j = 1; j < second.length; j += 1) {
    if (segmentsCross(first[i - 1], first[i], second[j - 1], second[j])) return true;
  }
  return false;
};

/** Vines are routed as a group from each bearer's word (`words`, aligned with
 * `starts`) to the shared point. A vine whose accepted route would run through
 * another bearer's word passes beside it instead, on the side that keeps the
 * group's horizontal order, when that keeps it clear of every word and every
 * other vine; otherwise it keeps its accepted route. Endpoints, convergence and
 * the shared plaque never move, and vines clear of words keep their paths. */
export const featureSharingVinePaths = (starts: Point[], convergence: Point, words: Array<Rect | null> = []): string[] => {
  const bends = featureSharingVineBends(starts, convergence);
  const routes = starts.map((start, index) => vineRoute(start, bends[index], convergence));
  const others = (index: number) => words.filter((word, other): word is Rect => other !== index && Boolean(word));
  routes.forEach((route, index) => {
    const blocking = others(index).filter(word => routeEnters(route.points, word));
    if (!blocking.length) return;
    const left = Math.min(...blocking.map(rect => rect.x)), top = Math.min(...blocking.map(rect => rect.y));
    const word = { x: left, y: top, width: Math.max(...blocking.map(rect => rect.x + rect.width)) - left,
      height: Math.max(...blocking.map(rect => rect.y + rect.height)) - top };
    const beside = vineRouteBeside(starts[index], word, starts[index].x <= word.x + word.width / 2, convergence);
    if (!beside || others(index).some(rect => routeEnters(beside.points, rect))
      || routes.some((other, otherIndex) => otherIndex !== index && routesCross(beside, other, convergence))) return;
    routes[index] = beside;
  });
  return routes.map(route => route.d);
};

/** The convergence point of a vine set: mean bearer x, below the lowest. */
export const vineConvergence = (bearerRects: Rect[]): Point => ({
  x: bearerRects.reduce((sum, rect) => sum + rect.x + rect.width / 2, 0) / bearerRects.length,
  y: Math.max(...bearerRects.map((rect) => rect.y + rect.height)) + 156
});

/** Native plaque footprints are shared by painting and the stage camera reservation. */
/** A measure represents one immutable font state, so a label's plaque size is
 * laid out once per measure; allocation and the camera ask for it in every scene. */
const sharedFeatureSizes = new WeakMap<PlaqueTextMeasure | typeof unmeasured, Map<string, { width: number; height: number }>>();
const unmeasured = {};
const sharedFeatureSize = (label: string, measureText?: PlaqueTextMeasure) => {
  const key = measureText ?? unmeasured;
  let sizes = sharedFeatureSizes.get(key);
  if (!sizes) sharedFeatureSizes.set(key, sizes = new Map());
  let size = sizes.get(label);
  if (!size) {
    const { width, height } = prepareSharedFeatureTextLayout(label, measureText);
    sizes.set(label, size = { width, height });
  }
  return size;
};

export const featureSharingPlaqueRect = (bearerRects: Rect[], label = '', measureText?: PlaqueTextMeasure): Rect => {
  const convergence = vineConvergence(bearerRects);
  const { width, height } = sharedFeatureSize(label, measureText);
  return { x: convergence.x - width / 2, y: convergence.y + 10, width, height };
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

/** The control domain's dashed box around the domain's measured words. */
export const controlDomainBox = (domainWords: Rect): Rect => ({
  x: domainWords.x - 34, y: domainWords.y - 26, width: domainWords.width + 68, height: domainWords.height + 52
});

/** The painted control dependency, an orthogonal elbow: up from the top of the
 * control domain (or just above the controllee's label), across at the elbow,
 * then up to its arrowhead just below the controller's label. The renderer
 * draws it from measured labels; plaque allocation reserves it from estimated ones. */
export const controlDependencyRoute = (controller: Rect, controllee: Rect, domain: Rect | null): Point[] => {
  const controllerCentre = { x: controller.x + controller.width / 2, y: controller.y + controller.height / 2 };
  const controlleeCentre = { x: controllee.x + controllee.width / 2, y: controllee.y + controllee.height / 2 };
  const source = {
    x: domain ? clamp(controlleeCentre.x, domain.x + 12, domain.x + domain.width - 12) : controlleeCentre.x,
    y: domain ? domain.y : controllee.y - 12
  };
  const elbowY = Math.max(controllerCentre.y + 128, Math.min(controlleeCentre.y - 92,
    controllerCentre.y + Math.abs(controlleeCentre.y - controllerCentre.y) * 0.58));
  return [source, { x: source.x, y: elbowY }, { x: controllerCentre.x, y: elbowY },
    { x: controllerCentre.x, y: controller.y + controller.height + 40 }];
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
): Point[] => {
  const points: Point[] = new Array(Math.max(0, Math.floor(samples + 1)) || 0);
  for (let index = 0; index < points.length; index++) {
    const t = index / samples;
    const u = 1 - t;
    points[index] = {
      x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
      y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y
    };
  }
  return points;
};

/**
 * A downward nesting arc for the strong-NPI containment curves: bows beneath
 * the anchored labels, deeper for outer nests.
 */
export const nestedUnderArcPath = (
  startX: number,
  endX: number,
  baseY: number,
  depth: number,
  endY = baseY
): string => [
  `M ${fixed(startX)} ${fixed(baseY)}`,
  `Q ${fixed((startX + endX) / 2)} ${fixed(Math.max(baseY, endY) + depth)}`,
  `${fixed(endX)} ${fixed(endY)}`
].join(' ');

/** The idiom interpretation bracket beneath the domain. */
export const domainBracketPath = (x1: number, x2: number, y: number, lip = 12): string => [
  `M ${fixed(x1)} ${fixed(y - lip)}`,
  `L ${fixed(x1)} ${fixed(y)}`,
  `L ${fixed(x2)} ${fixed(y)}`,
  `L ${fixed(x2)} ${fixed(y - lip)}`
].join(' ');

/** Fit the idiom's right bracket once, then keep it in its domain's SVG space. */
export const idiomDomainBracketPath = (domain: Rect, viewportRight = Infinity): string | null => {
  if (![domain.x, domain.y, domain.width, domain.height].every(Number.isFinite)
    || domain.width < 0 || domain.height < 0) return null;
  const domainRight = domain.x + domain.width;
  const top = domain.y - 80;
  const bottom = domain.y + domain.height + 80;
  const available = Number.isFinite(viewportRight) ? Math.max(0, viewportRight - domainRight) : 320;
  const gutter = Math.min(320, available);
  const bracketX = domainRight + gutter;
  const cap = Math.min(96, gutter);
  if (![bracketX, top, bottom].every(Number.isFinite)) return null;
  return [
    `M ${fixed(bracketX - cap)} ${fixed(top)}`,
    `H ${fixed(bracketX)}`,
    `V ${fixed(bottom)}`,
    `H ${fixed(bracketX - cap)}`
  ].join(' ');
};

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
