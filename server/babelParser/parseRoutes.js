import { attachGenerationFailureEvidence, classifyProviderRouteError } from './routeErrors.js';
import { attachAggregateParseTokenCounts } from './provenance.js';
import { buildGenerationRecord } from './generationRecord.js';
import { buildSystemInstruction } from './systemInstruction.js';
import { buildParseContentsPrompt } from './prompts.js';
import { GENERATION_MODEL_IDS, resolveResearchModelSelection } from './researchModelCatalog.js';
import {
  getRemainingRequestBudgetMs,
  resolveModelTimeoutMs,
  resolveRequestTimeoutMs
} from './routeConfig.js';
import {
  buildAnthropicRequestBody,
  buildOpenAIRequestBody,
  buildKimiRequestBody,
  buildGrokRequestBody,
  generateAnthropicStructuredContent,
  generateOpenAIStructuredContent,
  generateKimiStructuredContent,
  generateGrokStructuredContent,
  writeDebugModelPayload
} from './modelRuntime.js';
import { runProviderAttempt, withTimeout } from './providerTransport.js';
import { assertGenerationComplete, buildGenerationOutcome, summarizeGeneration } from './generationOutcome.js';
import {
  createRawOutputArtifact,
  withFailureDetails
} from './validationErrors.js';

export const createParseRoutes = ({
  ParseApiError,
  normalizeParseBundle,
  parseModelJsonDetailed,
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
      // Without a received generation, the body is the provider's error
      // response, as is a partial body read from an unsuccessful HTTP response.
      providerErrorBody: Boolean(rawText) || Boolean(partialResponse && error?.responseReceived === false),
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
    // Babel no longer repairs JSON, so new records always carry an empty list;
    // `corrections` names transport framing read past (an outer code fence).
    const jsonProcessing = { repairDiagnostics: [] };
    generationRecord.processing = { json: jsonProcessing };
    const jsonStartedAt = performance.now();

    try {
      const parsed = parseModelJsonDetailed(generationMeta.rawText);
      payload = parsed.payload;
      if (parsed.corrections?.length) jsonProcessing.corrections = parsed.corrections;
    } catch (error) {
      if (error.details?.jsonDiagnostic) jsonProcessing.diagnostic = error.details.jsonDiagnostic;
      const debugPayloadPath = writeDebugModelPayload({
        stage: `${modelRoute}-json-parse`,
        model,
        sentence,
        rawText: generationMeta.rawText
      });
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
        stage: `${modelRoute}-normalization`,
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

  const parseSentenceWithExternalProvider = async ({
    sentence,
    framework,
    modelRoute,
    apiKey,
    selectedModel,
    providerLabel,
    generate,
    selection,
    abortSignal
  }) => {
    if (!apiKey) {
      throw new ParseApiError('API_KEY_MISSING', `${providerLabel} API key is not configured on the server.`, 500);
    }

    const systemInstruction = buildSystemInstruction(framework);
    const fullContents = buildParseContentsPrompt(sentence);
    const routeMaxOutputTokens = selection.requestPolicy.maxOutputTokens ?? selection.requestPolicy.maxCompletionTokens;
    const requestStartedAt = Date.now();
    const reasoningEffort = Object.values(selection.nativeSettings)[0];
    const generationOptions = {
      model: selectedModel,
      contents: fullContents,
      systemInstruction,
      maxOutputTokens: routeMaxOutputTokens,
      reasoningEffort,
      effort: reasoningEffort,
      ...(selection.provider === 'openai' ? { background: selection.requestPolicy.background } : {}),
      ...(selection.provider === 'anthropic' ? {
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
      const remainingBudgetMs = getRemainingRequestBudgetMs(requestStartedAt);
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
          const attemptRemainingBudgetMs = getRemainingRequestBudgetMs(requestStartedAt);
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
              baseTimeoutMs: resolveModelTimeoutMs(),
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
        modelSelection: selection,
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
        requestedModelId: selection.catalogId,
        requestedReasoningEffort: reasoningEffort,
        modelUsed: generation.returnedModel || selectedModel,
        rawModelOutput: createRawOutputArtifact(generationMeta.rawText),
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
      if (generationFailureEvidence) {
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

  return { parseSentenceWithResearchModel };
};
