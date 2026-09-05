import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RESEARCH_MODEL_CATALOG,
  getResearchModel,
  resolveResearchModelSelection
} from '../server/babelParser/researchModelCatalog.js';

test('the research catalog contains the approved unqualified candidates', () => {
  assert.deepEqual(
    RESEARCH_MODEL_CATALOG.map((entry) => entry.id),
    [
      'openai:gpt-6-astra',
      'openai:gpt-5.6-sol',
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
