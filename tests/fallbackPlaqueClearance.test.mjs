import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import {
  clearLabelPath, FALLBACK_STROKE_WIDTHS, fallbackLabelRect, fallbackMarkerScale, fitFallbackGeometry, routeFallbackSegments
} from '../replay/relations/fallbackGeometry.ts';

// Spokes are round-capped, so each stroke reaches half its width past a cut end.
const LINE_HALF_WIDTH = FALLBACK_STROKE_WIDTHS.direct.line / 2, SHADOW_HALF_WIDTH = FALLBACK_STROKE_WIDTHS.direct.shadow / 2;

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
  for (const spoke of spokes) {
    const drawn = pieces(spoke.d);
    const clearance = Math.min(...drawn.map(piece => segmentRectDistance(piece, plaque)));
    assert(clearance >= SHADOW_HALF_WIDTH * scale, `the connector's round-capped shadow stays off the plaque (${clearance.toFixed(2)})`);
    assert((clearance - LINE_HALF_WIDTH * scale) * fitZoom >= 2, 'at least two screen pixels separate the line from the plaque');
    // The gap is cut beside the plaque only; each end still joins its own role label.
    const [hub, target] = [spoke.fromMark, spoke.toMark].map(order => marks.find(mark => mark.allocationOrder === order));
    assert(pointRectDistance(drawn[0][0], fallbackLabelRect(hub, scale)) < 0.1);
    assert(pointRectDistance(drawn.at(-1)[1], fallbackLabelRect(target, scale)) < 0.1);
  }
  assert.equal(pieces(crossing.d).length, 2, 'the spoke continues on both sides of the plaque');
});

// Role labels may sit flush against a plaque. A spoke that only runs beside the
// plaque never meets it, so it must reach its own label without a new break.
for (const markerScale of [0.5, 1, 2, 3]) test(`a spoke running beside a plaque stays whole at marker scale ${markerScale}`, () => {
  const from = { x: 1000, y: 0 }, to = { x: 1004, y: 400 };
  const labels = [{ x: 960, y: -12, width: 80, height: 24 }, { x: 964, y: 388, width: 80, height: 24 }];
  const beside = { x: 1007, y: 14, width: 100, height: 86 };
  const [spoke] = routeFallbackSegments([{ type: 'segment', route: 'direct', witnessNodeIds: ['a', 'b'], from, to,
    directed: false, itemIndex: 0 }], { markerScale, labelClearances: labels, obstacles: [beside], occlusions: [beside] });
  assert(Math.min(...pieces(spoke.d).map(piece => segmentRectDistance(piece, beside))) > SHADOW_HALF_WIDTH * markerScale);
  assert.equal(spoke.d, clearLabelPath(from, to, labels));
  assert.equal(spoke.d, 'M 1000.1 12.0 L 1003.9 388.0');
});
