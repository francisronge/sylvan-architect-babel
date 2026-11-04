import { useCallback, useReducer } from 'react';
import type { ParseBundle } from '../types.ts';
import type { parseSentence } from '../services/parseService.ts';
import {
  generationReducer,
  initialGenerationState,
  runGeneration,
  type GenerationError,
  type GenerationRequest
} from '../services/generationState.ts';

export const useGeneration = () => {
  const [state, dispatch] = useReducer(generationReducer, initialGenerationState);
  // `parse` replaces the one-request parse, as public Babel's background parse does.
  const generate = useCallback((request: GenerationRequest, accept: (bundle: ParseBundle) => void, parse?: typeof parseSentence) =>
    runGeneration(request, dispatch, accept, parse), []);
  const clearFailure = useCallback(() => dispatch({ type: 'clear-failure' }), []);
  const dismissFailure = useCallback(() => dispatch({ type: 'dismiss-failure' }), []);
  const resetGeneration = useCallback(() => dispatch({ type: 'reset' }), []);
  const reportError = useCallback((error: GenerationError) => dispatch({ type: 'report-error', error }), []);
  return { ...state, generate, clearFailure, dismissFailure, resetGeneration, reportError };
};
