import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createBindingDrawing, indexLetterLabels } from '../components/renderer/bindingDrawing.ts';
import { createBindingRefinements } from '../components/renderer/bindingRefinements.ts';
import { planIndexLetters, primitiveIndexLetters } from '../components/renderer/indexLetters.ts';
import { applyRelationEmphasis } from '../components/renderer/relationInteraction.ts';
import { createRelationLayers } from '../components/renderer/relationLayers.ts';
import { decorateRelationElement, relationLayerKey } from '../components/renderer/relationOwnership.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { isPlanItemRevealed, planItemOwnsRelationMoment, planItemRelationRefs } from '../replay/relations/renderPlan.ts';
import { indexHierarchyNodesByIdAndAliases } from '../replay/replayCanvas.ts';
import { treeLabelRunsForStep } from '../replay/treeLabelRuns.ts';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import { checkOneLetterPerLabel, frameStructure } from './helpers/replayInvariants.mjs';
import { createSvgDom, descendants, select } from './helpers/svgDom.mjs';

// "Everyone loves someone." with the existential raised over the universal,
// as GPT-6 Astra authored it (bughunt2-20261018, 20-en-scope, analysis 2).
// Relations and forests are verbatim; only the prose fields are shortened.
const np = (id, label, word, { tokenIndex, silent } = {}) => ({ id, label, lineageId: id.startsWith('subj') ? 'subject-chain' : 'object-chain',
  ...(silent ? { silent } : {}), children: [{ id: `${id}bar`, label: 'N′', children: [{ id: `${id}n`, label: 'N', word,
    ...(tokenIndex === undefined ? {} : { tokenIndex }), ...(silent ? { silent } : {}), children: [] }] }] });
const clause = (subjectLabel, objectLabel) => ({ id: 'ip', label: 'IP', children: [np('subj', subjectLabel, 'Everyone', { tokenIndex: 0 }),
  { id: 'ibar', label: 'I′', children: [{ id: 'i', label: 'I[+finite, present, 3sg]', silent: true, children: [] },
    { id: 'vp', label: 'VP', children: [{ id: 'vbar', label: 'V′', children: [{ id: 'v', label: 'V', word: 'loves', tokenIndex: 1, children: [] },
      np('obj', objectLabel, 'someone', { tokenIndex: 2 })] }] }] }] });
const variable = 'NP[LF variable; PF lower copy]';
const raise = (operator, variableOccurrence, host, adjoinedProjection, quantifier, chainLicensing) => ({
  relation: 'covert quantifier raising and A′-binding',
  anchors: { adjoinedProjection, host, operator, variableOccurrence }, priorAnchors: { source: variableOccurrence },
  values: { chainLicensing, dependency: 'higher operator c-commands and A′-binds the lower variable',
    interpretation: 'higher occurrence interpreted as quantifier; lower occurrence interpreted as variable',
    locality: 'clause-internal QR crosses no island', pronunciation: 'lower occurrence pronounced; higher occurrence silent', quantifier }
});
const universal = np('subjhigh', 'NP[LF universal operator]', 'Everyone', { silent: true });
const stages = [{
  statement: 'Establish the overt clause.', stageRecord: 'Both arguments are in place.',
  relations: [{ relation: 'theta-role assignment', anchors: { externalArgument: 'subj', internalArgument: 'obj', predicate: 'v' },
    values: { externalRole: 'experiencer', internalRole: 'theme' } },
  { relation: 'nominative Case licensing', anchors: { licensor: 'i', recipient: 'subj' },
    values: { case: 'nominative', configuration: 'finite I and Spec-IP' } },
  { relation: 'government and accusative Case assignment', anchors: { governor: 'v', recipient: 'obj' },
    values: { case: 'accusative', configuration: 'V governs its NP complement' } },
  { relation: 'finite inflection licensing', anchors: { finiteHead: 'i', inflectedVerb: 'v', subject: 'subj' },
    values: { agreement: 'third-person singular', realization: 'lexically inflected V remains in situ', tense: 'present' } }],
  workspaceForest: [clause('NP', 'NP')]
}, {
  statement: 'Raise the universal.', stageRecord: 'The universal adjoins to IP.',
  relations: [raise('subjhigh', 'subj', 'ip', 'subjip', 'universal',
    'experiencer role and nominative Case retained at the lower occurrence')],
  workspaceForest: [{ id: 'subjip', label: 'IP', children: [universal, clause(variable, 'NP')] }]
}, {
  statement: 'Raise the existential.', stageRecord: 'The existential adjoins above the universal.',
  relations: [raise('objhigh', 'obj', 'subjip', 'objip', 'existential', 'theme role and accusative Case retained at the lower occurrence'),
    { relation: 'LF scope',
      anchors: { narrowScopeOperator: 'subjhigh', objectVariable: 'obj', predicate: 'v', subjectVariable: 'subj', wideScopeOperator: 'objhigh' },
      values: { logicalForm: '∃y[person(y) ∧ ∀x[person(x) → love(x,y)]]', reading: 'There is at least one person whom everyone loves.',
        scopeOrder: 'existential > universal' } }],
  workspaceForest: [{ id: 'objip', label: 'IP', children: [np('objhigh', 'NP[LF existential operator]', 'someone', { silent: true }),
    { id: 'subjip', label: 'IP', children: [universal, clause(variable, variable)] }] }]
}];

const prepare = derivationStages => prepareReplay({ derivationStages, sentence: 'Everyone loves someone.',
  inputTokens: ['Everyone', 'loves', 'someone'], includePlayback: true });
const refs = item => planItemRelationRefs(item).map(ref => `${ref.stageIndex}:${ref.relationIndex}`);
const byNode = { labelOf: letter => letter.nodeId, writtenSubscript: () => null };

/** The drawable letter marks at one authored relation moment, and their plan. */
function moment(replay, stageIndex, relationIndex, labels = byNode) {
  const step = replay.playbackSteps.findIndex(candidate => candidate.replayKind === 'relation'
    && candidate.replayRelationIdentity?.stageIndex === stageIndex && candidate.replayRelationIdentity?.relationIndex === relationIndex);
  const played = new Set(replay.playbackSteps.slice(0, step + 1).flatMap(candidate => candidate.replayKind === 'relation'
    && candidate.replayRelationIdentity?.stageIndex === stageIndex ? [candidate.replayRelationIdentity.relationIndex] : []));
  const plan = replay.relationRenderPlan, items = plan.frames[stageIndex].items;
  const primitives = bindRelationPlanFrame(plan, stageIndex, () => ({ x: 0, y: 0 })).primitives
    .filter(primitive => isPlanItemRevealed(items[primitive.itemIndex], stageIndex, played, relationIndex)
      && primitiveIndexLetters(primitive).length);
  const emphasis = item => planItemOwnsRelationMoment(item, stageIndex, relationIndex) ? 'active' : 'quiet';
  const letterPlan = planIndexLetters(primitives, items, { ...labels, emphasisRank: item => emphasis(item) === 'active' ? 2 : 0 });
  return { items, primitives, letterPlan, emphasis };
}
const letterCounts = letters => [...letters.reduce((counts, { nodeId, index }) =>
  counts.set(`${nodeId}:${index}`, (counts.get(`${nodeId}:${index}`) ?? 0) + 1), new Map())].sort();
const drawnLetters = ({ primitives, letterPlan }) => primitives.flatMap(primitiveIndexLetters)
  .filter(letter => letterPlan(letter).draw === 'glyph');

test('a QR relation draws each chain letter once per occurrence, from its binding path', () => {
  const { items, primitives, letterPlan } = moment(prepare(stages), 2, 0);
  // The covert path and the binding path each index both occurrences of both chains.
  assert.deepEqual(letterCounts(primitives.flatMap(primitiveIndexLetters)), [['obj:j', 2], ['objhigh:j', 2], ['subj:i', 2], ['subjhigh:i', 2]]);
  const drawn = drawnLetters({ primitives, letterPlan });
  assert.deepEqual(letterCounts(drawn), [['obj:j', 1], ['objhigh:j', 1], ['subj:i', 1], ['subjhigh:i', 1]]);
  const landing = drawn.find(letter => letter.nodeId === 'objhigh');
  assert.equal(landing.role, 'operator', 'the letter placed clear of the binding path holds');
  assert.deepEqual(letterPlan(landing).alsoFor.map(index => items[index].kind), ['quantifier-raising']);
});

const { Element, restore } = createSvgDom();
after(restore);
const opacity = element => element ? Number(element.attrs.opacity ?? 1) * opacity(element.parentNode) : 1;
/** Paints with the production binding painters, dimming quiet hosts and layers as the scene does. */
function paint({ items, primitives, letterPlan }, emphasis = () => null) {
  const root = new Element('g'), layers = new Map(), decorations = new Map();
  const layer = (_layers, item, layerEmphasis, className) => {
    const key = JSON.stringify([refs(item), className]);
    if (!layers.has(key)) layers.set(key, select(root).append('g').attr('class', className).attr('opacity', layerEmphasis === 'quiet' ? 0.3 : null));
    return layers.get(key);
  };
  const drawing = createBindingDrawing({
    activeDerivationFrameIndex: 0, overlay: select(root), frameItems: items, g: select(root),
    operatorVariableScopeRankByItem: new Map(), operatorVariableScopeItems: [], activeRelationMoment: null,
    operatorVariableBindingLayers: new Map(), operatorVariableSharedPathLayers: new Map(), coindexRelationLayers: new Map(),
    acceptedRootLayerBeforeNodes: layer, acceptedRootLayerAfterNodes: layer, relationLayerKey: item => JSON.stringify(refs(item)),
    relationEmphasisForItem: emphasis, decorateRelationElement: (element, item) => decorations.set(element, item), TARGET_EMERALD: '#34d399',
    resolveOverlayAnchor: () => undefined, terminalAmbiguities: new Map(), identityTerminalOwners: new Map(),
    identityForestLightFamilies: [], markIdentityLensOccurrences() {}, indexLetterPlan: letterPlan
  });
  const painters = { 'quantifier-raising': drawing.drawQuantifierRaising, 'operator-variable-binding': drawing.drawOperatorVariableBinding,
    'index-badge': drawing.drawIndexBadge };
  for (const primitive of primitives) {
    const item = items[primitive.itemIndex];
    painters[primitive.type]?.(primitive, item, select(root).append('g').attr('opacity', emphasis(item) === 'quiet' ? 0.3 : null), emphasis(item));
  }
  // Every letter names the exact occurrence its painter binds it to.
  const letters = descendants(root).filter(element => element.tag === 'text').map(element => {
    const role = element.attrs['data-qr-index-role'] || element.attrs['data-operator-variable-index-role'];
    const host = element.attrs['data-qr-index-role'] ? element.parentNode.parentNode : element.parentNode;
    const nodeId = { pronounced: host.attrs['data-qr-pronounced'], lf: host.attrs['data-qr-lf'],
      operator: host.attrs['data-operator-variable-operator'], variable: host.attrs['data-operator-variable-variable'] }[role]
      ?? element.attrs['data-coreference-anchor'];
    return { nodeId, index: element.textContent, role, opacity: opacity(element) };
  });
  return { letters, decorations };
}

test('the production painters draw only their assigned letters', () => {
  const existential = moment(prepare(stages), 2, 0);
  const everyLetter = paint({ ...existential, letterPlan: () => ({ draw: 'glyph', label: null, alsoFor: [] }) }).letters;
  assert.equal(everyLetter.filter(letter => letter.nodeId === 'objhigh').length, 2, 'both marks own the landing letter');
  const { letters } = paint(existential);
  assert.deepEqual(letterCounts(letters), [['obj:j', 1], ['objhigh:j', 1], ['subj:i', 1], ['subjhigh:i', 1]]);
  assert.deepEqual(letters.filter(letter => letter.nodeId === 'objhigh').map(letter => letter.role), ['operator']);
});

test('a later restatement shares the binding path a movement relation drew, with both moments', () => {
  const restated = [...stages, { statement: 'Restate the binding.', stageRecord: 'The existential binds its variable.',
    relations: [{ relation: 'existential operator binding', anchors: { operator: 'objhigh', variable: 'obj' } }],
    workspaceForest: structuredClone(stages[2].workspaceForest) }];
  const replay = prepare(restated);
  const paths = replay.relationRenderPlan.frames[3].items.filter(item => item.kind === 'operator-variable-binding'
    && item.operatorNodeId === 'objhigh' && !item.bindingPathSuppressed);
  assert.deepEqual(paths.map(refs), [['2:0', '3:0']], 'one binding path keeps both authored moments');
  assert.deepEqual(letterCounts(drawnLetters(moment(replay, 3, 0))), [['obj:j', 1], ['objhigh:j', 1], ['subj:i', 1], ['subjhigh:i', 1]]);
});

test('a binding restated by another facet keeps its path, and the active claim holds the shared letter', () => {
  // A relative operator's movement chain earns operator binding; the next
  // relation restates it with binder and bound-trace roles (binding.dependency).
  const record = loadFixtureAnalyses().records
    .find(entry => entry.id === 'replay-regressions/workspace-historical-continuity.json#/cases/3').record;
  const replay = prepareReplay({ ...structuredClone(record), includePlayback: true });
  for (const [relationIndex, family] of [[1, 'scope.operator-variable'], [2, 'binding.dependency']]) {
    const current = moment(replay, 1, relationIndex);
    const drawn = drawnLetters(current);
    assert.deepEqual(drawn.filter(letter => letter.nodeId === 'operatorHigh').map(letter => current.items[letter.itemIndex].familyId), [family]);
    assert(letterCounts(drawn).every(([, count]) => count === 1));
  }
});

// A relative clause whose silent operator binds the object position.
const leaf = (id, label, word, extra = {}) => ({ id, label, ...(word ? { word } : {}), ...extra, children: [] });
const relative = (relations, opLabel = 'DP', gap = leaf('gap', 'DP', '', { silent: true, lineageId: 'relative' })) => prepareReplay({
  derivationStages: [{ statement: 'Bind the gap.', stageRecord: 'The operator binds its variable.', relations, workspaceForest: [
    { id: 'cp', label: 'CP', children: [leaf('op', opLabel, '', { silent: true, lineageId: 'relative' }),
      { id: 'tp', label: 'TP', children: [leaf('subj', 'D', 'Mia', { tokenIndex: 0 }), { id: 'vp', label: 'VP', children: [
        leaf('v', 'V', 'saw', { tokenIndex: 1 }), gap, leaf('him', 'D', 'him', { tokenIndex: 2 })] }] }] }] }],
  sentence: 'Mia saw him', inputTokens: ['Mia', 'saw', 'him'], includePlayback: true });

test('a bound trace shares its word label, where the trace already shows its index', () => {
  const witnessed = relative([{ relation: 'OperatorVariableBinding', anchors: { operator: 'op', variable: 'trace', traceWitness: 'trace' } }],
    'DP', leaf('trace', 'D', 'tᵢ', { silent: true, lineageId: 'relative' }));
  assert.deepEqual(checkOneLetterPerLabel(witnessed), []);
  // Keyed by authored ID, the letter misses the word tᵢ it is drawn beside.
  const byAuthoredId = (primitives, items, context) => planIndexLetters(primitives, items, { ...context,
    labelOf: (letter, primitive) => letter.role === 'identity' ? context.labelOf(letter, primitive) : letter.nodeId,
    writtenSubscript: label => typeof label === 'string' ? null : context.writtenSubscript(label) });
  assert(checkOneLetterPerLabel(witnessed, byAuthoredId).some(violation => violation.detail === 'trace::__leaf shows i 2 times'));
});

test('the active claim draws a shared letter, so it is never dimmed inside a quiet owner', () => {
  const coreferent = relative([{ relation: 'OperatorVariableBinding', anchors: { operator: 'op', variable: 'gap' }, values: { index: 'i' } },
    { relation: 'Coreference', anchors: { antecedent: 'op', pronoun: 'him' }, values: { index: 'i' } }]);
  const current = moment(coreferent, 0, 1);
  const atOperator = current => paint(current, current.emphasis).letters.filter(letter => letter.nodeId === 'op');
  assert.deepEqual(atOperator(current).map(letter => [letter.index, letter.opacity]), [['i', 1]]);
  const roleFirst = planIndexLetters(current.primitives, current.items, { ...byNode, emphasisRank: () => 0 });
  assert.deepEqual(atOperator({ ...current, letterPlan: roleFirst }).map(letter => [letter.index, letter.opacity]), [['i', 0.3]],
    'ranking the binding first leaves the active letter at the quiet binding opacity');
});

test('a written subscript such as Opᵢ shows the letter and carries the claim that asserts it', () => {
  const opLabel = new Element('text', { class: 'category-label', 'data-category-node-id': 'op' }, { __vizId: 'op' });
  opLabel.text = 'Opᵢ';
  const labels = { labelOf: letter => letter.nodeId === 'op' ? opLabel : letter.nodeId,
    writtenSubscript: label => label === opLabel ? 'i' : null };
  const current = moment(relative([{ relation: 'OperatorVariableBinding', anchors: { operator: 'op', variable: 'gap' } }], 'Opᵢ'), 0, 0, labels);
  const { letters, decorations } = paint(current, current.emphasis);
  assert.deepEqual(letters.map(letter => letter.nodeId), ['gap'], 'no second i beside Opᵢ');
  assert.deepEqual(refs(decorations.get(opLabel)), ['0:0']);
});

// Painted opacity as the shared emphasis CSS resolves it on each element.
const paintedOpacity = element => !element ? 1 : (element.classList.contains('vr-relation-active') ? 1
  : element.classList.contains('vr-relation-quiet') ? 0.3 : Number(element.attrs.opacity ?? 1)) * paintedOpacity(element.parentNode);

test('shared letters dim once: active ones paint at 1 and quiet ones at the shared 0.3', () => {
  // Frame 23 of the scope analysis: the j chain's QR moment; the i chain's is quiet.
  const { items, primitives, letterPlan, emphasis } = moment(prepare(stages), 2, 0);
  const root = new Element('g'), g = select(root), overlay = g.append('g');
  const layers = createRelationLayers({ activeDerivationFrameIndex: 2, relationLayerKey, g, decorateRelationElement, overlay });
  const drawing = createBindingDrawing({ ...layers, activeDerivationFrameIndex: 2, overlay, frameItems: items, g,
    operatorVariableScopeRankByItem: new Map(), operatorVariableScopeItems: [], activeRelationMoment: { stageIndex: 2, relationIndex: 0 },
    relationEmphasisForItem: emphasis, decorateRelationElement, relationLayerKey, resolveOverlayAnchor: () => undefined,
    terminalAmbiguities: new Map(), identityTerminalOwners: new Map(), identityForestLightFamilies: [], markIdentityLensOccurrences() {},
    TARGET_EMERALD: '#34d399', indexLetterPlan: letterPlan });
  for (const primitive of primitives) {
    // As the relation scene creates each primitive's host.
    const item = items[primitive.itemIndex], host = overlay.append('g').attr('class', 'vr-item');
    decorateRelationElement(host.node(), item, emphasis(item));
    host.attr('opacity', emphasis(item) === 'quiet' ? 0.3 : null);
    ({ 'quantifier-raising': drawing.drawQuantifierRaising, 'operator-variable-binding': drawing.drawOperatorVariableBinding })[primitive.type]
      ?.(primitive, item, host, emphasis(item));
  }
  applyRelationEmphasis(root, { stageIndex: 2, relationIndex: 0 }, null);
  const letters = descendants(root).filter(element => element.attrs['data-operator-variable-index-role']).map(element =>
    [element.parentNode.attrs[`data-operator-variable-${element.attrs['data-operator-variable-index-role']}`], element.textContent, paintedOpacity(element)]);
  assert.deepEqual(letters.sort(), [['obj', 'j', 1], ['objhigh', 'j', 1], ['subj', 'i', 0.3], ['subjhigh', 'i', 0.3]]);
  assert(descendants(root).filter(element => (element.attrs.class || '') === 'babel-operator-variable-path')
    .every(path => [1, 0.3].includes(paintedOpacity(path))), 'binding paths dim once too');
});

test('a mark inside an already quiet ancestor is not dimmed again', () => {
  const root = new Element('g');
  const label = select(root).append('text').attr('class', 'vr-item terminal-label');
  decorateRelationElement(label.node(), { relationRef: { stageIndex: 0, relationIndex: 0 } }, null);
  // A theta or identity index whose own claim differs from its label's.
  const index = label.append('tspan').attr('class', 'vr-item babel-theta-terminal-index');
  decorateRelationElement(index.node(), { relationRef: { stageIndex: 0, relationIndex: 1 } }, null);
  applyRelationEmphasis(root, { stageIndex: 0, relationIndex: 2 }, null);
  assert.equal(paintedOpacity(index.node()), 0.3);
  applyRelationEmphasis(root, { stageIndex: 0, relationIndex: 1 }, null);
  assert.equal(paintedOpacity(index.node()), 1, 'a label never dims an index whose claim is in focus');
});

/** One Replay moment painted with the production relation layers, binding
 * painters and emphasis, over the step's own tree labels. */
function paintMoment(replay, stageIndex, relationIndex) {
  const stepIndex = replay.playbackSteps.findIndex(step => step.replayKind === 'relation'
    && step.replayRelationIdentity?.stageIndex === stageIndex && step.replayRelationIdentity?.relationIndex === relationIndex);
  const { items, primitives, emphasis } = moment(replay, stageIndex, relationIndex);
  const structure = frameStructure(replay.playbackSteps[stepIndex]);
  const nodes = indexHierarchyNodesByIdAndAliases([...structure.nodes.values()]), resolve = id => nodes.get(id);
  const root = new Element('g'), g = select(root);
  for (const [id, runs] of treeLabelRunsForStep(replay, stepIndex, undefined, { includeRelationIndices: false })) for (const run of runs) {
    const label = new Element('text', { class: `${run.kind}-label`,
      [run.kind === 'category' ? 'data-category-node-id' : 'data-node-id']: id }, structure.nodes.get(id));
    label.text = run.text;
    root.appendChild(label);
  }
  const overlay = g.append('g');
  const drawing = createBindingDrawing({ ...createRelationLayers({ activeDerivationFrameIndex: stageIndex, relationLayerKey, g,
    decorateRelationElement, overlay }), activeDerivationFrameIndex: stageIndex, overlay, frameItems: items, g,
  operatorVariableScopeRankByItem: new Map(), operatorVariableScopeItems: [], activeRelationMoment: { stageIndex, relationIndex },
  relationEmphasisForItem: emphasis, decorateRelationElement, relationLayerKey, resolveOverlayAnchor: resolve, terminalAmbiguities: new Map(),
  identityTerminalOwners: new Map(), identityForestLightFamilies: [], markIdentityLensOccurrences() {}, TARGET_EMERALD: '#34d399',
  indexLetterPlan: planIndexLetters(primitives, items, { ...indexLetterLabels(g, resolve), emphasisRank: item => emphasis(item) === 'active' ? 2 : 0 }) });
  const painters = { 'quantifier-raising': drawing.drawQuantifierRaising, 'operator-variable-binding': drawing.drawOperatorVariableBinding,
    'identity-lens': drawing.drawIdentityLens, 'index-badge': drawing.drawIndexBadge };
  for (const primitive of primitives) {
    // As the relation scene creates each primitive's host.
    const item = items[primitive.itemIndex], host = overlay.append('g').attr('class', 'vr-item');
    decorateRelationElement(host.node(), item, emphasis(item));
    host.attr('opacity', emphasis(item) === 'quiet' ? 0.3 : null);
    painters[primitive.type](primitive, item, host, emphasis(item));
  }
  applyRelationEmphasis(root, { stageIndex, relationIndex }, null);
  return root;
}
const identityIndices = (root, labelId) => descendants(root).filter(element => (element.attrs.class || '').includes('babel-identity-index')
  && (element.parentNode.attrs['data-node-id'] ?? element.parentNode.attrs['data-category-node-id'])?.startsWith(labelId))
  .map(index => [index.textContent, paintedOpacity(index)]);

test('a terminal label hosting a shared index follows the binding that shares it', () => {
  // Identity coindexes the operator and a silent trace whose word is t; the
  // binding then names that trace as its witness, sharing the trace's i.
  const replay = relative([{ relation: 'Identity', anchors: { occurrences: ['op', 'trace'] }, values: { index: 'i' } },
    { relation: 'OperatorVariableBinding', anchors: { operator: 'op', variable: 'trace', traceWitness: 'trace' }, values: { index: 'i' } }],
  'DP', leaf('trace', 'D', 't', { silent: true, lineageId: 'relative' }));
  const root = paintMoment(replay, 0, 1);
  assert.deepEqual(identityIndices(root, 'trace'), [['i', 1]]);
  assert.equal(descendants(root).filter(element => element.attrs['data-operator-variable-index-role'] === 'variable').length, 0,
    'the binding draws no second i beside the trace');
});

test('a written label such as Opᵢ never dims the active index it hosts, and a quiet one dims once', () => {
  // The binding's i is written into Opᵢ; identity then adds j to the same label.
  const replay = relative([{ relation: 'OperatorVariableBinding', anchors: { operator: 'op', variable: 'gap' } },
    { relation: 'Identity', anchors: { occurrences: ['op', 'him'] }, values: { index: 'j' } },
    { relation: 'clause typing', anchors: { clause: 'cp' } }], 'Opᵢ');
  assert.deepEqual(identityIndices(paintMoment(replay, 0, 1), 'op'), [['j', 1]]);
  assert.deepEqual(identityIndices(paintMoment(replay, 0, 2), 'op'), [['j', 0.3]]);
});

test('a restated binding shares its path at the restatement moment while the domain keeps its own quiet emphasis', () => {
  // Offline mirror of tests/browser/operatorBindingComposition.test.mjs.
  const tree = { id: 'cp', label: 'CP', children: [{ id: 'operator', label: 'D', lineageId: 'relative' },
    { id: 'domain', label: 'TP', children: [{ id: 'subject', label: 'D', word: 'Mia' },
      { id: 'vp', label: 'VP', children: [{ id: 'verb', label: 'V', word: 'bought' }, { id: 'variable', label: 'D[trace]', lineageId: 'relative' }] }] }] };
  const replay = prepareReplay({ sentence: 'Mia bought', includePlayback: true, derivationStages: [
    { statement: 'Bind the object.', stageRecord: 'An operator binds the object position.', workspaceForest: [tree],
      relations: [{ relation: 'relative abstraction', anchors: { operator: 'operator', variable: 'variable', domain: 'domain' } }] },
    { statement: 'Restate the dependency.', stageRecord: 'The same binding continues.', workspaceForest: [tree],
      relations: [{ relation: 'relative operator dependency', anchors: { operator: 'operator', variable: 'variable' } }] }] });
  // The owning relation element's own opacity, as the browser spec reads it, and the painted result.
  const ownOpacity = element => element.classList.contains('vr-relation-active') ? 1
    : element.classList.contains('vr-relation-quiet') ? 0.3 : Number(element.attrs.opacity ?? 1);
  const inspect = root => Object.fromEntries(['path', 'domain'].map(piece => {
    const marks = descendants(root).filter(element => (element.attrs.class || '') === `babel-operator-variable-${piece}`);
    const owner = marks[0].parentNode.closest('.vr-item');
    return [piece, { count: marks.length, owners: owner.attrs['data-vr-owner-refs'].split(' ').sort(), own: ownOpacity(owner), painted: paintedOpacity(marks[0]) }];
  }));
  const first = inspect(paintMoment(replay, 0, 0));
  assert.deepEqual([first.path.own, first.domain.own, first.path.count, first.domain.count], [1, 1, 1, 1]);
  const restated = inspect(paintMoment(replay, 1, 0));
  assert.deepEqual(restated.path, { count: 1, owners: ['0:0', '1:0'], own: 1, painted: 1 });
  assert.deepEqual(restated.domain, { count: 1, owners: ['0:0'], own: 0.3, painted: 0.3 });
});

test('inline coindices hold their label; unplaceable ones never take a letter; unlisted letters are errors', () => {
  const binding = { kind: 'operator-variable-binding', familyId: 'scope.operator-variable', relationRef: { stageIndex: 0, relationIndex: 1 },
    appearsAtStage: 0, operatorNodeId: 'operator', variableNodeId: 'trace', index: 'i' };
  const identity = { kind: 'coindex', familyId: 'identity.occurrences', nodeIds: ['operator', 'trace'], index: 'i',
    relationRef: { stageIndex: 0, relationIndex: 0 }, appearsAtStage: 0 };
  const items = [identity, binding];
  const primitives = [{ type: 'identity-lens', nodeIds: identity.nodeIds, index: 'i', itemIndex: 0 },
    { type: 'operator-variable-binding', operatorNodeId: 'operator', variableNodeId: 'trace', index: 'i', itemIndex: 1 }];
  // The silent trace shows the coindex in its own label; the operator shows it on its word.
  const context = { labelOf: letter => letter.role !== 'identity' ? letter.nodeId : letter.nodeId === 'trace' ? 'trace' : 'operator-word',
    writtenSubscript: () => null, emphasisRank: item => item === binding ? 2 : 0 };
  const letter = (letterPlan, itemIndex, role, nodeId) => letterPlan({ itemIndex, role, nodeId, index: 'i' });
  const letterPlan = planIndexLetters(primitives, items, context);
  assert.deepEqual(letter(letterPlan, 0, 'identity', 'trace'), { draw: 'glyph', label: 'trace', alsoFor: [1] }, 'even against an active binding');
  assert.deepEqual(letter(letterPlan, 1, 'variable', 'trace'), { draw: 'none' });
  assert.deepEqual(letter(letterPlan, 1, 'operator', 'operator'), { draw: 'glyph', label: 'operator', alsoFor: [] });
  const unplaced = planIndexLetters(primitives, items, { ...context, labelOf: (item, primitive) => item.role === 'identity' ? null : context.labelOf(item, primitive) });
  assert.deepEqual(letter(unplaced, 1, 'variable', 'trace'), { draw: 'glyph', label: 'trace', alsoFor: [] });
  assert.throws(() => letter(letterPlan, 1, 'operator', 'elsewhere'), /not among the drawable primitives/);
});

test('QR refinement places each drawn letter at its own occurrence', () => {
  const root = new Element('g');
  const host = select(root).append('g').attr('class', 'vr-item')
    .attr('data-qr-pronounced', 'low').attr('data-qr-lf', 'high').attr('data-qr-domain', '');
  host.append('g').attr('class', 'babel-coindex-relation-layer').append('text')
    .attr('class', 'babel-binding-index babel-relation-index').attr('data-qr-index-role', 'lf').text('j');
  host.append('g').attr('class', 'babel-lf-relation-layer').append('path').attr('class', 'babel-lf-path-qr');
  const rects = { low: { x: 0, y: 400, width: 80, height: 40 }, high: { x: 300, y: 0, width: 120, height: 60 } };
  const { refineQuantifierRaising } = createBindingRefinements({ measuredShellRect: id => rects[id] ?? null });
  refineQuantifierRaising.call(host.node());
  const letter = descendants(root).find(element => element.tag === 'text');
  assert.deepEqual([letter.attrs.x, letter.attrs.y], ['432.0', '60.0'], 'the LF letter is not moved to the pronounced occurrence');
});
