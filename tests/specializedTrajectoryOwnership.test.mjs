import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { adaptDerivationStagesForReplay, getFrameRelations } from '../replay/replayCompiler.ts';
import { currentWorkspaceMovements } from '../replay/currentWorkspaceMovements.ts';

const leaf = (id, label, word, extra = {}) => ({ id, label, word, ...extra });
const node = (id, label, children, extra = {}) => ({ id, label, children, ...extra });
const clone = value => structuredClone(value);
const stage = (workspaceForest, relations = []) => ({
  statement: 'Current syntax', stageRecord: 'Current authored structure', workspaceForest, relations
});
const find = (root, id) => root.id === id || root.aliasIds?.includes(id)
  ? root : (root.children ?? []).map(child => find(child, id)).find(Boolean);

// The complete phrase keeps its ID at the landing; a new lower occurrence
// replaces its exact preceding slot. Its retained descendants move with it.
function phraseRecord(relation) {
  const phrase = node('phrase', 'DP', [
    leaf('determiner', 'D', 'which'), node('nominal', "N'", [leaf('noun', 'N', 'book')])
  ], { lineageId: 'phrase-chain' });
  const parasite = node('parasite', 'DP', [leaf('parasiteWord', 'D', 'pg', { silent: true })]);
  const clause = source => node('cbar', "C'", [leaf('c', 'C', 'did'),
    node('vp', 'VP', [leaf('v', 'V', 'read'), source])]);
  const lower = node('lower', 'DP', [leaf('trace', 'D', 't', { silent: true })],
    { lineageId: 'phrase-chain', silent: true });
  const anchors = relation === 'ParasiticGap'
    ? { filler: 'phrase', realGap: 'lower', traceWitness: 'trace', parasiticGap: 'parasite' }
    : { lowerCopy: 'lower', traceWitness: 'trace', pronouncedCopy: 'phrase' };
  return {
    sentence: 'which book did read', includePlayback: true,
    derivationStages: [stage([clause(clone(phrase)), clone(parasite)]),
      stage([node('cp', 'CP', [phrase, clause(lower)]), parasite], [{ relation, anchors }])]
  };
}

function headRecord(relation) {
  const verb = leaf('verb', 'V', 'laugh');
  const clause = (inflection, predicate) => node('tbar', "T'", [inflection, node('vp', 'VP', [predicate])]);
  return {
    sentence: 'laugh ed', includePlayback: true,
    derivationStages: [stage([clause(leaf('inflection', 'T', 'ed', { lineageId: 'tense' }), clone(verb))]),
      stage([clause(leaf('lowerHead', 'T', 't', { lineageId: 'tense', silent: true }),
        node('complex', 'V', [verb, leaf('lowered', 'T', 'ed', { lineageId: 'tense' })]))],
      [{ relation, anchors: { source: 'lowerHead', target: 'lowered' }, priorAnchors: { source: 'inflection' } }])]
  };
}

function relationSteps(record) {
  const frames = adaptDerivationStagesForReplay(record.derivationStages);
  return getFrameRelations(frames[1], undefined, frames[0].workspaceForest);
}

function movementMoment(prepared) {
  const index = prepared.playbackSteps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1
    && step.replayRelationIdentity.relationIndex === 0);
  assert.ok(index > 0);
  const step = prepared.playbackSteps[index], before = prepared.playbackSteps[index - 1];
  const links = currentWorkspaceMovements(step, new Set(before.replayVisibleNodeIds), new Set(step.replayVisibleNodeIds));
  assert.equal(links.length, 1, 'the exact current transition owns its complete endpoints');
  return { step, before, link: links[0], index };
}

for (const [relation, drawingKind] of [
  ['AbarMove', 'phrasal'], ['RemnantMovement', 'remnant'],
  ['RollUpMovement', 'roll-up'], ['ParasiticGap', 'parasitic-gap']
]) test(`${relation} retains complete phrasal ownership and its specialized drawing`, () => {
  const record = phraseRecord(relation), original = clone(record);
  const [resolved] = relationSteps(record);
  assert.deepEqual({
    prior: resolved.recoveredMovement?.priorSourceNodeId,
    source: resolved.recoveredMovement?.sourceNodeId,
    target: resolved.recoveredMovement?.targetNodeId,
    witness: resolved.recoveredMovement?.witnessNodeId,
    kind: resolved.recoveredMovement?.trajectoryKind,
    transition: resolved.recoveredMovement?.transition,
    draw: resolved.recoveredMovement?.drawTrajectory
  }, { prior: 'phrase', source: 'lower', target: 'phrase', witness: 'trace',
    kind: 'phrasal', transition: true, draw: true });

  const prepared = prepareReplay(record), { step, before, link, index } = movementMoment(prepared);
  assert.equal(link.priorSourceNodeId, 'phrase');
  assert.equal(link.sourceNodeId, 'lower');
  assert.equal(link.targetNodeId, 'phrase');
  assert.equal(link.witnessNodeId, 'trace');
  assert.equal(link.movementTransition, true);
  assert.equal(link.renderFamily, 'trajectory');
  assert.equal(link.trajectoryKind, 'phrasal');
  assert.deepEqual(step.sourceNodeIds, ['lower']);
  assert.equal(step.targetNodeId, 'phrase');
  assert.deepEqual(find(before.replayCanvasData, 'vp').children.map(child => child.id), ['v', 'phrase']);
  assert.deepEqual(find(step.replayCanvasData, 'cp').children.map(child => child.id), ['phrase', 'cbar']);
  assert.deepEqual(find(step.replayCanvasData, 'phrase').children.map(child => child.id), ['determiner', 'nominal']);
  assert.deepEqual(find(step.replayCanvasData, 'vp').children.map(child => child.id), ['v', 'lower']);
  for (const prior of prepared.playbackSteps.slice(0, index)) {
    assert.ok(!prior.replayVisibleNodeIds.includes('cp'));
    assert.ok(!prior.replayVisibleNodeIds.includes('lower'));
  }
  for (const id of ['phrase', 'determiner', 'nominal', 'noun', 'lower', 'trace', 'cp']) {
    assert.ok(step.replayVisibleNodeIds.includes(id), id);
  }
  assert.equal(find(before.replayCanvasData, 'noun').word, 'book');
  assert.equal(find(step.replayCanvasData, 'trace').silent, true);
  const drawings = prepared.relationRenderPlan.frames[1].items.filter(item => item.kind === 'trajectory');
  assert.deepEqual(drawings.map(item => item.trajectoryKind), [drawingKind]);
  assert.equal(drawings[0].sourceNodeId, 'lower');
  assert.equal(drawings[0].targetNodeId, 'phrase');
  assert.deepEqual(record, original);
});

for (const [relation, drawingKind] of [['HeadMove', 'head'], ['Lowering', 'lowering']]) {
  test(`${relation} creates its receiving head and lower witness atomically`, () => {
    const record = headRecord(relation), original = clone(record);
    const prepared = prepareReplay(record), { step, before, link, index } = movementMoment(prepared);
    assert.equal(link.priorSourceNodeId, 'inflection');
    assert.equal(link.sourceNodeId, 'lowerHead');
    assert.equal(link.witnessNodeId, 'lowerHead');
    assert.equal(link.targetNodeId, 'lowered');
    assert.equal(link.movementTransition, true);
    assert.equal(link.trajectoryKind, 'head');
    assert.equal(find(before.replayCanvasData, 'inflection').word, 'ed');
    assert.deepEqual(find(before.replayCanvasData, 'vp').children.map(child => child.id), ['verb']);
    assert.deepEqual(find(step.replayCanvasData, 'complex').children.map(child => child.id), ['verb', 'lowered']);
    assert.ok(step.replayVisibleNodeIds.includes('lowerHead'));
    assert.ok(step.replayVisibleNodeIds.includes('lowered'));
    assert.ok(step.replayVisibleNodeIds.includes('complex'));
    assert.ok(!prepared.playbackSteps.slice(0, index).some(prior => prior.replayVisibleNodeIds.includes('complex')));
    assert.ok(!prepared.playbackSteps.some(prior => prior.replayKind === 'micro'
      && prior.targetNodeId === 'complex'), 'the movement owns the new host, not a separate Project');
    const drawings = prepared.relationRenderPlan.frames[1].items.filter(item => item.kind === 'trajectory');
    assert.deepEqual(drawings.map(item => item.trajectoryKind), [drawingKind]);
    assert.deepEqual(record, original);
  });
}

for (const relation of ['Lowering', 'HeadMove']) test(`${relation} cannot own a proved phrasal transition`, () => {
  const record = phraseRecord(relation), [step] = relationSteps(record);
  assert.equal(step.recoveredMovement?.trajectoryKind, 'phrasal');
  assert.equal(step.recoveredMovement?.transition, false);
  assert.equal(step.recoveredMovement?.drawTrajectory, false);
  assert.match(step.movementDiagnostics.join('\n'), /MOVEMENT_KIND_CONFLICT.*selects head.*recovered as phrasal/);
});

test('a phrasal specialized recipe cannot own a proved head transition', () => {
  const record = headRecord('RemnantMovement');
  record.derivationStages[1].relations[0].anchors.traceWitness = 'lowerHead';
  const [step] = relationSteps(record);
  assert.equal(step.recoveredMovement?.trajectoryKind, 'head');
  assert.equal(step.recoveredMovement?.transition, false);
  assert.equal(step.recoveredMovement?.drawTrajectory, false);
  assert.match(step.movementDiagnostics.join('\n'), /MOVEMENT_KIND_CONFLICT.*selects phrasal.*recovered as head/);
});

test('malformed specialized endpoint lists cannot earn movement ownership or a drawing', () => {
  const record = phraseRecord('RemnantMovement');
  record.derivationStages[1].relations[0].anchors.traceWitness = ['trace', 'trace'];
  const [step] = relationSteps(record);
  assert.equal(step.recoveredMovement, undefined);
  const prepared = prepareReplay(record);
  assert.ok(!prepared.playbackSteps.some(moment => moment.replayRelationLinks
    ?.some(link => link.authoredRelationKey === '1:0' && link.movementTransition === true)));
  assert.ok(!prepared.relationRenderPlan.frames[1].items.some(item => item.kind === 'trajectory'));
});

for (const [name, mutate] of [
  ['ambiguous endpoint', record => { record.derivationStages[1].relations[0].anchors.lowerCopy = ['lower', 'lower']; }],
  ['unproved lineage', record => { find(record.derivationStages[0].workspaceForest[0], 'phrase').lineageId = 'different'; }],
  ['wrong prior slot', record => { find(record.derivationStages[1].workspaceForest[0], 'vp').children.reverse(); }],
  ['missing witness', record => { record.derivationStages[1].relations[0].anchors.traceWitness = 'missing'; }]
]) test(`specialized classification refuses ${name}`, () => {
  const record = phraseRecord('RollUpMovement');
  mutate(record);
  assert.equal(relationSteps(record)[0].recoveredMovement, undefined);
});

test('gap-only ParasiticGap gains no movement proof', () => {
  const record = phraseRecord('ParasiticGap');
  record.derivationStages[1].relations[0].anchors = { parasiticGap: 'parasite' };
  assert.equal(relationSteps(record)[0].recoveredMovement, undefined);
});

test('restated specialized movement cannot acquire a second structural transition', () => {
  const record = phraseRecord('RemnantMovement');
  record.derivationStages[1].relations.push(clone(record.derivationStages[1].relations[0]));
  const steps = relationSteps(record);
  assert.equal(steps[0].recoveredMovement.transition, true);
  assert.equal(steps[1].recoveredMovement.transition, false);
  assert.equal(steps[1].recoveredMovement.drawTrajectory, true);
});

function successiveRecord(earlierShellClaim = false) {
  const record = phraseRecord('RollUpMovement');
  const initial = clone(record.derivationStages[0].workspaceForest[0]);
  find(initial, 'v').lineageId = 'verb-chain';
  const intermediate = clone(initial);
  Object.assign(find(intermediate, 'v'), { word: 't', silent: true });
  intermediate.children[0] = node('headComplex', 'C', [
    leaf('raisedVerb', 'V', 'read', { lineageId: 'verb-chain' }), intermediate.children[0]
  ]);
  const completed = clone(intermediate);
  const phrase = clone(find(completed, 'phrase'));
  const lower = clone(find(record.derivationStages[1].workspaceForest[0], 'lower'));
  find(completed, 'vp').children[1] = lower;
  record.derivationStages = [
    stage([node('top', 'DemP', [initial])], earlierShellClaim
      ? [{ relation: 'Authored shell context', anchors: { context: 'top' } }] : []),
    stage([node('top', 'DemP', [intermediate])],
      [{ relation: 'HeadMove', anchors: { source: 'v', target: 'raisedVerb' } }]),
    stage([node('top', 'DemP', [phrase, completed])], record.derivationStages[1].relations)
  ];
  return record;
}

test('specialized movement defers only the unused shell across earlier completed stages', () => {
  const record = successiveRecord(), original = clone(record);
  const prepared = prepareReplay(record), steps = prepared.playbackSteps;
  const outerIndex = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 2);
  const inner = steps.find(step => step.replayRelationIdentity?.stageIndex === 1);
  assert.ok(outerIndex > 0 && inner);
  assert.deepEqual(steps.filter(step => step.replayKind === 'relation').map(step => step.operation),
    ['HeadMove', 'RollUpMovement']);
  for (const step of steps.slice(0, outerIndex)) assert.ok(!step.replayVisibleNodeIds.includes('top'));
  assert.ok(!steps.some(step => step.replayKind === 'micro' && step.targetNodeId === 'top'));
  const earlierStages = steps.filter(step => step.replayKind === 'macro' && step.replayFrameIndex < 2);
  assert.equal(earlierStages.length, 2);
  for (const step of earlierStages) for (const id of ['cbar', 'c', 'vp', 'v', 'phrase', 'determiner', 'nominal', 'noun']) {
    assert.ok(step.replayVisibleNodeIds.includes(id), `${step.replayFrameIndex}: ${id}`);
  }
  assert.ok(inner.replayVisibleNodeIds.includes('headComplex'));
  assert.ok(inner.replayVisibleNodeIds.includes('raisedVerb'));
  assert.ok(inner.replayRelationLinks.some(link => link.authoredRelationKey === '1:0'
    && link.priorSourceNodeId === 'v' && link.targetNodeId === 'raisedVerb' && link.movementTransition === true));
  const outer = steps[outerIndex];
  assert.ok(outer.replayVisibleNodeIds.includes('top'));
  assert.deepEqual(find(outer.replayCanvasData, 'top').children.map(child => child.id), ['phrase', 'cbar']);
  assert.ok(outer.replayRelationLinks.some(link => link.authoredRelationKey === '2:0'
    && link.priorSourceNodeId === 'phrase' && link.sourceNodeId === 'lower' && link.movementTransition === true));
  assert.deepEqual(record, original);
});

test('an earlier authored shell claim prevents later specialized movement from withholding it', () => {
  const record = successiveRecord(true), prepared = prepareReplay(record);
  for (const step of prepared.playbackSteps.filter(step => step.replayKind === 'macro')) {
    assert.ok(step.replayVisibleNodeIds.includes('top'));
  }
  const claim = prepared.playbackSteps.find(step => step.replayRelationIdentity?.stageIndex === 0);
  assert.ok(claim.replayVisibleNodeIds.includes('top'));
});
