import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { trackProviderCalls } from './babelParser/providerTransport.js';
import { createDailyParseQuota } from './dailyParseQuota.js';
import { formatApiError, parseFromRequest } from './parseApi.js';
import {
  MALFORMED_JSON,
  MAX_PARSE_BODY_BYTES,
  METHOD_NOT_ALLOWED,
  PARSE_RESPONSE_HEADERS,
  PAYLOAD_TOO_LARGE,
  checkParseRequestAccess,
  describeParseServerFailure,
  readParseAccessPolicy
} from './parseHttpPolicy.js';
import { PERMISSIONS_POLICY, helmetOptions } from './securityHeaders.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '../dist');

const app = express();
const port = Number(process.env.PORT || 3000);
const isLocalRuntime = process.env.NODE_ENV !== 'production';

const parseTrustProxySetting = () => {
  const raw = String(process.env.BABEL_TRUST_PROXY || '').trim();
  if (!raw) return isLocalRuntime ? false : 1;
  if (/^(1|true|yes|on)$/i.test(raw)) return 1;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  const asNumber = Number(raw);
  if (Number.isInteger(asNumber) && asNumber >= 0) return asNumber;
  return raw;
};

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const accessPolicy = readParseAccessPolicy(process.env, {
  requireOrigin: !isLocalRuntime,
  allowNoOrigin: isLocalRuntime
});
const parseRateLimitPerMinute = toPositiveInt(process.env.BABEL_PARSE_RATE_LIMIT_PER_MINUTE, 30);
const parseDailyLimitPerIp = toPositiveInt(process.env.BABEL_PARSE_DAILY_LIMIT_PER_IP, 1200);
const maxInFlightParses = toPositiveInt(process.env.BABEL_MAX_IN_FLIGHT_PARSES, 8);
const dailyQuota = createDailyParseQuota({ limit: parseDailyLimitPerIp });
let inFlightParses = 0;

const getClientIp = (req) => String(req.ip || req.socket?.remoteAddress || 'unknown');

// `trust proxy` decides whether req.protocol reads a forwarded protocol.
const enforceParseRequestSecurity = (req, res, next) => {
  const rejected = checkParseRequestAccess(accessPolicy, {
    token: req.get('x-babel-api-token'),
    origin: req.get('origin'),
    contentType: req.get('content-type'),
    host: req.get('host'),
    protocol: req.protocol
  });
  if (rejected) return res.status(rejected.status).json(rejected.body);
  return next();
};

app.set('trust proxy', parseTrustProxySetting());
app.disable('x-powered-by');

app.use(helmet(helmetOptions({ hsts: !isLocalRuntime })));

app.use((_, res, next) => {
  res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
  next();
});

app.use(express.json({ limit: MAX_PARSE_BODY_BYTES }));

const parseLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: parseRateLimitPerMinute,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many parse requests. Please retry shortly.' } }
});

app.get('/healthz', (_, res) => {
  res.status(200).json({ ok: true });
});

app.all('/api/parse', (req, res, next) => {
  for (const [name, value] of Object.entries(PARSE_RESPONSE_HEADERS)) res.setHeader(name, value);
  if (req.method !== 'POST') return res.status(METHOD_NOT_ALLOWED.status).json(METHOD_NOT_ALLOWED.body);
  return next();
});

// Only an admitted request uses the daily allowance and an in-flight slot.
app.post('/api/parse', parseLimiter, enforceParseRequestSecurity, async (req, res) => {
  const ip = getClientIp(req);
  if (dailyQuota.exhausted(ip)) {
    return res.status(429).json({
      error: { code: 'RATE_LIMITED_DAILY', message: 'Daily parse limit reached for this IP. Please retry tomorrow.' }
    });
  }
  if (inFlightParses >= maxInFlightParses) {
    return res.status(503).json({
      error: { code: 'SERVER_BUSY', message: 'Too many parse requests are in-flight. Please retry shortly.' }
    });
  }

  dailyQuota.record(ip);
  inFlightParses += 1;
  // The slot stays taken after the response ends until every provider call settles.
  const generation = trackProviderCalls(() => parseFromRequest(req, res));
  generation.settled.then(() => { inFlightParses -= 1; });

  try {
    const result = await generation.result;
    if (!res.destroyed) res.status(200).json(result);
  } catch (error) {
    if (res.destroyed) return;
    const formatted = formatApiError(error);
    if (formatted.status >= 500) {
      console.error('[api/parse] server error', describeParseServerFailure(error, formatted));
    }
    res.status(formatted.status).json(formatted.body);
  }
});

app.use((error, _, res, next) => {
  if (error && typeof error === 'object' && error.type === 'entity.too.large') {
    return res.status(PAYLOAD_TOO_LARGE.status).json(PAYLOAD_TOO_LARGE.body);
  }
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(MALFORMED_JSON.status).json(MALFORMED_JSON.body);
  }
  if (error) {
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' }
    });
  }
  return next();
});

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath, { extensions: ['html'] }));

  app.get(/^(?!\/api\/).*/, (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`[secure-server] listening on http://127.0.0.1:${port}`);
});
