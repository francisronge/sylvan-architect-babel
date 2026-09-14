import assert from 'node:assert/strict';
import test from 'node:test';

import {
  estimateClusteredProportion,
  estimatePairedClusteredDifference
} from '../bench/index.js';

const plan = (overrides = {}) => ({
  estimandId: 'external-estimand',
  confidenceLevel: 0.9,
  criticalValue: 2,
  criticalValueSourceRef: 'external-critical-value-source',
  intervalType: 'two-sided-symmetric',
  clusterSpecification: 'external-item-cluster-definition',
  pointWeighting: 'equal-observation',
  varianceEstimator: 'cr1-cluster-sandwich',
  ...overrides
});

test('clustered proportions use the declared item-cluster variance', () => {
  const receipt = estimateClusteredProportion({
    plan: plan(),
    observations: [
      { observationId: 'run-a1', clusterId: 'item-a', outcome: 1 },
      { observationId: 'run-a2', clusterId: 'item-a', outcome: 1 },
      { observationId: 'run-b1', clusterId: 'item-b', outcome: 0 },
      { observationId: 'run-b2', clusterId: 'item-b', outcome: 0 }
    ]
  });
  assert.equal(receipt.pointEstimate, 0.5);
  assert.equal(receipt.standardError, 0.5);
  assert.deepEqual(receipt.confidenceInterval, { low: -0.5, high: 1.5 });
  assert.equal(receipt.status, 'estimated');
});

test('paired contrasts preserve shared-pair direction', () => {
  const receipt = estimatePairedClusteredDifference({
    plan: plan(),
    pairs: [
      { pairId: 'pair-a', clusterId: 'item-a', left: 1, right: 0 },
      { pairId: 'pair-b', clusterId: 'item-b', left: 0, right: 1 }
    ]
  });
  assert.equal(receipt.pointEstimate, 0);
  assert.equal(receipt.standardError, 1);
  assert.deepEqual(receipt.confidenceInterval, { low: -2, high: 2 });
});

test('intervals remain unbounded rather than silently clipped', () => {
  const receipt = estimateClusteredProportion({
    plan: plan({ criticalValue: 3 }),
    observations: [
      { observationId: 'run-a', clusterId: 'item-a', outcome: 1 },
      { observationId: 'run-b', clusterId: 'item-b', outcome: 0 }
    ]
  });
  assert.ok(receipt.confidenceInterval.low < 0);
  assert.ok(receipt.confidenceInterval.high > 1);
});

test('one cluster yields an explicit insufficient result', () => {
  const receipt = estimateClusteredProportion({
    plan: plan(),
    observations: [
      { observationId: 'run-a1', clusterId: 'item-a', outcome: 1 },
      { observationId: 'run-a2', clusterId: 'item-a', outcome: 0 }
    ]
  });
  assert.equal(receipt.status, 'insufficient-clusters');
  assert.equal(receipt.standardError, null);
  assert.equal(receipt.confidenceInterval, null);
});

test('confidence and critical-value choices are mandatory external inputs', () => {
  const { confidenceLevel: _confidenceLevel, ...missing } = plan();
  assert.throws(
    () => estimateClusteredProportion({
      plan: missing,
      observations: [{ observationId: 'run-a', clusterId: 'item-a', outcome: 1 }]
    }),
    /missing=\[confidenceLevel\]/
  );
  assert.throws(
    () => estimateClusteredProportion({
      plan: plan({ criticalValue: 0 }),
      observations: [{ observationId: 'run-a', clusterId: 'item-a', outcome: 1 }]
    }),
    /criticalValue must be positive/
  );
  assert.throws(
    () => estimateClusteredProportion({
      plan: plan({ pointWeighting: 'item-weighted' }),
      observations: [{ observationId: 'run-a', clusterId: 'item-a', outcome: 1 }]
    }),
    /pointWeighting must be equal-observation/
  );
});

test('estimators reject non-binary outcomes and duplicate pair IDs', () => {
  assert.throws(
    () => estimateClusteredProportion({
      plan: plan(),
      observations: [{ observationId: 'run-a', clusterId: 'item-a', outcome: 0.5 }]
    }),
    /must be exactly 0 or 1/
  );
  assert.throws(
    () => estimateClusteredProportion({
      plan: plan(),
      observations: [
        { observationId: 'same', clusterId: 'item-a', outcome: 1 },
        { observationId: 'same', clusterId: 'item-b', outcome: 0 }
      ]
    }),
    /unique observationId/
  );
  assert.throws(
    () => estimatePairedClusteredDifference({
      plan: plan(),
      pairs: [
        { pairId: 'same', clusterId: 'item-a', left: 1, right: 0 },
        { pairId: 'same', clusterId: 'item-b', left: 0, right: 1 }
      ]
    }),
    /unique pairId/
  );
});

test('identical inputs produce identical frozen receipts without mutation', () => {
  const observations = [
    { observationId: 'run-a', clusterId: 'item-a', outcome: 1 },
    { observationId: 'run-b', clusterId: 'item-b', outcome: 0 }
  ];
  const before = structuredClone(observations);
  const first = estimateClusteredProportion({ plan: plan(), observations });
  const second = estimateClusteredProportion({ plan: plan(), observations });
  assert.deepEqual(first, second);
  assert.match(first.observationsSha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(observations, before);
  assert.ok(Object.isFrozen(first.plan));
});
