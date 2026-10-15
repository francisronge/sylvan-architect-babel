import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { normalizeParseBundle } from '../server/babelParser/parseNormalization.js';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const verifier = path.join(repositoryRoot, 'scripts/verifyParseContract.mjs');
const leaf = () => ({ id: 'mia', label: 'N', word: 'Mia', children: [] });
const stage = () => ({
  statement: 'Introduce Mia.',
  stageRecord: 'The proper name supplies the nominal expression.',
  relations: [],
  workspaceForest: [leaf()]
});
const bundle = () => ({ inputTokens: ['Mia'], analyses: [{ derivationStages: [stage()] }] });

const runVerifier = (payload) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'babel-contract-verifier-'));
  const input = path.join(directory, 'input.json');
  const original = JSON.stringify(payload);
  fs.writeFileSync(input, original);
  try {
    const result = spawnSync(process.execPath, [verifier, input], {
      cwd: repositoryRoot, encoding: 'utf8', timeout: 10_000
    });
    assert.ifError(result.error);
    assert.equal(fs.readFileSync(input, 'utf8'), original, 'verification preserves the authored record');
    return { status: result.status, output: result.stdout + result.stderr };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

test('the CLI accepts short derivations and optional realization groups without stage-count warnings', () => {
  const payload = bundle();
  payload.analyses[0].derivationStages[0].realizations = [{ nodeIds: ['mia'], tokenIndices: [0] }];
  const result = runVerifier(payload);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Parse contract verification passed/);
  assert.doesNotMatch(result.output, /warning:|only 1 derivationStages/);
});

test('the CLI accepts the canonical single-analysis envelope', () => {
  const result = runVerifier({ derivationStages: [stage()] });
  assert.equal(result.status, 0, result.output);
});

test('the CLI rejects absent, empty and incorrectly typed derivation stages', () => {
  for (const derivationStages of [undefined, [], 'not stages']) {
    const result = runVerifier({ analyses: [{ derivationStages }] });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /derivationStages.*nonempty array/);
  }
});

test('the CLI uses canonical stage, relation-array and workspace diagnostics', () => {
  const mutations = [
    [payload => { payload.analyses[0].derivationStages[0].statement = 7; }, 'DERIVATION_STAGE_STATEMENT_NONEMPTY'],
    [payload => { payload.analyses[0].derivationStages[0].relations = 'not relations'; }, 'DERIVATION_STAGE_RELATIONS_ARRAY'],
    [payload => { payload.analyses[0].derivationStages[0].legacy = true; }, 'DERIVATION_STAGE_FIELDS_EXACT'],
    [payload => { payload.analyses[0].derivationStages[0].workspaceForest = 'not a forest'; }, 'DERIVATION_WORKSPACE_VALID'],
    [payload => { payload.analyses[0].derivationStages[0].workspaceForest[0].children = null; }, 'DERIVATION_WORKSPACE_VALID'],
    [payload => { payload.analyses[0].derivationStages[0].workspaceForest.push(leaf()); }, 'DERIVATION_WORKSPACE_VALID']
  ];
  for (const [mutate, ruleId] of mutations) {
    const payload = bundle();
    mutate(payload);
    const result = runVerifier(payload);
    assert.equal(result.status, 1, result.output);
    assert.ok(result.output.includes(ruleId), result.output);
  }
});

test('the CLI rejects a derivation with no completed workspace', () => {
  const payload = bundle();
  payload.analyses[0].derivationStages[0].workspaceForest = [];
  const result = runVerifier(payload);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /final workspaceForest.*nonempty/);
});

test('the CLI resolves carried subtree descendants and prior anchors through canonical expansion', () => {
  const first = stage();
  first.workspaceForest = [{ id: 'np', label: 'NP', children: [leaf()] }];
  const second = stage();
  second.workspaceForest = [{ refId: 'np' }];
  second.relations = [{
    relation: 'An open relation name',
    anchors: { 'a bespoke role': 'mia' },
    priorAnchors: { 'earlier bespoke role': 'mia' },
    values: { 'a literal notation': ['anything', ''] }
  }];
  const result = runVerifier({ analyses: [{ derivationStages: [first, second] }] });
  assert.equal(result.status, 0, result.output);
  assert.doesNotMatch(result.output, /warning:/);
});

test('the CLI retains malformed relation diagnostics instead of rejecting the inspectable analysis', () => {
  const payload = bundle();
  const relation = { relation: 'Open claim', anchors: { witness: 'mia' }, values: ['not a values block'] };
  payload.analyses[0].derivationStages[0].relations.push(relation);
  const normalized = normalizeParseBundle(payload, 'xbar', 'Mia', 'gpt');
  assert.deepEqual(normalized.analyses[0].derivationStages[0].relations[0].relationContractFailure.raw, relation);
  const result = runVerifier(payload);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /warning:.*DERIVATION_STAGE_RELATION_EXACT/);
  assert.match(result.output, /retained relation diagnostic/);
});

test('the CLI reports unresolved relation anchors without erasing their authored claim', () => {
  const payload = bundle();
  payload.analyses[0].derivationStages[0].relations.push({ relation: 'Open claim', anchors: { witness: 'missing' } });
  const result = runVerifier(payload);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /warning:.*DERIVATION_RELATION_ANCHOR_RESOLUTION/);
  assert.match(result.output, /missing/);
});

test('the CLI validates realization shape and occurrence membership through the parser contract', () => {
  for (const realizations of ['not groups', [{ nodeIds: ['missing'], tokenIndices: [0] }]]) {
    const payload = bundle();
    payload.analyses[0].derivationStages[0].realizations = realizations;
    const result = runVerifier(payload);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /DERIVATION_REALIZATION_(SHAPE|SOURCE)/);
  }
});

test('the CLI retains sentence context for direct and wrapped realization token bounds', () => {
  const envelopes = [
    (analysis) => ({ sentence: 'Mia', analyses: [analysis] }),
    (analysis) => ({ request: { sentence: 'Mia' }, response: { analyses: [analysis] } }),
    (analysis) => ({ request: { sentence: 'Mia' }, bundle: { analyses: [analysis] } })
  ];
  for (const wrap of envelopes) {
    for (const tokenIndex of [0, 99]) {
      const completed = stage();
      completed.realizations = [{ nodeIds: ['mia'], tokenIndices: [tokenIndex] }];
      const result = runVerifier(wrap({ derivationStages: [completed] }));
      assert.equal(result.status, tokenIndex === 0 ? 0 : 1, result.output);
      if (tokenIndex === 99) assert.match(result.output, /DERIVATION_REALIZATION_TOKEN.*below 1/);
    }
  }
});

test('the CLI preserves explicit input-token boundaries ahead of sentence tokenization in wrapped records', () => {
  const completed = stage();
  completed.realizations = [{ nodeIds: ['mia'], tokenIndices: [0, 1] }];
  const analysis = { derivationStages: [completed] };
  const envelopes = [
    { sentence: 'Mia', inputTokens: ['Mi', 'a'], analyses: [analysis] },
    { request: { sentence: 'Mia' }, response: { inputTokens: ['Mi', 'a'], analyses: [analysis] } },
    { request: { sentence: 'Mia' }, inputTokens: ['Mi', 'a'], bundle: { analyses: [analysis] } },
    { request: { sentence: 'Mia', inputTokens: ['Mi', 'a'] }, response: { analyses: [analysis] } }
  ];
  for (const payload of envelopes) {
    const result = runVerifier(payload);
    assert.equal(result.status, 0, result.output);
    assert.doesNotMatch(result.output, /warning:/);
  }
});
