import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { checkStageCompletion, frameStructure } from './helpers/replayInvariants.mjs';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';

const corpus = loadFixtureAnalyses();
const record = id => corpus.records.find(entry => entry.id === id).record;
const prepare = authored => prepareReplay({ ...structuredClone(authored), includePlayback: true });

test('the kernel holds back an authored unary root until the movement that fills it', () => {
  // Stage 1 authors ECP over its one daughter ecbar; stage 2's wh movement adds the landing.
  const authored = record('movement/clause-context.json#/cases/7'), replay = prepare(authored), steps = replay.playbackSteps;
  const shown = steps.flatMap((step, index) => frameStructure(step).displayed.has('ecp') ? [index] : []);
  const moment = steps[shown[0]];
  assert.equal(moment.replayKind, 'relation', 'ECP first appears at a relation moment');
  assert.equal(moment.replayFrameIndex, 1);
  assert.deepEqual(frameStructure(moment).children.get('ecp'), ['whNP', 'ecbar'], 'with its landing, never unary');
  assert.deepEqual(checkStageCompletion(replay, authored), [], 'the held stage still completes as authored, waiting for the movement');
});
