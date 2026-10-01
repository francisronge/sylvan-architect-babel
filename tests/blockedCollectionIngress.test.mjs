import assert from 'node:assert/strict';
import test from 'node:test';
import { __test__ } from '../server/babelParser.js';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { blockedCollectionCases, blockedCollectionStage } from './helpers/blockedCollectionFixtures.mjs';

test('collection painter fixtures enter through canonical normalization and produce complete Replay', () => {
  for (const { id, relations } of blockedCollectionCases) {
    const input = { analyses: [{ derivationStages: [blockedCollectionStage(relations)] }] };
    const bundle = __test__.normalizeParseBundle(input, 'minimalism', 'with children', 'fixture', true);
    assert.equal(bundle.analyses.length, 1, id);
    assert.equal(bundle.analyses[0].finalForest.length, 1, id);
    assert.equal(bundle.analyses[0].tree.id, 'root', id);
    assert.deepEqual(bundle.inputTokens, ['with', 'children']);
    const replay = prepareReplay({ sentence: 'with children', inputTokens: bundle.inputTokens,
      derivationStages: bundle.analyses[0].derivationStages, includePlayback: true });
    assert(replay.playbackSteps.length > relations.length, id);
    assert.deepEqual(replay.playbackSteps.flatMap(step => step.replayRelationIdentity ? [step.replayRelationIdentity] : []),
      relations.map((_, relationIndex) => ({ stageIndex: 0, relationIndex })), id);
    const items = replay.relationRenderPlan.frames[0].items;
    assert(items.some(item => item.pathStyle === 'case-agree'), id);
    assert.equal(items.some(item => item.pathStyle === 'case-agree' && item.outcome === 'blocked'),
      id !== 'native-outcome-control', id);
    if (id === 'unpaired') assert(!items.some(item => item.kind === 'node-plaque'));
  }
});
