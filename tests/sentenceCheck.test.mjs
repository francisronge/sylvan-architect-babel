import test from 'node:test';
import assert from 'node:assert/strict';

import { convertSpelloutPayload } from '../server/babelParser/spellout.js';
import { normalizeParseBundle } from '../server/babelParser/parseNormalization.js';
import { deriveAnalysisDisplay } from '../services/analysisDisplay.ts';

const leaf = (id, word) => ({ id, label: word, word, children: [] });
const node = (id, label, ...children) => ({ id, label, children });
const clause = (...words) => ({ derivationStages: [{
  statement: 'The clause is complete.', stageRecord: 'Every word is in place.', relations: [],
  workspaceForest: [node('s', 'S', ...words.map(([id, word]) => leaf(id, word)))]
}] });
const WORDS = { mary: 'Mary', persuaded: 'persuaded', john: 'John', to: 'to', leave: 'leave' };
const tree = (...ids) => clause(...ids.map(id => [id, WORDS[id]]));
const sentence = 'Mary persuaded John to leave.';
const outOfOrder = check => check.words.filter(word => word.outOfOrder).map(word => word.text);

test('a tree with the sentence words in another order is kept, still failing, with the words out of order', () => {
  const [result] = convertSpelloutPayload(tree('mary', 'john', 'persuaded', 'to', 'leave'), sentence);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].rule, 'SPELLOUT_MISMATCH');
  assert.equal(result.sentenceCheck.treeReading, 'Mary John persuaded to leave.');
  assert.deepEqual(result.sentenceCheck.inputTokens, ['Mary', 'John', 'persuaded', 'to', 'leave']);
  // Both words of a swap are marked.
  assert.deepEqual(outOfOrder(result.sentenceCheck), ['John', 'persuaded']);
  assert.deepEqual(result.sentenceCheck.words.map(word => word.sentenceIndex), [0, 2, 1, 3, 4]);
  assert.deepEqual(result.sentenceCheck.words[1].nodeIds, ['john']);
});

test('a word that moved alone is the only one marked', () => {
  const [result] = convertSpelloutPayload(tree('leave', 'mary', 'persuaded', 'john', 'to'), sentence);
  assert.deepEqual(outOfOrder(result.sentenceCheck), ['leave.']);
});

test('a missing or extra word is not a word-order failure and still fails the response', () => {
  const [missing] = convertSpelloutPayload(tree('mary', 'persuaded', 'to', 'leave'), sentence);
  assert.equal(missing.ok, false);
  assert.equal(missing.sentenceCheck, undefined);
  assert.throws(() => normalizeParseBundle(tree('mary', 'persuaded', 'to', 'leave'), 'xbar', sentence, 'gpt', true, { spellout: true }),
    error => error.failure?.ruleId === 'SPELLOUT_INCOMPLETE' || error.failure?.ruleId === 'SPELLOUT_MISMATCH');
  // A tree already in sentence order passes as before.
  assert.equal(convertSpelloutPayload(tree('mary', 'persuaded', 'john', 'to', 'leave'), sentence)[0].ok, true);
});

test('parsing returns the kept analysis with its own word list and records it as a failed outcome', () => {
  const outcomes = [];
  const bundle = normalizeParseBundle(tree('mary', 'john', 'persuaded', 'to', 'leave'), 'xbar', sentence, 'gpt', true,
    { spellout: true, analysisOutcomes: outcomes });
  const [analysis] = bundle.analyses;
  assert.equal(analysis.sentenceCheck.treeReading, 'Mary John persuaded to leave.');
  assert.deepEqual(bundle.inputTokens, ['Mary', 'persuaded', 'John', 'to', 'leave']);
  assert.deepEqual(outcomes.map(outcome => [outcome.status, outcome.kept, outcome.failure.ruleId]), [['failed', true, 'SPELLOUT_MISMATCH']]);
  // The browser reads the analysis against its own word list.
  assert.deepEqual(deriveAnalysisDisplay(bundle, analysis, sentence).inputTokens, ['Mary', 'John', 'persuaded', 'to', 'leave']);
});

test('in a response with several analyses each reordered one is kept beside the passing ones', () => {
  const bundle = normalizeParseBundle({ analyses: [tree('mary', 'persuaded', 'john', 'to', 'leave'), tree('mary', 'john', 'persuaded', 'to', 'leave')] },
    'xbar', sentence, 'gpt', true, { spellout: true });
  assert.equal(bundle.analyses[0].sentenceCheck, undefined);
  assert.equal(bundle.analyses[1].sentenceCheck.treeReading, 'Mary John persuaded to leave.');
  assert.deepEqual(bundle.inputTokens, ['Mary', 'persuaded', 'John', 'to', 'leave']);
});
