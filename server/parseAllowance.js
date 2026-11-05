import { createHash } from 'node:crypto';

import { PARSE_TICKET_LIFETIME_MS } from './babelParser/parseTicket.js';

/**
 * Parse allowances: how many parses one visitor, and the whole site, may start
 * each UTC day, and how many requests of any kind one visitor may make each
 * minute. Public Babel starts at 5 parses per visitor and 100 in total a day
 * (Francis, 5 Nov 2026: "You can build it with 5 per visitor and 100 a day").
 *
 * The counts live in a counter store. One Express process can count in its
 * own memory. The hosted function runs as many short-lived instances that share
 * no memory, so it needs a shared store (Upstash Redis over its REST API); see
 * `readCounterStore`. A store that cannot answer refuses the parse: spend
 * stays bounded when counting fails.
 *
 * A parse that fails gives the visitor's parse back but not the site's: the
 * provider was paid either way, so the site total still bounds spend (Francis,
 * 5 Nov 2026: "a failed parse shouldn't count against a visitors 5").
 */

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
// Day keys outlive their day so a count near midnight is never cut short.
const DAY_KEY_SECONDS = 2 * 86_400;
const MINUTE_KEY_SECONDS = 120;
// A ticket's refund marker outlives every check that could still refund it.
const REFUND_MARKER_SECONDS = 2 * Math.ceil(PARSE_TICKET_LIFETIME_MS / 1000);

export const PUBLIC_PARSES_PER_VISITOR_PER_DAY = 5;
export const PUBLIC_PARSES_PER_DAY = 100;

export class AllowanceUnavailableError extends Error {}

/**
 * Counts in this process's memory. Keys expire on their own; at most `maxKeys`
 * are kept, and a new key beyond that evicts the oldest, so memory and the
 * work per request stay bounded.
 */
export const createMemoryCounterStore = ({ maxKeys = 50_000, now = Date.now } = {}) => {
  const counts = new Map();
  const current = (key, at) => { const entry = counts.get(key); return entry && entry.expiresAt > at ? entry : null; };
  // Synchronous, so a check and its change can never interleave with another request's.
  const add = (key, amount, ttlSeconds, at) => {
    const entry = current(key, at);
    counts.delete(key);
    if (counts.size >= maxKeys) counts.delete(counts.keys().next().value);
    const count = (entry?.count ?? 0) + amount;
    counts.set(key, { count, expiresAt: entry?.expiresAt ?? at + ttlSeconds * 1000 });
    return count;
  };
  return {
    shared: false,
    async add(key, amount, ttlSeconds) {
      return add(key, amount, ttlSeconds, now());
    },
    async takeWithin(keys, limits, ttlSeconds) {
      const at = now();
      const full = keys.findIndex((key, index) => limits[index] >= 0 && (current(key, at)?.count ?? 0) >= limits[index]);
      if (full >= 0) return full + 1;
      for (const key of keys) add(key, 1, ttlSeconds, at);
      return 0;
    },
    // 1 when one was given back, 0 when the count was already 0, -1 when the
    // once-key had already given one back. Synchronous, like `takeWithin`.
    async giveBack(key, onceKey, onceTtlSeconds) {
      const at = now();
      if (onceKey) {
        if (current(onceKey, at)) return -1;
        add(onceKey, 1, onceTtlSeconds, at);
      }
      const entry = current(key, at);
      if (!entry || entry.count <= 0) return 0;
      entry.count -= 1;
      return 1;
    },
    get size() { return counts.size; }
  };
};

// Adds to one key and gives a new key its expiry.
const ADD = `local count = redis.call('INCRBY', KEYS[1], ARGV[1])
if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return count`;

// Takes one from every key only when none is at its limit (a limit below 0 is
// not checked): 0 when taken, otherwise the 1-based place of the full key.
const TAKE_WITHIN = `for i, key in ipairs(KEYS) do
  local limit = tonumber(ARGV[i])
  if limit >= 0 and tonumber(redis.call('GET', key) or '0') >= limit then return i end
end
for _, key in ipairs(KEYS) do
  redis.call('INCR', key)
  if redis.call('TTL', key) < 0 then redis.call('EXPIRE', key, ARGV[#ARGV]) end
end
return 0`;

// Takes one from KEYS[1] without going below 0, keeping its expiry. With a
// second key, does so only the first time that key is set: 1 when given back,
// 0 when the count was already 0, -1 when the second key was already set.
const GIVE_BACK = `if #KEYS > 1 and not redis.call('SET', KEYS[2], '1', 'NX', 'EX', ARGV[1]) then return -1 end
if tonumber(redis.call('GET', KEYS[1]) or '0') <= 0 then return 0 end
redis.call('DECR', KEYS[1])
return 1`;

/**
 * Counts in Upstash Redis through its REST API. Each change is one atomic
 * operation, so concurrent instances never lose a count and a failure leaves
 * every count as it was.
 */
export const createRedisRestCounterStore = ({ url, token, fetchImpl = globalThis.fetch, timeoutMs = 3000 }) => {
  const send = async (path, command) => {
    let response;
    try {
      response = await fetchImpl(`${String(url).replace(/\/+$/, '')}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      throw new AllowanceUnavailableError(`The counter store did not answer: ${error?.name || 'error'}.`);
    }
    if (!response.ok) throw new AllowanceUnavailableError(`The counter store answered HTTP ${response.status}.`);
    try {
      return await response.json();
    } catch {
      throw new AllowanceUnavailableError('The counter store answered without JSON.');
    }
  };
  const integer = value => {
    if (!Number.isSafeInteger(value)) throw new AllowanceUnavailableError('The counter store answered without a count.');
    return value;
  };
  return {
    shared: true,
    async add(key, amount, ttlSeconds) {
      const answer = await send('', ['EVAL', ADD, '1', key, String(amount), String(ttlSeconds)]);
      return integer(answer?.result);
    },
    async takeWithin(keys, limits, ttlSeconds) {
      const answer = await send('', ['EVAL', TAKE_WITHIN, String(keys.length), ...keys, ...limits.map(String), String(ttlSeconds)]);
      return integer(answer?.result);
    },
    async giveBack(key, onceKey, onceTtlSeconds) {
      const keys = onceKey ? [key, onceKey] : [key];
      const answer = await send('', ['EVAL', GIVE_BACK, String(keys.length), ...keys, String(onceTtlSeconds ?? 0)]);
      return integer(answer?.result);
    }
  };
};

/**
 * The shared store named in the environment, or null. The Vercel marketplace's
 * Upstash integration and Upstash itself name the REST endpoint differently;
 * either pair works.
 */
export const readCounterStore = (env, options = {}) => {
  const url = String(env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '').trim();
  const token = String(env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '').trim();
  return url && token ? createRedisRestCounterStore({ url, token, ...options }) : null;
};

/**
 * One visitor's key. An IPv6 visitor is one /64 network, which a single
 * connection usually owns, so cycling addresses inside it earns nothing. The
 * address is hashed so the store never holds it.
 */
export const visitorKey = (address) => {
  const raw = String(address || 'unknown').trim().toLowerCase().replace(/^::ffff:(?=\d+\.)/, '');
  let visitor = raw;
  if (raw.includes(':')) {
    const [head, tail = ''] = raw.split('::');
    const left = head ? head.split(':') : [];
    const right = raw.includes('::') && tail ? tail.split(':') : [];
    const groups = raw.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
    visitor = `${groups.slice(0, 4).map(group => group.replace(/^0+(?=.)/, '')).join(':')}::/64`;
  }
  return createHash('sha256').update(`babel-visitor-v1:${visitor}`).digest('hex').slice(0, 32);
};

const refusal = (status, code, message) => ({ ok: false, status, body: { error: { code, message } } });

/**
 * Limits a request against the allowances. `perVisitorPerDay` and `totalPerDay`
 * count parses (starts and long requests); `perVisitorPerMinute` counts every
 * request, ticket checks included. A limit of Infinity is not counted.
 */
export const createParseAllowance = ({ store, perVisitorPerDay, totalPerDay = Infinity, perVisitorPerMinute = Infinity, now = Date.now }) => {
  const day = () => Math.floor(now() / DAY_MS);
  const counted = limit => Number.isFinite(limit);
  const unavailable = () => refusal(503, 'LIMITS_UNAVAILABLE', 'Babel cannot start a parse right now. Please try again in a few minutes.');

  return {
    /** Every request: the per-minute limit. A store failure lets the request through; a check spends nothing. */
    async admitRequest(address) {
      if (!counted(perVisitorPerMinute)) return { ok: true };
      try {
        const count = await store.add(`babel:minute:${Math.floor(now() / MINUTE_MS)}:${visitorKey(address)}`, 1, MINUTE_KEY_SECONDS);
        if (count > perVisitorPerMinute) return refusal(429, 'RATE_LIMITED', 'Too many parse requests. Please retry shortly.');
      } catch (error) {
        if (!(error instanceof AllowanceUnavailableError)) throw error;
      }
      return { ok: true };
    },

    /**
     * A parse: uses one of the visitor's and one of the site's parses for
     * today in one atomic step, or neither, so no refusal or store failure
     * ever spends an allowance.
     */
    async admitParse(address) {
      const today = day();
      const keys = [`babel:parses:${today}:${visitorKey(address)}`, `babel:parses:${today}:all`];
      const limits = [perVisitorPerDay, totalPerDay].map(limit => (counted(limit) ? limit : -1));
      let full;
      try {
        full = await store.takeWithin(keys, limits, DAY_KEY_SECONDS);
      } catch (error) {
        if (!(error instanceof AllowanceUnavailableError)) throw error;
        return unavailable();
      }
      if (full === 1) return refusal(429, 'RATE_LIMITED_DAILY', `You have used today's ${perVisitorPerDay} parses. Your Tree Bank keeps them; please come back tomorrow.`);
      if (full === 2) return refusal(429, 'DAILY_CAPACITY_REACHED', 'Babel has made all the parses it can today. Please come back tomorrow.');
      if (full !== 0) return unavailable();
      return { ok: true };
    },

    /**
     * A failed parse: gives back one of the visitor's parses for today, never
     * below 0, and leaves the site total alone. `onceKey` (a ticket) gives
     * back at most once, however often its failure is checked. Never throws,
     * so a failure response is always sent as it was: 'refunded', 'none'
     * (nothing to give back), 'already' (the once-key gave one back) or
     * 'unavailable' (the store failed; the caller logs it).
     *
     * Today's count is the one given back. A parse admitted just before
     * midnight that fails after it gives back one of tomorrow's, so a visitor
     * can make one extra parse that day; the site total still holds.
     */
    async refundParse(address, { onceKey } = {}) {
      const key = `babel:parses:${day()}:${visitorKey(address)}`;
      const marker = onceKey ? `babel:refunded:${createHash('sha256').update(String(onceKey)).digest('hex')}` : undefined;
      let given;
      try {
        given = await store.giveBack(key, marker, REFUND_MARKER_SECONDS);
      } catch {
        return 'unavailable';
      }
      return given === 1 ? 'refunded' : given === -1 ? 'already' : given === 0 ? 'none' : 'unavailable';
    }
  };
};

const toLimit = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * The allowances a server applies. A deployed server defaults to public
 * Babel's; a local runtime, which serves Francis's internal app, keeps the
 * earlier loose per-visitor count and no site-wide one.
 */
export const readParseAllowanceLimits = (env, { deployed }) => ({
  perVisitorPerDay: toLimit(env.BABEL_PARSE_DAILY_LIMIT_PER_IP, deployed ? PUBLIC_PARSES_PER_VISITOR_PER_DAY : 1200),
  totalPerDay: toLimit(env.BABEL_PARSE_DAILY_LIMIT_TOTAL, deployed ? PUBLIC_PARSES_PER_DAY : Infinity),
  perVisitorPerMinute: toLimit(env.BABEL_PARSE_RATE_LIMIT_PER_MINUTE, 30)
});
