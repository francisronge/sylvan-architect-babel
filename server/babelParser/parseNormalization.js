import { withFailureDetails } from './validationErrors.js';
import { resolveRealizations } from './realizations.js';

export const createParseNormalizationHelpers = ({
  ParseApiError,
  normalizeOptionalText,
  tokenizeSentenceSurfaceOrder,
  normalizeDerivationStagesToDerivationFrames,
  normalizeDerivationFrames,
  buildCanonicalDerivationFromDerivationFrames,
  sameTokenSequence,
  collectOvertTerminalNodes,
  authoredWord
}) => {
  const normalizeParseResult = (
    value,
    framework = 'xbar',
    sentence = '',
    modelRoute = 'gemini',
    enforceDerivationRouteContract = false,
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
    const payloadRepairDiagnostics = Array.isArray(options?.payloadRepairDiagnostics)
      ? structuredClone(options.payloadRepairDiagnostics)
      : [];
    const sentenceTokens = tokenizeSentenceSurfaceOrder(sentence);
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
      { integrityFlags: payloadIntegrityFlags, nodeFieldPaths, sentenceTokens }
    );
    const derivationPrimaryBundle = derivationFrames.length > 0
      ? buildCanonicalDerivationFromDerivationFrames(derivationFrames, sentenceTokens, {
        nodeFieldPaths, validationIssues: alignmentIssues
      })
      : null;
    if (!derivationPrimaryBundle?.tree) {
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
      const flattenedSurfaceOrder = observedRootSurfaceOrders.flat();
      const hasExactRootSurface = observedRootSurfaceOrders.some((observedOrder) => (
        sameTokenSequence(observedOrder, sentenceTokens)
      ));
      const incompleteWorkspaceCouldStillConverge = (
        finalForest.length > 1
        && (collectiveCoverage || sameTokenSequence(flattenedSurfaceOrder, sentenceTokens))
      );
      if (
        observedRootSurfaceOrders.length > 0
        && !hasExactRootSurface
        && !incompleteWorkspaceCouldStillConverge
      ) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'No authored tree overt terminals match the input sentence order.',
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
    const committedTree = derivationPrimaryBundle.tree;
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
      payloadRepairDiagnostics: payloadRepairDiagnostics.length > 0
        ? payloadRepairDiagnostics
        : undefined,
      hasDerivationStages: derivationStages.length > 0
    };

    return {
      tree: committedTree,
      derivationStages,
      provenance
    };
  };

  const normalizeParseBundle = (
    value,
    framework = 'xbar',
    sentence = '',
    modelRoute = 'gemini',
    enforceDerivationRouteContract = false,
    options = {}
  ) => {
    const parsed = value;
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
    // ParseBundle is an internal/product envelope. Each analysis inside it still
    // has the same authored derivation-stage contract.
    const analysesSource = Array.isArray(parsed?.analyses)
      ? parsed.analyses
      : parsed
        ? [parsed]
        : [];

    let firstError;
    const analyses = analysesSource.map((analysis, analysisIndex) => {
      try {
        const normalized = normalizeParseResult(
          analysis, framework, sentence, modelRoute, enforceDerivationRouteContract, options
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
        const annotatedError = new ParseApiError(error.code, message, error.status, withFailureDetails(error.details, {
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
      ambiguityDetected,
      ambiguityNote: ambiguityDetected ? String(parsed?.ambiguityNote || '').trim() || undefined : undefined
    };
  };

  return {
    normalizeParseResult,
    normalizeParseBundle
  };
};
