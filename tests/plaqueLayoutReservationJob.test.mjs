import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { measurePlaqueLayoutJob, runPlaqueLayoutJob, bindPlaqueLayoutResult, bindPlaqueLayoutProgress, completePlaqueLayoutResult } from '../replay/plaqueLayoutJob.ts';
import { measureStagePlaqueSpace, buildReplayPlaqueSchedule, buildStageCameraBounds } from '../replay/stageCamera.ts';
import { getCoherentWorkspaceDiagnostics } from '../replay/workspacePlacement.ts';
import { fallbackPlaqueTextMeasure } from '../replay/relations/plaqueTextLayout.ts';

function inputFor(direction = 'ltr', abstractionMode = false) {
  const canvas = { id: 'root', label: 'TP', children: [
    { id: 'n', label: 'NP', children: [{ id: 'noun', label: 'N', word: 'Book₁₀' }] },
    { id: 'v', label: 'V', word: 'arrive' }
  ] };
  const steps = [0, 1].map(stage => ({ replayCanvasData: structuredClone(canvas), replayFrameIndex: stage,
    replayKind: 'macro', replayStageStepIndex: 0, replayVisibleNodeIds: ['root', 'n', 'noun', 'v'] }));
  return { steps, stageIndex: 0, completedCanvas: structuredClone(canvas),
    plan: { frames: [0, 1].map(stageIndex => ({ items: [{ kind: 'node-plaque', plaqueStyle: 'theta-grid',
      anchorNodeIds: ['v'], rows: [], thetaRoles: [{ label: 'Agent', index: 'i', nodeId: 'n' }],
      relationRef: { stageIndex, relationIndex: 0 } }] })) }, width: 900, height: 600,
    direction, abstractionMode, protectedNodeIds: new Set(['v']),
    measureCategoryText: text => [...text].length * 21, measurePlaqueText: fallbackPlaqueTextMeasure,
    measureTreeInk: () => undefined, measureTreeLabel: () => undefined };
}
function capture(input) {
  const iterator = measurePlaqueLayoutJob(input); let next;
  do { next = iterator.next(); } while (!next.done);
  return next.value;
}
const workerResult = job => structuredClone(runPlaqueLayoutJob(structuredClone(job)));

for (const direction of ['ltr', 'rtl']) for (const abstraction of [false, true]) {
  test('off-thread reservations preserve scenes, schedule and camera: ' + direction + ', abstraction ' + abstraction, () => {
    const input = inputFor(direction, abstraction), job = capture(input);
    assert.deepEqual(getCoherentWorkspaceDiagnostics(input.steps), [], 'font collection must not invoke coordinate planning');
    assert.equal('coordinates' in job, false, 'no provisional geometry crosses to the worker');
    const snapshot = structuredClone(job), result = workerResult(job);
    const bound = bindPlaqueLayoutResult(input, job, result);
    assert.deepEqual(getCoherentWorkspaceDiagnostics(input.steps), [], 'binding does not populate or call the main planner');
    const camera = buildStageCameraBounds({ ...input, plaqueSchedule: bound.schedule, coordinates: bound.coordinates });
    assert.deepEqual(getCoherentWorkspaceDiagnostics(input.steps), [], 'prepared camera fitting does not call the planner');
    assert.deepEqual(bound.schedule, buildReplayPlaqueSchedule(input));
    assert.deepEqual(camera, buildStageCameraBounds({ ...input, plaqueSchedule: bound.schedule }));
    for (let stageIndex = 0; stageIndex < input.plan.frames.length; stageIndex++) {
      const points = bound.coordinates.get(stageIndex);
      assert(points.has(input.steps[stageIndex].replayCanvasData), 'keys are the original canvas objects');
      assert(!points.has(job.input.steps[stageIndex].replayCanvasData), 'the snapshot canvas cannot substitute for the original');
      assert.deepEqual(measureStagePlaqueSpace({ ...input, stageIndex }),
        measureStagePlaqueSpace({ ...input, stageIndex }, { reservations: points }));
    }
    assert.deepEqual(job, snapshot, 'worker and binding do not edit the frozen request');
  });
}

test('actual worker returns reservations bound to exact original canvases and an unchanged schedule', async () => {
  const input = inputFor(), job = capture(input);
  const worker = new Worker(new URL('./support/plaqueLayoutWorkerBridge.mjs', import.meta.url));
  try {
    const response = once(worker, 'message'); worker.postMessage(job);
    const actual = (await response)[0];
    assert.equal(actual.error, undefined);
    const bound = bindPlaqueLayoutResult(input, job, actual.result);
    assert(bound.coordinates.get(0).has(input.steps[0].replayCanvasData));
    assert.deepEqual(getCoherentWorkspaceDiagnostics(input.steps), []);
    assert.deepEqual(bound.schedule, buildReplayPlaqueSchedule(input));
  } finally { await worker.terminate(); }
});

test('planless Replay still prepares every stage and shares repeated canvas identities', () => {
  const input = inputFor(); input.plan = null;
  input.steps.push({ ...input.steps[0], replayFrameIndex: 3 });
  const job = capture(input), bound = bindPlaqueLayoutResult(input, job, workerResult(job));
  assert.deepEqual(bound.schedule, { stages: [], steps: new Map() });
  assert.deepEqual([...bound.coordinates.keys()], [0, 1, 3]);
  assert(bound.coordinates.get(3).has(input.steps[0].replayCanvasData));
  assert.deepEqual(getCoherentWorkspaceDiagnostics(input.steps), []);
  assert(buildStageCameraBounds({ ...input, coordinates: bound.coordinates, includeOverlays: false }));
  assert.deepEqual(getCoherentWorkspaceDiagnostics(input.steps), []);
});

test('Canopy without Replay retains the completed-canvas layout and plaque fallback', () => {
  const input = inputFor(); input.steps = [];
  const job = capture(input), bound = bindPlaqueLayoutResult(input, job, workerResult(job));
  assert.deepEqual(bound.schedule, buildReplayPlaqueSchedule(input));
  assert([...bound.coordinates.values()].every(stage => stage.size === 0));
});

for (const [name, mutate] of [
  ['missing stage', result => result.coordinates.delete(0)],
  ['missing canvas', result => result.coordinates.get(0).clear()],
  ['missing node', result => result.coordinates.get(0).values().next().value.delete('v')],
  ['nonfinite coordinate', result => { result.coordinates.get(0).values().next().value.get('v').x = Infinity; }],
  ['unknown ordinal', result => result.coordinates.get(0).set(999, new Map())],
  ['wrong request', result => { result.requestKey += '-old'; }]
]) test(name + ' fails closed without main-thread planning', () => {
  const input = inputFor(), job = capture(input), result = workerResult(job); mutate(result);
  assert.throws(() => bindPlaqueLayoutResult(input, job, result), /Replay|prepared/);
  assert.deepEqual(getCoherentWorkspaceDiagnostics(input.steps), []);
});

for (const [name, mutate] of [
  ['viewport', input => { input.width += 100; }],
  ['direction', input => { input.direction = 'rtl'; }],
  ['syntax', input => input.steps[0].replayCanvasData.children.reverse()],
  ['same-content replacement canvas', input => { input.steps[0].replayCanvasData = structuredClone(input.steps[0].replayCanvasData); }],
  ['font callback', input => { input.measureCategoryText = text => text.length * 23; }]
]) test('stale ' + name + ' cannot accept an earlier worker result', () => {
  const input = inputFor(), job = capture(input), result = workerResult(job); mutate(input);
  assert.throws(() => bindPlaqueLayoutResult(input, job, result), /no longer matches/);
  assert.deepEqual(getCoherentWorkspaceDiagnostics(input.steps), []);
});

test('a modified measurement table cannot bind a result made with different font metrics', () => {
  const input = inputFor(), job = capture(input), result = workerResult(job);
  job.categories.set('TP', 100);
  assert.throws(() => bindPlaqueLayoutResult(input, job, result), /no longer matches/);
});

test('changed serialized job data is rejected before coordinate planning', () => {
  const job = structuredClone(capture(inputFor())); job.input.width += 100;
  assert.throws(() => runPlaqueLayoutJob(job), /job input changed/);
  assert.deepEqual(getCoherentWorkspaceDiagnostics(job.input.steps), []);
});

test('missing measured text remains an error, including an emptied required table', () => {
  const job = structuredClone(capture(inputFor())); job.categories.clear();
  assert.throws(() => runPlaqueLayoutJob(job), /Missing measured text/);
});

test('measurement reads its isolated snapshot across yields, even after input is edited and restored', () => {
  const input = inputFor(), iterator = measurePlaqueLayoutJob(input);
  assert.equal(iterator.next().done, false);
  const original = input.steps[0].replayCanvasData.children[0].label;
  input.steps[0].replayCanvasData.children[0].label = 'not part of this request';
  assert.equal(iterator.next().done, false);
  input.steps[0].replayCanvasData.children[0].label = original;
  let next; do { next = iterator.next(); } while (!next.done);
  assert(!next.value.categories.has('not part of this request'));
  assert.deepEqual(workerResult(next.value).schedule, buildReplayPlaqueSchedule(input));
});

for (const callback of ['measureCategoryText', 'measurePlaqueText']) {
  test('a ' + callback + ' callback cannot silently change the dispatched input', () => {
    const input = inputFor(), original = input[callback];
    input[callback] = (...args) => { input.width = 1000; return original(...args); };
    assert.throws(() => capture(input), /input changed during measurement/);
    assert.deepEqual(getCoherentWorkspaceDiagnostics(input.steps), []);
  });
}

test('cancelled measurement never plans or returns a partial worker job', () => {
  const input = inputFor(), iterator = measurePlaqueLayoutJob(input);
  assert.equal(iterator.next().done, false);
  assert.deepEqual(iterator.return(undefined), { value: undefined, done: true });
  assert.deepEqual(iterator.next(), { value: undefined, done: true });
  assert.deepEqual(getCoherentWorkspaceDiagnostics(input.steps), []);
});

test('prepared camera coordinates must cover its Replay stage', () => {
  const input = inputFor();
  assert.throws(() => buildStageCameraBounds({ ...input, coordinates: new Map(), plaqueSchedule: { stages: [], steps: new Map() } }), /Missing prepared Replay coordinates/);
  assert.deepEqual(getCoherentWorkspaceDiagnostics(input.steps), []);
});

for (const empty of [false, true]) test('a prepared stage has its final plaques, coordinates and camera: empty ' + empty, () => {
  const input = inputFor();
  if (empty) input.plan.frames[0].items = [];
  const job = capture(input); job.progressStage = 0;
  const messages = [];
  const result = runPlaqueLayoutJob(job, progress => messages.push(structuredClone(progress)));
  assert.equal(messages.length, 1);
  const progress = messages[0], layout = bindPlaqueLayoutProgress(input, job, progress);
  const complete = completePlaqueLayoutResult(input, job, result, { progress, layout });
  assert.deepEqual(progress.preparedStages, [0]);
  assert.deepEqual(progress.coordinates, result.coordinates);
  assert.deepEqual(layout.schedule.stages[0], result.schedule.stages[0]);
  assert.deepEqual(layout.schedule.steps.get(0), result.schedule.steps.get(0));
  assert.equal(layout.schedule.steps.has(1), false, 'later plaques have not been delivered yet');
  assert.deepEqual(buildStageCameraBounds({ ...input, plaqueSchedule: layout.schedule, coordinates: layout.coordinates }),
    buildStageCameraBounds({ ...input, plaqueSchedule: complete.schedule, coordinates: complete.coordinates }));
  assert.equal(complete.coordinates, layout.coordinates, 'completion preserves canvas and coordinate identities');
  assert.equal(complete.schedule.stages[0], layout.schedule.stages[0]);
  assert.equal(complete.schedule.steps.get(0), layout.schedule.steps.get(0));
  assert.deepEqual(complete.schedule, buildReplayPlaqueSchedule(input));
});

test('a shared camera waits for every member stage, including a later plaque', () => {
  const input = inputFor(); input.layoutGroups = [[0, 1]];
  input.plan.frames[0].items = [];
  const job = capture(input); job.progressStage = 0;
  let progress;
  const result = runPlaqueLayoutJob(job, value => { assert.equal(progress, undefined); progress = structuredClone(value); });
  assert.deepEqual(progress.preparedStages, [0, 1]);
  assert.deepEqual(progress.schedule, result.schedule);
  assert(progress.schedule.stages[1].size > 0);
});

test('ordinary jobs do not emit progress without a requested stage', () => {
  runPlaqueLayoutJob(capture(inputFor()), () => assert.fail('unexpected stage publication'));
});

for (const [name, mutate] of [
  ['missing stage plaques', progress => { progress.schedule.stages[0] = undefined; }],
  ['missing step plaques', progress => { progress.schedule.steps.delete(0); }],
  ['duplicate stage', progress => { progress.preparedStages.push(0); }],
  ['unknown stage', progress => { progress.preparedStages.push(99); }]
]) test('incomplete progress is rejected: ' + name, () => {
  const input = inputFor(), job = capture(input); job.progressStage = 0;
  let progress; runPlaqueLayoutJob(job, value => { progress = structuredClone(value); });
  mutate(progress);
  assert.throws(() => bindPlaqueLayoutProgress(input, job, progress), /Incomplete prepared Replay stage progress/);
});

for (const [name, mutate] of [
  ['coordinate', result => { result.coordinates.get(0).values().next().value.get('v').x += 1; }],
  ['stage plaque', result => { result.schedule.stages[0].clear(); }],
  ['step plaque', result => { result.schedule.steps.set(0, new Map()); }]
]) test('completion cannot revise an already displayed ' + name, () => {
  const input = inputFor(), job = capture(input); job.progressStage = 0;
  let progress;
  const result = structuredClone(runPlaqueLayoutJob(job, value => { progress = structuredClone(value); }));
  const layout = bindPlaqueLayoutProgress(input, job, progress);
  mutate(result);
  assert.throws(() => completePlaqueLayoutResult(input, job, result, { progress, layout }), /changed a prepared stage/);
});
