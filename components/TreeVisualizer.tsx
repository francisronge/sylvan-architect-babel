import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { DerivationStep, FeatureCheckEvent, GrowthFrame, MovementEvent, ReplayLedgerBlock, SyntaxNode } from '../types';
import { EMPTY_MOVEMENT_INDEX_MAPS, MovementIndexMaps, ResolvedMovementEventLink, resolveMovementEventLinks } from '../movementEvents';
import RootLogo from './RootLogo';

interface TreeVisualizerProps {
  data: SyntaxNode;
  animated?: boolean;
  derivationSteps?: DerivationStep[];
  growthFrames?: GrowthFrame[];
  movementEvents?: MovementEvent[];
  resolvedMovementLinks?: ResolvedMovementEventLink[];
  movementMaps?: MovementIndexMaps;
  abstractionMode?: boolean;
  sentence?: string;
}

type HierNode = d3.HierarchyNode<SyntaxNode>;
type VisibleLink = d3.HierarchyLink<SyntaxNode>;

interface PlaybackStep {
  operation: DerivationStep['operation'];
  microOperations?: DerivationStep['operation'][];
  sourceFrameIndex?: number;
  visualFrameIndex?: number;
  replayFrameIndex?: number;
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
  replayCanvasData?: SyntaxNode | null;
  replayLayoutCanvasData?: SyntaxNode | null;
  replayVisibleNodeIds?: string[];
  replayMovementLinks?: ResolvedMovementEventLink[];
}

interface ReplaySupportLine {
  label: string;
  value: string;
}

const GROWTH_WORKSPACE_ROOT_LABEL = '__GROWTH_WORKSPACE__';

interface MovementArrow {
  source: HierNode;
  target: HierNode;
  traceNode?: HierNode;
  step: number;
  index?: string | null;
}

interface GrowthMovementTransition {
  sourceId: string;
  targetId: string;
  traceId: string | null;
  step: number;
  index: string;
  chainId?: string | null;
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
  String(node.data?.label || '') === GROWTH_WORKSPACE_ROOT_LABEL;

const buildGrowthCanvasData = (forest: SyntaxNode[]): SyntaxNode | null => {
  if (!Array.isArray(forest) || forest.length === 0) return null;
  if (forest.length === 1) return forest[0];
  return {
    label: GROWTH_WORKSPACE_ROOT_LABEL,
    children: forest
  };
};

const buildRenderableGrowthCanvasData = (
  forest: SyntaxNode[],
  resolvedMovementLinks?: ResolvedMovementEventLink[]
): SyntaxNode | null => {
  const canvas = buildGrowthCanvasData(forest);
  if (!canvas) return null;
  return materializeCanopyPreterminals(
    materializeTraceShellsFromMovementLinks(canvas, resolvedMovementLinks)
  );
};

const buildRenderableCommittedCanvasData = (
  tree: SyntaxNode,
  resolvedMovementLinks?: ResolvedMovementEventLink[]
): SyntaxNode => {
  return materializeCanopyPreterminals(
    materializeTraceShellsFromMovementLinks(tree, resolvedMovementLinks)
  );
};

const resolveGrowthFrameMovementLinks = (
  forest: SyntaxNode[],
  movementEvents?: MovementEvent[],
  activeFrameIndex: number = Number.MAX_SAFE_INTEGER
): ResolvedMovementEventLink[] => {
  const canvas = buildGrowthCanvasData(forest);
  if (!canvas) return [];
  if (!Array.isArray(movementEvents) || movementEvents.length === 0) return [];
  const activeEvents = movementEvents.filter((event) => {
    const rawStep = Number(event?.stepIndex);
    if (!Number.isInteger(rawStep) || rawStep < 0) return true;
    return rawStep <= activeFrameIndex;
  });
  if (activeEvents.length === 0) return [];
  return resolveMovementEventLinks(canvas, activeEvents);
};

const collectVisibleGrowthNodeIds = (
  forest: SyntaxNode[],
  resolvedMovementLinks?: ResolvedMovementEventLink[]
): Set<string> => {
  const canvas = buildRenderableGrowthCanvasData(forest, resolvedMovementLinks);
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
  visibleNodeIds?: Set<string>
): SyntaxNode | null => {
  if (!visibleNodeIds || visibleNodeIds.size === 0) return null;

  const cloneVisibleNode = (node: HierNode): SyntaxNode | null => {
    if (!visibleNodeIds.has(getNodeId(node))) return null;
    const dataClone = cloneSyntaxTree(node.data);
    if (!dataClone) return null;
    const childSnapshots = (node.children || [])
      .map((child) => cloneVisibleNode(child))
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
      const parent = node.parent;
      if (!parent || isSyntheticWorkspaceRootNode(parent)) return true;
      return !visibleNodeIds.has(getNodeId(parent));
    })
    .sort((a, b) => (preorderIndex.get(getNodeId(a)) ?? 0) - (preorderIndex.get(getNodeId(b)) ?? 0));

  const forest = visibleRoots
    .map((node) => cloneVisibleNode(node))
    .filter((node): node is SyntaxNode => Boolean(node));

  if (forest.length === 0) return null;
  if (forest.length === 1) return forest[0];
  return {
    label: GROWTH_WORKSPACE_ROOT_LABEL,
    children: forest
  };
};

const extractReplayWorkspaceLabels = (canvasData: SyntaxNode | null): string[] => {
  if (!canvasData) return [];
  const roots = String(canvasData.label || '').trim() === GROWTH_WORKSPACE_ROOT_LABEL
    ? (Array.isArray(canvasData.children) ? canvasData.children : [])
    : [canvasData];
  return roots
    .map((node) => String(node?.label || '').trim())
    .filter(Boolean);
};

const buildGrowthReplaySnapshot = (
  forest: SyntaxNode[],
  activeFrameIndex: number,
  movementEvents?: MovementEvent[],
  fallbackMovementLinks?: ResolvedMovementEventLink[],
  visibleNodeIds?: Set<string>
): {
  canvasData: SyntaxNode | null;
  movementLinks: ResolvedMovementEventLink[];
} => {
  const frameMovementLinks = resolveGrowthFrameMovementLinks(forest, movementEvents, activeFrameIndex);
  const effectiveMovementLinks = frameMovementLinks.length > 0
    ? frameMovementLinks
    : (fallbackMovementLinks || []);
  const renderableCanvas = buildRenderableGrowthCanvasData(forest, effectiveMovementLinks);
  const clonedCanvas = cloneSyntaxTree(renderableCanvas);
  if (!clonedCanvas) {
    return {
      canvasData: null,
      movementLinks: effectiveMovementLinks
    };
  }

  const hierarchy = d3.hierarchy(clonedCanvas);
  applyVizIds(hierarchy);
  const effectiveVisibleNodeIds = visibleNodeIds && visibleNodeIds.size > 0
    ? visibleNodeIds
    : new Set(
        hierarchy
          .descendants()
          .filter((node) => !isSyntheticWorkspaceRootNode(node))
          .map((node) => getNodeId(node))
      );

  return {
    canvasData: buildVisibleSyntaxSnapshotFromHierarchy(hierarchy, effectiveVisibleNodeIds),
    movementLinks: effectiveMovementLinks
  };
};

const cloneSyntaxTree = (node?: SyntaxNode | null): SyntaxNode | null => {
  if (!node || typeof node !== 'object') return null;
  const serialized = JSON.stringify(node);
  if (!serialized) return null;
  return JSON.parse(serialized) as SyntaxNode;
};

const LOW_SIGNAL_REPLAY_TEXT_RE = /^(?:initial logic and parameters are validated|standard processing applied|standard processing is applied|default processing applied|final transformation(?: applied)?|structural relations are established|final structure established|the derivation converges(?: with all features checked(?: and the overt word order successfully derived)?)?(?: and is sent to spellout)?|(?:lexicalselect|project|externalmerge|headmove|a-move|abarmove|agree|spellout|other)\s+frame\s+\d+)\.?$/i;

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

const buildStructuralReplayFallback = (
  operation: DerivationStep['operation'] | string | undefined,
  primaryRootLabel: string,
  rootLabels: string[]
): string => {
  const op = String(operation || '').trim();
  const target = primaryRootLabel || rootLabels[0] || 'workspace';
  const targetIsTraceLike = isTraceLike(target) || isNullLike(target);
  switch (op) {
    case 'LexicalSelect':
      return `Select ${target}`;
    case 'Project':
      return `Project ${target}`;
    case 'ExternalMerge':
      return targetIsTraceLike ? 'External merge' : `External merge into ${target}`;
    case 'InternalMerge':
    case 'Move':
      return targetIsTraceLike ? 'Internal merge' : `Internal merge to ${target}`;
    case 'A-Move':
      return targetIsTraceLike ? 'A-movement' : `A-movement to ${target}`;
    case 'AbarMove':
      return targetIsTraceLike ? 'A-bar movement' : `A-bar movement to ${target}`;
    case 'HeadMove':
      return targetIsTraceLike ? 'Head movement' : `Head movement to ${target}`;
    case 'Agree':
      return `Agree on ${target}`;
    case 'SpellOut':
      return 'Spell out committed structure';
    case 'Other':
      return target && target !== 'Workspace' ? `Establish ${target}` : 'Update derivational workspace';
    default:
      return target && target !== 'Workspace' ? `Establish ${target}` : 'Update derivational workspace';
  }
};

const buildPlaybackStepsFromGrowthFrames = (
  frames: GrowthFrame[],
  derivationSteps?: DerivationStep[],
  resolvedMovementLinks?: ResolvedMovementEventLink[],
  movementEvents?: MovementEvent[]
): PlaybackStep[] => {
  const alignedSteps = Array.isArray(derivationSteps) ? derivationSteps : [];
  const stepsById = new Map(
    alignedSteps
      .map((step) => [String(step?.stepId || '').trim(), step] as const)
      .filter(([stepId]) => Boolean(stepId))
  );

  const usedStepIds = new Set<string>();
  let previousVisibleNodeIds = new Set<string>();
  const frameBackedSteps = frames.flatMap((frame, index) => {
    const alignedStep = (() => {
      const frameStepId = String(frame?.stepId || '').trim();
      if (frameStepId && stepsById.has(frameStepId)) {
        return stepsById.get(frameStepId);
      }
      return alignedSteps[index];
    })();
    const workspaceRoots = Array.isArray(frame.workspaceForest) ? frame.workspaceForest : [];
    const rootLabels = workspaceRoots
      .map((node) => String(node?.label || '').trim())
      .filter(Boolean);
    const primaryRoot = workspaceRoots[0];
    const primaryRootId = String(primaryRoot?.id || '').trim();
    const primaryRootLabel = String(primaryRoot?.label || '').trim() || 'Workspace';
    const fallbackOperation = frame.operation || alignedStep?.operation || 'Other';
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
    const carriesStructuredAuditPayload =
      (Array.isArray(frame.spelloutOrder) && frame.spelloutOrder.length > 0) ||
      (Array.isArray(frame.featureChecking) && frame.featureChecking.length > 0) ||
      (Array.isArray(alignedStep?.featureChecking) && alignedStep.featureChecking.length > 0) ||
      (Array.isArray(alignedStep?.ledgerBlocks) && alignedStep.ledgerBlocks.length > 0);
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
      if (isMoveLikeOperation(fallbackOperation)) {
        return movementRecipe || structuralFallbackRecipe;
      }
      return structuralFallbackRecipe;
    })();
    const alignedStepId = String(alignedStep?.stepId || '').trim();
    if (alignedStepId) usedStepIds.add(alignedStepId);

    const operationForFrame = String(fallbackOperation || '').trim();
    const shouldDeriveStructuralMicroSteps =
      !isMoveLikeOperation(operationForFrame) &&
      operationForFrame !== 'SpellOut';
    const frameReplaySnapshot = buildGrowthReplaySnapshot(
      workspaceRoots,
      index,
      movementEvents,
      resolvedMovementLinks
    );
    const structuralMicroSteps = shouldDeriveStructuralMicroSteps
      ? buildStructuralGrowthPlaybackSteps(
          workspaceRoots,
          index,
          previousVisibleNodeIds,
          resolvedMovementLinks,
          movementEvents
        )
      : [];
    previousVisibleNodeIds = collectVisibleGrowthNodeIds(
      workspaceRoots,
      frameReplaySnapshot.movementLinks
    );

    const frameSemanticStep: PlaybackStep = {
      operation: frame.operation || alignedStep?.operation,
      microOperations: Array.isArray(frame.microOperations) && frame.microOperations.length > 0
        ? frame.microOperations
        : alignedStep?.microOperations,
      sourceFrameIndex: index,
      visualFrameIndex: index,
      targetNodeId:
        String(frame.movement?.targetNodeId || '').trim() ||
        primaryRootId ||
        alignedStep?.targetNodeId ||
        frame.frameId ||
        frame.stepId ||
        `__growth_${index}`,
      targetLabel:
        (rootLabels.length === 1 ? primaryRootLabel : 'Workspace') ||
        alignedStep?.targetLabel ||
        'Workspace',
      sourceNodeIds: alignedStep?.sourceNodeIds,
      sourceLabels: Array.isArray(alignedStep?.sourceLabels) && alignedStep.sourceLabels.length > 0
        ? alignedStep.sourceLabels
        : rootLabels,
      recipe: semanticRecipe,
      workspaceAfter: Array.isArray(alignedStep?.workspaceAfter) && alignedStep.workspaceAfter.length > 0
        ? alignedStep.workspaceAfter
        : rootLabels,
      spelloutOrder: frame.spelloutOrder || alignedStep?.spelloutOrder,
      featureChecking: Array.isArray(frame.featureChecking) && frame.featureChecking.length > 0
        ? frame.featureChecking
        : alignedStep?.featureChecking,
      ledgerBlocks: alignedStep?.ledgerBlocks,
      stepId: alignedStep?.stepId || frame.stepId,
      trigger: alignedStep?.trigger || frame.trigger,
      chainId: alignedStep?.chainId || frame.chainId,
      spelloutDomain: alignedStep?.spelloutDomain || frame.spelloutDomain,
      note: preferredNote && preferredNote !== semanticRecipe ? preferredNote : undefined,
      replayFrameIndex: index,
      replayCanvasData: frameReplaySnapshot.canvasData,
      replayMovementLinks: frameReplaySnapshot.movementLinks
    };

    const shouldAppendFrameSemanticStep =
      isMoveLikeOperation(frameSemanticStep.operation) ||
      String(frameSemanticStep.operation || '').trim() === 'SpellOut' ||
      (Array.isArray(frameSemanticStep.featureChecking) && frameSemanticStep.featureChecking.length > 0) ||
      (Array.isArray(frameSemanticStep.ledgerBlocks) && frameSemanticStep.ledgerBlocks.length > 0) ||
      (Array.isArray(frameSemanticStep.spelloutOrder) && frameSemanticStep.spelloutOrder.length > 0);

    if (!shouldAppendFrameSemanticStep && structuralMicroSteps.length > 0) {
      const mergedStructuralSteps = [...structuralMicroSteps];
      const lastIndex = mergedStructuralSteps.length - 1;
      mergedStructuralSteps[lastIndex] = {
        ...mergedStructuralSteps[lastIndex],
        stepId: frameSemanticStep.stepId || mergedStructuralSteps[lastIndex].stepId,
        trigger: frameSemanticStep.trigger || mergedStructuralSteps[lastIndex].trigger,
        spelloutDomain: frameSemanticStep.spelloutDomain || mergedStructuralSteps[lastIndex].spelloutDomain
      };
      return mergedStructuralSteps;
    }

    return [...structuralMicroSteps, frameSemanticStep];
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

  const supplementalProvided = alignedSteps.flatMap((step, originalIndex) => {
    const stepId = String(step?.stepId || '').trim();
    if (!stepId || usedStepIds.has(stepId)) return [];
    const boundedFrameIndex = Math.max(0, Math.min(originalIndex, Math.max(frameBackedSteps.length - 1, 0)));
    return [{
      operation: step.operation || 'Other',
      microOperations: step.microOperations,
      targetNodeId: step.targetNodeId || `__growth_supplemental_${originalIndex}`,
      targetLabel: step.targetLabel || 'Workspace',
      sourceNodeIds: step.sourceNodeIds,
      sourceLabels: step.sourceLabels || [],
      recipe: step.recipe || step.note || 'Derivation',
      workspaceAfter: step.workspaceAfter,
      spelloutOrder: step.spelloutOrder,
      featureChecking: step.featureChecking,
      ledgerBlocks: step.ledgerBlocks,
      sourceFrameIndex: boundedFrameIndex,
      visualFrameIndex: boundedFrameIndex,
      stepId: step.stepId,
      trigger: step.trigger,
      chainId: step.chainId,
      spelloutDomain: step.spelloutDomain,
      note: step.note
    }];
  });

  const squashedFrameBackedSteps = dropLowSignalStructuralFrameSummaries(
    squashAdjacentStructuralReplayDuplicates(expandedFrameBackedSteps)
  );
  const nonSpellout = squashedFrameBackedSteps.filter((step) => String(step.operation || '').trim() !== 'SpellOut');
  const spellout = squashedFrameBackedSteps.filter((step) => String(step.operation || '').trim() === 'SpellOut');
  return [...nonSpellout, ...supplementalProvided, ...spellout];
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
      !isMoveLikeOperation(previous?.operation) &&
      !isMoveLikeOperation(step.operation) &&
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
      !isMoveLikeOperation(step.operation) &&
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
    return Boolean(surface) && !isTraceLike(surface) && !isNullLike(surface);
  }) || null;
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
  const visit = (node: SyntaxNode): SyntaxNode | null => {
    if (String(node.id || '').trim() === targetNodeId) return node;
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
  const normalized = normalizeStructuralLabel(label);
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
  operation,
  traceParent
}: {
  forest: SyntaxNode[];
  tracePath: number[] | null;
  movedPath: number[] | null;
  operation?: string;
  traceParent?: SyntaxNode | null;
}): string => {
  const normalizedOperation = normalizeMovementOperationLabel(operation);

  if (normalizedOperation === 'headmove') {
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

const materializeTraceShellsFromMovementLinks = (
  root: SyntaxNode,
  links?: ResolvedMovementEventLink[]
): SyntaxNode => {
  if (!root || !Array.isArray(links) || links.length === 0) return root;

  const clonedRoot = cloneSyntaxTree(root);
  if (!clonedRoot) return root;
  const forest = [clonedRoot];

  links.forEach((link) => {
    const traceId = String(link?.traceAnchorId || '').trim();
    const movedId = String(link?.movedAnchorId || '').trim();
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
      operation: link?.operation,
      traceParent: parentNode
    });
    if (!shellLabel) return;
    const parentLabel = String(parentNode?.label || '').trim();
    if (normalizeStructuralLabel(parentLabel) === normalizeStructuralLabel(shellLabel)) return;

    replaceNodeAtForestPath(forest, tracePath, {
      id: `${traceId}__shell`,
      label: shellLabel,
      children: [traceNode]
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

const resolveGrowthMovementTransitions = (
  currentForest: SyntaxNode[],
  growthFrames: GrowthFrame[] | undefined,
  activeStepIndex: number,
  resolvedMovementLinks?: ResolvedMovementEventLink[]
): GrowthMovementTransition[] => {
  const frames = Array.isArray(growthFrames) ? growthFrames : [];
  if (frames.length === 0) return [];
  const currentNodesById = collectForestNodesById(currentForest);
  const currentNodeIds = new Set(currentNodesById.keys());
  const movementIndexByKey = new Map<string, string>();
  let nextMovementIndex = 1;

  const getCanonicalMovementIndex = (
    frame: GrowthFrame,
    sourceId: string,
    targetId: string,
    frameIndex: number
  ): string => {
    const key = String(frame.chainId || '').trim()
      || `${String(frame.operation || '').trim()}|${sourceId}|${targetId}|${frameIndex}`;
    const existing = movementIndexByKey.get(key);
    if (existing) return existing;
    const assigned = String(nextMovementIndex);
    nextMovementIndex += 1;
    movementIndexByKey.set(key, assigned);
    return assigned;
  };

  const transitions: GrowthMovementTransition[] = [];
  const transitionKeys = new Set<string>();
  for (let frameIndex = 0; frameIndex <= Math.min(activeStepIndex, frames.length - 1); frameIndex += 1) {
    const frame = frames[frameIndex];
    const movement = frame?.movement;
    if (!movement) continue;
    const chainId = String(frame.chainId || '').trim();

    const movementForest = Array.isArray(frame.workspaceForest) ? frame.workspaceForest : [];
    const previousFrame = frameIndex > 0 ? frames[frameIndex - 1] : null;
    const previousForest = Array.isArray(previousFrame?.workspaceForest) ? previousFrame.workspaceForest : [];
    const movementNodesById = collectForestNodesById(movementForest);
    const previousNodesById = collectForestNodesById(previousForest);

    const rawSourceId = String(movement.sourceNodeId || '').trim();
    const rawTargetId = String(movement.targetNodeId || '').trim();
    if (!rawSourceId && !rawTargetId) continue;

    const sourceCurrentData = rawSourceId ? currentNodesById.get(rawSourceId) : undefined;
    const targetCurrentData = rawTargetId ? currentNodesById.get(rawTargetId) : undefined;
    const sourceFrameNode = rawSourceId ? movementNodesById.get(rawSourceId) : undefined;
    const targetFrameNode = rawTargetId ? movementNodesById.get(rawTargetId) : undefined;
    const explicitTraceFrameNode = String((movement as any)?.traceNodeId || '').trim()
      ? movementNodesById.get(String((movement as any).traceNodeId).trim())
      : undefined;

    let resolvedTargetId = rawTargetId;
    const targetLooksBad =
      !targetCurrentData ||
      isTraceOrNullLikeNode(targetCurrentData) ||
      (Boolean(sourceCurrentData)
        && isBroadProjectionLike(targetCurrentData)
        && normalizeLabel(targetCurrentData?.label) !== normalizeLabel(sourceCurrentData?.label));
    if (sourceCurrentData && targetLooksBad) {
      resolvedTargetId = rawSourceId;
    }

    let resolvedSourceId = rawSourceId;
    if (!sourceCurrentData || !isTraceOrNullLikeNode(sourceCurrentData)) {
      const previousPath = rawSourceId ? findNodePathInForest(previousForest, rawSourceId) : null;
      const replacementNode = getNodeAtForestPath(movementForest, previousPath);
      const replacementId = String(replacementNode?.id || '').trim();
      if (replacementId && replacementId !== rawSourceId && isTraceOrNullLikeNode(replacementNode)) {
        resolvedSourceId = replacementId;
      } else {
        const traceCandidates = Array.from(movementNodesById.values()).filter((node) => {
          const nodeId = String(node?.id || '').trim();
          return Boolean(nodeId)
            && isTraceOrNullLikeNode(node)
            && !previousNodesById.has(nodeId);
        });
        if (traceCandidates.length === 1) {
          resolvedSourceId = String(traceCandidates[0].id || '').trim();
        }
      }
    }

    const movementTargetNode = rawTargetId
      ? getNodeAtForestPath(movementForest, findNodePathInForest(movementForest, rawTargetId))
      : null;
    const movementTargetId = String(movementTargetNode?.id || '').trim();
    if (movementTargetId && movementTargetId !== resolvedSourceId && !isTraceOrNullLikeNode(movementTargetNode)) {
      resolvedTargetId = movementTargetId;
    }

    const currentTargetMissing =
      !resolvedTargetId ||
      !currentNodesById.has(resolvedTargetId) ||
      resolvedTargetId === resolvedSourceId;
    if (currentTargetMissing && chainId) {
      for (let lookahead = frameIndex + 1; lookahead <= Math.min(activeStepIndex, frames.length - 1); lookahead += 1) {
        const nextFrame = frames[lookahead];
        if (String(nextFrame?.chainId || '').trim() !== chainId) continue;
        const nextSourceId = String(nextFrame?.movement?.sourceNodeId || '').trim();
        if (!nextSourceId || nextSourceId === resolvedSourceId) continue;
        resolvedTargetId = nextSourceId;
        break;
      }
    }

    let resolvedTraceId = currentNodesById.has(resolvedSourceId) ? resolvedSourceId : null;
    if (normalizeLabel(sourceFrameNode?.label) === 'V' && normalizeLabel(targetFrameNode?.label) === 'V') {
      const traceLeaf = pickTraceLikeLeafNode(explicitTraceFrameNode || sourceFrameNode);
      const overtTargetLeaf = pickOvertLeafNode(targetFrameNode);
      if (traceLeaf?.id) {
        resolvedSourceId = String(traceLeaf.id).trim();
        resolvedTraceId = resolvedSourceId;
      }
      if (overtTargetLeaf?.id) {
        resolvedTargetId = String(overtTargetLeaf.id).trim();
      }
    } else {
      const traceLeaf = pickTraceLikeLeafNode(explicitTraceFrameNode || sourceFrameNode);
      if (traceLeaf?.id && currentNodesById.has(String(traceLeaf.id).trim())) {
        resolvedTraceId = String(traceLeaf.id).trim();
      }
    }

    if (!resolvedSourceId || !resolvedTargetId || resolvedSourceId === resolvedTargetId) continue;
    const transitionKey = `${resolvedSourceId}->${resolvedTargetId}@${frameIndex}`;
    if (transitionKeys.has(transitionKey)) continue;
    transitionKeys.add(transitionKey);
    transitions.push({
      sourceId: resolvedSourceId,
      targetId: resolvedTargetId,
      traceId: resolvedTraceId,
      step: frameIndex,
      index: getCanonicalMovementIndex(frame, resolvedSourceId, resolvedTargetId, frameIndex),
      chainId: chainId || null
    });
  }

  (Array.isArray(resolvedMovementLinks) ? resolvedMovementLinks : []).forEach((link) => {
    const sourceId = String(link?.sourceAnchorId || '').trim();
    const targetId = String(link?.movedAnchorId || '').trim();
    if (!sourceId || !targetId || sourceId === targetId) return;
    const step = Number.isInteger(link?.stepIndex) ? Number(link.stepIndex) : 0;
    if (step > activeStepIndex) return;
    if (!currentNodeIds.has(sourceId) || !currentNodeIds.has(targetId)) return;
    const transitionKey = `${sourceId}->${targetId}@${step}`;
    if (transitionKeys.has(transitionKey)) return;
    transitionKeys.add(transitionKey);
    transitions.push({
      sourceId,
      targetId,
      traceId: currentNodeIds.has(String(link?.traceAnchorId || '').trim())
        ? String(link.traceAnchorId).trim()
        : null,
      step,
      index: String(link?.movementIndex || '').trim() || `${transitions.length + 1}`,
      chainId: null
    });
  });

  return transitions;
};

const resolveNodeLabel = (node: HierNode): string => node.data.label || node.data.word || '';
const resolveLeafSurface = (node: HierNode): string => (node.data.word || node.data.label || '').trim();
const NULL_LIKE_LABEL = /^(∅|Ø|ε|NULL|EPSILON)$/i;
const NULLABLE_HEAD_CATEGORIES = new Set(['C', 'INFL', 'T', 'I', 'D', 'NEG', 'ASP']);
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

const sanitizeGrowthTraceLeaves = (node: SyntaxNode): SyntaxNode => {
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

const tokenizeReplaySentenceSurface = (sentence: string): string[] =>
  String(sentence || '')
    .trim()
    .split(/\s+/)
    .map((token) => String(token || '').trim().replace(/^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu, ''))
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

const maybeLowercaseSentenceInitialFunctionSurface = ({
  surface,
  nodeId,
  parentLabel,
  tokenIndex,
  visibleOvertLeafIds,
  isWorkspaceForest = false
}: {
  surface: string;
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
  const visibleIds = Array.isArray(visibleOvertLeafIds) ? visibleOvertLeafIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
  const firstVisibleOvertLeafId = visibleIds[0] || '';
  const isSentenceInitialInVisibleReplay = normalizedNodeId && normalizedNodeId === firstVisibleOvertLeafId;
  if (!isWorkspaceForest && isSentenceInitialInVisibleReplay) return trimmed;

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
  resolvedMovementLinks: ResolvedMovementEventLink[] | undefined,
  activeStepIndex: number
): Map<string, string> => {
  const traceIndexByNodeId = new Map<string, string>();
  const links = Array.isArray(resolvedMovementLinks) ? resolvedMovementLinks : [];
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
    const traceId = String(link?.traceAnchorId || '').trim();
    const sourceId = String(link?.sourceAnchorId || '').trim();
    const movedId = String(link?.movedAnchorId || '').trim();
    const index = String(link?.movementIndex || '').trim();
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
  resolvedMovementLinks: ResolvedMovementEventLink[] | undefined,
  activeStepIndex: number
): Map<string, string> => {
  const rawAliasByIndex = new Map<string, string>();
  const links = Array.isArray(resolvedMovementLinks) ? resolvedMovementLinks : [];
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
    assignFromNode(link?.traceAnchorId, link?.movementIndex);
    assignFromNode(link?.sourceAnchorId, link?.movementIndex);
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

const buildBottomUpSequence = (root: HierNode, visibleIds: Set<string>): HierNode[] => {
  const visibleNodes = root.descendants().filter((node) => visibleIds.has(getNodeId(node)));
  if (visibleNodes.length <= 1) return visibleNodes;

  const orderByTraversal = new Map<string, number>();
  visibleNodes.forEach((node, index) => orderByTraversal.set(getNodeId(node), index));

  const pendingChildren = new Map<string, number>();
  visibleNodes.forEach((node) => {
    const visibleChildCount = (node.children || []).filter((child) => visibleIds.has(getNodeId(child))).length;
    pendingChildren.set(getNodeId(node), visibleChildCount);
  });

  const ready: HierNode[] = visibleNodes.filter((node) => (pendingChildren.get(getNodeId(node)) ?? 0) === 0);
  const sequence: HierNode[] = [];

  const compareReady = (a: HierNode, b: HierNode): number => {
    const priorityDelta = getReadyNodePriority(a) - getReadyNodePriority(b);
    if (priorityDelta !== 0) return priorityDelta;

    const depthDelta = b.depth - a.depth;
    if (depthDelta !== 0) return depthDelta;

    return (orderByTraversal.get(getNodeId(a)) ?? 0) - (orderByTraversal.get(getNodeId(b)) ?? 0);
  };

  while (ready.length > 0) {
    ready.sort(compareReady);
    const current = ready.shift();
    if (!current) break;
    sequence.push(current);

    const parent = current.parent;
    if (!parent || !visibleIds.has(getNodeId(parent))) continue;

    const parentId = getNodeId(parent);
    const nextPending = (pendingChildren.get(parentId) ?? 0) - 1;
    pendingChildren.set(parentId, nextPending);
    if (nextPending === 0) {
      ready.push(parent);
    }
  }

  return sequence;
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
    if (step.operation === 'SpellOut' || isMoveLikeOperation(step.operation)) continue;
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

const createInferredPlaybackSteps = (
  fallbackSequence: HierNode[],
  visibleIds: Set<string>,
  labelResolver: (node: HierNode) => string = resolveNodeLabel
): PlaybackStep[] => {
  const workspace = new Map<string, string>();
  const inferred: PlaybackStep[] = [];

  for (const node of fallbackSequence) {
    const nodeId = getNodeId(node);
    const targetLabel = labelResolver(node);
    const childNodes = (node.children || []).filter((child) => visibleIds.has(getNodeId(child)));
    const sourceLabels = childNodes.map((child) => labelResolver(child)).filter(Boolean);

    if (childNodes.length === 0) {
      const lexicalSurface = resolveLeafSurface(node);
      const lexicalLabel =
        isTraceLike(lexicalSurface) || isNullLike(lexicalSurface)
          ? targetLabel
          : (node.data.word || targetLabel);
      workspace.set(nodeId, targetLabel);
      inferred.push({
        operation: 'LexicalSelect',
        targetNodeId: nodeId,
        targetLabel,
        sourceNodeIds: [],
        sourceLabels: [lexicalLabel],
        recipe: `Select ${lexicalLabel}`,
        workspaceAfter: Array.from(workspace.values())
      });
      continue;
    }

    childNodes.forEach((child) => workspace.delete(getNodeId(child)));
    workspace.set(nodeId, targetLabel);
    inferred.push({
      operation: childNodes.length === 1 ? 'Project' : 'ExternalMerge',
      targetNodeId: nodeId,
      targetLabel,
      sourceNodeIds: childNodes.map((child) => getNodeId(child)),
      sourceLabels,
      recipe: `${sourceLabels.join(' + ')} -> ${targetLabel}`,
      workspaceAfter: Array.from(workspace.values())
    });
  }

  return inferred;
};

const buildStructuralGrowthPlaybackSteps = (
  forest: SyntaxNode[],
  frameIndex: number,
  previousVisibleNodeIds: Set<string>,
  resolvedMovementLinks?: ResolvedMovementEventLink[],
  movementEvents?: MovementEvent[]
): PlaybackStep[] => {
  const growthFrameLinks = resolveGrowthFrameMovementLinks(forest, movementEvents, frameIndex);
  const effectiveMovementLinks = growthFrameLinks.length > 0 ? growthFrameLinks : (resolvedMovementLinks || []);
  const canvas = buildRenderableGrowthCanvasData(forest, effectiveMovementLinks);
  const cloned = cloneSyntaxTree(canvas);
  if (!cloned) return [];
  const hierarchy = d3.hierarchy(cloned);
  applyVizIds(hierarchy);
  const visibleNodes = hierarchy.descendants().filter((node) => !isSyntheticWorkspaceRootNode(node));
  const visibleIds = new Set(visibleNodes.map((node) => getNodeId(node)));
  const traceIndexByNodeId = buildResolvedLinkTraceIndexMap(
    forest,
    growthFrameLinks.length > 0 ? growthFrameLinks : resolvedMovementLinks,
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
    frameIndex === 0 || !previousVisibleNodeIds.has(getNodeId(node))
  );
  const cumulativeVisibleNodeIds = new Set(previousVisibleNodeIds);
  const playbackSteps: PlaybackStep[] = nodesToReveal.flatMap((node) => {
    const nodeId = getNodeId(node);
    cumulativeVisibleNodeIds.add(nodeId);
    const surface = resolveLeafSurface(node);

    const replaySnapshot = buildVisibleSyntaxSnapshotFromHierarchy(hierarchy, cumulativeVisibleNodeIds);
    const workspaceAfter = extractReplayWorkspaceLabels(replaySnapshot);
    const visibleOvertLeafIds = collectOvertLeafNodeIdsInOrder(replaySnapshot);
    const rawTargetLabel = getReplayNodeLabel(node);
    const childNodes = (node.children || []).filter((child) => visibleIds.has(getNodeId(child)));
    const targetLabel = childNodes.length === 0 && !isTraceLike(surface) && !isNullLike(surface)
      ? maybeLowercaseSentenceInitialFunctionSurface({
          surface: rawTargetLabel,
          nodeId,
          parentLabel: String(node.parent?.data?.label || '').trim(),
          tokenIndex: Number(node.data?.tokenIndex),
          visibleOvertLeafIds,
          isWorkspaceForest: String(replaySnapshot?.label || '').trim() === GROWTH_WORKSPACE_ROOT_LABEL
        })
      : rawTargetLabel;
    const sourceNodeIds = childNodes.map((child) => getNodeId(child));
    const sourceLabels = childNodes.length > 0
      ? childNodes.map((child) => getReplayNodeLabel(child)).filter(Boolean)
      : [
          isTraceLike(surface)
            ? targetLabel
            : maybeLowercaseSentenceInitialFunctionSurface({
                surface: String(node.data.word || targetLabel || '').trim(),
                nodeId,
                parentLabel: String(node.parent?.data?.label || '').trim(),
                tokenIndex: Number(node.data?.tokenIndex),
                visibleOvertLeafIds,
                isWorkspaceForest: String(replaySnapshot?.label || '').trim() === GROWTH_WORKSPACE_ROOT_LABEL
              })
        ].filter(Boolean);
    const operation: DerivationStep['operation'] = childNodes.length === 0
      ? 'LexicalSelect'
      : (childNodes.length === 1 ? 'Project' : 'ExternalMerge');

    return [{
      operation,
      sourceFrameIndex: frameIndex,
      visualFrameIndex: frameIndex,
      targetNodeId: nodeId,
      targetLabel,
      sourceNodeIds,
      sourceLabels,
      recipe: buildStructuralReplayFallback(operation, targetLabel, sourceLabels),
      workspaceAfter,
      replayFrameIndex: frameIndex,
      replayCanvasData: replaySnapshot,
      replayLayoutCanvasData: replaySnapshot,
      replayVisibleNodeIds: Array.from(cumulativeVisibleNodeIds),
      replayMovementLinks: effectiveMovementLinks
    }];
  });

  const parentNodeIdByStepTargetId = new Map<string, string>();
  visibleNodes.forEach((node) => {
    const parentId = node.parent ? getNodeId(node.parent) : '';
    if (!parentId) return;
    parentNodeIdByStepTargetId.set(getNodeId(node), parentId);
  });

  for (let index = 0; index < playbackSteps.length - 1; index += 1) {
    const currentStep = playbackSteps[index];
    const nextStep = playbackSteps[index + 1];
    if (currentStep.operation !== 'LexicalSelect') continue;
    if (!isNullLike(currentStep.targetLabel)) continue;
    const parentNodeId = parentNodeIdByStepTargetId.get(currentStep.targetNodeId);
    if (!parentNodeId || nextStep.targetNodeId !== parentNodeId) continue;
    if (nextStep.operation !== 'Project') continue;
    currentStep.replayLayoutCanvasData = nextStep.replayCanvasData || currentStep.replayCanvasData;
  }

  return playbackSteps;
};

const normalizeLabelKey = (label?: string): string => (label || "").trim().toUpperCase();
const isMoveLikeOperation = (operation?: DerivationStep['operation'] | string): boolean =>
  /^(move|internal[\s-]*merge|head[\s-]*move|a[\s-]*move|a(?:bar)?[\s-]*move)$/i.test(String(operation || '').trim());

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
  if (!isMoveLikeOperation(step.operation)) return stepIndex;

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
    if (!isMoveLikeOperation(candidate.operation)) return;

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
      if (isMoveLikeOperation(step.operation)) {
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
  const visibleIds = new Set(visibleNodes.map((node) => getNodeId(node)));
  const fallbackSequence = buildBottomUpSequence(root, visibleIds);
  const inferred = createInferredPlaybackSteps(fallbackSequence, visibleIds, labelResolver);

  if (!derivationSteps || derivationSteps.length === 0) return finalizeReplayStepOrder(inferred);

  const mappedProvidedSteps = mapProvidedStepsToNodes(visibleNodes, derivationSteps);
  const withProvided = inferred.map((step) => {
    const provided = mappedProvidedSteps.get(step.targetNodeId);
    if (!provided) return step;
    return {
      ...step,
      operation: provided.operation || step.operation,
      microOperations: provided.microOperations && provided.microOperations.length > 0
        ? provided.microOperations
        : step.microOperations,
      sourceNodeIds: provided.sourceNodeIds && provided.sourceNodeIds.length > 0 ? provided.sourceNodeIds : step.sourceNodeIds,
      sourceLabels: provided.sourceLabels && provided.sourceLabels.length > 0 ? provided.sourceLabels : step.sourceLabels,
      recipe: provided.recipe || step.recipe,
      workspaceAfter: provided.workspaceAfter && provided.workspaceAfter.length > 0 ? provided.workspaceAfter : step.workspaceAfter,
      spelloutOrder: provided.spelloutOrder && provided.spelloutOrder.length > 0 ? provided.spelloutOrder : step.spelloutOrder,
      featureChecking: provided.featureChecking && provided.featureChecking.length > 0
        ? provided.featureChecking
        : step.featureChecking,
      ledgerBlocks: provided.ledgerBlocks && provided.ledgerBlocks.length > 0
        ? provided.ledgerBlocks
        : step.ledgerBlocks,
      note: provided.note || step.note
    };
  });
  const mappedIds = new Set(withProvided.map((step) => step.targetNodeId));
  const supplementalProvided = derivationSteps
    .filter((step) => step.operation === 'SpellOut' || isMoveLikeOperation(step.operation))
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

const applyPreAbarSentenceInitialCasing = (
  steps: PlaybackStep[],
  sentence: string
): PlaybackStep[] => {
  if (!Array.isArray(steps) || steps.length === 0) return steps;
  const firstSentenceToken = String(tokenizeReplaySentenceSurface(sentence)[0] || '').trim();
  if (!firstSentenceToken) return steps;
  const normalizedFirstSentenceToken = normalizeToken(firstSentenceToken);
  const loweredFirstSentenceToken = firstSentenceToken.charAt(0).toLowerCase() + firstSentenceToken.slice(1);
  if (loweredFirstSentenceToken === firstSentenceToken) return steps;

  const firstAbarMoveStepIndex = steps.findIndex((step) => String(step?.operation || '').trim() === 'AbarMove');
  if (firstAbarMoveStepIndex <= 0) return steps;

  return steps.map((step, index) => {
    if (index >= firstAbarMoveStepIndex) return step;

    const nextTargetLabel = normalizeToken(String(step?.targetLabel || '').trim()) === normalizedFirstSentenceToken
      ? loweredFirstSentenceToken
      : step.targetLabel;
    const nextSourceLabels = Array.isArray(step?.sourceLabels)
      ? step.sourceLabels.map((label) =>
          normalizeToken(String(label || '').trim()) === normalizedFirstSentenceToken ? loweredFirstSentenceToken : label
        )
      : step.sourceLabels;
    const labelsChanged =
      nextTargetLabel !== step.targetLabel
      || JSON.stringify(nextSourceLabels || []) !== JSON.stringify(step.sourceLabels || []);
    if (!labelsChanged) return step;

    const nextRecipe = buildStructuralReplayFallback(step.operation, nextTargetLabel, nextSourceLabels || []);
    return {
      ...step,
      targetLabel: nextTargetLabel,
      sourceLabels: nextSourceLabels,
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
  link: ResolvedMovementEventLink,
  nodeStepIndex: Map<string, number>,
  lastStep: number
): number | undefined => {
  const sourceNodeId = String(link.sourceAnchorId || '').trim();
  const targetNodeId = String(link.movedAnchorId || '').trim();
  const traceNodeId = String(link.traceAnchorId || '').trim();
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

const buildDisplayMovementLinks = (
  resolvedMovementLinks: ResolvedMovementEventLink[] | undefined
): ResolvedMovementEventLink[] => {
  if (!resolvedMovementLinks || resolvedMovementLinks.length <= 1) return resolvedMovementLinks || [];

  const normalizedLinks = resolvedMovementLinks.map((link) => ({
    ...link,
    sourceAnchorId: String(link?.sourceAnchorId || '').trim(),
    movedAnchorId: String(link?.movedAnchorId || '').trim(),
    traceAnchorId: String(link?.traceAnchorId || '').trim() || undefined
  }));

  const buckets = new Map<string, Array<{ link: ResolvedMovementEventLink; originalIndex: number }>>();
  normalizedLinks.forEach((link, originalIndex) => {
    const normalizedOperation = normalizeMovementOperationLabel(link.operation);
    if (normalizedOperation === 'headmove') return;
    if (!link.movedAnchorId || !link.sourceAnchorId) return;
    const bucketKey = `${normalizedOperation}|${link.movedAnchorId}`;
    const bucket = buckets.get(bucketKey) || [];
    bucket.push({ link, originalIndex });
    buckets.set(bucketKey, bucket);
  });

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
      if (index >= ordered.length - 1) return;
      const next = ordered[index + 1];
      const nextHopTargetId = String(next.link.traceAnchorId || next.link.sourceAnchorId || '').trim();
      if (!nextHopTargetId || nextHopTargetId === entry.link.sourceAnchorId) return;
      displayLinks[entry.originalIndex] = {
        ...displayLinks[entry.originalIndex],
        movedAnchorId: nextHopTargetId
      };
    });
  });

  return displayLinks;
};

const buildMovementArrowsFromLinks = (
  visibleNodes: HierNode[],
  resolvedMovementLinks: ResolvedMovementEventLink[] | undefined,
  nodeStepIndex: Map<string, number>,
  playbackSteps: PlaybackStep[]
): MovementArrow[] => {
  if (!resolvedMovementLinks || resolvedMovementLinks.length === 0) return [];

  const nodeById = new Map(visibleNodes.map((node) => [getNodeId(node), node]));
  const displayLinks = buildDisplayMovementLinks(resolvedMovementLinks);
  const arrows: MovementArrow[] = [];
  const seen = new Set<string>();
  const lastStep = playbackSteps.length > 0 ? playbackSteps.length - 1 : 0;

  displayLinks.forEach((link) => {
    const source = nodeById.get(String(link.sourceAnchorId || '').trim());
    const target = nodeById.get(String(link.movedAnchorId || '').trim());
    const traceNode = link.traceAnchorId
      ? nodeById.get(String(link.traceAnchorId).trim()) || undefined
      : undefined;
    if (!source || !target) return;
    const sourceId = getNodeId(source);
    const targetId = getNodeId(target);
    if (sourceId === targetId) return;

    const key = `${sourceId}->${targetId}`;
    if (seen.has(key)) return;
    seen.add(key);

    const step = resolveMovementStepForLink(
      {
        ...link,
        sourceAnchorId: sourceId,
        movedAnchorId: targetId,
        traceAnchorId: traceNode ? getNodeId(traceNode) : undefined
      },
      nodeStepIndex,
      lastStep
    );
    if (step === undefined) return;
    const index = String(link.movementIndex || '').trim().toLowerCase() || null;

    arrows.push({
      source,
      target,
      traceNode: traceNode || undefined,
      step,
      index
    });
  });

  return arrows;
};

const formatOperationLabel = (operation?: DerivationStep['operation']): string => {
  if (!operation) return 'Derivation';
  if (operation === 'Other') return 'Derivation';
  if (operation === 'LexicalSelect') return 'Select';
  if (operation === 'AbarMove') return 'A-bar Move';
  return operation.replace(/([a-z])([A-Z])/g, '$1 $2');
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
  v: 'V',
  vp: 'VP',
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

const formatReplayIdentifierWord = (value?: string): string => {
  const { core, suffix } = splitReplayPrimeSuffix(value);
  const trimmed = core;
  if (!trimmed) return suffix;
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
  return toReplayTitleCase(trimmed.replace(/[_-]+/g, ' ').toLowerCase());
};

const formatReplayBlockLine = (title: string, line: string): string => {
  const trimmed = String(line || '').trim();
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

const formatReplaySupportValue = (value?: string): string =>
  replaceReplayIdentifiersInText(
    String(value || '')
      .replace(/[_]+/g, ' ')
      .trim()
  );

const formatReplayInputsValue = (labels?: string[]): string =>
  (Array.isArray(labels) ? labels : [])
    .map((label) => formatReplaySupportValue(label))
    .filter(Boolean)
    .join(' + ');

const inferReplayLandingValue = (step: PlaybackStep | null): string => {
  if (!step) return '';
  const moveText = String(step.recipe || step.note || '').trim();
  const landingMatch = moveText.match(/\b(?:to|into)\s+([^.;]+)$/i);
  if (landingMatch?.[1]) {
    return formatReplaySupportValue(landingMatch[1]);
  }
  return formatReplaySupportValue(step.targetLabel);
};

const inferReplaySourceValue = (step: PlaybackStep | null, landingValue: string): string => {
  if (!step) return '';
  const operation = String(step.operation || '').trim();
  const signalText = [
    step.chainId,
    step.recipe,
    step.note,
    ...(Array.isArray(step.sourceNodeIds) ? step.sourceNodeIds : []),
    ...(Array.isArray(step.sourceLabels) ? step.sourceLabels : [])
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (operation === 'AbarMove' || /\b(?:chain_wh|wh-phrase|wh\b|obj|object)\b/i.test(signalText)) {
    return 'object position';
  }
  if (operation === 'AMove' || operation === 'A-Move' || /\b(?:chain_subj|subj|subject)\b/i.test(signalText)) {
    return 'subject position';
  }
  if (operation === 'HeadMove') {
    if (/^(?:c|c'|c′)$/i.test(landingValue)) return 'Infl';
    if (/^(?:infl|infl'|infl′|t|t'|t′)$/i.test(landingValue)) return 'V';
  }

  const usefulSource = (Array.isArray(step.sourceLabels) ? step.sourceLabels : [])
    .map((label) => formatReplaySupportValue(label))
    .find((label) => label && !/^(?:CP|TP|InflP|VP|DP|NP|Workspace)$/i.test(label));

  return usefulSource || 'base position';
};

const buildReplaySupportLines = (
  step: PlaybackStep | null,
  spelloutDisplay: string,
  sentence?: string
): ReplaySupportLine[] => {
  if (!step) return [];

  const operation = String(step.operation || '').trim();
  const inputValue = formatReplayInputsValue(step.sourceLabels);
  const resultValue = formatReplaySupportValue(step.targetLabel);

  if (operation === 'LexicalSelect') {
    return inputValue ? [{ label: 'Result', value: inputValue }] : [];
  }

  if (operation === 'Project') {
    const lines: ReplaySupportLine[] = [];
    if (inputValue) lines.push({ label: 'Input', value: inputValue });
    if (resultValue) lines.push({ label: 'Result', value: resultValue });
    return lines;
  }

  if (operation === 'ExternalMerge') {
    const lines: ReplaySupportLine[] = [];
    if (inputValue) lines.push({ label: step.sourceLabels.length > 1 ? 'Inputs' : 'Input', value: inputValue });
    if (resultValue) lines.push({ label: 'Result', value: resultValue });
    return lines;
  }

  if (isMoveLikeOperation(step.operation)) {
    const landingValue = inferReplayLandingValue(step);
    const sourceValue = inferReplaySourceValue(step, landingValue);
    const lines: ReplaySupportLine[] = [];
    if (sourceValue) lines.push({ label: 'Source', value: sourceValue });
    if (landingValue) lines.push({ label: 'Landing', value: landingValue });
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
  if (/\bby\s+infl\b/i.test(line) || /\bby\s+t\b/i.test(line)) {
    return findReplayDisplayStepIndex(
      steps,
      sourceIndex,
      (step) =>
        stepTargetsAnyLabel(step, ['Infl', "Infl'", 'InflP', 'T', "T'", 'TP']) &&
        !isMoveLikeOperation(step.operation)
    );
  }
  if (/\bby\s+v\b/i.test(line)) {
    return findReplayDisplayStepIndex(
      steps,
      sourceIndex,
      (step) =>
        stepTargetsAnyLabel(step, ['V', "V'", 'VP', 'v', "v'", 'vP']) &&
        !isMoveLikeOperation(step.operation)
    );
  }
  return sourceIndex;
};

const findReplaySelectionDisplayStepIndex = (
  steps: PlaybackStep[],
  sourceIndex: number,
  line: string
): number => {
  if (/^\s*v\b/i.test(line)) {
    return findReplayDisplayStepIndex(
      steps,
      sourceIndex,
      (step) =>
        stepTargetsAnyLabel(step, ['V', "V'", 'VP', 'v', "v'", 'vP']) &&
        !isMoveLikeOperation(step.operation)
    );
  }
  if (/^\s*infl\b/i.test(line) || /^\s*t\b/i.test(line)) {
    return findReplayDisplayStepIndex(
      steps,
      sourceIndex,
      (step) =>
        stepTargetsAnyLabel(step, ['Infl', "Infl'", 'InflP', 'T', "T'", 'TP']) &&
        !isMoveLikeOperation(step.operation)
    );
  }
  if (/^\s*c\b/i.test(line)) {
    return findReplayDisplayStepIndex(
      steps,
      sourceIndex,
      (step) =>
        stepTargetsAnyLabel(step, ['C', "C'", 'CP', 'Foc', "Foc'", 'FocP']) &&
        !isMoveLikeOperation(step.operation)
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
            !isMoveLikeOperation(candidate.operation)
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
          (candidate) => isMoveLikeOperation(candidate.operation)
        );
        lines.forEach((line) => pushBlockLine(targetIndex, title, line));
        return;
      }

      if (normalizedTitle === 'LOCALITY') {
        const targetIndex = findReplayDisplayStepIndex(
          steps,
          sourceIndex,
          (candidate) =>
            String(candidate.operation || '').trim() === 'AbarMove' ||
            String(candidate.operation || '').trim() === 'AMove' ||
            isMoveLikeOperation(candidate.operation)
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

const MOVEMENT_TEXT_RE = /\b(move(?:ment|d|s|ing)?|internal\s*merge|head\s*move|raising|raised|trace|copy|a-?bar|a-?move|wh-?move|front(?:ing|ed)?|displac(?:e|ed|ement|ing)|spec(?:ifier)?[, ]*(?:cp|tp|inflp|ip)|epp)\b/i;

const mentionsMovement = (text?: string): boolean => MOVEMENT_TEXT_RE.test(String(text || '').trim());

const buildReplayMovementStepMap = (
  arrows: MovementArrow[] | undefined
): Map<number, MovementArrow[]> => {
  const byStep = new Map<number, MovementArrow[]>();
  if (!arrows || arrows.length === 0) return byStep;

  arrows.forEach((arrow) => {
    const bucket = byStep.get(arrow.step) || [];
    bucket.push(arrow);
    byStep.set(arrow.step, bucket);
  });

  return byStep;
};

const sanitizeStepForReplay = (
  step: PlaybackStep | null,
  movementArrowsAtStep: MovementArrow[]
): PlaybackStep | null => {
  if (!step) return null;
  const hasMovementEvent = movementArrowsAtStep.length > 0;
  if (hasMovementEvent) {
    const stepAlreadyMentionsMovement =
      isMoveLikeOperation(step.operation) ||
      mentionsMovement(step.recipe) ||
      mentionsMovement(step.note) ||
      (step.featureChecking || []).some((entry) => {
        const coreText = formatFeatureCheckingEntry(entry);
        return mentionsMovement(coreText) || mentionsMovement(entry.note);
      });
    const movementIndices = movementArrowsAtStep
      .map((arrow) => String(arrow.index || '').trim())
      .filter((value) => value.length > 0);
    const movementSuffix = movementIndices.length > 0
      ? `Movement event active (${movementIndices.join(', ')}).`
      : 'Movement event active.';
    const multiMovementSuffix = movementIndices.length > 1
      ? `Movement events on this step (${movementIndices.join(', ')}).`
      : movementSuffix;

    if (stepAlreadyMentionsMovement) {
      if (movementIndices.length <= 1) return step;
      const existingNote = String(step.note || '').trim();
      if (/movement events?\s+on this step/i.test(existingNote)) return step;
      return {
        ...step,
        note: existingNote ? `${existingNote} ${multiMovementSuffix}` : multiMovementSuffix
      };
    }

    return {
      ...step,
      note: step.note ? `${step.note} ${movementSuffix}` : movementSuffix
    };
  }

  const moveLikeOp = isMoveLikeOperation(step.operation);
  const recipeMentionsMovement = mentionsMovement(step.recipe);
  const noteMentionsMovement = mentionsMovement(step.note);
  const filteredFeatureChecking = (step.featureChecking || []).filter((entry) => {
    const coreText = formatFeatureCheckingEntry(entry);
    return !mentionsMovement(coreText) && !mentionsMovement(entry.note);
  });

  return {
    ...step,
    operation: moveLikeOp ? 'Other' : step.operation,
    recipe: moveLikeOp || recipeMentionsMovement ? undefined : step.recipe,
    featureChecking: filteredFeatureChecking.length > 0 ? filteredFeatureChecking : undefined,
    note: noteMentionsMovement ? undefined : step.note
  };
};

const getTerminalWords = (node: SyntaxNode): string[] => {
  if (!node.children || node.children.length === 0) {
    return node.word ? [node.word] : [node.label];
  }
  return node.children.flatMap(getTerminalWords);
};

const buildMovementProtectedNodeIds = (
  resolvedMovementLinks?: ResolvedMovementEventLink[]
): Set<string> => {
  const protectedIds = new Set<string>();
  (resolvedMovementLinks || []).forEach((link) => {
    const sourceId = String(link.sourceAnchorId || '').trim();
    const movedId = String(link.movedAnchorId || '').trim();
    const traceId = String(link.traceAnchorId || '').trim();
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

const shouldMaterializeExplicitNullLeaf = (label?: string, word?: string): boolean => {
  const trimmedWord = typeof word === 'string' ? word.trim() : '';
  if (trimmedWord) return false;
  const trimmedLabel = String(label || '').trim();
  if (isTraceLike(trimmedLabel)) return false;
  const normalizedCategory = String(label || '').replace(/['\s]/g, '').toUpperCase();
  return (
    NULLABLE_HEAD_CATEGORIES.has(normalizedCategory) ||
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
    if (shouldMaterializeExplicitNullLeaf(current.label, word)) {
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

    if (shouldMaterializeExplicitNullLeaf(current.label, word)) {
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
  growthFrames,
  movementEvents,
  resolvedMovementLinks,
  movementMaps,
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
  const movementLinksSignature = useMemo(() => {
    const links = resolvedMovementLinks || [];
    return links
      .map((link, idx) => [
        idx,
        link.movementIndex || '',
        link.sourceAnchorId || '',
        link.movedAnchorId || '',
        link.traceAnchorId || '',
        link.stepIndex ?? ''
      ].join(':'))
      .join('|');
  }, [resolvedMovementLinks]);
  const growthFramesSignature = useMemo(() => {
    const frames = growthFrames || [];
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
      workspaceForest: frame.workspaceForest || []
    })).join('|');
  }, [growthFrames]);
  const usesGrowthFrames = animated && Array.isArray(growthFrames) && growthFrames.length > 0;
  const movementProtectedNodeIds = useMemo(
    () => buildMovementProtectedNodeIds(resolvedMovementLinks),
    [resolvedMovementLinks]
  );
  const movementTraceIndexByNodeId = useMemo(() => {
    return new Map((movementMaps || EMPTY_MOVEMENT_INDEX_MAPS).traceByNodeId);
  }, [movementMaps]);
  const committedGrowthFrameIndex = usesGrowthFrames && Array.isArray(growthFrames) && growthFrames.length > 0
    ? growthFrames.length - 1
    : -1;
  const committedGrowthFrame = usesGrowthFrames && growthFrames && committedGrowthFrameIndex >= 0
    ? growthFrames[committedGrowthFrameIndex] || null
    : null;
  const committedGrowthResolvedLinks = useMemo(() => {
    if (!usesGrowthFrames || !committedGrowthFrame || committedGrowthFrameIndex < 0) return [];
    return resolveGrowthFrameMovementLinks(
      committedGrowthFrame.workspaceForest || [],
      movementEvents,
      committedGrowthFrameIndex
    );
  }, [committedGrowthFrame, committedGrowthFrameIndex, movementEvents, usesGrowthFrames]);
  const preferredCommittedGrowthLinks = useMemo(() => {
    if (Array.isArray(resolvedMovementLinks) && resolvedMovementLinks.length > 0) {
      return resolvedMovementLinks;
    }
    return committedGrowthResolvedLinks;
  }, [committedGrowthResolvedLinks, resolvedMovementLinks]);
  const committedGrowthCanvasData = useMemo(() => {
    if (!usesGrowthFrames) return null;
    if (!committedGrowthFrame) {
      return {
        label: GROWTH_WORKSPACE_ROOT_LABEL,
        children: []
      } as SyntaxNode;
    }
    return buildRenderableGrowthCanvasData(
      committedGrowthFrame.workspaceForest || [],
      preferredCommittedGrowthLinks
    );
  }, [committedGrowthFrame, preferredCommittedGrowthLinks, usesGrowthFrames]);
  const committedCanonicalGrowthCanvasData = useMemo(() => {
    if (!usesGrowthFrames) return null;
    return buildRenderableCommittedCanvasData(
      data,
      preferredCommittedGrowthLinks
    );
  }, [data, preferredCommittedGrowthLinks, usesGrowthFrames]);
  const playbackSteps = useMemo(() => {
    if (!animated) return [];
    const playbackRootData = usesGrowthFrames
      ? committedCanonicalGrowthCanvasData || committedGrowthCanvasData
      : data;
    const clonedData = cloneSyntaxTree(playbackRootData);
    if (!clonedData) return [];
    const hierarchy = d3.hierarchy(clonedData);
    applyVizIds(hierarchy);
    if (abstractionMode) {
      markTriangulatedNodes(hierarchy, movementProtectedNodeIds);
    }
    const visibleNodes = hierarchy.descendants().filter((node) => !isUnderTriangulation(node));
    if (!usesGrowthFrames || !committedGrowthFrame) {
      return buildPlaybackSteps(hierarchy, visibleNodes, derivationSteps);
    }

    const workspaceForest = committedGrowthFrame.workspaceForest || [];
    const traceIndexByNodeId = buildResolvedLinkTraceIndexMap(
      workspaceForest,
      preferredCommittedGrowthLinks,
      Number.MAX_SAFE_INTEGER
    );
    const rawTraceAliasByIndex = buildResolvedLinkRawTraceAliasMap(
      workspaceForest,
      preferredCommittedGrowthLinks,
      Number.MAX_SAFE_INTEGER
    );
    const replayLabelResolver = (node: HierNode): string => {
      const surface = resolveLeafSurface(node);
      if (!isTraceLike(surface)) return resolveNodeLabel(node);
      const inheritedTraceIndex = resolveTraceIndexFromNodeContext(node, traceIndexByNodeId, movementTraceIndexByNodeId);
      const rawTraceAlias = extractMovementIndex(surface);
      const aliasedTraceIndex = rawTraceAlias
        ? rawTraceAliasByIndex.get(String(rawTraceAlias).trim().toLowerCase())
        : undefined;
      return formatTraceSurfaceForDisplayValue(
        surface,
        inheritedTraceIndex || aliasedTraceIndex || extractMovementIndex(surface)
      );
    };
    const steps = buildPlaybackStepsFromGrowthFrames(
      growthFrames || [],
      derivationSteps,
      preferredCommittedGrowthLinks,
      movementEvents
    );
    return applyPreAbarSentenceInitialCasing(
      decoratePlaybackStepsWithTraceIndices(steps, traceIndexByNodeId),
      sentence
    );
  }, [
    animated,
    data,
    derivationSteps,
    usesGrowthFrames,
    growthFrames,
    growthFramesSignature,
    committedCanonicalGrowthCanvasData,
    committedGrowthCanvasData,
    committedGrowthFrame,
    movementEvents,
    movementTraceIndexByNodeId,
    preferredCommittedGrowthLinks,
    resolvedMovementLinks,
    abstractionMode,
    movementProtectedNodeIds,
    sentence
  ]);
  const firstAbarMoveStepIndex = useMemo(
    () => playbackSteps.findIndex((step) => String(step?.operation || '').trim() === 'AbarMove'),
    [playbackSteps]
  );
  const firstSentenceReplayToken = useMemo(
    () => String(tokenizeReplaySentenceSurface(sentence)[0] || '').trim(),
    [sentence]
  );
  const currentStepIndex = animated && playbackSteps.length > 0
    ? Math.min(activeStepIndex, playbackSteps.length - 1)
    : -1;
  const activeGrowthReplayStep = usesGrowthFrames && currentStepIndex >= 0
    ? playbackSteps[currentStepIndex]
    : null;
  const activeGrowthFrameIndex = usesGrowthFrames
    ? (
        Number.isInteger(activeGrowthReplayStep?.replayFrameIndex)
          ? Number(activeGrowthReplayStep?.replayFrameIndex)
          : committedGrowthFrameIndex
      )
    : -1;
  const activeGrowthFrame = usesGrowthFrames && Array.isArray(growthFrames) && activeGrowthFrameIndex >= 0
    ? growthFrames[activeGrowthFrameIndex] || null
    : null;
  const activeGrowthMovementLinks = usesGrowthFrames
    ? (
        Array.isArray(activeGrowthReplayStep?.replayMovementLinks)
          ? activeGrowthReplayStep.replayMovementLinks
          : preferredCommittedGrowthLinks
      )
    : [];
  const isFinalGrowthReplayStep = usesGrowthFrames
    && activeStepIndex >= playbackSteps.length - 1;
  const replayMovementArrows = useMemo(() => {
    if (!animated || playbackSteps.length === 0) return [];
    if (usesGrowthFrames) return [];
    const clonedData = cloneSyntaxTree(data);
    if (!clonedData) return [];
    const hierarchy = d3.hierarchy(clonedData);
    applyVizIds(hierarchy);
    if (abstractionMode) {
      markTriangulatedNodes(hierarchy, movementProtectedNodeIds);
    }
    const visibleNodes = hierarchy.descendants().filter((node) => !isUnderTriangulation(node));
    const nodeStepIndex = buildNodeStepIndex(playbackSteps);
    return buildMovementArrowsFromLinks(visibleNodes, resolvedMovementLinks, nodeStepIndex, playbackSteps);
  }, [animated, abstractionMode, data, playbackSteps, resolvedMovementLinks, movementProtectedNodeIds, usesGrowthFrames]);
  const replayMovementStepMap = useMemo(() => {
    if (!animated || replayMovementArrows.length === 0) return new Map<number, MovementArrow[]>();
    return buildReplayMovementStepMap(replayMovementArrows);
  }, [animated, replayMovementArrows]);
  const overtSurfaceSet = useMemo(() => {
    const tokens = String(sentence || '')
      .split(/\s+/)
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

    return () => {
      delete target.__BABEL_DEV_SET_REPLAY_STEP__;
      delete target.__BABEL_DEV_GET_REPLAY_STEP_COUNT__;
    };
  }, [playbackSteps.length]);

  const canvasData = useMemo(() => {
    if (usesGrowthFrames) {
      return activeGrowthReplayStep?.replayLayoutCanvasData
        || activeGrowthReplayStep?.replayCanvasData
        || committedCanonicalGrowthCanvasData
        || committedGrowthCanvasData
        || data;
    }
    if (animated) return data;
    return materializeCanopyPreterminals(
      materializeTraceShellsFromMovementLinks(data, resolvedMovementLinks)
    );
  }, [
    activeGrowthReplayStep,
    animated,
    committedCanonicalGrowthCanvasData,
    committedGrowthCanvasData,
    data,
    resolvedMovementLinks,
    usesGrowthFrames
  ]);
  const replayVisibleNodeIdSet = useMemo(() => {
    if (!usesGrowthFrames) return null;
    const nodeIds = activeGrowthReplayStep?.replayVisibleNodeIds;
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) return null;
    return new Set(nodeIds.map((id) => String(id || '').trim()).filter(Boolean));
  }, [activeGrowthReplayStep, usesGrowthFrames]);

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
  }, [animated, playbackSteps, data, growthFramesSignature]);

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
    const effectiveRevealThreshold = usesGrowthFrames
      ? Number.MAX_SAFE_INTEGER
      : revealThreshold;
    const svg = d3.select(svgRef.current);
    const layoutGrowthTraceIndexByNodeId = usesGrowthFrames && activeGrowthFrame
      ? buildResolvedLinkTraceIndexMap(
          activeGrowthFrame.workspaceForest || [],
          activeGrowthMovementLinks,
          activeGrowthFrameIndex
        )
      : new Map<string, string>();
    const layoutRawTraceAliasByIndex = usesGrowthFrames && activeGrowthFrame
      ? buildResolvedLinkRawTraceAliasMap(
          activeGrowthFrame.workspaceForest || [],
          activeGrowthMovementLinks,
          activeGrowthFrameIndex
        )
      : new Map<string, string>();

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

    svg.selectAll<SVGTextElement, unknown>('.terminal-label')
      .text(function () {
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
        const directTraceIndex =
          layoutGrowthTraceIndexByNodeId.get(nodeId)
          || movementTraceIndexByNodeId.get(nodeId);
        if (!morph) {
          return isTraceLike(fallback)
            ? formatTraceSurfaceForDisplayValue(
                fallback,
                storedTraceIndex || directTraceIndex || aliasedTraceIndex || extractMovementIndex(fallback)
              )
            : fallback;
        }
        if (effectiveRevealThreshold < morph.step) {
          return morph.hideBefore ? '' : morph.preText;
        }
        if (!morph.postText && isTraceLike(fallback)) {
          return formatTraceSurfaceForDisplayValue(
            fallback,
            storedTraceIndex || directTraceIndex || aliasedTraceIndex || extractMovementIndex(fallback)
          );
        }
        if (morph.postText && isTraceLike(morph.postText)) {
          return formatTraceSurfaceForDisplayValue(
            morph.postText,
            storedTraceIndex || directTraceIndex || aliasedTraceIndex || extractMovementIndex(morph.postText)
          );
        }
        if (isTraceLike(fallback)) {
          return formatTraceSurfaceForDisplayValue(
            fallback,
            storedTraceIndex || directTraceIndex || aliasedTraceIndex || extractMovementIndex(fallback)
          );
        }
        return morph.postText || fallback;
      });
  }, [
    activeGrowthFrame,
    activeGrowthFrameIndex,
    activeGrowthMovementLinks,
    activeStepIndex,
    animated,
    data,
    dimensions,
    abstractionMode,
    usesGrowthFrames,
    playbackSteps.length,
    movementTraceIndexByNodeId
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
    
    // COLOR PALETTE - ABSOLUTE CONSTANTS
    const BRANCH_COLOR = '#593a0e';
    const PURE_WHITE = '#ffffff';
    const TARGET_EMERALD = '#10b981';

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
    const inferredTimeline = usesGrowthFrames
      ? []
      : buildPlaybackSteps(rootHierarchy, visibleNodes, derivationSteps);
    const timeline = animated && playbackSteps.length > 0 ? playbackSteps : inferredTimeline;
    const nodeStepIndex = buildNodeStepIndex(timeline);
    const firstRevealNodeStepIndex = buildFirstRevealNodeStepIndex(timeline);
    const revealThreshold = animated ? activeStepIndex : Number.MAX_SAFE_INTEGER;
    const growthTraceIndexByNodeId = usesGrowthFrames && activeGrowthFrame
      ? (() => {
          const workspaceForest = activeGrowthFrame.workspaceForest || [];
          return buildResolvedLinkTraceIndexMap(
            workspaceForest,
            activeGrowthMovementLinks,
            activeGrowthFrameIndex
          );
        })()
      : new Map<string, string>();
    const growthRawTraceAliasByIndex = usesGrowthFrames && activeGrowthFrame
      ? (() => {
          const workspaceForest = activeGrowthFrame.workspaceForest || [];
          return buildResolvedLinkRawTraceAliasMap(
            workspaceForest,
            activeGrowthMovementLinks,
            activeGrowthFrameIndex
          );
        })()
      : new Map<string, string>();
    const movementArrows = animated
        ? (
          usesGrowthFrames
            ? buildMovementArrowsFromLinks(
                visibleNodes,
                activeGrowthMovementLinks,
                nodeStepIndex,
                timeline
              )
            : buildMovementArrowsFromLinks(visibleNodes, resolvedMovementLinks, nodeStepIndex, timeline)
        )
      : [];
    const effectiveRevealThreshold = usesGrowthFrames
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

    const unrevealedStep = usesGrowthFrames ? Number.MAX_SAFE_INTEGER : 0;
    const getRevealStepForNodeId = (nodeId: string): number =>
      nodeRevealStepIndex.has(nodeId)
        ? (nodeRevealStepIndex.get(nodeId) as number)
        : unrevealedStep;

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
        const movementIndex = arrow.index
          || (traceRawAlias ? growthRawTraceAliasByIndex.get(String(traceRawAlias).trim().toLowerCase()) : undefined)
          || (targetRawAlias ? growthRawTraceAliasByIndex.get(String(targetRawAlias).trim().toLowerCase()) : undefined)
          || traceRawAlias
          || targetRawAlias
          || null;
        const formattedTraceSurface = isTraceLike(traceSurface)
          ? formatTraceSurfaceForDisplay(traceSurface, movementIndex)
          : buildTraceLabel(movementIndex);
        terminalMorph.set(traceId, {
          preText: formattedTraceSurface,
          postText: formattedTraceSurface,
          step: arrow.step,
          hideBefore: false
        });
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
                    ? growthRawTraceAliasByIndex.get(String(rawAlias).trim().toLowerCase())
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
    const getReplayTerminalSurface = (node: HierNode): string => {
      const fallback = resolveLeafSurface(node);
      if (isTraceLike(fallback) || isNullLike(fallback)) return fallback;
      if (!usesGrowthFrames || !animated || isFinalGrowthReplayStep) return fallback;
      const currentPlaybackStep = currentStepIndex >= 0 ? playbackSteps[currentStepIndex] : null;
      if (
        currentPlaybackStep?.operation === 'LexicalSelect' &&
        String(currentPlaybackStep.targetNodeId || '').trim() === getNodeId(node)
      ) {
        const explicitLexicalSurface = String(currentPlaybackStep.sourceLabels?.[0] || '').trim();
        if (explicitLexicalSurface) {
          const shouldForcePreAbarLowercase =
            Number(node.data?.tokenIndex) === 0
            && firstAbarMoveStepIndex > 0
            && currentStepIndex < firstAbarMoveStepIndex;
          return shouldForcePreAbarLowercase
            ? explicitLexicalSurface.charAt(0).toLowerCase() + explicitLexicalSurface.slice(1)
            : explicitLexicalSurface;
        }
      }
      const fallbackParentLabel = activeGrowthFrame
        ? findParentLabelInForest(activeGrowthFrame.workspaceForest || [], getNodeId(node))
        : '';
      const committedParentLabel = findParentLabelInForest([data], getNodeId(node));
      const preAbarSentenceInitialFunction =
        normalizeToken(fallback) === normalizeToken(firstSentenceReplayToken)
        && firstAbarMoveStepIndex > 0
        && currentStepIndex < firstAbarMoveStepIndex;
      if (preAbarSentenceInitialFunction) {
        return fallback.charAt(0).toLowerCase() + fallback.slice(1);
      }
      return maybeLowercaseSentenceInitialFunctionSurface({
        surface: fallback,
        nodeId: getNodeId(node),
        parentLabel: String(node.parent?.data?.label || '').trim() || fallbackParentLabel || committedParentLabel,
        tokenIndex: Number(node.data?.tokenIndex),
        visibleOvertLeafIds,
        isWorkspaceForest: String(clonedCanvasData?.label || '').trim() === GROWTH_WORKSPACE_ROOT_LABEL
      });
    };
    const abstractLeaves = leafNodes.filter((d) => {
      const nodeId = getNodeId(d);
      const surface = resolveLeafSurface(d);
      return !movementTerminalIds.has(nodeId)
        && !isOvertLeafNode(d, overtSurfaceSet)
        && !isTraceLike(surface)
        && !isNullLike(surface);
    });
    const terminals = leafNodes.filter((d) => {
      const nodeId = getNodeId(d);
      const surface = resolveLeafSurface(d);
      const canRenderAsTerminal = !isStructuralCategorySurface(surface)
        || isTraceLike(surface)
        || isNullLike(surface)
        || isOvertLeafNode(d, overtSurfaceSet);
      return (movementTerminalIds.has(nodeId) && canRenderAsTerminal)
        || isOvertLeafNode(d, overtSurfaceSet)
        || isTraceLike(surface)
        || isNullLike(surface);
    });

    abstractLeaves.append('text')
      .attr('y', -10)
      .attr('text-anchor', 'middle')
      .attr('font-size', '42px')
      .attr('font-weight', '900')
      .attr('fill', PURE_WHITE)
      .style('fill', PURE_WHITE, 'important')
      .style('font-family', 'Quicksand, sans-serif')
      .style('paint-order', 'stroke')
      .style('stroke', '#020806')
      .style('stroke-width', '10px')
      .text(d => d.data.label || '');

    // Render leaf node text in Emerald - Reduced Font Size
    terminals.append('text')
      .attr('class', 'terminal-label')
      .attr('data-node-id', (d) => getNodeId(d))
      .attr('data-default-label', (d) => getReplayTerminalSurface(d))
      .attr('data-trace-index', (d) => {
        const fallback = getReplayTerminalSurface(d);
        if (!isTraceLike(fallback)) return '';
        const inheritedTraceIndex = resolveTraceIndexFromNodeContext(
          d,
          growthTraceIndexByNodeId,
          movementTraceIndexByNodeId
        );
        const rawTraceAlias = extractMovementIndex(fallback);
        const aliasedTraceIndex = rawTraceAlias
          ? growthRawTraceAliasByIndex.get(String(rawTraceAlias).trim().toLowerCase())
          : undefined;
        return normalizeTraceIndexForDisplay(
          inheritedTraceIndex || aliasedTraceIndex || extractMovementIndex(fallback)
        );
      })
      .attr('y', 115) // Adjusted vertical offset for smaller font
      .attr('text-anchor', 'middle')
      .attr('font-size', '56px') // Reduced from 84px to be more proportional
      .attr('font-weight', '900')
      .attr('fill', TARGET_EMERALD)
      .attr('style', `fill: ${TARGET_EMERALD} !important; font-family: 'Quicksand', sans-serif; font-style: italic; paint-order: stroke; stroke: #020806; stroke-width: 8px;`)
      .style('fill', TARGET_EMERALD, 'important')
      .text(d => {
        const nodeId = getNodeId(d);
        const fallback = getReplayTerminalSurface(d);
        const morph = terminalMorphRef.current.get(nodeId);
        const inheritedTraceIndex = resolveTraceIndexFromNodeContext(
          d,
          growthTraceIndexByNodeId,
          movementTraceIndexByNodeId
        );
        const rawTraceAlias = extractMovementIndex(fallback);
        const aliasedTraceIndex = rawTraceAlias
          ? growthRawTraceAliasByIndex.get(String(rawTraceAlias).trim().toLowerCase())
          : undefined;
        if (!morph) {
          return isTraceLike(fallback)
            ? formatTraceSurfaceForDisplay(
                fallback,
                inheritedTraceIndex || aliasedTraceIndex || extractMovementIndex(fallback)
              )
            : fallback;
        }
        if (effectiveRevealThreshold < morph.step) {
          return morph.hideBefore ? '' : morph.preText;
        }
        return morph.postText;
      });

    // Vertical dashed connection for leaf nodes
    terminals.append('line')
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
    // Use actual rendered bounds so terminal labels are not clipped/off-canvas.
    const fitToRenderedBounds = () => {
      const rendered = g.node() as SVGGElement | null;
      if (!rendered) return false;

      const bbox = rendered.getBBox();
      if (!Number.isFinite(bbox.width) || !Number.isFinite(bbox.height) || bbox.width <= 0 || bbox.height <= 0) {
        return false;
      }

      const viewportPadLeft = 40;
      const viewportPadRight = 136;
      const viewportPadTop = 34;
      // Reserve space for bottom overlays (input tray / growth controls) so terminals remain visible.
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
    activeGrowthFrame,
    activeGrowthFrameIndex,
    activeGrowthMovementLinks,
    activeStepIndex,
    canvasData,
    dimensions,
    animated,
    abstractionMode,
    derivationStepsSignature,
    growthFramesSignature,
    movementLinksSignature,
    movementProtectedNodeIds,
    replayVisibleNodeIdSet,
    usesGrowthFrames,
    resolvedMovementLinks
  ]);

  const activeStepRaw = currentStepIndex >= 0 ? playbackSteps[currentStepIndex] : null;
  const activeStep = usesGrowthFrames
    ? activeStepRaw
    : sanitizeStepForReplay(
        activeStepRaw,
        currentStepIndex >= 0 ? (replayMovementStepMap.get(currentStepIndex) || []) : []
      );
  const activeRecipeDisplay = String(activeStep?.recipe || '').trim() || `${activeStep?.targetLabel || 'Node'} created`;
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
  const operationLabel = formatOperationLabel(activeStep?.operation);
  const replayDisplayLedgerBlocksByStepIndex = useMemo(
    () => buildReplayDisplayLedgerBlocks(playbackSteps),
    [playbackSteps]
  );
  const activeDisplayLedgerBlocks = replayDisplayLedgerBlocksByStepIndex.get(activeStepIndex) || [];
  const canStepBackward = animated && playbackSteps.length > 0 && activeStepIndex > 0;
  const canStepForward = animated && playbackSteps.length > 0 && activeStepIndex < playbackSteps.length - 1;

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
            Step {activeStepIndex + 1}/{playbackSteps.length}
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
            <div className="ml-auto text-[10px] font-black tracking-[0.14em] text-emerald-400/80">
              {operationLabel}
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
                        <div key={`${block.title}-${lineIndex}`} className="text-[11px] text-white/90 leading-relaxed">
                          {formatReplayBlockLine(block.title, line)}
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
  buildGrowthCanvasData,
  resolveGrowthMovementTransitions
};
