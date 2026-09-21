import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { buildReplayPlaqueLayouts, buildStageLayoutGroups } from '../replay/stageCamera.ts';
import { buildRenderableDerivationCanvasData } from '../replay/replayCompiler.ts';
import { measurePlaqueLayoutJob, runPlaqueLayoutJob } from '../replay/plaqueLayoutJob.ts';
import { fallbackPlaqueTextMeasure } from '../replay/relations/plaqueTextLayout.ts';

test('serialized allocation preserves measured text, all future reservations and every placement', async () => {
  const record = JSON.parse(readFileSync(new URL('../fixtures/visual-relations/successive-head-movement.json', import.meta.url)));
  const replay = prepareReplay({ ...record, includePlayback: true });
  replay.relationRenderPlan.frames.forEach((frame, stageIndex) => frame.items.push({
    kind: 'node-plaque', plaqueStyle: 'theta-grid', anchorNodeIds: ['vm'], rows: [],
    thetaRoles: [{ label: 'A long role whose text wraps without losing its exact characters', index: 'i', nodeId: 'im' }],
    relationRef: { stageIndex, relationIndex: 90 }
  }));
  const input = { steps: replay.playbackSteps, stageIndex: 0, plan: replay.relationRenderPlan,
    width: 1596, height: 1016, layoutGroups: buildStageLayoutGroups(replay.playbackSteps, replay.replayDerivationFrames),
    completedCanvas: buildRenderableDerivationCanvasData(record.derivationStages.at(-1).workspaceForest),
    measureCategoryText: text => [...text].length * 21.125,
    measurePlaqueText: (text, style) => ({ ...fallbackPlaqueTextMeasure(text, style), width: [...text].length * style.fontSize * .58 }) };
  const iterator = measurePlaqueLayoutJob(input);
  let next = iterator.next(), stages = 0;
  while (!next.done) { stages++; next = iterator.next(); }
  assert.equal(stages, replay.relationRenderPlan.frames.length, 'measurement can yield between stages');
  const job = structuredClone(next.value);
  assert(job.categories.size > 0 && job.plaques.size > 0);
  const expected = buildReplayPlaqueLayouts(input);
  assert.deepEqual(runPlaqueLayoutJob(job), expected);
  const worker = new Worker(new URL('./support/plaqueLayoutWorkerBridge.mjs', import.meta.url));
  try {
    const response = once(worker, 'message');
    worker.postMessage(job);
    assert.deepEqual((await response)[0], { result: expected });
  } finally { await worker.terminate(); }
  job.categories.delete(job.categories.keys().next().value);
  assert.throws(() => runPlaqueLayoutJob(job), /Missing measured text/);
});
