import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { checkAttachAtMerge, checkNoEarlyReveal, checkStableConstruction, frameStructure } from './helpers/replayInvariants.mjs';
import { checkStepSemantics } from './helpers/replayStepInvariants.mjs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/dissolved-constituent-rebuild.json', import.meta.url), 'utf8'));

test('a dissolved constituent stays until the construction step that regroups its material', () => {
  const steps = prepareReplay({ ...fixture, includePlayback: true }).playbackSteps;
  const stage = steps.map((step, index) => ({ step, index })).filter(({ step }) => step.replayFrameIndex === 4);
  const regroup = stage.find(({ step }) => step.targetNodeId === 'persuasionArguments');
  assert.ok(regroup, 'the new V′ has its own construction step');
  const before = frameStructure(steps[regroup.index - 1]), after = frameStructure(regroup.step);
  assert.equal(before.parent.get('persuaded'), 'persuasionVCore');
  assert.equal(before.parent.get('embeddedTP'), 'persuasionVCore');
  assert.equal(before.parent.get('persuasionVCore'), 'persuasionVP');
  assert.equal(after.displayed.has('persuasionVCore'), false);
  assert.equal(after.parent.get('persuaded'), 'persuasionVP');
  assert.equal(after.parent.get('mary'), 'persuasionArguments');
  assert.equal(after.parent.get('embeddedTP'), 'persuasionArguments');
  assert.equal(stage.filter(({ step }) => step.replayKind === 'micro' && step.targetNodeId === 'persuasionVP').length, 0,
    'the retained VP needs no merge of its own');
});

test('a dissolved root keeps each daughter until the merge that takes it (03-en-there-insertion)', () => {
  const record = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/dissolved-root-rebuild.json', import.meta.url), 'utf8'));
  const replay = prepareReplay({ ...record, includePlayback: true }), steps = replay.playbackSteps;
  const merge = target => {
    const index = steps.findIndex(step => step.replayKind === 'micro' && step.operation === 'ExternalMerge' && step.targetNodeId === target);
    assert.ok(index > 0, `${target} has its own External Merge`);
    return frameStructure(steps[index]);
  };
  const noun = merge('restrictedN');
  assert.deepEqual(noun.children.get('catsDP'), ['indefD', 'numberP'], 'the DP keeps the null D and the NumP');
  assert.deepEqual(noun.children.get('numberP'), ['three'], 'the NumP keeps three after cats leaves');
  assert.equal(noun.parent.get('cats'), 'restrictedN');
  const number = merge('restrictedNum');
  assert.equal(number.displayed.has('numberP'), false, 'the NumP leaves with its last daughter');
  assert.deepEqual(number.children.get('catsDP'), ['indefD']);
  assert.equal(number.parent.get('three'), 'restrictedNum');
  const determiner = merge('restrictedDP');
  assert.equal(determiner.displayed.has('catsDP'), false, 'the DP leaves with its last daughter');
  assert.equal(determiner.parent.get('indefD'), 'restrictedDP');
  assert.deepEqual([...checkStableConstruction(replay), ...checkAttachAtMerge(replay), ...checkNoEarlyReveal(replay),
    ...checkStepSemantics(replay, record)], []);
});
