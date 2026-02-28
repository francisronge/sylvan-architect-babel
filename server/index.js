import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

app.set('trust proxy', 1);
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
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many parse requests. Please retry shortly.' } }
});

app.get('/healthz', (_, res) => {
  res.status(200).json({ ok: true });
});

app.post('/api/parse', parseLimiter, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

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
  }
});

app.use((error, _, res, next) => {
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'Malformed JSON request body.' }
    });
  }
  return next(error);
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
