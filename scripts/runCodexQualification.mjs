import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { Agent } from 'undici';

import { buildCodexQualificationRequest, readCodexCredentials,
  requestCodexQualification, CODEX_RESPONSES_URL } from '../contractQualification/codexOAuth.js';
import { hashQualificationBytes, stableQualificationJson } from '../contractQualification/run.js';
import { createQualificationTelemetry, qualificationTransportError } from '../contractQualification/telemetry.js';
import { createTransportDiagnostics } from '../contractQualification/transportDiagnostics.js';
import { estimateApiTokenCost } from '../contractQualification/apiCost.js';
import { describeInputTokenization } from '../server/babelParser/generationRecord.js';
import { writeSpelloutAttempts } from '../contractQualification/spelloutArtifacts.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const { values } = parseArgs({ options: {
  sentence: { type: 'string' }, framework: { type: 'string' }, model: { type: 'string' },
  effort: { type: 'string' }, out: { type: 'string' }, 'auth-file': { type: 'string' },
  'working-tree': { type: 'boolean', default: false },
  run: { type: 'boolean', default: false }, help: { type: 'boolean', default: false }
} });

if (values.help) {
  console.log(`Babel-only generation through a ChatGPT Codex subscription.
  --sentence TEXT --framework minimalism|xbar
  [--model openai:gpt-6.1-sol|openai:gpt-6-sol|openai:gpt-6-astra]
  --out NEW_DIRECTORY [--effort high] [--auth-file PATH] [--run]
Without --run, only saves the exact request and contract fingerprint; no login or network access.
Each invocation makes at most one request. No retries, API-key fallback, tools or agent context.
The Codex OAuth default is GPT-6.1 Sol at high reasoning effort.
Requires committed contract sources unless --working-tree explicitly fingerprints current sources.
Build Replay review with:
  npm run qualification:review -- --run NEW_DIRECTORY`);
  process.exit(0);
}

const { body, selection } = buildCodexQualificationRequest(values);
if (!values.out) throw new Error('--out must name a new artifact directory.');
const outputPath = path.resolve(values.out);
// Artifacts hold sentences, exact requests and model output. Everything this run and its
// fingerprint child create, including new parent directories, is readable only by the owner.
process.umask(0o077);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.mkdirSync(outputPath, { mode: 0o700 }); // Refuse reuse before any generation can occur.
const writeJson = (name, value) => fs.writeFileSync(path.join(outputPath, name), stableQualificationJson(value));
const requestBytes = Buffer.from(JSON.stringify(body), 'utf8');
fs.writeFileSync(path.join(outputPath, 'request.json'), requestBytes);
execFileSync(process.execPath, [path.join(repoRoot, 'scripts/captureContractFingerprint.mjs'),
  '--out', path.join(outputPath, 'contract.manifest.json'), '--label', 'codex-oauth-babel-only',
  ...(values['working-tree'] ? ['--allow-working-tree'] : [])
], { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] });
const contract = JSON.parse(fs.readFileSync(path.join(outputPath, 'contract.manifest.json'), 'utf8'));
const receipt = {
  schemaVersion: 1,
  transport: 'codex-oauth', endpoint: CODEX_RESPONSES_URL,
  request: { sentence: values.sentence, framework: values.framework,
    inputTokenization: describeInputTokenization(), model: selection },
  requestBody: { artifact: 'request.json', sha256: hashQualificationBytes(requestBytes) },
  contract,
  transportDifferencesFromApi: {
    inputEncoding: 'one user input_text message; exact Babel contents prompt',
    stream: true, store: false, background: 'omitted', max_output_tokens: 'omitted; backend controlled'
  },
  agentContext: false, providerCallsMade: false, status: 'prepared'
};
writeJson('run-receipt.json', receipt);
console.log(`Exact Babel request saved: ${path.join(outputPath, 'request.json')}`);

if (values.run) {
  const authPath = values['auth-file'] || path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json');
  const credentials = readCodexCredentials(authPath);
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
    endpoint: CODEX_RESPONSES_URL, client: receipt.client, snapshot: () => telemetry.snapshot() });
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
    const result = await requestCodexQualification({ body, credentials, dispatcher, signal: controller.signal,
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
      hypotheticalApiTokenCost: estimateApiTokenCost(result.response?.model ?? body.model, result.response?.usage),
      rawResponse: { artifact: 'response.sse', byteLength: rawBytes.length, sha256: hashQualificationBytes(rawBytes) },
      output: { artifact: 'output.txt', sha256: hashQualificationBytes(Buffer.from(text, 'utf8')) }
    });
    // Incomplete transport must never enter delimiter repair or masquerade as a complete analysis.
    if (result.status === 'completed') {
      runnerPhase = 'babel-processing';
      const processingStart = performance.now();
      const written = writeSpelloutAttempts({ outputPath, sentence: values.sentence, framework: values.framework, model: selection, text });
      receipt.processingDurationMs = Math.round((performance.now() - processingStart) * 1000) / 1000;
      receipt.attempts = written.map(artifacts => ({ attemptId: artifacts.reviewEntry.attemptId, outcome: artifacts.receipt.outcome }));
      writeJson('review-manifest.json', { schemaVersion: 1, entries: written.map(artifacts => artifacts.reviewEntry) });
      written.forEach(artifacts => console.log(`Babel processing (${artifacts.reviewEntry.attemptId}): ${artifacts.receipt.outcome.status}`));
      if (written.some(artifacts => artifacts.receipt.outcome.status === 'failed')) process.exitCode = 1;
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
