import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import {
  clearLabelPath, FALLBACK_STROKE_WIDTHS, fallbackLabelRect, fallbackMarkerScale, fitFallbackGeometry, routeFallbackSegments
} from '../replay/relations/fallbackGeometry.ts';

// Spokes are round-capped, so each stroke reaches half its width past a cut end.
const LINE_HALF_WIDTH = FALLBACK_STROKE_WIDTHS.direct.line / 2, SHADOW_HALF_WIDTH = FALLBACK_STROKE_WIDTHS.direct.shadow / 2;
// The closeout contract: a cut spoke leaves four marker units of dark space beyond its shadow.
const PLAQUE_GAP = SHADOW_HALF_WIDTH + 4;
// Path coordinates are written with one decimal.
const ROUNDING = 0.1;

const pieces = d => [...d.matchAll(/M ([\d.-]+) ([\d.-]+) L ([\d.-]+) ([\d.-]+)/g)]
  .map(match => match.slice(1).map(Number)).map(([x1, y1, x2, y2]) => [{ x: x1, y: y1 }, { x: x2, y: y2 }]);
const pointRectDistance = (p, r) => Math.hypot(Math.max(r.x - p.x, 0, p.x - r.x - r.width), Math.max(r.y - p.y, 0, p.y - r.y - r.height));
const segmentRectDistance = ([a, b], r) => {
  let enter = 0, leave = 1;
  for (const [origin, delta, min, max] of [[a.x, b.x - a.x, r.x, r.x + r.width], [a.y, b.y - a.y, r.y, r.y + r.height]]) {
    if (Math.abs(delta) < 1e-9) { if (origin < min || origin > max) { enter = 1; leave = 0; } continue; }
    const s = (min - origin) / delta, t = (max - origin) / delta;
    enter = Math.max(enter, Math.min(s, t)); leave = Math.min(leave, Math.max(s, t));
  }
  if (enter <= leave) return 0;
  // Closest approach of a straight piece to a rectangle is at a piece end or a rectangle corner.
  const corners = [[r.x, r.y], [r.x + r.width, r.y], [r.x, r.y + r.height], [r.x + r.width, r.y + r.height]];
  const toSegment = (x, y) => {
    const dx = b.x - a.x, dy = b.y - a.y, u = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - a.x - u * dx, y - a.y - u * dy);
  };
  return Math.min(pointRectDistance(a, r), pointRectDistance(b, r), ...corners.map(([x, y]) => toSegment(x, y)));
};
const clearance = (d, box) => Math.min(...pieces(d).map(piece => segmentRectDistance(piece, box)));
const routeSpoke = (from, to, { labels = [], plaques = [], markerScale = 1 } = {}) => routeFallbackSegments([{
  type: 'segment', route: 'direct', witnessNodeIds: ['a', 'b'], from, to, directed: false, itemIndex: 0
}], { markerScale, labelClearances: labels, obstacles: plaques, occlusions: plaques })[0].d;
const assertCutClear = (d, box, markerScale) => assert(clearance(d, box) >= PLAQUE_GAP * markerScale - ROUNDING,
  `a cut spoke keeps four marker units beyond its shadow (${clearance(d, box).toFixed(2)})`);

// A scalar domain and two referential expressions form a neutral fan, as in
// Binding Principle C on "Jean a fait réparer la voiture". A feature plaque sits
// between the domain and the first witness, so that spoke must pass it.
const nodes = { cp: { x: 1000, y: 0 }, np1: { x: 300, y: 1100 }, np2: { x: 1700, y: 1100 } };
const labels = Object.fromEntries(Object.entries(nodes).map(([id, p]) => [id, { x: p.x - 40, y: p.y - 56, width: 80, height: 52 }]));
const plaque = { x: 680, y: 470, width: 330, height: 100 };
const measurements = {
  labels: Object.values(labels), obstacles: [plaque], visibleLabels: Object.values(labels), visibleObstacles: [plaque],
  labelFor: id => labels[id], subtreeFor: id => labels[id], bottom: 1100
};
const stage = { statement: '', stageRecord: '', relations: [{ relation: 'Unfamiliar binding condition',
  anchors: { domain: 'cp', referentialExpressions: ['np1', 'np2'] } }],
workspaceForest: [{ id: 'cp', label: 'CP', children: [{ id: 'np1', label: 'NP' }, { id: 'np2', label: 'NP' }] }] };
const bound = bindRelationPlanFrame(compileRelationRenderPlan([stage]), 0, id => nodes[id] ?? null,
  { fallbackMeasurements: measurements, separateFallbackMoments: true });

// Automatic Fit chooses this tree's zoom from the viewport, from a phone to a 2560-pixel window.
for (const fitZoom of [0.12, 0.2, 0.3, 0.45, 0.6, 1]) test(`a neutral fan keeps a visible gap from a plaque it passes at Fit zoom ${fitZoom}`, () => {
  const scale = fallbackMarkerScale(fitZoom, measurements.labels.map(rect => rect.height));
  const fitted = [...fitFallbackGeometry(bound, { fittedMarkerScale: scale, fallbackMeasurements: measurements,
    separateFallbackMoments: true }).values()];
  const marks = fitted.filter(primitive => primitive.type === 'fallback-mark');
  const spokes = fitted.filter(primitive => primitive.type === 'segment' && primitive.route === 'direct');
  assert.equal(spokes.length, 2);
  const crossing = spokes.find(spoke => spoke.witnessNodeIds.includes('np1'));
  assert.equal(segmentRectDistance([crossing.from, crossing.to], plaque), 0, 'the undrawn straight spoke passes through the plaque');
  assertCutClear(crossing.d, plaque, scale);
  assert((clearance(crossing.d, plaque) - LINE_HALF_WIDTH * scale) * fitZoom >= 2, 'at least two screen pixels separate the line from the plaque');
  assert.equal(pieces(crossing.d).length, 2, 'the spoke continues on both sides of the plaque');
  for (const spoke of spokes) {
    assert(clearance(spoke.d, plaque) >= SHADOW_HALF_WIDTH * scale, 'no shadow reaches the plaque');
    // The gap is cut beside the plaque only; each end still joins its own role label.
    const drawn = pieces(spoke.d);
    const [hub, target] = [spoke.fromMark, spoke.toMark].map(order => marks.find(mark => mark.allocationOrder === order));
    assert(pointRectDistance(drawn[0][0], fallbackLabelRect(hub, scale)) < ROUNDING);
    assert(pointRectDistance(drawn.at(-1)[1], fallbackLabelRect(target, scale)) < ROUNDING);
  }
});

// Role labels may sit flush against a plaque. A spoke that only runs beside the
// plaque never meets it, so it must reach its own label without a new break.
for (const markerScale of [0.5, 1, 2, 3]) test(`a spoke running beside a plaque stays whole at marker scale ${markerScale}`, () => {
  const from = { x: 1000, y: 0 }, to = { x: 1004, y: 400 };
  const labels = [{ x: 960, y: -12, width: 80, height: 24 }, { x: 964, y: 388, width: 80, height: 24 }];
  const beside = { x: 1007, y: 14, width: 100, height: 86 };
  const d = routeSpoke(from, to, { labels, plaques: [beside], markerScale });
  assert(clearance(d, beside) > SHADOW_HALF_WIDTH * markerScale);
  assert.equal(d, clearLabelPath(from, to, labels));
  assert.equal(d, 'M 1000.1 12.0 L 1003.9 388.0');
});

test('a spoke passing a plaque corner beyond its shadow stays whole', () => {
  const corner = { x: 0, y: 0, width: 10, height: 10 };
  const d = routeSpoke({ x: -10, y: 7 }, { x: 7, y: -10 }, { plaques: [corner] });
  assert(clearance(d, corner) > SHADOW_HALF_WIDTH, 'the true distance to the corner is 2.12 marker units');
  assert.equal(d, 'M -10.0 7.0 L 7.0 -10.0');
});

test('plaque contact hidden beneath a role label does not break the visible spoke', () => {
  const label = { x: -20, y: -12, width: 40, height: 24 }, flush = { x: 20, y: -10, width: 10, height: 10 };
  const from = { x: 0, y: 0 }, to = { x: 100, y: -60 };
  const d = routeSpoke(from, to, { labels: [label], plaques: [flush] });
  assert.equal(d, clearLabelPath(from, to, [label]), 'the spoke still leaves its own label at (20, -12)');
  assert(clearance(d, flush) > SHADOW_HALF_WIDTH);
});

for (const markerScale of [0.5, 1, 3]) test(`a shallow crossing keeps the full gap at marker scale ${markerScale}`, () => {
  const wide = { x: 0, y: 0, width: 100, height: 20 };
  const from = { x: -50, y: -3 }, to = { x: 150, y: 5 };
  const d = routeSpoke(from, to, { plaques: [wide], markerScale });
  const drawn = pieces(d);
  assert.equal(drawn.length, 2);
  assert.deepEqual([drawn[0][0], drawn[1][1]], [from, to]);
  // Pulling back only the gap along a shallow spoke would leave it a fraction of a unit from the border.
  assertCutClear(d, wide, markerScale);
});

for (const markerScale of [0.5, 1, 3]) test(`a spoke starting inside a plaque begins the full gap outside it at marker scale ${markerScale}`, () => {
  const host = { x: 0, y: 0, width: 10, height: 10 };
  const d = routeSpoke({ x: 5, y: 5 }, { x: 100, y: 5 }, { plaques: [host], markerScale });
  assert.equal(pieces(d).length, 1);
  assertCutClear(d, host, markerScale);
});

test('close plaques leave no zero-length or dot-sized fragment between their gaps', () => {
  const from = { x: -50, y: 0 }, to = { x: 80, y: 0 };
  const first = { x: 0, y: -5, width: 10, height: 10 };
  for (const [secondX, expected] of [
    [21.62, 'M -50.0 0.0 L -5.8 0.0 M 37.4 0.0 L 80.0 0.0'],
    [22.6, 'M -50.0 0.0 L -5.8 0.0 M 38.4 0.0 L 80.0 0.0']
  ]) {
    const second = { ...first, x: secondX };
    const d = routeSpoke(from, to, { plaques: [first, second] });
    assert.equal(d, expected);
    for (const box of [first, second]) assertCutClear(d, box, 1);
  }
  const apart = { ...first, x: 30 };
  const d = routeSpoke(from, to, { plaques: [first, apart] });
  assert.equal(d, 'M -50.0 0.0 L -5.8 0.0 M 15.8 0.0 L 24.2 0.0 M 45.8 0.0 L 80.0 0.0', 'a real stretch between plaques remains');
  for (const box of [first, apart]) assertCutClear(d, box, 1);
});
