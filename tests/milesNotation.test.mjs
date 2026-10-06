import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMilesNotation } from '../services/milesNotation.ts';

const terminal = (label, word) => ({ id: label, label, ...(word === undefined ? {} : { word }) });
const branch = (label, children) => ({ id: label, label, children });

test('bracket notation preserves the ordered forest and Unicode lexical content', () => {
  const forest = [
    branch('TP', [branch('DP', [terminal('N', 'Öğretmenin')]), branch('T’', [terminal('T'), branch('VP', [terminal('V', 'okuduğu')])])]),
    branch('NP', [terminal('N', 'الطالبة')])
  ];
  const original = structuredClone(forest);
  assert.equal(buildMilesNotation(forest), '[TP [DP Öğretmenin] [T’ [T ∅] [VP okuduğu]]]\n[NP الطالبة]');
  assert.deepEqual(forest, original, 'serialization must leave authored syntax unchanged');
});

test('bracket notation escapes token delimiters and keeps existing leaf conventions', () => {
  assert.equal(buildMilesNotation([
    branch('NP [subject]', [terminal('N', 'a [quoted] word')]),
    terminal('word'),
    terminal('NP'),
    terminal(''),
    terminal('D’')
  ]), '[NP_(subject) a_(quoted)_word]\nword\n[NP ∅]\n∅\n[D’ ∅]');
});

test('bracket notation skips absent nodes without merging independent roots', () => {
  assert.equal(buildMilesNotation([null, branch('X', [null, terminal('noun')]), terminal('another')]), '[X noun]\nanother');
  assert.equal(buildMilesNotation([]), '');
});
