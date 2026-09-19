import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { Agent } from 'undici';

import { buildCodexQualificationRequest, readCodexCredentials,
  requestCodexQualification, CODEX_RESPONSES_URL } from '../contractQualification/codexOAuth.js';
import { writeQualificationAttempt } from '../contractQualification/artifacts.js';
import { hashQualificationBytes, stableQualificationJson } from '../contractQualification/run.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const { values } = parseArgs({ options: {
  sentence: { type: 'string' }, framework: { type: 'string' }, model: { type: 'string' },
  effort: { type: 'string' }, out: { type: 'string' }, 'auth-file': { type: 'string' },
  run: { type: 'boolean', default: false }, help: { type: 'boolean', default: false }
} });

if (values.help) {
  console.log(`Babel-only generation through a ChatGPT Codex subscription.
  --sentence TEXT --framework minimalism|xbar --model openai:gpt-5.6-sol|openai:gpt-6-astra
  --out NEW_DIRECTORY [--effort high] [--auth-file PATH] [--run]
Without --run, only saves the exact request and contract fingerprint; no login or network access.
Each invocation makes at most one request. No retries, API-key fallback, tools or agent context.
Requires committed contract sources. Build Replay review with:
  npm run qualification:review -- --run NEW_DIRECTORY`);
  process.exit(0);
}

const { body, selection, inputTokens } = buildCodexQualificationRequest(values);
if (!values.out) throw new Error('--out must name a new artifact directory.');
const outputPath = path.resolve(values.out);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.mkdirSync(outputPath, { mode: 0o700 }); // Refuse reuse before any generation can occur.
const writeJson = (name, value) => fs.writeFileSync(path.join(outputPath, name), stableQualificationJson(value));
const requestBytes = Buffer.from(JSON.stringify(body), 'utf8');
fs.writeFileSync(path.join(outputPath, 'request.json'), requestBytes);
execFileSync(process.execPath, [path.join(repoRoot, 'scripts/captureContractFingerprint.mjs'),
  '--out', path.join(outputPath, 'contract.manifest.json'), '--label', 'codex-oauth-babel-only'
], { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] });
const contract = JSON.parse(fs.readFileSync(path.join(outputPath, 'contract.manifest.json'), 'utf8'));
const receipt = {
  schemaVersion: 1,
  transport: 'codex-oauth', endpoint: CODEX_RESPONSES_URL,
  request: { sentence: values.sentence, framework: values.framework, inputTokens, model: selection },
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
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
  const rawPath = path.join(outputPath, 'response.sse');
  fs.writeFileSync(rawPath, '');
  receipt.startedAt = new Date().toISOString();
  receipt.status = 'request-started';
  receipt.providerCallsMade = true;
  writeJson('run-receipt.json', receipt);
  const start = performance.now();
  try {
    const result = await requestCodexQualification({ body, credentials, dispatcher, signal: controller.signal,
      onBytes: chunk => fs.appendFileSync(rawPath, chunk),
      onHeaders: headers => writeJson('response-headers.json', headers)
    });
    const { text, ...transportResult } = result;
    fs.writeFileSync(path.join(outputPath, 'output.txt'), text);
    const rawBytes = fs.readFileSync(rawPath);
    Object.assign(receipt, {
      completedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - start),
      status: result.status, result: transportResult,
      rawResponse: { artifact: 'response.sse', byteLength: rawBytes.length, sha256: hashQualificationBytes(rawBytes) },
      output: { artifact: 'output.txt', sha256: hashQualificationBytes(Buffer.from(text, 'utf8')) }
    });
    // Incomplete transport must never enter delimiter repair or masquerade as a complete analysis.
    if (result.status === 'completed') {
      const attempt = { id: 'parse', request: { sentence: values.sentence, framework: values.framework, inputTokens },
        model: selection, source: { kind: 'raw-text-file', path: 'output.txt' } };
      const artifacts = writeQualificationAttempt({ outputPath, attempt, rawBytes: Buffer.from(text, 'utf8') });
      receipt.attempts = [{ attemptId: attempt.id, outcome: artifacts.receipt.outcome }];
      writeJson('review-manifest.json', { schemaVersion: 1, entries: [artifacts.reviewEntry] });
      console.log(`Babel processing: ${artifacts.receipt.outcome.status}`);
      if (artifacts.receipt.outcome.status === 'failed') process.exitCode = 1;
    } else {
      process.exitCode = 1;
      console.error(result.error);
    }
    console.log(`Transport: ${result.status}. Artifacts: ${outputPath}`);
  } finally {
    writeJson('run-receipt.json', receipt);
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    await dispatcher.close();
  }
}
