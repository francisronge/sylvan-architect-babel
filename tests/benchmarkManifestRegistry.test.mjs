import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  buildReleaseManifest,
  createAdmissionProbeReceipt,
  createModelRegistryEntry,
  freezeReleaseManifest,
  hashReleaseManifestDraft,
  validateFrozenReleaseManifest,
  verifyAdmissionProbeReceipt
} from '../bench/index.js';

const digest = (text) => createHash('sha256')
  .update(text, 'utf8')
  .digest('hex');

const registryEntryInput = (overrides = {}) => ({
  registryId: 'externally-selected-model',
  canonicalName: 'External Model',
  lab: 'External Lab',
  provider: 'External Provider',
  version: {
    kind: 'immutable-snapshot',
    resolvedVersion: 'external-version'
  },
  hostRoutes: ['external-host-route'],
  api: {
    name: 'external-api',
    version: 'external-api-version'
  },
  officialDocumentation: {
    documentationRef: 'https://example.invalid/per-model-page',
    retrievedAt: 'external-retrieval-date',
    controlSet: ['external-native-control']
  },
  nativeReasoningTiers: ['external-default', 'external-maximum'],
  documentedSamplingDefaults: {
    temperature: 'externally-documented-default'
  },
  limits: {
    output: 'externally-documented-limit'
  },
  prices: {
    category: 'externally-recorded-price'
  },
  transportCapabilities: ['external-transport-capability'],
  retentionNoTrainAvailability: {
    observation: 'external-retention-observation'
  },
  status: 'active',
  ...overrides
});

const probeReceiptInput = (overrides = {}) => ({
  probeId: 'external-probe-receipt',
  registryId: 'externally-selected-model',
  documentationRef: 'https://example.invalid/per-model-page',
  retrievedAt: 'external-retrieval-date',
  observedVersion: 'external-version',
  observedControlSet: ['external-native-control'],
  observedNativeReasoningTiers: ['external-maximum', 'external-default'],
  observedSamplingDefaults: {
    temperature: 'externally-documented-default'
  },
  observedLimits: {
    output: 'externally-documented-limit'
  },
  observedTransportCapabilities: ['external-transport-capability'],
  technicalAvailability: {
    status: 'available',
    evidenceRef: 'external-availability-evidence'
  },
  provenance: {
    runner: 'external-provider-runner'
  },
  ...overrides
});

const manifestInput = (overrides = {}) => ({
  releaseId: 'external-release',
  manifestVersion: 'external-manifest-version',
  suiteVersion: 'external-suite-version',
  contractHashes: {
    prompt: 'external-prompt-hash',
    contract: 'external-contract-hash'
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
    registryId: 'externally-selected-model',
    hostRoutes: ['external-host-route'],
    tierCoverage: {
      scope: 'full-characterization',
      requiredNativeReasoningTiers: ['external-default', 'external-maximum'],
      scopeStatement: 'externally-declared claim scope'
    },
    requestParameters: {
      sentParameter: 'external-value'
    },
    admissionProbeRef: 'external-probe-receipt'
  }],
  amendmentRefs: [],
  ...overrides
});

const buildDraft = (manifest = manifestInput(), {
  registryEntries = [registryEntryInput()],
  admissionProbeReceipts = [probeReceiptInput()]
} = {}) => buildReleaseManifest({
  manifest,
  registryEntries,
  admissionProbeReceipts
});

const launchAuthorization = (draft, overrides = {}) => ({
  authorizationRef: 'external-launch-authorization',
  authorizationEvidenceSha256:
    digest('external-launch-authorization-evidence'),
  authorizedDraftSha256: hashReleaseManifestDraft(draft),
  authorizedAt: 'external-authorization-date',
  authorizedBy: 'external-authority-identity',
  ...overrides
});

test('registry entries preserve external model facts without defaults', () => {
  const entry = createModelRegistryEntry(registryEntryInput());
  assert.equal(entry.registryId, 'externally-selected-model');
  assert.equal(entry.provider, 'External Provider');
  assert.deepEqual(entry.nativeReasoningTiers, [
    'external-default',
    'external-maximum'
  ]);
  assert.ok(Object.isFrozen(entry));

  const missing = registryEntryInput();
  delete missing.prices;
  assert.throws(
    () => createModelRegistryEntry(missing),
    /missing=\[prices\]/
  );
  assert.throws(
    () => createModelRegistryEntry({
      ...registryEntryInput(),
      candidateRosterRank: 1
    }),
    /extra=\[candidateRosterRank\]/
  );
});

test('version labeling distinguishes immutable snapshots from mutable aliases', () => {
  const aliasEntry = createModelRegistryEntry(registryEntryInput({
    version: {
      kind: 'alias-mutable',
      alias: 'external-alias',
      observedVersion: 'external-observed-version',
      runWindow: 'external-alias-window'
    }
  }));
  assert.equal(aliasEntry.version.kind, 'alias-mutable');
  assert.throws(
    () => createModelRegistryEntry(registryEntryInput({
      version: {
        kind: 'alias-mutable',
        resolvedVersion: 'wrong-label'
      }
    })),
    /missing=\[alias,observedVersion,runWindow\].*extra=\[resolvedVersion\]/
  );
});

test('admission evidence compares exact per-model observations without network calls', () => {
  const entry = createModelRegistryEntry(registryEntryInput());
  const receipt = createAdmissionProbeReceipt(probeReceiptInput());
  assert.deepEqual(
    verifyAdmissionProbeReceipt({ registryEntry: entry, receipt }),
    {
      probeId: 'external-probe-receipt',
      registryId: 'externally-selected-model',
      status: 'confirmed',
      mismatches: []
    }
  );

  const mismatch = verifyAdmissionProbeReceipt({
    registryEntry: entry,
    receipt: probeReceiptInput({
      observedNativeReasoningTiers: ['external-default']
    })
  });
  assert.equal(mismatch.status, 'mismatch');
  assert.deepEqual(mismatch.mismatches, ['observedNativeReasoningTiers']);

  const staleRetrieval = verifyAdmissionProbeReceipt({
    registryEntry: entry,
    receipt: probeReceiptInput({
      retrievedAt: 'different-retrieval-date'
    })
  });
  assert.deepEqual(staleRetrieval.mismatches, ['retrievedAt']);
});

test('manifest drafts contain only externally selected registry entries', () => {
  const draft = buildDraft();
  assert.equal(draft.lifecycle, 'draft');
  assert.equal(draft.selections.length, 1);
  assert.equal(draft.selections[0].registryId, 'externally-selected-model');
  assert.equal(draft.registrySnapshot[0].provider, 'External Provider');
  assert.equal(draft.admissionProbeSnapshot[0].probeId, 'external-probe-receipt');
  assert.ok(Object.isFrozen(draft));
  assert.ok(Object.isFrozen(draft.registrySnapshot[0]));

  assert.throws(
    () => buildDraft(manifestInput({
      selections: [{
        ...manifestInput().selections[0],
        registryId: 'not-supplied-by-francis'
      }]
    })),
    /must reference a supplied registry entry/
  );
  assert.throws(
    () => buildDraft(manifestInput(), {
      registryEntries: [
        registryEntryInput(),
        registryEntryInput({
          registryId: 'unselected-registry-entry',
          canonicalName: 'Unselected'
        })
      ]
    }),
    /exactly the externally selected registry IDs/
  );
  assert.throws(
    () => buildDraft(manifestInput(), {
      admissionProbeReceipts: [
        probeReceiptInput(),
        probeReceiptInput({
          probeId: 'unselected-probe',
          registryId: 'unselected-registry-entry'
        })
      ]
    }),
    /exactly the selected probe references/
  );
});

test('tier coverage records external policy and validates its declared scope', () => {
  assert.equal(
    buildDraft().selections[0].tierCoverage.scope,
    'full-characterization'
  );
  assert.doesNotThrow(() => buildDraft(manifestInput({
    selections: [{
      ...manifestInput().selections[0],
      tierCoverage: {
        scope: 'tier-subset',
        requiredNativeReasoningTiers: ['external-default'],
        scopeStatement: 'externally limited claim scope'
      }
    }]
  })));
  assert.throws(
    () => buildDraft(manifestInput({
      selections: [{
        ...manifestInput().selections[0],
        tierCoverage: {
          scope: 'full-characterization',
          requiredNativeReasoningTiers: ['external-default'],
          scopeStatement: 'incorrect full scope'
        }
      }]
    })),
    /must include every recorded native tier/
  );
});

test('manifest construction fails on mismatched probe or undeclared host evidence', () => {
  assert.throws(
    () => buildDraft(manifestInput(), {
      admissionProbeReceipts: [probeReceiptInput({
        observedLimits: { output: 'different-limit' }
      })]
    }),
    /registry mismatches=\[observedLimits\]/
  );
  assert.throws(
    () => buildDraft(manifestInput({
      selections: [{
        ...manifestInput().selections[0],
        hostRoutes: ['undeclared-host']
      }]
    })),
    /contains an undeclared host route/
  );
});

test('freezing requires external authorization and is deterministic', () => {
  const draft = buildDraft();
  const authorization = launchAuthorization(draft);
  const first = freezeReleaseManifest({
    draft,
    launchAuthorization: authorization
  });
  const second = freezeReleaseManifest({
    draft,
    launchAuthorization: authorization
  });

  assert.equal(first.lifecycle, 'frozen');
  assert.match(first.manifestSha256, /^[0-9a-f]{64}$/u);
  assert.equal(
    first.launchAuthorization.authorizedDraftSha256,
    hashReleaseManifestDraft(draft)
  );
  assert.deepEqual(second, first);
  assert.ok(Object.isFrozen(first.launchAuthorization));
  assert.ok(Object.isFrozen(first.registrySnapshot));
  assert.throws(
    () => freezeReleaseManifest({
      draft: buildDraft(),
      launchAuthorization: {
        ...authorization,
        sampleSize: 10
      }
    }),
    /extra=\[sampleSize\]/
  );
  assert.throws(
    () => freezeReleaseManifest({
      draft,
      launchAuthorization: {
        authorizationRef: authorization.authorizationRef,
        authorizedAt: authorization.authorizedAt,
        authorizedBy: authorization.authorizedBy
      }
    }),
    /missing=\[authorizationEvidenceSha256,authorizedDraftSha256\]/
  );
  assert.throws(
    () => freezeReleaseManifest({
      draft,
      launchAuthorization: launchAuthorization(draft, {
        authorizationEvidenceSha256: 'not-a-sha'
      })
    }),
    /authorizationEvidenceSha256 must be a lowercase SHA-256 digest/
  );
  assert.throws(
    () => freezeReleaseManifest({
      draft,
      launchAuthorization: launchAuthorization(draft, {
        authorizedDraftSha256: digest('different-manifest-draft')
      })
    }),
    /must match the canonical release manifest draft/
  );
  assert.throws(
    () => freezeReleaseManifest({
      draft: {
        ...buildDraft(),
        hiddenRoster: ['unselected']
      },
      launchAuthorization: authorization
    }),
    /extra=\[hiddenRoster\]/
  );
  const changedDraft = buildDraft(manifestInput(), {
    registryEntries: [registryEntryInput({
      provider: 'Different External Provider'
    })]
  });
  assert.throws(
    () => freezeReleaseManifest({
      draft: changedDraft,
      launchAuthorization: authorization
    }),
    /must match the canonical release manifest draft/
  );
  const changedEvidence = freezeReleaseManifest({
    draft: changedDraft,
    launchAuthorization: launchAuthorization(changedDraft)
  });
  assert.notEqual(changedEvidence.manifestSha256, first.manifestSha256);

  const tamperedFrozen = structuredClone(first);
  tamperedFrozen.launchAuthorization.authorizationEvidenceSha256 = digest(
    'different-authorization-evidence'
  );
  assert.throws(
    () => validateFrozenReleaseManifest(tamperedFrozen),
    /manifest hash does not match its content/
  );
});
