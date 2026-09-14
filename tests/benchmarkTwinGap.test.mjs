import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTwinGapReceipt,
  hashTwinGapData
} from '../bench/twinGap.js';

const digest = (text) => hashTwinGapData({ text });
const record = (overrides = {}) => ({
  comparisonId: 'comparison-1',
  twinPairId: 'pair-1',
  providerIdentity: 'provider-a',
  fromConditionIdentity: 'condition-a-window-1',
  toConditionIdentity: 'condition-a-window-2',
  outcomeIdentity: 'adequacy-rate',
  outcomeEvidenceRef: 'scores://paired-outcomes',
  outcomeEvidenceSha256: digest('paired-outcomes'),
  anchorItemVersionId: 'anchor-v1',
  twinItemVersionId: 'twin-v1',
  fromWindowId: 'window-1',
  toWindowId: 'window-2',
  fromAnchorRunId: 'from-anchor-run',
  fromAnchorRunSha256: digest('from-anchor-run'),
  fromAnchorValue: 0.5,
  fromTwinRunId: 'from-twin-run',
  fromTwinRunSha256: digest('from-twin-run'),
  fromTwinValue: 0.5,
  toAnchorRunId: 'to-anchor-run',
  toAnchorRunSha256: digest('to-anchor-run'),
  toAnchorValue: 0.8,
  toTwinRunId: 'to-twin-run',
  toTwinRunSha256: digest('to-twin-run'),
  toTwinValue: 0.6,
  exposureLedgerReceiptRef: 'ledger://receipt',
  exposureLedgerReceiptSha256: digest('ledger-receipt'),
  anchorExposureEventId: 'anchor-exposure-event',
  twinNonExposureEvidenceRef: 'ledger://twin-nonexposure',
  twinNonExposureEvidenceSha256: digest('twin-nonexposure'),
  matchingEvidenceRef: 'design://twin-match',
  matchingEvidenceSha256: digest('twin-match'),
  ...overrides
});
const records = [
  record(),
  record({
    comparisonId: 'comparison-2',
    twinPairId: 'pair-2',
    anchorItemVersionId: 'anchor-v2',
    twinItemVersionId: 'twin-v2',
    fromAnchorRunId: 'from-anchor-run-2',
    fromAnchorRunSha256: digest('from-anchor-run-2'),
    fromTwinRunId: 'from-twin-run-2',
    fromTwinRunSha256: digest('from-twin-run-2'),
    toAnchorRunId: 'to-anchor-run-2',
    toAnchorRunSha256: digest('to-anchor-run-2'),
    toTwinRunId: 'to-twin-run-2',
    toTwinRunSha256: digest('to-twin-run-2'),
    fromAnchorValue: 0.7,
    fromTwinValue: 0.4,
    toAnchorValue: 0.6,
    toTwinValue: 0.4
  })
];
const plan = (overrides = {}) => ({
  analysisId: 'twin-gap-analysis-1',
  matchingIdentity: 'externally-matched-exposed-anchor-and-unexposed-twin',
  windowOrderIdentity: 'externally-declared-from-window-before-to-window',
  windowOrderSourceRef: 'design://window-order',
  gapIdentity: 'signed-anchor-value-minus-twin-value',
  wideningIdentity: 'increasing-absolute-gap-magnitude',
  wideningMethodSourceRef: 'design://widening-method',
  interpretationIdentity: 'widening-gap-is-evidence-never-proof',
  recordSetSourceRef: 'archive://twin-gap-records',
  recordSetSha256: hashTwinGapData(records),
  provenance: { designRef: 'external://twin-gap-design' },
  ...overrides
});

const validate = (overrides = {}) => createTwinGapReceipt({
  plan: plan(),
  records,
  ...overrides
});

test('pair-level signed gaps preserve anchor and twin values exactly', () => {
  const receipt = validate();
  assert.equal(receipt.comparisonCount, 2);
  assert.equal(receipt.pairComparisons[0].fromSignedGap, 0);
  assert.ok(
    Math.abs(receipt.pairComparisons[0].toSignedGap - 0.2)
    < Number.EPSILON
  );
  assert.ok(
    Math.abs(receipt.pairComparisons[1].fromSignedGap - 0.3)
    < Number.EPSILON
  );
  assert.ok(
    Math.abs(receipt.pairComparisons[1].toSignedGap - 0.2)
    < Number.EPSILON
  );
});

test('only increasing absolute gap magnitude is labeled widening evidence', () => {
  const receipt = validate();
  assert.equal(receipt.wideningEvidenceCount, 1);
  assert.equal(
    receipt.pairComparisons[0].evidenceLabel,
    'widening-evidence-not-proof'
  );
  assert.equal(receipt.pairComparisons[1].evidenceLabel, 'not-widening');
});

test('matching, exposure, and non-exposure evidence are mandatory', () => {
  for (const field of [
    'exposureLedgerReceiptSha256',
    'twinNonExposureEvidenceSha256',
    'matchingEvidenceSha256',
    'outcomeEvidenceSha256'
  ]) {
    const changed = structuredClone(records);
    changed[0][field] = 'not-a-hash';
    assert.throws(
      () => createTwinGapReceipt({
        plan: plan({ recordSetSha256: hashTwinGapData(changed) }),
        records: changed
      }),
      new RegExp(field)
    );
  }
});

test('each comparison binds distinct windows, items, and four runs', () => {
  for (const changedRecord of [
    record({ toWindowId: 'window-1' }),
    record({ twinItemVersionId: 'anchor-v1' }),
    record({ toTwinRunId: 'to-anchor-run' })
  ]) {
    const changed = [changedRecord, records[1]];
    assert.throws(
      () => createTwinGapReceipt({
        plan: plan({ recordSetSha256: hashTwinGapData(changed) }),
        records: changed
      }),
      /distinct/
    );
  }
});

test('comparison and pair coordinates cannot be duplicated', () => {
  const changed = [records[0], structuredClone(records[0])];
  assert.throws(
    () => createTwinGapReceipt({
      plan: plan({ recordSetSha256: hashTwinGapData(changed) }),
      records: changed
    }),
    /unique comparisonId\/twinPairId/
  );
});

test('twin-pair identity stays stable and semantic comparisons are unique', () => {
  const changedPair = [
    records[0],
    record({
      comparisonId: 'comparison-other',
      anchorItemVersionId: 'different-anchor'
    })
  ];
  assert.throws(
    () => createTwinGapReceipt({
      plan: plan({ recordSetSha256: hashTwinGapData(changedPair) }),
      records: changedPair
    }),
    /must retain one pair definition/
  );
  const duplicateComparison = [
    records[0],
    record({ comparisonId: 'comparison-renamed' })
  ];
  assert.throws(
    () => createTwinGapReceipt({
      plan: plan({ recordSetSha256: hashTwinGapData(duplicateComparison) }),
      records: duplicateComparison
    }),
    /must not duplicate/
  );
  const relabeledDuplicate = [
    records[0],
    record({
      comparisonId: 'comparison-renamed',
      twinPairId: 'pair-renamed'
    })
  ];
  assert.throws(
    () => createTwinGapReceipt({
      plan: plan({ recordSetSha256: hashTwinGapData(relabeledDuplicate) }),
      records: relabeledDuplicate
    }),
    /pair definitions must use exactly one twinPairId/
  );
});

test('externally supplied finite values are neither clipped nor recoded', () => {
  const changed = [record({
    fromAnchorValue: -2,
    fromTwinValue: 3,
    toAnchorValue: -8,
    toTwinValue: 5
  })];
  const receipt = createTwinGapReceipt({
    plan: plan({ recordSetSha256: hashTwinGapData(changed) }),
    records: changed
  });
  assert.equal(receipt.pairComparisons[0].fromSignedGap, -5);
  assert.equal(receipt.pairComparisons[0].toSignedGap, -13);
  assert.equal(receipt.pairComparisons[0].gapMagnitudeChange, 8);
});

test('non-finite values and non-finite derived gaps fail closed', () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
    const changed = [record({ toAnchorValue: value })];
    assert.throws(
      () => createTwinGapReceipt({
        plan: plan({ recordSetSha256: digest('unreachable') }),
        records: changed
      }),
      /finite number/
    );
  }
  const changed = [record({
    toAnchorValue: Number.MAX_VALUE,
    toTwinValue: -Number.MAX_VALUE
  })];
  assert.throws(
    () => createTwinGapReceipt({
      plan: plan({ recordSetSha256: hashTwinGapData(changed) }),
      records: changed
    }),
    /must remain finite/
  );
});

test('plan identities and record hashes fail closed', () => {
  assert.throws(
    () => createTwinGapReceipt({
      plan: plan({ interpretationIdentity: 'widening-proves-memorization' }),
      records
    }),
    /interpretationIdentity/
  );
  const changed = structuredClone(records);
  changed[0].providerIdentity = 'provider-b';
  assert.throws(
    () => createTwinGapReceipt({
      plan: plan(),
      records: changed
    }),
    /records do not match/
  );
});

test('empty inputs remain explicit and make no evidence claim', () => {
  const receipt = createTwinGapReceipt({
    plan: plan({ recordSetSha256: hashTwinGapData([]) }),
    records: []
  });
  assert.equal(receipt.comparisonCount, 0);
  assert.equal(receipt.wideningEvidenceCount, 0);
  assert.deepEqual(receipt.pairComparisons, []);
});

test('receipts are deterministic, immutable, and preserve caller inputs', () => {
  const inputs = structuredClone({ plan: plan(), records });
  const first = validate();
  const second = validate();
  assert.deepEqual(first, second);
  assert.equal(first.receiptSha256, second.receiptSha256);
  assert.deepEqual({ plan: plan(), records }, inputs);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.pairComparisons));
});
