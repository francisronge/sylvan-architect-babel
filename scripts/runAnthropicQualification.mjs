import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { Agent } from 'undici';

import { buildAnthropicQualificationRequest, readAnthropicApiKey, requestAnthropicQualification,
  ANTHROPIC_API_VERSION, ANTHROPIC_MESSAGES_URL, DEFAULT_ANTHROPIC_KEYCHAIN_SERVICE } from '../contractQualification/anthropicApi.js';
import { writeQualificationAttempt } from '../contractQualification/artifacts.js';
import { hashQualificationBytes, stableQualificationJson } from '../contractQualification/run.js';
import { createQualificationTelemetry, qualificationTransportError } from '../contractQualification/telemetry.js';
import { createTransportDiagnostics } from '../contractQualification/transportDiagnostics.js';
import { estimateApiTokenCost } from '../contractQualification/apiCost.js';
import { describeInputTokenization } from '../server/babelParser/generationRecord.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const { values } = parseArgs({ options: {
  sentence: { type: 'string' }, framework: { type: 'string' }, model: { type: 'string' },
  effort: { type: 'string' }, out: { type: 'string' }, 'keychain-service': { type: 'string' },
  'working-tree': { type: 'boolean', default: false },
  run: { type: 'boolean', default: false }, help: { type: 'boolean', default: false }
} });

if (values.help) {
  console.log(`Babel-only generation through the Anthropic Messages API.
  --sentence TEXT --framework minimalism|xbar
  [--model anthropic:claude-opus-5-5|anthropic:claude-opus-5|anthropic:claude-fable-5-1]
  --out NEW_DIRECTORY [--effort high] [--keychain-service NAME] [--run]
Without --run, only saves the exact request and contract fingerprint; no key or network access.
Each invocation makes at most one request. No retries, model fallbacks, tools or agent context.
The default is Claude Opus 5.5 at high effort. The API key is read from the macOS Keychain
item "${DEFAULT_ANTHROPIC_KEYCHAIN_SERVICE}"; usage is billed to that key's Console organization.
Requires committed contract sources unless --working-tree explicitly fingerprints current sources.
Build Replay review with:
  npm run qualification:review -- --run NEW_DIRECTORY`);
  process.exit(0);
}

const { body, selection, inputTokens } = buildAnthropicQualificationRequest(values);
if (!values.out) throw new Error('--out must name a new artifact directory.');
const keychainService = values['keychain-service'] || DEFAULT_ANTHROPIC_KEYCHAIN_SERVICE;
const outputPath = path.resolve(values.out);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.mkdirSync(outputPath, { mode: 0o700 }); // Refuse reuse before any generation can occur.
const writeJson = (name, value) => fs.writeFileSync(path.join(outputPath, name), stableQualificationJson(value));
const requestBytes = Buffer.from(JSON.stringify(body), 'utf8');
fs.writeFileSync(path.join(outputPath, 'request.json'), requestBytes);
execFileSync(process.execPath, [path.join(repoRoot, 'scripts/captureContractFingerprint.mjs'),
  '--out', path.join(outputPath, 'contract.manifest.json'), '--label', 'anthropic-api-babel-only',
  ...(values['working-tree'] ? ['--allow-working-tree'] : [])
], { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] });
const contract = JSON.parse(fs.readFileSync(path.join(outputPath, 'contract.manifest.json'), 'utf8'));
const receipt = {
  schemaVersion: 1,
  transport: 'anthropic-api', endpoint: ANTHROPIC_MESSAGES_URL, anthropicVersion: ANTHROPIC_API_VERSION,
  request: { sentence: values.sentence, framework: values.framework, inputTokens,
    inputTokenization: describeInputTokenization(), model: selection },
  requestBody: { artifact: 'request.json', sha256: hashQualificationBytes(requestBytes) },
  contract,
  transportDifferencesFromBabelRoute: { stream: 'true; Babel\'s Anthropic route waits for one non-streaming response' },
  modelFallbacks: 'none requested', credential: { source: 'macOS Keychain', service: keychainService },
  billing: 'Claude Console organization of the API key; the actual charge is shown in the Console',
  agentContext: false, providerCallsMade: false, status: 'prepared'
};
writeJson('run-receipt.json', receipt);
console.log(`Exact Babel request saved: ${path.join(outputPath, 'request.json')}`);

if (values.run) {
  const apiKey = readAnthropicApiKey({ service: keychainService });
  const controller = new AbortController();
  const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
  const rawPath = path.join(outputPath, 'response.sse');
  fs.writeFileSync(rawPath, '');
  receipt.startedAt = new Date().toISOString();
  receipt.status = 'request-started';
  receipt.providerCallsMade = true;
  receipt.client = { node: process.version, fetchUndici: process.versions.undici,
    headersTimeoutMs: 0, bodyTimeoutMs: 0, retries: 0 };
  receipt.diagnostics = { artifact: 'transport-diagnostics.ndjson', schemaVersion: 1 };
  writeJson('run-receipt.json', receipt);
  const start = performance.now();
  const telemetry = createQualificationTelemetry();
  const diagnostics = createTransportDiagnostics({ directory: outputPath,
    endpoint: ANTHROPIC_MESSAGES_URL, client: receipt.client, snapshot: () => telemetry.snapshot() });
  const cancelInt = () => { diagnostics.signal('SIGINT'); controller.abort(); };
  const cancelTerm = () => { diagnostics.signal('SIGTERM'); controller.abort(); };
  process.once('SIGINT', cancelInt);
  process.once('SIGTERM', cancelTerm);
  for (const type of ['connect', 'disconnect', 'connectionError']) {
    dispatcher.on(type, (_origin, _targets, error) => {
      telemetry.connection(type, error); diagnostics.connection(type, error);
    });
  }
  let runnerPhase = 'request';
  try {
    const result = await requestAnthropicQualification({ body, apiKey, dispatcher, signal: controller.signal,
      onBytes: chunk => { telemetry.bytes(chunk); fs.appendFileSync(rawPath, chunk); diagnostics.observe(); },
      onHeaders: headers => { telemetry.headers(); writeJson('response-headers.json', headers); diagnostics.headers(headers); },
      onEvent: event => { telemetry.event(event); diagnostics.observe(); },
      onLifecycle: event => diagnostics.lifecycle(event)
    });
    runnerPhase = 'archive-result';
    const { text, ...transportResult } = result;
    fs.writeFileSync(path.join(outputPath, 'output.txt'), text);
    const rawBytes = fs.readFileSync(rawPath);
    Object.assign(receipt, {
      completedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - start),
      status: result.status, result: transportResult,
      apiTokenCostEstimate: { ...estimateApiTokenCost(result.response?.model ?? body.model, result.response?.usage),
        kind: 'estimated-api-charge' },
      rawResponse: { artifact: 'response.sse', byteLength: rawBytes.length, sha256: hashQualificationBytes(rawBytes) },
      output: { artifact: 'output.txt', sha256: hashQualificationBytes(Buffer.from(text, 'utf8')) }
    });
    // Incomplete transport must never enter delimiter repair or masquerade as a complete analysis.
    if (result.status === 'completed') {
      runnerPhase = 'babel-processing';
      const processingStart = performance.now();
      const attempt = { id: 'parse', request: { sentence: values.sentence, framework: values.framework, inputTokens },
        model: selection, source: { kind: 'raw-text-file', path: 'output.txt' } };
      const artifacts = writeQualificationAttempt({ outputPath, attempt, rawBytes: Buffer.from(text, 'utf8') });
      receipt.processingDurationMs = Math.round((performance.now() - processingStart) * 1000) / 1000;
      receipt.attempts = [{ attemptId: attempt.id, outcome: artifacts.receipt.outcome }];
      writeJson('review-manifest.json', { schemaVersion: 1, entries: [artifacts.reviewEntry] });
      console.log(`Babel processing: ${artifacts.receipt.outcome.status}`);
      if (artifacts.receipt.outcome.status === 'failed') process.exitCode = 1;
    } else {
      process.exitCode = 1;
      console.error(result.error);
    }
    console.log(`Transport: ${result.status}. Artifacts: ${outputPath}`);
  } catch (error) {
    diagnostics.lifecycle({ type: 'runner-failure', phase: runnerPhase,
      ...qualificationTransportError(error) });
    throw error;
  } finally {
    const telemetryBytes = Buffer.from(stableQualificationJson(telemetry.snapshot()));
    fs.writeFileSync(path.join(outputPath, 'telemetry.json'), telemetryBytes);
    receipt.telemetry = { artifact: 'telemetry.json', sha256: hashQualificationBytes(telemetryBytes) };
    writeJson('run-receipt.json', receipt);
    process.removeListener('SIGINT', cancelInt);
    process.removeListener('SIGTERM', cancelTerm);
    try { await dispatcher.close(); } finally { diagnostics.close(); }
  }
}
