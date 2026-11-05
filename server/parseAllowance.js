import { createHash } from 'node:crypto';

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
 */

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
// Day keys outlive their day so a count near midnight is never cut short.
const DAY_KEY_SECONDS = 2 * 86_400;
const MINUTE_KEY_SECONDS = 120;

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
  return {
    shared: false,
    async add(key, amount, ttlSeconds) {
      const at = now();
      const entry = counts.get(key);
      const current = entry && entry.expiresAt > at ? entry.count : 0;
      counts.delete(key);
      if (counts.size >= maxKeys) counts.delete(counts.keys().next().value);
      const count = current + amount;
      counts.set(key, { count, expiresAt: entry && entry.expiresAt > at ? entry.expiresAt : at + ttlSeconds * 1000 });
      return count;
    },
    get size() { return counts.size; }
  };
};

/**
 * Counts in Upstash Redis through its REST API. Each change is one atomic
 * transaction (INCRBY, then EXPIRE on a new key only), so concurrent instances
 * never lose a count.
 */
export const createRedisRestCounterStore = ({ url, token, fetchImpl = globalThis.fetch, timeoutMs = 3000 }) => ({
  shared: true,
  async add(key, amount, ttlSeconds) {
    let response;
    try {
      response = await fetchImpl(`${String(url).replace(/\/+$/, '')}/multi-exec`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([['INCRBY', key, String(amount)], ['EXPIRE', key, String(ttlSeconds), 'NX']]),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      throw new AllowanceUnavailableError(`The counter store did not answer: ${error?.name || 'error'}.`);
    }
    if (!response.ok) throw new AllowanceUnavailableError(`The counter store answered HTTP ${response.status}.`);
    let results;
    try {
      results = await response.json();
    } catch {
      throw new AllowanceUnavailableError('The counter store answered without JSON.');
    }
    const count = Array.isArray(results) ? results[0]?.result : undefined;
    if (!Number.isSafeInteger(count)) throw new AllowanceUnavailableError('The counter store answered without a count.');
    return count;
  }
});

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

    /** A parse: uses one of the visitor's and one of the site's parses for today, or neither. */
    async admitParse(address) {
      const today = day();
      const visitor = `babel:parses:${today}:${visitorKey(address)}`;
      const total = `babel:parses:${today}:all`;
      const taken = [];
      try {
        if (counted(perVisitorPerDay)) {
          taken.push(visitor);
          if (await store.add(visitor, 1, DAY_KEY_SECONDS) > perVisitorPerDay) {
            await store.add(visitor, -1, DAY_KEY_SECONDS);
            return refusal(429, 'RATE_LIMITED_DAILY', `You have used today's ${perVisitorPerDay} parses. Your Tree Bank keeps them; please come back tomorrow.`);
          }
        }
        if (counted(totalPerDay)) {
          taken.push(total);
          if (await store.add(total, 1, DAY_KEY_SECONDS) > totalPerDay) {
            await Promise.all(taken.map(key => store.add(key, -1, DAY_KEY_SECONDS)));
            return refusal(429, 'DAILY_CAPACITY_REACHED', 'Babel has made all the parses it can today. Please come back tomorrow.');
          }
        }
        return { ok: true };
      } catch (error) {
        if (!(error instanceof AllowanceUnavailableError)) throw error;
        return unavailable();
      }
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
