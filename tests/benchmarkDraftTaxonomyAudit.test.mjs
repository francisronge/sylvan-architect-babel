import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  createDraftItemSetReceipt,
  createDraftTaxonomyAuditReceipt,
  DRAFT_TAXONOMY_AUDIT_OUTCOMES,
  hashDraftItemData,
  hashDraftTaxonomyAuditData
} from '../bench/index.js';

const sha256Text = (text) => createHash('sha256')
  .update(text, 'utf8')
  .digest('hex');
const digest = (text) => hashDraftTaxonomyAuditData({ text });
const inputText = 'Proof draft Ńáʔ 🜁';

const item = (overrides = {}) => ({
  itemVersionId: 'draft-item-1-v1',
  itemId: 'draft-item-1',
  versionNumber: 1,
  lifecycle: 'draft',
  input: {
    text: inputText,
    textSha256: sha256Text(inputText)
  },
  language: 'open-language',
  script: 'open-script',
  frameworks: ['open-framework'],
  phenomena: {
    primary: 'open-phenomenon',
    secondary: []
  },
  noveltyClass: 'nonce',
  conditionalChecklist: [{
    checkId: 'proof-check',
    obligationClass: 'analysis-conditional',
    text: 'Externally authored checklist text.',
    registerIds: []
  }],
  familyDocumentation: [],
  ambiguitySpec: {
    mode: 'single-adequate-analysis',
    specRef: 'proof://ambiguity/spec',
    specSha256: digest('ambiguity-spec')
  },
  purposeFlags: [{
    kind: 'adversarial'
  }],
  provenance: {
    authorRef: 'external-author',
    authoredAt: 'opaque-authorship-record',
    sourceArtifactRef: 'proof://draft/item',
    sourceArtifactSha256: digest('draft-source')
  },
  ...overrides
});

const draftReceipt = (items = [item()]) => createDraftItemSetReceipt({
  plan: {
    draftSetId: 'draft-set-1',
    itemSourceSha256: hashDraftItemData(items),
    checklistPolicyIdentity: 'bm5-conditional-checklist-structural-lint-only',
    taxonomyIdentity: 'bm5-content-axes-and-purpose-flags',
    lifecycleIdentity: 'draft-only-no-review-activation-scoring-or-release',
    provenance: { source: 'external-draft-process' }
  },
  items
});

const audit = (receipt, overrides = {}) => ({
  itemVersionId: receipt.itemVersionIds[0],
  draftReceiptSha256: receipt.receiptSha256,
  taxonomyCatalogRef: 'proof://taxonomy/catalog',
  taxonomyCatalogSha256: digest('taxonomy-catalog'),
  auditorRefs: ['external-auditor'],
  auditedAt: 'opaque-audit-record',
  auditRef: 'proof://taxonomy/audit/item-1',
  auditSha256: digest('taxonomy-audit'),
  outcome: 'no-findings-recorded',
  findingRefs: [],
  ...overrides
});

const plan = (receipt, audits, overrides = {}) => ({
  auditSetId: 'taxonomy-audit-set-1',
  draftReceiptSha256: receipt.receiptSha256,
  taxonomyCatalogRef: 'proof://taxonomy/catalog',
  taxonomyCatalogSha256: digest('taxonomy-catalog'),
  auditRecordSourceSha256: hashDraftTaxonomyAuditData(audits),
  auditIdentity: 'bm5-external-taxonomy-audit-evidence-only',
  lifecycleIdentity:
    'draft-remains-draft-no-review-promotion-activation-scoring-or-release',
  provenance: { source: 'external-taxonomy-audit-process' },
  ...overrides
});

const createReceipt = ({
  receipt = draftReceipt(),
  audits = null,
  planOverrides = {}
} = {}) => {
  const records = audits ?? [audit(receipt)];
  return createDraftTaxonomyAuditReceipt({
    plan: plan(receipt, records, planOverrides),
    draftReceipt: receipt,
    audits: records
  });
};

test('audit receipts preserve exact external evidence without judging it', () => {
  const draft = draftReceipt();
  const records = [audit(draft, {
    auditorRefs: ['external-auditor-a', 'external-auditor-b'],
    outcome: 'findings-recorded',
    findingRefs: ['proof://finding/open-taxonomy-label']
  })];
  const receipt = createReceipt({ receipt: draft, audits: records });
  assert.deepEqual(receipt.audits, records);
  assert.deepEqual(receipt.auditedItemVersionIds, draft.itemVersionIds);
  assert.equal(receipt.itemCount, 1);
  assert.equal(
    receipt.auditTreatment,
    'external-evidence-coverage-only-no-taxonomy-or-linguistic-judgment'
  );
  assert.equal(
    receipt.lifecycleTreatment,
    'draft-remains-draft-not-reviewed-piloted-active-scored-or-release-authorized'
  );
});

test('audit outcomes describe only whether finding references were recorded', () => {
  assert.deepEqual(DRAFT_TAXONOMY_AUDIT_OUTCOMES, [
    'no-findings-recorded',
    'findings-recorded'
  ]);
  const draft = draftReceipt();
  assert.throws(
    () => createReceipt({
      receipt: draft,
      audits: [audit(draft, {
        outcome: 'no-findings-recorded',
        findingRefs: ['proof://unexpected-finding']
      })]
    }),
    /findingRefs must be empty/
  );
  assert.throws(
    () => createReceipt({
      receipt: draft,
      audits: [audit(draft, {
        outcome: 'findings-recorded',
        findingRefs: []
      })]
    }),
    /must identify the recorded findings/
  );
  assert.throws(
    () => createReceipt({
      receipt: draft,
      audits: [audit(draft, { outcome: 'approved' })]
    }),
    /outcome must be one of/
  );
});

test('every draft item requires exactly one external audit record', () => {
  const items = [
    item(),
    item({
      itemVersionId: 'draft-item-2-v1',
      itemId: 'draft-item-2',
      input: {
        text: 'Second proof draft',
        textSha256: sha256Text('Second proof draft')
      },
      provenance: {
        authorRef: 'external-author-2',
        authoredAt: 'opaque-authorship-record-2',
        sourceArtifactRef: 'proof://draft/item-2',
        sourceArtifactSha256: digest('draft-source-2')
      }
    })
  ];
  const draft = draftReceipt(items);
  const first = audit(draft);
  const second = audit(draft, {
    itemVersionId: items[1].itemVersionId,
    auditRef: 'proof://taxonomy/audit/item-2',
    auditSha256: digest('taxonomy-audit-2')
  });
  assert.doesNotThrow(
    () => createReceipt({ receipt: draft, audits: [second, first] })
  );
  assert.throws(
    () => createReceipt({ receipt: draft, audits: [first] }),
    /must cover every draft item exactly once/
  );
  assert.throws(
    () => createReceipt({ receipt: draft, audits: [first, first] }),
    /itemVersionId values must not contain duplicates/
  );
  assert.throws(
    () => createReceipt({
      receipt: draft,
      audits: [first, {
        ...second,
        itemVersionId: 'unknown-item-version'
      }]
    }),
    /must cover every draft item exactly once/
  );
});

test('audit records bind the exact W14a receipt and taxonomy catalog', () => {
  const draft = draftReceipt();
  assert.throws(
    () => createReceipt({
      receipt: draft,
      audits: [audit(draft, {
        draftReceiptSha256: digest('other-draft-receipt')
      })]
    }),
    /must match the audited draft receipt/
  );
  assert.throws(
    () => createReceipt({
      receipt: draft,
      audits: [audit(draft, {
        taxonomyCatalogRef: 'proof://taxonomy/other'
      })]
    }),
    /taxonomy catalog must match the audit plan/
  );
  assert.throws(
    () => createReceipt({
      receipt: draft,
      audits: [audit(draft, {
        taxonomyCatalogSha256: digest('other-taxonomy')
      })]
    }),
    /taxonomy catalog must match the audit plan/
  );
});

test('draft receipt reconstruction and external plan binding reject tampering', () => {
  const draft = draftReceipt();
  const changed = structuredClone(draft);
  changed.items[0].language = 'changed-open-language';
  assert.throws(
    () => createReceipt({ receipt: changed }),
    /items do not match their source SHA-256/
  );

  const forged = structuredClone(draft);
  forged.items[0].language = 'forged-open-language';
  forged.itemSourceSha256 = hashDraftItemData(forged.items);
  forged.receiptSha256 = hashDraftTaxonomyAuditData(
    Object.fromEntries(
      Object.entries(forged).filter(([field]) => field !== 'receiptSha256')
    )
  );
  const originalAudits = [audit(draft)];
  assert.throws(
    () => createDraftTaxonomyAuditReceipt({
      plan: plan(draft, originalAudits),
      draftReceipt: forged,
      audits: originalAudits
    }),
    /draft receipt does not match the audit plan/
  );
});

test('audit record sources and plan receipt identities fail closed', () => {
  const draft = draftReceipt();
  const records = [audit(draft)];
  assert.throws(
    () => createDraftTaxonomyAuditReceipt({
      plan: plan(draft, records, {
        auditRecordSourceSha256: digest('wrong-audit-source')
      }),
      draftReceipt: draft,
      audits: records
    }),
    /records do not match their source SHA-256/
  );
  assert.throws(
    () => createDraftTaxonomyAuditReceipt({
      plan: plan(draft, records, {
        draftReceiptSha256: digest('wrong-draft-receipt')
      }),
      draftReceipt: draft,
      audits: records
    }),
    /draft receipt does not match the audit plan/
  );
});

test('auditor quantities remain external while identities are nonempty and unique', () => {
  const draft = draftReceipt();
  for (const auditorRefs of [
    ['one-auditor'],
    ['one-auditor', 'two-auditor', 'three-auditor']
  ]) {
    assert.doesNotThrow(() => createReceipt({
      receipt: draft,
      audits: [audit(draft, { auditorRefs })]
    }));
  }
  assert.throws(
    () => createReceipt({
      receipt: draft,
      audits: [audit(draft, { auditorRefs: [] })]
    }),
    /auditorRefs must be a non-empty array/
  );
  assert.throws(
    () => createReceipt({
      receipt: draft,
      audits: [audit(draft, {
        auditorRefs: ['same-auditor', 'same-auditor']
      })]
    }),
    /auditorRefs must not contain duplicates/
  );
});

test('policy, activation, scoring, and lifecycle fields are refused', () => {
  const draft = draftReceipt();
  for (const extra of [
    { approved: true },
    { activationStatus: 'active' },
    { score: 1 },
    { lifecycle: 'reviewed' },
    { reviewerQuota: 2 }
  ]) {
    assert.throws(
      () => createReceipt({
        receipt: draft,
        audits: [audit(draft, extra)]
      }),
      /fields must be exact/
    );
  }
  assert.throws(
    () => createReceipt({
      receipt: draft,
      planOverrides: { launchAuthorizationRef: 'not-allowed' }
    }),
    /fields must be exact/
  );
});

test('the two audit identities are exact and cannot become lifecycle policy', () => {
  const draft = draftReceipt();
  assert.throws(
    () => createReceipt({
      receipt: draft,
      planOverrides: { auditIdentity: 'taxonomy-audit-approved' }
    }),
    /auditIdentity must be bm5-external-taxonomy-audit-evidence-only/
  );
  assert.throws(
    () => createReceipt({
      receipt: draft,
      planOverrides: { lifecycleIdentity: 'reviewed-and-ready' }
    }),
    /lifecycleIdentity must be draft-remains-draft/
  );
});

test('an externally declared empty draft set has an empty audit set', () => {
  const draft = draftReceipt([]);
  const receipt = createReceipt({ receipt: draft, audits: [] });
  assert.equal(receipt.itemCount, 0);
  assert.deepEqual(receipt.auditedItemVersionIds, []);
  assert.deepEqual(receipt.audits, []);
  assert.throws(
    () => createReceipt({
      receipt: draft,
      audits: [audit(draft, { itemVersionId: 'invented-item' })]
    }),
    /must cover every draft item exactly once/
  );
});

test('receipts are deterministic, immutable, and preserve caller input', () => {
  const draft = draftReceipt();
  const records = [audit(draft)];
  const rawPlan = plan(draft, records);
  const before = structuredClone({ draft, records, rawPlan });
  const first = createDraftTaxonomyAuditReceipt({
    plan: rawPlan,
    draftReceipt: draft,
    audits: records
  });
  const second = createDraftTaxonomyAuditReceipt({
    plan: rawPlan,
    draftReceipt: draft,
    audits: records
  });
  assert.deepEqual(first, second);
  assert.deepEqual({ draft, records, rawPlan }, before);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.audits));
  assert.ok(Object.isFrozen(first.audits[0]));

  records[0].auditorRefs[0] = 'mutated-after-receipt';
  assert.equal(first.audits[0].auditorRefs[0], 'external-auditor');
});
