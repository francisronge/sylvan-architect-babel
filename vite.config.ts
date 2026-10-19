import path from 'node:path';

import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

import { createDevParseMiddleware } from './server/devParseMiddleware.js';
import { parseCsvEnv } from './server/parseHttpPolicy.js';

const secureParseApiPlugin = (mode: string): Plugin => {
  const env = loadEnv(mode, '.', '');

  if (!process.env.GEMINI_API_KEY && env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;
  }

  return {
    name: 'secure-parse-api-dev-middleware',
    configureServer(server) {
      server.middlewares.use(createDevParseMiddleware({ env }));
    }
  };
};

export default defineConfig(({ mode }) => ({
  server: {
    port: 5177,
    strictPort: true,
    host: '127.0.0.1',
    allowedHosts: (() => {
      const env = loadEnv(mode, '.', '');
      const hosts = parseCsvEnv(env.BABEL_DEV_ALLOWED_HOSTS);
      return hosts.length > 0 ? hosts : undefined;
    })()
  },
  plugins: [react(), secureParseApiPlugin(mode)],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.')
    }
  }
}));
