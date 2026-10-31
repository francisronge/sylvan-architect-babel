import { getErrorMeta, isNetworkTransportError } from './providerTransport.js';
import { createRawOutputArtifact, withFailureDetails } from './validationErrors.js';

const getProviderAttemptDetails = (error) => ({
  ...(error?.providerRunId ? { providerRunId: error.providerRunId } : {}),
  ...(Array.isArray(error?.providerAttempts) ? { providerAttempts: error.providerAttempts } : {})
});

/**
 * `providerErrorBody` marks raw text that is the provider's error response
 * rather than model output; formatApiError withholds it from production clients.
 */
export const attachGenerationFailureEvidence = ({
  error,
  ParseApiError,
  generationRecord,
  rawText,
  providerErrorBody = false
}) => {
  if (!generationRecord || !(error instanceof ParseApiError)) return error;
  const details = error.details && typeof error.details === 'object'
    ? error.details
    : {};
  return new ParseApiError(
    error.code,
    error.message,
    error.status,
    {
      ...details,
      generationRecord,
      rawOutputArtifact: details.rawOutputArtifact || createRawOutputArtifact(rawText),
      ...(providerErrorBody ? { providerErrorBody: true } : {})
    }
  );
};

export const classifyProviderRouteError = ({
  error,
  ParseApiError,
  providerLabel,
  model
}) => {
  if (error instanceof ParseApiError) {
    return error;
  }

  const { msg, haystack, statusCode } = getErrorMeta(error);
  const providerMessage = String(msg || '').trim();
  const providerAttemptDetails = getProviderAttemptDetails(error);
  if (error?.code === 'credit_balance_exhausted' || error?.code === 'insufficient_quota') {
    return new ParseApiError(
      'PROVIDER_QUOTA',
      error.code === 'credit_balance_exhausted'
        ? `${providerLabel} API credits are exhausted. Add credits to the API account to continue.`
        : `${providerLabel} API quota is exhausted. Check the API account's billing and usage limits.`,
      429,
      {
        provider: providerLabel,
        model,
        ...providerAttemptDetails,
        providerMessage: providerMessage || null,
        providerErrorCode: error.code
      }
    );
  }
  if (error?.completedStopState) {
    return new ParseApiError(
      'INCOMPLETE_GENERATION',
      `${providerLabel} completed with ${error.finishReason || 'a failed stop state'} and no valid generation.`,
      502,
      withFailureDetails({
        provider: providerLabel,
        model,
        providerMessage: providerMessage || null,
        finishReason: error.finishReason || null,
        ...providerAttemptDetails
      }, {
        failureClass: 'incomplete_generation',
        ruleId: 'GENERATION_COMPLETED_STOP_FAILURE',
        fieldPath: '$',
        offendingValue: error.finishReason || providerMessage || null
      }, error.responseBody || '')
    );
  }
  if (
    haystack.includes('api key expired') ||
    haystack.includes('invalid api key') ||
    haystack.includes('unauthorized') ||
    haystack.includes('unauthenticated') ||
    haystack.includes('permission') ||
    statusCode === 401 ||
    statusCode === 403
  ) {
    return new ParseApiError('API_KEY_INVALID', `${providerLabel} API key is invalid or lacks required permissions.`, 500, {
      provider: providerLabel,
      model,
      ...providerAttemptDetails,
      providerMessage: providerMessage || null
    });
  }
  if (haystack.includes('quota') || haystack.includes('rate limit') || statusCode === 429) {
    return new ParseApiError('PROVIDER_QUOTA', `Rate limit or quota reached for ${providerLabel}.`, 429, {
      provider: providerLabel,
      model,
      ...providerAttemptDetails,
      providerMessage: providerMessage || null
    });
  }
  if (
    statusCode === 404 ||
    (haystack.includes('model') && (
      haystack.includes('not found') ||
      haystack.includes('not available') ||
      haystack.includes('unsupported')
    ))
  ) {
    return new ParseApiError('MODEL_UNAVAILABLE', `${providerLabel} model is unavailable for this key or endpoint.`, 503, {
      provider: providerLabel,
      model,
      ...providerAttemptDetails,
      providerMessage: providerMessage || null
    });
  }
  if (statusCode === 400 || haystack.includes('invalid')) {
    return new ParseApiError('INVALID_REQUEST', `${providerLabel} rejected the request.`, 400, {
      provider: providerLabel,
      model,
      ...providerAttemptDetails,
      providerMessage: providerMessage || null
    });
  }
  if (error?.code === 'PROVIDER_TIMEOUT' || statusCode === 408 || statusCode === 504
    || haystack.includes('timed out') || haystack.includes('timeout')) {
    return new ParseApiError('PROVIDER_TIMEOUT', `Generation took too long: ${providerLabel} timed out before a result was received. You can try again.`, 504, {
      provider: providerLabel,
      model,
      ...providerAttemptDetails,
      providerMessage: providerMessage || null
    });
  }
  // Babel's own failures arrive as ParseApiError; a remaining 5xx status is the
  // provider's answer to Babel's single request.
  if (Number.isFinite(statusCode) && statusCode >= 500) {
    return new ParseApiError('PROVIDER_UNAVAILABLE', `${providerLabel} returned HTTP ${statusCode} before a result was received.`, 503, {
      provider: providerLabel,
      model,
      ...providerAttemptDetails,
      providerMessage: providerMessage || null
    });
  }
  if (isNetworkTransportError(error)) {
    return new ParseApiError('PROVIDER_UNAVAILABLE', `${providerLabel} transport failed before the model returned a result.`, 503, {
      provider: providerLabel,
      model,
      ...providerAttemptDetails,
      providerMessage: providerMessage || null
    });
  }
  return new ParseApiError('PARSE_FAILED', `${providerLabel} parsing failed.`, 500, {
    provider: providerLabel,
    model,
    ...providerAttemptDetails,
    providerMessage: providerMessage || null
  });
};

