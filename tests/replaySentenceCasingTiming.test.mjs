import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPreFrontingSentenceInitialCasing } from '../replay/replayCompiler.ts';

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

test('future layout words do not recase the first visible word before their selection', () => {
  const canvas = { id: 'root', label: 'VP', children: [
    { id: 'verb', label: 'V', children: [word('seem', 'seem')] }, subject()
  ] };
  const before = step('Project', ['subject-word', 'subject-sailors'], canvas);
  const selected = step('LexicalSelect', ['seem', 'subject-word', 'subject-sailors'], canvas);
  const relation = { ...selected, operation: 'finite tense licensing', replayKind: 'relation' };
  const input = freeze([before, selected, relation]);
  const output = applyPreFrontingSentenceInitialCasing(input, 'The sailors seem');
  assert.deepEqual(output.map(item => find(item.replayCanvasData, 'subject-word').word),
    ['The', 'the', 'the']);
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

test('lexical selection labels use the same current visible casing as the tree', () => {
  const canvas = { id: 'root', label: 'VP', children: [
    { id: 'future', label: 'V', children: [word('future-word', 'seem')] }, subject('the')
  ] };
  const [result] = applyPreFrontingSentenceInitialCasing([
    step('LexicalSelect', ['subject-word'], canvas,
      { targetNodeId: 'subject-word', targetLabel: 'the', sourceLabels: ['the'] })
  ], 'The sailors seem');
  assert.equal(find(result.replayCanvasData, 'subject-word').word, 'The');
  assert.equal(result.targetLabel, 'The');
  assert.deepEqual(result.sourceLabels, ['The']);
});
