import { delayWithAbort, fetchProvider, mutableProviderError, readResponseText, withTimeout } from './providerTransport.js';
import fs from 'node:fs';
import path from 'node:path';
import { OPENAI_BACKGROUND_POLL_INTERVAL_MS } from './routeConfig.js';

// Debug payloads hold user sentences and raw model output, so only the owner may read them.
const writePrivateDebugFile = (fileName, contents) => {
  const dir = path.resolve(process.cwd(), '.artifacts', 'debug-model-payloads');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, fileName);
  fs.writeFileSync(file, contents, { encoding: 'utf8', mode: 0o600 });
  return file;
};

export const writeDebugModelPayload = ({ stage = 'unknown', model = 'unknown', sentence = '', rawText = '' }) => {
  if (process.env.NODE_ENV === 'production') return null;
  try {
    const safeStage = String(stage || 'unknown').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
    const safeModel = String(model || 'unknown').replace(/[^a-z0-9._-]+/gi, '-').toLowerCase();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return writePrivateDebugFile(`${timestamp}-${safeStage}-${safeModel}.txt`, [
      `sentence: ${sentence}`,
      `model: ${model}`,
      `stage: ${stage}`,
      '',
      String(rawText || '')
    ].join('\n'));
  } catch {
    return null;
  }
};

const OPENAI_RESPONSE_PENDING_STATUSES = new Set(['queued', 'in_progress']);

const fetchOpenAIResponseJson = async ({ apiKey, responseId, abortSignal }) => {
  const response = await fetchProvider(`https://api.openai.com/v1/responses/${encodeURIComponent(responseId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    signal: abortSignal
  });
  const payload = await readResponseText(response, abortSignal);
  if (!response.ok) {
    const error = new Error(String(payload.json?.error?.message || payload.text || `OpenAI response polling failed (${response.status})`));
    error.status = response.status;
    error.code = payload.json?.error?.code;
    error.responseBody = payload.text;
    throw error;
  }
  return payload;
};

const cancelOpenAIBackgroundResponse = async ({ apiKey, responseId }) => {
  const normalizedResponseId = String(responseId || '').trim();
  if (!normalizedResponseId) return false;
  try {
    return await withTimeout(async (abortSignal) => {
      const response = await fetchProvider(
        `https://api.openai.com/v1/responses/${encodeURIComponent(normalizedResponseId)}/cancel`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          signal: abortSignal
        }
      );
      await response.body?.cancel();
      return response.ok;
    }, 5000, 'OpenAI background cancellation');
  } catch {
    return false;
  }
};

const writeOpenAIDebugResponseState = ({ model, responseId, stage, payload }) => {
  if (process.env.NODE_ENV === 'production') return null;
  try {
    const safeModel = String(model || 'unknown').replace(/[^a-z0-9._-]+/gi, '-').toLowerCase();
    const safeId = String(responseId || 'no-id').replace(/[^a-z0-9._-]+/gi, '-').toLowerCase();
    const safeStage = String(stage || 'state').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return writePrivateDebugFile(`${timestamp}-openai-${safeStage}-${safeModel}-${safeId}.json`,
      `${JSON.stringify(payload, null, 2)}\n`);
  } catch {
    return null;
  }
};

const waitForOpenAIResponseCompletion = async ({
  apiKey,
  initialPayload,
  pollIntervalMs,
  model,
  abortSignal
}) => {
  let payload = initialPayload;
  let json = payload.json;
  const responseId = String(json?.id || '').trim();
  if (!responseId) return payload;
  writeOpenAIDebugResponseState({ model, responseId, stage: 'created', payload: json });

  while (OPENAI_RESPONSE_PENDING_STATUSES.has(String(json?.status || '').toLowerCase())) {
    await delayWithAbort(pollIntervalMs, abortSignal);
    payload = await fetchOpenAIResponseJson({ apiKey, responseId, abortSignal });
    json = payload.json;
    writeOpenAIDebugResponseState({ model, responseId, stage: 'polled', payload: json });
  }
  return payload;
};

const extractOpenAIOutputText = (payloadJson) => String(payloadJson?.output_text || '')
  || (Array.isArray(payloadJson?.output)
    ? payloadJson.output
      .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
      .filter((part) => part?.type === 'output_text')
      .map((part) => String(part.text || ''))
      .join('')
    : '');

export const buildOpenAIRequestBody = ({
  model,
  contents,
  systemInstruction,
  maxOutputTokens,
  reasoningEffort,
  background
}) => ({
  model,
  instructions: systemInstruction,
  input: contents,
  reasoning: { effort: reasoningEffort },
  ...(background ? { background: true, store: true } : {}),
  max_output_tokens: maxOutputTokens
});

export const generateOpenAIStructuredContent = async ({
  apiKey,
  model,
  contents,
  systemInstruction,
  maxOutputTokens,
  reasoningEffort,
  background,
  pollIntervalMs = OPENAI_BACKGROUND_POLL_INTERVAL_MS,
  abortSignal
}) => {
  const response = await fetchProvider('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(buildOpenAIRequestBody({
      model,
      contents,
      systemInstruction,
      maxOutputTokens,
      reasoningEffort,
      background
    })),
    signal: abortSignal
  });

  const payload = await readResponseText(response, abortSignal);
  if (!response.ok) {
    const error = new Error(String(payload.json?.error?.message || payload.text || `OpenAI request failed (${response.status})`));
    error.status = response.status;
    error.code = payload.json?.error?.code;
    error.responseBody = payload.text;
    throw error;
  }

  const backgroundResponseId = background ? String(payload.json?.id || '').trim() : '';
  if (background) {
    try {
      const completedPayload = await waitForOpenAIResponseCompletion({
        apiKey,
        initialPayload: payload,
        pollIntervalMs,
        model,
        abortSignal
      });
      payload.text = completedPayload.text;
      payload.json = completedPayload.json;
    } catch (error) {
      // Best-effort and unawaited so cancellation never delays or replaces the original failure.
      void cancelOpenAIBackgroundResponse({ apiKey, responseId: backgroundResponseId });
      // Polling failure belongs to this response, never to a replacement creation.
      const providerError = mutableProviderError(error);
      if (backgroundResponseId) providerError.providerResponseId = backgroundResponseId;
      throw providerError;
    }
  }

  if (payload.json?.status === 'failed' || payload.json?.status === 'cancelled') {
    const errorMessage = String(payload.json?.error?.message || `OpenAI response ${payload.json.status}.`);
    const error = new Error(errorMessage);
    error.status = 502;
    error.code = payload.json?.error?.code;
    error.responseBody = payload.text;
    error.completedStopState = true;
    error.finishReason = String(payload.json.status).toUpperCase();
    throw error;
  }

  return responsesGeneration(payload);
};

const responsesGeneration = (payload) => {
  const outputText = extractOpenAIOutputText(payload.json);
  const responseStatus = String(payload.json?.status || 'unknown').toLowerCase();
  const incompleteReason = String(payload.json?.incomplete_details?.reason || '').trim();
  const finishReason = responseStatus === 'incomplete'
    ? `INCOMPLETE_${incompleteReason || 'UNKNOWN'}`
    : responseStatus;

  return {
    text: outputText,
    rawProviderResponse: payload.text,
    returnedModel: payload.json?.model,
    status: responseStatus,
    candidates: [{ finishReason: finishReason.toUpperCase() }],
    usageMetadata: {
      inputTokenCount: payload.json?.usage?.input_tokens,
      outputTokenCount: payload.json?.usage?.output_tokens,
      totalTokenCount: payload.json?.usage?.total_tokens,
      reasoningTokenCount: payload.json?.usage?.output_tokens_details?.reasoning_tokens
    }
  };
};

export const buildAnthropicRequestBody = ({
  model,
  contents,
  systemInstruction,
  maxOutputTokens,
  effort,
  thinking
}) => ({
  model,
  system: systemInstruction,
  messages: [{ role: 'user', content: contents }],
  ...(thinking ? { thinking } : {}),
  output_config: { effort },
  max_tokens: maxOutputTokens
});

export const generateAnthropicStructuredContent = async ({
  apiKey,
  model,
  contents,
  systemInstruction,
  maxOutputTokens,
  effort,
  thinking,
  abortSignal
}) => {
  const response = await fetchProvider('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(buildAnthropicRequestBody({
      model,
      contents,
      systemInstruction,
      maxOutputTokens,
      effort,
      thinking
    })),
    signal: abortSignal
  });

  const payload = await readResponseText(response, abortSignal);
  if (!response.ok) {
    const error = new Error(String(payload.json?.error?.message || payload.text || `Anthropic request failed (${response.status})`));
    error.status = response.status;
    error.responseBody = payload.text;
    throw error;
  }

  const outputText = Array.isArray(payload.json?.content)
    ? payload.json.content
      .filter((part) => part?.type === 'text')
      .map((part) => String(part.text || ''))
      .join('')
    : '';

  return {
    text: outputText,
    rawProviderResponse: payload.text,
    returnedModel: payload.json?.model,
    status: String(payload.json?.stop_reason || 'UNKNOWN').toUpperCase(),
    candidates: [{ finishReason: String(payload.json?.stop_reason || 'UNKNOWN').toUpperCase() }],
    usageMetadata: {
      inputTokenCount: payload.json?.usage?.input_tokens,
      outputTokenCount: payload.json?.usage?.output_tokens,
      reasoningTokenCount: payload.json?.usage?.output_tokens_details?.thinking_tokens,
      totalTokenCount: (
        Number(payload.json?.usage?.input_tokens || 0) +
        Number(payload.json?.usage?.output_tokens || 0)
      ) || undefined
    }
  };
};

export const buildKimiRequestBody = ({ model, contents, systemInstruction, maxOutputTokens, reasoningEffort }) => ({
  model,
  messages: [
    { role: 'system', content: systemInstruction },
    { role: 'user', content: contents }
  ],
  reasoning_effort: reasoningEffort,
  max_completion_tokens: maxOutputTokens
});

export const buildGrokRequestBody = ({ model, contents, systemInstruction, maxOutputTokens, reasoningEffort }) => ({
  model,
  input: [
    { role: 'system', content: systemInstruction },
    { role: 'user', content: contents }
  ],
  reasoning: { effort: reasoningEffort },
  max_output_tokens: maxOutputTokens,
  store: false
});

const requestProviderJson = async (url, apiKey, body, abortSignal, provider) => {
  const response = await fetchProvider(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: abortSignal
  });
  const payload = await readResponseText(response, abortSignal);
  if (!response.ok) {
    const error = new Error(`${provider} request failed (${response.status}).`);
    error.status = response.status;
    error.responseBody = payload.text;
    throw error;
  }
  return payload;
};

export const generateKimiStructuredContent = async (options) => {
  const payload = await requestProviderJson(
    'https://api.moonshot.ai/v1/chat/completions', options.apiKey,
    buildKimiRequestBody(options), options.abortSignal, 'Kimi'
  );
  const choice = payload.json?.choices?.[0];
  return {
    text: typeof choice?.message?.content === 'string' ? choice.message.content : '',
    rawProviderResponse: payload.text,
    returnedModel: payload.json?.model,
    status: String(choice?.finish_reason || 'UNKNOWN').toUpperCase(),
    candidates: [{ finishReason: String(choice?.finish_reason || 'UNKNOWN').toUpperCase() }],
    usageMetadata: {
      inputTokenCount: payload.json?.usage?.prompt_tokens,
      outputTokenCount: payload.json?.usage?.completion_tokens,
      totalTokenCount: payload.json?.usage?.total_tokens,
      reasoningTokenCount: payload.json?.usage?.completion_tokens_details?.reasoning_tokens
    }
  };
};

export const generateGrokStructuredContent = async (options) => {
  const payload = await requestProviderJson(
    'https://api.x.ai/v1/responses', options.apiKey,
    buildGrokRequestBody(options), options.abortSignal, 'xAI'
  );
  return responsesGeneration(payload);
};
