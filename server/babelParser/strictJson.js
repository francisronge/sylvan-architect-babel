import { FAILURE_RULES } from './failureRecord.js';

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

const utf8Length = (codePoint) => codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;

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

/**
 * Walks the delimiters outside strings once. `edits` are the closer insertions and
 * removals that would balance the text; they are evidence only and are applied solely
 * through `rebalance`. `strayTailIndex` is set when the first value closes with every
 * closer matched and only closers and whitespace follow it: dropping that tail is the
 * one delimiter edit that cannot move authored material into another container.
 */
const scanDelimiters = (candidate) => {
  const stack = [];
  const edits = [];
  let inString = false;
  let escaped = false;
  let index = 0;
  let byteOffset = 0;
  let rootEndIndex = -1;
  let damagedBeforeRootEnd = false;

  for (const char of candidate) {
    const charIndex = index;
    const charByteOffset = byteOffset;
    index += char.length;
    byteOffset += utf8Length(char.codePointAt(0));

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
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
      if (stack.length === 0 && rootEndIndex < 0) rootEndIndex = index;
      continue;
    }
    if (rootEndIndex < 0) damagedBeforeRootEnd = true;
    const matchingOpenIndex = stack.lastIndexOf(expectedOpen);
    if (matchingOpenIndex >= 0) {
      const insertedText = stack.splice(matchingOpenIndex + 1).reverse()
        .map((open) => OPEN_TO_CLOSE[open]).join('');
      stack.pop();
      edits.push({ kind: 'insert_closers_before_mismatched_closer', index: charIndex,
        byteOffset: charByteOffset, removedText: '', insertedText });
      continue;
    }
    edits.push({ kind: 'remove_unmatched_closer', index: charIndex,
      byteOffset: charByteOffset, removedText: char, insertedText: '' });
  }

  if (stack.length > 0) {
    edits.push({ kind: 'append_closers_at_end_of_output', index, byteOffset,
      removedText: '', insertedText: stack.reverse().map((open) => OPEN_TO_CLOSE[open]).join('') });
  }

  const tail = rootEndIndex >= 0 && !damagedBeforeRootEnd ? candidate.slice(rootEndIndex) : '';
  const strayTailIndex = /^\s*[\]}][\s\]}]*$/u.test(tail)
    ? rootEndIndex + tail.search(/[\]}]/u)
    : -1;
  return { edits, rootEndIndex, strayTailIndex };
};

const rebalance = (candidate, edits) => {
  let output = '';
  let cursor = 0;
  for (const edit of edits) {
    output += candidate.slice(cursor, edit.index) + edit.insertedText;
    cursor = edit.index + edit.removedText.length;
  }
  return output + candidate.slice(cursor);
};

const parsesAsJson = (text) => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

const toRepairDiagnostic = ({ kind, byteOffset, removedText, insertedText }) => createRepairDiagnostic({
  kind,
  candidateByteOffset: byteOffset,
  removedText,
  insertedText
});

const describeDelimiterDamage = (edits) => {
  const [first] = edits;
  const where = first.kind === 'append_closers_at_end_of_output'
    ? `the response ends with ${first.insertedText.length} bracket${first.insertedText.length === 1 ? '' : 's'} still open`
    : first.kind === 'insert_closers_before_mismatched_closer'
      ? `the closing bracket at byte ${first.byteOffset} does not match the bracket it would close`
      : `the closing bracket at byte ${first.byteOffset} has no opening bracket`;
  const further = edits.length > 1 ? `, with ${edits.length - 1} further imbalance${edits.length === 2 ? '' : 's'}` : '';
  return `The response's brackets do not balance: ${where}${further}. Babel does not insert or move brackets, because the missing or extra bracket may belong anywhere earlier and rebalancing can place part of an analysis inside the wrong element.`;
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
        ...(jsonDiagnostic?.kind === 'json-delimiter-damage'
          ? { ruleId: FAILURE_RULES.TRANSPORT_JSON_DELIMITERS_BALANCED } : {}),
        expectedForm: 'one complete JSON object', message: jsonDiagnostic?.message || error.message };
      error.details.failure = error.failure;
    }
  }
  return error;
};

/**
 * The only delimiter repair applied is removing a stray closing tail after the complete
 * value. Text that only rebalancing would make valid fails with
 * TRANSPORT_JSON_DELIMITERS_BALANCED; on any failure, `payloadRepairDiagnostics` lists
 * edits that were considered and not applied.
 */
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
    const scan = scanDelimiters(candidate);
    if (scan.strayTailIndex >= 0) {
      repairDiagnostics.push(createRepairDiagnostic({
        kind: 'remove_unmatched_closer',
        candidateByteOffset: UTF8_ENCODER.encode(candidate.slice(0, scan.strayTailIndex)).byteLength,
        removedText: candidate.slice(scan.strayTailIndex)
      }));
      try {
        parsed = JSON.parse(candidate.slice(0, scan.rootEndIndex));
        integrityFlags.push('json_delimiter_damage_repaired');
      } catch {
        throw createBadJsonError(createError, rawTextForError, repairDiagnostics, jsonDiagnostic);
      }
    } else {
      repairDiagnostics.push(...scan.edits.map(toRepairDiagnostic));
      if (scan.edits.length === 0 || !parsesAsJson(rebalance(candidate, scan.edits))) {
        throw createBadJsonError(createError, rawTextForError, repairDiagnostics, jsonDiagnostic);
      }
      const [first] = scan.edits;
      const prefix = rawTextForError.indexOf(candidate);
      throw createBadJsonError(createError, rawTextForError, repairDiagnostics, {
        kind: 'json-delimiter-damage',
        message: describeDelimiterDamage(scan.edits),
        candidateByteOffset: first.byteOffset,
        originalByteOffset: UTF8_ENCODER.encode(rawTextForError.slice(0, prefix + first.index)).byteLength,
        originalSyntaxError: jsonDiagnostic
      });
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
