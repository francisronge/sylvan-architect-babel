import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  CHECKLIST_OBLIGATION_CLASSES,
  createDraftItemSetReceipt,
  hashDraftItemData,
  ITEM_NOVELTY_CLASSES
} from '../bench/draftItems.js';

const sha256Text = (text) => createHash('sha256')
  .update(text, 'utf8')
  .digest('hex');
const digest = (text) => hashDraftItemData({ text });
const inputText = 'Ńáʔ proof input 🜁';

const item = (overrides = {}) => ({
  itemVersionId: 'draft-item-1-v1',
  itemId: 'draft-item-1',
  versionNumber: 1,
  lifecycle: 'draft',
  input: {
    text: inputText,
    textSha256: sha256Text(inputText)
  },
  language: 'open-language-name',
  script: 'open-script-name',
  frameworks: ['open-framework-a', 'open-framework-b'],
  phenomena: {
    primary: 'open-primary-phenomenon',
    secondary: ['open-secondary-phenomenon']
  },
  noveltyClass: 'nonce',
  conditionalChecklist: [{
    checkId: 'check-stand',
    obligationClass: 'stand-taking',
    text: 'Externally authored structural checklist text.',
    registerIds: []
  }, {
    checkId: 'check-analysis',
    obligationClass: 'analysis-conditional',
    text: 'Externally authored conditional checklist text.',
    registerIds: []
  }, {
    checkId: 'check-register',
    obligationClass: 'register-compliance',
    text: 'Externally authored register checklist text.',
    registerIds: ['external-register-rule']
  }],
  familyDocumentation: [{
    familyId: 'open-family-name',
    status: 'draft',
    normative: false,
    documentRef: 'artifact://family/draft',
    documentSha256: digest('family-document')
  }],
  ambiguitySpec: {
    mode: 'single-adequate-analysis',
    specRef: 'artifact://ambiguity/spec',
    specSha256: digest('ambiguity-spec')
  },
  purposeFlags: [{
    kind: 'foundational'
  }, {
    kind: 'control',
    targetItemVersionId: 'external-control-target',
    factor: 'externally-authored-factor'
  }, {
    kind: 'calibration',
    baselineRef: 'artifact://calibration/baseline',
    baselineSha256: digest('calibration-baseline')
  }, {
    kind: 'adversarial'
  }],
  provenance: {
    authorRef: 'external-author',
    authoredAt: 'opaque-authorship-record',
    sourceArtifactRef: 'artifact://draft/item-1-v1',
    sourceArtifactSha256: digest('draft-item-source')
  },
  ...overrides
});

const plan = (items, overrides = {}) => ({
  draftSetId: 'draft-set-1',
  itemSourceSha256: hashDraftItemData(items),
  checklistPolicyIdentity: 'bm5-conditional-checklist-structural-lint-only',
  taxonomyIdentity: 'bm5-content-axes-and-purpose-flags',
  lifecycleIdentity: 'draft-only-no-review-activation-scoring-or-release',
  provenance: { source: 'external-draft-process' },
  ...overrides
});

const createReceipt = (items = [item()], overrides = {}) => (
  createDraftItemSetReceipt({
    plan: plan(items, overrides),
    items
  })
);

test('draft receipts preserve every externally authored BM5 content axis', () => {
  const source = item();
  const receipt = createReceipt([source]);
  assert.deepEqual(receipt.items[0], source);
  assert.deepEqual(receipt.itemVersionIds, [source.itemVersionId]);
  assert.equal(receipt.itemCount, 1);
  assert.equal(
    receipt.lintTreatment,
    'structural-only-no-linguistic-validity-taxonomy-review-or-activation'
  );
  assert.equal(
    receipt.lifecycleTreatment,
    'draft-not-reviewed-piloted-active-scored-or-release-authorized'
  );
});

test('input bytes are hash-bound without Unicode normalization or rewriting', () => {
  const decomposed = item();
  const receipt = createReceipt([decomposed]);
  assert.equal(receipt.items[0].input.text, inputText);

  const normalizedText = inputText.normalize('NFC');
  assert.notEqual(normalizedText, inputText);
  const normalized = item({
    input: {
      text: normalizedText,
      textSha256: sha256Text(normalizedText)
    }
  });
  assert.notEqual(
    hashDraftItemData([decomposed]),
    hashDraftItemData([normalized])
  );

  const badHash = item({
    input: {
      text: inputText,
      textSha256: digest('wrong-input')
    }
  });
  assert.throws(
    () => createReceipt([badHash]),
    /must hash the exact UTF-8 text/
  );
});

test('novelty classes are exact while taxonomy labels remain open', () => {
  for (const noveltyClass of ITEM_NOVELTY_CLASSES) {
    assert.doesNotThrow(() => createReceipt([item({
      noveltyClass,
      language: `open-language-${noveltyClass}`,
      script: `open-script-${noveltyClass}`,
      phenomena: {
        primary: `open-phenomenon-${noveltyClass}`,
        secondary: []
      }
    })]));
  }
  assert.throws(
    () => createReceipt([item({ noveltyClass: 'invented-class' })]),
    /noveltyClass must be one of/
  );
});

test('conditional checklists enforce only the three structural obligation kinds', () => {
  assert.deepEqual(CHECKLIST_OBLIGATION_CLASSES, [
    'stand-taking',
    'analysis-conditional',
    'register-compliance'
  ]);
  const empty = item({ conditionalChecklist: [] });
  assert.throws(
    () => createReceipt([empty]),
    /must contain at least one entry/
  );

  const missingRegister = item({
    conditionalChecklist: [{
      checkId: 'check-register',
      obligationClass: 'register-compliance',
      text: 'External compliance text.',
      registerIds: []
    }]
  });
  assert.throws(
    () => createReceipt([missingRegister]),
    /must identify the stated register obligation/
  );

  const misplacedRegister = item({
    conditionalChecklist: [{
      checkId: 'check-stand',
      obligationClass: 'stand-taking',
      text: 'External stand-taking text.',
      registerIds: ['not-allowed-here']
    }]
  });
  assert.throws(
    () => createReceipt([misplacedRegister]),
    /allowed only for register-compliance/
  );

  const duplicateIds = item({
    conditionalChecklist: [
      item().conditionalChecklist[0],
      item().conditionalChecklist[0]
    ]
  });
  assert.throws(
    () => createReceipt([duplicateIds]),
    /check IDs must not contain duplicates/
  );

  const relabeledDuplicate = item({
    conditionalChecklist: [
      item().conditionalChecklist[0],
      {
        ...item().conditionalChecklist[0],
        checkId: 'relabeled-check'
      }
    ]
  });
  assert.throws(
    () => createReceipt([relabeledDuplicate]),
    /substantive entries must not contain substantive duplicates/
  );
});

test('family documentation stays draft, non-normative, and artifact-bound', () => {
  assert.doesNotThrow(() => createReceipt([item({
    familyDocumentation: []
  })]));
  assert.throws(
    () => createReceipt([item({
      familyDocumentation: [{
        ...item().familyDocumentation[0],
        status: 'approved'
      }]
    })]),
    /status must be one of \[draft\]/
  );
  assert.throws(
    () => createReceipt([item({
      familyDocumentation: [{
        ...item().familyDocumentation[0],
        normative: true
      }]
    })]),
    /normative must be false/
  );
  assert.doesNotThrow(
    () => createReceipt([item({
      familyDocumentation: [
        item().familyDocumentation[0],
        {
          ...item().familyDocumentation[0],
          documentRef: 'artifact://family/second',
          documentSha256: digest('second-family-document')
        }
      ]
    })])
  );
  assert.throws(
    () => createReceipt([item({
      familyDocumentation: [
        item().familyDocumentation[0],
        item().familyDocumentation[0]
      ]
    })]),
    /must not contain substantive duplicates/
  );
});

test('purpose flags preserve exact settled shapes without creating gates or keys', () => {
  assert.doesNotThrow(() => createReceipt([item({ purposeFlags: [] })]));
  assert.throws(
    () => createReceipt([item({
      purposeFlags: [{
        kind: 'adversarial',
        scoringKey: 'forbidden'
      }]
    })]),
    /fields must be exact/
  );
  assert.throws(
    () => createReceipt([item({
      purposeFlags: [{
        kind: 'foundational'
      }, {
        kind: 'foundational'
      }]
    })]),
    /must not contain substantive duplicates/
  );
  assert.throws(
    () => createReceipt([item({
      purposeFlags: [{
        kind: 'control',
        targetItemVersionId: '',
        factor: 'external-factor'
      }]
    })]),
    /targetItemVersionId must be a non-empty string/
  );
  assert.throws(
    () => createReceipt([item({
      purposeFlags: [{
        kind: 'control',
        targetItemVersionId: 'draft-item-1-v1',
        factor: 'external-factor'
      }]
    })]),
    /must identify a different item version/
  );
});

test('ambiguity metadata supports the two canonical modes without a gold tree', () => {
  for (const mode of ['single-adequate-analysis', 'enumeration-sub-suite']) {
    assert.doesNotThrow(() => createReceipt([item({
      ambiguitySpec: {
        ...item().ambiguitySpec,
        mode
      }
    })]));
  }
  assert.throws(
    () => createReceipt([item({
      ambiguitySpec: {
        ...item().ambiguitySpec,
        mode: 'gold-tree'
      }
    })]),
    /ambiguitySpec.mode must be one of/
  );
});

test('the boundary accepts only exact draft lifecycle fields', () => {
  assert.throws(
    () => createReceipt([item({ lifecycle: 'active' })]),
    /lifecycle must be one of \[draft\]/
  );
  assert.throws(
    () => createReceipt([item({ activationApproval: true })]),
    /fields must be exact/
  );
});

test('item identities, coordinates, sources, and substance resist relabeling', () => {
  const first = item();
  const duplicateVersionId = item({
    itemId: 'different-item',
    provenance: {
      ...item().provenance,
      sourceArtifactRef: 'artifact://draft/different-item'
    }
  });
  assert.throws(
    () => createReceipt([first, duplicateVersionId]),
    /itemVersionId values must not contain duplicates/
  );

  const coordinateCollision = item({
    itemVersionId: 'different-version-id',
    provenance: {
      ...item().provenance,
      sourceArtifactRef: 'artifact://draft/different-coordinate'
    }
  });
  assert.throws(
    () => createReceipt([first, coordinateCollision]),
    /itemId\/versionNumber coordinates must not contain duplicates/
  );

  const relabeled = item({
    itemVersionId: 'relabelled-version',
    itemId: 'relabelled-item',
    versionNumber: 2,
    provenance: {
      authorRef: 'different-author',
      authoredAt: 'different-record',
      sourceArtifactRef: 'artifact://draft/relabelled',
      sourceArtifactSha256: digest('relabelled-source')
    }
  });
  assert.throws(
    () => createReceipt([first, relabeled]),
    /substantive definitions must not contain substantive duplicates/
  );

  const distinctText = 'A distinct externally authored proof input.';
  const distinct = item({
    itemVersionId: 'distinct-version',
    itemId: 'distinct-item',
    input: {
      text: distinctText,
      textSha256: sha256Text(distinctText)
    },
    phenomena: {
      primary: 'distinct-open-phenomenon',
      secondary: []
    }
  });
  assert.doesNotThrow(() => createReceipt([first, distinct]));
});

test('item source sets and plan identities fail closed', () => {
  const items = [item()];
  assert.throws(
    () => createDraftItemSetReceipt({
      plan: plan(items, {
        itemSourceSha256: digest('wrong-item-source')
      }),
      items
    }),
    /items do not match their source SHA-256/
  );
  assert.throws(
    () => createReceipt(items, {
      activationPolicy: 'activate'
    }),
    /fields must be exact/
  );
});

test('an externally declared empty draft set remains empty and makes no claim', () => {
  const receipt = createReceipt([]);
  assert.equal(receipt.itemCount, 0);
  assert.deepEqual(receipt.itemVersionIds, []);
  assert.deepEqual(receipt.items, []);
});

test('receipts are deterministic, immutable, and preserve caller input', () => {
  const items = [item()];
  const before = structuredClone(items);
  const first = createReceipt(items);
  const second = createReceipt(items);
  assert.deepEqual(first, second);
  assert.deepEqual(items, before);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.items[0]));
  assert.ok(Object.isFrozen(first.items[0].conditionalChecklist[0]));
  assert.throws(() => {
    first.items[0].language = 'changed';
  }, TypeError);
});
