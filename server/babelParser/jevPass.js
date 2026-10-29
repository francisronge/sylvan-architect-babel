import { neutralJevClaims } from '../../replay/jevClaims.ts';
import { jevRecordIssues } from '../../replay/jevRecord.ts';
import { JEV_CONFIDENCE_THRESHOLD } from '../../replay/relations/jev.ts';
import { DEFAULT_JEV_MODEL, JEV_PROMPT_VERSION, askJevClaim, jevRecordFrom, requestJev } from './jev.js';

/**
 * The server's Jev pass: after a response is complete and valid, each analysis's
 * neutral claims are asked of TypeSafe's Jev (`jev.js`) and the checked answers are
 * attached to the analysis as `jevReadings`. Replay applies them; it never calls Jev.
 *
 * The pass is bounded and never fails the parse. Claims are asked in parallel,
 * `JEV_CONCURRENCY` at a time, inside one wall-clock budget; when it is spent,
 * requests in flight are abandoned and claims not yet asked are not sent. A claim
 * whose request fails, times out or is answered outside its options gets no reading.
 * Without a key nothing is sent. Every claim's outcome is recorded in the
 * response's `generationRecord.jev`; the key is never recorded or logged.
 */

/** Measured on the live benchmark (jev-1.14.0, jev-ts-2, 1,102 requests): the slowest claim
 * took 0.81 s and the slowest analysis 4.1 s with its 18 claims asked one after another.
 * Eight seconds covers that worst analysis asked sequentially twice over, and an
 * ambiguous response's several analyses at `JEV_CONCURRENCY`, while adding at most a
 * few seconds to a generation that takes tens of seconds or minutes. */
export const JEV_TIME_BUDGET_MS = 8000;
/** Claims asked at once. The benchmark ran two at a time without a 429; TypeSafe's rate
 * limits are per organization and unpublished, and a 429 is not retried. */
export const JEV_CONCURRENCY = 4;
/** Below this much remaining request time the pass is skipped rather than started. */
export const JEV_MIN_BUDGET_MS = 1000;

/** The server's key: `TYPESAFE_API_KEY`, never exposed to the browser. */
export const readJevApiKey = (env = process.env) => String(env.TYPESAFE_API_KEY || '').trim();

const ANSWERED = new Set(['proposal', 'no-drawing', 'no-reading']);
const SETTLED = new Set([...ANSWERED, 'no-family-can-read', 'withheld', 'out-of-set']);
const MAX_ERRORS = 3;
const MAX_ERROR_LENGTH = 200;

const claimOutcome = (job, stopReason) => {
  const outcome = { claim: job.claim.id };
  if (!job.asked) return { ...outcome, status: stopReason === 'cancelled' ? 'cancelled' : 'not-asked' };
  const { result, sent = [] } = job.asked;
  const failed = sent.find(entry => entry.status !== 'completed');
  if (result.status === 'transport-failed' && failed?.stopped) return { ...outcome, status: failed.stopped };
  return {
    ...outcome,
    status: result.status,
    ...(failed ? { httpStatus: failed.httpStatus ?? null, errors: [failed.error] } : {}),
    ...(result.errors?.length ? { errors: result.errors.slice(0, MAX_ERRORS).map(error => String(error).slice(0, MAX_ERROR_LENGTH)) } : {})
  };
};

/**
 * Asks Jev about every neutral claim of `analyses` and returns, for each analysis, its Jev
 * record (or `undefined` when no claim was answered) and the pass's own record.
 * `fetchImpl` replaces the network in tests; `abortSignal` is the parse request's.
 */
export const runJevPass = async ({
  analyses, apiKey, model = DEFAULT_JEV_MODEL, budgetMs = JEV_TIME_BUDGET_MS,
  concurrency = JEV_CONCURRENCY, fetchImpl, abortSignal
}) => {
  const pass = { service: 'typesafe', requestedModel: model, promptVersion: JEV_PROMPT_VERSION,
    thresholdAtRun: JEV_CONFIDENCE_THRESHOLD, budgetMs: Math.max(0, Math.floor(budgetMs)) };
  const none = analyses.map(() => undefined);
  if (!apiKey) return { readings: none, pass: { ...pass, status: 'not-configured', reason: 'TYPESAFE_API_KEY is not set.' } };
  if (!(budgetMs >= JEV_MIN_BUDGET_MS)) return { readings: none, pass: { ...pass, status: 'skipped', reason: 'The request budget has no time left for Jev.' } };
  if (abortSignal?.aborted) return { readings: none, pass: { ...pass, status: 'skipped', reason: 'The parse request was cancelled.' } };

  const startedAt = new Date();
  const jobs = [];
  const unreadable = [];
  analyses.forEach((analysis, analysisIndex) => {
    try {
      for (const claim of neutralJevClaims(analysis.derivationStages ?? [])) jobs.push({ analysisIndex, claim });
    } catch {
      unreadable.push(analysisIndex);
    }
  });

  const controller = new AbortController();
  let stopReason;
  const stop = reason => { if (!stopReason) { stopReason = reason; controller.abort(); } };
  const timer = setTimeout(() => stop('timed-out'), pass.budgetMs);
  const onCancel = () => stop('cancelled');
  abortSignal?.addEventListener('abort', onCancel, { once: true });
  // Resolves when the pass stops, so a transport that ignores the signal cannot hold it open.
  const stopped = new Promise(resolve => controller.signal.addEventListener('abort', resolve, { once: true }));
  const models = new Set();
  const usage = { inputTokens: 0, outputTokens: 0 };

  const send = async (_name, body) => {
    if (controller.signal.aborted) return { status: 'failed', httpStatus: null, error: 'not sent', stopped: stopReason };
    const sent = await Promise.race([
      requestJev({ body, apiKey, signal: controller.signal, ...(fetchImpl ? { fetchImpl } : {}) }),
      stopped.then(() => ({ status: 'failed', httpStatus: null, error: 'stopped' }))
    ]);
    if (controller.signal.aborted && sent.status !== 'completed') return { ...sent, stopped: stopReason };
    if (typeof sent.json?.model === 'string') models.add(sent.json.model);
    usage.inputTokens += Number(sent.json?.usage?.input_tokens) || 0;
    usage.outputTokens += Number(sent.json?.usage?.output_tokens) || 0;
    return sent;
  };

  let next = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (next < jobs.length && !controller.signal.aborted) {
        const job = jobs[next++];
        try {
          job.asked = await askJevClaim({ relation: job.claim.relation, model, send });
        } catch {
          job.asked = { result: { status: 'local-failure' }, sent: [] };
        }
      }
    }));
  } finally {
    clearTimeout(timer);
    abortSignal?.removeEventListener('abort', onCancel);
  }

  const provenance = { service: 'typesafe', requestedModel: model, models: [...models], promptVersion: JEV_PROMPT_VERSION,
    at: startedAt.toISOString(), thresholdAtRun: JEV_CONFIDENCE_THRESHOLD };
  let invalid = false;
  const readings = analyses.map((_analysis, analysisIndex) => {
    const asked = jobs.filter(job => job.analysisIndex === analysisIndex && job.asked);
    const record = jevRecordFrom({ claims: asked.map(job => job.claim), results: asked.map(job => job.asked.result), provenance });
    if (!record.mappings.length) return undefined;
    // Answers have already passed the closed sets; a record that fails its shape is a Babel fault, not Jev's.
    if (jevRecordIssues(record).length) { invalid = true; return undefined; }
    return record;
  });
  const outcomes = jobs.map(job => ({ analysisIndex: job.analysisIndex, outcome: claimOutcome(job, stopReason) }));
  const settled = outcomes.every(({ outcome }) => SETTLED.has(outcome.status)) && !unreadable.length && !invalid;
  return {
    readings,
    pass: {
      ...pass,
      status: settled ? 'completed' : 'partial',
      ...(unreadable.length ? { reason: `Babel could not read the claims of analysis ${unreadable.map(index => index + 1).join(', ')}.` }
        : invalid ? { reason: 'A Jev record failed its shape check and was not attached.' } : {}),
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      models: [...models],
      usage,
      analyses: analyses.map((_analysis, analysisIndex) => {
        const own = outcomes.filter(entry => entry.analysisIndex === analysisIndex).map(entry => entry.outcome);
        return { claims: own.length, outcomes: own };
      })
    }
  };
};

/** The bundle's analyses with their Jev readings, and the pass record for its generation record.
 * Any fault in the pass leaves the analyses as they were. */
export const attachJevReadings = async (analyses, options) => {
  let result;
  try {
    result = await runJevPass({ analyses, ...options });
  } catch {
    return { analyses, pass: { service: 'typesafe', requestedModel: options.model ?? DEFAULT_JEV_MODEL,
      promptVersion: JEV_PROMPT_VERSION, thresholdAtRun: JEV_CONFIDENCE_THRESHOLD,
      budgetMs: Math.max(0, Math.floor(options.budgetMs ?? JEV_TIME_BUDGET_MS)), status: 'failed', reason: 'The Jev pass stopped on a Babel fault.' } };
  }
  const { readings, pass } = result;
  return {
    analyses: analyses.map((analysis, index) => (readings[index] ? { ...analysis, jevReadings: readings[index] } : analysis)),
    pass
  };
};
