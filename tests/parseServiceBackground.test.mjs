import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSentenceInBackground, PARSE_CHECK_GIVE_UP_MS } from '../services/parseService.ts';

const bundle = { sentence: 'Mia laughed.', ambiguityDetected: false, analyses: [{ derivationStages: [] }] };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Answers each /api/parse call from the script and records what was sent. */
const scriptFetch = (t, replies) => {
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    sent.push(JSON.parse(options.body));
    const reply = replies.shift();
    assert.ok(reply, 'no call beyond the script');
    if (reply instanceof Error) throw reply;
    return reply;
  };
  t.after(() => { globalThis.fetch = original; });
  return sent;
};
const noWait = async () => {};
const args = ['Mia laughed.', 'minimalism', 'openai:gpt-6.1-sol', { 'reasoning.effort': 'high' }];

test('a background parse starts once, rides out failed looks and returns the finished bundle', async t => {
  const sent = scriptFetch(t, [
    json(200, { status: 'pending', ticket: 'T' }),
    new TypeError('Failed to fetch'),
    json(503, { error: { code: 'CHECK_UNAVAILABLE', message: 'later' } }),
    new Response('<html>gateway timeout</html>', { status: 504 }),
    json(429, { error: { code: 'RATE_LIMITED', message: 'slow down' } }),
    json(200, { status: 'pending', ticket: 'T' }),
    json(200, bundle)
  ]);
  const tickets = [];
  const result = await parseSentenceInBackground(...args, { wait: noWait, onTicket: pending => tickets.push(pending) });
  assert.deepEqual(result, bundle);
  assert.equal(sent[0].start, true);
  assert.equal(sent[0].sentence, 'Mia laughed.');
  assert.ok(sent.slice(1).every(body => Object.keys(body).length === 1 && body.ticket === 'T'), 'every check sends only its ticket');
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].ticket, 'T');
  assert.equal(tickets[0].sentence, 'Mia laughed.');
});

test("the parse's own failure ends it, with the server's evidence", async t => {
  scriptFetch(t, [
    json(200, { status: 'pending', ticket: 'T' }),
    json(502, { error: { code: 'PROVIDER_ERROR', message: 'OpenAI response failed.', generationRecord: { provider: 'gpt' } } })
  ]);
  await assert.rejects(parseSentenceInBackground(...args, { wait: noWait }),
    error => error.code === 'PROVIDER_ERROR' && error.generationRecord?.provider === 'gpt');
});

test('a resumed parse only checks, and a parse past its time gives up without asking again', async t => {
  const sent = scriptFetch(t, [json(200, bundle)]);
  const resumed = await parseSentenceInBackground(...args, { wait: noWait, resume: { ticket: 'R', sentence: 'Mia laughed.', startedAt: Date.now() } });
  assert.deepEqual(resumed, bundle);
  assert.deepEqual(sent, [{ ticket: 'R' }]);
  await assert.rejects(parseSentenceInBackground(...args, {
    wait: noWait, resume: { ticket: 'R', sentence: 'Mia laughed.', startedAt: Date.now() - PARSE_CHECK_GIVE_UP_MS - 1 }
  }), { code: 'PROVIDER_TIMEOUT' });
  assert.equal(sent.length, 1);
});

test('a start the server finished at once returns its bundle without checking', async t => {
  const sent = scriptFetch(t, [json(200, bundle)]);
  assert.deepEqual(await parseSentenceInBackground(...args, { wait: noWait }), bundle);
  assert.equal(sent.length, 1);
});

test('a check whose reply is cut off mid-body checks the same ticket again', async t => {
  const interrupted = () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"status":"pen')); controller.error(new TypeError('network connection was lost')); }
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const sent = scriptFetch(t, [json(200, { status: 'pending', ticket: 'T' }), interrupted(), json(200, bundle)]);
  assert.deepEqual(await parseSentenceInBackground(...args, { wait: noWait }), bundle);
  assert.deepEqual(sent.slice(1), [{ ticket: 'T' }, { ticket: 'T' }]);
});
