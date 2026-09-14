import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { canonicalizeJsonData } from '../bench/jsonData.js';
import {
  estimatePairedWildClusterBootstrapDifference,
  estimateWildClusterBootstrapProportion
} from '../bench/clusterBootstrap.js';

const sha256CanonicalJson = (value) => createHash('sha256')
  .update(JSON.stringify(canonicalizeJsonData(value)))
  .digest('hex');

const schedule = [
  [
    { clusterId: 'item-a', multiplier: -1 },
    { clusterId: 'item-b', multiplier: -1 },
    { clusterId: 'item-c', multiplier: -1 }
  ],
  [
    { clusterId: 'item-a', multiplier: 1 },
    { clusterId: 'item-b', multiplier: -1 },
    { clusterId: 'item-c', multiplier: 1 }
  ],
  [
    { clusterId: 'item-a', multiplier: 1 },
    { clusterId: 'item-b', multiplier: 1 },
    { clusterId: 'item-c', multiplier: 1 }
  ]
];
const plan = {
  estimandId: 'adequacy-rate',
  confidenceLevel: 0.9,
  intervalType: 'percentile-order-statistics',
  clusterSpecification: 'benchmark-item',
  pointWeighting: 'equal-observation',
  bootstrapMethod: 'wild-cluster-explicit-multipliers',
  bootstrapVariant: 'intercept-only-unrestricted-residual',
  multiplierDistributionId: 'externally-declared-two-point',
  multiplierScheduleSourceRef: 'design://wild-bootstrap/schedule-1',
  multiplierScheduleSha256: sha256CanonicalJson(schedule),
  lowerOrderIndex: 0,
  upperOrderIndex: 2
};
const observations = [
  { observationId: 'a-1', clusterId: 'item-a', outcome: 0 },
  { observationId: 'a-2', clusterId: 'item-a', outcome: 0 },
  { observationId: 'b-1', clusterId: 'item-b', outcome: 1 },
  { observationId: 'c-1', clusterId: 'item-c', outcome: 1 }
];

test('explicit wild multipliers produce a hash-bound percentile interval', () => {
  const result = estimateWildClusterBootstrapProportion({
    plan, observations, multiplierSchedule: schedule
  });
  assert.equal(result.pointEstimate, 0.5);
  assert.deepEqual(result.bootstrapEstimates, [0.5, 0.25, 0.5]);
  assert.deepEqual(result.confidenceInterval, { low: 0.25, high: 0.5 });
  assert.equal(result.multiplierScheduleSha256, plan.multiplierScheduleSha256);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.plan));
});

test('paired wild-bootstrap differences preserve shared-item direction', () => {
  const result = estimatePairedWildClusterBootstrapDifference({
    plan: { ...plan, estimandId: 'left-minus-right' },
    pairs: [
      { pairId: 'a', clusterId: 'item-a', left: 1, right: 0 },
      { pairId: 'b', clusterId: 'item-b', left: 0, right: 1 },
      { pairId: 'c', clusterId: 'item-c', left: 1, right: 1 }
    ],
    multiplierSchedule: schedule
  });
  assert.equal(result.pointEstimate, 0);
  assert.deepEqual(result.bootstrapEstimates, [0, 2 / 3, 0]);
  assert.deepEqual(result.confidenceInterval, { low: 0, high: 2 / 3 });
});

test('the multiplier-schedule hash prevents tampering', () => {
  const tampered = structuredClone(schedule);
  tampered[0][0].multiplier = 1;
  assert.throws(
    () => estimateWildClusterBootstrapProportion({
      plan, observations, multiplierSchedule: tampered
    }),
    /does not match plan\.multiplierScheduleSha256/
  );
});

test('every replication must cover every cluster exactly once', () => {
  const duplicate = [[
    { clusterId: 'item-a', multiplier: 1 },
    { clusterId: 'item-a', multiplier: -1 },
    { clusterId: 'item-c', multiplier: 1 }
  ]];
  assert.throws(
    () => estimateWildClusterBootstrapProportion({
      plan: {
        ...plan,
        multiplierScheduleSha256: sha256CanonicalJson(duplicate),
        lowerOrderIndex: 0,
        upperOrderIndex: 0
      },
      observations,
      multiplierSchedule: duplicate
    }),
    /previously unused cluster/
  );
});

test('multipliers must be finite external numbers', () => {
  const invalid = structuredClone(schedule);
  invalid[0][0].multiplier = Infinity;
  assert.throws(
    () => estimateWildClusterBootstrapProportion({
      plan, observations, multiplierSchedule: invalid
    }),
    /multiplier must be finite/
  );
});

test('one cluster is explicitly unestimable rather than silently reported', () => {
  const oneClusterSchedule = [[{ clusterId: 'item-a', multiplier: 1 }]];
  const result = estimateWildClusterBootstrapProportion({
    plan: {
      ...plan,
      multiplierScheduleSha256: sha256CanonicalJson(oneClusterSchedule),
      lowerOrderIndex: 0,
      upperOrderIndex: 0
    },
    observations: observations.slice(0, 2),
    multiplierSchedule: oneClusterSchedule
  });
  assert.equal(result.status, 'insufficient-clusters');
  assert.equal(result.confidenceInterval, null);
  assert.equal(result.bootstrapEstimates, null);
});

test('interval indices are externally supplied, bounded, and ordered', () => {
  assert.throws(
    () => estimateWildClusterBootstrapProportion({
      plan: { ...plan, upperOrderIndex: 3 },
      observations,
      multiplierSchedule: schedule
    }),
    /upperOrderIndex must index/
  );
  assert.throws(
    () => estimateWildClusterBootstrapProportion({
      plan: { ...plan, lowerOrderIndex: 2, upperOrderIndex: 1 },
      observations,
      multiplierSchedule: schedule
    }),
    /must not exceed/
  );
});

test('plans reject omitted statistical identities and hidden RNG configuration', () => {
  const { multiplierDistributionId: _omitted, ...missing } = plan;
  assert.throws(
    () => estimateWildClusterBootstrapProportion({
      plan: missing, observations, multiplierSchedule: schedule
    }),
    /missing=\[multiplierDistributionId\]/
  );
  assert.throws(
    () => estimateWildClusterBootstrapProportion({
      plan: { ...plan, seed: 42 }, observations, multiplierSchedule: schedule
    }),
    /extra=\[seed\]/
  );
});

test('identical inputs yield identical immutable receipts without mutation', () => {
  const first = estimateWildClusterBootstrapProportion({
    plan, observations, multiplierSchedule: schedule
  });
  const second = estimateWildClusterBootstrapProportion({
    plan, observations, multiplierSchedule: schedule
  });
  assert.deepEqual(first, second);
  assert.equal(first.receiptSha256, second.receiptSha256);
  assert.equal(schedule[0][0].multiplier, -1);
});
