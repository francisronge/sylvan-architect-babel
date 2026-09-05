import { createHash } from 'node:crypto';

import { __test__ as parserTest } from '../server/babelParser.js';
import { resolveResearchModelSelection } from '../server/babelParser/researchModelCatalog.js';
import {
  FAILURE_CLASSES,
  FAILURE_RULES,
  createFailure
} from '../server/babelParser/validationErrors.js';
import { buildReplaySnapshotProjection } from '../replay/replaySnapshot.ts';
import { buildQualificationAnalysisEvidence } from './review.js';

export const QUALIFICATION_ITEM_SET_STATUSES = Object.freeze([
  'unselected',
  'selected-draft',
  'frozen'
]);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => typeof value[key] !== 'undefined')
      .map((key) => [key, canonicalize(value[key])])
  );
};

export const stableQualificationJson = (value) =>
  `${JSON.stringify(canonicalize(value), null, 2)}\n`;

const receiptWithHash = (value) => {
  const stable = canonicalize(value);
  return Object.freeze({
    ...stable,
    receiptSha256: sha256(Buffer.from(JSON.stringify(stable), 'utf8'))
  });
};

const requireNonemptyString = (value, path) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${path} must be a non-empty string.`);
  }
  return value.trim();
};

const requireExactSentence = (value, path) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${path} must be a non-empty string.`);
  }
  return value;
};

const requireExactFields = (value, fields, path) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const expected = [...fields].sort();
  const observed = Object.keys(value).sort();
  if (JSON.stringify(expected) !== JSON.stringify(observed)) {
    throw new TypeError(`${path} fields must be exactly: ${expected.join(', ')}.`);
  }
};

export const validateQualificationPlan = (input) => {
  requireExactFields(
    input,
    ['schemaVersion', 'label', 'purpose', 'itemSetStatus', 'contractManifest', 'attempts'],
    'plan'
  );
  if (input.schemaVersion !== 1) throw new TypeError('plan.schemaVersion must be 1.');
  const label = requireNonemptyString(input.label, 'plan.label');
  const purpose = requireNonemptyString(input.purpose, 'plan.purpose');
  if (!QUALIFICATION_ITEM_SET_STATUSES.includes(input.itemSetStatus)) {
    throw new TypeError(
      `plan.itemSetStatus must be one of: ${QUALIFICATION_ITEM_SET_STATUSES.join(', ')}.`
    );
  }
  const contractManifest = requireNonemptyString(
    input.contractManifest,
    'plan.contractManifest'
  );
  if (!Array.isArray(input.attempts) || input.attempts.length === 0) {
    throw new TypeError('plan.attempts must be a non-empty array.');
  }

  const seenIds = new Set();
  const attempts = input.attempts.map((attempt, index) => {
    const path = `plan.attempts[${index}]`;
    requireExactFields(attempt, ['id', 'request', 'model', 'source'], path);
    const id = requireNonemptyString(attempt.id, `${path}.id`);
    if (seenIds.has(id)) throw new TypeError(`Duplicate attempt id: ${id}.`);
    seenIds.add(id);

    requireExactFields(attempt.request, ['sentence', 'framework'], `${path}.request`);
    const sentence = requireExactSentence(attempt.request.sentence, `${path}.request.sentence`);
    if (!['xbar', 'minimalism'].includes(attempt.request.framework)) {
      throw new TypeError(`${path}.request.framework must be xbar or minimalism.`);
    }

    requireExactFields(attempt.model, ['catalogId', 'nativeSettings'], `${path}.model`);
    const selection = resolveResearchModelSelection(
      attempt.model.catalogId,
      attempt.model.nativeSettings
    );

    requireExactFields(attempt.source, ['kind', 'path'], `${path}.source`);
    if (![
      'committed-fixture-payload',
      'committed-fixture-payload-missing-final-closer',
      'raw-text-file'
    ].includes(attempt.source.kind)) {
      throw new TypeError(
        `${path}.source.kind must name a supported saved-output source.`
      );
    }

    return {
      id,
      request: {
        sentence,
        framework: attempt.request.framework
      },
      model: selection,
      source: {
        kind: attempt.source.kind,
        path: requireNonemptyString(attempt.source.path, `${path}.source.path`)
      }
    };
  });

  return Object.freeze({
    schemaVersion: 1,
    label,
    purpose,
    itemSetStatus: input.itemSetStatus,
    contractManifest,
    attempts
  });
};

const stripVolatileProvenance = (bundle) => {
  const copy = structuredClone(bundle);
  for (const analysis of copy.analyses || []) {
    if (!analysis.provenance || typeof analysis.provenance !== 'object') continue;
    delete analysis.provenance.timestamp;
    delete analysis.provenance.promptVersion;
    delete analysis.provenance.parserVersion;
    delete analysis.provenance.uiVersion;
  }
  return copy;
};

const normalizeFailure = (error) => {
  if (error?.failure && typeof error.failure === 'object') return error.failure;
  return createFailure({
    failureClass: FAILURE_CLASSES.DETERMINISTIC_ENGINE_FAILURE,
    ruleId: FAILURE_RULES.DETERMINISTIC_ENGINE,
    fieldPath: '$',
    offendingValue: String(error?.message || error || 'Unknown qualification failure')
  });
};

const invalidUtf8Failure = () => createFailure({
  failureClass: FAILURE_CLASSES.TRANSPORT_SERIALIZATION,
  ruleId: FAILURE_RULES.TRANSPORT_JSON_OBJECT,
  fieldPath: '$',
  offendingValue: 'Raw provider output is not valid UTF-8.'
});

export const runQualificationAttempt = ({ attempt, rawOutputBytes }) => {
  const rawBytes = Buffer.isBuffer(rawOutputBytes)
    ? Buffer.from(rawOutputBytes)
    : Buffer.from(rawOutputBytes || []);
  const rawOutput = rawBytes.toString('utf8');
  const rawOutputArtifact = {
    byteLength: rawBytes.byteLength,
    sha256: sha256(rawBytes)
  };
  const base = {
    schemaVersion: 1,
    attemptId: attempt.id,
    request: attempt.request,
    model: attempt.model,
    source: attempt.source,
    rawOutput: rawOutputArtifact
  };

  if (!Buffer.from(rawOutput, 'utf8').equals(rawBytes)) {
    return {
      receipt: receiptWithHash({
        ...base,
        ingress: { integrityFlags: [], repairDiagnostics: [] },
        outcome: {
          status: 'failed',
          phase: 'transport',
          failure: invalidUtf8Failure()
        }
      }),
      bundle: null,
      analysisBundles: [],
      replayProjections: [],
      analysisEvidence: []
    };
  }

  let ingress = { integrityFlags: [], repairDiagnostics: [] };
  let phase = 'json-ingress';
  try {
    const parsed = parserTest.parseModelJsonDetailed(rawOutput);
    ingress = {
      integrityFlags: Array.isArray(parsed.integrityFlags) ? parsed.integrityFlags : [],
      repairDiagnostics: Array.isArray(parsed.repairDiagnostics)
        ? parsed.repairDiagnostics
        : []
    };
    phase = 'normalization';
    const reasoningSetting = Object.values(attempt.model.nativeSettings)[0] || '';
    const normalized = stripVolatileProvenance(parserTest.normalizeParseBundle(
      parsed.payload,
      attempt.request.framework,
      attempt.request.sentence,
      attempt.model.providerRoute,
      true,
      {
        payloadIntegrityFlags: ingress.integrityFlags,
        payloadRepairDiagnostics: ingress.repairDiagnostics
      }
    ));
    const bundle = {
      ...normalized,
      sentence: attempt.request.sentence,
      requestedModelRoute: attempt.model.providerRoute,
      requestedReasoningEffort: reasoningSetting,
      modelUsed: attempt.model.providerModel
    };
    const analysisBundles = bundle.analyses.map((analysis) => ({
      ...bundle,
      analyses: [analysis],
      ambiguityDetected: false,
      ambiguityNote: undefined
    }));
    phase = 'evidence-compilation';
    const replayProjections = analysisBundles.map((analysisBundle) =>
      buildReplaySnapshotProjection(analysisBundle)
    );
    const analysisEvidence = analysisBundles.map((analysisBundle) =>
      buildQualificationAnalysisEvidence(analysisBundle)
    );
    const bundleBytes = Buffer.from(stableQualificationJson(bundle), 'utf8');
    const analysisArtifacts = analysisBundles.map((analysisBundle, index) => ({
      analysisIndex: index,
      bundleSha256: sha256(Buffer.from(stableQualificationJson(analysisBundle), 'utf8')),
      replaySha256: sha256(Buffer.from(stableQualificationJson(replayProjections[index]), 'utf8')),
      replayStepCount: replayProjections[index].stepCount,
      evidenceSha256: sha256(Buffer.from(stableQualificationJson(analysisEvidence[index]), 'utf8')),
      tierCounts: analysisEvidence[index].renderer.tierCounts
    }));
    return {
      receipt: receiptWithHash({
        ...base,
        ingress,
        artifacts: {
          bundleSha256: sha256(bundleBytes),
          analysisCount: analysisBundles.length,
          analyses: analysisArtifacts
        },
        outcome: {
          status: 'valid-pending-review',
          reviewDisposition: 'unreviewed'
        }
      }),
      bundle,
      analysisBundles,
      replayProjections,
      analysisEvidence
    };
  } catch (error) {
    const repairDiagnostics = Array.isArray(error?.details?.payloadRepairDiagnostics)
      ? error.details.payloadRepairDiagnostics
      : ingress.repairDiagnostics;
    return {
      receipt: receiptWithHash({
        ...base,
        ingress: {
          integrityFlags: ingress.integrityFlags,
          repairDiagnostics
        },
        outcome: {
          status: 'failed',
          phase: error?.failure?.class === FAILURE_CLASSES.TRANSPORT_SERIALIZATION
            ? 'json-ingress'
            : phase,
          failure: normalizeFailure(error)
        }
      }),
      bundle: null,
      analysisBundles: [],
      replayProjections: [],
      analysisEvidence: []
    };
  }
};

export const hashQualificationBytes = sha256;
