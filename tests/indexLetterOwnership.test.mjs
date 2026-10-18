import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createBindingDrawing } from '../components/renderer/bindingDrawing.ts';
import { createBindingRefinements } from '../components/renderer/bindingRefinements.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { assignIndexLetterOwners, primitiveIndexLetters } from '../replay/relations/indexLetterOwnership.ts';
import { isPlanItemRevealed, planItemOwnsRelationMoment, planItemRelationRefs } from '../replay/relations/renderPlan.ts';
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

/** The marks Replay draws at the existential's QR moment (frame 23 of 25). */
function existentialMoment() {
  const replay = prepareReplay({ derivationStages: stages, sentence: 'Everyone loves someone.',
    inputTokens: ['Everyone', 'loves', 'someone'], includePlayback: true });
  const stepIndex = replay.playbackSteps.findIndex(step => step.replayKind === 'relation'
    && step.replayRelationIdentity?.stageIndex === 2 && step.replayRelationIdentity?.relationIndex === 0);
  const plan = replay.relationRenderPlan, items = plan.frames[2].items, played = new Set([0]);
  const marks = bindRelationPlanFrame(plan, 2, () => ({ x: 0, y: 0 })).primitives
    .filter(primitive => isPlanItemRevealed(items[primitive.itemIndex], 2, played, 0))
    .map(primitive => ({ primitive, item: items[primitive.itemIndex] }));
  return { stepIndex, items, marks };
}
const letterCounts = slots => slots.reduce((counts, slot) => {
  const key = `${slot.nodeId}:${slot.index}`;
  return counts.set(key, (counts.get(key) ?? 0) + 1);
}, new Map());
const activeRank = item => planItemOwnsRelationMoment(item, 2, 0) ? 2 : 0;

test('each QR chain letter is owned by its covert path and binding path but painted once per occurrence', () => {
  const { stepIndex, items, marks } = existentialMoment();
  assert.equal(stepIndex, 22, 'the reported Replay frame 23');
  const slots = marks.flatMap(({ primitive, item }) => primitiveIndexLetters(primitive, item));
  // Each QR relation earns a covert path and a binding path; both index both occurrences.
  assert.deepEqual([...letterCounts(slots)].sort(), [['obj:j', 2], ['objhigh:j', 2], ['subj:i', 2], ['subjhigh:i', 2]]);

  const ownership = assignIndexLetterOwners(marks, { emphasisRank: activeRank });
  const painted = slots.filter(slot => ownership.owners(slot.itemIndex, slot.role, slot.nodeId));
  assert.deepEqual([...letterCounts(painted)].sort(), [['obj:j', 1], ['objhigh:j', 1], ['subj:i', 1], ['subjhigh:i', 1]],
    'two chains keep two distinct letters');
  const landing = painted.find(slot => slot.nodeId === 'objhigh');
  assert.equal(items[landing.itemIndex].kind, 'operator-variable-binding', 'the index placed clear of the binding path holds');
  assert.equal(landing.role, 'operator');
  assert.deepEqual(ownership.owners(landing.itemIndex, landing.role, landing.nodeId).map(index => items[index].kind).sort(),
    ['operator-variable-binding', 'quantifier-raising']);
});

const { Element, restore } = createSvgDom();
after(restore);
function paint(marks, items, { indexLetters, emphasis = () => null } = {}) {
  const root = new Element('g'), decorations = new Map(), layers = new Map();
  const drawing = createBindingDrawing({
    activeDerivationFrameIndex: 2, overlay: select(root), frameItems: items, g: select(root),
    operatorVariableScopeRankByItem: new Map(), operatorVariableScopeItems: [], focusedRelationMoment: null,
    operatorVariableBindingLayers: new Map(), operatorVariableSharedPathLayers: new Map(),
    acceptedRootLayerBeforeNodes: (_layers, item, _emphasis, className) => {
      const key = JSON.stringify([item.relationRef.stageIndex, item.relationRef.relationIndex, className]);
      if (!layers.has(key)) layers.set(key, select(root).append('g').attr('class', className));
      return layers.get(key);
    },
    relationEmphasisForItem: emphasis, decorateRelationElement: (element, item) => decorations.set(element, item),
    resolveOverlayAnchor: () => undefined, terminalAmbiguities: new Map(), identityTerminalOwners: new Map(),
    identityForestLightFamilies: [], markIdentityLensOccurrences() {}, indexLetters
  });
  for (const { primitive, item } of marks) {
    const host = select(root).append('g').attr('class', 'vr-item');
    if (primitive.type === 'quantifier-raising') drawing.drawQuantifierRaising(primitive, item, host, null);
    if (primitive.type === 'operator-variable-binding') drawing.drawOperatorVariableBinding(primitive, item, host, null);
  }
  // Every letter names the exact occurrence its painter binds it to.
  const letters = descendants(root).filter(element => element.tag === 'text').map(element => {
    const role = element.attrs['data-qr-index-role'] || element.attrs['data-operator-variable-index-role'];
    const host = element.attrs['data-qr-index-role'] ? element.parentNode.parentNode : element.parentNode;
    const nodeId = { pronounced: host.attrs['data-qr-pronounced'], lf: host.attrs['data-qr-lf'],
      operator: host.attrs['data-operator-variable-operator'], variable: host.attrs['data-operator-variable-variable'] }[role];
    return { element, nodeId, index: element.textContent, role };
  });
  return { root, letters, decorations };
}

test('the production painters draw one letter at the existential landing and at its variable', () => {
  const { items, marks } = existentialMoment();
  const drawn = marks.filter(({ primitive }) => ['quantifier-raising', 'operator-variable-binding'].includes(primitive.type));
  const unshared = paint(drawn, items);
  assert.equal(unshared.letters.filter(letter => letter.nodeId === 'objhigh').length, 2, 'without ownership both painters draw j');

  const indexLetters = assignIndexLetterOwners(marks, { emphasisRank: activeRank });
  const { letters } = paint(drawn, items, { indexLetters });
  assert.deepEqual([...letterCounts(letters)].sort(), [['obj:j', 1], ['objhigh:j', 1], ['subj:i', 1], ['subjhigh:i', 1]]);
  assert.deepEqual(letters.filter(letter => letter.nodeId === 'objhigh').map(letter => letter.role), ['operator']);
  // The covert path still draws: only its duplicate letters yield.
  assert.equal(drawn.filter(({ primitive }) => primitive.type === 'quantifier-raising').length, 2);
});

const binding = (relationIndex, extra = {}) => ({ kind: 'operator-variable-binding', familyId: 'scope.operator-variable',
  relationRef: { stageIndex: 0, relationIndex, relation: 'operator binding' }, appearsAtStage: 0,
  operatorNodeId: 'operator', variableNodeId: 'trace', index: 'i', ...extra });
const bindingMark = (item, itemIndex) => ({ item, primitive: { type: 'operator-variable-binding',
  operatorNodeId: item.operatorNodeId, variableNodeId: item.variableNodeId, index: item.index, itemIndex } });

test('a restated binding shares one letter that follows its active owner and keeps both claims', () => {
  const items = [binding(1), binding(2)];
  const marks = items.map(bindingMark);
  for (const [active, holder] of [[1, 0], [2, 1], [null, 0]]) {
    const emphasis = item => active === null ? null : planItemOwnsRelationMoment(item, 0, active) ? 'active' : 'quiet';
    const indexLetters = assignIndexLetterOwners(marks, { emphasisRank: item => ({ active: 2, quiet: 0 })[emphasis(item)] ?? 1 });
    const { letters, decorations } = paint(marks, items, { indexLetters, emphasis });
    assert.deepEqual(letters.map(letter => [letter.nodeId, letter.index]), [['operator', 'i'], ['trace', 'i']], String(active));
    for (const letter of letters) {
      assert.equal(letter.element.parentNode.attrs['data-operator-variable-operator'], 'operator');
      assert.deepEqual(planItemRelationRefs(decorations.get(letter.element)).map(ref => ref.relationIndex).sort(), [1, 2]);
    }
    assert.equal(indexLetters.owners(holder, 'operator', 'operator')[0], holder, `the ${active ?? 'neutral'} holder`);
  }
});

test('distinct letters, distinct occurrences and suppressed restatements keep their own painting', () => {
  const items = [binding(1), binding(2, { index: 'j' }), binding(3, { variableNodeId: 'other' }),
    binding(4, { bindingPathSuppressed: true })];
  const ownership = assignIndexLetterOwners(items.map(bindingMark));
  assert.deepEqual(ownership.owners(0, 'operator', 'operator'), [0, 2]);
  assert.equal(ownership.owners(2, 'operator', 'operator'), null);
  assert.deepEqual(ownership.owners(1, 'operator', 'operator'), [1], 'a different letter is a different index');
  assert.deepEqual(ownership.owners(2, 'variable', 'other'), [2]);
  assert.deepEqual(ownership.owners(0, 'variable', 'trace'), [0], 'a suppressed restatement claims no letter');
});

test('an inline identity coindex on the same label holds; a coindex on a different label does not', () => {
  const identity = { kind: 'coindex', familyId: 'identity.occurrences', nodeIds: ['operator', 'trace'], index: 'i',
    relationRef: { stageIndex: 0, relationIndex: 0, relation: 'identity' }, appearsAtStage: 0 };
  const items = [identity, binding(1)];
  const marks = [{ item: identity, primitive: { type: 'identity-lens', nodeIds: identity.nodeIds, index: 'i', itemIndex: 0 } },
    bindingMark(items[1], 1)];
  // The silent trace shows the coindex in its own label; the operator shows it on its word.
  const ownership = assignIndexLetterOwners(marks, { emphasisRank: item => item === items[1] ? 2 : 0,
    inlineLabelNodeId: nodeId => nodeId === 'trace' ? 'trace' : `${nodeId}-word` });
  assert.deepEqual(ownership.owners(0, 'identity', 'trace'), [0, 1]);
  assert.equal(ownership.owners(1, 'variable', 'trace'), null);
  assert.deepEqual(ownership.owners(1, 'operator', 'operator'), [1]);
  assert.deepEqual(assignIndexLetterOwners(marks, { inlineLabelNodeId: () => null }).owners(1, 'variable', 'trace'), [1],
    'a coindex its painter cannot place never takes the letter');
});

test('QR refinement places each surviving letter at its own occurrence', () => {
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
