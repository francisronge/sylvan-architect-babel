import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  RESEARCH_MODEL_CATALOG,
  GENERATION_MODEL_IDS,
  MODEL_ROUTE_CONFIG_VERSION,
  getGenerationModel,
  getResearchModel,
  resolveGenerationModelSelection,
  resolveResearchModelSelection
} from '../server/babelParser/researchModelCatalog.js';
import { validateParseBody } from '../server/parseApi.js';

test('the research catalog contains the approved unqualified candidates', () => {
  assert.deepEqual(
    RESEARCH_MODEL_CATALOG.map((entry) => entry.id),
    [
      'openai:gpt-6.1-sol',
      'openai:gpt-6-astra',
      'openai:gpt-6-sol',
      'openai:gpt-5.6-sol',
      'anthropic:claude-opus-5-5',
      'anthropic:claude-opus-5',
      'anthropic:claude-fable-5-1',
      'moonshot:kimi-k3',
      'meta:muse-spark-1.2',
      'xai:grok-4.6',
      'zai:glm-5.3-flash'
    ]
  );
  assert.ok(RESEARCH_MODEL_CATALOG.every((entry) => entry.qualificationStatus === 'unqualified'));
  assert.equal(
    RESEARCH_MODEL_CATALOG.filter(
      (entry) => entry.qualificationConfiguration === 'pending-settings'
    ).length,
    1
  );
  assert.equal(RESEARCH_MODEL_CATALOG.some((entry) => entry.provider === 'google'), false);
  assert.equal(RESEARCH_MODEL_CATALOG.some((entry) => /gemini/i.test(entry.providerModel)), false);
  assert.equal(new Set(RESEARCH_MODEL_CATALOG.map((entry) => entry.id)).size, RESEARCH_MODEL_CATALOG.length);
  assert.equal(Object.isFrozen(RESEARCH_MODEL_CATALOG), true);
  assert.deepEqual(GENERATION_MODEL_IDS.slice(0, 2), ['openai:gpt-6-astra', 'openai:gpt-6-sol']);
  assert.equal(GENERATION_MODEL_IDS.includes('openai:gpt-5.6-sol'), false);
});

test('catalog settings retain each provider native parameter name', () => {
  const openai = resolveResearchModelSelection('openai:gpt-5.6-sol', {
    'reasoning.effort': 'max'
  });
  assert.deepEqual(openai.nativeSettings, { 'reasoning.effort': 'max' });
  assert.equal(openai.requestPolicy.maxOutputTokens, 128000);
  assert.equal(openai.requestPolicy.background, true);

  const opus = resolveResearchModelSelection('anthropic:claude-opus-5', {
    'output_config.effort': 'xhigh'
  });
  assert.deepEqual(opus.nativeSettings, { 'output_config.effort': 'xhigh' });
  assert.equal(opus.requestPolicy.thinking.requestMode, 'explicit-adaptive');

  const fable = resolveResearchModelSelection('anthropic:claude-fable-5-1');
  assert.deepEqual(fable.nativeSettings, { 'output_config.effort': 'high' });
  assert.equal(fable.requestPolicy.thinking.requestMode, 'implicit-always-on');
  assert.equal(fable.constraints.dataRetention, '30-days-required');
  assert.equal(fable.constraints.zeroDataRetention, 'requires-explicit-authorization');
});

test('Astra qualifies at high and accepts only its supported reasoning efforts', () => {
  const astra = resolveResearchModelSelection('openai:gpt-6-astra');
  assert.equal(astra.providerModel, 'gpt-6-astra');
  assert.equal(astra.providerRoute, 'gpt');
  assert.deepEqual(astra.nativeSettings, { 'reasoning.effort': 'high' });
  assert.equal(astra.requestPolicy.maxOutputTokens, 128000);

  for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
    assert.deepEqual(
      resolveResearchModelSelection('openai:gpt-6-astra', { 'reasoning.effort': effort }).nativeSettings,
      { 'reasoning.effort': effort }
    );
  }
  assert.throws(
    () => resolveResearchModelSelection('openai:gpt-6-astra', { 'reasoning.effort': 'none' }),
    /must be one of/
  );
});

test('GPT-6 Sol is selectable for qualification with its native effort settings', () => {
  const sol = resolveResearchModelSelection('openai:gpt-6-sol');
  assert.equal(sol.providerModel, 'gpt-6-sol');
  assert.equal(sol.providerRoute, 'gpt');
  assert.deepEqual(sol.nativeSettings, { 'reasoning.effort': 'high' });
  for (const effort of ['none', 'low', 'medium', 'high', 'xhigh', 'max']) {
    assert.deepEqual(
      resolveResearchModelSelection('openai:gpt-6-sol', { 'reasoning.effort': effort }).nativeSettings,
      { 'reasoning.effort': effort }
    );
  }
});

test('GPT-6.1 Sol keeps its Codex subscription transport for qualification', () => {
  const sol = resolveResearchModelSelection('openai:gpt-6.1-sol');
  assert.equal(sol.providerModel, 'gpt-6.1-sol');
  assert.equal(sol.label, 'GPT-6.1 Sol');
  assert.deepEqual(sol.nativeSettings, { 'reasoning.effort': 'high' });
  assert.deepEqual(sol.requestPolicy, { store: false, stream: true });
  assert.equal(getResearchModel(sol.catalogId).api, 'codex-responses');
  assert.deepEqual(resolveResearchModelSelection(sol.catalogId, { 'reasoning.effort': 'ultra' }).nativeSettings,
    { 'reasoning.effort': 'ultra' });
  assert.throws(() => resolveResearchModelSelection(sol.catalogId, {
    'reasoning.effort': 'none'
  }), /must be one of/);
});

test('public Babel\'s GPT-6.1 Sol request is a generation route through the OpenAI API', () => {
  // The fixed request in publicApp/publicGeneration.ts.
  const request = { framework: 'minimalism', modelId: 'openai:gpt-6.1-sol', settings: { 'reasoning.effort': 'high' } };
  assert.deepEqual(validateParseBody({ sentence: 'What did Mia see?', ...request }),
    { sentence: 'What did Mia see?', ...request });

  const model = getGenerationModel(request.modelId);
  assert.equal(model.api, 'responses');
  assert.equal(model.generationRoute, undefined);
  assert.equal(model.documentation.url, 'https://developers.openai.com/api/docs/models/gpt-6.1-sol');
  const sol = resolveGenerationModelSelection(request.modelId, request.settings);
  assert.equal(sol.provider, 'openai');
  assert.equal(sol.providerModel, 'gpt-6.1-sol');
  assert.deepEqual(sol.nativeSettings, { 'reasoning.effort': 'high' });
  assert.deepEqual(sol.requestPolicy, { maxOutputTokens: 128000, background: true, store: true });
  // The API offers low to max; `ultra` is Codex-only.
  assert.deepEqual(model.controls[0].values, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.throws(() => resolveGenerationModelSelection(request.modelId, { 'reasoning.effort': 'ultra' }),
    /must be one of/);
  assert.throws(() => validateParseBody({ sentence: 'x', ...request, settings: { 'reasoning.effort': 'ultra' } }),
    /must be one of/);
});

test('every other generation route is its catalog entry unchanged', () => {
  for (const id of GENERATION_MODEL_IDS.filter((id) => id !== 'openai:gpt-6.1-sol')) {
    assert.equal(getGenerationModel(id), getResearchModel(id));
    assert.deepEqual(resolveGenerationModelSelection(id), resolveResearchModelSelection(id));
  }
  for (const id of ['openai:gpt-5.6-sol', 'anthropic:claude-opus-5-5', 'zai:glm-5.3-flash']) {
    assert.equal(getGenerationModel(id), null);
    assert.throws(() => resolveGenerationModelSelection(id), /Not enabled for generation/);
  }
});

// Each version of the generation routes and the fingerprint of what it sends. A change to
// the routes fails here until it gets a new MODEL_ROUTE_CONFIG_VERSION and its own row.
const ROUTE_CONFIG_FINGERPRINTS = {
  'model-routes-v1': 'b955defd64d2bf8548839f2c5f504a52095bf9d7dd5fb5375acb8034205a0cbb',
  'model-routes-v2': '9f61f5638d259a91c4d287a195b8e14a8d6a73cfd410927bf033738c3edf3c62'
};

test('the generation routes match their recorded version', () => {
  const routes = GENERATION_MODEL_IDS.map((id) => {
    const model = getGenerationModel(id);
    return { id, provider: model.provider, providerRoute: model.providerRoute, providerModel: model.providerModel,
      api: model.api, controls: model.controls, requestPolicy: model.requestPolicy };
  });
  const fingerprint = createHash('sha256').update(JSON.stringify(routes)).digest('hex');
  assert.equal(ROUTE_CONFIG_FINGERPRINTS[MODEL_ROUTE_CONFIG_VERSION], fingerprint,
    `The generation routes changed: give them a new MODEL_ROUTE_CONFIG_VERSION and fingerprint ${fingerprint}.`);
  assert.equal(new Set(Object.values(ROUTE_CONFIG_FINGERPRINTS)).size, Object.keys(ROUTE_CONFIG_FINGERPRINTS).length);
});

test('candidate identities and pending-settings gates remain exact', () => {
  const kimi = getResearchModel('moonshot:kimi-k3');
  assert.equal(kimi?.providerModel, 'kimi-k3');
  assert.deepEqual(kimi?.controls[0].values, ['low', 'high', 'max']);
  assert.equal(kimi?.requestPolicy.thinking.requestMode, 'implicit-always-on');

  const muse = getResearchModel('meta:muse-spark-1.2');
  assert.equal(muse?.providerModel, 'muse-spark-1.2');
  assert.deepEqual(muse?.controls, []);

  const grok = getResearchModel('xai:grok-4.6');
  assert.equal(grok?.providerModel, 'grok-4.6');
  assert.deepEqual(grok?.controls[0].values, ['low', 'medium', 'high', 'xhigh']);

  const glm = getResearchModel('zai:glm-5.3-flash');
  assert.equal(glm?.providerModel, 'glm-5.3-flash');
  assert.equal(glm?.api, 'chat-completions');
  assert.deepEqual(glm?.controls[0].values, ['low', 'high', 'max']);
  assert.equal(glm?.requestPolicy.maxTokens, 131072);
  assert.equal(glm?.requestPolicy.thinking.requestMode, 'implicit-always-on');

  for (const id of [
    'meta:muse-spark-1.2'
  ]) {
    assert.throws(
      () => resolveResearchModelSelection(id),
      /Qualification settings have not been finalized/
    );
  }
});

test('GLM qualifies at high while research retains every native effort', () => {
  assert.deepEqual(
    resolveResearchModelSelection('zai:glm-5.3-flash').nativeSettings,
    { reasoning_effort: 'high' }
  );

  for (const reasoningEffort of ['low', 'high', 'max']) {
    assert.deepEqual(
      resolveResearchModelSelection('zai:glm-5.3-flash', {
        reasoning_effort: reasoningEffort
      }).nativeSettings,
      { reasoning_effort: reasoningEffort }
    );
  }
});

test('catalog lookup and settings fail closed without coercion', () => {
  assert.equal(getResearchModel('openai:gpt-5.6-sol')?.providerModel, 'gpt-5.6-sol');
  assert.equal(getResearchModel('GPT 5.6 Sol'), null);
  assert.throws(
    () => resolveResearchModelSelection('openai:gpt-5.6-sol', { effort: 'high' }),
    /Unsupported settings/
  );
  assert.throws(
    () => resolveResearchModelSelection('anthropic:claude-opus-5', {
      'output_config.effort': 'extra-high'
    }),
    /must be one of/
  );
  assert.throws(
    () => resolveResearchModelSelection('anthropic:unknown'),
    /Unknown research model/
  );
});
