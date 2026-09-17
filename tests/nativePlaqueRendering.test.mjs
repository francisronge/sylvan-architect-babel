import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as d3 from 'd3';
import { isReplayDisplayChild } from '../replay/displayIdentity.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import { compileRelationRenderPlan, planItemRelationRefs, planItemsShareAuthoredStage } from '../replay/relations/renderPlanCompiler.ts';
import { buildStagePlaqueLayout, treeLayoutSize } from '../replay/stageCamera.ts';
import { projectPlaqueLayout, placeStagePlaques } from '../replay/relations/plaquePlacement.ts';
import { applyVizIds, buildRenderableDerivationCanvasData, isSyntheticWorkspaceRootNode, isWordlessCategoryLeaf } from '../replay/replayCompiler.ts';
import { preparePfPlaqueTextLayout, reservePlaqueViewport } from '../replay/relations/plaqueTextLayout.ts';
import { appendPlaqueContent } from '../components/plaqueViewport.ts';
import { caseAssignmentPlaquePath, placeStackedRect } from '../replay/relations/overlayGeometry.ts';
import { bindRelationPlanFrame, FALLBACK_ROLE_STYLE } from '../replay/relations/geometryBinding.ts';
import { isTraceLike, formatAuthoredWitnessSurface, formatIndexedSurfaceForDisplayValue } from '../replay/replayCompiler.ts';

const source = readFileSync(new URL('../components/TreeVisualizer.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('TreeVisualizer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const findNode = (predicate) => {
  let found;
  const visit = node => {
    if (predicate(node)) found = node;
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.ok(found, 'the production painter must exist');
  return found;
};
const productionFunction = (name, dependencies = {}) => {
  const node = findNode(node => (ts.isVariableDeclaration(node) || ts.isFunctionExpression(node))
    && node.name?.getText(parsed) === name);
  const body = ts.isVariableDeclaration(node) ? node.initializer : node;
  return new Function(...Object.keys(dependencies), ts.transpile(`return (${body.getText(parsed)});`,
    { target: ts.ScriptTarget.ES2023 }))(...Object.values(dependencies));
};
const graphemes = text => Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text),
  ({ segment }) => segment);
const measureText = (text, style) => ({
  width: graphemes(text).length * (style.fontSize * 0.6 + style.letterSpacing),
  ascent: style.fontSize * 0.8,
  descent: style.fontSize * 0.2
});

// Run the production painter without a browser. Font rasterization and camera behavior are integration checks.
class Element {
  constructor(tag, attrs = {}) {
    this.tag = tag;
    this.attrs = attrs;
    this.styles = {};
    this.children = [];
    this.text = '';
  }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  get dataset() { return Object.fromEntries(Object.entries(this.attrs)
    .filter(([name]) => name.startsWith('data-'))
    .map(([name, value]) => [name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value])); }
  getScreenCTM() { return { d: 1 }; }
  get parentElement() { return this.parent; }
  closest(selector) { return matches(this, selector) ? this : this.parent?.closest(selector) ?? null; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 1600, bottom: 1100, width: 1600, height: 1100 }; }
  metrics() {
    return measureText(this.textContent, {
      fontSize: parseFloat(this.styles['font-size'] || 28),
      letterSpacing: parseFloat(this.styles['letter-spacing'] || 0)
    });
  }
  getBBox() {
    const { width, ascent, descent } = this.metrics();
    return { x: 0, y: -ascent, width, height: ascent + descent };
  }
  getComputedTextLength() { return this.metrics().width; }
}
const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
const matches = (node, selector) => selector.split(',').some(part =>
  (node.attrs.class || '').split(' ').includes(part.trim().replace(/^\./, '')));
class Selection {
  constructor(nodes) { this.items = nodes; }
  node() { return this.items[0] || null; }
  empty() { return this.items.length === 0; }
  nodes() { return this.items; }
  datum() { return this.node()?.datum; }
  append(tag) {
    return new Selection(this.items.map(parent => {
      const node = new Element(tag);
      node.parent = parent;
      parent.children.push(node);
      return node;
    }));
  }
  attr(name, value) {
    if (arguments.length === 1) return this.node()?.getAttribute(name);
    this.items.forEach(node => {
      const result = typeof value === 'function' ? value.call(node, node.datum) : value;
      if (result === null) delete node.attrs[name];
      else node.attrs[name] = String(result);
    });
    return this;
  }
  on(name, handler) { this.items.forEach(node => { (node.handlers ??= {})[name] = handler; }); return this; }
  style(name, value) { this.items.forEach(node => node.styles[name] = value); return this; }
  text(value) { this.items.forEach(node => { node.text = String(value); node.children = []; }); return this; }
  selectAll(selector) { return new Selection(this.items.flatMap(descendants).filter(node => matches(node, selector))); }
  select(selector) { return new Selection(this.items.flatMap(descendants).filter(node => matches(node, selector)).slice(0, 1)); }
  insert(tag) { return this.append(tag); }
  each(callback) { this.items.forEach(node => callback.call(node, node.datum)); return this; }
  filter(callback) { return new Selection(this.items.filter(node => callback.call(node, node.datum))); }
  remove() {
    this.items.forEach(node => node.parent.children.splice(node.parent.children.indexOf(node), 1));
    return this;
  }
}
const select = node => new Selection([node]);

test('the production Control connector lays out without a domain rectangle', () => {
  const layer = new Element('g');
  const path = select(layer).append('path').attr('class', 'babel-control-dependency')
    .attr('data-control-controller', 'controller').attr('data-control-controllee', 'subject');
  const rects = { controller: { x: 100, y: 100, width: 40, height: 30 }, subject: { x: 300, y: 300, width: 40, height: 30 } };
  const refine = productionFunction('refineControlRelation', {
    d3: { select }, measuredTerminalSubtreesRect: () => null, measuredSubtreeRect: () => null,
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
    terminal.datum = { id };
    terminal.getBoundingClientRect = () => ({ left: i * 100, right: i * 100 + 40, top: 100, bottom: 120 });
    if (id !== 'unrelated') host.append('g').attr('class', 'vr-idiom-chunk-anchor').attr('data-idiom-chunk', id);
  }
  const refine = productionFunction('refineIdiomChunkRelation', {
    d3: { select }, g: select(root), measuredSubtreeRect: () => null,
    labelBelongsToNode: productionFunction('labelBelongsToNode', { d3: { select }, isReplayDisplayChild }),
    treeMatrix: { inverse: () => ({}) },
    DOMPoint: class { constructor(x, y) { this.x = x; this.y = y; } matrixTransform() { return this; } },
    postFitNodeById: new Map(['a', 'b'].map(id => [id, { descendants: () => [{ id }] }])), getNodeId: n => n.id
  });
  refine.call(layer.node());
  assert.deepEqual(layer.selectAll('.babel-idiom-chunk-underline').nodes().map(n => n.attrs.d),
    ['M 0.0 127.0 H 40.0', 'M 100.0 127.0 H 140.0']);
  assert(layer.select('.babel-idiom-domain-bracket').empty());
});

const drawPlaqueText = productionFunction('drawPlaqueText');
const withPlaqueTextMeasure = productionFunction('withPlaqueTextMeasure');

const plaqueBranch = findNode(node => ts.isIfStatement(node)
  && node.expression.getText(parsed) === "primitive.type === 'plaque'");
const drawSavedPlaque = (primitive, item, items, layout, nodes, played, stageIndex) => {
  const root = new Element('g');
  const host = select(root);
  const queued = [];
  const rectFor = id => {
    const node = nodes.get(id);
    return node ? { x: node.x - 40, y: node.y - 30, width: 80, height: 60 } : null;
  };
  const dependencies = {
    primitive, planItem: item, frameItems: items, host, g: host, emphasis: null,
    planItemsShareAuthoredStage,
    replayPlaqueLayout: layout, drawPlaqueText, reservePlaqueViewport, appendPlaqueContent,
    queueAcceptedRelationDraw: (_item, _emphasis, draw) => queued.push(draw),
    measuredTerminalSubtreeRectNow: rectFor, measuredTreeLabelRectNow: rectFor,
    ensureFeatureRelationLayer: () => host,
    revealedItemIndices: new Set(items.map((_, index) => index)),
    resolveOverlayAnchor: id => nodes.get(id), getNodeId: node => node.__vizId ?? node.data.id
  };
  new Function(...Object.keys(dependencies), ts.transpile(plaqueBranch.getText(parsed),
    { target: ts.ScriptTarget.ES2023 }))(...Object.values(dependencies));
  queued.forEach(draw => draw());
  if (primitive.plaqueStyle === 'feature') {
    const before = svgSnapshot(root);
    const refine = productionFunction('refineFeaturePlaques', {
      g: host, d3: { select },
      measuredTerminalSubtreesRect: () => { throw Error('Accepted plaque must not be repositioned from screen measurements'); }
    });
    refine();
    assert.deepEqual(svgSnapshot(root), before, 'deferred refinement must not move an accepted plaque');
  }
  if (primitive.plaqueStyle === 'realization') {
    const painter = productionFunction('renderPfRealizationPlate', {
      d3: { select }, svg: select(new Element('svg')),
      playedRelationIndices: played, activeDerivationFrameIndex: stageIndex,
      measuredTerminalSubtreesRect: ids => rectFor(ids[0]), measuredShellRect: rectFor,
      measuredTerminalRect: () => null, unionRects: rects => rects[0],
      replayPlaqueLayout: layout, withPlaqueTextMeasure, preparePfPlaqueTextLayout, drawPlaqueText, reservePlaqueViewport, appendPlaqueContent
    });
    host.selectAll('.babel-pf-relation-layer').each(painter);
  }
  return root;
};
const svgSnapshot = node => ({ tag: node.tag, attrs: node.attrs, styles: node.styles,
  text: node.text, children: node.children.map(svgSnapshot) });

const caseBranch = findNode(node => ts.isIfStatement(node)
  && node.expression.getText(parsed).includes("primitive.shapeStyle === 'case-assignment'"));
function drawCasePlaque(item, placement, assigner, frameItems = [item], revealed = frameItems.map((_, i) => i)) {
  const root = new Element('g');
  const dependencies = {
    planItem: item, emphasis: null, opacity: null, frameItems, planItemsShareAuthoredStage,
    queueAcceptedRelationDraw: (_item, _emphasis, draw) => draw(),
    relationLayerKey: () => 'case', renderedCaseCompositions: new Set(), revealedItemIndices: new Set(revealed),
    ensureFeatureRelationLayer() {}, ensureAgreementCaseRelationLayer: () => select(root),
    acceptedTerminalRect: () => assigner, acceptedAnchorRect: () => assigner,
    markPreterminalLensNode() {}, replayPlaqueLayout: new Map([[0, placement]]),
    focusedRelationMoment: null, decorateRelationElement() {}, relationEmphasisForItem: () => null,
    activeDerivationFrameIndex: 0, caseAssignmentPlaquePath
  };
  new Function(...Object.keys(dependencies), ts.transpile(caseBranch.thenStatement.getText(parsed),
    { target: ts.ScriptTarget.ES2023 }))(...Object.values(dependencies));
  return root;
}

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
  assert.equal(layout.get(0).height, 200, 'reserve both authored rows');
  const painted = drawCasePlaque(item, layout.get(0), { x: 0, y: 0, width: 100, height: 60 }, [item, bundle]);
  assert(descendants(painted).some(node => node.text === '[number: plural]'), 'the later bundle contributes its row');
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
    const box = { x, y, width: 310, height: 138 };
    const painted = drawCasePlaque(item, box, assigner);
    const all = descendants(painted);
    const shell = all.find(node => matches(node, '.babel-feature-plaque-shell'));
    assert.equal(Number(shell.attrs.x), x);
    assert.equal(Number(shell.attrs.y), y);
    const path = all.find(node => matches(node, '.babel-case-assignment-path'));
    assert(path.attrs['marker-end']);
    const points = path.attrs.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    assert.equal(points.length, 8);
    for (let i = 0; i <= 100; i++) {
      const t = i / 100, u = 1 - t;
      const px = u ** 3 * points[0] + 3 * u * u * t * points[2] + 3 * u * t * t * points[4] + t ** 3 * points[6];
      const py = u ** 3 * points[1] + 3 * u * u * t * points[3] + 3 * u * t * t * points[5] + t ** 3 * points[7];
      assert(!(px > x && px < x + box.width && py > y && py < y + box.height), 'Case connector entered the plaque');
    }
    assert(all.some(node => node.text === '[Case: accusative]'));
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
        productionFunction('alignReplayUnaryTerminalLeaves', {
          replayVisibleNodeIdSet: visible, getNodeId: node => node.__vizId ?? node.data.id,
          isSyntheticWorkspaceRootNode, isWordlessCategoryLeaf
        })(tree);
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
  const fullLayout = preparePfPlaqueTextLayout(rows.map((row, index) => ({ ...row, kind: kinds[index] || 'literal', rowIndex: index })), { measureText });
  const target = { x: 600, y: 400, width: 80, height: 60 };
  const draw = productionFunction('renderPfRealizationPlate', {
    d3: { select }, svg: select(svgRoot), g: select(new Element('g')),
    playedRelationIndices: played, activeDerivationFrameIndex: stage,
    measuredTerminalSubtreesRect: () => target, measuredShellRect: () => target,
    measuredTerminalRect: () => null, unionRects: rects => rects[0],
    treeMatrix: { inverse: () => ({ scale: 1 / zoom }) },
    DOMPoint: class {
      constructor(x, y) { this.x = x; this.y = y; }
      matrixTransform(matrix) { return { x: this.x * matrix.scale, y: this.y * matrix.scale }; }
    },
    replayPlaqueLayout: new Map([[0, { x: 700, y: 550, location: 'below', domainId: 'head', ...(fullLayout.overflow ? { scrollHeight: fullLayout.height } : {}) }]]),
    withPlaqueTextMeasure, preparePfPlaqueTextLayout, drawPlaqueText, reservePlaqueViewport, appendPlaqueContent
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
  assert.equal(text.textContent, `realization: ${rows[0].value}`);
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
    assert.deepEqual(group.children.map(node => node.textContent), [rows[index].label, '\u2192', rows[index].value]);
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
  assert.equal(Number(literal.shell.attrs.width), 590);
  assert.equal(literal.elements.filter(node => matches(node, '.babel-pf-plate-arrow')).length, 0);
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

test('PF wrapping preserves whitespace, graphemes, empty values and explicit line breaks', () => {
  const literal = ' e\u0301\u{1f469}\u200d\u{1f4bb}\u4e2d  '.repeat(20);
  const rows = [{ label: '', value: literal, rowIndex: 0, isFinal: false },
    { label: '', value: '', rowIndex: 1, isFinal: false },
    { label: '', value: 'first\n\nlast', rowIndex: 2, isFinal: true }];
  const layout = preparePfPlaqueTextLayout(rows, { measureText });
  const lines = layout.rows[0].parts[0].block.lines.map(line => line.text);
  assert.equal(lines.join(''), literal);
  assert.deepEqual(lines.flatMap(graphemes), graphemes(literal));
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

const gapBranch = findNode(node => ts.isIfStatement(node)
  && node.expression.getText(parsed) === "primitive.badgeStyle === 'gap-notation' && primitive.reuseExistingNotation");
const drawGap = new Function('host', 'primitive', ts.transpile(
  `${gapBranch.getText(parsed)}\nreturn 'draw-extra-label';`, { target: ts.ScriptTarget.ES2023 }));
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
  const predicate = productionFunction('hasExistingGapNotation', {
    g: select(root), isTraceLike, formatAuthoredWitnessSurface, formatIndexedSurfaceForDisplayValue,
    labelBelongsToNode: productionFunction('labelBelongsToNode', { d3: { select }, isReplayDisplayChild })
  });
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
  const result = drawGap(select(host), bound.primitives[0]);
  assert.equal(root.textContent, before, 'reuse must never replace authored occurrence notation');
  return { result, host };
};

test('Tier2 category-labelled trace reuses the exact existing I instead of drawing a floating I', () => {
  const { result, host } = gapLabels([{ text: 'I' }], 'I');
  assert.equal(result, undefined);
  assert.equal(host.attrs['data-gap-notation-reuses'], 'lower');
});

test('the same exact gap notation reuses its occurrence independently of relation tier or family', () => {
  for (const familyId of ['tier2.gap-notation', 'trajectory.across-the-board', 'trajectory.sideward', 'parasitic-gap.composition']) {
    const { result, host } = gapLabels([{ text: 't', kind: 'terminal' }], 't', 'lower', familyId);
    assert.equal(result, undefined);
    assert.equal(host.attrs['data-gap-notation-reuses'], 'lower');
  }
});

test('Tier2 t notation and silent-copy words reuse the existing occurrence, including formatted subscripts', () => {
  for (const [text, original, notation] of [['t', 't', 't'], ['t\u2081', 't_i', 't_i'], ['John\u2081', 'John', 'John']]) {
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

test('stacked linguistic notation keeps automatic-fit size and spacing through manual zoom and redraw', () => {
  const root = new Element('g');
  const appendMarker = productionFunction('appendMarker', { primitiveHost: select(root), markerScale: 2, badgeGap: 46 });
  const notation = appendMarker(100, 200, true).node();
  const second = appendMarker(192, 200, true, 1).node();
  const locator = appendMarker(100, 240).node();
  const manualCameraRef = { current: null };
  const data = {};
  let camera;
  const fit = productionFunction('applyFittedCamera', {
    g: select(root), manualCameraRef, data, derivationStagesSignature: 'stage',
    containerWidth: 1600, containerHeight: 1100, stagePlaqueContainmentBounds: null, stageCameraBounds: null,
    d3, fitFallbackOverlays: undefined, applyCameraTransform: transform => { camera = transform; }
  });
  const automatic = d3.zoomIdentity.scale(0.5);
  fit(automatic);
  assert.equal(notation.attrs.transform, 'translate(100,200) scale(2)');
  assert.equal(second.attrs.transform, 'translate(192,200) scale(2)');
  assert.equal(locator.attrs.class, 'vr-overlay-marker');
  assert.equal(notation.attrs.class, 'vr-tree-notation');
  manualCameraRef.current = { data, signature: 'stage', width: 1600, height: 1100,
    transform: d3.zoomIdentity.translate(20, 30).scale(2) };
  // The geometry binder observes the retained manual zoom during a redraw.
  const redraw = productionFunction('appendMarker', { primitiveHost: select(root), markerScale: 0.5, badgeGap: 46 });
  const redrawnSecond = redraw(123, 200, true, 1).node();
  fit(automatic);
  assert.equal(camera.k, 2);
  assert.equal(notation.attrs.transform, 'translate(100,200) scale(2)',
    'redrawing under manual zoom must not shrink notation back to screen size');
  assert.equal(redrawnSecond.attrs.transform, second.attrs.transform,
    'stacked labels must retain their spacing after redraw at a different camera scale');
});

test('fallback role and authored array position share one tree coordinate group', () => {
  const branch = findNode(node => ts.isIfStatement(node)
    && node.expression.getText(parsed) === "primitive.type === 'fallback-mark'");
  for (const frame of ['circle', 'box']) {
    const root = new Element('g');
    const primitive = { type: 'fallback-mark', nodeId: 'owned', x: 100, y: 200,
      stackIndex: 1, frame, instance: 2, numeral: 3, backward: true, role: 'members', text: 'members[3]' };
    const groups = new Map();
    new Function('primitive', 'host', 'markerScale', 'fallbackMarkGroups', 'FALLBACK_ROLE_STYLE', ts.transpile(branch.getText(parsed),
      { target: ts.ScriptTarget.ES2023 }))(primitive, select(root), 2, groups, FALLBACK_ROLE_STYLE);
    const marker = root.children[0];
    assert.equal(marker.attrs.class, 'vr-fallback-mark');
    assert.equal(marker.attrs.transform, 'translate(100,200) scale(2)');
    assert.deepEqual(marker.children.map(child => [child.tag, child.text]),
      [['text', 'members[3]']]);
    assert.equal(marker.attrs['data-authored-role'], 'members');
    assert.ok(marker.children.every(child => child.attrs.transform === undefined));
    assert.ok(groups.has(primitive), 'Fit targets this exact owned group');
  }
  const data = {};
  const manualCameraRef = { current: null };
  const fitScales = [];
  const fitViewports = [];
  let camera;
  const fit = productionFunction('applyFittedCamera', {
    g: select(new Element('g')), manualCameraRef, data, derivationStagesSignature: 'stage',
    containerWidth: 1600, containerHeight: 1100, stagePlaqueContainmentBounds: null, stageCameraBounds: null,
    fitLeft: 40, fitRight: 1560, fitTop: 100, fitBottom: 700,
    d3, fitFallbackOverlays: (scale, viewport) => { fitScales.push(scale); fitViewports.push(viewport); },
    applyCameraTransform: transform => { camera = transform; }
  });
  fit(d3.zoomIdentity.scale(0.5));
  manualCameraRef.current = { data, signature: 'stage', width: 1600, height: 1100,
    transform: d3.zoomIdentity.translate(20, 30).scale(2) };
  fit(d3.zoomIdentity.scale(0.5));
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
