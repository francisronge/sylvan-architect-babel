import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { frameStructure } from './helpers/replayInvariants.mjs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/inserted-adjunction-segment.json', import.meta.url), 'utf8'));

// The retained node continues as the lower segment; the new upper segment is built at its own merge.
test('a new segment inserted under a retained node continues it, and the new upper segment is built at its own step', () => {
  const steps = prepareReplay({ ...fixture, includePlayback: true }).playbackSteps;
  const stage = steps.map((step, index) => ({ step, index })).filter(({ step }) => step.replayFrameIndex === 1);
  const first = frameStructure(stage[0].step);
  assert.equal(first.displayed.has('hcore'), true, 'the lower segment continues the retained DP from the stage\'s first step');
  assert.equal(first.displayed.has('hdp'), false, 'the new upper segment is absent at the stage\'s first step');
  assert.equal(first.parent.get('hd'), 'hcore');
  assert.equal(first.parent.get('hnp'), 'hcore');
  assert.ok(!stage.some(({ step }) => step.replayKind === 'micro' && step.targetNodeId === 'hcore'), 'the continued segment is not built again');
  const attach = stage.find(({ step }) => step.replayKind === 'micro' && step.targetNodeId === 'hdp');
  assert.ok(attach, 'the upper segment has its own construction step');
  const before = frameStructure(steps[attach.index - 1]), after = frameStructure(attach.step);
  assert.equal(before.displayed.has('hdp'), false);
  assert.equal(before.displayed.has('rcp'), true, 'the relative clause is built before it attaches');
  assert.equal(after.parent.get('hcore'), 'hdp');
  assert.equal(after.parent.get('rcp'), 'hdp');
  assert.equal(after.parent.get('hd'), 'hcore');
});
