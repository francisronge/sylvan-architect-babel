import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';

// Construction is bottom-up and just in time: of two sisters, the one with more construction
// still to do is built first, so a head or other small piece is selected right before the
// merge that uses it.
const leaf = (id, label, word, tokenIndex) => ({ id, label, children: [{ id: `w_${id}`, label: word, word, tokenIndex, children: [] }] });
const verbPhrase = [{ id: 'vp', label: 'VP', children: [leaf('v', 'V', 'read', 0),
  { id: 'dp', label: 'DP', children: [leaf('d', 'D', 'the', 1), { id: 'np', label: 'NP', children: [leaf('n', 'N', 'book', 2)] }] }] }];
const tenseBar = [{ id: 'tbar', label: "T'", children: [leaf('t', 'T', 'will', 0), { id: 'vp', label: 'VP', children: [leaf('v', 'V', 'leave', 1)] }] }];

const prepareWith = (forest, words) => prepareReplay({ derivationStages: [{ statement: 'Build it.', stageRecord: 'Built.', relations: [], workspaceForest: forest }],
  sentence: words.join(' '), inputTokens: words, includePlayback: true }).playbackSteps.filter(step => step.replayKind === 'micro');
const order = (forest, words) => prepareWith(forest, words).map(step => step.targetNodeId);

test('a verb phrase builds its object before selecting the verb that merges with it', () => {
  // book, N, NP, the, D, DP, read, V, VP
  assert.deepEqual(order(verbPhrase, ['read', 'the', 'book']),
    ['n::__lex_tok_2_book', 'n', 'np', 'd::__lex_tok_1_the', 'd', 'dp', 'v::__lex_tok_0_read', 'v', 'vp']);
});

test('a complement is built before the head that merges with it', () => {
  // leave, V, VP, will, T, T'
  assert.deepEqual(order(tenseBar, ['will', 'leave']), ['v::__lex_tok_1_leave', 'v', 'vp', 't::__lex_tok_0_will', 't', 'tbar']);
});

test('the selected sentence-initial word is cased before it is merged', () => {
  // The selected head is painted and labelled "Will" though the input is lowercase.
  assert.equal(prepareWith(tenseBar, ['will', 'leave'])[3].targetLabel, 'Will');
});
