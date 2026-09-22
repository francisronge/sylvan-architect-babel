import { GoogleGenAI } from '@google/genai';
import { attachAggregateParseTokenCounts } from './provenance.js';
import { buildGenerationRecord } from './generationRecord.js';
import { buildSystemInstruction } from './systemInstruction.js';
import { buildParseContentsPrompt } from './prompts.js';
import { tokenizeSentenceSurfaceOrder } from './surfaceTokens.js';
import { GENERATION_MODEL_IDS, resolveResearchModelSelection } from './researchModelCatalog.js';
import {
  buildGeminiThinkingConfig,
  GEMINI_MODEL,
  LOCAL_MODEL_COMMAND,
  LOCAL_MODEL_NAME,
  LOCAL_MODEL_URL,
  ANTHROPIC_MODEL,
  OPENAI_MODEL,
  getRemainingRequestBudgetMs,
  localRouteUnavailableMessage,
  resolveModelTimeoutMs,
  resolveRequestTimeoutMs,
  resolveRouteMaxOutputTokens,
  resolveRouteTemperature,
  routeUnavailableMessage,
  normalizeProviderReasoningEffort
} from './routeConfig.js';
import {
  buildAnthropicRequestBody,
  buildGeminiGenerationRequest,
  buildLocalRequestBody,
  buildOpenAIRequestBody,
  buildKimiRequestBody,
  buildGrokRequestBody,
  assertGenerationComplete,
  buildGenerationOutcome,
  generateAnthropicStructuredContent,
  generateOpenAIStructuredContent,
  generateKimiStructuredContent,
  generateGrokStructuredContent,
  generateStructuredContent,
  generateStructuredLocalContent,
  getErrorMeta,
  isNetworkTransportError,
  resolveLocalMaxOutputTokens,
  runWithTransportRetries,
  summarizeErrorForLog,
  summarizeGeneration,
  withTimeout,
  writeDebugModelPayload
} from './modelRuntime.js';
import {
  createRawOutputArtifact,
  withFailureDetails
} from './validationErrors.js';

const getProviderAttemptDetails = (error) => ({
  ...(error?.providerRunId ? { providerRunId: error.providerRunId } : {}),
  ...(Array.isArray(error?.providerAttempts) ? { providerAttempts: error.providerAttempts } : {})
});

export const attachGenerationFailureEvidence = ({
  error,
  ParseApiError,
  generationRecord,
  rawText
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
      rawOutputArtifact: details.rawOutputArtifact || createRawOutputArtifact(rawText)
    }
  );
};

export const classifyGeminiRouteError = ({
  error,
  ParseApiError,
  modelRoute = 'gemini',
  model
}) => {
  if (error instanceof ParseApiError) {
    return error;
  }

  const { msg, haystack, statusCode } = getErrorMeta(error);
  const providerMessage = String(msg || '').trim() || undefined;
  const providerAttemptDetails = getProviderAttemptDetails(error);

  if (
    haystack.includes('api key expired') ||
    haystack.includes('api_key_expired') ||
    haystack.includes('invalid api key') ||
    haystack.includes('api_key_invalid') ||
    haystack.includes('unauthenticated') ||
    haystack.includes('permission_denied') ||
    statusCode === 401 ||
    statusCode === 403
  ) {
    return new ParseApiError('API_KEY_INVALID', 'Server API key is invalid or expired.', 500, providerAttemptDetails);
  }

  if (haystack.includes('resource_exhausted') || haystack.includes('quota') || statusCode === 429) {
    return new ParseApiError('GEMINI_QUOTA', 'Rate limit or quota reached for this server key.', 429, providerAttemptDetails);
  }

  if (
    statusCode === 404 ||
    (haystack.includes('model') && (
      haystack.includes('not found') ||
      haystack.includes('not available') ||
      haystack.includes('unsupported')
    ))
  ) {
    return new ParseApiError('MODEL_UNAVAILABLE', 'Requested model is unavailable for this project/key.', 503, providerAttemptDetails);
  }

  if (haystack.includes('invalid_argument') || statusCode === 400) {
    return new ParseApiError('INVALID_REQUEST', 'Request was rejected by Gemini (invalid argument).', 400, providerAttemptDetails);
  }

  if (
    statusCode === 408 ||
    haystack.includes('timed out') ||
    haystack.includes('timeout') ||
    haystack.includes('aborterror')
  ) {
    return new ParseApiError(
      'GEMINI_TIMEOUT',
      `Gemini parse timed out before ${model || 'the model'} returned a result.`,
      504,
      { ...providerAttemptDetails, ...(providerMessage ? { providerMessage } : {}) }
    );
  }

  if (
    statusCode === 503 ||
    haystack.includes('service unavailable') ||
    haystack.includes('backend error')
  ) {
    return new ParseApiError(
      'GEMINI_UNAVAILABLE',
      routeUnavailableMessage(modelRoute),
      503,
      providerAttemptDetails
    );
  }

  if (isNetworkTransportError(error)) {
    return new ParseApiError(
      'GEMINI_TRANSPORT',
      `Gemini transport failed before ${model || 'the model'} returned a result.`,
      502,
      { ...providerAttemptDetails, ...(providerMessage ? { providerMessage } : {}) }
    );
  }

  return new ParseApiError('PARSE_FAILED', msg || 'Syntactic parsing failed.', 500, providerAttemptDetails);
};

const classifyProviderRouteError = ({
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
    return new ParseApiError('PROVIDER_TIMEOUT', `${providerLabel} timed out before a result was received.`, 504, {
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
  return new ParseApiError('PARSE_FAILED', providerMessage || `${providerLabel} parsing failed.`, 500, {
    provider: providerLabel,
    model,
    ...providerAttemptDetails
  });
};

export const createParseRoutes = ({
  ParseApiError,
  normalizeParseBundle,
  parseModelJson,
  parseModelJsonDetailed,
  generateLocal = generateStructuredLocalContent,
  generateGemini = generateStructuredContent,
  generateOpenAI = generateOpenAIStructuredContent,
  generateClaude = generateAnthropicStructuredContent,
  generateKimi = generateKimiStructuredContent,
  generateGrok = generateGrokStructuredContent
}) => {
  const attachPrimaryParseProvenance = (analysis, generationMeta, extraProvenance = {}) => ({
    ...analysis,
    provenance: attachAggregateParseTokenCounts({
      ...(analysis?.provenance || {}),
      ...(generationMeta?.promptTokenCount
        ? { primaryPromptTokenCount: generationMeta.promptTokenCount }
        : {}),
      ...(generationMeta?.outputTokenCount
        ? { primaryOutputTokenCount: generationMeta.outputTokenCount }
        : {}),
      ...(generationMeta?.totalTokenCount
        ? { primaryTotalTokenCount: generationMeta.totalTokenCount }
        : {}),
      ...extraProvenance
    })
  });

  const mapBundleAnalyses = (bundle, mapper) => ({
    ...bundle,
    analyses: (Array.isArray(bundle?.analyses) ? bundle.analyses : []).map(mapper)
  });

  const attachPayloadRepairDiagnostics = (error, payloadRepairDiagnostics = []) => {
    if (!(error instanceof ParseApiError) || payloadRepairDiagnostics.length === 0) return error;
    return new ParseApiError(
      error.code,
      error.message,
      error.status,
      {
        ...(error.details && typeof error.details === 'object' ? error.details : {}),
        payloadRepairDiagnostics
      }
    );
  };

  const createGenerationRecord = ({
    provider,
    framework,
    promptRoute,
    sentRequest,
    generationStartedAt
  }) => buildGenerationRecord({
    provider,
    framework,
    promptRoute,
    sentRequest,
    requestStartedAt: generationStartedAt,
    durationMs: Date.now() - generationStartedAt,
    buildTemplate: buildParseContentsPrompt
  });

  const createDeterministicParseFailure = ({
    message,
    details = {},
    rawText
  }) => new ParseApiError(
    'PARSE_ENGINE_FAILED',
    message,
    500,
    withFailureDetails(details, {
      failureClass: 'deterministic_engine_failure',
      ruleId: 'DETERMINISTIC_ENGINE',
      processingStep: details.stage || 'processing',
      fieldPath: '$',
      offendingValue: null
    }, rawText)
  );

  const augmentModelPayloadFailure = ({
    error,
    stage,
    model,
    generationMeta,
    payloadPreview,
    debugPayloadPath,
    payloadRepairDiagnostics = []
  }) => {
    const commonDetails = {
      stage,
      model,
      finishReason: generationMeta.finishReason || null,
      textLength: generationMeta.textLength,
      preview: generationMeta.preview || '',
      ...(typeof payloadPreview === 'string' ? { payloadPreview } : {}),
      ...(payloadRepairDiagnostics.length > 0 ? { payloadRepairDiagnostics } : {}),
      debugPayloadPath
    };
    if (!(error instanceof ParseApiError)) {
      return createDeterministicParseFailure({
        message: 'Babel could not finish processing the generated analysis.',
        details: { ...commonDetails, engineError: { name: error?.name || 'Error', message: String(error?.message || error) } },
        rawText: generationMeta.rawText
      });
    }
    return new ParseApiError(
      error.code,
      error.message,
      error.status,
      {
        ...(error.details && typeof error.details === 'object' ? error.details : {}),
        ...commonDetails,
        rawOutputArtifact: createRawOutputArtifact(generationMeta.rawText)
      }
    );
  };

  const createTerminalFailureEvidence = ({
    existingEvidence,
    error,
    provider,
    framework,
    promptRoute,
    sentRequest,
    generationStartedAt,
    sentMaxOutputTokens
  }) => {
    if (existingEvidence || !generationStartedAt || !error?.providerRunId) {
      return existingEvidence;
    }
    const partialResponse = error?.partialProviderResponse;
    const rawText = partialResponse ? '' : String(error?.responseBody || '');
    const finishReason = String(error?.finishReason || 'PROVIDER_ERROR').toUpperCase();
    return {
      rawText,
      generationRecord: {
        ...createGenerationRecord({
          provider,
          framework,
          promptRoute,
          sentRequest,
          generationStartedAt
        }),
        ...(partialResponse ? {
          rawProviderResponse: partialResponse,
          providerResponseComplete: false
        } : rawText ? { rawProviderResponse: createRawOutputArtifact(rawText) } : {}),
        outcome: {
          sentMaxOutputTokens,
          finishReason,
          finishStatus: error?.completedStopState
            ? 'COMPLETED_STOP_FAILURE'
            : 'TRANSPORT_FAILURE',
          runId: error.providerRunId,
          attempts: Array.isArray(error.providerAttempts) ? error.providerAttempts : []
        }
      }
    };
  };

  const maybeWritePrimaryDebugPayload = ({
    modelRoute,
    model,
    sentence,
    rawText
  }) => {
    if (String(process.env.BABEL_SAVE_PROVIDER_RAW || '').trim() !== '1') return null;
    return writeDebugModelPayload({
      stage: `${modelRoute}-primary-output`,
      model,
      sentence,
      rawText
    });
  };

  const parseSentenceWithLocalModel = async (sentence, framework = 'xbar') => {
    // The local runtime is its own route; provenance must not claim Gemini.
    const promptRoute = 'local';
    const inputTokens = tokenizeSentenceSurfaceOrder(sentence);
    const systemInstruction = buildSystemInstruction(framework, promptRoute);
    const prompt = buildParseContentsPrompt(
      sentence,
      framework,
      promptRoute,
      inputTokens
    );
    const temperature = resolveRouteTemperature(promptRoute);
    const maxOutputTokens = resolveLocalMaxOutputTokens(resolveRouteMaxOutputTokens(promptRoute));
    const modelUsed = `local:${LOCAL_MODEL_NAME}`;
    const sentRequest = buildLocalRequestBody({
      transport: LOCAL_MODEL_COMMAND ? 'command' : 'http',
      sentence,
      framework,
      systemInstruction,
      prompt,
      temperature,
      maxOutputTokens
    });

    let generationFailureEvidence = null;
    let generationStartedAt = null;
    let payloadRepairDiagnostics = [];
    try {
      generationStartedAt = Date.now();
      const rawText = await generateLocal({
        sentence,
        framework,
        systemInstruction,
        prompt,
        temperature,
        maxOutputTokens,
        timeoutMs: undefined
      });
      const generationRecord = createGenerationRecord({
        provider: 'local',
        framework,
        promptRoute,
        sentRequest,
        generationStartedAt
      });
      generationFailureEvidence = { generationRecord, rawText };

      if (!rawText) {
        throw new ParseApiError('BAD_MODEL_RESPONSE', 'Local model returned no text.', 502, {
          stage: 'local-transport',
          model: modelUsed
        });
      }

      const parsedPayload = parseModelJsonDetailed
        ? parseModelJsonDetailed(rawText)
        : { payload: parseModelJson(rawText), integrityFlags: [], repairDiagnostics: [] };
      payloadRepairDiagnostics = Array.isArray(parsedPayload.repairDiagnostics)
        ? parsedPayload.repairDiagnostics
        : [];
      let normalized = normalizeParseBundle(
        parsedPayload.payload,
        framework,
        sentence,
        promptRoute,
        true,
        {
          inputTokens,
          payloadIntegrityFlags: parsedPayload.integrityFlags,
          payloadRepairDiagnostics
        }
      );
      if (normalized?.analyses?.[0]) {
        normalized = mapBundleAnalyses(normalized, (analysis) => ({
          ...analysis,
          provenance: attachAggregateParseTokenCounts({
            ...(analysis.provenance || {}),
            modelRoute: 'local'
          })
        }));
      }

      return {
        ...normalized,
        requestedModelRoute: 'local',
        modelUsed,
        generationRecord
      };
    } catch (error) {
      if (error instanceof ParseApiError) {
        throw attachGenerationFailureEvidence({
          error: attachPayloadRepairDiagnostics(error, payloadRepairDiagnostics),
          ParseApiError,
          generationRecord: generationFailureEvidence?.generationRecord,
          rawText: generationFailureEvidence?.rawText
        });
      }
      const { msg, haystack, statusCode } = getErrorMeta(error);
      if (
        isNetworkTransportError(error) ||
        haystack.includes('econnrefused') ||
        haystack.includes('connection refused') ||
        haystack.includes('failed to fetch') ||
        statusCode === 404 ||
        statusCode === 503
      ) {
        const classified = new ParseApiError('LOCAL_MODEL_UNAVAILABLE', localRouteUnavailableMessage(), 503, {
          model: modelUsed,
          endpoint: LOCAL_MODEL_COMMAND ? 'command' : LOCAL_MODEL_URL,
          transportMessage: msg || null
        });
        throw attachGenerationFailureEvidence({
          error: classified,
          ParseApiError,
          generationRecord: generationFailureEvidence?.generationRecord,
          rawText: generationFailureEvidence?.rawText
        });
      }
      const classified = createDeterministicParseFailure({
        message: 'Babel could not complete the local parse.',
        details: {
          model: modelUsed,
          endpoint: LOCAL_MODEL_COMMAND ? 'command' : LOCAL_MODEL_URL
        },
        rawText: generationFailureEvidence?.rawText
      });
      throw attachGenerationFailureEvidence({
        error: classified,
        ParseApiError,
        generationRecord: generationFailureEvidence?.generationRecord,
        rawText: generationFailureEvidence?.rawText
      });
    }
  };

  const parseSentenceWithGemini = async (sentence, framework = 'xbar', modelRoute = 'gemini', options = {}) => {
    const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
      throw new ParseApiError('API_KEY_MISSING', 'Gemini API key is not configured on the server.', 500);
    }

    const ai = new GoogleGenAI({ apiKey });
    const normalizedModelRoute = 'gemini';
    const inputTokens = tokenizeSentenceSurfaceOrder(sentence);
    const systemInstruction = buildSystemInstruction(framework, normalizedModelRoute);
    const fullContents = buildParseContentsPrompt(
      sentence,
      framework,
      normalizedModelRoute,
      inputTokens
    );
    const routeTemperature = resolveRouteTemperature(normalizedModelRoute);
    const routeMaxOutputTokens = resolveRouteMaxOutputTokens(normalizedModelRoute);
    const selectedModel = GEMINI_MODEL;
    const requestStartedAt = Date.now();
    const reasoningEffort = normalizeProviderReasoningEffort(normalizedModelRoute, options.reasoningEffort);
    const thinkingConfig = buildGeminiThinkingConfig(reasoningEffort);
    const sentRequest = buildGeminiGenerationRequest({
      model: selectedModel,
      contents: fullContents,
      systemInstruction,
      temperature: routeTemperature,
      maxOutputTokens: routeMaxOutputTokens,
      thinkingConfig
    });

    let generationFailureEvidence = null;
    let generationStartedAt = null;
    try {
      const remainingBudgetMs = getRemainingRequestBudgetMs(requestStartedAt, normalizedModelRoute);
      if (remainingBudgetMs <= 1200) {
        throw new ParseApiError(
          'GEMINI_UNAVAILABLE',
          routeUnavailableMessage(normalizedModelRoute),
          503
        );
      }

      generationStartedAt = Date.now();
      const generationReceipt = await runWithTransportRetries({
        abortSignal: options.abortSignal,
        deadlineAt: generationStartedAt + remainingBudgetMs - 1200,
        run: async () => {
          const attemptRemainingBudgetMs = getRemainingRequestBudgetMs(requestStartedAt, normalizedModelRoute);
          if (attemptRemainingBudgetMs <= 1200) {
            throw new ParseApiError(
              'GEMINI_UNAVAILABLE',
              routeUnavailableMessage(normalizedModelRoute),
              503
            );
          }
          return withTimeout(
            (abortSignal) => generateGemini({
              ai,
              model: selectedModel,
              contents: fullContents,
              systemInstruction,
              temperature: routeTemperature,
              maxOutputTokens: routeMaxOutputTokens,
              thinkingConfig,
              abortSignal
            }),
            resolveRequestTimeoutMs({
              baseTimeoutMs: resolveModelTimeoutMs(selectedModel, normalizedModelRoute),
              remainingBudgetMs: attemptRemainingBudgetMs
            }),
            `Model generation (${selectedModel})`,
            options.abortSignal
          );
        }
      });
      const generation = generationReceipt.value;
      const generationMeta = summarizeGeneration(generation);
      const generationRecord = {
        ...createGenerationRecord({
          provider: normalizedModelRoute,
          framework,
          promptRoute: normalizedModelRoute,
          sentRequest,
          generationStartedAt
        }),
        outcome: buildGenerationOutcome({
          generationMeta,
          sentMaxOutputTokens: routeMaxOutputTokens,
          runId: generationReceipt.runId,
          attempts: generationReceipt.attempts
        })
      };
      generationFailureEvidence = {
        generationRecord,
        rawText: generationMeta.rawText
      };
      assertGenerationComplete({
        generation,
        provider: normalizedModelRoute,
        model: selectedModel,
        sentMaxOutputTokens: routeMaxOutputTokens,
        runId: generationReceipt.runId,
        attempts: generationReceipt.attempts
      });
      const primaryDebugPayloadPath = maybeWritePrimaryDebugPayload({
        modelRoute: normalizedModelRoute,
        model: selectedModel,
        sentence,
        rawText: generationMeta.rawText
      });

      let payload;
      let payloadIntegrityFlags = [];
      let payloadRepairDiagnostics = [];
      const jsonProcessing = { repairDiagnostics: [] };
      generationRecord.processing = { json: jsonProcessing };
      const jsonStartedAt = performance.now();
      try {
        const parsedPayload = parseModelJsonDetailed
          ? parseModelJsonDetailed(generationMeta.rawText)
          : { payload: parseModelJson(generationMeta.rawText), integrityFlags: [], repairDiagnostics: [] };
        payload = parsedPayload.payload;
        payloadIntegrityFlags = Array.isArray(parsedPayload.integrityFlags)
          ? parsedPayload.integrityFlags
          : [];
        payloadRepairDiagnostics = Array.isArray(parsedPayload.repairDiagnostics)
          ? parsedPayload.repairDiagnostics
          : [];
        jsonProcessing.repairDiagnostics = payloadRepairDiagnostics;
        if (parsedPayload.jsonDiagnostic) jsonProcessing.diagnostic = parsedPayload.jsonDiagnostic;
      } catch (error) {
        jsonProcessing.repairDiagnostics = error.details?.payloadRepairDiagnostics || [];
        if (error.details?.jsonDiagnostic) jsonProcessing.diagnostic = error.details.jsonDiagnostic;
        if (error instanceof ParseApiError && error.code === 'BAD_MODEL_RESPONSE') {
          const debugPayloadPath = writeDebugModelPayload({
            stage: 'json-parse',
            model: selectedModel,
            sentence,
            rawText: generationMeta.rawText
          });
          throw augmentModelPayloadFailure({
            error,
            stage: 'json-parse',
            model: selectedModel,
            generationMeta,
            debugPayloadPath
          });
        }
        throw augmentModelPayloadFailure({
          error,
          stage: 'json-parse',
          model: selectedModel,
          generationMeta,
          debugPayloadPath: null
        });
      } finally {
        jsonProcessing.durationMs = performance.now() - jsonStartedAt;
      }

      const normalizationProcessing = {};
      generationRecord.processing.normalization = normalizationProcessing;
      const normalizationStartedAt = performance.now();
      let normalized;
      try {
        normalized = normalizeParseBundle(
          payload,
          framework,
          sentence,
          normalizedModelRoute,
          true,
          { inputTokens, payloadIntegrityFlags, payloadRepairDiagnostics }
        );
        if (normalized?.analyses?.[0]) {
          normalized = mapBundleAnalyses(
            normalized,
            (analysis) =>
              attachPrimaryParseProvenance(
                analysis,
                generationMeta,
                primaryDebugPayloadPath ? { primaryDebugPayloadPath } : {}
              )
          );
        }
      } catch (error) {
        if (error.failure) normalizationProcessing.failure = error.failure;
        const debugPayloadPath = writeDebugModelPayload({
          stage: 'normalization',
          model: selectedModel,
          sentence,
          rawText: generationMeta.rawText
        });
        let payloadPreview = '<unserializable>';
        try {
          payloadPreview = JSON.stringify(payload).slice(0, 320);
        } catch {
          // keep fallback preview
        }
        throw augmentModelPayloadFailure({
          error,
          stage: 'normalization',
          model: selectedModel,
          generationMeta,
          payloadPreview,
          debugPayloadPath,
          payloadRepairDiagnostics
        });
      } finally {
        normalizationProcessing.durationMs = performance.now() - normalizationStartedAt;
      }

      return {
        ...normalized,
        requestedModelRoute: normalizedModelRoute,
        requestedReasoningEffort: reasoningEffort,
        modelUsed: selectedModel,
        generationRecord
      };
    } catch (error) {
      generationFailureEvidence = createTerminalFailureEvidence({
        existingEvidence: generationFailureEvidence,
        error,
        provider: normalizedModelRoute,
        framework,
        promptRoute: normalizedModelRoute,
        sentRequest,
        generationStartedAt,
        sentMaxOutputTokens: routeMaxOutputTokens
      });
      const classified = classifyGeminiRouteError({
        error,
        ParseApiError,
        modelRoute: normalizedModelRoute,
        model: selectedModel
      });
      throw attachGenerationFailureEvidence({
        error: classified,
        ParseApiError,
        generationRecord: generationFailureEvidence?.generationRecord,
        rawText: generationFailureEvidence?.rawText
      });
    }
  };

  const parseSentenceWithExternalProvider = async ({
    sentence,
    framework,
    modelRoute,
    apiKey,
    selectedModel,
    providerLabel,
    generate,
    selection,
    abortSignal,
    reasoningEffort: requestedReasoningEffort
  }) => {
    if (!apiKey) {
      throw new ParseApiError('API_KEY_MISSING', `${providerLabel} API key is not configured on the server.`, 500);
    }

    const inputTokens = tokenizeSentenceSurfaceOrder(sentence);
    const systemInstruction = buildSystemInstruction(framework, modelRoute);
    const fullContents = buildParseContentsPrompt(sentence, framework, modelRoute, inputTokens);
    const routeMaxOutputTokens = selection
      ? selection.requestPolicy.maxOutputTokens ?? selection.requestPolicy.maxCompletionTokens
      : resolveRouteMaxOutputTokens(modelRoute);
    const requestStartedAt = Date.now();
    const reasoningEffort = selection
      ? Object.values(selection.nativeSettings)[0]
      : normalizeProviderReasoningEffort(modelRoute, requestedReasoningEffort);
    const generationOptions = {
      model: selectedModel,
      contents: fullContents,
      systemInstruction,
      maxOutputTokens: routeMaxOutputTokens,
      reasoningEffort,
      effort: reasoningEffort,
      ...(selection?.provider === 'openai' ? { background: selection.requestPolicy.background } : {}),
      ...(selection?.provider === 'anthropic' ? {
        thinking: selection.requestPolicy.thinking?.value ?? null
      } : {})
    };
    const requestBuilder = {
      gpt: buildOpenAIRequestBody,
      claude: buildAnthropicRequestBody,
      kimi: buildKimiRequestBody,
      grok: buildGrokRequestBody
    }[modelRoute];
    const sentRequest = requestBuilder(generationOptions);

    let generationFailureEvidence = null;
    let generationStartedAt = null;
    try {
      const remainingBudgetMs = getRemainingRequestBudgetMs(requestStartedAt, modelRoute);
      if (remainingBudgetMs <= 1200) {
        throw new ParseApiError(
          'PROVIDER_UNAVAILABLE',
          `${providerLabel} is unavailable; please try again in a moment.`,
          503
        );
      }

      generationStartedAt = Date.now();
      const generationReceipt = await runWithTransportRetries({
        abortSignal,
        deadlineAt: generationStartedAt + remainingBudgetMs - 1200,
        run: async () => {
          const attemptRemainingBudgetMs = getRemainingRequestBudgetMs(requestStartedAt, modelRoute);
          if (attemptRemainingBudgetMs <= 1200) {
            throw new ParseApiError(
              'PROVIDER_UNAVAILABLE',
              `${providerLabel} is unavailable; please try again in a moment.`,
              503
            );
          }
          return withTimeout(
            (attemptSignal) => generate({
              apiKey,
              ...generationOptions,
              abortSignal: attemptSignal
            }),
            resolveRequestTimeoutMs({
              baseTimeoutMs: resolveModelTimeoutMs(selectedModel, modelRoute),
              remainingBudgetMs: attemptRemainingBudgetMs
            }),
            `Model generation (${selectedModel})`,
            abortSignal
          );
        }
      });
      const generation = generationReceipt.value;
      const generationMeta = summarizeGeneration(generation);
      const generationRecord = {
        ...createGenerationRecord({
          provider: modelRoute,
          framework,
          promptRoute: modelRoute,
          sentRequest,
          generationStartedAt
        }),
        ...(selection ? { modelSelection: selection } : {}),
        ...(generation.returnedModel ? { returnedModel: generation.returnedModel } : {}),
        ...(typeof generation.rawProviderResponse === 'string' ? {
          rawProviderResponse: createRawOutputArtifact(generation.rawProviderResponse)
        } : {}),
        outcome: buildGenerationOutcome({
          generationMeta,
          sentMaxOutputTokens: routeMaxOutputTokens,
          runId: generationReceipt.runId,
          attempts: generationReceipt.attempts
        })
      };
      generationFailureEvidence = {
        generationRecord,
        rawText: generationMeta.rawText
      };
      assertGenerationComplete({
        generation,
        provider: modelRoute,
        model: selectedModel,
        sentMaxOutputTokens: routeMaxOutputTokens,
        runId: generationReceipt.runId,
        attempts: generationReceipt.attempts
      });
      const primaryDebugPayloadPath = maybeWritePrimaryDebugPayload({
        modelRoute,
        model: selectedModel,
        sentence,
        rawText: generationMeta.rawText
      });
      let payload;
      let payloadIntegrityFlags = [];
      let payloadRepairDiagnostics = [];
      const jsonProcessing = { repairDiagnostics: [] };
      generationRecord.processing = { json: jsonProcessing };
      const jsonStartedAt = performance.now();

      try {
        const parsedPayload = parseModelJsonDetailed
          ? parseModelJsonDetailed(generationMeta.rawText)
          : { payload: parseModelJson(generationMeta.rawText), integrityFlags: [], repairDiagnostics: [] };
        payload = parsedPayload.payload;
        payloadIntegrityFlags = Array.isArray(parsedPayload.integrityFlags)
          ? parsedPayload.integrityFlags
          : [];
        payloadRepairDiagnostics = Array.isArray(parsedPayload.repairDiagnostics)
          ? parsedPayload.repairDiagnostics
          : [];
        jsonProcessing.repairDiagnostics = payloadRepairDiagnostics;
        if (parsedPayload.jsonDiagnostic) jsonProcessing.diagnostic = parsedPayload.jsonDiagnostic;
      } catch (error) {
        jsonProcessing.repairDiagnostics = error.details?.payloadRepairDiagnostics || [];
        if (error.details?.jsonDiagnostic) jsonProcessing.diagnostic = error.details.jsonDiagnostic;
        const debugPayloadPath = writeDebugModelPayload({
          stage: `${modelRoute}-json-parse`,
          model: selectedModel,
          sentence,
          rawText: generationMeta.rawText
        });
        throw augmentModelPayloadFailure({
          error,
          stage: 'json-parse',
          model: selectedModel,
          generationMeta,
          debugPayloadPath
        });
      } finally {
        jsonProcessing.durationMs = performance.now() - jsonStartedAt;
      }

      const normalizationProcessing = {};
      generationRecord.processing.normalization = normalizationProcessing;
      const normalizationStartedAt = performance.now();
      let normalized;
      try {
        normalized = normalizeParseBundle(
          payload,
          framework,
          sentence,
          modelRoute,
          true,
          { inputTokens, payloadIntegrityFlags, payloadRepairDiagnostics }
        );
        if (normalized?.analyses?.[0]) {
          normalized = mapBundleAnalyses(
            normalized,
            (analysis) =>
              attachPrimaryParseProvenance(
                analysis,
                generationMeta,
                primaryDebugPayloadPath ? { primaryDebugPayloadPath } : {}
              )
          );
        }
      } catch (error) {
        if (error.failure) normalizationProcessing.failure = error.failure;
        const debugPayloadPath = writeDebugModelPayload({
          stage: `${modelRoute}-normalization`,
          model: selectedModel,
          sentence,
          rawText: generationMeta.rawText
        });
        let payloadPreview = '<unserializable>';
        try {
          payloadPreview = JSON.stringify(payload).slice(0, 320);
        } catch {
          // keep fallback preview
        }
        throw augmentModelPayloadFailure({
          error,
          stage: 'normalization',
          model: selectedModel,
          generationMeta,
          payloadPreview,
          debugPayloadPath,
          payloadRepairDiagnostics
        });
      } finally {
        normalizationProcessing.durationMs = performance.now() - normalizationStartedAt;
      }

      return {
        ...normalized,
        requestedModelRoute: modelRoute,
        ...(selection ? { requestedModelId: selection.catalogId } : {}),
        requestedReasoningEffort: reasoningEffort,
        modelUsed: generation.returnedModel || selectedModel,
        ...(selection ? { rawModelOutput: createRawOutputArtifact(generationMeta.rawText) } : {}),
        generationRecord
      };
    } catch (error) {
      generationFailureEvidence = createTerminalFailureEvidence({
        existingEvidence: generationFailureEvidence,
        error,
        provider: modelRoute,
        framework,
        promptRoute: modelRoute,
        sentRequest,
        generationStartedAt,
        sentMaxOutputTokens: routeMaxOutputTokens
      });
      if (selection && generationFailureEvidence) {
        generationFailureEvidence.generationRecord.modelSelection = selection;
      }
      const classified = classifyProviderRouteError({
        error,
        ParseApiError,
        providerLabel,
        model: selectedModel
      });
      throw attachGenerationFailureEvidence({
        error: classified,
        ParseApiError,
        generationRecord: generationFailureEvidence?.generationRecord,
        rawText: generationFailureEvidence?.rawText
      });
    }
  };

  const parseSentenceWithOpenAI = async (sentence, framework = 'xbar', modelRoute = 'gpt', options = {}) =>
    parseSentenceWithExternalProvider({
      sentence,
      framework,
      modelRoute,
      apiKey: String(process.env.OPENAI_API_KEY || '').trim(),
      selectedModel: OPENAI_MODEL,
      providerLabel: 'OpenAI',
      generate: generateOpenAI,
      abortSignal: options.abortSignal,
      reasoningEffort: options.reasoningEffort
    });

  const parseSentenceWithClaude = async (sentence, framework = 'xbar', modelRoute = 'claude', options = {}) =>
    parseSentenceWithExternalProvider({
      sentence,
      framework,
      modelRoute,
      apiKey: String(process.env.ANTHROPIC_API_KEY || '').trim(),
      selectedModel: ANTHROPIC_MODEL,
      providerLabel: 'Claude',
      generate: generateClaude,
      abortSignal: options.abortSignal,
      reasoningEffort: options.reasoningEffort
    });

  const parseSentenceWithResearchModel = async (sentence, framework, modelId, options = {}) => {
    if (!GENERATION_MODEL_IDS.includes(modelId)) {
      throw new ParseApiError('INVALID_REQUEST', 'This model is not enabled for generation.', 400);
    }
    const selection = resolveResearchModelSelection(modelId, options.settings);
    const provider = {
      openai: { key: 'OPENAI_API_KEY', label: 'OpenAI', generate: generateOpenAI },
      anthropic: { key: 'ANTHROPIC_API_KEY', label: 'Anthropic', generate: generateClaude },
      moonshot: { key: 'MOONSHOT_API_KEY', label: 'Kimi', generate: generateKimi },
      xai: { key: 'XAI_API_KEY', label: 'xAI', generate: generateGrok }
    }[selection.provider];
    return parseSentenceWithExternalProvider({
      sentence,
      framework,
      modelRoute: selection.providerRoute,
      apiKey: String(process.env[provider.key] || '').trim(),
      selectedModel: selection.providerModel,
      providerLabel: provider.label,
      generate: provider.generate,
      abortSignal: options.abortSignal,
      selection
    });
  };

  return {
    parseSentenceWithLocalModel,
    parseSentenceWithGemini,
    parseSentenceWithOpenAI,
    parseSentenceWithClaude,
    parseSentenceWithResearchModel
  };
};
