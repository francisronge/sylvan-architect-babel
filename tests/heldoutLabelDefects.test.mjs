import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { treeLabelRunsForStep } from '../replay/treeLabelRuns.ts';

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
