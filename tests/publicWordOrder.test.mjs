import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { normalizeParseBundle } from '../server/babelParser/parseNormalization.js';
import { formatApiError, parseFromBodyWithProviders } from '../server/parseApi.js';

// Public Babel fails a parse whose every analysis has the sentence's words in
// another order, and drops such analyses beside passing ones; the internal app
// keeps them (Francis, 5 Nov 2026: "Let's do public Babel failing and offering a retry").

const leaf = (id, word) => ({ id, label: word, word, children: [] });
const WORDS = { mary: 'Mary', persuaded: 'persuaded', john: 'John', to: 'to', leave: 'leave' };
const tree = (...ids) => ({ derivationStages: [{
  statement: 'The clause is complete.', stageRecord: 'Every word is in place.', relations: [],
  workspaceForest: [{ id: 's', label: 'S', children: ids.map(id => leaf(id, WORDS[id])) }]
}] });
const sentence = 'Mary persuaded John to leave.';
const inOrder = tree('mary', 'persuaded', 'john', 'to', 'leave');
const reordered = tree('mary', 'john', 'persuaded', 'to', 'leave');
const request = { sentence, framework: 'minimalism', modelId: 'openai:gpt-6.1-sol', settings: { 'reasoning.effort': 'high' } };
const evidence = { generationRecord: { sentRequestSha256: 'a'.repeat(64) }, rawModelOutput: { mediaType: 'text/plain', encoding: 'base64', data: 'e30=' } };

// A finished bundle as a route returns it: the response normalized with the spelling check, plus its evidence.
const finishedBundle = payload => ({
  ...normalizeParseBundle(payload, 'minimalism', sentence, 'gpt', true, { spellout: true }),
  ...evidence
});
const providersReturning = (bundle) => ({
  research: async () => bundle,
  start: async () => bundle,
  check: async () => ({ ...bundle, sentence })
});
const asCheck = { ticket: 'T' };

test('public Babel returns only the analyses that spell the sentence, as a bundle the model could have sent', async () => {
  const bundle = finishedBundle({ analyses: [inOrder, reordered] });
  assert.equal(bundle.analyses.length, 2);
  assert.ok(bundle.analyses[1].sentenceCheck, 'the response holds one reordered analysis');
  for (const body of [request, asCheck]) {
    const result = await parseFromBodyWithProviders(body, providersReturning(bundle), { publicRequestOnly: true });
    assert.equal(result.analyses.length, 1, Object.keys(body)[0]);
    assert.equal(result.analyses[0].sentenceCheck, undefined);
    assert.deepEqual(result.analyses[0], bundle.analyses[0]);
    assert.deepEqual(result.inputTokens, ['Mary', 'persuaded', 'John', 'to', 'leave']);
    assert.equal(bundle.ambiguityDetected, true);
    assert.equal(result.ambiguityDetected, false, 'one analysis is no ambiguity');
    assert.equal(result.sentence, sentence);
    assert.deepEqual(result.generationRecord, evidence.generationRecord, 'the record still describes the whole response');
    assert.deepEqual(result.rawModelOutput, evidence.rawModelOutput);
  }
  // Two passing analyses beside a reordered one stay ambiguous.
  const three = finishedBundle({ analyses: [inOrder, reordered, inOrder] });
  const kept = await parseFromBodyWithProviders(request, providersReturning(three), { publicRequestOnly: true });
  assert.equal(kept.analyses.length, 2);
  assert.equal(kept.ambiguityDetected, true);
});

test('public Babel fails a parse whose every analysis has the sentence\'s words in another order', async () => {
  const bundle = finishedBundle(reordered);
  for (const body of [request, asCheck]) {
    const error = await parseFromBodyWithProviders(body, providersReturning(bundle), { publicRequestOnly: true })
      .then(() => assert.fail('must fail'), caught => caught);
    assert.equal(error.code, 'BAD_MODEL_RESPONSE', Object.keys(body)[0]);
    assert.equal(error.status, 502);
    assert.equal(error.failure.ruleId, 'SPELLOUT_WORD_ORDER');
    assert.equal(error.failure.class, 'contract_misunderstanding');
    assert.deepEqual(error.failure.offendingValue, ['Mary John persuaded to leave.']);
    const formatted = formatApiError(error).body.error;
    assert.equal(formatted.message, 'The model\'s tree puts some of the sentence\'s words in the wrong order.');
    assert.deepEqual(formatted.rawOutput, evidence.rawModelOutput, 'the raw output stays on the failure');
    assert.deepEqual(formatted.generationRecord, evidence.generationRecord);
    assert.equal('inputTokens' in formatted, false, 'an output that failed the spelling check has no word list');
  }
});

test('without the public request a reordered analysis is still returned as an invalid analysis', async () => {
  for (const payload of [reordered, { analyses: [inOrder, reordered] }]) {
    const bundle = finishedBundle(payload);
    for (const body of [request, asCheck]) {
      const result = await parseFromBodyWithProviders(body, providersReturning(bundle));
      assert.deepEqual(result, { ...bundle, sentence });
    }
  }
});

const endpoint = 'https://api.openai.com/v1/responses';

for (const entry of ['server/index.js', 'api/parse.js']) {
  test(`${entry} in production fails a reordered analysis at its check with SPELLOUT_WORD_ORDER`, { timeout: 30000 }, async t => {
    const child = fork(new URL('./support/backgroundParseServer.mjs', import.meta.url), [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env, NODE_ENV: 'production', PORT: '0', OPENAI_API_KEY: 'test-only-provider-key',
        BABEL_SAVE_PROVIDER_RAW: '0', BABEL_REQUIRE_ORIGIN: '0', BABEL_ALLOW_NO_ORIGIN: '1', BABEL_PARSE_API_TOKEN: '',
        BABEL_TRUST_PROXY: '0', BABEL_ALLOWED_ORIGINS: '', BABEL_PUBLIC_REQUEST_ONLY: '',
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
    const rawOutput = JSON.stringify(reordered);

    await script([{ url: endpoint, method: 'POST', body: { id: 'resp_a', status: 'queued' } }]);
    const started = await post({ sentence, start: true });
    assert.equal(started.status, 200, output);
    await script([{ url: `${endpoint}/resp_a`, method: 'GET', body: { id: 'resp_a', status: 'completed', model: 'gpt-6.1-sol',
      output: [{ type: 'message', content: [{ type: 'output_text', text: rawOutput }] }],
      usage: { input_tokens: 11, output_tokens: 22, total_tokens: 33 } } }]);
    const failed = await post({ ticket: started.body.ticket });
    assert.equal(failed.status, 502, output);
    assert.equal(failed.body.analyses, undefined);
    assert.equal(failed.body.error.code, 'BAD_MODEL_RESPONSE');
    assert.equal(failed.body.error.failure.ruleId, 'SPELLOUT_WORD_ORDER');
    assert.equal(failed.body.error.message, 'The model\'s tree puts some of the sentence\'s words in the wrong order.');
    // Shaped like other model output failures: the raw output and the generation record stay.
    assert.equal(Buffer.from(failed.body.error.rawOutput.data, 'base64').toString('utf8'), rawOutput);
    assert.equal(failed.body.error.generationRecord.timing.completionObservedBy, 'parse-ticket-check');
    assert.equal(failed.body.error.details, undefined, 'production bodies carry no internal details');
    assert.doesNotMatch(JSON.stringify(failed.body), /test-only-provider-key/);
    child.send({ type: 'stop' });
  });
}
