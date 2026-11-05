import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';

const endpoint = 'https://api.openai.com/v1/responses';

for (const entry of ['server/index.js', 'api/parse.js']) {
  test(`${entry} in production gives each visitor 5 parses a day within the site's total, and still answers checks`, { timeout: 30000 }, async t => {
    const child = fork(new URL('./support/backgroundParseServer.mjs', import.meta.url), [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env, NODE_ENV: 'production', PORT: '0', OPENAI_API_KEY: 'test-only-provider-key',
        BABEL_SAVE_PROVIDER_RAW: '0', BABEL_REQUIRE_ORIGIN: '0', BABEL_ALLOW_NO_ORIGIN: '1', BABEL_PARSE_API_TOKEN: '',
        BABEL_ALLOWED_ORIGINS: '', BABEL_PARSE_RATE_LIMIT_PER_MINUTE: '200',
        // Express reads the visitor from one trusted proxy hop, as behind a host's proxy.
        BABEL_TRUST_PROXY: '1',
        // The per-visitor allowance is the deployed default; the site total is lowered to reach it.
        BABEL_PARSE_DAILY_LIMIT_PER_IP: '', BABEL_PARSE_DAILY_LIMIT_TOTAL: '7',
        BABEL_TEST_SERVERLESS_ENTRY: entry === 'api/parse.js' ? '1' : '0'
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
    const post = async (visitor, body) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/parse`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': visitor }, body: JSON.stringify(body)
      });
      return { status: response.status, body: await response.json() };
    };
    const start = async (visitor, n) => {
      await script([{ url: endpoint, method: 'POST', body: { id: `resp_${n}`, status: 'queued' } }]);
      return post(visitor, { sentence: 'Mia laughed.', start: true });
    };

    // Requests Babel refuses use none of the visitor's parses.
    for (const sentence of ['a'.repeat(601), ' ', 'b'.repeat(601), 'c'.repeat(601), 'd'.repeat(601), 'e'.repeat(601)]) {
      const refused = await post('203.0.113.1', { sentence, start: true });
      assert.equal(refused.status, 400);
      assert.equal(refused.body.error.code, 'INVALID_REQUEST');
    }

    let ticket;
    for (let n = 1; n <= 5; n++) {
      const started = await start('203.0.113.1', n);
      assert.equal(started.status, 200, output);
      ticket = started.body.ticket;
    }
    const sixth = await post('203.0.113.1', { sentence: 'Mia laughed.', start: true });
    assert.equal(sixth.status, 429);
    assert.equal(sixth.body.error.code, 'RATE_LIMITED_DAILY');
    assert.equal(calls.length, 5, 'a refused parse calls no provider');

    // Checks start nothing, so a visitor who has used today's parses still finishes them.
    await script([{ url: `${endpoint}/resp_5`, method: 'GET', body: { id: 'resp_5', status: 'in_progress' } }]);
    const check = await post('203.0.113.1', { ticket });
    assert.deepEqual(check.body, { status: 'pending', ticket });

    // The site's total is shared by every visitor.
    assert.equal((await start('203.0.113.2', 6)).status, 200);
    assert.equal((await start('203.0.113.3', 7)).status, 200);
    const full = await post('203.0.113.4', { sentence: 'Mia laughed.', start: true });
    assert.equal(full.status, 429);
    assert.equal(full.body.error.code, 'DAILY_CAPACITY_REACHED');
    assert.equal(calls.filter(call => call.method === 'POST').length, 7);
    child.send({ type: 'stop' });
  });
}

for (const entry of ['server/index.js', 'api/parse.js']) {
  test(`${entry} in production gives a visitor back a failed parse, once per ticket, while the site total counts it`, { timeout: 30000 }, async t => {
    const child = fork(new URL('./support/backgroundParseServer.mjs', import.meta.url), [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env, NODE_ENV: 'production', PORT: '0', OPENAI_API_KEY: 'test-only-provider-key',
        BABEL_SAVE_PROVIDER_RAW: '0', BABEL_REQUIRE_ORIGIN: '0', BABEL_ALLOW_NO_ORIGIN: '1', BABEL_PARSE_API_TOKEN: '',
        BABEL_ALLOWED_ORIGINS: '', BABEL_PARSE_RATE_LIMIT_PER_MINUTE: '200', BABEL_TRUST_PROXY: '1',
        BABEL_PARSE_DAILY_LIMIT_PER_IP: '', BABEL_PARSE_DAILY_LIMIT_TOTAL: '9',
        BABEL_TEST_SERVERLESS_ENTRY: entry === 'api/parse.js' ? '1' : '0'
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
    const post = async (visitor, body) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/parse`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': visitor }, body: JSON.stringify(body)
      });
      return { status: response.status, body: await response.json() };
    };
    const refusedCreation = { status: 400, body: { error: { type: 'invalid_request_error', message: 'Scripted refusal' } } };
    const start = async (visitor, n) => {
      await script([{ url: endpoint, method: 'POST', body: { id: `resp_${n}`, status: 'queued' } }]);
      return post(visitor, { sentence: 'Mia laughed.', start: true });
    };
    const startRefused = async visitor => {
      const refused = await post(visitor, { sentence: 'Mia laughed.', start: true });
      assert.equal(refused.status, 429, output);
      assert.equal(refused.body.error.code, 'RATE_LIMITED_DAILY');
    };
    const visitor = '203.0.113.1';

    // A start whose creation the provider refuses, and a long request that fails, give their parses back.
    await script([{ url: endpoint, method: 'POST', ...refusedCreation }]);
    const failedStart = await post(visitor, { sentence: 'Mia laughed.', start: true });
    assert.ok(failedStart.status >= 400 && failedStart.status !== 429, JSON.stringify(failedStart.body));
    await script([{ url: endpoint, method: 'POST', ...refusedCreation }]);
    const failedRequest = await post(visitor, { sentence: 'Mia laughed.' });
    assert.ok(failedRequest.status >= 400 && failedRequest.status !== 429, JSON.stringify(failedRequest.body));
    const tickets = [];
    for (let n = 1; n <= 5; n++) {
      const started = await start(visitor, n);
      assert.equal(started.status, 200, `start ${n} after two failures: ${JSON.stringify(started.body)} ${output}`);
      tickets.push(started.body.ticket);
    }
    await startRefused(visitor);

    // A started parse that fails at its check gives its parse back once, however often it is checked.
    const failedResponse = { id: 'resp_5', status: 'failed', model: 'gpt-6.1-sol', output: [], error: { message: 'Scripted failure' } };
    for (let check = 0; check < 2; check++) {
      await script([{ url: `${endpoint}/resp_5`, method: 'GET', body: failedResponse }]);
      const failed = await post(visitor, { ticket: tickets[4] });
      assert.ok(failed.status >= 400 && failed.status !== 503, JSON.stringify(failed.body));
    }
    assert.equal((await start(visitor, 6)).status, 200, 'the failed check gave one parse back');
    await startRefused(visitor);

    // A check Babel could not make, and a forged ticket, give nothing back.
    await script([{ url: `${endpoint}/resp_4`, method: 'GET', status: 500, body: { error: { message: 'Scripted outage' } } }]);
    const unavailable = await post(visitor, { ticket: tickets[3] });
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.body.error.code, 'CHECK_UNAVAILABLE');
    assert.equal((await post(visitor, { ticket: 'nonsense' })).body.error.code, 'INVALID_TICKET');
    await startRefused(visitor);

    // The site total counted all eight parses, the three failed ones included.
    assert.equal((await start('203.0.113.2', 7)).status, 200);
    const full = await post('203.0.113.3', { sentence: 'Mia laughed.', start: true });
    assert.equal(full.status, 429);
    assert.equal(full.body.error.code, 'DAILY_CAPACITY_REACHED');
    assert.equal(calls.filter(call => call.method === 'POST').length, 9);
    child.send({ type: 'stop' });
  });
}
