import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BENCHMARK_STAGE_DEFINITIONS,
  BM13_D0_PRECONDITION_IDS,
  BM13_D3_PRECONDITION_IDS,
  createBenchmarkStageReceipt,
  createDevelopmentBundleReceipt,
  createReportStarSchemaReceipt,
  hashBenchmarkStageData,
  hashBenchmarkStageEvidence,
  hashDevelopmentBundleData,
  hashReportStarSchemaData,
  REPORT_TABLE_NAMES
} from '../bench/index.js';

const digest = (text) => hashDevelopmentBundleData({ text });
const releaseId = 'release-d0-dev';
const stageEvidence = [{
  evidenceId: 'd0-stage-evidence',
  stageId: 'D0',
  evidenceRole: 'external-stage-evidence',
  evidenceRef: 'evidence://stage/d0',
  evidenceSha256: hashBenchmarkStageData({ text: 'stage-evidence' }),
  authorityRef: 'authority://stage/external',
  observedAt: 'opaque-stage-time',
  provenance: { source: 'external-stage-process' }
}];
const stageReceipt = createBenchmarkStageReceipt({
  plan: {
    stageRecordId: 'stage-record-d0',
    stageId: 'D0',
    ...BENCHMARK_STAGE_DEFINITIONS.D0,
    evidenceIdentity:
      'external-stage-evidence-does-not-authorize-release-or-publication',
    evidenceSetSha256: hashBenchmarkStageEvidence(stageEvidence),
    provenance: { authority: 'external-stage-process' }
  },
  evidence: stageEvidence
});

const model = {
  registryId: 'dev-model',
  name: 'Externally Selected Development Model',
  lab: 'External Lab',
  manifestRef: 'dev://manifest/model'
};
const condition = {
  id: 'dev-condition',
  releaseId,
  modelId: model.registryId,
  resolvedVersion: 'dev-resolved-version',
  aliasWindow: null,
  host: 'dev-host',
  tier: 'dev-tier',
  framework: 'dev-framework',
  sentParams: { externallySupplied: true },
  carrier: 'dev-carrier'
};
const itemVersion = {
  itemVersionId: 'dev-item-v1',
  itemId: 'dev-item',
  vN: 1,
  contentAxes: { externallySupplied: true },
  flags: [],
  statusHistory: [],
  dispositions: []
};
const run = {
  id: 'dev-run',
  conditionId: condition.id,
  itemVersionId: itemVersion.itemVersionId,
  outcomeClass: 'contract_misunderstanding',
  subCause: 'external-typed-failure-subcause',
  partition: 'native',
  finishReason: 'external-finish-reason',
  tokens: { inUncached: 1, inCached: 0, out: 1, reasoning: 0 },
  latencyMs: 1,
  costUSD: 0,
  rawHash: digest('raw-output'),
  bundleRef: 'dev://bundle/run'
};
const reportTables = (overrides = {}) => ({
  Release: [{
    id: releaseId,
    suiteVer: 'dev-suite',
    contractHashes: { parse: digest('contract') },
    engineVer: 'dev-engine',
    window: 'opaque-dev-window',
    policyVer: 'dev-policy'
  }],
  Model: [model],
  Condition: [condition],
  ItemVersion: [itemVersion],
  Run: [run],
  Judgment: [],
  Score: [],
  Correction: [],
  ...overrides
});
const createReport = (overrides = {}) => {
  const tables = reportTables(overrides);
  return createReportStarSchemaReceipt({
    plan: {
      reportDatasetId: 'd0-development-report',
      schemaIdentity: 'bm12-eight-table-star-schema',
      rawDerivedIdentity:
        'raw-facts-and-externally-derived-scores-remain-distinct',
      publicationIdentity:
        'dataset-generation-is-not-publication-authorization',
      tableSources: Object.fromEntries(REPORT_TABLE_NAMES.map((tableName) => [
        tableName,
        {
          sourceRef: `dev://tables/${tableName}`,
          sourceSha256: hashReportStarSchemaData(tables[tableName])
        }
      ])),
      provenance: { source: 'external-dev-report-process' }
    },
    tables
  });
};
const reportReceipt = createReport();
const createPreconditions = (overrides = {}) => (
  BM13_D0_PRECONDITION_IDS.map((preconditionId) => ({
    preconditionId,
    releaseId,
    stageReceiptSha256: stageReceipt.receiptSha256,
    status: 'satisfied',
    evidenceRef: `evidence://bm13/${preconditionId}`,
    evidenceSha256: digest(`precondition:${preconditionId}`),
    authorityRef: `authority://bm13/${preconditionId}`,
    ...overrides[preconditionId]
  }))
);
const createPlan = ({
  stage = stageReceipt,
  report = reportReceipt,
  evidence = createPreconditions(),
  overrides = {}
} = {}) => ({
  bundleId: 'd0-development-bundle',
  releaseClass: 'D0-development-grade',
  releaseId,
  stageReceiptSha256: stage.receiptSha256,
  reportReceiptSha256: report.receiptSha256,
  preconditionEvidenceSha256: hashDevelopmentBundleData(evidence),
  provenance: { source: 'external-development-process' },
  ...overrides
});
const createReceipt = ({
  stage = stageReceipt,
  report = reportReceipt,
  evidence = createPreconditions(),
  plan = createPlan({ stage, report, evidence })
} = {}) => createDevelopmentBundleReceipt({
  plan,
  stageReceipt: stage,
  reportReceipt: report,
  preconditionEvidence: evidence
});

test('D0 bundles require exactly BM13 preconditions 1 through 5', () => {
  const receipt = createReceipt();
  assert.deepEqual(
    receipt.preconditionIds,
    BM13_D3_PRECONDITION_IDS.slice(0, 5)
  );
  assert.equal(receipt.releaseClass, 'D0-development-grade');
  assert.equal(receipt.stageReceipt.stageId, 'D0');
});

test('D0 preserves run-level typed outcomes without adequacy rows', () => {
  const receipt = createReceipt();
  assert.deepEqual(receipt.reportReceipt.tables.Run, [run]);
  assert.deepEqual(receipt.reportReceipt.tables.Judgment, []);
  assert.deepEqual(receipt.reportReceipt.tables.Score, []);
  assert.deepEqual(receipt.reportReceipt.tables.Correction, []);
  assert.equal(
    receipt.bundleTreatment,
    'development-integrity-bundle-no-adequacy-claim-release-or-publication'
  );
});

test('Judgment, Score, and Correction rows are refused at D0', () => {
  const judgment = {
    runId: run.id,
    reviewerId: 'external-reviewer',
    dimension: 'external-dimension',
    value: 'external-value',
    rubricVer: 'external-rubric',
    adjudicated: false,
    blindingRecord: { external: true }
  };
  const score = {
    estimandId: 'external-score',
    conditionScope: [condition.id],
    value: 0.5,
    ciLow: 0.1,
    ciHigh: 0.9,
    method: 'external-method',
    clusterSpec: {},
    multiplicityFamily: null
  };
  const itemVersion2 = {
    ...itemVersion,
    itemVersionId: 'dev-item-v2',
    vN: 2
  };
  const correction = {
    itemId: itemVersion.itemId,
    fromV: 1,
    toV: 2,
    reason: 'external-correction-reason',
    taxonomyClass: 'external-taxonomy-class',
    affectedScores: [score.estimandId]
  };
  for (const [tableName, overrides] of [
    ['Judgment', { Judgment: [judgment] }],
    ['Score', { Score: [score] }],
    ['Correction', {
      ItemVersion: [itemVersion, itemVersion2],
      Score: [score],
      Correction: [correction]
    }]
  ]) {
    const report = createReport(overrides);
    assert.throws(
      () => createReceipt({
        report,
        plan: createPlan({ report })
      }),
      new RegExp(`${tableName} must be empty at D0`)
    );
  }
});

test('the stage receipt must reconstruct exactly and remain D0', () => {
  const tampered = structuredClone(stageReceipt);
  tampered.stageIdentity = 'tampered-stage';
  assert.throws(
    () => createReceipt({
      stage: tampered,
      plan: createPlan({ stage: tampered })
    }),
    /must match D0|must exactly reconstruct/
  );
  const d1Evidence = stageEvidence.map((record) => ({
    ...record,
    stageId: 'D1'
  }));
  const d1 = createBenchmarkStageReceipt({
    plan: {
      stageRecordId: 'stage-record-d1',
      stageId: 'D1',
      ...BENCHMARK_STAGE_DEFINITIONS.D1,
      evidenceIdentity:
        'external-stage-evidence-does-not-authorize-release-or-publication',
      evidenceSetSha256: hashBenchmarkStageEvidence(d1Evidence),
      provenance: { authority: 'external-stage-process' }
    },
    evidence: d1Evidence
  });
  assert.throws(
    () => createReceipt({
      stage: d1,
      plan: createPlan({ stage: d1 })
    }),
    /stage receipt must be D0/
  );
});

test('the report receipt must reconstruct and match the release', () => {
  const tampered = structuredClone(reportReceipt);
  tampered.tables.Run[0].outcomeClass = 'tampered-outcome';
  assert.throws(
    () => createReceipt({
      report: tampered,
      plan: createPlan({ report: tampered })
    }),
    /does not match its source SHA-256|must exactly reconstruct/
  );
  assert.throws(
    () => createReceipt({
      plan: createPlan({ overrides: { releaseId: 'other-release' } })
    }),
    /releaseId must match the report receipt/
  );
});

test('precondition input order is irrelevant and coverage is exact', () => {
  const evidence = createPreconditions();
  const reversed = [...evidence].reverse();
  assert.deepEqual(
    createReceipt(),
    createReceipt({
      evidence: reversed,
      plan: createPlan({ evidence })
    })
  );
  assert.throws(
    () => createReceipt({
      evidence: evidence.slice(1),
      plan: createPlan({ evidence })
    }),
    /must contain exactly BM13 IDs 1–5/
  );
  assert.throws(
    () => createReceipt({
      evidence: [...evidence, evidence[0]],
      plan: createPlan({ evidence })
    }),
    /precondition IDs must be unique/
  );
});

test('D3-only preconditions cannot enter a D0 bundle', () => {
  const evidence = createPreconditions();
  const changed = [{
    ...evidence[0],
    preconditionId: BM13_D3_PRECONDITION_IDS[5]
  }, ...evidence.slice(1)];
  assert.throws(
    () => createReceipt({
      evidence: changed,
      plan: createPlan({ evidence: changed })
    }),
    /must name a BM13 D0 ID/
  );
});

test('preconditions bind the exact release and stage receipt', () => {
  const evidence = createPreconditions();
  for (const changed of [
    [{ ...evidence[0], releaseId: 'other-release' }, ...evidence.slice(1)],
    [{
      ...evidence[0],
      stageReceiptSha256: digest('other-stage')
    }, ...evidence.slice(1)]
  ]) {
    assert.throws(
      () => createReceipt({
        evidence: changed,
        plan: createPlan()
      }),
      /releaseId must match|stageReceiptSha256 must match/
    );
  }
});

test('hashes, status, and exact fields fail closed', () => {
  const evidence = createPreconditions();
  for (const changed of [
    [{ ...evidence[0], evidenceSha256: 'not-a-hash' }, ...evidence.slice(1)],
    [{ ...evidence[0], status: 'pending' }, ...evidence.slice(1)],
    [{ ...evidence[0], publicationRule: 'invented' }, ...evidence.slice(1)]
  ]) {
    assert.throws(
      () => createReceipt({
        evidence: changed,
        plan: createPlan({ evidence: changed })
      }),
      /lowercase SHA-256|must be one of|fields must be exact/
    );
  }
  assert.throws(
    () => createReceipt({
      plan: { ...createPlan(), deploymentTarget: 'invented' }
    }),
    /fields must be exact/
  );
});

test('receipts are deterministic, immutable, and preserve callers', () => {
  const stageInput = structuredClone(stageReceipt);
  const reportInput = structuredClone(reportReceipt);
  const evidenceInput = createPreconditions();
  const planInput = createPlan({ evidence: evidenceInput });
  const before = JSON.stringify({
    stageInput,
    reportInput,
    evidenceInput,
    planInput
  });
  const first = createDevelopmentBundleReceipt({
    plan: planInput,
    stageReceipt: stageInput,
    reportReceipt: reportInput,
    preconditionEvidence: evidenceInput
  });
  const second = createDevelopmentBundleReceipt({
    plan: planInput,
    stageReceipt: stageInput,
    reportReceipt: reportInput,
    preconditionEvidence: evidenceInput
  });
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify({
    stageInput,
    reportInput,
    evidenceInput,
    planInput
  }), before);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.reportReceipt.tables.Run), true);
});
