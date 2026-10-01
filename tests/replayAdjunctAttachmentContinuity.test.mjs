import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';

const saved = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/adjunct-attachment-continuity.json', import.meta.url)));
const node = (id, label, children = [], extra = {}) => ({ id, label, children, ...extra });
const stage = (workspaceForest, relations = []) => ({
  statement: 'Extend the clause with an adjunct.',
  stageRecord: 'The existing predicate is retained while the adjunct is built and externally merged.',
  relations, workspaceForest
});
const reduced = () => {
  const subject = node('subject', 'NP', [], { word: 'Felix' });
  const predicate = node('predicate', "I'", [node('tense', 'I', [], { word: 'did' }), node('verbPhrase', 'VP')]);
  const adjunct = node('adjunct', 'AdvP', [node('adverb', 'Adv', [], { word: 'too' })]);
  return { sentence: 'Felix did too', derivationStages: [
    stage([node('clause', 'IP', [subject, predicate])]),
    stage([node('clause', 'IP', [subject, node('outerPredicate', "I'", [predicate, adjunct])])])
  ] };
};
const find = (root, id) => root.id === id ? root : root.children?.map(child => find(child, id)).find(Boolean);
const children = (step, id) => (find(step.replayCanvasData, id)?.children ?? []).map(child => child.id);
const visibleEdges = step => {
  const visible = new Set(step.replayVisibleNodeIds), edges = [];
  const visit = current => {
    for (const child of current.children ?? []) {
      if (visible.has(current.id) && visible.has(child.id)) edges.push(`${current.id}->${child.id}`);
      visit(child);
    }
  };
  visit(step.replayCanvasData);
  return edges;
};

for (const [name, make, stageIndex, parent, oldChild, wrapper, adjunct] of [
  ['reduced wrapper-only attachment', reduced, 1, 'clause', 'predicate', 'outerPredicate', 'adjunct'],
  ['review #8 ellipsis', () => structuredClone(saved), 4, 'ipB', 'ibarB', 'ibarBOuter', 'advpToo']
]) test(`${name}: existing branches remain until the new wrapper's single merge`, () => {
  const record = make(), original = structuredClone(record);
  const { playbackSteps } = prepareReplay({ ...record, includePlayback: true });
  const steps = playbackSteps.filter(step => step.replayFrameIndex === stageIndex);
  const mergeIndex = steps.findIndex(step => step.replayKind === 'micro' && step.targetNodeId === wrapper);
  assert(mergeIndex > 0);
  const priorStage = playbackSteps.findLast(step => step.replayFrameIndex === stageIndex - 1);
  const priorEdges = visibleEdges(priorStage);
  for (const step of steps.slice(0, mergeIndex)) {
    assert(children(step, parent).includes(oldChild), `${step.targetNodeId}: the prior predicate remains attached`);
    assert(!step.replayVisibleNodeIds.includes(wrapper), 'the future wrapper remains hidden');
    const edges = visibleEdges(step);
    for (const edge of priorEdges) assert(edges.includes(edge), `existing branch ${edge} was removed before merge`);
  }
  const merge = steps[mergeIndex];
  assert.equal(merge.operation, 'ExternalMerge');
  assert.deepEqual(merge.sourceNodeIds, [oldChild, adjunct]);
  assert(children(merge, parent).includes(wrapper));
  assert.deepEqual(children(merge, wrapper), [oldChild, adjunct]);
  assert.equal(steps.filter(step => step.replayKind === 'micro' && step.targetNodeId === wrapper).length, 1);
  assert(!steps.some(step => step.replayKind === 'micro' && step.targetNodeId === parent), 'the already-built IP is not rebuilt');
  assert.deepEqual(record, original, 'the saved authored analysis is unchanged');
  if (name === 'review #8 ellipsis') {
    assert.equal(playbackSteps.length, 62, 'no extra construction moment is introduced');
    assert.equal(playbackSteps.indexOf(merge) + 1, 56);
    assert.deepEqual(steps.slice(0, mergeIndex).map(step => playbackSteps.indexOf(step) + 1), [52, 53, 54, 55]);
  }
});

test('unrelated sibling replacement does not restore a removed branch', () => {
  const retained = node('retained', 'N', [], { word: 'word' });
  const gone = node('gone', 'Adj', [], { word: 'old' });
  const replacement = node('replacement', 'AP', [node('new', 'Adj', [], { word: 'new' })]);
  const record = { sentence: 'new word', derivationStages: [
    stage([node('parent', 'NP', [gone, retained])]),
    stage([node('parent', 'NP', [replacement, retained])])
  ] };
  const { playbackSteps } = prepareReplay({ ...record, includePlayback: true });
  for (const step of playbackSteps.filter(step => step.replayFrameIndex === 1)) {
    assert(!find(step.replayCanvasData, 'gone'), 'continuity must not revive material removed from the authored stage');
  }
});

for (const numberOfChildren of [1, 2]) test(`nested wrappers preserve ${numberOfChildren} earlier child attachments as each parent is built`, () => {
  const oldChildren = Array.from({ length: numberOfChildren }, (_, index) => node(`child${index}`, 'XP'));
  const untouched = node('untouched', 'XP');
  const inner = node('inner', 'XP', [...oldChildren, node('innerAdjunct', 'Adv')]);
  const outer = node('outer', 'XP', [inner, node('outerAdjunct', 'Adv')]);
  const record = { sentence: '', derivationStages: [
    stage([node('context', 'XP', [untouched, ...oldChildren])]),
    stage([node('context', 'XP', [untouched, outer])])
  ] };
  const steps = prepareReplay({ ...record, includePlayback: true }).playbackSteps.filter(step => step.replayFrameIndex === 1);
  const innerIndex = steps.findIndex(step => step.targetNodeId === 'inner');
  const outerIndex = steps.findIndex(step => step.targetNodeId === 'outer');
  assert(innerIndex > 0 && outerIndex > innerIndex);
  for (const step of steps.slice(0, innerIndex)) assert.deepEqual(children(step, 'context'), ['untouched', ...oldChildren.map(child => child.id)]);
  for (const step of steps.slice(innerIndex, outerIndex)) {
    assert.deepEqual(children(step, 'context'), ['untouched', 'inner']);
    assert.deepEqual(children(step, 'inner'), [...oldChildren.map(child => child.id), 'innerAdjunct']);
    assert(!step.replayVisibleNodeIds.includes('outer'));
  }
  assert.deepEqual(children(steps[outerIndex], 'context'), ['untouched', 'outer']);
  assert.deepEqual(children(steps[outerIndex], 'outer'), ['inner', 'outerAdjunct']);
  for (const step of steps) {
    const allIds = [];
    const visit = current => { allIds.push(current.id); current.children?.forEach(visit); };
    visit(step.replayCanvasData);
    assert.equal(new Set(allIds).size, allIds.length, 'the same occurrence must not be duplicated under old and new parents');
  }
});
