const normalizeParsedRoot = (value) => {
  if (Array.isArray(value)) return { analyses: value };
  if (value && typeof value === 'object') return value;
  return null;
};

const parseStrictJsonCandidate = (candidate, createError) => {
  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw createError('BAD_MODEL_RESPONSE', 'Model returned malformed JSON.', 502);
  }

  if (typeof parsed === 'string') {
    const nested = parsed.trim();
    if (nested.startsWith('{') || nested.startsWith('[')) {
      try {
        parsed = JSON.parse(nested);
      } catch {
        throw createError('BAD_MODEL_RESPONSE', 'Model returned malformed JSON.', 502);
      }
    }
  }

  if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
    const embedded = parsed.text.trim();
    if (embedded.startsWith('{') || embedded.startsWith('[')) {
      try {
        parsed = JSON.parse(embedded);
      } catch {
        throw createError('BAD_MODEL_RESPONSE', 'Model returned malformed JSON.', 502);
      }
    }
  }

  const normalized = normalizeParsedRoot(parsed);
  if (!normalized) {
    throw createError('BAD_MODEL_RESPONSE', 'Model returned malformed JSON.', 502);
  }
  return normalized;
};

export const parseStrictModelJson = (rawText, createError) => {
  const text = String(rawText || '')
    .replace(/^\uFEFF/, '')
    .trim();
  if (!text) {
    throw createError('BAD_MODEL_RESPONSE', 'Model returned malformed JSON.', 502);
  }
  return parseStrictJsonCandidate(text, createError);
};
