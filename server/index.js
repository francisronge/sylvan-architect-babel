import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { trackProviderCalls } from './babelParser/providerTransport.js';
import { createMemoryCounterStore, createParseAllowance, readCounterStore, readParseAllowanceLimits } from './parseAllowance.js';
import { formatApiError, parseFromRequest, parseRequestKind, readPublicRequestOnly, refundsFailedParse, validateParseRequest } from './parseApi.js';
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
import { describeStaleDist } from './distFreshness.js';
import { checkLocalRuntimeHost, readLocalHostPolicy } from './localHostPolicy.js';
import { PERMISSIONS_POLICY, helmetOptions } from './securityHeaders.js';
import { staticOptions } from './staticAssets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const checkoutRoot = path.resolve(__dirname, '..');
const distPath = path.join(checkoutRoot, 'dist');

const app = express();
const port = Number(process.env.PORT || 3000);
const isLocalRuntime = process.env.NODE_ENV !== 'production';
// A local runtime holds the developer's provider keys without requiring Origin, so it
// accepts connections from this machine only and answers only local Host names
// (localHostPolicy.js). Production listens on every interface.
const listenHost = String(process.env.BABEL_LISTEN_HOST || '').trim() || (isLocalRuntime ? '127.0.0.1' : '');

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
  allowNoOrigin: isLocalRuntime,
  localPageOrigin: isLocalRuntime
});
const localHostPolicy = isLocalRuntime ? readLocalHostPolicy(process.env) : null;
// A deployed server sends only public Babel's request; the local one keeps the internal app's menus.
const publicRequestOnly = readPublicRequestOnly(process.env, { deployed: !isLocalRuntime });
const parseRateLimitPerMinute = toPositiveInt(process.env.BABEL_PARSE_RATE_LIMIT_PER_MINUTE, 30);
const maxInFlightParses = toPositiveInt(process.env.BABEL_MAX_IN_FLIGHT_PARSES, 8);
// One process counts in its own memory unless a shared store is configured.
// The per-minute limit is parseLimiter's, below.
const parseAllowance = createParseAllowance({
  store: readCounterStore(process.env) ?? createMemoryCounterStore(),
  ...readParseAllowanceLimits(process.env, { deployed: !isLocalRuntime }),
  perVisitorPerMinute: Infinity
});
let inFlightParses = 0;

const getClientIp = (req) => String(req.ip || req.socket?.remoteAddress || 'unknown');

// A failed parse gives the visitor's parse back before its failure is sent;
// a store that cannot is logged and the failure sent unchanged.
const refundFailedParse = async (req, kind, error) => {
  if (!refundsFailedParse(kind, error)) return;
  const refund = await parseAllowance.refundParse(getClientIp(req), kind === 'check' ? { onceKey: req.body.ticket } : {});
  if (refund === 'unavailable') console.error('[api/parse] could not give back a failed parse: the counter store did not answer');
};

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

if (localHostPolicy) {
  app.use((req, res, next) => {
    const rejected = checkLocalRuntimeHost(localHostPolicy, req.get('host'));
    if (!rejected) return next();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(rejected.status).json(rejected.body);
  });
}

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

// Only an admitted request uses the daily allowances and an in-flight slot. A
// ticket check starts no generation, so it uses neither; it counts only
// against the per-minute limit.
app.post('/api/parse', parseLimiter, enforceParseRequestSecurity, async (req, res) => {
  if (parseRequestKind(req.body) === 'check') {
    try {
      const result = await parseFromRequest(req, res, undefined, { publicRequestOnly });
      if (!res.destroyed) res.status(200).json(result);
    } catch (error) {
      if (res.destroyed) return;
      await refundFailedParse(req, 'check', error);
      if (res.destroyed) return;
      const formatted = formatApiError(error);
      if (formatted.status >= 500 && formatted.body?.error?.code !== 'CHECK_UNAVAILABLE') {
        console.error('[api/parse] server error', describeParseServerFailure(error, formatted));
      }
      res.status(formatted.status).json(formatted.body);
    }
    return;
  }
  // A request Babel would refuse uses no allowance or slot.
  try {
    validateParseRequest(req.body, { publicRequestOnly });
  } catch (error) {
    const formatted = formatApiError(error);
    return res.status(formatted.status).json(formatted.body);
  }
  if (inFlightParses >= maxInFlightParses) {
    return res.status(503).json({
      error: { code: 'SERVER_BUSY', message: 'Too many parse requests are in-flight. Please retry shortly.' }
    });
  }
  // The slot is taken before counting, so concurrent requests cannot overfill it.
  inFlightParses += 1;
  let admitted;
  try {
    admitted = await parseAllowance.admitParse(getClientIp(req));
  } catch (error) {
    inFlightParses -= 1;
    console.error('[api/parse] allowance error', error?.name || 'error');
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' } });
  }
  if (!admitted.ok) {
    inFlightParses -= 1;
    return res.status(admitted.status).json(admitted.body);
  }
  // The slot stays taken after the response ends until every provider call settles.
  const generation = trackProviderCalls(() => parseFromRequest(req, res, undefined, { publicRequestOnly }));
  generation.settled.then(() => { inFlightParses -= 1; });

  try {
    const result = await generation.result;
    if (!res.destroyed) res.status(200).json(result);
  } catch (error) {
    if (res.destroyed) return;
    await refundFailedParse(req, parseRequestKind(req.body), error);
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

// A production host serves the dist/ its deploy built and may have no git
// checkout to compare it with; the local runtime refuses a build of other sources.
const staleDist = isLocalRuntime && fs.existsSync(distPath)
  ? describeStaleDist({ root: checkoutRoot, distPath }) : null;
if (staleDist) {
  console.error(`[secure-server] refusing to start: ${staleDist}`);
  process.exit(1);
}

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath, staticOptions(distPath)));

  app.get(/^(?!\/api\/).*/, (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(path.join(distPath, 'index.html'));
  });
}

const server = app.listen(...(listenHost ? [port, listenHost] : [port]), () => {
  const { address, port: boundPort } = server.address();
  const shownHost = address.includes(':') ? `[${address}]` : address;
  console.log(`[secure-server] listening on http://${shownHost}:${boundPort}`);
});
