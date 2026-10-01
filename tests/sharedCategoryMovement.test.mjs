import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';

const stage = (workspaceForest, relations = []) => ({
  statement: 'Authored state', stageRecord: '', workspaceForest, relations
});
const stagesFor = input => [stage(input.priorForest), stage(input.currentForest, [input.relation])];
const recover = input => recoverMovementEvidence(input.relation, input.currentForest, input.priorForest);
const find = (forest, id) => forest.flatMap(node => [node, ...flatten(node.children ?? [])]).find(node => node.id === id);
const flatten = forest => forest.flatMap(node => [node, ...flatten(node.children ?? [])]);
const owns = (dispatch, field, key) => {
  const entry = dispatch.evidenceCoverage.fields.find(item => item.field === field && item.key === key);
  return Boolean(entry?.recognizedBy.length && !entry.unrecoveredItemIndices.length);
};
const pathFor = input => compileRelationRenderPlan(stagesFor(input)).frames.at(-1).items
  .find(item => item.kind === 'trajectory' && item.relationRef.stageIndex === 1);
const replayFor = input => {
  const { steps } = buildReplayPlayback({ sentence: 'token', analyses: [{ derivationStages: stagesFor(input) }] });
  const moment = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1
    && step.replayRelationIdentity.relationIndex === 0);
  assert(moment > 0, 'the authored relation must retain its own Replay moment');
  return { steps, moment, before: steps[moment - 1], after: steps[moment] };
};

const retainedInflectionHead = (qualified = false) => {
  const source = { id: 'low', label: 'V', lineageId: 'verb', word: 'read' };
  const stem = { id: 'read-domain', label: 'VP', children: [source] };
  const inflection = { id: 'inflection', label: 'I: participial inflection', children: [
    { id: 'tense', label: 'T', word: '-DIK' },
    { id: 'agreement', label: 'Agr', word: '-u' }
  ] };
  return {
    priorForest: [structuredClone(stem), structuredClone(inflection)],
    currentForest: [{ id: 'ip', label: 'IP', children: [{ id: 'ibar', label: 'I′', children: [
      { ...structuredClone(stem), children: [{ ...source, silent: true }] },
      { ...structuredClone(inflection), children: [{ ...source, id: 'high' }, ...structuredClone(inflection.children)] }
    ] }] }],
    relation: { relation: 'An independently authored dependency',
      anchors: { lowerOccurrence: 'low', [qualified ? 'raisedVerb' : 'raisedHead']: 'high', landingHead: 'inflection' },
      priorAnchors: { [qualified ? 'sourceVerb' : 'sourceOccurrence']: 'low' } },
    stageIndex: 1, relationIndex: 0
  };
};

for (const qualified of [false, true]) test(`a retained inflection head receives one exact member${qualified ? ' through qualified verb roles' : ''}`, () => {
  const input = retainedInflectionHead(qualified);
  const original = structuredClone(input);
  const movement = recover(input).movement;
  assert.equal(movement?.trajectoryKind, 'head');
  assert.equal(movement?.transition, true);
  assert.equal(movement?.sourceNodeId, 'low');
  assert.equal(movement?.targetNodeId, 'high');
  const dispatch = dispatchRelationClaims(input);
  assert(owns(dispatch, 'anchors', 'landingHead'));
  const path = pathFor(input);
  assert.equal(path?.sourceNodeId, 'low');
  assert.equal(path?.targetNodeId, 'high');
  const { steps, moment, before, after } = replayFor(input);
  assert(!steps.slice(0, moment).some(step => step.replayVisibleNodeIds.includes('high')));
  assert(after.replayVisibleNodeIds.includes('high'));
  assert.equal(find([before.replayCanvasData], 'low')?.silent, undefined);
  assert.equal(find([after.replayCanvasData], 'low')?.silent, true);
  const visibleChildren = (step, id) => find([step.replayCanvasData], id)?.children
    .filter(node => step.replayVisibleNodeIds.includes(node.id)).map(node => node.id);
  assert.deepEqual(visibleChildren(before, 'inflection'), ['tense', 'agreement']);
  assert.deepEqual(visibleChildren(after, 'inflection'), ['high', 'tense', 'agreement']);
  assert.deepEqual(input, original, 'recovery and Replay preserve the authored trees');
});

test('retained-head insertion needs the exact unchanged ordered companions', () => {
  for (const [name, mutate] of [
    ['changed literal', input => { find(input.currentForest, 'tense').word = '-OTHER'; }],
    ['changed identity', input => { find(input.currentForest, 'agreement').id = 'replacement-agreement'; }],
    ['reordered companions', input => { find(input.currentForest, 'inflection').children.reverse(); }],
    ['missing preceding head', input => { input.priorForest.pop(); }],
    ['ambiguous preceding head', input => { input.priorForest.push(structuredClone(input.priorForest.at(-1))); }]
  ]) {
    const input = retainedInflectionHead();
    mutate(input);
    assert.notEqual(recover(input).movement?.trajectoryKind, 'head', name);
    assert(!owns(dispatchRelationClaims(input), 'anchors', 'landingHead'), name);
  }
});

test('head insertion does not turn XP or X-prime participants into heads', () => {
  for (const label of ['XP', 'X′', 'XP: a projection', 'X′: an intermediate projection']) {
    for (const target of ['inflection', 'high']) {
      const input = retainedInflectionHead();
      find(input.currentForest, target).label = label;
      if (target === 'inflection') find(input.priorForest, target).label = label;
      assert.notEqual(recover(input).movement?.trajectoryKind, 'head', `${target}: ${label}`);
      assert(!owns(dispatchRelationClaims(input), 'anchors', 'landingHead'), `${target}: ${label}`);
    }
  }
});

test('a head landing never consumes a higher projection as its immediate host', () => {
  const input = retainedInflectionHead();
  input.relation.anchors.landingHead = 'ip';
  const dispatch = dispatchRelationClaims(input);
  assert(!owns(dispatch, 'anchors', 'landingHead'));
  assert(dispatch.claims.some(claim => claim.tier === 3
    && claim.consumedEvidence.some(entry => entry.field === 'anchors' && entry.key === 'landingHead')));
});

const qualifiedPhrase = (subject = false, descriptive = false) => {
  const category = subject ? 'DP' : 'PP';
  const lower = { id: 'low', label: descriptive ? `${category}: relative operator` : category, lineageId: 'phrase',
    ...(descriptive ? { silent: true } : { word: 'token' }) };
  const sourceDomain = { id: 'domain', label: 'VP', children: [lower, { id: 'verb', label: 'V', word: 'read' }] };
  return {
    priorForest: [structuredClone(sourceDomain)],
    currentForest: [{ id: 'landing-parent', label: descriptive ? 'CP: relative clause' : 'CP', children: [
      { ...structuredClone(lower), id: 'high' },
      { id: 'cbar', label: 'C′', children: [{ id: 'head', label: 'C', silent: true },
        { ...structuredClone(sourceDomain), children: [{ ...lower, silent: true }, { id: 'verb', label: 'V', word: 'read' }] }
      ] }
    ] }],
    relation: { relation: 'An independently authored dependency',
      anchors: subject ? { raisedSubject: 'high', subjectTrace: 'low', T: 'head' }
        : { raisedPP: 'high', complementTrace: 'low', relativeC: 'head' },
      priorAnchors: { [subject ? 'subjectPosition' : 'complementPosition']: 'low' } },
    stageIndex: 1, relationIndex: 0
  };
};

for (const subject of [false, true]) test(`qualified ${subject ? 'subject' : 'PP'} roles retain exact phrasal movement`, () => {
  const input = qualifiedPhrase(subject);
  const original = structuredClone(input);
  const movement = recover(input).movement;
  assert.equal(movement?.trajectoryKind, 'phrasal');
  assert.equal(movement?.transition, true);
  assert.equal(movement?.priorSourceNodeId, 'low');
  assert.equal(movement?.sourceNodeId, 'low');
  assert.equal(movement?.targetNodeId, 'high');
  const path = pathFor(input);
  assert.equal(path?.sourceNodeId, 'low');
  assert.equal(path?.targetNodeId, 'high');
  const { steps, moment, after } = replayFor(input);
  assert(!steps.slice(0, moment).some(step => step.replayVisibleNodeIds.includes('high')));
  assert(after.replayVisibleNodeIds.includes('high'));
  assert(after.replayVisibleNodeIds.includes('landing-parent'));
  assert.deepEqual(input, original);
});

test('descriptive categories preserve a silent DP landing and its projection level', () => {
  const input = qualifiedPhrase(true, true);
  input.relation.anchors = { higherOccurrence: 'high', objectTrace: 'low' };
  input.relation.priorAnchors = { sourceOccurrence: 'low' };
  assert.equal(recover(input).movement?.trajectoryKind, 'phrasal');
  const path = pathFor(input);
  assert.equal(path?.targetNodeId, 'high');
  assert.equal(path?.targetAttachment, 'shell-bottom');
  assert.equal(find(input.currentForest, 'high').label, 'DP: relative operator');
});

test('qualified wording never chooses among ambiguous exact endpoints or conflicting prior sources', () => {
  for (const mutate of [
    input => { input.currentForest[0].children.unshift({ id: 'also-high', label: 'DP', lineageId: 'phrase' }); input.relation.anchors.raisedSubject = ['high', 'also-high']; },
    input => { input.relation.anchors.raisedSubject = ['high', 'high']; },
    input => { find(input.currentForest, 'high').lineageId = 'different'; },
    input => { input.relation.priorAnchors = { sourceOccurrence: 'other' }; input.priorForest.push({ id: 'other', label: 'DP', lineageId: 'other' }); },
    input => { input.relation.anchors = { controller: 'low', target: 'high' }; delete input.relation.priorAnchors; }
  ]) {
    const input = qualifiedPhrase(true);
    mutate(input);
    assert.equal(recover(input).movement, undefined);
    assert.equal(pathFor(input), undefined);
  }
});

test('zero-level annotations retain heads while prime-level annotations retain projections', () => {
  for (const zero of ['⁰', '^0', '0']) {
    const input = retainedInflectionHead();
    find(input.currentForest, 'high').label = `V${zero}: verbal head`;
    find(input.currentForest, 'low').label = `V${zero}: verbal head`;
    find(input.priorForest, 'low').label = `V${zero}: verbal head`;
    assert.equal(recover(input).movement?.trajectoryKind, 'head', zero);
    find(input.currentForest, 'high').label = 'V′: verbal projection';
    assert.notEqual(recover(input).movement?.trajectoryKind, 'head', zero);
  }
});

test('bare P is a head category rather than an empty-base phrase', () => {
  const input = retainedInflectionHead();
  for (const forest of [input.priorForest, input.currentForest]) find(forest, 'low').label = 'P';
  find(input.currentForest, 'high').label = 'P';
  assert.equal(recover(input).movement?.trajectoryKind, 'head');
});

const fpLeaf = (id, label, extra = {}) => ({ id, label, ...extra });
const fpNode = (id, label, children) => ({ id, label, children });
const fpFind = (roots, id) => {
  const forest = Array.isArray(roots) ? roots : [roots];
  for (const node of forest) {
    if (node?.id === id) return node;
    const found = fpFind(node?.children ?? [], id);
    if (found) return found;
  }
};
const fpStage = (workspaceForest, relations = []) => ({
  statement: 'An authored syntactic state.', stageRecord: 'The named occurrences have the authored positions.',
  workspaceForest, relations
});
const fpFrench = () => {
  const oldHost = fpNode('tCl', 'T⁰', [
    fpNode('clitic', 'DP', [fpLeaf('cliticWord', 'D⁰', { word: 'lui' })]),
    fpLeaf('tAux', 'T⁰', { word: 'a' })
  ]);
  const lower = fpLeaf('negLow', 'Neg⁰', { word: 'ne', lineageId: 'negative-root' });
  const before = [fpNode('tBar', 'T′', [oldHost,
    fpNode('negP', 'NegP', [fpNode('negBar', 'Neg′', [lower,
      fpNode('vp', 'VP', [fpLeaf('verb', 'V⁰', { word: 'parlé' })])])])])];
  const after = structuredClone(before);
  after[0].children[0] = fpNode('tNeg', 'T⁰', [
    { ...lower, id: 'negHigh' }, structuredClone(oldHost)
  ]);
  fpFind(after, 'negLow').silent = true;
  const relation = { relation: 'An unfamiliar authored dependency',
    anchors: { host: 'tNeg', lowerCopy: 'negLow', raisedHead: 'negHigh' },
    priorAnchors: { host: 'tCl', source: 'negLow' } };
  return { before, after, relation };
};

const fpPolish = () => {
  const before = [fpNode('clauseIP', 'IP', [fpNode('clauseIBar', 'I′', [
    fpLeaf('iHead', 'I', { silent: true }),
    fpNode('outerVP', 'VP', [fpNode('outerVBar', 'V′', [
      fpLeaf('vHigh', 'V_light', { silent: true }),
      fpNode('innerVP', 'VP', [fpNode('innerVBar', 'V′', [
        fpLeaf('vLow', 'V', { word: 'pokazała', lineageId: 'showVerb' }),
        fpLeaf('theme', 'DP', { word: 'zdjęcie' })
      ])])
    ])])
  ])])];
  const middle = structuredClone(before);
  Object.assign(fpFind(middle, 'vHigh'), { label: 'V_light+V', word: 'pokazała', lineageId: 'showVerb', silent: false });
  fpFind(middle, 'vLow').silent = true;
  const final = structuredClone(middle);
  Object.assign(fpFind(final, 'iHead'), { label: 'I+V', word: 'pokazała', lineageId: 'showVerb', silent: false });
  fpFind(final, 'vHigh').silent = true;
  const relations = [
    { relation: 'An unfamiliar authored dependency', anchors: { higherOccurrence: 'vHigh', lowerOccurrence: 'vLow' } },
    { relation: 'A second unfamiliar authored dependency', anchors: { higherOccurrence: 'iHead', lowerOccurrence: 'vHigh' } }
  ];
  return { before, middle, final, relations };
};

test('a recursive retained T host gives negative-head movement its exact head landing', () => {
  const { before, after, relation } = fpFrench();
  const input = structuredClone({ before, after, relation });
  const movement = recoverMovementEvidence(relation, after, before).movement;
  assert.equal(movement?.trajectoryKind, 'head');
  assert.equal(movement?.transition, true);
  assert.equal(movement?.sourceNodeId, 'negLow');
  assert.equal(movement?.targetNodeId, 'negHigh');
  assert.ok(movement.context?.some(item => item.nodeId === 'tNeg' && item.kind === 'head-landing'));
  const plan = compileRelationRenderPlan([fpStage(before), fpStage(after, [relation])]);
  const path = plan.frames[1].items.find(item => item.kind === 'trajectory' && item.targetNodeId === 'negHigh');
  assert.equal(path?.trajectoryKind, 'head');
  assert.equal(path?.headLandingSite?.nodeId, 'tNeg');
  assert.deepEqual({ before, after, relation }, input, 'classification does not rewrite authored categories or hosts');
});

test('a recursive host does not borrow an unrelated or projected terminal spine', () => {
  for (const badLabel of ['C⁰', 'TP', 'T′']) {
    const { before, after, relation } = fpFrench();
    fpFind(after, 'tAux').label = badLabel;
    const result = recoverMovementEvidence(relation, after, before);
    assert.notEqual(result.movement?.trajectoryKind, 'head', `invalid retained host spine ${badLabel}`);
  }
});

test('compound projected heads fill existing positions with source lineage without using the relation title', () => {
  const { before, middle, final, relations } = fpPolish();
  for (const [previous, current, relation, source, target] of [
    [before, middle, relations[0], 'vLow', 'vHigh'],
    [middle, final, relations[1], 'vHigh', 'iHead']
  ]) {
    const input = structuredClone({ previous, current, relation });
    const movement = recoverMovementEvidence(relation, current, previous).movement;
    assert.equal(movement?.trajectoryKind, 'head');
    assert.equal(movement?.transition, true, 'new source lineage fills the pre-existing exact head position');
    assert.equal(movement?.sourceNodeId, source);
    assert.equal(movement?.targetNodeId, target);
    assert.equal(recoverMovementEvidence(relation, current, current).movement?.transition, false,
      'restating the completed state does not create another movement');
    const spelling = structuredClone(current);
    fpFind(spelling, target).word = 'inny';
    assert.equal(recoverMovementEvidence(relation, spelling, current).movement?.transition, false,
      'a later pronunciation change does not create another movement');
    assert.deepEqual({ previous, current, relation }, input);
  }
});

test('compound spelling cannot turn phrase projections or unproved companions into a projected head', () => {
  for (const badLabel of ['IP+V', 'I′+V', 'Q+V']) {
    const { middle, final, relations } = fpPolish();
    fpFind(final, 'iHead').label = badLabel;
    assert.notEqual(recoverMovementEvidence(relations[1], final, middle).movement?.trajectoryKind, 'head', badLabel);
  }
  const { middle, final, relations } = fpPolish();
  fpFind(final, 'outerVP').label = 'Q';
  assert.notEqual(recoverMovementEvidence(relations[1], final, middle).movement?.trajectoryKind, 'head',
    'an unproved nonprojection companion does not establish the head position');
});

test('Replay keeps source pronunciation and existing head forms until each compound-head relation moment', () => {
  const { before, middle, final, relations } = fpPolish();
  const stages = [fpStage(before),
    fpStage(middle, [{ relation: 'Earlier observation', anchors: { witness: 'theme' } }, relations[0]]),
    fpStage(final, [{ relation: 'Earlier observation', anchors: { witness: 'theme' } }, relations[1]])];
  const original = structuredClone(stages);
  const steps = buildReplayPlayback({ sentence: 'pokazała zdjęcie', analyses: [{ framework: 'xbar', derivationStages: stages }] }).steps;
  for (const [stageIndex, source, target, oldLabel, newLabel] of [
    [1, 'vLow', 'vHigh', 'V_light', 'V_light+V'],
    [2, 'vHigh', 'iHead', 'I', 'I+V']
  ]) {
    const at = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === stageIndex
      && step.replayRelationIdentity.relationIndex === 1);
    assert.ok(at > 0, 'movement has a distinct authored relation moment');
    const preceding = steps[at - 1];
    assert.equal(fpFind(preceding.replayCanvasData, source)?.word, 'pokazała');
    assert.notEqual(fpFind(preceding.replayCanvasData, source)?.silent, true,
      'the source stays pronounced before movement');
    assert.equal(fpFind(preceding.replayCanvasData, target)?.label, oldLabel);
    assert.equal(fpFind(preceding.replayCanvasData, target)?.word || '', '',
      'the pre-existing head does not show the future landed word');
    const moment = steps[at];
    assert.equal(fpFind(moment.replayCanvasData, source)?.silent, true);
    assert.equal(fpFind(moment.replayCanvasData, target)?.label, newLabel);
    assert.equal(fpFind(moment.replayCanvasData, target)?.word, 'pokazała');
    assert.notEqual(fpFind(moment.replayCanvasData, target)?.silent, true);
    assert.ok(moment.replayRelationLinks.some(link => link.renderFamily === 'trajectory'
      && link.sourceNodeId === source && link.targetNodeId === target));
  }
  const plan = compileRelationRenderPlan(stages);
  const finalPaths = plan.frames.at(-1).items.filter(item => item.kind === 'trajectory');
  assert.ok(finalPaths.some(item => item.sourceNodeId === 'vLow' && item.targetNodeId === 'vHigh'));
  assert.ok(finalPaths.some(item => item.sourceNodeId === 'vHigh' && item.targetNodeId === 'iHead'));
  assert.deepEqual(stages, original);
});
