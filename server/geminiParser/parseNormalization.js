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
  collectNodeReferencesById,
  normalizeSyntaxTreeWithIds,
  buildNodeIndexFromTree,
  buildNodeLabelIndexFromTree,
  assignDerivationStepIds,
  normalizeDerivationSteps,
  normalizeMovementEvents,
  validateAndCommitSurfaceOrder,
  validateSpelloutConsistency,
  buildCanonicalMovementEvents,
  stripMovementIndicesFromTree,
  collectOvertTerminalNodes,
  resolveNodeSurface,
  materializeCommittedTraceShells,
  buildGroundedExplanation,
  harmonizeExplanationWithDerivation,
  collectGrowthFrameNodeIds,
  normalizeChains,
  normalizeResearchTrace,
  normalizeCommitmentGraph,
  projectLedgersFromCommitmentGraph,
  buildCommitmentGraphFromNormalizedLedgers,
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
  normalizeParticleLedger,
  normalizeEvidentialityLedger,
  normalizeMirativityLedger,
  normalizeHonorificityLedger,
  normalizeSwitchReferenceLedger,
  normalizeLogophoraLedger,
  normalizeEventStructureLedger,
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

  const dedupeChainNodeIds = (values, nodeIds) => Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || '').trim())
      .filter((nodeId) => nodeId && (!nodeIds || nodeIds.has(nodeId)))
  ));

  const buildChainStructuralKey = (entry, nodeIds) => {
    const keyParts = dedupeChainNodeIds(
      [
        ...(entry?.copies || []),
        ...(entry?.silentCopies || []),
        entry?.pronouncedCopy
      ],
      nodeIds
    ).sort();
    return keyParts.length > 0 ? keyParts.join('|') : '';
  };

  const nodeHasCommittedOvertYield = (node) =>
    Boolean(
      node
      && collectOvertTerminalNodes(node)
        .map((terminal) => resolveNodeSurface(terminal))
        .map((surface) => String(surface || '').trim())
        .filter(Boolean)
        .length > 0
    );

  const canonicalizeChainEntry = (entry, nodeIds, nodeById) => {
    if (!entry || typeof entry !== 'object') return null;
    const chainId = normalizeOptionalStepText(entry.chainId);
    if (!chainId) return null;

    const pronouncedCopy = (() => {
      const candidate = String(entry.pronouncedCopy || '').trim();
      if (!candidate || (nodeIds && !nodeIds.has(candidate))) return undefined;
      if (nodeById && !nodeHasCommittedOvertYield(nodeById.get(candidate) || null)) return undefined;
      return candidate;
    })();

    const explicitCopies = dedupeChainNodeIds(entry.copies, nodeIds);
    const explicitSilentCopies = dedupeChainNodeIds(entry.silentCopies, nodeIds)
      .filter((nodeId) => nodeId !== pronouncedCopy);
    const explicitSilentSet = new Set(explicitSilentCopies);
    const copies = dedupeChainNodeIds(
      [
        ...explicitCopies.filter((nodeId) => !explicitSilentSet.has(nodeId)),
        pronouncedCopy
      ],
      nodeIds
    );
    const silentCopies = dedupeChainNodeIds(
      explicitSilentCopies.length > 0
        ? explicitSilentCopies
        : copies.filter((nodeId) => nodeId !== pronouncedCopy),
      nodeIds
    ).filter((nodeId) => nodeId !== pronouncedCopy);
    const features = Array.from(new Set(
      (normalizeOptionalStringArray(entry.features) || []).filter(Boolean)
    ));

    return {
      chainId,
      type: normalizeChainType(entry.type),
      copies,
      pronouncedCopy,
      silentCopies,
      features: features.length > 0 ? features : undefined,
      note: normalizeOptionalStepText(entry.note)
    };
  };

  const buildCanonicalChains = ({ suppliedChains, derivationSteps, movementEvents, nodeIds, nodeById }) => {
    const modelChains = Array.isArray(suppliedChains) ? suppliedChains : [];
    const derivedChains = deriveChainsFromCommittedAnalysis(derivationSteps, movementEvents, nodeIds);
    const orderedChainIds = [];
    const seenChainIds = new Set();
    const derivedAliasById = new Map();

    const pushChainId = (chainId) => {
      const normalized = normalizeOptionalStepText(chainId);
      if (!normalized || seenChainIds.has(normalized)) return;
      seenChainIds.add(normalized);
      orderedChainIds.push(normalized);
    };

    const modelStructuralKeys = new Map();
    modelChains.forEach((entry) => {
      const chainId = normalizeOptionalStepText(entry?.chainId);
      const structuralKey = buildChainStructuralKey(entry, nodeIds);
      if (!chainId || !structuralKey || modelStructuralKeys.has(structuralKey)) return;
      modelStructuralKeys.set(structuralKey, chainId);
    });
    derivedChains.forEach((entry) => {
      const derivedChainId = normalizeOptionalStepText(entry?.chainId);
      const structuralKey = buildChainStructuralKey(entry, nodeIds);
      if (!derivedChainId || !structuralKey) return;
      const aliasedModelChainId = modelStructuralKeys.get(structuralKey);
      if (aliasedModelChainId && aliasedModelChainId !== derivedChainId) {
        derivedAliasById.set(derivedChainId, aliasedModelChainId);
      }
    });

    modelChains.forEach((entry) => pushChainId(entry?.chainId));
    derivedChains.forEach((entry) => pushChainId(derivedAliasById.get(normalizeOptionalStepText(entry?.chainId)) || entry?.chainId));

    const modelChainsById = new Map(
      modelChains
        .map((entry) => [normalizeOptionalStepText(entry?.chainId), entry])
        .filter(([chainId]) => Boolean(chainId))
    );
    const derivedChainsById = new Map();
    derivedChains.forEach((entry) => {
      const originalChainId = normalizeOptionalStepText(entry?.chainId);
      const chainId = derivedAliasById.get(originalChainId) || originalChainId;
      if (!chainId) return;
      const existing = derivedChainsById.get(chainId);
      if (!existing) {
        derivedChainsById.set(chainId, { ...entry, chainId });
        return;
      }
      derivedChainsById.set(chainId, {
        chainId,
        type: mergeChainTypes(existing?.type, entry?.type),
        copies: [...(existing?.copies || []), ...(entry?.copies || [])],
        pronouncedCopy: existing?.pronouncedCopy || entry?.pronouncedCopy,
        silentCopies: [...(existing?.silentCopies || []), ...(entry?.silentCopies || [])],
        features: [...(existing?.features || []), ...(entry?.features || [])],
        note: existing?.note || entry?.note
      });
    });

    return orderedChainIds
      .map((chainId) => {
        const modelEntry = modelChainsById.get(chainId) || null;
        const derivedEntry = derivedChainsById.get(chainId) || null;
        return canonicalizeChainEntry({
          chainId,
          type: mergeChainTypes(modelEntry?.type, derivedEntry?.type),
          copies: [
            ...(modelEntry?.copies || []),
            modelEntry?.pronouncedCopy,
            ...(derivedEntry?.copies || []),
            derivedEntry?.pronouncedCopy
          ],
          pronouncedCopy: modelEntry?.pronouncedCopy || derivedEntry?.pronouncedCopy,
          silentCopies: [
            ...(modelEntry?.silentCopies || []),
            ...(derivedEntry?.silentCopies || [])
          ],
          features: [
            ...(modelEntry?.features || []),
            ...(derivedEntry?.features || [])
          ],
          note: modelEntry?.note || derivedEntry?.note
        }, nodeIds, nodeById);
      })
      .filter(Boolean);
  };

  const buildChainsWithFieldFallback = ({ suppliedChains, canonicalChains, nodeIds }) => {
    const modelChains = Array.isArray(suppliedChains) ? suppliedChains : [];
    const compiledChains = Array.isArray(canonicalChains) ? canonicalChains : [];
    if (modelChains.length === 0) return [];

    const canonicalById = new Map(
      compiledChains
        .map((entry) => [normalizeOptionalStepText(entry?.chainId), entry])
        .filter(([chainId]) => Boolean(chainId))
    );
    const canonicalByStructuralKey = new Map();
    compiledChains.forEach((entry) => {
      const structuralKey = buildChainStructuralKey(entry, nodeIds);
      if (!structuralKey || canonicalByStructuralKey.has(structuralKey)) return;
      canonicalByStructuralKey.set(structuralKey, entry);
    });

    return modelChains
      .map((modelEntry) => {
        const chainId = normalizeOptionalStepText(modelEntry?.chainId);
        if (!chainId) return null;
        const fallbackEntry = canonicalById.get(chainId)
          || canonicalByStructuralKey.get(buildChainStructuralKey(modelEntry, nodeIds))
          || null;
        const hasModelCopies = Array.isArray(modelEntry?.copies) && modelEntry.copies.length > 0;
        const hasModelPronouncedCopy = Boolean(String(modelEntry?.pronouncedCopy || '').trim());
        const pronouncedCopy = hasModelPronouncedCopy
          ? String(modelEntry.pronouncedCopy || '').trim() || undefined
          : String(fallbackEntry?.pronouncedCopy || '').trim() || undefined;
        const hasModelSilentCopies = Array.isArray(modelEntry?.silentCopies) && modelEntry.silentCopies.length > 0;
        const silentCopies = dedupeChainNodeIds(
          hasModelSilentCopies
            ? modelEntry.silentCopies
            : fallbackEntry?.silentCopies,
          nodeIds
        ).filter((nodeId) => nodeId !== pronouncedCopy);
        const silentCopySet = new Set(silentCopies);
        const rawCopies = dedupeChainNodeIds(
          hasModelCopies
            ? modelEntry.copies
            : fallbackEntry?.copies,
          nodeIds
        );
        const copies = dedupeChainNodeIds(
          [
            ...rawCopies.filter((nodeId) => !silentCopySet.has(nodeId)),
            pronouncedCopy
          ],
          nodeIds
        );
        return {
          chainId,
          type: normalizeChainType(modelEntry?.type || fallbackEntry?.type),
          copies,
          pronouncedCopy,
          silentCopies,
          features: normalizeOptionalStringArray(modelEntry?.features) || normalizeOptionalStringArray(fallbackEntry?.features),
          note: normalizeOptionalStepText(modelEntry?.note || fallbackEntry?.note)
        };
      })
      .filter(Boolean);
  };

  // Keep low-level movementEvents aligned with the public chains ledger when the
  // model omitted event.chainId but already supplied a coherent chain entry.
  const backfillMovementEventChainIds = ({ movementEvents, chains, derivationSteps }) => {
    const events = Array.isArray(movementEvents) ? movementEvents : [];
    const chainEntries = Array.isArray(chains) ? chains : [];
    if (events.length === 0 || chainEntries.length === 0) return events;

    const chainIdSet = new Set(
      chainEntries
        .map((entry) => normalizeOptionalStepText(entry?.chainId))
        .filter(Boolean)
    );
    const steps = Array.isArray(derivationSteps) ? derivationSteps : [];
    const preparedChains = chainEntries
      .map((entry) => {
        const chainId = normalizeOptionalStepText(entry?.chainId);
        if (!chainId) return null;
        const copySet = new Set(dedupeChainNodeIds(entry?.copies));
        const silentCopySet = new Set(dedupeChainNodeIds(entry?.silentCopies));
        const pronouncedCopy = normalizeOptionalStepText(entry?.pronouncedCopy);
        if (pronouncedCopy) copySet.add(pronouncedCopy);
        return {
          chainId,
          type: normalizeChainType(entry?.type),
          copySet,
          silentCopySet,
          pronouncedCopy
        };
      })
      .filter(Boolean);

    const scoreChainCandidate = (event, candidate, eventIndex) => {
      const operationType = deriveChainTypeFromOperation(normalizeMovementOperation(event?.operation));
      const targetNodeId = normalizeOptionalStepText(event?.toNodeId);
      const traceNodeId = normalizeOptionalStepText(event?.traceNodeId);
      const sourceNodeId = normalizeOptionalStepText(event?.fromNodeId);
      const stepIndex = Number.isInteger(event?.stepIndex) ? event.stepIndex : -1;
      const step = stepIndex >= 0 && stepIndex < steps.length ? steps[stepIndex] : null;
      const implicitChainId = deriveImplicitGrowthChainId(step, event, eventIndex);

      const targetIsPronounced = Boolean(targetNodeId && candidate.pronouncedCopy === targetNodeId);
      const targetIsSilent = Boolean(targetNodeId && candidate.silentCopySet.has(targetNodeId));
      const targetIsCopy = Boolean(targetNodeId && candidate.copySet.has(targetNodeId));
      if (!targetIsPronounced && !targetIsSilent && !targetIsCopy) return Number.NEGATIVE_INFINITY;

      const lowerMatchesSilent = Boolean(
        (traceNodeId && candidate.silentCopySet.has(traceNodeId))
        || (sourceNodeId && candidate.silentCopySet.has(sourceNodeId))
      );
      const lowerMatchesCopy = Boolean(
        (traceNodeId && candidate.copySet.has(traceNodeId))
        || (sourceNodeId && candidate.copySet.has(sourceNodeId))
        || (traceNodeId && candidate.pronouncedCopy === traceNodeId)
        || (sourceNodeId && candidate.pronouncedCopy === sourceNodeId)
      );
      if (!lowerMatchesSilent && !lowerMatchesCopy) return Number.NEGATIVE_INFINITY;

      let score = 0;
      if (targetIsPronounced) score += 10;
      else if (targetIsCopy) score += 8;
      else if (targetIsSilent) score += 6;

      if (lowerMatchesSilent) score += 7;
      else if (lowerMatchesCopy) score += 4;

      if (operationType && candidate.type && operationType === candidate.type) score += 3;
      if (implicitChainId && candidate.chainId === implicitChainId) score += 5;
      return score;
    };

    return events.map((event, eventIndex) => {
      const explicitChainId = normalizeOptionalStepText(event?.chainId);
      if (explicitChainId) return event;

      let bestCandidate = null;
      let bestScore = Number.NEGATIVE_INFINITY;
      let isTied = false;

      preparedChains.forEach((candidate) => {
        const score = scoreChainCandidate(event, candidate, eventIndex);
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = candidate;
          isTied = false;
          return;
        }
        if (score === bestScore && score > Number.NEGATIVE_INFINITY) {
          isTied = true;
        }
      });

      if (bestCandidate && !isTied) {
        return { ...event, chainId: bestCandidate.chainId };
      }

      const stepIndex = Number.isInteger(event?.stepIndex) ? event.stepIndex : -1;
      const step = stepIndex >= 0 && stepIndex < steps.length ? steps[stepIndex] : null;
      const implicitChainId = deriveImplicitGrowthChainId(step, event, eventIndex);
      if (implicitChainId && chainIdSet.has(implicitChainId)) {
        return { ...event, chainId: implicitChainId };
      }

      return event;
    });
  };

  const parseRawTransportArray = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const buildRawMovementEventIdentityKey = (event) => {
    if (!event || typeof event !== 'object') return '';
    return JSON.stringify({
      stepId: normalizeOptionalStepText(event.stepId),
      stepIndex: Number.isInteger(event.stepIndex) ? event.stepIndex : undefined,
      operation: normalizeMovementOperation(event.operation || event.type) || '',
      fromNodeId: String(event.fromNodeId || event.sourceNodeId || event.source || '').trim(),
      toNodeId: String(event.toNodeId || event.targetNodeId || event.target || '').trim(),
      traceNodeId: String(event.traceNodeId || event.trace || '').trim(),
      chainId: normalizeOptionalStepText(event.chainId)
    });
  };

  const buildIndexedRawStepIdCandidates = (rawItems, { moveLikeOnly = false } = {}) => (
    parseRawTransportArray(rawItems)
      .map((item) => (item && typeof item === 'object' ? item : null))
      .filter(Boolean)
      .filter((item) => {
        if (!moveLikeOnly) return true;
        const operation = normalizeMovementOperation(item.operation);
        return Boolean(operation) && operation !== 'Other';
      })
      .map((item) => normalizeOptionalStepText(item.stepId))
  );

  const buildRawStepOperationByStepId = (...rawCollections) => {
    const operationByStepId = new Map();
    rawCollections.forEach((rawItems) => {
      parseRawTransportArray(rawItems).forEach((item) => {
        if (!item || typeof item !== 'object') return;
        const stepId = normalizeOptionalStepText(item.stepId);
        const operation = normalizeMovementOperation(item.operation);
        if (!stepId || !operation || operation === 'Other') return;
        const current = operationByStepId.get(stepId);
        if (!current) {
          operationByStepId.set(stepId, operation);
          return;
        }
        if (current !== operation) {
          operationByStepId.set(stepId, 'Other');
        }
      });
    });
    return operationByStepId;
  };

  const inferRawMovementEventStepIdFromStepIndex = ({
    event,
    rawGrowthFrames,
    rawDerivationSteps,
    operationByStepId
  }) => {
    if (!event || typeof event !== 'object') return undefined;
    if (normalizeOptionalStepText(event.stepId)) return normalizeOptionalStepText(event.stepId);

    const rawStepIndex = Number(event.stepIndex);
    if (!Number.isInteger(rawStepIndex)) return undefined;

    const normalizedEventOperation = normalizeMovementOperation(event.operation || event.type);
    const filterCompatibleCandidates = (candidateIds) => candidateIds.filter((stepId) => {
      const candidateOperation = operationByStepId.get(stepId);
      if (!candidateOperation || candidateOperation === 'Other') return false;
      if (!normalizedEventOperation || normalizedEventOperation === 'Other') return true;
      return candidateOperation === normalizedEventOperation;
    });

    const candidateGroups = [
      buildIndexedRawStepIdCandidates(rawGrowthFrames),
      buildIndexedRawStepIdCandidates(rawGrowthFrames, { moveLikeOnly: true }),
      buildIndexedRawStepIdCandidates(rawDerivationSteps),
      buildIndexedRawStepIdCandidates(rawDerivationSteps, { moveLikeOnly: true })
    ].map((stepIds) => {
      if (!Array.isArray(stepIds) || stepIds.length === 0) return [];
      const zeroBased = normalizeOptionalStepText(stepIds[rawStepIndex]);
      const oneBased = rawStepIndex > 0
        ? normalizeOptionalStepText(stepIds[rawStepIndex - 1])
        : undefined;
      return Array.from(new Set([zeroBased, oneBased].filter(Boolean)));
    });

    for (const candidateIds of candidateGroups) {
      if (candidateIds.length === 0) continue;
      const compatibleCandidates = filterCompatibleCandidates(candidateIds);
      if (compatibleCandidates.length === 1) {
        return compatibleCandidates[0];
      }
      if (candidateIds.length === 1) {
        return candidateIds[0];
      }
    }

    return undefined;
  };

  const mergeRawMovementEvents = ({
    topLevelMovementEvents,
    rawGrowthFrames,
    rawDerivationSteps,
    payloadIntegrityFlags
  }) => {
    const merged = [];
    const seen = new Set();
    let harvestedFromGrowthFrames = false;
    let harvestedFromDerivationSteps = false;
    let inferredStepIdFromStepIndex = false;
    const operationByStepId = buildRawStepOperationByStepId(rawGrowthFrames, rawDerivationSteps);

    const pushEvent = (event, inheritedStepId = '') => {
      if (!event || typeof event !== 'object') return;
      const normalizedInheritedStepId = normalizeOptionalStepText(inheritedStepId);
      const inferredStepId = normalizedInheritedStepId || inferRawMovementEventStepIdFromStepIndex({
        event,
        rawGrowthFrames,
        rawDerivationSteps,
        operationByStepId
      });
      const enrichedEvent = inferredStepId && !normalizeOptionalStepText(event.stepId)
        ? { ...event, stepId: inferredStepId }
        : event;
      if (!normalizedInheritedStepId && inferredStepId && !normalizeOptionalStepText(event.stepId)) {
        inferredStepIdFromStepIndex = true;
      }
      const key = buildRawMovementEventIdentityKey(enrichedEvent);
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push(enrichedEvent);
    };

    // Use a wrapper so Array#forEach does not leak the element index into the
    // inheritedStepId slot. That index leak can silently fabricate step ids like "1".
    parseRawTransportArray(topLevelMovementEvents).forEach((event) => pushEvent(event));

    parseRawTransportArray(rawGrowthFrames).forEach((frame) => {
      if (!frame || typeof frame !== 'object') return;
      const frameStepId = normalizeOptionalStepText(frame.stepId);
      const nestedEvents = parseRawTransportArray(frame.movementEvents);
      if (nestedEvents.length === 0) return;
      harvestedFromGrowthFrames = true;
      nestedEvents.forEach((event) => pushEvent(event, frameStepId));
    });

    parseRawTransportArray(rawDerivationSteps).forEach((step) => {
      if (!step || typeof step !== 'object') return;
      const stepId = normalizeOptionalStepText(step.stepId);
      const nestedEvents = parseRawTransportArray(step.movementEvents);
      if (nestedEvents.length === 0) return;
      harvestedFromDerivationSteps = true;
      nestedEvents.forEach((event) => pushEvent(event, stepId));
    });

    if (harvestedFromGrowthFrames) {
      payloadIntegrityFlags.push('nested_movement_events_lifted_from_growth_frames');
    }
    if (harvestedFromDerivationSteps) {
      payloadIntegrityFlags.push('nested_movement_events_lifted_from_derivation_steps');
    }
    if (inferredStepIdFromStepIndex) {
      payloadIntegrityFlags.push('movement_event_stepid_inferred_from_stepindex');
    }

    return merged.length > 0 ? merged : undefined;
  };

  const normalizeParseResult = (
    value,
    framework = 'xbar',
    sentence = '',
    modelRoute = 'pro',
    enforceGrowthRouteContract = false,
    options = {}
  ) => {
    const parsed = value;
    if (!parsed || typeof parsed !== 'object') {
      throw new ParseApiError('BAD_MODEL_RESPONSE', 'Malformed parse result from model.', 502);
    }
    const payloadIntegrityFlags = Array.isArray(options?.payloadIntegrityFlags)
      ? options.payloadIntegrityFlags.slice()
      : [];
    const requireFullGrowthFrameContract = enforceGrowthRouteContract;
    const minGrowthFrames = 4;
    const rawGrowthFrames = Array.isArray(parsed.growthFrames) ? parsed.growthFrames : [];
    const rawMovementEvents = mergeRawMovementEvents({
      topLevelMovementEvents: parsed.movementEvents,
      rawGrowthFrames,
      rawDerivationSteps: parsed.derivationSteps,
      payloadIntegrityFlags
    });
    if (requireFullGrowthFrameContract && rawGrowthFrames.length < minGrowthFrames) {
      throw new ParseApiError(
        'BAD_MODEL_RESPONSE',
        `Pro analysis must include at least ${minGrowthFrames} growthFrames.`,
        502
      );
    }

    const rawNoteBindings = normalizeNoteBindings(parsed.noteBindings);
    const sentenceTokens = tokenizeSentenceSurfaceOrder(sentence);
    const growthFrames = materializeImplicitPhrasalTraceShellsInGrowthFrames(
      normalizeGrowthFrames(parsed.growthFrames, framework, sentenceTokens, {
        rawMovementEvents,
        rawDerivationSteps: parsed.derivationSteps,
        integrityFlags: payloadIntegrityFlags
      })
    );
    const growthPrimaryBundle = growthFrames.length > 0
      ? buildCanonicalDerivationFromGrowthFrames(growthFrames, sentenceTokens, framework)
      : null;
    if (!growthPrimaryBundle?.tree) {
      throw new ParseApiError(
        'BAD_MODEL_RESPONSE',
        growthFrames.length > 0
          ? 'Growth frames never produced a committed final structure whose overt terminals match the input sentence.'
          : 'Growth-route analysis failed to produce a committed tree from growthFrames.',
        502
      );
    }
    const treeSource = growthPrimaryBundle.tree;
    const nodeReferences = collectNodeReferencesById(treeSource);
    const { tree: rawTree, nodeIds } = normalizeSyntaxTreeWithIds(treeSource, nodeReferences, framework, sentenceTokens);
    const nodeById = buildNodeIndexFromTree(rawTree);
    const labelIndex = buildNodeLabelIndexFromTree(rawTree);
    const modelDerivationSteps = assignDerivationStepIds(normalizeDerivationSteps(parsed.derivationSteps, nodeIds));
    const normalizedRawMovementEvents = normalizeMovementEvents(rawMovementEvents, nodeIds, modelDerivationSteps, nodeById, labelIndex);
    const { tree, surfaceOrder } = validateAndCommitSurfaceOrder(parsed.surfaceOrder, rawTree, sentence);
    validateSpelloutConsistency(modelDerivationSteps, tokenizeSentenceSurfaceOrder(sentence), surfaceOrder);
    const movementEvents = buildCanonicalMovementEvents({
      tree,
      derivationSteps: modelDerivationSteps,
      rawMovementEvents: normalizedRawMovementEvents
    });
    const committedTree = growthPrimaryBundle.tree;
    stripMovementIndicesFromTree(tree);
    if (committedTree !== tree) {
      stripMovementIndicesFromTree(committedTree);
    }
    const postStripOvertTerminals = collectOvertTerminalNodes(committedTree);
    const cleanSurfaceOrder = postStripOvertTerminals
      .map((node) => resolveNodeSurface(node))
      .map((token) => String(token || '').trim())
      .filter(Boolean);
    const committedSurfaceOrder = cleanSurfaceOrder.length > 0
      ? cleanSurfaceOrder
      : surfaceOrder;
    const movementEventsForCommittedTree = Array.isArray(growthPrimaryBundle?.movementEvents) && growthPrimaryBundle.movementEvents.length > 0
      ? growthPrimaryBundle.movementEvents
      : movementEvents;
    materializeCommittedTraceShells(committedTree, movementEventsForCommittedTree);
    const authoritativeMovementEvents = movementEventsForCommittedTree;
    const growthDerivedSteps = Array.isArray(growthPrimaryBundle?.derivationSteps) && growthPrimaryBundle.derivationSteps.length > 0
      ? growthPrimaryBundle.derivationSteps
      : Array.isArray(modelDerivationSteps) && modelDerivationSteps.length > 0
        ? modelDerivationSteps
        : [];
    const identifiedDerivationSteps = assignDerivationStepIds(growthDerivedSteps);
    const committedNodeById = buildNodeIndexFromTree(committedTree);
    const finalNodeIds = new Set(committedNodeById.keys());
    const growthNodeIds = collectGrowthFrameNodeIds(growthFrames);
    const chainNodeIds = new Set([...finalNodeIds, ...growthNodeIds]);
    const suppliedChains = normalizeChains(parsed.chains, chainNodeIds);
    const canonicalChainEntries = buildCanonicalChains({
      suppliedChains,
      derivationSteps: identifiedDerivationSteps,
      movementEvents: authoritativeMovementEvents,
      nodeIds: chainNodeIds,
      nodeById: committedNodeById
    });
    const chainsWithFieldFallback = buildChainsWithFieldFallback({
      suppliedChains,
      canonicalChains: canonicalChainEntries,
      nodeIds: chainNodeIds
    });
    const authoritativeMovementEventsWithChainIds = backfillMovementEventChainIds({
      movementEvents: authoritativeMovementEvents,
      chains: chainsWithFieldFallback,
      derivationSteps: identifiedDerivationSteps
    });
    runSemanticValidation('chain-consistency', () => {
      validatePronouncedCopiesAgainstCommittedTree({
        chains: chainsWithFieldFallback,
        tree: committedTree,
        movementEvents: authoritativeMovementEventsWithChainIds
      });
    });
    const chainIds = new Set(chainsWithFieldFallback.map((entry) => entry.chainId).filter(Boolean));
    const chainIdAliases = buildNoteBindingChainIdAliases(rawNoteBindings, chainsWithFieldFallback);
    const identifiedStepIds = new Set(
      (identifiedDerivationSteps || [])
        .map((step) => normalizeOptionalStepText(step?.stepId))
        .filter(Boolean)
    );
    const rawStepIds = new Set([
      ...(modelDerivationSteps || []).map((step) => normalizeOptionalStepText(step?.stepId)).filter(Boolean),
      ...(identifiedDerivationSteps || []).map((step) => normalizeOptionalStepText(step?.stepId)).filter(Boolean)
    ]);
    const directFeatureLedger = ensureStructuredEntryIds(
      normalizeFeatureLedger(parsed.featureLedger, finalNodeIds, rawStepIds),
      'entryId',
      'feature'
    );
    const researchTrace = normalizeResearchTrace(parsed.researchTrace, finalNodeIds, rawStepIds, chainIds);
    const directCaseAssignments = ensureStructuredEntryIds(
      normalizeCaseAssignments(parsed.caseAssignments, finalNodeIds, rawStepIds),
      'assignmentId',
      'case'
    );
    const directArgumentStructure = ensureStructuredEntryIds(
      normalizeArgumentStructure(parsed.argumentStructure, finalNodeIds, rawStepIds),
      'argumentId',
      'argument'
    );
    const directPhaseLog = normalizePhaseLog(parsed.phaseLog, finalNodeIds, rawStepIds);
    const directMorphologyRealization = normalizeMorphologyRealization(parsed.morphologyRealization, finalNodeIds, rawStepIds);
    const directSelectionLedger = ensureStructuredEntryIds(
      normalizeSelectionLedger(parsed.selectionLedger, finalNodeIds, rawStepIds),
      'selectionId',
      'selection'
    );
    const directLinearizationLedger = ensureStructuredEntryIds(
      normalizeLinearizationLedger(parsed.linearizationLedger, finalNodeIds, rawStepIds),
      'linearizationId',
      'lin'
    );
    const directBindingLedger = ensureStructuredEntryIds(
      normalizeBindingLedger(parsed.bindingLedger, finalNodeIds, rawStepIds),
      'bindingId',
      'binding'
    );
    const directClausalDependencies = ensureStructuredEntryIds(
      normalizeClausalDependencies(parsed.clausalDependencies, finalNodeIds, rawStepIds),
      'dependencyId',
      'dependency'
    );
    const directAgreementLedger = ensureStructuredEntryIds(
      normalizeAgreementLedger(parsed.agreementLedger, finalNodeIds, rawStepIds),
      'agreementId',
      'agreement'
    );
    const directProbeLedger = ensureStructuredEntryIds(
      normalizeProbeLedger(parsed.probeLedger, finalNodeIds, rawStepIds),
      'probeId',
      'probe'
    );
    const directNullElementLedger = ensureStructuredEntryIds(
      normalizeNullElementLedger(parsed.nullElementLedger, finalNodeIds, rawStepIds),
      'nullElementId',
      'nullElement'
    );
    const directPredicateClassLedger = ensureStructuredEntryIds(
      normalizePredicateClassLedger(parsed.predicateClassLedger, finalNodeIds, rawStepIds),
      'predicateClassId',
      'predicateClass'
    );
    const directDiagnosticLedger = ensureStructuredEntryIds(
      normalizeDiagnosticLedger(parsed.diagnosticLedger, finalNodeIds, rawStepIds),
      'diagnosticId',
      'diagnostic'
    );
    const directParameterLedger = ensureStructuredEntryIds(
      normalizeParameterLedger(parsed.parameterLedger, finalNodeIds, rawStepIds),
      'parameterId',
      'parameter'
    );
    const directInformationStructureLedger = ensureStructuredEntryIds(
      normalizeInformationStructureLedger(parsed.informationStructureLedger, finalNodeIds, rawStepIds),
      'informationStructureId',
      'info'
    );
    const directOperatorScopeLedger = ensureStructuredEntryIds(
      normalizeOperatorScopeLedger(parsed.operatorScopeLedger, finalNodeIds, rawStepIds),
      'operatorScopeId',
      'scope'
    );
    const directVoiceValencyLedger = ensureStructuredEntryIds(
      normalizeVoiceValencyLedger(parsed.voiceValencyLedger, finalNodeIds, rawStepIds),
      'voiceValencyId',
      'voice'
    );
    const directLocalityLedger = ensureStructuredEntryIds(
      normalizeLocalityLedger(parsed.localityLedger, finalNodeIds, rawStepIds),
      'localityId',
      'local'
    );
    const directPredicationLedger = ensureStructuredEntryIds(
      normalizePredicationLedger(parsed.predicationLedger, finalNodeIds, rawStepIds),
      'predicationId',
      'pred'
    );
    const directParticleLedger = ensureStructuredEntryIds(
      normalizeParticleLedger(parsed.particleLedger, finalNodeIds, rawStepIds),
      'particleId',
      'particle'
    );
    const directEvidentialityLedger = ensureStructuredEntryIds(
      normalizeEvidentialityLedger(parsed.evidentialityLedger, finalNodeIds, rawStepIds),
      'evidentialityId',
      'evidentiality'
    );
    const directMirativityLedger = ensureStructuredEntryIds(
      normalizeMirativityLedger(parsed.mirativityLedger, finalNodeIds, rawStepIds),
      'mirativityId',
      'mirativity'
    );
    const directHonorificityLedger = ensureStructuredEntryIds(
      normalizeHonorificityLedger(parsed.honorificityLedger, finalNodeIds, rawStepIds),
      'honorificityId',
      'honorificity'
    );
    const directSwitchReferenceLedger = ensureStructuredEntryIds(
      normalizeSwitchReferenceLedger(parsed.switchReferenceLedger, finalNodeIds, rawStepIds),
      'switchReferenceId',
      'switchref'
    );
    const directLogophoraLedger = ensureStructuredEntryIds(
      normalizeLogophoraLedger(parsed.logophoraLedger, finalNodeIds, rawStepIds),
      'logophoraId',
      'logophora'
    );
    const directEventStructureLedger = ensureStructuredEntryIds(
      normalizeEventStructureLedger(parsed.eventStructureLedger, finalNodeIds, rawStepIds),
      'eventStructureId',
      'eventstruct'
    );
    const rawCommitmentGraph = normalizeCommitmentGraph(parsed.commitmentGraph, finalNodeIds, rawStepIds);
    const projectedCommitmentLedgers = projectLedgersFromCommitmentGraph(rawCommitmentGraph, finalNodeIds, rawStepIds);
    const useCommitmentGraph = rawCommitmentGraph.length > 0;
    const featureLedger = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.featureLedger, 'entryId', 'feature')
      : directFeatureLedger;
    const caseAssignments = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.caseAssignments, 'assignmentId', 'case')
      : directCaseAssignments;
    const argumentStructure = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.argumentStructure, 'argumentId', 'argument')
      : directArgumentStructure;
    const phaseLog = useCommitmentGraph
      ? projectedCommitmentLedgers.phaseLog
      : directPhaseLog;
    const morphologyRealization = useCommitmentGraph
      ? projectedCommitmentLedgers.morphologyRealization
      : directMorphologyRealization;
    const selectionLedger = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.selectionLedger, 'selectionId', 'selection')
      : directSelectionLedger;
    const linearizationLedger = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.linearizationLedger, 'linearizationId', 'lin')
      : directLinearizationLedger;
    const bindingLedger = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.bindingLedger, 'bindingId', 'binding')
      : directBindingLedger;
    const clausalDependencies = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.clausalDependencies, 'dependencyId', 'dependency')
      : directClausalDependencies;
    const agreementLedger = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.agreementLedger, 'agreementId', 'agreement')
      : directAgreementLedger;
    const probeLedger = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.probeLedger, 'probeId', 'probe')
      : directProbeLedger;
    const nullElementLedger = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.nullElementLedger, 'nullElementId', 'nullElement')
      : directNullElementLedger;
    const predicateClassLedger = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.predicateClassLedger, 'predicateClassId', 'predicateClass')
      : directPredicateClassLedger;
    const diagnosticLedger = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.diagnosticLedger, 'diagnosticId', 'diagnostic')
      : directDiagnosticLedger;
    const parameterLedger = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.parameterLedger, 'parameterId', 'parameter')
      : directParameterLedger;
    const informationStructureLedger = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.informationStructureLedger, 'informationStructureId', 'info')
      : directInformationStructureLedger;
    const operatorScopeLedger = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.operatorScopeLedger, 'operatorScopeId', 'scope')
      : directOperatorScopeLedger;
    const voiceValencyLedger = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.voiceValencyLedger, 'voiceValencyId', 'voice')
      : directVoiceValencyLedger;
    const localityLedger = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.localityLedger, 'localityId', 'local')
      : directLocalityLedger;
    const predicationLedger = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.predicationLedger, 'predicationId', 'pred')
      : directPredicationLedger;
    const particleLedger = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.particleLedger, 'particleId', 'particle')
      : directParticleLedger;
    const evidentialityLedger = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.evidentialityLedger, 'evidentialityId', 'evidentiality')
      : directEvidentialityLedger;
    const mirativityLedger = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.mirativityLedger, 'mirativityId', 'mirativity')
      : directMirativityLedger;
    const honorificityLedger = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.honorificityLedger, 'honorificityId', 'honorificity')
      : directHonorificityLedger;
    const switchReferenceLedger = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.switchReferenceLedger, 'switchReferenceId', 'switchref')
      : directSwitchReferenceLedger;
    const logophoraLedger = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.logophoraLedger, 'logophoraId', 'logophora')
      : directLogophoraLedger;
    const eventStructureLedger = useCommitmentGraph
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.eventStructureLedger, 'eventStructureId', 'eventstruct')
      : directEventStructureLedger;
    const commitmentGraph = buildCommitmentGraphFromNormalizedLedgers({
      caseAssignments,
      argumentStructure,
      phaseLog,
      morphologyRealization,
      featureLedger,
      selectionLedger,
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
      linearizationLedger,
      localityLedger,
      predicationLedger,
      particleLedger,
      evidentialityLedger,
      mirativityLedger,
      honorificityLedger,
      switchReferenceLedger,
      logophoraLedger,
      eventStructureLedger
    });
    const modelNoteBindings = normalizeNoteBindings(parsed.noteBindings, {
      stepIds: identifiedStepIds,
      nodeIds: finalNodeIds,
      chainIds,
      chainIdAliases,
      commitmentFactIds: new Set(commitmentGraph.map((entry) => normalizeOptionalStepText(entry?.factId)).filter(Boolean)),
      researchTraceIds: new Set(researchTrace.map((entry) => normalizeOptionalStepText(entry?.decisionId)).filter(Boolean)),
      featureEntryIds: new Set(featureLedger.map((entry) => normalizeOptionalStepText(entry?.entryId)).filter(Boolean)),
      phaseIds: new Set(phaseLog.map((entry) => normalizeOptionalStepText(entry?.phaseId)).filter(Boolean)),
      morphologyIds: new Set(morphologyRealization.map((entry) => normalizeOptionalStepText(entry?.realizationId)).filter(Boolean)),
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
      predicationIds: new Set(predicationLedger.map((entry) => normalizeOptionalStepText(entry?.predicationId)).filter(Boolean)),
      particleIds: new Set(particleLedger.map((entry) => normalizeOptionalStepText(entry?.particleId)).filter(Boolean)),
      evidentialityIds: new Set(evidentialityLedger.map((entry) => normalizeOptionalStepText(entry?.evidentialityId)).filter(Boolean)),
      mirativityIds: new Set(mirativityLedger.map((entry) => normalizeOptionalStepText(entry?.mirativityId)).filter(Boolean)),
      honorificityIds: new Set(honorificityLedger.map((entry) => normalizeOptionalStepText(entry?.honorificityId)).filter(Boolean)),
      switchReferenceIds: new Set(switchReferenceLedger.map((entry) => normalizeOptionalStepText(entry?.switchReferenceId)).filter(Boolean)),
      logophoraIds: new Set(logophoraLedger.map((entry) => normalizeOptionalStepText(entry?.logophoraId)).filter(Boolean)),
      eventStructureIds: new Set(eventStructureLedger.map((entry) => normalizeOptionalStepText(entry?.eventStructureId)).filter(Boolean))
    });
    const noteBindings = modelNoteBindings;
    const groundedExplanation = harmonizeExplanationWithDerivation(
      buildGroundedExplanation({
        tree: committedTree,
        derivationSteps: identifiedDerivationSteps,
        movementEvents: authoritativeMovementEventsWithChainIds,
        framework
      }),
      identifiedDerivationSteps,
      authoritativeMovementEventsWithChainIds,
      committedTree,
      framework
    );
    const coherentExplanation = noteBindings.length > 0
      ? buildExplanationFromNoteBindings(noteBindings)
      : groundedExplanation;
    auditNoteConsistency(() => {
      if (modelNoteBindings.length === 0) return;
      validateNoteBindingsAgainstStructuredAnalysis({
        noteBindings: modelNoteBindings,
        movementEvents: authoritativeMovementEventsWithChainIds,
        chains: chainsWithFieldFallback,
        commitmentGraph,
        clausalDependencies,
        caseAssignments,
        argumentStructure,
        phaseLog,
        morphologyRealization,
        featureLedger,
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
        predicationLedger,
        particleLedger,
        evidentialityLedger,
        mirativityLedger,
        honorificityLedger,
        switchReferenceLedger,
        logophoraLedger,
        eventStructureLedger
      });
    });
    const completenessStatus = computeCompletenessStatus({
      growthFrames,
      rawDerivationSteps: modelDerivationSteps,
      chains: chainsWithFieldFallback,
      commitmentGraph,
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
      particleLedger,
      evidentialityLedger,
      mirativityLedger,
      honorificityLedger,
      switchReferenceLedger,
      logophoraLedger,
      eventStructureLedger
    });
    const provenance = {
      modelRoute,
      framework,
      timestamp: new Date().toISOString(),
      treeSource: 'growthFrames',
      promptVersion: normalizeOptionalStepText(process.env.BABEL_PROMPT_VERSION),
      parserVersion: normalizeOptionalStepText(process.env.BABEL_PARSER_VERSION || process.env.VERCEL_GIT_COMMIT_SHA),
      uiVersion: normalizeOptionalStepText(process.env.BABEL_UI_VERSION || process.env.VERCEL_GIT_COMMIT_SHA),
      payloadIntegrityFlags: payloadIntegrityFlags.length > 0
        ? Array.from(new Set(payloadIntegrityFlags))
        : undefined,
      hasCommitmentGraph: commitmentGraph.length > 0,
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
      hasParticleLedger: particleLedger.length > 0,
      hasEvidentialityLedger: evidentialityLedger.length > 0,
      hasMirativityLedger: mirativityLedger.length > 0,
      hasHonorificityLedger: honorificityLedger.length > 0,
      hasSwitchReferenceLedger: switchReferenceLedger.length > 0,
      hasLogophoraLedger: logophoraLedger.length > 0,
      hasEventStructureLedger: eventStructureLedger.length > 0,
      completenessStatus
    };

    return {
      tree: committedTree,
      explanation: coherentExplanation,
      surfaceOrder: committedSurfaceOrder,
      growthFrames,
      noteBindings,
      rawDerivationSteps: modelDerivationSteps,
      derivationSteps: identifiedDerivationSteps,
      movementEvents: authoritativeMovementEventsWithChainIds,
      chains: chainsWithFieldFallback,
      commitmentGraph,
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
      particleLedger,
      evidentialityLedger,
      mirativityLedger,
      honorificityLedger,
      switchReferenceLedger,
      logophoraLedger,
      eventStructureLedger,
      provenance,
      completenessStatus
    };
  };

  const normalizeParseBundle = (
    value,
    framework = 'xbar',
    sentence = '',
    modelRoute = 'pro',
    enforceGrowthRouteContract = false,
    options = {}
  ) => {
    const parsed = value;
    const analysesSource = Array.isArray(parsed?.analyses)
      ? parsed.analyses.slice(0, 1)
      : parsed
        ? [parsed]
        : [];

    const analyses = analysesSource
      .map((analysis) => normalizeParseResult(
        analysis,
        framework,
        sentence,
        modelRoute,
        enforceGrowthRouteContract,
        options
      ))
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
    backfillMovementEventChainIds,
    normalizeParseResult,
    normalizeParseBundle,
    validateFinalProNoteBindings
  };
};
