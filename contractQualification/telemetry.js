// Preserve transport measurements separately from provider usage and billing.
// Header values are opt-in: unknown headers may contain account identifiers.
const safeHeader = /^(?:content-type|content-length|date|server|server-timing|connection|transfer-encoding|x-request-id|x-oai-request-id|cf-ray|openai-processing-ms|openai-version|retry-after|x-ratelimit-(?:limit|remaining|reset)-(?:requests|tokens)|x-codex-(?:primary|secondary)-(?:used-percent|reset-at|reset-after-seconds|window-minutes)|x-codex-credits-(?:has-credits|unlimited|balance)|x-codex-plan-type|cf-cache-status)$/u;

export const qualificationResponseHeaders = response => {
  const headers = {}, omittedHeaderNames = [];
  for (const [name, value] of response.headers) {
    if (safeHeader.test(name)) headers[name] = value;
    else omittedHeaderNames.push(name);
  }
  return { status: response.status, contentType: response.headers.get('content-type'),
    requestId: response.headers.get('x-request-id') ?? response.headers.get('x-oai-request-id'),
    headers, omittedHeaderNames };
};

const socketReasons = new Map([
  ['other side closed', 'peer_closed'], ['closed', 'socket_closed'],
  ['bad response', 'invalid_http_response'], ['bad upgrade', 'invalid_http_response'],
  ['destroyed', 'socket_destroyed']
]);
const errorReasons = new Map([
  ['ECONNRESET', 'connection_reset'], ['UND_ERR_BODY_TIMEOUT', 'body_timeout'],
  ['UND_ERR_HEADERS_TIMEOUT', 'headers_timeout'], ['UND_ERR_CONNECT_TIMEOUT', 'connect_timeout']
]);

// Keep only known classifications and counters. Error messages, stacks, addresses
// and request objects are never copied; fetch wraps the useful error in cause.
export const qualificationTransportError = error => {
  const seen = new Set(), codes = [];
  let reason = null, socket = null;
  for (let cause = error; cause && !seen.has(cause) && seen.size < 8; cause = cause.cause) {
    seen.add(cause);
    if (typeof cause.code === 'string' && /^(?:ERR_|UND_ERR_|E)[A-Z0-9_]{1,64}$/u.test(cause.code)) {
      if (!codes.includes(cause.code)) codes.push(cause.code);
      reason ??= cause.code === 'UND_ERR_SOCKET' ? socketReasons.get(cause.message) ?? null : errorReasons.get(cause.code) ?? null;
    }
    if (!socket && cause.socket) {
      const counters = Object.fromEntries(['bytesRead', 'bytesWritten', 'timeout'].flatMap(key =>
        Number.isFinite(cause.socket[key]) && cause.socket[key] >= 0 ? [[key, cause.socket[key]]] : []));
      if (Object.keys(counters).length) socket = counters;
    }
  }
  return { ...(codes.length ? { codes } : {}), ...(reason ? { reason } : {}), ...(socket ? { socket } : {}) };
};

export const createQualificationTelemetry = ({ now = () => performance.now() } = {}) => {
  const started = now(), chunks = [], events = [], connections = [];
  let headersAtMs = null;
  const elapsed = () => Math.round((now() - started) * 1000) / 1000;
  return {
    headers() { headersAtMs = elapsed(); },
    bytes(chunk) { chunks.push({ atMs: elapsed(), bytes: chunk.byteLength }); },
    connection(type, error) {
      if (['connect', 'disconnect', 'connectionError'].includes(type)) {
        connections.push({ atMs: elapsed(), type, ...qualificationTransportError(error) });
      }
    },
    event(event) {
      events.push({ atMs: elapsed(), type: event.type ?? null,
        ...(Number.isInteger(event.sequence_number) ? { sequenceNumber: event.sequence_number } : {}),
        ...(Number.isInteger(event.output_index) ? { outputIndex: event.output_index } : {}),
        ...(Number.isInteger(event.content_index) ? { contentIndex: event.content_index } : {}),
        ...(event.item?.type ? { itemType: event.item.type } : {}),
        ...(event.type === 'response.output_text.delta' ? { textBytes: Buffer.byteLength(event.delta ?? '', 'utf8') } : {}) });
    },
    snapshot() {
      const text = events.filter(e => e.type === 'response.output_text.delta' && e.textBytes > 0);
      const terminal = events.findLast(e => ['response.completed', 'response.done', 'response.incomplete', 'response.failed', 'error'].includes(e.type));
      const reasoning = events.find(e => e.itemType === 'reasoning' || e.type?.startsWith('response.reasoning'));
      return {
        schemaVersion: 2, clock: 'monotonic milliseconds since request start',
        elapsedMs: elapsed(), headersAtMs,
        firstByteAtMs: chunks[0]?.atMs ?? null,
        lastByteAtMs: chunks.at(-1)?.atMs ?? null,
        firstEventAtMs: events[0]?.atMs ?? null,
        firstReasoningEventAtMs: reasoning?.atMs ?? null,
        firstOutputTextAtMs: text[0]?.atMs ?? null,
        lastOutputTextAtMs: text.at(-1)?.atMs ?? null,
        terminalAtMs: terminal?.atMs ?? null,
        receivedBytes: chunks.reduce((sum, c) => sum + c.bytes, 0),
        chunkCount: chunks.length, eventCount: events.length,
        eventCounts: events.reduce((counts, e) => { const key = e.type ?? 'untyped'; counts[key] = (counts[key] ?? 0) + 1; return counts; }, {}),
        chunks, events, connections
      };
    }
  };
};
