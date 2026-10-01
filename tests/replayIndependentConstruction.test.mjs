import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';

const node = (id, children) => ({ id, label: 'XP', children });
const leaf = (id, word, extra = {}) => ({ id, label: 'X', word, ...extra });
const stage = (workspaceForest, relations = []) => ({ statement: 'Authored state', stageRecord: 'Authored account', workspaceForest, relations });
const find = (root, id) => root?.id === id ? root : root?.children?.map(child => find(child, id)).find(Boolean);
const replay = derivationStages => prepareReplay({ derivationStages, sentence: 'one two after', includePlayback: true }).playbackSteps;

test('an anchored rewrite preserves independent selection and projection before their relations', () => {
  const before = node('base', [leaf('changed', 'before')]);
  const after = node('base', [leaf('changed', 'after')]);
  const independent = node('pair', [leaf('first', 'one'), leaf('second', 'two')]);
  const stages = [stage([before]), stage([after, independent], [
    { relation: 'Independent claim', anchors: { participants: ['first', 'second'], projection: 'pair' } },
    { relation: 'Authored replacement', anchors: { output: 'changed' }, priorAnchors: { input: 'changed' } }
  ])];
  const steps = replay(stages);
  const claimIndex = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1 && step.replayRelationIdentity.relationIndex === 0);
  const rewriteIndex = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1 && step.replayRelationIdentity.relationIndex === 1);
  assert.ok(claimIndex > 0);
  for (const id of ['first', 'second', 'pair']) {
    assert.ok(steps[claimIndex].replayVisibleNodeIds.includes(id), `${id} must exist at its independent relation`);
    assert.ok(steps.slice(0, claimIndex).some(step => step.replayKind === 'micro' && step.targetNodeId === id), `${id} must receive ordinary construction`);
  }
  const selections = steps.slice(0, claimIndex).filter(step => step.replayKind === 'micro' && step.operation === 'LexicalSelect');
  assert.ok(selections.some(step => step.targetNodeId.startsWith('first')));
  assert.ok(selections.some(step => step.targetNodeId.startsWith('second')));
  for (const step of steps.slice(0, rewriteIndex).filter(step => step.replayFrameIndex === 1)) {
    assert.equal(find(step.replayCanvasData, 'changed')?.word, 'before', 'independent construction must not apply the rewrite');
  }
  assert.equal(find(steps[rewriteIndex].replayCanvasData, 'changed')?.word, 'after');
});

test('independent construction can wrap existing syntax without undoing its relation-owned replacement', () => {
  const before = node('base', [leaf('before', 'before')]);
  const after = node('base', [leaf('after', 'after')]);
  const stages = [stage([before]), stage([node('clause', [leaf('aux', 'one'), after])], [
    { relation: 'Independent claim', anchors: { auxiliary: 'aux', clause: 'clause' } },
    { relation: 'Authored replacement', anchors: { output: 'after' }, priorAnchors: { input: 'before' } }
  ])];
  const steps = replay(stages);
  const claim = steps.find(step => step.replayRelationIdentity?.stageIndex === 1 && step.replayRelationIdentity.relationIndex === 0);
  const replacement = steps.find(step => step.replayRelationIdentity?.stageIndex === 1 && step.replayRelationIdentity.relationIndex === 1);
  assert.ok(claim.replayVisibleNodeIds.includes('aux'));
  assert.ok(claim.replayVisibleNodeIds.includes('clause'));
  assert.ok(find(claim.replayCanvasData, 'before'));
  assert.equal(find(claim.replayCanvasData, 'after'), undefined);
  assert.ok(find(replacement.replayCanvasData, 'after'));
  assert.equal(find(replacement.replayCanvasData, 'before'), undefined);
});

test('movement owns its new lower occurrence before a later contextual restatement', () => {
  const operator = { id: 'operator', label: 'NP', silent: true, lineageId: 'chain' };
  const verb = leaf('verb', 'read');
  const base = node('vp', [operator, verb]);
  const trace = { ...operator, id: 'trace' };
  const stages = [stage([base]), stage([node('cp', [operator, { ...base, children: [trace, verb] }])], [
    { relation: 'A-movement', anchors: { movedOperator: 'operator', trace: 'trace' }, priorAnchors: { sourceOccurrence: 'operator' } },
    { relation: 'Thematic preservation', anchors: { chainHead: 'operator', thematicPosition: 'trace', predicate: 'verb' }, priorAnchors: { originalArgument: 'operator' } }
  ])];
  const steps = replay(stages);
  const movement = steps.find(step => step.replayRelationIdentity?.stageIndex === 1 && step.replayRelationIdentity.relationIndex === 0);
  assert.ok(movement.replayVisibleNodeIds.includes('trace'));
  assert.ok(movement.replayVisibleNodeIds.includes('operator'));
  assert.equal(movement.movementDiagnostics?.some(message => message.includes('RELATION_TIMING_CONFLICT')) ?? false, false);
});

test('a contextual claim cannot introduce a future movement occurrence early', () => {
  const source = leaf('source', 'one', { label: 'NP', lineageId: 'chain' });
  const verb = leaf('verb', 'read');
  const base = node('vp', [source, verb]);
  const lower = { ...source, id: 'trace', silent: true };
  const landing = { ...source, id: 'landing' };
  const stages = [stage([base]), stage([node('cp', [landing, { ...base, children: [lower, verb] }])], [
    { relation: 'Contextual observation', anchors: { participant: 'landing' }, priorAnchors: { participant: 'source' } },
    { relation: 'A-movement', anchors: { raisedOccurrence: 'landing', lowerOccurrence: 'trace' }, priorAnchors: { sourceOccurrence: 'source' } }
  ])];
  const steps = replay(stages);
  const context = steps.find(step => step.replayRelationIdentity?.stageIndex === 1 && step.replayRelationIdentity.relationIndex === 0);
  const movement = steps.find(step => step.replayRelationIdentity?.stageIndex === 1 && step.replayRelationIdentity.relationIndex === 1);
  assert.ok(!context.replayVisibleNodeIds.includes('landing'));
  assert.ok(!context.replayVisibleNodeIds.includes('trace'));
  assert.ok(context.replayVisibleNodeIds.includes('source'));
  assert.ok(context.movementDiagnostics?.some(message => message.includes('RELATION_TIMING_CONFLICT')));
  assert.ok(movement.replayVisibleNodeIds.includes('landing'));
  assert.ok(movement.replayVisibleNodeIds.includes('trace'));
});

test('a retained transition witness does not withhold its newly constructed licensing context', () => {
  const first = node('firstClause', [leaf('firstPredicate', 'one'), leaf('deletedObject', 'two')]);
  const second = node('secondClause', [leaf('secondPredicate', 'after'), leaf('overtObject', 'two')]);
  const deleted = structuredClone(first);
  deleted.children[1].silent = true;
  const current = node('coordination', [deleted, node('tail', [leaf('conjunction', 'and'), second])]);
  const stages = [stage([first, second]), stage([current], [
    { relation: 'Parallel right-edge contexts', anchors: { coordination: 'coordination', first: 'deletedObject', second: 'overtObject' } },
    { relation: 'Backward suppression', anchors: { deletedDomain: 'deletedObject', licensingCoordination: 'coordination', identitySource: 'overtObject' }, priorAnchors: { domain: 'deletedObject' } }
  ])];
  const steps = replay(stages);
  const context = steps.find(step => step.operation === 'Parallel right-edge contexts');
  const deletion = steps.find(step => step.operation === 'Backward suppression');
  for (const id of ['coordination', 'tail', 'conjunction']) {
    assert.ok(context.replayVisibleNodeIds.includes(id), id);
    assert.ok(steps.some(step => step.replayFrameIndex === 1 && step.replayKind === 'micro' && step.targetNodeId === id), id);
  }
  assert.equal(find(context.replayCanvasData, 'deletedObject').silent, undefined);
  assert.equal(find(deletion.replayCanvasData, 'deletedObject').silent, true);
  assert.ok(!steps.some(step => step.movementDiagnostics?.some(message => message.includes('TIMING_CONFLICT'))));
});

test('joint realization does not take ownership of independently selected functional heads', () => {
  const source = node('predicate', [leaf('subject', 'one'), leaf('verb', 'two')]);
  const current = node('finiteClause', [node('negativePhrase', [source, leaf('negation', '-not')]), leaf('tense', '-past')]);
  const stages = [stage([source]), stage([current], [
    { relation: 'Finite agreement', anchors: { probe: 'tense', goal: 'subject' }, values: { number: 'singular' } },
    { relation: 'Joint realization', anchors: { verb: 'verb', negation: 'negation', tense: 'tense' }, priorAnchors: { uninflectedVerb: 'verb' }, values: { surface: 'after' } }
  ])];
  const steps = replay(stages);
  const agreement = steps.find(step => step.operation === 'Finite agreement');
  for (const id of ['tense', 'negation']) assert.ok(agreement.replayVisibleNodeIds.includes(id), id);
  assert.ok(!steps.some(step => step.movementDiagnostics?.some(message => message.includes('TIMING_CONFLICT'))));
});

test('a fully recovered agreement claim does not become a neutral merge from its prior witnesses', () => {
  const subject = leaf('subject', 'one', { label: 'DP' });
  const tense = { id: 'tense', label: 'T', silent: true, children: [] };
  const current = node('clause', [tense, { ...subject, label: 'DP[Case:NOM]' }]);
  const stages = [stage([subject, tense]), stage([current], [
    { relation: 'T-subject Agree and nominative valuation', anchors: { goal: 'subject', probe: 'tense' },
      priorAnchors: { goalBeforeValuation: 'subject', probeBeforeValuation: 'tense' }, values: { agreement: '3SG', case: 'NOM' } }
  ])];
  const steps = replay(stages);
  const agreement = steps.findIndex(step => step.operation === 'T-subject Agree and nominative valuation');
  const merge = steps.findIndex(step => step.replayKind === 'micro' && step.targetNodeId === 'clause');
  assert.ok(merge >= 0 && merge < agreement);
});

test('a new word on a retained head appears at its realization without an empty selection frame', () => {
  const source = leaf('stem', 'two', { label: 'V', lineageId: 'verb' });
  const inflection = { id: 'inflection', label: 'I', children: [] };
  const prior = node('clause', [source, inflection]);
  const current = node('clause', [
    { ...source, id: 'trace', word: undefined, silent: true },
    { id: 'complex', label: 'I', children: [{ ...source, id: 'raised' }, { ...inflection, word: '-ed' }] }
  ]);
  const stages = [stage([prior]), stage([current], [
    { relation: 'V-to-I head movement', anchors: { raisedHead: 'raised', sourceTrace: 'trace', landingHead: 'complex', host: 'inflection' }, priorAnchors: { sourceHead: 'stem', targetHead: 'inflection' } },
    { relation: 'Finite morphological realization', anchors: { inflection: 'inflection', stem: 'raised', complexHead: 'complex' }, priorAnchors: { inflection: 'inflection', stem: 'stem' }, values: { surfaceWord: 'after' } }
  ])];
  const steps = replay(stages);
  const movement = steps.find(step => step.operation === 'V-to-I head movement');
  const realization = steps.find(step => step.operation === 'Finite morphological realization');
  assert.ok(!movement.replayVisibleNodeIds.includes('inflection::__leaf'));
  assert.ok(realization.replayVisibleNodeIds.includes('inflection::__leaf'));
  assert.ok(!steps.some(step => step.replayKind === 'micro' && step.targetNodeId === 'inflection::__leaf'));
});

test('a fully recovered realization owns its word even without a neutral residual anchor', () => {
  const abstractHead = { id: 'raised', label: 'I', silent: true, children: [] };
  const stages = [stage([abstractHead]), stage([{ ...abstractHead, word: 'did', silent: false }], [
    { relation: 'do-support', anchors: { supportedHead: 'raised' }, priorAnchors: { abstractHead: 'raised' },
      values: { tense: 'past', exponent: 'did' } }
  ])];
  const steps = replay(stages);
  const realization = steps.find(step => step.operation === 'do-support');
  assert.ok(realization.replayVisibleNodeIds.includes('raised::__leaf'));
  assert.ok(!steps.some(step => step.replayKind === 'micro' && step.targetNodeId === 'raised::__leaf'));
});
