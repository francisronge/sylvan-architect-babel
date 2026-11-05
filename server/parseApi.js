import { ParseApiError, checkParseTicket, parseSentenceWithResearchModel, startParseTicket } from './babelParser.js';
import { GENERATION_MODEL_IDS, resolveGenerationModelSelection } from './babelParser/researchModelCatalog.js';
import {
  FAILURE_CLASSES,
  MAX_RAW_OUTPUT_BODY_BYTES,
  createFailure,
  retainArtifactPrefix,
  withFailureDetails
} from './babelParser/validationErrors.js';

const FRAMEWORKS = new Set(['xbar', 'minimalism']);
const MAX_SENTENCE_LENGTH = 600;

/** A 400 for a request body Babel cannot send to a provider, typed by the rule it breaks. */
const invalidRequest = (message, ruleId, fieldPath, offendingValue) => new ParseApiError(
  'INVALID_REQUEST',
  message,
  400,
  withFailureDetails({}, { failureClass: 'transport_serialization', ruleId, fieldPath, offendingValue })
);

export const validateParseBody = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw invalidRequest('Request body must be a JSON object.', 'REQUEST_BODY_OBJECT', '$', body);
  }

  const sentence = typeof body.sentence === 'string' ? body.sentence : '';
  const framework = typeof body.framework === 'string' ? body.framework.trim() : 'minimalism';

  if (!sentence.trim()) {
    throw invalidRequest('Sentence is required.', 'REQUEST_SENTENCE_REQUIRED', '$.sentence', body.sentence);
  }

  if (sentence.length > MAX_SENTENCE_LENGTH) {
    throw invalidRequest(`Sentence exceeds ${MAX_SENTENCE_LENGTH} characters.`, 'REQUEST_SENTENCE_LENGTH', '$.sentence', sentence);
  }

  if (!FRAMEWORKS.has(framework)) {
    throw invalidRequest('Framework must be "xbar" or "minimalism".', 'REQUEST_FRAMEWORK_SUPPORTED', '$.framework', framework);
  }

  // Every request names a catalog model; there is no server default model.
  if (!Object.hasOwn(body, 'modelId')) {
    throw invalidRequest('Name the model with modelId; modelRoute and reasoningEffort are no longer accepted.',
      'REQUEST_MODEL_ID_REQUIRED', '$.modelId', null);
  }
  if (!GENERATION_MODEL_IDS.includes(body.modelId)) {
    throw invalidRequest('This model is not enabled for generation.', 'REQUEST_MODEL_ID_SUPPORTED', '$.modelId', body.modelId);
  }
  if (Object.hasOwn(body, 'modelRoute') || Object.hasOwn(body, 'reasoningEffort')) {
    throw new ParseApiError('INVALID_REQUEST', 'Use modelId and native settings, without modelRoute or reasoningEffort.', 400);
  }
  try {
    const selection = resolveGenerationModelSelection(body.modelId, body.settings);
    return { sentence, framework, modelId: selection.catalogId, settings: selection.nativeSettings };
  } catch (error) {
    throw new ParseApiError('INVALID_REQUEST', error.message, 400);
  }
};

/**
 * What a parse request body asks for. `start: true` starts a background
 * generation and answers with a ticket; `{ ticket }` checks one; any other
 * body is one request held open until the parse is finished. Hosts count only
 * the first two kinds against their parse allowances: a check starts nothing.
 */
export const parseRequestKind = (body) => {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    if (Object.hasOwn(body, 'ticket')) return 'check';
    if (body.start === true) return 'start';
  }
  return 'parse';
};

// Check failures that end nothing or prove no parse: the browser checks again
// after CHECK_UNAVAILABLE, and a malformed body or a forged or altered ticket
// names no parse this server started.
const CHECK_FAILURES_KEPT = new Set(['CHECK_UNAVAILABLE', 'INVALID_TICKET', 'INVALID_REQUEST']);

/**
 * Whether a failed request gives the visitor back the parse it used. Both
 * HTTP entry points ask here, after a request they admitted fails and while
 * the visitor is still connected (a visitor who leaves gets nothing back).
 * A long request or a start was admitted as a parse, so any failure refunds
 * it. A check refunds only a terminal failure of the parse its valid ticket
 * names, and not an expired ticket's: Babel cancels that response without
 * looking at it, so it cannot tell a generation that ran out of time from a
 * finished one the visitor let lapse to get their parse back.
 */
export const refundsFailedParse = (kind, error) => {
  if (kind !== 'check') return true;
  return error instanceof ParseApiError && !CHECK_FAILURES_KEPT.has(error.code) && error.ticketExpired !== true;
};

/**
 * A failure after the spell-out check carries the word list Babel derived
 * from the model's own words; the response serializes it from
 * `error.inputTokens`. The browser never segments the sentence itself, so an
 * output that failed the check has no word list. Every request kind passes
 * its failures through here.
 */
const withDerivedInputTokens = async (run) => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ParseApiError && Array.isArray(error.details?.inputTokens)) {
      error.inputTokens = error.details.inputTokens;
    }
    throw error;
  }
};

const DEFAULT_PROVIDERS = { research: parseSentenceWithResearchModel, start: startParseTicket, check: checkParseTicket };

/**
 * Public Babel's request: Minimalism, GPT-6.1 Sol at high effort (Francis,
 * 3 Nov 2026). A deployed server sends this whatever the browser names, so no
 * visitor can choose a costlier model or effort, or another framework; only
 * the sentence comes from the browser. The local runtimes keep the internal
 * app's model and effort menus. `publicApp/publicGeneration.ts` sends the same
 * request, and tests keep the two equal.
 */
export const PUBLIC_PARSE_REQUEST = Object.freeze({
  framework: 'minimalism',
  modelId: 'openai:gpt-6.1-sol',
  settings: Object.freeze({ 'reasoning.effort': 'high' })
});

/**
 * Whether a server sends only the public request. Deployed servers do; a
 * local runtime does not. `BABEL_PUBLIC_REQUEST_ONLY=0` lets a deployed server
 * that only Francis can reach honour the browser's choice, and `1` pins a
 * local one.
 */
export const readPublicRequestOnly = (env, { deployed }) => {
  const raw = String(env.BABEL_PUBLIC_REQUEST_ONLY ?? '').trim();
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  return deployed;
};

/** The body with the public request in place of whatever it chose. A check names no request; its ticket carries one this server signed. */
const withPublicRequest = (body, kind) => {
  if (kind === 'check' || !body || typeof body !== 'object' || Array.isArray(body)) return body;
  return { sentence: body.sentence, ...(kind === 'start' ? { start: true } : {}), ...PUBLIC_PARSE_REQUEST };
};

/**
 * The request a parse body asks the provider for, validated: what a start or a
 * long request would send, with the public request in place when the server
 * pins it. Hosts call it before counting a parse against an allowance, so a
 * request Babel would refuse uses none.
 */
export const validateParseRequest = (requestBody, { publicRequestOnly = false } = {}) => {
  const kind = parseRequestKind(requestBody);
  const body = publicRequestOnly ? withPublicRequest(requestBody, kind) : requestBody;
  const { start: _start, ...request } = body ?? {};
  return validateParseBody(kind === 'start' ? request : body);
};

/**
 * Public Babel's bundle without the analyses whose words are the sentence's in
 * another order (those carrying a `sentenceCheck`). The internal app and the
 * qualification runners keep them as research evidence; public Babel's
 * visitors are students, so there such an analysis is a failed parse they can
 * retry (Francis, 5 Nov 2026: "Let's do public Babel failing and offering a
 * retry"). The remaining analyses come back as a bundle the model could have
 * sent: the shared word list already comes from the passing analyses alone,
 * and one remaining analysis is no ambiguity. The generation record and raw
 * output still describe the whole response. When none remain, the parse fails
 * with that evidence, as any other model output failure does.
 */
const withoutWordOrderMisses = (bundle) => {
  if (!bundle || bundle.status === 'pending' || !Array.isArray(bundle.analyses)) return bundle;
  const kept = bundle.analyses.filter(analysis => !analysis?.sentenceCheck);
  if (kept.length === bundle.analyses.length) return bundle;
  if (kept.length) {
    const ambiguityDetected = kept.length > 1;
    return { ...bundle, analyses: kept, ambiguityDetected, ambiguityNote: ambiguityDetected ? bundle.ambiguityNote : undefined };
  }
  const message = 'The model\'s tree puts some of the sentence\'s words in the wrong order.';
  throw new ParseApiError('BAD_MODEL_RESPONSE', message, 502, withFailureDetails({
    ...(bundle.generationRecord ? { generationRecord: bundle.generationRecord } : {}),
    ...(bundle.rawModelOutput ? { rawOutputArtifact: bundle.rawModelOutput } : {})
  }, {
    // Classed as the spelling check classes the mismatch it was kept from.
    failureClass: FAILURE_CLASSES.CONTRACT_MISUNDERSTANDING,
    ruleId: 'SPELLOUT_WORD_ORDER',
    fieldPath: '$',
    processingStep: 'spellout-alignment',
    offendingValue: bundle.analyses.map(analysis => analysis.sentenceCheck.treeReading),
    message
  }));
};

export const parseFromBodyWithProviders = async (
  requestBody,
  providers = DEFAULT_PROVIDERS,
  { abortSignal, deadlineAt, publicRequestOnly = false } = {}
) => {
  abortSignal?.throwIfAborted();
  const kind = parseRequestKind(requestBody);
  const body = publicRequestOnly ? withPublicRequest(requestBody, kind) : requestBody;
  const finished = bundle => (publicRequestOnly ? withoutWordOrderMisses(bundle) : bundle);
  if (kind === 'check') {
    if (typeof body.ticket !== 'string' || Object.keys(body).length !== 1) {
      throw invalidRequest('A check sends only its ticket.', 'REQUEST_TICKET_ONLY', '$', null);
    }
    // A finished check carries its sentence from the ticket.
    return withDerivedInputTokens(async () => finished(await providers.check(body.ticket, { abortSignal })));
  }
  const { sentence, framework, modelId, settings } = validateParseRequest(requestBody, { publicRequestOnly });
  return withDerivedInputTokens(async () => {
    const bundle = await (kind === 'start' ? providers.start : providers.research)(sentence, framework, modelId, { settings, abortSignal, deadlineAt });
    return bundle.status === 'pending' ? bundle : finished({ ...bundle, sentence });
  });
};

export const parseFromBody = async (body, options) => parseFromBodyWithProviders(body, undefined, options);

/**
 * Both HTTP entry points cancel work only when the response connection closes early.
 * `deadlineAt` (epoch ms) is a host's hard stop for the provider call; the
 * hosted function passes one, the Express runtime does not.
 * `publicRequestOnly` sends the public request instead of the browser's choice.
 */
export const parseFromRequest = async (req, res, parse = parseFromBody, { deadlineAt, publicRequestOnly = false } = {}) => {
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableFinished) {
      controller.abort(new DOMException('Client disconnected.', 'AbortError'));
    }
  };
  res.once('close', onClose);
  try {
    if (req.aborted || res.destroyed) onClose();
    controller.signal.throwIfAborted();
    return await parse(req.body, {
      abortSignal: controller.signal,
      ...(deadlineAt === undefined ? {} : { deadlineAt }),
      ...(publicRequestOnly ? { publicRequestOnly } : {})
    });
  } finally {
    res.removeListener('close', onClose);
  }
};

const isProduction = process.env.NODE_ENV === 'production';

export const projectPublicGenerationRecord = (generationRecord) => {
  if (!generationRecord || typeof generationRecord !== 'object' || Array.isArray(generationRecord)) {
    return undefined;
  }
  const outcome = generationRecord.outcome && typeof generationRecord.outcome === 'object'
    ? generationRecord.outcome
    : undefined;
  const attempts = Array.isArray(outcome?.attempts)
    ? outcome.attempts.map((attempt) => ({
        attemptNumber: attempt?.attemptNumber,
        startedAt: attempt?.startedAt,
        completedAt: attempt?.completedAt,
        outcome: attempt?.outcome,
        finishReason: attempt?.finishReason,
        finishStatus: attempt?.finishStatus,
        statusCode: attempt?.statusCode,
        retryReason: attempt?.retryReason,
        retryStopReason: attempt?.retryStopReason,
        responseId: attempt?.responseId
      }))
    : undefined;
  return {
    ...generationRecord,
    ...(outcome
      ? {
          outcome: {
            ...outcome,
            ...(attempts ? { attempts } : {})
          }
        }
      : {})
  };
};

const serializedBytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');

/**
 * Bounds a whole failure body to MAX_RAW_OUTPUT_BODY_BYTES. The provider
 * envelope, which repeats the extracted output, gives up retained bytes first;
 * the extracted output, which diagnostic inspection needs complete, gives up
 * bytes only when the envelope alone cannot make room.
 */
const fitFailureBody = (error) => {
  const shrink = (artifact, current) => {
    const overflow = serializedBytes({ error: current }) - MAX_RAW_OUTPUT_BODY_BYTES;
    if (overflow <= 0 || typeof artifact?.data !== 'string') return artifact;
    // Base64 spends four characters on every three bytes.
    return retainArtifactPrefix(artifact, artifact.retainedByteLength - Math.ceil(overflow * 3 / 4) - 3);
  };
  let fitted = error;
  if (fitted.generationRecord?.rawProviderResponse) {
    fitted = {
      ...fitted,
      generationRecord: {
        ...fitted.generationRecord,
        rawProviderResponse: shrink(fitted.generationRecord.rawProviderResponse, fitted)
      }
    };
  }
  if (fitted.rawOutput) fitted = { ...fitted, rawOutput: shrink(fitted.rawOutput, fitted) };
  return fitted;
};

const PROVIDER_REPORT_KEYS = ['providerMessage', 'transportMessage', 'providerErrorBody'];

/**
 * A failure the provider reported before any generation completed. Its message
 * and error body are the provider's own text, which can name accounts,
 * organizations or key fragments; production clients receive only Babel's
 * classification. A completed generation that stopped badly keeps its output,
 * but a response the provider marked failed or cancelled carries no output,
 * only the provider's error envelope (`providerErrorBody`), so it is withheld.
 */
const isProviderReportedFailure = (error, details) =>
  Boolean(details.providerErrorBody)
  || (error.failure?.class !== FAILURE_CLASSES.INCOMPLETE_GENERATION
    && PROVIDER_REPORT_KEYS.some((key) => Object.hasOwn(details, key)));

const withoutProviderReport = (error, details, generationRecord) => {
  const errorBody = Boolean(details.providerErrorBody);
  const { rawProviderResponse: _rawProviderResponse, ...recordWithoutBody } = generationRecord || {};
  return {
    failure: error.failure ? { ...error.failure, offendingValue: null } : error.failure,
    rawOutput: errorBody ? undefined : error.rawOutput,
    generationRecord: errorBody && generationRecord ? recordWithoutBody : generationRecord
  };
};

export const formatApiError = (error) => {
  if (error instanceof ParseApiError) {
    const details = error.details && typeof error.details === 'object' ? error.details : {};
    const {
      rawOutputArtifact: _rawOutputArtifact,
      generationRecord: internalGenerationRecord,
      ...safeDetails
    } = details;
    const { failure, rawOutput, generationRecord } = isProduction && isProviderReportedFailure(error, details)
      ? withoutProviderReport(error, details, internalGenerationRecord)
      : { failure: error.failure, rawOutput: error.rawOutput, generationRecord: internalGenerationRecord };
    return {
      status: error.status,
      body: {
        error: fitFailureBody({
          code: error.code,
          message: error.message,
          failure,
          ...(rawOutput ? { rawOutput } : {}),
          ...(Array.isArray(error.inputTokens) ? { inputTokens: error.inputTokens } : {}),
          ...(generationRecord
            ? { generationRecord: projectPublicGenerationRecord(generationRecord) }
            : {}),
          ...(isProduction ? {} : { details: safeDetails })
        })
      }
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unexpected server error.',
        failure: createFailure({
          failureClass: 'deterministic_engine_failure',
          ruleId: 'DETERMINISTIC_ENGINE',
          fieldPath: '$',
          offendingValue: null
        })
      }
    }
  };
};
