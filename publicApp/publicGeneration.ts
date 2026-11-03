import type { GenerationRequest } from '../services/generationState.ts';

/**
 * The request public Babel makes for every sentence: Minimalism only, with
 * no model or effort choice in the browser (Francis, 3 Nov 2026).
 *
 * The parse route still requires a model name. Until the public server route
 * chooses the model itself and ignores the browser's choice (ROADMAP
 * Program 3B, item 4), public Babel names one enabled route here. It is a
 * constant, so the research model catalog stays out of the public bundle.
 */
export const PUBLIC_GENERATION: Omit<GenerationRequest, 'sentence'> = Object.freeze({
  framework: 'minimalism',
  modelId: 'openai:gpt-6-sol',
  settings: Object.freeze({ 'reasoning.effort': 'high' })
});
