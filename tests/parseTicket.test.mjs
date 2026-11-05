import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readParseTicket, signParseTicket } from '../server/babelParser/parseTicket.js';
import { restateAsSpellout } from './helpers/spelloutPayload.mjs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/raw/what-did-mia-see.xbar.json', import.meta.url), 'utf8'));
const rawOutput = JSON.stringify(restateAsSpellout(fixture.payload, fixture.sentence));
const endpoint = 'https://api.openai.com/v1/responses';
const decode = artifact => Buffer.from(artifact.data, 'base64').toString('utf8');
const request = { sentence: fixture.sentence, framework: fixture.framework, modelId: 'openai:gpt-6-astra', settings: { 'reasoning.effort': 'high' } };

const fields = {
  responseId: 'resp_1', sentence: 'Mia laughed.', framework: 'minimalism', modelId: 'openai:gpt-6-astra',
  settings: { 'reasoning.effort': 'high' }, runId: 'run-1', startedAt: 1_700_000_000_000, sentRequestSha256: 'a'.repeat(64)
};

test('a ticket reads back only with its key, unchanged and in its exact shape', () => {
  const ticket = signParseTicket('key-one', fields);
  assert.deepEqual(readParseTicket('key-one', ticket), fields);
  assert.equal(readParseTicket('key-two', ticket), null, 'another key never verifies it');
  assert.equal(readParseTicket('', ticket), null, 'no key verifies nothing');
  assert.throws(() => signParseTicket('', fields), /provider key/);
  const [body, mac] = ticket.split('.');
  const altered = Buffer.from(JSON.stringify({ v: 1, ...fields, sentence: 'Someone else.' })).toString('base64url');
  assert.equal(readParseTicket('key-one', `${altered}.${mac}`), null, 'a changed body fails its signature');
  assert.equal(readParseTicket('key-one', `${body}.${mac}.extra`), null);
  for (const bad of [{ ...fields, extra: 1 }, { ...fields, startedAt: 'now' }, { ...fields, sentRequestSha256: 'short' }]) {
    assert.equal(readParseTicket('key-one', signParseTicket('key-one', bad)), null, 'a signed ticket of the wrong shape is refused');
  }
  // A field name is one of the ticket's own; an inherited object member is not one and never runs.
  const { settings: _settings, ...noSettings } = fields;
  for (const name of ['constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(readParseTicket('key-one', signParseTicket('key-one', { ...noSettings, [name]: 1 })), null, `${name} is not a ticket field`);
  }
  const withProto = JSON.parse(`{${JSON.stringify(noSettings).slice(1, -1)},"__proto__":{}}`);
  assert.equal(readParseTicket('key-one', signParseTicket('key-one', withProto)), null, '__proto__ is not a ticket field');
  assert.equal(readParseTicket('key-one', 42), null);
});

test('public HTTP parse tickets start, check and finish as one request would, and never regenerate', { timeout: 60000 }, async t => {
  for (const serverless of [false, true]) await t.test(serverless ? 'api/parse.js' : 'server/index.js', async t => {
    const child = fork(new URL('./support/backgroundParseServer.mjs', import.meta.url), [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env, NODE_ENV: 'production', PORT: '0', OPENAI_API_KEY: 'test-only-provider-key',
        BABEL_SAVE_PROVIDER_RAW: '0', OPENAI_BACKGROUND_POLL_INTERVAL_MS: '1000', BABEL_REQUIRE_ORIGIN: '0', BABEL_ALLOW_NO_ORIGIN: '1', BABEL_PARSE_API_TOKEN: '',
        BABEL_TRUST_PROXY: '0', BABEL_MAX_IN_FLIGHT_PARSES: '1', BABEL_PARSE_DAILY_LIMIT_PER_IP: '5',
        BABEL_TEST_SERVERLESS_ENTRY: serverless ? '1' : '0', BABEL_ALLOWED_ORIGINS: ''
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
    const calls = [];
    child.on('message', message => { if (message.type === 'provider-call') calls.push(message); });
    const message = type => new Promise((resolve, reject) => {
      const onMessage = result => { if (result.type === type) { child.off('message', onMessage); resolve(result); } };
      child.on('message', onMessage);
      child.once('exit', () => reject(new Error(`Server exited before ${type}: ${output}`)));
    });
    const { port } = await message('ready');
    const script = async replies => { const configured = message('configured'); child.send({ type: 'replies', replies }); await configured; };
    const post = async body => {
      const response = await fetch(`http://127.0.0.1:${port}/api/parse`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      return { status: response.status, body: await response.json() };
    };
    const completed = id => ({ id, status: 'completed', model: 'gpt-6-astra',
      output: [{ type: 'message', content: [{ type: 'output_text', text: rawOutput }] }],
      usage: { input_tokens: 11, output_tokens: 22, total_tokens: 33 } });

    // Start: one creation, answered with a ticket.
    await script([{ url: endpoint, method: 'POST', body: { id: 'resp_a', status: 'queued' } }]);
    const started = await post({ ...request, start: true });
    assert.equal(started.status, 200, output);
    assert.equal(started.body.status, 'pending');
    assert.equal(typeof started.body.ticket, 'string');
    assert.equal(calls[0].request.background, true);
    assert.equal(calls[0].request.store, true);
    assert.doesNotMatch(JSON.stringify(started.body), /test-only-provider-key/);

    // Checks: each looks once and creates nothing.
    await script([{ url: `${endpoint}/resp_a`, method: 'GET', body: { id: 'resp_a', status: 'in_progress' } }]);
    const pending = await post({ ticket: started.body.ticket });
    assert.deepEqual(pending.body, { status: 'pending', ticket: started.body.ticket });
    await script([{ url: `${endpoint}/resp_a`, method: 'GET', body: completed('resp_a') }]);
    const finished = await post({ ticket: started.body.ticket });
    assert.equal(finished.status, 200, output);
    assert.equal(finished.body.sentence, fixture.sentence);
    assert.equal(decode(finished.body.rawModelOutput), rawOutput);
    assert.equal(decode(finished.body.generationRecord.rawProviderResponse), JSON.stringify(completed('resp_a')));
    assert.equal(finished.body.generationRecord.timing.completionObservedBy, 'parse-ticket-check');
    assert.equal(finished.body.generationRecord.outcome.attempts.length, 1);
    assert.equal(finished.body.generationRecord.outcome.attempts[0].outcome, 'completed');
    assert.deepEqual(calls.map(call => call.method), ['POST', 'GET', 'GET'], 'one creation, two looks');

    // The same response through one long request gives the same analyses and record contract.
    await script([
      { url: endpoint, method: 'POST', body: { id: 'resp_b', status: 'queued' } },
      { url: `${endpoint}/resp_b`, method: 'GET', body: completed('resp_b') }
    ]);
    const held = await post(request);
    assert.equal(held.status, 200, output);
    const untimed = analyses => analyses.map(({ provenance: { timestamp: _timestamp, ...provenance }, ...analysis }) => ({ ...analysis, provenance }));
    assert.deepEqual(untimed(finished.body.analyses), untimed(held.body.analyses));
    assert.equal(finished.body.generationRecord.sentRequestSha256, held.body.generationRecord.sentRequestSha256);
    assert.deepEqual(finished.body.generationRecord.promptContract, held.body.generationRecord.promptContract);

    // A response that ended badly fails its check and is never retried or recreated.
    for (const status of ['failed', 'cancelled', 'incomplete']) {
      const id = `resp_${status}`;
      await script([{ url: endpoint, method: 'POST', body: { id, status: 'queued' } }]);
      const { body: { ticket } } = await post({ ...request, start: true });
      await script([{ url: `${endpoint}/${id}`, method: 'GET', body: { id, status, model: 'gpt-6-astra', output: [],
        ...(status === 'incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } } : { error: { message: `Scripted ${status}` } }) } }]);
      const failed = await post({ ticket });
      assert.ok(failed.status >= 400 && failed.status !== 503, `${status}: ${JSON.stringify(failed.body)}`);
      assert.ok(JSON.stringify(failed.body).toLowerCase().includes(status));
      assert.equal(failed.body.analyses, undefined);
    }

    // A ticket that is not Babel's, or was changed, reaches no provider.
    const before = calls.length;
    const [body, mac] = started.body.ticket.split('.');
    const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), sentence: 'Changed.' })).toString('base64url');
    for (const ticket of ['nonsense', `${changed}.${mac}`]) {
      const refused = await post({ ticket });
      assert.equal(refused.status, 400);
      assert.equal(refused.body.error.code, 'INVALID_TICKET');
    }
    assert.equal((await post({ ticket: started.body.ticket, sentence: 'extra' })).status, 400, 'a check sends only its ticket');
    assert.equal(calls.length, before);

    if (!serverless) {
      // Checks use none of the daily allowance: five starts and long requests fill it; no check counted.
      await script([{ url: `${endpoint}/resp_a`, method: 'GET', body: { id: 'resp_a', status: 'in_progress' } }]);
      assert.equal((await post({ ticket: started.body.ticket })).status, 200);
      const exhausted = await post({ ...request, start: true });
      assert.equal(exhausted.body.error?.code, 'RATE_LIMITED_DAILY', 'the five starts and long requests used it up');
    }
    child.send({ type: 'stop' });
    await exited;
  });
});

test('a late or outdated ticket cancels its response and fails plainly, never regenerating', async () => {
  const { createParseRoutes } = await import('../server/babelParser/parseRoutes.js');
  const { ParseApiError } = await import('../server/babelParser/error.js');
  const { normalizeParseBundle } = await import('../server/babelParser/parseNormalization.js');
  const { parseModelJsonDetailed } = await import('../server/babelParser/modelJson.js');
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'unit-test-key';
  try {
    const cancelled = [], read = [];
    const routes = createParseRoutes({
      ParseApiError, normalizeParseBundle, parseModelJsonDetailed,
      startOpenAI: async () => ({ responseId: 'resp_unit', pending: true }),
      readOpenAI: async ({ responseId }) => { read.push(responseId); return { pending: true }; },
      cancelOpenAI: async ({ responseId }) => { cancelled.push(responseId); return true; },
      generateOpenAI: async () => assert.fail('a ticket never makes a long request')
    });
    const { ticket } = await routes.startParseTicket(fixture.sentence, fixture.framework, request.modelId, { settings: request.settings });
    const fields = readParseTicket('unit-test-key', ticket);

    const late = signParseTicket('unit-test-key', { ...fields, startedAt: Date.now() - 21 * 60 * 1000 });
    await assert.rejects(routes.checkParseTicket(late), error => /timed out|timeout|deadline/i.test(`${error.code} ${error.message}`)
      && error.details?.generationRecord?.outcome?.runId === fields.runId);
    const outdated = signParseTicket('unit-test-key', { ...fields, sentRequestSha256: 'b'.repeat(64) });
    await assert.rejects(routes.checkParseTicket(outdated), { code: 'BABEL_UPDATED', status: 409 });
    assert.deepEqual(cancelled, ['resp_unit', 'resp_unit']);
    assert.deepEqual(read, [], 'neither looks at the response');

    assert.deepEqual(await routes.checkParseTicket(ticket), { status: 'pending', ticket });
    await assert.rejects(routes.startParseTicket(fixture.sentence, fixture.framework, 'anthropic:claude-opus-5-5', { settings: {} }),
      error => error.status === 400);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
  }
});

test('a silent provider never hangs a check or a start: a check answers "check again", a start times out', async () => {
  const { createParseRoutes } = await import('../server/babelParser/parseRoutes.js');
  const { ParseApiError } = await import('../server/babelParser/error.js');
  const { normalizeParseBundle } = await import('../server/babelParser/parseNormalization.js');
  const { parseModelJsonDetailed } = await import('../server/babelParser/modelJson.js');
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'unit-test-key';
  const never = () => new Promise(() => {});
  const settle = (promise, ms = 1000) => Promise.race([
    promise.then(value => ({ value }), error => ({ error })),
    new Promise(resolve => setTimeout(() => resolve({ hung: true }), ms))
  ]);
  try {
    const shared = { ParseApiError, normalizeParseBundle, parseModelJsonDetailed, cancelOpenAI: async () => true,
      backgroundCheckTimeoutMs: 50, backgroundStartTimeoutMs: 50 };
    const answering = createParseRoutes({ ...shared, startOpenAI: async () => ({ responseId: 'resp_quiet', pending: true }), readOpenAI: never });
    const { ticket } = await answering.startParseTicket(fixture.sentence, fixture.framework, request.modelId, { settings: request.settings });
    const checked = await settle(answering.checkParseTicket(ticket));
    assert.equal(checked.hung, undefined, 'the check ends');
    assert.equal(checked.error?.code, 'CHECK_UNAVAILABLE');
    assert.equal(checked.error?.status, 503);

    const silent = createParseRoutes({ ...shared, startOpenAI: never, readOpenAI: never });
    const started = await settle(silent.startParseTicket(fixture.sentence, fixture.framework, request.modelId, { settings: request.settings }));
    assert.equal(started.hung, undefined, 'the start ends');
    assert.equal(started.error?.code, 'PROVIDER_TIMEOUT');
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
  }
});
