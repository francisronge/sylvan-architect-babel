import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AllowanceUnavailableError,
  createMemoryCounterStore,
  createParseAllowance,
  createRedisRestCounterStore,
  readCounterStore,
  readParseAllowanceLimits,
  visitorKey
} from '../server/parseAllowance.js';

const DAY = 86_400_000;

test('a visitor gets their daily parses, the site its daily total, and a new day starts both again', async () => {
  let clock = Date.UTC(2026, 10, 5, 12);
  const now = () => clock;
  const allowance = createParseAllowance({ store: createMemoryCounterStore({ now }), perVisitorPerDay: 5, totalPerDay: 7, now });
  for (let parse = 0; parse < 5; parse++) assert.equal((await allowance.admitParse('203.0.113.1')).ok, true);
  const sixth = await allowance.admitParse('203.0.113.1');
  assert.equal(sixth.status, 429);
  assert.equal(sixth.body.error.code, 'RATE_LIMITED_DAILY');
  assert.match(sixth.body.error.message, /today's 5 parses/);
  // The refused sixth used nothing: the site still has two parses left.
  assert.equal((await allowance.admitParse('203.0.113.2')).ok, true);
  assert.equal((await allowance.admitParse('203.0.113.3')).ok, true);
  const full = await allowance.admitParse('203.0.113.4');
  assert.equal(full.body.error.code, 'DAILY_CAPACITY_REACHED');
  clock += DAY;
  for (let parse = 0; parse < 5; parse++) assert.equal((await allowance.admitParse('203.0.113.4')).ok, true, `parse ${parse + 1} tomorrow`);
});

test('a refused parse gives back what it took, so the site total is never used up by refusals', async () => {
  const store = createMemoryCounterStore();
  const allowance = createParseAllowance({ store, perVisitorPerDay: 1, totalPerDay: 1 });
  assert.equal((await allowance.admitParse('198.51.100.1')).ok, true);
  for (let attempt = 0; attempt < 10; attempt++) await allowance.admitParse('198.51.100.2');
  // The second visitor was refused by the total each time and holds nothing.
  const lenient = createParseAllowance({ store, perVisitorPerDay: 1, totalPerDay: 2 });
  assert.equal((await lenient.admitParse('198.51.100.2')).ok, true);
});

test('the per-minute limit counts every request and resets each minute', async () => {
  let clock = Date.UTC(2026, 10, 5, 12);
  const now = () => clock;
  const allowance = createParseAllowance({ store: createMemoryCounterStore({ now }), perVisitorPerDay: 5, perVisitorPerMinute: 3, now });
  for (let request = 0; request < 3; request++) assert.equal((await allowance.admitRequest('203.0.113.9')).ok, true);
  assert.equal((await allowance.admitRequest('203.0.113.9')).body.error.code, 'RATE_LIMITED');
  assert.equal((await allowance.admitRequest('203.0.113.10')).ok, true, 'another visitor has their own minute');
  clock += 60_000;
  assert.equal((await allowance.admitRequest('203.0.113.9')).ok, true);
});

test('a store that cannot count refuses parses but lets requests through', async () => {
  const down = async () => { throw new AllowanceUnavailableError('down'); };
  const broken = { shared: true, add: down, takeWithin: down };
  const allowance = createParseAllowance({ store: broken, perVisitorPerDay: 5, totalPerDay: 100, perVisitorPerMinute: 30 });
  const refused = await allowance.admitParse('203.0.113.1');
  assert.equal(refused.status, 503);
  assert.equal(refused.body.error.code, 'LIMITS_UNAVAILABLE');
  assert.equal((await allowance.admitRequest('203.0.113.1')).ok, true, 'a check spends nothing, so it is not refused');
});

test('an IPv6 visitor is their /64 network, and the store never sees an address', () => {
  assert.equal(visitorKey('2001:db8:1:2:aaaa::1'), visitorKey('2001:0db8:0001:0002:ffff:eeee:dddd:cccc'));
  assert.equal(visitorKey('2001:db8::1'), visitorKey('2001:db8:0:0:9::9'));
  assert.notEqual(visitorKey('2001:db8:1:2::1'), visitorKey('2001:db8:1:3::1'));
  assert.equal(visitorKey('::ffff:203.0.113.5'), visitorKey('203.0.113.5'));
  assert.notEqual(visitorKey('203.0.113.5'), visitorKey('203.0.113.6'));
  assert.match(visitorKey('203.0.113.5'), /^[a-f0-9]{32}$/);
  assert.doesNotMatch(visitorKey('203.0.113.5'), /203/);
});

test('the memory store keeps a bounded number of keys', async () => {
  const store = createMemoryCounterStore({ maxKeys: 100 });
  for (let key = 0; key < 5000; key++) await store.add(`k${key}`, 1, 60);
  assert.equal(store.size, 100);
  assert.equal(await store.add('k4999', 1, 60), 2, 'recent keys are kept');
  assert.equal(await store.add('k0', 1, 60), 1, 'the oldest were evicted');
});

test('the Redis store counts in one atomic script and reports a store that cannot answer', async () => {
  const sent = [];
  const store = createRedisRestCounterStore({
    url: 'https://redis.example/', token: 'secret',
    fetchImpl: async (url, options) => {
      sent.push({ url, auth: options.headers.Authorization, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ result: 4 }), { status: 200 });
    }
  });
  assert.equal(await store.add('babel:minute:1:x', 1, 120), 4);
  const [{ url, auth, body: [command, script, ...rest] }] = sent;
  assert.deepEqual({ url, auth, command }, { url: 'https://redis.example', auth: 'Bearer secret', command: 'EVAL' });
  assert.match(script, /INCRBY[\s\S]*TTL[\s\S]*EXPIRE/);
  assert.deepEqual(rest, ['1', 'babel:minute:1:x', '1', '120']);
  for (const fetchImpl of [
    async () => { throw new TypeError('fetch failed'); },
    async () => new Response('nope', { status: 500 }),
    async () => new Response('not json', { status: 200 }),
    async () => new Response(JSON.stringify({ error: 'WRONGPASS' }), { status: 200 })
  ]) {
    await assert.rejects(createRedisRestCounterStore({ url: 'https://redis.example', token: 't', fetchImpl }).add('k', 1, 60), AllowanceUnavailableError);
  }
});

test('the shared store is read from either pair of names, and deployed servers default to public limits', () => {
  assert.equal(readCounterStore({}), null);
  assert.equal(readCounterStore({ UPSTASH_REDIS_REST_URL: 'https://r', UPSTASH_REDIS_REST_TOKEN: 't' }).shared, true);
  assert.equal(readCounterStore({ KV_REST_API_URL: 'https://r', KV_REST_API_TOKEN: 't' }).shared, true);
  assert.equal(readCounterStore({ KV_REST_API_URL: 'https://r' }), null, 'a URL without its token is no store');
  assert.deepEqual(readParseAllowanceLimits({}, { deployed: true }), { perVisitorPerDay: 5, totalPerDay: 100, perVisitorPerMinute: 30 });
  assert.deepEqual(readParseAllowanceLimits({}, { deployed: false }), { perVisitorPerDay: 1200, totalPerDay: Infinity, perVisitorPerMinute: 30 });
  assert.deepEqual(readParseAllowanceLimits({ BABEL_PARSE_DAILY_LIMIT_PER_IP: '3', BABEL_PARSE_DAILY_LIMIT_TOTAL: '50' }, { deployed: true }),
    { perVisitorPerDay: 3, totalPerDay: 50, perVisitorPerMinute: 30 });
});

test('a failed admission spends nothing, so a visitor keeps every parse after the store recovers', async () => {
  const memory = createMemoryCounterStore();
  let failures = 5;
  const flaky = { ...memory, add: memory.add, takeWithin: async (...args) => {
    if (failures > 0) { failures--; throw new AllowanceUnavailableError('down'); }
    return memory.takeWithin(...args);
  } };
  const allowance = createParseAllowance({ store: flaky, perVisitorPerDay: 5, totalPerDay: 100 });
  for (let attempt = 0; attempt < 5; attempt++) assert.equal((await allowance.admitParse('203.0.113.1')).body.error.code, 'LIMITS_UNAVAILABLE');
  for (let parse = 0; parse < 5; parse++) assert.equal((await allowance.admitParse('203.0.113.1')).ok, true, `parse ${parse + 1} after recovery`);
});

test('parses admitted at the same moment never pass the limits', async () => {
  const allowance = createParseAllowance({ store: createMemoryCounterStore(), perVisitorPerDay: 5, totalPerDay: 8 });
  const results = await Promise.all(Array.from({ length: 20 }, (_, n) => allowance.admitParse(`203.0.113.${n % 2}`)));
  assert.equal(results.filter(result => result.ok).length, 8);
});

test('the Redis store admits a parse in one script that checks every limit before counting', async () => {
  const sent = [];
  const store = createRedisRestCounterStore({ url: 'https://redis.example', token: 'secret', fetchImpl: async (url, options) => {
    sent.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ result: 2 }), { status: 200 });
  } });
  assert.equal(await store.takeWithin(['v', 'all'], [5, 100], 172800), 2);
  const [{ url, body: [command, script, keyCount, ...rest] }] = sent;
  assert.equal(url, 'https://redis.example');
  assert.equal(command, 'EVAL');
  assert.match(script, /GET[\s\S]*return i[\s\S]*INCR[\s\S]*EXPIRE/, 'checks every key before changing any');
  assert.deepEqual([keyCount, ...rest], ['2', 'v', 'all', '5', '100', '172800']);
});
