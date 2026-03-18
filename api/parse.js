import { timingSafeEqual } from 'node:crypto';
import { formatApiError, parseFromBody } from '../server/parseApi.js';

const MAX_BODY_BYTES = 16 * 1024;

const parseBooleanEnv = (value, defaultValue = false) => {
  const raw = String(value || '').trim();
  if (!raw) return defaultValue;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  return defaultValue;
};

const parseApiToken = String(process.env.BABEL_PARSE_API_TOKEN || '').trim();
const allowedOriginsEnv = String(process.env.BABEL_ALLOWED_ORIGINS || '').trim();
const allowedOrigins = new Set(
  allowedOriginsEnv ? allowedOriginsEnv.split(',').map((s) => s.trim()).filter(Boolean) : []
);
const requireOriginCheck = parseBooleanEnv(process.env.BABEL_REQUIRE_ORIGIN, true);
const allowNoOrigin = parseBooleanEnv(process.env.BABEL_ALLOW_NO_ORIGIN, false);

const constantTimeTokenMatch = (provided, expected) => {
  const a = Buffer.from(String(provided || ''), 'utf8');
  const b = Buffer.from(String(expected || ''), 'utf8');
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
};

const parseOriginHost = (req) =>
  String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .trim()
    .toLowerCase();

const parseOriginProto = (req) =>
  String(req.headers['x-forwarded-proto'] || 'https')
    .trim()
    .toLowerCase();

const isAllowedRequestOrigin = (origin, req) => {
  if (!origin) return allowNoOrigin;

  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }

  if (allowedOrigins.has(parsedOrigin.origin)) {
    return true;
  }

  const expectedHost = parseOriginHost(req);
  const expectedProto = parseOriginProto(req);
  if (!expectedHost || !expectedProto) return false;
  return (
    parsedOrigin.host.toLowerCase() === expectedHost &&
    parsedOrigin.protocol.replace(':', '').toLowerCase() === expectedProto
  );
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST /api/parse.' }
    });
  }

  // Token gate
  if (parseApiToken) {
    const provided = String(req.headers['x-babel-api-token'] || '').trim();
    if (!constantTimeTokenMatch(provided, parseApiToken)) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Missing or invalid parse API token.' }
      });
    }
  }

  // Origin check
  if (requireOriginCheck) {
    const origin = String(req.headers.origin || '').trim();
    if (!isAllowedRequestOrigin(origin, req)) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN_ORIGIN', message: 'Request origin is not allowed.' }
      });
    }
  }

  // Body size guard (Vercel parses body automatically, but belt-and-suspenders)
  const raw = JSON.stringify(req.body || {});
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 16kb.' }
    });
  }

  try {
    const result = await parseFromBody(req.body);
    return res.status(200).json(result);
  } catch (error) {
    const formatted = formatApiError(error);
    if (formatted.status >= 500) {
      console.error('[api/parse] server error', {
        code: formatted.body?.error?.code,
        status: formatted.status
      });
    }
    return res.status(formatted.status).json(formatted.body);
  }
}
