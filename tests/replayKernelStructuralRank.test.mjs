import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { writesProjectionLevels } from '../replay/projectionStructure.ts';
import { toBareStages } from './helpers/bareLabels.mjs';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';

// The just-in-time sister order reads structure only, so writing the same analysis in bare
// phrase-structure labels (T, C, D for TP/T′, CP/C′, DP/D′) changes no construction step.
const order = record => prepareReplay({ ...structuredClone(record), includePlayback: true }).playbackSteps
  .map(step => `${step.replayFrameIndex}:${step.replayKind}:${step.operation}:${step.targetNodeId}`);

test('X-bar fixtures rewritten in bare labels construct in the same order', () => {
  const xbar = loadFixtureAnalyses().records.filter(({ record }) => record.derivationStages.every(stage => writesProjectionLevels(stage.workspaceForest)));
  assert(xbar.length >= 150, `${xbar.length} X-bar fixture analyses`);
  const differing = xbar.filter(({ record }) => JSON.stringify(order(record))
    !== JSON.stringify(order({ ...record, derivationStages: toBareStages(record.derivationStages) }))).map(({ id }) => id);
  assert.deepEqual(differing, []);
});
