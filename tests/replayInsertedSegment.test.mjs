import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { frameStructure } from './helpers/replayInvariants.mjs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/inserted-adjunction-segment.json', import.meta.url), 'utf8'));

test('a new segment inserted under a retained node is built at its own step', () => {
  const steps = prepareReplay({ ...fixture, includePlayback: true }).playbackSteps;
  const stage = steps.map((step, index) => ({ step, index })).filter(({ step }) => step.replayFrameIndex === 1);
  const first = frameStructure(stage[0].step);
  assert.equal(first.displayed.has('hcore'), false, 'the inserted DP is absent at the stage\'s first step');
  assert.equal(first.parent.get('hd'), 'hdp');
  assert.equal(first.parent.get('hnp'), 'hdp');
  const own = stage.find(({ step }) => step.replayKind === 'micro' && step.targetNodeId === 'hcore');
  assert.ok(own, 'the inserted DP has its own construction step');
  const before = frameStructure(steps[own.index - 1]), after = frameStructure(own.step);
  assert.equal(before.displayed.has('hcore'), false);
  assert.equal(after.parent.get('hcore'), 'hdp');
  assert.equal(after.parent.get('hd'), 'hcore');
  assert.equal(after.parent.get('hnp'), 'hcore');
  const attach = stage.find(({ step }) => step.replayKind === 'micro' && step.targetNodeId === 'hdp');
  assert.ok(attach && attach.index > own.index, 'the relative clause attaches after the inserted segment exists');
  assert.equal(frameStructure(attach.step).parent.get('rcp'), 'hdp');
});
