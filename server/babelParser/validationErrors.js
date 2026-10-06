import { createHash } from 'node:crypto';

import { FAILURE_CLASSES, FAILURE_RULES, createFailureRecord } from './failureRecord.js';
export { FAILURE_CLASSES, FAILURE_RULES } from './failureRecord.js';

export const MAX_RAW_OUTPUT_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_INLINE_OFFENDING_VALUE_BYTES = 64 * 1024;
// Base64 expands bytes by 4/3. Reserve 128 KiB for the typed failure,
// attempt receipts, and JSON envelope so the complete error body remains
// within the 2 MiB in-body boundary.
export const MAX_RAW_OUTPUT_BYTES = Math.floor((MAX_RAW_OUTPUT_BODY_BYTES - (128 * 1024)) * 3 / 4);

const FAILURE_CLASS_VALUES = new Set(Object.values(FAILURE_CLASSES));

const sha256Bytes = (bytes) => createHash('sha256').update(bytes).digest('hex');

const normalizeOffendingValue = (value) => {
  if (typeof value === 'undefined') return { kind: 'missing' };
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    if (bytes.byteLength > MAX_INLINE_OFFENDING_VALUE_BYTES) {
      return {
        kind: 'value_too_large_for_inline_error',
        byteLength: bytes.byteLength,
        sha256: sha256Bytes(bytes)
      };
    }
  }
  if (value && typeof value === 'object') {
    try {
      const serialized = JSON.stringify(value);
      const bytes = Buffer.from(serialized, 'utf8');
      if (bytes.byteLength > MAX_INLINE_OFFENDING_VALUE_BYTES) {
        return {
          kind: 'value_too_large_for_inline_error',
          byteLength: bytes.byteLength,
          sha256: sha256Bytes(bytes)
        };
      }
    } catch {
      return { kind: 'non_serializable_value' };
    }
  }
  return value;
};

export const createRawOutputArtifact = (rawOutput) => {
  const bytes = Buffer.isBuffer(rawOutput) ? rawOutput : Buffer.from(String(rawOutput ?? ''), 'utf8');
  const retainedBytes = bytes.subarray(0, MAX_RAW_OUTPUT_BYTES);
  return {
    mediaType: 'text/plain',
    encoding: 'base64',
    byteLength: bytes.byteLength,
    retainedByteLength: retainedBytes.byteLength,
    truncated: retainedBytes.byteLength !== bytes.byteLength,
    sha256: sha256Bytes(bytes),
    data: retainedBytes.toString('base64')
  };
};

export const createFailure = (input = {}) => createFailureRecord(input, normalizeOffendingValue);

const inferFailureClass = (code, details = {}) => {
  if (details?.failureClass && FAILURE_CLASS_VALUES.has(details.failureClass)) {
    return details.failureClass;
  }
  if (code === 'BAD_MODEL_RESPONSE') return FAILURE_CLASSES.CONTRACT_MISUNDERSTANDING;
  if (code === 'INCOMPLETE_GENERATION') return FAILURE_CLASSES.INCOMPLETE_GENERATION;
  if (
    code === 'INVALID_REQUEST'
    || code === 'API_KEY_MISSING'
    || code === 'API_KEY_INVALID'
    || code === 'GEMINI_QUOTA'
    || code === 'PROVIDER_QUOTA'
    || code === 'MODEL_UNAVAILABLE'
    || code === 'PROVIDER_UNAVAILABLE'
    || code === 'GEMINI_UNAVAILABLE'
    || code === 'GEMINI_TIMEOUT'
    || code === 'GEMINI_TRANSPORT'
    || code === 'LOCAL_MODEL_UNAVAILABLE'
  ) {
    return FAILURE_CLASSES.TRANSPORT_SERIALIZATION;
  }
  return FAILURE_CLASSES.DETERMINISTIC_ENGINE_FAILURE;
};

export const failureFromErrorParts = (code, details = {}) => {
  if (details?.failure && typeof details.failure === 'object') {
    return createFailure({
      ...details.failure,
      failureClass: details.failure.class,
    });
  }
  return createFailure({
    failureClass: inferFailureClass(code, details),
    ruleId: details?.ruleId || String(code || FAILURE_RULES.DETERMINISTIC_ENGINE),
    stageIndex: details?.stageIndex,
    fieldPath: details?.fieldPath || '$',
    offendingValue: Object.prototype.hasOwnProperty.call(details || {}, 'offendingValue')
      ? details.offendingValue
      : (details?.providerMessage ?? details?.transportMessage ?? null)
  });
};

export const withFailureDetails = (details = {}, failure, rawOutput) => ({
  ...(details && typeof details === 'object' ? details : {}),
  failure: createFailure(failure),
  ...(typeof rawOutput === 'undefined'
    ? {}
    : { rawOutputArtifact: createRawOutputArtifact(rawOutput) })
});
