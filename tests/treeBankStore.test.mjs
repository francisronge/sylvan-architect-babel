import assert from 'node:assert/strict';
import test from 'node:test';
import { completeTreeBankRequest } from '../services/treeBankStore.ts';

function database() {
  const request = { result: 'saved-id' };
  const tx = { objectStore: () => ({ put: () => request }) };
  let closed = false;
  const db = { transaction: () => tx, close: () => { closed = true; } };
  return { db, tx, request, closed: () => closed };
}

test('Tree Bank waits for commit after a successful write request', async () => {
  const state = database();
  let resolved = false;
  const promise = completeTreeBankRequest(state.db, 'readwrite', store => store.put({ id: 'one' }));
  promise.then(() => { resolved = true; });
  state.request.onsuccess();
  await Promise.resolve();
  assert.equal(resolved, false);
  state.tx.oncomplete();
  assert.equal(await promise, 'saved-id');
  assert.equal(state.closed(), true);
});

test('Tree Bank rejects a transaction aborted after request success', async () => {
  const state = database();
  const promise = completeTreeBankRequest(state.db, 'readwrite', store => store.put({ id: 'one' }));
  state.request.onsuccess();
  state.tx.onabort();
  await assert.rejects(promise, /transaction aborted/);
  assert.equal(state.closed(), true);
});

test('Tree Bank preserves storage errors and closes after abort', async () => {
  const state = database();
  const promise = completeTreeBankRequest(state.db, 'readwrite', store => store.put({ id: 'one' }));
  state.request.error = new Error('Quota exceeded');
  state.request.onerror();
  state.tx.onabort();
  await assert.rejects(promise, /Quota exceeded/);
  assert.equal(state.closed(), true);
});

test('Tree Bank closes when starting the operation throws', async () => {
  const state = database();
  await assert.rejects(completeTreeBankRequest(state.db, 'readwrite', () => { throw new Error('DataCloneError'); }), /DataCloneError/);
  assert.equal(state.closed(), true);
});
