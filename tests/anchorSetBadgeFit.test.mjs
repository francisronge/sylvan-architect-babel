import * as d3 from 'd3';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { installCameraInteraction } from '../components/renderer/cameraInteraction.ts';
import { createFallbackPlacement } from '../components/renderer/fallbackDrawing.ts';
import { rethrowViewError } from '../components/viewErrorHandling.ts';
import { anchorSetBadgeOuterRadius, anchorSetBadgeRadius, markerScaleAtZoom, RELATION_BINDING_METRICS } from '../replay/rendererMetrics.ts';
import { bindAnchorSetBadges, bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { visiblePlanFrameItems } from '../replay/relations/relationFrame.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { createSvgDom, descendants } from './helpers/svgDom.mjs';

const { Element, restore } = createSvgDom();
after(restore);

const members = ['a', 'b', 'c', 'd', 'e'];
const compiled = compileRelationRenderPlan([{ statement: 'Test', stageRecord: 'Test',
  relations: [{ relation: 'Current forms', anchors: { verb: members }, values: { verbForm: members.map(() => 'past') } }],
  workspaceForest: members.map(id => ({ id, label: 'V', word: 'read' })) }]);
const plan = { ...compiled, frames: compiled.frames.map((frame, index) => index === 0
  ? { ...frame, items: visiblePlanFrameItems(compiled, 0, new Set([0])) } : frame) };
const positionFor = id => ({ x: members.indexOf(id) * 400, y: 0 });
const transform = node => {
  const [, x, y, scale] = node.attrs.transform.match(/^translate\(([^,]+),([^)]+)\) scale\(([^)]+)\)$/).map(Number);
  return { x, y, scale };
};

test('Fit re-places anchor-set badges for the scale it draws them at, and zoom keeps that spacing', () => {
  // The previous camera (zoom 1) paints the step; the stage's Fit zooms out to 0.5.
  const paintScale = markerScaleAtZoom(1), fitZoom = 0.5, fitScale = markerScaleAtZoom(fitZoom);
  const nominal = bindRelationPlanFrame(plan, 0, positionFor, { ...RELATION_BINDING_METRICS, markerScale: paintScale })
    .primitives.find(primitive => primitive.type === 'anchor-set-badge' && primitive.nodeId === 'b');
  // A label under b that its badge clears at the painting scale but not when drawn at the fitted one.
  const label = { x: nominal.x - 60, y: nominal.y + anchorSetBadgeOuterRadius() * paintScale + 4, width: 120, height: 40 };
  const options = { ...RELATION_BINDING_METRICS, markerScale: paintScale, badgeObstacles: [label] };
  const boundFrame = bindRelationPlanFrame(plan, 0, positionFor, options);
  const covers = ({ x, y }, scale) => {
    const r = anchorSetBadgeOuterRadius() * scale;
    return x + r > label.x && x - r < label.x + label.width && y + r > label.y && y - r < label.y + label.height;
  };
  const painted = boundFrame.primitives.find(primitive => primitive.type === 'anchor-set-badge' && primitive.nodeId === 'b');
  assert(!covers(painted, paintScale) && covers(painted, fitScale), 'the painting scale is the wrong reference for this Fit');

  const svg = d3.select(new Element('svg'));
  const zoom = d3.zoom().extent([[0, 0], [1600, 1000]]).touchable(false);
  const g = svg.append('g');
  installCameraInteraction({ svg, zoom, cameraRuntime: { applying: false, deferred: null },
    cameraAnimationRef: { current: null }, manualCameraRef: { current: null }, activeStepIndex: 0, data: {},
    derivationStagesSignature: 'stage', containerWidth: 1600, containerHeight: 1000, reportViewError: rethrowViewError }, g, {});
  const placement = createFallbackPlacement({
    fallbackMeasurements: { labels: [], obstacles: [], visibleLabels: [], visibleObstacles: [], labelFor: () => null, subtreeFor: () => null, bottom: 0 },
    boundFrame, markerScale: paintScale, badgeGap: RELATION_BINDING_METRICS.badgeGap, frameMaxNodeY: 0, animated: true,
    usesDerivationFrames: true, g, direction: 'ltr',
    placeAnchorSetBadges: scale => bindAnchorSetBadges(plan, 0, positionFor, { ...options, markerScale: scale })
  });
  const groups = new Map(boundFrame.primitives.flatMap(primitive => primitive.type === 'anchor-set-badge'
    ? [[primitive.nodeId, placement.drawBadge(primitive, g).node()]] : []));
  const rail = boundFrame.primitives.find(primitive => primitive.type === 'anchor-set-rail');
  placement.drawRail(rail, g);
  placement.fit(fitZoom, { x: 0, y: 0, width: 3200, height: 2000 });

  const fitted = transform(groups.get('b'));
  assert.equal(fitted.scale, fitScale, 'the badge is drawn at the fitted marker scale');
  assert(!covers(fitted, fitScale), `the fitted badge at ${fitted.y} clears the label`);
  const expected = bindAnchorSetBadges(plan, 0, positionFor, { ...options, markerScale: fitScale }).find(badge => badge.nodeId === 'b');
  assert.deepEqual([fitted.x, fitted.y], [expected.x, expected.y], 'it stands where the binder places it at that scale');
  assert.equal(expected.y, bindRelationPlanFrame(plan, 0, positionFor, { ...options, markerScale: fitScale })
    .primitives.find(primitive => primitive.type === 'anchor-set-badge' && primitive.nodeId === 'b').y, 'as binding the frame at that scale would');
  const stub = descendants(g.node()).find(node => (node.attrs.class || '').includes('babel-anchor-set-stub'));
  assert.match(stub.attrs.d, new RegExp(`M ${fitted.x} ${fitted.y + 9 * fitScale} V`), 'the join leaves the fitted badge');

  const drawn = [...groups.values()].map(node => node.attrs.transform);
  for (const k of [2, 0.1, fitZoom]) {
    svg.call(zoom.transform, d3.zoomIdentity.translate(30, -40).scale(k));
    assert.deepEqual([...groups.values()].map(node => node.attrs.transform), drawn,
      `manual zoom to ${k} keeps the fitted badges, which scale with the tree and its labels`);
  }
});

test('rails on bands 1 and 2 keep their joins on their painted badges through a Fit scale change and zoom', () => {
  // Three overlapping neutral lists take bands 0, 1 and 2 (anchorRailBands.ts).
  // Fit re-places each band's badges for the scale it draws them at, and each
  // rail's joins leave exactly those painted badges.
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const lists = [ids.slice(0, 5), ids.slice(1, 6), ids.slice(2, 7)];
  const stages = [{ statement: 'Test', stageRecord: 'Test',
    relations: lists.map((members, index) => ({ relation: `List ${index}`, anchors: { members } })),
    workspaceForest: ids.map(id => ({ id, label: 'V', word: 'read' })) }, { statement: 'Next', stageRecord: 'Next', relations: [],
    workspaceForest: ids.map(id => ({ id, label: 'V', word: 'read' })) }];
  const banded = compileRelationRenderPlan(stages);
  const items = visiblePlanFrameItems(banded, 1, null, null);
  assert.deepEqual(items.filter(item => item.kind === 'anchor-set').map(item => item.railBand ?? 0), [0, 1, 2]);
  const bandedPlan = { ...banded, frames: banded.frames.map((frame, index) => index === 1 ? { ...frame, items } : frame) };
  const at = id => ({ x: ids.indexOf(id) * 400, y: 0 });
  const paintScale = markerScaleAtZoom(1), fitZoom = 0.5, fitScale = markerScaleAtZoom(fitZoom);
  const nominal = bindRelationPlanFrame(bandedPlan, 1, at, { ...RELATION_BINDING_METRICS, markerScale: paintScale }).primitives
    .filter(primitive => primitive.type === 'anchor-set-badge' && primitive.nodeId === 'd');
  // A label under d's band-1 badge at the fitted scale, which Fit must clear.
  const band1 = nominal.find(badge => badge.stackIndex === 1);
  const label = { x: band1.x - 60, y: band1.y + anchorSetBadgeOuterRadius() * paintScale + 4, width: 120, height: 200 };
  const options = { ...RELATION_BINDING_METRICS, markerScale: paintScale, badgeObstacles: [label] };
  const boundFrame = bindRelationPlanFrame(bandedPlan, 1, at, options);

  const svg = d3.select(new Element('svg'));
  const zoom = d3.zoom().extent([[0, 0], [1600, 1000]]).touchable(false);
  const g = svg.append('g');
  installCameraInteraction({ svg, zoom, cameraRuntime: { applying: false, deferred: null },
    cameraAnimationRef: { current: null }, manualCameraRef: { current: null }, activeStepIndex: 0, data: {},
    derivationStagesSignature: 'stage', containerWidth: 1600, containerHeight: 1000, reportViewError: rethrowViewError }, g, {});
  const placement = createFallbackPlacement({
    fallbackMeasurements: { labels: [], obstacles: [], visibleLabels: [], visibleObstacles: [], labelFor: () => null, subtreeFor: () => null, bottom: 0 },
    boundFrame, markerScale: paintScale, badgeGap: RELATION_BINDING_METRICS.badgeGap, frameMaxNodeY: 0, animated: false,
    usesDerivationFrames: true, g, direction: 'ltr',
    placeAnchorSetBadges: scale => bindAnchorSetBadges(bandedPlan, 1, at, { ...options, markerScale: scale })
  });
  const badgeNodes = new Map(boundFrame.primitives.flatMap(primitive => primitive.type === 'anchor-set-badge'
    ? [[primitive, placement.drawBadge(primitive, g).node()]] : []));
  const rails = boundFrame.primitives.filter(primitive => primitive.type === 'anchor-set-rail');
  assert.deepEqual(rails.map(rail => rail.lane), [0, 1, 2]);
  const stubs = rails.map(rail => {
    const host = g.append('g');
    placement.drawRail(rail, host);
    return descendants(host.node()).find(node => (node.attrs.class || '').includes('babel-anchor-set-stub'));
  });
  placement.fit(fitZoom, { x: 0, y: 0, width: 3200, height: 2000 });

  const painted = badge => transform(badgeNodes.get(badge));
  const fittedBadges = bindAnchorSetBadges(bandedPlan, 1, at, { ...options, markerScale: fitScale });
  const moved = fittedBadges.find(badge => badge.nodeId === 'd' && badge.stackIndex === 1);
  assert.notEqual(moved.y - band1.y, (2 * RELATION_BINDING_METRICS.badgeGap) * (fitScale - paintScale),
    'the band-1 badge clears the label, so the nominal offset formula would miss it');
  const joins = () => stubs.map(stub => stub.attrs.d);
  rails.forEach((rail, index) => {
    const own = rail.anchors.map(anchor => painted(anchor));
    assert(own.every(at => at.scale === fitScale), `band ${index}: badges drawn at the fitted scale`);
    const expected = own.map(({ x, y }) => `M ${x} ${y + anchorSetBadgeRadius() * fitScale} V`);
    const segments = joins()[index].split(/(?=M )/).map(segment => segment.replace(/ V .*$/, ' V').trim());
    assert.deepEqual(segments, expected, `band ${index}: every join leaves its own painted badge`);
    rail.anchors.forEach((anchor, entry) => {
      const bound = fittedBadges.find(badge => badge.itemIndex === anchor.itemIndex && badge.nodeId === anchor.nodeId
        && badge.stackIndex === anchor.stackIndex);
      assert.deepEqual([own[entry].x, own[entry].y], [bound.x, bound.y], `band ${index}: the painted badge is the bound one`);
    });
  });
  const radius = anchorSetBadgeOuterRadius() * fitScale;
  const placed = [...badgeNodes.values()].map(transform);
  placed.forEach((left, index) => placed.slice(index + 1).forEach(right => assert(
    Math.abs(left.x - right.x) >= 2 * radius || Math.abs(left.y - right.y) >= 2 * radius, 'no two numerals overlap')));

  const settled = [[...badgeNodes.values()].map(node => node.attrs.transform), joins()];
  for (const k of [2, 0.1, fitZoom]) {
    svg.call(zoom.transform, d3.zoomIdentity.translate(30, -40).scale(k));
    assert.deepEqual([[...badgeNodes.values()].map(node => node.attrs.transform), joins()], settled,
      `manual zoom to ${k} keeps every band's badges and joins together`);
  }
});
