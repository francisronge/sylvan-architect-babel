import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createReportPreviewReceipt,
  hashReportPreviewData
} from '../bench/reportPreview.js';
import {
  createReportStarSchemaReceipt,
  hashReportStarSchemaData,
  REPORT_TABLE_NAMES
} from '../bench/reportStarSchema.js';

const digest = (text) => hashReportPreviewData({ text });
const release = {
  id: 'release-dev-preview',
  suiteVer: 'suite-dev',
  contractHashes: { parse: digest('contract') },
  engineVer: 'engine-dev',
  window: 'opaque-dev-window',
  policyVer: 'policy-dev'
};
const tables = {
  Release: [release],
  Model: [],
  Condition: [],
  ItemVersion: [],
  Run: [],
  Judgment: [],
  Score: [],
  Correction: []
};
const reportPlan = {
  reportDatasetId: 'report-dev-preview',
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
};
const reportReceipt = createReportStarSchemaReceipt({
  plan: reportPlan,
  tables
});
const artifacts = [
  {
    artifactId: 'preview-table',
    artifactRole: 'external-preview-role',
    sourceTables: ['Release', 'Model'],
    reproducerRef: 'dev://reproducers/preview-table',
    reproducerSha256: digest('preview-table-reproducer'),
    outputRef: 'dev://outputs/preview-table.json',
    outputSha256: digest('preview-table-output'),
    provenance: { owner: 'external-preview-process' }
  },
  {
    artifactId: 'preview-figure',
    artifactRole: 'external-figure-role',
    sourceTables: ['Score', 'Condition'],
    reproducerRef: 'dev://reproducers/preview-figure',
    reproducerSha256: digest('preview-figure-reproducer'),
    outputRef: 'dev://outputs/preview-figure.svg',
    outputSha256: digest('preview-figure-output'),
    provenance: { owner: 'external-preview-process' }
  }
];
const plan = (overrides = {}) => ({
  previewId: 'preview-dev-1',
  environmentIdentity: 'development-data-preview-only',
  publicationIdentity: 'preview-does-not-authorize-publication',
  reportReceiptSha256: reportReceipt.receiptSha256,
  artifactOrder: artifacts.map(({ artifactId }) => artifactId),
  provenance: { authority: 'external-preview-process' },
  ...overrides
});
const createReceipt = (overrides = {}) => createReportPreviewReceipt({
  plan: plan(),
  reportReceipt,
  artifacts,
  ...overrides
});

test('preview artifacts bind exact report data and external reproducers', () => {
  const receipt = createReceipt();
  assert.equal(receipt.reportDatasetId, reportReceipt.reportDatasetId);
  assert.equal(receipt.releaseId, release.id);
  assert.equal(receipt.reportReceiptSha256, reportReceipt.receiptSha256);
  assert.deepEqual(receipt.artifacts, artifacts);
  assert.deepEqual(receipt.artifactOrder, ['preview-table', 'preview-figure']);
  assert.deepEqual(
    Object.keys(receipt.artifactSha256),
    receipt.artifactOrder
  );
});

test('artifact input order is irrelevant when external order is unchanged', () => {
  assert.deepEqual(
    createReceipt(),
    createReceipt({ artifacts: [...artifacts].reverse() })
  );
});

test('the boundary remains development-only and creates no publication state', () => {
  const receipt = createReceipt();
  assert.equal(receipt.environmentIdentity, 'development-data-preview-only');
  assert.equal(
    receipt.publicationIdentity,
    'preview-does-not-authorize-publication'
  );
  assert.equal(
    receipt.previewTreatment,
    'hash-bound-development-artifacts-no-view-selection-or-publication'
  );
  assert.equal(
    Object.keys(receipt).some((key) => /publish|deploy|releaseAction/iu.test(key)),
    false
  );
});

test('the W13 report receipt must reconstruct exactly', () => {
  const reordered = {
    receiptSha256: reportReceipt.receiptSha256,
    ...Object.fromEntries(
      Object.entries(reportReceipt).filter(([key]) => key !== 'receiptSha256')
    )
  };
  assert.deepEqual(
    createReceipt({ reportReceipt: reordered }),
    createReceipt()
  );

  const tampered = structuredClone(reportReceipt);
  tampered.tables.Release[0].engineVer = 'tampered-engine';
  assert.throws(
    () => createReceipt({ reportReceipt: tampered }),
    /does not match its source SHA-256|must exactly reconstruct/
  );

  const surplus = { ...reportReceipt, publicationAuthorized: true };
  assert.throws(
    () => createReceipt({ reportReceipt: surplus }),
    /must exactly reconstruct/
  );
});

test('the plan binds the exact report receipt', () => {
  assert.throws(
    () => createReceipt({
      plan: plan({ reportReceiptSha256: digest('different-report') })
    }),
    /does not match plan.reportReceiptSha256/
  );
});

test('artifact order is a complete one-to-one inventory', () => {
  for (const artifactOrder of [
    ['preview-table'],
    ['preview-table', 'unknown-artifact'],
    ['preview-table', 'preview-table', 'preview-figure']
  ]) {
    assert.throws(
      () => createReceipt({ plan: plan({ artifactOrder }) }),
      /must exactly cover artifact IDs|must not contain duplicates/
    );
  }
  assert.throws(
    () => createReceipt({ artifacts: [artifacts[0], artifacts[0]] }),
    /artifact IDs must be unique/
  );
});

test('artifact definitions resist ID relabeling and source-order evasion', () => {
  const relabeled = {
    ...structuredClone(artifacts[0]),
    artifactId: 'relabeled-preview'
  };
  assert.throws(
    () => createReceipt({
      plan: plan({
        artifactOrder: [...plan().artifactOrder, relabeled.artifactId]
      }),
      artifacts: [...artifacts, relabeled]
    }),
    /artifact substantive definitions must be unique/
  );

  const sourceReordered = {
    ...structuredClone(artifacts[0]),
    artifactId: 'reordered-preview',
    sourceTables: [...artifacts[0].sourceTables].reverse()
  };
  assert.throws(
    () => createReceipt({
      plan: plan({
        artifactOrder: [...plan().artifactOrder, sourceReordered.artifactId]
      }),
      artifacts: [...artifacts, sourceReordered]
    }),
    /artifact substantive definitions must be unique/
  );
});

test('source tables are exact BM12 identities without invented views', () => {
  const changed = {
    ...structuredClone(artifacts[0]),
    sourceTables: ['Release', 'InventedTable']
  };
  assert.throws(
    () => createReceipt({ artifacts: [changed, artifacts[1]] }),
    /must name only BM12 report tables/
  );
  assert.equal(
    createReceipt().artifacts[0].artifactRole,
    artifacts[0].artifactRole
  );
});

test('hashes, provenance, and exact fields fail closed', () => {
  for (const changed of [
    { ...structuredClone(artifacts[0]), outputSha256: 'not-a-hash' },
    { ...structuredClone(artifacts[0]), provenance: [] },
    { ...structuredClone(artifacts[0]), publicationRule: 'invented' }
  ]) {
    assert.throws(
      () => createReceipt({ artifacts: [changed, artifacts[1]] }),
      /lowercase SHA-256|must be an object|fields must be exact/
    );
  }
  assert.throws(
    () => createReceipt({
      plan: { ...plan(), deploymentTarget: 'invented' }
    }),
    /fields must be exact/
  );
});

test('receipts are deterministic, immutable, and preserve callers', () => {
  const planInput = plan();
  const artifactsInput = structuredClone(artifacts);
  const reportInput = structuredClone(reportReceipt);
  const before = JSON.stringify({ planInput, artifactsInput, reportInput });
  const first = createReportPreviewReceipt({
    plan: planInput,
    reportReceipt: reportInput,
    artifacts: artifactsInput
  });
  const second = createReportPreviewReceipt({
    plan: planInput,
    reportReceipt: reportInput,
    artifacts: artifactsInput
  });
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify({ planInput, artifactsInput, reportInput }), before);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.artifacts[0].sourceTables), true);
});
