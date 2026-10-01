import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { buildCodexQualificationRequest } from './codexOAuth.js';
import { hashQualificationBytes } from './run.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const runnerPath = path.join(repoRoot, 'scripts/runCodexQualification.mjs');
const MAX_BODY_BYTES = 16 * 1024;
const readJson = file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;

// Run the existing CLI unchanged so manual and batch generations share requests and provenance.
export const runManualQualification = async ({ request, outputPath, signal, spawnImpl = spawn }) => {
  const args = [runnerPath, '--sentence', request.sentence, '--framework', request.framework,
    '--model', request.model, '--effort', request.effort, '--out', outputPath, '--working-tree', '--run'];
  const child = spawnImpl(process.execPath, args, { cwd: repoRoot, stdio: 'ignore' });
  let killTimer;
  const cancel = () => {
    child.kill('SIGTERM');
    killTimer = setTimeout(() => child.kill('SIGKILL'), 15000);
    killTimer.unref();
  };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
  } finally {
    signal.removeEventListener('abort', cancel);
    clearTimeout(killTimer);
  }
  if (signal.aborted) return { status: 499, payload: { error: { code: 'CANCELLED', message: 'Request cancelled.' } } };

  const receipt = readJson(path.join(outputPath, 'run-receipt.json'));
  if (!receipt) return { status: 500, payload: { error: {
    code: 'HARNESS_ERROR', message: 'The local generation harness could not prepare this request.'
  } } };
  const bundle = readJson(path.join(outputPath, 'attempts/parse/bundle.json'));
  if (receipt?.status === 'completed' && bundle?.response?.analyses?.length) {
    return { status: 200, payload: { ...bundle.response, requestedModelId: request.model } };
  }
  const attempt = readJson(path.join(outputPath, 'attempts/parse/attempt-receipt.json'));
  const outputFile = path.join(outputPath, 'output.txt');
  const raw = fs.existsSync(outputFile) ? fs.readFileSync(outputFile) : null;
  const failure = attempt?.outcome?.failure;
  const authUnavailable = receipt?.status === 'prepared';
  return { status: 502, payload: { error: {
    code: authUnavailable ? 'CODEX_LOGIN_REQUIRED' : failure ? 'PARSE_FAILED' : 'CODEX_REQUEST_FAILED',
    message: authUnavailable ? 'Sign in with ChatGPT using codex login, then try again.'
      : failure?.message || receipt?.result?.error || 'Babel could not complete this analysis. The received output has been saved.',
    ...(failure ? { failure } : {}),
    ...(raw ? { rawOutput: { mediaType: 'text/plain; charset=utf-8', encoding: 'base64',
      byteLength: raw.length, retainedByteLength: raw.length, truncated: false,
      sha256: hashQualificationBytes(raw), data: raw.toString('base64') } } : {})
  } } };
};

/** Loopback-only app adapter. Browser input cannot select credentials, output paths or shell code. */
export const createManualParseMiddleware = ({ runsRoot, port, run = runManualQualification }) => {
  let active = null;
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const middleware = async (req, res, next) => {
    const send = (status, payload) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(payload));
    };
    if (!hosts.has(req.headers.host)) return send(403, { error: { code: 'FORBIDDEN_HOST', message: 'Use the local Babel app address.' } });
    if (req.url?.split('?')[0] !== '/api/parse') return next();
    if (req.method !== 'POST') return send(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST /api/parse.' } });
    if (req.headers.origin !== `http://${req.headers.host}`) {
      return send(403, { error: { code: 'FORBIDDEN_ORIGIN', message: 'Generate from the local Babel app.' } });
    }
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
      return send(415, { error: { code: 'INVALID_CONTENT_TYPE', message: 'Use application/json.' } });
    }
    if (active) return send(409, { error: { code: 'PARSE_IN_PROGRESS', message: 'Another parse is still running.' } });
    const controller = new AbortController();
    active = controller;
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', cancel);
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) return send(413, { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Sentence input is too large.' } });
        chunks.push(chunk);
      }
      let request;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const selection = buildCodexQualificationRequest({ sentence: body.sentence, framework: body.framework,
          model: body.modelId, effort: body.settings?.['reasoning.effort'] }).selection;
        request = { sentence: body.sentence, framework: body.framework, model: selection.catalogId,
          effort: selection.nativeSettings['reasoning.effort'] };
      } catch (error) {
        return send(400, { error: { code: 'INVALID_REQUEST', message: error instanceof SyntaxError ? 'Malformed JSON input.' : error.message } });
      }
      if (controller.signal.aborted) return;
      fs.mkdirSync(runsRoot, { recursive: true, mode: 0o700 });
      const outputPath = path.join(runsRoot, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`);
      const result = await run({ request, outputPath, signal: controller.signal });
      send(result.status, result.payload);
    } catch {
      send(500, { error: { code: 'HARNESS_ERROR', message: 'The local generation harness could not finish this request.' } });
    } finally {
      res.removeListener('close', cancel);
      active = null;
    }
  };
  middleware.cancel = () => active?.abort();
  return middleware;
};
