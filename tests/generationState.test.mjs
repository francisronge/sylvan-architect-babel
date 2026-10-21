import assert from 'node:assert/strict';
import test from 'node:test';
import { ParseServiceError } from '../services/parseService.ts';
import { generationReducer, initialGenerationState, resolveGenerationError, runGeneration, submittedGenerationRequest } from '../services/generationState.ts';
import { prepareTreeBankSave } from '../services/treeBankRecords.ts';
import { parseFromBodyWithProviders } from '../server/parseApi.js';

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
    generationRecord: { id: 'generation-record-1' },
    inputTokens: ['花子', 'は', '開', 'け']
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

test('opening saved work and external restoration retain their distinct reset behavior', () => {
  const failed = { loading: true, error: { message: 'key missing' }, needsKey: true };
  assert.deepEqual(generationReducer(failed, { type: 'clear-failure' }), { loading: true, error: null, needsKey: false });
  assert.deepEqual(generationReducer(failed, { type: 'reset' }), initialGenerationState);
  const previewError = { message: 'Unable to load preview bundle: HTTP 404' };
  assert.deepEqual(generationReducer(failed, { type: 'report-error', error: previewError }), { ...failed, error: previewError });
  assert.deepEqual(failed, { loading: true, error: { message: 'key missing' }, needsKey: true }, 'state transitions must not mutate prior state');
});

test('a padded draft sends its trimmed sentence, so the echoed bundle saves under the sentence the workspace shows', async () => {
  const options = { framework: 'xbar', modelId: 'openai:gpt-6.1-sol', settings: { reasoningEffort: 'high' } };
  assert.equal(submittedGenerationRequest(' \n\t ', options), null, 'a blank draft makes no request');
  const analysis = { derivationStages: [{ statement: 's', stageRecord: 'r', relations: [],
    workspaceForest: [{ id: 'n1', label: 'V', word: 'laughed' }] }] };
  // The server echoes exactly the sentence it received.
  const server = sentence => parseFromBodyWithProviders({ sentence, framework: 'xbar', modelRoute: 'gemini' },
    { gemini: async () => ({ analyses: [analysis], ambiguityDetected: false }) });
  const save = (sentence, bundle) => {
    const now = new Date().toISOString();
    return prepareTreeBankSave({ id: 'work', sentence, framework: 'xbar', activeParseIndex: 0, bundle, createdAt: now, updatedAt: now });
  };
  const draft = '  Mia laughed. \n';
  const submitted = submittedGenerationRequest(draft, options);
  assert.deepEqual(submitted, { ...options, sentence: 'Mia laughed.' });
  let accepted;
  await runGeneration(submitted, observedState().dispatch, bundle => { accepted = bundle; }, sentence => server(sentence));
  assert.equal(accepted.sentence, submitted.sentence);
  await save(submitted.sentence, accepted);
  // The historical defect: the untrimmed draft was sent while the trimmed one was saved.
  await assert.rejects(save(draft.trim(), await server(draft)), /Sentence mismatch/);
});

test('a response that cannot be displayed fails its generation and keeps its raw output', async () => {
  const bundle = {
    sentence: request.sentence, ambiguityDetected: false, inputTokens: ['The', 'farmer'],
    analyses: [{ tree: { id: 'r', label: 'NP', children: [null] }, derivationStages: [] }],
    rawModelOutput: { text: '{ original authored output }' }, generationRecord: { id: 'generation-record-2' }
  };
  const observed = observedState();
  let accepted = false;
  await runGeneration(request, observed.dispatch, () => { accepted = true; }, async () => bundle);
  assert.equal(accepted, false, 'the workspace keeps its previous analysis');
  assert.deepEqual(observed.actions, ['started', 'failed', 'finished']);
  assert.equal(observed.state.loading, false);
  assert.equal(observed.state.error.code, 'ANALYSIS_NOT_DISPLAYABLE');
  assert.match(observed.state.error.message, /^Analysis 1 cannot be displayed: /);
  assert.equal(observed.state.error.rawOutput, bundle.rawModelOutput);
  assert.equal(observed.state.error.generationRecord, bundle.generationRecord);
  assert.equal(observed.state.error.inputTokens, bundle.inputTokens);
  assert.deepEqual(observed.state.error.request, { sentence: request.sentence, framework: request.framework });
});
