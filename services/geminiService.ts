import { ParseBundle } from '../types';

const parseErrorFromResponse = async (response: Response): Promise<string> => {
  try {
    const payload = await response.json();
    const code = String(payload?.error?.code || '').trim();
    const message = String(payload?.error?.message || '').trim();

    if (code === 'API_KEY_MISSING') return 'API_KEY_MISSING';
    if (code === 'API_KEY_INVALID') return 'API_KEY_INVALID';
    if (code === 'GEMINI_UNAVAILABLE') {
      return message || 'The canopy is noisy right now. Please plant your sentence again in a moment.';
    }
    if (code === 'BAD_MODEL_RESPONSE') {
      return 'The canopy is noisy right now. Please plant your sentence again in a moment.';
    }
    if (code === 'PARSE_FAILED') {
      return 'The canopy is noisy right now. Please plant your sentence again in a moment.';
    }

    if (message) return message;
    if (code) return code;
    return `Request failed with status ${response.status}.`;
  } catch {
    return `Request failed with status ${response.status}.`;
  }
};

export const parseSentence = async (
  sentence: string,
  framework: 'xbar' | 'minimalism' = 'xbar'
): Promise<ParseBundle> => {
  const response = await fetch('/api/parse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sentence, framework })
  });

  if (!response.ok) {
    throw new Error(await parseErrorFromResponse(response));
  }

  const data = (await response.json()) as ParseBundle;
  if (!data || !Array.isArray(data.analyses) || data.analyses.length === 0) {
    throw new Error('Linguistic result malformed. Please try again.');
  }

  return data;
};
