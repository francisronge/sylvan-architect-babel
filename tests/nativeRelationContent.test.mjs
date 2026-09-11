import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { hierarchy } from 'd3';
import {
  compileRelationRenderPlan,
  resolveDisplayedTrajectoryAttachments
} from '../replay/relations/renderPlanCompiler.ts';
import { nativeLinearizationPlateHeight, prepareNativePlaqueContent } from '../replay/relations/nativeDrawingContent.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { planAnchorSetLayout } from '../replay/relations/overlayGeometry.ts';
import { availableTreeViewport, linearizationViewport } from '../components/treeViewport.ts';

const source = readFileSync(new URL('../components/TreeVisualizer.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('TreeVisualizer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = (name) => {
  let found;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name) found = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.ok(found, `${name} must be the production drawing function`);
  return ts.transpile(`const draw = ${found.getText(parsed)};`, { target: ts.ScriptTarget.ES2023 });
};

// Execute the production drawing function with a minimal SVG/selection double.
// Browser checks verify geometry and styling.
class Element {
  constructor(tag, attrs = {}, datum) {
    this.tag = tag;
    this.attrs = attrs;
    this.datum = datum;
    this.children = [];
    this.textContent = '';
    this.rect = { left: 0, top: 0, right: 50, bottom: 30, width: 50, height: 30 };
  }
  getAttribute(name) { return this.attrs[name] ?? null; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getBoundingClientRect() { return this.rect; }
  getScreenCTM() { return { a: 1, b: 0, inverse() { return this; } }; }
  appendChild(node) { node.parentNode = this; this.children.push(node); }
  insertBefore(node, before) {
    node.parentNode = this;
    const index = this.children.indexOf(before);
    this.children.splice(index < 0 ? this.children.length : index, 0, node);
  }
}
const descendants = (node) => node.children.flatMap((child) => [child, ...descendants(child)]);
const matches = (node, selector) => selector.split(',').some((part) =>
  part.trim().split('.').filter(Boolean).every((name) => (node.attrs.class || '').split(' ').includes(name)));
class Selection {
  constructor(nodes) { this.items = nodes; }
  node() { return this.items[0] || null; }
  nodes() { return this.items; }
  append(tag) {
    return new Selection(this.items.map((parent) => {
      const node = new Element(tag);
      parent.appendChild(node);
      return node;
    }));
  }
  attr(name, value) {
    if (arguments.length === 1) return this.node()?.getAttribute(name);
    this.items.forEach((node) => value === null ? delete node.attrs[name] : node.setAttribute(name, value));
    return this;
  }
  style() { return this; }
  text(value) {
    this.items.forEach((node) => { node.textContent = String(value); node.children = []; });
    return this;
  }
  classed(name, enabled) {
    this.items.forEach((node) => {
      const classes = new Set((node.attrs.class || '').split(' ').filter(Boolean));
      enabled ? classes.add(name) : classes.delete(name);
      node.attrs.class = [...classes].join(' ');
    });
    return this;
  }
  selectAll(selector) { return new Selection(this.items.flatMap(descendants).filter((node) => matches(node, selector))); }
  select(selector) { return new Selection(this.selectAll(selector).items.slice(0, 1)); }
  filter(callback) { return new Selection(this.items.filter((node, index) => callback.call(node, node.datum, index))); }
  each(callback) { this.items.forEach((node, index) => callback.call(node, node.datum, index)); return this; }
  remove() {
    this.items.forEach((node) => { if (node.parentNode) node.parentNode.children = node.parentNode.children.filter((child) => child !== node); });
    return this;
  }
}

const forest = [{ id: 'root', label: 'DP', children: [{ id: 'mid', label: 'NP', children: [
  { id: 'a', label: 'N', word: 'Mia', tokenIndex: 0, children: [] }
] }] }];
const stage = (relations, workspaceForest = forest) => ({ statement: 'Test', stageRecord: 'Test', relations, workspaceForest });
const compile = (relation, workspaceForest = forest) => compileRelationRenderPlan([stage([relation], workspaceForest)]);
const rawGuard = new Proxy({}, { get() { throw Error('Native drawing reread raw authored content'); } });
const guarded = (items) => items.map((item) => ({ ...item,
  relationRef: { ...item.relationRef, anchors: rawGuard, priorAnchors: rawGuard, values: rawGuard }
}));

function drawNative(name, items, workspaceForest = forest, drawItems = items) {
  const root = new Element('g');
  const treeData = hierarchy(workspaceForest[0]);
  const byId = new Map(treeData.descendants().map((node) => [node.data.id, node]));
  treeData.descendants().forEach((node, index) => {
    for (const kind of ['category', ...(node.data.word ? ['terminal'] : [])]) {
      const label = new Element('text', { class: `${kind}-label`,
        [kind === 'category' ? 'data-category-node-id' : 'data-node-id']: node.data.id }, node);
      label.textContent = kind === 'category' ? node.data.label : node.data.word;
      if (name === 'scheduleAcceptedCyclicLinearization') label.closest = () => null;
      label.rect = { left: index * 80, right: index * 80 + 50, top: index * 90,
        bottom: index * 90 + 30, width: 50, height: 30 };
      root.appendChild(label);
    }
  });
  const g = new Selection([root]);
  const svgElement = new Element('svg');
  svgElement.rect = { left: 0, top: 0, right: 1600, bottom: 1100, width: 1600, height: 1100 };
  const dependencies = {
    g, svg: new Selection([svgElement]), frameItems: guarded(items), drawItems: guarded(drawItems), treeData,
    overlayNodeById: byId, resolveOverlayAnchor: (id) => byId.get(id),
    relationLayerKey: (item) => `${item.relationRef.stageIndex}:${item.relationRef.relationIndex}`,
    queueAcceptedRelationDraw: (_item, _emphasis, callback) => callback(),
    exactScreenTreeLabelRectNow: () => ({ x: 0, y: 0, width: 260, height: 280 }),
    exactScreenDirectTreeLabelRectNow: () => ({ x: 0, y: 0, width: 50, height: 30 }),
    exactScreenTreeLabelRectForNodeIdsNow: () => ({ x: 0, y: 0, width: 260, height: 280 }),
    getNodeId: (node) => node.data.id,
    markPreterminalLensNode() {}, markSubtreeLensNodes() {},
    isDisplayTerminalNode: (node) => Boolean(node.data.word),
    resolveLeafSurface: (node) => node.data.word || node.data.label,
    isTraceLike: () => false,
    isNullLike: (value) => value === '∅',
    fitDeferredOverlayToCompactViewport() {},
    planAnchorSetLayout, nativeLinearizationPlateHeight,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    containerWidth: 1600, containerRef: { current: null }, uiBounds: {}, availableTreeViewport, linearizationViewport,
    d3: { select: (node) => new Selection([node]) },
    document: { createElementNS: (_namespace, tag) => new Element(tag) },
    DOMPoint: class {
      constructor(x, y) { this.x = x; this.y = y; }
      matrixTransform() { return this; }
    }
  };
  const run = new Function(...Object.keys(dependencies), `
    const scheduledAcceptedPfRelations = new Set();
    const scheduledAcceptedSharingRelations = new Set();
    let scopeInformationPathLayer = null, scopeInformationMarkLayer = null;
    const acceptedRelationDrawingKey = (() => { ${declaration('acceptedRelationDrawingKey')} return draw; })();
    ${declaration(name)}
    for (const item of drawItems) draw(item, null);
  `);
  run(...Object.values(dependencies));
  return (className) => descendants(root).filter((node) => matches(node, `.${className}`));
}

test('native FProjection draws identical verified hops and literal annotations for equivalent Tier-1 roles', () => {
  const variants = [
    { accentBearer: 'a', projections: ['mid', 'root'] },
    { accentBearer: 'a', projectionNodes: ['mid', 'root'] },
    { accented: 'a', projectionNodes: ['mid', 'root'] }
  ];
  for (const anchors of variants) {
    const relation = { relation: 'FProjection', anchors, values: { feature: 'F', accent: 'H*' } };
    const original = structuredClone(relation);
    const plan = compile(relation);
    assert.equal(plan.diagnostics.length, 0);
    const svg = drawNative('scheduleAcceptedScopeInformationRelation', plan.frames[0].items);
    assert.deepEqual(svg('babel-f-projection-path').map((node) =>
      [node.attrs['data-projection-from'], node.attrs['data-projection-to']]), [['a', 'mid'], ['mid', 'root']]);
    assert.deepEqual(svg('babel-f-projection-feature').map((node) => node.textContent), ['F', 'F', 'F']);
    assert.deepEqual(svg('babel-f-projection-accent').map((node) => node.textContent), ['H*']);
    assert.deepEqual(relation, original);
  }
});

test('native sibling focus and storage claims both draw once in either item order', () => {
  const plan = compile({ relation: 'IndependentNativeClaims',
    anchors: { accentBearer: 'a', projectionNodes: ['mid', 'root'], scope: 'root' },
    values: { feature: 'F', accent: 'H*', category: 'S', qstore: ['Q_i'] }
  });
  assert.deepEqual(plan.diagnostics, []);
  const items = plan.frames[0].items;
  assert.equal(items.filter((item) => item.pathStyle === 'f-projection').length, 2);
  assert.equal(items.filter((item) => item.nativeContent?.kind === 'cooper-storage').length, 1);
  for (const ordered of [items, [...items].reverse()]) {
    const svg = drawNative('scheduleAcceptedScopeInformationRelation', ordered);
    assert.equal(svg('babel-f-projection-path').length, 2);
    assert.equal(svg('babel-f-projection-feature').length, 3);
    assert.equal(svg('babel-f-projection-accent').length, 1);
    assert.equal(svg('babel-cooper-storage-plaque').length, 1);
    assert.equal(svg('babel-cooper-storage-connector').length, 1);
  }
});

test('native repeated visits to one prepared family still schedule a single draw', () => {
  for (const relation of [
    { relation: 'FProjection', anchors: { accentBearer: 'a', projections: ['mid', 'root'] },
      values: { feature: 'F', accent: 'H*' } },
    { relation: 'CooperStorage', anchors: { scope: 'root' }, values: { category: 'S', qstore: ['Q_i'] } }
  ]) {
    const items = compile(relation).frames[0].items;
    const svg = drawNative('scheduleAcceptedScopeInformationRelation', items, forest, [...items, items[0]]);
    if (relation.relation === 'FProjection') {
      assert.equal(svg('babel-f-projection-path').length, 2);
      assert.equal(svg('babel-f-projection-feature').length, 3);
      assert.equal(svg('babel-f-projection-accent').length, 1);
    } else {
      assert.equal(svg('babel-cooper-storage-plaque').length, 1);
      assert.equal(svg('babel-cooper-storage-connector').length, 1);
    }
  }
});

test('native recovered argument-sharing draws its domains without requiring a role badge', () => {
  for (const values of [undefined, { roles: 'Theme_i: literal' }]) {
    const relation = { relation: 'IndependentArgumentSharing',
      anchors: { predicateDomains: ['root', 'mid'], sharedArgument: 'a' },
      ...(values ? { values } : {})
    };
    const original = structuredClone(relation);
    const plan = compile(relation);
    assert.deepEqual(plan.diagnostics, []);
    const items = plan.frames[0].items;
    const domains = items.filter((item) => item.domainStyle === 'argument-domain');
    assert.equal(domains.length, 2);
    assert.ok(domains.every((item) => item.tier2FacetId === 'argument-sharing' && item.sharedNodeId === 'a'));
    assert.equal(items.filter((item) => item.badgeStyle === 'shared-object').length, values ? 1 : 0);
    const svg = drawNative('scheduleAcceptedSharingRelation', items);
    assert.deepEqual(svg('babel-argument-sharing-domain').map((node) => node.attrs['data-shared-node']), ['a', 'a']);
    assert.equal(svg('babel-argument-sharing-object-box').length, values ? 1 : 0);
    assert.deepEqual(svg('babel-argument-sharing-object-label').map((node) => node.textContent),
      values ? ['Theme_i: literal'] : []);
    assert.deepEqual(relation, original);
  }
});

test('native curated argument-sharing carries its shared anchor on each domain', () => {
  const plan = compile({ relation: 'ArgumentSharing', anchors: { domains: ['root', 'mid'], shared: 'a' },
    values: { role: 'OBJ' } });
  assert.deepEqual(plan.diagnostics, []);
  const items = plan.frames[0].items;
  assert.deepEqual(items.filter((item) => item.domainStyle === 'argument-domain')
    .map((item) => item.sharedNodeId), ['a', 'a']);
  const svg = drawNative('scheduleAcceptedSharingRelation', items);
  assert.equal(svg('babel-argument-sharing-domain').length, 2);
  assert.deepEqual(svg('babel-argument-sharing-object-label').map((node) => node.textContent), ['OBJ']);
});

test('native cyclic comparison and height use prepared columns for canonical and equivalent order roles', () => {
  const ids = ['one', 'two', 'three', 'four', 'five'];
  const forest = [{ id: 'root', label: 'TP', children: ids.map((id) => ({ id, label: 'D', word: id, children: [] })) }];
  let canonical;
  for (const role of ['order', 'sequence', 'precedence order']) {
    const relation = { relation: 'CyclicLinearization', anchors: { [role]: ids },
      priorAnchors: { [role]: ids }, values: { outcome: 'conflict' } };
    const original = structuredClone(relation);
    const plan = compileRelationRenderPlan([stage([], forest), stage([relation], forest)]);
    assert.deepEqual(plan.diagnostics, []);
    const items = plan.frames[1].items;
    const plaque = items.find((item) => item.plaqueStyle === 'linearization');
    assert.equal(plaque.nativeContent.kind, 'linearization');
    canonical ??= plaque.nativeContent;
    assert.deepEqual(plaque.nativeContent, canonical);
    const svg = drawNative('scheduleAcceptedCyclicLinearization', items, forest);
    assert.deepEqual(svg('babel-linearization-row').map((node) => node.textContent),
      [...Array(2)].flatMap(() => ['one < two', 'two < three', 'three < four', 'four < five']));
    assert.equal(svg('babel-linearization-failure-mark').length, 1);
    assert.equal(svg('babel-pf-morphology-shell')[0].attrs.height, '138.0');
    assert.equal(nativeLinearizationPlateHeight(plaque.nativeContent), 138);
    assert.deepEqual(relation, original);
  }
});

test('native cyclic comparison does not depend on a large-array rail', () => {
  const relation = { relation: 'CyclicLinearization', anchors: { sequence: ['a', 'mid'] },
    priorAnchors: { order: ['mid', 'a'] } };
  const plan = compileRelationRenderPlan([stage([]), stage([relation])]);
  assert.deepEqual(plan.diagnostics, []);
  assert.equal(plan.frames[1].items.some((item) => item.kind === 'anchor-set'), false);
  const svg = drawNative('scheduleAcceptedCyclicLinearization', plan.frames[1].items);
  assert.equal(svg('babel-linearization-row').length, 2);
  assert.equal(svg('babel-pf-morphology-title')[0].textContent, 'ORDERING');
});

test('native dependent-case elbow uses the prepared step, including the unchanged absent-step default', () => {
  let branch;
  const visit = (node) => {
    if (ts.isIfStatement(node) && node.expression.getText(parsed) === "primitive.shapeStyle === 'dependent-case'") {
      branch = node.thenStatement;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.ok(branch);
  const elbows = [];
  for (const stepValue of ['1', ['1'], '2', undefined]) {
    const plan = compile({ relation: 'DependentCase', anchors: { searcher: 'a', licensee: 'mid' },
      values: { probeLabel: 'UNM', goalLabel: 'ACC', ...(stepValue === undefined ? {} : { step: stepValue }) } });
    const item = plan.frames[0].items.find((candidate) => candidate.pathStyle === 'dependent-case');
    const bound = bindRelationPlanFrame(plan, 0, () => ({ x: 100, y: 100 }));
    const primitive = bound.primitives.find((candidate) => candidate.shapeStyle === 'dependent-case');
    assert.ok(primitive);
    const root = new Element('g');
    const rectFor = (id) => ({ x: id === 'a' ? 100 : 350, y: id === 'a' ? 100 : 280, width: 50, height: 30 });
    const dependencies = { planItem: guarded([item])[0], primitive, emphasis: null, opacity: null,
      queueAcceptedRelationDraw: (_item, _emphasis, draw) => draw(),
      acceptedAnchorRect: rectFor, acceptedTerminalRect: rectFor,
      ensureAgreementCaseRelationLayer: () => new Selection([root]), markPreterminalLensNode() {} };
    new Function(...Object.keys(dependencies), ts.transpile(branch.getText(parsed), { target: ts.ScriptTarget.ES2023 }))
      (...Object.values(dependencies));
    const nodes = descendants(root);
    assert.deepEqual(nodes.filter((node) => node.tag === 'text').map((node) => node.textContent), ['UNM', 'ACC']);
    elbows.push(nodes.find((node) => node.attrs.class === 'babel-dependent-case-elbow').attrs.d);
  }
  assert.equal(elbows[0], elbows[1]);
  assert.equal(elbows[2], elbows[3]);
  assert.notEqual(elbows[0], elbows[2]);
});

test('native theta uses prepared literal roles and associations, never the raw anchor keys', () => {
  const plan = compile({ relation: 'ThetaAssignment', anchors: { predicate: 'a', Theme: 'mid' } });
  const grid = plan.frames[0].items.find((item) => item.kind === 'node-plaque');
  grid.thetaRoles = [{ nodeId: 'mid', label: 'Theme_i: literal' }];
  const svg = drawNative('scheduleAcceptedThetaGrid', plan.frames[0].items);
  assert.deepEqual(svg('babel-theta-grid-role').map((node) => node.textContent), ['Theme_i: literal']);
  assert.equal(svg('babel-theta-terminal-index').length, 1);
});

test('approved complement-to-head focus projection uses one shared proof for canonical and equivalent roles', () => {
  const forest = [{ id: 'clause', label: 'TP', children: [{ id: 'vp', label: 'VP', children: [
    { id: 'head', label: 'V', word: 'praised', children: [] },
    { id: 'object', label: 'DP', children: [{ id: 'accent', label: 'D', word: 'John', children: [] }] }
  ] }] }];
  for (const anchors of [
    { accentBearer: 'accent', projections: ['head', 'vp', 'clause'] },
    { accented: 'accent', projectionNodes: ['head', 'vp', 'clause'] }
  ]) {
    const plan = compile({ relation: 'FProjection', anchors, values: { feature: 'F', accent: 'H*' } }, forest);
    assert.deepEqual(plan.diagnostics, []);
    assert.equal(plan.frames[0].items[0].projectionTargetAttachment, 'terminal');
    const svg = drawNative('scheduleAcceptedScopeInformationRelation', plan.frames[0].items, forest);
    assert.deepEqual(svg('babel-f-projection-path').map((node) =>
      [node.attrs['data-projection-from'], node.attrs['data-projection-to']]),
    [['accent', 'head'], ['head', 'vp'], ['vp', 'clause']]);
    assert.deepEqual(svg('babel-f-projection-feature').map((node) => node.textContent), ['F', 'F', 'F', 'F']);
  }
  const unrelated = { id: 'unrelated', label: 'V', word: 'left', children: [] };
  for (const projections of [['unrelated', 'vp'], ['head', 'vp', 'object'], ['head', 'head', 'vp']]) {
    const plan = compile({ relation: 'FProjection', anchors: { accentBearer: 'accent', projections },
      values: { feature: 'F' } }, [...forest, unrelated]);
    assert.ok(plan.diagnostics.some((diagnostic) => diagnostic.kind === 'illegal-configuration'));
    assert.equal(plan.frames[0].items.some((item) => item.pathStyle === 'f-projection'), false);
  }
});

test('native PF correspondence draws the explicit prepared association indices', () => {
  const plan = compile({ relation: 'ManyToManyCorrespondence', anchors: { word: 'a' },
    values: { sources: ['T', 'V'], exponents: ['did', 'go'], correspondence: ['T=>did', 'V=>go', 'T=>go'] } });
  const svg = drawNative('scheduleAcceptedPfRelation', plan.frames[0].items);
  assert.deepEqual(svg('babel-pf-correspondence-source').map((node) => node.textContent), ['T', 'V']);
  assert.deepEqual(svg('babel-pf-correspondence-exponent').map((node) => node.textContent), ['did', 'go']);
  assert.equal(svg('babel-pf-correspondence-link').length, 3);
});

test('native morphology consumes verified bundles and delinking position', () => {
  const fission = compile({ relation: 'Fission', anchors: { outputs: ['a', 'mid'] }, values: {
    inputFeatures: ['phi', 'phi'], outputOneFeatures: ['person'], outputTwoFeatures: ['number']
  } });
  const fissionSvg = drawNative('scheduleAcceptedPfMorphologyRelation', fission.frames[0].items);
  assert.deepEqual(fissionSvg('babel-fission-bundle-row').map((node) => node.textContent), ['phi', 'phi', 'person', 'number']);
  const impoverishment = compile({ relation: 'Impoverishment', anchors: { terminal: 'a' }, values: {
    featureHierarchy: ['person', 'number', 'plural'], delinkAfter: 'number'
  } });
  const impoverishmentSvg = drawNative('scheduleAcceptedPfMorphologyRelation', impoverishment.frames[0].items);
  assert.equal(impoverishmentSvg('babel-impoverishment-cross').length, 2);
  assert.deepEqual(impoverishmentSvg('babel-impoverishment-output').map((node) => node.textContent), ['person', 'number']);
});

test('native Cooper ledger preserves repeated values without reading the authored record', () => {
  const plan = compile({ relation: 'CooperStorage', anchors: { scope: 'root' },
    values: { category: 'S', qstore: ['Q_i', 'Q_i'], retrieved: ['Q_j'] } });
  const svg = drawNative('scheduleAcceptedScopeInformationRelation', plan.frames[0].items);
  assert.deepEqual(svg('babel-cooper-storage-value').map((node) => node.textContent), ['S', '[Q_i, Q_i]', '[Q_j]']);
});

test('native PF content rejects unsupported multiplicity and ambiguous or missing associations', () => {
  const rows = (values) => Object.entries(values).flatMap(([label, values]) =>
    (Array.isArray(values) ? values : [values]).map((value) => ({ label, value })));
  assert.equal(prepareNativePlaqueContent('fission', rows({ inputFeatures: ['a'], outputOneFeatures: ['b'], outputTwoFeatures: ['c'] }), ['a', 'b', 'c']), undefined);
  assert.equal(prepareNativePlaqueContent('fission', rows({ features: ['a', 'b'] }), ['a', 'b']), undefined);
  assert.equal(prepareNativePlaqueContent('impoverishment', rows({ featureHierarchy: ['a', 'a', 'b'], delinkAfter: 'a' }), ['a']), undefined);
  assert.equal(prepareNativePlaqueContent('impoverishment', rows({ featureHierarchy: ['a', 'b'], delinkAfter: 'absent' }), ['a']), undefined);
  assert.equal(prepareNativePlaqueContent('correspondence', rows({ sources: ['a', 'a'], exponents: ['b'], correspondence: ['a=>b'] }), ['a']), undefined);
  assert.equal(prepareNativePlaqueContent('correspondence', rows({ sources: ['a'], exponents: ['b'] }), ['a']), undefined);
});

test('the exact displayed wordless landing binds its category shell until PF realization', () => {
  const item = { kind: 'trajectory', trajectoryKind: 'head', sourceNodeId: 'source', targetNodeId: 'landing',
    sourceAttachment: 'terminal', targetAttachment: 'terminal', priorWitnessNodeIds: [], backward: false,
    appearsAtStage: 0, persistence: 'persistent', relationRef: { stageIndex: 0, relationIndex: 0, relation: 'HeadMove', anchors: {} } };
  const nodes = new Map([['source', { id: 'source', label: 'V', word: 'did' }], ['landing', { id: 'landing', label: 'T', children: [] }]]);
  const displayed = resolveDisplayedTrajectoryAttachments(item, (id) => nodes.get(id));
  assert.equal(displayed.targetAttachment, 'shell-bottom');
  assert.equal(item.targetAttachment, 'terminal');
  const requested = [];
  const bound = bindRelationPlanFrame({ frames: [{ items: [displayed] }] }, 0, (id, attachment) => {
    requested.push([id, attachment]);
    return { x: id === 'source' ? 0 : 200, y: attachment === 'shell-bottom' ? 30 : 140 };
  });
  assert.deepEqual(requested, [['source', 'terminal'], ['landing', 'shell-bottom']]);
  assert.equal(bound.primitives[0].to.y, 30);
  nodes.get('landing').word = 'did';
  assert.equal(resolveDisplayedTrajectoryAttachments(item, (id) => nodes.get(id)), item);
  assert.equal(resolveDisplayedTrajectoryAttachments(item, () => undefined), item, 'missing lexical material must not acquire a shell fallback');
  nodes.get('landing').word = 't_i';
  assert.equal(resolveDisplayedTrajectoryAttachments(item, (id) => nodes.get(id)), item, 'trace notation remains a terminal');
});

test('production ships FProjection ink and type rules without an Orchard dependency', () => {
  const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.babel-f-projection-path\s*\{[^}]*fill: none;[^}]*stroke: var\(--babel-relation-ink[^}]*stroke-width: 3px;/u);
  assert.match(styles, /\.babel-f-projection-feature,\s*\.babel-f-projection-accent\s*\{[^}]*font: 900 34px/u);
  assert.doesNotMatch(styles.match(/\.babel-f-projection-path\s*\{[^}]*\}/u)[0], /filter:/u);
});

test('native cyclic columns and their anchor rail ship the approved readable ink', () => {
  const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const rule = (name) => {
    const match = styles.match(new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`, 'u'));
    assert.ok(match, `missing native ink rule: ${name}`);
    assert.doesNotMatch(match[1], /(?:filter|opacity|position)\s*:/u);
    return match[1];
  };
  for (const [name, fill] of [
    ['babel-linearization-column-title', 'rgba(110, 231, 183, 0.82)'],
    ['babel-linearization-row', 'rgba(236, 253, 245, 0.90)'],
    ['babel-linearization-row-current', '#a7f3d0'],
    ['babel-linearization-row-conflict', '#ecfdf5'],
    ['babel-linearization-failure-mark', '#ecfdf5'],
    ['babel-anchor-set-badge-number', 'rgba(167, 243, 208, 0.98)'],
    ['babel-anchor-set-rail-label', 'rgba(110, 231, 183, 0.95)']
  ]) assert.ok(rule(name).includes(`fill: ${fill};`), name);
  assert.match(rule('babel-linearization-row'), /paint-order: stroke;[\s\S]*font: 800 19px/u);
  assert.match(rule('babel-linearization-row-conflict'), /text-decoration: underline;/u);
  for (const name of ['babel-anchor-set-badge', 'babel-anchor-set-rail', 'babel-anchor-set-stub']) {
    assert.match(rule(name), /stroke: rgba\(52, 211, 153,/u);
    assert.match(rule(name), /vector-effect: non-scaling-stroke;/u);
  }
});
