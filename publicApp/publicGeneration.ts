import type { GenerationRequest } from '../services/generationState.ts';

/**
 * The request public Babel makes for every sentence: Minimalism only, with
 * no model or effort choice in the browser (Francis, 3 Nov 2026).
 *
 * The public model is GPT-6.1 Sol at high effort (Francis, 3 Nov 2026),
 * which the parse route sends through Babel's OpenAI API key. A deployed
 * server sends this request whatever the browser names
 * (PUBLIC_PARSE_REQUEST in the server's parseApi.js; a test keeps the two
 * equal), so it also works against a local runtime. It is a constant, so the
 * research model catalog stays out of the public bundle.
 */
export const PUBLIC_GENERATION: Omit<GenerationRequest, 'sentence'> = Object.freeze({
  framework: 'minimalism',
  modelId: 'openai:gpt-6.1-sol',
  settings: Object.freeze({ 'reasoning.effort': 'high' })
});
