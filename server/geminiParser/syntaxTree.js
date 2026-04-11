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

  const inferLexicalChildTemplateForPhrase = (label) => {
    const raw = String(label || '').trim();
    const lower = raw.toLowerCase();
    if (!raw) return null;
    if (lower === 'dp') return ['NP', 'N'];
    if (lower === 'np') return ['N'];
    if (lower === 'vp') return ['V'];
    if (lower === 'tp') return ['T'];
    if (lower === 'ip') return ['I'];
    if (lower === 'inflp') return ['Infl'];
    if (lower === 'cp') return ['C'];
    if (lower === 'pp') return ['P'];
    if (lower === 'ap') return ['A'];
    if (lower === 'advp') return ['Adv'];
    return null;
  };

  const materializeLexicalPhrasalLeaves = (tree) => {
    if (!tree || typeof tree !== 'object') return tree;

    const existingIds = new Set();
    const collectIds = (node) => {
      if (!node || typeof node !== 'object') return;
      const id = String(node.id || '').trim();
      if (id) existingIds.add(id);
      const children = Array.isArray(node.children) ? node.children : [];
      children.forEach(collectIds);
    };
    collectIds(tree);
    const counterRef = { value: existingIds.size + 1 };

    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      const children = Array.isArray(node.children) ? node.children : [];
      children.forEach(visit);

      if (children.length > 0) return;
      if (!isPhrasalLabel(node.label)) return;

      const word = String(node.word || '').trim();
      if (!word || isTraceLikeSurface(word) || isNullLikeSurface(word)) return;

      const lexicalTemplate = inferLexicalChildTemplateForPhrase(node.label);
      if (!lexicalTemplate || lexicalTemplate.length === 0) return;

      const makeLexicalChain = (labels) => {
        if (labels.length === 0) return null;
        const [headLabel, ...rest] = labels;
        const childId = nextGeneratedNodeId(existingIds, counterRef);
        const childNode = { id: childId, label: headLabel };
        if (rest.length === 0) {
          childNode.word = word;
          if (node.tokenIndex !== undefined) childNode.tokenIndex = node.tokenIndex;
          if (Array.isArray(node.surfaceSpan)) childNode.surfaceSpan = [...node.surfaceSpan];
          return childNode;
        }
        childNode.children = [makeLexicalChain(rest)];
        if (Array.isArray(node.surfaceSpan)) childNode.surfaceSpan = [...node.surfaceSpan];
        return childNode;
      };

      delete node.word;
      delete node.tokenIndex;
      node.children = [makeLexicalChain(lexicalTemplate)];
    };

    visit(tree);
    return tree;
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

  const compileFlatNodeTableToTree = (nodesValue, rootIdValue, framework = 'xbar', sentenceTokens = []) => {
    if (!Array.isArray(nodesValue) || nodesValue.length === 0) {
      throw new ParseApiError('BAD_MODEL_RESPONSE', 'Flat node table must contain at least one node.', 502);
    }

    const nodesById = new Map();
    const childrenByParent = new Map();
    const normalizedSentenceTokens = sentenceTokens.map(normalizeSurfaceToken).filter(Boolean);
    const tokenPositionsBySurface = new Map();

    normalizedSentenceTokens.forEach((token, index) => {
      const positions = tokenPositionsBySurface.get(token) || [];
      positions.push(index);
      tokenPositionsBySurface.set(token, positions);
    });

    nodesValue.forEach((rawNode, index) => {
      if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode)) {
        throw new ParseApiError('BAD_MODEL_RESPONSE', 'Malformed flat node record from model.', 502);
      }

      const rawId = typeof rawNode.id === 'string' ? rawNode.id.trim() : '';
      if (!rawId) throw new ParseApiError('BAD_MODEL_RESPONSE', 'Every flat node must include a non-empty id.', 502);
      if (nodesById.has(rawId)) {
        throw new ParseApiError('BAD_MODEL_RESPONSE', `Duplicate flat node id: ${rawId}.`, 502);
      }

      const explicitWordValue = normalizeExplicitSurfaceWord(rawNode);
      const rawNodeLabel = typeof rawNode.label === 'string' && rawNode.label.trim()
        ? rawNode.label.trim()
        : '';
      const rawLabel = rawNodeLabel
        ? (/^word$/i.test(rawNodeLabel) && explicitWordValue ? explicitWordValue : rawNodeLabel)
        : explicitWordValue;
      const label = normalizeLabelForFramework(rawLabel, framework);
      if (!label) {
        throw new ParseApiError('BAD_MODEL_RESPONSE', `Flat node ${rawId} is missing a usable label.`, 502);
      }

      const structuralProfile = getLabelProfile(label);
      const word =
        explicitWordValue
          ? explicitWordValue
          : label
            && !structuralProfile.isPhrasal
            && !structuralProfile.isHeadLikeStructural
            && !isTraceLikeSurface(label)
            && !isNullLikeSurface(label)
              ? label
              : undefined;
      const explicitTokenIndex = normalizeTokenIndex(rawNode.tokenIndex, sentenceTokens.length);
      const normalizedWordSurface = normalizeSurfaceToken(word);
      const inferredTokenIndex =
        explicitTokenIndex === undefined &&
        normalizedWordSurface &&
        !isTraceLikeSurface(word) &&
        !isNullLikeSurface(String(word || '').trim())
          ? (() => {
              const positions = tokenPositionsBySurface.get(normalizedWordSurface) || [];
              return positions.length === 1 ? positions[0] : undefined;
            })()
          : undefined;
      const tokenIndex = explicitTokenIndex ?? inferredTokenIndex;
      const surfaceSpan = normalizeSurfaceSpan(rawNode.surfaceSpan);
      const parentId = typeof rawNode.parentId === 'string' && rawNode.parentId.trim()
        ? rawNode.parentId.trim()
        : undefined;
      const caseValue = normalizeOptionalMetadataText(rawNode.case);
      const assigner = normalizeOptionalMetadataText(rawNode.assigner);
      const caseEvidence = normalizeOptionalMetadataText(rawNode.caseEvidence);
      const caseOvert = normalizeOptionalMetadataBoolean(rawNode.caseOvert);
      const siblingOrder = Number.isInteger(Number(rawNode.siblingOrder))
        ? Math.max(0, Number(rawNode.siblingOrder))
        : undefined;

      nodesById.set(rawId, {
        id: rawId,
        label,
        word,
        tokenIndex,
        siblingOrder,
        surfaceSpan,
        parentId,
        case: caseValue,
        assigner,
        caseEvidence,
        caseOvert,
        __order: index
      });
    });

    const getNodeInterval = (node) => {
      if (!node || typeof node !== 'object') return null;
      if (Array.isArray(node.surfaceSpan)) return node.surfaceSpan;
      if (node.tokenIndex !== undefined) return [node.tokenIndex, node.tokenIndex];
      return null;
    };

    const intervalContains = (parentInterval, childInterval) => {
      if (!Array.isArray(parentInterval) || !Array.isArray(childInterval)) return false;
      if (parentInterval[0] > childInterval[0] || parentInterval[1] < childInterval[1]) return false;
      return true;
    };

    const explicitRootId = typeof rootIdValue === 'string' && rootIdValue.trim() ? rootIdValue.trim() : '';

    for (const node of nodesById.values()) {
      if (node.parentId) continue;
      if (explicitRootId && node.id === explicitRootId) continue;

      const nodeInterval = getNodeInterval(node);
      if (!nodeInterval) continue;

      const candidates = Array.from(nodesById.values())
        .filter((candidate) => {
          if (!candidate || candidate.id === node.id) return false;
          const candidateInterval = getNodeInterval(candidate);
          if (!intervalContains(candidateInterval, nodeInterval)) return false;
          return candidate.__order < node.__order;
        })
        .sort((left, right) => {
          const leftInterval = getNodeInterval(left);
          const rightInterval = getNodeInterval(right);
          const leftWidth = leftInterval ? (leftInterval[1] - leftInterval[0]) : Number.POSITIVE_INFINITY;
          const rightWidth = rightInterval ? (rightInterval[1] - rightInterval[0]) : Number.POSITIVE_INFINITY;
          if (leftWidth !== rightWidth) return leftWidth - rightWidth;
          return right.__order - left.__order;
        });

      if (candidates.length > 0) node.parentId = candidates[0].id;
    }

    for (const node of nodesById.values()) {
      if (node.parentId) {
        if (!nodesById.has(node.parentId)) {
          throw new ParseApiError('BAD_MODEL_RESPONSE', `Flat node ${node.id} points to missing parentId ${node.parentId}.`, 502);
        }
        const siblings = childrenByParent.get(node.parentId) || [];
        siblings.push(node.id);
        childrenByParent.set(node.parentId, siblings);
      }
    }

    let rootId = explicitRootId;
    if (rootId) {
      if (!nodesById.has(rootId)) {
        throw new ParseApiError('BAD_MODEL_RESPONSE', `Flat node rootId ${rootId} does not exist.`, 502);
      }
    } else {
      const rootCandidates = Array.from(nodesById.values()).filter((node) => !node.parentId);
      if (rootCandidates.length !== 1) {
        throw new ParseApiError('BAD_MODEL_RESPONSE', 'Flat node table must determine exactly one root node.', 502);
      }
      rootId = rootCandidates[0].id;
    }

    const visiting = new Set();
    const built = new Map();

    const buildNode = (nodeId) => {
      if (built.has(nodeId)) return built.get(nodeId);
      if (visiting.has(nodeId)) {
        throw new ParseApiError('BAD_MODEL_RESPONSE', `Flat node table contains a cycle at ${nodeId}.`, 502);
      }
      visiting.add(nodeId);
      const node = nodesById.get(nodeId);
      const childIds = childrenByParent.get(nodeId) || [];
      const childEntries = childIds.map((childId) => buildNode(childId));
      const sortedChildren = childEntries
        .slice()
        .sort((left, right) => {
          const leftSiblingOrder = left.siblingOrder;
          const rightSiblingOrder = right.siblingOrder;
          if (Number.isInteger(leftSiblingOrder) || Number.isInteger(rightSiblingOrder)) {
            if (!Number.isInteger(leftSiblingOrder)) return 1;
            if (!Number.isInteger(rightSiblingOrder)) return -1;
            if (leftSiblingOrder !== rightSiblingOrder) return leftSiblingOrder - rightSiblingOrder;
          }
          const leftStart = left.sortStart;
          const rightStart = right.sortStart;
          if (leftStart === rightStart) return left.order - right.order;
          if (leftStart === null) return 1;
          if (rightStart === null) return -1;
          return leftStart - rightStart;
        });

      const compiled = { id: node.id, label: node.label };
      if (typeof node.word === 'string' && node.word.trim()) compiled.word = node.word.trim();
      if (node.tokenIndex !== undefined) compiled.tokenIndex = node.tokenIndex;
      if (node.surfaceSpan) compiled.surfaceSpan = node.surfaceSpan;
      if (node.case) compiled.case = node.case;
      if (node.assigner) compiled.assigner = node.assigner;
      if (node.caseEvidence) compiled.caseEvidence = node.caseEvidence;
      if (node.caseOvert !== undefined) compiled.caseOvert = node.caseOvert;
      if (sortedChildren.length > 0) compiled.children = sortedChildren.map((entry) => entry.node);

      let sortStart = null;
      if (node.tokenIndex !== undefined) {
        sortStart = node.tokenIndex;
      } else {
        for (const child of sortedChildren) {
          if (Number.isInteger(child.sortStart)) {
            sortStart = child.sortStart;
            break;
          }
        }
        if (sortStart === null && node.surfaceSpan) {
          sortStart = node.surfaceSpan[0];
        }
      }

      const entry = {
        node: compiled,
        sortStart,
        order: node.__order,
        siblingOrder: node.siblingOrder
      };
      built.set(nodeId, entry);
      visiting.delete(nodeId);
      return entry;
    };

    const rootEntry = buildNode(rootId);
    return alignCompiledTreeToSentence(rootEntry.node, sentenceTokens);
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
      return Boolean(surface) && !isTraceLikeNode(node) && !isNullLikeNode(node);
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
        if (!surface || isTraceLikeNode(node) || isNullLikeNode(node)) {
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
        if (surface && !isTraceLikeNode(node) && !isNullLikeNode(node)) terminals.push(node);
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
        const tokenIndex = normalizeTokenIndex(node.tokenIndex, normalizedSentenceTokens.length);
        const singletonSpan = normalizeSurfaceSpan(node.surfaceSpan);
        const spanTokenIndex = singletonSpan && singletonSpan[0] === singletonSpan[1]
          ? normalizeTokenIndex(singletonSpan[0], normalizedSentenceTokens.length)
          : undefined;
        const hintedTokenIndex = tokenIndex ?? spanTokenIndex;

        if (!surface && hintedTokenIndex !== undefined) {
          const hintedSurface = normalizedSentenceTokens[hintedTokenIndex];
          const labelSurface = normalizeSurfaceToken(String(node.label || '').trim());
          if (hintedSurface && labelSurface === hintedSurface && !traceLike && !nullLike) {
            surface = hintedSurface;
            node.word = String(sentenceTokens[hintedTokenIndex] || '').trim();
          }
        }

        if (tokenIndex !== undefined) {
          if (traceLike || nullLike) {
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
        const overt = Boolean(surface) && !isTraceLikeNode(node) && !isNullLikeNode(node);
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
        if (!surface || isTraceLikeNode(current) || isNullLikeNode(current)) return null;
        return {
          surface,
          keptLeafId: String(current.id || '').trim(),
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
        if (!surface || isTraceLikeNode(child) || isNullLikeNode(child)) return null;
        return {
          surface,
          keptLeafId: String(child.id || '').trim(),
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

  const baseHeadLabelForProjection = (label) => {
    const raw = String(label || '').trim();
    if (!raw) return '';
    if (/^(.+?)(?:'|_bar)$/i.test(raw)) {
      return raw.replace(/(?:'|_bar)$/i, '');
    }
    const lower = raw.toLowerCase();
    if (lower === 'inflp') return 'Infl';
    if (lower === 'ip') return 'I';
    if (lower === 'tp') return 'T';
    if (lower === 'vp') return 'V';
    if (lower === 'cp') return 'C';
    if (lower === 'pp') return 'P';
    if (lower === 'dp') return 'D';
    if (lower === 'np') return 'N';
    if (lower === 'ap') return 'A';
    if (lower === 'advp') return 'Adv';
    return '';
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

  const canonicalizeHeadMoveSourceShells = (tree, movementEvents) => {
    if (!tree || !Array.isArray(movementEvents) || movementEvents.length === 0) return [];

    const nodeById = buildNodeIndexFromTree(tree);
    const parentById = buildParentIndexFromTree(tree);
    const usedIds = collectExistingNodeIds(tree);
    const counterRef = { value: usedIds.size + 1 };
    const remappedEvents = movementEvents.map((event) => ({ ...event }));

    const nextId = () => nextGeneratedNodeId(usedIds, counterRef);

    remappedEvents.forEach((event) => {
      if (normalizeMovementOperation(event?.operation) !== 'HeadMove') return;
      const fromNodeId = String(event?.fromNodeId || '').trim();
      const toNodeId = String(event?.toNodeId || '').trim();
      const explicitTraceId = String(event?.traceNodeId || '').trim();
      if (!fromNodeId || !toNodeId) return;
      if (explicitTraceId && nodeById.has(explicitTraceId)) return;

      const fromNode = nodeById.get(fromNodeId);
      const toNode = nodeById.get(toNodeId);
      if (!fromNode || !toNode) return;

      const fromProfile = getLabelProfile(fromNode.label);
      if (!fromProfile.isPhrasal) return;

      const headLabel = baseHeadLabelForProjection(fromNode.label) || baseHeadLabelForProjection(toNode.label);
      if (!headLabel) return;

      const children = Array.isArray(fromNode.children) ? fromNode.children : [];
      const existingHeadChild = children.find((child) => normalizeMovementLabelKey(child?.label) === normalizeMovementLabelKey(headLabel));
      if (existingHeadChild) {
        const directNullSource =
          (isTraceLikeNode(existingHeadChild) || isNullLikeNode(existingHeadChild))
            ? existingHeadChild
            : null;
        const descendantNullSource = directNullSource
          ? null
          : collectLeafNodes(existingHeadChild).find((child) => isTraceLikeNode(child) || isNullLikeNode(child));
        const groundedSource = directNullSource || descendantNullSource;
        if (groundedSource?.id) {
          event.fromNodeId = String(groundedSource.id);
          event.traceNodeId = String(groundedSource.id);
          return;
        }
      }

      const nullLeafId = nextId();
      const headId = nextId();
      const nullLeaf = { id: nullLeafId, label: '∅', word: '∅' };
      const lowerHead = { id: headId, label: headLabel, children: [nullLeaf] };

      fromNode.children = [lowerHead, ...children];
      event.fromNodeId = nullLeafId;
      event.traceNodeId = nullLeafId;

      nodeById.set(headId, lowerHead);
      nodeById.set(nullLeafId, nullLeaf);
      parentById.set(headId, fromNode.id);
      parentById.set(nullLeafId, headId);
    });

    return remappedEvents;
  };

  const getNodeTokenBounds = (node) => {
    if (!node || typeof node !== 'object') return null;
    if (Number.isInteger(node.tokenIndex)) return [node.tokenIndex, node.tokenIndex];
    const span = normalizeSurfaceSpan(node.surfaceSpan);
    if (span) return span;
    const children = Array.isArray(node.children) ? node.children : [];
    let start = null;
    let end = null;
    children.forEach((child) => {
      const bounds = getNodeTokenBounds(child);
      if (!bounds) return;
      start = start === null ? bounds[0] : Math.min(start, bounds[0]);
      end = end === null ? bounds[1] : Math.max(end, bounds[1]);
    });
    return start === null || end === null ? null : [start, end];
  };

  const findSingleOvertLeafForSplitFronting = (node) => {
    if (!node || typeof node !== 'object') return null;
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length !== 1) return null;
    const child = children[0];
    if (!child || typeof child !== 'object') return null;
    const grandChildren = Array.isArray(child.children) ? child.children : [];
    if (grandChildren.length === 0) {
      const surface = String(resolveOvertLeafSurface(child) || '').trim();
      if (!surface || isTraceLikeNode(child) || isNullLikeNode(child)) return null;
      return { carrier: node, leaf: child };
    }
    if (grandChildren.length === 1) {
      const grandChild = grandChildren[0];
      const greatGrandChildren = Array.isArray(grandChild?.children) ? grandChild.children : [];
      if (greatGrandChildren.length === 0) {
        const surface = String(resolveOvertLeafSurface(grandChild) || '').trim();
        if (!surface || isTraceLikeNode(grandChild) || isNullLikeNode(grandChild)) return null;
        return { carrier: child, leaf: grandChild };
      }
    }
    return null;
  };

  const findEmptyHeadSlotForSplitFronting = (node) => {
    if (!node || typeof node !== 'object') return null;
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      const profile = getLabelProfile(child?.label);
      if (!profile.isHeadLikeStructural) continue;
      const grandChildren = Array.isArray(child?.children) ? child.children : [];
      if (grandChildren.length === 1 && isNullLikeNode(grandChildren[0])) {
        return { carrier: child, placeholder: grandChildren[0] };
      }
    }
    return null;
  };

  const canonicalizeSplitClauseEdgeMovedPhrases = (tree, movementEvents) => {
    if (!tree || typeof tree !== 'object' || !Array.isArray(movementEvents) || movementEvents.length === 0) {
      return tree;
    }

    const moveTargetIds = new Set(
      movementEvents
        .filter((event) => normalizeMovementOperation(event?.operation) === 'Move')
        .map((event) => String(event?.toNodeId || '').trim())
        .filter(Boolean)
    );
    if (moveTargetIds.size === 0) return tree;

    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      const children = Array.isArray(node.children) ? node.children : [];
      children.forEach(visit);

      const nodeProfile = getLabelProfile(node.label);
      if (nodeProfile.base !== 'c') return;
      if (children.length < 2) return;

      for (let index = 1; index < children.length; index += 1) {
        const targetNode = children[index];
        const leftSibling = children[index - 1];
        const targetId = String(targetNode?.id || '').trim();
        if (!targetId || !moveTargetIds.has(targetId)) continue;

        const leftProfile = getLabelProfile(leftSibling?.label);
        if (leftProfile.base !== 'c' || !leftProfile.isHeadLikeStructural) continue;

        const overtLeafEntry = findSingleOvertLeafForSplitFronting(leftSibling);
        const emptyHeadSlot = findEmptyHeadSlotForSplitFronting(targetNode);
        if (!overtLeafEntry || !emptyHeadSlot) continue;

        const leftBounds = getNodeTokenBounds(overtLeafEntry.leaf);
        const targetBounds = getNodeTokenBounds(targetNode);
        if (!leftBounds || !targetBounds) continue;
        if (leftBounds[0] !== leftBounds[1]) continue;
        if (targetBounds[0] !== targetBounds[1]) continue;
        if (leftBounds[0] + 1 !== targetBounds[0]) continue;

        const overtLeaf = overtLeafEntry.leaf;
        const placeholder = emptyHeadSlot.placeholder;
        emptyHeadSlot.carrier.children = [overtLeaf];
        overtLeafEntry.carrier.children = [placeholder];

        delete overtLeaf.tokenIndex;
        delete overtLeaf.surfaceSpan;
        delete placeholder.tokenIndex;
        delete placeholder.surfaceSpan;
        delete emptyHeadSlot.carrier.surfaceSpan;
        delete leftSibling.surfaceSpan;
        delete targetNode.surfaceSpan;
      }
    };

    visit(tree);
    return tree;
  };

  const resolveRedirectedNodeId = (nodeId, redirects) => {
    let current = String(nodeId || '').trim();
    const seen = new Set();
    while (current && redirects?.has(current) && !seen.has(current)) {
      seen.add(current);
      current = String(redirects.get(current) || '').trim();
    }
    return current;
  };

  const remapDerivationStepsNodeIds = (steps, redirects) => {
    if (!Array.isArray(steps) || steps.length === 0 || !(redirects instanceof Map) || redirects.size === 0) {
      return steps;
    }

    return steps.map((step) => {
      const targetNodeId = resolveRedirectedNodeId(step?.targetNodeId, redirects);
      const microOperations = Array.isArray(step?.microOperations)
        ? step.microOperations
        : step?.microOperations;
      const affectedNodeIds = Array.isArray(step?.affectedNodeIds)
        ? Array.from(new Set(step.affectedNodeIds
            .map((id) => resolveRedirectedNodeId(id, redirects))
            .filter(Boolean)))
        : step?.affectedNodeIds;
      const sourceNodeIds = Array.isArray(step?.sourceNodeIds)
        ? Array.from(new Set(step.sourceNodeIds
            .map((id) => resolveRedirectedNodeId(id, redirects))
            .filter(Boolean)))
        : step?.sourceNodeIds;
      const featureChecking = Array.isArray(step?.featureChecking)
        ? step.featureChecking.map((item) => ({
            ...item,
            probeNodeId: resolveRedirectedNodeId(item?.probeNodeId, redirects) || item?.probeNodeId,
            goalNodeId: resolveRedirectedNodeId(item?.goalNodeId, redirects) || item?.goalNodeId
          }))
        : step?.featureChecking;

      return {
        ...step,
        microOperations,
        affectedNodeIds,
        targetNodeId: targetNodeId || undefined,
        sourceNodeIds,
        featureChecking
      };
    });
  };

  const remapMovementEventsNodeIds = (events, redirects) => {
    if (!Array.isArray(events) || events.length === 0 || !(redirects instanceof Map) || redirects.size === 0) {
      return events;
    }

    return events.map((event) => ({
      ...event,
      fromNodeId: resolveRedirectedNodeId(event?.fromNodeId, redirects) || event?.fromNodeId,
      toNodeId: resolveRedirectedNodeId(event?.toNodeId, redirects) || event?.toNodeId,
      traceNodeId: resolveRedirectedNodeId(event?.traceNodeId, redirects) || event?.traceNodeId
    }));
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
    materializeLexicalPhrasalLeaves,
    normalizeSyntaxNode,
    normalizeSyntaxTreeWithIds,
    compileFlatNodeTableToTree,
    collectOvertTerminalNodes,
    sameTokenSequence,
    subtreeHasOvertYield,
    isTraceOrNullOnlySubtree,
    anchorOvertLeavesToSentenceTokens,
    deriveCanonicalSurfaceSpans,
    collapseOvertHeadLandingChains,
    collectExistingNodeIds,
    canonicalizeHeadMoveSourceShells,
    canonicalizeSplitClauseEdgeMovedPhrases,
    remapDerivationStepsNodeIds,
    remapMovementEventsNodeIds,
    validateAndCommitSurfaceOrder,
    validateSpelloutConsistency
  };
};
