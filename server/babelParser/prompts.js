import { resolveSavedInputTokens, tokenizeSentenceSurfaceOrder } from './surfaceTokens.js';

export const buildDerivationStagesFirstContentsPrompt = (sentence, framework = 'xbar', inputTokens = tokenizeSentenceSurfaceOrder(sentence)) =>
  `Sentence: ${JSON.stringify(sentence)}\nInput tokens, indexed from zero: ${JSON.stringify(resolveSavedInputTokens(sentence, inputTokens))}`;

export const buildParseContentsPrompt = (sentence, framework = 'xbar', modelRoute = 'gemini', inputTokens) =>
  buildDerivationStagesFirstContentsPrompt(sentence, framework, inputTokens);
