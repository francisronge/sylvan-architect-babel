import { parseSentence, ParseServiceError } from './parseService.ts';
import type { GenerationRecord, ParseBundle, ParseFailure, RawOutputArtifact } from '../types.ts';

export interface GenerationError {
  message: string;
  code?: string;
  failure?: ParseFailure;
  rawOutput?: RawOutputArtifact;
  generationRecord?: GenerationRecord;
  request?: Pick<GenerationRequest, 'sentence' | 'framework'>;
}

export interface GenerationState {
  loading: boolean;
  error: GenerationError | null;
  needsKey: boolean;
}

export const initialGenerationState: GenerationState = {
  loading: false,
  error: null,
  needsKey: false
};

const KEY_ERROR_CODES = new Set(['API_KEY_EXPIRED', 'API_KEY_MISSING', 'API_KEY_INVALID']);

export const resolveGenerationError = (err: unknown): Pick<GenerationState, 'needsKey' | 'error'> => {
  const message = err instanceof Error ? err.message : String(err || '');
  const code = err instanceof ParseServiceError ? err.code : '';
  const needsKey = KEY_ERROR_CODES.has(code || message);
  return {
    needsKey,
    error: {
      message: needsKey
        ? 'The selected provider API key is missing or invalid on the server.'
        : message || 'Derivation interrupted.',
      ...(code || needsKey ? { code: code || message } : {}),
      ...(err instanceof ParseServiceError && err.failure ? { failure: err.failure } : {}),
      ...(err instanceof ParseServiceError && err.rawOutput ? { rawOutput: err.rawOutput } : {}),
      ...(err instanceof ParseServiceError && err.generationRecord ? { generationRecord: err.generationRecord } : {})
    }
  };
};

export type GenerationAction =
  | { type: 'started' }
  | { type: 'accepted' }
  | { type: 'failed'; cause: unknown; request?: GenerationError['request'] }
  | { type: 'finished' }
  | { type: 'clear-error' }
  | { type: 'clear-failure' }
  | { type: 'reset' }
  | { type: 'report-error'; error: GenerationError };

export const generationReducer = (state: GenerationState, action: GenerationAction): GenerationState => {
  switch (action.type) {
    case 'started': return { ...state, loading: true, error: null };
    case 'accepted': return { ...state, needsKey: false };
    case 'failed': {
      const failure = resolveGenerationError(action.cause);
      return { ...state, ...failure, error: failure.error
        ? { ...failure.error, ...(action.request ? { request: action.request } : {}) }
        : null };
    }
    case 'finished': return { ...state, loading: false };
    case 'clear-error': return { ...state, error: null };
    case 'clear-failure': return { ...state, error: null, needsKey: false };
    case 'reset': return initialGenerationState;
    case 'report-error': return { ...state, error: action.error };
  }
};

export interface GenerationRequest {
  sentence: string;
  framework: 'xbar' | 'minimalism';
  modelId: string;
  settings: Record<string, string>;
}

// Own only the request lifecycle. The workspace retains the previous analysis
// until it accepts a complete response; failures retain their original evidence.
export const runGeneration = async (
  request: GenerationRequest,
  dispatch: (action: GenerationAction) => void,
  accept: (bundle: ParseBundle) => void,
  parse: typeof parseSentence = parseSentence
): Promise<void> => {
  const originalInput = { sentence: request.sentence, framework: request.framework };
  dispatch({ type: 'started' });
  try {
    const bundle = await parse(request.sentence, request.framework, request.modelId, request.settings);
    accept(bundle);
    dispatch({ type: 'accepted' });
  } catch (cause) {
    dispatch({ type: 'failed', cause, request: originalInput });
  } finally {
    dispatch({ type: 'finished' });
  }
};
