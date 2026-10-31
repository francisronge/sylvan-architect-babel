import { parseSentence, ParseServiceError } from './parseService.ts';
import { assertBundleDisplayable } from './analysisDisplay.ts';
import type { GenerationRecord, ParseBundle, ParseFailure, RawOutputArtifact } from '../types.ts';

export interface GenerationError {
  message: string;
  code?: string;
  failure?: ParseFailure;
  rawOutput?: RawOutputArtifact;
  generationRecord?: GenerationRecord;
  /** The input tokens the model was sent, when the request reached it. */
  inputTokens?: string[];
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
      ...(err instanceof ParseServiceError && err.generationRecord ? { generationRecord: err.generationRecord } : {}),
      ...(err instanceof ParseServiceError && err.inputTokens ? { inputTokens: err.inputTokens } : {})
    }
  };
};

export type GenerationAction =
  | { type: 'started' }
  | { type: 'accepted' }
  | { type: 'failed'; cause: unknown; request?: GenerationError['request'] }
  | { type: 'finished' }
  | { type: 'clear-failure' }
  | { type: 'dismiss-failure' }
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
    case 'clear-failure': return { ...state, error: null, needsKey: false };
    // The user closed the failure display; a missing key is still missing.
    case 'dismiss-failure': return { ...state, error: null };
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

/**
 * The request a submitted draft makes, or null for a blank draft. Outer
 * whitespace is not part of the sentence: the server echoes the sentence it
 * receives, and the workspace and Tree Bank keep this same trimmed sentence.
 */
export const submittedGenerationRequest = (
  draft: string,
  options: Omit<GenerationRequest, 'sentence'>
): GenerationRequest | null => {
  const sentence = draft.trim();
  return sentence ? { ...options, sentence } : null;
};

// App derives each analysis's display values outside its view boundaries. A
// response that cannot be displayed therefore fails its generation, keeping the
// raw output, record and word list for the failure panel.
const assertResponseDisplayable = (bundle: ParseBundle, sentence: string): void => {
  try {
    assertBundleDisplayable(bundle, sentence, 'Analysis');
  } catch (error) {
    throw new ParseServiceError({
      code: 'ANALYSIS_NOT_DISPLAYABLE',
      message: error instanceof Error ? error.message : String(error),
      rawOutput: bundle.rawModelOutput,
      generationRecord: bundle.generationRecord,
      inputTokens: bundle.inputTokens
    });
  }
};

// Own only the request lifecycle. The workspace retains the previous analysis
// until it accepts a complete, displayable response; failures retain their
// original evidence.
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
    assertResponseDisplayable(bundle, request.sentence);
    accept(bundle);
    dispatch({ type: 'accepted' });
  } catch (cause) {
    dispatch({ type: 'failed', cause, request: originalInput });
  } finally {
    dispatch({ type: 'finished' });
  }
};
