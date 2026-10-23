import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';

// The construction kernel keeps the sister order Replay already shows: Select
// order is free, and only Merge is bottom-up.
const leaf = (id, label, word, tokenIndex) => ({ id, label, children: [{ id: `w_${id}`, label: word, word, tokenIndex, children: [] }] });
const verbPhrase = [{ id: 'vp', label: 'VP', children: [leaf('v', 'V', 'read', 0),
  { id: 'dp', label: 'DP', children: [leaf('d', 'D', 'the', 1), { id: 'np', label: 'NP', children: [leaf('n', 'N', 'book', 2)] }] }] }];
const tenseBar = [{ id: 'tbar', label: "T'", children: [leaf('t', 'T', 'will', 0), { id: 'vp', label: 'VP', children: [leaf('v', 'V', 'leave', 1)] }] }];

const prepareWith = (forest, words, kernel) => {
  const before = process.env.BABEL_REPLAY_KERNEL;
  if (kernel) process.env.BABEL_REPLAY_KERNEL = '1'; else delete process.env.BABEL_REPLAY_KERNEL;
  try {
    return prepareReplay({ derivationStages: [{ statement: 'Build it.', stageRecord: 'Built.', relations: [], workspaceForest: forest }],
      sentence: words.join(' '), inputTokens: words, includePlayback: true }).playbackSteps.filter(step => step.replayKind === 'micro');
  } finally {
    if (before === undefined) delete process.env.BABEL_REPLAY_KERNEL; else process.env.BABEL_REPLAY_KERNEL = before;
  }
};
const order = (forest, words, kernel) => prepareWith(forest, words, kernel).map(step => step.targetNodeId);

test('the kernel selects and merges a verb phrase in the order Replay already shows', () => {
  // read, V, the, D, book, N, NP, DP, VP
  const expected = ['v::__lex_tok_0_read', 'v', 'd::__lex_tok_1_the', 'd', 'n::__lex_tok_2_book', 'n', 'np', 'dp', 'vp'];
  assert.deepEqual(order(verbPhrase, ['read', 'the', 'book'], false), expected);
  assert.deepEqual(order(verbPhrase, ['read', 'the', 'book'], true), expected);
});

test('the kernel builds a complement before the head that merges with it, as Replay already does', () => {
  // leave, V, VP, will, T, T'
  const expected = ['v::__lex_tok_1_leave', 'v', 'vp', 't::__lex_tok_0_will', 't', 'tbar'];
  assert.deepEqual(order(tenseBar, ['will', 'leave'], false), expected);
  assert.deepEqual(order(tenseBar, ['will', 'leave'], true), expected);
});

test('the kernel cases the sentence-initial word as Replay already does, before it is merged', () => {
  // Main paints and labels the selected sentence-initial head "Will" though the input is lowercase.
  const labels = kernel => prepareWith(tenseBar, ['will', 'leave'], kernel).map(step => step.targetLabel);
  assert.deepEqual(labels(true), labels(false));
  assert.equal(labels(true)[3], 'Will');
});
