import { hierarchy } from 'd3';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createBindingDrawing } from '../components/renderer/bindingDrawing.ts';
import { applyRelationEmphasis } from '../components/renderer/relationInteraction.ts';
import { acceptedRelationDrawingKey, decorateRelationElement, relationLayerKey } from '../components/renderer/relationOwnership.ts';
import { createThetaDrawing } from '../components/renderer/thetaDrawing.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { boundOverlayBounds } from '../replay/relations/geometryBounds.ts';
import { planItemRelationRefs } from '../replay/relations/renderPlan.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { extractDisplayedSubscriptIndex, extractMovementIndex } from '../replay/replaySurfaceNotation.ts';
import { normalizeParseBundle } from '../server/babelParser/parseNormalization.js';
import { createSvgDom, descendants, select } from './helpers/svgDom.mjs';

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
    const bundle = normalizeParseBundle(authored, 'xbar', 'alpha beta unrelated', 'grok', true);
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

const { Element, restore } = createSvgDom();
after(restore);
function painter(workspace = forest, decorate = null) {
  const root = new Element('g');
  const nodes = new Map(workspace.flatMap(tree => hierarchy(tree).descendants()).map(node => [node.data.id, node]));
  for (const node of nodes.values()) {
    const word = Boolean(node.data.word);
    const label = new Element('text', { class: word ? 'terminal-label' : 'category-label', 'data-default-label': word ? node.data.word : node.data.label,
      [word ? 'data-node-id' : 'data-category-node-id']: node.data.id }, node);
    label.text = word ? node.data.word : node.data.label;
    root.appendChild(label);
  }
  for (const node of nodes.values()) node.__vizId = node.data.id;
  const owners = new Map(), lights = [], decorations = new Map();
  const dependencies = { terminalAmbiguities: new Map(),
    g: select(root), resolveOverlayAnchor: id => nodes.get(id),
    identityTerminalOwners: owners, identityForestLightFamilies: lights,
    decorateRelationElement: decorate ?? ((element, item) => decorations.set(element, item)), relationEmphasisForItem: () => null,
    markIdentityLensOccurrences() {},
    // Each claim here is drawn alone; tests/indexLetters.test.mjs covers shared letters.
    indexLetterPlan: () => ({ draw: 'glyph', label: null, alsoFor: [] })
  };
  const draw = createBindingDrawing(dependencies).drawIdentityLens;
  const theta = (id, index, item, deferred) => {
    const grid = { ...item, kind: 'node-plaque', familyId: 'theta.grid', plaqueStyle: 'theta-grid',
      anchorNodeIds: [id], thetaRoles: [{ nodeId: id, label: 'Theme', index }] };
    const context = { ...dependencies, relationLayerKey, acceptedRelationDrawingKey,
      scheduledAcceptedPfRelations: new Set(), frameItems: [grid],
      svg: select(new Element('svg')), replayPlaqueLayout: new Map([[0, { x: 400, y: 500 }]]),
      queueAcceptedRelationDraw: (_item, _emphasis, callback) => deferred ? deferred.push(callback) : callback() };
    return createThetaDrawing(context).scheduleAcceptedThetaGrid(grid, null);
  };
  return { root, lights, decorations,
    drawTheta: (id, index, item) => theta(id, index, item),
    queueTheta: (id, index, item, deferred) => theta(id, index, item, deferred),
    draw: item => draw({ type: 'identity-lens', nodeIds: item.nodeIds, index: item.index, itemIndex: 0 },
      item, select(root), null) };
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
  const bundle = normalizeParseBundle(authored, 'xbar', ids.join(' '), 'grok', true);
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

test('the production Theta callback keeps the chain index the step staged on a label without identity', () => {
  const item = identityItems(compileRelationRenderPlan([stage([relation()])]))[0];
  const paint = painter();
  const alpha = paint.root.children.find(label => label.attrs['data-node-id'] === 'alpha');
  alpha.text = 'alpha₁';
  alpha.attrs['data-staged-label'] = 'alpha₁';
  paint.drawTheta('alpha', 'k', { ...item, familyId: 'theta.grid', relationRef: { ...item.relationRef, relationIndex: 2 } });
  assert.equal(alpha.text, 'alpha₁');
  assert.deepEqual(alpha.children.map(span => span.textContent), ['k']);
});

test('the production Theta scheduler defers its index until after inline identity in either authored order', () => {
  const identity = identityItems(compileRelationRenderPlan([stage([relation()])]))[0];
  const theta = { ...identity, familyId: 'theta.grid', relationRef: { ...identity.relationRef, relationIndex: 2 } };
  for (const order of [[theta, identity], [identity, theta]]) {
    const paint = painter(), deferred = [];
    for (const item of order) {
      if (item.familyId === 'theta.grid') paint.queueTheta('alpha', 'k', item, deferred);
      else paint.draw(item);
    }
    const alpha = paint.root.children.find(label => label.attrs['data-node-id'] === 'alpha');
    assert.equal(deferred.length, 1, 'production scheduling queues Theta instead of drawing it inline');
    assert.deepEqual(alpha.children.map(span => span.textContent), ['k']);
    deferred.forEach(draw => draw());
    assert.deepEqual(alpha.children.map(span => span.textContent), ['k']);
    assert.deepEqual(planItemRelationRefs(paint.decorations.get(alpha.children[0])).map(ref => ref.relationIndex), [0, 2]);
  }
});

// Painted opacity as the shared emphasis CSS resolves it on each element.
const painted = element => !element ? 1 : (element.classList.contains('vr-relation-active') ? 1
  : element.classList.contains('vr-relation-quiet') ? 0.3 : Number(element.attrs.opacity ?? 1)) * painted(element.parentNode);

test('a label never dims an identity index that a later Theta claim makes active', () => {
  // Identity coindexes two occurrences with i; a Theta role then reuses alpha's i.
  const item = identityItems(compileRelationRenderPlan([stage([relation('Identity', { index: 'i' })])]))[0];
  const paint = painter(forest, decorateRelationElement);
  paint.draw(item);
  paint.drawTheta('alpha', 'i', { ...item, familyId: 'theta.grid', relationRef: { ...item.relationRef, relationIndex: 1 } });
  const index = paint.root.children.find(label => label.attrs['data-node-id'] === 'alpha').children.find(child => child.textContent === 'i');
  applyRelationEmphasis(paint.root, { stageIndex: 0, relationIndex: 1 }, null);
  assert.equal(painted(index), 1, 'the Theta moment shows its shared index');
  applyRelationEmphasis(paint.root, { stageIndex: 0, relationIndex: 2 }, null);
  assert.equal(painted(index), 0.3, 'another moment dims it once');
});

test('a label kept bright for an active index still dims its quiet sibling index once', () => {
  // Identity(alpha, beta) uses k; a Theta role then adds i on alpha's label.
  const item = identityItems(compileRelationRenderPlan([stage([relation('Identity', { index: 'k' })])]))[0];
  const paint = painter(forest, decorateRelationElement);
  paint.draw(item);
  paint.drawTheta('alpha', 'i', { ...item, familyId: 'theta.grid', relationRef: { ...item.relationRef, relationIndex: 1 } });
  const alpha = paint.root.children.find(label => label.attrs['data-node-id'] === 'alpha');
  applyRelationEmphasis(paint.root, { stageIndex: 0, relationIndex: 1 }, null);
  assert.deepEqual(alpha.children.map(index => [index.textContent, painted(index)]), [['k', 0.3], ['i', 1]]);
  applyRelationEmphasis(paint.root, { stageIndex: 0, relationIndex: 2 }, null);
  assert.deepEqual(alpha.children.map(index => [index.textContent, painted(index)]), [['k', 0.3], ['i', 0.3]]);
});
