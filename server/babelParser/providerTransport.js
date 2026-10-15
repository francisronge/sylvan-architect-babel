import { randomUUID } from 'node:crypto';
import { Agent } from 'undici';
import { ParseApiError } from './error.js';
import { createRawOutputArtifact } from './validationErrors.js';
import { summarizeGeneration } from './generationOutcome.js';

// The request's AbortSignal owns the generation deadline. Native fetch's
// five-minute headers/body timers would otherwise cut that budget short.
const providerDispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
export const fetchProvider = (url, options) => fetch(url, { ...options, dispatcher: providerDispatcher });

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

export const mutableProviderError = (error) => {
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

export const withTimeout = async (run, timeoutMs, label, abortSignal) => {
  abortSignal?.throwIfAborted();
  const hasTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;
  if (!hasTimeout && !abortSignal) {
    return run(undefined);
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort(abortSignal.reason);
  abortSignal?.addEventListener('abort', onAbort, { once: true });
  let timeoutId = null;
  const timeoutError = new Error(`${label} timed out after ${timeoutMs}ms.`);
  timeoutError.code = 'PROVIDER_TIMEOUT';
  let rejectOnAbort;
  const aborted = new Promise((_, reject) => {
    rejectOnAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
  });
  if (hasTimeout) timeoutId = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  try {
    return await Promise.race([run(controller.signal), aborted]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    abortSignal?.removeEventListener('abort', onAbort);
    controller.signal.removeEventListener('abort', rejectOnAbort);
  }
};

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
  if (chain.some((cause) => cause.code === 'credit_balance_exhausted')
    || statuses.includes(429) || /rate[\s_-]*limit|resource_exhausted|quota|too many requests/.test(haystack)) {
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

export const runWithTransportRetries = async ({
  run,
  maxAttempts = 3,
  backoffBaseMs = 250,
  // Absolute epoch milliseconds; the caller still bounds each in-flight call.
  deadlineAt = Number.POSITIVE_INFINITY,
  abortSignal,
  delay = delayWithAbort,
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
    if (abortSignal?.aborted) throw terminalFailure(abortSignal.reason, 'cancelled');
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
        await delay(backoffMs, abortSignal);
      } catch (delayError) {
        throw terminalFailure(delayError, abortSignal?.aborted ? 'cancelled' : 'backoff_failed');
      }
    }
  }

  throw new Error('Provider retry loop exhausted unexpectedly.');
};

export const readResponseText = async (response, abortSignal) => {
  const chunks = [];
  const preservePartialResponse = (error) => Object.assign(mutableProviderError(error), {
    status: response.status,
    responseReceived: response.ok,
    partialProviderResponse: createRawOutputArtifact(Buffer.concat(chunks))
  });
  // The outer deadline can reject before the stream read settles. Attach its
  // received bytes synchronously so the failure receipt retains them too.
  const onAbort = () => preservePartialResponse(abortSignal.reason);
  abortSignal?.addEventListener('abort', onAbort, { once: true });
  let text;
  try {
    if (response.body) {
      for await (const chunk of response.body) chunks.push(chunk);
    }
    text = new TextDecoder().decode(Buffer.concat(chunks));
  } catch (error) {
    throw preservePartialResponse(error);
  } finally {
    abortSignal?.removeEventListener('abort', onAbort);
  }
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { text, json: null };
  }
};

export const delayWithAbort = (ms, abortSignal) => new Promise((resolve, reject) => {
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
