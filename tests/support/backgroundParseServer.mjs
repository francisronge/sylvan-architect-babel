import assert from 'node:assert/strict';
import { Server } from 'node:http';

let replies = [];
let server;
const listen = Server.prototype.listen;
// Keep the real public HTTP middleware and handler; expose only the ephemeral
// test port and shutdown receipt. Every outgoing request is intercepted below.
Server.prototype.listen = function (...args) {
  server = this;
  this.once('listening', () => process.send({ type: 'ready', port: this.address().port }));
  this.once('error', error => { console.error(error); process.exitCode = 1; process.disconnect(); });
  return listen.apply(this, args);
};
globalThis.fetch = async (url, options) => {
  const reply = replies.shift();
  if (!reply) process.send({ type: 'unexpected-provider-call', url: String(url), method: options.method });
  assert.ok(reply, 'No provider call is permitted beyond the scripted response sequence');
  assert.equal(String(url), reply.url);
  assert.equal(options.method, reply.method);
  const request = options.body ? JSON.parse(options.body) : undefined;
  process.send({ type: 'provider-call', url: String(url), method: options.method, request });
  if (reply.waitForAbort) {
    await new Promise((_, reject) => {
      const abort = () => {
        process.send({ type: 'provider-aborted', url: String(url) });
        reject(options.signal.reason);
      };
      if (options.signal.aborted) abort();
      else options.signal.addEventListener('abort', abort, { once: true });
    });
  }
  if (reply.waitInBody) {
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{'));
        const abort = () => {
          process.send({ type: 'provider-aborted', url: String(url) });
          controller.error(options.signal.reason);
        };
        if (options.signal.aborted) abort();
        else options.signal.addEventListener('abort', abort, { once: true });
      }
    }));
  }
  return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
};
process.on('message', message => {
  if (message.type === 'replies') {
    assert.equal(replies.length, 0, 'The previous public request must consume its whole script');
    replies = message.replies;
    process.send({ type: 'configured' });
  } else if (message.type === 'stop') {
    server.close(() => process.disconnect());
    server.closeAllConnections();
  }
});
if (process.env.BABEL_TEST_SERVERLESS_ENTRY === '1') {
  const { default: express } = await import('express');
  const { default: handler } = await import('../../api/parse.js');
  const app = express();
  app.use(express.json());
  app.post('/api/parse', handler);
  app.listen(0, '127.0.0.1');
} else {
  await import('../../server/index.js');
}
