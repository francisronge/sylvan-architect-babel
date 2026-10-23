import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { buildReplayPanelContent } from '../replay/replayPanel.ts';
import { checkRelationMoments, checkStageCompletion, frameStructure } from './helpers/replayInvariants.mjs';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';

const corpus = loadFixtureAnalyses();
const record = id => corpus.records.find(entry => entry.id === id).record;
const withKernel = prepare => {
  const before = process.env.BABEL_REPLAY_KERNEL;
  process.env.BABEL_REPLAY_KERNEL = '1';
  try { return prepare(); } finally { if (before === undefined) delete process.env.BABEL_REPLAY_KERNEL; else process.env.BABEL_REPLAY_KERNEL = before; }
};
const prepare = authored => withKernel(() => prepareReplay({ ...structuredClone(authored), includePlayback: true }));

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

test('a true duplicate movement claim shares its original moment and stays listed in the panel', () => {
  // Stage 2: raising (relation 0) and A-trace licensing (relation 3) claim the same moved phrase, source and landing.
  const authored = record('movement/clause-context.json#/cases/0'), replay = prepare(authored);
  const moments = replay.playbackSteps.filter(step => step.replayKind === 'relation' && step.replayFrameIndex === 1);
  const shared = moments.find(step => step.replayRelationIdentity.relationIndex === 0);
  assert.deepEqual(shared.replaySharedRelationIdentities, [{ stageIndex: 1, relationIndex: 3 }]);
  assert(!moments.some(step => step.replayRelationIdentity.relationIndex === 3), 'no second moment for the duplicate');
  assert.deepEqual(buildReplayPanelContent(shared, authored.derivationStages).supportLines
    .filter(line => line.label === 'Same moment').map(line => line.value), ['A-trace licensing']);
  assert.deepEqual(checkRelationMoments(replay, authored), []);
});
