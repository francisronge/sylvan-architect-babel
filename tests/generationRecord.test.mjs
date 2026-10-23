import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGenerationRecord,
  describeInputTokenization
} from '../server/babelParser/generationRecord.js';
import { SPELLOUT_CONTRACT_VERSION } from '../server/babelParser/spellout.js';
import {
  buildAnthropicRequestBody,
  buildGrokRequestBody,
  buildKimiRequestBody,
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
  kimi: buildKimiRequestBody({
    model: 'kimi-test',
    contents: 'Analyze sentence one.',
    systemInstruction: SYSTEM_TEXT,
    maxOutputTokens: 8192,
    reasoningEffort: 'high'
  }),
  grok: buildGrokRequestBody({
    model: 'grok-test',
    contents: 'Analyze sentence one.',
    systemInstruction: SYSTEM_TEXT,
    maxOutputTokens: 8192,
    reasoningEffort: 'high'
  })
});

test('generation records hash exact prompt material without embedding it', () => {
  const bodies = requestBodies();
  const first = recordFor({ provider: 'gpt', sentRequest: bodies.gpt });
  const secondBody = buildOpenAIRequestBody({
    model: 'gpt-test',
    contents: 'Analyze a different sentence.',
    systemInstruction: SYSTEM_TEXT,
    maxOutputTokens: 8192,
    reasoningEffort: 'high',
    background: true
  });
  const second = recordFor({ provider: 'gpt', sentRequest: secondBody });
  const minimalist = recordFor({
    provider: 'gpt',
    sentRequest: bodies.gpt,
    framework: 'minimalism'
  });
  const claude = recordFor({ provider: 'claude', sentRequest: bodies.claude });

  for (const field of ['systemInstructionSha256', 'promptSha256', 'promptTemplateSha256']) {
    assert.match(first.promptContract[field], HASH_RE);
  }
  assert.equal(first.promptContract.promptTemplateSha256, second.promptContract.promptTemplateSha256);
  assert.notEqual(first.promptContract.promptSha256, second.promptContract.promptSha256);
  assert.notEqual(first.promptContract.promptTemplateSha256, minimalist.promptContract.promptTemplateSha256);
  assert.notEqual(first.promptContract.promptTemplateSha256, claude.promptContract.promptTemplateSha256);
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

  for (const record of Object.values(records)) {
    assert.equal(Object.hasOwn(record.sentGenerationConfig, 'temperature'), false);
  }
  assert.equal(records.gpt.sentGenerationConfig.background, true);
  assert.equal(records.claude.sentGenerationConfig.effort, 'max');
  assert.equal(records.kimi.sentGenerationConfig.maxCompletionTokens, 8192);
  assert.equal(records.grok.sentGenerationConfig.store, false);

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
  assert.equal(bodies.gpt.reasoning.effort, 'high');
  assert.equal(bodies.gpt.max_output_tokens, 8192);
  assert.equal(Object.hasOwn(bodies.gpt, 'temperature'), false);
  assert.equal(bodies.claude.system, SYSTEM_TEXT);
  assert.equal(bodies.claude.output_config.effort, 'max');
  assert.equal(Object.hasOwn(bodies.claude, 'temperature'), false);
  assert.equal(bodies.kimi.max_completion_tokens, 8192);
  assert.equal(bodies.grok.max_output_tokens, 8192);
});

test('Tree Bank snapshots preserve generationRecord as bundle metadata', () => {
  const generationRecord = recordFor({
    provider: 'gpt',
    sentRequest: requestBodies().gpt
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

test('generation records name the spell-out version and the runtime Unicode data that derived the input tokens', () => {
  const record = buildGenerationRecord({ provider: 'gpt', framework: 'xbar', promptRoute: 'gpt', sentRequest: { model: 'm', input: [] },
    requestStartedAt: Date.parse('2026-10-17T00:00:00Z'), durationMs: 1 });
  assert.deepEqual(record.inputTokenization, { version: SPELLOUT_CONTRACT_VERSION,
    unicode: process.versions.unicode, icu: process.versions.icu, cldr: process.versions.cldr });
  assert.deepEqual(describeInputTokenization({ unicode: '15.1', icu: '74.2' }),
    { version: SPELLOUT_CONTRACT_VERSION, unicode: '15.1', icu: '74.2', cldr: null });
});
