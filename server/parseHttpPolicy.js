import { timingSafeEqual } from 'node:crypto';

/**
 * Request policy for POST /api/parse, shared by the Express server, the hosted
 * function (api/parse.js) and the Vite development middleware. Each adapter
 * keeps its own body reading, admission counters and response writing, and
 * supplies the serving host and protocol from its own transport. Token, Origin
 * and media-type decisions, response headers and server-failure log fields are
 * made here so the entry points cannot drift apart.
 */

const parseBooleanEnv = (value, defaultValue = false) => {
  const raw = String(value || '').trim();
  if (!raw) return defaultValue;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  return defaultValue;
};

export const parseCsvEnv = (value) => String(value || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

/**
 * Each runtime supplies its own Origin defaults; the variables mean the same
 * everywhere. `localPageOrigin` marks a local runtime, where an Origin that is
 * present is checked even when one is not required.
 */
export const readParseAccessPolicy = (env, defaults) => ({
  apiToken: String(env.BABEL_PARSE_API_TOKEN || '').trim(),
  allowedOrigins: new Set(parseCsvEnv(env.BABEL_ALLOWED_ORIGINS)),
  requireOrigin: parseBooleanEnv(env.BABEL_REQUIRE_ORIGIN, defaults.requireOrigin),
  allowNoOrigin: parseBooleanEnv(env.BABEL_ALLOW_NO_ORIGIN, defaults.allowNoOrigin),
  localPageOrigin: Boolean(defaults.localPageOrigin)
});

const constantTimeTokenMatch = (providedToken, expectedToken) => {
  const provided = Buffer.from(String(providedToken || ''), 'utf8');
  const expected = Buffer.from(String(expectedToken || ''), 'utf8');
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
};

/**
 * A configured allow-list is exclusive: it must name every origin that serves
 * the app. Without one, only the origin serving this request is accepted.
 */
const isAllowedRequestOrigin = (origin, policy, { host, protocol }) => {
  if (!origin) return policy.allowNoOrigin;

  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }

  if (policy.allowedOrigins.size > 0) {
    return policy.allowedOrigins.has(parsedOrigin.origin);
  }

  const expectedHost = String(host || '').trim().toLowerCase();
  const expectedProtocol = String(protocol || '').trim().toLowerCase();
  if (!expectedHost || !expectedProtocol) return false;
  return parsedOrigin.host.toLowerCase() === expectedHost
    && parsedOrigin.protocol.replace(':', '').toLowerCase() === expectedProtocol;
};

/**
 * A local runtime's page is the app on the host this request names. A TLS
 * tunnel's page is https while its local hop is plain HTTP, so either scheme
 * is accepted; a configured allow-list stays exclusive.
 */
const isLocalPageOrigin = (origin, policy, host) => {
  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }
  if (policy.allowedOrigins.size > 0) return policy.allowedOrigins.has(parsedOrigin.origin);
  return (parsedOrigin.protocol === 'http:' || parsedOrigin.protocol === 'https:')
    && parsedOrigin.host === String(host || '').trim().toLowerCase();
};

const isJsonMediaType = (contentType) =>
  String(contentType || '').split(';')[0].trim().toLowerCase() === 'application/json';

const rejection = (status, code, message) => ({ status, body: { error: { code, message } } });

export const METHOD_NOT_ALLOWED = rejection(405, 'METHOD_NOT_ALLOWED', 'Use POST /api/parse.');
export const MALFORMED_JSON = rejection(400, 'INVALID_REQUEST', 'Malformed JSON request body.');
export const MAX_PARSE_BODY_BYTES = 16 * 1024;
export const PAYLOAD_TOO_LARGE = rejection(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 16kb.');
const FORBIDDEN_ORIGIN = rejection(403, 'FORBIDDEN_ORIGIN', 'Request origin is not allowed for parse API access.');

/** Returns the first rejection for a POST, or null when the request may be parsed. */
export const checkParseRequestAccess = (policy, { token, origin, contentType, host, protocol }) => {
  if (policy.apiToken && !constantTimeTokenMatch(String(token || '').trim(), policy.apiToken)) {
    return rejection(401, 'UNAUTHORIZED', 'Missing or invalid parse API token.');
  }
  const presentedOrigin = String(origin || '').trim();
  if (policy.requireOrigin && !isAllowedRequestOrigin(presentedOrigin, policy, { host, protocol })) {
    return FORBIDDEN_ORIGIN;
  }
  if (policy.localPageOrigin && presentedOrigin && !isLocalPageOrigin(presentedOrigin, policy, host)) {
    return FORBIDDEN_ORIGIN;
  }
  if (!isJsonMediaType(contentType)) {
    return rejection(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.');
  }
  return null;
};

export const PARSE_RESPONSE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  Vary: 'Origin'
});

/** Log fields for a 5xx response. */
export const describeParseServerFailure = (error, formatted) => ({
  code: formatted.body?.error?.code,
  status: formatted.status,
  runId: error?.details?.generationRecord?.outcome?.runId,
  ruleId: error?.failure?.ruleId,
  processingStep: error?.failure?.processingStep,
  fieldPath: error?.failure?.fieldPath,
  ...(error?.details?.engineError ? { engineError: error.details.engineError } : {})
});
