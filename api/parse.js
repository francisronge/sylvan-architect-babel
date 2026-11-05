import { describeArchivedFailure, failureEndsParse, formatApiError, parseFromRequest, parseRequestKind, readPublicRequestOnly, refundsFailedParse, validateParseRequest } from '../server/parseApi.js';
import { createMemoryCounterStore, createParseAllowance, readCounterStore, readParseAllowanceLimits } from '../server/parseAllowance.js';
import { readArchiveStore } from '../server/archiveStore.js';
import { createGenerationArchive } from '../server/generationArchive.js';
import { readParseTicket } from '../server/babelParser/parseTicket.js';
import {
  MALFORMED_JSON,
  MAX_PARSE_BODY_BYTES,
  METHOD_NOT_ALLOWED,
  PARSE_RESPONSE_HEADERS,
  PAYLOAD_TOO_LARGE,
  checkParseRequestAccess,
  describeParseServerFailure,
  readParseAccessPolicy
} from '../server/parseHttpPolicy.js';

const accessPolicy = readParseAccessPolicy(process.env, { requireOrigin: true, allowNoOrigin: false });
// The hosted function is public Babel's: it sends only the public request.
const publicRequestOnly = readPublicRequestOnly(process.env, { deployed: true });

// The function's instances share no memory, so its allowances need the shared
// counter store; without one it starts no parse. BABEL_PARSE_COUNTER=memory
// counts per instance instead, which only a test or a single instance may use.
const counterStore = readCounterStore(process.env)
  ?? (process.env.BABEL_PARSE_COUNTER === 'memory' ? createMemoryCounterStore() : null);
const allowance = counterStore
  ? createParseAllowance({ store: counterStore, ...readParseAllowanceLimits(process.env, { deployed: true }) })
  : null;
// Only Babel's official deployment names an archive store, so local runs,
// previews and forks never upload (ROADMAP, Program 6A).
const archiveStore = readArchiveStore(process.env);
const archive = archiveStore
  ? createGenerationArchive({ store: archiveStore, counter: counterStore, commit: process.env.VERCEL_GIT_COMMIT_SHA })
  : null;

/**
 * Archives one finished parse before the visitor's answer is sent, since the
 * instance may stop once it answers. A check's request comes from its ticket,
 * which this server signed; the record keeps the request and its outcome and
 * nothing that names the visitor (no address, no ticket).
 */
const archiveParse = async (kind, body, validated, outcome) => {
  if (!archive) return;
  if (kind === 'check') {
    const fields = readParseTicket(String(process.env.OPENAI_API_KEY || '').trim(), body.ticket);
    if (!fields) return;
    await archive.record({ request: fields, outcome, responseId: fields.responseId, startedAt: fields.startedAt });
    return;
  }
  const responseId = outcome.response?.generationRecord?.outcome?.attempts?.[0]?.responseId;
  await archive.record({ request: validated, outcome, responseId });
};

const NO_COUNTER = {
  status: 503,
  body: { error: { code: 'LIMITS_UNAVAILABLE', message: 'Babel cannot start a parse right now. Please try again in a few minutes.' } }
};

// Vercel sets the visitor's address in these headers and overwrites any the
// browser sent, so a visitor cannot choose their own.
const visitorAddress = (req) => String(req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
  .split(',')[0].trim();

// Vercel stops this function at `maxDuration` in vercel.json (300 s on the
// current plan) and answers with its own error page. Babel ends the provider
// call first, so the browser receives Babel's ordinary PROVIDER_TIMEOUT
// failure. The 15 s left over covers checking and compiling a late answer
// (2.8 s at most across 1,440 saved runs, measured locally), sending it, and
// cold-start time. tests/hostedParseDeadline.test.mjs keeps the two in step.
export const HOSTED_FUNCTION_MAX_DURATION_MS = 300_000;
const HOSTED_RESPONSE_HEADROOM_MS = 15_000;
export const HOSTED_PROVIDER_DEADLINE_MS = HOSTED_FUNCTION_MAX_DURATION_MS - HOSTED_RESPONSE_HEADROOM_MS;

const send = (res, { status, body }) => res.status(status).json(body);

export default async function handler(req, res) {
  const deadlineAt = Date.now() + HOSTED_PROVIDER_DEADLINE_MS;
  for (const [name, value] of Object.entries(PARSE_RESPONSE_HEADERS)) res.setHeader(name, value);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (req.method !== 'POST') return send(res, METHOD_NOT_ALLOWED);

  // The platform proxy names the public host and protocol in forwarded headers.
  const rejected = checkParseRequestAccess(accessPolicy, {
    token: req.headers['x-babel-api-token'],
    origin: req.headers.origin,
    contentType: req.headers['content-type'],
    host: req.headers['x-forwarded-host'] || req.headers.host,
    protocol: req.headers['x-forwarded-proto'] || 'https'
  });
  if (rejected) return send(res, rejected);

  // The platform parses the body lazily and throws on malformed JSON.
  let body;
  try {
    body = req.body;
  } catch {
    return send(res, MALFORMED_JSON);
  }
  if (Buffer.byteLength(JSON.stringify(body ?? {}), 'utf8') > MAX_PARSE_BODY_BYTES) {
    return send(res, PAYLOAD_TOO_LARGE);
  }

  const address = visitorAddress(req);
  const kind = parseRequestKind(body);
  const parses = kind !== 'check';
  if (allowance) {
    const perMinute = await allowance.admitRequest(address);
    if (!perMinute.ok) return send(res, perMinute);
  }
  let validated = null;
  if (parses) {
    // A request Babel would refuse uses no allowance.
    try {
      validated = validateParseRequest(body, { publicRequestOnly });
    } catch (error) {
      return send(res, formatApiError(error));
    }
    if (!allowance) {
      console.error('[api/parse] refusing to start a parse: no shared counter store is configured');
      return send(res, NO_COUNTER);
    }
    const admitted = await allowance.admitParse(address);
    if (!admitted.ok) return send(res, admitted);
  }

  try {
    const result = await parseFromRequest(req, res, undefined, { deadlineAt, publicRequestOnly });
    if (result?.status !== 'pending') await archiveParse(kind, body, validated, { response: result });
    if (!res.destroyed) return res.status(200).json(result);
  } catch (error) {
    if (res.destroyed) return;
    if (failureEndsParse(kind, error)) await archiveParse(kind, body, validated, { failure: describeArchivedFailure(error) });
    // A failed parse gives the visitor's parse back before its failure is
    // sent, since the instance may stop once it answers. A store that cannot
    // is logged and the failure sent unchanged.
    if (allowance && refundsFailedParse(kind, error)) {
      const refund = await allowance.refundParse(address, kind === 'check' ? { onceKey: body.ticket } : {});
      if (refund === 'unavailable') console.error('[api/parse] could not give back a failed parse: the counter store did not answer');
      if (res.destroyed) return;
    }
    const formatted = formatApiError(error);
    if (formatted.status >= 500) {
      console.error('[api/parse] server error', describeParseServerFailure(error, formatted));
    }
    return send(res, formatted);
  }
}
