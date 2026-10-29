import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ParseApiError } from '../server/babelParser/error.js';
import { parseModelJsonDetailed } from '../server/babelParser/modelJson.js';
import { normalizeParseBundle } from '../server/babelParser/parseNormalization.js';
import { createParseRoutes } from '../server/babelParser/parseRoutes.js';
import { runManualQualification } from '../contractQualification/manualServer.js';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { JEV_CONFIDENCE_THRESHOLD, JEV_RECORD_VERSION, jevTerms } from '../replay/relations/jev.ts';
import { prepareTreeBankSave, restoreTreeBankBundle, validateTreeBankRecord } from '../services/treeBankRecords.ts';
import { createTreeBankBundleSnapshot } from '../treeBankSnapshot.js';
import { restateAsSpellout } from './helpers/spelloutPayload.mjs';

// "selection and internal theta-role" {selector, argument; thetaRole: Theme} in "Juon kahvia.":
// recognition leaves it neutral, and read as a theta grid Babel's checks draw it.
const CASE = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/plaque-hold-pockets.json', import.meta.url), 'utf8')).cases[4];
const THETA = { stageIndex: 1, relationIndex: 0, relation: 'selection and internal theta-role' };
const THETA_READING = { family: 'theta-grid', roles: { selector: 'predicate', argument: 'theta.arguments' }, values: { thetaRole: 'role.label' } };
const KEY = 'test-jev-key-3f9c';
const RAW = JSON.stringify(restateAsSpellout({ derivationStages: CASE.derivationStages }, CASE.sentence, CASE.inputTokens));

/** A Choice answer as TypeSafe returns it, its confidence by the documented formula. */
const choiceAnswer = (options, chosen, p) => {
  const rest = options.length > 1 ? (1 - p) / (options.length - 1) : 0;
  const probabilities = Object.fromEntries(options.map(option => [option, option === chosen ? p : rest]));
  const n = options.length;
  return { type: 'choice', choice: chosen, confidence: n < 2 ? 1 : (p - 1 / n) / (1 - 1 / n), probabilities };
};
const reply = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

/** Jev as a stub: reads the theta claim as THETA_READING at confidence `p`, every other claim as none.
 * `override(body, claim)` may answer a request instead. Every call is recorded. */
const stubJev = ({ p = 0.95, override } = {}) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    const own = override?.(body, init);
    if (own !== undefined) return own;
    const theta = body.state.claim.relation === THETA.relation;
    const answers = Object.fromEntries(Object.entries(body.questions).map(([id, question]) => {
      const options = Object.keys(question.criteria);
      const wanted = !theta ? 'none'
        : id === 'family' ? THETA_READING.family
          : options.find(name => (id === 'reading'
            ? name === 'argument → theta.arguments; selector → predicate' : name === 'thetaRole → role.label'));
      return [id, choiceAnswer(options, wanted, p)];
    }));
    return reply({ model: 'jev-1.14.0', usage: { input_tokens: 100, output_tokens: 4 }, answers });
  };
  return { calls, fetchImpl };
};

const parseWith = async (jev, framework = 'minimalism') => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-openai-key';
  try {
    const routes = createParseRoutes({ ParseApiError, normalizeParseBundle, parseModelJsonDetailed, jev,
      generateOpenAI: async () => ({ text: RAW, status: 'completed', candidates: [{ finishReason: 'COMPLETED' }] }) });
    // As the browser receives it.
    return JSON.parse(JSON.stringify(await routes.parseSentenceWithResearchModel(CASE.sentence, framework, 'openai:gpt-6-astra')));
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
};

const thetaMapping = analysis => analysis.jevReadings?.mappings.find(mapping =>
  mapping.stageIndex === THETA.stageIndex && mapping.relationIndex === THETA.relationIndex);
const outcomeOf = (result, claim) => result.generationRecord.jev.analyses[0].outcomes.find(outcome => outcome.claim === claim);
const plan = (analysis, bundle, jev) => prepareReplay({ derivationStages: analysis.derivationStages, sentence: CASE.sentence,
  inputTokens: bundle.inputTokens, includePlayback: false, ...(jev ? { jev } : {}) }).relationRenderPlan;
const thetaTiers = relationPlan => [...new Set(relationPlan.frames.flatMap(frame => frame?.items ?? [])
  .filter(item => item.relationRef?.stageIndex === THETA.stageIndex && item.relationRef?.relationIndex === THETA.relationIndex)
  .map(item => (item.claimTier === 2 ? `2 ${item.tier2FacetId}` : String(item.claimTier))))];

test('a valid parse carries Jev\'s checked readings, and Replay draws them from the response alone', async () => {
  const jev = stubJev();
  const result = await parseWith({ apiKey: () => KEY, fetchImpl: jev.fetchImpl });
  const [analysis] = result.analyses;
  assert.ok(jev.calls.length >= 3, 'the theta claim is asked twice, the other neutral claim once');
  for (const { url, init } of jev.calls) {
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(init.headers.Authorization, `Bearer ${KEY}`);
  }
  assert.equal(analysis.jevReadings.version, JEV_RECORD_VERSION);
  const mapping = thetaMapping(analysis);
  assert.deepEqual(mapping.answer, THETA_READING);
  assert.deepEqual(mapping.terms, jevTerms(analysis.derivationStages[THETA.stageIndex].relations[THETA.relationIndex]));
  assert.ok(mapping.confidence >= JEV_CONFIDENCE_THRESHOLD && mapping.confidence <= 0.95);
  assert.equal(analysis.jevReadings.provenance.requestedModel, 'jev-1.14.0');
  assert.equal(analysis.jevReadings.provenance.promptVersion, 'jev-ts-2');
  assert.deepEqual(analysis.jevReadings.provenance.models, ['jev-1.14.0']);
  // Generation provenance records the model, prompt version and every claim's outcome.
  const pass = result.generationRecord.jev;
  assert.equal(pass.status, 'completed');
  assert.deepEqual([pass.service, pass.requestedModel, pass.promptVersion, pass.thresholdAtRun, pass.budgetMs],
    ['typesafe', 'jev-1.14.0', 'jev-ts-2', 0.7, 8000]);
  assert.deepEqual(outcomeOf(result, 's2r1'), { claim: 's2r1', status: 'proposal' });
  assert.equal(pass.usage.inputTokens, 100 * jev.calls.length);
  // The key never reaches the response.
  assert.equal(JSON.stringify(result).includes(KEY), false);
  // Replay applies the saved reading without any call.
  const before = jev.calls.length;
  assert.deepEqual(thetaTiers(plan(analysis, result)), ['3']);
  assert.deepEqual(thetaTiers(plan(analysis, result, analysis.jevReadings)).filter(tier => tier !== '3'), ['2 theta-grid']);
  assert.equal(jev.calls.length, before);
});

test('no request to Jev carries the sentence, a word, a node id or an anchor id', async () => {
  const jev = stubJev();
  const result = await parseWith({ apiKey: () => KEY, fetchImpl: jev.fetchImpl });
  const ids = new Set();
  const visit = node => { if (!node || typeof node !== 'object') return; if (node.id) ids.add(node.id); (node.children ?? []).forEach(visit); };
  for (const stage of result.analyses[0].derivationStages) {
    stage.workspaceForest.forEach(visit);
    for (const relation of stage.relations) for (const value of Object.values(relation.anchors ?? {})) [value].flat().forEach(id => ids.add(id));
  }
  assert.ok(ids.size > 5);
  assert.ok(jev.calls.length >= 3, 'both neutral claims were asked');
  for (const { init, body } of jev.calls) {
    assert.deepEqual(Object.keys(body), ['model', 'state', 'questions']);
    assert.deepEqual(Object.keys(body.state), ['claim']);
    for (const id of ids) assert.equal(init.body.includes(JSON.stringify(id)), false, id);
    for (const word of [CASE.sentence, ...CASE.inputTokens]) assert.equal(init.body.includes(word), false, word);
    assert.equal(init.body.includes(KEY), false);
  }
});

test('a Jev request that outlasts the budget gives no reading and does not hold the parse', async () => {
  // The theta claim's request never answers and ignores its abort signal.
  const jev = stubJev({ override: body => (body.state.claim.relation === THETA.relation ? new Promise(() => {}) : undefined) });
  const started = Date.now();
  const result = await parseWith({ apiKey: () => KEY, fetchImpl: jev.fetchImpl, budgetMs: 1000 });
  assert.ok(Date.now() - started < 5000, 'the parse returns once the budget is spent');
  assert.equal(thetaMapping(result.analyses[0]), undefined);
  assert.equal(result.generationRecord.jev.status, 'partial');
  assert.equal(result.generationRecord.jev.budgetMs, 1000);
  assert.equal(outcomeOf(result, 's2r1').status, 'timed-out');
  // The claim that answered keeps its answer.
  assert.equal(outcomeOf(result, 's7r2').status, 'no-drawing');
  assert.equal(result.analyses[0].derivationStages.length, CASE.derivationStages.length);
});

test('a failed Jev request gives no reading for its claim, and the parse succeeds', async () => {
  const jev = stubJev({ override: body => {
    if (body.state.claim.relation === THETA.relation) return reply('{"detail":"overloaded"}', 529);
    throw new TypeError('fetch failed');
  } });
  const result = await parseWith({ apiKey: () => KEY, fetchImpl: jev.fetchImpl });
  assert.equal(result.analyses[0].jevReadings, undefined);
  assert.equal(result.generationRecord.jev.status, 'partial');
  assert.deepEqual(outcomeOf(result, 's2r1'), { claim: 's2r1', status: 'transport-failed', httpStatus: 529, errors: ['HTTP 529'] });
  assert.deepEqual(outcomeOf(result, 's7r2'), { claim: 's7r2', status: 'transport-failed', httpStatus: null, errors: ['transport: TypeError'] });
  assert.equal(jev.calls.length, 2, 'no retries');
  assert.equal(JSON.stringify(result.generationRecord.jev).includes('overloaded'), false, 'the provider\'s text is not kept');
});

test('without a key Jev is not asked, and the response has no readings', async () => {
  const jev = stubJev();
  const result = await parseWith({ apiKey: () => '', fetchImpl: jev.fetchImpl });
  assert.equal(jev.calls.length, 0);
  assert.equal(result.analyses.some(analysis => 'jevReadings' in analysis), false);
  assert.deepEqual(result.generationRecord.jev, { service: 'typesafe', requestedModel: 'jev-1.14.0', promptVersion: 'jev-ts-2',
    thresholdAtRun: 0.7, budgetMs: 8000, status: 'not-configured', reason: 'TYPESAFE_API_KEY is not set.' });
});

test('the server reads its key only from TYPESAFE_API_KEY', async () => {
  const { readJevApiKey } = await import('../server/babelParser/jevPass.js');
  assert.equal(readJevApiKey({ TYPESAFE_API_KEY: ' key-1\n' }), 'key-1');
  assert.equal(readJevApiKey({}), '');
  assert.equal(readJevApiKey({ OPENAI_API_KEY: 'x', ANTHROPIC_API_KEY: 'y' }), '');
});

test('an answer outside the options asked gives no reading', async () => {
  for (const [what, bad] of [
    ['a family not offered', id => (id === 'family' ? 'selection.arrow' : undefined)],
    ['a reading not offered', id => (id === 'reading' ? 'selector → predicate' : undefined)]
  ]) {
    const inner = stubJev();
    const jev = stubJev({ override: (body, init) => (body.state.claim.relation !== THETA.relation ? undefined : (async () => {
      const answered = await (await inner.fetchImpl('', init)).json();
      for (const id of Object.keys(answered.answers)) {
        const choice = bad(id);
        if (choice) answered.answers[id] = { ...answered.answers[id], choice };
      }
      return reply(answered);
    })()) });
    const result = await parseWith({ apiKey: () => KEY, fetchImpl: jev.fetchImpl });
    assert.equal(thetaMapping(result.analyses[0]), undefined, what);
    const outcome = outcomeOf(result, 's2r1');
    assert.equal(outcome.status, 'out-of-set', what);
    assert.match(outcome.errors.join(' '), /not offered|not the most probable/u, what);
    assert.equal(result.generationRecord.jev.status, 'completed', what);
  }
});

test('Replay applies a saved reading at 0.7 and not below', () => {
  assert.equal(JEV_CONFIDENCE_THRESHOLD, 0.7);
  const terms = jevTerms(CASE.derivationStages[THETA.stageIndex].relations[THETA.relationIndex]);
  const record = confidence => ({ version: JEV_RECORD_VERSION, mappings: [{ stageIndex: THETA.stageIndex,
    relationIndex: THETA.relationIndex, terms, answer: THETA_READING, confidence }] });
  const bundle = { inputTokens: CASE.inputTokens };
  const baseline = JSON.stringify(plan(CASE, bundle));
  assert.deepEqual(thetaTiers(plan(CASE, bundle, record(0.7))).filter(tier => tier !== '3'), ['2 theta-grid']);
  assert.equal(JSON.stringify(plan(CASE, bundle, record(0.69))), baseline);
});

test('the Tree Bank saves readings with the analysis, and reopening draws what was drawn', async () => {
  const result = await parseWith({ apiKey: () => KEY, fetchImpl: stubJev().fetchImpl });
  const bundle = { ...result, sentence: CASE.sentence };
  const save = { id: 'work', sentence: CASE.sentence, framework: 'minimalism', activeParseIndex: 0,
    createdAt: '2026-10-29T00:00:00Z', updatedAt: '2026-10-29T00:00:00Z', bundle };
  const saved = await prepareTreeBankSave(save);
  const restored = await restoreTreeBankBundle(saved.work, saved.records);
  assert.deepEqual(restored.analyses[0].jevReadings, bundle.analyses[0].jevReadings);
  assert.deepEqual(restored.generationRecord.jev, bundle.generationRecord.jev);
  const drawn = JSON.stringify(plan(bundle.analyses[0], bundle, bundle.analyses[0].jevReadings));
  assert.equal(JSON.stringify(plan(restored.analyses[0], restored, restored.analyses[0].jevReadings)), drawn);
  assert.notEqual(JSON.stringify(plan(restored.analyses[0], restored)), drawn);
  assert.deepEqual(createTreeBankBundleSnapshot(bundle).analyses[0].jevReadings, bundle.analyses[0].jevReadings);
  // A record saved before Jev reopens as it was.
  const { jevReadings: _readings, ...earlier } = bundle.analyses[0];
  const old = await prepareTreeBankSave({ ...save, bundle: { ...bundle, analyses: [earlier] } });
  const reopened = await restoreTreeBankBundle(old.work, old.records);
  assert.equal('jevReadings' in reopened.analyses[0], false);
  assert.equal(JSON.stringify(plan(reopened.analyses[0], reopened)), JSON.stringify(plan(earlier, bundle)));
});

test('malformed readings are refused by the Tree Bank and the contract check', async () => {
  const result = await parseWith({ apiKey: () => KEY, fetchImpl: stubJev().fetchImpl });
  const good = result.analyses[0].jevReadings;
  const [mapping] = good.mappings;
  const bad = {
    'another version': { ...good, version: 1 },
    'no mappings': { version: JEV_RECORD_VERSION },
    'an unknown field': { ...good, note: 'x' },
    'a confidence above one': { ...good, mappings: [{ ...mapping, confidence: 1.2 }] },
    'a text confidence': { ...good, mappings: [{ ...mapping, confidence: '0.9' }] },
    'no position': { ...good, mappings: [{ ...mapping, stageIndex: -1 }] },
    'a malformed answer': { ...good, mappings: [{ ...mapping, answer: { family: 'theta-grid', roles: { selector: ['predicate'] }, values: {} } }] },
    'an unknown mapping field': { ...good, mappings: [{ ...mapping, nodeId: 'n1' }] },
    'not an object': 'theta-grid'
  };
  const save = jevReadings => prepareTreeBankSave({ id: 'work', sentence: CASE.sentence, framework: 'minimalism', activeParseIndex: 0,
    createdAt: '2026-10-29T00:00:00Z', updatedAt: '2026-10-29T00:00:00Z',
    bundle: { ...result, sentence: CASE.sentence, analyses: [{ ...result.analyses[0], jevReadings }] } });
  await save(good);
  for (const [what, jevReadings] of Object.entries(bad)) await assert.rejects(save(jevReadings), /Invalid Jev readings/u, what);
  // A stored record is checked again when it is read.
  const saved = await save(good);
  const record = saved.records.find(entry => entry.kind === 'analysis');
  await assert.rejects(validateTreeBankRecord({ ...record, payload: { ...record.payload, jevReadings: bad['a confidence above one'] } }));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'babel-jev-contract-'));
  try {
    const verify = analysis => {
      const file = path.join(dir, `${Math.random().toString(36).slice(2)}.json`);
      fs.writeFileSync(file, JSON.stringify({ ...result, sentence: CASE.sentence, analyses: [analysis] }));
      try {
        execFileSync(process.execPath, ['scripts/verifyParseContract.mjs', file], { cwd: path.resolve(import.meta.dirname, '..'), stdio: 'pipe' });
        return '';
      } catch (error) { return String(error.stdout); }
    };
    assert.equal(verify(result.analyses[0]), '', 'a valid record passes');
    assert.match(verify({ ...result.analyses[0], jevReadings: bad['a confidence above one'] }), /jevReadings: Jev mapping 0 has no confidence/u);
    const renamed = { ...good, mappings: [{ ...mapping, terms: { ...mapping.terms, relation: 'another relation' } }] };
    assert.match(verify({ ...result.analyses[0], jevReadings: renamed }), /does not name a relation of this analysis/u);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the local app reads a completed run with Jev only when asked to, and leaves the run unchanged', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'babel-jev-manual-'));
  try {
    const response = JSON.parse(JSON.stringify(normalizeParseBundle({ derivationStages: CASE.derivationStages }, 'minimalism',
      CASE.sentence, 'gpt', true, { inputTokens: CASE.inputTokens })));
    const runAt = name => {
      const outputPath = path.join(dir, name);
      fs.mkdirSync(path.join(outputPath, 'attempts/parse'), { recursive: true });
      fs.writeFileSync(path.join(outputPath, 'run-receipt.json'), JSON.stringify({ status: 'completed' }));
      fs.writeFileSync(path.join(outputPath, 'attempts/parse/bundle.json'), JSON.stringify({ response }));
      return outputPath;
    };
    const spawnImpl = () => { const child = new EventEmitter(); queueMicrotask(() => child.emit('close', 0)); return child; };
    const request = { sentence: CASE.sentence, framework: 'minimalism', model: 'openai:gpt-6.1-sol', effort: 'high' };
    const plain = await runManualQualification({ request, outputPath: runAt('plain'), signal: new AbortController().signal, spawnImpl });
    assert.deepEqual(plain.payload, { ...response, requestedModelId: request.model });
    const jev = stubJev();
    const outputPath = runAt('jev');
    const read = await runManualQualification({ request, outputPath, signal: new AbortController().signal, spawnImpl,
      jev: { apiKey: KEY, fetchImpl: jev.fetchImpl } });
    assert.deepEqual(thetaMapping(read.payload.analyses[0]).answer, THETA_READING);
    assert.equal(read.payload.generationRecord.jev.status, 'completed');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outputPath, 'attempts/parse/bundle.json'))), { response }, 'the run is unchanged');
    const saved = fs.readFileSync(path.join(outputPath, 'jev-pass.json'), 'utf8');
    assert.equal(fs.statSync(path.join(outputPath, 'jev-pass.json')).mode & 0o777, 0o600);
    assert.equal(saved.includes(KEY), false);
    assert.deepEqual(JSON.parse(saved).readings[0], read.payload.analyses[0].jevReadings);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
