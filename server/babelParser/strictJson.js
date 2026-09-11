const normalizeParsedRoot = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return null;
};

const CLOSE_TO_OPEN = {
  '}': '{',
  ']': '['
};

const OPEN_TO_CLOSE = {
  '{': '}',
  '[': ']'
};

const UTF8_ENCODER = new TextEncoder();

const bytesToHex = (value) => Array.from(
  UTF8_ENCODER.encode(String(value || '')),
  (byte) => byte.toString(16).padStart(2, '0')
).join('');

const createRepairDiagnostic = ({
  kind,
  candidateByteOffset,
  removedText = '',
  insertedText = ''
}) => ({
  kind,
  candidateByteOffset,
  removedText,
  insertedText,
  removedBytesHex: bytesToHex(removedText),
  insertedBytesHex: bytesToHex(insertedText)
});

const repairDelimiterDamage = (candidate) => {
  let output = '';
  const stack = [];
  const diagnostics = [];
  let inString = false;
  let escaped = false;
  let inputByteOffset = 0;

  for (const char of candidate) {
    const charByteOffset = inputByteOffset;
    inputByteOffset += UTF8_ENCODER.encode(char).byteLength;
    output += char;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      stack.push(char);
      continue;
    }

    if (char !== '}' && char !== ']') continue;

    const expectedOpen = CLOSE_TO_OPEN[char];
    if (stack[stack.length - 1] === expectedOpen) {
      stack.pop();
      continue;
    }

    const matchingOpenIndex = stack.lastIndexOf(expectedOpen);
    if (matchingOpenIndex >= 0) {
      output = output.slice(0, -1);
      let insertedText = '';
      while (stack.length > 0 && stack[stack.length - 1] !== expectedOpen) {
        insertedText += OPEN_TO_CLOSE[stack.pop()];
      }
      output += insertedText;
      output += char;
      stack.pop();
      diagnostics.push(createRepairDiagnostic({
        kind: 'insert_closers_before_mismatched_closer',
        candidateByteOffset: charByteOffset,
        insertedText
      }));
      continue;
    }

    output = output.slice(0, -1);
    diagnostics.push(createRepairDiagnostic({
      kind: 'remove_unmatched_closer',
      candidateByteOffset: charByteOffset,
      removedText: char
    }));
  }

  let appendedText = '';
  while (stack.length > 0) {
    appendedText += OPEN_TO_CLOSE[stack.pop()];
  }
  if (appendedText) {
    output += appendedText;
    diagnostics.push(createRepairDiagnostic({
      kind: 'append_closers_at_end_of_output',
      candidateByteOffset: inputByteOffset,
      insertedText: appendedText
    }));
  }

  return diagnostics.length > 0
    ? { repairedCandidate: output, repairDiagnostics: diagnostics }
    : null;
};

const describeJsonError = (error, candidate, rawText) => {
  const message = String(error.message);
  const position = message.match(/\bposition (\d+)/);
  const offset = position ? Number(position[1])
    : /end of JSON input/i.test(message) ? candidate.length : null;
  const prefix = rawText.indexOf(candidate);
  return {
    kind: 'json-syntax',
    message,
    ...(offset === null ? {} : {
      candidateByteOffset: UTF8_ENCODER.encode(candidate.slice(0, offset)).byteLength,
      originalByteOffset: UTF8_ENCODER.encode(rawText.slice(0, prefix + offset)).byteLength
    })
  };
};

const createBadJsonError = (createError, rawText, repairDiagnostics = [], jsonDiagnostic) => {
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
      ...(repairDiagnostics.length > 0 ? { payloadRepairDiagnostics: repairDiagnostics } : {}),
      ...(jsonDiagnostic ? { jsonDiagnostic } : {})
    };
    if (error.failure) {
      error.failure = { ...error.failure, processingStep: 'json-decoding',
        expectedForm: 'one complete JSON object', message: jsonDiagnostic?.message || error.message };
      error.details.failure = error.failure;
    }
  }
  return error;
};

const parseStrictJsonCandidate = (
  candidate,
  createError,
  integrityFlags = [],
  repairDiagnostics = [],
  rawTextForError = candidate
) => {
  let parsed;
  let jsonDiagnostic;
  try {
    parsed = JSON.parse(candidate);
  } catch (initialError) {
    jsonDiagnostic = describeJsonError(initialError, candidate, rawTextForError);
    const repair = repairDelimiterDamage(candidate);
    if (!repair) {
      throw createBadJsonError(createError, rawTextForError, repairDiagnostics, jsonDiagnostic);
    }
    repairDiagnostics.push(...repair.repairDiagnostics);
    try {
      parsed = JSON.parse(repair.repairedCandidate);
      integrityFlags.push('json_delimiter_damage_repaired');
    } catch {
      throw createBadJsonError(createError, rawTextForError, repairDiagnostics, jsonDiagnostic);
    }
  }

  const normalized = normalizeParsedRoot(parsed);
  if (!normalized) {
    throw createBadJsonError(createError, rawTextForError, repairDiagnostics, {
      kind: 'json-root-type', message: `Expected one JSON object; received ${parsed === null ? 'null' : Array.isArray(parsed) ? 'an array' : typeof parsed}.`,
      ...(jsonDiagnostic ? { originalSyntaxError: jsonDiagnostic } : {})
    });
  }
  return { payload: normalized, ...(jsonDiagnostic ? { jsonDiagnostic } : {}) };
};

export const parseStrictModelJsonDetailed = (rawText, createError) => {
  const originalText = String(rawText ?? '');
  const text = originalText
    .replace(/^\uFEFF/, '')
    .trim();
  if (!text) {
    throw createBadJsonError(createError, originalText, [], {
      kind: 'json-syntax', message: 'The response contains no JSON text.', originalByteOffset: 0
    });
  }

  const integrityFlags = [];
  const repairDiagnostics = [];
  return {
    ...parseStrictJsonCandidate(
      text,
      createError,
      integrityFlags,
      repairDiagnostics,
      originalText
    ),
    integrityFlags,
    repairDiagnostics
  };
};

export const parseStrictModelJson = (rawText, createError) =>
  parseStrictModelJsonDetailed(rawText, createError).payload;
