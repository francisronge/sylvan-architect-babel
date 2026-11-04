import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A parse ticket lets the browser check back for a background generation
 * instead of holding one request open while the model writes. It carries what
 * the check needs to finish the parse exactly as one long request would: the
 * request (sentence, framework, model and settings), the provider response
 * id, the run id, the start time and the hash of the body sent to the
 * provider. The server signs it, so a browser can read its own ticket but not
 * change one or make one; there is no server-side state between requests.
 *
 * The signing key is derived from the provider key that started the response,
 * so a ticket is valid only where that key is configured and rotating the key
 * retires every outstanding ticket.
 */
export const PARSE_TICKET_VERSION = 1;
// A check after this long cancels the response and reports a timeout.
export const PARSE_TICKET_LIFETIME_MS = 20 * 60 * 1000;

const signingKey = (providerKey) => createHmac('sha256', String(providerKey)).update('babel-parse-ticket-v1').digest();
const signature = (providerKey, body) => createHmac('sha256', signingKey(providerKey)).update(body).digest('base64url');

export const signParseTicket = (providerKey, fields) => {
  if (!providerKey) throw new Error('A parse ticket needs a provider key to sign it.');
  const body = Buffer.from(JSON.stringify({ v: PARSE_TICKET_VERSION, ...fields }), 'utf8').toString('base64url');
  return `${body}.${signature(providerKey, body)}`;
};

const FIELDS = {
  responseId: value => typeof value === 'string' && value.length > 0 && value.length <= 200,
  sentence: value => typeof value === 'string' && value.length > 0,
  framework: value => value === 'xbar' || value === 'minimalism',
  modelId: value => typeof value === 'string' && value.length > 0,
  settings: value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every(setting => typeof setting === 'string'),
  runId: value => typeof value === 'string' && value.length > 0,
  startedAt: value => Number.isSafeInteger(value) && value > 0,
  sentRequestSha256: value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
};

/** The ticket's fields when its signature holds and its shape is exact; otherwise null. */
export const readParseTicket = (providerKey, ticket) => {
  // Without a key anyone could sign; nothing verifies.
  if (!providerKey || typeof ticket !== 'string' || ticket.length > 8192) return null;
  const [body, mac, extra] = ticket.split('.');
  if (!body || !mac || extra !== undefined) return null;
  const expected = Buffer.from(signature(providerKey, body));
  const received = Buffer.from(mac);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  let fields;
  try {
    fields = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!fields || typeof fields !== 'object' || fields.v !== PARSE_TICKET_VERSION) return null;
  const { v: _version, ...rest } = fields;
  const names = Object.keys(rest);
  if (names.length !== Object.keys(FIELDS).length || !names.every(name => FIELDS[name]?.(rest[name]))) return null;
  return rest;
};
