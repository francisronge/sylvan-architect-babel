import {identityLabelTarget,thetaLabelTarget,identityIndexAction,thetaLabelBase,treeLabelIndexAttributes} from '../replay/treeLabelRuns.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { hierarchy } from 'd3';
import { __test__ } from '../server/babelParser.js';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { compileRelationRenderPlan, planItemRelationRefs } from '../replay/relations/renderPlanCompiler.ts';
import { bindRelationPlanFrame, boundOverlayBounds } from '../replay/relations/geometryBinding.ts';
import { extractDisplayedSubscriptIndex, extractMovementIndex } from '../replay/replayCompiler.ts';
import { mergeIdentityOwners } from '../components/identityForestLight.ts';

const leaf = (id, word = id) => ({ id, label: 'N', word, children: [] });
const forest = [{ id: 'root', label: 'XP', children: [leaf('alpha'), leaf('beta'), leaf('unrelated')] }];
const stage = relations => ({ statement: 'The occurrences are identified.', stageRecord: 'Identity holds between the authored occurrences.', relations, workspaceForest: structuredClone(forest) });
const relation = (name = 'Identity', values = { index: 'k' }, ids = ['alpha', 'beta']) => ({ relation: name,
  anchors: { occurrences: ids }, ...(values === undefined ? {} : { values }) });
const position = id => ({ x: id === 'alpha' ? 100 : 300, y: 200 });
const identityItems = plan => plan.frames[0].items.filter(item => item.familyId === 'identity.occurrences');

test('public canonical and recovered identity retain the authored coindex through Replay and binding', () => {
  for (const name of ['Identity', 'An unfamiliar identity assertion']) {
    const authored = { derivationStages: [stage([relation(name)])] };
    const before = structuredClone(authored);
    const bundle = __test__.normalizeParseBundle(authored, 'xbar', 'alpha beta unrelated', 'grok', true);
    const prepared = prepareReplay({ derivationStages: bundle.analyses[0].derivationStages,
      sentence: 'alpha beta unrelated', includePlayback: true });
    const plan = prepared.relationRenderPlan;
    assert.equal(identityItems(plan).length, 1);
    assert.equal(identityItems(plan)[0].index, 'k');
    const bound = bindRelationPlanFrame(plan, 0, position);
    assert.deepEqual(bound.primitives.filter(mark => mark.type === 'identity-lens'), [{
      type: 'identity-lens', nodeIds: ['alpha', 'beta'], index: 'k', itemIndex: 0
    }]);
    assert.equal(boundOverlayBounds(bound), null, 'inline coindices add no independent camera bounds');
    assert.deepEqual(authored, before);
  }
});

test('identity without authored notation keeps shared allocation and separates independent occurrence sets', () => {
  const first = relation('Identity', undefined);
  delete first.values;
  const second = relation('Identity', undefined, ['beta', 'unrelated']);
  delete second.values;
  const plan = compileRelationRenderPlan([stage([first, second]), stage([first])]);
  assert.deepEqual(identityItems(plan).map(item => item.index), ['i', 'j']);
  assert.equal(plan.frames[1].items.find(item => item.nodeIds?.includes('alpha')).index, 'i');
});

test('conflicting and empty authored identity indices remain neutral instead of receiving a new letter', () => {
  for (const name of ['Identity', 'An unfamiliar identity assertion']) {
    for (const values of [{ index: '' }, { index: [] }, { index: ['k', 'j'] }, { index: 'k', coindex: 'j' }]) {
      const plan = compileRelationRenderPlan([stage([relation(name, values)])]);
      assert.equal(identityItems(plan).length, 0, JSON.stringify({ name, values }));
      assert(plan.frames[0].items.some(item => item.kind === 'fallback'));
      assert.deepEqual(plan.frames[0].items.find(item => item.kind === 'fallback').relationRef.values, values);
    }
  }
});

// Execute the production identity block. Browser evidence remains responsible for font pixels.
const source = readFileSync(new URL('../components/TreeVisualizer.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('TreeVisualizer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let identityBranch, thetaCallback;
const visit = node => {
  if (ts.isIfStatement(node) && node.expression.getText(parsed) === "primitive.type === 'identity-lens'") identityBranch = node.thenStatement;
  if (ts.isFunctionExpression(node) && node.name?.getText(parsed) === 'appendThetaIndex') thetaCallback = node;
  ts.forEachChild(node, visit);
};
visit(parsed);
assert(identityBranch);
class Element {
  constructor(tag, attrs = {}, text = '', datum) { this.tag = tag; this.attrs = attrs; this.text = text; this.datum = datum; this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  appendChild(child) { this.children.push(child); }
}
const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
class Selection {
  constructor(nodes) { this.items = nodes; }
  node() { return this.items[0] ?? null; }
  nodes() { return this.items; }
  size() { return this.items.length; }
  append(tag) { return new Selection(this.items.map(parent => { const node = new Element(tag); parent.children.push(node); return node; })); }
  attr(name, value) { if (arguments.length === 1) return this.node()?.getAttribute(name); this.items.forEach(node => { node.attrs[name] = String(value); }); return this; }
  text(value) { this.items.forEach(node => { node.text = String(value); node.children = []; }); return this; }
  classed(name, enabled) { this.items.forEach(node => { const classes = new Set((node.attrs.class || '').split(' ').filter(Boolean)); enabled ? classes.add(name) : classes.delete(name); node.attrs.class = [...classes].join(' '); }); return this; }
  selectAll(selector) { return new Selection(this.items.flatMap(descendants).filter(node => selector.split(',').some(part => (node.attrs.class || '').split(' ').includes(part.trim().slice(1))))); }
  filter(fn) { return new Selection(this.items.filter(node => fn.call(node, node.datum))); }
  each(fn) { this.items.forEach(node => fn.call(node, node.datum)); return this; }
}
const select = node => new Selection([node]);
function painter(workspace = forest) {
  const root = new Element('g');
  const nodes = new Map(workspace.flatMap(tree => hierarchy(tree).descendants()).map(node => [node.data.id, node]));
  for (const node of nodes.values()) {
    const word = Boolean(node.data.word);
    root.children.push(new Element('text', { class: word ? 'terminal-label' : 'category-label', 'data-default-label': word ? node.data.word : node.data.label,
      [word ? 'data-node-id' : 'data-category-node-id']: node.data.id }, word ? node.data.word : node.data.label, node));
  }
  for (const node of nodes.values()) node.__vizId = node.data.id;
  const owners = new Map(), lights = [], decorations = new Map();
  const dependencies = { identityLabelTarget, thetaLabelTarget, identityIndexAction, thetaLabelBase, treeLabelIndexAttributes, terminalAmbiguities: new Map(),
    g: select(root), d3: { select }, resolveOverlayAnchor: id => nodes.get(id),
    getNodeId: node => node.data.id,
    labelBelongsToNode: (element, id) => element.getAttribute('data-node-id') === id || element.getAttribute('data-category-node-id') === id,
    extractDisplayedSubscriptIndex, mergeIdentityOwners, planItemRelationRefs,
    identityTerminalOwners: owners, identityForestLightFamilies: lights,
    decorateRelationElement: (element, item) => decorations.set(element, item), relationEmphasisForItem: () => null,
    markIdentityLensOccurrences() {}, emphasis: null
  };
  const draw = new Function(...Object.keys(dependencies), 'primitive', 'planItem',
    ts.transpile(identityBranch.getText(parsed), { target: ts.ScriptTarget.ES2023 }));
  const drawTheta = new Function(...Object.keys(dependencies), 'role', 'rowOwner', 'roleIsEntirelyTraces',
    ts.transpile(`return (${thetaCallback.getText(parsed)});`, { target: ts.ScriptTarget.ES2023 }));
  return { root, lights, decorations,
    drawTheta: (id, index, item) => drawTheta(...Object.values(dependencies), { index }, item, false)
      .call(root.children.find(label => label.attrs['data-node-id'] === id)),
    draw: item => draw(...Object.values(dependencies), {
    type: 'identity-lens', nodeIds: item.nodeIds, index: item.index, itemIndex: 0
  }, item) };
}
const marks = root => descendants(root).filter(element => (element.attrs.class || '').split(' ').includes('babel-identity-index'));

test('the production identity painter draws both coindices and Forest light on exact owned occurrences', () => {
  const item = identityItems(compileRelationRenderPlan([stage([relation()])]))[0];
  const paint = painter();
  paint.draw(item);
  assert.deepEqual(marks(paint.root).map(mark => [mark.attrs['data-identity-anchor'], mark.textContent]), [['alpha', 'k'], ['beta', 'k']]);
  assert.deepEqual(paint.lights.map(light => light.occurrencePools), [[['alpha'], ['beta']]]);
  assert.equal(paint.root.children.find(label => label.attrs['data-node-id'] === 'unrelated').textContent, 'unrelated');
  for (const mark of marks(paint.root)) {
    assert.equal(mark.attrs['baseline-shift'], 'sub');
    assert.equal(mark.attrs.transform, undefined, 'the coindex belongs to its label coordinate group');
    assert.deepEqual(planItemRelationRefs(paint.decorations.get(mark)), planItemRelationRefs(item));
  }
});

test('repeated identity claims share exact inline notation while distinct indices keep their own ownership', () => {
  const item = identityItems(compileRelationRenderPlan([stage([relation()])]))[0];
  const paint = painter();
  paint.draw(item);
  paint.draw({ ...item, relationRef: { ...item.relationRef, relationIndex: 1 } });
  assert.equal(marks(paint.root).length, 2);
  assert.equal(planItemRelationRefs(paint.decorations.get(marks(paint.root)[0])).length, 2);
  paint.draw({ ...item, index: 'j', relationRef: { ...item.relationRef, relationIndex: 2 } });
  assert.deepEqual(marks(paint.root).map(mark => mark.textContent), ['k', 'j', 'k', 'j']);
  for (const mark of marks(paint.root).filter(mark => mark.textContent === 'j'))
    assert.deepEqual(planItemRelationRefs(paint.decorations.get(mark)).map(ref => ref.relationIndex), [2]);
});

test('phrase coindices stay on the phrase while lights cover its leaves; a presentation lens adds no index', () => {
  const workspace = [{ id: 'root', label: 'XP', children: [
    { id: 'phrase', label: 'DP', children: [leaf('a', 'first'), leaf('b', 'second')] }, leaf('copy')
  ] }];
  const item = { kind: 'coindex', familyId: 'identity.occurrences', nodeIds: ['phrase', 'copy'], index: 'k',
    relationRef: { stageIndex: 0, relationIndex: 0, relation: 'Identity', anchors: { occurrences: ['phrase', 'copy'] } } };
  const paint = painter(workspace);
  paint.draw(item);
  assert.deepEqual(marks(paint.root).map(mark => mark.attrs['data-identity-anchor']), ['phrase', 'copy']);
  assert.deepEqual(paint.lights[0].occurrencePools, [['a', 'b'], ['copy']]);
  const lens = painter(workspace);
  lens.draw({ ...item, index: '' });
  assert.equal(marks(lens.root).length, 0);
  assert.equal(lens.lights.length, 1);
});

test('the identity painter reuses matching displayed notation and never overwrites a conflicting literal', () => {
  const item = identityItems(compileRelationRenderPlan([stage([relation()])]))[0];
  const workspace = [{ id: 'root', label: 'XP', children: [leaf('alpha', 'alphaₖ'), leaf('beta', 'betaⱼ')] }];
  const paint = painter(workspace);
  paint.draw(item);
  assert.deepEqual(marks(paint.root).map(mark => mark.attrs['data-identity-anchor']), ['beta']);
  assert.equal(paint.root.children.find(label => label.attrs['data-node-id'] === 'alpha').textContent, 'alphaₖ');
  assert.equal(paint.root.children.find(label => label.attrs['data-node-id'] === 'beta').textContent, 'betaⱼk');
});

test('literal numeric and underscore endings receive coindices without changing the authored words', () => {
  const base = identityItems(compileRelationRenderPlan([stage([relation()])]))[0];
  for (const [index, alpha, beta] of [
    ['1', 'occurrences_1', 'occurrences_2'],
    ['1', 'word_{1}', 'word_[1]'],
    ['1', 'word_(1)', 't1'],
    ['k', 'word_k', 'word_{k}']
  ]) {
    const paint = painter([{ id: 'root', label: 'XP', children: [leaf('alpha', alpha), leaf('beta', beta)] }]);
    paint.draw({ ...base, index });
    assert.deepEqual(marks(paint.root).map(mark => [mark.attrs['data-identity-anchor'], mark.textContent]), [['alpha', index], ['beta', index]]);
    for (const [id, authoredWord] of [['alpha', alpha], ['beta', beta]]) {
      const label = paint.root.children.find(label => label.attrs['data-node-id'] === id);
      assert.equal(label.text, authoredWord, 'the authored word remains byte-for-byte intact');
      assert.equal(label.attrs['data-identity-base-label'], authoredWord);
      assert.equal(label.children.length, 1, 'the coindex is a separate visible span');
    }
  }
});

test('the public identity atlas literal words retain two coindices through normalization and production paint', () => {
  const ids = ['occurrences_1', 'occurrences_2'];
  const authored = { derivationStages: [{ ...stage([relation('UnknownFacet:identity.occurrences', { index: '1' }, ids)]),
    workspaceForest: [{ id: 'root_identity.occurrences', label: 'XP', children: ids.map(id => leaf(id)) }] }] };
  const before = structuredClone(authored);
  const bundle = __test__.normalizeParseBundle(authored, 'xbar', ids.join(' '), 'grok', true);
  const stages = bundle.analyses[0].derivationStages;
  const plan = prepareReplay({ derivationStages: stages, sentence: ids.join(' '), includePlayback: true }).relationRenderPlan;
  const [item] = identityItems(plan);
  assert.equal(item.claimTier, 2);
  assert.deepEqual(bindRelationPlanFrame(plan, 0, position).primitives, [{
    type: 'identity-lens', nodeIds: ids, index: '1', itemIndex: 0
  }]);
  const paint = painter(stages[0].workspaceForest);
  paint.draw(item);
  assert.deepEqual(marks(paint.root).map(mark => [mark.attrs['data-identity-anchor'], mark.textContent]), ids.map(id => [id, '1']));
  assert.deepEqual(paint.root.children.filter(label => label.attrs.class === 'terminal-label').map(label => label.text), ids);
  assert.deepEqual(authored, before);
});

test('displayed-subscript detection does not change authored movement-index parsing', () => {
  for (const word of ['occurrences_1', 'word_{1}', 'word_[1]', 'word_(1)', 't1']) {
    assert.equal(extractDisplayedSubscriptIndex(word), null);
    assert.equal(extractMovementIndex(word), '1');
  }
  for (const [word, index] of [['alpha₁', '1'], ['alpha₁₂', '12'], ['alphaₖ', 'k'], ['alphaᵢ', 'i']]) {
    assert.equal(extractDisplayedSubscriptIndex(word), index);
    assert.equal(extractMovementIndex(word), index);
  }
});

test('numeric Unicode subscripts remain reusable displayed notation', () => {
  const base = identityItems(compileRelationRenderPlan([stage([relation()])]))[0];
  const paint = painter([{ id: 'root', label: 'XP', children: [leaf('alpha', 'alpha₁'), leaf('beta', 'beta₂')] }]);
  paint.draw({ ...base, index: '1' });
  assert.deepEqual(marks(paint.root).map(mark => [mark.attrs['data-identity-anchor'], mark.textContent]), [['beta', '1']]);
  assert.equal(paint.root.children.find(label => label.attrs['data-node-id'] === 'alpha').textContent, 'alpha₁');
  assert.equal(paint.root.children.find(label => label.attrs['data-node-id'] === 'beta').text, 'beta₂');
});

test('marked identity notation is reused only on its exact label and preserves other claim owners', () => {
  const base = identityItems(compileRelationRenderPlan([stage([relation()])]))[0];
  const paint = painter();
  const owned = (nodeId, index, relationIndex) => ({ ...base, nodeIds: [nodeId], index,
    relationRef: { ...base.relationRef, relationIndex } });
  paint.draw(owned('alpha', '1', 4));
  paint.draw(owned('beta', '2', 5));
  paint.draw(owned('unrelated', '1', 6));
  const earlier = new Map(marks(paint.root).map(mark => [mark.attrs['data-identity-anchor'], mark]));
  paint.draw({ ...base, index: '1' });
  assert.deepEqual(marks(paint.root).map(mark => [mark.attrs['data-identity-anchor'], mark.textContent]), [
    ['alpha', '1'], ['beta', '2'], ['beta', '1'], ['unrelated', '1']
  ]);
  assert.deepEqual(planItemRelationRefs(paint.decorations.get(earlier.get('alpha'))).map(ref => ref.relationIndex), [4, 0]);
  assert.deepEqual(planItemRelationRefs(paint.decorations.get(earlier.get('beta'))).map(ref => ref.relationIndex), [5]);
  assert.deepEqual(planItemRelationRefs(paint.decorations.get(earlier.get('unrelated'))).map(ref => ref.relationIndex), [6]);
});

test('the later production Theta callback preserves identity notation and shares matching index owners', () => {
  const item = identityItems(compileRelationRenderPlan([stage([relation()])]))[0];
  for (const thetaIndex of ['k', 'j']) {
    const paint = painter();
    const alpha = paint.root.children.find(label => label.attrs['data-node-id'] === 'alpha');
    alpha.text = 'alpha₁';
    paint.draw(item);
    const identity = marks(paint.root).find(mark => mark.attrs['data-identity-anchor'] === 'alpha');
    const thetaOwner = { ...item, familyId: 'theta.grid', relationRef: { ...item.relationRef, relationIndex: 2 } };
    paint.drawTheta('alpha', thetaIndex, thetaOwner);
    assert.equal(alpha.text, 'alpha₁', 'movement/base notation is retained');
    assert(alpha.children.includes(identity), 'the identity index remains attached to its exact label');
    assert.deepEqual(alpha.children.map(span => span.textContent), thetaIndex === 'k' ? ['k'] : ['k', 'j']);
    assert.deepEqual(planItemRelationRefs(paint.decorations.get(identity)).map(ref => ref.relationIndex), thetaIndex === 'k' ? [0, 2] : [0]);
    if (thetaIndex === 'j') assert.deepEqual(planItemRelationRefs(paint.decorations.get(alpha.children[1])).map(ref => ref.relationIndex), [2]);
  }
});

test('the production Theta scheduler defers its index until after inline identity in either authored order', () => {
  const initializer = name => {
    let result;
    const find = node => {
      if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name) result = node.initializer;
      ts.forEachChild(node, find);
    };
    find(parsed);
    assert(result, `${name} must be the production scheduling function`);
    return result.getText(parsed);
  };
  const identity = identityItems(compileRelationRenderPlan([stage([relation()])]))[0];
  const theta = { ...identity, familyId: 'theta.grid', relationRef: { ...identity.relationRef, relationIndex: 2 } };
  for (const order of [[theta, identity], [identity, theta]]) {
    const paint = painter(), deferred = [];
    const queueAcceptedRelationDraw = new Function('deferredAcceptedRelationDraws',
      ts.transpile(`return (${initializer('queueAcceptedRelationDraw')});`, { target: ts.ScriptTarget.ES2023 }))(deferred);
    const key = item => JSON.stringify(item.relationRef);
    const schedule = new Function('scheduledAcceptedPfRelations', 'relationLayerKey', 'acceptedRelationDrawingKey', 'queueAcceptedRelationDraw',
      ts.transpile(`return (${initializer('scheduleAcceptedThetaGrid')});`, { target: ts.ScriptTarget.ES2023 }))(
        new Set(), key, key, queueAcceptedRelationDraw);
    for (const item of order) {
      if (!schedule(item, null)) paint.draw(item);
    }
    const alpha = paint.root.children.find(label => label.attrs['data-node-id'] === 'alpha');
    assert.equal(deferred.length, 1, 'production scheduling queues Theta instead of drawing it inline');
    assert.deepEqual(alpha.children.map(span => span.textContent), ['k']);
    // Exercise the actual index callback inside the deferred Theta work.
    paint.drawTheta('alpha', 'k', theta);
    assert.deepEqual(alpha.children.map(span => span.textContent), ['k']);
    assert.deepEqual(planItemRelationRefs(paint.decorations.get(alpha.children[0])).map(ref => ref.relationIndex), [0, 2]);
  }
  assert(source.indexOf('deferredAcceptedRelationDraws.forEach((draw) => draw())') > identityBranch.end,
    'deferred drawing is flushed after the inline identity block');
  assert(source.indexOf("svg.selectAll('*').remove()") < identityBranch.pos,
    'each render rebuilds labels rather than retaining a previously painted Theta span');
});
