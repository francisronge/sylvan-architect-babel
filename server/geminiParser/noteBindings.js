export const createNoteBindingHelpers = ({
  normalizeOptionalStepText,
  cleanExplanationWhitespace,
  ensureExplanationTerminator
}) => {
  const normalizeNoteBindings = (
    value,
    {
      stepIds,
      nodeIds,
      chainIds,
      chainIdAliases,
      researchTraceIds,
      featureEntryIds,
      caseAssignmentIds,
      argumentIds,
      selectionIds,
      bindingIds,
      dependencyIds,
      agreementIds,
      predicateClassIds,
      probeIds,
      nullElementIds,
      diagnosticIds,
      parameterIds,
      informationStructureIds,
      operatorScopeIds,
      voiceValencyIds,
      linearizationIds,
      localityIds,
      predicationIds
    } = {}
  ) => {
    if (!Array.isArray(value)) return [];
    const allowedStepIds = stepIds instanceof Set ? stepIds : null;
    const allowedNodeIds = nodeIds instanceof Set ? nodeIds : null;
    const allowedChainIds = chainIds instanceof Set ? chainIds : null;
    const aliasMap = chainIdAliases instanceof Map ? chainIdAliases : null;
    const allowedResearchTraceIds = researchTraceIds instanceof Set ? researchTraceIds : null;
    const allowedFeatureEntryIds = featureEntryIds instanceof Set ? featureEntryIds : null;
    const allowedCaseAssignmentIds = caseAssignmentIds instanceof Set ? caseAssignmentIds : null;
    const allowedArgumentIds = argumentIds instanceof Set ? argumentIds : null;
    const allowedSelectionIds = selectionIds instanceof Set ? selectionIds : null;
    const allowedBindingIds = bindingIds instanceof Set ? bindingIds : null;
    const allowedDependencyIds = dependencyIds instanceof Set ? dependencyIds : null;
    const allowedAgreementIds = agreementIds instanceof Set ? agreementIds : null;
    const allowedPredicateClassIds = predicateClassIds instanceof Set ? predicateClassIds : null;
    const allowedProbeIds = probeIds instanceof Set ? probeIds : null;
    const allowedNullElementIds = nullElementIds instanceof Set ? nullElementIds : null;
    const allowedDiagnosticIds = diagnosticIds instanceof Set ? diagnosticIds : null;
    const allowedParameterIds = parameterIds instanceof Set ? parameterIds : null;
    const allowedInformationStructureIds = informationStructureIds instanceof Set ? informationStructureIds : null;
    const allowedOperatorScopeIds = operatorScopeIds instanceof Set ? operatorScopeIds : null;
    const allowedVoiceValencyIds = voiceValencyIds instanceof Set ? voiceValencyIds : null;
    const allowedLinearizationIds = linearizationIds instanceof Set ? linearizationIds : null;
    const allowedLocalityIds = localityIds instanceof Set ? localityIds : null;
    const allowedPredicationIds = predicationIds instanceof Set ? predicationIds : null;
    const allowedSupportIds = (() => {
      const merged = new Set();
      [
        ...(allowedResearchTraceIds ? [...allowedResearchTraceIds] : []),
        ...(allowedFeatureEntryIds ? [...allowedFeatureEntryIds] : []),
        ...(allowedCaseAssignmentIds ? [...allowedCaseAssignmentIds] : []),
        ...(allowedArgumentIds ? [...allowedArgumentIds] : []),
        ...(allowedSelectionIds ? [...allowedSelectionIds] : []),
        ...(allowedBindingIds ? [...allowedBindingIds] : []),
        ...(allowedDependencyIds ? [...allowedDependencyIds] : []),
        ...(allowedAgreementIds ? [...allowedAgreementIds] : []),
        ...(allowedPredicateClassIds ? [...allowedPredicateClassIds] : []),
        ...(allowedProbeIds ? [...allowedProbeIds] : []),
        ...(allowedNullElementIds ? [...allowedNullElementIds] : []),
        ...(allowedDiagnosticIds ? [...allowedDiagnosticIds] : []),
        ...(allowedParameterIds ? [...allowedParameterIds] : []),
        ...(allowedInformationStructureIds ? [...allowedInformationStructureIds] : []),
        ...(allowedOperatorScopeIds ? [...allowedOperatorScopeIds] : []),
        ...(allowedVoiceValencyIds ? [...allowedVoiceValencyIds] : []),
        ...(allowedLinearizationIds ? [...allowedLinearizationIds] : []),
        ...(allowedLocalityIds ? [...allowedLocalityIds] : []),
        ...(allowedPredicationIds ? [...allowedPredicationIds] : [])
      ]
        .filter(Boolean)
        .forEach((id) => merged.add(id));
      return merged.size > 0 ? merged : null;
    })();

    const normalizeLinkedIds = (items, allowedIds) =>
      Array.isArray(items)
        ? items
            .map((entry) => normalizeOptionalStepText(entry))
            .filter((entry) => entry && (!allowedIds || allowedIds.has(entry)))
        : undefined;

    const normalizeSupportIds = (items) =>
      Array.isArray(items)
        ? items
            .map((entry) => normalizeOptionalStepText(entry))
            .filter((entry) => entry && (!allowedSupportIds || allowedSupportIds.has(entry)))
        : undefined;

    return value
      .map((item, index) => {
        if (!item || typeof item !== 'object') return null;
        const noteId = normalizeOptionalStepText(item.noteId || item.id);
        const rawKindValue = normalizeOptionalStepText(item.kind || item.noteType || item.category);
        const rawKind = rawKindValue === 'movement'
          ? 'chain'
          : rawKindValue;
        const text = cleanExplanationWhitespace(String(item.text || item.content || item.note || ''));
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
        const supportIdsValue = normalizeSupportIds(item.supportIds);
        const distributedSupportIds = Array.isArray(supportIdsValue)
          ? supportIdsValue.reduce((acc, supportId) => {
              if (allowedFeatureEntryIds?.has(supportId)) acc.featureEntryIds.push(supportId);
              if (allowedResearchTraceIds?.has(supportId)) acc.researchTraceIds.push(supportId);
              if (allowedCaseAssignmentIds?.has(supportId)) acc.caseAssignmentIds.push(supportId);
              if (allowedArgumentIds?.has(supportId)) acc.argumentIds.push(supportId);
              if (allowedSelectionIds?.has(supportId)) acc.selectionIds.push(supportId);
              if (allowedBindingIds?.has(supportId)) acc.bindingIds.push(supportId);
              if (allowedDependencyIds?.has(supportId)) acc.dependencyIds.push(supportId);
              if (allowedAgreementIds?.has(supportId)) acc.agreementIds.push(supportId);
              if (allowedPredicateClassIds?.has(supportId)) acc.predicateClassIds.push(supportId);
              if (allowedProbeIds?.has(supportId)) acc.probeIds.push(supportId);
              if (allowedNullElementIds?.has(supportId)) acc.nullElementIds.push(supportId);
              if (allowedDiagnosticIds?.has(supportId)) acc.diagnosticIds.push(supportId);
              if (allowedParameterIds?.has(supportId)) acc.parameterIds.push(supportId);
              if (allowedInformationStructureIds?.has(supportId)) acc.informationStructureIds.push(supportId);
              if (allowedOperatorScopeIds?.has(supportId)) acc.operatorScopeIds.push(supportId);
              if (allowedVoiceValencyIds?.has(supportId)) acc.voiceValencyIds.push(supportId);
              if (allowedLinearizationIds?.has(supportId)) acc.linearizationIds.push(supportId);
              if (allowedLocalityIds?.has(supportId)) acc.localityIds.push(supportId);
              if (allowedPredicationIds?.has(supportId)) acc.predicationIds.push(supportId);
              return acc;
            }, {
              researchTraceIds: [],
              featureEntryIds: [],
              caseAssignmentIds: [],
              argumentIds: [],
              selectionIds: [],
              bindingIds: [],
              dependencyIds: [],
              agreementIds: [],
              predicateClassIds: [],
              probeIds: [],
              nullElementIds: [],
              diagnosticIds: [],
              parameterIds: [],
              informationStructureIds: [],
              operatorScopeIds: [],
              voiceValencyIds: [],
              linearizationIds: [],
              localityIds: [],
              predicationIds: []
            })
          : null;
        const mergeUniqueIds = (...groups) => {
          const merged = groups.flat().filter(Boolean);
          return merged.length > 0 ? [...new Set(merged)] : undefined;
        };
        const featureEntryIdsValue = mergeUniqueIds(
          normalizeLinkedIds(item.featureEntryIds, allowedFeatureEntryIds),
          distributedSupportIds?.featureEntryIds
        );
        const researchTraceIdsValue = mergeUniqueIds(
          normalizeLinkedIds(item.researchTraceIds, allowedResearchTraceIds),
          distributedSupportIds?.researchTraceIds
        );
        const caseAssignmentIdsValue = mergeUniqueIds(
          normalizeLinkedIds(item.caseAssignmentIds, allowedCaseAssignmentIds),
          distributedSupportIds?.caseAssignmentIds
        );
        const argumentIdsValue = mergeUniqueIds(
          normalizeLinkedIds(item.argumentIds, allowedArgumentIds),
          distributedSupportIds?.argumentIds
        );
        const selectionIdsValue = mergeUniqueIds(
          normalizeLinkedIds(item.selectionIds, allowedSelectionIds),
          distributedSupportIds?.selectionIds
        );
        const bindingIdsValue = mergeUniqueIds(
          normalizeLinkedIds(item.bindingIds, allowedBindingIds),
          distributedSupportIds?.bindingIds
        );
        const dependencyIdsValue = mergeUniqueIds(
          normalizeLinkedIds(item.dependencyIds, allowedDependencyIds),
          distributedSupportIds?.dependencyIds
        );
        const agreementIdsValue = mergeUniqueIds(
          normalizeLinkedIds(item.agreementIds, allowedAgreementIds),
          distributedSupportIds?.agreementIds
        );
        const predicateClassIdsValue = mergeUniqueIds(
          normalizeLinkedIds(item.predicateClassIds, allowedPredicateClassIds),
          distributedSupportIds?.predicateClassIds
        );
        const probeIdsValue = mergeUniqueIds(
          normalizeLinkedIds(item.probeIds, allowedProbeIds),
          distributedSupportIds?.probeIds
        );
        const nullElementIdsValue = mergeUniqueIds(
          normalizeLinkedIds(item.nullElementIds, allowedNullElementIds),
          distributedSupportIds?.nullElementIds
        );
        const diagnosticIdsValue = mergeUniqueIds(
          normalizeLinkedIds(item.diagnosticIds, allowedDiagnosticIds),
          distributedSupportIds?.diagnosticIds
        );
        const parameterIdsValue = mergeUniqueIds(
          normalizeLinkedIds(item.parameterIds, allowedParameterIds),
          distributedSupportIds?.parameterIds
        );
        const informationStructureIdsValue = mergeUniqueIds(
          normalizeLinkedIds(item.informationStructureIds, allowedInformationStructureIds),
          distributedSupportIds?.informationStructureIds
        );
        const operatorScopeIdsValue = mergeUniqueIds(
          normalizeLinkedIds(item.operatorScopeIds, allowedOperatorScopeIds),
          distributedSupportIds?.operatorScopeIds
        );
        const voiceValencyIdsValue = mergeUniqueIds(
          normalizeLinkedIds(item.voiceValencyIds, allowedVoiceValencyIds),
          distributedSupportIds?.voiceValencyIds
        );
        const linearizationIdsValue = mergeUniqueIds(
          normalizeLinkedIds(item.linearizationIds, allowedLinearizationIds),
          distributedSupportIds?.linearizationIds
        );
        const localityIdsValue = mergeUniqueIds(
          normalizeLinkedIds(item.localityIds, allowedLocalityIds),
          distributedSupportIds?.localityIds
        );
        const predicationIdsValue = mergeUniqueIds(
          normalizeLinkedIds(item.predicationIds, allowedPredicationIds),
          distributedSupportIds?.predicationIds
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
          if (
            (featureEntryIdsValue && featureEntryIdsValue.length > 0) ||
            (caseAssignmentIdsValue && caseAssignmentIdsValue.length > 0) ||
            (argumentIdsValue && argumentIdsValue.length > 0) ||
            (bindingIdsValue && bindingIdsValue.length > 0) ||
            (dependencyIdsValue && dependencyIdsValue.length > 0) ||
            (agreementIdsValue && agreementIdsValue.length > 0) ||
            (predicateClassIdsValue && predicateClassIdsValue.length > 0) ||
            (probeIdsValue && probeIdsValue.length > 0) ||
            (nullElementIdsValue && nullElementIdsValue.length > 0) ||
            (diagnosticIdsValue && diagnosticIdsValue.length > 0) ||
            (parameterIdsValue && parameterIdsValue.length > 0) ||
            (informationStructureIdsValue && informationStructureIdsValue.length > 0) ||
            (operatorScopeIdsValue && operatorScopeIdsValue.length > 0) ||
            (voiceValencyIdsValue && voiceValencyIdsValue.length > 0) ||
            (localityIdsValue && localityIdsValue.length > 0) ||
            (predicationIdsValue && predicationIdsValue.length > 0)
          ) {
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
          ...(researchTraceIdsValue && researchTraceIdsValue.length > 0 ? { researchTraceIds: researchTraceIdsValue } : {}),
          ...(featureEntryIdsValue && featureEntryIdsValue.length > 0 ? { featureEntryIds: featureEntryIdsValue } : {}),
          ...(caseAssignmentIdsValue && caseAssignmentIdsValue.length > 0 ? { caseAssignmentIds: caseAssignmentIdsValue } : {}),
          ...(argumentIdsValue && argumentIdsValue.length > 0 ? { argumentIds: argumentIdsValue } : {}),
          ...(selectionIdsValue && selectionIdsValue.length > 0 ? { selectionIds: selectionIdsValue } : {}),
          ...(bindingIdsValue && bindingIdsValue.length > 0 ? { bindingIds: bindingIdsValue } : {}),
          ...(dependencyIdsValue && dependencyIdsValue.length > 0 ? { dependencyIds: dependencyIdsValue } : {}),
          ...(agreementIdsValue && agreementIdsValue.length > 0 ? { agreementIds: agreementIdsValue } : {}),
          ...(predicateClassIdsValue && predicateClassIdsValue.length > 0 ? { predicateClassIds: predicateClassIdsValue } : {}),
          ...(probeIdsValue && probeIdsValue.length > 0 ? { probeIds: probeIdsValue } : {}),
          ...(nullElementIdsValue && nullElementIdsValue.length > 0 ? { nullElementIds: nullElementIdsValue } : {}),
          ...(diagnosticIdsValue && diagnosticIdsValue.length > 0 ? { diagnosticIds: diagnosticIdsValue } : {}),
          ...(parameterIdsValue && parameterIdsValue.length > 0 ? { parameterIds: parameterIdsValue } : {}),
          ...(informationStructureIdsValue && informationStructureIdsValue.length > 0 ? { informationStructureIds: informationStructureIdsValue } : {}),
          ...(operatorScopeIdsValue && operatorScopeIdsValue.length > 0 ? { operatorScopeIds: operatorScopeIdsValue } : {}),
          ...(voiceValencyIdsValue && voiceValencyIdsValue.length > 0 ? { voiceValencyIds: voiceValencyIdsValue } : {}),
          ...(linearizationIdsValue && linearizationIdsValue.length > 0 ? { linearizationIds: linearizationIdsValue } : {}),
          ...(localityIdsValue && localityIdsValue.length > 0 ? { localityIds: localityIdsValue } : {}),
          ...(predicationIdsValue && predicationIdsValue.length > 0 ? { predicationIds: predicationIdsValue } : {}),
          order: Number.isInteger(item.order) ? item.order : index
        };
      })
      .filter(Boolean);
  };

  const buildNoteBindingChainIdAliases = (_rawNoteBindings = [], _chainEntries = []) => {
    return new Map();
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
    buildNoteBindingChainIdAliases,
    buildExplanationFromNoteBindings
  };
};
