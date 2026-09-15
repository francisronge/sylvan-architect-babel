import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseFromBody, validateParseBody, formatApiError } from '../server/parseApi.js';
import { GENERATION_MODEL_IDS, getResearchModel } from '../server/babelParser/researchModelCatalog.js';
import { sha256Hex } from '../server/babelParser/generationRecord.js';
import { buildSystemInstruction } from '../server/babelParser/systemInstruction.js';
import { buildParseContentsPrompt } from '../server/babelParser/prompts.js';
import { runQualificationAttempt } from '../contractQualification/run.js';
import { buildReplaySnapshotProjection } from '../replay/replaySnapshot.ts';
import { buildQualificationAnalysisEvidence } from '../contractQualification/review.js';
import { createTreeBankBundleSnapshot, loadTreeBankBundleSnapshot } from '../treeBankSnapshot.js';
import { parseSentence, ParseServiceError } from '../services/parseService.ts';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/raw/what-did-mia-see.xbar.json', import.meta.url), 'utf8'));
const rawOutput = JSON.stringify(fixture.payload);
const decode = (artifact) => Buffer.from(artifact.data, 'base64').toString('utf8');
const providers = {
  openai: { endpoint: 'https://api.openai.com/v1/responses', key: 'OPENAI_API_KEY' },
  anthropic: { endpoint: 'https://api.anthropic.com/v1/messages', key: 'ANTHROPIC_API_KEY' },
  moonshot: { endpoint: 'https://api.moonshot.ai/v1/chat/completions', key: 'MOONSHOT_API_KEY' },
  xai: { endpoint: 'https://api.x.ai/v1/responses', key: 'XAI_API_KEY' }
};

const isolate = (t) => {
  for (const [key, value] of Object.entries({
    NODE_ENV: 'production', BABEL_SAVE_PROVIDER_RAW: '0',
    ...Object.fromEntries(Object.values(providers).map(({ key }) => [key, 'test-only-provider-key']))
  })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
};

const envelopeFor = (model, text = rawOutput) => {
  if (model.provider === 'anthropic') return {
    model: model.providerModel, stop_reason: 'end_turn',
    content: [{ type: 'thinking', thinking: 'not Babel JSON' }, { type: 'text', text }],
    usage: { input_tokens: 11, output_tokens: 22 }
  };
  if (model.provider === 'moonshot') return {
    model: model.providerModel,
    choices: [{ finish_reason: 'stop', message: { content: text, reasoning_content: 'not Babel JSON' } }],
    usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 }
  };
  return {
    id: 'response_test', model: model.providerModel, status: 'completed',
    output: [{ type: 'reasoning', summary: [{ type: 'summary_text', text: 'not Babel JSON' }] },
      { type: 'message', content: [{ type: 'output_text', text }] }],
    usage: { input_tokens: 11, output_tokens: 22, total_tokens: 33 }
  };
};

for (const modelId of GENERATION_MODEL_IDS) {
  test(`${modelId}: API dispatch, native settings, normalization, Replay, and saved evidence`, async (t) => {
    isolate(t);
    const model = getResearchModel(modelId);
    let calls = 0;
    let sentBody;
    const responseText = JSON.stringify(envelopeFor(model));
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      calls += 1;
      assert.equal(url, providers[model.provider].endpoint);
      assert.equal(options.method, 'POST');
      assert.ok(options.signal instanceof AbortSignal);
      const credential = options.headers.Authorization || options.headers['x-api-key'];
      assert.ok(credential.endsWith('test-only-provider-key'));
      sentBody = JSON.parse(options.body);
      return new Response(responseText, { status: 200 });
    });

    for (const effort of model.controls[0].values) {
      const before = calls;
      const settings = { [model.controls[0].id]: effort };
      const bundle = await parseFromBody({ sentence: fixture.sentence, framework: fixture.framework, modelId, settings });
      assert.equal(calls, before + 1);
      assert.equal(sentBody.model, model.providerModel);
      assert.equal(sentBody.reasoning?.effort || sentBody.output_config?.effort || sentBody.reasoning_effort, effort);
      assert.equal(sentBody.temperature, undefined);
      assert.equal(sentBody.top_p, undefined);
      if (model.provider === 'anthropic') {
        assert.deepEqual(sentBody.thinking, model.requestPolicy.thinking.value);
        assert.equal(sentBody.max_tokens, 128000);
      } else if (model.provider === 'moonshot') {
        assert.equal(sentBody.max_completion_tokens, 131072);
        assert.equal(sentBody.response_format, undefined);
      } else {
        assert.equal(sentBody.text, undefined);
        assert.equal(sentBody.store, model.provider === 'openai');
        assert.equal(Boolean(sentBody.background), model.provider === 'openai');
      }
      assert.equal(bundle.requestedModelId, modelId);
      assert.equal(bundle.modelUsed, model.providerModel);
      assert.equal(bundle.generationRecord.returnedModel, model.providerModel);
      assert.deepEqual(bundle.generationRecord.modelSelection.nativeSettings, settings);
      assert.equal(bundle.generationRecord.sentRequestSha256, sha256Hex(JSON.stringify(sentBody)));
      const system = sentBody.instructions || sentBody.system || (sentBody.messages || sentBody.input)[0].content;
      const prompt = typeof sentBody.input === 'string' ? sentBody.input
        : (sentBody.messages || sentBody.input).find(({ role }) => role === 'user').content;
      assert.equal(bundle.generationRecord.promptContract.systemInstructionSha256, sha256Hex(system));
      assert.equal(bundle.generationRecord.promptContract.promptSha256, sha256Hex(prompt));
      assert.equal(system, buildSystemInstruction(fixture.framework));
      assert.equal(prompt, buildParseContentsPrompt(fixture.sentence));
      assert.equal(bundle.generationRecord.sentGenerationConfig.textFormatType, 'text');
      assert.deepEqual(bundle.generationRecord.processing.json.repairDiagnostics, []);
      assert.ok(bundle.generationRecord.processing.json.durationMs >= 0);
      assert.ok(bundle.generationRecord.processing.normalization.durationMs >= 0);
      assert.equal(decode(bundle.rawModelOutput), rawOutput);
      assert.equal(decode(bundle.generationRecord.rawProviderResponse), responseText);
      assert.doesNotMatch(JSON.stringify(bundle), /test-only-provider-key/);
      assert.ok(bundle.analyses[0].derivationStages.length > 0);
      const replay = buildReplaySnapshotProjection(bundle);
      assert.ok(replay.stepCount > 1);
      assert.deepEqual(buildQualificationAnalysisEvidence(bundle).renderer.tierCounts, { tier1: 2, tier2: 0, tier3: 0 });
      const restored = loadTreeBankBundleSnapshot(createTreeBankBundleSnapshot(bundle));
      assert.deepEqual(restored.generationRecord, bundle.generationRecord);
      assert.deepEqual(restored.rawModelOutput, bundle.rawModelOutput);
      assert.equal(restored.requestedModelId, modelId);
      assert.deepEqual(buildReplaySnapshotProjection(restored), replay);
    }
  });
}

test('all active model routes preserve realization groups and exact input through the public parser and saved Replay', async (t) => {
  isolate(t);
  const groups = [{ nodeIds: ['stem', 'ending'], tokenIndices: [0] }];
  const tree = { id: 'word', label: 'V', children: [
    { id: 'stem', label: 'Root', word: 'walk', children: [] },
    { id: 'ending', label: 'T', word: '-ed', children: [] }
  ] };
  const payload = { derivationStages: [{ statement: 'The past form is realized.',
    stageRecord: 'The stem and tense jointly realize walked.', relations: [{
      relation: 'Realization', anchors: { participants: ['stem', 'ending'] }, values: { form: 'walked' }
    }], workspaceForest: [tree], realizations: groups }] };
  const text = JSON.stringify(payload);
  for (const modelId of GENERATION_MODEL_IDS) {
    const model = getResearchModel(modelId);
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(envelopeFor(model, text)), { status: 200 }));
    for (const framework of ['xbar', 'minimalism']) {
      const bundle = await parseFromBody({ sentence: 'walked', framework, modelId });
      assert.deepEqual(bundle.analyses[0].derivationStages[0].realizations, groups);
      assert.equal(decode(bundle.rawModelOutput), text);
      assert.equal(bundle.generationRecord.promptContract.systemInstructionSha256, sha256Hex(buildSystemInstruction(framework)));
      assert.deepEqual(bundle.generationRecord.processing.json.repairDiagnostics, []);
      const restored = loadTreeBankBundleSnapshot(createTreeBankBundleSnapshot(bundle));
      const replay = buildReplaySnapshotProjection(restored);
      assert.equal(replay.sentence, 'walked');
      assert.deepEqual(replay.steps.at(-1).replayRealizations, groups);
      assert.deepEqual(restored.analyses[0].tree.children.map(node => node.word), ['walk', '-ed']);
    }
  }
});

test('invalid model selections and settings are rejected before any provider call', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network call'); });
  for (const selection of [
    { modelId: 'meta:muse-spark-1.2' }, { modelId: 'zai:glm-5.3-flash' },
    { modelId: 'unknown' }, { modelId: null },
    { modelId: 'moonshot:kimi-k3', settings: { reasoning_effort: 'medium' } },
    { modelId: 'openai:gpt-6-astra', settings: { 'reasoning.effort': 'none' } },
    { modelId: 'openai:gpt-6-astra', settings: { temperature: 0 } },
    { modelId: 'openai:gpt-6-astra', settings: [] },
    { modelId: 'openai:gpt-6-astra', modelRoute: 'claude' }
  ]) {
    await assert.rejects(() => parseFromBody({ sentence: fixture.sentence, ...selection }), { code: 'INVALID_REQUEST', status: 400 });
  }
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(validateParseBody({ sentence: fixture.sentence, modelId: 'moonshot:kimi-k3' }).settings, { reasoning_effort: 'high' });
});

test('repair diagnostics and original bytes survive the new generation path', async (t) => {
  isolate(t);
  const model = getResearchModel('moonshot:kimi-k3');
  const damagedOutput = rawOutput.slice(0, -1);
  const responseText = JSON.stringify(envelopeFor(model, damagedOutput));
  t.mock.method(globalThis, 'fetch', async () => new Response(responseText));
  const bundle = await parseFromBody({ sentence: fixture.sentence, modelId: model.id });
  assert.equal(decode(bundle.rawModelOutput), damagedOutput);
  assert.equal(decode(bundle.generationRecord.rawProviderResponse), responseText);
  assert.equal(bundle.analyses[0].provenance.payloadRepairDiagnostics[0].kind, 'append_closers_at_end_of_output');
  assert.deepEqual(bundle.generationRecord.processing.json.repairDiagnostics, bundle.analyses[0].provenance.payloadRepairDiagnostics);
  assert.equal(bundle.generationRecord.processing.json.diagnostic.originalByteOffset, Buffer.byteLength(damagedOutput));
});

test('all active routes keep malformed-stage evidence inspectable without replacing the generation', async (t) => {
  isolate(t);
  const payload = structuredClone(fixture.payload);
  payload.derivationStages[3].relations[1].values = ['literal content'];
  const damaged = JSON.stringify(payload).slice(0, -2);
  for (const modelId of GENERATION_MODEL_IDS) {
    const model = getResearchModel(modelId);
    const responseText = JSON.stringify(envelopeFor(model, damaged));
    const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(responseText));
    await assert.rejects(() => parseFromBody({ sentence: fixture.sentence, modelId }), error => {
      const result = formatApiError(error).body.error;
      const record = result.generationRecord;
      assert.equal(result.failure.fieldPath, '$.derivationStages[3].relations[1].values');
      assert.equal(result.failure.processingStep, 'stage-shape');
      assert.deepEqual(result.failure.offendingValue, ['literal content']);
      assert.equal(decode(result.rawOutput), damaged);
      assert.equal(decode(record.rawProviderResponse), responseText);
      assert.equal(record.outcome.attempts.length, 1);
      assert.deepEqual(record.processing.normalization.failure, result.failure);
      assert.equal(record.processing.json.diagnostic.originalByteOffset, Buffer.byteLength(damaged));
      assert.deepEqual(record.processing.json.repairDiagnostics.map(({ insertedText }) => insertedText), [']}']);
      const inspection = runQualificationAttempt({
        attempt: { id: modelId, request: { sentence: fixture.sentence, framework: 'xbar' },
          model: { providerRoute: model.providerRoute, providerModel: model.providerModel, nativeSettings: {} },
          source: { kind: 'raw-text-file', path: 'in-memory-stub' } },
        rawOutputBytes: Buffer.from(decode(result.rawOutput))
      });
      assert.deepEqual(inspection.inspection.payload, payload);
      assert.equal(inspection.inspection.analyses[0].stages.length, payload.derivationStages.length);
      assert.deepEqual(inspection.receipt.ingress.jsonDiagnostic, record.processing.json.diagnostic);
      assert.equal(inspection.bundle, null);
      return true;
    });
    assert.equal(fetch.mock.callCount(), 1);
    fetch.mock.restore();
  }
});

test('all active routes stop on rate limits and uncertain timeouts and retain the reason', async (t) => {
  isolate(t);
  for (const modelId of GENERATION_MODEL_IDS) {
    for (const reason of ['rate_limit', 'uncertain_timeout']) {
      const fetch = t.mock.method(globalThis, 'fetch', async () => {
        if (reason === 'rate_limit') return new Response('{"error":{"message":"Rate limit reached"}}', { status: 429 });
        throw Object.assign(new Error('Request timed out'), { code: 'ETIMEDOUT' });
      });
      await assert.rejects(() => parseFromBody({ sentence: fixture.sentence, modelId }), error => {
        const attempts = formatApiError(error).body.error.generationRecord.outcome.attempts;
        assert.equal(attempts.length, 1);
        assert.equal(attempts[0].retryReason, reason);
        assert.equal(attempts[0].retryStopReason, 'not_retryable');
        return true;
      });
      assert.equal(fetch.mock.callCount(), 1);
      fetch.mock.restore();
    }
  }
});

test('the provider returned identity remains distinct from the requested model', async (t) => {
  isolate(t);
  const model = getResearchModel('moonshot:kimi-k3');
  const response = { ...envelopeFor(model), model: 'kimi-k3-provider-snapshot' };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(response)));
  const bundle = await parseFromBody({ sentence: fixture.sentence, modelId: model.id });
  assert.equal(bundle.requestedModelId, model.id);
  assert.equal(bundle.generationRecord.modelSelection.providerModel, 'kimi-k3');
  assert.equal(bundle.generationRecord.returnedModel, 'kimi-k3-provider-snapshot');
  assert.equal(bundle.modelUsed, 'kimi-k3-provider-snapshot');
});

test('all active routes preserve fenced output and its decoding failure without regeneration', async (t) => {
  isolate(t);
  const fenced = `\u0060\u0060\u0060json\n${rawOutput}\n\u0060\u0060\u0060`;
  for (const modelId of GENERATION_MODEL_IDS) {
    const model = getResearchModel(modelId);
    const responseText = JSON.stringify(envelopeFor(model, fenced));
    const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(responseText));
    await assert.rejects(() => parseFromBody({ sentence: fixture.sentence, modelId }), error => {
      const result = formatApiError(error).body.error;
      assert.equal(result.failure.processingStep, 'json-decoding');
      assert.equal(result.generationRecord.processing.json.diagnostic.kind, 'json-syntax');
      assert.deepEqual(result.generationRecord.processing.json.repairDiagnostics, []);
      assert.equal(decode(result.rawOutput), fenced);
      assert.equal(decode(result.generationRecord.rawProviderResponse), responseText);
      assert.equal(result.generationRecord.outcome.attempts.length, 1);
      return true;
    });
    assert.equal(fetch.mock.callCount(), 1);
    fetch.mock.restore();
  }
});

test('all active routes enforce the three-attempt cap for transient server failures', async (t) => {
  isolate(t);
  for (const modelId of GENERATION_MODEL_IDS) {
    const fetch = t.mock.method(globalThis, 'fetch', async () => (
      new Response('{"error":{"message":"Temporarily unavailable"}}', { status: 503 })
    ));
    await assert.rejects(() => parseFromBody({ sentence: fixture.sentence, modelId }), error => {
      const attempts = formatApiError(error).body.error.generationRecord.outcome.attempts;
      assert.equal(attempts.length, 3);
      assert.ok(attempts.every(attempt => attempt.retryReason === 'transient_server_failure'));
      assert.equal(attempts[2].retryStopReason, 'attempt_limit');
      return true;
    });
    assert.equal(fetch.mock.callCount(), 3);
    fetch.mock.restore();
  }
});

test('the browser service sends native selection and retains failure diagnostics', async (t) => {
  const settings = { 'output_config.effort': 'high' };
  const modelId = 'anthropic:claude-fable-5-1';
  let reply = { analyses: [{}], requestedModelId: modelId };
  let status = 200;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/parse');
    assert.deepEqual(JSON.parse(options.body), { sentence: fixture.sentence, framework: 'xbar', modelId, settings });
    return new Response(JSON.stringify(reply), { status });
  });
  assert.deepEqual(await parseSentence(fixture.sentence, 'xbar', modelId, settings), reply);
  status = 502;
  reply = { error: {
    code: 'BAD_MODEL_RESPONSE', message: 'Malformed response',
    rawOutput: { data: 'e30=' },
    generationRecord: { modelSelection: { catalogId: modelId }, outcome: { finishReason: 'END_TURN' } }
  } };
  await assert.rejects(() => parseSentence(fixture.sentence, 'xbar', modelId, settings), (error) => {
    assert.ok(error instanceof ParseServiceError);
    assert.deepEqual(error.generationRecord, reply.error.generationRecord);
    assert.deepEqual(error.rawOutput, reply.error.rawOutput);
    return true;
  });
});

test('provider errors, malformed output, and incomplete replies retain evidence without fallback', async (t) => {
  isolate(t);
  for (const modelId of GENERATION_MODEL_IDS) {
    const model = getResearchModel(modelId);
    const incomplete = envelopeFor(model);
    const missingFinish = envelopeFor(model);
    if (model.provider === 'anthropic') incomplete.stop_reason = 'max_tokens';
    else if (model.provider === 'moonshot') incomplete.choices[0].finish_reason = 'length';
    else {
      incomplete.status = 'incomplete';
      incomplete.incomplete_details = { reason: 'max_output_tokens' };
    }
    if (model.provider === 'anthropic') delete missingFinish.stop_reason;
    else if (model.provider === 'moonshot') delete missingFinish.choices[0].finish_reason;
    else delete missingFinish.status;
    for (const { body, status } of [
      { body: JSON.stringify({ error: { message: 'Test account denied' } }), status: 401 },
      { body: JSON.stringify(envelopeFor(model, '{not valid JSON')), status: 200 },
      { body: JSON.stringify(incomplete), status: 200 },
      { body: JSON.stringify(missingFinish), status: 200 }
    ]) {
      const fetch = t.mock.method(globalThis, 'fetch', async (url) => {
        assert.equal(url, providers[model.provider].endpoint);
        return new Response(body, { status });
      });
      await assert.rejects(() => parseFromBody({ sentence: fixture.sentence, modelId }), (error) => {
        const result = formatApiError(error).body.error;
        assert.equal(result.generationRecord.modelSelection.catalogId, modelId);
        assert.ok(result.rawOutput);
        assert.equal(result.generationRecord.outcome.attempts.length, 1);
        assert.equal(decode(result.generationRecord.rawProviderResponse), body);
        if (status !== 200) assert.equal(decode(result.rawOutput), body);
        assert.doesNotMatch(JSON.stringify(result), /test-only-provider-key/);
        return true;
      });
      assert.equal(fetch.mock.callCount(), 1);
      fetch.mock.restore();
    }
  }
});
