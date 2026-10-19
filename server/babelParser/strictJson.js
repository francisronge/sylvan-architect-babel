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

/** Index just past the closer that completes the value opened at `start`, or
 * -1 when the line does not complete it or closes it with the wrong delimiter. */
const endOfLineValue = (line, start) => {
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < line.length; index += 1) {
    const char = line[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === '{' || char === '[') {
      stack.push(char);
    } else if (char === '}' || char === ']') {
      if (stack.pop() !== CLOSE_TO_OPEN[char]) return -1;
      if (stack.length === 0) return index + 1;
    }
  }
  return -1;
};

const EXCESS_LINE_CLOSERS = /^(\s*)([\]}](?:\s*[\]}])*)\s*,?\s*$/;

/**
 * Over-closed one-line values in a multi-line response. A line that begins
 * with { or [ and completes that value, then closes containers the following
 * lines close again, ends the root early. Only those trailing closers are
 * removed; every other byte, and the structure the lines themselves lay out,
 * is kept. The caller keeps the result only if it parses.
 */
const trimOverclosedLines = (candidate) => {
  const lines = candidate.split('\n');
  if (lines.length < 2) return null;
  const diagnostics = [];
  let lineByteOffset = 0;
  const repairedLines = lines.map((line) => {
    const offset = lineByteOffset;
    lineByteOffset += UTF8_ENCODER.encode(line).byteLength + 1;
    const start = line.search(/\S/);
    if (start < 0 || (line[start] !== '{' && line[start] !== '[')) return line;
    const end = endOfLineValue(line, start);
    const excess = end < 0 ? null : EXCESS_LINE_CLOSERS.exec(line.slice(end));
    if (!excess) return line;
    const removedFrom = end + excess[1].length;
    const removedText = excess[2];
    diagnostics.push(createRepairDiagnostic({
      kind: 'remove_excess_closers_at_line_end',
      candidateByteOffset: offset + UTF8_ENCODER.encode(line.slice(0, removedFrom)).byteLength,
      removedText
    }));
    return line.slice(0, removedFrom) + line.slice(removedFrom + removedText.length);
  });
  return diagnostics.length > 0
    ? { repairedCandidate: repairedLines.join('\n'), repairDiagnostics: diagnostics }
    : null;
};

// Tried in order after the strict parse fails; the first whose result parses is
// kept and flagged. Attempted edits are retained when none parses.
const PAYLOAD_REPAIRS = [
  { repair: repairDelimiterDamage, flag: 'json_delimiter_damage_repaired' },
  { repair: trimOverclosedLines, flag: 'json_overclosed_lines_repaired' }
];

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
    const attempted = [];
    let repaired = false;
    for (const { repair, flag } of PAYLOAD_REPAIRS) {
      const result = repair(candidate);
      if (!result) continue;
      try {
        parsed = JSON.parse(result.repairedCandidate);
      } catch {
        attempted.push(...result.repairDiagnostics);
        continue;
      }
      repairDiagnostics.push(...result.repairDiagnostics);
      integrityFlags.push(flag);
      repaired = true;
      break;
    }
    if (!repaired) {
      throw createBadJsonError(createError, rawTextForError, [...repairDiagnostics, ...attempted], jsonDiagnostic);
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
