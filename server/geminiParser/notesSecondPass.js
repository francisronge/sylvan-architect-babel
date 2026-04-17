import { parseStrictModelJson, parseStrictModelJsonDetailed } from './strictJson.js';
import {
  buildNotesSecondPassFrozenAnalysis as buildNotesSecondPassFrozenAnalysisFromContext,
  buildNotesSecondPassSupportInventory as buildNotesSecondPassSupportInventoryFromContext,
  buildNotesSecondPassPrompt as buildNotesSecondPassPromptFromContext
} from './promptContext.js';
import {
  buildNotesSecondPassSystemInstruction,
  NOTES_SECOND_PASS_MAX_OUTPUT_TOKENS,
  NOTES_SECOND_PASS_TEMPERATURE
} from './prompts.js';
import {
  LOCAL_MODEL_TIMEOUT_MS,
  getRemainingRequestBudgetMs
} from './routeConfig.js';
import {
  generateStructuredContent,
  generateStructuredLocalContent,
  summarizeGeneration,
  withTimeout,
  writeDebugModelPayload
} from './modelRuntime.js';

export const createNotesSecondPassHelpers = ({
  ParseApiError,
  normalizeChainType,
  normalizeParseBundle
}) => {
  const parseModelJson = (rawText) => parseStrictModelJson(
    rawText,
    (code, message, status) => new ParseApiError(code, message, status)
  );
  const parseModelJsonDetailed = (rawText) => parseStrictModelJsonDetailed(
    rawText,
    (code, message, status) => new ParseApiError(code, message, status)
  );

  const buildNotesSecondPassFrozenAnalysis = (analysis = {}) =>
    buildNotesSecondPassFrozenAnalysisFromContext(analysis);

  const buildNotesSecondPassSupportInventory = (analysis = {}) =>
    buildNotesSecondPassSupportInventoryFromContext(analysis, { normalizeChainType });

  const buildNotesSecondPassPrompt = (sentence, framework = 'xbar', analysis = {}) =>
    buildNotesSecondPassPromptFromContext(sentence, framework, analysis, { normalizeChainType });

  const regenerateCommittedNoteBindings = async ({
    ai,
    model,
    framework,
    sentence,
    modelRoute,
    analysis,
    requestStartedAt
  }) => {
    if (!analysis || modelRoute !== 'pro') return null;
    const remainingBudgetMs = getRemainingRequestBudgetMs(requestStartedAt, modelRoute);
    if (remainingBudgetMs <= 4000) return null;

    const systemInstruction = buildNotesSecondPassSystemInstruction(framework);
    const contents = buildNotesSecondPassPrompt(sentence, framework, analysis);
    const generation = await withTimeout(
      (abortSignal) => generateStructuredContent({
        ai,
        model,
        contents,
        systemInstruction,
        temperature: NOTES_SECOND_PASS_TEMPERATURE,
        maxOutputTokens: NOTES_SECOND_PASS_MAX_OUTPUT_TOKENS,
        includeThoughts: false,
        abortSignal
      }),
      Math.min(Math.max(remainingBudgetMs - 500, 2500), 90000),
      `Note generation (${model})`
    );
    const generationMeta = summarizeGeneration(generation);
    const payload = parseModelJson(generationMeta.rawText);
    if (!Array.isArray(payload?.noteBindings) || payload.noteBindings.length === 0) {
      writeDebugModelPayload({
        stage: 'notes-second-pass-empty',
        model,
        sentence,
        rawText: generationMeta.rawText
      });
    }
    const regeneratedNoteBindings = Array.isArray(payload?.noteBindings) && payload.noteBindings.length > 0
      ? payload.noteBindings
      : Array.isArray(analysis.noteBindings)
        ? analysis.noteBindings
        : [];
    const candidateBundle = normalizeParseBundle(
      { analyses: [{ ...analysis, noteBindings: regeneratedNoteBindings }] },
      framework,
      sentence,
      modelRoute,
      true
    );
    const regeneratedAnalysis = candidateBundle.analyses?.[0] || null;
    if (!regeneratedAnalysis) return null;
    if (!Array.isArray(regeneratedAnalysis.noteBindings) || regeneratedAnalysis.noteBindings.length === 0) {
      writeDebugModelPayload({
        stage: 'notes-second-pass-normalized-empty',
        model,
        sentence,
        rawText: generationMeta.rawText
      });
    }
    return {
      ...regeneratedAnalysis,
      provenance: {
        ...(regeneratedAnalysis.provenance || {}),
        ...(generationMeta.providerReasoningSummary
          ? { notesSecondPassReasoningSummary: generationMeta.providerReasoningSummary }
          : {}),
        ...(generationMeta.providerReasoningRaw
          ? { notesSecondPassReasoningRaw: generationMeta.providerReasoningRaw }
          : {}),
        ...(generationMeta.promptTokenCount
          ? { notesSecondPassPromptTokenCount: generationMeta.promptTokenCount }
          : {}),
        ...(generationMeta.outputTokenCount
          ? { notesSecondPassOutputTokenCount: generationMeta.outputTokenCount }
          : {}),
        ...(generationMeta.totalTokenCount
          ? { notesSecondPassTotalTokenCount: generationMeta.totalTokenCount }
          : {}),
        ...(generationMeta.thoughtsTokenCount
          ? { notesSecondPassThoughtsTokenCount: generationMeta.thoughtsTokenCount }
          : {})
      }
    };
  };

  const regenerateCommittedNoteBindingsWithLocalModel = async ({
    framework,
    sentence,
    analysis,
    requestStartedAt,
    modelUsed
  }) => {
    if (!analysis) return null;
    const remainingBudgetMs = getRemainingRequestBudgetMs(requestStartedAt, 'pro');
    if (remainingBudgetMs <= 4000) return null;

    const systemInstruction = buildNotesSecondPassSystemInstruction(framework);
    const prompt = buildNotesSecondPassPrompt(sentence, framework, analysis);
    const rawText = await generateStructuredLocalContent({
      sentence,
      framework,
      systemInstruction,
      prompt,
      temperature: NOTES_SECOND_PASS_TEMPERATURE,
      maxOutputTokens: NOTES_SECOND_PASS_MAX_OUTPUT_TOKENS,
      timeoutMs: Math.min(Math.max(remainingBudgetMs - 500, 2500), LOCAL_MODEL_TIMEOUT_MS || 90000)
    });
    const payload = parseModelJson(rawText);
    if (!Array.isArray(payload?.noteBindings) || payload.noteBindings.length === 0) {
      writeDebugModelPayload({
        stage: 'local-notes-second-pass-empty',
        model: modelUsed,
        sentence,
        rawText
      });
    }
    const regeneratedNoteBindings = Array.isArray(payload?.noteBindings) && payload.noteBindings.length > 0
      ? payload.noteBindings
      : Array.isArray(analysis.noteBindings)
        ? analysis.noteBindings
        : [];
    const candidateBundle = normalizeParseBundle(
      { analyses: [{ ...analysis, noteBindings: regeneratedNoteBindings }] },
      framework,
      sentence,
      'pro',
      true
    );
    const regeneratedAnalysis = candidateBundle.analyses?.[0] || null;
    if (!regeneratedAnalysis) return null;
    if (!Array.isArray(regeneratedAnalysis.noteBindings) || regeneratedAnalysis.noteBindings.length === 0) {
      writeDebugModelPayload({
        stage: 'local-notes-second-pass-normalized-empty',
        model: modelUsed,
        sentence,
        rawText
      });
    }
    return regeneratedAnalysis;
  };

  return {
    parseModelJson,
    parseModelJsonDetailed,
    buildNotesSecondPassFrozenAnalysis,
    buildNotesSecondPassSupportInventory,
    buildNotesSecondPassPrompt,
    regenerateCommittedNoteBindings,
    regenerateCommittedNoteBindingsWithLocalModel
  };
};
