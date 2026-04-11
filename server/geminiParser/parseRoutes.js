import { GoogleGenAI } from '@google/genai';
import { attachAggregateParseTokenCounts } from './provenance.js';
import { buildSystemInstruction } from './systemInstruction.js';
import { buildParseContentsPrompt } from './prompts.js';
import {
  LOCAL_MODEL_COMMAND,
  LOCAL_MODEL_NAME,
  LOCAL_MODEL_URL,
  PRIMARY_MODEL,
  PRO_MODEL,
  getRemainingRequestBudgetMs,
  localRouteUnavailableMessage,
  resolveModelTimeoutMs,
  resolveRequestTimeoutMs,
  resolveRouteMaxOutputTokens,
  resolveRouteTemperature,
  routeUnavailableMessage
} from './routeConfig.js';
import {
  generateStructuredContent,
  generateStructuredLocalContent,
  getErrorMeta,
  isNetworkTransportError,
  isTruncatedGeneration,
  resolveLocalMaxOutputTokens,
  summarizeErrorForLog,
  summarizeGeneration,
  withTimeout,
  writeDebugModelPayload
} from './modelRuntime.js';

export const createParseRoutes = ({
  ParseApiError,
  normalizeParseBundle,
  validateFinalProNoteBindings,
  parseModelJson,
  regenerateCommittedNoteBindings,
  regenerateCommittedNoteBindingsWithLocalModel
}) => {
  const parseSentenceWithLocalModel = async (sentence, framework = 'xbar') => {
    const promptRoute = 'pro';
    const requestStartedAt = Date.now();
    const systemInstruction = buildSystemInstruction(framework, promptRoute);
    const prompt = buildParseContentsPrompt(
      sentence,
      framework,
      promptRoute
    );
    const temperature = resolveRouteTemperature(promptRoute);
    const maxOutputTokens = resolveLocalMaxOutputTokens(resolveRouteMaxOutputTokens(promptRoute, sentence));
    const modelUsed = `local:${LOCAL_MODEL_NAME}`;

    try {
      const rawText = await generateStructuredLocalContent({
        sentence,
        framework,
        systemInstruction,
        prompt,
        temperature,
        maxOutputTokens,
        timeoutMs: undefined
      });

      if (!rawText) {
        throw new ParseApiError('BAD_MODEL_RESPONSE', 'Local model returned no text.', 502, {
          stage: 'local-transport',
          model: modelUsed
        });
      }

      const payload = parseModelJson(rawText);
      let normalized = normalizeParseBundle(payload, framework, sentence, promptRoute, true);
      if (normalized?.analyses?.[0]) {
        normalized = {
          ...normalized,
          analyses: [
            {
              ...normalized.analyses[0],
              provenance: attachAggregateParseTokenCounts({
                ...(normalized.analyses[0].provenance || {}),
                modelRoute: 'local'
              })
            }
          ]
        };
      }

      if (normalized?.analyses?.[0]) {
        try {
          const priorProvenance = normalized.analyses[0].provenance || {};
          const regeneratedAnalysis = await regenerateCommittedNoteBindingsWithLocalModel({
            framework,
            sentence,
            analysis: normalized.analyses[0],
            requestStartedAt,
            modelUsed
          });
          if (regeneratedAnalysis) {
            normalized = {
              ...normalized,
              analyses: [
                {
                  ...regeneratedAnalysis,
                  provenance: attachAggregateParseTokenCounts({
                    ...priorProvenance,
                    ...(regeneratedAnalysis.provenance || {}),
                    modelRoute: 'local',
                    notesSecondPass: true
                  })
                }
              ]
            };
          }
        } catch (error) {
          const meta = summarizeErrorForLog(error);
          console.warn(`[local] second-pass note generation failed on ${modelUsed}: ${meta.message ?? 'no message'}`);
        }
        normalized = validateFinalProNoteBindings(normalized);
      }

      return {
        ...normalized,
        requestedModelRoute: 'local',
        modelUsed
      };
    } catch (error) {
      if (error instanceof ParseApiError) {
        throw error;
      }
      const { msg, haystack, statusCode } = getErrorMeta(error);
      if (
        isNetworkTransportError(error) ||
        haystack.includes('econnrefused') ||
        haystack.includes('connection refused') ||
        haystack.includes('failed to fetch') ||
        statusCode === 404 ||
        statusCode === 503
      ) {
        throw new ParseApiError('LOCAL_MODEL_UNAVAILABLE', localRouteUnavailableMessage(), 503, {
          model: modelUsed,
          endpoint: LOCAL_MODEL_COMMAND ? 'command' : LOCAL_MODEL_URL,
          transportMessage: msg || null
        });
      }
      throw new ParseApiError('PARSE_FAILED', msg || 'Local model parsing failed.', 500);
    }
  };

  const parseSentenceWithGemini = async (sentence, framework = 'xbar', modelRoute = 'flash-lite') => {
    const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
      throw new ParseApiError('API_KEY_MISSING', 'Gemini API key is not configured on the server.', 500);
    }

    const ai = new GoogleGenAI({ apiKey });
    const normalizedModelRoute = modelRoute === 'pro' ? 'pro' : 'flash-lite';
    const systemInstruction = buildSystemInstruction(framework, normalizedModelRoute);
    const fullContents = buildParseContentsPrompt(
      sentence,
      framework,
      normalizedModelRoute
    );
    const routeTemperature = resolveRouteTemperature(normalizedModelRoute);
    const routeMaxOutputTokens = resolveRouteMaxOutputTokens(normalizedModelRoute, sentence);
    const selectedModel = normalizedModelRoute === 'pro' ? PRO_MODEL : PRIMARY_MODEL;
    const requestStartedAt = Date.now();

    try {
      const remainingBudgetMs = getRemainingRequestBudgetMs(requestStartedAt, normalizedModelRoute);
      if (remainingBudgetMs <= 1200) {
        throw new ParseApiError(
          'GEMINI_UNAVAILABLE',
          routeUnavailableMessage(normalizedModelRoute),
          503
        );
      }

      const generation = await withTimeout(
        (abortSignal) => generateStructuredContent({
          ai,
          model: selectedModel,
          contents: fullContents,
          systemInstruction,
          temperature: routeTemperature,
          maxOutputTokens: routeMaxOutputTokens,
          includeThoughts: normalizedModelRoute === 'pro',
          abortSignal
        }),
        resolveRequestTimeoutMs({
          baseTimeoutMs: resolveModelTimeoutMs(selectedModel, normalizedModelRoute),
          remainingBudgetMs
        }),
        `Model generation (${selectedModel})`
      );

      const generationMeta = summarizeGeneration(generation);
      const truncatedGeneration = isTruncatedGeneration(generation);

      let payload;
      try {
        payload = parseModelJson(generationMeta.rawText);
      } catch (error) {
        if (truncatedGeneration) {
          throw new ParseApiError('BAD_MODEL_RESPONSE', 'Model output was truncated before JSON completion.', 502);
        }
        if (error instanceof ParseApiError && error.code === 'BAD_MODEL_RESPONSE') {
          const debugPayloadPath = writeDebugModelPayload({
            stage: 'json-parse',
            model: selectedModel,
            sentence,
            rawText: generationMeta.rawText
          });
          throw new ParseApiError(
            error.code,
            error.message,
            422,
            {
              stage: 'json-parse',
              model: selectedModel,
              finishReason: generationMeta.finishReason || null,
              textLength: generationMeta.textLength,
              preview: generationMeta.preview || '',
              debugPayloadPath
            }
          );
        }
        throw error;
      }

      let normalized;
      try {
        normalized = normalizeParseBundle(payload, framework, sentence, normalizedModelRoute, true);
        if (normalized?.analyses?.[0]) {
          normalized = {
            ...normalized,
            analyses: [
              {
                ...normalized.analyses[0],
                provenance: attachAggregateParseTokenCounts({
                  ...(normalized.analyses[0].provenance || {}),
                  ...(generationMeta.providerReasoningSummary
                    ? { providerReasoningSummary: generationMeta.providerReasoningSummary }
                    : {}),
                  ...(generationMeta.providerReasoningRaw
                    ? { providerReasoningRaw: generationMeta.providerReasoningRaw }
                    : {}),
                  ...(generationMeta.promptTokenCount
                    ? { primaryPromptTokenCount: generationMeta.promptTokenCount }
                    : {}),
                  ...(generationMeta.outputTokenCount
                    ? { primaryOutputTokenCount: generationMeta.outputTokenCount }
                    : {}),
                  ...(generationMeta.totalTokenCount
                    ? { primaryTotalTokenCount: generationMeta.totalTokenCount }
                    : {}),
                  ...(generationMeta.thoughtsTokenCount
                    ? { providerThoughtsTokenCount: generationMeta.thoughtsTokenCount }
                    : {})
                })
              }
            ]
          };
        }
      } catch (error) {
        if (error instanceof ParseApiError && error.code === 'BAD_MODEL_RESPONSE') {
          const debugPayloadPath = writeDebugModelPayload({
            stage: 'normalization',
            model: selectedModel,
            sentence,
            rawText: generationMeta.rawText
          });
          let payloadPreview = '<unserializable>';
          try {
            payloadPreview = JSON.stringify(payload).slice(0, 320);
          } catch {
            // keep fallback preview
          }
          throw new ParseApiError(
            error.code,
            error.message,
            422,
            {
              stage: 'normalization',
              model: selectedModel,
              finishReason: generationMeta.finishReason || null,
              textLength: generationMeta.textLength,
              preview: generationMeta.preview || '',
              payloadPreview,
              debugPayloadPath
            }
          );
        }
        throw error;
      }

      if (normalizedModelRoute === 'pro' && normalized?.analyses?.[0]) {
        try {
          const priorProvenance = normalized.analyses[0].provenance || {};
          const regeneratedAnalysis = await regenerateCommittedNoteBindings({
            ai,
            model: selectedModel,
            framework,
            sentence,
            modelRoute: normalizedModelRoute,
            analysis: normalized.analyses[0],
            requestStartedAt
          });
          if (regeneratedAnalysis) {
            normalized = {
              ...normalized,
              analyses: [
                {
                  ...regeneratedAnalysis,
                  provenance: attachAggregateParseTokenCounts({
                    ...priorProvenance,
                    ...(regeneratedAnalysis.provenance || {}),
                    notesSecondPass: true
                  })
                }
              ]
            };
          }
        } catch (error) {
          const meta = summarizeErrorForLog(error);
          console.warn(
            `[gemini] second-pass note generation failed on ${selectedModel}: ${meta.message ?? 'no message'}`
          );
        }
        normalized = validateFinalProNoteBindings(normalized);
      }

      return {
        ...normalized,
        requestedModelRoute: normalizedModelRoute,
        modelUsed: selectedModel
      };
    } catch (error) {
      if (error instanceof ParseApiError) {
        throw error;
      }

      const { msg, haystack, statusCode } = getErrorMeta(error);

      if (
        haystack.includes('api key expired') ||
        haystack.includes('api_key_expired') ||
        haystack.includes('invalid api key') ||
        haystack.includes('api_key_invalid') ||
        haystack.includes('unauthenticated') ||
        haystack.includes('permission_denied') ||
        statusCode === 401 ||
        statusCode === 403
      ) {
        throw new ParseApiError('API_KEY_INVALID', 'Server API key is invalid or expired.', 500);
      }

      if (
        statusCode === 503 ||
        haystack.includes('service unavailable') ||
        haystack.includes('backend error')
      ) {
        throw new ParseApiError(
          'GEMINI_UNAVAILABLE',
          routeUnavailableMessage(normalizedModelRoute),
          503
        );
      }

      if (isNetworkTransportError(error)) {
        throw new ParseApiError(
          'GEMINI_UNAVAILABLE',
          routeUnavailableMessage(normalizedModelRoute),
          503
        );
      }

      if (haystack.includes('resource_exhausted') || haystack.includes('quota') || statusCode === 429) {
        throw new ParseApiError('GEMINI_QUOTA', 'Rate limit or quota reached for this server key.', 429);
      }

      if (
        statusCode === 404 ||
        (haystack.includes('model') && (
          haystack.includes('not found') ||
          haystack.includes('not available') ||
          haystack.includes('unsupported')
        ))
      ) {
        throw new ParseApiError('MODEL_UNAVAILABLE', 'Requested model is unavailable for this project/key.', 503);
      }

      if (haystack.includes('invalid_argument') || statusCode === 400) {
        throw new ParseApiError('INVALID_REQUEST', 'Request was rejected by Gemini (invalid argument).', 400);
      }

      throw new ParseApiError('PARSE_FAILED', msg || 'Syntactic parsing failed.', 500);
    }
  };

  return {
    parseSentenceWithLocalModel,
    parseSentenceWithGemini
  };
};
