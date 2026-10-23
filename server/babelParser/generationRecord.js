import { createHash } from 'node:crypto';
import { SPELLOUT_CONTRACT_VERSION } from './spellout.js';

export const PROMPT_TEMPLATE_PROBE_SENTENCE = 'Babel provenance probe.';

/** Input tokens are the model's own words, aligned to the sentence by Babel's
 * spell-out check. Alignment uses the runtime's Unicode data, so a record names
 * both. */
export const describeInputTokenization = (versions = process.versions) => ({
  version: SPELLOUT_CONTRACT_VERSION,
  unicode: versions.unicode ?? null,
  icu: versions.icu ?? null,
  cldr: versions.cldr ?? null
});

export const sha256Hex = (value) =>
  createHash('sha256').update(String(value ?? '')).digest('hex');

const compactScalars = (value) => Object.fromEntries(
  Object.entries(value).filter(([, entry]) => (
    entry === null
    || typeof entry === 'string'
    || typeof entry === 'number'
    || typeof entry === 'boolean'
  ))
);

export const buildPromptContract = ({
  framework,
  promptRoute,
  systemInstruction,
  prompt,
  buildTemplate
}) => {
  const template = typeof buildTemplate === 'function'
    ? buildTemplate(PROMPT_TEMPLATE_PROBE_SENTENCE, framework, promptRoute)
    : '';
  const qualifiedTemplate = JSON.stringify({ framework, promptRoute, inputTokenization: SPELLOUT_CONTRACT_VERSION, template });
  return {
    framework,
    promptRoute,
    systemInstructionSha256: sha256Hex(systemInstruction),
    promptSha256: sha256Hex(prompt),
    promptTemplateSha256: sha256Hex(qualifiedTemplate)
  };
};

export const describeSentRequest = (provider, body = {}) => {
  if (provider === 'gpt' || provider === 'grok') {
    return compactScalars({
      model: body.model,
      textFormatType: body.text?.format?.type ?? 'text',
      reasoningEffort: body.reasoning?.effort,
      background: Boolean(body.background),
      store: Boolean(body.store),
      maxOutputTokens: body.max_output_tokens
    });
  }

  if (provider === 'claude') {
    return compactScalars({
      model: body.model,
      textFormatType: body.output_config?.format?.type ?? 'text',
      thinkingType: body.thinking?.type,
      thinkingDisplay: body.thinking?.display,
      effort: body.output_config?.effort,
      maxTokens: body.max_tokens
    });
  }

  if (provider === 'kimi') {
    return compactScalars({
      model: body.model,
      textFormatType: body.response_format?.type ?? 'text',
      reasoningEffort: body.reasoning_effort,
      maxCompletionTokens: body.max_completion_tokens
    });
  }

  return compactScalars({ model: body.model });
};

const extractPromptMaterial = (provider, body = {}) => {
  if (provider === 'kimi' || provider === 'grok') {
    const messages = provider === 'kimi' ? body.messages : body.input;
    return {
      systemInstruction: messages?.find((message) => message.role === 'system')?.content,
      prompt: messages?.find((message) => message.role === 'user')?.content
    };
  }
  if (provider === 'gpt') {
    return {
      systemInstruction: body.instructions,
      prompt: body.input
    };
  }
  if (provider === 'claude') {
    return {
      systemInstruction: body.system,
      prompt: body.messages?.[0]?.content
    };
  }
  return {};
};

export const buildGenerationRecord = ({
  provider,
  framework,
  promptRoute,
  sentRequest,
  requestStartedAt,
  durationMs,
  buildTemplate
}) => {
  const promptMaterial = extractPromptMaterial(provider, sentRequest);
  return {
    schemaVersion: 2,
    provider,
    sentRequestSha256: sha256Hex(JSON.stringify(sentRequest)),
    promptContract: buildPromptContract({
      framework,
      promptRoute,
      systemInstruction: promptMaterial.systemInstruction,
      prompt: promptMaterial.prompt,
      buildTemplate
    }),
    sentGenerationConfig: describeSentRequest(provider, sentRequest),
    inputTokenization: describeInputTokenization(),
    timing: {
      requestStartedAt: new Date(requestStartedAt).toISOString(),
      durationMs: Math.max(0, Number(durationMs) || 0)
    }
  };
};
