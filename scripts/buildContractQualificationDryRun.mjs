import fs from 'node:fs';
import path from 'node:path';

import {
  hashQualificationBytes,
  runQualificationAttempt,
  stableQualificationJson,
  validateQualificationPlan
} from '../contractQualification/index.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);

const readArg = (name, fallback = '') => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? String(args[index + 1] || '') : fallback;
};

const planPath = path.resolve(repoRoot, readArg(
  'plan',
  'contractQualification/plumbing-smoke.plan.json'
));
const outputPath = path.resolve(repoRoot, readArg(
  'out',
  '.artifacts/contract-qualification/plumbing-smoke'
));

const resolveRepositoryPath = (relativePath, field) => {
  const absolutePath = path.resolve(repoRoot, relativePath);
  const relative = path.relative(repoRoot, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${field} must stay inside the Babel repository.`);
  }
  return absolutePath;
};

const readJson = (filePath) => JSON.parse(
  fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
);

const rawBytesForAttempt = (attempt) => {
  const sourcePath = resolveRepositoryPath(attempt.source.path, 'attempt.source.path');
  if (attempt.source.kind === 'raw-text-file') return fs.readFileSync(sourcePath);
  const fixture = readJson(sourcePath);
  if (!fixture || typeof fixture.payload !== 'object' || fixture.payload === null) {
    throw new Error(`${attempt.source.path} does not contain a fixture payload.`);
  }
  const payload = `${JSON.stringify(fixture.payload, null, 2)}\n`;
  return Buffer.from(
    attempt.source.kind === 'committed-fixture-payload-missing-final-closer'
      ? payload.replace(/\}\s*$/u, '')
      : payload,
    'utf8'
  );
};

if (fs.existsSync(outputPath) && fs.readdirSync(outputPath).length > 0) {
  throw new Error(`Output directory is not empty: ${path.relative(repoRoot, outputPath)}`);
}

const plan = validateQualificationPlan(readJson(planPath));
const contractManifestPath = resolveRepositoryPath(
  plan.contractManifest,
  'plan.contractManifest'
);
const contractManifestBytes = fs.readFileSync(contractManifestPath);
const contractManifest = JSON.parse(contractManifestBytes.toString('utf8'));
if (!/^[0-9a-f]{64}$/u.test(String(contractManifest.overallSha256 || ''))) {
  throw new Error('Contract manifest is missing overallSha256.');
}
if (contractManifest.qualificationItemSet?.status !== plan.itemSetStatus) {
  throw new Error(
    `Plan itemSetStatus ${plan.itemSetStatus} does not match contract manifest status `
    + `${String(contractManifest.qualificationItemSet?.status || 'missing')}.`
  );
}

fs.mkdirSync(outputPath, { recursive: true });
const attemptsRoot = path.join(outputPath, 'attempts');
fs.mkdirSync(attemptsRoot, { recursive: true });

const attemptReceipts = [];
const reviewEntries = [];
for (const attempt of plan.attempts) {
  const attemptRoot = path.join(attemptsRoot, attempt.id);
  fs.mkdirSync(attemptRoot, { recursive: true });
  const rawBytes = rawBytesForAttempt(attempt);
  const result = runQualificationAttempt({ attempt, rawOutputBytes: rawBytes });
  fs.writeFileSync(path.join(attemptRoot, 'raw-output.txt'), rawBytes);

  const receipt = {
    ...result.receipt,
    rawOutput: {
      ...result.receipt.rawOutput,
      artifact: `attempts/${attempt.id}/raw-output.txt`
    }
  };
  fs.writeFileSync(
    path.join(attemptRoot, 'attempt-receipt.json'),
    stableQualificationJson(receipt),
    'utf8'
  );

  const reviewEntry = {
    attemptId: attempt.id,
    sentence: attempt.request.sentence,
    framework: attempt.request.framework,
    model: attempt.model,
    outcome: receipt.outcome,
    rawOutput: receipt.rawOutput.artifact,
    receipt: `attempts/${attempt.id}/attempt-receipt.json`,
    analyses: []
  };

  if (result.inspection) {
    reviewEntry.inspection = `attempts/${attempt.id}/inspection.json`;
    fs.writeFileSync(path.join(outputPath, reviewEntry.inspection),
      stableQualificationJson(result.inspection), 'utf8');
  }

  if (result.bundle) {
    const bundleWrapper = {
      request: {
        sentence: attempt.request.sentence,
        framework: attempt.request.framework,
        modelRoute: attempt.model.providerRoute,
        reasoningEffort: Object.values(attempt.model.nativeSettings)[0] || ''
      },
      response: result.bundle
    };
    fs.writeFileSync(
      path.join(attemptRoot, 'bundle.json'),
      stableQualificationJson(bundleWrapper),
      'utf8'
    );
    result.replayProjections.forEach((projection, analysisIndex) => {
      const replayArtifact = `attempts/${attempt.id}/replay-analysis-${analysisIndex + 1}.json`;
      const evidenceArtifact = `attempts/${attempt.id}/evidence-analysis-${analysisIndex + 1}.json`;
      fs.writeFileSync(
        path.join(outputPath, replayArtifact),
        stableQualificationJson(projection),
        'utf8'
      );
      fs.writeFileSync(
        path.join(outputPath, evidenceArtifact),
        stableQualificationJson(result.analysisEvidence[analysisIndex]),
        'utf8'
      );
      reviewEntry.analyses.push({
        analysisIndex,
        replay: replayArtifact,
        evidence: evidenceArtifact,
        output: `review/${attempt.id}/analysis-${analysisIndex + 1}`
      });
    });
    reviewEntry.bundle = `attempts/${attempt.id}/bundle.json`;
  }

  reviewEntries.push(reviewEntry);
  attemptReceipts.push(receipt);
}

const runReceiptBase = {
  schemaVersion: 1,
  plan,
  contract: {
    manifest: plan.contractManifest,
    manifestSha256: hashQualificationBytes(contractManifestBytes),
    overallSha256: contractManifest.overallSha256,
    repositoryCommit: contractManifest.repositoryCommit,
    qualificationItemSet: contractManifest.qualificationItemSet
  },
  attempts: attemptReceipts.map((receipt) => ({
    attemptId: receipt.attemptId,
    receiptSha256: receipt.receiptSha256,
    outcome: receipt.outcome
  })),
  review: {
    status: 'not-captured',
    attemptCount: reviewEntries.length,
    analysisCount: reviewEntries.reduce((count, entry) => count + entry.analyses.length, 0),
    manifest: 'review-manifest.json'
  },
  providerCallsMade: false
};
const runReceipt = {
  ...runReceiptBase,
  receiptSha256: hashQualificationBytes(Buffer.from(JSON.stringify(runReceiptBase), 'utf8'))
};

fs.writeFileSync(
  path.join(outputPath, 'review-manifest.json'),
  stableQualificationJson({ schemaVersion: 1, entries: reviewEntries }),
  'utf8'
);
fs.writeFileSync(
  path.join(outputPath, 'run-receipt.json'),
  stableQualificationJson(runReceipt),
  'utf8'
);

console.log(path.relative(repoRoot, path.join(outputPath, 'run-receipt.json')));
console.log(runReceipt.receiptSha256);
