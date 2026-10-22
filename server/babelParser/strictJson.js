import { FAILURE_RULES } from './failureRecord.js';

const normalizeParsedRoot = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return null;
};

const CLOSE_TO_OPEN = {
  '}': '{',
  ']': '['
};

const UTF8_ENCODER = new TextEncoder();

const byteLength = (text) => UTF8_ENCODER.encode(text).byteLength;

/**
 * Finds the first bracket outside strings that breaks nesting: a closer that does not
 * close the innermost open bracket, or brackets still open at the end. It only
 * reports; Babel never inserts, removes or moves a bracket.
 */
const findBracketImbalance = (candidate) => {
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < candidate.length; index += 1) {
    const char = candidate[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' || char === ']') {
      if (stack[stack.length - 1] !== CLOSE_TO_OPEN[char]) {
        return { index, kind: stack.length === 0 ? 'closer-after-value' : 'mismatched-closer' };
      }
      stack.pop();
    }
  }
  return !inString && stack.length > 0
    ? { index: candidate.length, kind: 'open-at-end', openCount: stack.length }
    : null;
};

const describeBracketImbalance = (imbalance, candidateByteOffset) => {
  const where = imbalance.kind === 'open-at-end'
    ? `the response ends with ${imbalance.openCount} bracket${imbalance.openCount === 1 ? '' : 's'} still open`
    : imbalance.kind === 'closer-after-value'
      ? `the closing bracket at byte ${candidateByteOffset} follows the complete value`
      : `the closing bracket at byte ${candidateByteOffset} does not match the bracket it would close`;
  return `The response's brackets do not balance: ${where}. Babel does not insert, remove or move brackets, because the missing or extra bracket may belong anywhere earlier and rebalancing can place part of an analysis inside the wrong element.`;
};

const describeJsonError = (error, candidate, rawText) => {
  const message = String(error.message);
  const position = message.match(/\bposition (\d+)/);
  const offset = position ? Number(position[1])
    : /end of JSON input/i.test(message) ? candidate.length : null;
  const prefix = rawText.indexOf(candidate);
  const syntaxError = {
    kind: 'json-syntax',
    message,
    ...(offset === null ? {} : {
      candidateByteOffset: byteLength(candidate.slice(0, offset)),
      originalByteOffset: byteLength(rawText.slice(0, prefix + offset))
    })
  };
  // When the parser stops at the first bracket that breaks nesting, name that bracket.
  const imbalance = offset === null ? null : findBracketImbalance(candidate);
  if (!imbalance || imbalance.index !== offset) return syntaxError;
  return {
    kind: 'json-delimiter-damage',
    message: describeBracketImbalance(imbalance, syntaxError.candidateByteOffset),
    candidateByteOffset: syntaxError.candidateByteOffset,
    originalByteOffset: syntaxError.originalByteOffset,
    originalSyntaxError: syntaxError
  };
};

const createBadJsonError = (createError, rawText, jsonDiagnostic) => {
  const error = typeof createError === 'function'
    ? createError(
      'BAD_MODEL_RESPONSE',
      'Model response was not a valid JSON object.',
      502,
      rawText
    )
    : new Error('Model returned malformed JSON.');
  if (error && typeof error === 'object') {
    error.details = {
      ...(error.details && typeof error.details === 'object' ? error.details : {}),
      ...(jsonDiagnostic ? { jsonDiagnostic } : {})
    };
    if (error.failure) {
      error.failure = { ...error.failure, processingStep: 'json-decoding',
        ...(jsonDiagnostic?.kind === 'json-delimiter-damage'
          ? { ruleId: FAILURE_RULES.TRANSPORT_JSON_DELIMITERS_BALANCED } : {}),
        expectedForm: 'one complete JSON object', message: jsonDiagnostic?.message || error.message };
      error.details.failure = error.failure;
    }
  }
  return error;
};

/**
 * Parses the model text as received, after removing a leading BOM and outer whitespace.
 * Nothing else is repaired: a response whose brackets do not balance fails as
 * TRANSPORT_JSON_DELIMITERS_BALANCED with the parser's own error retained.
 */
export const parseStrictModelJsonDetailed = (rawText, createError) => {
  const originalText = String(rawText ?? '');
  const text = originalText
    .replace(/^\uFEFF/, '')
    .trim();
  if (!text) {
    throw createBadJsonError(createError, originalText, {
      kind: 'json-syntax', message: 'The response contains no JSON text.', originalByteOffset: 0
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw createBadJsonError(createError, originalText, describeJsonError(error, text, originalText));
  }
  const payload = normalizeParsedRoot(parsed);
  if (!payload) {
    throw createBadJsonError(createError, originalText, {
      kind: 'json-root-type',
      message: `Expected one JSON object; received ${parsed === null ? 'null' : Array.isArray(parsed) ? 'an array' : typeof parsed}.`
    });
  }
  return { payload };
};
