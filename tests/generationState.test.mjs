import assert from 'node:assert/strict';
import test from 'node:test';
import { ParseServiceError } from '../services/parseService.ts';
import { generationReducer, initialGenerationState, resolveGenerationError, runGeneration } from '../services/generationState.ts';

const request = {
  sentence: '  The farmer eats the pig.  ',
  framework: 'xbar',
  modelId: 'openai:gpt-6.1-sol',
  settings: { reasoningEffort: 'high' }
};
const observedState = initial => {
  const observed = { state: initial ?? initialGenerationState, actions: [] };
  observed.dispatch = action => {
    observed.actions.push(action.type);
    observed.state = generationReducer(observed.state, action);
  };
  return observed;
};

test('generation keeps the request unchanged and accepts only after the response completes', async () => {
  const observed = observedState({ loading: false, error: { message: 'old failure' }, needsKey: true });
  const bundle = { analyses: [{ analysisId: 'one' }, { analysisId: 'two' }] };
  const previous = { analyses: [{ analysisId: 'saved' }] };
  let current = previous;
  let resolve;
  let calls = 0;
  const pending = runGeneration(request, observed.dispatch, result => { current = result; }, (...args) => {
    calls++;
    assert.deepEqual(args, [request.sentence, request.framework, request.modelId, request.settings]);
    return new Promise(done => { resolve = done; });
  });
  assert.equal(observed.state.loading, true);
  assert.equal(observed.state.error, null);
  assert.equal(current, previous, 'starting a request must leave the current analysis available');
  resolve(bundle);
  await pending;
  assert.equal(calls, 1);
  assert.equal(current, bundle, 'accept all returned analyses without rewriting the bundle');
  assert.deepEqual(observed.actions, ['started', 'accepted', 'finished']);
  assert.deepEqual(observed.state, initialGenerationState);
});

test('generation failures preserve every evidence carrier and never accept or retry', async () => {
  const evidence = {
    failure: { code: 'DERIVATION_INVALID', detail: 'Original diagnostic' },
    rawOutput: { text: '{ original authored output }' },
    generationRecord: { id: 'generation-record-1' }
  };
  const failure = new ParseServiceError({ code: 'INVALID_RESPONSE', message: 'The response was rejected.', ...evidence });
  const observed = observedState();
  let calls = 0;
  let accepted = false;
  await runGeneration(request, observed.dispatch, () => { accepted = true; }, async () => {
    calls++;
    throw failure;
  });
  assert.equal(calls, 1);
  assert.equal(accepted, false);
  assert.deepEqual(observed.actions, ['started', 'failed', 'finished']);
  assert.equal(observed.state.loading, false);
  assert.equal(observed.state.needsKey, false);
  assert.equal(observed.state.error.message, failure.message);
  assert.deepEqual(observed.state.error.request, { sentence: request.sentence, framework: request.framework });
  for (const key of Object.keys(evidence)) assert.equal(observed.state.error[key], evidence[key]);
});

test('failure inspection retains the submitted sentence after the input changes', async () => {
  const submitted = { ...request };
  const observed = observedState();
  let reject;
  const pending = runGeneration(submitted, observed.dispatch, () => assert.fail('unexpected acceptance'),
    () => new Promise((_resolve, fail) => { reject = fail; }));
  submitted.sentence = 'A later edit.';
  reject(new Error('Rejected output'));
  await pending;
  assert.equal(observed.state.error.request.sentence, request.sentence);
});

test('provider key failures retain their evidence while displaying the existing key guidance', () => {
  for (const code of ['API_KEY_EXPIRED', 'API_KEY_MISSING', 'API_KEY_INVALID']) {
    const failure = new ParseServiceError({ code, message: 'Provider detail', rawOutput: { text: 'original' } });
    const resolved = resolveGenerationError(failure);
    assert.equal(resolved.needsKey, true);
    assert.equal(resolved.error.code, code);
    assert.equal(resolved.error.rawOutput, failure.rawOutput);
    assert.equal(resolved.error.message, 'The selected provider API key is missing or invalid on the server.');
  }
  assert.equal(resolveGenerationError(new Error('API_KEY_MISSING')).needsKey, true);
  assert.deepEqual(resolveGenerationError(null), { needsKey: false, error: { message: 'Derivation interrupted.' } });
});

test('an acceptance error still releases the loading state', async () => {
  const observed = observedState();
  await runGeneration(request, observed.dispatch, () => { throw new Error('Workspace unavailable'); }, async () => ({ analyses: [] }));
  assert.equal(observed.state.loading, false);
  assert.equal(observed.state.error.message, 'Workspace unavailable');
  assert.deepEqual(observed.actions, ['started', 'failed', 'finished']);
});

test('dismissal, provider selection and external restoration retain their distinct reset behavior', () => {
  const failed = { loading: true, error: { message: 'key missing' }, needsKey: true };
  const dismissed = generationReducer(failed, { type: 'clear-error' });
  assert.deepEqual(dismissed, { loading: true, error: null, needsKey: true });
  assert.deepEqual(generationReducer(failed, { type: 'clear-failure' }), { loading: true, error: null, needsKey: false });
  assert.deepEqual(generationReducer(failed, { type: 'reset' }), initialGenerationState);
  const previewError = { message: 'Unable to load preview bundle: HTTP 404' };
  assert.deepEqual(generationReducer(failed, { type: 'report-error', error: previewError }), { ...failed, error: previewError });
  assert.deepEqual(failed, { loading: true, error: { message: 'key missing' }, needsKey: true }, 'state transitions must not mutate prior state');
});
