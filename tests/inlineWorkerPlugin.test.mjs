import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { build } from 'esbuild';
import { inlineWorkerPlugin } from '../scripts/inlineWorkerPlugin.mjs';

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'babel-inline-worker-'));
let source;
try {
  await fs.writeFile(path.join(fixture, 'entry.ts'),
    "globalThis.spawn = () => new Worker(new URL('./job.worker.ts', import.meta.url), { type: 'module' });");
  await fs.writeFile(path.join(fixture, 'job.worker.ts'), 'postMessage({ ready: true });');
  const result = await build({ absWorkingDir: fixture, entryPoints: ['entry.ts'],
    bundle: true, write: false, format: 'iife', plugins: [inlineWorkerPlugin()] });
  source = result.outputFiles[0].text;
} finally {
  await fs.rm(fixture, { recursive: true, force: true });
}

function environment({ rejectConstruction = false } = {}) {
  const urls = new Map(), revoked = [], workers = [], cancelledWithLiveUrl = [];
  let serial = 0;
  class DeferredWorker {
    constructor(url) {
      if (rejectConstruction) throw new Error('Worker unavailable');
      this.url = url;
      this.listeners = new Map();
      this.terminated = false;
      workers.push(this);
    }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    dispatch(type) { this.listeners.get(type)?.(); }
    terminate() {
      if (!this.result && urls.has(this.url)) cancelledWithLiveUrl.push(this.url);
      this.terminated = true;
    }
    async load() {
      // Model engines which fetch the Blob after the constructor has returned.
      await Promise.resolve();
      if (this.terminated) return;
      const blob = urls.get(this.url);
      assert.ok(blob, 'The worker URL was revoked before its script loaded');
      vm.runInNewContext(await blob.text(), { postMessage: value => {
        this.result = value;
        this.dispatch('message');
      } });
    }
  }
  const context = vm.createContext({ Blob, Worker: DeferredWorker, URL: {
    createObjectURL(blob) { const url = `blob:fixture-${++serial}`; urls.set(url, blob); return url; },
    revokeObjectURL(url) { revoked.push(url); urls.delete(url); }
  } });
  vm.runInContext(source, context);
  return { spawn: context.spawn, urls, revoked, workers, cancelledWithLiveUrl };
}

test('a deferred Blob worker loads and releases its URL after responding', async () => {
  const env = environment(), worker = env.spawn();
  assert.equal(env.urls.size, 1);
  await worker.load();
  assert.equal(worker.result.ready, true);
  assert.equal(env.urls.size, 0);
  worker.terminate();
  assert.equal(worker.terminated, true);
  assert.deepEqual(env.revoked, [worker.url]);
});

test('cancelling before script loading releases only the cancelled worker URL', async () => {
  const env = environment(), cancelled = env.spawn(), active = env.spawn();
  cancelled.terminate();
  assert.deepEqual(env.cancelledWithLiveUrl, [cancelled.url]);
  await cancelled.load();
  assert.equal(env.urls.has(active.url), true);
  await active.load();
  assert.equal(active.result.ready, true);
  assert.deepEqual(env.revoked, [cancelled.url, active.url]);
});

for (const type of ['error', 'messageerror']) test(`${type} and later cancellation release the URL once`, () => {
  const env = environment(), worker = env.spawn();
  worker.dispatch(type);
  worker.terminate();
  assert.equal(env.urls.size, 0);
  assert.deepEqual(env.revoked, [worker.url]);
});

test('constructor failure releases its allocated URL', () => {
  const env = environment({ rejectConstruction: true });
  assert.throws(() => env.spawn(), /Worker unavailable/);
  assert.equal(env.urls.size, 0);
  assert.deepEqual(env.revoked, ['blob:fixture-1']);
});
