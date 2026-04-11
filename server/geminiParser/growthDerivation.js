export const createGrowthDerivationHelpers = ({
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
  collapseOvertHeadLandingChains
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

  const normalizeGrowthTargetLabel = (label) =>
    String(label || '').trim().replace(/[\s']/g, '').toUpperCase();

  const isBroadProjectionLikeNode = (node) => {
    if (!node || typeof node !== 'object') return false;
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) return false;
    const normalized = normalizeGrowthTargetLabel(node.label);
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

  const inferMovementPairFromStateTransition = ({ previousForest, currentForest, operation, rawTargetId }) => {
    const previousOvertNodes = collectForestNodes(previousForest).filter((node) => subtreeHasOvertYield(node));
    const currentOvertNodes = collectForestNodes(currentForest).filter((node) => subtreeHasOvertYield(node));
    const rawTargetStem = normalizeMovementStemFromId(rawTargetId);

    let bestPair = null;
    let bestScore = -1;

    previousOvertNodes.forEach((previousNode) => {
      const previousYield = collectOvertYieldTokensFromNode(previousNode);
      const previousStem = normalizeMovementStemFromId(previousNode.id);
      if (normalizeMovementOperation(operation) !== 'HeadMove' && previousYield.length === 0) return;

      const landingCandidates = currentOvertNodes.filter((candidate) => {
        if (!categoriesCompatibleForMovement(operation, previousNode, candidate)) return false;
        if (normalizeMovementOperation(operation) === 'HeadMove') {
          if (previousYield.length === 0) return true;
          const candidateYield = collectOvertYieldTokensFromNode(candidate);
          return sameTokenSequence(candidateYield, previousYield);
        }
        return sameTokenSequence(collectOvertYieldTokensFromNode(candidate), previousYield);
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

  const materializeImplicitPhrasalTraceShellsInGrowthFrames = (growthFrames) => {
    if (!Array.isArray(growthFrames) || growthFrames.length === 0) return [];

    const normalizedFrames = [];

    growthFrames.forEach((frame) => {
      const nextFrame = {
        ...frame,
        workspaceForest: cloneSyntaxForest(frame?.workspaceForest)
      };

      const movement = nextFrame?.movement && typeof nextFrame.movement === 'object' ? nextFrame.movement : {};
      const operation = normalizeMovementOperation(movement.operation || nextFrame.operation);

      if (isMoveLikeOperation(operation) && operation !== 'HeadMove') {
        const traceId = String(movement.sourceNodeId || '').trim();
        const landingId = String(movement.targetNodeId || '').trim();
        const traceNode = traceId ? findNodeByIdInForest(nextFrame.workspaceForest, traceId) : null;
        const landingNode = landingId ? findNodeByIdInForest(nextFrame.workspaceForest, landingId) : null;
        const landingLabel = String(landingNode?.label || '').trim();
        const landingProfile = getLabelProfile(landingLabel);

        if (
          traceNode
          && landingNode
          && landingProfile.isPhrasal
          && (!Array.isArray(traceNode.children) || traceNode.children.length === 0)
          && (isTraceLikeNode(traceNode) || isNullLikeNode(traceNode) || isTraceOrNullOnlySubtree(traceNode))
        ) {
          const tracePath = findNodePathInForest(nextFrame.workspaceForest, traceId);
          const traceParent = getNodeAtForestPath(nextFrame.workspaceForest, Array.isArray(tracePath) ? tracePath.slice(0, -1) : null);
          const parentLabel = String(traceParent?.label || '').trim();

          if (parentLabel !== landingLabel) {
            replaceNodeAtForestPath(nextFrame.workspaceForest, tracePath, {
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

      const targetProfileForHead = getLabelProfile(targetLabel);
      const targetBase = String(targetProfileForHead.base || '').trim().toLowerCase();
      if (['c', 'q', 'wh'].includes(targetBase)) return 'Infl';
      if (['infl', 'i', 't', 'aux'].includes(targetBase)) return 'V';
    }

    const traceLabel = String(traceNode?.label || '').trim();
    return traceLabel;
  };

  const materializeCommittedTraceShells = (tree, movementEvents) => {
    if (!tree || typeof tree !== 'object' || !Array.isArray(movementEvents) || movementEvents.length === 0) {
      return tree;
    }

    const forest = [tree];
    movementEvents.forEach((event) => {
      const traceId = String(event?.traceNodeId || event?.fromNodeId || '').trim();
      const targetId = String(event?.toNodeId || '').trim();
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
      if (!shellLabel || shellLabel === String(traceNode.label || '').trim()) return;
      if (String(traceParent?.label || '').trim() === shellLabel) return;

      replaceNodeAtForestPath(forest, tracePath, {
        id: `${traceId}__shell`,
        label: shellLabel,
        children: [traceNode]
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

  const hasEarlierOvertHeadSourceEvidence = (growthFrames, landingNode) => {
    if (!Array.isArray(growthFrames) || growthFrames.length === 0 || !landingNode) return false;
    const preferredBases = preferredHeadMoveSourceBases(landingNode);
    if (preferredBases.length === 0) return false;
    const landingSurfaceStem = normalizeHeadTraceSurfaceStem(getNodeOvertYield(landingNode));
    if (!landingSurfaceStem) return false;

    for (const frame of growthFrames) {
      const forest = Array.isArray(frame?.workspaceForest) ? frame.workspaceForest : [];
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

  const inferSupplementalHeadMoveEventsFromGrowthFrames = (growthFrames, finalTree, existingMovementEvents = []) => {
    if (!Array.isArray(growthFrames) || growthFrames.length === 0 || !finalTree) return [];

    const nodeById = buildNodeIndexFromTree(finalTree);
    const parentById = buildParentIndexFromTree(finalTree);
    const existingKeys = new Set(
      (Array.isArray(existingMovementEvents) ? existingMovementEvents : [])
        .map((event) => {
          const op = normalizeMovementOperation(event?.operation);
          const fromNodeId = String(event?.fromNodeId || '').trim();
          const toNodeId = String(event?.toNodeId || '').trim();
          return op && fromNodeId && toNodeId ? `${op}:${fromNodeId}->${toNodeId}` : '';
        })
        .filter(Boolean)
    );

    const inferredEvents = [];
    const landingNodes = Array.from(nodeById.values()).filter((node) => {
      const profile = getLabelProfile(node?.label);
      if (!profile.isHeadLikeStructural) return false;
      if (!isSupplementalHeadMoveLandingBase(profile.base)) return false;
      if (!subtreeHasOvertYield(node)) return false;
      const overtSurface = String(getNodeOvertYield(node) || '').trim();
      if (!overtSurface || isTraceLikeSurface(overtSurface) || isNullLikeSurface(overtSurface)) return false;
      const resolvedLanding = resolveHeadMovementLandingNode(node, nodeById, parentById);
      return String(resolvedLanding?.id || '').trim() === String(node?.id || '').trim();
    });

    landingNodes.forEach((landingNode) => {
      const landingId = String(landingNode?.id || '').trim();
      if (!landingId) return;
      if (Array.isArray(existingMovementEvents)
        && existingMovementEvents.some((event) =>
          normalizeMovementOperation(event?.operation) === 'HeadMove'
          && String(event?.toNodeId || '').trim() === landingId
        )) {
        return;
      }

      if (!hasEarlierOvertHeadSourceEvidence(growthFrames, landingNode)) {
        return;
      }

      const preferredBases = preferredHeadMoveSourceBases(landingNode);
      const landingSurfaceStem = normalizeHeadTraceSurfaceStem(getNodeOvertYield(landingNode));
      const landingIdStem = normalizeMovementStemFromId(landingId);
      const candidates = collectComplementDomainHeadCandidates(landingNode, nodeById, parentById)
        .filter(({ node }) => {
          const candidateId = String(node?.id || '').trim();
          if (!candidateId || candidateId === landingId) return false;
          if (subtreeHasOvertYield(node)) return false;
          return Boolean(isTraceOrNullOnlySubtree(node) || pickTraceLikeLeaf(node));
        });

      let best = null;
      let bestScore = -1;
      candidates.forEach(({ node, domainDistance }) => {
        const candidateId = String(node?.id || '').trim();
        const candidateProfile = getLabelProfile(node?.label);
        const candidateLeaf = pickTraceLikeLeaf(node);
        const candidateLeafSurfaceStem = normalizeHeadTraceSurfaceStem(resolveNodeSurface(candidateLeaf || node));
        const candidateIdStem = normalizeMovementStemFromId(candidateId);
        let score = 0;
        const preferredIndex = preferredBases.indexOf(candidateProfile.base);
        if (preferredIndex >= 0) score += 240 - (preferredIndex * 20);
        score += Math.max(0, 90 - (domainDistance * 15));
        if (landingSurfaceStem && candidateLeafSurfaceStem && landingSurfaceStem === candidateLeafSurfaceStem) score += 120;
        else if (landingIdStem && candidateIdStem && landingIdStem === candidateIdStem) score += 80;
        else if (landingSurfaceStem && candidateIdStem && landingSurfaceStem === candidateIdStem) score += 60;
        if (candidateLeaf && isTraceLikeNode(candidateLeaf)) score += 20;
        if (candidateProfile.base === getLabelProfile(landingNode?.label).base) score -= 40;
        if (score > bestScore) {
          bestScore = score;
          best = { node, traceLeaf: candidateLeaf };
        }
      });

      if (!best || bestScore < 100) return;

      const sourceNodeId = String(best.node?.id || '').trim();
      const traceNodeId = String(best.traceLeaf?.id || '').trim() || undefined;
      const eventKey = `HeadMove:${sourceNodeId}->${landingId}`;
      if (!sourceNodeId || existingKeys.has(eventKey)) return;

      let stepIndex = growthFrames.length - 1;
      for (let frameIndex = 0; frameIndex < growthFrames.length; frameIndex += 1) {
        const forest = Array.isArray(growthFrames[frameIndex]?.workspaceForest) ? growthFrames[frameIndex].workspaceForest : [];
        const sourceNode = findNodeByIdInForest(forest, sourceNodeId);
        const targetNode = findNodeByIdInForest(forest, landingId);
        if (!sourceNode || !targetNode) continue;
        if (subtreeHasOvertYield(targetNode) && !subtreeHasOvertYield(sourceNode)) {
          stepIndex = frameIndex;
          break;
        }
      }

      existingKeys.add(eventKey);
      inferredEvents.push({
        operation: 'HeadMove',
        fromNodeId: sourceNodeId,
        toNodeId: landingId,
        traceNodeId,
        stepIndex,
        note: 'Head movement recovered from the committed Growth state.'
      });
    });

    return inferredEvents;
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

    node.word = overtSurface;
    delete node.children;
    delete node.surfaceSpan;
    return node;
  };

  const canonicalizeGrowthWorkspaceForest = (forest) => {
    const clonedForest = cloneSyntaxForestDeep(forest);
    clonedForest.forEach((root) => {
      collapseMalformedHeadMoveLandings(root);
      collapseOvertHeadLandingChains(root);
    });
    return clonedForest;
  };

  const shouldBackfillMovementCopy = (sourceNode, landingNode) => {
    if (!sourceNode || !landingNode) return false;
    const sourceYield = collectOvertYieldTokensFromNode(sourceNode);
    const landingYield = collectOvertYieldTokensFromNode(landingNode);
    if (landingYield.length === 0) return false;
    if (sameTokenSequence(sourceYield, landingYield)) return false;
    return sourceYield.length < landingYield.length;
  };

  const backfillOvertLowerCopiesFromMovement = (frames) => {
    if (!Array.isArray(frames) || frames.length === 0) return frames;

    for (let frameIndex = 1; frameIndex < frames.length; frameIndex += 1) {
      const frame = frames[frameIndex];
      const operation = normalizeMovementOperation(frame?.movement?.operation || frame?.operation);
      if (!operation || operation === 'headmove') continue;

      const rawSourceId = String(frame?.movement?.sourceNodeId || '').trim();
      if (!rawSourceId) continue;

      const landingNode = findOvertNodeByIdInForest(frame.workspaceForest, rawSourceId);
      if (!landingNode) continue;

      for (let backIndex = frameIndex - 1; backIndex >= 0; backIndex -= 1) {
        const sourcePath = findNodePathInForest(frames[backIndex].workspaceForest, rawSourceId);
        if (!sourcePath) break;
        const sourceNode = getNodeAtForestPath(frames[backIndex].workspaceForest, sourcePath);
        if (!sourceNode || String(sourceNode.id || '').trim() !== rawSourceId) break;
        if (!shouldBackfillMovementCopy(sourceNode, landingNode)) continue;
        replaceNodeAtForestPath(frames[backIndex].workspaceForest, sourcePath, cloneSyntaxNodeDeep(landingNode));
      }
    }

    return frames;
  };

  const canonicalizeGrowthFrames = (frames) => {
    if (!Array.isArray(frames) || frames.length === 0) return [];
    const clonedFrames = frames.map((frame) => ({
      ...frame,
      workspaceForest: canonicalizeGrowthWorkspaceForest(frame.workspaceForest)
    }));
    return backfillOvertLowerCopiesFromMovement(clonedFrames);
  };

  const normalizeGrowthFrames = (value, framework = 'xbar', sentenceTokens = []) => {
    if (!Array.isArray(value)) return [];
    let previousWorkspaceForest = null;
    const sentenceTokenSet = Array.isArray(sentenceTokens) && sentenceTokens.length > 0
      ? new Set(sentenceTokens.map((token) => normalizeSurfaceToken(token)).filter(Boolean))
      : null;

    const normalizedFrames = value
      .map((rawItem, frameIndex) => {
        const item = parseTransportJsonValue(rawItem);
        if (!item || typeof item !== 'object') return null;
        const operation = normalizeDerivationOperation(item.operation);
        if (!operation) return null;
        const reusePreviousWorkspace = item.reusePreviousWorkspace === true;
        const workspaceForestValue = normalizeWorkspaceForestInput(
          typeof item.workspaceForest !== 'undefined' ? item.workspaceForest : item.workspaceForestJson
        );

        const frameNodeIds = new Set();
        const counterRef = { value: 1 };
        let workspaceForest = [];
        if (workspaceForestValue.length > 0) {
          workspaceForest = workspaceForestValue
            .map((root, rootIndex) => normalizeSyntaxNode(root, frameNodeIds, counterRef, {
              nodeReferences: new Map(),
              resolvingIds: new Set(),
              framework,
              sentenceTokens,
              path: `frame[${frameIndex}].workspaceForest[${rootIndex}]`
            }))
            .filter(Boolean);
        } else if (reusePreviousWorkspace && Array.isArray(previousWorkspaceForest) && previousWorkspaceForest.length > 0) {
          workspaceForest = previousWorkspaceForest.map((root) => cloneSyntaxNodeDeep(root));
        }
        if (workspaceForest.length === 0) return null;
        workspaceForest.forEach((root) => {
          promoteSentenceMatchingLeaves(root, sentenceTokenSet);
          stripMovementIndicesFromTree(root);
          materializeEmptyStructuralLeaves(root, sentenceTokenSet);
        });
        const normalizedFrameNodeIds = new Set();
        workspaceForest.forEach((root) => {
          collectNodeReferencesById(root).forEach((_, nodeId) => {
            if (typeof nodeId === 'string' && nodeId.trim()) {
              normalizedFrameNodeIds.add(nodeId);
            }
          });
        });
        const previousFrameNodeIds = new Set();
        if (Array.isArray(previousWorkspaceForest) && previousWorkspaceForest.length > 0) {
          previousWorkspaceForest.forEach((root) => {
            collectNodeReferencesById(root).forEach((_, nodeId) => {
              if (typeof nodeId === 'string' && nodeId.trim()) {
                previousFrameNodeIds.add(nodeId);
              }
            });
          });
        }

        const movement = item.movement && typeof item.movement === 'object'
          ? (() => {
              const normalizedOperation = normalizeDerivationOperation(item.movement.operation);
              const sourceNodeId = String(item.movement.sourceNodeId || '').trim();
              const targetNodeId = String(item.movement.targetNodeId || '').trim();
              const note = normalizeOptionalStepText(item.movement.note);
              if (!normalizedOperation && !sourceNodeId && !targetNodeId && !note) return undefined;
              const normalizedTargetNodeId = (
                sourceNodeId && targetNodeId && sourceNodeId === targetNodeId
                  ? ''
                  : targetNodeId
              );
              return {
                operation: normalizedOperation || undefined,
                sourceNodeId:
                  sourceNodeId && (normalizedFrameNodeIds.has(sourceNodeId) || previousFrameNodeIds.has(sourceNodeId))
                    ? sourceNodeId
                    : undefined,
                targetNodeId:
                  normalizedTargetNodeId && normalizedFrameNodeIds.has(normalizedTargetNodeId)
                    ? normalizedTargetNodeId
                    : undefined,
                note
              };
            })()
          : undefined;

        if (isMoveLikeOperation(operation) && !movement) {
          throw new ParseApiError(
            'BAD_MODEL_RESPONSE',
            `Move-like Growth frame "${normalizeOptionalStepText(item.frameId) || `f${frameIndex + 1}`}" is missing its movement payload.`,
            502
          );
        }
        previousWorkspaceForest = workspaceForest.map((root) => cloneSyntaxNodeDeep(root));

        return {
          frameId: normalizeOptionalStepText(item.frameId) || `f${frameIndex + 1}`,
          stepId: normalizeOptionalStepText(item.stepId),
          operation,
          microOperations: Array.isArray(item.microOperations)
            ? item.microOperations
                .map((entry) => normalizeDerivationOperation(entry))
                .filter(Boolean)
            : undefined,
          affectedNodeIds: normalizeNodeIdArray(item.affectedNodeIds, normalizedFrameNodeIds),
          reusePreviousWorkspace: reusePreviousWorkspace || undefined,
          recipe: normalizeOptionalStepText(item.recipe),
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
          spelloutOrder: normalizeSpelloutOrder(item.spelloutOrder),
          featureChecking: normalizeFeatureChecking(item.featureChecking, frameNodeIds),
          note: normalizeOptionalStepText(item.note),
          movement,
          workspaceForest
        };
      })
      .filter(Boolean);

    return canonicalizeGrowthFrames(normalizedFrames);
  };

  const collectGrowthFrameNodeIds = (growthFrames) => {
    const nodeIds = new Set();
    if (!Array.isArray(growthFrames)) return nodeIds;
    growthFrames.forEach((frame) => {
      const forest = Array.isArray(frame?.workspaceForest) ? frame.workspaceForest : [];
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

  const collectOvertLeafReferences = (node, refs = []) => {
    if (!node || typeof node !== 'object') return refs;
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      const surface = String(resolveNodeSurface(node) || '').trim();
      if (surface && !isSilentLikeMovementNode(node)) {
        refs.push({
          node,
          surface: normalizeSurfaceToken(surface),
          hasTokenIndex: Number.isInteger(node.tokenIndex)
        });
      }
      return refs;
    }
    children.forEach((child) => collectOvertLeafReferences(child, refs));
    return refs;
  };

  const suppressExcessUntokenedHeadCopiesForSurfaceMatch = (root, sentenceTokens = []) => {
    if (!root || typeof root !== 'object') return root;
    const targetCounts = new Map();
    (Array.isArray(sentenceTokens) ? sentenceTokens : []).forEach((token) => {
      const normalized = normalizeSurfaceToken(token);
      if (!normalized) return;
      targetCounts.set(normalized, (targetCounts.get(normalized) || 0) + 1);
    });

    const refs = collectOvertLeafReferences(root);
    const currentCounts = new Map();
    refs.forEach(({ surface }) => {
      if (!surface) return;
      currentCounts.set(surface, (currentCounts.get(surface) || 0) + 1);
    });

    for (const [surface, currentCount] of currentCounts.entries()) {
      const allowedCount = targetCounts.get(surface) || 0;
      let excess = currentCount - allowedCount;
      if (excess <= 0) continue;
      const candidates = refs.filter((ref) => ref.surface === surface && !ref.hasTokenIndex);
      for (const candidate of candidates) {
        if (excess <= 0) break;
        candidate.node.label = '∅';
        delete candidate.node.word;
        delete candidate.node.tokenIndex;
        delete candidate.node.surfaceSpan;
        excess -= 1;
      }
    }

    return root;
  };

  const canonicalizeGrowthRootCandidateForSentence = (root, sentenceTokens = []) => {
    if (!root || typeof root !== 'object') return null;
    const targetTokens = Array.isArray(sentenceTokens)
      ? sentenceTokens.map((token) => String(token || '').trim()).filter(Boolean)
      : [];
    if (targetTokens.length === 0) return null;

    const candidate = cloneSyntaxNodeDeep(root);
    try {
      suppressExcessUntokenedHeadCopiesForSurfaceMatch(candidate, targetTokens);
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

  const scoreGrowthRootCandidateAgainstSentence = (root, sentenceTokens = []) => {
    if (!root || typeof root !== 'object') return { score: -1, candidate: null };
    const targetTokens = Array.isArray(sentenceTokens)
      ? sentenceTokens.map((token) => String(token || '').trim()).filter(Boolean)
      : [];
    if (targetTokens.length === 0) return { score: -1, candidate: null };

    const candidate = cloneSyntaxNodeDeep(root);
    try {
      suppressExcessUntokenedHeadCopiesForSurfaceMatch(candidate, targetTokens);
      anchorOvertLeavesToSentenceTokens(candidate, targetTokens);
      const canonicalCandidate = deriveCanonicalSurfaceSpans(candidate);
      const overtTerminals = collectOvertTerminalNodes(canonicalCandidate)
        .map((node) => resolveNodeSurface(node))
        .map((token) => String(token || '').trim())
        .filter(Boolean);
      let score = 0;
      const maxLength = Math.max(targetTokens.length, overtTerminals.length);
      for (let index = 0; index < maxLength; index += 1) {
        if (targetTokens[index] && overtTerminals[index] && targetTokens[index] === overtTerminals[index]) score += 1;
      }
      return { score, candidate: canonicalCandidate };
    } catch {
      return { score: -1, candidate: null };
    }
  };

  const explicitHeadMoveFrameCount = (growthFrames = [], frameIndex = -1) => {
    if (!Array.isArray(growthFrames) || growthFrames.length === 0) return 0;
    const upperBound = Number.isInteger(frameIndex) ? Math.min(frameIndex, growthFrames.length - 1) : (growthFrames.length - 1);
    let count = 0;
    for (let index = 0; index <= upperBound; index += 1) {
      const frame = growthFrames[index];
      if (normalizeMovementOperation(frame?.movement?.operation || frame?.operation) === 'HeadMove') {
        count += 1;
      }
    }
    return count;
  };

  const replaceHeadRealizationForSurfaceMatch = (landingNode, sourceNode) => {
    if (!landingNode || !sourceNode) return false;
    const usedIds = collectExistingNodeIds(landingNode);
    collectExistingNodeIds(sourceNode).forEach((id) => usedIds.add(id));
    const counterRef = { value: usedIds.size + 1 };
    const nextId = () => nextGeneratedNodeId(usedIds, counterRef);

    const movedChildren = Array.isArray(sourceNode.children) && sourceNode.children.length > 0
      ? sourceNode.children.map((child) => cloneSyntaxNodeDeep(child))
      : [];
    if (movedChildren.length === 0) return false;

    delete landingNode.word;
    delete landingNode.tokenIndex;
    delete landingNode.surfaceSpan;
    landingNode.children = movedChildren;

    delete sourceNode.word;
    delete sourceNode.tokenIndex;
    delete sourceNode.surfaceSpan;
    sourceNode.children = [{
      id: nextId(),
      label: '∅',
      word: '∅'
    }];
    return true;
  };

  const applyOneCompressedHeadMoveForSurfaceMatch = (root, sentenceTokens = []) => {
    if (!root || typeof root !== 'object') return null;
    const targetTokens = Array.isArray(sentenceTokens)
      ? sentenceTokens.map((token) => String(token || '').trim()).filter(Boolean)
      : [];
    if (targetTokens.length === 0) return null;

    const nodeById = buildNodeIndexFromTree(root);
    const parentById = buildParentIndexFromTree(root);
    const currentScore = scoreGrowthRootCandidateAgainstSentence(root, targetTokens).score;
    let bestRoot = null;
    let bestScore = currentScore;

    const landingNodes = Array.from(nodeById.values()).filter((node) => {
      const profile = getLabelProfile(node?.label);
      if (!profile.isHeadLikeStructural) return false;
      if (preferredHeadMoveSourceBases(node).length === 0) return false;
      return !subtreeHasOvertYield(node);
    });

    landingNodes.forEach((landingNode) => {
      const preferredBases = preferredHeadMoveSourceBases(landingNode);
      if (preferredBases.length === 0) return;
      const candidates = collectComplementDomainHeadCandidates(landingNode, nodeById, parentById)
        .filter(({ node: sourceNode }) => {
          if (!sourceNode || !subtreeHasOvertYield(sourceNode)) return false;
          const base = getLabelProfile(sourceNode?.label).base;
          return preferredBases.includes(base);
        });

      candidates.forEach(({ node: sourceNode, domainDistance }) => {
        const trialRoot = cloneSyntaxNodeDeep(root);
        const trialLanding = findNodeByIdInForest([trialRoot], String(landingNode.id || '').trim());
        const trialSource = findNodeByIdInForest([trialRoot], String(sourceNode.id || '').trim());
        if (!trialLanding || !trialSource) return;
        if (!replaceHeadRealizationForSurfaceMatch(trialLanding, trialSource)) return;
        const { score, candidate } = scoreGrowthRootCandidateAgainstSentence(trialRoot, targetTokens);
        if (!candidate) return;
        const weightedScore = score - domainDistance;
        if (weightedScore > bestScore) {
          bestScore = weightedScore;
          bestRoot = candidate;
        }
      });
    });

    return bestRoot;
  };

  const selectCommittedGrowthRoot = (workspaceForest, sentenceTokens = [], options = {}) => {
    if (!Array.isArray(workspaceForest) || workspaceForest.length === 0) return null;
    const targetTokens = Array.isArray(sentenceTokens)
      ? sentenceTokens.map((token) => String(token || '').trim()).filter(Boolean)
      : [];
    if (targetTokens.length === 0) return null;
    const headMoveBudget = Math.max(0, Number.isInteger(options?.headMoveBudget) ? options.headMoveBudget : 0);

    const candidates = workspaceForest
      .map((root) => {
        if (!root || typeof root !== 'object') return null;
        const direct = canonicalizeGrowthRootCandidateForSentence(root, targetTokens);
        if (direct) return direct;
        if (headMoveBudget <= 0) return null;

        let transformed = cloneSyntaxNodeDeep(root);
        for (let attempt = 0; attempt < headMoveBudget; attempt += 1) {
          const next = applyOneCompressedHeadMoveForSurfaceMatch(transformed, targetTokens);
          if (!next) break;
          transformed = next;
          const committed = canonicalizeGrowthRootCandidateForSentence(transformed, targetTokens);
          if (committed) return committed;
        }
        return null;
      })
      .filter(Boolean);

    return candidates.length === 1 ? candidates[0] : null;
  };

  const findLatestCommittedGrowthFrame = (growthFrames, sentenceTokens = []) => {
    if (!Array.isArray(growthFrames) || growthFrames.length === 0) return null;
    for (let index = growthFrames.length - 1; index >= 0; index -= 1) {
      const frame = growthFrames[index];
      const root = selectCommittedGrowthRoot(frame?.workspaceForest, sentenceTokens, {
        headMoveBudget: explicitHeadMoveFrameCount(growthFrames, index)
      });
      if (root) {
        return { frame, frameIndex: index, root };
      }
    }
    return null;
  };

  const buildCanonicalMovementEventsFromGrowthFrames = (growthFrames, finalTree) => {
    if (!Array.isArray(growthFrames) || growthFrames.length === 0 || !finalTree) return [];
    const committedNodeById = buildNodeIndexFromTree(finalTree);
    const committedParentById = buildParentIndexFromTree(finalTree);
    const committedTreeNodeIds = new Set(committedNodeById.keys());
    const committedNodeIds = new Set([
      ...committedTreeNodeIds,
      ...collectGrowthFrameNodeIds(growthFrames)
    ]);
    const isCompatibleSilentSourceReplacement = (operation, previousSourceNode, candidateNode, rawSourceId = '') => {
      if (!candidateNode || typeof candidateNode !== 'object') return false;
      const normalizedOperation = normalizeMovementOperation(operation);
      const candidateIsSilentLike = isSilentLikeMovementNode(candidateNode);
      const candidateIsExplicitTraceLike = (
        isTraceLikeNode(candidateNode)
        || isNullLikeNode(candidateNode)
        || isTraceOrNullOnlySubtree(candidateNode)
      );
      const rawSourceStem = normalizeMovementStemFromId(rawSourceId);
      const candidateStem = normalizeMovementStemFromId(candidateNode.id);
      const stemsMatch = Boolean(
        rawSourceStem
        && candidateStem
        && (
          candidateStem === rawSourceStem
          || candidateStem.includes(rawSourceStem)
          || rawSourceStem.includes(candidateStem)
        )
      );
      const rawSourceIdText = String(rawSourceId || '').trim();
      const candidateIdText = String(candidateNode.id || '').trim();
      if (
        !candidateIsSilentLike
        && subtreeHasOvertYield(candidateNode)
      ) {
        return false;
      }
      if (previousSourceNode && !categoriesCompatibleForMovement(operation, previousSourceNode, candidateNode)) {
        const phrasalTraceProxy = (
          normalizedOperation !== 'HeadMove'
          && candidateIsExplicitTraceLike
          && stemsMatch
        );
        if (!phrasalTraceProxy) return false;
      }
      if (candidateIsSilentLike) {
        if (
          normalizedOperation === 'HeadMove'
          && candidateIsExplicitTraceLike
          && previousSourceNode
          && getLabelProfile(previousSourceNode.label).isHeadLikeStructural
          && (
            candidateIdText === rawSourceIdText
            || stemsMatch
            || movementCategoryKey(previousSourceNode) === movementCategoryKey(candidateNode)
          )
        ) {
          return true;
        }
        if (normalizedOperation === 'HeadMove') return true;
        if (!candidateIsExplicitTraceLike) return false;
        if (!rawSourceStem) return true;
        if (!candidateStem) return true;
        return stemsMatch;
      }
      if (!rawSourceStem) return true;
      if (!candidateStem) return candidateIsExplicitTraceLike;
      return stemsMatch;
    };

    const resolveTraceCandidateFromAffectedIds = (frame, currentForest, operation) => {
      const affectedIds = Array.isArray(frame?.affectedNodeIds)
        ? frame.affectedNodeIds
            .map((value) => String(value || '').trim())
            .filter(Boolean)
        : [];
      if (affectedIds.length === 0) return null;

      const affectedNodes = affectedIds
        .map((id) => findNodeByIdInForest(currentForest, id))
        .filter(Boolean);
      const traceLikeNodes = affectedNodes.filter((node) =>
        isTraceLikeNode(node) || isNullLikeNode(node) || isTraceOrNullOnlySubtree(node) || !subtreeHasOvertYield(node)
      );
      if (traceLikeNodes.length === 0) return null;

      const op = normalizeMovementOperation(operation);
      if (op === 'HeadMove') {
        return traceLikeNodes.find((node) => /trace|copy/i.test(String(node?.id || '').trim()))
          || traceLikeNodes[0];
      }

      return traceLikeNodes.find((node) => /trace|copy|^t\d*$|^t_/i.test(String(node?.id || '').trim()))
        || traceLikeNodes[0];
    };

    const resolveSourceTraceNode = (previousForest, currentForest, rawSourceId, operation) => {
      const previousSourcePath = findNodePathInForest(previousForest, rawSourceId);
      const previousSourceNode = getNodeAtForestPath(previousForest, previousSourcePath);
      const normalizedOperation = normalizeMovementOperation(operation);
      const currentSourceNode = findNodeByIdInForest(currentForest, rawSourceId);
      if (isCompatibleSilentSourceReplacement(operation, previousSourceNode, currentSourceNode, rawSourceId)) {
        return currentSourceNode;
      }
      const replacementNode = getNodeAtForestPath(currentForest, previousSourcePath);
      if (replacementNode && String(replacementNode.id || '').trim() !== rawSourceId) {
        if (isCompatibleSilentSourceReplacement(operation, previousSourceNode, replacementNode, rawSourceId)) {
          return replacementNode;
        }
      }
      const previousParentPath = Array.isArray(previousSourcePath) ? previousSourcePath.slice(0, -1) : null;
      const previousChildIndex = Array.isArray(previousSourcePath) && previousSourcePath.length > 0
        ? previousSourcePath[previousSourcePath.length - 1]
        : null;
      const previousParentNode = getNodeAtForestPath(previousForest, previousParentPath);
      const currentParentNode = previousParentNode
        ? findNodeByIdInForest(currentForest, String(previousParentNode.id || '').trim())
        : null;
      if (currentParentNode && Array.isArray(currentParentNode.children) && currentParentNode.children.length > 0) {
        const directCandidate = Number.isInteger(previousChildIndex)
          ? currentParentNode.children[previousChildIndex]
          : null;
        const directExplicitTraceReplacement = (
          normalizedOperation !== 'HeadMove'
          && directCandidate
          && String(directCandidate.id || '').trim() !== rawSourceId
          && isExplicitTraceReplacementNode(directCandidate)
        );
        if (directExplicitTraceReplacement) {
          return directCandidate;
        }
        const directLooksLikeTrace = directCandidate
          && String(directCandidate.id || '').trim() !== rawSourceId
          && isCompatibleSilentSourceReplacement(operation, previousSourceNode, directCandidate, rawSourceId);
        if (directLooksLikeTrace) {
          return directCandidate;
        }

        const expectedLabel = String(previousSourceNode?.label || '').trim();
        const siblingCandidate = currentParentNode.children.find((child) =>
          String(child?.id || '').trim() !== rawSourceId
          && (!expectedLabel || String(child?.label || '').trim() === expectedLabel)
          && isCompatibleSilentSourceReplacement(operation, previousSourceNode, child, rawSourceId)
        );
        if (siblingCandidate) {
          return siblingCandidate;
        }
        const explicitTraceSibling = normalizedOperation !== 'HeadMove'
          ? currentParentNode.children.find((child) =>
              String(child?.id || '').trim() !== rawSourceId
              && isExplicitTraceReplacementNode(child)
            )
          : null;
        if (explicitTraceSibling) {
          return explicitTraceSibling;
        }
      }
      return resolveTraceCandidateByStructuralContext(previousForest, currentForest, rawSourceId, operation);
    };

    const resolveLandingNode = (operation, previousForest, currentForest, rawSourceId, rawTargetId) => {
      const currentSourceNode = findOvertNodeByIdInForest(currentForest, rawSourceId);
      const currentTargetNode = findNodeByIdInForest(currentForest, rawTargetId);

      if (normalizeMovementOperation(operation) === 'HeadMove') {
        const previousTargetPath = findNodePathInForest(previousForest, rawTargetId);
        const targetAtSamePath = getNodeAtForestPath(currentForest, previousTargetPath);
        if (targetAtSamePath && subtreeHasOvertYield(targetAtSamePath)) {
          return targetAtSamePath;
        }
        if (currentTargetNode && subtreeHasOvertYield(currentTargetNode)) {
          return currentTargetNode;
        }
        return currentSourceNode || currentTargetNode || null;
      }

      if (currentSourceNode) {
        return currentSourceNode;
      }
      if (currentTargetNode && !isBroadProjectionLikeNode(currentTargetNode) && subtreeHasOvertYield(currentTargetNode)) {
        return currentTargetNode;
      }
      return currentTargetNode || null;
    };

    return growthFrames
      .map((frame, index) => {
        const movement = frame?.movement && typeof frame.movement === 'object' ? frame.movement : {};
        const operation = normalizeMovementOperation(movement.operation || frame.operation);
        if (!isMoveLikeOperation(operation)) return null;
        const rawSourceId = String(movement.sourceNodeId || '').trim();
        const rawTargetId = String(movement.targetNodeId || '').trim();
        if (operation === 'HeadMove' && !rawTargetId) {
          return null;
        }

        const previousForest = index > 0 && Array.isArray(growthFrames[index - 1]?.workspaceForest)
          ? growthFrames[index - 1].workspaceForest
          : [];
        const currentForest = Array.isArray(frame.workspaceForest) ? frame.workspaceForest : [];
        let landingNode = resolveLandingNode(operation, previousForest, currentForest, rawSourceId, rawTargetId);
        let sourceTraceNode = rawSourceId
          ? resolveSourceTraceNode(previousForest, currentForest, rawSourceId, operation)
          : (
            resolveTraceCandidateFromAffectedIds(frame, currentForest, operation)
            || findTraceReplacementForLandingCopy(previousForest, currentForest, landingNode)
          );

        if (!sourceTraceNode && landingNode) {
          sourceTraceNode = findTraceCandidateByStem(currentForest, landingNode, operation);
        }

        if ((!landingNode || !sourceTraceNode) && previousForest.length > 0 && currentForest.length > 0) {
          const inferredPair = inferMovementPairFromStateTransition({
            previousForest,
            currentForest,
            operation,
            rawTargetId
          });
          if (!landingNode && inferredPair?.landingNode) landingNode = inferredPair.landingNode;
          if (!sourceTraceNode && inferredPair?.sourceTraceNode) sourceTraceNode = inferredPair.sourceTraceNode;
        }

        let committedLandingNode = landingNode;
        const provisionalLandingId = String(landingNode?.id || rawTargetId || '').trim();
        if (
          provisionalLandingId
          && !committedTreeNodeIds.has(provisionalLandingId)
          && currentForest.length > 0
        ) {
          const committedReplacement = resolveSourceTraceNode(
            currentForest,
            [finalTree],
            provisionalLandingId,
            operation
          );
          if (committedReplacement) {
            committedLandingNode = committedReplacement;
          }
        }

        if (normalizeMovementOperation(operation) === 'HeadMove' && committedLandingNode) {
          committedLandingNode = resolveHeadMovementLandingNode(
            committedLandingNode,
            committedNodeById,
            committedParentById
          ) || committedLandingNode;
        }

        const fromNodeId = String(sourceTraceNode?.id || rawSourceId || '').trim();
        const toNodeId = String(committedLandingNode?.id || rawTargetId || '').trim();
        const traceNodeId = String(sourceTraceNode?.id || '').trim() || undefined;
        const sourceIsCovertOnly = sourceTraceNode
          && !subtreeHasOvertYield(sourceTraceNode)
          && subtreeContainsOnlyCovertCategoryLeaves(sourceTraceNode);
        const landingIsCovertOnly = committedLandingNode
          && !subtreeHasOvertYield(committedLandingNode)
          && subtreeContainsOnlyCovertCategoryLeaves(committedLandingNode);
        const sourceHasNamedCovertLeaf = sourceTraceNode && subtreeContainsNamedCovertCategoryLeaf(sourceTraceNode);
        const landingHasNamedCovertLeaf = committedLandingNode && subtreeContainsNamedCovertCategoryLeaf(committedLandingNode);

        if (!fromNodeId || !toNodeId) return null;
        if (!committedNodeIds.has(fromNodeId) || !committedNodeIds.has(toNodeId) || fromNodeId === toNodeId) return null;
        if (
          operation !== 'HeadMove'
          && sourceIsCovertOnly
          && landingIsCovertOnly
          && (sourceHasNamedCovertLeaf || landingHasNamedCovertLeaf)
        ) {
          return null;
        }
        const chainId = normalizeOptionalStepText(movement.chainId) || normalizeOptionalStepText(frame.chainId);
        return {
          operation,
          fromNodeId,
          toNodeId,
          traceNodeId,
          ...(chainId ? { chainId } : {}),
          stepIndex: index,
          note: normalizeOptionalStepText(movement.note) || normalizeOptionalStepText(frame.note) || normalizeOptionalStepText(frame.recipe)
        };
      })
      .filter(Boolean);
  };

  const buildCanonicalDerivationFromGrowthFrames = (growthFrames, sentenceTokens = [], framework = 'xbar') => {
    if (!Array.isArray(growthFrames) || growthFrames.length === 0) return null;

    const committedFrameInfo = findLatestCommittedGrowthFrame(growthFrames, sentenceTokens);
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

    const derivationSteps = growthFrames.map((frame, index) => {
      const workspaceLabels = Array.isArray(frame?.workspaceForest)
        ? frame.workspaceForest
            .map((node) => String(node?.label || node?.word || '').trim())
            .filter(Boolean)
        : [];
      const workspaceNodeById = new Map();
      if (Array.isArray(frame?.workspaceForest)) {
        frame.workspaceForest.forEach((root) => {
          collectNodeReferencesById(root).forEach((node, nodeId) => {
            workspaceNodeById.set(nodeId, node);
          });
        });
      }
      const candidateRoot = selectCommittedGrowthRoot(frame?.workspaceForest || [], sentenceTokens, {
        headMoveBudget: explicitHeadMoveFrameCount(growthFrames, index)
      })
        || (Array.isArray(frame?.workspaceForest) && frame.workspaceForest.length === 1 ? frame.workspaceForest[0] : null);
      const movement = frame?.movement;
      const movementTargetNodeId = String(movement?.targetNodeId || '').trim();
      const movementTargetNode = movementTargetNodeId
        ? workspaceNodeById.get(movementTargetNodeId) || null
        : null;
      const isMoveFrame = isMoveLikeOperation(frame?.operation);
      const targetNodeId = isMoveFrame
        ? (movementTargetNodeId || String(candidateRoot?.id || '').trim() || undefined)
        : (String(candidateRoot?.id || '').trim() || undefined);
      const targetLabel = isMoveFrame
        ? (String(movementTargetNode?.label || '').trim() || String(candidateRoot?.label || '').trim() || undefined)
        : (String(candidateRoot?.label || '').trim() || undefined);
      const sourceNodeIds = [];
      if (String(movement?.sourceNodeId || '').trim()) sourceNodeIds.push(String(movement.sourceNodeId).trim());
      return {
        stepId: normalizeOptionalStepText(frame.stepId) || `gf${index + 1}`,
        operation: frame.operation,
        affectedNodeIds: normalizeNodeIdArray(frame.affectedNodeIds, finalNodeIds),
        trigger: normalizeOptionalStepText(frame.trigger),
        chainId: normalizeOptionalStepText(frame.chainId),
        spelloutDomain: normalizeOptionalStepText(frame.spelloutDomain),
        preFeatures: normalizeOptionalStringArray(frame.preFeatures),
        postFeatures: normalizeOptionalStringArray(frame.postFeatures),
        thetaRole: normalizeOptionalStepText(frame.thetaRole),
        introducerHead: normalizeOptionalStepText(frame.introducerHead),
        phase: normalizeOptionalStepText(frame.phase),
        labelDecision: normalizeOptionalStepText(frame.labelDecision),
        linearizationEffect: normalizeOptionalStepText(frame.linearizationEffect),
        morphologyEffect: normalizeOptionalStepText(frame.morphologyEffect),
        targetNodeId,
        targetLabel,
        sourceNodeIds: sourceNodeIds.length > 0 ? sourceNodeIds : undefined,
        sourceLabels: workspaceLabels.length > 0 ? workspaceLabels : undefined,
        recipe: normalizeOptionalStepText(frame.recipe) || `${frame.operation} frame ${index + 1}`,
        workspaceAfter: workspaceLabels.length > 0 ? workspaceLabels : undefined,
        spelloutOrder: Array.isArray(frame?.spelloutOrder) && frame.spelloutOrder.length > 0
          ? frame.spelloutOrder
          : undefined,
        featureChecking: Array.isArray(frame?.featureChecking) && frame.featureChecking.length > 0
          ? frame.featureChecking
          : undefined,
        note: normalizeOptionalStepText(frame.note)
      };
    });

    const explicitMovementEvents = buildCanonicalMovementEventsFromGrowthFrames(growthFrames, committedTree);
    const supplementalHeadMoves = inferSupplementalHeadMoveEventsFromGrowthFrames(
      growthFrames,
      committedTree,
      explicitMovementEvents
    );
    const movementEvents = [...explicitMovementEvents, ...supplementalHeadMoves].sort((left, right) => {
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
        note: 'Final spellout of the committed Growth state.'
      });
    }

    return {
      tree: committedTree,
      surfaceOrder,
      derivationSteps,
      movementEvents
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
    normalizeGrowthFrames,
    normalizeMovementStemFromId,
    materializeImplicitPhrasalTraceShellsInGrowthFrames,
    materializeCommittedTraceShells,
    inferSupplementalHeadMoveEventsFromGrowthFrames,
    collectGrowthFrameNodeIds,
    canonicalizeGrowthRootCandidateForSentence,
    selectCommittedGrowthRoot,
    findLatestCommittedGrowthFrame,
    buildCanonicalMovementEventsFromGrowthFrames,
    buildCanonicalDerivationFromGrowthFrames,
    assignDerivationStepIds,
    suppressExcessUntokenedHeadCopiesForSurfaceMatch
  };
};
