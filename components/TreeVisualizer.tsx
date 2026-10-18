import * as d3 from 'd3';
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_FONT } from '../replay/categoryTextLayout.ts';
import { initialReplayStepIndex, replayStartState } from '../replay/initialReplayStep.ts';
import { buildResolvedLinkTraceIndexMap } from '../replay/movementIndices.ts';
import { isPhrasalReplayMovement } from '../replay/movementLinks.ts';
import { STEP_DELAY_MS } from '../replay/playbackFormatting.ts';
import { prepareReplay, type PreparedReplay } from '../replay/prepareReplay.ts';
import { prepareTreeLabelRuns } from '../replay/prepareTreeLabelRuns.ts';
import type { PlaqueTextMeasure } from '../replay/relations/plaqueTextLayout.ts';
import {
  DERIVATION_WORKSPACE_ROOT_LABEL,
  buildRenderableCommittedCanvasData,
  buildRenderableDerivationCanvasData
} from '../replay/replayCanvas.ts';
import {
  buildStageCameraBounds,
  buildStageLayoutGroups,
  selectReplayPlaqueLayout,
  stageTreeLayoutSize
} from '../replay/stageCamera.ts';
import { buildMovementProtectedNodeIds } from '../replay/triangulation.ts';
import { caseSurfaceInitial, resolveSavedInputTokens } from '../server/babelParser/surfaceTokens.js';
import { type DerivationStage, type SyntaxNode } from '../types';
import { withPlaqueTextMeasure } from './renderer/plaqueText.ts';
import { applyRelationEmphasis } from './renderer/relationInteraction.ts';
import { updateSyntaxReveal } from './renderer/syntaxReveal.ts';
import { drawTreeFrame } from './renderer/treeFrame.ts';
import ReplayPanel from './ReplayPanel';
import { createTreeInkTextMeasure } from './treeInkTextMeasure';
import { createTreeLabelMeasure } from './treeLabelMeasure.ts';
import { createViewportSettler } from './treeViewport.ts';
import { createMeasuredRuns, watchTreeVisualizerFonts } from './treeVisualizerFonts';
import { useReplayPlaqueLayout } from './useReplayPlaqueLayout';
import { useTreeDirection } from './useTreeDirection';
import { useViewErrorHandler } from './ViewErrorBoundary';
import { guardViewCallback } from './viewErrorHandling.ts';

import type { AutoCameraState, TreeCameraState } from './renderer/cameraState.ts';

export type { TreeCameraState } from './renderer/cameraState.ts';

export interface TreeVisualizerProps {
  preparedReplay?: PreparedReplay;
  manualCameraState?: React.RefObject<TreeCameraState | null>;
  data: SyntaxNode;
  animated?: boolean;
  /** Reviewers can choose the first frame before starting playback. */
  autoPlay?: boolean;
  /** Open a demonstration at one authored relation; ordinary Replay starts at frame one. */
  initialReplayMoment?: { stageIndex: number; relationIndex: number };
  /** Restore a saved position against the current compiled Replay length. */
  initialReplayStep?: number;
  onReplayStepChange?: (step: number) => void;
  derivationStages?: DerivationStage[];
  abstractionMode?: boolean;
  sentence?: string;
  inputTokens?: string[];
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
  autoPlay = true,
  initialReplayMoment,
  initialReplayStep,
  onReplayStepChange,
  derivationStages,
  abstractionMode = false,
  sentence = '',
  inputTokens,
  disableRelationOverlay = false,
  preparedReplay,
  manualCameraState
}) => {
  const reportViewError = useViewErrorHandler();
  const treeDirection = useTreeDirection(sentence);
  const svgRef = useRef<SVGSVGElement>(null);
  // An active D3 gesture must dispatch to the current frame's handler after a redraw.
  const zoomBehavior = useMemo(() => d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.05, 10]), []);
  const containerRef = useRef<HTMLDivElement>(null);
  const replayHeaderRef = useRef<HTMLDivElement>(null);
  const replayPanelRef = useRef<HTMLDivElement>(null);
  const [uiBounds, setUiBounds] = useState({ top: 0, right: 16, bottom: 16, headerBottom: 0, panelTop: Infinity });
  const ownManualCameraRef = useRef<TreeCameraState | null>(null);
  const manualCameraRef = manualCameraState ?? ownManualCameraRef;
  const autoCameraRef = useRef<AutoCameraState | null>(null);
  const cameraAnimationRef = useRef<{ stepIndex: number; endsAt: number } | null>(null);
  const relationPointerPositionRef = useRef<{ x: number; y: number } | null>(null);
  const relationHoverResolutionFrameRef = useRef<number | null>(null);
  const applyRelationEmphasisRef = useRef<(() => void) | null>(null);
  const terminalMorphRef = useRef<Map<string, { preText: string; postText: string; step: number; hideBefore: boolean }>>(new Map());
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  // A resize after the first painted frame settles before it is committed; the
  // painted tree keeps its frame until then. See createViewportSettler.
  const framePaintedRef = useRef(false);
  const viewportSettlerRef = useRef<ReturnType<typeof createViewportSettler> | null>(null);
  const measureUiBoundsRef = useRef<(() => void) | null>(null);
  const [fontLayoutPass, setFontLayoutPass] = useState(0);
  const fontText = useMemo(() => [...new Set(JSON.stringify([data, derivationStages, sentence]))].sort().join(''),
    [data, derivationStages, sentence]);
  const [settledFontText, setSettledFontText] = useState<string | null>(null);
  const trajectoryLabelMaskId = `trajectory-labels-${useId().replace(/:/g, '')}`;
  // Each font pass records the runs its measures are called with; a later face
  // load re-measures them to decide whether layout must be measured again.
  const measuredRuns = useMemo(() => createMeasuredRuns(), [fontLayoutPass]);
  const latestMeasuredRuns = useRef(measuredRuns);
  latestMeasuredRuns.current = measuredRuns;
  const measureCategoryText = useMemo(() => measuredRuns.track('category', () => {
    const context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    if (context) context.font = CATEGORY_FONT;
    const cache = new Map<string, number>();
    return (text: string) => {
      if (!cache.has(text)) cache.set(text, context?.measureText(text).width ?? [...text].length * 25);
      return cache.get(text)!;
    };
  }), [measuredRuns]);
  const measureTreeInk = useMemo(() => measuredRuns.track('ink', () => createTreeInkTextMeasure(
    typeof document === 'undefined' ? undefined : document)), [measuredRuns]);
  const measureTreeLabel = useMemo(() => measuredRuns.track('label', () => createTreeLabelMeasure(
    typeof document === 'undefined' ? undefined : document)), [measuredRuns]);
  // Measured in untransformed SVG units, so a resize keeps the same measure.
  const measurePlaqueText = useMemo<PlaqueTextMeasure>(() => measuredRuns.track('plaque', () => {
    const measured = new Map<string, ReturnType<PlaqueTextMeasure>>();
    return (text: string, style: Parameters<PlaqueTextMeasure>[1]) => {
      const key = JSON.stringify([text, style]);
      if (!measured.has(key)) measured.set(key,
        withPlaqueTextMeasure(d3.select(svgRef.current!), measure => measure(text, style)));
      return measured.get(key)!;
    };
  }), [measuredRuns]);
  const [fitRevision, setFitRevision] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [hoveredRelationMoment, setHoveredRelationMoment] = useState<RelationMoment | null>(null);
  useEffect(() => watchTreeVisualizerFonts(document.fonts, () => {
    setSettledFontText(fontText);
    setFontLayoutPass(pass => pass + 1);
  }, fontText, () => latestMeasuredRuns.current.changed()), [fontText]);
  const { replayDerivationFrames, derivationReplayPlan, relationRenderPlan, committedDerivationVisualLinks,
    movementChainIndexCatalogue, playbackSteps } = useMemo(
      () => preparedReplay ?? prepareReplay({ derivationStages, sentence, inputTokens, includePlayback: animated }),
      [preparedReplay, derivationStages, sentence, inputTokens, animated]
    );
  const treeLabelRuns = useMemo(() => settledFontText === fontText ? prepareTreeLabelRuns({
    replayDerivationFrames, derivationReplayPlan, relationRenderPlan, committedDerivationVisualLinks,
    movementChainIndexCatalogue, playbackSteps
  }, measureCategoryText, { includeRelationIndices: !disableRelationOverlay }) : undefined,
    [playbackSteps, replayDerivationFrames, derivationReplayPlan, relationRenderPlan, committedDerivationVisualLinks,
      movementChainIndexCatalogue, measureCategoryText, disableRelationOverlay, settledFontText, fontText]);
  const initialStepIndex = initialReplayStepIndex(playbackSteps, initialReplayMoment, initialReplayStep);
  const [activeStepIndex, setActiveStepIndex] = useState(initialStepIndex);
  const openingSelectionRef = useRef<{ steps: typeof playbackSteps; startedAt: number } | null>(null);
  const collectionRevealRef = useRef<{ steps: typeof playbackSteps; stepIndex: number; startedAt: number } | null>(null);
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
      committedDerivationFrame.workspaceForest || []
    );
  }, [committedDerivationFrame, committedDerivationVisualLinks, usesDerivationFrames]);
  const committedCanonicalDerivationCanvasData = useMemo(() => {
    if (!usesDerivationFrames) return null;
    return buildRenderableCommittedCanvasData(
      data
    );
  }, [data, committedDerivationVisualLinks, usesDerivationFrames]);
  const firstSentenceReplayToken = useMemo(
    () => String(resolveSavedInputTokens(sentence, inputTokens)[0] || '').trim(),
    [sentence, inputTokens]
  );
  const firstSentenceReplayDisplayToken = useMemo(
    () => firstSentenceReplayToken
      ? caseSurfaceInitial(firstSentenceReplayToken, 'upper')
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
        if (!isPhrasalReplayMovement(link)) return;
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
  const currentReplayKind = String(currentReplayStep?.replayKind || '').trim();
  const currentReplayRelationIdentity = currentReplayKind === 'relation'
    ? currentReplayStep?.replayRelationIdentity
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
      if (stepIndex > currentStepIndex || step.replayKind !== 'relation') return played;
      const identity = step.replayRelationIdentity;
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
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const target = window as typeof window & {
      __BABEL_DEV_SET_REPLAY_STEP__?: (nextStep: number) => void;
      __BABEL_DEV_GET_REPLAY_STEP_COUNT__?: () => number;
      __BABEL_DEV_GET_REPLAY_STEP_PAYLOAD__?: (index: number) => typeof currentReplayStep;
    };
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
    return buildRenderableCommittedCanvasData(data);
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
  const layoutContent = useMemo(() => committedDerivationCanvasData && settledFontText === fontText ? {
    steps: playbackSteps, stageIndex: 0, completedCanvas: committedDerivationCanvasData,
    plan: disableRelationOverlay ? null : relationRenderPlan, direction: treeDirection, abstractionMode, protectedNodeIds: movementProtectedNodeIds,
    layoutGroups: stageLayoutGroups, measurePlaqueText, measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel
  } : null, [committedDerivationCanvasData, playbackSteps, relationRenderPlan, abstractionMode, movementProtectedNodeIds,
    disableRelationOverlay, stageLayoutGroups, measurePlaqueText, treeDirection, settledFontText, fontText, treeLabelRuns, measureTreeLabel]);
  const viewport = useMemo(() => ({ ...dimensions, bounds: uiBounds }), [dimensions, uiBounds]);
  // The frame is drawn for the displayed viewport, which stays the earlier one
  // while a resize prepares a new layout.
  const { viewport: frameViewport, schedule: replayPlaqueSchedule, coordinates: replayCoordinates, ready: plaqueLayoutReady,
    error: plaqueLayoutError, retry: retryPlaqueLayout } = useReplayPlaqueLayout(layoutContent, viewport, activeDerivationFrameIndex);
  const stageLayoutSize = useMemo(() => (
    animated && usesDerivationFrames && frameViewport
      ? stageTreeLayoutSize(playbackSteps, activeDerivationFrameIndex, frameViewport.width, frameViewport.height, stageLayoutGroups)
      : null
  ), [animated, usesDerivationFrames, playbackSteps, activeDerivationFrameIndex, frameViewport, stageLayoutGroups]);
  const missingReplayCoordinates = Boolean(layoutContent && plaqueLayoutReady && usesDerivationFrames
    && !replayCoordinates?.get(activeDerivationFrameIndex)?.has(canvasData));
  const layoutReady = settledFontText === fontText && dimensions.width > 0 && plaqueLayoutReady && !missingReplayCoordinates;
  const stagePlaqueLayout = useMemo(() => selectReplayPlaqueLayout(replayPlaqueSchedule, activeDerivationFrameIndex),
    [replayPlaqueSchedule, activeDerivationFrameIndex]);
  const activePlaqueLayout = useMemo(() => selectReplayPlaqueLayout(replayPlaqueSchedule, activeDerivationFrameIndex,
    currentStepIndex >= 0 ? currentStepIndex : undefined), [replayPlaqueSchedule, activeDerivationFrameIndex, currentStepIndex]);
  const completedReplayStep = currentStepIndex === playbackSteps.length - 1
    && playbackSteps[currentStepIndex]?.replayKind === 'macro' ? currentStepIndex : undefined;
  const stageCameraBounds = useMemo(() => {
    if (!layoutReady || !animated || !usesDerivationFrames || !activeDerivationFrame || !frameViewport?.width) return null;
    return buildStageCameraBounds({
      steps: playbackSteps, stageIndex: activeDerivationFrameIndex,
      stepIndex: completedReplayStep,
      completedCanvas: buildRenderableDerivationCanvasData(activeDerivationFrame.workspaceForest || []),
      plan: relationRenderPlan, width: frameViewport.width, height: frameViewport.height, direction: treeDirection, abstractionMode, protectedNodeIds: movementProtectedNodeIds,
      includeOverlays: !disableRelationOverlay && !acceptedCompositionIsTreeFirst,
      plaqueLayout: stagePlaqueLayout, plaqueSchedule: replayPlaqueSchedule, coordinates: replayCoordinates, layoutGroups: stageLayoutGroups, measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel
    });
  }, [layoutReady, animated, usesDerivationFrames, activeDerivationFrame, activeDerivationFrameIndex, completedReplayStep,
    playbackSteps, relationRenderPlan, frameViewport, abstractionMode,
    movementProtectedNodeIds, disableRelationOverlay, acceptedCompositionIsTreeFirst, stagePlaqueLayout, replayPlaqueSchedule, replayCoordinates, stageLayoutGroups, measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel, treeDirection]);
  const stagePlaqueContainmentBounds = useMemo(() => {
    const hasBindingDomain = relationRenderPlan?.frames[activeDerivationFrameIndex]?.items.some(item => item.kind === 'binding-domain');
    if (!stageCameraBounds || !activeDerivationFrame || !frameViewport || disableRelationOverlay
      || (!acceptedCompositionIsTreeFirst && !hasBindingDomain)) return null;
    return buildStageCameraBounds({
      steps: playbackSteps, stageIndex: activeDerivationFrameIndex,
      stepIndex: completedReplayStep,
      completedCanvas: buildRenderableDerivationCanvasData(activeDerivationFrame.workspaceForest || []),
      plan: relationRenderPlan, width: frameViewport.width, height: frameViewport.height, direction: treeDirection, abstractionMode, protectedNodeIds: movementProtectedNodeIds,
      includeOverlays: false, includePlaques: true, includeBindingDomains: true,
      plaqueLayout: stagePlaqueLayout, plaqueSchedule: replayPlaqueSchedule, coordinates: replayCoordinates, layoutGroups: stageLayoutGroups, measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel
    });
  }, [stageCameraBounds, activeDerivationFrame, disableRelationOverlay, acceptedCompositionIsTreeFirst, completedReplayStep,
    playbackSteps, activeDerivationFrameIndex, relationRenderPlan, frameViewport, abstractionMode,
    movementProtectedNodeIds, stagePlaqueLayout, replayPlaqueSchedule, replayCoordinates, stageLayoutGroups, measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel, treeDirection]);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const controls = Array.from<HTMLElement>(container.closest('[data-babel-workspace]')?.querySelectorAll<HTMLElement>('[data-babel-tree-controls]') || []);
    const measure = guardViewCallback(() => {
      const canvas = container.getBoundingClientRect();
      // Obstacles of a resizing canvas commit together with its settled size.
      // Either observer may report first, so compare the canvas itself too.
      const settler = viewportSettlerRef.current, settled = settler?.committed;
      if (framePaintedRef.current && (settler?.pending || !settled
        || Math.abs(container.clientWidth - settled.width) >= 1 || Math.abs(container.clientHeight - settled.height) >= 1)) return;
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
    }, reportViewError);
    const observer = new ResizeObserver(measure);
    [container, replayHeaderRef.current, replayPanelRef.current, ...controls].forEach(element => { if (element) observer.observe(element); });
    controls.forEach(element => element.addEventListener('transitionend', measure));
    measureUiBoundsRef.current = measure;
    measure();
    return () => {
      observer.disconnect();
      controls.forEach(element => element.removeEventListener('transitionend', measure));
    };
  });
  useEffect(() => {
    if (!containerRef.current) return;
    const observeTarget = containerRef.current;
    const settler = createViewportSettler({
      painted: () => framePaintedRef.current,
      schedule: (callback, delay) => window.setTimeout(guardViewCallback(callback, reportViewError), delay),
      cancel: id => window.clearTimeout(id),
      apply: (size) => {
        // A new object refits even when a burst returned to the committed size.
        setDimensions({ ...size });
        measureUiBoundsRef.current?.();
      }
    });
    viewportSettlerRef.current = settler;
    const resizeObserver = new ResizeObserver(guardViewCallback((entries: ResizeObserverEntry[]) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) settler.observe({ width, height });
      }
      // Capture readiness must not accept the pre-resize frame. The draw that
      // paints the settled viewport removes this marker.
      if (settler.pending) svgRef.current?.setAttribute('data-babel-viewport-pending', 'true');
    }, reportViewError));
    resizeObserver.observe(observeTarget);
    return () => {
      resizeObserver.unobserve(observeTarget);
      settler.dispose();
      viewportSettlerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const start = replayStartState({ animated, autoPlay, stepCount: playbackSteps.length, initialStepIndex });
    setActiveStepIndex(start.stepIndex);
    setIsAutoPlaying(start.isPlaying);
  }, [animated, autoPlay, initialStepIndex, playbackSteps, data, derivationFramesSignature]);

  useEffect(() => {
    setHoveredRelationMoment(null);
  }, [activeStepIndex]);

  useEffect(() => {
    if (animated && playbackSteps.length > 0) onReplayStepChange?.(activeStepIndex);
  }, [animated, playbackSteps, activeStepIndex, onReplayStepChange]);

  useEffect(() => () => {
    if (relationHoverResolutionFrameRef.current !== null) {
      window.cancelAnimationFrame(relationHoverResolutionFrameRef.current);
    }
  }, []);

  useEffect(() => {
    if (!layoutReady || !animated || !isAutoPlaying || isScrubbing || playbackSteps.length === 0) {
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
  }, [layoutReady, activeStepIndex, animated, isAutoPlaying, isScrubbing, playbackSteps]);

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

  // Reveal rewrites terminal text on the painted SVG before the passive redraw,
  // removing indices the previous frame's deferred drawing added. A viewport
  // change does not alter reveal state, so it must not run this on the old frame.
  useLayoutEffect(() => {
    if (!svgRef.current) return;
    if (!layoutReady) {
      d3.select(svgRef.current).attr('data-babel-rendered-step', null);
      return;
    }
    updateSyntaxReveal({
      animated,
      activeStepIndex,
      usesDerivationFrames,
      svgRef,
      traceDisplayIndexByNodeId,
      traceDisplayFrame,
      traceDisplayRelationLinks,
      traceDisplayFrameIndex,
      canvasData,
      replayVisibleNodeIdSet,
      currentReplayStep,
      firstSentenceReplayToken,
      activeDerivationArrowLinks,
      pendingPhraseFrontingSourceNodeIds,
      firstSentenceReplayDisplayToken,
      terminalMorphRef
    });
  }, [
    activeDerivationArrowLinks,
    layoutReady,
    activeDerivationFrame,
    activeDerivationFrameIndex,
    activeDerivationRelationLinks,
    activeStepIndex,
    animated,
    canvasData,
    data,
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
    if (!layoutReady || !canvasData || !svgRef.current || !frameViewport?.width) return;

    const disposeFrame = drawTreeFrame({
      layout: {
        dimensions: frameViewport,
        canvasData,
        abstractionMode,
        movementProtectedNodeIds,
        stageLayoutSize,
        replayCoordinates,
        treeDirection,
        activePlaqueLayout,
        uiBounds: frameViewport.bounds,
        stageCameraBounds,
        stagePlaqueContainmentBounds
      }, replay: {
        activeStepIndex,
        animated,
        usesDerivationFrames,
        activeDerivationFrameIndex,
        replayVisibleNodeIdSet,
        activeDerivationFrame,
        currentReplayUsesFutureLayoutScaffold,
        playbackSteps,
        traceDisplayIndexByNodeId,
        traceDisplayFrame,
        traceDisplayRelationLinks,
        traceDisplayFrameIndex,
        activeDerivationArrowLinks,
        firstSentenceReplayToken,
        firstSentenceReplayDisplayToken,
        terminalMorphRef,
        measureCategoryText,
        measureTreeInk,
        currentReplayStep,
        pendingPhraseFrontingSourceNodeIds,
        hasDerivationFrames,
        completedReplayStep
      }, relations: {
        disableRelationOverlay,
        relationRenderPlan,
        playedRelationIndices,
        activeRelationMoment,
        acceptedCompositionIsTreeFirst,
        focusedRelationMoment
      }, camera: { zoomBehavior, cameraAnimationRef, manualCameraRef, data, derivationStagesSignature, autoCameraRef, fitRevision }, lifecycle: {
        svgRef,
        containerRef,
        reportViewError,
        openingSelectionRef,
        trajectoryLabelMaskId,
        applyRelationEmphasisRef,
        collectionRevealRef
      }
    });
    framePaintedRef.current = true;
    // A frame held for an earlier viewport keeps the marker until its replacement is drawn.
    if (frameViewport.width === dimensions.width && frameViewport.height === dimensions.height
      && !viewportSettlerRef.current?.pending) svgRef.current.removeAttribute('data-babel-viewport-pending');
    return disposeFrame;
  }, [
    layoutReady,
    replayCoordinates,
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
    activePlaqueLayout,
    stageLayoutSize,
    treeDirection,
    acceptedCompositionIsTreeFirst,
    frameViewport,
    fontLayoutPass,
    treeLabelRuns,
    measureTreeLabel,
    fitRevision,
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
    const applyInteractiveEmphasis = () => applyRelationEmphasis(svg, activeRelationMoment, hoveredRelationMoment);
    applyRelationEmphasisRef.current = applyInteractiveEmphasis;
    applyInteractiveEmphasis();
    const deferredEmphasisFrame = window.requestAnimationFrame(guardViewCallback(applyInteractiveEmphasis, reportViewError));
    return () => window.cancelAnimationFrame(deferredEmphasisFrame);
  }, [
    activeRelationMoment?.stageIndex,
    activeRelationMoment?.relationIndex,
    hoveredRelationMoment?.stageIndex,
    hoveredRelationMoment?.relationIndex
  ]);

  const canStepBackward = animated && playbackSteps.length > 0 && activeStepIndex > 0;
  const canStepForward = animated && playbackSteps.length > 0 && activeStepIndex < playbackSteps.length - 1;
  const activeDerivationStepLabel = String(currentReplayStep?.stepId || '');
  const activeReplayProgressLabel = String(currentReplayStep?.replayProgressLabel || '').trim();
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

  const focusRelationAtPointerTarget = guardViewCallback((
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
      relationHoverResolutionFrameRef.current = window.requestAnimationFrame(guardViewCallback(() => {
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
      }, reportViewError));
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
  }, reportViewError);

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
        <ReplayPanel
          panelRef={replayPanelRef}
          bottom={uiBounds.bottom}
          right={uiBounds.right}
          currentReplayKind={currentReplayKind}
          activeRelationMoment={activeRelationMoment}
          playedRelationIndicesAttribute={playedRelationIndicesAttribute}
          activeStep={currentReplayStep}
          playbackSteps={playbackSteps}
          derivationStages={derivationStages}
          sentence={sentence}
          activeStepIndex={activeStepIndex}
          activeStageDisplayLabel={activeStageDisplayLabel}
          canStepBackward={canStepBackward}
          canStepForward={canStepForward}
          isAutoPlaying={isAutoPlaying}
          isScrubbing={isScrubbing}
          handlePrevStep={handlePrevStep}
          handleNextStep={handleNextStep}
          handleTogglePlayback={handleTogglePlayback}
          onFit={() => { manualCameraRef.current = null; setFitRevision(value => value + 1); }}
          onPause={() => setIsAutoPlaying(false)}
          onScrubbingChange={setIsScrubbing}
          onStepChange={setActiveStepIndex}
        />
      )}
      {!layoutReady && <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#03130e]/90">
        {plaqueLayoutError || missingReplayCoordinates ? <div role="alert" className="text-center text-emerald-100">
          <p>Could not lay out this tree.</p>
          <button type="button" onClick={retryPlaqueLayout} className="mt-3 underline">Retry</button>
        </div> : null}
      </div>}
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
        .derivation-slider:focus {
          outline: none;
        }
        .derivation-slider:focus-visible {
          outline: 2px solid #6ee7b7;
          outline-offset: 2px;
          border-radius: 6px;
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
