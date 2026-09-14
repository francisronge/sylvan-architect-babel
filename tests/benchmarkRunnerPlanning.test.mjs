import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  buildReleaseManifest,
  buildRunSchedule,
  createConditionMatrix,
  createMemoryArtifactSink,
  createRunArchive,
  createStubEngine,
  createStubTransport,
  freezeReleaseManifest,
  hashReleaseManifestDraft,
  runBenchmarkDryRun,
  validateConditionMatrix,
  validateRunSchedule
} from '../bench/index.js';
import { canonicalizeJsonData } from '../bench/jsonData.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const digest = (label) => sha256(label);
const canonicalDigest = (value) => sha256(
  JSON.stringify(canonicalizeJsonData(value))
);

const registryEntry = {
  registryId: 'external-registry-id',
  canonicalName: 'External Model',
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
    documentationRef: 'external-model-page',
    retrievedAt: 'external-retrieval-date',
    controlSet: ['external-control']
  },
  nativeReasoningTiers: ['external-default', 'external-maximum'],
  documentedSamplingDefaults: {
    temperature: 'external-default-value'
  },
  limits: {
    completion: 'external-completion-limit'
  },
  prices: {
    category: 'external-price'
  },
  transportCapabilities: ['external-transport'],
  retentionNoTrainAvailability: {
    value: 'external-observation'
  },
  status: 'active'
};

const probeReceipt = {
  probeId: 'external-probe',
  registryId: 'external-registry-id',
  documentationRef: 'external-model-page',
  retrievedAt: 'external-retrieval-date',
  observedVersion: 'external-version',
  observedControlSet: ['external-control'],
  observedNativeReasoningTiers: ['external-default', 'external-maximum'],
  observedSamplingDefaults: {
    temperature: 'external-default-value'
  },
  observedLimits: {
    completion: 'external-completion-limit'
  },
  observedTransportCapabilities: ['external-transport'],
  technicalAvailability: {
    status: 'available',
    evidenceRef: 'external-availability-evidence'
  },
  provenance: {
    runner: 'external-runner'
  }
};

const manifestDraft = () => buildReleaseManifest({
  manifest: {
    releaseId: 'external-release',
    manifestVersion: 'external-manifest-version',
    suiteVersion: 'external-suite-version',
    contractHashes: {
      prompt: digest('prompt'),
      contract: digest('contract')
    },
    engineVersion: 'external-engine-version',
    runWindow: 'external-run-window',
    policyVersion: 'external-policy-version',
    selectionAuthority: {
      authorityRef: 'external-authority',
      selectedAt: 'external-selection-date',
      selectionEvidenceRef: 'external-selection-evidence'
    },
    selections: [{
      registryId: 'external-registry-id',
      hostRoutes: ['external-host'],
      tierCoverage: {
        scope: 'full-characterization',
        requiredNativeReasoningTiers: ['external-default', 'external-maximum'],
        scopeStatement: 'external-full-characterization-scope'
      },
      requestParameters: {
        temperaturePolicy: 'external-policy',
        completionLimit: 'external-completion-limit'
      },
      admissionProbeRef: 'external-probe'
    }],
    amendmentRefs: []
  },
  registryEntries: [registryEntry],
  admissionProbeReceipts: [probeReceipt]
});

const frozenManifest = () => {
  const draft = manifestDraft();
  return freezeReleaseManifest({
    draft,
    launchAuthorization: {
      authorizationRef: 'external-authorization',
      authorizationEvidenceSha256:
        digest('external-authorization-evidence'),
      authorizedDraftSha256: hashReleaseManifestDraft(draft),
      authorizedAt: 'external-authorization-date',
      authorizedBy: 'external-authority'
    }
  });
};

const condition = (conditionId, nativeTier, overrides = {}) => ({
  conditionId,
  registryId: 'external-registry-id',
  hostRoute: 'external-host',
  frameworkIdentity: 'external-framework',
  nativeTier,
  carrierIdentity: 'external-carrier',
  sentParameters: {
    temperaturePolicy: 'external-policy',
    completionLimit: 'external-completion-limit'
  },
  serviceMetadata: {
    fingerprint: 'external-if-exposed'
  },
  unpinnableBehaviorNotes: [],
  ...overrides
});

const conditionMatrix = () => createConditionMatrix({
  frozenManifest: frozenManifest(),
  conditions: [
    condition('external-condition-default', 'external-default'),
    condition('external-condition-maximum', 'external-maximum')
  ]
});

const design = (overrides = {}) => ({
  designRef: 'external-design-file',
  designSha256: digest('external-design-file-bytes'),
  partition: 'native',
  conditionIds: [
    'external-condition-default',
    'external-condition-maximum'
  ],
  itemReruns: [
    { itemRef: 'external-item-a', reruns: 2 },
    { itemRef: 'external-item-b', reruns: 1 }
  ],
  provenance: {
    suppliedBy: 'external-design-authority'
  },
  ...overrides
});

const scheduleFixture = () => {
  const manifest = frozenManifest();
  const matrix = createConditionMatrix({
    frozenManifest: manifest,
    conditions: [
      condition('external-condition-default', 'external-default'),
      condition('external-condition-maximum', 'external-maximum')
    ]
  });
  return buildRunSchedule({
    frozenManifest: manifest,
    conditionMatrix: matrix,
    design: design()
  });
};

const dryRunReceipt = (scheduleEntry, rawOutput = '{}') => runBenchmarkDryRun({
  plan: {
    runId: scheduleEntry.runId,
    itemRef: scheduleEntry.itemRef,
    condition: scheduleEntry.condition,
    factorAssignments: {},
    requestConfig: {},
    provenance: {}
  },
  transport: createStubTransport({
    ok: true,
    rawOutput,
    finishReason: 'external-finish-reason'
  }),
  engine: createStubEngine({
    parseOutcome: {
      ok: true,
      artifactRef: 'memory://parsed',
      sha256: digest('parsed')
    },
    compileOutcome: {
      ok: true,
      artifactRef: 'memory://compiled',
      sha256: digest('compiled')
    }
  }),
  artifactSink: createMemoryArtifactSink()
});

test('conditions bind external carrier and framework identities to the frozen manifest', () => {
  const matrix = conditionMatrix();
  assert.equal(matrix.conditions[0].carrierIdentity, 'external-carrier');
  assert.equal(matrix.conditions[0].frameworkIdentity, 'external-framework');
  assert.equal(matrix.conditions[0].providerIdentity, 'External Provider');
  assert.equal(
    matrix.conditions[0].sentParameters.completionLimit,
    'external-completion-limit'
  );
  assert.match(matrix.matrixSha256, /^[0-9a-f]{64}$/u);
  assert.ok(Object.isFrozen(matrix.conditions[0]));
});

test('condition matrices cover every manifest-required host and native tier', () => {
  assert.throws(
    () => createConditionMatrix({
      frozenManifest: frozenManifest(),
      conditions: [condition('only-default', 'external-default')]
    }),
    /nativeTier=external-maximum/
  );
  assert.throws(
    () => createConditionMatrix({
      frozenManifest: frozenManifest(),
      conditions: [
        condition('default', 'external-default'),
        condition('bad-host', 'external-maximum', {
          hostRoute: 'unselected-host'
        })
      ]
    }),
    /hostRoute must be selected/
  );
});

test('condition matrices reject parameter drift and semantic duplicates', () => {
  assert.throws(
    () => createConditionMatrix({
      frozenManifest: frozenManifest(),
      conditions: [
        condition('default', 'external-default', {
          sentParameters: {
            completionLimit: 'different-limit'
          }
        }),
        condition('maximum', 'external-maximum')
      ]
    }),
    /sentParameters must exactly match/
  );
  assert.throws(
    () => createConditionMatrix({
      frozenManifest: frozenManifest(),
      conditions: [
        condition('default-a', 'external-default'),
        condition('default-b', 'external-default'),
        condition('maximum', 'external-maximum')
      ]
    }),
    /must not duplicate the same condition identity/
  );
});

test('condition matrices are hash-bound and revalidated against canonical manifests', () => {
  const manifest = frozenManifest();
  const matrix = createConditionMatrix({
    frozenManifest: manifest,
    conditions: [
      condition('external-condition-default', 'external-default'),
      condition('external-condition-maximum', 'external-maximum')
    ]
  });
  assert.deepEqual(
    validateConditionMatrix({ frozenManifest: manifest, conditionMatrix: matrix }),
    matrix
  );
  assert.throws(
    () => validateConditionMatrix({
      frozenManifest: manifest,
      conditionMatrix: {
        ...matrix,
        conditions: matrix.conditions.map((entry, index) => (
          index === 0 ? { ...entry, carrierIdentity: 'tampered-carrier' } : entry
        ))
      }
    }),
    /hash does not match/
  );
  const {
    manifestSha256: _manifestSha256,
    ...manifestBody
  } = structuredClone(manifest);
  manifestBody.selections[0].hostRoutes = ['undeclared-host'];
  const forgedManifest = {
    ...manifestBody,
    manifestSha256: canonicalDigest(manifestBody)
  };
  assert.throws(
    () => createConditionMatrix({
      frozenManifest: forgedManifest,
      conditions: [
        condition('external-condition-default', 'external-default'),
        condition('external-condition-maximum', 'external-maximum')
      ]
    }),
    /undeclared host route/
  );
});

test('run schedules take every rerun count and partition from the external design', () => {
  const manifest = frozenManifest();
  const schedule = buildRunSchedule({
    frozenManifest: manifest,
    conditionMatrix: createConditionMatrix({
      frozenManifest: manifest,
      conditions: [
        condition('external-condition-default', 'external-default'),
        condition('external-condition-maximum', 'external-maximum')
      ]
    }),
    design: design()
  });
  assert.equal(schedule.entries.length, 6);
  assert.deepEqual(
    schedule.entries
      .filter(
        (entry) => entry.condition.conditionId === 'external-condition-default'
      )
      .map(({ itemRef, rerunIndex, condition: runCondition }) => ({
        itemRef,
        rerunIndex,
        partition: runCondition.partitionIdentity
      })),
    [
      { itemRef: 'external-item-a', rerunIndex: 1, partition: 'native' },
      { itemRef: 'external-item-a', rerunIndex: 2, partition: 'native' },
      { itemRef: 'external-item-b', rerunIndex: 1, partition: 'native' }
    ]
  );
  assert.match(schedule.scheduleSha256, /^[0-9a-f]{64}$/u);
  assert.ok(Object.isFrozen(schedule.entries));
});

test('identical external designs produce identical schedules', () => {
  const first = scheduleFixture();
  const second = scheduleFixture();
  assert.deepEqual(second, first);
  assert.deepEqual(validateRunSchedule(first), first);
});

test('run schedules reject hidden defaults, missing conditions, and invalid k', () => {
  const manifest = frozenManifest();
  const matrix = createConditionMatrix({
    frozenManifest: manifest,
    conditions: [
      condition('external-condition-default', 'external-default'),
      condition('external-condition-maximum', 'external-maximum')
    ]
  });
  assert.throws(
    () => buildRunSchedule({
      frozenManifest: manifest,
      conditionMatrix: matrix,
      design: design({ sampleSize: 10 })
    }),
    /extra=\[sampleSize\]/
  );
  assert.throws(
    () => buildRunSchedule({
      frozenManifest: manifest,
      conditionMatrix: matrix,
      design: design({
        conditionIds: ['external-condition-default']
      })
    }),
    /must exactly cover/
  );
  assert.throws(
    () => buildRunSchedule({
      frozenManifest: manifest,
      conditionMatrix: matrix,
      design: design({
        itemReruns: [{ itemRef: 'external-item-a', reruns: 0 }]
      })
    }),
    /reruns must be a positive safe integer/
  );
});

test('run schedules reject condition drift and derived-identity tampering', () => {
  const manifest = frozenManifest();
  const matrix = createConditionMatrix({
    frozenManifest: manifest,
    conditions: [
      condition('external-condition-default', 'external-default'),
      condition('external-condition-maximum', 'external-maximum')
    ]
  });
  assert.throws(
    () => buildRunSchedule({
      frozenManifest: manifest,
      conditionMatrix: {
        ...matrix,
        conditions: matrix.conditions.map((entry, index) => (
          index === 0 ? { ...entry, frameworkIdentity: 'tampered-framework' } : entry
        ))
      },
      design: design()
    }),
    /hash does not match/
  );
  const schedule = buildRunSchedule({
    frozenManifest: manifest,
    conditionMatrix: matrix,
    design: design()
  });
  assert.throws(
    () => validateRunSchedule({
      ...schedule,
      entries: schedule.entries.map((entry, index) => (
        index === 0 ? { ...entry, runId: 'run:tampered' } : entry
      ))
    }),
    /runId does not match/
  );
  const forgedEntry = {
    ...schedule.entries[0],
    itemRef: 'forged-item'
  };
  const forgedIdentity = {
    designSha256: forgedEntry.designSha256,
    conditionsSha256: forgedEntry.conditionsSha256,
    condition: forgedEntry.condition,
    itemRef: forgedEntry.itemRef,
    rerunIndex: forgedEntry.rerunIndex
  };
  forgedEntry.runId = `run:${canonicalDigest(forgedIdentity)}`;
  const forgedScheduleBody = {
    schemaVersion: schedule.schemaVersion,
    design: schedule.design,
    manifestSha256: schedule.manifestSha256,
    conditionsSha256: schedule.conditionsSha256,
    entries: [forgedEntry, ...schedule.entries.slice(1)]
  };
  assert.throws(
    () => validateRunSchedule({
      ...forgedScheduleBody,
      scheduleSha256: canonicalDigest(forgedScheduleBody)
    }),
    /entries do not match/
  );
});

test('dry-run receipts archive exact scheduled identities without linguistic repair', async () => {
  const schedule = scheduleFixture();
  const scheduleEntry = schedule.entries[0];
  const rawOutput = '  {"authored":"名 β","spacing":" exact "}\\n';
  const runReceipt = await dryRunReceipt(scheduleEntry, rawOutput);
  const archive = createRunArchive({
    schedule,
    runId: scheduleEntry.runId,
    runReceipt
  });

  assert.equal(archive.runReceipt.rawOutputArtifact.sha256, sha256(rawOutput));
  assert.equal(JSON.stringify(archive).includes(rawOutput), false);
  assert.match(archive.archiveSha256, /^[0-9a-f]{64}$/u);
  assert.ok(Object.isFrozen(archive.runReceipt));
  assert.deepEqual(
    createRunArchive({ schedule, runId: scheduleEntry.runId, runReceipt }),
    archive
  );
});

test('archives reject schedule mismatch and receipt tampering', async () => {
  const schedule = scheduleFixture();
  const scheduleEntry = schedule.entries[0];
  const runReceipt = await dryRunReceipt(scheduleEntry);

  assert.throws(
    () => createRunArchive({
      schedule,
      runId: 'run:not-present',
      runReceipt
    }),
    /must identify an entry/
  );
  assert.throws(
    () => createRunArchive({
      schedule,
      runId: schedule.entries[1].runId,
      runReceipt
    }),
    /runId does not match/
  );
  assert.throws(
    () => createRunArchive({
      schedule,
      runId: scheduleEntry.runId,
      runReceipt: {
        ...runReceipt,
        outcome: { status: 'tampered' }
      }
    }),
    /hash does not match/
  );
  const forgedReceiptBody = {
    ...structuredClone(runReceipt),
    runPlan: {
      ...structuredClone(runReceipt.runPlan),
      hiddenDefault: 'forbidden'
    }
  };
  delete forgedReceiptBody.receiptSha256;
  assert.throws(
    () => createRunArchive({
      schedule,
      runId: scheduleEntry.runId,
      runReceipt: {
        ...forgedReceiptBody,
        receiptSha256: canonicalDigest(forgedReceiptBody)
      }
    }),
    /run plan fields must be exact/
  );
  const wrongConditionBody = {
    ...structuredClone(runReceipt),
    runPlan: {
      ...structuredClone(runReceipt.runPlan),
      condition: {
        ...structuredClone(runReceipt.runPlan.condition),
        providerIdentity: 'Wrong Provider'
      }
    }
  };
  delete wrongConditionBody.receiptSha256;
  assert.throws(
    () => createRunArchive({
      schedule,
      runId: scheduleEntry.runId,
      runReceipt: {
        ...wrongConditionBody,
        receiptSha256: canonicalDigest(wrongConditionBody)
      }
    }),
    /providerIdentity does not match/
  );
});
