import * as d3 from 'd3';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { installCameraInteraction } from '../components/renderer/cameraInteraction.ts';
import { queueCopyDrawings } from '../components/renderer/copyDrawing.ts';
import { installRelationHitTargets } from '../components/renderer/relationInteraction.ts';
import { decorateRelationElement } from '../components/renderer/relationOwnership.ts';
import { rethrowViewError } from '../components/viewErrorHandling.ts';
import { createSvgDom, descendants } from './helpers/svgDom.mjs';

const { Element, restore } = createSvgDom();
after(restore);

const makeCamera = () => {
  const svg = d3.select(new Element('svg'));
  const zoom = d3.zoom().extent([[0, 0], [1000, 800]]).touchable(false);
  const session = {
    svg, zoom, cameraRuntime: { applying: false, deferred: null },
    cameraAnimationRef: { current: null }, manualCameraRef: { current: null },
    activeStepIndex: 0, data: {}, derivationStagesSignature: 'copy stage',
    containerWidth: 1000, containerHeight: 800, reportViewError: rethrowViewError
  };
  return {
    redraw: () => {
      svg.selectAll('g').remove();
      const frame = svg.append('g');
      installCameraInteraction(session, frame, {});
      return frame;
    },
    move: (k, x = 0, y = 0) => svg.call(zoom.transform, d3.zoomIdentity.translate(x, y).scale(k))
  };
};

const queueCopy = frame => {
  const draws = [];
  const anchors = {
    content: { x: 100, y: 100 }, ordinary: { x: 800, y: 600 }, parasitic: { x: 1000, y: 800 }
  };
  queueCopyDrawings({
    g: frame, deferredAcceptedRelationDraws: draws, decorateRelationElement,
    acceptedEnclosureRequests: [], acceptedPartialCopyStrikeRequests: [], acceptedDeletionTerminalStrikeRequests: [],
    acceptedParasiticGapCopyRequests: [{
      contentNodeId: 'content', ordinaryGapNodeId: 'ordinary', parasiticGapNodeIds: ['parasitic'],
      emphasis: 'active', item: { familyId: 'parasitic-gap.copy', relationRef: { stageIndex: 2, relationIndex: 1 } }
    }],
    resolveOverlayAnchor: id => anchors[id],
    measuredShellBottom: id => anchors[id], measuredShellTop: id => anchors[id]
  });
  return () => {
    draws.forEach(draw => draw());
    installRelationHitTargets(frame);
    return frame.select('.babel-pg-copy-fork-layer');
  };
};

const drawingSnapshot = layer => descendants(layer.node()).map(node => ({ tag: node.tag, attrs: { ...node.attrs } }));

test('deferred copy junctions use the fitted camera regardless of the camera before fitting', () => {
  let expected;
  for (const previousZoom of [0.1, 0.4, 1, 4]) {
    const camera = makeCamera();
    const frame = camera.redraw();
    camera.move(previousZoom, 37, 81);
    const paint = queueCopy(frame);
    camera.move(0.4, 120, 60);
    const layer = paint();
    const marker = layer.select('.vr-overlay-marker');
    assert.equal(marker.attr('transform'), 'translate(292,244) scale(2.5)');
    assert.deepEqual(marker.selectAll('circle').nodes().map(node => [node.attrs.cx, node.attrs.cy, node.attrs.r]), [
      ['0', '0', '9'], ['0', '0', '6.5'], ['0', '0', '9'], ['0', '0', '6.5']
    ], 'shadow, ring and their hit targets share one local coordinate group');
    assert.equal(layer.attr('data-vr-owner-refs'), '2:1');
    const snapshot = drawingSnapshot(layer);
    if (expected) assert.deepEqual(snapshot, expected);
    else expected = snapshot;
  }
});

test('copy junctions retain their anchor and capped screen size through zoom, pan and Replay redraw', () => {
  const camera = makeCamera();
  let frame = camera.redraw();
  camera.move(0.4);
  let layer = queueCopy(frame)();
  const marker = layer.select('.vr-overlay-marker');
  const circles = marker.selectAll('circle').nodes().map(node => ({ ...node.attrs }));
  const paths = layer.selectAll('path').nodes().map(node => ({ ...node.attrs }));

  for (const [k, x, y, scale] of [[2, 31, -70, 0.5], [2, -113, 42, 0.5], [0.1, 0, 20, 3], [0.5, 23, 41, 2]]) {
    camera.move(k, x, y);
    assert.equal(frame.attr('transform'), `translate(${x},${y}) scale(${k})`);
    assert.equal(marker.attr('transform'), `translate(292,244) scale(${scale})`);
    assert.equal(marker.attr('data-vr-x'), '292');
    assert.equal(marker.attr('data-vr-y'), '244');
    assert.deepEqual(marker.selectAll('circle').nodes().map(node => ({ ...node.attrs })), circles);
    assert.deepEqual(layer.selectAll('path').nodes().map(node => ({ ...node.attrs })), paths);
    assert.equal(Number(marker.select('.babel-pg-copy-ring').attr('r')) * scale * k, k < 1 / 3 ? 19.5 * k : 6.5);
  }

  const beforeRedraw = drawingSnapshot(layer);
  frame = camera.redraw();
  layer = queueCopy(frame)();
  assert.deepEqual(drawingSnapshot(layer), beforeRedraw, 'seeking back to the same drawing at the retained camera preserves its size');
  camera.move(1, 50, 60);
  assert.equal(layer.select('.vr-overlay-marker').attr('transform'), 'translate(292,244) scale(1)', 'the current frame receives subsequent camera events');
});
