import { attachGenerationFailureEvidence, classifyGeminiRouteError, classifyProviderRouteError } from './routeErrors.js';
import { GoogleGenAI } from '@google/genai';
import { attachAggregateParseTokenCounts } from './provenance.js';
import { buildGenerationRecord } from './generationRecord.js';
import { buildSystemInstruction } from './systemInstruction.js';
import { buildParseContentsPrompt } from './prompts.js';
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
  routeUnavailableMessage,
  resolveModelTimeoutMs,
  resolveRequestTimeoutMs,
  resolveRouteMaxOutputTokens,
  resolveRouteTemperature,
  normalizeProviderReasoningEffort
} from './routeConfig.js';
import {
  buildAnthropicRequestBody,
  buildGeminiGenerationRequest,
  buildLocalRequestBody,
  buildOpenAIRequestBody,
  buildKimiRequestBody,
  buildGrokRequestBody,
  generateAnthropicStructuredContent,
  generateOpenAIStructuredContent,
  generateKimiStructuredContent,
  generateGrokStructuredContent,
  generateStructuredContent,
  generateStructuredLocalContent,
  resolveLocalMaxOutputTokens,
  writeDebugModelPayload
} from './modelRuntime.js';
import { getErrorMeta, isNetworkTransportError, runProviderAttempt, summarizeErrorForLog, withTimeout } from './providerTransport.js';
import { assertGenerationComplete, buildGenerationOutcome, summarizeGeneration } from './generationOutcome.js';
import {
  createRawOutputArtifact,
  withFailureDetails
} from './validationErrors.js';

export const createParseRoutes = ({
  ParseApiError,
  normalizeParseBundle,
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
    debugPayloadPath
  }) => {
    const commonDetails = {
      stage,
      model,
      finishReason: generationMeta.finishReason || null,
      textLength: generationMeta.textLength,
      preview: generationMeta.preview || '',
      ...(typeof payloadPreview === 'string' ? { payloadPreview } : {}),
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
      // Without a received generation, the body is the provider's error response.
      providerErrorBody: Boolean(rawText),
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

  const processGeneratedPayload = ({
    generationMeta,
    generationRecord,
    framework,
    sentence,
    modelRoute,
    model,
    primaryDebugPayloadPath
  }) => {
    let payload;
    // Babel no longer repairs JSON, so new records always carry an empty list.
    const jsonProcessing = { repairDiagnostics: [] };
    generationRecord.processing = { json: jsonProcessing };
    const jsonStartedAt = performance.now();

    try {
      payload = parseModelJsonDetailed(generationMeta.rawText).payload;
    } catch (error) {
      if (error.details?.jsonDiagnostic) jsonProcessing.diagnostic = error.details.jsonDiagnostic;
      const debugPayloadPath = modelRoute !== 'gemini' || (error instanceof ParseApiError && error.code === 'BAD_MODEL_RESPONSE')
        ? writeDebugModelPayload({
            stage: modelRoute === 'gemini' ? 'json-parse' : `${modelRoute}-json-parse`,
            model,
            sentence,
            rawText: generationMeta.rawText
          })
        : null;
      throw augmentModelPayloadFailure({
        error,
        stage: 'json-parse',
        model,
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
        { spellout: true }
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
        stage: modelRoute === 'gemini' ? 'normalization' : `${modelRoute}-normalization`,
        model,
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
        model,
        generationMeta,
        payloadPreview,
        debugPayloadPath
      });
    } finally {
      normalizationProcessing.durationMs = performance.now() - normalizationStartedAt;
    }
    return normalized;
  };

  const parseSentenceWithLocalModel = async (sentence, framework = 'xbar') => {
    // The local runtime is its own route; provenance must not claim Gemini.
    const promptRoute = 'local';
    const systemInstruction = buildSystemInstruction(framework, promptRoute);
    const prompt = buildParseContentsPrompt(sentence);
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

      let normalized = normalizeParseBundle(
        parseModelJsonDetailed(rawText).payload,
        framework,
        sentence,
        promptRoute,
        true,
        { spellout: true }
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
          error,
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
        rawText: generationFailureEvidence?.rawText,
        providerErrorBody: generationFailureEvidence?.providerErrorBody
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
    const systemInstruction = buildSystemInstruction(framework, normalizedModelRoute);
    const fullContents = buildParseContentsPrompt(sentence);
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
      const generationReceipt = await runProviderAttempt({
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

      const normalized = processGeneratedPayload({
        generationMeta,
        generationRecord,
        framework,
        sentence,
        modelRoute: normalizedModelRoute,
        model: selectedModel,
        primaryDebugPayloadPath
      });

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
        rawText: generationFailureEvidence?.rawText,
        providerErrorBody: generationFailureEvidence?.providerErrorBody
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

    const systemInstruction = buildSystemInstruction(framework, modelRoute);
    const fullContents = buildParseContentsPrompt(sentence);
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
      const generationReceipt = await runProviderAttempt({
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
      const normalized = processGeneratedPayload({
        generationMeta,
        generationRecord,
        framework,
        sentence,
        modelRoute,
        model: selectedModel,
        primaryDebugPayloadPath
      });

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
        rawText: generationFailureEvidence?.rawText,
        providerErrorBody: generationFailureEvidence?.providerErrorBody
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
