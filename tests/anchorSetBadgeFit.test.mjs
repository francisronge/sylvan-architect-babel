import * as d3 from 'd3';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { installCameraInteraction } from '../components/renderer/cameraInteraction.ts';
import { createFallbackPlacement } from '../components/renderer/fallbackDrawing.ts';
import { rethrowViewError } from '../components/viewErrorHandling.ts';
import { anchorSetBadgeOuterRadius, markerScaleAtZoom, RELATION_BINDING_METRICS } from '../replay/rendererMetrics.ts';
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
