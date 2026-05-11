import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { DerivationStage, DerivationStep, FeatureCheckEvent, ReplayLedgerBlock, SyntaxNode } from '../types';
import { ResolvedVisualRelation } from '../visualRelationLinks';
import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';
import RootLogo from './RootLogo';

interface TreeVisualizerProps {
  data: SyntaxNode;
  animated?: boolean;
  derivationSteps?: DerivationStep[];
  derivationStages?: DerivationStage[];
  abstractionMode?: boolean;
  sentence?: string;
}

type HierNode = d3.HierarchyNode<SyntaxNode>;
type VisibleLink = d3.HierarchyLink<SyntaxNode>;

interface PlaybackStep {
  operation: DerivationStep['operation'];
  sourceKind?: 'microstep' | 'derivation-effect' | 'derived';
  trajectoryKind?: ResolvedVisualRelation['trajectoryKind'];
  movementSerializationStatus?: 'complete' | 'underspecified' | 'incoherent';
  movementDiagnostics?: string[];
  microOperations?: DerivationStep['operation'][];
  sourceFrameIndex?: number;
  visualFrameIndex?: number;
  replayFrameIndex?: number;
  replayKind?: 'micro' | 'relation' | 'macro';
  replayProgressLabel?: string;
  targetNodeId: string;
  targetLabel: string;
  sourceNodeIds?: string[];
  sourceLabels: string[];
  recipe?: string;
  workspaceAfter?: string[];
  spelloutOrder?: string[];
  featureChecking?: FeatureCheckEvent[];
  ledgerBlocks?: ReplayLedgerBlock[];
  stepId?: string;
  trigger?: string;
  chainId?: string;
  spelloutDomain?: string;
  note?: string;
  stageRecord?: string;
  replayCanvasData?: SyntaxNode | null;
  replayVisibleNodeIds?: string[];
  replayRelationLinks?: ResolvedVisualRelation[];
  preserveReplayStep?: boolean;
  replaySuppressAutoRevealNodeIds?: string[];
}

interface ReplaySupportLine {
  label: string;
  value: string;
}

const DERIVATION_WORKSPACE_ROOT_LABEL = '__DERIVATION_WORKSPACE__';
const DERIVATION_WORKSPACE_ROOT_ID = '__derivation_workspace_root__';

interface MovementArrow {
  source: HierNode;
  target: HierNode;
  traceNode?: HierNode;
  step: number;
  index?: string | null;
  operation?: DerivationStep['operation'];
  trajectoryKind?: ResolvedVisualRelation['trajectoryKind'];
}

interface DerivationMovementTransition {
  sourceId: string;
  targetId: string;
  traceId: string | null;
  step: number;
  index: string;
  chainId?: string | null;
  operation?: DerivationStep['operation'];
  trajectoryKind?: ResolvedVisualRelation['trajectoryKind'];
  note?: string;
}

interface ReplayDerivationMovementPayload {
  operation?: DerivationStep['operation'];
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
}

interface ReplayDerivationFrame {
  frameId?: string;
  stepId?: string;
  statement?: string;
  stageRecord?: string;
  visualRelations?: DerivationStage['visualRelations'];
  after?: ReplayDerivationAfterState;
  change?: ReplayDerivationChange;
  note?: string;
  workspaceForest: SyntaxNode[];
  operation?: DerivationStep['operation'];
  recipe?: string;
  trigger?: string;
  chainId?: string;
  spelloutDomain?: string;
  spelloutOrder?: string[];
  featureChecking?: FeatureCheckEvent[];
  microOperations?: DerivationStep['operation'][];
  movement?: ReplayDerivationMovementPayload | null;
  publicFacts?: Record<string, unknown>[];
}

interface DerivationReplayPlanStep {
  kind?: 'micro' | 'relation' | 'macro';
  stageIndex?: number;
  stageNumber?: number;
  stageStepNumber?: number;
  stageStepCount?: number;
  progressLabel?: string;
  relation?: string;
  anchors?: Record<string, unknown>;
  sourceNodeIds?: string[];
  targetNodeId?: string;
  stageRecord?: string;
}

interface DerivationReplayPlanStage {
  stageIndex: number;
  stageNumber: number;
  statement?: string;
  stageRecord?: string;
  relationSteps?: DerivationReplayPlanStep[];
  macroStep?: DerivationReplayPlanStep;
}

interface DerivationReplayPlan {
  stages?: DerivationReplayPlanStage[];
  steps?: DerivationReplayPlanStep[];
}

const getNodeId = (node: HierNode): string => (node as any).__vizId as string;
const STEP_DELAY_MS = 1000;
const MOVEMENT_ARROW_COLOR = '#10b981';
const MOVEMENT_ARC_STROKE = 2.6;

const applyVizIds = (root: HierNode) => {
  const used = new Set<string>();
  let generated = 1;
  root.eachBefore((node) => {
    const raw = typeof node.data.id === 'string' ? node.data.id.trim() : '';
    let id = raw;
    if (!id || used.has(id)) {
      while (used.has(`n${generated}`)) generated += 1;
      id = `n${generated}`;
      generated += 1;
    }
    used.add(id);
    (node as any).__vizId = id;
  });
};

const isSyntheticWorkspaceRootNode = (node: HierNode): boolean =>
  String(node.data?.label || '') === DERIVATION_WORKSPACE_ROOT_LABEL;

const buildDerivationCanvasData = (forest: SyntaxNode[]): SyntaxNode | null => {
  if (!Array.isArray(forest) || forest.length === 0) return null;
  if (forest.length === 1) return forest[0];
  return {
    id: DERIVATION_WORKSPACE_ROOT_ID,
    label: DERIVATION_WORKSPACE_ROOT_LABEL,
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
  if ((node as any).silent === true) return false;
  const word = String(node.word || '').trim();
  const label = String(node.label || '').trim();
  if (!word || !label) return false;
  if (isTraceLike(label) || isTraceLike(word) || isNullLike(label) || isNullLike(word)) return false;
  if (shouldExpandPreterminalLeaf(node)) return false;
  return true;
};

const normalizeReplayStructuralNodeId = (value?: string | number | null): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw.replace(/_stage\d+$/i, '');
};

const stabilizeReplayOvertLeafIds = (node?: SyntaxNode | null): SyntaxNode | null => {
  if (!node || typeof node !== 'object') return null;

  const walk = (current: SyntaxNode, parentId: string): SyntaxNode => {
    const ownId = normalizeReplayStructuralNodeId(current.id);
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
    if (!parentId || !shouldStabilizeReplayLeafId(current)) return next;

    const tokenIndex = Number.isInteger((current as any).tokenIndex)
      ? `tok_${(current as any).tokenIndex}`
      : '';
    const surfaceKey = normalizeReplayStableIdPart(current.word || current.label);
    const stableKey = tokenIndex ? `${tokenIndex}_${surfaceKey}` : surfaceKey;
    next.id = `${parentId}::__lex_${stableKey}`;
    return next;
  };

  return walk(node, '');
};

const buildRenderableDerivationCanvasData = (
  forest: SyntaxNode[],
  resolvedRelationLinks?: ResolvedVisualRelation[]
): SyntaxNode | null => {
  const canvas = buildDerivationCanvasData(forest);
  if (!canvas) return null;
  const stableReplayCanvas = stabilizeReplayOvertLeafIds(canvas) || canvas;
  return materializeCanopyPreterminals(
    materializeMissingTraceLeavesFromRelationLinks(
      materializeTraceShellsFromRelationLinks(stableReplayCanvas, resolvedRelationLinks),
      resolvedRelationLinks
    )
  );
};

const buildRenderableCommittedCanvasData = (
  tree: SyntaxNode,
  resolvedRelationLinks?: ResolvedVisualRelation[]
): SyntaxNode => {
  return materializeCanopyPreterminals(
    materializeMissingTraceLeavesFromRelationLinks(
      materializeTraceShellsFromRelationLinks(tree, resolvedRelationLinks),
      resolvedRelationLinks
    )
  );
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

const normalizeDerivationChangeRoleKey = (value?: string | null): string =>
  String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '');

const findDerivationChangeAnchorNodeId = (
  change?: ReplayDerivationChange | null,
  roleMatchers: string[] = []
): string => {
  const anchors = Array.isArray(change?.anchors) ? change.anchors : [];
  const normalizedMatchers = roleMatchers.map((matcher) => normalizeDerivationChangeRoleKey(matcher)).filter(Boolean);
  if (normalizedMatchers.length === 0) return '';
  for (const anchor of anchors) {
    const roleKey = normalizeDerivationChangeRoleKey(String((anchor as any)?.role || ''));
    if (!roleKey) continue;
    if (!normalizedMatchers.some((matcher) => roleKey === matcher || roleKey.includes(matcher) || matcher.includes(roleKey))) continue;
    const nodeId = String((anchor as any)?.nodeId || '').trim();
    if (nodeId) return nodeId;
  }
  return '';
};

const getDerivationChangeContinuityId = (change?: ReplayDerivationChange | null): string => {
  const continuityIds = Array.isArray(change?.continuityIds) ? change.continuityIds : [];
  for (const value of continuityIds) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  const details = change?.details && typeof change.details === 'object' ? change.details as Record<string, unknown> : null;
  return String(details?.chainId || details?.continuityId || '').trim();
};

const inferReplayDerivationMovementOperation = (
  change?: ReplayDerivationChange | null,
  forest: SyntaxNode[] = []
): DerivationStep['operation'] | '' => {
  if (!change) return '';
  const sourceNodeId = findDerivationChangeAnchorNodeId(change, ['source', 'from', 'origin', 'lower']);
  const landingNodeId = findDerivationChangeAnchorNodeId(change, ['landing', 'target', 'to', 'destination']);
  const hostNodeId = findDerivationChangeAnchorNodeId(change, ['host', 'container', 'targethead', 'head']);
  const traceNodeId = findDerivationChangeAnchorNodeId(change, ['trace', 'residue', 'lowercopy', 'copy']);
  const continuityId = getDerivationChangeContinuityId(change);
  const details = change.details && typeof change.details === 'object' ? change.details as Record<string, unknown> : null;
  const explicitOperation = String(details?.operation || details?.movementOperation || details?.trajectoryKind || '').trim();
  if (explicitOperation) return explicitOperation as DerivationStep['operation'];
  if (!sourceNodeId && !landingNodeId && !hostNodeId && !traceNodeId && !continuityId) return '';
  const nodeById = new Map<string, SyntaxNode>();
  const stack = [...forest];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    const nodeId = String(node.id || '').trim();
    if (nodeId) nodeById.set(nodeId, node);
    (Array.isArray(node.children) ? node.children : []).forEach((child) => stack.push(child));
  }
  const sourceLabel = String(nodeById.get(sourceNodeId)?.label || '').trim().toLowerCase();
  const landingLabel = String(nodeById.get(landingNodeId || hostNodeId)?.label || '').trim().toLowerCase();
  const statement = String(change.statement || '').trim().toLowerCase();
  const headLike = /^(?:c|t|v|i|d|n|a|p)$/.test(sourceLabel) || /^(?:c|t|v|i|d|n|a|p)$/.test(landingLabel) || Boolean(hostNodeId);
  if (headLike) return 'HeadMove';
  if (/wh|a[- ]?bar|front|topic|focus/.test(statement) || /cp/.test(landingLabel)) return 'AbarMove';
  return 'A-Move';
};

const cloneSyntaxForest = (forest: SyntaxNode[] = []): SyntaxNode[] =>
  forest
    .map((root) => cloneSyntaxTree(root))
    .filter((root): root is SyntaxNode => Boolean(root));

const adaptDerivationStagesForReplay = (stages?: DerivationStage[] | null): ReplayDerivationFrame[] => {
  if (!Array.isArray(stages) || stages.length === 0) return [];
  let previousWorkspaceForest: SyntaxNode[] = [];
  return stages.map((stage, index) => {
    const explicitWorkspaceForest = Array.isArray(stage.workspaceForest) ? stage.workspaceForest : [];
    const workspaceForest = explicitWorkspaceForest.length > 0
      ? cloneSyntaxForest(explicitWorkspaceForest)
      : cloneSyntaxForest(previousWorkspaceForest);
    previousWorkspaceForest = cloneSyntaxForest(workspaceForest);
    const visualRelations = Array.isArray(stage.visualRelations) ? stage.visualRelations : [];
    const details = {
      stageRecord: String(stage.stageRecord || '').trim(),
      derivationStageVisualRelations: visualRelations
    };
    const change: ReplayDerivationChange = {
      statement: String(stage.statement || '').trim(),
      details
    };
    const operation = inferReplayDerivationMovementOperation(change, workspaceForest) || 'Other';
    const movementOperation = inferReplayDerivationMovementOperation(change, workspaceForest);
    const sourceNodeId = findDerivationChangeAnchorNodeId(change, ['source', 'from', 'origin', 'lower']);
    const authoredLandingNodeId = findDerivationChangeAnchorNodeId(change, ['landing', 'target', 'to', 'destination']);
    const hostNodeId = findDerivationChangeAnchorNodeId(change, ['host', 'container', 'targethead', 'head']);
    const traceNodeId = findDerivationChangeAnchorNodeId(change, ['trace', 'residue', 'lowercopy', 'copy']);
    const chainId = getDerivationChangeContinuityId(change) || undefined;
    const movement = movementOperation
      ? {
          operation: movementOperation,
          ...(sourceNodeId ? { sourceNodeId } : {}),
          ...(authoredLandingNodeId ? { landingNodeId: authoredLandingNodeId, targetNodeId: authoredLandingNodeId } : {}),
          ...(hostNodeId ? { hostNodeId } : {}),
          ...(traceNodeId ? { traceNodeId } : {}),
          ...(chainId ? { chainId } : {}),
          ...(String(change?.statement || '').trim() ? { note: String(change?.statement || '').trim() } : {}),
          ...(String(details?.serializationStatus || '').trim() ? { serializationStatus: String(details?.serializationStatus || '').trim() as ReplayDerivationMovementPayload['serializationStatus'] } : {}),
          ...(Array.isArray(details?.diagnostics) ? { diagnostics: details.diagnostics.filter(Boolean).map((value) => String(value)) } : {})
        }
      : null;

    return {
      frameId: String(stage.stepId || '').trim() || `stage-${index + 1}`,
      stepId: String(stage.stepId || '').trim() || `stage-${index + 1}`,
      statement: String(stage.statement || '').trim(),
      stageRecord: String(stage.stageRecord || '').trim(),
      visualRelations,
      after: { workspaceForest },
      change,
      workspaceForest,
      operation,
      recipe: String(change?.statement || '').trim() || undefined,
      chainId,
      spelloutDomain: String(details?.spelloutDomain || '').trim() || undefined,
      spelloutOrder: Array.isArray(details?.spelloutOrder)
        ? details.spelloutOrder.map((value) => String(value || '').trim()).filter(Boolean)
        : undefined,
      featureChecking: Array.isArray(details?.featureChecking)
        ? details.featureChecking as FeatureCheckEvent[]
        : undefined,
      microOperations: Array.isArray(details?.microOperations)
        ? details.microOperations as DerivationStep['operation'][]
        : undefined,
      trigger: String(details?.trigger || '').trim() || undefined,
      movement,
      publicFacts: undefined
    };
  });
};

const collectVisibleDerivationNodeIds = (
  forest: SyntaxNode[],
  resolvedRelationLinks?: ResolvedVisualRelation[]
): Set<string> => {
  const canvas = buildRenderableDerivationCanvasData(forest, resolvedRelationLinks);
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
  detachedRootSideHints?: Map<string, number>
): SyntaxNode | null => {
  if (!visibleNodeIds || visibleNodeIds.size === 0) return null;

  const cloneVisibleNode = (node: HierNode): SyntaxNode | null => {
    const nodeId = getNodeId(node);
    if (!visibleNodeIds.has(nodeId)) return null;
    const dataClone = cloneSyntaxTree(node.data);
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
    .filter((node) => visibleNodeIds.has(getNodeId(node)))
    .filter((node) => {
      const nodeId = getNodeId(node);
      if (detachedRootIds?.has(nodeId)) return true;
      const parent = node.parent;
      if (!parent || isSyntheticWorkspaceRootNode(parent)) return true;
      return !visibleNodeIds.has(getNodeId(parent));
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
  return {
    id: DERIVATION_WORKSPACE_ROOT_ID,
    label: DERIVATION_WORKSPACE_ROOT_LABEL,
    children: forest
  };
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

  const nodesById = new Map(
    root
      .descendants()
      .filter((node) => !isSyntheticWorkspaceRootNode(node))
      .map((node) => [getNodeId(node), node] as const)
  );
  const visibleIds = new Set<string>();
  const markRenderableSubtree = (node: HierNode) => {
    if (isSyntheticWorkspaceRootNode(node)) return;
    visibleIds.add(getNodeId(node));
    (node.children || []).forEach(markRenderableSubtree);
  };

  rawVisibleNodeIds.forEach((requestedId) => {
    const normalizedRequestedId = String(requestedId || '').trim();
    if (!normalizedRequestedId) return;

    const exactNode = nodesById.get(normalizedRequestedId);
    if (exactNode) {
      markRenderableSubtree(exactNode);
      return;
    }

    const strippedId = stripSyntheticReplayLeafSuffix(normalizedRequestedId);
    const strippedNode = nodesById.get(strippedId);
    if (!strippedNode) return;
    visibleIds.add(normalizedRequestedId);
  });

  return visibleIds.size > 0 ? Array.from(visibleIds) : allRenderableNodeIds;
};

const extractReplayWorkspaceLabels = (canvasData: SyntaxNode | null): string[] => {
  if (!canvasData) return [];
  const roots = String(canvasData.label || '').trim() === DERIVATION_WORKSPACE_ROOT_LABEL
    ? (Array.isArray(canvasData.children) ? canvasData.children : [])
    : [canvasData];
  return roots
    .map((node) => String(node?.label || '').trim())
    .filter(Boolean);
};

const getReplayLeafSelectionTarget = (
  root: SyntaxNode
): { nodeId: string; surface: string } | null => {
  const renderableRoot = buildRenderableDerivationCanvasData([cloneSyntaxTree(root) || root]);
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

const getReplaySilentHeadNodeId = (nodeId: string): string =>
  `${String(nodeId || '').trim()}::__head`;

const getReplaySilentNullNodeId = (nodeId: string): string =>
  `${String(nodeId || '').trim()}::__null`;

const materializeReplayPreterminals = (node: SyntaxNode): SyntaxNode => {
  const walk = (current: SyntaxNode): SyntaxNode => {
    if (!current || typeof current !== 'object') {
      return { label: EXPLICIT_NULL_TERMINAL, word: EXPLICIT_NULL_TERMINAL, silent: true };
    }
    const children = Array.isArray(current.children)
      ? current.children
          .filter((child): child is SyntaxNode => Boolean(child && typeof child === 'object'))
          .map(walk)
      : [];
    const next: SyntaxNode = { label: current.label };
    if (typeof current.id === 'string' && current.id.trim()) {
      next.id = current.id;
    }
    if (current.silent === true) {
      next.silent = true;
    }
    const currentIsReplayLayoutOnly = (current as any).replayLayoutOnly === true;
    if (currentIsReplayLayoutOnly) {
      (next as any).replayLayoutOnly = true;
    }

    if (children.length > 0) {
      next.children = children;
      return next;
    }

    const word = typeof current.word === 'string' ? current.word.trim() : '';
    if (shouldCollapseSilentPronominalDisplay(current.label, word)) {
      next.label = EXPLICIT_NULL_TERMINAL;
      next.word = EXPLICIT_NULL_TERMINAL;
      next.silent = true;
      return next;
    }

    if (shouldMaterializeExplicitNullLeaf(current)) {
      next.children = [{
        id: buildSyntheticReplayLeafId(current, 'null', EXPLICIT_NULL_TERMINAL),
        label: EXPLICIT_NULL_TERMINAL,
        word: EXPLICIT_NULL_TERMINAL,
        silent: true,
        ...(currentIsReplayLayoutOnly ? { replayLayoutOnly: true } : {})
      }];
      return next;
    }
    if (!word) return next;

    if (shouldExpandPreterminalLeaf(current)) {
      next.children = [{
        id: buildSyntheticReplayLeafId(current, 'leaf', word),
        label: word,
        word,
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

const buildDerivationReplaySnapshot = (
  forest: SyntaxNode[],
  activeFrameIndex: number,
  visualRelationLinks?: ResolvedVisualRelation[],
  visibleNodeIds?: Set<string>
  ,
  layoutNodeIds?: Set<string>,
  derivationFrames?: ReplayDerivationFrame[],
  detachedRootIds?: Set<string>,
  detachedRootSideHints?: Map<string, number>
): {
  canvasData: SyntaxNode | null;
  visibleNodeIds: string[];
  relationLinks: ResolvedVisualRelation[];
} => {
  const transitionInputLinks = Array.isArray(visualRelationLinks)
    ? visualRelationLinks
    : [];
  const transitionLinks = resolveDerivationMovementTransitions(
    forest,
    derivationFrames,
    activeFrameIndex,
    transitionInputLinks
  ).map((transition) => ({
    relationIndex: transition.index,
    relation: transition.operation,
    anchors: [
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
  } satisfies ResolvedVisualRelation));
  const frameRelationLinks = transitionLinks.length > 0
    ? transitionLinks
    : transitionInputLinks;
  const effectiveRelationLinks = frameRelationLinks;
  const rawCanvas = stabilizeReplayOvertLeafIds(buildDerivationCanvasData(forest));
  const clonedRawCanvas = cloneSyntaxTree(rawCanvas);
  if (!clonedRawCanvas) {
    return {
      canvasData: null,
      visibleNodeIds: [],
      relationLinks: effectiveRelationLinks
    };
  }

  const rawHierarchy = d3.hierarchy(clonedRawCanvas);
  applyVizIds(rawHierarchy);
  const effectiveVisibleNodeIds = visibleNodeIds && visibleNodeIds.size > 0
    ? visibleNodeIds
    : new Set(
        rawHierarchy
          .descendants()
          .filter((node) => !isSyntheticWorkspaceRootNode(node))
          .map((node) => getNodeId(node))
      );
  const effectiveLayoutNodeIds = layoutNodeIds && layoutNodeIds.size > 0
    ? layoutNodeIds
    : effectiveVisibleNodeIds;
  const visibleRawCanvas = buildVisibleSyntaxSnapshotFromHierarchy(
    rawHierarchy,
    effectiveLayoutNodeIds,
    detachedRootIds,
    detachedRootSideHints
  );
  const renderableCanvas = visibleRawCanvas
    ? materializeReplayPreterminals(
        materializeMissingTraceLeavesFromRelationLinks(
          materializeTraceShellsFromRelationLinks(visibleRawCanvas, effectiveRelationLinks),
          effectiveRelationLinks
        )
      )
    : (
      buildRenderableDerivationCanvasData(forest, effectiveRelationLinks)
      || materializeCanopyPreterminals(
        materializeMissingTraceLeavesFromRelationLinks(
          materializeTraceShellsFromRelationLinks(clonedRawCanvas, effectiveRelationLinks),
          effectiveRelationLinks
        )
      )
    );
  const clonedRenderableCanvas = cloneSyntaxTree(renderableCanvas);
  if (!clonedRenderableCanvas) {
    return {
      canvasData: null,
      visibleNodeIds: [],
      relationLinks: effectiveRelationLinks
    };
  }
  const renderableHierarchy = d3.hierarchy(clonedRenderableCanvas);
  applyVizIds(renderableHierarchy);
  const renderableVisibleNodeIds = new Set(collectRenderableVisibleNodeIds(
    renderableHierarchy,
    effectiveVisibleNodeIds
  ));
  if (effectiveVisibleNodeIds && effectiveVisibleNodeIds.size > 0) {
    const renderableNodesById = new Map(
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
        exactNode.descendants().forEach((descendant) => {
          if (isSyntheticWorkspaceRootNode(descendant)) return;
          if ((descendant.data as any)?.replayLayoutOnly) return;
          renderableVisibleNodeIds.add(getNodeId(descendant));
        });
      }
    });
  }

  const replayVisibleNodeIds = Array.from(renderableVisibleNodeIds)
    .filter((nodeId) => {
      const node = findNodeByIdInForest([renderableCanvas], nodeId);
      return !(node as any)?.replayLayoutOnly;
    });

  return {
    canvasData: renderableCanvas,
    visibleNodeIds: replayVisibleNodeIds,
    relationLinks: effectiveRelationLinks
  };
};

const hidePendingInflSpecifierWrappersInStep = (step: PlaybackStep): PlaybackStep => {
  const visibleIds = new Set(
    (Array.isArray(step.replayVisibleNodeIds) ? step.replayVisibleNodeIds : [])
      .map((nodeId) => String(nodeId || '').trim())
      .filter(Boolean)
  );
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
          hiddenIds.add(nodeId);
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
          if (!hasVisibleSpecifierMaterial) hiddenIds.add(nodeId);
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

const cloneSyntaxTree = (node?: SyntaxNode | null): SyntaxNode | null => {
  if (!node || typeof node !== 'object') return null;
  const serialized = JSON.stringify(node);
  if (!serialized) return null;
  return JSON.parse(serialized) as SyntaxNode;
};

const LOW_SIGNAL_REPLAY_TEXT_RE = /^(?:initial logic and parameters are validated|standard processing applied|standard processing is applied|default processing applied|final transformation(?: applied)?|structural relations are established|final structure established|the derivation converges(?: with all features checked(?: and the overt word order successfully derived)?)?(?: and is sent to spellout)?|(?:lexicalselect|project|externalmerge|headmove|a-move|abarmove|agree|spellout|other|[a-z][a-z0-9_-]*(?:\s+[a-z][a-z0-9_-]*)*)\s+frame\s+\d+)\.?$/i;

const isLowSignalReplayText = (value?: string | null): boolean => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return true;
  return LOW_SIGNAL_REPLAY_TEXT_RE.test(trimmed);
};

const pickPreferredReplayText = (...values: Array<string | undefined | null>): string | undefined => {
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (!trimmed || isLowSignalReplayText(trimmed)) continue;
    return trimmed;
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
  operation: DerivationStep['operation'] | string | undefined,
  primaryRootLabel: string,
  rootLabels: string[]
): string => {
  const op = String(operation || '').trim();
  const readableOperation = formatOperationLabel(op as DerivationStep['operation']);
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
    case 'SpellOut':
      return 'Spell out committed structure';
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

  for (let futureFrameIndex = currentFrameIndex + 1; futureFrameIndex < frames.length; futureFrameIndex += 1) {
    const futureRoots = Array.isArray(frames[futureFrameIndex]?.workspaceForest)
      ? frames[futureFrameIndex].workspaceForest
      : [];
    const futureForestNodeIds = new Set(futureRoots.flatMap((root) => collectSubtreeNodeIds(root)));
    if (!currentRoots.every(({ id }) => futureForestNodeIds.has(id))) {
      break;
    }

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

const mergeReplayLedgerBlocks = (
  ...sources: Array<ReplayLedgerBlock[] | undefined>
): ReplayLedgerBlock[] | undefined => {
  const mergedByTitle = new Map<string, ReplayLedgerBlock>();
  sources
    .flat()
    .filter((block): block is ReplayLedgerBlock => Boolean(block && typeof block === 'object'))
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

const attachReplayLedgerBlocksToLastStep = (
  steps: PlaybackStep[],
  ledgerBlocks?: ReplayLedgerBlock[]
): PlaybackStep[] => {
  if (!Array.isArray(steps) || steps.length === 0 || !Array.isArray(ledgerBlocks) || ledgerBlocks.length === 0) {
    return steps;
  }
  const lastIndex = steps.length - 1;
  return steps.map((step, index) => (
    index === lastIndex
      ? {
          ...step,
          ledgerBlocks: mergeReplayLedgerBlocks(step.ledgerBlocks, ledgerBlocks)
        }
      : step
  ));
};

const stripReplayLedgerBlocksByTitles = (
  blocks: ReplayLedgerBlock[] | undefined,
  titles: string[]
): ReplayLedgerBlock[] | undefined => {
  const normalizedTitles = new Set(titles.map((title) => normalizeReplayBlockTitleKey(title)).filter(Boolean));
  const filtered = (Array.isArray(blocks) ? blocks : [])
    .filter((block) => !normalizedTitles.has(normalizeReplayBlockTitleKey(block?.title)));
  return filtered.length > 0 ? filtered : undefined;
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
  featureChecking: undefined,
  ledgerBlocks: undefined,
  note: undefined,
  movementSerializationStatus: undefined,
  movementDiagnostics: undefined
});

const buildPlaybackStepsFromDerivationFrames = (
  frames: ReplayDerivationFrame[],
  derivationSteps?: DerivationStep[],
  sentence?: string,
  replayPlan?: DerivationReplayPlan | null
): PlaybackStep[] => {
  const alignedSteps = Array.isArray(derivationSteps) ? derivationSteps : [];
  const plannedStageCount = Array.isArray(replayPlan?.stages) ? replayPlan.stages.length : 0;
  const stepsById = new Map(
    alignedSteps
      .map((step) => [String(step?.stepId || '').trim(), step] as const)
      .filter(([stepId]) => Boolean(stepId))
  );

  const usedStepIds = new Set<string>();
  let previousVisibleNodeIds = new Set<string>();
  let previousWorkspaceRootIds = new Set<string>();
  const sentenceInitialSurface = String(tokenizeReplaySentenceSurface(sentence)[0] || '').trim();
  const firstFrontingStageIndex = (() => {
    const stages = Array.isArray(replayPlan?.stages) ? replayPlan.stages : [];
    for (const stage of stages) {
      const relationSteps = Array.isArray(stage?.relationSteps) ? stage.relationSteps : [];
      if (!relationSteps.some((relation) => isFrontingLikeOperationLabel(relation?.relation))) continue;
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
    const alignedStep = (() => {
      const frameStepId = String(frame?.stepId || '').trim();
      if (frameStepId && stepsById.has(frameStepId)) {
        return stepsById.get(frameStepId);
      }
      return alignedSteps[index];
    })();
    const rawWorkspaceRoots = Array.isArray(frame.workspaceForest) ? frame.workspaceForest : [];
    const nextFrame = index < frames.length - 1 ? frames[index + 1] : null;
    const fallbackOperation = frame.movement?.operation || frame.operation || alignedStep?.operation || 'Other';
    // Anchor detached roots to explicit future daughter order as soon as a later
    // derivation frame makes that merge order unambiguous. This keeps bottom-up
    // workspace assembly visually aligned with the eventual tree without guessing.
    const preferredWorkspaceRootOrder = inferFutureWorkspaceRootOrder(rawWorkspaceRoots, frames, index);
    const preferredWorkspaceRootSideHints = buildWorkspaceRootSideHints(
      rawWorkspaceRoots,
      preferredWorkspaceRootOrder
    );
    const workspaceRoots = reorderWorkspaceRootsForReplay(rawWorkspaceRoots, preferredWorkspaceRootOrder);
    const rootLabels = workspaceRoots
      .map((node) => String(node?.label || '').trim())
      .filter(Boolean);
    const primaryRoot = workspaceRoots[0];
    const primaryRootId = String(primaryRoot?.id || '').trim();
    const primaryRootLabel = String(primaryRoot?.label || '').trim() || 'Workspace';
    const preferredNote = pickPreferredReplayText(frame.note, alignedStep?.note);
    const structuralFallbackRecipe = buildStructuralReplayFallback(
      fallbackOperation,
      primaryRootLabel,
      rootLabels
    );
    const preferredRecipe = pickPreferredReplayText(
      frame.recipe,
      frame.movement?.note,
      alignedStep?.recipe,
      preferredNote
    );
    const authoredLandingNodeId = getMovementLandingNodeId(frame.movement);
    const frameHasMovementPayload = Boolean(
      authoredLandingNodeId
      || String(frame.movement?.sourceNodeId || '').trim()
      || String(frame.movement?.traceNodeId || '').trim()
      || String(frame.chainId || alignedStep?.chainId || '').trim()
    );
    const carriesStructuredAuditPayload =
      (Array.isArray(frame.spelloutOrder) && frame.spelloutOrder.length > 0) ||
      (Array.isArray(frame.featureChecking) && frame.featureChecking.length > 0) ||
      (Array.isArray(alignedStep?.featureChecking) && alignedStep.featureChecking.length > 0) ||
      (Array.isArray(alignedStep?.ledgerBlocks) && alignedStep.ledgerBlocks.length > 0);
    const frameCarriesAuthoredEffect =
      Boolean(String(getDerivationFrameChange(frame)?.statement || '').trim())
      || carriesStructuredAuditPayload;
    const movementRecipe = pickPreferredReplayText(
      frame.movement?.note,
      alignedStep?.note,
      alignedStep?.recipe
    );
    const semanticRecipe = (() => {
      if (String(fallbackOperation || '').trim() === 'SpellOut') {
        return preferredRecipe || structuralFallbackRecipe;
      }
      if (carriesStructuredAuditPayload) {
        return preferredRecipe || structuralFallbackRecipe;
      }
      if (isMoveLikeOperation(fallbackOperation) || frameHasMovementPayload) {
        return movementRecipe || structuralFallbackRecipe;
      }
      return structuralFallbackRecipe;
    })();
    const alignedStepId = String(alignedStep?.stepId || '').trim();
    if (alignedStepId) usedStepIds.add(alignedStepId);

    const priorVisibleNodeIds = new Set(previousVisibleNodeIds);
    const frameVisualRelationSteps = plannedStage
      ? getFrameVisualRelations(frame, plannedStage).filter(isRenderableReplayVisualRelation)
      : [];
    const previousFrameWorkspaceRoots = index > 0 && Array.isArray(frames[index - 1]?.workspaceForest)
      ? frames[index - 1].workspaceForest
      : [];
    const frameHasMoveLikeVisualRelation = frameVisualRelationSteps.some((relation) =>
      isMoveLikeOperation(String(relation?.relation || '').trim())
    );
    const frameIsPureVisualTrajectoryStage =
      frameHasMoveLikeVisualRelation
      && collectReplayOvertTokenMultisetKey(previousFrameWorkspaceRoots) === collectReplayOvertTokenMultisetKey(workspaceRoots)
      && collectReplayRootStructuralKey(previousFrameWorkspaceRoots) === collectReplayRootStructuralKey(workspaceRoots);
    const authoredPreviousRelationRelationLinks = plannedStage
      ? buildAuthoredVisualRelationRelationLinksForFrames(
          frames,
          replayPlan,
          index - 1,
          workspaceRoots
        )
      : [];
    const authoredCumulativeRelationRelationLinks = plannedStage
      ? buildAuthoredVisualRelationRelationLinksForFrames(
          frames,
          replayPlan,
          index,
          workspaceRoots
        )
      : [];
    const frameReplaySnapshot = buildDerivationReplaySnapshot(
      workspaceRoots,
      index,
      authoredCumulativeRelationRelationLinks,
      undefined,
      undefined,
      frames
    );
    const frameCommitmentBlocks = buildFrameCommitmentLedgerBlocks(
      frame,
      frameReplaySnapshot.canvasData,
      plannedStage
    );
    const frameStageRecordBlocks = plannedStage
      ? buildStageRecordReplayBlocks(frame, plannedStage)
      : frameCommitmentBlocks;
    const frameRelationRelationLinks = plannedStage
      ? authoredCumulativeRelationRelationLinks.filter((link) => Number(link?.stepIndex) === index)
      : [];
    const structuralWorkspaceRoots = frameRelationRelationLinks.length > 0
      ? buildPreRelationWorkspaceForest(workspaceRoots, frameRelationRelationLinks)
      : workspaceRoots;
    const frameMacroBlocks = plannedStage
      ? frameStageRecordBlocks
      : frameCommitmentBlocks;
    const alignedLedgerBlocks = frameCommitmentBlocks && frameCommitmentBlocks.length > 0
      ? stripReplayLedgerBlocksByTitles(alignedStep?.ledgerBlocks, [
          'Commitment Fact',
          'Derivational Record',
          'Stage Record',
          'Visual Relations'
        ])
      : alignedStep?.ledgerBlocks;
    const mergedFrameLedgerBlocks = mergeReplayLedgerBlocks(
      alignedLedgerBlocks,
      frameMacroBlocks
    );
    const currentFrameVisibleNodeIds = collectVisibleDerivationNodeIds(
      workspaceRoots,
      frameReplaySnapshot.relationLinks
    );
    const frameEncodesMovement =
      frameHasMovementPayload
      || (Array.isArray(frameReplaySnapshot.relationLinks) && frameReplaySnapshot.relationLinks.length > 0);
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
      microOperations: Array.isArray(frame.microOperations) && frame.microOperations.length > 0
        ? frame.microOperations
        : alignedStep?.microOperations,
      sourceFrameIndex: index,
      visualFrameIndex: index,
      targetNodeId:
        (frameEncodesMovement
          ? moveTargetNodeId
          : (
              primaryRootId
              || alignedStep?.targetNodeId
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
              || alignedStep?.targetLabel
              || 'Workspace'
            ),
      sourceNodeIds: moveSourceNodeIds.length > 0 ? moveSourceNodeIds : alignedStep?.sourceNodeIds,
      sourceLabels: moveSourceLabels.length > 0
        ? moveSourceLabels
        : (frameEncodesMovement
          ? (Array.isArray(alignedStep?.sourceLabels) ? alignedStep.sourceLabels : [])
          : (Array.isArray(alignedStep?.sourceLabels) && alignedStep.sourceLabels.length > 0
            ? alignedStep.sourceLabels
            : rootLabels)),
      recipe: resolvedSemanticRecipe,
      workspaceAfter: Array.isArray(alignedStep?.workspaceAfter) && alignedStep.workspaceAfter.length > 0
        ? alignedStep.workspaceAfter
        : rootLabels,
      spelloutOrder: frame.spelloutOrder || alignedStep?.spelloutOrder,
      featureChecking: Array.isArray(frame.featureChecking) && frame.featureChecking.length > 0
        ? frame.featureChecking
        : alignedStep?.featureChecking,
      ledgerBlocks: mergedFrameLedgerBlocks,
      replayKind: plannedStage ? 'macro' : undefined,
      stageRecord: getFrameStageRecordText(frame, plannedStage),
      stepId: alignedStep?.stepId || frame.stepId,
      trigger: alignedStep?.trigger || frame.trigger,
      chainId: alignedStep?.chainId || frame.chainId,
      spelloutDomain: alignedStep?.spelloutDomain || frame.spelloutDomain,
      note: preferredNote && preferredNote !== resolvedSemanticRecipe ? preferredNote : undefined,
      replayFrameIndex: index,
      replayCanvasData: frameReplaySnapshot.canvasData,
      replayVisibleNodeIds: frameReplaySnapshot.visibleNodeIds,
      replayRelationLinks: frameReplaySnapshot.relationLinks
    };

    const finalizeStructuralReplayForFrame = (steps: PlaybackStep[]): PlaybackStep[] => {
      let structuralSteps = steps.map(stripSemanticPayloadFromMicrostep);
      if (plannedStage) {
        const resolveRelationPlacement = (relation: DerivationReplayPlanStep, relationIndex: number) => {
          const relationLabel = String(relation?.relation || '').trim() || 'Visual Relation';
          const isTrajectoryRelation = isMoveLikeOperation(relationLabel);
          const rawAuthoredTargetNodeId = getVisualRelationTargetNodeId(relation);
          const rawSourceNodeIds = getVisualRelationSourceNodeIds(relation);
          const sourceNodeIds = rawSourceNodeIds
            .map((nodeId) => resolveVisualRelationAnchorNodeId(workspaceRoots, nodeId, 'source'))
            .filter(Boolean);
          const authoredTargetNodeId = resolveVisualRelationAnchorNodeId(
            workspaceRoots,
            rawAuthoredTargetNodeId,
            'target'
          );
          const sourceNodeId = isTrajectoryRelation
            ? (
                sourceNodeIds.find((nodeId) =>
                  visualRelationAnchorsExistInForest(workspaceRoots, authoredTargetNodeId, nodeId)
                ) || sourceNodeIds[0] || ''
              )
            : '';
          if (isTrajectoryRelation) {
            if (!visualRelationAnchorsExistInForest(workspaceRoots, authoredTargetNodeId, sourceNodeId)) return null;
            if (!visualRelationHasRenderableTrajectory(workspaceRoots, relationLabel, authoredTargetNodeId, sourceNodeId)) {
              return null;
            }
          }
          const relationAnchorNodeIds = isTrajectoryRelation
            ? Array.from(new Set([authoredTargetNodeId, ...sourceNodeIds].filter(Boolean)))
            : getVisualRelationAllAnchorNodeIds(relation)
                .map((nodeId) => resolveVisualRelationAnchorNodeId(workspaceRoots, nodeId, 'source'))
                .filter(Boolean);
          if (relationAnchorNodeIds.length === 0) return null;
          const targetWitnessNodeId = isTrajectoryRelation
            ? (
                findParentNodeIdInForest(workspaceRoots, authoredTargetNodeId)
                || authoredTargetNodeId
              )
            : '';
          const sourceWitnessNodeIds = (isTrajectoryRelation ? sourceNodeIds : relationAnchorNodeIds)
            .map((nodeId) => findParentNodeIdInForest(workspaceRoots, nodeId) || nodeId)
            .filter(Boolean);
          const witnessNodeIds = Array.from(new Set([
            targetWitnessNodeId,
            ...sourceWitnessNodeIds
          ].filter(Boolean)));
          const insertAfterStepIndex = (() => {
            if (structuralSteps.length === 0) return -1;
            if (witnessNodeIds.length === 0) return structuralSteps.length - 1;
            const foundIndex = structuralSteps.findIndex((step) => {
              const visibleNodeIds = new Set(Array.isArray(step.replayVisibleNodeIds) ? step.replayVisibleNodeIds : []);
              return witnessNodeIds.every((nodeId) => visibleNodeIds.has(nodeId));
            });
            return foundIndex >= 0 ? foundIndex : structuralSteps.length - 1;
          })();
          return {
            relation,
            relationIndex,
            relationLabel,
            rawAuthoredTargetNodeId,
            sourceNodeIds,
            authoredTargetNodeId,
            relationAnchorNodeIds,
            renderableTrajectory: isTrajectoryRelation,
            insertAfterStepIndex
          };
        };
        let relationPlacements = frameVisualRelationSteps
          .map((relation, relationIndex) => resolveRelationPlacement(relation, relationIndex))
          .filter((placement): placement is NonNullable<ReturnType<typeof resolveRelationPlacement>> => Boolean(placement))
          .sort((left, right) =>
            left.insertAfterStepIndex === right.insertAfterStepIndex
              ? left.relationIndex - right.relationIndex
              : left.insertAfterStepIndex - right.insertAfterStepIndex
          );
        const pendingSilentLandingTargetIds = new Set(
          relationPlacements
            .filter((placement) => {
              if (
                !placement.renderableTrajectory
                || isFrontingLikeOperationLabel(placement.relationLabel)
                || !String(placement.authoredTargetNodeId || '').trim()
              ) {
                return false;
              }
              const authoredTargetNode = findNodeByIdInForest(workspaceRoots, placement.authoredTargetNodeId);
              const authoredSourceNode = placement.sourceNodeIds.length > 0
                ? findNodeByIdInForest(workspaceRoots, placement.sourceNodeIds[0])
                : null;
              return !targetHasResidentPreRelationHeadLeaf(authoredTargetNode, authoredSourceNode);
            })
            .map((placement) => String(placement.authoredTargetNodeId || '').trim())
        );
        if (pendingSilentLandingTargetIds.size > 0) {
          structuralSteps = structuralSteps.flatMap((step) => {
            const targetNodeId = String(step.targetNodeId || '').trim();
            const strippedTargetNodeId = stripSyntheticReplayLeafSuffix(targetNodeId);
            const targetsPendingLanding = pendingSilentLandingTargetIds.has(targetNodeId)
              || pendingSilentLandingTargetIds.has(strippedTargetNodeId);
            if (!targetsPendingLanding) return [step];
            const landingNode = findNodeByIdInForest(workspaceRoots, strippedTargetNodeId);
            const landingCategory = String(landingNode?.label || step.targetLabel || '').trim() || 'head';
            const silentNullNodeId = getReplaySilentNullNodeId(strippedTargetNodeId);
            if (step.operation === 'LexicalSelect') {
              const selectVisibleNodeIds = new Set(
                (Array.isArray(step.replayVisibleNodeIds) && step.replayVisibleNodeIds.length > 0
                  ? step.replayVisibleNodeIds
                  : Array.from(priorVisibleNodeIds))
                  .map((nodeId) => String(nodeId || '').trim())
                  .filter(Boolean)
              );
              selectVisibleNodeIds.delete(strippedTargetNodeId);
              selectVisibleNodeIds.delete(`${strippedTargetNodeId}::__leaf`);
              selectVisibleNodeIds.add(silentNullNodeId);
              return [{
                ...step,
                targetNodeId: silentNullNodeId,
                targetLabel: EXPLICIT_NULL_TERMINAL,
                sourceNodeIds: [silentNullNodeId],
                sourceLabels: [EXPLICIT_NULL_TERMINAL],
                recipe: `Select ${EXPLICIT_NULL_TERMINAL}`,
                workspaceAfter: [EXPLICIT_NULL_TERMINAL],
                replayVisibleNodeIds: Array.from(selectVisibleNodeIds)
              }];
            }
            if (step.operation === 'Project') {
              const baseVisibleNodeIds = new Set(
                (Array.isArray(step.replayVisibleNodeIds) ? step.replayVisibleNodeIds : [])
                  .map((nodeId) => String(nodeId || '').trim())
                  .filter(Boolean)
              );
              baseVisibleNodeIds.delete(strippedTargetNodeId);
              baseVisibleNodeIds.delete(`${strippedTargetNodeId}::__leaf`);
              baseVisibleNodeIds.delete(silentNullNodeId);
              const categoryVisibleNodeIds = new Set(baseVisibleNodeIds);
              categoryVisibleNodeIds.add(strippedTargetNodeId);
              categoryVisibleNodeIds.add(silentNullNodeId);
              return [{
                ...step,
                targetNodeId: strippedTargetNodeId,
                targetLabel: landingCategory,
                sourceNodeIds: [silentNullNodeId],
                sourceLabels: [EXPLICIT_NULL_TERMINAL],
                recipe: `Project ${landingCategory}`,
                workspaceAfter: [landingCategory],
                replayVisibleNodeIds: Array.from(categoryVisibleNodeIds)
              }];
            }
            return [step];
          });
          structuralSteps = structuralSteps.filter((step, stepIndex) => {
            const previousStep = structuralSteps[stepIndex - 1];
            if (!previousStep) return true;
            if (step.operation !== 'Project' || previousStep.operation !== 'Project') return true;
            return !(
              String(step.recipe || '').trim() === String(previousStep.recipe || '').trim()
              && stripSyntheticReplayLeafSuffix(String(step.targetNodeId || '').trim())
                === stripSyntheticReplayLeafSuffix(String(previousStep.targetNodeId || '').trim())
            );
          });
        }
        const resolveRelationInsertAfterStepIndex = (
          placement: NonNullable<ReturnType<typeof resolveRelationPlacement>>
        ): number => {
          if (structuralSteps.length === 0) return -1;
          const targetWitnessNodeId = placement.renderableTrajectory
            ? (
                findParentNodeIdInForest(workspaceRoots, placement.authoredTargetNodeId)
                || placement.authoredTargetNodeId
              )
            : '';
          const sourceWitnessNodeIds = (placement.renderableTrajectory ? placement.sourceNodeIds : placement.relationAnchorNodeIds)
            .map((nodeId) => findParentNodeIdInForest(workspaceRoots, nodeId) || nodeId)
            .filter(Boolean);
          const witnessNodeIds = Array.from(new Set([
            targetWitnessNodeId,
            ...sourceWitnessNodeIds
          ].filter(Boolean)));
          const firstWitnessIndex = witnessNodeIds.length === 0
            ? structuralSteps.length - 1
            : structuralSteps.findIndex((step) => {
                const visibleNodeIds = new Set(Array.isArray(step.replayVisibleNodeIds) ? step.replayVisibleNodeIds : []);
                return witnessNodeIds.every((nodeId) => visibleNodeIds.has(nodeId));
              });
          const targetParentNodeId = placement.renderableTrajectory
            ? findParentNodeIdInForest(workspaceRoots, placement.authoredTargetNodeId)
            : '';
          const targetParentIndex = targetParentNodeId
            ? structuralSteps.findIndex((step) => {
                const visibleNodeIds = new Set(Array.isArray(step.replayVisibleNodeIds) ? step.replayVisibleNodeIds : []);
                return stripSyntheticReplayLeafSuffix(String(step.targetNodeId || '').trim()) === targetParentNodeId
                  || visibleNodeIds.has(targetParentNodeId);
              })
            : -1;
          return Math.max(
            firstWitnessIndex >= 0 ? firstWitnessIndex : structuralSteps.length - 1,
            targetParentIndex
          );
        };
        relationPlacements = relationPlacements
          .map((placement) => ({
            ...placement,
            insertAfterStepIndex: resolveRelationInsertAfterStepIndex(placement)
          }))
          .sort((left, right) =>
            left.insertAfterStepIndex === right.insertAfterStepIndex
              ? left.relationIndex - right.relationIndex
              : left.insertAfterStepIndex - right.insertAfterStepIndex
          );
        const singleRelationLinksByIndex = new Map<number, ResolvedVisualRelation[]>();
        frameVisualRelationSteps.forEach((_, relationIndex) => {
          const throughRelationLinks = buildAuthoredVisualRelationRelationLinksForFrames(
            frames,
            replayPlan,
            index,
            workspaceRoots,
            relationIndex
          );
          const beforeRelationLinks = buildAuthoredVisualRelationRelationLinksForFrames(
            frames,
            replayPlan,
            index,
            workspaceRoots,
            relationIndex - 1
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
          if (!placement.renderableTrajectory) {
            relationVisibleNodeIdsByIndex.set(placement.relationIndex, []);
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
          const sourceSubtreeNodeIds = placement.sourceNodeIds.flatMap((nodeId) =>
            collectSyntaxSubtreeNodeIds(findNodeByIdInForest(workspaceRoots, nodeId))
          );
          const targetSyntheticLeafNodeIds = shouldReserveHeadLandingLeaf && placement.authoredTargetNodeId
            ? [`${placement.authoredTargetNodeId}::__leaf`]
            : [];
          relationVisibleNodeIdsByIndex.set(
            placement.relationIndex,
            Array.from(new Set([
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
        const pendingLandingIntroductionStepIndexById = new Map<string, number>();
        pendingSilentLandingTargetIds.forEach((landingTargetId) => {
          const normalizedLandingTargetId = stripSyntheticReplayLeafSuffix(landingTargetId);
          if (!normalizedLandingTargetId) return;
          const introductionIndex = structuralSteps.findIndex((candidateStep) => {
            const candidateTargetId = stripSyntheticReplayLeafSuffix(String(candidateStep.targetNodeId || '').trim());
            if (!candidateTargetId) return false;
            const candidateTargetNode = findNodeByIdInForest(workspaceRoots, candidateTargetId);
            const candidateTargetSubtreeIds = new Set(collectSyntaxSubtreeNodeIds(candidateTargetNode));
            return candidateTargetSubtreeIds.has(normalizedLandingTargetId);
          });
          if (introductionIndex >= 0) {
            pendingLandingIntroductionStepIndexById.set(normalizedLandingTargetId, introductionIndex);
          }
        });
        const hideInactivePendingLandingLayoutLeaves = (nodeIds: string[]): string[] => {
          const visibleIds = new Set(nodeIds.map((nodeId) => String(nodeId || '').trim()).filter(Boolean));
          return nodeIds.filter((nodeId) => {
            const normalizedNodeId = String(nodeId || '').trim();
            if (!normalizedNodeId.endsWith('::__leaf')) return true;
            const baseNodeId = stripSyntheticReplayLeafSuffix(normalizedNodeId);
            return !(
              pendingSilentLandingTargetIds.has(baseNodeId)
              && visibleIds.has(getReplaySilentNullNodeId(baseNodeId))
            );
          });
        };
        const buildActiveRelationLinks = (activeRelationIndexes: Set<number>): ResolvedVisualRelation[] => {
          const links: ResolvedVisualRelation[] = [...authoredPreviousRelationRelationLinks];
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
          const activeRelationLinks = buildActiveRelationLinks(activeRelationIndexes);
          const activeLinkKeys = new Set(activeRelationLinks.map((link) => resolvedRelationLinkKey(link)));
          const futureRelationRelationLinks = frameRelationRelationLinks
            .filter((link) => !activeLinkKeys.has(resolvedRelationLinkKey(link)));
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
          const requestedLayoutNodeIds = new Set([
            ...requestedVisibleNodeIds,
            ...collectSyntaxSubtreeNodeIds(baseStep?.replayCanvasData),
            ...relationLayoutNodeIds
          ].filter(Boolean));
          const snapshotForest = (() => {
            if (futureRelationRelationLinks.length === 0) {
              return buildDerivationReplaySnapshot(
                workspaceRoots,
                index,
                activeRelationLinks,
                requestedVisibleNodeIds,
                requestedLayoutNodeIds,
                frames
              );
            }

            const preRelationForest = buildPreRelationWorkspaceForest(workspaceRoots, futureRelationRelationLinks);
            const replayLayoutOverlay = buildReplayLayoutForestOverlay(preRelationForest, workspaceRoots);
            replayLayoutOverlay.layoutOnlyNodeIds.forEach((nodeId) => requestedLayoutNodeIds.add(nodeId));
            return buildDerivationReplaySnapshot(
              replayLayoutOverlay.forest,
              index,
              activeRelationLinks,
              requestedVisibleNodeIds,
              requestedLayoutNodeIds,
              frames
            );
          })();
          return {
            ...snapshotForest,
            activeRelationLinks
          };
        };
        const rebuildStructuralStepForActiveRelations = (
          step: PlaybackStep,
          activeRelationIndexes: Set<number>,
          structuralStepIndex: number
        ): PlaybackStep => {
          if (activeRelationIndexes.size === 0 && relationLayoutNodeIds.length === 0) return step;
          const snapshot = buildSnapshotForActiveRelations(step, activeRelationIndexes);
          const visibleNodeIds = (() => {
            if (activeRelationIndexes.size > 0 || pendingSilentLandingTargetIds.size === 0) {
              return snapshot.visibleNodeIds;
            }
            const canvasRoot = snapshot.canvasData;
            if (!canvasRoot) return snapshot.visibleNodeIds;
            const stepTargetId = stripSyntheticReplayLeafSuffix(String(step.targetNodeId || '').trim());
            const stepTargetNode = stepTargetId
              ? findNodeByIdInForest([canvasRoot], stepTargetId)
              : null;
            const stepTargetSubtreeIds = new Set(collectSyntaxSubtreeNodeIds(stepTargetNode));
            const suppressedIds = new Set<string>();
            pendingSilentLandingTargetIds.forEach((landingTargetId) => {
              const normalizedLandingTargetId = stripSyntheticReplayLeafSuffix(landingTargetId);
              if (!normalizedLandingTargetId) return;
              const introductionStepIndex = pendingLandingIntroductionStepIndexById.get(normalizedLandingTargetId);
              if (Number.isInteger(introductionStepIndex) && structuralStepIndex >= Number(introductionStepIndex)) {
                return;
              }
              if (stepTargetSubtreeIds.has(normalizedLandingTargetId)) return;
              const landingNode = findNodeByIdInForest([canvasRoot], normalizedLandingTargetId);
              collectSyntaxSubtreeNodeIds(landingNode).forEach((nodeId) => suppressedIds.add(nodeId));
              suppressedIds.add(normalizedLandingTargetId);
              suppressedIds.add(`${normalizedLandingTargetId}::__leaf`);
              suppressedIds.add(getReplaySilentHeadNodeId(normalizedLandingTargetId));
              suppressedIds.add(getReplaySilentNullNodeId(normalizedLandingTargetId));
            });
            if (suppressedIds.size === 0) return snapshot.visibleNodeIds;
            return snapshot.visibleNodeIds.filter((nodeId) => {
              const normalizedNodeId = String(nodeId || '').trim();
              const strippedNodeId = stripSyntheticReplayLeafSuffix(normalizedNodeId);
              return !suppressedIds.has(normalizedNodeId) && !suppressedIds.has(strippedNodeId);
            });
          })();
          return {
            ...step,
            replayCanvasData: snapshot.canvasData,
            replayVisibleNodeIds: activeRelationIndexes.size > 0
              ? visibleNodeIds
              : hideInactivePendingLandingLayoutLeaves(visibleNodeIds),
            replayRelationLinks: snapshot.relationLinks
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
            operation: placement.relationLabel as DerivationStep['operation'],
            replayKind: 'relation',
            targetNodeId: resolvedTargetNodeId || frameSemanticStep.targetNodeId,
            targetLabel:
              getReplayNodeOvertYieldFromCanvas(relationReplaySnapshot.canvasData, resolvedTargetNodeId)
              || getReplayNodeDisplayFromCanvas(relationReplaySnapshot.canvasData, resolvedTargetNodeId)
              || getReplayNodeCategoryFromCanvas(relationReplaySnapshot.canvasData, resolvedTargetNodeId)
              || placement.relationLabel,
            sourceNodeIds: resolvedSourceNodeIds.length > 0
              ? resolvedSourceNodeIds
              : (resolvedSourceNodeIds.length > 0 ? resolvedSourceNodeIds : frameSemanticStep.sourceNodeIds),
            sourceLabels: resolvedSourceNodeIds
              .map((nodeId) =>
                getReplayNodeOvertYieldFromCanvas(relationReplaySnapshot.canvasData, nodeId)
                || getReplayNodeDisplayFromCanvas(relationReplaySnapshot.canvasData, nodeId)
                || getReplayNodeCategoryFromCanvas(relationReplaySnapshot.canvasData, nodeId)
              )
              .filter(Boolean),
            recipe: placement.relationLabel,
            note: undefined,
            stageRecord: getFrameStageRecordText(frame, plannedStage),
            ledgerBlocks: buildVisualRelationReplayBlocks([placement.relation], relationReplaySnapshot.canvasData),
            replayCanvasData: relationReplaySnapshot.canvasData,
            replayVisibleNodeIds: relationReplaySnapshot.visibleNodeIds,
            replayRelationLinks: relationReplaySnapshot.relationLinks
          } satisfies PlaybackStep;
        };
        const interleavedSteps: PlaybackStep[] = [];
        const activeRelationIndexes = new Set<number>();
        const pendingRelationPlacements = [...relationPlacements];
        structuralSteps.forEach((step, structuralStepIndex) => {
          interleavedSteps.push(rebuildStructuralStepForActiveRelations(step, activeRelationIndexes, structuralStepIndex));
          while (
            pendingRelationPlacements.length > 0
            && pendingRelationPlacements[0].insertAfterStepIndex === structuralStepIndex
          ) {
            const placement = pendingRelationPlacements.shift();
            if (!placement) break;
            activeRelationIndexes.add(placement.relationIndex);
            interleavedSteps.push(buildRelationPlaybackStep(placement, activeRelationIndexes, step));
          }
        });
        while (pendingRelationPlacements.length > 0) {
          const placement = pendingRelationPlacements.shift();
          if (!placement) break;
          activeRelationIndexes.add(placement.relationIndex);
          interleavedSteps.push(buildRelationPlaybackStep(
            placement,
            activeRelationIndexes,
            structuralSteps[structuralSteps.length - 1]
          ));
        }
        const stageStepCount = interleavedSteps.length + 1;
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
        const completedStageReplayStep = interleavedSteps[interleavedSteps.length - 1];
        return [
          ...interleavedSteps.map((step) => annotateStep(step, step.replayKind || 'micro')),
          annotateStep(
            {
              ...frameSemanticStep,
              operation: 'StageRecord' as DerivationStep['operation'],
              replayKind: 'macro',
              ledgerBlocks: mergeReplayLedgerBlocks(frameStageRecordBlocks),
              note: undefined,
              recipe:
                String(plannedStage.statement || '').trim()
                || frameSemanticStep.recipe
                || `Stage ${plannedStage.stageNumber}`,
              replayCanvasData: completedStageReplayStep?.replayCanvasData || frameSemanticStep.replayCanvasData,
              replayVisibleNodeIds: Array.isArray(completedStageReplayStep?.replayVisibleNodeIds)
                ? completedStageReplayStep.replayVisibleNodeIds
                : frameSemanticStep.replayVisibleNodeIds,
              replayRelationLinks: Array.isArray(completedStageReplayStep?.replayRelationLinks)
                ? completedStageReplayStep.replayRelationLinks
                : frameSemanticStep.replayRelationLinks
            },
            'macro'
          )
        ];
      }
      if (frameCarriesAuthoredEffect) {
        return [...structuralSteps, frameSemanticStep];
      }
        return attachReplayLedgerBlocksToLastStep(structuralSteps, frameCommitmentBlocks);
    };

    const rootIntroductionMicrosteps =
      !frameHasMovementPayload &&
      !isMoveLikeOperation(fallbackOperation) &&
      String(fallbackOperation || '').trim() !== 'SpellOut' &&
      structuralWorkspaceRoots.length > 1 &&
      newlyIntroducedRootIds.size > 0
        ? buildStructuralDerivationPlaybackSteps(
            structuralWorkspaceRoots,
            index,
            priorVisibleNodeIds,
            authoredPreviousRelationRelationLinks,
            newlyIntroducedRootIds,
            frames,
            frame,
            sentence,
            []
          )
        : [];
    if (rootIntroductionMicrosteps.length > 1) {
      previousWorkspaceRootIds = currentWorkspaceRootIds;
      previousVisibleNodeIds = currentFrameVisibleNodeIds;
      return finalizeStructuralReplayForFrame(rootIntroductionMicrosteps);
    }

    const structuralMicrosteps = !frameHasMovementPayload && !isMoveLikeOperation(fallbackOperation) && String(fallbackOperation || '').trim() !== 'SpellOut'
      ? buildStructuralDerivationPlaybackSteps(
          structuralWorkspaceRoots,
          index,
          priorVisibleNodeIds,
          authoredPreviousRelationRelationLinks,
          undefined,
          frames,
          frame,
          sentence,
          []
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
        return attachReplayLedgerBlocksToLastStep(structuralMicrosteps, frameCommitmentBlocks);
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
          const leafTarget = getReplayLeafSelectionTarget(root);
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
              preferredWorkspaceRootSideHints
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
            preferredWorkspaceRootSideHints
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

    return [frameSemanticStep];
  });

  const expandedFrameBackedSteps = frameBackedSteps.flatMap((step, index) => {
    const microOperations = Array.isArray(step.microOperations)
      ? step.microOperations.filter(Boolean)
      : [];
    if (microOperations.length <= 1) {
      return [{ ...step, microOperations: undefined }];
    }

    const previousFrameIndex = index > 0 ? index - 1 : -1;
    return microOperations.map((operation, microIndex) => {
      const isFinalMicroStep = microIndex === microOperations.length - 1;
      const readableWorkspace = Array.isArray(step.workspaceAfter) && step.workspaceAfter.length > 0
        ? step.workspaceAfter
        : step.sourceLabels;
      return {
        ...step,
        operation,
        microOperations: undefined,
        visualFrameIndex: isFinalMicroStep ? index : previousFrameIndex,
        stepId: step.stepId ? `${step.stepId}.${microIndex + 1}` : undefined,
        recipe: isFinalMicroStep
          ? step.recipe
          : buildStructuralReplayFallback(operation, step.targetLabel, readableWorkspace || []),
        workspaceAfter: isFinalMicroStep ? step.workspaceAfter : undefined,
        spelloutOrder: isFinalMicroStep ? step.spelloutOrder : undefined,
        featureChecking: isFinalMicroStep ? step.featureChecking : undefined,
        ledgerBlocks: isFinalMicroStep ? step.ledgerBlocks : undefined,
        note: isFinalMicroStep ? step.note : undefined
      };
    });
  });

  const squashedFrameBackedSteps = squashAdjacentStructuralReplayDuplicates(expandedFrameBackedSteps);
  const visibilityStabilizedSteps = stabilizeStructuralReplayVisibility(squashedFrameBackedSteps);
  const zeroDeltaCollapsedSteps = collapseZeroDeltaReplaySteps(visibilityStabilizedSteps);
  const nonSpellout = zeroDeltaCollapsedSteps.filter((step) => String(step.operation || '').trim() !== 'SpellOut');
  const spellout = zeroDeltaCollapsedSteps.filter((step) => String(step.operation || '').trim() === 'SpellOut');
  return [...nonSpellout, ...spellout];
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
      step.sourceKind !== 'derivation-effect' &&
      String(previous?.operation || '').trim() !== 'SpellOut' &&
      String(step.operation || '').trim() !== 'SpellOut';

    if (sameVisualFrame && sameOperation && sameTarget && structuralOnly && previous) {
      squashed[squashed.length - 1] = {
        ...previous,
        stepId: step.stepId || previous.stepId,
        trigger: step.trigger || previous.trigger,
        spelloutDomain: step.spelloutDomain || previous.spelloutDomain,
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
        featureChecking:
          (Array.isArray(step.featureChecking) && step.featureChecking.length > 0)
            ? step.featureChecking
            : previous.featureChecking,
        ledgerBlocks:
          (Array.isArray(step.ledgerBlocks) && step.ledgerBlocks.length > 0)
            ? step.ledgerBlocks
            : previous.ledgerBlocks,
        spelloutOrder:
          (Array.isArray(step.spelloutOrder) && step.spelloutOrder.length > 0)
            ? step.spelloutOrder
            : previous.spelloutOrder
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
      String(previous.operation || '').trim() !== 'SpellOut' &&
      String(step.operation || '').trim() !== 'SpellOut' &&
      String(previous.operation || '').trim() !== 'LexicalSelect' &&
      String(step.operation || '').trim() !== 'LexicalSelect' &&
      buildReplayVisualStateSignature(previous) === buildReplayVisualStateSignature(step);

    if (!sameVisualState || !previous) {
      collapsed.push(step);
      return;
    }

    collapsed[collapsed.length - 1] = {
      ...previous,
      trigger: step.trigger || previous.trigger,
      spelloutDomain: step.spelloutDomain || previous.spelloutDomain,
      recipe: pickPreferredReplayText(previous.recipe, step.recipe) || previous.recipe || step.recipe,
      note: pickPreferredReplayText(previous.note, step.note) || previous.note || step.note,
      workspaceAfter:
        (Array.isArray(step.workspaceAfter) && step.workspaceAfter.length > 0)
          ? step.workspaceAfter
          : previous.workspaceAfter,
      featureChecking:
        (Array.isArray(step.featureChecking) && step.featureChecking.length > 0)
          ? step.featureChecking
          : previous.featureChecking,
      ledgerBlocks: mergeReplayLedgerBlocks(previous.ledgerBlocks, step.ledgerBlocks),
      spelloutOrder:
        (Array.isArray(step.spelloutOrder) && step.spelloutOrder.length > 0)
          ? step.spelloutOrder
          : previous.spelloutOrder
    };
  });

  return collapsed;
};

const stabilizeStructuralReplayVisibility = (steps: PlaybackStep[]): PlaybackStep[] => {
  if (steps.length === 0) return steps;

  const persistentProjectedNodeIds = new Set<string>();
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

    const nextVisibleIds = new Set(
      rawVisibleIds.filter((visibleNodeId) => !suppressedAutoRevealNodeIds.has(visibleNodeId))
    );
    const revealProjectedNode = (nodeId: string) => {
      const node = findNodeByIdInForest([canvas], nodeId);
      if (!node) return;
      collectSubtreeNodeIds(node).forEach((visibleNodeId) => {
        if (suppressedAutoRevealNodeIds.has(visibleNodeId)) return;
        nextVisibleIds.add(visibleNodeId);
      });
    };

    persistentProjectedNodeIds.forEach(revealProjectedNode);
    if (step.operation === 'Project' && String(step.targetNodeId || '').trim()) {
      const targetNodeId = String(step.targetNodeId || '').trim();
      revealProjectedNode(targetNodeId);
      persistentProjectedNodeIds.add(targetNodeId);
    }

    return {
      ...step,
      replayVisibleNodeIds: Array.from(nextVisibleIds)
    };
  });
};

const dropLowSignalStructuralFrameSummaries = (steps: PlaybackStep[]): PlaybackStep[] => {
  if (steps.length < 2) return steps;

  const filtered: PlaybackStep[] = [];
  steps.forEach((step) => {
    const previous = filtered[filtered.length - 1];
    const sameVisualFrame =
      previous &&
      Number.isInteger(previous.visualFrameIndex) &&
      Number.isInteger(step.visualFrameIndex) &&
      previous.visualFrameIndex === step.visualFrameIndex;
    const structuralOnly =
      !stepRepresentsMovement(step) &&
      String(step.operation || '').trim() !== 'SpellOut';
    const lowSignalSummary =
      isLowSignalReplayText(step.recipe) &&
      (!step.note || isLowSignalReplayText(step.note));

    if (sameVisualFrame && structuralOnly && lowSignalSummary && previous) {
      filtered[filtered.length - 1] = {
        ...previous,
        stepId: step.stepId || previous.stepId,
        trigger: step.trigger || previous.trigger,
        spelloutDomain: step.spelloutDomain || previous.spelloutDomain,
        workspaceAfter:
          (Array.isArray(step.workspaceAfter) && step.workspaceAfter.length > 0)
            ? step.workspaceAfter
            : previous.workspaceAfter
      };
      return;
    }

    filtered.push(step);
  });

  return filtered;
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
  collectLeafSyntaxNodes(root).filter((leaf) => {
    const surface = String(leaf?.word || leaf?.label || '').trim();
    return Boolean(surface)
      && !isTraceLike(surface)
      && !isNullLike(surface)
      && !isStructuralCategorySurface(surface);
  }).length;

const collectReplayOvertTokenMultisetKey = (forest: SyntaxNode[] = []): string => {
  const tokens = forest
    .flatMap((root) => collectLeafSyntaxNodes(root))
    .map((leaf) => String(leaf?.word || leaf?.label || '').trim())
    .filter((surface) =>
      Boolean(surface)
      && !isTraceLike(surface)
      && !isNullLike(surface)
      && !isStructuralCategorySurface(surface)
    )
    .map((surface) => normalizeToken(surface))
    .filter(Boolean)
    .sort();
  return tokens.join('|');
};

const collectReplayOvertTokenSequence = (root?: SyntaxNode | null): string[] =>
  collectLeafSyntaxNodes(root)
    .map((leaf) => String(leaf?.word || leaf?.label || '').trim())
    .filter((surface) =>
      Boolean(surface)
      && !isTraceLike(surface)
      && !isNullLike(surface)
      && !isStructuralCategorySurface(surface)
    )
    .map((surface) => normalizeToken(surface))
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

const pickTraceLikeLeafNode = (root?: SyntaxNode | null): SyntaxNode | null => {
  const leaves = collectLeafSyntaxNodes(root);
  return leaves.find((leaf) => {
    const surface = String(leaf?.word || leaf?.label || '').trim();
    return isTraceLike(surface) || isNullLike(surface);
  }) || null;
};

const pickOvertLeafNode = (root?: SyntaxNode | null): SyntaxNode | null => {
  const leaves = collectLeafSyntaxNodes(root);
  return leaves.find((leaf) => {
    const surface = String(leaf?.word || leaf?.label || '').trim();
    return Boolean(surface)
      && !isTraceLike(surface)
      && !isNullLike(surface)
      && !isStructuralCategorySurface(surface);
  }) || null;
};

const pickSingletonLeafNode = (root?: SyntaxNode | null): SyntaxNode | null => {
  const leaves = collectLeafSyntaxNodes(root);
  return leaves.length === 1 ? leaves[0] : null;
};

const materializeMissingTraceLeavesFromRelationLinks = (
  root: SyntaxNode,
  links?: ResolvedVisualRelation[]
): SyntaxNode => {
  if (!root || !Array.isArray(links) || links.length === 0) return root;

  const materializeSilentLeavesAsTraceLeaves = (node: SyntaxNode): SyntaxNode => {
    const next = cloneSyntaxTree(node) || node;
    const children = Array.isArray(next.children) ? next.children : [];
    if (children.length === 0) {
      const surface = String(next.word || next.label || '').trim();
      if (isTraceLike(surface) || isNullLike(surface) || !surface) {
        return {
          ...next,
          label: 't',
          word: 't'
        };
      }
      return next;
    }
    next.children = children.map(materializeSilentLeavesAsTraceLeaves);
    return next;
  };

  const clonedRoot = cloneSyntaxTree(root);
  if (!clonedRoot) return root;
  const forest = [clonedRoot];

  links.forEach((link) => {
    const traceId = String(link?.witnessNodeId || '').trim();
    if (!traceId) return;

    const tracePath = findNodePathInForest(forest, traceId);
    const traceNode = getNodeAtForestPath(forest, tracePath);
    if (!traceNode) return;
    if (pickOvertLeafNode(traceNode)) return;
    const traceChildren = Array.isArray(traceNode.children) ? traceNode.children : [];
    if (traceChildren.length > 0) {
      replaceNodeAtForestPath(forest, tracePath, materializeSilentLeavesAsTraceLeaves(traceNode));
      return;
    }
    const traceSurface = String(traceNode.word || traceNode.label || '').trim();
    if (isTraceLike(traceSurface) && !isNullLike(traceSurface)) return;
    if (isNullLike(traceSurface) || !traceSurface) {
      replaceNodeAtForestPath(forest, tracePath, {
        ...traceNode,
        label: 't',
        word: 't'
      });
      return;
    }

    replaceNodeAtForestPath(forest, tracePath, {
      id: String(traceNode.id || '').trim() || traceId,
      label: String(traceNode.label || '').trim() || 'XP',
      children: [{
        id: buildSyntheticReplayLeafId(traceNode, 'trace', 't'),
        label: 't',
        word: 't'
      }]
    });
  });

  return forest[0];
};

const findParentLabelInForest = (
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

const findAliasNodeCandidatesInForest = (forest: SyntaxNode[], aliasNodeId: string): SyntaxNode[] => {
  const normalizedAliasNodeId = String(aliasNodeId || '').trim();
  if (!normalizedAliasNodeId) return [];
  const candidates: SyntaxNode[] = [];
  const visit = (node: SyntaxNode) => {
    if ((Array.isArray(node.aliasIds) ? node.aliasIds : []).some((aliasId) => String(aliasId || '').trim() === normalizedAliasNodeId)) {
      candidates.push(node);
    }
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach(visit);
  };
  forest.forEach(visit);
  return candidates;
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

const stripSyntheticReplayLeafSuffix = (value?: string): string =>
  String(value || '').trim().replace(/::__[^:]+$/, '');

const replaceNodeAtForestPath = (forest: SyntaxNode[], path: number[] | null, nextNode: SyntaxNode): void => {
  if (!Array.isArray(path) || path.length === 0) return;
  if (path.length === 1) {
    forest[path[0]] = nextNode;
    return;
  }

  const parent = getNodeAtForestPath(forest, path.slice(0, -1));
  if (!parent || !Array.isArray(parent.children)) return;
  parent.children[path[path.length - 1]] = nextNode;
};

const removeNodeAtForestPath = (forest: SyntaxNode[], path: number[] | null): void => {
  if (!Array.isArray(path) || path.length === 0) return;
  if (path.length === 1) {
    forest.splice(path[0], 1);
    return;
  }
  const parent = getNodeAtForestPath(forest, path.slice(0, -1));
  if (!parent || !Array.isArray(parent.children)) return;
  parent.children.splice(path[path.length - 1], 1);
};

const findMovementSourceCarrierPath = (
  forest: SyntaxNode[],
  link: ResolvedVisualRelation
): number[] | null => {
  const sourceId = String(link.sourceNodeId || link.witnessNodeId || '').trim();
  if (!sourceId) return null;
  const sourcePath = findNodePathInForest(forest, sourceId);
  if (!sourcePath) return null;
  const sourceNode = getNodeAtForestPath(forest, sourcePath);
  const sourceSurface = String(sourceNode?.word || sourceNode?.label || '').trim();
  if (
    sourcePath.length > 1
    && sourceNode
    && (!Array.isArray(sourceNode.children) || sourceNode.children.length === 0)
    && (isTraceLike(sourceSurface) || isNullLike(sourceSurface))
  ) {
    return sourcePath.slice(0, -1);
  }
  return sourcePath;
};

const getOvertSurfaceFromSyntaxNode = (node?: SyntaxNode | null): string => {
  if (!node || typeof node !== 'object') return '';
  const directWord = String(node.word || '').trim();
  if (directWord && !isTraceLike(directWord) && !isNullLike(directWord)) return directWord;
  const leaf = pickOvertLeafNode(node);
  return String(leaf?.word || leaf?.label || '').trim();
};

const makePreRelationHeadSourceNode = (
  sourceCarrier: SyntaxNode,
  targetNode: SyntaxNode
): SyntaxNode => {
  const movedSurface = getOvertSurfaceFromSyntaxNode(targetNode);
  const next: SyntaxNode = { ...sourceCarrier };
  const sourceChildren = Array.isArray(sourceCarrier?.children) ? sourceCarrier.children : [];
  if (sourceChildren.length > 0) {
    // A complex head source must stay internally visible until its own movement fires.
    // Do not collapse have + -n't into the later Infl spelling "hasn't" early.
    return next;
  }
  if (movedSurface) {
    next.word = movedSurface;
    delete (next as any).silent;
    delete next.children;
  }
  return next;
};

const findResidentPreRelationHeadLeaf = (
  targetNode: SyntaxNode,
  sourceCarrier?: SyntaxNode | null
): SyntaxNode | null => {
  const targetChildren = Array.isArray(targetNode?.children) ? targetNode.children : [];
  if (targetChildren.length === 0) return null;

  const sourceSurfaceKey = normalizeToken(getOvertSurfaceFromSyntaxNode(sourceCarrier || undefined));
  let resident: SyntaxNode | null = null;
  const visit = (node: SyntaxNode): void => {
    if (resident) return;
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length > 0) {
      children.forEach(visit);
      return;
    }
    const surface = String(node.word || node.label || '').trim();
    if (!surface || isNullLike(surface) || isTraceLike(surface) || isStructuralCategorySurface(surface)) return;
    const surfaceKey = normalizeToken(surface);
    if (sourceSurfaceKey && surfaceKey === sourceSurfaceKey) return;
    resident = cloneSyntaxTree(node) || node;
  };

  targetChildren.forEach(visit);
  return resident;
};

const targetHasResidentPreRelationHeadLeaf = (
  targetNode?: SyntaxNode | null,
  sourceCarrier?: SyntaxNode | null
): boolean => Boolean(targetNode && findResidentPreRelationHeadLeaf(targetNode, sourceCarrier));

const makePreRelationHeadTargetNode = (
  targetNode: SyntaxNode,
  sourceCarrier?: SyntaxNode | null
): SyntaxNode => {
  const next: SyntaxNode = { ...targetNode };
  delete next.word;
  const targetNodeId = String(targetNode?.id || 'landing').trim() || 'landing';
  const targetLabel = String(targetNode?.label || '').trim() || 'head';
  const residentLeaf = findResidentPreRelationHeadLeaf(targetNode, sourceCarrier);
  if (residentLeaf) {
    const residentNodeId = String(residentLeaf.id || '').trim();
    const residentSurface = String(residentLeaf.word || residentLeaf.label || '').trim();
    next.children = [{
      ...residentLeaf,
      id: residentNodeId || `${targetNodeId}::__resident_leaf`,
      label: residentSurface || residentLeaf.label || targetLabel,
      word: residentSurface || residentLeaf.word,
      silent: false
    }];
    return next;
  }
  next.children = [{
    id: getReplaySilentNullNodeId(targetNodeId),
    label: EXPLICIT_NULL_TERMINAL,
    word: EXPLICIT_NULL_TERMINAL,
    silent: true
  }];
  return next;
};

const makePreRelationPhrasalTargetNode = (targetNode: SyntaxNode): SyntaxNode => {
  const next: SyntaxNode = { ...targetNode };
  delete next.word;
  delete (next as any).silent;
  const targetChildren = Array.isArray(targetNode?.children) ? targetNode.children : [];
  if (targetChildren.length > 0) {
    next.children = targetChildren.map((child) => makePreRelationPhrasalTargetNode(child));
    return next;
  }
  next.children = [{
    id: `${String(targetNode?.id || 'landing').trim() || 'landing'}::__null`,
    label: EXPLICIT_NULL_TERMINAL
  }];
  return next;
};

const makePreRelationPhrasalSourceNode = (
  sourceCarrier: SyntaxNode,
  targetNode: SyntaxNode
): SyntaxNode => {
  const next: SyntaxNode = { ...sourceCarrier };
  const targetWord = String(targetNode?.word || '').trim();
  const targetChildren = Array.isArray(targetNode?.children) ? targetNode.children : [];
  const sourceChildren = Array.isArray(sourceCarrier?.children) ? sourceCarrier.children : [];

  if (targetWord) {
    next.word = targetWord;
    delete (next as any).silent;
    if ('tokenIndex' in targetNode) next.tokenIndex = targetNode.tokenIndex;
    if ('surfaceSpan' in targetNode) next.surfaceSpan = targetNode.surfaceSpan;
    if (targetChildren.length === 0) {
      delete next.children;
      return next;
    }
  } else {
    delete next.word;
  }

  const sourceIsSilentPlaceholder =
    Boolean((sourceCarrier as any)?.silent)
    || (
      sourceChildren.length > 0
      && sourceChildren.every((child) => {
        const childSurface = String(child?.word || child?.label || '').trim();
        return isTraceLike(childSurface) || isNullLike(childSurface) || Boolean((child as any)?.silent);
      })
    );
  const sourceHasParallelCategorySkeleton =
    sourceChildren.length > 0
    && targetChildren.length > 0
    && sourceChildren.length === targetChildren.length
    && sourceChildren.every((sourceChild, childIndex) =>
      normalizeStructuralLabel(sourceChild?.label) === normalizeStructuralLabel(targetChildren[childIndex]?.label)
    );

  if (sourceIsSilentPlaceholder && targetChildren.length > 0 && !sourceHasParallelCategorySkeleton) {
    const restored = cloneSyntaxTree(targetNode) || targetNode;
    return {
      ...restored,
      id: String(sourceCarrier.id || restored.id || '').trim() || restored.id,
      lineageId: String(sourceCarrier.lineageId || restored.lineageId || '').trim() || restored.lineageId,
      aliasIds: Array.from(new Set([
        ...(Array.isArray(restored.aliasIds) ? restored.aliasIds : []),
        ...(Array.isArray(sourceCarrier.aliasIds) ? sourceCarrier.aliasIds : [])
      ].map((aliasId) => String(aliasId || '').trim()).filter(Boolean)))
    };
  }

  if (sourceChildren.length > 0 && targetChildren.length > 0) {
    next.children = sourceChildren.map((sourceChild, childIndex) => {
      const matchingTargetChild =
        targetChildren[childIndex]
        || targetChildren.find((candidate) =>
          String(candidate?.label || '').trim() === String(sourceChild?.label || '').trim()
        )
        || targetChildren[0];
      return makePreRelationPhrasalSourceNode(sourceChild, matchingTargetChild);
    });
    return next;
  }

  if (sourceChildren.length > 0) {
    const targetSurface = getOvertSurfaceFromSyntaxNode(targetNode);
    if (targetSurface) {
      next.word = targetSurface;
      delete next.children;
    }
    return next;
  }

  const targetSurface = getOvertSurfaceFromSyntaxNode(targetNode);
  if (targetSurface) {
    next.word = targetSurface;
    delete (next as any).silent;
  }
  return next;
};

const buildPreRelationWorkspaceForest = (
  forest: SyntaxNode[],
  relationLinks: ResolvedVisualRelation[] = []
): SyntaxNode[] => {
  if (!Array.isArray(forest) || forest.length === 0 || relationLinks.length === 0) {
    return cloneSyntaxForest(forest);
  }
  const nextForest = cloneSyntaxForest(forest);

  relationLinks.forEach((link) => {
    const targetId = String(link.targetNodeId || '').trim();
    if (!targetId) return;
    const targetPath = findNodePathInForest(nextForest, targetId);
    const targetNode = cloneSyntaxTree(getNodeAtForestPath(nextForest, targetPath));
    if (!targetPath || !targetNode) return;

    const sourceCarrierPath = findMovementSourceCarrierPath(nextForest, link);
    const sourceCarrier = cloneSyntaxTree(getNodeAtForestPath(nextForest, sourceCarrierPath));
    if (!sourceCarrierPath || !sourceCarrier) return;

    if (isHeadLikeResolvedRelation(link)) {
      replaceNodeAtForestPath(
        nextForest,
        sourceCarrierPath,
        makePreRelationHeadSourceNode(sourceCarrier, targetNode)
      );
      const refreshedTargetPath = findNodePathInForest(nextForest, targetId);
      const refreshedTargetNode = cloneSyntaxTree(getNodeAtForestPath(nextForest, refreshedTargetPath));
      if (refreshedTargetPath && refreshedTargetNode) {
        replaceNodeAtForestPath(nextForest, refreshedTargetPath, makePreRelationHeadTargetNode(refreshedTargetNode, sourceCarrier));
      }
      return;
    }

    const keepSilentLandingPlaceholder = !isFrontingLikeOperationLabel(link.operation || link.relation);
    if (keepSilentLandingPlaceholder) {
      replaceNodeAtForestPath(nextForest, targetPath, makePreRelationPhrasalTargetNode(targetNode));
    } else {
      removeNodeAtForestPath(nextForest, targetPath);
    }
    const refreshedSourcePath = findMovementSourceCarrierPath(nextForest, link);
    if (refreshedSourcePath) {
      const refreshedSourceCarrier = cloneSyntaxTree(getNodeAtForestPath(nextForest, refreshedSourcePath));
      if (refreshedSourceCarrier) {
        replaceNodeAtForestPath(
          nextForest,
          refreshedSourcePath,
          makePreRelationPhrasalSourceNode(refreshedSourceCarrier, targetNode)
        );
      }
    }
  });

  return nextForest;
};

const resolvedRelationLinkKey = (link?: ResolvedVisualRelation | null): string => [
  String(link?.relationIndex || '').trim(),
  String(link?.operation || '').trim(),
  String(link?.sourceNodeId || '').trim(),
  String(link?.targetNodeId || '').trim(),
  String(link?.witnessNodeId || '').trim(),
  String(link?.chainId || '').trim()
].join('|');

const filterResolvedRelationLinks = (
  links: ResolvedVisualRelation[] | undefined,
  suppressedLinks: ResolvedVisualRelation[] = []
): ResolvedVisualRelation[] => {
  const sourceLinks = Array.isArray(links) ? links : [];
  if (!Array.isArray(suppressedLinks) || suppressedLinks.length === 0) return sourceLinks;
  const suppressedKeys = new Set(suppressedLinks.map((link) => resolvedRelationLinkKey(link)));
  const matchesSuppressedLink = (link: ResolvedVisualRelation): boolean => {
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

const isPhrasalMovementLabel = (label?: string): boolean => {
  const trimmed = String(label || '').trim();
  if (!trimmed) return false;
  if (/[’']$/.test(trimmed)) return true;
  return /P$/i.test(trimmed);
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

const isStructuralCategorySurface = (surface?: string): boolean => {
  const normalized = normalizeStructuralLabel(surface);
  if (!normalized) return false;
  return isHeadShellLabel(normalized) || isPhraseShellLabel(normalized);
};

const normalizeMovementOperationLabel = (operation?: string): string =>
  String(operation || '').trim().toLowerCase().replace(/[^a-z]/g, '');

const HEAD_LIKE_OPERATION_RE = /(?:headmove|headmovement|lower|lowering|affix|clitic|incorpor)/i;
const FRONTING_OPERATION_RE = /(?:abar|wh|front|focus|topic|displac|extract|scrambl|rollup|sideward)/i;
const normalizeTrajectoryKind = (kind?: ResolvedVisualRelation['trajectoryKind'] | string): ResolvedVisualRelation['trajectoryKind'] | '' => {
  const normalized = String(kind || '').trim().toLowerCase();
  if (normalized === 'head' || normalized === 'phrasal') return normalized;
  return '';
};

const isHeadLikeOperationLabel = (operation?: string): boolean => {
  const normalized = normalizeMovementOperationLabel(operation);
  if (!normalized) return false;
  return HEAD_LIKE_OPERATION_RE.test(normalized);
};

const isFrontingLikeOperationLabel = (operation?: string): boolean => {
  const raw = String(operation || '').trim();
  if (/a\s*(?:['\u2032]|bar|prime)\s*[-\s]?movement/i.test(raw)) return true;
  if (/^phrasal[-\s]?movement$/i.test(raw)) return true;
  const normalized = normalizeMovementOperationLabel(operation);
  if (!normalized) return false;
  return FRONTING_OPERATION_RE.test(normalized);
};

const isPhrasalTrajectoryOperationLabel = (operation?: string): boolean => {
  const raw = String(operation || '').trim();
  if (/^a\s*[-\s]?movement$/i.test(raw)) return true;
  if (isFrontingLikeOperationLabel(raw)) return true;
  const normalized = normalizeMovementOperationLabel(raw);
  if (!normalized) return false;
  return /(?:phrasal|raising|remnant|scrambl|rollup|sideward|extraposit|shift|atb|parasitic)/i.test(normalized);
};

const isNodeOrImmediateParentHeadShellInForest = (
  forest: SyntaxNode[],
  nodeId?: string
): boolean => {
  const normalizedNodeId = String(nodeId || '').trim();
  if (!normalizedNodeId) return false;
  const nodePath = findNodePathInForest(forest, normalizedNodeId);
  const node = getNodeAtForestPath(forest, nodePath);
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
}): ResolvedVisualRelation['trajectoryKind'] => {
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
  link?: ResolvedVisualRelation | null
): ResolvedVisualRelation['trajectoryKind'] | '' => {
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

const isHeadLikeResolvedRelation = (
  link?: ResolvedVisualRelation | null,
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
        .filter((kind): kind is NonNullable<ResolvedVisualRelation['trajectoryKind']> => Boolean(kind))
    : [];
  if (linkKinds.includes('head')) return 'head';
  if (linkKinds.includes('phrasal')) return 'phrasal';
  return isHeadLikeOperationLabel(step?.operation) ? 'head' : '';
};

const isHeadLikePlaybackStep = (step?: PlaybackStep | null): boolean =>
  inferPlaybackStepTrajectoryKind(step) === 'head';

const findNearestAncestorAtPath = (
  forest: SyntaxNode[],
  path: number[] | null,
  predicate: (node: SyntaxNode) => boolean
): SyntaxNode | null => {
  if (!Array.isArray(path) || path.length === 0) return null;
  for (let length = path.length; length >= 1; length -= 1) {
    const candidate = getNodeAtForestPath(forest, path.slice(0, length));
    if (candidate && predicate(candidate)) return candidate;
  }
  return null;
};

const deriveTraceShellLabelFromMovementLink = ({
  forest,
  tracePath,
  movedPath,
  trajectoryKind,
  operation,
  traceParent
}: {
  forest: SyntaxNode[];
  tracePath: number[] | null;
  movedPath: number[] | null;
  trajectoryKind?: ResolvedVisualRelation['trajectoryKind'];
  operation?: string;
  traceParent?: SyntaxNode | null;
}): string => {
  const linkLooksHeadLike = normalizeTrajectoryKind(trajectoryKind)
    ? normalizeTrajectoryKind(trajectoryKind) === 'head'
    : isHeadLikeOperationLabel(operation);

  if (linkLooksHeadLike) {
    const parentLabel = String(traceParent?.label || '').trim();
    if (PRIME_CATEGORY_LABEL_RE.test(parentLabel)) {
      const stripped = normalizeStructuralLabel(parentLabel);
      if (isHeadShellLabel(stripped)) return stripped;
    }
    if (isHeadShellLabel(parentLabel)) return normalizeStructuralLabel(parentLabel);

    const movedHeadAncestor = findNearestAncestorAtPath(forest, movedPath, (node) =>
      isHeadShellLabel(node?.label)
    );
    if (movedHeadAncestor) {
      return normalizeStructuralLabel(movedHeadAncestor.label);
    }
  } else {
    const movedPhraseAncestor = findNearestAncestorAtPath(forest, movedPath, (node) =>
      isPhraseShellLabel(node?.label)
    );
    if (movedPhraseAncestor) {
      return String(movedPhraseAncestor.label || '').trim();
    }
  }

  return '';
};

const materializeTraceShellsFromRelationLinks = (
  root: SyntaxNode,
  links?: ResolvedVisualRelation[]
): SyntaxNode => {
  if (!root || !Array.isArray(links) || links.length === 0) return root;

  const buildRenderableTraceLeafNode = (traceNode: SyntaxNode, traceId: string): SyntaxNode => {
    const rawWord = String(traceNode?.word || '').trim();
    const rawLabel = String(traceNode?.label || '').trim();
    const leafSurface = rawWord
      || ((isTraceLike(rawLabel) || isNullLike(rawLabel)) ? rawLabel : '')
      || (isNullLike(rawLabel) ? EXPLICIT_NULL_TERMINAL : 't');
    return {
      id: traceId,
      label: leafSurface,
      word: leafSurface
    };
  };

  const clonedRoot = cloneSyntaxTree(root);
  if (!clonedRoot) return root;
  const forest = [clonedRoot];

  links.forEach((link) => {
    const traceId = String(link?.witnessNodeId || '').trim();
    const movedId = String(link?.targetNodeId || '').trim();
    if (!traceId || !movedId) return;

    const tracePath = findNodePathInForest(forest, traceId);
    const movedPath = findNodePathInForest(forest, movedId);
    const traceNode = getNodeAtForestPath(forest, tracePath);
    const movedNode = findNodeByIdInForest(forest, movedId);
    if (!traceNode || !movedNode) return;

    const traceChildren = Array.isArray(traceNode.children) ? traceNode.children : [];
    const traceSurface = String(traceNode.word || traceNode.label || '').trim();
    if (traceChildren.length > 0) return;
    if (!isTraceLike(traceSurface) && !isNullLike(traceSurface)) return;

    const parentNode = getNodeAtForestPath(forest, Array.isArray(tracePath) ? tracePath.slice(0, -1) : null);
    const shellLabel = deriveTraceShellLabelFromMovementLink({
      forest,
      tracePath,
      movedPath,
      trajectoryKind: link?.trajectoryKind,
      operation: link?.operation,
      traceParent: parentNode
    });
    if (!shellLabel) return;
    const parentLabel = String(parentNode?.label || '').trim();
    if (parentLabel === shellLabel) return;

    replaceNodeAtForestPath(forest, tracePath, {
      id: `${traceId}__shell`,
      label: shellLabel,
      children: [buildRenderableTraceLeafNode(traceNode, traceId)]
    });
  });

  return forest[0];
};

const normalizeLabel = (label?: string): string =>
  String(label || '').trim().replace(/\s+/g, '').toUpperCase();

const isTraceOrNullLikeNode = (node?: SyntaxNode | null): boolean => {
  if (!node) return false;
  const surface = String(node.word || node.label || '').trim();
  return isTraceLike(surface) || isNullLike(surface);
};

const isBroadProjectionLike = (node?: SyntaxNode | null): boolean => {
  if (!node) return false;
  const normalized = normalizeLabel(node.label);
  return Boolean(node.children && node.children.length > 0)
    && (
      normalized.endsWith('P') ||
      normalized.endsWith("'") ||
      normalized === 'CP' ||
      normalized === 'INFLP' ||
      normalized === 'TP' ||
      normalized === 'IP' ||
      normalized === 'VP'
    );
};

const isPhrasalCategoryLabel = (label?: string): boolean => {
  const normalized = normalizeLabel(label);
  return normalized.endsWith('P')
    || normalized === "C'"
    || normalized === "T'"
    || normalized === "V'"
    || normalized === "N'"
    || normalized === "D'"
    || normalized === "P'"
    || normalized === "A'"
    || normalized === "ADV'"
    || normalized === "INFL'";
};

const subtreeHasOvertYield = (node?: SyntaxNode | null): boolean =>
  Boolean(pickOvertLeafNode(node));

const normalizeMovementStemFromNodeId = (value?: string): string => {
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

const normalizeReplayInferenceStem = (value?: string): string => {
  let normalized = normalizeMovementStemFromNodeId(String(value || '').replace(/::__.*$/g, ''));
  let previous = '';
  while (normalized && normalized !== previous) {
    previous = normalized;
    normalized = normalized
      .replace(/(?:^|[_-])(?:base|complex|head)$/gi, '')
      .replace(/^[_-]+|[_-]+$/g, '');
  }
  return normalized;
};

const extractReplaySourceCategoryHint = (rawNodeId?: string, node?: SyntaxNode | null): string => {
  const labelHint = normalizeLabel(node?.label);
  if (labelHint) return labelHint;

  const tokens = String(rawNodeId || '')
    .trim()
    .split(/[_-]+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  const token = [...tokens].reverse().find((candidate) => (
    candidate === 'cp'
    || candidate === 'cbar'
    || candidate === 'c'
    || candidate === 'inflp'
    || candidate === 'inflbar'
    || candidate === 'infl'
    || candidate === 'tp'
    || candidate === 'tbar'
    || candidate === 'vp'
    || candidate === 'vbar'
    || candidate === 'v'
    || candidate === 'dp'
    || candidate === 'dbar'
    || candidate === 'd'
    || candidate === 'np'
    || candidate === 'nbar'
    || candidate === 'n'
    || candidate === 'pp'
    || candidate === 'pbar'
    || candidate === 'p'
    || candidate === 'ap'
    || candidate === 'abar'
    || candidate === 'a'
    || candidate === 'advp'
    || candidate === 'advbar'
    || candidate === 'adv'
    || candidate === 'ip'
    || candidate === 'ibar'
    || candidate === 'i'
  ));
  if (!token) return '';
  if (token.endsWith('bar')) return `${token.charAt(0).toUpperCase()}'`;
  if (token === 'infl') return 'T';
  if (token === 'i') return 'T';
  if (token === 'v') return 'V';
  return token.toUpperCase();
};

const resolveDerivationMovementTransitions = (
  currentForest: SyntaxNode[],
  derivationFrames: ReplayDerivationFrame[] | undefined,
  activeStepIndex: number,
  resolvedRelationLinks?: ResolvedVisualRelation[]
): DerivationMovementTransition[] => {
  const frames = Array.isArray(derivationFrames) ? derivationFrames : [];
  if (frames.length === 0) return [];
  const currentNodesById = collectForestNodesById(currentForest);
  const currentNodeIds = new Set(currentNodesById.keys());
  const relationIndexByKey = new Map<string, string>();
  const explicitDerivationMovementSteps = new Set<number>();
  let nextRelationIndex = 1;

  const getCanonicalMovementIndex = (
    frame: ReplayDerivationFrame,
    sourceId: string,
    targetId: string,
    frameIndex: number
  ): string => {
    const key = String(frame.chainId || '').trim()
      || `${String(frame.operation || '').trim()}|${sourceId}|${targetId}|${frameIndex}`;
    const existing = relationIndexByKey.get(key);
    if (existing) return existing;
    const assigned = String(nextRelationIndex);
    nextRelationIndex += 1;
    relationIndexByKey.set(key, assigned);
    return assigned;
  };

  const transitions: DerivationMovementTransition[] = [];
  const transitionKeys = new Set<string>();
  const canonicalLinksByStep = new Map<number, ResolvedVisualRelation[]>();
  (Array.isArray(resolvedRelationLinks) ? resolvedRelationLinks : []).forEach((link) => {
    const step = Number.isInteger(link?.stepIndex) ? Number(link.stepIndex) : null;
    if (step === null) return;
    if (step > activeStepIndex) return;
    const bucket = canonicalLinksByStep.get(step) || [];
    bucket.push(link);
    canonicalLinksByStep.set(step, bucket);
  });
  for (let frameIndex = 0; frameIndex <= Math.min(activeStepIndex, frames.length - 1); frameIndex += 1) {
    const frame = frames[frameIndex];
    const movement = frame?.movement;
    const movementForest = Array.isArray(frame?.workspaceForest) ? frame.workspaceForest : [];
    const rawSourceId = String(movement?.sourceNodeId || '').trim();
    const rawTargetId = getMovementLandingNodeId(movement as {
      landingNodeId?: string;
      targetNodeId?: string;
      toNodeId?: string;
    });
    const normalizedMovementOperation = normalizeMovementOperationLabel(movement?.operation || frame?.operation);
    const movementLooksHeadLike = movement
      ? (
          inferHeadLikeTrajectoryKindFromForest({
            forest: movementForest,
            operation: normalizedMovementOperation,
            sourceNodeId: rawSourceId,
            targetNodeId: rawTargetId,
            traceNodeId: String((movement as any)?.traceNodeId || '').trim()
          }) === 'head'
        )
      : false;
    const canonicalStepLinks = (canonicalLinksByStep.get(frameIndex) || []).filter((link) => {
      const sourceId = String(link?.sourceNodeId || '').trim();
      const targetId = String(link?.targetNodeId || '').trim();
      return Boolean(sourceId && targetId && sourceId !== targetId && currentNodeIds.has(sourceId) && currentNodeIds.has(targetId));
    });
    // visualRelations are the authored visual contract. Legacy movement mirrors
    // must not override resolved anchors, especially after a landing head becomes a trace.
    const canonicalLinksShouldOwnStep = canonicalStepLinks.length > 0;
    if (canonicalLinksShouldOwnStep) {
      canonicalStepLinks.forEach((link) => {
        const sourceId = String(link?.sourceNodeId || '').trim();
        const targetId = String(link?.targetNodeId || '').trim();
        const transitionKey = `${sourceId}->${targetId}@${frameIndex}`;
        if (transitionKeys.has(transitionKey)) return;
        transitionKeys.add(transitionKey);
        transitions.push({
          sourceId,
          targetId,
          traceId: currentNodeIds.has(String(link?.witnessNodeId || '').trim())
            ? String(link.witnessNodeId).trim()
            : null,
          step: frameIndex,
          index: String(link?.relationIndex || '').trim() || `${transitions.length + 1}`,
          chainId: String(link?.chainId || '').trim() || null,
          operation: link?.operation,
          trajectoryKind: normalizeTrajectoryKind(link?.trajectoryKind) || undefined,
          note: link?.note
        });
      });
      explicitDerivationMovementSteps.add(frameIndex);
      continue;
    }
    if (!movement) continue;
    const chainId = String(frame.chainId || movement.chainId || '').trim();

    const previousFrame = frameIndex > 0 ? frames[frameIndex - 1] : null;
    const previousForest = Array.isArray(previousFrame?.workspaceForest) ? previousFrame.workspaceForest : [];
    const movementNodesById = collectForestNodesById(movementForest);
    const previousNodesById = collectForestNodesById(previousForest);

    const rawTraceId = String((movement as any)?.traceNodeId || '').trim();
    if (!rawSourceId && !rawTargetId) continue;

    const sourceCurrentData = rawSourceId ? currentNodesById.get(rawSourceId) : undefined;
    const targetCurrentData = rawTargetId ? currentNodesById.get(rawTargetId) : undefined;
    let sourceFrameNode = rawSourceId ? movementNodesById.get(rawSourceId) : undefined;
    const targetFrameNode = rawTargetId ? movementNodesById.get(rawTargetId) : undefined;
    let explicitTraceFrameNode = rawTraceId
      ? movementNodesById.get(rawTraceId)
      : undefined;

    const movementDiagnostics = Array.isArray((movement as any)?.diagnostics)
      ? movement.diagnostics.filter(Boolean)
      : [];
    const normalizedSerializationStatus = String((movement as any)?.serializationStatus || '').trim().toLowerCase();
    const movementIsExplicitlyBroken = normalizedSerializationStatus === 'underspecified'
      || normalizedSerializationStatus === 'incoherent'
      || movementDiagnostics.some((message) => /source omitted|landing omitted/i.test(String(message || '')));
    let resolvedTargetId = rawTargetId;
    const resolvedTargetCurrentData = resolvedTargetId
      ? currentNodesById.get(resolvedTargetId)
      : undefined;

    let resolvedSourceId = rawSourceId;
    const sourceCategoryHint = extractReplaySourceCategoryHint(rawSourceId, sourceFrameNode);
    const sourceStemHint = normalizeReplayInferenceStem(rawSourceId);
    const inferSourceTraceCarrierNode = (): SyntaxNode | null => {
      const requiresStrictCategoryCarrier = Boolean(sourceCategoryHint)
        && (movementLooksHeadLike || !sourceFrameNode)
        && (!sourceFrameNode || !pickTraceLikeLeafNode(sourceFrameNode));
      let bestCandidate: SyntaxNode | null = null;
      let bestScore = -1;

      movementNodesById.forEach((candidate) => {
        const traceLeaf = pickTraceLikeLeafNode(candidate);
        if (!traceLeaf?.id) return;

        const candidateId = String(candidate.id || '').trim();
        const candidateStem = normalizeReplayInferenceStem(candidateId || traceLeaf.id);
        const candidateLabel = normalizeLabel(candidate.label);
        const traceParentLabel = normalizeLabel(findParentLabelInForest(movementForest, String(traceLeaf.id || '').trim()));
        if (requiresStrictCategoryCarrier && candidateLabel !== sourceCategoryHint && traceParentLabel !== sourceCategoryHint) {
          return;
        }
        let score = 0;

        if (candidate.children && candidate.children.length > 0) score += 20;
        if (/_trace\b/i.test(candidateId)) score += 20;
        if (sourceStemHint && candidateStem && candidateStem === sourceStemHint) score += 120;
        if (sourceCategoryHint && candidateLabel === sourceCategoryHint) score += 70;
        if (sourceCategoryHint && traceParentLabel === sourceCategoryHint) score += 50;
        if (sourceCategoryHint) {
          const tokenPattern = new RegExp(`(?:^|[_-])${sourceCategoryHint.toLowerCase()}(?:[_-]|$)`, 'i');
          if (tokenPattern.test(candidateId) || tokenPattern.test(String(traceLeaf.id || '').trim())) {
            score += 25;
          }
        }

        if (score > bestScore) {
          bestScore = score;
          bestCandidate = candidate;
        }
      });

      return bestScore > 0 ? bestCandidate : null;
    };

    const movementTargetNode = rawTargetId
      ? getNodeAtForestPath(movementForest, findNodePathInForest(movementForest, rawTargetId))
      : null;
    const movementTargetId = String(movementTargetNode?.id || '').trim();
    if (movementTargetId && movementTargetId !== resolvedSourceId && !isTraceOrNullLikeNode(movementTargetNode)) {
      resolvedTargetId = movementTargetId;
    }

    let resolvedTraceId = currentNodesById.has(resolvedSourceId) ? resolvedSourceId : null;
    const inferredSourceCarrierNode = pickTraceLikeLeafNode(explicitTraceFrameNode || sourceFrameNode)
      ? (explicitTraceFrameNode || sourceFrameNode || null)
      : (
          movementLooksHeadLike || !sourceFrameNode
            ? (inferSourceTraceCarrierNode() || sourceFrameNode || null)
            : (sourceFrameNode || null)
        );
    const sourceTraceLeaf = pickTraceLikeLeafNode(explicitTraceFrameNode || inferredSourceCarrierNode);
    const sourceTraceLeafId = String(sourceTraceLeaf?.id || '').trim();
    const sourceOvertLeafCount = countOvertLeafSyntaxNodes(explicitTraceFrameNode || inferredSourceCarrierNode);
    const targetOvertLeafCount = countOvertLeafSyntaxNodes(targetFrameNode);

    if (sourceTraceLeafId && currentNodesById.has(sourceTraceLeafId)) {
      resolvedTraceId = sourceTraceLeafId;
      if (movementLooksHeadLike || sourceOvertLeafCount === 0) {
        resolvedSourceId = sourceTraceLeafId;
      }
    }


    if (!resolvedSourceId || !resolvedTargetId || resolvedSourceId === resolvedTargetId) continue;
    const transitionKey = `${resolvedSourceId}->${resolvedTargetId}@${frameIndex}`;
    if (transitionKeys.has(transitionKey)) continue;
    transitionKeys.add(transitionKey);
    explicitDerivationMovementSteps.add(frameIndex);
    transitions.push({
      sourceId: resolvedSourceId,
      targetId: resolvedTargetId,
      traceId: resolvedTraceId,
      step: frameIndex,
      index: getCanonicalMovementIndex(frame, resolvedSourceId, resolvedTargetId, frameIndex),
      chainId: chainId || null,
      operation: movement.operation || frame.operation,
      trajectoryKind: movementLooksHeadLike ? 'head' : 'phrasal',
      note: movement.note
    });
  }

  (Array.isArray(resolvedRelationLinks) ? resolvedRelationLinks : []).forEach((link) => {
    const sourceId = String(link?.sourceNodeId || '').trim();
    const targetId = String(link?.targetNodeId || '').trim();
    if (!sourceId || !targetId || sourceId === targetId) return;
    const step = Number.isInteger(link?.stepIndex) ? Number(link.stepIndex) : 0;
    if (step > activeStepIndex) return;
    if (explicitDerivationMovementSteps.has(step)) return;
    if (!currentNodeIds.has(sourceId) || !currentNodeIds.has(targetId)) return;
    const transitionKey = `${sourceId}->${targetId}@${step}`;
    if (transitionKeys.has(transitionKey)) return;
    transitionKeys.add(transitionKey);
    transitions.push({
      sourceId,
      targetId,
      traceId: currentNodeIds.has(String(link?.witnessNodeId || '').trim())
        ? String(link.witnessNodeId).trim()
        : null,
      step,
      index: String(link?.relationIndex || '').trim() || `${transitions.length + 1}`,
      chainId: null,
      operation: link?.operation,
      trajectoryKind: normalizeTrajectoryKind(link?.trajectoryKind) || undefined,
      note: link?.note
    });
  });

  return transitions;
};

const resolveNodeLabel = (node: HierNode): string => node.data.label || node.data.word || '';
const resolveLeafSurface = (node: HierNode): string => (node.data.word || node.data.label || '').trim();
const NULL_LIKE_LABEL = /^(∅|Ø|ε|NULL|EPSILON)$/i;
const NULLABLE_HEAD_CATEGORIES = new Set(['C', 'INFL', 'T', 'I', 'D', 'NEG', 'ASP', 'VOICE']);
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
  'ₙ': 'n', 'ₚ': 'p', 'ₛ': 's', 'ₜ': 't'
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

const isTraceLike = (label: string): boolean => {
  const text = label.trim();
  if (!text) return false;
  const normalized = [...text].map((ch) => SUBSCRIPT_MAP[ch] || ch).join('');
  const unwrapped = normalized.replace(/^[\s([{<⟨"']+|[\s)\]}>⟩"']+$/g, '');
  if (isStructuralCategorySurface(unwrapped) && unwrapped === unwrapped.toUpperCase()) {
    return false;
  }
  return (
    /^t\d*$/.test(unwrapped) ||
    /^t(?:[_-](?:\{?[A-Za-z0-9]+\}?|\[[A-Za-z0-9]+\]|\([A-Za-z0-9]+\)))+$/.test(unwrapped) ||
    /^trace\b/i.test(unwrapped) ||
    /^copy$/i.test(unwrapped) ||
    /^<[^>]+>$/.test(normalized) ||
    /^⟨[^⟩]+⟩$/.test(normalized)
  );
};

const sanitizeDerivationTraceLeaves = (node: SyntaxNode): SyntaxNode => {
  const walk = (current: SyntaxNode): SyntaxNode => {
    if (!current || typeof current !== 'object') {
      return { label: EXPLICIT_NULL_TERMINAL, word: EXPLICIT_NULL_TERMINAL };
    }
    const children = Array.isArray(current.children)
      ? current.children
          .filter((child): child is SyntaxNode => Boolean(child && typeof child === 'object'))
          .map(walk)
      : [];
    const next: SyntaxNode = { label: current.label };
    if (typeof current.id === 'string' && current.id.trim()) {
      next.id = current.id;
    }

    if (children.length > 0) {
      next.children = children;
      return next;
    }

    const word = typeof current.word === 'string' ? current.word.trim() : '';
    const label = String(current.label || '').trim();
    if (isTraceLike(word) || isTraceLike(label)) {
      next.label = 't';
      return next;
    }

    if (word) {
      next.word = word;
    }
    return next;
  };

  return walk(node);
};

const normalizeToken = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/^<|>$/g, '')
    .replace(/^⟨|⟩$/g, '')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
};

const POSSESSIVE_SUFFIX_RE = /^(.+?)(['\u2019]s)$/iu;

const splitReplaySurfaceToken = (value: string): string[] => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return [];
  const normalizedApostrophe = trimmed.replace(/\u2019/g, "'");
  const match = normalizedApostrophe.match(POSSESSIVE_SUFFIX_RE);
  if (match?.[1] && match?.[2]) return [match[1], match[2]];
  return [normalizedApostrophe];
};

const tokenizeReplaySentenceSurface = (sentence: string): string[] =>
  String(sentence || '')
    .trim()
    .split(/\s+/)
    .flatMap(splitReplaySurfaceToken)
    .map((token) => String(token || '').trim().replace(/^[^\p{L}\p{N}\p{M}']+|[^\p{L}\p{N}\p{M}']+$/gu, ''))
    .filter(Boolean);

const extractMovementIndex = (label: string): string | null => {
  const text = [...label.trim()].map((ch) => SUBSCRIPT_MAP[ch] || ch).join('');
  const braced = text.match(/_(?:\{|\[|\()([A-Za-z0-9]+)(?:\}|\]|\))$/);
  if (braced?.[1]) return braced[1].toLowerCase();
  const plain = text.match(/_([A-Za-z0-9]+)$/);
  if (plain?.[1]) return plain[1].toLowerCase();
  const danglingSubscript = text.match(/([A-Za-z0-9]+)$/);
  return danglingSubscript?.[1] && /[₀-₉ᵢⱼₐₑₒₓₕₖₗₘₙₚₛₜ]/.test(label) ? danglingSubscript[1].toLowerCase() : null;
};

const toSubscriptDigits = (value: string): string =>
  value
    .split('')
    .map((ch) => DIGIT_TO_SUBSCRIPT[ch] || ch)
    .join('');

const normalizeTraceIndexForDisplay = (index?: string | null): string => {
  const normalized = String(index || '').trim().toLowerCase();
  if (!normalized) return '';
  const numeric = /^\d+$/.test(normalized)
    ? Number(normalized)
    : NaN;
  if (!Number.isFinite(numeric) || numeric < 1) return '';
  return String(numeric);
};

const buildTraceDisplayLabel = (index?: string | null): string => {
  const suffix = normalizeTraceIndexForDisplay(index);
  return suffix ? `t${toSubscriptDigits(suffix)}` : 't';
};

const formatTraceSurfaceForDisplayValue = (
  surface: string,
  fallbackIndex?: string | null
): string => {
  const raw = String(surface || '').trim();
  if (!raw) return buildTraceDisplayLabel(fallbackIndex);
  if (!isTraceLike(raw)) return raw;
  return buildTraceDisplayLabel(fallbackIndex || extractMovementIndex(raw));
};

const DISPLAY_TRACE_LABEL_RE = /^t(?:[₀₁₂₃₄₅₆₇₈₉]+)?$/;

const isDisplayTraceLabel = (value?: string): boolean =>
  DISPLAY_TRACE_LABEL_RE.test(String(value || '').trim());

const isNullLike = (label: string): boolean => NULL_LIKE_LABEL.test(label.trim());
const isIndexedSurface = (label: string): boolean => {
  const trimmed = label.trim();
  return Boolean(trimmed) && !isTraceLike(trimmed) && !isNullLike(trimmed) && Boolean(extractMovementIndex(trimmed));
};

const isRenderableTerminalSurface = (surface: string, overtSurfaceSet: Set<string> | null): boolean => {
  const trimmed = surface.trim();
  if (!trimmed || isTraceLike(trimmed) || isIndexedSurface(trimmed)) {
    return false;
  }
  if (isNullLike(trimmed)) return true;
  const normalized = normalizeToken(trimmed);
  if (!normalized) return false;
  if (overtSurfaceSet) return overtSurfaceSet.has(normalized);
  return true;
};

const collectOvertLeafNodeIdsInOrder = (root?: SyntaxNode | null): string[] => {
  if (!root || typeof root !== 'object') return [];
  const overtIds: string[] = [];
  const visit = (node: SyntaxNode) => {
    const children = Array.isArray(node?.children) ? node.children : [];
    if (children.length === 0) {
      const nodeId = String(node?.id || '').trim();
      const surface = String(node?.word || node?.label || '').trim();
      if (
        nodeId &&
        surface &&
        !isTraceLike(surface) &&
        !isNullLike(surface) &&
        !isStructuralCategorySurface(surface)
      ) {
        overtIds.push(nodeId);
      }
      return;
    }
    children.forEach(visit);
  };
  visit(root);
  return overtIds;
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

const buildReplayLayoutForestOverlay = (
  visibleForest: SyntaxNode[],
  layoutForest: SyntaxNode[]
): { forest: SyntaxNode[]; layoutOnlyNodeIds: Set<string> } => {
  if (!Array.isArray(layoutForest) || layoutForest.length === 0) {
    return {
      forest: cloneSyntaxForest(visibleForest),
      layoutOnlyNodeIds: new Set<string>()
    };
  }

  const visibleNodesById = collectForestNodesById(visibleForest);
  const layoutOnlyNodeIds = new Set<string>();

  const markLayoutOnlyNodes = (node: SyntaxNode): SyntaxNode => {
    const nodeId = String(node?.id || '').trim();
    const next: SyntaxNode = { ...node };
    if (nodeId) {
      (next as any).replayLayoutOnly = true;
      layoutOnlyNodeIds.add(nodeId);
    }
    const children = Array.isArray(node?.children) ? node.children : [];
    if (children.length > 0) {
      next.children = children.map(markLayoutOnlyNodes);
    }
    return next;
  };

  const mergeVisibleNodeIntoLayoutShape = (layoutNode: SyntaxNode, visibleNode?: SyntaxNode): SyntaxNode => {
    const nodeId = String(layoutNode?.id || '').trim();
    const exactVisibleNode = visibleNode || (nodeId ? visibleNodesById.get(nodeId) : undefined);
    if (!exactVisibleNode) return markLayoutOnlyNodes(layoutNode);

    // The pre-relation tree owns visible content. The final tree contributes
    // only hidden layout ballast so future relation frames do not move anchors.
    const next: SyntaxNode = { ...exactVisibleNode };
    delete (next as any).replayLayoutOnly;

    const layoutChildren = Array.isArray(layoutNode?.children) ? layoutNode.children : [];
    const visibleChildren = Array.isArray(exactVisibleNode?.children) ? exactVisibleNode.children : [];
    if (layoutChildren.length === 0) {
      if (visibleChildren.length > 0) {
        next.children = visibleChildren.map((child) => mergeVisibleNodeIntoLayoutShape(child, child));
      }
      return next;
    }

    const visibleChildrenById = new Map(
      visibleChildren
        .map((child) => [String(child?.id || '').trim(), child] as const)
        .filter(([childId]) => Boolean(childId))
    );
    const usedVisibleChildIds = new Set<string>();
    const mergedChildren = layoutChildren.map((layoutChild) => {
      const layoutChildId = String(layoutChild?.id || '').trim();
      const matchingVisibleChild = layoutChildId ? visibleChildrenById.get(layoutChildId) : undefined;
      if (layoutChildId && matchingVisibleChild) usedVisibleChildIds.add(layoutChildId);
      return mergeVisibleNodeIntoLayoutShape(layoutChild, matchingVisibleChild);
    });
    visibleChildren.forEach((visibleChild) => {
      const visibleChildId = String(visibleChild?.id || '').trim();
      if (visibleChildId && usedVisibleChildIds.has(visibleChildId)) return;
      mergedChildren.push(mergeVisibleNodeIntoLayoutShape(visibleChild, visibleChild));
    });
    next.children = mergedChildren;
    return next;
  };

  const layoutRootIds = new Set(layoutForest.map((root) => String(root?.id || '').trim()).filter(Boolean));
  const visibleOnlyRoots = visibleForest.filter((root) => {
    const rootId = String(root?.id || '').trim();
    return !rootId || !layoutRootIds.has(rootId);
  });

  return {
    forest: [
      ...layoutForest.map((root) => mergeVisibleNodeIntoLayoutShape(root)),
      ...visibleOnlyRoots.map((root) => cloneSyntaxTree(root) || root)
    ],
    layoutOnlyNodeIds
  };
};

const maybeLowercaseSentenceInitialFunctionSurface = ({
  surface,
  sentenceInitialSurface,
  nodeId,
  parentLabel,
  tokenIndex,
  visibleOvertLeafIds,
  isWorkspaceForest = false
}: {
  surface: string;
  sentenceInitialSurface?: string;
  nodeId?: string;
  parentLabel?: string;
  tokenIndex?: number;
  visibleOvertLeafIds?: string[];
  isWorkspaceForest?: boolean;
}): string => {
  const trimmed = String(surface || '').trim();
  if (!trimmed) return '';
  if (!Number.isFinite(tokenIndex) || Number(tokenIndex) !== 0) return trimmed;

  const normalizedNodeId = String(nodeId || '').trim();
  const normalizedParentLabel = String(parentLabel || '').trim().toUpperCase();
  const normalizedSentenceInitialSurface = String(sentenceInitialSurface || '').trim();
  const visibleIds = Array.isArray(visibleOvertLeafIds) ? visibleOvertLeafIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
  const firstVisibleOvertLeafId = visibleIds[0] || '';
  const isSentenceInitialInVisibleReplay = normalizedNodeId && normalizedNodeId === firstVisibleOvertLeafId;
  if (!isWorkspaceForest && isSentenceInitialInVisibleReplay) {
    if (
      normalizedSentenceInitialSurface
      && normalizeToken(trimmed) === normalizeToken(normalizedSentenceInitialSurface)
    ) {
      return normalizedSentenceInitialSurface;
    }
    return trimmed;
  }

  const functionLikeParentLabels = new Set(['D', 'C', 'INFL', 'T', 'AUX', 'DET']);
  if (!functionLikeParentLabels.has(normalizedParentLabel)) return trimmed;

  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
};

const isOvertLeafNode = (node: HierNode, overtSurfaceSet: Set<string> | null): boolean =>
  isRenderableTerminalSurface(resolveLeafSurface(node), overtSurfaceSet);

const resolveTraceIndexFromNodeContext = (
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

const buildResolvedLinkTraceIndexMap = (
  currentForest: SyntaxNode[],
  resolvedRelationLinks: ResolvedVisualRelation[] | undefined,
  activeStepIndex: number
): Map<string, string> => {
  const traceIndexByNodeId = new Map<string, string>();
  const links = Array.isArray(resolvedRelationLinks) ? resolvedRelationLinks : [];
  const assignIndexToNodeAndLeaves = (nodeId: string, index: string) => {
    const normalizedNodeId = String(nodeId || '').trim();
    const normalizedIndex = String(index || '').trim();
    if (!normalizedNodeId || !normalizedIndex) return;
    traceIndexByNodeId.set(normalizedNodeId, normalizedIndex);
    const node = findNodeByIdInForest(currentForest, normalizedNodeId);
    if (!node) return;
    collectLeafSyntaxNodes(node)
      .map((leaf) => String(leaf?.id || '').trim())
      .filter(Boolean)
      .forEach((leafId) => traceIndexByNodeId.set(leafId, normalizedIndex));
  };
  links.forEach((link) => {
    const traceId = String(link?.witnessNodeId || '').trim();
    const sourceId = String(link?.sourceNodeId || '').trim();
    const movedId = String(link?.targetNodeId || '').trim();
    const index = String(link?.relationIndex || '').trim();
    const stepIndex = Number.isInteger(link?.stepIndex) ? Number(link.stepIndex) : 0;
    if (!index || stepIndex > activeStepIndex) return;

    if (traceId) assignIndexToNodeAndLeaves(traceId, index);
    if (sourceId) assignIndexToNodeAndLeaves(sourceId, index);
    if (movedId) {
      const movedNode = findNodeByIdInForest(currentForest, movedId);
      const movedSurface = movedNode ? String(movedNode.word || movedNode.label || '').trim() : '';
      if (movedNode && (isTraceLike(movedSurface) || isNullLike(movedSurface))) {
        assignIndexToNodeAndLeaves(movedId, index);
      }
    }
  });
  return traceIndexByNodeId;
};

const buildResolvedLinkRawTraceAliasMap = (
  currentForest: SyntaxNode[],
  resolvedRelationLinks: ResolvedVisualRelation[] | undefined,
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

const getReadyNodePriority = (node: HierNode): number => {
  const hasChildren = Boolean(node.children && node.children.length > 0);
  if (hasChildren) return 1;
  const leaf = resolveLeafSurface(node);
  if (!leaf) return 2;
  if (isIndexedSurface(leaf)) return 2;
  if (isTraceLike(leaf)) return 3;
  if (isNullLike(leaf)) return 4;
  return 0;
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
  const parentKey = normalizeReplayCategoryKeyForOrdering(parent.data?.label);
  const childKey = normalizeReplayCategoryKeyForOrdering(child.data?.label);
  const childHasChildren = Boolean(child.children && child.children.length > 0);
  const childHasOvert = subtreeHasOvertYield(child.data);
  const childSurface = resolveLeafSurface(child);
  const childIsSilent = isTraceLike(childSurface) || isNullLike(childSurface);
  const childIsPredicateCore =
    childKey === 'vP'
    || childKey === 'v'
    || childKey === 'VP'
    || childKey === 'VOICEP'
    || childKey === 'AP'
    || childKey === 'PP'
    || childKey === 'CP';

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

const mapProvidedStepsToNodes = (
  visibleNodes: HierNode[],
  derivationSteps?: DerivationStep[]
): Map<string, DerivationStep> => {
  if (!derivationSteps || derivationSteps.length === 0) return new Map();

  const nodeById = new Map(visibleNodes.map((node) => [getNodeId(node), node]));
  const used = new Set<string>();
  const mapped = new Map<string, DerivationStep>();

  for (const step of derivationSteps) {
    if (step.operation === 'SpellOut' || isMoveLikeOperation(step.operation) || String(step.chainId || '').trim()) continue;
    if (!step.targetNodeId) continue;
    const chosen = nodeById.get(step.targetNodeId);
    if (!chosen) continue;
    const targetNodeId = getNodeId(chosen);
    if (used.has(targetNodeId)) continue;
    used.add(targetNodeId);
    mapped.set(targetNodeId, step);
  }

  return mapped;
};

const buildStructuralDerivationPlaybackSteps = (
  forest: SyntaxNode[],
  frameIndex: number,
  previousVisibleNodeIds: Set<string>,
  resolvedRelationLinks?: ResolvedVisualRelation[],
  revealRootIds?: Set<string>,
  derivationFrames?: ReplayDerivationFrame[],
  frame?: ReplayDerivationFrame,
  sentence?: string,
  suppressedRelationLinks?: ResolvedVisualRelation[]
): PlaybackStep[] => {
  const sentenceInitialSurface = String(tokenizeReplaySentenceSurface(sentence)[0] || '').trim();
  const effectiveRelationLinks = resolvedRelationLinks || [];
  const structuralRelationLinks = filterResolvedRelationLinks(effectiveRelationLinks, suppressedRelationLinks);
  const snapshotResolvedRelationLinks = Array.isArray(suppressedRelationLinks) && suppressedRelationLinks.length > 0
    ? structuralRelationLinks
    : resolvedRelationLinks;
  const canvas = buildRenderableDerivationCanvasData(forest, structuralRelationLinks);
  const cloned = cloneSyntaxTree(canvas);
  if (!cloned) return [];
  const hierarchy = d3.hierarchy(cloned);
  applyVizIds(hierarchy);
  const visibleNodes = hierarchy
    .descendants()
    .filter((node) => !isSyntheticWorkspaceRootNode(node));
  const visibleNodeById = new Map(visibleNodes.map((node) => [getNodeId(node), node] as const));
  const visibleIds = new Set(visibleNodes.map((node) => getNodeId(node)));
  const rawNodeById = collectForestNodesById(forest);
  const continuityVisibleNodeIds = (() => {
    const seeded = new Set(previousVisibleNodeIds);
    const hasOvertReplayDescendant = (node: HierNode): boolean =>
      node.descendants().some((descendant) => {
        if (isSyntheticWorkspaceRootNode(descendant)) return false;
        const surface = resolveLeafSurface(descendant);
        return Boolean(surface)
          && !isTraceLike(surface)
          && !isNullLike(surface)
          && !isStructuralCategorySurface(surface);
      });

    visibleNodes.forEach((node) => {
      const nodeId = getNodeId(node);
      const lineageId = String(
        (node.data as SyntaxNode)?.lineageId
        || rawNodeById.get(nodeId)?.lineageId
        || ''
      ).trim();
      if (!lineageId || !previousVisibleNodeIds.has(lineageId)) return;
      if (!hasOvertReplayDescendant(node)) return;
      node.descendants().forEach((descendant) => {
        if (!isSyntheticWorkspaceRootNode(descendant)) {
          seeded.add(getNodeId(descendant));
        }
      });
    });

    const previousFrameForest = frameIndex > 0 && Array.isArray(derivationFrames?.[frameIndex - 1]?.workspaceForest)
      ? derivationFrames?.[frameIndex - 1]?.workspaceForest || []
      : [];
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
    if (!isTraceLike(surface)) return resolveNodeLabel(node);
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
  const detachedAttachmentRootIds = new Set<string>();
  const detachedAttachmentRootSideHints = (() => {
    if (detachedAttachmentRootIds.size === 0) return new Map<string, number>();
    const hints = new Map<string, number>();
    detachedAttachmentRootIds.forEach((rootId) => {
      const rootNode = visibleNodes.find((node) => getNodeId(node) === rootId);
      const parent = rootNode?.parent;
      if (!rootNode || !parent || !Array.isArray(parent.children)) return;
      const childIndex = parent.children.findIndex((child) => getNodeId(child) === rootId);
      if (childIndex < 0) return;
      hints.set(rootId, childIndex === 0 ? -1 : 1);
    });
    return hints;
  })();
  const inPlaceDetachedAttachmentRootIds = (() => {
    const ids = new Set<string>();
    detachedAttachmentRootIds.forEach((rootId) => {
      const rootNode = visibleNodes.find((node) => getNodeId(node) === rootId);
      const parent = rootNode?.parent;
      const children = Array.isArray(rootNode?.children) ? rootNode?.children || [] : [];
      if (!rootNode || !parent) return;
      const rootSurface = resolveLeafSurface(rootNode);
      if (children.length === 0 && (isTraceLike(rootSurface) || isNullLike(rootSurface) || (rootNode.data as SyntaxNode)?.silent === true)) {
        ids.add(rootId);
        return;
      }
      if (children.length !== 1 || children[0]?.children?.length) return;
      const rootLabel = String(rootNode.data?.label || '').trim();
      const parentLabel = String(parent.data?.label || '').trim();
      if (!rootLabel || !parentLabel || !/['′]/.test(parentLabel)) return;
      const normalizeBarLabel = (value: string): string =>
        value.toLowerCase().replace(/['′]/g, '').replace(/[^a-z]/g, '');
      if (normalizeBarLabel(rootLabel) === normalizeBarLabel(parentLabel)) {
        ids.add(rootId);
      }
    });
    return ids;
  })();
  const workspaceDetachedAttachmentRootIds = new Set(
    Array.from(detachedAttachmentRootIds)
      .filter((rootId) => !inPlaceDetachedAttachmentRootIds.has(rootId))
  );
  const workspaceDetachedAttachmentRootSideHints = new Map(
    Array.from(detachedAttachmentRootSideHints.entries())
      .filter(([rootId]) => workspaceDetachedAttachmentRootIds.has(rootId))
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
    const activeDetachedRootIds = new Set(detachedAttachmentRootIds);
    let preserveDetachedPlacementStep = false;
    let inPlaceDetachedRootIdForStep = '';
    detachedAttachmentRootIds.forEach((detachedRootId) => {
      const attachesInPlace = inPlaceDetachedAttachmentRootIds.has(detachedRootId);
      let current: HierNode | null = node;
      while (current) {
        if (getNodeId(current) === detachedRootId) {
          if (attachesInPlace) {
            activeDetachedRootIds.delete(detachedRootId);
            preserveDetachedPlacementStep = true;
            inPlaceDetachedRootIdForStep = detachedRootId;
          }
          return;
        }
        current = current.parent;
      }
      if (attachesInPlace && cumulativeVisibleNodeIds.has(detachedRootId)) {
        activeDetachedRootIds.delete(detachedRootId);
        return;
      }
    });
    const activeDetachedRootSideHints = new Map(
      Array.from(detachedAttachmentRootSideHints.entries())
        .filter(([rootId]) => activeDetachedRootIds.has(rootId))
    );
    const childNodes = (node.children || []).filter((child) => visibleIds.has(getNodeId(child)));
    const operation: DerivationStep['operation'] = childNodes.length === 0
      ? 'LexicalSelect'
      : (childNodes.length === 1 ? 'Project' : 'ExternalMerge');
    const suppressAutoRevealNodeIds =
      operation === 'LexicalSelect'
      && inPlaceDetachedRootIdForStep
      && inPlaceDetachedRootIdForStep !== nodeId
        ? [inPlaceDetachedRootIdForStep]
        : undefined;
    const snapshotVisibleNodeIds = new Set(cumulativeVisibleNodeIds);
    suppressAutoRevealNodeIds?.forEach((hiddenNodeId) => {
      snapshotVisibleNodeIds.delete(hiddenNodeId);
    });

    const visibleWorkspaceSnapshot = buildVisibleSyntaxSnapshotFromHierarchy(
      hierarchy,
      snapshotVisibleNodeIds,
      activeDetachedRootIds.size > 0 ? activeDetachedRootIds : undefined,
      activeDetachedRootSideHints.size > 0 ? activeDetachedRootSideHints : undefined
    );
    const frameReplaySnapshot = buildDerivationReplaySnapshot(
      forest,
      frameIndex,
      snapshotResolvedRelationLinks,
      snapshotVisibleNodeIds,
      layoutVisibleNodeIds,
      derivationFrames,
      activeDetachedRootIds.size > 0 ? activeDetachedRootIds : undefined,
      activeDetachedRootSideHints.size > 0 ? activeDetachedRootSideHints : undefined
    );
    const workspaceAfter = extractReplayWorkspaceLabels(visibleWorkspaceSnapshot);
    const visibleOvertLeafIds = collectOvertLeafNodeIdsInOrder(visibleWorkspaceSnapshot);
    const rawTargetLabel = getReplayNodeLabel(node);
    const targetLabel = childNodes.length === 0 && !isTraceLike(surface) && !isNullLike(surface)
      ? maybeLowercaseSentenceInitialFunctionSurface({
          surface: rawTargetLabel,
          sentenceInitialSurface,
          nodeId,
          parentLabel: String(node.parent?.data?.label || '').trim(),
          tokenIndex: Number(node.data?.tokenIndex),
          visibleOvertLeafIds,
          isWorkspaceForest: String(visibleWorkspaceSnapshot?.label || '').trim() === DERIVATION_WORKSPACE_ROOT_LABEL
        })
      : rawTargetLabel;
    const preFrontingLexicalTargetLabel =
      childNodes.length === 0
      && normalizeToken(targetLabel) === normalizeToken(sentenceInitialSurface)
        ? targetLabel.charAt(0).toLowerCase() + targetLabel.slice(1)
        : targetLabel;
    const sourceNodeIds = childNodes.map((child) => getNodeId(child));
    const sourceLabels = childNodes.length > 0
      ? childNodes.map((child) => getReplayNodeLabel(child)).filter(Boolean)
      : [
          isTraceLike(surface)
            ? preFrontingLexicalTargetLabel
            : maybeLowercaseSentenceInitialFunctionSurface({
                surface: String(node.data.word || preFrontingLexicalTargetLabel || '').trim(),
                sentenceInitialSurface,
                nodeId,
                parentLabel: String(node.parent?.data?.label || '').trim(),
                tokenIndex: Number(node.data?.tokenIndex),
                visibleOvertLeafIds,
                isWorkspaceForest: String(visibleWorkspaceSnapshot?.label || '').trim() === DERIVATION_WORKSPACE_ROOT_LABEL
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
      preserveReplayStep: preserveDetachedPlacementStep || undefined,
      replaySuppressAutoRevealNodeIds: suppressAutoRevealNodeIds
    }];
  });

  if (workspaceDetachedAttachmentRootIds.size > 0 && playbackSteps.length > 0) {
    const fullyVisibleNodeIds = new Set(cumulativeVisibleNodeIds);
    const detachedSnapshot = buildDerivationReplaySnapshot(
      forest,
      frameIndex,
      snapshotResolvedRelationLinks,
      fullyVisibleNodeIds,
      fullyVisibleNodeIds,
      derivationFrames,
      workspaceDetachedAttachmentRootIds,
      workspaceDetachedAttachmentRootSideHints
    );
    const attachedSnapshot = buildDerivationReplaySnapshot(
      forest,
      frameIndex,
      snapshotResolvedRelationLinks,
      fullyVisibleNodeIds,
      fullyVisibleNodeIds,
      derivationFrames,
      undefined,
      undefined
    );
    const detachedWorkspace = extractReplayWorkspaceLabels(detachedSnapshot.canvasData);
    const attachedWorkspace = extractReplayWorkspaceLabels(attachedSnapshot.canvasData);
    const attachmentTargetNode = visibleNodes.find((node) => {
      const nodeId = getNodeId(node);
      if (!continuityVisibleNodeIds.has(nodeId)) return false;
      return (node.children || []).some((child) => workspaceDetachedAttachmentRootIds.has(getNodeId(child)));
    });
    const targetNodeId = attachmentTargetNode ? getNodeId(attachmentTargetNode) : String(forest[0]?.id || '').trim();
    const targetLabel = attachmentTargetNode
      ? resolveNodeLabel(attachmentTargetNode)
      : (attachedWorkspace.length === 1 ? attachedWorkspace[0] : 'Workspace');
    playbackSteps.push({
      operation: 'ExternalMerge',
      sourceFrameIndex: frameIndex,
      visualFrameIndex: frameIndex,
      targetNodeId: targetNodeId || `__derivation_attach_${frameIndex}`,
      targetLabel: targetLabel || 'Workspace',
      sourceNodeIds: detachedWorkspace.map((_label, index) => `__workspace_${frameIndex}_${index}`),
      sourceLabels: detachedWorkspace,
      recipe: buildStructuralReplayFallback('ExternalMerge', targetLabel || 'Workspace', detachedWorkspace),
      workspaceAfter: attachedWorkspace,
      replayFrameIndex: frameIndex,
      replayCanvasData: attachedSnapshot.canvasData,
      replayVisibleNodeIds: attachedSnapshot.visibleNodeIds,
      replayRelationLinks: attachedSnapshot.relationLinks
    });
  }

  return playbackSteps;
};

const normalizeLabelKey = (label?: string): string => (label || "").trim().toUpperCase();
const isMoveLikeOperation = (operation?: DerivationStep['operation'] | string): boolean => {
  const key = String(operation || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!key) return false;
  if (key === 'move' || key === 'internalmerge' || key === 'headmove' || key === 'amove' || key === 'abarmove') {
    return true;
  }
  return /(?:move|raise|lower|front|displac|extract|shift|scrambl|rollup|sideward|incorpor|clitic|affix|remnant|piedpip|topicaliz|focaliz|extraposit|atb|remerge)/i.test(key);
};

const stepRepresentsMovement = (step?: PlaybackStep | null): boolean => {
  if (!step) return false;
  if (isMoveLikeOperation(step.operation)) return true;
  if ((Array.isArray(step.microOperations) ? step.microOperations : []).some((operation) => isMoveLikeOperation(operation))) {
    return true;
  }
  if (Array.isArray(step.replayRelationLinks) && step.replayRelationLinks.length > 0) {
    return !step.replayKind || step.replayKind === 'relation';
  }
  if (String(step.chainId || '').trim()) return true;
  if (isTraceLike(step.targetLabel)) return true;
  return (Array.isArray(step.sourceLabels) ? step.sourceLabels : []).some((label) => isTraceLike(label));
};

const stepMatchesSourceLabel = (step: PlaybackStep, sourceLabel: string): boolean => {
  const normalizedSource = normalizeLabelKey(sourceLabel);
  if (!normalizedSource) return false;
  if (normalizeLabelKey(step.targetLabel) === normalizedSource) return true;

  const recipe = (step.recipe || "").trim().toUpperCase();
  if (!recipe) return false;
  return recipe.startsWith(`SELECT ${normalizedSource}`);
};

const getMovementDependencyIndex = (steps: PlaybackStep[], stepIndex: number): number => {
  const step = steps[stepIndex];
  if (!step) return stepIndex;
  if (!stepRepresentsMovement(step)) return stepIndex;

  const sourceNodeIds = (step.sourceNodeIds || []).filter((id) => id && id !== step.targetNodeId);
  if (sourceNodeIds.length > 0) {
    let dependencyById = -1;
    sourceNodeIds.forEach((sourceId) => {
      steps.forEach((candidate, idx) => {
        if (idx === stepIndex) return;
        if (candidate.targetNodeId !== sourceId) return;
        dependencyById = Math.max(dependencyById, idx);
      });
    });
    if (dependencyById >= 0) return dependencyById;
  }

  const normalizedTarget = normalizeLabelKey(step.targetLabel);
  const sourceLabels = (step.sourceLabels || [])
    .map((label) => label.trim())
    .filter((label) => label.length > 0)
    .filter((label) => normalizeLabelKey(label) !== normalizedTarget);

  if (sourceLabels.length === 0) return stepIndex;

  let dependencyIndex = -1;
  sourceLabels.forEach((sourceLabel) => {
    steps.forEach((candidate, idx) => {
      if (idx === stepIndex) return;
      if (!stepMatchesSourceLabel(candidate, sourceLabel)) return;
      dependencyIndex = Math.max(dependencyIndex, idx);
    });
  });

  return dependencyIndex;
};

const getTraceDependencyIndex = (steps: PlaybackStep[], stepIndex: number): number => {
  const step = steps[stepIndex];
  if (!step) return stepIndex;
  if (step.operation !== 'LexicalSelect') return stepIndex;
  if (!isTraceLike(step.targetLabel)) return stepIndex;

  const traceIndex = extractMovementIndex(step.targetLabel);
  if (!traceIndex) return stepIndex;

  let dependencyIndex = -1;

  steps.forEach((candidate, idx) => {
    if (idx === stepIndex) return;
    if (!stepRepresentsMovement(candidate)) return;

    const sourceMentionsIndex = (candidate.sourceLabels || []).some((label) => extractMovementIndex(label) === traceIndex);
    const targetMentionsIndex = extractMovementIndex(candidate.targetLabel) === traceIndex;
    const recipeMentionsIndex = (candidate.recipe || '').toLowerCase().includes(`_${traceIndex}`);

    if (sourceMentionsIndex || targetMentionsIndex || recipeMentionsIndex) {
      dependencyIndex = Math.max(dependencyIndex, idx);
    }
  });

  if (dependencyIndex >= 0) return dependencyIndex;

  steps.forEach((candidate, idx) => {
    if (idx === stepIndex) return;
    if (candidate.operation !== 'LexicalSelect') return;
    const labelIndex = extractMovementIndex(candidate.targetLabel);
    if (!labelIndex || labelIndex !== traceIndex) return;
    if (isTraceLike(candidate.targetLabel)) return;
    dependencyIndex = Math.max(dependencyIndex, idx);
  });

  return dependencyIndex;
};

const reorderMovementSteps = (steps: PlaybackStep[]): PlaybackStep[] => {
  if (steps.length < 2) return steps;
  const reordered = [...steps];

  let changed = true;
  let safety = 0;
  while (changed && safety < reordered.length * reordered.length) {
    changed = false;
    safety += 1;

    for (let idx = 0; idx < reordered.length; idx += 1) {
      const step = reordered[idx];
      if (stepRepresentsMovement(step)) {
        const dependencyIndex = getMovementDependencyIndex(reordered, idx);
        if (dependencyIndex >= idx) {
          const [current] = reordered.splice(idx, 1);
          const insertAt = Math.min(dependencyIndex, reordered.length - 1) + 1;
          reordered.splice(insertAt, 0, current);
          changed = true;
          break;
        }
      }

      if (step.operation === 'LexicalSelect' && isTraceLike(step.targetLabel)) {
        const traceDependencyIndex = getTraceDependencyIndex(reordered, idx);
        if (traceDependencyIndex >= idx) {
          const [current] = reordered.splice(idx, 1);
          const insertAt = Math.min(traceDependencyIndex, reordered.length - 1) + 1;
          reordered.splice(insertAt, 0, current);
          changed = true;
          break;
        }
      }
    }
  }

  return reordered;
};

const finalizeReplayStepOrder = (steps: PlaybackStep[]): PlaybackStep[] => {
  if (steps.length < 2) return steps;

  // SpellOut is the terminal replay event. Any late movement bookkeeping
  // should still be normalized before it rather than surfacing after it.
  const nonSpellout = steps.filter((step) => String(step.operation || '').trim() !== 'SpellOut');
  const spellout = steps.filter((step) => String(step.operation || '').trim() === 'SpellOut');

  const normalized = reorderMovementSteps(nonSpellout);
  return spellout.length > 0 ? [...normalized, ...spellout] : normalized;
};

const buildPlaybackSteps = (
  root: HierNode,
  visibleNodes: HierNode[],
  derivationSteps?: DerivationStep[],
  labelResolver: (node: HierNode) => string = resolveNodeLabel
): PlaybackStep[] => {
  if (!derivationSteps || derivationSteps.length === 0) return [];

  const mappedProvidedSteps = mapProvidedStepsToNodes(visibleNodes, derivationSteps);
  const withProvided = Array.from(mappedProvidedSteps.values()).map((provided) => ({
    operation: provided.operation || 'Other',
    microOperations: provided.microOperations,
    targetNodeId: provided.targetNodeId || '',
    targetLabel: provided.targetLabel || '',
    sourceNodeIds: provided.sourceNodeIds,
    sourceLabels: provided.sourceLabels || [],
    recipe: provided.recipe,
    workspaceAfter: provided.workspaceAfter,
    spelloutOrder: provided.spelloutOrder,
    featureChecking: provided.featureChecking,
    ledgerBlocks: provided.ledgerBlocks,
    note: provided.note
  }));
  const mappedIds = new Set(withProvided.map((step) => step.targetNodeId));
  const supplementalProvided = derivationSteps
    .filter((step) => step.operation === 'SpellOut' || isMoveLikeOperation(step.operation) || String(step.chainId || '').trim())
    .filter((step) => step.operation === 'SpellOut' || !step.targetNodeId || mappedIds.has(step.targetNodeId))
    .map((step, index) => ({
      operation: step.operation || 'SpellOut',
      microOperations: step.microOperations,
      targetNodeId: step.targetNodeId || `__spellout_${index}`,
      targetLabel: step.targetLabel || 'SpellOut',
      sourceNodeIds: step.sourceNodeIds,
      sourceLabels: step.sourceLabels || [],
      recipe: step.recipe || 'SpellOut',
      workspaceAfter: step.workspaceAfter,
      spelloutOrder: step.spelloutOrder,
      featureChecking: step.featureChecking,
      ledgerBlocks: step.ledgerBlocks,
      note: step.note
    }));

  return finalizeReplayStepOrder([...withProvided, ...supplementalProvided]);
};

const decoratePlaybackStepsWithTraceIndices = (
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

const applyPreFrontingSentenceInitialCasing = (
  steps: PlaybackStep[],
  sentence: string
): PlaybackStep[] => {
  if (!Array.isArray(steps) || steps.length === 0) return steps;
  const firstSentenceToken = String(tokenizeReplaySentenceSurface(sentence)[0] || '').trim();
  if (!firstSentenceToken) return steps;
  const normalizedFirstSentenceToken = normalizeToken(firstSentenceToken);
  const loweredFirstSentenceToken = firstSentenceToken.charAt(0).toLowerCase() + firstSentenceToken.slice(1);
  if (loweredFirstSentenceToken === firstSentenceToken) return steps;

  const firstFrontingStepIndex = steps.findIndex((step) => isFrontingLikeOperationLabel(step?.operation));
  if (firstFrontingStepIndex <= 0) return steps;

  return steps.map((step, index) => {
    if (index >= firstFrontingStepIndex) return step;

    const nextTargetLabel = normalizeToken(String(step?.targetLabel || '').trim()) === normalizedFirstSentenceToken
      ? loweredFirstSentenceToken
      : step.targetLabel;
    const nextSourceLabels = Array.isArray(step?.sourceLabels)
      ? step.sourceLabels.map((label) =>
          normalizeToken(String(label || '').trim()) === normalizedFirstSentenceToken ? loweredFirstSentenceToken : label
        )
      : step.sourceLabels;
    const nextWorkspaceAfter = Array.isArray(step?.workspaceAfter)
      ? step.workspaceAfter.map((label) =>
          normalizeToken(String(label || '').trim()) === normalizedFirstSentenceToken ? loweredFirstSentenceToken : label
        )
      : step.workspaceAfter;
    const labelsChanged =
      nextTargetLabel !== step.targetLabel
      || JSON.stringify(nextSourceLabels || []) !== JSON.stringify(step.sourceLabels || [])
      || JSON.stringify(nextWorkspaceAfter || []) !== JSON.stringify(step.workspaceAfter || []);
    if (!labelsChanged) return step;

    const nextRecipe = buildStructuralReplayFallback(step.operation, nextTargetLabel, nextSourceLabels || []);
    return {
      ...step,
      targetLabel: nextTargetLabel,
      sourceLabels: nextSourceLabels,
      workspaceAfter: nextWorkspaceAfter,
      recipe: nextRecipe
    };
  });
};

const buildNodeStepIndex = (steps: PlaybackStep[]): Map<string, number> => {
  return new Map(steps.map((step, idx) => [step.targetNodeId, idx]));
};

const buildFirstRevealNodeStepIndex = (steps: PlaybackStep[]): Map<string, number> => {
  const stepIndex = new Map<string, number>();
  steps.forEach((step, idx) => {
    const nodeId = String(step?.targetNodeId || '').trim();
    if (!nodeId || stepIndex.has(nodeId)) return;
    stepIndex.set(nodeId, idx);
  });
  return stepIndex;
};

const resolveMovementStepForLink = (
  link: ResolvedVisualRelation,
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
  link: ResolvedVisualRelation
): HierNode | undefined => {
  const rawTargetId = String(link?.targetNodeId || '').trim();
  if (!rawTargetId) return undefined;

  const directTarget = nodeById.get(rawTargetId);
  if (directTarget) return directTarget;

  if (!isHeadLikeResolvedRelation(link, nodeById)) {
    const targetStem = normalizeReplayInferenceStem(rawTargetId);
    if (!targetStem) return undefined;

    let bestMatch: HierNode | undefined;
    let bestScore = -1;
    nodeById.forEach((candidate) => {
      const candidateId = getNodeId(candidate);
      const candidateStem = normalizeReplayInferenceStem(candidateId);
      if (!candidateStem || candidateStem !== targetStem) return;

      let score = 0;
      if (!candidate.children || candidate.children.length === 0) score += 30;
      if (/::__leaf$/i.test(candidateId)) score += 40;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = candidate;
      }
    });

    return bestMatch;
  }

  const headTraceCandidates = [
    `${rawTargetId}_t`,
    rawTargetId.replace(/_head$/i, '_head_t'),
    `${rawTargetId}__shell`
  ].filter(Boolean);

  for (const candidateId of headTraceCandidates) {
    const candidate = nodeById.get(candidateId);
    if (candidate) return candidate;
  }

  const inferredHeadLabel = (() => {
    const match = rawTargetId.match(/(?:^|_)(infl|aux|wh|q|c|t|i|v|d|n|a|p)(?:_|$)/i);
    if (!match?.[1]) return '';
    const normalized = String(match[1]).trim().toUpperCase();
    if (normalized === 'I') return 'T';
    return normalized;
  })();
  if (!inferredHeadLabel) return undefined;

  // When a head moves again, the earlier overt landing head disappears.
  // Keep cumulative arrows anchored to the surviving silent landing shell.
  let bestMatch: HierNode | undefined;
  let bestScore = -1;
  nodeById.forEach((candidate) => {
    const candidateLabel = normalizeStructuralLabel(candidate.data?.label).toUpperCase();
    if (candidateLabel !== inferredHeadLabel) return;

    const candidateId = getNodeId(candidate).toLowerCase();
    const traceLeaf = pickTraceLikeLeafNode(candidate.data);
    const candidateLooksSilent = isTraceOrNullLikeNode(candidate.data) || Boolean(traceLeaf);
    if (!candidateLooksSilent) return;

    let score = 10;
    if (candidate.children && candidate.children.length > 0) score += 30;
    if (/_trace\b/i.test(candidateId)) score += 40;
    if (new RegExp(`(?:^|_)${inferredHeadLabel.toLowerCase()}_trace(?:_|$)`, 'i').test(candidateId)) score += 80;
    if (new RegExp(`(?:^|_)null_${inferredHeadLabel.toLowerCase()}_trace(?:_|$)`, 'i').test(candidateId)) score -= 20;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  });

  if (bestMatch) return bestMatch;

  return undefined;
};

const buildDisplayRelationLinks = (
  resolvedRelationLinks: ResolvedVisualRelation[] | undefined
): ResolvedVisualRelation[] => {
  if (!resolvedRelationLinks || resolvedRelationLinks.length <= 1) return resolvedRelationLinks || [];

  const normalizedLinks = resolvedRelationLinks.map((link) => ({
    ...link,
    relationIndex: String(link?.relationIndex || '').trim(),
    relation: String(link?.relation || link?.operation || '').trim() || undefined,
    sourceNodeId: String(link?.sourceNodeId || '').trim(),
    targetNodeId: String(link?.targetNodeId || '').trim(),
    witnessNodeId: String(link?.witnessNodeId || '').trim() || undefined,
    renderFamily: link?.renderFamily || 'trajectory',
    trajectoryKind: normalizeTrajectoryKind(link?.trajectoryKind) || undefined,
    chainId: String((link as any)?.chainId || '').trim() || undefined
  }));

  const buckets = new Map<string, Array<{ link: ResolvedVisualRelation; originalIndex: number }>>();
  normalizedLinks.forEach((link, originalIndex) => {
    if (!link.targetNodeId || !link.sourceNodeId) return;
    const normalizedChainId = String((link as any)?.chainId || '').trim();
    const bucketKey = normalizedChainId
      ? `chain|${normalizedChainId}`
      : (
          isHeadLikeResolvedRelation(link)
            ? ''
            : `${normalizeMovementOperationLabel(link.operation)}|${link.targetNodeId}`
        );
    if (!bucketKey) return;
    const bucket = buckets.get(bucketKey) || [];
    bucket.push({ link, originalIndex });
    buckets.set(bucketKey, bucket);
  });

  const unchainedHeadMoves = normalizedLinks
    .map((link, originalIndex) => ({ link, originalIndex }))
    .filter(({ link }) =>
      isHeadLikeResolvedRelation(link)
      && !String((link as any)?.chainId || '').trim()
      && String(link.sourceNodeId || '').trim()
      && String(link.targetNodeId || '').trim()
    )
    .sort((left, right) => {
      const leftStep = Number.isInteger(left.link.stepIndex) ? Number(left.link.stepIndex) : Number.MAX_SAFE_INTEGER;
      const rightStep = Number.isInteger(right.link.stepIndex) ? Number(right.link.stepIndex) : Number.MAX_SAFE_INTEGER;
      if (leftStep !== rightStep) return leftStep - rightStep;
      return left.originalIndex - right.originalIndex;
    });

  const HEAD_MOVE_CATEGORY_TOKENS = new Set(['v', 't', 'infl', 'i', 'c', 'q', 'wh', 'aux', 'voice', 'neg', 'asp']);
  const extractHeadMoveCategoryFromId = (value?: string): string => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '';
    const explicitTraceMatch = normalized.match(/(?:^|_)(?:null_)?t_([a-z]+)(?:_|$)/);
    if (explicitTraceMatch?.[1] && HEAD_MOVE_CATEGORY_TOKENS.has(explicitTraceMatch[1])) {
      return explicitTraceMatch[1];
    }
    const parts = normalized.split(/[_-]+/).filter(Boolean);
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      if (HEAD_MOVE_CATEGORY_TOKENS.has(parts[index])) return parts[index];
    }
    return '';
  };
  const extractHeadMoveLexemeStem = (value?: string): string => {
    const normalized = normalizeMovementStemFromNodeId(value);
    if (!normalized) return '';
    return normalized
      .replace(/(?:[_-](?:v|t|infl|i|c|q|wh|aux|voice|neg|asp))+$/gi, '')
      .replace(/^[_-]+|[_-]+$/g, '');
  };

  const areConnectedHeadMoveHops = (
    previous: ResolvedVisualRelation,
    next: ResolvedVisualRelation
  ): boolean => {
    const previousTargets = new Set(
      [
        String(previous.targetNodeId || '').trim(),
        String(previous.witnessNodeId || '').trim()
      ].filter(Boolean)
    );
    const nextSources = [
      String(next.sourceNodeId || '').trim(),
      String(next.witnessNodeId || '').trim()
    ].filter(Boolean);
    if (nextSources.some((id) => previousTargets.has(id))) return true;

    const previousStem = normalizeMovementStemFromNodeId(
      String(previous.targetNodeId || previous.witnessNodeId || '').trim()
    );
    const nextStem = normalizeMovementStemFromNodeId(
      String(next.sourceNodeId || next.witnessNodeId || '').trim()
    );
    if (Boolean(previousStem) && previousStem === nextStem) return true;

    const previousLandingCategory = extractHeadMoveCategoryFromId(previous.targetNodeId);
    const nextSourceCategory = extractHeadMoveCategoryFromId(next.sourceNodeId || next.witnessNodeId);
    const previousLexeme = extractHeadMoveLexemeStem(previous.targetNodeId);
    const nextLexeme = extractHeadMoveLexemeStem(next.targetNodeId || next.sourceNodeId);
    return Boolean(previousLandingCategory)
      && previousLandingCategory === nextSourceCategory
      && Boolean(previousLexeme)
      && previousLexeme === nextLexeme;
  };

  let inferredHeadBucketIndex = 0;
  let pendingHeadBucket: Array<{ link: ResolvedVisualRelation; originalIndex: number }> = [];
  const flushPendingHeadBucket = () => {
    if (pendingHeadBucket.length <= 1) {
      pendingHeadBucket = [];
      return;
    }
    const bucketKey = `headchain|${inferredHeadBucketIndex}`;
    inferredHeadBucketIndex += 1;
    buckets.set(bucketKey, [...pendingHeadBucket]);
    pendingHeadBucket = [];
  };

  unchainedHeadMoves.forEach((entry) => {
    if (pendingHeadBucket.length === 0) {
      pendingHeadBucket = [entry];
      return;
    }
    const previous = pendingHeadBucket[pendingHeadBucket.length - 1];
    if (areConnectedHeadMoveHops(previous.link, entry.link)) {
      pendingHeadBucket.push(entry);
      return;
    }
    flushPendingHeadBucket();
    pendingHeadBucket = [entry];
  });
  flushPendingHeadBucket();

  const displayLinks = [...normalizedLinks];
  buckets.forEach((bucket) => {
    if (bucket.length <= 1) return;
    const ordered = [...bucket].sort((a, b) => {
      const aStep = Number.isInteger(a.link.stepIndex) ? Number(a.link.stepIndex) : Number.MAX_SAFE_INTEGER;
      const bStep = Number.isInteger(b.link.stepIndex) ? Number(b.link.stepIndex) : Number.MAX_SAFE_INTEGER;
      if (aStep !== bStep) return aStep - bStep;
      return a.originalIndex - b.originalIndex;
    });

    ordered.forEach((entry, index) => {
      if (isHeadLikeResolvedRelation(entry.link)) {
        if (index >= ordered.length - 1) return;
        const next = ordered[index + 1];
        const currentTraceId = String(entry.link.witnessNodeId || entry.link.sourceNodeId || '').trim();
        const nextTraceId = String(next.link.witnessNodeId || next.link.sourceNodeId || '').trim();
        if (!currentTraceId || !nextTraceId || currentTraceId === nextTraceId) return;
        // Once the head moves again, the earlier overt landing disappears.
        // Show the earlier hop as lower-trace -> higher-trace, and keep the last hop overt.
        displayLinks[entry.originalIndex] = {
          ...displayLinks[entry.originalIndex],
          sourceNodeId: currentTraceId,
          targetNodeId: nextTraceId,
          witnessNodeId: currentTraceId
        };
        return;
      }
      if (index >= ordered.length - 1) return;
      const next = ordered[index + 1];
      const nextHopTargetId = String(next.link.witnessNodeId || next.link.sourceNodeId || '').trim();
      if (!nextHopTargetId || nextHopTargetId === entry.link.sourceNodeId) return;
      displayLinks[entry.originalIndex] = {
        ...displayLinks[entry.originalIndex],
        targetNodeId: nextHopTargetId
      };
    });
  });

  return displayLinks;
};

const buildMovementArrowsFromLinks = (
  visibleNodes: HierNode[],
  resolvedRelationLinks: ResolvedVisualRelation[] | undefined,
  nodeStepIndex: Map<string, number>,
  playbackSteps: PlaybackStep[]
): MovementArrow[] => {
  if (!resolvedRelationLinks || resolvedRelationLinks.length === 0) return [];

  const nodeById = new Map(visibleNodes.map((node) => [getNodeId(node), node]));
  const pickTraceLikeLeafDescendant = (node?: HierNode): HierNode | undefined => {
    if (!node) return undefined;
    return node
      .descendants()
      .find((candidate) => {
        const children = candidate.children || [];
        if (children.length > 0) return false;
        const surface = resolveLeafSurface(candidate);
        return isTraceLike(surface) || isNullLike(surface);
      });
  };
  const pickOvertLeafDescendant = (node?: HierNode): HierNode | undefined => {
    if (!node) return undefined;
    return node
      .descendants()
      .find((candidate) => {
        const children = candidate.children || [];
        if (children.length > 0) return false;
        const surface = resolveLeafSurface(candidate);
        return Boolean(surface)
          && !isTraceLike(surface)
          && !isNullLike(surface)
          && !isStructuralCategorySurface(surface);
      });
  };
  const resolveArrowAnchorNode = (node?: HierNode): HierNode | undefined => {
    if (!node) return undefined;
    // Keep curved movement links attached to visible leaves or traces, not broad phrase shells.
    // This avoids arrows "piercing" v'/DP shells in cumulative replay frames.
    return pickTraceLikeLeafDescendant(node)
      || pickOvertLeafDescendant(node)
      || node;
  };
  const countRenderableLeafDescendants = (node?: HierNode): number => {
    if (!node) return 0;
    return node
      .descendants()
      .filter((candidate) => {
        const children = candidate.children || [];
        if (children.length > 0) return false;
        const surface = resolveLeafSurface(candidate);
        return Boolean(surface) && !isStructuralCategorySurface(surface);
      })
      .length;
  };
  const resolvePhrasalArrowAnchorNode = (node?: HierNode): HierNode | undefined => {
    if (!node) return undefined;
    // For phrase movement, anchor multi-leaf constituents on the phrase shell so
    // the arrow reads as XP movement rather than as a leaf-to-leaf trace jump.
    if (countRenderableLeafDescendants(node) > 1) return node;
    return resolveArrowAnchorNode(node);
  };
  const displayLinks = buildDisplayRelationLinks(resolvedRelationLinks);
  const arrows: MovementArrow[] = [];
  const seen = new Set<string>();
  const lastStep = playbackSteps.length > 0 ? playbackSteps.length - 1 : 0;

  displayLinks.forEach((link) => {
    const rawSource = nodeById.get(String(link.sourceNodeId || '').trim());
    const rawTarget = resolveVisibleMovementTargetNode(nodeById, link);
    const rawTraceNode = link.witnessNodeId
      ? nodeById.get(String(link.witnessNodeId).trim()) || undefined
      : undefined;
    const traceLeaf = rawTraceNode ? pickTraceLikeLeafDescendant(rawTraceNode) : undefined;
    const traceNode = traceLeaf || rawTraceNode;
    const linkLooksHeadLike = isHeadLikeResolvedRelation(link, nodeById);
    const displaySource = linkLooksHeadLike
      ? (traceLeaf || resolveArrowAnchorNode(rawSource))
      : (resolvePhrasalArrowAnchorNode(rawSource) || traceLeaf || resolveArrowAnchorNode(rawSource));
    const displayTarget = linkLooksHeadLike
      ? resolveArrowAnchorNode(rawTarget)
      : resolvePhrasalArrowAnchorNode(rawTarget);
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
  arrowsByDisplayOrder.forEach((arrow, index) => {
    arrow.index = String(index + 1);
  });

  return arrows;
};

const formatOperationLabel = (operation?: DerivationStep['operation']): string => {
  if (!operation) return 'Derivation';
  if (operation === 'Other') return 'Derivation';
  if (operation === 'LexicalSelect') return 'Select';
  if (operation === 'HeadMove') return 'Head Movement';
  if (operation === 'A-Move') return 'A-Movement';
  if (operation === 'AbarMove') return 'A-bar Move';
  return String(operation)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim();
};

const formatPlaybackOperationTitle = (step?: PlaybackStep | null): string => {
  const baseLabel = formatOperationLabel(step?.operation);
  const recipe = String(step?.recipe || '').trim();
  if (step?.replayKind === 'macro') {
    return recipe || baseLabel;
  }
  if (!recipe || isLowSignalReplayText(recipe) || stepRepresentsMovement(step)) {
    return baseLabel;
  }
  const operation = String(step?.operation || '').trim();
  if (operation === 'LexicalSelect' || operation === 'Project') {
    return recipe;
  }
  return baseLabel;
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

const replaceReplayIdentifiersInText = (value?: string): string => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\b[A-Za-z][A-Za-z0-9_-]*\b/g, (token) => {
    const replacement = formatReplayIdentifier(token);
    return replacement || token;
  });
};

const formatReplayBlockTitle = (title?: string): string => {
  const trimmed = String(title || '').trim();
  if (!trimmed) return '';
  const normalizedTitle = normalizeReplayBlockTitleKey(trimmed);
  if (normalizedTitle === 'COMMITMENT FACT') return 'Derivational Record';
  if (normalizedTitle === 'PUBLIC FACT') return 'Derivational Record';
  return toReplayTitleCase(trimmed.replace(/[_-]+/g, ' ').toLowerCase());
};

const formatReplayBlockLine = (
  title: string,
  line: string,
  steps: PlaybackStep[] = []
): string => {
  const trimmed = normalizeReplayTextForCommittedInventory(line, steps).trim();
  if (!trimmed) return '';
  const normalizedTitle = String(title || '').trim().toUpperCase();
  if (normalizedTitle === 'SELECTION') {
    return trimmed.replace(
      /^(.+?)\s+selects\s+([A-Za-z][A-Za-z0-9_-]*)$/i,
      (_match, selector, target) => `${replaceReplayIdentifiersInText(selector)} selects ${formatReplayIdentifier(target)}`
    );
  }
  if (normalizedTitle === 'LOCALITY') {
    return replaceReplayIdentifiersInText(trimmed);
  }
  return replaceReplayIdentifiersInText(trimmed);
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
  replaceReplayIdentifiersInText(
    String(value || '')
      .replace(/[_]+/g, ' ')
      .trim()
  );

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
    const children = Array.isArray(candidate.children) ? candidate.children : [];
    if (children.length === 0) {
      if (isTraceOrNullLikeNode(candidate)) return;
      const rawWord = String((candidate as any).word || '').trim();
      const rawLabel = String(candidate.label || '').trim();
      const fallbackLeafSurface = rawWord
        || ((/[a-z\u00C0-\uFFFF]/.test(rawLabel) && !/^[A-Z][A-Z'0-9,-]*$/.test(rawLabel)) ? rawLabel : '');
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
    const children = Array.isArray(candidate.children) ? candidate.children : [];
    if (children.length === 0) {
      if (isTraceOrNullLikeNode(candidate)) return;
      const rawWord = String((candidate as any).word || '').trim();
      const rawLabel = String(candidate.label || '').trim();
      const fallbackLeafSurface = rawWord
        || ((/[a-z\u00C0-\uFFFF]/.test(rawLabel) && !/^[A-Z][A-Z'0-9,-]*$/.test(rawLabel)) ? rawLabel : '');
      const surface = formatReplaySupportValue(fallbackLeafSurface);
      if (surface) overtYield.push(surface);
      return;
    }
    children.forEach((child) => collectSurfaceLeaves(child));
  };
  collectSurfaceLeaves(node);
  return overtYield.join(' ').trim();
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

const humanizeReplayCommitmentField = (value?: string): string => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return formatOperationLabel(trimmed as DerivationStep['operation']);
};

const formatReplayCommitmentParticipantRole = (value?: string): string =>
  toReplayTitleCase(
    String(value || '')
      .trim()
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
  );

const formatReplayCommitmentFactHeading = (fact?: Record<string, any> | null): string => {
  if (!fact || typeof fact !== 'object') return '';
  const kind = humanizeReplayCommitmentField(String(fact.kind || fact.family || '').trim());
  const detail = humanizeReplayCommitmentField(
    String(fact.frameworkLabel || fact.subtype || fact.type || '').trim()
  );
  const normalizedKind = normalizeReplayTargetLabel(kind);
  const normalizedDetail = normalizeReplayTargetLabel(detail);
  if (normalizeReplayTargetLabel(String(fact.kind || '').trim()) === 'MOVEMENT' && detail) {
    return detail;
  }
  if (kind && detail && normalizedKind !== normalizedDetail) {
    return `${kind} (${detail})`;
  }
  return kind || detail;
};

const buildReplayCommitmentFactLine = (
  fact?: Record<string, any> | null,
  replayCanvasData?: SyntaxNode | null
): string => {
  if (!fact || typeof fact !== 'object') return '';

  const heading = formatReplayCommitmentFactHeading(fact);
  const participantParts = (Array.isArray(fact.participants) ? fact.participants : [])
    .map((participant) => {
      if (!participant || typeof participant !== 'object') return '';
      const role = formatReplayCommitmentParticipantRole(participant.role);
      const explicitLabel = formatReplaySupportValue(String(participant.label || '').trim());
      const category = getReplayNodeCategoryFromCanvas(replayCanvasData, participant.nodeId);
      const nodeDisplay = getReplayNodeDisplayFromCanvas(replayCanvasData, participant.nodeId);
      const value = formatReplaySupportValue(String(participant.value || '').trim());
      const display = explicitLabel || category || nodeDisplay || value || formatReplayIdentifier(participant.nodeId);
      if (!display) return '';
      return role ? `${role} ${display}` : display;
    })
    .filter(Boolean);

  const nodeDisplays = Array.from(new Set(
    (Array.isArray(fact.nodeIds) ? fact.nodeIds : [])
      .map((nodeId) => getReplayNodeCategoryFromCanvas(replayCanvasData, nodeId) || formatReplayIdentifier(nodeId))
      .filter(Boolean)
  ));

  const details: string[] = [];
  const statement = formatReplaySupportValue(String(fact.statement || fact.note || '').trim());
  if (statement) details.push(statement);
  if (participantParts.length > 0) details.push(`Participants: ${participantParts.join('; ')}`);
  else if (nodeDisplays.length > 0) details.push(`Nodes: ${nodeDisplays.join(', ')}`);
  if (String(fact.chainId || '').trim()) details.push(`Chain: ${formatReplayIdentifier(String(fact.chainId || '').trim())}`);

  if (heading && details.length > 0) return `${heading}:\n${details.join('\n')}`;
  if (heading) return heading;
  return details.join('\n');
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
    || details.note
    || frame?.note
    || ''
  ).trim();
};

const getFrameVisualRelations = (
  frame?: ReplayDerivationFrame | null,
  plannedStage?: DerivationReplayPlanStage | null
): DerivationReplayPlanStep[] => {
  const plannedRelations = Array.isArray(plannedStage?.relationSteps) ? plannedStage.relationSteps : [];
  if (plannedRelations.length > 0) return plannedRelations;
  const details = getFrameDetailsRecord(frame);
  const relations = Array.isArray(details.derivationStageVisualRelations)
    ? details.derivationStageVisualRelations
    : [];
  return relations
    .map((relation) => {
      if (!relation || typeof relation !== 'object') return null;
      const relationRecord = relation as Record<string, unknown>;
      const label = String(relationRecord.relation || '').trim();
      const anchors = relationRecord.anchors && typeof relationRecord.anchors === 'object' && !Array.isArray(relationRecord.anchors)
        ? relationRecord.anchors as Record<string, unknown>
        : {};
      if (!label) return null;
      return {
        kind: 'relation',
        relation: label,
        anchors,
        targetNodeId: '',
        sourceNodeIds: []
      } satisfies DerivationReplayPlanStep;
    })
    .filter((relation): relation is DerivationReplayPlanStep => Boolean(relation));
};

const isRenderableReplayVisualRelation = (relation?: DerivationReplayPlanStep | null): boolean =>
  isMoveLikeOperation(String(relation?.relation || '').trim());

const flattenVisualRelationAnchorValues = (value: unknown): string[] => {
  const rawValues = Array.isArray(value) ? value : [value];
  return rawValues
    .map((item) => String(item || '').trim())
    .filter(Boolean);
};

const getVisualRelationAnchorValues = (
  relation?: DerivationReplayPlanStep | null,
  roleNames: string[] = []
): string[] => {
  const anchors = relation?.anchors && typeof relation.anchors === 'object' && !Array.isArray(relation.anchors)
    ? relation.anchors as Record<string, unknown>
    : {};
  const normalizedRoles = new Set(roleNames.map((role) => role.toLowerCase()));
  return Object.entries(anchors)
    .filter(([role]) => normalizedRoles.has(role.toLowerCase()))
    .flatMap(([, value]) => flattenVisualRelationAnchorValues(value));
};

const getVisualRelationTargetNodeId = (relation?: DerivationReplayPlanStep | null): string => {
  const authoredTarget = String(relation?.targetNodeId || '').trim();
  if (authoredTarget) return authoredTarget;
  return getVisualRelationAnchorValues(relation, [
    'target',
    'landing',
    'to',
    'moved',
    'moving',
    'operator',
    'head_copy',
    'movedCopy',
    'pronouncedCopy'
  ])[0] || '';
};

const getVisualRelationSourceNodeIds = (relation?: DerivationReplayPlanStep | null): string[] => {
  const targetNodeId = getVisualRelationTargetNodeId(relation);
  const explicitSourceNodeIds = Array.isArray(relation?.sourceNodeIds)
    ? relation.sourceNodeIds.map((nodeId) => String(nodeId || '').trim()).filter(Boolean)
    : [];
  const roleSourceNodeIds = getVisualRelationAnchorValues(relation, [
    'source',
    'from',
    'origin',
    'base',
    'trace',
    'copy',
    'lower',
    'controllee'
  ]);
  const anchors = relation?.anchors && typeof relation.anchors === 'object' && !Array.isArray(relation.anchors)
    ? relation.anchors as Record<string, unknown>
    : {};
  const fallbackSourceNodeIds = Object.entries(anchors)
    .filter(([role]) => !['target', 'landing', 'to', 'moved', 'moving', 'operator', 'head_copy', 'movedcopy', 'pronouncedcopy'].includes(role.toLowerCase()))
    .flatMap(([, value]) => flattenVisualRelationAnchorValues(value));
  return Array.from(new Set([
    ...explicitSourceNodeIds,
    ...roleSourceNodeIds,
    ...fallbackSourceNodeIds
  ].filter((nodeId) => nodeId && nodeId !== targetNodeId)));
};

const getVisualRelationAllAnchorNodeIds = (relation?: DerivationReplayPlanStep | null): string[] => {
  const anchors = relation?.anchors && typeof relation.anchors === 'object' && !Array.isArray(relation.anchors)
    ? relation.anchors as Record<string, unknown>
    : {};
  return Array.from(new Set(
    Object.values(anchors)
      .flatMap((value) => flattenVisualRelationAnchorValues(value))
      .filter(Boolean)
  ));
};

const visualRelationAnchorsExistInForest = (
  forest: SyntaxNode[],
  targetNodeId: string,
  sourceNodeId: string
): boolean => {
  if (!targetNodeId || !sourceNodeId) return false;
  return Boolean(
    findNodeByIdInForest(forest, targetNodeId)
    && findNodeByIdInForest(forest, sourceNodeId)
  );
};

const visualRelationHasRenderableTrajectory = (
  forest: SyntaxNode[],
  relationLabel: string,
  targetNodeId: string,
  sourceNodeId: string
): boolean => {
  if (isFrontingLikeOperationLabel(relationLabel)) return true;
  const targetNode = findNodeByIdInForest(forest, targetNodeId);
  const sourceNode = findNodeByIdInForest(forest, sourceNodeId);
  return Boolean(
    getOvertSurfaceFromSyntaxNode(targetNode)
    || getOvertSurfaceFromSyntaxNode(sourceNode)
  );
};

const resolveVisualRelationAnchorNodeId = (
  forest: SyntaxNode[],
  rawNodeId: string,
  role: 'source' | 'target'
): string => {
  const requestedNodeId = String(rawNodeId || '').trim();
  if (!requestedNodeId) return '';
  const exactNode = findExactNodeByIdInForest(forest, requestedNodeId);
  if (exactNode) return String(exactNode.id || requestedNodeId).trim();
  const aliasCandidates = findAliasNodeCandidatesInForest(forest, requestedNodeId);
  if (aliasCandidates.length > 0) {
    const scoredCandidates = aliasCandidates
      .map((node) => {
        const surface = String(node?.word || node?.label || '').trim();
        const overtSurface = getOvertSurfaceFromSyntaxNode(node);
        const hasOvertSurface = Boolean(overtSurface);
        const isSilentNode =
          Boolean((node as any)?.silent)
          || isTraceLike(surface)
          || isNullLike(surface)
          || Boolean(pickTraceLikeLeafNode(node));
        const score = role === 'target'
          ? (hasOvertSurface ? 0 : 20) + (isSilentNode ? 10 : 0)
          : (isSilentNode ? 0 : 10) + (hasOvertSurface ? 5 : 0);
        return { node, score };
      })
      .sort((left, right) => left.score - right.score);
    const chosenNode = scoredCandidates[0]?.node;
    if (chosenNode) return String(chosenNode.id || requestedNodeId).trim();
  }
  return '';
};

const buildAuthoredVisualRelationRelationLinksForFrames = (
  frames: ReplayDerivationFrame[],
  replayPlan: DerivationReplayPlan | null | undefined,
  activeFrameIndex: number,
  forest: SyntaxNode[],
  currentFrameRelationLimit: number = Number.POSITIVE_INFINITY
): ResolvedVisualRelation[] => {
  if (!Array.isArray(frames) || activeFrameIndex < 0) return [];
  const links: ResolvedVisualRelation[] = [];
  const relationIndexByKey = new Map<string, string>();
  let nextRelationIndex = 1;

  for (let frameIndex = 0; frameIndex <= Math.min(activeFrameIndex, frames.length - 1); frameIndex += 1) {
    const plannedStage = getReplayPlanStage(replayPlan, frameIndex);
    const relations = getFrameVisualRelations(frames[frameIndex], plannedStage);
    const relationLimit = frameIndex === activeFrameIndex ? currentFrameRelationLimit : Number.POSITIVE_INFINITY;

    relations.forEach((relation, relationIndex) => {
      if (relationIndex > relationLimit) return;
      const relationLabel = String(relation?.relation || '').trim();
      if (!relationLabel || !isMoveLikeOperation(relationLabel)) return;
      const rawTargetNodeId = getVisualRelationTargetNodeId(relation);
      const rawSourceNodeIds = getVisualRelationSourceNodeIds(relation);
      const sourceNodeIds = rawSourceNodeIds
        .map((nodeId) => resolveVisualRelationAnchorNodeId(forest, nodeId, 'source'))
        .filter(Boolean);
      const targetNodeId = resolveVisualRelationAnchorNodeId(forest, rawTargetNodeId, 'target');
      const sourceNodeId = sourceNodeIds.find((nodeId) =>
        visualRelationAnchorsExistInForest(forest, targetNodeId, nodeId)
      ) || sourceNodeIds[0] || '';
      if (!visualRelationAnchorsExistInForest(forest, targetNodeId, sourceNodeId)) return;
      const carriedThroughAlias = Boolean(
        (rawTargetNodeId && targetNodeId && rawTargetNodeId !== targetNodeId)
        || rawSourceNodeIds.some((rawSourceNodeId) =>
          sourceNodeIds.some((resolvedSourceNodeId) =>
            rawSourceNodeId && resolvedSourceNodeId && rawSourceNodeId !== resolvedSourceNodeId
          )
        )
      );
      if (!visualRelationHasRenderableTrajectory(forest, relationLabel, targetNodeId, sourceNodeId) && !carriedThroughAlias) return;

      const chainKey = String((relation.anchors as Record<string, unknown> | undefined)?.chain || '').trim()
        || targetNodeId
        || `${relationLabel}:${sourceNodeId}`;
      if (!relationIndexByKey.has(chainKey)) {
        relationIndexByKey.set(chainKey, String(nextRelationIndex));
        nextRelationIndex += 1;
      }
      const trajectoryKind = inferHeadLikeTrajectoryKindFromForest({
        forest,
        operation: relationLabel,
        sourceNodeId,
        targetNodeId,
        traceNodeId: sourceNodeId
      });

      links.push({
        relationIndex: relationIndexByKey.get(chainKey) || String(nextRelationIndex),
        relation: relationLabel,
        anchors: [
          { role: 'source', nodeId: sourceNodeId },
          { role: 'target', nodeId: targetNodeId },
          { role: 'witness', nodeId: sourceNodeId }
        ],
        sourceNodeId,
        targetNodeId,
        witnessNodeId: sourceNodeId,
        renderFamily: 'trajectory',
        trajectoryKind,
        stepIndex: frameIndex,
        operation: relationLabel,
        chainId: chainKey
      });
    });
  }

  return links;
};

const mergeResolvedVisualRelationLinks = (
  committedLinks: ResolvedVisualRelation[] = [],
  activeLinks: ResolvedVisualRelation[] = []
): ResolvedVisualRelation[] => {
  const merged = new Map<string, ResolvedVisualRelation>();
  const buildKey = (link: ResolvedVisualRelation): string => {
    const chainId = String(link?.chainId || '').trim();
    if (chainId) return `chain:${chainId}`;
    return [
      'link',
      String(link?.relationIndex || '').trim(),
      String(link?.relation || link?.operation || '').trim(),
      String(link?.sourceNodeId || '').trim(),
      String(link?.targetNodeId || '').trim(),
      String(link?.witnessNodeId || '').trim()
    ].join(':');
  };

  committedLinks.forEach((link) => merged.set(buildKey(link), link));
  activeLinks.forEach((link) => merged.set(buildKey(link), link));
  return Array.from(merged.values());
};

const formatVisualRelationAnchorValue = (
  value: unknown,
  replayCanvasData?: SyntaxNode | null
): string => {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => {
      const nodeId = String(item || '').trim();
      if (!nodeId) return '';
      return (
        getReplayNodeOvertYieldFromCanvas(replayCanvasData, nodeId)
        || getReplayNodeDisplayFromCanvas(replayCanvasData, nodeId)
        || getReplayNodeCategoryFromCanvas(replayCanvasData, nodeId)
        || formatReplayIdentifier(nodeId)
      );
    })
    .filter(Boolean)
    .join(', ');
};

const formatVisualRelationAnchorRole = (role: string): string =>
  toReplayTitleCase(
    String(role || '')
      .trim()
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
  );

const buildVisualRelationReplayLine = (
  relation: DerivationReplayPlanStep,
  replayCanvasData?: SyntaxNode | null
): string => {
  const relationLabel = formatReplaySupportValue(String(relation?.relation || '').trim());
  const anchors = relation?.anchors && typeof relation.anchors === 'object' && !Array.isArray(relation.anchors)
    ? relation.anchors
    : {};
  const anchorParts = Object.entries(anchors)
    .map(([role, value]) => {
      const display = formatVisualRelationAnchorValue(value, replayCanvasData);
      if (!display) return '';
      const roleLabel = formatVisualRelationAnchorRole(role);
      return roleLabel ? `${roleLabel}: ${display}` : display;
    })
    .filter(Boolean);
  if (!relationLabel) return anchorParts.join('; ');
  return anchorParts.length > 0 ? `${relationLabel}: ${anchorParts.join('; ')}` : relationLabel;
};

const buildStageRecordReplayBlocks = (
  frame?: ReplayDerivationFrame | null,
  plannedStage?: DerivationReplayPlanStage | null
): ReplayLedgerBlock[] | undefined => {
  const stageRecord = getFrameStageRecordText(frame, plannedStage);
  if (!stageRecord) return undefined;
  return [{ title: 'Stage Record', lines: [stageRecord] }];
};

const buildVisualRelationReplayBlocks = (
  relations: DerivationReplayPlanStep[] = [],
  replayCanvasData?: SyntaxNode | null
): ReplayLedgerBlock[] | undefined => {
  const lines = relations
    .filter(isRenderableReplayVisualRelation)
    .map((relation) => buildVisualRelationReplayLine(relation, replayCanvasData))
    .filter(Boolean);
  if (lines.length === 0) return undefined;
  return [{ title: 'Visual Relations', lines }];
};

const buildFrameCommitmentLedgerBlocks = (
  frame?: ReplayDerivationFrame | null,
  replayCanvasData?: SyntaxNode | null,
  plannedStage?: DerivationReplayPlanStage | null
): ReplayLedgerBlock[] | undefined => {
  const stageRecordBlocks = buildStageRecordReplayBlocks(frame, plannedStage);
  const visualRelationBlocks = buildVisualRelationReplayBlocks(
    getFrameVisualRelations(frame, plannedStage),
    replayCanvasData
  );
  if (stageRecordBlocks || visualRelationBlocks) {
    return mergeReplayLedgerBlocks(stageRecordBlocks, visualRelationBlocks);
  }

  const buildCompatibilityFactsFromChange = (): Record<string, any>[] => {
    const change = getDerivationFrameChange(frame);
    if (!change) return [];
    const anchors = Array.isArray(change?.anchors) ? change.anchors : [];
    return [{
      kind: 'transition',
      statement: String(change?.statement || '').trim() || undefined,
      note: String(change?.statement || '').trim() || undefined,
      nodeIds: Array.from(new Set(
        anchors
          .map((anchor) => String(anchor?.nodeId || '').trim())
          .filter(Boolean)
      )),
      participants: anchors
        .map((anchor) => ({
          role: String(anchor?.role || '').trim() || undefined,
          nodeId: String(anchor?.nodeId || '').trim() || undefined,
          value: String(anchor?.value || '').trim() || undefined,
          label: String(anchor?.text || '').trim() || undefined
        }))
        .filter((anchor) => anchor.role || anchor.nodeId || anchor.value || anchor.label),
      chainId: getDerivationChangeContinuityId(change) || undefined
    }];
  };

  const bindMovementFactDisplayAnchors = (fact?: Record<string, any> | null): Record<string, any> | null => {
    if (!fact || typeof fact !== 'object') return fact || null;
    const normalizedKind = normalizeReplayTargetLabel(String(fact.kind || fact.family || '').trim());
    if (normalizedKind !== 'MOVEMENT') return fact;
    const movement = frame?.movement;
    if (!movement || typeof movement !== 'object') return fact;

    const sourceNodeId = String(movement.sourceNodeId || '').trim();
    const landingNodeId = getMovementLandingNodeId(movement);
    const traceNodeId = String(movement.traceNodeId || '').trim();
    const hostNodeId = String(movement.hostNodeId || '').trim();
    const derivedNodeIds = Array.from(new Set(
      [sourceNodeId, landingNodeId, traceNodeId, hostNodeId]
        .filter(Boolean)
    ));
    const derivedParticipants = [
      landingNodeId ? { role: 'landing', nodeId: landingNodeId } : null,
      traceNodeId ? { role: 'trace', nodeId: traceNodeId } : null,
      sourceNodeId ? { role: 'source', nodeId: sourceNodeId } : null,
      hostNodeId && hostNodeId !== landingNodeId ? { role: 'host', nodeId: hostNodeId } : null
    ].filter(Boolean);

    return {
      ...fact,
      chainId: String(fact.chainId || movement.chainId || '').trim() || undefined,
      nodeIds: derivedNodeIds.length > 0 ? derivedNodeIds : fact.nodeIds,
      participants: derivedParticipants.length > 0 ? derivedParticipants : fact.participants
    };
  };

  const facts = Array.isArray(frame?.publicFacts) && frame.publicFacts.length > 0
    ? frame.publicFacts
    : buildCompatibilityFactsFromChange();
  const lines = facts
    .map((fact) => buildReplayCommitmentFactLine(
      bindMovementFactDisplayAnchors(fact),
      replayCanvasData
    ))
    .filter(Boolean);
  if (lines.length === 0) return undefined;
  return [{ title: 'Derivational Record', lines }];
};

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

  const labelSources = (Array.isArray(step.sourceLabels) ? step.sourceLabels : [])
    .map((label) => formatReplaySupportValue(label))
    .filter(Boolean);
  const labelSource = labelSources.find((label) => normalizeReplayTargetLabel(label) !== normalizedLanding) || labelSources[0];
  if (labelSource && !isGenericReplayStructuralLabel(labelSource)) return labelSource;

  return '';
};

const buildReplaySupportLines = (
  step: PlaybackStep | null,
  spelloutDisplay: string,
  sentence?: string
): ReplaySupportLine[] => {
  if (!step) return [];

  const operation = String(step.operation || '').trim();
  const inputValue = formatReplayInputsValue(step.sourceLabels);
  const workspaceValue = formatReplayInputsValue(step.workspaceAfter);
  const resultValue = formatReplaySupportValue(step.targetLabel);

  if (operation === 'StageRecord') {
    return [];
  }

  if (operation === 'LexicalSelect') {
    return (workspaceValue || inputValue)
      ? [{ label: 'Result', value: workspaceValue || inputValue }]
      : [];
  }

  if (operation === 'Project') {
    const lines: ReplaySupportLine[] = [];
    if (inputValue) lines.push({ label: 'Input', value: inputValue });
    if (workspaceValue || resultValue) lines.push({ label: 'Result', value: workspaceValue || resultValue });
    return lines;
  }

  if (operation === 'ExternalMerge') {
    const lines: ReplaySupportLine[] = [];
    if (inputValue) lines.push({ label: step.sourceLabels.length > 1 ? 'Inputs' : 'Input', value: inputValue });
    if (resultValue) lines.push({ label: 'Result', value: resultValue });
    return lines;
  }

  if (stepRepresentsMovement(step)) {
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
    diagnostics
      .filter((message) => !/source omitted|landing omitted/i.test(String(message || '')))
      .forEach((message) => lines.push({ label: 'Audit', value: String(message) }));
    return lines;
  }

  if (operation === 'SpellOut') {
    const lines: ReplaySupportLine[] = [];
    if (spelloutDisplay) lines.push({ label: 'Spellout', value: spelloutDisplay });
    if (sentence) lines.push({ label: 'Committed surface order', value: sentence });
    return lines;
  }

  const fallbackLines: ReplaySupportLine[] = [];
  if (inputValue) fallbackLines.push({ label: step.sourceLabels.length > 1 ? 'Inputs' : 'Input', value: inputValue });
  if (resultValue) fallbackLines.push({ label: 'Result', value: resultValue });
  return fallbackLines;
};

const stepTargetsAnyLabel = (step: PlaybackStep, labels: string[]): boolean => {
  const normalizedTarget = normalizeReplayTargetLabel(step.targetLabel);
  return labels.some((label) => normalizedTarget === normalizeReplayTargetLabel(label));
};

const findReplayDisplayStepIndex = (
  steps: PlaybackStep[],
  sourceIndex: number,
  predicate: (step: PlaybackStep, index: number) => boolean
): number => {
  for (let index = Math.min(sourceIndex, steps.length - 1); index >= 0; index -= 1) {
    if (predicate(steps[index], index)) return index;
  }
  return sourceIndex;
};

const findReplayCaseDisplayStepIndex = (
  steps: PlaybackStep[],
  sourceIndex: number,
  line: string
): number => {
  const normalizedLine = normalizeReplayTextForCommittedInventory(line, steps);
  if (/\bby\s+infl\b/i.test(normalizedLine) || /\bby\s+t\b/i.test(normalizedLine)) {
    return findReplayDisplayStepIndex(
      steps,
      sourceIndex,
      (step) =>
        stepTargetsAnyLabel(step, ['Infl', "Infl'", 'InflP', 'T', "T'", 'TP']) &&
        !stepRepresentsMovement(step)
    );
  }
  if (/\bby\s+v\b/i.test(normalizedLine)) {
    return findReplayDisplayStepIndex(
      steps,
      sourceIndex,
      (step) =>
        stepTargetsAnyLabel(step, ['V', "V'", 'VP', 'v', "v'", 'vP']) &&
        !stepRepresentsMovement(step)
    );
  }
  return sourceIndex;
};

const findReplaySelectionDisplayStepIndex = (
  steps: PlaybackStep[],
  sourceIndex: number,
  line: string
): number => {
  const normalizedLine = normalizeReplayTextForCommittedInventory(line, steps);
  if (/^\s*v\b/i.test(normalizedLine)) {
    return findReplayDisplayStepIndex(
      steps,
      sourceIndex,
      (step) =>
        stepTargetsAnyLabel(step, ['V', "V'", 'VP', 'v', "v'", 'vP']) &&
        !stepRepresentsMovement(step)
    );
  }
  if (/^\s*infl\b/i.test(normalizedLine) || /^\s*t\b/i.test(normalizedLine)) {
    return findReplayDisplayStepIndex(
      steps,
      sourceIndex,
      (step) =>
        stepTargetsAnyLabel(step, ['Infl', "Infl'", 'InflP', 'T', "T'", 'TP']) &&
        !stepRepresentsMovement(step)
    );
  }
  if (/^\s*c\b/i.test(normalizedLine)) {
    return findReplayDisplayStepIndex(
      steps,
      sourceIndex,
      (step) =>
        stepTargetsAnyLabel(step, ['C', "C'", 'CP', 'Foc', "Foc'", 'FocP']) &&
        !stepRepresentsMovement(step)
    );
  }
  return sourceIndex;
};

const buildReplayDisplayLedgerBlocks = (
  steps: PlaybackStep[]
): Map<number, ReplayLedgerBlock[]> => {
  const byStep = new Map<number, ReplayLedgerBlock[]>();
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

  steps.forEach((step, sourceIndex) => {
    const blocks = Array.isArray(step.ledgerBlocks) ? step.ledgerBlocks : [];
    blocks.forEach((block) => {
      const title = String(block?.title || '').trim();
      const lines = Array.isArray(block?.lines) ? block.lines.filter(Boolean) : [];
      if (!title || lines.length === 0) return;
      const normalizedTitle = normalizeReplayBlockTitleKey(title);

      if (normalizedTitle === 'CASE ASSIGNMENT') {
        lines.forEach((line) => {
          const targetIndex = findReplayCaseDisplayStepIndex(steps, sourceIndex, line);
          pushBlockLine(targetIndex, title, line);
        });
        return;
      }

      if (normalizedTitle === 'THETA ROLES') {
        const targetIndex = findReplayDisplayStepIndex(
          steps,
          sourceIndex,
          (candidate) =>
            stepTargetsAnyLabel(candidate, ['VP', "V'", 'vP', "v'"]) &&
            !stepRepresentsMovement(candidate)
        );
        lines.forEach((line) => pushBlockLine(targetIndex, title, line));
        return;
      }

      if (normalizedTitle === 'SELECTION') {
        lines.forEach((line) => {
          const targetIndex = findReplaySelectionDisplayStepIndex(steps, sourceIndex, line);
          pushBlockLine(targetIndex, title, line);
        });
        return;
      }

      if (normalizedTitle === 'LINEARIZATION') {
        const targetIndex = findReplayDisplayStepIndex(
          steps,
          sourceIndex,
          (candidate) => stepRepresentsMovement(candidate)
        );
        lines.forEach((line) => pushBlockLine(targetIndex, title, line));
        return;
      }

      if (normalizedTitle === 'LOCALITY') {
        const targetIndex = findReplayDisplayStepIndex(
          steps,
          sourceIndex,
          (candidate) => stepRepresentsMovement(candidate)
        );
        lines.forEach((line) => pushBlockLine(targetIndex, title, line));
        return;
      }

      lines.forEach((line) => pushBlockLine(sourceIndex, title, line));
    });
  });

  return byStep;
};

const formatFeatureCheckingEntry = (entry: FeatureCheckEvent): string => {
  const probe = entry.probeLabel || entry.probeNodeId || '';
  const goal = entry.goalLabel || entry.goalNodeId || '';
  const status = entry.status ? `[${entry.status}]` : '';
  const value = entry.value ? `=${entry.value}` : '';
  const relation = probe && goal ? `${probe} -> ${goal}` : (probe || goal || '');
  const core = `${entry.feature}${value}`;
  const base = relation ? `${core} @ ${relation}` : core;
  return status ? `${base} ${status}` : base;
};

const getTerminalWords = (node: SyntaxNode): string[] => {
  if (!node.children || node.children.length === 0) {
    return node.word ? [node.word] : [node.label];
  }
  return node.children.flatMap(getTerminalWords);
};

const buildMovementProtectedNodeIds = (
  resolvedRelationLinks?: ResolvedVisualRelation[]
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

const markTriangulatedNodes = (rootHierarchy: HierNode, protectedNodeIds?: Set<string>) => {
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

const isUnderTriangulation = (d: HierNode) => {
  let current = d.parent;
  while (current) {
    if ((current as any).isTriangulated) return true;
    current = current.parent;
  }
  return false;
};

const shouldExpandPreterminalLeaf = (node: SyntaxNode): boolean => {
  if (Array.isArray(node.children) && node.children.length > 0) return false;
  const label = String(node.label || '').trim();
  const word = typeof node.word === 'string' ? node.word.trim() : '';
  if (!label || !word) return false;
  if (isTraceLike(label)) return false;
  if (normalizeToken(label) === normalizeToken(word)) return false;
  return true;
};

const shouldMaterializeExplicitNullLeaf = (nodeOrLabel?: SyntaxNode | string, word?: string): boolean => {
  const node = typeof nodeOrLabel === 'object' && nodeOrLabel !== null ? nodeOrLabel : null;
  const label = node ? node.label : nodeOrLabel;
  const trimmedWord = node
    ? (typeof node.word === 'string' ? node.word.trim() : '')
    : (typeof word === 'string' ? word.trim() : '');
  if (trimmedWord) return false;
  const trimmedLabel = String(label || '').trim();
  if (isTraceLike(trimmedLabel)) return false;
  if (node && Array.isArray(node.children) && node.children.length > 0) return false;
  if (node && Number.isInteger(node.tokenIndex)) return false;
  const normalizedCategory = String(label || '').replace(/['\s]/g, '').toUpperCase();
  return (
    NULLABLE_HEAD_CATEGORIES.has(normalizedCategory) ||
    isHeadShellLabel(trimmedLabel) ||
    normalizedCategory === 'PRO' ||
    normalizedCategory.startsWith('PRO_') ||
    normalizedCategory.startsWith('PRO')
  );
};

const shouldCollapseSilentPronominalDisplay = (label?: string, word?: string): boolean => {
  const normalize = (value?: string): string =>
    String(value || '').replace(/['\s]/g, '').toUpperCase();
  const normalizedLabel = normalize(label);
  const normalizedWord = normalize(word);
  return (
    normalizedLabel === 'PRO' ||
    normalizedLabel.startsWith('PRO_') ||
    normalizedWord === 'PRO' ||
    normalizedWord.startsWith('PRO_')
  );
};

const materializeNullBearingLeaves = (node: SyntaxNode): SyntaxNode => {
  const walk = (current: SyntaxNode): SyntaxNode => {
    if (!current || typeof current !== 'object') {
      return { label: EXPLICIT_NULL_TERMINAL, word: EXPLICIT_NULL_TERMINAL };
    }
    const children = Array.isArray(current.children)
      ? current.children
          .filter((child): child is SyntaxNode => Boolean(child && typeof child === 'object'))
          .map(walk)
      : [];
    const next: SyntaxNode = { label: current.label };
    if (typeof current.id === 'string' && current.id.trim()) {
      next.id = current.id;
    }

    if (children.length > 0) {
      next.children = children;
      return next;
    }

    const word = typeof current.word === 'string' ? current.word.trim() : '';
    if (shouldCollapseSilentPronominalDisplay(current.label, word)) {
      next.label = EXPLICIT_NULL_TERMINAL;
      next.word = EXPLICIT_NULL_TERMINAL;
      return next;
    }
    if (shouldMaterializeExplicitNullLeaf(current)) {
      next.children = [{
        id: buildSyntheticReplayLeafId(current, 'null', EXPLICIT_NULL_TERMINAL),
        label: EXPLICIT_NULL_TERMINAL,
        word: EXPLICIT_NULL_TERMINAL
      }];
      return next;
    }
    if (!word) return next;

    next.word = word;
    return next;
  };

  return walk(node);
};

const materializeCanopyPreterminals = (node: SyntaxNode): SyntaxNode => {
  const walk = (current: SyntaxNode): SyntaxNode => {
    if (!current || typeof current !== 'object') {
      return { label: EXPLICIT_NULL_TERMINAL, word: EXPLICIT_NULL_TERMINAL };
    }
    const children = Array.isArray(current.children)
      ? current.children
          .filter((child): child is SyntaxNode => Boolean(child && typeof child === 'object'))
          .map(walk)
      : [];
    const next: SyntaxNode = { label: current.label };
    if (typeof current.id === 'string' && current.id.trim()) {
      next.id = current.id;
    }

    if (children.length > 0) {
      next.children = children;
      return next;
    }

    const word = typeof current.word === 'string' ? current.word.trim() : '';
    if (shouldCollapseSilentPronominalDisplay(current.label, word)) {
      next.label = EXPLICIT_NULL_TERMINAL;
      next.word = EXPLICIT_NULL_TERMINAL;
      return next;
    }

    if (shouldMaterializeExplicitNullLeaf(current)) {
      next.children = [{
        id: buildSyntheticReplayLeafId(current, 'null', EXPLICIT_NULL_TERMINAL),
        label: EXPLICIT_NULL_TERMINAL,
        word: EXPLICIT_NULL_TERMINAL
      }];
      return next;
    }
    if (!word) return next;

    if (shouldExpandPreterminalLeaf(current)) {
      next.children = [{
        id: buildSyntheticReplayLeafId(current, 'leaf', word),
        label: word,
        word
      }];
      return next;
    }

    next.word = word;
    return next;
  };

  return walk(node);
};

const TreeVisualizer: React.FC<TreeVisualizerProps> = ({
  data,
  animated = false,
  derivationSteps,
  derivationStages,
  abstractionMode = false,
  sentence = ''
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalMorphRef = useRef<Map<string, { preText: string; postText: string; step: number; hideBefore: boolean }>>(new Map());
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const replayDerivationFrames = useMemo(
    () => adaptDerivationStagesForReplay(derivationStages),
    [derivationStages]
  );
  const hasDerivationFrames = replayDerivationFrames.length > 0;
  const derivationStagesSignature = useMemo(() => {
    const stages = Array.isArray(derivationStages) ? derivationStages : [];
    return stages.map((stage, index) => JSON.stringify({
      index,
      stepId: stage.stepId,
      statement: stage.statement,
      stageRecord: stage.stageRecord,
      visualRelations: stage.visualRelations || [],
      workspaceForest: stage.workspaceForest || []
    })).join('|');
  }, [derivationStages]);
  const derivationReplayPlan = useMemo<DerivationReplayPlan | null>(() => {
    if (!Array.isArray(derivationStages) || derivationStages.length === 0) return null;
    return buildDerivationReplayPlan({ derivationStages }) as DerivationReplayPlan;
  }, [derivationStages, derivationStagesSignature]);
  const derivationStepsSignature = useMemo(() => {
    const steps = derivationSteps || [];
    return steps
      .map((step, idx) => [
        idx,
        step.operation || '',
        step.targetNodeId || '',
        step.targetLabel || '',
        (step.sourceNodeIds || []).join(','),
        (step.sourceLabels || []).join(','),
        step.recipe || '',
        (step.spelloutOrder || []).join(','),
        (step.featureChecking || [])
          .map((entry) => [
            entry.feature || '',
            entry.value || '',
            entry.status || '',
            entry.probeNodeId || '',
            entry.goalNodeId || '',
            entry.probeLabel || '',
            entry.goalLabel || '',
            entry.note || ''
          ].join(','))
          .join(';'),
        (step.ledgerBlocks || [])
          .map((block) => [
            block.title || '',
            (block.lines || []).join(',')
          ].join(':'))
          .join(';')
      ].join(':'))
      .join('|');
  }, [derivationSteps]);
  const derivationFramesSignature = useMemo(() => {
    const frames = replayDerivationFrames || [];
    return frames.map((frame, index) => JSON.stringify({
      index,
      frameId: frame.frameId,
      stepId: frame.stepId,
      operation: frame.operation,
      microOperations: frame.microOperations || [],
      recipe: frame.recipe,
      trigger: frame.trigger,
      chainId: frame.chainId,
      spelloutDomain: frame.spelloutDomain,
      spelloutOrder: frame.spelloutOrder || [],
      note: frame.note,
      movement: frame.movement || null,
      change: frame.change || null,
      workspaceForest: frame.workspaceForest || []
    })).join('|');
  }, [replayDerivationFrames]);
  const usesDerivationFrames = animated && replayDerivationFrames.length > 0;
  const committedDerivationFrameIndex = hasDerivationFrames
    ? replayDerivationFrames.length - 1
    : -1;
  const committedDerivationFrame = hasDerivationFrames && committedDerivationFrameIndex >= 0
    ? replayDerivationFrames[committedDerivationFrameIndex] || null
    : null;
  const committedDerivationVisualLinks = useMemo(() => {
    if (!hasDerivationFrames || !committedDerivationFrame || committedDerivationFrameIndex < 0) return [];
    return buildAuthoredVisualRelationRelationLinksForFrames(
      replayDerivationFrames,
      derivationReplayPlan,
      committedDerivationFrameIndex,
      committedDerivationFrame.workspaceForest || []
    );
  }, [committedDerivationFrame, committedDerivationFrameIndex, derivationReplayPlan, hasDerivationFrames, replayDerivationFrames]);
  const movementProtectedNodeIds = useMemo(
    () => buildMovementProtectedNodeIds(committedDerivationVisualLinks),
    [committedDerivationVisualLinks]
  );
  const committedDerivationCanvasData = useMemo(() => {
    if (!usesDerivationFrames) return null;
    if (!committedDerivationFrame) {
      return {
        label: DERIVATION_WORKSPACE_ROOT_LABEL,
        children: []
      } as SyntaxNode;
    }
    return buildRenderableDerivationCanvasData(
      committedDerivationFrame.workspaceForest || [],
      committedDerivationVisualLinks
    );
  }, [committedDerivationFrame, committedDerivationVisualLinks, usesDerivationFrames]);
  const committedCanonicalDerivationCanvasData = useMemo(() => {
    if (!usesDerivationFrames) return null;
    return buildRenderableCommittedCanvasData(
      data,
      committedDerivationVisualLinks
    );
  }, [data, committedDerivationVisualLinks, usesDerivationFrames]);
  const playbackSteps = useMemo(() => {
    if (!animated) return [];
    if (!usesDerivationFrames || !committedDerivationFrame) return [];
    const playbackRootData = usesDerivationFrames
      ? committedCanonicalDerivationCanvasData || committedDerivationCanvasData
      : data;
    const clonedData = cloneSyntaxTree(playbackRootData);
    if (!clonedData) return [];
    const hierarchy = d3.hierarchy(clonedData);
    applyVizIds(hierarchy);
    if (abstractionMode) {
      markTriangulatedNodes(hierarchy, movementProtectedNodeIds);
    }
    const visibleNodes = hierarchy.descendants().filter((node) => !isUnderTriangulation(node));
    const workspaceForest = committedDerivationFrame.workspaceForest || [];
    const traceIndexByNodeId = buildResolvedLinkTraceIndexMap(
      workspaceForest,
      committedDerivationVisualLinks,
      Number.MAX_SAFE_INTEGER
    );
    const steps = buildPlaybackStepsFromDerivationFrames(
      replayDerivationFrames,
      derivationSteps,
      sentence,
      derivationReplayPlan
    ).map(hidePendingInflSpecifierWrappersInStep);
    return applyPreFrontingSentenceInitialCasing(
      decoratePlaybackStepsWithTraceIndices(steps, traceIndexByNodeId),
      sentence
    );
  }, [
    animated,
    data,
    derivationSteps,
    derivationReplayPlan,
    derivationStagesSignature,
    usesDerivationFrames,
    replayDerivationFrames,
    derivationFramesSignature,
    committedCanonicalDerivationCanvasData,
    committedDerivationCanvasData,
    committedDerivationFrame,
    committedDerivationVisualLinks,
    abstractionMode,
    movementProtectedNodeIds,
    sentence
  ]);
  const firstFrontingStepIndex = useMemo(
    () => playbackSteps.findIndex((step) => isFrontingLikeOperationLabel(step?.operation)),
    [playbackSteps]
  );
  const firstSentenceReplayToken = useMemo(
    () => String(tokenizeReplaySentenceSurface(sentence)[0] || '').trim(),
    [sentence]
  );
  const firstSentenceReplayDisplayToken = useMemo(
    () => firstSentenceReplayToken
      ? firstSentenceReplayToken.charAt(0).toUpperCase() + firstSentenceReplayToken.slice(1)
      : '',
    [firstSentenceReplayToken]
  );
  const currentStepIndex = animated && playbackSteps.length > 0
    ? Math.min(activeStepIndex, playbackSteps.length - 1)
    : -1;
  const activeDerivationReplayStep = usesDerivationFrames && currentStepIndex >= 0
    ? playbackSteps[currentStepIndex]
    : null;
  const activeDerivationFrameIndex = usesDerivationFrames
    ? (
        Number.isInteger(activeDerivationReplayStep?.replayFrameIndex)
          ? Number(activeDerivationReplayStep?.replayFrameIndex)
          : committedDerivationFrameIndex
      )
    : -1;
  const activeDerivationFrame = usesDerivationFrames && activeDerivationFrameIndex >= 0
    ? replayDerivationFrames[activeDerivationFrameIndex] || null
    : null;
  const activeDerivationRelationLinks = useMemo(() => {
    if (!usesDerivationFrames) return [];
    const stepRelationLinks = Array.isArray(activeDerivationReplayStep?.replayRelationLinks)
      ? activeDerivationReplayStep.replayRelationLinks
      : [];
    return stepRelationLinks;
  }, [activeDerivationReplayStep, usesDerivationFrames]);
  const activeDerivationArrowLinks = useMemo(() => {
    if (!usesDerivationFrames) return [];
    const frameIndex = Number(activeDerivationFrameIndex);
    if (!Number.isInteger(frameIndex) || frameIndex < 0) return activeDerivationRelationLinks;
    return activeDerivationRelationLinks.filter((link) => {
      const stepIndex = Number(link?.stepIndex);
      return Number.isInteger(stepIndex) ? stepIndex <= frameIndex : true;
    });
  }, [activeDerivationFrameIndex, activeDerivationRelationLinks, usesDerivationFrames]);
  const traceDisplayFrame = usesDerivationFrames ? activeDerivationFrame : committedDerivationFrame;
  const traceDisplayFrameIndex = usesDerivationFrames ? activeDerivationFrameIndex : committedDerivationFrameIndex;
  const traceDisplayRelationLinks = usesDerivationFrames
    ? activeDerivationRelationLinks
    : committedDerivationVisualLinks;
  const isFinalDerivationReplayStep = usesDerivationFrames
    && activeStepIndex >= playbackSteps.length - 1;
  const overtSurfaceSet = useMemo(() => {
    const tokens = tokenizeReplaySentenceSurface(sentence)
      .map((token) => normalizeToken(token))
      .filter(Boolean);
    return tokens.length > 0 ? new Set(tokens) : null;
  }, [sentence]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const target = window as any;
    target.__BABEL_DEV_SET_REPLAY_STEP__ = (nextStep: number) => {
      const requested = Number(nextStep);
      const maxStep = Math.max(playbackSteps.length - 1, 0);
      const bounded = Number.isFinite(requested)
        ? Math.max(0, Math.min(Math.trunc(requested), maxStep))
        : 0;
      setIsAutoPlaying(false);
      setActiveStepIndex(bounded);
    };
    target.__BABEL_DEV_GET_REPLAY_STEP_COUNT__ = () => playbackSteps.length;
    target.__BABEL_DEV_GET_REPLAY_STEP_PAYLOAD__ = (index: number) => {
      const requested = Number(index);
      const bounded = Number.isFinite(requested)
        ? Math.max(0, Math.min(Math.trunc(requested), Math.max(playbackSteps.length - 1, 0)))
        : 0;
      return playbackSteps[bounded] || null;
    };

    return () => {
      delete target.__BABEL_DEV_SET_REPLAY_STEP__;
      delete target.__BABEL_DEV_GET_REPLAY_STEP_COUNT__;
      delete target.__BABEL_DEV_GET_REPLAY_STEP_PAYLOAD__;
    };
  }, [playbackSteps.length]);

  const canvasData = useMemo(() => {
    if (usesDerivationFrames) {
      return activeDerivationReplayStep?.replayCanvasData
        || committedCanonicalDerivationCanvasData
        || committedDerivationCanvasData
        || data;
    }
    if (animated) return data;
    return buildRenderableCommittedCanvasData(data, committedDerivationVisualLinks);
  }, [
    activeDerivationReplayStep,
    animated,
    committedCanonicalDerivationCanvasData,
    committedDerivationCanvasData,
    committedDerivationVisualLinks,
    data,
    usesDerivationFrames
  ]);
  const replayVisibleNodeIdSet = useMemo(() => {
    if (!usesDerivationFrames) return null;
    const nodeIds = activeDerivationReplayStep?.replayVisibleNodeIds;
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) return null;
    return new Set(nodeIds.map((id) => String(id || '').trim()).filter(Boolean));
  }, [activeDerivationReplayStep, usesDerivationFrames]);
  useEffect(() => {
    if (!containerRef.current) return;
    const observeTarget = containerRef.current;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) setDimensions({ width, height });
      }
    });
    resizeObserver.observe(observeTarget);
    return () => resizeObserver.unobserve(observeTarget);
  }, []);

  useEffect(() => {
    if (!animated || playbackSteps.length === 0) {
      setActiveStepIndex(0);
      setIsAutoPlaying(false);
      return;
    }

    setActiveStepIndex(0);
    setIsAutoPlaying(true);
  }, [animated, playbackSteps, data, derivationFramesSignature]);

  useEffect(() => {
    if (!animated || !isAutoPlaying || isScrubbing || playbackSteps.length === 0) {
      return;
    }

    if (activeStepIndex >= playbackSteps.length - 1) {
      setIsAutoPlaying(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setActiveStepIndex((index) => Math.min(index + 1, playbackSteps.length - 1));
    }, STEP_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [activeStepIndex, animated, isAutoPlaying, isScrubbing, playbackSteps]);

  useEffect(() => {
    if (!isScrubbing) return;

    const clearScrubState = () => setIsScrubbing(false);
    window.addEventListener('pointerup', clearScrubState);
    window.addEventListener('pointercancel', clearScrubState);
    window.addEventListener('mouseup', clearScrubState);
    window.addEventListener('touchend', clearScrubState);
    window.addEventListener('touchcancel', clearScrubState);

    return () => {
      window.removeEventListener('pointerup', clearScrubState);
      window.removeEventListener('pointercancel', clearScrubState);
      window.removeEventListener('mouseup', clearScrubState);
      window.removeEventListener('touchend', clearScrubState);
      window.removeEventListener('touchcancel', clearScrubState);
    };
  }, [isScrubbing]);

  useLayoutEffect(() => {
    if (!svgRef.current) return;
    const revealThreshold = animated ? activeStepIndex : Number.MAX_SAFE_INTEGER;
    const effectiveRevealThreshold = usesDerivationFrames
      ? Number.MAX_SAFE_INTEGER
      : revealThreshold;
    const svg = d3.select(svgRef.current);
    const layoutDerivationTraceIndexByNodeId = traceDisplayFrame
      ? buildResolvedLinkTraceIndexMap(
          traceDisplayFrame.workspaceForest || [],
          traceDisplayRelationLinks,
          traceDisplayFrameIndex
        )
      : new Map<string, string>();
    const layoutRawTraceAliasByIndex = traceDisplayFrame
      ? buildResolvedLinkRawTraceAliasMap(
          traceDisplayFrame.workspaceForest || [],
          traceDisplayRelationLinks,
          traceDisplayFrameIndex
        )
      : new Map<string, string>();
    const layoutVisibleOvertLeafIds = collectOvertLeafNodeIdsInOrder(canvasData);
    const layoutFirstVisibleOvertLeafId = String(layoutVisibleOvertLeafIds[0] || '').trim();
    const maybeCapitalizeLayoutSentenceInitialLeaf = (node: HierNode, value: string): string => {
      const trimmed = String(value || '').trim();
      if (!trimmed || isTraceLike(trimmed) || isNullLike(trimmed)) return trimmed;
      if (Number(node.data?.tokenIndex) !== 0) return trimmed;
      if (!layoutFirstVisibleOvertLeafId || getNodeId(node) !== layoutFirstVisibleOvertLeafId) return trimmed;
      const nodeAncestorIds = new Set<string>();
      let currentAncestor: HierNode | null = node;
      while (currentAncestor) {
        const ancestorId = getNodeId(currentAncestor);
        if (ancestorId) nodeAncestorIds.add(ancestorId);
        currentAncestor = currentAncestor.parent;
      }
      const surfacedByPhraseMovement = activeDerivationArrowLinks.some((link) => {
        if (isHeadLikeResolvedRelation(link)) return false;
        const targetNodeId = String(link?.targetNodeId || '').trim();
        return Boolean(targetNodeId) && nodeAncestorIds.has(targetNodeId);
      });
      if (!surfacedByPhraseMovement) return trimmed;
      return firstSentenceReplayDisplayToken || (trimmed.charAt(0).toUpperCase() + trimmed.slice(1));
    };

    svg.selectAll<SVGPathElement, unknown>('.branch')
      .style('opacity', function () {
        const step = Number((this as SVGPathElement).getAttribute('data-step') || 0);
        return step <= effectiveRevealThreshold ? '0.6' : '0';
      });

    svg.selectAll<SVGGElement, unknown>('.node-group')
      .style('opacity', function () {
        const step = Number((this as SVGGElement).getAttribute('data-step') || 0);
        return step <= effectiveRevealThreshold ? '1' : '0';
      });

    svg.selectAll<SVGPathElement, unknown>('.movement-arrow')
      .style('opacity', function () {
        const step = Number((this as SVGPathElement).getAttribute('data-step') || 0);
        return step <= effectiveRevealThreshold ? '0.95' : '0';
      });

    svg.selectAll<SVGTextElement, HierNode>('.terminal-label')
      .text(function (d) {
        const element = this as SVGTextElement;
        const nodeId = element.getAttribute('data-node-id') || '';
        const fallback = element.getAttribute('data-default-label') || '';
        const storedTraceIndex = normalizeTraceIndexForDisplay(
          element.getAttribute('data-trace-index') || ''
        );
        const morph = terminalMorphRef.current.get(nodeId);
        const rawTraceAlias = extractMovementIndex(fallback);
        const aliasedTraceIndex = rawTraceAlias
          ? layoutRawTraceAliasByIndex.get(String(rawTraceAlias).trim().toLowerCase())
          : undefined;
        const directTraceIndex = layoutDerivationTraceIndexByNodeId.get(nodeId);
        if (!morph) {
          return isTraceLike(fallback)
            ? formatTraceSurfaceForDisplayValue(
                fallback,
                directTraceIndex || storedTraceIndex || aliasedTraceIndex || extractMovementIndex(fallback)
              )
            : maybeCapitalizeLayoutSentenceInitialLeaf(d, fallback);
        }
        if (effectiveRevealThreshold < morph.step) {
          return morph.hideBefore ? '' : maybeCapitalizeLayoutSentenceInitialLeaf(d, morph.preText);
        }
        if (!morph.postText && isTraceLike(fallback)) {
          return formatTraceSurfaceForDisplayValue(
            fallback,
            directTraceIndex || storedTraceIndex || aliasedTraceIndex || extractMovementIndex(fallback)
          );
        }
        if (morph.postText && isDisplayTraceLabel(morph.postText)) {
          return morph.postText;
        }
        if (morph.postText && isTraceLike(morph.postText)) {
          return formatTraceSurfaceForDisplayValue(
            morph.postText,
            directTraceIndex || storedTraceIndex || aliasedTraceIndex || extractMovementIndex(morph.postText)
          );
        }
        if (isTraceLike(fallback)) {
          return formatTraceSurfaceForDisplayValue(
            fallback,
            directTraceIndex || storedTraceIndex || aliasedTraceIndex || extractMovementIndex(fallback)
          );
        }
        return maybeCapitalizeLayoutSentenceInitialLeaf(d, morph.postText || fallback);
      });
  }, [
    activeDerivationArrowLinks,
    activeDerivationFrame,
    activeDerivationFrameIndex,
    activeDerivationRelationLinks,
    activeStepIndex,
    animated,
    canvasData,
    data,
    dimensions,
    abstractionMode,
    firstSentenceReplayDisplayToken,
    firstSentenceReplayToken,
    traceDisplayFrame,
    traceDisplayFrameIndex,
    traceDisplayRelationLinks,
    usesDerivationFrames,
    playbackSteps.length
  ]);

  useEffect(() => {
    if (!canvasData || !svgRef.current || dimensions.width === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { width: containerWidth, height: containerHeight } = dimensions;

    const clonedCanvasData = cloneSyntaxTree(canvasData);
    if (!clonedCanvasData) return;
    const rootHierarchy = d3.hierarchy(clonedCanvasData);
    const maxDepth = rootHierarchy.height;
    applyVizIds(rootHierarchy);

    // Logic for Triangulation (Abstraction Mode)
    if (abstractionMode) {
      markTriangulatedNodes(rootHierarchy, movementProtectedNodeIds);
    }

    const nodeCount = rootHierarchy.descendants().length;
    const width = Math.max(containerWidth * 1.5, nodeCount * 180);
    const height = Math.max(containerHeight, (maxDepth + 2) * 220);
    
    const margin = { top: 120, right: 300, bottom: 400, left: 300 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg.attr('width', '100%').attr('height', '100%').append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 10])
      .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoom as any);

    const treeLayout = d3.tree<SyntaxNode>()
      .size([innerWidth, innerHeight])
      .separation((a, b) => (a.parent === b.parent ? 2.5 : 3.5));

    const treeData = treeLayout(rootHierarchy);
    const alignReplayUnaryTerminalLeaves = (root: d3.HierarchyPointNode<SyntaxNode>) => {
      root.each((node) => {
        const children = Array.isArray(node.children) ? node.children : [];
        const visibleChildren = children.filter((child) =>
          !isSyntheticWorkspaceRootNode(child)
          && (!replayVisibleNodeIdSet || replayVisibleNodeIdSet.has(getNodeId(child)))
          && (child.data as any)?.replayLayoutOnly !== true
        );
        if (visibleChildren.length !== 1) return;
        const child = visibleChildren[0];
        if (!child || (Array.isArray(child.children) && child.children.length > 0)) return;
        if (isSyntheticWorkspaceRootNode(node) || isSyntheticWorkspaceRootNode(child)) return;
        const surface = resolveLeafSurface(child);
        if (!surface) return;
        const isTerminalLeaf =
          isTraceLike(surface)
          || isNullLike(surface)
          || !isStructuralCategorySurface(surface);
        if (!isTerminalLeaf) return;
        child.x = node.x;
      });
    };
    if (usesDerivationFrames) {
      alignReplayUnaryTerminalLeaves(treeData);
    }
    const derivationFrameFitNodes = (() => {
      if (!animated || !usesDerivationFrames || !activeDerivationFrame) return null;
      const fitCanvasData = buildRenderableDerivationCanvasData(
        activeDerivationFrame.workspaceForest || [],
        activeDerivationRelationLinks
      );
      const clonedFitCanvasData = cloneSyntaxTree(fitCanvasData);
      if (!clonedFitCanvasData) return null;
      const fitHierarchy = d3.hierarchy(clonedFitCanvasData);
      applyVizIds(fitHierarchy);
      if (abstractionMode) {
        markTriangulatedNodes(fitHierarchy, movementProtectedNodeIds);
      }
      const fitTreeData = treeLayout(fitHierarchy);
      alignReplayUnaryTerminalLeaves(fitTreeData);
      return fitTreeData.descendants().filter((node) =>
        !isUnderTriangulation(node) && !isSyntheticWorkspaceRootNode(node)
      );
    })();

    // COLOR PALETTE - ABSOLUTE CONSTANTS
    const BRANCH_COLOR = '#593a0e';
    const PURE_WHITE = '#ffffff';
    const TARGET_EMERALD = '#10b981';
    const SILENT_SAGE = '#9caf99';

    // 1. RENDER BRANCHES
    const visibleNodes = treeData.descendants().filter((node) =>
      !isUnderTriangulation(node)
      && !isSyntheticWorkspaceRootNode(node)
      && (!replayVisibleNodeIdSet || replayVisibleNodeIdSet.has(getNodeId(node)))
    );
    const visibleLinks = treeData.links().filter((link) =>
      !isUnderTriangulation(link.target)
      && !isSyntheticWorkspaceRootNode(link.source)
      && !isSyntheticWorkspaceRootNode(link.target)
      && (!replayVisibleNodeIdSet || (
        replayVisibleNodeIdSet.has(getNodeId(link.source))
        && replayVisibleNodeIdSet.has(getNodeId(link.target))
      ))
    ) as VisibleLink[];
    const inferredTimeline = usesDerivationFrames
      ? []
      : buildPlaybackSteps(rootHierarchy, visibleNodes, derivationSteps);
    const timeline = animated && playbackSteps.length > 0 ? playbackSteps : inferredTimeline;
    const nodeStepIndex = buildNodeStepIndex(timeline);
    const firstRevealNodeStepIndex = buildFirstRevealNodeStepIndex(timeline);
    const revealThreshold = animated ? activeStepIndex : Number.MAX_SAFE_INTEGER;
    const derivationTraceIndexByNodeId = traceDisplayFrame
      ? (() => {
          const workspaceForest = traceDisplayFrame.workspaceForest || [];
          return buildResolvedLinkTraceIndexMap(
            workspaceForest,
            traceDisplayRelationLinks,
            traceDisplayFrameIndex
          );
        })()
      : new Map<string, string>();
    const derivationRawTraceAliasByIndex = traceDisplayFrame
      ? (() => {
          const workspaceForest = traceDisplayFrame.workspaceForest || [];
          return buildResolvedLinkRawTraceAliasMap(
            workspaceForest,
            traceDisplayRelationLinks,
            traceDisplayFrameIndex
          );
        })()
      : new Map<string, string>();
    const movementArrows = animated
        ? (
          usesDerivationFrames
            ? buildMovementArrowsFromLinks(
                visibleNodes,
                activeDerivationArrowLinks,
                nodeStepIndex,
                timeline
              )
            : []
        )
      : [];
    const effectiveRevealThreshold = usesDerivationFrames
      ? Number.MAX_SAFE_INTEGER
      : revealThreshold;
    const nodeRevealStepIndex = new Map(firstRevealNodeStepIndex);
    const terminalMorph = new Map<string, { preText: string; postText: string; step: number; hideBefore: boolean }>();
    const normalizeMovementTraceIndex = (index?: string | null): string => {
      return normalizeTraceIndexForDisplay(index);
    };
    const buildTraceLabel = (index?: string | null): string => {
      return buildTraceDisplayLabel(index);
    };
    const formatTraceSurfaceForDisplay = (
      surface: string,
      fallbackIndex?: string | null
    ): string => {
      return formatTraceSurfaceForDisplayValue(surface, fallbackIndex);
    };
    const formatReplayIndexedSilentLeaf = (
      surface: string,
      inheritedTraceIndex?: string | null,
      aliasedTraceIndex?: string | null,
      forceTraceForSilentCopy = false
    ): string => {
      const resolvedIndex = normalizeTraceIndexForDisplay(
        inheritedTraceIndex || aliasedTraceIndex || extractMovementIndex(surface)
      );
      if (forceTraceForSilentCopy && resolvedIndex) {
        return buildTraceLabel(resolvedIndex);
      }
      if (isTraceLike(surface)) {
        return formatTraceSurfaceForDisplay(surface, resolvedIndex || extractMovementIndex(surface));
      }
      if (isNullLike(surface) && resolvedIndex) {
        return buildTraceLabel(resolvedIndex);
      }
      return surface;
    };

    const unrevealedStep = usesDerivationFrames ? Number.MAX_SAFE_INTEGER : 0;
    const getRevealStepForNodeId = (nodeId: string): number =>
      nodeRevealStepIndex.has(nodeId)
        ? (nodeRevealStepIndex.get(nodeId) as number)
        : unrevealedStep;
    const findFirstOvertLeafDescendant = (node: HierNode | null): HierNode | null => {
      if (!node) return null;
      const stack: HierNode[] = [node];
      while (stack.length > 0) {
        const current = stack.shift() as HierNode;
        const children = current.children || [];
        if (children.length === 0) {
          const surface = resolveLeafSurface(current);
          if (isRenderableTerminalSurface(surface, overtSurfaceSet) && !isTraceLike(surface) && !isNullLike(surface)) {
            return current;
          }
          continue;
        }
        stack.unshift(...children);
      }
      return null;
    };

    movementArrows.forEach((arrow) => {
      const sourceId = getNodeId(arrow.source);
      const targetId = getNodeId(arrow.target);
      const sourceStep = getRevealStepForNodeId(sourceId);
      const targetStep = getRevealStepForNodeId(targetId);
      nodeRevealStepIndex.set(sourceId, Math.min(sourceStep, arrow.step));
      nodeRevealStepIndex.set(targetId, Math.max(targetStep, arrow.step));
      if (arrow.traceNode) {
        const traceId = getNodeId(arrow.traceNode);
        const traceStep = getRevealStepForNodeId(traceId);
        nodeRevealStepIndex.set(traceId, Math.min(traceStep, arrow.step));
      }

      const sourceSurface = resolveLeafSurface(arrow.source);
      const targetSurface = resolveLeafSurface(arrow.target);
      const traceAnchor = arrow.traceNode || (isTraceLike(sourceSurface) ? arrow.source : null);
      if (traceAnchor) {
        const traceId = getNodeId(traceAnchor);
        const traceSurface = resolveLeafSurface(traceAnchor);
        const traceRawAlias = extractMovementIndex(traceSurface);
        const targetRawAlias = extractMovementIndex(targetSurface);
        const relationIndex = arrow.index
          || (traceRawAlias ? derivationRawTraceAliasByIndex.get(String(traceRawAlias).trim().toLowerCase()) : undefined)
          || (targetRawAlias ? derivationRawTraceAliasByIndex.get(String(targetRawAlias).trim().toLowerCase()) : undefined)
          || traceRawAlias
          || targetRawAlias
          || null;
        const formattedTraceSurface = isTraceLike(traceSurface)
          ? formatTraceSurfaceForDisplay(traceSurface, relationIndex)
          : buildTraceLabel(relationIndex);
        terminalMorph.set(traceId, {
          preText: formattedTraceSurface,
          postText: formattedTraceSurface,
          step: arrow.step,
          hideBefore: false
        });
      }

      if ((arrow.target.children && arrow.target.children.length > 0)) {
        if (normalizeTrajectoryKind(arrow.trajectoryKind) !== 'head') {
          const sentenceInitialLeaf = findFirstOvertLeafDescendant(arrow.target);
          const sentenceInitialSurface = sentenceInitialLeaf
            ? resolveLeafSurface(sentenceInitialLeaf)
            : '';
          const preMovementSentenceInitialSurface =
            firstSentenceReplayToken
            && normalizeToken(sentenceInitialSurface) === normalizeToken(firstSentenceReplayToken)
              ? firstSentenceReplayToken.charAt(0).toLowerCase() + firstSentenceReplayToken.slice(1)
              : sentenceInitialSurface;
          const shouldCapitalizeSentenceInitialLeaf =
            sentenceInitialLeaf
            && (
              Number(sentenceInitialLeaf.data?.tokenIndex) === 0
              || (
                firstSentenceReplayToken
                && normalizeToken(sentenceInitialSurface) === normalizeToken(firstSentenceReplayToken)
              )
            );
          if (sentenceInitialLeaf && shouldCapitalizeSentenceInitialLeaf) {
            terminalMorph.set(getNodeId(sentenceInitialLeaf), {
              preText: preMovementSentenceInitialSurface,
              postText: firstSentenceReplayDisplayToken || (sentenceInitialSurface.charAt(0).toUpperCase() + sentenceInitialSurface.slice(1)),
              step: arrow.step,
              hideBefore: false
            });
          }
        }
      }

      if ((arrow.source.children && arrow.source.children.length > 0) || (arrow.target.children && arrow.target.children.length > 0)) {
        return;
      }

      if (!targetSurface) return;

      const targetIsRenderableTerminal = isRenderableTerminalSurface(targetSurface, overtSurfaceSet)
        || isTraceLike(targetSurface)
        || isNullLike(targetSurface);
      if (!targetIsRenderableTerminal) return;

      terminalMorph.set(targetId, {
        preText: '',
        postText: isTraceLike(targetSurface)
          ? formatTraceSurfaceForDisplay(
              targetSurface,
              arrow.index
                || (() => {
                  const rawAlias = extractMovementIndex(targetSurface);
                  return rawAlias
                    ? derivationRawTraceAliasByIndex.get(String(rawAlias).trim().toLowerCase())
                    : undefined;
                })()
                || extractMovementIndex(targetSurface)
            )
          : targetSurface,
        step: arrow.step,
        hideBefore: true
      });
    });

    terminalMorphRef.current = terminalMorph;

    g.selectAll('.branch')
      .data(visibleLinks)
      .enter()
      .append('path')
      .attr('class', 'branch')
      .attr('fill', 'none')
      .attr('stroke', BRANCH_COLOR)
      .attr('stroke-width', 4)
      .attr('data-step', (d: any) => String(getRevealStepForNodeId(getNodeId(d.target))))
      .attr('opacity', (d: any) => {
        const step = getRevealStepForNodeId(getNodeId(d.target));
        return step <= effectiveRevealThreshold ? 0.6 : 0;
      })
      .style('transition', 'opacity 280ms ease')
      .attr('d', d3.linkVertical().x((d: any) => d.x).y((d: any) => d.y) as any);

    if (movementArrows.length > 0) {
      const defs = g.append('defs');
      defs.append('marker')
        .attr('id', 'movement-arrowhead')
        .attr('viewBox', '0 0 10 10')
        .attr('refX', 9)
        .attr('refY', 5)
        .attr('markerWidth', 7)
        .attr('markerHeight', 7)
        .attr('orient', 'auto-start-reverse')
        .append('path')
        .attr('d', 'M 0 0 L 10 5 L 0 10 z')
        .attr('fill', MOVEMENT_ARROW_COLOR);

      const arrowsBySource = new Map<string, MovementArrow[]>();
      const arrowsByTarget = new Map<string, MovementArrow[]>();
      movementArrows.forEach((arrow) => {
        const sourceId = getNodeId(arrow.source);
        const targetId = getNodeId(arrow.target);
        const sourceBucket = arrowsBySource.get(sourceId) || [];
        sourceBucket.push(arrow);
        arrowsBySource.set(sourceId, sourceBucket);
        const targetBucket = arrowsByTarget.get(targetId) || [];
        targetBucket.push(arrow);
        arrowsByTarget.set(targetId, targetBucket);
      });

      const getGroupedOffset = (bucket: MovementArrow[] | undefined, arrow: MovementArrow): number => {
        if (!bucket || bucket.length <= 1) return 0;
        const ordinal = bucket.findIndex((candidate) => candidate === arrow);
        if (ordinal < 0) return 0;
        return (ordinal - ((bucket.length - 1) / 2)) * 18;
      };

      g.selectAll('.movement-arrow')
        .data(movementArrows)
        .enter()
        .append('path')
        .attr('class', 'movement-arrow')
        .attr('fill', 'none')
        .attr('stroke', MOVEMENT_ARROW_COLOR)
        .attr('stroke-width', MOVEMENT_ARC_STROKE)
        .attr('stroke-linecap', 'round')
        .attr('marker-end', 'url(#movement-arrowhead)')
        .attr('data-step', (arrow) => String(arrow.step))
        // Keep replay text and movement visuals synchronized per step.
        .style('transition', 'opacity 80ms linear')
        .attr('opacity', (arrow) => (arrow.step <= effectiveRevealThreshold ? 0.9 : 0))
        .style('filter', 'drop-shadow(0 0 4px rgba(16,185,129,0.35))')
        .attr('d', (arrow) => {
          const sourceOffset = getGroupedOffset(arrowsBySource.get(getNodeId(arrow.source)), arrow);
          const targetOffset = getGroupedOffset(arrowsByTarget.get(getNodeId(arrow.target)), arrow);
          const direction = Math.sign(arrow.target.x - arrow.source.x) || 1;
          const sx = arrow.source.x + 8 * direction + sourceOffset;
          const sy = arrow.source.y + 24;
          const tx = arrow.target.x - 8 * direction + targetOffset;
          const ty = arrow.target.y + 24;
          const controlX = (sx + tx) / 2;
          const controlY = Math.max(sy, ty) + Math.max(42, Math.abs(tx - sx) * 0.2);
          return `M ${sx} ${sy} Q ${controlX} ${controlY}, ${tx} ${ty}`;
        });
    }

    // 2. RENDER NODE GROUPS
    const nodeGroups = g.selectAll('.node-group')
      .data(visibleNodes)
      .enter()
      .append('g')
      .attr('class', 'node-group')
      .attr('transform', (d) => `translate(${d.x},${d.y})`)
      .attr('data-step', (d) => String(getRevealStepForNodeId(getNodeId(d))))
      .attr('opacity', (d) => {
        const step = getRevealStepForNodeId(getNodeId(d));
        return step <= effectiveRevealThreshold ? 1 : 0;
      })
      .style('transition', 'opacity 260ms ease');

    // 3. CATEGORY LABELS (Internal Nodes) - PURE WHITE
    const categories = nodeGroups.filter((d) =>
      (Boolean(d.children) && d.children.length > 0) || shouldExpandPreterminalLeaf(d.data)
    );
    categories.append('text')
      .attr('y', -10)
      .attr('text-anchor', 'middle')
      .attr('font-size', '42px') // Slightly reduced to balance visuals
      .attr('font-weight', '900')
      .attr('fill', PURE_WHITE)
      .style('fill', PURE_WHITE, 'important')
      .style('font-family', 'Quicksand, sans-serif')
      .style('paint-order', 'stroke')
      .style('stroke', '#020806')
      .style('stroke-width', '10px')
      .text(d => d.data.label);

    // 4. TERMINAL WORDS (Leaf Nodes) - ABSOLUTE EMERALD
    const leafNodes = nodeGroups.filter(d => !d.children || d.children.length === 0);
    const movementTerminalIds = new Set(Array.from(terminalMorphRef.current.keys()));
    const visibleOvertLeafIds = collectOvertLeafNodeIdsInOrder(clonedCanvasData);
    const maybeCapitalizeSurfacedSentenceInitialLeaf = (node: HierNode, value: string): string => {
      const trimmed = String(value || '').trim();
      if (!trimmed || isTraceLike(trimmed) || isNullLike(trimmed)) return trimmed;
      if (Number(node.data?.tokenIndex) !== 0) return trimmed;
      const firstVisibleOvertLeafId = String(visibleOvertLeafIds[0] || '').trim();
      if (!firstVisibleOvertLeafId || getNodeId(node) !== firstVisibleOvertLeafId) return trimmed;
      const nodeAncestorIds = new Set<string>();
      let currentAncestor: HierNode | null = node;
      while (currentAncestor) {
        const ancestorId = getNodeId(currentAncestor);
        if (ancestorId) nodeAncestorIds.add(ancestorId);
        currentAncestor = currentAncestor.parent;
      }
      const surfacedByPhraseMovement = activeDerivationArrowLinks.some((link) => {
        if (isHeadLikeResolvedRelation(link)) return false;
        const targetNodeId = String(link?.targetNodeId || '').trim();
        return Boolean(targetNodeId) && nodeAncestorIds.has(targetNodeId);
      });
      if (!surfacedByPhraseMovement) return trimmed;
      return firstSentenceReplayDisplayToken || (trimmed.charAt(0).toUpperCase() + trimmed.slice(1));
    };
    const getReplayTerminalSurface = (node: HierNode): string => {
      const fallback = resolveLeafSurface(node);
      if (isTraceLike(fallback) || isNullLike(fallback)) return fallback;
      if (!usesDerivationFrames || !animated || isFinalDerivationReplayStep) return fallback;
      const currentPlaybackStep = currentStepIndex >= 0 ? playbackSteps[currentStepIndex] : null;
      if (
        currentPlaybackStep?.operation === 'LexicalSelect' &&
        String(currentPlaybackStep.targetNodeId || '').trim() === getNodeId(node)
      ) {
        const explicitLexicalSurface = String(currentPlaybackStep.sourceLabels?.[0] || '').trim();
        if (explicitLexicalSurface) {
          const shouldForcePreFrontingLowercase =
            (
              Number(node.data?.tokenIndex) === 0
              || normalizeToken(explicitLexicalSurface) === normalizeToken(firstSentenceReplayToken)
            )
            && firstFrontingStepIndex > 0
            && currentStepIndex < firstFrontingStepIndex;
          return shouldForcePreFrontingLowercase
            ? explicitLexicalSurface.charAt(0).toLowerCase() + explicitLexicalSurface.slice(1)
            : explicitLexicalSurface;
        }
      }
      const fallbackParentLabel = activeDerivationFrame
        ? findParentLabelInForest(activeDerivationFrame.workspaceForest || [], getNodeId(node))
        : '';
      const committedParentLabel = findParentLabelInForest([data], getNodeId(node));
      const preFrontingSentenceInitialFunction =
        normalizeToken(fallback) === normalizeToken(firstSentenceReplayToken)
        && firstFrontingStepIndex > 0
        && currentStepIndex < firstFrontingStepIndex;
      if (preFrontingSentenceInitialFunction) {
        return fallback.charAt(0).toLowerCase() + fallback.slice(1);
      }
      const nodeAncestorIds = new Set<string>();
      let currentAncestor: HierNode | null = node;
      while (currentAncestor) {
        const ancestorId = getNodeId(currentAncestor);
        if (ancestorId) nodeAncestorIds.add(ancestorId);
        currentAncestor = currentAncestor.parent;
      }
      const surfacedByPhraseMovement = activeDerivationArrowLinks.some((link) => {
        if (isHeadLikeResolvedRelation(link)) return false;
        const targetNodeId = String(link?.targetNodeId || '').trim();
        return Boolean(targetNodeId) && nodeAncestorIds.has(targetNodeId);
      });
      const sentenceInitialSurface =
        surfacedByPhraseMovement
          ? (firstSentenceReplayDisplayToken || (fallback.charAt(0).toUpperCase() + fallback.slice(1)))
          : '';
      return maybeLowercaseSentenceInitialFunctionSurface({
        surface: fallback,
        sentenceInitialSurface,
        nodeId: getNodeId(node),
        parentLabel: String(node.parent?.data?.label || '').trim() || fallbackParentLabel || committedParentLabel,
        tokenIndex: Number(node.data?.tokenIndex),
        visibleOvertLeafIds,
        isWorkspaceForest: String(clonedCanvasData?.label || '').trim() === DERIVATION_WORKSPACE_ROOT_LABEL
      });
    };
    const isReplayAuthoredWordLeaf = (node: HierNode): boolean => {
      if (!usesDerivationFrames) return false;
      let current: HierNode | null = node;
      while (current) {
        if ((current.data as SyntaxNode)?.silent === true) return false;
        current = current.parent;
      }
      const word = String((node.data as SyntaxNode)?.word || '').trim();
      const surface = resolveLeafSurface(node);
      return Boolean(word)
        && Boolean(surface)
        && !isTraceLike(surface)
        && !isNullLike(surface)
        && !isStructuralCategorySurface(surface);
    };
    const isReplaySilentTerminalLeaf = (node: HierNode): boolean => {
      const surface = resolveLeafSurface(node);
      if (isTraceLike(surface) || isNullLike(surface)) return true;
      let current: HierNode | null = node;
      while (current) {
        if ((current.data as SyntaxNode)?.silent === true) return true;
        current = current.parent;
      }
      return false;
    };
    const abstractLeaves = leafNodes.filter((d) => {
      const nodeId = getNodeId(d);
      const surface = resolveLeafSurface(d);
      return !movementTerminalIds.has(nodeId)
        && !isReplayAuthoredWordLeaf(d)
        && !isOvertLeafNode(d, overtSurfaceSet)
        && !isTraceLike(surface)
        && !isNullLike(surface)
        && !isReplaySilentTerminalLeaf(d);
    });
    const terminals = leafNodes.filter((d) => {
      const nodeId = getNodeId(d);
      const surface = resolveLeafSurface(d);
      const canRenderAsTerminal = !isStructuralCategorySurface(surface)
        || isTraceLike(surface)
        || isNullLike(surface)
        || isOvertLeafNode(d, overtSurfaceSet);
      return (movementTerminalIds.has(nodeId) && canRenderAsTerminal)
        || isReplayAuthoredWordLeaf(d)
        || isReplaySilentTerminalLeaf(d)
        || isOvertLeafNode(d, overtSurfaceSet)
        || isTraceLike(surface)
        || isNullLike(surface);
    });
    const overtTerminals = terminals.filter((d) => {
      return !isRenderedReplaySilentTerminalLeaf(d);
    });
    const silentTerminals = terminals.filter((d) => {
      return isRenderedReplaySilentTerminalLeaf(d);
    });

    function getReplayRenderedTerminalText(d: HierNode): string {
      const nodeId = getNodeId(d);
      const fallback = maybeCapitalizeSurfacedSentenceInitialLeaf(d, getReplayTerminalSurface(d));
      const morph = terminalMorphRef.current.get(nodeId);
      const rawSurface = morph
        ? (
            effectiveRevealThreshold < morph.step
              ? (morph.hideBefore ? '' : (morph.preText || fallback))
              : (morph.postText || fallback)
          )
        : fallback;
      const inheritedTraceIndex = resolveTraceIndexFromNodeContext(
        d,
        derivationTraceIndexByNodeId
      );
      const rawTraceAlias = extractMovementIndex(rawSurface);
      const aliasedTraceIndex = rawTraceAlias
        ? derivationRawTraceAliasByIndex.get(String(rawTraceAlias).trim().toLowerCase())
        : undefined;
      const formatted = formatReplayIndexedSilentLeaf(
        rawSurface,
        inheritedTraceIndex,
        aliasedTraceIndex,
        isReplaySilentTerminalLeaf(d) && Boolean(inheritedTraceIndex || aliasedTraceIndex)
      );
      return (isTraceLike(formatted) || isNullLike(formatted))
        ? formatted
        : maybeCapitalizeSurfacedSentenceInitialLeaf(d, formatted);
    }

    function isRenderedReplaySilentTerminalLeaf(d: HierNode): boolean {
      const rendered = getReplayRenderedTerminalText(d);
      return isTraceLike(rendered) || isNullLike(rendered);
    }

    const appendTerminalText = (
      selection: d3.Selection<SVGGElement, HierNode, SVGGElement, unknown>,
      fill: string
    ) => selection.append('text')
      .attr('class', 'terminal-label')
      .attr('data-node-id', (d) => getNodeId(d))
      .attr('data-default-label', (d) => maybeCapitalizeSurfacedSentenceInitialLeaf(d, getReplayTerminalSurface(d)))
      .attr('data-trace-index', (d) => {
        const fallback = getReplayTerminalSurface(d);
        const inheritedTraceIndex = resolveTraceIndexFromNodeContext(
          d,
          derivationTraceIndexByNodeId
        );
        const rawTraceAlias = extractMovementIndex(fallback);
        const aliasedTraceIndex = rawTraceAlias
          ? derivationRawTraceAliasByIndex.get(String(rawTraceAlias).trim().toLowerCase())
          : undefined;
        if (!isTraceLike(fallback) && !(isNullLike(fallback) && (inheritedTraceIndex || aliasedTraceIndex))) {
          return '';
        }
        return normalizeTraceIndexForDisplay(
          inheritedTraceIndex || aliasedTraceIndex || extractMovementIndex(fallback)
        );
      })
      .attr('y', 115) // Adjusted vertical offset for smaller font
      .attr('text-anchor', 'middle')
      .attr('font-size', '56px') // Reduced from 84px to be more proportional
      .attr('font-weight', '900')
      .attr('fill', fill)
      .attr('style', `fill: ${fill} !important; font-family: 'Quicksand', sans-serif; font-style: italic; paint-order: stroke; stroke: #020806; stroke-width: 8px;`)
      .style('fill', fill, 'important')
      .text(d => getReplayRenderedTerminalText(d));

    // Pronounced leaves stay emerald; silent and abstract leaves stay muted.
    appendTerminalText(abstractLeaves, SILENT_SAGE);
    appendTerminalText(overtTerminals, TARGET_EMERALD);
    appendTerminalText(silentTerminals, SILENT_SAGE);

    // Vertical dashed connection for leaf nodes
    terminals.append('line')
      .attr('x1', 0).attr('y1', 20).attr('x2', 0).attr('y2', 65)
      .attr('stroke', BRANCH_COLOR).attr('stroke-width', 3).attr('stroke-dasharray', '8,8').attr('opacity', 0.6);
    abstractLeaves.append('line')
      .attr('x1', 0).attr('y1', 20).attr('x2', 0).attr('y2', 65)
      .attr('stroke', BRANCH_COLOR).attr('stroke-width', 3).attr('stroke-dasharray', '8,8').attr('opacity', 0.6);

    // 5. ABSTRACTION MODE (Triangles)
    const triangles = nodeGroups.filter((d: any) => d.isTriangulated);
    triangles.selectAll('text').remove();
    triangles.append('path')
      .attr('d', d => {
        const wordString = (d as any).triangulatedWords;
        const textWidth = wordString.length * 20;
        const half = Math.max(70, textWidth / 2 + 30);
        return `M 0,25 L ${-half},110 L ${half},110 Z`;
      })
      .attr('fill', 'rgba(16, 185, 129, 0.2)')
      .attr('stroke', PURE_WHITE)
      .attr('stroke-width', 3);

    triangles.append('text')
      .attr('y', 8)
      .attr('text-anchor', 'middle')
      .attr('font-size', '38px')
      .attr('font-weight', '900')
      .attr('fill', PURE_WHITE)
      .style('fill', PURE_WHITE, 'important')
      .style('font-family', 'Quicksand, sans-serif')
      .style('paint-order', 'stroke')
      .style('stroke', '#020806')
      .style('stroke-width', '9px')
      .text((d) => d.data.label || '');

    triangles.append('text')
      .attr('y', 155)
      .attr('text-anchor', 'middle')
      .attr('font-size', '52px') // Reduced for consistency
      .attr('font-weight', '900')
      .attr('fill', TARGET_EMERALD)
      .attr('style', `fill: ${TARGET_EMERALD} !important; font-family: 'Quicksand', sans-serif; font-style: italic; paint-order: stroke; stroke: #020806; stroke-width: 8px;`)
      .text((d: any) => (d as any).triangulatedWords);

    // Initial viewport fit:
    // Derivation replay should keep one camera per Derivation frame, not refit to each
    // microstep's partial tree. That prevents fake left/right "movement" for
    // newly revealed branches like Teresa -> D -> DP before the real merge step.
    const fitToRenderedBounds = () => {
      if (derivationFrameFitNodes && derivationFrameFitNodes.length > 0) {
        const minNodeX = d3.min(derivationFrameFitNodes, (node) => node.x) ?? 0;
        const maxNodeX = d3.max(derivationFrameFitNodes, (node) => node.x) ?? 0;
        const minNodeY = d3.min(derivationFrameFitNodes, (node) => node.y) ?? 0;
        const maxNodeY = d3.max(derivationFrameFitNodes, (node) => node.y + (!node.children || node.children.length === 0 ? 130 : 0)) ?? 0;
        const viewportPadLeft = 40;
        const viewportPadRight = 136;
        const viewportPadTop = 34;
        const viewportPadBottom = animated ? 170 : 250;
        const availableWidth = Math.max(120, containerWidth - viewportPadLeft - viewportPadRight);
        const availableHeight = Math.max(120, containerHeight - viewportPadTop - viewportPadBottom);
        const contentWidth = Math.max(1, (maxNodeX - minNodeX) + 440);
        const contentHeight = Math.max(1, (maxNodeY - minNodeY) + 320);
        const scaleX = availableWidth / contentWidth;
        const scaleY = availableHeight / contentHeight;
        const initialScale = Math.max(0.06, Math.min(scaleX, scaleY, 1));
        const centerX = (minNodeX + maxNodeX) / 2;
        const centerY = (minNodeY + maxNodeY) / 2;
        const initialX = viewportPadLeft + (availableWidth / 2) - centerX * initialScale;
        const initialY = viewportPadTop + (availableHeight / 2) - centerY * initialScale;
        svg.call(zoom.transform as any, d3.zoomIdentity.translate(initialX, initialY).scale(initialScale));
        return true;
      }

      const rendered = g.node() as SVGGElement | null;
      if (!rendered) return false;

      const bbox = rendered.getBBox();
      if (!Number.isFinite(bbox.width) || !Number.isFinite(bbox.height) || bbox.width <= 0 || bbox.height <= 0) {
        return false;
      }

      const viewportPadLeft = 40;
      const viewportPadRight = 136;
      const viewportPadTop = 34;
      // Reserve space for bottom overlays (input tray / derivation controls) so terminals remain visible.
      const viewportPadBottom = animated ? 170 : 250;
      const availableWidth = Math.max(120, containerWidth - viewportPadLeft - viewportPadRight);
      const availableHeight = Math.max(120, containerHeight - viewportPadTop - viewportPadBottom);

      const scaleX = availableWidth / bbox.width;
      const scaleY = availableHeight / bbox.height;
      const initialScale = Math.max(0.06, Math.min(scaleX, scaleY, 1));

      const bboxCenterX = bbox.x + bbox.width / 2;
      const bboxCenterY = bbox.y + bbox.height / 2;
      const targetCenterX = viewportPadLeft + availableWidth / 2;
      const targetCenterY = viewportPadTop + availableHeight / 2;
      const initialX = targetCenterX - bboxCenterX * initialScale;
      const initialY = targetCenterY - bboxCenterY * initialScale;

      svg.call(zoom.transform as any, d3.zoomIdentity.translate(initialX, initialY).scale(initialScale));
      return true;
    };

    if (!fitToRenderedBounds() && visibleNodes.length > 0) {
      // Fallback fit in case getBBox is unavailable.
      const minNodeX = d3.min(visibleNodes, (node) => node.x) ?? 0;
      const maxNodeX = d3.max(visibleNodes, (node) => node.x) ?? 0;
      const minNodeY = d3.min(visibleNodes, (node) => node.y) ?? 0;
      const maxNodeY = d3.max(visibleNodes, (node) => node.y + (!node.children || node.children.length === 0 ? 130 : 0)) ?? 0;
      const contentWidth = Math.max(1, (maxNodeX - minNodeX) + 440);
      const contentHeight = Math.max(1, (maxNodeY - minNodeY) + 320);
      const fallbackViewportPadLeft = 40;
      const fallbackViewportPadRight = 136;
      const scaleX = Math.max(0.01, (containerWidth - fallbackViewportPadLeft - fallbackViewportPadRight) / contentWidth);
      const scaleY = Math.max(0.01, (containerHeight - 220) / contentHeight);
      const initialScale = Math.max(0.06, Math.min(scaleX, scaleY, 1));
      const centerX = (minNodeX + maxNodeX) / 2;
      const centerY = (minNodeY + maxNodeY) / 2;
      const initialX = fallbackViewportPadLeft + ((containerWidth - fallbackViewportPadLeft - fallbackViewportPadRight) / 2) - centerX * initialScale;
      const initialY = (containerHeight - 140) / 2 - centerY * initialScale;
      svg.call(zoom.transform as any, d3.zoomIdentity.translate(initialX, initialY).scale(initialScale));
    }

  }, [
    activeDerivationFrame,
    activeDerivationFrameIndex,
    activeDerivationArrowLinks,
    activeDerivationRelationLinks,
    activeStepIndex,
    canvasData,
    dimensions,
    animated,
    abstractionMode,
    derivationStepsSignature,
    derivationFramesSignature,
    movementProtectedNodeIds,
    replayVisibleNodeIdSet,
    traceDisplayFrame,
    traceDisplayFrameIndex,
    traceDisplayRelationLinks,
    usesDerivationFrames
  ]);

  const activeStepRaw = currentStepIndex >= 0 ? playbackSteps[currentStepIndex] : null;
  const activeStep = activeStepRaw;
  const activeRecipeDisplay = stepRepresentsMovement(activeStep)
    ? formatOperationLabel(activeStep?.operation)
    : (String(activeStep?.recipe || '').trim() || `${activeStep?.targetLabel || 'Node'} created`);
  const activeSpelloutDisplay = Array.isArray(activeStep?.spelloutOrder)
    ? activeStep.spelloutOrder.filter(Boolean).join(' | ')
    : '';
  const activeReplaySupportLines = buildReplaySupportLines(activeStep, activeSpelloutDisplay, sentence);
  const activeNoteDisplay = (() => {
    const note = String(activeStep?.note || '').trim();
    if (!note) return '';
    if (note === activeRecipeDisplay) return '';
    const normalizeSurfaceText = (value?: string): string =>
      String(value || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (
      note.toLowerCase().startsWith('committed surface order:')
      && sentence
      && normalizeSurfaceText(note.replace(/^Committed surface order:\s*/i, '')) === normalizeSurfaceText(sentence)
    ) {
      return '';
    }
    return note;
  })();
  const stepPercent = playbackSteps.length > 1
    ? (activeStepIndex / (playbackSteps.length - 1)) * 100
    : 0;
  const operationLabel = formatPlaybackOperationTitle(activeStep);
  const showOperationLabel = Boolean(operationLabel) && operationLabel !== activeRecipeDisplay;
  const replayDisplayLedgerBlocksByStepIndex = useMemo(
    () => buildReplayDisplayLedgerBlocks(playbackSteps),
    [playbackSteps]
  );
  const activeDisplayLedgerBlocks = replayDisplayLedgerBlocksByStepIndex.get(activeStepIndex) || [];
  const canStepBackward = animated && playbackSteps.length > 0 && activeStepIndex > 0;
  const canStepForward = animated && playbackSteps.length > 0 && activeStepIndex < playbackSteps.length - 1;
  const activeDerivationStepLabel = String(activeStep?.stepId || '').trim();
  const activeReplayProgressLabel = String(activeStep?.replayProgressLabel || '').trim();
  const activeStageDisplayLabel = activeReplayProgressLabel
    || (activeDerivationStepLabel ? `Derivation Step ${activeDerivationStepLabel}` : '');

  const handlePrevStep = () => {
    setIsScrubbing(false);
    setIsAutoPlaying(false);
    setActiveStepIndex((index) => Math.max(0, index - 1));
  };

  const handleNextStep = () => {
    setIsScrubbing(false);
    setIsAutoPlaying(false);
    setActiveStepIndex((index) => Math.min(playbackSteps.length - 1, index + 1));
  };

  const handleTogglePlayback = () => {
    if (!animated || playbackSteps.length === 0) return;
    setIsScrubbing(false);
    if (activeStepIndex >= playbackSteps.length - 1) {
      setActiveStepIndex(0);
      setIsAutoPlaying(true);
      return;
    }
    setIsAutoPlaying((playing) => !playing);
  };

  return (
    <div ref={containerRef} className="w-full h-full overflow-hidden border-2 border-white/5 rounded-[3rem] tree-canvas-bg shadow-2xl relative">
      <div className="absolute top-8 left-10 pointer-events-none z-10 opacity-75 select-none">
        <div className="text-[10px] font-black text-emerald-500 uppercase tracking-[0.6em] flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${abstractionMode ? 'bg-amber-500 shadow-[0_0_15px_#f59e0b]' : 'bg-emerald-500 shadow-[0_0_15px_#10b981]'}`}></div>
          {abstractionMode ? 'CONSTITUENT GLYPHING ACTIVE' : (animated ? 'DERIVATION SEQUENCE ACTIVE' : 'ARBORETUM CANOPY')}
        </div>
        {animated && playbackSteps.length > 0 && (
          <div className="mt-2 text-[9px] font-black text-emerald-500/80 uppercase tracking-[0.35em]">
            Replay Frame {activeStepIndex + 1}/{playbackSteps.length}
            {activeStageDisplayLabel ? ` \u00b7 ${activeStageDisplayLabel}` : ''}
            {activeStep?.recipe ? ` - ${activeRecipeDisplay}` : ''}
          </div>
        )}
      </div>
      {animated && playbackSteps.length > 0 && (
        <div
          data-babel-replay-panel="true"
          className="absolute left-8 bottom-24 z-40 w-[min(880px,calc(100%-4rem))] max-h-[44vh] bg-[#020806]/96 border border-[#17362d] rounded-2xl p-4 shadow-2xl overflow-hidden"
        >
          <div className="flex items-center gap-2 mb-3">
            <button
              type="button"
              onClick={handlePrevStep}
              disabled={!canStepBackward}
              className="px-3 py-1.5 rounded-lg border border-white/10 text-[10px] font-black uppercase tracking-[0.2em] text-white/70 enabled:hover:text-emerald-300 enabled:hover:border-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={handleTogglePlayback}
              className="px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300 hover:bg-emerald-500/20"
            >
              {isAutoPlaying ? 'Pause' : (activeStepIndex >= playbackSteps.length - 1 ? 'Replay' : 'Play')}
            </button>
            <button
              type="button"
              onClick={handleNextStep}
              disabled={!canStepForward}
              className="px-3 py-1.5 rounded-lg border border-white/10 text-[10px] font-black uppercase tracking-[0.2em] text-white/70 enabled:hover:text-emerald-300 enabled:hover:border-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
            <div className="ml-auto text-right">
              <div className="text-[10px] font-black tracking-[0.14em] text-emerald-400/80">
                Replay {activeStepIndex + 1}/{playbackSteps.length}
                {activeStageDisplayLabel ? ` \u00b7 ${activeStageDisplayLabel}` : ''}
              </div>
              {showOperationLabel && (
                <div className="mt-1 text-[10px] font-black tracking-[0.14em] text-emerald-400/80">
                  {operationLabel}
                </div>
              )}
            </div>
          </div>
          <div className="relative h-8">
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-2 bg-black/50 rounded-full border border-white/5" />
            <div
              className={`absolute left-0 top-1/2 -translate-y-1/2 h-2 bg-[#064e3b] rounded-full ${isScrubbing ? '' : 'transition-all duration-150'}`}
              style={{ width: `${stepPercent}%` }}
            />
            <input
              type="range"
              min={0}
              max={Math.max(playbackSteps.length - 1, 0)}
              value={activeStepIndex}
              onPointerDown={() => {
                setIsAutoPlaying(false);
                setIsScrubbing(true);
              }}
              onPointerUp={() => setIsScrubbing(false)}
              onPointerCancel={() => setIsScrubbing(false)}
              onMouseUp={() => setIsScrubbing(false)}
              onTouchEnd={() => setIsScrubbing(false)}
              onBlur={() => setIsScrubbing(false)}
              onChange={(event) => {
                setIsAutoPlaying(false);
                setActiveStepIndex(Number(event.target.value));
              }}
              className="derivation-slider absolute inset-0 w-full h-full z-10"
            />
            <div
              className={`absolute top-1/2 -translate-y-1/2 pointer-events-none ${isScrubbing ? '' : 'transition-all duration-150'}`}
              style={{ left: `${stepPercent}%`, transform: 'translate(-50%, -50%)' }}
            >
              <div className="w-5 h-5 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center shadow-[0_0_12px_rgba(167,243,208,0.75)]">
                <RootLogo size={12} blend={false} zoom={1.12} />
              </div>
            </div>
          </div>
          <div className="mt-3 max-h-[calc(44vh-8rem)] overflow-y-auto pr-1 space-y-3">
            <div data-babel-replay-summary="true" className="text-[11px] text-white font-semibold">
              {activeRecipeDisplay}
            </div>
            {activeReplaySupportLines.length > 0 && (
              <div className="space-y-1 text-[10px] tracking-[0.12em] text-emerald-300/90">
                {activeReplaySupportLines.map((line) => (
                  <div key={`${line.label}:${line.value}`} className="leading-relaxed">
                    <span>{line.label}:</span>
                    <span className="ml-2 text-[11px] tracking-normal text-white/92">{line.value}</span>
                  </div>
                ))}
              </div>
            )}
              {activeStep?.microOperations && activeStep.microOperations.length > 0 && (
                <div className="pt-1">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-emerald-300/90 mb-1">
                    Micro-Operations
                  </div>
                  <div className="flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-white/90">
                    {activeStep.microOperations.map((op, idx) => (
                      <span key={`${op}-${idx}`}>
                        {formatOperationLabel(op)}
                        {idx < activeStep.microOperations!.length - 1 ? ' ->' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            {((activeStep?.featureChecking && activeStep.featureChecking.length > 0) || activeDisplayLedgerBlocks.length > 0) && (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
                {activeStep?.featureChecking && activeStep.featureChecking.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.16em] text-emerald-300/90 mb-2">
                      Feature Checking
                    </div>
                    <div className="space-y-1">
                      {activeStep.featureChecking.map((entry, idx) => (
                        <div key={`${entry.feature}-${idx}`} className="text-[11px] text-white/90 leading-relaxed">
                          {formatFeatureCheckingEntry(entry)}
                          {entry.note ? ` - ${entry.note}` : ''}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {activeDisplayLedgerBlocks.map((block, blockIndex) => (
                  <div key={`${block.title}-${blockIndex}`}>
                    <div className="text-[10px] uppercase tracking-[0.16em] text-emerald-300/90 mb-2">
                      {formatReplayBlockTitle(block.title)}
                    </div>
                    <div className="space-y-1">
                      {block.lines.map((line, lineIndex) => (
                        <div key={`${block.title}-${lineIndex}`} className="text-[11px] text-white/90 leading-relaxed whitespace-pre-line">
                          {formatReplayBlockLine(block.title, line, playbackSteps)}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {activeNoteDisplay && (
              <div className="text-[11px] text-white/88">
                {activeNoteDisplay}
              </div>
            )}
          </div>
        </div>
      )}
      <svg ref={svgRef} className="cursor-grab active:cursor-grabbing w-full h-full block" />
      <style>{`
        .derivation-slider {
          -webkit-appearance: none;
          appearance: none;
          background: transparent;
          cursor: pointer;
        }
        .derivation-slider::-webkit-slider-runnable-track {
          height: 100%;
          background: transparent;
        }
        .derivation-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 1px;
          height: 1px;
          opacity: 0;
        }
        .derivation-slider::-moz-range-track {
          height: 100%;
          background: transparent;
          border: 0;
        }
        .derivation-slider::-moz-range-thumb {
          width: 1px;
          height: 1px;
          opacity: 0;
          border: 0;
        }
      `}</style>
    </div>
  );
};

export default TreeVisualizer;
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
  maybeLowercaseSentenceInitialFunctionSurface
};
