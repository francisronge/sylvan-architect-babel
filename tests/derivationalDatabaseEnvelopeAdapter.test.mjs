import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDurableRecord,
  createEvidenceBoundDurableRecord,
  GENERATION_RECORD_EVIDENCE_SCHEMA_IDENTITY,
  hashDurableRecordData,
  serializeDurableRecord,
  validateEvidenceBoundDurableRecord
} from '../derivationalDatabase/index.js';

const digest = (text) => hashDurableRecordData({ text });

const makeEvidence = () => ({
  generationRecord: {
    schemaIdentity: GENERATION_RECORD_EVIDENCE_SCHEMA_IDENTITY,
    provider: 'Provider Exact',
    model: 'Model Exact',
    effort: 'Effort Exact',
    promptContract: {
      framework: 'Framework Exact',
      promptRoute: 'Route Exact',
      systemInstructionSha256: digest('system'),
      promptSha256: digest('prompt'),
      promptTemplateSha256: digest('template')
    },
    sentConfig: { model: 'Model Exact', outputLimit: 8192 },
    timing: { observedAt: 'opaque-time' },
    tokenUse: { input: 10, output: 20 },
    costEstimate: { label: 'external estimate', value: -0 },
    provenance: { suppliedBy: 'test' }
  },
  reviewState: {
    tier: 'Open Tier',
    reviewerIdentity: 'Reviewer Exact',
    reviewedAt: 'opaque-review-time',
    judgment: 'Open Judgment',
    notes: 'Verbatim notes.',
    provenance: { suppliedBy: 'test' }
  },
  ambiguityGroup: {
    bundleId: 'bundle-exact',
    analysisIndex: 1
  },
  providerNotice: {
    provider: 'Provider Exact',
    noticeRef: 'evidence://notice',
    noticeSha256: digest('notice'),
    quotationRef: 'evidence://quotation',
    quotationSha256: digest('quotation'),
    observedAt: 'opaque-notice-time',
    provenance: { suppliedBy: 'test' }
  }
});

const makeNormalizedDerivation = () => ({
  sentence: 'מה ראתה מיה? 👁️',
  derivationStages: [{
    statement: 'Authored  scalar e\u0301.',
    stageRecord: 'Authored note.',
    relations: [{
      relation: 'Open Relation Ω',
      anchors: [{ role: 'Open Role β', nodeId: 'node-1' }],
      values: { order: ['z', 'a'], number: -0 },
      priorAnchors: [{ role: 'Prior Role', nodeId: 'node-0' }]
    }],
    workspaceForest: [{ nodeId: 'node-1', label: 'XP' }]
  }]
});

const makeInput = () => {
  const evidence = makeEvidence();
  const normalizedDerivation = makeNormalizedDerivation();
  const artifacts = { normalizedDerivation, ...evidence };
  return {
    normalizedDerivation,
    evidence,
    plan: {
      recordId: 'record-exact',
      contractVersion: 'adopted-contract-version-exact',
      contractArtifactRef: 'contract://adopted/exact',
      contractArtifactSha256: digest('contract'),
      engineVersion: 'engine-version-exact',
      frameworkIdentity: evidence.generationRecord.promptContract.framework,
      supersedesRecordId: null,
      artifactBindings: Object.fromEntries(Object.entries(artifacts).map(
        ([artifactName, artifact]) => [artifactName, {
          sourceRef: `artifact://${artifactName}`,
          canonicalSha256: hashDurableRecordData(artifact)
        }]
      )),
      provenance: { suppliedBy: 'test' }
    }
  };
};

test('creates a canonical W17a record only after validating W17b evidence', () => {
  const input = makeInput();
  const before = structuredClone(input);
  const record = createEvidenceBoundDurableRecord(input);
  assert.deepEqual(record.artifacts.normalizedDerivation, input.normalizedDerivation);
  assert.deepEqual(record.artifacts.generationRecord, input.evidence.generationRecord);
  assert.deepEqual(input, before);
  assert.ok(Object.isFrozen(record));
  assert.deepEqual(validateEvidenceBoundDurableRecord(record), record);
});

test('the create and validate paths enforce the same framework join', () => {
  const mismatch = makeInput();
  mismatch.plan.frameworkIdentity = 'Different Framework';
  assert.throws(
    () => createEvidenceBoundDurableRecord(mismatch),
    /plan\.frameworkIdentity must equal generationRecord\.promptContract\.framework/u
  );

  const bareRecord = createDurableRecord({
    plan: mismatch.plan,
    artifacts: {
      normalizedDerivation: mismatch.normalizedDerivation,
      ...mismatch.evidence
    }
  });
  assert.throws(
    () => validateEvidenceBoundDurableRecord(bareRecord),
    /plan\.frameworkIdentity must equal generationRecord\.promptContract\.framework/u
  );
});

test('a structurally valid W17a record still fails malformed W17b evidence', () => {
  const input = makeInput();
  input.evidence.reviewState.releaseReady = true;
  input.plan.artifactBindings.reviewState.canonicalSha256 =
    hashDurableRecordData(input.evidence.reviewState);
  const bareRecord = createDurableRecord({
    plan: input.plan,
    artifacts: {
      normalizedDerivation: input.normalizedDerivation,
      ...input.evidence
    }
  });
  assert.throws(
    () => validateEvidenceBoundDurableRecord(bareRecord),
    /reviewState must contain exactly/u
  );
});

test('artifact bindings remain external and fail on changed validated evidence', () => {
  const input = makeInput();
  input.evidence.reviewState.notes = 'Changed notes.';
  assert.throws(
    () => createEvidenceBoundDurableRecord(input),
    /reviewState canonical SHA-256 does not match its binding/u
  );
});

test('opaque normalized derivations preserve settled open relation fields', () => {
  const input = makeInput();
  const record = createEvidenceBoundDurableRecord(input);
  const relation =
    record.artifacts.normalizedDerivation.derivationStages[0].relations[0];
  assert.equal(relation.relation, 'Open Relation Ω');
  assert.deepEqual(relation.values, { order: ['z', 'a'], number: -0 });
  assert.deepEqual(
    relation.priorAnchors,
    [{ role: 'Prior Role', nodeId: 'node-0' }]
  );
  assert.equal(
    serializeDurableRecord(record),
    serializeDurableRecord(createEvidenceBoundDurableRecord(makeInput()))
  );
});

test('adapter input is exact and adds no integration or policy slot', () => {
  const input = makeInput();
  input.persistToTreeBank = true;
  assert.throws(
    () => createEvidenceBoundDurableRecord(input),
    /recordEnvelopeInput must contain exactly/u
  );
});

test('evidence-bound records are immutable without mutating caller data', () => {
  const input = makeInput();
  const before = structuredClone(input);
  const first = createEvidenceBoundDurableRecord(input);
  const second = createEvidenceBoundDurableRecord(input);
  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first.artifacts.reviewState));
});
