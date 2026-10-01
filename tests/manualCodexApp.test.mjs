import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createManualParseMiddleware, runManualQualification } from '../contractQualification/manualServer.js';

const sentence = '  小明说：“It costs $5; `hello`.”\n';
const body = { sentence, framework: 'minimalism', modelId: 'openai:gpt-6.1-sol', settings: { 'reasoning.effort': 'high' } };
const directory = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'babel-manual-oauth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};
const response = () => Object.assign(new EventEmitter(), {
  destroyed: false, writableEnded: false,
  writeHead(status, headers) { this.status = status; this.headers = headers; },
  end(value) { this.payload = JSON.parse(value); this.writableEnded = true; this.emit('close'); }
});
const request = (content = JSON.stringify(body), headers = {}) => Object.assign(Readable.from([Buffer.from(content)]), {
  url: '/api/parse', method: 'POST', headers: {
    host: '127.0.0.1:8454', origin: 'http://127.0.0.1:8454', 'content-type': 'application/json', ...headers
  }
});

test('manual input preserves exact text and uses the subscription model and effort without retries', async t => {
  const runsRoot = directory(t);
  const calls = [];
  const middleware = createManualParseMiddleware({ runsRoot, port: 8454, run: async input => {
    calls.push(input);
    return { status: 200, payload: { analyses: [{ id: 'untouched-analysis' }] } };
  } });
  for (let i = 0; i < 2; i++) {
    const res = response();
    await middleware(request(), res, () => assert.fail('parse must be handled'));
    assert.equal(res.status, 200);
    assert.deepEqual(res.payload, { analyses: [{ id: 'untouched-analysis' }] });
    assert.equal(calls[i].signal.aborted, false, 'normal response closure is not cancellation');
  }
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].request, { sentence, framework: 'minimalism', model: body.modelId, effort: 'high' });
  assert.notEqual(calls[0].outputPath, calls[1].outputPath);
  assert.equal(path.dirname(calls[0].outputPath), runsRoot);
});

test('external origins, rebound hosts, non-JSON, malformed, oversized and unsupported input never generate', async t => {
  let calls = 0;
  const middleware = createManualParseMiddleware({ runsRoot: directory(t), port: 8454,
    run: async () => { calls++; throw new Error('must not generate'); } });
  const examples = [
    [request(undefined, { origin: 'https://example.com' }), 403],
    [request(undefined, { host: 'attacker.test:8454', origin: 'http://attacker.test:8454' }), 403],
    [request(undefined, { origin: undefined }), 403],
    [request(undefined, { 'content-type': 'text/plain' }), 415],
    [request('{'), 400], [request('x'.repeat(16385)), 413],
    [request(JSON.stringify({ ...body, modelId: 'anthropic:claude-opus-5' })), 400],
    [request(JSON.stringify({ ...body, settings: { 'reasoning.effort': 'invented' } })), 400]
  ];
  for (const [req, status] of examples) {
    const res = response();
    await middleware(req, res, () => assert.fail('parse must be handled'));
    assert.equal(res.status, status);
  }
  assert.equal(calls, 0);
});

test('only one manual request runs at once and closing its response cancels it', async t => {
  let started;
  let pending;
  const middleware = createManualParseMiddleware({ runsRoot: directory(t), port: 8454,
    run: async input => {
      started = input;
      return new Promise(resolve => { pending = resolve; });
    } });
  const res = response();
  const running = middleware(request(), res, () => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(started);
  const second = response();
  await middleware(request(), second, () => {});
  assert.equal(second.status, 409);
  res.destroyed = true;
  res.emit('close');
  assert.equal(started.signal.aborted, true);
  pending({ status: 499, payload: {} });
  await running;
});

test('the adapter calls the existing CLI with literal arguments and returns its normalized bundle', async t => {
  const outputPath = directory(t);
  fs.mkdirSync(path.join(outputPath, 'attempts/parse'), { recursive: true });
  fs.writeFileSync(path.join(outputPath, 'run-receipt.json'), JSON.stringify({ status: 'completed' }));
  const bundle = { analyses: [{ derivationStages: [{ statement: 'unchanged' }] }], modelUsed: 'gpt-6.1-sol' };
  fs.writeFileSync(path.join(outputPath, 'attempts/parse/bundle.json'), JSON.stringify({ response: bundle }));
  let invocation;
  const result = await runManualQualification({
    request: { sentence, framework: 'minimalism', model: body.modelId, effort: 'high' },
    outputPath, signal: new AbortController().signal,
    spawnImpl: (executable, args, options) => {
      invocation = { executable, args, options };
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    }
  });
  assert.equal(invocation.executable, process.execPath);
  assert.ok(invocation.args[0].endsWith('/scripts/runCodexQualification.mjs'));
  assert.deepEqual(invocation.args.slice(1), ['--sentence', sentence, '--framework', 'minimalism',
    '--model', body.modelId, '--effort', 'high', '--out', outputPath, '--working-tree', '--run']);
  assert.equal(invocation.options.shell, undefined);
  assert.deepEqual(result, { status: 200, payload: { ...bundle, requestedModelId: body.modelId } });
});

test('failed processing retains the exact downloadable output and cannot become a successful parse', async t => {
  const outputPath = directory(t);
  const raw = Buffer.from('真实模型输出 — incomplete {');
  fs.writeFileSync(path.join(outputPath, 'run-receipt.json'), JSON.stringify({ status: 'interrupted', result: { error: 'Stream interrupted.' } }));
  fs.writeFileSync(path.join(outputPath, 'output.txt'), raw);
  const result = await runManualQualification({ request: { sentence, framework: 'xbar', model: body.modelId, effort: 'high' },
    outputPath, signal: new AbortController().signal, spawnImpl: () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('close', 1));
      return child;
    } });
  assert.equal(result.status, 502);
  assert.equal(result.payload.error.message, 'Stream interrupted.');
  assert.deepEqual(Buffer.from(result.payload.error.rawOutput.data, 'base64'), raw);
});

test('a preparation failure does not claim that model output was received', async t => {
  const result = await runManualQualification({ request: { sentence, framework: 'xbar', model: body.modelId, effort: 'high' },
    outputPath: directory(t), signal: new AbortController().signal, spawnImpl: () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('close', 1));
      return child;
    } });
  assert.equal(result.status, 500);
  assert.equal(result.payload.error.code, 'HARNESS_ERROR');
  assert.equal(result.payload.error.rawOutput, undefined);
});

test('client cancellation terminates the CLI and waits for its exit', async t => {
  const controller = new AbortController();
  const child = new EventEmitter();
  const signals = [];
  child.kill = signal => { signals.push(signal); queueMicrotask(() => child.emit('close', 1)); };
  const running = runManualQualification({ request: { sentence, framework: 'xbar', model: body.modelId, effort: 'high' },
    outputPath: directory(t), signal: controller.signal, spawnImpl: () => child });
  controller.abort();
  assert.equal((await running).status, 499);
  assert.deepEqual(signals, ['SIGTERM']);
});

test('working-tree runs fingerprint actual app sources and keep the committed-source gate explicit', t => {
  const outputPath = path.join(directory(t), 'prepared');
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const script = path.join(repoRoot, 'scripts/runCodexQualification.mjs');
  execFileSync(process.execPath, [script, '--sentence', sentence, '--framework', 'xbar',
    '--out', outputPath, '--working-tree'], { cwd: repoRoot, stdio: 'ignore' });
  const receipt = JSON.parse(fs.readFileSync(path.join(outputPath, 'run-receipt.json')));
  assert.equal(receipt.status, 'prepared');
  assert.equal(receipt.providerCallsMade, false);
  assert.equal(receipt.contract.sourceState, 'working-tree');
  assert.equal(typeof receipt.contract.auditedSourcesMatchCommit, 'boolean');
  const appSource = receipt.contract.sections.requestBoundary.files.find(file => file.path === 'App.tsx');
  assert.equal(appSource.sha256, createHash('sha256').update(fs.readFileSync(path.join(repoRoot, 'App.tsx'))).digest('hex'));
  assert.ok(receipt.contract.sections.qualificationHarness.files.some(file => file.path === 'contractQualification/manualApp.tsx'));
  const strict = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/captureContractFingerprint.mjs'),
    '--out', path.join(directory(t), 'strict.json')], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(strict.status === 0, receipt.contract.auditedSourcesMatchCommit);
  if (!receipt.contract.auditedSourcesMatchCommit) assert.match(strict.stderr, /Contract fingerprint refused/);
});
