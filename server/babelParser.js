import { buildSystemInstruction } from './babelParser/systemInstruction.js';
import { ParseApiError } from './babelParser/error.js';
import { withFailureDetails } from './babelParser/validationErrors.js';
import {
  normalizeSurfaceToken,
  tokenizeSentenceSurfaceOrder
} from './babelParser/surfaceTokens.js';
import { collectNodeReferencesById } from './babelParser/treeBasics.js';
import {
  buildParseContentsPrompt
} from './babelParser/prompts.js';
import {
  estimateGeminiOutputBudget,
  resolveRouteMaxOutputTokens
} from './babelParser/routeConfig.js';
import {
  extractLocalModelResponseText,
  summarizeGeneration
} from './babelParser/modelRuntime.js';
import { resolveNodeSurface } from './babelParser/derivationHelpers.js';
import { createParseRoutes } from './babelParser/parseRoutes.js';
import { createParseNormalizationHelpers } from './babelParser/parseNormalization.js';
import { createDerivationCompilerHelpers } from './babelParser/derivationCompiler.js';
import {
  collectOvertTerminalNodes,
  sameTokenSequence,
  deriveCanonicalSurfaceSpans
} from './babelParser/syntaxTree.js';
import { parseStrictModelJson, parseStrictModelJsonDetailed } from './babelParser/strictJson.js';

export { ParseApiError } from './babelParser/error.js';

const normalizeOptionalText = (value) => {
  const text = String(value || '').trim();
  return text || undefined;
};

const {
  normalizeDerivationStagesToDerivationFrames,
  normalizeDerivationFrames,
  canonicalizeDerivationRootCandidateForSentence,
  selectCommittedDerivationRoot,
  findCommittedFinalDerivationFrame,
  buildCanonicalDerivationFromDerivationFrames
} = createDerivationCompilerHelpers({
  ParseApiError,
  normalizeOptionalText,
  collectNodeReferencesById,
  collectOvertTerminalNodes,
  resolveNodeSurface,
  sameTokenSequence,
  deriveCanonicalSurfaceSpans
});

const {
  normalizeParseResult,
  normalizeParseBundle
} = createParseNormalizationHelpers({
  ParseApiError,
  normalizeOptionalText,
  tokenizeSentenceSurfaceOrder,
  normalizeDerivationStagesToDerivationFrames,
  normalizeDerivationFrames,
  buildCanonicalDerivationFromDerivationFrames,
  sameTokenSequence,
  collectOvertTerminalNodes,
  resolveNodeSurface
});

const parseModelJson = (rawText) => parseStrictModelJson(
  rawText,
  (code, message, status, offendingRawText) => new ParseApiError(
    code,
    message,
    status,
    withFailureDetails({}, {
      failureClass: 'transport_serialization',
      ruleId: 'TRANSPORT_JSON_OBJECT',
      fieldPath: '$',
      offendingValue: offendingRawText
    }, offendingRawText)
  )
);

const parseModelJsonDetailed = (rawText) => parseStrictModelJsonDetailed(
  rawText,
  (code, message, status, offendingRawText) => new ParseApiError(
    code,
    message,
    status,
    withFailureDetails({}, {
      failureClass: 'transport_serialization',
      ruleId: 'TRANSPORT_JSON_OBJECT',
      fieldPath: '$',
      offendingValue: offendingRawText
    }, offendingRawText)
  )
);

export const {
  parseSentenceWithLocalModel,
  parseSentenceWithGemini,
  parseSentenceWithOpenAI,
  parseSentenceWithClaude,
  parseSentenceWithResearchModel
} = createParseRoutes({
  ParseApiError,
  normalizeParseBundle,
  parseModelJson,
  parseModelJsonDetailed
});

export const __test__ = {
  normalizeParseBundle,
  normalizeParseResult,
  normalizeDerivationStagesToDerivationFrames,
  normalizeDerivationFrames,
  canonicalizeDerivationRootCandidateForSentence,
  selectCommittedDerivationRoot,
  findCommittedFinalDerivationFrame,
  buildCanonicalDerivationFromDerivationFrames,
  buildSystemInstruction,
  buildParseContentsPrompt,
  summarizeGeneration,
  extractLocalModelResponseText,
  estimateGeminiOutputBudget,
  resolveRouteMaxOutputTokens,
  parseModelJson,
  parseModelJsonDetailed,
  normalizeSurfaceToken,
  tokenizeSentenceSurfaceOrder,
  deriveCanonicalSurfaceSpans,
  collectOvertTerminalNodes
};
