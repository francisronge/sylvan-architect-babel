import assert from 'node:assert/strict';
import test from 'node:test';

import { __test__, ParseApiError } from '../server/babelParser.js';
import {
  authoredWord,
  isPronouncedLeaf,
  isSilentWordLeaf,
  isWordlessLeaf
} from '../server/babelParser/nodePronunciation.js';
import {
  adaptDerivationStagesForReplay,
  collectOvertLeafNodeIdsInOrder,
  collectPronouncedLeafNodeIdsInOrder,
  isWordlessCategoryLeaf
} from '../replay/replayCompiler.ts';

// Pronunciation is authored through `word` and `silent`. Neither the spelling
// of a word nor the casing of a label may change what the parser or Replay
// thinks is pronounced. These trees are contract probes, not linguistics.

const leaf = (id, label, extra = {}) => ({ id, label, children: [], ...extra });
const node = (id, label, children) => ({ id, label, children });
const stage = (workspaceForest) => ({
  statement: 'An authored state.',
  stageRecord: 'The workspace holds the authored occurrences.',
  relations: [],
  workspaceForest
});
const normalize = (workspaceForest, sentence) => __test__.normalizeParseBundle(
  { derivationStages: [stage(workspaceForest)] },
  'xbar',
  sentence,
  'claude',
  true,
  { payloadIntegrityFlags: [] }
);
const leaves = (root) => (root.children?.length ? root.children.flatMap(leaves) : [root]);

test('ordinary words spelled like notation stay pronounced on both layers', () => {
  const tree = node('xp', 'XP', [
    node('np', 'NP', [leaf('n_copy', 'N', { word: 'copy', tokenIndex: 0 })]),
    node('vp', 'VP', [
      leaf('v_trace', 'V', { word: 'trace', tokenIndex: 1 }),
      node('dp', 'DP', [leaf('d_pro', 'D', { word: 'pro', tokenIndex: 2 })])
    ])
  ]);
  const bundle = normalize([tree], 'copy trace pro');
  const overt = __test__.collectOvertTerminalNodes(bundle.analyses[0].tree);
  assert.deepEqual(overt.map((item) => [item.id, item.tokenIndex]), [['n_copy', 0], ['v_trace', 1], ['d_pro', 2]]);
  assert.deepEqual(collectPronouncedLeafNodeIdsInOrder(tree), ['n_copy', 'v_trace', 'd_pro']);
  for (const item of leaves(tree)) {
    assert.equal(isPronouncedLeaf(item), true);
    assert.equal(isWordlessCategoryLeaf(item), false);
  }
});

test('wordless heads are abstract whatever their label casing says, on both layers', () => {
  const heads = [['appl', 'Appl'], ['voice', 'Voice'], ['neg', 'Neg'], ['infl', 'Infl'], ['book', 'Book']];
  for (const [lower, upper] of heads) {
    for (const label of [lower, upper]) {
      const tree = node('xp', 'XP', [
        node('hp', 'HP', [leaf('head', label), node('np', 'NP', [leaf('n_mia', 'N', { word: 'Mia', tokenIndex: 0 })])])
      ]);
      const bundle = normalize([tree], 'Mia');
      const normalizedHead = leaves(bundle.analyses[0].tree).find((item) => item.id === 'head');
      assert.equal(Object.hasOwn(normalizedHead, 'tokenIndex'), false, `${label} must not receive a token index`);
      assert.equal(Object.hasOwn(normalizedHead, 'surfaceSpan'), false, `${label} must not receive a surface span`);
      assert.deepEqual(__test__.collectOvertTerminalNodes(tree).map((item) => item.id), ['n_mia']);
      assert.deepEqual(collectPronouncedLeafNodeIdsInOrder(tree), ['n_mia']);
      assert.deepEqual(collectOvertLeafNodeIdsInOrder(tree), ['n_mia']);
      assert.equal(isWordlessLeaf(leaf('head', label)), true);
      assert.equal(isWordlessCategoryLeaf(leaf('head', label)), true, `${label} keeps category geometry`);
    }
  }
});

test('the parser and Replay agree on every authored pronunciation shape', () => {
  const tree = node('cp', 'CP', [
    node('dp_high', 'DP', [leaf('d_high', 'D', { word: 'Which', tokenIndex: 0, lineageId: 'wh' })]),
    node('tp', 'TP', [
      leaf('t_abstract', 'T'),
      node('vp', 'VP', [
        leaf('v', 'V', { word: 'buy', tokenIndex: 1 }),
        node('dp_low', 'DP', [leaf('d_low', 'D', { word: 'which', silent: true, lineageId: 'wh' })]),
        leaf('gap', 't₁', { silent: true }),
        leaf('null_c', '∅')
      ])
    ])
  ]);
  const serverIds = __test__.collectOvertTerminalNodes(tree).map((item) => item.id);
  assert.deepEqual(serverIds, ['d_high', 'v']);
  assert.deepEqual(collectPronouncedLeafNodeIdsInOrder(tree), serverIds);
  const byId = Object.fromEntries(leaves(tree).map((item) => [item.id, item]));
  assert.equal(isSilentWordLeaf(byId.d_low), true);
  assert.equal(authoredWord(byId.d_low), 'which');
  assert.equal(isWordlessLeaf(byId.t_abstract), true);
  assert.equal(isWordlessCategoryLeaf(byId.t_abstract), true);
  // Notation stays terminal material only because the leaf is already unpronounced.
  assert.equal(isWordlessCategoryLeaf(byId.gap), false);
  assert.equal(isWordlessCategoryLeaf(byId.null_c), false);
});

test('a wordless lowercase t is trace notation for display but never pronounced anywhere', () => {
  const tree = node('tp', 'TP', [leaf('t_low', 't'), leaf('t_cat', 'T'), leaf('n', 'N', { word: 'Mia', tokenIndex: 0 })]);
  assert.deepEqual(__test__.collectOvertTerminalNodes(tree).map((item) => item.id), ['n']);
  assert.deepEqual(collectPronouncedLeafNodeIdsInOrder(tree), ['n']);
  assert.equal(isWordlessCategoryLeaf(leaf('t_low', 't')), false);
  assert.equal(isWordlessCategoryLeaf(leaf('t_cat', 'T')), true);
});

test('a token index on a silent terminal is diagnosed, not reinterpreted as pronunciation', () => {
  const tree = node('np', 'NP', [
    leaf('n_copy', 'N', { word: 'copy', tokenIndex: 0 }),
    leaf('n_silent', 'N', { word: 'copy', silent: true, tokenIndex: 1 })
  ]);
  assert.throws(() => normalize([tree], 'copy'), (error) => {
    assert.ok(error instanceof ParseApiError);
    assert.equal(error.failure.processingStep, 'token-alignment');
    assert.match(error.failure.fieldPath, /children\[1\]\.tokenIndex$/);
    return true;
  });
});

test('undocumented node fields are ignored and recorded, never read as pronunciation or identity', () => {
  const tree = node('np', 'NP', [
    leaf('n_copy', 'N', { word: 'copy', tokenIndex: 0, type: 'trace', silentFeature: true, ghost: true, aliasIds: ['other'] })
  ]);
  const bundle = normalize([tree], 'copy');
  const compiled = leaves(bundle.analyses[0].tree).find((item) => item.id === 'n_copy');
  assert.equal(compiled.tokenIndex, 0, 'the word stays pronounced');
  const recorded = JSON.stringify(bundle);
  for (const field of ['type', 'silentFeature', 'ghost', 'aliasIds']) {
    assert.ok(
      recorded.includes(`node_field_ignored:1:$.derivationStages[0].workspaceForest[0].children[0].${field}`),
      `${field} is recorded as ignored`
    );
  }
  // Replay projects authored nodes to contract fields before adding its own metadata.
  const frames = adaptDerivationStagesForReplay([stage([tree])]);
  const replayLeaf = leaves(frames[0].workspaceForest[0]).find((item) => item.id === 'n_copy');
  assert.deepEqual(Object.keys(replayLeaf).sort(), ['children', 'id', 'label', 'tokenIndex', 'word']);
  assert.deepEqual(collectPronouncedLeafNodeIdsInOrder(frames[0].workspaceForest[0]), ['n_copy']);
});
