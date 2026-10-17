import { collectReplayCanvasNodes } from './syntaxForest.ts';
/** Normalize the compiled step sequence while preserving visible material and relation ownership. */
import { type ResolvedRelationLink } from '../relationLinks.ts';
import { authoredWord } from '../server/babelParser/nodePronunciation.js';
import { type DerivationOperation, type SyntaxNode } from '../types.ts';
import { isReplayDisplayChild, replayOwnerId } from './displayIdentity.ts';
import {
  isFrontingLikeOperationLabel,
  isMoveLikeOperation,
  isResolvedMovementLink,
  normalizeTrajectoryKind,
  stepRepresentsMovement
} from './movementLinks.ts';
import {
  buildReplayProgressLabel,
  buildStructuralReplayFallback,
  getReplayPlanStage,
  pickPreferredReplayText
} from './playbackFormatting.ts';
import { EXPLICIT_NULL_TERMINAL } from './replayCanvas.ts';
import { mergeReplayDetailBlocks } from './replayPanelFormatting.ts';
import { isNullLike, isStructuralCategorySurface, isTraceLike } from './replaySurfaceNotation.ts';
import {
  collectExactNodesByIdInForest,
  collectReplayContinuitySubtreeSignatures,
  collectSubtreeNodeIds,
  findExactNodeByIdInForest,
  findNodeByIdInForest,
  findParentNodeIdInForest,
  getReplayVisibleNodeIdSet,
  getSyntaxNodeSurface,
  isLexicalLeaf,
  isNotationLeaf,
  normalizeToken,
  resolvedRelationLinkKey
} from './syntaxForest.ts';
import { type DerivationReplayPlan, type PlaybackStep } from './types.ts';

export const hidePendingInflSpecifierWrappersInStep = (step: PlaybackStep): PlaybackStep => {
  const visibleIds = new Set((Array.isArray(step.replayVisibleNodeIds) ? step.replayVisibleNodeIds : [])
    .map((nodeId) => String(nodeId || ''))
    .filter(Boolean));
  const protectedRelationEndpointIds = new Set<string>();
  (Array.isArray(step.replayRelationLinks) ? step.replayRelationLinks : []).forEach((link) => {
    [
      String(link?.sourceNodeId || ''),
      String(link?.targetNodeId || ''),
      String(link?.witnessNodeId || '')
    ].filter(Boolean).forEach((nodeId) => protectedRelationEndpointIds.add(nodeId));
  });
  const canvasRoot = step.replayCanvasData || null;
  if (!canvasRoot || visibleIds.size === 0)
    return step;
  const hiddenIds = new Set<string>();
  const walk = (node: SyntaxNode) => {
    const nodeId = String(node?.id || '');
    const label = String(node?.label || '').trim().toLowerCase();
    const children = Array.isArray(node?.children) ? node.children : [];
    if (nodeId && visibleIds.has(nodeId) && ['infl', 'ip', 't', 'tp'].includes(label)) {
      // A unary authored parent has no pending daughter. Matching its child's
      // label does not make that completed projection future layout metadata.
      if (children.length > 1) {
        const spineChildIndex = children.findIndex((child, index) => index > 0
          && visibleIds.has(String(child?.id || ''))
          && String(child?.label || '').trim().toLowerCase() === label);
        if (spineChildIndex > 0) {
          const hasVisibleSpecifierMaterial = children
            .slice(0, spineChildIndex)
            .some((child) => {
              let found = false;
              const scan = (candidate: SyntaxNode) => {
                if (visibleIds.has(String(candidate?.id || ''))) {
                  found = true;
                  return;
                }
                (candidate.children || []).forEach(scan);
              };
              scan(child);
              return found;
            });
          if (!hasVisibleSpecifierMaterial && !protectedRelationEndpointIds.has(nodeId))
            hiddenIds.add(nodeId);
        }
      }
    }
    children.forEach(walk);
  };
  walk(canvasRoot);
  if (hiddenIds.size === 0)
    return step;
  const markHiddenInflWrappersAsLayoutOnly = (node: SyntaxNode): SyntaxNode | null => {
    const nodeId = String(node?.id || '');
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
    replayVisibleNodeIds: (step.replayVisibleNodeIds || []).filter((nodeId) => !hiddenIds.has(String(nodeId || '')))
  };
};

const deferPendingMovementProjections = (steps: PlaybackStep[], projections: Array<{
  nodeId: string;
  firstStageIndex: number;
  stageIndex: number;
  relationIndex: number;
}>): PlaybackStep[] => {
  if (projections.length === 0)
    return steps;
  const reveals = projections.map(projection => ({
    ...projection,
    moment: steps.findIndex(step => step.replayRelationIdentity?.stageIndex === projection.stageIndex
      && step.replayRelationIdentity.relationIndex === projection.relationIndex)
  })).filter(projection => projection.moment >= 0);
  return steps.flatMap((step, index) => {
    const withheld = new Set(reveals.filter(projection => index < projection.moment
      && Number(step.replayFrameIndex) >= projection.firstStageIndex).map(projection => projection.nodeId));
    if (withheld.size === 0)
      return [step];
    if (step.replayKind === 'micro' && step.operation === 'Project' && withheld.has(step.targetNodeId))
      return [];
    return [{
      ...step,
      replayVisibleNodeIds: step.replayVisibleNodeIds?.filter(id => !withheld.has(id))
    }];
  });
};

const recountReplayProgress = (steps: PlaybackStep[], replayPlan?: DerivationReplayPlan | null): PlaybackStep[] => {
  const counts = new Map<number, number>();
  const positions = new Map<number, number>();
  steps.forEach(step => {
    const index = step.replayFrameIndex;
    if (index !== undefined)
      counts.set(index, (counts.get(index) || 0) + 1);
  });
  return steps.map(step => {
    const index = step.replayFrameIndex;
    const stage = index === undefined ? undefined : getReplayPlanStage(replayPlan, index);
    if (!stage || index === undefined)
      return step;
    const position = (positions.get(index) || 0) + 1;
    positions.set(index, position);
    return {
      ...step,
      replayStageStepIndex: position - 1,
      replayProgressLabel: buildReplayProgressLabel(stage, replayPlan!.stages.length, position, counts.get(index)!)
    };
  });
};

const squashAdjacentStructuralReplayDuplicates = (steps: PlaybackStep[]): PlaybackStep[] => {
  if (steps.length < 2)
    return steps;
  const squashed: PlaybackStep[] = [];
  steps.forEach((step) => {
    const previous = squashed[squashed.length - 1];
    const sameVisualFrame = previous &&
      Number.isInteger(previous.visualFrameIndex) &&
      Number.isInteger(step.visualFrameIndex) &&
      previous.visualFrameIndex === step.visualFrameIndex;
    const sameOperation = previous &&
      String(previous.operation || '').trim() === String(step.operation || '').trim();
    const sameTarget = previous &&
      String(previous.targetNodeId || '') &&
      String(previous.targetNodeId || '') === String(step.targetNodeId || '');
    const structuralOnly = !stepRepresentsMovement(previous) &&
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
        workspaceAfter: (Array.isArray(step.workspaceAfter) && step.workspaceAfter.length > 0)
          ? step.workspaceAfter
          : previous.workspaceAfter,
        sourceNodeIds: (Array.isArray(previous.sourceNodeIds) ? previous.sourceNodeIds : []).length > 0
          ? previous.sourceNodeIds
          : step.sourceNodeIds,
        sourceLabels: (Array.isArray(previous.sourceLabels) ? previous.sourceLabels : []).length > 0
          ? previous.sourceLabels
          : step.sourceLabels,
        detailBlocks: (Array.isArray(step.detailBlocks) && step.detailBlocks.length > 0)
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
  if (!step)
    return '';
  const visibleNodeIds = Array.isArray(step.replayVisibleNodeIds)
    ? step.replayVisibleNodeIds.map((id) => String(id || '')).filter(Boolean).sort()
    : [];
  const relationLinks = (Array.isArray(step.replayRelationLinks) ? step.replayRelationLinks : [])
    .map((link) => ({
      relationIndex: String(link?.relationIndex || '').trim(),
      relation: String(link?.relation || link?.operation || '').trim(),
      sourceNodeId: String(link?.sourceNodeId || ''),
      targetNodeId: String(link?.targetNodeId || ''),
      witnessNodeId: String(link?.witnessNodeId || ''),
      renderFamily: link?.renderFamily || undefined,
      trajectoryKind: normalizeTrajectoryKind(link?.trajectoryKind) || undefined,
      stepIndex: Number.isInteger(link?.stepIndex) ? Number(link.stepIndex) : null,
      operation: String(link?.operation || '').trim(),
      chainId: String(link?.chainId || '')
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify({
    canvasData: step.replayCanvasData || null,
    visibleNodeIds,
    relationLinks
  });
};

const collapseZeroDeltaReplaySteps = (steps: PlaybackStep[]): PlaybackStep[] => {
  if (steps.length < 2)
    return steps;
  const collapsed: PlaybackStep[] = [];
  steps.forEach((step) => {
    const previous = collapsed[collapsed.length - 1];
    const sameVisualState = previous &&
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
      workspaceAfter: (Array.isArray(step.workspaceAfter) && step.workspaceAfter.length > 0)
        ? step.workspaceAfter
        : previous.workspaceAfter,
      detailBlocks: mergeReplayDetailBlocks(previous.detailBlocks, step.detailBlocks)
    };
  });
  return collapsed;
};

export const insertPreMovementLandingMergeSteps = (steps: PlaybackStep[]): PlaybackStep[] => {
  if (steps.length < 2)
    return steps;
  const expanded: PlaybackStep[] = [];
  steps.forEach((step) => {
    const previous = expanded[expanded.length - 1];
    const relationLinks = Array.isArray(step.replayRelationLinks) ? step.replayRelationLinks : [];
    const landingRelation = relationLinks.find((link) => {
      const operation = String(link?.operation || link?.relation || step.operation || '').trim();
      if (!isMoveLikeOperation(operation) || isFrontingLikeOperationLabel(operation))
        return false;
      const targetNodeId = String(link?.targetNodeId || '');
      if (!targetNodeId || !previous?.replayCanvasData)
        return false;
      const previousVisibleIds = getReplayVisibleNodeIdSet(previous);
      if (!previousVisibleIds.has(targetNodeId))
        return false;
      const parentNodeId = findParentNodeIdInForest([previous.replayCanvasData], targetNodeId);
      if (!parentNodeId || previousVisibleIds.has(parentNodeId))
        return false;
      const currentVisibleIds = getReplayVisibleNodeIdSet(step);
      return currentVisibleIds.has(parentNodeId);
    });
    if (previous && landingRelation && previous.replayCanvasData) {
      const targetNodeId = String(landingRelation.targetNodeId || '');
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
  if (!step?.replayCanvasData || !Array.isArray(step.replayVisibleNodeIds))
    return '';
  const visibleIds = new Set(step.replayVisibleNodeIds
    .map((nodeId) => String(nodeId || ''))
    .filter(Boolean));
  const serializeNode = (node?: SyntaxNode | null): any => {
    if (!node || typeof node !== 'object')
      return null;
    const nodeId = String(node.id || '');
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
      sourceNodeId: String(link?.sourceNodeId || ''),
      targetNodeId: String(link?.targetNodeId || ''),
      witnessNodeId: String(link?.witnessNodeId || ''),
      stepIndex: Number.isInteger(link?.stepIndex) ? Number(link.stepIndex) : null
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify({
    tree: serializeNode(step.replayCanvasData),
    relationLinks
  });
};

export const collectVisibleReplayOvertTokenCounts = (step?: PlaybackStep | null): Map<string, number> => {
  const counts = new Map<string, number>();
  if (!step?.replayCanvasData || !Array.isArray(step.replayVisibleNodeIds))
    return counts;
  const visibleIds = new Set(step.replayVisibleNodeIds
    .map((nodeId) => String(nodeId || ''))
    .filter(Boolean));
  const countedLeafIds = new Set<string>();
  const nodesByName = new Map<string, SyntaxNode>();
  const index = (node: SyntaxNode) => {
    for (const name of [node.id, ...(Array.isArray(node.aliasIds) ? node.aliasIds : [])]) {
      const key = String(name || '');
      if (!nodesByName.has(key))
        nodesByName.set(key, node);
    }
    (Array.isArray(node.children) ? node.children : []).forEach(index);
  };
  index(step.replayCanvasData);
  const countedSubtrees = new Set<SyntaxNode>();
  const countLeaves = (node: SyntaxNode): boolean => {
    if (countedSubtrees.has(node))
      return true;
    const children = Array.isArray(node.children) ? node.children : [];
    let complete: boolean;
    if (children.length) {
      // Visit every child even when an earlier child contains an unnamed leaf.
      complete = true;
      for (const child of children) {
        if (!countLeaves(child))
          complete = false;
      }
    }
    else {
      const leafId = String(node.id || '');
      complete = Boolean(leafId);
      if ((!leafId || visibleIds.has(leafId)) && (!leafId || !countedLeafIds.has(leafId))) {
        if (leafId)
          countedLeafIds.add(leafId);
        const key = isLexicalLeaf(node) ? normalizeToken(authoredWord(node)) : '';
        if (key)
          counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    // Named leaves are counted once. Preserve the existing multiplicity of
    // unnamed leaves when several visible ancestors expose the same subtree.
    if (complete)
      countedSubtrees.add(node);
    return complete;
  };
  step.replayVisibleNodeIds.forEach((nodeIdValue) => {
    const nodeId = String(nodeIdValue || '');
    if (!nodeId)
      return;
    const node = nodesByName.get(nodeId);
    if (node)
      countLeaves(node);
  });
  return counts;
};

const stepDropsVisibleOvertMaterial = (previousStep: PlaybackStep | undefined, step: PlaybackStep): boolean => {
  if (!previousStep)
    return false;
  const operation = String(step.operation || '').trim();
  if (!operation
    || operation === 'StageRecord') {
    return false;
  }
  const previousCounts = collectVisibleReplayOvertTokenCounts(previousStep);
  if (previousCounts.size === 0)
    return false;
  const currentCounts = collectVisibleReplayOvertTokenCounts(step);
  for (const [token, previousCount] of previousCounts) {
    if ((currentCounts.get(token) || 0) < previousCount)
      return true;
  }
  return false;
};

const stepIntroducesVisibleOvertMaterial = (previousStep: PlaybackStep | undefined, step: PlaybackStep): boolean => {
  const currentCounts = collectVisibleReplayOvertTokenCounts(step);
  if (currentCounts.size === 0)
    return false;
  const previousCounts = collectVisibleReplayOvertTokenCounts(previousStep);
  for (const [token, currentCount] of currentCounts) {
    if (currentCount > (previousCounts.get(token) || 0))
      return true;
  }
  return false;
};

const stepCanIntroduceVisibleOvertMaterial = (previousStep: PlaybackStep | undefined, step: PlaybackStep): boolean => {
  const operation = String(step.operation || '').trim();
  if (operation !== 'LexicalSelect')
    return false;
  const target = String(step.targetLabel || step.recipe || '').trim();
  if (!target
    || isTraceLike(target)
    || isNullLike(target)
    || isStructuralCategorySurface(target)) {
    return false;
  }
  const targetKey = normalizeToken(target);
  if (!targetKey)
    return false;
  const previousCounts = collectVisibleReplayOvertTokenCounts(previousStep);
  const currentCounts = collectVisibleReplayOvertTokenCounts(step);
  let introducedTarget = false;
  for (const [token, currentCount] of currentCounts) {
    const previousCount = previousCounts.get(token) || 0;
    if (currentCount <= previousCount)
      continue;
    if (token !== targetKey)
      return false;
    if (currentCount - previousCount > 1)
      return false;
    introducedTarget = true;
  }
  if (!introducedTarget)
    return false;
  return true;
};

const stepIsRedundantOvertLexicalSelect = (previousStep: PlaybackStep | undefined, step: PlaybackStep): boolean => {
  if (!previousStep || String(step.operation || '').trim() !== 'LexicalSelect')
    return false;
  const targetNodeId = String(step.targetNodeId || '');
  if (!targetNodeId)
    return false;
  return getReplayVisibleNodeIdSet(previousStep).has(targetNodeId);
};

const findCollapsedNullSelectionInProjectStep = (previousStep: PlaybackStep | undefined, step: PlaybackStep): {
  leafId: string;
  leafSurface: string;
} | null => {
  if (String(step.operation || '').trim() !== 'Project')
    return null;
  if (!step.replayCanvasData)
    return null;
  const previousVisibleIds = getReplayVisibleNodeIdSet(previousStep);
  const currentVisibleIds = getReplayVisibleNodeIdSet(step);
  const newlyVisibleIds = Array.from(currentVisibleIds).filter((nodeId) => !previousVisibleIds.has(nodeId));
  if (newlyVisibleIds.length < 2)
    return null;
  const nullLeafIds = newlyVisibleIds.filter((nodeId) => {
    const node = findNodeByIdInForest([step.replayCanvasData as SyntaxNode], nodeId);
    return isNotationLeaf(node);
  });
  if (nullLeafIds.length !== 1)
    return null;
  const leafId = nullLeafIds[0];
  const leafParentId = findParentNodeIdInForest([step.replayCanvasData as SyntaxNode], leafId);
  const targetNodeId = replayOwnerId(step.replayCanvasData, String(step.targetNodeId || ''));
  const leafIsInsideProjectTarget = Boolean(leafParentId && newlyVisibleIds.includes(leafParentId))
    || Boolean(targetNodeId && leafParentId === targetNodeId);
  if (!leafIsInsideProjectTarget)
    return null;
  const leafNode = findNodeByIdInForest([step.replayCanvasData as SyntaxNode], leafId);
  const leafSurface = getSyntaxNodeSurface(leafNode) || EXPLICIT_NULL_TERMINAL;
  return { leafId, leafSurface };
};

const splitCollapsedNullSelectionProjectSteps = (steps: PlaybackStep[]): PlaybackStep[] => {
  if (steps.length < 2)
    return steps;
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
      recipe: buildStructuralReplayFallback('LexicalSelect', collapsedNullSelection.leafSurface, [collapsedNullSelection.leafSurface]),
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
export const isAuthoredRelationReplayMoment = (step: PlaybackStep): boolean => step.replayKind === 'relation'
  && Number.isInteger(step.replayRelationIdentity?.stageIndex)
  && Number.isInteger(step.replayRelationIdentity?.relationIndex);

export const removeInvalidReplayVisibilityTransitions = (steps: PlaybackStep[]): PlaybackStep[] => {
  const kept: PlaybackStep[] = [];
  steps.forEach((step) => {
    const previous = kept[kept.length - 1];
    const operation = String(step.operation || '').trim();
    const isPlannedStructuralMicrostep = Boolean(String(step.replayProgressLabel || '').trim())
      && step.replayKind !== 'macro'
      && ['LexicalSelect', 'Project', 'ExternalMerge'].includes(operation);
    if (stepIsRedundantOvertLexicalSelect(previous, step)) {
      return;
    }
    const addsOvert = stepIntroducesVisibleOvertMaterial(previous, step);
    if (addsOvert
      && operation !== 'StageRecord'
      && !isMoveLikeOperation(operation)
      && !isPlannedStructuralMicrostep
      // An AUTHORED RELATION MOMENT draws marks, not material: its snapshot
      // reflects the frame's own structural state, which can legitimately
      // differ from a mid-assembly neighbor. Only the exact identity-proven
      // moment is exempt — a generic preserved flag alone never authorizes
      // an otherwise-invalid overt-material jump.
      && !isAuthoredRelationReplayMoment(step)
      && !stepCanIntroduceVisibleOvertMaterial(previous, step)) {
      return;
    }
    const dropsOvert = stepDropsVisibleOvertMaterial(previous, step);
    if (dropsOvert && !step.preserveReplayStep && !isPlannedStructuralMicrostep) {
      return;
    }
    const sameVisibleState = previous &&
      !previous.preserveReplayStep &&
      !step.preserveReplayStep &&
      String(previous.operation || '').trim() !== 'StageRecord' &&
      String(step.operation || '').trim() !== 'StageRecord' &&
      buildVisibleReplayStateSignature(previous) === buildVisibleReplayStateSignature(step);
    if (sameVisibleState)
      return;
    kept.push(step);
  });
  return kept;
};

const carryReplayRelationLinksForward = (steps: PlaybackStep[]): PlaybackStep[] => {
  if (steps.length < 2)
    return steps;
  const activeRelationLinks: ResolvedRelationLink[] = [];
  const activeRelationKeys = new Set<string>();
  const normalizedSteps = steps.map((step) => {
    const canvas = step.replayCanvasData;
    const currentRelationLinks = Array.isArray(step.replayRelationLinks) ? step.replayRelationLinks : [];
    currentRelationLinks.forEach((link) => {
      const key = resolvedRelationLinkKey(link);
      if (!key || activeRelationKeys.has(key))
        return;
      activeRelationKeys.add(key);
      activeRelationLinks.push(link);
    });
    if (!canvas)
      return step;
    // Carried links keep their authored endpoint ids. An endpoint absent from
    // this canvas is simply not drawn here; no lineage mate or id-spelling
    // heuristic stands in for it.
    const linksForStep = activeRelationLinks.filter((link) => {
      const sourceNodeId = String(link?.sourceNodeId || '');
      const targetNodeId = String(link?.targetNodeId || '');
      if (isResolvedMovementLink(link) && (sourceNodeId || targetNodeId)) {
        return Boolean(sourceNodeId
          && targetNodeId
          && findNodeByIdInForest([canvas], sourceNodeId)
          && findNodeByIdInForest([canvas], targetNodeId));
      }
      const anchorNodeIds = (Array.isArray(link?.anchors) ? link.anchors : [])
        .map((anchor) => String(anchor?.nodeId || ''))
        .filter(Boolean);
      return anchorNodeIds.length > 0 && anchorNodeIds.every((nodeId) => (Boolean(findNodeByIdInForest([canvas], nodeId))));
    });
    if (linksForStep.length === 0)
      return step;
    const mergedRelationLinks: ResolvedRelationLink[] = [];
    const mergedRelationKeys = new Set<string>();
    linksForStep.forEach((link) => {
      const key = resolvedRelationLinkKey(link);
      if (!key || mergedRelationKeys.has(key))
        return;
      mergedRelationKeys.add(key);
      mergedRelationLinks.push(link);
    });
    const visibleNodeIds = getReplayVisibleNodeIdSet(step);
    const suppressedNodeIds = new Set(step.replaySuppressAutoRevealNodeIds || []);
    mergedRelationLinks.forEach((link) => {
      const automaticallyVisibleAnchorNodeIds = (Array.isArray(link?.anchors)
        ? link.anchors
          .map((anchor) => String(anchor?.nodeId || ''))
        : []);
      [
        String(link?.sourceNodeId || ''),
        String(link?.targetNodeId || ''),
        String(link?.witnessNodeId || ''),
        ...automaticallyVisibleAnchorNodeIds
      ].forEach((nodeId) => {
        const node = findExactNodeByIdInForest([canvas], nodeId);
        if (!nodeId || !node || (node as any).replayLayoutOnly || suppressedNodeIds.has(nodeId) || visibleNodeIds.has(nodeId))
          return;
        visibleNodeIds.add(nodeId);
        // As in the snapshot, an occurrence revealed here shows its derived word.
        (node.children || [])
          .filter(child => isReplayDisplayChild(child, nodeId) && !(child as any).replayLayoutOnly)
          .forEach(child => visibleNodeIds.add(String(child.id || '')));
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

const stabilizeStructuralReplayVisibility = (steps: PlaybackStep[]): PlaybackStep[] => {
  if (steps.length === 0)
    return steps;
  const persistentProjectedNodeIds = new Set<string>();
  const persistentVisibleNodeIds = new Set<string>();
  const persistentVisibleSubtreeSignatures = new Set<string>();
  return steps.map((step) => {
    const canvas = step.replayCanvasData;
    const rawVisibleIds = Array.isArray(step.replayVisibleNodeIds)
      ? step.replayVisibleNodeIds.map((id) => String(id || '')).filter(Boolean)
      : [];
    const suppressedAutoRevealNodeIds = new Set((Array.isArray(step.replaySuppressAutoRevealNodeIds) ? step.replaySuppressAutoRevealNodeIds : [])
      .map((id) => String(id || ''))
      .filter(Boolean));
    if (!canvas) {
      if (step.operation === 'Project' && String(step.targetNodeId || '')) {
        persistentProjectedNodeIds.add(String(step.targetNodeId || ''));
      }
      return step;
    }
    const exactNodesById = collectExactNodesByIdInForest([canvas]);
    const continuitySignatures = collectReplayContinuitySubtreeSignatures([canvas]);
    const nextVisibleIds = new Set(rawVisibleIds.filter((visibleNodeId) => !suppressedAutoRevealNodeIds.has(visibleNodeId)));
    persistentVisibleNodeIds.forEach((visibleNodeId) => {
      if (suppressedAutoRevealNodeIds.has(visibleNodeId))
        return;
      const exactNode = exactNodesById.get(visibleNodeId)?.[0];
      if (!exactNode || (exactNode as any).replayLayoutOnly === true)
        return;
      nextVisibleIds.add(visibleNodeId);
    });
    const preserveProjectedNode = (nodeId: string) => {
      const node = exactNodesById.get(nodeId)?.[0];
      if (!node || (node as any).replayLayoutOnly === true)
        return;
      if (suppressedAutoRevealNodeIds.has(nodeId))
        return;
      nextVisibleIds.add(nodeId);
    };
    persistentProjectedNodeIds.forEach(preserveProjectedNode);
    if (persistentVisibleSubtreeSignatures.size > 0) {
      const signatureBuckets = new Map<string, SyntaxNode[]>();
      collectReplayCanvasNodes(canvas).forEach((node) => {
        const signature = continuitySignatures.get(node);
        if (!signature || !persistentVisibleSubtreeSignatures.has(signature))
          return;
        const entries = signatureBuckets.get(signature) || [];
        entries.push(node);
        signatureBuckets.set(signature, entries);
      });
      signatureBuckets.forEach((nodes) => {
        if (nodes.length !== 1)
          return;
        collectSubtreeNodeIds(nodes[0]).forEach((visibleNodeId) => {
          if (suppressedAutoRevealNodeIds.has(visibleNodeId))
            return;
          nextVisibleIds.add(visibleNodeId);
        });
      });
    }
    if (step.operation === 'Project' && String(step.targetNodeId || '')) {
      const targetNodeId = String(step.targetNodeId || '');
      preserveProjectedNode(targetNodeId);
      persistentProjectedNodeIds.add(targetNodeId);
    }
    nextVisibleIds.forEach((visibleNodeId) => persistentVisibleNodeIds.add(visibleNodeId));
    collectReplayCanvasNodes(canvas).forEach((node) => {
      const nodeId = String(node?.id || '');
      if (!nodeId || !nextVisibleIds.has(nodeId))
        return;
      const completeSubtreeIsVisible = collectSubtreeNodeIds(node).every((subtreeNodeId) => {
        const subtreeNode = exactNodesById.get(subtreeNodeId)?.[0];
        return (subtreeNode as any)?.replayLayoutOnly === true
          || nextVisibleIds.has(subtreeNodeId);
      });
      if (!completeSubtreeIsVisible)
        return;
      const signature = continuitySignatures.get(node);
      if (signature)
        persistentVisibleSubtreeSignatures.add(signature);
    });
    return {
      ...step,
      replayVisibleNodeIds: Array.from(nextVisibleIds)
    };
  });
};

/** Keep sequence repair ordered: visibility precedes persistence, then atomic landings and progress. */
export const normalizePlaybackSequence = (
  steps: PlaybackStep[],
  pendingProjections: Array<{ nodeId: string; firstStageIndex: number; stageIndex: number; relationIndex: number }>,
  replayPlan?: DerivationReplayPlan | null
): PlaybackStep[] => {
  const squashed = squashAdjacentStructuralReplayDuplicates(steps);
  const visible = stabilizeStructuralReplayVisibility(squashed);
  const selected = splitCollapsedNullSelectionProjectSteps(visible);
  const valid = removeInvalidReplayVisibilityTransitions(selected);
  const persistent = carryReplayRelationLinksForward(valid);
  const changed = collapseZeroDeltaReplaySteps(persistent);
  const attached = insertPreMovementLandingMergeSteps(changed);
  const projected = deferPendingMovementProjections(attached, pendingProjections);
  const materialized = projected.map(hidePendingInflSpecifierWrappersInStep);
  // A withheld wrapper remains layout context, not a visible construction
  // claim. Apply the final visibility refinement before counting its steps.
  const constructed = materialized.filter(step => step.replayKind !== 'micro'
    || !['LexicalSelect', 'Project', 'ExternalMerge'].includes(String(step.operation))
    || getReplayVisibleNodeIdSet(step).has(step.targetNodeId));
  return recountReplayProgress(constructed, replayPlan);
};
