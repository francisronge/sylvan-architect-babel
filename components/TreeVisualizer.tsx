import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Scan } from 'lucide-react';
import { DerivationStage, SyntaxNode } from '../types';
import { prepareReplay, type PreparedReplay } from '../replay/prepareReplay.ts';
import RootLogo from './RootLogo';
import { appendPlaqueContent } from './plaqueViewport';
import { isReplayDisplayChild } from '../replay/displayIdentity.ts';
import { availableTreeViewport, containCamera, linearizationViewport } from './treeViewport';
import { buildStageCameraBounds, buildStageLayoutGroups, buildStagePlaqueLayout, stageTreeLayoutSize, treeLayoutSize } from '../replay/stageCamera.ts';
import type { PlaqueTextBlock, PlaqueTextMeasure } from '../replay/relations/plaqueTextLayout.ts';
import { preparePfPlaqueTextLayout, reservePlaqueViewport, wrapPlaqueText } from '../replay/relations/plaqueTextLayout.ts';
import { projectPlaqueLayout } from '../replay/relations/plaquePlacement.ts';
import {
  DERIVATION_WORKSPACE_ROOT_LABEL,
  MOVEMENT_ARC_STROKE,
  MOVEMENT_ARROW_COLOR,
  STEP_DELAY_MS,
  applyVizIds,
  buildFirstRevealNodeStepIndex,
  buildMovementArrowsFromLinks,
  buildMovementCopyTraceIndexByTerminalId,
  buildMovementProtectedNodeIds,
  buildNodeStepIndex,
  buildRenderableCommittedCanvasData,
  buildRenderableDerivationCanvasData,
  buildReplayDisplayDetailBlocks,
  buildReplayPanelContent,
  buildResolvedLinkOperatorVariableIndexMap,
  buildResolvedLinkRawTraceAliasMap,
  buildResolvedLinkTraceIndexMap,
  cloneSyntaxTree,
  collectPronouncedLeafNodeIdsInOrder,
  extractMovementIndex,
  findParentLabelInForest,
  formatOperationLabel,
  formatReplayBlockLine,
  formatReplayBlockTitle,
  formatIndexedSurfaceForDisplayValue,
  formatAuthoredWitnessSurface,
  formatTraceSurfaceForDisplayValue,
  getNodeId,
  hasSilentOrGhostAncestor,
  indexHierarchyNodesByIdAndAliases,
  isDisplayTraceLabel,
  isDisplayTerminalSurface,
  isFrontingLikeOperationLabel,
  isHeadLikeResolvedRelation,
  isNullLike,
  isOvertLeafNode,
  isPronouncedHierLeaf,
  isWordlessCategoryLeaf,
  isSyntheticWorkspaceRootNode,
  isTraceLike,
  isUnderTriangulation,
  markTriangulatedNodes,
  maybeLowercaseSentenceInitialFunctionSurface,
  normalizeToken,
  normalizeTraceIndexForDisplay,
  normalizeTrajectoryKind,
  resolveLeafSurface,
  resolveLexicalMovementTraceDisplayIndex,
  resolveTraceIndexFromNodeContext,
  shouldExpandPreterminalLeaf,
  stepRepresentsMovement,
  tokenizeReplaySentenceSurface,
  type HierNode,
  type MovementArrow,
  type VisibleLink
} from '../replay/replayCompiler.ts';
import {
  resolveDisplayedTrajectoryAttachments,
  planItemOwnsRelationMoment,
  planItemRelationRefs,
  planItemDependencyNodeIds,
  type DirectedPathPlanItem,
  type NodePlaquePlanItem,
  type RelationPlanItem
} from '../replay/relations/renderPlanCompiler.ts';
import {
  anchorSetRailPaths,
  bindRelationPlanFrame,
  boundOverlayBounds,
  fitFallbackGeometry,
  FALLBACK_ROLE_STYLE,
  fallbackMarkerScale,
  resolveUniqueDisplayTerminal,
  ghostLensPresentation,
  type BoundPrimitive,
  type BoundSegment,
  type BoundAnchorSetRail,
  type OverlayBounds,
  type PlanPositionProvider
} from '../replay/relations/geometryBinding.ts';

const getReplayTokenIndex = (node: HierNode): number | undefined => {
  let current: HierNode | null = node;
  while (current) {
    const tokenIndex = Number(current.data?.tokenIndex);
    if (Number.isFinite(tokenIndex)) return tokenIndex;
    current = current.parent;
  }
  return undefined;
};

const replayDeterminerHasNominalComplement = (node: HierNode): boolean => {
  const functionNode = String(node.data?.label || '').trim().toUpperCase() === 'D'
    ? node
    : String(node.parent?.data?.label || '').trim().toUpperCase() === 'D'
      ? node.parent
      : null;
  const nominalPhraseNode = functionNode?.parent;
  return Boolean(
    functionNode
    && String(nominalPhraseNode?.data?.label || '').trim().toUpperCase() === 'DP'
    && nominalPhraseNode?.children?.some((child) => child !== functionNode)
  );
};

import {
  featureSharingPlaqueRect,
  dependentCaseStatePlaques,
  vineConvergence,
  featureSharingVinePath,
  fongComponentArcPath,
  fongComponentLabelPoint,
  fongEdgeOutlineRect,
  orthogonalTrajectoryPath,
  phaseArcPath,
  splitAntecedenceLinkPath,
  transferAccessLanePath
} from '../replay/relations/markGeometry.ts';
import {
  analysisVerdictCompoundOrigin,
  analysisVerdictInitialLocalScale,
  caseAssignmentPlaquePath,
  placeRectBelowCollisions,
  planAnalysisVerdictRows,
  planAnchorSetLayout,
  type AnalysisVerdictAnchor,
  type Rect
} from '../replay/relations/overlayGeometry.ts';
import { nativeLinearizationPlateHeight } from '../replay/relations/nativeDrawingContent.ts';

const withPlaqueTextMeasure = <T,>(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  useMeasure: (measure: PlaqueTextMeasure) => T
): T => {
  const text = svg.append('text').attr('visibility', 'hidden')
    .attr('aria-hidden', 'true').attr('x', 0).attr('y', 0).style('white-space', 'pre');
  try {
    return useMeasure((value, style) => {
      text.style('font-family', style.fontFamily).style('font-size', `${style.fontSize}px`)
        .style('font-weight', style.fontWeight).style('letter-spacing', `${style.letterSpacing}px`).text(value);
      const element = text.node()!;
      const box = element.getBBox();
      return { width: Math.max(element.getComputedTextLength(), box.x + box.width), ascent: Math.max(0, -box.y), descent: Math.max(0, box.y + box.height) };
    });
  } finally {
    text.remove();
  }
};

const drawPlaqueText = (
  parent: d3.Selection<SVGGElement, unknown, null, undefined>,
  block: PlaqueTextBlock,
  className: string,
  origin = { x: 0, y: 0 }
) => {
  const text = parent.append('text').attr('class', className)
    .style('font-family', block.style.fontFamily).style('font-size', `${block.style.fontSize}px`)
    .style('font-weight', block.style.fontWeight).style('letter-spacing', `${block.style.letterSpacing}px`)
    .style('white-space', 'pre').attr('xml:space', 'preserve');
  block.lines.forEach(line => text.append('tspan')
    .attr('x', origin.x + line.x).attr('y', origin.y + line.y).text(line.text));
};

const labelBelongsToNode = (element: SVGGraphicsElement, id: string): boolean => {
  const node = d3.select<SVGGraphicsElement, HierNode>(element).datum();
  return element.getAttribute('data-category-node-id') === id
    || element.getAttribute('data-node-id') === id
    || Boolean(node?.data && (node.data.aliasIds?.includes(id) || isReplayDisplayChild(node.data, id)));
};

export type TreeCameraState = {
  data: SyntaxNode; signature: string; width: number; height: number; transform: d3.ZoomTransform;
};

export interface TreeVisualizerProps {
  preparedReplay?: PreparedReplay;
  manualCameraState?: React.RefObject<TreeCameraState | null>;
  data: SyntaxNode;
  animated?: boolean;
  derivationStages?: DerivationStage[];
  abstractionMode?: boolean;
  sentence?: string;
  /**
   * Production draws the compiled visual-relations overlay by default. A
   * research surface that layers its own demonstration overlay (the Lab) may
   * disable it to avoid double-drawing; nothing else should.
   */
  disableRelationOverlay?: boolean;
}

type RelationMoment = {
  stageIndex: number;
  relationIndex: number;
};


const TreeVisualizer: React.FC<TreeVisualizerProps> = ({
  data,
  animated = false,
  derivationStages,
  abstractionMode = false,
  sentence = '',
  disableRelationOverlay = false,
  preparedReplay,
  manualCameraState
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  // An active D3 gesture must dispatch to the current frame's handler after a redraw.
  const zoomBehavior = useMemo(() => d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.05, 10]), []);
  const containerRef = useRef<HTMLDivElement>(null);
  const replayHeaderRef = useRef<HTMLDivElement>(null);
  const replayPanelRef = useRef<HTMLDivElement>(null);
  const [uiBounds, setUiBounds] = useState({ top: 0, right: 16, bottom: 16, headerBottom: 0, panelTop: Infinity });
  const ownManualCameraRef = useRef<TreeCameraState | null>(null);
  const manualCameraRef = manualCameraState ?? ownManualCameraRef;
  const relationPointerPositionRef = useRef<{ x: number; y: number } | null>(null);
  const relationHoverResolutionFrameRef = useRef<number | null>(null);
  const terminalMorphRef = useRef<Map<string, { preText: string; postText: string; step: number; hideBefore: boolean }>>(new Map());
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [fontLayoutPass, setFontLayoutPass] = useState(0);
  const [fitRevision, setFitRevision] = useState(0);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [hoveredRelationMoment, setHoveredRelationMoment] = useState<RelationMoment | null>(null);
  useEffect(() => {
    let cancelled = false;
    const settle = () => {
      if (!cancelled) setFontLayoutPass((pass) => pass + 1);
    };
    document.fonts?.ready.then(settle);
    document.fonts?.addEventListener('loadingdone', settle);
    return () => {
      cancelled = true;
      document.fonts?.removeEventListener('loadingdone', settle);
    };
  }, []);
  const { replayDerivationFrames, derivationReplayPlan, relationRenderPlan, committedDerivationVisualLinks,
    movementChainIndexCatalogue, playbackSteps } = useMemo(
    () => preparedReplay ?? prepareReplay({ derivationStages, sentence, includePlayback: animated }),
    [preparedReplay, derivationStages, sentence, animated]
  );
  const openingSelectionRef = useRef<{ steps: typeof playbackSteps; startedAt: number } | null>(null);
  const hasDerivationFrames = replayDerivationFrames.length > 0;
  const derivationStagesSignature = useMemo(() => {
    const stages = Array.isArray(derivationStages) ? derivationStages : [];
    return stages.map((stage, index) => JSON.stringify({
      index,
      statement: stage.statement,
      stageRecord: stage.stageRecord,
      relations: stage.relations || [],
      workspaceForest: stage.workspaceForest || [],
      ...(stage.realizations ? { realizations: stage.realizations } : {})
    })).join('|');
  }, [derivationStages]);
  const derivationFramesSignature = useMemo(() => {
    const frames = replayDerivationFrames || [];
    return frames.map((frame, index) => JSON.stringify({
      index,
      frameId: frame.frameId,
      stepId: frame.stepId,
      operation: frame.operation,
      recipe: frame.recipe,
      chainId: frame.chainId,
      movement: frame.movement || null,
      change: frame.change || null,
      workspaceForest: frame.workspaceForest || [],
      ...(frame.after?.realizations ? { realizations: frame.after.realizations } : {})
    })).join('|');
  }, [replayDerivationFrames]);
  const usesDerivationFrames = animated && replayDerivationFrames.length > 0;
  const committedDerivationFrameIndex = hasDerivationFrames
    ? replayDerivationFrames.length - 1
    : -1;
  const committedDerivationFrame = hasDerivationFrames && committedDerivationFrameIndex >= 0
    ? replayDerivationFrames[committedDerivationFrameIndex] || null
    : null;
  const movementProtectedNodeIds = useMemo(
    () => buildMovementProtectedNodeIds(committedDerivationVisualLinks),
    [committedDerivationVisualLinks]
  );
  const committedDerivationCanvasData = useMemo(() => {
    if (!usesDerivationFrames) return null;
    if (!committedDerivationFrame) {
      return {
        label: DERIVATION_WORKSPACE_ROOT_LABEL,
        replayOrigin: { kind: 'workspace' },
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
  const pendingPhraseFrontingSourceNodeIds = useMemo(() => {
    const sourceNodeIds = new Set<string>();
    playbackSteps.slice(Math.max(0, currentStepIndex + 1)).forEach((step) => {
      (Array.isArray(step.replayRelationLinks) ? step.replayRelationLinks : []).forEach((link) => {
        if (isHeadLikeResolvedRelation(link)) return;
        if (!isFrontingLikeOperationLabel(link?.operation || link?.relation)) return;
        const sourceNodeId = String(link?.sourceNodeId || '');
        if (sourceNodeId) sourceNodeIds.add(sourceNodeId);
      });
    });
    return sourceNodeIds;
  }, [currentStepIndex, playbackSteps]);
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
  const currentReplayStep = currentStepIndex >= 0 ? playbackSteps[currentStepIndex] : null;
  const currentReplayUsesFutureLayoutScaffold = Boolean(
    currentReplayStep?.replayUsesFutureLayoutScaffold
  );
  const currentReplayKind = String((currentReplayStep as any)?.replayKind || '').trim();
  const currentReplayRelationIdentity = currentReplayKind === 'relation'
    ? (currentReplayStep as any)?.replayRelationIdentity
    : null;
  const activeRelationMoment = (() => {
    if (!currentReplayRelationIdentity) return null;
    const stageIndex = Number(currentReplayRelationIdentity.stageIndex);
    const relationIndex = Number(currentReplayRelationIdentity.relationIndex);
    return Number.isInteger(stageIndex) && Number.isInteger(relationIndex)
      ? { stageIndex, relationIndex }
      : null;
  })();
  // Hover emphasis is applied directly to the mounted relation elements.
  // Keeping it out of the D3 render effect preserves the user's exact zoom
  // and pan transform while the pointer moves between relations.
  const focusedRelationMoment = activeRelationMoment;
  const playedRelationIndices = animated
    ? playbackSteps.reduce((played, step, stepIndex) => {
        if (stepIndex > currentStepIndex || (step as any).replayKind !== 'relation') return played;
        const identity = (step as any).replayRelationIdentity;
        const stageIndex = Number(identity?.stageIndex);
        const relationIndex = Number(identity?.relationIndex);
        if (
          Number.isInteger(stageIndex)
          && Number.isInteger(relationIndex)
          && stageIndex === activeDerivationFrameIndex
        ) {
          played.add(relationIndex);
        }
        return played;
      }, new Set<number>())
    : null;
  const playedRelationIndicesAttribute = playedRelationIndices
    ? Array.from(playedRelationIndices).join(',')
    : '';
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
  const traceDisplayIndexByNodeId = useMemo(() => (
    traceDisplayFrame
      ? buildResolvedLinkTraceIndexMap(
          traceDisplayFrame.workspaceForest || [],
          traceDisplayRelationLinks,
          traceDisplayFrameIndex,
          movementChainIndexCatalogue
        )
      : new Map<string, string>()
  ), [traceDisplayFrame, traceDisplayFrameIndex, traceDisplayRelationLinks, movementChainIndexCatalogue]);
  const isFinalDerivationReplayStep = usesDerivationFrames
    && activeStepIndex >= playbackSteps.length - 1;
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
  }, [playbackSteps]);

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
    return new Set(nodeIds.map((id) => String(id || '')).filter(Boolean));
  }, [activeDerivationReplayStep, usesDerivationFrames]);
  const acceptedCompositionIsTreeFirst = (relationRenderPlan?.frames[activeDerivationFrameIndex]?.items ?? []).some((item) =>
    item.familyId === 'copy.multiple-pronunciation'
    || item.familyId === 'copy.partial-deletion'
    || item.familyId === 'multidominance.shared-node'
    || item.familyId === 'argument-sharing.domains'
    || item.familyId === 'pf.phrasal-spellout'
    || item.familyId === 'pf.correspondence'
    || item.familyId === 'pf.fission'
    || item.familyId === 'pf.impoverishment'
    || item.familyId === 'pf.local-dislocation'
    || item.familyId === 'pf.cyclic-linearization'
    || item.familyId === 'cooper-storage.ledger'
    || item.familyId === 'scope.operator-variable'
    || item.familyId === 'accord.link'
    || item.familyId === 'accord.strong-npi'
    || item.familyId === 'focus.prominence'
    || item.familyId === 'focus.f-projection'
    || item.familyId === 'theta.grid');
  const stageLayoutGroups = useMemo(() => buildStageLayoutGroups(playbackSteps, replayDerivationFrames),
    [playbackSteps, replayDerivationFrames]);
  const stageLayoutSize = useMemo(() => (
    animated && usesDerivationFrames
      ? stageTreeLayoutSize(playbackSteps, activeDerivationFrameIndex, dimensions.width, dimensions.height, stageLayoutGroups)
      : null
  ), [animated, usesDerivationFrames, playbackSteps, activeDerivationFrameIndex, dimensions.width, dimensions.height, stageLayoutGroups]);
  const stagePlaqueLayout = useMemo(() => {
    if (!activeDerivationFrame || dimensions.width === 0 || disableRelationOverlay) return new Map();
    return buildStagePlaqueLayout({
      steps: playbackSteps, stageIndex: activeDerivationFrameIndex,
      completedCanvas: buildRenderableDerivationCanvasData(activeDerivationFrame.workspaceForest || []),
      plan: relationRenderPlan, ...dimensions, abstractionMode, protectedNodeIds: movementProtectedNodeIds,
      layoutGroups: stageLayoutGroups
    });
  }, [activeDerivationFrame, activeDerivationFrameIndex, playbackSteps, relationRenderPlan,
    dimensions, abstractionMode, movementProtectedNodeIds, disableRelationOverlay, stageLayoutGroups]);
  const stageCameraBounds = useMemo(() => {
    if (!animated || !usesDerivationFrames || !activeDerivationFrame || dimensions.width === 0) return null;
    return buildStageCameraBounds({
      steps: playbackSteps, stageIndex: activeDerivationFrameIndex,
      completedCanvas: buildRenderableDerivationCanvasData(activeDerivationFrame.workspaceForest || []),
      plan: relationRenderPlan, ...dimensions, abstractionMode, protectedNodeIds: movementProtectedNodeIds,
      includeOverlays: !disableRelationOverlay && !acceptedCompositionIsTreeFirst,
      plaqueLayout: stagePlaqueLayout, layoutGroups: stageLayoutGroups
    });
  }, [animated, usesDerivationFrames, activeDerivationFrame, activeDerivationFrameIndex,
    playbackSteps, relationRenderPlan, dimensions, abstractionMode,
    movementProtectedNodeIds, disableRelationOverlay, acceptedCompositionIsTreeFirst, stagePlaqueLayout, stageLayoutGroups]);
  const stagePlaqueContainmentBounds = useMemo(() => {
    if (!stageCameraBounds || !activeDerivationFrame || disableRelationOverlay || !acceptedCompositionIsTreeFirst) return null;
    return buildStageCameraBounds({
      steps: playbackSteps, stageIndex: activeDerivationFrameIndex,
      completedCanvas: buildRenderableDerivationCanvasData(activeDerivationFrame.workspaceForest || []),
      plan: relationRenderPlan, ...dimensions, abstractionMode, protectedNodeIds: movementProtectedNodeIds,
      includeOverlays: false, includePlaques: true, plaqueLayout: stagePlaqueLayout, layoutGroups: stageLayoutGroups
    });
  }, [stageCameraBounds, activeDerivationFrame, disableRelationOverlay, acceptedCompositionIsTreeFirst,
    playbackSteps, activeDerivationFrameIndex, relationRenderPlan, dimensions, abstractionMode,
    movementProtectedNodeIds, stagePlaqueLayout, stageLayoutGroups]);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const controls = Array.from<HTMLElement>(container.closest('[data-babel-workspace]')?.querySelectorAll<HTMLElement>('[data-babel-tree-controls]') || []);
    const measure = () => {
      const canvas = container.getBoundingClientRect();
      const next = { top: 0, right: 16, bottom: 16, headerBottom: 0, panelTop: Infinity };
      controls.forEach((element) => {
        if (element.getAttribute('aria-hidden') === 'true' || !element.getClientRects().length) return;
        const rect = element.getBoundingClientRect();
        if (element.dataset.babelTreeControls === 'right') next.right = Math.max(next.right, canvas.right - rect.left + 12);
        if (element.dataset.babelTreeControls === 'bottom') next.bottom = Math.max(next.bottom, canvas.bottom - rect.top + 12);
        if (element.dataset.babelTreeControls === 'top') next.top = Math.max(next.top, rect.bottom - canvas.top + 12);
      });
      next.headerBottom = replayHeaderRef.current ? replayHeaderRef.current.getBoundingClientRect().bottom - canvas.top : 0;
      next.panelTop = replayPanelRef.current ? replayPanelRef.current.getBoundingClientRect().top - canvas.top : Infinity;
      setUiBounds(previous => Object.keys(next).every(key => Math.abs(next[key as keyof typeof next] - previous[key as keyof typeof next]) < 0.5 || next[key as keyof typeof next] === previous[key as keyof typeof next]) ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    [container, replayHeaderRef.current, replayPanelRef.current, ...controls].forEach(element => { if (element) observer.observe(element); });
    controls.forEach(element => element.addEventListener('transitionend', measure));
    measure();
    return () => {
      observer.disconnect();
      controls.forEach(element => element.removeEventListener('transitionend', measure));
    };
  });
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
    setHoveredRelationMoment(null);
  }, [activeStepIndex]);

  useEffect(() => () => {
    if (relationHoverResolutionFrameRef.current !== null) {
      window.cancelAnimationFrame(relationHoverResolutionFrameRef.current);
    }
  }, []);

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
    const layoutDerivationTraceIndexByNodeId = traceDisplayIndexByNodeId;
    const layoutOperatorVariableIndexByNodeId = traceDisplayFrame
      ? buildResolvedLinkOperatorVariableIndexMap(
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
    const layoutVisibleOvertLeafIds = collectPronouncedLeafNodeIdsInOrder(canvasData)
      .filter((nodeId) => !replayVisibleNodeIdSet || replayVisibleNodeIdSet.has(nodeId));
    const layoutFirstVisibleOvertLeafId = String(layoutVisibleOvertLeafIds[0] || '');
    const maybeCapitalizeLayoutSentenceInitialLeaf = (node: HierNode, value: string): string => {
      const trimmed = String(value || '').trim();
      if (!trimmed || isTraceLike(trimmed) || isNullLike(trimmed)) return trimmed;
      if (normalizeToken(trimmed) !== normalizeToken(firstSentenceReplayToken)) return trimmed;
      if (!layoutFirstVisibleOvertLeafId || getNodeId(node) !== layoutFirstVisibleOvertLeafId) return trimmed;
      const nodeAncestorIds = new Set<string>();
      let currentAncestor: HierNode | null = node;
      while (currentAncestor) {
        const ancestorId = getNodeId(currentAncestor);
        if (ancestorId) nodeAncestorIds.add(ancestorId);
        currentAncestor = currentAncestor.parent;
      }
      const surfacedByFrontingMovement = activeDerivationArrowLinks.some((link) => {
        const targetNodeId = String(link?.targetNodeId || '');
        return Boolean(targetNodeId) && nodeAncestorIds.has(targetNodeId);
      });
      const awaitsPhraseFronting = Array.from(nodeAncestorIds).some((nodeId) => (
        pendingPhraseFrontingSourceNodeIds.has(nodeId)
      ));
      if (getReplayTokenIndex(node) !== 0 && !surfacedByFrontingMovement) return trimmed;
      if (!surfacedByFrontingMovement && awaitsPhraseFronting) return trimmed;
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
        const operatorVariableIndex = resolveTraceIndexFromNodeContext(
          d,
          layoutOperatorVariableIndexByNodeId
        );
        const carriedMovementTraceIndex = resolveTraceIndexFromNodeContext(
          d,
          layoutDerivationTraceIndexByNodeId
        );
        const lexicalMovementTraceIndex = resolveLexicalMovementTraceDisplayIndex(
          d,
          fallback,
          storedTraceIndex || carriedMovementTraceIndex
        );
        if (lexicalMovementTraceIndex) {
          /*
           * Each movement occurrence keeps its authored words and gains only
           * the chain-index subscript. Pronunciation remains independently
           * authored; an index never converts a copy into a trace.
           * Trace display is reserved for occupants the model authored as
           * traces.
           */
          return formatIndexedSurfaceForDisplayValue(fallback, lexicalMovementTraceIndex);
        }
        if (!morph) {
          return isTraceLike(fallback)
            ? formatTraceSurfaceForDisplayValue(
                fallback,
                directTraceIndex || storedTraceIndex || aliasedTraceIndex || extractMovementIndex(fallback)
              )
            : formatIndexedSurfaceForDisplayValue(
                maybeCapitalizeLayoutSentenceInitialLeaf(d, fallback),
                operatorVariableIndex
              );
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
        return formatIndexedSurfaceForDisplayValue(
          maybeCapitalizeLayoutSentenceInitialLeaf(d, morph.postText || fallback),
          operatorVariableIndex
        );
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
    fontLayoutPass,
    abstractionMode,
    firstSentenceReplayDisplayToken,
    firstSentenceReplayToken,
    replayVisibleNodeIdSet,
    traceDisplayFrame,
    traceDisplayFrameIndex,
    traceDisplayRelationLinks,
    traceDisplayIndexByNodeId,
    usesDerivationFrames,
    playbackSteps.length
  ]);

  useEffect(() => {
    if (!canvasData || !svgRef.current || dimensions.width === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('data-babel-rendered-step', null);

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
    const [innerWidth, innerHeight] = stageLayoutSize
      ?? treeLayoutSize(nodeCount, maxDepth, containerWidth, containerHeight);

    const g = svg.attr('width', '100%').attr('height', '100%').append('g');

    const updateScreenStableText = (screenScale: number) => {
      const safeScale = Math.max(0.001, screenScale || 1);
      g.selectAll<SVGTextElement, unknown>('[data-vr-screen-font-px]').each(function () {
        const text = d3.select(this);
        const fontPx = Number(this.dataset.vrScreenFontPx || 0);
        const strokePx = Number(this.dataset.vrScreenStrokePx || 0);
        if (fontPx > 0) text.style('font-size', `${fontPx / safeScale}px`);
        if (strokePx > 0) text.style('stroke-width', `${strokePx / safeScale}px`);
      });
    };
    let applyingCameraTransform = false;
    const zoom = zoomBehavior
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
        if (event.sourceEvent && !applyingCameraTransform) {
          manualCameraRef.current = { data, signature: derivationStagesSignature, width: containerWidth, height: containerHeight, transform: event.transform };
        }
        // Overlay markers keep a stable screen size: their world position is
        // carried on data attributes and their local scale counteracts zoom.
        g.selectAll<SVGGElement, unknown>('.vr-overlay-marker').attr('transform', function () {
          const el = this as SVGGElement;
          const x = Number(el.dataset.vrX || 0);
          const y = Number(el.dataset.vrY || 0);
          // Screen-stable, but capped so far-out zoom never lets markers
          // dwarf the tree they annotate.
          return `translate(${x},${y}) scale(${Math.min(1 / (event.transform.k || 1), 3)})`;
        });
        updateScreenStableText(event.transform.k || 1);
      });
    svg.call(zoom as any);

    const treeLayout = d3.tree<SyntaxNode>()
      .size([innerWidth, innerHeight])
      .separation((a, b) => a.parent === b.parent ? 2.5 : 3.5);

    const treeData = treeLayout(rootHierarchy);
    const alignReplayUnaryTerminalLeaves = (root: d3.HierarchyPointNode<SyntaxNode>) => {
      root.eachBefore((node) => {
        const children = Array.isArray(node.children) ? node.children : [];
        const layoutChildren = children.filter((child) =>
          !isSyntheticWorkspaceRootNode(child)
        );
        if (layoutChildren.length !== 1) return;
        const child = layoutChildren[0];
        if (
          replayVisibleNodeIdSet
          && (
            !replayVisibleNodeIdSet.has(getNodeId(node))
            || !replayVisibleNodeIdSet.has(getNodeId(child))
          )
        ) return;
        if (!child) return;
        if (isSyntheticWorkspaceRootNode(node) || isSyntheticWorkspaceRootNode(child)) return;
        const childHasChildren = Array.isArray(child.children) && child.children.length > 0;
        const isTerminalLeaf = !childHasChildren && !isWordlessCategoryLeaf(child.data);
        if (isTerminalLeaf) {
          child.x = node.x;
        }
      });
    };
    if (usesDerivationFrames) {
      alignReplayUnaryTerminalLeaves(treeData);
    }
    const plaqueNodePositions = indexHierarchyNodesByIdAndAliases(treeData.descendants());
    const replayPlaqueLayout = projectPlaqueLayout(stagePlaqueLayout, id => plaqueNodePositions.get(id) ?? null);
    const derivationFrameFitNodes = (() => {
      if (!animated || !usesDerivationFrames || !activeDerivationFrame) return null;
      if (currentReplayUsesFutureLayoutScaffold) {
        return treeData.descendants().filter((node) =>
          !isUnderTriangulation(node) && !isSyntheticWorkspaceRootNode(node)
        );
      }
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
    const timeline = playbackSteps;
    const nodeStepIndex = buildNodeStepIndex(timeline);
    const firstRevealNodeStepIndex = buildFirstRevealNodeStepIndex(timeline);
    const revealThreshold = animated ? activeStepIndex : Number.MAX_SAFE_INTEGER;
    const derivationTraceIndexByNodeId = traceDisplayIndexByNodeId;
    const derivationOperatorVariableIndexByNodeId = traceDisplayFrame
      ? (() => {
          const workspaceForest = traceDisplayFrame.workspaceForest || [];
          return buildResolvedLinkOperatorVariableIndexMap(
            workspaceForest,
            traceDisplayRelationLinks,
            traceDisplayFrameIndex
          );
        })()
      : new Map<string, string>();
    const operatorVariableWitnessNodeIds = new Set(
      (traceDisplayRelationLinks || [])
        .filter((link) => {
          const relation = String(link?.relation || link?.operation || '').trim();
          const stepIndex = Number.isInteger(link?.stepIndex) ? Number(link.stepIndex) : 0;
          return /operator\s*[-\s]?variable\s*[-\s]?binding/i.test(relation)
            && stepIndex <= traceDisplayFrameIndex;
        })
        .map((link) => String(link?.witnessNodeId || ''))
        .filter(Boolean)
    );
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
    /*
     * A lower occurrence is authored as silent lexical material so Replay can
     * show it overtly before movement. Occupant-as-authored ruling: once its
     * exact phrasal movement relation has played, the vacated occurrence keeps
     * its authored words, ghosted, and gains only the chain-index subscript.
     * Babel never rewrites a copy into a trace; trace display belongs solely
     * to occupants the model authored as traces. The map below supplies the
     * chain index for that subscript.
     */
    const movedFromCopyTraceIndexByTerminalId =
      buildMovementCopyTraceIndexByTerminalId(movementArrows);
    const formatTraceSurfaceForDisplay = (
      surface: string,
      fallbackIndex?: string | null
    ): string => {
      return formatTraceSurfaceForDisplayValue(surface, fallbackIndex);
    };
    /*
     * Authored witness kind is authoritative; the pure law lives in
     * replayCompiler.formatAuthoredWitnessSurface and is shared with tests.
     */
    const formatReplayIndexedSilentLeaf = (
      surface: string,
      inheritedTraceIndex?: string | null,
      aliasedTraceIndex?: string | null
    ): string => formatAuthoredWitnessSurface(surface, inheritedTraceIndex, aliasedTraceIndex);

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
          if (isPronouncedHierLeaf(current)) return current;
          continue;
        }
        stack.unshift(...children);
      }
      return null;
    };
    const hierarchyNodeById = new Map<string, HierNode>(
      rootHierarchy.descendants().map((node): [string, HierNode] => [getNodeId(node), node])
    );
    const firstVisibleOvertLeafId = String(
      collectPronouncedLeafNodeIdsInOrder(clonedCanvasData).find((nodeId) => {
        if (!replayVisibleNodeIdSet) return true;
        let current = hierarchyNodeById.get(nodeId) || null;
        while (current) {
          if (replayVisibleNodeIdSet.has(getNodeId(current))) return true;
          current = current.parent;
        }
        return false;
      }) || ''
    );

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
        // Additive indexing only: an authored `t` gains its index; any other
        // authored witness surface (∅, silent lexical material) stays exactly
        // as authored.
        const formattedTraceSurface = isTraceLike(traceSurface)
          ? formatTraceSurfaceForDisplay(traceSurface, relationIndex)
          : traceSurface;
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
            && getNodeId(sentenceInitialLeaf) === firstVisibleOvertLeafId;
          if (!usesDerivationFrames && sentenceInitialLeaf && shouldCapitalizeSentenceInitialLeaf) {
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

      const targetIsRenderableTerminal = !isWordlessCategoryLeaf(arrow.target.data as SyntaxNode);
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
      .attr('data-source-node-id', (d: any) => getNodeId(d.source))
      .attr('data-target-node-id', (d: any) => getNodeId(d.target))
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

    /*
     * One movement authority. When the compiled render plan carries authored
     * trajectories and the production overlay is active, the plan draws every
     * trajectory instance and the legacy one-source/one-target movement
     * adapter is gated off — it stays only as a lossless compatibility path
     * for derivations that author no trajectory relations at all, and it
     * never independently reclassifies movement.
     */
    const planOwnsTrajectories = !disableRelationOverlay
      && Boolean(relationRenderPlan?.frames.some((planFrame) =>
        planFrame.items.some((planItem) => planItem.kind === 'trajectory')));
    if (movementArrows.length > 0 && !planOwnsTrajectories) {
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
      .attr('data-node-group-id', (d) => getNodeId(d))
      .attr('transform', (d) => `translate(${d.x},${d.y})`)
      .attr('data-step', (d) => String(getRevealStepForNodeId(getNodeId(d))))
      .attr('opacity', (d) => {
        const step = getRevealStepForNodeId(getNodeId(d));
        return step <= effectiveRevealThreshold ? 1 : 0;
      })
      .style('transition', 'opacity 260ms ease');

    // Wordless categories keep category geometry, even when authored silent.
    const categories = nodeGroups.filter((d) =>
      (Boolean(d.children) && d.children.length > 0) || shouldExpandPreterminalLeaf(d.data)
        || isWordlessCategoryLeaf(d.data)
    );
    const categoryInk = (d: HierNode) =>
      isWordlessCategoryLeaf(d.data) && isReplaySilentTerminalLeaf(d) ? SILENT_SAGE : PURE_WHITE;
    categories.append('text')
      .attr('class', 'category-label')
      .attr('data-category-node-id', (d) => getNodeId(d))
      .attr('y', -10)
      .attr('text-anchor', 'middle')
      .attr('font-size', '42px') // Slightly reduced to balance visuals
      .attr('font-weight', '900')
      .attr('fill', categoryInk)
      .style('fill', categoryInk, 'important')
      .style('font-style', 'normal')
      .style('font-family', 'Quicksand, sans-serif')
      .style('paint-order', 'stroke')
      .style('stroke', '#020806')
      .style('stroke-width', '10px')
      .text(d => d.data.label);

    // 4. TERMINAL WORDS (Leaf Nodes) - ABSOLUTE EMERALD
    const leafNodes = nodeGroups.filter(d => (!d.children || d.children.length === 0)
      && !isWordlessCategoryLeaf(d.data));
    const visibleOvertLeafIds = collectPronouncedLeafNodeIdsInOrder(clonedCanvasData);
    const maybeCapitalizeSurfacedSentenceInitialLeaf = (node: HierNode, value: string): string => {
      const trimmed = String(value || '').trim();
      if (!trimmed || isTraceLike(trimmed) || isNullLike(trimmed)) return trimmed;
      if (normalizeToken(trimmed) !== normalizeToken(firstSentenceReplayToken)) return trimmed;
      const firstVisibleOvertLeafId = String(visibleOvertLeafIds[0] || '');
      if (!firstVisibleOvertLeafId || getNodeId(node) !== firstVisibleOvertLeafId) return trimmed;
      const nodeAncestorIds = new Set<string>();
      let currentAncestor: HierNode | null = node;
      while (currentAncestor) {
        const ancestorId = getNodeId(currentAncestor);
        if (ancestorId) nodeAncestorIds.add(ancestorId);
        currentAncestor = currentAncestor.parent;
      }
      const surfacedByFrontingMovement = activeDerivationArrowLinks.some((link) => {
        const targetNodeId = String(link?.targetNodeId || '');
        return Boolean(targetNodeId) && nodeAncestorIds.has(targetNodeId);
      });
      const awaitsPhraseFronting = Array.from(nodeAncestorIds).some((nodeId) => (
        pendingPhraseFrontingSourceNodeIds.has(nodeId)
      ));
      if (getReplayTokenIndex(node) !== 0 && !surfacedByFrontingMovement) return trimmed;
      if (!surfacedByFrontingMovement && awaitsPhraseFronting) return trimmed;
      return firstSentenceReplayDisplayToken || (trimmed.charAt(0).toUpperCase() + trimmed.slice(1));
    };
    const getReplayTerminalSurface = (node: HierNode): string => {
      const fallback = resolveLeafSurface(node);
      if (isTraceLike(fallback) || isNullLike(fallback)) return fallback;
      if (!usesDerivationFrames || !animated || isFinalDerivationReplayStep) return fallback;
      const nodeAncestorIds = new Set<string>();
      let currentAncestor: HierNode | null = node;
      while (currentAncestor) {
        const ancestorId = getNodeId(currentAncestor);
        if (ancestorId) nodeAncestorIds.add(ancestorId);
        currentAncestor = currentAncestor.parent;
      }
      const awaitsPhraseFronting = Array.from(nodeAncestorIds).some((nodeId) => (
        pendingPhraseFrontingSourceNodeIds.has(nodeId)
      ));
      const currentPlaybackStep = currentStepIndex >= 0 ? playbackSteps[currentStepIndex] : null;
      if (
        currentPlaybackStep?.operation === 'LexicalSelect' &&
        String(currentPlaybackStep.targetNodeId || '') === getNodeId(node)
      ) {
        const explicitLexicalSurface = String(currentPlaybackStep.sourceLabels?.[0] || '').trim();
        if (explicitLexicalSurface) {
          const shouldForcePreFrontingLowercase =
            normalizeToken(explicitLexicalSurface) === normalizeToken(firstSentenceReplayToken)
            && awaitsPhraseFronting
            && firstFrontingStepIndex > 0
            && currentStepIndex < firstFrontingStepIndex;
          const preFrontingSurface = shouldForcePreFrontingLowercase
            ? explicitLexicalSurface.charAt(0).toLowerCase() + explicitLexicalSurface.slice(1)
            : explicitLexicalSurface;
          return maybeLowercaseSentenceInitialFunctionSurface({
            surface: preFrontingSurface,
            sentenceInitialSurface: firstSentenceReplayToken,
            nodeId: getNodeId(node),
            parentLabel: String(node.parent?.data?.label || '').trim(),
            tokenIndex: getReplayTokenIndex(node),
            visibleOvertLeafIds,
            isWorkspaceForest: clonedCanvasData?.replayOrigin?.kind === 'workspace',
            hasNominalComplement: replayDeterminerHasNominalComplement(node)
          });
        }
      }
      const fallbackParentLabel = activeDerivationFrame
        ? findParentLabelInForest(activeDerivationFrame.workspaceForest || [], getNodeId(node))
        : '';
      const committedParentLabel = findParentLabelInForest([data], getNodeId(node));
      const preFrontingSentenceInitialFunction =
        normalizeToken(fallback) === normalizeToken(firstSentenceReplayToken)
        && awaitsPhraseFronting
        && firstFrontingStepIndex > 0
        && currentStepIndex < firstFrontingStepIndex;
      if (preFrontingSentenceInitialFunction) {
        return fallback.charAt(0).toLowerCase() + fallback.slice(1);
      }
      const surfacedByPhraseMovement = activeDerivationArrowLinks.some((link) => {
        if (isHeadLikeResolvedRelation(link)) return false;
        const targetNodeId = String(link?.targetNodeId || '');
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
        tokenIndex: getReplayTokenIndex(node),
        visibleOvertLeafIds,
        isWorkspaceForest: clonedCanvasData?.replayOrigin?.kind === 'workspace',
        hasNominalComplement: replayDeterminerHasNominalComplement(node)
      });
    };
    function isReplaySilentTerminalLeaf(node: HierNode): boolean {
      if (isPronouncedHierLeaf(node)) return false;
      const surface = resolveLeafSurface(node);
      if (isTraceLike(surface) || isNullLike(surface)) return true;
      return hasSilentOrGhostAncestor(node);
    }
    const getMovementCopyTraceIndex = (d: HierNode): string => {
      const chainIndex = resolveLexicalMovementTraceDisplayIndex(
        d,
        resolveLeafSurface(d),
        resolveTraceIndexFromNodeContext(d, derivationTraceIndexByNodeId)
      );
      if (hasDerivationFrames) return chainIndex;
      const arrowTraceIndex = movedFromCopyTraceIndexByTerminalId.get(getNodeId(d));
      if (arrowTraceIndex) return arrowTraceIndex;
      return '';
    };
    // Every leaf that is not a wordless category is terminal material: a
    // pronounced word, a silent copy, or authored notation.
    const terminals = leafNodes;
    const overtTerminals = terminals.filter((d) => {
      return !isRenderedReplaySilentTerminalLeaf(d);
    });
    const silentTerminals = terminals.filter((d) => {
      return isRenderedReplaySilentTerminalLeaf(d);
    });

    function getReplayRenderedTerminalText(d: HierNode): string {
      const nodeId = getNodeId(d);
      const movedFromCopyTraceIndex = getMovementCopyTraceIndex(d);
      if (movedFromCopyTraceIndex) {
        // Both endpoints keep their authored words and pronunciation.
        return formatIndexedSurfaceForDisplayValue(
          maybeCapitalizeSurfacedSentenceInitialLeaf(d, getReplayTerminalSurface(d)),
          movedFromCopyTraceIndex
        );
      }
      const fallback = maybeCapitalizeSurfacedSentenceInitialLeaf(d, getReplayTerminalSurface(d));
      if ((d.data as any)?.ghost === true) return fallback;
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
        aliasedTraceIndex
      );
      return (isTraceLike(formatted) || isNullLike(formatted))
        ? formatted
        : formatIndexedSurfaceForDisplayValue(
            maybeCapitalizeSurfacedSentenceInitialLeaf(d, formatted),
            resolveTraceIndexFromNodeContext(d, derivationOperatorVariableIndexByNodeId)
          );
    }

    function isRenderedReplaySilentTerminalLeaf(d: HierNode): boolean {
      const rendered = getReplayRenderedTerminalText(d);
      return isReplaySilentTerminalLeaf(d) || isTraceLike(rendered) || isNullLike(rendered);
    }

    const appendTerminalText = (
      selection: d3.Selection<SVGGElement, HierNode, SVGGElement, unknown>,
      fill: string
    ) => selection.append('text')
      .attr('class', 'terminal-label')
      .attr('data-node-id', (d) => getNodeId(d))
      .attr('data-default-label', (d) => maybeCapitalizeSurfacedSentenceInitialLeaf(d, getReplayTerminalSurface(d)))
      .attr('data-trace-index', (d) => {
        const movedFromCopyTraceIndex = getMovementCopyTraceIndex(d);
        if (movedFromCopyTraceIndex) return movedFromCopyTraceIndex;
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

    // Pronounced leaves stay emerald; silent leaves stay muted.
    appendTerminalText(overtTerminals, TARGET_EMERALD);
    appendTerminalText(silentTerminals, SILENT_SAGE);
    g.selectAll<SVGTextElement, HierNode>('.terminal-label')
      .filter((candidate) => (
        !isRenderedReplaySilentTerminalLeaf(candidate)
        && Boolean(resolveTraceIndexFromNodeContext(
          candidate,
          derivationOperatorVariableIndexByNodeId
        ))
      ))
      .classed('babel-renderer-authored-terminal', true)
      .attr('fill', TARGET_EMERALD)
      .style('fill', TARGET_EMERALD, 'important');
    g.selectAll<SVGTextElement, HierNode>('.terminal-label')
      .filter((candidate) => {
        const nodeId = getNodeId(candidate);
        if (getMovementCopyTraceIndex(candidate) && isRenderedReplaySilentTerminalLeaf(candidate)) return true;
        return isTraceLike(getReplayRenderedTerminalText(candidate))
          && !operatorVariableWitnessNodeIds.has(nodeId);
      })
      .classed('babel-moved-from-copy', true);

    // Vertical dashed connection for leaf nodes
    terminals.append('line')
      .attr('x1', 0).attr('y1', 20).attr('x2', 0).attr('y2', 65)
      .attr('stroke', BRANCH_COLOR).attr('stroke-width', 3).attr('stroke-dasharray', '8,8').attr('opacity', 0.6);

    const measureGraphicsElementsInTreeSpace = (
      elements: SVGGraphicsElement[]
    ): { x: number; y: number; width: number; height: number } | null => {
      const treeMatrix = g.node()?.getCTM();
      if (!treeMatrix || elements.length === 0) return null;
      const intoTreeSpace = treeMatrix.inverse();
      const points: DOMPoint[] = [];
      elements.forEach((element) => {
        const elementMatrix = element.getCTM();
        if (!elementMatrix) return;
        const box = element.getBBox();
        if (!box.width && !box.height) return;
        [
          [box.x, box.y],
          [box.x + box.width, box.y],
          [box.x + box.width, box.y + box.height],
          [box.x, box.y + box.height]
        ].forEach(([x, y]) => {
          points.push(
            new DOMPoint(x, y)
              .matrixTransform(elementMatrix)
              .matrixTransform(intoTreeSpace)
          );
        });
      });
      if (points.length === 0) return null;
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      return {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys)
      };
    };

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

    /*
     * Production visual-relations overlay.
     *
     * Semantics were compiled in replay/relations; here the laid-out
     * node positions bind the current frame's plan to primitives and draw
     * them in the shared zoom group. Authored trajectories are drawn from the
     * compiled plan and gate the legacy adapter so nothing draws twice.
     * Ghost-sets only restyle material the model explicitly authored silent. Marker sizes
     * stay screen-stable via per-marker counter-scaling; line strokes use
     * non-scaling strokes.
     */
    // Complete frame-stable overlay bounds, fed into viewport fitting so no
    // generated geometry on any side of the tree is clipped.
    let overlayFitBounds: OverlayBounds | null = null;
    let fitFallbackOverlays: ((fitZoom: number, fittedViewport: Rect) => void) | undefined;
    const deferredAcceptedRelationDraws: Array<() => void> = [];
    const identityForestLightFamilies: Array<{
      occurrencePools: string[][];
      emphasis: 'active' | 'quiet' | null;
      item: RelationPlanItem;
    }> = [];
    if (
      !disableRelationOverlay
      && relationRenderPlan
      && usesDerivationFrames
      && Number.isInteger(activeDerivationFrameIndex)
      && activeDerivationFrameIndex >= 0
      && activeDerivationFrameIndex < relationRenderPlan.frames.length
    ) {
      const overlayNodeById = indexHierarchyNodesByIdAndAliases(
        visibleNodes as d3.HierarchyPointNode<SyntaxNode>[]
      );
      const visibleOverlayIds = new Set(overlayNodeById.keys());
      /*
       * Replay may keep an authored node (a pending Infl/T wrapper, an
       * expanded preterminal) out of the directly rendered set while its
       * display material stays visible. The anchored node's laid-out position
       * is still real geometry, so an anchor resolves whenever its own
       * subtree has visible material; an anchor with nothing visible fails
       * closed.
       */
      const laidOutNodeById = indexHierarchyNodesByIdAndAliases(
        treeData.descendants() as d3.HierarchyPointNode<SyntaxNode>[]
      );
      const resolveOverlayAnchor = (nodeId: string) => {
        const direct = overlayNodeById.get(nodeId);
        if (direct) return direct;
        const laidOut = laidOutNodeById.get(nodeId);
        if (!laidOut) return undefined;
        const hasVisibleMaterial = laidOut.descendants()
          .some((descendant) => visibleOverlayIds.has(getNodeId(descendant as unknown as HierNode)));
        return hasVisibleMaterial ? laidOut : undefined;
      };
      const isDisplayTerminalNode = (candidate: d3.HierarchyPointNode<SyntaxNode>) => {
        if ((candidate.children || []).length > 0) return false;
        const surface = resolveLeafSurface(candidate as unknown as HierNode);
        return isDisplayTerminalSurface(surface);
      };
      /*
       * ONE terminal law for both providers (see
       * resolveUniqueDisplayTerminal): the anchor itself, else exactly one
       * display terminal in the exact subtree; zero or several fail closed —
       * an ambiguous anchor is recorded as a structured diagnostic, never
       * resolved by traversal order or current visibility.
       */
      const terminalAmbiguities = new Map<string, number>();
      const resolveMaterializedTerminal = (
        anchor: d3.HierarchyPointNode<SyntaxNode> | undefined,
        anchorNodeId: string
      ) => {
        if (!anchor) return undefined;
        const resolution = resolveUniqueDisplayTerminal(
          anchor,
          (candidate) => candidate.children || [],
          isDisplayTerminalNode
        );
        if (resolution.terminal) return resolution.terminal;
        if (resolution.reason === 'ambiguous') {
          terminalAmbiguities.set(anchorNodeId, resolution.count);
        }
        return undefined;
      };
      const markPreterminalLensNode = (nodeId: string, role: string) => {
        const anchor = resolveOverlayAnchor(nodeId);
        const children = anchor?.children || [];
        if (children.length !== 1 || !isDisplayTerminalNode(children[0])) return;
        const terminalId = getNodeId(children[0] as unknown as HierNode);
        g.selectAll<SVGTextElement, HierNode>('.terminal-label')
          .filter(function exactPreterminal(candidate) {
            return getNodeId(candidate) === terminalId
              || this.getAttribute('data-node-id') === terminalId;
          })
          .classed('babel-lens-node', true)
          .attr('data-lens-role', role)
          .each(function markProductionLensOwner() {
            (this as SVGTextElement & { __babelProductionLens?: true }).__babelProductionLens = true;
              });
      };
      const markSubtreeLensNodes = (nodeId: string, role: string) => {
        const anchor = resolveOverlayAnchor(nodeId);
        if (!anchor) return;
        const terminalIds = new Set(
          anchor.descendants()
            .filter((candidate) => (candidate.children || []).length === 0)
            .map((candidate) => getNodeId(candidate as unknown as HierNode))
        );
        g.selectAll<SVGTextElement, HierNode>('.terminal-label')
          .filter((candidate) => terminalIds.has(getNodeId(candidate)))
          .classed('babel-lens-node', true)
          .attr('data-lens-role', role)
          .each(function markProductionLensOwner() {
            (this as SVGTextElement & { __babelProductionLens?: true }).__babelProductionLens = true;
          });
      };
      const markIdentityLensOccurrences = (nodeIds: string[]) => {
        nodeIds.forEach((nodeId) => {
          const anchor = resolveOverlayAnchor(nodeId);
          if (!anchor) return;
          const terminalIds = new Set(
            anchor.descendants()
              .filter((candidate) => (candidate.children || []).length === 0)
              .map((candidate) => getNodeId(candidate as unknown as HierNode))
          );
          g.selectAll<SVGTextElement, HierNode>('.terminal-label')
            .filter((candidate) => terminalIds.has(getNodeId(candidate)))
            .each(function markIdentityOccurrence(candidate) {
              const rendered = String(this.textContent || '').trim();
              const trace = isDisplayTraceLabel(rendered);
              if ((candidate.data as SyntaxNode).silent === true && !trace) return;
              const label = d3.select(this)
                .classed('babel-lens-node', true)
                .attr('data-lens-role', trace ? 'trace' : 'pronounced');
              if (trace) label.classed('babel-moved-from-copy', false);
              (this as SVGTextElement & { __babelProductionLens?: true }).__babelProductionLens = true;
            });
        });
      };
      const clearMovedCopyClassForAnchors = (nodeIds: string[]) => {
        const terminalIds = new Set<string>();
        nodeIds.forEach((nodeId) => {
          const anchor = resolveOverlayAnchor(nodeId);
          anchor?.descendants()
            .filter((candidate) => (candidate.children || []).length === 0)
            .forEach((candidate) => terminalIds.add(
              getNodeId(candidate as unknown as HierNode)
            ));
        });
        g.selectAll<SVGTextElement, HierNode>('.terminal-label')
          .filter((candidate) => terminalIds.has(getNodeId(candidate)))
          .classed('babel-moved-from-copy', false);
      };
      const measuredShellBottom = (
        nodeId: string,
        fallback: d3.HierarchyPointNode<SyntaxNode>
      ): { x: number; y: number } => {
        const categoryLabel = g.selectAll<SVGTextElement, HierNode>('.category-label')
          .filter((candidate) => getNodeId(candidate) === nodeId)
          .node();
        const space = g.node();
        const matrix = space?.getScreenCTM();
        if (categoryLabel && matrix) {
          const rect = categoryLabel.getBoundingClientRect();
          if (rect.width || rect.height) {
            const point = new DOMPoint(rect.left + rect.width / 2, rect.bottom)
              .matrixTransform(matrix.inverse());
            return { x: point.x, y: point.y + 6 };
          }
        }
        return { x: fallback.x, y: fallback.y + 6 };
      };
      const measuredShellTop = (
        nodeId: string,
        fallback: d3.HierarchyPointNode<SyntaxNode>
      ): { x: number; y: number } => {
        const categoryLabel = g.selectAll<SVGTextElement, HierNode>('.category-label')
          .filter((candidate) => getNodeId(candidate) === nodeId)
          .node();
        const space = g.node();
        const matrix = space?.getScreenCTM();
        if (categoryLabel && matrix) {
          const rect = categoryLabel.getBoundingClientRect();
          if (rect.width || rect.height) {
            const point = new DOMPoint(rect.left + rect.width / 2, rect.top)
              .matrixTransform(matrix.inverse());
            return { x: point.x, y: point.y - 8 };
          }
        }
        return { x: fallback.x, y: fallback.y - 8 };
      };
      const measuredTerminalBottom = (
        terminal: d3.HierarchyPointNode<SyntaxNode>
      ): { x: number; y: number } => {
        const terminalId = getNodeId(terminal as unknown as HierNode);
        const terminalLabel = g.selectAll<SVGTextElement, HierNode>('.terminal-label')
          .filter(function exactTerminal(candidate) {
            return getNodeId(candidate) === terminalId
              || this.getAttribute('data-node-id') === terminalId;
          })
          .node();
        const space = g.node();
        const matrix = space?.getScreenCTM();
        if (terminalLabel && matrix) {
          const rect = terminalLabel.getBoundingClientRect();
          if (rect.width || rect.height) {
            const point = new DOMPoint(rect.left + rect.width / 2, rect.bottom)
              .matrixTransform(matrix.inverse());
            return { x: point.x, y: point.y + 6 };
          }
        }
        return { x: terminal.x, y: terminal.y + 140 };
      };
      const measuredTreeTextTopY = (): number => {
        const space = g.node();
        const matrix = space?.getScreenCTM();
        if (!matrix) return -90;
        const inverse = matrix.inverse();
        const tops = g.selectAll<SVGTextElement, HierNode>('.category-label, .terminal-label')
          .nodes()
          .map((label) => label.getBoundingClientRect())
          .filter((rect) => rect.width || rect.height)
          .map((rect) => new DOMPoint(rect.left, rect.top).matrixTransform(inverse).y);
        return d3.min(tops) ?? -90;
      };
      /*
       * Replay-step timing: a same-stage relation's marks appear only once
       * its own Replay relation moment has played. Structural microsteps
       * before that moment show persisted earlier-stage marks only. The
       * committed (non-animated) view shows the complete frame.
       */
      /*
       * Reveal and focus by EXACT played identity, never by count: playback
       * may place relation moments around structural construction in a
       * different order than the authored relation array, so each relation
       * step carries its authored {stageIndex, relationIndex} and the plan
       * items are matched against exactly those.
       */
      /*
       * ONE STABLE ALLOCATION PER FRAME. Geometry is bound once from the
       * COMPLETE derivation frame layout — every item, every lane, every
       * stack, every rail — so nothing about an already-visible mark ever
       * jumps as later structural nodes or relation moments appear.
       * Reveal/focus below then draws only the marks whose exact relation
       * moments have played and whose syntax witnesses are visible; hidden
       * future marks RESERVE geometry but are never drawn.
       */
      const frameLayoutById = indexHierarchyNodesByIdAndAliases(
        (derivationFrameFitNodes ?? treeData.descendants()) as d3.HierarchyPointNode<SyntaxNode>[]
      );
      const framePositionFor: PlanPositionProvider = (nodeId, attachment = 'position') => {
        const anchor = frameLayoutById.get(String(nodeId || ''));
        if (!anchor) return null;
        if (attachment === 'terminal') {
          // The exact same pure law as the step-visible provider, so the
          // two can never disagree about an endpoint.
          const terminal = resolveMaterializedTerminal(anchor, String(nodeId || ''));
          return terminal ? measuredTerminalBottom(terminal) : null;
        }
        if (attachment === 'parent') {
          const parent = anchor.parent;
          return parent ? { x: parent.x, y: parent.y } : null;
        }
        if (attachment === 'shell-top') {
          return measuredShellTop(String(nodeId || ''), anchor);
        }
        if (attachment === 'shell-bottom') {
          return measuredShellBottom(String(nodeId || ''), anchor);
        }
        return { x: anchor.x, y: anchor.y };
      };
      const hasFallback = relationRenderPlan.frames[activeDerivationFrameIndex]?.items.some(item => item.kind === 'fallback');
      // Measure the complete stage, including unrevealed labels, in tree coordinates.
      // These invisible measurement texts never enter the syntax or camera bounds.
      const fallbackLabelRects = new Map<string, { x: number; y: number; width: number; height: number }>();
      const fallbackMeasure = g.append('g').attr('visibility', 'hidden').attr('aria-hidden', 'true');
      const fallbackTextMetrics = new Map<string, DOMRect>();
      const categorySample = g.select<SVGTextElement>('.category-label').node();
      const terminalSample = g.select<SVGTextElement>('.terminal-label').node();
      if (hasFallback) new Set(frameLayoutById.values()).forEach(node => {
        if (isSyntheticWorkspaceRootNode(node) || isUnderTriangulation(node)) return;
        const category = Boolean(node.children?.length) || shouldExpandPreterminalLeaf(node.data) || isWordlessCategoryLeaf(node.data);
        const label = category ? node.data.label : getReplayRenderedTerminalText(node as unknown as HierNode);
        const metricKey = JSON.stringify([category, label]);
        let rect = fallbackTextMetrics.get(metricKey);
        if (!rect) {
          const sample = category ? categorySample : terminalSample;
          const text = sample?.cloneNode(false) as SVGTextElement | undefined
            ?? document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.removeAttribute('class');
          text.removeAttribute('id');
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('y', category ? '-10' : '115');
          text.setAttribute('font-size', category ? '42' : '56');
          text.setAttribute('font-weight', '900');
          text.style.fontFamily = 'Quicksand, sans-serif';
          text.style.fontStyle = category ? 'normal' : 'italic';
          text.textContent = label;
          fallbackMeasure.node()?.appendChild(text);
          rect = text.getBBox();
          fallbackTextMetrics.set(metricKey, rect);
          text.remove();
        }
        if (rect.width || rect.height) fallbackLabelRects.set(getNodeId(node as unknown as HierNode), {
          x: node.x + rect.x, y: node.y + rect.y, width: rect.width, height: rect.height
        });
      });
      fallbackMeasure.remove();
      const fallbackRectFor = (nodeId: string, subtree = false) => {
        const anchor = frameLayoutById.get(nodeId);
        if (!anchor) return null;
        const rects = (subtree ? anchor.descendants() : [anchor]).flatMap(node => {
          const rect = fallbackLabelRects.get(getNodeId(node as unknown as HierNode));
          return rect ? [rect] : [];
        });
        if (!rects.length) return null;
        const x = Math.min(...rects.map(rect => rect.x));
        const y = Math.min(...rects.map(rect => rect.y));
        return { x, y, width: Math.max(...rects.map(rect => rect.x + rect.width)) - x,
          height: Math.max(...rects.map(rect => rect.y + rect.height)) - y };
      };
      const fallbackMeasurements = {
        labels: [...fallbackLabelRects.values()],
        labelFor: (id: string) => fallbackRectFor(id),
        subtreeFor: (id: string) => fallbackRectFor(id, true),
        bottom: Math.max(0, ...[...fallbackLabelRects.values()].map(rect => rect.y + rect.height))
      };
      const frameItems = (relationRenderPlan.frames[activeDerivationFrameIndex]?.items ?? []).map((item) =>
        resolveDisplayedTrajectoryAttachments(item, (nodeId) => overlayNodeById.get(nodeId)?.data));
      const displayedRelationPlan = {
        ...relationRenderPlan,
        frames: relationRenderPlan.frames.map((frame, index) => index === activeDerivationFrameIndex
          ? { ...frame, items: frameItems } : frame)
      };
      const zoomK = svgRef.current ? (d3.zoomTransform(svgRef.current).k || 1) : 1;
      // Screen-stable marker sizing, capped so far-out zoom never lets the
      // markers dwarf the tree they annotate.
      const markerScale = Math.min(1 / zoomK, 3);
      const badgeGap = 46;
      const frameMaxNodeY = d3.max([...frameLayoutById.values()], (frameNode) => frameNode.y) ?? 0;
      // Share the exact displayed-notation decision between slot allocation and painting.
      const hasExistingGapNotation = (nodeId: string, text: string): boolean => Boolean(
        g.selectAll<SVGTextElement, HierNode>('.category-label, .terminal-label')
          .filter(function exactGapOccurrence() {
            return labelBelongsToNode(this, nodeId);
          })
          .filter(function sameGapNotation() {
            if (!text) return false;
            if (this.textContent === text) return true;
            if (this.getAttribute('data-default-label') !== text) return false;
            const index = this.getAttribute('data-trace-index');
            const formatted = isTraceLike(text)
              ? formatAuthoredWitnessSurface(text, index)
              : formatIndexedSurfaceForDisplayValue(text, index);
            return this.textContent === formatted;
          })
          .node()
      );
      const boundFrame = withPlaqueTextMeasure(svg, measurePlaqueText => bindRelationPlanFrame(
        displayedRelationPlan,
        activeDerivationFrameIndex,
        framePositionFor,
        {
          labelWidth: 150,
          labelHeight: 70,
          badgeGap,
          laneGap: 60,
          markerScale,
          hasExistingGapNotation,
          plaqueTextLayout: { measureText: measurePlaqueText },
          fallbackMeasurements,
          trajectoryCeilingY: measuredTreeTextTopY() - 90,
          trajectoryFloorY: frameMaxNodeY + 180,
          // Frame-stable measured baselines: connector lanes just below the
          // complete frame's terminal row; rails placed by the binder's one
          // vertical allocation law beneath the deepest allocated lane.
          connectorBaselineY: frameMaxNodeY + 130,
          railBaseY: frameMaxNodeY + 240
        }
      ));
      const fallbackConnectorPaths = new Map<BoundSegment, d3.Selection<SVGGElement, unknown, null, undefined>>();
      const fallbackMarkGroups = new Map<BoundPrimitive, d3.Selection<SVGGElement, unknown, null, undefined>>();
      const fallbackRailGroups = new Map<BoundAnchorSetRail, d3.Selection<SVGGElement, unknown, null, undefined>>();
      fitFallbackOverlays = (fitZoom, fittedViewport) => {
        const scale = fallbackMarkerScale(fitZoom, fallbackMeasurements.labels.map(rect => rect.height));
        const anchorScale = Math.min(1 / fitZoom, 3);
        fitFallbackGeometry(boundFrame, {
          markerScale, fittedMarkerScale: scale, fittedAnchorScale: anchorScale, badgeGap, laneGap: 60, fallbackMeasurements,
          railBaseY: frameMaxNodeY + 240, fittedViewport
        }).forEach((fitted, original) => {
          if (original.type === 'fallback-mark' && fitted.type === 'fallback-mark') {
            fallbackMarkGroups.get(original)?.attr('transform', `translate(${fitted.x},${fitted.y}) scale(${scale})`);
          } else if (original.type === 'segment' && fitted.type === 'segment') {
            const group = fallbackConnectorPaths.get(original);
            group?.selectAll('path').attr('d', fitted.d);
            group?.select('.vr-fallback-segment').attr('stroke-width', (original.route === 'direct' ? 1.5 : 1.9) * scale);
            group?.select('.vr-fallback-shadow').attr('stroke-width', (original.route === 'direct' ? 3.6 : 4.4) * scale);
          } else if (original.type === 'anchor-set-rail' && fitted.type === 'anchor-set-rail') {
            const paths = anchorSetRailPaths(fitted, anchorScale, scale);
            const group = fallbackRailGroups.get(original);
            group?.select('.babel-anchor-set-rail').attr('d', paths.rail);
            group?.select('.babel-anchor-set-stub').attr('d', paths.joins);
          }
        });
      };
      const revealedItemIndices = new Set<number>();
      frameItems.forEach((planItem, planItemIndex) => {
        const superseded = playedRelationIndices === null
          ? Boolean(planItem.supersededAt)
          : Boolean(
              planItem.supersededAt?.stageIndex === activeDerivationFrameIndex
              && playedRelationIndices.has(planItem.supersededAt.relationIndex)
            );
        if (superseded) return;
        const revealed = playedRelationIndices === null
          || planItem.appearsAtStage < activeDerivationFrameIndex
          || planItemRelationRefs(planItem).some((ref) =>
            ref.stageIndex === activeDerivationFrameIndex
            && playedRelationIndices.has(ref.relationIndex));
        if (revealed) revealedItemIndices.add(planItemIndex);
      });
      const witnessVisibilityCache = new Map<number, boolean>();
      const itemWitnessesVisible = (planItemIndex: number): boolean => {
        const cached = witnessVisibilityCache.get(planItemIndex);
        if (cached !== undefined) return cached;
        const planItem = frameItems[planItemIndex];
        // A mark never draws on hidden syntax: every node id it depends on
        // must currently resolve against visible structure.
        const visible = Boolean(planItem)
          && planItemDependencyNodeIds(planItem).every((nodeId) => Boolean(resolveOverlayAnchor(nodeId)));
        witnessVisibilityCache.set(planItemIndex, visible);
        return visible;
      };
      const primitiveWitnessesVisible = (primitive: BoundPrimitive): boolean => {
        // Neutral participation is independent; a connector still needs both endpoints.
        if (frameItems[primitive.itemIndex]?.kind === 'fallback') {
          if (primitive.type === 'fallback-mark') return Boolean(resolveOverlayAnchor(primitive.nodeId));
          if (primitive.type === 'segment') {
            return primitive.witnessNodeIds.every(nodeId => Boolean(resolveOverlayAnchor(nodeId)));
          }
        }
        return itemWitnessesVisible(primitive.itemIndex);
      };
      const overlay = g.append('g').attr('class', 'vr-overlay-layer');
      // Fail-closed marks are diagnosable, never silent: the layer carries
      // which anchored nodes could not be measured.
      overlay.attr(
        'data-vr-failed',
        boundFrame.failed.map((failure) => failure.nodeId).join(' ')
      );
      // Structured ambiguity diagnostics: anchors whose subtrees held more
      // than one display terminal; their marks failed closed, never guessed.
      overlay.attr(
        'data-vr-terminal-ambiguity',
        [...terminalAmbiguities.entries()]
          .map(([ambiguousNodeId, terminalCount]) => `${ambiguousNodeId}:${terminalCount}`)
          .join(' ')
      );
      const overlayDefs = overlay.append('defs');
      overlayDefs.append('marker')
        .attr('id', 'vr-overlay-arrowhead')
        .attr('viewBox', '0 0 10 10')
        .attr('refX', 9)
        .attr('refY', 5)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto-start-reverse')
        .append('path')
        .attr('d', 'M 0 0 L 10 5 L 0 10 z')
        .attr('fill', '#34d399');
      /*
       * Every primitive draws inside its own host group so the Replay
       * relation lens can emphasize or quiet the WHOLE mark uniformly:
       * during a relation moment the played relation's marks are prominent
       * and every other visible mark stays present but quieter. Emphasis
       * changes nothing about the linguistic claims or persistence.
       */
      let primitiveHost: d3.Selection<SVGGElement, unknown, null, undefined> = overlay;
      const ghostLensRequests: Array<{
        nodeIds: string[];
        siteNodeIds: string[];
        antecedentNodeIds: string[];
        emphasis: 'active' | 'quiet' | null;
        acceptedEllipsisStyle: boolean;
        item: RelationPlanItem;
      }> = [];
      const appendMarker = (markX: number, markY: number, treeNotation = false, stackIndex = 0) => primitiveHost.append('g')
        .attr('class', treeNotation ? 'vr-tree-notation' : 'vr-overlay-marker')
        .attr('data-vr-x', String(markX - (treeNotation ? stackIndex * badgeGap * markerScale : 0)))
        .attr('data-vr-y', String(markY))
        .attr('data-vr-stack-offset', treeNotation ? String(stackIndex * badgeGap) : null)
        .attr('transform', `translate(${markX},${markY}) scale(${markerScale})`);
      /*
       * Complete, frame-stable overlay bounds (all four sides, glyph and
       * label extents included) from the FULL allocation — the camera fits
       * once per frame and never re-fits when a relation is revealed.
       * Nominal marker scale keeps the bounds zoom-independent.
       */
      overlayFitBounds = acceptedCompositionIsTreeFirst
        ? null
        : boundOverlayBounds({ ...boundFrame,
            primitives: boundFrame.primitives.filter(primitive => primitive.type !== 'plaque') }, { markerScale: 1 });
      if (!acceptedCompositionIsTreeFirst) replayPlaqueLayout.forEach(rect => {
        const bounds = { minX: rect.x - 24, minY: rect.y - 24,
          maxX: rect.x + rect.width + 24, maxY: rect.y + rect.height + 24 };
        overlayFitBounds = overlayFitBounds ? {
          minX: Math.min(overlayFitBounds.minX, bounds.minX), minY: Math.min(overlayFitBounds.minY, bounds.minY),
          maxX: Math.max(overlayFitBounds.maxX, bounds.maxX), maxY: Math.max(overlayFitBounds.maxY, bounds.maxY)
        } : bounds;
      });

      const fitDeferredOverlayToCompactViewport = (layer: SVGGElement, inset = 12) => {
        if (containerWidth >= 500) return;
        const svgNode = svg.node();
        const parent = layer.parentElement;
        const parentMatrix = parent instanceof SVGGraphicsElement ? parent.getScreenCTM() : null;
        if (!svgNode || !parentMatrix) return;
        const viewport = svgNode.getBoundingClientRect();
        const availableWidth = Math.max(1, viewport.width - inset * 2);
        const availableHeight = Math.max(1, viewport.height - inset * 2);
        const initialRect = layer.getBoundingClientRect();
        if (initialRect.width <= 0 || initialRect.height <= 0) return;

        const fitScale = Math.min(
          1,
          availableWidth / initialRect.width,
          availableHeight / initialRect.height
        );
        const bounds = layer.getBBox();
        const pivotX = bounds.x + bounds.width / 2;
        const pivotY = bounds.y + bounds.height / 2;
        const scaleTransform = fitScale < 0.999
          ? `translate(${pivotX} ${pivotY}) scale(${fitScale}) translate(${-pivotX} ${-pivotY})`
          : '';
        layer.setAttribute('transform', scaleTransform);

        const fittedRect = layer.getBoundingClientRect();
        const left = viewport.left + inset;
        const right = viewport.right - inset;
        const top = viewport.top + inset;
        const bottom = viewport.bottom - inset;
        const screenDx = fittedRect.left < left
          ? left - fittedRect.left
          : fittedRect.right > right
            ? right - fittedRect.right
            : 0;
        const screenDy = fittedRect.top < top
          ? top - fittedRect.top
          : fittedRect.bottom > bottom
            ? bottom - fittedRect.bottom
            : 0;
        if (screenDx === 0 && screenDy === 0) return;

        const inverse = parentMatrix.inverse();
        const origin = new DOMPoint(0, 0).matrixTransform(inverse);
        const shifted = new DOMPoint(screenDx, screenDy).matrixTransform(inverse);
        const translateTransform = `translate(${shifted.x - origin.x} ${shifted.y - origin.y})`;
        layer.setAttribute('transform', `${translateTransform} ${scaleTransform}`.trim());
      };

      const measuredTerminalSubtreeRectNow = (nodeId: string) => {
        const anchor = overlayNodeById.get(nodeId);
        if (!anchor) return null;
        const subtreeIds = new Set(
          anchor.descendants().map((candidate) => getNodeId(candidate as unknown as HierNode))
        );
        const labels = g.selectAll<SVGTextElement, HierNode>('.terminal-label')
          .filter((candidate) => subtreeIds.has(getNodeId(candidate)))
          .nodes();
        return measureGraphicsElementsInTreeSpace(labels);
      };
      const measuredTreeLabelRectNow = (nodeId: string, subtree: boolean) => {
        const anchor = overlayNodeById.get(nodeId);
        if (!anchor) return null;
        const nodeIds = new Set(
          (subtree ? anchor.descendants() : [anchor])
            .map((candidate) => getNodeId(candidate as unknown as HierNode))
        );
        const labels = g.selectAll<SVGTextElement, HierNode>(
          subtree ? '.category-label, .terminal-label' : '.category-label'
        )
          .filter((candidate) => nodeIds.has(getNodeId(candidate)))
          .nodes();
        return measureGraphicsElementsInTreeSpace(labels);
      };
      const exactScreenTreeLabelRectNow = (nodeId: string, subtree: boolean) => {
        const anchor = subtree ? overlayNodeById.get(nodeId) : null;
        const nodeIds = new Set([
          nodeId,
          ...(anchor
            ? anchor.descendants().map((candidate) => getNodeId(candidate as unknown as HierNode))
            : [])
        ]);
        const labels = g.selectAll<SVGTextElement, HierNode>(
          subtree ? '.category-label, .terminal-label' : '.category-label'
        )
          .filter(function exactAuthoredNodeLabel() {
            return [...nodeIds].some((candidateId) =>
              labelBelongsToNode(this, candidateId));
          })
          .nodes();
        const matrix = g.node()?.getScreenCTM();
        if (!matrix || labels.length === 0) return null;
        const inverse = matrix.inverse();
        const points: DOMPoint[] = [];
        labels.forEach((label) => {
          const rect = label.getBoundingClientRect();
          if (!rect.width && !rect.height) return;
          [
            [rect.left, rect.top],
            [rect.right, rect.top],
            [rect.right, rect.bottom],
            [rect.left, rect.bottom]
          ].forEach(([x, y]) => {
            points.push(new DOMPoint(x, y).matrixTransform(inverse));
          });
        });
        if (points.length === 0) return null;
        const xs = points.map((point) => point.x);
        const ys = points.map((point) => point.y);
        return {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys)
        };
      };
      const exactScreenDirectTreeLabelRectNow = (nodeId: string) => {
        const labels = g.selectAll<SVGTextElement, HierNode>('.category-label, .terminal-label')
          .filter(function exactAuthoredDirectNodeLabel() {
            return labelBelongsToNode(this, String(nodeId));
          })
          .nodes();
        const matrix = g.node()?.getScreenCTM();
        if (!matrix || labels.length === 0) return null;
        const inverse = matrix.inverse();
        const points: DOMPoint[] = [];
        labels.forEach((label) => {
          const rect = label.getBoundingClientRect();
          if (!rect.width && !rect.height) return;
          [
            [rect.left, rect.top],
            [rect.right, rect.top],
            [rect.right, rect.bottom],
            [rect.left, rect.bottom]
          ].forEach(([x, y]) => {
            points.push(new DOMPoint(x, y).matrixTransform(inverse));
          });
        });
        if (points.length === 0) return null;
        const xs = points.map((point) => point.x);
        const ys = points.map((point) => point.y);
        return {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys)
        };
      };
      const exactScreenTreeLabelRectForNodeIdsNow = (nodeIds: string[]) => {
        const expandedNodeIds = new Set<string>();
        nodeIds.forEach((nodeId) => {
          expandedNodeIds.add(nodeId);
          overlayNodeById.get(nodeId)?.descendants().forEach((candidate) => {
            expandedNodeIds.add(getNodeId(candidate as unknown as HierNode));
          });
        });
        const labels = g.selectAll<SVGTextElement, HierNode>('.category-label, .terminal-label')
          .filter(function exactAuthoredSubtrees() {
            return [...expandedNodeIds].some((candidateId) =>
              labelBelongsToNode(this, candidateId));
          })
          .nodes();
        const matrix = g.node()?.getScreenCTM();
        if (!matrix || labels.length === 0) return null;
        const inverse = matrix.inverse();
        const points = labels.flatMap((label) => {
          const rect = label.getBoundingClientRect();
          if (!rect.width && !rect.height) return [];
          return [
            new DOMPoint(rect.left, rect.top).matrixTransform(inverse),
            new DOMPoint(rect.right, rect.top).matrixTransform(inverse),
            new DOMPoint(rect.right, rect.bottom).matrixTransform(inverse),
            new DOMPoint(rect.left, rect.bottom).matrixTransform(inverse)
          ];
        });
        if (points.length === 0) return null;
        const xs = points.map((point) => point.x);
        const ys = points.map((point) => point.y);
        return {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys)
        };
      };
      let trajectoryRelationLayer: AcceptedRelationLayer | null = null;
      const trajectoryMarkerIds = {
        open: `babel-trajectory-arrow-${activeDerivationFrameIndex}`,
        movement: `babel-production-arrow-${activeDerivationFrameIndex}`,
        carrier: `babel-carrier-arrow-${activeDerivationFrameIndex}`
      };
      type AcceptedRelationLayer = d3.Selection<SVGGElement, unknown, null, undefined>;
      const pairMergeLayers = new Map<string, AcceptedRelationLayer>();
      const controlRelationLayers = new Map<string, AcceptedRelationLayer>();
      const bindingRelationLayers = new Map<string, AcceptedRelationLayer>();
      const coindexRelationLayers = new Map<string, AcceptedRelationLayer>();
      const operatorVariableBindingLayers = new Map<string, AcceptedRelationLayer>();
      const predicationRelationLayers = new Map<string, AcceptedRelationLayer>();
      let featureRelationLayer: AcceptedRelationLayer | null = null;
      let agreementCaseRelationLayer: AcceptedRelationLayer | null = null;
      let domainLocalityBackgroundLayer: AcceptedRelationLayer | null = null;
      let domainLocalityForegroundLayer: AcceptedRelationLayer | null = null;
      const blockedExtractionLayers = new Map<string, AcceptedRelationLayer>();
      const idiomChunkLayers = new Map<string, AcceptedRelationLayer>();
      const parasiticGapIslandLayers = new Map<string, AcceptedRelationLayer>();
      const parasiticGapCoindexLayers = new Map<string, AcceptedRelationLayer>();
      const relationLayerKey = (item: RelationPlanItem) =>
        `${item.relationRef.stageIndex}:${item.relationRef.relationIndex}`;
      // Companion pieces share a draw; independent families within one relation do not.
      const acceptedRelationDrawingKey = (item: RelationPlanItem) =>
        JSON.stringify([relationLayerKey(item), item.familyId]);
      const decorateRelationElement = (
        element: SVGElement,
        item: RelationPlanItem,
        emphasis: 'active' | 'quiet' | null
      ) => {
        element.classList.add('vr-item');
        element.setAttribute('data-vr-stage-index', String(item.relationRef.stageIndex));
        element.setAttribute('data-vr-relation-index', String(item.relationRef.relationIndex));
        element.setAttribute(
          'data-vr-owner-refs',
          planItemRelationRefs(item)
            .map((ref) => `${ref.stageIndex}:${ref.relationIndex}`)
            .join(' ')
        );
        element.setAttribute('data-vr-emphasis', emphasis ?? 'none');
        element.classList.toggle('vr-relation-active', emphasis === 'active');
        return element;
      };
      const queueAcceptedRelationDraw = (
        item: RelationPlanItem,
        emphasis: 'active' | 'quiet' | null,
        draw: () => void
      ) => {
        deferredAcceptedRelationDraws.push(() => {
          const before = new Set(g.selectAll<SVGElement, unknown>('*').nodes());
          draw();
          const after = g.selectAll<SVGElement, unknown>('*').nodes();
          const added = new Set(after.filter((element) => !before.has(element)));
          const excludedContainers = new Set([
            'defs',
            'marker',
            'clippath',
            'filter',
            'lineargradient',
            'radialgradient',
            'stop'
          ]);
          const isSharedRelationContainer = (element: SVGElement) => [
            'babel-feature-relation-layer',
            'babel-agreement-case-relation-layer',
            'babel-domain-locality-relation-layer'
          ].some((className) => element.classList.contains(className));
          after.forEach((element) => {
            if (!added.has(element)) return;
            if (excludedContainers.has(element.tagName.toLowerCase())) return;
            if (isSharedRelationContainer(element)) return;
            if (element.hasAttribute('data-vr-stage-index')) return;
            if (
              element.parentElement instanceof SVGElement
              && added.has(element.parentElement)
              && !isSharedRelationContainer(element.parentElement)
            ) return;
            decorateRelationElement(element, item, emphasis);
          });
        });
      };
      const acceptedLayerInHost = (
        layers: Map<string, AcceptedRelationLayer>,
        item: RelationPlanItem,
        className: string,
        host: AcceptedRelationLayer
      ) => {
        const key = relationLayerKey(item);
        const existing = layers.get(key);
        if (existing) return existing;
        const layer = host.append('g').attr('class', className);
        layers.set(key, layer);
        return layer;
      };
      const ensureDomainLocalityLayers = () => {
        if (domainLocalityBackgroundLayer && domainLocalityForegroundLayer) {
          return {
            background: domainLocalityBackgroundLayer,
            foreground: domainLocalityForegroundLayer,
            markerId: domainLocalityForegroundLayer.attr('data-marker-id')
          };
        }
        const background = g.insert('g', ':first-child')
          .attr('class', 'babel-domain-locality-relation-layer');
        const foreground = g.append('g')
          .attr('class', 'babel-domain-locality-relation-layer');
        const markerId = `babel-domain-locality-arrow-${activeDerivationFrameIndex}`;
        foreground.attr('data-marker-id', markerId);
        const marker = foreground.append('defs').append('marker')
          .attr('id', markerId)
          .attr('viewBox', '0 0 10 10')
          .attr('refX', 9)
          .attr('refY', 5)
          .attr('markerWidth', 5)
          .attr('markerHeight', 5)
          .attr('orient', 'auto-start-reverse')
          .attr('markerUnits', 'strokeWidth');
        marker.append('path')
          .attr('class', 'babel-domain-locality-arrowhead')
          .attr('d', 'M 0 0 L 10 5 L 0 10 z');
        domainLocalityBackgroundLayer = background;
        domainLocalityForegroundLayer = foreground;
        return { background, foreground, markerId };
      };
      const acceptedTrajectoryFor = (sourceNodeId: string, targetNodeId: string) =>
        g.selectAll<SVGPathElement, unknown>('.babel-trajectory-path')
          .filter(function matchAcceptedTrajectory() {
            return this.getAttribute('data-trajectory-from') === sourceNodeId
              && this.getAttribute('data-trajectory-to') === targetNodeId;
          })
          .node() || null;
      const pathPointAt = (path: SVGPathElement, fraction: number) => {
        const length = path.getTotalLength();
        const point = path.getPointAtLength(length * fraction);
        return { x: point.x, y: point.y };
      };
      const setAcceptedTrajectoryEmphasis = (
        path: SVGPathElement,
        emphasis: 'active' | 'quiet' | null
      ) => {
        const host = path.parentElement ? d3.select(path.parentElement) : null;
        if (!host) return;
        host.attr('opacity', emphasis === 'quiet' ? 0.3 : null);
      };
      const scheduledAcceptedLocalityRelations = new Set<string>();
      const scheduleAcceptedAntiLocality = (
        item: RelationPlanItem,
        emphasis: 'active' | 'quiet' | null,
        primitive: BoundPrimitive
      ) => {
        if (item.familyId !== 'anti-locality.paths') return false;
        const key = relationLayerKey(item);
        if (!scheduledAcceptedLocalityRelations.has(key)) {
          scheduledAcceptedLocalityRelations.add(key);
          queueAcceptedRelationDraw(item, emphasis, () => {
            const pathItem = frameItems.find((candidate) =>
              candidate.familyId === 'anti-locality.paths'
              && relationLayerKey(candidate) === key
              && candidate.kind === 'directed-path'
              && candidate.pathStyle === 'anti-locality');
            if (!pathItem || pathItem.kind !== 'directed-path') return;
            const movementItem = frameItems.find((candidate) =>
              candidate.kind === 'trajectory'
              && candidate.sourceNodeId === pathItem.fromNodeId
              && candidate.targetNodeId === pathItem.toNodeId);
            let pathNode = movementItem && movementItem.kind === 'trajectory'
              ? acceptedTrajectoryFor(movementItem.sourceNodeId, movementItem.targetNodeId)
              : null;
            if (!pathNode && primitive.type === 'shape-path' && primitive.shapeStyle === 'anti-locality') {
              const { foreground } = ensureDomainLocalityLayers();
              const styleClass = pathItem.outcome === 'blocked'
                ? 'babel-locality-path-failed'
                : 'babel-locality-path-licensed';
              foreground.append('path')
                .attr('class', `babel-trajectory-path-shadow ${styleClass}`)
                .attr('data-trajectory-from', pathItem.fromNodeId)
                .attr('data-trajectory-to', pathItem.toNodeId)
                .attr('d', primitive.d)
                .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
              pathNode = foreground.append('path')
                .attr('class', `babel-trajectory-path ${styleClass}`)
                .attr('data-trajectory-from', pathItem.fromNodeId)
                .attr('data-trajectory-to', pathItem.toNodeId)
                .attr('d', primitive.d)
                .attr('opacity', emphasis === 'quiet' ? 0.3 : null)
                .node();
            }
            if (!pathNode) return;
            const path = d3.select(pathNode);
            const shadowNode = pathNode.previousElementSibling instanceof SVGPathElement
              && pathNode.previousElementSibling.classList.contains('babel-trajectory-path-shadow')
              ? pathNode.previousElementSibling
              : null;
            const outcome = pathItem.outcome;
            if (outcome !== 'blocked' && outcome !== 'licensed') return;
            const styleClass = outcome === 'blocked'
              ? 'babel-locality-path-failed'
              : 'babel-locality-path-licensed';
            path.classed(styleClass, true);
            if (shadowNode) d3.select(shadowNode).classed(styleClass, true);
            setAcceptedTrajectoryEmphasis(pathNode, emphasis);

            let endpoint = pathPointAt(pathNode, 1);
            if (outcome === 'blocked') {
              const landingRect = measuredTreeLabelRectNow(pathItem.toNodeId, false);
              const start = pathPointAt(pathNode, 0);
              const end = {
                x: landingRect
                  ? landingRect.x + landingRect.width / 2
                  : endpoint.x,
                y: endpoint.y
              };
              const depth = Math.max(start.y, end.y)
                + Math.max(180, Math.abs(start.x - end.x) * 0.2);
              const d = [
                `M ${start.x.toFixed(1)} ${start.y.toFixed(1)}`,
                `Q ${end.x.toFixed(1)} ${depth.toFixed(1)}`,
                `${end.x.toFixed(1)} ${end.y.toFixed(1)}`
              ].join(' ');
              path.attr('d', d).attr('marker-end', null);
              if (shadowNode) d3.select(shadowNode).attr('d', d);
              endpoint = end;
            }

            const { background, foreground } = ensureDomainLocalityLayers();
            if (outcome === 'blocked') {
              const cap = [
                `M ${(endpoint.x - 14).toFixed(1)} ${endpoint.y.toFixed(1)}`,
                `L ${(endpoint.x + 14).toFixed(1)} ${endpoint.y.toFixed(1)}`
              ].join(' ');
              foreground.append('path')
                .attr('class', 'babel-anti-locality-cap-shadow')
                .attr('d', cap)
                .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
              foreground.append('path')
                .attr('class', 'babel-anti-locality-cap')
                .attr('d', cap)
                .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
            }
            foreground.append('text')
              .attr('class', 'babel-anti-locality-face')
              .attr('x', (endpoint.x + 28).toFixed(1))
              .attr('y', (endpoint.y + 10).toFixed(1))
              .attr('opacity', emphasis === 'quiet' ? 0.3 : null)
              .text(outcome === 'blocked' ? '☹' : '☺');
            if ((background.node()?.childNodes.length || 0) === 0) {
              background.remove();
              domainLocalityBackgroundLayer = null;
            }
          });
        }
        return true;
      };
      const scheduleAcceptedImproperMovement = (
        item: RelationPlanItem,
        emphasis: 'active' | 'quiet' | null
      ) => {
        if (item.familyId !== 'improper-movement.landing') return false;
        const key = relationLayerKey(item);
        if (!scheduledAcceptedLocalityRelations.has(key)) {
          scheduledAcceptedLocalityRelations.add(key);
          queueAcceptedRelationDraw(item, emphasis, () => {
            const relatedItems = frameItems.filter((candidate) =>
              candidate.familyId === 'improper-movement.landing'
              && relationLayerKey(candidate) === key);
            const domainItem = relatedItems.find((candidate) =>
              candidate.kind === 'domain-mark'
              && candidate.domainStyle === 'forbidden-region');
            const candidatePaths = relatedItems.filter((candidate): candidate is DirectedPathPlanItem =>
              candidate.kind === 'directed-path'
              && ['anti-locality', 'improper-candidate'].includes(candidate.pathStyle)
              && (candidate.outcome === 'licensed' || candidate.outcome === 'blocked'));
            if (!candidatePaths.length) return;
            const sourceNodeId = candidatePaths[0].sourceOccurrenceNodeId || candidatePaths[0].fromNodeId;
            if (candidatePaths.some((path) => (path.sourceOccurrenceNodeId || path.fromNodeId) !== sourceNodeId)) return;
            const unionRects = (
              rects: Array<{ x: number; y: number; width: number; height: number }>
            ) => {
              if (rects.length === 0) return null;
              const left = Math.min(...rects.map((rect) => rect.x));
              const top = Math.min(...rects.map((rect) => rect.y));
              const right = Math.max(...rects.map((rect) => rect.x + rect.width));
              const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
              return { x: left, y: top, width: right - left, height: bottom - top };
            };
            const region = domainItem?.kind === 'domain-mark' ? unionRects(
              domainItem.memberNodeIds
                .map((nodeId) => measuredTreeLabelRectNow(nodeId, true))
                .filter((rect): rect is { x: number; y: number; width: number; height: number } => Boolean(rect))
            ) : null;
            const source = measuredTreeLabelRectNow(sourceNodeId, false)
              || measuredTreeLabelRectNow(sourceNodeId, true);
            if (!source) return;

            const forbiddenBox = region ? {
              x: region.x - 38,
              y: region.y - 32,
              width: region.width + 76,
              height: region.height + 64
            } : null;
            const candidates = candidatePaths.map((path) => ({ nodeId: path.toNodeId, outcome: path.outcome! }))
              .map((candidate) => ({
                ...candidate,
                rect: measuredTreeLabelRectNow(candidate.nodeId, false)
              }))
              .filter((candidate): candidate is {
                nodeId: string;
                outcome: 'licensed' | 'blocked';
                rect: { x: number; y: number; width: number; height: number };
              } => Boolean(candidate.rect));
            if (candidates.length === 0) return;

            const { background, foreground, markerId } = ensureDomainLocalityLayers();
            if (forbiddenBox) {
            const gradientId = `babel-improper-region-gradient-${activeDerivationFrameIndex}-${item.relationRef.relationIndex}`;
            const gradient = background.append('defs').append('linearGradient')
              .attr('id', gradientId)
              .attr('x1', 0)
              .attr('y1', 0)
              .attr('x2', 0)
              .attr('y2', 1);
            gradient.append('stop')
              .attr('offset', '0%')
              .attr('stop-color', 'rgba(16, 185, 129, 0.32)');
            gradient.append('stop')
              .attr('offset', '100%')
              .attr('stop-color', 'rgba(4, 120, 87, 0.10)');
            background.append('rect')
              .attr('class', 'babel-constituent-enclosure babel-enclosure-carrier-chunk babel-improper-forbidden-region')
              .attr('x', forbiddenBox.x.toFixed(1))
              .attr('y', forbiddenBox.y.toFixed(1))
              .attr('width', forbiddenBox.width.toFixed(1))
              .attr('height', forbiddenBox.height.toFixed(1))
              .attr('opacity', emphasis === 'quiet' ? 0.3 : null)
              .style('fill', `url(#${gradientId})`);
            }

            const endpoints = candidates.map((candidate) => ({
              ...candidate,
              point: {
                x: candidate.rect.x + candidate.rect.width / 2,
                y: candidate.rect.y + candidate.rect.height + 18
              }
            }));
            const sourcePoint = {
              x: source.x + source.width / 2,
              y: source.y + source.height + 12
            };
            const laneY = Math.max(
              sourcePoint.y + 68,
              forbiddenBox ? forbiddenBox.y + forbiddenBox.height + 240 : sourcePoint.y,
              ...endpoints.map((entry) => entry.point.y + 170)
            );
            const railLeft = Math.min(...endpoints.map((entry) => entry.point.x));
            background.append('path')
              .attr('class', 'babel-improper-candidate-rail')
              .attr('d', [
                `M ${sourcePoint.x.toFixed(1)} ${sourcePoint.y.toFixed(1)}`,
                `L ${sourcePoint.x.toFixed(1)} ${laneY.toFixed(1)}`,
                `L ${railLeft.toFixed(1)} ${laneY.toFixed(1)}`
              ].join(' '))
              .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
            endpoints.forEach((entry) => {
              background.append('path')
                .attr('class', [
                  'babel-improper-candidate-path',
                  entry.outcome === 'blocked'
                    ? 'babel-improper-candidate-path-blocked'
                    : 'babel-improper-candidate-path-licensed'
                ].join(' '))
                .attr('data-candidate-node', entry.nodeId)
                .attr('data-candidate-outcome', entry.outcome)
                .attr('d', [
                  `M ${entry.point.x.toFixed(1)} ${laneY.toFixed(1)}`,
                  `L ${entry.point.x.toFixed(1)} ${entry.point.y.toFixed(1)}`
                ].join(' '))
                .attr('marker-end', entry.outcome === 'blocked' ? null : `url(#${markerId})`)
                .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
              if (entry.outcome !== 'blocked') return;
              const crossY = forbiddenBox ? forbiddenBox.y + forbiddenBox.height : entry.point.y + 28;
              [
                [-17, -17, 17, 17],
                [17, -17, -17, 17]
              ].forEach(([x1, y1, x2, y2]) => {
                foreground.append('line')
                  .attr('class', 'babel-domain-locality-x-shadow')
                  .attr('x1', (entry.point.x + x1).toFixed(1))
                  .attr('y1', (crossY + y1).toFixed(1))
                  .attr('x2', (entry.point.x + x2).toFixed(1))
                  .attr('y2', (crossY + y2).toFixed(1))
                  .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
                foreground.append('line')
                  .attr('class', 'babel-domain-locality-x')
                  .attr('x1', (entry.point.x + x1).toFixed(1))
                  .attr('y1', (crossY + y1).toFixed(1))
                  .attr('x2', (entry.point.x + x2).toFixed(1))
                  .attr('y2', (crossY + y2).toFixed(1))
                  .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
              });
            });
          });
        }
        return true;
      };
      const scheduledAcceptedSharingRelations = new Set<string>();
      const scheduleAcceptedSharingRelation = (
        item: RelationPlanItem,
        emphasis: 'active' | 'quiet' | null
      ) => {
        if (
          item.familyId !== 'multidominance.shared-node'
          && item.familyId !== 'argument-sharing.domains'
        ) return false;
        const key = relationLayerKey(item);
        const drawingKey = acceptedRelationDrawingKey(item);
        if (!scheduledAcceptedSharingRelations.has(drawingKey)) {
          scheduledAcceptedSharingRelations.add(drawingKey);
          queueAcceptedRelationDraw(item, emphasis, () => {
            const root = g.node();
            if (!root) return;
            const layerNode = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
            const layer = d3.select<SVGGElement, unknown>(layerNode);

            if (item.familyId === 'multidominance.shared-node') {
              root.appendChild(layerNode);
              const sharedItem = frameItems.find((candidate) =>
                candidate.familyId === 'multidominance.shared-node'
                && relationLayerKey(candidate) === key
                && candidate.kind === 'shared-node');
              if (!sharedItem || sharedItem.kind !== 'shared-node') {
                layer.remove();
                return;
              }
              layer.attr('class', 'babel-multidominance-relation-layer');
              const sharedAnchor = overlayNodeById.get(sharedItem.sharedNodeId);
              const sharedIds = new Set(
                sharedAnchor?.descendants().map((candidate) =>
                  getNodeId(candidate as unknown as HierNode)) || [sharedItem.sharedNodeId]
              );
              g.selectAll<SVGTextElement, HierNode>('.category-label, .terminal-label')
                .filter(function sharedSubtreeLabel() {
                  return [...sharedIds].some((nodeId) =>
                    labelBelongsToNode(this, String(nodeId)));
                })
                .classed('babel-multidominance-shared-label', true)
                .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
              if ((sharedAnchor?.children || []).length > 1) {
                const sharedTerminalIds = new Set(
                  sharedAnchor?.descendants()
                    .filter((candidate) => (candidate.children || []).length === 0)
                    .map((candidate) => getNodeId(candidate as unknown as HierNode)) || []
                );
                g.selectAll<SVGTextElement, HierNode>('.terminal-label')
                  .filter((candidate) => sharedTerminalIds.has(getNodeId(candidate)))
                  .classed('babel-lens-node', true)
                  .attr('data-lens-role', 'shared-node')
                  .each(function markProductionSharedWitness() {
                    (this as SVGTextElement & { __babelProductionLens?: true }).__babelProductionLens = true;
                  });
              }
              const sharedRect = exactScreenTreeLabelRectNow(sharedItem.sharedNodeId, false);
              if (!sharedRect) {
                layer.remove();
                return;
              }
              const target = {
                x: sharedRect.x + sharedRect.width / 2,
                y: sharedRect.y + sharedRect.height / 2
              };
              sharedItem.parentNodeIds.slice(0, -1).forEach((parentNodeId) => {
                const parentRect = exactScreenTreeLabelRectNow(parentNodeId, false);
                if (!parentRect) return;
                const source = {
                  x: parentRect.x + parentRect.width / 2,
                  y: parentRect.y + parentRect.height / 2
                };
                const path = `M ${source.x.toFixed(1)} ${source.y.toFixed(1)} L ${target.x.toFixed(1)} ${target.y.toFixed(1)}`;
                layer.append('path')
                  .attr('class', 'babel-multidominance-branch-shadow')
                  .attr('d', path)
                  .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
                layer.append('path')
                  .attr('class', 'babel-multidominance-branch')
                  .attr('d', path)
                  .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
              });
              return;
            }

            const relatedItems = frameItems.filter((candidate) =>
              candidate.familyId === 'argument-sharing.domains'
              && relationLayerKey(candidate) === key);
            const domains = relatedItems.filter((candidate) => candidate.kind === 'domain-mark');
            const sharedNodeId = domains[0]?.sharedNodeId;
            if (domains.length < 2 || !sharedNodeId
              || domains.some((domain) => domain.sharedNodeId !== sharedNodeId)) {
              layer.remove();
              return;
            }
            const roleItem = relatedItems.find((candidate) =>
              candidate.kind === 'node-badges'
              && candidate.badgeStyle === 'shared-object'
              && candidate.badges.length === 1
              && candidate.badges[0].nodeId === sharedNodeId);
            const roleLabel = roleItem?.kind === 'node-badges'
              ? roleItem.badges[0]?.text || ''
              : '';
            const firstNodeGroup = g.select<SVGGElement>('.node-group').node();
            if (firstNodeGroup?.parentNode === root) root.insertBefore(layerNode, firstNodeGroup);
            else root.appendChild(layerNode);
            layer.attr('class', 'babel-argument-sharing-relation-layer');
            domains.forEach((domain, domainIndex) => {
              if (domain.kind !== 'domain-mark') return;
              const combinedRect = exactScreenTreeLabelRectForNodeIdsNow([
                domain.rootNodeId,
                sharedNodeId
              ]);
              if (!combinedRect) return;
              const cx = combinedRect.x + combinedRect.width / 2;
              const cy = combinedRect.y + combinedRect.height / 2;
              const rx = (combinedRect.width / 2 + 18) * Math.SQRT2;
              const ry = (combinedRect.height / 2 + 16) * Math.SQRT2;
              const rotation = domainIndex === 0 ? -10 : 10;
              layer.append('ellipse')
                .attr('class', 'babel-argument-sharing-domain')
                .attr('data-argument-domain', String(domainIndex + 1))
                .attr('data-shared-node', sharedNodeId)
                .attr('cx', cx.toFixed(1))
                .attr('cy', cy.toFixed(1))
                .attr('rx', rx.toFixed(1))
                .attr('ry', ry.toFixed(1))
                .attr('transform', `rotate(${rotation} ${cx.toFixed(1)} ${cy.toFixed(1)})`)
                .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
            });
            if (!roleLabel) return;
            const sharedRect = exactScreenTreeLabelRectNow(sharedNodeId, false);
            if (!sharedRect) {
              layer.remove();
              return;
            }
            const boxWidth = Math.max(96, roleLabel.length * 24 + 36);
            const boxHeight = 48;
            const boxX = sharedRect.x + sharedRect.width / 2 - boxWidth / 2;
            const boxY = sharedRect.y - boxHeight - 28;
            layer.append('rect')
              .attr('class', 'babel-argument-sharing-object-box')
              .attr('x', boxX.toFixed(1))
              .attr('y', boxY.toFixed(1))
              .attr('width', boxWidth.toFixed(1))
              .attr('height', boxHeight.toFixed(1))
              .attr('rx', 4)
              .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
            layer.append('text')
              .attr('class', 'babel-argument-sharing-object-label')
              .attr('x', (boxX + boxWidth / 2).toFixed(1))
              .attr('y', (boxY + 33).toFixed(1))
              .attr('opacity', emphasis === 'quiet' ? 0.3 : null)
              .text(roleLabel);
          });
        }
        return true;
      };
      const scheduledAcceptedPfRelations = new Set<string>();
      const scheduleAcceptedPfRelation = (
        item: RelationPlanItem,
        emphasis: 'active' | 'quiet' | null
      ) => {
        if (item.familyId === 'pf.realization' && item.kind === 'node-plaque') {
          const finalOutput = String(item.rows.at(-1)?.value || '').trim();
          if (finalOutput && !isNullLike(finalOutput)) {
            item.anchorNodeIds.forEach((nodeId) => markPreterminalLensNode(nodeId, 'pf-source'));
          }
          return false;
        }
        if (
          item.familyId !== 'pf.phrasal-spellout'
          && item.familyId !== 'pf.correspondence'
        ) return false;
        const drawingKey = acceptedRelationDrawingKey(item);
        if (!scheduledAcceptedPfRelations.has(drawingKey)) {
          scheduledAcceptedPfRelations.add(drawingKey);
          queueAcceptedRelationDraw(item, emphasis, () => {
            if (item.kind !== 'node-plaque') return;
            const root = g.node();
            const matrix = root?.getScreenCTM();
            const svgRect = svg.node()?.getBoundingClientRect();
            if (!root || !matrix || !svgRect) return;
            const inverse = matrix.inverse();
            const toLocal = (clientX: number, clientY: number) => {
              const point = new DOMPoint(clientX, clientY).matrixTransform(inverse);
              return { x: point.x, y: point.y };
            };
            const viewportTopLeft = toLocal(svgRect.left + 12, svgRect.top + 12);
            const viewportBottomRight = toLocal(svgRect.right - 12, svgRect.bottom - 12);
            const viewport = {
              left: Math.min(viewportTopLeft.x, viewportBottomRight.x),
              right: Math.max(viewportTopLeft.x, viewportBottomRight.x),
              top: Math.min(viewportTopLeft.y, viewportBottomRight.y),
              bottom: Math.max(viewportTopLeft.y, viewportBottomRight.y)
            };
            const screenScale = Math.max(0.001, Math.hypot(matrix.a, matrix.b));
            const localPx = (pixels: number) => pixels / screenScale;
            const layer = g.append('g')
              .attr('class', 'babel-pf-relation-layer babel-pf-specialization-layer')
              .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
            const layerNode = layer.node();
            if (layerNode) {
              (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
            }

            if (item.familyId === 'pf.phrasal-spellout') {
              const phrase = item.anchorNodeIds[0];
              const categoryRect = phrase ? exactScreenTreeLabelRectNow(phrase, false) : null;
              const exponent = item.title || '';
              if (!categoryRect || !exponent) {
                layer.remove();
                return;
              }
              layer.append('text')
                .attr('class', 'babel-phrasal-spellout-label')
                .attr('x', (categoryRect.x + categoryRect.width + localPx(7)).toFixed(1))
                .attr('y', (categoryRect.y + categoryRect.height * 0.8).toFixed(1))
                .style('font-size', `${localPx(16)}px`)
                .style('stroke-width', `${localPx(3)}px`)
                .text(`=> ${exponent}`);
              return;
            }

            const anchor = item.anchorNodeIds[0];
            const anchorRect = anchor ? exactScreenTreeLabelRectNow(anchor, true) : null;
            const content = item.nativeContent;
            if (content?.kind !== 'correspondence') { layer.remove(); return; }
            const { sources, exponents, links: correspondence } = content;
            if (!anchorRect || sources.length === 0 || exponents.length === 0) {
              layer.remove();
              return;
            }
            const width = localPx(330);
            const height = localPx(150);
            const preferredX = anchorRect.x + anchorRect.width + localPx(52);
            const origin = {
              x: Math.max(viewport.left, Math.min(preferredX, viewport.right - width)),
              y: Math.max(
                viewport.top,
                Math.min(anchorRect.y + anchorRect.height / 2 - height / 2, viewport.bottom - height)
              )
            };
            layer.append('rect')
              .attr('class', 'babel-pf-correspondence-shell')
              .attr('x', origin.x.toFixed(1))
              .attr('y', origin.y.toFixed(1))
              .attr('width', width.toFixed(1))
              .attr('height', height.toFixed(1))
              .attr('rx', localPx(12).toFixed(1))
              .style('stroke-width', `${localPx(1.5)}px`);
            layer.append('text')
              .attr('class', 'babel-pf-correspondence-title')
              .attr('x', (origin.x + width / 2).toFixed(1))
              .attr('y', (origin.y + localPx(18)).toFixed(1))
              .attr('text-anchor', 'middle')
              .style('font-size', `${localPx(9)}px`)
              .text('LEXICAL REPRESENTATION');
            const positions = (labels: string[], y: number, sidePaddingPx: number) =>
              labels.map((label, index) => ({
                  label,
                  x: origin.x + localPx(sidePaddingPx)
                    + (labels.length === 1
                      ? (width - localPx(sidePaddingPx * 2)) / 2
                      : index * (width - localPx(sidePaddingPx * 2)) / (labels.length - 1)),
                  y
              }));
            const sourcePositions = positions(sources, origin.y + localPx(49), 38);
            const exponentPositions = positions(exponents, origin.y + localPx(128), 50);
            correspondence.forEach((link) => {
              const from = sourcePositions[link.sourceIndex];
              const to = exponentPositions[link.exponentIndex];
              if (!from || !to) return;
              layer.append('line')
                .attr('class', 'babel-pf-correspondence-link')
                .attr('x1', from.x.toFixed(1))
                .attr('y1', (from.y + localPx(9)).toFixed(1))
                .attr('x2', to.x.toFixed(1))
                .attr('y2', (to.y - localPx(18)).toFixed(1))
                .style('stroke-width', `${localPx(1.15)}px`);
            });
            const appendLabel = (
              className: string,
              label: string,
              point: { x: number; y: number },
              pixels: number
            ) => layer.append('text')
              .attr('class', className)
              .attr('x', point.x.toFixed(1))
              .attr('y', point.y.toFixed(1))
              .attr('text-anchor', 'middle')
              .style('font-size', `${localPx(pixels)}px`)
              .style('stroke-width', `${localPx(2.5)}px`)
              .text(label);
            sourcePositions.forEach((point) => {
              appendLabel('babel-pf-correspondence-source', point.label, point, 13);
            });
            exponentPositions.forEach((point) => {
              appendLabel('babel-pf-correspondence-exponent', point.label, point, 13);
            });
            const fittedLayer = layer.node();
            if (fittedLayer) fitDeferredOverlayToCompactViewport(fittedLayer);
          });
        }
        return true;
      };
      const scheduleAcceptedPfMorphologyRelation = (
        item: RelationPlanItem,
        emphasis: 'active' | 'quiet' | null
      ) => {
        if (
          item.familyId !== 'pf.fission'
          && item.familyId !== 'pf.impoverishment'
          && item.familyId !== 'pf.local-dislocation'
        ) return false;
        const drawingKey = acceptedRelationDrawingKey(item);
        if (!scheduledAcceptedPfRelations.has(drawingKey)) {
          scheduledAcceptedPfRelations.add(drawingKey);
          queueAcceptedRelationDraw(item, emphasis, () => {
            if (item.kind !== 'node-plaque') return;
            const root = g.node();
            const matrix = root?.getScreenCTM();
            const svgRect = svg.node()?.getBoundingClientRect();
            if (!root || !matrix || !svgRect) return;
            const inverse = matrix.inverse();
            const toLocal = (clientX: number, clientY: number) =>
              new DOMPoint(clientX, clientY).matrixTransform(inverse);
            const viewportTopLeft = toLocal(svgRect.left + 12, svgRect.top + 12);
            const viewportBottomRight = toLocal(svgRect.right - 12, svgRect.bottom - 12);
            const viewport = {
              left: Math.min(viewportTopLeft.x, viewportBottomRight.x),
              top: Math.min(viewportTopLeft.y, viewportBottomRight.y),
              right: Math.max(viewportTopLeft.x, viewportBottomRight.x),
              bottom: Math.max(viewportTopLeft.y, viewportBottomRight.y)
            };
            const screenScale = Math.max(0.001, Math.hypot(matrix.a, matrix.b));
            const localPx = (pixels: number) => pixels / screenScale;
            const scalar = (name: string) => {
              return item.rows.find((row) => row.label === name)?.value || '';
            };
            const list = (name: string) => item.rows.filter((row) => row.label === name).map((row) => row.value);
            const displayLabelForAnchor = (nodeId: string) => {
              const anchor = overlayNodeById.get(nodeId);
              if (!anchor) return nodeId;
              const surfaces = anchor.descendants()
                .filter((candidate) => (candidate.children || []).length === 0)
                .map((candidate) => resolveLeafSurface(candidate as unknown as HierNode).trim())
                .filter((surface) => surface && surface !== '∅' && !/^\[.*\]$/.test(surface));
              return surfaces.join(' ') || String(anchor.data.word || anchor.data.label || nodeId);
            };
            const layer = g.append('g')
              .attr('class', 'babel-pf-morphology-relation-layer')
              .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
            const layerNode = layer.node();
            if (layerNode) {
              (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
            }
            const appendText = (
              parent: AcceptedRelationLayer,
              className: string,
              x: number,
              y: number,
              content: string
            ) => parent.append('text')
              .attr('class', className)
              .attr('x', x.toFixed(1))
              .attr('y', y.toFixed(1))
              .text(content);
            const appendLine = (
              className: string,
              x1: number,
              y1: number,
              x2: number,
              y2: number
            ) => layer.append('line')
              .attr('class', className)
              .attr('x1', x1.toFixed(1))
              .attr('y1', y1.toFixed(1))
              .attr('x2', x2.toFixed(1))
              .attr('y2', y2.toFixed(1));
            const appendShell = (x: number, y: number, width: number, height: number) =>
              layer.append('rect')
                .attr('class', 'babel-pf-morphology-shell')
                .attr('x', x.toFixed(1))
                .attr('y', y.toFixed(1))
                .attr('width', width.toFixed(1))
                .attr('height', height.toFixed(1))
                .attr('rx', 8);
            const setScreenFont = <T extends SVGTextElement>(
              selection: d3.Selection<T, unknown, null, undefined>,
              pixels: number
            ) => selection.style('font-size', `${localPx(pixels)}px`);
            const setScreenStroke = <T extends SVGElement>(
              selection: d3.Selection<T, unknown, null, undefined>,
              pixels: number
            ) => selection.style('stroke-width', `${localPx(pixels)}px`);
            // Replay can contain several workspaces under an invisible root. Measure
            // the visible forest, without requiring a label on that wrapper.
            const rootRect = measureGraphicsElementsInTreeSpace(
              g.selectAll<SVGTextElement, HierNode>('.category-label, .terminal-label').nodes()
            );
            if (!rootRect) {
              layer.remove();
              return;
            }

            if (item.familyId === 'pf.fission') {
              const content = item.nativeContent;
              if (content?.kind !== 'fission' || item.anchorNodeIds.length !== 2
                || !exactScreenTreeLabelRectForNodeIdsNow(item.anchorNodeIds)) {
                layer.remove();
                return;
              }
              const widthPx = 300;
              const bundles = withPlaqueTextMeasure(svg, measure =>
                [content.inputFeatures, ...content.outputFeatures].map(rows => rows.flatMap(row =>
                  wrapPlaqueText(row, 70, text => measure(text, {
                    fontFamily: '"JetBrains Mono", monospace', fontSize: 7, fontWeight: 800, letterSpacing: 0
                  })))));
              const bundleRows = Math.max(...bundles.map(rows => rows.length));
              const heightPx = Math.max(112, 64 + (bundleRows - 1) * 10.5);
              const width = localPx(widthPx);
              const height = localPx(heightPx);
              const replayPanelRect = containerRef.current
                ?.querySelector<HTMLElement>('[data-babel-replay-panel="true"]')
                ?.getBoundingClientRect() || null;
              const preferredClientY = svgRect.top + 310;
              const maximumClientY = replayPanelRect
                ? replayPanelRect.top - heightPx - 12
                : preferredClientY;
              const originClientY = Math.max(
                svgRect.top + 12,
                Math.min(preferredClientY, maximumClientY)
              );
              const rightAnchoredOrigin = toLocal(
                svgRect.right - widthPx - 12,
                originClientY
              );
              const origin = {
                x: Math.max(
                  viewport.left,
                  Math.min(rootRect.x + rootRect.width + localPx(32), rightAnchoredOrigin.x)
                ),
                y: rightAnchoredOrigin.y
              };
              setScreenStroke(
                appendShell(origin.x, origin.y, width, height).attr('rx', localPx(8).toFixed(1)),
                1.5
              );
              setScreenFont(
                appendText(layer, 'babel-pf-morphology-title', origin.x + localPx(12), origin.y + localPx(15), 'FISSION'),
                9
              );
              setScreenStroke(
                appendLine(
                  'babel-pf-morphology-rule',
                  origin.x + localPx(12),
                  origin.y + localPx(22),
                  origin.x + width - localPx(12),
                  origin.y + localPx(22)
                ),
                1
              );
              const drawBundle = (
                screenX: number,
                title: string,
                rows: string[],
                bundleWidthPx: number
              ) => {
                const x = origin.x + localPx(screenX);
                const group = layer.append('g').attr('class', 'babel-fission-bundle');
                setScreenStroke(
                  group.append('rect')
                    .attr('class', 'babel-fission-bundle-shell')
                    .attr('x', x.toFixed(1))
                    .attr('y', (origin.y + localPx(30)).toFixed(1))
                    .attr('width', localPx(bundleWidthPx).toFixed(1))
                    .attr('height', localPx(heightPx - 40).toFixed(1))
                    .attr('rx', localPx(4).toFixed(1)),
                  1
                );
                setScreenFont(
                  appendText(group, 'babel-fission-bundle-title', x + localPx(6), origin.y + localPx(42), title),
                  7
                );
                rows.forEach((row, index) => {
                  setScreenFont(
                    appendText(
                      group,
                      'babel-fission-bundle-row',
                      x + localPx(6),
                      origin.y + localPx(54 + index * 10.5),
                      row
                    ),
                    7
                  );
                });
              };
              drawBundle(10, 'PRIOR TERMINAL', bundles[0], 82);
              setScreenFont(
                appendText(layer, 'babel-fission-arrow', origin.x + localPx(98), origin.y + localPx(72), '→'),
                14
              );
              drawBundle(
                112,
                displayLabelForAnchor(item.anchorNodeIds[0]),
                bundles[1],
                82
              );
              drawBundle(
                208,
                displayLabelForAnchor(item.anchorNodeIds[1]),
                bundles[2],
                82
              );
              return;
            }

            if (item.familyId === 'pf.impoverishment') {
              const content = item.nativeContent;
              if (content?.kind !== 'impoverishment' || !item.anchorNodeIds[0]) {
                layer.remove();
                return;
              }
              const { features, delinkIndex } = content;
              const width = 450;
              const height = Math.max(252, 120 + (features.length - 1) * 56);
              const origin = {
                x: Math.max(viewport.left, Math.min(rootRect.x + rootRect.width + 48, viewport.right - width)),
                y: Math.max(
                  viewport.top,
                  Math.min(rootRect.y + rootRect.height / 2 - height / 2, viewport.bottom - height)
                )
              };
              appendShell(origin.x, origin.y, width, height);
              appendText(layer, 'babel-pf-morphology-title', origin.x + 24, origin.y + 34, 'IMPOVERISHMENT');
              appendLine(
                'babel-pf-morphology-rule',
                origin.x + 24,
                origin.y + 50,
                origin.x + width - 24,
                origin.y + 50
              );
              const inputX = origin.x + 112;
              const firstY = origin.y + 88;
              const featureGap = 56;
              features.forEach((feature, index) => {
                const y = firstY + index * featureGap;
                appendText(layer, 'babel-impoverishment-feature', inputX, y, feature);
                if (index >= features.length - 1) return;
                const lineY1 = y + 10;
                const lineY2 = y + featureGap - 24;
                appendLine('babel-impoverishment-link', inputX, lineY1, inputX, lineY2);
                if (index !== delinkIndex) return;
                const crossY = (lineY1 + lineY2) / 2;
                appendLine('babel-impoverishment-cross', inputX - 15, crossY - 9, inputX + 15, crossY + 1);
                appendLine('babel-impoverishment-cross', inputX - 15, crossY + 2, inputX + 15, crossY + 12);
              });
              appendText(layer, 'babel-fission-arrow', origin.x + 230, origin.y + 147, '→');
              features.slice(0, delinkIndex + 1).forEach((feature, index) => {
                appendText(
                  layer,
                  'babel-impoverishment-feature babel-impoverishment-output',
                  origin.x + 352,
                  firstY + index * featureGap,
                  feature
                );
              });
              return;
            }

            const labels = item.anchorNodeIds.map(displayLabelForAnchor);
            if (labels.length === 0) {
              layer.remove();
              return;
            }
            const beforeSizes = list('beforeGroupSizes')
              .map(Number)
              .filter((value) => Number.isInteger(value) && value > 0);
            const afterSizes = list('afterGroupSizes')
              .map(Number)
              .filter((value) => Number.isInteger(value) && value > 0);
            const formatGroups = (sizes: number[]) => {
              let cursor = 0;
              const groups = sizes.flatMap((size) => {
                const group = labels.slice(cursor, cursor + size);
                cursor += size;
                if (group.length === 0) return [];
                const content = group.join(' · ');
                return [group.length > 1 ? `[ ${content} ]` : content];
              });
              if (cursor < labels.length) groups.push(...labels.slice(cursor));
              return groups.join(' · ');
            };
            const widthPx = 290;
            const heightPx = 66;
            const width = localPx(widthPx);
            const height = localPx(heightPx);
            const plaqueGap = localPx(14);
            let plaqueX = viewport.left + ((viewport.right - viewport.left) - width) / 2;
            plaqueX = Math.min(Math.max(plaqueX, viewport.left), viewport.right - width);
            let plaqueY = rootRect.y + rootRect.height + plaqueGap;
            if (plaqueY + height > viewport.bottom) {
              const besideX = rootRect.x + rootRect.width + plaqueGap;
              if (besideX + width <= viewport.right) {
                plaqueX = besideX;
                plaqueY = Math.max(
                  viewport.top,
                  Math.min(rootRect.y + rootRect.height - height, viewport.bottom - height)
                );
              } else {
                plaqueY = rootRect.y + rootRect.height + localPx(6);
              }
            }
            const origin = { x: plaqueX, y: plaqueY };
            setScreenStroke(
              appendShell(origin.x, origin.y, width, height).attr('rx', localPx(8).toFixed(1)),
              1.5
            );
            setScreenFont(
              appendText(layer, 'babel-pf-morphology-title', origin.x + localPx(18), origin.y + localPx(15), 'LOCAL DISLOCATION'),
              11
            );
            setScreenStroke(
              appendLine(
                'babel-pf-morphology-rule',
                origin.x + localPx(18),
                origin.y + localPx(22),
                origin.x + width - localPx(18),
                origin.y + localPx(22)
              ),
              1
            );
            setScreenFont(
              appendText(layer, 'babel-pf-lane-label', origin.x + localPx(18), origin.y + localPx(40), 'BEFORE'),
              9
            );
            setScreenFont(
              appendText(layer, 'babel-pf-lane-expression', origin.x + localPx(78), origin.y + localPx(40), formatGroups(beforeSizes)),
              11
            );
            setScreenFont(
              appendText(layer, 'babel-pf-lane-label', origin.x + localPx(18), origin.y + localPx(58), 'AFTER'),
              9
            );
            setScreenFont(
              appendText(
                layer,
                'babel-pf-lane-expression babel-pf-lane-expression-current',
                origin.x + localPx(78),
                origin.y + localPx(58),
                formatGroups(afterSizes)
              ),
              11
            );
          });
        }
        return true;
      };
      const scheduleAcceptedCyclicLinearization = (
        item: RelationPlanItem,
        emphasis: 'active' | 'quiet' | null
      ) => {
        if (item.kind !== 'node-plaque' && item.kind !== 'anchor-set') return false;
        const key = relationLayerKey(item);
        const cyclicItem = frameItems.find((candidate) =>
          candidate.familyId === 'pf.cyclic-linearization'
          && candidate.kind === 'node-plaque'
          && relationLayerKey(candidate) === key);
        const anchorSetItem = frameItems.find((candidate) =>
          candidate.kind === 'anchor-set'
          && relationLayerKey(candidate) === key);
        if (cyclicItem?.kind !== 'node-plaque' || cyclicItem.nativeContent?.kind !== 'linearization') return false;
        const content = cyclicItem.nativeContent;
        const drawingKey = acceptedRelationDrawingKey(cyclicItem);
        if (!scheduledAcceptedPfRelations.has(drawingKey)) {
          scheduledAcceptedPfRelations.add(drawingKey);
          queueAcceptedRelationDraw(item, emphasis, () => {
            const root = g.node();
            const matrix = root?.getScreenCTM();
            const svgRect = svg.node()?.getBoundingClientRect();
            if (!root || !matrix || !svgRect) return;
            const inverse = matrix.inverse();
            const toLocal = (clientX: number, clientY: number) =>
              new DOMPoint(clientX, clientY).matrixTransform(inverse);
            const screenScale = Math.max(0.001, Math.hypot(matrix.a, matrix.b));
            const localPx = (pixels: number) => pixels / screenScale;
            const treeLocalRect = exactScreenTreeLabelRectNow(
              getNodeId(treeData as unknown as HierNode),
              true
            );
            const anchorPlan = anchorSetItem?.kind === 'anchor-set' ? planAnchorSetLayout(
              [anchorSetItem.set],
              (nodeId) => exactScreenDirectTreeLabelRectNow(nodeId)
                || exactScreenTreeLabelRectNow(nodeId, true),
              {
                badgeOffsetY: localPx(16),
                railGap: localPx(14)
              }
            ) : { badges: [], rails: [] };
            if (anchorSetItem?.kind === 'anchor-set' && anchorPlan.badges.length > 0) {
              const anchorLayer = g.append('g')
                .attr('class', 'babel-anchor-set-relation-layer')
                .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
              const anchorLayerNode = anchorLayer.node();
              if (anchorLayerNode) {
                (anchorLayerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
              }
              const railBase = (treeLocalRect
                ? treeLocalRect.y + treeLocalRect.height
                : Math.max(...anchorPlan.badges.map((badge) => badge.y))) + localPx(52);
              const railYFor = (lane: number) => railBase + lane * localPx(26);
              const railLabelMinX = toLocal(svgRect.left + 18, svgRect.top).x;
              anchorPlan.rails.forEach((rail) => {
                const y = railYFor(rail.lane);
                anchorLayer.append('line')
                  .attr('class', 'babel-anchor-set-rail')
                  .attr('x1', rail.x1.toFixed(1))
                  .attr('x2', rail.x2.toFixed(1))
                  .attr('y1', y.toFixed(1))
                  .attr('y2', y.toFixed(1));
                anchorLayer.append('text')
                  .attr('class', 'babel-anchor-set-rail-label')
                  .attr('x', Math.max(rail.x1, railLabelMinX).toFixed(1))
                  .attr('y', (y - localPx(6)).toFixed(1))
                  .style('font-size', `${localPx(10)}px`)
                  .text(`${anchorSetItem.set.relation}${anchorSetItem.set.instanceIndex > 0
                    ? ` (${anchorSetItem.set.instanceIndex + 1})`
                    : ''} · ${rail.role}`);
                anchorPlan.badges
                  .filter((badge) => badge.setIndex === rail.setIndex && badge.role === rail.role)
                  .forEach((badge) => {
                    anchorLayer.append('line')
                      .attr('class', 'babel-anchor-set-stub')
                      .attr('x1', badge.x.toFixed(1))
                      .attr('x2', badge.x.toFixed(1))
                      .attr('y1', (badge.y + localPx(5)).toFixed(1))
                      .attr('y2', y.toFixed(1));
                  });
              });
              anchorPlan.badges.forEach((badge) => {
                anchorLayer.append('circle')
                  .attr('class', 'babel-anchor-set-badge')
                  .attr('data-anchor-set-node', badge.nodeId)
                  .attr('data-anchor-set-role', badge.role)
                  .attr('cx', badge.x.toFixed(1))
                  .attr('cy', badge.y.toFixed(1))
                  .attr('r', localPx(7).toFixed(2));
                anchorLayer.append('text')
                  .attr('class', 'babel-anchor-set-badge-number')
                  .attr('x', badge.x.toFixed(1))
                  .attr('y', (badge.y + localPx(2.7)).toFixed(1))
                  .attr('text-anchor', 'middle')
                  .style('font-size', `${localPx(8)}px`)
                  .text(String(badge.arrayIndex + 1));
              });
            }

            const { priorRows: priorPairs, currentRows: currentPairs, conflict } = content;
            const widthPx = 350;
            const rowGapPx = 17;
            const heightPx = nativeLinearizationPlateHeight(content);
            const width = localPx(widthPx);
            const height = localPx(heightPx);
            const placement = linearizationViewport(availableTreeViewport(svgRect.width, svgRect.height, uiBounds), heightPx);
            const origin = toLocal(
              svgRect.left + placement.left,
              svgRect.top + placement.top
            );
            const layer = g.append('g')
              .attr('class', 'babel-pf-morphology-relation-layer')
              .attr('transform', `translate(${origin.x} ${origin.y}) scale(${placement.scale}) translate(${-origin.x} ${-origin.y})`)
              .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
            const layerNode = layer.node();
            if (layerNode) {
              (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
            }
            layer.append('rect')
              .attr('class', 'babel-pf-morphology-shell')
              .attr('x', origin.x.toFixed(1))
              .attr('y', origin.y.toFixed(1))
              .attr('width', width.toFixed(1))
              .attr('height', height.toFixed(1))
              .attr('rx', localPx(8).toFixed(1))
              .style('stroke-width', `${localPx(1.5)}px`);
            layer.append('text')
              .attr('class', conflict ? 'babel-linearization-failure-mark' : 'babel-pf-morphology-title')
              .attr('x', (origin.x + localPx(20)).toFixed(1))
              .attr('y', (origin.y + localPx(23)).toFixed(1))
              .style('font-size', `${localPx(13)}px`)
              .text(conflict ? '* ORDERING' : 'ORDERING');
            layer.append('line')
              .attr('class', 'babel-pf-morphology-rule')
              .attr('x1', (origin.x + localPx(20)).toFixed(1))
              .attr('y1', (origin.y + localPx(33)).toFixed(1))
              .attr('x2', (origin.x + width - localPx(20)).toFixed(1))
              .attr('y2', (origin.y + localPx(33)).toFixed(1))
              .style('stroke-width', `${localPx(1)}px`);
            const leftX = origin.x + localPx(22);
            const rightX = origin.x + localPx(widthPx / 2 + 7);
            const appendColumnTitle = (x: number, label: string) => layer.append('text')
              .attr('class', 'babel-linearization-column-title')
              .attr('x', x.toFixed(1))
                .attr('y', (origin.y + localPx(51)).toFixed(1))
              .style('font-size', `${localPx(10)}px`)
              .text(label);
            appendColumnTitle(leftX, 'PRIOR DOMAIN');
            appendColumnTitle(rightX, 'CURRENT DOMAIN');
            priorPairs.forEach((row, index) => {
              layer.append('text')
                .attr('class', 'babel-linearization-row')
                .attr('x', leftX.toFixed(1))
                .attr('y', (origin.y + localPx(70 + index * rowGapPx)).toFixed(1))
                .style('font-size', `${localPx(11)}px`)
                .text(row);
            });
            currentPairs.forEach((row, index) => {
              const current = layer.append('text')
                .attr('class', conflict
                  ? 'babel-linearization-row babel-linearization-row-conflict'
                  : 'babel-linearization-row babel-linearization-row-current')
                .attr('x', rightX.toFixed(1))
                .attr('y', (origin.y + localPx(70 + index * rowGapPx)).toFixed(1))
                .style('font-size', `${localPx(11)}px`)
                .text(row);
              if (conflict) current.style('text-decoration-thickness', `${localPx(1.5)}px`);
            });
          });
        }
        return true;
      };
      let scopeInformationPathLayer: AcceptedRelationLayer | null = null;
      let scopeInformationMarkLayer: AcceptedRelationLayer | null = null;
      const scheduleAcceptedScopeInformationRelation = (
        item: RelationPlanItem,
        emphasis: 'active' | 'quiet' | null
      ) => {
        if (
          item.familyId !== 'cooper-storage.ledger'
          && item.familyId !== 'accord.link'
          && item.familyId !== 'accord.strong-npi'
          && item.familyId !== 'focus.f-projection'
        ) return false;
        if (item.familyId === 'accord.strong-npi') {
          if (item.kind !== 'undirected-link' || item.pairs.length !== 2) return false;
        }
        const key = relationLayerKey(item);
        const drawingKey = acceptedRelationDrawingKey(item);
        if (!scheduledAcceptedPfRelations.has(drawingKey)) {
          scheduledAcceptedPfRelations.add(drawingKey);
          queueAcceptedRelationDraw(item, emphasis, () => {
            const root = g.node();
            const matrix = root?.getScreenCTM();
            if (!root || !matrix) return;
            const inverse = matrix.inverse();
            const rectForElements = (elements: SVGGraphicsElement[]) => {
              const points = elements.flatMap((element) => {
                const rect = element.getBoundingClientRect();
                if (!rect.width && !rect.height) return [];
                return [
                  new DOMPoint(rect.left, rect.top).matrixTransform(inverse),
                  new DOMPoint(rect.right, rect.top).matrixTransform(inverse),
                  new DOMPoint(rect.right, rect.bottom).matrixTransform(inverse),
                  new DOMPoint(rect.left, rect.bottom).matrixTransform(inverse)
                ];
              });
              if (points.length === 0) return null;
              const xs = points.map((point) => point.x);
              const ys = points.map((point) => point.y);
              return {
                x: Math.min(...xs),
                y: Math.min(...ys),
                width: Math.max(...xs) - Math.min(...xs),
                height: Math.max(...ys) - Math.min(...ys)
              };
            };
            const anchorElements = (nodeId: string, preferTerminal = false) => {
              const anchor = overlayNodeById.get(nodeId);
              const subtreeIds = new Set([
                nodeId,
                ...(anchor?.descendants().map((candidate) => getNodeId(candidate as unknown as HierNode)) || [])
              ]);
              const directTerminals = g.selectAll<SVGTextElement, HierNode>('.terminal-label')
                .filter(function exactScopeDirectTerminal() {
                  return labelBelongsToNode(this, String(nodeId));
                })
                .nodes();
              if (preferTerminal && directTerminals.length > 0) return directTerminals;
              const subtreeTerminals = g.selectAll<SVGTextElement, HierNode>('.terminal-label')
                .filter(function exactScopeSubtreeTerminal() {
                  return [...subtreeIds].some((candidateId) =>
                    labelBelongsToNode(this, candidateId));
                })
                .nodes();
              if (preferTerminal && subtreeTerminals.length > 0) return subtreeTerminals;
              const categories = g.selectAll<SVGTextElement, HierNode>('.category-label')
                .filter(function exactScopeCategory() {
                  return labelBelongsToNode(this, String(nodeId));
                })
                .nodes();
              if (categories.length > 0) return categories;
              const direct = g.selectAll<SVGTextElement, HierNode>('.category-label, .terminal-label')
                .filter(function exactScopeDirectLabel() {
                  return labelBelongsToNode(this, String(nodeId));
                })
                .nodes();
              if (direct.length > 0) return direct;
              return g.selectAll<SVGTextElement, HierNode>('.category-label, .terminal-label')
                .filter(function exactScopeSubtreeLabel() {
                  return [...subtreeIds].some((candidateId) =>
                    labelBelongsToNode(this, candidateId));
                })
                .nodes();
            };
            const anchorRect = (nodeId: string, preferTerminal = false) =>
              rectForElements(anchorElements(nodeId, preferTerminal));
            const center = (rect: { x: number; y: number; width: number; height: number }) => ({
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2
            });
            const ensureLayers = () => {
              if (!scopeInformationPathLayer) {
                const pathNode = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                pathNode.setAttribute(
                  'class',
                  'babel-scope-information-relation-layer babel-scope-information-path-layer'
                );
                (pathNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
                const firstNodeGroup = g.select<SVGGElement>('.node-group').node();
                if (firstNodeGroup?.parentNode === root) root.insertBefore(pathNode, firstNodeGroup);
                else root.appendChild(pathNode);
                scopeInformationPathLayer = d3.select<SVGGElement, unknown>(pathNode);
              }
              if (!scopeInformationMarkLayer) {
                const markNode = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                markNode.setAttribute(
                  'class',
                  'babel-scope-information-relation-layer babel-scope-information-mark-layer'
                );
                (markNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
                root.appendChild(markNode);
                scopeInformationMarkLayer = d3.select<SVGGElement, unknown>(markNode);
              }
              return { path: scopeInformationPathLayer, mark: scopeInformationMarkLayer };
            };
            const { path: pathLayer, mark: markLayer } = ensureLayers();
            const quietOpacity = emphasis === 'quiet' ? 0.3 : null;
            const appendText = (
              className: string,
              x: number,
              y: number,
              value: string,
              anchor: 'start' | 'middle' | 'end' = 'start'
            ) => markLayer.append('text')
              .attr('class', className)
              .attr('x', x.toFixed(1))
              .attr('y', y.toFixed(1))
              .attr('text-anchor', anchor)
              .attr('opacity', quietOpacity)
              .text(value);
            const treeRect = exactScreenTreeLabelRectNow(
              getNodeId(treeData as unknown as HierNode),
              true
            );

            if (item.familyId === 'cooper-storage.ledger' && item.kind === 'node-plaque') {
              const content = item.nativeContent;
              if (content?.kind !== 'cooper-storage') return;
              const scope = item.anchorNodeIds[0];
              const rect = scope ? anchorRect(scope) : null;
              const svgRect = svg.node()?.getBoundingClientRect();
              if (!rect || !svgRect) return;
              const width = 420;
              const height = 12 + content.rows.length * 46;
              const preferredX = treeRect ? treeRect.x + treeRect.width + 54 : rect.x + rect.width + 54;
              const viewportRight = new DOMPoint(svgRect.right - 12, svgRect.top).matrixTransform(inverse).x;
              const x = containerWidth < 500
                ? Math.min(preferredX, viewportRight - width)
                : preferredX;
              const y = rect.y + rect.height / 2 - height / 2;
              pathLayer.append('path')
                .attr('class', 'babel-cooper-storage-connector')
                .attr('d', `M ${(rect.x + rect.width + 12).toFixed(1)} ${(rect.y + rect.height / 2).toFixed(1)} H ${(x - 14).toFixed(1)}`)
                .attr('opacity', quietOpacity);
              const plaque = markLayer.append('g')
                .attr('class', 'babel-cooper-storage-plaque')
                .attr('data-storage-stage', String(item.relationRef.stageIndex + 1))
                .attr('opacity', quietOpacity);
              plaque.append('path')
                .attr('class', 'babel-cooper-storage-bracket')
                .attr('d', `M ${x + 18} ${y} H ${x} V ${y + height} H ${x + 18}`);
              plaque.append('path')
                .attr('class', 'babel-cooper-storage-bracket')
                .attr('d', `M ${x + width - 18} ${y} H ${x + width} V ${y + height} H ${x + width - 18}`);
              content.rows.forEach(({ label, value }, index) => {
                plaque.append('text')
                  .attr('class', 'babel-cooper-storage-key')
                  .attr('x', (x + 34).toFixed(1))
                  .attr('y', (y + 39 + index * 46).toFixed(1))
                  .attr('text-anchor', 'start')
                  .text(label);
                plaque.append('text')
                  .attr('class', 'babel-cooper-storage-value')
                  .attr('x', (x + 225).toFixed(1))
                  .attr('y', (y + 39 + index * 46).toFixed(1))
                  .attr('text-anchor', 'start')
                  .attr('font-size', value.length > 13 ? '21' : null)
                  .text(value);
              });
              return;
            }

            if (item.familyId === 'accord.link' && item.kind === 'directed-path') {
              const sourceId = item.fromNodeId;
              const goalId = item.toNodeId;
              const source = anchorRect(sourceId, true);
              const goal = anchorRect(goalId);
              if (!source || !goal) return;
              markPreterminalLensNode(sourceId, 'probe');
              const sourcePoint = center(source);
              const goalPoint = center(goal);
              const sourcePlaqueX = sourcePoint.x - 100;
              const goalPlaqueX = goalPoint.x - 58;
              const sourcePlaqueY = source.y + source.height + 58;
              const goalPlaqueY = goal.y + goal.height + 58;
              const markerId = `babel-accord-arrow-${item.relationRef.stageIndex}-${item.relationRef.relationIndex}`;
              const marker = pathLayer.append('defs').append('marker')
                .attr('id', markerId)
                .attr('viewBox', '0 0 10 10')
                .attr('refX', 8.5)
                .attr('refY', 5)
                .attr('markerUnits', 'userSpaceOnUse')
                .attr('markerWidth', 18)
                .attr('markerHeight', 18)
                .attr('orient', 'auto');
              marker.append('path').attr('class', 'babel-accord-arrowhead').attr('d', 'M 0 0 L 10 5 L 0 10 Z');
              const relationIndexValue = item.secondaryLabel || '';
              const feature = item.featureRow?.label || '';
              const value = item.featureRow?.value || '';
              const appendFeature = (x: number, y: number) => {
                markLayer.append('rect')
                  .attr('class', 'babel-accord-index-box')
                  .attr('x', x.toFixed(1))
                  .attr('y', (y - 33).toFixed(1))
                  .attr('width', 34)
                  .attr('height', 34)
                  .attr('opacity', quietOpacity);
                appendText(
                  'babel-accord-index babel-relation-index',
                  x + 17,
                  y - 7,
                  relationIndexValue,
                  'middle'
                );
                appendText('babel-accord-feature', x + 41, y - 5, `[${feature} ${value}]`);
              };
              appendFeature(sourcePlaqueX, sourcePlaqueY);
              appendFeature(goalPlaqueX, goalPlaqueY);
              const start = { x: sourcePlaqueX + 17, y: sourcePlaqueY - 39 };
              const end = { x: goalPlaqueX + 17, y: goalPlaqueY - 39 };
              const riseY = Math.min(source.y, goal.y) - 34;
              pathLayer.append('path')
                .attr('class', 'babel-accord-path')
                .attr('marker-end', `url(#${markerId})`)
                .attr('d', [
                  `M ${start.x.toFixed(1)} ${start.y.toFixed(1)}`,
                  `L ${start.x.toFixed(1)} ${riseY.toFixed(1)}`,
                  `L ${end.x.toFixed(1)} ${riseY.toFixed(1)}`,
                  `L ${end.x.toFixed(1)} ${end.y.toFixed(1)}`
                ].join(' '))
                .attr('opacity', quietOpacity);
              return;
            }

            if (item.familyId === 'accord.strong-npi' && item.kind === 'undirected-link') {
              const [licensing, focus] = item.pairs;
              if (!licensing || !focus) return;
              const exhaustifierId = licensing.fromNodeId;
              const npiId = licensing.toNodeId;
              const onlyId = focus.fromNodeId;
              const associateId = focus.toNodeId;
              const exhaustifier = anchorRect(exhaustifierId);
              const npi = anchorRect(npiId, true);
              const only = anchorRect(onlyId, true);
              const associate = anchorRect(associateId, true);
              if (!exhaustifier || !npi || !only || !associate || !treeRect) return;
              markPreterminalLensNode(onlyId, 'focus-operator');
              const feature = item.label || '';
              const exhaustifierFeatureText = appendText(
                'babel-strong-npi-feature-mark',
                exhaustifier.x - 20,
                exhaustifier.y + exhaustifier.height + 62,
                `ℰxh[${feature}]`,
                'end'
              );
              const npiFeatureText = appendText(
                'babel-strong-npi-feature-mark',
                npi.x + npi.width + 24,
                npi.y + npi.height * 0.82,
                `NPI[${feature}]`
              );
              const focusFeatureText = appendText(
                'babel-strong-npi-focus-mark',
                associate.x + associate.width + 8,
                associate.y + associate.height * 0.82,
                'F'
              );
              const npiFeatureRect = rectForElements([npiFeatureText.node() as SVGGraphicsElement]);
              const focusFeatureRect = rectForElements([
                ...anchorElements(associateId, true),
                focusFeatureText.node() as SVGGraphicsElement
              ]);
              const exhaustifierFeatureRect = rectForElements([
                exhaustifierFeatureText.node() as SVGGraphicsElement
              ]);
              if (!npiFeatureRect || !focusFeatureRect || !exhaustifierFeatureRect) return;
              const outerStart = {
                x: exhaustifierFeatureRect.x + exhaustifierFeatureRect.width + 18,
                y: exhaustifierFeatureRect.y + exhaustifierFeatureRect.height * 0.62
              };
              const outerEnd = {
                x: npiFeatureRect.x + npiFeatureRect.width - 6,
                y: npiFeatureRect.y + npiFeatureRect.height + 38
              };
              const outerFloor = treeRect.y + treeRect.height + 150;
              const outerMiddleX = (outerStart.x + outerEnd.x) / 2;
              const outerApproachX = outerMiddleX + (outerEnd.x - outerMiddleX) * 0.62;
              pathLayer.append('path')
                .attr('class', 'babel-strong-npi-path babel-strong-npi-path-outer')
                .attr('d', [
                  `M ${outerStart.x.toFixed(1)} ${outerStart.y.toFixed(1)}`,
                  `C ${(outerStart.x - 180).toFixed(1)} ${(outerStart.y + 100).toFixed(1)}`,
                  `${(outerStart.x - 130).toFixed(1)} ${outerFloor.toFixed(1)}`,
                  `${outerMiddleX.toFixed(1)} ${outerFloor.toFixed(1)}`,
                  `C ${outerApproachX.toFixed(1)} ${outerFloor.toFixed(1)}`,
                  `${outerEnd.x.toFixed(1)} ${outerEnd.y.toFixed(1)}`,
                  `${outerEnd.x.toFixed(1)} ${outerEnd.y.toFixed(1)}`
                ].join(' '))
                .attr('opacity', quietOpacity);
              const innerStart = { x: only.x - 18, y: only.y + only.height + 12 };
              const innerEnd = {
                x: focusFeatureRect.x + focusFeatureRect.width + 18,
                y: focusFeatureRect.y + focusFeatureRect.height * 0.62
              };
              const innerUnderY = focusFeatureRect.y + focusFeatureRect.height + 32;
              const innerFloor = Math.min(
                outerFloor - 54,
                Math.max(innerStart.y, innerEnd.y) + 118
              );
              const innerMiddleX = (innerStart.x + innerEnd.x) / 2;
              const innerApproachX = innerMiddleX + (innerEnd.x - innerMiddleX) * 0.58;
              pathLayer.append('path')
                .attr('class', 'babel-strong-npi-path babel-strong-npi-path-inner')
                .attr('d', [
                  `M ${innerStart.x.toFixed(1)} ${innerStart.y.toFixed(1)}`,
                  `C ${(innerStart.x - 105).toFixed(1)} ${(innerStart.y + 66).toFixed(1)}`,
                  `${(innerStart.x - 70).toFixed(1)} ${innerFloor.toFixed(1)}`,
                  `${innerMiddleX.toFixed(1)} ${innerFloor.toFixed(1)}`,
                  `C ${innerApproachX.toFixed(1)} ${innerFloor.toFixed(1)}`,
                  `${innerEnd.x.toFixed(1)} ${innerUnderY.toFixed(1)}`,
                  `${innerEnd.x.toFixed(1)} ${innerEnd.y.toFixed(1)}`
                ].join(' '))
                .attr('opacity', quietOpacity);
              return;
            }

            if (item.familyId === 'focus.f-projection') {
              const hops = frameItems.filter((candidate): candidate is DirectedPathPlanItem =>
                candidate.kind === 'directed-path' && candidate.pathStyle === 'f-projection'
                && relationLayerKey(candidate) === key);
              if (!hops.length) return;
              const accentId = hops[0].fromNodeId;
              const projectionIds = hops.map((hop) => hop.toNodeId);
              const accentBearer = anchorRect(accentId, true);
              const projectionRects = projectionIds.flatMap((nodeId, index) => {
                const rect = anchorRect(nodeId, hops[index].projectionTargetAttachment === 'terminal');
                return rect ? [{ nodeId, rect }] : [];
              });
              if (!accentBearer || projectionRects.length !== projectionIds.length) return;
              markPreterminalLensNode(accentId, 'focus-target');
              const feature = hops[0].projectionFeature || '';
              appendText(
                'babel-f-projection-feature',
                accentBearer.x + accentBearer.width + 8,
                accentBearer.y + accentBearer.height * 0.82,
                feature
              );
              appendText(
                'babel-f-projection-accent',
                accentBearer.x + accentBearer.width / 2,
                accentBearer.y + accentBearer.height + 50,
                hops[0].label || '',
                'middle'
              );
              projectionRects.forEach(({ rect }) => {
                appendText(
                  'babel-f-projection-feature',
                  rect.x + rect.width + 7,
                  rect.y + rect.height * 0.82,
                  feature
                );
              });
              const markerId = `babel-f-projection-arrow-${item.relationRef.stageIndex}-${item.relationRef.relationIndex}`;
              const marker = pathLayer.append('defs').append('marker')
                .attr('id', markerId)
                .attr('viewBox', '0 0 10 10')
                .attr('refX', 8)
                .attr('refY', 5)
                .attr('markerWidth', 2.2)
                .attr('markerHeight', 2.2)
                .attr('orient', 'auto');
              marker.append('path')
                .attr('class', 'babel-f-projection-arrowhead')
                .attr('d', 'M 0 0 L 10 5 L 0 10 Z');
              const sequence = [accentBearer, ...projectionRects.map(({ rect }) => rect)];
              sequence.slice(0, -1).forEach((source, index) => {
                const target = sequence[index + 1];
                const start = { x: source.x + source.width * 0.45, y: source.y - 8 };
                const end = { x: target.x + target.width * 0.54, y: target.y + target.height + 8 };
                const bendY = (start.y + end.y) / 2;
                pathLayer.append('path')
                  .attr('class', 'babel-f-projection-path')
                  .attr('data-projection-from', hops[index].fromNodeId)
                  .attr('data-projection-to', hops[index].toNodeId)
                  .attr('marker-end', `url(#${markerId})`)
                  .attr('d', [
                    `M ${start.x.toFixed(1)} ${start.y.toFixed(1)}`,
                    `C ${start.x.toFixed(1)} ${bendY.toFixed(1)}`,
                    `${end.x.toFixed(1)} ${bendY.toFixed(1)}`,
                    `${end.x.toFixed(1)} ${end.y.toFixed(1)}`
                  ].join(' '))
                  .attr('opacity', quietOpacity);
              });
            }
          });
        }
        return true;
      };
      const scheduleAcceptedFocusProminence = (
        item: RelationPlanItem,
        emphasis: 'active' | 'quiet' | null
      ) => {
        if (item.familyId !== 'focus.prominence' || item.kind !== 'branch-emphasis') return false;
        const drawingKey = acceptedRelationDrawingKey(item);
        if (!scheduledAcceptedPfRelations.has(drawingKey)) {
          scheduledAcceptedPfRelations.add(drawingKey);
          queueAcceptedRelationDraw(item, emphasis, () => {
            const root = g.node();
            if (!root) return;
            const nativeBranchPath = (fromNodeId: string, toNodeId: string) => {
              const branch = g.selectAll<SVGPathElement, unknown>('.branch')
                .filter(function exactFocusBranch() {
                  return this.getAttribute('data-source-node-id') === fromNodeId
                    && this.getAttribute('data-target-node-id') === toNodeId;
                })
                .node();
              return branch?.getAttribute('d') || '';
            };
            const strongPaths = item.strongEdges.map((edge) => nativeBranchPath(
              edge.fromNodeId,
              edge.toNodeId
            ));
            const weakPaths = item.weakEdges.map((edge) => nativeBranchPath(
              edge.fromNodeId,
              edge.toNodeId
            ));
            if (strongPaths.some((path) => !path) || weakPaths.some((path) => !path)) return;

            const layerNode = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            layerNode.setAttribute('class', 'babel-focus-relation-layer');
            if (emphasis === 'quiet') layerNode.setAttribute('opacity', '0.3');
            (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
            const layer = d3.select<SVGGElement, unknown>(layerNode);
            const appendBranches = (paths: string[], kind: 'strong' | 'weak') => {
              paths.forEach((path) => {
                layer.append('path')
                  .attr('class', 'babel-focus-branch-mask')
                  .attr('d', path);
                layer.append('path')
                  .attr('class', kind === 'strong'
                    ? 'babel-focus-branch-strong'
                    : 'babel-focus-branch-weak')
                  .attr('d', path);
              });
            };
            appendBranches(weakPaths, 'weak');
            appendBranches(strongPaths, 'strong');
            const firstNodeGroup = g.select<SVGGElement>('.node-group').node();
            if (firstNodeGroup?.parentNode === root) root.insertBefore(layerNode, firstNodeGroup);
            else root.appendChild(layerNode);

            const focusNodeId = item.focusNodeId || '';
            const focusAnchor = resolveOverlayAnchor(focusNodeId);
            const focusTerminals = focusAnchor?.descendants()
              .filter((candidate) => isDisplayTerminalNode(candidate as unknown as HierNode)) || [];
            if (focusTerminals.length > 1) markSubtreeLensNodes(focusNodeId, 'focus-target');
          });
        }
        return true;
      };
      const scheduleAcceptedThetaGrid = (
        item: RelationPlanItem,
        emphasis: 'active' | 'quiet' | null
      ) => {
        if (item.familyId !== 'theta.grid') return false;
        const key = relationLayerKey(item);
        const drawingKey = acceptedRelationDrawingKey(item);
        if (!scheduledAcceptedPfRelations.has(drawingKey)) {
          scheduledAcceptedPfRelations.add(drawingKey);
          queueAcceptedRelationDraw(item, emphasis, () => {
            const grid = frameItems.find((candidate): candidate is NodePlaquePlanItem =>
              candidate.kind === 'node-plaque' && candidate.plaqueStyle === 'theta-grid'
              && relationLayerKey(candidate) === key);
            if (!grid?.thetaRoles?.length) return;
            const root = g.node();
            const matrix = root?.getScreenCTM();
            if (!root || !matrix) return;
            const inverse = matrix.inverse();
            const localRect = (elements: SVGGraphicsElement[]) => {
              const points = elements.flatMap((element) => {
                const rect = element.getBoundingClientRect();
                if (!rect.width && !rect.height) return [];
                return [
                  new DOMPoint(rect.left, rect.top).matrixTransform(inverse),
                  new DOMPoint(rect.right, rect.top).matrixTransform(inverse),
                  new DOMPoint(rect.right, rect.bottom).matrixTransform(inverse),
                  new DOMPoint(rect.left, rect.bottom).matrixTransform(inverse)
                ];
              });
              if (points.length === 0) return null;
              const xs = points.map((point) => point.x);
              const ys = points.map((point) => point.y);
              return {
                x: Math.min(...xs),
                y: Math.min(...ys),
                width: Math.max(...xs) - Math.min(...xs),
                height: Math.max(...ys) - Math.min(...ys)
              };
            };
            const predicateId = grid.anchorNodeIds[0];
            const predicateAnchor = resolveOverlayAnchor(predicateId);
            if (!predicateAnchor) return;
            const predicateNodeIds = new Set(
              predicateAnchor.descendants().map((candidate) => getNodeId(candidate as unknown as HierNode))
            );
            const predicateElements = g.selectAll<SVGTextElement, HierNode>('.category-label, .terminal-label')
              .filter(function exactThetaPredicate(candidate) {
                const categoryId = this.getAttribute('data-category-node-id') || '';
                const terminalId = this.getAttribute('data-node-id') || '';
                return categoryId === predicateId
                  || predicateNodeIds.has(getNodeId(candidate))
                  || predicateNodeIds.has(terminalId);
              })
              .nodes();
            const predicateRect = localRect(predicateElements);
            if (!predicateRect) return;
            const treeRect = localRect(
              g.selectAll<SVGGraphicsElement, HierNode>('.category-label, .terminal-label').nodes()
            );
            if (!treeRect) return;

            const roleEntries = grid.thetaRoles.flatMap(({ nodeId, label }) => {
                const anchor = resolveOverlayAnchor(nodeId);
                const terminal = anchor?.leaves().at(-1);
                return nodeId && terminal
                  ? [{
                      role: label,
                      nodeId,
                      terminalId: getNodeId(terminal as unknown as HierNode)
                    }]
                  : [];
              });
            if (roleEntries.length === 0) return;
            const indexLabels = ['i', 'j', 'k', 'l', 'm', 'n', 'p'];
            const predicateTerminal = predicateAnchor.leaves().find((candidate) => (
              Boolean(String(candidate.data.word || '').trim())
            ));
            const predicateLabel = String(
              predicateTerminal?.data.word
              || predicateTerminal?.data.label
              || predicateAnchor.data.word
              || predicateAnchor.data.label
              || 'predicate'
            );
            const layer = g.append('g')
              .attr('class', 'babel-theta-relation-layer')
              .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
            const layerNode = layer.node();
            if (layerNode) {
              (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
            }
            const plateWidth = 430;
            const plateHeight = 126;
            const plateOrigin = replayPlaqueLayout.get(frameItems.indexOf(grid));
            if (!plateOrigin) return;
            const leftColumnWidth = 104;
            const roleColumnWidth = (plateWidth - leftColumnWidth - 24) / roleEntries.length;
            const plate = layer.append('g').attr('class', 'babel-theta-grid-plate');
            plate.append('rect')
              .attr('class', 'babel-theta-grid-shell')
              .attr('x', plateOrigin.x.toFixed(1))
              .attr('y', plateOrigin.y.toFixed(1))
              .attr('width', plateWidth.toFixed(1))
              .attr('height', plateHeight.toFixed(1))
              .attr('rx', 12);
            plate.append('text')
              .attr('class', 'babel-theta-grid-title')
              .attr('x', (plateOrigin.x + 16).toFixed(1))
              .attr('y', (plateOrigin.y + 27).toFixed(1))
              .text('θ GRID');
            plate.append('line')
              .attr('class', 'babel-theta-grid-rule')
              .attr('x1', (plateOrigin.x + 16).toFixed(1))
              .attr('x2', (plateOrigin.x + plateWidth - 16).toFixed(1))
              .attr('y1', (plateOrigin.y + 39).toFixed(1))
              .attr('y2', (plateOrigin.y + 39).toFixed(1));
            plate.append('text')
              .attr('class', 'babel-theta-grid-predicate')
              .attr('x', (plateOrigin.x + 16).toFixed(1))
              .attr('y', (plateOrigin.y + 78).toFixed(1))
              .text(predicateLabel);
            plate.append('line')
              .attr('class', 'babel-theta-grid-rule')
              .attr('x1', (plateOrigin.x + leftColumnWidth).toFixed(1))
              .attr('x2', (plateOrigin.x + leftColumnWidth).toFixed(1))
              .attr('y1', (plateOrigin.y + 47).toFixed(1))
              .attr('y2', (plateOrigin.y + plateHeight - 13).toFixed(1));
            roleEntries.forEach((role, index) => {
              const left = plateOrigin.x + leftColumnWidth + roleColumnWidth * index;
              const centre = left + roleColumnWidth / 2;
              if (index > 0) {
                plate.append('line')
                  .attr('class', 'babel-theta-grid-rule')
                  .attr('x1', left.toFixed(1))
                  .attr('x2', left.toFixed(1))
                  .attr('y1', (plateOrigin.y + 47).toFixed(1))
                  .attr('y2', (plateOrigin.y + plateHeight - 13).toFixed(1));
              }
              plate.append('text')
                .attr('class', 'babel-theta-grid-role')
                .attr('x', centre.toFixed(1))
                .attr('y', (plateOrigin.y + 69).toFixed(1))
                .attr('text-anchor', 'middle')
                .text(role.role);
              plate.append('text')
                .attr('class', 'babel-theta-grid-index babel-relation-index')
                .attr('x', centre.toFixed(1))
                .attr('y', (plateOrigin.y + 108).toFixed(1))
                .attr('text-anchor', 'middle')
                .text(indexLabels[index] || String(index + 1));

              const roleAnchor = resolveOverlayAnchor(role.nodeId);
              const roleLeaves = roleAnchor?.leaves() || [];
              const roleIsEntirelyTraces = roleLeaves.length > 0 && roleLeaves.every((leaf) =>
                isTraceLike(resolveLeafSurface(leaf as unknown as HierNode).trim()));
              const indexedLabel = roleIsEntirelyTraces
                ? g.selectAll<SVGTextElement, HierNode>('.category-label')
                    .filter(function exactThetaTraceOccurrence() {
                      return this.getAttribute('data-category-node-id') === role.nodeId;
                    })
                : g.selectAll<SVGTextElement, HierNode>('.terminal-label')
                    .filter(function exactThetaIndexTarget(candidate) {
                      return getNodeId(candidate as unknown as HierNode) === role.terminalId
                        || this.getAttribute('data-node-id') === role.terminalId;
                    });
              indexedLabel.each(function appendThetaIndex() {
                const label = d3.select(this);
                const baseLabel = label.attr('data-default-label') || this.textContent || '';
                label.text(baseLabel)
                  .classed('babel-theta-indexed-label', true)
                  .attr('data-theta-base-label', baseLabel);
                label.append('tspan')
                  .attr('class', 'babel-theta-terminal-index babel-relation-index')
                  .attr('dx', 5)
                  .attr('dy', roleIsEntirelyTraces ? 9 : 14)
                  .attr('font-size', roleIsEntirelyTraces ? '22px' : '30px')
                  .attr('font-family', 'Crimson Pro, Georgia, serif')
                  .attr('font-style', 'italic')
                  .text(indexLabels[index] || String(index + 1));
              });
            });
          });
        }
        return true;
      };
      const scheduleAcceptedIntervention = (
        item: RelationPlanItem,
        emphasis: 'active' | 'quiet' | null
      ) => {
        if (item.familyId !== 'intervention.blocked-path') return false;
        const key = relationLayerKey(item);
        if (!scheduledAcceptedLocalityRelations.has(key)) {
          scheduledAcceptedLocalityRelations.add(key);
          queueAcceptedRelationDraw(item, emphasis, () => {
            const relatedItems = frameItems.filter((candidate) =>
              candidate.familyId === 'intervention.blocked-path'
              && relationLayerKey(candidate) === key);
            const pathItem = relatedItems.find((candidate) =>
              candidate.kind === 'directed-path'
              && candidate.pathStyle === 'intervention');
            const intervenerItem = relatedItems.find((candidate) =>
              candidate.kind === 'node-badges'
              && candidate.badgeStyle === 'intervener');
            if (
              !pathItem
              || pathItem.kind !== 'directed-path'
              || !intervenerItem
              || intervenerItem.kind !== 'node-badges'
            ) return;

            const root = g.node();
            const matrix = root?.getScreenCTM();
            const intervenerId = intervenerItem.badges[0]?.nodeId;
            if (!root || !matrix || !intervenerId) return;
            const inverse = matrix.inverse();
            const localRectForElement = (element: SVGGraphicsElement | null) => {
              if (!element) return null;
              const rect = element.getBoundingClientRect();
              if (!rect.width && !rect.height) return null;
              const points = [
                new DOMPoint(rect.left, rect.top).matrixTransform(inverse),
                new DOMPoint(rect.right, rect.top).matrixTransform(inverse),
                new DOMPoint(rect.right, rect.bottom).matrixTransform(inverse),
                new DOMPoint(rect.left, rect.bottom).matrixTransform(inverse)
              ];
              const xs = points.map((point) => point.x);
              const ys = points.map((point) => point.y);
              return {
                x: Math.min(...xs),
                y: Math.min(...ys),
                width: Math.max(...xs) - Math.min(...xs),
                height: Math.max(...ys) - Math.min(...ys)
              };
            };
            const visibleOccurrenceRect = (nodeId: string) => {
              const anchor = overlayNodeById.get(nodeId);
              const nodeIds = new Set(
                anchor?.descendants().map((candidate) => getNodeId(candidate as unknown as HierNode))
                || [nodeId]
              );
              const terminal = g.selectAll<SVGTextElement, HierNode>('.terminal-label')
                .filter((candidate) => nodeIds.has(getNodeId(candidate as unknown as HierNode)))
                .node();
              return localRectForElement(terminal)
                || exactScreenTreeLabelRectNow(nodeId, false);
            };
            const centredAnchor = (nodeId: string) => {
              const rect = visibleOccurrenceRect(nodeId);
              return rect ? {
                x: rect.x + rect.width / 2,
                y: rect.y + rect.height / 2,
                rect
              } : null;
            };
            const probe = centredAnchor(pathItem.fromNodeId);
            const intervener = centredAnchor(intervenerId);
            const target = centredAnchor(pathItem.toNodeId);
            if (!probe || !intervener || !target) return;

            const gap = 22;
            const landingEdge = probe.rect.y + probe.rect.height + gap;
            const targetEdge = target.rect.y - gap;
            const laneLow = Math.min(landingEdge, targetEdge);
            const laneHigh = Math.max(landingEdge, targetEdge);
            const intervenerEdge = intervener.rect.y + intervener.rect.height + gap;
            const laneY = Math.min(laneHigh, Math.max(laneLow, intervenerEdge));
            const targetStart = { x: target.x, y: targetEdge };
            const arrowEnd = { x: probe.x, y: landingEdge };
            const failedPath = [
              `M ${targetStart.x.toFixed(1)} ${targetStart.y.toFixed(1)}`,
              `L ${targetStart.x.toFixed(1)} ${laneY.toFixed(1)}`,
              `L ${arrowEnd.x.toFixed(1)} ${laneY.toFixed(1)}`,
              `L ${arrowEnd.x.toFixed(1)} ${arrowEnd.y.toFixed(1)}`
            ].join(' ');

            const layerNode = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            layerNode.setAttribute('class', 'babel-intervention-relation-layer');
            if (emphasis === 'quiet') layerNode.setAttribute('opacity', '0.3');
            (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
            const layer = d3.select<SVGGElement, unknown>(layerNode);
            layer.append('path')
              .attr('class', 'babel-intervention-search-shadow')
              .attr('d', failedPath);
            layer.append('path')
              .attr('class', 'babel-intervention-search-path')
              .attr('d', failedPath);

            const appendCross = (className: string) => {
              const size = 22;
              [
                [intervener.x - size, laneY - size, intervener.x + size, laneY + size],
                [intervener.x + size, laneY - size, intervener.x - size, laneY + size]
              ].forEach(([x1, y1, x2, y2]) => {
                layer.append('line')
                  .attr('class', className)
                  .attr('x1', x1.toFixed(1))
                  .attr('x2', x2.toFixed(1))
                  .attr('y1', y1.toFixed(1))
                  .attr('y2', y2.toFixed(1));
              });
            };
            appendCross('babel-intervention-x-shadow');
            appendCross('babel-intervention-x-mark');

            const arrowSize = 23;
            const arrowTail = laneY > arrowEnd.y
              ? arrowEnd.y + arrowSize
              : arrowEnd.y - arrowSize;
            const arrowPath = [
              `M ${(arrowEnd.x - arrowSize * 0.42).toFixed(1)} ${arrowTail.toFixed(1)}`,
              `L ${arrowEnd.x.toFixed(1)} ${arrowEnd.y.toFixed(1)}`,
              `L ${(arrowEnd.x + arrowSize * 0.42).toFixed(1)} ${arrowTail.toFixed(1)}`
            ].join(' ');
            layer.append('path')
              .attr('class', 'babel-intervention-arrowhead-shadow')
              .attr('d', arrowPath);
            layer.append('path')
              .attr('class', 'babel-intervention-arrowhead')
              .attr('d', arrowPath);

            root.insertBefore(layerNode, root.firstChild);
          });
        }
        return true;
      };
      const scheduledAcceptedLfRelations = new Set<string>();
      const scheduleAcceptedLfReconstruction = (
        item: RelationPlanItem,
        emphasis: 'active' | 'quiet' | null
      ) => {
        if (item.familyId !== 'lf.reconstruction') return false;
        const key = relationLayerKey(item);
        if (!scheduledAcceptedLfRelations.has(key)) {
          scheduledAcceptedLfRelations.add(key);
          queueAcceptedRelationDraw(item, emphasis, () => {
            const relationItems = frameItems.filter((candidate) =>
              candidate.familyId === 'lf.reconstruction'
              && relationLayerKey(candidate) === key);
            const strikeItem = relationItems.find((candidate) => candidate.kind === 'strike-ghost');
            const coindexItem = relationItems.find((candidate) => candidate.kind === 'coindex');
            if (!strikeItem || strikeItem.kind !== 'strike-ghost'
              || !coindexItem || coindexItem.kind !== 'coindex') return;

            const neglectedNodeId = strikeItem.strikeNodeIds[0];
            const ghostNodeIds = new Set(strikeItem.ghostNodeIds);
            const ghostLabels = g.selectAll<SVGTextElement, HierNode>('.category-label, .terminal-label')
              .filter(function acceptedLfGhostLabel() {
                return [...ghostNodeIds].some((nodeId) =>
                  labelBelongsToNode(this, String(nodeId)));
              });
            ghostLabels
              .classed('babel-lf-ghost-label', true)
              .classed('babel-lf-copy-label', true)
              .style('fill', 'rgba(209, 250, 229, 0.38)', 'important')
              .style('stroke', 'rgba(1, 8, 5, 0.62)', 'important')
              .style('opacity', '0.58', 'important')
              .style('filter', 'blur(0.22px)', 'important');

            const coindexLayer = g.append('g').attr('class', 'babel-coindex-relation-layer');
            const coindexNode = coindexLayer.node();
            if (coindexNode) {
              (coindexNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
            }
            if (emphasis === 'quiet') coindexLayer.attr('opacity', 0.3);
            coindexItem.nodeIds.forEach((nodeId) => {
              const rect = exactScreenTreeLabelRectNow(nodeId, false)
                || exactScreenTreeLabelRectNow(nodeId, true);
              if (!rect) return;
              coindexLayer.append('text')
                .attr('class', 'babel-binding-index babel-relation-index')
                .attr('x', (rect.x + rect.width + 12).toFixed(1))
                .attr('y', (rect.y + rect.height / 2 + 30).toFixed(1))
                .text(coindexItem.index);
            });

            const layer = g.append('g').attr('class', 'babel-lf-relation-layer');
            const layerNode = layer.node();
            if (layerNode) {
              (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
            }
            if (emphasis === 'quiet') layer.attr('opacity', 0.3);
            const markerId = `babel-lf-arrow-${item.relationRef.stageIndex}-${item.relationRef.relationIndex}`;
            const marker = layer.append('defs').append('marker')
              .attr('id', markerId)
              .attr('markerWidth', 34)
              .attr('markerHeight', 34)
              .attr('refX', 22)
              .attr('refY', 17)
              .attr('orient', 'auto')
              .attr('markerUnits', 'userSpaceOnUse')
              .attr('overflow', 'visible');
            marker.append('path')
              .attr('class', 'babel-lf-arrowhead')
              .attr('d', 'M 7 25 L 22 17 L 7 9');

            const rect = exactScreenTreeLabelRectNow(neglectedNodeId, true);
            if (!rect) return;
            const strikeY = rect.y + rect.height * 0.56;
            ['babel-lf-strike-shadow', 'babel-lf-strike'].forEach((className) => {
              layer.append('line')
                .attr('class', className)
                .attr('x1', (rect.x - 14).toFixed(1))
                .attr('x2', (rect.x + rect.width + 14).toFixed(1))
                .attr('y1', strikeY.toFixed(1))
                .attr('y2', strikeY.toFixed(1));
            });
          });
        }
        return true;
      };
      const acceptedRootLayerBeforeNodes = (
        layers: Map<string, AcceptedRelationLayer>,
        item: RelationPlanItem,
        emphasis: 'active' | 'quiet' | null,
        className: string
      ) => {
        const key = relationLayerKey(item);
        const existing = layers.get(key);
        if (existing) return existing;
        const root = g.node();
        const layerNode = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        layerNode.setAttribute('class', className);
        decorateRelationElement(layerNode, item, emphasis);
        (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
        if (emphasis === 'quiet') layerNode.setAttribute('opacity', '0.3');
        const firstNodeGroup = g.select<SVGGElement>('.node-group').node();
        if (root && firstNodeGroup?.parentNode === root) root.insertBefore(layerNode, firstNodeGroup);
        else root?.appendChild(layerNode);
        const layer = d3.select<SVGGElement, unknown>(layerNode);
        layers.set(key, layer);
        return layer;
      };
      const acceptedRootLayerAfterNodes = (
        layers: Map<string, AcceptedRelationLayer>,
        item: RelationPlanItem,
        emphasis: 'active' | 'quiet' | null,
        className: string
      ) => {
        const key = relationLayerKey(item);
        const existing = layers.get(key);
        if (existing) return existing;
        const layer = g.append('g').attr('class', className);
        const layerNode = layer.node();
        if (layerNode) {
          decorateRelationElement(layerNode, item, emphasis);
          (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
        }
        if (emphasis === 'quiet') layer.attr('opacity', 0.3);
        layers.set(key, layer);
        return layer;
      };
      const ensureControlRelationLayer = (
        item: RelationPlanItem,
        emphasis: 'active' | 'quiet' | null
      ) => {
        const layer = acceptedRootLayerBeforeNodes(
          controlRelationLayers,
          item,
          emphasis,
          'babel-control-relation-layer'
        );
        if (layer.select('.babel-control-dependency-marker').empty()) {
          const markerId = `babel-control-arrow-${item.relationRef.stageIndex}-${item.relationRef.relationIndex}`;
          const marker = layer.append('defs').append('marker')
            .attr('class', 'babel-control-dependency-marker')
            .attr('id', markerId)
            .attr('markerWidth', 52)
            .attr('markerHeight', 52)
            .attr('refX', 43)
            .attr('refY', 26)
            .attr('orient', 'auto')
            .attr('markerUnits', 'userSpaceOnUse')
            .attr('overflow', 'visible');
          marker.append('path').attr('fill', 'none').attr('d', 'M 10 9 L 43 26 L 10 43');
        }
        return layer;
      };
      const ensureFeatureRelationLayer = () => {
        if (featureRelationLayer) return featureRelationLayer;
        const layer = g.append('g').attr('class', 'babel-feature-relation-layer');
        const layerNode = layer.node();
        if (layerNode) {
          (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
        }
        featureRelationLayer = layer;
        return layer;
      };
      const ensureAgreementCaseRelationLayer = () => {
        if (agreementCaseRelationLayer) return agreementCaseRelationLayer;
        const layer = g.append('g').attr('class', 'babel-agreement-case-relation-layer');
        const layerNode = layer.node();
        if (layerNode) {
          (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
        }
        const markerId = `babel-agree-arrow-${activeDerivationFrameIndex}`;
        const marker = layer.append('defs').append('marker')
          .attr('id', markerId)
          .attr('viewBox', '0 0 10 10')
          .attr('refX', 8)
          .attr('refY', 5)
          .attr('markerWidth', 5)
          .attr('markerHeight', 5)
          .attr('orient', 'auto');
        marker.append('path')
          .attr('class', 'babel-agree-arrowhead')
          .attr('d', 'M 0 1 L 9 5 L 0 9 z');
        agreementCaseRelationLayer = layer;
        return layer;
      };
      const acceptedIslandLayer = (
        item: RelationPlanItem,
        emphasis: 'active' | 'quiet' | null
      ) => acceptedRootLayerBeforeNodes(
        parasiticGapIslandLayers,
        item,
        emphasis,
        'babel-island-relation-layer babel-pg-island-relation-layer'
      );
      let phaseRelationLayer: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;

      const ensureTrajectoryRelationLayer = () => {
        if (trajectoryRelationLayer) return trajectoryRelationLayer;
        const layer = overlay.append('g').attr('class', 'babel-trajectory-relation-layer');
        const defs = layer.append('defs');
        const openMarker = defs.append('marker')
          .attr('id', trajectoryMarkerIds.open)
          .attr('markerWidth', 30)
          .attr('markerHeight', 30)
          .attr('refX', 19)
          .attr('refY', 15)
          .attr('orient', 'auto')
          .attr('markerUnits', 'userSpaceOnUse')
          .attr('overflow', 'visible');
        openMarker.append('path')
          .attr('class', 'babel-trajectory-arrowhead')
          .attr('d', 'M 6 22 L 19 15 L 6 8');
        const movementMarker = defs.append('marker')
          .attr('id', trajectoryMarkerIds.movement)
          .attr('viewBox', '0 0 10 10')
          .attr('refX', 9)
          .attr('refY', 5)
          .attr('markerWidth', 7)
          .attr('markerHeight', 7)
          .attr('orient', 'auto-start-reverse');
        movementMarker.append('path')
          .attr('d', 'M 0 0 L 10 5 L 0 10 z')
          .attr('fill', '#34d399');
        const carrierMarker = defs.append('marker')
          .attr('id', trajectoryMarkerIds.carrier)
          .attr('markerWidth', 64)
          .attr('markerHeight', 64)
          .attr('refX', 40)
          .attr('refY', 32)
          .attr('orient', 'auto')
          .attr('markerUnits', 'userSpaceOnUse')
          .attr('overflow', 'visible');
        carrierMarker.append('path')
          .attr('class', 'babel-carrier-arrowhead')
          .attr('d', 'M 4 56 L 40 32 L 4 8 Z');
        trajectoryRelationLayer = layer;
        return layer;
      };

      const sortedTrajectories = boundFrame.primitives
        .filter((primitive) => primitive.type === 'trajectory-path')
        .sort((left, right) => {
          const priority = (kind: string) => kind === 'head' ? 0 : 1;
          return priority(left.trajectoryKind) - priority(right.trajectoryKind);
        });
      let sortedTrajectoryIndex = 0;
      const orderedPrimitives = boundFrame.primitives.map((primitive) =>
        primitive.type === 'trajectory-path'
          ? sortedTrajectories[sortedTrajectoryIndex++]
          : primitive);
      const operatorVariableScopeRankByItem = new Map<number, number>();
      const operatorVariableScopeItems = frameItems
        .map((item, itemIndex) => ({ item, itemIndex }))
        .filter((entry): entry is {
          item: Extract<RelationPlanItem, { kind: 'operator-variable-binding' }>;
          itemIndex: number;
        } => entry.item.kind === 'operator-variable-binding' && Boolean(entry.item.scopeDomainNodeId))
        .sort((left, right) => {
          const sizeDifference = (right.item.scopeMemberNodeIds?.length || 0)
            - (left.item.scopeMemberNodeIds?.length || 0);
          return sizeDifference || left.itemIndex - right.itemIndex;
        });
      operatorVariableScopeItems.forEach((entry, rank) => {
        operatorVariableScopeRankByItem.set(entry.itemIndex, rank);
      });
      const renderedFeatureSharingItems = new Set<number>();
      const renderedCaseCompositions = new Set<string>();
      const renderedBoundaryCutItems = new Set<number>();
      const sampleNativeBranchOverlay = (targetNodeId: string) => {
        const nativeBranch = g.selectAll<SVGPathElement, unknown>('.branch')
          .filter(function matchesTargetBranch() {
            return this.getAttribute('data-target-node-id') === targetNodeId;
          });
        const nativeBranchNode = nativeBranch.node();
        const targetLabelRect = measuredTreeLabelRectNow(targetNodeId, false);
        if (!nativeBranchNode || !targetLabelRect) return null;
        const totalLength = nativeBranchNode.getTotalLength();
        const endClearance = Math.max(28, targetLabelRect.height / 2 + 16);
        const visibleLength = Math.max(0, totalLength - endClearance);
        const sampleCount = Math.max(2, Math.ceil(visibleLength / 8));
        const d = Array.from({ length: sampleCount + 1 }, (_unused, index) => {
          const point = nativeBranchNode.getPointAtLength(
            visibleLength * (index / sampleCount)
          );
          return `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
        }).join(' ');
        return {
          d,
          sourceNodeId: nativeBranch.attr('data-source-node-id') || '',
          targetNodeId
        };
      };
      const acceptedEnclosureRequests: Array<{
        nodeId: string;
        licence: 'remnant-landing' | 'carrier-chunk' | 'copy-occurrence';
        emphasis: 'active' | 'quiet' | null;
        item: RelationPlanItem;
      }> = [];
      const acceptedPartialCopyStrikeRequests: Array<{
        nodeId: string;
        emphasis: 'active' | 'quiet' | null;
        item: RelationPlanItem;
      }> = [];
      const acceptedDeletionTerminalStrikeRequests: Array<{
        domainNodeId: string;
        emphasis: 'active' | 'quiet' | null;
        item: RelationPlanItem;
      }> = [];
      const acceptedParasiticGapCopyRequests: Array<{
        contentNodeId: string;
        ordinaryGapNodeId: string;
        parasiticGapNodeIds: string[];
        emphasis: 'active' | 'quiet' | null;
        item: RelationPlanItem;
      }> = [];
      const relationEmphasisForItem = (
        item: RelationPlanItem
      ): 'active' | 'quiet' | null => focusedRelationMoment
        ? (planItemOwnsRelationMoment(
            item,
            focusedRelationMoment.stageIndex,
            focusedRelationMoment.relationIndex
          ) ? 'active' : 'quiet')
        : null;

      orderedPrimitives.forEach((primitive) => {
        /*
         * The Replay relation lens, uniform across every primitive type:
         * during a relation moment the played relation's marks (matched by
         * exact authored identity, including coalesced contributors) are
         * prominent and everything else visible stays present but quiet.
         */
        const planItem = frameItems[primitive.itemIndex];
        if (!planItem) return;
        // Future marks reserve geometry but are never drawn or focusable;
        // no mark draws while any of its syntax witnesses is hidden.
        if (!revealedItemIndices.has(primitive.itemIndex)) return;
        if (!primitiveWitnessesVisible(primitive)) return;
        const emphasis = relationEmphasisForItem(planItem);
        const host = overlay.append('g').attr('class', 'vr-item');
        const hostNode = host.node();
        if (hostNode) decorateRelationElement(hostNode, planItem, emphasis);
        host.attr('opacity', emphasis === 'quiet' ? 0.3 : null);
        primitiveHost = host;
        if (
          scheduleAcceptedAntiLocality(planItem, emphasis, primitive)
          || scheduleAcceptedImproperMovement(planItem, emphasis)
          || scheduleAcceptedSharingRelation(planItem, emphasis)
          || scheduleAcceptedPfRelation(planItem, emphasis)
          || scheduleAcceptedPfMorphologyRelation(planItem, emphasis)
          || scheduleAcceptedCyclicLinearization(planItem, emphasis)
          || scheduleAcceptedScopeInformationRelation(planItem, emphasis)
          || scheduleAcceptedFocusProminence(planItem, emphasis)
          || scheduleAcceptedThetaGrid(planItem, emphasis)
          || scheduleAcceptedIntervention(planItem, emphasis)
          || scheduleAcceptedLfReconstruction(planItem, emphasis)
        ) return;
        if (
          primitive.type === 'enclosure'
          && planItem.kind === 'enclosure'
        ) {
          acceptedEnclosureRequests.push({
            nodeId: planItem.nodeId,
            licence: planItem.licence,
            emphasis,
            item: planItem
          });
          return;
        }
        if (
          primitive.type === 'strike'
          && planItem.kind === 'strike-ghost'
          && planItem.familyId === 'copy.partial-deletion'
        ) {
          planItem.strikeNodeIds.forEach((nodeId) => {
            acceptedPartialCopyStrikeRequests.push({ nodeId, emphasis, item: planItem });
          });
          return;
        }
        if (primitive.type === 'native-branch-overlay') {
          const branches = primitive.targetNodeIds
            .map(sampleNativeBranchOverlay)
            .filter((branch): branch is NonNullable<typeof branch> => Boolean(branch));
          const sourceNodeIds = new Set(branches.map((branch) => branch.sourceNodeId));
          if (
            branches.length !== primitive.targetNodeIds.length
            || (primitive.requireSharedParent && (sourceNodeIds.size !== 1 || sourceNodeIds.has('')))
          ) return;

          const pairMerge = primitive.variant === 'pair-merge';
          const layer = pairMerge
            ? acceptedRootLayerBeforeNodes(
                pairMergeLayers,
                planItem,
                emphasis,
                'babel-pair-merge-relation-layer'
              )
            : acceptedLayerInHost(
                blockedExtractionLayers,
                planItem,
                'babel-blocked-extraction-relation-layer',
                host
              );
          branches.forEach((branch) => {
            layer.append('path')
              .attr('class', [
                'babel-native-branch-overlay',
                pairMerge
                  ? 'babel-pair-merge-branch'
                  : 'babel-blocked-extraction-adjunct-branch'
              ].join(' '))
              .attr('data-branch-source', branch.sourceNodeId)
              .attr('data-branch-target', branch.targetNodeId)
              .attr('d', branch.d);
          });
          if (pairMerge && planItem.kind === 'undirected-link') {
            const pair = planItem.pairs[0];
            if (pair) {
              markPreterminalLensNode(pair.fromNodeId, 'pair-member');
              markPreterminalLensNode(pair.toNodeId, 'pair-host');
            }
          }
          return;
        }
        if (
          primitive.type === 'strike'
          && planItem.kind === 'strike-ghost'
          && planItem.familyId === 'ellipsis.deletion'
        ) {
          planItem.strikeNodeIds.forEach((domainNodeId) => {
            acceptedDeletionTerminalStrikeRequests.push({ domainNodeId, emphasis, item: planItem });
          });
          return;
        }
        if (
          primitive.type === 'parasitic-gap-copy'
          && planItem.kind === 'parasitic-gap-copy'
        ) {
          acceptedParasiticGapCopyRequests.push({
            contentNodeId: primitive.contentNodeId,
            ordinaryGapNodeId: primitive.ordinaryGapNodeId,
            parasiticGapNodeIds: primitive.parasiticGapNodeIds,
            emphasis,
            item: planItem
          });
          return;
        }
        if (
          primitive.type === 'split-antecedence'
          && planItem.kind === 'split-antecedence'
        ) {
          const markerId = [
            'babel-split-antecedence-arrow',
            activeDerivationFrameIndex,
            planItem.relationRef.stageIndex,
            planItem.relationRef.relationIndex
          ].join('-');
          if (overlay.select(`#${markerId}`).empty()) {
            const marker = overlay.append('defs').append('marker')
              .attr('id', markerId)
              .attr('viewBox', '0 0 10 10')
              .attr('refX', 8.25)
              .attr('refY', 5)
              .attr('markerWidth', 7)
              .attr('markerHeight', 7)
              .attr('orient', 'auto')
              .attr('markerUnits', 'userSpaceOnUse');
            marker.append('path')
              .attr('class', 'babel-split-antecedence-arrowhead')
              .attr('d', 'M 0 0 L 10 5 L 0 10 z')
              .attr('fill', '#34d399')
              .attr('stroke', 'none');
          }
          primitive.links.forEach((link, linkIndex) => {
            host.append('path')
              .attr('class', 'babel-split-antecedence-path-shadow')
              .attr('data-split-antecedence-link-index', String(linkIndex))
              .attr('data-split-antecedence-link-count', String(primitive.links.length))
              .attr('data-split-antecedence-target-x', link.target.x.toFixed(1))
              .attr('data-split-antecedence-target-y', link.target.y.toFixed(1))
              .attr('data-vr-hit-target-installed', 'true')
              .attr('d', link.d)
              .attr('fill', 'none')
              .attr('stroke', 'rgba(2, 12, 8, 0.85)')
              .attr('stroke-width', 5.4)
              .attr('stroke-linecap', 'round')
              .attr('stroke-linejoin', 'round')
              .attr('vector-effect', 'non-scaling-stroke')
              .attr('pointer-events', 'none');
            host.append('path')
              .attr('class', 'babel-split-antecedence-path')
              .attr('data-split-antecedence-dependent', primitive.dependentNodeId)
              .attr('data-split-antecedence-antecedent', link.antecedentNodeId)
              .attr('data-split-antecedence-link-index', String(linkIndex))
              .attr('data-split-antecedence-link-count', String(primitive.links.length))
              .attr('data-split-antecedence-target-x', link.target.x.toFixed(1))
              .attr('data-split-antecedence-target-y', link.target.y.toFixed(1))
              .attr('d', link.d)
              .attr('fill', 'none')
              .attr('stroke', '#34d399')
              .attr('stroke-width', 2.4)
              .attr('stroke-linecap', 'round')
              .attr('stroke-linejoin', 'round')
              .attr('vector-effect', 'non-scaling-stroke')
              .attr('marker-end', `url(#${markerId})`);
          });
          const originSize = 10;
          host.append('rect')
            .attr('class', 'babel-split-antecedence-origin')
            .attr('data-split-antecedence-dependent', primitive.dependentNodeId)
            .attr('data-split-antecedence-origin-x', primitive.origin.x.toFixed(1))
            .attr('data-split-antecedence-origin-y', primitive.origin.y.toFixed(1))
            .attr('data-vr-hit-area', 'true')
            .attr('x', (primitive.origin.x - originSize / 2).toFixed(1))
            .attr('y', (primitive.origin.y - originSize / 2).toFixed(1))
            .attr('width', originSize.toFixed(1))
            .attr('height', originSize.toFixed(1))
            .attr('fill', 'rgba(1, 12, 8, 0.96)')
            .attr('stroke', '#34d399')
            .attr('stroke-width', 2)
            .attr('vector-effect', 'non-scaling-stroke');
          return;
        }
        if (primitive.type === 'trajectory-path') {
          /*
           * The compiled plan is the one semantic authority for authored
           * trajectories: every instance draws here, per-instance, with the
           * production movement styling and a deterministic fan for
           * coincident routes. The legacy movement adapter is gated off for
           * derivations the plan covers.
          */
          const acceptedTrajectoryClass = `babel-trajectory-path-${primitive.trajectoryKind}`;
          const trajectoryPlanItem = planItem.kind === 'trajectory' ? planItem : null;
          if (primitive.trajectoryKind === 'head' && trajectoryPlanItem) {
            clearMovedCopyClassForAnchors([
              trajectoryPlanItem.sourceNodeId,
              trajectoryPlanItem.witnessNodeId || ''
            ].filter(Boolean));
          }
          const relationLayer = ensureTrajectoryRelationLayer();
          const hostNode = host.node();
          if (hostNode && hostNode.parentNode !== relationLayer.node()) {
            relationLayer.node()?.appendChild(hostNode);
          }
          const usesBabelMovementCurve = [
            'phrasal',
            'phrasal-lowering',
            'head',
            'lowering',
            'atb',
            'parasitic-gap'
          ].includes(primitive.trajectoryKind);
          const canonicalAttributes = (path: d3.Selection<SVGPathElement, unknown, null, undefined>) => path
            .classed('babel-locality-path-failed', trajectoryPlanItem?.outcome === 'blocked')
            .attr('data-trajectory-relation', trajectoryPlanItem?.relationRef.relation || '')
            .attr('data-trajectory-kind', primitive.trajectoryKind)
            .attr('data-trajectory-from', trajectoryPlanItem?.sourceNodeId || '')
            .attr('data-trajectory-from-witness', trajectoryPlanItem?.witnessNodeId || null)
            .attr(
              'data-trajectory-orthogonal-departures',
              trajectoryPlanItem?.orthogonalDepartureNodeIds?.join(' ') || null
            )
            .attr('data-trajectory-to', trajectoryPlanItem?.targetNodeId || '')
            .attr('data-trajectory-geometry', usesBabelMovementCurve ? 'babel' : 'source-specific');
          canonicalAttributes(host.append('path')
            .attr('class', `${acceptedTrajectoryClass} babel-trajectory-path-shadow`)
            .attr('d', primitive.d));
          canonicalAttributes(host.append('path')
            .attr('class', [
              'vr-trajectory',
              `vr-trajectory-${primitive.trajectoryKind}`,
              'babel-trajectory-path',
              acceptedTrajectoryClass
            ].filter(Boolean).join(' '))
            .attr('data-trajectory-source-attachment', trajectoryPlanItem?.sourceAttachment || '')
            .attr('data-trajectory-target-attachment', trajectoryPlanItem?.targetAttachment || '')
            .attr(
              'marker-end',
              trajectoryPlanItem?.outcome === 'blocked' ? null : `url(#${primitive.trajectoryKind === 'smuggling'
                ? trajectoryMarkerIds.carrier
                : (usesBabelMovementCurve ? trajectoryMarkerIds.movement : trajectoryMarkerIds.open)})`
            )
            // The binder owns the exact movement path; draw it verbatim.
            .attr('d', primitive.d));
          return;
        }
        if (primitive.type === 'ghost-set') {
          /*
           * Silence styling for material the model itself authored silent —
           * never a rewrite of words or symbols, and never applied to overt
           * material. Ghost lens states are collected here and resolved
           * after the loop so that when several ellipsis claims share ghost
           * material, an active moment always wins over a quiet one.
           */
          const acceptedDeletion = planItem.familyId === 'ellipsis.deletion';
          const acceptedEllipsisStyle = acceptedDeletion
            || planItem.familyId === 'ellipsis.ghosting'
            || planItem.ellipsisStyle === 'recoverability';
          const nodeIds = acceptedDeletion && planItem.kind === 'ellipsis-site'
            ? planItem.siteSubtreeNodeIds
            : primitive.nodeIds;
          ghostLensRequests.push({
            nodeIds,
            siteNodeIds: planItem.kind === 'ellipsis-site' ? planItem.siteSubtreeNodeIds : [],
            antecedentNodeIds: planItem.kind === 'ellipsis-site'
              ? planItem.antecedentSubtreeNodeIds || []
              : [],
            emphasis,
            acceptedEllipsisStyle,
            item: planItem
          });
          return;
        }
        if (primitive.type === 'gapping-alignment') {
          host
            .attr('data-gapping-antecedent', primitive.antecedentNodeId)
            .attr('data-gapping-gap', primitive.gapNodeId)
            .attr('data-gapping-pairs', JSON.stringify(primitive.pairs.map((pair) => ({
              correlateNodeId: pair.correlateNodeId,
              remnantNodeId: pair.remnantNodeId,
              label: pair.label
            }))));
          const layer = host.append('g')
            .attr('class', 'babel-ellipsis-relation-layer babel-gapping-alignment-layer');
          const markerId = `babel-gapping-arrow-${planItem.relationRef.stageIndex}-${planItem.relationRef.relationIndex}`;
          const marker = layer.append('defs')
            .append('marker')
            .attr('id', markerId)
            .attr('viewBox', '0 0 10 10')
            .attr('refX', 8)
            .attr('refY', 5)
            .attr('markerWidth', 7)
            .attr('markerHeight', 7)
            .attr('orient', 'auto')
            .attr('markerUnits', 'userSpaceOnUse');
          marker.append('path')
            .attr('class', 'babel-gapping-arrowhead')
            .attr('d', 'M 1 1 L 9 5 L 1 9');
          const allPoints = [
            primitive.antecedent,
            primitive.gap,
            ...primitive.pairs.flatMap((pair) => [pair.correlate, pair.remnant])
          ];
          const laneBase = (d3.max(allPoints, (point) => point.y) ?? 0) + 200;
          const appendCorrespondence = (
            source: { x: number; y: number },
            target: { x: number; y: number },
            className: string,
            laneY: number
          ) => layer.append('path')
            .attr('class', `babel-gapping-correspondence ${className}`)
            .attr('marker-end', `url(#${markerId})`)
            .attr('d', [
              `M ${source.x.toFixed(1)} ${(source.y + 12.6).toFixed(1)}`,
              `C ${source.x.toFixed(1)} ${laneY.toFixed(1)}`,
              `${target.x.toFixed(1)} ${laneY.toFixed(1)}`,
              `${target.x.toFixed(1)} ${(target.y + 12.6).toFixed(1)}`
            ].join(' '));
          appendCorrespondence(
            primitive.antecedent,
            primitive.gap,
            'babel-gapping-correspondence-predicate',
            laneBase
          );
          primitive.pairs.forEach((pair, pairIndex) => {
            appendCorrespondence(
              pair.correlate,
              pair.remnant,
              'babel-gapping-correspondence-pair',
              laneBase + 44 + pairIndex * 38
            );
            layer.append('text')
              .attr('class', 'babel-gapping-index babel-relation-index')
              .attr('x', (pair.correlate.x + 38).toFixed(1))
              .attr('y', (pair.correlate.y - 9.4).toFixed(1))
              .text(pair.label);
            layer.append('text')
              .attr('class', 'babel-gapping-index babel-relation-index')
              .attr('x', (pair.remnant.x + 38).toFixed(1))
              .attr('y', (pair.remnant.y - 9.4).toFixed(1))
              .text(`=${pair.label}`);
          });
          const antecedentAnchor = resolveOverlayAnchor(primitive.antecedentNodeId);
          const antecedentTerminal = resolveMaterializedTerminal(
            antecedentAnchor,
            primitive.antecedentNodeId
          );
          if (antecedentTerminal) {
            const terminalId = getNodeId(antecedentTerminal as unknown as HierNode);
            g.selectAll<SVGTextElement, HierNode>('.terminal-label')
              .filter((candidate) => getNodeId(candidate) === terminalId)
              .classed('babel-lens-node', true)
              .attr('data-lens-role', 'ellipsis-antecedent')
              .each(function markProductionLensOwner() {
                (this as SVGTextElement & { __babelProductionLens?: true }).__babelProductionLens = true;
              });
          }
          return;
        }
        if (primitive.type === 'quantifier-raising') {
          host
            .attr('data-qr-pronounced', primitive.pronouncedNodeId)
            .attr('data-qr-lf', primitive.lfNodeId)
            .attr('data-qr-domain', primitive.scopeDomainNodeId || '');

          const coindexLayer = host.append('g')
            .attr('class', 'babel-coindex-relation-layer');
          coindexLayer.append('text')
            .attr('class', 'babel-binding-index babel-relation-index')
            .attr('x', 0)
            .attr('y', 0)
            .text(primitive.index);
          coindexLayer.append('text')
            .attr('class', 'babel-binding-index babel-relation-index')
            .attr('x', 0)
            .attr('y', 0)
            .text(primitive.index);

          const layer = host.append('g')
            .attr('class', 'babel-lf-relation-layer');
          const markerId = `babel-lf-arrow-${planItem.relationRef.stageIndex}-${planItem.relationRef.relationIndex}`;
          const marker = layer.append('defs')
            .append('marker')
            .attr('id', markerId)
            .attr('markerWidth', 34)
            .attr('markerHeight', 34)
            .attr('refX', 22)
            .attr('refY', 17)
            .attr('orient', 'auto')
            .attr('markerUnits', 'userSpaceOnUse')
            .attr('overflow', 'visible');
          marker.append('path')
            .attr('class', 'babel-lf-arrowhead')
            .attr('d', 'M 7 25 L 22 17 L 7 9');
          if (primitive.scopeDomainNodeId) {
            layer.append('rect')
              .attr('class', 'babel-lf-domain')
              .attr('data-lf-domain-kind', 'scope')
              .attr('x', 0)
              .attr('y', 0)
              .attr('width', 0)
              .attr('height', 0)
              .attr('rx', 18);
          }
          layer.append('path')
            .attr('class', 'babel-lf-path babel-lf-path-qr')
            .attr('marker-end', `url(#${markerId})`)
            .attr('d', '');
          layer.append('g');
          return;
        }
        if (primitive.type === 'operator-variable-binding') {
          const rank = operatorVariableScopeRankByItem.get(primitive.itemIndex) || 0;
          const palette = ['#10b981', '#c98a3d', '#e6efeb'];
          const color = palette[rank % palette.length];
          const relationLayer = acceptedRootLayerBeforeNodes(
            operatorVariableBindingLayers,
            planItem,
            null,
            'babel-operator-variable-relation-layer'
          );
          const hostNode = host.node();
          if (hostNode && hostNode.parentNode !== relationLayer.node()) {
            relationLayer.node()?.appendChild(hostNode);
          }
          host
            .attr('data-operator-variable-operator', primitive.operatorNodeId)
            .attr('data-operator-variable-variable', primitive.variableNodeId)
            .attr('data-operator-variable-witness', primitive.traceWitnessNodeId || '')
            .attr('data-operator-variable-domain', primitive.scopeDomainNodeId || '')
            .attr('data-operator-variable-rank', String(rank))
            .attr('data-operator-variable-count', String(operatorVariableScopeItems.length || 1))
            .attr('data-operator-variable-color', color);

          const markerId = `babel-operator-variable-arrow-${planItem.relationRef.stageIndex}-${planItem.relationRef.relationIndex}`;
          const marker = host.append('defs').append('marker')
            .attr('id', markerId)
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 8.5)
            .attr('refY', 0)
            .attr('markerWidth', 11)
            .attr('markerHeight', 11)
            .attr('orient', 'auto')
            .attr('markerUnits', 'userSpaceOnUse');
          marker.append('path')
            .attr('class', 'babel-operator-variable-arrowhead')
            .attr('d', 'M 1 -4 L 8.5 0 L 1 4')
            .attr('fill', 'none')
            .attr('stroke', color)
            .attr('stroke-opacity', 0.92)
            .attr('stroke-width', 1.15)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round');

          if (primitive.scopeDomainNodeId) {
            host.append('path')
              .attr('class', 'babel-operator-variable-domain')
              .attr('data-operator-variable-domain-shape', primitive.scopeDomainNodeId)
              .attr('fill', color)
              .attr('fill-opacity', rank === 0 ? 0.12 : 0.105)
              .attr('stroke', color)
              .attr('stroke-opacity', rank % palette.length === 2 ? 0.78 : 0.88)
              .attr('stroke-width', rank % palette.length === 2 ? 3.2 : 3)
              .attr('stroke-dasharray', rank % palette.length === 2 ? '12 8' : '10 9')
              .attr('stroke-linejoin', 'round')
              .attr('vector-effect', 'non-scaling-stroke');
          }
          host.append('path')
            .attr('class', 'babel-operator-variable-path')
            .attr('fill', 'none')
            .attr('stroke', color)
            .attr('stroke-opacity', 0.9)
            .attr('stroke-width', 1.2)
            .attr('stroke-linecap', 'round')
            .attr('marker-end', `url(#${markerId})`)
            .attr('vector-effect', 'non-scaling-stroke');
          ['operator', 'variable'].forEach((role) => {
            host.append('text')
              .attr('class', 'babel-binding-index babel-relation-index babel-operator-variable-index')
              .attr('data-operator-variable-index-role', role)
              .attr('fill', color)
              .style('font-size', '28px')
              .style('font-weight', '900')
              .style('font-style', 'italic')
              .style('paint-order', 'stroke')
              .style('stroke', '#020806')
              .style('stroke-width', '7px')
              .style('stroke-linejoin', 'round')
              .text(primitive.index);
          });
          return;
        }
        if (primitive.type === 'shape-path') {
          const acceptedAnchorRect = (nodeId: string) =>
            measuredTreeLabelRectNow(nodeId, false)
            || measuredTerminalSubtreeRectNow(nodeId);
          const acceptedTerminalRect = (nodeId: string) =>
            measuredTerminalSubtreeRectNow(nodeId)
            || measuredTreeLabelRectNow(nodeId, false);
          const refValue = (name: string, fallback = '') => {
            const value = planItem.relationRef.values?.[name];
            return Array.isArray(value) ? String(value[0] || fallback) : String(value || fallback);
          };
          const opacity = emphasis === 'quiet' ? 0.3 : null;

          if (primitive.shapeStyle === 'fong-component-arc') {
            queueAcceptedRelationDraw(planItem, emphasis, () => {
              const component = planItem.kind === 'fong-component' ? planItem : null;
              if (!component) return;
              const headRect = measuredTreeLabelRectNow(component.headNodeId, false);
              if (!headRect) return;
              const { foreground } = ensureDomainLocalityLayers();
              const phase = component.componentLabel === 'Phase';
              const path = fongComponentArcPath(headRect);
              const label = fongComponentLabelPoint(headRect);
              const beforeEdgeLabel = phase ? '.babel-transfer-edge-label' : null;
              foreground.insert('path', beforeEdgeLabel)
                .attr('class', phase
                  ? 'babel-transfer-phase-arc-shadow'
                  : 'babel-transfer-domain-arc-shadow')
                .attr('d', path)
                .attr('opacity', opacity);
              foreground.insert('path', beforeEdgeLabel)
                .attr('class', phase
                  ? 'babel-transfer-phase-arc'
                  : 'babel-transfer-domain-arc')
                .attr('d', path)
                .attr('opacity', opacity);
              foreground.insert('text', beforeEdgeLabel)
                .attr('class', 'babel-transfer-component-label')
                .attr('x', label.x.toFixed(1))
                .attr('y', label.y.toFixed(1))
                .attr('opacity', opacity)
                .text(component.componentLabel);
            });
            return;
          }

          if (primitive.shapeStyle === 'transfer-access') {
            queueAcceptedRelationDraw(planItem, emphasis, () => {
              const access = planItem.kind === 'blocked-access-lane' ? planItem : null;
              if (!access) return;
              const source = acceptedTerminalRect(access.sourceNodeId)
                || acceptedAnchorRect(access.sourceNodeId);
              const target = acceptedTerminalRect(access.targetNodeId)
                || acceptedAnchorRect(access.targetNodeId);
              const domainRoot = access.subtreeDerived?.[0]?.rootNodeId || '';
              const domain = domainRoot ? measuredTreeLabelRectNow(domainRoot, true) : null;
              if (!source || !target || !domain) return;
              const start = {
                x: source.x + source.width / 2,
                y: source.y + source.height + 12
              };
              /*
               * The lane's arrowhead meets the target's rendered terminal
               * glyph (+6, the shared meets-the-glyph clearance) instead of
               * hanging 12px beneath it.
               */
              const end = {
                x: target.x + target.width / 2,
                y: target.y + target.height + 6
              };
              const lane = transferAccessLanePath(start, end, domain.y + domain.height);
              const { foreground, markerId } = ensureDomainLocalityLayers();
              foreground.append('path')
                .attr('class', 'babel-transfer-access-shadow')
                .attr('d', lane.d)
                .attr('opacity', opacity);
              foreground.append('path')
                .attr('class', 'babel-transfer-access-path')
                .attr('d', lane.d)
                .attr('marker-end', `url(#${markerId})`)
                .attr('opacity', opacity);
              foreground.append('circle')
                .attr('class', 'babel-transfer-access-origin')
                .attr('cx', start.x.toFixed(1))
                .attr('cy', start.y.toFixed(1))
                .attr('r', '8.0')
                .attr('opacity', opacity);
              const cross = { x: (start.x + end.x) / 2, y: lane.laneY };
              [[-17, -17, 17, 17], [17, -17, -17, 17]].forEach(([x1, y1, x2, y2]) => {
                foreground.append('line')
                  .attr('class', 'babel-domain-locality-x-shadow')
                  .attr('x1', (cross.x + x1).toFixed(1))
                  .attr('y1', (cross.y + y1).toFixed(1))
                  .attr('x2', (cross.x + x2).toFixed(1))
                  .attr('y2', (cross.y + y2).toFixed(1))
                  .attr('opacity', opacity);
                foreground.append('line')
                  .attr('class', 'babel-domain-locality-x')
                  .attr('x1', (cross.x + x1).toFixed(1))
                  .attr('y1', (cross.y + y1).toFixed(1))
                  .attr('x2', (cross.x + x2).toFixed(1))
                  .attr('y2', (cross.y + y2).toFixed(1))
                  .attr('opacity', opacity);
              });
            });
            return;
          }

          if (primitive.shapeStyle === 'agree-multiple'
            || primitive.shapeStyle === 'agree-cyclic') {
            queueAcceptedRelationDraw(planItem, emphasis, () => {
              const pathItem = planItem.kind === 'directed-path' ? planItem : null;
              if (!pathItem) return;
              const fromRect = acceptedAnchorRect(pathItem.fromNodeId);
              const toRect = acceptedAnchorRect(pathItem.toNodeId);
              if (!fromRect || !toRect) return;
              const layer = ensureAgreementCaseRelationLayer();
              const markerId = `babel-agree-arrow-${activeDerivationFrameIndex}`;
              const previousCyclicPath = primitive.shapeStyle === 'agree-cyclic'
                ? layer.select<SVGPathElement>('.babel-agree-directed-path-cyclic').node()
                : null;
              const directed = layer.append('path')
              .attr('class', [
                'babel-agree-directed-path',
                primitive.shapeStyle === 'agree-multiple'
                  ? 'babel-agree-directed-path-multiple'
                  : 'babel-agree-directed-path-cyclic'
              ].join(' '))
              .attr('marker-end', `url(#${markerId})`)
              .attr('opacity', opacity);
            let badgePoint: { x: number; y: number } | null = null;
            if (primitive.shapeStyle === 'agree-multiple') {
              const peers = frameItems
                .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
                .filter(({ candidate }) =>
                  candidate.kind === 'directed-path'
                  && candidate.pathStyle === 'agree-multiple'
                  && candidate.relationRef.stageIndex === planItem.relationRef.stageIndex
                  && candidate.relationRef.relationIndex === planItem.relationRef.relationIndex)
                .sort((left, right) => {
                  const leftRect = left.candidate.kind === 'directed-path'
                    ? acceptedAnchorRect(left.candidate.toNodeId)
                    : null;
                  const rightRect = right.candidate.kind === 'directed-path'
                    ? acceptedAnchorRect(right.candidate.toNodeId)
                    : null;
                  return (leftRect?.y ?? 0) - (rightRect?.y ?? 0);
                });
              const pathIndex = Math.max(0, peers.findIndex(({ candidateIndex }) =>
                candidateIndex === primitive.itemIndex));
              const source = {
                x: fromRect.x + fromRect.width * 0.5,
                y: fromRect.y + fromRect.height
              };
              const target = {
                x: toRect.x - 18,
                y: toRect.y + toRect.height * 0.62
              };
              if (pathIndex === 0) {
                const c1 = { x: source.x - 48, y: source.y + 76 };
                const c2 = { x: target.x - 64, y: target.y + 58 };
                directed.attr('d', [
                  `M ${source.x.toFixed(1)} ${source.y.toFixed(1)}`,
                  `C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)},`,
                  `${c2.x.toFixed(1)} ${c2.y.toFixed(1)},`,
                  `${target.x.toFixed(1)} ${target.y.toFixed(1)}`
                ].join(' '));
              } else {
                const treeRect = measuredTreeLabelRectNow(
                  getNodeId(treeData as unknown as HierNode),
                  true
                );
                const outsideX = Math.max(
                  26,
                  Math.min((treeRect?.x ?? Math.min(source.x, target.x)) - 72, source.x - 150)
                );
                const bottomY = treeRect
                  ? treeRect.y + treeRect.height + 74
                  : Math.max(source.y, target.y) + 220;
                const turn = { x: outsideX + 36, y: bottomY };
                directed.attr('d', [
                  `M ${source.x.toFixed(1)} ${source.y.toFixed(1)}`,
                  `C ${outsideX.toFixed(1)} ${(source.y + 120).toFixed(1)},`,
                  `${outsideX.toFixed(1)} ${(bottomY - 40).toFixed(1)},`,
                  `${turn.x.toFixed(1)} ${turn.y.toFixed(1)}`,
                  `C ${(turn.x + 36).toFixed(1)} ${(turn.y + 40).toFixed(1)},`,
                  `${(target.x - 96).toFixed(1)} ${(bottomY + 12).toFixed(1)},`,
                  `${target.x.toFixed(1)} ${target.y.toFixed(1)}`
                ].join(' '));
              }
            } else {
              const cycle = primitive.badge?.text || refValue('cycle');
              if (cycle === '1') {
                const source = {
                  x: fromRect.x + fromRect.width * 0.45,
                  y: fromRect.y + fromRect.height
                };
                const target = {
                  x: toRect.x - 18,
                  y: toRect.y + toRect.height * 0.62
                };
                const c1 = { x: source.x - 22, y: source.y + 58 };
                const c2 = { x: target.x - 48, y: target.y + 48 };
                directed.attr('d', [
                  `M ${source.x.toFixed(1)} ${source.y.toFixed(1)}`,
                  `C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)},`,
                  `${c2.x.toFixed(1)} ${c2.y.toFixed(1)},`,
                  `${target.x.toFixed(1)} ${target.y.toFixed(1)}`
                ].join(' '));
                badgePoint = {
                  x: (source.x + 3 * c1.x + 3 * c2.x + target.x) / 8 - 10,
                  y: (source.y + 3 * c1.y + 3 * c2.y + target.y) / 8 + 16
                };
              } else {
                const source = {
                  x: fromRect.x,
                  y: fromRect.y + fromRect.height * 0.48
                };
                const target = {
                  x: toRect.x + toRect.width + 18,
                  y: toRect.y + toRect.height * 0.55
                };
                const arcY = Math.max(18, Math.min(fromRect.y, toRect.y) - 46);
                const c1 = { x: source.x - 12, y: arcY };
                const c2 = { x: target.x + 64, y: arcY };
                directed.attr('d', [
                  `M ${source.x.toFixed(1)} ${source.y.toFixed(1)}`,
                  `C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)},`,
                  `${c2.x.toFixed(1)} ${c2.y.toFixed(1)},`,
                  `${target.x.toFixed(1)} ${target.y.toFixed(1)}`
                ].join(' '));
                badgePoint = {
                  x: (source.x + 3 * c1.x + 3 * c2.x + target.x) / 8,
                  y: (source.y + 3 * c1.y + 3 * c2.y + target.y) / 8 - 14
                };
              }
              if (cycle && badgePoint) {
                const badge = layer.append('g')
                  .attr('class', 'babel-agree-cycle-badge')
                  .attr('opacity', opacity);
                badge.append('circle')
                  .attr('cx', badgePoint.x.toFixed(1))
                  .attr('cy', badgePoint.y.toFixed(1))
                  .attr('r', 26);
                badge.append('text')
                  .attr('class', 'babel-relation-index')
                  .attr('x', badgePoint.x.toFixed(1))
                  .attr('y', (badgePoint.y + 12).toFixed(1))
                  .attr('text-anchor', 'middle')
                  .text(`C${cycle}`);
                if (pathItem.secondaryLabel) badge.append('text')
                  .attr('class', 'babel-agree-outcome')
                  .attr('x', (badgePoint.x + 38).toFixed(1))
                  .attr('y', (badgePoint.y + 6).toFixed(1))
                  .style('font-size', '18px')
                  .text(pathItem.secondaryLabel);
                if (cycle !== '1' && previousCyclicPath?.parentNode === layer.node()) {
                  layer.node()?.insertBefore(directed.node(), previousCyclicPath);
                  layer.node()?.insertBefore(badge.node(), previousCyclicPath);
                }
              }
            }
            });
            return;
          }

          if (primitive.shapeStyle === 'feature-sharing-vine'
            || primitive.shapeStyle === 'feature-sharing-label') {
            queueAcceptedRelationDraw(planItem, emphasis, () => {
              if (renderedFeatureSharingItems.has(primitive.itemIndex)) return;
              renderedFeatureSharingItems.add(primitive.itemIndex);
              const sharingItem = planItem.kind === 'undirected-link' ? planItem : null;
              if (!sharingItem) return;
              const bearerIds = [
              ...new Set<string>(sharingItem.pairs.flatMap((pair) => [pair.fromNodeId, pair.toNodeId]))
            ];
            const bearerRects = bearerIds
              .map((nodeId) => ({ nodeId, rect: acceptedTerminalRect(nodeId) }))
              .filter((entry): entry is { nodeId: string; rect: { x: number; y: number; width: number; height: number } } =>
                Boolean(entry.rect));
            if (bearerRects.length < 2) return;
            const layer = ensureAgreementCaseRelationLayer();
            bearerIds.forEach((nodeId) => markPreterminalLensNode(nodeId, 'feature-bearer'));
            const convergence = vineConvergence(bearerRects.map(entry => entry.rect));
            bearerRects.forEach(({ rect }) => {
              const start = {
                x: rect.x + rect.width / 2,
                y: rect.y + rect.height + 22
              };
              layer.append('path')
                .attr('class', 'babel-feature-sharing-vine')
                .attr('opacity', opacity)
                .attr('d', featureSharingVinePath(start, convergence));
            });
            const [feature, ...valueParts] = String(sharingItem.label || '').split(':');
            const value = valueParts.join(':').trim();
            const { x: plaqueX, y: plaqueY, width: plaqueWidth, height: plaqueHeight } =
              featureSharingPlaqueRect(bearerRects.map(entry => entry.rect));
            const plaque = layer.append('g')
              .attr('class', 'babel-feature-plaque babel-shared-feature-plaque')
              .attr('data-feature-anchor', 'shared-feature')
              .attr('data-feature-placement', 'accepted')
              .attr('opacity', opacity);
            plaque.append('rect')
              .attr('class', 'babel-feature-plaque-shell')
              .attr('x', plaqueX.toFixed(1))
              .attr('y', plaqueY.toFixed(1))
              .attr('width', plaqueWidth.toFixed(1))
              .attr('height', plaqueHeight.toFixed(1))
              .attr('rx', 12);
            plaque.append('text')
              .attr('class', 'babel-feature-plaque-title')
              .attr('x', (plaqueX + 18).toFixed(1))
              .attr('y', (plaqueY + 28).toFixed(1))
              .text('SHARED FEATURE');
            plaque.append('text')
              .attr('class', 'babel-feature-text')
              .attr('x', (plaqueX + 18).toFixed(1))
              .attr('y', (plaqueY + 69).toFixed(1))
              .text(`[${feature.trim()}: ${value}]`);
            });
            return;
          }

          if (primitive.shapeStyle === 'case-assignment'
            || primitive.shapeStyle === 'case-agree') {
            queueAcceptedRelationDraw(planItem, emphasis, () => {
              const pathItem = planItem.kind === 'directed-path' ? planItem : null;
              if (!pathItem) return;
              const assignmentEntries = frameItems
              .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
              .filter(({ candidate }) =>
                candidate.kind === 'directed-path'
                && candidate.pathStyle === 'case-assignment'
                && candidate.relationRef.stageIndex === pathItem.relationRef.stageIndex
                && candidate.toNodeId === (pathItem.pathStyle === 'case-assignment'
                  ? pathItem.toNodeId
                  : pathItem.fromNodeId));
            const assignmentEntry = pathItem.pathStyle === 'case-assignment'
              ? assignmentEntries.find(({ candidate }) => candidate === pathItem)
              : assignmentEntries.length === 1 ? assignmentEntries[0] : undefined;
            if (!assignmentEntry && pathItem.pathStyle === 'case-agree') {
              const layer = ensureAgreementCaseRelationLayer();
              layer.append('path').attr('class', 'babel-case-collection-path').attr('d', primitive.d);
              const target = acceptedAnchorRect(pathItem.toNodeId);
              const row = pathItem.featureRow;
              if (target && (row?.label || row?.value || pathItem.label)) {
                layer.append('text').attr('class', 'babel-feature-text')
                  .attr('x', target.x).attr('y', target.y + target.height + 36)
                  .text(row ? [row.label, row.value].filter(Boolean).join(': ') : pathItem.label || '');
              }
              return;
            }
            if (!assignmentEntry || assignmentEntry.candidate.kind !== 'directed-path') return;
            const assignment = assignmentEntry.candidate;
            const compositionKey = `${relationLayerKey(assignment)}:${assignment.fromNodeId}:${assignment.toNodeId}`;
            if (renderedCaseCompositions.has(compositionKey)) return;
            renderedCaseCompositions.add(compositionKey);
            if (!revealedItemIndices.has(assignmentEntry.candidateIndex)) return;
            ensureFeatureRelationLayer();
            const layer = ensureAgreementCaseRelationLayer();
            const assignerRect = acceptedTerminalRect(assignment.fromNodeId);
            const bearerRect = acceptedAnchorRect(assignment.toNodeId);
            if (!assignerRect || !bearerRect) return;
            markPreterminalLensNode(assignment.fromNodeId, 'case-assigner');
            const collectionEntries = frameItems
              .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
              .filter(({ candidate }) =>
                candidate.kind === 'directed-path'
                && candidate.pathStyle === 'case-agree'
                && assignmentEntries.length === 1
                && candidate.relationRef.stageIndex === assignment.relationRef.stageIndex
                && candidate.fromNodeId === assignment.toNodeId);
            const bundleEntries = frameItems
              .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
              .filter(({ candidate }) =>
                candidate.kind === 'node-plaque'
                && candidate.plaqueStyle === 'feature'
                && candidate.relationRef.stageIndex === assignment.relationRef.stageIndex
                && candidate.anchorNodeIds[0] === assignment.toNodeId);
            const bundleEntry = bundleEntries.length === 1 && assignmentEntries.length === 1 ? bundleEntries[0] : undefined;
            const assignmentPair = assignment.featureRow || { label: '', value: assignment.label || '' };
            const collectionPairs = collectionEntries.map(({ candidate, candidateIndex }) => ({
              candidate,
              candidateIndex,
              pair: candidate.kind === 'directed-path'
                ? candidate.featureRow || { label: '', value: candidate.label || '' }
                : { label: '', value: '' }
            }));
            const authoredRows = bundleEntry?.candidate.kind === 'node-plaque'
              ? bundleEntry.candidate.rows
              : [assignmentPair, ...collectionPairs.map(({ pair }) => pair)];
            const rows = authoredRows.map((row) => {
              if (row.label === assignmentPair.label) {
                return {
                  feature: row.label,
                  value: revealedItemIndices.has(assignmentEntry.candidateIndex)
                    ? assignmentPair.value
                    : '__'
                };
              }
              const collection = collectionPairs.find(({ pair }) => pair.label === row.label);
              return {
                feature: row.label,
                value: collection && revealedItemIndices.has(collection.candidateIndex)
                  ? collection.pair.value
                  : collection ? '__' : row.value
              };
            });
            const plaqueWidth = 310;
            const headerHeight = 62;
            const rowHeight = 62;
            const plaqueHeight = headerHeight + rows.length * rowHeight + 14;
            const placement = replayPlaqueLayout.get(assignmentEntry.candidateIndex);
            if (!placement) return;
            const plaqueX = placement.x;
            const plaqueY = placement.y;
            const plaque = layer.append('g')
              .attr('class', 'babel-feature-plaque babel-case-feature-plaque')
              .attr('data-feature-anchor', assignment.toNodeId)
              .attr('data-feature-placement', 'accepted')
              .attr('opacity', bundleEntry && focusedRelationMoment
                && planItemOwnsRelationMoment(
                  bundleEntry.candidate,
                  focusedRelationMoment.stageIndex,
                  focusedRelationMoment.relationIndex
                ) ? null : opacity);
            const plaqueOwner = bundleEntry?.candidate || assignment;
            const plaqueNode = plaque.node();
            if (plaqueNode) {
              decorateRelationElement(
                plaqueNode,
                plaqueOwner,
                relationEmphasisForItem(plaqueOwner)
              );
            }
            plaque.append('rect')
              .attr('class', 'babel-feature-plaque-shell')
              .attr('x', plaqueX.toFixed(1))
              .attr('y', plaqueY.toFixed(1))
              .attr('width', plaqueWidth.toFixed(1))
              .attr('height', plaqueHeight.toFixed(1))
              .attr('rx', 12);
            plaque.append('text')
              .attr('class', 'babel-feature-plaque-title')
              .attr('x', (plaqueX + 20).toFixed(1))
              .attr('y', (plaqueY + 32).toFixed(1))
              .text('CASE / AGREEMENT');
            const rowTargets = new Map<string, { left: { x: number; y: number }; right: { x: number; y: number } }>();
            rows.forEach((row, rowIndex) => {
              const rowY = plaqueY + headerHeight + rowIndex * rowHeight + rowHeight / 2;
              const rowGroup = plaque.append('g')
                .attr('class', 'babel-feature-row')
                .attr('data-feature-label', row.feature);
              rowGroup.append('text')
                .attr('class', 'babel-feature-text')
                .attr('x', (plaqueX + 22).toFixed(1))
                .attr('y', rowY.toFixed(1))
                .attr('dominant-baseline', 'middle')
                .text(`[${row.feature}: ${row.value}]`);
              rowTargets.set(row.feature, {
                left: { x: plaqueX - 12, y: rowY },
                right: { x: plaqueX + plaqueWidth + 12, y: rowY }
              });
            });
            const caseTarget = rowTargets.get(assignmentPair.label)?.left;
            if (caseTarget) {
              const assignmentPath = layer.append('path')
                .attr('class', 'babel-case-assignment-path')
                .attr('opacity', focusedRelationMoment && planItemOwnsRelationMoment(
                  assignment,
                  focusedRelationMoment.stageIndex,
                  focusedRelationMoment.relationIndex
                ) ? null : opacity)
                .attr('marker-end', `url(#babel-agree-arrow-${activeDerivationFrameIndex})`)
                .attr('d', caseAssignmentPlaquePath(assignerRect,
                  { x: plaqueX, y: plaqueY, width: plaqueWidth, height: plaqueHeight }, caseTarget.y));
              const assignmentPathNode = assignmentPath.node();
              if (assignmentPathNode) {
                decorateRelationElement(
                  assignmentPathNode,
                  assignment,
                  relationEmphasisForItem(assignment)
                );
              }
            }
            collectionPairs.forEach(({ candidate, candidateIndex, pair }, pathIndex) => {
              if (candidate.kind !== 'directed-path' || !revealedItemIndices.has(candidateIndex)) return;
              const sourceRect = acceptedAnchorRect(candidate.toNodeId);
              const target = rowTargets.get(pair.label)?.right;
              if (!sourceRect || !target) return;
              const source = { x: sourceRect.x, y: sourceRect.y + sourceRect.height / 2 };
              const laneOffset = 68 + pathIndex * 24;
              const firstControl = { x: target.x + laneOffset, y: target.y };
              const secondControl = { x: source.x - laneOffset, y: source.y };
              const collectionPath = layer.append('path')
                .attr('class', 'babel-case-collection-path')
                .attr('opacity', focusedRelationMoment && planItemOwnsRelationMoment(
                  candidate,
                  focusedRelationMoment.stageIndex,
                  focusedRelationMoment.relationIndex
                ) ? null : opacity)
                .attr('d', [
                  `M ${target.x.toFixed(1)} ${target.y.toFixed(1)}`,
                  `C ${firstControl.x.toFixed(1)} ${firstControl.y.toFixed(1)},`,
                  `${secondControl.x.toFixed(1)} ${secondControl.y.toFixed(1)},`,
                  `${source.x.toFixed(1)} ${source.y.toFixed(1)}`
                ].join(' '));
              const collectionPathNode = collectionPath.node();
              if (collectionPathNode) {
                decorateRelationElement(
                  collectionPathNode,
                  candidate,
                  relationEmphasisForItem(candidate)
                );
              }
            });
            });
            return;
          }

          if (primitive.shapeStyle === 'dependent-case') {
            queueAcceptedRelationDraw(planItem, emphasis, () => {
              const pathItem = planItem.kind === 'directed-path' ? planItem : null;
              if (!pathItem) return;
              const probeRect = acceptedAnchorRect(pathItem.fromNodeId);
              const probeTerminalRect = acceptedTerminalRect(pathItem.fromNodeId);
              const goalCategoryRect = acceptedAnchorRect(pathItem.toNodeId);
              const goalTerminalRect = acceptedTerminalRect(pathItem.toNodeId);
              if (!probeRect || !probeTerminalRect || !goalCategoryRect || !goalTerminalRect) return;
              const layer = ensureAgreementCaseRelationLayer();
              markPreterminalLensNode(pathItem.fromNodeId, 'probe');
              const step = pathItem.dependentCaseStep || '2';
              const probeIsHigher = probeRect.y + probeRect.height / 2 <= goalCategoryRect.y + goalCategoryRect.height / 2;
              const states = dependentCaseStatePlaques(probeTerminalRect, goalTerminalRect,
                primitive.label || '', primitive.badge?.text || '', step, probeIsHigher);
              const appendState = (label: string, kind: 'probe' | 'goal') => {
              const { x: plaqueX, y: plaqueY, width: plaqueWidth, height: plaqueHeight } = states[kind];
              const centreY = plaqueY + plaqueHeight / 2;
              const group = layer.append('g')
                .attr('class', `babel-dependent-case-state-plaque babel-dependent-case-state-plaque-${kind}`)
                .attr('opacity', opacity);
              group.append('rect')
                .attr('class', 'babel-feature-plaque-shell')
                .attr('x', plaqueX.toFixed(1))
                .attr('y', plaqueY.toFixed(1))
                .attr('width', plaqueWidth.toFixed(1))
                .attr('height', plaqueHeight.toFixed(1))
                .attr('rx', 11);
              group.append('text')
                .attr('class', `babel-dependent-case-state babel-dependent-case-state-${kind}`)
                .attr('x', (plaqueX + 20).toFixed(1))
                .attr('y', centreY.toFixed(1))
                .attr('dominant-baseline', 'middle')
                .text(label);
              return {
                left: plaqueX,
                bottom: plaqueY + plaqueHeight,
                centreX: plaqueX + plaqueWidth / 2,
                centreY
              };
            };
            const probeLabel = primitive.label || '';
            const goalLabel = primitive.badge?.text || '';
            let endpoints: Array<{ x: number; y: number }>;
            let commands: string[];
            if (step === '1') {
              const probeState = appendState(probeLabel, 'probe');
              const goalState = appendState(goalLabel, 'goal');
              const probePoint = { x: probeState.left - 14, y: probeState.centreY };
              const goalPoint = { x: goalState.left - 14, y: goalState.centreY };
              const gutterX = Math.min(probePoint.x, goalPoint.x) - 66;
              endpoints = [probePoint, goalPoint];
              commands = [
                `M ${probePoint.x.toFixed(1)} ${probePoint.y.toFixed(1)}`,
                `L ${gutterX.toFixed(1)} ${probePoint.y.toFixed(1)}`,
                `L ${gutterX.toFixed(1)} ${goalPoint.y.toFixed(1)}`,
                `L ${goalPoint.x.toFixed(1)} ${goalPoint.y.toFixed(1)}`
              ];
            } else {
              const upperKind = probeIsHigher ? 'probe' : 'goal';
              const lowerKind = probeIsHigher ? 'goal' : 'probe';
              const upperLabel = probeIsHigher ? probeLabel : goalLabel;
              const lowerLabel = probeIsHigher ? goalLabel : probeLabel;
              const upperState = appendState(upperLabel, upperKind);
              const lowerState = appendState(lowerLabel, lowerKind);
              const upperPoint = { x: upperState.centreX, y: upperState.bottom + 14 };
              const lowerPoint = { x: lowerState.left - 14, y: lowerState.centreY };
              endpoints = [upperPoint, lowerPoint];
              commands = [
                `M ${upperPoint.x.toFixed(1)} ${upperPoint.y.toFixed(1)}`,
                `L ${upperPoint.x.toFixed(1)} ${lowerPoint.y.toFixed(1)}`,
                `L ${lowerPoint.x.toFixed(1)} ${lowerPoint.y.toFixed(1)}`
              ];
            }
            layer.append('path')
              .attr('class', 'babel-dependent-case-elbow')
              .attr('opacity', opacity)
              .attr('d', commands.join(' '));
            endpoints.forEach((point) => {
              layer.append('circle')
                .attr('class', 'babel-dependent-case-endpoint')
                .attr('opacity', opacity)
                .attr('cx', point.x.toFixed(1))
                .attr('cy', point.y.toFixed(1))
                .attr('r', 9);
            });
            });
            return;
          }

          /*
           * Family-specific accepted shapes: the binder already computed the
           * exact accepted path data and decorations from the pure mark
           * geometry; this branch draws precisely what is declared and
           * restyles nothing from a name.
           */
          const blocked = primitive.blocked === true;
          const strokeColor = blocked ? '#f87171' : '#34d399';
          if (
            primitive.shapeStyle === 'control'
            && planItem.familyId === 'control.dependency'
            && planItem.kind === 'directed-path'
          ) {
            const layer = ensureControlRelationLayer(planItem, emphasis);
            const markerId = `babel-control-arrow-${planItem.relationRef.stageIndex}-${planItem.relationRef.relationIndex}`;
            layer.append('path')
              .attr('class', 'babel-control-dependency')
              .attr('fill', 'none')
              .attr('data-control-controller', planItem.fromNodeId)
              .attr('data-control-controllee', planItem.toNodeId)
              .attr('marker-end', `url(#${markerId})`)
              .attr('d', primitive.d);
            return;
          }
          if (
            primitive.shapeStyle === 'predication'
            && planItem.familyId === 'predication.paths'
            && planItem.kind === 'undirected-link'
          ) {
            const layer = acceptedRootLayerAfterNodes(
              predicationRelationLayers,
              planItem,
              emphasis,
              'babel-predication-relation-layer'
            );
            const pair = planItem.pairs[layer.selectAll('.babel-predication-path').size()];
            if (!pair) return;
            markPreterminalLensNode(pair.toNodeId, 'predicate');
            layer.append('path')
              .attr('class', 'babel-predication-path')
              .attr('data-predicand', pair.fromNodeId)
              .attr('data-predicate', pair.toNodeId)
              .attr('d', primitive.d);
            return;
          }
          if (primitive.shapeStyle === 'phase-arc') {
            const phaseItem = planItem.kind === 'domain-mark'
              && planItem.domainStyle === 'phase'
              ? planItem
              : null;
            const phaseNodeId = phaseItem?.rootNodeId || '';
            const phaseHeadRect = measuredTreeLabelRectNow(phaseNodeId, false);
            const phaseDomainRect = measuredTerminalSubtreeRectNow(phaseNodeId);
            const edgeRect = phaseItem?.phaseEdgeNodeId
              ? measuredTreeLabelRectNow(phaseItem.phaseEdgeNodeId, false)
              : null;
            if (!phaseItem || !phaseHeadRect || !phaseDomainRect) return;
            if (!phaseRelationLayer) {
              phaseRelationLayer = overlay.append('g').attr('class', 'babel-phase-relation-layer');
            }
            const relationLayer = phaseRelationLayer.append('g');
            const relationLayerNode = relationLayer.node();
            if (relationLayerNode) decorateRelationElement(relationLayerNode, planItem, emphasis);
            const primary = phaseItem.phasePrimary === true;
            const path = phaseArcPath(phaseHeadRect, phaseDomainRect, edgeRect, primary);
            const phaseData = (selection: d3.Selection<SVGPathElement, unknown, null, undefined>) => selection
              .attr('data-phase-node', phaseNodeId)
              .attr('data-phase-edge', phaseItem.phaseEdgeNodeId || '')
              .attr('data-phase-primary', primary ? 'true' : 'false');
            phaseData(relationLayer.append('path')
              .attr('class', [
                'babel-phase-arc-shadow',
                primary ? 'babel-phase-arc-shadow-primary' : ''
              ].filter(Boolean).join(' '))
              .attr('d', path)
              .attr('opacity', emphasis === 'quiet' ? 0.3 : null));
            phaseData(relationLayer.append('path')
              .attr('class', [
                'babel-phase-arc',
                primary ? 'babel-phase-arc-primary' : ''
              ].filter(Boolean).join(' '))
              .attr('d', path)
              .attr('opacity', emphasis === 'quiet' ? 0.3 : null));
            if (phaseItem.phaseEdgeNodeId) {
              const edgeAnchor = resolveOverlayAnchor(phaseItem.phaseEdgeNodeId);
              const edgeChildren = edgeAnchor?.children || [];
              const edgeTerminal = edgeChildren.length === 1 ? edgeChildren[0] : null;
              const edgeSurface = edgeTerminal
                ? resolveLeafSurface(edgeTerminal as unknown as HierNode)
                : '';
              if (
                edgeTerminal
                && !isNullLike(edgeSurface)
                && isOvertLeafNode(edgeTerminal as unknown as HierNode)
              ) {
                markPreterminalLensNode(phaseItem.phaseEdgeNodeId, 'edge');
              }
            }
            return;
          }
          if (primitive.shapeStyle === 'blocked-extraction') {
            const pathItem = planItem.kind === 'directed-path'
              && planItem.pathStyle === 'blocked-extraction'
              ? planItem
              : null;
            const refs = pathItem ? planItemRelationRefs(pathItem) : [];
            const domainItem = frameItems.find((candidate) =>
              candidate.kind === 'domain-mark'
              && candidate.domainStyle === 'adjunct-domain'
              && planItemRelationRefs(candidate).some((candidateRef) => refs.some((ref) =>
                ref.stageIndex === candidateRef.stageIndex
                && ref.relationIndex === candidateRef.relationIndex)));
            const layer = acceptedLayerInHost(
              blockedExtractionLayers,
              planItem,
              'babel-blocked-extraction-relation-layer',
              host
            );
            const markerId = `babel-blocked-extraction-arrow-${planItem.relationRef.stageIndex}-${planItem.relationRef.relationIndex}`;
            if (layer.select(`#${markerId}`).empty()) {
              const marker = layer.insert('defs', ':first-child').append('marker')
                .attr('class', 'babel-blocked-extraction-marker')
                .attr('id', markerId)
                .attr('viewBox', '0 0 12 12')
                .attr('markerWidth', 13)
                .attr('markerHeight', 13)
                .attr('refX', 10)
                .attr('refY', 6)
                .attr('orient', 'auto-start-reverse')
                .attr('markerUnits', 'userSpaceOnUse');
              marker.append('path')
                .attr('d', 'M 1 1 L 11 6 L 1 11 Z');
            }
            layer.append('path')
              .attr('class', 'babel-blocked-extraction-path')
              .attr('data-extraction-source', pathItem?.fromNodeId || '')
              .attr('data-extraction-target', pathItem?.toNodeId || '')
              .attr('data-extraction-domain', domainItem?.kind === 'domain-mark' ? domainItem.rootNodeId : '')
              .attr('d', primitive.d)
              .attr('marker-start', `url(#${markerId})`)
              .attr('marker-end', `url(#${markerId})`);
            return;
          }
          if (primitive.shapeStyle === 'idiom-bracket') {
            const domainItem = planItem.kind === 'domain-mark'
              && planItem.domainStyle === 'idiom'
              ? planItem
              : null;
            const layer = acceptedLayerInHost(
              idiomChunkLayers,
              planItem,
              'babel-idiom-chunk-relation-layer',
              host
            );
            layer.append('path')
              .attr('class', 'babel-idiom-domain-bracket')
              .attr('data-idiom-domain', domainItem?.rootNodeId || '')
              .attr('d', primitive.d);
            return;
          }
          if (primitive.shapeStyle === 'blocked-edge-slash') {
            const pathItem = planItem.kind === 'path-status' ? planItem : null;
            const numbers = primitive.d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
            acceptedIslandLayer(planItem, emphasis).append('line')
              .attr('class', 'babel-pg-blocked-edge')
              .attr('data-blocked-edge-node', pathItem?.blockedEdgeNodeId || '')
              .attr('x1', numbers[0] ?? 0)
              .attr('y1', numbers[1] ?? 0)
              .attr('x2', numbers[2] ?? 0)
              .attr('y2', numbers[3] ?? 0);
            return;
          }
          host.append('path')
            .attr('class', `vr-shape-path vr-shape-${primitive.shapeStyle}`)
            .attr('d', primitive.d)
            .attr('fill', 'none')
            .attr('stroke', strokeColor)
            .attr('stroke-opacity', 0.85)
            .attr('stroke-width', 1.8)
            .attr('stroke-linecap', 'round')
            .attr('vector-effect', 'non-scaling-stroke')
            .attr('stroke-dasharray', primitive.stroke === 'dashed'
              ? '7 7'
              : primitive.stroke === 'dotted' ? '2 6' : null)
            .attr('marker-end', primitive.arrowhead ? 'url(#vr-overlay-arrowhead)' : null)
            .attr('marker-start', primitive.arrowheadBoth ? 'url(#vr-overlay-arrowhead)' : null);
          (primitive.endpointDots || []).forEach((dot) => {
            host.append('circle')
              .attr('class', 'vr-shape-endpoint')
              .attr('cx', dot.x)
              .attr('cy', dot.y)
              .attr('r', 9)
              .attr('fill', strokeColor)
              .attr('fill-opacity', 0.95);
          });
          if (primitive.originDot) {
            host.append('circle')
              .attr('class', 'vr-shape-origin')
              .attr('cx', primitive.originDot.x)
              .attr('cy', primitive.originDot.y)
              .attr('r', 8)
              .attr('fill', 'none')
              .attr('stroke', strokeColor)
              .attr('stroke-width', 1.6)
              .attr('vector-effect', 'non-scaling-stroke');
          }
          if (primitive.tip) {
            if (primitive.tip.kind === 'cross') {
              const cross = appendMarker(primitive.tip.at.x, primitive.tip.at.y);
              cross.append('text')
                .attr('text-anchor', 'middle')
                .attr('font-size', '14px')
                .attr('fill', '#f87171')
                .text('✗');
            } else if (primitive.tip.d) {
              host.append('path')
                .attr('class', `vr-shape-tip vr-tip-${primitive.tip.kind}`)
                .attr('d', primitive.tip.d)
                .attr('fill', 'none')
                .attr('stroke', primitive.tip.kind === 'bar' ? '#f87171' : '#34d399')
                .attr('stroke-width', 2.4)
                .attr('stroke-linecap', 'round')
                .attr('vector-effect', 'non-scaling-stroke');
            }
          }
          if (primitive.label && primitive.labelAt) {
            const labelMarker = appendMarker(primitive.labelAt.x, primitive.labelAt.y);
            labelMarker.append('text')
              .attr('class', 'vr-path-label')
              .attr('text-anchor', 'middle')
              .attr('font-size', '11px')
              .attr('fill', '#a7f3d0')
              .attr('font-family', "'IBM Plex Mono', monospace")
              .text(primitive.label);
          }
          if (primitive.badge) {
            const badgeMarker = appendMarker(primitive.badge.at.x, primitive.badge.at.y);
            badgeMarker.append('circle')
              .attr('r', 12)
              .attr('fill', 'rgba(2,24,15,0.94)')
              .attr('stroke', '#34d399')
              .attr('stroke-width', 1.2);
            badgeMarker.append('text')
              .attr('text-anchor', 'middle')
              .attr('y', 4)
              .attr('font-size', '11px')
              .attr('fill', '#a7f3d0')
              .attr('font-family', "'IBM Plex Mono', monospace")
              .text(primitive.badge.text);
          }
          return;
        }
        if (primitive.type === 'path-node-ring') {
          // Phillips path-following marks: the ellipse or square encloses the
          // node's own label at its rendered position.
          if (primitive.role === 'primary' && primitive.ellipse) {
            acceptedIslandLayer(planItem, emphasis).append('ellipse')
              .attr('class', 'babel-pg-path-node babel-pg-path-node-primary')
              .attr('data-path-node', primitive.nodeId)
              .attr('cx', primitive.ellipse.cx)
              .attr('cy', primitive.ellipse.cy)
              .attr('rx', primitive.ellipse.rx)
              .attr('ry', primitive.ellipse.ry);
          } else if (primitive.rect) {
            acceptedIslandLayer(planItem, emphasis).append('rect')
              .attr('class', 'babel-pg-path-node babel-pg-path-node-secondary')
              .attr('data-path-node', primitive.nodeId)
              .attr('x', primitive.rect.x)
              .attr('y', primitive.rect.y)
              .attr('width', primitive.rect.width)
              .attr('height', primitive.rect.height)
              .attr('rx', 2);
          }
          return;
        }
        if (primitive.type === 'domain-region') {
          if (primitive.domainStyle === 'transfer-edge') {
            queueAcceptedRelationDraw(planItem, emphasis, () => {
              const edgeItem = planItem.kind === 'domain-mark'
                && planItem.domainStyle === 'transfer-edge'
                ? planItem
                : null;
              if (!edgeItem) return;
              const { background, foreground } = ensureDomainLocalityLayers();
              const edgeNodeIds = edgeItem.memberNodeIds.length ? edgeItem.memberNodeIds
                : edgeItem.rootNodeId ? [edgeItem.rootNodeId] : [];
              edgeNodeIds.forEach((edgeNodeId) => {
              const edgeRect = measuredTreeLabelRectNow(edgeNodeId, false);
              if (!edgeRect) return;
              const outline = fongEdgeOutlineRect(edgeRect);
              background.append('rect')
                .attr('class', 'babel-transfer-edge-outline')
                .attr('data-transfer-edge-node', edgeNodeId)
                .attr('x', outline.x.toFixed(1))
                .attr('y', outline.y.toFixed(1))
                .attr('width', outline.width.toFixed(1))
                .attr('height', outline.height.toFixed(1))
                .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
              foreground.append('text')
                .attr('class', 'babel-transfer-edge-label')
                .attr('x', (outline.x - 24).toFixed(1))
                .attr('y', (outline.y + outline.height / 2 + 8).toFixed(1))
                .attr('opacity', emphasis === 'quiet' ? 0.3 : null)
                .text(edgeItem.label || 'Phase edge');
              markPreterminalLensNode(edgeNodeId, 'edge');
              });
            });
            return;
          }
          if (
            primitive.domainStyle === 'control-domain'
            && planItem.familyId === 'control.dependency'
            && planItem.kind === 'domain-mark'
          ) {
            const layer = ensureControlRelationLayer(planItem, emphasis);
            layer.append('rect')
              .attr('class', 'babel-control-domain')
              .attr('data-control-domain', planItem.rootNodeId || '')
              .attr('x', primitive.x)
              .attr('y', primitive.y)
              .attr('width', primitive.width)
              .attr('height', primitive.height)
              .attr('rx', 3);
            return;
          }
          const fillOnly = primitive.domainStyle === 'transfer-spellout';
          const isTransferEdge = primitive.domainStyle === 'transfer-edge';
          host.append('rect')
            .attr('class', `vr-domain-region vr-domain-${primitive.domainStyle}`)
            .attr('data-vr-outcome', primitive.outcome || '')
            .attr('x', primitive.x)
            .attr('y', primitive.y)
            .attr('width', primitive.width)
            .attr('height', primitive.height)
            .attr('rx', isTransferEdge ? 6 : 18)
            .attr('fill', fillOnly || primitive.domainStyle === 'forbidden-region'
              ? 'rgba(52,211,153,0.07)'
              : 'none')
            .attr('stroke', fillOnly ? 'none' : (primitive.outcome === 'blocked' ? '#f87171' : '#34d399'))
            .attr('stroke-opacity', isTransferEdge ? 0.8 : 0.55)
            .attr('stroke-width', 1.6)
            .attr('stroke-dasharray', ['adjunct-domain', 'scope', 'forbidden-region', 'control-domain'].includes(primitive.domainStyle) ? '7 7' : null)
            .attr('vector-effect', 'non-scaling-stroke');
          if (primitive.outcome === 'blocked' || primitive.label) {
            const edgeMarker = isTransferEdge
              ? appendMarker(primitive.x - 8, primitive.y + primitive.height / 2)
              : appendMarker(primitive.x + primitive.width, primitive.y);
            edgeMarker.append('text')
              .attr('text-anchor', isTransferEdge ? 'end' : 'start')
              .attr('font-size', '12px')
              .attr('fill', primitive.outcome === 'blocked' ? '#f87171' : '#a7f3d0')
              .text(primitive.outcome === 'blocked' ? '✗' : primitive.label || '');
          }
          return;
        }
        if (primitive.type === 'plaque') {
          if (primitive.plaqueStyle === 'feature') {
            if (planItem.relationRef.relation === 'FeatureBundle'
              && primitive.rows.some((row) => row.label === 'CASE 1')
              && primitive.rows.some((row) => row.label === 'CASE 2')) {
              g.selectAll<SVGTextElement, HierNode>('.terminal-label')
                .filter((candidate) => isDisplayTraceLabel(resolveLeafSurface(candidate)))
                .classed('babel-moved-from-copy', false);
            }
            queueAcceptedRelationDraw(planItem, emphasis, () => {
              const plaqueItem = planItem.kind === 'node-plaque' ? planItem : null;
              const anchorId = plaqueItem?.anchorNodeIds[0] || '';
              const assignments = frameItems.filter((candidate) =>
              candidate.kind === 'directed-path'
              && candidate.pathStyle === 'case-assignment'
              && candidate.relationRef.stageIndex === planItem.relationRef.stageIndex
              && candidate.toNodeId === anchorId);
            const bundles = frameItems.filter((candidate) => candidate.kind === 'node-plaque'
              && candidate.plaqueStyle === 'feature' && candidate.anchorNodeIds[0] === anchorId
              && candidate.relationRef.stageIndex === planItem.relationRef.stageIndex);
            if (assignments.length === 1 && bundles.length === 1) return;
            const anchorRect = measuredTerminalSubtreeRectNow(anchorId)
              || measuredTreeLabelRectNow(anchorId, false);
            if (!anchorId || !anchorRect) return;
            const origin = replayPlaqueLayout.get(primitive.itemIndex);
            if (!origin) return;
            const layout = reservePlaqueViewport(primitive.textLayout, origin.scrollHeight);
            const { width: plaqueWidth, height: plaqueHeight } = layout;
            const layer = ensureFeatureRelationLayer();
            const plaque = layer.append('g')
              .attr('class', 'babel-feature-plaque')
              .attr('data-plaque-location', origin.location)
              .attr('data-plaque-domain', origin.domainId)
              .attr('data-feature-anchor', anchorId)
              .attr('data-feature-placement', 'accepted')
              .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
            plaque.append('rect')
              .attr('class', 'babel-feature-plaque-shell')
              .attr('x', origin.x.toFixed(1))
              .attr('y', origin.y.toFixed(1))
              .attr('width', plaqueWidth.toFixed(1))
              .attr('height', plaqueHeight.toFixed(1))
              .attr('rx', 14);
            const content = appendPlaqueContent(plaque, layout, origin);
            if (layout.title) drawPlaqueText(content, layout.title, 'babel-feature-plaque-title', origin);
            layout.rows.forEach((row) => {
              const rowGroup = content.append('g')
                .attr('class', 'babel-feature-row')
                .attr('data-feature-label', primitive.rows[row.rowIndex].label)
                .attr('data-plaque-row-index', row.rowIndex);
              drawPlaqueText(rowGroup, row, 'babel-feature-text', origin);
            });
            });
            return;
          }
          if (primitive.plaqueStyle === 'realization') {
            const vocabularyTarget = planItem.kind === 'node-plaque'
              && planItem.familyId === 'pf.vocabulary-insertion'
              ? planItem.anchorNodeIds[0]
              : '';
            const targetBelongsToPartialCopy = vocabularyTarget
              ? frameItems.some((candidate, candidateIndex) => {
                  if (
                    candidate.kind !== 'enclosure'
                    || candidate.familyId !== 'copy.partial-deletion'
                    || !revealedItemIndices.has(candidateIndex)
                  ) return false;
                  const lowerCopy = resolveOverlayAnchor(candidate.nodeId);
                  return Boolean(lowerCopy?.descendants().some((descendant) =>
                    getNodeId(descendant as unknown as HierNode) === vocabularyTarget));
                })
              : false;
            if (vocabularyTarget && targetBelongsToPartialCopy) {
              markPreterminalLensNode(vocabularyTarget, 'pf-output');
              return;
            }
            host.append('g')
              .attr('class', 'babel-pf-relation-layer')
              .attr('data-plaque-item-index', primitive.itemIndex)
              .attr('data-pf-targets', JSON.stringify(planItem.kind === 'node-plaque' ? planItem.anchorNodeIds : []))
              .attr('data-pf-rows', JSON.stringify(primitive.rows))
              .attr('data-pf-row-kinds', JSON.stringify(planItem.kind === 'node-plaque' ? planItem.realizationRowKinds || [] : []))
              .attr('data-pf-row-refs', JSON.stringify(primitive.rowRefs || []));
            return;
          }
          const origin = replayPlaqueLayout.get(primitive.itemIndex);
          if (!origin) return;
          const layout = reservePlaqueViewport(primitive.textLayout, origin.scrollHeight);
          const marker = host.append('g')
            .attr('data-plaque-location', origin.location)
            .attr('data-plaque-domain', origin.domainId)
            .attr('transform', `translate(${origin.x},${origin.y})`);
          marker.append('rect')
            .attr('class', `vr-plaque vr-plaque-${primitive.plaqueStyle}`)
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', primitive.width)
            .attr('height', layout.height)
            .attr('rx', 5)
            .attr('fill', 'rgba(2,24,15,0.94)')
            .attr('stroke', '#34d399')
            .attr('stroke-width', 1);
          const content = appendPlaqueContent(marker, layout);
          if (layout.title) drawPlaqueText(content, layout.title, 'babel-plaque-title');
          layout.rows.forEach(row => {
            const rowGroup = content.append('g').attr('data-plaque-row-index', row.rowIndex);
            drawPlaqueText(rowGroup, row, 'babel-plaque-row');
          });
          return;
        }
        if (primitive.type === 'analysis-verdict') {
          const verdict = host.append('g')
            .attr('class', 'babel-analysis-verdict')
            .attr('data-analysis-verdict-anchor', primitive.analysisNodeId);
          const compound = verdict.append('text')
              .attr('class', 'babel-analysis-verdict-text')
              .attr('x', '0')
              .attr('y', '0')
              .attr('text-anchor', 'start')
              .attr('dominant-baseline', 'central');
          compound.append('tspan')
              .attr('class', 'babel-analysis-judgment')
              .attr('alignment-baseline', 'central')
              .text(primitive.judgment);
          if (primitive.label) {
            compound.append('tspan')
              .attr('class', 'babel-analysis-verdict-label')
              .attr('alignment-baseline', 'central')
              .attr('dx', '10')
              .text(primitive.label);
          }
          return;
        }
        if (primitive.type === 'text-badge') {
          if (primitive.badgeStyle === 'boundary-cut') {
            queueAcceptedRelationDraw(planItem, emphasis, () => {
              if (renderedBoundaryCutItems.has(primitive.itemIndex)) return;
              renderedBoundaryCutItems.add(primitive.itemIndex);
              const boundaries = boundFrame.primitives.flatMap((candidate) => (
                candidate.type === 'text-badge'
                && candidate.itemIndex === primitive.itemIndex
                && candidate.badgeStyle === 'boundary-cut'
                  ? [candidate]
                  : []
              ));
              const marks = boundaries.flatMap((boundary) => {
                const anchor = resolveOverlayAnchor(boundary.nodeId);
                const parent = anchor?.parent;
                if (!anchor || !parent) return [];
                const parentId = getNodeId(parent as unknown as HierNode);
                const childRect = measuredTreeLabelRectNow(boundary.nodeId, false);
                const parentRect = measuredTreeLabelRectNow(parentId, false);
                if (!childRect || !parentRect) return [];
                const from = {
                  x: parentRect.x + parentRect.width / 2,
                  y: parentRect.y + parentRect.height
                };
                const to = {
                  x: childRect.x + childRect.width / 2,
                  y: childRect.y
                };
                const along = 0.72;
                return [{
                  node: boundary.nodeId,
                  parent: parentId,
                  from,
                  to,
                  centre: {
                    x: from.x + (to.x - from.x) * along,
                    y: from.y + (to.y - from.y) * along
                  },
                  length: childRect.height * 11
                }];
              });
              if (marks.length !== boundaries.length) return;
              for (let left = 0; left < marks.length; left += 1) {
                for (let right = left + 1; right < marks.length; right += 1) {
                  if (Math.hypot(
                    marks[left].centre.x - marks[right].centre.x,
                    marks[left].centre.y - marks[right].centre.y
                  ) < 28) return;
                }
              }
              const layer = host.append('g')
                .attr('class', 'babel-island-relation-layer')
                .attr('opacity', emphasis === 'quiet' ? 0.3 : null)
                .attr('data-boundary-branches', JSON.stringify(
                  marks.map(({ node, parent, from, to, centre }) => ({
                    node,
                    parent,
                    from,
                    to,
                    centre
                  }))
                ));
              const angle = (-50 * Math.PI) / 180;
              const drawSlash = (
                centre: { x: number; y: number },
                length: number,
                className: string
              ) => {
                const dx = Math.cos(angle) * length / 2;
                const dy = Math.sin(angle) * length / 2;
                layer.append('line')
                  .attr('class', className)
                  .attr('x1', (centre.x - dx).toFixed(1))
                  .attr('y1', (centre.y - dy).toFixed(1))
                  .attr('x2', (centre.x + dx).toFixed(1))
                  .attr('y2', (centre.y + dy).toFixed(1));
              };
              marks.forEach(({ centre, length }) => {
                drawSlash(centre, length, 'babel-island-barrier-shadow');
                drawSlash(centre, length, 'babel-island-barrier-cut');
              });
            });
            return;
          }
          if (primitive.badgeStyle === 'agreement-goal') {
            markSubtreeLensNodes(primitive.nodeId, 'goal');
            return;
          }
          if (primitive.badgeStyle === 'idiom-chunk') {
            acceptedLayerInHost(idiomChunkLayers, planItem, 'babel-idiom-chunk-relation-layer', host);
            host.append('g')
              .attr('class', 'vr-idiom-chunk-anchor')
              .attr('data-idiom-chunk', primitive.nodeId);
            markPreterminalLensNode(primitive.nodeId, 'idiom-chunk');
            return;
          }
          if (primitive.badgeStyle === 'gap-notation' && primitive.reuseExistingNotation) {
            host.attr('data-gap-notation-reuses', primitive.nodeId);
            return;
          }
          if (primitive.badgeStyle === 'gap-notation'
            && (planItem.familyId === 'parasitic-gap.composition'
              || planItem.familyId === 'trajectory.across-the-board'
              || planItem.familyId === 'trajectory.sideward')) {
            if (planItem.familyId === 'parasitic-gap.composition') {
              acceptedLayerInHost(
                parasiticGapCoindexLayers,
                planItem,
                'babel-coindex-relation-layer',
                host
              ).append('text')
                .attr('class', 'babel-pg-gap-label')
                .attr('data-gap-label-anchor', primitive.nodeId)
                .attr('x', primitive.x.toFixed(1))
                .attr('y', primitive.y.toFixed(1))
                .style('fill', '#34d399')
                .style('stroke', 'rgba(1, 8, 5, 0.94)')
                .style('stroke-width', '6px')
                .style('paint-order', 'stroke')
                .style('font-family', '"Crimson Pro", Georgia, serif')
                .style('font-size', '32px')
                .style('font-style', 'italic')
                .style('font-weight', '700')
                .text(primitive.text);
              return;
            }
            const anchor = resolveOverlayAnchor(primitive.nodeId);
            if (anchor) {
              const terminalIds = new Set(
                anchor.descendants()
                  .map((terminal) => getNodeId(terminal as unknown as HierNode))
              );
              g.selectAll<SVGTextElement, HierNode>('.terminal-label')
                .filter((terminal) => terminalIds.has(getNodeId(terminal)))
                .each(function preserveGapLabel() {
                  const label = d3.select(this);
                  const restoreAttribute = planItem.familyId === 'trajectory.across-the-board'
                    || planItem.familyId === 'trajectory.sideward'
                    ? 'data-copy-restore'
                    : 'data-gap-restore';
                  if (!label.attr(restoreAttribute)) {
                    label.attr(restoreAttribute, label.attr('data-default-label') || this.textContent || '');
                  }
                })
                .classed(
                  planItem.familyId === 'trajectory.across-the-board'
                    || planItem.familyId === 'trajectory.sideward'
                    ? 'babel-moved-from-copy'
                    : 'babel-gap-notation',
                  true
                )
                .classed(
                  'babel-moved-from-copy',
                  planItem.familyId === 'trajectory.across-the-board'
                    || planItem.familyId === 'trajectory.sideward'
                )
                .text(primitive.text);
            }
            return;
          }
          const marker = appendMarker(primitive.x, primitive.y, primitive.badgeStyle === 'gap-notation', primitive.stackIndex);
          if (primitive.shape === 'circle') {
            marker.append('circle')
              .attr('r', 9)
              .attr('fill', 'rgba(2,24,15,0.92)')
              .attr('stroke', primitive.outcome === 'blocked' ? '#f87171' : '#34d399')
              .attr('stroke-width', 1.2);
          } else if (primitive.shape === 'square') {
            marker.append('rect')
              .attr('x', -8).attr('y', -8)
              .attr('width', 16).attr('height', 16)
              .attr('fill', 'rgba(2,24,15,0.92)')
              .attr('stroke', primitive.outcome === 'blocked' ? '#f87171' : '#34d399')
              .attr('stroke-width', 1.2);
          }
          marker.append('text')
            .attr('class', `vr-text-badge vr-badge-${primitive.badgeStyle}`)
            .attr('text-anchor', 'middle')
            .attr('y', 4)
            .attr('font-size', '11px')
            .attr('fill', '#a7f3d0')
            .attr('font-family', "'IBM Plex Mono', monospace")
            .text(primitive.text);
          return;
        }
        if (primitive.type === 'strike') {
          host.append('line')
            .attr('class', 'vr-strike')
            .attr('x1', primitive.x1)
            .attr('x2', primitive.x2)
            .attr('y1', primitive.y)
            .attr('y2', primitive.y)
            .attr('stroke', '#a7f3d0')
            .attr('stroke-opacity', 0.85)
            .attr('stroke-width', 2)
            .attr('vector-effect', 'non-scaling-stroke');
          return;
        }
        if (primitive.type === 'enclosure') {
          host.append('rect')
            .attr('class', `vr-enclosure vr-enclosure-${primitive.licence}`)
            .attr('x', primitive.x)
            .attr('y', primitive.y)
            .attr('width', primitive.width)
            .attr('height', primitive.height)
            .attr('rx', 8)
            .attr('fill', primitive.licence === 'carrier-chunk' ? 'rgba(52,211,153,0.08)' : 'none')
            .attr('stroke', '#34d399')
            .attr('stroke-opacity', 0.6)
            .attr('stroke-width', 1.6)
            .attr('vector-effect', 'non-scaling-stroke');
          return;
        }
        if (primitive.type === 'branch-emphasis') {
          primitive.strongEdges.forEach((edge) => {
            host.append('line')
              .attr('class', 'vr-branch-strong')
              .attr('x1', edge.from.x).attr('y1', edge.from.y)
              .attr('x2', edge.to.x).attr('y2', edge.to.y)
              .attr('stroke', '#34d399')
              .attr('stroke-opacity', 0.9)
              .attr('stroke-width', 4)
              .attr('vector-effect', 'non-scaling-stroke');
          });
          primitive.weakEdges.forEach((edge) => {
            host.append('line')
              .attr('class', 'vr-branch-weak')
              .attr('x1', edge.from.x).attr('y1', edge.from.y)
              .attr('x2', edge.to.x).attr('y2', edge.to.y)
              .attr('stroke', '#34d399')
              .attr('stroke-opacity', 0.35)
              .attr('stroke-width', 1.2)
              .attr('stroke-dasharray', '3 5')
              .attr('vector-effect', 'non-scaling-stroke');
          });
          return;
        }
        if (primitive.type === 'shared-branch') {
          host.append('line')
            .attr('class', 'vr-shared-branch')
            .attr('x1', primitive.from.x)
            .attr('y1', primitive.from.y)
            .attr('x2', primitive.to.x)
            .attr('y2', primitive.to.y)
            .attr('stroke', '#34d399')
            .attr('stroke-opacity', 0.7)
            .attr('stroke-width', 2)
            .attr('stroke-dasharray', '8 5')
            .attr('vector-effect', 'non-scaling-stroke');
          return;
        }
        if (primitive.type === 'identity-lens') {
          const occurrencePools = primitive.nodeIds
            .map((nodeId) => {
              const occurrence = resolveOverlayAnchor(nodeId);
              if (!occurrence) return [];
              return occurrence.descendants()
                .filter((candidate) => (candidate.children || []).length === 0)
                .map((candidate) => getNodeId(candidate as unknown as HierNode));
            })
            .filter((pool) => pool.length > 0);
          if (occurrencePools.length > 0) {
            identityForestLightFamilies.push({ occurrencePools, emphasis, item: planItem });
            const occurrenceTerminalIds = new Set(occurrencePools.flat());
            g.selectAll<SVGTextElement, unknown>('.terminal-label')
              .filter(function belongsToIdentityOccurrence() {
                return occurrenceTerminalIds.has(this.getAttribute('data-node-id') || '');
              })
              .each(function decorateIdentityOccurrence() {
                decorateRelationElement(this, planItem, emphasis);
              });
          }
          markIdentityLensOccurrences(primitive.nodeIds);
          return;
        }
        if (primitive.type === 'leader') {
          // Plaque ownership is expressed by placement, without an added cross-tree leader.
          return;
        }
        if (primitive.type === 'segment') {
          const group = host.append('g').attr('class', 'vr-fallback-connector');
          group.append('path').attr('class', 'vr-fallback-shadow').attr('d', primitive.d);
          group.append('path')
            .attr('class', `vr-fallback-segment vr-fallback-segment-${primitive.route}`)
            .attr('data-vr-lane', primitive.lane === null ? 'direct' : String(primitive.lane))
            .attr('d', primitive.d);
          fallbackConnectorPaths.set(primitive, group);
          return;
        }
        if (primitive.type === 'domain-ellipse') {
          if (planItem.familyId === 'binding.domain' && planItem.kind === 'binding-domain') {
            const layer = acceptedRootLayerAfterNodes(
              bindingRelationLayers,
              planItem,
              emphasis,
              'babel-binding-relation-layer'
            ).attr('data-binding-outcome', planItem.outcome || 'licensed');
            layer.append('ellipse')
              .attr('class', 'babel-binding-domain')
              .attr('fill', 'none')
              .attr('data-binding-domain', planItem.domainNodeId)
              .attr('cx', primitive.cx)
              .attr('cy', primitive.cy)
              .attr('rx', primitive.rx)
              .attr('ry', primitive.ry);
            return;
          }
          host.append('ellipse')
            .attr('class', 'vr-domain-ellipse')
            .attr('data-vr-outcome', primitive.outcome)
            .attr('cx', primitive.cx)
            .attr('cy', primitive.cy)
            .attr('rx', primitive.rx)
            .attr('ry', primitive.ry)
            .attr('fill', 'none')
            .attr('stroke', '#34d399')
            .attr('stroke-opacity', 0.7)
            .attr('stroke-width', 1.8)
            .attr('vector-effect', 'non-scaling-stroke');
          return;
        }
        if (primitive.type === 'index-badge') {
          if (planItem.familyId === 'control.dependency' && planItem.kind === 'coindex') {
            const controlPath = frameItems.find((candidate) =>
              candidate.familyId === 'control.dependency'
              && candidate.kind === 'directed-path'
              && relationLayerKey(candidate) === relationLayerKey(planItem));
            const role = controlPath?.kind === 'directed-path'
              && primitive.nodeId === controlPath.fromNodeId
              ? 'controller'
              : 'controllee';
            ensureControlRelationLayer(planItem, emphasis).append('text')
              .attr('class', 'babel-control-index babel-relation-index')
              .attr('data-control-role', role)
              .attr('data-control-anchor', primitive.nodeId)
              .attr('x', primitive.x.toFixed(1))
              .attr('y', primitive.y.toFixed(1))
              .text(primitive.index);
            return;
          }
          if (planItem.familyId === 'binding.domain' && planItem.kind === 'binding-domain') {
            const role = primitive.nodeId === planItem.binderNodeId ? 'binder' : 'bound';
            acceptedRootLayerAfterNodes(
              bindingRelationLayers,
              planItem,
              emphasis,
              'babel-binding-relation-layer'
            ).attr('data-binding-outcome', planItem.outcome || 'licensed')
              .append('text')
              .attr('class', 'babel-binding-index babel-relation-index')
              .attr('data-binding-role', role)
              .attr('data-binding-anchor', primitive.nodeId)
              .attr('x', primitive.x.toFixed(1))
              .attr('y', primitive.y.toFixed(1))
              .text(primitive.index);
            return;
          }
          if (planItem.familyId === 'coreference.coindex' && planItem.kind === 'coindex') {
            acceptedRootLayerAfterNodes(
              coindexRelationLayers,
              planItem,
              emphasis,
              'babel-coindex-relation-layer'
            ).append('text')
              .attr('class', 'babel-binding-index babel-relation-index babel-renderer-authored-index')
              .attr('data-coreference-anchor', primitive.nodeId)
              .attr('x', primitive.x.toFixed(1))
              .attr('y', primitive.y.toFixed(1))
              .attr('fill', TARGET_EMERALD)
              .style('fill', TARGET_EMERALD, 'important')
              .text(primitive.index);
            return;
          }
          if (planItem.familyId === 'parasitic-gap.composition') {
            const layer = acceptedLayerInHost(
              parasiticGapCoindexLayers,
              planItem,
              'babel-coindex-relation-layer',
              host
            );
            layer.append('text')
              .attr('class', 'babel-binding-index babel-relation-index')
              .attr('data-coindex-anchor', primitive.nodeId)
              .attr('x', primitive.x.toFixed(1))
              .attr('y', primitive.y.toFixed(1))
              .text(primitive.index);
            return;
          }
          const marker = appendMarker(primitive.x, primitive.y, true, primitive.stackIndex);
          marker.append('text')
            .attr('class', 'vr-index-badge babel-relation-index')
            .attr('x', 8)
            .attr('y', 4)
            .attr('font-size', '13px')
            .attr('fill', '#a7f3d0')
            .attr('font-family', "'IBM Plex Mono', monospace")
            .text(primitive.index);
          return;
        }
        if (primitive.type === 'fallback-mark') {
          const marker = host.append('g').attr('class', 'vr-fallback-mark')
            .attr('data-vr-witness', primitive.nodeId)
            .attr('transform', `translate(${primitive.x},${primitive.y}) scale(${markerScale})`);
          fallbackMarkGroups.set(primitive, marker);
          marker.attr('data-authored-role', primitive.role);
          marker.append('text').attr('class', 'vr-fallback-role')
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
            .attr('font-size', FALLBACK_ROLE_STYLE.fontSize).text(primitive.text);
          return;
        }
        if (primitive.type === 'anchor-set-badge') {
          const compact = primitive.badgeSize === 'compact';
          const marker = appendMarker(primitive.x, primitive.y);
          marker.append('circle')
            .attr('class', 'vr-anchor-set-badge')
            .attr('r', compact ? 7 : 9)
            .attr('fill', 'rgba(2,24,15,0.92)')
            .attr('stroke', '#34d399')
            .attr('stroke-width', 1.2);
          marker.append('text')
            .attr('text-anchor', 'middle')
            .attr('y', compact ? 3 : 4)
            .attr('font-size', compact ? '8px' : '10px')
            .attr('fill', '#a7f3d0')
            .attr('font-family', "'IBM Plex Mono', monospace")
            .text(String(primitive.numeral));
          return;
        }
        if (primitive.type === 'anchor-set-rail') {
          const paths = anchorSetRailPaths(primitive, markerScale);
          const group = host.append('g').attr('class', 'vr-anchor-set').attr('fill', 'none');
          group.append('path').attr('class', 'vr-anchor-set-rail babel-anchor-set-rail').attr('d', paths.rail);
          group.append('path').attr('class', 'babel-anchor-set-stub').attr('d', paths.joins);
          fallbackRailGroups.set(primitive, group);
        }
      });

      const relationEmphasisRank = (state: 'active' | 'quiet' | null): number =>
        state === 'active' ? 2 : state === null ? 1 : 0;
      if (acceptedEnclosureRequests.length > 0) {
        deferredAcceptedRelationDraws.push(() => {
          const requestByKey = new Map<string, {
            nodeId: string;
            licence: 'remnant-landing' | 'carrier-chunk' | 'copy-occurrence';
            emphasis: 'active' | 'quiet' | null;
            item: RelationPlanItem;
          }>();
          acceptedEnclosureRequests.forEach((request) => {
            const key = `${request.licence}:${request.nodeId}`;
            const current = requestByKey.get(key);
            if (
              current === undefined
              || relationEmphasisRank(request.emphasis) > relationEmphasisRank(current.emphasis)
            ) {
              requestByKey.set(key, request);
            }
          });
          const root = g.node();
          const layerNode = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          layerNode.setAttribute('class', 'babel-enclosure-relation-layer');
          (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
          const firstNodeGroup = g.select<SVGGElement>('.node-group').node();
          if (root && firstNodeGroup?.parentNode === root) root.insertBefore(layerNode, firstNodeGroup);
          else root?.appendChild(layerNode);
          const layer = d3.select<SVGGElement, unknown>(layerNode);
          const gradient = layer.append('defs').append('linearGradient')
            .attr('id', 'babel-carrier-gradient')
            .attr('x1', 0)
            .attr('y1', 0)
            .attr('x2', 0)
            .attr('y2', 1);
          gradient.append('stop')
            .attr('offset', '0%')
            .attr('stop-color', 'rgba(16, 185, 129, 0.32)');
          gradient.append('stop')
            .attr('offset', '100%')
            .attr('stop-color', 'rgba(4, 120, 87, 0.10)');
          requestByKey.forEach(({ nodeId, licence, emphasis, item }) => {
            const rect = exactScreenTreeLabelRectNow(nodeId, true);
            if (!rect) return;
            const enclosure = layer.append('rect')
              .attr('class', `babel-constituent-enclosure babel-enclosure-${licence}`)
              .attr('x', (rect.x - 30).toFixed(1))
              .attr('y', (rect.y - 24).toFixed(1))
              .attr('width', (rect.width + 60).toFixed(1))
              .attr('height', (rect.height + 48).toFixed(1))
              .attr('data-enclosure-licence', licence)
              .attr('data-enclosure-node', nodeId)
              .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
            const enclosureNode = enclosure.node();
            if (enclosureNode) decorateRelationElement(enclosureNode, item, emphasis);
          });
        });
      }
      if (acceptedPartialCopyStrikeRequests.length > 0) {
        deferredAcceptedRelationDraws.push(() => {
          const requestByNodeId = new Map<string, (typeof acceptedPartialCopyStrikeRequests)[number]>();
          acceptedPartialCopyStrikeRequests.forEach((request) => {
            const current = requestByNodeId.get(request.nodeId);
            if (
              current === undefined
              || relationEmphasisRank(request.emphasis) > relationEmphasisRank(current.emphasis)
            ) {
              requestByNodeId.set(request.nodeId, request);
            }
          });
          const layer = g.append('g').attr('class', 'babel-partial-copy-deletion-layer');
          const layerNode = layer.node();
          if (layerNode) {
            (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
          }
          requestByNodeId.forEach(({ emphasis, item }, nodeId) => {
            const rect = measuredTreeLabelRectNow(nodeId, false)
              || measuredTreeLabelRectNow(nodeId, true);
            if (!rect) return;
            const y = rect.y + rect.height * 0.56;
            const relationLayer = layer.append('g')
              .attr('class', 'babel-partial-copy-deletion-mark');
            const relationLayerNode = relationLayer.node();
            if (relationLayerNode) decorateRelationElement(relationLayerNode, item, emphasis);
            const appendStrike = (className: string) => relationLayer.append('line')
              .attr('class', className)
              .attr('x1', (rect.x - 12).toFixed(1))
              .attr('x2', (rect.x + rect.width + 12).toFixed(1))
              .attr('y1', y.toFixed(1))
              .attr('y2', y.toFixed(1))
              .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
            appendStrike('babel-partial-copy-deletion-strike-shadow');
            appendStrike('babel-partial-copy-deletion-strike');
          });
        });
      }
      if (acceptedDeletionTerminalStrikeRequests.length > 0) {
        deferredAcceptedRelationDraws.push(() => {
          const requestByNodeId = new Map<string, (typeof acceptedDeletionTerminalStrikeRequests)[number]>();
          acceptedDeletionTerminalStrikeRequests.forEach((request) => {
            const current = requestByNodeId.get(request.domainNodeId);
            if (
              current === undefined
              || relationEmphasisRank(request.emphasis) > relationEmphasisRank(current.emphasis)
            ) {
              requestByNodeId.set(request.domainNodeId, request);
            }
          });
          const layer = g.append('g').attr('class', 'babel-deletion-terminal-strike-layer');
          const layerNode = layer.node();
          if (layerNode) {
            (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
          }
          requestByNodeId.forEach(({ emphasis, item }, domainNodeId) => {
            const anchor = resolveOverlayAnchor(domainNodeId);
            if (!anchor) return;
            const relationLayer = layer.append('g');
            const relationLayerNode = relationLayer.node();
            if (relationLayerNode) decorateRelationElement(relationLayerNode, item, emphasis);
            const subtreeIds = new Set(
              anchor.descendants().map((candidate) => getNodeId(candidate as unknown as HierNode))
            );
            g.selectAll<SVGTextElement, HierNode>('.terminal-label')
              .filter(function terminalBelongsToDeletionDomain(candidate) {
                const datumId = getNodeId(candidate);
                const terminalId = this.getAttribute('data-node-id') || '';
                return subtreeIds.has(datumId)
                  || subtreeIds.has(terminalId)
                  || [...subtreeIds].some((nodeId) => (
                    labelBelongsToNode(this, String(nodeId))
                  ));
              })
              .each(function strikeDeletionTerminal() {
                const rect = measureGraphicsElementsInTreeSpace([this]);
                if (!rect) return;
                const y = rect.y + rect.height * 0.54;
                const appendStrike = (className: string) => relationLayer.append('line')
                  .attr('class', className)
                  .attr('x1', (rect.x - 10).toFixed(1))
                  .attr('x2', (rect.x + rect.width + 10).toFixed(1))
                  .attr('y1', y.toFixed(1))
                  .attr('y2', y.toFixed(1))
                  .attr('data-deletion-domain', domainNodeId)
                  .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
                appendStrike('babel-partial-copy-deletion-strike-shadow babel-deletion-terminal-strike-shadow');
                appendStrike('babel-partial-copy-deletion-strike babel-deletion-terminal-strike');
              });
          });
        });
      }
      if (acceptedParasiticGapCopyRequests.length > 0) {
        deferredAcceptedRelationDraws.push(() => {
          acceptedParasiticGapCopyRequests.forEach((request) => {
            const contentAnchor = resolveOverlayAnchor(request.contentNodeId);
            const ordinaryGapAnchor = resolveOverlayAnchor(request.ordinaryGapNodeId);
            if (!contentAnchor || !ordinaryGapAnchor) return;
            const content = measuredShellBottom(request.contentNodeId, contentAnchor);
            const gapTargets = [request.ordinaryGapNodeId, ...request.parasiticGapNodeIds]
              .flatMap((nodeId) => {
                const anchor = resolveOverlayAnchor(nodeId);
                return anchor ? [{ nodeId, point: measuredShellTop(nodeId, anchor) }] : [];
              });
            if (gapTargets.length !== 1 + request.parasiticGapNodeIds.length) return;
            const targetCentre = {
              x: d3.mean(gapTargets, ({ point }) => point.x) || content.x,
              y: d3.mean(gapTargets, ({ point }) => point.y) || content.y
            };
            const direction = {
              x: targetCentre.x - content.x,
              y: targetCentre.y - content.y
            };
            const directionLength = Math.max(1, Math.hypot(direction.x, direction.y));
            const forkDistance = Math.min(460, Math.max(240, directionLength * 0.16));
            const fork = {
              x: content.x + direction.x / directionLength * forkDistance,
              y: content.y + direction.y / directionLength * forkDistance
            };
            const layer = g.append('g')
              .attr('class', 'babel-pg-copy-fork-layer')
              .attr('opacity', request.emphasis === 'quiet' ? 0.3 : null);
            const layerNode = layer.node();
            if (layerNode) {
              decorateRelationElement(layerNode, request.item, request.emphasis);
              (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
            }
            const appendForkPath = (
              pathData: string,
              role: 'content-input' | 'ordinary-gap-output' | 'parasitic-gap-output',
              nodeId: string
            ) => {
              layer.append('path')
                .attr('class', 'babel-pg-copy-branch-shadow')
                .attr('data-copy-fork-role', role)
                .attr('data-copy-fork-anchor', nodeId)
                .attr('d', pathData);
              layer.append('path')
                .attr('class', 'babel-pg-copy-branch')
                .attr('data-copy-fork-role', role)
                .attr('data-copy-fork-anchor', nodeId)
                .attr('d', pathData);
            };
            const inputControl = {
              x: content.x + (fork.x - content.x) * 0.48,
              y: Math.min(content.y, fork.y) - 34
            };
            appendForkPath([
              `M ${content.x.toFixed(1)} ${content.y.toFixed(1)}`,
              `Q ${inputControl.x.toFixed(1)} ${inputControl.y.toFixed(1)}, ${fork.x.toFixed(1)} ${fork.y.toFixed(1)}`
            ].join(' '), 'content-input', request.contentNodeId);
            gapTargets.forEach(({ nodeId, point }) => {
              const bend = {
                x: fork.x + (point.x - fork.x) * 0.48,
                y: Math.min(fork.y, point.y) - Math.max(24, Math.abs(point.x - fork.x) * 0.08)
              };
              const pathData = [
                `M ${fork.x.toFixed(1)} ${fork.y.toFixed(1)}`,
                `Q ${bend.x.toFixed(1)} ${bend.y.toFixed(1)}, ${point.x.toFixed(1)} ${point.y.toFixed(1)}`
              ].join(' ');
              appendForkPath(
                pathData,
                nodeId === request.ordinaryGapNodeId
                  ? 'ordinary-gap-output'
                  : 'parasitic-gap-output',
                nodeId
              );
            });
            layer.append('circle')
              .attr('class', 'babel-pg-copy-ring-shadow')
              .attr('data-copy-fork-junction', 'true')
              .attr('cx', fork.x.toFixed(1))
              .attr('cy', fork.y.toFixed(1))
              .attr('r', (9 * markerScale).toFixed(1));
            layer.append('circle')
              .attr('class', 'babel-pg-copy-ring')
              .attr('data-copy-fork-junction', 'true')
              .attr('cx', fork.x.toFixed(1))
              .attr('cy', fork.y.toFixed(1))
              .attr('r', (6.5 * markerScale).toFixed(1));
            const firstNode = g.select<SVGGElement>('.node-group').node();
            if (firstNode && layerNode) g.node()?.insertBefore(layerNode, firstNode);
          });
        });
      }

      /*
       * Resolve ghost lens states: for material shared by several ellipsis
       * claims, an active moment wins over neutral, which wins over quiet.
       * The presentation itself is the pure, tested law from the binder —
       * active silence glows without ever looking pronounced; quiet silence
       * recedes below its neutral opacity like every other quiet mark.
       */
      const ghostEmphasisByNode = new Map<string, 'active' | 'quiet' | null>();
      const acceptedEllipsisGhostNodes = new Set<string>();
      const acceptedEllipsisSiteNodes = new Set<string>();
      const acceptedEllipsisAntecedentNodes = new Set<string>();
      const ghostRank = (state: 'active' | 'quiet' | null): number =>
        state === 'active' ? 2 : state === null ? 1 : 0;
      ghostLensRequests.forEach((request) => {
        if (request.acceptedEllipsisStyle) {
          request.siteNodeIds.forEach((nodeId) => acceptedEllipsisSiteNodes.add(nodeId));
          request.antecedentNodeIds.forEach((nodeId) => acceptedEllipsisAntecedentNodes.add(nodeId));
        }
        request.nodeIds.forEach((ghostNodeId) => {
          if (request.acceptedEllipsisStyle) acceptedEllipsisGhostNodes.add(ghostNodeId);
          const current = ghostEmphasisByNode.get(ghostNodeId);
          if (current === undefined || ghostRank(request.emphasis) > ghostRank(current)) {
            ghostEmphasisByNode.set(ghostNodeId, request.emphasis);
          }
        });
      });
      const visualLabelsForNodeSet = (nodeIds: Set<string>) =>
        g.selectAll<SVGTextElement, unknown>('.terminal-label, .category-label')
          .filter(function labelBelongsToAcceptedSet() {
            return [...nodeIds].some((nodeId) => (
              labelBelongsToNode(this, String(nodeId))
            ));
          });
      ghostLensRequests.forEach((request) => {
        const relationNodeIds = new Set([
          ...request.nodeIds,
          ...request.siteNodeIds,
          ...request.antecedentNodeIds
        ]);
        visualLabelsForNodeSet(relationNodeIds)
          .each(function decorateGhostRelationLabel() {
            decorateRelationElement(this, request.item, request.emphasis);
          });
      });
      visualLabelsForNodeSet(acceptedEllipsisSiteNodes)
        .classed('babel-ellipsis-site-label', true);
      visualLabelsForNodeSet(acceptedEllipsisAntecedentNodes)
        .classed('babel-ellipsis-antecedent-label', true);
      ghostEmphasisByNode.forEach((ghostEmphasis, ghostNodeId) => {
        const presentation = ghostLensPresentation(ghostEmphasis);
        const acceptedEllipsisStyle = acceptedEllipsisGhostNodes.has(ghostNodeId);
        const labels = visualLabelsForNodeSet(new Set([ghostNodeId]))
          .classed('vr-ghost', !acceptedEllipsisStyle)
          .classed('babel-ellipsis-ghost-label', acceptedEllipsisStyle);
        if (acceptedEllipsisStyle) {
          labels
            .attr('data-vr-ghost-emphasis', null)
            .classed('babel-moved-from-copy', false)
            .style('fill', 'rgba(209, 250, 229, 0.34)', 'important')
            .style('stroke', 'rgba(1, 8, 5, 0.54)', 'important')
            .style('opacity', '0.52')
            .style('filter', 'blur(0.25px) drop-shadow(0 0 5px rgba(167, 243, 208, 0.12))');
        } else {
          labels
            .attr('data-vr-ghost-emphasis', ghostEmphasis ?? 'none')
            .attr('opacity', presentation.opacity)
            .style('filter', presentation.filter);
        }
      });
    }

    // Initial viewport fit:
    // Derivation replay should keep one camera per Derivation frame, not refit to each
    // microstep's partial tree. That prevents fake left/right "movement" for
    // newly revealed branches like Teresa -> D -> DP before the real merge step.
    const cyclicLinearizationPlateItem = (
      relationRenderPlan?.frames[activeDerivationFrameIndex]?.items ?? []
    ).find((item) =>
      item.familyId === 'pf.cyclic-linearization'
      && item.kind === 'node-plaque'
      && item.nativeContent?.kind === 'linearization'
    );
    const hasCyclicLinearizationPlate = Boolean(cyclicLinearizationPlateItem);
    const compactViewport = containerWidth < 500;
    const cyclicLinearizationPlateHeight = nativeLinearizationPlateHeight(
      cyclicLinearizationPlateItem?.kind === 'node-plaque' ? cyclicLinearizationPlateItem.nativeContent : undefined
    );
    const treeViewport = availableTreeViewport(containerWidth, containerHeight, uiBounds);
    const cyclicPlacement = hasCyclicLinearizationPlate ? linearizationViewport(treeViewport, cyclicLinearizationPlateHeight) : null;
    const fitLeft = treeViewport.left;
    const fitRight = cyclicPlacement?.treeRight ?? treeViewport.right;
    const fitTop = cyclicPlacement?.treeTop ?? treeViewport.top;
    const fitBottom = treeViewport.bottom;
    const applyCameraTransform = (transform: d3.ZoomTransform) => {
      // D3 can retain a wheel sourceEvent during a programmatic fit.
      applyingCameraTransform = true;
      try {
        svg.call(zoom.transform as any, transform);
      } finally {
        applyingCameraTransform = false;
      }
    };
    const applyFittedCamera = (fitted: d3.ZoomTransform) => {
      if (stagePlaqueContainmentBounds && stageCameraBounds) {
        const bounds = {
          minX: Math.min(stagePlaqueContainmentBounds.minX, stageCameraBounds.minX - 220),
          maxX: Math.max(stagePlaqueContainmentBounds.maxX, stageCameraBounds.maxX + 220),
          minY: Math.min(stagePlaqueContainmentBounds.minY, stageCameraBounds.minY - 160),
          maxY: Math.max(stagePlaqueContainmentBounds.maxY, stageCameraBounds.maxY + 160)
        };
        const contained = containCamera(fitted, bounds, { left: fitLeft, right: fitRight, top: fitTop, bottom: fitBottom });
        fitted = d3.zoomIdentity.translate(contained.x, contained.y).scale(contained.k);
      }
      // Labels and complete fallback badges keep their accepted automatic-Fit
      // size, then scale with the tree. Their connectors use the same reference
      // when redrawn under a retained manual camera.
      const fittedMarkerScale = Math.min(1 / fitted.k, 3);
      g.selectAll<SVGGElement, unknown>('.vr-tree-notation').attr('transform', function () {
        const x = Number(this.dataset.vrX) + Number(this.dataset.vrStackOffset || 0) * fittedMarkerScale;
        return `translate(${x},${this.dataset.vrY}) scale(${fittedMarkerScale})`;
      });
      fitFallbackOverlays?.(fitted.k, {
        x: (fitLeft - fitted.x) / fitted.k, y: (fitTop - fitted.y) / fitted.k,
        width: (fitRight - fitLeft) / fitted.k, height: (fitBottom - fitTop) / fitted.k
      });
      const manual = manualCameraRef.current;
      if (manual?.data === data && manual.signature === derivationStagesSignature) {
        const transform = d3.zoomIdentity.translate(
          manual.transform.x + (containerWidth - manual.width) / 2,
          manual.transform.y + (containerHeight - manual.height) / 2
        ).scale(manual.transform.k);
        manualCameraRef.current = { ...manual, width: containerWidth, height: containerHeight, transform };
        applyCameraTransform(transform);
        return;
      }
      applyCameraTransform(fitted);
    };
    const minimumInitialScale = compactViewport || hasCyclicLinearizationPlate ? 0.02 : 0.06;
    const fitToRenderedBounds = () => {
      if (derivationFrameFitNodes && derivationFrameFitNodes.length > 0) {
        const minNodeX = stageCameraBounds?.minX ?? Math.min(
          d3.min(derivationFrameFitNodes, (node) => node.x) ?? 0,
          overlayFitBounds?.minX ?? Infinity
        );
        const maxNodeX = stageCameraBounds?.maxX ?? Math.max(
          d3.max(derivationFrameFitNodes, (node) => node.x) ?? 0,
          overlayFitBounds?.maxX ?? -Infinity
        );
        const minNodeY = stageCameraBounds?.minY ?? Math.min(
          d3.min(derivationFrameFitNodes, (node) => node.y) ?? 0,
          overlayFitBounds?.minY ?? Infinity
        );
        const maxNodeY = stageCameraBounds?.maxY ?? Math.max(
          d3.max(derivationFrameFitNodes, (node) => node.y + (!node.children || node.children.length === 0 ? 130 : 0)) ?? 0,
          overlayFitBounds?.maxY ?? -Infinity
        );
        const availableWidth = Math.max(1, fitRight - fitLeft);
        const availableHeight = Math.max(1, fitBottom - fitTop);
        const contentWidth = Math.max(1, (maxNodeX - minNodeX) + 440);
        const contentHeight = Math.max(1, (maxNodeY - minNodeY) + 320);
        const scaleX = availableWidth / contentWidth;
        const scaleY = availableHeight / contentHeight;
        const initialScale = Math.max(minimumInitialScale, Math.min(scaleX, scaleY, 1));
        const centerX = (minNodeX + maxNodeX) / 2;
        const centerY = (minNodeY + maxNodeY) / 2;
        const initialX = fitLeft + (availableWidth / 2) - centerX * initialScale;
        const initialY = fitTop + (availableHeight / 2) - centerY * initialScale;
        applyFittedCamera(d3.zoomIdentity.translate(initialX, initialY).scale(initialScale));
        return true;
      }

      const rendered = g.node() as SVGGElement | null;
      if (!rendered) return false;

      const bbox = rendered.getBBox();
      if (!Number.isFinite(bbox.width) || !Number.isFinite(bbox.height) || bbox.width <= 0 || bbox.height <= 0) {
        return false;
      }

      const availableWidth = Math.max(1, fitRight - fitLeft);
      const availableHeight = Math.max(1, fitBottom - fitTop);

      const scaleX = availableWidth / bbox.width;
      const scaleY = availableHeight / bbox.height;
      const initialScale = Math.max(minimumInitialScale, Math.min(scaleX, scaleY, 1));

      const bboxCenterX = bbox.x + bbox.width / 2;
      const bboxCenterY = bbox.y + bbox.height / 2;
      const targetCenterX = fitLeft + availableWidth / 2;
      const targetCenterY = fitTop + availableHeight / 2;
      const initialX = targetCenterX - bboxCenterX * initialScale;
      const initialY = targetCenterY - bboxCenterY * initialScale;

      applyFittedCamera(d3.zoomIdentity.translate(initialX, initialY).scale(initialScale));
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
      const fallbackViewportPadLeft = fitLeft;
      const fallbackViewportPadRight = containerWidth - fitRight;
      const fallbackViewportPadTop = fitTop;
      const fallbackViewportPadBottom = containerHeight - fitBottom;
      const scaleX = Math.max(0.01, (containerWidth - fallbackViewportPadLeft - fallbackViewportPadRight) / contentWidth);
      const scaleY = Math.max(
        0.01,
        (containerHeight - fallbackViewportPadTop - fallbackViewportPadBottom) / contentHeight
      );
      const initialScale = Math.max(minimumInitialScale, Math.min(scaleX, scaleY, 1));
      const centerX = (minNodeX + maxNodeX) / 2;
      const centerY = (minNodeY + maxNodeY) / 2;
      const initialX = fallbackViewportPadLeft + ((containerWidth - fallbackViewportPadLeft - fallbackViewportPadRight) / 2) - centerX * initialScale;
      const initialY = fallbackViewportPadTop
        + ((containerHeight - fallbackViewportPadTop - fallbackViewportPadBottom) / 2)
        - centerY * initialScale;
      applyFittedCamera(d3.zoomIdentity.translate(initialX, initialY).scale(initialScale));
    }

    /*
     * Accepted relation plates measure rendered labels after zoom-to-fit.
     * Rebind glyph-sensitive endpoints at that point so font rasterization
     * and viewport scale cannot introduce card-dependent drift while the
     * semantic plan remains coordinate-free.
     */
    const treeSpace = g.node();
    const treeMatrix = treeSpace?.getScreenCTM();
    if (treeSpace && treeMatrix) {
      const postFitNodeById = indexHierarchyNodesByIdAndAliases(
        treeData.descendants() as d3.HierarchyPointNode<SyntaxNode>[]
      );
      const measuredShellRect = (nodeId: string) => {
        const label = g.selectAll<SVGTextElement, HierNode>('.category-label')
          .filter((candidate) => getNodeId(candidate) === nodeId)
          .node();
        return label ? measureGraphicsElementsInTreeSpace([label]) : null;
      };
      const measuredTerminalRect = (nodeId: string) => {
        const anchor = postFitNodeById.get(nodeId);
        const resolution = anchor
          ? resolveUniqueDisplayTerminal(
              anchor,
              (candidate) => candidate.children || [],
              (candidate) => {
                if ((candidate.children || []).length > 0) return false;
                return isDisplayTerminalSurface(resolveLeafSurface(candidate as unknown as HierNode));
              }
            )
          : null;
        const terminalId = resolution?.terminal
          ? getNodeId(resolution.terminal as unknown as HierNode)
          : nodeId;
        const label = g.selectAll<SVGTextElement, HierNode>('.terminal-label')
          .filter(function exactMeasuredTerminal(candidate) {
            const candidateId = getNodeId(candidate);
            const renderedId = this.getAttribute('data-node-id') || '';
            return candidateId === terminalId || renderedId === terminalId;
          })
          .node();
        return label ? measureGraphicsElementsInTreeSpace([label]) : null;
      };
      const measuredSubtreeRect = (nodeId: string) => {
        const anchor = postFitNodeById.get(nodeId);
        if (!anchor) return null;
        const subtreeIds = new Set(anchor.descendants().map((candidate) => getNodeId(candidate as unknown as HierNode)));
        const labels = g.selectAll<SVGGraphicsElement, HierNode>('.category-label, .terminal-label')
          .filter(function candidateBelongsToSubtree(candidate) {
            const datumId = getNodeId(candidate);
            const categoryId = this.getAttribute('data-category-node-id') || '';
            const terminalId = this.getAttribute('data-node-id') || '';
            return subtreeIds.has(datumId)
              || subtreeIds.has(categoryId)
              || subtreeIds.has(terminalId)
              || [...subtreeIds].some((subtreeId) => labelBelongsToNode(this, String(subtreeId)));
          })
          .nodes();
        return measureGraphicsElementsInTreeSpace(labels);
      };
      const measuredSubtreeLabelRects = (nodeId: string) => {
        const anchor = postFitNodeById.get(nodeId);
        if (!anchor) return [];
        const subtreeIds = new Set(
          anchor.descendants().map((candidate) => getNodeId(candidate as unknown as HierNode))
        );
        return g.selectAll<SVGGraphicsElement, HierNode>('.category-label, .terminal-label')
          .filter(function renderedLabelBelongsToSubtree(candidate) {
            const datumId = getNodeId(candidate);
            const categoryId = this.getAttribute('data-category-node-id') || '';
            const terminalId = this.getAttribute('data-node-id') || '';
            return subtreeIds.has(datumId)
              || subtreeIds.has(categoryId)
              || subtreeIds.has(terminalId)
              || [...subtreeIds].some((subtreeId) => labelBelongsToNode(this, String(subtreeId)));
          })
          .nodes()
          .map((label) => measureGraphicsElementsInTreeSpace([label]))
          .filter((rect): rect is { x: number; y: number; width: number; height: number } => Boolean(rect));
      };
      type OperatorVariableHullPoint = [number, number];
      const operatorVariableScopeHull = (
        domainNodeId: string,
        rank: number
      ): OperatorVariableHullPoint[] | null => {
        const padX = Math.max(46, 82 - rank * 7);
        const padY = Math.max(44, 82 - rank * 6);
        const points: OperatorVariableHullPoint[] = [];
        measuredSubtreeLabelRects(domainNodeId).forEach((rect) => {
          const left = rect.x - padX;
          const right = rect.x + rect.width + padX;
          const top = rect.y - padY;
          const bottom = rect.y + rect.height + padY;
          points.push(
            [left, top],
            [(left + right) / 2, top - padY * 0.18],
            [right, top],
            [right + padX * 0.12, (top + bottom) / 2],
            [right, bottom],
            [(left + right) / 2, bottom + padY * 0.18],
            [left, bottom],
            [left - padX * 0.12, (top + bottom) / 2]
          );
        });
        const measuredHull = d3.polygonHull(points);
        if (!measuredHull) return null;
        const centerX = d3.mean(measuredHull, (point) => point[0]) || 0;
        const centerY = d3.mean(measuredHull, (point) => point[1]) || 0;
        const expansion = Math.max(24, 52 - rank * 5);
        return measuredHull.map(([x, y]) => {
          const dx = x - centerX;
          const dy = y - centerY;
          const distance = Math.hypot(dx, dy) || 1;
          const scale = (distance + expansion) / distance;
          return [centerX + dx * scale, centerY + dy * scale];
        });
      };
      const operatorVariableScopeEnvelope = d3.line<OperatorVariableHullPoint>()
        .curve(d3.curveCatmullRomClosed.alpha(0.66));
      const unionRects = (rects: Array<{ x: number; y: number; width: number; height: number }>) => {
        if (rects.length === 0) return null;
        const x = d3.min(rects, (rect) => rect.x);
        const y = d3.min(rects, (rect) => rect.y);
        const right = d3.max(rects, (rect) => rect.x + rect.width);
        const bottom = d3.max(rects, (rect) => rect.y + rect.height);
        if (x === undefined || y === undefined || right === undefined || bottom === undefined) return null;
        return { x, y, width: right - x, height: bottom - y };
      };
      const measuredTerminalSubtreesRect = (nodeIds: string[]) => unionRects(
        nodeIds.flatMap((nodeId) => {
          const anchor = postFitNodeById.get(nodeId);
          if (!anchor) return [];
          const subtreeIds = new Set(anchor.descendants().map((candidate) => getNodeId(candidate as unknown as HierNode)));
          return g.selectAll<SVGTextElement, HierNode>('.terminal-label')
            .filter((candidate) => subtreeIds.has(getNodeId(candidate)))
            .nodes()
            .map((label) => measureGraphicsElementsInTreeSpace([label]))
            .filter((rect): rect is { x: number; y: number; width: number; height: number } => Boolean(rect));
        })
      );
      const measuredTreeLabelsRect = () => unionRects(
        g.selectAll<SVGGraphicsElement, HierNode>('.category-label, .terminal-label')
          .nodes()
          .map((label) => measureGraphicsElementsInTreeSpace([label]))
          .filter((rect): rect is { x: number; y: number; width: number; height: number } => Boolean(rect))
      );
      const measuredAcceptedAnchorRect = (nodeId: string) =>
        measuredShellRect(nodeId)
        || measuredTerminalRect(nodeId)
        || measuredSubtreeRect(nodeId);
      const measureRenderedElementsInTreeSpace = (elements: SVGGraphicsElement[]) => {
        const matrix = treeSpace.getScreenCTM();
        if (!matrix || elements.length === 0) return null;
        const inverse = matrix.inverse();
        const points = elements.flatMap((element) => {
          const rect = element.getBoundingClientRect();
          if (!rect.width && !rect.height) return [];
          return [
            [rect.left, rect.top],
            [rect.right, rect.top],
            [rect.right, rect.bottom],
            [rect.left, rect.bottom]
          ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(inverse));
        });
        if (points.length === 0) return null;
        const xs = points.map((point) => point.x);
        const ys = points.map((point) => point.y);
        return {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys)
        };
      };
      const measuredTrajectoryShellRect = (nodeId: string) => {
        const label = g.selectAll<SVGTextElement, HierNode>('.category-label')
          .filter((candidate) => getNodeId(candidate) === nodeId)
          .node();
        return label ? measureRenderedElementsInTreeSpace([label]) : null;
      };
      const measuredTrajectoryTerminalRect = (nodeId: string) => {
        const anchor = postFitNodeById.get(nodeId);
        const resolution = anchor
          ? resolveUniqueDisplayTerminal(
              anchor,
              (candidate) => candidate.children || [],
              (candidate) => (candidate.children || []).length === 0
                && isDisplayTerminalSurface(resolveLeafSurface(candidate as unknown as HierNode))
            )
          : null;
        const terminalId = resolution?.terminal
          ? getNodeId(resolution.terminal as unknown as HierNode)
          : nodeId;
        const label = g.selectAll<SVGTextElement, HierNode>('.terminal-label')
          .filter(function exactTrajectoryTerminal(candidate) {
            return getNodeId(candidate) === terminalId
              || this.getAttribute('data-node-id') === terminalId;
          })
          .node();
        return label ? measureRenderedElementsInTreeSpace([label]) : null;
      };
      const measuredTrajectorySubtreeRect = (nodeId: string) => {
        const anchor = postFitNodeById.get(nodeId);
        if (!anchor) return null;
        const subtreeIds = new Set(
          anchor.descendants().map((candidate) => getNodeId(candidate as unknown as HierNode))
        );
        const labels = g.selectAll<SVGGraphicsElement, HierNode>('.category-label, .terminal-label')
          .filter(function trajectoryLabelBelongsToSubtree(candidate) {
            const datumId = getNodeId(candidate);
            const categoryId = this.getAttribute('data-category-node-id') || '';
            const terminalId = this.getAttribute('data-node-id') || '';
            return subtreeIds.has(datumId)
              || subtreeIds.has(categoryId)
              || subtreeIds.has(terminalId)
              || [...subtreeIds].some((subtreeId) => labelBelongsToNode(this, String(subtreeId)));
          })
          .nodes();
        return measureRenderedElementsInTreeSpace(labels);
      };
      g.selectAll<SVGGElement, unknown>('.babel-control-relation-layer')
        .each(function refineControlRelation() {
          const layer = d3.select(this);
          const domain = layer.select<SVGRectElement>('.babel-control-domain');
          const path = layer.select<SVGPathElement>('.babel-control-dependency');
          const domainNodeId = domain.empty() ? '' : domain.attr('data-control-domain');
          const controllerNodeId = path.attr('data-control-controller');
          const controlleeNodeId = path.attr('data-control-controllee');
          const domainRect = domainNodeId ? measuredTerminalSubtreesRect([domainNodeId])
            || measuredSubtreeRect(domainNodeId) : null;
          const controllerRect = measuredAcceptedAnchorRect(controllerNodeId);
          const controlleeRect = measuredAcceptedAnchorRect(controlleeNodeId);
          if (!controllerRect || !controlleeRect || (domainNodeId && !domainRect)) return;
          const domainBox = domainRect ? {
            x: domainRect.x - 34,
            y: domainRect.y - 26,
            width: domainRect.width + 68,
            height: domainRect.height + 52
          } : null;
          if (domainBox) domain
            .attr('x', domainBox.x.toFixed(1))
            .attr('y', domainBox.y.toFixed(1))
            .attr('width', domainBox.width.toFixed(1))
            .attr('height', domainBox.height.toFixed(1))
            .attr('rx', 3)
            .attr('data-control-domain', null);
          const controller = {
            x: controllerRect.x + controllerRect.width / 2,
            y: controllerRect.y + controllerRect.height / 2
          };
          const controllee = {
            x: controlleeRect.x + controlleeRect.width / 2,
            y: controlleeRect.y + controlleeRect.height / 2
          };
          const dependencySource = {
            x: domainBox ? Math.max(domainBox.x + 12, Math.min(domainBox.x + domainBox.width - 12, controllee.x)) : controllee.x,
            y: domainBox ? domainBox.y : controlleeRect.y - 12
          };
          const elbowY = Math.max(
            controller.y + 128,
            Math.min(controllee.y - 92, controller.y + Math.abs(controllee.y - controller.y) * 0.58)
          );
          const controllerApproach = controllerRect.y + controllerRect.height + 40;
          path
            .attr('d', [
              `M ${dependencySource.x.toFixed(1)} ${dependencySource.y.toFixed(1)}`,
              `L ${dependencySource.x.toFixed(1)} ${elbowY.toFixed(1)}`,
              `L ${controller.x.toFixed(1)} ${elbowY.toFixed(1)}`,
              `L ${controller.x.toFixed(1)} ${controllerApproach.toFixed(1)}`
            ].join(' '))
            .attr('data-control-controller', null)
            .attr('data-control-controllee', null);
          layer.selectAll<SVGTextElement, unknown>('.babel-control-index')
            .each(function refineControlIndex() {
              const badge = d3.select(this);
              const rect = measuredAcceptedAnchorRect(badge.attr('data-control-anchor'));
              if (!rect) return;
              badge
                .attr('x', (rect.x + rect.width + 12).toFixed(1))
                .attr('y', (rect.y + rect.height / 2 + 30).toFixed(1))
                .attr('data-control-anchor', null);
            });
        });
      g.selectAll<SVGGElement, unknown>('.babel-binding-relation-layer')
        .each(function refineBindingRelation() {
          const layer = d3.select(this);
          const domain = layer.select<SVGEllipseElement>('.babel-binding-domain');
          const domainRect = measuredSubtreeRect(domain.attr('data-binding-domain'));
          if (domainRect) {
            domain
              .attr('cx', (domainRect.x + domainRect.width / 2).toFixed(1))
              .attr('cy', (domainRect.y + domainRect.height / 2).toFixed(1))
              .attr('rx', ((domainRect.width / 2 + 34) * Math.SQRT2).toFixed(1))
              .attr('ry', ((domainRect.height / 2 + 26) * Math.SQRT2).toFixed(1))
              .attr('data-binding-domain', null);
          }
          layer.selectAll<SVGTextElement, unknown>('.babel-binding-index[data-binding-anchor]')
            .each(function refineBindingIndex() {
              const badge = d3.select(this);
              const rect = measuredAcceptedAnchorRect(badge.attr('data-binding-anchor'));
              if (!rect) return;
              badge
                .attr('x', (rect.x + rect.width + 12).toFixed(1))
                .attr('y', (rect.y + rect.height / 2 + 30).toFixed(1))
                .attr('data-binding-anchor', null);
            });
        });
      g.selectAll<SVGTextElement, unknown>('.babel-binding-index[data-coreference-anchor]')
        .each(function refineCoreferenceIndex() {
          const badge = d3.select(this);
          const rect = measuredAcceptedAnchorRect(badge.attr('data-coreference-anchor'));
          if (!rect) return;
          badge
            .attr('x', (rect.x + rect.width + 12).toFixed(1))
            .attr('y', (rect.y + rect.height / 2 + 30).toFixed(1))
            .attr('data-coreference-anchor', null);
        });
      const measuredPredicationRect = (nodeId: string) => {
        const structural = postFitNodeById.get(nodeId);
        const isPhrase = Boolean(structural && /P$/.test(String(structural.data.label || '')));
        if (isPhrase) return measuredSubtreeRect(nodeId);
        return unionRects(
          [measuredTerminalRect(nodeId), measuredShellRect(nodeId)]
            .filter((rect): rect is NonNullable<typeof rect> => Boolean(rect))
        );
      };
      g.selectAll<SVGGElement, unknown>('.babel-predication-relation-layer')
        .each(function refinePredicationRelation() {
          const layer = d3.select(this);
          const paths = layer.selectAll<SVGPathElement, unknown>('.babel-predication-path').nodes();
          const groups = new Map<string, SVGPathElement[]>();
          paths.forEach((path) => {
            const predicand = path.getAttribute('data-predicand') || '';
            groups.set(predicand, [...(groups.get(predicand) || []), path]);
          });
          groups.forEach((groupPaths, predicandNodeId) => {
            const predicandRect = measuredPredicationRect(predicandNodeId);
            if (!predicandRect) return;
            const sourceCenterX = predicandRect.x + predicandRect.width / 2;
            const resolved = groupPaths
              .map((path) => ({
                path,
                rect: measuredPredicationRect(path.getAttribute('data-predicate') || '')
              }))
              .filter((entry): entry is { path: SVGPathElement; rect: NonNullable<ReturnType<typeof measuredPredicationRect>> } => Boolean(entry.rect))
              .sort((left, right) =>
                Math.abs(left.rect.x + left.rect.width / 2 - sourceCenterX)
                - Math.abs(right.rect.x + right.rect.width / 2 - sourceCenterX));
            if (resolved.length === 0) return;
            const predicandBottom = predicandRect.y + predicandRect.height + 14;
            const lowestAnchor = Math.max(
              predicandRect.y + predicandRect.height,
              ...resolved.map(({ rect }) => rect.y + rect.height)
            );
            resolved.forEach(({ path, rect }, index) => {
              const sourceOffset = (index - (resolved.length - 1) / 2) * 18;
              const sourceX = sourceCenterX + sourceOffset;
              const targetX = rect.x + rect.width / 2;
              const targetBottom = rect.y + rect.height + 14;
              const laneY = lowestAnchor + 52 + index * 28;
              d3.select(path)
                .attr('d', [
                  `M ${sourceX.toFixed(1)} ${predicandBottom.toFixed(1)}`,
                  `L ${sourceX.toFixed(1)} ${laneY.toFixed(1)}`,
                  `L ${targetX.toFixed(1)} ${laneY.toFixed(1)}`,
                  `L ${targetX.toFixed(1)} ${targetBottom.toFixed(1)}`
                ].join(' '));
              layer.node()?.appendChild(path);
            });
          });
        });
      const refineFeaturePlaques = () => {
        g.selectAll<SVGGElement, unknown>('.babel-feature-plaque').each(function refineFeaturePlaque() {
          const plaque = d3.select(this);
          if (
            plaque.attr('data-feature-placement') === 'accepted'
          ) return;
          const anchorId = plaque.attr('data-feature-anchor');
          const anchorRect = measuredTerminalSubtreesRect([anchorId]);
          const shell = plaque.select<SVGRectElement>('.babel-feature-plaque-shell');
          if (!anchorRect || shell.empty()) return;
          const previousX = Number(shell.attr('x'));
          const previousY = Number(shell.attr('y'));
          const nextX = anchorRect.x + anchorRect.width / 2 - 180 - 18;
          const nextY = anchorRect.y + anchorRect.height + 30;
          const deltaX = nextX - previousX;
          const deltaY = nextY - previousY;
          shell
            .attr('x', nextX.toFixed(1))
            .attr('y', nextY.toFixed(1));
          plaque.select<SVGTextElement>('.babel-feature-plaque-title')
            .attr('x', function shiftTitleX() {
              return (Number(this.getAttribute('x')) + deltaX).toFixed(1);
            })
            .attr('y', function shiftTitleY() {
              return (Number(this.getAttribute('y')) + deltaY).toFixed(1);
            });
          plaque.selectAll<SVGTextElement, unknown>('.babel-feature-text')
            .attr('x', function shiftFeatureTextX() {
              return (Number(this.getAttribute('x')) + deltaX).toFixed(1);
            })
            .attr('y', function shiftFeatureTextY() {
              return (Number(this.getAttribute('y')) + deltaY).toFixed(1);
            });
          plaque.selectAll<SVGTSpanElement, unknown>('.babel-feature-text tspan')
            .attr('x', function shiftFeatureTspanX() {
              return (Number(this.getAttribute('x')) + deltaX).toFixed(1);
            });
        });
      };
      refineFeaturePlaques();
      deferredAcceptedRelationDraws.push(refineFeaturePlaques);
      const refineSplitAntecedenceComposition = () => {
        const matrix = g.node()?.getScreenCTM();
        if (!matrix) return;
        const screenScale = Math.hypot(matrix.a, matrix.b);
        if (!Number.isFinite(screenScale) || screenScale <= 0) return;
        const size = 10 / screenScale;
        g.selectAll<SVGRectElement, unknown>('.babel-split-antecedence-origin')
          .each(function refineSplitAntecedenceCompositionItem() {
            const origin = d3.select(this);
            const rawX = Number(origin.attr('data-split-antecedence-origin-x'));
            const rawY = Number(origin.attr('data-split-antecedence-origin-y'));
            if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return;
            const correctedOrigin = {
              x: rawX,
              y: rawY - 6 + 9 / screenScale
            };
            origin
              .attr('x', (correctedOrigin.x - size / 2).toFixed(1))
              .attr('y', (correctedOrigin.y - size / 2).toFixed(1))
              .attr('width', size.toFixed(1))
              .attr('height', size.toFixed(1));
            const relationHost = d3.select(this.parentElement);
            relationHost.selectAll<SVGPathElement, unknown>(
              '.babel-split-antecedence-path-shadow, .babel-split-antecedence-path'
            ).each(function refineSplitAntecedencePath() {
              const path = d3.select(this);
              const rawTargetX = Number(path.attr('data-split-antecedence-target-x'));
              const rawTargetY = Number(path.attr('data-split-antecedence-target-y'));
              const linkIndex = Number(path.attr('data-split-antecedence-link-index'));
              const linkCount = Number(path.attr('data-split-antecedence-link-count'));
              if (
                !Number.isFinite(rawTargetX)
                || !Number.isFinite(rawTargetY)
                || !Number.isFinite(linkIndex)
                || !Number.isFinite(linkCount)
              ) return;
              path.attr('d', splitAntecedenceLinkPath(
                correctedOrigin,
                {
                  x: rawTargetX,
                  y: rawTargetY - 6 + 13 / screenScale
                },
                linkIndex,
                linkCount,
                screenScale
              ));
            });
          });
      };
      refineSplitAntecedenceComposition();
      deferredAcceptedRelationDraws.push(refineSplitAntecedenceComposition);
      g.selectAll<SVGPathElement, unknown>(
        '.babel-phase-arc-shadow[data-phase-node], .babel-phase-arc[data-phase-node]'
      ).each(function refinePhaseArc() {
        const arc = d3.select(this);
        const phaseNodeId = arc.attr('data-phase-node');
        const edgeNodeId = arc.attr('data-phase-edge');
        const headRect = measuredShellRect(phaseNodeId);
        const domainRect = measuredTerminalSubtreesRect([phaseNodeId]);
        const edgeRect = edgeNodeId ? measuredShellRect(edgeNodeId) : null;
        if (headRect && domainRect) {
          arc.attr('d', phaseArcPath(
            headRect,
            domainRect,
            edgeRect,
            arc.attr('data-phase-primary') === 'true'
          ));
        }
        arc
          .attr('data-phase-node', null)
          .attr('data-phase-edge', null)
          .attr('data-phase-primary', null);
      });
      g.selectAll<SVGGElement, unknown>('.vr-item[data-operator-variable-operator]')
        .each(function refineOperatorVariableBinding() {
          const host = d3.select(this);
          const operatorRect = measuredShellRect(host.attr('data-operator-variable-operator'));
          const variableNodeId = host.attr('data-operator-variable-variable');
          const witnessNodeId = host.attr('data-operator-variable-witness');
          const variableRect = (witnessNodeId ? measuredTerminalRect(witnessNodeId) : null)
            || measuredAcceptedAnchorRect(variableNodeId);
          if (!operatorRect || !variableRect) return;

          const rank = Number(host.attr('data-operator-variable-rank')) || 0;
          const scopeCount = Math.max(1, Number(host.attr('data-operator-variable-count')) || 1);
          const domainNodeId = host.attr('data-operator-variable-domain');
          const hull = domainNodeId ? operatorVariableScopeHull(domainNodeId, rank) : null;
          if (domainNodeId && !hull) return;
          if (hull) {
            host.select<SVGPathElement>('.babel-operator-variable-domain')
              .attr('d', operatorVariableScopeEnvelope(hull) || '');
          }

          const variableCenterX = variableRect.x + variableRect.width / 2;
          const operatorCenterX = operatorRect.x + operatorRect.width / 2;
          const direction = variableCenterX >= operatorCenterX ? 1 : -1;
          const fromX = variableRect.x + (direction > 0 ? variableRect.width + 5 : -5);
          const fromY = variableRect.y + variableRect.height * 0.58;
          const toX = operatorRect.x + (direction > 0 ? operatorRect.width + 5 : -5);
          const toY = operatorRect.y + operatorRect.height * 0.62;
          const hullXs = hull?.map((point) => point[0]) || [];
          const routeEdge = direction > 0
            ? Math.max(fromX, toX, ...hullXs)
            : Math.min(fromX, toX, ...hullXs);
          const routeX = routeEdge + direction * (38 + (scopeCount - rank - 1) * 18);
          host.select<SVGPathElement>('.babel-operator-variable-path')
            .attr('d', [
              `M ${fromX.toFixed(1)} ${fromY.toFixed(1)}`,
              `C ${routeX.toFixed(1)} ${fromY.toFixed(1)}, ${routeX.toFixed(1)} ${toY.toFixed(1)}, ${toX.toFixed(1)} ${toY.toFixed(1)}`
            ].join(' '));

          host.selectAll<SVGTextElement, unknown>('.babel-operator-variable-index')
            .each(function refineOperatorVariableIndex() {
              const index = d3.select(this);
              const rect = index.attr('data-operator-variable-index-role') === 'operator'
                ? operatorRect
                : variableRect;
              index
                .attr('x', (rect.x + rect.width + 10).toFixed(1))
                .attr('y', (rect.y + rect.height * 0.72).toFixed(1));
            });
        });
      g.selectAll<SVGGElement, unknown>('.vr-item[data-qr-pronounced]').each(function refineQuantifierRaising() {
        const host = d3.select(this);
        const pronouncedRect = measuredShellRect(host.attr('data-qr-pronounced'));
        const lfRect = measuredShellRect(host.attr('data-qr-lf'));
        if (!pronouncedRect || !lfRect) return;

        const layer = host.select<SVGGElement>('.babel-lf-relation-layer');
        const domainNodeId = host.attr('data-qr-domain');
        if (domainNodeId) {
          const domainRect = measuredSubtreeRect(domainNodeId);
          if (!domainRect) return;
          layer.select<SVGRectElement>('.babel-lf-domain')
            .attr('x', (domainRect.x - 52).toFixed(1))
            .attr('y', (domainRect.y - 46).toFixed(1))
            .attr('width', (domainRect.width + 104).toFixed(1))
            .attr('height', (domainRect.height + 98).toFixed(1));
        }

        const pronouncedCenter = {
          x: pronouncedRect.x + pronouncedRect.width / 2,
          y: pronouncedRect.y + pronouncedRect.height / 2
        };
        const lfCenter = {
          x: lfRect.x + lfRect.width / 2,
          y: lfRect.y + lfRect.height / 2
        };
        const verticalGap = Math.max(100, Math.abs(pronouncedCenter.y - lfCenter.y) * 0.44);
        const elbowY = Math.min(pronouncedCenter.y - 86, lfCenter.y + verticalGap);
        layer.select<SVGPathElement>('.babel-lf-path-qr')
          .attr('d', [
            `M ${pronouncedCenter.x.toFixed(1)} ${(pronouncedRect.y - 12).toFixed(1)}`,
            `L ${pronouncedCenter.x.toFixed(1)} ${elbowY.toFixed(1)}`,
            `L ${lfCenter.x.toFixed(1)} ${elbowY.toFixed(1)}`,
            `L ${lfCenter.x.toFixed(1)} ${(lfRect.y + lfRect.height + 20).toFixed(1)}`
          ].join(' '));

        const indices = host.selectAll<SVGTextElement, unknown>('.babel-binding-index').nodes();
        [pronouncedRect, lfRect].forEach((rect, index) => {
          d3.select(indices[index])
            .attr('x', (rect.x + rect.width + 12).toFixed(1))
            .attr('y', (rect.y + rect.height / 2 + 30).toFixed(1));
        });
      });
      g.selectAll<SVGGElement, unknown>('.babel-gapping-alignment-layer').each(function refineGappingAlignment() {
        const layer = d3.select(this);
        const host = d3.select(this.parentElement as SVGGElement);
        const antecedentRect = measuredShellRect(host.attr('data-gapping-antecedent'));
        const gapRect = measuredShellRect(host.attr('data-gapping-gap'));
        const treeRect = measuredTreeLabelsRect();
        const pairs = JSON.parse(host.attr('data-gapping-pairs') || '[]') as Array<{
          correlateNodeId: string;
          remnantNodeId: string;
          label: string;
        }>;
        if (!antecedentRect || !gapRect || !treeRect) return;
        const markerId = layer.select<SVGMarkerElement>('marker').attr('id');
        const correspondence = (
          path: d3.Selection<SVGPathElement, unknown, null, undefined>,
          source: { x: number; y: number; width: number; height: number },
          target: { x: number; y: number; width: number; height: number },
          laneY: number
        ) => {
          const start = {
            x: source.x + source.width / 2,
            y: source.y + source.height + 10
          };
          const end = {
            x: target.x + target.width / 2,
            y: target.y + target.height + 10
          };
          path
            .attr('marker-end', `url(#${markerId})`)
            .attr('d', [
              `M ${start.x.toFixed(1)} ${start.y.toFixed(1)}`,
              `C ${start.x.toFixed(1)} ${laneY.toFixed(1)}`,
              `${end.x.toFixed(1)} ${laneY.toFixed(1)}`,
              `${end.x.toFixed(1)} ${end.y.toFixed(1)}`
            ].join(' '));
        };
        const laneBase = treeRect.y + treeRect.height + 72;
        correspondence(
          layer.select<SVGPathElement>('.babel-gapping-correspondence-predicate'),
          antecedentRect,
          gapRect,
          laneBase
        );
        const pairPaths = layer.selectAll<SVGPathElement, unknown>('.babel-gapping-correspondence-pair').nodes();
        const indices = layer.selectAll<SVGTextElement, unknown>('.babel-gapping-index').nodes();
        pairs.forEach((pair, pairIndex) => {
          const correlateRect = measuredShellRect(pair.correlateNodeId);
          const remnantRect = measuredShellRect(pair.remnantNodeId);
          if (!correlateRect || !remnantRect || !pairPaths[pairIndex]) return;
          correspondence(
            d3.select(pairPaths[pairIndex]),
            correlateRect,
            remnantRect,
            laneBase + 44 + pairIndex * 38
          );
          d3.select(indices[pairIndex * 2])
            .attr('x', (correlateRect.x + correlateRect.width + 10).toFixed(1))
            .attr('y', (correlateRect.y + correlateRect.height * 0.78).toFixed(1));
          d3.select(indices[pairIndex * 2 + 1])
            .attr('x', (remnantRect.x + remnantRect.width + 10).toFixed(1))
            .attr('y', (remnantRect.y + remnantRect.height * 0.78).toFixed(1));
        });
      });
      g.selectAll<SVGGElement, unknown>('.babel-pf-relation-layer').each(function renderPfRealizationPlate() {
        const layer = d3.select(this);
        const targetNodeIds = JSON.parse(layer.attr('data-pf-targets') || '[]') as string[];
        const allRows = JSON.parse(layer.attr('data-pf-rows') || '[]') as Array<{ label: string; value: string }>;
        const rowKinds = JSON.parse(layer.attr('data-pf-row-kinds') || '[]') as Array<'rewrite' | 'literal'>;
        const rowRefs = JSON.parse(layer.attr('data-pf-row-refs') || '[]') as Array<{
          stageIndex: number;
          relationIndex: number;
        } | null>;
        const visibleRows = allRows.flatMap((row, rowIndex) => {
          const ref = rowRefs[rowIndex];
          const visible = playedRelationIndices === null
            || !ref
            || ref.stageIndex < activeDerivationFrameIndex
            || (ref.stageIndex === activeDerivationFrameIndex && playedRelationIndices.has(ref.relationIndex));
          return visible ? [{ ...row, rowIndex, kind: rowKinds[rowIndex], isFinal: rowIndex === allRows.length - 1 }] : [];
        });
        const finalOutput = rowKinds.at(-1) === 'rewrite' ? allRows.at(-1)?.value || '' : '';
        const isZeroRealization = finalOutput === '∅' && allRows.length === 1;
        const targetRect = isZeroRealization
          ? measuredTerminalSubtreesRect(targetNodeIds)
          : unionRects(targetNodeIds.flatMap((nodeId) => {
              const shell = measuredShellRect(nodeId);
              const terminal = measuredTerminalRect(nodeId);
              return [shell, terminal].filter((rect): rect is NonNullable<typeof rect> => Boolean(rect));
            }));
        if (!targetRect) return;

        const origin = replayPlaqueLayout.get(Number(layer.attr('data-plaque-item-index')));
        if (!origin) return;
        const layout = reservePlaqueViewport(withPlaqueTextMeasure(svg, measureText =>
          preparePfPlaqueTextLayout(visibleRows, { isZeroRealization, measureText })), origin.scrollHeight);
        const { width: plateWidth, height: plateHeight } = layout;
        const platePadX = 26;
        layer.attr('data-plaque-location', origin.location).attr('data-plaque-domain', origin.domainId);

        layer.append('rect')
          .attr('class', 'babel-pf-plate-shell')
          .attr('data-vr-hit-area', 'true')
          .attr('x', origin.x.toFixed(1))
          .attr('y', origin.y.toFixed(1))
          .attr('width', plateWidth.toFixed(1))
          .attr('height', plateHeight.toFixed(1))
          .attr('rx', 8);
        const content = appendPlaqueContent(layer, layout, origin);
        drawPlaqueText(content, layout.title, 'babel-pf-plate-title', origin);
        const appendRule = (y: number) => content.append('line')
          .attr('class', 'babel-pf-plate-rule')
          .attr('x1', (origin.x + platePadX).toFixed(1))
          .attr('x2', (origin.x + plateWidth - platePadX).toFixed(1))
          .attr('y1', y.toFixed(1))
          .attr('y2', y.toFixed(1));
        appendRule(origin.y + layout.titleRuleY);
        layout.rows.forEach(row => {
          const rowGroup = content.append('g').attr('data-plaque-row-index', row.rowIndex);
          if (row.ruleY !== undefined) appendRule(origin.y + row.ruleY);
          row.parts.forEach(part => {
            const className = part.kind === 'arrow' ? 'babel-pf-plate-arrow'
              : `babel-pf-plate-text${part.kind === 'output' ? ' babel-pf-plate-output' : ''}`;
            drawPlaqueText(rowGroup, part.block,
              `${className}${row.isFinal && part.kind !== 'arrow' ? ' babel-pf-plate-text-final' : ''}`, origin);
          });
        });
        layer
          .attr('data-pf-targets', null)
          .attr('data-pf-rows', null)
          .attr('data-pf-row-kinds', null)
          .attr('data-pf-row-refs', null);
      });
      g.selectAll<SVGPathElement, unknown>('.babel-blocked-extraction-path').each(function refineBlockedExtractionPath() {
        const path = d3.select(this);
        const sourceRect = measuredShellRect(path.attr('data-extraction-source'));
        const targetRect = measuredShellRect(path.attr('data-extraction-target'));
        const domainRect = measuredSubtreeRect(path.attr('data-extraction-domain'));
        if (!sourceRect || !targetRect || !domainRect) return;
        const source = {
          x: sourceRect.x + sourceRect.width / 2,
          y: sourceRect.y + sourceRect.height + 14
        };
        const target = {
          x: targetRect.x + targetRect.width / 2,
          y: targetRect.y + targetRect.height + 14
        };
        const laneY = Math.max(source.y, target.y, domainRect.y + domainRect.height) + 94;
        const span = Math.max(120, Math.abs(source.x - target.x));
        const direction = Math.sign(source.x - target.x || 1);
        const targetControlX = target.x + direction * span * 0.12;
        const sourceControlX = source.x - direction * span * 0.12;
        const d = [
          `M ${target.x.toFixed(1)} ${target.y.toFixed(1)}`,
          `C ${targetControlX.toFixed(1)} ${laneY.toFixed(1)},`,
          `${sourceControlX.toFixed(1)} ${laneY.toFixed(1)},`,
          `${source.x.toFixed(1)} ${source.y.toFixed(1)}`
        ].join(' ');
        path.attr('d', d);
      });
      const layoutAnalysisVerdicts = (initialCameraScale: number) => {
        const treeRect = measuredTreeLabelsRect();
        if (!treeRect) return;
        const analysisVerdicts = g.selectAll<SVGGElement, unknown>('.babel-analysis-verdict');
        const localScale = analysisVerdictInitialLocalScale(initialCameraScale);
        const entries = planAnalysisVerdictRows<AnalysisVerdictAnchor & { node: SVGGElement }>(
          analysisVerdicts.nodes().flatMap((node, order) => {
            const verdict = d3.select(node);
            const analysisNodeId = verdict.attr('data-analysis-verdict-anchor');
            const anchorRect = measuredSubtreeRect(analysisNodeId);
            if (!anchorRect) return [];
            return [{
              node,
              order,
              analysisNodeId,
              desiredY: anchorRect.y + anchorRect.height / 2
            }];
          }),
          34 / Math.max(0.001, initialCameraScale || 1)
        );
        entries.forEach(({ node, y }) => {
          const verdict = d3.select(node);
          const compound = verdict.select<SVGTextElement>('.babel-analysis-verdict-text');
          const compoundNode = compound.node();
          if (!compoundNode) return;
          const compoundRect = compoundNode.getBBox();
          const scaledCompoundRect = {
            x: compoundRect.x * localScale,
            y: compoundRect.y * localScale,
            width: compoundRect.width * localScale,
            height: compoundRect.height * localScale
          };
          const origin = analysisVerdictCompoundOrigin(
            treeRect,
            scaledCompoundRect,
            y,
            5 / Math.max(0.001, initialCameraScale || 1)
          );
          verdict.attr(
            'transform',
            `translate(${origin.x.toFixed(1)},${origin.y.toFixed(1)}) scale(${localScale.toFixed(6)})`
          );
        });
      };
      const fittedSvgNode = svg.node();
      if (fittedSvgNode) {
        const fittedScale = d3.zoomTransform(fittedSvgNode).k || 1;
        updateScreenStableText(fittedScale);
        layoutAnalysisVerdicts(fittedScale);
      }
      g.selectAll<SVGGElement, unknown>('.babel-idiom-chunk-relation-layer').each(function refineIdiomChunkRelation() {
        const layer = d3.select(this);
        const bracket = layer.select<SVGPathElement>('.babel-idiom-domain-bracket');
        const relationHost = this.closest('.vr-item');
        const stageIndex = relationHost?.getAttribute('data-vr-stage-index') || '';
        const relationIndex = relationHost?.getAttribute('data-vr-relation-index') || '';
        const domainRect = bracket.empty() ? null : measuredSubtreeRect(bracket.attr('data-idiom-domain'));

        const chunkElements = g.selectAll<SVGGElement, unknown>('.vr-idiom-chunk-anchor')
          .filter(function sameRelation() {
            const candidateHost = this.closest('.vr-item');
            return candidateHost?.getAttribute('data-vr-stage-index') === stageIndex
              && candidateHost?.getAttribute('data-vr-relation-index') === relationIndex;
          })
          .nodes();
        const terminalElements = new Set<SVGTextElement>();
        chunkElements.forEach((chunkElement) => {
          const chunkNode = postFitNodeById.get(chunkElement.getAttribute('data-idiom-chunk') || '');
          if (!chunkNode) return;
          const chunkIds = new Set(chunkNode.descendants().map((candidate) => getNodeId(candidate as unknown as HierNode)));
          g.selectAll<SVGTextElement, HierNode>('.terminal-label')
            .filter(function terminalBelongsToChunk(candidate) {
              const datumId = getNodeId(candidate);
              const terminalId = this.getAttribute('data-node-id') || '';
              return chunkIds.has(datumId)
                || chunkIds.has(terminalId)
                || [...chunkIds].some((chunkId) => labelBelongsToNode(this, String(chunkId)));
            })
            .nodes()
            .forEach((terminal) => terminalElements.add(terminal));
        });

        const inverse = treeMatrix.inverse();
        const chunksByLine = new Map<number, Array<{ x: number; y: number; width: number; height: number }>>();
        terminalElements.forEach((terminal) => {
          const rect = terminal.getBoundingClientRect();
          const topLeft = new DOMPoint(rect.left, rect.top).matrixTransform(inverse);
          const bottomRight = new DOMPoint(rect.right, rect.bottom).matrixTransform(inverse);
          const local = {
            x: topLeft.x,
            y: topLeft.y,
            width: bottomRight.x - topLeft.x,
            height: bottomRight.y - topLeft.y
          };
          const lineKey = Math.round((local.y + local.height / 2) / 12) * 12;
          chunksByLine.set(lineKey, [...(chunksByLine.get(lineKey) || []), local]);
        });
        chunksByLine.forEach((rects) => {
          const runs: Array<{ x: number; right: number; bottom: number }> = [];
          [...rects].sort((left, right) => left.x - right.x).forEach((rect) => {
            const right = rect.x + rect.width;
            const bottom = rect.y + rect.height;
            const previous = runs[runs.length - 1];
            if (previous && rect.x - previous.right <= 30) {
              previous.right = Math.max(previous.right, right);
              previous.bottom = Math.max(previous.bottom, bottom);
            } else {
              runs.push({ x: rect.x, right, bottom });
            }
          });
          runs.forEach((run) => {
            layer.insert('path', '.babel-idiom-domain-bracket')
              .attr('class', 'babel-idiom-chunk-underline')
              .attr('d', `M ${run.x.toFixed(1)} ${(run.bottom + 7).toFixed(1)} H ${run.right.toFixed(1)}`);
          });
        });

        if (!domainRect) return;
        const bracketX = domainRect.x + domainRect.width + 320;
        const bracketTop = domainRect.y - 80;
        const bracketBottom = domainRect.y + domainRect.height + 80;
        const cap = 96;
        bracket.attr('d', [
          `M ${(bracketX - cap).toFixed(1)} ${bracketTop.toFixed(1)}`,
          `H ${bracketX.toFixed(1)}`,
          `V ${bracketBottom.toFixed(1)}`,
          `H ${(bracketX - cap).toFixed(1)}`
        ].join(' '));
      });
      g.selectAll<SVGPathElement, unknown>('.vr-trajectory-parasitic-gap').each(function refineParasiticGapPath() {
        const path = d3.select(this);
        const sourceRect = path.attr('data-trajectory-source-attachment') === 'shell-bottom'
          ? measuredTrajectoryShellRect(path.attr('data-trajectory-from'))
          : measuredTrajectoryTerminalRect(path.attr('data-trajectory-from-witness'));
        const targetRect = measuredTrajectoryShellRect(path.attr('data-trajectory-to'));
        if (!sourceRect || !targetRect) return;
        const sourceCenter = {
          x: sourceRect.x + sourceRect.width / 2,
          y: sourceRect.y + sourceRect.height + 6
        };
        const targetCenter = {
          x: targetRect.x + targetRect.width / 2,
          y: targetRect.y + targetRect.height + 6
        };
        const direction = Math.sign(targetCenter.x - sourceCenter.x) || 1;
        const start = { x: sourceCenter.x + 8 * direction, y: sourceCenter.y };
        const requestedTargetShift = -8 * direction;
        const targetShiftLimit = Math.max(2, Math.min(18, targetRect.width / 2 - 1));
        const targetShift = Math.max(-targetShiftLimit, Math.min(targetShiftLimit, requestedTargetShift));
        const end = { x: targetCenter.x + targetShift, y: targetCenter.y };
        const control = {
          x: (start.x + end.x) / 2,
          y: Math.max(start.y, end.y) + Math.max(42, Math.abs(end.x - start.x) * 0.2)
        };
        const d = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${control.x.toFixed(1)} ${control.y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
        path.attr('d', d);
        d3.select(this.parentElement)
          .select<SVGPathElement>('.babel-trajectory-path-shadow')
          .attr('d', d);
      });
      g.selectAll<SVGGraphicsElement, unknown>('.babel-pg-path-node').each(function refinePhillipsPathNode() {
        const mark = d3.select(this);
        const labelRect = measuredShellRect(mark.attr('data-path-node'));
        if (!labelRect) return;
        const padX = 11;
        const padY = 8;
        if (this.tagName.toLowerCase() === 'ellipse') {
          mark
            .attr('cx', (labelRect.x + labelRect.width / 2).toFixed(1))
            .attr('cy', (labelRect.y + labelRect.height / 2).toFixed(1))
            .attr('rx', (labelRect.width / 2 + padX).toFixed(1))
            .attr('ry', (labelRect.height / 2 + padY).toFixed(1));
        } else {
          mark
            .attr('x', (labelRect.x - padX).toFixed(1))
            .attr('y', (labelRect.y - padY).toFixed(1))
            .attr('width', (labelRect.width + padX * 2).toFixed(1))
            .attr('height', (labelRect.height + padY * 2).toFixed(1))
            .attr('rx', 2);
        }
      });
      g.selectAll<SVGGElement, unknown>('.babel-pg-island-relation-layer').each(function refinePhillipsBlockedEdge() {
        const layer = d3.select(this);
        const slashes = layer.selectAll<SVGLineElement, unknown>('.babel-pg-blocked-edge').nodes();
        const blockedEdgeNodeId = slashes[0]?.getAttribute('data-blocked-edge-node') || '';
        if (!blockedEdgeNodeId || slashes.length === 0) return;
        const branch = g.select<SVGPathElement>(`.branch[data-target-node-id="${blockedEdgeNodeId}"]`).node();
        if (!branch || branch.getTotalLength() <= 0) return;
        const length = branch.getTotalLength();
        const centre = branch.getPointAtLength(length * 0.58);
        const before = branch.getPointAtLength(Math.max(0, length * 0.58 - 2));
        const after = branch.getPointAtLength(Math.min(length, length * 0.58 + 2));
        const tangent = { x: after.x - before.x, y: after.y - before.y };
        const magnitude = Math.hypot(tangent.x, tangent.y) || 1;
        const normal = { x: -tangent.y / magnitude, y: tangent.x / magnitude };
        const tangentUnit = { x: tangent.x / magnitude, y: tangent.y / magnitude };
        [-28, 28].forEach((offset, slashIndex) => {
          const slash = slashes[slashIndex];
          if (!slash) return;
          const midpoint = {
            x: centre.x + tangentUnit.x * offset,
            y: centre.y + tangentUnit.y * offset
          };
          d3.select(slash)
            .attr('x1', (midpoint.x - normal.x * 20).toFixed(1))
            .attr('y1', (midpoint.y - normal.y * 20).toFixed(1))
            .attr('x2', (midpoint.x + normal.x * 20).toFixed(1))
            .attr('y2', (midpoint.y + normal.y * 20).toFixed(1))
            .attr('data-blocked-edge-node', null);
        });
      });
      g.selectAll<SVGTextElement, unknown>('.babel-binding-index[data-coindex-anchor]').each(function refineParasiticGapCoindex() {
        const badge = d3.select(this);
        const labelRect = measuredShellRect(badge.attr('data-coindex-anchor'));
        if (!labelRect) return;
        badge
          .attr('x', (labelRect.x + labelRect.width + 12).toFixed(1))
          .attr('y', (labelRect.y + labelRect.height / 2 + 30).toFixed(1))
          .attr('data-coindex-anchor', null);
      });
      g.selectAll<SVGTextElement, unknown>('.babel-pg-gap-label[data-gap-label-anchor]').each(function refineParasiticGapLabel() {
        const badge = d3.select(this);
        const labelRect = measuredTerminalSubtreesRect([badge.attr('data-gap-label-anchor')]);
        if (!labelRect) return;
        badge
          .attr('x', (labelRect.x + labelRect.width + 12).toFixed(1))
          .attr('y', (labelRect.y + labelRect.height / 2 + 10).toFixed(1))
          .attr('data-gap-label-anchor', null);
      });
      const blockedEdgeSlashes = g.selectAll<SVGLineElement, unknown>('.vr-shape-blocked-edge-slash').nodes();
      const slashesByEdge = d3.group(blockedEdgeSlashes, (slash) => slash.getAttribute('data-blocked-edge-node') || '');
      slashesByEdge.forEach((slashes, blockedEdgeNodeId) => {
        if (!blockedEdgeNodeId || slashes.length !== 2) return;
        const branch = g.select<SVGPathElement>(`.branch[data-target-node-id="${blockedEdgeNodeId}"]`).node();
        if (!branch) return;
        const length = branch.getTotalLength();
        if (!(length > 0)) return;
        const centreLength = length * 0.58;
        const centre = branch.getPointAtLength(centreLength);
        const before = branch.getPointAtLength(Math.max(0, centreLength - 2));
        const after = branch.getPointAtLength(Math.min(length, centreLength + 2));
        const tangent = { x: after.x - before.x, y: after.y - before.y };
        const magnitude = Math.hypot(tangent.x, tangent.y) || 1;
        const normal = { x: -tangent.y / magnitude, y: tangent.x / magnitude };
        const tangentUnit = { x: tangent.x / magnitude, y: tangent.y / magnitude };
        [-28, 28].forEach((offset, slashIndex) => {
          const midpoint = {
            x: centre.x + tangentUnit.x * offset,
            y: centre.y + tangentUnit.y * offset
          };
          d3.select(slashes[slashIndex])
            .attr('x1', (midpoint.x - normal.x * 20).toFixed(1))
            .attr('y1', (midpoint.y - normal.y * 20).toFixed(1))
            .attr('x2', (midpoint.x + normal.x * 20).toFixed(1))
            .attr('y2', (midpoint.y + normal.y * 20).toFixed(1));
        });
      });
      const atbPaths = g.selectAll<SVGPathElement, unknown>('.vr-trajectory-atb').nodes();
      atbPaths.forEach((pathNode, pathIndex) => {
        const path = d3.select(pathNode);
        const sourceRect = measuredTrajectoryTerminalRect(path.attr('data-trajectory-from-witness'));
        const targetRect = measuredTrajectoryShellRect(path.attr('data-trajectory-to'));
        if (!sourceRect || !targetRect) return;
        const sourceCenter = {
          x: sourceRect.x + sourceRect.width / 2,
          y: sourceRect.y + sourceRect.height + 6
        };
        const targetCenter = {
          x: targetRect.x + targetRect.width / 2,
          y: targetRect.y + targetRect.height + 6
        };
        const direction = Math.sign(targetCenter.x - sourceCenter.x) || 1;
        const start = { x: sourceCenter.x + 8 * direction, y: sourceCenter.y };
        const groupedOffset = (pathIndex - ((atbPaths.length - 1) / 2)) * 18;
        const requestedTargetShift = -8 * direction + groupedOffset;
        const targetShiftLimit = Math.max(2, Math.min(18, targetRect.width / 2 - 1));
        const targetShift = Math.max(-targetShiftLimit, Math.min(targetShiftLimit, requestedTargetShift));
        const end = { x: targetCenter.x + targetShift, y: targetCenter.y };
        const control = {
          x: (start.x + end.x) / 2,
          y: Math.max(start.y, end.y) + Math.max(42, Math.abs(end.x - start.x) * 0.2)
        };
        const d = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${control.x.toFixed(1)} ${control.y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
        path.attr('d', d);
        d3.select(pathNode.parentElement)
          .select<SVGPathElement>('.babel-trajectory-path-shadow')
          .attr('d', d);
      });
      g.selectAll<SVGPathElement, unknown>('.vr-trajectory-sideward').each(function refineSidewardPath() {
        const path = d3.select(this);
        const sourceRect = measuredTrajectoryShellRect(path.attr('data-trajectory-from'));
        const targetRect = measuredTrajectoryShellRect(path.attr('data-trajectory-to'));
        if (!sourceRect || !targetRect) return;
        const textRects = g.selectAll<SVGTextElement, HierNode>('text').nodes()
          .map((label) => {
            return measureRenderedElementsInTreeSpace([label]);
          })
          .filter((rect): rect is { x: number; y: number; width: number; height: number } => Boolean(rect));
        const treeTop = d3.min(textRects, (rect) => rect.y);
        const start = {
          x: sourceRect.x + sourceRect.width / 2,
          y: sourceRect.y - 8
        };
        const end = {
          x: targetRect.x + targetRect.width / 2,
          y: targetRect.y - 8
        };
        const crestY = Math.min(
          treeTop !== undefined ? treeTop - 90 : start.y - 90,
          start.y - 70,
          end.y - 70
        );
        const d = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${start.x.toFixed(1)} ${crestY.toFixed(1)}, ${end.x.toFixed(1)} ${crestY.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
        path.attr('d', d);
        d3.select(this.parentElement)
          .select<SVGPathElement>('.babel-trajectory-path-shadow')
          .attr('d', d);
      });
      const productionTrajectoryPaths = g.selectAll<SVGPathElement, unknown>('.vr-trajectory').nodes();
      g.selectAll<SVGPathElement, unknown>(
        '.vr-trajectory-remnant, .vr-trajectory-roll-up, .vr-trajectory-smuggling'
      ).each(function refineOrthogonalTrajectory() {
        const path = d3.select(this);
        const kind = path.attr('data-trajectory-kind');
        const sourceRect = measuredTrajectoryShellRect(path.attr('data-trajectory-from'));
        const sourceExtent = measuredTrajectorySubtreeRect(path.attr('data-trajectory-from'));
        const targetRect = measuredTrajectoryShellRect(path.attr('data-trajectory-to'));
        const targetExtent = measuredTrajectorySubtreeRect(path.attr('data-trajectory-to'));
        if (!sourceRect || !sourceExtent || !targetRect || !targetExtent) return;

        const departureIds = String(path.attr('data-trajectory-orthogonal-departures') || '')
          .split(/\s+/u)
          .filter(Boolean);
        const departureRect = kind === 'remnant' && departureIds.length > 0
          ? unionRects(
              departureIds
                .map(measuredTrajectoryTerminalRect)
                .filter((rect): rect is { x: number; y: number; width: number; height: number } => Boolean(rect))
            )
          : null;
        const pathIndex = Math.max(0, productionTrajectoryPaths.indexOf(this));
        const sourceX = departureRect
          ? departureRect.x + departureRect.width / 2
          : sourceRect.x + sourceRect.width / 2;
        const rawTargetX = targetRect.x + targetRect.width / 2;
        const targetX = kind === 'roll-up'
          ? rawTargetX - Number.EPSILON * Math.max(1, Math.abs(rawTargetX))
          : rawTargetX;
        const originY = kind === 'roll-up'
          ? sourceRect.y + sourceRect.height + 6
          : sourceExtent.y + sourceExtent.height + (kind === 'smuggling' ? 28 : 0) + 6;

        const treeRect = measureRenderedElementsInTreeSpace(
          g.selectAll<SVGGraphicsElement, HierNode>('.category-label, .terminal-label').nodes()
        );
        let laneY = treeRect
          ? treeRect.y + treeRect.height + 90 * (1 + pathIndex)
          : originY + 90 * (1 + pathIndex);
        if (kind === 'roll-up') {
          const obstacles = g.selectAll<SVGGraphicsElement, HierNode>('text')
            .nodes()
            .map((label) => measureRenderedElementsInTreeSpace([label]))
            .filter((rect): rect is { x: number; y: number; width: number; height: number } => Boolean(rect));
          const laneIsClear = (candidateY: number) => !obstacles.some((rect) =>
            candidateY >= rect.y - 8
            && candidateY <= rect.y + rect.height + 8
            && Math.min(sourceX, targetX) - 8 <= rect.x + rect.width
            && Math.max(sourceX, targetX) + 8 >= rect.x);
          laneY = originY + 46;
          for (let attempt = 0; attempt < 40 && !laneIsClear(laneY); attempt += 1) {
            laneY += 12;
          }
        }

        const targetArrivalRect = kind === 'remnant' ? targetExtent : targetRect;
        const targetBoxBottom = kind === 'remnant'
          ? targetExtent.y + targetExtent.height + 24 + 3
          : targetArrivalRect.y + targetArrivalRect.height + 8;
        const end = {
          x: targetX,
          y: Math.min(targetBoxBottom, laneY - 8)
        };
        const d = orthogonalTrajectoryPath({ x: sourceX, y: originY }, end, laneY);
        path.attr('d', d);
        d3.select(this.parentElement)
          .select<SVGPathElement>('.babel-trajectory-path-shadow')
          .attr('d', d);
      });
      g.selectAll<SVGPathElement, unknown>('.vr-trajectory-phrasal').each(function refinePhrasalPath() {
        const path = d3.select(this);
        const sourceRect = path.attr('data-trajectory-source-attachment') === 'shell-bottom'
          ? measuredTrajectoryShellRect(path.attr('data-trajectory-from'))
          : measuredTrajectoryTerminalRect(path.attr('data-trajectory-from-witness'));
        const targetRect = measuredTrajectoryShellRect(path.attr('data-trajectory-to'));
        if (!sourceRect || !targetRect) return;
        const sourceCenter = {
          x: sourceRect.x + sourceRect.width / 2,
          y: sourceRect.y + sourceRect.height + 6
        };
        const targetCenter = {
          x: targetRect.x + targetRect.width / 2,
          y: targetRect.y + targetRect.height + 6
        };
        const direction = Math.sign(targetCenter.x - sourceCenter.x) || 1;
        const start = { x: sourceCenter.x + 8 * direction, y: sourceCenter.y };
        const requestedTargetShift = -8 * direction;
        const targetShiftLimit = Math.max(2, Math.min(18, targetRect.width / 2 - 1));
        const targetShift = Math.max(-targetShiftLimit, Math.min(targetShiftLimit, requestedTargetShift));
        const end = { x: targetCenter.x + targetShift, y: targetCenter.y };
        const control = {
          x: (start.x + end.x) / 2,
          y: Math.max(start.y, end.y) + Math.max(42, Math.abs(end.x - start.x) * 0.2)
        };
        const d = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${control.x.toFixed(1)} ${control.y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
        path.attr('d', d);
        d3.select(this.parentElement)
          .select<SVGPathElement>('.babel-trajectory-path-shadow')
          .attr('d', d);
      });
      g.selectAll<SVGPathElement, unknown>(
        '.vr-trajectory-head, .vr-trajectory-lowering'
      ).each(function refineTerminalTrajectory() {
        const path = d3.select(this);
        const sourceRect = path.attr('data-trajectory-source-attachment') === 'shell-bottom'
          ? measuredTrajectoryShellRect(path.attr('data-trajectory-from'))
          : measuredTrajectoryTerminalRect(path.attr('data-trajectory-from-witness') || path.attr('data-trajectory-from'));
        const targetRect = path.attr('data-trajectory-target-attachment') === 'shell-bottom'
          ? measuredTrajectoryShellRect(path.attr('data-trajectory-to'))
          : measuredTrajectoryTerminalRect(path.attr('data-trajectory-to'));
        if (!sourceRect || !targetRect) return;
        const sourceCenter = {
          x: sourceRect.x + sourceRect.width / 2,
          y: sourceRect.y + sourceRect.height + 6
        };
        const targetCenter = {
          x: targetRect.x + targetRect.width / 2,
          y: targetRect.y + targetRect.height + 6
        };
        const direction = Math.sign(targetCenter.x - sourceCenter.x) || 1;
        const start = { x: sourceCenter.x + 8 * direction, y: sourceCenter.y };
        const end = { x: targetCenter.x - 8 * direction, y: targetCenter.y };
        const control = {
          x: (start.x + end.x) / 2,
          y: Math.max(start.y, end.y) + Math.max(42, Math.abs(end.x - start.x) * 0.2)
        };
        const d = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${control.x.toFixed(1)} ${control.y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
        path.attr('d', d);
        d3.select(this.parentElement)
          .select<SVGPathElement>('.babel-trajectory-path-shadow')
          .attr('d', d);
      });
      g.selectAll<SVGPathElement, unknown>('.babel-trajectory-path[data-trajectory-source-attachment]')
        .each(function finalizeAcceptedTrajectoryPath() {
          const path = d3.select(this);
          const kind = path.attr('data-trajectory-kind');
          path
            .attr('class', `babel-trajectory-path babel-trajectory-path-${kind}`)
            .attr('data-trajectory-source-attachment', null)
            .attr('data-trajectory-target-attachment', null)
            .attr('data-trajectory-orthogonal-departures', null);
        });
    }

    let forestLightFrame: number | null = null;
    let forestLightCanvas: HTMLCanvasElement | null = null;
    const startIdentityForestLight = () => {
      const mount = containerRef.current;
      const svgElement = svgRef.current;
      if (!mount || !svgElement || identityForestLightFamilies.length === 0) return;

      const canvas = document.createElement('canvas');
      canvas.className = 'babel-forest-light-canvas';
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.pointerEvents = 'none';
      canvas.style.mixBlendMode = 'screen';
      canvas.style.zIndex = '2';
      canvas.style.transition = 'opacity 180ms ease';
      const context = canvas.getContext('2d');
      if (!context) return;
      mount.appendChild(canvas);
      forestLightCanvas = canvas;

      let baselineTreeScale: number | null = null;
      const clamp = (value: number, min: number, max: number) =>
        Math.max(min, Math.min(max, value));
      const drawBeam = (
        site: { x: number; y: number },
        source: { x: number; y: number },
        index: number,
        visualScale: number,
        intensity: number
      ) => {
        const dx = site.x - source.x;
        const dy = site.y - source.y;
        const length = Math.max(1, Math.hypot(dx, dy));
        const nx = -dy / length;
        const ny = dx / length;
        const gradient = context.createLinearGradient(source.x, source.y, site.x, site.y);
        gradient.addColorStop(0, 'rgba(236,253,245,0.30)');
        gradient.addColorStop(0.36, 'rgba(167,243,208,0.15)');
        gradient.addColorStop(1, 'rgba(34,197,94,0.04)');

        [82, 54, 30].forEach((width, widthIndex) => {
          const scaledWidth = width * visualScale;
          const sourceHalf = scaledWidth * 0.18;
          const targetHalf = scaledWidth * (1.05 + index * 0.08);
          context.beginPath();
          context.moveTo(source.x + nx * sourceHalf, source.y + ny * sourceHalf);
          context.lineTo(site.x + nx * targetHalf, site.y + ny * targetHalf);
          context.lineTo(site.x - nx * targetHalf, site.y - ny * targetHalf);
          context.lineTo(source.x - nx * sourceHalf, source.y - ny * sourceHalf);
          context.closePath();
          context.globalAlpha = [0.12, 0.16, 0.22][widthIndex] * intensity;
          context.fillStyle = gradient;
          context.fill();
        });
      };
      const drawDapple = (
        site: { x: number; y: number },
        index: number,
        visualScale: number,
        intensity: number
      ) => {
        context.globalAlpha = 0.22 * intensity;
        const fragments = [
          [-36, -20, 28, 10, -18, 0.30],
          [-10, -34, 18, 7, -34, 0.28],
          [24, -14, 34, 12, -22, 0.34],
          [42, 16, 20, 8, -28, 0.24],
          [-26, 20, 26, 9, -15, 0.26],
          [8, 24, 19, 7, -30, 0.22]
        ];
        fragments.forEach(([x, y, rx, ry, angle, alpha]) => {
          context.save();
          context.translate(
            site.x + (x + (index - 1) * 8) * visualScale,
            site.y + (y - index * 3) * visualScale
          );
          context.rotate((angle * Math.PI) / 180);
          const scaledRx = rx * visualScale;
          const scaledRy = ry * visualScale;
          const dappleGradient = context.createRadialGradient(0, 0, 1, 0, 0, scaledRx);
          dappleGradient.addColorStop(0, `rgba(236,253,245,${alpha})`);
          dappleGradient.addColorStop(0.55, `rgba(167,243,208,${alpha * 0.55})`);
          dappleGradient.addColorStop(1, 'rgba(16,185,129,0)');
          context.fillStyle = dappleGradient;
          context.beginPath();
          context.ellipse(0, 0, scaledRx, scaledRy, 0, 0, Math.PI * 2);
          context.fill();
          context.restore();
        });
      };

      const redraw = () => {
        if (!canvas.isConnected) return;
        const mountRect = mount.getBoundingClientRect();
        const treeGroup = svgElement.querySelector<SVGGElement>('g');
        const treeMatrix = treeGroup?.getScreenCTM();
        if (!mountRect.width || !mountRect.height || !treeMatrix) {
          forestLightFrame = window.requestAnimationFrame(redraw);
          return;
        }
        const ratio = window.devicePixelRatio || 1;
        const pixelWidth = Math.max(1, Math.ceil(mountRect.width * ratio));
        const pixelHeight = Math.max(1, Math.ceil(mountRect.height * ratio));
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
          canvas.width = pixelWidth;
          canvas.height = pixelHeight;
        }
        canvas.style.width = `${mountRect.width}px`;
        canvas.style.height = `${mountRect.height}px`;
        canvas.style.opacity = '1';
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, mountRect.width, mountRect.height);
        context.globalCompositeOperation = 'screen';

        const treeScale = Math.max(0.001, Math.hypot(treeMatrix.a, treeMatrix.b));
        if (baselineTreeScale === null) baselineTreeScale = treeScale;
        const visualScale = clamp(treeScale / baselineTreeScale, 0.82, 2.25);
        const terminalLabels = Array.from(
          svgElement.querySelectorAll('.terminal-label')
        ) as SVGGraphicsElement[];
        identityForestLightFamilies.forEach(({ occurrencePools, emphasis }, familyIndex) => {
          const intensity = emphasis === 'quiet' ? 0.3 : 1;
          const source = {
            x: mountRect.width * (0.78 - familyIndex * 0.16),
            y: Math.max(24, mountRect.height * (0.12 + familyIndex * 0.08))
          };
          occurrencePools.forEach((terminalIds, occurrenceIndex) => {
            const wanted = new Set(terminalIds);
            const centres = terminalLabels
              .filter((label) => wanted.has(label.getAttribute('data-node-id') || ''))
              .map((label) => {
                const rect = label.getBoundingClientRect();
                if (!rect.width && !rect.height) return null;
                return {
                  x: rect.left + rect.width / 2 - mountRect.left,
                  y: rect.top + rect.height / 2 - mountRect.top
                };
              })
              .filter((point): point is { x: number; y: number } => Boolean(point));
            if (centres.length === 0) return;
            const xs = centres.map((point) => point.x);
            const ys = centres.map((point) => point.y);
            const site = {
              x: (Math.min(...xs) + Math.max(...xs)) / 2,
              y: (Math.min(...ys) + Math.max(...ys)) / 2
            };
            drawBeam(site, source, occurrenceIndex, visualScale, intensity);
            drawDapple(site, occurrenceIndex, visualScale, intensity);
          });
        });
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        forestLightFrame = window.requestAnimationFrame(redraw);
      };
      redraw();
    };

    const installRelationHitTargets = () => {
      g.selectAll<SVGElement, unknown>('.vr-item').each(function installHitTargets() {
        const relationHost = this as SVGElement;
        const geometries = relationHost.matches('path, line, polyline, rect, circle, ellipse')
          ? [relationHost as SVGGeometryElement]
          : Array.from(relationHost.querySelectorAll<SVGGeometryElement>(
            'path, line, polyline, rect, circle, ellipse'
          ));
        geometries.forEach((geometry) => {
          if (geometry.classList.contains('vr-relation-hit-target')) return;
          if (geometry.hasAttribute('data-vr-hit-target-installed')) return;
          const hitTarget = geometry.cloneNode(false) as SVGGeometryElement;
          const isRelationHost = geometry === relationHost;
          const isAreaTarget = geometry.hasAttribute('data-vr-hit-area');
          const isFallbackSegment = geometry.classList.contains('vr-fallback-segment');
          geometry.setAttribute('data-vr-hit-target-installed', 'true');
          hitTarget.removeAttribute('id');
          hitTarget.removeAttribute('class');
          hitTarget.removeAttribute('style');
          hitTarget.removeAttribute('filter');
          hitTarget.removeAttribute('marker-start');
          hitTarget.removeAttribute('marker-mid');
          hitTarget.removeAttribute('marker-end');
          hitTarget.setAttribute(
            'class',
            [
              isRelationHost ? 'vr-item' : '',
              'vr-relation-hit-target',
              isAreaTarget ? 'vr-relation-area-hit-target' : '',
              isFallbackSegment ? 'vr-relation-fallback-hit-target' : ''
            ].filter(Boolean).join(' ')
          );
          if (isRelationHost) {
            ['data-vr-stage-index', 'data-vr-relation-index', 'data-vr-owner-refs', 'data-vr-emphasis']
              .forEach((attribute) => {
                const value = relationHost.getAttribute(attribute);
                if (value !== null) hitTarget.setAttribute(attribute, value);
              });
          }
          hitTarget.setAttribute('aria-hidden', 'true');
          hitTarget.setAttribute('focusable', 'false');
          hitTarget.style.setProperty('fill', isAreaTarget ? 'transparent' : 'none', 'important');
          hitTarget.style.setProperty('stroke', 'transparent', 'important');
          hitTarget.style.setProperty('stroke-width', isFallbackSegment ? '30px' : '16px', 'important');
          hitTarget.setAttribute('stroke-linecap', 'round');
          hitTarget.setAttribute('stroke-linejoin', 'round');
          hitTarget.setAttribute('vector-effect', 'non-scaling-stroke');
          hitTarget.style.setProperty('pointer-events', isAreaTarget ? 'all' : 'stroke', 'important');
          geometry.parentElement?.appendChild(hitTarget);
        });
      });
    };

    // Install immediately so a hover-triggered redraw never leaves the pointer
    // over a thin, temporarily unhittable path. Deferred relation geometry gets
    // the same treatment as soon as it is mounted on the following frame.
    installRelationHitTargets();
    let openingAnimation: Animation | undefined;
    if (animated && usesDerivationFrames && activeStepIndex === 0
      && playbackSteps[0]?.operation === 'LexicalSelect') {
      if (openingSelectionRef.current?.steps !== playbackSteps) {
        openingSelectionRef.current = { steps: playbackSteps, startedAt: performance.now() };
      }
      // Font and viewport redraws continue the same reveal instead of
      // restarting it. Only opacity changes; fitting keeps its normal bounds.
      const elapsed = performance.now() - openingSelectionRef.current.startedAt;
      if (elapsed < 260 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        openingAnimation = g.node()?.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 260, delay: -elapsed, easing: 'ease'
        });
      }
    } else {
      openingSelectionRef.current = null;
    }
    const deferredRelationFrame = window.requestAnimationFrame(() => {
      deferredAcceptedRelationDraws.forEach((draw) => draw());
      installRelationHitTargets();
      startIdentityForestLight();
      svg.attr('data-babel-rendered-step', activeStepIndex);
    });
    return () => {
      openingAnimation?.cancel();
      window.cancelAnimationFrame(deferredRelationFrame);
      if (forestLightFrame !== null) window.cancelAnimationFrame(forestLightFrame);
      forestLightCanvas?.remove();
    };
  }, [
    zoomBehavior,
    activeDerivationFrame,
    activeDerivationFrameIndex,
    activeDerivationArrowLinks,
    activeDerivationRelationLinks,
    activeStepIndex,
    canvasData,
    currentReplayUsesFutureLayoutScaffold,
    stageCameraBounds,
    stagePlaqueContainmentBounds,
    stagePlaqueLayout,
    stageLayoutSize,
    acceptedCompositionIsTreeFirst,
    dimensions,
    fontLayoutPass,
    fitRevision,
    uiBounds,
    animated,
    abstractionMode,
    derivationFramesSignature,
    disableRelationOverlay,
    focusedRelationMoment?.stageIndex,
    focusedRelationMoment?.relationIndex,
    movementProtectedNodeIds,
    replayVisibleNodeIdSet,
    traceDisplayFrame,
    traceDisplayFrameIndex,
    traceDisplayRelationLinks,
    traceDisplayIndexByNodeId,
    usesDerivationFrames,
    relationRenderPlan
  ]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const focusKey = activeRelationMoment
      ? `${activeRelationMoment.stageIndex}:${activeRelationMoment.relationIndex}`
      : '';
    const ownerKey = (element: SVGElement) => (
      element.getAttribute('data-vr-owner-refs')?.trim()
      || `${element.getAttribute('data-vr-stage-index')}:${element.getAttribute('data-vr-relation-index')}`
    );
    const hoverKey = hoveredRelationMoment
      ? `${hoveredRelationMoment.stageIndex}:${hoveredRelationMoment.relationIndex}` : '';
    const ownsMoment = (element: SVGElement, momentKey: string) => {
      if (!momentKey) return false;
      const ownerRefs = element.getAttribute('data-vr-owner-refs')
        ?.split(/\s+/u)
        .filter(Boolean) || [];
      return ownerRefs.length > 0
        ? ownerRefs.includes(momentKey)
        : ownerKey(element) === momentKey;
    };
    const applyInteractiveEmphasis = () => {
      const relationElements = Array.from(svg.querySelectorAll(
        '.vr-item[data-vr-stage-index][data-vr-relation-index]'
      )) as SVGElement[];
      relationElements.forEach((element) => {
        const ancestor = element.parentElement?.closest<SVGElement>(
          '.vr-item[data-vr-stage-index][data-vr-relation-index]'
        );
        const isVisualRoot = !ancestor || ownerKey(ancestor) !== ownerKey(element);
        const active = ownsMoment(element, focusKey);
        const quiet = Boolean(focusKey) && !active;
        element.setAttribute('data-vr-emphasis', active ? 'active' : quiet ? 'quiet' : 'none');
        element.classList.toggle('vr-relation-active', isVisualRoot && active);
        element.classList.toggle('vr-relation-quiet', isVisualRoot && quiet);
        // Hover changes ink and halo only; the relation moment owns opacity.
        element.classList.toggle('vr-relation-hovered', isVisualRoot && ownsMoment(element, hoverKey));
      });
    };
    applyInteractiveEmphasis();
    const deferredEmphasisFrame = window.requestAnimationFrame(applyInteractiveEmphasis);
    return () => window.cancelAnimationFrame(deferredEmphasisFrame);
  }, [
    activeRelationMoment?.stageIndex,
    activeRelationMoment?.relationIndex,
    hoveredRelationMoment?.stageIndex,
    hoveredRelationMoment?.relationIndex
  ]);

  const activeStepRaw = currentReplayStep;
  const activeStep = activeStepRaw;
  const activePanelContent = buildReplayPanelContent(activeStep, derivationStages);
  const activeReplaySupportLines = activePanelContent.supportLines;
  const replayDisplayDetailBlocksByStepIndex = useMemo(
    () => buildReplayDisplayDetailBlocks(playbackSteps),
    [playbackSteps]
  );
  const activeDisplayDetailBlocks = (
    replayDisplayDetailBlocksByStepIndex.get(activeStepIndex) || []
  ).filter((block) => !(
    activeReplaySupportLines.length > 0
    && String(block.title || '').trim().toLowerCase() === 'relations'
  ));
  const activeNoteDisplay = (() => {
    const note = String(activeStep?.note ?? '');
    if (!note.trim()) return '';
    if (note === activePanelContent.heading
      || activeReplaySupportLines.some(line => line.value === note)
      || activeDisplayDetailBlocks.some(block => block.lines.some(line =>
        formatReplayBlockLine(block.title, line, playbackSteps) === note))) return '';
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
  const canStepBackward = animated && playbackSteps.length > 0 && activeStepIndex > 0;
  const canStepForward = animated && playbackSteps.length > 0 && activeStepIndex < playbackSteps.length - 1;
  const activeDerivationStepLabel = String(activeStep?.stepId || '');
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

  const focusRelationAtPointerTarget = (
    target: EventTarget | null,
    clientX: number,
    clientY: number
  ) => {
    const svg = svgRef.current;
    relationPointerPositionRef.current = { x: clientX, y: clientY };
    const element = target instanceof Element ? target : null;
    const relationHost = element?.closest<SVGGElement>(
      '.vr-item[data-vr-stage-index][data-vr-relation-index]'
    );
    if (!svg || !relationHost || !svg.contains(relationHost)) {
      if (relationHoverResolutionFrameRef.current !== null) {
        window.cancelAnimationFrame(relationHoverResolutionFrameRef.current);
      }
      relationHoverResolutionFrameRef.current = window.requestAnimationFrame(() => {
        relationHoverResolutionFrameRef.current = null;
        const pointer = relationPointerPositionRef.current;
        const postRedrawTarget = pointer
          ? document.elementFromPoint(pointer.x, pointer.y)
          : null;
        const postRedrawRelationHost = postRedrawTarget?.closest<SVGGElement>(
          '.vr-item[data-vr-stage-index][data-vr-relation-index]'
        );
        if (!postRedrawRelationHost || !svg?.contains(postRedrawRelationHost)) {
          setHoveredRelationMoment((current) => current === null ? current : null);
          return;
        }
        const postRedrawStageIndex = Number(postRedrawRelationHost.dataset.vrStageIndex);
        const postRedrawRelationIndex = Number(postRedrawRelationHost.dataset.vrRelationIndex);
        if (!Number.isInteger(postRedrawStageIndex) || !Number.isInteger(postRedrawRelationIndex)) return;
        setHoveredRelationMoment((current) => (
          current?.stageIndex === postRedrawStageIndex
          && current.relationIndex === postRedrawRelationIndex
            ? current
            : { stageIndex: postRedrawStageIndex, relationIndex: postRedrawRelationIndex }
        ));
      });
      return;
    }
    if (relationHoverResolutionFrameRef.current !== null) {
      window.cancelAnimationFrame(relationHoverResolutionFrameRef.current);
      relationHoverResolutionFrameRef.current = null;
    }
    const stageIndex = Number(relationHost.dataset.vrStageIndex);
    const relationIndex = Number(relationHost.dataset.vrRelationIndex);
    if (!Number.isInteger(stageIndex) || !Number.isInteger(relationIndex)) return;
    setHoveredRelationMoment((current) => (
      current?.stageIndex === stageIndex && current.relationIndex === relationIndex
        ? current
        : { stageIndex, relationIndex }
    ));
  };

  return (
    <div
      ref={containerRef}
      tabIndex={animated ? 0 : undefined}
      onKeyDown={(event) => {
        if (!animated || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.target instanceof HTMLElement && event.target.closest('input, button, select, textarea, [contenteditable="true"]')) return;
        if (event.key === 'ArrowLeft' && canStepBackward) {
          event.preventDefault();
          handlePrevStep();
        } else if (event.key === 'ArrowRight' && canStepForward) {
          event.preventDefault();
          handleNextStep();
        }
      }}
      onPointerMove={(event) => {
        if (event.pointerType === 'touch' || event.buttons !== 0) return;
        focusRelationAtPointerTarget(event.target, event.clientX, event.clientY);
      }}
      onPointerLeave={(event) => {
        focusRelationAtPointerTarget(null, event.clientX, event.clientY);
      }}
      onMouseMove={(event) => {
        if (event.buttons !== 0) return;
        focusRelationAtPointerTarget(event.target, event.clientX, event.clientY);
      }}
      onMouseLeave={(event) => {
        focusRelationAtPointerTarget(null, event.clientX, event.clientY);
      }}
      className="w-full h-full overflow-hidden border-2 border-white/5 rounded-[3rem] tree-canvas-bg shadow-2xl relative focus:outline-none"
    >
      <div
        ref={replayHeaderRef}
        data-babel-replay-header="true"
        className="babel-replay-header absolute pointer-events-none z-10 opacity-75 select-none"
        style={{ top: Math.max(24, uiBounds.top), right: uiBounds.right }}
      >
        <div className="text-[10px] font-black text-emerald-500 uppercase tracking-[0.6em] flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${abstractionMode ? 'bg-amber-500 shadow-[0_0_15px_#f59e0b]' : 'bg-emerald-500 shadow-[0_0_15px_#10b981]'}`}></div>
          {abstractionMode ? 'CONSTITUENT GLYPHING ACTIVE' : (animated ? 'DERIVATION SEQUENCE ACTIVE' : 'ARBORETUM CANOPY')}
        </div>
        {animated && playbackSteps.length > 0 && (
          <div className="mt-2 text-[9px] font-black text-emerald-500/80 uppercase tracking-[0.35em]">
            Replay Frame {activeStepIndex + 1}/{playbackSteps.length}
            {activeStageDisplayLabel ? ` \u00b7 ${activeStageDisplayLabel}` : ''}
          </div>
        )}
      </div>
      {animated && playbackSteps.length > 0 && (
        <div
          ref={replayPanelRef}
          data-babel-replay-panel="true"
          data-babel-replay-kind={currentReplayKind || undefined}
          data-babel-active-relation-stage-index={activeRelationMoment?.stageIndex}
          data-babel-active-relation-index={activeRelationMoment?.relationIndex}
          data-babel-played-relation-indices={playedRelationIndicesAttribute}
          className="babel-replay-panel absolute z-40 flex flex-col overflow-hidden rounded-2xl border border-[#17362d] bg-[#020806]/[0.96] p-4 shadow-2xl"
          style={{ bottom: uiBounds.bottom, right: uiBounds.right }}
        >
          <div className="babel-replay-controls flex items-center gap-2 mb-3">
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
            <button type="button" title="Fit tree" aria-label="Fit tree"
              className="shrink-0 rounded-lg border border-white/10 p-1.5 text-white/70 hover:text-emerald-300"
              onClick={() => { manualCameraRef.current = null; setFitRevision(value => value + 1); }}>
              <Scan size={14} />
            </button>
            <div className="ml-auto text-right">
              <div className="text-[10px] font-black tracking-[0.14em] text-emerald-400/80">
                Replay {activeStepIndex + 1}/{playbackSteps.length}
                {activeStageDisplayLabel ? ` \u00b7 ${activeStageDisplayLabel}` : ''}
              </div>
            </div>
          </div>
          <div data-babel-replay-timeline="true" className="relative h-8 shrink-0">
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-2 bg-black/50 rounded-full border border-white/5" />
            <div
              className={`absolute left-0 top-1/2 -translate-y-1/2 h-2 bg-[#064e3b] rounded-full ${isScrubbing ? '' : 'transition-all duration-150'}`}
              style={{ width: `${stepPercent}%` }}
            />
            <input
              type="range"
              aria-label="Replay frame"
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
          <div
            data-babel-replay-details="true"
            className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1 space-y-3"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {activeStep?.replayKind && activeStep.replayKind !== 'macro' && (
                <span className="text-[10px] uppercase tracking-[0.16em] text-emerald-300/90">
                  {activeStep.replayKind === 'micro' ? 'Construction' : 'Relation'}
                </span>
              )}
              <div data-babel-replay-summary="true" className="text-[11px] text-white font-semibold">
                {activePanelContent.heading}
              </div>
            </div>
            {activeReplaySupportLines.length > 0 && (
              <div className="space-y-1 text-[10px] tracking-[0.12em] text-emerald-300/90">
                {activeReplaySupportLines.map((line) => (
                  <div key={line.key} className="leading-relaxed"
                    aria-label={line.literal !== undefined ? `${line.label}: ${line.value}; value: ${line.literal}` : undefined}>
                    {line.label && <span>{line.label}:</span>}
                    <span className={`${line.label ? 'ml-2 ' : ''}text-[11px] tracking-normal text-white/92 whitespace-pre-wrap`}>
                      {line.value}
                      {line.literal !== undefined && line.literal !== line.value && (
                        <> · {line.literal === '' ? '""' : line.literal}</>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {activeDisplayDetailBlocks.length > 0 && (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3">
                {activeDisplayDetailBlocks.map((block, blockIndex) => (
                  <div key={`${block.title}-${blockIndex}`}>
                    {!(activeStep?.replayKind === 'macro' && block.title === 'Stage Record') && (
                      <div className="text-[10px] uppercase tracking-[0.16em] text-emerald-300/90 mb-2">
                        {formatReplayBlockTitle(block.title)}
                      </div>
                    )}
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
      <svg
        ref={svgRef}
        data-babel-tree="true"
        data-babel-hovered-relation-stage-index={hoveredRelationMoment?.stageIndex}
        data-babel-hovered-relation-index={hoveredRelationMoment?.relationIndex}
        className="cursor-grab active:cursor-grabbing w-full h-full block"
      />
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
export { __TEST_ONLY__ } from '../replay/replayCompiler.ts';
