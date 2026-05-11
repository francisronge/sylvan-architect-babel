export const createDerivationCompilerHelpers = ({
  ParseApiError,
  nextGeneratedNodeId,
  normalizeSurfaceToken,
  normalizeDerivationOperation,
  normalizeOptionalStepText,
  normalizeNodeIdArray,
  normalizeOptionalStringArray,
  normalizeSpelloutOrder,
  normalizeMovementOperation,
  normalizeIndexedText,
  normalizeSyntaxNode,
  normalizeSyntaxTreeWithIds,
  collectNodeReferencesById,
  collectOvertTerminalNodes,
  promoteSentenceMatchingLeaves,
  stripMovementIndicesFromTree,
  materializeEmptyStructuralLeaves,
  resolveNodeSurface,
  subtreeHasOvertYield,
  isTraceOrNullOnlySubtree,
  getLabelProfile,
  isTraceLikeNode,
  isNullLikeNode,
  sameTokenSequence,
  isMoveLikeOperation,
  PRIME_CATEGORY_LABEL_RE,
  PRIME_MARK_RE,
  buildNodeIndexFromTree,
  buildParentIndexFromTree,
  collectLeafNodes,
  collectExistingNodeIds,
  getNodeOvertYield,
  isTraceLikeSurface,
  isNullLikeSurface,
  resolveHeadMovementLandingNode,
  anchorOvertLeavesToSentenceTokens,
  deriveCanonicalSurfaceSpans,
  subtreeContainsOnlyCovertCategoryLeaves,
  subtreeContainsNamedCovertCategoryLeaf,
  collapseOvertHeadLandingChains,
  addNodeAliasIds
}) => {
  const parseTransportJsonValue = (value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed || !/^[\[{]/.test(trimmed)) return value;
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  };

  const normalizeTransportJsonArray = (value) =>
    Array.isArray(value)
      ? value
          .map((item) => parseTransportJsonValue(item))
          .filter((item) => typeof item !== 'undefined')
      : value;

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

  const normalizeDerivationFrameAnchors = (value, nodeIds) => {
    const parsedValue = normalizeTransportJsonArray(value);
    if (!Array.isArray(parsedValue)) return undefined;

    const anchors = parsedValue
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const role = normalizeOptionalStepText(item.role);
        const rawNodeId = String(item.nodeId || '').trim();
        const valueText = normalizeOptionalStepText(item.value);
        const text = normalizeOptionalStepText(item.text);
        const nodeId = rawNodeId && nodeIds.has(rawNodeId) ? rawNodeId : undefined;
        // Bare roles are not support. Keep an anchor only if it points to a real node
        // or carries concrete serialized content that survives normalization.
        if (!nodeId && !valueText && !text) return null;
        return {
          ...item,
          role: role || undefined,
          nodeId,
          value: valueText || undefined,
          text: text || undefined
        };
      })
      .filter(Boolean);

    return anchors.length > 0 ? anchors : undefined;
  };

  const normalizeDerivationFrameChange = (value, nodeIds) => {
    const parsedValue = parseTransportJsonValue(value);
    if (!parsedValue || typeof parsedValue !== 'object') return undefined;

    const statement = normalizeOptionalStepText(
      parsedValue.statement
      || parsedValue.summary
      || parsedValue.claim
      || parsedValue.note
    );
    const anchors = normalizeDerivationFrameAnchors(
      parsedValue.anchors
      || parsedValue.participants
      || parsedValue.supportAnchors,
      nodeIds
    );
    const continuityIds = normalizeOptionalStringArray(
      parsedValue.continuityIds
      || parsedValue.chainIds
      || parsedValue.threadIds
    );
    const explicitDetails =
      parsedValue.details && typeof parsedValue.details === 'object' && !Array.isArray(parsedValue.details)
        ? parsedValue.details
        : undefined;
    const extraDetails = Object.fromEntries(
      Object.entries(parsedValue).filter(([field, fieldValue]) => (
        !new Set([
          'statement',
          'summary',
          'claim',
          'note',
          'anchors',
          'participants',
          'supportAnchors',
          'continuityIds',
          'chainIds',
          'threadIds',
          'details'
        ]).has(field)
        && typeof fieldValue !== 'undefined'
      ))
    );
    const details = Object.keys(extraDetails).length > 0
      ? { ...(explicitDetails || {}), ...extraDetails }
      : explicitDetails;

    if (!statement && !anchors && !continuityIds && !details) return undefined;
    return {
      ...(statement ? { statement } : {}),
      ...(anchors ? { anchors } : {}),
      ...(continuityIds ? { continuityIds } : {}),
      ...(details ? { details } : {})
    };
  };

  const normalizeDerivationFrameAfter = (value) => {
    const parsedValue = parseTransportJsonValue(value);
    const after = parsedValue && typeof parsedValue === 'object' && !Array.isArray(parsedValue)
      ? parsedValue
      : {};
    const workspaceForest = normalizeWorkspaceForestInput(after.workspaceForest);
    const reusePreviousWorkspace = after.reusePreviousWorkspace === true;
    if (workspaceForest.length === 0 && !reusePreviousWorkspace) return undefined;
    return {
      ...(workspaceForest.length > 0 ? { workspaceForest } : {}),
      ...(reusePreviousWorkspace ? { reusePreviousWorkspace: true } : {})
    };
  };

  const normalizeStageRecordTextKey = (value) =>
    String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

  const isSubstantiveStageRecordText = (value) => {
    const text = normalizeOptionalStepText(value);
    if (!text || text.length < 24) return false;
    if (!/\p{L}/u.test(text)) return false;
    return text.split(/\s+/).filter(Boolean).length >= 4;
  };

  const collectStageRecordTextParts = (value, parts = [], seen = new Set()) => {
    const parsedValue = parseTransportJsonValue(value);
    if (typeof parsedValue === 'string') {
      const text = normalizeOptionalStepText(parsedValue);
      const key = normalizeStageRecordTextKey(text);
      if (isSubstantiveStageRecordText(text) && !seen.has(key)) {
        seen.add(key);
        parts.push(text);
      }
      return parts;
    }
    if (Array.isArray(parsedValue)) {
      parsedValue.forEach((item) => collectStageRecordTextParts(item, parts, seen));
      return parts;
    }
    if (parsedValue && typeof parsedValue === 'object') {
      Object.values(parsedValue).forEach((item) => collectStageRecordTextParts(item, parts, seen));
    }
    return parts;
  };

  const normalizeDerivationStageRecord = (value) => {
    const parsedValue = parseTransportJsonValue(value);
    if (typeof parsedValue !== 'string') return null;
    const text = normalizeOptionalStepText(parsedValue);
    if (!isSubstantiveStageRecordText(text)) return null;
    return {
      record: text,
      note: text
    };
  };

  const normalizeVisualRelationAnchors = (value) => {
    const parsedValue = parseTransportJsonValue(value);
    if (Array.isArray(parsedValue)) {
      const entries = parsedValue
        .map((item, index) => {
          if (Array.isArray(item)) {
            const anchorValues = item.map((entry) => normalizeOptionalStepText(entry)).filter(Boolean);
            return anchorValues.length > 0 ? [`anchor${index + 1}`, anchorValues] : null;
          }
          const anchorValue = normalizeOptionalStepText(item);
          return anchorValue ? [`anchor${index + 1}`, anchorValue] : null;
        })
        .filter(Boolean);
      return entries.length > 0 ? Object.fromEntries(entries) : undefined;
    }
    if (!parsedValue || typeof parsedValue !== 'object') return undefined;
    const entries = Object.entries(parsedValue)
      .map(([key, rawAnchor]) => {
        const anchorKey = normalizeOptionalStepText(key);
        if (Array.isArray(rawAnchor)) {
          const anchorValues = rawAnchor.map((item) => normalizeOptionalStepText(item)).filter(Boolean);
          return anchorKey && anchorValues.length > 0 ? [anchorKey, anchorValues] : null;
        }
        const anchorValue = normalizeOptionalStepText(rawAnchor);
        return anchorKey && anchorValue ? [anchorKey, anchorValue] : null;
      })
      .filter(Boolean);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  };

  const normalizeDerivationStageVisualRelations = (value, stageId, frameIndex, integrityFlags) => {
    const parsedValue = parseTransportJsonValue(value);
    if (!Array.isArray(parsedValue)) {
      integrityFlags.push(`visual_relations_missing_on_derivation_stage:${stageId}`);
      return [];
    }
    const records = parsedValue
      .map((rawRelation, relationIndex) => {
        const item = parseTransportJsonValue(rawRelation);
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          integrityFlags.push(`visual_relation_item_invalid:${stageId}:${relationIndex + 1}`);
          return null;
        }
        const relation = normalizeOptionalStepText(item.relation);
        if (!relation) {
          integrityFlags.push(`visual_relation_missing_relation:${stageId}:${relationIndex + 1}`);
        }
        const anchors = normalizeVisualRelationAnchors(item.anchors);
        if (!anchors) {
          integrityFlags.push(`visual_relation_anchors_missing:${stageId}:${relationIndex + 1}`);
        }
        if (!relation || !anchors) return null;
        return {
          relation,
          anchors,
          stepId: stageId,
          stepIndex: frameIndex
        };
      })
      .filter(Boolean);
    return records;
  };

  const getFirstVisualAnchor = (anchors, keys = []) => {
    if (!anchors || typeof anchors !== 'object' || Array.isArray(anchors)) return '';
    for (const key of keys) {
      const value = anchors[key];
      if (Array.isArray(value)) {
        const first = value.map((item) => normalizeOptionalStepText(item)).find(Boolean);
        if (first) return first;
      }
      const normalizedValue = normalizeOptionalStepText(value);
      if (normalizedValue) return normalizedValue;
    }
    return '';
  };

  const normalizeAnchorRole = (role) => String(role || '').replace(/[^a-z0-9]/gi, '').toLowerCase();

  const getFirstVisualAnchorMatchingRole = (anchors, predicate) => {
    if (!anchors || typeof anchors !== 'object' || Array.isArray(anchors)) return '';
    for (const [role, value] of Object.entries(anchors)) {
      if (!predicate(normalizeAnchorRole(role))) continue;
      if (Array.isArray(value)) {
        const first = value.map((item) => normalizeOptionalStepText(item)).find(Boolean);
        if (first) return first;
      }
      const normalizedValue = normalizeOptionalStepText(value);
      if (normalizedValue) return normalizedValue;
    }
    return '';
  };

  const buildVisualRelationEventsFromDerivationStageVisualRelations = (visualRelations, statement) => (
    Array.isArray(visualRelations)
      ? visualRelations.map((visualRelation) => {
          const anchors = visualRelation?.anchors || {};
          const headCopyNodeId = getFirstVisualAnchorMatchingRole(
            anchors,
            (role) => (role.includes('head') || role.includes('higher') || role.includes('front')) && role.includes('copy')
          );
          const tailCopyNodeId = getFirstVisualAnchorMatchingRole(
            anchors,
            (role) => (role.includes('tail') || role.includes('lower') || role.includes('source')) && role.includes('copy')
          );
          const explicitMovingNodeId = getFirstVisualAnchor(anchors, ['moving', 'moved', 'operator', 'phrase'])
            || getFirstVisualAnchorMatchingRole(
              anchors,
              (role) => (
                role.includes('movedcopy')
                || role.includes('highestcopy')
                || role.includes('frontcopy')
                || role.includes('pronouncedhighest')
              )
            );
          const sourceNodeId = getFirstVisualAnchor(anchors, ['source', 'from', 'origin', 'lower', 'lowerCopy'])
            || getFirstVisualAnchorMatchingRole(
              anchors,
              (role) => (
                role.includes('sourcecopy')
                || role.includes('lowercopy')
                || role.includes('tailcopy')
                || role.includes('basecopy')
                || role.includes('intermediatecopy')
                || role.includes('silentlower')
              )
            )
            || tailCopyNodeId;
          const landingNodeId = getFirstVisualAnchor(anchors, ['landing', 'to', 'target', 'destination', 'operator'])
            || headCopyNodeId
            || explicitMovingNodeId;
          const movingNodeId = explicitMovingNodeId
            || headCopyNodeId
            || landingNodeId;
          const traceNodeId = getFirstVisualAnchor(anchors, ['trace', 'copy', 'lowerCopy', 'gap'])
            || getFirstVisualAnchorMatchingRole(
              anchors,
              (role) => (
                role.includes('sourcecopy')
                || role.includes('lowercopy')
                || role.includes('tailcopy')
                || role.includes('basecopy')
                || role.includes('intermediatecopy')
                || role.includes('silentlower')
              )
            )
            || tailCopyNodeId
            || sourceNodeId;
          const hostNodeId = getFirstVisualAnchor(anchors, ['host', 'domain', 'container']);
          if (!movingNodeId || (!sourceNodeId && !traceNodeId) || !landingNodeId) return null;
          const fromNodeId = sourceNodeId || traceNodeId;
          const relationLabel = normalizeOptionalStepText(visualRelation.relation);
          const relationAnchors = Object.entries(anchors)
            .flatMap(([role, value]) => {
              const values = Array.isArray(value) ? value : [value];
              return values
                .map((item) => normalizeOptionalStepText(item))
                .filter(Boolean)
                .map((nodeId) => ({ role, nodeId }));
            });
          return {
            relation: relationLabel,
            anchors: relationAnchors,
            sourceNodeId,
            targetNodeId: landingNodeId,
            witnessNodeId: traceNodeId,
            renderFamily: 'trajectory',
            operation: relationLabel,
            label: relationLabel,
            movingNodeId,
            fromNodeId,
            landingNodeId,
            toNodeId: landingNodeId,
            traceNodeId,
            hostNodeId,
            stepId: visualRelation.stepId,
            stepIndex: visualRelation.stepIndex,
            note: statement,
            exactAnchorsOnly: true,
            preserveOperationLabel: true
          };
        }).filter(Boolean)
      : []
  );

  const normalizeDerivationStagesToDerivationFrames = (value, options = {}) => {
    if (!Array.isArray(value)) return [];
    const integrityFlags = Array.isArray(options?.integrityFlags) ? options.integrityFlags : [];

    return value
      .map((rawItem, frameIndex) => {
        const item = parseTransportJsonValue(rawItem);
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const stageId = normalizeOptionalStepText(item.stepId || item.frameId) || `d${frameIndex + 1}`;
        const statement = normalizeOptionalStepText(item.statement);
        if (!statement) {
          integrityFlags.push(`statement_missing_on_derivation_stage:${stageId}`);
          return null;
        }
        const stageRecord = normalizeDerivationStageRecord(item.stageRecord);
        if (!stageRecord) {
          integrityFlags.push(`stage_record_missing_or_thin:${stageId}`);
          return null;
        }
        const visualRelations = normalizeDerivationStageVisualRelations(
          item.visualRelations,
          stageId,
          frameIndex,
          integrityFlags
        );
        const after = item.after && typeof item.after === 'object' && !Array.isArray(item.after)
          ? item.after
          : {};
        const workspaceForest = typeof item.workspaceForest !== 'undefined'
          ? item.workspaceForest
          : after.workspaceForest;
        const reusePreviousWorkspace = item.reusePreviousWorkspace === true || after.reusePreviousWorkspace === true;
        if (typeof workspaceForest === 'undefined' && !reusePreviousWorkspace) {
          integrityFlags.push(`workspace_forest_missing_on_derivation_stage:${stageId}`);
          return null;
        }

        return {
          frameId: stageId,
          stepId: stageId,
          after: {
            ...(typeof workspaceForest !== 'undefined' ? { workspaceForest } : {}),
            ...(reusePreviousWorkspace ? { reusePreviousWorkspace: true } : {})
          },
          change: {
            statement,
            details: {
              note: stageRecord.note,
              stageRecord: stageRecord.record,
              derivationStageVisualRelations: visualRelations,
              derivationStageVisualRelationsContract: true
            }
          },
          visualRelationEvents: buildVisualRelationEventsFromDerivationStageVisualRelations(visualRelations, statement)
        };
      })
      .filter(Boolean);
  };

  const normalizeAnchorRoleKey = (value) =>
    String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '');

  const roleKeyMatchesAny = (roleKey, normalizedMatchers = []) =>
    normalizedMatchers.some((matcher) => roleKey === matcher);

  const findChangeAnchorNodeId = (change, roleMatchers = []) => {
    const normalizedMatchers = roleMatchers.map((matcher) => normalizeAnchorRoleKey(matcher)).filter(Boolean);
    if (normalizedMatchers.length === 0) return '';
    const anchors = Array.isArray(change?.anchors) ? change.anchors : [];
    for (const anchor of anchors) {
      const roleKey = normalizeAnchorRoleKey(anchor?.role);
      if (!roleKey) continue;
      if (roleKeyMatchesAny(roleKey, normalizedMatchers)) {
        const nodeId = String(anchor?.nodeId || '').trim();
        if (nodeId) return nodeId;
      }
    }
    return '';
  };

  const findChangeContinuityId = (change) => {
    const continuityIds = normalizeOptionalStringArray(change?.continuityIds);
    if (Array.isArray(continuityIds) && continuityIds.length > 0) {
      return continuityIds[0];
    }
    const details = change?.details && typeof change.details === 'object'
      ? change.details
      : null;
    return normalizeOptionalStepText(details?.chainId || details?.continuityId) || '';
  };

  const findChangeDetailLineageId = (change) => {
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

  const hasConcreteMovementSupport = (change, nodeById = new Map()) => {
    if (!change || typeof change !== 'object') return false;
    const sourceNodeId = findChangeAnchorNodeId(change, ['source', 'from', 'origin', 'lower', 'sourcecopy', 'lowercopy']);
    const landingNodeId = findChangeAnchorNodeId(change, ['landing', 'target', 'to', 'destination']);
    const traceNodeId = findChangeAnchorNodeId(change, ['trace', 'residue', 'lowercopy', 'copy', 'sourcecopy']);
    const targetHeadNodeId = findChangeAnchorNodeId(change, ['targethead']);
    const hostNodeId = findChangeAnchorNodeId(change, ['host', 'container']);
    const details = change?.details && typeof change.details === 'object'
      ? change.details
      : null;
    const explicitOperation = normalizeMovementOperation(
      details?.operation
      || details?.type
      || details?.kind
    );
    const statement = normalizeOptionalStepText(change.statement);
    const movementText = [
      statement,
      normalizeOptionalStepText(details?.note),
      normalizeOptionalStepText(details?.movement?.type),
      normalizeOptionalStepText(details?.headMovement?.clauseType)
    ].filter(Boolean).join(' ');
    const normalizedStatement = String(movementText || '').toLowerCase();
    const sourceLabel = String((sourceNodeId ? nodeById.get(sourceNodeId) : null)?.label || '').trim();
    const traceLabel = String((traceNodeId ? nodeById.get(traceNodeId) : null)?.label || '').trim();
    const hostLabel = String((hostNodeId ? nodeById.get(hostNodeId) : null)?.label || '').trim();
    const sourceProfile = sourceLabel ? getLabelProfile(sourceLabel) : null;
    const traceProfile = traceLabel ? getLabelProfile(traceLabel) : null;
    const hostProfile = hostLabel ? getLabelProfile(hostLabel) : null;
    const hasDirectCue = Boolean(sourceNodeId || landingNodeId || traceNodeId || targetHeadNodeId);
    const hasHostHeadCue = Boolean(
      hostNodeId
      && (
        explicitOperation === 'HeadMove'
        || /\bhead movement\b|\bmove the .* head\b|\bfrom t to c\b|\bt[- ]?to[- ]?c\b|\bto c\b/.test(normalizedStatement)
        || sourceProfile?.isHeadLikeStructural
        || traceProfile?.isHeadLikeStructural
        || hostProfile?.isHeadLikeStructural
      )
      && (sourceNodeId || traceNodeId || targetHeadNodeId)
    );
    return hasDirectCue || hasHostHeadCue;
  };

  const looksLikeSyntaxNodeObject = (value) => (
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (
      typeof value.label === 'string'
      || typeof value.word === 'string'
      || Array.isArray(value.children)
    )
  );

  const normalizeWorkspaceForestInput = (workspaceForest) => {
    const parsedWorkspaceForest = parseTransportJsonValue(workspaceForest);
    if (Array.isArray(parsedWorkspaceForest)) return parsedWorkspaceForest;
    if (parsedWorkspaceForest && typeof parsedWorkspaceForest === 'object' && looksLikeSyntaxNodeObject(parsedWorkspaceForest)) {
      return [parsedWorkspaceForest];
    }
    if (Array.isArray(workspaceForest)) return workspaceForest;
    if (!workspaceForest || typeof workspaceForest !== 'object') return [];
    if (looksLikeSyntaxNodeObject(workspaceForest)) return [workspaceForest];

    return Object.values(workspaceForest)
      .filter((entry) => entry && typeof entry === 'object');
  };

  const getFrameAfterState = (frame) =>
    frame?.after && typeof frame.after === 'object' && !Array.isArray(frame.after)
      ? frame.after
      : {};

  const getFrameWorkspaceForest = (frame) => {
    const after = getFrameAfterState(frame);
    return Array.isArray(after.workspaceForest) ? after.workspaceForest : [];
  };

  const frameReusesPreviousWorkspace = (frame) => getFrameAfterState(frame).reusePreviousWorkspace === true;

  const getFrameChange = (frame) =>
    frame?.change && typeof frame.change === 'object' && !Array.isArray(frame.change)
      ? frame.change
      : null;

  const frameHasMovementLikeChange = (frame) => {
    const change = getFrameChange(frame);
    if (!change) return false;
    const sourceNodeId = findChangeAnchorNodeId(change, ['source', 'from', 'origin', 'lower', 'sourcecopy', 'lowercopy']);
    const landingNodeId = findChangeAnchorNodeId(change, ['landing', 'target', 'to', 'destination']);
    const traceNodeId = findChangeAnchorNodeId(change, ['trace', 'residue', 'lowercopy', 'copy', 'sourcecopy']);
    const targetHeadNodeId = findChangeAnchorNodeId(change, ['targethead']);
    const continuityId = findChangeContinuityId(change);
    return Boolean(sourceNodeId || landingNodeId || traceNodeId || targetHeadNodeId || continuityId);
  };

  const cloneSyntaxNodeDeep = (node) => {
    if (!node || typeof node !== 'object') return node;
    const cloned = { ...node };
    if (Array.isArray(node.children)) {
      cloned.children = node.children.map((child) => cloneSyntaxNodeDeep(child));
    }
    return cloned;
  };

  const cloneSyntaxForestDeep = (forest) =>
    Array.isArray(forest) ? forest.map((root) => cloneSyntaxNodeDeep(root)) : [];

  const expandSameStageSubtreeRefs = (forest, integrityFlags, frameIndex) => {
    if (!Array.isArray(forest) || forest.length === 0) return forest;
    const sameStageReferences = collectNodeReferencesById(forest);
    if (sameStageReferences.size === 0) return forest;
    const expandedRefIds = new Set();

    const expandValue = (value, resolvingIds = new Set()) => {
      if (Array.isArray(value)) {
        return value.map((item) => expandValue(item, resolvingIds));
      }
      if (!value || typeof value !== 'object') return value;

      const refId = typeof value.refId === 'string'
        ? value.refId.trim()
        : (typeof value.subtreeRefId === 'string' ? value.subtreeRefId.trim() : '');
      if (refId) {
        const referencedNode = sameStageReferences.get(refId);
        if (referencedNode && !resolvingIds.has(refId)) {
          expandedRefIds.add(refId);
          const nextResolvingIds = new Set(resolvingIds);
          nextResolvingIds.add(refId);
          return expandValue(cloneSyntaxNodeDeep(referencedNode), nextResolvingIds);
        }
        return value;
      }

      const nodeId = typeof value.id === 'string' ? value.id.trim() : '';
      const nextResolvingIds = nodeId
        ? new Set([...resolvingIds, nodeId])
        : resolvingIds;
      if (!Array.isArray(value.children)) return value;
      return {
        ...value,
        children: value.children.map((child) => expandValue(child, nextResolvingIds))
      };
    };

    const expandedForest = forest.map((root) => expandValue(root, new Set()));
    expandedRefIds.forEach((refId) => {
      integrityFlags.push(`same_stage_refid_expanded:${frameIndex + 1}:${refId}`);
    });
    return expandedForest;
  };

  const findNodePathInForest = (forest, targetNodeId) => {
    const wanted = String(targetNodeId || '').trim();
    if (!wanted || !Array.isArray(forest) || forest.length === 0) return null;

    const visit = (node, path) => {
      if (!node || typeof node !== 'object') return null;
      if (String(node.id || '').trim() === wanted) return path;
      const children = Array.isArray(node.children) ? node.children : [];
      for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
        const found = visit(children[childIndex], [...path, childIndex]);
        if (found) return found;
      }
      return null;
    };

    for (let rootIndex = 0; rootIndex < forest.length; rootIndex += 1) {
      const found = visit(forest[rootIndex], [rootIndex]);
      if (found) return found;
    }
    return null;
  };

  const getNodeAtForestPath = (forest, path) => {
    if (!Array.isArray(forest) || !Array.isArray(path) || path.length === 0) return null;
    let current = forest[path[0]] || null;
    if (!current) return null;
    for (let index = 1; index < path.length; index += 1) {
      const children = Array.isArray(current.children) ? current.children : [];
      current = children[path[index]] || null;
      if (!current) return null;
    }
    return current;
  };

  const replaceNodeAtForestPath = (forest, path, replacement) => {
    if (!Array.isArray(forest) || !Array.isArray(path) || path.length === 0 || !replacement) return false;
    if (path.length === 1) {
      forest[path[0]] = replacement;
      return true;
    }
    const parent = getNodeAtForestPath(forest, path.slice(0, -1));
    const childIndex = path[path.length - 1];
    if (!parent || !Array.isArray(parent.children) || !parent.children[childIndex]) return false;
    parent.children[childIndex] = replacement;
    return true;
  };

  const findNodeByIdInForest = (forest, targetNodeId) => {
    const path = findNodePathInForest(forest, targetNodeId);
    return getNodeAtForestPath(forest, path);
  };

  const cloneSyntaxForest = (forest) => JSON.parse(JSON.stringify(Array.isArray(forest) ? forest : []));

  const collectOvertYieldTokensFromNode = (node) =>
    collectOvertTerminalNodes(node)
      .map((terminal) => resolveNodeSurface(terminal))
      .map((token) => String(token || '').trim())
      .filter(Boolean);

  const normalizeDerivationTargetLabel = (label) =>
    String(label || '').trim().replace(/[\s']/g, '').toUpperCase();

  const isBroadProjectionLikeNode = (node) => {
    if (!node || typeof node !== 'object') return false;
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) return false;
    const normalized = normalizeDerivationTargetLabel(node.label);
    return (
      normalized.endsWith('P') ||
      normalized.endsWith('BAR') ||
      normalized === 'CP' ||
      normalized === 'INFLP' ||
      normalized === 'TP' ||
      normalized === 'IP' ||
      normalized === 'VP'
    );
  };

  const findOvertNodeByIdInForest = (forest, targetNodeId) => {
    const node = findNodeByIdInForest(forest, targetNodeId);
    return node && subtreeHasOvertYield(node) ? node : null;
  };

  const collectForestNodes = (forest) => {
    const nodes = [];
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      nodes.push(node);
      const children = Array.isArray(node.children) ? node.children : [];
      children.forEach(visit);
    };
    (Array.isArray(forest) ? forest : []).forEach(visit);
    return nodes;
  };

  const getNodeLineageId = (node) =>
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

  const isPronouncedLineageWitness = (node) => (
    Boolean(node)
    && subtreeHasOvertYield(node)
    && !isTraceLikeNode(node)
    && !isNullLikeNode(node)
    && !isTraceOrNullOnlySubtree(node)
  );

  const sharedPathPrefixLength = (left = [], right = []) => {
    let length = 0;
    while (length < left.length && length < right.length && left[length] === right[length]) {
      length += 1;
    }
    return length;
  };

  const buildLineageWitnessIndexFromForest = (forest) => {
    const lineageById = new Map();
    collectForestNodes(forest).forEach((node) => {
      const nodeId = String(node?.id || '').trim();
      const lineageId = getNodeLineageId(node);
      if (!nodeId || !lineageId) return;
      const path = findNodePathInForest(forest, nodeId);
      if (!Array.isArray(path) || path.length === 0) return;
      const witness = {
        node,
        nodeId,
        lineageId,
        path,
        profile: getLabelProfile(String(node?.label || '').trim()),
        pronounced: isPronouncedLineageWitness(node)
      };
      const existing = lineageById.get(lineageId) || {
        lineageId,
        nodes: [],
        pronouncedNodes: [],
        silentNodes: []
      };
      existing.nodes.push(witness);
      if (witness.pronounced) existing.pronouncedNodes.push(witness);
      else existing.silentNodes.push(witness);
      lineageById.set(lineageId, existing);
    });
    return lineageById;
  };

  const selectPreferredLineageWitness = (
    entry,
    { operation = '', pronounced = true, referenceWitness = null } = {}
  ) => {
    const candidates = pronounced ? entry?.pronouncedNodes : entry?.silentNodes;
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const normalizedOperation = normalizeMovementOperation(operation);
    let bestCandidate = null;
    let bestScore = -Infinity;

    candidates.forEach((candidate) => {
      let score = 0;
      if (normalizedOperation === 'HeadMove') {
        if (candidate.profile?.isHeadLikeStructural) score += 80;
        if (!candidate.profile?.isPhrasal) score += 20;
      } else if (candidate.profile?.isPhrasal) {
        score += 80;
      }
      if (pronounced) {
        score += candidate.pronounced ? 40 : -40;
      } else {
        score += candidate.pronounced ? -80 : 40;
        if (
          isTraceLikeNode(candidate.node)
          || isNullLikeNode(candidate.node)
          || isTraceOrNullOnlySubtree(candidate.node)
        ) {
          score += 40;
        }
      }
      if (referenceWitness) {
        if (String(candidate.node?.label || '').trim() === String(referenceWitness.node?.label || '').trim()) {
          score += 30;
        }
        score += sharedPathPrefixLength(candidate.path, referenceWitness.path) * 12;
      }
      score -= candidate.path.length;
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    });

    return bestCandidate;
  };

  // Shared lineage ids let Babel recover copy identity from the authored tree
  // instead of depending on prose or sidecar movement payloads.
  const inferMovementPairFromLineageTransition = ({
    previousForest,
    currentForest,
    operation,
    surfaceForms = []
  }) => {
    const previousLineages = buildLineageWitnessIndexFromForest(previousForest);
    const currentLineages = buildLineageWitnessIndexFromForest(currentForest);
    if (previousLineages.size === 0 || currentLineages.size === 0) return null;

    const normalizedOperation = normalizeMovementOperation(operation);
    const normalizedSurfaceForms = Array.isArray(surfaceForms)
      ? surfaceForms.map((value) => normalizeSurfaceToken(value)).filter(Boolean)
      : [];

    let bestPair = null;
    let bestScore = -1;

    currentLineages.forEach((currentEntry, lineageId) => {
      const previousEntry = previousLineages.get(lineageId);
      if (!previousEntry) return;

      const previousPronounced = selectPreferredLineageWitness(previousEntry, {
        operation: normalizedOperation,
        pronounced: true
      });
      const currentPronounced = selectPreferredLineageWitness(currentEntry, {
        operation: normalizedOperation,
        pronounced: true,
        referenceWitness: previousPronounced
      });
      if (!previousPronounced || !currentPronounced) return;
      if (previousPronounced.nodeId === currentPronounced.nodeId) return;

      const currentTrace = selectPreferredLineageWitness(currentEntry, {
        operation: normalizedOperation,
        pronounced: false,
        referenceWitness: previousPronounced
      });
      if (!currentTrace) return;

      const previousYield = normalizeSurfaceToken(
        collectOvertYieldTokensFromNode(previousPronounced.node).join(' ')
      );
      const currentYield = normalizeSurfaceToken(
        collectOvertYieldTokensFromNode(currentPronounced.node).join(' ')
      );
      if (
        normalizedSurfaceForms.length > 0
        && previousYield
        && currentYield
        && !normalizedSurfaceForms.includes(previousYield)
        && !normalizedSurfaceForms.includes(currentYield)
      ) {
        return;
      }

      let score = 0;
      score += normalizedOperation === 'HeadMove'
        ? (
            previousPronounced.profile?.isHeadLikeStructural
            && currentPronounced.profile?.isHeadLikeStructural
            ? 140
            : 0
          )
        : (
            previousPronounced.profile?.isPhrasal
            && currentPronounced.profile?.isPhrasal
            ? 140
            : 0
          );
      score += sharedPathPrefixLength(previousPronounced.path, currentTrace.path) * 18;
      if (String(previousPronounced.node?.label || '').trim() === String(currentTrace.node?.label || '').trim()) score += 30;
      if (previousYield && currentYield && previousYield === currentYield) score += 30;
      if (
        isTraceLikeNode(currentTrace.node)
        || isNullLikeNode(currentTrace.node)
        || isTraceOrNullOnlySubtree(currentTrace.node)
      ) {
        score += 40;
      }
      if (score > bestScore) {
        bestScore = score;
        bestPair = {
          lineageId,
          landingNode: currentPronounced.node,
          sourceNode: previousPronounced.node,
          sourceTraceNode: currentTrace.node
        };
      }
    });

    return bestPair;
  };

  const hasConcreteLineageMovementSupport = (nodeById = new Map()) => {
    const lineageCounts = new Map();
    nodeById.forEach((node) => {
      const lineageId = getNodeLineageId(node);
      if (!lineageId) return;
      const existing = lineageCounts.get(lineageId) || { pronounced: 0, silent: 0 };
      if (isPronouncedLineageWitness(node)) existing.pronounced += 1;
      else existing.silent += 1;
      lineageCounts.set(lineageId, existing);
    });
    return Array.from(lineageCounts.values()).some((entry) => entry.pronounced > 0 && entry.silent > 0);
  };

  const normalizeMovementStemFromId = (value) => {
    let normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '';
    normalized = normalized
      .replace(/^(?:trace|t)(?:[_-]?\d+)?[_-]?/i, '')
      .replace(/(?:[_-](?:trace|tr|landed|landing|moved|move|copy|target|source|site|lower|upper|high|low)(?:[_-]?\d+)*)+$/gi, '');

    let previous = '';
    while (normalized && normalized !== previous) {
      previous = normalized;
      normalized = normalized.replace(/^(?:cp|cbar|c|inflp|inflbar|infl|tp|tbar|vp|vbar|v|dp|dbar|d|np|nbar|n|pp|pbar|p|ap|abar|a|advp|advbar|adv|ip|ibar|i)[_-]+/i, '');
    }

    normalized = normalized
      .replace(/(?:[_-]?(?:trace|tr|landed|landing|moved|move|copy|target|source|site|lower|upper|high|low)\d*)+$/gi, '')
      .replace(/(?:[_-]\d+)+$/g, '');

    return normalized.replace(/^[_-]+|[_-]+$/g, '');
  };

  const movementCategoryKey = (node) => {
    const label = String(node?.label || '').trim();
    const profile = getLabelProfile(label);
    if (profile.base) return profile.base;
    return String(label || '').replace(PRIME_MARK_RE, '').toLowerCase();
  };

  const isSilentLikeMovementNode = (node) =>
    Boolean(
      node
      && (
        isTraceLikeNode(node)
        || isNullLikeNode(node)
        || isTraceOrNullOnlySubtree(node)
        || !subtreeHasOvertYield(node)
      )
    );

  const isExplicitTraceReplacementNode = (node) =>
    Boolean(
      node
      && (
        isTraceLikeNode(node)
        || isNullLikeNode(node)
        || isTraceOrNullOnlySubtree(node)
      )
    );

  const categoriesCompatibleForMovement = (operation, leftNode, rightNode) => {
    if (!leftNode || !rightNode) return false;
    if (normalizeMovementOperation(operation) === 'HeadMove') {
      const leftProfile = getLabelProfile(leftNode.label);
      const rightProfile = getLabelProfile(rightNode.label);
      return leftProfile.isHeadLikeStructural && rightProfile.isHeadLikeStructural;
    }
    return movementCategoryKey(leftNode) === movementCategoryKey(rightNode);
  };

  const findTraceCandidateByStem = (currentForest, landingNode, operation = 'Move') => {
    if (!landingNode || typeof landingNode !== 'object') return null;
    const landingStem = normalizeMovementStemFromId(landingNode.id);
    const traceCandidates = collectForestNodes(currentForest).filter((node) =>
      node
      && String(node.id || '').trim()
      && (
        isTraceLikeNode(node)
        || isNullLikeNode(node)
        || isTraceOrNullOnlySubtree(node)
        || !subtreeHasOvertYield(node)
      )
    );

    let bestCandidate = null;
    let bestScore = -1;
    traceCandidates.forEach((candidate) => {
      if (!categoriesCompatibleForMovement(operation, candidate, landingNode)) return;
      const candidateStem = normalizeMovementStemFromId(candidate.id);
      let score = 0;
      if (landingStem && candidateStem && candidateStem === landingStem) score += 120;
      else if (landingStem && candidateStem && (candidateStem.includes(landingStem) || landingStem.includes(candidateStem))) score += 80;
      if (String(candidate.id || '').trim() !== String(landingNode.id || '').trim()) score += 10;
      if (isTraceOrNullOnlySubtree(candidate)) score += 15;
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    });

    return bestCandidate;
  };

  const resolveTraceCandidateByStructuralContext = (previousForest, currentForest, rawSourceId, operation) => {
    const previousSourcePath = findNodePathInForest(previousForest, rawSourceId);
    if (!Array.isArray(previousSourcePath) || previousSourcePath.length === 0) return null;

    const previousSourceNode = getNodeAtForestPath(previousForest, previousSourcePath);
    if (!previousSourceNode) return null;

    const previousParentPath = previousSourcePath.slice(0, -1);
    const previousParentNode = getNodeAtForestPath(previousForest, previousParentPath);
    const previousGrandParentNode = getNodeAtForestPath(previousForest, previousParentPath.slice(0, -1));
    const previousChildIndex = previousSourcePath[previousSourcePath.length - 1];
    const previousSiblingLabels = Array.isArray(previousParentNode?.children)
      ? previousParentNode.children.map((child) => String(child?.label || '').trim())
      : [];
    const rawSourceStem = normalizeMovementStemFromId(rawSourceId);

    let bestCandidate = null;
    let bestScore = -1;

    collectForestNodes(currentForest).forEach((candidate) => {
      if (!isSilentLikeMovementNode(candidate)) return;
      const candidateStem = normalizeMovementStemFromId(candidate.id);
      const candidateIsExplicitTraceLike = isExplicitTraceReplacementNode(candidate);
      const traceProxyMatch = (
        normalizeMovementOperation(operation) !== 'HeadMove'
        && candidateIsExplicitTraceLike
        && rawSourceStem
        && candidateStem
        && (
          candidateStem === rawSourceStem
          || candidateStem.includes(rawSourceStem)
          || rawSourceStem.includes(candidateStem)
        )
      );
      const categoryMatch = categoriesCompatibleForMovement(operation, previousSourceNode, candidate);
      const structuralTraceReplacement = (
        normalizeMovementOperation(operation) !== 'HeadMove'
        && candidateIsExplicitTraceLike
      );
      if (!categoryMatch && !traceProxyMatch && !structuralTraceReplacement) return;

      const candidatePath = findNodePathInForest(currentForest, String(candidate?.id || '').trim());
      if (!Array.isArray(candidatePath) || candidatePath.length === 0) return;

      const candidateParentPath = candidatePath.slice(0, -1);
      const candidateParentNode = getNodeAtForestPath(currentForest, candidateParentPath);
      const candidateGrandParentNode = getNodeAtForestPath(currentForest, candidateParentPath.slice(0, -1));
      const candidateChildIndex = candidatePath[candidatePath.length - 1];
      const candidateSiblingLabels = Array.isArray(candidateParentNode?.children)
        ? candidateParentNode.children.map((child) => String(child?.label || '').trim())
        : [];

      let score = 0;
      if (String(candidateParentNode?.label || '').trim() === String(previousParentNode?.label || '').trim()) score += 140;
      if (String(candidateGrandParentNode?.label || '').trim() === String(previousGrandParentNode?.label || '').trim()) score += 80;
      if (Number.isInteger(previousChildIndex) && candidateChildIndex === previousChildIndex) score += 60;
      if (
        previousSiblingLabels.length > 0
        && candidateSiblingLabels.length > 0
        && previousSiblingLabels.join('|') === candidateSiblingLabels.join('|')
      ) {
        score += 45;
      }
      if (categoryMatch) score += 40;
      if (rawSourceStem && candidateStem && candidateStem === rawSourceStem) score += 30;
      else if (rawSourceStem && candidateStem && (candidateStem.includes(rawSourceStem) || rawSourceStem.includes(candidateStem))) score += 15;
      if (traceProxyMatch) score += 35;
      if (candidateIsExplicitTraceLike) score += 30;

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    });

    return bestScore >= 100 ? bestCandidate : null;
  };

  const inferMovementPairFromStateTransition = ({ previousForest, currentForest, operation, rawTargetId, surfaceForms = [] }) => {
    const normalizedOperation = normalizeMovementOperation(operation);
    const lineagePair = inferMovementPairFromLineageTransition({
      previousForest,
      currentForest,
      operation: normalizedOperation,
      surfaceForms
    });
    if (lineagePair) {
      return {
        landingNode: lineagePair.landingNode,
        sourceNode: lineagePair.sourceNode,
        sourceTraceNode: lineagePair.sourceTraceNode,
        lineageId: lineagePair.lineageId
      };
    }
    const previousOvertNodes = collectForestNodes(previousForest).filter((node) => {
      if (!subtreeHasOvertYield(node)) return false;
      if (normalizedOperation === 'HeadMove') return true;
      return getLabelProfile(node?.label).isPhrasal;
    });
    const currentOvertNodes = collectForestNodes(currentForest).filter((node) => {
      if (!subtreeHasOvertYield(node)) return false;
      if (normalizedOperation === 'HeadMove') return true;
      return getLabelProfile(node?.label).isPhrasal;
    });
    const rawTargetStem = normalizeMovementStemFromId(rawTargetId);
    const normalizedSurfaceForms = Array.isArray(surfaceForms)
      ? surfaceForms.map((value) => normalizeSurfaceToken(value)).filter(Boolean)
      : [];

    let bestPair = null;
    let bestScore = -1;

    previousOvertNodes.forEach((previousNode) => {
      const previousYield = collectOvertYieldTokensFromNode(previousNode);
      const previousStem = normalizeMovementStemFromId(previousNode.id);
      const previousYieldText = normalizeSurfaceToken(previousYield.join(' '));
      if (normalizedOperation !== 'HeadMove' && previousYield.length === 0) return;
      if (normalizedSurfaceForms.length > 0 && previousYieldText && !normalizedSurfaceForms.includes(previousYieldText)) return;

      const landingCandidates = currentOvertNodes.filter((candidate) => {
        if (!categoriesCompatibleForMovement(operation, previousNode, candidate)) return false;
        if (normalizedOperation === 'HeadMove') {
          if (previousYield.length === 0) return true;
          const candidateYield = collectOvertYieldTokensFromNode(candidate);
          const candidateYieldText = normalizeSurfaceToken(candidateYield.join(' '));
          if (normalizedSurfaceForms.length > 0 && candidateYieldText && !normalizedSurfaceForms.includes(candidateYieldText)) return false;
          return sameTokenSequence(candidateYield, previousYield);
        }
        const candidateYield = collectOvertYieldTokensFromNode(candidate);
        const candidateYieldText = normalizeSurfaceToken(candidateYield.join(' '));
        if (normalizedSurfaceForms.length > 0 && candidateYieldText && !normalizedSurfaceForms.includes(candidateYieldText)) return false;
        return sameTokenSequence(candidateYield, previousYield);
      });

      landingCandidates.forEach((landingNode) => {
        const sourceTraceNode = findTraceCandidateByStem(currentForest, landingNode, operation);
        if (!sourceTraceNode) return;
        const landingStem = normalizeMovementStemFromId(landingNode.id);
        const sourceStem = normalizeMovementStemFromId(sourceTraceNode.id);
        let score = 0;
        if (rawTargetStem && landingStem === rawTargetStem) score += 100;
        if (previousStem && landingStem && landingStem === previousStem) score += 60;
        if (previousStem && sourceStem && sourceStem === previousStem) score += 60;
        if (previousStem && landingStem && (landingStem.includes(previousStem) || previousStem.includes(landingStem))) score += 25;
        if (previousStem && sourceStem && (sourceStem.includes(previousStem) || previousStem.includes(sourceStem))) score += 25;
        if (String(landingNode.id || '').trim() !== String(previousNode.id || '').trim()) score += 10;
        if (score > bestScore) {
          bestScore = score;
          bestPair = { landingNode, sourceTraceNode };
        }
      });
    });

    return bestPair;
  };

  const materializeImplicitPhrasalTraceShellsInDerivationFrames = (derivationFrames) => {
    if (!Array.isArray(derivationFrames) || derivationFrames.length === 0) return [];

    const normalizedFrames = [];
    const headTraceSourceIds = new Set();

    const canonicalizeHeadTraceSourceInForest = (forest, sourceNodeId) => {
      const normalizedId = String(sourceNodeId || '').trim();
      if (!normalizedId) return;
      const sourceNode = findNodeByIdInForest(forest, normalizedId);
      if (!sourceNode || typeof sourceNode !== 'object') return;

      const profile = getLabelProfile(sourceNode.label);
      const children = Array.isArray(sourceNode.children) ? sourceNode.children : [];
      if (!profile.isHeadLikeStructural || children.length !== 1) return;

      const child = children[0];
      const grandChildren = Array.isArray(child?.children) ? child.children : [];
      if (isNullLikeNode(child) && grandChildren.length === 0) {
        child.label = 't';
        child.word = 't';
        return;
      }
      if (grandChildren.length === 1 && isNullLikeNode(grandChildren[0])) {
        grandChildren[0].label = 't';
        grandChildren[0].word = 't';
      }
    };

    derivationFrames.forEach((frame) => {
      const nextWorkspaceForest = cloneSyntaxForestDeep(getFrameWorkspaceForest(frame));
      const change = getFrameChange(frame);
      const nodeById = new Map();
      nextWorkspaceForest.forEach((root) => {
        collectNodeReferencesById(root).forEach((node, nodeId) => {
          if (typeof nodeId === 'string' && nodeId.trim()) {
            nodeById.set(nodeId, node);
          }
        });
      });
      const operation = inferMovementOperationFromChange(change, nodeById);
      const nextFrame = {
        ...frame,
        after: {
          ...getFrameAfterState(frame),
          workspaceForest: nextWorkspaceForest
        }
      };
      const headMoveSourceId = operation === 'HeadMove'
        ? findChangeAnchorNodeId(change, ['source', 'from', 'origin', 'lower', 'sourcecopy', 'lowercopy'])
        : '';

      if (headMoveSourceId) {
        headTraceSourceIds.add(headMoveSourceId);
      }
      headTraceSourceIds.forEach((sourceNodeId) => {
        canonicalizeHeadTraceSourceInForest(nextWorkspaceForest, sourceNodeId);
      });

      if (isMoveLikeOperation(operation) && operation !== 'HeadMove') {
        const traceId = findChangeAnchorNodeId(change, ['trace', 'residue', 'lowercopy', 'copy', 'sourcecopy'])
          || findChangeAnchorNodeId(change, ['source', 'from', 'origin', 'lower', 'sourcecopy', 'lowercopy']);
        const landingId = findChangeAnchorNodeId(change, ['landing', 'target', 'to', 'destination']);
        const traceNode = traceId ? findNodeByIdInForest(nextWorkspaceForest, traceId) : null;
        const landingNode = landingId ? findNodeByIdInForest(nextWorkspaceForest, landingId) : null;
        const landingLabel = String(landingNode?.label || '').trim();
        const landingProfile = getLabelProfile(landingLabel);

        if (
          traceNode
          && landingNode
          && landingProfile.isPhrasal
          && (!Array.isArray(traceNode.children) || traceNode.children.length === 0)
          && (isTraceLikeNode(traceNode) || isNullLikeNode(traceNode) || isTraceOrNullOnlySubtree(traceNode))
        ) {
          const tracePath = findNodePathInForest(nextWorkspaceForest, traceId);
          const traceParent = getNodeAtForestPath(nextWorkspaceForest, Array.isArray(tracePath) ? tracePath.slice(0, -1) : null);
          const parentLabel = String(traceParent?.label || '').trim();

          if (parentLabel !== landingLabel) {
            replaceNodeAtForestPath(nextWorkspaceForest, tracePath, {
              id: `${traceId}__shell`,
              label: landingLabel,
              children: [traceNode]
            });
          }
        }
      }

      normalizedFrames.push(nextFrame);
    });

    return normalizedFrames;
  };

  const deriveCommittedTraceShellLabel = ({ operation, traceNode, targetNode, traceParent }) => {
    const normalizedOperation = normalizeMovementOperation(operation);
    const targetLabel = String(targetNode?.label || '').trim();
    const targetProfile = getLabelProfile(targetLabel);

    if (normalizedOperation !== 'HeadMove' && targetProfile.isPhrasal) {
      return targetLabel;
    }

    if (normalizedOperation === 'HeadMove') {
      const parentLabel = String(traceParent?.label || '').trim();
      const parentProfile = getLabelProfile(parentLabel);
      if (PRIME_CATEGORY_LABEL_RE.test(parentLabel)) {
        const stripped = parentLabel.replace(PRIME_MARK_RE, '').trim();
        const strippedProfile = getLabelProfile(stripped);
        if (strippedProfile.isHeadLikeStructural) return stripped;
      }
      if (parentProfile.isHeadLikeStructural) return parentLabel;
    }

    const traceLabel = String(traceNode?.label || '').trim();
    return traceLabel;
  };

  const materializeCommittedTraceShells = (tree, visualRelationEvents) => {
    if (!tree || typeof tree !== 'object' || !Array.isArray(visualRelationEvents) || visualRelationEvents.length === 0) {
      return tree;
    }

    const buildCommittedTraceLeafNode = (traceNode, traceId) => {
      const rawWord = String(traceNode?.word || '').trim();
      const rawLabel = String(traceNode?.label || '').trim();
      const leafSurface = rawWord
        || ((isTraceLikeNode(traceNode) || isNullLikeNode(traceNode)) ? rawLabel : '')
        || (isNullLikeNode(traceNode) ? '∅' : 't');
      return {
        id: traceId,
        label: leafSurface,
        word: leafSurface
      };
    };

    const forest = [tree];
    visualRelationEvents.forEach((event) => {
      const traceId = String(event?.traceNodeId || event?.fromNodeId || '').trim();
      const targetId = String(event?.landingNodeId || event?.toNodeId || '').trim();
      if (!traceId || !targetId) return;

      const tracePath = findNodePathInForest(forest, traceId);
      const traceNode = getNodeAtForestPath(forest, tracePath);
      const targetNode = findNodeByIdInForest(forest, targetId);
      const traceParent = getNodeAtForestPath(forest, Array.isArray(tracePath) ? tracePath.slice(0, -1) : null);
      if (!traceNode || !targetNode) return;

      const traceChildren = Array.isArray(traceNode.children) ? traceNode.children : [];
      if (traceChildren.length > 0) return;
      if (!isTraceLikeNode(traceNode) && !isNullLikeNode(traceNode) && !isTraceOrNullOnlySubtree(traceNode)) return;

      const shellLabel = deriveCommittedTraceShellLabel({
        operation: event?.operation,
        traceNode,
        targetNode,
        traceParent
      });
      if (!shellLabel) return;
      if (String(traceParent?.label || '').trim() === shellLabel) return;

      replaceNodeAtForestPath(forest, tracePath, {
        id: `${traceId}__shell`,
        label: shellLabel,
        children: [buildCommittedTraceLeafNode(traceNode, traceId)]
      });
    });

    return forest[0];
  };

  const normalizeHeadTraceSurfaceStem = (value) => {
    const raw = normalizeIndexedText(value)
      .toLowerCase()
      .trim()
      .replace(/^<|>$/g, '')
      .replace(/^⟨|⟩$/g, '');
    if (!raw) return '';
    return raw
      .replace(/^(?:trace|t)[_-]?/i, '')
      .replace(/^(?:c|infl|i|t|v|aux)[_-]+/i, '')
      .replace(/[^a-z0-9]+/g, '');
  };

  const collectHeadLikeNodesInSubtree = (node, entries, domainDistance = 0) => {
    if (!node || typeof node !== 'object') return;
    const profile = getLabelProfile(node.label);
    if (profile.isHeadLikeStructural) {
      entries.push({ node, domainDistance });
    }
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach((child) => collectHeadLikeNodesInSubtree(child, entries, domainDistance));
  };

  const collectComplementDomainHeadCandidates = (landingNode, nodeById, parentById) => {
    const landingId = String(landingNode?.id || '').trim();
    if (!landingId) return [];

    const candidates = [];
    let currentId = landingId;
    let domainDistance = 0;

    while (currentId) {
      const parentId = String(parentById.get(currentId) || '').trim();
      if (!parentId) break;
      const parent = nodeById.get(parentId) || null;
      if (!parent) break;
      const siblings = Array.isArray(parent.children)
        ? parent.children.filter((child) => String(child?.id || '').trim() !== currentId)
        : [];
      siblings.forEach((sibling) => collectHeadLikeNodesInSubtree(sibling, candidates, domainDistance));
      currentId = parentId;
      domainDistance += 1;
    }

    const seen = new Set();
    return candidates.filter((entry) => {
      const candidateId = String(entry?.node?.id || '').trim();
      if (!candidateId || seen.has(candidateId)) return false;
      seen.add(candidateId);
      return true;
    });
  };

  const preferredHeadMoveSourceBases = (landingNode) => {
    const base = getLabelProfile(landingNode?.label).base;
    if (base === 'c' || base === 'q' || base === 'wh') return ['infl', 'i', 't', 'aux', 'v'];
    if (base === 'infl' || base === 'i' || base === 't') return ['v', 'aux'];
    if (base === 'aux') return ['v'];
    return [];
  };

  const isSupplementalHeadMoveLandingBase = (base) =>
    ['c', 'q', 'wh', 'top', 'focus', 'neg'].includes(String(base || '').trim());

  const pickTraceLikeLeaf = (node) =>
    collectLeafNodes(node).find((leaf) => isTraceLikeNode(leaf) || isNullLikeNode(leaf)) || null;

  const canonicalizeHeadMoveSourceNode = (node) => {
    if (!node || typeof node !== 'object') return null;

    const profile = getLabelProfile(node.label);
    if (!profile.isHeadLikeStructural) {
      if (isNullLikeNode(node)) {
        node.label = 't';
        node.word = 't';
      }
      return node;
    }

    const traceLeaf = pickTraceLikeLeaf(node);
    if (traceLeaf && isNullLikeNode(traceLeaf)) {
      traceLeaf.label = 't';
      traceLeaf.word = 't';
    }
    return node;
  };

  const hasEarlierOvertHeadSourceEvidence = (derivationFrames, landingNode) => {
    if (!Array.isArray(derivationFrames) || derivationFrames.length === 0 || !landingNode) return false;
    const preferredBases = preferredHeadMoveSourceBases(landingNode);
    if (preferredBases.length === 0) return false;
    const landingSurfaceStem = normalizeHeadTraceSurfaceStem(getNodeOvertYield(landingNode));
    if (!landingSurfaceStem) return false;

    for (const frame of derivationFrames) {
      const forest = getFrameWorkspaceForest(frame);
      const stack = [...forest];
      while (stack.length > 0) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') continue;
        const profile = getLabelProfile(node?.label);
        const surfaceStem = normalizeHeadTraceSurfaceStem(getNodeOvertYield(node));
        if (
          profile.isHeadLikeStructural
          && preferredBases.includes(profile.base)
          && subtreeHasOvertYield(node)
          && surfaceStem
          && surfaceStem === landingSurfaceStem
        ) {
          return true;
        }
        const children = Array.isArray(node.children) ? node.children : [];
        for (let index = children.length - 1; index >= 0; index -= 1) {
          stack.push(children[index]);
        }
      }
    }
    return false;
  };

  const findTraceReplacementForLandingCopy = (previousForest, currentForest, landingNode) => {
    if (!landingNode || typeof landingNode !== 'object') return null;
    const landingYield = collectOvertYieldTokensFromNode(landingNode);
    if (landingYield.length === 0) return null;

    let bestMatch = null;
    let bestScore = -1;

    const visit = (node, path = []) => {
      if (!node || typeof node !== 'object') return;
      const currentYield = collectOvertYieldTokensFromNode(node);
      if (sameTokenSequence(currentYield, landingYield)) {
        const replacement = getNodeAtForestPath(currentForest, path);
        const looksLikeTrace = replacement
          && (
            isTraceLikeNode(replacement)
            || isNullLikeNode(replacement)
            || isTraceOrNullOnlySubtree(replacement)
            || !subtreeHasOvertYield(replacement)
          );
        if (looksLikeTrace) {
          const sameLabel = String(node.label || '').trim() === String(landingNode.label || '').trim();
          const score = (sameLabel ? 10 : 0) + path.length;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = replacement;
          }
        }
      }

      const children = Array.isArray(node.children) ? node.children : [];
      children.forEach((child, childIndex) => visit(child, [...path, childIndex]));
    };

    (Array.isArray(previousForest) ? previousForest : []).forEach((root, rootIndex) => visit(root, [rootIndex]));
    return bestMatch;
  };

  const collectCollapsedNodeIds = (node) => {
    const ids = [];
    const visit = (current) => {
      if (!current || typeof current !== 'object') return;
      const id = normalizeOptionalStepText(current.id);
      if (id) ids.push(id);
      const children = Array.isArray(current.children) ? current.children : [];
      children.forEach(visit);
    };
    visit(node);
    return ids;
  };

  const collapseMalformedHeadMoveLandings = (node) => {
    if (!node || typeof node !== 'object') return node;
    const children = Array.isArray(node.children) ? node.children : [];
    node.children = children.map((child) => collapseMalformedHeadMoveLandings(child));

    const currentChildren = Array.isArray(node.children) ? node.children : [];
    const profile = getLabelProfile(node.label);
    if (!profile.isHeadLikeStructural) return node;
    if (String(node.word || '').trim()) return node;
    if (currentChildren.length !== 2) return node;

    const overtChild = currentChildren.find((child) => subtreeHasOvertYield(child));
    const silentChild = currentChildren.find((child) => child !== overtChild && !subtreeHasOvertYield(child));
    if (!overtChild || !silentChild) return node;

    const overtProfile = getLabelProfile(overtChild.label);
    const silentProfile = getLabelProfile(silentChild.label);
    if (!overtProfile.isHeadLikeStructural || !silentProfile.isHeadLikeStructural) return node;

    const overtYield = collectOvertYieldTokensFromNode(overtChild);
    if (overtYield.length !== 1) return node;
    const overtSurface = String(overtYield[0] || '').trim();
    if (!overtSurface) return node;

    addNodeAliasIds(node, collectCollapsedNodeIds(overtChild));
    node.word = overtSurface;
    delete node.children;
    delete node.surfaceSpan;
    return node;
  };

  const canonicalizeDerivationWorkspaceForest = (forest) => {
    const clonedForest = cloneSyntaxForestDeep(forest);
    clonedForest.forEach((root) => {
      collapseMalformedHeadMoveLandings(root);
      collapseOvertHeadLandingChains(root);
    });
    return clonedForest;
  };

  const addTraceReplacementAliasesFromPreviousWorkspace = (previousForest, currentForest) => {
    if (!Array.isArray(previousForest) || previousForest.length === 0 || !Array.isArray(currentForest) || currentForest.length === 0) {
      return;
    }
    const previousNodeById = new Map();
    previousForest.forEach((root) => {
      collectNodeReferencesById(root).forEach((node, nodeId) => {
        if (typeof nodeId === 'string' && nodeId.trim() && !previousNodeById.has(nodeId)) {
          previousNodeById.set(nodeId, node);
        }
      });
    });
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      const nodeId = normalizeOptionalStepText(node.id);
      const traceMatch = nodeId.match(/^(.+)_trace$/i);
      const previousNode = traceMatch?.[1] ? previousNodeById.get(traceMatch[1]) : null;
      if (previousNode) {
        addNodeAliasIds(node, [
          traceMatch[1],
          ...(Array.isArray(previousNode.aliasIds) ? previousNode.aliasIds : [])
        ]);
      }
      const children = Array.isArray(node.children) ? node.children : [];
      children.forEach(visit);
    };
    currentForest.forEach(visit);
  };

  const canonicalizeDerivationFrames = (frames) => {
    if (!Array.isArray(frames) || frames.length === 0) return [];
    let previousWorkspaceForest = [];
    return frames.map((frame) => {
      const workspaceForest = canonicalizeDerivationWorkspaceForest(getFrameWorkspaceForest(frame));
      addTraceReplacementAliasesFromPreviousWorkspace(previousWorkspaceForest, workspaceForest);
      previousWorkspaceForest = cloneSyntaxForestDeep(workspaceForest);
      return {
        ...frame,
        after: {
          ...getFrameAfterState(frame),
          workspaceForest
        }
      };
    });
  };

  const inferMovementOperationFromChange = (change, nodeById = new Map()) => {
    if (!change || typeof change !== 'object') return '';
    const sourceNodeId = findChangeAnchorNodeId(change, ['source', 'from', 'origin', 'lower', 'sourcecopy', 'lowercopy']);
    const landingNodeId = findChangeAnchorNodeId(change, ['landing', 'target', 'to', 'destination']);
    const traceNodeId = findChangeAnchorNodeId(change, ['trace', 'residue', 'lowercopy', 'copy', 'sourcecopy']);
    const targetHeadNodeId = findChangeAnchorNodeId(change, ['targethead']);
    const hostNodeId = findChangeAnchorNodeId(change, ['host', 'container']);
    const targetProjectionNodeId = findChangeAnchorNodeId(change, ['targetprojection', 'edge']);
    const sourceNode = sourceNodeId ? (nodeById.get(sourceNodeId) || null) : null;
    const landingNode = landingNodeId ? (nodeById.get(landingNodeId) || null) : null;
    const targetHeadNode = targetHeadNodeId ? (nodeById.get(targetHeadNodeId) || null) : null;
    const traceNode = traceNodeId ? (nodeById.get(traceNodeId) || null) : null;
    const hostNode = hostNodeId ? (nodeById.get(hostNodeId) || null) : null;
    const sourceLabel = String(sourceNode?.label || '').trim();
    const landingLabel = String(landingNode?.label || '').trim();
    const targetHeadLabel = String(targetHeadNode?.label || '').trim();
    const traceLabel = String(traceNode?.label || '').trim();
    const hostLabel = String(hostNode?.label || '').trim();
    const sourceProfile = sourceLabel ? getLabelProfile(sourceLabel) : null;
    const landingProfile = landingLabel ? getLabelProfile(landingLabel) : null;
    const targetHeadProfile = targetHeadLabel ? getLabelProfile(targetHeadLabel) : null;
    const traceProfile = traceLabel ? getLabelProfile(traceLabel) : null;
    const hostProfile = hostLabel ? getLabelProfile(hostLabel) : null;
    const details = change?.details && typeof change.details === 'object'
      ? change.details
      : null;
    const explicitOperation = normalizeMovementOperation(
      details?.operation
      || details?.type
      || details?.kind
    );
    const statementText = normalizeOptionalStepText(change.statement);
    const movementText = [
      statementText,
      normalizeOptionalStepText(details?.note),
      normalizeOptionalStepText(details?.movement?.type),
      normalizeOptionalStepText(details?.headMovement?.clauseType)
    ].filter(Boolean).join(' ');
    const normalizedStatement = String(statementText || '').toLowerCase();
    const normalizedMovementText = String(movementText || '').toLowerCase();
    const hasDirectMovementCue = hasConcreteMovementSupport(change, nodeById);
    const hasLineageMovementCue = hasConcreteLineageMovementSupport(nodeById);
    const movementTextMentionsMovement = /(?:move|raise|lowering|front|displac|extract|shift|scrambl|roll[- ]?up|remerge|internal merge|copy|copied|copies|escape)/i.test(normalizedMovementText);
    const hasSerializedMovementCue = hasDirectMovementCue
      || (
        hasLineageMovementCue
        && Boolean(explicitOperation || movementTextMentionsMovement)
      );
    if (!hasSerializedMovementCue) {
      return '';
    }
    if (explicitOperation) return explicitOperation;

    if (
      targetHeadNodeId
      || targetHeadProfile?.isHeadLikeStructural
      || hostProfile?.isHeadLikeStructural
      || sourceProfile?.isHeadLikeStructural
      || landingProfile?.isHeadLikeStructural
      || traceProfile?.isHeadLikeStructural
      || /\bhead movement\b|\bmove the .* head\b|\bfrom t to c\b|\bt[- ]?to[- ]?c\b|\bto c\b/.test(normalizedMovementText)
    ) {
      return 'HeadMove';
    }
    if (
      /(?:wh|a[- ]?bar|topicaliz|focus|front)/i.test(normalizedMovementText)
      || String(targetProjectionNodeId || '').trim().toLowerCase().includes('cp')
      || String(hostNodeId || '').trim().toLowerCase().includes('cp')
    ) {
      return 'AbarMove';
    }
    return 'A-Move';
  };

  const inferMovementOperationsFromChange = (change, nodeById = new Map()) => {
    const operation = inferMovementOperationFromChange(change, nodeById);
    return operation ? [operation] : [];
  };

  const buildParentIndexFromForest = (forest) => {
    const parentById = new Map();
    (Array.isArray(forest) ? forest : []).forEach((root) => {
      const rootParentById = buildParentIndexFromTree(root);
      rootParentById.forEach((parentId, nodeId) => {
        if (typeof nodeId === 'string' && nodeId.trim()) {
          parentById.set(nodeId, parentId);
        }
      });
    });
    return parentById;
  };

  const extractQuotedMovementSurfaceForms = (change) => {
    const statement = normalizeOptionalStepText(change?.statement);
    if (!statement) return [];
    const matches = Array.from(statement.matchAll(/["']([^"']+)["']/g));
    return matches
      .map((match) => normalizeSurfaceToken(match?.[1]))
      .filter(Boolean);
  };

  const findHeadMoveHostNodeIdFromSurfaceCue = ({ change, forest, nodeById, parentById }) => {
    const quotedSurfaceForms = extractQuotedMovementSurfaceForms(change);
    if (quotedSurfaceForms.length === 0) return undefined;

    const matchingLandingIds = new Set();
    (Array.isArray(forest) ? forest : []).forEach((root) => {
      collectLeafNodes(root).forEach((leaf) => {
        const surface = normalizeSurfaceToken(resolveNodeSurface(leaf) || leaf.word || leaf.label);
        if (!surface || !quotedSurfaceForms.includes(surface)) return;
        const landingNode = resolveHeadMovementLandingNode(leaf, nodeById, parentById) || null;
        const landingNodeId = String(landingNode?.id || '').trim();
        if (landingNodeId) matchingLandingIds.add(landingNodeId);
      });
    });

    return matchingLandingIds.size === 1
      ? Array.from(matchingLandingIds)[0]
      : undefined;
  };

  const inferFrameOperation = ({ change, currentForest, previousForest, nodeById }) => {
    const movementOperations = inferMovementOperationsFromChange(change, nodeById);
    if (movementOperations.length > 1) return 'Move';
    if (movementOperations.length === 1) return movementOperations[0];
    const currentIds = new Set();
    const previousIds = new Set();
    collectForestNodes(currentForest).forEach((node) => {
      const id = String(node?.id || '').trim();
      if (id) currentIds.add(id);
    });
    collectForestNodes(previousForest).forEach((node) => {
      const id = String(node?.id || '').trim();
      if (id) previousIds.add(id);
    });
    const newNodeCount = Array.from(currentIds).filter((id) => !previousIds.has(id)).length;
    if (newNodeCount > 0) return 'Checkpoint';
    return 'StateChange';
  };

  const mergeMovementDiagnostics = (...collections) => {
    const seen = new Set();
    const merged = [];
    collections.flat().forEach((value) => {
      const text = normalizeOptionalStepText(value);
      if (!text) return;
      const parts = text
        .split(/,(?=[A-Z"])/g)
        .map((part) => normalizeOptionalStepText(part))
        .filter(Boolean);
      (parts.length > 0 ? parts : [text]).forEach((part) => {
        if (seen.has(part)) return;
        seen.add(part);
        merged.push(part);
      });
    });
    return merged.length > 0 ? merged : undefined;
  };

  const normalizeDerivationFrames = (value, framework = 'xbar', sentenceTokens = [], options = {}) => {
    if (!Array.isArray(value)) return [];
    let previousWorkspaceForest = null;
    const persistentSubtreeReferences = new Map();
    const protectedMovementSubtreeIds = new Set();
    const integrityFlags = Array.isArray(options?.integrityFlags) ? options.integrityFlags : [];
    const sentenceTokenSet = Array.isArray(sentenceTokens) && sentenceTokens.length > 0
      ? new Set(sentenceTokens.map((token) => normalizeSurfaceToken(token)).filter(Boolean))
      : null;

    const normalizedFrames = value
      .map((rawItem, frameIndex) => {
        const item = parseTransportJsonValue(rawItem);
        if (!item || typeof item !== 'object') return null;
        const normalizedAfter = normalizeDerivationFrameAfter(item.after);
        if (!normalizedAfter) return null;
        const reusePreviousWorkspace = normalizedAfter.reusePreviousWorkspace === true;
        const workspaceForestValue = expandSameStageSubtreeRefs(
          normalizeWorkspaceForestInput(normalizedAfter.workspaceForest),
          integrityFlags,
          frameIndex
        );
        const previousFrameNodeReferences = new Map(persistentSubtreeReferences);
        if (Array.isArray(previousWorkspaceForest) && previousWorkspaceForest.length > 0) {
          previousWorkspaceForest.forEach((root) => {
            collectNodeReferencesById(root).forEach((node, nodeId) => {
              if (typeof nodeId === 'string' && nodeId.trim()) {
                previousFrameNodeReferences.set(nodeId, node);
              }
            });
          });
        }

        const frameNodeIds = new Set();
        const counterRef = { value: 1 };
        let workspaceForest = [];
        if (workspaceForestValue.length > 0) {
          workspaceForest = workspaceForestValue
            .map((root, rootIndex) => normalizeSyntaxNode(root, frameNodeIds, counterRef, {
              nodeReferences: new Map(),
              subtreeReferences: previousFrameNodeReferences,
              resolvingIds: new Set(),
              framework,
              sentenceTokens,
              path: `frame[${frameIndex}].after.workspaceForest[${rootIndex}]`
            }))
            .filter(Boolean);
        } else if (reusePreviousWorkspace && Array.isArray(previousWorkspaceForest) && previousWorkspaceForest.length > 0) {
          workspaceForest = previousWorkspaceForest.map((root) => cloneSyntaxNodeDeep(root));
        }
        if (workspaceForest.length === 0) return null;
        const rawChange = parseTransportJsonValue(item.change);
        const rawSourceId = findChangeAnchorNodeId(rawChange, ['source', 'from', 'origin', 'lower', 'sourcecopy', 'lowercopy']);
        const rawMovementOperation = inferMovementOperationFromChange(rawChange);
        if (rawMovementOperation && rawMovementOperation !== 'HeadMove' && rawSourceId) {
          protectedMovementSubtreeIds.add(rawSourceId);
        }
        workspaceForest.forEach((root) => {
          promoteSentenceMatchingLeaves(root, sentenceTokenSet);
          stripMovementIndicesFromTree(root);
          materializeEmptyStructuralLeaves(root, sentenceTokenSet, {
            protectedSubtreeIds: protectedMovementSubtreeIds
          });
        });
        const normalizedFrameNodeIds = new Set();
        const currentNodeById = new Map();
        workspaceForest.forEach((root) => {
          collectNodeReferencesById(root).forEach((node, nodeId) => {
            if (typeof nodeId === 'string' && nodeId.trim()) {
              normalizedFrameNodeIds.add(nodeId);
              currentNodeById.set(nodeId, node);
            }
          });
        });
        currentNodeById.forEach((node, nodeId) => {
          persistentSubtreeReferences.set(nodeId, cloneSyntaxNodeDeep(node));
        });
        const normalizedChange = normalizeDerivationFrameChange(item.change, normalizedFrameNodeIds);
        if (!normalizedChange) {
          const flagSuffix = normalizeOptionalStepText(item.stepId)
            || normalizeOptionalStepText(item.frameId)
            || `f${frameIndex + 1}`;
          integrityFlags.push(`change_missing_on_frame:${flagSuffix}`);
        }
        previousWorkspaceForest = workspaceForest.map((root) => cloneSyntaxNodeDeep(root));

        return {
          frameId: normalizeOptionalStepText(item.frameId) || `f${frameIndex + 1}`,
          stepId: normalizeOptionalStepText(item.stepId),
          after: {
            ...(reusePreviousWorkspace ? { reusePreviousWorkspace: true } : {}),
            workspaceForest
          },
          change: normalizedChange,
          note: normalizeOptionalStepText(item.note),
          ...(Array.isArray(item.visualRelationEvents) ? { visualRelationEvents: item.visualRelationEvents } : {}),
          ...(item.featureChecking ? {
            change: {
              ...(normalizedChange || {}),
              details: {
                ...((normalizedChange?.details && typeof normalizedChange.details === 'object') ? normalizedChange.details : {}),
                featureChecking: normalizeFeatureChecking(item.featureChecking, frameNodeIds)
              }
            }
          } : {})
        };
      })
      .filter(Boolean);

    return canonicalizeDerivationFrames(normalizedFrames);
  };

  const collectDerivationFrameNodeIds = (derivationFrames) => {
    const nodeIds = new Set();
    if (!Array.isArray(derivationFrames)) return nodeIds;
    derivationFrames.forEach((frame) => {
      const forest = getFrameWorkspaceForest(frame);
      forest.forEach((root) => {
        collectNodeReferencesById(root).forEach((_, nodeId) => {
          if (typeof nodeId === 'string' && nodeId.trim()) {
            nodeIds.add(nodeId);
          }
        });
      });
    });
    return nodeIds;
  };

  const canonicalizeDerivationRootCandidateForSentence = (root, sentenceTokens = []) => {
    if (!root || typeof root !== 'object') return null;
    const targetTokens = Array.isArray(sentenceTokens)
      ? sentenceTokens.map((token) => String(token || '').trim()).filter(Boolean)
      : [];
    if (targetTokens.length === 0) return null;

    const candidate = cloneSyntaxNodeDeep(root);
    try {
      anchorOvertLeavesToSentenceTokens(candidate, targetTokens);
      const canonicalCandidate = deriveCanonicalSurfaceSpans(candidate);
      const overtTerminals = collectOvertTerminalNodes(canonicalCandidate)
        .map((node) => resolveNodeSurface(node))
        .map((token) => String(token || '').trim())
        .filter(Boolean);
      return sameTokenSequence(overtTerminals, targetTokens) ? canonicalCandidate : null;
    } catch {
      return null;
    }
  };

  const selectCommittedDerivationRoot = (workspaceForest, sentenceTokens = []) => {
    if (!Array.isArray(workspaceForest) || workspaceForest.length === 0) return null;
    const targetTokens = Array.isArray(sentenceTokens)
      ? sentenceTokens.map((token) => String(token || '').trim()).filter(Boolean)
      : [];
    if (targetTokens.length === 0) return null;

    const candidates = workspaceForest
      .map((root) => {
        if (!root || typeof root !== 'object') return null;
        return canonicalizeDerivationRootCandidateForSentence(root, targetTokens);
      })
      .filter(Boolean);

    return candidates.length === 1 ? candidates[0] : null;
  };

  const findLatestCommittedDerivationFrame = (derivationFrames, sentenceTokens = []) => {
    if (!Array.isArray(derivationFrames) || derivationFrames.length === 0) return null;
    for (let index = derivationFrames.length - 1; index >= 0; index -= 1) {
      const frame = derivationFrames[index];
      const root = selectCommittedDerivationRoot(getFrameWorkspaceForest(frame), sentenceTokens);
      if (root) {
        return { frame, frameIndex: index, root };
      }
    }
    return null;
  };

  const buildCanonicalVisualRelationEventsFromDerivationFrames = (derivationFrames, finalTree) => {
    if (!Array.isArray(derivationFrames) || derivationFrames.length === 0 || !finalTree) return [];
    const committedNodeById = buildNodeIndexFromTree(finalTree);
    const committedParentById = buildParentIndexFromTree(finalTree);
    const allNodeById = new Map(committedNodeById);
    derivationFrames.forEach((frame) => {
      const forest = getFrameWorkspaceForest(frame);
      forest.forEach((root) => {
        collectNodeReferencesById(root).forEach((node, nodeId) => {
          if (typeof nodeId === 'string' && nodeId.trim()) {
            allNodeById.set(nodeId, node);
          }
        });
      });
    });

    const hasDerivationStageVisualRelationContract = derivationFrames.some((frame) => {
      const details = frame?.change?.details && typeof frame.change.details === 'object'
        ? frame.change.details
        : null;
      return details?.derivationStageVisualRelationsContract === true;
    });
    const authoredVisualRelationEvents = derivationFrames.flatMap((frame, index) => {
      const frameEvents = Array.isArray(frame?.visualRelationEvents) ? frame.visualRelationEvents : [];
      const currentForest = getFrameWorkspaceForest(frame);
      const previousForest = index > 0 ? getFrameWorkspaceForest(derivationFrames[index - 1]) : [];
      const change = getFrameChange(frame);
      return frameEvents.map((event) => {
        const label = normalizeOptionalStepText(event?.label || event?.operation || event?.type);
        if (!label) return null;
        const exactAnchorsOnly = event?.exactAnchorsOnly === true;
        const rawMovingNodeId = normalizeOptionalStepText(event?.movingNodeId);
        const rawLandingNodeId = normalizeOptionalStepText(event?.landingNodeId || event?.toNodeId || rawMovingNodeId);
        const rawFromNodeId = normalizeOptionalStepText(event?.fromNodeId || event?.sourceNodeId || event?.traceNodeId);
        const rawTraceNodeId = normalizeOptionalStepText(event?.traceNodeId);
        const hostNodeId = normalizeOptionalStepText(event?.hostNodeId);
        const resolveAuthoredNodeId = (nodeId) => {
          const normalizedNodeId = normalizeOptionalStepText(nodeId);
          if (!normalizedNodeId) return '';
          const node = allNodeById.get(normalizedNodeId);
          return node ? normalizeOptionalStepText(node.id) || normalizedNodeId : '';
        };
        const needsStructuralAnchorResolution =
          !exactAnchorsOnly
          &&
          isMoveLikeOperation(normalizeMovementOperation(label))
          && (
            (rawLandingNodeId && !allNodeById.has(rawLandingNodeId))
            || (rawMovingNodeId && !allNodeById.has(rawMovingNodeId))
            || (!rawLandingNodeId && !rawMovingNodeId)
          );
        const inferredPair = needsStructuralAnchorResolution
          ? inferMovementPairFromStateTransition({
              previousForest,
              currentForest,
              operation: label,
              rawTargetId: rawLandingNodeId || rawMovingNodeId,
              surfaceForms: extractQuotedMovementSurfaceForms(change)
          })
          : null;
        const resolvedRawLandingNodeId = resolveAuthoredNodeId(rawLandingNodeId);
        const resolvedRawFromNodeId = resolveAuthoredNodeId(rawFromNodeId);
        const resolvedRawTraceNodeId = resolveAuthoredNodeId(rawTraceNodeId);
        const resolvedRawMovingNodeId = resolveAuthoredNodeId(rawMovingNodeId);
        const landingNodeId = resolvedRawLandingNodeId
          ? resolvedRawLandingNodeId
          : normalizeOptionalStepText(inferredPair?.landingNode?.id) || rawLandingNodeId;
        const fromNodeId = resolvedRawFromNodeId
          ? resolvedRawFromNodeId
          : normalizeOptionalStepText(inferredPair?.sourceTraceNode?.id) || rawFromNodeId;
        const traceNodeId = resolvedRawTraceNodeId
          ? resolvedRawTraceNodeId
          : normalizeOptionalStepText(inferredPair?.sourceTraceNode?.id) || rawTraceNodeId;
        const movingNodeId = resolvedRawMovingNodeId
          ? resolvedRawMovingNodeId
          : landingNodeId && allNodeById.has(landingNodeId)
            ? landingNodeId
            : rawMovingNodeId;
        const diagnostics = mergeMovementDiagnostics(
          Array.isArray(event?.diagnostics) ? event.diagnostics : [],
          !rawMovingNodeId ? ['Moving node omitted in saved movement.'] : [],
          !fromNodeId ? ['Source omitted in saved movement.'] : [],
          !landingNodeId ? ['Landing omitted in saved movement.'] : [],
          rawMovingNodeId && movingNodeId === rawMovingNodeId && !allNodeById.has(rawMovingNodeId) ? [`Saved moving node "${rawMovingNodeId}" is not present in the authored tree inventory.`] : [],
          fromNodeId && !allNodeById.has(fromNodeId) ? [`Saved source node "${fromNodeId}" is not present in the authored tree inventory.`] : [],
          landingNodeId && !allNodeById.has(landingNodeId) ? [`Saved landing node "${landingNodeId}" is not present in the authored tree inventory.`] : [],
          traceNodeId && !allNodeById.has(traceNodeId) ? [`Saved trace node "${traceNodeId}" is not present in the authored tree inventory.`] : [],
          hostNodeId && !allNodeById.has(hostNodeId) ? [`Saved host node "${hostNodeId}" is not present in the authored tree inventory.`] : []
        );
        const explicitStatus = normalizeOptionalStepText(event?.serializationStatus);
        const serializationStatus = explicitStatus === 'incoherent'
          ? 'incoherent'
          : explicitStatus === 'underspecified' || diagnostics
            ? 'underspecified'
            : 'complete';
        return {
          operation: label,
          label,
          ...(movingNodeId ? { movingNodeId } : {}),
          fromNodeId,
          sourceNodeId: normalizeOptionalStepText(event?.sourceNodeId),
          landingNodeId,
          toNodeId: landingNodeId,
          traceNodeId,
          hostNodeId,
          ...(normalizeOptionalStepText(event?.chainId) ? { chainId: normalizeOptionalStepText(event.chainId) } : {}),
          ...(event?.participants && typeof event.participants === 'object' && !Array.isArray(event.participants) ? { participants: event.participants } : {}),
          stepId: normalizeOptionalStepText(event?.stepId) || normalizeOptionalStepText(frame?.stepId) || undefined,
          stepIndex: Number.isInteger(event?.stepIndex) ? event.stepIndex : index,
          note: normalizeOptionalStepText(event?.note) || normalizeOptionalStepText(frame?.change?.statement) || normalizeOptionalStepText(frame?.note),
          ...(exactAnchorsOnly ? { exactAnchorsOnly: true } : {}),
          preserveOperationLabel: true,
          serializationStatus,
          diagnostics
        };
      }).filter(Boolean);
    });
    if (hasDerivationStageVisualRelationContract) {
      return authoredVisualRelationEvents;
    }

    const isHeadCompatibleNodeId = (nodeId) => {
      const normalizedNodeId = String(nodeId || '').trim();
      if (!normalizedNodeId) return false;
      const node = allNodeById.get(normalizedNodeId) || committedNodeById.get(normalizedNodeId) || null;
      const nodeProfile = getLabelProfile(String(node?.label || '').trim());
      if (nodeProfile.isHeadLikeStructural) return true;
      const parentId = String(committedParentById.get(normalizedNodeId) || '').trim();
      if (!parentId) return false;
      const parentNode = committedNodeById.get(parentId) || allNodeById.get(parentId) || null;
      return getLabelProfile(String(parentNode?.label || '').trim()).isHeadLikeStructural;
    };

    return derivationFrames
      .flatMap((frame, index) => {
        const change = getFrameChange(frame);
        const currentForest = getFrameWorkspaceForest(frame);
        const previousForest = index > 0 ? getFrameWorkspaceForest(derivationFrames[index - 1]) : [];
        const inferredOperations = inferMovementOperationsFromChange(change, allNodeById);
        if (inferredOperations.length === 0) return [];
        const currentParentById = buildParentIndexFromForest(currentForest);
        const currentNodeById = new Map();
        currentForest.forEach((root) => {
          collectNodeReferencesById(root).forEach((node, nodeId) => {
            if (typeof nodeId === 'string' && nodeId.trim()) {
              currentNodeById.set(nodeId, node);
            }
          });
        });

        const rawSourceId = findChangeAnchorNodeId(change, ['source', 'from', 'origin', 'lower', 'sourcecopy', 'lowercopy']);
        const rawLandingId = findChangeAnchorNodeId(change, ['landing', 'target', 'to', 'destination']);
        const rawHostId =
          findChangeAnchorNodeId(change, ['host', 'container'])
          || findChangeAnchorNodeId(change, ['targethead']);
        const rawTraceId = findChangeAnchorNodeId(change, ['trace', 'residue', 'lowercopy', 'copy', 'sourcecopy']);
        const changeDetails = change?.details && typeof change.details === 'object'
          ? change.details
          : null;
        const authoredDiagnostics = Array.isArray(changeDetails?.diagnostics)
          ? changeDetails.diagnostics
          : [];
        const continuityIds = Array.isArray(change?.continuityIds)
          ? change.continuityIds.map((value) => normalizeOptionalStepText(value)).filter(Boolean)
          : [];

        return inferredOperations.map((operation, eventIndex) => {
          const surfaceForms = extractQuotedMovementSurfaceForms(change);
          const structuralPair = inferMovementPairFromStateTransition({
            previousForest,
            currentForest,
            operation,
            rawTargetId: rawLandingId || rawHostId || '',
            surfaceForms
          });
          const structuralLandingNodeId = String(structuralPair?.landingNode?.id || '').trim() || undefined;
          const structuralSourceNodeId = String(structuralPair?.sourceNode?.id || '').trim() || undefined;
          const structuralTraceNodeId = String(structuralPair?.sourceTraceNode?.id || '').trim() || undefined;
          const sourceNodeId = rawSourceId && allNodeById.has(rawSourceId)
            ? rawSourceId
            : structuralSourceNodeId;
          const traceNodeId = rawTraceId && allNodeById.has(rawTraceId)
            ? rawTraceId
            : (
              rawSourceId
              && currentNodeById.has(rawSourceId)
              && isSilentLikeMovementNode(currentNodeById.get(rawSourceId))
                ? rawSourceId
                : structuralTraceNodeId
            );
          const authoredLandingNodeId = rawLandingId && allNodeById.has(rawLandingId) ? rawLandingId : undefined;
          const authoredHostNodeId = rawHostId && allNodeById.has(rawHostId) ? rawHostId : undefined;
          const recoveredHostNodeId = !authoredHostNodeId && operation === 'HeadMove'
            ? findHeadMoveHostNodeIdFromSurfaceCue({
                change,
                forest: currentForest,
                nodeById: allNodeById,
                parentById: currentParentById
              })
              || structuralLandingNodeId
            : undefined;
          const hostNodeId = authoredHostNodeId || recoveredHostNodeId;
          const landingNodeId = authoredLandingNodeId
            || (operation === 'HeadMove' ? hostNodeId : structuralLandingNodeId);
          const diagnostics = mergeMovementDiagnostics(
            authoredDiagnostics,
            !sourceNodeId ? ['Source omitted in saved movement.'] : [],
            !landingNodeId ? ['Landing omitted in saved movement.'] : [],
            rawSourceId && !allNodeById.has(rawSourceId) ? [`Saved source node "${rawSourceId}" is not present in the authored tree inventory.`] : [],
            rawLandingId && !authoredLandingNodeId && !(operation === 'HeadMove' && hostNodeId)
              ? [`Saved landing node "${rawLandingId}" is not present in the authored tree inventory.`]
              : [],
            rawHostId && !authoredHostNodeId ? [`Saved host node "${rawHostId}" is not present in the authored tree inventory.`] : [],
            !rawHostId && !authoredLandingNodeId && recoveredHostNodeId && operation === 'HeadMove'
              ? ['Recovered head-movement landing from the overt head in the current Derivation frame.']
              : [],
            rawTraceId && !allNodeById.has(rawTraceId) ? [`Saved trace node "${rawTraceId}" is not present in the authored tree inventory.`] : []
          );

          const sourceNode = sourceNodeId ? (allNodeById.get(sourceNodeId) || null) : null;
          const landingNode = landingNodeId ? (allNodeById.get(landingNodeId) || null) : null;
          const sourceProfile = getLabelProfile(String(sourceNode?.label || '').trim());
          const targetProfile = getLabelProfile(String(landingNode?.label || '').trim());
          const targetHasOvertYield = Boolean(landingNode && subtreeHasOvertYield(landingNode));
          const headMovementIsIncoherent = (
            operation === 'HeadMove'
            && sourceNodeId
            && landingNodeId
            && (
              !isHeadCompatibleNodeId(sourceNodeId)
              || !isHeadCompatibleNodeId(landingNodeId)
              || (
                targetProfile.base === 'n'
                && sourceProfile.base !== 'n'
                && targetHasOvertYield
              )
            )
          );
          const mergedDiagnostics = mergeMovementDiagnostics(
            diagnostics,
            headMovementIsIncoherent
              ? ['Head-like movement encodes an incoherent head trajectory in the saved derivation.']
              : []
          );
          const explicitStatus = normalizeOptionalStepText(changeDetails?.serializationStatus);
          const serializationStatus = explicitStatus === 'incoherent' || headMovementIsIncoherent
            ? 'incoherent'
            : explicitStatus === 'underspecified' || mergedDiagnostics
              ? 'underspecified'
              : 'complete';
          const detailChainId = findChangeDetailLineageId(change) || undefined;
          const structuralChainId = normalizeOptionalStepText(structuralPair?.lineageId) || undefined;
          const chainId = (
            continuityIds.length === 1
              ? continuityIds[0]
              : undefined
          ) || detailChainId || structuralChainId;
          return {
            operation,
            fromNodeId: sourceNodeId,
            ...(landingNodeId ? { landingNodeId } : {}),
            ...(hostNodeId ? { hostNodeId } : {}),
            toNodeId: landingNodeId,
            traceNodeId,
            ...(chainId ? { chainId } : {}),
            stepId: normalizeOptionalStepText(frame?.stepId) || undefined,
            stepIndex: index,
            note: normalizeOptionalStepText(change?.statement) || normalizeOptionalStepText(frame?.note),
            serializationStatus,
            diagnostics: mergedDiagnostics
          };
        }).filter((event) => event.fromNodeId || event.toNodeId || event.traceNodeId || event.hostNodeId);
      })
      .filter(Boolean);
  };

  const buildCanonicalDerivationFromDerivationFrames = (derivationFrames, sentenceTokens = [], framework = 'xbar') => {
    if (!Array.isArray(derivationFrames) || derivationFrames.length === 0) return null;

    const committedFrameInfo = findLatestCommittedDerivationFrame(derivationFrames, sentenceTokens);
    if (!committedFrameInfo?.root) return null;
    const committedRootSource = committedFrameInfo.root;

    const finalNodeReferences = collectNodeReferencesById(committedRootSource);
    const finalNodeIds = new Set(Object.keys(finalNodeReferences));
    const { tree: committedTree } = normalizeSyntaxTreeWithIds(committedRootSource, finalNodeReferences, framework, sentenceTokens);
    const surfaceOrder = collectOvertTerminalNodes(committedTree)
      .map((node) => resolveNodeSurface(node))
      .map((token) => String(token || '').trim())
      .filter(Boolean);
    if (!sameTokenSequence(surfaceOrder, sentenceTokens)) return null;

    const derivationSteps = derivationFrames.map((frame, index) => {
      const currentForest = getFrameWorkspaceForest(frame);
      const previousForest = index > 0 ? getFrameWorkspaceForest(derivationFrames[index - 1]) : [];
      const workspaceLabels = currentForest
            .map((node) => String(node?.label || node?.word || '').trim())
            .filter(Boolean);
      const workspaceNodeById = new Map();
      currentForest.forEach((root) => {
        collectNodeReferencesById(root).forEach((node, nodeId) => {
          workspaceNodeById.set(nodeId, node);
        });
      });
      const candidateRoot = selectCommittedDerivationRoot(currentForest, sentenceTokens)
        || (currentForest.length === 1 ? currentForest[0] : null);
      const change = getFrameChange(frame);
      const operation = inferFrameOperation({
        change,
        currentForest,
        previousForest,
        nodeById: workspaceNodeById
      });
      const workspaceParentById = buildParentIndexFromForest(currentForest);
      const authoredMovementLandingNodeId = findChangeAnchorNodeId(change, ['landing', 'target', 'to', 'destination']);
      const authoredMovementHostNodeId = findChangeAnchorNodeId(change, ['targethead']) || findChangeAnchorNodeId(change, ['host', 'container']);
      const recoveredHeadMoveHostNodeId = operation === 'HeadMove' && !authoredMovementLandingNodeId && !authoredMovementHostNodeId
        ? findHeadMoveHostNodeIdFromSurfaceCue({
            change,
            forest: currentForest,
            nodeById: workspaceNodeById,
            parentById: workspaceParentById
          })
        : undefined;
      const movementLandingNodeId = authoredMovementLandingNodeId
        || (operation === 'HeadMove'
          ? (authoredMovementHostNodeId || recoveredHeadMoveHostNodeId || '')
          : '');
      const movementLandingNode = movementLandingNodeId
        ? workspaceNodeById.get(movementLandingNodeId) || null
        : null;
      const isMoveFrame = isMoveLikeOperation(operation);
      const targetNodeId = isMoveFrame
        ? (movementLandingNodeId || undefined)
        : (String(candidateRoot?.id || '').trim() || undefined);
      const targetLabel = isMoveFrame
        ? (String(movementLandingNode?.label || '').trim() || undefined)
        : (String(candidateRoot?.label || '').trim() || undefined);
      const sourceNodeIds = Array.from(new Set([
        findChangeAnchorNodeId(change, ['trace', 'residue', 'lowercopy', 'copy', 'sourcecopy']),
        findChangeAnchorNodeId(change, ['source', 'from', 'origin', 'lower', 'sourcecopy', 'lowercopy'])
      ].filter(Boolean)));
      const sourceLabels = sourceNodeIds
        .map((id) => {
          const node = workspaceNodeById.get(id);
          return String(node?.label || node?.word || '').trim();
        })
        .filter(Boolean);
      return {
        stepId: normalizeOptionalStepText(frame.stepId) || `gf${index + 1}`,
        operation,
        targetNodeId,
        targetLabel,
        sourceNodeIds: sourceNodeIds.length > 0 ? sourceNodeIds : undefined,
        sourceLabels: sourceLabels.length > 0
          ? sourceLabels
          : (isMoveFrame ? undefined : (workspaceLabels.length > 0 ? workspaceLabels : undefined)),
        recipe: normalizeOptionalStepText(change?.statement) || `${operation} frame ${index + 1}`,
        workspaceAfter: workspaceLabels.length > 0 ? workspaceLabels : undefined,
        featureChecking: Array.isArray(change?.details?.featureChecking) && change.details.featureChecking.length > 0
          ? change.details.featureChecking
          : undefined,
        chainId: findChangeContinuityId(change) || undefined,
        note: normalizeOptionalStepText(frame.note)
      };
    });

    const explicitVisualRelationEvents = buildCanonicalVisualRelationEventsFromDerivationFrames(derivationFrames, committedTree);
    const visualRelationEvents = [...explicitVisualRelationEvents].sort((left, right) => {
      const leftStep = Number.isInteger(left?.stepIndex) ? left.stepIndex : Number.MAX_SAFE_INTEGER;
      const rightStep = Number.isInteger(right?.stepIndex) ? right.stepIndex : Number.MAX_SAFE_INTEGER;
      if (leftStep !== rightStep) return leftStep - rightStep;
      const leftOp = String(left?.operation || '');
      const rightOp = String(right?.operation || '');
      return leftOp.localeCompare(rightOp);
    });

    const lastStep = derivationSteps[derivationSteps.length - 1];
    if (lastStep && String(lastStep.operation || '').trim() !== 'SpellOut') {
      derivationSteps.push({
        stepId: `gf${derivationSteps.length + 1}`,
        operation: 'SpellOut',
        targetNodeId: String(committedTree?.id || '').trim() || undefined,
        targetLabel: String(committedTree?.label || '').trim() || undefined,
        sourceNodeIds: String(committedTree?.id || '').trim() ? [String(committedTree.id).trim()] : undefined,
        sourceLabels: [String(committedTree?.label || '').trim() || 'Tree'],
        recipe: `SpellOut(${String(committedTree?.label || 'Tree').trim() || 'Tree'})`,
        workspaceAfter: [String(committedTree?.label || '').trim() || 'Tree'],
        spelloutOrder: surfaceOrder,
        note: 'Final spellout of the committed derivation state.'
      });
    }

    return {
      tree: committedTree,
      surfaceOrder,
      derivationSteps,
      visualRelationEvents
    };
  };

  const assignDerivationStepIds = (steps) => {
    if (!Array.isArray(steps) || steps.length === 0) return steps;

    const seen = new Set();
    return steps.map((step, index) => {
      const preferred = normalizeOptionalStepText(step?.stepId);
      const stepId = preferred && !seen.has(preferred) ? preferred : `s${index + 1}`;
      seen.add(stepId);
      return {
        ...step,
        stepId
      };
    });
  };

  return {
    parseTransportJsonValue,
    normalizeTransportJsonArray,
    normalizeDerivationStagesToDerivationFrames,
    normalizeDerivationFrames,
    normalizeMovementStemFromId,
    materializeImplicitPhrasalTraceShellsInDerivationFrames,
    materializeCommittedTraceShells,
    collectDerivationFrameNodeIds,
    canonicalizeDerivationRootCandidateForSentence,
    selectCommittedDerivationRoot,
    findLatestCommittedDerivationFrame,
    buildCanonicalVisualRelationEventsFromDerivationFrames,
    buildCanonicalDerivationFromDerivationFrames,
    assignDerivationStepIds
  };
};
