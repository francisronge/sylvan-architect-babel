import { formatApiError, parseFromBody, parseFromRequest } from './parseApi.js';
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
import { checkLocalRuntimeHost, readLocalHostPolicy } from './localHostPolicy.js';

const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_REQUESTS = 30;

class PayloadTooLarge extends Error {}

const readBody = async (req) => {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_PARSE_BODY_BYTES) throw new PayloadTooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
};

/**
 * Connect middleware serving /api/parse on the Vite development server. It
 * applies the shared request policy and the deployed runtimes' disconnect
 * cancellation; body reading and the per-minute limiter are local transport.
 * Vite installs its own host check after this middleware, so the local host
 * policy is applied here; a page's Origin must then be that host's app or, when
 * BABEL_ALLOWED_ORIGINS is set, one of its origins. A caller without Origin is
 * refused only when an allow-list is set or BABEL_REQUIRE_ORIGIN asks.
 */
export const createDevParseMiddleware = ({ env, parse = parseFromBody }) => {
  const accessPolicy = readParseAccessPolicy(env, {
    requireOrigin: Boolean(String(env.BABEL_ALLOWED_ORIGINS || '').trim()),
    allowNoOrigin: false,
    localPageOrigin: true
  });
  const hostPolicy = readLocalHostPolicy(env);
  const rateMap = new Map();

  return async (req, res, next) => {
    const pathname = req.url?.split('?')[0] || '';
    if (pathname !== '/api/parse') return next();

    const send = ({ status, body }) => {
      if (res.destroyed) return;
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      for (const [name, value] of Object.entries(PARSE_RESPONSE_HEADERS)) res.setHeader(name, value);
      res.end(JSON.stringify(body));
    };

    const wrongHost = checkLocalRuntimeHost(hostPolicy, req.headers.host);
    if (wrongHost) return send(wrongHost);
    if (req.method !== 'POST') return send(METHOD_NOT_ALLOWED);

    const rejected = checkParseRequestAccess(accessPolicy, {
      token: req.headers['x-babel-api-token'],
      origin: req.headers.origin,
      contentType: req.headers['content-type'],
      host: req.headers.host,
      protocol: 'http'
    });
    if (rejected) return send(rejected);

    const ip = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const slot = rateMap.get(ip);
    if (!slot || now > slot.resetAt) {
      rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    } else if (slot.count >= RATE_MAX_REQUESTS) {
      return send({
        status: 429,
        body: { error: { code: 'RATE_LIMITED', message: 'Too many parse requests. Please retry shortly.' } }
      });
    } else {
      slot.count += 1;
    }
    if (rateMap.size > 5000) {
      for (const [key, value] of rateMap.entries()) {
        if (now > value.resetAt) rateMap.delete(key);
      }
    }

    try {
      const rawBody = await readBody(req);
      req.body = rawBody ? JSON.parse(rawBody) : {};
    } catch (error) {
      if (error instanceof PayloadTooLarge) return send(PAYLOAD_TOO_LARGE);
      if (error instanceof SyntaxError) return send(MALFORMED_JSON);
      return send(formatApiError(error));
    }

    try {
      send({ status: 200, body: await parseFromRequest(req, res, parse) });
    } catch (error) {
      if (res.destroyed) return;
      const formatted = formatApiError(error);
      if (formatted.status >= 500) {
        console.error('[dev-api/parse] server error', describeParseServerFailure(error, formatted));
      }
      send(formatted);
    }
  };
};
