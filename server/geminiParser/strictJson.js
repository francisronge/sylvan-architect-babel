const normalizeParsedRoot = (value) => {
  if (Array.isArray(value)) return { analyses: value };
  if (value && typeof value === 'object') return value;
  return null;
};

const createBadJsonError = (createError) => {
  if (typeof createError === 'function') {
    return createError('BAD_MODEL_RESPONSE', 'Model returned malformed JSON.', 502);
  }
  return new Error('Model returned malformed JSON.');
};

const parseStrictJsonCandidate = (candidate, createError) => {
  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw createBadJsonError(createError);
  }

  const normalized = normalizeParsedRoot(parsed);
  if (!normalized) {
    throw createBadJsonError(createError);
  }
  return normalized;
};

export const parseStrictModelJsonDetailed = (rawText, createError) => {
  const text = String(rawText || '')
    .replace(/^\uFEFF/, '')
    .trim();
  if (!text) {
    throw createBadJsonError(createError);
  }

  // Intentionally strict: no delimiter repair, no leaked-stage relocation,
  // no wrapper extraction, and no linguistic or structural recovery.
  return {
    payload: parseStrictJsonCandidate(text, createError),
    integrityFlags: []
  };
};

export const parseStrictModelJson = (rawText, createError) =>
  parseStrictModelJsonDetailed(rawText, createError).payload;
