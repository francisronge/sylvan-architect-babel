import assert from 'node:assert/strict';
import test from 'node:test';
import { isWordlessCategoryLeaf, isDisplayTerminalNode } from '../replay/replaySurfaceNotation.ts';
import { buildRenderableCommittedCanvasData } from '../replay/replayCanvas.ts';

test('wordless category leaves retain category identity regardless of silence', () => {
  for (const label of ['C', 'T', 'I', 'v', 'D', 'N', 'DP']) {
    for (const silent of [true, false, undefined]) {
      const node = { id: 'n', label, children: [], ...(silent === undefined ? {} : { silent }) };
      const original = structuredClone(node);
      assert.equal(isWordlessCategoryLeaf(node), true);
      assert.deepEqual(buildRenderableCommittedCanvasData(node), original);
      assert.deepEqual(node, original);
    }
  }
});

test('lexical content, traces and nulls do not acquire wordless-category styling', () => {
  for (const fields of [
    { label: 'N', word: 'book', silent: true },
    { label: 'I', word: 'I', tokenIndex: 0 },
    { label: 't_1', silent: true },
    { label: '\u2205', silent: true }
  ]) {
    assert.equal(isWordlessCategoryLeaf({ id: 'n', children: [], ...fields }), false);
  }
  // Pronunciation is authored in `word`. A wordless leaf is an abstract
  // category whatever its label spells or however it is cased; a stray
  // tokenIndex on it is a contract defect for diagnostics, not a word.
  for (const fields of [
    { label: 'I', tokenIndex: 0 },
    { label: 'book' },
    { label: 'appl' },
    { label: 'Appl' },
    { label: 'voice', silent: true },
    { label: 'Neg' }
  ]) {
    assert.equal(isWordlessCategoryLeaf({ id: 'n', children: [], ...fields }), true);
  }
  const tree = buildRenderableCommittedCanvasData({ id: 'n', label: 'N', word: 'book', silent: true, children: [] });
  assert.equal(tree.label, 'N');
  assert.equal(tree.children[0].word, 'book');
  assert.equal(isWordlessCategoryLeaf(tree.children[0]), false);
});


test('terminal identity follows authored words, not category-shaped spelling', () => {
  for (const word of ['I', 'A', 'P', 'DP', 't', 'unknown']) for (const silent of [true, false]) {
    assert.equal(isDisplayTerminalNode({ label: 'D', word, silent }), true, word);
    assert.equal(isDisplayTerminalNode({ label: word, children: [{ label: 'N', word: 'child' }] }), false);
  }
  for (const label of ['I', 'A', 'P', 'DP', 'unfamiliar category', 't[NP]']) {
    assert.equal(isDisplayTerminalNode({ label }), false, label);
  }
  for (const label of ['t', 't1', '∅']) assert.equal(isDisplayTerminalNode({ label }), true, label);
});
