export const createStepNormalizationHelpers = ({
  normalizeTransportJsonArray,
  normalizeDerivationOperation,
  normalizeOptionalStepText,
  normalizeNodeIdArray,
  normalizeOptionalStringArray,
  normalizeSpelloutOrder,
  normalizeMovementStemFromId
}) => {
  const normalizeFeatureChecking = (value, nodeIds) => {
    const parsedValue = normalizeTransportJsonArray(value);
    if (!Array.isArray(parsedValue)) return undefined;

    const entries = parsedValue
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const feature = String(item.feature || '').trim();
        if (!feature) return null;

        const valueText = String(item.value || '').trim();
        const status = String(item.status || '').trim().toLowerCase();
        const probeNodeId = String(item.probeNodeId || '').trim();
        const goalNodeId = String(item.goalNodeId || '').trim();
        const probeLabel = String(item.probeLabel || '').trim();
        const goalLabel = String(item.goalLabel || '').trim();
        const note = String(item.note || '').trim();

        return {
          feature,
          value: valueText || undefined,
          status: status || undefined,
          probeNodeId: probeNodeId && nodeIds.has(probeNodeId) ? probeNodeId : undefined,
          goalNodeId: goalNodeId && nodeIds.has(goalNodeId) ? goalNodeId : undefined,
          probeLabel: probeLabel || undefined,
          goalLabel: goalLabel || undefined,
          note: note || undefined
        };
      })
      .filter(Boolean);

    return entries.length > 0 ? entries : undefined;
  };

  const normalizeDerivationSteps = (value, nodeIds) => {
    if (!Array.isArray(value)) return undefined;
    const steps = value
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const operation = normalizeDerivationOperation(item.operation);
        if (!operation) return null;
        const microOperations = Array.isArray(item.microOperations)
          ? item.microOperations
              .map((entry) => normalizeDerivationOperation(entry))
              .filter(Boolean)
          : undefined;
        return {
          stepId: normalizeOptionalStepText(item.stepId),
          operation,
          microOperations: microOperations && microOperations.length > 0 ? microOperations : undefined,
          affectedNodeIds: normalizeNodeIdArray(item.affectedNodeIds, nodeIds),
          trigger: normalizeOptionalStepText(item.trigger),
          chainId: normalizeOptionalStepText(item.chainId),
          spelloutDomain: normalizeOptionalStepText(item.spelloutDomain),
          preFeatures: normalizeOptionalStringArray(item.preFeatures),
          postFeatures: normalizeOptionalStringArray(item.postFeatures),
          thetaRole: normalizeOptionalStepText(item.thetaRole),
          introducerHead: normalizeOptionalStepText(item.introducerHead),
          phase: normalizeOptionalStepText(item.phase),
          labelDecision: normalizeOptionalStepText(item.labelDecision),
          linearizationEffect: normalizeOptionalStepText(item.linearizationEffect),
          morphologyEffect: normalizeOptionalStepText(item.morphologyEffect),
          targetLabel: typeof item.targetLabel === 'string' ? item.targetLabel : undefined,
          targetNodeId:
            typeof item.targetNodeId === 'string' && nodeIds.has(item.targetNodeId)
              ? item.targetNodeId
              : undefined,
          sourceNodeIds: Array.isArray(item.sourceNodeIds)
            ? item.sourceNodeIds
                .map((id) => String(id || '').trim())
                .filter((id) => id.length > 0 && nodeIds.has(id))
            : undefined,
          sourceLabels: Array.isArray(item.sourceLabels)
            ? item.sourceLabels
                .map((label) => String(label || '').trim())
                .filter((label) => label.length > 0)
            : undefined,
          recipe: typeof item.recipe === 'string' ? item.recipe : undefined,
          workspaceBefore: Array.isArray(item.workspaceBefore)
            ? item.workspaceBefore
                .map((label) => String(label || '').trim())
                .filter((label) => label.length > 0)
            : undefined,
          workspaceAfter: Array.isArray(item.workspaceAfter)
            ? item.workspaceAfter
                .map((label) => String(label || '').trim())
                .filter((label) => label.length > 0)
            : undefined,
          spelloutOrder: normalizeSpelloutOrder(item.spelloutOrder),
          featureChecking: normalizeFeatureChecking(item.featureChecking, nodeIds),
          note: typeof item.note === 'string' ? item.note : undefined
        };
      })
      .filter(Boolean);

    return steps.length > 0 ? steps : undefined;
  };

  const deriveImplicitGrowthChainId = (step, event, eventIndex = 0) => {
    const explicitEvent = normalizeOptionalStepText(event?.chainId);
    if (explicitEvent) return explicitEvent;
    const explicit = normalizeOptionalStepText(step?.chainId);
    if (explicit) return explicit;
    const sourceStem = normalizeMovementStemFromId(event?.fromNodeId || event?.traceNodeId);
    const targetStem = normalizeMovementStemFromId(event?.toNodeId);
    const fallbackStem = targetStem || sourceStem;
    if (fallbackStem) return `chain:${fallbackStem}`;
    return `ch${eventIndex + 1}`;
  };

  return {
    normalizeFeatureChecking,
    normalizeDerivationSteps,
    deriveImplicitGrowthChainId
  };
};
