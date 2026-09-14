import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hashJudgedUnitPlanData,
  validateJudgedUnitPlan
} from '../bench/judgedUnitPlan.js';

const digest = (text) => hashJudgedUnitPlanData({ text });
const runs = [
  {
    runId: 'run-a',
    itemVersionId: 'item-1-v1',
    validityStatus: 'valid',
    itemAuthorId: 'author-a',
    runArtifactSha256: digest('run-a')
  },
  {
    runId: 'run-b',
    itemVersionId: 'item-1-v1',
    validityStatus: 'valid',
    itemAuthorId: 'author-b',
    runArtifactSha256: digest('run-b')
  },
  {
    runId: 'run-invalid',
    itemVersionId: 'item-1-v1',
    validityStatus: 'invalid',
    itemAuthorId: 'author-a',
    runArtifactSha256: digest('run-invalid')
  },
  {
    runId: 'run-outside',
    itemVersionId: 'item-2-v1',
    validityStatus: 'valid',
    itemAuthorId: 'author-a',
    runArtifactSha256: digest('run-outside')
  }
];
const reviewers = ['reviewer-a', 'reviewer-b', 'reviewer-c'];
const assignment = (assignmentId, runId, reviewerId) => ({
  assignmentId,
  runId,
  reviewerId,
  sourceRunArtifactSha256: digest(runId),
  blindedRunRef: `blind://${assignmentId}`,
  blindedRunSha256: digest(`blind-${assignmentId}`),
  blindingRecordRef: `blinding://${assignmentId}`,
  blindingRecordSha256: digest(`blinding-${assignmentId}`)
});
const assignments = [
  assignment('assignment-1', 'run-a', 'reviewer-a'),
  assignment('assignment-2', 'run-a', 'reviewer-b'),
  assignment('assignment-3', 'run-b', 'reviewer-c')
];
const pairingPlan = [
  { reviewerIds: ['reviewer-a', 'reviewer-b'], requiredRunCount: 1 },
  { reviewerIds: ['reviewer-a', 'reviewer-c'], requiredRunCount: 0 },
  { reviewerIds: ['reviewer-b', 'reviewer-c'], requiredRunCount: 0 }
];
const plan = (overrides = {}) => ({
  assignmentPlanId: 'judged-unit-plan-1',
  adjudicatedItemVersionIds: ['item-1-v1'],
  reviewerIds: reviewers,
  coverageIdentity: 'every-valid-run-in-adjudicated-item-set',
  ratingMultiplicityIdentity: 'externally-assigned-one-or-two-reviewers-per-run',
  reviewerBlindingIdentity: 'model-identity-withheld',
  reviewerBlindingSourceRef: 'protocol://reviewer-blinding',
  itemAuthorBlindingIdentity: 'reviewer-assignment-withheld',
  itemAuthorBlindingSourceRef: 'protocol://author-blinding',
  runOrderIdentity: 'externally-randomized-complete-run-order',
  runOrderSourceRef: 'artifact://randomized-run-order',
  orderedRunIds: ['run-b', 'run-a'],
  pairingBalanceIdentity: 'complete-reviewer-pair-counts-differ-by-at-most-one',
  pairingPlanSourceRef: 'artifact://pairing-plan',
  pairingPlanSha256: hashJudgedUnitPlanData(pairingPlan),
  runSetSourceRef: 'archive://run-set',
  runSetSha256: hashJudgedUnitPlanData(runs),
  assignmentSetSourceRef: 'artifact://assignments',
  assignmentSetSha256: hashJudgedUnitPlanData(assignments),
  provenance: { designRef: 's2://external-design' },
  ...overrides
});

const validate = (overrides = {}) => validateJudgedUnitPlan({
  plan: plan(),
  runs,
  assignments,
  pairingPlan,
  ...overrides
});

test('every valid run in the adjudicated item set is assigned once or twice', () => {
  const receipt = validate();
  assert.equal(receipt.runCount, 4);
  assert.equal(receipt.targetValidRunCount, 2);
  assert.equal(receipt.excludedRunCount, 2);
  assert.equal(receipt.singleRatedRunCount, 1);
  assert.equal(receipt.doubleRatedRunCount, 1);
  assert.equal(receipt.observedDoubleRatingShare, 0.5);
  assert.deepEqual(receipt.orderedRunIds, ['run-b', 'run-a']);
});

test('complete run order rejects representative selection and duplicates', () => {
  for (const orderedRunIds of [
    ['run-a'],
    ['run-a', 'run-invalid'],
    ['run-a', 'run-a']
  ]) {
    assert.throws(
      () => validateJudgedUnitPlan({
        plan: plan({ orderedRunIds }),
        runs,
        assignments,
        pairingPlan
      }),
      /orderedRunIds/
    );
  }
});

test('assignments target only valid in-set runs and one or two reviewers', () => {
  for (const runId of ['run-invalid', 'run-outside']) {
    const changed = [...assignments, assignment(`extra-${runId}`, runId, 'reviewer-a')];
    assert.throws(
      () => validateJudgedUnitPlan({
        plan: plan({ assignmentSetSha256: hashJudgedUnitPlanData(changed) }),
        runs,
        assignments: changed,
        pairingPlan
      }),
      /must target a valid run/
    );
  }
  const missing = assignments.filter(({ runId }) => runId !== 'run-b');
  assert.throws(
    () => validateJudgedUnitPlan({
      plan: plan({ assignmentSetSha256: hashJudgedUnitPlanData(missing) }),
      runs,
      assignments: missing,
      pairingPlan
    }),
    /exactly one or two/
  );
  const overAssigned = [...assignments, assignment('assignment-4', 'run-a', 'reviewer-c')];
  assert.throws(
    () => validateJudgedUnitPlan({
      plan: plan({ assignmentSetSha256: hashJudgedUnitPlanData(overAssigned) }),
      runs,
      assignments: overAssigned,
      pairingPlan
    }),
    /exactly one or two/
  );
});

test('reviewers are declared, independent, and never the item author', () => {
  const unknown = structuredClone(assignments);
  unknown[0].reviewerId = 'reviewer-z';
  assert.throws(
    () => validateJudgedUnitPlan({
      plan: plan({ assignmentSetSha256: hashJudgedUnitPlanData(unknown) }),
      runs,
      assignments: unknown,
      pairingPlan
    }),
    /declared reviewer/
  );
  const selfReviewRuns = structuredClone(runs);
  selfReviewRuns[0].itemAuthorId = 'reviewer-a';
  assert.throws(
    () => validateJudgedUnitPlan({
      plan: plan({ runSetSha256: hashJudgedUnitPlanData(selfReviewRuns) }),
      runs: selfReviewRuns,
      assignments,
      pairingPlan
    }),
    /no-self-review/
  );
});

test('blinded assignment artifacts are exact and hash-bearing', () => {
  const leaked = { ...assignments[0], modelId: 'must-not-appear' };
  const changed = [leaked, ...assignments.slice(1)];
  assert.throws(
    () => validateJudgedUnitPlan({
      plan: plan({ assignmentSetSha256: hashJudgedUnitPlanData(changed) }),
      runs,
      assignments: changed,
      pairingPlan
    }),
    /extra=\[modelId\]/
  );
  const malformed = structuredClone(assignments);
  malformed[0].blindingRecordSha256 = 'not-a-hash';
  assert.throws(
    () => validateJudgedUnitPlan({
      plan: plan({ assignmentSetSha256: hashJudgedUnitPlanData(malformed) }),
      runs,
      assignments: malformed,
      pairingPlan
    }),
    /lowercase SHA-256/
  );
  const wrongSource = structuredClone(assignments);
  wrongSource[0].sourceRunArtifactSha256 = digest('different-run');
  assert.throws(
    () => validateJudgedUnitPlan({
      plan: plan({ assignmentSetSha256: hashJudgedUnitPlanData(wrongSource) }),
      runs,
      assignments: wrongSource,
      pairingPlan
    }),
    /does not bind its source run artifact/
  );
});

test('plan shape and protocol identities are exact', () => {
  assert.throws(
    () => validateJudgedUnitPlan({
      plan: { ...plan(), reviewerCount: 3 },
      runs,
      assignments,
      pairingPlan
    }),
    /extra=\[reviewerCount\]/
  );
  assert.throws(
    () => validateJudgedUnitPlan({
      plan: plan({ reviewerBlindingIdentity: 'claimed-but-unbound' }),
      runs,
      assignments,
      pairingPlan
    }),
    /reviewerBlindingIdentity/
  );
});

test('balanced-incomplete pairing covers all pairs and exact counts', () => {
  const missingPair = pairingPlan.slice(1);
  assert.throws(
    () => validateJudgedUnitPlan({
      plan: plan({ pairingPlanSha256: hashJudgedUnitPlanData(missingPair) }),
      runs,
      assignments,
      pairingPlan: missingPair
    }),
    /every declared reviewer pair/
  );
  const unbalanced = structuredClone(pairingPlan);
  unbalanced[0].requiredRunCount = 2;
  assert.throws(
    () => validateJudgedUnitPlan({
      plan: plan({ pairingPlanSha256: hashJudgedUnitPlanData(unbalanced) }),
      runs,
      assignments,
      pairingPlan: unbalanced
    }),
    /differ by at most one/
  );
  const wrongCounts = structuredClone(pairingPlan);
  wrongCounts[0].requiredRunCount = 0;
  assert.throws(
    () => validateJudgedUnitPlan({
      plan: plan({ pairingPlanSha256: hashJudgedUnitPlanData(wrongCounts) }),
      runs,
      assignments,
      pairingPlan: wrongCounts
    }),
    /does not match requiredRunCount/
  );
});

test('all evidence sets are hash-bound and empty external plans stay empty', () => {
  const changedRuns = structuredClone(runs);
  changedRuns[0].runArtifactSha256 = digest('changed');
  assert.throws(
    () => validateJudgedUnitPlan({
      plan: plan(),
      runs: changedRuns,
      assignments,
      pairingPlan
    }),
    /runs do not match/
  );
  const emptyPairs = pairingPlan.map(({ reviewerIds }) => ({
    reviewerIds,
    requiredRunCount: 0
  }));
  const receipt = validateJudgedUnitPlan({
    plan: plan({
      adjudicatedItemVersionIds: [],
      orderedRunIds: [],
      runSetSha256: hashJudgedUnitPlanData([]),
      assignmentSetSha256: hashJudgedUnitPlanData([]),
      pairingPlanSha256: hashJudgedUnitPlanData(emptyPairs)
    }),
    runs: [],
    assignments: [],
    pairingPlan: emptyPairs
  });
  assert.equal(receipt.targetValidRunCount, 0);
  assert.equal(receipt.observedDoubleRatingShare, null);
});

test('receipts are deterministic and immutable without changing caller data', () => {
  const inputs = structuredClone({
    plan: plan(),
    runs,
    assignments,
    pairingPlan
  });
  const first = validate();
  const second = validate();
  assert.deepEqual(first, second);
  assert.equal(first.receiptSha256, second.receiptSha256);
  assert.deepEqual(
    { plan: plan(), runs, assignments, pairingPlan },
    inputs
  );
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.assignments));
});
