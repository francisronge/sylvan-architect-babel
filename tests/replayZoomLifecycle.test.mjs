import * as d3 from 'd3';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { applyCameraTransform } from '../components/renderer/cameraFitting.ts';
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
