#!/usr/bin/env node
// Jev's pass after generation: for each analysis, ask TypeSafe's Jev how the words
// of each neutral claim read in Babel's words, check every answer against the
// options asked and save the checked readings as the analysis's Jev record (jev.json).
//
//   node scripts/runJev.mjs --cases cases.json --out DIR (--dry-run | --run)
//     [--key-file PATH | --keychain-item NAME] [--model jev-1.14.0] [--concurrency 2]
//
// cases.json lists { "source": "<bundle.json>", "analysis": 0 } entries. --dry-run
// builds and saves every first request and sizes the second, with no key and no
// network. --run reads the key into memory (contractQualification/jev.js) and sends
// each request once, with no retries. Every request, the received bytes, the answer
// check and the record are kept, readable only by the owner. The key is never saved.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import {
  DEFAULT_JEV_MODEL, DEFAULT_TYPESAFE_KEYCHAIN_SERVICE, JEV_PROMPT_VERSION, TYPESAFE_SYSTEMONE_URL,
  anchorIdsReachRequest, askableFamilies, buildFamilyRequest, buildReadingRequest, estimateJevCost, jevClaimResult, jevRecordFrom,
  readSystemOneResponse, readTypeSafeApiKey, requestJev
} from '../contractQualification/jev.js';
import { neutralJevClaims } from '../replay/jevClaims.ts';
import { JEV_CONFIDENCE_THRESHOLD, JEV_NONE } from '../replay/relations/jev.ts';

const { values: args } = parseArgs({ options: {
  cases: { type: 'string' }, out: { type: 'string' }, run: { type: 'boolean', default: false },
  'dry-run': { type: 'boolean', default: false }, model: { type: 'string', default: DEFAULT_JEV_MODEL },
  concurrency: { type: 'string', default: '2' }, 'key-file': { type: 'string' },
  'keychain-item': { type: 'string', default: DEFAULT_TYPESAFE_KEYCHAIN_SERVICE }
} });
if (!args.cases || !args.out) throw new Error('Use --cases FILE --out DIR with --dry-run or --run.');
if (args.run === args['dry-run']) throw new Error('Use exactly one of --dry-run and --run.');
const concurrency = Number(args.concurrency);
if (!(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 8)) throw new Error('Use --concurrency 1 to 8.');
if (fs.existsSync(args.out)) throw new Error(`${args.out} exists; each invocation needs a new output directory.`);

// Read before any directory is made, so a missing key fails before anything is written.
const apiKey = args.run ? readTypeSafeApiKey({ keyFile: args['key-file'], service: args['keychain-item'] }) : undefined;
fs.mkdirSync(args.out, { recursive: true, mode: 0o700 });
const writePrivate = (file, data) => fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 1),
  { mode: 0o600, flag: 'wx' });
const sha256 = text => createHash('sha256').update(text).digest('hex');
// No tokenizer is published. The first live benchmark (1,005 requests) was billed one input token
// per 2.06 characters of request JSON; a dry run sizes requests at 2 characters a token.
const CHARACTERS_PER_TOKEN = 2;
const estimateTokens = text => Math.ceil(text.length / CHARACTERS_PER_TOKEN);


const totals = { analyses: 0, claims: 0, withheld: 0, requests: { family: 0, reading: 0 }, failed: 0,
  inputTokens: 0, outputTokens: 0, estimatedInputTokens: { family: 0, readingUpperBound: 0 }, statuses: {} };
const count = status => { totals.statuses[status] = (totals.statuses[status] ?? 0) + 1; };

const send = async (dir, name, requestBody) => {
  const text = JSON.stringify(requestBody);
  writePrivate(path.join(dir, `${name}.request.json`), text);
  totals.requests[name] += 1;
  const started = Date.now();
  const sent = await requestJev({ body: requestBody, apiKey });
  writePrivate(path.join(dir, `${name}.response.json`), sent.text ?? '');
  const receipt = { name, requestSha256: sha256(text), status: sent.status, httpStatus: sent.httpStatus,
    error: sent.error, model: sent.json?.model ?? null, usage: sent.json?.usage ?? null, elapsedMs: Date.now() - started };
  if (sent.status !== 'completed') totals.failed += 1;
  totals.inputTokens += receipt.usage?.input_tokens ?? 0;
  totals.outputTokens += receipt.usage?.output_tokens ?? 0;
  return { sent, receipt };
};

const askClaim = async (dir, { relation }) => {
  const families = askableFamilies(relation);
  // With no family able to read the whole claim, the only answer is none: nothing is asked.
  if (!families.length) return { result: { status: 'no-family-can-read' }, receipts: [] };
  const family = buildFamilyRequest({ relation, model: args.model });
  const familyText = JSON.stringify(family);
  // An anchor id in a request would carry the tree to Jev; such a claim is withheld.
  if (anchorIdsReachRequest(relation, candidate => buildFamilyRequest({ relation: candidate, model: args.model })))
    return { result: { status: 'withheld' }, receipts: [] };
  totals.estimatedInputTokens.family += estimateTokens(familyText);
  // The second request reads one family; size the largest so the dry run bounds it.
  totals.estimatedInputTokens.readingUpperBound += Math.max(...families.map(candidate =>
    estimateTokens(JSON.stringify(buildReadingRequest({ relation, family: candidate.id, model: args.model }).body))));
  if (args['dry-run']) {
    writePrivate(path.join(dir, 'family.request.json'), familyText);
    totals.requests.family += 1;
    return { result: { status: 'not-sent' }, receipts: [] };
  }
  const first = await send(dir, 'family', family);
  if (first.sent.status !== 'completed') return { result: { status: 'transport-failed' }, receipts: [first.receipt] };
  const familyRead = readSystemOneResponse(first.sent.json, family.questions);
  const chosen = familyRead.ok ? familyRead.answers.family.choice : JEV_NONE;
  if (chosen === JEV_NONE) return { result: jevClaimResult(relation, familyRead), familyRead, receipts: [first.receipt] };
  const reading = buildReadingRequest({ relation, family: chosen, model: args.model });
  if (anchorIdsReachRequest(relation, candidate => buildReadingRequest({ relation: candidate, family: chosen, model: args.model }).body))
    return { result: { status: 'withheld' }, receipts: [first.receipt] };
  const second = await send(dir, 'reading', reading.body);
  if (second.sent.status !== 'completed') return { result: { status: 'transport-failed' }, receipts: [first.receipt, second.receipt] };
  const readingRead = readSystemOneResponse(second.sent.json, reading.body.questions);
  return { result: jevClaimResult(relation, familyRead, { read: readingRead, options: reading.options }),
    familyRead, readingRead, receipts: [first.receipt, second.receipt] };
};

const cases = JSON.parse(fs.readFileSync(args.cases, 'utf8'));
const runAnalysis = async ({ source, analysis }, index) => {
  const bundle = JSON.parse(fs.readFileSync(source, 'utf8')).response;
  const claims = neutralJevClaims(bundle.analyses[analysis].derivationStages);
  const dir = path.join(args.out, String(index).padStart(4, '0'));
  fs.mkdirSync(dir, { mode: 0o700 });
  totals.analyses += 1;
  totals.claims += claims.length;
  const started = new Date().toISOString();
  const outcomes = [];
  for (const claim of claims) {
    const claimDir = path.join(dir, claim.id);
    fs.mkdirSync(claimDir, { mode: 0o700 });
    const outcome = await askClaim(claimDir, claim);
    if (outcome.result.status === 'withheld') totals.withheld += 1;
    count(outcome.result.status);
    writePrivate(path.join(claimDir, 'claim-check.json'), { id: claim.id, ...outcome });
    outcomes.push(outcome);
  }
  const models = [...new Set(outcomes.flatMap(outcome => outcome.receipts.map(receipt => receipt.model).filter(Boolean)))];
  writePrivate(path.join(dir, 'receipt.json'), { source, analysis, claims: claims.length, promptVersion: JEV_PROMPT_VERSION,
    endpoint: TYPESAFE_SYSTEMONE_URL, requestedModel: args.model, sent: args.run, models, at: started });
  if (args.run) writePrivate(path.join(dir, 'jev.json'), jevRecordFrom({ claims, results: outcomes.map(outcome => outcome.result),
    provenance: { service: 'typesafe', requestedModel: args.model, models, promptVersion: JEV_PROMPT_VERSION, at: started,
      thresholdAtRun: JEV_CONFIDENCE_THRESHOLD } }));
  console.log(`${index} ${claims.length} claims ${outcomes.map(outcome => outcome.result.status).join(' ')}`);
};

let next = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < cases.length) {
    const index = next++;
    await runAnalysis(cases[index], index).catch(error => {
      count('local-failure');
      console.error(`${index} local failure: ${error.message}`);
    });
  }
}));

const priced = estimateJevCost(args.model, { inputTokens: args.run ? totals.inputTokens
  : totals.estimatedInputTokens.family + totals.estimatedInputTokens.readingUpperBound });
const summary = { mode: args.run ? 'run' : 'dry-run', model: args.model, promptVersion: JEV_PROMPT_VERSION, ...totals,
  cost: { ...priced, basis: args.run ? 'reported input tokens' : `estimated tokens (${CHARACTERS_PER_TOKEN} characters each), every claim given its largest second request` } };
writePrivate(path.join(args.out, 'summary.json'), summary);
console.log(JSON.stringify(summary, null, 1));
