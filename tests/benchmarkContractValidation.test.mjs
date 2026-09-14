import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  compareContractValidationCounts,
  createContractValidationPlan,
  validateContractValidationPlan
} from '../bench/index.js';

const digest = (label) => createHash('sha256').update(label).digest('hex');

const planInput = () => ({
  contractHashes: {
    prompt: digest('external-prompt'),
    contract: digest('external-contract')
  },
  ruleCatalog: {
    sourceRef: 'external-engine-rule-catalog',
    sourceSha256: digest('external-engine-rule-catalog-bytes'),
    ruleIds: [
      'DERIVATION_STAGE_FIELDS_EXACT',
      'DERIVATION_STAGE_RELATION_EXACT',
      'SURFACE_ORDER_EXACT'
    ]
  },
  registerEntries: [
    {
      registerId: 'external-four-field-register',
      sourceRef: 'external-contract-source#four-fields',
      ruleIds: ['DERIVATION_STAGE_FIELDS_EXACT'],
      instructionStated: true
    },
    {
      registerId: 'external-surface-register',
      sourceRef: 'external-contract-source#surface-order',
      ruleIds: ['SURFACE_ORDER_EXACT'],
      instructionStated: true
    }
  ],
  fixtureExpectations: [
    {
      fixtureRef: 'fixture://valid-contract',
      registerIds: [
        'external-four-field-register',
        'external-surface-register'
      ],
      expectedFailures: []
    },
    {
      fixtureRef: 'fixture://extra-stage-field',
      registerIds: ['external-four-field-register'],
      expectedFailures: [{
        failureClass: 'contract_misunderstanding',
        ruleId: 'DERIVATION_STAGE_FIELDS_EXACT',
        count: 1
      }]
    },
    {
      fixtureRef: 'fixture://surface-mismatch',
      registerIds: ['external-surface-register'],
      expectedFailures: [{
        failureClass: 'contract_misunderstanding',
        ruleId: 'SURFACE_ORDER_EXACT',
        count: 2
      }]
    }
  ]
});

const observations = () => [
  {
    fixtureRef: 'fixture://valid-contract',
    failures: []
  },
  {
    fixtureRef: 'fixture://extra-stage-field',
    failures: [{
      failureClass: 'contract_misunderstanding',
      ruleId: 'DERIVATION_STAGE_FIELDS_EXACT',
      count: 1
    }]
  },
  {
    fixtureRef: 'fixture://surface-mismatch',
    failures: [{
      failureClass: 'contract_misunderstanding',
      ruleId: 'SURFACE_ORDER_EXACT',
      count: 2
    }]
  }
];

test('plans preserve external register IDs, sources, and exact failure counts', () => {
  const plan = createContractValidationPlan(planInput());
  assert.equal(plan.registerEntries[0].instructionStated, true);
  assert.equal(
    plan.fixtureExpectations[1].expectedFailures[0].count,
    1
  );
  assert.match(plan.planSha256, /^[0-9a-f]{64}$/u);
  assert.ok(Object.isFrozen(plan.fixtureExpectations));
  assert.deepEqual(validateContractValidationPlan(plan), plan);
});

test('plans reject unknown rules and failure classes', () => {
  const unknownRule = planInput();
  unknownRule.registerEntries[0].ruleIds = ['UNKNOWN_RULE'];
  assert.throws(
    () => createContractValidationPlan(unknownRule),
    /absent from the catalog/
  );

  const unknownClass = planInput();
  unknownClass.fixtureExpectations[1].expectedFailures[0].failureClass = 'unknown';
  assert.throws(
    () => createContractValidationPlan(unknownClass),
    /normative failure class/
  );
});

test('every expected failure rule must trace through that fixture register', () => {
  const input = planInput();
  input.fixtureExpectations[1].registerIds = ['external-surface-register'];
  assert.throws(
    () => createContractValidationPlan(input),
    /is not traced by its register IDs/
  );
});

test('register entries cannot remain uncovered by fixtures', () => {
  const input = planInput();
  input.fixtureExpectations = input.fixtureExpectations.filter(
    (fixture) => fixture.fixtureRef !== 'fixture://surface-mismatch'
  );
  input.fixtureExpectations[0].registerIds = ['external-four-field-register'];
  assert.throws(
    () => createContractValidationPlan(input),
    /external-surface-register is not covered/
  );
});

test('matching observations produce a deterministic trace receipt', () => {
  const plan = createContractValidationPlan(planInput());
  const first = compareContractValidationCounts({
    plan,
    observations: observations()
  });
  const second = compareContractValidationCounts({
    plan,
    observations: observations()
  });
  assert.equal(first.status, 'matched');
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first.fixtureResults));
});

test('count mismatches are evidence, not exceptions or scores', () => {
  const observed = observations();
  observed[2].failures[0].count = 3;
  const receipt = compareContractValidationCounts({
    plan: createContractValidationPlan(planInput()),
    observations: observed
  });
  assert.equal(receipt.status, 'mismatched');
  assert.deepEqual(receipt.fixtureResults[2].mismatches, [{
    failureClass: 'contract_misunderstanding',
    ruleId: 'SURFACE_ORDER_EXACT',
    expectedCount: 2,
    observedCount: 3
  }]);
  assert.equal(JSON.stringify(receipt).includes('score'), false);
});

test('observations must exactly cover planned fixture refs', () => {
  assert.throws(
    () => compareContractValidationCounts({
      plan: createContractValidationPlan(planInput()),
      observations: observations().slice(1)
    }),
    /exactly cover/
  );
});

test('observed failures must trace through the fixture-local register IDs', () => {
  const observed = observations();
  observed[1].failures = [{
    failureClass: 'contract_misunderstanding',
    ruleId: 'SURFACE_ORDER_EXACT',
    count: 1
  }];
  assert.throws(
    () => compareContractValidationCounts({
      plan: createContractValidationPlan(planInput()),
      observations: observed
    }),
    /is not traced by its planned register IDs/
  );
});

test('tampered plans fail canonical reconstruction even when structurally plausible', () => {
  const plan = createContractValidationPlan(planInput());
  assert.throws(
    () => validateContractValidationPlan({
      ...plan,
      fixtureExpectations: plan.fixtureExpectations.map((fixture, index) => (
        index === 1
          ? { ...fixture, fixtureRef: 'fixture://tampered' }
          : fixture
      ))
    }),
    /does not match its content/
  );
});
