import { ParseApiError, parseSentenceWithGemini } from './geminiParser.js';
import { recordParseEvent } from './parseLogStore.js';

const FRAMEWORKS = new Set(['xbar', 'minimalism']);
const MODEL_ROUTES = new Set(['flash-lite', 'pro']);
const MAX_SENTENCE_LENGTH = 600;

export const validateParseBody = (body) => {
  if (!body || typeof body !== 'object') {
    throw new ParseApiError('INVALID_REQUEST', 'Request body must be a JSON object.', 400);
  }

  const sentence = typeof body.sentence === 'string' ? body.sentence.trim() : '';
  const framework = typeof body.framework === 'string' ? body.framework.trim() : 'xbar';
  const modelRoute = typeof body.modelRoute === 'string' ? body.modelRoute.trim().toLowerCase() : 'flash-lite';

  if (!sentence) {
    throw new ParseApiError('INVALID_REQUEST', 'Sentence is required.', 400);
  }

  if (sentence.length > MAX_SENTENCE_LENGTH) {
    throw new ParseApiError('INVALID_REQUEST', `Sentence exceeds ${MAX_SENTENCE_LENGTH} characters.`, 400);
  }

  if (!FRAMEWORKS.has(framework)) {
    throw new ParseApiError('INVALID_REQUEST', 'Framework must be "xbar" or "minimalism".', 400);
  }

  if (!MODEL_ROUTES.has(modelRoute)) {
    throw new ParseApiError('INVALID_REQUEST', 'Model route must be "flash-lite" or "pro".', 400);
  }

  return { sentence, framework, modelRoute };
};

export const parseFromBody = async (body) => {
  const { sentence, framework, modelRoute } = validateParseBody(body);
  const result = await parseSentenceWithGemini(sentence, framework, modelRoute);
  await recordParseEvent({ sentence, framework, modelRoute, result });
  return result;
};

export const formatApiError = (error) => {
  if (error instanceof ParseApiError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          details: error.details
        }
      }
    };
  }

  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' } }
  };
};
