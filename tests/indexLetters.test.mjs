import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createBindingDrawing } from '../components/renderer/bindingDrawing.ts';
import { createBindingRefinements } from '../components/renderer/bindingRefinements.ts';
import { planIndexLetters, primitiveIndexLetters } from '../components/renderer/indexLetters.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { isPlanItemRevealed, planItemOwnsRelationMoment, planItemRelationRefs } from '../replay/relations/renderPlan.ts';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
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

/** The drawable letter marks at one authored relation moment, and their plan. */
function moment(replay, stageIndex, relationIndex) {
  const step = replay.playbackSteps.findIndex(candidate => candidate.replayKind === 'relation'
    && candidate.replayRelationIdentity?.stageIndex === stageIndex && candidate.replayRelationIdentity?.relationIndex === relationIndex);
  const played = new Set(replay.playbackSteps.slice(0, step + 1).flatMap(candidate => candidate.replayKind === 'relation'
    && candidate.replayRelationIdentity?.stageIndex === stageIndex ? [candidate.replayRelationIdentity.relationIndex] : []));
  const plan = replay.relationRenderPlan, items = plan.frames[stageIndex].items;
  const primitives = bindRelationPlanFrame(plan, stageIndex, () => ({ x: 0, y: 0 })).primitives
    .filter(primitive => isPlanItemRevealed(items[primitive.itemIndex], stageIndex, played, relationIndex)
      && primitiveIndexLetters(primitive).length);
  const letterPlan = planIndexLetters(primitives, items, { identityLabel: nodeId => nodeId, writtenSubscript: () => null,
    emphasisRank: item => planItemOwnsRelationMoment(item, stageIndex, relationIndex) ? 2 : 0 });
  return { items, primitives, letterPlan };
}
const letterCounts = letters => [...letters.reduce((counts, { nodeId, index }) =>
  counts.set(`${nodeId}:${index}`, (counts.get(`${nodeId}:${index}`) ?? 0) + 1), new Map())].sort();
const drawnLetters = ({ primitives, letterPlan }) => primitives.flatMap(primitiveIndexLetters).filter(letter => letterPlan(letter).draw);

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
function paint({ items, primitives, letterPlan }) {
  const root = new Element('g'), layers = new Map();
  const drawing = createBindingDrawing({
    activeDerivationFrameIndex: 0, overlay: select(root), frameItems: items, g: select(root),
    operatorVariableScopeRankByItem: new Map(), operatorVariableScopeItems: [], focusedRelationMoment: null,
    operatorVariableBindingLayers: new Map(), operatorVariableSharedPathLayers: new Map(),
    acceptedRootLayerBeforeNodes: (_layers, item, _emphasis, className) => {
      const key = JSON.stringify([refs(item), className]);
      if (!layers.has(key)) layers.set(key, select(root).append('g').attr('class', className));
      return layers.get(key);
    },
    relationEmphasisForItem: () => null, decorateRelationElement() {},
    resolveOverlayAnchor: () => undefined, terminalAmbiguities: new Map(), identityTerminalOwners: new Map(),
    identityForestLightFamilies: [], markIdentityLensOccurrences() {}, indexLetterPlan: letterPlan
  });
  for (const primitive of primitives) {
    const host = select(root).append('g').attr('class', 'vr-item');
    if (primitive.type === 'quantifier-raising') drawing.drawQuantifierRaising(primitive, items[primitive.itemIndex], host, null);
    if (primitive.type === 'operator-variable-binding') drawing.drawOperatorVariableBinding(primitive, items[primitive.itemIndex], host, null);
  }
  // Every letter names the exact occurrence its painter binds it to.
  return descendants(root).filter(element => element.tag === 'text').map(element => {
    const role = element.attrs['data-qr-index-role'] || element.attrs['data-operator-variable-index-role'];
    const host = element.attrs['data-qr-index-role'] ? element.parentNode.parentNode : element.parentNode;
    const nodeId = { pronounced: host.attrs['data-qr-pronounced'], lf: host.attrs['data-qr-lf'],
      operator: host.attrs['data-operator-variable-operator'], variable: host.attrs['data-operator-variable-variable'] }[role];
    return { nodeId, index: element.textContent, role };
  });
}

test('the production painters draw only their assigned letters', () => {
  const existential = moment(prepare(stages), 2, 0);
  const everyLetter = paint({ ...existential, letterPlan: () => ({ draw: true, alsoFor: [] }) });
  assert.equal(everyLetter.filter(letter => letter.nodeId === 'objhigh').length, 2, 'both marks own the landing letter');
  const letters = paint(existential);
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

const binding = (relationIndex, operatorNodeId = 'operator') => ({ kind: 'operator-variable-binding', familyId: 'scope.operator-variable',
  relationRef: { stageIndex: 0, relationIndex }, appearsAtStage: 0, operatorNodeId, variableNodeId: 'trace', index: 'i' });
const bindingPrimitive = (item, itemIndex) => ({ type: 'operator-variable-binding', operatorNodeId: item.operatorNodeId,
  variableNodeId: item.variableNodeId, index: item.index, itemIndex });

test('an inline coindex or written subscript on the same label shows the letter; other labels keep theirs', () => {
  const identity = { kind: 'coindex', familyId: 'identity.occurrences', nodeIds: ['operator', 'trace'], index: 'i',
    relationRef: { stageIndex: 0, relationIndex: 0 }, appearsAtStage: 0 };
  const items = [identity, binding(1)];
  const primitives = [{ type: 'identity-lens', nodeIds: identity.nodeIds, index: 'i', itemIndex: 0 }, bindingPrimitive(items[1], 1)];
  // The silent trace shows the coindex in its own label; the operator shows it on its word.
  const context = { identityLabel: nodeId => nodeId === 'trace' ? 'trace' : 'operator-word', writtenSubscript: () => null, emphasisRank: () => 0 };
  const letter = (letterPlan, itemIndex, role, nodeId) => letterPlan({ itemIndex, role, nodeId, index: 'i' });
  const letterPlan = planIndexLetters(primitives, items, context);
  assert.deepEqual(letter(letterPlan, 0, 'identity', 'trace'), { draw: true, alsoFor: [1] });
  assert.deepEqual(letter(letterPlan, 1, 'variable', 'trace'), { draw: false });
  assert.deepEqual(letter(letterPlan, 1, 'operator', 'operator'), { draw: true, alsoFor: [] });
  const written = planIndexLetters(primitives, items, { ...context, writtenSubscript: nodeId => nodeId === 'operator' ? 'i' : null });
  assert.deepEqual(letter(written, 1, 'operator', 'operator'), { draw: false }, 'Opᵢ needs no second i');
  const unplaced = planIndexLetters(primitives, items, { ...context, identityLabel: () => null });
  assert.deepEqual(letter(unplaced, 1, 'variable', 'trace'), { draw: true, alsoFor: [] },
    'a coindex no single label can show never takes the letter');
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
