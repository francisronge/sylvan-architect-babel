import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  createEvidenceBoundDurableRecord,
  createNativeRecordExport,
  GENERATION_RECORD_EVIDENCE_SCHEMA_IDENTITY,
  hashDurableRecordData,
  validateNativeRecordExport
} from '../derivationalDatabase/index.js';

const digest = (text) => hashDurableRecordData({ text });
const hashUtf8 = (text) => createHash('sha256')
  .update(text, 'utf8')
  .digest('hex');

const makeRecord = () => {
  const normalizedDerivation = {
    sentence: 'Mía laughed. 👁️',
    derivationStages: [{
      statement: 'Authored  scalar e\u0301.',
      stageRecord: 'Authored note.',
      relations: [{
        relation: 'Open Relation Ω',
        anchors: [{ role: 'Open Role β', nodeId: 'node-1' }],
        values: { ordered: ['z', 'a'], signed: -0 },
        priorAnchors: [{ role: 'Prior Role', nodeId: 'node-0' }]
      }],
      workspaceForest: [{ nodeId: 'node-1', label: 'XP' }]
    }]
  };
  const evidence = {
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
      tier: null,
      reviewerIdentity: null,
      reviewedAt: null,
      judgment: null,
      notes: null,
      provenance: { suppliedBy: 'test' }
    },
    ambiguityGroup: {
      bundleId: 'bundle-exact',
      analysisIndex: 0
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
  };
  const artifacts = { normalizedDerivation, ...evidence };
  return createEvidenceBoundDurableRecord({
    normalizedDerivation,
    evidence,
    plan: {
      recordId: 'record-exact',
      contractVersion: 'adopted-contract-version-exact',
      contractArtifactRef: 'contract://adopted/exact',
      contractArtifactSha256: digest('contract'),
      engineVersion: 'engine-version-exact',
      frameworkIdentity: 'Framework Exact',
      supersedesRecordId: null,
      artifactBindings: Object.fromEntries(Object.entries(artifacts).map(
        ([artifactName, artifact]) => [artifactName, {
          sourceRef: `artifact://${artifactName}`,
          canonicalSha256: hashDurableRecordData(artifact)
        }]
      )),
      provenance: { suppliedBy: 'test' }
    }
  });
};

test('exports the canonical native JSON bytes of a complete W17 record', () => {
  const record = makeRecord();
  const artifact = createNativeRecordExport(record);
  assert.equal(artifact.mediaType, 'application/json');
  assert.equal(artifact.encoding, 'utf-8');
  assert.equal(artifact.recordSha256, record.recordSha256);
  assert.equal(JSON.parse(artifact.body).recordSha256, record.recordSha256);
  assert.deepEqual(validateNativeRecordExport(artifact), artifact);
});

test('the sole full-record carrier preserves authored relation data exactly', () => {
  const artifact = createNativeRecordExport(makeRecord());
  const relation =
    JSON.parse(artifact.body).artifacts.normalizedDerivation
      .derivationStages[0].relations[0];
  assert.equal(relation.relation, 'Open Relation Ω');
  assert.deepEqual(relation.values.ordered, ['z', 'a']);
  assert.equal(Object.is(relation.values.signed, -0), true);
  assert.deepEqual(
    relation.priorAnchors,
    [{ nodeId: 'node-0', role: 'Prior Role' }]
  );
  assert.match(artifact.body, /"signed":-0/u);
});

test('raw byte and record bindings both fail closed', () => {
  const artifact = createNativeRecordExport(makeRecord());
  assert.throws(
    () => validateNativeRecordExport({
      ...artifact,
      body: artifact.body.replace('Mía', 'Mia')
    }),
    /bodySha256 does not match/u
  );
  assert.throws(
    () => validateNativeRecordExport({
      ...artifact,
      recordSha256: digest('different record')
    }),
    /recordSha256 does not match/u
  );
});

test('the export validator rejects noncanonical or malformed record bytes', () => {
  const artifact = createNativeRecordExport(makeRecord());
  const noncanonicalBody = ` ${artifact.body}`;
  const noncanonical = {
    ...artifact,
    body: noncanonicalBody,
    bodySha256: hashUtf8(noncanonicalBody)
  };
  assert.throws(
    () => validateNativeRecordExport(noncanonical),
    /canonical native-JSON bytes/u
  );
});

test('export metadata is exact and cannot become a publication policy', () => {
  const artifact = createNativeRecordExport(makeRecord());
  assert.throws(
    () => validateNativeRecordExport({ ...artifact, publish: true }),
    /nativeRecordExport must contain exactly/u
  );
  assert.throws(
    () => validateNativeRecordExport({ ...artifact, mediaType: 'text/xml' }),
    /mediaType must equal application\/json/u
  );
});

test('exports are deterministic, immutable, and do not mutate records', () => {
  const record = makeRecord();
  const before = structuredClone(record);
  const first = createNativeRecordExport(record);
  const second = createNativeRecordExport(record);
  assert.deepEqual(record, before);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
});
