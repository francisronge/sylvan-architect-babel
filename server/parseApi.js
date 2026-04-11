import { ParseApiError, parseSentenceWithGemini, parseSentenceWithLocalModel } from './geminiParser.js';

const FRAMEWORKS = new Set(['xbar', 'minimalism']);
const MODEL_ROUTES = new Set(['local', 'flash-lite', 'pro']);
const MAX_SENTENCE_LENGTH = 600;
const importAtRuntime = new Function('specifier', 'return import(specifier);');

const maybeRecordParseEvent = async ({ sentence, framework, modelRoute, result }) => {
  try {
    const { recordParseEvent } = await importAtRuntime('./parseLogStore.js');
    await recordParseEvent({ sentence, framework, modelRoute, result });
  } catch (error) {
    const code = String(error?.code || '').trim();
    if (code === 'ERR_MODULE_NOT_FOUND') return;
    if (String(error?.message || '').includes("Cannot find package 'postgres'")) return;
    throw error;
  }
};

/**
 * Strip characters and patterns commonly used in prompt-injection attacks
 * while preserving legitimate linguistic content (diacritics, scripts, punctuation).
 */
const sanitizeSentenceInput = (raw) => {
  let s = raw;
  s = s.replace(/`{2,}/g, '');
  s = s.replace(/\[INST\]|\[\/INST\]|\[SYSTEM\]|\[\/SYSTEM\]/gi, '');
  s = s.replace(/^(system|user|assistant|human)\s*:/gim, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
};

export const validateParseBody = (body) => {
  if (!body || typeof body !== 'object') {
    throw new ParseApiError('INVALID_REQUEST', 'Request body must be a JSON object.', 400);
  }

  const rawSentence = typeof body.sentence === 'string' ? body.sentence.trim() : '';
  const framework = typeof body.framework === 'string' ? body.framework.trim() : 'xbar';
  const modelRoute = typeof body.modelRoute === 'string' ? body.modelRoute.trim().toLowerCase() : 'local';

  if (!rawSentence) {
    throw new ParseApiError('INVALID_REQUEST', 'Sentence is required.', 400);
  }

  if (rawSentence.length > MAX_SENTENCE_LENGTH) {
    throw new ParseApiError('INVALID_REQUEST', `Sentence exceeds ${MAX_SENTENCE_LENGTH} characters.`, 400);
  }

  const sentence = sanitizeSentenceInput(rawSentence);

  if (!sentence) {
    throw new ParseApiError('INVALID_REQUEST', 'Sentence is empty after sanitization.', 400);
  }

  if (!FRAMEWORKS.has(framework)) {
    throw new ParseApiError('INVALID_REQUEST', 'Framework must be "xbar" or "minimalism".', 400);
  }

  if (!MODEL_ROUTES.has(modelRoute)) {
    throw new ParseApiError('INVALID_REQUEST', 'Model route must be "local", "flash-lite", or "pro".', 400);
  }

  return { sentence, framework, modelRoute };
};

export const parseFromBodyWithProviders = async (
  body,
  providers = {
    local: parseSentenceWithLocalModel,
    gemini: parseSentenceWithGemini
  }
) => {
  const { sentence, framework, modelRoute } = validateParseBody(body);
  const result = modelRoute === 'local'
    ? await providers.local(sentence, framework, modelRoute)
    : await providers.gemini(sentence, framework, modelRoute);
  await maybeRecordParseEvent({ sentence, framework, modelRoute, result });
  return result;
};

export const parseFromBody = async (body) => parseFromBodyWithProviders(body);

const isProduction = process.env.NODE_ENV === 'production';

export const formatApiError = (error) => {
  if (error instanceof ParseApiError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(isProduction ? {} : { details: error.details })
        }
      }
    };
  }

  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' } }
  };
};
