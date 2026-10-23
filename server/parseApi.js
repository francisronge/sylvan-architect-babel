import { ParseApiError, parseSentenceWithResearchModel } from './babelParser.js';
import { GENERATION_MODEL_IDS, resolveResearchModelSelection } from './babelParser/researchModelCatalog.js';
import {
  FAILURE_CLASSES,
  MAX_RAW_OUTPUT_BODY_BYTES,
  createFailure,
  retainArtifactPrefix,
  withFailureDetails
} from './babelParser/validationErrors.js';

const FRAMEWORKS = new Set(['xbar', 'minimalism']);
const MAX_SENTENCE_LENGTH = 600;

export const validateParseBody = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ParseApiError(
      'INVALID_REQUEST',
      'Request body must be a JSON object.',
      400,
      withFailureDetails({}, {
        failureClass: 'transport_serialization',
        ruleId: 'REQUEST_BODY_OBJECT',
        fieldPath: '$',
        offendingValue: body
      })
    );
  }

  const sentence = typeof body.sentence === 'string' ? body.sentence : '';
  const framework = typeof body.framework === 'string' ? body.framework.trim() : 'xbar';

  if (!sentence.trim()) {
    throw new ParseApiError(
      'INVALID_REQUEST',
      'Sentence is required.',
      400,
      withFailureDetails({}, {
        failureClass: 'transport_serialization',
        ruleId: 'REQUEST_SENTENCE_REQUIRED',
        fieldPath: '$.sentence',
        offendingValue: body.sentence
      })
    );
  }

  if (sentence.length > MAX_SENTENCE_LENGTH) {
    throw new ParseApiError(
      'INVALID_REQUEST',
      `Sentence exceeds ${MAX_SENTENCE_LENGTH} characters.`,
      400,
      withFailureDetails({}, {
        failureClass: 'transport_serialization',
        ruleId: 'REQUEST_SENTENCE_LENGTH',
        fieldPath: '$.sentence',
        offendingValue: sentence
      })
    );
  }

  if (!FRAMEWORKS.has(framework)) {
    throw new ParseApiError(
      'INVALID_REQUEST',
      'Framework must be "xbar" or "minimalism".',
      400,
      withFailureDetails({}, {
        failureClass: 'transport_serialization',
        ruleId: 'REQUEST_FRAMEWORK_SUPPORTED',
        fieldPath: '$.framework',
        offendingValue: framework
      })
    );
  }

  // Every request names a catalog model; there is no server default model.
  if (!Object.hasOwn(body, 'modelId')) {
    throw new ParseApiError(
      'INVALID_REQUEST',
      'Name the model with modelId; modelRoute and reasoningEffort are no longer accepted.',
      400,
      withFailureDetails({}, {
        failureClass: 'transport_serialization',
        ruleId: 'REQUEST_MODEL_ID_REQUIRED',
        fieldPath: '$.modelId',
        offendingValue: null
      })
    );
  }
  if (!GENERATION_MODEL_IDS.includes(body.modelId)) {
    throw new ParseApiError(
      'INVALID_REQUEST',
      'This model is not enabled for generation.',
      400,
      withFailureDetails({}, {
        failureClass: 'transport_serialization',
        ruleId: 'REQUEST_MODEL_ID_SUPPORTED',
        fieldPath: '$.modelId',
        offendingValue: body.modelId
      })
    );
  }
  if (Object.hasOwn(body, 'modelRoute') || Object.hasOwn(body, 'reasoningEffort')) {
    throw new ParseApiError('INVALID_REQUEST', 'Use modelId and native settings, without modelRoute or reasoningEffort.', 400);
  }
  try {
    const selection = resolveResearchModelSelection(body.modelId, body.settings);
    return { sentence, framework, modelId: selection.catalogId, settings: selection.nativeSettings };
  } catch (error) {
    throw new ParseApiError('INVALID_REQUEST', error.message, 400);
  }
};

export const parseFromBodyWithProviders = async (
  body,
  providers = { research: parseSentenceWithResearchModel },
  { abortSignal } = {}
) => {
  abortSignal?.throwIfAborted();
  const { sentence, framework, modelId, settings } = validateParseBody(body);
  try {
    const bundle = await providers.research(sentence, framework, modelId, { settings, abortSignal });
    return { ...bundle, sentence };
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

/** Both HTTP entry points cancel work only when the response connection closes early. */
export const parseFromRequest = async (req, res, parse = parseFromBody) => {
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
    return await parse(req.body, { abortSignal: controller.signal });
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
