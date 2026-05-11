export const createParseNormalizationHelpers = ({
  ParseApiError,
  normalizeKey,
  normalizeOpenChainType,
  normalizeChainType,
  normalizeMovementOperation,
  normalizeOptionalStepText,
  normalizeOptionalStringArray,
  getLabelProfile,
  tokenizeSentenceSurfaceOrder,
  normalizeSurfaceToken,
  compileNoteBindingsFromDerivationFrames,
  buildExplanationFromNoteBindings,
  normalizeDerivationStagesToDerivationFrames,
  normalizeDerivationFrames,
  materializeImplicitPhrasalTraceShellsInDerivationFrames,
  buildCanonicalDerivationFromDerivationFrames,
  collectNodeReferencesById,
  normalizeSyntaxTreeWithIds,
  buildNodeIndexFromTree,
  buildParentIndexFromTree,
  buildNodeLabelIndexFromTree,
  assignDerivationStepIds,
  normalizeDerivationSteps,
  normalizeVisualRelationEvents,
  validateAndCommitSurfaceOrder,
  validateSpelloutConsistency,
  buildCanonicalVisualRelationEvents,
  stripMovementIndicesFromTree,
  collectOvertTerminalNodes,
  resolveNodeSurface,
  resolveHeadMovementLandingNode,
  materializeCommittedTraceShells,
  buildGroundedExplanation,
  harmonizeExplanationWithDerivation,
  collectDerivationFrameNodeIds,
  normalizeChains,
  normalizeCommitmentGraph,
  isProjectedCommitmentKind,
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
  validateNoteBindingsAgainstStructuredAnalysis,
  auditNoteConsistency,
  computeCompletenessStatus,
  collectCompletenessWarnings,
  deriveImplicitDerivationChainId,
  deriveChainTypeFromOperation,
  mergeChainTypes,
  normalizeMovementStemFromId,
  subtreeContainsNamedCovertCategoryLeaf
}) => {
  const deriveChainsFromCommittedAnalysis = (derivationSteps, visualRelationEvents, nodeIds) => {
    if (!Array.isArray(visualRelationEvents) || visualRelationEvents.length === 0) return [];
    const steps = Array.isArray(derivationSteps) ? derivationSteps : [];
    const chainsById = new Map();

    visualRelationEvents.forEach((event, eventIndex) => {
      const stepIndex = Number.isInteger(event?.stepIndex) ? event.stepIndex : -1;
      const step = stepIndex >= 0 && stepIndex < steps.length ? steps[stepIndex] : null;
      const chainId = deriveImplicitDerivationChainId(step, event, eventIndex);
      const pronouncedCopy = String(event?.toNodeId || '').trim();
      const sourceCopy = String(event?.traceNodeId || event?.fromNodeId || '').trim();
      if (!chainId || !pronouncedCopy || !nodeIds.has(pronouncedCopy)) return;

      const existing = chainsById.get(chainId) || {
        chainId,
        type: normalizeMovementOperation(event?.operation) || normalizeOptionalStepText(event?.operation),
        family: deriveChainTypeFromOperation(event?.operation),
        copies: [],
        pronouncedCopy,
        silentCopies: [],
        features: [],
        note: normalizeOptionalStepText(event?.note) || normalizeOptionalStepText(step?.note)
      };

      existing.family = mergeChainTypes(existing.family, deriveChainTypeFromOperation(event?.operation));
      if (!existing.type) {
        existing.type = normalizeMovementOperation(event?.operation) || normalizeOptionalStepText(event?.operation);
      }
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
      family: entry.family,
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
      type: normalizeOpenChainType(entry.type) || normalizeChainType(entry.type),
      family: normalizeChainType(entry.family || entry.type),
      copies,
      pronouncedCopy,
      silentCopies,
      features: features.length > 0 ? features : undefined,
      note: normalizeOptionalStepText(entry.note)
    };
  };

  const buildCanonicalChains = ({ suppliedChains, derivationSteps, visualRelationEvents, nodeIds, nodeById }) => {
    const modelChains = Array.isArray(suppliedChains) ? suppliedChains : [];
    const derivedChains = deriveChainsFromCommittedAnalysis(derivationSteps, visualRelationEvents, nodeIds);
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
        type: normalizeOpenChainType(existing?.type || entry?.type) || undefined,
        family: mergeChainTypes(existing?.family || existing?.type, entry?.family || entry?.type),
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
          type: normalizeOpenChainType(modelEntry?.type || derivedEntry?.type) || undefined,
          family: mergeChainTypes(modelEntry?.family || modelEntry?.type, derivedEntry?.family || derivedEntry?.type),
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
    if (modelChains.length === 0) return compiledChains;

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
          type: normalizeOpenChainType(modelEntry?.type || fallbackEntry?.type) || normalizeChainType(modelEntry?.family || modelEntry?.type || fallbackEntry?.family || fallbackEntry?.type),
          family: normalizeChainType(modelEntry?.family || modelEntry?.type || fallbackEntry?.family || fallbackEntry?.type),
          copies,
          pronouncedCopy,
          silentCopies,
          features: normalizeOptionalStringArray(modelEntry?.features) || normalizeOptionalStringArray(fallbackEntry?.features),
          note: normalizeOptionalStepText(modelEntry?.note || fallbackEntry?.note)
        };
      })
      .filter(Boolean);
  };

  // Keep low-level visualRelationEvents aligned with the public chains ledger when the
  // model omitted event.chainId but already supplied a coherent chain entry.
  const backfillVisualRelationEventChainIds = ({ visualRelationEvents, chains, derivationSteps }) => {
    const events = Array.isArray(visualRelationEvents) ? visualRelationEvents : [];
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
          type: normalizeOpenChainType(entry?.type) || normalizeChainType(entry?.family || entry?.type),
          family: normalizeChainType(entry?.family || entry?.type),
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
      const implicitChainId = deriveImplicitDerivationChainId(step, event, eventIndex);

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
      const implicitChainId = deriveImplicitDerivationChainId(step, event, eventIndex);
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

  const stableStringifyForCommitmentKey = (value) => {
    if (Array.isArray(value)) {
      return `[${value.map((item) => stableStringifyForCommitmentKey(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      const entries = Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableStringifyForCommitmentKey(value[key])}`);
      return `{${entries.join(',')}}`;
    }
    return JSON.stringify(value);
  };

  const normalizeCommitmentParticipantsForMerge = (participants = []) => (
    (Array.isArray(participants) ? participants : [])
      .filter((participant) => participant && typeof participant === 'object')
      .map((participant) => ({
        role: normalizeOptionalStepText(participant.role),
        nodeId: normalizeOptionalStepText(participant.nodeId),
        label: normalizeOptionalStepText(participant.label),
        value: normalizeOptionalStepText(participant.value)
      }))
      .filter((participant) => participant.role || participant.nodeId || participant.label || participant.value)
      .sort((left, right) => stableStringifyForCommitmentKey(left).localeCompare(stableStringifyForCommitmentKey(right)))
  );

  const buildCommitmentFactStructuralKey = (entry) => {
    if (!entry || typeof entry !== 'object') return '';
    const canonical = { ...entry };
    delete canonical.factId;
    if (Array.isArray(canonical.stepIds)) {
      canonical.stepIds = Array.from(new Set(canonical.stepIds.map((value) => normalizeOptionalStepText(value)).filter(Boolean))).sort();
    }
    if (Array.isArray(canonical.nodeIds)) {
      canonical.nodeIds = Array.from(new Set(canonical.nodeIds.map((value) => String(value || '').trim()).filter(Boolean))).sort();
    }
    if (Array.isArray(canonical.participants)) {
      canonical.participants = normalizeCommitmentParticipantsForMerge(canonical.participants);
    }
    return stableStringifyForCommitmentKey(canonical);
  };

  const mergeCommitmentFactEntries = (existing, incoming) => {
    if (!existing) return incoming;
    if (!incoming) return existing;
    const merged = { ...existing };
    Object.entries(incoming).forEach(([field, value]) => {
      if (value === undefined) return;
      if (field === 'factId') {
        if (!merged.factId) merged.factId = value;
        return;
      }
      if (field === 'stepIds' || field === 'nodeIds') {
        const mergedValues = Array.from(new Set([
          ...((Array.isArray(merged[field]) ? merged[field] : []).map((item) => field === 'stepIds' ? normalizeOptionalStepText(item) : String(item || '').trim()).filter(Boolean)),
          ...((Array.isArray(value) ? value : []).map((item) => field === 'stepIds' ? normalizeOptionalStepText(item) : String(item || '').trim()).filter(Boolean))
        ]));
        if (mergedValues.length > 0) merged[field] = mergedValues;
        return;
      }
      if (field === 'participants') {
        const mergedParticipants = normalizeCommitmentParticipantsForMerge([
          ...(Array.isArray(merged.participants) ? merged.participants : []),
          ...(Array.isArray(value) ? value : [])
        ]);
        if (mergedParticipants.length > 0) merged.participants = mergedParticipants;
        return;
      }
      if (Array.isArray(value)) {
        const combined = Array.from(new Set([
          ...(Array.isArray(merged[field]) ? merged[field] : []),
          ...value
        ].filter((item) => item !== undefined)));
        if (combined.length > 0) merged[field] = combined;
        return;
      }
      if (merged[field] === undefined || merged[field] === null || merged[field] === '') {
        merged[field] = value;
      }
    });
    return merged;
  };

  const buildFrameNodeById = (frame) => {
    const after = frame?.after && typeof frame.after === 'object' && !Array.isArray(frame.after)
      ? frame.after
      : {};
    const frameNodeById = new Map();
    (Array.isArray(after.workspaceForest) ? after.workspaceForest : []).forEach((root) => {
      collectNodeReferencesById(root).forEach((node, nodeId) => {
        if (typeof nodeId === 'string' && nodeId.trim()) {
          frameNodeById.set(nodeId, node);
        }
      });
    });
    return frameNodeById;
  };

  const normalizeFrameFactNodeId = (value, nodeIds) => {
    const nodeId = String(value || '').trim();
    return nodeId && nodeIds.has(nodeId) ? nodeId : undefined;
  };

  const normalizeDerivationAnchorRoleKey = (value) =>
    String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '');

  const derivationAnchorRoleMatchesAny = (roleKey, normalizedMatchers = []) =>
    normalizedMatchers.some((matcher) => roleKey === matcher);

  const getFrameChange = (frame) => (
    frame?.change && typeof frame.change === 'object' && !Array.isArray(frame.change)
      ? frame.change
      : null
  );

  const buildFrameParentById = (frame) => {
    const after = frame?.after && typeof frame.after === 'object' && !Array.isArray(frame.after)
      ? frame.after
      : {};
    const parentById = new Map();
    (Array.isArray(after.workspaceForest) ? after.workspaceForest : []).forEach((root) => {
      buildParentIndexFromTree(root).forEach((parentId, nodeId) => {
        if (typeof nodeId === 'string' && nodeId.trim()) {
          parentById.set(nodeId, parentId);
        }
      });
    });
    return parentById;
  };

  const getFrameNodeLineageId = (node) =>
    normalizeOptionalStepText(
      node?.lineageId
      || node?.lineage
      || node?.copyLineageId
      || node?.movementLineageId
      || (
        node?.identity
        && typeof node.identity === 'object'
        && !Array.isArray(node.identity)
          ? (node.identity.lineageId || node.identity.lineage)
          : undefined
      )
    ) || '';

  const buildFrameLineageWitnessIndex = (frame) => {
    const frameNodeById = buildFrameNodeById(frame);
    const lineageById = new Map();
    frameNodeById.forEach((node, nodeId) => {
      const lineageId = getFrameNodeLineageId(node);
      if (!lineageId) return;
      const existing = lineageById.get(lineageId) || {
        lineageId,
        pronouncedNodeIds: [],
        silentNodeIds: []
      };
      if (nodeHasCommittedOvertYield(node)) existing.pronouncedNodeIds.push(nodeId);
      else existing.silentNodeIds.push(nodeId);
      lineageById.set(lineageId, existing);
    });
    return lineageById;
  };

  const findFrameDominantMovementLineage = (frame) => {
    let bestLineageId = '';
    let bestScore = -1;
    buildFrameLineageWitnessIndex(frame).forEach((entry, lineageId) => {
      if (entry.pronouncedNodeIds.length === 0 || entry.silentNodeIds.length === 0) return;
      const score = entry.pronouncedNodeIds.length + entry.silentNodeIds.length;
      if (score > bestScore) {
        bestScore = score;
        bestLineageId = lineageId;
      }
    });
    return bestLineageId;
  };

  const sameNodeIdSet = (left = [], right = []) => {
    if (left.length !== right.length) return false;
    const rightSet = new Set(right);
    return left.every((value) => rightSet.has(value));
  };

  const findFrameNovelMovementLineage = (frame, previousFrame = null) => {
    const currentLineages = buildFrameLineageWitnessIndex(frame);
    const previousLineages = previousFrame ? buildFrameLineageWitnessIndex(previousFrame) : new Map();
    let bestLineageId = '';
    let bestScore = -1;
    currentLineages.forEach((entry, lineageId) => {
      if (entry.pronouncedNodeIds.length === 0 || entry.silentNodeIds.length === 0) return;
      const previousEntry = previousLineages.get(lineageId);
      const isNewAtThisCheckpoint = !previousEntry
        || !sameNodeIdSet(entry.pronouncedNodeIds, previousEntry.pronouncedNodeIds)
        || !sameNodeIdSet(entry.silentNodeIds, previousEntry.silentNodeIds);
      if (!isNewAtThisCheckpoint) return;
      const score = entry.pronouncedNodeIds.length + entry.silentNodeIds.length;
      if (score > bestScore) {
        bestScore = score;
        bestLineageId = lineageId;
      }
    });
    return bestLineageId;
  };

  const extractQuotedChangeSurfaceForms = (change) => {
    const statement = normalizeOptionalStepText(change?.statement);
    if (!statement) return [];
    return Array.from(statement.matchAll(/["']([^"']+)["']/g))
      .map((match) => normalizeSurfaceToken(match?.[1]))
      .filter(Boolean);
  };

  const findFrameChangeDetailLineageId = (change) => {
    const details = change?.details && typeof change.details === 'object'
      ? change.details
      : null;
    return normalizeOptionalStepText(
      details?.itemLineageId
      || details?.lineageId
      || details?.movement?.itemLineageId
      || details?.movement?.lineageId
      || details?.movement?.chainId
      || details?.movement?.continuityId
      || details?.headMovement?.itemLineageId
      || details?.headMovement?.lineageId
      || details?.headMovement?.chainId
      || details?.headMovement?.continuityId
    ) || '';
  };

  const inferFrameChangeMovementOperation = (frame, previousFrame = null) => {
    const change = getFrameChange(frame);
    if (!change) return '';
    const frameNodeById = buildFrameNodeById(frame);
    const details = change?.details && typeof change.details === 'object'
      ? change.details
      : null;
    const explicitOperation = normalizeMovementOperation(
      details?.operation
      || details?.type
      || details?.kind
    );
    const sourceNodeId = findFrameChangeAnchorNodeId(frame, ['source', 'from', 'origin', 'lower', 'sourcecopy', 'lowercopy']);
    const landingNodeId = findFrameChangeAnchorNodeId(frame, ['landing', 'target', 'to', 'destination']);
    const traceNodeId = findFrameChangeAnchorNodeId(frame, ['trace', 'residue', 'lowercopy', 'copy', 'sourcecopy']);
    const targetHeadNodeId = findFrameChangeAnchorNodeId(frame, ['targethead']);
    const hostNodeId = findFrameChangeAnchorNodeId(frame, ['host', 'container']);
    const targetProjectionNodeId = findFrameChangeAnchorNodeId(frame, ['targetprojection', 'edge']);
    const statementText = normalizeOptionalStepText(change.statement);
    const movementText = [
      statementText,
      normalizeOptionalStepText(details?.note),
      normalizeOptionalStepText(details?.movement?.type),
      normalizeOptionalStepText(details?.headMovement?.clauseType)
    ].filter(Boolean).join(' ');
    const statement = String(statementText || '').toLowerCase();
    const movementContext = String(movementText || '').toLowerCase();
    const sourceLabel = String(frameNodeById.get(sourceNodeId)?.label || '').trim();
    const landingLabel = String(frameNodeById.get(landingNodeId)?.label || '').trim();
    const traceLabel = String(frameNodeById.get(traceNodeId)?.label || '').trim();
    const hostLabel = String(frameNodeById.get(hostNodeId)?.label || '').trim();
    const sourceProfile = sourceLabel ? getLabelProfile(sourceLabel) : null;
    const landingProfile = landingLabel ? getLabelProfile(landingLabel) : null;
    const traceProfile = traceLabel ? getLabelProfile(traceLabel) : null;
    const hostProfile = hostLabel ? getLabelProfile(hostLabel) : null;
    const hasDirectMovementCue = Boolean(
      sourceNodeId
      || landingNodeId
      || traceNodeId
      || targetHeadNodeId
      || (
        hostNodeId
        && (
          explicitOperation === 'HeadMove'
          || /\bhead movement\b|\bmove the .* head\b|\bt[- ]?to[- ]?c\b|\bto c\b/.test(movementContext)
          || sourceProfile?.isHeadLikeStructural
          || traceProfile?.isHeadLikeStructural
          || hostProfile?.isHeadLikeStructural
        )
        && (sourceNodeId || traceNodeId || targetHeadNodeId)
      )
    );
    const statementMentionsMovement = /(?:move|raise|lowering|front|displac|extract|shift|scrambl|roll[- ]?up|remerge|internal merge)/i.test(statement);
    const lineageMovementId = findFrameNovelMovementLineage(frame, previousFrame);
    const hasConcreteMovementCue = hasDirectMovementCue
      || (
        lineageMovementId
        && Boolean(explicitOperation || statementMentionsMovement)
      );
    if (!hasConcreteMovementCue) return '';
    if (explicitOperation) return explicitOperation;
    if (
      targetHeadNodeId
      || sourceProfile?.isHeadLikeStructural
      || landingProfile?.isHeadLikeStructural
      || traceProfile?.isHeadLikeStructural
      || hostProfile?.isHeadLikeStructural
      || /\bhead movement\b|\bmove the .* head\b|\bt[- ]?to[- ]?c\b|\bto c\b/.test(movementContext)
    ) {
      return 'HeadMove';
    }
    if (
      /(?:wh|a[- ]?bar|topicaliz|focus|front)/i.test(movementContext)
      || String(targetProjectionNodeId || '').trim().toLowerCase().includes('cp')
      || String(hostNodeId || '').trim().toLowerCase().includes('cp')
    ) {
      return 'AbarMove';
    }
    return 'A-Move';
  };

  const findFrameHeadMoveHostNodeIdFromSurfaceCue = (frame) => {
    const change = getFrameChange(frame);
    if (!change) return undefined;
    const surfaceForms = extractQuotedChangeSurfaceForms(change);
    if (surfaceForms.length === 0) return undefined;
    const frameNodeById = buildFrameNodeById(frame);
    const parentById = buildFrameParentById(frame);
    const matchingLandingIds = new Set();

    frameNodeById.forEach((node) => {
      const children = Array.isArray(node?.children) ? node.children : [];
      if (children.length > 0) return;
      const surface = normalizeSurfaceToken(resolveNodeSurface(node) || node.word || node.label);
      if (!surface || !surfaceForms.includes(surface)) return;
      const landingNode = resolveHeadMovementLandingNode(node, frameNodeById, parentById) || null;
      const landingNodeId = String(landingNode?.id || '').trim();
      if (landingNodeId) matchingLandingIds.add(landingNodeId);
    });

    return matchingLandingIds.size === 1
      ? Array.from(matchingLandingIds)[0]
      : undefined;
  };

  const findFrameChangeAnchorNodeId = (frame, roleMatchers = []) => {
    const change = getFrameChange(frame);
    const anchors = Array.isArray(change?.anchors) ? change.anchors : [];
    const normalizedMatchers = roleMatchers.map((matcher) => normalizeDerivationAnchorRoleKey(matcher)).filter(Boolean);
    if (normalizedMatchers.length === 0) return undefined;
    for (const anchor of anchors) {
      const roleKey = normalizeDerivationAnchorRoleKey(anchor?.role);
      if (!roleKey) continue;
      if (!derivationAnchorRoleMatchesAny(roleKey, normalizedMatchers)) continue;
      const nodeId = String(anchor?.nodeId || '').trim();
      if (nodeId) return nodeId;
    }
    return undefined;
  };

  const VISUAL_RELATION_TRAJECTORY_SOURCE_ROLES = new Set(
    ['source', 'from', 'origin', 'lower', 'sourcecopy', 'lowercopy']
      .map((role) => normalizeDerivationAnchorRoleKey(role))
  );
  const VISUAL_RELATION_TRAJECTORY_TARGET_ROLES = new Set(
    ['landing', 'target', 'to', 'destination', 'higher', 'highercopy', 'moved', 'operator']
      .map((role) => normalizeDerivationAnchorRoleKey(role))
  );
  const VISUAL_RELATION_TRAJECTORY_WITNESS_ROLES = new Set(
    ['trace', 'residue', 'gap', 'copy', 'sourcecopy', 'lowercopy']
      .map((role) => normalizeDerivationAnchorRoleKey(role))
  );

  const normalizeVisualRelationAnchorValues = (value) => {
    if (Array.isArray(value)) {
      return value.flatMap((item) => normalizeVisualRelationAnchorValues(item));
    }
    if (value && typeof value === 'object') {
      const nodeId = normalizeOptionalStepText(value.nodeId || value.id || value.refId);
      const displayValue = normalizeOptionalStepText(value.value || value.text || nodeId);
      return nodeId || displayValue
        ? [{ nodeId, value: displayValue || nodeId }]
        : [];
    }
    const text = normalizeOptionalStepText(value);
    return text ? [{ nodeId: text, value: text }] : [];
  };

  const resolveVisualRelationAnchors = (anchors, frameNodeById) => {
    if (!anchors || typeof anchors !== 'object' || Array.isArray(anchors)) return [];
    return Object.entries(anchors).flatMap(([role, rawValue]) => {
      const normalizedRole = normalizeOptionalStepText(role);
      if (!normalizedRole) return [];
      return normalizeVisualRelationAnchorValues(rawValue)
        .map((anchorValue) => {
          const nodeId = normalizeOptionalStepText(anchorValue.nodeId);
          const value = normalizeOptionalStepText(anchorValue.value || nodeId);
          const node = nodeId ? frameNodeById.get(nodeId) : null;
          const resolvedNodeId = normalizeOptionalStepText(node?.id) || nodeId;
          const authoredNodeId = nodeId && resolvedNodeId && nodeId !== resolvedNodeId ? nodeId : '';
          return {
            role: normalizedRole,
            ...(resolvedNodeId ? { nodeId: resolvedNodeId } : {}),
            ...(authoredNodeId ? { authoredNodeId } : {}),
            ...(value ? { value } : {}),
            ...(node?.label ? { label: String(node.label) } : {}),
            resolved: Boolean(node),
            visibleInStage: Boolean(node)
          };
        });
    });
  };

  const firstResolvedRelationAnchorNodeId = (anchors, roleKeys) => {
    for (const anchor of anchors) {
      const roleKey = normalizeDerivationAnchorRoleKey(anchor?.role);
      if (!roleKeys.has(roleKey)) continue;
      const nodeId = normalizeOptionalStepText(anchor?.nodeId);
      if (nodeId) return nodeId;
    }
    return '';
  };

  const relationHasTrajectoryShape = ({ relation, sourceNodeId, targetNodeId, witnessNodeId }) => {
    if (!targetNodeId || (!sourceNodeId && !witnessNodeId)) return false;
    const relationKey = normalizeKey(relation);
    return (
      !relationKey
      || /move|movement|raise|raising|lower|lowering|front|displac|extract|copy|trace|gap|chain|clitic|affix|scrambl|rollup|sideward|head/.test(relationKey)
    );
  };

  const buildResolvedVisualRelationsFromDerivationFrames = (frames) => {
    const resolvedRelations = [];
    (Array.isArray(frames) ? frames : []).forEach((frame, frameIndex) => {
      const change = getFrameChange(frame);
      const details = change?.details && typeof change.details === 'object' && !Array.isArray(change.details)
        ? change.details
        : {};
      const visualRelations = Array.isArray(details.derivationStageVisualRelations)
        ? details.derivationStageVisualRelations
        : [];
      if (visualRelations.length === 0) return;

      const frameNodeById = buildFrameNodeById(frame);
      const stageId = normalizeOptionalStepText(frame?.stepId || frame?.frameId) || `d${frameIndex + 1}`;
      const evidence = normalizeOptionalStepText(details.stageRecord || details.note || frame?.note || change?.statement);

      visualRelations.forEach((visualRelation, relationIndex) => {
        if (!visualRelation || typeof visualRelation !== 'object') return;
        const relation = normalizeOptionalStepText(
          visualRelation.relation
          || visualRelation.kind
          || visualRelation.type
          || visualRelation.label
        ) || 'visual relation';
        const anchors = resolveVisualRelationAnchors(visualRelation.anchors, frameNodeById);
        const sourceNodeId = firstResolvedRelationAnchorNodeId(anchors, VISUAL_RELATION_TRAJECTORY_SOURCE_ROLES);
        const targetNodeId = firstResolvedRelationAnchorNodeId(anchors, VISUAL_RELATION_TRAJECTORY_TARGET_ROLES);
        const witnessNodeId = firstResolvedRelationAnchorNodeId(anchors, VISUAL_RELATION_TRAJECTORY_WITNESS_ROLES);
        const hasUnresolvedAnchors = anchors.some((anchor) => !anchor.resolved);
        const hasTrajectoryShape = relationHasTrajectoryShape({
          relation,
          sourceNodeId,
          targetNodeId,
          witnessNodeId
        });
        const renderable = hasTrajectoryShape && !hasUnresolvedAnchors;
        const renderStatus = renderable
          ? 'trajectory-compatible'
          : hasTrajectoryShape
            ? 'trajectory-anchor-unresolved'
            : hasUnresolvedAnchors
              ? 'anchors-unresolved'
              : 'anchors-resolved-not-rendered';
        const relationId = normalizeOptionalStepText(
          visualRelation.relationId
          || visualRelation.visualRelationId
          || visualRelation.id
        ) || `${stageId}:visualRelation:${relationIndex + 1}`;

        resolvedRelations.push({
          relationId,
          stageId,
          stageIndex: frameIndex,
          relation,
          anchors,
          ...(sourceNodeId ? { sourceNodeId } : {}),
          ...(targetNodeId ? { targetNodeId } : {}),
          ...(witnessNodeId ? { witnessNodeId } : {}),
          renderFamily: hasTrajectoryShape ? 'trajectory' : 'unknown',
          renderable,
          renderStatus,
          ...(evidence ? { evidence } : {})
        });
      });
    });
    return resolvedRelations;
  };

  const deriveFrameChangeKind = (frame, previousFrame = null) => {
    const change = getFrameChange(frame);
    const details = change?.details && typeof change.details === 'object'
      ? change.details
      : null;
    const explicitKind = normalizeOptionalStepText(details?.kind || details?.family || details?.type);
    if (explicitKind) {
      const normalizedExplicitKind = normalizeKey(explicitKind);
      if (/(?:^|[-_])(?:move|movement|headmove|abarmove|amove)(?:$|[-_])/i.test(normalizedExplicitKind)) {
        return inferFrameChangeMovementOperation(frame, previousFrame) ? explicitKind : 'transition';
      }
      return explicitKind;
    }
    const sourceNodeId = findFrameChangeAnchorNodeId(frame, ['source', 'from', 'origin', 'lower', 'sourcecopy', 'lowercopy']);
    const landingNodeId = findFrameChangeAnchorNodeId(frame, ['landing', 'target', 'to', 'destination']);
    const targetHeadNodeId = findFrameChangeAnchorNodeId(frame, ['targethead']);
    const traceNodeId = findFrameChangeAnchorNodeId(frame, ['trace', 'residue', 'lowercopy', 'copy', 'sourcecopy']);
    return (sourceNodeId || landingNodeId || targetHeadNodeId || traceNodeId || inferFrameChangeMovementOperation(frame, previousFrame))
      ? 'movement'
      : 'transition';
  };

  const buildFrameChangeCommitmentFact = ({ frame, previousFrame, nodeIds, stepIds }) => {
    const change = getFrameChange(frame);
    if (!change) return null;
    const frameNodeById = buildFrameNodeById(frame);
    const details = change.details && typeof change.details === 'object' && !Array.isArray(change.details)
      ? change.details
      : {};
    const sourceNodeId = normalizeFrameFactNodeId(findFrameChangeAnchorNodeId(frame, ['source', 'from', 'origin', 'lower', 'sourcecopy', 'lowercopy']), nodeIds);
    const authoredLandingNodeId = normalizeFrameFactNodeId(findFrameChangeAnchorNodeId(frame, ['landing', 'target', 'to', 'destination']), nodeIds);
    const authoredHostNodeId = normalizeFrameFactNodeId(findFrameChangeAnchorNodeId(frame, ['host', 'container']), nodeIds);
    const authoredTargetHeadNodeId = normalizeFrameFactNodeId(findFrameChangeAnchorNodeId(frame, ['targethead']), nodeIds);
    const traceNodeId = normalizeFrameFactNodeId(findFrameChangeAnchorNodeId(frame, ['trace', 'residue', 'lowercopy', 'copy', 'sourcecopy']), nodeIds);
    const movementOperation = inferFrameChangeMovementOperation(frame, previousFrame);
    const recoveredHostNodeId = !authoredHostNodeId && !authoredTargetHeadNodeId && movementOperation === 'HeadMove'
      ? normalizeFrameFactNodeId(findFrameHeadMoveHostNodeIdFromSurfaceCue(frame), nodeIds)
      : undefined;
    const hostNodeId = authoredHostNodeId || authoredTargetHeadNodeId || recoveredHostNodeId;
    const landingNodeId = authoredLandingNodeId
      || (movementOperation === 'HeadMove' ? hostNodeId : undefined);
    const continuityIds = Array.isArray(change.continuityIds)
      ? change.continuityIds.map((value) => normalizeOptionalStepText(value)).filter(Boolean)
      : [];
    const lineageChainId = movementOperation
      ? findFrameNovelMovementLineage(frame, previousFrame)
      : '';
    const chainId = normalizeOptionalStepText(details?.chainId || details?.continuityId)
      || findFrameChangeDetailLineageId(change)
      || (continuityIds.length === 1 ? continuityIds[0] : '')
      || lineageChainId;
    const participants = normalizeCommitmentParticipantsForMerge(
      (Array.isArray(change.anchors) ? change.anchors : []).map((anchor) => {
        if (!anchor || typeof anchor !== 'object') return null;
        const nodeId = normalizeFrameFactNodeId(anchor.nodeId, nodeIds);
        const role = normalizeOptionalStepText(anchor.role);
        const label = nodeId ? normalizeOptionalStepText(frameNodeById.get(nodeId)?.label) : undefined;
        const value = normalizeOptionalStepText(anchor.value || anchor.text);
        if (!nodeId && !role && !value) return null;
        return {
          ...(role ? { role } : {}),
          ...(nodeId ? { nodeId } : {}),
          ...(label ? { label } : {}),
          ...(value ? { value } : {})
        };
      }).filter(Boolean)
    );
    const nodeIdSet = Array.from(new Set([
      ...participants.map((participant) => String(participant?.nodeId || '').trim()).filter(Boolean),
      sourceNodeId,
      landingNodeId,
      hostNodeId,
      traceNodeId
    ].filter(Boolean)));
    const frameStepId = normalizeOptionalStepText(frame?.stepId);
    const normalizedStepIds = Array.from(new Set([
      ...(frameStepId ? [frameStepId] : []),
      ...((Array.isArray(stepIds) ? stepIds : []).map((value) => normalizeOptionalStepText(value)).filter(Boolean))
    ]));
    const fact = {
      kind: deriveFrameChangeKind(frame, previousFrame),
      ...(normalizeOptionalStepText(details?.family) ? { family: normalizeOptionalStepText(details.family) } : {}),
      ...(normalizeOptionalStepText(details?.frameworkLabel) ? { frameworkLabel: normalizeOptionalStepText(details.frameworkLabel) } : {}),
      ...(normalizeOptionalStepText(details?.subtype) ? { subtype: normalizeOptionalStepText(details.subtype) } : {}),
      ...(normalizeOptionalStepText(change.statement) ? { statement: normalizeOptionalStepText(change.statement) } : {}),
      ...(normalizedStepIds.length > 0 ? { stepIds: normalizedStepIds } : {}),
      ...(nodeIdSet.length > 0 ? { nodeIds: nodeIdSet } : {}),
      ...(participants.length > 0 ? { participants } : {}),
      ...(chainId ? { chainId } : {}),
      ...(sourceNodeId ? { sourceNodeId } : {}),
      ...(landingNodeId ? { landingNodeId } : {}),
      ...(hostNodeId ? { hostNodeId } : {}),
      ...(traceNodeId ? { traceNodeId } : {})
    };
    Object.entries(details).forEach(([field, value]) => {
      if (value === undefined) return;
      if (field === 'kind' || field === 'family' || field === 'frameworkLabel' || field === 'subtype' || field === 'chainId' || field === 'continuityId') return;
      if (field in fact) return;
      fact[field] = value;
    });
    return fact;
  };

  const splitFrameAnalyticNoteClaims = (value) => {
    const note = normalizeOptionalStepText(value);
    if (!note) return [];
    return note
      .split(/(?<=[.!?])\s+|;\s+/u)
      .map((claim) => normalizeOptionalStepText(claim))
      .filter(Boolean);
  };

  const buildFrameGroundedAnalyticNoteFacts = ({ frame, baseFact }) => {
    const change = getFrameChange(frame);
    const noteText = normalizeOptionalStepText(change?.details?.note);
    if (!noteText || !baseFact || typeof baseFact !== 'object') return [];

    const baseStatement = normalizeOptionalStepText(baseFact.statement);
    const baseNodeIds = Array.isArray(baseFact.nodeIds)
      ? Array.from(new Set(baseFact.nodeIds.map((nodeId) => String(nodeId || '').trim()).filter(Boolean)))
      : [];
    const baseParticipants = normalizeCommitmentParticipantsForMerge(baseFact.participants);
    const baseChainId = normalizeOptionalStepText(baseFact.chainId);
    const hasGroundedWitness = baseNodeIds.length > 0 || baseParticipants.length > 0 || Boolean(baseChainId);
    if (!hasGroundedWitness) return [];

    return splitFrameAnalyticNoteClaims(noteText)
      .filter((claim) => normalizeKey(claim) !== normalizeKey(baseStatement))
      .map((claim, claimIndex) => ({
        kind: 'analytic',
        frameworkLabel: 'derivation-stage-prose',
        subtype: 'grounded-local-claim',
        statement: claim,
        ...(Array.isArray(baseFact.stepIds) && baseFact.stepIds.length > 0 ? { stepIds: [...baseFact.stepIds] } : {}),
        ...(baseNodeIds.length > 0 ? { nodeIds: [...baseNodeIds] } : {}),
        ...(baseParticipants.length > 0 ? { participants: [...baseParticipants] } : {}),
        ...(baseChainId ? { chainId: baseChainId } : {}),
        sourceField: 'change.details.note',
        claimIndex: claimIndex + 1
      }));
  };

  const compileFrameChangeCommitments = ({ derivationFrames, nodeIds, stepIds }) => {
    const frames = Array.isArray(derivationFrames) ? derivationFrames : [];
    const mergedFactsByKey = new Map();
    frames.forEach((frame, index) => {
      const compiledFact = buildFrameChangeCommitmentFact({
        frame,
        previousFrame: index > 0 ? frames[index - 1] : null,
        nodeIds,
        stepIds: [normalizeOptionalStepText(frame?.stepId)].filter(Boolean)
      });
      const normalizedBaseFacts = normalizeCommitmentGraph(compiledFact ? [compiledFact] : [], nodeIds, stepIds);
      const analyticNoteFacts = normalizeCommitmentGraph(
        buildFrameGroundedAnalyticNoteFacts({
          frame,
          baseFact: normalizedBaseFacts[0] || null
        }),
        nodeIds,
        stepIds
      );
      const normalizedFacts = [...normalizedBaseFacts, ...analyticNoteFacts];
      normalizedFacts.forEach((entry) => {
        const structuralKey = buildCommitmentFactStructuralKey(entry);
        if (!structuralKey) return;
        const existing = mergedFactsByKey.get(structuralKey);
        mergedFactsByKey.set(structuralKey, mergeCommitmentFactEntries(existing, entry));
      });
    });

    const mergedFacts = Array.from(mergedFactsByKey.values());
    const identifiedFacts = ensureStructuredEntryIds(mergedFacts, 'factId', 'fact');
    return {
      derivationFrames: frames,
      frameCommitmentFacts: identifiedFacts
    };
  };

  const mergeAuthoredCommitmentFacts = (...sources) => {
    const mergedByKey = new Map();
    sources.flat().forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const structuralKey = buildCommitmentFactStructuralKey(entry);
      if (!structuralKey) return;
      const existing = mergedByKey.get(structuralKey);
      mergedByKey.set(structuralKey, mergeCommitmentFactEntries(existing, entry));
    });
    return ensureStructuredEntryIds(Array.from(mergedByKey.values()), 'factId', 'fact');
  };

  const enrichMovementCommitmentFactsFromEvents = (facts, visualRelationEvents, nodeById) => {
    const normalizedFacts = Array.isArray(facts) ? facts : [];
    const normalizedEvents = Array.isArray(visualRelationEvents) ? visualRelationEvents : [];
    if (normalizedFacts.length === 0 || normalizedEvents.length === 0) return normalizedFacts;

    const buildParticipantsFromEvent = (event) => normalizeCommitmentParticipantsForMerge([
      event?.sourceNodeId || event?.fromNodeId
        ? {
            role: 'source',
            nodeId: String(event.sourceNodeId || event.fromNodeId).trim(),
            label: normalizeOptionalStepText(nodeById?.get(String(event.sourceNodeId || event.fromNodeId).trim())?.label)
          }
        : null,
      event?.landingNodeId || event?.toNodeId
        ? {
            role: 'landing',
            nodeId: String(event.landingNodeId || event.toNodeId).trim(),
            label: normalizeOptionalStepText(nodeById?.get(String(event.landingNodeId || event.toNodeId).trim())?.label)
          }
        : null,
      event?.hostNodeId
        ? {
            role: 'host',
            nodeId: String(event.hostNodeId).trim(),
            label: normalizeOptionalStepText(nodeById?.get(String(event.hostNodeId).trim())?.label)
          }
        : null,
      event?.traceNodeId
        ? {
            role: 'trace',
            nodeId: String(event.traceNodeId).trim(),
            label: normalizeOptionalStepText(nodeById?.get(String(event.traceNodeId).trim())?.label)
          }
        : null
    ]);

    return normalizedFacts.map((fact) => {
      if (!fact || typeof fact !== 'object' || fact.kind !== 'movement') return fact;
      const factStepIds = new Set((Array.isArray(fact.stepIds) ? fact.stepIds : []).map((value) => normalizeOptionalStepText(value)).filter(Boolean));
      const matchingEvents = normalizedEvents.filter((event) => {
        const eventChainId = normalizeOptionalStepText(event?.chainId);
        const eventStepId = normalizeOptionalStepText(event?.stepId);
        if (fact.chainId && eventChainId && fact.chainId === eventChainId) return true;
        if (eventStepId && factStepIds.has(eventStepId)) return true;
        return false;
      });
      if (matchingEvents.length === 0) return fact;
      const preferredEvent = [...matchingEvents].sort((left, right) => {
        const leftComplete = String(left?.serializationStatus || '') === 'complete' ? 1 : 0;
        const rightComplete = String(right?.serializationStatus || '') === 'complete' ? 1 : 0;
        return rightComplete - leftComplete;
      })[0];
      const eventNodeIds = Array.from(new Set([
        String(preferredEvent?.sourceNodeId || preferredEvent?.fromNodeId || '').trim(),
        String(preferredEvent?.landingNodeId || preferredEvent?.toNodeId || '').trim(),
        String(preferredEvent?.hostNodeId || '').trim(),
        String(preferredEvent?.traceNodeId || '').trim()
      ].filter(Boolean)));
      const mergedNodeIds = Array.from(new Set([
        ...((Array.isArray(fact.nodeIds) ? fact.nodeIds : []).map((value) => String(value || '').trim()).filter(Boolean)),
        ...eventNodeIds
      ]));
      const mergedParticipants = normalizeCommitmentParticipantsForMerge([
        ...(Array.isArray(fact.participants) ? fact.participants : []),
        ...buildParticipantsFromEvent(preferredEvent)
      ]);
      return {
        ...fact,
        ...(mergedNodeIds.length > 0 ? { nodeIds: mergedNodeIds } : {}),
        ...(mergedParticipants.length > 0 ? { participants: mergedParticipants } : {}),
        ...(fact.sourceNodeId ? {} : (preferredEvent?.sourceNodeId || preferredEvent?.fromNodeId ? { sourceNodeId: String(preferredEvent.sourceNodeId || preferredEvent.fromNodeId).trim() } : {})),
        ...(fact.landingNodeId ? {} : (preferredEvent?.landingNodeId || preferredEvent?.toNodeId ? { landingNodeId: String(preferredEvent.landingNodeId || preferredEvent.toNodeId).trim() } : {})),
        ...(fact.hostNodeId ? {} : (preferredEvent?.hostNodeId ? { hostNodeId: String(preferredEvent.hostNodeId).trim() } : {})),
        ...(fact.traceNodeId ? {} : (preferredEvent?.traceNodeId ? { traceNodeId: String(preferredEvent.traceNodeId).trim() } : {})),
        ...(fact.chainId ? {} : (preferredEvent?.chainId ? { chainId: normalizeOptionalStepText(preferredEvent.chainId) } : {}))
      };
    });
  };

  const buildRawVisualRelationEventIdentityKey = (event) => {
    if (!event || typeof event !== 'object') return '';
    return JSON.stringify({
      stepId: normalizeOptionalStepText(event.stepId),
      stepIndex: Number.isInteger(event.stepIndex) ? event.stepIndex : undefined,
      operation: normalizeOptionalStepText(event.label) || normalizeMovementOperation(event.operation || event.type) || '',
      movingNodeId: String(event.movingNodeId || '').trim(),
      fromNodeId: String(event.fromNodeId || event.sourceNodeId || event.source || '').trim(),
      toNodeId: String(event.toNodeId || event.landingNodeId || event.targetNodeId || event.target || event.movingNodeId || '').trim(),
      hostNodeId: String(event.hostNodeId || event.host || '').trim(),
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

  const inferRawVisualRelationEventStepIdFromStepIndex = ({
    event,
    rawDerivationFrames,
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
      buildIndexedRawStepIdCandidates(rawDerivationFrames),
      buildIndexedRawStepIdCandidates(rawDerivationFrames, { moveLikeOnly: true }),
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

  const mergeRawVisualRelationEvents = ({
    topLevelVisualRelationEvents,
    rawDerivationFrames,
    rawDerivationSteps,
    payloadIntegrityFlags
  }) => {
    const merged = [];
    const seen = new Set();
    let harvestedFromDerivationFrames = false;
    let harvestedFromDerivationSteps = false;
    let inferredStepIdFromStepIndex = false;
    const operationByStepId = buildRawStepOperationByStepId(rawDerivationFrames, rawDerivationSteps);

    const pushEvent = (event, inheritedStepId = '') => {
      if (!event || typeof event !== 'object') return;
      const normalizedInheritedStepId = normalizeOptionalStepText(inheritedStepId);
      const inferredStepId = normalizedInheritedStepId || inferRawVisualRelationEventStepIdFromStepIndex({
        event,
        rawDerivationFrames,
        rawDerivationSteps,
        operationByStepId
      });
      const enrichedEvent = inferredStepId && !normalizeOptionalStepText(event.stepId)
        ? { ...event, stepId: inferredStepId }
        : event;
      if (!normalizedInheritedStepId && inferredStepId && !normalizeOptionalStepText(event.stepId)) {
        inferredStepIdFromStepIndex = true;
      }
      const key = buildRawVisualRelationEventIdentityKey(enrichedEvent);
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push(enrichedEvent);
    };

    // Use a wrapper so Array#forEach does not leak the element index into the
    // inheritedStepId slot. That index leak can silently fabricate step ids like "1".
    parseRawTransportArray(topLevelVisualRelationEvents).forEach((event) => pushEvent(event));

    parseRawTransportArray(rawDerivationFrames).forEach((frame) => {
      if (!frame || typeof frame !== 'object') return;
      const frameStepId = normalizeOptionalStepText(frame.stepId);
      const nestedEvents = parseRawTransportArray(frame.visualRelationEvents);
      if (nestedEvents.length === 0) return;
      harvestedFromDerivationFrames = true;
      nestedEvents.forEach((event) => pushEvent(event, frameStepId));
    });

    parseRawTransportArray(rawDerivationSteps).forEach((step) => {
      if (!step || typeof step !== 'object') return;
      const stepId = normalizeOptionalStepText(step.stepId);
      const nestedEvents = parseRawTransportArray(step.visualRelationEvents);
      if (nestedEvents.length === 0) return;
      harvestedFromDerivationSteps = true;
      nestedEvents.forEach((event) => pushEvent(event, stepId));
    });

    if (harvestedFromDerivationFrames) {
      payloadIntegrityFlags.push('nested_visual_relation_events_lifted_from_derivation_frames');
    }
    if (harvestedFromDerivationSteps) {
      payloadIntegrityFlags.push('nested_visual_relation_events_lifted_from_derivation_steps');
    }
    if (inferredStepIdFromStepIndex) {
      payloadIntegrityFlags.push('visual_relation_event_stepid_inferred_from_stepindex');
    }

    return merged.length > 0 ? merged : undefined;
  };

  const normalizeParseResult = (
    value,
    framework = 'xbar',
    sentence = '',
    modelRoute = 'pro',
    enforceDerivationRouteContract = false,
    options = {}
  ) => {
    const parsed = value;
    if (!parsed || typeof parsed !== 'object') {
      throw new ParseApiError('BAD_MODEL_RESPONSE', 'Malformed parse result from model.', 502);
    }
    const payloadIntegrityFlags = Array.isArray(options?.payloadIntegrityFlags)
      ? options.payloadIntegrityFlags.slice()
      : [];
    const requireFullDerivationFrameContract = enforceDerivationRouteContract;
    const minDerivationFrames = 3;
    const rawDerivationStages = Array.isArray(parsed.derivationStages) ? parsed.derivationStages : [];
    const usesDerivationStages = rawDerivationStages.length > 0;
    const rawDerivationFrames = normalizeDerivationStagesToDerivationFrames(rawDerivationStages, {
      integrityFlags: payloadIntegrityFlags
    });
    if (usesDerivationStages) {
      payloadIntegrityFlags.push('derivation_stages_compiled_to_derivation_frames');
    }
    // New derivation-stage parses compile renderable relations from visualRelations.
    // Legacy model-authored visualRelationEvents must not override those authored anchors.
    const rawVisualRelationEvents = mergeRawVisualRelationEvents({
      topLevelVisualRelationEvents: undefined,
      rawDerivationFrames,
      rawDerivationSteps: undefined,
      payloadIntegrityFlags
    });
    if (requireFullDerivationFrameContract && rawDerivationFrames.length < minDerivationFrames) {
      throw new ParseApiError(
        'BAD_MODEL_RESPONSE',
        `Pro analysis must include at least ${minDerivationFrames} derivationStages.`,
        502
      );
    }
    if (requireFullDerivationFrameContract && rawDerivationFrames.length === minDerivationFrames) {
      payloadIntegrityFlags.push('preferred_derivation_stage_count_underfilled:3');
    }

    const sentenceTokens = tokenizeSentenceSurfaceOrder(sentence);
    let derivationFrames = materializeImplicitPhrasalTraceShellsInDerivationFrames(
      normalizeDerivationFrames(rawDerivationFrames, framework, sentenceTokens, {
        integrityFlags: payloadIntegrityFlags
      })
    );
    const derivationPrimaryBundle = derivationFrames.length > 0
      ? buildCanonicalDerivationFromDerivationFrames(derivationFrames, sentenceTokens, framework)
      : null;
    if (!derivationPrimaryBundle?.tree) {
      throw new ParseApiError(
        'BAD_MODEL_RESPONSE',
        derivationFrames.length > 0
          ? 'Derivation frames never produced a committed final structure whose overt terminals match the input sentence.'
          : 'Derivation analysis failed to produce a committed tree from derivationStages.',
        502
      );
    }
    const treeSource = derivationPrimaryBundle.tree;
    const nodeReferences = collectNodeReferencesById(treeSource);
    const { tree: rawTree, nodeIds } = normalizeSyntaxTreeWithIds(treeSource, nodeReferences, framework, sentenceTokens);
    const nodeById = buildNodeIndexFromTree(rawTree);
    const labelIndex = buildNodeLabelIndexFromTree(rawTree);
    const modelDerivationSteps = assignDerivationStepIds(normalizeDerivationSteps(parsed.derivationSteps, nodeIds));
    const normalizedRawVisualRelationEvents = normalizeVisualRelationEvents(rawVisualRelationEvents, nodeIds, modelDerivationSteps, nodeById, labelIndex);
    const { tree, surfaceOrder } = validateAndCommitSurfaceOrder(parsed.surfaceOrder, rawTree, sentence);
    validateSpelloutConsistency(modelDerivationSteps, tokenizeSentenceSurfaceOrder(sentence), surfaceOrder);
    const visualRelationEvents = buildCanonicalVisualRelationEvents({
      tree,
      derivationSteps: modelDerivationSteps,
      rawVisualRelationEvents: normalizedRawVisualRelationEvents
    });
    const committedTree = derivationPrimaryBundle.tree;
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
    const visualRelationEventsForCommittedTree = Array.isArray(derivationPrimaryBundle?.visualRelationEvents) && derivationPrimaryBundle.visualRelationEvents.length > 0
      ? derivationPrimaryBundle.visualRelationEvents
      : visualRelationEvents;
    materializeCommittedTraceShells(committedTree, visualRelationEventsForCommittedTree);
    const authoritativeVisualRelationEvents = visualRelationEventsForCommittedTree;
    const derivationDerivedSteps = Array.isArray(derivationPrimaryBundle?.derivationSteps) && derivationPrimaryBundle.derivationSteps.length > 0
      ? derivationPrimaryBundle.derivationSteps
      : Array.isArray(modelDerivationSteps) && modelDerivationSteps.length > 0
        ? modelDerivationSteps
        : [];
    const identifiedDerivationSteps = assignDerivationStepIds(derivationDerivedSteps);
    const committedNodeById = buildNodeIndexFromTree(committedTree);
    const finalNodeIds = new Set(committedNodeById.keys());
    const derivationNodeIds = collectDerivationFrameNodeIds(derivationFrames);
    const chainNodeIds = new Set([...finalNodeIds, ...derivationNodeIds]);
    // Top-level chains are compatibility mirrors only. The canonical chain
    // view is compiled from derivation-frame changes and movement normalization,
    // then optionally enriched with any compatible legacy chain payload.
    const suppliedChains = normalizeChains(parsed.chains, chainNodeIds);
    const canonicalChainEntries = buildCanonicalChains({
      suppliedChains,
      derivationSteps: identifiedDerivationSteps,
      visualRelationEvents: authoritativeVisualRelationEvents,
      nodeIds: chainNodeIds,
      nodeById: committedNodeById
    });
    const chainsWithFieldFallback = buildChainsWithFieldFallback({
      suppliedChains,
      canonicalChains: canonicalChainEntries,
      nodeIds: chainNodeIds
    });
    const authoritativeVisualRelationEventsWithChainIds = backfillVisualRelationEventChainIds({
      visualRelationEvents: authoritativeVisualRelationEvents,
      chains: chainsWithFieldFallback,
      derivationSteps: identifiedDerivationSteps
    });
    runSemanticValidation('chain-consistency', () => {
      validatePronouncedCopiesAgainstCommittedTree({
        chains: chainsWithFieldFallback,
        tree: committedTree,
        visualRelationEvents: authoritativeVisualRelationEventsWithChainIds
      });
    });
    const chainIds = new Set(chainsWithFieldFallback.map((entry) => entry.chainId).filter(Boolean));
    const identifiedStepIds = new Set(
      (identifiedDerivationSteps || [])
        .map((step) => normalizeOptionalStepText(step?.stepId))
        .filter(Boolean)
    );
    const rawStepIds = new Set([
      ...(modelDerivationSteps || []).map((step) => normalizeOptionalStepText(step?.stepId)).filter(Boolean),
      ...(identifiedDerivationSteps || []).map((step) => normalizeOptionalStepText(step?.stepId)).filter(Boolean)
    ]);
    const {
      derivationFrames: derivationFramesWithCompiledChanges,
      frameCommitmentFacts
    } = compileFrameChangeCommitments({
      derivationFrames,
      nodeIds: chainNodeIds,
      stepIds: rawStepIds
    });
    derivationFrames = derivationFramesWithCompiledChanges;
    const resolvedVisualRelations = buildResolvedVisualRelationsFromDerivationFrames(derivationFrames);
    const directFeatureLedger = ensureStructuredEntryIds(
      normalizeFeatureLedger(parsed.featureLedger, finalNodeIds, rawStepIds),
      'entryId',
      'feature'
    );
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
    const compatibilityCommitmentGraph = normalizeCommitmentGraph(parsed.commitmentGraph, chainNodeIds, rawStepIds);
    // Derivation frame change transactions are the authored source of truth.
    // Top-level commitmentGraph remains compatibility input only for older
    // payloads that do not yet carry frame.change.
    const rawCommitmentGraph = frameCommitmentFacts.length > 0
      ? mergeAuthoredCommitmentFacts(frameCommitmentFacts)
      : mergeAuthoredCommitmentFacts(compatibilityCommitmentGraph);
    const projectedCommitmentSourceFacts = rawCommitmentGraph.filter((entry) => isProjectedCommitmentKind(entry?.kind));
    const projectedCommitmentLedgers = projectLedgersFromCommitmentGraph(projectedCommitmentSourceFacts, finalNodeIds, rawStepIds);
    const useProjectedCommitmentLedgers = projectedCommitmentSourceFacts.length > 0;
    const featureLedger = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.featureLedger, 'entryId', 'feature')
      : directFeatureLedger;
    const caseAssignments = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.caseAssignments, 'assignmentId', 'case')
      : directCaseAssignments;
    const argumentStructure = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.argumentStructure, 'argumentId', 'argument')
      : directArgumentStructure;
    const phaseLog = useProjectedCommitmentLedgers
      ? projectedCommitmentLedgers.phaseLog
      : directPhaseLog;
    const morphologyRealization = useProjectedCommitmentLedgers
      ? projectedCommitmentLedgers.morphologyRealization
      : directMorphologyRealization;
    const selectionLedger = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.selectionLedger, 'selectionId', 'selection')
      : directSelectionLedger;
    const linearizationLedger = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.linearizationLedger, 'linearizationId', 'lin')
      : directLinearizationLedger;
    const bindingLedger = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.bindingLedger, 'bindingId', 'binding')
      : directBindingLedger;
    const clausalDependencies = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.clausalDependencies, 'dependencyId', 'dependency')
      : directClausalDependencies;
    const agreementLedger = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.agreementLedger, 'agreementId', 'agreement')
      : directAgreementLedger;
    const probeLedger = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.probeLedger, 'probeId', 'probe')
      : directProbeLedger;
    const nullElementLedger = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.nullElementLedger, 'nullElementId', 'nullElement')
      : directNullElementLedger;
    const predicateClassLedger = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.predicateClassLedger, 'predicateClassId', 'predicateClass')
      : directPredicateClassLedger;
    const diagnosticLedger = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.diagnosticLedger, 'diagnosticId', 'diagnostic')
      : directDiagnosticLedger;
    const parameterLedger = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.parameterLedger, 'parameterId', 'parameter')
      : directParameterLedger;
    const informationStructureLedger = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.informationStructureLedger, 'informationStructureId', 'info')
      : directInformationStructureLedger;
    const operatorScopeLedger = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.operatorScopeLedger, 'operatorScopeId', 'scope')
      : directOperatorScopeLedger;
    const voiceValencyLedger = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.voiceValencyLedger, 'voiceValencyId', 'voice')
      : directVoiceValencyLedger;
    const localityLedger = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.localityLedger, 'localityId', 'local')
      : directLocalityLedger;
    const predicationLedger = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.predicationLedger, 'predicationId', 'pred')
      : directPredicationLedger;
    const particleLedger = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.particleLedger, 'particleId', 'particle')
      : directParticleLedger;
    const evidentialityLedger = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.evidentialityLedger, 'evidentialityId', 'evidentiality')
      : directEvidentialityLedger;
    const mirativityLedger = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.mirativityLedger, 'mirativityId', 'mirativity')
      : directMirativityLedger;
    const honorificityLedger = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.honorificityLedger, 'honorificityId', 'honorificity')
      : directHonorificityLedger;
    const switchReferenceLedger = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.switchReferenceLedger, 'switchReferenceId', 'switchref')
      : directSwitchReferenceLedger;
    const logophoraLedger = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.logophoraLedger, 'logophoraId', 'logophora')
      : directLogophoraLedger;
    const eventStructureLedger = useProjectedCommitmentLedgers
      ? ensureStructuredEntryIds(projectedCommitmentLedgers.eventStructureLedger, 'eventStructureId', 'eventstruct')
      : directEventStructureLedger;
    const projectedCommitmentGraph = buildCommitmentGraphFromNormalizedLedgers({
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
    const commitmentGraph = enrichMovementCommitmentFactsFromEvents(
      rawCommitmentGraph.length > 0
        ? rawCommitmentGraph
        : projectedCommitmentGraph,
      authoritativeVisualRelationEventsWithChainIds,
      committedNodeById
    );
    // Keep note support generic. Projected helper ids can still back notes, but
    // noteBindings no longer expose one field per ledger family.
    const noteSupportIds = new Set([
      ...commitmentGraph.map((entry) => normalizeOptionalStepText(entry?.factId)),
      ...featureLedger.map((entry) => normalizeOptionalStepText(entry?.entryId)),
      ...phaseLog.map((entry) => normalizeOptionalStepText(entry?.phaseId)),
      ...morphologyRealization.map((entry) => normalizeOptionalStepText(entry?.realizationId)),
      ...caseAssignments.map((entry) => normalizeOptionalStepText(entry?.assignmentId)),
      ...argumentStructure.map((entry) => normalizeOptionalStepText(entry?.argumentId)),
      ...selectionLedger.map((entry) => normalizeOptionalStepText(entry?.selectionId)),
      ...bindingLedger.map((entry) => normalizeOptionalStepText(entry?.bindingId)),
      ...clausalDependencies.map((entry) => normalizeOptionalStepText(entry?.dependencyId)),
      ...agreementLedger.map((entry) => normalizeOptionalStepText(entry?.agreementId)),
      ...predicateClassLedger.map((entry) => normalizeOptionalStepText(entry?.predicateClassId)),
      ...probeLedger.map((entry) => normalizeOptionalStepText(entry?.probeId)),
      ...nullElementLedger.map((entry) => normalizeOptionalStepText(entry?.nullElementId)),
      ...diagnosticLedger.map((entry) => normalizeOptionalStepText(entry?.diagnosticId)),
      ...parameterLedger.map((entry) => normalizeOptionalStepText(entry?.parameterId)),
      ...informationStructureLedger.map((entry) => normalizeOptionalStepText(entry?.informationStructureId)),
      ...operatorScopeLedger.map((entry) => normalizeOptionalStepText(entry?.operatorScopeId)),
      ...voiceValencyLedger.map((entry) => normalizeOptionalStepText(entry?.voiceValencyId)),
      ...linearizationLedger.map((entry) => normalizeOptionalStepText(entry?.linearizationId)),
      ...localityLedger.map((entry) => normalizeOptionalStepText(entry?.localityId)),
      ...predicationLedger.map((entry) => normalizeOptionalStepText(entry?.predicationId)),
      ...particleLedger.map((entry) => normalizeOptionalStepText(entry?.particleId)),
      ...evidentialityLedger.map((entry) => normalizeOptionalStepText(entry?.evidentialityId)),
      ...mirativityLedger.map((entry) => normalizeOptionalStepText(entry?.mirativityId)),
      ...honorificityLedger.map((entry) => normalizeOptionalStepText(entry?.honorificityId)),
      ...switchReferenceLedger.map((entry) => normalizeOptionalStepText(entry?.switchReferenceId)),
      ...logophoraLedger.map((entry) => normalizeOptionalStepText(entry?.logophoraId)),
      ...eventStructureLedger.map((entry) => normalizeOptionalStepText(entry?.eventStructureId))
    ].filter(Boolean));
    const compiledDerivationFrameNoteBindings = compileNoteBindingsFromDerivationFrames(derivationFrames, {
      stepIds: identifiedStepIds,
      nodeIds: finalNodeIds,
      chainIds,
      commitmentFacts: commitmentGraph,
      commitmentFactIds: new Set(commitmentGraph.map((entry) => normalizeOptionalStepText(entry?.factId)).filter(Boolean)),
      supportIds: noteSupportIds
    });
    const noteBindings = compiledDerivationFrameNoteBindings;
    const notesSource = compiledDerivationFrameNoteBindings.length > 0
      ? 'derivationStages'
      : 'none';
    const derivationStages = derivationFrames.map((frame, index) => {
      const details = frame?.change?.details && typeof frame.change.details === 'object' && !Array.isArray(frame.change.details)
        ? frame.change.details
        : {};
      const stageRecord = normalizeOptionalStepText(details.stageRecord)
        || normalizeOptionalStepText(details.note || frame?.note || frame?.change?.statement);
      const visualRelations = Array.isArray(details.derivationStageVisualRelations)
        ? details.derivationStageVisualRelations
        : [];
      return {
        stepId: normalizeOptionalStepText(frame?.stepId) || `d${index + 1}`,
        statement: normalizeOptionalStepText(frame?.change?.statement) || `Derivation stage ${index + 1}`,
        stageRecord,
        visualRelations,
        workspaceForest: frame?.after?.workspaceForest || [],
      };
    });
    const groundedExplanation = harmonizeExplanationWithDerivation(
      buildGroundedExplanation({
        tree: committedTree,
        derivationSteps: identifiedDerivationSteps,
        visualRelationEvents: authoritativeVisualRelationEventsWithChainIds,
        framework
      }),
      identifiedDerivationSteps,
      authoritativeVisualRelationEventsWithChainIds,
      committedTree,
      framework
    );
    const coherentExplanation = noteBindings.length > 0
      ? buildExplanationFromNoteBindings(noteBindings)
      : groundedExplanation;
    auditNoteConsistency(() => {
      if (noteBindings.length === 0) return;
      validateNoteBindingsAgainstStructuredAnalysis({
        noteBindings,
        visualRelationEvents: authoritativeVisualRelationEventsWithChainIds,
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
    const rawCompletenessStatus = computeCompletenessStatus({
      derivationFrames,
      rawDerivationSteps: modelDerivationSteps,
      chains: chainsWithFieldFallback,
      commitmentGraph,
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
    const validationWarnings = collectCompletenessWarnings({
      noteBindings,
      commitmentGraph,
      derivationFrames,
      chains: chainsWithFieldFallback
    });
    const completenessStatus = validationWarnings.length > 0 && rawCompletenessStatus === 'full'
      ? 'partial'
      : rawCompletenessStatus;
    const provenance = {
      modelRoute,
      framework,
      timestamp: new Date().toISOString(),
      treeSource: 'derivationStages',
      promptVersion: normalizeOptionalStepText(process.env.BABEL_PROMPT_VERSION),
      parserVersion: normalizeOptionalStepText(process.env.BABEL_PARSER_VERSION || process.env.VERCEL_GIT_COMMIT_SHA),
      uiVersion: normalizeOptionalStepText(process.env.BABEL_UI_VERSION || process.env.VERCEL_GIT_COMMIT_SHA),
      payloadIntegrityFlags: payloadIntegrityFlags.length > 0
        ? Array.from(new Set(payloadIntegrityFlags))
        : undefined,
      validationWarnings: validationWarnings.length > 0
        ? validationWarnings
        : undefined,
      hasCommitmentGraph: commitmentGraph.length > 0,
      hasCommitmentFacts: commitmentGraph.length > 0,
      hasDerivationStages: derivationStages.length > 0,
      hasResolvedVisualRelations: resolvedVisualRelations.length > 0,
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
      notesSource,
      notesCompiledFromDerivationStages: usesDerivationStages && compiledDerivationFrameNoteBindings.length > 0,
      completenessStatus
    };

    return {
      tree: committedTree,
      rootLabel: normalizeOptionalStepText(committedTree?.label),
      explanation: coherentExplanation,
      surfaceOrder: committedSurfaceOrder,
      derivationStages,
      resolvedVisualRelations,
      noteBindings,
      rawDerivationSteps: modelDerivationSteps,
      derivationSteps: identifiedDerivationSteps,
      chains: chainsWithFieldFallback,
      commitmentFacts: commitmentGraph,
      commitmentGraph,
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
    enforceDerivationRouteContract = false,
    options = {}
  ) => {
    const parsed = value;
    const analysesSource = Array.isArray(parsed?.analyses)
      ? parsed.analyses.slice(0, 2)
      : parsed
        ? [parsed]
        : [];

    const analyses = analysesSource
      .map((analysis) => normalizeParseResult(
        analysis,
        framework,
        sentence,
        modelRoute,
        enforceDerivationRouteContract,
        options
      ))
      .slice(0, 2);

    if (analyses.length === 0) {
      throw new ParseApiError('BAD_MODEL_RESPONSE', 'No valid analyses returned by model.', 502);
    }

    const ambiguityDetected = analyses.length > 1 || Boolean(parsed?.ambiguityDetected);

    return {
      analyses,
      ambiguityDetected,
      ambiguityNote: ambiguityDetected ? String(parsed?.ambiguityNote || '').trim() || undefined : undefined
    };
  };

  const validateFinalProNoteBindings = (bundle) => {
    const analysis = bundle?.analyses?.[0];
    if (!analysis) return bundle;
    const noteBindings = Array.isArray(analysis.noteBindings) ? analysis.noteBindings : [];
    if (noteBindings.length > 0) return bundle;
    throw new ParseApiError(
      'BAD_MODEL_RESPONSE',
      'Pro analyses must include non-empty noteBindings compiled from derivationStages.',
      422
    );
  };

  return {
    deriveChainsFromCommittedAnalysis,
    backfillVisualRelationEventChainIds,
    normalizeParseResult,
    normalizeParseBundle,
    validateFinalProNoteBindings
  };
};
