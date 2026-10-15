import { ParseApiError } from './error.js';
import { withFailureDetails } from './validationErrors.js';
import { parseStrictModelJsonDetailed } from './strictJson.js';

// Transport parsing preserves the original output and byte-level repair evidence
// in the same error envelope as the rest of the parser.
const modelJsonError = (code, message, status, offendingRawText) => new ParseApiError(
  code,
  message,
  status,
  withFailureDetails({}, {
    failureClass: 'transport_serialization',
    ruleId: 'TRANSPORT_JSON_OBJECT',
    fieldPath: '$',
    offendingValue: offendingRawText
  }, offendingRawText)
);

export const parseModelJsonDetailed = (rawText) => parseStrictModelJsonDetailed(rawText, modelJsonError);
export const parseModelJson = (rawText) => parseModelJsonDetailed(rawText).payload;
