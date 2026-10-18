import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeParseBundle } from '../server/babelParser/parseNormalization.js';

// Expansion re-materializes every earlier subtree a stage references. These
// probes keep that work proportional to the expanded occurrences and bound
// the node fields it copies for one response.

const stage = (workspaceForest) => ({ statement: 's', stageRecord: 's', relations: [], workspaceForest });
const chain = (levels, stages) => {
  let root = { id: 'w', label: 'X', word: 'a', children: [] };
  for (let index = 0; index < levels - 1; index += 1) root = { id: `p${index}`, label: 'X', children: [root] };
  return { derivationStages: [stage([root]), ...Array.from({ length: stages - 1 }, () => stage([{ refId: root.id }]))] };
};
const timed = (run) => {
  const started = performance.now();
  const result = run();
  assert.ok(performance.now() - started < 1_000, 'bounded');
  return result;
};
const normalize = (payload) => normalizeParseBundle(JSON.parse(JSON.stringify(payload)), 'xbar', 'a', 'gpt', true, { spellout: true });

test('expansion copies each occurrence once, however deep the referenced subtree', (t) => {
  // A 256-node chain retained across 32 stages expands to 8,192 occurrences.
  const payload = JSON.parse(JSON.stringify(chain(256, 32)));
  let nodeEntries = 0;
  const entries = Object.entries;
  t.mock.method(Object, 'entries', function (value) {
    if (value && typeof value.id === 'string' && Array.isArray(value.children)) nodeEntries += 1;
    return entries(value);
  });
  normalizeParseBundle(payload, 'xbar', 'a', 'gpt', true, { spellout: true });
  t.mock.restoreAll();
  // Copying each node's whole subtree enumerated 1,053,184 node objects.
  assert.ok(nodeEntries < 10 * 8_192, `${nodeEntries} node enumerations`);
  // Two analyses retaining the chain across 194 stages took seconds and remain a valid parse.
  const bundle = timed(() => normalize({ analyses: Array(2).fill(chain(256, 194)) }));
  assert.equal(bundle.analyses.length, 2);
  assert.equal(bundle.analyses[1].derivationStages.length, 194);
});

test('ignored node fields copied through references stop at the response expansion budget', () => {
  const carried = (values, stages) => ({ derivationStages: [
    stage([{ id: 'w', label: 'X', word: 'a', extra: Array(values).fill(0), children: [] }]),
    ...Array.from({ length: stages - 1 }, () => stage([{ refId: 'w' }]))
  ] });
  const expectBudget = (payload, analysisIndex, stageIndex) => assert.throws(() => timed(() => normalize(payload)), (error) => {
    assert.equal(error.code, 'BAD_MODEL_RESPONSE');
    assert.equal(error.status, 502);
    assert.equal(error.failure.class, 'contract_misunderstanding');
    assert.equal(error.failure.ruleId, 'DERIVATION_WORKSPACE_VALID');
    assert.equal(error.failure.analysisIndex, analysisIndex);
    assert.equal(error.failure.stageIndex, stageIndex);
    assert.match(error.message, /expanded node fields exceed 1000000 values across the response/);
    return true;
  });
  // A 74 KB response once retained eight million copied values.
  expectBudget(carried(20_000, 400), 0, 49);
  // The budget covers the whole response, not each analysis.
  const half = carried(10_000, 60);
  assert.equal(normalize(half).analyses.length, 1);
  expectBudget({ analyses: [half, half] }, 1, 39);
});
