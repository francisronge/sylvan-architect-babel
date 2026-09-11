import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGenerationRecord
} from '../server/babelParser/generationRecord.js';
import {
  buildAnthropicRequestBody,
  buildGeminiGenerationRequest,
  buildLocalRequestBody,
  buildOpenAIRequestBody
} from '../server/babelParser/modelRuntime.js';
import { buildParseContentsPrompt } from '../server/babelParser/prompts.js';
import {
  createTreeBankBundleSnapshot
} from '../treeBankSnapshot.js';

const HASH_RE = /^[0-9a-f]{64}$/;
const SYSTEM_TEXT = 'System contract text that must never be embedded.';

const recordFor = ({
  provider,
  sentRequest,
  framework = 'xbar',
  promptRoute = provider
}) => buildGenerationRecord({
  provider,
  framework,
  promptRoute,
  sentRequest,
  requestStartedAt: Date.UTC(2026, 6, 10, 12, 0, 0),
  durationMs: 321,
  buildTemplate: buildParseContentsPrompt
});

const requestBodies = () => ({
  gemini: buildGeminiGenerationRequest({
    model: 'gemini-test',
    contents: 'Analyze sentence one.',
    systemInstruction: SYSTEM_TEXT,
    temperature: 0.2,
    maxOutputTokens: 8192,
    thinkingConfig: { thinkingLevel: 'HIGH' }
  }),
  gpt: buildOpenAIRequestBody({
    model: 'gpt-test',
    contents: 'Analyze sentence one.',
    systemInstruction: SYSTEM_TEXT,
    maxOutputTokens: 8192,
    reasoningEffort: 'high',
    background: true
  }),
  claude: buildAnthropicRequestBody({
    model: 'claude-test',
    contents: 'Analyze sentence one.',
    systemInstruction: SYSTEM_TEXT,
    maxOutputTokens: 8192,
    effort: 'max',
    thinking: { type: 'adaptive', display: 'omitted' }
  }),
  local: buildLocalRequestBody({
    transport: 'http',
    systemInstruction: SYSTEM_TEXT,
    prompt: 'Analyze sentence one.',
    temperature: 0.2,
    maxOutputTokens: 4096
  })
});

test('generation records hash exact prompt material without embedding it', () => {
  const bodies = requestBodies();
  const first = recordFor({ provider: 'gemini', sentRequest: bodies.gemini });
  const secondBody = buildGeminiGenerationRequest({
    model: 'gemini-test',
    contents: 'Analyze a different sentence.',
    systemInstruction: SYSTEM_TEXT,
    temperature: 0.2,
    maxOutputTokens: 8192,
    thinkingConfig: { thinkingLevel: 'HIGH' }
  });
  const second = recordFor({ provider: 'gemini', sentRequest: secondBody });
  const minimalist = recordFor({
    provider: 'gemini',
    sentRequest: bodies.gemini,
    framework: 'minimalism'
  });
  const gpt = recordFor({ provider: 'gpt', sentRequest: bodies.gpt });

  for (const field of ['systemInstructionSha256', 'promptSha256', 'promptTemplateSha256']) {
    assert.match(first.promptContract[field], HASH_RE);
  }
  assert.equal(first.promptContract.promptTemplateSha256, second.promptContract.promptTemplateSha256);
  assert.notEqual(first.promptContract.promptSha256, second.promptContract.promptSha256);
  assert.notEqual(first.promptContract.promptTemplateSha256, minimalist.promptContract.promptTemplateSha256);
  assert.notEqual(first.promptContract.promptTemplateSha256, gpt.promptContract.promptTemplateSha256);
  assert.equal(first.timing.requestStartedAt, '2026-07-10T12:00:00.000Z');
  assert.equal(first.timing.durationMs, 321);
  assert.equal(first.schemaVersion, 2);
  assert.equal(JSON.stringify(first).includes(SYSTEM_TEXT), false);
  assert.equal(JSON.stringify(first).includes('Analyze sentence one.'), false);
});

test('sent generation config preserves provider asymmetry without key-bearing fields', () => {
  const bodies = requestBodies();
  const records = Object.fromEntries(
    Object.entries(bodies).map(([provider, sentRequest]) => [
      provider,
      recordFor({ provider, sentRequest })
    ])
  );

  assert.equal(records.gemini.sentGenerationConfig.temperature, 0.2);
  assert.equal(records.local.sentGenerationConfig.temperature, 0.2);
  assert.equal(Object.hasOwn(records.gpt.sentGenerationConfig, 'temperature'), false);
  assert.equal(Object.hasOwn(records.claude.sentGenerationConfig, 'temperature'), false);
  assert.equal(records.gpt.sentGenerationConfig.background, true);
  assert.equal(records.claude.sentGenerationConfig.effort, 'max');
  assert.equal(records.local.sentGenerationConfig.transport, 'http');

  const forbiddenKeys = new Set(['apiKey', 'Authorization', 'x-api-key', 'headers']);
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `forbidden generationRecord key: ${key}`);
      visit(child);
    }
  };
  Object.values(records).forEach(visit);
  const serializedRecords = JSON.stringify(records);
  assert.equal(serializedRecords.includes(SYSTEM_TEXT), false);
  assert.equal(serializedRecords.includes('Analyze sentence one.'), false);
});

test('pure request builders retain the current provider wire shapes', () => {
  const bodies = requestBodies();
  assert.deepEqual(bodies.gemini.config.thinkingConfig, { thinkingLevel: 'HIGH' });
  assert.equal(bodies.gemini.config.responseMimeType, 'application/json');
  assert.equal(bodies.gpt.reasoning.effort, 'high');
  assert.equal(bodies.gpt.max_output_tokens, 8192);
  assert.equal(Object.hasOwn(bodies.gpt, 'temperature'), false);
  assert.equal(bodies.claude.system, SYSTEM_TEXT);
  assert.equal(bodies.claude.output_config.effort, 'max');
  assert.equal(Object.hasOwn(bodies.claude, 'temperature'), false);
  assert.equal(bodies.local.options.num_predict, 4096);
  assert.equal(bodies.local.options.num_ctx > 0, true);
});

test('Tree Bank snapshots preserve generationRecord as bundle metadata', () => {
  const generationRecord = recordFor({
    provider: 'gemini',
    sentRequest: requestBodies().gemini
  });
  const snapshot = createTreeBankBundleSnapshot({
    analyses: [{
      tree: { id: 'root', label: 'TP', children: [] },
      provenance: { treeSource: 'derivationStages' }
    }],
    ambiguityDetected: false,
    generationRecord,
    transientBundleField: 'not persisted'
  });

  assert.deepEqual(snapshot.generationRecord, generationRecord);
  assert.equal('transientBundleField' in snapshot, false);
});
