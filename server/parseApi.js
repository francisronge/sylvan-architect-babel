import {
  ParseApiError,
  parseSentenceWithClaude,
  parseSentenceWithGemini,
  parseSentenceWithOpenAI,
  parseSentenceWithResearchModel
} from './babelParser.js';
import { GENERATION_MODEL_IDS, resolveResearchModelSelection } from './babelParser/researchModelCatalog.js';
import { normalizeProviderReasoningEffort } from './babelParser/routeConfig.js';
import {
  createFailure,
  withFailureDetails
} from './babelParser/validationErrors.js';

const FRAMEWORKS = new Set(['xbar', 'minimalism']);
const MODEL_ROUTES = new Set(['gemini', 'gpt', 'claude']);
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
  const modelRoute = typeof body.modelRoute === 'string' ? body.modelRoute.trim().toLowerCase() : 'gemini';
  const reasoningEffort = normalizeProviderReasoningEffort(
    modelRoute,
    typeof body.reasoningEffort === 'string' ? body.reasoningEffort : undefined
  );

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

  if (Object.hasOwn(body, 'modelId')) {
    if (!GENERATION_MODEL_IDS.includes(body.modelId)) {
      throw new ParseApiError('INVALID_REQUEST', 'This model is not enabled for generation.', 400);
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
  }

  if (!MODEL_ROUTES.has(modelRoute)) {
    throw new ParseApiError(
      'INVALID_REQUEST',
      'Model route must be "gemini", "gpt", or "claude".',
      400,
      withFailureDetails({}, {
        failureClass: 'transport_serialization',
        ruleId: 'REQUEST_MODEL_ROUTE_SUPPORTED',
        fieldPath: '$.modelRoute',
        offendingValue: modelRoute
      })
    );
  }

  return { sentence, framework, modelRoute, reasoningEffort };
};

export const parseFromBodyWithProviders = async (
  body,
  providers = {
    gemini: parseSentenceWithGemini,
    gpt: parseSentenceWithOpenAI,
    claude: parseSentenceWithClaude,
    research: parseSentenceWithResearchModel
  }
  ) => {
  const { sentence, framework, modelId, settings, modelRoute, reasoningEffort } = validateParseBody(body);
  if (modelId) return providers.research(sentence, framework, modelId, { settings });
  return providers[modelRoute](sentence, framework, modelRoute, { reasoningEffort });
};

export const parseFromBody = async (body) => parseFromBodyWithProviders(body);

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
        statusCode: attempt?.statusCode
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

export const formatApiError = (error) => {
  if (error instanceof ParseApiError) {
    const {
      rawOutputArtifact: _rawOutputArtifact,
      generationRecord,
      ...safeDetails
    } =
      error.details && typeof error.details === 'object'
        ? error.details
        : {};
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          failure: error.failure,
          ...(error.rawOutput ? { rawOutput: error.rawOutput } : {}),
          ...(generationRecord
            ? { generationRecord: projectPublicGenerationRecord(generationRecord) }
            : {}),
          ...(isProduction ? {} : { details: safeDetails })
        }
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
