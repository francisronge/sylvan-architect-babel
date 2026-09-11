import { tokenizeSentenceSurfaceOrder } from './surfaceTokens.js';

export const buildDerivationStagesFirstContentsPrompt = (sentence, framework = 'xbar') =>
  `Sentence: ${JSON.stringify(sentence)}\nInput tokens, indexed from zero: ${JSON.stringify(tokenizeSentenceSurfaceOrder(sentence))}`;

export const buildParseContentsPrompt = (sentence, framework = 'xbar', modelRoute = 'gemini') =>
  buildDerivationStagesFirstContentsPrompt(sentence, framework);
