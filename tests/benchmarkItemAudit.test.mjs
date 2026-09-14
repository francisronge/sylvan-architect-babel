import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createItemAuditReceipt,
  hashItemAuditData,
  ITEM_AUDIT_DISPOSITIONS,
  ITEM_AUDIT_TAXONOMY
} from '../bench/itemAudit.js';

const digest = (text) => hashItemAuditData({ text });
const item = (id, versionNumber = 1, overrides = {}) => ({
  itemId: `item-${id}`,
  itemVersionId: `item-${id}-v${versionNumber}`,
  versionNumber,
  itemArtifactRef: `archive://items/${id}/v${versionNumber}`,
  itemArtifactSha256: digest(`item-${id}-v${versionNumber}`),
  statusHistoryRef: `archive://status/${id}`,
  statusHistorySha256: digest(`status-${id}`),
  ...overrides
});
const items = [item('verified'), item('revised'), item('uncertain')];
const finding = (id, taxonomyClass = 'key-error') => ({
  findingId: `finding-${id}`,
  taxonomyClass,
  evidenceRef: `audit://findings/${id}`,
  evidenceSha256: digest(`finding-${id}`)
});
const revision = (target, overrides = {}) => ({
  itemId: target.itemId,
  fromItemVersionId: target.itemVersionId,
  toItemVersionId: `${target.itemId}-v${target.versionNumber + 1}`,
  toVersionNumber: target.versionNumber + 1,
  revisedItemArtifactRef:
    `archive://items/${target.itemId}/v${target.versionNumber + 1}`,
  revisedItemArtifactSha256: digest(`revised-${target.itemId}`),
  affectedScoreSetRef: `scores://affected/${target.itemId}`,
  affectedScoreSetSha256: digest(`affected-${target.itemId}`),
  dualVersionRepublicationPlanRef:
    `release://dual-version/${target.itemId}`,
  dualVersionRepublicationPlanSha256:
    digest(`dual-version-${target.itemId}`),
  ...overrides
});
const audit = (target, disposition, overrides = {}) => ({
  auditId: `audit-${target.itemVersionId}`,
  itemId: target.itemId,
  auditedItemVersionId: target.itemVersionId,
  auditorIdentity: 'external-auditor',
  auditCompletedAt: 'opaque-date',
  auditArtifactRef: `audit://records/${target.itemVersionId}`,
  auditArtifactSha256: digest(`audit-${target.itemVersionId}`),
  findings: disposition === 'verified'
    ? []
    : [finding(target.itemId)],
  disposition,
  dispositionEvidenceRef: `audit://disposition/${target.itemVersionId}`,
  dispositionEvidenceSha256: digest(`disposition-${target.itemVersionId}`),
  revision: disposition === 'revised' ? revision(target) : null,
  ...overrides
});
const audits = [
  audit(items[0], 'verified'),
  audit(items[1], 'revised'),
  audit(items[2], 'documented-uncertain')
];
const plan = (overrides = {}) => ({
  auditCycleId: 'audit-cycle-1',
  auditScopeIdentity: 'externally-declared-complete-item-version-set',
  taxonomyIdentity:
    'key-error-underspecified-checklist-family-doc-gap-ambiguity-defect-contamination-evidence',
  dispositionIdentity:
    'externally-authored-verified-revised-or-documented-uncertain',
  revisionIdentity: 'next-version-plus-dual-version-score-republication',
  uncertainIdentity: 'exclude-from-claim-bearing-scores-until-resolved',
  itemSetSourceRef: 'archive://item-set',
  itemSetSha256: hashItemAuditData(items),
  auditSetSourceRef: 'archive://audit-set',
  auditSetSha256: hashItemAuditData(audits),
  targetItemVersionIds: items.map(({ itemVersionId }) => itemVersionId),
  provenance: { authority: 'external-audit-process' },
  ...overrides
});
const createReceipt = (overrides = {}) => createItemAuditReceipt({
  plan: plan(),
  items,
  audits,
  ...overrides
});

test('the exact five-class taxonomy and three dispositions are stable', () => {
  assert.deepEqual(ITEM_AUDIT_TAXONOMY, [
    'key-error',
    'underspecified-checklist',
    'family-doc-gap',
    'ambiguity-defect',
    'contamination-evidence'
  ]);
  assert.deepEqual(ITEM_AUDIT_DISPOSITIONS, [
    'verified',
    'revised',
    'documented-uncertain'
  ]);
});

test('externally authored dispositions remain separate and descriptive', () => {
  const receipt = createReceipt();
  assert.deepEqual(receipt.dispositionCounts, {
    verified: 1,
    revised: 1,
    'documented-uncertain': 1
  });
  assert.deepEqual(
    receipt.itemAuditResults.map(({ disposition }) => disposition),
    ['verified', 'revised', 'documented-uncertain']
  );
});

test('documented uncertainty is excluded without authorizing other items', () => {
  const receipt = createReceipt();
  assert.equal(
    receipt.itemAuditResults[2].claimBearingTreatment,
    'excluded-from-claim-bearing-scores-until-resolved'
  );
  assert.equal(
    receipt.itemAuditResults[0].claimBearingTreatment,
    'no-item-audit-exclusion-no-release-authorization'
  );
});

test('revisions require the next version and dual-version republication', () => {
  const result = createReceipt().itemAuditResults[1];
  assert.equal(result.versionTransition.fromItemVersionId, 'item-revised-v1');
  assert.equal(result.versionTransition.toItemVersionId, 'item-revised-v2');
  assert.equal(result.versionTransition.toVersionNumber, 2);
  assert.equal(
    result.claimBearingTreatment,
    'old-and-new-versions-require-dual-version-score-republication'
  );
  assert.equal(
    result.versionTransition.revisedItemArtifactSha256,
    audits[1].revision.revisedItemArtifactSha256
  );
  assert.equal(result.auditArtifactSha256, audits[1].auditArtifactSha256);
  for (const changedRevision of [
    revision(items[1], { toVersionNumber: 3 }),
    revision(items[1], { toItemVersionId: items[1].itemVersionId }),
    revision(items[1], { fromItemVersionId: 'different-version' })
  ]) {
    const changed = structuredClone(audits);
    changed[1].revision = changedRevision;
    assert.throws(
      () => createItemAuditReceipt({
        plan: plan({ auditSetSha256: hashItemAuditData(changed) }),
        items,
        audits: changed
      }),
      /next distinct|continue the audited/
    );
  }
});

test('verified audits have no findings and other dispositions cite one', () => {
  const verifiedWithFinding = structuredClone(audits);
  verifiedWithFinding[0].findings = [finding('unexpected')];
  assert.throws(
    () => createItemAuditReceipt({
      plan: plan({
        auditSetSha256: hashItemAuditData(verifiedWithFinding)
      }),
      items,
      audits: verifiedWithFinding
    }),
    /verified disposition requires no findings/
  );
  const uncertainWithoutFinding = structuredClone(audits);
  uncertainWithoutFinding[2].findings = [];
  assert.throws(
    () => createItemAuditReceipt({
      plan: plan({
        auditSetSha256: hashItemAuditData(uncertainWithoutFinding)
      }),
      items,
      audits: uncertainWithoutFinding
    }),
    /requires a finding/
  );
});

test('unknown taxonomy classes and malformed evidence fail closed', () => {
  for (const changedFinding of [
    finding('bad-class', 'invented-class'),
    { ...finding('bad-hash'), evidenceSha256: 'not-a-hash' }
  ]) {
    const changed = structuredClone(audits);
    changed[2].findings = [changedFinding];
    assert.throws(
      () => createItemAuditReceipt({
        plan: plan({ auditSetSha256: hashItemAuditData(changed) }),
        items,
        audits: changed
      }),
      /taxonomyClass|lowercase SHA-256/
    );
  }
});

test('every externally targeted item is audited exactly once', () => {
  const incomplete = audits.slice(0, 2);
  assert.throws(
    () => createItemAuditReceipt({
      plan: plan({ auditSetSha256: hashItemAuditData(incomplete) }),
      items,
      audits: incomplete
    }),
    /exactly cover targetItemVersionIds/
  );
  const duplicated = [...audits, {
    ...audits[0],
    auditId: 'relabeled-audit'
  }];
  assert.throws(
    () => createItemAuditReceipt({
      plan: plan({
        auditSetSha256: hashItemAuditData(duplicated)
      }),
      items,
      audits: duplicated
    }),
    /audit each item version exactly once/
  );
});

test('item identities and version coordinates fail closed on relabeling', () => {
  const duplicateVersion = [items[0], {
    ...items[0],
    itemVersionId: 'relabeled-version'
  }];
  assert.throws(
    () => createItemAuditReceipt({
      plan: plan({
        itemSetSha256: hashItemAuditData(duplicateVersion),
        auditSetSha256: hashItemAuditData([]),
        targetItemVersionIds: duplicateVersion.map(
          ({ itemVersionId }) => itemVersionId
        )
      }),
      items: duplicateVersion,
      audits: []
    }),
    /unique itemId\/versionNumber coordinates/
  );
});

test('item and audit source sets are hash-bound', () => {
  const changedItems = structuredClone(items);
  changedItems[0].itemArtifactRef = 'archive://changed';
  assert.throws(
    () => createItemAuditReceipt({
      plan: plan(),
      items: changedItems,
      audits
    }),
    /items do not match/
  );
  const changedAudits = structuredClone(audits);
  changedAudits[0].auditorIdentity = 'different-auditor';
  assert.throws(
    () => createItemAuditReceipt({
      plan: plan(),
      items,
      audits: changedAudits
    }),
    /records do not match/
  );
});

test('revision fields are forbidden on non-revised dispositions', () => {
  const changed = structuredClone(audits);
  changed[0].revision = revision(items[0]);
  assert.throws(
    () => createItemAuditReceipt({
      plan: plan({ auditSetSha256: hashItemAuditData(changed) }),
      items,
      audits: changed
    }),
    /must be null unless disposition is revised/
  );
});

test('revision targets cannot alias audited or parallel revision versions', () => {
  const auditedAlias = structuredClone(audits);
  auditedAlias[1].revision.toItemVersionId = items[0].itemVersionId;
  assert.throws(
    () => createItemAuditReceipt({
      plan: plan({ auditSetSha256: hashItemAuditData(auditedAlias) }),
      items,
      audits: auditedAlias
    }),
    /must not alias audited item versions/
  );
  const secondRevised = structuredClone(audits);
  secondRevised[2] = audit(items[2], 'revised', {
    findings: [finding('parallel-revision')],
    revision: revision(items[2], {
      toItemVersionId: secondRevised[1].revision.toItemVersionId
    })
  });
  assert.throws(
    () => createItemAuditReceipt({
      plan: plan({ auditSetSha256: hashItemAuditData(secondRevised) }),
      items,
      audits: secondRevised
    }),
    /unique target item-version IDs/
  );
});

test('revision targets cannot fork an existing item version coordinate', () => {
  const itemV1 = item('x', 1);
  const itemV2 = item('x', 2);
  const localItems = [itemV1, itemV2];
  const localAudits = [
    audit(itemV1, 'revised', {
      revision: revision(itemV1, {
        toItemVersionId: 'item-x-v2-fork'
      })
    }),
    audit(itemV2, 'verified')
  ];
  assert.throws(
    () => createItemAuditReceipt({
      plan: plan({
        itemSetSha256: hashItemAuditData(localItems),
        auditSetSha256: hashItemAuditData(localAudits),
        targetItemVersionIds: localItems.map(
          ({ itemVersionId }) => itemVersionId
        )
      }),
      items: localItems,
      audits: localAudits
    }),
    /revision targets must not fork an existing itemId\/versionNumber coordinate/
  );
});

test('a multi-version scope may revise its latest version forward', () => {
  const itemV1 = item('x', 1);
  const itemV2 = item('x', 2);
  const localItems = [itemV1, itemV2];
  const localAudits = [
    audit(itemV1, 'verified'),
    audit(itemV2, 'revised')
  ];
  const receipt = createItemAuditReceipt({
    plan: plan({
      itemSetSha256: hashItemAuditData(localItems),
      auditSetSha256: hashItemAuditData(localAudits),
      targetItemVersionIds: localItems.map(
        ({ itemVersionId }) => itemVersionId
      )
    }),
    items: localItems,
    audits: localAudits
  });
  assert.equal(
    receipt.itemAuditResults[1].versionTransition.toItemVersionId,
    'item-x-v3'
  );
  assert.equal(receipt.itemAuditResults[1].versionTransition.toVersionNumber, 3);
});

test('policy-bearing extras and changed identities are refused', () => {
  assert.throws(
    () => createItemAuditReceipt({
      plan: { ...plan(), retirementThreshold: 2 },
      items,
      audits
    }),
    /fields must be exact/
  );
  assert.throws(
    () => createItemAuditReceipt({
      plan: plan({ uncertainIdentity: 'score-as-failure' }),
      items,
      audits
    }),
    /uncertainIdentity/
  );
});

test('an externally declared empty audit scope stays empty', () => {
  const receipt = createItemAuditReceipt({
    plan: plan({
      itemSetSha256: hashItemAuditData([]),
      auditSetSha256: hashItemAuditData([]),
      targetItemVersionIds: []
    }),
    items: [],
    audits: []
  });
  assert.equal(receipt.itemCount, 0);
  assert.deepEqual(receipt.itemAuditResults, []);
  assert.deepEqual(receipt.dispositionCounts, {
    verified: 0,
    revised: 0,
    'documented-uncertain': 0
  });
});

test('receipts are deterministic, immutable, and preserve callers', () => {
  const planValue = plan();
  const itemValue = structuredClone(items);
  const auditValue = structuredClone(audits);
  const before = JSON.stringify({ planValue, itemValue, auditValue });
  const first = createItemAuditReceipt({
    plan: planValue,
    items: itemValue,
    audits: auditValue
  });
  const second = createItemAuditReceipt({
    plan: planValue,
    items: itemValue,
    audits: auditValue
  });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(JSON.stringify({ planValue, itemValue, auditValue }), before);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.itemAuditResults));
  assert.ok(Object.isFrozen(first.itemAuditResults[1].versionTransition));
});
