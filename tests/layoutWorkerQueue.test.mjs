import assert from 'node:assert/strict';
import test from 'node:test';
import { createLayoutWorkerQueue } from '../replay/layoutWorkerQueue.ts';

function harness() {
  const enqueue = createLayoutWorkerQueue(), workers = [], ready = [], errors = [];
  const add = (name, failure) => {
    const create = () => {
      if (failure === 'construct') throw Error(name);
      const worker = { onmessage: null, onerror: null, onmessageerror: null, terminated: 0,
        postMessage(input) {
          this.input = input;
          if (failure === 'post') throw Error(name);
          if (failure === 'sync-error') this.onmessage({ data: { error: name } });
          if (failure === 'sync-result') this.onmessage({ data: { result: name } });
        },
        terminate() { this.terminated++; }
      };
      workers.push(worker); return worker;
    };
    return enqueue({ name }, result => ready.push(result), error => errors.push(error.message), create);
  };
  return { add, workers, ready, errors };
}

test('one worker runs at a time and queued cancellation never constructs a worker', () => {
  const app = harness();
  const stopA = app.add('a'), stopB = app.add('b'), stopC = app.add('c');
  assert.equal(app.workers.length, 1);
  stopB(); stopB();
  app.workers[0].onmessage({ data: { result: 'a' } });
  assert.equal(app.workers[0].terminated, 1);
  assert.equal(app.workers.length, 2);
  assert.equal(app.workers[1].input.name, 'c');
  app.workers[1].onmessage({ data: { result: 'c' } });
  assert.deepEqual(app.ready, ['a', 'c']);
  stopA(); stopC();
  assert(app.workers.every(worker => worker.terminated === 1));
});

test('active cancellation terminates before starting the next request and ignores late callbacks', () => {
  const app = harness(), stop = app.add('old');
  const old = app.workers[0], lateResult = old.onmessage, lateError = old.onerror;
  app.add('new');
  stop();
  assert.equal(old.terminated, 1);
  assert.equal(app.workers[1].input.name, 'new');
  lateResult({ data: { result: 'stale' } });
  lateError({ message: 'stale failure', preventDefault() {} });
  assert.deepEqual(app.ready, []); assert.deepEqual(app.errors, []);
  app.workers[1].onmessage({ data: { result: 'new' } });
  assert.deepEqual(app.ready, ['new']);
});

for (const failure of ['construct', 'post', 'sync-error', 'sync-result']) {
  test('synchronous ' + failure + ' completion releases exactly one slot', () => {
    const app = harness();
    app.add('hold');
    const stopFailed = app.add('finish', failure);
    app.add('next');
    app.workers[0].onmessage({ data: { result: 'hold' } });
    const next = app.workers.at(-1);
    assert.equal(next.input.name, 'next');
    assert.equal(next.terminated, 0);
    stopFailed();
    assert.equal(next.terminated, 0, 'disposing a completed request cannot release the next slot');
    next.onmessage({ data: { result: 'next' } });
    assert.deepEqual(app.errors, failure === 'sync-result' ? [] : ['finish']);
    assert(app.workers.every(worker => worker.terminated === 1));
  });
}

test('decode failure releases its worker and permits a retry after pending work', () => {
  const app = harness();
  app.add('bad'); app.add('other');
  app.workers[0].onmessageerror({});
  assert.equal(app.workers[0].terminated, 1);
  const stopRetry = app.add('retry');
  assert.equal(app.workers.length, 2);
  app.workers[1].onmessage({ data: { result: 'other' } });
  assert.equal(app.workers[2].input.name, 'retry');
  stopRetry(); assert.equal(app.workers[2].terminated, 1);
  assert.equal(app.errors.length, 1);
});


test('prepared stage progress keeps the worker slot until completion and cancellation ignores late progress', () => {
  const enqueue = createLayoutWorkerQueue(), workers = [], progress = [], ready = [], errors = [];
  const create = () => {
    const worker = { onmessage: null, onerror: null, onmessageerror: null, postMessage() {},
      terminated: 0, terminate() { this.terminated++; } };
    workers.push(worker); return worker;
  };
  const stop = enqueue('first', value => ready.push(value), error => errors.push(error.message), create, value => progress.push(value));
  enqueue('second', value => ready.push(value), error => errors.push(error.message), create, value => progress.push(value));
  const late = workers[0].onmessage;
  late({ data: { progress: 'stage zero' } });
  assert.deepEqual(progress, ['stage zero']);
  assert.equal(workers.length, 1);
  assert.equal(workers[0].terminated, 0);
  stop();
  assert.equal(workers[0].terminated, 1);
  assert.equal(workers.length, 2);
  late({ data: { progress: 'stale' } }); late({ data: { result: 'stale' } });
  workers[1].onmessage({ data: { progress: 'next stage' } });
  workers[1].onmessage({ data: { result: 'finished' } });
  assert.deepEqual(progress, ['stage zero', 'next stage']);
  assert.deepEqual(ready, ['finished']);
  assert.deepEqual(errors, []);
  assert.equal(workers[1].terminated, 1);
});

test('a rejected stage message terminates its worker and reports the error', () => {
  const enqueue = createLayoutWorkerQueue(), errors = [];
  const worker = { onmessage: null, onerror: null, onmessageerror: null, postMessage() {},
    terminated: 0, terminate() { this.terminated++; } };
  enqueue({}, () => assert.fail('unexpected completion'), error => errors.push(error.message), () => worker,
    () => { throw Error('stage was incomplete'); });
  worker.onmessage({ data: { progress: {} } });
  assert.equal(worker.terminated, 1);
  assert.deepEqual(errors, ['stage was incomplete']);
});

test('cold input preparation initializes one serial worker and cancellation suppresses the deferred post', async () => {
  const enqueue = createLayoutWorkerQueue(), workers = [];
  const create = () => {
    const worker = { onmessage: null, onerror: null, onmessageerror: null, posts: [], terminated: 0,
      postMessage(input) { this.posts.push(input); }, terminate() { this.terminated++; } };
    workers.push(worker); return worker;
  };
  let readyA, readyB;
  const a = new Promise(resolve => { readyA = resolve; });
  const b = new Promise(resolve => { readyB = resolve; });
  const stop = enqueue(a, () => assert.fail('cancelled result'), () => assert.fail('unexpected failure'), create);
  enqueue(b, () => {}, () => assert.fail('unexpected failure'), create);
  assert.equal(workers.length, 1); assert.deepEqual(workers[0].posts, []);
  stop(); assert.equal(workers[0].terminated, 1); assert.equal(workers.length, 2);
  readyA('old'); readyB('new'); await Promise.resolve();
  assert.deepEqual(workers[0].posts, []); assert.deepEqual(workers[1].posts, ['new']);
  workers[1].onmessage({ data: { result: 'finished' } });
  assert(workers.every(worker => worker.terminated === 1));
});

test('rejected deferred input releases the slot exactly once and a queued rejection stays handled', async () => {
  const enqueue = createLayoutWorkerQueue(), workers = [], errors = [];
  const create = () => {
    const worker = { onmessage: null, onerror: null, onmessageerror: null, terminated: 0,
      postMessage() {}, terminate() { this.terminated++; } }; workers.push(worker); return worker;
  };
  let rejectA, rejectB;
  const a = new Promise((_resolve, reject) => { rejectA = reject; });
  const b = new Promise((_resolve, reject) => { rejectB = reject; });
  enqueue(a, () => assert.fail('unexpected result'), error => errors.push(error.message), create);
  enqueue(b, () => assert.fail('unexpected result'), error => errors.push(error.message), create);
  rejectB(Error('queued measurements')); await Promise.resolve();
  assert.equal(workers.length, 1);
  rejectA(Error('active measurements')); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(errors, ['active measurements', 'queued measurements']);
  assert.equal(workers.length, 2); assert(workers.every(worker => worker.terminated === 1));
});
