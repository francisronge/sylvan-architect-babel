import assert from 'node:assert/strict';
import test from 'node:test';

import { __test__, ParseApiError } from '../server/babelParser.js';
import { collectPronouncedLeaves } from '../server/babelParser/nodePronunciation.js';
import { collectPronouncedLeafNodeIdsInOrder } from '../replay/replayCompiler.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';

// Two contract rules: silence on a phrase covers every terminal beneath it,
// and per-item literals pair with an anchor list only through a same-name
// values entry of the same length.

const leaf = (id, label, extra = {}) => ({ id, label, children: [], ...extra });
const node = (id, label, children, extra = {}) => ({ id, label, children, ...extra });
const stage = (workspaceForest, relations = []) => ({
  statement: 'An authored state.',
  stageRecord: 'The workspace holds the authored occurrences.',
  relations,
  workspaceForest
});
const normalize = (workspaceForest, sentence) => __test__.normalizeParseBundle(
  { derivationStages: [stage(workspaceForest)] }, 'xbar', sentence, 'claude', true, { payloadIntegrityFlags: [] }
);

test('a silent phrase leaves every terminal beneath it unpronounced on both layers', () => {
  const tree = node('cp', 'CP', [
    node('dp_high', 'DP', [leaf('d_high', 'D', { word: 'Which', tokenIndex: 0 }), leaf('n_high', 'N', { word: 'book', tokenIndex: 1 })]),
    node('vp', 'VP', [
      leaf('v', 'V', { word: 'buy', tokenIndex: 2 }),
      node('dp_low', 'DP', [leaf('d_low', 'D', { word: 'which' }), leaf('n_low', 'N', { word: 'book' })], { silent: true })
    ])
  ]);
  const bundle = normalize([tree], 'Which book buy');
  const overt = __test__.collectOvertTerminalNodes(bundle.analyses[0].tree).map((item) => item.id);
  assert.deepEqual(overt, ['d_high', 'n_high', 'v']);
  assert.deepEqual(collectPronouncedLeaves(tree).map((item) => item.id), overt);
  assert.deepEqual(collectPronouncedLeafNodeIdsInOrder(tree), overt);
});

test('a token index on a terminal beneath a silent phrase is diagnosed, not pronounced', () => {
  const tree = node('vp', 'VP', [
    leaf('v', 'V', { word: 'buy', tokenIndex: 0 }),
    node('dp_low', 'DP', [leaf('d_low', 'D', { word: 'which', tokenIndex: 1 })], { silent: true })
  ]);
  const inspection = __test__.inspectDerivationWorkspaces([stage([tree])]);
  const issue = inspection[0].diagnostics.find((diagnostic) => diagnostic.ruleId === 'DERIVATION_TOKEN_INDEX_SILENT');
  assert.equal(issue.fieldPath, '$.derivationStages[0].workspaceForest[0].children[1].children[0].tokenIndex');
  assert.throws(() => normalize([tree], 'buy'), (error) => {
    assert.ok(error instanceof ParseApiError);
    assert.equal(error.failure.processingStep, 'token-alignment');
    return true;
  });
});

const thetaForest = [node('root', 'VP', [leaf('v', 'V', { word: 'gave', tokenIndex: 0 }), leaf('a', 'D', { word: 'she', tokenIndex: 1 }), leaf('b', 'D', { word: 'it', tokenIndex: 2 })])];
const dispatch = (relation) => dispatchRelationClaims({
  relation, currentForest: thetaForest, priorForest: [], stageIndex: 0, relationIndex: 0
});
const thetaFacet = (relation) => dispatch(relation).facets.find((item) => item.recipe.id === 'theta-grid');
const thetaFailures = (relation) => {
  const result = dispatch(relation);
  assert.equal(result.facets.some((item) => item.recipe.id === 'theta-grid'), false);
  return result.facetDiagnostics.find((item) => item.facetId === 'theta-grid').failures.join('\n');
};

test('same-name lists of equal length pair by position and are consumed together', () => {
  const relation = { relation: 'Thematic roles of gave', anchors: { predicate: 'v', arguments: ['a', 'b'] }, values: { arguments: ['Agent', 'Theme'] } };
  const facet = thetaFacet(relation);
  assert.ok(facet?.evaluation.complete, JSON.stringify(facet?.evaluation.failures));
  assert.ok(facet.evaluation.consumedEvidence.some((ref) => ref.field === 'values' && ref.key === 'arguments'));
  const plan = compileRelationRenderPlan([stage(thetaForest, [relation])]);
  assert.deepEqual(plan.frames[0].items.find((item) => item.plaqueStyle === 'theta-grid')?.thetaRoles,
    [{ nodeId: 'a', label: 'Agent' }, { nodeId: 'b', label: 'Theme' }]);
});

test('differently named lists are not paired by position, and the reason names the rule', () => {
  const failures = thetaFailures({ relation: 'Thematic roles of gave', anchors: { predicate: 'v', arguments: ['a', 'b'] }, values: { roles: ['Agent', 'Theme'] } });
  assert.match(failures, /paired-values:role\.label literals are not paired with theta\.arguments: pairing needs a values entry with the same name and length/);
});

test('one item with one literal pairs without ambiguity whatever the names', () => {
  const facet = thetaFacet({ relation: 'Thematic roles of gave', anchors: { predicate: 'v', argument: 'a' }, values: { thetaRole: 'Agent' } });
  assert.ok(facet?.evaluation.complete, JSON.stringify(facet?.evaluation.failures));
});

test('same names with different lengths are not a pairing either', () => {
  const failures = thetaFailures({ relation: 'Thematic roles of gave', anchors: { predicate: 'v', arguments: ['a', 'b'] }, values: { arguments: ['Agent'] } });
  assert.match(failures, /use the anchor entry's name but not its length/);
});
