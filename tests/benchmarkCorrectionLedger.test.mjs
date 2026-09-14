import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCorrectionLedgerReceipt,
  createItemAuditReceipt,
  createReportStarSchemaReceipt,
  hashCorrectionLedgerData,
  hashItemAuditData,
  hashReportStarSchemaData,
  REPORT_TABLE_NAMES
} from '../bench/index.js';

const digest = (text) => hashCorrectionLedgerData({ text });
const releaseId = 'release-correction-1';
const auditCycleId = 'audit-cycle-correction-1';
const itemV1 = {
  itemId: 'item-alpha',
  itemVersionId: 'item-alpha-v1',
  versionNumber: 1,
  itemArtifactRef: 'archive://items/item-alpha/v1',
  itemArtifactSha256: digest('item-alpha-v1'),
  statusHistoryRef: 'archive://status/item-alpha',
  statusHistorySha256: digest('status-item-alpha')
};
const finding = {
  findingId: 'finding-item-alpha',
  taxonomyClass: 'key-error',
  evidenceRef: 'audit://findings/item-alpha',
  evidenceSha256: digest('finding-item-alpha')
};
const affectedScoreIds = ['estimand-alpha'];
const audit = {
  auditId: 'audit-item-alpha-v1',
  itemId: itemV1.itemId,
  auditedItemVersionId: itemV1.itemVersionId,
  auditorIdentity: 'external-auditor',
  auditCompletedAt: 'opaque-audit-time',
  auditArtifactRef: 'audit://records/item-alpha-v1',
  auditArtifactSha256: digest('audit-item-alpha-v1'),
  findings: [finding],
  disposition: 'revised',
  dispositionEvidenceRef: 'audit://disposition/item-alpha-v1',
  dispositionEvidenceSha256: digest('disposition-item-alpha-v1'),
  revision: {
    itemId: itemV1.itemId,
    fromItemVersionId: itemV1.itemVersionId,
    toItemVersionId: 'item-alpha-v2',
    toVersionNumber: 2,
    revisedItemArtifactRef: 'archive://items/item-alpha/v2',
    revisedItemArtifactSha256: digest('item-alpha-v2'),
    affectedScoreSetRef: 'scores://affected/item-alpha',
    affectedScoreSetSha256: digest('affected-item-alpha'),
    dualVersionRepublicationPlanRef:
      'release://dual-version/item-alpha',
    dualVersionRepublicationPlanSha256: digest('dual-version-item-alpha')
  }
};
const itemAuditPlan = {
  auditCycleId,
  auditScopeIdentity: 'externally-declared-complete-item-version-set',
  taxonomyIdentity:
    'key-error-underspecified-checklist-family-doc-gap-ambiguity-defect-contamination-evidence',
  dispositionIdentity:
    'externally-authored-verified-revised-or-documented-uncertain',
  revisionIdentity: 'next-version-plus-dual-version-score-republication',
  uncertainIdentity: 'exclude-from-claim-bearing-scores-until-resolved',
  itemSetSourceRef: 'archive://item-set',
  itemSetSha256: hashItemAuditData([itemV1]),
  auditSetSourceRef: 'archive://audit-set',
  auditSetSha256: hashItemAuditData([audit]),
  targetItemVersionIds: [itemV1.itemVersionId],
  provenance: { authority: 'external-audit-process' }
};
const itemAuditSource = {
  plan: itemAuditPlan,
  items: [itemV1],
  audits: [audit]
};
const itemAuditReceipt = createItemAuditReceipt(itemAuditSource);

const model = {
  registryId: 'model-external',
  name: 'Externally Selected Model',
  lab: 'External Lab',
  manifestRef: 'manifest://model-external'
};
const condition = {
  id: 'condition-external',
  releaseId,
  modelId: model.registryId,
  resolvedVersion: 'resolved-version-external',
  aliasWindow: null,
  host: 'external-host',
  tier: 'external-tier',
  framework: 'external-framework',
  sentParams: { externallySupplied: true },
  carrier: 'external-carrier'
};
const reportItem = (versionNumber) => ({
  itemVersionId: `item-alpha-v${versionNumber}`,
  itemId: itemV1.itemId,
  vN: versionNumber,
  contentAxes: { externallySupplied: true },
  flags: [],
  statusHistory: [{ externalVersion: versionNumber }],
  dispositions: versionNumber === 1 ? [] : [{ disposition: 'revised' }]
});
const score = {
  estimandId: affectedScoreIds[0],
  conditionScope: [condition.id],
  value: 0.5,
  ciLow: 0.2,
  ciHigh: 0.8,
  method: 'external-method',
  clusterSpec: { externallySupplied: true },
  multiplicityFamily: null
};
const correction = {
  itemId: itemV1.itemId,
  fromV: 1,
  toV: 2,
  reason: 'external-correction-reason',
  taxonomyClass: finding.taxonomyClass,
  affectedScores: affectedScoreIds
};
const reportTables = (overrides = {}) => ({
  Release: [{
    id: releaseId,
    suiteVer: 'suite-external',
    contractHashes: { parse: digest('contract') },
    engineVer: 'engine-external',
    window: 'opaque-window',
    policyVer: 'policy-external'
  }],
  Model: [model],
  Condition: [condition],
  ItemVersion: [reportItem(1), reportItem(2)],
  Run: [],
  Judgment: [],
  Score: [score],
  Correction: [correction],
  ...overrides
});
const createReport = (overrides = {}) => {
  const tables = reportTables(overrides);
  return createReportStarSchemaReceipt({
    plan: {
      reportDatasetId: 'correction-report',
      schemaIdentity: 'bm12-eight-table-star-schema',
      rawDerivedIdentity:
        'raw-facts-and-externally-derived-scores-remain-distinct',
      publicationIdentity:
        'dataset-generation-is-not-publication-authorization',
      tableSources: Object.fromEntries(REPORT_TABLE_NAMES.map((tableName) => [
        tableName,
        {
          sourceRef: `archive://report/${tableName}`,
          sourceSha256: hashReportStarSchemaData(tables[tableName])
        }
      ])),
      provenance: { authority: 'external-report-process' }
    },
    tables
  });
};
const reportReceipt = createReport();
const republicationRecord = {
  republicationId: 'republication-item-alpha',
  auditId: audit.auditId,
  itemId: itemV1.itemId,
  fromItemVersionId: itemV1.itemVersionId,
  fromVersionNumber: 1,
  toItemVersionId: audit.revision.toItemVersionId,
  toVersionNumber: audit.revision.toVersionNumber,
  correctionReason: correction.reason,
  taxonomyClass: finding.taxonomyClass,
  affectedScoreIds,
  affectedScoreSetRef: audit.revision.affectedScoreSetRef,
  affectedScoreSetSha256: audit.revision.affectedScoreSetSha256,
  dualVersionRepublicationPlanRef:
    audit.revision.dualVersionRepublicationPlanRef,
  dualVersionRepublicationPlanSha256:
    audit.revision.dualVersionRepublicationPlanSha256,
  scoreArtifacts: [{
    estimandId: affectedScoreIds[0],
    fromVersionRef: 'release://scores/item-alpha/v1',
    fromVersionSha256: digest('scores-item-alpha-v1'),
    toVersionRef: 'release://scores/item-alpha/v2',
    toVersionSha256: digest('scores-item-alpha-v2')
  }],
  authorityRef: 'authority://correction-ledger'
};
const createPlan = ({
  auditReceipt = itemAuditReceipt,
  report = reportReceipt,
  records = [republicationRecord],
  overrides = {}
} = {}) => ({
  ledgerId: 'correction-ledger-cycle-1',
  releaseId,
  auditCycleId,
  itemAuditReceiptSha256: auditReceipt.receiptSha256,
  reportReceiptSha256: report.receiptSha256,
  republicationRecordSha256: hashCorrectionLedgerData(records),
  provenance: { authority: 'external-correction-process' },
  ...overrides
});
const createReceipt = ({
  auditSource = itemAuditSource,
  report = reportReceipt,
  records = [republicationRecord],
  plan = createPlan({ report, records })
} = {}) => createCorrectionLedgerReceipt({
  plan,
  itemAuditSource: auditSource,
  reportReceipt: report,
  republicationRecords: records
});

test('every revised audit yields one exact correction-ledger entry', () => {
  const receipt = createReceipt();
  assert.equal(receipt.correctionCount, 1);
  assert.deepEqual(receipt.correctionEntries, [republicationRecord]);
  assert.deepEqual(receipt.reportReceipt.tables.Correction, [correction]);
  assert.equal(
    receipt.ledgerTreatment,
    'validated-correction-and-dual-version-artifact-inventory-no-republication-release-or-publication-action'
  );
});

test('both versioned score artifacts are mandatory and remain evidence', () => {
  assert.throws(
    () => createReceipt({
      records: [{
        ...republicationRecord,
        scoreArtifacts: [{
          ...republicationRecord.scoreArtifacts[0],
          toVersionRef:
            republicationRecord.scoreArtifacts[0].fromVersionRef
        }]
      }]
    }),
    /must name distinct/
  );
  const receipt = createReceipt();
  assert.deepEqual(
    receipt.correctionEntries[0].scoreArtifacts,
    republicationRecord.scoreArtifacts
  );
});

test('score artifact pairs exactly cover the affected score set', () => {
  const extraScoreId = 'estimand-extra';
  for (const scoreArtifacts of [
    [],
    [
      republicationRecord.scoreArtifacts[0],
      {
        ...republicationRecord.scoreArtifacts[0],
        estimandId: extraScoreId
      }
    ],
    [
      republicationRecord.scoreArtifacts[0],
      { ...republicationRecord.scoreArtifacts[0] }
    ]
  ]) {
    assert.throws(
      () => createReceipt({
        records: [{
          ...republicationRecord,
          scoreArtifacts
        }]
      }),
      /must exactly cover affectedScoreIds/
    );
  }
});

test('affected-score sets and artifact input order are canonical', () => {
  const extraScore = {
    ...score,
    estimandId: 'estimand-extra',
    method: 'external-method-extra'
  };
  const report = createReport({
    Score: [score, extraScore],
    Correction: [{
      ...correction,
      affectedScores: [extraScore.estimandId, score.estimandId]
    }]
  });
  const extraArtifact = {
    estimandId: extraScore.estimandId,
    fromVersionRef: 'release://scores/extra/v1',
    fromVersionSha256: digest('scores-extra-v1'),
    toVersionRef: 'release://scores/extra/v2',
    toVersionSha256: digest('scores-extra-v2')
  };
  const canonicalRecord = {
    ...republicationRecord,
    affectedScoreIds: [score.estimandId, extraScore.estimandId],
    scoreArtifacts: [
      republicationRecord.scoreArtifacts[0],
      extraArtifact
    ]
  };
  const receipt = createReceipt({
    report,
    records: [{
      ...canonicalRecord,
      scoreArtifacts: [...canonicalRecord.scoreArtifacts].reverse()
    }],
    plan: createPlan({
      report,
      records: [canonicalRecord]
    })
  });
  assert.deepEqual(
    receipt.correctionEntries[0].scoreArtifacts,
    canonicalRecord.scoreArtifacts
  );
});

test('audit transitions and external artifacts resist relabeling', () => {
  for (const changed of [
    { auditId: 'other-audit' },
    { itemId: 'other-item' },
    { fromItemVersionId: 'other-v1' },
    { toItemVersionId: 'other-v2' },
    { toVersionNumber: 3 },
    { affectedScoreSetRef: 'scores://other' },
    { dualVersionRepublicationPlanSha256: digest('other-plan') }
  ]) {
    const records = [{ ...republicationRecord, ...changed }];
    assert.throws(
      () => createReceipt({
        records,
        plan: createPlan({ records })
      }),
      /exactly cover|must identify consecutive|must match|preserve/
    );
  }
});

test('report corrections must match reason, taxonomy, and score IDs', () => {
  for (const changed of [
    { reason: 'other-reason' },
    { taxonomyClass: 'ambiguity-defect' },
    { affectedScores: ['other-score'] }
  ]) {
    assert.throws(
      () => {
        const report = createReport({
          Correction: [{ ...correction, ...changed }]
        });
        return createReceipt({
          report,
          plan: createPlan({ report })
        });
      },
      /must reference declared Scores|must match republication evidence/
    );
  }
});

test('finding taxonomy and report item-version identities are exact', () => {
  const wrongTaxonomy = [{
    ...republicationRecord,
    taxonomyClass: 'ambiguity-defect'
  }];
  assert.throws(
    () => createReceipt({
      records: wrongTaxonomy,
      plan: createPlan({ records: wrongTaxonomy })
    }),
    /must name a finding/
  );
  const report = createReport({
    ItemVersion: [
      { ...reportItem(1), itemVersionId: 'fork-v1' },
      reportItem(2)
    ]
  });
  assert.throws(
    () => createReceipt({
      report,
      plan: createPlan({ report })
    }),
    /item-version IDs must match/
  );
  const aliasedReport = createReport({
    ItemVersion: [
      {
        ...reportItem(1),
        itemVersionId: itemV1.itemVersionId,
        itemId: 'other-item-from'
      },
      {
        ...reportItem(2),
        itemVersionId: audit.revision.toItemVersionId,
        itemId: 'other-item-to'
      },
      { ...reportItem(1), itemVersionId: 'fork-item-alpha-v1' },
      { ...reportItem(2), itemVersionId: 'fork-item-alpha-v2' }
    ]
  });
  assert.throws(
    () => createReceipt({
      report: aliasedReport,
      plan: createPlan({ report: aliasedReport })
    }),
    /item-version IDs must match/
  );
});

test('revised audits and report corrections require exact coverage', () => {
  assert.throws(
    () => createReceipt({
      records: [],
      plan: createPlan({ records: [] })
    }),
    /must exactly cover revised audits/
  );
  assert.throws(
    () => {
      const report = createReport({ Correction: [] });
      return createReceipt({
        report,
        plan: createPlan({ report })
      });
    },
    /must reference declared Scores|must have a report Correction/
  );
});

test('an audit cycle without revisions yields an honest empty ledger', () => {
  const emptySource = {
    plan: {
      ...itemAuditPlan,
      itemSetSha256: hashItemAuditData([]),
      auditSetSha256: hashItemAuditData([]),
      targetItemVersionIds: []
    },
    items: [],
    audits: []
  };
  const emptyAuditReceipt = createItemAuditReceipt(emptySource);
  const report = createReport({ Correction: [] });
  const receipt = createReceipt({
    auditSource: emptySource,
    report,
    records: [],
    plan: createPlan({
      auditReceipt: emptyAuditReceipt,
      report,
      records: []
    })
  });
  assert.equal(receipt.correctionCount, 0);
  assert.deepEqual(receipt.correctionEntries, []);
});

test('a revised item may honestly have no affected scores', () => {
  const report = createReport({
    Score: [],
    Correction: [{
      ...correction,
      affectedScores: []
    }]
  });
  const records = [{
    ...republicationRecord,
    affectedScoreIds: [],
    scoreArtifacts: []
  }];
  const receipt = createReceipt({
    report,
    records,
    plan: createPlan({ report, records })
  });
  assert.deepEqual(receipt.correctionEntries[0].affectedScoreIds, []);
  assert.deepEqual(receipt.correctionEntries[0].scoreArtifacts, []);
});

test('republication identities and transition coordinates are unique', () => {
  for (const changed of [
    { republicationId: republicationRecord.republicationId },
    { auditId: republicationRecord.auditId }
  ]) {
    const duplicate = { ...republicationRecord, ...changed };
    assert.throws(
      () => createReceipt({
        records: [republicationRecord, duplicate],
        plan: createPlan({
          records: [republicationRecord, duplicate]
        })
      }),
      /must be unique/
    );
  }
});

test('audit source and report receipt reconstruct exactly', () => {
  const changedAuditSource = structuredClone(itemAuditSource);
  changedAuditSource.audits[0].auditorIdentity = 'other-auditor';
  assert.throws(
    () => createReceipt({ auditSource: changedAuditSource }),
    /records do not match their declared SHA-256|does not match the plan/
  );
  const changedReport = structuredClone(reportReceipt);
  changedReport.tables.Correction[0].reason = 'tampered';
  assert.throws(
    () => createReceipt({
      report: changedReport,
      plan: createPlan({ report: changedReport })
    }),
    /source SHA-256|exactly reconstruct/
  );
});

test('release, cycle, hashes, and exact fields fail closed', () => {
  for (const overrides of [
    { releaseId: 'other-release' },
    { auditCycleId: 'other-cycle' },
    { republicationRecordSha256: digest('other-records') }
  ]) {
    assert.throws(
      () => createReceipt({ plan: createPlan({ overrides }) }),
      /must match|do not match/
    );
  }
  assert.throws(
    () => createReceipt({
      plan: { ...createPlan(), publicationTarget: 'invented' }
    }),
    /fields must be exact/
  );
  const records = [{
    ...republicationRecord,
    scoreArtifacts: [{
      ...republicationRecord.scoreArtifacts[0],
      toVersionSha256: 'not-a-hash'
    }]
  }];
  assert.throws(
    () => createReceipt({
      records,
      plan: createPlan({ records })
    }),
    /lowercase SHA-256/
  );
});

test('receipts are deterministic, immutable, and preserve callers', () => {
  const auditSource = structuredClone(itemAuditSource);
  const report = structuredClone(reportReceipt);
  const records = [structuredClone(republicationRecord)];
  const plan = createPlan({ report, records });
  const before = JSON.stringify({ auditSource, report, records, plan });
  const first = createCorrectionLedgerReceipt({
    plan,
    itemAuditSource: auditSource,
    reportReceipt: report,
    republicationRecords: records
  });
  const second = createCorrectionLedgerReceipt({
    plan,
    itemAuditSource: auditSource,
    reportReceipt: report,
    republicationRecords: records
  });
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify({ auditSource, report, records, plan }), before);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.correctionEntries[0].scoreArtifacts), true);
});
