import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GENERATION_RECORD_EVIDENCE_SCHEMA_IDENTITY,
  hashDurableRecordData,
  RECORD_EVIDENCE_ARTIFACT_NAMES,
  validateAmbiguityGroupEvidence,
  validateGenerationRecordEvidence,
  validateProviderNoticeEvidence,
  validateRecordEvidenceArtifacts,
  validateReviewStateEvidence
} from '../derivationalDatabase/index.js';

const digest = (text) => hashDurableRecordData({ text });

const makeArtifacts = () => ({
  generationRecord: {
    schemaIdentity: GENERATION_RECORD_EVIDENCE_SCHEMA_IDENTITY,
    provider: 'Provider Verbatim',
    model: 'Model Verbatim',
    effort: 'Effort Verbatim',
    promptContract: {
      framework: 'Open Framework',
      promptRoute: 'Open Route',
      systemInstructionSha256: digest('system instruction'),
      promptSha256: digest('prompt'),
      promptTemplateSha256: digest('prompt template')
    },
    sentConfig: {
      model: 'Model Verbatim',
      maxOutputTokens: 12345,
      providerSpecificFlag: true,
      optionalSetting: null
    },
    timing: {
      requestStartedAt: 'opaque-start',
      durationMs: 12.5
    },
    tokenUse: {
      input: 10,
      output: 20,
      reasoning: 30
    },
    costEstimate: {
      label: 'externally-labeled estimate',
      currency: 'external-unit',
      value: 1.25
    },
    provenance: {
      suppliedBy: 'test'
    }
  },
  reviewState: {
    tier: 'Open Review Tier',
    reviewerIdentity: 'Reviewer Verbatim',
    reviewedAt: 'opaque-review-time',
    judgment: 'Open Judgment',
    notes: 'Authored  review note e\u0301.',
    provenance: { suppliedBy: 'test' }
  },
  ambiguityGroup: {
    bundleId: 'bundle-verbatim',
    analysisIndex: 2
  },
  providerNotice: {
    provider: 'Provider Verbatim',
    noticeRef: 'evidence://provider/notice',
    noticeSha256: digest('notice'),
    quotationRef: 'evidence://provider/quotation',
    quotationSha256: digest('quotation'),
    observedAt: 'opaque-notice-time',
    provenance: { suppliedBy: 'test' }
  }
});

test('validates all four record-evidence artifacts as immutable exact copies', () => {
  const input = makeArtifacts();
  const before = structuredClone(input);
  const validated = validateRecordEvidenceArtifacts(input);
  assert.deepEqual(validated, before);
  assert.deepEqual(input, before);
  assert.deepEqual(Object.keys(validated), RECORD_EVIDENCE_ARTIFACT_NAMES);
  assert.ok(Object.isFrozen(validated));
  assert.ok(Object.isFrozen(validated.generationRecord.promptContract));
  assert.ok(Object.isFrozen(validated.reviewState.provenance));
});

test('preserves open provider, model, effort, framework, and route identities', () => {
  const record = makeArtifacts().generationRecord;
  record.provider = '未来 Provider';
  record.model = 'Model Ω';
  record.effort = null;
  record.promptContract.framework = 'Framework β';
  record.promptContract.promptRoute = 'Route α';
  record.sentConfig.model = record.model;
  const validated = validateGenerationRecordEvidence(record);
  assert.equal(validated.provider, '未来 Provider');
  assert.equal(validated.model, 'Model Ω');
  assert.equal(validated.effort, null);
  assert.equal(validated.promptContract.framework, 'Framework β');
  assert.equal(validated.promptContract.promptRoute, 'Route α');
});

test('generation evidence requires exact prompt hashes and no extra fields', () => {
  const wrongSchema = makeArtifacts().generationRecord;
  wrongSchema.schemaIdentity = 'other-generation-schema';
  assert.throws(
    () => validateGenerationRecordEvidence(wrongSchema),
    /generationRecord\.schemaIdentity must equal/u
  );

  const badHash = makeArtifacts().generationRecord;
  badHash.promptContract.promptSha256 = 'not-a-digest';
  assert.throws(
    () => validateGenerationRecordEvidence(badHash),
    /promptContract\.promptSha256 must be a lowercase SHA-256 digest/u
  );

  const extra = makeArtifacts().generationRecord;
  extra.publicationAuthorized = true;
  assert.throws(
    () => validateGenerationRecordEvidence(extra),
    /generationRecord must contain exactly/u
  );
});

test('sent configuration remains scalar, finite, and model-consistent', () => {
  const missingModel = makeArtifacts().generationRecord;
  delete missingModel.sentConfig.model;
  assert.throws(
    () => validateGenerationRecordEvidence(missingModel),
    /sentConfig must contain its externally sent model/u
  );

  const nested = makeArtifacts().generationRecord;
  nested.sentConfig.providerOptions = { hidden: true };
  assert.throws(
    () => validateGenerationRecordEvidence(nested),
    /sentConfig\.providerOptions must be a JSON scalar/u
  );

  const nonFinite = makeArtifacts().generationRecord;
  nonFinite.sentConfig.maxOutputTokens = Number.POSITIVE_INFINITY;
  assert.throws(
    () => validateGenerationRecordEvidence(nonFinite),
    /sentConfig\.maxOutputTokens must be finite/u
  );

  const mismatch = makeArtifacts().generationRecord;
  mismatch.sentConfig.model = 'Different Model';
  assert.throws(
    () => validateGenerationRecordEvidence(mismatch),
    /sentConfig\.model must equal generationRecord\.model/u
  );
});

test('timing, token use, cost estimate, and provenance remain external JSON', () => {
  const record = makeArtifacts().generationRecord;
  record.timing = { opaqueClock: ['first', 'second'] };
  record.tokenUse = { providerShape: { input: 1, cached: 2 } };
  record.costEstimate = {
    label: 'externally-labeled method',
    externalMethod: 'method-x',
    amount: -0
  };
  record.provenance = { sourceRefs: ['b', 'a'] };
  const validated = validateGenerationRecordEvidence(record);
  assert.deepEqual(validated.timing, record.timing);
  assert.deepEqual(validated.tokenUse, record.tokenUse);
  assert.deepEqual(validated.costEstimate, record.costEstimate);
  assert.deepEqual(validated.provenance, record.provenance);

  const unlabeled = makeArtifacts().generationRecord;
  delete unlabeled.costEstimate.label;
  assert.throws(
    () => validateGenerationRecordEvidence(unlabeled),
    /costEstimate\.label must be a nonempty string/u
  );
});

test('review labels stay open and nullable without creating workflow states', () => {
  const open = makeArtifacts().reviewState;
  open.tier = 'Open Tier Ω';
  open.judgment = 'Open Judgment β';
  assert.deepEqual(validateReviewStateEvidence(open), open);

  const unreviewed = makeArtifacts().reviewState;
  unreviewed.tier = null;
  unreviewed.reviewerIdentity = null;
  unreviewed.reviewedAt = null;
  unreviewed.judgment = null;
  unreviewed.notes = null;
  assert.deepEqual(validateReviewStateEvidence(unreviewed), unreviewed);
});

test('review state rejects policy extras and non-string authored notes', () => {
  const policy = makeArtifacts().reviewState;
  policy.releaseReady = true;
  assert.throws(
    () => validateReviewStateEvidence(policy),
    /reviewState must contain exactly/u
  );

  const notes = makeArtifacts().reviewState;
  notes.notes = ['rewritten', 'notes'];
  assert.throws(
    () => validateReviewStateEvidence(notes),
    /reviewState\.notes must be a string or null/u
  );
});

test('ambiguity grouping requires a stable bundle and nonnegative safe index', () => {
  assert.deepEqual(
    validateAmbiguityGroupEvidence(makeArtifacts().ambiguityGroup),
    makeArtifacts().ambiguityGroup
  );
  for (const analysisIndex of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const group = makeArtifacts().ambiguityGroup;
    group.analysisIndex = analysisIndex;
    assert.throws(
      () => validateAmbiguityGroupEvidence(group),
      /analysisIndex must be a nonnegative safe integer/u
    );
  }
});

test('provider notice is dated hash evidence, not a legal conclusion', () => {
  const notice = makeArtifacts().providerNotice;
  assert.deepEqual(validateProviderNoticeEvidence(notice), notice);

  const legal = makeArtifacts().providerNotice;
  legal.licenseApproved = true;
  assert.throws(
    () => validateProviderNoticeEvidence(legal),
    /providerNotice must contain exactly/u
  );

  const badHash = makeArtifacts().providerNotice;
  badHash.quotationSha256 = 'wrong';
  assert.throws(
    () => validateProviderNoticeEvidence(badHash),
    /quotationSha256 must be a lowercase SHA-256 digest/u
  );
});

test('aggregate evidence requires all four exact artifact identities', () => {
  const missing = makeArtifacts();
  delete missing.reviewState;
  assert.throws(
    () => validateRecordEvidenceArtifacts(missing),
    /recordEvidence must contain exactly/u
  );

  const extra = makeArtifacts();
  extra.normalizedDerivation = {};
  assert.throws(
    () => validateRecordEvidenceArtifacts(extra),
    /recordEvidence must contain exactly/u
  );

  const providerMismatch = makeArtifacts();
  providerMismatch.providerNotice.provider = 'Different Provider';
  assert.throws(
    () => validateRecordEvidenceArtifacts(providerMismatch),
    /providerNotice\.provider must equal generationRecord\.provider/u
  );
});

test('non-JSON evidence fails without mutating the caller', () => {
  const cyclic = makeArtifacts();
  cyclic.generationRecord.provenance.self =
    cyclic.generationRecord.provenance;
  assert.throws(
    () => validateRecordEvidenceArtifacts(cyclic),
    /must not contain a cycle/u
  );

  const nonPlain = makeArtifacts();
  nonPlain.providerNotice.provenance = new Date();
  assert.throws(
    () => validateRecordEvidenceArtifacts(nonPlain),
    /must be a plain object/u
  );
});
