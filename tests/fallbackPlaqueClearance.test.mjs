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

for (const markerScale of [0.5, 1, 3]) test(`a spoke whose end lies inside a plaque stays attached at marker scale ${markerScale}`, () => {
  const host = { x: 0, y: 0, width: 10, height: 10 };
  assert.equal(routeSpoke({ x: 5, y: 5 }, { x: 100, y: 5 }, { plaques: [host], markerScale }), 'M 5.0 5.0 L 100.0 5.0');
});

test('a short piece still attached to a role label is kept', () => {
  const from = { x: 0, y: 0 }, to = { x: 100, y: 0 };
  const labels = [{ x: -20, y: -12, width: 40, height: 24 }, { x: 80, y: -12, width: 40, height: 24 }];
  for (const [plaque, expected] of [
    [{ x: 26.8, y: -5, width: 10, height: 10 }, 'M 20.0 0.0 L 21.0 0.0 M 42.6 0.0 L 80.0 0.0'],
    // Both one-unit end pieces remain, so the spoke never becomes an empty path.
    [{ x: 26.8, y: -5, width: 46.4, height: 10 }, 'M 20.0 0.0 L 21.0 0.0 M 79.0 0.0 L 80.0 0.0']
  ]) {
    const d = routeSpoke(from, to, { labels, plaques: [plaque] });
    assert.equal(d, expected);
    assertCutClear(d, plaque, 1);
  }
});

test('attachment wins over plaque clearance at a labelled end', () => {
  const from = { x: 0, y: 0 }, to = { x: 100, y: 0 };
  const labels = [{ x: -20, y: -12, width: 40, height: 24 }, { x: 80, y: -12, width: 40, height: 24 }];
  for (const [plaque, expected] of [
    // The gap would reach a label, so the plaque cuts only at its own edge.
    [{ x: 25, y: -5, width: 10, height: 10 }, 'M 20.0 0.0 L 25.0 0.0 M 35.0 0.0 L 80.0 0.0'],
    [{ x: 25, y: -5, width: 50, height: 10 }, 'M 20.0 0.0 L 25.0 0.0 M 75.0 0.0 L 80.0 0.0'],
    // Even the plaque's edge reaches the label, so the spoke stays uncut.
    [{ x: 15, y: -5, width: 10, height: 10 }, 'M 20.0 0.0 L 80.0 0.0']
  ]) assert.equal(routeSpoke(from, to, { labels, plaques: [plaque] }), expected);
});

// Every gap boundary in this sweep leaves end pieces that round to zero length.
test('attached end pieces stay drawable after coordinate rounding', () => {
  const from = { x: 0, y: 0 }, to = { x: 100, y: 0 };
  const labels = [{ x: -20, y: -12, width: 40, height: 24 }, { x: 80, y: -12, width: 40, height: 24 }];
  for (let i = 1; i <= 49; i++) {
    const x = 25.8 + i / 1000, drawn = pieces(routeSpoke(from, to, { labels, plaques: [{ x, y: -5, width: 100 - 2 * x, height: 10 }] }));
    assert(drawn[0][0].x === 20 && drawn[0][1].x > 20, `a drawn piece leaves the source label with the plaque at ${x}`);
    assert(drawn.at(-1)[1].x === 80 && drawn.at(-1)[0].x < 80, `a drawn piece reaches the target label with the plaque at ${x}`);
  }
});

for (const near of [{ x: 13, y: 15, width: 50, height: 30 }, { x: 13, y: 17.81, width: 50, height: 24.38 }])
test(`a placed spoke near plaque ${JSON.stringify(near)} stays attached to both role labels`, () => {
  const nodes = { a: { x: 0, y: 0 }, b: { x: 0, y: 60 }, c: { x: 200, y: 60 } };
  const syntax = Object.fromEntries(Object.entries(nodes).map(([id, p]) => [id, { x: p.x - 10, y: p.y - 10, width: 20, height: 20 }]));
  const measurements = { labels: Object.values(syntax), obstacles: [near], visibleLabels: Object.values(syntax),
    visibleObstacles: [near], labelFor: id => syntax[id], subtreeFor: id => syntax[id], bottom: 70 };
  const stage = { statement: '', stageRecord: '', relations: [{ relation: 'Unfamiliar relation', anchors: { h: 'a', p: ['b', 'c'] } }],
    workspaceForest: [{ id: 'a', label: 'A', children: [{ id: 'b', label: 'B' }, { id: 'c', label: 'C' }] }] };
  const bound = bindRelationPlanFrame(compileRelationRenderPlan([stage]), 0, id => nodes[id] ?? null,
    { fallbackMeasurements: measurements, separateFallbackMoments: true });
  const fitted = [...fitFallbackGeometry(bound, { fittedMarkerScale: 1, fallbackMeasurements: measurements,
    separateFallbackMoments: true }).values()];
  const marks = fitted.filter(primitive => primitive.type === 'fallback-mark');
  // Role placement treats rectangles within half a unit as touching, not overlapping.
  for (const mark of marks) {
    const role = fallbackLabelRect(mark, 1);
    assert(role.x + role.width <= near.x + 0.5 || near.x + near.width <= role.x + 0.5
      || role.y + role.height <= near.y + 0.5 || near.y + near.height <= role.y + 0.5, 'role labels avoid the plaque');
  }
  const spokes = fitted.filter(primitive => primitive.type === 'segment');
  for (const spoke of spokes) assert(pieces(spoke.d).length > 0, `spoke ${spoke.witnessNodeIds.join('→')} is drawn`);
  // The a→b spoke meets the plaque right below its hub label; it is cut only at the plaque's edges.
  const meeting = spokes.find(spoke => spoke.witnessNodeIds.includes('b')), drawn = pieces(meeting.d);
  const [hub, target] = [meeting.fromMark, meeting.toMark].map(order => marks.find(mark => mark.allocationOrder === order));
  assert(pointRectDistance(drawn[0][0], fallbackLabelRect(hub, 1)) < ROUNDING);
  assert(pointRectDistance(drawn.at(-1)[1], fallbackLabelRect(target, 1)) < ROUNDING);
  for (const [p, q] of [drawn[0], drawn.at(-1)]) assert(p.x !== q.x || p.y !== q.y, 'each attached piece has length');
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
