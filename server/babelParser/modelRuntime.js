import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ParseApiError } from './error.js';
import { withFailureDetails } from './validationErrors.js';
import {
  ANTHROPIC_EFFORT,
  ANTHROPIC_THINKING_CONFIG,
  DEFAULT_MAX_OUTPUT_TOKENS,
  LOCAL_MODEL_COMMAND,
  LOCAL_MODEL_MAX_OUTPUT_TOKENS,
  LOCAL_MODEL_NAME,
  LOCAL_MODEL_NUM_CTX,
  LOCAL_MODEL_TIMEOUT_MS,
  LOCAL_MODEL_URL,
  MODEL_TEMPERATURE,
  OPENAI_BACKGROUND_POLL_INTERVAL_MS,
  OPENAI_BACKGROUND_RESPONSES,
  OPENAI_REASONING_EFFORT
} from './routeConfig.js';

export const getErrorMeta = (error) => {
  const msg = String(error?.message || '');
  let details = '';
  try {
    details = JSON.stringify(error || {});
  } catch {
    details = '';
  }
  const haystack = `${msg}\n${details}`.toLowerCase();
  const statusCode = Number(
    error?.status ??
    error?.response?.status ??
    (typeof error?.code === 'number' ? error.code : NaN)
  );
  return { msg, haystack, statusCode };
};

export const isNetworkTransportError = (error) => {
  const { haystack } = getErrorMeta(error);
  return (
    haystack.includes('fetch failed') ||
    haystack.includes('network') ||
    haystack.includes('timed out') ||
    haystack.includes('econnreset') ||
    haystack.includes('etimedout') ||
    haystack.includes('enotfound') ||
    haystack.includes('socket')
  );
};

const getErrorChain = (error) => {
  const chain = [];
  for (let current = error; current && chain.length < 8 && !chain.includes(current); current = current.cause) {
    chain.push(current);
  }
  return chain;
};

const mutableProviderError = (error) => {
  if (error instanceof Error && Object.isExtensible(error)) return error;
  return Object.assign(
    new Error(String(error?.message ?? error ?? 'Provider request failed.'), { cause: error }),
    error && typeof error === 'object' ? error : {},
    { cause: error }
  );
};

export const summarizeErrorForLog = (error) => {
  const { msg, statusCode } = getErrorMeta(error);
  const cause = getErrorChain(error).at(-1);
  const shortMessage = String(msg || '')
    .replace(/\s+/g, ' ')
    .slice(0, 220);
  return {
    statusCode: Number.isFinite(statusCode) ? statusCode : undefined,
    message: shortMessage || undefined,
    ...(error?.code ? { code: error.code } : {}),
    ...(cause && cause !== error ? {
      causeCode: cause.code,
      causeMessage: String(cause.message || '').replace(/\s+/g, ' ').slice(0, 220)
    } : {}),
    ...(error?.providerResponseId ? { responseId: error.providerResponseId } : {})
  };
};

export const withTimeout = async (run, timeoutMs, label) => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return run(undefined);
  }

  const controller = new AbortController();
  let timeoutId = null;
  const timeoutError = new Error(`${label} timed out after ${timeoutMs}ms.`);
  timeoutError.code = 'PROVIDER_TIMEOUT';
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort(timeoutError);
          reject(timeoutError);
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

export const extractLocalModelResponseText = (payload) => {
  if (typeof payload === 'string') return payload.trim();
  if (!payload || typeof payload !== 'object') return '';
  if (Array.isArray(payload?.analyses)) return JSON.stringify(payload);
  if (typeof payload.response === 'string') return payload.response.trim();
  if (typeof payload.output === 'string') return payload.output.trim();
  if (typeof payload.text === 'string') return payload.text.trim();
  const firstChoice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  const content = firstChoice?.message?.content ?? firstChoice?.text;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();
  }
  return '';
};

const normalizeLocalTransportText = (rawText) => {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed);
    return extractLocalModelResponseText(parsed) || trimmed;
  } catch {
    return trimmed;
  }
};

export const resolveLocalMaxOutputTokens = (requestedMaxOutputTokens) => {
  const requested = Number(requestedMaxOutputTokens);
  if (!Number.isFinite(requested) || requested <= 0) {
    return LOCAL_MODEL_MAX_OUTPUT_TOKENS;
  }
  return Math.max(256, Math.min(requested, LOCAL_MODEL_MAX_OUTPUT_TOKENS));
};

export const buildLocalRequestBody = ({
  transport = 'http',
  sentence,
  framework,
  systemInstruction,
  prompt,
  temperature,
  maxOutputTokens,
  format = 'json'
}) => {
  const resolvedMaxOutputTokens = resolveLocalMaxOutputTokens(maxOutputTokens);
  if (transport === 'command') {
    return {
      sentence,
      framework,
      model: LOCAL_MODEL_NAME,
      systemInstruction,
      prompt,
      temperature,
      maxOutputTokens: resolvedMaxOutputTokens,
      format,
      numCtx: LOCAL_MODEL_NUM_CTX,
      think: false
    };
  }
  return {
    model: LOCAL_MODEL_NAME,
    system: systemInstruction,
    prompt,
    format,
    stream: false,
    think: false,
    options: {
      temperature,
      num_predict: resolvedMaxOutputTokens,
      num_ctx: LOCAL_MODEL_NUM_CTX
    }
  };
};

const invokeLocalModelCommand = async ({
  sentence,
  framework,
  systemInstruction,
  prompt,
  temperature,
  maxOutputTokens,
  format = 'json',
  timeoutMs
}) => {
  const requestBody = buildLocalRequestBody({
    transport: 'command',
    sentence,
    framework,
    systemInstruction,
    prompt,
    temperature,
    maxOutputTokens,
    format
  });
  const result = spawnSync(LOCAL_MODEL_COMMAND, {
    shell: true,
    input: JSON.stringify(requestBody),
    encoding: 'utf8',
    timeout: Math.max(0, Number(timeoutMs || LOCAL_MODEL_TIMEOUT_MS)),
    maxBuffer: 25 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || `Local command exited with status ${result.status}`));
  }
  return normalizeLocalTransportText(result.stdout || '');
};

const invokeLocalModelHttp = async ({
  systemInstruction,
  prompt,
  temperature,
  maxOutputTokens,
  timeoutMs,
  format = 'json'
}) => {
  const requestBody = buildLocalRequestBody({
    transport: 'http',
    systemInstruction,
    prompt,
    temperature,
    maxOutputTokens,
    format
  });
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), Math.max(0, Number(timeoutMs || LOCAL_MODEL_TIMEOUT_MS)));
  try {
    const response = await fetch(LOCAL_MODEL_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: abortController.signal
    });
    const responseText = await response.text();
    if (!response.ok) {
      const error = new Error(String(responseText || `Local model HTTP transport failed (${response.status})`));
      error.status = response.status;
      throw error;
    }
    return normalizeLocalTransportText(responseText || '');
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`Local model HTTP transport timed out after ${Math.max(0, Number(timeoutMs || LOCAL_MODEL_TIMEOUT_MS))} ms`);
      timeoutError.status = 408;
      throw timeoutError;
    }
    if (error?.cause?.message) {
      error.message = `${error.message}: ${error.cause.message}`;
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
};

export const generateStructuredLocalContent = async ({
  sentence,
  framework,
  systemInstruction,
  prompt,
  temperature,
  maxOutputTokens,
  timeoutMs = LOCAL_MODEL_TIMEOUT_MS,
  format = 'json'
}) => {
  if (LOCAL_MODEL_COMMAND) {
    return invokeLocalModelCommand({
      sentence,
      framework,
      systemInstruction,
      prompt,
      temperature,
      maxOutputTokens: resolveLocalMaxOutputTokens(maxOutputTokens),
      timeoutMs,
      format
    });
  }
  return invokeLocalModelHttp({
    systemInstruction,
    prompt,
    temperature,
    maxOutputTokens: resolveLocalMaxOutputTokens(maxOutputTokens),
    timeoutMs,
    format
  });
};

export const isTruncatedGeneration = (generation) => {
  const finishReason = String(generation?.candidates?.[0]?.finishReason || '').toUpperCase();
  return (
    finishReason.includes('MAX_TOKENS')
    || finishReason.includes('MAX_OUTPUT_TOKENS')
    || finishReason.includes('LENGTH')
  );
};

const SUCCESSFUL_GENERATION_STOPS = new Set([
  'COMPLETED',
  'END_TURN',
  'STOP',
  'STOP_SEQUENCE'
]);

export const isSuccessfulGenerationStop = (generation) => {
  const finishReason = String(generation?.candidates?.[0]?.finishReason || '').toUpperCase();
  return SUCCESSFUL_GENERATION_STOPS.has(finishReason);
};

export const summarizeGeneration = (generation) => {
  const contentParts = Array.isArray(generation?.candidates?.[0]?.content?.parts)
    ? generation.candidates[0].content.parts
    : [];
  const nonThoughtText = contentParts
    .filter((part) => !part?.thought && typeof part?.text === 'string')
    .map((part) => String(part.text || ''))
    .join('');
  const rawText = String(nonThoughtText || generation?.text || '');
  const finishReason = String(generation?.candidates?.[0]?.finishReason || '').toUpperCase() || 'UNKNOWN';
  const status = String(generation?.status || finishReason || 'UNKNOWN').toUpperCase();
  const promptTokenCount = Number(
    generation?.usageMetadata?.promptTokenCount
    || generation?.usageMetadata?.inputTokenCount
    || generation?.usageMetadata?.promptTokens
    || 0
  ) || undefined;
  const outputTokenCount = Number(
    generation?.usageMetadata?.candidatesTokenCount
    || generation?.usageMetadata?.outputTokenCount
    || generation?.usageMetadata?.completionTokenCount
    || 0
  ) || undefined;
  const totalTokenCount = Number(
    generation?.usageMetadata?.totalTokenCount
    || generation?.usageMetadata?.totalTokens
    || 0
  ) || (promptTokenCount && outputTokenCount ? (promptTokenCount + outputTokenCount) : undefined);
  const preview = rawText
    .slice(0, 220)
    .replace(/\s+/g, ' ')
    .trim();
  return {
    rawText,
    finishReason,
    textLength: rawText.length,
    preview,
    promptTokenCount,
    outputTokenCount,
    totalTokenCount,
    reasoningTokenCount: Number(
      generation?.usageMetadata?.reasoningTokenCount
      || generation?.usageMetadata?.thoughtsTokenCount
      || generation?.usageMetadata?.totalThoughtTokens
      || 0
    ) || undefined,
    status
  };
};

export const assertGenerationComplete = ({
  generation,
  provider,
  model,
  sentMaxOutputTokens,
  runId,
  attempts = []
}) => {
  const generationMeta = summarizeGeneration(generation);
  const lengthStop = isTruncatedGeneration(generation);
  if (!lengthStop && isSuccessfulGenerationStop(generation)) return generationMeta;

  const ruleId = lengthStop
    ? 'GENERATION_LENGTH_STOP'
    : 'GENERATION_COMPLETED_STOP_FAILURE';
  const message = lengthStop
    ? `The ${provider} generation stopped at its output limit before parsing.`
    : `The ${provider} generation completed with ${generationMeta.finishReason} instead of a successful stop.`;

  throw new ParseApiError(
    'INCOMPLETE_GENERATION',
    message,
    422,
    withFailureDetails({
      provider,
      model,
      sentMaxOutputTokens,
      finishReason: generationMeta.finishReason,
      finishStatus: generationMeta.status,
      reasoningTokenCount: generationMeta.reasoningTokenCount,
      outputTokenCount: generationMeta.outputTokenCount,
      runId,
      attempts
    }, {
      failureClass: 'incomplete_generation',
      ruleId,
      stageIndex: null,
      fieldPath: '$',
      offendingValue: {
        finishReason: generationMeta.finishReason,
        finishStatus: generationMeta.status,
        sentMaxOutputTokens
      }
    }, generationMeta.rawText)
  );
};

export const buildGenerationOutcome = ({
  generationMeta,
  sentMaxOutputTokens,
  runId,
  attempts = []
}) => ({
  sentMaxOutputTokens,
  finishReason: generationMeta.finishReason,
  finishStatus: generationMeta.status,
  ...(generationMeta.reasoningTokenCount
    ? { reasoningTokenCount: generationMeta.reasoningTokenCount }
    : {}),
  ...(generationMeta.promptTokenCount
    ? { promptTokenCount: generationMeta.promptTokenCount }
    : {}),
  ...(generationMeta.outputTokenCount
    ? { outputTokenCount: generationMeta.outputTokenCount }
    : {}),
  ...(generationMeta.totalTokenCount
    ? { totalTokenCount: generationMeta.totalTokenCount }
    : {}),
  runId,
  attempts
});

const retryDelay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const providerFailureReason = (error) => {
  const chain = getErrorChain(error);
  if (chain.some((cause) => cause.completedStopState)) return 'completed_stop';
  if (chain.some((cause) => cause.providerResponseId)) return 'existing_response';
  if (chain.some((cause) => cause.responseReceived)) return 'received_answer';
  // Babel's typed errors include parsing/validation and the route's deadline guard.
  if (chain.some((cause) => cause instanceof ParseApiError || cause instanceof SyntaxError)) {
    return 'application_failure';
  }
  const metadata = chain.map(getErrorMeta);
  const statuses = metadata.map(({ statusCode }) => statusCode);
  const haystack = metadata.map(({ haystack }, index) => (
    `${chain[index]?.name || ''}\n${chain[index]?.code || ''}\n${haystack}`
  )).join('\n').toLowerCase();
  if (statuses.includes(429) || /rate[\s_-]*limit|resource_exhausted|quota|too many requests/.test(haystack)) {
    return 'rate_limit';
  }
  // A timeout does not prove that a submitted generation stopped or never started.
  if (statuses.includes(408) || statuses.includes(504) || /timeout|timed[\s_-]*out|etimedout|aborterror|abort_err|aborted|cancelled|canceled|deadline/.test(haystack)) {
    return 'uncertain_timeout';
  }
  if (statuses.some((status) => status >= 400 && status < 500)) return 'non_retryable_http';
  const status = statuses.find((value) => Number.isFinite(value) && value >= 400);
  if (status !== undefined) {
    return [500, 502, 503, 529].includes(status) ? 'transient_server_failure' : 'non_retryable_http';
  }
  if (/fetch failed|failed to fetch|network error|network request failed|socket hang up|econnreset|econnrefused|epipe|eai_again|enotfound|und_err_socket/.test(haystack)) {
    return 'transient_transport_failure';
  }
  return 'unclassified_failure';
};

export const isRetryableProviderFailure = (error) => (
  ['transient_transport_failure', 'transient_server_failure'].includes(providerFailureReason(error))
);

export const runWithTransportRetries = async ({
  run,
  maxAttempts = 3,
  backoffBaseMs = 250,
  // Absolute epoch milliseconds; the caller still bounds each in-flight call.
  deadlineAt = Number.POSITIVE_INFINITY,
  delay = retryDelay,
  now = () => new Date(),
  runId = randomUUID()
}) => {
  const boundedMaxAttempts = Math.max(1, Math.min(3, Math.floor(Number(maxAttempts)) || 1));
  const attempts = [];
  let lastFailure;
  const terminalFailure = (error, retryStopReason) => {
    const terminalError = mutableProviderError(error);
    if (attempts.length) attempts.at(-1).retryStopReason = retryStopReason;
    terminalError.providerRunId = runId;
    terminalError.providerAttempts = attempts;
    terminalError.providerRetryStopReason = retryStopReason;
    terminalError.details = {
      ...(terminalError.details && typeof terminalError.details === 'object' ? terminalError.details : {}),
      providerRunId: runId,
      providerAttempts: attempts,
      providerRetryStopReason: retryStopReason
    };
    return terminalError;
  };

  for (let attemptNumber = 1; attemptNumber <= boundedMaxAttempts; attemptNumber += 1) {
    const startedAt = now();
    if (Number.isFinite(deadlineAt) && startedAt.getTime() >= deadlineAt) {
      const error = lastFailure || Object.assign(new Error('Provider request deadline exhausted.'), {
        code: 'PROVIDER_DEADLINE_EXCEEDED'
      });
      throw terminalFailure(error, 'deadline_exhausted');
    }
    let receivedAnswer = false;
    try {
      const value = await run({ attemptNumber, runId });
      receivedAnswer = true;
      const generationMeta = summarizeGeneration(value);
      attempts.push({
        attemptNumber,
        startedAt: startedAt.toISOString(),
        completedAt: now().toISOString(),
        outcome: 'completed',
        finishReason: generationMeta.finishReason,
        finishStatus: generationMeta.status
      });
      return { value, runId, attempts };
    } catch (error) {
      lastFailure = error;
      const retryReason = receivedAnswer ? 'received_answer' : providerFailureReason(error);
      const retryable = ['transient_transport_failure', 'transient_server_failure'].includes(retryReason);
      attempts.push({
        attemptNumber,
        startedAt: startedAt.toISOString(),
        completedAt: now().toISOString(),
        outcome: retryable ? 'retryable_transport_failure' : 'terminal_failure',
        retryReason,
        ...summarizeErrorForLog(error)
      });
      if (!retryable || attemptNumber >= boundedMaxAttempts) {
        throw terminalFailure(error, retryable ? 'attempt_limit' : 'not_retryable');
      }
      const backoffMs = backoffBaseMs * (2 ** (attemptNumber - 1));
      if (Number.isFinite(deadlineAt) && now().getTime() + backoffMs >= deadlineAt) {
        throw terminalFailure(error, 'deadline_exhausted');
      }
      try {
        await delay(backoffMs);
      } catch (delayError) {
        throw terminalFailure(delayError, 'backoff_failed');
      }
    }
  }

  throw new Error('Provider retry loop exhausted unexpectedly.');
};

export const writeDebugModelPayload = ({ stage = 'unknown', model = 'unknown', sentence = '', rawText = '' }) => {
  if (process.env.NODE_ENV === 'production') return null;
  try {
    const dir = path.resolve(process.cwd(), '.artifacts', 'debug-model-payloads');
    fs.mkdirSync(dir, { recursive: true });
    const safeStage = String(stage || 'unknown').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
    const safeModel = String(model || 'unknown').replace(/[^a-z0-9._-]+/gi, '-').toLowerCase();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `${timestamp}-${safeStage}-${safeModel}.txt`);
    fs.writeFileSync(
      file,
      [
        `sentence: ${sentence}`,
        `model: ${model}`,
        `stage: ${stage}`,
        '',
        String(rawText || '')
      ].join('\n'),
      'utf8'
    );
    return file;
  } catch {
    return null;
  }
};

export const buildGeminiGenerationRequest = ({
  model,
  contents,
  systemInstruction,
  temperature = MODEL_TEMPERATURE,
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
  responseJsonSchema,
  abortSignal,
  thinkingConfig
}) => ({
  model,
  contents,
  config: {
    systemInstruction,
    responseMimeType: 'application/json',
    maxOutputTokens,
    temperature,
    ...(responseJsonSchema ? { responseJsonSchema } : {}),
    ...(thinkingConfig ? { thinkingConfig } : {}),
    abortSignal
  }
});

export const generateStructuredContent = async ({
  ai,
  model,
  contents,
  systemInstruction,
  temperature = MODEL_TEMPERATURE,
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
  responseJsonSchema,
  abortSignal,
  thinkingConfig
}) => {
  return ai.models.generateContent(buildGeminiGenerationRequest({
    model,
    contents,
    systemInstruction,
    temperature,
    maxOutputTokens,
    responseJsonSchema,
    abortSignal,
    thinkingConfig
  }));
};

const readResponseText = async (response) => {
  let text;
  try {
    text = await response.text();
  } catch (error) {
    throw Object.assign(mutableProviderError(error), {
      status: response.status,
      responseReceived: response.ok
    });
  }
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { text, json: null };
  }
};

const delayWithAbort = (ms, abortSignal) => new Promise((resolve, reject) => {
  if (abortSignal?.aborted) {
    reject(abortSignal.reason || new Error('Operation aborted.'));
    return;
  }
  const timeout = setTimeout(() => {
    abortSignal?.removeEventListener?.('abort', onAbort);
    resolve();
  }, Math.max(0, ms));
  const onAbort = () => {
    clearTimeout(timeout);
    reject(abortSignal.reason || new Error('Operation aborted.'));
  };
  abortSignal?.addEventListener?.('abort', onAbort, { once: true });
});

const OPENAI_RESPONSE_PENDING_STATUSES = new Set(['queued', 'in_progress']);

const fetchOpenAIResponseJson = async ({ apiKey, responseId, abortSignal }) => {
  const response = await fetch(`https://api.openai.com/v1/responses/${encodeURIComponent(responseId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    signal: abortSignal
  });
  const payload = await readResponseText(response);
  if (!response.ok) {
    const error = new Error(String(payload.json?.error?.message || payload.text || `OpenAI response polling failed (${response.status})`));
    error.status = response.status;
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
      const response = await fetch(
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
    const dir = path.resolve(process.cwd(), '.artifacts', 'debug-model-payloads');
    fs.mkdirSync(dir, { recursive: true });
    const safeModel = String(model || 'unknown').replace(/[^a-z0-9._-]+/gi, '-').toLowerCase();
    const safeId = String(responseId || 'no-id').replace(/[^a-z0-9._-]+/gi, '-').toLowerCase();
    const safeStage = String(stage || 'state').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `${timestamp}-openai-${safeStage}-${safeModel}-${safeId}.json`);
    fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return file;
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
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
  reasoningEffort = OPENAI_REASONING_EFFORT,
  background = OPENAI_BACKGROUND_RESPONSES
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
  temperature = MODEL_TEMPERATURE,
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
  reasoningEffort = OPENAI_REASONING_EFFORT,
  background = OPENAI_BACKGROUND_RESPONSES,
  pollIntervalMs = OPENAI_BACKGROUND_POLL_INTERVAL_MS,
  abortSignal
}) => {
  const response = await fetch('https://api.openai.com/v1/responses', {
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

  const payload = await readResponseText(response);
  if (!response.ok) {
    const error = new Error(String(payload.json?.error?.message || payload.text || `OpenAI request failed (${response.status})`));
    error.status = response.status;
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
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
  effort = ANTHROPIC_EFFORT,
  thinking = ANTHROPIC_THINKING_CONFIG
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
  temperature = MODEL_TEMPERATURE,
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
  effort = ANTHROPIC_EFFORT,
  thinking = ANTHROPIC_THINKING_CONFIG,
  abortSignal
}) => {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
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

  const payload = await readResponseText(response);
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
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: abortSignal
  });
  const payload = await readResponseText(response);
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
