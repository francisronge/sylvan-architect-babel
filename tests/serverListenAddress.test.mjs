import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const serverEntry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../server/index.js');

const externalAddress = () => Object.values(os.networkInterfaces())
  .flat()
  .find(entry => entry && entry.family === 'IPv4' && !entry.internal)?.address;

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

const startServer = async (env) => {
  const port = await freePort();
  const child = spawn(process.execPath, [serverEntry], {
    env: { PATH: process.env.PATH, PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  await new Promise((resolve, reject) => {
    const onData = (chunk) => {
      output += chunk;
      if (output.includes('listening on')) resolve();
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', code => reject(new Error(`server exited ${code}: ${output}`)));
  });
  return { child, port, output };
};

const stopServer = (child) => new Promise((resolve) => {
  if (child.exitCode !== null) return resolve();
  child.once('exit', resolve);
  child.kill();
});

const canConnect = (host, port) => new Promise((resolve) => {
  const socket = net.connect({ host, port });
  socket.setTimeout(2000);
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
  socket.once('timeout', () => { socket.destroy(); resolve(false); });
});

const lanAddress = externalAddress();
const skip = lanAddress ? false : 'no non-loopback IPv4 interface';

test('a local runtime accepts connections from this machine only', { skip }, async () => {
  const { child, port, output } = await startServer({});
  try {
    assert.match(output, new RegExp(`listening on http://127\\.0\\.0\\.1:${port}`));
    assert.equal(await canConnect('127.0.0.1', port), true);
    assert.equal(await canConnect(lanAddress, port), false);
  } finally {
    await stopServer(child);
  }
});

test('BABEL_LISTEN_HOST opens a local runtime to other interfaces', { skip }, async () => {
  const { child, port } = await startServer({ BABEL_LISTEN_HOST: '0.0.0.0' });
  try {
    assert.equal(await canConnect(lanAddress, port), true);
  } finally {
    await stopServer(child);
  }
});
