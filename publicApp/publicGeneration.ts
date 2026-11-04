import type { GenerationRequest } from '../services/generationState.ts';

/**
 * The request public Babel makes for every sentence: Minimalism only, with
 * no model or effort choice in the browser (Francis, 3 Nov 2026).
 *
 * The public model is GPT-6.1 Sol at high effort (Francis, 3 Nov 2026). The
 * parse route still takes the model from the request, and no API-key route
 * serves GPT-6.1 Sol yet, so until the public server route exists and
 * chooses the model itself (ROADMAP Program 3B, item 4) the server refuses
 * this request as not enabled. It is a constant, so the research model
 * catalog stays out of the public bundle.
 */
export const PUBLIC_GENERATION: Omit<GenerationRequest, 'sentence'> = Object.freeze({
  framework: 'minimalism',
  modelId: 'openai:gpt-6.1-sol',
  settings: Object.freeze({ 'reasoning.effort': 'high' })
});
