import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  createMemorizationProbeReceipt,
  hashMemorizationProbeData
} from '../bench/memorizationProbe.js';

const raw = (text) => Buffer.from(text, 'utf8');
const encoded = (text) => raw(text).toString('base64');
const rawDigest = (text) => createHash('sha256').update(raw(text)).digest('hex');
const digest = (text) => hashMemorizationProbeData({ text });

const probe = (overrides = {}) => ({
  probeId: 'probe-1',
  itemVersionId: 'item-v1',
  inputArtifactRef: 'archive://input-1',
  inputArtifactSha256: digest('input-1'),
  expectedContinuationArtifactRef: 'archive://expected-1',
  expectedContinuationSha256: rawDigest('authored bytes'),
  expectedContinuationBase64: encoded('authored bytes'),
  ...overrides
});

const probes = [
  probe(),
  probe({
    probeId: 'probe-2',
    itemVersionId: 'item-v2',
    inputArtifactRef: 'archive://input-2',
    inputArtifactSha256: digest('input-2'),
    expectedContinuationArtifactRef: 'archive://expected-2',
    expectedContinuationSha256: rawDigest('second expectation'),
    expectedContinuationBase64: encoded('second expectation')
  }),
  probe({
    probeId: 'probe-unspent',
    itemVersionId: 'item-v3',
    inputArtifactRef: 'archive://input-3',
    inputArtifactSha256: digest('input-3'),
    expectedContinuationArtifactRef: 'archive://expected-3',
    expectedContinuationSha256: rawDigest('unspent expectation'),
    expectedContinuationBase64: encoded('unspent expectation')
  })
];

const observation = (targetProbe, overrides = {}) => ({
  observationId: `observation-${targetProbe.probeId}`,
  probeId: targetProbe.probeId,
  executionId: `execution-${targetProbe.probeId}`,
  providerIdentity: 'provider-a',
  conditionIdentity: 'condition-a',
  windowIdentity: 'window-a',
  occurredAt: 'opaque-date-a',
  exposureLedgerReceiptRef: 'ledger://receipt-a',
  exposureLedgerReceiptSha256: digest('ledger-receipt-a'),
  exposureEventId: `exposure-${targetProbe.probeId}`,
  inputArtifactRef: targetProbe.inputArtifactRef,
  inputArtifactSha256: targetProbe.inputArtifactSha256,
  expectedContinuationArtifactRef:
    targetProbe.expectedContinuationArtifactRef,
  expectedContinuationSha256: targetProbe.expectedContinuationSha256,
  observedContinuationArtifactRef:
    `archive://observed-${targetProbe.probeId}`,
  observedContinuationSha256: targetProbe.expectedContinuationSha256,
  observedContinuationBase64: targetProbe.expectedContinuationBase64,
  ...overrides
});

const observations = [
  observation(probes[0]),
  observation(probes[1], {
    observedContinuationSha256: rawDigest('different bytes'),
    observedContinuationBase64: encoded('different bytes')
  })
];

const plan = (overrides = {}) => ({
  analysisId: 'memorization-probe-analysis',
  comparisonIdentity:
    'exact-byte-equality-over-externally-extracted-continuation-windows',
  probeSpendIdentity: 'first-declared-use-spends-probe',
  observationOrderIdentity:
    'externally-declared-complete-observation-order-only',
  interpretationIdentity:
    'verbatim-match-is-observation-not-memorization-proof',
  extractionMethodRef: 'method://continuation-extraction',
  extractionMethodSha256: digest('continuation-extraction'),
  probeSetSourceRef: 'archive://probe-set',
  probeSetSha256: hashMemorizationProbeData(probes),
  observationSetSourceRef: 'archive://observation-set',
  observationSetSha256: hashMemorizationProbeData(observations),
  orderedObservationIds: observations.map(({ observationId }) => observationId),
  provenance: { owner: 'external-study-designer' },
  ...overrides
});

const createReceipt = (overrides = {}) => createMemorizationProbeReceipt({
  plan: plan(),
  probes,
  observations,
  ...overrides
});

test('raw continuation bytes yield observation labels without a verdict', () => {
  const receipt = createReceipt();
  assert.equal(receipt.exactVerbatimMatchCount, 1);
  assert.deepEqual(
    receipt.observationEvidence.map((entry) => ({
      exactVerbatimMatch: entry.exactVerbatimMatch,
      evidenceLabel: entry.evidenceLabel
    })),
    [
      {
        exactVerbatimMatch: true,
        evidenceLabel: 'exact-verbatim-continuation-match-observed'
      },
      {
        exactVerbatimMatch: false,
        evidenceLabel: 'no-exact-verbatim-continuation-match-observed'
      }
    ]
  );
  assert.equal('memorizationVerdict' in receipt, false);
  assert.equal(
    receipt.observationEvidence[0].observedContinuationArtifactRef,
    observations[0].observedContinuationArtifactRef
  );
  assert.equal(
    receipt.observationEvidence[0].exposureLedgerReceiptSha256,
    observations[0].exposureLedgerReceiptSha256
  );
});

test('byte comparison does not normalize linguistically equivalent text', () => {
  const composed = probe({
    expectedContinuationSha256: rawDigest('\u00e9'),
    expectedContinuationBase64: encoded('\u00e9')
  });
  const decomposedObservation = observation(composed, {
    observedContinuationSha256: rawDigest('e\u0301'),
    observedContinuationBase64: encoded('e\u0301')
  });
  const localProbes = [composed];
  const localObservations = [decomposedObservation];
  const receipt = createMemorizationProbeReceipt({
    plan: plan({
      probeSetSha256: hashMemorizationProbeData(localProbes),
      observationSetSha256: hashMemorizationProbeData(localObservations),
      orderedObservationIds: [decomposedObservation.observationId]
    }),
    probes: localProbes,
    observations: localObservations
  });
  assert.equal(receipt.observationEvidence[0].exactVerbatimMatch, false);
});

test('only the externally declared order selects first use', () => {
  const secondUse = observation(probes[0], {
    observationId: 'observation-later-in-order',
    executionId: 'execution-later-in-order',
    occurredAt: '0000-looks-earlier',
    exposureEventId: 'exposure-later-in-order',
    observedContinuationArtifactRef: 'archive://observed-later-in-order'
  });
  const localObservations = [observations[0], secondUse];
  const receipt = createMemorizationProbeReceipt({
    plan: plan({
      observationSetSha256: hashMemorizationProbeData(localObservations),
      orderedObservationIds: [
        secondUse.observationId,
        observations[0].observationId
      ]
    }),
    probes,
    observations: localObservations
  });
  assert.equal(
    receipt.probeLifecycle[0].firstUse.observationId,
    secondUse.observationId
  );
  assert.equal(
    receipt.probeLifecycle[0].firstUse.occurredAt,
    '0000-looks-earlier'
  );
});

test('unobserved probes receive only observation-set-local status', () => {
  const receipt = createReceipt();
  assert.deepEqual(receipt.probeLifecycle[2], {
    probeId: 'probe-unspent',
    itemVersionId: 'item-v3',
    lifecycleStatus: 'unspent-in-declared-observation-set',
    firstUse: null
  });
});

test('an externally declared empty scope stays empty and makes no claim', () => {
  const receipt = createMemorizationProbeReceipt({
    plan: plan({
      probeSetSha256: hashMemorizationProbeData([]),
      observationSetSha256: hashMemorizationProbeData([]),
      orderedObservationIds: []
    }),
    probes: [],
    observations: []
  });
  assert.equal(receipt.probeCount, 0);
  assert.equal(receipt.observationCount, 0);
  assert.equal(receipt.exactVerbatimMatchCount, 0);
  assert.deepEqual(receipt.probeLifecycle, []);
  assert.deepEqual(receipt.observationEvidence, []);
});

test('raw byte hashes and canonical base64 fail closed', () => {
  const badProbe = probe({ expectedContinuationSha256: digest('wrong') });
  assert.throws(
    () => createMemorizationProbeReceipt({
      plan: plan({ probeSetSha256: hashMemorizationProbeData([badProbe]) }),
      probes: [badProbe],
      observations: []
    }),
    /does not match expectedContinuationSha256/
  );
  const badObservation = observation(probes[0], {
    observedContinuationBase64: 'YQ'
  });
  assert.throws(
    () => createMemorizationProbeReceipt({
      plan: plan({
        observationSetSha256: hashMemorizationProbeData([badObservation]),
        orderedObservationIds: [badObservation.observationId]
      }),
      probes,
      observations: [badObservation]
    }),
    /canonical base64/
  );
});

test('declared observation order must be unique and exactly complete', () => {
  assert.throws(
    () => createMemorizationProbeReceipt({
      plan: plan({
        orderedObservationIds: [observations[0].observationId]
      }),
      probes,
      observations
    }),
    /exactly cover/
  );
  assert.throws(
    () => createMemorizationProbeReceipt({
      plan: plan({
        orderedObservationIds: [
          observations[0].observationId,
          observations[0].observationId
        ]
      }),
      probes,
      observations
    }),
    /must not contain duplicates/
  );
});

test('observations must retain their declared probe artifacts', () => {
  const changed = structuredClone(observations);
  changed[0].inputArtifactRef = 'archive://different-input';
  assert.throws(
    () => createMemorizationProbeReceipt({
      plan: plan({
        observationSetSha256: hashMemorizationProbeData(changed)
      }),
      probes,
      observations: changed
    }),
    /must match its probe definition/
  );
});

test('probe definitions reject ID relabeling', () => {
  const changed = [probes[0], {
    ...probes[0],
    probeId: 'probe-relabeled'
  }];
  assert.throws(
    () => createMemorizationProbeReceipt({
      plan: plan({
        probeSetSha256: hashMemorizationProbeData(changed),
        observationSetSha256: hashMemorizationProbeData([]),
        orderedObservationIds: []
      }),
      probes: changed,
      observations: []
    }),
    /definitions must use exactly one probeId/
  );
});

test('semantic evidence rejects observation and execution relabeling', () => {
  const changed = [
    observations[0],
    {
      ...observations[0],
      observationId: 'observation-relabeled',
      executionId: 'execution-relabeled',
      occurredAt: 'opaque-relabeled-date',
      exposureEventId: 'exposure-relabeled'
    }
  ];
  assert.throws(
    () => createMemorizationProbeReceipt({
      plan: plan({
        observationSetSha256: hashMemorizationProbeData(changed),
        orderedObservationIds: changed.map(({ observationId }) => observationId)
      }),
      probes,
      observations: changed
    }),
    /must not relabel duplicate evidence/
  );
});

test('distinct windows and evidence artifacts may reuse execution labels', () => {
  const repeatedExecution = observation(probes[0], {
    observationId: 'observation-next-window',
    windowIdentity: 'window-b',
    occurredAt: 'opaque-date-b',
    exposureEventId: 'exposure-next-window',
    observedContinuationArtifactRef: 'archive://observed-next-window'
  });
  const localObservations = [observations[0], repeatedExecution];
  const receipt = createMemorizationProbeReceipt({
    plan: plan({
      observationSetSha256: hashMemorizationProbeData(localObservations),
      orderedObservationIds: localObservations.map(
        ({ observationId }) => observationId
      )
    }),
    probes,
    observations: localObservations
  });
  assert.equal(receipt.observationCount, 2);
});

test('plans and data are hash-bound and reject policy-bearing extras', () => {
  const changed = structuredClone(observations);
  changed[0].providerIdentity = 'provider-b';
  assert.throws(
    () => createMemorizationProbeReceipt({
      plan: plan(),
      probes,
      observations: changed
    }),
    /observations do not match/
  );
  assert.throws(
    () => createMemorizationProbeReceipt({
      plan: {
        ...plan(),
        rotationThreshold: 0.5
      },
      probes,
      observations
    }),
    /fields must be exact/
  );
});

test('receipts are deterministic, immutable, and do not mutate callers', () => {
  const planValue = plan();
  const probeValue = structuredClone(probes);
  const observationValue = structuredClone(observations);
  const before = JSON.stringify({
    planValue,
    probeValue,
    observationValue
  });
  const first = createMemorizationProbeReceipt({
    plan: planValue,
    probes: probeValue,
    observations: observationValue
  });
  const second = createMemorizationProbeReceipt({
    plan: planValue,
    probes: probeValue,
    observations: observationValue
  });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(JSON.stringify({
    planValue,
    probeValue,
    observationValue
  }), before);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.probeLifecycle));
  assert.ok(Object.isFrozen(first.observationEvidence[0]));
});
