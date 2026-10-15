import fs from 'node:fs';
import path from 'node:path';

import { inspectDerivationWorkspaces } from '../server/babelParser/derivationCompiler.js';

const DEFAULT_INPUTS = fs.globSync('fixtures/normalized/*.json').sort();
const RETAINED_RELATION_RULES = new Set([
  'DERIVATION_STAGE_RELATION_EXACT',
  'DERIVATION_RELATION_ANCHOR_RESOLUTION'
]);

const unwrapBundle = (payload) => {
  if (payload && (Object.hasOwn(payload, 'analyses') || Object.hasOwn(payload, 'derivationStages'))) return payload;
  if (payload?.response && typeof payload.response === 'object') return payload.response;
  if (payload?.bundle && typeof payload.bundle === 'object') return payload.bundle;
  return payload;
};

const validateFile = (filePath) => {
  const errors = [];
  const warnings = [];
  try {
    const original = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    const payload = unwrapBundle(original);
    const contexts = [payload, original, original?.request];
    const sentence = contexts.map((context) => context?.sentence).find((value) => typeof value === 'string');
    const inputTokens = contexts.map((context) => context?.inputTokens).find(Array.isArray);
    const analyses = Object.hasOwn(payload || {}, 'analyses')
      ? payload.analyses
      : payload && Object.hasOwn(payload, 'derivationStages') ? [payload] : undefined;
    if (!Array.isArray(analyses) || analyses.length === 0) {
      errors.push('expected a nonempty analyses array or an analysis containing derivationStages');
      return { filePath, errors, warnings };
    }
    analyses.forEach((analysis, analysisIndex) => {
      const prefix = `analysis ${analysisIndex + 1}`;
      const stages = analysis?.derivationStages;
      if (!Array.isArray(stages) || stages.length === 0) {
        errors.push(`${prefix}: derivationStages must be a nonempty array`);
        return;
      }
      // The parser owns stage shape, realizations, reference expansion and exact
      // anchor resolution. The CLI only assigns verification severity to its diagnostics.
      const inspected = inspectDerivationWorkspaces(stages, {
        analysisIndex,
        fieldPath: `$.analyses[${analysisIndex}]`,
        ...(typeof sentence === 'string' ? { sentence } : {}),
        ...(Array.isArray(inputTokens) ? { sentenceTokens: inputTokens } : {})
      });
      for (const entry of inspected) {
        for (const diagnostic of entry.diagnostics) {
          const message = `${prefix}: ${diagnostic.ruleId}: ${diagnostic.message}`;
          if (RETAINED_RELATION_RULES.has(diagnostic.ruleId)) {
            warnings.push(`${message} (retained relation diagnostic)`);
          } else if (diagnostic.class === 'valid_but_unexpected') {
            warnings.push(message);
          } else {
            errors.push(message);
          }
        }
      }
      if (inspected.at(-1).workspaceForest?.length === 0) {
        errors.push(`${prefix}: final workspaceForest must be nonempty`);
      }
    });
  } catch (error) {
    errors.push(error.message);
  }
  return { filePath, errors, warnings };
};

const inputs = process.argv.slice(2);
const files = inputs.length > 0 ? inputs : DEFAULT_INPUTS;
if (files.length === 0) {
  console.error('No parse contract inputs found.');
  process.exitCode = 1;
}
for (const file of files) {
  const result = validateFile(path.resolve(file));
  console.log(`\n${result.filePath}`);
  result.warnings.forEach((warning) => console.log(`  warning: ${warning}`));
  if (result.errors.length === 0) {
    console.log('  Parse contract verification passed.');
  } else {
    result.errors.forEach((error) => console.log(`  error: ${error}`));
    process.exitCode = 1;
  }
}
