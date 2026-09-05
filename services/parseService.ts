import type {
  ParseBundle,
  GenerationRecord,
  ParseFailure,
  RawOutputArtifact
} from '../types';

export class ParseServiceError extends Error {
  code: string;
  failure?: ParseFailure;
  rawOutput?: RawOutputArtifact;
  generationRecord?: GenerationRecord;

  constructor({
    code,
    message,
    failure,
    rawOutput,
    generationRecord
  }: {
    code: string;
    message: string;
    failure?: ParseFailure;
    rawOutput?: RawOutputArtifact;
    generationRecord?: GenerationRecord;
  }) {
    super(message);
    this.name = 'ParseServiceError';
    this.code = code;
    this.failure = failure;
    this.rawOutput = rawOutput;
    this.generationRecord = generationRecord;
  }
}

const parseErrorFromResponse = async (response: Response): Promise<ParseServiceError> => {
  try {
    const payload = await response.json();
    const code = String(payload?.error?.code || '').trim();
    const message = String(payload?.error?.message || '').trim();
    return new ParseServiceError({
      code: code || 'HTTP_ERROR',
      message: message || code || `Request failed with status ${response.status}.`,
      failure: payload?.error?.failure,
      rawOutput: payload?.error?.rawOutput,
      generationRecord: payload?.error?.generationRecord
    });
  } catch {
    return new ParseServiceError({
      code: 'HTTP_ERROR',
      message: `Request failed with status ${response.status}.`
    });
  }
};

export const parseSentence = async (
  sentence: string,
  framework: 'xbar' | 'minimalism' = 'xbar',
  modelId: string,
  settings: Record<string, string>
): Promise<ParseBundle> => {
  const response = await fetch('/api/parse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sentence, framework, modelId, settings })
  });

  if (!response.ok) {
    throw await parseErrorFromResponse(response);
  }

  const data = (await response.json()) as ParseBundle;
  if (!data || !Array.isArray(data.analyses) || data.analyses.length === 0) {
    throw new Error('Linguistic result malformed. Please try again.');
  }

  return data;
};
