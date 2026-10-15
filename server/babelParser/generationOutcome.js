import { ParseApiError } from './error.js';
import { withFailureDetails } from './validationErrors.js';

const isTruncatedGeneration = (generation) => {
  const finishReason = String(generation?.candidates?.[0]?.finishReason || '').toUpperCase();
  return (
    finishReason.includes('MAX_TOKENS')
    || finishReason.includes('MAX_OUTPUT_TOKENS')
    || finishReason.includes('LENGTH')
  );
};

const SUCCESSFUL_GENERATION_STOPS = new Set([
  'COMPLETED',
  'END_TURN',
  'STOP',
  'STOP_SEQUENCE'
]);

const isSuccessfulGenerationStop = (generation) => {
  const finishReason = String(generation?.candidates?.[0]?.finishReason || '').toUpperCase();
  return SUCCESSFUL_GENERATION_STOPS.has(finishReason);
};

export const summarizeGeneration = (generation) => {
  const contentParts = Array.isArray(generation?.candidates?.[0]?.content?.parts)
    ? generation.candidates[0].content.parts
    : [];
  const nonThoughtText = contentParts
    .filter((part) => !part?.thought && typeof part?.text === 'string')
    .map((part) => String(part.text || ''))
    .join('');
  const rawText = String(nonThoughtText || generation?.text || '');
  const finishReason = String(generation?.candidates?.[0]?.finishReason || '').toUpperCase() || 'UNKNOWN';
  const status = String(generation?.status || finishReason || 'UNKNOWN').toUpperCase();
  const promptTokenCount = Number(
    generation?.usageMetadata?.promptTokenCount
    || generation?.usageMetadata?.inputTokenCount
    || generation?.usageMetadata?.promptTokens
    || 0
  ) || undefined;
  const outputTokenCount = Number(
    generation?.usageMetadata?.candidatesTokenCount
    || generation?.usageMetadata?.outputTokenCount
    || generation?.usageMetadata?.completionTokenCount
    || 0
  ) || undefined;
  const totalTokenCount = Number(
    generation?.usageMetadata?.totalTokenCount
    || generation?.usageMetadata?.totalTokens
    || 0
  ) || (promptTokenCount && outputTokenCount ? (promptTokenCount + outputTokenCount) : undefined);
  const preview = rawText
    .slice(0, 220)
    .replace(/\s+/g, ' ')
    .trim();
  return {
    rawText,
    finishReason,
    textLength: rawText.length,
    preview,
    promptTokenCount,
    outputTokenCount,
    totalTokenCount,
    reasoningTokenCount: Number(
      generation?.usageMetadata?.reasoningTokenCount
      || generation?.usageMetadata?.thoughtsTokenCount
      || generation?.usageMetadata?.totalThoughtTokens
      || 0
    ) || undefined,
    status
  };
};

export const assertGenerationComplete = ({
  generation,
  provider,
  model,
  sentMaxOutputTokens,
  runId,
  attempts = []
}) => {
  const generationMeta = summarizeGeneration(generation);
  const lengthStop = isTruncatedGeneration(generation);
  if (!lengthStop && isSuccessfulGenerationStop(generation)) return generationMeta;

  const ruleId = lengthStop
    ? 'GENERATION_LENGTH_STOP'
    : 'GENERATION_COMPLETED_STOP_FAILURE';
  const message = lengthStop
    ? `The ${provider} generation stopped at its output limit before parsing.`
    : `The ${provider} generation completed with ${generationMeta.finishReason} instead of a successful stop.`;

  throw new ParseApiError(
    'INCOMPLETE_GENERATION',
    message,
    422,
    withFailureDetails({
      provider,
      model,
      sentMaxOutputTokens,
      finishReason: generationMeta.finishReason,
      finishStatus: generationMeta.status,
      reasoningTokenCount: generationMeta.reasoningTokenCount,
      outputTokenCount: generationMeta.outputTokenCount,
      runId,
      attempts
    }, {
      failureClass: 'incomplete_generation',
      ruleId,
      stageIndex: null,
      fieldPath: '$',
      offendingValue: {
        finishReason: generationMeta.finishReason,
        finishStatus: generationMeta.status,
        sentMaxOutputTokens
      }
    }, generationMeta.rawText)
  );
};

export const buildGenerationOutcome = ({
  generationMeta,
  sentMaxOutputTokens,
  runId,
  attempts = []
}) => ({
  sentMaxOutputTokens,
  finishReason: generationMeta.finishReason,
  finishStatus: generationMeta.status,
  ...(generationMeta.reasoningTokenCount
    ? { reasoningTokenCount: generationMeta.reasoningTokenCount }
    : {}),
  ...(generationMeta.promptTokenCount
    ? { promptTokenCount: generationMeta.promptTokenCount }
    : {}),
  ...(generationMeta.outputTokenCount
    ? { outputTokenCount: generationMeta.outputTokenCount }
    : {}),
  ...(generationMeta.totalTokenCount
    ? { totalTokenCount: generationMeta.totalTokenCount }
    : {}),
  runId,
  attempts
});
