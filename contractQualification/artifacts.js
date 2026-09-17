import fs from 'node:fs';
import path from 'node:path';
import { runQualificationAttempt, stableQualificationJson } from './run.js';

// Both saved-response and subscription runs use the same normalization and review artifacts.
export const writeQualificationAttempt = ({ outputPath, attempt, rawBytes }) => {
  const attemptRoot = path.join(outputPath, 'attempts', attempt.id);
  fs.mkdirSync(attemptRoot, { recursive: true });
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

  return { receipt, reviewEntry };
};
