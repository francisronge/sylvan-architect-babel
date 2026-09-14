import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createReportAccessibilityAuditReceipt,
  hashReportAccessibilityAuditData,
  REPORT_ACCESSIBILITY_CHECK_IDS
} from '../bench/reportAccessibilityAudit.js';
import {
  createReportPreviewReceipt
} from '../bench/reportPreview.js';
import {
  createReportStarSchemaReceipt,
  hashReportStarSchemaData,
  REPORT_TABLE_NAMES
} from '../bench/reportStarSchema.js';

const digest = (text) => hashReportAccessibilityAuditData({ text });
const tables = {
  Release: [{
    id: 'release-dev-accessibility',
    suiteVer: 'suite-dev',
    contractHashes: { parse: digest('contract') },
    engineVer: 'engine-dev',
    window: 'opaque-dev-window',
    policyVer: 'policy-dev'
  }],
  Model: [],
  Condition: [],
  ItemVersion: [],
  Run: [],
  Judgment: [],
  Score: [],
  Correction: []
};
const reportReceipt = createReportStarSchemaReceipt({
  plan: {
    reportDatasetId: 'report-dev-accessibility',
    schemaIdentity: 'bm12-eight-table-star-schema',
    rawDerivedIdentity: 'raw-facts-and-externally-derived-scores-remain-distinct',
    publicationIdentity: 'dataset-generation-is-not-publication-authorization',
    tableSources: Object.fromEntries(REPORT_TABLE_NAMES.map((tableName) => [
      tableName,
      {
        sourceRef: `dev://tables/${tableName}`,
        sourceSha256: hashReportStarSchemaData(tables[tableName])
      }
    ])),
    provenance: { source: 'external-dev-data' }
  },
  tables
});
const artifacts = [{
  artifactId: 'preview-artifact',
  artifactRole: 'external-preview-role',
  sourceTables: ['Release'],
  reproducerRef: 'dev://reproducer',
  reproducerSha256: digest('reproducer'),
  outputRef: 'dev://output',
  outputSha256: digest('output'),
  provenance: { owner: 'external-preview-process' }
}];
const previewReceipt = createReportPreviewReceipt({
  plan: {
    previewId: 'preview-accessibility',
    environmentIdentity: 'development-data-preview-only',
    publicationIdentity: 'preview-does-not-authorize-publication',
    reportReceiptSha256: reportReceipt.receiptSha256,
    artifactOrder: artifacts.map(({ artifactId }) => artifactId),
    provenance: { authority: 'external-preview-process' }
  },
  reportReceipt,
  artifacts
});
const records = REPORT_ACCESSIBILITY_CHECK_IDS.map((checkId) => ({
  artifactId: artifacts[0].artifactId,
  artifactSha256: previewReceipt.artifactSha256[artifacts[0].artifactId],
  checkId,
  observationLabel: `external-observation-${checkId}`,
  auditorIdentity: 'external-accessibility-auditor',
  observedAt: 'opaque-observation-time',
  evidenceRef: `dev://evidence/${checkId}`,
  evidenceSha256: digest(`evidence-${checkId}`),
  findingArtifacts: checkId === 'reduced-motion'
    ? [{
        findingRef: 'dev://findings/reduced-motion',
        findingSha256: digest('finding-reduced-motion')
      }]
    : [],
  provenance: { source: 'external-audit-process' }
}));
const plan = (overrides = {}) => ({
  auditId: 'audit-dev-1',
  checklistIdentity: 'bm12-accessibility-and-static-reproducibility',
  evidenceIdentity: 'external-observations-no-publication-authorization',
  previewReceiptSha256: previewReceipt.receiptSha256,
  provenance: { authority: 'external-audit-process' },
  ...overrides
});
const createReceipt = (overrides = {}) => (
  createReportAccessibilityAuditReceipt({
    plan: plan(),
    reportReceipt,
    previewReceipt,
    records,
    ...overrides
  })
);

test('every preview artifact has evidence for all four BM12 checks', () => {
  const receipt = createReceipt();
  assert.deepEqual(receipt.checkIds, REPORT_ACCESSIBILITY_CHECK_IDS);
  assert.equal(
    receipt.observationCount,
    artifacts.length * REPORT_ACCESSIBILITY_CHECK_IDS.length
  );
  assert.deepEqual(receipt.records, records);
  assert.equal(receipt.previewReceiptSha256, previewReceipt.receiptSha256);
});

test('record input order does not change canonical evidence order', () => {
  assert.deepEqual(
    createReceipt(),
    createReceipt({ records: [...records].reverse() })
  );
});

test('observation labels remain external evidence rather than verdicts', () => {
  const receipt = createReceipt();
  assert.equal(
    receipt.records[0].observationLabel,
    records[0].observationLabel
  );
  assert.equal(
    receipt.auditTreatment,
    'external-accessibility-evidence-no-pass-fail-or-publication-authorization'
  );
  assert.equal(
    Object.keys(receipt).some((key) => /passed|approved|deploy/iu.test(key)),
    false
  );
});

test('the W15a preview receipt must reconstruct exactly', () => {
  const reordered = {
    receiptSha256: previewReceipt.receiptSha256,
    ...Object.fromEntries(
      Object.entries(previewReceipt).filter(([key]) => key !== 'receiptSha256')
    )
  };
  assert.deepEqual(
    createReceipt({ previewReceipt: reordered }),
    createReceipt()
  );

  const tampered = structuredClone(previewReceipt);
  tampered.artifacts[0].outputRef = 'dev://tampered-output';
  assert.throws(
    () => createReceipt({ previewReceipt: tampered }),
    /must exactly reconstruct|does not match plan/
  );
  assert.throws(
    () => createReceipt({
      previewReceipt: { ...previewReceipt, publicationAuthorized: true }
    }),
    /must exactly reconstruct/
  );
});

test('the plan binds the exact preview receipt', () => {
  assert.throws(
    () => createReceipt({
      plan: plan({ previewReceiptSha256: digest('stale-preview') })
    }),
    /previewReceipt does not match the plan/
  );
});

test('the plan fixes only the BM12 checklist and evidence-only boundary', () => {
  for (const changedPlan of [
    plan({ checklistIdentity: 'invented-checklist' }),
    plan({ evidenceIdentity: 'invented-approval' }),
    { ...plan(), publicationRule: 'invented' }
  ]) {
    assert.throws(
      () => createReceipt({ plan: changedPlan }),
      /must be bm12-accessibility|must be external-observations|fields must be exact/
    );
  }
});

test('artifact and check coordinates are complete and unique', () => {
  assert.throws(
    () => createReceipt({ records: records.slice(1) }),
    /must cover every artifact\/check pair/
  );
  assert.throws(
    () => createReceipt({ records: [...records, records[0]] }),
    /artifact\/check coordinates must be unique/
  );
  assert.throws(
    () => createReceipt({
      records: [
        { ...records[0], checkId: 'invented-check' },
        ...records.slice(1)
      ]
    }),
    /must name a BM12 report check/
  );
});

test('records bind exact preview artifact identities', () => {
  for (const changedRecord of [
    { ...records[0], artifactId: 'unknown-artifact' },
    { ...records[0], artifactSha256: digest('wrong-artifact') }
  ]) {
    assert.throws(
      () => createReceipt({
        records: [changedRecord, ...records.slice(1)]
      }),
      /must name a preview artifact|must bind the exact preview artifact SHA-256/
    );
  }
});

test('evidence, findings, provenance, and exact fields fail closed', () => {
  for (const changedRecord of [
    { ...records[0], evidenceSha256: 'not-a-hash' },
    { ...records[0], provenance: [] },
    {
      ...records[0],
      findingArtifacts: [
        {
          findingRef: 'dev://duplicate-finding',
          findingSha256: digest('finding-a')
        },
        {
          findingRef: 'dev://duplicate-finding',
          findingSha256: digest('finding-b')
        }
      ]
    },
    { ...records[0], publicationRule: 'invented' }
  ]) {
    assert.throws(
      () => createReceipt({
        records: [changedRecord, ...records.slice(1)]
      }),
      /lowercase SHA-256|must be an object|finding refs must be unique|fields must be exact/
    );
  }
});

test('an empty preview produces an honest empty evidence inventory', () => {
  const emptyPreview = createReportPreviewReceipt({
    plan: {
      previewId: 'empty-preview',
      environmentIdentity: 'development-data-preview-only',
      publicationIdentity: 'preview-does-not-authorize-publication',
      reportReceiptSha256: reportReceipt.receiptSha256,
      artifactOrder: [],
      provenance: { authority: 'external-preview-process' }
    },
    reportReceipt,
    artifacts: []
  });
  const receipt = createReceipt({
    plan: plan({ previewReceiptSha256: emptyPreview.receiptSha256 }),
    previewReceipt: emptyPreview,
    records: []
  });
  assert.equal(receipt.observationCount, 0);
  assert.deepEqual(receipt.records, []);
});

test('receipts are deterministic, immutable, and preserve callers', () => {
  const planInput = plan();
  const reportInput = structuredClone(reportReceipt);
  const previewInput = structuredClone(previewReceipt);
  const recordsInput = structuredClone(records);
  const before = JSON.stringify({
    planInput,
    reportInput,
    previewInput,
    recordsInput
  });
  const first = createReportAccessibilityAuditReceipt({
    plan: planInput,
    reportReceipt: reportInput,
    previewReceipt: previewInput,
    records: recordsInput
  });
  const second = createReportAccessibilityAuditReceipt({
    plan: planInput,
    reportReceipt: reportInput,
    previewReceipt: previewInput,
    records: recordsInput
  });
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify({
    planInput,
    reportInput,
    previewInput,
    recordsInput
  }), before);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.records[0].findingArtifacts), true);
});
