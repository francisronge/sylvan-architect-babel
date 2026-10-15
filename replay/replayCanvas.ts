/** Materialize display terminals and visible canvases without changing authored syntax. */
import * as d3 from 'd3';
import { type ResolvedRelationLink } from '../relationLinks.ts';
import { isPronouncedLeaf } from '../server/babelParser/nodePronunciation.js';
import { type SyntaxNode } from '../types.ts';
import {
  applyVizIds,
  createReplayIdentityContext,
  getNodeId,
  isReplayDisplayChild,
  type ReplayIdentityContext
} from './displayIdentity.ts';
import { isResolvedMovementLink, resolveDerivationMovementTransitions } from './movementLinks.ts';
import { resolveLeafSurface, shouldExpandPreterminalLeaf } from './replaySurfaceNotation.ts';
import { cloneSyntaxTree, findExactNodeByIdInForest, projectAuthoredSyntaxNode } from './syntaxForest.ts';
import { type HierNode, type ReplayDerivationFrame } from './types.ts';

export const DERIVATION_WORKSPACE_ROOT_LABEL = '__DERIVATION_WORKSPACE__';

const DERIVATION_WORKSPACE_ROOT_ID = '__derivation_workspace_root__';

/**
 * Index laid-out syntax by its current renderer id and by every preserved
 * authored alias. An id that names more than one node is omitted entirely:
 * relation geometry must fail closed instead of choosing by traversal order.
 */
export const indexHierarchyNodesByIdAndAliases = <T extends HierNode>(nodes: readonly T[]): Map<string, T> => {
  const candidates = new Map<string, T | null>();
  nodes.forEach((node) => {
    const ids = Array.from(new Set([
      getNodeId(node),
      node.data?.id,
      ...(Array.isArray(node.data?.aliasIds) ? node.data.aliasIds : [])
    ].map((id) => String(id || '')).filter(Boolean)));
    ids.forEach((id) => {
      if (!candidates.has(id)) {
        candidates.set(id, node);
        return;
      }
      if (candidates.get(id) !== node)
        candidates.set(id, null);
    });
  });
  return new Map(Array.from(candidates.entries())
    .filter((entry): entry is [
      string,
      T
    ] => Boolean(entry[1])));
};

export const isSyntheticWorkspaceRootNode = (node: HierNode): boolean => node.data?.replayOrigin?.kind === 'workspace';

export const buildDerivationCanvasData = (forest: SyntaxNode[], identity = createReplayIdentityContext(forest)): SyntaxNode | null => {
  if (!Array.isArray(forest) || forest.length === 0)
    return null;
  const replayOrigin = { kind: 'workspace' } as const;
  return forest.length === 1 ? forest[0] : {
    id: identity.allocate(DERIVATION_WORKSPACE_ROOT_ID, replayOrigin),
    label: DERIVATION_WORKSPACE_ROOT_LABEL,
    replayOrigin,
    children: forest
  };
};

const normalizeReplayStableIdPart = (value?: string | number | null): string => String(value ?? '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  || 'leaf';

const shouldStabilizeReplayLeafId = (node?: SyntaxNode | null): boolean => {
  if (!node || typeof node !== 'object')
    return false;
  if (Array.isArray(node.children) && node.children.length > 0)
    return false;
  if (!isPronouncedLeaf(node) || !String(node.label || '').trim())
    return false;
  if (shouldExpandPreterminalLeaf(node))
    return false;
  return true;
};

const stabilizeReplayOvertLeafIds = (node?: SyntaxNode | null, identity = createReplayIdentityContext(node ? [node] : [])): SyntaxNode | null => {
  if (!node || typeof node !== 'object')
    return null;
  const walk = (current: SyntaxNode, parentId: string): SyntaxNode => {
    const ownId = String(current.id ?? '');
    const ownStableParentId = ownId || parentId;
    const children = Array.isArray(current.children)
      ? current.children
        .filter((child): child is SyntaxNode => Boolean(child && typeof child === 'object'))
        .map((child) => walk(child, ownStableParentId))
      : [];
    const next: SyntaxNode = { ...current };
    if (children.length > 0) {
      next.children = children;
      return next;
    }
    delete next.children;
    if (!parentId || current.replayOrigin || !shouldStabilizeReplayLeafId(current))
      return next;
    const tokenIndex = Number.isInteger(current.tokenIndex)
      ? `tok_${current.tokenIndex}`
      : '';
    const surfaceKey = normalizeReplayStableIdPart(current.word || current.label);
    const stableKey = tokenIndex ? `${tokenIndex}_${surfaceKey}` : surfaceKey;
    next.aliasIds = Array.from(new Set([
      ...(Array.isArray(current.aliasIds) ? current.aliasIds : []),
      String(current.id || '')
    ].filter(Boolean)));
    next.replayOrigin = { kind: 'lexical', ownerId: parentId, authoredId: typeof current.id === 'string' ? current.id : ownId };
    next.id = identity.allocate(`${parentId}::__lex_${stableKey}`, next.replayOrigin);
    return next;
  };
  return walk(node, '');
};

export const buildRenderableDerivationCanvasData = (
  forest: SyntaxNode[],
  identity = createReplayIdentityContext(forest)
): SyntaxNode | null => {
  const canvas = buildDerivationCanvasData(forest, identity);
  if (!canvas)
    return null;
  const stableReplayCanvas = stabilizeReplayOvertLeafIds(canvas, identity) || canvas;
  return materializeReplayPreterminals(stableReplayCanvas, identity);
};

export const buildRenderableCommittedCanvasData = (tree: SyntaxNode): SyntaxNode => {
  if (tree.replayOrigin?.kind === 'workspace') {
    return buildRenderableDerivationCanvasData(tree.children || []) || tree;
  }
  return materializeReplayPreterminals(projectAuthoredSyntaxNode(tree));
};

export const collectVisibleDerivationNodeIds = (
  forest: SyntaxNode[],
  identity = createReplayIdentityContext(forest)
): Set<string> => {
  const canvas = buildRenderableDerivationCanvasData(forest, identity);
  const cloned = cloneSyntaxTree(canvas);
  if (!cloned)
    return new Set<string>();
  const hierarchy = d3.hierarchy(cloned);
  applyVizIds(hierarchy);
  return new Set(hierarchy
    .descendants()
    .filter((node) => !isSyntheticWorkspaceRootNode(node))
    .map((node) => getNodeId(node)));
};

export interface VisibleSyntaxSnapshotInput {
  root: HierNode;
  visibleNodeIds?: Set<string>;
  detachedRootSideHints?: Map<string, number>;
  identity?: ReplayIdentityContext;
}

export const buildVisibleSyntaxSnapshotFromHierarchy = ({
  root,
  visibleNodeIds,
  detachedRootSideHints,
  identity = createReplayIdentityContext([root.data])
}: VisibleSyntaxSnapshotInput): SyntaxNode | null => {
  if (!visibleNodeIds || visibleNodeIds.size === 0)
    return null;
  const nodeMatchesVisibleId = (node: HierNode): boolean => {
    const nodeId = getNodeId(node);
    if (visibleNodeIds.has(nodeId))
      return true;
    return (Array.isArray(node.data?.aliasIds) ? node.data.aliasIds : [])
      .map((aliasId) => String(aliasId || ''))
      .filter(Boolean)
      .some((aliasId) => visibleNodeIds.has(aliasId));
  };
  const cloneVisibleNode = (node: HierNode): SyntaxNode | null => {
    if (!nodeMatchesVisibleId(node))
      return null;
    // Children are rebuilt below; copying their entire subtrees here is quadratic.
    const { children: _children, ...material } = node.data;
    const dataClone = cloneSyntaxTree(material);
    if (!dataClone)
      return null;
    const childSnapshots = (node.children || [])
      .map(cloneVisibleNode)
      .filter((child): child is SyntaxNode => Boolean(child));
    if (childSnapshots.length > 0) {
      dataClone.children = childSnapshots;
    }
    else {
      delete dataClone.children;
    }
    return dataClone;
  };
  const preorderIndex = new Map<string, number>();
  let preorderCursor = 0;
  root.eachBefore((node) => {
    preorderIndex.set(getNodeId(node), preorderCursor);
    preorderCursor += 1;
  });
  const visibleRoots = root
    .descendants()
    .filter((node) => !isSyntheticWorkspaceRootNode(node))
    .filter(nodeMatchesVisibleId)
    .filter((node) => {
      const parent = node.parent;
      if (!parent || isSyntheticWorkspaceRootNode(parent))
        return true;
      return !nodeMatchesVisibleId(parent);
    })
    .sort((a, b) => {
      const resolveDetachedRootSideHint = (node: HierNode): number => {
        let current: HierNode | null = node;
        while (current) {
          const currentId = getNodeId(current);
          if (detachedRootSideHints?.has(currentId)) {
            return Number(detachedRootSideHints.get(currentId) || 0);
          }
          current = current.parent;
        }
        return 0;
      };
      const sideA = resolveDetachedRootSideHint(a);
      const sideB = resolveDetachedRootSideHint(b);
      if (sideA !== sideB)
        return sideA - sideB;
      return (preorderIndex.get(getNodeId(a)) ?? 0) - (preorderIndex.get(getNodeId(b)) ?? 0);
    });
  const forest = visibleRoots
    .map((node) => cloneVisibleNode(node))
    .filter((node): node is SyntaxNode => Boolean(node));
  if (forest.length === 0)
    return null;
  if (forest.length === 1)
    return forest[0];
  return buildDerivationCanvasData(forest, identity);
};

const collectRenderableVisibleNodeIds = (root: HierNode, rawVisibleNodeIds?: Set<string>): string[] => {
  const allRenderableNodeIds = root
    .descendants()
    .filter((node) => !isSyntheticWorkspaceRootNode(node))
    .map((node) => getNodeId(node));
  if (!rawVisibleNodeIds || rawVisibleNodeIds.size === 0) {
    return allRenderableNodeIds;
  }
  const nodesById = new Map<string, HierNode>();
  root
    .descendants()
    .filter((node) => !isSyntheticWorkspaceRootNode(node))
    .forEach((node) => {
      nodesById.set(getNodeId(node), node);
      (Array.isArray(node.data?.aliasIds) ? node.data.aliasIds : [])
        .map((aliasId) => String(aliasId || ''))
        .filter(Boolean)
        .forEach((aliasId) => nodesById.set(aliasId, node));
    });
  const visibleIds = new Set<string>();
  const markRenderableNode = (node: HierNode) => {
    if (isSyntheticWorkspaceRootNode(node))
      return;
    const nodeId = getNodeId(node);
    visibleIds.add(nodeId);
    // Materialized preterminals add synthetic display leaves under authored leaf ids.
    // Show those leaves, but do not auto-reveal ordinary authored descendants.
    (node.children || []).forEach((child) => {
      const childId = getNodeId(child);
      if (isReplayDisplayChild(child.data, nodeId))
        visibleIds.add(childId);
    });
  };
  rawVisibleNodeIds.forEach((requestedId) => {
    const normalizedRequestedId = String(requestedId || '');
    if (!normalizedRequestedId)
      return;
    const exactNode = nodesById.get(normalizedRequestedId);
    if (exactNode) {
      markRenderableNode(exactNode);
      return;
    }
  });
  return visibleIds.size > 0 ? Array.from(visibleIds) : allRenderableNodeIds;
};

export const extractReplayWorkspaceLabels = (canvasData: SyntaxNode | null): string[] => {
  if (!canvasData)
    return [];
  const roots = canvasData.replayOrigin?.kind === 'workspace'
    ? (Array.isArray(canvasData.children) ? canvasData.children : [])
    : [canvasData];
  return roots
    .map((node) => String(node?.label || '').trim())
    .filter(Boolean);
};

export const getReplayLeafSelectionTarget = (root: SyntaxNode, identity: ReplayIdentityContext): {
  nodeId: string;
  surface: string;
} | null => {
  const renderableRoot = buildRenderableDerivationCanvasData([cloneSyntaxTree(root) || root], identity);
  if (!renderableRoot)
    return null;
  const hierarchy = d3.hierarchy(renderableRoot);
  applyVizIds(hierarchy);
  const leaf = hierarchy.descendants().find((node) => !node.children || node.children.length === 0);
  if (!leaf)
    return null;
  const surface = resolveLeafSurface(leaf);
  if (!surface)
    return null;
  return {
    nodeId: getNodeId(leaf),
    surface
  };
};

export const materializeReplayPreterminals = (node: SyntaxNode, identity = createReplayIdentityContext([node])): SyntaxNode => {
  const walk = (current: SyntaxNode): SyntaxNode => {
    if (!current || typeof current !== 'object') {
      throw new Error('Replay preterminal expansion requires an authored syntax node.');
    }
    const children = Array.isArray(current.children)
      ? current.children
        .filter((child): child is SyntaxNode => Boolean(child && typeof child === 'object'))
        .map(walk)
      : [];
    const next: SyntaxNode = { ...current };
    delete next.children;
    const currentIsReplayLayoutOnly = (current as any).replayLayoutOnly === true;
    if (currentIsReplayLayoutOnly) {
      (next as any).replayLayoutOnly = true;
    }
    if (children.length > 0) {
      next.children = children;
      return next;
    }
    const word = typeof current.word === 'string' ? current.word.trim() : '';
    if (!word) {
      if (Array.isArray(current.children))
        next.children = [];
      return next;
    }
    if (shouldExpandPreterminalLeaf(current)) {
      const replayOrigin = { kind: 'word', ownerId: current.id } as const;
      next.children = [{
        id: identity.allocate(buildSyntheticReplayLeafId(current, 'leaf', word), replayOrigin),
        replayOrigin,
        label: word,
        word,
        ...(String(current.lineageId || '') ? { lineageId: current.lineageId } : {}),
        ...(current.silent === true ? { silent: true } : {}),
        ...(currentIsReplayLayoutOnly ? { replayLayoutOnly: true } : {})
      }];
      return next;
    }
    next.word = word;
    return next;
  };
  return walk(node);
};

export interface ReplaySnapshotInput {
  forest: SyntaxNode[];
  activeFrameIndex: number;
  relationLinks?: ResolvedRelationLink[];
  visibleNodeIds?: Set<string>;
  layoutNodeIds?: Set<string>;
  derivationFrames?: ReplayDerivationFrame[];
  detachedRootSideHints?: Map<string, number>;
  layoutScaffoldForest?: SyntaxNode[];
  identity?: ReplayIdentityContext;
}

export const buildDerivationReplaySnapshot = ({
  forest,
  activeFrameIndex,
  relationLinks,
  visibleNodeIds,
  layoutNodeIds,
  derivationFrames,
  detachedRootSideHints,
  layoutScaffoldForest,
  identity = createReplayIdentityContext(derivationFrames?.flatMap(frame => frame.workspaceForest || []) ?? forest)
}: ReplaySnapshotInput): {
  canvasData: SyntaxNode | null;
  visibleNodeIds: string[];
  relationLinks: ResolvedRelationLink[];
} => {
  const transitionInputLinks = Array.isArray(relationLinks)
    ? relationLinks
    : [];
  const transitionLinks = resolveDerivationMovementTransitions(forest, derivationFrames, activeFrameIndex, transitionInputLinks).map((transition) => ({
    ...transition.authoredLink,
    relationIndex: transition.index,
    relation: transition.operation,
    anchors: Array.isArray(transition.authoredLink.anchors)
      ? transition.authoredLink.anchors
      : [
        { role: 'source', nodeId: transition.sourceId },
        { role: 'target', nodeId: transition.targetId },
        ...(transition.traceId ? [{ role: 'witness', nodeId: transition.traceId }] : [])
      ],
    sourceNodeId: transition.sourceId,
    targetNodeId: transition.targetId,
    witnessNodeId: transition.traceId || undefined,
    renderFamily: 'trajectory',
    trajectoryKind: transition.trajectoryKind,
    stepIndex: transition.step,
    operation: transition.operation,
    chainId: transition.chainId || undefined,
    note: transition.note
  } satisfies ResolvedRelationLink));
  const nonMovementLinks = transitionInputLinks.filter((link) => !isResolvedMovementLink(link));
  const effectiveRelationLinks = [...transitionLinks, ...nonMovementLinks];
  const usesLayoutScaffold = Array.isArray(layoutScaffoldForest) && layoutScaffoldForest.length > 0;
  const rawCanvas = stabilizeReplayOvertLeafIds(buildDerivationCanvasData(usesLayoutScaffold ? layoutScaffoldForest : forest, identity), identity);
  const clonedRawCanvas = cloneSyntaxTree(rawCanvas);
  if (!clonedRawCanvas) {
    return {
      canvasData: null,
      visibleNodeIds: [],
      relationLinks: effectiveRelationLinks
    };
  }
  const rawHierarchy: HierNode = d3.hierarchy<SyntaxNode>(clonedRawCanvas);
  applyVizIds(rawHierarchy);
  const semanticVisibleNodeIds = (() => {
    if (!usesLayoutScaffold)
      return null;
    const semanticCanvas = stabilizeReplayOvertLeafIds(buildDerivationCanvasData(forest, identity), identity);
    const clonedSemanticCanvas = cloneSyntaxTree(semanticCanvas);
    if (!clonedSemanticCanvas)
      return new Set<string>();
    const semanticHierarchy: HierNode = d3.hierarchy<SyntaxNode>(clonedSemanticCanvas);
    applyVizIds(semanticHierarchy);
    return new Set<string>(semanticHierarchy
      .descendants()
      .filter((node) => !isSyntheticWorkspaceRootNode(node))
      .map((node) => getNodeId(node)));
  })();
  const effectiveVisibleNodeIds: Set<string> = visibleNodeIds && visibleNodeIds.size > 0
    ? visibleNodeIds
    : semanticVisibleNodeIds || new Set<string>(rawHierarchy
      .descendants()
      .filter((node) => !isSyntheticWorkspaceRootNode(node))
      .map((node) => getNodeId(node)));
  const effectiveLayoutNodeIds = usesLayoutScaffold
    ? new Set<string>([
      ...rawHierarchy
        .descendants()
        .filter((node) => !isSyntheticWorkspaceRootNode(node))
        .map((node) => getNodeId(node)),
      ...(layoutNodeIds ? Array.from(layoutNodeIds) : [])
    ])
    : layoutNodeIds && layoutNodeIds.size > 0
      ? layoutNodeIds
      : effectiveVisibleNodeIds;
  const visibleRawCanvas = buildVisibleSyntaxSnapshotFromHierarchy({
    root: rawHierarchy,
    visibleNodeIds: effectiveLayoutNodeIds,
    detachedRootSideHints,
    identity
  });
  const renderableCanvas = visibleRawCanvas
    ? materializeReplayPreterminals(visibleRawCanvas, identity)
    : (buildRenderableDerivationCanvasData(forest, identity)
      || materializeReplayPreterminals(clonedRawCanvas, identity));
  const clonedRenderableCanvas = cloneSyntaxTree(renderableCanvas);
  if (!clonedRenderableCanvas) {
    return {
      canvasData: null,
      visibleNodeIds: [],
      relationLinks: effectiveRelationLinks
    };
  }
  const renderableHierarchy: HierNode = d3.hierarchy<SyntaxNode>(clonedRenderableCanvas);
  applyVizIds(renderableHierarchy);
  const renderableVisibleNodeIds = new Set<string>(collectRenderableVisibleNodeIds(renderableHierarchy, effectiveVisibleNodeIds));
  if (effectiveVisibleNodeIds && effectiveVisibleNodeIds.size > 0) {
    const renderableNodesById = new Map<string, HierNode>(renderableHierarchy
      .descendants()
      .filter((node) => !isSyntheticWorkspaceRootNode(node))
      .map((node) => [getNodeId(node), node] as const));
    effectiveVisibleNodeIds.forEach((requestedId) => {
      const normalizedRequestedId = String(requestedId || '');
      if (!normalizedRequestedId)
        return;
      const exactNode = renderableNodesById.get(normalizedRequestedId);
      if (exactNode && exactNode.children && exactNode.children.length > 0) {
        const exactNodeId = getNodeId(exactNode);
        exactNode.children.forEach((child) => {
          const childId = getNodeId(child);
          if (!isReplayDisplayChild(child.data, exactNodeId))
            return;
          if ((child.data as any)?.replayLayoutOnly)
            return;
          renderableVisibleNodeIds.add(childId);
        });
      }
    });
  }
  const replayVisibleNodeIds = Array.from(renderableVisibleNodeIds)
    .filter((nodeId) => {
      // Visibility belongs to the exact rendered occurrence. Alias-aware lookup
      // can resolve a future layout-only landing id to its current lower copy
      // and accidentally reveal the future occurrence one relation too early.
      const node = findExactNodeByIdInForest([renderableCanvas], nodeId);
      return !(node as any)?.replayLayoutOnly;
    });
  return {
    canvasData: renderableCanvas,
    visibleNodeIds: replayVisibleNodeIds,
    relationLinks: effectiveRelationLinks
  };
};

export const EXPLICIT_NULL_TERMINAL = '∅';

const buildSyntheticReplayLeafId = (parent: SyntaxNode, suffix: string, word?: string): string => {
  const parentId = typeof parent?.id === 'string' ? parent.id : '';
  const parentLabel = String(parent?.label || 'node').trim().replace(/\s+/g, '_') || 'node';
  const leafWord = String(word || '').trim().replace(/\s+/g, '_');
  const stem = parentId || `${parentLabel}__${leafWord || 'leaf'}`;
  return `${stem}::__${suffix}`;
};
