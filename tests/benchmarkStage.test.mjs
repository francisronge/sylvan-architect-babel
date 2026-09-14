import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BENCHMARK_STAGE_DEFINITIONS,
  createBenchmarkStageReceipt,
  hashBenchmarkStageData,
  hashBenchmarkStageEvidence
} from '../bench/benchmarkStage.js';

const digest = (text) => hashBenchmarkStageData({ text });
const createEvidence = (stageId = 'D0') => [
  {
    evidenceId: 'evidence-b',
    stageId,
    evidenceRole: 'external-evidence-role-b',
    evidenceRef: 'evidence://stage/b',
    evidenceSha256: digest('evidence-b'),
    authorityRef: 'authority://external/b',
    observedAt: 'opaque-observation-b',
    provenance: { source: 'external-stage-process' }
  },
  {
    evidenceId: 'evidence-a',
    stageId,
    evidenceRole: 'external-evidence-role-a',
    evidenceRef: 'evidence://stage/a',
    evidenceSha256: digest('evidence-a'),
    authorityRef: 'authority://external/a',
    observedAt: 'opaque-observation-a',
    provenance: { source: 'external-stage-process' }
  }
];
const createPlan = (stageId = 'D0', evidence = createEvidence(stageId), overrides = {}) => ({
  stageRecordId: `stage-record-${stageId}`,
  stageId,
  ...BENCHMARK_STAGE_DEFINITIONS[stageId],
  evidenceIdentity:
    'external-stage-evidence-does-not-authorize-release-or-publication',
  evidenceSetSha256: hashBenchmarkStageEvidence(evidence),
  provenance: { authority: 'external-stage-process' },
  ...overrides
});
const createReceipt = (
  stageId = 'D0',
  evidence = createEvidence(stageId),
  overrides = {}
) => createBenchmarkStageReceipt({
  plan: createPlan(stageId, evidence),
  evidence,
  ...overrides
});

test('D0 through D3 have exact settled identities and claim boundaries', () => {
  for (const [stageId, definition] of Object.entries(
    BENCHMARK_STAGE_DEFINITIONS
  )) {
    const receipt = createReceipt(stageId);
    assert.equal(receipt.stageId, stageId);
    assert.equal(receipt.stageIdentity, definition.stageIdentity);
    assert.equal(
      receipt.claimBoundaryIdentity,
      definition.claimBoundaryIdentity
    );
  }
});

test('D0 is explicitly limited to development contract outcomes', () => {
  const receipt = createReceipt('D0');
  assert.equal(receipt.stageIdentity, 'development-contract-validation');
  assert.equal(
    receipt.claimBoundaryIdentity,
    'validity-and-typed-failure-outcomes-only-no-linguistic-adequacy-claims'
  );
});

test('D3 remains dependent on the separate BM13 release bundle', () => {
  const receipt = createReceipt('D3');
  assert.equal(
    receipt.claimBoundaryIdentity,
    'claim-scope-requires-separate-bm13-release-bundle'
  );
  assert.equal(
    Object.keys(receipt).some((key) => /bundleReceipt|releaseAuthorized/iu.test(key)),
    false
  );
});

test('unknown and mismatched stage labels fail closed', () => {
  const evidence = createEvidence('D0');
  assert.throws(
    () => createBenchmarkStageReceipt({
      plan: {
        ...createPlan('D0', evidence),
        stageId: 'D4'
      },
      evidence
    }),
    /stageId must be one of/
  );
  assert.throws(
    () => createBenchmarkStageReceipt({
      plan: {
        ...createPlan('D0', evidence),
        stageId: '__proto__'
      },
      evidence
    }),
    /stageId must be one of/
  );
  for (const overrides of [
    { stageIdentity: 'invented-stage' },
    { claimBoundaryIdentity: 'invented-claim-boundary' }
  ]) {
    assert.throws(
      () => createBenchmarkStageReceipt({
        plan: createPlan('D0', evidence, overrides),
        evidence
      }),
      /must match D0/
    );
  }
});

test('evidence is nonempty, exact, and bound to one stage', () => {
  const evidence = createEvidence('D0');
  assert.throws(
    () => createBenchmarkStageReceipt({
      plan: createPlan('D0', []),
      evidence: []
    }),
    /must be a non-empty array/
  );
  assert.throws(
    () => createBenchmarkStageReceipt({
      plan: createPlan('D0', evidence),
      evidence: [{ ...evidence[0], stageId: 'D1' }, evidence[1]]
    }),
    /stageId must match the plan stage/
  );
  assert.throws(
    () => createBenchmarkStageReceipt({
      plan: createPlan('D0', evidence),
      evidence: [{ ...evidence[0], readinessDecision: true }, evidence[1]]
    }),
    /fields must be exact/
  );
});

test('evidence hashes and external provenance fail closed', () => {
  const evidence = createEvidence('D0');
  for (const changed of [
    [{ ...evidence[0], evidenceSha256: 'not-a-hash' }, evidence[1]],
    [{ ...evidence[0], provenance: [] }, evidence[1]]
  ]) {
    assert.throws(
      () => createBenchmarkStageReceipt({
        plan: createPlan('D0', evidence),
        evidence: changed
      }),
      /lowercase SHA-256|must be an object/
    );
  }
  assert.throws(
    () => createBenchmarkStageReceipt({
      plan: createPlan('D0', evidence, {
        evidenceSetSha256: digest('stale-evidence')
      }),
      evidence
    }),
    /does not match its source SHA-256/
  );
});

test('evidence IDs and substantive definitions resist relabeling', () => {
  const evidence = createEvidence('D0');
  assert.throws(
    () => createBenchmarkStageReceipt({
      plan: createPlan('D0', [evidence[0], evidence[0]]),
      evidence: [evidence[0], evidence[0]]
    }),
    /evidence IDs must be unique/
  );
  const relabeled = {
    ...structuredClone(evidence[0]),
    evidenceId: 'relabeled-evidence'
  };
  assert.throws(
    () => createBenchmarkStageReceipt({
      plan: createPlan('D0', [...evidence, relabeled]),
      evidence: [...evidence, relabeled]
    }),
    /evidence substantive definitions must be unique/
  );
});

test('evidence input order does not change its hash or receipt', () => {
  const evidence = createEvidence('D0');
  const reversed = [...evidence].reverse();
  assert.equal(
    hashBenchmarkStageEvidence(evidence),
    hashBenchmarkStageEvidence(reversed)
  );
  assert.deepEqual(
    createBenchmarkStageReceipt({
      plan: createPlan('D0', evidence),
      evidence
    }),
    createBenchmarkStageReceipt({
      plan: createPlan('D0', reversed),
      evidence: reversed
    })
  );
});

test('the plan fixes evidence-only semantics and rejects policy extras', () => {
  const evidence = createEvidence('D0');
  for (const changedPlan of [
    createPlan('D0', evidence, {
      evidenceIdentity: 'invented-readiness-authority'
    }),
    { ...createPlan('D0', evidence), publicationRule: 'invented' }
  ]) {
    assert.throws(
      () => createBenchmarkStageReceipt({
        plan: changedPlan,
        evidence
      }),
      /must be external-stage-evidence|fields must be exact/
    );
  }
});

test('receipts are deterministic, immutable, and preserve callers', () => {
  const evidenceInput = createEvidence('D2');
  const planInput = createPlan('D2', evidenceInput);
  const before = JSON.stringify({ planInput, evidenceInput });
  const first = createBenchmarkStageReceipt({
    plan: planInput,
    evidence: evidenceInput
  });
  const second = createBenchmarkStageReceipt({
    plan: planInput,
    evidence: evidenceInput
  });
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify({ planInput, evidenceInput }), before);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.evidence[0].provenance), true);
});
