import assert from 'node:assert/strict';
import test from 'node:test';

import { __test__ } from '../server/babelParser.js';
import { collectNodeReferencesById } from '../server/babelParser/treeBasics.js';

const leaf = (id, fields = {}) => ({ id, label: 'N', children: [], word: 'Mia', ...fields });
const stage = (tree) => ({
  statement: 'The nominal is present.',
  stageRecord: 'This stage retains the nominal occurrence.',
  relations: [],
  workspaceForest: [tree]
});
const normalize = (derivationStages) => __test__.normalizeParseBundle(
  { derivationStages }, 'xbar', 'Mia', 'gpt', true
);

test('node collection follows roots and children without promoting retained metadata to syntax', () => {
  const child = leaf('child');
  const root = {
    id: 'root', label: 'NP',
    metadata: { objects: [leaf('metadata-only'), leaf('child', { tokenIndex: 99 })] },
    children: [child]
  };
  const result = collectNodeReferencesById([root]);
  assert.deepEqual([...result.keys()], ['root', 'child']);
  assert.equal(result.get('child'), child);
});

test('metadata-only IDs cannot supply earlier subtree references in normalization or inspection', () => {
  const stages = [stage(leaf('real', { metadata: leaf('metadata-only') })), stage({ refId: 'metadata-only' })];
  const original = structuredClone(stages);
  const inspected = __test__.inspectDerivationWorkspaces(stages, { sentence: 'Mia' });
  const diagnostic = inspected[1].diagnostics[0];
  assert.equal(diagnostic.ruleId, 'DERIVATION_WORKSPACE_VALID');
  assert.throws(() => normalize(stages), (error) => {
    assert.equal(error.failure.ruleId, diagnostic.ruleId);
    assert.equal(error.failure.fieldPath, diagnostic.fieldPath);
    assert.equal(error.failure.offendingValue, 'metadata-only');
    return true;
  });
  assert.deepEqual(stages, original);
});

test('node-shaped metadata cannot reject valid alignment or replace a real child with the same ID', () => {
  const metadata = { nested: leaf('child', { tokenIndex: 99 }), extra: leaf('metadata-only', { tokenIndex: 7 }) };
  for (const fields of [
    { metadata, children: [leaf('child')] },
    { children: [leaf('child')], metadata }
  ]) {
    const tree = { id: 'root', label: 'NP', ...fields };
    const stages = [stage(tree), stage({ refId: 'child' })];
    const original = structuredClone(stages);
    const result = normalize(stages).analyses[0];
    assert.equal(result.tree.tokenIndex, 0);
    assert.deepEqual(result.tree.surfaceSpan, [0, 0]);
    assert.deepEqual(result.derivationStages[0].workspaceForest[0].metadata, metadata);
    assert.deepEqual(stages, original);

    const invalid = structuredClone(stages);
    invalid[0].workspaceForest[0].children[0].tokenIndex = 99;
    assert.throws(() => normalize(invalid), (error) => {
      assert.equal(error.failure.fieldPath, '$.derivationStages[0].workspaceForest[0].children[0].tokenIndex');
      assert.equal(error.failure.offendingValue, 99);
      return true;
    });
  }
});
