import path from 'node:path';
import type { IncomingMessage } from 'node:http';

import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

import { formatApiError, parseFromBody } from './server/parseApi.js';

const MAX_BODY_BYTES = 16 * 1024;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_REQUESTS = 30;

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new Error('PAYLOAD_TOO_LARGE');
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString('utf8');
};

const secureParseApiPlugin = (mode: string): Plugin => {
  const env = loadEnv(mode, '.', '');

  if (!process.env.GEMINI_API_KEY && env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;
  }

  const rateMap = new Map<string, { count: number; resetAt: number }>();

  return {
    name: 'secure-parse-api-dev-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = req.url?.split('?')[0] || '';
        if (pathname !== '/api/parse') {
          return next();
        }

        const send = (status: number, payload: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(payload));
        };

        if (req.method !== 'POST') {
          return send(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST /api/parse.' } });
        }

        try {
          const ip = req.socket.remoteAddress || 'unknown';
          const now = Date.now();
          const slot = rateMap.get(ip);

          if (!slot || now > slot.resetAt) {
            rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
          } else {
            if (slot.count >= RATE_MAX_REQUESTS) {
              return send(429, {
                error: { code: 'RATE_LIMITED', message: 'Too many parse requests. Please retry shortly.' }
              });
            }
            slot.count += 1;
          }

          if (rateMap.size > 5000) {
            for (const [key, value] of rateMap.entries()) {
              if (now > value.resetAt) rateMap.delete(key);
            }
          }

          const rawBody = await readBody(req);
          const body = rawBody ? JSON.parse(rawBody) : {};
          const result = await parseFromBody(body);
          return send(200, result);
        } catch (error: unknown) {
          if (error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE') {
            return send(413, {
              error: {
                code: 'PAYLOAD_TOO_LARGE',
                message: `Request body exceeds ${MAX_BODY_BYTES} bytes.`
              }
            });
          }

          if (error instanceof SyntaxError) {
            return send(400, {
              error: {
                code: 'INVALID_REQUEST',
                message: 'Malformed JSON request body.'
              }
            });
          }

          const formatted = formatApiError(error);
          if (formatted.status >= 500) {
            console.error('[dev-api/parse] server error', {
              code: (formatted.body as any)?.error?.code,
              status: formatted.status,
              message: (formatted.body as any)?.error?.message
            });
          }
          return send(formatted.status, formatted.body);
        }
      });
    }
  };
};

export default defineConfig(({ mode }) => ({
  server: {
    port: 5177,
    strictPort: true,
    host: '127.0.0.1'
  },
  plugins: [react(), secureParseApiPlugin(mode)],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.')
    }
  }
}));
