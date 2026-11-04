import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

import { createDevParseMiddleware } from './server/devParseMiddleware.js';
import { parseCsvEnv } from './server/parseHttpPolicy.js';
import { buildVersionPlugin } from './scripts/buildVersionPlugin.mjs';
import { thirdPartyNoticesPlugins } from './scripts/thirdPartyNoticesPlugin.mjs';

const secureParseApiPlugin = (mode: string): Plugin => {
  const env = loadEnv(mode, '.', '');

  return {
    name: 'secure-parse-api-dev-middleware',
    configureServer(server) {
      server.middlewares.use(createDevParseMiddleware({ env }));
    }
  };
};

// BABEL_APP=public builds and serves public Babel (publicApp/main.tsx) from
// the same index.html; anything else is the internal app (index.tsx).
const publicAppEntryPlugin = (): Plugin => ({
  name: 'babel-public-app-entry',
  // Before Vite reads the page's scripts, so the build starts from the public entry.
  transformIndexHtml: {
    order: 'pre',
    handler(html) {
      const entry = '<script type="module" src="/index.tsx"></script>';
      if (!html.includes(entry)) throw new Error('index.html no longer loads /index.tsx; update publicAppEntryPlugin.');
      return html.replace(entry, '<script type="module" src="/publicApp/main.tsx"></script>');
    }
  }
});

export default defineConfig(({ mode }) => {
  const notices = thirdPartyNoticesPlugins({ root: __dirname });
  return {
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
    plugins: [react(), secureParseApiPlugin(mode), buildVersionPlugin({ root: __dirname }), notices.plugin,
      ...(process.env.BABEL_APP === 'public' ? [publicAppEntryPlugin()] : [])],
    worker: {
      plugins: () => [notices.workerPlugin]
    }
  };
});
