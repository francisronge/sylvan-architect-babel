import { ParseApiError, parseSentenceWithGemini } from './geminiParser.js';

const FRAMEWORKS = new Set(['xbar', 'minimalism']);
const MAX_SENTENCE_LENGTH = 600;

export const validateParseBody = (body) => {
  if (!body || typeof body !== 'object') {
    throw new ParseApiError('INVALID_REQUEST', 'Request body must be a JSON object.', 400);
  }

  const sentence = typeof body.sentence === 'string' ? body.sentence.trim() : '';
  const framework = typeof body.framework === 'string' ? body.framework.trim() : 'xbar';

  if (!sentence) {
    throw new ParseApiError('INVALID_REQUEST', 'Sentence is required.', 400);
  }

  if (sentence.length > MAX_SENTENCE_LENGTH) {
    throw new ParseApiError('INVALID_REQUEST', `Sentence exceeds ${MAX_SENTENCE_LENGTH} characters.`, 400);
  }

  if (!FRAMEWORKS.has(framework)) {
    throw new ParseApiError('INVALID_REQUEST', 'Framework must be "xbar" or "minimalism".', 400);
  }

  return { sentence, framework };
};

export const parseFromBody = async (body) => {
  const { sentence, framework } = validateParseBody(body);
  return parseSentenceWithGemini(sentence, framework);
};

export const formatApiError = (error) => {
  if (error instanceof ParseApiError) {
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message } }
    };
  }

  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' } }
  };
};
