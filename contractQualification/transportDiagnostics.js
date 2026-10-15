import fs from 'node:fs';
import path from 'node:path';
import { channel } from 'node:diagnostics_channel';
import { qualificationTransportError } from './telemetry.js';

// A request-local journal survives a killed runner. It records transport metadata,
// never request headers, bodies, credentials, arbitrary errors or SSE text.
export const createTransportDiagnostics = ({ directory, endpoint, client, snapshot,
  now = () => performance.now(), clock = () => new Date().toISOString() }) => {
  const file = path.join(directory, 'transport-diagnostics.ndjson');
  const started = now(), target = new URL(endpoint), subscriptions = [], requests = new WeakSet();
  let lastCheckpoint = started, result = null, disposed = false;
  const append = (type, details = {}) => {
    fs.appendFileSync(file, `${JSON.stringify({ at: clock(), elapsedMs: Math.round(now() - started), type, ...details })}\n`,
      { mode: 0o600 });
  };
  const checkpoint = type => {
    const trace = snapshot();
    append(type, { receivedBytes: trace.receivedBytes, chunkCount: trace.chunkCount,
      eventCount: trace.eventCount, lastByteAtMs: trace.lastByteAtMs,
      lastEvent: trace.events.at(-1) ?? null, eventTail: trace.events.slice(-12),
      rssBytes: process.memoryUsage().rss });
    lastCheckpoint = now();
  };
  const subscribe = (name, handler) => {
    const c = channel(name);
    c.subscribe(handler);
    subscriptions.push(() => c.unsubscribe(handler));
  };
  const ownsConnection = params => params?.hostname === target.hostname || params?.host === target.host;
  for (const [name, type] of [['beforeConnect', 'connect-start'], ['connected', 'connect-ready'], ['connectError', 'connect-error']]) {
    subscribe(`undici:client:${name}`, event => {
      if (!ownsConnection(event.connectParams)) return;
      const socket = event.socket;
      append(type, { ...qualificationTransportError(event.error),
        ...(socket ? { socket: {
          encrypted: Boolean(socket.encrypted), remoteFamily: socket.remoteFamily ?? null,
          alpnProtocol: socket.alpnProtocol || null, tlsProtocol: socket.getProtocol?.() ?? null,
          bytesRead: socket.bytesRead, bytesWritten: socket.bytesWritten,
          authorized: socket.encrypted ? Boolean(socket.authorized) : null
        } } : {}) });
    });
  }
  subscribe('undici:request:create', ({ request }) => {
    if (String(request.origin) !== target.origin || request.path !== target.pathname) return;
    requests.add(request);
    append('request-created');
  });
  for (const [name, type] of [['bodySent', 'request-body-sent'], ['trailers', 'http-body-complete'], ['error', 'request-error']]) {
    subscribe(`undici:request:${name}`, ({ request, error }) => {
      if (requests.has(request)) append(type, qualificationTransportError(error));
    });
  }
  const uncaught = error => append('uncaught-exception', qualificationTransportError(error));
  const exiting = code => { if (!disposed) { checkpoint('process-exit'); append('exit-status', { code, transportStatus: result }); } };
  process.on('uncaughtExceptionMonitor', uncaught);
  process.on('exit', exiting);
  append('diagnostics-start', { schemaVersion: 1, endpoint: target.origin + target.pathname, client,
    proxyEnvironmentPresent: ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY'].some(k => Boolean(process.env[k])),
    proxyPolicy: 'dedicated Undici Agent; no environment proxy agent',
    processId: process.pid });
  checkpoint('request-checkpoint');
  const heartbeat = setInterval(() => checkpoint('heartbeat'), 5000);
  heartbeat.unref();
  return {
    observe() { if (now() - lastCheckpoint >= 5000) checkpoint('stream-checkpoint'); },
    connection(type, error) { append(`dispatcher-${type}`, qualificationTransportError(error)); },
    headers(headers) { append('response-headers', headers); },
    lifecycle(event) {
      append(event.type, event);
      if (event.type === 'transport-result') { result = event.status; checkpoint('transport-checkpoint'); }
    },
    signal(signal) { append('process-signal', { signal }); checkpoint('signal-checkpoint'); },
    close() {
      if (disposed) return;
      disposed = true;
      clearInterval(heartbeat);
      subscriptions.forEach(unsubscribe => unsubscribe());
      process.removeListener('uncaughtExceptionMonitor', uncaught);
      process.removeListener('exit', exiting);
      checkpoint('diagnostics-final');
      append('diagnostics-close', { transportStatus: result });
    }
  };
};
