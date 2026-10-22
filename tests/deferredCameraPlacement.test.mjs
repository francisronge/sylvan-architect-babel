import * as d3 from 'd3';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createBindingRefinements } from '../components/renderer/bindingRefinements.ts';
import { deferredTreeMatrix, settledClientPoint } from '../components/renderer/cameraState.ts';
import { createPlaqueRefinements } from '../components/renderer/plaqueRefinements.ts';
import { fitOverlayToCompactViewport } from '../components/renderer/realizationDrawing.ts';
import { refineRelationGeometry } from '../components/renderer/relationRefinements.ts';
import { createSvgDom, Matrix } from './helpers/svgDom.mjs';

// A Replay step paints the start pose of its camera transition synchronously;
// placements made after the fit must use the pose the camera settles at.
const { Element, restore } = createSvgDom();
after(restore);

test('the deferred tree matrix composes the settled pose with the SVG, or is the live matrix before a fit', () => {
  const svg = new Element('svg');
  svg.getScreenCTM = () => new Matrix().translate(30, 10);
  const tree = new Element('g');
  const live = new Matrix().translate(400, 0).scale(2);
  tree.getScreenCTM = () => live;
  assert.deepEqual(deferredTreeMatrix(svg, tree, { x: 100, y: 50, k: 0.5 }),
    new Matrix(0.5, 0, 0, 0.5, 130, 60));
  assert.equal(deferredTreeMatrix(svg, tree, null), live);
  assert.deepEqual(settledClientPoint(live, new Matrix().translate(100, 50).scale(0.5))(500, 20),
    new DOMPoint(125, 55), 'a painted point is carried through tree space to its settled place');
});

test('a compact overlay is fitted where the settled camera will show it', () => {
  const layer = new Element('g');
  layer.rect = { left: 300, right: 380, top: 100, bottom: 160, width: 80, height: 60 };
  layer.getBBox = () => ({ x: 300, y: 100, width: 80, height: 60 });
  const viewport = { left: 0, top: 0, right: 390, bottom: 844, width: 390, height: 844 };
  // Painted inside the live viewport, it would lie past the right inset once the camera settles.
  fitOverlayToCompactViewport(layer, viewport, new Matrix(), new Matrix().translate(100, 0));
  assert.equal(layer.attrs.transform, 'translate(-102 0)');
  fitOverlayToCompactViewport(layer, viewport, new Matrix(), new Matrix().translate(100, 600).scale(2));
  assert.equal(layer.attrs.transform, 'translate(-241 -44)', 'the shift is expressed in tree units of the settled scale');
});

test('the idiom bracket clamps to the settled viewport while its underlines measure the painted terminals', () => {
  const root = new Element('g');
  const host = d3.select(root).append('g').attr('class', 'vr-item')
    .attr('data-vr-stage-index', '0').attr('data-vr-relation-index', '0');
  const layer = host.append('g').attr('class', 'babel-idiom-chunk-relation-layer');
  layer.append('path').attr('class', 'babel-idiom-domain-bracket').attr('data-idiom-domain', 'domain');
  for (const [i, id] of ['a', 'b'].entries()) {
    const terminal = d3.select(root).append('text').attr('class', 'terminal-label').attr('data-node-id', id).node();
    terminal.datum = { __vizId: id, data: { id } };
    terminal.getBoundingClientRect = () => ({ left: i * 100, right: i * 100 + 40, top: 100, bottom: 120 });
    host.append('g').attr('class', 'vr-idiom-chunk-anchor').attr('data-idiom-chunk', id);
  }
  const svg = new Element('svg');
  svg.rect = { left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 };
  const { refineIdiomChunkRelation: refine } = createBindingRefinements({
    g: d3.select(root), svg: d3.select(svg),
    measuredSubtreeRect: id => id === 'domain' ? { x: 0, y: 100, width: 300, height: 40 } : null,
    treeMatrix: new Matrix().translate(50, 0),
    settledTreeMatrix: new Matrix().translate(500, 0),
    postFitNodeById: new Map(['a', 'b'].map(id => [id, { descendants: () => [{ __vizId: id, data: { id } }] }]))
  });
  refine.call(layer.node());
  assert.deepEqual(layer.selectAll('.babel-idiom-chunk-underline').nodes().map(n => n.attrs.d),
    ['M -50.0 127.0 H -10.0', 'M 50.0 127.0 H 90.0']);
  // The settled right inset is at tree x 488, leaving a 188-unit gutter.
  assert.equal(layer.select('.babel-idiom-domain-bracket').attr('d'), 'M 392.0 20.0 H 488.0 V 220.0 H 392.0');
});

test('split-antecedence pieces take their screen size from the settled camera', () => {
  const root = new Element('g');
  const host = d3.select(root).append('g');
  const origin = host.append('rect').attr('class', 'babel-split-antecedence-origin')
    .attr('data-split-antecedence-origin-x', 100).attr('data-split-antecedence-origin-y', 200);
  const { refineSplitAntecedenceComposition } = createPlaqueRefinements({
    g: d3.select(root), deferredTreeMatrix: () => new Matrix().scale(0.5)
  });
  refineSplitAntecedenceComposition();
  assert.deepEqual([origin.attr('width'), origin.attr('x'), origin.attr('y')], ['20.0', '90.0', '202.0']);
});

test('analysis verdicts are laid out for the settled zoom, not the start of the transition', () => {
  const root = new Element('g');
  const g = d3.select(root);
  const treeData = d3.hierarchy({ id: 'root', label: 'TP', children: [] });
  treeData.__vizId = 'root';
  g.append('text').attr('class', 'category-label').attr('data-category-node-id', 'root').datum(treeData);
  const verdict = g.append('g').attr('class', 'babel-analysis-verdict').attr('data-analysis-verdict-anchor', 'root');
  verdict.append('text').attr('class', 'babel-analysis-judgment').text('*');
  verdict.append('text').attr('class', 'babel-analysis-verdict-text').text('*');
  const svg = new Element('svg');
  const settledZoom = 0.5;
  refineRelationGeometry({
    treeData, g, svg: d3.select(svg), relationRenderPlan: null, activeDerivationFrameIndex: 0,
    replayPlaqueLayout: new Map(), visibleNodes: treeData.descendants(), measureCategoryText: () => 20,
    deferredAcceptedRelationDraws: [], playedRelationIndices: null, updateScreenStableText() {},
    measureGraphicsElementsInTreeSpace: elements => elements.length ? { x: 0, y: 0, width: 200, height: 100 } : null,
    deferredTreeMatrix: () => new Matrix().scale(settledZoom)
  });
  // The live zoom is 1; a 28 px symbol at the settled zoom is 28 / (0.5 × 160) of its type size.
  assert.match(verdict.attr('transform'), / scale\(0\.350000\)$/);
});
