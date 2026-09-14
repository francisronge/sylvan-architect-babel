import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createExposureLedgerReceipt,
  hashExposureLedgerData
} from '../bench/exposureLedger.js';

const digest = (text) => hashExposureLedgerData({ text });
const executions = [
  {
    runId: 'run-api-first',
    itemVersionId: 'probe-v1',
    materialClass: 'memorization-probe',
    executionRoute: 'provider-api',
    sourceRunArtifactSha256: digest('run-api-first'),
    providerIdentity: 'provider-a'
  },
  {
    runId: 'run-local',
    itemVersionId: 'probe-v1',
    materialClass: 'memorization-probe',
    executionRoute: 'operator-local-open-weight',
    sourceRunArtifactSha256: digest('run-local')
  },
  {
    runId: 'run-api-second',
    itemVersionId: 'probe-v1',
    materialClass: 'memorization-probe',
    executionRoute: 'provider-api',
    sourceRunArtifactSha256: digest('run-api-second'),
    providerIdentity: 'provider-a'
  }
];
const events = [
  {
    eventId: 'event-api-first',
    runId: 'run-api-first',
    eventType: 'provider-api-exposure',
    occurredAt: 'date-first',
    sourceRunArtifactSha256: digest('run-api-first'),
    providerIdentity: 'provider-a',
    retentionTier: 'retention-tier-a',
    retentionEvidenceRef: 'terms://first',
    retentionEvidenceSha256: digest('terms-first')
  },
  {
    eventId: 'event-local',
    runId: 'run-local',
    eventType: 'operator-local-execution',
    occurredAt: 'date-local',
    sourceRunArtifactSha256: digest('run-local'),
    operatorControlEvidenceRef: 'custody://local',
    operatorControlEvidenceSha256: digest('custody-local')
  },
  {
    eventId: 'event-api-second',
    runId: 'run-api-second',
    eventType: 'provider-api-exposure',
    occurredAt: 'date-second',
    sourceRunArtifactSha256: digest('run-api-second'),
    providerIdentity: 'provider-a',
    retentionTier: 'retention-tier-b',
    retentionEvidenceRef: 'terms://second',
    retentionEvidenceSha256: digest('terms-second')
  }
];
const plan = (overrides = {}) => ({
  ledgerId: 'ledger-1',
  coverageIdentity: 'one-ledger-event-per-declared-execution',
  providerExposureIdentity: 'provider-api-execution-is-exposure',
  localExecutionIdentity:
    'operator-controlled-local-execution-is-not-provider-exposure',
  retentionIdentity: 'retention-commitments-do-not-reverse-exposure',
  nonExposureIdentity: 'provider-api-exposure-revokes-provider-nonexposure',
  eventOrderIdentity: 'externally-recorded-complete-chronological-event-order',
  orderedEventIds: [
    'event-api-first',
    'event-local',
    'event-api-second'
  ],
  executionSetSourceRef: 'archive://executions',
  executionSetSha256: hashExposureLedgerData(executions),
  eventSetSourceRef: 'archive://events',
  eventSetSha256: hashExposureLedgerData(events),
  provenance: { authorityRef: 'external-ledger-authority' },
  ...overrides
});

const validate = (overrides = {}) => createExposureLedgerReceipt({
  plan: plan(),
  executions,
  events,
  ...overrides
});

test('every provider API execution is irreversible exposure despite retention terms', () => {
  const receipt = validate();
  assert.equal(receipt.executionCount, 3);
  assert.equal(receipt.providerApiExposureCount, 2);
  assert.equal(receipt.operatorLocalExecutionCount, 1);
  assert.deepEqual(receipt.providerExposureStates, [{
    itemVersionId: 'probe-v1',
    materialClass: 'memorization-probe',
    providerIdentity: 'provider-a',
    exposureStatus: 'exposed',
    firstExposureAt: 'date-first',
    firstExposureEventId: 'event-api-first',
    exposureEventIds: ['event-api-first', 'event-api-second'],
    retentionObservations: [
      {
        eventId: 'event-api-first',
        retentionTier: 'retention-tier-a',
        retentionEvidenceRef: 'terms://first',
        retentionEvidenceSha256: digest('terms-first')
      },
      {
        eventId: 'event-api-second',
        retentionTier: 'retention-tier-b',
        retentionEvidenceRef: 'terms://second',
        retentionEvidenceSha256: digest('terms-second')
      }
    ]
  }]);
});

test('operator-local execution never creates a provider exposure state', () => {
  const localExecution = [executions[1]];
  const localEvent = [events[1]];
  const receipt = createExposureLedgerReceipt({
    plan: plan({
      orderedEventIds: ['event-local'],
      executionSetSha256: hashExposureLedgerData(localExecution),
      eventSetSha256: hashExposureLedgerData(localEvent)
    }),
    executions: localExecution,
    events: localEvent
  });
  assert.equal(receipt.operatorLocalExecutionCount, 1);
  assert.deepEqual(receipt.providerExposureStates, []);
});

test('one event is required for every declared execution', () => {
  const missing = events.slice(0, -1);
  assert.throws(
    () => createExposureLedgerReceipt({
      plan: plan({
        orderedEventIds: missing.map(({ eventId }) => eventId),
        eventSetSha256: hashExposureLedgerData(missing)
      }),
      executions,
      events: missing
    }),
    /one event for every declared execution/
  );
  const duplicateRun = structuredClone(events);
  duplicateRun[2].runId = duplicateRun[0].runId;
  assert.throws(
    () => createExposureLedgerReceipt({
      plan: plan({ eventSetSha256: hashExposureLedgerData(duplicateRun) }),
      executions,
      events: duplicateRun
    }),
    /unique runId/
  );
});

test('the external event order must cover every event exactly once', () => {
  for (const orderedEventIds of [
    ['event-api-first', 'event-local'],
    ['event-api-first', 'event-local', 'event-api-first']
  ]) {
    assert.throws(
      () => createExposureLedgerReceipt({
        plan: plan({ orderedEventIds }),
        executions,
        events
      }),
      /orderedEventIds/
    );
  }
});

test('event type, provider, and source artifact bind the exact execution', () => {
  const wrongProvider = structuredClone(events);
  wrongProvider[0].providerIdentity = 'provider-b';
  assert.throws(
    () => createExposureLedgerReceipt({
      plan: plan({ eventSetSha256: hashExposureLedgerData(wrongProvider) }),
      executions,
      events: wrongProvider
    }),
    /must record its provider API exposure/
  );
  const wrongArtifact = structuredClone(events);
  wrongArtifact[0].sourceRunArtifactSha256 = digest('other-run');
  assert.throws(
    () => createExposureLedgerReceipt({
      plan: plan({ eventSetSha256: hashExposureLedgerData(wrongArtifact) }),
      executions,
      events: wrongArtifact
    }),
    /does not bind its source run artifact/
  );
  const wrongRoute = structuredClone(events);
  wrongRoute[1] = {
    ...wrongRoute[1],
    eventType: 'provider-api-exposure',
    providerIdentity: 'provider-a',
    retentionTier: 'tier',
    retentionEvidenceRef: 'terms://local',
    retentionEvidenceSha256: digest('terms-local')
  };
  delete wrongRoute[1].operatorControlEvidenceRef;
  delete wrongRoute[1].operatorControlEvidenceSha256;
  assert.throws(
    () => createExposureLedgerReceipt({
      plan: plan({ eventSetSha256: hashExposureLedgerData(wrongRoute) }),
      executions,
      events: wrongRoute
    }),
    /must record operator-local execution/
  );
});

test('retention and local-control evidence are mandatory exact records', () => {
  const missingRetention = structuredClone(events);
  delete missingRetention[0].retentionTier;
  assert.throws(
    () => createExposureLedgerReceipt({
      plan: plan({ eventSetSha256: hashExposureLedgerData(missingRetention) }),
      executions,
      events: missingRetention
    }),
    /missing=\[retentionTier\]/
  );
  const leakedProvider = { ...events[1], providerIdentity: 'not-applicable' };
  const changed = [events[0], leakedProvider, events[2]];
  assert.throws(
    () => createExposureLedgerReceipt({
      plan: plan({ eventSetSha256: hashExposureLedgerData(changed) }),
      executions,
      events: changed
    }),
    /extra=\[providerIdentity\]/
  );
});

test('item material class remains stable across the ledger', () => {
  const changed = structuredClone(executions);
  changed[2].materialClass = 'anchor';
  assert.throws(
    () => createExposureLedgerReceipt({
      plan: plan({ executionSetSha256: hashExposureLedgerData(changed) }),
      executions: changed,
      events
    }),
    /must retain one materialClass/
  );
});

test('plan identities and evidence hashes fail closed', () => {
  assert.throws(
    () => createExposureLedgerReceipt({
      plan: plan({ retentionIdentity: 'retention-erases-exposure' }),
      executions,
      events
    }),
    /retentionIdentity/
  );
  const changed = structuredClone(events);
  changed[0].occurredAt = 'changed-date';
  assert.throws(
    () => createExposureLedgerReceipt({
      plan: plan(),
      executions,
      events: changed
    }),
    /events do not match/
  );
});

test('an externally declared empty scope yields an empty ledger', () => {
  const receipt = createExposureLedgerReceipt({
    plan: plan({
      orderedEventIds: [],
      executionSetSha256: hashExposureLedgerData([]),
      eventSetSha256: hashExposureLedgerData([])
    }),
    executions: [],
    events: []
  });
  assert.equal(receipt.executionCount, 0);
  assert.deepEqual(receipt.orderedEvents, []);
  assert.deepEqual(receipt.providerExposureStates, []);
});

test('receipts are deterministic, immutable, and inputs remain unchanged', () => {
  const inputs = structuredClone({ plan: plan(), executions, events });
  const first = validate();
  const second = validate();
  assert.deepEqual(first, second);
  assert.equal(first.receiptSha256, second.receiptSha256);
  assert.deepEqual({ plan: plan(), executions, events }, inputs);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.providerExposureStates));
  assert.ok(Object.isFrozen(first.providerExposureStates[0].retentionObservations));
});
