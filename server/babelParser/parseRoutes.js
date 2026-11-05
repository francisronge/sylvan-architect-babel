import { attachGenerationFailureEvidence, classifyProviderRouteError } from './routeErrors.js';
import { buildGenerationRecord, sha256Hex } from './generationRecord.js';
import { buildSystemInstruction } from './systemInstruction.js';
import { buildParseContentsPrompt } from './prompts.js';
import { GENERATION_MODEL_IDS, resolveGenerationModelSelection } from './researchModelCatalog.js';
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
  startOpenAIBackgroundResponse,
  readOpenAIBackgroundResponse,
  cancelOpenAIBackgroundResponse,
  writeDebugModelPayload
} from './modelRuntime.js';
import { PARSE_TICKET_LIFETIME_MS, readParseTicket, signParseTicket } from './parseTicket.js';
import { runProviderAttempt, withTimeout } from './providerTransport.js';
import { assertGenerationComplete, buildGenerationOutcome, summarizeGeneration } from './generationOutcome.js';
import {
  createRawOutputArtifact,
  withFailureDetails
} from './validationErrors.js';

// A provider call needs more than this much of the request budget left, and
// its attempt deadline ends this far before the budget does.
const MIN_PROVIDER_BUDGET_MS = 1200;

export const createParseRoutes = ({
  ParseApiError,
  normalizeParseBundle,
  parseModelJsonDetailed,
  generateOpenAI = generateOpenAIStructuredContent,
  generateClaude = generateAnthropicStructuredContent,
  generateKimi = generateKimiStructuredContent,
  generateGrok = generateGrokStructuredContent,
  startOpenAI = startOpenAIBackgroundResponse,
  readOpenAI = readOpenAIBackgroundResponse,
  cancelOpenAI = cancelOpenAIBackgroundResponse,
  // The provider calls behind a ticket are quick (creating a response, then
  // one look at it), so each is bounded: a provider that goes silent never
  // holds a request open. A look that times out is retried by the browser.
  backgroundStartTimeoutMs = 60_000,
  backgroundCheckTimeoutMs = 20_000
}) => {
  /** Each catalog provider's server key, display label, runtime and request body. */
  const providers = {
    openai: { key: 'OPENAI_API_KEY', label: 'OpenAI', generate: generateOpenAI, buildRequest: buildOpenAIRequestBody },
    anthropic: { key: 'ANTHROPIC_API_KEY', label: 'Anthropic', generate: generateClaude, buildRequest: buildAnthropicRequestBody },
    moonshot: { key: 'MOONSHOT_API_KEY', label: 'Kimi', generate: generateKimi, buildRequest: buildKimiRequestBody },
    xai: { key: 'XAI_API_KEY', label: 'xAI', generate: generateGrok, buildRequest: buildGrokRequestBody }
  };

  /**
   * Records the token use of the one generation behind an analysis. The
   * `primary*` and `parse*` counts are the same numbers under the two names
   * saved records carry; `parse*` keeps only finite positive counts.
   */
  const attachPrimaryParseProvenance = (analysis, generationMeta, extraProvenance = {}) => {
    const { promptTokenCount, outputTokenCount, totalTokenCount } = generationMeta || {};
    const countable = (value) => Number.isFinite(value) && value > 0;
    return {
      ...analysis,
      provenance: {
        ...(analysis?.provenance || {}),
        ...(promptTokenCount ? { primaryPromptTokenCount: promptTokenCount } : {}),
        ...(outputTokenCount ? { primaryOutputTokenCount: outputTokenCount } : {}),
        ...(totalTokenCount ? { primaryTotalTokenCount: totalTokenCount } : {}),
        ...extraProvenance,
        ...(countable(promptTokenCount) ? { parsePromptTokenCount: promptTokenCount } : {}),
        ...(countable(outputTokenCount) ? { parseOutputTokenCount: outputTokenCount } : {}),
        ...(countable(totalTokenCount) ? { parseTotalTokenCount: totalTokenCount } : {})
      }
    };
  };

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

  /**
   * Everything a generation sends and records, built from the request alone,
   * so a ticket check rebuilds exactly what its start sent.
   */
  const prepareGeneration = (sentence, framework, modelId, settings) => {
    if (!GENERATION_MODEL_IDS.includes(modelId)) {
      throw new ParseApiError('INVALID_REQUEST', 'This model is not enabled for generation.', 400);
    }
    const selection = resolveGenerationModelSelection(modelId, settings);
    const provider = providers[selection.provider];
    const routeMaxOutputTokens = selection.requestPolicy.maxOutputTokens ?? selection.requestPolicy.maxCompletionTokens;
    const reasoningEffort = Object.values(selection.nativeSettings)[0];
    const generationOptions = {
      model: selection.providerModel,
      contents: buildParseContentsPrompt(sentence),
      systemInstruction: buildSystemInstruction(framework),
      maxOutputTokens: routeMaxOutputTokens,
      reasoningEffort,
      effort: reasoningEffort,
      ...(selection.provider === 'openai' ? { background: selection.requestPolicy.background } : {}),
      ...(selection.provider === 'anthropic' ? {
        thinking: selection.requestPolicy.thinking?.value ?? null
      } : {})
    };
    return {
      sentence,
      framework,
      selection,
      provider,
      modelRoute: selection.providerRoute,
      selectedModel: selection.providerModel,
      apiKey: String(process.env[provider.key] || '').trim(),
      routeMaxOutputTokens,
      reasoningEffort,
      generationOptions,
      // The body the provider runtime sends, recorded and hashed in the generation record.
      sentRequest: provider.buildRequest(generationOptions)
    };
  };

  const requireApiKey = (prepared) => {
    if (!prepared.apiKey) {
      throw new ParseApiError('API_KEY_MISSING', `${prepared.provider.label} API key is not configured on the server.`, 500);
    }
  };

  /** A failure with whatever generation evidence exists, classified for the browser. */
  const generationFailure = ({ prepared, error, generationStartedAt, evidence = null }) => {
    const failureEvidence = createTerminalFailureEvidence({
      existingEvidence: evidence,
      error,
      provider: prepared.modelRoute,
      framework: prepared.framework,
      promptRoute: prepared.modelRoute,
      sentRequest: prepared.sentRequest,
      generationStartedAt,
      sentMaxOutputTokens: prepared.routeMaxOutputTokens
    });
    if (failureEvidence) failureEvidence.generationRecord.modelSelection = prepared.selection;
    const classified = classifyProviderRouteError({
      error,
      ParseApiError,
      providerLabel: prepared.provider.label,
      model: prepared.selectedModel
    });
    return attachGenerationFailureEvidence({
      error: classified,
      ParseApiError,
      generationRecord: failureEvidence?.generationRecord,
      rawText: failureEvidence?.rawText,
      providerErrorBody: failureEvidence?.providerErrorBody
    });
  };

  /** Records, checks and normalizes a received generation into the parse bundle. */
  const finishGeneration = ({ prepared, generation, runId, attempts, generationStartedAt, timing = {} }) => {
    const { framework, sentence, modelRoute, selectedModel, selection, routeMaxOutputTokens } = prepared;
    let evidence = null;
    try {
      const generationMeta = summarizeGeneration(generation);
      const baseRecord = createGenerationRecord({
        provider: modelRoute,
        framework,
        promptRoute: modelRoute,
        sentRequest: prepared.sentRequest,
        generationStartedAt
      });
      const generationRecord = {
        ...baseRecord,
        timing: { ...baseRecord.timing, ...timing },
        modelSelection: selection,
        ...(generation.returnedModel ? { returnedModel: generation.returnedModel } : {}),
        ...(typeof generation.rawProviderResponse === 'string' ? {
          rawProviderResponse: createRawOutputArtifact(generation.rawProviderResponse)
        } : {}),
        outcome: buildGenerationOutcome({
          generationMeta,
          sentMaxOutputTokens: routeMaxOutputTokens,
          runId,
          attempts
        })
      };
      evidence = { generationRecord, rawText: generationMeta.rawText };
      assertGenerationComplete({
        generation,
        provider: modelRoute,
        model: selectedModel,
        sentMaxOutputTokens: routeMaxOutputTokens,
        runId,
        attempts
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
        requestedReasoningEffort: prepared.reasoningEffort,
        modelUsed: generation.returnedModel || selectedModel,
        rawModelOutput: createRawOutputArtifact(generationMeta.rawText),
        generationRecord
      };
    } catch (error) {
      throw generationFailure({ prepared, error, generationStartedAt, evidence });
    }
  };

  const parseSentenceWithExternalProvider = async ({ prepared, abortSignal, deadlineAt = Number.POSITIVE_INFINITY }) => {
    const { provider, selectedModel, apiKey, generationOptions } = prepared;
    requireApiKey(prepared);
    const requestStartedAt = Date.now();
    // `deadlineAt` is a host's hard stop (api/parse.js); it only ever shortens the request budget.
    const remainingBudget = () => Math.min(getRemainingRequestBudgetMs(requestStartedAt), deadlineAt - Date.now());
    const budgetExhausted = () => new ParseApiError(
      'PROVIDER_UNAVAILABLE',
      `${provider.label} is unavailable; please try again in a moment.`,
      503
    );

    let generationStartedAt = null;
    let generationReceipt;
    try {
      const remainingBudgetMs = remainingBudget();
      if (remainingBudgetMs <= MIN_PROVIDER_BUDGET_MS) throw budgetExhausted();

      generationStartedAt = Date.now();
      generationReceipt = await runProviderAttempt({
        abortSignal,
        deadlineAt: generationStartedAt + remainingBudgetMs - MIN_PROVIDER_BUDGET_MS,
        run: async () => {
          const attemptRemainingBudgetMs = remainingBudget();
          if (attemptRemainingBudgetMs <= MIN_PROVIDER_BUDGET_MS) throw budgetExhausted();
          return withTimeout(
            (attemptSignal) => provider.generate({
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
    } catch (error) {
      throw generationFailure({ prepared, error, generationStartedAt });
    }
    return finishGeneration({
      prepared,
      generation: generationReceipt.value,
      runId: generationReceipt.runId,
      attempts: generationReceipt.attempts,
      generationStartedAt
    });
  };

  const parseSentenceWithResearchModel = async (sentence, framework, modelId, options = {}) =>
    parseSentenceWithExternalProvider({
      prepared: prepareGeneration(sentence, framework, modelId, options.settings),
      abortSignal: options.abortSignal,
      deadlineAt: options.deadlineAt
    });

  const pendingTicket = (ticket) => ({ status: 'pending', ticket });
  // The one attempt behind a ticket, recorded as one long request records it.
  const ticketAttempt = (ticket, generation, outcome) => ({
    attemptNumber: 1,
    startedAt: new Date(ticket.startedAt).toISOString(),
    completedAt: new Date().toISOString(),
    outcome,
    ...(generation ? {
      finishReason: summarizeGeneration(generation).finishReason,
      finishStatus: summarizeGeneration(generation).status
    } : {})
  });
  // A ticket's generation record notes that its duration ends when a check
  // saw the finished response, so it can run up to one check interval long.
  const TICKET_TIMING = { completionObservedBy: 'parse-ticket-check' };

  /**
   * Starts a background generation and returns a ticket for checking back,
   * or the finished parse when the provider answered at once. Only a route
   * that generates in the background (OpenAI's) can start one.
   */
  const startParseTicket = async (sentence, framework, modelId, options = {}) => {
    const prepared = prepareGeneration(sentence, framework, modelId, options.settings);
    if (prepared.selection.provider !== 'openai' || !prepared.generationOptions.background) {
      throw new ParseApiError('INVALID_REQUEST', 'This model cannot generate in the background; send one parse request instead.', 400);
    }
    requireApiKey(prepared);
    const generationStartedAt = Date.now();
    let started;
    let runId;
    try {
      // The attempt runner gives a failed start the same record a long request's failure has.
      const receipt = await runProviderAttempt({
        abortSignal: options.abortSignal,
        run: ({ runId: id }) => {
          runId = id;
          return withTimeout(
            (signal) => startOpenAI({ apiKey: prepared.apiKey, ...prepared.generationOptions, abortSignal: signal }),
            backgroundStartTimeoutMs, `Background generation start (${prepared.selectedModel})`, options.abortSignal
          );
        }
      });
      started = receipt.value;
      runId = receipt.runId;
    } catch (error) {
      throw generationFailure({ prepared, error, generationStartedAt });
    }
    const ticket = {
      responseId: started.responseId,
      sentence,
      framework,
      modelId: prepared.selection.catalogId,
      settings: { ...options.settings },
      runId,
      startedAt: generationStartedAt,
      sentRequestSha256: sha256Hex(JSON.stringify(prepared.sentRequest))
    };
    if (started.pending) return pendingTicket(signParseTicket(prepared.apiKey, ticket));
    return finishGeneration({
      prepared, generation: started.generation, runId,
      attempts: [ticketAttempt(ticket, started.generation, 'completed')], generationStartedAt, timing: TICKET_TIMING
    });
  };

  /**
   * One check on a ticket: still pending, or the finished parse, built and
   * recorded exactly as one long request would have built it.
   */
  const checkParseTicket = async (signedTicket, options = {}) => {
    const invalid = () => new ParseApiError('INVALID_TICKET', 'This parse ticket is not valid. Analyze the sentence again.', 400);
    // Only OpenAI's background route starts tickets, so its key signs and verifies them.
    const fields = readParseTicket(String(process.env[providers.openai.key] || '').trim(), signedTicket);
    if (!fields) throw invalid();
    const prepared = prepareGeneration(fields.sentence, fields.framework, fields.modelId, fields.settings);
    const cancel = () => { void cancelOpenAI({ apiKey: prepared.apiKey, responseId: fields.responseId }); };
    // An expired ticket's failure is marked, so it gives no parse back (see
    // `refundsFailedParse`): Babel cancels the response without reading it.
    const expired = Date.now() - fields.startedAt > PARSE_TICKET_LIFETIME_MS;
    const marked = (error) => (expired ? Object.assign(error, { ticketExpired: true }) : error);
    if (sha256Hex(JSON.stringify(prepared.sentRequest)) !== fields.sentRequestSha256) {
      // The record must name what was sent, and this server would now send something else.
      cancel();
      throw marked(new ParseApiError('BABEL_UPDATED', 'Babel was updated while this analysis was being written. Analyze the sentence again.', 409));
    }
    if (expired) {
      cancel();
      // Classified as a provider timeout, as a long request reaching its deadline is.
      const timeout = Object.assign(new Error('The background generation timed out before its parse ticket expired.'), {
        code: 'PROVIDER_TIMEOUT',
        providerRunId: fields.runId,
        providerAttempts: [{ ...ticketAttempt(fields, null, 'terminal_failure'), retryReason: 'deadline_exhausted' }]
      });
      throw marked(generationFailure({ prepared, error: timeout, generationStartedAt: fields.startedAt }));
    }
    let state;
    try {
      state = await withTimeout(
        (signal) => readOpenAI({ apiKey: prepared.apiKey, responseId: fields.responseId, model: prepared.selectedModel, abortSignal: signal }),
        backgroundCheckTimeoutMs, `Background generation check (${prepared.selectedModel})`, options.abortSignal
      );
    } catch (error) {
      if (error?.completedStopState) {
        // A failed or cancelled response: the generation ended badly.
        error.providerRunId = fields.runId;
        error.providerAttempts = [{ ...ticketAttempt(fields, null, 'terminal_failure'), finishReason: error.finishReason }];
        throw generationFailure({ prepared, error, generationStartedAt: fields.startedAt });
      }
      if (error?.status === 404) throw invalid();
      // Looking failed, not the generation: the browser checks again.
      throw new ParseApiError('CHECK_UNAVAILABLE', 'Babel could not check on this analysis just now; it will check again.', 503);
    }
    if (state.pending) return pendingTicket(signedTicket);
    const bundle = finishGeneration({
      prepared,
      generation: state.generation,
      runId: fields.runId,
      attempts: [ticketAttempt(fields, state.generation, 'completed')],
      generationStartedAt: fields.startedAt,
      timing: TICKET_TIMING
    });
    return { ...bundle, sentence: fields.sentence };
  };

  return { parseSentenceWithResearchModel, startParseTicket, checkParseTicket };
};
