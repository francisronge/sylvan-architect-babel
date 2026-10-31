import * as d3 from 'd3';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after } from 'node:test';
import { createBindingRefinements } from '../components/renderer/bindingRefinements.ts';
import { createFittedCamera } from '../components/renderer/cameraFitting.ts';
import { createCaseFeatureDrawing } from '../components/renderer/caseFeatureDrawing.ts';
import { drawFallbackMark } from '../components/renderer/fallbackDrawing.ts';
import { createPlaqueDrawing } from '../components/renderer/plaqueDrawing.ts';
import { createPlaqueRefinements } from '../components/renderer/plaqueRefinements.ts';
import { withPlaqueTextMeasure } from '../components/renderer/plaqueText.ts';
import { createRelationOwnership, decorateRelationElement } from '../components/renderer/relationOwnership.ts';
import { createShapeDrawing } from '../components/renderer/shapeDrawing.ts';
import { alignReplayUnaryTerminalLeaves, appendOverlayMarker, hasTreeGapNotation } from '../components/renderer/treeNotation.ts';
import { applyVizIds } from '../replay/displayIdentity.ts';
import { caseFeatureComposition, featureRowKey, pathFeatureRow } from '../replay/relations/featureComposition.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { featureCollectionPlaquePath } from '../replay/relations/overlayGeometry.ts';
import {
  placeStagePlaques,
  prepareCollectionPlaqueSpace,
  prepareStagePlaqueRequests,
  projectPlaqueLayout
} from '../replay/relations/plaquePlacement.ts';
import { prepareCasePlaqueRows, preparePfPlaqueTextLayout } from '../replay/relations/plaqueTextLayout.ts';
import { assertSpells } from './helpers/spelledLines.mjs';
import { planItemRelationRefs } from '../replay/relations/renderPlan.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { buildRenderableDerivationCanvasData } from '../replay/replayCanvas.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import { buildStagePlaqueLayout, treeLayoutSize } from '../replay/stageCamera.ts';
import { blockedCollectionCases, blockedCollectionStage } from './helpers/blockedCollectionFixtures.mjs';
import { createCameraHarness } from './helpers/cameraHarness.mjs';
import { createSvgDom, descendants, matches, select } from './helpers/svgDom.mjs';

const graphemes = text => Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text),
  ({ segment }) => segment);
const measureText = (text, style) => ({
  width: graphemes(text).length * (style.fontSize * 0.6 + style.letterSpacing),
  ascent: style.fontSize * 0.8,
  descent: style.fontSize * 0.2
});

const { Element, restore } = createSvgDom(measureText);
after(restore);

test('the production Control connector lays out without a domain rectangle', () => {
  const layer = new Element('g');
  const path = select(layer).append('path').attr('class', 'babel-control-dependency')
    .attr('data-control-controller', 'controller').attr('data-control-controllee', 'subject');
  const rects = { controller: { x: 100, y: 100, width: 40, height: 30 }, subject: { x: 300, y: 300, width: 40, height: 30 } };
  const { refineControlRelation: refine } = createBindingRefinements({
    measuredTerminalSubtreesRect: () => null, measuredSubtreeRect: () => null,
    measuredAcceptedAnchorRect: id => rects[id]
  });
  refine.call(layer);
  assert.match(path.attr('d'), /^M 320\.0 288\.0 L /);
  assert(!path.attr('d').includes('NaN'));
  assert(select(layer).select('.babel-control-domain').empty());
});

test('the production idiom underlines belong to their chunks, not to the optional bracket', () => {
  const root = new Element('g');
  const host = select(root).append('g').attr('class', 'vr-item')
    .attr('data-vr-stage-index', '0').attr('data-vr-relation-index', '0');
  const layer = host.append('g').attr('class', 'babel-idiom-chunk-relation-layer');
  for (const [i, id] of ['a', 'b', 'unrelated'].entries()) {
    const terminal = select(root).append('text').attr('class', 'terminal-label').attr('data-node-id', id).node();
    terminal.datum = { __vizId: id, data: { id } };
    terminal.getBoundingClientRect = () => ({ left: i * 100, right: i * 100 + 40, top: 100, bottom: 120 });
    if (id !== 'unrelated') host.append('g').attr('class', 'vr-idiom-chunk-anchor').attr('data-idiom-chunk', id);
  }
  const { refineIdiomChunkRelation: refine } = createBindingRefinements({
    g: select(root), measuredSubtreeRect: () => null,
    treeMatrix: { inverse: () => ({}) },
    postFitNodeById: new Map(['a', 'b'].map(id => [id, { descendants: () => [{ __vizId: id, data: { id } }] }]))
  });
  refine.call(layer.node());
  assert.deepEqual(layer.selectAll('.babel-idiom-chunk-underline').nodes().map(n => n.attrs.d),
    ['M 0.0 127.0 H 40.0', 'M 100.0 127.0 H 140.0']);
  assert(layer.select('.babel-idiom-domain-bracket').empty());
});

const { drawPlaqueDependencyPath } = createCaseFeatureDrawing({
  markerScale: 1, activeDerivationFrameIndex: 0, relationEmphasisForItem: () => null, decorateRelationElement
});

test('deferred Case composition cannot give its owner to a blocked collector group', () => {
  const root = new Element('g'), deferred = [];
  const collector = { kind: 'directed-path', pathStyle: 'case-agree', outcome: 'blocked',
    fromNodeId: 'head', toNodeId: 'goal', relationRef: { stageIndex: 0, relationIndex: 2 } };
  const caseOwner = { ...collector, pathStyle: 'case-assignment', relationRef: { stageIndex: 0, relationIndex: 0 } };
  const { queueAcceptedRelationDraw: queue } = createRelationOwnership({
    g: select(root), deferredAcceptedRelationDraws: deferred,
  });
  const previous = globalThis.SVGElement; globalThis.SVGElement = Element;
  try {
    queue(caseOwner, 'quiet', () => drawPlaqueDependencyPath(select(root), collector, 'M 0 0 C 0 40 100 60 100 100', true));
    deferred.forEach(draw => draw());
    const group = descendants(root).find(n => matches(n, '.babel-collection-ink'));
    assert.equal(group.attrs['data-vr-owner-refs'], '0:2');
    assert.equal(group.attrs['data-vr-stage-index'], '0');
    assert.equal(group.attrs['data-vr-relation-index'], '2');
    assert(group.children.every(n => n.attrs['data-vr-owner-refs'] === '0:2'));
  } finally { globalThis.SVGElement = previous; }
});

const drawSavedPlaque = (primitive, item, items, layout, nodes, played, stageIndex) => {
  const root = new Element('g');
  const host = select(root);
  const queued = [];
  const rectFor = id => {
    const node = nodes.get(id);
    return node ? { x: node.x - 40, y: node.y - 30, width: 80, height: 60 } : null;
  };
  const dependencies = {
    frameItems: items, g: host,
    drawPlaqueDependencyPath,
    replayPlaqueLayout: layout,
    queueAcceptedRelationDraw: (_item, _emphasis, draw) => queued.push(draw),
    measuredTerminalSubtreeRectNow: rectFor, measuredTreeLabelRectNow: rectFor,
    ensureFeatureRelationLayer: () => host,
    revealedItemIndices: new Set(items.map((_, index) => index)),
    resolveOverlayAnchor: id => nodes.get(id)
  };
  createPlaqueDrawing(dependencies).drawPlaque(primitive, item, host, null);
  queued.forEach(draw => draw());
  if (primitive.plaqueStyle === 'realization') {
    const { renderPfRealizationPlate: painter } = createPlaqueRefinements({
      svg: select(new Element('svg')),
      playedRelationIndices: played, activeDerivationFrameIndex: stageIndex,
      measuredTerminalSubtreesRect: ids => rectFor(ids[0]), measuredShellRect: rectFor,
      measuredTerminalRect: () => null, unionRects: rects => rects[0],
      replayPlaqueLayout: layout
    });
    host.selectAll('.babel-pf-relation-layer').each(painter);
  }
  return root;
};
const svgSnapshot = node => ({ tag: node.tag, attrs: node.attrs, styles: node.styles,
  text: node.text, children: node.children.map(svgSnapshot) });

function drawCasePlaque(item, placement, assigner, frameItems = [item], revealed = frameItems.map((_, i) => i)) {
  const root = new Element('g');
  const dependencies = {
    frameItems,
    renderedCaseCompositions: new Set(), revealedItemIndices: new Set(revealed),
    ensureAgreementCaseRelationLayer: () => select(root),
    measuredTerminalSubtreeRectNow: () => assigner, measuredTreeLabelRectNow: () => assigner,
    markPreterminalLensNode() {}, replayPlaqueLayout: new Map([[0, placement]]),
    decorateRelationElement, relationEmphasisForItem: () => null,
    activeDerivationFrameIndex: 0,
    overlayNodeById: new Map([[item.fromNodeId, d3.hierarchy({ id: item.fromNodeId, label: 'V' })]]),
  };
  createCaseFeatureDrawing({ ...dependencies, markerScale: 1 }).drawCaseFeatureComposition(0);
  return root;
}

test('derived failed collection cues survive binding and every native collection paint route', () => {
  for (const fixture of blockedCollectionCases) {
    const stage = blockedCollectionStage(fixture.relations), plan = compileRelationRenderPlan([stage]), items = plan.frames[0].items;
    const tree = d3.tree().size([1200, 900])(d3.hierarchy(stage.workspaceForest[0]));
    const nodes = new Map(tree.descendants().map(node => [node.data.id, node]));
    const bound = bindRelationPlanFrame(plan, 0, id => nodes.get(id) ?? null, { plaqueTextLayout: { measureText } });
    const unblocked = structuredClone(plan);
    unblocked.frames[0].items.forEach(item => { if (item.pathStyle === 'case-agree') delete item.outcome; });
    const originalRoutes = bindRelationPlanFrame(unblocked, 0, id => nodes.get(id) ?? null, { plaqueTextLayout: { measureText } });
    const paths = items.filter(item => item.pathStyle === 'case-agree');
    assert(paths.length, fixture.id);
    for (const item of paths) {
      const geometry = bound.primitives.find(p => p.type === 'shape-path' && p.itemIndex === items.indexOf(item));
      assert(geometry, fixture.id);
      assert.equal(geometry.blocked === true, item.outcome === 'blocked');
      assert.equal(geometry.tip?.kind, item.outcome === 'blocked' ? 'cross' : undefined);
      assert.equal(geometry.stroke, 'dotted');
      const prior = originalRoutes.primitives.find(p => p.type === 'shape-path' && p.itemIndex === geometry.itemIndex);
      const { blocked, tip, ...route } = geometry;
      assert.deepEqual(route, prior, 'failure cue must not reroute or restyle the collector');
    }
    const request = prepareStagePlaqueRequests(items, tree.descendants())[0];
    let painted;
    if (fixture.id === 'unpaired') {
      assert.equal(request, undefined);
      const root = new Element('g'), primitive = bound.primitives.find(p => p.type === 'shape-path');
      const dependencies = { frameItems: items,
        drawPlaqueDependencyPath, drawCaseFeatureComposition() { throw Error('Unpaired path acquired Case'); },
        queueAcceptedRelationDraw: (_item, _emphasis, draw) => draw(), ensureAgreementCaseRelationLayer: () => select(root) };
      createShapeDrawing({ ...dependencies, measuredTreeLabelRectNow: () => null, measuredTerminalSubtreeRectNow: () => null })
        .drawShapePath(primitive, items[primitive.itemIndex], select(root), null);
      painted = root;
    } else {
      const placement = prepareCollectionPlaqueSpace(tree.descendants()).attach({ ...request, x: 0, y: 0 });
      if (fixture.id === 'standalone') {
        const primitive = bound.primitives.find(p => p.type === 'plaque' && p.itemIndex === request.index);
        painted = drawSavedPlaque(primitive, items[request.index], items, new Map([[request.index, placement]]), nodes, new Set([0]), 0);
      } else painted = drawCasePlaque(items[0], placement, { x: 1000, y: 100, width: 80, height: 60 }, items);
    }
    const cues = descendants(painted).filter(n => matches(n, '.babel-collection-failure'));
    const expectedOwners = paths.filter(p => p.outcome === 'blocked').map(p => planItemRelationRefs(p).map(r => `${r.stageIndex}:${r.relationIndex}`).join(' '));
    assert.deepEqual(cues.map(c => c.attrs['data-vr-owner-refs']), expectedOwners, fixture.id);
    for (const cue of cues) {
      assert.equal(cue.children[0].text, '✗');
      assert.equal(cue.children[0].attrs.fill, 'var(--babel-relation-ink, #34d399)');
      const path = cue.parent.children.find(n => n.tag === 'path');
      assert.equal(path.attrs['data-vr-owner-refs'], cue.attrs['data-vr-owner-refs']);
      assert.equal(cue.parent.attrs['data-vr-owner-refs'], cue.attrs['data-vr-owner-refs'],
        'the shared group belongs to the collector, never its enclosing Case or plaque claim');
      assert(!path.attrs.d.includes('NaN'));
    }
  }
});

test('saved failed comparisons paint both feature rows and paths with one owned failure cue', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/failed-agreement-holdout.json', import.meta.url)));
  for (const record of fixture.cases) {
    const stage = { statement: '', stageRecord: '', workspaceForest: record.workspaceForest, relations: [record.relation] };
    const plan = compileRelationRenderPlan([stage]), items = plan.frames[0].items;
    const tree = d3.tree().size([1200, 900])(d3.hierarchy(stage.workspaceForest[0]));
    const nodes = new Map(tree.descendants().map(node => [node.data.id, node]));
    const bound = bindRelationPlanFrame(plan, 0, id => nodes.get(id) ?? null, { plaqueTextLayout: { measureText } });
    const request = prepareStagePlaqueRequests(items, tree.descendants())[0];
    const placement = prepareCollectionPlaqueSpace(tree.descendants()).attach({ ...request, x: 0, y: 0 });
    const primitive = bound.primitives.find(p => p.type === 'plaque' && p.itemIndex === request.index);
    const paint = () => drawSavedPlaque(primitive, items[request.index], items,
      new Map([[request.index, placement]]), nodes, new Set([0]), 0);
    const painted = paint(), all = descendants(painted);
    const paths = all.filter(n => matches(n, '.babel-case-collection-path'));
    const cues = all.filter(n => matches(n, '.babel-collection-failure'));
    assert.equal(paths.length, 2, record.relation.relation);
    assert.equal(all.filter(n => matches(n, '.babel-feature-row')).length, 2);
    assert.equal(cues.length, 1);
    assert(paths.every(n => n.attrs['data-vr-owner-refs'] === '0:0'));
    assert.equal(cues[0].attrs['data-vr-owner-refs'], '0:0');
    assert.equal(cues[0].parent.attrs['data-vr-owner-refs'], '0:0');
    const midpoints = paths.map(path => path.getPointAtLength(path.getTotalLength() / 2));
    const expected = { x: (midpoints[0].x + midpoints[1].x) / 2,
      y: (midpoints[0].y + midpoints[1].y) / 2 };
    assert.equal(Number(cues[0].attrs['data-vr-x']), expected.x,
      'the comparison cross belongs between both routes, not on the first row');
    assert.equal(Number(cues[0].attrs['data-vr-y']), expected.y);
    assert(Math.hypot(expected.x - midpoints[0].x, expected.y - midpoints[0].y) > 0,
      'the saved conflict must exercise separate collector routes');
    assert.deepEqual(svgSnapshot(paint()), svgSnapshot(painted), 'redrawing cannot lose the shared cue');
  }
});

test('a shared plaque paints the collector at its reserved edge and keeps its owning relation moment', () => {
  const items = compileRelationRenderPlan([{ statement: 'Values.', stageRecord: 'Two claims.', workspaceForest: [
    { id: 'root', label: 'TP', children: [{ id: 't', label: 'T' }, { id: 'd', label: 'D' }] }
  ], relations: [
    { relation: 'CaseAssignment', anchors: { assigner: 't', bearer: 'd' }, values: { Case: 'nominative' } },
    { relation: 'Specifier-head agreement', anchors: { head: 't', specifier: 'd' }, values: { agreement: 'plural' } }
  ] }]).frames[0].items;
  const assignment = items.find(item => item.pathStyle === 'case-assignment');
  assert.equal(items[0], assignment);
  const composition = caseFeatureComposition(items, 0);
  const layout = prepareCasePlaqueRows(composition.rows);
  const rowY = layout.rows[1].y;
  const placement = { x: 0, y: 0, ...layout, collectionRows: [{ sourceNodeId: 'd',
    featureKey: featureRowKey(pathFeatureRow(items.find(item => item.pathStyle === 'case-agree'))), y: rowY, edge: 'bottom', portX: 70 }] };
  const source = { x: 1000, y: 100, width: 100, height: 60 };
  const painted = drawCasePlaque(assignment, placement, source, items);
  const path = descendants(painted).find(node => matches(node, '.babel-case-collection-path'));
  assert.equal(path.attrs.d, featureCollectionPlaquePath(placement, rowY, source, 0, 'bottom', 70));
  const beforeAgree = drawCasePlaque(assignment, placement, source, items, [0]);
  assert(!descendants(beforeAgree).some(node => matches(node, '.babel-case-collection-path')),
    'a reserved bottom attachment does not reveal its feature claim early');
});

for (const shared of [false, true]) test(`${shared ? 'shared Case' : 'standalone feature'} plaque paints distinct collinear bottom collectors`, () => {
  const root = d3.hierarchy({ id: 'root', label: 'TP', children: [{ id: 't', label: 'T' }, { id: 'd', label: 'D' }] });
  const nodes = new Map(root.descendants().map(node => [node.data.id, node]));
  for (const node of nodes.values()) { node.x = 200; node.y = node.data.id === 'd' ? 1000 : -300; }
  const plan = compileRelationRenderPlan([{ statement: 'Values.', stageRecord: 'Exact features.', workspaceForest: [root.data], relations: [
    ...(shared ? [{ relation: 'CaseAssignment', anchors: { assigner: 't', bearer: 'd' }, values: { Case: 'nominative' } }] : []),
    { relation: 'Phi Agree', anchors: { probe: 't', goal: 'd' }, values: { features: ['feminine', 'singular'] } }
  ] }]);
  const items = plan.frames[0].items;
  const request = prepareStagePlaqueRequests(items, [...nodes.values()])[0];
  assert.equal(request.collectionRows.length, 2);
  const placement = prepareCollectionPlaqueSpace([...nodes.values()]).attach({ ...request, x: 0, y: 0 });
  assert(placement.collectionRows.every(row => row.edge === 'bottom'));
  const item = items[request.index];
  const primitive = !shared && bindRelationPlanFrame(plan, 0, id => nodes.get(id) ?? null,
    { plaqueTextLayout: { measureText: (text, style) => ({ width: text.length * style.fontSize * .6, ascent: 28, descent: 9 }) } }).primitives
    .find(primitive => primitive.type === 'plaque' && primitive.itemIndex === request.index);
  const painted = shared ? drawCasePlaque(item, placement, { x: 160, y: 970, width: 80, height: 60 }, items)
    : drawSavedPlaque(primitive, item, items, new Map([[request.index, placement]]), nodes, new Set([0]), 0);
  const paths = descendants(painted).filter(node => matches(node, '.babel-case-collection-path'));
  assert.equal(paths.length, 2);
  assert.notEqual(paths[0].attrs.d, paths[1].attrs.d, 'different feature rows must remain separate painted curves');
  const starts = paths.map(path => path.attrs.d.match(/^M (-?[\d.]+) (-?[\d.]+)/).slice(1).map(Number));
  assert(Math.abs(starts[0][0] - starts[1][0]) >= 24);
  assert.equal(starts[0][1], starts[1][1], 'both collectors leave the bottom edge');
  const coincident = { ...placement, collectionRows: placement.collectionRows.map(row => ({ ...row, portX: 200 })) };
  const nearby = new Map([...nodes].map(([id, node]) => [id, id === 'd' ? { ...node, y: placement.height + 90 } : node]));
  const combined = shared ? drawCasePlaque(item, coincident, { x: 160, y: placement.height + 60, width: 80, height: 60 }, items)
    : drawSavedPlaque(primitive, item, items, new Map([[request.index, coincident]]), nearby, new Set([0]), 0);
  const combinedPaths = descendants(combined).filter(node => matches(node, '.babel-case-collection-path'));
  assert.equal(combinedPaths.length, 1, 'truly identical collector ink paints once');
  const text = combined.textContent;
  assert(text.includes('feminine') && text.includes('singular'), 'both feature rows stay visible');
});

test('a coalesced Case path still composes with a later-stage feature plaque in layout and painting', () => {
  const item = { kind: 'directed-path', pathStyle: 'case-assignment', fromNodeId: 'v', toNodeId: 'dp',
    featureRow: { label: 'Case', value: 'accusative' }, relationRef: { stageIndex: 0, relationIndex: 0 },
    coalescedRefs: [{ stageIndex: 1, relationIndex: 0 }] };
  const bundle = { kind: 'node-plaque', plaqueStyle: 'feature', anchorNodeIds: ['dp'],
    relationRef: { stageIndex: 1, relationIndex: 1 }, rows: [{ label: 'Case', value: 'accusative' }, { label: 'number', value: 'plural' }] };
  const tree = d3.tree().size([1000, 1000])(d3.hierarchy({ id: 'vp', label: 'VP', children: [
    { id: 'v', label: 'V', word: 'read' }, { id: 'dp', label: 'DP', word: 'books' }
  ] }));
  const layout = placeStagePlaques([item, bundle], tree.descendants(), []);
  assert.equal(layout.size, 1, 'reserve one combined plaque');
  assert.equal(layout.get(0).height, prepareCasePlaqueRows(bundle.rows).height, 'reserve both authored rows including wrapped lines');
  const painted = drawCasePlaque(item, layout.get(0), { x: 0, y: 0, width: 100, height: 60 }, [item, bundle]);
  assert(descendants(painted).some(node => node.textContent === '[number: plural]'), 'the later bundle contributes its row');
  const beforeBundle = drawCasePlaque(item, layout.get(0), { x: 0, y: 0, width: 100, height: 60 }, [item, bundle], [0]);
  assert(!descendants(beforeBundle).some(node => node.text.includes('plural')),
    'a carried Case mark must not reveal the later bundle before its relation moment');
  const unrelated = { ...bundle, relationRef: { stageIndex: 2, relationIndex: 0 } };
  assert.equal(placeStagePlaques([item, unrelated], tree.descendants(), []).size, 2,
    'claims with no shared authored stage stay separate');
});

test('native Case connector approaches the outside edge for plaques on every side of the assigner', () => {
  const item = { kind: 'directed-path', pathStyle: 'case-assignment', fromNodeId: 'v', toNodeId: 'dp',
    featureRow: { label: 'Case', value: 'accusative' }, relationRef: { stageIndex: 0, relationIndex: 0 } };
  const assigner = { x: 450, y: 450, width: 100, height: 60 };
  for (const [x, y] of [[650, 570], [0, 280], [350, 600], [350, 150], [0, 600], [650, 150]]) {
    const box = { x, y, ...prepareCasePlaqueRows([item.featureRow]) };
    const painted = drawCasePlaque(item, box, assigner);
    const all = descendants(painted);
    const shell = all.find(node => matches(node, '.babel-feature-plaque-shell'));
    assert.equal(Number(shell.attrs.x), x);
    assert.equal(Number(shell.attrs.y), y);
    const path = all.find(node => matches(node, '.babel-case-assignment-path'));
    assert(path.attrs['marker-end']);
    const points = path.attrs.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    assert.equal(points.length, 8);
    if (points[0] === points[6]) {
      assert.notEqual(points[2], points[0], 'an aligned plaque still receives a curved connector');
      assert(Math.abs(points[2] - points[0]) <= 32, 'the connector remains short');
      assert.equal(points[4], points[6], 'the arrow approaches the plaque vertically');
      assert.notEqual(points[5], points[7], 'the arrow has a nonzero final tangent');
    }
    for (let i = 0; i <= 100; i++) {
      const t = i / 100, u = 1 - t;
      const px = u ** 3 * points[0] + 3 * u * u * t * points[2] + 3 * u * t * t * points[4] + t ** 3 * points[6];
      const py = u ** 3 * points[1] + 3 * u * u * t * points[3] + 3 * u * t * t * points[5] + t ** 3 * points[7];
      assert(!(px > x && px < x + box.width && py > y && py < y + box.height), 'Case connector entered the plaque');
      assert(!(px > assigner.x && px < assigner.x + assigner.width
        && py > assigner.y && py < assigner.y + assigner.height), 'Case connector entered the assigner label');
    }
    assert(all.some(node => node.textContent === '[Case: accusative]'));
    assert.deepEqual(svgSnapshot(drawCasePlaque(item, box, assigner)), svgSnapshot(painted));
  }
});

const savedPlaqueRecords = JSON.parse(readFileSync(new URL('../fixtures/movement/saved-qualification.json', import.meta.url)));
for (const record of savedPlaqueRecords) {
  for (const [width, height] of [[1596, 1016], [390, 844]]) {
    test(`${record.name} ${width}px: native plaque SVG stays attached through deferred painting and reverse scrubbing`, () => {
      const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
      const plan = compileRelationRenderPlan(record.derivationStages);
      const allocations = record.derivationStages.map((stage, stageIndex) => buildStagePlaqueLayout({
        steps, stageIndex, plan, width, height,
        completedCanvas: buildRenderableDerivationCanvasData(stage.workspaceForest)
      }));
      const snapshots = new Map();
      let drawn = 0;
      const order = [...steps.keys(), ...Array.from(steps.keys()).reverse(), 0, steps.length - 1];
      for (const stepIndex of order) {
        const step = steps[stepIndex];
        const stageIndex = step.replayFrameIndex;
        const root = d3.hierarchy(step.replayCanvasData);
        applyVizIds(root);
        const tree = d3.tree().size(treeLayoutSize(root.descendants().length, root.height, width, height))
          .separation((a, b) => a.parent === b.parent ? 2.5 : 3.5)(root);
        const visible = new Set(step.replayVisibleNodeIds);
        alignReplayUnaryTerminalLeaves(tree, visible);
        const nodes = new Map(tree.descendants().map(node => [node.__vizId ?? node.data.id, node]));
        const layout = projectPlaqueLayout(allocations[stageIndex], id => nodes.get(id) ?? null);
        const played = new Set(steps.slice(0, stepIndex + 1).flatMap(previous =>
          previous.replayKind === 'relation' && previous.replayRelationIdentity?.stageIndex === stageIndex
            ? [previous.replayRelationIdentity.relationIndex] : []));
        const bound = bindRelationPlanFrame(plan, stageIndex, id => nodes.get(id) ?? null,
          { plaqueTextLayout: { measureText } });
        const frameSvg = [];
        for (const primitive of bound.primitives.filter(primitive => primitive.type === 'plaque')) {
          const item = plan.frames[stageIndex].items[primitive.itemIndex];
          if (item.plaqueStyle === 'theta-grid') continue;
          if (!(item.appearsAtStage < stageIndex || planItemRelationRefs(item).some(ref =>
            ref.stageIndex === stageIndex && played.has(ref.relationIndex)))) continue;
          const expected = layout.get(primitive.itemIndex);
          if (!expected) continue;
          const painted = drawSavedPlaque(primitive, item, plan.frames[stageIndex].items, layout, nodes, played, stageIndex);
          const all = descendants(painted);
          const shell = all.find(node => matches(node, '.babel-feature-plaque-shell, .babel-pf-plate-shell, .vr-plaque'));
          assert(shell, `frame ${stepIndex + 1}: allocated visible plaque must paint its shell`);
          drawn++;
          const isGeneric = matches(shell, '.vr-plaque');
          const paintedX = isGeneric ? Number(shell.parent.attrs.transform.match(/translate\(([^,]+)/)[1]) : Number(shell.attrs.x);
          const paintedY = isGeneric ? Number(shell.parent.attrs.transform.match(/,([^)]*)\)/)[1]) : Number(shell.attrs.y);
          assert(Math.abs(paintedX - expected.x) <= 0.051, `frame ${stepIndex + 1}: painted x differs from reserved domain position`);
          assert(Math.abs(paintedY - expected.y) <= 0.051, `frame ${stepIndex + 1}: painted y differs from reserved domain position`);
          assert(all.every(node => !matches(node, '.vr-overlay-marker')), 'plaque must not be independently counter-scaled during zoom');
          const anchor = nodes.get(expected.attachmentNodeId);
          for (const transform of [{ k: 0.25, x: -100, y: 50 }, { k: 1, x: 0, y: 0 }, { k: 2, x: 700, y: -300 }]) {
            const screenPlaque = { x: paintedX * transform.k + transform.x, y: paintedY * transform.k + transform.y };
            const screenAnchor = { x: anchor.x * transform.k + transform.x, y: anchor.y * transform.k + transform.y };
            assert(Math.abs((screenPlaque.x - screenAnchor.x) / transform.k - (expected.x - anchor.x)) < 0.051);
            assert(Math.abs((screenPlaque.y - screenAnchor.y) / transform.k - (expected.y - anchor.y)) < 0.051);
          }
          frameSvg.push(svgSnapshot(painted));
        }
        if (snapshots.has(stepIndex)) assert.deepEqual(frameSvg, snapshots.get(stepIndex), 'revisiting a frame must paint identical SVG');
        else snapshots.set(stepIndex, frameSvg);
      }
      assert(drawn > 0, 'saved analysis must exercise an actual plaque painter');
    });
  }
}
const drawPf = ({ rows, kinds = [], refs = [], played = null, stage = 0, zoom = 1 }) => {
  const svgRoot = new Element('svg');
  const layer = new Element('g', {
    class: 'babel-pf-relation-layer', 'data-pf-targets': '["head"]',
    'data-pf-rows': JSON.stringify(rows), 'data-pf-row-kinds': JSON.stringify(kinds), 'data-pf-row-refs': JSON.stringify(refs)
  });
  layer.getScreenCTM = () => ({ a: zoom, b: 0, d: zoom, inverse() { return { a: 1 / zoom, d: 1 / zoom }; } });
  const fullLayout = preparePfPlaqueTextLayout(rows.map((row, index) => ({ ...row, kind: kinds[index] || 'literal', rowIndex: index })), { measureText });
  const target = { x: 600, y: 400, width: 80, height: 60 };
  const { renderPfRealizationPlate: draw } = createPlaqueRefinements({
    svg: select(svgRoot), g: select(new Element('g')),
    playedRelationIndices: played, activeDerivationFrameIndex: stage,
    measuredTerminalSubtreesRect: () => target, measuredShellRect: () => target,
    measuredTerminalRect: () => null, unionRects: rects => rects[0],
    replayPlaqueLayout: new Map([[0, { x: 700, y: 550, location: 'below', domainId: 'head', ...(fullLayout.overflow ? { scrollHeight: fullLayout.height } : {}) }]]),
  });
  draw.call(layer);
  assert.equal(svgRoot.children.length, 0, 'temporary measuring text is removed');
  const elements = descendants(layer);
  const shell = elements.find(node => matches(node, '.babel-pf-plate-shell'));
  const texts = elements.filter(node => node.tag === 'text');
  return { layer, shell, texts, elements };
};
const assertContained = ({ shell, texts, elements }) => {
  const viewport = elements.find(node => node.attrs['data-babel-plaque-viewport']);
  const scrollRange = Number(viewport?.attrs['data-scroll-max'] || 0);
  if (viewport) {
    assert.equal(Number(viewport.attrs.height), Number(shell.attrs.height) - 8);
    assert.equal(Number(viewport.attrs.width), Number(shell.attrs.width) - 8);
  }
  const left = Number(shell.attrs.x), top = Number(shell.attrs.y);
  const right = left + Number(shell.attrs.width), bottom = top + Number(shell.attrs.height) + scrollRange;
  for (const text of texts) {
    for (const line of text.children) {
      const { width, ascent, descent } = measureText(line.textContent, {
        fontSize: parseFloat(text.styles['font-size']), letterSpacing: parseFloat(text.styles['letter-spacing'])
      });
      assert.ok(Number(line.attrs.x) >= left);
      assert.ok(Number(line.attrs.x) + width <= right + 0.1, `${line.textContent} exceeds the right edge`);
      assert.ok(Number(line.attrs.y) - ascent >= top);
      assert.ok(Number(line.attrs.y) + descent <= bottom + 0.1, `${line.textContent} exceeds the bottom edge`);
    }
  }
};

test('native PF literal prose uses measured wrapping with all text inside its shell', () => {
  const rows = [{ label: 'realization', value: 'Past T in C is realized as did; lexical V remains bare buy.' }];
  const original = structuredClone(rows);
  const rendered = drawPf({ rows, kinds: ['literal'] });
  const text = rendered.texts.find(node => matches(node, '.babel-pf-plate-text'));
  assertSpells(text.children.map(line => line.textContent), `realization: ${rows[0].value}`);
  assert.ok(text.children.length > 1, 'the production painter must draw wrapped tspans');
  assert.equal(Number(rendered.shell.attrs.width), 590);
  assert.ok(Number(rendered.shell.attrs.height) > 132);
  assert.equal(rendered.elements.filter(node => matches(node, '.babel-pf-plate-arrow')).length, 0);
  assert.deepEqual(rows, original);
  assertContained(rendered);
});

test('native PF rewrite columns wrap independently and retain inputs, arrows, outputs and final emphasis', () => {
  const rows = [
    { label: 'a long literal input '.repeat(5), value: 'an unshortened output '.repeat(6) },
    { label: 'T[past]', value: 'did' }
  ];
  const rendered = drawPf({ rows, kinds: ['rewrite', 'rewrite'] });
  const rowGroups = rendered.elements.filter(node => node.attrs['data-plaque-row-index'] !== undefined);
  assert.equal(rowGroups.length, 2);
  rowGroups.forEach((group, index) => {
    [rows[index].label, '\u2192', rows[index].value].forEach((expected, part) =>
      assertSpells(group.children[part].children.map(line => line.textContent), expected));
    assert.equal(matches(group.children[0], '.babel-pf-plate-text-final'), index === 1);
    assert.equal(matches(group.children[2], '.babel-pf-plate-text-final'), index === 1);
    assert.ok(matches(group.children[2], '.babel-pf-plate-output'));
    assert.ok(!matches(group.children[1], '.babel-pf-plate-text-final'));
  });
  const firstBottom = Math.max(...rowGroups[0].children.flatMap(text => text.children.map(line => Number(line.attrs.y) + 5.6)));
  const nextTop = Math.min(...rowGroups[1].children.flatMap(text => text.children.map(line => Number(line.attrs.y) - 22.4)));
  assert.ok(firstBottom < nextTop);
  assertContained(rendered);
});

test('native PF keeps every visible row and its original ownership, never promotes a hidden final row', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ label: `field${i}`, value: `literal ${i} `.repeat(8) }));
  const kinds = rows.map((_, i) => i % 2 ? 'rewrite' : 'literal');
  const refs = rows.map((_, i) => ({ stageIndex: 2, relationIndex: i }));
  const partial = drawPf({ rows, kinds, refs, stage: 2, played: new Set([0, 2, 9]) });
  assert.deepEqual(partial.elements.filter(node => node.attrs['data-plaque-row-index'] !== undefined)
    .map(node => node.attrs['data-plaque-row-index']), ['0', '2', '9']);
  assert.ok(partial.texts.every(node => !matches(node, '.babel-pf-plate-text-final')));
  assertContained(partial);
  const complete = drawPf({ rows, kinds, refs, stage: 3, played: new Set() });
  assert.equal(complete.elements.filter(node => node.attrs['data-plaque-row-index'] !== undefined).length, 12);
  assert.equal(complete.shell.attrs.height, partial.shell.attrs.height, 'revealed rows keep the reserved viewport');
  assertContained(complete);
});

test('native zero realization retains its compact rewrite columns; a literal null value is not a rewrite', () => {
  const rows = [{ label: 'C', value: '\u2205' }];
  const compact = drawPf({ rows, kinds: ['rewrite'] });
  const row = compact.elements.find(node => node.attrs['data-plaque-row-index'] === '0');
  assert.equal(Number(compact.shell.attrs.width), 360);
  assert.equal(Number(compact.shell.attrs.height), 132);
  assert.deepEqual(row.children.map(text => Number(text.children[0].attrs.x) - Number(compact.shell.attrs.x)), [26, 190, 246]);
  assert.deepEqual(row.children.map(text => text.textContent), ['C', '\u2192', '\u2205']);
  assertContained(compact);
  const literal = drawPf({ rows, kinds: ['literal'] });
  assert.equal(Number(literal.shell.attrs.width), 308, 'the literal plate fits its heading rather than reserving rewrite columns');
  assert.equal(literal.elements.filter(node => matches(node, '.babel-pf-plate-arrow')).length, 0);
  assertContained(literal);
});

test('PF font size and local text positions do not change with camera scale', () => {
  const input = { rows: [{ label: 'T[past]', value: 'did' }], kinds: ['rewrite'] };
  const relativeText = rendered => rendered.texts.map(text => ({
    text: text.textContent, styles: text.styles,
    lines: text.children.map(line => ({ x: Number(line.attrs.x) - Number(rendered.shell.attrs.x),
      y: Number(line.attrs.y) - Number(rendered.shell.attrs.y) }))
  }));
  const normal = drawPf(input);
  for (const zoom of [0.3, 0.5, 2]) {
    const rendered = drawPf({ ...input, zoom });
    assert.deepEqual(relativeText(rendered), relativeText(normal));
    assertContained(rendered);
  }
});

test('PF wrapping consumes only the whitespace at a break and keeps graphemes, empty values and explicit line breaks', () => {
  const literal = ' e\u0301\u{1f469}\u200d\u{1f4bb}\u4e2d  '.repeat(20);
  const rows = [{ label: '', value: literal, rowIndex: 0, isFinal: false },
    { label: '', value: '', rowIndex: 1, isFinal: false },
    { label: '', value: 'first\n\nlast', rowIndex: 2, isFinal: true }];
  const layout = preparePfPlaqueTextLayout(rows, { measureText });
  const lines = layout.rows[0].parts[0].block.lines.map(line => line.text);
  assertSpells(lines, literal);
  const literalGraphemes = new Set(graphemes(literal));
  assert.ok(lines.flatMap(graphemes).every(grapheme => literalGraphemes.has(grapheme)), 'graphemes remain whole');
  assert.equal(layout.rows[1].parts[0].block.text, '');
  assert.deepEqual(layout.rows[2].parts[0].block.lines.map(line => line.text), ['first', '', 'last']);
});

test('PF column spacing and line height contain indivisible glyphs and unusually tall ink', () => {
  const rows = [{ label: '\u4e2d', value: '\u4e2d', kind: 'rewrite', rowIndex: 0, isFinal: true }];
  const layout = preparePfPlaqueTextLayout(rows, { measureText: (text, style) => ({
    width: text.includes('\u4e2d') ? 650 : measureText(text, style).width, ascent: 60, descent: 20
  }) });
  const [input, arrow, output] = layout.rows[0].parts.map(part => part.block.lines[0]);
  assert.ok(input.x + input.width < arrow.x);
  assert.ok(arrow.x + arrow.width < output.x);
  assert.ok(output.x + output.width < layout.width);
  assert.ok(output.y + output.descent < layout.height);
  assert.ok(layout.title.lines.at(-1).y + 20 < input.y - 60);
  assert.ok(layout.rows[0].ruleY + 2 < input.y - 60, 'final-row rule must stay above the text ink');
});

const gapPredicate = labels => {
  const root = new Element('g');
  for (const { text, kind = 'category', id = 'lower', original, index, replayOrigin } of labels) {
    const label = new Element('text', { class: `${kind}-label`,
      [kind === 'category' ? 'data-category-node-id' : 'data-node-id']: id,
      ...(original ? { 'data-default-label': original } : {}), ...(index ? { 'data-trace-index': index } : {}) });
    label.text = text;
    label.datum = { data: { id, replayOrigin } };
    root.children.push(label);
  }
  const predicate = (nodeId, text) => hasTreeGapNotation(select(root), nodeId, text);
  return { root, predicate };
};
const badgeOwner = (relationIndex = 0) => ({
  appearsAtStage: 0, persistence: 'persistent', backward: false, priorWitnessNodeIds: [],
  relationRef: { stageIndex: 0, relationIndex, relation: 'Authored gap', anchors: {} }
});
const gapItem = (notation, nodeId = 'lower', familyId = 'tier2.gap-notation') => ({
  ...badgeOwner(), kind: 'node-badges', familyId, badgeStyle: 'gap-notation',
  badges: [{ nodeId, text: notation, shape: 'plain' }]
});
const bindGapItems = (items, hasExistingGapNotation) => bindRelationPlanFrame(
  { frames: [{ stageIndex: 0, items }] }, 0, () => ({ x: 100, y: 100 }), { hasExistingGapNotation }
);
const gapLabels = (labels, notation, nodeId = 'lower', familyId = 'tier2.gap-notation') => {
  const { root, predicate } = gapPredicate(labels);
  const before = root.textContent;
  const bound = bindGapItems([gapItem(notation, nodeId, familyId)], predicate);
  assert.deepEqual(bound.failed, []);
  const host = new Element('g');
  const primitive = bound.primitives[0];
  const { drawTextBadge } = createPlaqueDrawing({ appendMarker: () => select(host).append('g') });
  drawTextBadge(primitive, gapItem(notation, nodeId, familyId), select(host), null);
  const result = host.children.length ? 'draw-extra-label' : undefined;
  assert.equal(root.textContent, before, 'reuse must never replace authored occurrence notation');
  return { result, host };
};

test('Tier2 category-labelled trace reuses the exact existing I instead of drawing a floating I', () => {
  const { result, host } = gapLabels([{ text: 'I' }], 'I');
  assert.equal(result, undefined);
  assert.equal(host.attrs['data-gap-notation-reuses'], 'lower');
});

test('Tier2 trace notation remains authored and silent-copy words retain their occurrence index', () => {
  for (const [text, original, notation] of [['t', 't', 't'], ['t_i', 't_i', 't_i'], ['t_V', 't_V', 't_V'], ['John\u2081', 'John', 'John']]) {
    const { result, host } = gapLabels([{ text, original, kind: 'terminal', index: text === 't' ? undefined : '1' }], notation);
    assert.equal(result, undefined);
    assert.equal(host.attrs['data-gap-notation-reuses'], 'lower');
  }
});

test('matching text on a different occurrence cannot absorb a gap label', () => {
  const { result, host } = gapLabels([{ text: 'I', id: 'upper' }], 'I');
  assert.equal(result, 'draw-extra-label');
  assert.equal(host.attrs['data-gap-notation-reuses'], undefined);
});

test('gap notation reuses its owned display word even when its allocated ID collides with authored IDs', () => {
  for (const id of ['lower::__leaf', 'lower::__leaf::2', 'arbitrary-display-id']) {
    const { result } = gapLabels([{ text: 'I' }, { text: 'did', kind: 'terminal', id,
      replayOrigin: { kind: 'word', ownerId: 'lower' } }], 'did');
    assert.equal(result, undefined);
  }
  for (const replayOrigin of [undefined, { kind: 'word', ownerId: 'another-occurrence' }]) {
    const { result } = gapLabels([{ text: 'I' }, { text: 'did', kind: 'terminal',
      id: 'lower::__leaf', replayOrigin }], 'did');
    assert.equal(result, 'draw-extra-label', 'authored ID spelling cannot establish display ownership');
  }
});

const fittedCamera = (root, { data, manualCameraRef, fitFallbackOverlays }) => {
  const harness = createCameraHarness(Element, {
    width: 1600, height: 1100, data, manual: manualCameraRef, signature: 'stage'
  });
  const { applyFittedCamera } = createFittedCamera({ session: harness.session, layout: {
    g: select(root), stagePlaqueContainmentBounds: null, stageFitContainmentBounds: null,
    fitLeft: 40, fitRight: 1560, fitTop: 100, fitBottom: 700, fitFallbackOverlays
  } });
  return transform => harness.run(() => applyFittedCamera(transform));
};

test('an unchanged Replay frame retains its accepted fit after font-driven repaint', () => {
  const data = {}, auto = { current: null };
  const harness = createCameraHarness(Element, { width: 386, height: 840, data, step: 44, animated: true, auto });
  const bounds = { minX: 236.43835616438298, maxX: 7108.4766380730125,
    minY: -159.23809523809496, maxY: 3294.9523809523807 };
  const layout = { g: harness.group, stagePlaqueContainmentBounds: bounds, stageFitContainmentBounds: bounds,
    fitLeft: 16, fitRight: 370, fitTop: 78.5, fitBottom: 550 };
  const retained = d3.zoomIdentity.translate(3.82032715060123, 222.4364835268697).scale(0.05151310069560331);
  const recentered = retained.translate(0, 214.47619047619048);
  const fit = transform => harness.run(() => createFittedCamera({ session: harness.session, layout }).applyFittedCamera(transform));
  fit(retained);
  harness.session.activeStepIndex = 45;
  assert.equal(fit(recentered).y, retained.y, 'adjacent construction retains the accepted camera');
  assert.equal(fit(recentered).y, retained.y, 'a late font completion cannot recenter that same frame');
  harness.session.fitRevision++;
  assert.equal(fit(recentered).y, recentered.y, 'an explicit Fit is still honored');
  harness.session.fitRevision++;
  harness.session.activeStepIndex = 46;
  fit(retained);
  layout.completedReplayStep = 46;
  assert.equal(fit(recentered).y, recentered.y, 'the completed Replay can release its final fit');
});

test('stacked linguistic notation keeps automatic-fit size and spacing through manual zoom and redraw', () => {
  const root = new Element('g');
  const appendMarker = (x, y, treeNotation, stackIndex) => appendOverlayMarker(select(root), x, y, 2, 46, treeNotation, stackIndex);
  const notation = appendMarker(100, 200, true).node();
  const second = appendMarker(192, 200, true, 1).node();
  const locator = appendMarker(100, 240).node();
  const manualCameraRef = { current: null };
  const data = {};
  const fit = fittedCamera(root, { manualCameraRef, data });
  const automatic = d3.zoomIdentity.scale(0.5);
  fit(automatic);
  assert.equal(notation.attrs.transform, 'translate(100,200) scale(2)');
  assert.equal(second.attrs.transform, 'translate(192,200) scale(2)');
  assert.equal(locator.attrs.class, 'vr-overlay-marker');
  assert.equal(notation.attrs.class, 'vr-tree-notation');
  manualCameraRef.current = { data, signature: 'stage', width: 1600, height: 1100,
    transform: d3.zoomIdentity.translate(20, 30).scale(2) };
  // The geometry binder observes the retained manual zoom during a redraw.
  const redraw = (x, y, treeNotation, stackIndex) => appendOverlayMarker(select(root), x, y, 0.5, 46, treeNotation, stackIndex);
  const redrawnSecond = redraw(123, 200, true, 1).node();
  const camera = fit(automatic);
  assert.equal(camera.k, 2);
  assert.equal(notation.attrs.transform, 'translate(100,200) scale(2)',
    'redrawing under manual zoom must not shrink notation back to screen size');
  assert.equal(redrawnSecond.attrs.transform, second.attrs.transform,
    'stacked labels must retain their spacing after redraw at a different camera scale');
});

test('fallback role and authored array position share one tree coordinate group', () => {
  for (const frame of ['circle', 'box']) {
    const root = new Element('g');
    const primitive = { type: 'fallback-mark', nodeId: 'owned', x: 100, y: 200,
      stackIndex: 1, frame, instance: 2, numeral: 3, backward: true, role: 'members', text: 'members[3]' };
    const drawn = drawFallbackMark(select(root), primitive, 2);
    const marker = root.children[0];
    assert.equal(marker.attrs.class, 'vr-fallback-mark');
    assert.equal(marker.attrs.transform, 'translate(100,200) scale(2)');
    assert.deepEqual(marker.children.map(child => [child.tag, child.text]),
      [['text', 'members[3]']]);
    assert.equal(marker.attrs['data-authored-role'], 'members');
    assert.ok(marker.children.every(child => child.attrs.transform === undefined));
    assert.equal(drawn.node(), marker, 'Fit receives this exact owned group');
  }
  const data = {};
  const manualCameraRef = { current: null };
  const fitScales = [];
  const fitViewports = [];
  const fit = fittedCamera(new Element('g'), {
    manualCameraRef, data,
    fitFallbackOverlays: (scale, viewport) => { fitScales.push(scale); fitViewports.push(viewport); }
  });
  fit(d3.zoomIdentity.scale(0.5));
  manualCameraRef.current = { data, signature: 'stage', width: 1600, height: 1100,
    transform: d3.zoomIdentity.translate(20, 30).scale(2) };
  const camera = fit(d3.zoomIdentity.scale(0.5));
  assert.equal(camera.k, 2);
  assert.deepEqual(fitScales, [0.5, 0.5], 'the allocation uses automatic Fit even under a retained manual camera');
  assert.deepEqual(fitViewports, Array(2).fill({ x: 80, y: 200, width: 3040, height: 1200 }),
    'placement limits stay in fitted tree coordinates, independent of manual zoom');
});

test('a changed terminal cannot absorb its old label just because data-default-label still contains it', () => {
  const { result } = gapLabels([{ text: 'did', original: 'T', kind: 'terminal' }], 'T');
  assert.equal(result, 'draw-extra-label');
});

test('a genuinely different authored gap annotation stays available; no automatic t or null is introduced', () => {
  for (const notation of ['t_j', 'authored gap label', '\u2205']) {
    const { result } = gapLabels([{ text: 'I' }], notation);
    assert.equal(result, 'draw-extra-label');
  }
});

const laterFallback = () => ({
  ...badgeOwner(1), kind: 'fallback', drawing: {
    row: 1, instance: 1,
    marks: [{ witness: 'lower', role: 'participant', frame: 'circle', position: null, instance: 1, backward: false }]
  }
});

test('a reused exact gap consumes no badge slot before a later fallback on the same node', () => {
  const { predicate } = gapPredicate([{ text: 'I' }]);
  const input = [gapItem('I'), laterFallback()];
  const before = structuredClone(input);
  const bound = bindGapItems(input, predicate);
  assert.deepEqual(bound.failed, []);
  const gap = bound.primitives.find(item => item.type === 'text-badge');
  const fallback = bound.primitives.find(item => item.type === 'fallback-mark');
  assert.equal(gap.reuseExistingNotation, true);
  assert.equal(fallback.stackIndex, 0);
  const clean = bindGapItems([laterFallback()], predicate).primitives.find(item => item.type === 'fallback-mark');
  assert.equal(fallback.y, clean.y);
  assert.deepEqual(input, before, 'reuse is derived on the bound badge, never written into the authored plan');
});

test('a changed gap annotation still consumes a real slot; callback checks each exact badge only once', () => {
  const { predicate } = gapPredicate([{ text: 'I' }]);
  const queries = [];
  const item = gapItem('I');
  item.badges.push({ nodeId: 'lower', text: 't_j', shape: 'plain' });
  const bound = bindGapItems([item, laterFallback()], (nodeId, text) => {
    queries.push([nodeId, text]);
    return predicate(nodeId, text);
  });
  assert.deepEqual(bound.failed, []);
  const badges = bound.primitives.filter(item => item.type === 'text-badge');
  assert.deepEqual(queries, [['lower', 'I'], ['lower', 't_j']]);
  assert.equal(badges[0].reuseExistingNotation, true);
  assert.equal(badges[1].reuseExistingNotation, undefined);
  assert.equal(badges[1].stackIndex, 0);
  assert.equal(bound.primitives.find(item => item.type === 'fallback-mark').stackIndex, 1);
});

test('the optional reuse callback cannot suppress other badge styles and omission preserves ordinary allocation', () => {
  const ordinary = { ...gapItem('I'), badgeStyle: 'local-judgment' };
  const bound = bindGapItems([ordinary, laterFallback()], () => { throw Error('only gap notation may query reuse'); });
  assert.equal(bound.primitives.find(item => item.type === 'fallback-mark').stackIndex, 1);
  const noCallback = bindGapItems([gapItem('I'), laterFallback()]);
  assert.equal(noCallback.primitives.find(item => item.type === 'fallback-mark').stackIndex, 1);
  assert.equal(noCallback.primitives.find(item => item.type === 'text-badge').reuseExistingNotation, undefined);
});

test('temporary SVG text measurement is cleaned up even when layout throws', () => {
  const svg = new Element('svg');
  assert.throws(() => withPlaqueTextMeasure(select(svg), () => { throw Error('layout failed'); }), /layout failed/);
  assert.equal(svg.children.length, 0);
});


test('extreme plaque scrolling keeps all rows and never passes navigation to the tree', () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ label: `field${i}`, value: `authored value ${i}` }));
  const rendered = drawPf({ rows });
  const viewport = rendered.elements.find(node => node.attrs['data-babel-plaque-viewport']);
  assert(viewport);
  const ring = viewport.parent.children.find(node => node.attrs['vector-effect'] === 'non-scaling-stroke');
  viewport.handlers.focus();
  assert.equal(ring.attrs.visibility, 'visible');
  assert.equal(Number(ring.attrs.height), Number(rendered.shell.attrs.height));
  viewport.handlers.blur();
  assert.equal(ring.attrs.visibility, 'hidden');
  const shell = { ...rendered.shell.attrs };
  const allText = rendered.layer.textContent;
  let prevented = 0, stopped = 0;
  const event = properties => ({ preventDefault() { prevented++; }, stopPropagation() { stopped++; }, ...properties });
  viewport.parent.handlers.wheel(event({ deltaY: 100, deltaMode: 0 }));
  assert.equal(Number(viewport.attrs['data-scroll-offset']), 100);
  viewport.parent.handlers.keydown(event({ key: 'End' }));
  assert.equal(viewport.attrs['data-scroll-offset'], viewport.attrs['data-scroll-max']);
  const last = rendered.texts.at(-1).children.at(-1);
  assert(Number(last.attrs.y) - Number(viewport.attrs['data-scroll-offset']) < Number(rendered.shell.attrs.y) + Number(rendered.shell.attrs.height));
  viewport.parent.handlers.keydown(event({ key: 'Home' }));
  viewport.parent.handlers.wheel(event({ deltaY: -100, deltaMode: 0 }));
  assert.equal(viewport.attrs['data-scroll-offset'], '0');
  viewport.parent.handlers.keydown(event({ key: 'Tab' }));
  assert.equal(prevented, 4);
  assert.equal(stopped, 4);
  assert.equal(rendered.layer.textContent, allText);
  assert.deepEqual(rendered.shell.attrs, shell);
  assertContained(rendered);
});
