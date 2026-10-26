import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';

// Claude Opus 5.5 keeps a moved occurrence's ID at its landing and writes the
// shared lineage only at the movement stage, with a fresh lower occurrence (here
// relabelled t). The prompt allows either endpoint to keep the ID, so each
// movement must still draw its path, introduce its lower occurrence and landing
// at its own moment, and leave the source in its preceding form until then.
const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/kept-landing-fresh-trace.json', import.meta.url)));

test('kept-landing-fresh-trace.json: each movement keeping its landing ID plays as movement at its own moment', () => {
  const original = structuredClone(record);
  const replay = prepareReplay({ sentence: record.sentence, inputTokens: record.inputTokens,
    derivationStages: record.derivationStages, includePlayback: true });
  const steps = replay.playbackSteps;
  for (const [stage, source, lower] of [[3, 'v-oku', 't-v'], [4, 'np-ali', 't-ali']]) {
    const items = replay.relationRenderPlan.frames[stage].items;
    assert(items.some(item => item.kind === 'trajectory' && item.relationRef.relationIndex === 0), `stage ${stage} draws its movement`);
    const moment = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === stage && step.replayRelationIdentity?.relationIndex === 0);
    assert(moment > 0, `stage ${stage} has its movement moment`);
    assert.deepEqual(steps[moment].movementDiagnostics ?? [], [], `stage ${stage} movement is proven`);
    const before = steps.slice(0, moment).filter(step => step.replayFrameIndex === stage || step.replayFrameIndex === stage - 1);
    for (const step of before) {
      assert(!step.replayVisibleNodeIds.includes(lower), `${lower} waits for its moment`);
      assert(step.replayVisibleNodeIds.includes(source), `${source} stays in its preceding form before its moment`);
    }
    assert(steps[moment].replayVisibleNodeIds.includes(lower) && steps[moment].replayVisibleNodeIds.includes(source));
  }
  assert.deepEqual(record, original, 'authored data stays unchanged');
});
