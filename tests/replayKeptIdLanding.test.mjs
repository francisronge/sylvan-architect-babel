import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { checkStableConstruction, frameStructure } from './helpers/replayInvariants.mjs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/kept-id-landing.json', import.meta.url), 'utf8'));

const stageSteps = (steps, stageIndex) => steps.map((step, index) => ({ step, index })).filter(({ step }) => step.replayFrameIndex === stageIndex);

const assertSourceUntilMoment = (steps, { stageIndex, relationIndex, source, landingParent, trace }) => {
  const stage = stageSteps(steps, stageIndex);
  const moment = stage.find(({ step }) => step.replayKind === 'relation' && step.replayRelationIdentity?.relationIndex === relationIndex);
  assert.ok(moment, `stage ${stageIndex + 1} has its rewrite moment`);
  const before = stage.filter(({ index }) => index < moment.index);
  assert.ok(before.length > 0, 'construction precedes the moment');
  for (const { step, index } of before) {
    const frame = frameStructure(step);
    assert.equal(frame.parent.get('a-taro-np'), source, `frame ${index + 1}: 太郎 stays at its source`);
    assert.equal(frame.displayed.has(trace), false, `frame ${index + 1}: the trace waits for the moment`);
  }
  const at = frameStructure(moment.step);
  assert.equal(at.parent.get('a-taro-np'), landingParent, 'the moment places the landing under its new parent');
  assert.equal(at.parent.get(trace), source, 'the moment leaves the trace at the source');
  return { before, at };
};

test('an occurrence that keeps its id at the landing stays at its source until its rewrite moment', () => {
  const replay = prepareReplay({ ...structuredClone(fixture), includePlayback: true });
  const raising = assertSourceUntilMoment(replay.playbackSteps,
    { stageIndex: 2, relationIndex: 0, source: 'a-upper-vp', landingParent: 'a-ip', trace: 'a-subject-trace' });
  // The new IP attaches the landing above I′, so it appears with the landing.
  assert.equal(raising.before.some(({ step }) => frameStructure(step).displayed.has('a-ip')), false);
  assert.equal(raising.at.parent.get('a-ibar'), 'a-ip');
  const topicalization = assertSourceUntilMoment(replay.playbackSteps,
    { stageIndex: 4, relationIndex: 0, source: 'a-ip', landingParent: 'a-topic-kp', trace: 'a-topic-trace' });
  assert.equal(topicalization.before.some(({ step }) => frameStructure(step).displayed.has('a-topic-kp')), false);
  assert.deepEqual(checkStableConstruction(replay), []);
});

test('a kept-id occurrence stays at its source even when an earlier claim needs its new parent first', () => {
  const record = structuredClone(fixture);
  record.derivationStages[2].relations.unshift({ relation: 'clause typing', anchors: { clause: 'a-ip' }, values: { type: 'declarative' } });
  const replay = prepareReplay({ ...record, includePlayback: true });
  assertSourceUntilMoment(replay.playbackSteps, { stageIndex: 2, relationIndex: 1, source: 'a-upper-vp', landingParent: 'a-ip', trace: 'a-subject-trace' });
  assert.deepEqual(checkStableConstruction(replay), []);
});
