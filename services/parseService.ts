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
  /** The input tokens the model was sent, when the request reached it. */
  inputTokens?: string[];

  constructor({
    code,
    message,
    failure,
    rawOutput,
    generationRecord,
    inputTokens
  }: {
    code: string;
    message: string;
    failure?: ParseFailure;
    rawOutput?: RawOutputArtifact;
    generationRecord?: GenerationRecord;
    inputTokens?: string[];
  }) {
    super(message);
    this.name = 'ParseServiceError';
    this.code = code;
    this.failure = failure;
    this.rawOutput = rawOutput;
    this.generationRecord = generationRecord;
    this.inputTokens = inputTokens;
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
      generationRecord: payload?.error?.generationRecord,
      inputTokens: Array.isArray(payload?.error?.inputTokens)
        && payload.error.inputTokens.every((token: unknown) => typeof token === 'string')
        ? payload.error.inputTokens : undefined
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
  framework: 'xbar' | 'minimalism' = 'minimalism',
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

/** A background parse the browser is checking on: enough to resume it after a reload. */
export interface PendingParse {
  ticket: string;
  sentence: string;
  /** When the parse started, in this browser's clock. */
  startedAt: number;
}

export const PARSE_CHECK_INTERVAL_MS = 4000;
// The server times a ticket out at 20 minutes; checking a little longer lets its answer arrive first.
export const PARSE_CHECK_GIVE_UP_MS = 22 * 60 * 1000;
// A check that could not look (Babel's own CHECK_UNAVAILABLE, a rate limit, or
// a platform error page without Babel's body) is tried again; any other
// failure is the parse's own and ends it.
const RETRYABLE_CHECK_CODES = new Set(['CHECK_UNAVAILABLE', 'RATE_LIMITED', 'HTTP_ERROR']);

const postParse = (body: unknown) => fetch('/api/parse', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

const finishedBundle = (data: unknown): ParseBundle => {
  const bundle = data as ParseBundle;
  if (!bundle || !Array.isArray(bundle.analyses) || bundle.analyses.length === 0) {
    throw new Error('Linguistic result malformed. Please try again.');
  }
  return bundle;
};

/** Waits between checks; a page coming back into view (a phone waking) checks at once. */
const waitForNextCheck = (ms: number) => new Promise<void>((resolve) => {
  const done = () => {
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
    resolve();
  };
  const onVisible = () => { if (document.visibilityState === 'visible') done(); };
  const timer = window.setTimeout(done, ms);
  document.addEventListener('visibilitychange', onVisible);
});

export interface BackgroundParseOptions {
  /** Called once the server has started the parse, with what resuming it needs. */
  onTicket?: (pending: PendingParse) => void;
  /** Check on this parse instead of starting one. */
  resume?: PendingParse;
  wait?: (ms: number) => Promise<void>;
}

/**
 * Starts a parse that the model writes in the background, then checks back
 * until it is finished. No request stays open while the model writes, so a
 * slow parse never meets a host's time limit, and a phone that sleeps or a
 * page that reloads loses nothing: OpenAI keeps writing, and the next check
 * picks the result up.
 */
export const parseSentenceInBackground = async (
  sentence: string,
  framework: 'xbar' | 'minimalism',
  modelId: string,
  settings: Record<string, string>,
  { onTicket, resume, wait = waitForNextCheck }: BackgroundParseOptions = {}
): Promise<ParseBundle> => {
  let pending = resume;
  if (!pending) {
    const response = await postParse({ sentence, framework, modelId, settings, start: true });
    if (!response.ok) throw await parseErrorFromResponse(response);
    const started = await response.json();
    if (started?.status !== 'pending') return finishedBundle(started);
    pending = { ticket: String(started.ticket), sentence, startedAt: Date.now() };
    onTicket?.(pending);
  }
  for (;;) {
    if (Date.now() - pending.startedAt > PARSE_CHECK_GIVE_UP_MS) {
      throw new ParseServiceError({ code: 'PROVIDER_TIMEOUT', message: 'The analysis took too long to arrive. Please try again.' });
    }
    await wait(PARSE_CHECK_INTERVAL_MS);
    let response: Response;
    try {
      response = await postParse({ ticket: pending.ticket });
    } catch {
      continue; // Offline or asleep: the model keeps writing, so check again.
    }
    if (!response.ok) {
      const error = await parseErrorFromResponse(response);
      if ((response.status === 429 || response.status >= 500) && RETRYABLE_CHECK_CODES.has(error.code)) continue;
      throw error;
    }
    let checked: unknown;
    try {
      checked = await response.json();
    } catch {
      continue; // The connection dropped mid-reply: the parse is intact, so check again.
    }
    if ((checked as { status?: string } | null)?.status === 'pending') continue;
    return finishedBundle(checked);
  }
};
