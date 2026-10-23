import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPreFrontingSentenceInitialCasing } from '../replay/replayCasing.ts';

const word = (id, surface) => ({ id, label: surface, word: surface });
const subject = (surface = 'The', id = 'subject') => ({
  id, label: 'DP', children: [
    { id: `${id}-det`, label: 'D', children: [word(`${id}-word`, surface)] },
    { id: `${id}-noun`, label: 'NP', children: [word(`${id}-sailors`, 'sailors')] }
  ]
});
const find = (root, id) => root.id === id
  ? root
  : root.children?.map(child => find(child, id)).find(Boolean);
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const step = (operation, visibleIds, canvas, extra = {}) => ({
  operation, replayKind: 'micro', replayCanvasData: canvas,
  replayVisibleNodeIds: visibleIds, ...extra
});

// A word is sentence-initial where it stands in the stage's current structure, shown yet or not: the subject
// in its base position after seem is lowercase from its first frame, and does not change case when seem appears.
test('current words not yet shown still precede a later word, so its case does not change when they appear', () => {
  const canvas = { id: 'root', label: 'VP', children: [
    { id: 'verb', label: 'V', children: [word('seem', 'seem')] }, subject()
  ] };
  const before = step('Project', ['subject-word', 'subject-sailors'], canvas);
  const selected = step('LexicalSelect', ['seem', 'subject-word', 'subject-sailors'], canvas);
  const relation = { ...selected, operation: 'finite tense licensing', replayKind: 'relation' };
  const input = freeze([before, selected, relation]);
  const output = applyPreFrontingSentenceInitialCasing(input, 'The sailors seem');
  assert.deepEqual(output.map(item => find(item.replayCanvasData, 'subject-word').word),
    ['the', 'the', 'the']);
  assert.equal(find(canvas, 'subject-word').word, 'The', 'the authored word is unchanged');
  output.forEach((item, index) => {
    assert.deepEqual(item.replayVisibleNodeIds, input[index].replayVisibleNodeIds);
    assert.equal(item.operation, input[index].operation);
    assert.equal(item.replayKind, input[index].replayKind);
  });
});

test('layout-only words cannot make a later current word noninitial', () => {
  for (const flag of [{ replayLayoutOnly: true }, { replayOrigin: { kind: 'layout' } }]) {
    const canvas = { id: 'root', label: 'TP', children: [
      { id: 'future', label: 'V', children: [{ ...word('future-word', 'seem'), ...flag }] },
      subject()
    ] };
    const [result] = applyPreFrontingSentenceInitialCasing([
      step('Project', ['future-word', 'subject-word', 'subject-sailors'], canvas)
    ], 'The sailors seem');
    assert.equal(find(result.replayCanvasData, 'subject-word').word, 'The');
  }
});

test('current visible words beneath invisible future wrappers retain their current casing', () => {
  const canvas = { id: 'future-wrapper', label: 'TP', replayLayoutOnly: true,
    replayOrigin: { kind: 'layout' }, children: [
      { id: 'verb', label: 'V', children: [word('seem', 'seem')] }, subject()
    ] };
  const [result] = applyPreFrontingSentenceInitialCasing([
    step('LexicalSelect', ['seem', 'subject-word', 'subject-sailors'], canvas)
  ], 'The sailors seem');
  assert.equal(find(result.replayCanvasData, 'subject-word').word, 'the');
  assert.equal(result.replayCanvasData.replayLayoutOnly, true);
});

test('movement recases the complete landing only at its owning relation moment', () => {
  const lower = subject('The', 'base');
  const before = { id: 'vp', label: 'VP', children: [
    { id: 'v', label: 'V', children: [word('seem', 'seem')] }, lower
  ] };
  const after = { id: 'tp', label: 'TP', children: [
    subject('The', 'landing'),
    { ...before, children: [before.children[0], { ...lower, silent: true }] }
  ] };
  const input = freeze([
    step('finite tense licensing', ['seem', 'base-word', 'base-sailors'], before,
      { replayKind: 'relation' }),
    step('A-movement', ['seem', 'base-word', 'base-sailors', 'landing-word', 'landing-sailors'], after,
      { replayKind: 'relation', replayRelationIdentity: { stageIndex: 1, relationIndex: 0 } })
  ]);
  const output = applyPreFrontingSentenceInitialCasing(input, 'The sailors seem');
  assert.equal(find(output[0].replayCanvasData, 'base-word').word, 'the');
  assert.equal(find(output[1].replayCanvasData, 'base-word').word, 'the');
  assert.equal(find(output[1].replayCanvasData, 'landing-word').word, 'The');
  assert.equal(find(output[1].replayCanvasData, 'base').silent, true);
  assert.deepEqual(output[1].replayRelationIdentity, input[1].replayRelationIdentity);
  assert.equal(find(before, 'base-word').word, 'The');
});

test('a detached lowercase authored occurrence keeps its form before attachment', () => {
  const canvas = { id: 'workspace', label: 'Workspace', replayOrigin: { kind: 'workspace' },
    children: [subject('the'), { id: 'v', label: 'V', children: [word('seem', 'seem')] }] };
  const input = freeze([step('LexicalSelect', ['subject-word'], canvas,
    { targetNodeId: 'subject-word', targetLabel: 'the', sourceLabels: ['the'] })]);
  const [result] = applyPreFrontingSentenceInitialCasing(input, 'The sailors seem');
  assert.equal(find(result.replayCanvasData, 'subject-word').word, 'the');
  assert.equal(result.targetLabel, 'the');
  assert.deepEqual(result.sourceLabels, ['the']);
});

test('a lowercase authored source stays lowercase when it is selected before its governor', () => {
  const lower = subject('the');
  lower.children[0].word = 'the';
  lower.children[0].children[0].replayOrigin = { kind: 'word', ownerId: 'subject-det' };
  const canvas = { id: 'vp', label: 'VP', children: [
    { id: 'v', label: 'V', children: [word('seem', 'seem')] }, lower
  ] };
  const [result] = applyPreFrontingSentenceInitialCasing([
    step('LexicalSelect', ['subject-word'], canvas,
      { targetNodeId: 'subject-word', targetLabel: 'the', sourceLabels: ['the'] })
  ], 'The sailors seem');
  assert.equal(find(result.replayCanvasData, 'subject-word').word, 'the');
  assert.equal(result.targetLabel, 'the');
});

// Labels follow the tree's casing; the not-yet-shown verb precedes the subject in the stage structure.
test('lexical selection labels use the same current casing as the tree', () => {
  const canvas = { id: 'root', label: 'VP', children: [
    { id: 'future', label: 'V', children: [word('future-word', 'seem')] }, subject('the')
  ] };
  const [result] = applyPreFrontingSentenceInitialCasing([
    step('LexicalSelect', ['subject-word'], canvas,
      { targetNodeId: 'subject-word', targetLabel: 'the', sourceLabels: ['the'] })
  ], 'The sailors seem');
  assert.equal(find(result.replayCanvasData, 'subject-word').word, 'the');
  assert.equal(result.targetLabel, 'the');
  assert.deepEqual(result.sourceLabels, ['the']);
});

test('a sentence-initial word preceded by pronounced material in a separate workspace is lowercased', () => {
  const whPhrase = { id: 'dp-wh', label: 'D[wh]', children: [
    { id: 'd-wh', label: 'D[wh]', children: [word('which', 'Which')] },
    { id: 'n', label: 'N', children: [word('violin', 'violin')] }
  ] };
  const verb = { id: 'v', label: 'V', children: [word('bring', 'bring')] };
  const pro = { id: 'pro', label: 'D[PRO]', children: [{ id: 'pro-word', label: 'PRO', word: 'PRO', silent: true }] };
  const workspace = (...children) => ({ id: 'workspace', label: 'Workspace', replayOrigin: { kind: 'workspace' }, children });
  const visible = ['pro', 'pro-word', 'v', 'bring', 'vbar', 'dp-wh', 'd-wh', 'which', 'n', 'violin'];
  const sentence = 'Which violin did Nora say that the musician had forgotten to bring?';
  const [after] = applyPreFrontingSentenceInitialCasing(freeze([step('ExternalMerge', visible,
    workspace(pro, { id: 'vbar', label: 'V', children: [verb, whPhrase] }))]), sentence);
  assert.equal(find(after.replayCanvasData, 'which').word, 'which', 'bring precedes it, so it is not sentence-initial');
  const [first] = applyPreFrontingSentenceInitialCasing(freeze([step('ExternalMerge', visible,
    workspace(pro, whPhrase, verb))]), sentence);
  assert.equal(find(first.replayCanvasData, 'which').word, 'Which', 'as the first pronounced word it keeps its authored form');
});
