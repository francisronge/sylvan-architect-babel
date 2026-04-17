export const createDerivationHelpers = ({
  MOVEMENT_INDEX_SUBSCRIPT_MAP,
  STRUCTURAL_LEAF_LABELS,
  PRIME_CATEGORY_LABEL_RE,
  canonicalizeCovertSurface,
  normalizeSurfaceToken,
  subtreeHasOvertYield,
  getLabelProfile,
  normalizeOptionalStepText,
  normalizeOptionalStringArray,
  normalizeMovementOperation,
  extractMovementIndex,
  stripMovementIndex
}) => {
  const MOVE_LIKE_OPERATION_RE = /^(move|internal[\s-]*merge|head[\s-]*move|a[\s-]*move|a(?:bar)?[\s-]*move)$/i;
  const TRACE_LIKE_SURFACE_RE = /^(?:t|trace|t\d+|trace\d+|(?:t|trace)(?:_[a-z0-9]+)+|[a-z]+_trace(?:_[a-z0-9]+)*|<[^>]+>|⟨[^⟩]+⟩|\(t\)|\{t\})$/i;
  const NULL_LIKE_SURFACE_RE = /^(?:∅|Ø|ε|null|epsilon|pro)(?:[_-][a-z0-9]+)*$/i;
  const ABSTRACT_FEATURE_SURFACE_RE = /^(?:past|present|pres|future|fut|finite|nonfinite|infinitive|inf|perfect|perf|progressive|prog|passive|active|nom(?:inative)?|acc(?:usative)?|dat(?:ive)?|gen(?:itive)?|erg(?:ative)?|abs(?:olutive)?|epp|phi|wh|focus|topic|tense|agreement|agr)$/i;
  const TRACE_ID_RE = /^trace[_-]?(\d+)?$/i;
  const MOVEMENT_OPERATION_PHRASE = {
    Move: 'movement',
    InternalMerge: 'internal merge',
    HeadMove: 'head movement',
    'A-Move': 'A-movement',
    AbarMove: 'A-bar movement',
    Other: 'movement'
  };

  const isMoveLikeOperation = (operation) => MOVE_LIKE_OPERATION_RE.test(String(operation || '').trim());

  const normalizeTraceLikeSurface = (surface) =>
    String(surface || '')
      .trim()
      .replace(/\{([^}]*)\}/g, '$1')
      .replace(/[₀₁₂₃₄₅₆₇₈₉ᵢⱼₐₑₒₓₕₖₗₘₙₚₛₜ]/g, (char) => MOVEMENT_INDEX_SUBSCRIPT_MAP[char] || char);

  const buildNodeIndexFromTree = (tree) => {
    const byId = new Map();
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      const id = String(node.id || '').trim();
      if (id) byId.set(id, node);
      const children = Array.isArray(node.children) ? node.children : [];
      children.forEach(visit);
    };
    visit(tree);
    return byId;
  };

  const buildParentIndexFromTree = (tree) => {
    const parents = new Map();
    const visit = (node, parentId = null) => {
      if (!node || typeof node !== 'object') return;
      const id = String(node.id || '').trim();
      if (id && parentId) parents.set(id, parentId);
      const children = Array.isArray(node.children) ? node.children : [];
      children.forEach((child) => visit(child, id || parentId));
    };
    visit(tree);
    return parents;
  };

  const buildNodeLabelIndexFromTree = (tree) => {
    const byLabel = new Map();
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      const id = String(node.id || '').trim();
      const label = String(node.label || '').trim();
      if (id && label) {
        if (!byLabel.has(label)) byLabel.set(label, []);
        byLabel.get(label).push(id);
      }
      const children = Array.isArray(node.children) ? node.children : [];
      children.forEach(visit);
    };
    visit(tree);
    return byLabel;
  };

  const collectLeafNodes = (node) => {
    const leaves = [];
    const visit = (current) => {
      if (!current || typeof current !== 'object') return;
      const children = Array.isArray(current.children) ? current.children : [];
      if (children.length === 0) {
        leaves.push(current);
        return;
      }
      children.forEach(visit);
    };
    visit(node);
    return leaves;
  };

  const collectSubtreeNodeIds = (node) => {
    const ids = new Set();
    const visit = (current) => {
      if (!current || typeof current !== 'object') return;
      const id = String(current.id || '').trim();
      if (id) ids.add(id);
      const children = Array.isArray(current.children) ? current.children : [];
      children.forEach(visit);
    };
    visit(node);
    return ids;
  };

  const resolveNodeSurface = (node) => {
    const word = String(node?.word || '').trim();
    const label = String(node?.label || '').trim();
    return canonicalizeCovertSurface(word || label);
  };

  const isCovertCategorySurface = (surface) => {
    const canonical = canonicalizeCovertSurface(surface);
    return canonical === '∅' || canonical === 'PRO';
  };

  const isStructuralLeafLabel = (label) => {
    const raw = String(label || '').trim();
    if (!raw) return false;
    if (!STRUCTURAL_LEAF_LABELS.has(raw.toLowerCase())) return false;
    return raw === raw.toUpperCase() || /^[A-Z]/.test(raw) || PRIME_CATEGORY_LABEL_RE.test(raw);
  };

  const traceLikeNodeType = (node) => {
    const rawType = String(node?.type || '').trim().toLowerCase();
    if (!rawType) return '';
    if (rawType === 'trace') return rawType;
    if (rawType.includes('trace')) return rawType;
    if (rawType === 'lower-copy' || rawType === 'lower_copy' || rawType === 'silent-copy' || rawType === 'silent_copy') {
      return rawType;
    }
    return '';
  };

  const resolveOvertLeafSurface = (node) => {
    if (node?.silentFeature === true) return '';
    if (traceLikeNodeType(node)) return '';
    const word = String(node?.word || '').trim();
    if (word) return word;
    const children = Array.isArray(node?.children) ? node.children : [];
    if (children.length > 0) return '';
    const label = String(node?.label || '').trim();
    if (!label) return '';
    if (isStructuralLeafLabel(label)) return '';
    return label;
  };

  const isAbstractFeatureSurface = (surface) => ABSTRACT_FEATURE_SURFACE_RE.test(String(surface || '').trim());

  const isTraceLikeSurface = (surface) => {
    const raw = String(surface || '').trim();
    if (!raw) return false;
    const normalized = normalizeTraceLikeSurface(raw);
    return TRACE_LIKE_SURFACE_RE.test(raw) || TRACE_LIKE_SURFACE_RE.test(normalized);
  };

  const isNullLikeSurface = (surface) => NULL_LIKE_SURFACE_RE.test(canonicalizeCovertSurface(surface));

  const isTraceLikeNode = (node) => Boolean(traceLikeNodeType(node)) || isTraceLikeSurface(resolveNodeSurface(node));
  const isNullLikeNode = (node) => NULL_LIKE_SURFACE_RE.test(resolveNodeSurface(node));

  const nodeMovementIndex = (node) =>
    extractMovementIndex(String(node?.label || '').trim()) ||
    extractMovementIndex(String(node?.word || '').trim()) ||
    null;

  const isIndexedTraceOrNullNode = (node) => {
    const label = stripMovementIndex(String(node?.label || '').trim());
    const surface = stripMovementIndex(resolveNodeSurface(node));
    return isTraceLikeSurface(label) ||
      isTraceLikeSurface(surface) ||
      NULL_LIKE_SURFACE_RE.test(label) ||
      NULL_LIKE_SURFACE_RE.test(surface);
  };

  const subtreeContainsOnlyCovertCategoryLeaves = (node) => {
    const leaves = collectLeafNodes(node);
    if (leaves.length === 0) return false;
    return leaves.every((leaf) => {
      const surface = resolveNodeSurface(leaf);
      return isTraceLikeNode(leaf) || isNullLikeNode(leaf) || isCovertCategorySurface(surface);
    });
  };

  const subtreeContainsNamedCovertCategoryLeaf = (node) => {
    const leaves = collectLeafNodes(node);
    if (leaves.length === 0) return false;
    return leaves.some((leaf) => isCovertCategorySurface(resolveNodeSurface(leaf)));
  };

  const hasSameIndexedAncestor = (nodeId, movementIndex, nodeById, parentById) => {
    let currentId = String(parentById.get(String(nodeId || '').trim()) || '').trim();
    while (currentId) {
      const current = nodeById.get(currentId);
      if (current && nodeMovementIndex(current) === movementIndex) return true;
      currentId = String(parentById.get(currentId) || '').trim();
    }
    return false;
  };

  const findIndexedTraceLeaf = (node, movementIndex) =>
    collectLeafNodes(node).find((leaf) => {
      const index = nodeMovementIndex(leaf);
      if (index && index === movementIndex && isIndexedTraceOrNullNode(leaf)) return true;
      return !index && (isTraceLikeNode(leaf) || isNullLikeNode(leaf));
    }) || null;

  const stripMovementIndicesFromTree = (node) => {
    if (!node || typeof node !== 'object') return node;
    const label = String(node.label || '').trim();
    if (label) {
      const stripped = stripMovementIndex(label);
      if (stripped && stripped !== label) {
        node.label = stripped;
      }
    }
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach((child) => stripMovementIndicesFromTree(child));
    return node;
  };

  const materializeEmptyStructuralLeaves = (node, sentenceTokens, options = {}, withinProtectedSubtree = false) => {
    if (!node || typeof node !== 'object') return node;
    const protectedSubtreeIds = options?.protectedSubtreeIds instanceof Set
      ? options.protectedSubtreeIds
      : new Set();
    const currentId = String(node.id || '').trim();
    const nextWithinProtectedSubtree = withinProtectedSubtree || (currentId && protectedSubtreeIds.has(currentId));
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach((child) => materializeEmptyStructuralLeaves(child, sentenceTokens, options, nextWithinProtectedSubtree));
    if (nextWithinProtectedSubtree) return node;
    if (children.length === 0) {
      const label = String(node.label || '').trim();
      const word = String(node.word || '').trim();
      const treatAsStructuralLeaf = isStructuralLeafLabel(label) || label === 'v';
      if (label && !word && treatAsStructuralLeaf) {
        const normalizedLabel = normalizeSurfaceToken(label);
        if (normalizedLabel && sentenceTokens && sentenceTokens.has(normalizedLabel)) return node;
        node.children = [{ label: '∅', id: `null_${String(node.id || 'anon').trim()}` }];
      }
    }
    return node;
  };

  const promoteSentenceMatchingLeaves = (tree, sentenceTokenSet) => {
    if (!tree || typeof tree !== 'object' || !sentenceTokenSet) return;
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      const children = Array.isArray(node.children) ? node.children : [];
      if (children.length === 0) {
        if (String(node.word || '').trim()) return;
        const label = String(node.label || '').trim();
        if (!label) return;
        const normalized = normalizeSurfaceToken(label);
        if (normalized && sentenceTokenSet.has(normalized) && isStructuralLeafLabel(label)) {
          node.word = label;
        }
        return;
      }
      children.forEach(visit);
    };
    visit(tree);
  };

  const resolveMovementEventStepIndex = (event, derivationSteps) => {
    if (!Array.isArray(derivationSteps) || derivationSteps.length === 0) return undefined;

    const explicitStep = Number(event.stepIndex);
    if (Number.isInteger(explicitStep) && explicitStep >= 0 && explicitStep < derivationSteps.length) {
      return explicitStep;
    }

    const fromNodeId = String(event.fromNodeId || '').trim();
    const toNodeId = String(event.toNodeId || '').trim();
    const traceNodeId = String(event.traceNodeId || '').trim();

    let bestIndex = -1;
    let bestScore = -1;

    derivationSteps.forEach((step, index) => {
      if (!step || typeof step !== 'object') return;
      const stepTarget = String(step.targetNodeId || '').trim();
      const stepSources = Array.isArray(step.sourceNodeIds)
        ? step.sourceNodeIds.map((id) => String(id || '').trim()).filter(Boolean)
        : [];

      let score = 0;
      if (stepTarget && stepTarget === toNodeId) score += 6;
      if (stepSources.includes(fromNodeId)) score += 5;
      if (stepTarget && stepTarget === fromNodeId) score += 2;
      if (stepSources.includes(toNodeId)) score += 1;
      if (traceNodeId && (stepTarget === traceNodeId || stepSources.includes(traceNodeId))) score += 2;
      if (isMoveLikeOperation(step.operation)) score += 3;

      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    if (bestIndex >= 0 && bestScore > 0) return bestIndex;

    const fallbackMoveIndex = derivationSteps.findIndex((step) => isMoveLikeOperation(step?.operation));
    if (fallbackMoveIndex >= 0) return fallbackMoveIndex;

    return undefined;
  };

  const resolveMovementNodeReference = (rawRef, nodeIds, labelIndex) => {
    const ref = String(rawRef || '').trim();
    if (!ref) return '';
    if (nodeIds.has(ref)) return ref;
    const labelMatches = labelIndex.get(ref) || [];
    if (labelMatches.length === 1) return String(labelMatches[0] || '').trim();
    return '';
  };

  const normalizeMovementEvents = (value, nodeIds, derivationSteps, nodeById, labelIndex) => {
    if (!Array.isArray(value)) return undefined;
    const steps = Array.isArray(derivationSteps) ? derivationSteps : [];
    const stepIndexById = new Map();
    steps.forEach((step, index) => {
      const stepId = normalizeOptionalStepText(step?.stepId);
      if (stepId && !stepIndexById.has(stepId)) {
        stepIndexById.set(stepId, index);
      }
    });

    const events = value
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const explicitStepId = normalizeOptionalStepText(item.stepId);
        let operation = normalizeMovementOperation(item.operation || item.type);
        const explicitSourceRef = String(item.fromNodeId || item.source || '').trim();
        const explicitTargetRef = String(item.toNodeId || item.target || '').trim();
        const explicitTraceRef = String(item.traceNodeId || item.trace || '').trim();
        let fromNodeId = resolveMovementNodeReference(explicitSourceRef, nodeIds, labelIndex);
        let toNodeId = resolveMovementNodeReference(explicitTargetRef, nodeIds, labelIndex);
        let traceNodeId = resolveMovementNodeReference(explicitTraceRef, nodeIds, labelIndex);
        const stepIndexRaw = Number(item.stepIndex);
        const hasDerivationTimeline = steps.length > 0;
        let stepIndex = Number.isInteger(stepIndexRaw) &&
          stepIndexRaw >= 0 &&
          (!hasDerivationTimeline || stepIndexRaw < steps.length)
          ? stepIndexRaw
          : undefined;

        if (stepIndex === undefined && explicitStepId && stepIndexById.has(explicitStepId)) {
          stepIndex = stepIndexById.get(explicitStepId);
        }

        if (stepIndex === undefined) {
          stepIndex = resolveMovementEventStepIndex({
            operation,
            fromNodeId,
            toNodeId,
            traceNodeId
          }, steps);
        }

        const alignedStep = Number.isInteger(stepIndex) && stepIndex >= 0 && stepIndex < steps.length
          ? steps[stepIndex]
          : undefined;
        operation = operation || normalizeMovementOperation(alignedStep?.operation);

        if (!fromNodeId && Array.isArray(alignedStep?.sourceNodeIds) && alignedStep.sourceNodeIds.length === 1) {
          fromNodeId = String(alignedStep.sourceNodeIds[0] || '').trim();
        }
        if (!toNodeId && alignedStep?.targetNodeId) {
          toNodeId = String(alignedStep.targetNodeId || '').trim();
        }
        if (!traceNodeId && fromNodeId) {
          const sourceNode = nodeById.get(fromNodeId);
          if (sourceNode && (isTraceLikeNode(sourceNode) || isNullLikeNode(sourceNode))) {
            traceNodeId = fromNodeId;
          }
        }

        if (!fromNodeId || !toNodeId) return null;
        if (!nodeIds.has(fromNodeId) || !nodeIds.has(toNodeId)) return null;

        const chainId = normalizeOptionalStepText(item.chainId) || normalizeOptionalStepText(alignedStep?.chainId);
        return {
          operation,
          fromNodeId,
          toNodeId,
          traceNodeId: traceNodeId && nodeIds.has(traceNodeId) ? traceNodeId : undefined,
          ...(chainId ? { chainId } : {}),
          stepIndex,
          note: typeof item.note === 'string' ? item.note : undefined
        };
      })
      .filter(Boolean);

    return events.length > 0 ? events : undefined;
  };

  const isNodeDominatedBy = (nodeId, ancestorId, parentById) => {
    const target = String(nodeId || '').trim();
    const ancestor = String(ancestorId || '').trim();
    if (!target || !ancestor) return false;
    let current = target;
    while (current) {
      if (current === ancestor) return true;
      current = String(parentById.get(current) || '').trim();
    }
    return false;
  };

  const isExternalTraceLikeNode = (node, targetNodeId, parentById) => {
    const id = String(node?.id || '').trim();
    if (!id) return false;
    if (isNodeDominatedBy(id, targetNodeId, parentById)) return false;
    return isTraceLikeNode(node) || isNullLikeNode(node);
  };

  const findUniqueTraceLikeLeafOutsideSubtree = (searchRoot, excludedSubtree, parentById) => {
    if (!searchRoot || !excludedSubtree) return null;
    const excludedIds = collectSubtreeNodeIds(excludedSubtree);
    const candidates = collectLeafNodes(searchRoot).filter((leaf) => {
      const id = String(leaf.id || '').trim();
      if (!id || excludedIds.has(id)) return false;
      return isExternalTraceLikeNode(leaf, String(excludedSubtree.id || '').trim(), parentById);
    });
    return candidates.length === 1 ? candidates[0] : null;
  };

  const getMoveLikeTraceSourceFromStep = (step, nodeById, targetNodeId, parentById) => {
    const sourceIds = Array.isArray(step?.sourceNodeIds)
      ? step.sourceNodeIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    for (const sourceId of sourceIds) {
      const sourceNode = nodeById.get(sourceId);
      if (!sourceNode) continue;
      if (isExternalTraceLikeNode(sourceNode, targetNodeId, parentById)) return sourceNode;
      const leafCandidate = collectLeafNodes(sourceNode).find((leaf) =>
        isExternalTraceLikeNode(leaf, targetNodeId, parentById)
      );
      if (leafCandidate) return leafCandidate;
    }
    return null;
  };

  const groundMovementEvent = ({
    event,
    step,
    tree,
    nodeById,
    parentById
  }) => {
    if (!event) return null;
    const fromNodeId = String(event.fromNodeId || '').trim();
    const toNodeId = String(event.toNodeId || '').trim();
    if (!fromNodeId || !toNodeId) return null;

    const fromNode = nodeById.get(fromNodeId);
    const toNode = nodeById.get(toNodeId);
    if (!fromNode || !toNode) return null;

    const op = normalizeMovementOperation(event.operation) || 'Move';

    const explicitTraceId = String(event.traceNodeId || '').trim();
    const explicitTraceNode = explicitTraceId ? nodeById.get(explicitTraceId) : undefined;
    const groundedExplicitTrace = explicitTraceNode && isExternalTraceLikeNode(explicitTraceNode, toNodeId, parentById)
      ? explicitTraceNode
      : null;

    if (op === 'HeadMove') {
      if (groundedExplicitTrace) {
        return {
          ...event,
          operation: op,
          fromNodeId: String(groundedExplicitTrace.id || '').trim(),
          traceNodeId: String(groundedExplicitTrace.id || '').trim()
        };
      }

      const parentId = String(parentById.get(toNodeId) || '').trim();
      const parentNode = parentId ? nodeById.get(parentId) : undefined;
      const siblingTrace = parentNode
        ? findUniqueTraceLikeLeafOutsideSubtree(parentNode, toNode, parentById)
        : null;
      if (siblingTrace) {
        return {
          ...event,
          operation: op,
          fromNodeId: String(siblingTrace.id || '').trim(),
          traceNodeId: String(siblingTrace.id || '').trim()
        };
      }

      const stepTrace = getMoveLikeTraceSourceFromStep(step, nodeById, toNodeId, parentById);
      if (stepTrace) {
        return {
          ...event,
          operation: op,
          fromNodeId: String(stepTrace.id || '').trim(),
          traceNodeId: String(stepTrace.id || '').trim()
        };
      }

      return null;
    }

    const fromProfile = getLabelProfile(fromNode.label);
    const toProfile = getLabelProfile(toNode.label);
    if (toProfile.isPhrasal && fromProfile.isHeadLikeStructural) {
      const stepTrace = getMoveLikeTraceSourceFromStep(step, nodeById, toNodeId, parentById);
      if (stepTrace) {
        const stepTraceProfile = getLabelProfile(stepTrace.label);
        if (!stepTraceProfile.isHeadLikeStructural) {
          return {
            ...event,
            operation: op,
            fromNodeId: String(stepTrace.id || '').trim(),
            traceNodeId: String(stepTrace.id || '').trim()
          };
        }
      }

      const externalTrace = findUniqueTraceLikeLeafOutsideSubtree(tree, toNode, parentById);
      if (externalTrace) {
        const traceProfile = getLabelProfile(externalTrace.label);
        if (!traceProfile.isHeadLikeStructural) {
          return {
            ...event,
            operation: op,
            fromNodeId: String(externalTrace.id || '').trim(),
            traceNodeId: String(externalTrace.id || '').trim()
          };
        }
      }

      return null;
    }

    if (groundedExplicitTrace) {
      return {
        ...event,
        operation: op,
        traceNodeId: String(groundedExplicitTrace.id || '').trim()
      };
    }

    if (isNodeDominatedBy(fromNodeId, toNodeId, parentById)) {
      const stepTrace = getMoveLikeTraceSourceFromStep(step, nodeById, toNodeId, parentById);
      if (stepTrace) {
        return {
          ...event,
          operation: op,
          fromNodeId: String(stepTrace.id || '').trim(),
          traceNodeId: String(stepTrace.id || '').trim()
        };
      }

      const externalTrace = findUniqueTraceLikeLeafOutsideSubtree(tree, toNode, parentById);
      if (externalTrace) {
        return {
          ...event,
          operation: op,
          fromNodeId: String(externalTrace.id || '').trim(),
          traceNodeId: String(externalTrace.id || '').trim()
        };
      }

      return null;
    }

    return {
      ...event,
      operation: op,
      traceNodeId: undefined
    };
  };

  const isPlausibleRawMovementEvent = (event, nodeById) => {
    const fromNodeId = String(event?.fromNodeId || '').trim();
    const toNodeId = String(event?.toNodeId || '').trim();
    if (!fromNodeId || !toNodeId) return false;
    if (!nodeById.has(fromNodeId) || !nodeById.has(toNodeId)) return false;
    return fromNodeId !== toNodeId;
  };

  const buildCanonicalMovementEvents = ({
    tree,
    derivationSteps,
    rawMovementEvents
  }) => {
    const nodeById = buildNodeIndexFromTree(tree);
    const parentById = buildParentIndexFromTree(tree);
    const steps = Array.isArray(derivationSteps) ? derivationSteps : [];
    const rawEvents = Array.isArray(rawMovementEvents) ? rawMovementEvents : [];
    const canonical = [];
    const seen = new Set();
    const claimedLaunchSites = new Set();

    const pushEvent = (event, stepForContext) => {
      if (!event) return;
      const fromNodeId = String(event.fromNodeId || '').trim();
      const toNodeId = String(event.toNodeId || '').trim();
      if (!fromNodeId || !toNodeId) return;
      if (!nodeById.has(fromNodeId) || !nodeById.has(toNodeId)) return;
      if (fromNodeId === toNodeId) return;
      const stepIndex = Number(event.stepIndex);
      const safeStepIndex = Number.isInteger(stepIndex) && stepIndex >= 0 && stepIndex < steps.length
        ? stepIndex
        : undefined;
      const explicitOperation = normalizeMovementOperation(event.operation) || 'Move';
      const traceNodeId = (() => {
        const trace = String(event.traceNodeId || '').trim();
        if (trace && nodeById.has(trace)) return trace;
        return undefined;
      })();
      const launchSiteId = traceNodeId || fromNodeId;
      if (launchSiteId && claimedLaunchSites.has(launchSiteId)) return;
      const key = `${fromNodeId}->${toNodeId}@${safeStepIndex ?? 'na'}:${explicitOperation}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (launchSiteId) claimedLaunchSites.add(launchSiteId);
      const chainId = normalizeOptionalStepText(event.chainId) || normalizeOptionalStepText(stepForContext?.chainId);
      canonical.push({
        operation: explicitOperation,
        fromNodeId,
        toNodeId,
        traceNodeId,
        ...(chainId ? { chainId } : {}),
        stepIndex: safeStepIndex,
        note: typeof event.note === 'string' ? event.note : undefined
      });
    };

    rawEvents
      .filter((event) => isPlausibleRawMovementEvent(event, nodeById))
      .forEach((event) => {
        const stepIndex = Number(event?.stepIndex);
        const step = Number.isInteger(stepIndex) && stepIndex >= 0 && stepIndex < steps.length
          ? steps[stepIndex]
          : undefined;
        const op = normalizeMovementOperation(event?.operation) || 'Move';
        const grounded = op === 'HeadMove'
          ? event
          : groundMovementEvent({
              event,
              step,
              tree,
              nodeById,
              parentById
            });
        pushEvent(grounded, step);
      });

    return canonical.length > 0 ? canonical : undefined;
  };

  const cleanExplanationWhitespace = (text) => String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();

  const ensureExplanationTerminator = (text) => {
    const value = cleanExplanationWhitespace(text);
    if (!value) return '';
    return /[.!?]$/.test(value) ? value : `${value}.`;
  };

  const getNodeExplanationLabel = (node, { preserveIndex = false } = {}) => {
    const raw = String(node?.label || '').trim();
    if (!raw) return '';
    if (preserveIndex) return raw;
    const stripped = stripMovementIndex(raw);
    return stripped || raw;
  };

  const collectOvertYieldWords = (node, words = []) => {
    if (!node || typeof node !== 'object') return words;
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      const surface = String(resolveOvertLeafSurface(node) || '').trim();
      if (surface && !isTraceLikeNode(node) && !isNullLikeNode(node)) {
        words.push(surface);
      }
      return words;
    }
    children.forEach((child) => collectOvertYieldWords(child, words));
    return words;
  };

  const getNodeOvertYield = (node) => collectOvertYieldWords(node, []).join(' ').trim();

  const resolveMovementSiteNode = (nodeById, parentById, nodeId) => {
    const rawId = String(nodeId || '').trim();
    if (!rawId) return null;
    let current = nodeById.get(rawId) || null;
    if (!current) return null;
    if (!isTraceLikeNode(current) && !isNullLikeNode(current)) {
      return current;
    }
    let currentId = rawId;
    while (currentId) {
      const parentId = String(parentById.get(currentId) || '').trim();
      if (!parentId) break;
      const parent = nodeById.get(parentId) || null;
      if (!parent) break;
      const profile = getLabelProfile(parent?.label);
      if (profile.isHeadLikeStructural || profile.isPhrasal) {
        return parent;
      }
      currentId = parentId;
    }
    return current;
  };

  const getMovementDisplayLabel = (node, { preserveIndex = false } = {}) => {
    const label = getNodeExplanationLabel(node, { preserveIndex });
    if (label) return label;
    const surface = String(resolveOvertLeafSurface(node) || '').trim();
    return surface || '';
  };

  const normalizeMovementLabelKey = (label) =>
    String(label || '')
      .trim()
      .replace(/[_\s,.-]+/g, '')
      .toLowerCase();

  const resolveHeadMovementLandingNode = (node, nodeById, parentById) => {
    if (!node) return null;

    let current = node;
    let currentId = String(node.id || '').trim();
    let currentYield = getNodeOvertYield(current);

    while (currentId) {
      const parentId = String(parentById.get(currentId) || '').trim();
      if (!parentId) break;
      const parent = nodeById.get(parentId) || null;
      if (!parent) break;

      const profile = getLabelProfile(parent.label);
      if (!profile.isHeadLikeStructural) break;

      const parentYield = getNodeOvertYield(parent);
      if (!parentYield || !currentYield) break;
      if (normalizeMovementLabelKey(parentYield) !== normalizeMovementLabelKey(currentYield)) break;

      current = parent;
      currentId = parentId;
      currentYield = parentYield;
    }

    return current;
  };

  const buildMovedPhraseDescriptor = (node, { preserveIndex = false } = {}) => {
    if (!node) return '';
    const label = getMovementDisplayLabel(node, { preserveIndex });
    const overtYield = getNodeOvertYield(node);
    if (overtYield && overtYield.split(/\s+/).length <= 5) {
      if (label && normalizeMovementLabelKey(label) !== normalizeMovementLabelKey(overtYield)) {
        return `${label} "${overtYield}"`;
      }
      return `"${overtYield}"`;
    }
    return label;
  };

  const preferExplicitMovementSiteNode = (rawNode, resolvedNode, operation) => {
    if (operation === 'HeadMove') return resolvedNode || rawNode || null;
    if (rawNode) {
      const profile = getLabelProfile(rawNode?.label);
      if (profile.isPhrasal || profile.isHeadLikeStructural) {
        return rawNode;
      }
    }
    return resolvedNode || rawNode || null;
  };

  const buildMovementDetail = ({ event, nodeById, parentById }) => {
    const operation = normalizeMovementOperation(event?.operation) || 'Other';
    const phrase = MOVEMENT_OPERATION_PHRASE[operation] || 'movement';
    const rawSourceNode = nodeById.get(String(event?.fromNodeId || event?.traceNodeId || '').trim()) || null;
    const traceNode = nodeById.get(String(event?.traceNodeId || '').trim()) || null;
    const rawToNode = nodeById.get(String(event?.toNodeId || '').trim()) || null;
    const resolvedToNode = resolveMovementSiteNode(nodeById, parentById, event?.toNodeId) || null;
    const toNode = operation === 'HeadMove'
      ? resolveHeadMovementLandingNode(resolvedToNode, nodeById, parentById) || resolvedToNode
      : preferExplicitMovementSiteNode(rawToNode, resolvedToNode, operation);
    const note = cleanExplanationWhitespace(String(event?.note || ''));
    const resolvedSourceNode = rawSourceNode
      ? resolveMovementSiteNode(nodeById, parentById, event?.fromNodeId || event?.traceNodeId)
      : null;
    const sourceNode = preferExplicitMovementSiteNode(rawSourceNode, resolvedSourceNode, operation);

    const landingIndex = nodeMovementIndex(toNode);
    const sourceIndex = nodeMovementIndex(rawSourceNode) || nodeMovementIndex(traceNode);
    const sourceLabel = getMovementDisplayLabel(rawSourceNode, { preserveIndex: true });
    const landingLabel = getMovementDisplayLabel(toNode, { preserveIndex: true });
    const movedDescriptor = buildMovedPhraseDescriptor(toNode, { preserveIndex: true });

    if (operation === 'HeadMove') {
      const movedHeadSurface = getNodeOvertYield(toNode) || getNodeOvertYield(resolvedToNode);
      const movedHead = movedHeadSurface ? `"${movedHeadSurface}"` : buildMovedPhraseDescriptor(toNode);
      const landingHead = getMovementDisplayLabel(toNode);
      const sourceHead = getMovementDisplayLabel(sourceNode);
      const normalizedSourceHead = normalizeMovementLabelKey(sourceHead);
      const normalizedLandingHead = normalizeMovementLabelKey(landingHead);
      const directionalPhrase =
        normalizedSourceHead === 'c' && /^(?:infl|inflp|i|t)$/.test(normalizedLandingHead)
          ? 'lowering'
          : phrase;
      if (
        movedHead &&
        sourceHead &&
        landingHead &&
        normalizedSourceHead !== normalizedLandingHead
      ) {
        return `${directionalPhrase} of ${movedHead} from ${sourceHead} to ${landingHead}`;
      }
      if (movedHead && landingHead) {
        return `${directionalPhrase} of ${movedHead} to ${landingHead}`;
      }
      if (landingHead) {
        return `${directionalPhrase} to ${landingHead}`;
      }
    }

    if (toNode && landingIndex && (sourceIndex === landingIndex || isTraceLikeNode(rawSourceNode) || isNullLikeNode(rawSourceNode) || isTraceLikeNode(traceNode) || isNullLikeNode(traceNode))) {
      if (movedDescriptor) {
        return `${phrase} of ${movedDescriptor} from its lower copy`;
      }
      if (landingLabel) {
        return `${phrase} of ${landingLabel} from its lower copy`;
      }
    }

    if (
      operation === 'Move' &&
      sourceLabel &&
      landingLabel &&
      normalizeMovementLabelKey(sourceLabel) === normalizeMovementLabelKey(landingLabel)
    ) {
      if (movedDescriptor) {
        return `${phrase} of ${movedDescriptor} from its lower copy`;
      }
      return `${phrase} of ${landingLabel} from its lower copy`;
    }

    if (rawSourceNode && (isTraceLikeNode(rawSourceNode) || isNullLikeNode(rawSourceNode) || (traceNode && (isTraceLikeNode(traceNode) || isNullLikeNode(traceNode))))) {
      if (operation === 'Move' && movedDescriptor) {
        return `${phrase} of ${movedDescriptor} from its lower copy`;
      }
      const toLabel = getMovementDisplayLabel(toNode);
      if (toLabel) {
        return `${phrase} to ${toLabel}`;
      }
      if (note) {
        return `${phrase} (${note})`;
      }
      return phrase;
    }

    const fromNode = sourceNode;
    const fromLabel = getMovementDisplayLabel(fromNode);
    const toLabel = getMovementDisplayLabel(toNode);
    if (
      operation === 'Move' &&
      fromLabel &&
      toLabel &&
      normalizeMovementLabelKey(fromLabel) === normalizeMovementLabelKey(toLabel)
    ) {
      if (movedDescriptor) {
        return `${phrase} of ${movedDescriptor} from its lower copy`;
      }
      return `${phrase} of ${toLabel} from its lower copy`;
    }
    if (fromLabel && toLabel) {
      return `${phrase} from ${fromLabel} to ${toLabel}`;
    }
    if (note) {
      return `${phrase} (${note})`;
    }
    return phrase;
  };

  const summarizeGroundedMovement = (movementEvents, tree = null) => {
    if (!Array.isArray(movementEvents) || movementEvents.length === 0) return '';

    const nodeById = tree ? buildNodeIndexFromTree(tree) : null;
    const parentById = tree ? buildParentIndexFromTree(tree) : null;
    const eventDetails = movementEvents
      .map((event) => (nodeById && parentById ? buildMovementDetail({ event, nodeById, parentById }) : null))
      .map((detail) => cleanExplanationWhitespace(detail || ''))
      .filter(Boolean)
      .filter((detail, index, all) => all.indexOf(detail) === index)
      .filter(Boolean);
    if (eventDetails.length > 0) {
      return `The derivation explicitly records ${eventDetails.join('; ')}.`;
    }
    return 'The derivation explicitly records movement.';
  };

  const formatFeatureCheckingSummary = (item) => {
    const feature = String(item?.feature || '').trim();
    if (!feature) return '';
    const value = String(item?.value || '').trim();
    const status = String(item?.status || '').trim();
    const probe = String(item?.probeLabel || item?.probeNodeId || '').trim();
    const goal = String(item?.goalLabel || item?.goalNodeId || '').trim();

    const featureText = value ? `${feature}=${value}` : feature;
    const statusText = status ? ` (${status})` : '';

    if (probe && goal) {
      return `${featureText}${statusText} with ${probe} probing ${goal}`;
    }
    if (probe) {
      return `${featureText}${statusText} on ${probe}`;
    }
    if (goal) {
      return `${featureText}${statusText} targeting ${goal}`;
    }
    return `${featureText}${statusText}`;
  };

  const summarizeDerivationFacts = ({ derivationSteps }) => {
    const steps = Array.isArray(derivationSteps) ? derivationSteps : [];
    if (steps.length === 0) return '';

    const featureEvents = [];
    steps.forEach((step) => {
      const items = Array.isArray(step?.featureChecking) ? step.featureChecking : [];
      items.forEach((item) => {
        if (featureEvents.length >= 3) return;
        const summary = formatFeatureCheckingSummary(item);
        if (summary) featureEvents.push(summary);
      });
    });
    return featureEvents.length > 0
      ? `The derivation also records feature valuation involving ${featureEvents.join('; ')}.`
      : '';
  };

  const getClauseSpineInfo = (clauseNode) => {
    if (!clauseNode || typeof clauseNode !== 'object') {
      return {
        spineNode: null,
        headNode: null,
        complementNode: null
      };
    }

    const clauseChildren = Array.isArray(clauseNode.children) ? clauseNode.children : [];
    const clauseProfile = getLabelProfile(clauseNode.label);
    const sameBaseProjection = clauseChildren.find((child) => {
      const profile = getLabelProfile(child?.label);
      return profile.isPhrasal && profile.base === clauseProfile.base;
    });
    const spineNode = sameBaseProjection || clauseNode;
    const spineChildren = Array.isArray(spineNode?.children) ? spineNode.children : [];
    const headNode = spineChildren.find((child) => {
      const profile = getLabelProfile(child?.label);
      return profile.isHeadLikeStructural && ['c', 'q', 'wh'].includes(profile.base);
    }) || null;
    const complementNode = spineChildren.find((child) => {
      const profile = getLabelProfile(child?.label);
      return profile.isPhrasal && ['infl', 't', 'ip', 'v'].includes(profile.base);
    }) || null;

    return { spineNode, headNode, complementNode };
  };

  const findNearestOvertDescendant = (node, predicate) => {
    const queue = Array.isArray(node?.children) ? [...node.children] : [];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || typeof current !== 'object') continue;
      if (predicate(current) && subtreeHasOvertYield(current)) return current;
      const children = Array.isArray(current.children) ? current.children : [];
      queue.push(...children);
    }
    return null;
  };

  const findClauseCoreComplement = (node) =>
    findNearestOvertDescendant(node, (child) => {
      const profile = getLabelProfile(child?.label);
      return profile.isPhrasal && ['infl', 't', 'ip', 'v'].includes(profile.base);
    });

  const getOvertHeadSurfaceForExplanation = (node) => {
    if (!node || typeof node !== 'object') return '';
    const directSurface = String(resolveOvertLeafSurface(node) || '').trim();
    if (directSurface && !isTraceLikeNode(node) && !isNullLikeNode(node)) {
      return directSurface;
    }
    const overtHeadDescendant = findNearestOvertDescendant(node, (child) => {
      const profile = getLabelProfile(child?.label);
      return profile.isHeadLikeStructural;
    });
    const descendantYield = getNodeOvertYield(overtHeadDescendant);
    return descendantYield || getNodeOvertYield(node);
  };

  const collectDescendantNodes = (node, out = []) => {
    if (!node || typeof node !== 'object') return out;
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach((child) => {
      out.push(child);
      collectDescendantNodes(child, out);
    });
    return out;
  };

  const getMatrixClauseNode = (tree) => {
    const rootProfile = getLabelProfile(tree?.label);
    if (rootProfile.base === 'c' && rootProfile.isPhrasal) {
      const { headNode, complementNode } = getClauseSpineInfo(tree);
      return complementNode || findClauseCoreComplement(headNode) || tree;
    }
    return tree;
  };

  const getFrameworkLead = (framework) =>
    framework === 'minimalism'
      ? 'On the committed Minimalist analysis'
      : 'On the committed X-bar analysis';

  const labelRoleForExplanation = (profile) => {
    if (profile.base === 'q') return 'question element';
    if (profile.base === 'wh') return 'wh-element';
    if (profile.base === 'c') return 'left-peripheral head';
    if (profile.base === 'infl' || profile.base === 't' || profile.base === 'aux') return 'inflectional head';
    if (profile.base === 'v') return 'verbal head';
    if (profile.base === 'd') return 'determiner head';
    return 'head';
  };

  const buildClausalEdgeSentence = (tree) => {
    const rootProfile = getLabelProfile(tree?.label);
    if (!(rootProfile.base === 'c' && rootProfile.isPhrasal)) return '';

    const children = Array.isArray(tree?.children) ? tree.children : [];
    if (children.length < 2) return '';

    const leftChild = children[0];
    if (!subtreeHasOvertYield(leftChild)) return '';

    const leftProfile = getLabelProfile(leftChild?.label);
    if (!leftProfile.isPhrasal) return '';

    const leftYield = getNodeOvertYield(leftChild);
    const leftLabel = String(leftChild?.label || '').trim() || 'constituent';
    if (!leftYield) return '';

    return `At the left edge of the ${String(tree?.label || 'CP').trim() || 'CP'}, the ${leftLabel} "${leftYield}" occupies the initial peripheral position.`;
  };

  const buildRootArchitectureSentence = (tree, framework = 'xbar') => {
    const rootLabel = String(tree?.label || 'clause').trim() || 'clause';
    const rootProfile = getLabelProfile(rootLabel);
    const frameworkLead = getFrameworkLead(framework);
    const rootYield = getNodeOvertYield(tree);

    if (rootProfile.base === 'c' && rootProfile.isPhrasal) {
      const { headNode, complementNode } = getClauseSpineInfo(tree);
      const leftHead = headNode && subtreeHasOvertYield(headNode) ? headNode : null;
      const derivedComplement = !complementNode && leftHead ? findClauseCoreComplement(leftHead) : null;
      const complement = [complementNode, derivedComplement].find((node) => node && subtreeHasOvertYield(node)) || null;
      const headYield = getOvertHeadSurfaceForExplanation(leftHead);
      const headProfile = getLabelProfile(leftHead?.label);
      const complementLabel = getNodeExplanationLabel(complement);
      const interrogative = headProfile.base === 'q' || /[?؟]$/.test(rootYield);
      if (headYield && complementLabel) {
        const role = labelRoleForExplanation(headProfile);
        const clauseDescriptor = interrogative ? `an interrogative ${rootLabel}` : `a ${rootLabel}`;
        return `${frameworkLead}, the sentence is analyzed as ${clauseDescriptor}, with the overt ${role} "${headYield}" and a ${complementLabel} clausal core.`;
      }
      if (headYield) {
        const role = labelRoleForExplanation(headProfile);
        return `${frameworkLead}, the sentence is analyzed as a ${rootLabel} whose left periphery is overtly realized by the ${role} "${headYield}".`;
      }
      if (complementLabel) {
        return `${frameworkLead}, the sentence is analyzed as a ${rootLabel} dominating a ${complementLabel} as its finite core.`;
      }
    }

    if (rootProfile.isPhrasal) {
      return `${frameworkLead}, the clause is rooted in a ${rootLabel}.`;
    }

    return `${frameworkLead}, the committed structure is rooted in ${rootLabel}.`;
  };

  const buildMatrixOrganizationSentence = (tree) => {
    const clauseNode = getMatrixClauseNode(tree);

    if (!clauseNode || typeof clauseNode !== 'object') return '';

    const overtChildren = (Array.isArray(clauseNode.children) ? clauseNode.children : [])
      .filter((child) => subtreeHasOvertYield(child));
    const clauseLabel = String(clauseNode.label || '').trim() || 'clause';
    if (overtChildren.length === 0) return '';

    if (overtChildren.length === 1) {
      const onlyYield = getNodeOvertYield(overtChildren[0]);
      return onlyYield ? `Within the ${clauseLabel}, the overt material is confined to "${onlyYield}".` : '';
    }

    const leftChild = overtChildren[0];
    const leftYield = getNodeOvertYield(leftChild);
    const rightYield = overtChildren.slice(1).map(getNodeOvertYield).filter(Boolean).join(' ');
    if (!leftYield || !rightYield) return '';

    return `Within the matrix ${clauseLabel}, the left branch yields "${leftYield}", while the remaining material yields "${rightYield}".`;
  };

  const buildEmbeddedClauseSentence = (tree) => {
    const nodeById = buildNodeIndexFromTree(tree);
    const parentById = buildParentIndexFromTree(tree);
    const embeddedClauses = collectDescendantNodes(tree)
      .filter((node) => {
        const profile = getLabelProfile(node?.label);
        return profile.base === 'c' && profile.isPhrasal && /p$/i.test(String(node?.label || '').trim()) && subtreeHasOvertYield(node);
      });
    if (embeddedClauses.length === 0) return '';

    const embedded = embeddedClauses[0];
    const { headNode } = getClauseSpineInfo(embedded);
    const head = headNode && subtreeHasOvertYield(headNode) ? headNode : null;
    const headYield = getOvertHeadSurfaceForExplanation(head);
    const clauseYield = getNodeOvertYield(embedded);
    const embeddedLabel = getNodeExplanationLabel(embedded) || 'CP';
    const parent = nodeById.get(String(parentById.get(String(embedded?.id || '')) || ''));
    const parentProfile = getLabelProfile(parent?.label);
    if (headYield && clauseYield) {
      if (parentProfile.base === 'v') {
        return `The matrix predicate selects an embedded ${embeddedLabel} introduced by "${headYield}", yielding "${clauseYield}".`;
      }
      return `The analysis also contains an embedded ${embeddedLabel} introduced by "${headYield}", with overt yield "${clauseYield}".`;
    }
    if (clauseYield) {
      return `The analysis also contains an embedded ${embeddedLabel} with the overt yield "${clauseYield}".`;
    }
    return '';
  };

  const buildGroundedExplanation = ({ tree, derivationSteps, movementEvents, framework = 'xbar' }) => {
    const parts = [
      buildRootArchitectureSentence(tree, framework),
      buildClausalEdgeSentence(tree),
      buildMatrixOrganizationSentence(tree),
      buildEmbeddedClauseSentence(tree),
      summarizeDerivationFacts({ derivationSteps }),
      Array.isArray(movementEvents) && movementEvents.length > 0
        ? summarizeGroundedMovement(movementEvents, tree)
        : 'No displacement operation is encoded in the derivation.'
    ]
      .map((part) => ensureExplanationTerminator(part))
      .filter(Boolean);

    return ensureExplanationTerminator(parts.join(' '));
  };

  const buildCanonicalDerivationFromTree = ({
    tree,
    movementEvents,
    surfaceOrder,
    modelDerivationSteps
  }) => {
    const nodeById = buildNodeIndexFromTree(tree);
    const postorder = [];
    const visitPostorder = (node) => {
      if (!node || typeof node !== 'object') return;
      const children = Array.isArray(node.children) ? node.children : [];
      children.forEach(visitPostorder);
      postorder.push(node);
    };
    visitPostorder(tree);

    const existingSteps = Array.isArray(modelDerivationSteps) ? modelDerivationSteps : [];
    const structuralMetaByTarget = new Map();
    const movementStepMeta = [];
    let spelloutStepMeta = null;
    existingSteps.forEach((step) => {
      const targetNodeId = String(step?.targetNodeId || '').trim();
      const featureChecking = Array.isArray(step?.featureChecking) && step.featureChecking.length > 0
        ? step.featureChecking
        : undefined;
      const meta = {
        featureChecking,
        trigger: normalizeOptionalStepText(step?.trigger),
        chainId: normalizeOptionalStepText(step?.chainId),
        spelloutDomain: normalizeOptionalStepText(step?.spelloutDomain),
        note: normalizeOptionalStepText(step?.note),
        affectedNodeIds: Array.isArray(step?.affectedNodeIds) && step.affectedNodeIds.length > 0
          ? step.affectedNodeIds
          : undefined,
        preFeatures: normalizeOptionalStringArray(step?.preFeatures),
        postFeatures: normalizeOptionalStringArray(step?.postFeatures),
        thetaRole: normalizeOptionalStepText(step?.thetaRole),
        introducerHead: normalizeOptionalStepText(step?.introducerHead),
        phase: normalizeOptionalStepText(step?.phase),
        labelDecision: normalizeOptionalStepText(step?.labelDecision),
        linearizationEffect: normalizeOptionalStepText(step?.linearizationEffect),
        morphologyEffect: normalizeOptionalStepText(step?.morphologyEffect)
      };
      if (String(step?.operation || '').trim() === 'SpellOut') {
        spelloutStepMeta = meta;
        return;
      }
      if (isMoveLikeOperation(step?.operation)) {
        movementStepMeta.push(meta);
        return;
      }
      if (targetNodeId && !structuralMetaByTarget.has(targetNodeId)) {
        structuralMetaByTarget.set(targetNodeId, meta);
      }
    });

    const workspace = new Map();
    const derivationSteps = [];
    postorder.forEach((node) => {
      const nodeId = String(node.id || '').trim();
      const children = Array.isArray(node.children) ? node.children : [];
      const targetLabel = String(node.label || '').trim() || String(node.word || '').trim() || 'Node';
      const workspaceBefore = Array.from(workspace.values());

      if (children.length === 0) {
        const surface = resolveNodeSurface(node) || targetLabel;
        workspace.set(nodeId, targetLabel);
        const meta = structuralMetaByTarget.get(nodeId) || {};
        derivationSteps.push({
          operation: 'LexicalSelect',
          trigger: meta.trigger,
          chainId: meta.chainId,
          spelloutDomain: meta.spelloutDomain,
          affectedNodeIds: Array.from(new Set([...(meta.affectedNodeIds || []), nodeId].filter(Boolean))),
          preFeatures: meta.preFeatures,
          postFeatures: meta.postFeatures,
          thetaRole: meta.thetaRole,
          introducerHead: meta.introducerHead,
          phase: meta.phase,
          labelDecision: meta.labelDecision,
          linearizationEffect: meta.linearizationEffect,
          morphologyEffect: meta.morphologyEffect,
          targetNodeId: nodeId || undefined,
          targetLabel,
          sourceNodeIds: [],
          sourceLabels: [surface],
          recipe: `Select ${surface}`,
          workspaceBefore,
          workspaceAfter: Array.from(workspace.values()),
          featureChecking: meta.featureChecking,
          note: meta.note
        });
        return;
      }

      children.forEach((child) => {
        const childId = String(child?.id || '').trim();
        if (childId) workspace.delete(childId);
      });
      workspace.set(nodeId, targetLabel);
      const meta = structuralMetaByTarget.get(nodeId) || {};
      const sourceNodeIds = children
        .map((child) => String(child?.id || '').trim())
        .filter(Boolean);
      derivationSteps.push({
        operation: children.length === 1 ? 'Project' : 'ExternalMerge',
        trigger: meta.trigger,
        chainId: meta.chainId,
        spelloutDomain: meta.spelloutDomain,
        affectedNodeIds: Array.from(new Set([...(meta.affectedNodeIds || []), nodeId, ...sourceNodeIds].filter(Boolean))),
        preFeatures: meta.preFeatures,
        postFeatures: meta.postFeatures,
        thetaRole: meta.thetaRole,
        introducerHead: meta.introducerHead,
        phase: meta.phase,
        labelDecision: meta.labelDecision,
        linearizationEffect: meta.linearizationEffect,
        morphologyEffect: meta.morphologyEffect,
        targetNodeId: nodeId || undefined,
        targetLabel,
        sourceNodeIds,
        sourceLabels: children
          .map((child) => String(child?.label || child?.word || '').trim())
          .filter(Boolean),
        recipe: `${children
          .map((child) => String(child?.label || child?.word || '').trim())
          .filter(Boolean)
          .join(' + ')} -> ${targetLabel}`,
        workspaceBefore,
        workspaceAfter: Array.from(workspace.values()),
        featureChecking: meta.featureChecking,
        note: meta.note
      });
    });

    const rootLabel = String(tree?.label || 'Tree').trim() || 'Tree';
    const canonicalMovementEvents = Array.isArray(movementEvents) ? movementEvents : [];
    canonicalMovementEvents
      .slice()
      .sort((left, right) => {
        const a = Number(left?.stepIndex);
        const b = Number(right?.stepIndex);
        const safeA = Number.isInteger(a) ? a : Number.MAX_SAFE_INTEGER;
        const safeB = Number.isInteger(b) ? b : Number.MAX_SAFE_INTEGER;
        return safeA - safeB;
      })
      .forEach((event, index) => {
        const targetNodeId = String(event?.toNodeId || '').trim();
        const sourceNodeIds = Array.from(new Set([
          String(event?.fromNodeId || '').trim(),
          String(event?.traceNodeId || '').trim()
        ].filter(Boolean)));
        const meta = movementStepMeta[index] || {};
        const featureChecking = meta.featureChecking;
        const op = normalizeMovementOperation(event?.operation) || 'Move';
        const targetLabel = String(nodeById.get(targetNodeId)?.label || '').trim() || 'Move';
        const workspaceBefore = Array.from(workspace.values());
        const sourceLabels = sourceNodeIds
          .map((id) => {
            const node = nodeById.get(id);
            return resolveNodeSurface(node) || String(node?.label || '').trim();
          })
          .filter(Boolean);
        derivationSteps.push({
          operation: op,
          trigger: meta.trigger,
          chainId: meta.chainId,
          spelloutDomain: meta.spelloutDomain,
          affectedNodeIds: Array.from(new Set([...(meta.affectedNodeIds || []), targetNodeId, ...sourceNodeIds].filter(Boolean))),
          preFeatures: meta.preFeatures,
          postFeatures: meta.postFeatures,
          thetaRole: meta.thetaRole,
          introducerHead: meta.introducerHead,
          phase: meta.phase,
          labelDecision: meta.labelDecision,
          linearizationEffect: meta.linearizationEffect,
          morphologyEffect: meta.morphologyEffect,
          targetNodeId: targetNodeId || undefined,
          targetLabel,
          sourceNodeIds,
          sourceLabels,
          recipe: `${sourceLabels.join(' + ')} -> ${targetLabel}`,
          workspaceBefore,
          workspaceAfter: [rootLabel],
          featureChecking,
          note: typeof event?.note === 'string' ? event.note : meta.note
        });
      });

    derivationSteps.push({
      operation: 'SpellOut',
      trigger: spelloutStepMeta?.trigger,
      chainId: spelloutStepMeta?.chainId,
      spelloutDomain: spelloutStepMeta?.spelloutDomain || rootLabel,
      affectedNodeIds: String(tree?.id || '').trim() ? [String(tree.id).trim()] : undefined,
      preFeatures: spelloutStepMeta?.preFeatures,
      postFeatures: spelloutStepMeta?.postFeatures,
      thetaRole: spelloutStepMeta?.thetaRole,
      introducerHead: spelloutStepMeta?.introducerHead,
      phase: spelloutStepMeta?.phase,
      labelDecision: spelloutStepMeta?.labelDecision,
      linearizationEffect: spelloutStepMeta?.linearizationEffect,
      morphologyEffect: spelloutStepMeta?.morphologyEffect,
      targetNodeId: String(tree?.id || '').trim() || undefined,
      targetLabel: rootLabel,
      sourceNodeIds: String(tree?.id || '').trim() ? [String(tree.id).trim()] : undefined,
      sourceLabels: [rootLabel],
      recipe: `SpellOut(${rootLabel})`,
      workspaceBefore: Array.from(workspace.values()),
      workspaceAfter: [rootLabel],
      spelloutOrder: Array.isArray(surfaceOrder) ? surfaceOrder : undefined,
      note: Array.isArray(surfaceOrder) && surfaceOrder.length > 0
        ? `Committed surface order: ${surfaceOrder.join(' ')}`
        : 'Final spellout of the committed surface order.'
    });

    const movementStepIndexesByKey = new Map();
    derivationSteps.forEach((step, index) => {
      if (!isMoveLikeOperation(step?.operation)) return;
      const targetNodeId = String(step?.targetNodeId || '').trim();
      const sourceNodeIds = Array.isArray(step?.sourceNodeIds)
        ? step.sourceNodeIds.map((id) => String(id || '').trim()).filter(Boolean)
        : [];
      sourceNodeIds.forEach((sourceNodeId) => {
        movementStepIndexesByKey.set(`${sourceNodeId}->${targetNodeId}`, index);
      });
    });

    const movementEventsWithCanonicalSteps = canonicalMovementEvents.map((event) => {
      const fromNodeId = String(event?.fromNodeId || '').trim();
      const toNodeId = String(event?.toNodeId || '').trim();
      const traceNodeId = String(event?.traceNodeId || '').trim();
      const canonicalStepIndex =
        movementStepIndexesByKey.get(`${fromNodeId}->${toNodeId}`) ??
        (traceNodeId ? movementStepIndexesByKey.get(`${traceNodeId}->${toNodeId}`) : undefined);
      return {
        ...event,
        stepIndex: Number.isInteger(canonicalStepIndex) ? canonicalStepIndex : event?.stepIndex
      };
    });

    return {
      derivationSteps,
      movementEvents: movementEventsWithCanonicalSteps
    };
  };

  const harmonizeExplanationWithDerivation = (explanation, derivationSteps, movementEvents, tree, framework = 'xbar') => {
    const groundedFallback = buildGroundedExplanation({
      tree,
      derivationSteps,
      movementEvents,
      framework
    });
    const cleaned = cleanExplanationWhitespace(String(explanation || ''));
    if (!cleaned) return groundedFallback;
    return ensureExplanationTerminator(cleaned);
  };

  return {
    isMoveLikeOperation,
    buildNodeLabelIndexFromTree,
    normalizeMovementEvents,
    isAbstractFeatureSurface,
    cleanExplanationWhitespace,
    ensureExplanationTerminator,
    getNodeOvertYield,
    normalizeTraceLikeSurface,
    isNullLikeSurface,
    buildNodeIndexFromTree,
    buildParentIndexFromTree,
    collectLeafNodes,
    resolveNodeSurface,
    resolveOvertLeafSurface,
    isTraceLikeSurface,
    isTraceLikeNode,
    isNullLikeNode,
    subtreeContainsOnlyCovertCategoryLeaves,
    subtreeContainsNamedCovertCategoryLeaf,
    stripMovementIndicesFromTree,
    materializeEmptyStructuralLeaves,
    promoteSentenceMatchingLeaves,
    buildCanonicalMovementEvents,
    buildGroundedExplanation,
    buildCanonicalDerivationFromTree,
    harmonizeExplanationWithDerivation,
    getMovementDisplayLabel,
    normalizeMovementLabelKey,
    resolveHeadMovementLandingNode
  };
};
