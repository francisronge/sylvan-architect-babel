import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { frameStructure } from './helpers/replayInvariants.mjs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/shared-landing-source.json', import.meta.url), 'utf8'));

test('each movement to a shared landing keeps its own source until its moment', () => {
  const steps = prepareReplay({ ...fixture, includePlayback: true }).playbackSteps;
  const stage = steps.map((step, index) => ({ step, index })).filter(({ step }) => step.replayFrameIndex === 2);
  const moment = stage.find(({ step }) => step.replayKind === 'relation' && step.targetNodeId === 'whMatrix');
  assert.ok(moment, 'the chain step has a movement moment');
  assert.equal(stage.some(({ step }) => step.replayKind === 'micro' && step.targetNodeId === 'edgeTrace'), false,
    'the lower occurrence is not selected as ordinary construction');
  for (const { step } of stage.filter(({ index }) => index < moment.index)) {
    const frame = frameStructure(step);
    assert.equal(frame.displayed.has('whEmbedded'), true, 'the source keeps its form before the moment');
    assert.equal(frame.parent.get('whNBar'), 'whEmbedded');
    assert.equal(frame.displayed.has('edgeTrace'), false);
  }
  const at = frameStructure(moment.step);
  assert.equal(at.displayed.has('whEmbedded'), false);
  assert.equal(at.displayed.has('edgeTrace'), true);
  assert.equal(at.parent.get('whNBar'), 'whMatrix');
});
