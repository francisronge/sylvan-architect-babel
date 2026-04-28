export const createNoteBindingHelpers = ({
  normalizeOptionalStepText,
  cleanExplanationWhitespace,
  ensureExplanationTerminator
}) => {
  // Notes are canonical-fact-first now. These legacy per-ledger fields are
  // accepted only as transport aliases and are folded back into generic supportIds.
  const LEGACY_NOTE_SUPPORT_FIELDS = [
    'featureEntryIds',
    'phaseIds',
    'morphologyIds',
    'realizationIds',
    'caseAssignmentIds',
    'argumentIds',
    'selectionIds',
    'bindingIds',
    'dependencyIds',
    'agreementIds',
    'predicateClassIds',
    'probeIds',
    'nullElementIds',
    'diagnosticIds',
    'parameterIds',
    'informationStructureIds',
    'operatorScopeIds',
    'voiceValencyIds',
    'linearizationIds',
    'localityIds',
    'predicationIds',
    'particleIds',
    'evidentialityIds',
    'mirativityIds',
    'honorificityIds',
    'switchReferenceIds',
    'logophoraIds',
    'eventStructureIds'
  ];

  const normalizeNoteBindings = (
    value,
    {
      stepIds,
      nodeIds,
      chainIds,
      chainIdAliases,
      commitmentFactIds,
      supportIds
    } = {}
  ) => {
    if (!Array.isArray(value)) return [];
    const allowedStepIds = stepIds instanceof Set ? stepIds : null;
    const allowedNodeIds = nodeIds instanceof Set ? nodeIds : null;
    const allowedChainIds = chainIds instanceof Set ? chainIds : null;
    const aliasMap = chainIdAliases instanceof Map ? chainIdAliases : null;
    const allowedCommitmentFactIds = commitmentFactIds instanceof Set ? commitmentFactIds : null;
    const allowedSupportIds = supportIds instanceof Set ? supportIds : null;

    const normalizeLinkedIds = (items, allowedIds) =>
      Array.isArray(items)
        ? items
            .map((entry) => normalizeOptionalStepText(entry))
            .filter((entry) => entry && (!allowedIds || allowedIds.has(entry)))
        : undefined;

    const normalizeSupportIds = (items) => (
      allowedSupportIds && Array.isArray(items)
        ? items
            .map((entry) => normalizeOptionalStepText(entry))
            .filter((entry) => entry && allowedSupportIds.has(entry))
        : undefined
    );

    return value
      .map((item, index) => {
        if (!item || typeof item !== 'object') return null;
        const noteId = normalizeOptionalStepText(item.noteId || item.id);
        const rawKindValue = normalizeOptionalStepText(item.kind || item.noteType || item.category);
        const rawKind = rawKindValue === 'movement'
          ? 'chain'
          : rawKindValue;
        const text = cleanExplanationWhitespace(String(item.text || item.explanation || item.content || item.note || ''));
        if (!text) return null;

        let chainId = normalizeOptionalStepText(
          item.chainId || (Array.isArray(item.chainIds) ? item.chainIds[0] : undefined)
        );
        const stepIdsValue = Array.isArray(item.stepIds)
          ? item.stepIds
              .map((stepId) => normalizeOptionalStepText(stepId))
              .filter((stepId) => stepId && (!allowedStepIds || allowedStepIds.has(stepId)))
          : undefined;
        const nodeIdsValue = Array.isArray(item.nodeIds)
          ? item.nodeIds
              .map((nodeId) => normalizeOptionalStepText(nodeId))
              .filter((nodeId) => nodeId && (!allowedNodeIds || allowedNodeIds.has(nodeId)))
          : undefined;
        const mergeUniqueIds = (...groups) => {
          const merged = groups.flat().filter(Boolean);
          return merged.length > 0 ? [...new Set(merged)] : undefined;
        };
        const legacySupportIdsValue = mergeUniqueIds(
          ...Object.entries(item)
            .filter(([field]) => LEGACY_NOTE_SUPPORT_FIELDS.includes(field))
            .map(([, fieldValue]) => normalizeLinkedIds(fieldValue, allowedSupportIds))
        );
        const supportIdsValue = mergeUniqueIds(
          normalizeSupportIds(item.supportIds),
          legacySupportIdsValue
        );
        const commitmentFactIdsValue = mergeUniqueIds(
          normalizeLinkedIds(item.commitmentFactIds, allowedCommitmentFactIds),
          Array.isArray(supportIdsValue)
            ? supportIdsValue.filter((supportId) => !allowedCommitmentFactIds || allowedCommitmentFactIds.has(supportId))
            : undefined
        );

        if (allowedChainIds && allowedChainIds.size > 0 && chainId && !allowedChainIds.has(chainId)) {
          const aliasedChainId = aliasMap?.get(chainId);
          if (aliasedChainId && allowedChainIds.has(aliasedChainId)) {
            chainId = aliasedChainId;
          }
        }

        const inferNoteKind = () => {
          if (rawKind) return rawKind;
          if (chainId) return 'chain';
          if ((commitmentFactIdsValue && commitmentFactIdsValue.length > 0) || (supportIdsValue && supportIdsValue.length > 0)) {
            return 'licensing';
          }
          return 'architecture';
        };
        const kind = inferNoteKind();
        if (!kind) return null;

        return {
          ...(noteId ? { noteId } : {}),
          kind,
          text,
          chainId: chainId || undefined,
          ...(stepIdsValue && stepIdsValue.length > 0 ? { stepIds: stepIdsValue } : {}),
          ...(nodeIdsValue && nodeIdsValue.length > 0 ? { nodeIds: nodeIdsValue } : {}),
          ...(supportIdsValue && supportIdsValue.length > 0 ? { supportIds: supportIdsValue } : {}),
          ...(commitmentFactIdsValue && commitmentFactIdsValue.length > 0 ? { commitmentFactIds: commitmentFactIdsValue } : {}),
          order: Number.isInteger(item.order) ? item.order : index
        };
      })
      .filter(Boolean);
  };

  const compileNoteBindingsFromDerivationFrames = (
    derivationFrames = [],
    {
      stepIds,
      nodeIds,
      chainIds,
      chainIdAliases,
      commitmentFacts,
      commitmentFactIds,
      supportIds
    } = {}
  ) => {
    if (!Array.isArray(derivationFrames) || derivationFrames.length === 0) return [];
    const allowedStepIds = stepIds instanceof Set ? stepIds : null;
    const allowedNodeIds = nodeIds instanceof Set ? nodeIds : null;
    const allowedChainIds = chainIds instanceof Set ? chainIds : null;
    const aliasMap = chainIdAliases instanceof Map ? chainIdAliases : null;
    const allowedCommitmentFactIds = commitmentFactIds instanceof Set ? commitmentFactIds : null;
    const allowedSupportIds = supportIds instanceof Set ? supportIds : null;
    const facts = Array.isArray(commitmentFacts) ? commitmentFacts : [];
    const factById = new Map();
    const factIdsByStepId = new Map();

    const pushStepFactId = (stepId, factId) => {
      if (!stepId || !factId) return;
      const existing = factIdsByStepId.get(stepId) || [];
      existing.push(factId);
      factIdsByStepId.set(stepId, existing);
    };

    facts.forEach((fact) => {
      if (!fact || typeof fact !== 'object') return;
      const factId = normalizeOptionalStepText(fact.factId || fact.id);
      if (!factId || (allowedCommitmentFactIds && !allowedCommitmentFactIds.has(factId))) return;
      factById.set(factId, fact);
      const linkedStepIds = Array.isArray(fact.stepIds)
        ? fact.stepIds.map((stepId) => normalizeOptionalStepText(stepId)).filter(Boolean)
        : [];
      const directStepId = normalizeOptionalStepText(fact.stepId);
      [...linkedStepIds, directStepId].filter(Boolean).forEach((stepId) => pushStepFactId(stepId, factId));
    });

    const normalizeTextKey = (value) =>
      cleanExplanationWhitespace(String(value || '')).toLowerCase().replace(/\s+/g, ' ');

    const readFrameDetails = (frame) => {
      const change = frame?.change && typeof frame.change === 'object' && !Array.isArray(frame.change)
        ? frame.change
        : null;
      const details = change?.details && typeof change.details === 'object' && !Array.isArray(change.details)
        ? change.details
        : {};
      return { change, details };
    };

    const getFrameRichNoteText = (frame) => {
      const { change, details } = readFrameDetails(frame);
      const richNote = cleanExplanationWhitespace(String(
        details.note
        || details.derivationalNote
        || details.analysisNote
        || details.explanation
        || ''
      ));
      if (!richNote) return '';
      const statement = cleanExplanationWhitespace(String(change?.statement || ''));
      if (!statement || normalizeTextKey(statement) === normalizeTextKey(richNote)) return richNote;
      return `${ensureExplanationTerminator(statement)} ${richNote}`;
    };

    const collectFrameNodeIds = (frame) => {
      const { change } = readFrameDetails(frame);
      const anchors = Array.isArray(change?.anchors) ? change.anchors : [];
      return Array.from(new Set(
        anchors
          .map((anchor) => normalizeOptionalStepText(anchor?.nodeId))
          .filter((nodeId) => nodeId && (!allowedNodeIds || allowedNodeIds.has(nodeId)))
      ));
    };

    const normalizeCompiledChainId = (frame) => {
      const { change, details } = readFrameDetails(frame);
      const continuityIds = Array.isArray(change?.continuityIds)
        ? change.continuityIds.map((value) => normalizeOptionalStepText(value)).filter(Boolean)
        : [];
      const rawChainId = normalizeOptionalStepText(
        details.chainId
        || details.continuityId
        || details.movement?.chainId
        || details.movement?.continuityId
        || details.headMovement?.chainId
        || details.headMovement?.continuityId
      ) || continuityIds[0];
      if (!rawChainId) return undefined;
      if (!allowedChainIds || allowedChainIds.has(rawChainId)) return rawChainId;
      const aliasedChainId = aliasMap?.get(rawChainId);
      return aliasedChainId && allowedChainIds.has(aliasedChainId)
        ? aliasedChainId
        : undefined;
    };

    const factIdsForStep = (stepId) => Array.from(new Set(
      (factIdsByStepId.get(stepId) || [])
        .filter((factId) => (!allowedCommitmentFactIds || allowedCommitmentFactIds.has(factId)))
        .filter((factId) => (!allowedSupportIds || allowedSupportIds.has(factId)))
    ));

    const inferCompiledKind = ({ text, chainId, frameFactIds }) => {
      if (chainId) return 'chain';
      const factsForFrame = frameFactIds.map((factId) => factById.get(factId)).filter(Boolean);
      if (factsForFrame.some((fact) => normalizeTextKey(fact?.kind).includes('movement') || normalizeOptionalStepText(fact?.chainId))) {
        return 'chain';
      }
      if (/(?:move|raise|front|displac|extract|shift|scrambl|remerge|internal merge|head movement|copy|copies)/i.test(text)) {
        return 'chain';
      }
      if (factsForFrame.some((fact) => /case|argument|selection|binding|agreement|licens|theta|feature/i.test(String(fact?.kind || fact?.family || fact?.subtype || '')))) {
        return 'licensing';
      }
      return 'architecture';
    };

    const compiled = derivationFrames
      .map((frame, index) => {
        if (!frame || typeof frame !== 'object') return null;
        const text = getFrameRichNoteText(frame);
        if (!text) return null;
        const rawStepId = normalizeOptionalStepText(frame.stepId);
        const frameStepIds = rawStepId && (!allowedStepIds || allowedStepIds.has(rawStepId))
          ? [rawStepId]
          : [];
        const nodeIdsValue = collectFrameNodeIds(frame);
        const chainId = normalizeCompiledChainId(frame);
        const frameFactIds = rawStepId ? factIdsForStep(rawStepId) : [];
        const kind = inferCompiledKind({ text, chainId, frameFactIds });
        return {
          noteId: `derivation_note_${index + 1}`,
          kind,
          text,
          ...(chainId ? { chainId } : {}),
          ...(frameStepIds.length > 0 ? { stepIds: frameStepIds } : {}),
          ...(nodeIdsValue.length > 0 ? { nodeIds: nodeIdsValue } : {}),
          ...(frameFactIds.length > 0 ? { supportIds: frameFactIds, commitmentFactIds: frameFactIds } : {}),
          order: index
        };
      })
      .filter(Boolean);

    return normalizeNoteBindings(compiled, {
      stepIds,
      nodeIds,
      chainIds,
      chainIdAliases,
      commitmentFactIds,
      supportIds
    });
  };

  const buildExplanationFromNoteBindings = (noteBindings = []) => {
    const ordered = Array.isArray(noteBindings)
      ? [...noteBindings]
          .filter((binding) => binding && typeof binding === 'object')
          .sort((a, b) => {
            const orderDelta = (Number.isInteger(a.order) ? a.order : Number.MAX_SAFE_INTEGER)
              - (Number.isInteger(b.order) ? b.order : Number.MAX_SAFE_INTEGER);
            if (orderDelta !== 0) return orderDelta;
            return 0;
          })
      : [];
    const joined = cleanExplanationWhitespace(
      ordered
        .map((binding) => cleanExplanationWhitespace(String(binding?.text || '')))
        .filter(Boolean)
        .join(' ')
    );
    return joined ? ensureExplanationTerminator(joined) : '';
  };

  return {
    normalizeNoteBindings,
    compileNoteBindingsFromDerivationFrames,
    buildExplanationFromNoteBindings
  };
};
