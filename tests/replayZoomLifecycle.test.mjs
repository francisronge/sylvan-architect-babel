import * as d3 from 'd3';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { applyCameraTransform, createFittedCamera } from '../components/renderer/cameraFitting.ts';
import { installCameraInteraction } from '../components/renderer/cameraInteraction.ts';
import { rethrowViewError } from '../components/viewErrorHandling.ts';
import { createSvgDom } from './helpers/svgDom.mjs';

const { Element, restore } = createSvgDom();
after(restore);

const setup = () => {
  const behavior = d3.zoom().extent([[0, 0], [1000, 800]]).touchable(false);
  const svg = new Element('svg');
  svg.clientLeft = 0; svg.clientTop = 0;
  const camera = { current: null }, data = {};
  const effects = { revealsFinished: 0, lightRefreshes: 0 };
  const bind = group => {
    const session = {
      cameraRuntime: { applying: false, cancel: undefined, deferred: null },
      cameraAnimationRef: { current: null }, activeStepIndex: 0,
      svg: d3.select(svg), zoom: behavior, manualCameraRef: camera,
      data, derivationStagesSignature: 'same stages', containerWidth: 1000, containerHeight: 800,
      reportViewError: rethrowViewError
    };
    const zoom = installCameraInteraction(session, group, {
      finishCollectionReveal: () => effects.revealsFinished++,
      refreshIdentityForestLight: () => effects.lightRefreshes++
    });
    return { zoom, applyCameraTransform: transform => applyCameraTransform(session, transform) };
  };
  const group = () => d3.select(new Element('g'));
  const wheel = () => svg.handlers.wheel.call(svg, { type: 'wheel', deltaY: -100, deltaMode: 0,
    clientX: 200, clientY: 200, preventDefault() {}, stopImmediatePropagation() {} });
  return { svg, camera, bind, group, wheel, effects };
};

test('an active wheel gesture uses the new Replay frame handler after redraw', async () => {
  const { svg, camera, bind, group, wheel, effects } = setup();
  const first = group(), next = group();
  const { zoom: firstBehavior } = bind(first);
  const ended = new Promise(resolve => firstBehavior.on('end.test', resolve));
  wheel();
  assert.equal(effects.revealsFinished, 1, 'manual zoom finishes an in-flight collector reveal');
  assert.equal(effects.lightRefreshes, 1, 'manual zoom invalidates static lighting');
  const before = d3.zoomTransform(svg);
  assert(before.k > 1);
  const { zoom: nextBehavior, applyCameraTransform } = bind(next);
  assert.equal(nextBehavior, firstBehavior, 'the gesture dispatcher belongs to the SVG, not a frame');
  applyCameraTransform(before);
  assert.equal(effects.revealsFinished, 1, 'automatic fitting must not end the reveal');
  assert.equal(effects.lightRefreshes, 2, 'automatic fitting also updates light positions');
  assert.equal(next.attr('transform'), String(before));
  const later = before.translate(10, 20);
  applyCameraTransform(later);
  assert.equal(next.attr('transform'), String(later));
  assert.equal(first.attr('transform'), String(before), 'the detached frame must not receive later camera updates');
  assert.deepEqual(camera.current.transform, before, 'programmatic updates must not become manual input');
  await ended;
});

for (const active of [true, false]) {
  test(`Fit restores automatic camera mode with a ${active ? 'live' : 'finished'} wheel gesture`, async () => {
    const { camera, bind, group, wheel } = setup();
    const current = group();
    const { zoom, applyCameraTransform } = bind(current);
    const ended = new Promise(resolve => zoom.on('end.test', resolve));
    wheel();
    assert(camera.current);
    if (!active) await ended;
    camera.current = null; // Fit button
    const fitted = d3.zoomIdentity.translate(30, 40).scale(0.3);
    applyCameraTransform(fitted);
    assert.equal(current.attr('transform'), String(fitted));
    assert.equal(camera.current, null, 'Fit must leave automatic framing enabled');
    const next = group();
    const nextFrame = bind(next);
    const nextFit = d3.zoomIdentity.translate(50, 60).scale(0.4);
    nextFrame.applyCameraTransform(nextFit);
    assert.equal(next.attr('transform'), String(nextFit));
    assert.equal(camera.current, null);
    wheel();
    assert(camera.current, 'later manual input must still take control');
    await new Promise(resolve => zoom.on('end.test', resolve));
  });
}

// While a resize settles or its new layout is prepared, the SVG already has its
// new size but the frame is still drawn for the earlier one.
test('manual wheel and pan during a held frame keep their pose once the resized frame is drawn', () => {
  for (const gesture of ['wheel', 'pan']) for (const phase of ['settling', 'replacement']) {
    const svg = new Element('svg');
    Object.assign(svg, { clientLeft: 0, clientTop: 0, clientWidth: 1400, clientHeight: 800 });
    const behavior = d3.zoom().extent([[0, 0], [1400, 800]]).touchable(false);
    const manual = { current: null }, data = {};
    const draw = width => {
      const session = {
        cameraRuntime: { applying: false, cancel: undefined, deferred: null }, cameraAnimationRef: { current: null },
        svg: d3.select(svg), svgRef: { current: svg }, zoom: behavior, manualCameraRef: manual, autoCameraRef: { current: null },
        animated: true, data, derivationStagesSignature: 'same stages', fitRevision: 0, activeStepIndex: 0,
        containerWidth: width, containerHeight: 800, reportViewError: rethrowViewError
      };
      const g = d3.select(new Element('g'));
      installCameraInteraction(session, g, {});
      const layout = { g, stagePlaqueContainmentBounds: null, stageFitContainmentBounds: null,
        fitLeft: 16, fitRight: width - 16, fitTop: 16, fitBottom: 784 };
      return () => createFittedCamera({ session, layout }).applyFittedCamera(d3.zoomIdentity.scale(0.3));
    };
    const fitHeldFrame = draw(1000);
    if (gesture === 'wheel') svg.handlers.wheel.call(svg, { type: 'wheel', deltaY: -100, deltaMode: 0,
      clientX: 200, clientY: 200, preventDefault() {}, stopImmediatePropagation() {} });
    else d3.select(svg).call(behavior.transform, d3.zoomIdentity.translate(240, 120).scale(0.5), null, { type: 'mousemove' });
    const pose = d3.zoomTransform(svg);
    assert.equal(manual.current.width, 1400, `${gesture} records the live SVG size, not the held frame's`);
    if (phase === 'replacement') {
      fitHeldFrame();
      assert.deepEqual(d3.zoomTransform(svg), pose, `${gesture}: a redraw of the held frame keeps the pose`);
    }
    draw(1400)();
    assert.deepEqual(d3.zoomTransform(svg), pose, `${gesture} during ${phase}: the resized frame keeps the pose`);
    svg.clientWidth = 1000;
    draw(1000)();
    assert.equal(d3.zoomTransform(svg).x, pose.x - 200, 'a later resize still keeps the view centre');
    assert.equal(d3.zoomTransform(svg).y, pose.y);
  }
});
