import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { buildReplayPlaqueSchedule, buildStageLayoutGroups } from '../replay/stageCamera.ts';
import { buildRenderableDerivationCanvasData } from '../replay/replayCompiler.ts';
import { measurePlaqueLayoutJob, runPlaqueLayoutJob } from '../replay/plaqueLayoutJob.ts';
import { fallbackPlaqueTextMeasure } from '../replay/relations/plaqueTextLayout.ts';

const measureTreeInk = (text, style) => ({ width: [...text].length * 22, left: -3, right: [...text].length * 22 + 3,
  ascent: 42, descent: style.endsWith('index') ? 34 : 12, fontAscent: 48, fontDescent: 17 });
function inputFor(measure) {
  const record = JSON.parse(readFileSync(new URL('../fixtures/visual-relations/successive-head-movement.json', import.meta.url)));
  const replay = prepareReplay({ ...record, includePlayback: true });
  return { steps: replay.playbackSteps, stageIndex: 0, plan: replay.relationRenderPlan,
    width: 1596, height: 1016, layoutGroups: buildStageLayoutGroups(replay.playbackSteps, replay.replayDerivationFrames),
    completedCanvas: buildRenderableDerivationCanvasData(record.derivationStages.at(-1).workspaceForest),
    measureCategoryText: text => [...text].length * 21.125,
    measurePlaqueText: fallbackPlaqueTextMeasure, measureTreeInk: measure };
}
function collect(input) {
  const iterator = measurePlaqueLayoutJob(input);
  let next = iterator.next();
  while (!next.done) next = iterator.next();
  return structuredClone(next.value);
}

test('ink collection survives warm geometry caches, structured clone, and worker allocation exactly', async () => {
  const input = inputFor(measureTreeInk), expected = buildReplayPlaqueSchedule(input);
  const job = collect(input);
  assert(job.treeInk.size > 0);
  assert.equal('measureTreeInk' in job.input, false, 'worker input contains no callback');
  assert.deepEqual(runPlaqueLayoutJob(job).schedule, expected);
  const worker = new Worker(new URL('./support/plaqueLayoutWorkerBridge.mjs', import.meta.url));
  try {
    const response = once(worker, 'message');
    worker.postMessage(job);
    assert.deepEqual((await response)[0].result.schedule, expected);
  } finally { await worker.terminate(); }
  const missing = structuredClone(job);
  missing.treeInk.delete(missing.treeInk.keys().next().value);
  assert.throws(() => runPlaqueLayoutJob(missing), /Missing measured text/);
});

test('intentional unavailable glyph metrics round-trip as fallback; missing captured entries are errors', () => {
  const input = inputFor(() => undefined), expected = buildReplayPlaqueSchedule(input), job = collect(input);
  assert(job.treeInk.size > 0);
  assert([...job.treeInk.values()].every(value => value === undefined));
  assert.deepEqual(runPlaqueLayoutJob(job).schedule, expected);
  job.treeInk = new Map();
  assert.throws(() => runPlaqueLayoutJob(job).schedule, /Missing measured text/);
});

test('jobs without optional ink measurement preserve the existing worker contract', () => {
  const input = inputFor(undefined), job = collect(input);
  assert.equal('treeInk' in job, false);
  assert.deepEqual(runPlaqueLayoutJob(job).schedule, buildReplayPlaqueSchedule(input));
});
