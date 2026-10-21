import * as d3 from 'd3';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { applyCameraTransform } from '../components/renderer/cameraFitting.ts';
import { installCameraInteraction } from '../components/renderer/cameraInteraction.ts';
import { rethrowViewError } from '../components/viewErrorHandling.ts';
import { CAMERA_ZOOM } from '../replay/rendererMetrics.ts';
import { createSvgDom } from './helpers/svgDom.mjs';

const { Element, restore } = createSvgDom();
after(restore);

function mount() {
  // The app's behaviour: TreeVisualizer creates it with the user extent.
  const behavior = d3.zoom().scaleExtent([...CAMERA_ZOOM.userZoomExtent]).extent([[0, 0], [390, 700]]).touchable(false);
  const svg = new Element('svg');
  svg.clientLeft = 0; svg.clientTop = 0;
  const session = {
    cameraRuntime: { applying: false, cancel: undefined, deferred: null },
    cameraAnimationRef: { current: null }, activeStepIndex: 0,
    svg: d3.select(svg), zoom: behavior, manualCameraRef: { current: null },
    data: {}, derivationStagesSignature: 'stages', containerWidth: 390, containerHeight: 700,
    reportViewError: rethrowViewError
  };
  installCameraInteraction(session, d3.select(new Element('g')), {});
  // One notch: d3 scales by 2^(-deltaY * 0.002), so ±100 is about ±15%.
  const wheel = deltaY => svg.handlers.wheel.call(svg, { type: 'wheel', deltaY, deltaMode: 0,
    clientX: 195, clientY: 350, preventDefault() {}, stopImmediatePropagation() {} });
  return { behavior, svg, wheel, apply: transform => applyCameraTransform(session, transform) };
}

const notch = 2 ** 0.2;
const near = (actual, expected) => assert(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);

for (const scale of [CAMERA_ZOOM.minimumFitScale.compact, 0.004]) {
  test(`a gesture continues from an applied ${scale} camera without snapping to the user zoom floor`, () => {
    assert(scale < CAMERA_ZOOM.userZoomExtent[0], 'the probe fit lies below the ordinary zoom floor');
    const out = mount();
    out.apply(d3.zoomIdentity.translate(100, 40).scale(scale));
    out.wheel(100);
    near(d3.zoomTransform(out.svg).k, scale);
    const into = mount();
    into.apply(d3.zoomIdentity.translate(100, 40).scale(scale));
    into.wheel(-100);
    near(d3.zoomTransform(into.svg).k, scale * notch);
  });
}

test('a later ordinary fit restores the user zoom floor', () => {
  const { behavior, svg, wheel, apply } = mount();
  apply(d3.zoomIdentity.scale(CAMERA_ZOOM.minimumFitScale.compact));
  apply(d3.zoomIdentity.translate(30, 20).scale(0.3));
  assert.deepEqual(behavior.scaleExtent(), [...CAMERA_ZOOM.userZoomExtent]);
  wheel(100);
  near(d3.zoomTransform(svg).k, 0.3 / notch);
  for (let i = 0; i < 40; i++) wheel(100);
  near(d3.zoomTransform(svg).k, CAMERA_ZOOM.userZoomExtent[0]);
});
