import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';

const node = (id, label, children) => ({ id, label, children });
const leaf = (id, label, word, extra = {}) => ({ id, label, ...(word ? { word } : {}), ...extra });
const stage = (workspaceForest, relations = []) => ({
  statement: 'Completed state', stageRecord: 'Authored state', workspaceForest, relations
});
const find = (root, id) => root?.id === id ? root : root?.children?.map(child => find(child, id)).find(Boolean);

function record() {
  const nominalBar = node('nominalBar', 'N′', [leaf('noun', 'N', 'student')]);
  const nominal = node('nominal', 'NP', [nominalBar]);
  const matrixVerb = leaf('matrixVerb', 'V', 'arrived', { lineageId: 'matrix' });
  const relativeVerb = leaf('relativeVerb', 'V', 'spoke', { lineageId: 'relative' });
  const subject = leaf('subject', 'NP', undefined, { silent: true });
  const matrixPhrase = node('matrixPhrase', 'VP', [nominal, node('matrixBar', 'V′', [matrixVerb])]);
  const relativePhrase = node('relativePhrase', 'VP', [subject, node('relativeBar', 'V′', [relativeVerb])]);
  const inflection = (name, verb) => node(`${name}Inflection`, 'I', [verb,
    leaf(`${name}Finite`, 'I', undefined, { silent: true })]);
  const trace = name => leaf(`${name}Trace`, 'V', undefined, { lineageId: name, silent: true });
  const relativeClause = node('relativeClause', 'CP', [leaf('operator', 'NP', undefined, { silent: true }),
    node('complementizerBar', 'C′', [leaf('complementizer', 'C', 'that'), node('relativeIP', 'IP', [
      node('relativeIbar', 'I′', [inflection('relative', relativeVerb), node('relativePhrase', 'VP', [
        subject, node('relativeBar', 'V′', [trace('relative')])])])])])]);
  const adjunctWrapper = node('adjunctWrapper', 'N′', [nominalBar, relativeClause]);
  const completed = node('matrixIP', 'IP', [node('matrixIbar', 'I′', [inflection('matrix', matrixVerb),
    node('matrixPhrase', 'VP', [node('nominal', 'NP', [adjunctWrapper]), node('matrixBar', 'V′', [trace('matrix')])])])]);
  const movement = name => ({ relation: 'V-to-I head movement',
    anchors: { landingHead: `${name}Inflection`, raisedHead: `${name}Verb`, trace: `${name}Trace` },
    priorAnchors: { source: `${name}Verb` } });
  return { sentence: 'student arrived that spoke', derivationStages: [stage([matrixPhrase, relativePhrase]),
    stage([completed], [movement('matrix'), movement('relative')])], includePlayback: true };
}

test('a selection pulled forward for a relation preserves current edges until the later wrapper merge', () => {
  const input = record(), original = structuredClone(input);
  const steps = prepareReplay(input).playbackSteps;
  const selected = steps.findIndex(step => step.operation === 'LexicalSelect' && step.targetNodeId === 'matrixFinite');
  const firstRelation = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1);
  const merge = steps.findIndex(step => step.operation === 'ExternalMerge' && step.targetNodeId === 'adjunctWrapper');
  assert(selected >= 0 && selected < firstRelation && firstRelation < merge, 'the prerequisite precedes its relation and the independent merge');
  for (const step of steps.slice(selected, merge)) {
    assert.deepEqual(find(step.replayCanvasData, 'nominal')?.children?.map(child => child.id), ['nominalBar']);
    assert(!step.replayVisibleNodeIds.includes('adjunctWrapper'), 'a future wrapper remains hidden and detached');
  }
  for (const step of steps.slice(merge)) {
    assert.deepEqual(find(step.replayCanvasData, 'nominal')?.children?.map(child => child.id), ['adjunctWrapper']);
    assert.deepEqual(find(step.replayCanvasData, 'adjunctWrapper')?.children?.map(child => child.id), ['nominalBar', 'relativeClause']);
    assert(step.replayVisibleNodeIds.includes('adjunctWrapper'), 'the real merge establishes its authored edges');
  }
  assert.deepEqual(steps.filter(step => step.replayKind === 'relation').map(step => step.replayRelationIdentity), [
    { stageIndex: 1, relationIndex: 0 }, { stageIndex: 1, relationIndex: 1 }
  ]);
  assert(!steps[selected].replayVisibleNodeIds.includes('matrixTrace'), 'selecting the prerequisite cannot perform the movement');
  assert(steps[firstRelation].replayVisibleNodeIds.includes('matrixTrace'), 'the owning relation still introduces the trace');
  assert.deepEqual(input, original, 'compilation leaves authored states unchanged');
});

test('a relation prerequisite cannot detach a wrapper that was already built in the preceding stage', () => {
  const input = record();
  const nominal = find(input.derivationStages[0].workspaceForest[0], 'nominal');
  nominal.children = [node('existingWrapper', 'N′', nominal.children)];
  const completedWrapper = find(input.derivationStages[1].workspaceForest[0], 'adjunctWrapper');
  completedWrapper.children[0] = node('existingWrapper', 'N′', [completedWrapper.children[0]]);
  const steps = prepareReplay(input).playbackSteps;
  const selected = steps.find(step => step.operation === 'LexicalSelect' && step.targetNodeId === 'matrixFinite');
  assert(selected);
  assert(selected.replayVisibleNodeIds.includes('existingWrapper'));
  assert.deepEqual(find(selected.replayCanvasData, 'nominal')?.children?.map(child => child.id), ['existingWrapper']);
  assert.deepEqual(find(selected.replayCanvasData, 'existingWrapper')?.children?.map(child => child.id), ['nominalBar']);
});
