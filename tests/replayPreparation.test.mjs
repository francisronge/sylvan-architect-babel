import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { startReplayPreparation } from '../replay/replayWorkerClient.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import {
  applyPreFrontingSentenceInitialCasing,
  buildResolvedLinkTraceIndexMap,
  decoratePlaybackStepsWithTraceIndices,
  hidePendingInflSpecifierWrappersInStep
} from '../replay/replayCompiler.ts';

const saved = JSON.parse(readFileSync(new URL('../fixtures/movement/saved-qualification.json', import.meta.url)));
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
};

test('worker preparation preserves all archived frames, decorations and render plans', async () => {
  const worker = new Worker(new URL('./support/replayWorkerBridge.mjs', import.meta.url));
  try {
    let frames = 0;
    for (const { derivationStages } of saved) {
      const input = freeze({ derivationStages, sentence: 'Which book did John buy?', includePlayback: true });
      const original = structuredClone(input);
      const prepared = prepareReplay(input);
      const finalForest = derivationStages.at(-1).workspaceForest;
      const legacySteps = buildReplayPlayback({ sentence: input.sentence, analyses: [{ derivationStages }] }).steps;
      const legacyDecorated = applyPreFrontingSentenceInitialCasing(decoratePlaybackStepsWithTraceIndices(
        legacySteps.map(hidePendingInflSpecifierWrappersInStep),
        buildResolvedLinkTraceIndexMap(finalForest, prepared.movementChainIndexCatalogue.links,
          Number.MAX_SAFE_INTEGER, prepared.movementChainIndexCatalogue)
      ), input.sentence);
      assert.deepEqual(prepared.playbackSteps, legacyDecorated);
      const reply = once(worker, 'message');
      worker.postMessage(input);
      const [message] = await reply;
      assert.deepEqual(message, { result: prepared }, 'worker transport must preserve the entire compiled result');
      assert.deepEqual(input, original);
      frames += prepared.playbackSteps.length;
    }
    assert.equal(frames, 137);
  } finally {
    await worker.terminate();
  }
});

test('Canopy preparation keeps its plan without preparing playback, and empty input stays empty', () => {
  const input = { derivationStages: saved[0].derivationStages, sentence: 'Which book did John buy?' };
  const canopy = prepareReplay({ ...input, includePlayback: false });
  const replay = prepareReplay({ ...input, includePlayback: true });
  assert.deepEqual(canopy, { ...replay, playbackSteps: [] });
  assert.deepEqual(prepareReplay({ sentence: '', includePlayback: true }), {
    replayDerivationFrames: [], derivationReplayPlan: null, relationRenderPlan: null,
    committedDerivationVisualLinks: [],
    movementChainIndexCatalogue: { forest: [], links: [], authoredIndicesByNodeId: new Map() }, playbackSteps: []
  });
});

const fakeWorker = () => ({
  onmessage: null, onerror: null, onmessageerror: null, sent: [], terminated: 0,
  postMessage(input) { this.sent.push(structuredClone(input)); },
  terminate() { this.terminated++; }
});
const job = (worker = fakeWorker(), create = () => worker) => {
  const ready = [], errors = [];
  const input = { derivationStages: [], sentence: '', includePlayback: true };
  const cancel = startReplayPreparation(input, result => ready.push(result), error => errors.push(error), create);
  return { worker, ready, errors, input, cancel };
};

test('a preparation completes once and releases its worker', () => {
  const { worker, ready, errors, input, cancel } = job();
  assert.deepEqual(worker.sent, [input]);
  const handler = worker.onmessage;
  const result = prepareReplay(input);
  handler({ data: { result } });
  handler({ data: { result } });
  cancel();
  assert.deepEqual(ready, [result]);
  assert.deepEqual(errors, []);
  assert.equal(worker.terminated, 1);
  assert.equal(worker.onmessage, null);
});

test('cancelling a superseded preparation rejects late results and errors', () => {
  const old = job(), next = job();
  const message = old.worker.onmessage, failure = old.worker.onerror;
  old.cancel();
  message({ data: { result: prepareReplay(old.input) } });
  failure({ message: 'late', preventDefault() {} });
  next.worker.onmessage({ data: { result: prepareReplay(next.input) } });
  assert.equal(old.ready.length, 0);
  assert.equal(old.errors.length, 0);
  assert.equal(old.worker.terminated, 1);
  assert.equal(next.ready.length, 1);
  assert.equal(next.worker.terminated, 1);
});

for (const failure of ['startup', 'post', 'compile', 'runtime', 'decode', 'missing result']) {
  test(`worker ${failure} failure is reported once and can be retried`, () => {
    const worker = fakeWorker();
    if (failure === 'post') worker.postMessage = () => { throw new Error('cannot clone'); };
    const state = job(worker, () => {
      if (failure === 'startup') throw new Error('cannot start');
      return worker;
    });
    if (failure === 'compile') worker.onmessage({ data: { error: 'compile failed' } });
    if (failure === 'runtime') worker.onerror({ message: 'runtime failed', preventDefault() {} });
    if (failure === 'decode') worker.onmessageerror({});
    if (failure === 'missing result') worker.onmessage({ data: {} });
    state.cancel();
    assert.equal(state.errors.length, 1);
    assert.equal(state.ready.length, 0);
    assert.equal(worker.terminated, failure === 'startup' ? 0 : 1);
    const retry = job();
    retry.worker.onmessage({ data: { result: prepareReplay(retry.input) } });
    assert.equal(retry.ready.length, 1);
    assert.equal(retry.errors.length, 0);
  });
}
