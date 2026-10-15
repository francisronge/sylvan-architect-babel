import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer as createTcpServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';

async function availableLoopbackPort() {
  const probe = createTcpServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

// Keep the application's Vite config/plugins, but isolate concurrent checkouts
// from its fixed port and from each other's dependency optimizer output.
export async function startBrowserTestServer({ root, plugins = [] }) {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'babel-browser-vite-'));
  let server, cleanup;
  const close = () => cleanup ??= (async () => {
    try { await server?.close(); }
    finally { await rm(cacheDir, { recursive: true, force: true }); }
  })();
  try {
    const [sourceRoot, dependencies, port] = await Promise.all([
      realpath(root), realpath(path.join(root, 'node_modules')), availableLoopbackPort()
    ]);
    server = await createServer({ root, cacheDir, plugins, server: {
      host: '127.0.0.1', port, strictPort: false,
      fs: { allow: [root, sourceRoot, dependencies, cacheDir] }
    } });
    await server.listen();
    return { url: `http://127.0.0.1:${server.httpServer.address().port}/`, close };
  } catch (error) {
    await close();
    throw error;
  }
}
