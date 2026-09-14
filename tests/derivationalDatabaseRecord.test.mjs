import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDurableRecord,
  DURABLE_RECORD_ARTIFACT_NAMES,
  DURABLE_RECORD_SCHEMA_IDENTITY,
  hashDurableRecordData,
  parseDurableRecord,
  serializeDurableRecord,
  validateDurableRecord
} from '../derivationalDatabase/index.js';

const digest = (text) => hashDurableRecordData({ text });

const makeArtifacts = () => ({
  normalizedDerivation: {
    sentence: 'מה ראתה מיה? 👁️',
    derivationStages: [{
      statement: 'Authored  spacing and e\u0301 stay exact.',
      stageRecord: 'Authored note.',
      relations: [{
        relation: 'Open Relation Ω',
        anchors: [
          { role: 'unrestricted role β', nodeId: 'node-1' },
          { role: 'unrestricted role α', nodeId: 'node-2' }
        ],
        values: { authoredOrder: ['z', 'a'], number: -0 },
        priorAnchors: [{ role: 'prior role', nodeId: 'node-0' }]
      }],
      workspaceForest: [{ nodeId: 'node-1', label: 'XP' }]
    }]
  },
  generationRecord: {
    promptTemplateSha256: digest('prompt-template'),
    systemInstructionSha256: digest('system-instruction'),
    sentConfig: { carrier: 'externally supplied', stops: ['β', 'α'] },
    provider: 'Provider Exact',
    model: 'Model Exact',
    effort: 'Effort Exact',
    timing: { startedAt: 'opaque-start', endedAt: 'opaque-end' },
    tokenUse: { input: 11, output: 22, reasoning: 33 },
    costEstimate: { label: 'estimate', currency: 'external', value: 1.25 },
    provenance: { suppliedBy: 'test' }
  },
  reviewState: {
    tier: 'open-review-tier',
    reviewerIdentity: 'reviewer-exact',
    reviewedAt: 'opaque-review-time',
    judgment: 'open-judgment',
    notes: 'Authored review note.',
    provenance: { suppliedBy: 'test' }
  },
  ambiguityGroup: {
    bundleId: 'bundle-exact',
    analysisIndex: 2
  },
  providerNotice: {
    provider: 'Provider Exact',
    noticeRef: 'evidence://provider/notice',
    noticeSha256: digest('provider-notice'),
    quotationRef: 'evidence://provider/quotation',
    quotationSha256: digest('provider-quotation'),
    observedAt: 'opaque-notice-time',
    provenance: { suppliedBy: 'test' }
  }
});

const makeInput = () => {
  const artifacts = makeArtifacts();
  return {
    artifacts,
    plan: {
      recordId: 'record-exact',
      contractVersion: 'adopted-contract-version-exact',
      contractArtifactRef: 'contract://adopted/exact',
      contractArtifactSha256: digest('contract-artifact'),
      engineVersion: 'engine-version-exact',
      frameworkIdentity: 'framework-exact',
      supersedesRecordId: null,
      artifactBindings: Object.fromEntries(DURABLE_RECORD_ARTIFACT_NAMES.map(
        (artifactName) => [artifactName, {
          sourceRef: `artifact://${artifactName}`,
          canonicalSha256: hashDurableRecordData(artifacts[artifactName])
        }]
      )),
      provenance: { suppliedBy: 'test', order: ['second', 'first'] }
    }
  };
};

test('creates an immutable hash-bound W17a durable-record envelope', () => {
  const input = makeInput();
  const record = createDurableRecord(input);
  assert.equal(record.schemaIdentity, DURABLE_RECORD_SCHEMA_IDENTITY);
  assert.equal(record.schemaVersion, 1);
  assert.match(record.recordSha256, /^[a-f0-9]{64}$/u);
  assert.equal(record.plan.contractVersion, 'adopted-contract-version-exact');
  assert.equal(record.plan.supersedesRecordId, null);
  assert.ok(Object.isFrozen(record));
  assert.ok(Object.isFrozen(record.plan));
  assert.ok(Object.isFrozen(record.artifacts.normalizedDerivation));
  assert.deepEqual(validateDurableRecord(record), record);
});

test('preserves authored scalars and array order without repair', () => {
  const input = makeInput();
  const original = structuredClone(input.artifacts.normalizedDerivation);
  const record = createDurableRecord(input);
  assert.deepEqual(record.artifacts.normalizedDerivation, original);
  assert.equal(
    record.artifacts.normalizedDerivation.derivationStages[0].statement,
    'Authored  spacing and e\u0301 stay exact.'
  );
  assert.deepEqual(
    record.artifacts.normalizedDerivation
      .derivationStages[0].relations[0].values.authoredOrder,
    ['z', 'a']
  );
  assert.deepEqual(input.artifacts.normalizedDerivation, original);
});

test('canonical native JSON round-trips and ignores only object-key order', () => {
  const input = makeInput();
  const record = createDurableRecord(input);
  const serialized = serializeDurableRecord(record);
  const reordered = {
    artifacts: input.artifacts,
    plan: {
      provenance: input.plan.provenance,
      artifactBindings: input.plan.artifactBindings,
      supersedesRecordId: input.plan.supersedesRecordId,
      frameworkIdentity: input.plan.frameworkIdentity,
      engineVersion: input.plan.engineVersion,
      contractArtifactSha256: input.plan.contractArtifactSha256,
      contractArtifactRef: input.plan.contractArtifactRef,
      contractVersion: input.plan.contractVersion,
      recordId: input.plan.recordId
    }
  };
  assert.equal(
    serializeDurableRecord(createDurableRecord(reordered)),
    serialized
  );
  assert.deepEqual(parseDurableRecord(serialized), record);
  assert.equal(serializeDurableRecord(parseDurableRecord(serialized)), serialized);
});

test('native JSON parsing rejects noncanonical and duplicate-key carriers', () => {
  const serialized = serializeDurableRecord(createDurableRecord(makeInput()));
  assert.throws(
    () => parseDurableRecord(` ${serialized}`),
    /must use canonical native-JSON bytes/u
  );
  assert.throws(
    () => parseDurableRecord(
      serialized.replace(
        '"schemaVersion":1',
        '"schemaVersion":1,"schemaVersion":1'
      )
    ),
    /must use canonical native-JSON bytes/u
  );
});

test('binds every artifact to its externally supplied canonical hash', () => {
  for (const artifactName of DURABLE_RECORD_ARTIFACT_NAMES) {
    const input = makeInput();
    input.plan.artifactBindings[artifactName].canonicalSha256 = digest('wrong');
    assert.throws(
      () => createDurableRecord(input),
      new RegExp(`artifacts\\.${artifactName} canonical SHA-256 does not match`)
    );
  }
});

test('rejects a rehashed artifact when its external binding is stale', () => {
  const input = makeInput();
  const record = createDurableRecord(input);
  const tampered = structuredClone(record);
  tampered.artifacts.normalizedDerivation.sentence = 'Silently changed';
  tampered.recordSha256 = hashDurableRecordData({
    schemaVersion: tampered.schemaVersion,
    schemaIdentity: tampered.schemaIdentity,
    plan: tampered.plan,
    artifacts: tampered.artifacts
  });
  assert.throws(
    () => validateDurableRecord(tampered),
    /normalizedDerivation canonical SHA-256 does not match/u
  );
});

test('rejects record payload tampering even when artifact bindings still match', () => {
  const record = createDurableRecord(makeInput());
  const tampered = structuredClone(record);
  tampered.plan.engineVersion = 'different-engine-version';
  assert.throws(
    () => validateDurableRecord(tampered),
    /record\.recordSha256 does not match/u
  );
});

test('rejects unknown envelope fields and provides no raw-output or policy slot', () => {
  const input = makeInput();
  input.plan.publicationAuthorized = true;
  assert.throws(
    () => createDurableRecord(input),
    /plan must contain exactly/u
  );

  const second = makeInput();
  second.artifacts.rawOutput = 'provider bytes';
  assert.throws(
    () => createDurableRecord(second),
    /artifacts must contain exactly/u
  );
});

test('requires normalized derivations to be objects but leaves their keys open', () => {
  const invalid = makeInput();
  invalid.artifacts.normalizedDerivation = ['not', 'a', 'record'];
  invalid.plan.artifactBindings.normalizedDerivation.canonicalSha256 =
    hashDurableRecordData(invalid.artifacts.normalizedDerivation);
  assert.throws(
    () => createDurableRecord(invalid),
    /artifacts\.normalizedDerivation must be a plain object/u
  );

  const open = makeInput();
  open.artifacts.normalizedDerivation.futureAdoptedField = {
    values: { exact: true },
    priorAnchors: [{ role: 'open', nodeId: 'x' }]
  };
  open.plan.artifactBindings.normalizedDerivation.canonicalSha256 =
    hashDurableRecordData(open.artifacts.normalizedDerivation);
  assert.deepEqual(
    createDurableRecord(open).artifacts.normalizedDerivation.futureAdoptedField,
    open.artifacts.normalizedDerivation.futureAdoptedField
  );
});

test('requires an externally supplied contract artifact and all five bindings', () => {
  const missingContract = makeInput();
  missingContract.plan.contractArtifactSha256 = '';
  assert.throws(
    () => createDurableRecord(missingContract),
    /plan\.contractArtifactSha256 must be a lowercase SHA-256 digest/u
  );

  const missingBinding = makeInput();
  delete missingBinding.plan.artifactBindings.reviewState;
  assert.throws(
    () => createDurableRecord(missingBinding),
    /plan\.artifactBindings must contain exactly/u
  );
});

test('accepts an external prior-record reference but rejects self-supersession', () => {
  const input = makeInput();
  input.plan.supersedesRecordId = 'record-prior';
  assert.equal(
    createDurableRecord(input).plan.supersedesRecordId,
    'record-prior'
  );

  const self = makeInput();
  self.plan.supersedesRecordId = self.plan.recordId;
  assert.throws(
    () => createDurableRecord(self),
    /supersedesRecordId must differ/u
  );
});

test('rejects malformed JSON, non-finite data, cycles, and non-plain objects', () => {
  assert.throws(
    () => parseDurableRecord('{not-json'),
    /must be valid JSON/u
  );

  const nonFinite = makeInput();
  nonFinite.artifacts.generationRecord.tokenUse.output = Number.POSITIVE_INFINITY;
  assert.throws(
    () => createDurableRecord(nonFinite),
    /must be finite JSON data/u
  );

  const cyclic = makeInput();
  cyclic.artifacts.reviewState.provenance.self =
    cyclic.artifacts.reviewState.provenance;
  assert.throws(
    () => createDurableRecord(cyclic),
    /must not contain a cycle/u
  );

  const nonPlain = makeInput();
  nonPlain.artifacts.providerNotice.provenance = new Date();
  assert.throws(
    () => createDurableRecord(nonPlain),
    /must be a plain object/u
  );
});

test('does not mutate caller data while validating a serialized record', () => {
  const record = createDurableRecord(makeInput());
  const decoded = JSON.parse(serializeDurableRecord(record));
  const before = structuredClone(decoded);
  validateDurableRecord(decoded);
  assert.deepEqual(decoded, before);
});
