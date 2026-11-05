import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { readArchiveStore, signRequest } from '../server/archiveStore.js';
import { ARCHIVE_BYTES_KEY, createGenerationArchive } from '../server/generationArchive.js';
import { createMemoryCounterStore } from '../server/parseAllowance.js';

// The Generation Archive (ROADMAP, Program 6A) keeps every parse public
// Babel's hosted function finishes, without anything that names the visitor
// (PRIVACY.md), and never past the bucket's free tier (Francis, 5 Nov 2026:
// "I don't want to spend any real money on this").

test('requests are signed exactly as AWS Signature Version 4 specifies', () => {
  // AWS's published example: GET Object with a Range header.
  const headers = signRequest({
    method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', headers: { range: 'bytes=0-9' },
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1', now: new Date('2013-05-24T00:00:00Z')
  });
  assert.equal(headers.authorization, 'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, '
    + 'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});

test('only a deployment that names every archive setting archives, and a record is never replaced', async () => {
  const env = { BABEL_ARCHIVE_R2_ENDPOINT: 'https://account.r2.example', BABEL_ARCHIVE_R2_BUCKET: 'archive',
    BABEL_ARCHIVE_R2_ACCESS_KEY_ID: 'id', BABEL_ARCHIVE_R2_SECRET_ACCESS_KEY: 'secret' };
  for (const name of Object.keys(env)) assert.equal(readArchiveStore({ ...env, [name]: '' }), null, name);
  const calls = [];
  const store = readArchiveStore(env, { fetchImpl: async (url, options) => { calls.push({ url, options }); return new Response('', { status: 200 }); } });
  await store.put('parses/2026-11-05/resp_1.json.gz', Buffer.from('x'), 'application/gzip');
  assert.equal(calls[0].url, 'https://account.r2.example/archive/parses/2026-11-05/resp_1.json.gz');
  assert.equal(calls[0].options.method, 'PUT');
  assert.equal(calls[0].options.headers['if-none-match'], '*');
  assert.match(calls[0].options.headers.authorization, /^AWS4-HMAC-SHA256 Credential=id\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;if-none-match;/);
  const refusing = readArchiveStore(env, { fetchImpl: async () => new Response('', { status: 412 }) });
  await assert.rejects(refusing.put('k', 'x'), /HTTP 412/);
});

const request = { sentence: 'Mia laughed.', framework: 'minimalism', modelId: 'openai:gpt-6.1-sol', settings: { 'reasoning.effort': 'high' } };
const memoryBucket = () => {
  const objects = new Map();
  return { objects, async put(key, body) { if (objects.has(key)) throw new Error('Archive store refused the record (HTTP 412).'); objects.set(key, body); } };
};

test('the archive stops at its cap and gives back what it did not store, so it never grows into billed storage', async () => {
  const counter = createMemoryCounterStore();
  const bucket = memoryBucket();
  const logs = [];
  const archive = createGenerationArchive({ store: bucket, counter, capBytes: 400, log: line => logs.push(line), newId: (() => { let n = 0; return () => `id-${++n}`; })() });
  const outcome = { response: { analyses: [{ derivationStages: [] }] } };
  assert.equal(await archive.record({ request, outcome }), 'archived');
  const stored = await counter.add(ARCHIVE_BYTES_KEY, 0, 1);
  assert.ok(stored > 0 && stored <= 400);
  // A record that would pass the cap is not stored, and its bytes are not counted.
  const big = { response: { analyses: [{ derivationStages: [], note: randomBytes(3000).toString('base64') }] } };
  assert.equal(await archive.record({ request, outcome: big }), 'full');
  assert.equal(await counter.add(ARCHIVE_BYTES_KEY, 0, 1), stored);
  assert.equal(bucket.objects.size, 1);
  assert.match(logs.join('\n'), /FULL/);
});

test('the archive never breaks a parse: a failing bucket or a missing counter only skips the record', async () => {
  const counter = createMemoryCounterStore();
  const logs = [];
  const broken = createGenerationArchive({ store: { put: async () => { throw new Error('network down'); } }, counter, log: line => logs.push(line) });
  assert.equal(await broken.record({ request, outcome: { failure: { code: 'PROVIDER_TIMEOUT' } } }), 'failed');
  assert.equal(await counter.add(ARCHIVE_BYTES_KEY, 0, 1), 0, 'bytes that were not stored are not counted');
  const uncounted = createGenerationArchive({ store: memoryBucket(), counter: null, log: line => logs.push(line) });
  assert.equal(await uncounted.record({ request, outcome: { failure: { code: 'PROVIDER_TIMEOUT' } } }), 'unavailable');
  // One generation is one record: a finished parse checked twice keeps its first.
  const bucket = memoryBucket();
  const archive = createGenerationArchive({ store: bucket, counter, log: () => {} });
  const first = await archive.record({ request, outcome: { response: { analyses: [] } }, responseId: 'resp_9', startedAt: Date.parse('2026-11-05T23:59:00Z') });
  const again = await archive.record({ request, outcome: { response: { analyses: [] } }, responseId: 'resp_9', startedAt: Date.parse('2026-11-05T23:59:00Z') });
  assert.deepEqual([first, again], ['archived', 'already']);
  assert.deepEqual([...bucket.objects.keys()], ['parses/2026-11-05/resp_9.json.gz']);
});

const endpoint = 'https://api.openai.com/v1/responses';
const ARCHIVE = 'https://account.r2.example';
const leaf = (id, word) => ({ id, label: word, word, children: [] });
const analysis = (...words) => ({ derivationStages: [{
  statement: 'The clause is complete.', stageRecord: 'Every word is in place.', relations: [],
  workspaceForest: [{ id: 's', label: 'S', children: words.map((word, i) => leaf(`w${i}`, word)) }]
}] });
const completed = (id, payload) => ({ id, status: 'completed', model: 'gpt-6.1-sol',
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }],
  usage: { input_tokens: 11, output_tokens: 22, total_tokens: 33 } });

test('the hosted function archives each finished parse, success or failure, with nothing that names the visitor', { timeout: 30000 }, async t => {
  const VISITOR = '198.51.100.23';
  const child = fork(new URL('./support/backgroundParseServer.mjs', import.meta.url), [], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env, NODE_ENV: 'production', PORT: '0', OPENAI_API_KEY: 'test-only-provider-key',
      BABEL_SAVE_PROVIDER_RAW: '0', BABEL_REQUIRE_ORIGIN: '0', BABEL_ALLOW_NO_ORIGIN: '1', BABEL_PARSE_API_TOKEN: '',
      BABEL_TRUST_PROXY: '0', BABEL_ALLOWED_ORIGINS: '', BABEL_PUBLIC_REQUEST_ONLY: '',
      BABEL_PARSE_DAILY_LIMIT_PER_IP: '3', BABEL_TEST_SERVERLESS_ENTRY: '1',
      BABEL_ARCHIVE_R2_ENDPOINT: ARCHIVE, BABEL_ARCHIVE_R2_BUCKET: 'babel-generation-archive',
      BABEL_ARCHIVE_R2_ACCESS_KEY_ID: 'test-key-id', BABEL_ARCHIVE_R2_SECRET_ACCESS_KEY: 'test-secret', VERCEL_GIT_COMMIT_SHA: 'abc123'
    }
  });
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const puts = [];
  child.on('message', message => { if (message.type === 'archive-put') puts.push(message); });
  const message = type => new Promise((resolve, reject) => {
    const onMessage = result => { if (result.type === type) { child.off('message', onMessage); resolve(result); } };
    child.on('message', onMessage);
    child.once('exit', () => reject(new Error(`Server exited before ${type}: ${output}`)));
  });
  const { port } = await message('ready');
  const script = async replies => { const configured = message('configured'); child.send({ type: 'replies', replies }); await configured; };
  const post = async body => {
    const response = await fetch(`http://127.0.0.1:${port}/api/parse`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': VISITOR }, body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  };
  const record = put => JSON.parse(gunzipSync(Buffer.from(put.body, 'base64')).toString('utf8'));

  // A successful parse: started, checked while pending (nothing archived), then finished.
  await script([{ url: endpoint, method: 'POST', body: { id: 'resp_ok', status: 'queued' } }]);
  const started = await post({ sentence: 'Mia laughed.', start: true });
  assert.equal(started.status, 200, output);
  await script([{ url: `${endpoint}/resp_ok`, method: 'GET', body: { id: 'resp_ok', status: 'in_progress' } }]);
  assert.equal((await post({ ticket: started.body.ticket })).body.status, 'pending');
  assert.equal(puts.length, 0, 'a start or a pending check archives nothing');
  await script([{ url: `${endpoint}/resp_ok`, method: 'GET', body: completed('resp_ok', analysis('Mia', 'laughed.')) }]);
  const finished = await post({ ticket: started.body.ticket });
  assert.equal(finished.status, 200, output);
  assert.equal(puts.length, 1, output);
  assert.match(puts[0].key, /^\/babel-generation-archive\/parses\/\d{4}-\d{2}-\d{2}\/resp_ok\.json\.gz$/);
  assert.equal(puts[0].headers['if-none-match'], '*');
  const parsed = record(puts[0]);
  assert.equal(parsed.outcome, 'parsed');
  assert.deepEqual(parsed.request, request, 'the public request, from the ticket this server signed');
  assert.deepEqual(parsed.response.analyses, finished.body.analyses, 'laid out as a saved batch: request and response');
  assert.equal(parsed.babel.commit, 'abc123');

  // The same finished ticket checked again keeps one record, and the student still gets their tree.
  await script([{ url: `${endpoint}/resp_ok`, method: 'GET', body: completed('resp_ok', analysis('Mia', 'laughed.')) }]);
  assert.equal((await post({ ticket: started.body.ticket })).status, 200);
  assert.equal(puts.length, 2);
  assert.equal(puts[1].refused, true);

  // A failed parse is archived with its typed failure and the model's whole output.
  await script([{ url: endpoint, method: 'POST', body: { id: 'resp_bad', status: 'queued' } }]);
  const second = await post({ sentence: 'Mia laughed.', start: true });
  await script([{ url: `${endpoint}/resp_bad`, method: 'GET', body: completed('resp_bad', analysis('laughed.', 'Mia')) }]);
  const failed = await post({ ticket: second.body.ticket });
  assert.equal(failed.status, 502, output);
  const failure = record(puts[2]);
  assert.equal(failure.outcome, 'failed');
  assert.equal(failure.failure.code, 'BAD_MODEL_RESPONSE');
  assert.equal(failure.failure.failure.ruleId, 'SPELLOUT_WORD_ORDER');
  assert.equal(Buffer.from(failure.failure.rawOutput.data, 'base64').toString('utf8'), JSON.stringify(analysis('laughed.', 'Mia')));

  // Nothing in any record names the visitor: no address, no ticket, no key.
  for (const put of puts) {
    const text = gunzipSync(Buffer.from(put.body, 'base64')).toString('utf8');
    for (const secret of [VISITOR, started.body.ticket, second.body.ticket, 'test-only-provider-key', 'test-secret']) {
      assert.ok(!text.includes(secret), `a record must not hold ${secret.slice(0, 12)}`);
    }
    assert.doesNotMatch(text, /"(?:ticket|address|ip|visitor)"/i);
  }

  // A refused request archives nothing: no parse was made.
  const before = puts.length;
  const refused = await post({ sentence: '', start: true });
  assert.equal(refused.status, 400);
  assert.equal(puts.length, before);
  child.send({ type: 'stop' });
});

test('the pull script lays the archive out as a saved batch the review page reads, and fetches only new records', async () => {
  const { mkdtempSync, existsSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { gzipSync } = await import('node:zlib');
  const { pullGenerationArchive } = await import('../scripts/pullGenerationArchive.mjs');
  const { resolveCase } = await import('../scripts/buildReplayComparison.mjs');
  const { buildArchiveRecord } = await import('../server/generationArchive.js');
  const records = {
    'parses/2026-11-05/resp_a.json.gz': buildArchiveRecord({ id: 'resp_a', archivedAt: 0, request, commit: 'c',
      outcome: { response: { analyses: [analysis('Mia', 'laughed.')], inputTokens: ['Mia', 'laughed', '.'] } } }),
    'parses/2026-11-05/resp_b.json.gz': buildArchiveRecord({ id: 'resp_b', archivedAt: 0, request, commit: 'c',
      outcome: { failure: { code: 'PROVIDER_TIMEOUT' } } })
  };
  const keys = Object.keys(records);
  const bodies = Object.fromEntries(keys.map(key => [key, gzipSync(JSON.stringify(records[key]))]));
  const gets = [];
  const fetchImpl = async (url, options) => {
    assert.match(options.headers.authorization, /^AWS4-HMAC-SHA256 /);
    const { pathname, searchParams } = new URL(url);
    if (searchParams.get('list-type') === '2') {
      // Two pages, so the script must follow the continuation token.
      const page = searchParams.get('continuation-token') === 'next+page/2' ? [keys[1]] : [keys[0]];
      const more = page[0] === keys[0];
      return new Response(`<ListBucketResult>${page.map(key => `<Contents><Key>${key}</Key><Size>${bodies[key].length}</Size></Contents>`).join('')}`
        + `<IsTruncated>${more}</IsTruncated>${more ? '<NextContinuationToken>next+page/2</NextContinuationToken>' : ''}</ListBucketResult>`);
    }
    gets.push(pathname);
    return new Response(bodies[pathname.replace('/babel-generation-archive/', '')]);
  };
  const env = { BABEL_ARCHIVE_R2_ENDPOINT: ARCHIVE, BABEL_ARCHIVE_R2_BUCKET: 'babel-generation-archive',
    BABEL_ARCHIVE_R2_ACCESS_KEY_ID: 'id', BABEL_ARCHIVE_R2_SECRET_ACCESS_KEY: 'secret' };
  const out = mkdtempSync(path.join(tmpdir(), 'babel-archive-'));
  try {
    const summary = await pullGenerationArchive({ env, out, fetchImpl });
    assert.deepEqual({ ...summary, storedBytes: undefined }, { records: 2, downloaded: 2, parsed: 1, failed: 1, storedBytes: undefined, capBytes: 9_000_000_000 });
    assert.equal(summary.storedBytes, bodies[keys[0]].length + bodies[keys[1]].length);
    const bundle = path.join(out, 'runs', '2026-11-05_resp_a', 'attempts', 'parse', 'bundle.json');
    const review = resolveCase({ source: bundle, title: 'resp_a', watch: '-', steps: [1] }, { root: out });
    assert.equal(review.sentence, 'Mia laughed.');
    assert.equal(review.derivationStages.length, 1);
    assert.ok(existsSync(path.join(out, 'failed', '2026-11-05_resp_b.json')));
    const again = await pullGenerationArchive({ env, out, fetchImpl });
    assert.equal(again.downloaded, 0);
    assert.equal(gets.length, 2, 'records already downloaded are not fetched again');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
