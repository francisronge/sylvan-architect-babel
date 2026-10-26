import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { checkAttachAtMerge, checkNoEarlyReveal, checkStageCompletion } from './helpers/replayInvariants.mjs';

// A receiving head that keeps its id as the new head complex's container gains
// a new inner head at the movement (Sol, Cantonese 佢食咗飯未呀？: Asp⁰
// "aspect" becomes [v, aspect-suffix]). That inner head arrives with the
// movement, so the completed stage shows it and no later step reveals it.
const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/receiving-head-container.json', import.meta.url)));

test('receiving-head-container.json: a retained receiving head shows its new inner head at the movement', () => {
  const replay = prepareReplay({ ...structuredClone(record), includePlayback: true });
  const steps = replay.playbackSteps;
  const moment = steps.findIndex(step => step.replayKind === 'relation' && (step.replayRelationLinks ?? [])
    .some(link => link.renderFamily === 'trajectory' && link.priorSourceNodeId === 'v' && link.witnessNodeId === 'verb-trace'));
  assert.ok(moment > 0, 'the head movement has its moment');
  assert.ok(!steps[moment - 1].replayVisibleNodeIds.includes('aspect-suffix'), 'the inner head waits for the movement');
  assert.ok(steps[moment].replayVisibleNodeIds.includes('aspect-suffix'), 'the movement shows the inner head');
  const violations = [...checkStageCompletion(replay, record), ...checkNoEarlyReveal(replay), ...checkAttachAtMerge(replay)];
  assert.deepEqual(violations.map(violation => `${violation.rule} ${violation.frame} ${violation.detail}`), []);
});
