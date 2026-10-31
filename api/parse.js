import { formatApiError, parseFromRequest } from '../server/parseApi.js';
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

// Vercel stops this function at `maxDuration` in vercel.json (300 s on the
// current plan) and answers with its own error page. Babel ends the provider
// call first, so the browser receives Babel's ordinary PROVIDER_TIMEOUT
// failure. The 15 s left over covers checking and compiling a late answer
// (2.8 s at most across 1,440 saved runs, measured locally), sending it, and
// cold-start time. tests/hostedParseDeadline.test.mjs keeps the two in step.
export const HOSTED_FUNCTION_MAX_DURATION_MS = 300_000;
export const HOSTED_RESPONSE_HEADROOM_MS = 15_000;
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

  try {
    const result = await parseFromRequest(req, res, undefined, { deadlineAt });
    if (!res.destroyed) return res.status(200).json(result);
  } catch (error) {
    if (res.destroyed) return;
    const formatted = formatApiError(error);
    if (formatted.status >= 500) {
      console.error('[api/parse] server error', describeParseServerFailure(error, formatted));
    }
    return send(res, formatted);
  }
}
