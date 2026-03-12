import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { formatApiError, parseFromBody } from './parseApi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '../dist');

const app = express();
const port = Number(process.env.PORT || 3000);
const isLocalRuntime = process.env.NODE_ENV !== 'production';

const parseBooleanEnv = (value, defaultValue = false) => {
  const raw = String(value || '').trim();
  if (!raw) return defaultValue;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  return defaultValue;
};

const parseTrustProxySetting = () => {
  const raw = String(process.env.BABEL_TRUST_PROXY || '').trim();
  if (!raw) return isLocalRuntime ? false : 1;
  if (/^(1|true|yes|on)$/i.test(raw)) return 1;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  const asNumber = Number(raw);
  if (Number.isInteger(asNumber) && asNumber >= 0) return asNumber;
  return raw;
};

const parseAllowedOrigins = () => {
  const raw = String(process.env.BABEL_ALLOWED_ORIGINS || '').trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
};

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const allowedOrigins = parseAllowedOrigins();
const requireOriginCheck = parseBooleanEnv(process.env.BABEL_REQUIRE_ORIGIN, !isLocalRuntime);
const allowNoOrigin = parseBooleanEnv(process.env.BABEL_ALLOW_NO_ORIGIN, isLocalRuntime);
const parseApiToken = String(process.env.BABEL_PARSE_API_TOKEN || '').trim();
const parseRateLimitPerMinute = toPositiveInt(process.env.BABEL_PARSE_RATE_LIMIT_PER_MINUTE, 30);
const parseDailyLimitPerIp = toPositiveInt(process.env.BABEL_PARSE_DAILY_LIMIT_PER_IP, 1200);
const maxInFlightParses = toPositiveInt(process.env.BABEL_MAX_IN_FLIGHT_PARSES, 8);
const dailyUsageByIp = new Map();
let inFlightParses = 0;

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

const getClientIp = (req) => String(req.ip || req.socket?.remoteAddress || 'unknown');

const currentDayBucket = () => Math.floor(Date.now() / 86400000);

const enforceDailyIpQuota = (req, res, next) => {
  const ip = getClientIp(req);
  const dayBucket = currentDayBucket();
  const key = `${ip}|${dayBucket}`;
  const used = Number(dailyUsageByIp.get(key) || 0);

  if (used >= parseDailyLimitPerIp) {
    return res.status(429).json({
      error: { code: 'RATE_LIMITED_DAILY', message: 'Daily parse limit reached for this IP. Please retry tomorrow.' }
    });
  }

  dailyUsageByIp.set(key, used + 1);
  if (dailyUsageByIp.size > 20000) {
    for (const existingKey of dailyUsageByIp.keys()) {
      const bucket = Number(String(existingKey).split('|')[1]);
      if (!Number.isFinite(bucket) || bucket < dayBucket) {
        dailyUsageByIp.delete(existingKey);
      }
    }
  }
  return next();
};

const parseOriginHost = (req) =>
  String(req.get('host') || '')
    .trim()
    .toLowerCase();

const parseOriginProto = (req) =>
  String(req.protocol || '')
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

  if (allowedOrigins.size > 0) {
    return allowedOrigins.has(parsedOrigin.origin);
  }

  const expectedHost = parseOriginHost(req);
  const expectedProto = parseOriginProto(req);
  if (!expectedHost || !expectedProto) return false;
  return parsedOrigin.host.toLowerCase() === expectedHost && parsedOrigin.protocol.replace(':', '').toLowerCase() === expectedProto;
};

const enforceParseRequestSecurity = (req, res, next) => {
  if (parseApiToken) {
    const providedToken = String(req.get('x-babel-api-token') || '').trim();
    if (!constantTimeTokenMatch(providedToken, parseApiToken)) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Missing or invalid parse API token.' }
      });
    }
  }

  if (requireOriginCheck) {
    const requestOrigin = String(req.get('origin') || '').trim();
    if (!isAllowedRequestOrigin(requestOrigin, req)) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN_ORIGIN', message: 'Request origin is not allowed for parse API access.' }
      });
    }
  }

  return next();
};

app.set('trust proxy', parseTrustProxySetting());
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"]
      }
    },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: isLocalRuntime ? false : undefined
  })
);

app.use((_, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.use(express.json({ limit: '16kb' }));

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
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST /api/parse.' }
    });
  }
  return next();
});

app.post('/api/parse', parseLimiter, enforceDailyIpQuota, enforceParseRequestSecurity, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');

  if (!req.is('application/json')) {
    return res.status(415).json({
      error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json.' }
    });
  }

  if (inFlightParses >= maxInFlightParses) {
    return res.status(503).json({
      error: { code: 'SERVER_BUSY', message: 'Too many parse requests are in-flight. Please retry shortly.' }
    });
  }

  inFlightParses += 1;

  try {
    const result = await parseFromBody(req.body);
    res.status(200).json(result);
  } catch (error) {
    const formatted = formatApiError(error);
    if (formatted.status >= 500) {
      console.error('[api/parse] server error', {
        code: formatted.body?.error?.code,
        status: formatted.status
      });
    }
    res.status(formatted.status).json(formatted.body);
  } finally {
    inFlightParses = Math.max(0, inFlightParses - 1);
  }
});

app.use((error, _, res, next) => {
  if (error && typeof error === 'object' && error.type === 'entity.too.large') {
    return res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 16kb.' }
    });
  }
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'Malformed JSON request body.' }
    });
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
