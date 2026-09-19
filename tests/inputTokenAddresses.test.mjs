import assert from 'node:assert/strict';
import test from 'node:test';
import { __test__ as parser, ParseApiError } from '../server/babelParser.js';
import { createParseRoutes } from '../server/babelParser/parseRoutes.js';
import { buildParseContentsPrompt } from '../server/babelParser/prompts.js';
import { resolveSavedInputTokens, tokenizeSentenceSurfaceOrder } from '../server/babelParser/surfaceTokens.js';
import { createTreeBankBundleSnapshot, loadTreeBankBundleSnapshot } from '../treeBankSnapshot.js';
import { buildReplaySnapshotProjection } from '../replay/replaySnapshot.ts';
import { tokenizeReplaySentenceSurface } from '../replay/replayCompiler.ts';
import { runQualificationAttempt, validateQualificationPlan } from '../contractQualification/run.js';
import { buildCodexQualificationRequest } from '../contractQualification/codexOAuth.js';

const payloadFor = inputTokens => ({ derivationStages: [{
  statement: 'The complete phrase is established.',
  stageRecord: 'The supplied words form the phrase.', relations: [],
  workspaceForest: [{ id: 'root', label: 'DP', children: inputTokens.map((word, tokenIndex) => ({
    id: `word${tokenIndex}`, label: 'N', word, tokenIndex, children: []
  })) }]
}] });

test('new token addresses do not classify apostrophe-s as English morphology', () => {
  for (const sentence of ["Mia's book", "It's blue", 'Mia’s book', 'It’s blue']) {
    const tokens = tokenizeSentenceSurfaceOrder(sentence);
    assert.deepEqual(tokens, sentence.split(' '));
    for (const route of ['gpt', 'claude', 'grok', 'kimi', 'gemini', 'local']) {
      const prompt = buildParseContentsPrompt(sentence, 'xbar', route, tokens);
      assert.deepEqual(JSON.parse(prompt.split('Input tokens, indexed from zero: ')[1]), tokens);
    }
  }
  const request = { sentence: 'Mia’s book', framework: 'xbar' };
  const codex = buildCodexQualificationRequest({ ...request, model: 'openai:gpt-5.6-sol', effort: 'high' });
  assert.deepEqual(codex.inputTokens, ['Mia’s', 'book']);
  const plan = validateQualificationPlan({ schemaVersion: 1, label: 'token-address-test',
    purpose: 'Saved input addresses only.', itemSetStatus: 'unselected', contractManifest: 'unused.json',
    attempts: [{ id: 'saved', request: { ...request, inputTokens: codex.inputTokens },
      model: { catalogId: 'openai:gpt-5.6-sol', nativeSettings: { 'reasoning.effort': 'high' } },
      source: { kind: 'raw-text-file', path: 'unused.txt' } }] });
  const result = runQualificationAttempt({ attempt: plan.attempts[0],
    rawOutputBytes: Buffer.from(JSON.stringify(payloadFor(codex.inputTokens))) });
  assert.equal(result.receipt.outcome.status, 'valid-pending-review');
  assert.deepEqual(result.bundle.inputTokens, codex.inputTokens);
});

test('normalization, saved snapshots and Replay retain supplied addresses without retokenization', t => {
  const sentence = 'Mia’s book';
  const inputTokens = ['Mia’s', 'book'];
  const payload = payloadFor(inputTokens);
  t.mock.method(Intl, 'Segmenter', () => { throw new Error('Must use the sent token list'); });
  const bundle = { ...parser.normalizeParseBundle(payload, 'xbar', sentence, 'fixture', true, { inputTokens }), sentence };
  inputTokens[0] = 'caller mutation';
  assert.deepEqual(bundle.inputTokens, ['Mia’s', 'book']);
  assert.deepEqual(bundle.analyses[0].derivationStages, payload.derivationStages);
  const snapshot = createTreeBankBundleSnapshot(bundle);
  const restored = loadTreeBankBundleSnapshot(snapshot);
  assert.deepEqual(restored.inputTokens, ['Mia’s', 'book']);
  assert.deepEqual(buildReplaySnapshotProjection(restored), buildReplaySnapshotProjection(bundle));
  assert.deepEqual(tokenizeReplaySentenceSurface(sentence, restored.inputTokens), ['Mia’s', 'book']);
  snapshot.inputTokens[0] = 'snapshot mutation';
  assert.equal(restored.inputTokens[0], 'Mia’s');
});

test('legacy records keep apostrophe-s addresses and exact authored syntax on reopen', () => {
  const sentence = 'Mia’s book';
  const inputTokens = ['Mia', "'s", 'book'];
  const bundle = { ...parser.normalizeParseBundle(payloadFor(inputTokens), 'xbar', sentence, 'fixture', true, { inputTokens }), sentence };
  const expected = buildReplaySnapshotProjection(bundle);
  delete bundle.inputTokens;
  const original = structuredClone(bundle);
  const restored = loadTreeBankBundleSnapshot(createTreeBankBundleSnapshot(bundle));
  assert.equal(Object.hasOwn(restored, 'inputTokens'), false);
  assert.deepEqual(resolveSavedInputTokens(sentence), inputTokens);
  assert.deepEqual(buildReplaySnapshotProjection(restored), expected);
  assert.deepEqual(bundle, original);
});

test('malformed saved token lists fail explicitly instead of silently changing addresses', () => {
  for (const value of [null, 'Mia book', ['Mia', null], ['Mia', '  ']]) {
    assert.throws(() => resolveSavedInputTokens('Mia book', value), /inputTokens/);
  }
  assert.deepEqual(resolveSavedInputTokens('', []), []);
});

test('Gemini and local normalization use the exact token list from their sent prompt', async t => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'offline-test-only';
  t.after(() => {
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  });
  const sentence = 'Mia’s book';
  const prompts = [];
  const raw = prompt => {
    const tokens = JSON.parse(prompt.split('Input tokens, indexed from zero: ')[1]);
    prompts.push(tokens);
    return JSON.stringify(payloadFor(tokens));
  };
  const routes = createParseRoutes({ ParseApiError,
    normalizeParseBundle: parser.normalizeParseBundle,
    parseModelJson: parser.parseModelJson,
    parseModelJsonDetailed: parser.parseModelJsonDetailed,
    generateLocal: async ({ prompt }) => raw(prompt),
    generateGemini: async ({ contents }) => ({ text: raw(contents),
      candidates: [{ finishReason: 'STOP' }] })
  });
  for (const method of ['parseSentenceWithLocalModel', 'parseSentenceWithGemini']) {
    const bundle = await routes[method](sentence, 'xbar');
    assert.deepEqual(bundle.inputTokens, ['Mia’s', 'book']);
    assert.deepEqual(bundle.inputTokens, prompts.at(-1));
  }
  assert.equal(prompts.length, 2);
});
