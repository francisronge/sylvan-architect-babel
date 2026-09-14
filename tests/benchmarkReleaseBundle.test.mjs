import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BM13_D3_PRECONDITION_IDS,
  buildReleaseManifest,
  createReleaseBundleReceipt,
  createReportStarSchemaReceipt,
  freezeReleaseManifest,
  hashReleaseManifestDraft,
  hashReleaseBundleData,
  hashReportStarSchemaData,
  REPORT_TABLE_NAMES
} from '../bench/index.js';

const digest = (text) => hashReleaseBundleData({ text });
const releaseId = 'release-d3-proof';

const registryEntry = {
  registryId: 'selected-model',
  canonicalName: 'Selected External Model',
  lab: 'External Lab',
  provider: 'External Provider',
  version: {
    kind: 'immutable-snapshot',
    resolvedVersion: 'external-version'
  },
  hostRoutes: ['external-host'],
  api: {
    name: 'external-api',
    version: 'external-api-version'
  },
  officialDocumentation: {
    documentationRef: 'https://example.invalid/selected-model',
    retrievedAt: 'opaque-retrieval-record',
    controlSet: ['external-control']
  },
  nativeReasoningTiers: ['external-tier'],
  documentedSamplingDefaults: {
    sampling: 'externally-documented'
  },
  limits: {
    output: 'externally-documented'
  },
  prices: {
    category: 'externally-recorded'
  },
  transportCapabilities: ['external-transport'],
  retentionNoTrainAvailability: {
    observation: 'externally-recorded'
  },
  status: 'active'
};

const admissionProbe = {
  probeId: 'selected-model-admission',
  registryId: registryEntry.registryId,
  documentationRef: registryEntry.officialDocumentation.documentationRef,
  retrievedAt: registryEntry.officialDocumentation.retrievedAt,
  observedVersion: registryEntry.version.resolvedVersion,
  observedControlSet: registryEntry.officialDocumentation.controlSet,
  observedNativeReasoningTiers: registryEntry.nativeReasoningTiers,
  observedSamplingDefaults: registryEntry.documentedSamplingDefaults,
  observedLimits: registryEntry.limits,
  observedTransportCapabilities: registryEntry.transportCapabilities,
  technicalAvailability: {
    status: 'available',
    evidenceRef: 'evidence://admission/availability'
  },
  provenance: {
    source: 'external-admission-process'
  }
};

const contractHashes = {
  prompt: digest('prompt-contract'),
  parser: digest('parser-contract')
};

const manifestInput = {
  releaseId,
  manifestVersion: 'manifest-v1',
  suiteVersion: 'suite-v1',
  contractHashes,
  engineVersion: 'engine-v1',
  runWindow: 'opaque-run-window',
  policyVersion: 'policy-v1',
  selectionAuthority: {
    authorityRef: 'authority://francis/selection',
    selectedAt: 'opaque-selection-record',
    selectionEvidenceRef: 'evidence://selection'
  },
  selections: [{
    registryId: registryEntry.registryId,
    hostRoutes: registryEntry.hostRoutes,
    tierCoverage: {
      scope: 'full-characterization',
      requiredNativeReasoningTiers: registryEntry.nativeReasoningTiers,
      scopeStatement: 'externally declared release scope'
    },
    requestParameters: {
      externallySupplied: true
    },
    admissionProbeRef: admissionProbe.probeId
  }],
  amendmentRefs: []
};

const manifestDraft = buildReleaseManifest({
  manifest: manifestInput,
  registryEntries: [registryEntry],
  admissionProbeReceipts: [admissionProbe]
});
const frozenManifest = freezeReleaseManifest({
  draft: manifestDraft,
  launchAuthorization: {
    authorizationRef: 'authority://francis/launch',
    authorizationEvidenceSha256: digest('launch-authorization-evidence'),
    authorizedDraftSha256: hashReleaseManifestDraft(manifestDraft),
    authorizedAt: 'opaque-launch-record',
    authorizedBy: 'external-authority'
  }
});

const model = {
  registryId: registryEntry.registryId,
  name: registryEntry.canonicalName,
  lab: registryEntry.lab,
  manifestRef: 'artifact://manifest/selected-model'
};
const condition = {
  id: 'condition-1',
  releaseId,
  modelId: model.registryId,
  resolvedVersion: registryEntry.version.resolvedVersion,
  aliasWindow: null,
  host: registryEntry.hostRoutes[0],
  tier: registryEntry.nativeReasoningTiers[0],
  framework: 'external-framework',
  sentParams: { externallySupplied: true },
  carrier: 'external-carrier'
};
const itemVersion = {
  itemVersionId: 'item-1-v1',
  itemId: 'item-1',
  vN: 1,
  contentAxes: { externallySupplied: true },
  flags: [],
  statusHistory: [],
  dispositions: []
};
const run = {
  id: 'run-1',
  conditionId: condition.id,
  itemVersionId: itemVersion.itemVersionId,
  outcomeClass: 'external-outcome',
  subCause: null,
  partition: 'native',
  finishReason: 'external-finish',
  tokens: {
    inUncached: 1,
    inCached: 0,
    out: 1,
    reasoning: 0
  },
  latencyMs: 1,
  costUSD: 0,
  rawHash: digest('raw-output'),
  bundleRef: 'artifact://run/1'
};
const judgment = {
  runId: run.id,
  reviewerId: 'external-reviewer',
  dimension: 'external-dimension',
  value: 'external-value',
  rubricVer: 'external-rubric',
  adjudicated: false,
  blindingRecord: { ref: 'artifact://blinding/1' }
};
const score = {
  estimandId: 'external-estimand',
  conditionScope: [condition.id],
  value: 0.5,
  ciLow: 0.1,
  ciHigh: 0.9,
  method: 'external-method',
  clusterSpec: { externallySupplied: true },
  multiplicityFamily: null
};

const reportTables = (overrides = {}) => ({
  Release: [{
    id: releaseId,
    suiteVer: manifestInput.suiteVersion,
    contractHashes,
    engineVer: manifestInput.engineVersion,
    window: manifestInput.runWindow,
    policyVer: manifestInput.policyVersion
  }],
  Model: [model],
  Condition: [condition],
  ItemVersion: [itemVersion],
  Run: [run],
  Judgment: [judgment],
  Score: [score],
  Correction: [],
  ...overrides
});

const createReport = (overrides = {}) => {
  const tables = reportTables(overrides);
  return createReportStarSchemaReceipt({
    plan: {
      reportDatasetId: 'report-dataset-1',
      schemaIdentity: 'bm12-eight-table-star-schema',
      rawDerivedIdentity:
        'raw-facts-and-externally-derived-scores-remain-distinct',
      publicationIdentity:
        'dataset-generation-is-not-publication-authorization',
      tableSources: Object.fromEntries(REPORT_TABLE_NAMES.map((tableName) => [
        tableName,
        {
          sourceRef: `artifact://report/${tableName}`,
          sourceSha256: hashReportStarSchemaData(tables[tableName])
        }
      ])),
      provenance: { source: 'external-report-process' }
    },
    tables
  });
};

const reportReceipt = createReport();

const createEvidence = ({
  manifest = frozenManifest,
  evidenceOverrides = {}
} = {}) => BM13_D3_PRECONDITION_IDS.map((preconditionId) => ({
  preconditionId,
  releaseId,
  manifestSha256: manifest.manifestSha256,
  status: 'satisfied',
  evidenceRef: `evidence://bm13/${preconditionId}`,
  evidenceSha256: digest(`evidence:${preconditionId}`),
  authorityRef: `authority://bm13/${preconditionId}`,
  ...evidenceOverrides[preconditionId]
}));

const createPlan = ({
  manifest = frozenManifest,
  report = reportReceipt,
  evidence = createEvidence({ manifest }),
  overrides = {}
} = {}) => ({
  bundleId: 'bundle-d3-1',
  releaseClass: 'first-D3-release',
  releaseId,
  manifestSha256: manifest.manifestSha256,
  reportReceiptSha256: report.receiptSha256,
  preconditionEvidenceSha256: hashReleaseBundleData(evidence),
  provenance: { source: 'external-release-process' },
  ...overrides
});

const createReceipt = ({
  manifest = frozenManifest,
  report = reportReceipt,
  evidence = createEvidence({ manifest }),
  plan = createPlan({ manifest, report, evidence })
} = {}) => createReleaseBundleReceipt({
  plan,
  frozenManifest: manifest,
  reportReceipt: report,
  preconditionEvidence: evidence
});

test('the first-D3 bundle requires the exact ten BM13 preconditions', () => {
  const receipt = createReceipt();
  assert.deepEqual(receipt.preconditionIds, BM13_D3_PRECONDITION_IDS);
  assert.equal(receipt.preconditionEvidence.length, 10);
  assert.equal(
    receipt.bundleTreatment,
    'validated-evidence-inventory-not-release-or-publication-authorization'
  );
  for (const omittedId of BM13_D3_PRECONDITION_IDS) {
    const evidence = createEvidence().filter(
      ({ preconditionId }) => preconditionId !== omittedId
    );
    assert.throws(
      () => createReceipt({
        evidence,
        plan: createPlan({ evidence })
      }),
      /exactly the ten BM13 D3 IDs/
    );
  }
});

test('precondition identity rejects duplicates and relabeling', () => {
  const evidence = createEvidence();
  evidence[1] = {
    ...evidence[1],
    preconditionId: evidence[0].preconditionId
  };
  assert.throws(
    () => createReceipt({
      evidence,
      plan: createPlan({ evidence })
    }),
    /precondition IDs must not contain duplicates/
  );

  const relabeled = createEvidence();
  relabeled[0] = {
    ...relabeled[0],
    preconditionId: 'relabeled-precondition'
  };
  assert.throws(
    () => createReceipt({
      evidence: relabeled,
      plan: createPlan({ evidence: relabeled })
    }),
    /exactly the ten BM13 D3 IDs/
  );
});

test('evidence is exact, hash-bound, and scoped to one release manifest', () => {
  const evidence = createEvidence();
  const changedStatus = structuredClone(evidence);
  changedStatus[0].status = 'pending';
  assert.throws(
    () => createReceipt({
      evidence: changedStatus,
      plan: createPlan({ evidence: changedStatus })
    }),
    /status must be one of \[satisfied\]/
  );

  const changedRelease = structuredClone(evidence);
  changedRelease[0].releaseId = 'different-release';
  assert.throws(
    () => createReceipt({
      evidence: changedRelease,
      plan: createPlan({ evidence: changedRelease })
    }),
    /releaseId must match the bundle release/
  );

  const changedManifest = structuredClone(evidence);
  changedManifest[0].manifestSha256 = digest('different-manifest');
  assert.throws(
    () => createReceipt({
      evidence: changedManifest,
      plan: createPlan({ evidence: changedManifest })
    }),
    /manifestSha256 must match the frozen manifest/
  );

  assert.throws(
    () => createReceipt({
      evidence,
      plan: createPlan({
        evidence,
        overrides: {
          preconditionEvidenceSha256: digest('wrong-evidence-set')
        }
      })
    }),
    /does not match its source SHA-256/
  );
});

test('evidence validation is independent of caller order', () => {
  const evidence = createEvidence().reverse();
  const receipt = createReceipt({
    evidence,
    plan: createPlan({ evidence })
  });
  assert.deepEqual(
    receipt.preconditionEvidence.map(({ preconditionId }) => preconditionId),
    evidence.map(({ preconditionId }) => preconditionId)
  );
});

test('the frozen manifest must validate and match the bundle plan', () => {
  assert.throws(
    () => createReceipt({
      plan: createPlan({
        overrides: {
          manifestSha256: digest('wrong-manifest')
        }
      })
    }),
    /frozen manifest does not match plan.manifestSha256/
  );

  const tamperedManifest = {
    ...frozenManifest,
    policyVersion: 'tampered-policy'
  };
  assert.throws(
    () => createReceipt({ manifest: tamperedManifest }),
    /authorizedDraftSha256 must match the canonical release manifest draft/
  );
});

test('the report receipt must reconstruct and match the bundle plan', () => {
  assert.throws(
    () => createReceipt({
      plan: createPlan({
        overrides: {
          reportReceiptSha256: digest('wrong-report')
        }
      })
    }),
    /report receipt does not match plan.reportReceiptSha256/
  );

  const tamperedReport = structuredClone(reportReceipt);
  tamperedReport.tables.Score[0].value = 0.6;
  assert.throws(
    () => createReceipt({ report: tamperedReport }),
    /tables.Score does not match its source SHA-256/
  );

  assert.throws(
    () => createReceipt({
      report: {
        ...reportReceipt,
        publicationRule: 'publish-now'
      }
    }),
    /does not reconstruct from its source tables/
  );
});

test('manifest and report release tuples must agree exactly', () => {
  const changedRelease = {
    ...reportTables().Release[0],
    window: 'different-window'
  };
  const report = createReport({ Release: [changedRelease] });
  assert.throws(
    () => createReceipt({
      report,
      plan: createPlan({ report })
    }),
    /runWindow must match report Release.window/
  );

  const changedContracts = {
    ...reportTables().Release[0],
    contractHashes: {
      ...contractHashes,
      parser: digest('different-parser-contract')
    }
  };
  const changedReport = createReport({ Release: [changedContracts] });
  assert.throws(
    () => createReceipt({
      report: changedReport,
      plan: createPlan({ report: changedReport })
    }),
    /contractHashes must match the report Release/
  );
});

test('report model identities must exactly equal manifest selections', () => {
  const report = createReport({
    Model: [{
      ...model,
      registryId: 'different-model',
      manifestRef: 'artifact://manifest/different-model'
    }],
    Condition: [{
      ...condition,
      modelId: 'different-model'
    }]
  });
  assert.throws(
    () => createReceipt({
      report,
      plan: createPlan({ report })
    }),
    /report Models must exactly match manifest selections/
  );
});

test('the W13 boundary refuses D0 and policy-bearing plan fields', () => {
  assert.throws(
    () => createReceipt({
      plan: createPlan({
        overrides: {
          releaseClass: 'D0-development'
        }
      })
    }),
    /releaseClass must be one of \[first-D3-release\]/
  );
  assert.throws(
    () => createReceipt({
      plan: createPlan({
        overrides: {
          publicationRule: 'publish-now'
        }
      })
    }),
    /fields must be exact/
  );
});

test('receipts are deterministic, immutable, and preserve callers', () => {
  const evidence = createEvidence();
  const before = structuredClone(evidence);
  const first = createReceipt({
    evidence,
    plan: createPlan({ evidence })
  });
  const second = createReceipt({
    evidence,
    plan: createPlan({ evidence })
  });
  assert.deepEqual(first, second);
  assert.deepEqual(evidence, before);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.frozenManifest));
  assert.ok(Object.isFrozen(first.reportReceipt.tables.Run[0]));
  assert.throws(() => {
    first.preconditionEvidence[0].status = 'changed';
  }, TypeError);
});
