import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createManualParseMiddleware } from '../contractQualification/manualServer.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const { values } = parseArgs({ options: {
  port: { type: 'string', default: '8454' }, out: { type: 'string' }, help: { type: 'boolean' }
} });
if (values.help) {
  console.log('Babel app with manual Codex OAuth generation.\n  [--port 8454] [--out ARTIFACT_DIRECTORY]\nBinds only to 127.0.0.1. Default model: GPT-6.1 Sol / high.');
  process.exit(0);
}
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Use a valid local port.');
const runsRoot = path.resolve(values.out || path.join(os.homedir(), 'Library/Application Support/Babel/codex-qualification'));
const parse = createManualParseMiddleware({ runsRoot, port });
const server = await createServer({
  configFile: false, root: repoRoot, envDir: false,
  server: { host: '127.0.0.1', port, strictPort: true, fs: { strict: true, allow: [repoRoot] } },
  resolve: { alias: { '@': repoRoot } },
  plugins: [react(), {
    name: 'babel-manual-codex-oauth',
    transformIndexHtml(html) { return html.replace('src="/index.tsx"', 'src="/contractQualification/manualApp.tsx"'); },
    configureServer(vite) { vite.middlewares.use(parse); }
  }]
});
await server.listen();
console.log(`Babel: http://127.0.0.1:${port}/\nSaved qualification runs: ${runsRoot}`);
const stop = async () => {
  parse.cancel();
  await server.close();
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
