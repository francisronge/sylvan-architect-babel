import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../../replay/displayIdentity.ts';
import type { OverlayBounds } from '../../replay/relations/geometryBounds.ts';
import type { PlaquePlacement } from '../../replay/relations/plaquePlacement.ts';
import { projectPlaqueLayout } from '../../replay/relations/plaquePlacement.ts';
import {
  buildRenderableDerivationCanvasData,
  indexHierarchyNodesByIdAndAliases,
  isSyntheticWorkspaceRootNode
} from '../../replay/replayCanvas.ts';
import type { MeasuredStageCoordinates } from '../../replay/stageCamera.ts';
import {
  treeLayoutSize
} from '../../replay/stageCamera.ts';
import { cloneSyntaxTree } from '../../replay/syntaxForest.ts';
import type { TreeDirection } from '../../replay/treeLayout.ts';
import { layoutSyntaxTree } from '../../replay/treeLayout.ts';
import type { TreeInkTextMeasure } from '../../replay/treeInkGeometry.ts';
import { isUnderTriangulation, markTriangulatedNodes } from '../../replay/triangulation.ts';
import type { PlaybackStep, ReplayDerivationFrame } from '../../replay/types.ts';
import { type HierNode } from '../../replay/types.ts';
import { type SyntaxNode } from '../../types.ts';
import { revealPlaqueCollections } from '../collectionReveal.ts';
import { guardViewCallback } from '../viewErrorHandling.ts';
import { installCameraInteraction, updateScreenStableText, type CameraEffects } from './cameraInteraction.ts';
import { deferredTreeMatrix, type CameraSession } from './cameraState.ts';
import { fitTreeCamera } from './frameCamera.ts';
import { layoutReplayFrameTree, placeCanopy, type CanopyPlaces } from './frameTreeLayout.ts';
import { createIdentityForestLight } from './identityLighting.ts';
import { installRelationHitTargets } from './relationInteraction.ts';
import { refineRelationGeometry } from './relationRefinements.ts';
import { paintRelationScene } from './relationScene.ts';
import type { SyntaxDrawingContext } from './syntaxDrawing.ts';
import { paintSyntaxTree } from './syntaxDrawing.ts';

interface FrameLayout {
  dimensions: { width: number; height: number };
  canvasData: SyntaxNode;
  abstractionMode: boolean;
  movementProtectedNodeIds: Set<string>;
  stageLayoutSize: [number, number] | null;
  replayCoordinates: MeasuredStageCoordinates | undefined;
  /** The Canopy's places in the last Replay frame; null only where there is no Replay. */
  canopyPlaces: CanopyPlaces | null;
  treeDirection: TreeDirection;
  activePlaqueLayout: Map<number, PlaquePlacement>;
  uiBounds: { top: number; right: number; bottom: number; headerBottom: number; panelTop: number };
  stageCameraBounds: OverlayBounds | null;
  stagePlaqueContainmentBounds: OverlayBounds | null;
}
interface FrameReplay extends Pick<SyntaxDrawingContext,
  | 'activeStepIndex'
  | 'animated'
  | 'usesDerivationFrames'
  | 'replayVisibleNodeIdSet'
  | 'playbackSteps'
  | 'traceDisplayIndexByNodeId'
  | 'traceDisplayFrame'
  | 'traceDisplayRelationLinks'
  | 'traceDisplayFrameIndex'
  | 'activeDerivationArrowLinks'
  | 'firstSentenceReplayToken'
  | 'firstSentenceReplayDisplayToken'
  | 'terminalMorphRef'
  | 'measureCategoryText'
  | 'currentReplayStep'
  | 'pendingPhraseFrontingSourceNodeIds'
  | 'hasDerivationFrames'
> {
  measureTreeInk: TreeInkTextMeasure;
  activeDerivationFrameIndex: number;
  activeDerivationFrame: ReplayDerivationFrame | null;
  currentReplayUsesFutureLayoutScaffold: boolean;
  completedReplayStep: number | undefined;
}
type FrameRelations = Pick<Parameters<typeof paintRelationScene>[0],
  | 'relationRenderPlan'
  | 'playedRelationIndices'
  | 'activeRelationMoment'
  | 'acceptedCompositionIsTreeFirst'
  | 'stepLabelRuns'
>;
interface FrameCamera extends Pick<CameraSession,
  | 'cameraAnimationRef'
  | 'manualCameraRef'
  | 'data'
  | 'derivationStagesSignature'
  | 'autoCameraRef'
  | 'fitRevision'
> {
  zoomBehavior: CameraSession['zoom'];
}
interface FrameLifecycle extends Pick<CameraSession, 'svgRef' | 'reportViewError'> {
  containerRef: { current: HTMLDivElement | null };
  openingSelectionRef: { current: { steps: PlaybackStep[]; startedAt: number } | null };
  collectionRevealRef: { current: { steps: PlaybackStep[]; stepIndex: number; startedAt: number } | null };
  trajectoryLabelMaskId: string;
  applyRelationEmphasisRef: { current: (() => void) | null };
}

/** Draws one complete frame. The returned disposer cancels every frame-owned resource. */
export function drawTreeFrame({ layout, replay, relations, camera, lifecycle }: { layout: FrameLayout; replay: FrameReplay; relations: FrameRelations; camera: FrameCamera; lifecycle: FrameLifecycle }) {
  const {
    dimensions,
    canvasData,
    abstractionMode,
    movementProtectedNodeIds,
    stageLayoutSize,
    replayCoordinates,
    canopyPlaces,
    treeDirection,
    activePlaqueLayout,
    uiBounds,
    stageCameraBounds,
    stagePlaqueContainmentBounds
  } = layout;
  const {
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
  } = replay;
  const {
    relationRenderPlan,
    playedRelationIndices,
    activeRelationMoment,
    acceptedCompositionIsTreeFirst,
    stepLabelRuns
  } = relations;
  const { zoomBehavior, cameraAnimationRef, manualCameraRef, data, derivationStagesSignature, autoCameraRef, fitRevision } = camera;
  const {
    svgRef,
    containerRef,
    reportViewError,
    openingSelectionRef,
    trajectoryLabelMaskId,
    applyRelationEmphasisRef,
    collectionRevealRef
  } = lifecycle;
  // TreeVisualizer draws only once the SVG is mounted.
  const svg = d3.select(svgRef.current!);
  svg.selectAll('*').remove();
  svg.attr('data-babel-rendered-step', null);

  const { width: containerWidth, height: containerHeight } = dimensions;
  const clonedCanvasData = cloneSyntaxTree(canvasData);
  if (!clonedCanvasData) return;
  const rootHierarchy = d3.hierarchy(clonedCanvasData);
  const maxDepth = rootHierarchy.height;
  applyVizIds(rootHierarchy);

  if (abstractionMode) {
    markTriangulatedNodes(rootHierarchy, movementProtectedNodeIds);
  }

  const nodeCount = rootHierarchy.descendants().length;
  const [innerWidth, innerHeight] = stageLayoutSize
    ?? treeLayoutSize(nodeCount, maxDepth);

  const g = svg.attr('width', '100%').attr('height', '100%').append('g');

  const cameraRuntime = { applying: false, cancel: undefined as (() => void) | undefined, deferred: null as d3.ZoomTransform | null };
  const settledTreeMatrix = () => deferredTreeMatrix(svg.node(), g.node(), cameraRuntime.deferred);

  const cameraEffects: CameraEffects = {};
  const zoom = installCameraInteraction({
    cameraRuntime,
    svg,
    zoom: zoomBehavior,
    cameraAnimationRef,
    activeStepIndex,
    manualCameraRef,
    data,
    derivationStagesSignature,
    containerWidth,
    containerHeight,
    reportViewError
  }, g, cameraEffects);

  const stageCoordinates = animated && usesDerivationFrames
    ? replayCoordinates?.get(activeDerivationFrameIndex)?.get(canvasData)
    : undefined;
  const measurements = { measureCategoryText, measureTreeInk };
  const treeLayout = (root: d3.HierarchyNode<SyntaxNode>) => usesDerivationFrames
    ? layoutReplayFrameTree(root, [innerWidth, innerHeight], treeDirection, stageCoordinates, replayVisibleNodeIdSet, measurements)
    : layoutSyntaxTree(root, [innerWidth, innerHeight], treeDirection, undefined, undefined, measurements);
  svg.attr('data-babel-tree-direction', treeDirection);

  // The Canopy takes the last Replay frame's places; an analysis without Replay is packed fresh.
  const canopyTree = !animated && canopyPlaces ? placeCanopy(rootHierarchy, canopyPlaces) : null;
  svg.attr('data-babel-canopy-layout', animated ? null : canopyTree ? 'replay-frame' : 'fresh');
  const treeData = canopyTree ?? treeLayout(rootHierarchy);
  const plaqueNodePositions = indexHierarchyNodesByIdAndAliases(treeData.descendants());
  const replayPlaqueLayout = projectPlaqueLayout(activePlaqueLayout, id => plaqueNodePositions.get(id) ?? null);
  const derivationFrameFitNodes = (() => {
    if (!animated || !usesDerivationFrames || !activeDerivationFrame) return null;
    if (currentReplayUsesFutureLayoutScaffold) {
      return treeData.descendants().filter((node) =>
        !isUnderTriangulation(node) && !isSyntheticWorkspaceRootNode(node)
      );
    }
    const fitCanvasData = buildRenderableDerivationCanvasData(
      activeDerivationFrame.workspaceForest || []
    );
    const clonedFitCanvasData = cloneSyntaxTree(fitCanvasData);
    if (!clonedFitCanvasData) return null;
    const fitHierarchy = d3.hierarchy(clonedFitCanvasData);
    applyVizIds(fitHierarchy);
    if (abstractionMode) {
      markTriangulatedNodes(fitHierarchy, movementProtectedNodeIds);
    }
    const fitTreeData = treeLayout(fitHierarchy);
    return fitTreeData.descendants().filter((node) =>
      !isUnderTriangulation(node) && !isSyntheticWorkspaceRootNode(node)
    );
  })();

  const {
    visibleNodes,
    getRevealStepForNodeId,
    effectiveRevealThreshold,
    getReplayRenderedTerminalText,
    measureGraphicsElementsInTreeSpace,
    TARGET_EMERALD
  } = paintSyntaxTree({
    treeData,
    replayVisibleNodeIdSet,
    playbackSteps,
    animated,
    activeStepIndex,
    traceDisplayIndexByNodeId,
    traceDisplayFrame,
    traceDisplayRelationLinks,
    traceDisplayFrameIndex,
    usesDerivationFrames,
    activeDerivationArrowLinks,
    rootHierarchy,
    clonedCanvasData,
    firstSentenceReplayToken,
    firstSentenceReplayDisplayToken,
    terminalMorphRef,
    g,
    relationRenderPlan,
    measureCategoryText,
    currentReplayStep,
    pendingPhraseFrontingSourceNodeIds,
    hasDerivationFrames
  });
  /*
   * Production visual-relations overlay.
   * Semantics were compiled in replay/relations; here the laid-out
   * node positions bind the current frame's plan to primitives and draw
   * them in the shared zoom group. Authored trajectories are drawn from the
   * compiled plan; the Lab-only movement overlay stays disabled here.
   * Ghost-sets only restyle material the model explicitly authored silent. Marker sizes
   * stay screen-stable via per-marker counter-scaling; line strokes use
   * non-scaling strokes.
   */
  // Complete frame-stable overlay bounds, fed into viewport fitting so no
  // generated geometry on any side of the tree is clipped.
  const {
    overlayFitBounds,
    fitFallbackOverlays,
    finishFallbackPlacement,
    deferredAcceptedRelationDraws,
    identityForestLightFamilies
  } = paintRelationScene({
    relationRenderPlan,
    usesDerivationFrames,
    activeDerivationFrameIndex,
    visibleNodes,
    treeData,
    g,
    measureGraphicsElementsInTreeSpace,
    getReplayRenderedTerminalText,
    measureCategoryText,
    replayPlaqueLayout,
    replayVisibleNodeIdSet,
    playedRelationIndices,
    activeRelationMoment,
    svgRef,
    svg,
    animated,
    acceptedCompositionIsTreeFirst,
    containerWidth,
    deferredTreeMatrix: settledTreeMatrix,
    uiBounds,
    containerRef,
    TARGET_EMERALD,
    treeDirection,
    stepLabelRuns
  });
  // Initial viewport fit:
  // Derivation replay should keep one camera per Derivation frame, not refit to each
  // microstep's partial tree. That prevents fake left/right "movement" for
  // newly revealed branches like Teresa -> D -> DP before the real merge step.
  fitTreeCamera({
    session: {
      containerWidth,
      containerHeight,
      cameraRuntime,
      svg,
      zoom,
      autoCameraRef,
      animated,
      data,
      derivationStagesSignature,
      fitRevision,
      cameraAnimationRef,
      activeStepIndex,
      svgRef,
      reportViewError,
      manualCameraRef
    }, layout: {
      relationRenderPlan,
      activeDerivationFrameIndex,
      uiBounds,
      stageCameraBounds,
      stagePlaqueContainmentBounds,
      completedReplayStep,
      g,
      fitFallbackOverlays,
      derivationFrameFitNodes,
      overlayFitBounds,
      visibleNodes
    }
  });
  /*
   * Accepted relation plates measure rendered labels after zoom-to-fit.
   * Rebind glyph-sensitive endpoints at that point so font rasterization
   * and viewport scale cannot introduce card-dependent drift while the
   * semantic plan remains coordinate-free.
   */
  refineRelationGeometry({
    treeData,
    measureGraphicsElementsInTreeSpace,
    g,
    relationRenderPlan,
    activeDerivationFrameIndex,
    replayPlaqueLayout,
    visibleNodes,
    measureCategoryText,
    deferredAcceptedRelationDraws,
    playedRelationIndices,
    svg,
    updateScreenStableText: scale => updateScreenStableText(g, scale),
    deferredTreeMatrix: settledTreeMatrix
  });
  const identityLighting = createIdentityForestLight({
    container: containerRef.current, svg: svgRef.current, identityForestLightFamilies, reportViewError
  });
  cameraEffects.refreshIdentityForestLight = identityLighting.refresh;

  // Install immediately so a hover-triggered redraw never leaves the pointer
  // over a thin, temporarily unhittable path. Deferred relation geometry gets
  // the same treatment as soon as it is mounted on the following frame.
  installRelationHitTargets(g);
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
  const deferredRelationFrame = window.requestAnimationFrame(guardViewCallback(() => {
    deferredAcceptedRelationDraws.forEach((draw) => draw());
    // Relation lines pass under visible tree text through a mask of each
    // visible label's own letters, placed exactly on the label.
    const maskUnderVisibleLabels = (
      paths: d3.Selection<SVGPathElement, unknown, SVGGElement, unknown>,
      maskId: string,
      { outline }: { outline: boolean }
    ) => {
      if (paths.empty()) return;
      const bounds = measureGraphicsElementsInTreeSpace(paths.nodes());
      if (!bounds) return;
      let mask = g.select<SVGMaskElement>(`#${maskId}`);
      if (mask.empty()) mask = g.append('defs').append('mask').attr('id', maskId).attr('maskUnits', 'userSpaceOnUse');
      const area = { x: bounds.x - 40, y: bounds.y - 40, width: bounds.width + 80, height: bounds.height + 80 };
      mask.attr('x', area.x).attr('y', area.y).attr('width', area.width).attr('height', area.height);
      mask.selectChildren().remove();
      mask.append('rect').attr('fill', 'white')
        .attr('x', area.x).attr('y', area.y).attr('width', area.width).attr('height', area.height);
      g.selectAll<SVGTextElement, HierNode>('.node-group .category-label, .node-group .terminal-label')
        .filter(d => getRevealStepForNodeId(getNodeId(d)) <= effectiveRevealThreshold)
        .each(function () {
          const holder = this.closest('.node-group');
          const glyphs = this.cloneNode(true) as SVGTextElement;
          // A mask copy is not a label: label queries must never find it, and
          // no class may repaint a piece of it (an index tspan keeps its
          // relation colour otherwise and lets the curve show through). Each
          // piece keeps the font it is painted with and is masked in black.
          const painted = [this, ...this.querySelectorAll('*')] as SVGElement[];
          [glyphs, ...glyphs.querySelectorAll('*')].forEach((piece, index) => {
            const source = painted[index], font = source && getComputedStyle(source);
            const element = piece as SVGElement;
            if (font) ['font-family', 'font-size', 'font-style', 'font-weight', 'letter-spacing', 'baseline-shift']
              .forEach(property => element.style.setProperty(property, font.getPropertyValue(property)));
            element.removeAttribute('id');
            element.removeAttribute('class');
            [...element.attributes].filter(attribute => attribute.name.startsWith('data-'))
              .forEach(attribute => element.removeAttribute(attribute.name));
            element.style.setProperty('fill', 'black', 'important');
            element.style.setProperty('stroke', outline ? 'black' : 'none', 'important');
            element.style.setProperty('opacity', '1', 'important');
          });
          const group = mask.append('g').attr('transform', holder?.getAttribute('transform') ?? null);
          group.node()!.appendChild(glyphs);
        });
      paths.attr('mask', `url(#${maskId})`);
    };
    // Neutral connectors are hidden where the letters and their dark outline
    // are painted. Movement curves are hidden only under the letters, so a
    // curve crossing a word stays continuous over its outline and the word
    // keeps its own pixels.
    cameraEffects.refreshTrajectoryClearance = () => {
      maskUnderVisibleLabels(g.selectAll<SVGPathElement, unknown>('.vr-fallback-connector path'),
        `${trajectoryLabelMaskId}-connectors`, { outline: true });
      maskUnderVisibleLabels(g.selectAll<SVGPathElement, unknown>('.babel-trajectory-path, .babel-trajectory-path-shadow'),
        trajectoryLabelMaskId, { outline: false });
    };
    cameraEffects.refreshTrajectoryClearance();
    finishFallbackPlacement?.();
    installRelationHitTargets(g);
    // Font, viewport and layout redraws remount marks without changing the
    // active relation. Apply the same current emphasis to the new elements.
    applyRelationEmphasisRef.current?.();
    identityLighting.start();
    if (animated && activeRelationMoment) {
      if (collectionRevealRef.current?.steps !== playbackSteps
        || collectionRevealRef.current.stepIndex !== activeStepIndex) {
        collectionRevealRef.current = { steps: playbackSteps, stepIndex: activeStepIndex, startedAt: performance.now() };
      }
      cameraEffects.finishCollectionReveal = revealPlaqueCollections(svgRef.current!, activeRelationMoment, {
        elapsed: performance.now() - collectionRevealRef.current.startedAt,
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        idPrefix: `${trajectoryLabelMaskId}-collection`
      });
    } else collectionRevealRef.current = null;
    svg.attr('data-babel-rendered-step', activeStepIndex);
  }, reportViewError));
  return () => {
    cameraRuntime.cancel?.();
    openingAnimation?.cancel();
    cameraEffects.finishCollectionReveal?.();
    window.cancelAnimationFrame(deferredRelationFrame);
    cameraEffects.refreshIdentityForestLight = undefined;
    identityLighting.dispose();
  };

}
