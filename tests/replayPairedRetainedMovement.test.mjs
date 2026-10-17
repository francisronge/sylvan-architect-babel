import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/paired-retained-movement.json', import.meta.url), 'utf8'));

test('one claim moving two retained occurrences introduces both landings at its own moment', () => {
  const replay = prepareReplay({ ...fixture, includePlayback: true });
  const steps = replay.playbackSteps;
  const moment = steps.findIndex(step => step.replayKind === 'relation'
    && step.replayRelationIdentity?.stageIndex === 4 && step.replayRelationIdentity.relationIndex === 0);
  assert.ok(moment > 0, 'subject A-movement has its own moment');
  for (const landing of ['j2', 'm2']) {
    steps.slice(0, moment).forEach((step, index) => assert.ok(!(step.replayVisibleNodeIds ?? []).includes(landing),
      `${landing} is visible at step ${index + 1}, before its movement`));
    assert.ok(steps[moment].replayVisibleNodeIds.includes(landing), `${landing} appears at its movement`);
  }
  const paths = replay.relationRenderPlan.frames.flatMap(frame => frame.items).filter(item => item.kind === 'trajectory'
    && item.relationRef?.stageIndex === 4 && item.relationRef.relationIndex === 0);
  assert.deepEqual([...new Set(paths.map(item => `${item.sourceNodeId}->${item.targetNodeId}`))].sort(), ['j1->j2', 'm1->m2']);
});
