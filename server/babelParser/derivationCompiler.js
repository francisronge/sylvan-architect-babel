import { createAuthoredWorkspaceHelpers } from '../../replay/authoredWorkspaceInspection.js';
import { createFailure, withFailureDetails } from './validationErrors.js';
import { resolveRealizations, validateRealizations } from './realizations.js';
import { tokenizeSentenceSurfaceOrder } from './surfaceTokens.js';

export const createDerivationCompilerHelpers = ({
  ParseApiError,
  normalizeOptionalText,
  collectNodeReferencesById,
  collectOvertTerminalNodes,
  authoredWord,
  sameTokenSequence,
  deriveCanonicalSurfaceSpans
}) => {
  const { cloneJson, normalizeDerivationStagesToDerivationFrames, expandWorkspaceForest, inspectDerivationWorkspaces } =
    createAuthoredWorkspaceHelpers({ ParseApiError, createFailure, withFailureDetails,
      resolveRealizations, validateRealizations, tokenizeSentenceSurfaceOrder });

  const normalizeDerivationFrames = (value, options = {}) => {
    if (!Array.isArray(value)) return [];
    const integrityFlags = Array.isArray(options?.integrityFlags)
      ? options.integrityFlags
      : [];
    const priorNodes = new Map();

    return value.map((frame, stageIndex) => {
      const rawForest = frame?.after?.workspaceForest;
      const workspaceForest = expandWorkspaceForest(
        rawForest,
        priorNodes,
        stageIndex,
        integrityFlags,
        undefined,
        options.nodeFieldPaths
      );
      if (frame?.after?.realizations?.length > 0) {
        const surface = resolveRealizations(workspaceForest, frame.after.realizations, options.sentenceTokens,
          { stageIndex, fieldPath: `$.derivationStages[${stageIndex}]` });
        if (surface.diagnostics.length) {
          const failure = surface.diagnostics[0];
          throw new ParseApiError('BAD_MODEL_RESPONSE', failure.message, 502,
            withFailureDetails({}, { ...failure, failureClass: failure.class }));
        }
      }
      collectNodeReferencesById(workspaceForest).forEach((node, nodeId) => {
        // Expansion clones each use; retaining this version also retains its field origins.
        priorNodes.set(nodeId, node);
      });
      return {
        ...frame,
        after: {
          ...(frame?.after || {}),
          workspaceForest
        }
      };
    });
  };

  const getFrameWorkspaceForest = (frame) => (
    Array.isArray(frame?.after?.workspaceForest)
      ? frame.after.workspaceForest
      : []
  );

  const canonicalizeDerivationRootCandidateForSentence = (root, sentenceTokens = [], options = {}) => {
    if (!root || typeof root !== 'object' || !Array.isArray(sentenceTokens) || sentenceTokens.length === 0) {
      return null;
    }
    const candidate = cloneJson(root);
    const roots = Array.isArray(candidate) ? candidate : [candidate];
    if (roots.length === 0) return null;
    const fieldPathsById = new Map(Array.from(collectNodeReferencesById(root), ([nodeId, node]) => [
      nodeId, options.nodeFieldPaths?.get(node)
    ]));
    const alignmentError = (node, field, expectedForm) => {
      const origin = fieldPathsById.get(node.id);
      const fieldPath = `${origin?.fieldPath || options.fieldPath || '$'}.${field}`;
      const message = `${fieldPath}: authored ${field} does not match final sentence alignment; expected ${expectedForm}.`;
      throw new ParseApiError('BAD_MODEL_RESPONSE', message, 502, withFailureDetails({}, {
        failureClass: 'contract_misunderstanding', ruleId: 'DERIVATION_TOKEN_ALIGNMENT',
        stageIndex: origin?.stageIndex ?? options.stageIndex ?? null,
        fieldPath, offendingValue: node[field], expectedForm, message, processingStep: 'token-alignment'
      }));
    };
    try {
      const nodesById = collectNodeReferencesById(candidate);
      const authoredTechnicalFields = new Map(
        Array.from(nodesById, ([nodeId, node]) => [
          nodeId,
          {
            hasSurfaceSpan: Object.hasOwn(node, 'surfaceSpan'),
            hasTokenIndex: Object.hasOwn(node, 'tokenIndex'),
            surfaceSpan: cloneJson(node.surfaceSpan),
            tokenIndex: node.tokenIndex
          }
        ])
      );
      const overtTerminals = roots.flatMap(collectOvertTerminalNodes);
      const overtTerminalIds = new Set(
        overtTerminals.map((node) => String(node.id || ''))
      );
      const overtSurfaces = overtTerminals
        .map((node) => authoredWord(node))
        .map((token) => String(token || '').trim())
        .filter(Boolean);
      const hasRealizations = options.realizations?.length > 0;
      if (!hasRealizations && !sameTokenSequence(overtSurfaces, sentenceTokens)) return null;

      let realizedTokenIndices;
      if (hasRealizations) {
        const exactNodes = new Map(Array.from(nodesById.values(), (node) => [node.id, node]));
        // The candidate must contain every declared source. A single-root
        // candidate cannot discard a realization in another workspace.
        if (options.realizations.some((group) => group.nodeIds.some((id) => !exactNodes.has(id)))) return null;
        const fieldPath = `$.derivationStages[${options.stageIndex}]`;
        const surface = resolveRealizations(roots, options.realizations, sentenceTokens,
          { stageIndex: options.stageIndex, fieldPath, complete: true });
        if (surface.diagnostics.length) {
          const failure = surface.diagnostics[0];
          throw new ParseApiError('BAD_MODEL_RESPONSE', failure.message, 502,
            withFailureDetails({}, { ...failure, failureClass: failure.class }));
        }
        surface.tokenAssignments.forEach((tokenIndex, id) => { exactNodes.get(id).tokenIndex = tokenIndex; });
        realizedTokenIndices = surface.tokenIndicesByNodeId;
      } else {
        nodesById.forEach((node, nodeId) => {
          if (!overtTerminalIds.has(nodeId) && Object.hasOwn(node, 'tokenIndex')) {
            alignmentError(node, 'tokenIndex', 'no tokenIndex on a non-overt node');
          }
        });
        overtTerminals.forEach((node, tokenIndex) => {
          if (Object.hasOwn(node, 'tokenIndex') && node.tokenIndex !== tokenIndex) {
            alignmentError(node, 'tokenIndex', `the integer ${tokenIndex}`);
          }
          node.tokenIndex = tokenIndex;
        });
      }
      roots.forEach((item) => deriveCanonicalSurfaceSpans(item, realizedTokenIndices));
      collectNodeReferencesById(candidate).forEach((node, nodeId) => {
        const authored = authoredTechnicalFields.get(nodeId);
        if (!authored) return;
        if (
          authored.hasTokenIndex
          && authored.tokenIndex !== node.tokenIndex
        ) {
          alignmentError({ ...node, tokenIndex: authored.tokenIndex }, 'tokenIndex', `the integer ${node.tokenIndex}`);
        }
        if (
          authored.hasSurfaceSpan
          && JSON.stringify(authored.surfaceSpan) !== JSON.stringify(node.surfaceSpan)
        ) {
          const differingIndex = Array.isArray(authored.surfaceSpan) && Array.isArray(node.surfaceSpan)
            && authored.surfaceSpan.length === 2
            ? authored.surfaceSpan.findIndex((value, index) => value !== node.surfaceSpan[index]) : -1;
          if (differingIndex >= 0) {
            alignmentError({ ...node, [`surfaceSpan[${differingIndex}]`]: authored.surfaceSpan[differingIndex] },
              `surfaceSpan[${differingIndex}]`, `the integer ${node.surfaceSpan[differingIndex]}`);
          }
          alignmentError({ ...node, surfaceSpan: authored.surfaceSpan }, 'surfaceSpan', JSON.stringify(node.surfaceSpan) || 'no span on a non-overt node');
        }
      });
    } catch (error) {
      if (options.validationIssues) {
        if (!(error instanceof ParseApiError)
          || !['token-alignment', 'realization-alignment'].includes(error.failure?.processingStep)) throw error;
        options.validationIssues.push(error.failure);
      }
      return null;
    }
    const overtTerminals = roots.flatMap(collectOvertTerminalNodes)
      .map((node) => authoredWord(node))
      .map((token) => String(token || '').trim())
      .filter(Boolean);
    return options.realizations?.length > 0 || sameTokenSequence(overtTerminals, sentenceTokens) ? candidate : null;
  };

  const selectCommittedDerivationRoot = (workspaceForest, sentenceTokens = [], options = {}) => {
    if (!Array.isArray(workspaceForest) || workspaceForest.length === 0) return null;
    const candidates = workspaceForest
      .map((root, index) => canonicalizeDerivationRootCandidateForSentence(root, sentenceTokens, {
        ...options, fieldPath: `${options.fieldPath || '$.workspaceForest'}[${index}]`
      }))
      .filter(Boolean);
    return candidates.length === 1 ? candidates[0] : null;
  };

  const findCommittedFinalDerivationFrame = (derivationFrames, sentenceTokens = [], options = {}) => {
    if (!Array.isArray(derivationFrames) || derivationFrames.length === 0) return null;
    const frameIndex = derivationFrames.length - 1;
    const frame = derivationFrames[frameIndex];
    const root = selectCommittedDerivationRoot(
      getFrameWorkspaceForest(frame),
      sentenceTokens,
      { ...options, realizations: frame?.after?.realizations, stageIndex: frameIndex, fieldPath: `$.derivationStages[${frameIndex}].workspaceForest` }
    );
    return root ? { frame, frameIndex, root } : null;
  };

  const buildCanonicalDerivationFromDerivationFrames = (
    derivationFrames,
    sentenceTokens = [],
    options = {}
  ) => {
    if (!Array.isArray(derivationFrames) || derivationFrames.length === 0) return null;
    const frameIndex = derivationFrames.length - 1;
    const frame = derivationFrames[frameIndex];
    const finalForest = canonicalizeDerivationRootCandidateForSentence(
      getFrameWorkspaceForest(frame), sentenceTokens,
      { ...options, realizations: frame?.after?.realizations, stageIndex: frameIndex,
        fieldPath: `$.derivationStages[${frameIndex}].workspaceForest` }
    );
    if (!finalForest) return null;
    const rootCandidates = finalForest.filter((root) => {
      const overtTerminals = collectOvertTerminalNodes(root).map((node) => authoredWord(node)).filter(Boolean);
      return sameTokenSequence(overtTerminals, sentenceTokens);
    });
    const realizationSources = new Set((frame?.after?.realizations || []).flatMap((group) => group.nodeIds));
    const tree = finalForest.length === 1 ? finalForest[0]
      : rootCandidates.length === 1
        && [...realizationSources].every((id) => collectNodeReferencesById(rootCandidates[0]).has(id))
        ? rootCandidates[0] : undefined;
    return { finalForest, ...(tree ? { tree } : {}) };
  };

  return {
    inspectDerivationWorkspaces,
    normalizeDerivationStagesToDerivationFrames,
    normalizeDerivationFrames,
    canonicalizeDerivationRootCandidateForSentence,
    selectCommittedDerivationRoot,
    findCommittedFinalDerivationFrame,
    buildCanonicalDerivationFromDerivationFrames
  };
};
