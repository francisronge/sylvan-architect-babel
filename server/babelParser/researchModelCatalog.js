const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

const EFFORT_LEVELS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);

export const RESEARCH_MODEL_CATALOG = deepFreeze([
  {
    id: 'openai:gpt-6-astra',
    label: 'GPT-6 Astra',
    provider: 'openai',
    providerRoute: 'gpt',
    providerModel: 'gpt-6-astra',
    qualificationStatus: 'unqualified',
    qualificationConfiguration: 'configured',
    api: 'responses',
    controls: [
      {
        id: 'reasoning.effort',
        label: 'Reasoning effort',
        values: ['low', 'medium', 'high', 'xhigh', 'max'],
        qualificationDefault: 'high'
      }
    ],
    requestPolicy: {
      maxOutputTokens: 128000,
      background: true,
      store: true
    },
    documentation: {
      retrievedOn: '2026-09-05',
      url: 'https://developers.openai.com/api/docs/models/gpt-6-astra'
    }
  },
  {
    id: 'openai:gpt-5.6-sol',
    label: 'GPT 5.6 Sol',
    provider: 'openai',
    providerRoute: 'gpt',
    providerModel: 'gpt-5.6-sol',
    qualificationStatus: 'unqualified',
    qualificationConfiguration: 'configured',
    api: 'responses',
    controls: [
      {
        id: 'reasoning.effort',
        label: 'Reasoning effort',
        values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
        qualificationDefault: 'high'
      }
    ],
    requestPolicy: {
      maxOutputTokens: 128000,
      background: true,
      store: true
    },
    documentation: {
      retrievedOn: '2026-09-05',
      url: 'https://developers.openai.com/api/docs/models/gpt-5.6-sol'
    }
  },
  {
    id: 'anthropic:claude-opus-5',
    label: 'Claude Opus 5',
    provider: 'anthropic',
    providerRoute: 'claude',
    providerModel: 'claude-opus-5',
    qualificationStatus: 'unqualified',
    qualificationConfiguration: 'configured',
    api: 'messages',
    controls: [
      {
        id: 'output_config.effort',
        label: 'Effort',
        values: EFFORT_LEVELS,
        qualificationDefault: 'high'
      }
    ],
    requestPolicy: {
      maxOutputTokens: 128000,
      thinking: {
        requestMode: 'explicit-adaptive',
        value: { type: 'adaptive', display: 'omitted' }
      },
      omitSamplingParameters: true
    },
    documentation: {
      retrievedOn: '2026-09-05',
      url: 'https://platform.claude.com/docs/en/models/overview'
    }
  },
  {
    id: 'anthropic:claude-fable-5-1',
    label: 'Claude Fable 5.1',
    provider: 'anthropic',
    providerRoute: 'claude',
    providerModel: 'claude-fable-5-1',
    qualificationStatus: 'unqualified',
    qualificationConfiguration: 'configured',
    api: 'messages',
    controls: [
      {
        id: 'output_config.effort',
        label: 'Effort',
        values: EFFORT_LEVELS,
        qualificationDefault: 'high'
      }
    ],
    requestPolicy: {
      maxOutputTokens: 128000,
      thinking: {
        requestMode: 'implicit-always-on'
      },
      omitSamplingParameters: true
    },
    constraints: {
      dataRetention: '30-days-required',
      zeroDataRetention: 'requires-explicit-authorization'
    },
    documentation: {
      retrievedOn: '2026-09-05',
      url: 'https://platform.claude.com/docs/en/models/fable-5-1/migration-guide'
    }
  },
  {
    id: 'moonshot:kimi-k3',
    label: 'Kimi K3',
    provider: 'moonshot',
    providerRoute: 'kimi',
    providerModel: 'kimi-k3',
    qualificationStatus: 'unqualified',
    qualificationConfiguration: 'configured',
    api: 'chat-completions',
    controls: [
      {
        id: 'reasoning_effort',
        label: 'Reasoning effort',
        values: ['low', 'high', 'max'],
        qualificationDefault: 'high'
      }
    ],
    requestPolicy: {
      maxCompletionTokens: 131072,
      thinking: {
        requestMode: 'implicit-always-on'
      }
    },
    documentation: {
      retrievedOn: '2026-09-05',
      url: 'https://platform.kimi.ai/docs/guide/kimi-k3-quickstart'
    }
  },
  {
    id: 'meta:muse-spark-1.2',
    label: 'Muse Spark 1.2',
    provider: 'meta',
    providerRoute: 'muse',
    providerModel: 'muse-spark-1.2',
    qualificationStatus: 'unqualified',
    qualificationConfiguration: 'pending-settings',
    api: 'openai-compatible',
    controls: [],
    requestPolicy: {},
    documentation: {
      retrievedOn: '2026-08-30',
      url: 'https://developer.meta.com/ai/models/muse-spark/'
    }
  },
  {
    id: 'xai:grok-4.6',
    label: 'Grok 4.6',
    provider: 'xai',
    providerRoute: 'grok',
    providerModel: 'grok-4.6',
    qualificationStatus: 'unqualified',
    qualificationConfiguration: 'configured',
    api: 'responses',
    controls: [
      {
        id: 'reasoning.effort',
        label: 'Reasoning effort',
        values: ['low', 'medium', 'high', 'xhigh'],
        qualificationDefault: 'high'
      }
    ],
    requestPolicy: {
      maxOutputTokens: 128000,
      store: false,
      reasoningCannotBeDisabled: true,
      omitParameters: ['presencePenalty', 'frequencyPenalty', 'stop']
    },
    documentation: {
      retrievedOn: '2026-09-05',
      url: 'https://docs.x.ai/developers/model-capabilities/text/reasoning'
    }
  },
  {
    id: 'zai:glm-5.3-flash',
    label: 'GLM 5.3 Flash',
    provider: 'zai',
    providerRoute: 'glm',
    providerModel: 'glm-5.3-flash',
    qualificationStatus: 'unqualified',
    qualificationConfiguration: 'configured',
    api: 'chat-completions',
    controls: [
      {
        id: 'reasoning_effort',
        label: 'Reasoning effort',
        values: ['low', 'high', 'max'],
        qualificationDefault: 'high'
      }
    ],
    requestPolicy: {
      maxTokens: 131072,
      thinking: {
        requestMode: 'implicit-always-on'
      }
    },
    documentation: {
      retrievedOn: '2026-08-30',
      url: 'https://docs.z.ai/guides/vlm/glm-5.3-flash'
    }
  }
]);

const MODEL_BY_ID = new Map(RESEARCH_MODEL_CATALOG.map((entry) => [entry.id, entry]));

// Available for local integration testing, not yet qualified for public release.
export const GENERATION_MODEL_IDS = Object.freeze([
  'openai:gpt-6-astra',
  'openai:gpt-5.6-sol',
  'anthropic:claude-opus-5',
  'anthropic:claude-fable-5-1',
  'moonshot:kimi-k3',
  'xai:grok-4.6'
]);

export const getResearchModel = (modelId) => MODEL_BY_ID.get(String(modelId || '').trim()) || null;

export const resolveResearchModelSelection = (modelId, requestedSettings = {}) => {
  const model = getResearchModel(modelId);
  if (!model) throw new TypeError(`Unknown research model: ${String(modelId || '')}`);
  if (model.qualificationConfiguration !== 'configured') {
    throw new TypeError(
      `Qualification settings have not been finalized for ${model.id}.`
    );
  }
  if (!requestedSettings || typeof requestedSettings !== 'object' || Array.isArray(requestedSettings)) {
    throw new TypeError('Research model settings must be an object.');
  }

  const controlById = new Map(model.controls.map((control) => [control.id, control]));
  const unknownSettings = Object.keys(requestedSettings).filter((key) => !controlById.has(key));
  if (unknownSettings.length > 0) {
    throw new TypeError(`Unsupported settings for ${model.id}: ${unknownSettings.join(', ')}`);
  }

  const nativeSettings = Object.fromEntries(model.controls.map((control) => {
    const requested = Object.prototype.hasOwnProperty.call(requestedSettings, control.id)
      ? String(requestedSettings[control.id] || '').trim()
      : control.qualificationDefault;
    if (!control.values.includes(requested)) {
      throw new TypeError(
        `${control.id} for ${model.id} must be one of: ${control.values.join(', ')}.`
      );
    }
    return [control.id, requested];
  }));

  return deepFreeze({
    catalogId: model.id,
    label: model.label,
    provider: model.provider,
    providerRoute: model.providerRoute,
    providerModel: model.providerModel,
    qualificationStatus: model.qualificationStatus,
    nativeSettings,
    requestPolicy: model.requestPolicy,
    ...(model.constraints ? { constraints: model.constraints } : {})
  });
};
