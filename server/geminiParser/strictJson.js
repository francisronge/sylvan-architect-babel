const normalizeParsedRoot = (value) => {
  if (Array.isArray(value)) return { analyses: value };
  if (value && typeof value === 'object') return value;
  return null;
};

const extractBalancedJsonRoot = (text) => {
  const source = String(text || '');
  let startIndex = -1;
  let openChar = '';
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{' || char === '[') {
      startIndex = index;
      openChar = char;
      break;
    }
  }
  if (startIndex < 0) return null;

  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === openChar) {
      depth += 1;
      continue;
    }
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        const candidate = source.slice(startIndex, index + 1).trim();
        const leading = source.slice(0, startIndex).trim();
        const trailing = source.slice(index + 1).trim();
        return {
          candidate,
          hadWrapperText: Boolean(leading || trailing)
        };
      }
    }
  }

  return null;
};

const parseStrictJsonCandidate = (candidate, createError, integrityFlags = []) => {
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
        integrityFlags.push('json_string_unwrapped');
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
        integrityFlags.push('json_text_field_unwrapped');
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

export const parseStrictModelJsonDetailed = (rawText, createError) => {
  const text = String(rawText || '')
    .replace(/^\uFEFF/, '')
    .trim();
  if (!text) {
    throw createError('BAD_MODEL_RESPONSE', 'Model returned malformed JSON.', 502);
  }
  const integrityFlags = [];
  try {
    return {
      payload: parseStrictJsonCandidate(text, createError, integrityFlags),
      integrityFlags: Array.from(new Set(integrityFlags))
    };
  } catch (error) {
    const extracted = extractBalancedJsonRoot(text);
    if (!extracted?.candidate || extracted.candidate === text) {
      throw error;
    }
    if (extracted.hadWrapperText) {
      integrityFlags.push('json_root_extracted');
    }
    return {
      payload: parseStrictJsonCandidate(extracted.candidate, createError, integrityFlags),
      integrityFlags: Array.from(new Set(integrityFlags))
    };
  }
};

export const parseStrictModelJson = (rawText, createError) =>
  parseStrictModelJsonDetailed(rawText, createError).payload;
