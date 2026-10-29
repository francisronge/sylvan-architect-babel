import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { treeLabelRunsForStep } from '../replay/treeLabelRuns.ts';
import { checkOneLetterPerLabel } from './helpers/replayInvariants.mjs';

/* Defects of the 29 October 2026 held-out batch, each reproduced from its saved
 * analysis (tests/helpers/heldoutDefectRecords.json). */

const records = JSON.parse(readFileSync(new URL('./helpers/heldoutDefectRecords.json', import.meta.url), 'utf8'));
const prepare = key => {
  const { sentence, inputTokens, derivationStages } = records[key];
  return prepareReplay({ sentence, inputTokens, derivationStages: structuredClone(derivationStages), includePlayback: true });
};
const runsAt = (replay, step) => treeLabelRunsForStep(replay, step - 1, undefined, { includeRelationIndices: true });

test('Opus h1-030: a leaf labelled I with the word i shows its category above its word', () => {
  const replay = prepare('opus-h1-030-a1'), last = replay.playbackSteps.length;
  const runs = runsAt(replay, last);
  assert.deepEqual(runs.get('i1')?.map(run => [run.kind, run.text]), [['category', 'I']]);
  assert.deepEqual(runs.get('i1::__leaf')?.map(run => [run.kind, run.text]), [['terminal', 'i']]);
});

test('Opus h1-014: the words of a moved wh-phrase carry no operator-variable link number', () => {
  // The binding painter letters the operator and its variable; the words of
  // [DP Which cake]₂ used to show the link's position among the stage's links.
  const replay = prepare('opus-h1-014-a1');
  assert.equal(replay.playbackSteps.length, 114);
  for (const step of [113, 114]) for (const includeRelationIndices of [true, false]) {
    const runs = treeLabelRunsForStep(replay, step - 1, undefined, { includeRelationIndices });
    assert.deepEqual([...new Set(runs.get('D_which::__leaf').map(run => run.text))], ['Which'], `step ${step}`);
    assert.deepEqual([...new Set(runs.get('N_cake::__leaf').map(run => run.text))], ['cake'], `step ${step}`);
    assert.deepEqual([...new Set(runs.get('DP_wh').map(run => run.text))], ['DP₂'], `step ${step}`);
    assert.deepEqual([...new Set(runs.get('I1::__leaf').map(run => run.text))], ['did₃'], `step ${step}`);
  }
});

test('Sol h1-070: a theta letter and an equal binding letter on one trace show the letter once', () => {
  // The allocator gives the argument rop the letter i of its relative chain, so
  // its theta letter and the operator-variable letter are one index; from step
  // 56 the label read ropᵢᵢ. The binding letter now decorates the label that
  // already writes it, as it does for a written subscript.
  for (const key of ['sol-h1-070-a1', 'sol-h1-070-a2']) assert.deepEqual(checkOneLetterPerLabel(prepare(key)), [], key);
});
