import assert from 'node:assert/strict';
import test from 'node:test';

import {
  estimateGwetAc1,
  hashAgreementData
} from '../bench/agreementCoefficients.js';

const categories = ['yes', 'no'];
const units = [
  {
    unitId: 'unit-a',
    ratings: [
      { raterId: 'rater-1', categoryId: 'yes' },
      { raterId: 'rater-2', categoryId: 'yes' }
    ]
  },
  {
    unitId: 'unit-b',
    ratings: [
      { raterId: 'rater-1', categoryId: 'yes' },
      { raterId: 'rater-2', categoryId: 'no' }
    ]
  },
  {
    unitId: 'unit-c',
    ratings: [
      { raterId: 'rater-1', categoryId: 'no' },
      { raterId: 'rater-2', categoryId: 'no' }
    ]
  }
];
const bootstrapSchedule = [
  {
    replicationId: 'all-a',
    sampledUnitIds: ['unit-a', 'unit-a', 'unit-a']
  },
  {
    replicationId: 'all-b',
    sampledUnitIds: ['unit-b', 'unit-b', 'unit-b']
  },
  {
    replicationId: 'all-c',
    sampledUnitIds: ['unit-c', 'unit-c', 'unit-c']
  }
];

const plan = (overrides = {}) => ({
  agreementId: 'nominal-agreement-1',
  coefficientIdentity: 'gwet-ac1',
  ratingScale: 'nominal',
  categoryIds: categories,
  unitWeighting: 'equal-unit',
  chanceAgreementIdentity: 'gwet-ac1-multicategory',
  missingnessHandlingIdentity: 'externally-declared-complete-cases',
  missingnessHandlingSourceRef: 'methods://missingness-policy',
  confidenceLevel: 0.95,
  confidenceLevelSourceRef: 's0://agreement-confidence',
  intervalType: 'percentile-order-statistics',
  bootstrapMethod: 'explicit-unit-resample-schedule',
  bootstrapScheduleSourceRef: 'artifact://unit-bootstrap-schedule',
  bootstrapScheduleSha256: hashAgreementData(bootstrapSchedule),
  lowerOrderIndex: 0,
  upperOrderIndex: 2,
  ...overrides
});

test('Gwet AC1 uses equal-unit observed agreement and declared nominal categories', () => {
  const receipt = estimateGwetAc1({
    plan: plan(),
    units,
    bootstrapSchedule
  });
  assert.equal(receipt.observedAgreement, 2 / 3);
  assert.equal(receipt.chanceAgreement, 0.5);
  assert.ok(Math.abs(receipt.coefficient - (1 / 3)) < Number.EPSILON);
  assert.deepEqual(receipt.confidenceInterval, { low: -1, high: 1 });
  assert.deepEqual(
    receipt.bootstrapCoefficients.map(({ coefficient }) => coefficient),
    [1, -1, 1]
  );
});

test('multi-rater units contribute one equal-weight agreement observation each', () => {
  const multiRaterUnits = [
    {
      unitId: 'one',
      ratings: [
        { raterId: 'a', categoryId: 'yes' },
        { raterId: 'b', categoryId: 'yes' },
        { raterId: 'c', categoryId: 'no' }
      ]
    },
    {
      unitId: 'two',
      ratings: [
        { raterId: 'a', categoryId: 'no' },
        { raterId: 'b', categoryId: 'no' }
      ]
    }
  ];
  const schedule = [{
    replicationId: 'identity',
    sampledUnitIds: ['one', 'two']
  }];
  const receipt = estimateGwetAc1({
    plan: plan({
      bootstrapScheduleSha256: hashAgreementData(schedule),
      lowerOrderIndex: 0,
      upperOrderIndex: 0
    }),
    units: multiRaterUnits,
    bootstrapSchedule: schedule
  });
  assert.equal(receipt.observedAgreement, 2 / 3);
  assert.ok(Math.abs(receipt.chanceAgreement - (4 / 9)) < Number.EPSILON);
  assert.ok(Math.abs(receipt.coefficient - 0.4) < Number.EPSILON);
  assert.equal(receipt.unitCount, 2);
  assert.equal(receipt.ratingCount, 5);
});

test('multicategory chance agreement uses every externally declared category', () => {
  const multicategoryUnits = ['a', 'b', 'c'].map((categoryId) => ({
    unitId: `unit-${categoryId}`,
    ratings: [
      { raterId: 'one', categoryId },
      { raterId: 'two', categoryId }
    ]
  }));
  const schedule = [{
    replicationId: 'identity',
    sampledUnitIds: ['unit-a', 'unit-b', 'unit-c']
  }];
  const receipt = estimateGwetAc1({
    plan: plan({
      categoryIds: ['a', 'b', 'c'],
      bootstrapScheduleSha256: hashAgreementData(schedule),
      lowerOrderIndex: 0,
      upperOrderIndex: 0
    }),
    units: multicategoryUnits,
    bootstrapSchedule: schedule
  });
  assert.ok(Math.abs(receipt.chanceAgreement - (1 / 3)) < Number.EPSILON);
  assert.equal(receipt.coefficient, 1);
});

test('plans require every external policy identity without extra fields', () => {
  const missing = plan();
  delete missing.missingnessHandlingIdentity;
  assert.throws(
    () => estimateGwetAc1({ plan: missing, units, bootstrapSchedule }),
    /fields must be exact; missing=\[missingnessHandlingIdentity\]/
  );
  assert.throws(
    () => estimateGwetAc1({
      plan: plan({ adoptionRule: 'largest-coefficient' }),
      units,
      bootstrapSchedule
    }),
    /extra=\[adoptionRule\]/
  );
  for (const [field, value] of [
    ['coefficientIdentity', 'cohen-kappa'],
    ['ratingScale', 'ordinal'],
    ['unitWeighting', 'equal-rating'],
    ['chanceAgreementIdentity', 'unspecified'],
    ['intervalType', 'normal'],
    ['bootstrapMethod', 'internal-rng']
  ]) {
    assert.throws(
      () => estimateGwetAc1({
        plan: plan({ [field]: value }),
        units,
        bootstrapSchedule
      }),
      new RegExp(`agreement plan\\.${field} must be`)
    );
  }
  assert.throws(
    () => estimateGwetAc1({
      plan: plan({ confidenceLevel: 1 }),
      units,
      bootstrapSchedule
    }),
    /confidenceLevel must be between 0 and 1/
  );
});

test('category and unit identities fail closed', () => {
  assert.throws(
    () => estimateGwetAc1({
      plan: plan({ categoryIds: ['yes'] }),
      units,
      bootstrapSchedule
    }),
    /at least two categories/
  );
  const unknownCategory = structuredClone(units);
  unknownCategory[0].ratings[0].categoryId = 'maybe';
  assert.throws(
    () => estimateGwetAc1({
      plan: plan(),
      units: unknownCategory,
      bootstrapSchedule
    }),
    /must name a declared category/
  );
  const duplicateRater = structuredClone(units);
  duplicateRater[0].ratings[1].raterId = 'rater-1';
  assert.throws(
    () => estimateGwetAc1({
      plan: plan(),
      units: duplicateRater,
      bootstrapSchedule
    }),
    /unique raterId/
  );
  const duplicateUnit = structuredClone(units);
  duplicateUnit[1].unitId = 'unit-a';
  assert.throws(
    () => estimateGwetAc1({
      plan: plan(),
      units: duplicateUnit,
      bootstrapSchedule
    }),
    /unique unitId/
  );
});

test('the external schedule is complete, named, and hash-bound', () => {
  const wrongLength = structuredClone(bootstrapSchedule);
  wrongLength[0].sampledUnitIds.pop();
  assert.throws(
    () => estimateGwetAc1({
      plan: plan({
        bootstrapScheduleSha256: hashAgreementData(wrongLength)
      }),
      units,
      bootstrapSchedule: wrongLength
    }),
    /exactly one draw per original unit/
  );
  const unknownUnit = structuredClone(bootstrapSchedule);
  unknownUnit[0].sampledUnitIds[0] = 'unit-z';
  assert.throws(
    () => estimateGwetAc1({
      plan: plan({
        bootstrapScheduleSha256: hashAgreementData(unknownUnit)
      }),
      units,
      bootstrapSchedule: unknownUnit
    }),
    /must name a declared unit/
  );
  const duplicateReplication = structuredClone(bootstrapSchedule);
  duplicateReplication[1].replicationId = 'all-a';
  assert.throws(
    () => estimateGwetAc1({
      plan: plan({
        bootstrapScheduleSha256: hashAgreementData(duplicateReplication)
      }),
      units,
      bootstrapSchedule: duplicateReplication
    }),
    /unique replicationId/
  );
  assert.throws(
    () => estimateGwetAc1({
      plan: plan({ bootstrapScheduleSha256: '0'.repeat(64) }),
      units,
      bootstrapSchedule
    }),
    /does not match/
  );
});

test('externally supplied order indices must address the schedule', () => {
  for (const overrides of [
    { lowerOrderIndex: -1 },
    { upperOrderIndex: bootstrapSchedule.length },
    { lowerOrderIndex: 2, upperOrderIndex: 1 }
  ]) {
    assert.throws(
      () => estimateGwetAc1({
        plan: plan(overrides),
        units,
        bootstrapSchedule
      }),
      /must index|must not exceed/
    );
  }
});

test('one-unit evidence is explicit and does not claim an interval', () => {
  const oneUnit = [units[0]];
  const oneUnitSchedule = [{
    replicationId: 'single',
    sampledUnitIds: ['unit-a']
  }];
  const receipt = estimateGwetAc1({
    plan: plan({
      bootstrapScheduleSha256: hashAgreementData(oneUnitSchedule),
      lowerOrderIndex: 0,
      upperOrderIndex: 0
    }),
    units: oneUnit,
    bootstrapSchedule: oneUnitSchedule
  });
  assert.equal(receipt.status, 'insufficient-units');
  assert.equal(receipt.coefficient, 1);
  assert.equal(receipt.bootstrapCoefficients, null);
  assert.equal(receipt.confidenceInterval, null);
});

test('identical inputs produce immutable receipts without mutating evidence', () => {
  const planInput = plan();
  const unitInput = structuredClone(units);
  const scheduleInput = structuredClone(bootstrapSchedule);
  const first = estimateGwetAc1({
    plan: planInput,
    units: unitInput,
    bootstrapSchedule: scheduleInput
  });
  const second = estimateGwetAc1({
    plan: planInput,
    units: unitInput,
    bootstrapSchedule: scheduleInput
  });
  assert.deepEqual(first, second);
  assert.equal(first.receiptSha256, second.receiptSha256);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.plan.categoryIds));
  assert.ok(Object.isFrozen(first.bootstrapCoefficients));
  assert.equal(unitInput[0].ratings[0].categoryId, 'yes');
  assert.equal(scheduleInput[0].sampledUnitIds[0], 'unit-a');
});

test('hashing rejects non-JSON inputs and hashes validated copies', () => {
  const mutable = { categories: ['yes', 'no'] };
  const digest = hashAgreementData(mutable);
  mutable.categories[0] = 'changed';
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.throws(
    () => hashAgreementData({ invalid: Number.NaN }),
    /must be finite JSON data/
  );
});
