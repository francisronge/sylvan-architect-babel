export const createParseNormalizationHelpers = ({
  ParseApiError,
  normalizeKey,
  normalizeChainType,
  normalizeMovementOperation,
  normalizeOptionalStepText,
  normalizeOptionalStringArray,
  tokenizeSentenceSurfaceOrder,
  normalizeSurfaceToken,
  normalizeNoteBindings,
  buildExplanationFromNoteBindings,
  normalizeGrowthFrames,
  materializeImplicitPhrasalTraceShellsInGrowthFrames,
  buildCanonicalDerivationFromGrowthFrames,
  compileFlatNodeTableToTree,
  collectNodeReferencesById,
  normalizeSyntaxTreeWithIds,
  materializeLexicalPhrasalLeaves,
  buildNodeIndexFromTree,
  buildNodeLabelIndexFromTree,
  assignDerivationStepIds,
  normalizeDerivationSteps,
  normalizeMovementEvents,
  canonicalizeSplitClauseEdgeMovedPhrases,
  collapseOvertHeadLandingChains,
  remapDerivationStepsNodeIds,
  remapMovementEventsNodeIds,
  canonicalizeHeadMoveSourceShells,
  validateAndCommitSurfaceOrder,
  validateSpelloutConsistency,
  buildCanonicalMovementEvents,
  stripMovementIndicesFromTree,
  materializeEmptyStructuralLeaves,
  promoteSentenceMatchingLeaves,
  collectOvertTerminalNodes,
  resolveNodeSurface,
  materializeCommittedTraceShells,
  buildGroundedExplanation,
  harmonizeExplanationWithDerivation,
  buildCanonicalDerivationFromTree,
  reconcileDerivationStepOperations,
  collectGrowthFrameNodeIds,
  normalizeChains,
  normalizeResearchTrace,
  normalizeCaseAssignments,
  normalizeArgumentStructure,
  normalizePhaseLog,
  normalizeMorphologyRealization,
  normalizeFeatureLedger,
  normalizeSelectionLedger,
  normalizeBindingLedger,
  normalizeClausalDependencies,
  normalizeAgreementLedger,
  normalizePredicateClassLedger,
  normalizeProbeLedger,
  normalizeNullElementLedger,
  normalizeDiagnosticLedger,
  normalizeParameterLedger,
  normalizeInformationStructureLedger,
  normalizeOperatorScopeLedger,
  normalizeVoiceValencyLedger,
  normalizeLinearizationLedger,
  normalizeLocalityLedger,
  normalizePredicationLedger,
  ensureStructuredEntryIds,
  runSemanticValidation,
  validatePronouncedCopiesAgainstCommittedTree,
  buildNoteBindingChainIdAliases,
  validateNoteBindingsAgainstStructuredAnalysis,
  auditNoteConsistency,
  computeCompletenessStatus,
  deriveImplicitGrowthChainId,
  deriveChainTypeFromOperation,
  mergeChainTypes,
  normalizeMovementStemFromId,
  subtreeContainsNamedCovertCategoryLeaf
}) => {
  const deriveChainsFromCommittedAnalysis = (derivationSteps, movementEvents, nodeIds) => {
    if (!Array.isArray(movementEvents) || movementEvents.length === 0) return [];
    const steps = Array.isArray(derivationSteps) ? derivationSteps : [];
    const chainsById = new Map();

    movementEvents.forEach((event, eventIndex) => {
      const stepIndex = Number.isInteger(event?.stepIndex) ? event.stepIndex : -1;
      const step = stepIndex >= 0 && stepIndex < steps.length ? steps[stepIndex] : null;
      const chainId = deriveImplicitGrowthChainId(step, event, eventIndex);
      const pronouncedCopy = String(event?.toNodeId || '').trim();
      const sourceCopy = String(event?.traceNodeId || event?.fromNodeId || '').trim();
      if (!chainId || !pronouncedCopy || !nodeIds.has(pronouncedCopy)) return;

      const existing = chainsById.get(chainId) || {
        chainId,
        type: deriveChainTypeFromOperation(event?.operation),
        copies: [],
        pronouncedCopy,
        silentCopies: [],
        features: [],
        note: normalizeOptionalStepText(event?.note) || normalizeOptionalStepText(step?.note)
      };

      existing.type = mergeChainTypes(existing.type, deriveChainTypeFromOperation(event?.operation));
      existing.pronouncedCopy = pronouncedCopy;
      if (nodeIds.has(pronouncedCopy)) existing.copies.push(pronouncedCopy);
      if (sourceCopy && nodeIds.has(sourceCopy) && sourceCopy !== pronouncedCopy) {
        existing.copies.push(sourceCopy);
        existing.silentCopies.push(sourceCopy);
      }
      normalizeOptionalStringArray(step?.preFeatures)?.forEach((feature) => existing.features.push(feature));
      normalizeOptionalStringArray(step?.postFeatures)?.forEach((feature) => existing.features.push(feature));
      if (!existing.note) {
        existing.note = normalizeOptionalStepText(event?.note) || normalizeOptionalStepText(step?.note);
      }
      chainsById.set(chainId, existing);
    });

    return Array.from(chainsById.values()).map((entry) => ({
      chainId: entry.chainId,
      type: entry.type,
      copies: Array.from(new Set(entry.copies.filter(Boolean))),
      pronouncedCopy: entry.pronouncedCopy,
      silentCopies: Array.from(new Set(entry.silentCopies.filter(Boolean))),
      features: entry.features.length > 0 ? Array.from(new Set(entry.features)) : undefined,
      note: entry.note
    }));
  };

  const normalizeParseResult = (value, framework = 'xbar', sentence = '', modelRoute = 'flash-lite', enforceGrowthRouteContract = false) => {
    const parsed = value;
    if (!parsed || typeof parsed !== 'object') {
      throw new ParseApiError('BAD_MODEL_RESPONSE', 'Malformed parse result from model.', 502);
    }
    const strictGrowthRoute = modelRoute === 'pro';
    const requireFullGrowthFrameContract = enforceGrowthRouteContract;
    const minGrowthFrames = modelRoute === 'pro' ? 3 : 2;
    const rawGrowthFrames = Array.isArray(parsed.growthFrames) ? parsed.growthFrames : [];
    if (requireFullGrowthFrameContract && rawGrowthFrames.length < minGrowthFrames) {
      throw new ParseApiError(
        'BAD_MODEL_RESPONSE',
        `${modelRoute === 'pro' ? 'Pro' : 'Flash Lite'} analysis must include at least ${minGrowthFrames} growthFrames.`,
        502
      );
    }

    const rawNoteBindings = normalizeNoteBindings(parsed.noteBindings);
    const legacyModelExplanation = !strictGrowthRoute && typeof parsed.explanation === 'string' && parsed.explanation.trim()
      ? parsed.explanation
      : '';
    const sentenceTokens = tokenizeSentenceSurfaceOrder(sentence);
    const growthFrames = materializeImplicitPhrasalTraceShellsInGrowthFrames(
      normalizeGrowthFrames(parsed.growthFrames, framework, sentenceTokens)
    );
    const growthPrimaryBundle = growthFrames.length > 0
      ? buildCanonicalDerivationFromGrowthFrames(growthFrames, sentenceTokens, framework)
      : null;
    const growthPrimaryActive = Boolean(growthPrimaryBundle?.tree);
    if (growthFrames.length > 0 && !growthPrimaryActive) {
      throw new ParseApiError(
        'BAD_MODEL_RESPONSE',
        'Growth frames never produced a committed final structure whose overt terminals match the input sentence.',
        502
      );
    }
    const legacyTreeSource = parsed.tree && Array.isArray(parsed.tree.nodes)
      ? compileFlatNodeTableToTree(parsed.tree.nodes, parsed.tree.rootId, framework, sentenceTokens)
      : parsed.tree
        ? parsed.tree
        : Array.isArray(parsed.nodes)
          ? compileFlatNodeTableToTree(parsed.nodes, parsed.rootId, framework, sentenceTokens)
          : null;
    const treeSource = growthPrimaryActive
      ? growthPrimaryBundle.tree
      : (!strictGrowthRoute ? legacyTreeSource : null);
    if (!treeSource) {
      throw new ParseApiError(
        'BAD_MODEL_RESPONSE',
        strictGrowthRoute
          ? 'Growth-route analysis failed to produce a committed tree from growthFrames.'
          : 'Malformed structural components from model at root.',
        502
      );
    }
    const useAssistedStructurePath = modelRoute === 'flash-lite' && !growthPrimaryActive && !strictGrowthRoute;
    const nodeReferences = collectNodeReferencesById(treeSource || parsed);
    const { tree: rawTree, nodeIds } = normalizeSyntaxTreeWithIds(treeSource, nodeReferences, framework, sentenceTokens);
    if (useAssistedStructurePath) {
      materializeLexicalPhrasalLeaves(rawTree);
    }
    const nodeById = buildNodeIndexFromTree(rawTree);
    const labelIndex = buildNodeLabelIndexFromTree(rawTree);
    const modelDerivationSteps = assignDerivationStepIds(normalizeDerivationSteps(parsed.derivationSteps, nodeIds));
    const rawMovementEvents = normalizeMovementEvents(parsed.movementEvents, nodeIds, modelDerivationSteps, nodeById, labelIndex);
    if (useAssistedStructurePath) {
      canonicalizeSplitClauseEdgeMovedPhrases(rawTree, rawMovementEvents);
    }
    const redirects = useAssistedStructurePath ? collapseOvertHeadLandingChains(rawTree) : new Map();
    const remappedDerivationSteps = redirects.size > 0
      ? remapDerivationStepsNodeIds(modelDerivationSteps, redirects)
      : modelDerivationSteps;
    const remappedRawMovementEvents = redirects.size > 0
      ? remapMovementEventsNodeIds(rawMovementEvents, redirects)
      : rawMovementEvents;
    const canonicalizedRawMovementEvents = useAssistedStructurePath
      ? canonicalizeHeadMoveSourceShells(rawTree, remappedRawMovementEvents)
      : remappedRawMovementEvents;
    const { tree, surfaceOrder } = validateAndCommitSurfaceOrder(parsed.surfaceOrder, rawTree, sentence);
    validateSpelloutConsistency(remappedDerivationSteps, tokenizeSentenceSurfaceOrder(sentence), surfaceOrder);
    const movementEvents = buildCanonicalMovementEvents({
      tree,
      derivationSteps: remappedDerivationSteps,
      rawMovementEvents: canonicalizedRawMovementEvents
    });
    const committedTree = growthPrimaryActive ? growthPrimaryBundle.tree : tree;
    stripMovementIndicesFromTree(tree);
    if (growthPrimaryActive) {
      stripMovementIndicesFromTree(committedTree);
    }
    const sentenceTokenSet = new Set(sentenceTokens.map(normalizeSurfaceToken).filter(Boolean));
    if (useAssistedStructurePath) {
      materializeEmptyStructuralLeaves(committedTree, sentenceTokenSet);
      promoteSentenceMatchingLeaves(committedTree, sentenceTokenSet);
    }
    const postStripOvertTerminals = collectOvertTerminalNodes(committedTree);
    const cleanSurfaceOrder = postStripOvertTerminals
      .map((node) => resolveNodeSurface(node))
      .map((token) => String(token || '').trim())
      .filter(Boolean);
    const committedSurfaceOrder = cleanSurfaceOrder.length > 0
      ? cleanSurfaceOrder
      : surfaceOrder;
    const movementEventsForCommittedTree = growthPrimaryActive
      ? (Array.isArray(growthPrimaryBundle?.movementEvents) && growthPrimaryBundle.movementEvents.length > 0
          ? growthPrimaryBundle.movementEvents
          : movementEvents)
      : movementEvents;
    materializeCommittedTraceShells(committedTree, movementEventsForCommittedTree);
    const canonicalTimeline = growthPrimaryActive
      ? null
      : buildCanonicalDerivationFromTree({
          tree: committedTree,
          movementEvents: movementEventsForCommittedTree,
          surfaceOrder: committedSurfaceOrder,
          modelDerivationSteps: remappedDerivationSteps
        });
    const authoritativeMovementEvents = growthPrimaryActive
      ? movementEventsForCommittedTree
      : canonicalTimeline.movementEvents;
    const growthDerivedSteps = growthPrimaryActive
      ? (Array.isArray(growthPrimaryBundle?.derivationSteps) && growthPrimaryBundle.derivationSteps.length > 0
          ? growthPrimaryBundle.derivationSteps
          : Array.isArray(remappedDerivationSteps) && remappedDerivationSteps.length > 0
            ? remappedDerivationSteps
            : [])
      : canonicalTimeline.derivationSteps;
    const reconciledDerivationSteps = reconcileDerivationStepOperations(
      growthDerivedSteps,
      authoritativeMovementEvents
    );
    const identifiedDerivationSteps = assignDerivationStepIds(reconciledDerivationSteps);
    const finalNodeIds = new Set(buildNodeIndexFromTree(committedTree).keys());
    const growthNodeIds = growthPrimaryActive ? collectGrowthFrameNodeIds(growthFrames) : new Set();
    const chainNodeIds = new Set([...finalNodeIds, ...growthNodeIds]);
    const suppliedChains = normalizeChains(parsed.chains, chainNodeIds);
    const canonicalChainEntries = suppliedChains.length > 0
      ? suppliedChains
      : deriveChainsFromCommittedAnalysis(identifiedDerivationSteps, authoritativeMovementEvents, finalNodeIds);
    runSemanticValidation('chain-consistency', () => {
      validatePronouncedCopiesAgainstCommittedTree({
        chains: canonicalChainEntries,
        tree: committedTree,
        movementEvents: authoritativeMovementEvents
      });
    });
    const chainIds = new Set(canonicalChainEntries.map((entry) => entry.chainId).filter(Boolean));
    const chainIdAliases = buildNoteBindingChainIdAliases(rawNoteBindings, canonicalChainEntries);
    const identifiedStepIds = new Set(
      (identifiedDerivationSteps || [])
        .map((step) => normalizeOptionalStepText(step?.stepId))
        .filter(Boolean)
    );
    const rawStepIds = new Set([
      ...(remappedDerivationSteps || []).map((step) => normalizeOptionalStepText(step?.stepId)).filter(Boolean),
      ...(identifiedDerivationSteps || []).map((step) => normalizeOptionalStepText(step?.stepId)).filter(Boolean)
    ]);
    const featureLedger = ensureStructuredEntryIds(
      normalizeFeatureLedger(parsed.featureLedger, finalNodeIds, rawStepIds),
      'entryId',
      'feature'
    );
    const researchTrace = normalizeResearchTrace(parsed.researchTrace, finalNodeIds, rawStepIds, chainIds);
    const caseAssignments = ensureStructuredEntryIds(
      normalizeCaseAssignments(parsed.caseAssignments, finalNodeIds, rawStepIds),
      'assignmentId',
      'case'
    );
    const argumentStructure = ensureStructuredEntryIds(
      normalizeArgumentStructure(parsed.argumentStructure, finalNodeIds, rawStepIds),
      'argumentId',
      'argument'
    );
    const phaseLog = normalizePhaseLog(parsed.phaseLog, finalNodeIds, rawStepIds);
    const morphologyRealization = normalizeMorphologyRealization(parsed.morphologyRealization, finalNodeIds, rawStepIds);
    const selectionLedger = ensureStructuredEntryIds(
      normalizeSelectionLedger(parsed.selectionLedger, finalNodeIds, rawStepIds),
      'selectionId',
      'selection'
    );
    const linearizationLedger = ensureStructuredEntryIds(
      normalizeLinearizationLedger(parsed.linearizationLedger, finalNodeIds, rawStepIds),
      'linearizationId',
      'lin'
    );
    const bindingLedger = ensureStructuredEntryIds(
      normalizeBindingLedger(parsed.bindingLedger, finalNodeIds, rawStepIds),
      'bindingId',
      'binding'
    );
    const clausalDependencies = ensureStructuredEntryIds(
      normalizeClausalDependencies(parsed.clausalDependencies, finalNodeIds, rawStepIds),
      'dependencyId',
      'dependency'
    );
    const agreementLedger = ensureStructuredEntryIds(
      normalizeAgreementLedger(parsed.agreementLedger, finalNodeIds, rawStepIds),
      'agreementId',
      'agreement'
    );
    const probeLedger = ensureStructuredEntryIds(
      normalizeProbeLedger(parsed.probeLedger, finalNodeIds, rawStepIds),
      'probeId',
      'probe'
    );
    const nullElementLedger = ensureStructuredEntryIds(
      normalizeNullElementLedger(parsed.nullElementLedger, finalNodeIds, rawStepIds),
      'nullElementId',
      'nullElement'
    );
    const predicateClassLedger = ensureStructuredEntryIds(
      normalizePredicateClassLedger(parsed.predicateClassLedger, finalNodeIds, rawStepIds),
      'predicateClassId',
      'predicateClass'
    );
    const diagnosticLedger = ensureStructuredEntryIds(
      normalizeDiagnosticLedger(parsed.diagnosticLedger, finalNodeIds, rawStepIds),
      'diagnosticId',
      'diagnostic'
    );
    const parameterLedger = ensureStructuredEntryIds(
      normalizeParameterLedger(parsed.parameterLedger, finalNodeIds, rawStepIds),
      'parameterId',
      'parameter'
    );
    const informationStructureLedger = ensureStructuredEntryIds(
      normalizeInformationStructureLedger(parsed.informationStructureLedger, finalNodeIds, rawStepIds),
      'informationStructureId',
      'info'
    );
    const operatorScopeLedger = ensureStructuredEntryIds(
      normalizeOperatorScopeLedger(parsed.operatorScopeLedger, finalNodeIds, rawStepIds),
      'operatorScopeId',
      'scope'
    );
    const voiceValencyLedger = ensureStructuredEntryIds(
      normalizeVoiceValencyLedger(parsed.voiceValencyLedger, finalNodeIds, rawStepIds),
      'voiceValencyId',
      'voice'
    );
    const localityLedger = ensureStructuredEntryIds(
      normalizeLocalityLedger(parsed.localityLedger, finalNodeIds, rawStepIds),
      'localityId',
      'local'
    );
    const predicationLedger = ensureStructuredEntryIds(
      normalizePredicationLedger(parsed.predicationLedger, finalNodeIds, rawStepIds),
      'predicationId',
      'pred'
    );
    const modelNoteBindings = normalizeNoteBindings(parsed.noteBindings, {
      stepIds: identifiedStepIds,
      nodeIds: finalNodeIds,
      chainIds,
      chainIdAliases,
      researchTraceIds: new Set(researchTrace.map((entry) => normalizeOptionalStepText(entry?.decisionId)).filter(Boolean)),
      featureEntryIds: new Set(featureLedger.map((entry) => normalizeOptionalStepText(entry?.entryId)).filter(Boolean)),
      caseAssignmentIds: new Set(caseAssignments.map((entry) => normalizeOptionalStepText(entry?.assignmentId)).filter(Boolean)),
      argumentIds: new Set(argumentStructure.map((entry) => normalizeOptionalStepText(entry?.argumentId)).filter(Boolean)),
      selectionIds: new Set(selectionLedger.map((entry) => normalizeOptionalStepText(entry?.selectionId)).filter(Boolean)),
      bindingIds: new Set(bindingLedger.map((entry) => normalizeOptionalStepText(entry?.bindingId)).filter(Boolean)),
      dependencyIds: new Set(clausalDependencies.map((entry) => normalizeOptionalStepText(entry?.dependencyId)).filter(Boolean)),
      agreementIds: new Set(agreementLedger.map((entry) => normalizeOptionalStepText(entry?.agreementId)).filter(Boolean)),
      predicateClassIds: new Set(predicateClassLedger.map((entry) => normalizeOptionalStepText(entry?.predicateClassId)).filter(Boolean)),
      probeIds: new Set(probeLedger.map((entry) => normalizeOptionalStepText(entry?.probeId)).filter(Boolean)),
      nullElementIds: new Set(nullElementLedger.map((entry) => normalizeOptionalStepText(entry?.nullElementId)).filter(Boolean)),
      diagnosticIds: new Set(diagnosticLedger.map((entry) => normalizeOptionalStepText(entry?.diagnosticId)).filter(Boolean)),
      parameterIds: new Set(parameterLedger.map((entry) => normalizeOptionalStepText(entry?.parameterId)).filter(Boolean)),
      informationStructureIds: new Set(informationStructureLedger.map((entry) => normalizeOptionalStepText(entry?.informationStructureId)).filter(Boolean)),
      operatorScopeIds: new Set(operatorScopeLedger.map((entry) => normalizeOptionalStepText(entry?.operatorScopeId)).filter(Boolean)),
      voiceValencyIds: new Set(voiceValencyLedger.map((entry) => normalizeOptionalStepText(entry?.voiceValencyId)).filter(Boolean)),
      linearizationIds: new Set(linearizationLedger.map((entry) => normalizeOptionalStepText(entry?.linearizationId)).filter(Boolean)),
      localityIds: new Set(localityLedger.map((entry) => normalizeOptionalStepText(entry?.localityId)).filter(Boolean)),
      predicationIds: new Set(predicationLedger.map((entry) => normalizeOptionalStepText(entry?.predicationId)).filter(Boolean))
    });
    const noteBindings = modelNoteBindings;
    const groundedExplanation = harmonizeExplanationWithDerivation(
      buildGroundedExplanation({
        tree: committedTree,
        derivationSteps: identifiedDerivationSteps,
        movementEvents: authoritativeMovementEvents,
        framework
      }),
      identifiedDerivationSteps,
      authoritativeMovementEvents,
      committedTree,
      framework
    );
    const coherentExplanation = noteBindings.length > 0
      ? buildExplanationFromNoteBindings(noteBindings)
      : (
          strictGrowthRoute
            ? (groundedExplanation || legacyModelExplanation)
            : (legacyModelExplanation || groundedExplanation)
        );
    auditNoteConsistency(() => {
      if (modelNoteBindings.length === 0) return;
      validateNoteBindingsAgainstStructuredAnalysis({
        noteBindings: modelNoteBindings,
        movementEvents: authoritativeMovementEvents,
        chains: canonicalChainEntries,
        clausalDependencies,
        caseAssignments,
        argumentStructure,
        selectionLedger,
        linearizationLedger,
        bindingLedger,
        agreementLedger,
        predicateClassLedger,
        probeLedger,
        nullElementLedger,
        diagnosticLedger,
        parameterLedger,
        informationStructureLedger,
        operatorScopeLedger,
        voiceValencyLedger,
        localityLedger,
        predicationLedger
      });
    });
    const completenessStatus = computeCompletenessStatus({
      growthFrames,
      rawDerivationSteps: remappedDerivationSteps,
      chains: canonicalChainEntries,
      researchTrace,
      caseAssignments,
      argumentStructure,
      phaseLog,
      morphologyRealization,
      featureLedger,
      selectionLedger,
      linearizationLedger,
      bindingLedger,
      clausalDependencies,
      agreementLedger,
      predicateClassLedger,
      probeLedger,
      nullElementLedger,
      diagnosticLedger,
      parameterLedger,
      informationStructureLedger,
      operatorScopeLedger,
      voiceValencyLedger,
      localityLedger,
      predicationLedger
    });
    const provenance = {
      modelRoute,
      framework,
      timestamp: new Date().toISOString(),
      treeSource: growthPrimaryActive ? 'growthFrames' : 'committedTree',
      promptVersion: normalizeOptionalStepText(process.env.BABEL_PROMPT_VERSION),
      parserVersion: normalizeOptionalStepText(process.env.BABEL_PARSER_VERSION || process.env.VERCEL_GIT_COMMIT_SHA),
      uiVersion: normalizeOptionalStepText(process.env.BABEL_UI_VERSION || process.env.VERCEL_GIT_COMMIT_SHA),
      hasResearchTrace: researchTrace.length > 0,
      hasGrowthFrames: growthFrames.length > 0,
      hasCaseAssignments: caseAssignments.length > 0,
      hasArgumentStructure: argumentStructure.length > 0,
      hasPhaseLog: phaseLog.length > 0,
      hasMorphologyRealization: morphologyRealization.length > 0,
      hasSelectionLedger: selectionLedger.length > 0,
      hasLinearizationLedger: linearizationLedger.length > 0,
      hasBindingLedger: bindingLedger.length > 0,
      hasClausalDependencies: clausalDependencies.length > 0,
      hasAgreementLedger: agreementLedger.length > 0,
      hasPredicateClassLedger: predicateClassLedger.length > 0,
      hasProbeLedger: probeLedger.length > 0,
      hasNullElementLedger: nullElementLedger.length > 0,
      hasDiagnosticLedger: diagnosticLedger.length > 0,
      hasParameterLedger: parameterLedger.length > 0,
      hasInformationStructureLedger: informationStructureLedger.length > 0,
      hasOperatorScopeLedger: operatorScopeLedger.length > 0,
      hasVoiceValencyLedger: voiceValencyLedger.length > 0,
      hasLocalityLedger: localityLedger.length > 0,
      hasPredicationLedger: predicationLedger.length > 0,
      completenessStatus
    };

    return {
      tree: committedTree,
      explanation: coherentExplanation,
      surfaceOrder: committedSurfaceOrder,
      growthFrames,
      noteBindings,
      rawDerivationSteps: remappedDerivationSteps,
      derivationSteps: identifiedDerivationSteps,
      movementEvents: authoritativeMovementEvents,
      chains: suppliedChains,
      researchTrace,
      caseAssignments,
      argumentStructure,
      phaseLog,
      morphologyRealization,
      featureLedger,
      selectionLedger,
      linearizationLedger,
      bindingLedger,
      clausalDependencies,
      agreementLedger,
      predicateClassLedger,
      probeLedger,
      nullElementLedger,
      diagnosticLedger,
      parameterLedger,
      informationStructureLedger,
      operatorScopeLedger,
      voiceValencyLedger,
      localityLedger,
      predicationLedger,
      provenance,
      completenessStatus
    };
  };

  const normalizeParseBundle = (value, framework = 'xbar', sentence = '', modelRoute = 'flash-lite', enforceGrowthRouteContract = false) => {
    const parsed = value;
    const analysesSource = Array.isArray(parsed?.analyses)
      ? parsed.analyses.slice(0, 1)
      : parsed
        ? [parsed]
        : [];

    const analyses = analysesSource
      .map((analysis) => normalizeParseResult(analysis, framework, sentence, modelRoute, enforceGrowthRouteContract))
      .slice(0, 1);

    if (analyses.length === 0) {
      throw new ParseApiError('BAD_MODEL_RESPONSE', 'No valid analyses returned by model.', 502);
    }

    return {
      analyses,
      ambiguityDetected: false,
      ambiguityNote: undefined
    };
  };

  const validateFinalProNoteBindings = (bundle) => {
    const analysis = bundle?.analyses?.[0];
    if (!analysis) return bundle;
    const noteBindings = Array.isArray(analysis.noteBindings) ? analysis.noteBindings : [];
    if (noteBindings.length > 0) return bundle;
    throw new ParseApiError(
      'BAD_MODEL_RESPONSE',
      'Pro analyses must include non-empty model-authored noteBindings on the final committed output.',
      422
    );
  };

  return {
    deriveChainsFromCommittedAnalysis,
    normalizeParseResult,
    normalizeParseBundle,
    validateFinalProNoteBindings
  };
};
