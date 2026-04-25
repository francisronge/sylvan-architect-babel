import {
  tokenizeSentenceSurfaceOrder,
  normalizeSurfaceToken
} from './surfaceTokens.js';
import {
  FORBIDDEN_STRING_LEAF_TOKENS,
  PRIME_CATEGORY_LABEL_RE,
  PRIME_MARK_RE,
  nextGeneratedNodeId,
  canonicalizeCovertSurface,
  canonicalizeBareNullHeadChildren,
  collectNodeReferencesById,
  normalizeLabelForFramework,
  normalizeSurfaceSpan,
  normalizeTokenIndex,
  normalizeSingletonTokenHint,
  normalizeOptionalMetadataText,
  normalizeOptionalMetadataBoolean,
  normalizeExplicitSurfaceWord,
  parseIndexedSurfaceLeaf,
  looksLikeSyntaxNodeObject,
  getLabelProfile
} from './treeBasics.js';

export const createSyntaxTreeHelpers = ({
  ParseApiError,
  normalizeOptionalStepText,
  normalizeNodeIdArray,
  normalizeMovementOperation,
  resolveNodeSurface,
  resolveOvertLeafSurface,
  isAbstractFeatureSurface,
  isTraceLikeSurface,
  isNullLikeSurface,
  isTraceLikeNode,
  isNullLikeNode,
  collectLeafNodes,
  buildNodeIndexFromTree,
  buildParentIndexFromTree,
  normalizeMovementLabelKey
}) => {
  const isPhrasalLabel = (label) => {
    const raw = String(label || '').trim();
    if (!raw) return false;
    if (PRIME_CATEGORY_LABEL_RE.test(raw)) return true;
    return /p$/i.test(raw);
  };

  const cloneReferencedSyntaxSubtree = (node, usedIds, counterRef, currentPath, isRoot = false) => {
    if (!node || typeof node !== 'object') return node;
    const cloned = { ...node };
    const nodeId = String(node.id || '').trim();
    if (nodeId) {
      if (usedIds.has(nodeId)) {
        cloned.id = nextGeneratedNodeId(usedIds, counterRef);
      } else {
        usedIds.add(nodeId);
      }
    }
    if (Array.isArray(node.children)) {
      cloned.children = node.children.map((child, childIndex) => (
        cloneReferencedSyntaxSubtree(
          child,
          usedIds,
          counterRef,
          `${currentPath}.children[${childIndex}]`,
          false
        )
      ));
    }
    return cloned;
  };

  const resolveReferencedSyntaxSubtree = (referenceId, usedIds, counterRef, context, currentPath) => {
    const normalizedReferenceId = String(referenceId || '').trim();
    if (!normalizedReferenceId) {
      throw new ParseApiError(
        'BAD_MODEL_RESPONSE',
        `Malformed tree node from model at ${currentPath} (empty refId).`,
        502
      );
    }
    const referencedNode =
      context?.subtreeReferences?.get(normalizedReferenceId)
      || context?.nodeReferences?.get(normalizedReferenceId);
    if (!referencedNode) {
      throw new ParseApiError(
        'BAD_MODEL_RESPONSE',
        `Malformed tree node from model at ${currentPath} (unresolved subtree refId: ${normalizedReferenceId}).`,
        502
      );
    }
    return cloneReferencedSyntaxSubtree(
      referencedNode,
      usedIds,
      counterRef,
      currentPath,
      true
    );
  };

  // Empty heads such as Voice/T/v are structural placeholders until an overt
  // word lands in them. Do not count them as sentence material.
  const isBareEmptyStructuralHeadLeaf = (node) => {
    if (!node || typeof node !== 'object') return false;
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length > 0) return false;
    if (String(node.word || '').trim()) return false;
    if (normalizeTokenIndex(node.tokenIndex, Number.POSITIVE_INFINITY) !== undefined) return false;
    if (normalizeSurfaceSpan(node.surfaceSpan)) return false;
    if (isTraceLikeNode(node) || isNullLikeNode(node)) return false;
    const rawLabel = String(node.label || '').trim();
    const profile = getLabelProfile(rawLabel);
    if (!profile.isHeadLikeStructural) return false;
    return rawLabel === rawLabel.toUpperCase() || /^[A-Z]/.test(rawLabel) || /^[cvtdnpaqi]$/i.test(rawLabel);
  };

  const normalizeSyntaxNode = (value, usedIds, counterRef, context) => {
    const currentPath = String(context?.path || 'root');
    if (typeof value === 'string') {
      const token = value.trim();
      if (!token) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          'Malformed tree node from model (empty string leaf).',
          502
        );
      }
      if (/^n\d+$/i.test(token)) {
        const referencedNode = context?.nodeReferences?.get(token);
        if (referencedNode) {
          if (context.resolvingIds.has(token)) {
            throw new ParseApiError(
              'BAD_MODEL_RESPONSE',
              `Malformed tree node from model (cyclic node reference: ${token}).`,
              502
            );
          }
          context.resolvingIds.add(token);
          try {
            return normalizeSyntaxNode(referencedNode, usedIds, counterRef, context);
          } finally {
            context.resolvingIds.delete(token);
          }
        }
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          `Malformed tree node from model (unresolved node-id reference: ${token}).`,
          502
        );
      }
      if (FORBIDDEN_STRING_LEAF_TOKENS.has(token.toLowerCase())) {
        throw new ParseApiError(
          'BAD_MODEL_RESPONSE',
          `Malformed tree node from model at ${currentPath} (metadata token leaked into leaves: ${token}).`,
          502
        );
      }
      const id = nextGeneratedNodeId(usedIds, counterRef);
      const indexedSurface = parseIndexedSurfaceLeaf(token, context?.sentenceTokens?.length);
      if (indexedSurface) {
        return {
          id,
          label: indexedSurface.word,
          word: indexedSurface.word,
          tokenIndex: indexedSurface.tokenIndex
        };
      }
      return { id, label: token, word: token };
    }

    if (Array.isArray(value)) {
      throw new ParseApiError(
        'BAD_MODEL_RESPONSE',
        `Malformed tree node from model at ${currentPath} (array node where object node was required).`,
        502
      );
    }

    if (!value || typeof value !== 'object') {
      throw new ParseApiError('BAD_MODEL_RESPONSE', `Malformed structural components from model at ${currentPath}.`, 502);
    }

    const node = value;
    const refId = typeof node.refId === 'string'
      ? node.refId.trim()
      : (typeof node.subtreeRefId === 'string' ? node.subtreeRefId.trim() : '');
    if (refId) {
      return resolveReferencedSyntaxSubtree(refId, usedIds, counterRef, context, currentPath);
    }
    const explicitWord = normalizeExplicitSurfaceWord(node);
    const indexedExplicitWord = parseIndexedSurfaceLeaf(explicitWord, context?.sentenceTokens?.length);
    const canonicalExplicitWord = canonicalizeCovertSurface(indexedExplicitWord?.word || explicitWord);
    const rawNodeLabel = typeof node.label === 'string' && node.label.trim()
      ? node.label.trim()
      : '';
    const indexedLabelWord = parseIndexedSurfaceLeaf(rawNodeLabel, context?.sentenceTokens?.length);
    const rawLabel = rawNodeLabel
      ? (/^word$/i.test(rawNodeLabel) && canonicalExplicitWord
          ? canonicalExplicitWord
          : canonicalizeCovertSurface(indexedLabelWord?.word || rawNodeLabel))
      : canonicalExplicitWord;
    const label = normalizeLabelForFramework(rawLabel, context.framework);
    if (!label) {
      throw new ParseApiError('BAD_MODEL_RESPONSE', `Malformed structural components from model at ${currentPath}.`, 502);
    }

    const requestedId = typeof node.id === 'string'
      ? node.id.trim()
      : (typeof node.nodeId === 'string' ? node.nodeId.trim() : '');
    let id = requestedId;
    if (!id || usedIds.has(id)) {
      id = nextGeneratedNodeId(usedIds, counterRef);
    } else {
      usedIds.add(id);
    }

    const normalized = { id, label };
    const lineageId = normalizeOptionalMetadataText(
      node.lineageId
      || node.lineage
      || node.copyLineageId
      || node.movementLineageId
      || (
        node.identity
        && typeof node.identity === 'object'
        && !Array.isArray(node.identity)
          ? (node.identity.lineageId || node.identity.lineage)
          : undefined
      )
    );
    if (lineageId) normalized.lineageId = lineageId;
    const explicitSilent = normalizeOptionalMetadataBoolean(node.silent);
    if (explicitSilent !== undefined) {
      // Growth frames may author lower copies as ordinary leaves with silent:true.
      // Preserve that flag so overt-token anchoring does not later reinterpret them as pronounced material.
      normalized.silent = explicitSilent;
    }
    if (node.silentFeature === true) {
      normalized.silentFeature = true;
    }
    const caseValue = normalizeOptionalMetadataText(node.case);
    const assigner = normalizeOptionalMetadataText(node.assigner);
    const caseEvidence = normalizeOptionalMetadataText(node.caseEvidence);
    const caseOvert = normalizeOptionalMetadataBoolean(node.caseOvert);
    if (caseValue) normalized.case = caseValue;
    if (assigner) normalized.assigner = assigner;
    if (caseEvidence) normalized.caseEvidence = caseEvidence;
    if (caseOvert !== undefined) normalized.caseOvert = caseOvert;
    const surfaceSpan = normalizeSurfaceSpan(node.surfaceSpan);
    if (surfaceSpan) normalized.surfaceSpan = surfaceSpan;

    const tokenIndex = normalizeTokenIndex(node.tokenIndex, context?.sentenceTokens?.length)
      ?? normalizeSingletonTokenHint(node.tokens, context?.sentenceTokens?.length)
      ?? indexedExplicitWord?.tokenIndex
      ?? indexedLabelWord?.tokenIndex;
    if (tokenIndex !== undefined) normalized.tokenIndex = tokenIndex;

    const hintedSurfaceWord = (
      tokenIndex !== undefined &&
      Array.isArray(context?.sentenceTokens) &&
      context.sentenceTokens[tokenIndex]
    )
      ? String(context.sentenceTokens[tokenIndex] || '').trim()
      : '';
    const terminalWord = canonicalExplicitWord || indexedLabelWord?.word || hintedSurfaceWord;
    const rawChildren = Array.isArray(node.children)
      ? node.children.map((child, childIndex) => normalizeSyntaxNode(child, usedIds, counterRef, {
          ...context,
          path: `${currentPath}.children[${childIndex}]`
        }))
      : [];
    const children = canonicalizeBareNullHeadChildren(label, rawChildren, usedIds, counterRef);

    if (children.length > 0) {
      normalized.children = children;
    } else if (terminalWord) {
      normalized.word = terminalWord;
    }

    return normalized;
  };

  const normalizeSyntaxTreeWithIds = (value, nodeReferences = new Map(), framework = 'xbar', sentenceTokens = []) => {
    const nodeIds = new Set();
    const counterRef = { value: 1 };
    const tree = normalizeSyntaxNode(value, nodeIds, counterRef, {
      nodeReferences,
      resolvingIds: new Set(),
      framework,
      sentenceTokens,
      path: 'root'
    });
    return { tree, nodeIds };
  };

  const sameTokenSequence = (leftTokens, rightTokens) => {
    if (leftTokens.length !== rightTokens.length) return false;
    for (let index = 0; index < leftTokens.length; index += 1) {
      if (normalizeSurfaceToken(leftTokens[index]) !== normalizeSurfaceToken(rightTokens[index])) {
        return false;
      }
    }
    return true;
  };

  const subtreeHasOvertYield = (node) => {
    if (!node || typeof node !== 'object') return false;
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      const surface = normalizeSurfaceToken(resolveOvertLeafSurface(node));
      return Boolean(surface) && !isTraceLikeNode(node) && !isNullLikeNode(node) && !isBareEmptyStructuralHeadLeaf(node);
    }
    return children.some((child) => subtreeHasOvertYield(child));
  };

  const alignCompiledTreeToSentence = (tree, sentenceTokens = []) => {
    const normalizedSentenceTokens = sentenceTokens.map(normalizeSurfaceToken).filter(Boolean);

    const permutationsOf = (items) => {
      if (items.length <= 1) return [items];
      const out = [];
      items.forEach((item, index) => {
        const rest = items.slice(0, index).concat(items.slice(index + 1));
        permutationsOf(rest).forEach((suffix) => out.push([item, ...suffix]));
      });
      return out;
    };

    const explicitOrder = (children) =>
      children
        .slice()
        .sort((left, right) => {
          const leftOrder = Number.isInteger(left?.siblingOrder) ? left.siblingOrder : undefined;
          const rightOrder = Number.isInteger(right?.siblingOrder) ? right.siblingOrder : undefined;
          if (leftOrder === undefined && rightOrder === undefined) return 0;
          if (leftOrder === undefined) return 1;
          if (rightOrder === undefined) return -1;
          return leftOrder - rightOrder;
        });

    const tokenBounds = (node) => {
      if (!node || typeof node !== 'object') return null;
      if (Number.isInteger(node.tokenIndex)) return [node.tokenIndex, node.tokenIndex];
      const children = Array.isArray(node.children) ? node.children : [];
      let start = null;
      let end = null;
      children.forEach((child) => {
        const bounds = tokenBounds(child);
        if (!bounds) return;
        start = start === null ? bounds[0] : Math.min(start, bounds[0]);
        end = end === null ? bounds[1] : Math.max(end, bounds[1]);
      });
      return start === null || end === null ? null : [start, end];
    };

    const flattenHeadInitialShells = (node) => {
      if (!node || typeof node !== 'object') return node;
      const children = Array.isArray(node.children)
        ? node.children.map((child) => flattenHeadInitialShells(child))
        : [];
      if (children.length === 0) return node;

      let flattenedChildren = children;
      if (children.length === 2) {
        const [specifierChild, shellChild] = children;
        const shellChildren = Array.isArray(shellChild?.children) ? shellChild.children : [];
        if (shellChildren.length === 2) {
          const [headChild, complementChild] = shellChildren;
          const specifierBounds = tokenBounds(specifierChild);
          const headBounds = tokenBounds(headChild);
          const complementBounds = tokenBounds(complementChild);
          const headProfile = getLabelProfile(headChild?.label);
          if (
            headProfile.isHeadLikeStructural &&
            specifierBounds &&
            headBounds &&
            complementBounds &&
            headBounds[0] < specifierBounds[0] &&
            specifierBounds[1] < complementBounds[0]
          ) {
            flattenedChildren = [headChild, specifierChild, complementChild];
          }
        }
      }

      return { ...node, children: flattenedChildren };
    };

    const flattenInterleavingChildren = (node) => {
      if (!node || typeof node !== 'object') return node;
      let children = Array.isArray(node.children)
        ? node.children.map((child) => flattenInterleavingChildren(child))
        : [];
      if (children.length <= 1) return { ...node, children };

      let changed = true;
      while (changed) {
        changed = false;
        for (let index = 0; index < children.length; index += 1) {
          const child = children[index];
          const childBounds = tokenBounds(child);
          const grandChildren = Array.isArray(child?.children) ? child.children : [];
          if (!childBounds || grandChildren.length === 0) continue;

          const containsSibling = children.some((sibling, siblingIndex) => {
            if (siblingIndex === index) return false;
            const siblingBounds = tokenBounds(sibling);
            if (!siblingBounds) return false;
            return childBounds[0] < siblingBounds[0] && siblingBounds[1] < childBounds[1];
          });

          if (!containsSibling) continue;

          children = [
            ...children.slice(0, index),
            ...grandChildren,
            ...children.slice(index + 1)
          ];
          changed = true;
          break;
        }
      }

      return { ...node, children };
    };

    const preparedTree = flattenInterleavingChildren(flattenHeadInitialShells(tree));

    const alignNode = (node, startIndex) => {
      if (!node || typeof node !== 'object') {
        throw new ParseApiError('BAD_MODEL_RESPONSE', 'Malformed tree node during flat-node sentence alignment.', 502);
      }

      const children = Array.isArray(node.children) ? node.children : [];
      if (children.length === 0) {
        const surface = normalizeSurfaceToken(resolveOvertLeafSurface(node));
        if (!surface || isTraceLikeNode(node) || isNullLikeNode(node) || isBareEmptyStructuralHeadLeaf(node)) {
          const silentLeaf = { ...node };
          delete silentLeaf.tokenIndex;
          delete silentLeaf.surfaceSpan;
          return { success: true, node: silentLeaf, nextIndex: startIndex, overtCount: 0 };
        }

        if (startIndex >= normalizedSentenceTokens.length || normalizedSentenceTokens[startIndex] !== surface) {
          return { success: false };
        }

        const overtLeaf = {
          ...node,
          word: String(sentenceTokens[startIndex] || resolveOvertLeafSurface(node) || '').trim(),
          tokenIndex: startIndex,
          surfaceSpan: [startIndex, startIndex]
        };
        return { success: true, node: overtLeaf, nextIndex: startIndex + 1, overtCount: 1 };
      }

      const orderedChildren = explicitOrder(children);
      const candidateOrders = [orderedChildren];
      const seenOrders = new Set([
        orderedChildren.map((child) => String(child?.id || '')).join('|')
      ]);

      const tryCandidate = (candidate) => {
        let nextIndex = startIndex;
        let overtCount = 0;
        const builtChildren = [];

        for (const child of candidate) {
          const alignedChild = alignNode(child, nextIndex);
          if (!alignedChild.success) return null;
          nextIndex = alignedChild.nextIndex;
          overtCount += alignedChild.overtCount;
          builtChildren.push(alignedChild.node);
        }

        const alignedNode = { ...node, children: builtChildren };
        if (overtCount > 0) alignedNode.surfaceSpan = [startIndex, nextIndex - 1];
        else delete alignedNode.surfaceSpan;
        return { success: true, node: alignedNode, nextIndex, overtCount };
      };

      for (const candidate of candidateOrders) {
        const alignedCandidate = tryCandidate(candidate);
        if (alignedCandidate) return alignedCandidate;
      }

      for (const candidate of permutationsOf(children)) {
        const key = candidate.map((child) => String(child?.id || '')).join('|');
        if (seenOrders.has(key)) continue;
        seenOrders.add(key);
        const alignedCandidate = tryCandidate(candidate);
        if (alignedCandidate) return alignedCandidate;
      }

      return { success: false };
    };

    const aligned = alignNode(preparedTree, 0);
    if (!aligned.success || aligned.nextIndex !== normalizedSentenceTokens.length) {
      throw new ParseApiError('BAD_MODEL_RESPONSE', 'Tree overt terminals do not match the input sentence order.', 502);
    }
    return aligned.node;
  };

  const collectOvertTerminalNodes = (tree) => {
    const terminals = [];
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      const children = Array.isArray(node.children) ? node.children : [];
      if (children.length === 0) {
        const surface = normalizeSurfaceToken(resolveOvertLeafSurface(node));
        if (surface && !isTraceLikeNode(node) && !isNullLikeNode(node) && !isBareEmptyStructuralHeadLeaf(node)) terminals.push(node);
        return;
      }
      children.forEach(visit);
    };
    visit(tree);
    return terminals;
  };

  const isTraceOrNullOnlySubtree = (node) => {
    if (!node || typeof node !== 'object') return false;
    const leaves = collectLeafNodes(node);
    if (leaves.length === 0) return false;
    return leaves.every((leaf) => {
      const surface = resolveNodeSurface(leaf);
      return isTraceLikeSurface(surface) || isNullLikeSurface(surface);
    });
  };

  const anchorOvertLeavesToSentenceTokens = (tree, sentenceTokens) => {
    const normalizedSentenceTokens = sentenceTokens.map(normalizeSurfaceToken).filter(Boolean);
    const sentenceTokenSet = new Set(normalizedSentenceTokens);
    const overtLeaves = [];

    const visit = (node) => {
      if (!node || typeof node !== 'object') {
        throw new ParseApiError('BAD_MODEL_RESPONSE', 'Malformed tree node during token anchoring.', 502);
      }

      const children = Array.isArray(node.children) ? node.children : [];
      if (children.length === 0) {
        let surface = normalizeSurfaceToken(resolveOvertLeafSurface(node));
        const traceLike = isTraceLikeNode(node);
        const nullLike = isNullLikeNode(node);
        const bareEmptyStructuralHead = isBareEmptyStructuralHeadLeaf(node);
        const tokenIndex = normalizeTokenIndex(node.tokenIndex, normalizedSentenceTokens.length);
        const singletonSpan = normalizeSurfaceSpan(node.surfaceSpan);
        const spanTokenIndex = singletonSpan && singletonSpan[0] === singletonSpan[1]
          ? normalizeTokenIndex(singletonSpan[0], normalizedSentenceTokens.length)
          : undefined;
        const hintedTokenIndex = tokenIndex ?? spanTokenIndex;

        if (!surface && hintedTokenIndex !== undefined && !bareEmptyStructuralHead) {
          const hintedSurface = normalizedSentenceTokens[hintedTokenIndex];
          const labelSurface = normalizeSurfaceToken(String(node.label || '').trim());
          if (hintedSurface && labelSurface === hintedSurface && !traceLike && !nullLike) {
            surface = hintedSurface;
            node.word = String(sentenceTokens[hintedTokenIndex] || '').trim();
          }
        }

        if (tokenIndex !== undefined) {
          if (traceLike || nullLike || bareEmptyStructuralHead) {
            delete node.tokenIndex;
          } else {
            const expectedToken = normalizedSentenceTokens[tokenIndex];
            if (!expectedToken) {
              throw new ParseApiError('BAD_MODEL_RESPONSE', 'Overt tokenIndex falls outside the sentence token inventory.', 502);
            }
            if (surface && surface !== expectedToken) {
              throw new ParseApiError('BAD_MODEL_RESPONSE', 'Leaf tokenIndex does not match the overt sentence token it claims to realize.', 502);
            }
            node.tokenIndex = tokenIndex;
            node.word = String(sentenceTokens[tokenIndex] || '').trim();
            overtLeaves.push(node);
            return;
          }
        }

        delete node.tokenIndex;
        if (
          surface &&
          !traceLike &&
          !nullLike &&
          !bareEmptyStructuralHead &&
          !(isAbstractFeatureSurface(surface) && !sentenceTokenSet.has(surface))
        ) {
          overtLeaves.push(node);
        } else if (surface && isAbstractFeatureSurface(surface) && !sentenceTokenSet.has(surface)) {
          node.silentFeature = true;
        }
        return;
      }

      children.forEach(visit);
    };

    visit(tree);

    const traversalOrder = overtLeaves
      .map((node) => normalizeSurfaceToken(resolveOvertLeafSurface(node)))
      .filter(Boolean);
    if (!sameTokenSequence(traversalOrder, normalizedSentenceTokens)) {
      throw new ParseApiError('BAD_MODEL_RESPONSE', 'Tree overt terminals do not match the input sentence order.', 502);
    }

    overtLeaves.forEach((node, index) => {
      node.tokenIndex = index;
      node.word = String(sentenceTokens[index] || '').trim();
    });
  };

  const deriveCanonicalSurfaceSpans = (tree) => {
    const visit = (node) => {
      if (!node || typeof node !== 'object') {
        throw new ParseApiError('BAD_MODEL_RESPONSE', 'Malformed tree node during surface-span normalization.', 502);
      }

      const children = Array.isArray(node.children) ? node.children : [];
      if (children.length === 0) {
        const surface = normalizeSurfaceToken(resolveOvertLeafSurface(node));
        const overt = Boolean(surface) && !isTraceLikeNode(node) && !isNullLikeNode(node) && !isBareEmptyStructuralHeadLeaf(node);
        if (!overt) {
          delete node.surfaceSpan;
          return null;
        }

        const tokenIndex = normalizeTokenIndex(node.tokenIndex, Number.POSITIVE_INFINITY);
        if (tokenIndex === undefined) {
          throw new ParseApiError('BAD_MODEL_RESPONSE', 'Overt leaves must carry tokenIndex after sentence anchoring.', 502);
        }
        node.surfaceSpan = [tokenIndex, tokenIndex];
        return node.surfaceSpan;
      }

      const childSpans = [];
      children.forEach((child) => {
        const childSpan = visit(child);
        if (childSpan) childSpans.push(childSpan);
      });

      if (childSpans.length === 0) {
        delete node.surfaceSpan;
        return null;
      }

      for (let index = 1; index < childSpans.length; index += 1) {
        if (childSpans[index - 1][0] > childSpans[index][0]) {
          throw new ParseApiError('BAD_MODEL_RESPONSE', 'Children arrays do not follow ascending surface-span order.', 502);
        }
      }

      node.surfaceSpan = [childSpans[0][0], childSpans[childSpans.length - 1][1]];
      return node.surfaceSpan;
    };

    visit(tree);
    return tree;
  };

  const collectCollapsedHeadLandingLeaf = (node) => {
    if (!node || typeof node !== 'object') return null;
    const profile = getLabelProfile(node.label);
    if (!profile.isHeadLikeStructural) return null;

    const removed = [node];
    let current = node;

    while (current && typeof current === 'object') {
      const children = Array.isArray(current.children) ? current.children : [];
      if (children.length === 0) {
        const surface = String(resolveOvertLeafSurface(current) || '').trim();
        if (!surface || isTraceLikeNode(current) || isNullLikeNode(current) || isBareEmptyStructuralHeadLeaf(current)) return null;
        return {
          surface,
          keptLeafId: String(current.id || '').trim(),
          lineageId: normalizeOptionalMetadataText(current.lineageId),
          tokenIndex: Number.isInteger(current.tokenIndex) ? current.tokenIndex : undefined,
          surfaceSpan: normalizeSurfaceSpan(current.surfaceSpan),
          removed
        };
      }
      if (children.length !== 1) return null;
      const child = children[0];
      if (!child || typeof child !== 'object') return null;
      removed.push(child);

      const childChildren = Array.isArray(child.children) ? child.children : [];
      if (childChildren.length === 0) {
        const surface = String(resolveOvertLeafSurface(child) || '').trim();
        if (!surface || isTraceLikeNode(child) || isNullLikeNode(child) || isBareEmptyStructuralHeadLeaf(child)) return null;
        return {
          surface,
          keptLeafId: String(child.id || '').trim(),
          lineageId: normalizeOptionalMetadataText(child.lineageId || current.lineageId),
          tokenIndex: Number.isInteger(child.tokenIndex) ? child.tokenIndex : undefined,
          surfaceSpan: normalizeSurfaceSpan(child.surfaceSpan),
          removed
        };
      }

      const childProfile = getLabelProfile(child.label);
      if (!childProfile.isHeadLikeStructural) return null;
      current = child;
    }

    return null;
  };

  const collapseOvertHeadLandingChains = (tree) => {
    const redirects = new Map();

    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      const children = Array.isArray(node.children) ? node.children : [];
      children.forEach(visit);

      const profile = getLabelProfile(node.label);
      if (!profile.isHeadLikeStructural) return;
      if (children.length !== 1) return;

      const child = children[0];
      const collapsed = collectCollapsedHeadLandingLeaf(child);
      if (!collapsed) return;

      const surface = String(collapsed.surface || '').trim();
      if (!surface) return;

      const directLeafId = collapsed.keptLeafId || `${String(node.id || 'node').trim() || 'node'}__lex`;
      const overtLeaf = { id: directLeafId, label: surface, word: surface };
      if (collapsed.lineageId) overtLeaf.lineageId = collapsed.lineageId;
      if (collapsed.tokenIndex !== undefined) overtLeaf.tokenIndex = collapsed.tokenIndex;
      if (collapsed.surfaceSpan) overtLeaf.surfaceSpan = collapsed.surfaceSpan;
      node.children = [overtLeaf];
      delete node.word;
      delete node.surfaceSpan;

      const parentId = String(node.id || '').trim();
      collapsed.removed.forEach((removedNode) => {
        const removedId = String(removedNode?.id || '').trim();
        if (!removedId || !parentId || removedId === parentId || removedId === directLeafId) return;
        redirects.set(removedId, parentId);
      });
    };

    visit(tree);
    return redirects;
  };

  const collectExistingNodeIds = (tree) => {
    const ids = new Set();
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      const id = String(node.id || '').trim();
      if (id) ids.add(id);
      const children = Array.isArray(node.children) ? node.children : [];
      children.forEach(visit);
    };
    visit(tree);
    return ids;
  };

  const validateAndCommitSurfaceOrder = (_surfaceOrder, tree, sentence) => {
    const sentenceTokens = tokenizeSentenceSurfaceOrder(sentence);
    anchorOvertLeavesToSentenceTokens(tree, sentenceTokens);
    const canonicalTree = deriveCanonicalSurfaceSpans(tree);
    const surfaceOrder = collectOvertTerminalNodes(canonicalTree)
      .map((node) => resolveNodeSurface(node))
      .map((token) => String(token || '').trim())
      .filter(Boolean);

    return {
      tree: canonicalTree,
      surfaceOrder: surfaceOrder.length > 0 ? surfaceOrder : sentenceTokens
    };
  };

  const validateSpelloutConsistency = (derivationSteps, sentenceTokens, surfaceOrder) => {
    if (!Array.isArray(derivationSteps) || derivationSteps.length === 0) return false;

    const spelloutSteps = derivationSteps.filter((step) => String(step?.operation || '').trim() === 'SpellOut');
    if (spelloutSteps.length === 0) return false;

    const finalSpelloutStep = spelloutSteps[spelloutSteps.length - 1];
    const normalizedSpelloutOrder = (finalSpelloutStep.spelloutOrder || [])
      .map((token) => normalizeSurfaceToken(token))
      .filter(Boolean);
    const normalizedSurfaceOrder = (surfaceOrder || [])
      .map((token) => normalizeSurfaceToken(token))
      .filter(Boolean);
    const normalizedSentenceTokens = (sentenceTokens || [])
      .map((token) => normalizeSurfaceToken(token))
      .filter(Boolean);

    if (
      normalizedSpelloutOrder.length === 0 ||
      JSON.stringify(normalizedSpelloutOrder) !== JSON.stringify(normalizedSurfaceOrder) ||
      JSON.stringify(normalizedSpelloutOrder) !== JSON.stringify(normalizedSentenceTokens)
    ) {
      return false;
    }
    return true;
  };

  return {
    normalizeSyntaxNode,
    normalizeSyntaxTreeWithIds,
    collectOvertTerminalNodes,
    sameTokenSequence,
    subtreeHasOvertYield,
    isTraceOrNullOnlySubtree,
    anchorOvertLeavesToSentenceTokens,
    deriveCanonicalSurfaceSpans,
    collapseOvertHeadLandingChains,
    collectExistingNodeIds,
    validateAndCommitSurfaceOrder,
    validateSpelloutConsistency
  };
};
