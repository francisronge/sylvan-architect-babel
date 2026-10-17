import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/rewrite-stage-new-head.json', import.meta.url), 'utf8'));

test('a rewrite stage still selects and merges its new ordinary head before the rewrite moment', () => {
  const steps = prepareReplay({ ...fixture, includePlayback: true }).playbackSteps;
  const stage = steps.map((step, index) => ({ step, index })).filter(({ step }) => step.replayFrameIndex === 3);
  const at = (predicate) => stage.find(({ step }) => predicate(step))?.index ?? -1;
  const select = at(step => step.operation === 'LexicalSelect' && step.targetNodeId === 's2EllipsisC');
  const merge = at(step => step.operation === 'ExternalMerge' && step.targetNodeId === 's2FocusCbar');
  const rewrite = at(step => step.replayKind === 'relation' && step.replayRelationIdentity?.relationIndex === 0);
  assert.ok(select >= 0 && merge > select && rewrite > merge, `select ${select}, merge ${merge}, rewrite ${rewrite}`);
  const record = stage.at(-1);
  assert.equal(record.step.operation, 'StageRecord');
  const before = new Set(steps[record.index - 1].replayVisibleNodeIds);
  assert.deepEqual(record.step.replayVisibleNodeIds.filter(id => !before.has(id)), [], 'the stage record adds no syntax');
});
