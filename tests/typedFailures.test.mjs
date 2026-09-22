import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { __test__, ParseApiError } from '../server/babelParser.js';
import {
  attachGenerationFailureEvidence,
  createParseRoutes
} from '../server/babelParser/parseRoutes.js';
import {
  assertGenerationComplete,
  buildGenerationOutcome,
  summarizeGeneration
} from '../server/babelParser/modelRuntime.js';
import {
  PROVIDER_OUTPUT_ALLOWANCE_POLICIES,
  resolveRouteMaxOutputTokens
} from '../server/babelParser/routeConfig.js';
import {
  formatApiError,
  projectPublicGenerationRecord,
  validateParseBody
} from '../server/parseApi.js';
import {
  createRawOutputArtifact,
  FAILURE_CLASSES,
  MAX_RAW_OUTPUT_BODY_BYTES,
  MAX_RAW_OUTPUT_BYTES,
  withFailureDetails
} from '../server/babelParser/validationErrors.js';

const clone = (value) => structuredClone(value);

const buildMinimalPayload = () => ({
  derivationStages: [
    {
      statement: 'The authored token enters the derivation.',
      stageRecord: 'The authored token Mia forms the complete convergent surface of this minimal provider-free derivation.',
      relations: [],
      workspaceForest: [
        {
          id: 'mia_root',
          label: 'Mia',
          word: 'Mia',
          tokenIndex: 0,
          children: []
        }
      ]
    }
  ]
});

const normalize = (payload, sentence = 'Mia') => __test__.normalizeParseBundle(
  payload,
  'xbar',
  sentence,
  'gemini',
  true,
  { payloadIntegrityFlags: [] }
);

test('failure registry exposes exactly the six normative classes', () => {
  assert.deepEqual(Object.values(FAILURE_CLASSES).sort(), [
    'contract_misunderstanding',
    'deterministic_engine_failure',
    'incomplete_generation',
    'linguistic_failure',
    'transport_serialization',
    'valid_but_unexpected'
  ]);
});

const expectTypedFailure = ({
  name,
  mutate,
  expectedClass,
  ruleId,
  stageIndex,
  fieldPath,
  checkOffending,
  sentence = 'Mia'
}) => test(name, () => {
  const payload = mutate(clone(buildMinimalPayload()));
  assert.throws(
    () => normalize(payload, sentence),
    (error) => {
      assert.equal(error instanceof ParseApiError, true);
      assert.equal(error.failure.class, expectedClass);
      assert.equal(error.failure.ruleId, ruleId);
      assert.equal(error.failure.stageIndex, stageIndex);
      assert.equal(error.failure.fieldPath, fieldPath);
      assert.equal(Object.hasOwn(error.failure, 'offendingValue'), true);
      checkOffending?.(error.failure.offendingValue);
      return true;
    }
  );
});

expectTypedFailure({
  name: 'typed probe: payload envelope rejects extra top-level fields',
  mutate: (payload) => ({ ...payload, commentary: 'not allowed' }),
  expectedClass: FAILURE_CLASSES.CONTRACT_MISUNDERSTANDING,
  ruleId: 'PAYLOAD_ENVELOPE_EXACT',
  stageIndex: null,
  fieldPath: '$'
});

expectTypedFailure({
  name: 'typed probe: derivationStages must be an array',
  mutate: (payload) => ({ ...payload, derivationStages: 'transport-stringified stages' }),
  expectedClass: FAILURE_CLASSES.CONTRACT_MISUNDERSTANDING,
  ruleId: 'DERIVATION_STAGE_FIELDS_EXACT',
  stageIndex: null,
  fieldPath: '$.derivationStages'
});

expectTypedFailure({
  name: 'typed probe: each derivation stage must be an object',
  mutate: (payload) => ({ ...payload, derivationStages: ['not an object'] }),
  expectedClass: FAILURE_CLASSES.CONTRACT_MISUNDERSTANDING,
  ruleId: 'DERIVATION_STAGE_OBJECT',
  stageIndex: 0,
  fieldPath: '$.derivationStages[0]'
});

expectTypedFailure({
  name: 'typed probe: extra stage field reaches the exact-field rule',
  mutate: (payload) => {
    payload.derivationStages[0].compilerHint = 'forbidden fifth field';
    return payload;
  },
  expectedClass: FAILURE_CLASSES.CONTRACT_MISUNDERSTANDING,
  ruleId: 'DERIVATION_STAGE_FIELDS_EXACT',
  stageIndex: 0,
  fieldPath: '$.derivationStages[0]',
  checkOffending: (value) => assert.equal(value.compilerHint, 'forbidden fifth field')
});

expectTypedFailure({
  name: 'typed probe: missing stage field reaches the exact-field rule',
  mutate: (payload) => {
    delete payload.derivationStages[0].stageRecord;
    return payload;
  },
  expectedClass: FAILURE_CLASSES.CONTRACT_MISUNDERSTANDING,
  ruleId: 'DERIVATION_STAGE_FIELDS_EXACT',
  stageIndex: 0,
  fieldPath: '$.derivationStages[0]',
  checkOffending: (value) => {
    assert.equal(Object.hasOwn(value, 'stageRecord'), false);
    assert.deepEqual(Object.keys(value), ['statement', 'relations', 'workspaceForest']);
  }
});

expectTypedFailure({
  name: 'typed probe: empty stage statement is discriminated',
  mutate: (payload) => {
    payload.derivationStages[0].statement = ' ';
    return payload;
  },
  expectedClass: FAILURE_CLASSES.CONTRACT_MISUNDERSTANDING,
  ruleId: 'DERIVATION_STAGE_STATEMENT_NONEMPTY',
  stageIndex: 0,
  fieldPath: '$.derivationStages[0].statement'
});

expectTypedFailure({
  name: 'typed probe: empty stage record is discriminated',
  mutate: (payload) => {
    payload.derivationStages[0].stageRecord = ' ';
    return payload;
  },
  expectedClass: FAILURE_CLASSES.CONTRACT_MISUNDERSTANDING,
  ruleId: 'DERIVATION_STAGE_RECORD_NONEMPTY',
  stageIndex: 0,
  fieldPath: '$.derivationStages[0].stageRecord'
});

test('nonempty Stage Records do not assume English words or whitespace', () => {
  const payload = buildMinimalPayload();
  payload.derivationStages[0].stageRecord = '名詞が統語構造を完成させる。';
  const bundle = normalize(payload);
  assert.equal(bundle.analyses[0].derivationStages[0].stageRecord, '名詞が統語構造を完成させる。');
});

test('stage contract errors are reported before later reference expansion can mask them', () => {
  const payload = buildMinimalPayload();
  payload.derivationStages[0].stageRecord = '';
  payload.derivationStages.push({
    statement: 'A later malformed reference is present.',
    stageRecord: 'This later stage should never mask the earlier exact contract failure.',
    relations: [],
    workspaceForest: [{ refId: 'missing_node' }]
  });

  assert.throws(
    () => normalize(payload),
    (error) => {
      assert.equal(error.failure.ruleId, 'DERIVATION_STAGE_RECORD_NONEMPTY');
      assert.equal(error.failure.stageIndex, 0);
      return true;
    }
  );
});

expectTypedFailure({
  name: 'typed probe: malformed relation reaches the current exact-relation rule',
  mutate: (payload) => {
    payload.derivationStages[0].relations = [{
      relation: 'UnknownRelation',
      anchors: { witness: 'mia_root' },
      rendererHint: 'forbidden'
    }];
    return payload;
  },
  expectedClass: FAILURE_CLASSES.CONTRACT_MISUNDERSTANDING,
  ruleId: 'DERIVATION_STAGE_RELATION_EXACT',
  stageIndex: 0,
  fieldPath: '$.derivationStages[0].relations[0]',
  checkOffending: (value) => assert.equal(value.rendererHint, 'forbidden')
});

expectTypedFailure({
  name: 'typed probe: present-but-undefined workspaceForest is discriminated',
  mutate: (payload) => {
    payload.derivationStages[0].workspaceForest = undefined;
    return payload;
  },
  expectedClass: FAILURE_CLASSES.CONTRACT_MISUNDERSTANDING,
  ruleId: 'DERIVATION_STAGE_WORKSPACE_FOREST_PRESENT',
  stageIndex: 0,
  fieldPath: '$.derivationStages[0].workspaceForest'
});

expectTypedFailure({
  name: 'typed probe: an empty stage sequence is an incomplete generation',
  mutate: (payload) => ({ ...payload, derivationStages: [] }),
  expectedClass: FAILURE_CLASSES.INCOMPLETE_GENERATION,
  ruleId: 'GENERATION_DID_NOT_CONVERGE',
  stageIndex: null,
  fieldPath: '$.derivationStages'
});

expectTypedFailure({
  name: 'typed probe: final token misalignment is a contract misunderstanding',
  mutate: (payload) => payload,
  expectedClass: FAILURE_CLASSES.CONTRACT_MISUNDERSTANDING,
  ruleId: 'SURFACE_ORDER_EXACT',
  stageIndex: 0,
  fieldPath: '$.derivationStages[0].workspaceForest',
  sentence: 'Nia'
});

test('transport JSON rejection preserves typed failure and downloadable raw bytes', () => {
  const raw = '\uFEFF  \nnot-json-\u0000-🙂  \n';
  assert.throws(
    () => __test__.parseModelJson(raw),
    (error) => {
      assert.equal(error.failure.class, FAILURE_CLASSES.TRANSPORT_SERIALIZATION);
      assert.equal(error.failure.ruleId, 'TRANSPORT_JSON_OBJECT');
      assert.equal(error.failure.stageIndex, null);
      assert.equal(error.failure.fieldPath, '$');
      assert.equal(Buffer.from(error.rawOutput.data, 'base64').toString('utf8'), raw);
      return true;
    }
  );
});

test('length stop is typed before parse and records sent allowance and reasoning use', () => {
  const rawText = JSON.stringify(buildMinimalPayload());
  const generation = {
    text: rawText,
    status: 'incomplete',
    candidates: [{ finishReason: 'INCOMPLETE_MAX_OUTPUT_TOKENS' }],
    usageMetadata: {
      inputTokenCount: 90,
      outputTokenCount: 128000,
      totalTokenCount: 128090,
      reasoningTokenCount: 8000
    }
  };

  assert.throws(
    () => assertGenerationComplete({
      generation,
      provider: 'gpt',
      model: 'gpt-5.5',
      sentMaxOutputTokens: 128000,
      runId: 'run-one',
      attempts: [{ attemptNumber: 1, outcome: 'completed' }]
    }),
    (error) => {
      assert.equal(error.code, 'INCOMPLETE_GENERATION');
      assert.equal(error.failure.class, FAILURE_CLASSES.INCOMPLETE_GENERATION);
      assert.equal(error.failure.ruleId, 'GENERATION_LENGTH_STOP');
      assert.equal(error.details.sentMaxOutputTokens, 128000);
      assert.equal(error.details.finishReason, 'INCOMPLETE_MAX_OUTPUT_TOKENS');
      assert.equal(error.details.reasoningTokenCount, 8000);
      assert.equal(error.details.attempts.length, 1);
      assert.equal(Buffer.from(error.rawOutput.data, 'base64').toString('utf8'), rawText);
      return true;
    }
  );
});

test('non-length refusal stops are typed before JSON parsing', () => {
  const rawText = '{"refusal":"policy"}';
  assert.throws(
    () => assertGenerationComplete({
      generation: {
        text: rawText,
        status: 'completed',
        candidates: [{ finishReason: 'REFUSAL' }]
      },
      provider: 'claude',
      model: 'claude-opus-5',
      sentMaxOutputTokens: 32768,
      runId: 'refusal-run',
      attempts: []
    }),
    (error) => {
      assert.equal(error.code, 'INCOMPLETE_GENERATION');
      assert.equal(error.failure.ruleId, 'GENERATION_COMPLETED_STOP_FAILURE');
      assert.equal(error.details.finishReason, 'REFUSAL');
      return true;
    }
  );
});

test('known successful provider stop states remain accepted', () => {
  for (const finishReason of ['STOP', 'COMPLETED', 'END_TURN', 'STOP_SEQUENCE']) {
    const meta = assertGenerationComplete({
      generation: {
        text: '{}',
        status: 'completed',
        candidates: [{ finishReason }]
      },
      provider: 'fixture',
      model: 'fixture-model',
      sentMaxOutputTokens: 100,
      runId: `success-${finishReason}`,
      attempts: []
    });
    assert.equal(meta.finishReason, finishReason);
  }
});

test('failed completed generations retain their generation receipt and raw output', () => {
  const rawText = '{broken';
  const generationRecord = {
    schemaVersion: 2,
    provider: 'gpt',
    promptContract: { promptSha256: 'prompt-hash' },
    sentGenerationConfig: { model: 'gpt-5.6-sol' },
    timing: { requestStartedAt: '2026-08-28T00:00:00.000Z', durationMs: 10 },
    outcome: { finishReason: 'COMPLETED' }
  };
  const enriched = attachGenerationFailureEvidence({
    error: new ParseApiError('BAD_MODEL_RESPONSE', 'Invalid JSON.', 422),
    ParseApiError,
    generationRecord,
    rawText
  });

  assert.deepEqual(enriched.details.generationRecord, generationRecord);
  assert.equal(Buffer.from(enriched.rawOutput.data, 'base64').toString('utf8'), rawText);
  const formatted = formatApiError(enriched);
  assert.deepEqual(formatted.body.error.generationRecord, generationRecord);
});

test('public generation receipts omit provider and internal attempt messages', () => {
  const projected = projectPublicGenerationRecord({
    schemaVersion: 2,
    provider: 'gpt',
    outcome: {
      finishReason: 'PROVIDER_ERROR',
      attempts: [{
        attemptNumber: 1,
        outcome: 'terminal_failure',
        statusCode: 500,
        message: 'private compiler or provider detail',
        futurePrivateField: 'must also stay private'
      }]
    }
  });

  assert.equal(projected.outcome.attempts[0].attemptNumber, 1);
  assert.equal(projected.outcome.attempts[0].outcome, 'terminal_failure');
  assert.equal(projected.outcome.attempts[0].statusCode, 500);
  assert.equal(Object.hasOwn(projected.outcome.attempts[0], 'message'), false);
  assert.equal(Object.hasOwn(projected.outcome.attempts[0], 'futurePrivateField'), false);
  assert.equal(JSON.stringify(projected).includes('private'), false);
});

test('provider route failures retain a request receipt without calling another model', async () => {
  const previousApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'provider-free-test-key';
  try {
    const routes = createParseRoutes({
      ParseApiError,
      normalizeParseBundle: () => {
        throw new Error('normalization should not run');
      },
      parseModelJson: JSON.parse,
      parseModelJsonDetailed: (rawText) => ({ payload: JSON.parse(rawText), integrityFlags: [] }),
      generateOpenAI: async () => {
        const error = new Error('provider rejected the request body');
        error.status = 400;
        throw error;
      }
    });

    await assert.rejects(
      () => routes.parseSentenceWithOpenAI('Mia'),
      (error) => {
        assert.equal(error instanceof ParseApiError, true);
        assert.equal(error.code, 'INVALID_REQUEST');
        assert.equal(error.details.generationRecord.provider, 'gpt');
        assert.equal(error.details.generationRecord.outcome.attempts.length, 1);
        assert.equal(error.details.generationRecord.outcome.attempts[0].outcome, 'terminal_failure');
        return true;
      }
    );
  } finally {
    if (typeof previousApiKey === 'undefined') delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousApiKey;
  }
});

test('native OpenAI quota failures reach the public error without a replacement generation', async (t) => {
  const previousApiKey = process.env.OPENAI_API_KEY;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.OPENAI_API_KEY = 'provider-free-test-key';
  process.env.NODE_ENV = 'production';
  try {
    for (const code of ['credit_balance_exhausted', 'insufficient_quota']) {
      for (const httpStatus of [200, 429, 503]) {
        await t.test(`${code}, HTTP ${httpStatus}`, async (t) => {
          const payload = {
            ...(httpStatus === 200 ? { id: 'resp_quota', status: 'failed', output: [] } : {}),
            error: { code, message: 'The API account has no remaining allowance.' }
          };
          const rawResponse = JSON.stringify(payload);
          const calls = [];
          t.mock.method(globalThis, 'fetch', async (url, init) => {
            calls.push({ url: String(url), method: init.method });
            assert.equal(calls.length, 1, 'Quota failures must not submit another generation');
            return new Response(rawResponse, { status: httpStatus });
          });
          const routes = createParseRoutes({
            ParseApiError,
            normalizeParseBundle: () => assert.fail('Quota failures must not reach normalization'),
            parseModelJson: () => assert.fail('Quota failures must not be parsed as analyses')
          });

          await assert.rejects(() => routes.parseSentenceWithOpenAI('Mia'), (error) => {
            assert.equal(error.details.providerErrorCode, code);
            const { status, body } = formatApiError(error);
            assert.equal(status, 429);
            assert.equal(body.error.code, 'PROVIDER_QUOTA');
            assert.match(body.error.message, code === 'credit_balance_exhausted' ? /credits are exhausted/ : /quota is exhausted/);
            assert.equal(body.error.failure.class, 'transport_serialization');
            assert.equal(Buffer.from(body.error.rawOutput.data, 'base64').toString('utf8'), rawResponse);
            const receipt = body.error.generationRecord;
            assert.equal(Buffer.from(receipt.rawProviderResponse.data, 'base64').toString('utf8'), rawResponse);
            assert.equal(receipt.outcome.attempts.length, 1);
            assert.equal(receipt.outcome.attempts[0].outcome, 'terminal_failure');
            assert.equal(receipt.outcome.attempts[0].retryStopReason, 'not_retryable');
            return true;
          });
          assert.deepEqual(calls, [{ url: 'https://api.openai.com/v1/responses', method: 'POST' }]);
        });
      }
    }
  } finally {
    if (typeof previousApiKey === 'undefined') delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousApiKey;
    if (typeof previousNodeEnv === 'undefined') delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('native OpenAI generic failed and cancelled responses remain incomplete generations', async (t) => {
  const previousApiKey = process.env.OPENAI_API_KEY;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.OPENAI_API_KEY = 'provider-free-test-key';
  process.env.NODE_ENV = 'production';
  try {
    for (const status of ['failed', 'cancelled']) {
      await t.test(status, async (t) => {
        let calls = 0;
        const rawResponse = JSON.stringify({
          id: 'resp_stopped', status, error: { code: 'server_error', message: 'Response stopped.' }
        });
        t.mock.method(globalThis, 'fetch', async () => {
          assert.equal(++calls, 1, 'Completed stops must not submit another generation');
          return new Response(rawResponse);
        });
        const routes = createParseRoutes({
          ParseApiError,
          normalizeParseBundle: () => assert.fail('Stopped responses must not reach normalization'),
          parseModelJson: () => assert.fail('Stopped responses must not be parsed as analyses')
        });

        await assert.rejects(() => routes.parseSentenceWithOpenAI('Mia'), (error) => {
          const result = formatApiError(error);
          assert.equal(result.status, 502);
          assert.equal(result.body.error.code, 'INCOMPLETE_GENERATION');
          assert.equal(result.body.error.message, `OpenAI completed with ${status.toUpperCase()} and no valid generation.`);
          assert.equal(result.body.error.failure.ruleId, 'GENERATION_COMPLETED_STOP_FAILURE');
          assert.equal(Buffer.from(result.body.error.rawOutput.data, 'base64').toString('utf8'), rawResponse);
          assert.equal(result.body.error.generationRecord.outcome.attempts.length, 1);
          return true;
        });
        assert.equal(calls, 1);
      });
    }
  } finally {
    if (typeof previousApiKey === 'undefined') delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousApiKey;
    if (typeof previousNodeEnv === 'undefined') delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('unexpected normalization crashes remain deterministic engine failures', async () => {
  const previousApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'provider-free-test-key';
  try {
    const routes = createParseRoutes({
      ParseApiError,
      normalizeParseBundle: () => {
        throw new Error('private normalization implementation detail');
      },
      parseModelJson: JSON.parse,
      parseModelJsonDetailed: (rawText) => ({ payload: JSON.parse(rawText), integrityFlags: [] }),
      generateOpenAI: async () => ({
        text: '{}',
        status: 'completed',
        candidates: [{ finishReason: 'COMPLETED' }]
      })
    });

    await assert.rejects(
      () => routes.parseSentenceWithOpenAI('Mia'),
      (error) => {
        assert.equal(error.code, 'PARSE_ENGINE_FAILED');
        assert.equal(error.status, 500);
        assert.equal(error.failure.class, 'deterministic_engine_failure');
        assert.equal(error.failure.processingStep, 'normalization');
        assert.deepEqual(error.details.engineError, { name: 'Error', message: 'private normalization implementation detail' });
        assert.equal(error.message.includes('private'), false);
        assert.equal(error.details.generationRecord.provider, 'gpt');
        return true;
      }
    );
  } finally {
    if (typeof previousApiKey === 'undefined') delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousApiKey;
  }
});

test('Gemini timeout overrides do not leak into other provider routes', () => {
  const routeConfigUrl = new URL('../server/babelParser/routeConfig.js', import.meta.url).href;
  const script = `
    const { resolveModelTimeoutMs } = await import(${JSON.stringify(routeConfigUrl)});
    process.stdout.write(JSON.stringify({
      gemini: resolveModelTimeoutMs('gemini-model', 'gemini'),
      gpt: resolveModelTimeoutMs('gpt-model', 'gpt'),
      claude: resolveModelTimeoutMs('claude-model', 'claude')
    }));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      GEMINI_ROUTE_TIMEOUT_MS: '1111',
      GEMINI_MODEL_TIMEOUT_MS: '2222',
      BABEL_PROVIDER_MODEL_TIMEOUT_MS: '3333'
    }
  });

  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), {
    gemini: 1111,
    gpt: 3333,
    claude: 3333
  });
});

test('legacy Gemini model timeout still applies only to Gemini', () => {
  const routeConfigUrl = new URL('../server/babelParser/routeConfig.js', import.meta.url).href;
  const script = `
    const { resolveModelTimeoutMs } = await import(${JSON.stringify(routeConfigUrl)});
    process.stdout.write(JSON.stringify({
      gemini: resolveModelTimeoutMs('gemini-model', 'gemini'),
      gpt: resolveModelTimeoutMs('gpt-model', 'gpt')
    }));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      GEMINI_ROUTE_TIMEOUT_MS: '',
      GEMINI_MODEL_TIMEOUT_MS: '2222',
      BABEL_PROVIDER_MODEL_TIMEOUT_MS: '3333'
    }
  });

  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), {
    gemini: 2222,
    gpt: 3333
  });
});

test('provider allowances are route/model policy, never sentence-derived', () => {
  assert.equal(resolveRouteMaxOutputTokens('gemini', 'x'), 65536);
  assert.equal(resolveRouteMaxOutputTokens('gemini', 'x '.repeat(5000)), 65536);
  assert.equal(resolveRouteMaxOutputTokens('gpt', 'x'), 128000);
  assert.equal(resolveRouteMaxOutputTokens('gpt', 'x '.repeat(5000)), 128000);
  assert.equal(PROVIDER_OUTPUT_ALLOWANCE_POLICIES.gemini.documentedMaximum, 65536);
  assert.equal(PROVIDER_OUTPUT_ALLOWANCE_POLICIES.gpt.documentedMaximum, 128000);
  assert.equal(PROVIDER_OUTPUT_ALLOWANCE_POLICIES.claude.documentedMaximum, null);
  assert.equal(PROVIDER_OUTPUT_ALLOWANCE_POLICIES.claude.admissionProbeConfirmed, false);
});

test('generation outcome records finish status and reasoning tokens', () => {
  const generationMeta = summarizeGeneration({
    text: '{}',
    status: 'completed',
    candidates: [{ finishReason: 'STOP' }],
    usageMetadata: {
      inputTokenCount: 10,
      outputTokenCount: 20,
      totalTokenCount: 30,
      reasoningTokenCount: 7
    }
  });
  const outcome = buildGenerationOutcome({
    generationMeta,
    sentMaxOutputTokens: 65536,
    runId: 'receipt-run',
    attempts: [{ attemptNumber: 1, outcome: 'completed' }]
  });
  assert.equal(outcome.sentMaxOutputTokens, 65536);
  assert.equal(outcome.finishReason, 'STOP');
  assert.equal(outcome.finishStatus, 'COMPLETED');
  assert.equal(outcome.reasoningTokenCount, 7);
  assert.equal(outcome.attempts.length, 1);
});

test('API errors expose typed failure while raw output is capped and hash-bound', () => {
  assert.throws(
    () => validateParseBody({ sentence: 'Mia', framework: 'other', modelRoute: 'gemini' }),
    (error) => {
      const formatted = formatApiError(error);
      assert.equal(formatted.body.error.failure.ruleId, 'REQUEST_FRAMEWORK_SUPPORTED');
      assert.equal(formatted.body.error.failure.fieldPath, '$.framework');
      return true;
    }
  );

  const oversized = 'a'.repeat(MAX_RAW_OUTPUT_BYTES + 13);
  const artifact = createRawOutputArtifact(oversized);
  assert.equal(artifact.byteLength, MAX_RAW_OUTPUT_BYTES + 13);
  assert.equal(artifact.retainedByteLength, MAX_RAW_OUTPUT_BYTES);
  assert.equal(artifact.truncated, true);
  assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
  assert.ok(Buffer.byteLength(JSON.stringify(artifact), 'utf8') <= MAX_RAW_OUTPUT_BODY_BYTES);

  const formatted = formatApiError(new ParseApiError(
    'BAD_MODEL_RESPONSE',
    'Oversized provider output.',
    502,
    withFailureDetails({}, {
      failureClass: 'transport_serialization',
      ruleId: 'TRANSPORT_JSON_OBJECT',
      fieldPath: '$',
      offendingValue: oversized
    }, oversized)
  ));
  assert.ok(
    Buffer.byteLength(JSON.stringify(formatted.body), 'utf8') <= MAX_RAW_OUTPUT_BODY_BYTES
  );
});
