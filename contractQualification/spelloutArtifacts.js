import fs from 'node:fs';
import path from 'node:path';

import { parseModelJsonDetailed } from '../server/babelParser/modelJson.js';
import { createFailure } from '../server/babelParser/validationErrors.js';
import { writeQualificationAttempt } from './artifacts.js';
import { hashQualificationBytes, stableQualificationJson } from './run.js';
import { SPELLOUT_CONTRACT_VERSION, convertSpelloutPayload, planSpelloutAttempts } from './spelloutContract.js';

/**
 * Processes a completed spell-out response. Babel's own JSON ingress reads the
 * model text; each converted segmentation then becomes an ordinary
 * qualification attempt, so the unchanged parser, Replay and review apply.
 * spellout.json keeps the conversion evidence: words, aligned spans, tokens,
 * observations and the original ingress repairs.
 */
export const writeSpelloutAttempts = ({ outputPath, sentence, framework, model, text }) => {
  const rawBytes = Buffer.from(text, 'utf8');
  const record = { schemaVersion: 1, contract: SPELLOUT_CONTRACT_VERSION, rawOutput: 'output.txt',
    rawOutputSha256: hashQualificationBytes(rawBytes) };
  const writeRecord = () => fs.writeFileSync(path.join(outputPath, 'spellout.json'), stableQualificationJson(record));
  let parsed;
  try {
    parsed = parseModelJsonDetailed(text);
  } catch {
    // The ordinary attempt records the JSON failure exactly as it would today.
    record.ingress = { status: 'failed' };
    writeRecord();
    const attempt = { id: 'parse', request: { sentence, framework }, model, source: { kind: 'raw-text-file', path: 'output.txt' } };
    return [writeQualificationAttempt({ outputPath, attempt, rawBytes })];
  }
  const results = convertSpelloutPayload(parsed.payload, sentence);
  const plan = planSpelloutAttempts(parsed.payload, results);
  Object.assign(record, {
    ingress: { status: 'parsed', integrityFlags: parsed.integrityFlags || [], repairDiagnostics: parsed.repairDiagnostics || [] },
    analyses: results.map(({ analysis, ...result }) => result),
    attempts: [...plan.attempts.map(({ id, inputTokens, analysisIndices }) => ({ id, inputTokens, analysisIndices })),
      ...plan.failures.map(({ id, analysisIndex }) => ({ id, analysisIndices: [analysisIndex], failed: true }))]
  });
  writeRecord();
  const converted = plan.attempts.map(({ id, inputTokens, analysisIndices, payload }) => writeQualificationAttempt({
    outputPath,
    attempt: { id, request: { sentence, framework, inputTokens }, model,
      source: { kind: 'spellout-conversion', path: 'spellout.json', contract: SPELLOUT_CONTRACT_VERSION, analysisIndices } },
    rawBytes: Buffer.from(stableQualificationJson(payload), 'utf8')
  }));
  const failed = plan.failures.map(({ id, analysisIndex, diagnostics }) => {
    const attemptRoot = path.join(outputPath, 'attempts', id);
    fs.mkdirSync(attemptRoot, { recursive: true });
    fs.writeFileSync(path.join(attemptRoot, 'raw-output.txt'), rawBytes);
    const [first] = diagnostics;
    const receipt = {
      schemaVersion: 1, attemptId: id, request: { sentence, framework }, model,
      source: { kind: 'spellout-check', path: 'spellout.json', contract: SPELLOUT_CONTRACT_VERSION, analysisIndices: [analysisIndex] },
      rawOutput: { artifact: `attempts/${id}/raw-output.txt`, byteLength: rawBytes.byteLength, sha256: hashQualificationBytes(rawBytes) },
      outcome: { status: 'failed', phase: 'spellout', failure: createFailure({
        failureClass: 'contract_misunderstanding', ruleId: first.rule, analysisIndex,
        processingStep: 'spellout-alignment', message: first.detail
      }), diagnostics }
    };
    fs.writeFileSync(path.join(attemptRoot, 'attempt-receipt.json'), stableQualificationJson(receipt));
    return { receipt, reviewEntry: { attemptId: id, sentence, framework, model, outcome: receipt.outcome,
      rawOutput: receipt.rawOutput.artifact, receipt: `attempts/${id}/attempt-receipt.json`, analyses: [] } };
  });
  return [...converted, ...failed];
};
