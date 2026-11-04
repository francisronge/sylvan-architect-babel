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

const DEFAULT_PROVIDERS = { research: parseSentenceWithResearchModel, start: startParseTicket, check: checkParseTicket };

export const parseFromBodyWithProviders = async (
  body,
  providers = DEFAULT_PROVIDERS,
  { abortSignal, deadlineAt } = {}
) => {
  abortSignal?.throwIfAborted();
  const kind = parseRequestKind(body);
  if (kind === 'check') {
    if (typeof body.ticket !== 'string' || Object.keys(body).length !== 1) {
      throw invalidRequest('A check sends only its ticket.', 'REQUEST_TICKET_ONLY', '$', null);
    }
    // A finished check carries its sentence from the ticket.
    return providers.check(body.ticket, { abortSignal });
  }
  const { start: _start, ...request } = body ?? {};
  const { sentence, framework, modelId, settings } = validateParseBody(kind === 'start' ? request : body);
  try {
    const bundle = await (kind === 'start' ? providers.start : providers.research)(sentence, framework, modelId, { settings, abortSignal, deadlineAt });
    return bundle.status === 'pending' ? bundle : { ...bundle, sentence };
  } catch (error) {
    // A failure after the spell-out check carries the word list Babel derived
    // from the model's own words. The browser never segments the sentence
    // itself, so an output that failed the check has no word list.
    if (error instanceof ParseApiError && Array.isArray(error.details?.inputTokens)) {
      error.inputTokens = error.details.inputTokens;
    }
    throw error;
  }
};

export const parseFromBody = async (body, options) => parseFromBodyWithProviders(body, undefined, options);

/**
 * Both HTTP entry points cancel work only when the response connection closes early.
 * `deadlineAt` (epoch ms) is a host's hard stop for the provider call; the
 * hosted function passes one, the Express runtime does not.
 */
export const parseFromRequest = async (req, res, parse = parseFromBody, { deadlineAt } = {}) => {
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
    return await parse(req.body, { abortSignal: controller.signal, ...(deadlineAt === undefined ? {} : { deadlineAt }) });
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
 * classification. A completed generation that stopped badly keeps its response.
 */
const isProviderReportedFailure = (error, details) =>
  error.failure?.class !== FAILURE_CLASSES.INCOMPLETE_GENERATION
  && PROVIDER_REPORT_KEYS.some((key) => Object.hasOwn(details, key));

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
