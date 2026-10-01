import assert from 'node:assert/strict';
import test from 'node:test';
import { __test__ } from '../server/babelParser.js';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { isPlanItemRevealed } from '../replay/relations/renderPlanCompiler.ts';
import { closeoutPayload, closeoutSentence } from './helpers/rendererCloseoutFixture.mjs';

test('changed same-anchor claims retain distinct Replay moments and replacement values beside a malformed relation', () => {
  const raw = closeoutPayload(), original = structuredClone(raw);
  const bundle = __test__.normalizeParseBundle(raw, 'xbar', closeoutSentence, 'gpt', true);
  const analysis = bundle.analyses[0];
  assert.deepEqual(raw, original);
  assert.deepEqual(analysis.derivationStages.at(-1).workspaceForest.map(node => node.id), ['abandoned', 'clause']);
  assert.deepEqual(analysis.derivationStages[1].relations[1].relationContractFailure.raw.values, ['retained original value']);
  const replay = prepareReplay({ sentence: closeoutSentence, derivationStages: analysis.derivationStages, includePlayback: true });
  assert.deepEqual(replay.playbackSteps.filter(step => step.replayKind === 'relation').map(step => step.replayRelationIdentity),
    [{ stageIndex: 0, relationIndex: 0 }, { stageIndex: 1, relationIndex: 0 },
      { stageIndex: 1, relationIndex: 1 }, { stageIndex: 2, relationIndex: 0 }]);
  const plaques = replay.relationRenderPlan.frames.flatMap((frame, index) => frame.items.filter(item => item.kind === 'node-plaque'
    && item.relationRef.stageIndex === index));
  assert.deepEqual(plaques.map(item => item.rows.map(row => row.value)),
    [['number: singular'], ['number: plural'], ['number: plural', 'Case: nominative']]);
  assert.equal(new Set(plaques.map(item => item.claimIdentity ?? item.tier2ClaimIdentity)).size, 3);
  for (const [stageIndex, expected] of [['number: singular'], ['number: plural'], ['number: plural', 'Case: nominative']].entries()) {
    const visible = replay.relationRenderPlan.frames[stageIndex].items.filter(item => item.kind === 'node-plaque'
      && isPlanItemRevealed(item, stageIndex, new Set([0])));
    assert.deepEqual(visible.flatMap(item => item.rows.map(row => row.value)), expected);
  }
});
