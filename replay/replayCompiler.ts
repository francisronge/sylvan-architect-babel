import * as d3 from 'd3';
import { applyVizIds, getNodeId, createReplayIdentityContext, isReplayDisplayChild, replayOwnerId, type ReplayIdentityContext } from './displayIdentity.ts';
import { dispatchRelationClaims } from './relations/tier2RelationDispatch.ts';
import type { RecoveredMovement } from './relations/movementEvidence.ts';
import type { DerivationStageRelation } from '../types.ts';
import type { DerivationOperation, DerivationStage, ReplayDetailBlock, SurfaceRealization, SyntaxNode } from '../types.ts';
import { attachReplayRealizations, cloneRealizations } from './realizationReplay.ts';
import {
  isFrontingMovementIdentity,
  isMovementIdentity,
  isRegisteredFrontingTrajectoryRelation,
  isRegisteredTrajectoryRelation,
  movementIdentityKind,
  registeredTrajectoryDisplayKind
} from './relations/movementIdentities.ts';
import {
  PRODUCTION_RENDER_FAMILIES,
  TRAJECTORY_SOURCE_ROLES,
  TRAJECTORY_TARGET_ROLES,
  TRAJECTORY_WITNESS_ROLES,
  type ProductionTransitionKind
} from './relations/renderFamilies.ts';
import {
  findRelationRegistryEntry,
  productionRelationRegistry
} from './relationDispatch/index.js';
import type { ResolvedRelationLink, ResolvedRelationAnchor } from '../relationLinks.ts';
import {
  classifyRelationAnchors,
  resolveRelationAnchors
} from '../derivationReplayPlan.js';
import { tokenizeSentenceSurfaceOrder } from '../server/babelParser/surfaceTokens.js';
import {
  authoredWord,
  isLeafNode,
  isPronouncedLeaf,
  isSilentWordLeaf,
  isWordlessLeaf
} from '../server/babelParser/nodePronunciation.js';

export type HierNode = d3.HierarchyNode<SyntaxNode>;
export type VisibleLink = d3.HierarchyLink<SyntaxNode>;

export interface PlaybackStep {
  operation: DerivationOperation;
  sourceKind?: 'microstep' | 'derivation-effect' | 'derived';
  trajectoryKind?: ResolvedRelationLink['trajectoryKind'];
  movementSerializationStatus?: 'complete' | 'underspecified' | 'incoherent';
  movementDiagnostics?: string[];
  sourceFrameIndex?: number;
  visualFrameIndex?: number;
  replayFrameIndex?: number;
  replayKind?: 'micro' | 'relation' | 'macro';
  /**
   * Exact authored identity of the relation this Replay moment plays.
   * Placement interleaves relation moments with structural construction,
   * so a count of played moments is NOT a reliable identity — consumers must
   * reveal and focus plan items from this exact identity.
   */
  replayRelationIdentity?: { stageIndex: number; relationIndex: number };
  replayProgressLabel?: string;
  targetNodeId: string;
  targetLabel: string;
  sourceNodeIds?: string[];
  sourceLabels: string[];
  recipe?: string;
  workspaceAfter?: string[];
  detailBlocks?: ReplayDetailBlock[];
  stepId?: string;
  chainId?: string;
  note?: string;
  stageRecord?: string;
  replayCanvasData?: SyntaxNode | null;
  replayVisibleNodeIds?: string[];
  replayRelationLinks?: ResolvedRelationLink[];
  replayUsesFutureLayoutScaffold?: boolean;
  preserveReplayStep?: boolean;
  replaySuppressAutoRevealNodeIds?: string[];
  replayRealizations?: SurfaceRealization[];
  /** Inspection evidence only; never add these messages to the authored Replay panel. */
  replayRealizationDiagnostics?: string[];
}

export interface ReplaySupportLine {
  label: string;
  value: string;
}

export interface ReplayPanelContent {
  heading: string;
  supportLines: Array<ReplaySupportLine & { key: string }>;
  /** The original record, selected by identity rather than reconstructed from drawing links. */
  authoredRelation: DerivationStageRelation | null;
}

export const DERIVATION_WORKSPACE_ROOT_LABEL = '__DERIVATION_WORKSPACE__';
const DERIVATION_WORKSPACE_ROOT_ID = '__derivation_workspace_root__';

export interface MovementArrow {
  source: HierNode;
  /** The authored lower occurrence before display-endpoint resolution. */
  sourceOccurrence?: HierNode;
  target: HierNode;
  traceNode?: HierNode;
  step: number;
  index?: string | null;
  operation?: DerivationOperation;
  trajectoryKind?: ResolvedRelationLink['trajectoryKind'];
}

type MovementCopyTraceCandidate = {
  arrow: MovementArrow;
  authoredOrder: number;
  commonLineageIds: Set<string>;
  sourceNodeCount: number;
  lexicalLeaves: HierNode[];
};

interface DerivationMovementTransition {
  authoredLink: ResolvedRelationLink;
  sourceId: string;
  targetId: string;
  traceId: string | null;
  step: number;
  index: string;
  chainId?: string | null;
  operation?: DerivationOperation;
  trajectoryKind?: ResolvedRelationLink['trajectoryKind'];
  note?: string;
}

interface ReplayDerivationMovementPayload {
  operation?: DerivationOperation;
  sourceNodeId?: string;
  landingNodeId?: string;
  targetNodeId?: string;
  hostNodeId?: string;
  traceNodeId?: string;
  chainId?: string;
  note?: string;
  serializationStatus?: 'complete' | 'underspecified' | 'incoherent';
  diagnostics?: string[];
}

interface ReplayDerivationAnchor {
  role?: string;
  nodeId?: string;
  lineageId?: string;
  value?: string;
  text?: string;
  [key: string]: unknown;
}

interface ReplayDerivationChange {
  statement?: string;
  anchors?: ReplayDerivationAnchor[];
  continuityIds?: string[];
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ReplayDerivationAfterState {
  workspaceForest?: SyntaxNode[];
  reusePreviousWorkspace?: boolean;
  realizations?: SurfaceRealization[];
}

export interface ReplayDerivationFrame {
  frameId?: string;
  stepId?: string;
  statement?: string;
  stageRecord?: string;
  relations?: DerivationStage['relations'];
  after?: ReplayDerivationAfterState;
  change?: ReplayDerivationChange;
  workspaceForest: SyntaxNode[];
  operation?: DerivationOperation;
  recipe?: string;
  chainId?: string;
  movement?: ReplayDerivationMovementPayload | null;
}

interface DerivationReplayPlanStep {
  registeredEntryId?: string;
  /** Exact evidence owned by the neutral primary, excluding recovered sibling claims. */
  neutralTransitionEvidence?: Pick<DerivationStageRelation, 'anchors' | 'priorAnchors'>;
  recoveredMovement?: RecoveredMovement & { drawTrajectory: boolean };
  pronunciationNodeIds?: string[];
  movementDiagnostics?: string[];
  kind?: 'micro' | 'relation' | 'macro';
  stageIndex?: number;
  stageNumber?: number;
  stageStepNumber?: number;
  stageStepCount?: number;
  progressLabel?: string;
  relation?: string;
  anchors?: Record<string, unknown>;
  /** Authored previous-stage witnesses, verbatim when authored. */
  priorAnchors?: Record<string, string | string[]>;
  /** Authored literal payload, verbatim when authored. */
  values?: Record<string, string | string[]>;
  authoredRelationIndex?: number;
  resolvedAnchors?: ReplayResolvedRelationAnchor[];
  /** Authored anchors whose exact id is absent from this stage's workspace; reported, never repaired. */
  unresolvedAnchors?: ReplayUnresolvedRelationAnchor[];
  sourceNodeIds?: string[];
  targetNodeId?: string;
  stageRecord?: string;
}

interface ReplayUnresolvedRelationAnchor {
  role: string;
  nodeId: string;
  authoredAnchorIndex: number;
  fieldPath: string;
}

interface ReplayResolvedRelationAnchor extends ResolvedRelationAnchor {
  authoredAnchorIndex: number;
}

interface ReplayAuthoredRelationLink extends ResolvedRelationLink {
  authoredRelationIndex: number;
  authoredRelationKey: string;
  endpointOrderProvenance?: 'authored-anchor-order' | 'registered-role-order' | 'recovered-movement';
  identityKey?: string;
  identityProvenance?: 'authored-shared-lineage';
  relationIndexProvenance: 'derived-presentation';
}

interface DerivationReplayPlanStage {
  stageIndex: number;
  stageNumber: number;
  statement?: string;
  stageRecord?: string;
  relationSteps?: DerivationReplayPlanStep[];
  macroStep?: DerivationReplayPlanStep;
  realizations?: SurfaceRealization[];
}

export interface DerivationReplayPlan {
  stages?: DerivationReplayPlanStage[];
  steps?: DerivationReplayPlanStep[];
}

export { applyVizIds, getNodeId } from './displayIdentity.ts';

/**
 * Index laid-out syntax by its current renderer id and by every preserved
 * authored alias. An id that names more than one node is omitted entirely:
 * relation geometry must fail closed instead of choosing by traversal order.
 */
export const indexHierarchyNodesByIdAndAliases = <T extends HierNode>(
  nodes: readonly T[]
): Map<string, T> => {
  const candidates = new Map<string, T | null>();
  nodes.forEach((node) => {
    const ids = Array.from(new Set([
      getNodeId(node),
      node.data?.id,
      ...(Array.isArray(node.data?.aliasIds) ? node.data.aliasIds : [])
    ].map((id) => String(id || '').trim()).filter(Boolean)));
    ids.forEach((id) => {
      if (!candidates.has(id)) {
        candidates.set(id, node);
        return;
      }
      if (candidates.get(id) !== node) candidates.set(id, null);
    });
  });
  return new Map(
    Array.from(candidates.entries())
      .filter((entry): entry is [string, T] => Boolean(entry[1]))
  );
};
export const STEP_DELAY_MS = 1000;
export const MOVEMENT_ARROW_COLOR = '#10b981';
export const MOVEMENT_ARC_STROKE = 2.6;

export const isSyntheticWorkspaceRootNode = (node: HierNode): boolean =>
  node.data?.replayOrigin?.kind === 'workspace';

export const buildDerivationCanvasData = (forest: SyntaxNode[], identity = createReplayIdentityContext(forest)): SyntaxNode | null => {
  if (!Array.isArray(forest) || forest.length === 0) return null;
  const replayOrigin = { kind: 'workspace' } as const;
  return forest.length === 1 ? forest[0] : {
    id: identity.allocate(DERIVATION_WORKSPACE_ROOT_ID, replayOrigin),
    label: DERIVATION_WORKSPACE_ROOT_LABEL,
    replayOrigin,
    children: forest
  };
};

const normalizeReplayStableIdPart = (value?: string | number | null): string =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'leaf';

const shouldStabilizeReplayLeafId = (node?: SyntaxNode | null): boolean => {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node.children) && node.children.length > 0) return false;
  if (!isPronouncedLeaf(node) || !String(node.label || '').trim()) return false;
  if (shouldExpandPreterminalLeaf(node)) return false;
  return true;
};

const stabilizeReplayOvertLeafIds = (node?: SyntaxNode | null, identity = createReplayIdentityContext(node ? [node] : [])): SyntaxNode | null => {
  if (!node || typeof node !== 'object') return null;

  const walk = (current: SyntaxNode, parentId: string): SyntaxNode => {
    const ownId = String(current.id ?? '').trim();
    const ownStableParentId = ownId || parentId;
    const children = Array.isArray(current.children)
      ? current.children
          .filter((child): child is SyntaxNode => Boolean(child && typeof child === 'object'))
          .map((child) => walk(child, ownStableParentId))
      : [];
    const next: SyntaxNode = { ...current };
    if (ownId && ownId !== String(current.id || '').trim()) {
      next.id = ownId;
    }
    if (children.length > 0) {
      next.children = children;
      return next;
    }
    delete next.children;
    if (!parentId || current.replayOrigin || !shouldStabilizeReplayLeafId(current)) return next;

    const tokenIndex = Number.isInteger((current as any).tokenIndex)
      ? `tok_${(current as any).tokenIndex}`
      : '';
    const surfaceKey = normalizeReplayStableIdPart(current.word || current.label);
    const stableKey = tokenIndex ? `${tokenIndex}_${surfaceKey}` : surfaceKey;
    next.aliasIds = Array.from(new Set([
      ...(Array.isArray(current.aliasIds) ? current.aliasIds : []),
      String(current.id || '').trim()
    ].filter(Boolean)));
    next.replayOrigin = { kind: 'lexical', ownerId: parentId, authoredId: typeof current.id === 'string' ? current.id : ownId };
    next.id = identity.allocate(`${parentId}::__lex_${stableKey}`, next.replayOrigin);
    return next;
  };

  return walk(node, '');
};

export const buildRenderableDerivationCanvasData = (
  forest: SyntaxNode[],
  _resolvedRelationLinks?: ResolvedRelationLink[],
  identity = createReplayIdentityContext(forest)
): SyntaxNode | null => {
  const canvas = buildDerivationCanvasData(forest, identity);
  if (!canvas) return null;
  const stableReplayCanvas = stabilizeReplayOvertLeafIds(canvas, identity) || canvas;
  return materializeReplayPreterminals(stableReplayCanvas, identity);
};

export const buildRenderableCommittedCanvasData = (
  tree: SyntaxNode,
  _resolvedRelationLinks?: ResolvedRelationLink[]
): SyntaxNode => {
  return materializeReplayPreterminals(projectAuthoredSyntaxNode(tree));
};

const getMovementLandingNodeId = (
  movement?: { landingNodeId?: string; targetNodeId?: string; toNodeId?: string } | null
): string => String(
  movement?.landingNodeId
  || movement?.targetNodeId
  || movement?.toNodeId
  || ''
).trim();

const getDerivationFrameChange = (frame?: ReplayDerivationFrame | null): ReplayDerivationChange | null =>
  frame?.change && typeof frame.change === 'object' && !Array.isArray(frame.change)
    ? frame.change
    : null;

const cloneSyntaxForest = (forest: SyntaxNode[] = []): SyntaxNode[] =>
  forest
    .map((root) => cloneSyntaxTree(root))
    .filter((root): root is SyntaxNode => Boolean(root));

const AUTHORED_SYNTAX_NODE_FIELDS = ['id', 'label', 'word', 'tokenIndex', 'silent', 'lineageId', 'surfaceSpan', 'refId'] as const;

/**
 * Keeps only the contract fields of an authored node. Renderer metadata such
 * as `ghost`, `replayLayoutOnly`, `aliasIds` and `__vizId` can then originate
 * only inside Replay; an authored key with one of those names is inert.
 */
export const projectAuthoredSyntaxNode = (node: SyntaxNode): SyntaxNode => {
  const next: Record<string, unknown> = {};
  AUTHORED_SYNTAX_NODE_FIELDS.forEach((field) => {
    if (Object.hasOwn(node, field)) next[field] = (node as unknown as Record<string, unknown>)[field];
  });
  if (Array.isArray(node.children)) {
    next.children = node.children
      .filter((child): child is SyntaxNode => Boolean(child && typeof child === 'object'))
      .map(projectAuthoredSyntaxNode);
  }
  return next as unknown as SyntaxNode;
};

export const adaptDerivationStagesForReplay = (stages?: DerivationStage[] | null): ReplayDerivationFrame[] => {
  if (!Array.isArray(stages) || stages.length === 0) return [];
  return stages.map((stage, index) => {
    const explicitWorkspaceForest = Array.isArray(stage.workspaceForest) ? stage.workspaceForest : [];
    const workspaceForest = cloneSyntaxForest(explicitWorkspaceForest).map(projectAuthoredSyntaxNode);
    const relations = Array.isArray(stage.relations) ? stage.relations : [];
    const details = {
      stageRecord: String(stage.stageRecord || '').trim(),
      derivationStageRelations: relations
    };
    const change: ReplayDerivationChange = {
      statement: String(stage.statement || '').trim(),
      details
    };

    return {
      frameId: `stage-${index + 1}`,
      stepId: `stage-${index + 1}`,
      statement: String(stage.statement || '').trim(),
      stageRecord: String(stage.stageRecord || '').trim(),
      relations,
      after: { workspaceForest,
        ...(Array.isArray(stage.realizations) ? { realizations: cloneRealizations(stage.realizations) } : {}) },
      change,
      workspaceForest,
      recipe: String(change?.statement || '').trim() || undefined,
      movement: null
    };
  });
};

export const collectVisibleDerivationNodeIds = (
  forest: SyntaxNode[],
  resolvedRelationLinks?: ResolvedRelationLink[],
  identity = createReplayIdentityContext(forest)
): Set<string> => {
  const canvas = buildRenderableDerivationCanvasData(forest, resolvedRelationLinks, identity);
  const cloned = cloneSyntaxTree(canvas);
  if (!cloned) return new Set<string>();
  const hierarchy = d3.hierarchy(cloned);
  applyVizIds(hierarchy);
  return new Set(
    hierarchy
      .descendants()
      .filter((node) => !isSyntheticWorkspaceRootNode(node))
      .map((node) => getNodeId(node))
  );
};

const buildVisibleSyntaxSnapshotFromHierarchy = (
  root: HierNode,
  visibleNodeIds?: Set<string>,
  detachedRootIds?: Set<string>,
  detachedRootSideHints?: Map<string, number>,
  identity = createReplayIdentityContext([root.data])
): SyntaxNode | null => {
  if (!visibleNodeIds || visibleNodeIds.size === 0) return null;

  const nodeMatchesVisibleId = (node: HierNode): boolean => {
    const nodeId = getNodeId(node);
    if (visibleNodeIds.has(nodeId)) return true;
    return (Array.isArray(node.data?.aliasIds) ? node.data.aliasIds : [])
      .map((aliasId) => String(aliasId || '').trim())
      .filter(Boolean)
      .some((aliasId) => visibleNodeIds.has(aliasId));
  };

  const cloneVisibleNode = (node: HierNode): SyntaxNode | null => {
    if (!nodeMatchesVisibleId(node)) return null;
    // Children are rebuilt below; copying their entire subtrees here is quadratic.
    const { children: _children, ...material } = node.data;
    const dataClone = cloneSyntaxTree(material);
    if (!dataClone) return null;
    const childSnapshots = (node.children || [])
      .map((child) => {
        const childId = getNodeId(child);
        if (detachedRootIds?.has(childId) && visibleNodeIds.has(childId)) {
          return null;
        }
        return cloneVisibleNode(child);
      })
      .filter((child): child is SyntaxNode => Boolean(child));
    if (childSnapshots.length > 0) {
      dataClone.children = childSnapshots;
    } else {
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
      const nodeId = getNodeId(node);
      const detached = detachedRootIds?.has(nodeId);
      if (detached) return true;
      const parent = node.parent;
      if (!parent || isSyntheticWorkspaceRootNode(parent)) return true;
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
          if (detachedRootIds?.has(currentId)) {
            return 0;
          }
          current = current.parent;
        }
        return 0;
      };
      const sideA = resolveDetachedRootSideHint(a);
      const sideB = resolveDetachedRootSideHint(b);
      if (sideA !== sideB) return sideA - sideB;
      return (preorderIndex.get(getNodeId(a)) ?? 0) - (preorderIndex.get(getNodeId(b)) ?? 0);
    });

  const forest = visibleRoots
    .map((node) => cloneVisibleNode(node))
    .filter((node): node is SyntaxNode => Boolean(node));

  if (forest.length === 0) return null;
  if (forest.length === 1) return forest[0];
  return buildDerivationCanvasData(forest, identity);
};

const collectRenderableVisibleNodeIds = (
  root: HierNode,
  rawVisibleNodeIds?: Set<string>
): string[] => {
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
        .map((aliasId) => String(aliasId || '').trim())
        .filter(Boolean)
        .forEach((aliasId) => nodesById.set(aliasId, node));
    });
  const visibleIds = new Set<string>();
  const markRenderableNode = (node: HierNode) => {
    if (isSyntheticWorkspaceRootNode(node)) return;
    const nodeId = getNodeId(node);
    visibleIds.add(nodeId);
    // Materialized preterminals add synthetic display leaves under authored leaf ids.
    // Show those leaves, but do not auto-reveal ordinary authored descendants.
    (node.children || []).forEach((child) => {
      const childId = getNodeId(child);
      if (isReplayDisplayChild(child.data, nodeId)) visibleIds.add(childId);
    });
  };

  rawVisibleNodeIds.forEach((requestedId) => {
    const normalizedRequestedId = String(requestedId || '').trim();
    if (!normalizedRequestedId) return;

    const exactNode = nodesById.get(normalizedRequestedId);
    if (exactNode) {
      markRenderableNode(exactNode);
      return;
    }


  });

  return visibleIds.size > 0 ? Array.from(visibleIds) : allRenderableNodeIds;
};

const extractReplayWorkspaceLabels = (canvasData: SyntaxNode | null): string[] => {
  if (!canvasData) return [];
  const roots = canvasData.replayOrigin?.kind === 'workspace'
    ? (Array.isArray(canvasData.children) ? canvasData.children : [])
    : [canvasData];
  return roots
    .map((node) => String(node?.label || '').trim())
    .filter(Boolean);
};

const getReplayLeafSelectionTarget = (
  root: SyntaxNode, identity: ReplayIdentityContext
): { nodeId: string; surface: string } | null => {
  const renderableRoot = buildRenderableDerivationCanvasData([cloneSyntaxTree(root) || root], undefined, identity);
  if (!renderableRoot) return null;
  const hierarchy = d3.hierarchy(renderableRoot);
  applyVizIds(hierarchy);
  const leaf = hierarchy.descendants().find((node) => !node.children || node.children.length === 0);
  if (!leaf) return null;
  const surface = resolveLeafSurface(leaf);
  if (!surface) return null;
  return {
    nodeId: getNodeId(leaf),
    surface
  };
};

const materializeReplayPreterminals = (node: SyntaxNode, identity = createReplayIdentityContext([node])): SyntaxNode => {
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
      if (Array.isArray(current.children)) next.children = [];
      return next;
    }

    if (shouldExpandPreterminalLeaf(current)) {
      const replayOrigin = { kind: 'word', ownerId: current.id } as const;
      next.children = [{
        id: identity.allocate(buildSyntheticReplayLeafId(current, 'leaf', word), replayOrigin),
        replayOrigin,
        label: word,
        word,
        ...(String(current.lineageId || '').trim() ? { lineageId: current.lineageId } : {}),
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

export const buildDerivationReplaySnapshot = (
  forest: SyntaxNode[],
  activeFrameIndex: number,
  relationLinks?: ResolvedRelationLink[],
  visibleNodeIds?: Set<string>
  ,
  layoutNodeIds?: Set<string>,
  derivationFrames?: ReplayDerivationFrame[],
  detachedRootIds?: Set<string>,
  detachedRootSideHints?: Map<string, number>,
  layoutScaffoldForest?: SyntaxNode[],
  identity = createReplayIdentityContext(derivationFrames?.flatMap(frame => frame.workspaceForest || []) ?? forest)
): {
  canvasData: SyntaxNode | null;
  visibleNodeIds: string[];
  relationLinks: ResolvedRelationLink[];
} => {
  const transitionInputLinks = Array.isArray(relationLinks)
    ? relationLinks
    : [];
  const transitionLinks = resolveDerivationMovementTransitions(
    forest,
    derivationFrames,
    activeFrameIndex,
    transitionInputLinks
  ).map((transition) => ({
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
  const rawCanvas = stabilizeReplayOvertLeafIds(buildDerivationCanvasData(
    usesLayoutScaffold ? layoutScaffoldForest : forest, identity
  ), identity);
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
    if (!usesLayoutScaffold) return null;
    const semanticCanvas = stabilizeReplayOvertLeafIds(buildDerivationCanvasData(forest, identity), identity);
    const clonedSemanticCanvas = cloneSyntaxTree(semanticCanvas);
    if (!clonedSemanticCanvas) return new Set<string>();
    const semanticHierarchy: HierNode = d3.hierarchy<SyntaxNode>(clonedSemanticCanvas);
    applyVizIds(semanticHierarchy);
    return new Set<string>(
      semanticHierarchy
        .descendants()
        .filter((node) => !isSyntheticWorkspaceRootNode(node))
        .map((node) => getNodeId(node))
    );
  })();
  const effectiveVisibleNodeIds: Set<string> = visibleNodeIds && visibleNodeIds.size > 0
    ? visibleNodeIds
    : semanticVisibleNodeIds || new Set<string>(
        rawHierarchy
          .descendants()
          .filter((node) => !isSyntheticWorkspaceRootNode(node))
          .map((node) => getNodeId(node))
      );
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
  const visibleRawCanvas = buildVisibleSyntaxSnapshotFromHierarchy(
    rawHierarchy,
    effectiveLayoutNodeIds,
    detachedRootIds,
    detachedRootSideHints,
    identity
  );
  const renderableCanvas = visibleRawCanvas
    ? materializeReplayPreterminals(visibleRawCanvas, identity)
    : (
      buildRenderableDerivationCanvasData(forest, effectiveRelationLinks, identity)
      || materializeReplayPreterminals(clonedRawCanvas, identity)
    );
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
  const renderableVisibleNodeIds = new Set<string>(collectRenderableVisibleNodeIds(
    renderableHierarchy,
    effectiveVisibleNodeIds
  ));
  if (effectiveVisibleNodeIds && effectiveVisibleNodeIds.size > 0) {
    const renderableNodesById = new Map<string, HierNode>(
      renderableHierarchy
        .descendants()
        .filter((node) => !isSyntheticWorkspaceRootNode(node))
        .map((node) => [getNodeId(node), node] as const)
    );
    effectiveVisibleNodeIds.forEach((requestedId) => {
      const normalizedRequestedId = String(requestedId || '').trim();
      if (!normalizedRequestedId) return;
      const exactNode = renderableNodesById.get(normalizedRequestedId);
      if (exactNode && exactNode.children && exactNode.children.length > 0) {
        const exactNodeId = getNodeId(exactNode);
        exactNode.children.forEach((child) => {
          const childId = getNodeId(child);
          if (!isReplayDisplayChild(child.data, exactNodeId)) return;
          if ((child.data as any)?.replayLayoutOnly) return;
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

export const hidePendingInflSpecifierWrappersInStep = (step: PlaybackStep): PlaybackStep => {
  const visibleIds = new Set(
    (Array.isArray(step.replayVisibleNodeIds) ? step.replayVisibleNodeIds : [])
      .map((nodeId) => String(nodeId || '').trim())
      .filter(Boolean)
  );
  const protectedRelationEndpointIds = new Set<string>();
  (Array.isArray(step.replayRelationLinks) ? step.replayRelationLinks : []).forEach((link) => {
    [
      String(link?.sourceNodeId || '').trim(),
      String(link?.targetNodeId || '').trim(),
      String(link?.witnessNodeId || '').trim()
    ].filter(Boolean).forEach((nodeId) => protectedRelationEndpointIds.add(nodeId));
  });
  const canvasRoot = step.replayCanvasData || null;
  if (!canvasRoot || visibleIds.size === 0) return step;

  const hiddenIds = new Set<string>();
  const walk = (node: SyntaxNode) => {
    const nodeId = String(node?.id || '').trim();
    const label = String(node?.label || '').trim().toLowerCase();
    const children = Array.isArray(node?.children) ? node.children : [];
    if (nodeId && visibleIds.has(nodeId) && ['infl', 'ip', 't', 'tp'].includes(label)) {
      if (children.length === 1) {
        const onlyChild = children[0];
        if (
          visibleIds.has(String(onlyChild?.id || '').trim())
          && String(onlyChild?.label || '').trim().toLowerCase() === label
        ) {
          if (!protectedRelationEndpointIds.has(nodeId)) hiddenIds.add(nodeId);
        }
      } else if (children.length > 1) {
        const spineChildIndex = children.findIndex((child, index) =>
          index > 0
          && visibleIds.has(String(child?.id || '').trim())
          && String(child?.label || '').trim().toLowerCase() === label
        );
        if (spineChildIndex > 0) {
          const hasVisibleSpecifierMaterial = children
            .slice(0, spineChildIndex)
            .some((child) => {
              let found = false;
              const scan = (candidate: SyntaxNode) => {
                if (visibleIds.has(String(candidate?.id || '').trim())) {
                  found = true;
                  return;
                }
                (candidate.children || []).forEach(scan);
              };
              scan(child);
              return found;
            });
          if (!hasVisibleSpecifierMaterial && !protectedRelationEndpointIds.has(nodeId)) hiddenIds.add(nodeId);
        }
      }
    }
    children.forEach(walk);
  };
  walk(canvasRoot);

  if (hiddenIds.size === 0) return step;
  const markHiddenInflWrappersAsLayoutOnly = (node: SyntaxNode): SyntaxNode | null => {
    const nodeId = String(node?.id || '').trim();
    const children = Array.isArray(node?.children) ? node.children : [];
    const nextNode = { ...node };
    if (nodeId && hiddenIds.has(nodeId)) {
      (nextNode as any).replayLayoutOnly = true;
    }
    if (children.length > 0) {
      nextNode.children = children
        .map(markHiddenInflWrappersAsLayoutOnly)
        .filter(Boolean) as SyntaxNode[];
    }
    return nextNode;
  };
  const replayCanvasData = markHiddenInflWrappersAsLayoutOnly(canvasRoot) || canvasRoot;
  return {
    ...step,
    replayCanvasData,
    replayVisibleNodeIds: (step.replayVisibleNodeIds || []).filter((nodeId) =>
      !hiddenIds.has(String(nodeId || '').trim())
    )
  };
};

export const cloneSyntaxTree = (node?: SyntaxNode | null): SyntaxNode | null => {
  if (!node || typeof node !== 'object') return null;
  const serialized = JSON.stringify(node);
  if (!serialized) return null;
  return JSON.parse(serialized) as SyntaxNode;
};

/** The first non-blank authored text. Prose is never classified as boilerplate. */
const pickPreferredReplayText = (...values: Array<string | undefined | null>): string | undefined => {
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (trimmed) return trimmed;
  }
  return undefined;
};

const formatReplayLabelSeries = (labels: string[]): string => {
  const cleaned = labels.map((label) => String(label || '').trim()).filter(Boolean);
  if (cleaned.length === 0) return '';
  if (cleaned.length === 1) return cleaned[0];
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(', ')}, and ${cleaned[cleaned.length - 1]}`;
};

const buildStructuralReplayFallback = (
  operation: DerivationOperation | string | undefined,
  primaryRootLabel: string,
  rootLabels: string[]
): string => {
  const op = String(operation || '').trim();
  const readableOperation = formatOperationLabel(op as DerivationOperation);
  const target = primaryRootLabel || rootLabels[0] || 'workspace';
  const targetSummary = rootLabels.length > 1 ? rootLabels.join(' + ') : target;
  const targetIsTraceLike = isTraceLike(target) || isNullLike(target);
  const describesWorkspaceState = target === 'Workspace';
  switch (op) {
    case 'LexicalSelect':
      return `Select ${targetSummary}`;
    case 'Project':
      return `Project ${targetSummary}`;
    case 'ExternalMerge':
      if (targetIsTraceLike) return 'External merge in workspace';
      if (describesWorkspaceState) {
        const mergeSourceSummary = formatReplayLabelSeries(rootLabels);
        return mergeSourceSummary ? `External merge of ${mergeSourceSummary}` : 'External merge in workspace';
      }
      return `External merge into ${target}`;
    case 'InternalMerge':
    case 'Move':
      return (targetIsTraceLike || describesWorkspaceState || isGenericReplayStructuralLabel(target)) ? 'Internal merge' : `Internal merge to ${target}`;
    case 'A-Move':
      return (targetIsTraceLike || describesWorkspaceState || isGenericReplayStructuralLabel(target)) ? 'A-movement' : `A-movement to ${target}`;
    case 'AbarMove':
      return (targetIsTraceLike || describesWorkspaceState || isGenericReplayStructuralLabel(target)) ? 'A-bar movement' : `A-bar movement to ${target}`;
    case 'HeadMove':
      return (targetIsTraceLike || describesWorkspaceState || isGenericReplayStructuralLabel(target)) ? 'Head movement' : `Head movement to ${target}`;
    case 'Agree':
      return `Agree on ${target}`;
    case 'Other':
      return target && target !== 'Workspace' ? `Establish ${target}` : 'Update derivational workspace';
    default:
      if (!op) return target && target !== 'Workspace' ? `Establish ${target}` : 'Update derivational workspace';
      if (/(?:move|movement|raise|lower|front|displac|extract|shift|scrambl|rollup|sideward|incorpor|clitic|affix|remnant|piedpip|topicaliz|focaliz|extraposit|atb|remerge)/i.test(op)) {
        return readableOperation;
      }
      return target && target !== 'Workspace'
        ? `${readableOperation} to ${target}`
        : readableOperation;
  }
};

const reorderWorkspaceRootsForReplay = (
  workspaceRoots: SyntaxNode[],
  preferredRootIds?: string[] | null
): SyntaxNode[] => {
  if (!Array.isArray(workspaceRoots) || workspaceRoots.length <= 1) return workspaceRoots;
  const preferredIds = Array.isArray(preferredRootIds)
    ? preferredRootIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  if (preferredIds.length === 0) return workspaceRoots;

  const rootsById = new Map(
    workspaceRoots
      .map((node) => [String(node?.id || '').trim(), node] as const)
      .filter(([id]) => Boolean(id))
  );
  const ordered: SyntaxNode[] = [];
  const used = new Set<string>();

  preferredIds.forEach((id) => {
    const node = rootsById.get(id);
    if (!node || used.has(id)) return;
    ordered.push(node);
    used.add(id);
  });

  workspaceRoots.forEach((node) => {
    const id = String(node?.id || '').trim();
    if (id && used.has(id)) return;
    ordered.push(node);
  });

  return ordered.length === workspaceRoots.length ? ordered : workspaceRoots;
};

const collectWorkspaceRootIds = (workspaceRoots: SyntaxNode[]): string[] =>
  (Array.isArray(workspaceRoots) ? workspaceRoots : [])
    .map((node) => String(node?.id || '').trim())
    .filter(Boolean);

const collectWorkspaceRootParents = (forest: SyntaxNode[], rootIds: ReadonlySet<string>) => {
  const parents = new Map<string, SyntaxNode | null>();
  const visit = (node: SyntaxNode, parent: SyntaxNode | null) => {
    const nodeId = String(node.id || '').trim();
    if (rootIds.has(nodeId)) parents.set(nodeId, parent);
    (node.children || []).forEach(child => visit(child, node));
  };
  forest.forEach(root => visit(root, null));
  return parents;
};

const preservesRelativeSiblingOrder = (before: SyntaxNode[], after: SyntaxNode[]): boolean => {
  const beforeIds = collectWorkspaceRootIds(before), afterIds = collectWorkspaceRootIds(after);
  const beforeSet = new Set(beforeIds), afterSet = new Set(afterIds);
  return JSON.stringify(beforeIds.filter(id => afterSet.has(id)))
    === JSON.stringify(afterIds.filter(id => beforeSet.has(id)));
};

const replayLayoutTreeSignature = (
  node: SyntaxNode | null | undefined,
  describe: (node: SyntaxNode) => string
): string => {
  // Serialize the nested structure once. Serializing each child signature
  // again at every parent makes quote escaping grow exponentially with depth.
  const shape = (current?: SyntaxNode | null): unknown => !current || typeof current !== 'object'
    ? ''
    : [describe(current), (Array.isArray(current.children) ? current.children : []).map(shape)];
  return JSON.stringify(shape(node));
};

const replayLayoutContinuitySignature = (node?: SyntaxNode | null): string =>
  replayLayoutTreeSignature(node, replayLayoutMaterialSignature);

const replayLayoutTopologySignature = (node?: SyntaxNode | null): string =>
  replayLayoutTreeSignature(node, current => String(current.id || '').trim());

const replayLayoutMaterialSignature = (node?: SyntaxNode | null): string => {
  if (!node || typeof node !== 'object') return '';
  return JSON.stringify([
    String(node.id || '').trim(),
    String(node.label || '').trim(),
    String(node.word || '').trim(),
    node.silent === true,
    Number.isFinite(Number(node.tokenIndex)) ? Number(node.tokenIndex) : null,
    String(node.lineageId || '').trim()
  ]);
};

const findExactNodesByIdInForest = (
  forest: SyntaxNode[],
  targetNodeId: string
): SyntaxNode[] => {
  const normalizedTargetNodeId = String(targetNodeId || '').trim();
  if (!normalizedTargetNodeId) return [];
  const matches: SyntaxNode[] = [];
  const visit = (node?: SyntaxNode | null) => {
    if (!node || typeof node !== 'object') return;
    if (String(node.id || '').trim() === normalizedTargetNodeId) matches.push(node);
    (Array.isArray(node.children) ? node.children : []).forEach(visit);
  };
  (Array.isArray(forest) ? forest : []).forEach(visit);
  return matches;
};

const forestCanUseFutureLayoutScaffold = (
  currentRoots: SyntaxNode[],
  futureRoots: SyntaxNode[]
): boolean => {
  if (!Array.isArray(currentRoots) || currentRoots.length === 0) return false;
  if (!Array.isArray(futureRoots) || futureRoots.length === 0) return false;
  return currentRoots.every((currentRoot) => {
    const currentRootId = String(currentRoot?.id || '').trim();
    if (!currentRootId) return false;
    const futureMatches = findExactNodesByIdInForest(futureRoots, currentRootId);
    return futureMatches.length === 1
      && replayLayoutContinuitySignature(futureMatches[0])
        === replayLayoutContinuitySignature(currentRoot);
  });
};

const futureForestPreservesCurrentRootIdentities = (
  currentRoots: SyntaxNode[],
  futureRoots: SyntaxNode[]
): boolean => currentRoots.every((currentRoot) => {
  const currentRootId = String(currentRoot?.id || '').trim();
  return Boolean(currentRootId)
    && findExactNodesByIdInForest(futureRoots, currentRootId).length === 1;
});

const collectExactNodesByIdInForest = (forest: SyntaxNode[]): Map<string, SyntaxNode[]> => {
  const nodesById = new Map<string, SyntaxNode[]>();
  const visit = (node?: SyntaxNode | null) => {
    if (!node || typeof node !== 'object') return;
    const nodeId = String(node.id || '').trim();
    if (nodeId) {
      const matches = nodesById.get(nodeId) || [];
      matches.push(node);
      nodesById.set(nodeId, matches);
    }
    (Array.isArray(node.children) ? node.children : []).forEach(visit);
  };
  (Array.isArray(forest) ? forest : []).forEach(visit);
  return nodesById;
};

/**
 * A layout scaffold may add hidden future parents and siblings, but it must
 * preserve every current node's exact authored material. This prevents a
 * future casing, silence, or token-order state from leaking into Replay.
 */
const forestCanUseCurrentMaterialLayoutScaffold = (
  currentRoots: SyntaxNode[],
  scaffoldRoots: SyntaxNode[]
): boolean => {
  if (!Array.isArray(currentRoots) || currentRoots.length === 0) return false;
  if (!Array.isArray(scaffoldRoots) || scaffoldRoots.length === 0) return false;
  const currentNodesById = collectExactNodesByIdInForest(currentRoots);
  const scaffoldNodesById = collectExactNodesByIdInForest(scaffoldRoots);
  if (currentNodesById.size === 0) return false;
  return Array.from(currentNodesById.entries()).every(([nodeId, currentMatches]) => {
    const scaffoldMatches = scaffoldNodesById.get(nodeId) || [];
    return currentMatches.length === 1
      && scaffoldMatches.length === 1
      && replayLayoutMaterialSignature(currentMatches[0])
        === replayLayoutMaterialSignature(scaffoldMatches[0]);
  });
};

/**
 * Borrow only a future frame's topology. Current nodes keep their exact
 * authored material; future-only nodes are layout-only and therefore reserve
 * coordinates without appearing. Every current workspace root must have one
 * unambiguous future occurrence, including roots later wrapped by External
 * Merge.
 */
const buildCurrentMaterialLayoutScaffold = (
  currentRoots: SyntaxNode[],
  futureRoots: SyntaxNode[],
  allowedFutureOccurrenceIds: ReadonlySet<string> = new Set()
): SyntaxNode[] | null => {
  if (!Array.isArray(currentRoots) || currentRoots.length === 0) return null;
  if (!Array.isArray(futureRoots) || futureRoots.length === 0) return null;
  const currentNodesById = collectExactNodesByIdInForest(currentRoots);
  if (currentNodesById.size === 0) return null;
  if (Array.from(currentNodesById.values()).some((matches) => matches.length !== 1)) return null;

  const currentTopology = JSON.stringify(
    currentRoots.map((root) => replayLayoutTopologySignature(root))
  );
  const futureTopology = JSON.stringify(
    futureRoots.map((root) => replayLayoutTopologySignature(root))
  );
  if (currentTopology === futureTopology) return null;

  const findExactPaths = (roots: SyntaxNode[], targetNodeId: string): number[][] => {
    const paths: number[][] = [];
    const visit = (node: SyntaxNode, path: number[]) => {
      if (String(node.id || '').trim() === targetNodeId) paths.push(path);
      (Array.isArray(node.children) ? node.children : []).forEach((child, childIndex) => {
        visit(child, [...path, childIndex]);
      });
    };
    roots.forEach((root, rootIndex) => visit(root, [rootIndex]));
    return paths;
  };
  const getNodeAtPath = (roots: SyntaxNode[], path: number[]): SyntaxNode | null => {
    let current = roots[path[0]] || null;
    for (let index = 1; current && index < path.length; index += 1) {
      current = (Array.isArray(current.children) ? current.children : [])[path[index]] || null;
    }
    return current;
  };
  const replaceNodeAtPath = (
    roots: SyntaxNode[],
    path: number[],
    replacement: SyntaxNode
  ): SyntaxNode[] => {
    // These skeleton nodes belong to this build and have no external readers.
    const nextRoots = roots;
    if (path.length === 1) {
      nextRoots[path[0]] = replacement;
      return nextRoots;
    }
    let parent = nextRoots[path[0]];
    for (let index = 1; index < path.length - 1; index += 1) {
      parent = (parent.children || [])[path[index]];
    }
    const children = Array.isArray(parent.children) ? [...parent.children] : [];
    children[path[path.length - 1]] = replacement;
    parent.children = children;
    return nextRoots;
  };

  const identity = createReplayIdentityContext([...currentRoots, ...futureRoots]);
  let placeholderIndex = 0;
  const buildLayoutOnlySkeleton = (futureNode: SyntaxNode): SyntaxNode => {
    const originalNodeId = String(futureNode.id || '').trim();
    const next: SyntaxNode = { ...futureNode };
    delete next.children;
    if (Array.isArray(futureNode.children)) {
      next.children = futureNode.children.map(buildLayoutOnlySkeleton);
    }
    if (originalNodeId && currentNodesById.has(originalNodeId)) {
      placeholderIndex += 1;
      next.replayOrigin = { kind: 'layout', authoredId: originalNodeId };
      next.id = identity.allocate(`__babel_future_layout_${placeholderIndex}__${originalNodeId}`, next.replayOrigin);
      delete next.aliasIds;
      delete next.lineageId;
      delete next.tokenIndex;
    }
    (next as any).replayLayoutOnly = true;
    return next;
  };

  const graftCurrentMaterial = (
    currentNode: SyntaxNode,
    futureNode: SyntaxNode
  ): SyntaxNode => {
    const { children: _children, ...material } = currentNode;
    const next = cloneSyntaxTree(material)!;
    delete (next as any).replayLayoutOnly;
    const currentChildren = Array.isArray(currentNode.children) ? currentNode.children : [];
    const futureChildren = Array.isArray(futureNode.children) ? futureNode.children : [];
    if (currentChildren.length === 0 || futureChildren.length === 0) {
      if (_children) next.children = currentChildren.map(child => cloneSyntaxTree(child)!);
      return next;
    }

    const childMatches = currentChildren.map((currentChild) => ({
      currentChild,
      paths: findExactPaths(futureChildren, String(currentChild.id || '').trim())
    }));
    if (childMatches.some(({ paths }) => paths.length !== 1 || paths[0].length !== 1)
      || !preservesRelativeSiblingOrder(currentChildren, futureChildren)) {
      next.children = currentChildren.map((child) => cloneSyntaxTree(child) || child);
      return next;
    }

    let scaffoldChildren = futureChildren.map(buildLayoutOnlySkeleton);
    childMatches
      .sort((left, right) => right.paths[0].length - left.paths[0].length)
      .forEach(({ currentChild, paths }) => {
        const futureMatch = getNodeAtPath(futureChildren, paths[0]);
        if (!futureMatch) return;
        scaffoldChildren = replaceNodeAtPath(
          scaffoldChildren,
          paths[0],
          graftCurrentMaterial(currentChild, futureMatch)
        );
      });
    next.children = scaffoldChildren;
    return next;
  };

  const rootMatches = currentRoots.map((currentRoot) => ({
    currentRoot,
    paths: findExactPaths(futureRoots, String(currentRoot.id || '').trim())
  }));
  if (rootMatches.some(({ paths }) => paths.length !== 1)) return null;

  let scaffold = futureRoots.map(buildLayoutOnlySkeleton);
  rootMatches
    .sort((left, right) => right.paths[0].length - left.paths[0].length)
    .forEach(({ currentRoot, paths }) => {
      const futureMatch = getNodeAtPath(futureRoots, paths[0]);
      if (!futureMatch) return;
      // One unchanged retained tree needs no recursive child grafting. Keeping
      // this fast path at the sole root also preserves placeholder allocation order.
      const retainedTree = rootMatches.length === 1
        && replayLayoutContinuitySignature(currentRoot) === replayLayoutContinuitySignature(futureMatch);
      scaffold = replaceNodeAtPath(
        scaffold,
        paths[0],
        retainedTree ? cloneSyntaxTree(currentRoot)! : graftCurrentMaterial(currentRoot, futureMatch)
      );
    });

  const containsUnauthorizedFutureOccurrence = Array.from(collectExactNodesByIdInForest(scaffold).values())
    .flat().some(node => node.replayOrigin?.kind === 'layout'
      && !allowedFutureOccurrenceIds.has(node.replayOrigin.authoredId || ''));
  if (containsUnauthorizedFutureOccurrence) return null;

  return forestCanUseCurrentMaterialLayoutScaffold(currentRoots, scaffold) ? scaffold : null;
};

/**
 * Reserve the next unambiguous parent layout. Exact retained subtrees use it
 * directly. Detached workspace objects may also borrow a later wrapper after
 * their current-stage versions have been substituted back into that scaffold.
 */
const inferFutureLayoutScaffold = (
  workspaceRoots: SyntaxNode[],
  frames: ReplayDerivationFrame[],
  currentFrameIndex: number
): SyntaxNode[] | null => {
  if (!Array.isArray(workspaceRoots) || workspaceRoots.length === 0) return null;
  const seeksComposedWorkspaceLayout = workspaceRoots.length > 1;
  let bestLayoutScaffold: SyntaxNode[] | null = null;
  const allowedFutureOccurrenceIds = new Set<string>();
  const currentRootIds = new Set(collectWorkspaceRootIds(workspaceRoots));
  let previousParents = new Map<string, SyntaxNode | null>();
  const currentForestSignature = JSON.stringify(
    workspaceRoots.map((root) => replayLayoutContinuitySignature(root))
  );

  for (let futureFrameIndex = currentFrameIndex + 1; futureFrameIndex < frames.length; futureFrameIndex += 1) {
    const futureFrame = frames[futureFrameIndex];
    const futureRoots = Array.isArray(frames[futureFrameIndex]?.workspaceForest)
      ? frames[futureFrameIndex].workspaceForest
      : [];
    const futureParents = collectWorkspaceRootParents(futureRoots, currentRootIds);
    // Reserve a detached object's first attachment, never a later relocation.
    // Otherwise an early selection can start at a movement landing and jump
    // back to its base position when the containing subtree is constructed.
    if ([...previousParents].some(([id, parent]) => parent !== null
      && (futureParents.get(id)?.id !== parent.id
        || !preservesRelativeSiblingOrder(parent.children || [], futureParents.get(id)?.children || [])))) break;
    previousParents = futureParents;
    const preservesCurrentSubtrees = forestCanUseFutureLayoutScaffold(workspaceRoots, futureRoots);
    const preservesCurrentTopology = JSON.stringify(
      workspaceRoots.map((root) => replayLayoutTopologySignature(root))
    ) === JSON.stringify(
      futureRoots.map((root) => replayLayoutTopologySignature(root))
    );
    const addsOnlyOuterWrapper = workspaceRoots.every((currentRoot) => {
      const currentRootId = String(currentRoot?.id || '').trim();
      if (!currentRootId) return false;
      return findExactNodesByIdInForest(futureRoots, currentRootId).length === 1
        && !futureRoots.some((futureRoot) => String(futureRoot?.id || '').trim() === currentRootId);
    });
    const futureIntroducesTrajectory = (Array.isArray(futureFrame?.relations) ? futureFrame.relations : [])
      .some((relation) => isRegisteredTrajectoryRelation(relation?.relation, relation?.anchors));
    const futureIntroducesCrossWorkspaceTrajectory = (
      Array.isArray(futureFrame?.relations) ? futureFrame.relations : []
    ).some((relation) => {
      const entry = findRelationRegistryEntry(
        productionRelationRegistry,
        String(relation?.relation || '')
      );
      return Boolean(entry && PRODUCTION_RENDER_FAMILIES[entry.id]?.trajectoryKind === 'sideward');
    });
    if (futureIntroducesCrossWorkspaceTrajectory) break;
    if (seeksComposedWorkspaceLayout) {
      (Array.isArray(futureFrame?.relations) ? futureFrame.relations : [])
        .filter((relation) => isRegisteredTrajectoryRelation(relation?.relation, relation?.anchors))
        .forEach((relation) => {
          (['pronouncedCopy', 'higherCopy'] as const).forEach((role) => {
            const authoredValue = relation?.anchors?.[role];
            const targetIds = Array.isArray(authoredValue) ? authoredValue : [authoredValue];
            targetIds.forEach((targetId) => {
              const normalizedTargetId = String(targetId || '').trim();
              if (!normalizedTargetId) return;
              allowedFutureOccurrenceIds.add(normalizedTargetId);
              const targetMatches = findExactNodesByIdInForest(futureRoots, normalizedTargetId);
              if (targetMatches.length === 1) {
                collectExactNodesByIdInForest([targetMatches[0]]).forEach((_nodes, nodeId) => {
                  allowedFutureOccurrenceIds.add(nodeId);
                });
              }
            });
          });
        });
    }
    if (
      futureIntroducesTrajectory
      && !preservesCurrentSubtrees
      && !addsOnlyOuterWrapper
      && !preservesCurrentTopology
      && !seeksComposedWorkspaceLayout
    ) break;
    if (preservesCurrentSubtrees) {
      const futureForestSignature = JSON.stringify(
        futureRoots.map((root) => replayLayoutContinuitySignature(root))
      );
      if (futureForestSignature !== currentForestSignature) {
        const scaffold = buildCurrentMaterialLayoutScaffold(
          workspaceRoots,
          futureRoots,
          allowedFutureOccurrenceIds
        );
        if (scaffold) {
          bestLayoutScaffold = scaffold;
        }
      }
      continue;
    }
    const topologyScaffold = buildCurrentMaterialLayoutScaffold(
      workspaceRoots,
      futureRoots,
      allowedFutureOccurrenceIds
    );
    if (topologyScaffold) {
      bestLayoutScaffold = topologyScaffold;
      continue;
    }
    if (preservesCurrentTopology) continue;
    if (!futureForestPreservesCurrentRootIdentities(workspaceRoots, futureRoots)) break;
  }

  return bestLayoutScaffold;
};

const buildWorkspaceRootSideHints = (
  workspaceRoots: SyntaxNode[],
  preferredRootIds?: string[] | null
): Map<string, number> => {
  const orderedRootIds = (
    Array.isArray(preferredRootIds) && preferredRootIds.length > 0
      ? preferredRootIds
      : collectWorkspaceRootIds(workspaceRoots)
  )
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  const hints = new Map<string, number>();
  orderedRootIds.forEach((rootId, index) => {
    hints.set(rootId, index);
  });
  return hints;
};

const inferFutureWorkspaceRootOrder = (
  workspaceRoots: SyntaxNode[],
  frames: ReplayDerivationFrame[],
  currentFrameIndex: number
): string[] | null => {
  if (!Array.isArray(workspaceRoots) || workspaceRoots.length <= 1) return null;
  const currentRoots = workspaceRoots
    .map((root, index) => ({
      root,
      id: String(root?.id || '').trim(),
      originalIndex: index
    }))
    .filter(({ id }) => Boolean(id));
  const currentRootIds = new Set(currentRoots.map(({ id }) => id));
  if (currentRootIds.size <= 1) return null;

  const comparePaths = (left: number[], right: number[]): number => {
    const limit = Math.min(left.length, right.length);
    for (let index = 0; index < limit; index += 1) {
      if (left[index] !== right[index]) return left[index] - right[index];
    }
    return left.length - right.length;
  };
  let bestPreferredOrder: string[] | null = null;
  let bestMergedRoots = -1;
  let bestDepthScore = -1;
  let previousParents = new Map<string, SyntaxNode | null>();

  for (let futureFrameIndex = currentFrameIndex + 1; futureFrameIndex < frames.length; futureFrameIndex += 1) {
    const futureRoots = Array.isArray(frames[futureFrameIndex]?.workspaceForest)
      ? frames[futureFrameIndex].workspaceForest
      : [];
    const futureForestNodeIds = new Set(futureRoots.flatMap((root) => collectSubtreeNodeIds(root)));
    if (!currentRoots.every(({ id }) => futureForestNodeIds.has(id))) {
      break;
    }
    const futureParents = collectWorkspaceRootParents(futureRoots, currentRootIds);
    if ([...previousParents].some(([id, parent]) => parent !== null
      && (futureParents.get(id)?.id !== parent.id
        || !preservesRelativeSiblingOrder(parent.children || [], futureParents.get(id)?.children || [])))) break;
    previousParents = futureParents;

    const rootMembership = currentRoots.map(({ id, originalIndex }) => {
      let futureRootIndex = -1;
      let localPath: number[] | null = null;
      futureRoots.some((futureRoot, index) => {
        const pathWithinRoot = findNodePathInForest([futureRoot], id);
        if (!pathWithinRoot) return false;
        futureRootIndex = index;
        localPath = pathWithinRoot;
        return true;
      });
      return { id, originalIndex, futureRootIndex, localPath };
    });

    if (rootMembership.some(({ futureRootIndex, localPath }) => futureRootIndex < 0 || !localPath)) {
      break;
    }

    const groupedByFutureRoot = new Map<number, number>();
    rootMembership.forEach(({ futureRootIndex }) => {
      groupedByFutureRoot.set(futureRootIndex, (groupedByFutureRoot.get(futureRootIndex) || 0) + 1);
    });
    const mergedRoots = currentRoots.length - groupedByFutureRoot.size;
    if (mergedRoots <= 0) continue;

    const preferredOrder = [...rootMembership]
      .sort((left, right) => {
        if (left.futureRootIndex !== right.futureRootIndex) {
          return left.futureRootIndex - right.futureRootIndex;
        }
        const pathOrder = comparePaths(left.localPath || [], right.localPath || []);
        if (pathOrder !== 0) return pathOrder;
        return left.originalIndex - right.originalIndex;
      })
      .map(({ id }) => id);
    const depthScore = rootMembership.reduce((total, entry) => total + (entry.localPath?.length || 0), 0);

    if (preferredOrder.length !== currentRoots.length) break;
    if (
      mergedRoots > bestMergedRoots
      || (mergedRoots === bestMergedRoots && depthScore > bestDepthScore)
    ) {
      bestPreferredOrder = preferredOrder;
      bestMergedRoots = mergedRoots;
      bestDepthScore = depthScore;
    }
  }

  return bestPreferredOrder;
};

const collectNextFramePendingRootSubtreeIds = (
  workspaceRoots: SyntaxNode[],
  nextFrame?: ReplayDerivationFrame | null
): Set<string> => {
  const currentRootIds = new Set(
    (Array.isArray(workspaceRoots) ? workspaceRoots : [])
      .map((node) => String(node?.id || '').trim())
      .filter(Boolean)
  );
  const nextRoots = Array.isArray(nextFrame?.workspaceForest) ? nextFrame.workspaceForest : [];
  return new Set(
    nextRoots
      .filter((node) => {
        const nodeId = String(node?.id || '').trim();
        return Boolean(nodeId) && !currentRootIds.has(nodeId);
      })
      .flatMap((node) => collectSubtreeNodeIds(node))
  );
};

const mergeReplayDetailBlocks = (
  ...sources: Array<ReplayDetailBlock[] | undefined>
): ReplayDetailBlock[] | undefined => {
  const mergedByTitle = new Map<string, ReplayDetailBlock>();
  sources
    .flat()
    .filter((block): block is ReplayDetailBlock => Boolean(block && typeof block === 'object'))
    .forEach((block) => {
      const title = String(block.title || '').trim();
      if (!title) return;
      const normalizedTitle = normalizeReplayBlockTitleKey(title);
      const lines = (Array.isArray(block.lines) ? block.lines : [])
        .map((line) => String(line || '').trim())
        .filter(Boolean);
      if (lines.length === 0) return;
      const existing = mergedByTitle.get(normalizedTitle);
      if (!existing) {
        mergedByTitle.set(normalizedTitle, {
          title,
          lines: Array.from(new Set(lines))
        });
        return;
      }
      existing.lines = Array.from(new Set([...(existing.lines || []), ...lines]));
    });
  const merged = Array.from(mergedByTitle.values());
  return merged.length > 0 ? merged : undefined;
};

const getReplayPlanStage = (
  plan: DerivationReplayPlan | null | undefined,
  stageIndex: number
): DerivationReplayPlanStage | null => {
  const stages = Array.isArray(plan?.stages) ? plan.stages : [];
  return stages.find((stage) => Number(stage?.stageIndex) === stageIndex) || null;
};

const buildReplayProgressLabel = (
  stage: DerivationReplayPlanStage | null | undefined,
  stageCount: number,
  stepNumber: number,
  stepCount: number
): string | undefined => {
  if (!stage || !Number.isFinite(stage.stageNumber) || stage.stageNumber <= 0 || stageCount <= 0 || stepCount <= 0) {
    return undefined;
  }
  return `Stage ${stage.stageNumber}/${stageCount} \u00b7 Step ${stepNumber}/${stepCount}`;
};

const stripSemanticPayloadFromMicrostep = (step: PlaybackStep): PlaybackStep => ({
  ...step,
  sourceKind: 'microstep',
  detailBlocks: undefined,
  note: undefined,
  movementSerializationStatus: undefined,
  movementDiagnostics: undefined
});

// Dispatch has already resolved the authored name and validated its signature.
const relationOwnsPhrasalTreeTransition = (relation: DerivationReplayPlanStep): boolean =>
  relation.registeredEntryId === 'qr.covert';

const relationOwnedPhrasalSourceRoles = (relation: DerivationReplayPlanStep): readonly string[] =>
  relationOwnsPhrasalTreeTransition(relation) ? ['pronouncedQP', 'source'] : TRAJECTORY_SOURCE_ROLES;

const relationOwnedPhrasalTargetRoles = (relation: DerivationReplayPlanStep): readonly string[] =>
  relationOwnsPhrasalTreeTransition(relation) ? ['lfQP', 'target'] : TRAJECTORY_TARGET_ROLES;

/**
 * A final movement tree serializes the landed occurrence and silent lower
 * occurrence. Before the relation moment, Replay needs the inverse state: the
 * landing is still withheld and the lower occurrence is overt. Reconstruct
 * only what the authored contract proves — a registered phrasal trajectory
 * whose source and target nodes share exact lineage ids. Missing or ambiguous
 * lineage fails closed and leaves the authored tree unchanged.
 */
const buildPreMovementStructuralForest = (
  forest: SyntaxNode[],
  relations: DerivationReplayPlanStep[],
  previousForest: SyntaxNode[] = []
): SyntaxNode[] => {
  const structuralForest = cloneSyntaxForest(forest);
  const collectNodes = (root?: SyntaxNode | null): SyntaxNode[] => {
    if (!root) return [];
    const nodes: SyntaxNode[] = [];
    const visit = (node: SyntaxNode) => {
      nodes.push(node);
      (Array.isArray(node.children) ? node.children : []).forEach(visit);
    };
    visit(root);
    return nodes;
  };
  const findNode = (nodeId: string): SyntaxNode | null => {
    const normalizedNodeId = String(nodeId || '').trim();
    if (!normalizedNodeId) return null;
    for (const root of structuralForest) {
      const found = collectNodes(root).find((node) => String(node.id || '').trim() === normalizedNodeId);
      if (found) return found;
    }
    return null;
  };
  const findNodeInForest = (candidateForest: SyntaxNode[], nodeId: string): SyntaxNode | null => {
    const normalizedNodeId = String(nodeId || '').trim();
    if (!normalizedNodeId) return null;
    for (const root of candidateForest) {
      const found = collectNodes(root).find((node) => String(node.id || '').trim() === normalizedNodeId);
      if (found) return found;
    }
    return null;
  };
  const replaceStructuralNode = (nodeId: string, replacement: SyntaxNode): boolean => {
    const normalizedNodeId = String(nodeId || '').trim();
    if (!normalizedNodeId) return false;
    const rootIndex = structuralForest.findIndex((root) => String(root.id || '').trim() === normalizedNodeId);
    if (rootIndex >= 0) {
      structuralForest[rootIndex] = replacement;
      return true;
    }
    const visit = (node: SyntaxNode): boolean => {
      const children = Array.isArray(node.children) ? node.children : [];
      const childIndex = children.findIndex((child) => String(child.id || '').trim() === normalizedNodeId);
      if (childIndex >= 0) {
        children[childIndex] = replacement;
        node.children = children;
        return true;
      }
      return children.some(visit);
    };
    return structuralForest.some(visit);
  };
  const restoreCurrentSourceState = (
    currentSource: SyntaxNode,
    previousSource: SyntaxNode
  ): SyntaxNode | null => {
    if (String(currentSource.label || '').trim() !== String(previousSource.label || '').trim()
      && (!currentSource.lineageId || currentSource.lineageId !== previousSource.lineageId)) {
      return null;
    }
    // Before a later movement relation, the source is exactly the occurrence
    // authored in the preceding stage. This matters for remnant and roll-up
    // movement, where the relation frame relocates a previously derived subtree
    // and creates a differently shaped lower silent copy. Reusing the complete
    // prior occurrence keeps every lexical/structural change inside the movement
    // mesostep instead of leaking it into a fake construction microstep.
    return cloneSyntaxTree(previousSource);
  };
  const findParent = (nodeId: string): SyntaxNode | null => {
    const normalizedNodeId = String(nodeId || '').trim();
    if (!normalizedNodeId) return null;
    const visit = (node: SyntaxNode): SyntaxNode | null => {
      const children = Array.isArray(node.children) ? node.children : [];
      if (children.some((child) => String(child.id || '').trim() === normalizedNodeId)) return node;
      for (const child of children) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    for (const root of structuralForest) {
      const found = visit(root);
      if (found) return found;
    }
    return null;
  };
  const findAnchor = (
    anchors: ReplayResolvedRelationAnchor[],
    roles: readonly string[]
  ): ReplayResolvedRelationAnchor | undefined => {
    const wanted = new Set(roles.map((role) => role.toLowerCase()));
    return anchors.find((anchor) => wanted.has(String(anchor.role || '').trim().toLowerCase()));
  };
  [...relations].reverse().forEach((relation) => {
    if (relation.recoveredMovement && !relation.recoveredMovement.transition) return;
    const anchors = Array.isArray(relation.resolvedAnchors)
      ? relation.resolvedAnchors
      : [];
    const sourceRoles = relationOwnedPhrasalSourceRoles(relation);
    const targetRoles = relationOwnedPhrasalTargetRoles(relation);
    const sourceIds = Array.from(new Set([
      ...getRelationSourceNodeIds(relation),
      ...findResolvedReplayAnchorsByRoles(anchors, sourceRoles)
        .map((anchor) => String(anchor.nodeId || '').trim())
    ].filter(Boolean)));
    const targetId = String(
      getRelationTargetNodeId(relation)
      || findAnchor(anchors, targetRoles)?.nodeId
      || ''
    ).trim();
    const trajectoryDisplayKind = relation.recoveredMovement?.trajectoryKind || registeredTrajectoryDisplayKind(
      relation.relation,
      relation.resolvedAnchors
    );
    if (
      trajectoryDisplayKind !== 'phrasal'
      && trajectoryDisplayKind !== 'head'
      && !relationOwnsPhrasalTreeTransition(relation)
    ) return;
    const movement = relation.recoveredMovement;
    if (movement && movement.priorSourceNodeId !== movement.sourceNodeId) {
      const before = findNodeInForest(previousForest, movement.priorSourceNodeId);
      const lower = findNode(movement.sourceNodeId);
      const landing = findNode(movement.targetNodeId);
      if (!before || !lower || !landing) return;
      const restored = restoreCurrentSourceState(lower, before);
      if (!restored) return;
      // The retained ID may currently be at the landing. Remove that occurrence
      // before restoring the complete prior object at its proven lower slot.
      const parent = findParent(movement.targetNodeId);
      if (parent) parent.children = parent.children?.filter(child => child !== landing);
      else structuralForest.splice(structuralForest.indexOf(landing), 1);
      replaceStructuralNode(movement.sourceNodeId, restored);
      return;
    }
    const restoredFromPreviousStage = new Set<string>();
    sourceIds.forEach((sourceId) => {
      const previousSource = findNodeInForest(previousForest, sourceId);
      const currentSource = findNode(sourceId);
      if (!previousSource || !currentSource) return;
      const restoredSource = restoreCurrentSourceState(currentSource, previousSource);
      if (restoredSource && replaceStructuralNode(sourceId, restoredSource)) {
        restoredFromPreviousStage.add(sourceId);
      }
    });
    // The contract requires a moved occurrence to be shown in place by an
    // earlier stage. Every source is therefore restored exactly from the
    // preceding stage; when one is not there, this stage is shown as authored
    // and the movement check reports the unproven source. Nothing is
    // reconstructed from the landing.
    if (sourceIds.some((sourceId) => !restoredFromPreviousStage.has(sourceId))) return;
    const sources = sourceIds
      .map((sourceId) => findNode(sourceId))
      .filter((source): source is SyntaxNode => Boolean(source));
    const target = findNode(targetId);
    if (sources.length !== sourceIds.length || sources.length === 0 || !target) return;
    const targetLineageId = String(target.lineageId || '').trim();
    if (!targetLineageId || sources.some((source) => {
      const sourceLineageId = String(source.lineageId || '').trim();
      return !sourceLineageId
        || sourceLineageId !== targetLineageId
        || source === target
        || collectNodes(source).includes(target)
        || collectNodes(target).includes(source);
    })) return;
    const targetParent = findParent(targetId);
    const targetRootIndex = structuralForest.findIndex((root) => String(root.id || '').trim() === targetId);
    if (!targetParent && targetRootIndex < 0) return;

    if (trajectoryDisplayKind === 'head' && !relation.recoveredMovement) {
      const targetChildren = Array.isArray(target.children) ? target.children : [];
      if (targetChildren.length > 0) {
        target.children = [];
      } else {
        delete target.word;
        target.label = String(target.label || '').trim() || '∅';
        target.silent = true;
      }
    } else if (targetParent) {
      targetParent.children = (Array.isArray(targetParent.children) ? targetParent.children : [])
        .filter((child) => String(child.id || '').trim() !== targetId);
    } else {
      structuralForest.splice(targetRootIndex, 1);
    }
  });

  return structuralForest;
};

const relationProductionTransitionKinds = (
  relation: DerivationReplayPlanStep
): readonly ProductionTransitionKind[] => {
  const entry = findRelationRegistryEntry(
    productionRelationRegistry,
    String(relation.relation || '').trim()
  );
  return entry
    ? PRODUCTION_RENDER_FAMILIES[entry.id]?.transitionKinds || []
    : [];
};

type FallbackTreeTransitionOwnership = {
  currentNodeIds: Set<string>;
  priorNodeIds: Set<string>;
};

const relationAnchorNodeIds = (block?: Record<string, unknown>): string[] =>
  Object.values(block || {})
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => String(value || '').trim())
    .filter(Boolean);

const collectExactSubtreeNodeIds = (node: SyntaxNode): Set<string> => {
  const nodeIds = new Set<string>();
  const visit = (candidate: SyntaxNode) => {
    const nodeId = String(candidate.id || '').trim();
    if (nodeId) nodeIds.add(nodeId);
    (Array.isArray(candidate.children) ? candidate.children : []).forEach(visit);
  };
  visit(node);
  return nodeIds;
};

const resolveFallbackTreeTransitionOwnership = (
  relation: DerivationReplayPlanStep,
  previousForest: SyntaxNode[],
  currentForest: SyntaxNode[]
): FallbackTreeTransitionOwnership | null => {
  if (!relation.neutralTransitionEvidence && findRelationRegistryEntry(
    productionRelationRegistry,
    String(relation.relation || '').trim()
  )) return null;

  const evidence = relation.neutralTransitionEvidence ?? relation;
  const currentAnchorIds = relationAnchorNodeIds(evidence.anchors);
  const priorAnchorIds = relationAnchorNodeIds(evidence.priorAnchors);
  if (currentAnchorIds.length === 0 || priorAnchorIds.length === 0) return null;

  const currentAnchors = currentAnchorIds.map((nodeId) =>
    findExactNodesByIdInForest(currentForest, nodeId));
  const priorAnchors = priorAnchorIds.map((nodeId) =>
    findExactNodesByIdInForest(previousForest, nodeId));
  if (
    currentAnchors.some((matches) => matches.length !== 1)
    || priorAnchors.some((matches) => matches.length !== 1)
  ) return null;

  return {
    currentNodeIds: new Set(
      currentAnchors.flatMap(([node]) => Array.from(collectExactSubtreeNodeIds(node)))
    ),
    priorNodeIds: new Set(
      priorAnchors.flatMap(([node]) => Array.from(collectExactSubtreeNodeIds(node)))
    )
  };
};

type ExactForestNodeLocation = {
  node: SyntaxNode;
  parent: SyntaxNode | null;
  parentId: string;
  childIndex: number;
  rootIndex: number;
  depth: number;
};

const indexExactForestNodeLocations = (
  forest: SyntaxNode[]
): Map<string, ExactForestNodeLocation | null> => {
  const locations = new Map<string, ExactForestNodeLocation | null>();
  const visit = (
    node: SyntaxNode,
    parent: SyntaxNode | null,
    childIndex: number,
    rootIndex: number,
    depth: number
  ) => {
    const nodeId = String(node.id || '').trim();
    if (nodeId) {
      const location = {
        node,
        parent,
        parentId: String(parent?.id || '').trim(),
        childIndex,
        rootIndex,
        depth
      };
      locations.set(nodeId, locations.has(nodeId) ? null : location);
    }
    (Array.isArray(node.children) ? node.children : []).forEach((child, index) => {
      visit(child, node, index, rootIndex, depth + 1);
    });
  };
  forest.forEach((root, rootIndex) => visit(root, null, rootIndex, rootIndex, 0));
  return locations;
};

const syntaxNodeMaterialSignature = (node: SyntaxNode): string => {
  const material = { ...node };
  delete material.children;
  return JSON.stringify(material);
};

/**
 * Apply only the raw tree deltas witnessed by active relations.
 * A relation owns its current/prior anchor subtrees, never the whole
 * stage forest. It may add the minimum current ancestor chain needed to keep
 * those subtrees attached and retire removed prior containers exhausted by
 * those edits; unrelated current-stage additions remain hidden.
 */
const buildAnchoredTreeTransitionForest = (
  previousForest: SyntaxNode[],
  currentForest: SyntaxNode[],
  activeRelations: DerivationReplayPlanStep[]
): SyntaxNode[] => {
  const ownerships = activeRelations
    .map((relation) => {
      const movement = relation.recoveredMovement;
      if (movement?.transition) {
        return {
          currentNodeIds: new Set([movement.sourceNodeId, movement.targetNodeId].flatMap(id => {
            const node = findExactNodeByIdInForest(currentForest, id);
            return node ? [...collectExactSubtreeNodeIds(node)] : [];
          })),
          priorNodeIds: collectExactSubtreeNodeIds(findExactNodeByIdInForest(previousForest, movement.priorSourceNodeId)!)
        };
      }
      return resolveFallbackTreeTransitionOwnership(relation, previousForest, currentForest);
    })
    .filter((ownership): ownership is FallbackTreeTransitionOwnership => Boolean(ownership));
  if (ownerships.length === 0) return cloneSyntaxForest(previousForest);

  const activeCurrentNodeIds = new Set(
    ownerships.flatMap((ownership) => Array.from(ownership.currentNodeIds))
  );
  const activePriorNodeIds = new Set(
    ownerships.flatMap((ownership) => Array.from(ownership.priorNodeIds))
  );
  const previousLocations = indexExactForestNodeLocations(previousForest);
  const currentLocations = indexExactForestNodeLocations(currentForest);
  let result = cloneSyntaxForest(previousForest);

  const exactLocation = (
    locations: Map<string, ExactForestNodeLocation | null>,
    nodeId: string
  ): ExactForestNodeLocation | null => locations.get(nodeId) || null;
  const hasOwnedAncestor = (
    location: ExactForestNodeLocation,
    ownedIds: Set<string>,
    locations: Map<string, ExactForestNodeLocation | null>,
    predicate: (nodeId: string) => boolean
  ): boolean => {
    let parentId = location.parentId;
    while (parentId) {
      if (ownedIds.has(parentId) && predicate(parentId)) return true;
      parentId = exactLocation(locations, parentId)?.parentId || '';
    }
    return false;
  };
  const removeExactNode = (nodeId: string): SyntaxNode | null => {
    const location = exactLocation(indexExactForestNodeLocations(result), nodeId);
    if (!location) return null;
    if (location.parent) {
      const children = Array.isArray(location.parent.children) ? [...location.parent.children] : [];
      const [removed] = children.splice(location.childIndex, 1);
      location.parent.children = children;
      return removed || null;
    }
    const [removed] = result.splice(location.rootIndex, 1);
    return removed || null;
  };
  const insertExactNode = (
    node: SyntaxNode,
    parentId: string,
    childIndex: number,
    rootIndex: number
  ): boolean => {
    if (!parentId) {
      result.splice(Math.min(Math.max(rootIndex, 0), result.length), 0, node);
      return true;
    }
    const parentLocation = exactLocation(indexExactForestNodeLocations(result), parentId);
    if (!parentLocation) return false;
    const children = Array.isArray(parentLocation.node.children)
      ? [...parentLocation.node.children]
      : [];
    children.splice(Math.min(Math.max(childIndex, 0), children.length), 0, node);
    parentLocation.node.children = children;
    return true;
  };

  const activeCurrentAncestorNodeIds = new Set<string>();
  activeCurrentNodeIds.forEach((nodeId) => {
    let parentId = exactLocation(currentLocations, nodeId)?.parentId || '';
    while (parentId) {
      activeCurrentAncestorNodeIds.add(parentId);
      parentId = exactLocation(currentLocations, parentId)?.parentId || '';
    }
  });

  const ensureCurrentNodeShell = (
    nodeId: string,
    visiting = new Set<string>()
  ): boolean => {
    if (!nodeId) return true;
    const currentLocation = exactLocation(currentLocations, nodeId);
    if (!currentLocation || visiting.has(nodeId)) return false;

    visiting.add(nodeId);
    if (
      currentLocation.parentId
      && !ensureCurrentNodeShell(currentLocation.parentId, visiting)
    ) return false;

    const resultLocation = exactLocation(indexExactForestNodeLocations(result), nodeId);
    if (resultLocation) {
      if (resultLocation.parentId !== currentLocation.parentId) {
        const detachedNode = removeExactNode(nodeId);
        if (!detachedNode || !insertExactNode(
          detachedNode,
          currentLocation.parentId,
          currentLocation.childIndex,
          currentLocation.rootIndex
        )) return false;
      }
      visiting.delete(nodeId);
      return true;
    }

    const currentMaterial = { ...currentLocation.node };
    delete currentMaterial.children;
    const shell = structuredClone(currentMaterial) as SyntaxNode;
    shell.children = [];
    if (!insertExactNode(
      shell,
      currentLocation.parentId,
      currentLocation.childIndex,
      currentLocation.rootIndex
    )) return false;

    const currentChildren = Array.isArray(currentLocation.node.children)
      ? currentLocation.node.children
      : [];
    for (const [childIndex, child] of currentChildren.entries()) {
      const childId = String(child.id || '').trim();
      if (!childId) continue;
      if (
        !activeCurrentNodeIds.has(childId)
        && !activeCurrentAncestorNodeIds.has(childId)
      ) continue;
      const existingChild = exactLocation(indexExactForestNodeLocations(result), childId);
      if (!existingChild) continue;
      const detachedChild = removeExactNode(childId);
      if (!detachedChild || !insertExactNode(
        detachedChild,
        nodeId,
        childIndex,
        currentLocation.rootIndex
      )) return false;
    }

    visiting.delete(nodeId);
    return true;
  };

  const removedNodeIds = Array.from(activePriorNodeIds).filter((nodeId) =>
    Boolean(exactLocation(previousLocations, nodeId))
    && !exactLocation(currentLocations, nodeId));
  const movedNodeIds = Array.from(new Set([
    ...activeCurrentNodeIds,
    ...activePriorNodeIds
  ])).filter((nodeId) => {
    const previous = exactLocation(previousLocations, nodeId);
    const current = exactLocation(currentLocations, nodeId);
    return Boolean(previous && current) && (
      previous!.parentId !== current!.parentId
      || (previous!.parentId === current!.parentId && previous!.childIndex !== current!.childIndex)
    );
  });
  const topLevelMovedNodeIds = movedNodeIds
    .filter((nodeId) => {
      const location = exactLocation(currentLocations, nodeId);
      return Boolean(location) && !hasOwnedAncestor(
        location!,
        activeCurrentNodeIds,
        currentLocations,
        (ancestorId) => movedNodeIds.includes(ancestorId)
      );
    })
    .sort((left, right) => (
      (exactLocation(currentLocations, left)?.depth || 0)
      - (exactLocation(currentLocations, right)?.depth || 0)
    ));
  const addedNodeIds = Array.from(activeCurrentNodeIds).filter((nodeId) =>
    Boolean(exactLocation(currentLocations, nodeId))
    && !exactLocation(previousLocations, nodeId));
  const topLevelAddedNodeIds = addedNodeIds
    .filter((nodeId) => {
      const location = exactLocation(currentLocations, nodeId);
      return Boolean(location) && !hasOwnedAncestor(
        location!,
        activeCurrentNodeIds,
        currentLocations,
        (ancestorId) => addedNodeIds.includes(ancestorId)
      );
    })
    .sort((left, right) => (
      (exactLocation(currentLocations, left)?.depth || 0)
      - (exactLocation(currentLocations, right)?.depth || 0)
    ));

  const destinationParentIds = Array.from(new Set([
    ...topLevelMovedNodeIds,
    ...topLevelAddedNodeIds
  ].map((nodeId) => exactLocation(currentLocations, nodeId)?.parentId || '')
    .filter(Boolean)));
  if (destinationParentIds.some((parentId) => !ensureCurrentNodeShell(parentId))) {
    return cloneSyntaxForest(previousForest);
  }

  removedNodeIds
    .filter((nodeId) => {
      const location = exactLocation(previousLocations, nodeId);
      return Boolean(location) && !hasOwnedAncestor(
        location!,
        activePriorNodeIds,
        previousLocations,
        (ancestorId) => removedNodeIds.includes(ancestorId)
      );
    })
    .sort((left, right) => (
      (exactLocation(previousLocations, right)?.depth || 0)
      - (exactLocation(previousLocations, left)?.depth || 0)
    ))
    .forEach((nodeId) => removeExactNode(nodeId));

  topLevelMovedNodeIds
    .forEach((nodeId) => {
      const destination = exactLocation(currentLocations, nodeId);
      if (
        destination?.parentId
        && !exactLocation(indexExactForestNodeLocations(result), destination.parentId)
      ) return;
      const moved = removeExactNode(nodeId);
      if (!destination || !moved) return;
      insertExactNode(
        moved,
        destination.parentId,
        destination.childIndex,
        destination.rootIndex
      );
    });

  topLevelAddedNodeIds
    .forEach((nodeId) => {
      const destination = exactLocation(currentLocations, nodeId);
      if (!destination) return;
      const shell = exactLocation(indexExactForestNodeLocations(result), nodeId);
      if (shell) {
        // Ancestor construction may already have attached existing children.
        // This added subtree is wholly owned by the active relation, so finish
        // its authored contents rather than mistaking the shell for completion.
        Object.assign(shell.node, cloneSyntaxTree(destination.node));
        return;
      }
      insertExactNode(
        cloneSyntaxTree(destination.node) || destination.node,
        destination.parentId,
        destination.childIndex,
        destination.rootIndex
      );
    });

  Array.from(activeCurrentNodeIds).forEach((nodeId) => {
    const previous = exactLocation(previousLocations, nodeId);
    const current = exactLocation(currentLocations, nodeId);
    if (!previous || !current) return;
    if (syntaxNodeMaterialSignature(previous.node) === syntaxNodeMaterialSignature(current.node)) return;
    const resultLocation = exactLocation(indexExactForestNodeLocations(result), nodeId);
    if (!resultLocation) return;
    const children = resultLocation.node.children;
    const currentMaterial = { ...current.node };
    delete currentMaterial.children;
    Object.keys(resultLocation.node).forEach((key) => {
      if (key !== 'children') {
        delete (resultLocation.node as unknown as Record<string, unknown>)[key];
      }
    });
    Object.assign(resultLocation.node, structuredClone(currentMaterial));
    if (children) resultLocation.node.children = children;
  });

  const pruneExhaustedPriorContainers = (forest: SyntaxNode[]): SyntaxNode[] =>
    forest.filter((node) => {
      if (Array.isArray(node.children)) {
        node.children = pruneExhaustedPriorContainers(node.children);
      }
      const nodeId = String(node.id || '').trim();
      const prior = exactLocation(previousLocations, nodeId);
      // Never infer deletion of an authored empty item or a surviving parent.
      // An absent former container can disappear only after its owned children
      // have actually left; any unowned sibling keeps it in this frame.
      return currentLocations.has(nodeId)
        || !prior?.node.children?.length
        || Boolean(node.children?.length);
    });
  return pruneExhaustedPriorContainers(result);
};

const relationOwnsNonMovementTreeTransition = (
  relation: DerivationReplayPlanStep,
  previousForest: SyntaxNode[] = [],
  currentForest: SyntaxNode[] = []
): boolean => {
  if (relation.recoveredMovement?.transition) return false;
  const relationName = String(relation.relation || '').trim();
  const registryEntry = findRelationRegistryEntry(
    productionRelationRegistry,
    relationName
  );

  if (!registryEntry || relation.neutralTransitionEvidence) {
    return Boolean(resolveFallbackTreeTransitionOwnership(
      relation,
      previousForest,
      currentForest
    ));
  }

  const transitionKinds = relationProductionTransitionKinds(relation);
  const nonMovementKinds = transitionKinds.filter((kind) => kind !== 'movement');
  if (nonMovementKinds.length === 0) return false;

  return true;
};

export const buildPlaybackStepsFromDerivationFrames = (
  frames: ReplayDerivationFrame[],
  sentence?: string,
  replayPlan?: DerivationReplayPlan | null
): PlaybackStep[] => {
  const identity = createReplayIdentityContext(frames.flatMap(frame => frame.workspaceForest || []));
  const plannedStageCount = Array.isArray(replayPlan?.stages) ? replayPlan.stages.length : 0;
  const plannedRelationsByFrame: DerivationReplayPlanStep[][] = [];
  const resolvedRelationsByFrame = new Map<number, DerivationReplayPlanStep[]>();
  // Authored stages stay fixed during this compilation. Reuse their interpreted
  // relations when building cumulative links; each link still binds to its current forest.
  const resolveFrameRelations = (index: number) => {
    if (!resolvedRelationsByFrame.has(index)) resolvedRelationsByFrame.set(index, getFrameRelations(
      frames[index], getReplayPlanStage(replayPlan, index), frames[index - 1]?.workspaceForest || []
    ));
    return resolvedRelationsByFrame.get(index)!;
  };
  const pendingProjectionReveals: Array<{
    nodeId: string;
    firstStageIndex: number;
    stageIndex: number;
    relationIndex: number;
  }> = [];
  let previousVisibleNodeIds = new Set<string>();
  let previousWorkspaceRootIds = new Set<string>();
  const sentenceInitialSurface = String(tokenizeReplaySentenceSurface(sentence)[0] || '').trim();
  const firstFrontingStageIndex = (() => {
    const stages = Array.isArray(replayPlan?.stages) ? replayPlan.stages : [];
    for (const stage of stages) {
      const relationSteps = Array.isArray(stage?.relationSteps) ? stage.relationSteps : [];
      if (!relationSteps.some((relation) => isRegisteredFrontingTrajectoryRelation(
        relation?.relation,
        relation?.anchors
      ))) continue;
      const stageIndex = Number(stage?.stageIndex);
      return Number.isFinite(stageIndex) ? stageIndex : -1;
    }
    return -1;
  })();
  const getPreFrontingLexicalSurface = (surface: string, frameIndex: number): string => {
    const trimmed = String(surface || '').trim();
    if (
      !trimmed
      || !sentenceInitialSurface
      || firstFrontingStageIndex <= frameIndex
      || normalizeToken(trimmed) !== normalizeToken(sentenceInitialSurface)
    ) {
      return trimmed;
    }
    return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
  };
  const frameBackedSteps = frames.flatMap((frame, index) => {
    const plannedStage = getReplayPlanStage(replayPlan, index);
    const rawWorkspaceRoots = Array.isArray(frame.workspaceForest) ? frame.workspaceForest : [];
    const nextFrame = index < frames.length - 1 ? frames[index + 1] : null;
    const fallbackOperation = frame.movement?.operation || frame.operation || 'Other';
    // Anchor detached roots to explicit future daughter order as soon as a later
    // derivation frame makes that merge order unambiguous. This keeps bottom-up
    // workspace assembly visually aligned with the eventual tree without guessing.
    const preferredWorkspaceRootOrder = inferFutureWorkspaceRootOrder(rawWorkspaceRoots, frames, index);
    const preferredWorkspaceRootSideHints = buildWorkspaceRootSideHints(
      rawWorkspaceRoots,
      preferredWorkspaceRootOrder
    );
    const workspaceRoots = reorderWorkspaceRootsForReplay(rawWorkspaceRoots, preferredWorkspaceRootOrder);
    const futureLayoutScaffold = inferFutureLayoutScaffold(workspaceRoots, frames, index);
    const rootLabels = workspaceRoots
      .map((node) => String(node?.label || '').trim())
      .filter(Boolean);
    const primaryRoot = workspaceRoots[0];
    const primaryRootId = String(primaryRoot?.id || '').trim();
    const primaryRootLabel = String(primaryRoot?.label || '').trim() || 'Workspace';
    const structuralFallbackRecipe = buildStructuralReplayFallback(
      fallbackOperation,
      primaryRootLabel,
      rootLabels
    );
    const previousFrameWorkspaceRoots = index > 0 && Array.isArray(frames[index - 1]?.workspaceForest)
      ? frames[index - 1].workspaceForest
      : [];
    const plannedFrameRelations = plannedStage
      ? resolveFrameRelations(index)
      : [];
    plannedRelationsByFrame[index] = plannedFrameRelations;
    plannedFrameRelations.forEach((relation, relationIndex) => {
      const movement = relation.recoveredMovement;
      const ownership = movement?.transition ? null : resolveFallbackTreeTransitionOwnership(
        relation, previousFrameWorkspaceRoots, workspaceRoots
      );
      if (!(movement?.transition && movement.trajectoryKind === 'phrasal') && !ownership) return;
      workspaceRoots.forEach(parent => {
        const previousParent = previousFrameWorkspaceRoots.find(root => root.id === parent.id);
        if (!parent.id || parent.word || parent.children?.length !== 2 || previousParent?.children?.length !== 1) return;
        const carriedChildId = previousParent.children[0].id;
        if (!parent.children.some(child => child.id === carriedChildId)) return;
        const landing = parent.children.find(child => child.id !== carriedChildId);
        if (!landing?.id) return;
        const ownsLanding = movement?.transition
          ? movement.targetNodeId === landing.id
          : Boolean(landing.children?.length
            && ownership?.currentNodeIds.has(landing.id)
            && ownership.priorNodeIds.has(landing.id)
            && findExactNodesByIdInForest(previousFrameWorkspaceRoots, landing.id).length === 1
            && findExactNodesByIdInForest(workspaceRoots, landing.id).length === 1);
        if (!ownsLanding || pendingProjectionReveals.some(reveal => reveal.nodeId === parent.id && reveal.stageIndex === index)) return;

        let firstStageIndex = index - 1;
        while (firstStageIndex > 0) {
          const earlier = frames[firstStageIndex - 1].workspaceForest?.find(root => root.id === parent.id);
          if (earlier?.children?.length !== 1 || earlier.children[0].id !== carriedChildId) break;
          firstStageIndex -= 1;
        }
        const precedingRelations = [
          ...plannedRelationsByFrame.slice(firstStageIndex, index).flat(),
          ...plannedFrameRelations.slice(0, relationIndex)
        ];
        if (precedingRelations.some(candidate => [
          ...getRelationAllAnchorNodeIds(candidate),
          ...relationAnchorNodeIds(candidate.priorAnchors),
          getRelationTargetNodeId(candidate),
          ...getRelationSourceNodeIds(candidate)
        ].includes(parent.id!))) return;
        // Withhold the saved unary shell until its second child attaches. A
        // fallback can own an exact node's relocation without proving a
        // linguistic movement drawing; earlier claims still retain their anchors.
        pendingProjectionReveals.push({ nodeId: parent.id, firstStageIndex, stageIndex: index,
          relationIndex: relation.authoredRelationIndex ?? relationIndex });
      });
    });
    const plannedStageRelocatesPriorLandingOccurrence = index > 0
      && !plannedFrameRelations.some((relation) => relation?.relation === 'CopyOccurrence')
      && plannedFrameRelations.some((relation) => {
        if (!isRegisteredTrajectoryRelation(relation?.relation, relation?.anchors)) return false;
        const resolvedAnchors = getResolvedReplayRelationAnchors(relation);
        const targetNodeId = getRelationTargetNodeId(relation)
          || String(findResolvedReplayAnchorByRoles(
            resolvedAnchors,
            relationOwnedPhrasalTargetRoles(relation)
          )?.nodeId || '').trim();
        const explicitSourceNodeIds = getRelationSourceNodeIds(relation);
        const sourceNodeIds = explicitSourceNodeIds.length > 0
          ? explicitSourceNodeIds
          : findResolvedReplayAnchorsByRoles(
              resolvedAnchors,
              relationOwnedPhrasalSourceRoles(relation)
            )
              .map((anchor) => String(anchor.nodeId || '').trim())
              .filter(Boolean);
        return Boolean(targetNodeId)
          && Boolean(findNodeByIdInForest(previousFrameWorkspaceRoots, targetNodeId))
          && sourceNodeIds.length > 0
          && sourceNodeIds.every((sourceNodeId) =>
            !findNodeByIdInForest(previousFrameWorkspaceRoots, sourceNodeId));
      });
    const authoredLandingNodeId = getMovementLandingNodeId(frame.movement);
    const frameHasMovementPayload = Boolean(
      authoredLandingNodeId
      || String(frame.movement?.sourceNodeId || '').trim()
      || String(frame.movement?.traceNodeId || '').trim()
      || String(frame.chainId || '').trim()
      || plannedStageRelocatesPriorLandingOccurrence
    );
    const frameHasRecoveredMovement = plannedFrameRelations.some(relation => relation.recoveredMovement?.transition);
    const frameCarriesAuthoredEffect =
      Boolean(String(getDerivationFrameChange(frame)?.statement || '').trim());
    const movementRecipe = pickPreferredReplayText(
      frame.movement?.note
    );
    const semanticRecipe = (() => {
      if (isMoveLikeOperation(fallbackOperation) || frameHasMovementPayload) {
        return movementRecipe || structuralFallbackRecipe;
      }
      return structuralFallbackRecipe;
    })();
    const priorVisibleNodeIds = new Set(previousVisibleNodeIds);
    type IndexedRelationStep = DerivationReplayPlanStep & { authoredRelationIndex: number };
    const frameRelationSteps: IndexedRelationStep[] = plannedStage
      ? plannedFrameRelations
          .map((relation, listIndex) => ({
            ...relation,
            // The authored array position is the relation's exact identity;
            // keep the plan's own index when present — a positional index
            // is wrong as soon as any upstream step was filtered.
            authoredRelationIndex: Number.isInteger(relation.authoredRelationIndex)
              ? (relation.authoredRelationIndex as number)
              : listIndex
          }))
          .filter(isRenderableReplayRelation)
      : [];
    const nonMovementTreeTransitionRelationIndexes = new Set(
      frameRelationSteps
        .map((relation, relationIndex) => (
          relationOwnsNonMovementTreeTransition(
            relation,
            previousFrameWorkspaceRoots,
            workspaceRoots
          ) ? relationIndex : -1
        ))
        .filter((relationIndex) => relationIndex >= 0)
    );
    const fallbackTreeTransitionRelationIndexes = new Set(
      frameRelationSteps
        .map((relation, relationIndex) => (
          !relation.recoveredMovement?.transition && resolveFallbackTreeTransitionOwnership(
            relation,
            previousFrameWorkspaceRoots,
            workspaceRoots
          ) ? relationIndex : -1
        ))
        .filter((relationIndex) => relationIndex >= 0)
    );
    const frameHasNonMovementTreeTransition =
      index > 0
      && nonMovementTreeTransitionRelationIndexes.size > 0
      && JSON.stringify(previousFrameWorkspaceRoots) !== JSON.stringify(workspaceRoots);
    const frameIsPureVisualTrajectoryStage =
      frameHasMovementPayload
      && collectReplayOvertTokenMultisetKey(previousFrameWorkspaceRoots) === collectReplayOvertTokenMultisetKey(workspaceRoots)
      && collectReplayRootStructuralKey(previousFrameWorkspaceRoots) === collectReplayRootStructuralKey(workspaceRoots);
    const authoredPreviousRelationRelationLinks = plannedStage
      ? buildAuthoredRelationLinksForFrames(
          frames,
          replayPlan,
          index - 1,
          workspaceRoots,
          Number.POSITIVE_INFINITY,
          resolveFrameRelations
        )
      : [];
    const authoredCumulativeRelationRelationLinks = plannedStage
      ? buildAuthoredRelationLinksForFrames(
          frames,
          replayPlan,
          index,
          workspaceRoots,
          Number.POSITIVE_INFINITY,
          resolveFrameRelations
        )
      : [];
    const currentFrameVisibleNodeIds = collectVisibleDerivationNodeIds(
      workspaceRoots,
      authoredCumulativeRelationRelationLinks, identity
    );
    const frameReplaySnapshot = buildDerivationReplaySnapshot(
      workspaceRoots,
      index,
      authoredCumulativeRelationRelationLinks,
      futureLayoutScaffold ? currentFrameVisibleNodeIds : undefined,
      undefined,
      frames,
      undefined,
      undefined,
      futureLayoutScaffold || undefined, identity
    );
    const frameReplayBlocks = buildFrameReplayBlocks(
      frame,
      frameReplaySnapshot.canvasData,
      plannedStage
    );
    const frameStageRecordBlocks = plannedStage
      ? buildStageRecordReplayBlocks(frame, plannedStage)
      : frameReplayBlocks;
    const structuralWorkspaceRoots = buildPreMovementStructuralForest(
      workspaceRoots,
      frameRelationSteps,
      previousFrameWorkspaceRoots
    );
    const frameLayoutTopology = futureLayoutScaffold || workspaceRoots;
    const preauthorizedFramePlaceholderIds = new Set(
      Array.from(collectExactNodesByIdInForest(frameLayoutTopology).values()).flat()
        .flatMap(node => node.replayOrigin?.kind === 'layout' && node.replayOrigin.authoredId ? [node.replayOrigin.authoredId] : [])
    );
    const buildFrameLayoutScaffold = (snapshotRoots: SyntaxNode[]): SyntaxNode[] | undefined => {
      const scaffold = buildCurrentMaterialLayoutScaffold(
        snapshotRoots,
        frameLayoutTopology,
        preauthorizedFramePlaceholderIds
      );
      if (scaffold) return scaffold;
      return futureLayoutScaffold
        && forestCanUseCurrentMaterialLayoutScaffold(snapshotRoots, futureLayoutScaffold)
          ? futureLayoutScaffold
          : undefined;
    };
    const structuralLayoutScaffold = buildFrameLayoutScaffold(structuralWorkspaceRoots);
    const frameMacroBlocks = plannedStage
      ? frameStageRecordBlocks
      : frameReplayBlocks;
    const mergedFrameDetailBlocks = mergeReplayDetailBlocks(frameMacroBlocks);
    const frameEncodesMovement = frameHasMovementPayload;
    const frameTrajectoryKind = frameEncodesMovement
      ? (
          Array.isArray(frameReplaySnapshot.relationLinks) && frameReplaySnapshot.relationLinks.length > 0
            ? (
                frameReplaySnapshot.relationLinks.some((link) => normalizeTrajectoryKind(link?.trajectoryKind) === 'head')
                  ? 'head'
                  : 'phrasal'
              )
            : inferHeadLikeTrajectoryKindFromForest({
                forest: workspaceRoots,
                operation: fallbackOperation,
                sourceNodeId: String(frame.movement?.sourceNodeId || '').trim(),
                targetNodeId: authoredLandingNodeId,
                traceNodeId: String(frame.movement?.traceNodeId || '').trim()
              })
        )
      : '';

    const currentWorkspaceRootIds = new Set(
      workspaceRoots
        .map((node) => String(node?.id || '').trim())
        .filter(Boolean)
    );
    const newlyIntroducedRootIds = new Set(
      workspaceRoots
        .map((node) => String(node?.id || '').trim())
        .filter((nodeId) => Boolean(nodeId) && !previousWorkspaceRootIds.has(nodeId))
    );
    const nextFramePendingRootSubtreeIds = collectNextFramePendingRootSubtreeIds(structuralWorkspaceRoots, nextFrame);
    const moveSourceNodeIds = frameEncodesMovement
      ? Array.from(new Set([
          String(frame.movement?.traceNodeId || '').trim(),
          String(frame.movement?.sourceNodeId || '').trim()
        ].filter(Boolean)))
      : [];
    const moveSourceLabels = moveSourceNodeIds
      .map((nodeId) => getReplayNodeDisplayFromCanvas(frameReplaySnapshot.canvasData, nodeId))
      .filter(Boolean);
    const moveTargetNodeId = authoredLandingNodeId;
    const moveTargetLabel = frameEncodesMovement
      ? (
          frameTrajectoryKind === 'head'
            ? (
                getReplayNodeDisplayFromCanvas(frameReplaySnapshot.canvasData, moveTargetNodeId)
              )
            : (
                describeReplayNodePosition(frameReplaySnapshot.canvasData, moveTargetNodeId)
              )
        )
      : '';
    const moveStructuralFallbackRecipe = frameEncodesMovement
      ? buildStructuralReplayFallback(
          fallbackOperation,
          moveTargetLabel || primaryRootLabel,
          moveTargetLabel ? [moveTargetLabel] : rootLabels
        )
      : structuralFallbackRecipe;
    const resolvedSemanticRecipe = frameEncodesMovement
      ? (movementRecipe || moveStructuralFallbackRecipe)
      : semanticRecipe;

    const frameSemanticStep: PlaybackStep = {
      operation: fallbackOperation,
      sourceKind: 'derivation-effect',
      trajectoryKind: frameTrajectoryKind || undefined,
      movementSerializationStatus: frame.movement?.serializationStatus,
      movementDiagnostics: Array.isArray(frame.movement?.diagnostics) ? frame.movement.diagnostics : undefined,
      sourceFrameIndex: index,
      visualFrameIndex: index,
      targetNodeId:
        (frameEncodesMovement
          ? moveTargetNodeId
          : (
              primaryRootId
              || frame.frameId
              || frame.stepId
              || `__derivation_${index}`
            )),
      // Move steps should describe the local landing site, not the frame root.
      targetLabel:
        frameEncodesMovement
          ? moveTargetLabel
          : (
              (rootLabels.length === 1 ? primaryRootLabel : 'Workspace')
              || 'Workspace'
            ),
      sourceNodeIds: moveSourceNodeIds.length > 0 ? moveSourceNodeIds : undefined,
      sourceLabels: moveSourceLabels.length > 0
        ? moveSourceLabels
        : (frameEncodesMovement
          ? []
          : rootLabels),
      recipe: resolvedSemanticRecipe,
      workspaceAfter: rootLabels,
      detailBlocks: mergedFrameDetailBlocks,
      replayKind: plannedStage ? 'macro' : undefined,
      stageRecord: getFrameStageRecordText(frame, plannedStage),
      stepId: frame.stepId,
      chainId: frame.chainId,
      replayFrameIndex: index,
      replayCanvasData: frameReplaySnapshot.canvasData,
      replayVisibleNodeIds: frameReplaySnapshot.visibleNodeIds,
      replayRelationLinks: frameReplaySnapshot.relationLinks,
      replayUsesFutureLayoutScaffold: Boolean(futureLayoutScaffold)
    };

    const finalizeStructuralReplayForFrame = (steps: PlaybackStep[]): PlaybackStep[] => {
      let structuralSteps = steps.map(stripSemanticPayloadFromMicrostep);
      if (plannedStage) {
        // PF, deletion, and rewrite relations own their serialized tree-state
        // change at their exact authored relation index. Structural frames may
        // not reveal that completed output first.
        if (frameHasNonMovementTreeTransition && !frameHasMovementPayload && !frameHasRecoveredMovement) {
          structuralSteps = [];
        }
        const resolveRelationPlacement = (relation: IndexedRelationStep, relationIndex: number) => {
          const relationLabel = String(relation?.relation || '').trim() || 'Visual Relation';
          const resolvedAnchors = getResolvedReplayRelationAnchors(relation);
          const sourceRoles = relationOwnedPhrasalSourceRoles(relation);
          const targetRoles = relationOwnedPhrasalTargetRoles(relation);
          const registeredSourceAnchors = findResolvedReplayAnchorsByRoles(
            resolvedAnchors,
            sourceRoles
          );
          const registeredTargetAnchor = findResolvedReplayAnchorByRoles(
            resolvedAnchors,
            targetRoles
          );
          const explicitSourceNodeIds = getRelationSourceNodeIds(relation);
          const rawAuthoredTargetNodeId =
            getRelationTargetNodeId(relation)
            || String(registeredTargetAnchor?.nodeId || '').trim();
          const rawSourceNodeIds = explicitSourceNodeIds.length > 0
            ? explicitSourceNodeIds
            : registeredSourceAnchors
                .map((anchor) => String(anchor.nodeId || '').trim())
                .filter(Boolean);
          // Trajectory placement semantics apply only when the plan authored
          // explicit source/target endpoints; every other renderable relation
          // keeps its own Replay moment anchored to its resolved anchors.
          const isTrajectoryRelation =
            isRenderableReplayRelation(relation)
            && (relation.recoveredMovement
              ? relation.recoveredMovement.transition
              : isRegisteredTrajectoryRelation(relationLabel, resolvedAnchors))
            && Boolean(rawAuthoredTargetNodeId)
            && rawSourceNodeIds.length > 0;
          const ownsPhrasalTreeTransition =
            Boolean(relation.recoveredMovement?.transition)
            || (relationOwnsPhrasalTreeTransition(relation)
            && Boolean(rawAuthoredTargetNodeId)
            && rawSourceNodeIds.length > 0);
          const ownsTrajectoryPlacement = isTrajectoryRelation || ownsPhrasalTreeTransition;
          const sourceNodeIds = rawSourceNodeIds
            .map((nodeId) => resolveRelationAnchorNodeId(workspaceRoots, nodeId, 'source'))
            .filter(Boolean);
          const authoredTargetNodeId = resolveRelationAnchorNodeId(
            workspaceRoots,
            rawAuthoredTargetNodeId,
            'target'
          );
          const sourceNodeId = ownsTrajectoryPlacement
            ? (
                sourceNodeIds.find((nodeId) =>
                  relationAnchorsExistInForest(workspaceRoots, authoredTargetNodeId, nodeId)
                ) || sourceNodeIds[0] || ''
              )
            : '';
          if (ownsTrajectoryPlacement) {
            if (!relationAnchorsExistInForest(workspaceRoots, authoredTargetNodeId, sourceNodeId)) return null;
          }
          const relationAnchorNodeIds = ownsTrajectoryPlacement
            ? Array.from(new Set([authoredTargetNodeId, ...sourceNodeIds].filter(Boolean)))
            : getRelationAllAnchorNodeIds(relation)
                .map((nodeId) => resolveRelationAnchorNodeId(workspaceRoots, nodeId, 'source'))
                .filter(Boolean);
          // A relation whose authored anchors all failed to resolve keeps its
          // moment: the diagnostics on the step say what is missing. Only a
          // relation that authored no anchors at all has nothing to place.
          const authoredUnresolved = Array.isArray(relation.unresolvedAnchors) && relation.unresolvedAnchors.length > 0;
          if (relationAnchorNodeIds.length === 0 && !authoredUnresolved) return null;
          return {
            relation,
            relationIndex,
            relationLabel,
            sourceNodeIds,
            authoredTargetNodeId,
            relationAnchorNodeIds,
            renderableTrajectory: isTrajectoryRelation,
            ownsPhrasalTreeTransition
          };
        };
        const relationPlacements = frameRelationSteps
          .map((relation, relationIndex) => resolveRelationPlacement(relation, relationIndex))
          .filter((placement): placement is NonNullable<ReturnType<typeof resolveRelationPlacement>> => Boolean(placement))
          .sort((left, right) => left.relationIndex - right.relationIndex);
        const getMovementCreatedLandingHostNodeIds = (
          placement: NonNullable<ReturnType<typeof resolveRelationPlacement>>
        ): string[] => {
          if (!placement.renderableTrajectory && !placement.ownsPhrasalTreeTransition) return [];
          const trajectoryDisplayKind = placement.relation.recoveredMovement?.trajectoryKind || registeredTrajectoryDisplayKind(
            placement.relationLabel,
            placement.relation.resolvedAnchors
          );
          const ownsLandingConstruction = Boolean(placement.relation.recoveredMovement?.transition) || trajectoryDisplayKind === 'phrasal'
            || placement.ownsPhrasalTreeTransition;
          if (!ownsLandingConstruction) return [];
          const landingHostNodeId = findParentNodeIdInForest(
            workspaceRoots,
            placement.authoredTargetNodeId
          );
          if (!landingHostNodeId || findNodeByIdInForest(previousFrameWorkspaceRoots, landingHostNodeId)) return [];
          const hostIds: string[] = [];
          let branchNodeId = placement.authoredTargetNodeId;
          let parentNodeId = landingHostNodeId;
          // Include only the new ancestor path needed to join the landing to
          // existing syntax. Higher projections retain their own micro-steps.
          while (parentNodeId && !findNodeByIdInForest(previousFrameWorkspaceRoots, parentNodeId)) {
            hostIds.push(parentNodeId);
            const parent = findNodeByIdInForest(workspaceRoots, parentNodeId);
            const attachesToExistingSyntax = (parent?.children || []).some(child =>
              child.id !== branchNodeId && collectSyntaxSubtreeNodeIds(child).some(nodeId =>
                Boolean(findNodeByIdInForest(previousFrameWorkspaceRoots, nodeId))));
            if (attachesToExistingSyntax) return hostIds;
            branchNodeId = parentNodeId;
            parentNodeId = findParentNodeIdInForest(workspaceRoots, parentNodeId);
          }
          return parentNodeId ? hostIds : [landingHostNodeId];
        };
        const getMovementCreatedLandingHostNodeId = (
          placement: NonNullable<ReturnType<typeof resolveRelationPlacement>>
        ): string => getMovementCreatedLandingHostNodeIds(placement).at(-1) || '';
        const singleRelationLinksByIndex = new Map<number, ResolvedRelationLink[]>();
        frameRelationSteps.forEach((relation, relationIndex) => {
          const authoredRelationIndex = Number.isInteger(relation.authoredRelationIndex)
            ? relation.authoredRelationIndex
            : relationIndex;
          const throughRelationLinks = buildAuthoredRelationLinksForFrames(
            frames,
            replayPlan,
            index,
            workspaceRoots,
            authoredRelationIndex,
            resolveFrameRelations
          );
          const beforeRelationLinks = buildAuthoredRelationLinksForFrames(
            frames,
            replayPlan,
            index,
            workspaceRoots,
            authoredRelationIndex - 1,
            resolveFrameRelations
          );
          const beforeLinkKeys = new Set(beforeRelationLinks.map((link) => resolvedRelationLinkKey(link)));
          singleRelationLinksByIndex.set(
            relationIndex,
            throughRelationLinks.filter((link) =>
              Number(link?.stepIndex) === index
              && !beforeLinkKeys.has(resolvedRelationLinkKey(link))
            )
          );
        });
        const relationVisibleNodeIdsByIndex = new Map<number, string[]>();
        relationPlacements.forEach((placement) => {
          if (!placement.renderableTrajectory && !placement.ownsPhrasalTreeTransition) {
            relationVisibleNodeIdsByIndex.set(
              placement.relationIndex,
              []
            );
            return;
          }
          const placementRelationLinks = singleRelationLinksByIndex.get(placement.relationIndex) || [];
          const shouldReserveHeadLandingLeaf = placementRelationLinks.some((link) =>
            normalizeTrajectoryKind(link?.trajectoryKind) === 'head'
            || isHeadLikeResolvedRelation(link)
          );
          const targetSubtreeNodeIds = collectSyntaxSubtreeNodeIds(
            findNodeByIdInForest(workspaceRoots, placement.authoredTargetNodeId)
          );
          const targetParentNodeId = findParentNodeIdInForest(
            workspaceRoots,
            placement.authoredTargetNodeId
          );
          const sourceSubtreeNodeIds = placement.sourceNodeIds.flatMap((nodeId) =>
            collectSyntaxSubtreeNodeIds(findNodeByIdInForest(workspaceRoots, nodeId))
          );
          const targetSyntheticLeafNodeIds = shouldReserveHeadLandingLeaf && placement.authoredTargetNodeId
            ? [identity.allocate(`${placement.authoredTargetNodeId}::__leaf`, { kind: 'word', ownerId: placement.authoredTargetNodeId })]
            : [];
          relationVisibleNodeIdsByIndex.set(
            placement.relationIndex,
            Array.from(new Set([
              targetParentNodeId,
              ...getMovementCreatedLandingHostNodeIds(placement),
              ...targetSubtreeNodeIds,
              ...targetSyntheticLeafNodeIds,
              ...sourceSubtreeNodeIds,
              ...placement.sourceNodeIds
            ].filter(Boolean)))
          );
        });
        const relationLayoutNodeIds = Array.from(new Set(
          Array.from(relationVisibleNodeIdsByIndex.values()).flat().filter(Boolean)
        ));
        const frameHasTreeTransition =
          Array.from(singleRelationLinksByIndex.values()).some((links) => links.some(isResolvedMovementLink))
          || relationPlacements.some((placement) => placement.ownsPhrasalTreeTransition)
          || frameHasNonMovementTreeTransition;
        const collectInactiveTrajectoryTargetNodeIds = (
          activeRelationIndexes: Set<number>,
          preservedForest: SyntaxNode[] = []
        ): Set<string> => {
          const inactiveTargetNodeIds = new Set<string>();
          const activeTargetNodeIds = new Set(
            relationPlacements
              .filter((placement) => activeRelationIndexes.has(placement.relationIndex))
              .filter((placement) => placement.renderableTrajectory || placement.ownsPhrasalTreeTransition)
              .map((placement) => String(placement.authoredTargetNodeId || '').trim())
              .filter(Boolean)
          );
          const addInactiveTargetSubtree = (
            targetNodeId: string,
            preserveTargetShell = false
          ) => {
            const normalizedTargetNodeId = String(targetNodeId || '').trim();
            if (!normalizedTargetNodeId) return;
            const retainedSource = relationPlacements.some(placement => {
              const movement = placement.relation.recoveredMovement;
              return !activeRelationIndexes.has(placement.relationIndex)
                && movement?.priorSourceNodeId === normalizedTargetNodeId
                && movement.sourceNodeId !== normalizedTargetNodeId
                && Boolean(findNodeByIdInForest(preservedForest, normalizedTargetNodeId))
                && findParentNodeIdInForest(preservedForest, normalizedTargetNodeId)
                  === findParentNodeIdInForest(previousFrameWorkspaceRoots, normalizedTargetNodeId);
            });
            if (retainedSource) return;
            const targetStillExists = Boolean(
              findNodeByIdInForest(preservedForest, normalizedTargetNodeId)
            );
            collectSyntaxSubtreeNodeIds(
              findNodeByIdInForest(workspaceRoots, normalizedTargetNodeId)
            ).forEach((nodeId) => {
              if (preserveTargetShell && nodeId === normalizedTargetNodeId) return;
              // Remnant and roll-up derivations may reuse canonical descendant
              // ids between the prior source and future landing. When the
              // landing root itself is absent, an id still present in the
              // reconstructed source belongs to that source and stays visible.
              if (!targetStillExists && findNodeByIdInForest(preservedForest, nodeId)) return;
              inactiveTargetNodeIds.add(nodeId);
            });
          };
          frameRelationSteps
            .map((_relation, relationIndex) => relationIndex)
            .filter((relationIndex) => !activeRelationIndexes.has(relationIndex))
            .forEach((relationIndex) => {
              const placement = relationPlacements.find((candidate) => candidate.relationIndex === relationIndex);
              if (
                placement?.ownsPhrasalTreeTransition
                && !activeTargetNodeIds.has(String(placement.authoredTargetNodeId || '').trim())
              ) {
                addInactiveTargetSubtree(placement.authoredTargetNodeId);
              }
              (singleRelationLinksByIndex.get(relationIndex) || [])
                .filter(isResolvedMovementLink)
                .filter((link) =>
                  !activeTargetNodeIds.has(String(link?.targetNodeId || '').trim()))
                .forEach((link) => {
                  addInactiveTargetSubtree(
                    String(link?.targetNodeId || '').trim(),
                    isHeadLikeResolvedRelation(link)
                      && (!placement?.relation.recoveredMovement
                        || Boolean(findNodeByIdInForest(previousFrameWorkspaceRoots, String(link.targetNodeId || ''))))
                  );
                });
            });
          return inactiveTargetNodeIds;
        };
        const collectInactivePhrasalLandingHostNodeIds = (
          activeRelationIndexes: Set<number>
        ): Set<string> => {
          const activeLandingHostNodeIds = new Set(
            relationPlacements
              .filter((placement) => activeRelationIndexes.has(placement.relationIndex))
              .flatMap(getMovementCreatedLandingHostNodeIds)
              .filter(Boolean)
          );
          return new Set(
            relationPlacements
              .filter((placement) => !activeRelationIndexes.has(placement.relationIndex))
              .flatMap(getMovementCreatedLandingHostNodeIds)
              .filter((nodeId) => Boolean(nodeId) && !activeLandingHostNodeIds.has(nodeId))
          );
        };
        const buildActiveRelationLinks = (activeRelationIndexes: Set<number>): ResolvedRelationLink[] => {
          const links: ResolvedRelationLink[] = [...authoredPreviousRelationRelationLinks];
          const seen = new Set(links.map((link) => resolvedRelationLinkKey(link)));
          Array.from(activeRelationIndexes)
            .sort((left, right) => left - right)
            .forEach((relationIndex) => {
              (singleRelationLinksByIndex.get(relationIndex) || []).forEach((link) => {
                const key = resolvedRelationLinkKey(link);
                if (seen.has(key)) return;
                seen.add(key);
                links.push(link);
              });
            });
          return links;
        };
        const buildSnapshotForActiveRelations = (
          baseStep: PlaybackStep | undefined,
          activeRelationIndexes: Set<number>,
          extraVisibleNodeIds: string[] = []
        ) => {
          const activeFallbackTransitionRelations = frameRelationSteps.filter((_relation, relationIndex) =>
            activeRelationIndexes.has(relationIndex)
            && fallbackTreeTransitionRelationIndexes.has(relationIndex));
          const activeMovementRelations = frameRelationSteps.filter((relation, relationIndex) =>
            activeRelationIndexes.has(relationIndex) && relation.recoveredMovement?.transition);
          const registeredNonMovementTreeTransitionIsActive = Array.from(activeRelationIndexes)
            .some((relationIndex) => (
              nonMovementTreeTransitionRelationIndexes.has(relationIndex)
              && !fallbackTreeTransitionRelationIndexes.has(relationIndex)
            ));
          const activeTreeTransitionTargetNodeIds = new Set(
            relationPlacements
              .filter((placement) => activeRelationIndexes.has(placement.relationIndex))
              .filter((placement) => placement.renderableTrajectory || placement.ownsPhrasalTreeTransition)
              .map((placement) => String(placement.authoredTargetNodeId || '').trim())
              .filter(Boolean)
          );
          const nonMovementTransitionForest = !frameHasNonMovementTreeTransition
            || registeredNonMovementTreeTransitionIsActive
            ? workspaceRoots
            : activeFallbackTransitionRelations.length > 0 || activeMovementRelations.length > 0
              ? buildAnchoredTreeTransitionForest(
                  previousFrameWorkspaceRoots,
                  workspaceRoots,
                  [...activeFallbackTransitionRelations, ...activeMovementRelations]
                )
              : cloneSyntaxForest(previousFrameWorkspaceRoots);
          const snapshotWorkspaceRoots = buildPreMovementStructuralForest(
            nonMovementTransitionForest,
            frameRelationSteps.filter((_relation, relationIndex) =>
              !activeRelationIndexes.has(relationIndex)
              && !activeTreeTransitionTargetNodeIds.has(
                String(
                  relationPlacements.find((placement) => placement.relationIndex === relationIndex)
                    ?.authoredTargetNodeId || ''
                ).trim()
              )
            ),
            previousFrameWorkspaceRoots
          );
          // Movement and realization may share a completed stage. Preserve the
          // prior head's word until the later authored realization owns it.
          frameRelationSteps.forEach((movementRelation, movementIndex) => {
            const movement = movementRelation.recoveredMovement;
            if (!movement?.transition || movement.trajectoryKind !== 'head'
              || !activeRelationIndexes.has(movementIndex)) return;
            const realizationIndex = frameRelationSteps.findIndex((relation, relationIndex) =>
              relationIndex > movementIndex && relation.pronunciationNodeIds?.includes(movement.targetNodeId));
            if (realizationIndex < 0 || activeRelationIndexes.has(realizationIndex)) return;
            const prior = findExactNodeByIdInForest(previousFrameWorkspaceRoots, movement.priorSourceNodeId);
            const landing = findExactNodeByIdInForest(snapshotWorkspaceRoots, movement.targetNodeId);
            if (!prior || !landing || prior.children?.length || landing.children?.length) return;
            if (prior.word === landing.word) return;
            if (prior.word === undefined) delete landing.word;
            else landing.word = prior.word;
            if (prior.tokenIndex === undefined) delete landing.tokenIndex;
            else landing.tokenIndex = prior.tokenIndex;
          });
          const activeRelationLinks = buildActiveRelationLinks(activeRelationIndexes);
          const baseVisibleNodeIds = Array.isArray(baseStep?.replayVisibleNodeIds)
            ? baseStep.replayVisibleNodeIds
            : [];
          const fullFrameVisibleNodeIds = frameIsPureVisualTrajectoryStage
            ? Array.from(currentFrameVisibleNodeIds)
            : [];
          const activeRelationVisibleNodeIds = Array.from(activeRelationIndexes)
            .sort((left, right) => left - right)
            .flatMap((relationIndex) => relationVisibleNodeIdsByIndex.get(relationIndex) || []);
          const requestedVisibleNodeIds = new Set([
            ...baseVisibleNodeIds,
            ...fullFrameVisibleNodeIds,
            ...activeRelationVisibleNodeIds,
            ...extraVisibleNodeIds
          ].filter(Boolean));
          if (frameHasNonMovementTreeTransition
            && (registeredNonMovementTreeTransitionIsActive || activeFallbackTransitionRelations.length > 0)) {
            snapshotWorkspaceRoots.flatMap(collectSyntaxSubtreeNodeIds)
              .forEach(nodeId => requestedVisibleNodeIds.add(nodeId));
          }
          const inactiveTrajectoryTargetNodeIds = collectInactiveTrajectoryTargetNodeIds(
            activeRelationIndexes,
            snapshotWorkspaceRoots
          );
          inactiveTrajectoryTargetNodeIds.forEach((nodeId) => requestedVisibleNodeIds.delete(nodeId));
          const inactivePhrasalLandingHostNodeIds = collectInactivePhrasalLandingHostNodeIds(
            activeRelationIndexes
          );
          inactivePhrasalLandingHostNodeIds.forEach((nodeId) => requestedVisibleNodeIds.delete(nodeId));
          const requestedLayoutNodeIds = new Set([
            ...requestedVisibleNodeIds,
            ...collectSyntaxSubtreeNodeIds(baseStep?.replayCanvasData),
            ...relationLayoutNodeIds
          ].filter(Boolean));
          activeRelationLinks.filter(isResolvedMovementLink).forEach((link) => {
            [
              String(link?.sourceNodeId || '').trim(),
              String(link?.targetNodeId || '').trim(),
              String(link?.witnessNodeId || '').trim()
            ].filter(Boolean).forEach((nodeId) => {
              collectSyntaxSubtreeNodeIds(findNodeByIdInForest(workspaceRoots, nodeId)).forEach((subtreeNodeId) => {
                requestedVisibleNodeIds.add(subtreeNodeId);
                requestedLayoutNodeIds.add(subtreeNodeId);
              });
              requestedVisibleNodeIds.add(nodeId);
              requestedLayoutNodeIds.add(nodeId);
              if (isHeadLikeResolvedRelation(link)) {
                requestedVisibleNodeIds.add(identity.allocate(`${nodeId}::__leaf`, { kind: 'word', ownerId: nodeId }));
                requestedLayoutNodeIds.add(identity.allocate(`${nodeId}::__leaf`, { kind: 'word', ownerId: nodeId }));
              }
            });
          });
          const activeFutureLayoutScaffold = buildFrameLayoutScaffold(snapshotWorkspaceRoots);
          const snapshotForest = buildDerivationReplaySnapshot(
            snapshotWorkspaceRoots,
            index,
            activeRelationLinks,
            requestedVisibleNodeIds,
            requestedLayoutNodeIds,
            frames,
            undefined,
            undefined,
            activeFutureLayoutScaffold, identity
          );
          return {
            ...snapshotForest,
            usesFutureLayoutScaffold: Boolean(activeFutureLayoutScaffold),
            visibleNodeIds: snapshotForest.visibleNodeIds.filter((nodeId) =>
              !inactiveTrajectoryTargetNodeIds.has(
                replayOwnerId(snapshotForest.canvasData, String(nodeId || '').trim())
              )
              && !inactivePhrasalLandingHostNodeIds.has(
                replayOwnerId(snapshotForest.canvasData, String(nodeId || '').trim())
              )
            ),
            activeRelationLinks,
            inactiveTrajectoryTargetNodeIds,
            inactivePhrasalLandingHostNodeIds
          };
        };
        const rebuildStructuralStepForActiveRelations = (
          step: PlaybackStep,
          activeRelationIndexes: Set<number>
        ): PlaybackStep => {
          if (
            activeRelationIndexes.size === 0
            && relationLayoutNodeIds.length === 0
            && !frameHasTreeTransition
          ) {
            return step;
          }
          const snapshot = buildSnapshotForActiveRelations(step, activeRelationIndexes);
          const inactiveTrajectoryTargetNodeIds = snapshot.inactiveTrajectoryTargetNodeIds;
          const inactivePhrasalLandingHostNodeIds = snapshot.inactivePhrasalLandingHostNodeIds;
          const suppressedInactiveTrajectoryNodeIds = new Set(inactiveTrajectoryTargetNodeIds);
          inactiveTrajectoryTargetNodeIds.forEach((nodeId) => {
            collectSyntaxSubtreeNodeIds(
              findNodeByIdInForest(step.replayCanvasData ? [step.replayCanvasData] : [], nodeId)
            ).forEach((subtreeNodeId) => suppressedInactiveTrajectoryNodeIds.add(subtreeNodeId));
          });
          inactivePhrasalLandingHostNodeIds.forEach((nodeId) => {
            suppressedInactiveTrajectoryNodeIds.add(nodeId);
          });
          return {
            ...step,
            replayCanvasData: snapshot.canvasData,
            replayVisibleNodeIds: snapshot.visibleNodeIds,
            replayRelationLinks: snapshot.relationLinks,
            replayUsesFutureLayoutScaffold: snapshot.usesFutureLayoutScaffold,
            replaySuppressAutoRevealNodeIds: Array.from(new Set([
              ...(Array.isArray(step.replaySuppressAutoRevealNodeIds)
                ? step.replaySuppressAutoRevealNodeIds
                : []),
              ...suppressedInactiveTrajectoryNodeIds
            ]))
          };
        };
        const buildRelationPlaybackStep = (
          placement: ReturnType<typeof resolveRelationPlacement>,
          activeRelationIndexes: Set<number>,
          baseStep?: PlaybackStep
        ): PlaybackStep => {
          const extraVisibleNodeIds = relationVisibleNodeIdsByIndex.get(placement.relationIndex) || [];
          const relationReplaySnapshot = buildSnapshotForActiveRelations(
            baseStep,
            activeRelationIndexes,
            extraVisibleNodeIds
          );
          const resolvedTargetNodeId =
            placement.authoredTargetNodeId
            || placement.relationAnchorNodeIds[0]
            || frameSemanticStep.targetNodeId;
          const resolvedSourceNodeIds = placement.renderableTrajectory
            ? placement.sourceNodeIds
            : placement.relationAnchorNodeIds.filter((nodeId) => nodeId !== resolvedTargetNodeId);
          return {
            ...frameSemanticStep,
            operation: placement.relationLabel as DerivationOperation,
            replayKind: 'relation',
            replayRelationIdentity: {
              stageIndex: index,
              relationIndex: Number.isInteger(placement.relation.authoredRelationIndex)
                ? placement.relation.authoredRelationIndex
                : placement.relationIndex
            },
            targetNodeId: resolvedTargetNodeId || frameSemanticStep.targetNodeId,
            targetLabel:
              getReplayNodeOvertYieldFromCanvas(relationReplaySnapshot.canvasData, resolvedTargetNodeId)
              || getReplayNodeDisplayFromCanvas(relationReplaySnapshot.canvasData, resolvedTargetNodeId)
              || getReplayNodeCategoryFromCanvas(relationReplaySnapshot.canvasData, resolvedTargetNodeId)
              || placement.relationLabel,
            sourceNodeIds: resolvedSourceNodeIds.length > 0
              ? resolvedSourceNodeIds
              : frameSemanticStep.sourceNodeIds,
            sourceLabels: resolvedSourceNodeIds
              .map((nodeId) =>
                getReplayNodeOvertYieldFromCanvas(relationReplaySnapshot.canvasData, nodeId)
                || getReplayNodeDisplayFromCanvas(relationReplaySnapshot.canvasData, nodeId)
                || getReplayNodeCategoryFromCanvas(relationReplaySnapshot.canvasData, nodeId)
              )
              .filter(Boolean),
            recipe: placement.relationLabel,
            movementDiagnostics: placement.relation.movementDiagnostics,
            note: undefined,
            preserveReplayStep: true,
            stageRecord: getFrameStageRecordText(frame, plannedStage),
            detailBlocks: buildRelationReplayBlocks([placement.relation], relationReplaySnapshot.canvasData),
            replayCanvasData: relationReplaySnapshot.canvasData,
            replayVisibleNodeIds: relationReplaySnapshot.visibleNodeIds,
            replayRelationLinks: relationReplaySnapshot.relationLinks,
            replayUsesFutureLayoutScaffold: relationReplaySnapshot.usesFutureLayoutScaffold
          } satisfies PlaybackStep;
        };
        const shouldFoldStructuralStepIntoRelationFrame = (
          step: PlaybackStep,
          _structuralStepIndex: number
        ): boolean => {
          const operation = String(step.operation || '').trim();
          if (!['LexicalSelect', 'Project', 'ExternalMerge'].includes(operation)) return false;
          const stepTargetNodeId = replayOwnerId(step.replayCanvasData, String(step.targetNodeId || '').trim());
          if (!stepTargetNodeId) return false;
          return relationPlacements.some((placement) => {
            if (!placement.renderableTrajectory && !placement.ownsPhrasalTreeTransition) return false;
            const relationTargetNode = findNodeByIdInForest(workspaceRoots, placement.authoredTargetNodeId);
            const relationTargetSubtreeIds = new Set(collectSyntaxSubtreeNodeIds(relationTargetNode));
            if (relationTargetSubtreeIds.has(stepTargetNodeId)) return true;

            // The new attachment belongs to movement, not a later merge of
            // a temporarily detached landing complex.
            return getMovementCreatedLandingHostNodeIds(placement).includes(stepTargetNodeId);
          });
        };

        /*
         * Structural construction remains bottom-up, but Internal Merge owns
         * a landing host that did not exist in the preceding authored stage.
         * Play that relation after its lower source is complete and before the
         * first higher projection consumes the new host. Otherwise Replay
         * exposes a false hanging ancestor whose missing child is licensed only
         * by a later movement frame.
         */
        const activeRelationIndexes = new Set<number>();
        const normalizeWithheldLandingHostStep = (step: PlaybackStep): PlaybackStep => {
          const stepTargetNodeId = replayOwnerId(step.replayCanvasData, String(step.targetNodeId || '').trim());
          if (!stepTargetNodeId) return step;
          const withheldLandingNodeIds = new Set(
            relationPlacements
              .filter((placement) => placement.renderableTrajectory || placement.ownsPhrasalTreeTransition)
              .filter((placement) =>
                findParentNodeIdInForest(workspaceRoots, placement.authoredTargetNodeId) === stepTargetNodeId)
              .map((placement) => placement.authoredTargetNodeId)
              .filter(Boolean)
          );
          if (withheldLandingNodeIds.size === 0) return step;
          const sourceNodeIds = Array.isArray(step.sourceNodeIds) ? step.sourceNodeIds : [];
          const sourceLabels = Array.isArray(step.sourceLabels) ? step.sourceLabels : [];
          const retainedSources = sourceNodeIds
            .map((nodeId, sourceIndex) => ({ nodeId, label: sourceLabels[sourceIndex] || '' }))
            .filter(({ nodeId }) => !withheldLandingNodeIds.has(nodeId));
          if (retainedSources.length === sourceNodeIds.length || retainedSources.length === 0) return step;
          const operation: DerivationOperation = retainedSources.length === 1
            ? 'Project'
            : 'ExternalMerge';
          const retainedLabels = retainedSources.map(({ label }) => label).filter(Boolean);
          return {
            ...step,
            operation,
            sourceNodeIds: retainedSources.map(({ nodeId }) => nodeId),
            sourceLabels: retainedLabels,
            recipe: buildStructuralReplayFallback(
              operation,
              String(step.targetLabel || '').trim(),
              retainedLabels
            )
          };
        };
        let precedingStructuralVisibleNodeIds = new Set(previousVisibleNodeIds);
        const structuralStepEntries = structuralSteps.map((step, structuralStepIndex) => {
          const visibleNodeIds = new Set(
            (Array.isArray(step.replayVisibleNodeIds) ? step.replayVisibleNodeIds : [])
              .map((nodeId) => String(nodeId || '').trim())
              .filter(Boolean)
          );
          const introducedVisibleNodeIds = Array.from(visibleNodeIds)
            .filter((nodeId) => !precedingStructuralVisibleNodeIds.has(nodeId));
          precedingStructuralVisibleNodeIds = visibleNodeIds;
          return { step, structuralStepIndex, introducedVisibleNodeIds };
        });
        let pendingStructuralStepEntries = structuralStepEntries
          .filter(({ step, structuralStepIndex }) =>
            !shouldFoldStructuralStepIntoRelationFrame(step, structuralStepIndex))
          .map((entry) => ({
            ...entry,
            step: normalizeWithheldLandingHostStep(entry.step)
          }));
        const movementCreatedLandingHosts = Array.from(new Set(
          relationPlacements
            .map((placement) => ({
              placement,
              landingHostNodeId: getMovementCreatedLandingHostNodeId(placement)
            }))
            .filter(({ landingHostNodeId }) => Boolean(landingHostNodeId))
            .map(({ landingHostNodeId }) => landingHostNodeId)
        ));
        const movementPrerequisiteNodeIds = new Set<string>();
        if (movementCreatedLandingHosts.length === 1) {
          const landingHostNodeId = movementCreatedLandingHosts[0];
          const landingPlacements = relationPlacements.filter((placement) =>
            getMovementCreatedLandingHostNodeId(placement) === landingHostNodeId);
          const landingHostIds = new Set(landingPlacements.flatMap(getMovementCreatedLandingHostNodeIds));
          const landingTargetNodeIds = new Set(
            landingPlacements
              .map((placement) => placement.authoredTargetNodeId)
              .filter(Boolean)
          );
          const addSubtree = (nodeId: string) => {
            collectSyntaxSubtreeNodeIds(findNodeByIdInForest(workspaceRoots, nodeId))
              .forEach((subtreeNodeId) => movementPrerequisiteNodeIds.add(subtreeNodeId));
          };

          Array.from(landingHostIds)
            .flatMap(nodeId => findNodeByIdInForest(workspaceRoots, nodeId)?.children || [])
            .map((child) => String(child?.id || '').trim())
            .filter((childNodeId) => Boolean(childNodeId) && !landingTargetNodeIds.has(childNodeId) && !landingHostIds.has(childNodeId))
            .forEach(addSubtree);
          landingPlacements.forEach((placement) => {
            placement.sourceNodeIds.forEach(addSubtree);
            getRelationAllAnchorNodeIds(placement.relation)
              .map((nodeId) => resolveRelationAnchorNodeId(workspaceRoots, nodeId, 'source'))
              .filter(Boolean)
              .filter((nodeId) => !landingTargetNodeIds.has(nodeId))
              .filter((nodeId) => !placement.sourceNodeIds.includes(nodeId))
              .filter((nodeId) => !collectSyntaxSubtreeNodeIds(
                findNodeByIdInForest(workspaceRoots, nodeId)
              ).some(id => landingHostIds.has(id)))
              .forEach(addSubtree);
          });

          const beforeMovement: typeof pendingStructuralStepEntries = [];
          const afterMovement: typeof pendingStructuralStepEntries = [];
          pendingStructuralStepEntries.forEach((entry) => {
            const stepTargetNodeId = replayOwnerId(entry.step.replayCanvasData,
              String(entry.step.targetNodeId || '').trim()
            );
            (movementPrerequisiteNodeIds.has(stepTargetNodeId) ? beforeMovement : afterMovement).push(entry);
          });
          const deferredVisibleNodeIds = new Set(
            afterMovement.flatMap((entry) => entry.introducedVisibleNodeIds)
          );
          const deferredStructuralTargetNodeIds = new Set(
            afterMovement
              .map((entry) => replayOwnerId(entry.step.replayCanvasData,
                String(entry.step.targetNodeId || '').trim()
              ))
              .filter(Boolean)
          );
          const scrubDeferredVisibility = (entry: (typeof beforeMovement)[number]) => ({
            ...entry,
            step: {
              ...entry.step,
              replayVisibleNodeIds: (Array.isArray(entry.step.replayVisibleNodeIds)
                ? entry.step.replayVisibleNodeIds
                : []).filter((nodeId) => {
                  const normalizedNodeId = String(nodeId || '').trim();
                  return !deferredVisibleNodeIds.has(normalizedNodeId)
                    && !deferredStructuralTargetNodeIds.has(
                      replayOwnerId(entry.step.replayCanvasData, normalizedNodeId)
                    );
                })
            }
          });
          pendingStructuralStepEntries = [
            ...beforeMovement.map(scrubDeferredVisibility),
            ...afterMovement
          ];
        }
        const pendingStructuralSteps = pendingStructuralStepEntries.map((entry) => entry.step);
        const relationInsertionIndex = (
          placement: NonNullable<ReturnType<typeof resolveRelationPlacement>>
        ): number => {
          const landingHostNodeId = getMovementCreatedLandingHostNodeId(placement);
          if (!landingHostNodeId) return pendingStructuralSteps.length;
          if (movementCreatedLandingHosts.length === 1) {
            const firstNonPrerequisiteIndex = pendingStructuralSteps.findIndex((step) => {
              const stepTargetNodeId = replayOwnerId(step.replayCanvasData,
                String(step.targetNodeId || '').trim()
              );
              return !movementPrerequisiteNodeIds.has(stepTargetNodeId);
            });
            return firstNonPrerequisiteIndex >= 0
              ? firstNonPrerequisiteIndex
              : pendingStructuralSteps.length;
          }
          const firstHigherProjectionIndex = pendingStructuralSteps.findIndex((step) => {
            const stepTargetNodeId = replayOwnerId(step.replayCanvasData,
              String(step.targetNodeId || '').trim()
            );
            if (!stepTargetNodeId) return false;
            return collectSyntaxSubtreeNodeIds(
              findNodeByIdInForest(workspaceRoots, stepTargetNodeId)
            ).includes(landingHostNodeId);
          });
          return firstHigherProjectionIndex >= 0
            ? firstHigherProjectionIndex
            : pendingStructuralSteps.length;
        };
        const scheduledRelationPlacements = relationPlacements
          .map((placement) => ({
            placement,
            insertionIndex: relationInsertionIndex(placement)
          }))
          .sort((left, right) =>
            left.insertionIndex === right.insertionIndex
              ? left.placement.relationIndex - right.placement.relationIndex
              : left.insertionIndex - right.insertionIndex
          );
        const stagePlaybackSteps: PlaybackStep[] = [];
        const availableNodeIds = new Set(previousFrameWorkspaceRoots.flatMap(root =>
          collectSyntaxSubtreeNodeIds(buildRenderableCommittedCanvasData(root))));
        const structuralProducers = new Map(pendingStructuralSteps.map((step, stepIndex) => [step.targetNodeId, stepIndex]));
        const relationProducers = new Map<string, number>();
        relationPlacements.forEach((placement) => {
          if (!placement.renderableTrajectory && !placement.ownsPhrasalTreeTransition) return;
          const ownedIds = [
            ...collectSyntaxSubtreeNodeIds(findNodeByIdInForest(workspaceRoots, placement.authoredTargetNodeId))
              .filter(nodeId => !findExactNodeByIdInForest(structuralWorkspaceRoots, nodeId)),
            ...getMovementCreatedLandingHostNodeIds(placement)
          ];
          ownedIds.filter(nodeId => !availableNodeIds.has(nodeId)).forEach(nodeId => {
            if (!relationProducers.has(nodeId)) relationProducers.set(nodeId, placement.relationIndex);
          });
        });
        const emittedStructuralSteps = new Set<number>();
        const visitingStructuralSteps = new Set<number>();
        let nextRelation = 0;
        const withPendingStructureHidden = (step: PlaybackStep): PlaybackStep => {
          const pendingIds = new Set([
            ...structuralProducers.keys(),
            ...relationProducers.keys()
          ].filter(nodeId => !availableNodeIds.has(nodeId)));
          return {
            ...step,
            replayVisibleNodeIds: (step.replayVisibleNodeIds || []).filter(nodeId => !pendingIds.has(nodeId)),
            replaySuppressAutoRevealNodeIds: Array.from(new Set([
              ...(step.replaySuppressAutoRevealNodeIds || []),
              ...pendingIds
            ]))
          };
        };

        // Preferred insertion positions control presentation, never authored
        // relation order. A prerequisite may pull independent tree-building
        // forward, but may not activate a later relation to satisfy an earlier one.
        const ensureNodeAvailable = (nodeId: string, forRelation?: number): string[] => {
          if (availableNodeIds.has(nodeId)) return [];
          const relationProducer = relationProducers.get(nodeId);
          if (relationProducer !== undefined) {
            if (forRelation !== undefined && relationProducer >= forRelation) return [nodeId];
            emitRelationsThrough(relationProducer);
            return availableNodeIds.has(nodeId) ? [] : [nodeId];
          }
          const structuralProducer = structuralProducers.get(nodeId);
          return structuralProducer === undefined ? [] : emitStructuralStep(structuralProducer, forRelation);
        };
        const emitStructuralStep = (stepIndex: number, forRelation?: number): string[] => {
          if (emittedStructuralSteps.has(stepIndex)) return [];
          const step = pendingStructuralSteps[stepIndex];
          if (visitingStructuralSteps.has(stepIndex)) return [step.targetNodeId];
          visitingStructuralSteps.add(stepIndex);
          const missing = (step.sourceNodeIds || [])
            .filter(nodeId => nodeId !== step.targetNodeId)
            .flatMap(nodeId => ensureNodeAvailable(nodeId, forRelation));
          visitingStructuralSteps.delete(stepIndex);
          if (missing.length) return missing;
          availableNodeIds.add(step.targetNodeId);
          pendingStructuralStepEntries[stepIndex].introducedVisibleNodeIds.forEach(id => availableNodeIds.add(id));
          const lastVisible = stagePlaybackSteps.at(-1)?.replayVisibleNodeIds || [];
          const rebuilt = rebuildStructuralStepForActiveRelations({
            ...step,
            replayVisibleNodeIds: Array.from(new Set([
              ...(step.replayVisibleNodeIds || []),
              ...lastVisible,
              step.targetNodeId
            ]))
          }, activeRelationIndexes);
          stagePlaybackSteps.push(withPendingStructureHidden(rebuilt));
          emittedStructuralSteps.add(stepIndex);
          return [];
        };
        const emitRelationsThrough = (relationIndex: number) => {
          while (nextRelation < relationPlacements.length
            && relationPlacements[nextRelation].relationIndex <= relationIndex) {
            const placement = relationPlacements[nextRelation++];
            const requiredIds = placement.relationAnchorNodeIds.filter(nodeId =>
              relationProducers.get(nodeId) !== placement.relationIndex);
            const missing = Array.from(new Set(requiredIds.flatMap(nodeId =>
              ensureNodeAvailable(nodeId, placement.relationIndex))));
            if (missing.length) {
              const descriptions = missing.map(nodeId => {
                const owner = relationProducers.get(nodeId);
                return owner === undefined ? `${nodeId} before its structural prerequisites are available`
                  : `${nodeId} before relation ${(frameRelationSteps[owner].authoredRelationIndex ?? owner) + 1} (${frameRelationSteps[owner].relation}) introduces it`;
              });
              const message = `RELATION_TIMING_CONFLICT: Stage ${index + 1}, relation ${(placement.relation.authoredRelationIndex ?? placement.relationIndex) + 1} (${placement.relationLabel}) requires ${descriptions.join('; ')}. Authored relation order is preserved; unavailable structure is not introduced early.`;
              const involvedRelations = new Set([
                placement.relationIndex,
                ...missing.map(nodeId => relationProducers.get(nodeId))
              ]);
              relationPlacements.filter(candidate => involvedRelations.has(candidate.relationIndex))
                .forEach(candidate => {
                  candidate.relation = { ...candidate.relation, movementDiagnostics: [
                    ...(candidate.relation.movementDiagnostics || []), message
                  ] };
                });
            }
            activeRelationIndexes.add(placement.relationIndex);
            relationProducers.forEach((owner, nodeId) => {
              if (owner === placement.relationIndex) availableNodeIds.add(nodeId);
            });
            const baseStep = stagePlaybackSteps.at(-1) ?? {
              ...frameSemanticStep,
              replayVisibleNodeIds: Array.from(availableNodeIds)
            };
            const relationStep = withPendingStructureHidden(
              buildRelationPlaybackStep(placement, activeRelationIndexes, baseStep)
            );
            stagePlaybackSteps.push(relationStep);
            (relationStep.replayVisibleNodeIds || []).forEach(id => availableNodeIds.add(id));
          }
        };
        for (
          let structuralStepIndex = 0;
          structuralStepIndex <= pendingStructuralSteps.length;
          structuralStepIndex += 1
        ) {
          scheduledRelationPlacements
            .filter(({ insertionIndex }) => insertionIndex === structuralStepIndex)
            .forEach(({ placement }) => {
              emitRelationsThrough(placement.relationIndex);
            });
          if (structuralStepIndex >= pendingStructuralSteps.length) continue;
          emitStructuralStep(structuralStepIndex);
        }
        const stageStepCount = stagePlaybackSteps.length + 1;
        let stageStepNumber = 1;
        const annotateStep = (step: PlaybackStep, replayKind: PlaybackStep['replayKind']): PlaybackStep => ({
          ...step,
          replayKind,
          replayProgressLabel: buildReplayProgressLabel(
            plannedStage,
            plannedStageCount,
            stageStepNumber++,
            stageStepCount
          )
        });
        const completedStageReplayStep = stagePlaybackSteps[stagePlaybackSteps.length - 1];
        const fallbackStageCompletionSnapshot = fallbackTreeTransitionRelationIndexes.size > 0
          ? frameReplaySnapshot
          : null;
        return [
          ...stagePlaybackSteps.map((step) => annotateStep(step, step.replayKind || 'micro')),
          annotateStep(
            {
              ...frameSemanticStep,
              operation: 'StageRecord' as DerivationOperation,
              replayKind: 'macro',
              detailBlocks: mergeReplayDetailBlocks(frameStageRecordBlocks),
              note: undefined,
              recipe:
                String(plannedStage.statement || '').trim()
                || frameSemanticStep.recipe
                || `Stage ${plannedStage.stageNumber}`,
              replayCanvasData:
                fallbackStageCompletionSnapshot?.canvasData
                || completedStageReplayStep?.replayCanvasData
                || frameSemanticStep.replayCanvasData,
              replayVisibleNodeIds: fallbackStageCompletionSnapshot
                ? fallbackStageCompletionSnapshot.visibleNodeIds
                : Array.isArray(completedStageReplayStep?.replayVisibleNodeIds)
                  ? completedStageReplayStep.replayVisibleNodeIds
                  : frameSemanticStep.replayVisibleNodeIds,
              replayRelationLinks: fallbackStageCompletionSnapshot
                ? fallbackStageCompletionSnapshot.relationLinks
                : Array.isArray(completedStageReplayStep?.replayRelationLinks)
                  ? completedStageReplayStep.replayRelationLinks
                  : frameSemanticStep.replayRelationLinks,
              replayUsesFutureLayoutScaffold:
                (fallbackStageCompletionSnapshot ? Boolean(futureLayoutScaffold) : undefined)
                ?? completedStageReplayStep?.replayUsesFutureLayoutScaffold
                ?? frameSemanticStep.replayUsesFutureLayoutScaffold
            },
            'macro'
          )
        ];
      }
      if (frameCarriesAuthoredEffect) {
        return [...structuralSteps, frameSemanticStep];
      }
      return structuralSteps;
    };

    const rootIntroductionMicrosteps =
      !frameHasMovementPayload &&
      !isMoveLikeOperation(fallbackOperation) &&
      structuralWorkspaceRoots.length > 1 &&
      newlyIntroducedRootIds.size > 0
        ? buildStructuralDerivationPlaybackSteps(
            structuralWorkspaceRoots,
            index,
            priorVisibleNodeIds,
            authoredPreviousRelationRelationLinks,
            newlyIntroducedRootIds,
            frames,
            sentence,
            [],
            structuralLayoutScaffold || undefined, identity
          )
        : [];
    if (rootIntroductionMicrosteps.length > 1) {
      previousWorkspaceRootIds = currentWorkspaceRootIds;
      previousVisibleNodeIds = currentFrameVisibleNodeIds;
      return finalizeStructuralReplayForFrame(rootIntroductionMicrosteps);
    }

    const structuralMicrosteps = !frameHasMovementPayload && !isMoveLikeOperation(fallbackOperation)
      ? buildStructuralDerivationPlaybackSteps(
          structuralWorkspaceRoots,
          index,
          priorVisibleNodeIds,
          authoredPreviousRelationRelationLinks,
          undefined,
          frames,
          sentence,
          [],
          structuralLayoutScaffold || undefined, identity
        )
      : [];

    if (frameIsPureVisualTrajectoryStage) {
      previousWorkspaceRootIds = currentWorkspaceRootIds;
      previousVisibleNodeIds = currentFrameVisibleNodeIds;
      return finalizeStructuralReplayForFrame([]);
    }

    if (String(fallbackOperation || '').trim() === 'LexicalSelect') {
      const newlySelectedRoots = structuralWorkspaceRoots.filter((root) => {
        const rootId = String(root?.id || '').trim();
        return rootId && !previousWorkspaceRootIds.has(rootId);
      });
      const packsInternalBaseGeneration = newlySelectedRoots.some((root) =>
        countOvertLeafSyntaxNodes(root) > 1 || hasBranchingSyntaxSubtree(root)
      );
      if (packsInternalBaseGeneration && structuralMicrosteps.length > 1) {
        previousWorkspaceRootIds = currentWorkspaceRootIds;
        previousVisibleNodeIds = currentFrameVisibleNodeIds;
        return finalizeStructuralReplayForFrame(structuralMicrosteps);
      }
      if (newlySelectedRoots.length > 0) {
        const projectedRootIds = new Set(previousWorkspaceRootIds);
        const projectedRootSubtreeIds = new Set<string>();
        const lexicalSnapshotRoots = nextFramePendingRootSubtreeIds.size > 0 && Array.isArray(nextFrame?.workspaceForest)
          ? reorderWorkspaceRootsForReplay(
              nextFrame.workspaceForest,
              inferFutureWorkspaceRootOrder(nextFrame.workspaceForest, frames, index + 1)
            )
          : structuralWorkspaceRoots;
        let lexicalStepCursor = 0;
        const buildWorkspaceLabelsForState = (
          activeRootId: string,
          activeLabel: string,
          mode: 'leaf' | 'projected'
        ): string[] => structuralWorkspaceRoots
          .map((candidateRoot) => {
            const candidateId = String(candidateRoot?.id || '').trim();
            if (!candidateId) return '';
            if (candidateId === activeRootId) {
              return mode === 'leaf'
                ? activeLabel
                : String(candidateRoot?.label || '').trim();
            }
            if (!projectedRootIds.has(candidateId)) return '';
            return String(candidateRoot?.label || '').trim();
          })
          .filter(Boolean);

        const lexicalReplaySteps = newlySelectedRoots.flatMap((root, rootIndex) => {
          const rootId = String(root?.id || '').trim() || `__derivation_${index}_lex_${lexicalStepCursor + 1}`;
          const projectedLabel = String(root?.label || '').trim() || 'Workspace';
          const leafTarget = getReplayLeafSelectionTarget(root, identity);
          const rootSubtreeIds = collectSyntaxSubtreeNodeIds(root);
          const pendingRootSubtreeIds = newlySelectedRoots
            .slice(rootIndex + 1)
            .flatMap((pendingRoot) => collectSyntaxSubtreeNodeIds(pendingRoot));
          const lexicalSteps: PlaybackStep[] = [];

          if (leafTarget) {
            const leafSurface = getPreFrontingLexicalSurface(leafTarget.surface, index);
            const selectVisibleNodeIds = new Set<string>(projectedRootIds);
            selectVisibleNodeIds.add(leafTarget.nodeId);
            const selectLayoutNodeIds = new Set<string>(selectVisibleNodeIds);
            projectedRootSubtreeIds.forEach((subtreeNodeId) => selectLayoutNodeIds.add(subtreeNodeId));
            rootSubtreeIds.forEach((subtreeNodeId) => selectLayoutNodeIds.add(subtreeNodeId));
            pendingRootSubtreeIds.forEach((subtreeNodeId) => selectLayoutNodeIds.add(subtreeNodeId));
            nextFramePendingRootSubtreeIds.forEach((subtreeNodeId) => selectLayoutNodeIds.add(subtreeNodeId));
            const lexicalSelectSnapshot = buildDerivationReplaySnapshot(
              lexicalSnapshotRoots,
              index,
              authoredPreviousRelationRelationLinks,
              selectVisibleNodeIds,
              selectLayoutNodeIds,
              frames,
              undefined,
              preferredWorkspaceRootSideHints, undefined, identity
            );
            lexicalStepCursor += 1;
            lexicalSteps.push({
              ...frameSemanticStep,
              targetNodeId: leafTarget.nodeId,
              targetLabel: leafSurface,
              sourceNodeIds: [leafTarget.nodeId],
              sourceLabels: [leafSurface],
              recipe: buildStructuralReplayFallback('LexicalSelect', leafSurface, [leafSurface]),
              workspaceAfter: buildWorkspaceLabelsForState(rootId, leafSurface, 'leaf'),
              replayCanvasData: lexicalSelectSnapshot.canvasData,
              replayVisibleNodeIds: lexicalSelectSnapshot.visibleNodeIds,
              replayRelationLinks: lexicalSelectSnapshot.relationLinks,
              stepId: frameSemanticStep.stepId ? `${frameSemanticStep.stepId}.${lexicalStepCursor}` : undefined
            } satisfies PlaybackStep);
          }

          projectedRootIds.add(rootId);
          rootSubtreeIds.forEach((subtreeNodeId) => projectedRootSubtreeIds.add(subtreeNodeId));
          const projectVisibleNodeIds = new Set<string>(projectedRootIds);
          const projectLayoutNodeIds = new Set<string>(projectVisibleNodeIds);
          projectedRootSubtreeIds.forEach((subtreeNodeId) => projectLayoutNodeIds.add(subtreeNodeId));
          pendingRootSubtreeIds.forEach((subtreeNodeId) => projectLayoutNodeIds.add(subtreeNodeId));
          nextFramePendingRootSubtreeIds.forEach((subtreeNodeId) => projectLayoutNodeIds.add(subtreeNodeId));
          const lexicalProjectSnapshot = buildDerivationReplaySnapshot(
            lexicalSnapshotRoots,
            index,
            authoredPreviousRelationRelationLinks,
            projectVisibleNodeIds,
            projectLayoutNodeIds,
            frames,
            undefined,
            preferredWorkspaceRootSideHints, undefined, identity
          );
          lexicalStepCursor += 1;
          lexicalSteps.push({
            ...frameSemanticStep,
            operation: 'Project',
            targetNodeId: rootId,
            targetLabel: projectedLabel,
            sourceNodeIds: [rootId],
            sourceLabels: [projectedLabel],
            recipe: buildStructuralReplayFallback('Project', projectedLabel, [projectedLabel]),
            workspaceAfter: buildWorkspaceLabelsForState(rootId, projectedLabel, 'projected'),
            replayCanvasData: lexicalProjectSnapshot.canvasData,
            replayVisibleNodeIds: lexicalProjectSnapshot.visibleNodeIds,
            replayRelationLinks: lexicalProjectSnapshot.relationLinks,
            stepId: frameSemanticStep.stepId ? `${frameSemanticStep.stepId}.${lexicalStepCursor}` : undefined
          } satisfies PlaybackStep);

          return lexicalSteps;
        });
        previousWorkspaceRootIds = currentWorkspaceRootIds;
        previousVisibleNodeIds = currentFrameVisibleNodeIds;
        return finalizeStructuralReplayForFrame(lexicalReplaySteps);
      }
    }

    if (structuralMicrosteps.length > 1) {
      previousWorkspaceRootIds = currentWorkspaceRootIds;
      previousVisibleNodeIds = currentFrameVisibleNodeIds;
      return finalizeStructuralReplayForFrame(structuralMicrosteps);
    }

    if (structuralMicrosteps.length > 0 && frameCarriesAuthoredEffect) {
      previousWorkspaceRootIds = currentWorkspaceRootIds;
      previousVisibleNodeIds = currentFrameVisibleNodeIds;
      return finalizeStructuralReplayForFrame(structuralMicrosteps);
    }

    previousWorkspaceRootIds = currentWorkspaceRootIds;
    previousVisibleNodeIds = currentFrameVisibleNodeIds;

    /*
     * A PLANNED stage with no structural microsteps still owns a reachable
     * final Stage Record state. Two such shapes exist:
     * - a relations-only stage, whose authored relation moments must not be
     *   dropped with the microsteps;
     * - a stage whose only tree delta is the REMOVAL of material (e.g. an
     *   anchored node vanishing). A bare 'Other' step for that state would
     *   be deleted by the overt-loss guard, making the whole stage
     *   unreachable and leaving the previous stage's relation on screen.
     * Both route through the finalizer with zero structural steps: relation
     * moments (if any) place first, then the stage's authoritative macro
     * carries the stage's own complete canvas. The overt-material guards
     * already treat a Stage Record as authoritative, so this weakens no
     * transient-microstep protection — it only makes every authored stage's
     * final state reachable.
     */
    if (plannedStage && (frameRelationSteps.length > 0 || structuralMicrosteps.length === 0)) {
      return finalizeStructuralReplayForFrame([]);
    }

    return [frameSemanticStep];
  });

  const squashedFrameBackedSteps = squashAdjacentStructuralReplayDuplicates(frameBackedSteps);
  const visibilityStabilizedSteps = stabilizeStructuralReplayVisibility(squashedFrameBackedSteps);
  const nullSelectionExpandedSteps = splitCollapsedNullSelectionProjectSteps(visibilityStabilizedSteps);
  const validVisibilitySteps = removeInvalidReplayVisibilityTransitions(nullSelectionExpandedSteps);
  const relationCarriedSteps = carryReplayRelationLinksForward(validVisibilitySteps);
  const zeroDeltaCollapsedSteps = collapseZeroDeltaReplaySteps(relationCarriedSteps);
  const landingMergeExpandedSteps = insertPreMovementLandingMergeSteps(zeroDeltaCollapsedSteps);
  const projectionSteps = deferPendingMovementProjections(landingMergeExpandedSteps, pendingProjectionReveals);
  const countedSteps = recountReplayProgress(projectionSteps, replayPlan);
  return attachReplayRealizations(normalizeReplaySentenceInitialCasing(countedSteps, sentenceInitialSurface), frames);
};

const deferPendingMovementProjections = (
  steps: PlaybackStep[],
  projections: Array<{ nodeId: string; firstStageIndex: number; stageIndex: number; relationIndex: number }>
): PlaybackStep[] => {
  if (projections.length === 0) return steps;
  const reveals = projections.map(projection => ({
    ...projection,
    moment: steps.findIndex(step => step.replayRelationIdentity?.stageIndex === projection.stageIndex
      && step.replayRelationIdentity.relationIndex === projection.relationIndex)
  })).filter(projection => projection.moment >= 0);
  return steps.flatMap((step, index) => {
    const withheld = new Set(reveals.filter(projection => index < projection.moment
      && Number(step.replayFrameIndex) >= projection.firstStageIndex).map(projection => projection.nodeId));
    if (withheld.size === 0) return [step];
    if (step.replayKind === 'micro' && step.operation === 'Project' && withheld.has(step.targetNodeId)) return [];
    return [{ ...step,
      replayVisibleNodeIds: step.replayVisibleNodeIds?.filter(id => !withheld.has(id))
    }];
  });
};

const recountReplayProgress = (
  steps: PlaybackStep[],
  replayPlan?: DerivationReplayPlan | null
): PlaybackStep[] => {
  const counts = new Map<number, number>();
  const positions = new Map<number, number>();
  steps.forEach(step => {
    const index = step.replayFrameIndex;
    if (index !== undefined) counts.set(index, (counts.get(index) || 0) + 1);
  });
  return steps.map(step => {
    const index = step.replayFrameIndex;
    const stage = index === undefined ? undefined : getReplayPlanStage(replayPlan, index);
    if (!stage || index === undefined) return step;
    const position = (positions.get(index) || 0) + 1;
    positions.set(index, position);
    return { ...step, replayProgressLabel: buildReplayProgressLabel(stage, replayPlan!.stages.length, position, counts.get(index)!) };
  });
};

const squashAdjacentStructuralReplayDuplicates = (steps: PlaybackStep[]): PlaybackStep[] => {
  if (steps.length < 2) return steps;

  const squashed: PlaybackStep[] = [];
  steps.forEach((step) => {
    const previous = squashed[squashed.length - 1];
    const sameVisualFrame =
      previous &&
      Number.isInteger(previous.visualFrameIndex) &&
      Number.isInteger(step.visualFrameIndex) &&
      previous.visualFrameIndex === step.visualFrameIndex;
    const sameOperation =
      previous &&
      String(previous.operation || '').trim() === String(step.operation || '').trim();
    const sameTarget =
      previous &&
      String(previous.targetNodeId || '').trim() &&
      String(previous.targetNodeId || '').trim() === String(step.targetNodeId || '').trim();
    const structuralOnly =
      !stepRepresentsMovement(previous) &&
      !stepRepresentsMovement(step) &&
      !previous?.preserveReplayStep &&
      !step.preserveReplayStep &&
      previous?.sourceKind !== 'derivation-effect' &&
      step.sourceKind !== 'derivation-effect';

    if (sameVisualFrame && sameOperation && sameTarget && structuralOnly && previous) {
      squashed[squashed.length - 1] = {
        ...previous,
        stepId: step.stepId || previous.stepId,
        recipe: pickPreferredReplayText(previous.recipe, step.recipe) || previous.recipe || step.recipe,
        note: pickPreferredReplayText(previous.note, step.note) || previous.note || step.note,
        workspaceAfter:
          (Array.isArray(step.workspaceAfter) && step.workspaceAfter.length > 0)
            ? step.workspaceAfter
            : previous.workspaceAfter,
        sourceNodeIds:
          (Array.isArray(previous.sourceNodeIds) ? previous.sourceNodeIds : []).length > 0
            ? previous.sourceNodeIds
            : step.sourceNodeIds,
        sourceLabels:
          (Array.isArray(previous.sourceLabels) ? previous.sourceLabels : []).length > 0
            ? previous.sourceLabels
            : step.sourceLabels,
        detailBlocks:
          (Array.isArray(step.detailBlocks) && step.detailBlocks.length > 0)
            ? step.detailBlocks
            : previous.detailBlocks,
      };
      return;
    }

    squashed.push(step);
  });

  return squashed;
};

const buildReplayVisualStateSignature = (step?: PlaybackStep | null): string => {
  if (!step) return '';
  const visibleNodeIds = Array.isArray(step.replayVisibleNodeIds)
    ? step.replayVisibleNodeIds.map((id) => String(id || '').trim()).filter(Boolean).sort()
    : [];
  const relationLinks = (Array.isArray(step.replayRelationLinks) ? step.replayRelationLinks : [])
    .map((link) => ({
      relationIndex: String(link?.relationIndex || '').trim(),
      relation: String(link?.relation || link?.operation || '').trim(),
      sourceNodeId: String(link?.sourceNodeId || '').trim(),
      targetNodeId: String(link?.targetNodeId || '').trim(),
      witnessNodeId: String(link?.witnessNodeId || '').trim(),
      renderFamily: link?.renderFamily || undefined,
      trajectoryKind: normalizeTrajectoryKind(link?.trajectoryKind) || undefined,
      stepIndex: Number.isInteger(link?.stepIndex) ? Number(link.stepIndex) : null,
      operation: String(link?.operation || '').trim(),
      chainId: String(link?.chainId || '').trim()
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

  return JSON.stringify({
    canvasData: step.replayCanvasData || null,
    visibleNodeIds,
    relationLinks
  });
};

const collapseZeroDeltaReplaySteps = (steps: PlaybackStep[]): PlaybackStep[] => {
  if (steps.length < 2) return steps;

  const collapsed: PlaybackStep[] = [];
  steps.forEach((step) => {
    const previous = collapsed[collapsed.length - 1];
    const sameVisualState =
      previous &&
      previous.sourceKind !== 'derivation-effect' &&
      step.sourceKind !== 'derivation-effect' &&
      !previous.preserveReplayStep &&
      !step.preserveReplayStep &&
      String(previous.operation || '').trim() !== 'LexicalSelect' &&
      String(step.operation || '').trim() !== 'LexicalSelect' &&
      buildReplayVisualStateSignature(previous) === buildReplayVisualStateSignature(step);

    if (!sameVisualState || !previous) {
      collapsed.push(step);
      return;
    }

    collapsed[collapsed.length - 1] = {
      ...previous,
      recipe: pickPreferredReplayText(previous.recipe, step.recipe) || previous.recipe || step.recipe,
      note: pickPreferredReplayText(previous.note, step.note) || previous.note || step.note,
      workspaceAfter:
        (Array.isArray(step.workspaceAfter) && step.workspaceAfter.length > 0)
          ? step.workspaceAfter
          : previous.workspaceAfter,
      detailBlocks: mergeReplayDetailBlocks(previous.detailBlocks, step.detailBlocks)
    };
  });

  return collapsed;
};

export const insertPreMovementLandingMergeSteps = (steps: PlaybackStep[]): PlaybackStep[] => {
  if (steps.length < 2) return steps;

  const expanded: PlaybackStep[] = [];
  steps.forEach((step) => {
    const previous = expanded[expanded.length - 1];
    const relationLinks = Array.isArray(step.replayRelationLinks) ? step.replayRelationLinks : [];
    const landingRelation = relationLinks.find((link) => {
      const operation = String(link?.operation || link?.relation || step.operation || '').trim();
      if (!isMoveLikeOperation(operation) || isFrontingLikeOperationLabel(operation)) return false;
      const targetNodeId = String(link?.targetNodeId || '').trim();
      if (!targetNodeId || !previous?.replayCanvasData) return false;
      const previousVisibleIds = getReplayVisibleNodeIdSet(previous);
      if (!previousVisibleIds.has(targetNodeId)) return false;
      const parentNodeId = findParentNodeIdInForest([previous.replayCanvasData], targetNodeId);
      if (!parentNodeId || previousVisibleIds.has(parentNodeId)) return false;
      const currentVisibleIds = getReplayVisibleNodeIdSet(step);
      return currentVisibleIds.has(parentNodeId);
    });

    if (previous && landingRelation && previous.replayCanvasData) {
      const targetNodeId = String(landingRelation.targetNodeId || '').trim();
      const parentNodeId = findParentNodeIdInForest([previous.replayCanvasData], targetNodeId);
      const parentNode = parentNodeId
        ? findNodeByIdInForest([previous.replayCanvasData], parentNodeId)
        : null;
      const targetNode = targetNodeId
        ? findNodeByIdInForest([previous.replayCanvasData], targetNodeId)
        : null;
      const parentLabel = String(parentNode?.label || '').trim() || 'Workspace';
      const targetLabel = String(targetNode?.label || '').trim() || String(previous.targetLabel || '').trim() || 'XP';
      const visibleNodeIds = getReplayVisibleNodeIdSet(previous);
      visibleNodeIds.add(parentNodeId);
      /*
       * A generated pre-movement landing merge is a STRUCTURAL state: it
       * must never inherit relation identity from the step it was cloned
       * from, or it would count as a second played relation moment and
       * reveal/focus a relation twice.
       */
      expanded.push({
        ...previous,
        operation: 'ExternalMerge' as DerivationOperation,
        replayKind: 'micro',
        replayRelationIdentity: undefined,
        targetNodeId: parentNodeId,
        targetLabel: parentLabel,
        sourceNodeIds: [targetNodeId].filter(Boolean),
        sourceLabels: [targetLabel].filter(Boolean),
        recipe: buildStructuralReplayFallback('ExternalMerge', parentLabel, [targetLabel]),
        workspaceAfter: [parentLabel],
        replayVisibleNodeIds: Array.from(visibleNodeIds),
        replayRelationLinks: previous.replayRelationLinks,
        preserveReplayStep: true
      });
    }

    expanded.push(step);
  });

  return expanded;
};

const buildVisibleReplayStateSignature = (step?: PlaybackStep | null): string => {
  if (!step?.replayCanvasData || !Array.isArray(step.replayVisibleNodeIds)) return '';
  const visibleIds = new Set(
    step.replayVisibleNodeIds
      .map((nodeId) => String(nodeId || '').trim())
      .filter(Boolean)
  );
  const serializeNode = (node?: SyntaxNode | null): any => {
    if (!node || typeof node !== 'object') return null;
    const nodeId = String(node.id || '').trim();
    const children = (Array.isArray(node.children) ? node.children : [])
      .map(serializeNode)
      .filter(Boolean);
    if (nodeId && !visibleIds.has(nodeId)) {
      return children.length > 0 ? { id: '__hidden_parent__', children } : null;
    }
    return {
      id: nodeId,
      label: String(node.label || '').trim(),
      word: String(node.word || '').trim(),
      children
    };
  };
  const relationLinks = (Array.isArray(step.replayRelationLinks) ? step.replayRelationLinks : [])
    .map((link) => ({
      relationIndex: String(link?.relationIndex || '').trim(),
      relation: String(link?.relation || link?.operation || '').trim(),
      sourceNodeId: String(link?.sourceNodeId || '').trim(),
      targetNodeId: String(link?.targetNodeId || '').trim(),
      witnessNodeId: String(link?.witnessNodeId || '').trim(),
      stepIndex: Number.isInteger(link?.stepIndex) ? Number(link.stepIndex) : null
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify({
    tree: serializeNode(step.replayCanvasData),
    relationLinks
  });
};

const collectVisibleReplayOvertTokenCounts = (step?: PlaybackStep | null): Map<string, number> => {
  const counts = new Map<string, number>();
  if (!step?.replayCanvasData || !Array.isArray(step.replayVisibleNodeIds)) return counts;
  const visibleIds = new Set(
    step.replayVisibleNodeIds
      .map((nodeId) => String(nodeId || '').trim())
      .filter(Boolean)
  );
  const countedLeafIds = new Set<string>();
  const nodesByName = new Map<string, SyntaxNode>();
  const index = (node: SyntaxNode) => {
    for (const name of [node.id, ...(Array.isArray(node.aliasIds) ? node.aliasIds : [])]) {
      const key = String(name || '').trim();
      if (!nodesByName.has(key)) nodesByName.set(key, node);
    }
    (Array.isArray(node.children) ? node.children : []).forEach(index);
  };
  index(step.replayCanvasData);
  const countedSubtrees = new Set<SyntaxNode>();
  const countLeaves = (node: SyntaxNode): boolean => {
    if (countedSubtrees.has(node)) return true;
    const children = Array.isArray(node.children) ? node.children : [];
    let complete: boolean;
    if (children.length) {
      // Visit every child even when an earlier child contains an unnamed leaf.
      complete = true;
      for (const child of children) {
        if (!countLeaves(child)) complete = false;
      }
    } else {
      const leafId = String(node.id || '').trim();
      complete = Boolean(leafId);
      if ((!leafId || visibleIds.has(leafId)) && (!leafId || !countedLeafIds.has(leafId))) {
        if (leafId) countedLeafIds.add(leafId);
        const key = isLexicalLeaf(node) ? normalizeToken(authoredWord(node)) : '';
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    // Named leaves are counted once. Preserve the existing multiplicity of
    // unnamed leaves when several visible ancestors expose the same subtree.
    if (complete) countedSubtrees.add(node);
    return complete;
  };
  step.replayVisibleNodeIds.forEach((nodeIdValue) => {
    const nodeId = String(nodeIdValue || '').trim();
    if (!nodeId) return;
    const node = nodesByName.get(nodeId);
    if (node) countLeaves(node);
  });
  return counts;
};

const stepDropsVisibleOvertMaterial = (
  previousStep: PlaybackStep | undefined,
  step: PlaybackStep
): boolean => {
  if (!previousStep) return false;
  const operation = String(step.operation || '').trim();
  if (
    !operation
    || operation === 'StageRecord'
  ) {
    return false;
  }
  const previousCounts = collectVisibleReplayOvertTokenCounts(previousStep);
  if (previousCounts.size === 0) return false;
  const currentCounts = collectVisibleReplayOvertTokenCounts(step);
  for (const [token, previousCount] of previousCounts) {
    if ((currentCounts.get(token) || 0) < previousCount) return true;
  }
  return false;
};

const stepIntroducesVisibleOvertMaterial = (
  previousStep: PlaybackStep | undefined,
  step: PlaybackStep
): boolean => {
  const currentCounts = collectVisibleReplayOvertTokenCounts(step);
  if (currentCounts.size === 0) return false;
  const previousCounts = collectVisibleReplayOvertTokenCounts(previousStep);
  for (const [token, currentCount] of currentCounts) {
    if (currentCount > (previousCounts.get(token) || 0)) return true;
  }
  return false;
};

const stepCanIntroduceVisibleOvertMaterial = (
  previousStep: PlaybackStep | undefined,
  step: PlaybackStep
): boolean => {
  const operation = String(step.operation || '').trim();
  if (operation !== 'LexicalSelect') return false;
  const target = String(step.targetLabel || step.recipe || '').trim();
  if (
    !target
    || isTraceLike(target)
    || isNullLike(target)
    || isStructuralCategorySurface(target)
  ) {
    return false;
  }
  const targetKey = normalizeToken(target);
  if (!targetKey) return false;
  const previousCounts = collectVisibleReplayOvertTokenCounts(previousStep);
  const currentCounts = collectVisibleReplayOvertTokenCounts(step);
  let introducedTarget = false;
  for (const [token, currentCount] of currentCounts) {
    const previousCount = previousCounts.get(token) || 0;
    if (currentCount <= previousCount) continue;
    if (token !== targetKey) return false;
    if (currentCount - previousCount > 1) return false;
    introducedTarget = true;
  }
  if (!introducedTarget) return false;
  return true;
};

const stepIsRedundantOvertLexicalSelect = (
  previousStep: PlaybackStep | undefined,
  step: PlaybackStep
): boolean => {
  if (!previousStep || String(step.operation || '').trim() !== 'LexicalSelect') return false;
  const targetNodeId = String(step.targetNodeId || '').trim();
  if (!targetNodeId) return false;
  return getReplayVisibleNodeIdSet(previousStep).has(targetNodeId);
};

const getReplayVisibleNodeIdSet = (step?: PlaybackStep | null): Set<string> => new Set(
  (Array.isArray(step?.replayVisibleNodeIds) ? step.replayVisibleNodeIds : [])
    .map((nodeId) => String(nodeId || '').trim())
    .filter(Boolean)
);

const getSyntaxNodeSurface = (node?: SyntaxNode | null): string => {
  if (!node) return '';
  return String(node.word || node.label || '').trim();
};

const findCollapsedNullSelectionInProjectStep = (
  previousStep: PlaybackStep | undefined,
  step: PlaybackStep
): { leafId: string; leafSurface: string } | null => {
  if (String(step.operation || '').trim() !== 'Project') return null;
  if (!step.replayCanvasData) return null;
  const previousVisibleIds = getReplayVisibleNodeIdSet(previousStep);
  const currentVisibleIds = getReplayVisibleNodeIdSet(step);
  const newlyVisibleIds = Array.from(currentVisibleIds).filter((nodeId) => !previousVisibleIds.has(nodeId));
  if (newlyVisibleIds.length < 2) return null;

  const nullLeafIds = newlyVisibleIds.filter((nodeId) => {
    const node = findNodeByIdInForest([step.replayCanvasData as SyntaxNode], nodeId);
    return isNotationLeaf(node);
  });
  if (nullLeafIds.length !== 1) return null;

  const leafId = nullLeafIds[0];
  const leafParentId = findParentNodeIdInForest([step.replayCanvasData as SyntaxNode], leafId);
  const targetNodeId = replayOwnerId(step.replayCanvasData, String(step.targetNodeId || '').trim());
  const leafIsInsideProjectTarget =
    Boolean(leafParentId && newlyVisibleIds.includes(leafParentId))
    || Boolean(targetNodeId && leafParentId === targetNodeId);
  if (!leafIsInsideProjectTarget) return null;

  const leafNode = findNodeByIdInForest([step.replayCanvasData as SyntaxNode], leafId);
  const leafSurface = getSyntaxNodeSurface(leafNode) || EXPLICIT_NULL_TERMINAL;
  return { leafId, leafSurface };
};

const splitCollapsedNullSelectionProjectSteps = (steps: PlaybackStep[]): PlaybackStep[] => {
  if (steps.length < 2) return steps;

  const expanded: PlaybackStep[] = [];
  steps.forEach((step) => {
    const previous = expanded[expanded.length - 1];
    const collapsedNullSelection = findCollapsedNullSelectionInProjectStep(previous, step);
    if (!collapsedNullSelection) {
      expanded.push(step);
      return;
    }

    const previousVisibleIds = getReplayVisibleNodeIdSet(previous);
    previousVisibleIds.add(collapsedNullSelection.leafId);
    expanded.push({
      ...step,
      operation: 'LexicalSelect' as DerivationOperation,
      targetNodeId: collapsedNullSelection.leafId,
      targetLabel: collapsedNullSelection.leafSurface,
      sourceNodeIds: [collapsedNullSelection.leafId],
      sourceLabels: [collapsedNullSelection.leafSurface],
      recipe: buildStructuralReplayFallback(
        'LexicalSelect',
        collapsedNullSelection.leafSurface,
        [collapsedNullSelection.leafSurface]
      ),
      workspaceAfter: [collapsedNullSelection.leafSurface],
      replayVisibleNodeIds: Array.from(previousVisibleIds)
    });
    expanded.push(step);
  });

  return expanded;
};

/**
 * Exactly a genuine authored relation playback moment: relation kind AND the
 * exact authored `{stageIndex, relationIndex}` identity. A generic
 * `preserveReplayStep` flag is NOT proof — synthetic preserved structural
 * states (pre-movement landing merges, detached placements) carry that flag
 * and must not bypass overt-material guards.
 */
export const isAuthoredRelationReplayMoment = (step: PlaybackStep): boolean =>
  step.replayKind === 'relation'
  && Number.isInteger(step.replayRelationIdentity?.stageIndex)
  && Number.isInteger(step.replayRelationIdentity?.relationIndex);

export const removeInvalidReplayVisibilityTransitions = (steps: PlaybackStep[]): PlaybackStep[] => {
  const kept: PlaybackStep[] = [];
  steps.forEach((step) => {
    const previous = kept[kept.length - 1];
    const operation = String(step.operation || '').trim();
    const isPlannedStructuralMicrostep =
      Boolean(String(step.replayProgressLabel || '').trim())
      && step.replayKind !== 'macro'
      && ['LexicalSelect', 'Project', 'ExternalMerge'].includes(operation);
    if (stepIsRedundantOvertLexicalSelect(previous, step)) {
      return;
    }
    const addsOvert = stepIntroducesVisibleOvertMaterial(previous, step);
    if (
      addsOvert
      && operation !== 'StageRecord'
      && !isMoveLikeOperation(operation)
      && !isPlannedStructuralMicrostep
      // An AUTHORED RELATION MOMENT draws marks, not material: its snapshot
      // reflects the frame's own structural state, which can legitimately
      // differ from a mid-assembly neighbor. Only the exact identity-proven
      // moment is exempt — a generic preserved flag alone never authorizes
      // an otherwise-invalid overt-material jump.
      && !isAuthoredRelationReplayMoment(step)
      && !stepCanIntroduceVisibleOvertMaterial(previous, step)
    ) {
      return;
    }
    const dropsOvert = stepDropsVisibleOvertMaterial(previous, step);
    if (dropsOvert && !step.preserveReplayStep && !isPlannedStructuralMicrostep) {
      return;
    }
    const sameVisibleState =
      previous &&
      !previous.preserveReplayStep &&
      !step.preserveReplayStep &&
      String(previous.operation || '').trim() !== 'StageRecord' &&
      String(step.operation || '').trim() !== 'StageRecord' &&
      buildVisibleReplayStateSignature(previous) === buildVisibleReplayStateSignature(step);
    if (sameVisibleState) return;
    kept.push(step);
  });
  return kept;
};

const collectReplayCanvasNodes = (root?: SyntaxNode | null): SyntaxNode[] => {
  if (!root || typeof root !== 'object') return [];
  const nodes: SyntaxNode[] = [];
  const visit = (node: SyntaxNode) => {
    nodes.push(node);
    const children = Array.isArray(node?.children) ? node.children : [];
    children.forEach(visit);
  };
  visit(root);
  return nodes;
};

const carryReplayRelationLinksForward = (steps: PlaybackStep[]): PlaybackStep[] => {
  if (steps.length < 2) return steps;

  const activeRelationLinks: ResolvedRelationLink[] = [];
  const activeRelationKeys = new Set<string>();
  const normalizedSteps = steps.map((step) => {
    const canvas = step.replayCanvasData;
    const currentRelationLinks = Array.isArray(step.replayRelationLinks) ? step.replayRelationLinks : [];
    currentRelationLinks.forEach((link) => {
      const key = resolvedRelationLinkKey(link);
      if (!key || activeRelationKeys.has(key)) return;
      activeRelationKeys.add(key);
      activeRelationLinks.push(link);
    });
    if (!canvas) return step;

    // Carried links keep their authored endpoint ids. An endpoint absent from
    // this canvas is simply not drawn here; no lineage mate or id-spelling
    // heuristic stands in for it.
    const linksForStep = activeRelationLinks.filter((link) => {
      const sourceNodeId = String(link?.sourceNodeId || '').trim();
      const targetNodeId = String(link?.targetNodeId || '').trim();
      if (isResolvedMovementLink(link) && (sourceNodeId || targetNodeId)) {
        return Boolean(
          sourceNodeId
          && targetNodeId
          && findNodeByIdInForest([canvas], sourceNodeId)
          && findNodeByIdInForest([canvas], targetNodeId)
        );
      }
      const anchorNodeIds = (Array.isArray(link?.anchors) ? link.anchors : [])
        .map((anchor) => String(anchor?.nodeId || '').trim())
        .filter(Boolean);
      return anchorNodeIds.length > 0 && anchorNodeIds.every((nodeId) => (
        Boolean(findNodeByIdInForest([canvas], nodeId))
      ));
    });
    if (linksForStep.length === 0) return step;

    const mergedRelationLinks: ResolvedRelationLink[] = [];
    const mergedRelationKeys = new Set<string>();
    linksForStep.forEach((link) => {
      const key = resolvedRelationLinkKey(link);
      if (!key || mergedRelationKeys.has(key)) return;
      mergedRelationKeys.add(key);
      mergedRelationLinks.push(link);
    });

    const visibleNodeIds = getReplayVisibleNodeIdSet(step);
    const suppressedNodeIds = new Set(step.replaySuppressAutoRevealNodeIds || []);
    mergedRelationLinks.forEach((link) => {
      const automaticallyVisibleAnchorNodeIds = (Array.isArray(link?.anchors)
        ? link.anchors
            .map((anchor) => String(anchor?.nodeId || '').trim())
        : []);
      [
        String(link?.sourceNodeId || '').trim(),
        String(link?.targetNodeId || '').trim(),
        String(link?.witnessNodeId || '').trim(),
        ...automaticallyVisibleAnchorNodeIds
      ].forEach((nodeId) => {
        const node = findExactNodeByIdInForest([canvas], nodeId);
        if (!nodeId || !node || (node as any).replayLayoutOnly || suppressedNodeIds.has(nodeId)) return;
        visibleNodeIds.add(nodeId);
      });
    });

    return {
      ...step,
      replayVisibleNodeIds: Array.from(visibleNodeIds),
      replayRelationLinks: mergedRelationLinks
    };
  });

  return normalizedSteps;
};

const SENTENCE_INITIAL_CASE_ADJUSTABLE_PARENT_LABELS = new Set([
  'A', 'ADV', 'AUX', 'C', 'COORD', 'D', 'DEG', 'DET', 'INFL', 'MOD', 'NEG', 'P', 'Q', 'T', 'V'
]);

const isSentenceInitialCaseAdjustableParent = (label?: string): boolean =>
  SENTENCE_INITIAL_CASE_ADJUSTABLE_PARENT_LABELS.has(
    normalizeStructuralLabel(String(label || '')).toUpperCase()
  );

const normalizeReplaySentenceInitialCasing = (
  steps: PlaybackStep[],
  sentenceInitialSurface: string
): PlaybackStep[] => {
  const initialKey = normalizeToken(sentenceInitialSurface);
  if (!initialKey) return steps;

  const uppercaseInitial = sentenceInitialSurface.charAt(0).toUpperCase() + sentenceInitialSurface.slice(1);
  const lowercaseInitial = sentenceInitialSurface.charAt(0).toLowerCase() + sentenceInitialSurface.slice(1);
  if (uppercaseInitial === lowercaseInitial) return steps;

  return steps.map((step) => {
    if (!step.replayCanvasData) return step;
    const clonedCanvas = cloneSyntaxTree(step.replayCanvasData);
    if (!clonedCanvas) return step;
    if (clonedCanvas.replayOrigin?.kind === 'workspace') return step;

    let changed = false;
    // Keep first-preorder lookup semantics, including aliases, while collecting
    // parent and inherited flags once instead of searching a path for every leaf.
    const exactNodes = new Map<string, { parent: SyntaxNode | null; silent: boolean; layout: boolean }>();
    const nodesByName = new Map<string, SyntaxNode>();
    const leafIds: string[] = [];
    const visit = (node: SyntaxNode, parent: SyntaxNode | null, silent: boolean, layout: boolean) => {
      silent ||= node.silent === true;
      layout ||= node.replayOrigin?.kind === 'layout';
      const id = String(node.id || '').trim();
      if (!exactNodes.has(id)) exactNodes.set(id, { parent, silent, layout });
      for (const name of [id, ...(Array.isArray(node.aliasIds) ? node.aliasIds : [])]) {
        const key = String(name || '').trim();
        if (!nodesByName.has(key)) nodesByName.set(key, node);
      }
      const children = Array.isArray(node.children) ? node.children : [];
      if (!children.length && id && isLexicalLeaf(node)) leafIds.push(id);
      children.forEach(child => visit(child, node, silent, layout));
    };
    visit(clonedCanvas, null, false, false);
    const currentLeaves = leafIds.map(leafId => {
        const info = exactNodes.get(leafId)!;
        const leaf = nodesByName.get(leafId);
        return !info.layout && leaf ? { leaf, silent: info.silent } : null;
      })
      .filter((entry): entry is { leaf: SyntaxNode; silent: boolean } => Boolean(entry));
    const firstPronouncedLeafId = String(
      currentLeaves.find((entry) => !entry.silent)?.leaf.id || ''
    ).trim();
    const casingByLeafId = new Map<string, string>();

    currentLeaves.forEach(({ leaf }) => {
      const surface = String(leaf.word || leaf.label || '').trim();
      if (normalizeToken(surface) !== initialKey) return;
      const leafId = String(leaf.id || '').trim();
      const parent = exactNodes.get(leafId)?.parent;
      if (!isSentenceInitialCaseAdjustableParent(parent?.label || leaf.label)) return;
      const nextSurface = leafId && leafId === firstPronouncedLeafId ? uppercaseInitial : lowercaseInitial;
      casingByLeafId.set(leafId, nextSurface);
      if (leaf.word && leaf.word !== nextSurface) {
        leaf.word = nextSurface;
        changed = true;
      }
      if (leaf.label && leaf.label !== nextSurface) {
        leaf.label = nextSurface;
        changed = true;
      }
    });

    const casingForNodeId = (nodeId?: string): string => {
      const normalizedNodeId = String(nodeId || '').trim();
      if (!normalizedNodeId) return '';
      const exact = casingByLeafId.get(normalizedNodeId);
      if (exact) return exact;
      const node = nodesByName.get(replayOwnerId(clonedCanvas, normalizedNodeId));
      if (!node) return '';
      const matchingLeafId = collectOvertLeafNodeIdsInOrder(node).find((leafId) => casingByLeafId.has(leafId));
      return matchingLeafId ? String(casingByLeafId.get(matchingLeafId) || '') : '';
    };
    const rawTargetLabel = String(step.targetLabel || '').trim();
    const targetCase = normalizeToken(rawTargetLabel) === initialKey
      ? casingForNodeId(step.targetNodeId)
      : '';
    const nextTargetLabel = targetCase || step.targetLabel;
    const nextSourceLabels = Array.isArray(step.sourceLabels)
      ? step.sourceLabels.map((label, index) => {
          if (normalizeToken(String(label || '').trim()) !== initialKey) return label;
          return casingForNodeId(step.sourceNodeIds?.[index])
            || (index === 0 ? targetCase : '')
            || label;
        })
      : step.sourceLabels;
    const labelsChanged =
      nextTargetLabel !== step.targetLabel
      || JSON.stringify(nextSourceLabels || []) !== JSON.stringify(step.sourceLabels || []);
    const nextRecipe = labelsChanged
      ? buildStructuralReplayFallback(step.operation, nextTargetLabel, nextSourceLabels || [])
      : step.recipe;

    return changed || labelsChanged
      ? {
          ...step,
          targetLabel: nextTargetLabel,
          sourceLabels: nextSourceLabels,
          replayCanvasData: changed ? clonedCanvas : step.replayCanvasData,
          recipe: nextRecipe
        }
      : step;
  });
};

const stabilizeStructuralReplayVisibility = (steps: PlaybackStep[]): PlaybackStep[] => {
  if (steps.length === 0) return steps;

  const persistentProjectedNodeIds = new Set<string>();
  const persistentVisibleNodeIds = new Set<string>();
  const persistentVisibleSubtreeSignatures = new Set<string>();
  return steps.map((step) => {
    const canvas = step.replayCanvasData;
    const rawVisibleIds = Array.isArray(step.replayVisibleNodeIds)
      ? step.replayVisibleNodeIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    const suppressedAutoRevealNodeIds = new Set(
      (Array.isArray(step.replaySuppressAutoRevealNodeIds) ? step.replaySuppressAutoRevealNodeIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    );
    if (!canvas) {
      if (step.operation === 'Project' && String(step.targetNodeId || '').trim()) {
        persistentProjectedNodeIds.add(String(step.targetNodeId || '').trim());
      }
      return step;
    }

    const exactNodesById = collectExactNodesByIdInForest([canvas]);
    const nextVisibleIds = new Set(
      rawVisibleIds.filter((visibleNodeId) => !suppressedAutoRevealNodeIds.has(visibleNodeId))
    );
    persistentVisibleNodeIds.forEach((visibleNodeId) => {
      if (suppressedAutoRevealNodeIds.has(visibleNodeId)) return;
      const exactNode = exactNodesById.get(visibleNodeId)?.[0];
      if (!exactNode || (exactNode as any).replayLayoutOnly === true) return;
      nextVisibleIds.add(visibleNodeId);
    });
    const preserveProjectedNode = (nodeId: string) => {
      const node = exactNodesById.get(nodeId)?.[0];
      if (!node || (node as any).replayLayoutOnly === true) return;
      if (suppressedAutoRevealNodeIds.has(nodeId)) return;
      nextVisibleIds.add(nodeId);
    };

    persistentProjectedNodeIds.forEach(preserveProjectedNode);
    if (persistentVisibleSubtreeSignatures.size > 0) {
      const signatureBuckets = new Map<string, SyntaxNode[]>();
      collectReplayCanvasNodes(canvas).forEach((node) => {
        const signature = getReplayContinuitySubtreeSignature(node);
        if (!signature || !persistentVisibleSubtreeSignatures.has(signature)) return;
        const entries = signatureBuckets.get(signature) || [];
        entries.push(node);
        signatureBuckets.set(signature, entries);
      });
      signatureBuckets.forEach((nodes) => {
        if (nodes.length !== 1) return;
        collectSubtreeNodeIds(nodes[0]).forEach((visibleNodeId) => {
          if (suppressedAutoRevealNodeIds.has(visibleNodeId)) return;
          nextVisibleIds.add(visibleNodeId);
        });
      });
    }
    if (step.operation === 'Project' && String(step.targetNodeId || '').trim()) {
      const targetNodeId = String(step.targetNodeId || '').trim();
      preserveProjectedNode(targetNodeId);
      persistentProjectedNodeIds.add(targetNodeId);
    }

    nextVisibleIds.forEach((visibleNodeId) => persistentVisibleNodeIds.add(visibleNodeId));
    collectReplayCanvasNodes(canvas).forEach((node) => {
      const nodeId = String(node?.id || '').trim();
      if (!nodeId || !nextVisibleIds.has(nodeId)) return;
      const completeSubtreeIsVisible = collectSubtreeNodeIds(node).every((subtreeNodeId) => {
        const subtreeNode = exactNodesById.get(subtreeNodeId)?.[0];
        return (subtreeNode as any)?.replayLayoutOnly === true
          || nextVisibleIds.has(subtreeNodeId);
      });
      if (!completeSubtreeIsVisible) return;
      const signature = getReplayContinuitySubtreeSignature(node);
      if (signature) persistentVisibleSubtreeSignatures.add(signature);
    });
    return {
      ...step,
      replayVisibleNodeIds: Array.from(nextVisibleIds)
    };
  });
};

const collectForestNodesById = (forest: SyntaxNode[]): Map<string, SyntaxNode> => {
  const out = new Map<string, SyntaxNode>();
  const visit = (node: SyntaxNode) => {
    const id = String(node?.id || '').trim();
    if (id) out.set(id, node);
    const children = Array.isArray(node?.children) ? node.children : [];
    children.forEach(visit);
  };
  forest.forEach(visit);
  return out;
};

const collectSubtreeNodeIds = (node?: SyntaxNode | null): string[] => {
  if (!node || typeof node !== 'object') return [];
  const ids: string[] = [];
  const visit = (current: SyntaxNode) => {
    if ((current as any)?.replayLayoutOnly) return;
    const nodeId = String(current?.id || '').trim();
    if (nodeId) ids.push(nodeId);
    const children = Array.isArray(current?.children) ? current.children : [];
    children.forEach(visit);
  };
  visit(node);
  return ids;
};

const collectLeafSyntaxNodes = (root?: SyntaxNode | null): SyntaxNode[] => {
  if (!root || typeof root !== 'object') return [];
  const leaves: SyntaxNode[] = [];
  const visit = (node: SyntaxNode) => {
    const children = Array.isArray(node?.children) ? node.children : [];
    if (children.length === 0) {
      leaves.push(node);
      return;
    }
    children.forEach(visit);
  };
  visit(root);
  return leaves;
};

const countOvertLeafSyntaxNodes = (root?: SyntaxNode | null): number =>
  collectLeafSyntaxNodes(root).filter((leaf) => isLexicalLeaf(leaf)).length;

const collectReplayOvertTokenMultisetKey = (forest: SyntaxNode[] = []): string => {
  const tokens = forest
    .flatMap((root) => collectLeafSyntaxNodes(root))
    .filter((leaf) => isLexicalLeaf(leaf))
    .map((leaf) => normalizeToken(authoredWord(leaf)))
    .filter(Boolean)
    .sort();
  return tokens.join('|');
};

const collectReplayOvertTokenSequence = (root?: SyntaxNode | null): string[] =>
  collectLeafSyntaxNodes(root)
    .filter((leaf) => (leaf as any)?.replayLayoutOnly !== true && isLexicalLeaf(leaf))
    .map((leaf) => normalizeToken(authoredWord(leaf)))
    .filter(Boolean);

const collectReplayRootStructuralKey = (forest: SyntaxNode[] = []): string =>
  forest
    .map((root) => {
      const label = String(root?.label || '').trim().toUpperCase();
      const tokens = collectReplayOvertTokenSequence(root).join(' ');
      return label && tokens ? `${label}|${tokens}` : '';
    })
    .filter(Boolean)
    .join('||');

const getReplayContinuitySubtreeSignature = (root?: SyntaxNode | null): string => {
  if (!root || typeof root !== 'object') return '';
  const label = String(root.label || '').trim().toUpperCase();
  const tokens = collectReplayOvertTokenSequence(root);
  if (!label || tokens.length < 2) return '';
  return `${label}|${tokens.join(' ')}`;
};

const collectUniqueReplayContinuitySubtrees = (forest: SyntaxNode[] = []): Map<string, SyntaxNode> => {
  const candidates = new Map<string, SyntaxNode[]>();
  const visit = (node: SyntaxNode) => {
    const signature = getReplayContinuitySubtreeSignature(node);
    if (signature) {
      const entries = candidates.get(signature) || [];
      entries.push(node);
      candidates.set(signature, entries);
    }
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach(visit);
  };
  forest.forEach(visit);
  const unique = new Map<string, SyntaxNode>();
  candidates.forEach((nodes, signature) => {
    if (nodes.length === 1) unique.set(signature, nodes[0]);
  });
  return unique;
};

const hasBranchingSyntaxSubtree = (root?: SyntaxNode | null): boolean => {
  if (!root || typeof root !== 'object') return false;
  let branching = false;
  const visit = (node: SyntaxNode) => {
    if (branching) return;
    const children = Array.isArray(node?.children) ? node.children : [];
    if (children.length > 1) {
      branching = true;
      return;
    }
    children.forEach(visit);
  };
  visit(root);
  return branching;
};


const pickOvertLeafNode = (root?: SyntaxNode | null): SyntaxNode | null =>
  collectLeafSyntaxNodes(root).find((leaf) => isPronouncedLeaf(leaf)) || null;

export const findParentLabelInForest = (
  forest: SyntaxNode[],
  targetNodeId: string
): string => {
  const normalizedTargetNodeId = String(targetNodeId || '').trim();
  if (!normalizedTargetNodeId) return '';
  let resolvedParentLabel = '';
  const visit = (node: SyntaxNode, parent?: SyntaxNode | null): boolean => {
    if (String(node?.id || '').trim() === normalizedTargetNodeId) {
      resolvedParentLabel = String(parent?.label || '').trim();
      return true;
    }
    const children = Array.isArray(node?.children) ? node.children : [];
    for (const child of children) {
      if (visit(child, node)) return true;
    }
    return false;
  };

  forest.some((root) => visit(root, null));
  return resolvedParentLabel;
};

const findNodePathInForest = (forest: SyntaxNode[], targetNodeId: string): number[] | null => {
  const visit = (node: SyntaxNode, path: number[]): number[] | null => {
    if (String(node.id || '').trim() === targetNodeId) return path;
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

const getNodeAtForestPath = (forest: SyntaxNode[], path: number[] | null): SyntaxNode | null => {
  if (!Array.isArray(path) || path.length === 0) return null;
  let current: SyntaxNode | null = forest[path[0]] || null;
  if (!current) return null;
  for (let index = 1; index < path.length; index += 1) {
    const children = Array.isArray(current.children) ? current.children : [];
    current = children[path[index]] || null;
    if (!current) return null;
  }
  return current;
};

const findNodeByIdInForest = (forest: SyntaxNode[], targetNodeId: string): SyntaxNode | null => {
  const normalizedTargetNodeId = String(targetNodeId || '').trim();
  if (!normalizedTargetNodeId) return null;
  const visit = (node: SyntaxNode): SyntaxNode | null => {
    if (String(node.id || '').trim() === normalizedTargetNodeId) return node;
    if ((Array.isArray(node.aliasIds) ? node.aliasIds : []).some((aliasId) => String(aliasId || '').trim() === normalizedTargetNodeId)) {
      return node;
    }
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };

  for (const root of forest) {
    const found = visit(root);
    if (found) return found;
  }
  return null;
};

const findExactNodeByIdInForest = (forest: SyntaxNode[], targetNodeId: string): SyntaxNode | null => {
  const normalizedTargetNodeId = String(targetNodeId || '').trim();
  if (!normalizedTargetNodeId) return null;
  const visit = (node: SyntaxNode): SyntaxNode | null => {
    if (String(node.id || '').trim() === normalizedTargetNodeId) return node;
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  for (const root of forest) {
    const found = visit(root);
    if (found) return found;
  }
  return null;
};

const findParentNodeIdInForest = (forest: SyntaxNode[], targetNodeId: string): string => {
  const normalizedTargetNodeId = String(targetNodeId || '').trim();
  if (!normalizedTargetNodeId) return '';

  const visit = (node: SyntaxNode, parentId: string): string => {
    if (
      String(node.id || '').trim() === normalizedTargetNodeId
      || (Array.isArray(node.aliasIds) ? node.aliasIds : []).some((aliasId) => String(aliasId || '').trim() === normalizedTargetNodeId)
    ) return parentId;
    const ownId = String(node.id || '').trim();
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      const found = visit(child, ownId || parentId);
      if (found) return found;
    }
    return '';
  };

  for (const root of forest) {
    const found = visit(root, '');
    if (found) return found;
  }
  return '';
};

const resolvedRelationLinkKey = (link?: ResolvedRelationLink | null): string => [
  String(link?.relationIndex || '').trim(),
  String(link?.operation || '').trim(),
  String(link?.sourceNodeId || '').trim(),
  String(link?.targetNodeId || '').trim(),
  String(link?.witnessNodeId || '').trim(),
  String(link?.chainId || '').trim()
].join('|');

const filterResolvedRelationLinks = (
  links: ResolvedRelationLink[] | undefined,
  suppressedLinks: ResolvedRelationLink[] = []
): ResolvedRelationLink[] => {
  const sourceLinks = Array.isArray(links) ? links : [];
  if (!Array.isArray(suppressedLinks) || suppressedLinks.length === 0) return sourceLinks;
  const suppressedKeys = new Set(suppressedLinks.map((link) => resolvedRelationLinkKey(link)));
  const matchesSuppressedLink = (link: ResolvedRelationLink): boolean => {
    if (suppressedKeys.has(resolvedRelationLinkKey(link))) return true;
    return suppressedLinks.some((suppressed) => {
      const sameOperation =
        normalizeReplayTargetLabel(String(link?.operation || '')) === normalizeReplayTargetLabel(String(suppressed?.operation || ''));
      const sameTarget = String(link?.targetNodeId || '').trim()
        && String(link?.targetNodeId || '').trim() === String(suppressed?.targetNodeId || '').trim();
      if (!sameOperation || !sameTarget) return false;
      const sameChain = String(link?.chainId || '').trim()
        && String(link?.chainId || '').trim() === String(suppressed?.chainId || '').trim();
      const linkSources = new Set([
        String(link?.sourceNodeId || '').trim(),
        String(link?.witnessNodeId || '').trim()
      ].filter(Boolean));
      const sourceOverlap = [
        String(suppressed?.sourceNodeId || '').trim(),
        String(suppressed?.witnessNodeId || '').trim()
      ].some((sourceId) => sourceId && linkSources.has(sourceId));
      return sameChain || sourceOverlap;
    });
  };
  return sourceLinks.filter((link) => !matchesSuppressedLink(link));
};

const PRIME_MARK_RE = /[’']/g;
const PRIME_CATEGORY_LABEL_RE = /[’']$/;
const normalizeStructuralLabel = (label?: string): string =>
  String(label || '').trim().replace(PRIME_MARK_RE, '');

const HEAD_LIKE_LABEL_RE = /^(?:C|Q|WH|T|INFL|I|V|D|N|A|P|AUX)$/i;

const isPhraseShellLabel = (label?: string): boolean => {
  const normalized = normalizeStructuralLabel(label);
  if (!normalized) return false;
  return /P$/i.test(normalized);
};

const isHeadShellLabel = (label?: string): boolean => {
  const raw = String(label || '').trim();
  if (!raw || PRIME_CATEGORY_LABEL_RE.test(raw)) return false;
  const normalized = normalizeStructuralLabel(raw);
  if (!normalized) return false;
  return HEAD_LIKE_LABEL_RE.test(normalized);
};

export const isStructuralCategorySurface = (surface?: string): boolean => {
  const normalized = normalizeStructuralLabel(surface);
  if (!normalized) return false;
  return isHeadShellLabel(normalized) || isPhraseShellLabel(normalized);
};

/**
 * A wordless leaf is an abstract category whatever its label spells, unless
 * the label is display notation for an unpronounced position (`t`, `∅`).
 */
export const isWordlessCategoryLeaf = (node: SyntaxNode): boolean =>
  isWordlessLeaf(node) && !isNotationSurface(node.label);

export const normalizeTrajectoryKind = (kind?: ResolvedRelationLink['trajectoryKind'] | string): ResolvedRelationLink['trajectoryKind'] | '' => {
  const normalized = String(kind || '').trim().toLowerCase();
  if (normalized === 'head' || normalized === 'phrasal') return normalized;
  return '';
};

/*
 * Operation-label kind refinement is exact identity metadata, never a text
 * pattern. An unlisted name has no kind and no fronting flavor; structure
 * decides or nothing does.
 */
const isHeadLikeOperationLabel = (operation?: string): boolean =>
  movementIdentityKind(operation) === 'head';

export const isFrontingLikeOperationLabel = (operation?: string): boolean =>
  isFrontingMovementIdentity(operation);

const isPhrasalTrajectoryOperationLabel = (operation?: string): boolean =>
  movementIdentityKind(operation) === 'phrasal';

const isNodeOrImmediateParentHeadShellInForest = (
  forest: SyntaxNode[],
  nodeId?: string
): boolean => {
  const normalizedNodeId = String(nodeId || '').trim();
  if (!normalizedNodeId) return false;
  const nodePath = findNodePathInForest(forest, normalizedNodeId);
  const node = getNodeAtForestPath(forest, nodePath);
  if (node && isPhraseShellLabel(node.label)) return false;
  if (node && isHeadShellLabel(node.label)) return true;
  if (!Array.isArray(nodePath) || nodePath.length < 2) return false;
  const parent = getNodeAtForestPath(forest, nodePath.slice(0, -1));
  return Boolean(parent && isHeadShellLabel(parent.label));
};

const inferHeadLikeTrajectoryKindFromForest = ({
  forest,
  operation,
  sourceNodeId,
  targetNodeId,
  traceNodeId
}: {
  forest: SyntaxNode[];
  operation?: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  traceNodeId?: string;
}): ResolvedRelationLink['trajectoryKind'] => {
  if (isHeadLikeOperationLabel(operation)) return 'head';
  if (isPhrasalTrajectoryOperationLabel(operation)) return 'phrasal';

  const targetLooksHeadLike = isNodeOrImmediateParentHeadShellInForest(forest, targetNodeId);
  const sourceLooksHeadLike =
    isNodeOrImmediateParentHeadShellInForest(forest, sourceNodeId)
    || isNodeOrImmediateParentHeadShellInForest(forest, traceNodeId);

  return targetLooksHeadLike && sourceLooksHeadLike ? 'head' : 'phrasal';
};

const inferHeadLikeTrajectoryKindFromVisibleNodes = (
  nodeById: Map<string, HierNode>,
  link?: ResolvedRelationLink | null
): ResolvedRelationLink['trajectoryKind'] | '' => {
  if (!link) return '';

  const explicitKind = normalizeTrajectoryKind(link.trajectoryKind);
  if (explicitKind) return explicitKind;
  if (isHeadLikeOperationLabel(link.operation)) return 'head';

  const targetId = String(link.targetNodeId || '').trim();
  const sourceId = String(link.sourceNodeId || '').trim();
  const traceId = String(link.witnessNodeId || '').trim();
  const targetNode = targetId ? nodeById.get(targetId) : undefined;
  const sourceNode = sourceId ? nodeById.get(sourceId) : undefined;
  const traceNode = traceId ? nodeById.get(traceId) : undefined;
  const targetLooksHeadLike = Boolean(targetNode && isHeadShellLabel(targetNode.data?.label));
  const sourceLooksHeadLike = Boolean(
    (sourceNode && isHeadShellLabel(sourceNode.data?.label))
    || (traceNode && isHeadShellLabel(traceNode.data?.label))
    || (sourceNode?.parent && isHeadShellLabel(sourceNode.parent.data?.label))
    || (traceNode?.parent && isHeadShellLabel(traceNode.parent.data?.label))
  );
  if (targetLooksHeadLike && sourceLooksHeadLike) return 'head';
  return '';
};

export const isHeadLikeResolvedRelation = (
  link?: ResolvedRelationLink | null,
  nodeById?: Map<string, HierNode>
): boolean => {
  const explicitKind = normalizeTrajectoryKind(link?.trajectoryKind);
  if (explicitKind) return explicitKind === 'head';
  if (nodeById) {
    const inferredKind = inferHeadLikeTrajectoryKindFromVisibleNodes(nodeById, link);
    if (inferredKind) return inferredKind === 'head';
  }
  return isHeadLikeOperationLabel(link?.operation);
};

const inferPlaybackStepTrajectoryKind = (step?: PlaybackStep | null): PlaybackStep['trajectoryKind'] | '' => {
  const explicitKind = normalizeTrajectoryKind(step?.trajectoryKind);
  if (explicitKind) return explicitKind;
  const linkKinds = Array.isArray(step?.replayRelationLinks)
    ? step.replayRelationLinks
        .map((link) => normalizeTrajectoryKind(link?.trajectoryKind))
        .filter((kind): kind is NonNullable<ResolvedRelationLink['trajectoryKind']> => Boolean(kind))
    : [];
  if (linkKinds.includes('head')) return 'head';
  if (linkKinds.includes('phrasal')) return 'phrasal';
  return isHeadLikeOperationLabel(step?.operation) ? 'head' : '';
};

const isHeadLikePlaybackStep = (step?: PlaybackStep | null): boolean =>
  inferPlaybackStepTrajectoryKind(step) === 'head';

const isTraceOrNullLikeNode = (node?: SyntaxNode | null): boolean => isNotationLeaf(node);

const subtreeHasOvertYield = (node?: SyntaxNode | null): boolean =>
  Boolean(pickOvertLeafNode(node));

export const resolveDerivationMovementTransitions = (
  currentForest: SyntaxNode[],
  derivationFrames: ReplayDerivationFrame[] | undefined,
  activeStepIndex: number,
  resolvedRelationLinks?: ResolvedRelationLink[]
): DerivationMovementTransition[] => {
  const frames = Array.isArray(derivationFrames) ? derivationFrames : [];
  if (frames.length === 0) return [];

  const currentNodeIds = new Set(collectForestNodesById(currentForest).keys());
  const lastFrameIndex = Math.min(activeStepIndex, frames.length - 1);
  const transitions: DerivationMovementTransition[] = [];
  const transitionKeys = new Set<string>();

  (Array.isArray(resolvedRelationLinks) ? resolvedRelationLinks : []).forEach((link) => {
    if (!isResolvedMovementLink(link)) return;

    const sourceId = String(link?.sourceNodeId || '').trim();
    const targetId = String(link?.targetNodeId || '').trim();
    if (!sourceId || !targetId || sourceId === targetId) return;

    const step = Number.isInteger(link?.stepIndex) ? Number(link.stepIndex) : 0;
    if (step < 0 || step > lastFrameIndex) return;
    if (!currentNodeIds.has(sourceId) || !currentNodeIds.has(targetId)) return;

    const transitionKey = `${sourceId}->${targetId}@${step}`;
    if (transitionKeys.has(transitionKey)) return;
    transitionKeys.add(transitionKey);

    transitions.push({
      authoredLink: link,
      sourceId,
      targetId,
      traceId: currentNodeIds.has(String(link?.witnessNodeId || '').trim())
        ? String(link.witnessNodeId).trim()
        : null,
      step,
      index: String(link?.relationIndex || '').trim() || `${transitions.length + 1}`,
      chainId: String(link?.chainId || '').trim() || null,
      operation: link?.relation || link?.operation,
      trajectoryKind: normalizeTrajectoryKind(link?.trajectoryKind) || undefined,
      note: link?.note
    });
  });

  return transitions;
};
const resolveNodeLabel = (node: HierNode): string => node.data.label || node.data.word || '';
export const resolveLeafSurface = (node: HierNode): string => (node.data.word || node.data.label || '').trim();
const NULL_LIKE_LABEL = /^(∅|Ø|ε|NULL|EPSILON)$/i;
const EXPLICIT_NULL_TERMINAL = '∅';
const buildSyntheticReplayLeafId = (parent: SyntaxNode, suffix: string, word?: string): string => {
  const parentId = typeof parent?.id === 'string' ? parent.id.trim() : '';
  const parentLabel = String(parent?.label || 'node').trim().replace(/\s+/g, '_') || 'node';
  const leafWord = String(word || '').trim().replace(/\s+/g, '_');
  const stem = parentId || `${parentLabel}__${leafWord || 'leaf'}`;
  return `${stem}::__${suffix}`;
};
const SUBSCRIPT_MAP: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  'ᵢ': 'i', 'ⱼ': 'j', 'ₐ': 'a', 'ₑ': 'e', 'ₒ': 'o', 'ₓ': 'x', 'ₕ': 'h', 'ₖ': 'k', 'ₗ': 'l', 'ₘ': 'm',
  'ₙ': 'n', 'ₚ': 'p', 'ₛ': 's', 'ₜ': 't', 'ᵥ': 'v'
};
const DIGIT_TO_SUBSCRIPT: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉'
};
const INDEX_TO_SUBSCRIPT: Record<string, string> = Object.fromEntries(
  Object.entries(SUBSCRIPT_MAP).map(([subscript, plain]) => [plain, subscript])
);

export const isTraceLike = (label: string): boolean => {
  const text = label.trim();
  if (!text) return false;
  const sourceUnwrapped = text.replace(/^[\s([{<⟨"']+|[\s)\]}>⟩"']+$/g, '');
  const normalized = [...text].map((ch) => SUBSCRIPT_MAP[ch] || ch).join('');
  const unwrapped = normalized.replace(/^[\s([{<⟨"']+|[\s)\]}>⟩"']+$/g, '');
  if (isStructuralCategorySurface(unwrapped) && unwrapped === unwrapped.toUpperCase()) {
    return false;
  }
  return (
    /^t\d*$/.test(unwrapped) ||
    /^t[ᵢⱼₐₑₒₓₕₖₗₘₙₚₛₜᵥ]+$/u.test(sourceUnwrapped) ||
    /^t(?:[_-](?:\{?[A-Za-z0-9]+\}?|\[[A-Za-z0-9]+\]|\([A-Za-z0-9]+\)))+$/.test(unwrapped) ||
    /^trace\b/i.test(unwrapped) ||
    /^copy$/i.test(unwrapped) ||
    /^<[^>]+>$/.test(normalized) ||
    /^⟨[^⟩]+⟩$/.test(normalized)
  );
};

export const normalizeToken = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/^<|>$/g, '')
    .replace(/^⟨|⟩$/g, '')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
};

export const tokenizeReplaySentenceSurface = (sentence: string): string[] =>
  tokenizeSentenceSurfaceOrder(sentence);

export const extractMovementIndex = (label: string): string | null => {
  const text = [...label.trim()].map((ch) => SUBSCRIPT_MAP[ch] || ch).join('');
  const braced = text.match(/_(?:\{|\[|\()([A-Za-z0-9]+)(?:\}|\]|\))$/);
  if (braced?.[1]) return braced[1].toLowerCase();
  const plain = text.match(/_([A-Za-z0-9]+)$/);
  if (plain?.[1]) return plain[1].toLowerCase();
  const traceDigits = text.match(/^t(\d+)$/i);
  if (traceDigits?.[1]) return traceDigits[1];
  const danglingSubscript = label.trim().match(/([₀-₉ᵢⱼₐₑₒₓₕₖₗₘₙₚₛₜᵥ]+)$/);
  return danglingSubscript?.[1]
    ? [...danglingSubscript[1]].map((ch) => SUBSCRIPT_MAP[ch] || ch).join('').toLowerCase()
    : null;
};

const toSubscriptDigits = (value: string): string =>
  value
    .split('')
    .map((ch) => DIGIT_TO_SUBSCRIPT[ch] || INDEX_TO_SUBSCRIPT[ch.toLowerCase()] || ch)
    .join('');

export const normalizeTraceIndexForDisplay = (index?: string | null): string => {
  const normalized = [...String(index || '').trim()]
    .map((ch) => SUBSCRIPT_MAP[ch] || ch)
    .join('')
    .toLowerCase();
  if (!normalized) return '';
  const numeric = /^\d+$/.test(normalized)
    ? Number(normalized)
    : NaN;
  if (Number.isFinite(numeric)) return numeric >= 1 ? String(numeric) : '';
  return /^[a-z]+$/.test(normalized) ? normalized : '';
};

export const buildTraceDisplayLabel = (index?: string | null): string => {
  const normalized = normalizeTraceIndexForDisplay(index);
  const suffix = /^\d+$/.test(normalized) ? normalized : '';
  return suffix ? `t${toSubscriptDigits(suffix)}` : 't';
};

export const formatIndexedSurfaceForDisplayValue = (
  surface: string,
  index?: string | null
): string => {
  if (extractMovementIndex(surface)) return surface;
  const suffix = normalizeTraceIndexForDisplay(index);
  return suffix ? `${surface}${toSubscriptDigits(suffix)}` : surface;
};

export const formatTraceSurfaceForDisplayValue = (
  surface: string,
  fallbackIndex?: string | null
): string => {
  const raw = String(surface || '').trim();
  if (!raw) return buildTraceDisplayLabel(fallbackIndex);
  if (!isTraceLike(raw)) return raw;
  const authoredIndex = normalizeTraceIndexForDisplay(extractMovementIndex(raw));
  return buildTraceDisplayLabel(/^\d+$/.test(authoredIndex) ? authoredIndex : fallbackIndex || authoredIndex);
};

const DISPLAY_TRACE_LABEL_RE = /^t(?:[₀₁₂₃₄₅₆₇₈₉]+)?$/;

/**
 * The authored-witness formatter is additive only: an authored trace surface
 * (`t`, `t₁`, …) may gain its derived index, while authored `∅` and lexical
 * material keep their surface. Occupant-as-authored ruling: silent movement
 * copies also keep their authored words — resolveLexicalMovementTraceDisplayIndex
 * supplies only the chain index for their subscript, never a trace conversion.
 * Trace display belongs solely to occupants the model authored as traces.
 */
export const formatAuthoredWitnessSurface = (
  surface: string,
  inheritedTraceIndex?: string | null,
  aliasedTraceIndex?: string | null
): string => {
  const resolvedIndex = normalizeTraceIndexForDisplay(
    inheritedTraceIndex || aliasedTraceIndex || extractMovementIndex(surface)
  );
  if (isTraceLike(surface)) {
    return formatTraceSurfaceForDisplayValue(surface, resolvedIndex || extractMovementIndex(surface));
  }
  return surface;
};

export const isDisplayTraceLabel = (value?: string): boolean =>
  DISPLAY_TRACE_LABEL_RE.test(String(value || '').trim());

export const resolveLexicalMovementTraceDisplayIndex = (
  _node: HierNode,
  surface: string,
  traceIndex?: string | null
): string => {
  const trimmed = String(surface || '').trim();
  if (
    !trimmed
    || isTraceLike(trimmed)
    || isNullLike(trimmed)
    || isStructuralCategorySurface(trimmed)
  ) {
    return '';
  }

  // Membership in an established movement chain is independent of pronunciation.
  return normalizeTraceIndexForDisplay(traceIndex);
};

export const isNullLike = (label: string): boolean => NULL_LIKE_LABEL.test(label.trim());

/**
 * Pronunciation is decided by authored fields (nodePronunciation.js). The
 * helpers below add the two Replay-only readings: notation styling for
 * leaves that are already unpronounced, and the inherited-silence rule for
 * hierarchy nodes, which stays until whole-subtree silence is decided.
 */
const isNotationSurface = (surface?: string): boolean => {
  const trimmed = String(surface || '').trim();
  return Boolean(trimmed) && (isTraceLike(trimmed) || isNullLike(trimmed));
};

/** An unpronounced leaf whose authored surface is notation rather than retained lexical content. */
const isNotationLeaf = (node?: SyntaxNode | null): boolean =>
  isLeafNode(node) && !isPronouncedLeaf(node) && isNotationSurface(getSyntaxNodeSurface(node));

/** A leaf carrying lexical content: pronounced, or a silent copy whose retained word is not notation. */
const isLexicalLeaf = (node?: SyntaxNode | null): boolean =>
  isPronouncedLeaf(node) || (isSilentWordLeaf(node) && !isNotationSurface(authoredWord(node)));

const hasSilentOrGhostAncestor = (node: HierNode | null): boolean => {
  let current: HierNode | null = node;
  while (current) {
    if ((current.data as SyntaxNode)?.silent === true || (current.data as any)?.ghost === true) return true;
    current = current.parent;
  }
  return false;
};

export const isPronouncedHierLeaf = (node: HierNode): boolean =>
  isPronouncedLeaf(node.data) && !hasSilentOrGhostAncestor(node);

/** A rendered leaf is terminal material even when `t` also resembles T. */
export const isDisplayTerminalSurface = (surface?: string): boolean => {
  const trimmed = String(surface || '').trim();
  return Boolean(trimmed)
    && (isTraceLike(trimmed) || isNullLike(trimmed) || !isStructuralCategorySurface(trimmed));
};
const isIndexedSurface = (label: string): boolean => {
  const trimmed = label.trim();
  return Boolean(trimmed) && !isTraceLike(trimmed) && !isNullLike(trimmed) && Boolean(extractMovementIndex(trimmed));
};

export const collectOvertLeafNodeIdsInOrder = (root?: SyntaxNode | null): string[] => {
  if (!root || typeof root !== 'object') return [];
  const overtIds: string[] = [];
  const visit = (node: SyntaxNode) => {
    const children = Array.isArray(node?.children) ? node.children : [];
    if (children.length === 0) {
      const nodeId = String(node?.id || '').trim();
      if (nodeId && isLexicalLeaf(node)) overtIds.push(nodeId);
      return;
    }
    children.forEach(visit);
  };
  visit(root);
  return overtIds;
};

export const collectPronouncedLeafNodeIdsInOrder = (root?: SyntaxNode | null): string[] => {
  if (!root || typeof root !== 'object') return [];
  const pronouncedIds: string[] = [];
  const visit = (node: SyntaxNode, silentAncestor: boolean) => {
    const silent = silentAncestor || node?.silent === true || (node as any)?.ghost === true;
    const children = Array.isArray(node?.children) ? node.children : [];
    if (children.length === 0) {
      const nodeId = String(node?.id || '').trim();
      if (!silent && nodeId && isPronouncedLeaf(node)) pronouncedIds.push(nodeId);
      return;
    }
    children.forEach((child) => visit(child, silent));
  };
  visit(root, false);
  return pronouncedIds;
};

const collectSyntaxSubtreeNodeIds = (root?: SyntaxNode | null): string[] => {
  if (!root || typeof root !== 'object') return [];
  const ids: string[] = [];
  const visit = (node: SyntaxNode) => {
    const nodeId = String(node?.id || '').trim();
    if (nodeId) ids.push(nodeId);
    const children = Array.isArray(node?.children) ? node.children : [];
    children.forEach(visit);
  };
  visit(root);
  return ids;
};

export const maybeLowercaseSentenceInitialFunctionSurface = ({
  surface,
  sentenceInitialSurface,
  nodeId,
  parentLabel,
  tokenIndex,
  visibleOvertLeafIds,
  isWorkspaceForest = false,
  hasNominalComplement = false
}: {
  surface: string;
  sentenceInitialSurface?: string;
  nodeId?: string;
  parentLabel?: string;
  tokenIndex?: number;
  visibleOvertLeafIds?: string[];
  isWorkspaceForest?: boolean;
  hasNominalComplement?: boolean;
}): string => {
  const trimmed = String(surface || '').trim();
  if (!trimmed) return '';

  const normalizedNodeId = String(nodeId || '').trim();
  const normalizedParentLabel = String(parentLabel || '').trim().toUpperCase();
  const normalizedSentenceInitialSurface = String(sentenceInitialSurface || '').trim();
  if (isWorkspaceForest) return trimmed;
  if (!isSentenceInitialCaseAdjustableParent(normalizedParentLabel)) return trimmed;
  if (
    !normalizedSentenceInitialSurface
    || normalizeToken(trimmed) !== normalizeToken(normalizedSentenceInitialSurface)
    || !/^\p{Lu}\p{Ll}/u.test(normalizedSentenceInitialSurface)
  ) {
    return trimmed;
  }

  const hasAuthoredTokenIndex = Number.isFinite(tokenIndex);
  // A bare D can also be a pronoun or proper name. Without authored surface
  // position evidence, preserve its spelling instead of guessing from English.
  if (!hasAuthoredTokenIndex && normalizedParentLabel === 'D' && !hasNominalComplement) return trimmed;

  const visibleIds = Array.isArray(visibleOvertLeafIds) ? visibleOvertLeafIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
  const firstVisibleOvertLeafId = visibleIds[0] || '';
  const isSentenceInitialInVisibleReplay = normalizedNodeId && normalizedNodeId === firstVisibleOvertLeafId;
  if (isSentenceInitialInVisibleReplay) return trimmed;

  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
};

export const isOvertLeafNode = (node: HierNode): boolean => isPronouncedHierLeaf(node);

export const resolveTraceIndexFromNodeContext = (
  node: HierNode,
  primaryMap: Map<string, string>,
  secondaryMap?: Map<string, string>
): string | undefined => {
  let current: HierNode | null = node;
  while (current) {
    const nodeId = getNodeId(current);
    const primary = primaryMap.get(nodeId);
    if (primary) return primary;
    const secondary = secondaryMap?.get(nodeId);
    if (secondary) return secondary;
    current = current.parent;
  }
  return undefined;
};

export interface MovementChainIndexCatalogue {
  forest: SyntaxNode[];
  links: ResolvedRelationLink[];
  authoredIndicesByNodeId?: Map<string, Set<string>>;
}

/** Retain disappeared occurrences and authored indices without changing any stage. */
export const buildMovementChainIndexCatalogue = (
  forests: SyntaxNode[][],
  links: ResolvedRelationLink[] = []
): MovementChainIndexCatalogue => {
  const forest: SyntaxNode[] = [];
  const retainedIds = new Set<string>();
  const authoredIndicesByNodeId = new Map<string, Set<string>>();
  const retain = (node: SyntaxNode) => {
    if (!retainedIds.has(node.id)) {
      forest.push(node);
      collectSubtreeNodeIds(node).forEach(id => retainedIds.add(id));
    }
    const index = normalizeTraceIndexForDisplay(extractMovementIndex(String(node.word || node.label || '')));
    if (/^\d+$/.test(index)) {
      const indices = authoredIndicesByNodeId.get(node.id) ?? new Set<string>();
      indices.add(index);
      authoredIndicesByNodeId.set(node.id, indices);
    }
    (node.children || []).forEach(retain);
  };
  for (let stage = forests.length - 1; stage >= 0; stage -= 1) forests[stage].forEach(retain);
  return { forest, links, authoredIndicesByNodeId };
};

export const buildResolvedLinkTraceIndexMap = (
  currentForest: SyntaxNode[],
  resolvedRelationLinks: ResolvedRelationLink[] | undefined,
  activeStepIndex: number,
  catalogue?: MovementChainIndexCatalogue
): Map<string, string> => {
  const traceIndexByNodeId = new Map<string, string>();
  const links = Array.isArray(resolvedRelationLinks) ? resolvedRelationLinks : [];
  const catalogueForest = catalogue?.forest ?? currentForest;
  const movementLinks = (catalogue?.links ?? links).filter(isResolvedMovementLink)
    .sort((left, right) => (left.stepIndex ?? 0) - (right.stepIndex ?? 0));
  const partialDeletionNodeIds = new Set<string>();
  links.forEach((link) => {
    const relationName = String(link?.relation || link?.operation || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z]/g, '');
    if (relationName !== 'partialcopydeletion') return;
    (Array.isArray(link?.anchors) ? link.anchors : []).forEach((anchor) => {
      const role = String(anchor?.role || '').trim().toLowerCase();
      if (role !== 'deletedsubconstituent' && role !== 'deleted') return;
      const deletedNode = findNodeByIdInForest(currentForest, String(anchor?.nodeId || '').trim());
      collectSubtreeNodeIds(deletedNode).forEach((nodeId) => partialDeletionNodeIds.add(nodeId));
    });
  });
  /*
   * An index marks chain membership, so the first chain to claim a position
   * keeps it. Chains are processed in authored order, and a chain that vacated
   * a position is always authored before a later chain whose moved constituent
   * merely contains that position (the object leaves before the remnant VP
   * fronts). Without this guard the later, larger constituent repaints the
   * inner gap with its own index — the accidental all-t₂ remnant display.
   */
  const assignIndexIfUnclaimed = (rawId: string, index: string) => {
    const id = String(rawId || '').trim();
    if (!id || traceIndexByNodeId.has(id)) return;
    traceIndexByNodeId.set(id, index);
  };
  const assignIndexToNodeAndLeaves = (nodeId: string, index: string) => {
    const normalizedNodeId = String(nodeId || '').trim();
    const normalizedIndex = String(index || '').trim();
    if (!normalizedNodeId || !normalizedIndex) return;
    assignIndexIfUnclaimed(normalizedNodeId, normalizedIndex);
    const node = findNodeByIdInForest(currentForest, normalizedNodeId);
    if (!node) return;
    collectLeafSyntaxNodes(node)
      .map((leaf) => String(leaf?.id || '').trim())
      .filter(Boolean)
      .forEach((leafId) => assignIndexIfUnclaimed(leafId, normalizedIndex));
  };
  const assignIndexToMovementSource = (nodeId: string, index: string) => {
    const normalizedNodeId = String(nodeId || '').trim();
    const normalizedIndex = String(index || '').trim();
    if (!normalizedNodeId || !normalizedIndex) return;
    const node = findNodeByIdInForest(currentForest, normalizedNodeId);
    if (!node) return;
    const sourceContainsPartialDeletion = collectSubtreeNodeIds(node)
      .some((sourceNodeId) => partialDeletionNodeIds.has(sourceNodeId));
    if (!sourceContainsPartialDeletion) {
      assignIndexToNodeAndLeaves(normalizedNodeId, normalizedIndex);
      return;
    }
    collectLeafSyntaxNodes(node)
      .map((leaf) => String(leaf?.id || '').trim())
      .filter((leafId) => Boolean(leafId) && !partialDeletionNodeIds.has(leafId))
      .forEach((leafId) => assignIndexIfUnclaimed(leafId, normalizedIndex));
  };
  /*
   * Multi-source trajectories (across-the-board, and any authored array of
   * source/witness anchors) carry only their first pair in the scalar
   * sourceNodeId/witnessNodeId fields. The full authored anchor list travels
   * on the link, so chain indexing reads every source and witness from it —
   * one dependency, one index, every conjunct.
   */
  const linkAnchorIdsByRoles = (
    link: ResolvedRelationLink,
    roles: readonly string[]
  ): string[] => {
    const wanted = new Set(roles.map((role) => role.toLowerCase()));
    const anchors = (link as ReplayAuthoredRelationLink)?.anchors;
    if (!Array.isArray(anchors)) return [];
    return anchors
      .filter((anchor) => wanted.has(String((anchor as { role?: string })?.role || '').trim().toLowerCase()))
      .map((anchor) => String((anchor as { nodeId?: string })?.nodeId || '').trim())
      .filter(Boolean);
  };
  const movementParent = new Map<string, string>();
  const findMovementRoot = (nodeId: string): string => {
    const currentParent = movementParent.get(nodeId);
    if (!currentParent) {
      movementParent.set(nodeId, nodeId);
      return nodeId;
    }
    if (currentParent === nodeId) return nodeId;
    const root = findMovementRoot(currentParent);
    movementParent.set(nodeId, root);
    return root;
  };
  const unionMovementNodes = (left: string, right: string) => {
    if (!left || !right) return;
    const leftRoot = findMovementRoot(left);
    const rightRoot = findMovementRoot(right);
    if (leftRoot !== rightRoot) movementParent.set(rightRoot, leftRoot);
  };
  const movementNodeIds = (link: ResolvedRelationLink): string[] => Array.from(new Set([
    link.sourceNodeId,
    link.targetNodeId,
    link.witnessNodeId,
    ...linkAnchorIdsByRoles(link, TRAJECTORY_SOURCE_ROLES),
    ...linkAnchorIdsByRoles(link, TRAJECTORY_WITNESS_ROLES)
  ].map((nodeId) => String(nodeId || '').trim()).filter(Boolean)));
  movementLinks.forEach((link) => {
    const nodeIds = movementNodeIds(link);
    nodeIds.forEach((nodeId) => findMovementRoot(nodeId));
    nodeIds.slice(1).forEach((nodeId) => unionMovementNodes(nodeIds[0], nodeId));
  });
  const authoredIndices = new Map<string, Set<string>>();
  const reservedIndices = new Set<string>();
  const authoredIndex = (node: SyntaxNode): string => {
    const index = normalizeTraceIndexForDisplay(extractMovementIndex(String(node.word || node.label || '')));
    return /^\d+$/.test(index) ? index : '';
  };
  const reserveAuthoredIndices = (node: SyntaxNode) => {
    const index = authoredIndex(node);
    if (index) reservedIndices.add(index);
    (node.children || []).forEach(reserveAuthoredIndices);
  };
  catalogueForest.forEach(reserveAuthoredIndices);
  catalogue?.authoredIndicesByNodeId?.forEach(indices => indices.forEach(index => reservedIndices.add(index)));
  movementLinks.forEach((link) => {
    const nodeIds = movementNodeIds(link);
    const root = nodeIds[0] ? findMovementRoot(nodeIds[0]) : '';
    if (!root) return;
    const indices = authoredIndices.get(root) ?? new Set<string>();
    const collect = (node: SyntaxNode) => {
      // An embedded gap keeps the index of its own chain, not its carrier's.
      if (movementParent.has(node.id) && findMovementRoot(node.id) !== root) return;
      const index = authoredIndex(node);
      if (index) indices.add(index);
      catalogue?.authoredIndicesByNodeId?.get(node.id)?.forEach(index => indices.add(index));
      (node.children || []).forEach(collect);
    };
    nodeIds.forEach((nodeId) => {
      const node = findNodeByIdInForest(catalogueForest, nodeId);
      if (node) collect(node);
    });
    authoredIndices.set(root, indices);
  });
  // Number complete connected chains once. Relation position, drawing tier and
  // the currently visible prefix do not determine chain identity or numbering.
  const componentIndices = new Map<string, string>();
  let nextIndex = 1;
  authoredIndices.forEach((indices, root) => {
    if (indices.size > 1) return; // Conflicting authored indices are not repaired.
    if (indices.size === 1) {
      componentIndices.set(root, indices.values().next().value as string);
      return;
    }
    while (reservedIndices.has(String(nextIndex))) nextIndex += 1;
    const index = String(nextIndex++);
    reservedIndices.add(index);
    componentIndices.set(root, index);
  });
  links.forEach((link) => {
    /* A resolved relation is not automatically a movement chain. */
    if (!isResolvedMovementLink(link)) return;

    const traceId = String(link?.witnessNodeId || '').trim();
    const sourceId = String(link?.sourceNodeId || '').trim();
    const movedId = String(link?.targetNodeId || '').trim();
    const componentNodeId = sourceId || movedId || traceId;
    const componentIndex = componentNodeId
      ? componentIndices.get(findMovementRoot(componentNodeId))
      : '';
    const index = componentIndex;
    const stepIndex = Number.isInteger(link?.stepIndex) ? Number(link.stepIndex) : 0;
    if (!index || stepIndex > activeStepIndex) return;

    if (traceId) assignIndexToNodeAndLeaves(traceId, index);
    if (sourceId) assignIndexToMovementSource(sourceId, index);
    // Every additional authored source/witness of a multi-source trajectory
    // shares the same chain index as the first pair.
    linkAnchorIdsByRoles(link, TRAJECTORY_WITNESS_ROLES)
      .filter((nodeId) => nodeId !== traceId)
      .forEach((nodeId) => assignIndexToNodeAndLeaves(nodeId, index));
    linkAnchorIdsByRoles(link, TRAJECTORY_SOURCE_ROLES)
      .filter((nodeId) => nodeId !== sourceId)
      .forEach((nodeId) => assignIndexToMovementSource(nodeId, index));
    if (movedId) assignIndexToNodeAndLeaves(movedId, index);
  });
  return traceIndexByNodeId;
};

export const buildResolvedLinkOperatorVariableIndexMap = (
  currentForest: SyntaxNode[],
  resolvedRelationLinks: ResolvedRelationLink[] | undefined,
  activeStepIndex: number
): Map<string, string> => {
  const indexByNodeId = new Map<string, string>();
  const assignIndexToNodeAndLeaves = (nodeId: string, index: string) => {
    const normalizedNodeId = String(nodeId || '').trim();
    const normalizedIndex = normalizeTraceIndexForDisplay(index);
    if (!normalizedNodeId || !normalizedIndex) return;
    indexByNodeId.set(normalizedNodeId, normalizedIndex);
    const node = findNodeByIdInForest(currentForest, normalizedNodeId);
    if (!node) return;
    collectLeafSyntaxNodes(node)
      .map((leaf) => String(leaf?.id || '').trim())
      .filter(Boolean)
      .forEach((leafId) => indexByNodeId.set(leafId, normalizedIndex));
  };

  (Array.isArray(resolvedRelationLinks) ? resolvedRelationLinks : []).forEach((link) => {
    const relation = String(link?.relation || link?.operation || '').trim();
    const stepIndex = Number.isInteger(link?.stepIndex) ? Number(link.stepIndex) : 0;
    if (!/operator\s*[-\s]?variable\s*[-\s]?binding/i.test(relation) || stepIndex > activeStepIndex) {
      return;
    }
    const index = String(link?.relationIndex || '').trim();
    assignIndexToNodeAndLeaves(String(link?.targetNodeId || '').trim(), index);
    assignIndexToNodeAndLeaves(String(link?.witnessNodeId || '').trim(), index);
  });

  return indexByNodeId;
};

export const buildResolvedLinkRawTraceAliasMap = (
  currentForest: SyntaxNode[],
  resolvedRelationLinks: ResolvedRelationLink[] | undefined,
  activeStepIndex: number
): Map<string, string> => {
  const rawAliasByIndex = new Map<string, string>();
  const links = Array.isArray(resolvedRelationLinks) ? resolvedRelationLinks : [];
  const assignFromNode = (nodeId?: string, index?: string) => {
    const normalizedNodeId = String(nodeId || '').trim();
    const normalizedIndex = normalizeTraceIndexForDisplay(index);
    if (!normalizedNodeId || !normalizedIndex) return;
    const node = findNodeByIdInForest(currentForest, normalizedNodeId);
    if (!node) return;
    collectLeafSyntaxNodes(node).forEach((leaf) => {
      const rawSurface = String(leaf?.word || leaf?.label || '').trim();
      const rawAlias = extractMovementIndex(rawSurface);
      if (!rawAlias) return;
      const normalizedAlias = String(rawAlias).trim().toLowerCase();
      if (!normalizedAlias || rawAliasByIndex.has(normalizedAlias)) return;
      rawAliasByIndex.set(normalizedAlias, normalizedIndex);
    });
  };

  links.forEach((link) => {
    const stepIndex = Number.isInteger(link?.stepIndex) ? Number(link.stepIndex) : 0;
    if (stepIndex > activeStepIndex) return;
    assignFromNode(link?.witnessNodeId, link?.relationIndex);
    assignFromNode(link?.sourceNodeId, link?.relationIndex);
  });

  return rawAliasByIndex;
};

const normalizeReplayCategoryKeyForOrdering = (value?: string | null): string => {
  const raw = String(value || '')
    .trim()
    .replace(/[’′']/g, '')
    .replace(/[â€™â€²']/g, '')
    .replace(/[^A-Za-z]/g, '');
  if (/^vP$/.test(raw)) return 'vP';
  if (/^v$/.test(raw)) return 'v';
  return raw.toUpperCase();
};

const getDerivationalChildRankForOrdering = (parent: HierNode, child: HierNode, childIndex: number): number => {
  const parentLabel = String(parent.data?.label || '').trim();
  const childLabel = String(child.data?.label || '').trim();
  const parentKey = normalizeReplayCategoryKeyForOrdering(parent.data?.label);
  const childKey = normalizeReplayCategoryKeyForOrdering(child.data?.label);
  const childHasChildren = Boolean(child.children && child.children.length > 0);
  const childHasOvert = subtreeHasOvertYield(child.data);
  const childIsSilent = isNotationLeaf(child.data);
  const childIsPredicateCore =
    childKey === 'vP'
    || childKey === 'v'
    || childKey === 'VP'
    || childKey === 'VOICEP'
    || childKey === 'AP'
    || childKey === 'PP'
    || childKey === 'CP';

  const parentIsBarProjection = /[’′']+$/.test(parentLabel);
  const childIsMatchingHead =
    parentIsBarProjection
    && !/[’′']+$/.test(childLabel)
    && childKey === parentKey;
  if (parentIsBarProjection) {
    // Complete the complement before selecting/projecting the head that will
    // merge with it. Selecting every head first leaves illegal hanging
    // branches across a right-branching X-bar spine.
    return childIsMatchingHead ? 3 : 0;
  }

  if (parentKey === 'CP') {
    if (childKey === 'C' || childKey === 'TP' || childKey === 'IP' || childKey === 'INFLP') return 0;
    return 4;
  }

  if (parentKey === 'C') {
    if (childKey === 'TP' || childKey === 'IP' || childKey === 'INFLP' || childKey === 'VP' || childKey === 'VOICEP') return 0;
    return 3;
  }

  if (parentKey === 'TP' || parentKey === 'IP' || parentKey === 'INFLP') {
    if (childIsPredicateCore || childKey === 'VPASS' || childKey === 'VPASSIVE') return 0;
    if (childKey === 'T' || childKey === 'I' || childKey === 'INFL') return 3;
    if (childKey === 'DP' || childKey === 'NP') return 4;
  }

  if (parentKey === 'VOICEP' || parentKey === 'VOICE') {
    if (childKey === 'vP' || childKey === 'v' || childKey === 'VP') return 0;
    if (childKey === 'PP') return 1;
    if (childKey === 'VOICE') return 3;
    if (childKey === 'DP' || childKey === 'NP') return 4;
  }

  if (parentKey === 'vP') {
    if (childKey === 'v' || childKey === 'VP') return 0;
    if (childKey === 'DP' || childKey === 'NP') return 4;
  }

  if (parentKey === 'v' || parentKey === 'V') {
    if (childKey === 'VP') return 0;
    if (childKey === 'v' || childKey === 'V') return 2;
    if (childKey === 'DP' || childKey === 'NP') return 4;
  }

  if (parentKey === 'VP') {
    if (childKey === 'V') return 0;
    return childHasOvert && !childIsSilent ? 1 : 2;
  }

  if (parentKey === 'DP') {
    if (childKey === 'D') return 0;
    if (childKey === 'NP' || childKey === 'N') return 1;
  }

  if (parentKey === 'PP') {
    if (childKey === 'P') return 0;
    if (childKey === 'DP' || childKey === 'NP') return 1;
  }

  if (childHasChildren && childHasOvert) return 0;
  if (childIsSilent) return 3;
  return childIndex;
};

const buildBottomUpSequence = (root: HierNode, visibleIds: Set<string>): HierNode[] => {
  const sequence: HierNode[] = [];

  const visit = (node: HierNode) => {
    const syntheticWorkspaceRoot = isSyntheticWorkspaceRootNode(node);
    if (!syntheticWorkspaceRoot && !visibleIds.has(getNodeId(node))) return;
    const visibleChildren = (node.children || [])
      .filter((child) => visibleIds.has(getNodeId(child)))
      .map((child, index) => ({ child, index }))
      .sort((left, right) => {
        const leftRank = getDerivationalChildRankForOrdering(node, left.child, left.index);
        const rightRank = getDerivationalChildRankForOrdering(node, right.child, right.index);
        return leftRank === rightRank ? left.index - right.index : leftRank - rightRank;
      })
      .map(({ child }) => child);
    visibleChildren.forEach(visit);
    if (!syntheticWorkspaceRoot && visibleIds.has(getNodeId(node))) {
      sequence.push(node);
    }
  };

  visit(root);
  return sequence.filter((node) => visibleIds.has(getNodeId(node)));
};

export const buildStructuralDerivationPlaybackSteps = (
  forest: SyntaxNode[],
  frameIndex: number,
  previousVisibleNodeIds: Set<string>,
  resolvedRelationLinks?: ResolvedRelationLink[],
  revealRootIds?: Set<string>,
  derivationFrames?: ReplayDerivationFrame[],
  sentence?: string,
  suppressedRelationLinks?: ResolvedRelationLink[],
  layoutScaffoldForest?: SyntaxNode[],
  identity = createReplayIdentityContext(derivationFrames?.flatMap(frame => frame.workspaceForest || []) ?? forest)
): PlaybackStep[] => {
  const sentenceInitialSurface = String(tokenizeReplaySentenceSurface(sentence)[0] || '').trim();
  const effectiveRelationLinks = resolvedRelationLinks || [];
  const structuralRelationLinks = filterResolvedRelationLinks(effectiveRelationLinks, suppressedRelationLinks);
  const snapshotResolvedRelationLinks = Array.isArray(suppressedRelationLinks) && suppressedRelationLinks.length > 0
    ? structuralRelationLinks
    : resolvedRelationLinks;
  const canvas = buildRenderableDerivationCanvasData(forest, structuralRelationLinks, identity);
  const cloned = cloneSyntaxTree(canvas);
  if (!cloned) return [];
  const hierarchy: HierNode = d3.hierarchy<SyntaxNode>(cloned);
  applyVizIds(hierarchy);
  const visibleNodes: HierNode[] = hierarchy
    .descendants()
    .filter((node) => !isSyntheticWorkspaceRootNode(node));
  const visibleNodeById = new Map<string, HierNode>(visibleNodes.map((node) => [getNodeId(node), node] as const));
  const visibleIds = new Set<string>(visibleNodes.map((node) => getNodeId(node)));
  const rawNodeById = collectForestNodesById(forest);
  const continuityVisibleNodeIds = (() => {
    const seeded = new Set(previousVisibleNodeIds);
    const hasOvertReplayDescendant = (node: HierNode): boolean =>
      node.descendants().some((descendant) =>
        !isSyntheticWorkspaceRootNode(descendant) && isLexicalLeaf(descendant.data)
      );
    const previousFrameForest = frameIndex > 0 && Array.isArray(derivationFrames?.[frameIndex - 1]?.workspaceForest)
      ? derivationFrames?.[frameIndex - 1]?.workspaceForest || []
      : [];
    // Lineage continuity is lineage-to-lineage: an occurrence continues a
    // previously visible object when some previously visible occurrence
    // carried the same authored lineageId. Node ids are a different concept.
    const previousVisibleLineageIds = new Set<string>();
    collectForestNodesById(previousFrameForest).forEach((previousNode, previousNodeId) => {
      const previousLineageId = String(previousNode?.lineageId || '').trim();
      if (previousLineageId && previousVisibleNodeIds.has(previousNodeId)) {
        previousVisibleLineageIds.add(previousLineageId);
      }
    });

    visibleNodes.forEach((node) => {
      const nodeId = getNodeId(node);
      const lineageId = String(
        (node.data as SyntaxNode)?.lineageId
        || rawNodeById.get(nodeId)?.lineageId
        || ''
      ).trim();
      if (!lineageId || !previousVisibleLineageIds.has(lineageId)) return;
      if (!hasOvertReplayDescendant(node)) return;
      node.descendants().forEach((descendant) => {
        if (!isSyntheticWorkspaceRootNode(descendant)) {
          seeded.add(getNodeId(descendant));
        }
      });
    });

    const previousContinuitySubtrees = collectUniqueReplayContinuitySubtrees(previousFrameForest);
    const currentContinuitySubtrees = new Map<string, HierNode[]>();
    visibleNodes.forEach((node) => {
      const signature = getReplayContinuitySubtreeSignature(node.data as SyntaxNode);
      if (!signature || !previousContinuitySubtrees.has(signature)) return;
      const entries = currentContinuitySubtrees.get(signature) || [];
      entries.push(node);
      currentContinuitySubtrees.set(signature, entries);
    });
    currentContinuitySubtrees.forEach((nodes, signature) => {
      if (nodes.length !== 1) return;
      const previousNode = previousContinuitySubtrees.get(signature);
      const previousSubtreeIds = new Set(collectSubtreeNodeIds(previousNode));
      const previousSubtreeWasVisible = Array.from(previousSubtreeIds).some((nodeId) =>
        previousVisibleNodeIds.has(nodeId)
      );
      if (!previousSubtreeWasVisible) return;
      nodes[0].descendants().forEach((descendant) => {
        if (!isSyntheticWorkspaceRootNode(descendant)) {
          seeded.add(getNodeId(descendant));
        }
      });
    });

    return seeded;
  })();
  const traceIndexByNodeId = buildResolvedLinkTraceIndexMap(
    forest,
    structuralRelationLinks,
    frameIndex
  );
  const getReplayNodeLabel = (node: HierNode): string => {
    const surface = resolveLeafSurface(node);
    if (isPronouncedLeaf(node.data) || !isTraceLike(surface)) return resolveNodeLabel(node);
    const inheritedTraceIndex = resolveTraceIndexFromNodeContext(node, traceIndexByNodeId);
    return formatTraceSurfaceForDisplayValue(
      surface,
      inheritedTraceIndex || extractMovementIndex(surface)
    );
  };
  const sequence = buildBottomUpSequence(hierarchy, visibleIds)
    .filter((node) => !isSyntheticWorkspaceRootNode(node));
  const nodesToReveal = sequence.filter((node) =>
    (frameIndex === 0 || !continuityVisibleNodeIds.has(getNodeId(node)))
    && (
      !revealRootIds ||
      revealRootIds.size === 0 ||
      (() => {
        let current: HierNode | null = node;
        while (current) {
          if (revealRootIds.has(getNodeId(current))) return true;
          current = current.parent;
        }
        return false;
      })()
    )
  );
  const cumulativeVisibleNodeIds = new Set(continuityVisibleNodeIds);
  const isUnrevealedClauseProjectionRoot = (
    node: HierNode | null | undefined,
    visibleNodeIdsForStep: Set<string>
  ): boolean => {
    if (!node || isSyntheticWorkspaceRootNode(node)) return false;
    const nodeId = getNodeId(node);
    if (!nodeId || visibleNodeIdsForStep.has(nodeId)) return false;
    const label = String(node.data?.label || '').trim();
    const children = Array.isArray(node.children) ? node.children : [];
    const hasCHead = children.some((child) => String(child.data?.label || '').trim() === 'C');
    const hasInflComplement = children.some((child) => /^(Infl|InflP|TP|IP|T)$/i.test(String(child.data?.label || '').trim()));
    return (
      /^cp(?:_|$)/i.test(nodeId)
      || (label === 'C' && hasCHead && hasInflComplement)
    );
  };
  const addReplayLayoutForNode = (
    layoutVisibleNodeIds: Set<string>,
    node: HierNode,
    visibleNodeIdsForStep: Set<string>
  ) => {
    let topRenderableAncestor: HierNode = node;
    while (
      topRenderableAncestor.parent
      && !isSyntheticWorkspaceRootNode(topRenderableAncestor.parent)
    ) {
      topRenderableAncestor = topRenderableAncestor.parent;
    }

    if (isUnrevealedClauseProjectionRoot(topRenderableAncestor, visibleNodeIdsForStep)) {
      if (topRenderableAncestor === node && !visibleNodeIdsForStep.has(getNodeId(node))) return;
      layoutVisibleNodeIds.add(getNodeId(topRenderableAncestor));
      node.descendants().forEach((descendant) => {
        if (!isSyntheticWorkspaceRootNode(descendant)) {
          layoutVisibleNodeIds.add(getNodeId(descendant));
        }
      });
      let current: HierNode | null = node.parent || null;
      while (current && current !== topRenderableAncestor) {
        if (!isSyntheticWorkspaceRootNode(current) && visibleNodeIdsForStep.has(getNodeId(current))) {
          layoutVisibleNodeIds.add(getNodeId(current));
        }
        current = current.parent;
      }
      return;
    }

    topRenderableAncestor
      .descendants()
      .forEach((descendant) => {
        if (!isSyntheticWorkspaceRootNode(descendant)) {
          layoutVisibleNodeIds.add(getNodeId(descendant));
        }
      });
  };
  const playbackSteps: PlaybackStep[] = nodesToReveal.flatMap((node) => {
    const nodeId = getNodeId(node);
    cumulativeVisibleNodeIds.add(nodeId);
    const surface = resolveLeafSurface(node);
    const layoutVisibleNodeIds = new Set(cumulativeVisibleNodeIds);
    Array.from(cumulativeVisibleNodeIds).forEach((visibleNodeId) => {
      const visibleNode = visibleNodeById.get(visibleNodeId);
      if (!visibleNode) return;
      addReplayLayoutForNode(layoutVisibleNodeIds, visibleNode, cumulativeVisibleNodeIds);
    });
    const currentRevealIndex = nodesToReveal.findIndex((candidate) => getNodeId(candidate) === nodeId);
    const pendingRevealNodes = currentRevealIndex >= 0
      ? nodesToReveal.slice(currentRevealIndex + 1)
      : [];
    pendingRevealNodes.forEach((pendingNode) => {
      addReplayLayoutForNode(layoutVisibleNodeIds, pendingNode, cumulativeVisibleNodeIds);
    });
    const childNodes = (node.children || []).filter((child) => visibleIds.has(getNodeId(child)));
    const operation: DerivationOperation = childNodes.length === 0
      ? 'LexicalSelect'
      : (childNodes.length === 1 ? 'Project' : 'ExternalMerge');
    const snapshotVisibleNodeIds = new Set(cumulativeVisibleNodeIds);

    const visibleWorkspaceSnapshot = buildVisibleSyntaxSnapshotFromHierarchy(
      hierarchy,
      snapshotVisibleNodeIds, undefined, undefined, identity
    );
    const activeLayoutScaffold = layoutScaffoldForest
      && forestCanUseCurrentMaterialLayoutScaffold(forest, layoutScaffoldForest)
        ? layoutScaffoldForest
        : undefined;
    const frameReplaySnapshot = buildDerivationReplaySnapshot(
      forest,
      frameIndex,
      snapshotResolvedRelationLinks,
      snapshotVisibleNodeIds,
      layoutVisibleNodeIds,
      derivationFrames,
      undefined,
      undefined,
      activeLayoutScaffold, identity
    );
    const workspaceAfter = extractReplayWorkspaceLabels(visibleWorkspaceSnapshot);
    const visibleOvertLeafIds = collectPronouncedLeafNodeIdsInOrder(visibleWorkspaceSnapshot);
    const rawTargetLabel = getReplayNodeLabel(node);
    const targetLabel = childNodes.length === 0 && !isNotationLeaf(node.data)
      ? maybeLowercaseSentenceInitialFunctionSurface({
          surface: rawTargetLabel,
          sentenceInitialSurface,
          nodeId,
          parentLabel: String(node.parent?.data?.label || '').trim(),
          tokenIndex: Number(node.data?.tokenIndex),
          visibleOvertLeafIds,
          isWorkspaceForest: visibleWorkspaceSnapshot?.replayOrigin?.kind === 'workspace'
        })
      : rawTargetLabel;
    const preFrontingLexicalTargetLabel = targetLabel;
    const sourceNodeIds = childNodes.map((child) => getNodeId(child));
    const sourceLabels = childNodes.length > 0
      ? childNodes.map((child) => getReplayNodeLabel(child)).filter(Boolean)
      : [
          isNotationLeaf(node.data) && isTraceLike(surface)
            ? preFrontingLexicalTargetLabel
            : maybeLowercaseSentenceInitialFunctionSurface({
                surface: String(node.data.word || preFrontingLexicalTargetLabel || '').trim(),
                sentenceInitialSurface,
                nodeId,
                parentLabel: String(node.parent?.data?.label || '').trim(),
                tokenIndex: Number(node.data?.tokenIndex),
                visibleOvertLeafIds,
                isWorkspaceForest: visibleWorkspaceSnapshot?.replayOrigin?.kind === 'workspace'
              })
        ].filter(Boolean);

    return [{
      operation,
      sourceFrameIndex: frameIndex,
      visualFrameIndex: frameIndex,
      targetNodeId: nodeId,
      targetLabel: preFrontingLexicalTargetLabel,
      sourceNodeIds,
      sourceLabels,
      recipe: buildStructuralReplayFallback(operation, preFrontingLexicalTargetLabel, sourceLabels),
      workspaceAfter,
      replayFrameIndex: frameIndex,
      replayCanvasData: frameReplaySnapshot.canvasData,
      replayVisibleNodeIds: frameReplaySnapshot.visibleNodeIds,
      replayRelationLinks: frameReplaySnapshot.relationLinks,
      replayUsesFutureLayoutScaffold: Boolean(activeLayoutScaffold),
      preserveReplayStep: undefined
    }];
  });

  return playbackSteps;
};
/*
 * Exact folded-identity movement classification. The substring/regex fallback
 * that used to live here drew movement arrows for authored non-movement
 * relations (an authored `CliticCluster` or `FocusShift` matched the
 * pattern). Classification now consults the declared exact identity set and
 * nothing else. Unlisted names are not movement — they dispatch through the
 * exact registry and, when unregistered, take the neutral fallback
 * presentation.
 */
const isMoveLikeOperation = (operation?: DerivationOperation | string): boolean =>
  isMovementIdentity(String(operation || ''));

const isResolvedMovementLink = (link?: ResolvedRelationLink | null): boolean => {
  if (!link) return false;
  if (link.renderFamily === 'trajectory') return true;
  if (normalizeTrajectoryKind(link.trajectoryKind)) return true;
  if (String((link as ReplayAuthoredRelationLink).authoredRelationKey || '').trim()) {
    return isRegisteredTrajectoryRelation(link.relation, link.anchors);
  }
  return isMoveLikeOperation(link.relation || link.operation);
};

const getActiveReplayRelationLinks = (step?: PlaybackStep | null): ResolvedRelationLink[] => {
  const links = Array.isArray(step?.replayRelationLinks) ? step.replayRelationLinks : [];
  if (links.length === 0) return [];

  const stageIndex = step?.replayRelationIdentity?.stageIndex;
  const relationIndex = step?.replayRelationIdentity?.relationIndex;
  if (Number.isInteger(stageIndex) && Number.isInteger(relationIndex)) {
    const authoredRelationKey = `${stageIndex}:${relationIndex}`;
    const exactLinks = links.filter((link) => (
      String((link as ReplayAuthoredRelationLink).authoredRelationKey || '').trim()
      === authoredRelationKey
    ));
    if (exactLinks.length > 0) return exactLinks;
  }

  if (step?.replayKind === 'relation') {
    const authoredName = String(step.operation || '').trim();
    return links.filter((link) => String(link?.relation || '').trim() === authoredName);
  }

  return !step?.replayKind ? links : [];
};

export const stepRepresentsMovement = (step?: PlaybackStep | null): boolean => {
  if (!step) return false;
  if (isMoveLikeOperation(step.operation)) return true;
  if (getActiveReplayRelationLinks(step).some(isResolvedMovementLink)) return true;
  if (String(step.chainId || '').trim()) return true;
  if (isTraceLike(step.targetLabel)) return true;
  return (Array.isArray(step.sourceLabels) ? step.sourceLabels : []).some((label) => isTraceLike(label));
};

const relationMomentUsesMovementSupport = (step: PlaybackStep): boolean => {
  if (step.replayKind !== 'relation') return true;
  return getActiveReplayRelationLinks(step).some(isResolvedMovementLink);
};

export const decoratePlaybackStepsWithTraceIndices = (
  steps: PlaybackStep[],
  traceIndexByNodeId: Map<string, string>
): PlaybackStep[] => {
  if (steps.length === 0 || traceIndexByNodeId.size === 0) return steps;

  const formatIndexedTraceLabel = (label?: string, nodeId?: string): string => {
    const rawLabel = String(label || '').trim();
    if (!rawLabel || !isTraceLike(rawLabel)) return rawLabel;
    const fallbackIndex = nodeId ? traceIndexByNodeId.get(String(nodeId || '').trim()) : undefined;
    return formatTraceSurfaceForDisplayValue(rawLabel, fallbackIndex || extractMovementIndex(rawLabel));
  };

  return steps.map((step) => {
    const nextTargetLabel = formatIndexedTraceLabel(step.targetLabel, step.targetNodeId) || step.targetLabel;
    const nextSourceLabels = Array.isArray(step.sourceLabels)
      ? step.sourceLabels.map((label, index) =>
          formatIndexedTraceLabel(label, step.sourceNodeIds?.[index]) || label
        )
      : step.sourceLabels;
    const labelsChanged =
      nextTargetLabel !== step.targetLabel
      || JSON.stringify(nextSourceLabels || []) !== JSON.stringify(step.sourceLabels || []);
    const nextRecipe = labelsChanged
      ? buildStructuralReplayFallback(step.operation, nextTargetLabel, nextSourceLabels || [])
      : step.recipe;

    return {
      ...step,
      targetLabel: nextTargetLabel,
      sourceLabels: nextSourceLabels,
      recipe: nextRecipe
    };
  });
};

export const applyPreFrontingSentenceInitialCasing = (
  steps: PlaybackStep[],
  sentence: string
): PlaybackStep[] => {
  const firstSentenceToken = String(tokenizeReplaySentenceSurface(sentence)[0] || '').trim();
  return firstSentenceToken
    ? normalizeReplaySentenceInitialCasing(steps, firstSentenceToken)
    : steps;
};
export const buildNodeStepIndex = (steps: PlaybackStep[]): Map<string, number> => {
  return new Map(steps.map((step, idx) => [step.targetNodeId, idx]));
};

export const buildFirstRevealNodeStepIndex = (steps: PlaybackStep[]): Map<string, number> => {
  const stepIndex = new Map<string, number>();
  steps.forEach((step, idx) => {
    const nodeId = String(step?.targetNodeId || '').trim();
    if (!nodeId || stepIndex.has(nodeId)) return;
    stepIndex.set(nodeId, idx);
  });
  return stepIndex;
};

const resolveMovementStepForLink = (
  link: ResolvedRelationLink,
  nodeStepIndex: Map<string, number>,
  lastStep: number
): number | undefined => {
  const sourceNodeId = String(link.sourceNodeId || '').trim();
  const targetNodeId = String(link.targetNodeId || '').trim();
  const traceNodeId = String(link.witnessNodeId || '').trim();
  const sourceStep = sourceNodeId ? nodeStepIndex.get(sourceNodeId) : undefined;
  const targetStep = targetNodeId ? nodeStepIndex.get(targetNodeId) : undefined;
  const traceStep = traceNodeId ? nodeStepIndex.get(traceNodeId) : undefined;

  const rawStep = Number(link.stepIndex);
  const explicitStep = Number.isInteger(rawStep) && rawStep >= 0 ? Math.min(rawStep, lastStep) : undefined;
  const anchoredCandidates = [sourceStep, targetStep, traceStep].filter((step): step is number => step !== undefined);
  const anchoredStep = anchoredCandidates.length > 0 ? Math.max(...anchoredCandidates) : undefined;

  if (anchoredStep !== undefined && explicitStep !== undefined) {
    return Math.max(explicitStep, anchoredStep);
  }
  if (anchoredStep !== undefined) return anchoredStep;
  if (explicitStep !== undefined) return explicitStep;

  return undefined;
};

const resolveVisibleMovementTargetNode = (
  nodeById: Map<string, HierNode>,
  link: ResolvedRelationLink
): HierNode | undefined => nodeById.get(String(link?.targetNodeId || '').trim());

export const buildDisplayRelationLinks = (
  resolvedRelationLinks: ResolvedRelationLink[] | undefined
): ResolvedRelationLink[] =>
  (resolvedRelationLinks || []).map((link) => ({
    ...link,
    relationIndex: String(link?.relationIndex || '').trim(),
    relation: String(link?.relation || link?.operation || '').trim() || undefined,
    sourceNodeId: String(link?.sourceNodeId || '').trim(),
    targetNodeId: String(link?.targetNodeId || '').trim(),
    witnessNodeId: String(link?.witnessNodeId || '').trim() || undefined,
    renderFamily: link?.renderFamily || 'trajectory',
    trajectoryKind: normalizeTrajectoryKind(link?.trajectoryKind) || undefined,
    chainId: String(link?.chainId || '').trim() || undefined
  }));

export const buildMovementArrowsFromLinks = (
  visibleNodes: HierNode[],
  resolvedRelationLinks: ResolvedRelationLink[] | undefined,
  nodeStepIndex: Map<string, number>,
  playbackSteps: PlaybackStep[]
): MovementArrow[] => {
  if (!resolvedRelationLinks || resolvedRelationLinks.length === 0) return [];

  const nodeById = new Map(visibleNodes.map((node) => [getNodeId(node), node]));
  const pickTraceLikeLeafDescendant = (node?: HierNode): HierNode | undefined => {
    if (!node) return undefined;
    return node
      .descendants()
      .find((candidate) => isNotationLeaf(candidate.data));
  };
  /*
   * The fail-closed endpoint law, preserving Babel's established head-versus-
   * phrasal endpoint convention.
   *
   * - Phrasal movement departs from the authored lower trace TERMINAL (the
   *   witness's display leaf) and lands on the authored landing PHRASE SHELL.
   *   A phrasal link without a resolvable witness draws nothing — no other
   *   leaf or shell is ever substituted.
   * - Head movement (including reverse-direction head lowering) runs
   *   terminal-to-terminal: from the trace terminal to the pronounced head
   *   terminal, never a C/T/V preterminal shell.
   *
   * The only descent permitted is display resolution *inside the anchored
   * node's own subtree*: an authored anchor often names a preterminal whose
   * visible word replay materialized as a terminal child, and resolving that
   * child is deterministic interpretation of the same authored anchor. The
   * old ladder — any trace-like leaf anywhere, else any overt leaf, else an
   * ancestor phrase shell — chose endpoints the analysis never pointed at,
   * and is gone.
   */
  const pickOvertLeafDescendant = (node?: HierNode): HierNode | undefined => {
    if (!node) return undefined;
    return node
      .descendants()
      .find((candidate) => isLexicalLeaf(candidate.data));
  };
  const resolveWitnessDisplayLeaf = (node?: HierNode): HierNode | undefined => {
    if (!node) return undefined;
    return pickTraceLikeLeafDescendant(node) || node;
  };
  const resolveHeadTerminalDisplayLeaf = (
    node?: HierNode,
    preferTrace = false
  ): HierNode | undefined => {
    if (!node) return undefined;
    if (!(node.children || []).length) return node;
    return preferTrace
      ? (pickTraceLikeLeafDescendant(node) || pickOvertLeafDescendant(node))
      : (pickOvertLeafDescendant(node) || pickTraceLikeLeafDescendant(node));
  };
  const displayLinks = buildDisplayRelationLinks(resolvedRelationLinks);
  const arrows: MovementArrow[] = [];
  const seen = new Set<string>();
  const lastStep = playbackSteps.length > 0 ? playbackSteps.length - 1 : 0;

  displayLinks.filter(isResolvedMovementLink).forEach((link) => {
    const rawSource = nodeById.get(String(link.sourceNodeId || '').trim());
    const rawTarget = resolveVisibleMovementTargetNode(nodeById, link);
    const authoredWitnessId = String(link.witnessNodeId || '').trim();
    const rawTraceNode = authoredWitnessId
      ? nodeById.get(authoredWitnessId) || undefined
      : undefined;
    // An authored witness that does not resolve fails the arrow closed.
    if (authoredWitnessId && !rawTraceNode) return;
    const traceLeaf = rawTraceNode ? pickTraceLikeLeafDescendant(rawTraceNode) : undefined;
    const traceNode = traceLeaf || rawTraceNode;
    const linkLooksHeadLike = isHeadLikeResolvedRelation(link, nodeById);
    /*
     * Head movement runs terminal-to-terminal: the trace terminal (witness
     * first, else the source anchor's own display terminal) to the pronounced
     * head terminal inside the authored target — never a preterminal shell.
     * Phrasal movement departs from the witness's trace terminal and lands on
     * the authored landing phrase shell; without a resolvable witness the
     * phrasal drawing is refused rather than repaired from another node.
     */
    const displaySource = linkLooksHeadLike
      ? (resolveWitnessDisplayLeaf(rawTraceNode) || resolveHeadTerminalDisplayLeaf(rawSource, true))
      : resolveWitnessDisplayLeaf(rawTraceNode);
    const displayTarget = linkLooksHeadLike
      ? resolveHeadTerminalDisplayLeaf(rawTarget)
      : rawTarget;
    if (!displaySource || !displayTarget) return;
    const sourceId = getNodeId(displaySource);
    const targetId = getNodeId(displayTarget);
    if (sourceId === targetId) return;

    const key = `${sourceId}->${targetId}`;
    if (seen.has(key)) return;
    seen.add(key);

    const step = resolveMovementStepForLink(
      {
        ...link,
        sourceNodeId: sourceId,
        targetNodeId: targetId,
        witnessNodeId: traceNode ? getNodeId(traceNode) : undefined
      },
      nodeStepIndex,
      lastStep
    );
    if (step === undefined) return;
    arrows.push({
      source: displaySource,
      sourceOccurrence: rawSource,
      target: displayTarget,
      traceNode: traceNode || undefined,
      step,
      index: null,
      operation: link.operation,
      trajectoryKind: normalizeTrajectoryKind(link.trajectoryKind) || (linkLooksHeadLike ? 'head' : 'phrasal')
    });
  });

  const arrowsByDisplayOrder = [...arrows].sort((a, b) => {
    if (a.step !== b.step) return a.step - b.step;
    const aSourceY = Number(a.source?.y || 0);
    const bSourceY = Number(b.source?.y || 0);
    if (aSourceY !== bSourceY) return bSourceY - aSourceY;
    const aSourceX = Number(a.source?.x || 0);
    const bSourceX = Number(b.source?.x || 0);
    if (aSourceX !== bSourceX) return aSourceX - bSourceX;
    const aTargetX = Number(a.target?.x || 0);
    const bTargetX = Number(b.target?.x || 0);
    return aTargetX - bTargetX;
  });
  const arrowParent = new Map<string, string>();
  const findArrowRoot = (nodeId: string): string => {
    const currentParent = arrowParent.get(nodeId);
    if (!currentParent) {
      arrowParent.set(nodeId, nodeId);
      return nodeId;
    }
    if (currentParent === nodeId) return nodeId;
    const root = findArrowRoot(currentParent);
    arrowParent.set(nodeId, root);
    return root;
  };
  const unionArrowNodes = (left: string, right: string) => {
    if (!left || !right) return;
    const leftRoot = findArrowRoot(left);
    const rightRoot = findArrowRoot(right);
    if (leftRoot !== rightRoot) arrowParent.set(rightRoot, leftRoot);
  };
  arrowsByDisplayOrder.forEach((arrow) => {
    const sourceOccurrenceId = arrow.sourceOccurrence
      ? getNodeId(arrow.sourceOccurrence)
      : getNodeId(arrow.source);
    unionArrowNodes(sourceOccurrenceId, getNodeId(arrow.target));
  });
  const displayIndexByComponent = new Map<string, string>();
  /*
   * Chain indices express authored relation order, not where a source happens
   * to land on the canvas. Keep the spatial sort for painting only; assigning
   * numbers from it reverses nested remnant, roll-up, and smuggling chains.
   */
  arrows.forEach((arrow) => {
    const sourceOccurrenceId = arrow.sourceOccurrence
      ? getNodeId(arrow.sourceOccurrence)
      : getNodeId(arrow.source);
    const root = findArrowRoot(sourceOccurrenceId);
    if (!displayIndexByComponent.has(root)) {
      displayIndexByComponent.set(root, String(displayIndexByComponent.size + 1));
    }
    arrow.index = displayIndexByComponent.get(root) || '1';
  });

  return arrows;
};

const collectHierarchyLineageIds = (root?: HierNode): Set<string> => new Set(
  (root ? root.descendants() : [])
    .map((candidate) => String(candidate.data?.lineageId || '').trim())
    .filter(Boolean)
);

const collectHierarchyLineageContext = (node: HierNode): Set<string> => {
  const lineageIds = new Set<string>();
  let current: HierNode | null = node;
  while (current) {
    const lineageId = String(current.data?.lineageId || '').trim();
    if (lineageId) lineageIds.add(lineageId);
    current = current.parent;
  }
  return lineageIds;
};

/**
 * Resolve each silent terminal to the smallest moved constituent that owns its
 * lineage. A larger remnant/carrier movement must not overwrite a nested
 * object's chain number, while a later movement of that nested object must
 * update every occurrence of its own lineage.
 */
export const buildMovementCopyTraceIndexByTerminalId = (
  movementArrows: MovementArrow[]
): Map<string, string> => {
  const traceIndexByTerminalId = new Map<string, string>();
  const phrasalArrows = movementArrows.filter((arrow) =>
    normalizeTrajectoryKind(arrow.trajectoryKind) === 'phrasal'
  );
  const candidates: MovementCopyTraceCandidate[] = [];

  phrasalArrows.forEach((arrow, authoredOrder) => {
    const sourceOccurrence = arrow.sourceOccurrence;
    if (!sourceOccurrence || !(sourceOccurrence.children || []).length) return;
    const lexicalLeaves = sourceOccurrence.descendants().filter((candidate) => isLexicalLeaf(candidate.data));
    if (lexicalLeaves.length === 0) return;
    const whollySilentLexicalCopy = lexicalLeaves.every((leaf) => {
      let current: HierNode | null = leaf;
      while (current) {
        if ((current.data as SyntaxNode)?.silent === true || (current.data as any)?.ghost === true) {
          return true;
        }
        if (current === sourceOccurrence) break;
        current = current.parent;
      }
      return false;
    });
    if (!whollySilentLexicalCopy) return;

    const sourceLineageIds = collectHierarchyLineageIds(sourceOccurrence);
    const targetLineageIds = collectHierarchyLineageIds(arrow.target);
    const commonLineageIds = new Set(
      Array.from(sourceLineageIds).filter((lineageId) => targetLineageIds.has(lineageId))
    );
    candidates.push({
      arrow,
      authoredOrder,
      commonLineageIds,
      sourceNodeCount: sourceOccurrence.descendants().length,
      lexicalLeaves
    });
  });

  const eligibleLeaves = new Map<string, HierNode>();
  candidates.forEach((candidate) => {
    candidate.lexicalLeaves.forEach((leaf) => eligibleLeaves.set(getNodeId(leaf), leaf));
  });
  eligibleLeaves.forEach((leaf, leafId) => {
    const lineageContext = collectHierarchyLineageContext(leaf);
    const matchingCandidates = candidates.filter((candidate) => (
      candidate.lexicalLeaves.some((candidateLeaf) => getNodeId(candidateLeaf) === leafId)
      || Array.from(lineageContext).some((lineageId) => candidate.commonLineageIds.has(lineageId))
    ));
    matchingCandidates.sort((left, right) => (
      left.sourceNodeCount - right.sourceNodeCount
      || left.commonLineageIds.size - right.commonLineageIds.size
      || left.authoredOrder - right.authoredOrder
    ));
    const chosen = matchingCandidates[0];
    const index = normalizeTraceIndexForDisplay(chosen?.arrow.index) || '';
    if (chosen && index) traceIndexByTerminalId.set(leafId, index);
  });

  return traceIndexByTerminalId;
};

export const formatOperationLabel = (operation?: DerivationOperation): string => {
  if (!operation) return 'Derivation';
  if (operation === 'Other') return 'Derivation';
  if (operation === 'LexicalSelect') return 'Select';
  if (operation === 'HeadMove') return 'Head Movement';
  if (operation === 'A-Move') return 'A-Movement';
  if (operation === 'AbarMove') return 'A-bar Move';
  if (operation === 'ExternalMerge') return 'External Merge';
  if (operation === 'InternalMerge') return 'Internal Merge';
  if (operation === 'StageRecord') return 'Stage Record';
  return String(operation);
};

export const formatPlaybackOperationTitle = (step?: PlaybackStep | null): string => {
  if (step?.replayKind === 'relation') return String(step.operation || '');
  const operation = formatOperationLabel(step?.operation);
  const target = String(step?.targetLabel || '').trim();
  return target && (step?.operation === 'LexicalSelect' || step?.operation === 'Project')
    ? `${operation} ${target}`
    : operation;
};

const REPLAY_IDENTIFIER_OVERRIDES: Record<string, string> = {
  chain_wh: 'Wh',
  chain_subj: 'Subject',
  chain_v_to_c: 'V to C',
  dp_obj: 'object DP',
  dp_subj: 'subject DP',
  infl_p: 'InflP',
  foc_p: 'FocP',
  phase_edge: 'Phase edge',
  'phase-edge': 'Phase edge'
};

const REPLAY_STRUCTURAL_IDENTIFIER_MAP: Record<string, string> = {
  c: 'C',
  cp: 'CP',
  d: 'D',
  dp: 'DP',
  foc: 'Foc',
  focp: 'FocP',
  infl: 'Infl',
  inflp: 'InflP',
  ip: 'IP',
  n: 'N',
  np: 'NP',
  prt: 'Prt',
  t: 'T',
  tp: 'TP',
  v: 'v',
  vp: 'vP',
  wh: 'Wh'
};

const toReplayTitleCase = (value?: string): string =>
  String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (/^[A-Z]{2,}$/.test(word)) return word;
      const lower = word.toLowerCase();
      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join(' ');

const splitReplayPrimeSuffix = (value?: string): { core: string; suffix: string } => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return { core: '', suffix: '' };
  const match = trimmed.match(/^(.*?)(['′]+)$/);
  if (!match) return { core: trimmed, suffix: '' };
  return {
    core: String(match[1] || '').trim(),
    suffix: match[2]
  };
};

const preserveCommittedReplayLabelCasing = (value?: string): string => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/^[A-Z]$/.test(trimmed)) return trimmed;
  if (/^[A-Z]{2,}$/.test(trimmed)) return trimmed;
  if (/[A-Z]/.test(trimmed.slice(1))) return trimmed;
  return '';
};

const formatReplayIdentifierWord = (value?: string): string => {
  const { core, suffix } = splitReplayPrimeSuffix(value);
  const trimmed = core;
  if (!trimmed) return suffix;
  const preserved = preserveCommittedReplayLabelCasing(trimmed);
  if (preserved) return `${preserved}${suffix}`;
  const normalized = trimmed.toLowerCase();
  if (REPLAY_IDENTIFIER_OVERRIDES[normalized]) return `${REPLAY_IDENTIFIER_OVERRIDES[normalized]}${suffix}`;
  if (REPLAY_STRUCTURAL_IDENTIFIER_MAP[normalized]) return `${REPLAY_STRUCTURAL_IDENTIFIER_MAP[normalized]}${suffix}`;
  if (/^\d+$/.test(trimmed)) return `${trimmed}${suffix}`;
  if (normalized === 'obj') return `object${suffix}`;
  if (normalized === 'subj') return `subject${suffix}`;
  if (normalized === 'wh') return `wh${suffix}`;
  if (normalized === 'to') return `to${suffix}`;
  if (trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) return `${trimmed}${suffix}`;
  if (/^[A-Z][a-z]+$/.test(trimmed)) return `${trimmed}${suffix}`;
  return `${trimmed.toLowerCase()}${suffix}`;
};

const formatReplayIdentifier = (value?: string): string => {
  const { core, suffix } = splitReplayPrimeSuffix(value);
  const trimmed = core;
  if (!trimmed) return suffix;
  const preserved = preserveCommittedReplayLabelCasing(trimmed);
  if (preserved) return `${preserved}${suffix}`;
  const normalized = trimmed.toLowerCase();
  if (REPLAY_IDENTIFIER_OVERRIDES[normalized]) return `${REPLAY_IDENTIFIER_OVERRIDES[normalized]}${suffix}`;
  if (REPLAY_STRUCTURAL_IDENTIFIER_MAP[normalized]) return `${REPLAY_STRUCTURAL_IDENTIFIER_MAP[normalized]}${suffix}`;
  const parts = trimmed.split(/[_-]+/).filter(Boolean);
  if (parts.length === 1) return formatReplayIdentifierWord(`${trimmed}${suffix}`);
  const joined = parts.map((part) => formatReplayIdentifierWord(part)).join(' ');
  const cased = /^[a-z]/.test(joined) ? joined : toReplayTitleCase(joined);
  return `${cased}${suffix}`;
};

export const formatReplayBlockTitle = (title?: string): string => {
  return String(title ?? '');
};

export const formatReplayBlockLine = (
  _title: string,
  line: string,
  _steps: PlaybackStep[] = []
): string => {
  return String(line ?? '');
};

const normalizeReplayBlockTitleKey = (title?: string): string =>
  String(title || '').trim().toUpperCase();

const normalizeReplayTargetLabel = (label?: string): string =>
  String(label || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

const isGenericReplayStructuralLabel = (label?: string): boolean => {
  const normalized = normalizeReplayTargetLabel(label);
  if (!normalized) return true;
  return new Set([
    'WORKSPACE',
    'CP',
    'C',
    'TP',
    'T',
    "T'",
    'TBAR',
    'VP',
    'V',
    "V'",
    'VBAR',
    'DP',
    'D',
    "D'",
    'DBAR',
    'NP',
    'N',
    "N'",
    'NBAR',
    'PP',
    'P',
    "P'",
    'PBAR',
    'IP',
    'FP',
    'XP'
  ]).has(normalized);
};

const formatReplaySupportValue = (value?: string): string =>
  String(value ?? '').trim();

const normalizeReplayInventoryLabel = (value?: string): string =>
  normalizeReplayTargetLabel(value).replace(/['′]+/g, '');

const detectReplayInflectionInventory = (steps: PlaybackStep[] = []): 't' | 'infl' | null => {
  const labels = new Set<string>();
  steps.forEach((step) => {
    [step?.targetLabel, ...(Array.isArray(step?.sourceLabels) ? step.sourceLabels : [])]
      .map((label) => normalizeReplayInventoryLabel(label))
      .filter(Boolean)
      .forEach((label) => labels.add(label));
  });
  const usesT = labels.has('T') || labels.has('TP');
  const usesInfl = labels.has('INFL') || labels.has('INFLP') || labels.has('IP');
  if (usesT && !usesInfl) return 't';
  if (usesInfl && !usesT) return 'infl';
  return null;
};

const normalizeReplayTextForCommittedInventory = (
  value?: string,
  steps: PlaybackStep[] = []
): string => {
  const text = String(value || '');
  if (!text) return '';
  const inventory = detectReplayInflectionInventory(steps);
  if (inventory === 't') {
    return text
      .replace(/\bInflP\b/gi, 'TP')
      .replace(/\bIP\b/g, 'TP')
      .replace(/\bInfl\b/gi, 'T');
  }
  if (inventory === 'infl') {
    return text
      .replace(/\bTP\b/g, 'InflP')
      .replace(/\bT\b/g, 'Infl');
  }
  return text;
};

const findReplayNodePathById = (
  root: SyntaxNode | null | undefined,
  nodeId: string,
  trail: SyntaxNode[] = []
): SyntaxNode[] | null => {
  if (!root || !nodeId) return null;
  const currentTrail = [...trail, root];
  if (String(root.id || '').trim() === nodeId) return currentTrail;
  const children = Array.isArray(root.children) ? root.children : [];
  for (const child of children) {
    const match = findReplayNodePathById(child, nodeId, currentTrail);
    if (match) return match;
  }
  return null;
};

const describeReplayNodePosition = (
  root: SyntaxNode | null | undefined,
  nodeId?: string
): string => {
  const normalizedNodeId = String(nodeId || '').trim();
  if (!root || !normalizedNodeId) return '';
  const path = findReplayNodePathById(root, normalizedNodeId);
  if (!path || path.length === 0) return '';

  let node = path[path.length - 1];
  let parent = path[path.length - 2];
  const grandparent = path[path.length - 3];
  const parentLabelRaw = String(parent?.label || '').trim();
  const nodeLabelRaw = String(node?.label || '').trim();
  if (
    parent
    && grandparent
    && parentLabelRaw
    && nodeLabelRaw
    && normalizeReplayTargetLabel(parentLabelRaw) === normalizeReplayTargetLabel(nodeLabelRaw)
  ) {
    node = parent;
    parent = grandparent;
  }
  const nodeLabel = formatReplaySupportValue(node?.label);
  if (!parent) return nodeLabel;

  const parentLabel = formatReplaySupportValue(parent?.label);
  const parentChildren = Array.isArray(parent?.children) ? parent.children : [];
  const childIndex = parentChildren.findIndex((child) => String(child?.id || '').trim() === normalizedNodeId);
  const sibling = childIndex >= 0
    ? parentChildren.find((_, index) => index !== childIndex)
    : null;
  const siblingLabel = formatReplaySupportValue(sibling?.label);
  const { core: parentCore, suffix: parentSuffix } = splitReplayPrimeSuffix(parentLabel);
  const parentHasPrime = Boolean(parentSuffix);
  const parentIsMaxProjection = /P$/i.test(parentCore);
  const siblingLooksLikeProjection = Boolean(siblingLabel) && (/[P]$/i.test(splitReplayPrimeSuffix(siblingLabel).core) || /['′]+$/.test(siblingLabel));

  if (childIndex === 0 && parentIsMaxProjection && siblingLooksLikeProjection) {
    return `Spec,${parentLabel}`;
  }
  if (childIndex === 1 && parentHasPrime) {
    return `complement of ${parentCore}`;
  }
  if (childIndex === 0 && parentHasPrime) {
    return nodeLabel || `head of ${parentCore}`;
  }
  return parentLabel ? `${nodeLabel || 'node'} in ${parentLabel}` : nodeLabel;
};

const formatReplayInputsValue = (labels?: string[]): string =>
  (Array.isArray(labels) ? labels : [])
    .map((label) => formatReplaySupportValue(label))
    .filter(Boolean)
    .join(' + ');

const getReplayNodeDisplayFromCanvas = (
  root: SyntaxNode | null | undefined,
  nodeId?: string
): string => {
  const normalizedNodeId = String(nodeId || '').trim();
  if (!root || !normalizedNodeId) return '';
  const node = findNodeByIdInForest([root], normalizedNodeId);
  if (!node) return '';
  const label = formatReplaySupportValue(String(node.label || '').trim());
  if (isTraceOrNullLikeNode(node)) return label;
  const overtYield: string[] = [];
  const collectSurfaceLeaves = (candidate?: SyntaxNode | null) => {
    if (!candidate || typeof candidate !== 'object') return;
    if ((candidate as any).silent === true) return;
    const children = Array.isArray(candidate.children) ? candidate.children : [];
    if (children.length === 0) {
      if (isTraceOrNullLikeNode(candidate)) return;
      const fallbackLeafSurface = authoredWord(candidate);
      const surface = formatReplaySupportValue(fallbackLeafSurface);
      if (surface) overtYield.push(surface);
      return;
    }
    children.forEach((child) => collectSurfaceLeaves(child));
  };
  collectSurfaceLeaves(node);
  const uniqueYield = Array.from(new Set(overtYield));
  if (uniqueYield.length === 1 && label && normalizeReplayTargetLabel(uniqueYield[0]) !== normalizeReplayTargetLabel(label)) {
    return `${uniqueYield[0]} (${label})`;
  }
  return uniqueYield[0] || label;
};

const getReplayNodeOvertYieldFromCanvas = (
  root: SyntaxNode | null | undefined,
  nodeId?: string
): string => {
  const normalizedNodeId = String(nodeId || '').trim();
  if (!root || !normalizedNodeId) return '';
  const node = findNodeByIdInForest([root], normalizedNodeId);
  if (!node || isTraceOrNullLikeNode(node)) return '';
  const overtYield: string[] = [];
  const collectSurfaceLeaves = (candidate?: SyntaxNode | null) => {
    if (!candidate || typeof candidate !== 'object') return;
    if ((candidate as any).silent === true) return;
    const children = Array.isArray(candidate.children) ? candidate.children : [];
    if (children.length === 0) {
      if (isTraceOrNullLikeNode(candidate)) return;
      const fallbackLeafSurface = authoredWord(candidate);
      const surface = formatReplaySupportValue(fallbackLeafSurface);
      if (surface) overtYield.push(surface);
      return;
    }
    children.forEach((child) => collectSurfaceLeaves(child));
  };
  collectSurfaceLeaves(node);
  return overtYield.join(' ').trim();
};

const getReplayNodeAuthoredYieldFromCanvas = (
  root: SyntaxNode | null | undefined,
  nodeId?: string
): string => {
  const normalizedNodeId = String(nodeId || '').trim();
  if (!root || !normalizedNodeId) return '';
  const node = findNodeByIdInForest([root], normalizedNodeId);
  if (!node || isTraceOrNullLikeNode(node)) return '';
  const surfaces: string[] = [];
  const seenLineages = new Set<string>();
  const collectSurfaceLeaves = (candidate?: SyntaxNode | null) => {
    if (!candidate || typeof candidate !== 'object') return;
    const children = Array.isArray(candidate.children) ? candidate.children : [];
    if (children.length > 0) {
      children.forEach((child) => collectSurfaceLeaves(child));
      return;
    }
    if (isTraceOrNullLikeNode(candidate)) return;
    const lineageId = String(candidate.lineageId || '').trim();
    if (lineageId && seenLineages.has(lineageId)) return;
    const fallbackLeafSurface = authoredWord(candidate);
    const surface = formatReplaySupportValue(fallbackLeafSurface);
    if (!surface) return;
    if (lineageId) seenLineages.add(lineageId);
    surfaces.push(surface);
  };
  collectSurfaceLeaves(node);
  return surfaces.join(' ').trim();
};

const getReplayNodeCategoryFromCanvas = (
  root: SyntaxNode | null | undefined,
  nodeId?: string
): string => {
  const normalizedNodeId = String(nodeId || '').trim();
  if (!root || !normalizedNodeId) return '';
  const node = findNodeByIdInForest([root], normalizedNodeId);
  if (!node) return '';
  return formatReplaySupportValue(String(node.label || '').trim());
};

const getFrameDetailsRecord = (frame?: ReplayDerivationFrame | null): Record<string, unknown> => (
  frame?.change?.details && typeof frame.change.details === 'object' && !Array.isArray(frame.change.details)
    ? frame.change.details as Record<string, unknown>
    : {}
);

const getFrameStageRecordText = (
  frame?: ReplayDerivationFrame | null,
  plannedStage?: DerivationReplayPlanStage | null
): string => {
  const details = getFrameDetailsRecord(frame);
  return String(
    plannedStage?.stageRecord
    || details.stageRecord
    || ''
  ).trim();
};

const getAuthoredFrameRelations = (
  frame?: ReplayDerivationFrame | null,
  plannedStage?: DerivationReplayPlanStage | null
): DerivationReplayPlanStep[] => {
  const plannedRelations = Array.isArray(plannedStage?.relationSteps) ? plannedStage.relationSteps : [];
  if (plannedRelations.length > 0) return plannedRelations;
  const details = getFrameDetailsRecord(frame);
  const workspaceForest = Array.isArray(frame?.workspaceForest)
    ? frame.workspaceForest
    : Array.isArray(frame?.after?.workspaceForest)
      ? frame.after.workspaceForest
      : [];
  const relations = Array.isArray(details.derivationStageRelations)
    ? details.derivationStageRelations
    : [];
  return relations
    .map<DerivationReplayPlanStep | null>((relation, authoredRelationIndex) => {
      if (!relation || typeof relation !== 'object') return null;
      const relationRecord = relation as Record<string, unknown>;
      const label = String(relationRecord.relation || '').trim();
      const anchors = relationRecord.anchors && typeof relationRecord.anchors === 'object' && !Array.isArray(relationRecord.anchors)
        ? relationRecord.anchors as Record<string, unknown>
        : {};
      if (!label) return null;
      const priorAnchors = relationRecord.priorAnchors && typeof relationRecord.priorAnchors === 'object' && !Array.isArray(relationRecord.priorAnchors)
        ? relationRecord.priorAnchors as Record<string, string | string[]>
        : undefined;
      const values = relationRecord.values && typeof relationRecord.values === 'object' && !Array.isArray(relationRecord.values)
        ? relationRecord.values as Record<string, string | string[]>
        : undefined;
      return {
        kind: 'relation',
        relation: label,
        anchors,
        ...(priorAnchors ? { priorAnchors } : {}),
        ...(values ? { values } : {}),
        authoredRelationIndex,
        ...(() => {
          const { resolved, unresolved } = classifyRelationAnchors(anchors, workspaceForest);
          return {
            resolvedAnchors: resolved,
            ...(unresolved.length > 0 ? { unresolvedAnchors: unresolved } : {})
          };
        })()
      } satisfies DerivationReplayPlanStep;
    })
    .filter((relation): relation is DerivationReplayPlanStep => relation !== null);
};

export const getFrameRelations = (
  frame?: ReplayDerivationFrame | null,
  plannedStage?: DerivationReplayPlanStage | null,
  previousForest: SyntaxNode[] = []
): DerivationReplayPlanStep[] => {
  const currentForest = frame?.workspaceForest || frame?.after?.workspaceForest || [];
  const authored = getAuthoredFrameRelations(frame, plannedStage).map((authoredStep, relationIndex) => {
    const unresolved = Array.isArray(authoredStep.unresolvedAnchors) ? authoredStep.unresolvedAnchors : [];
    if (unresolved.length === 0) return authoredStep;
    // The relation keeps its Replay moment. Each missing witness is named at
    // its authored field so the reader sees exactly what did not resolve.
    const stageNumber = (plannedStage?.stageIndex ?? 0) + 1;
    const relationNumber = (authoredStep.authoredRelationIndex ?? relationIndex) + 1;
    return {
      ...authoredStep,
      movementDiagnostics: unresolved.map((anchor) =>
        `RELATION_ANCHOR_UNRESOLVED: Stage ${stageNumber}, relation ${relationNumber} (${authoredStep.relation}) ${anchor.fieldPath} names ${JSON.stringify(anchor.nodeId)}, which is not in this stage's expanded workspace. The anchor was not replaced; the relation is shown without it.`)
    };
  });
  const recovered = authored.map((authoredStep, relationIndex) => {
    const input = {
      relation: authoredStep as DerivationStageRelation,
      currentForest, priorForest: previousForest,
      stageIndex: plannedStage?.stageIndex ?? 0, relationIndex
    };
    const dispatch = dispatchRelationClaims(input);
    const evidence = dispatch.evidence;
    const interpretedStep = dispatch.primaryClaim?.tier === 3 ? {
      ...authoredStep,
      neutralTransitionEvidence: {
        anchors: dispatch.primaryRelation.anchors,
        priorAnchors: dispatch.primaryRelation.priorAnchors
      }
    } : authoredStep;
    const boundStep = dispatch.primaryClaim?.tier === 1 ? {
      ...interpretedStep,
      registeredEntryId: dispatch.primaryClaim.registryEntryId,
      resolvedAnchors: authoredStep.resolvedAnchors?.map(anchor => {
        const binding = dispatch.tier1Dispatch.roleBindings.find(binding =>
          binding.field === 'anchors' && binding.authoredRole === anchor.role);
        return binding && binding.role !== anchor.role
          ? { ...anchor, role: binding.role, authoredRole: anchor.role } : anchor;
      })
    } : interpretedStep;
    const pronunciationNodeIds = dispatch.primaryClaim?.tier === 1
      && PRODUCTION_RENDER_FAMILIES[dispatch.primaryClaim.registryEntryId]?.transitionKinds?.includes('pronunciation')
      ? relationAnchorNodeIds(dispatch.boundPrimaryRelation.anchors)
      : dispatch.facets.some(f => f.recipe.id === 'pf.structured' || f.recipe.id === 'pf.rewrite')
        ? [...(evidence.currentAnchors['rewrite.output'] || [])] : [];
    const step = pronunciationNodeIds.length ? { ...boundStep, pronunciationNodeIds } : boundStep;
    const registeredEntry = findRelationRegistryEntry(productionRelationRegistry, String(step.relation || ''));
    const facet = dispatch.facets.find(f => f.recipe.id === 'movement.path' || f.recipe.id === 'scope.movement');
    const covert = facet?.recipe.id === 'scope.movement';
    if (registeredEntry && !PRODUCTION_RENDER_FAMILIES[registeredEntry.id]?.trajectoryKind && !facet) return step;
    const { movementDiagnostics } = evidence;
    const movement: RecoveredMovement | undefined = covert ? {
      priorSourceNodeId: evidence.currentAnchors['scope.source'][0],
      sourceNodeId: evidence.currentAnchors['scope.source'][0],
      targetNodeId: evidence.currentAnchors['scope.landing'][0],
      witnessNodeId: evidence.currentAnchors['scope.source'][0],
      trajectoryKind: 'phrasal', transition: facet.evaluation.earnedTransitions.includes('movement'), roles: {}
    } : evidence.movement;
    const priorDiagnostics = [...(Array.isArray(step.movementDiagnostics) ? step.movementDiagnostics : []),
      ...(movementDiagnostics || [])];
    if (!movement) {
      return priorDiagnostics.length ? { ...step, movementDiagnostics: priorDiagnostics } : step;
    }
    // A proved tree transition and permission to draw a trajectory are separate.
    // Fallback may reveal the authored landing without rescuing a Tier 1 recipe.
    const registeredKind = registeredEntry ? PRODUCTION_RENDER_FAMILIES[registeredEntry.id]?.trajectoryKind : undefined;
    if ((registeredKind === 'head' || registeredKind === 'phrasal') && registeredKind !== movement.trajectoryKind) return {
      ...step,
      recoveredMovement: { ...movement, transition: false, drawTrajectory: false },
      movementDiagnostics: [...priorDiagnostics, `MOVEMENT_KIND_CONFLICT: ${step.relation} selects ${registeredKind} movement, but the anchored context was recovered as ${movement.trajectoryKind}. No recovered transition was applied.`]
    };
    const primaryMovement = dispatch.primaryClaim?.tier === 1 && registeredKind === movement.trajectoryKind;
    if (dispatch.primaryClaim?.tier === 1 && !primaryMovement) return step;
    const drawingDiagnostics = !facet && !primaryMovement ? [
        `Stage ${input.stageIndex + 1}, relation ${relationIndex + 1} (${step.relation}): movement endpoints ${movement.sourceNodeId} -> ${movement.targetNodeId} are identifiable, but the drawing was not licensed: ${dispatch.primaryClaim && 'reason' in dispatch.primaryClaim ? dispatch.primaryClaim.reason : 'no-movement-facet'}. The authored analysis is unchanged.`,
        ...(dispatch.tier1Dispatch.signatureIssues || []).map(issue =>
          `Tier 1 signature: ${JSON.stringify(issue)}`)
      ] : [];
    const transition = facet ? facet.evaluation.earnedTransitions.includes('movement') : movement.transition;
    return {
      ...step,
      ...((priorDiagnostics.length || drawingDiagnostics.length)
        ? { movementDiagnostics: [...priorDiagnostics, ...drawingDiagnostics] } : {}),
      recoveredMovement: { ...movement, transition, drawTrajectory: !covert && Boolean(facet || primaryMovement) },
      sourceNodeIds: [movement.sourceNodeId], targetNodeId: movement.targetNodeId
    };
  });
  return recovered;
};

/**
 * An authored relation owns a Replay moment whenever it has a name. Anchors
 * that fail to resolve are diagnosed on that moment; they do not erase it.
 */
export const isRenderableReplayRelation = (
  relation?: DerivationReplayPlanStep | null
): boolean => Boolean(String(relation?.relation || '').trim());

const getResolvedReplayRelationAnchors = (
  relation?: DerivationReplayPlanStep | null
): ReplayResolvedRelationAnchor[] => (
  Array.isArray(relation?.resolvedAnchors)
    ? relation.resolvedAnchors
        .filter((anchor) => Boolean(String(anchor?.nodeId || '').trim()))
        .map((anchor) => ({
          ...anchor,
          role: String(anchor.role || ''),
          nodeId: String(anchor.nodeId || '').trim()
        }))
    : []
);

const getRelationTargetNodeId = (
  relation?: DerivationReplayPlanStep | null
): string => String(relation?.targetNodeId || '').trim();

const getRelationSourceNodeIds = (
  relation?: DerivationReplayPlanStep | null
): string[] => (
  Array.isArray(relation?.sourceNodeIds)
    ? relation.sourceNodeIds
        .map((nodeId) => String(nodeId || '').trim())
        .filter(Boolean)
    : []
);

export const getRelationAllAnchorNodeIds = (
  relation?: DerivationReplayPlanStep | null
): string[] => getResolvedReplayRelationAnchors(relation)
  .map((anchor) => String(anchor.nodeId || '').trim())
  .filter(Boolean);

const findResolvedReplayAnchorByRoles = (
  anchors: ReplayResolvedRelationAnchor[],
  roles: readonly string[]
): ReplayResolvedRelationAnchor | undefined => {
  const wantedRoles = new Set(roles.map((role) => role.toLowerCase()));
  return anchors.find((anchor) => wantedRoles.has(String(anchor.role || '').trim().toLowerCase()));
};

const findResolvedReplayAnchorsByRoles = (
  anchors: ReplayResolvedRelationAnchor[],
  roles: readonly string[]
): ReplayResolvedRelationAnchor[] => {
  const wantedRoles = new Set(roles.map((role) => role.toLowerCase()));
  return anchors.filter((anchor) => wantedRoles.has(String(anchor.role || '').trim().toLowerCase()));
};

const relationAnchorsExistInForest = (
  forest: SyntaxNode[],
  targetNodeId: string,
  sourceNodeId: string
): boolean => (
  Boolean(targetNodeId)
  && Boolean(sourceNodeId)
  && Boolean(findExactNodeByIdInForest(forest, targetNodeId))
  && Boolean(findExactNodeByIdInForest(forest, sourceNodeId))
);

export const resolveRelationAnchorNodeId = (
  forest: SyntaxNode[],
  rawNodeId: string,
  _role: 'source' | 'target'
): string => {
  const requestedNodeId = String(rawNodeId || '').trim();
  if (!requestedNodeId) return '';
  const exactNode = findExactNodeByIdInForest(forest, requestedNodeId);
  return exactNode ? String(exactNode.id || requestedNodeId).trim() : '';
};

const getSharedAuthoredLineageIdentity = (
  forest: SyntaxNode[],
  anchorNodeIds: string[]
): string => {
  if (anchorNodeIds.length < 2) return '';
  const lineageSets = anchorNodeIds.map((nodeId) => {
    const lineageIds = new Set<string>();
    const visit = (node?: SyntaxNode | null) => {
      if (!node) return;
      const lineageId = String(node.lineageId || '').trim();
      if (lineageId) lineageIds.add(lineageId);
      (Array.isArray(node.children) ? node.children : []).forEach(visit);
    };
    visit(findExactNodeByIdInForest(forest, nodeId));
    return lineageIds;
  });
  const [firstLineages, ...remainingLineages] = lineageSets;
  const sharedLineages = Array.from(firstLineages)
    .filter((lineageId) => (
      remainingLineages.every((lineages) => lineages.has(lineageId))
    ))
    .sort();
  return sharedLineages.length > 0
    ? `identity:lineage:${sharedLineages.join('|')}`
    : '';
};

export const buildAuthoredRelationLinksForFrames = (
  frames: ReplayDerivationFrame[],
  replayPlan: DerivationReplayPlan | null | undefined,
  activeFrameIndex: number,
  forest: SyntaxNode[],
  currentFrameRelationLimit: number = Number.POSITIVE_INFINITY,
  frameRelations?: (frameIndex: number) => DerivationReplayPlanStep[]
): ResolvedRelationLink[] => {
  if (!Array.isArray(frames) || activeFrameIndex < 0) return [];
  const links: ResolvedRelationLink[] = [];

  for (let frameIndex = 0; frameIndex <= Math.min(activeFrameIndex, frames.length - 1); frameIndex += 1) {
    const relations = frameRelations?.(frameIndex)
      ?? getFrameRelations(frames[frameIndex], getReplayPlanStage(replayPlan, frameIndex), frames[frameIndex - 1]?.workspaceForest || []);
    const relationLimit = frameIndex === activeFrameIndex
      ? currentFrameRelationLimit
      : Number.POSITIVE_INFINITY;

    relations.forEach((relation, relationIndex) => {
      const authoredRelationIndex = Number.isInteger(relation.authoredRelationIndex)
        ? Number(relation.authoredRelationIndex)
        : relationIndex;
      if (authoredRelationIndex > relationLimit || !isRenderableReplayRelation(relation)) return;
      const relationLabel = String(relation.relation || '').trim();
      const resolvedAnchors = getResolvedReplayRelationAnchors(relation)
        .filter((anchor) => (
          Boolean(findExactNodeByIdInForest(forest, String(anchor.nodeId || '').trim()))
        ));
      if (resolvedAnchors.length === 0) return;
      const [firstAnchor, secondAnchor] = resolvedAnchors;
      const trajectoryKind = relation.recoveredMovement?.drawTrajectory === false
        ? '' : relation.recoveredMovement?.trajectoryKind || registeredTrajectoryDisplayKind(relationLabel, resolvedAnchors);
      const registeredTrajectoryCapability = Boolean(registeredTrajectoryDisplayKind(relationLabel));
      const registryEntry = findRelationRegistryEntry(productionRelationRegistry, relationLabel);
      const operatorVariableBinding = registryEntry?.id === 'scope.operator-variable';
      const movementRelation = Boolean(trajectoryKind);
      const registeredEndpointRoles = movementRelation
        || registeredTrajectoryCapability
        || operatorVariableBinding;
      const sourceAnchor = relation.recoveredMovement
        ? resolvedAnchors.find(a => a.nodeId === relation.recoveredMovement?.sourceNodeId)
        : registeredEndpointRoles
        ? findResolvedReplayAnchorByRoles(resolvedAnchors, TRAJECTORY_SOURCE_ROLES) || firstAnchor
        : firstAnchor;
      const targetAnchor = relation.recoveredMovement
        ? resolvedAnchors.find(a => a.nodeId === relation.recoveredMovement?.targetNodeId)
        : registeredEndpointRoles
        ? findResolvedReplayAnchorByRoles(resolvedAnchors, TRAJECTORY_TARGET_ROLES) || secondAnchor
        : secondAnchor;
      const witnessAnchor = relation.recoveredMovement
        ? resolvedAnchors.find(a => a.nodeId === relation.recoveredMovement?.witnessNodeId)
        : movementRelation || operatorVariableBinding
        ? findResolvedReplayAnchorByRoles(resolvedAnchors, TRAJECTORY_WITNESS_ROLES)
        : undefined;
      if (!sourceAnchor || (relation.recoveredMovement && !targetAnchor)) return;
      const identityKey = getSharedAuthoredLineageIdentity(
        forest,
        resolvedAnchors.map((anchor) => String(anchor.nodeId || '').trim())
      );
      const link: ReplayAuthoredRelationLink = {
        relationIndex: String(links.length + 1),
        relationIndexProvenance: 'derived-presentation',
        relation: relationLabel,
        anchors: resolvedAnchors.map((anchor) => ({
          role: anchor.role,
          ...(anchor.authoredRole ? { authoredRole: anchor.authoredRole } : {}),
          nodeId: anchor.nodeId
        })),
        // Authored optional blocks travel verbatim on the link.
        ...(relation.priorAnchors && typeof relation.priorAnchors === 'object'
          ? { priorAnchors: structuredClone(relation.priorAnchors) }
          : {}),
        ...(relation.values && typeof relation.values === 'object'
          ? { values: structuredClone(relation.values) }
          : {}),
        authoredRelationIndex,
        authoredRelationKey: `${frameIndex}:${authoredRelationIndex}`,
        ...(targetAnchor
          ? {
              sourceNodeId: sourceAnchor.nodeId,
              targetNodeId: targetAnchor.nodeId,
              ...(witnessAnchor ? { witnessNodeId: witnessAnchor.nodeId } : {}),
              endpointOrderProvenance: relation.recoveredMovement ? 'recovered-movement' : registeredEndpointRoles
                ? 'registered-role-order'
                : 'authored-anchor-order'
            }
          : {}),
        renderFamily: movementRelation
          ? 'trajectory'
          : operatorVariableBinding
            ? 'operator-variable-binding'
            : (targetAnchor ? 'authored-anchor-link' : 'authored-anchor-evidence'),
        ...(trajectoryKind ? { trajectoryKind } : {}),
        stepIndex: frameIndex,
        operation: 'Relation',
        ...(identityKey
          ? {
              identityKey,
              identityProvenance: 'authored-shared-lineage'
            }
          : {})
      };
      links.push(link);
    });
  }

  return links;
};

export const buildMovementChainIndexCatalogueForFrames = (
  frames: ReplayDerivationFrame[],
  replayPlan: DerivationReplayPlan | null | undefined
): MovementChainIndexCatalogue => {
  const links = frames.flatMap((frame, stageIndex) => {
    const relations = getFrameRelations(frame, getReplayPlanStage(replayPlan, stageIndex),
      frames[stageIndex - 1]?.workspaceForest || []);
    return buildAuthoredRelationLinksForFrames(frames, replayPlan, stageIndex, frame.workspaceForest || [],
      Number.POSITIVE_INFINITY, index => index === stageIndex ? relations : []);
  });
  return buildMovementChainIndexCatalogue(frames.map(frame => frame.workspaceForest || []), links);
};

const formatRelationAnchorValue = (
  value: unknown,
  replayCanvasData?: SyntaxNode | null,
  role = ''
): string => {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => {
      const nodeId = String(item || '').trim();
      if (!nodeId) return '';
      return formatRelationParticipantValue(
        { role, nodeId, value: nodeId } as ResolvedRelationAnchor,
        replayCanvasData
      ) || nodeId;
    })
    .filter(Boolean)
    .join(', ');
};

const formatRelationAnchorRole = (role: string): string =>
  toReplayTitleCase(
    String(role || '')
      .trim()
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
  );

const getRegisteredRelationAnchorRoleOrder = (relationName: string): string[] => {
  const entry = findRelationRegistryEntry(productionRelationRegistry, relationName);
  if (!entry) return [];
  return [
    ...Object.keys(entry.signature.anchors.required),
    ...Object.keys(entry.signature.anchors.optional)
  ];
};

const STRUCTURAL_RELATION_ANCHOR_ROLES = new Set([
  'adjunctDomain',
  'boundary',
  'complement',
  'domain',
  'forbiddenRegion',
  'interpretationDomain',
  'licensedLandingHosts',
  'phase',
  'rejectedLandingHosts',
  'roof',
  'scopeDomain',
  'searchDomain',
  'spellOutDomain'
]);

const AUTHORED_WITNESS_RELATION_ANCHOR_ROLES = new Set([
  'traceWitness',
  'traceWitnesses',
  'variable'
]);

const getReplayNodeAuthoredWitnessYieldFromCanvas = (
  root: SyntaxNode | null | undefined,
  nodeId?: string
): string => {
  const node = findNodeByIdInForest([root].filter(Boolean) as SyntaxNode[], String(nodeId || '').trim());
  if (!node) return '';
  const surfaces: string[] = [];
  const collect = (candidate: SyntaxNode) => {
    const children = Array.isArray(candidate.children) ? candidate.children : [];
    if (children.length > 0) {
      children.forEach(collect);
      return;
    }
    const surface = String(candidate.word || candidate.label || '').trim();
    if (surface) surfaces.push(formatAuthoredWitnessSurface(surface));
  };
  collect(node);
  return surfaces.join(' ').trim();
};

const formatRelationParticipantValue = (
  anchor: ResolvedRelationAnchor,
  replayCanvasData?: SyntaxNode | null
): string => {
  const nodeId = String(anchor?.nodeId || '').trim();
  if (nodeId) {
    const role = String(anchor?.role || '').trim();
    if (STRUCTURAL_RELATION_ANCHOR_ROLES.has(role)) {
      return getReplayNodeCategoryFromCanvas(replayCanvasData, nodeId) || '';
    }
    if (AUTHORED_WITNESS_RELATION_ANCHOR_ROLES.has(role)) {
      return getReplayNodeAuthoredWitnessYieldFromCanvas(replayCanvasData, nodeId)
        || getReplayNodeCategoryFromCanvas(replayCanvasData, nodeId)
        || '';
    }
    return (
      getReplayNodeOvertYieldFromCanvas(replayCanvasData, nodeId)
      || getReplayNodeAuthoredYieldFromCanvas(replayCanvasData, nodeId)
      || getReplayNodeDisplayFromCanvas(replayCanvasData, nodeId)
      || getReplayNodeCategoryFromCanvas(replayCanvasData, nodeId)
      || ''
    );
  }
  return formatReplaySupportValue(String(anchor?.value || '').trim());
};

const getReplayContentRelationLinks = (step: PlaybackStep): ResolvedRelationLink[] => {
  const identity = step.replayRelationIdentity;
  if (!identity) return getActiveReplayRelationLinks(step);
  const key = `${identity.stageIndex}:${identity.relationIndex}`;
  return (step.replayRelationLinks ?? []).filter(link =>
    (link as ReplayAuthoredRelationLink).authoredRelationKey === key);
};

const buildRelationParticipantSupportLines = (step: PlaybackStep): ReplaySupportLine[] => {
  if (step.replayKind !== 'relation') return [];
  const activeLinks = getReplayContentRelationLinks(step);
  if (activeLinks.length === 0) return [];

  const relationName = String(activeLinks[0]?.relation || step.operation || '').trim();
  const roleValues = new Map<string, string[]>();
  activeLinks.forEach((link) => {
    (Array.isArray(link?.anchors) ? link.anchors : []).forEach((anchor) => {
      const role = String(anchor?.authoredRole || anchor?.role || '').trim();
      const display = formatRelationParticipantValue(anchor, step.replayCanvasData);
      if (!role || !display) return;
      const values = roleValues.get(role) || [];
      if (!values.includes(display)) values.push(display);
      roleValues.set(role, values);
    });
  });

  const registeredOrder = getRegisteredRelationAnchorRoleOrder(relationName);
  const roleOrder = [
    ...registeredOrder.filter((role) => roleValues.has(role)),
    ...Array.from(roleValues.keys()).filter((role) => !registeredOrder.includes(role))
  ];
  const lines = roleOrder.map((role) => ({
    label: formatRelationAnchorRole(role),
    value: (roleValues.get(role) || []).join(', ')
  })).filter((line) => line.label && line.value);

  return lines;
};

const buildLiteralRelationValueLines = (
  values: DerivationStageRelation['values']
): ReplaySupportLine[] => Object.entries(values ?? {}).flatMap(([label, value]) => (
  Array.isArray(value)
    ? (value.length ? value.map(item => ({ label, value: item })) : [{ label, value: '[]' }])
    : [{ label, value }]
));

const buildAuthoredRelationAnchorLines = (
  step: PlaybackStep,
  relation: DerivationStageRelation,
  movementLines: ReplaySupportLine[] = [],
  priorForest: readonly SyntaxNode[] = []
): ReplaySupportLine[] => {
  const links = getReplayContentRelationLinks(step);
  const endpointIsCovered = (role: string, value: string | string[]) => {
    if (Array.isArray(value)) return false;
    return links.some(link => {
      if (!isResolvedMovementLink(link)) return false;
      const anchor = link.anchors?.find(item => (item.authoredRole || item.role) === role && item.nodeId === value);
      if (!anchor) return false;
      return (movementLines.some(line => line.label === 'Source') && link.sourceNodeId === value
        && (TRAJECTORY_SOURCE_ROLES as readonly string[]).includes(anchor.role))
        || (movementLines.some(line => line.label === 'Landing') && link.targetNodeId === value
          && (TRAJECTORY_TARGET_ROLES as readonly string[]).includes(anchor.role));
    });
  };
  const current = Object.entries(relation.anchors ?? {}).flatMap(([role, value]) => {
    if (endpointIsCovered(role, value)) return [];
    const ids = Array.isArray(value) ? value : [value];
    if (!ids.length) return [{ label: role, value: '[]' }];
    return ids.map(nodeId => {
      const anchor = links.flatMap(link => link.anchors ?? []).find(item =>
        (item.authoredRole || item.role) === role && item.nodeId === nodeId);
      return { label: role, value: formatRelationParticipantValue(anchor ?? { role, nodeId, value: nodeId }, step.replayCanvasData) || nodeId };
    });
  });
  const prior = Object.entries(relation.priorAnchors ?? {}).flatMap(([role, value]) => {
    const ids = Array.isArray(value) ? value : [value];
    return (ids.length ? ids : ['[]']).map(nodeId => {
      const matches = priorForest.flatMap(collectReplayCanvasNodes).filter(node => node.id === nodeId);
      const display = matches.length === 1
        ? formatRelationParticipantValue({ role, nodeId, value: nodeId }, matches[0]) : '';
      return { label: `priorAnchors.${role}`, value: display || nodeId };
    });
  });
  return [...current, ...prior];
};

const buildRelationReplayLine = (
  relation: DerivationReplayPlanStep,
  replayCanvasData?: SyntaxNode | null
): string => {
  const relationLabel = formatReplaySupportValue(String(relation?.relation || '').trim());
  const anchors = relation?.anchors && typeof relation.anchors === 'object' && !Array.isArray(relation.anchors)
    ? relation.anchors
    : {};
  const anchorParts = Object.entries(anchors)
    .map(([role, value]) => {
      const display = formatRelationAnchorValue(value, replayCanvasData, role);
      if (!display) return '';
      const roleLabel = formatRelationAnchorRole(role);
      return roleLabel ? `${roleLabel}: ${display}` : display;
    })
    .filter(Boolean);
  if (!relationLabel) return anchorParts.join('; ');
  return anchorParts.length > 0 ? `${relationLabel}: ${anchorParts.join('; ')}` : relationLabel;
};

const buildStageRecordReplayBlocks = (
  frame?: ReplayDerivationFrame | null,
  plannedStage?: DerivationReplayPlanStage | null
): ReplayDetailBlock[] | undefined => {
  const stageRecord = getFrameStageRecordText(frame, plannedStage);
  if (!stageRecord) return undefined;
  return [{ title: 'Stage Record', lines: [stageRecord] }];
};

const buildRelationReplayBlocks = (
  relations: DerivationReplayPlanStep[] = [],
  replayCanvasData?: SyntaxNode | null
): ReplayDetailBlock[] | undefined => {
  const lines = relations
    .filter(isRenderableReplayRelation)
    .map((relation) => buildRelationReplayLine(relation, replayCanvasData))
    .filter(Boolean);
  if (lines.length === 0) return undefined;
  return [{ title: 'Relations', lines }];
};

const buildFrameReplayBlocks = (
  frame?: ReplayDerivationFrame | null,
  replayCanvasData?: SyntaxNode | null,
  plannedStage?: DerivationReplayPlanStage | null
): ReplayDetailBlock[] | undefined => (
  mergeReplayDetailBlocks(
    buildStageRecordReplayBlocks(frame, plannedStage),
    buildRelationReplayBlocks(getFrameRelations(frame, plannedStage), replayCanvasData)
  )
);

const combineReplayNodeDisplayWithPosition = (nodeDisplay: string, positionDisplay: string): string => {
  if (!positionDisplay) return nodeDisplay;
  if (!nodeDisplay) return positionDisplay;
  const normalizedNodeDisplay = normalizeReplayTargetLabel(nodeDisplay);
  const normalizedPosition = normalizeReplayTargetLabel(positionDisplay);
  if (normalizedNodeDisplay === normalizedPosition) return nodeDisplay;
  if (/^spec,/i.test(positionDisplay)) return positionDisplay;
  const inHostMatch = positionDisplay.match(/^[^ ]+\s+in\s+(.+)$/i);
  if (inHostMatch?.[1]) {
    return `${nodeDisplay} in ${formatReplaySupportValue(inHostMatch[1])}`;
  }
  return positionDisplay;
};

const getReplayMoveTargetLabel = (step: PlaybackStep | null): string => {
  if (!step) return '';
  if (!stepRepresentsMovement(step)) return formatReplaySupportValue(step.targetLabel);
  return (
    getReplayNodeDisplayFromCanvas(step.replayCanvasData, step.targetNodeId)
    || formatReplaySupportValue(step.targetLabel)
  );
};

const inferReplayLandingValue = (step: PlaybackStep | null): string => {
  if (!step) return '';
  const diagnostics = Array.isArray(step.movementDiagnostics)
    ? step.movementDiagnostics.filter(Boolean)
    : [];
  if (diagnostics.some((message) => /landing omitted/i.test(String(message || '')))) {
    return '';
  }
  const targetDisplay = getReplayMoveTargetLabel(step);
  const positionFromTree = describeReplayNodePosition(step.replayCanvasData, step.targetNodeId);
  if (isHeadLikePlaybackStep(step)) {
    return targetDisplay && !isGenericReplayStructuralLabel(targetDisplay)
      ? combineReplayNodeDisplayWithPosition(targetDisplay, positionFromTree)
      : (positionFromTree || '');
  }
  if (positionFromTree) return positionFromTree;
  const fallbackTarget = targetDisplay || formatReplaySupportValue(step.targetLabel);
  return fallbackTarget && !isGenericReplayStructuralLabel(fallbackTarget)
    ? fallbackTarget
    : '';
};

const inferReplaySourceValue = (step: PlaybackStep | null, landingValue: string): string => {
  if (!step) return '';
  const diagnostics = Array.isArray(step.movementDiagnostics)
    ? step.movementDiagnostics.filter(Boolean)
    : [];
  if (diagnostics.some((message) => /source omitted/i.test(String(message || '')))) {
    return '';
  }
  if (isHeadLikePlaybackStep(step)) {
    const sourceFromCanvas = (Array.isArray(step.sourceNodeIds) ? step.sourceNodeIds : [])
      .map((nodeId) => String(nodeId || '').trim())
      .filter((nodeId) => nodeId && nodeId !== String(step.targetNodeId || '').trim())
      .map((nodeId) => getReplayNodeDisplayFromCanvas(step.replayCanvasData, nodeId))
      .find(Boolean);
    if (sourceFromCanvas) return sourceFromCanvas;
    const labelSources = (Array.isArray(step.sourceLabels) ? step.sourceLabels : [])
      .map((label) => formatReplaySupportValue(label))
      .filter(Boolean);
    const labelSource = labelSources.find((label) => normalizeReplayTargetLabel(label) !== normalizeReplayTargetLabel(landingValue)) || labelSources[0];
    if (labelSource && !isGenericReplayStructuralLabel(labelSource)) return labelSource;
    return '';
  }
  const structuralSources = (Array.isArray(step.sourceNodeIds) ? step.sourceNodeIds : [])
    .filter((nodeId) => String(nodeId || '').trim() && String(nodeId || '').trim() !== String(step.targetNodeId || '').trim())
    .map((nodeId) => describeReplayNodePosition(step.replayCanvasData, nodeId))
    .filter(Boolean);
  const normalizedLanding = normalizeReplayTargetLabel(landingValue);
  const structuralSource = structuralSources.find((label) => normalizeReplayTargetLabel(label) !== normalizedLanding);
  if (structuralSource) return structuralSource;

  const movedSurface = formatReplaySupportValue(step.targetLabel);
  if (movedSurface && !isGenericReplayStructuralLabel(movedSurface)) return movedSurface;

  const labelSources = (Array.isArray(step.sourceLabels) ? step.sourceLabels : [])
    .map((label) => formatReplaySupportValue(label))
    .filter(Boolean);
  const labelSource = labelSources.find((label) => normalizeReplayTargetLabel(label) !== normalizedLanding) || labelSources[0];
  if (labelSource && !isGenericReplayStructuralLabel(labelSource)) return labelSource;

  return '';
};

export const buildReplaySupportLines = (
  step: PlaybackStep | null,
  authoredRelation?: DerivationStageRelation | null,
  priorForest: readonly SyntaxNode[] = []
): ReplaySupportLine[] => {
  if (!step) return [];

  const operation = String(step.operation || '').trim();
  const inputValue = formatReplayInputsValue(step.sourceLabels);
  const workspaceValue = formatReplayInputsValue(step.workspaceAfter);
  const resultValue = formatReplaySupportValue(step.targetLabel);
  const literalValues = authoredRelation === undefined
    ? getReplayContentRelationLinks(step).find(link => link.values)?.values
    : authoredRelation?.values;
  const valueLines = buildLiteralRelationValueLines(literalValues);

  if (step.replayKind !== 'relation' && operation === 'StageRecord') {
    return [];
  }

  if (step.replayKind !== 'relation' && operation === 'LexicalSelect') {
    return (workspaceValue || inputValue)
      ? [{ label: 'Result', value: workspaceValue || inputValue }]
      : [];
  }

  if (step.replayKind !== 'relation' && operation === 'Project') {
    const lines: ReplaySupportLine[] = [];
    if (inputValue) lines.push({ label: 'Input', value: inputValue });
    if (workspaceValue || resultValue) lines.push({ label: 'Result', value: workspaceValue || resultValue });
    return lines;
  }

  if (step.replayKind !== 'relation' && operation === 'ExternalMerge') {
    const lines: ReplaySupportLine[] = [];
    if (inputValue) lines.push({ label: step.sourceLabels.length > 1 ? 'Inputs' : 'Input', value: inputValue });
    if (resultValue) lines.push({ label: 'Result', value: resultValue });
    return lines;
  }

  if (stepRepresentsMovement(step) && relationMomentUsesMovementSupport(step)) {
    const landingValue = inferReplayLandingValue(step);
    const sourceValue = inferReplaySourceValue(step, landingValue);
    const lines: ReplaySupportLine[] = [];
    const diagnostics = Array.isArray(step.movementDiagnostics)
      ? step.movementDiagnostics.filter(Boolean)
      : [];
    const mentionsMissingSource = diagnostics.some((message) => /source omitted/i.test(String(message || '')));
    const mentionsMissingLanding = diagnostics.some((message) => /landing omitted/i.test(String(message || '')));
    if (sourceValue) lines.push({ label: 'Source', value: sourceValue });
    else if (mentionsMissingSource) lines.push({ label: 'Source', value: 'not serialized' });
    if (landingValue) lines.push({ label: 'Landing', value: landingValue });
    else if (mentionsMissingLanding) lines.push({ label: 'Landing', value: 'not serialized' });
    return [...lines, ...(authoredRelation ? buildAuthoredRelationAnchorLines(step, authoredRelation, lines, priorForest) : []), ...valueLines];
  }

  if (step.replayKind === 'relation') {
    const participants = authoredRelation === undefined ? buildRelationParticipantSupportLines(step)
      : authoredRelation ? buildAuthoredRelationAnchorLines(step, authoredRelation, [], priorForest) : [];
    return [...participants, ...valueLines];
  }

  const fallbackLines: ReplaySupportLine[] = [];
  if (inputValue) fallbackLines.push({ label: step.sourceLabels.length > 1 ? 'Inputs' : 'Input', value: inputValue });
  if (resultValue) fallbackLines.push({ label: 'Result', value: resultValue });
  return fallbackLines;
};

/** Panel content uses the original relation, including evidence with no drawing link. */
export const buildReplayPanelContent = (
  step: PlaybackStep | null | undefined,
  derivationStages: readonly DerivationStage[] | null | undefined = []
): ReplayPanelContent => {
  const identity = step?.replayKind === 'relation' ? step.replayRelationIdentity : undefined;
  const authoredRelation = identity && Number.isInteger(identity.stageIndex) && identity.stageIndex >= 0
    && Number.isInteger(identity.relationIndex) && identity.relationIndex >= 0
    ? derivationStages?.[identity.stageIndex]?.relations?.[identity.relationIndex] ?? null : null;
  const prefix = identity ? `${identity.stageIndex}:${identity.relationIndex}` : 'structural';
  const priorForest = identity && identity.stageIndex > 0
    ? derivationStages?.[identity.stageIndex - 1]?.workspaceForest ?? [] : [];
  const supportLines = buildReplaySupportLines(step ?? null, authoredRelation, priorForest);
  const stageIndex = step?.replayKind === 'macro' ? step.replayFrameIndex : undefined;
  const statement = typeof stageIndex === 'number' && Number.isInteger(stageIndex) && stageIndex >= 0
    ? derivationStages?.[stageIndex]?.statement : undefined;
  // Recipes also describe generated micro-steps; only the original stage owns this text.
  if (typeof statement === 'string' && statement.length > 0) {
    supportLines.unshift({ label: 'Statement', value: statement });
  }
  return {
    heading: authoredRelation?.relation ?? formatPlaybackOperationTitle(step),
    supportLines: supportLines.map((line, index) => ({ ...line, key: `${prefix}:${index}` })),
    authoredRelation
  };
};





export const buildReplayDisplayDetailBlocks = (
  steps: PlaybackStep[]
): Map<number, ReplayDetailBlock[]> => {
  const byStep = new Map<number, ReplayDetailBlock[]>();
  const pushBlockLine = (stepIndex: number, title: string, line: string) => {
    if (!line) return;
    const bucket = byStep.get(stepIndex) || [];
    const normalizedTitle = normalizeReplayBlockTitleKey(title);
    const existing = bucket.find((block) => normalizeReplayBlockTitleKey(block.title) === normalizedTitle);
    if (existing) {
      existing.lines.push(line);
    } else {
      bucket.push({ title, lines: [line] });
    }
    byStep.set(stepIndex, bucket);
  };

  // Detail blocks come from the Stage Record and the authored relations of
  // their own step. Nothing here reads prose to move a line elsewhere.
  steps.forEach((step, sourceIndex) => {
    const blocks = Array.isArray(step.detailBlocks) ? step.detailBlocks : [];
    blocks.forEach((block) => {
      const title = String(block?.title || '').trim();
      const lines = Array.isArray(block?.lines) ? block.lines.filter(Boolean) : [];
      if (!title || lines.length === 0) return;
      lines.forEach((line) => pushBlockLine(sourceIndex, title, line));
    });
  });

  return byStep;
};

const getTerminalWords = (node: SyntaxNode): string[] => {
  if (!node.children || node.children.length === 0) {
    return node.word ? [node.word] : [node.label];
  }
  return node.children.flatMap(getTerminalWords);
};

export const buildMovementProtectedNodeIds = (
  resolvedRelationLinks?: ResolvedRelationLink[]
): Set<string> => {
  const protectedIds = new Set<string>();
  (resolvedRelationLinks || []).forEach((link) => {
    const sourceId = String(link.sourceNodeId || '').trim();
    const movedId = String(link.targetNodeId || '').trim();
    const traceId = String(link.witnessNodeId || '').trim();
    if (sourceId) protectedIds.add(sourceId);
    if (movedId) protectedIds.add(movedId);
    if (traceId) protectedIds.add(traceId);
  });
  return protectedIds;
};

export const markTriangulatedNodes = (rootHierarchy: HierNode, protectedNodeIds?: Set<string>) => {
  rootHierarchy.each((d) => {
    const label = (d.data.label || "").trim().toUpperCase();
    const isBackbone =
      label.startsWith('CP') ||
      label.startsWith('INFLP') ||
      label.startsWith('TP') ||
      label.startsWith('VP') ||
      label.includes("'") ||
      label.includes("BAR") ||
      label === 'C' ||
      label === 'INFL' ||
      label === 'V' ||
      label === 'T' ||
      label === 'v';

    const isPhrase = label.endsWith('P');
    const terminals = getTerminalWords(d.data);
    const containsProtectedMovementNode = (protectedNodeIds?.size || 0) > 0
      ? d.descendants().some((descendant) => protectedNodeIds.has(getNodeId(descendant)))
      : false;

    if (isPhrase && !isBackbone && !containsProtectedMovementNode && terminals.length >= 2) {
      (d as any).isTriangulated = true;
      (d as any).triangulatedWords = terminals.join(' ');
    }
  });
};

export const isUnderTriangulation = (d: HierNode) => {
  let current = d.parent;
  while (current) {
    if ((current as any).isTriangulated) return true;
    current = current.parent;
  }
  return false;
};

export const shouldExpandPreterminalLeaf = (node: SyntaxNode): boolean => {
  if (Array.isArray(node.children) && node.children.length > 0) return false;
  const label = String(node.label || '').trim();
  const word = typeof node.word === 'string' ? node.word.trim() : '';
  if (!label || !word) return false;
  if (isTraceLike(label)) return false;
  if (normalizeToken(label) === normalizeToken(word)) return false;
  return true;
};

export const __TEST_ONLY__ = {
  buildDerivationCanvasData,
  resolveDerivationMovementTransitions,
  buildPlaybackStepsFromDerivationFrames,
  buildDisplayRelationLinks,
  buildMovementArrowsFromLinks,
  buildRenderableDerivationCanvasData,
  buildStructuralDerivationPlaybackSteps,
  collectVisibleDerivationNodeIds,
  buildDerivationReplaySnapshot,
  formatPlaybackOperationTitle,
  maybeLowercaseSentenceInitialFunctionSurface,
  getFrameRelations,
  getRelationAllAnchorNodeIds,
  isRenderableReplayRelation,
  resolveRelationAnchorNodeId,
  materializeReplayPreterminals,
  collectVisibleReplayOvertTokenCounts
};
