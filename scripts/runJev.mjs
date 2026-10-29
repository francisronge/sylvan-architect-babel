#!/usr/bin/env node
// Jev's pass after generation: for each analysis, ask once how the words of its
// neutral claims read in Babel's words, check the reply against the closed sets
// and save the checked answers as the analysis's Jev record (jev.json).
//
//   node scripts/runJev.mjs --cases cases.json --out DIR [--run] [--model ID] [--effort high] [--concurrency 2]
//
// cases.json lists { "source": "<bundle.json>", "analysis": 0 } entries. Without
// --run, each request is saved and nothing is sent. With --run, requests go only
// through the Codex subscription login (contractQualification/codexOAuth.js): one
// request per analysis, no retries, at most two at a time. Every request, the
// received bytes, the reply check and the record are kept, readable only by the owner.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { readCodexCredentials, requestCodexQualification } from '../contractQualification/codexOAuth.js';
import { JEV_PROMPT_VERSION, buildJevRequest, jevRecordFrom, readJevReply } from '../contractQualification/jev.js';
import { neutralJevClaims } from '../replay/jevClaims.ts';

const { values: args } = parseArgs({ options: {
  cases: { type: 'string' }, out: { type: 'string' }, run: { type: 'boolean', default: false },
  model: { type: 'string' }, effort: { type: 'string', default: 'high' },
  concurrency: { type: 'string', default: '2' }, 'auth-file': { type: 'string' }
} });
if (!args.cases || !args.out) throw new Error('Use --cases FILE --out DIR.');
const concurrency = Number(args.concurrency);
if (!(concurrency >= 1 && concurrency <= 2)) throw new Error('Jev sends at most two requests at a time.');

const writePrivate = (file, data) => fs.writeFileSync(file, data, { mode: 0o600, flag: 'wx' });
fs.mkdirSync(args.out, { recursive: true, mode: 0o700 });
const credentials = args.run ? readCodexCredentials(args['auth-file']
  ?? path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'auth.json')) : undefined;

const cases = JSON.parse(fs.readFileSync(args.cases, 'utf8'));
const runOne = async ({ source, analysis }, index) => {
  const bundle = JSON.parse(fs.readFileSync(source, 'utf8')).response;
  const claims = neutralJevClaims(bundle.analyses[analysis].derivationStages);
  const dir = path.join(args.out, String(index).padStart(4, '0'));
  fs.mkdirSync(dir, { mode: 0o700 });
  const request = buildJevRequest({ claims, ...(args.model ? { model: args.model } : {}), effort: args.effort });
  const requestText = JSON.stringify(request.body, null, 1);
  writePrivate(path.join(dir, 'request.json'), requestText);
  const receipt = { source, analysis, claims: claims.length, promptVersion: JEV_PROMPT_VERSION,
    model: request.selection.catalogId, effort: request.selection.nativeSettings['reasoning.effort'],
    requestSha256: createHash('sha256').update(requestText).digest('hex') };
  if (!claims.length || !args.run) {
    writePrivate(path.join(dir, 'receipt.json'), JSON.stringify({ ...receipt, sent: false }, null, 1));
    return;
  }
  const sse = fs.openSync(path.join(dir, 'response.sse'), 'wx', 0o600);
  const started = Date.now();
  const result = await requestCodexQualification({ body: request.body, credentials, onBytes: bytes => fs.writeSync(sse, bytes) });
  fs.closeSync(sse);
  const elapsedMs = Date.now() - started;
  const reply = result.status === 'completed' ? readJevReply(result.text, claims) : undefined;
  writePrivate(path.join(dir, 'output.txt'), result.text ?? '');
  const provenance = { ...receipt, responseId: result.responseId, at: new Date(started).toISOString() };
  if (reply) {
    writePrivate(path.join(dir, 'reply-check.json'), JSON.stringify(reply, null, 1));
    writePrivate(path.join(dir, 'jev.json'), JSON.stringify(jevRecordFrom({ claims, results: reply.results, provenance }), null, 1));
  }
  writePrivate(path.join(dir, 'receipt.json'), JSON.stringify({ ...receipt, sent: true, status: result.status,
    error: result.error, httpStatus: result.httpStatus, responseId: result.responseId, elapsedMs,
    usage: result.response?.usage ?? null }, null, 1));
  console.log(`${index} ${result.status} ${claims.length} claims ${elapsedMs} ms`);
};

let next = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < cases.length) {
    const index = next++;
    await runOne(cases[index], index).catch(error => console.error(`${index} local failure: ${error.message}`));
  }
}));
