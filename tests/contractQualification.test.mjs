import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

import {
  runQualificationAttempt,
  validateQualificationPlan
} from '../contractQualification/index.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const fixture = JSON.parse(
  fs.readFileSync(new URL('../fixtures/raw/mia-laughed.xbar.json', import.meta.url), 'utf8')
);

const frozenItemSet = JSON.parse(
  fs.readFileSync(
    new URL('../contractQualification/program-1.item-set.json', import.meta.url),
    'utf8'
  )
);

const plan = (overrides = {}) => ({
  schemaVersion: 1,
  label: 'plumbing-only',
  purpose: 'Test the qualification runner without selecting qualification items.',
  itemSetStatus: 'unselected',
  contractManifest: 'docs/implementation/contract-qualification/example.json',
  attempts: [
    {
      id: 'attempt-1',
      request: { sentence: fixture.sentence, framework: fixture.framework },
      model: {
        catalogId: 'openai:gpt-5.6-sol',
        nativeSettings: { 'reasoning.effort': 'high' }
      },
      source: {
        kind: 'committed-fixture-payload',
        path: 'fixtures/raw/mia-laughed.xbar.json'
      }
    }
  ],
  ...overrides
});

test('the frozen Program 1 item set preserves the approved qualification design', () => {
  assert.equal(frozenItemSet.schemaVersion, 1);
  assert.equal(frozenItemSet.status, 'frozen');
  assert.equal(frozenItemSet.admission.runsFor, 'every-candidate');
  assert.equal(frozenItemSet.admission.items.length, 2);

  const admissionRequests = frozenItemSet.admission.items.map(({ sentence, framework }) => ({
    sentence,
    framework
  }));
  assert.deepEqual(admissionRequests, [
    { sentence: 'Which book did John buy?', framework: 'minimalism' },
    { sentence: 'Which book did John buy?', framework: 'xbar' }
  ]);

  const qualificationItems = frozenItemSet.qualification.items;
  assert.equal(qualificationItems.length, 14);
  assert.equal(
    qualificationItems.filter(({ framework }) => framework === 'minimalism').length,
    7
  );
  assert.equal(
    qualificationItems.filter(({ framework }) => framework === 'xbar').length,
    7
  );
  assert.equal(
    qualificationItems.filter(({ cohort }) => cohort === 'shared-core').length,
    5
  );
  assert.equal(
    qualificationItems.filter(({ cohort }) => cohort === 'finalist-only').length,
    9
  );
  assert.equal(new Set(qualificationItems.map(({ id }) => id)).size, 14);
  assert.ok(frozenItemSet.interpretation.itemsDoNotPrescribeRelations);
  assert.ok(frozenItemSet.interpretation.rendererCoverageUsesActualDispatch);
});

test('qualification plans distinguish plumbing smoke data from a selected item set', () => {
  const validated = validateQualificationPlan(plan());
  assert.equal(validated.itemSetStatus, 'unselected');
  assert.equal(validated.attempts[0].model.providerModel, 'gpt-5.6-sol');
  assert.equal(validated.attempts[0].model.qualificationStatus, 'unqualified');

  assert.throws(
    () => validateQualificationPlan(plan({ itemSetStatus: 'approved' })),
    /itemSetStatus/
  );
  assert.throws(
    () => validateQualificationPlan({ ...plan(), hiddenDefault: true }),
    /fields must be exactly/
  );
});

test('qualification plans preserve the exact submitted sentence', () => {
  const input = plan();
  input.attempts[0].request.sentence = '  Mia laughed.\n';
  const validated = validateQualificationPlan(input);
  assert.equal(validated.attempts[0].request.sentence, '  Mia laughed.\n');
});

test('a valid saved response preserves raw bytes and prepares every analysis for review', () => {
  const [attempt] = validateQualificationPlan(plan()).attempts;
  const rawText = `  ${JSON.stringify(fixture.payload)}\n`;
  const result = runQualificationAttempt({
    attempt,
    rawOutputBytes: Buffer.from(rawText, 'utf8')
  });

  assert.equal(result.receipt.rawOutput.byteLength, Buffer.byteLength(rawText));
  assert.equal(result.receipt.rawOutput.sha256, sha256(rawText));
  assert.deepEqual(result.receipt.outcome, {
    reviewDisposition: 'unreviewed',
    status: 'valid-pending-review'
  });
  assert.equal(result.bundle.analyses.length, 1);
  assert.equal(result.analysisBundles.length, 1);
  assert.equal(result.replayProjections.length, 1);
  assert.equal(result.analysisEvidence.length, 1);
  assert.ok(result.replayProjections[0].stepCount > 0);
  assert.equal(
    result.analysisEvidence[0].replay.frameCount,
    result.replayProjections[0].stepCount
  );
  assert.equal(
    Object.values(result.analysisEvidence[0].renderer.tierCounts)
      .reduce((sum, count) => sum + count, 0),
    result.analysisEvidence[0].renderer.relations
      .reduce((sum, relation) => sum + relation.claims.length, 0)
  );
  assert.match(result.receipt.artifacts.analyses[0].evidenceSha256, /^[0-9a-f]{64}$/u);
  assert.equal(result.bundle.modelUsed, 'gpt-5.6-sol');
  assert.equal(result.bundle.analyses[0].provenance.timestamp, undefined);
});

test('JSON repairs and typed failures remain visible in qualification receipts', () => {
  const [attempt] = validateQualificationPlan(plan()).attempts;
  const valid = JSON.stringify(fixture.payload);
  const repaired = runQualificationAttempt({
    attempt,
    rawOutputBytes: Buffer.from(valid.slice(0, -1), 'utf8')
  });
  assert.equal(repaired.receipt.outcome.status, 'valid-pending-review');
  assert.deepEqual(repaired.receipt.ingress.integrityFlags, ['json_delimiter_damage_repaired']);
  assert.equal(
    repaired.receipt.ingress.repairDiagnostics[0].kind,
    'append_closers_at_end_of_output'
  );

  const malformed = runQualificationAttempt({
    attempt,
    rawOutputBytes: Buffer.from('{not-json', 'utf8')
  });
  assert.equal(malformed.receipt.outcome.status, 'failed');
  assert.equal(malformed.receipt.outcome.phase, 'json-ingress');
  assert.equal(malformed.receipt.outcome.failure.class, 'transport_serialization');
  assert.deepEqual(malformed.analysisEvidence, []);

  const wrongEnvelope = runQualificationAttempt({
    attempt,
    rawOutputBytes: Buffer.from('{"other":true}', 'utf8')
  });
  assert.equal(wrongEnvelope.receipt.outcome.status, 'failed');
  assert.equal(wrongEnvelope.receipt.outcome.phase, 'normalization');
  assert.equal(wrongEnvelope.receipt.outcome.failure.class, 'contract_misunderstanding');
  assert.deepEqual(wrongEnvelope.analysisEvidence, []);
});

test('non-UTF-8 output fails before JSON parsing without changing the bytes', () => {
  const [attempt] = validateQualificationPlan(plan()).attempts;
  const bytes = Buffer.from([0xff, 0xfe, 0xfd]);
  const result = runQualificationAttempt({ attempt, rawOutputBytes: bytes });
  assert.equal(result.receipt.rawOutput.sha256, sha256(bytes));
  assert.equal(result.receipt.outcome.phase, 'transport');
  assert.equal(result.receipt.outcome.failure.class, 'transport_serialization');
});
