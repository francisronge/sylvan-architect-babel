import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeParseBundle } from '../server/babelParser/parseNormalization.js';
import { buildReplaySnapshotProjection } from '../replay/replaySnapshot.ts';
import { createTreeBankBundleSnapshot, loadTreeBankBundleSnapshot } from '../treeBankSnapshot.js';

const stage = workspaceForest => ({ statement: 'Construct the expression.',
  stageRecord: 'The selected words combine in their authored order.', relations: [], workspaceForest });
const leaf = (id, word, tokenIndex) => ({ id, label: 'N', word, children: [],
  ...(tokenIndex === undefined ? {} : { tokenIndex }) });
const expression = (words, indices = words.map((_, index) => index)) => ({ derivationStages: [
  stage([{ id: 'root', label: 'XP', children: words.map((word, index) => leaf(`n${index}`, word, indices[index])) }])
] });
const normalize = (payload, sentence, options) => normalizeParseBundle(payload, 'minimalism', sentence, 'gpt', true, options);
const withoutIndices = value => {
  const copy = structuredClone(value);
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    delete node.tokenIndex;
    Object.values(node).forEach(visit);
  };
  visit(copy);
  return copy;
};

test('two Dutch readings recover the six mismatched optional indices through carried references', () => {
  const words = ['De', 'redacteur', 'heeft', 'gezegd', 'dat', 'de', 'minister', 'het', 'voorstel', 'steunt'];
  const authoredIndices = [0, 1, 2, 8, 3, 4, 5, 6, 7, 9];
  const analysis = prefix => ({ derivationStages: [
    stage(words.map((word, index) => leaf(`${prefix}${index}`, word, authoredIndices[index]))),
    stage([{ id: `${prefix}root`, label: 'CP', children: words.map((_, index) => ({ refId: `${prefix}${index}` })) }])
  ] });
  const payload = { analyses: [analysis('a'), analysis('b')] }, original = structuredClone(payload);
  const sentence = words.join(' ') + '.';
  const bundle = normalize(payload, sentence);
  const baseline = normalize(withoutIndices(payload), sentence);
  assert.equal(bundle.analyses.length, 2);
  for (const [index, result] of bundle.analyses.entries()) {
    const corrections = result.provenance.tokenIndexCorrections;
    assert.equal(corrections.length, 6);
    assert.deepEqual(corrections.map(({ authoredTokenIndex }) => authoredTokenIndex), [8, 3, 4, 5, 6, 7]);
    assert.deepEqual(corrections.map(({ word }) => word), words.slice(3, 9));
    assert.equal(corrections[0].fieldPath, `$.analyses[${index}].derivationStages[0].workspaceForest[3].tokenIndex`);
    assert.equal(corrections[0].stageIndex, 0);
    assert.equal(corrections[0].inputTokenAtAuthoredIndex, 'voorstel');
    assert.deepEqual(result.tree.children.map(({ tokenIndex }) => tokenIndex), words.map((_, i) => i));
    assert.deepEqual(result.finalForest, baseline.analyses[index].finalForest);
    assert.deepEqual(withoutIndices(result.derivationStages), withoutIndices(baseline.analyses[index].derivationStages));
    assert.equal(result.derivationStages[0].workspaceForest[0].tokenIndex, 0, 'correct authored fields stay intact');
    assert.equal(Object.hasOwn(result.derivationStages[0].workspaceForest[3], 'tokenIndex'), false);
  }
  assert.deepEqual(payload, original, 'the original model payload is never edited');
  assert.deepEqual(buildReplaySnapshotProjection(bundle), buildReplaySnapshotProjection(baseline));
  const restored = loadTreeBankBundleSnapshot(createTreeBankBundleSnapshot(bundle));
  assert.deepEqual(restored.analyses, JSON.parse(JSON.stringify(bundle.analyses)),
    'the silent diagnostic survives saving and reopening');
});

test('only the affected analysis receives corrections, with its exact authored field path', () => {
  const valid = expression(['Mia', 'smiled']);
  const payload = { analyses: [valid, expression(['Mia', 'smiled'], [1, 0])] };
  const outcomes = [];
  const result = normalize(payload, 'Mia smiled.', { analysisOutcomes: outcomes });
  assert.equal(result.analyses[0].provenance.tokenIndexCorrections, undefined);
  assert.equal(result.analyses[1].provenance.tokenIndexCorrections[0].fieldPath,
    '$.analyses[1].derivationStages[0].workspaceForest[0].children[0].tokenIndex');
  assert.deepEqual(outcomes.map(({ status }) => status), ['succeeded', 'succeeded']);
  assert.equal(normalize(valid, 'Mia smiled.').analyses[0].provenance.tokenIndexCorrections, undefined);
});

test('normalization uses the retained input-token addresses rather than retokenizing the sentence', () => {
  const result = normalize(expression(['花子が', '走った'], [1, 0]), '花子が走った', { inputTokens: ['花子が', '走った'] });
  assert.deepEqual(result.inputTokens, ['花子が', '走った']);
  assert.equal(result.analyses[0].provenance.tokenIndexCorrections.length, 2);
});

const refused = [
  ['wrong order', expression(['smiled', 'Mia'], [1, 0]), 'Mia smiled.'],
  ['wrong word', expression(['Mia', 'laughed'], [1, 0]), 'Mia smiled.'],
  ['ambiguous repeated word', expression(['the', 'the'], [1, 0]), 'the the'],
  ['duplicate ownership', expression(['Mia', 'smiled'], [1, 1]), 'Mia smiled.'],
  ['noninteger index', expression(['Mia', 'smiled'], ['1', 0]), 'Mia smiled.'],
  ['out-of-range index', expression(['Mia', 'smiled'], [99, 0]), 'Mia smiled.'],
  ['incorrect surface span', (() => {
    const value = expression(['Mia', 'smiled'], [1, 0]);
    value.derivationStages[0].workspaceForest[0].surfaceSpan = [1, 1];
    return value;
  })(), 'Mia smiled.'],
  ['silent source tag', { derivationStages: [stage([{ id: 'root', label: 'XP', children: [
    { ...leaf('silent', 'Mia', 0), silent: true }, leaf('n0', 'Mia', 1), leaf('n1', 'smiled', 0)
  ] }])] }, 'Mia smiled.'],
  ['pronunciation group', (() => {
    const value = expression(['Mia', 'smiled'], [1, 0]);
    value.derivationStages[0].realizations = [{ nodeIds: ['n0'], tokenIndices: [0] }];
    return value;
  })(), 'Mia smiled.'],
  ['incorrect repeated-word address beside a recoverable tag', expression(['the', 'the', 'cat', 'ran'], [1, 0, 3, 2]), 'the the cat ran']
];
for (const [label, payload, sentence] of refused) test(`recovery refuses ${label}`, () => {
  const original = structuredClone(payload);
  assert.throws(() => normalize(payload, sentence), error => error.code === 'BAD_MODEL_RESPONSE');
  assert.deepEqual(payload, original);
});

test('a valid pronunciation group and valid repeated-word addresses remain unchanged', () => {
  const payload = expression(['walk', '-ed'], [undefined, undefined]);
  payload.derivationStages[0].realizations = [{ nodeIds: ['n0', 'n1'], tokenIndices: [0] }];
  assert.equal(normalize(payload, 'walked').analyses[0].provenance.tokenIndexCorrections, undefined);
  assert.equal(normalize(expression(['the', 'the']), 'the the').analyses[0].provenance.tokenIndexCorrections, undefined);
});
