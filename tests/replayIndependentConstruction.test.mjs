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
