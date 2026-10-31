import { ParseApiError } from './error.js';
import { withFailureDetails } from './validationErrors.js';
import { resolveRealizations } from './realizations.js';
import { resolveSavedInputTokens, tokenizeSentenceSurfaceOrder } from './surfaceTokens.js';
import {
  createExpansionBudget,
  normalizeDerivationStagesToDerivationFrames,
  normalizeDerivationFrames,
  buildCanonicalDerivationFromDerivationFrames
} from './derivationCompiler.js';
import { collectOvertTerminalNodes } from './syntaxTree.js';
import { authoredWord } from './nodePronunciation.js';
import { omitMismatchedOptionalTokenIndices } from './tokenIndexRecovery.js';
import { convertSpelloutPayload } from './spellout.js';
import { expandPartsListPayload } from './partsList.js';

const normalizeOptionalText = (value) => {
  const text = String(value || '').trim();
  return text || undefined;
};

const normalizeParseResult = (
  value,
  framework = 'minimalism',
  sentence = '',
  modelRoute,
  options = {}
) => {
  const parsed = value;
  if (!parsed || typeof parsed !== 'object') {
    throw new ParseApiError(
      'BAD_MODEL_RESPONSE',
      'The analysis must be a JSON object.',
      502,
      withFailureDetails({}, {
        failureClass: 'contract_misunderstanding',
        ruleId: 'ANALYSIS_OBJECT',
        fieldPath: '$',
        offendingValue: parsed
      })
    );
  }
  const payloadIntegrityFlags = Array.isArray(options?.payloadIntegrityFlags)
    ? options.payloadIntegrityFlags.slice()
    : [];
  const sentenceTokens = resolveSavedInputTokens(sentence, options.inputTokens ?? tokenizeSentenceSurfaceOrder(sentence));
  const rawDerivationStages = parsed.derivationStages;
  const rawDerivationStageCount = Array.isArray(rawDerivationStages) ? rawDerivationStages.length : 0;
  const usesDerivationStages = rawDerivationStageCount > 0;
  const rawDerivationFrames = normalizeDerivationStagesToDerivationFrames(rawDerivationStages, {
    integrityFlags: payloadIntegrityFlags
  });
  if (usesDerivationStages) {
    payloadIntegrityFlags.push('derivation_stages_compiled_to_derivation_frames');
  }
  const nodeFieldPaths = new WeakMap();
  const alignmentIssues = [];
  const derivationFrames = normalizeDerivationFrames(
    rawDerivationFrames,
    { integrityFlags: payloadIntegrityFlags, nodeFieldPaths, sentenceTokens, expansionBudget: options.expansionBudget }
  );
  const derivationPrimaryBundle = derivationFrames.length > 0
    ? buildCanonicalDerivationFromDerivationFrames(derivationFrames, sentenceTokens, {
      nodeFieldPaths, validationIssues: alignmentIssues
    })
    : null;
  if (!derivationPrimaryBundle?.finalForest?.length) {
    if (alignmentIssues.length > 0) {
      const failure = alignmentIssues[0];
      throw new ParseApiError('BAD_MODEL_RESPONSE', failure.message, 502, withFailureDetails({}, {
        ...failure, failureClass: failure.class
      }));
    }
    const finalFrame = derivationFrames[derivationFrames.length - 1];
    const finalForest = Array.isArray(finalFrame?.after?.workspaceForest)
      ? finalFrame.after.workspaceForest
      : [];
    const collectiveCoverage = finalFrame?.after?.realizations?.length > 0
      ? resolveRealizations(finalForest, finalFrame.after.realizations, sentenceTokens, {
        complete: true, stageIndex: rawDerivationStageCount - 1,
        fieldPath: `$.derivationStages[${rawDerivationStageCount - 1}]`
      }) : null;
    if (collectiveCoverage?.diagnostics.length) {
      const failure = collectiveCoverage.diagnostics[0];
      throw new ParseApiError('BAD_MODEL_RESPONSE', failure.message, 502,
        withFailureDetails({}, { ...failure, failureClass: failure.class }));
    }
    const observedRootSurfaceOrders = finalForest.map((root) => (
      collectOvertTerminalNodes(root)
        .map((node) => authoredWord(node))
        .map((token) => String(token || '').trim())
        .filter(Boolean)
    ));
    if (observedRootSurfaceOrders.length > 0 && !collectiveCoverage) {
      throw new ParseApiError(
        'BAD_MODEL_RESPONSE',
        'The final workspace overt terminals do not match the input sentence order.',
        502,
        withFailureDetails({}, {
          failureClass: 'contract_misunderstanding',
          ruleId: 'SURFACE_ORDER_EXACT',
          stageIndex: rawDerivationStageCount > 0 ? rawDerivationStageCount - 1 : null,
          fieldPath: rawDerivationStageCount > 0
            ? `$.derivationStages[${rawDerivationStageCount - 1}].workspaceForest`
            : '$.derivationStages',
          offendingValue: {
            expectedSurfaceOrder: sentenceTokens,
            observedRootSurfaceOrders
          }
        })
      );
    }
    throw new ParseApiError(
      'INCOMPLETE_GENERATION',
      derivationFrames.length > 0
        ? 'Derivation frames never produced a committed final structure whose overt terminals match the input sentence.'
        : 'Derivation analysis failed to produce a committed tree from derivationStages.',
      502,
      withFailureDetails({}, {
        failureClass: 'incomplete_generation',
        ruleId: 'GENERATION_DID_NOT_CONVERGE',
        stageIndex: rawDerivationStageCount > 0 ? rawDerivationStageCount - 1 : null,
        fieldPath: '$.derivationStages',
        offendingValue: rawDerivationStages
      })
    );
  }
  const { tree: committedTree, finalForest } = derivationPrimaryBundle;
  const derivationStages = derivationFrames.map((frame) => {
    const details = frame?.change?.details && typeof frame.change.details === 'object' && !Array.isArray(frame.change.details)
      ? frame.change.details
      : {};
    const stageRecord = details.stageRecord;
    const relations = Array.isArray(details.derivationStageRelations)
      ? details.derivationStageRelations.map((relation) => structuredClone(relation))
      : [];
    return {
      statement: frame?.change?.statement,
      stageRecord,
      relations,
      workspaceForest: frame?.after?.workspaceForest || [],
      ...(Object.hasOwn(frame?.after || {}, 'realizations') ? { realizations: structuredClone(frame.after.realizations) } : {})
    };
  });
  const provenance = {
    modelRoute,
    framework,
    timestamp: new Date().toISOString(),
    treeSource: 'derivationStages',
    promptVersion: normalizeOptionalText(process.env.BABEL_PROMPT_VERSION),
    parserVersion: normalizeOptionalText(process.env.BABEL_PARSER_VERSION || process.env.VERCEL_GIT_COMMIT_SHA),
    uiVersion: normalizeOptionalText(process.env.BABEL_UI_VERSION || process.env.VERCEL_GIT_COMMIT_SHA),
    payloadIntegrityFlags: payloadIntegrityFlags.length > 0
      ? Array.from(new Set(payloadIntegrityFlags))
      : undefined,
    hasDerivationStages: derivationStages.length > 0
  };

  return {
    ...(committedTree ? { tree: committedTree } : {}),
    finalForest,
    derivationStages,
    provenance
  };
};

const normalizeWithTokenIndexRecovery = (analysis, framework, sentence, modelRoute, options, fieldPath) => {
  try {
    return normalizeParseResult(analysis, framework, sentence, modelRoute, options);
  } catch (error) {
    if (!(error instanceof ParseApiError) || error.failure.ruleId !== 'DERIVATION_TOKEN_ALIGNMENT'
      || !error.failure.fieldPath.endsWith('.tokenIndex')) throw error;
    const recovery = omitMismatchedOptionalTokenIndices(analysis, options.inputTokens, fieldPath);
    if (!recovery) throw error;
    let normalized;
    try {
      normalized = normalizeParseResult(recovery.candidate, framework, sentence, modelRoute, options);
    } catch (candidateError) {
      if (!(candidateError instanceof ParseApiError)) throw candidateError;
      // The first pass expanded within the response's budget, so a retry that
      // spends it reports the budget rather than the alignment it was repairing.
      if (options.expansionBudget?.remainingFieldValues < 0) throw candidateError;
      throw error;
    }
    normalized.provenance.tokenIndexCorrections = recovery.corrections;
    return normalized;
  }
};

// The deepest JSON nesting a response may have. A tree level costs about two
// JSON levels and spell-out reads trees up to 256 levels, so real responses
// stay far below it; within it, the parser's recursive walks and clones fit
// comfortably on the stack.
const MAX_RESPONSE_DEPTH = 1_024;

/** Whether a parsed response nests objects and arrays deeper than limit, found without recursion. */
const nestsDeeperThan = (value, limit) => {
  const pending = [[value, 1]];
  while (pending.length) {
    const [item, depth] = pending.pop();
    if (!item || typeof item !== 'object') continue;
    if (depth > limit) return true;
    for (const child of Object.values(item)) pending.push([child, depth + 1]);
  }
  return false;
};

/** One analysis's first spelling failure, typed like other contract failures. */
const partsListFailure = (issue, multiple) => {
  const message = `${multiple ? `Analysis ${issue.analysisIndex + 1}: ` : ''}${issue.message}`;
  return new ParseApiError('BAD_MODEL_RESPONSE', message, 502, withFailureDetails({}, {
    failureClass: 'contract_misunderstanding',
    ruleId: issue.ruleId,
    analysisIndex: issue.analysisIndex,
    stageIndex: issue.stageIndex,
    fieldPath: issue.fieldPath,
    offendingValue: issue.offendingValue,
    expectedForm: issue.expectedForm,
    processingStep: 'workspace-expansion',
    message
  }));
};

const spelloutFailure = (result, multiple) => {
  const [first] = result.diagnostics;
  const fieldPath = multiple ? `$.analyses[${result.analysisIndex}]` : '$';
  const message = `${multiple ? `Analysis ${result.analysisIndex + 1}: ` : ''}${first.detail}`;
  return new ParseApiError('BAD_MODEL_RESPONSE', message, 502, withFailureDetails({}, {
    failureClass: 'contract_misunderstanding',
    ruleId: first.rule,
    analysisIndex: result.analysisIndex,
    fieldPath,
    processingStep: 'spellout-alignment',
    message
  }));
};

export const normalizeParseBundle = (
  value,
  framework = 'minimalism',
  sentence = '',
  modelRoute,
  enforceDerivationRouteContract = false,
  options = {}
) => {
  let parsed = value;
  // Checked before anything walks or clones the response recursively.
  if (nestsDeeperThan(parsed, MAX_RESPONSE_DEPTH)) {
    const message = `The response nests deeper than ${MAX_RESPONSE_DEPTH} levels, so Babel cannot read it.`;
    throw new ParseApiError('BAD_MODEL_RESPONSE', message, 502, withFailureDetails({}, {
      failureClass: 'contract_misunderstanding',
      ruleId: 'PAYLOAD_NESTING_DEPTH',
      fieldPath: '$',
      message
    }));
  }
  if (enforceDerivationRouteContract) {
    const topLevelFields = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? Object.keys(parsed)
      : [];
    const hasSingleAnalysisShape = (
      topLevelFields.length !== 1
        ? false
        : Object.prototype.hasOwnProperty.call(parsed || {}, 'derivationStages')
    );
    const hasAmbiguityShape = (
      topLevelFields.length === 1
      && Object.prototype.hasOwnProperty.call(parsed || {}, 'analyses')
      && Array.isArray(parsed.analyses)
      && parsed.analyses.length > 0
      && parsed.analyses.every((analysis) => (
        analysis
        && typeof analysis === 'object'
        && !Array.isArray(analysis)
        && Object.keys(analysis).length === 1
        && Object.prototype.hasOwnProperty.call(analysis, 'derivationStages')
      ))
    );
    if (!hasSingleAnalysisShape && !hasAmbiguityShape) {
      throw new ParseApiError(
        'BAD_MODEL_RESPONSE',
        'The authored payload must be either { derivationStages } or { analyses: [{ derivationStages }, ...] }, with no additional fields.',
        502,
        withFailureDetails({}, {
          failureClass: 'contract_misunderstanding',
          ruleId: 'PAYLOAD_ENVELOPE_EXACT',
          fieldPath: '$',
          offendingValue: parsed
        })
      );
    }
  }
  // A parts-list analysis is expanded into nested workspace forests before any
  // other check, so every later step and the stored analysis read one form.
  const partsList = expandPartsListPayload(parsed);
  if (partsList.issues.length) {
    const failed = partsList.issues.map(issue => partsListFailure(issue, Array.isArray(parsed?.analyses)));
    failed.forEach(error => options.analysisOutcomes?.push({ analysisIndex: error.failure.analysisIndex, status: 'failed', failure: error.failure }));
    throw failed[0];
  }
  parsed = partsList.payload;
  // ParseBundle is an internal/product envelope. Each analysis inside it still
  // has the same authored derivation-stage contract.
  let analysesSource = Array.isArray(parsed?.analyses)
    ? parsed.analyses
    : parsed
      ? [parsed]
      : [];

  let inputTokens;
  if (options.spellout) {
    // A model response names words by spelling them. Babel checks each
    // analysis and derives one shared word list before parsing.
    const results = convertSpelloutPayload(parsed, sentence);
    const failed = results.filter(result => !result.ok).map(result => spelloutFailure(result, Array.isArray(parsed?.analyses)));
    failed.forEach(error => options.analysisOutcomes?.push({ analysisIndex: error.failure.analysisIndex, status: 'failed', failure: error.failure }));
    if (failed.length) throw failed[0];
    analysesSource = results.map(result => result.analysis);
    inputTokens = results[0].inputTokens;
  } else {
    inputTokens = resolveSavedInputTokens(sentence, options.inputTokens ?? tokenizeSentenceSurfaceOrder(sentence));
  }
  let firstError;
  // Every analysis of the response, and any token-index retry, shares one budget.
  const expansionBudget = createExpansionBudget();
  const analyses = analysesSource.map((analysis, analysisIndex) => {
    try {
      const normalized = normalizeWithTokenIndexRecovery(
        analysis, framework, sentence, modelRoute, { ...options, inputTokens, expansionBudget },
        Array.isArray(parsed?.analyses) ? `$.analyses[${analysisIndex}]` : '$'
      );
      options.analysisOutcomes?.push({ analysisIndex, status: 'succeeded' });
      return normalized;
    } catch (error) {
      if (!(error instanceof ParseApiError)) throw error;
      const failure = error.failure;
      const fieldPath = Array.isArray(parsed?.analyses)
        ? `$.analyses[${analysisIndex}]${failure.fieldPath.slice(1)}`
        : failure.fieldPath;
      const message = Array.isArray(parsed?.analyses)
        ? `Analysis ${analysisIndex + 1}: ${error.message.replace(failure.fieldPath, fieldPath)}`
        : error.message;
      // A failure after the spell-out check carries the derived word list, so
      // failure inspection reads the output against the same words.
      const details = options.spellout ? { ...error.details, inputTokens } : error.details;
      const annotatedError = new ParseApiError(error.code, message, error.status, withFailureDetails(details, {
        ...failure,
        failureClass: failure.class,
        analysisIndex,
        fieldPath,
        message
      }));
      if (!Array.isArray(options.analysisOutcomes)) throw annotatedError;
      options.analysisOutcomes.push({ analysisIndex, status: 'failed', failure: annotatedError.failure });
      firstError ||= annotatedError;
      return null;
    }
  });
  if (firstError) throw firstError;

  if (analyses.length === 0) {
    throw new ParseApiError(
      'BAD_MODEL_RESPONSE',
      'No analyses were returned by the model.',
      502,
      withFailureDetails({}, {
        failureClass: 'contract_misunderstanding',
        ruleId: 'ANALYSES_NONEMPTY',
        fieldPath: '$.analyses',
        offendingValue: parsed?.analyses
      })
    );
  }

  const ambiguityDetected = analyses.length > 1 || Boolean(parsed?.ambiguityDetected);

  return {
    analyses,
    inputTokens,
    ambiguityDetected,
    ambiguityNote: ambiguityDetected ? String(parsed?.ambiguityNote || '').trim() || undefined : undefined
  };
};
