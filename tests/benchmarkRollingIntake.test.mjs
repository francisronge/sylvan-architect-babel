import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRollingIntakeReceipt,
  hashRollingIntakeData
} from '../bench/rollingIntake.js';

const digest = (text) => hashRollingIntakeData({ text });
const entry = (id, versionNumber = 1, overrides = {}) => ({
  intakeId: `intake-${id}`,
  itemId: `item-${id}`,
  itemVersionId: `item-${id}-v${versionNumber}`,
  versionNumber,
  itemArtifactRef: `archive://items/${id}/v${versionNumber}`,
  itemArtifactSha256: digest(`item-${id}-v${versionNumber}`),
  submissionArtifactRef: `intake://submissions/${id}`,
  submissionArtifactSha256: digest(`submission-${id}`),
  submittedByIdentity: `external-submitter-${id}`,
  submittedAt: `opaque-submitted-${id}`,
  reviewRecordRef: `review://records/${id}`,
  reviewRecordSha256: digest(`review-${id}`),
  reviewAuthorityIdentity: `external-review-authority-${id}`,
  reviewCompletedAt: `opaque-reviewed-${id}`,
  ...overrides
});
const priorEntries = [entry('alpha')];
const currentEntries = [...priorEntries, entry('beta')];
const plan = (overrides = {}) => ({
  queueSnapshotId: 'rolling-intake-snapshot-2',
  growthIdentity: 'append-only-reviewed-intake-with-record-stable-prior-prefix',
  orderingIdentity: 'externally-declared-complete-intake-order-only',
  reviewEvidenceIdentity: 'externally-supplied-review-record-evidence-only',
  activationIdentity: 'no-release-or-activation-authorization',
  priorEntrySetSourceRef: 'archive://intake/snapshot-1',
  priorEntrySetSha256: hashRollingIntakeData(priorEntries),
  currentEntrySetSourceRef: 'archive://intake/snapshot-2',
  currentEntrySetSha256: hashRollingIntakeData(currentEntries),
  priorOrderedIntakeIds: priorEntries.map(({ intakeId }) => intakeId),
  currentOrderedIntakeIds: currentEntries.map(({ intakeId }) => intakeId),
  provenance: { authority: 'external-reviewed-intake-process' },
  ...overrides
});
const createReceipt = (overrides = {}) => createRollingIntakeReceipt({
  plan: plan(),
  priorEntries,
  currentEntries,
  ...overrides
});

test('reviewed intake grows only by an exact append-only prior prefix', () => {
  const receipt = createReceipt();
  assert.equal(receipt.priorEntryCount, 1);
  assert.equal(receipt.currentEntryCount, 2);
  assert.equal(receipt.addedEntryCount, 1);
  assert.deepEqual(receipt.addedIntakeIds, ['intake-beta']);
  assert.deepEqual(
    receipt.orderedEntries.map(({ intakeId }) => intakeId),
    ['intake-alpha', 'intake-beta']
  );
});

test('review evidence never authorizes release or activation', () => {
  const receipt = createReceipt();
  assert.equal(
    receipt.queueTreatment,
    'external-review-record-evidence-no-release-or-activation-authorization'
  );
  assert.equal(
    receipt.activationIdentity,
    'no-release-or-activation-authorization'
  );
  assert.equal(receipt.orderedEntries[1].reviewRecordRef, 'review://records/beta');
});

test('external ordering must exactly cover each source set', () => {
  for (const changedPlan of [
    plan({ priorOrderedIntakeIds: [] }),
    plan({ currentOrderedIntakeIds: ['intake-alpha'] }),
    plan({ currentOrderedIntakeIds: ['intake-alpha', 'unknown'] })
  ]) {
    assert.throws(
      () => createRollingIntakeReceipt({
        plan: changedPlan,
        priorEntries,
        currentEntries
      }),
      /must exactly cover/
    );
  }
});

test('reordering or removing the prior prefix fails closed', () => {
  const reordered = [currentEntries[1], currentEntries[0]];
  assert.throws(
    () => createRollingIntakeReceipt({
      plan: plan({
        currentEntrySetSha256: hashRollingIntakeData(reordered),
        currentOrderedIntakeIds: reordered.map(({ intakeId }) => intakeId)
      }),
      priorEntries,
      currentEntries: reordered
    }),
    /preserve the complete prior order as a prefix/
  );
  const removed = [currentEntries[1]];
  assert.throws(
    () => createRollingIntakeReceipt({
      plan: plan({
        currentEntrySetSha256: hashRollingIntakeData(removed),
        currentOrderedIntakeIds: removed.map(({ intakeId }) => intakeId)
      }),
      priorEntries,
      currentEntries: removed
    }),
    /preserve the complete prior order as a prefix/
  );
});

test('prior candidate records cannot be rewritten', () => {
  const changed = structuredClone(currentEntries);
  changed[0].reviewRecordRef = 'review://records/changed';
  assert.throws(
    () => createRollingIntakeReceipt({
      plan: plan({ currentEntrySetSha256: hashRollingIntakeData(changed) }),
      priorEntries,
      currentEntries: changed
    }),
    /preserve every prior candidate record exactly/
  );
});

test('entry IDs and exact item artifacts resist relabeling', () => {
  const relabeledEntry = {
    ...currentEntries[0],
    intakeId: 'relabeled-intake',
    itemId: 'relabeled-item',
    itemVersionId: 'relabeled-item-v1',
    itemArtifactRef: 'archive://items/relabeled/v1'
  };
  const duplicateArtifact = [currentEntries[0], relabeledEntry];
  assert.throws(
    () => createRollingIntakeReceipt({
      plan: plan({
        priorEntrySetSha256: hashRollingIntakeData([]),
        priorOrderedIntakeIds: [],
        currentEntrySetSha256: hashRollingIntakeData(duplicateArtifact),
        currentOrderedIntakeIds: duplicateArtifact.map(
          ({ intakeId }) => intakeId
        )
      }),
      priorEntries: [],
      currentEntries: duplicateArtifact
    }),
    /one item version identity per exact item artifact/
  );
  const relabeledVersion = {
    ...currentEntries[0],
    intakeId: 'different-intake',
    itemVersionId: 'different-version-label',
    itemArtifactRef: 'archive://items/different/v1',
    itemArtifactSha256: digest('different-item'),
    submissionArtifactRef: 'intake://submissions/different',
    submissionArtifactSha256: digest('different-submission'),
    reviewRecordRef: 'review://records/different',
    reviewRecordSha256: digest('different-review')
  };
  const duplicateCoordinate = [currentEntries[0], relabeledVersion];
  assert.throws(
    () => createRollingIntakeReceipt({
      plan: plan({
        priorEntrySetSha256: hashRollingIntakeData([]),
        priorOrderedIntakeIds: [],
        currentEntrySetSha256: hashRollingIntakeData(duplicateCoordinate),
        currentOrderedIntakeIds: duplicateCoordinate.map(
          ({ intakeId }) => intakeId
        )
      }),
      priorEntries: [],
      currentEntries: duplicateCoordinate
    }),
    /unique itemId\/versionNumber coordinates/
  );
});

test('distinct versions of one item remain valid reviewed candidates', () => {
  const versions = [entry('shared'), entry('shared-v2', 2, {
    itemId: 'item-shared',
    itemVersionId: 'item-shared-v2'
  })];
  const receipt = createRollingIntakeReceipt({
    plan: plan({
      priorEntrySetSha256: hashRollingIntakeData([]),
      priorOrderedIntakeIds: [],
      currentEntrySetSha256: hashRollingIntakeData(versions),
      currentOrderedIntakeIds: versions.map(({ intakeId }) => intakeId)
    }),
    priorEntries: [],
    currentEntries: versions
  });
  assert.equal(receipt.currentEntryCount, 2);
});

test('source arrays are hash-bound before a receipt is produced', () => {
  const changed = structuredClone(currentEntries);
  changed[1].itemArtifactRef = 'archive://changed';
  assert.throws(
    () => createRollingIntakeReceipt({
      plan: plan(),
      priorEntries,
      currentEntries: changed
    }),
    /currentEntries does not match its declared SHA-256/
  );
  const changedPrior = structuredClone(priorEntries);
  changedPrior[0].reviewRecordSha256 = digest('changed');
  assert.throws(
    () => createRollingIntakeReceipt({
      plan: plan(),
      priorEntries: changedPrior,
      currentEntries
    }),
    /priorEntries does not match its declared SHA-256/
  );
});

test('plans require exact external identities without policy extras', () => {
  for (const changedPlan of [
    plan({ growthIdentity: 'replace-old-items' }),
    { ...plan(), sampleSize: 100 },
    { ...plan(), activationIdentity: undefined }
  ]) {
    assert.throws(
      () => createRollingIntakeReceipt({
        plan: changedPlan,
        priorEntries,
        currentEntries
      }),
      /growthIdentity|fields must be exact|activationIdentity/
    );
  }
});

test('malformed entry provenance fails closed', () => {
  for (const changedEntry of [
    { ...currentEntries[1], reviewRecordSha256: 'bad-hash' },
    { ...currentEntries[1], reviewAuthorityIdentity: ' ' },
    { ...currentEntries[1], versionNumber: 0 }
  ]) {
    const changed = [currentEntries[0], changedEntry];
    assert.throws(
      () => createRollingIntakeReceipt({
        plan: plan({
          currentEntrySetSha256: hashRollingIntakeData(changed)
        }),
        priorEntries,
        currentEntries: changed
      }),
      /lowercase SHA-256|non-empty string|positive safe integer/
    );
  }
});

test('an externally declared empty queue stays empty', () => {
  const receipt = createRollingIntakeReceipt({
    plan: plan({
      priorEntrySetSha256: hashRollingIntakeData([]),
      currentEntrySetSha256: hashRollingIntakeData([]),
      priorOrderedIntakeIds: [],
      currentOrderedIntakeIds: []
    }),
    priorEntries: [],
    currentEntries: []
  });
  assert.equal(receipt.currentEntryCount, 0);
  assert.deepEqual(receipt.orderedEntries, []);
  assert.deepEqual(receipt.addedIntakeIds, []);
});

test('receipts are deterministic, immutable, and preserve caller inputs', () => {
  const before = structuredClone({ priorEntries, currentEntries });
  const first = createReceipt();
  const second = createReceipt();
  assert.deepEqual(first, second);
  assert.deepEqual({ priorEntries, currentEntries }, before);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.orderedEntries));
  assert.ok(Object.isFrozen(first.orderedEntries[0]));
  assert.throws(() => {
    first.orderedEntries[0].itemId = 'changed';
  }, TypeError);
});
