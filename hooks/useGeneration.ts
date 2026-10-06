import { useCallback, useReducer } from 'react';
import type { ParseBundle } from '../types.ts';
import {
  generationReducer,
  initialGenerationState,
  runGeneration,
  type GenerationError,
  type GenerationRequest
} from '../services/generationState.ts';

export const useGeneration = () => {
  const [state, dispatch] = useReducer(generationReducer, initialGenerationState);
  const generate = useCallback((request: GenerationRequest, accept: (bundle: ParseBundle) => void) =>
    runGeneration(request, dispatch, accept), []);
  const clearError = useCallback(() => dispatch({ type: 'clear-error' }), []);
  const clearFailure = useCallback(() => dispatch({ type: 'clear-failure' }), []);
  const resetGeneration = useCallback(() => dispatch({ type: 'reset' }), []);
  const reportError = useCallback((error: GenerationError) => dispatch({ type: 'report-error', error }), []);
  return { ...state, generate, clearError, clearFailure, resetGeneration, reportError };
};
