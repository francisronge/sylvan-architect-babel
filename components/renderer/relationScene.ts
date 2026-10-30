import * as d3 from 'd3';
import { type BindGeometryOptions, type PlanPositionProvider } from '../../replay/relations/boundGeometry.ts';
import { bindAnchorSetBadges, bindRelationPlanFrame } from '../../replay/relations/geometryBinding.ts';
import {
  markerScaleAtZoom, PLAQUE_FIT_MARGIN, RELATION_BINDING_METRICS, RELATION_LANES_BELOW_DEEPEST_NODE, TRAJECTORY_ROUTES
} from '../../replay/rendererMetrics.ts';
import { boundOverlayBounds, type OverlayBounds } from '../../replay/relations/geometryBounds.ts';
import {
  type Rect
} from '../../replay/relations/overlayGeometry.ts';
import { drawnPlaque, projectPlaqueLayout } from '../../replay/relations/plaquePlacement.ts';
import { projectVisibleAnchorSetOrganization } from '../../replay/relations/relationFrame.ts';
import type { RelationRenderPlan } from '../../replay/relations/renderPlan.ts';
import { scopeDomainPaint } from '../../replay/relations/scopeDomainPaint.ts';
import {
  isPlanItemRevealed,
  planItemDependencyNodeIds,
  planItemOwnsRelationMoment,
  resolveDisplayedTrajectoryAttachments,
  type RelationPlanItem
} from '../../replay/relations/renderPlan.ts';
import { projectThetaGrid } from '../../replay/relations/thetaGridComposition.ts';
import { indexHierarchyNodesByIdAndAliases } from '../../replay/replayCanvas.ts';
import type { TreeDirection } from '../../replay/treeLayout.ts';
import type { TreeLabelRuns } from '../../replay/treeLabelRuns.ts';
import { type HierNode, type PlaybackStep } from '../../replay/types.ts';
import { type SyntaxNode } from '../../types.ts';
import { createBindingDrawing, indexLetterLabels } from './bindingDrawing.ts';
import { createCaseFeatureDrawing } from './caseFeatureDrawing.ts';
import { paintGhostLenses, queueCopyDrawings } from './copyDrawing.ts';
import type { DrawingLayer, RelationEmphasis } from './drawingContext.ts';
import { createFallbackPlacement, measureFallbackLabels } from './fallbackDrawing.ts';
import { planIndexLetters } from './indexLetters.ts';
import { createInterventionDrawing } from './interventionDrawing.ts';
import { createLinearizationDrawing } from './linearizationDrawing.ts';
import { createLocalityDrawing } from './localityDrawing.ts';
import { createPhraseDrawing } from './phraseDrawing.ts';
import { createPlaqueDrawing } from './plaqueDrawing.ts';
import { withPlaqueTextMeasure } from './plaqueText.ts';
import { createRealizationDrawing } from './realizationDrawing.ts';
import { createReconstructionDrawing } from './reconstructionDrawing.ts';
import { createRelationAnchors } from './relationAnchors.ts';
import { createRelationLayers } from './relationLayers.ts';
import { acceptedRelationDrawingKey, createRelationOwnership, decorateRelationElement, relationLayerKey } from './relationOwnership.ts';
import { createPrimitiveVisibility } from './relationVisibility.ts';
import { createScopeDrawing } from './scopeDrawing.ts';
import { createShapeDrawing } from './shapeDrawing.ts';
import { createSharingDrawing } from './sharingDrawing.ts';
import { createThetaDrawing } from './thetaDrawing.ts';
import { createTrajectoryDrawing } from './trajectoryDrawing.ts';
import { createTreeMeasurements, labelBelongsToNode, measurePaintedTreeLabelCells } from './treeMeasurements.ts';
import { appendOverlayMarker, hasTreeGapNotation } from './treeNotation.ts';

interface RelationSceneContext {
  relationRenderPlan: RelationRenderPlan | null;
  usesDerivationFrames: boolean;
  activeDerivationFrameIndex: number;
  visibleNodes: d3.HierarchyPointNode<SyntaxNode>[];
  treeData: d3.HierarchyPointNode<SyntaxNode>;
  g: DrawingLayer;
  measureGraphicsElementsInTreeSpace: (elements: SVGGraphicsElement[]) => { x: number; y: number; width: number; height: number; } | null;
  getReplayRenderedTerminalText: (d: HierNode) => string;
  getReplayRenderedCategoryLines: (d: HierNode) => string[];
  measureCategoryText: (text: string) => number;
  replayPlaqueLayout: ReturnType<typeof projectPlaqueLayout>;
  replayVisibleNodeIdSet: Set<string> | null;
  playedRelationIndices: Set<number> | null;
  /** The Replay's steps and the one shown; scope domain colours follow their played history. */
  playbackSteps: readonly PlaybackStep[];
  activeStepIndex: number;
  activeRelationMoment: { stageIndex: number; relationIndex: number } | null;
  svgRef: { current: SVGSVGElement | null };
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  animated: boolean;
  acceptedCompositionIsTreeFirst: boolean;
  containerWidth: number;
  /** The tree layer's screen matrix under the settled camera. Deferred draws
   * run after the fit, possibly while the camera is still moving to it; their
   * viewport placements and screen sizes follow its destination. */
  deferredTreeMatrix: () => DOMMatrix | null;
  uiBounds: { top: number; right: number; bottom: number; headerBottom: number; panelTop: number };
  containerRef: { current: HTMLDivElement | null };
  TARGET_EMERALD: string;
  /** Neutral role labels prefer the reading-direction side of their node. */
  treeDirection: TreeDirection;
  /** The shown stage's authored relations, whose names label bracketed neutral connectors. */
  stageRelations?: ReadonlyArray<{ relation?: string }>;
  /** This step's tree labels with their relation index letters
   * (`treeLabelRunsForStep`), read only when the frame places anchor-set badges. */
  stepLabelRuns?: () => ReadonlyMap<string, readonly TreeLabelRuns[]> | undefined;
}
export function paintRelationScene({
  relationRenderPlan,
  usesDerivationFrames,
  activeDerivationFrameIndex,
  visibleNodes,
  treeData,
  g,
  measureGraphicsElementsInTreeSpace,
  getReplayRenderedTerminalText,
  getReplayRenderedCategoryLines,
  measureCategoryText,
  replayPlaqueLayout,
  replayVisibleNodeIdSet,
  playedRelationIndices,
  playbackSteps,
  activeStepIndex,
  activeRelationMoment,
  svgRef,
  svg,
  animated,
  acceptedCompositionIsTreeFirst,
  containerWidth,
  deferredTreeMatrix,
  uiBounds,
  containerRef,
  TARGET_EMERALD,
  treeDirection,
  stageRelations,
  stepLabelRuns
}: RelationSceneContext) {
  let overlayFitBounds: OverlayBounds | null = null;
  let fitFallbackOverlays: ((fitZoom: number, fittedViewport: Rect) => void) | undefined;
  let finishFallbackPlacement: (() => void) | undefined;
  const deferredAcceptedRelationDraws: Array<() => void> = [];

  const identityForestLightFamilies: Array<{
    occurrencePools: string[][];
    emphasis: RelationEmphasis;
    item: RelationPlanItem;
  }> = [];
  const identityTerminalOwners = new Map<SVGElement, RelationPlanItem>();
  if (
    relationRenderPlan
    && usesDerivationFrames
    && Number.isInteger(activeDerivationFrameIndex)
    && activeDerivationFrameIndex >= 0
    && activeDerivationFrameIndex < relationRenderPlan.frames.length
  ) {
    const {
      overlayNodeById,
      resolveOverlayAnchor,
      isDisplayTerminalNode,
      terminalAmbiguities,
      resolveMaterializedTerminal,
      markPreterminalLensNode,
      markSubtreeLensNodes,
      markIdentityLensOccurrences,
      clearMovedCopyClassForAnchors
    } = createRelationAnchors({ visibleNodes, treeData, g });
    const {
      measuredShellBottom,
      measuredShellTop,
      measuredTerminalBottom,
      measuredTreeTextTopY,
      measuredTreeLabelRects,
      measuredTerminalSubtreeRectNow,
      measuredTreeLabelRectNow,
      exactScreenTreeLabelRectNow,
      exactScreenDirectTreeLabelRectNow,
      exactScreenTreeLabelRectForNodeIdsNow
    } = createTreeMeasurements({ g, overlayNodeById, measureGraphicsElementsInTreeSpace });

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
     * Allocate the stage's claims together, but bind them to the current
     * tree. Future layout may reserve space; the completed stage cannot
     * supply coordinates for syntax that has not moved there yet.
     */
    const frameLayoutById = indexHierarchyNodesByIdAndAliases(
      treeData.descendants()
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
    const { fallbackMeasurements } = measureFallbackLabels({
      relationRenderPlan,
      activeDerivationFrameIndex,
      g,
      frameLayoutById,
      getReplayRenderedTerminalText,
      getReplayRenderedCategoryLines,
      replayPlaqueLayout,
      replayVisibleNodeIdSet,
      playedRelationIndices,
      activeRelationMoment,
      resolveOverlayAnchor,
      direction: treeDirection
    });
    const frameItems = projectVisibleAnchorSetOrganization(
      (relationRenderPlan.frames[activeDerivationFrameIndex]?.items ?? []).map((item) =>
        resolveDisplayedTrajectoryAttachments(projectThetaGrid(item, activeDerivationFrameIndex, playedRelationIndices), (nodeId) => overlayNodeById.get(nodeId)?.data,
          { stageIndex: activeDerivationFrameIndex, playedRelationIndices })),
      item => isPlanItemRevealed(item, activeDerivationFrameIndex, playedRelationIndices,
        activeRelationMoment?.relationIndex ?? null)
        && planItemDependencyNodeIds(item).every(id => Boolean(resolveOverlayAnchor(id))));
    const revealedItemIndices = new Set<number>();
    frameItems.forEach((planItem, planItemIndex) => {
      const revealed = isPlanItemRevealed(planItem, activeDerivationFrameIndex,
        playedRelationIndices, activeRelationMoment?.relationIndex ?? null);
      if (revealed) revealedItemIndices.add(planItemIndex);
    });
    const displayedRelationPlan = {
      ...relationRenderPlan,
      frames: relationRenderPlan.frames.map((frame, index) => index === activeDerivationFrameIndex
        ? { ...frame, items: frameItems } : frame)
    };
    const zoomK = svgRef.current ? (d3.zoomTransform(svgRef.current).k || 1) : 1;
    // Screen-stable marker sizing, capped so far-out zoom never lets the
    // markers dwarf the tree they annotate.
    const markerScale = markerScaleAtZoom(zoomK);
    const badgeGap = RELATION_BINDING_METRICS.badgeGap;
    const frameMaxNodeY = d3.max([...frameLayoutById.values()], (frameNode) => frameNode.y) ?? 0;
    // Share the exact displayed-notation decision between slot allocation and painting.
    const hasExistingGapNotation = (nodeId: string, text: string) => hasTreeGapNotation(g, nodeId, text);
    // Anchor-set badges clear the labels as this step paints them and the displayed plaque shells.
    const labelRuns = frameItems.some(item => item.kind === 'anchor-set') ? stepLabelRuns?.() ?? null : undefined;
    const badgeObstacles = labelRuns === undefined ? undefined : [
      ...measurePaintedTreeLabelCells(g, replayVisibleNodeIdSet, labelRuns ? nodeId => labelRuns.get(nodeId) : undefined),
      ...(fallbackMeasurements.visibleObstacles ?? []).map(drawnPlaque)
    ];
    const bindOptions: BindGeometryOptions = {
      ...RELATION_BINDING_METRICS,
      markerScale,
      hasExistingGapNotation,
      fallbackMeasurements,
      separateFallbackMoments: animated && usesDerivationFrames,
      isItemRevealed: itemIndex => revealedItemIndices.has(itemIndex),
      trajectoryCeilingY: measuredTreeTextTopY() - TRAJECTORY_ROUTES.ceilingAboveTextTop,
      trajectoryLabelBoxes: measuredTreeLabelRects,
      trajectoryFloorY: frameMaxNodeY + RELATION_LANES_BELOW_DEEPEST_NODE.trajectoryFloor,
      // Frame-stable measured baselines: connector lanes just below the
      // complete frame's terminal row; rails placed by the binder's one
      // vertical allocation law beneath the deepest allocated lane.
      connectorBaselineY: frameMaxNodeY + RELATION_LANES_BELOW_DEEPEST_NODE.connectorBaseline,
      railBaseY: frameMaxNodeY + RELATION_LANES_BELOW_DEEPEST_NODE.railBase,
      direction: treeDirection,
      relationNameFor: ref => ref.stageIndex === activeDerivationFrameIndex ? stageRelations?.[ref.relationIndex]?.relation : undefined,
      ...(badgeObstacles ? { badgeObstacles } : {})
    };
    const boundFrame = withPlaqueTextMeasure(svg, measurePlaqueText => bindRelationPlanFrame(
      displayedRelationPlan, activeDerivationFrameIndex, framePositionFor,
      { ...bindOptions, plaqueTextLayout: { measureText: measurePlaqueText } }
    ));
    const fallbackPlacement = createFallbackPlacement({ fallbackMeasurements, boundFrame, markerScale, badgeGap, frameMaxNodeY, animated, usesDerivationFrames, g, direction: treeDirection,
      placeAnchorSetBadges: fittedScale => bindAnchorSetBadges(displayedRelationPlan, activeDerivationFrameIndex, framePositionFor,
        { ...bindOptions, markerScale: fittedScale }) });
    fitFallbackOverlays = fallbackPlacement.fit;
    finishFallbackPlacement = fallbackPlacement.finish;
    const primitiveWitnessesVisible = createPrimitiveVisibility(frameItems, resolveOverlayAnchor);
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
    let primitiveHost: DrawingLayer = overlay;
    const ghostLensRequests: Array<{
      nodeIds: string[];
      siteNodeIds: string[];
      antecedentNodeIds: string[];
      emphasis: RelationEmphasis;
      acceptedEllipsisStyle: boolean;
      item: RelationPlanItem;
    }> = [];
    const appendMarker = (markX: number, markY: number, treeNotation = false, stackIndex = 0) => appendOverlayMarker(primitiveHost, markX, markY, markerScale, badgeGap, treeNotation, stackIndex);
    /*
     * Complete, frame-stable overlay bounds (all four sides, glyph and
     * label extents included) from the FULL allocation — the camera fits
     * once per frame and never re-fits when a relation is revealed.
     * Nominal marker scale keeps the bounds zoom-independent.
     */
    overlayFitBounds = acceptedCompositionIsTreeFirst
      ? null
      : boundOverlayBounds({
        ...boundFrame,
        primitives: boundFrame.primitives.filter(primitive => primitive.type !== 'plaque')
      }, { markerScale: 1 });
    if (!acceptedCompositionIsTreeFirst) replayPlaqueLayout.forEach(rect => {
      const bounds = {
        minX: rect.x - PLAQUE_FIT_MARGIN, minY: rect.y - PLAQUE_FIT_MARGIN,
        maxX: rect.x + rect.width + PLAQUE_FIT_MARGIN, maxY: rect.y + rect.height + PLAQUE_FIT_MARGIN
      };
      overlayFitBounds = overlayFitBounds ? {
        minX: Math.min(overlayFitBounds.minX, bounds.minX), minY: Math.min(overlayFitBounds.minY, bounds.minY),
        maxX: Math.max(overlayFitBounds.maxX, bounds.maxX), maxY: Math.max(overlayFitBounds.maxY, bounds.maxY)
      } : bounds;
    });

    const {
      trajectoryMarkerIds,
      pairMergeLayers,
      bindingRelationLayers,
      coindexRelationLayers,
      operatorVariableBindingLayers,
      operatorVariableSharedPathLayers,
      predicationRelationLayers,
      blockedExtractionLayers,
      idiomChunkLayers,
      parasiticGapCoindexLayers,
      acceptedLayerInHost,
      acceptedRootLayerBeforeNodes,
      acceptedRootLayerAfterNodes,
      ensureControlRelationLayer,
      ensureFeatureRelationLayer,
      ensureAgreementCaseRelationLayer,
      acceptedIslandLayer,
      ensureTrajectoryRelationLayer
    } = createRelationLayers({ activeDerivationFrameIndex, relationLayerKey, g, decorateRelationElement, overlay });

    const { queueAcceptedRelationDraw } = createRelationOwnership({ deferredAcceptedRelationDraws, g });
    // Companion pieces share a draw; independent families within one relation do not.

    const relationEmphasisForItem = (
      item: RelationPlanItem
    ): RelationEmphasis => activeRelationMoment
        ? (planItemOwnsRelationMoment(
          item,
          activeRelationMoment.stageIndex,
          activeRelationMoment.relationIndex
        ) ? 'active' : 'quiet')
        : null;
    const {
      scheduleAcceptedAntiLocality,
      scheduleAcceptedImproperMovement,
      ensureDomainLocalityLayers,
      scheduledAcceptedLocalityRelations
    } = createLocalityDrawing({ g, activeDerivationFrameIndex, relationLayerKey, queueAcceptedRelationDraw, frameItems, measuredTreeLabelRectNow });

    const { scheduleAcceptedSharingRelation } = createSharingDrawing({
      relationLayerKey,
      acceptedRelationDrawingKey,
      queueAcceptedRelationDraw,
      g,
      frameItems,
      overlayNodeById,
      labelBelongsToNode,
      exactScreenTreeLabelRectNow,
      exactScreenTreeLabelRectForNodeIdsNow
    });

    const scheduledAcceptedPfRelations = new Set<string>();
    const { scheduleAcceptedPfRelation, scheduleAcceptedPfMorphologyRelation } = createRealizationDrawing({
      markPreterminalLensNode,
      acceptedRelationDrawingKey,
      scheduledAcceptedPfRelations,
      queueAcceptedRelationDraw,
      g,
      svg,
      exactScreenTreeLabelRectNow,
      containerWidth,
      deferredTreeMatrix,
      overlayNodeById,
      measureGraphicsElementsInTreeSpace,
      uiBounds,
      exactScreenTreeLabelRectForNodeIdsNow,
      containerRef
    });

    const { scheduleAcceptedCyclicLinearization } = createLinearizationDrawing({
      relationLayerKey,
      frameItems,
      acceptedRelationDrawingKey,
      scheduledAcceptedPfRelations,
      queueAcceptedRelationDraw,
      g,
      svg,
      exactScreenTreeLabelRectNow,
      treeData,
      exactScreenDirectTreeLabelRectNow,
      uiBounds,
      deferredTreeMatrix,
      badgeObstacles
    });
    const { scheduleAcceptedScopeInformationRelation, scheduleAcceptedFocusProminence } = createScopeDrawing({
      relationLayerKey,
      acceptedRelationDrawingKey,
      scheduledAcceptedPfRelations,
      queueAcceptedRelationDraw,
      g,
      overlayNodeById,
      labelBelongsToNode,
      exactScreenTreeLabelRectNow,
      treeData,
      svg,
      containerWidth,
      deferredTreeMatrix,
      markPreterminalLensNode,
      frameItems,
      resolveOverlayAnchor,
      isDisplayTerminalNode,
      markSubtreeLensNodes
    });

    const { scheduleAcceptedThetaGrid } = createThetaDrawing({
      relationLayerKey,
      acceptedRelationDrawingKey,
      scheduledAcceptedPfRelations,
      queueAcceptedRelationDraw,
      frameItems,
      g,
      resolveOverlayAnchor,
      svg,
      replayPlaqueLayout,
      decorateRelationElement,
      identityTerminalOwners,
      relationEmphasisForItem
    });
    const { scheduleAcceptedIntervention } = createInterventionDrawing({
      scheduledAcceptedLocalityRelations,
      relationLayerKey,
      queueAcceptedRelationDraw,
      frameItems,
      g,
      overlayNodeById,
      exactScreenTreeLabelRectNow
    });
    const { scheduleAcceptedLfReconstruction } = createReconstructionDrawing({ relationLayerKey, queueAcceptedRelationDraw, frameItems, g, labelBelongsToNode, exactScreenTreeLabelRectNow });

    const sortedTrajectories = boundFrame.primitives
      .filter((primitive) => primitive.type === 'trajectory-path')
      .sort((left, right) => {
        const priority = (kind: string) => kind === 'head' ? 0 : 1;
        return priority(left.trajectoryKind) - priority(right.trajectoryKind);
      });
    let sortedTrajectoryIndex = 0;
    // Future marks reserve geometry but are never drawn or focusable;
    // no mark draws while any of its syntax witnesses is hidden.
    const drawablePrimitives = boundFrame.primitives.map((primitive) =>
      primitive.type === 'trajectory-path'
        ? sortedTrajectories[sortedTrajectoryIndex++]
        : primitive)
      .filter(primitive => frameItems[primitive.itemIndex] && revealedItemIndices.has(primitive.itemIndex)
        && primitiveWitnessesVisible(primitive));
    const operatorVariableScopes = scopeDomainPaint(relationRenderPlan, activeDerivationFrameIndex, playbackSteps, activeStepIndex);
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
      emphasis: RelationEmphasis;
      item: RelationPlanItem;
    }> = [];
    const acceptedPartialCopyStrikeRequests: Array<{
      nodeId: string;
      emphasis: RelationEmphasis;
      item: RelationPlanItem;
    }> = [];
    const acceptedDeletionTerminalStrikeRequests: Array<{
      domainNodeId: string;
      emphasis: RelationEmphasis;
      item: RelationPlanItem;
    }> = [];
    const acceptedParasiticGapCopyRequests: Array<{
      contentNodeId: string;
      ordinaryGapNodeId: string;
      parasiticGapNodeIds: string[];
      emphasis: RelationEmphasis;
      item: RelationPlanItem;
    }> = [];

    // One failed comparison owns one cue between its row routes, measured in
    // their shared local coordinates. Separate comparisons never share a cue.
    const { drawPlaqueDependencyPath, drawCaseFeatureComposition } = createCaseFeatureDrawing({
      decorateRelationElement,
      relationEmphasisForItem,
      activeDerivationFrameIndex,
      playedRelationIndices,
      markerScale,
      frameItems,
      replayPlaqueLayout,
      renderedCaseCompositions,
      revealedItemIndices,
      ensureAgreementCaseRelationLayer,
      measuredTreeLabelRectNow,
      measuredTerminalSubtreeRectNow,
      overlayNodeById,
      markPreterminalLensNode
    });

    const { drawShapePath, drawPathNodeRing } = createShapeDrawing({
      measuredTreeLabelRectNow,
      measuredTerminalSubtreeRectNow,
      queueAcceptedRelationDraw,
      ensureDomainLocalityLayers,
      ensureAgreementCaseRelationLayer,
      activeDerivationFrameIndex,
      frameItems,
      treeData,
      renderedFeatureSharingItems,
      markPreterminalLensNode,
      svg,
      drawCaseFeatureComposition,
      drawPlaqueDependencyPath,
      ensureControlRelationLayer,
      acceptedRootLayerAfterNodes,
      predicationRelationLayers,
      overlay,
      decorateRelationElement,
      resolveOverlayAnchor,
      acceptedLayerInHost,
      blockedExtractionLayers,
      idiomChunkLayers,
      acceptedIslandLayer,
      appendMarker
    });
    const { drawNativeBranchOverlay, drawTrajectoryPath } = createTrajectoryDrawing({
      sampleNativeBranchOverlay,
      acceptedRootLayerBeforeNodes,
      pairMergeLayers,
      acceptedLayerInHost,
      blockedExtractionLayers,
      markPreterminalLensNode,
      clearMovedCopyClassForAnchors,
      ensureTrajectoryRelationLayer,
      trajectoryMarkerIds
    });
    const drawnThetaGrids = [...new Set(drawablePrimitives.map(primitive => frameItems[primitive.itemIndex]))]
      .filter(item => item.kind === 'node-plaque' && item.plaqueStyle === 'theta-grid' && item.familyId === 'theta.grid');
    const indexLetterPlan = planIndexLetters(drawablePrimitives, frameItems, {
      ...indexLetterLabels(g, resolveOverlayAnchor, drawnThetaGrids),
      emphasisRank: item => {
        const emphasis = relationEmphasisForItem(item);
        return emphasis === 'active' ? 2 : emphasis === 'quiet' ? 0 : 1;
      }
    });
    const {
      drawSplitAntecedence,
      drawOperatorVariableBinding,
      drawQuantifierRaising,
      drawDomainEllipse,
      drawIdentityLens,
      drawIndexBadge
    } = createBindingDrawing({
      activeDerivationFrameIndex, overlay,
      operatorVariableScopes,
      acceptedRootLayerBeforeNodes,
      operatorVariableBindingLayers,
      activeRelationMoment,
      operatorVariableSharedPathLayers,
      relationEmphasisForItem,
      measuredTreeLabelRectNow,
      overlayNodeById,
      frameItems,
      replayPlaqueLayout,
      visibleNodes,
      measuredTerminalSubtreeRectNow,
      measureCategoryText,
      acceptedRootLayerAfterNodes,
      bindingRelationLayers,
      resolveOverlayAnchor,
      terminalAmbiguities,
      g,
      identityTerminalOwners,
      decorateRelationElement,
      identityForestLightFamilies,
      markIdentityLensOccurrences,
      relationLayerKey,
      ensureControlRelationLayer,
      coindexRelationLayers,
      TARGET_EMERALD,
      acceptedLayerInHost,
      parasiticGapCoindexLayers,
      appendMarker,
      indexLetterPlan
    });
    const { drawGappingAlignment, drawDomainRegion } = createPhraseDrawing({
      resolveOverlayAnchor,
      resolveMaterializedTerminal,
      g,
      queueAcceptedRelationDraw,
      ensureDomainLocalityLayers,
      measuredTreeLabelRectNow,
      markPreterminalLensNode,
      ensureControlRelationLayer,
      appendMarker
    });
    const { drawPlaque, drawTextBadge, drawAnalysisVerdict } = createPlaqueDrawing({
      g,
      queueAcceptedRelationDraw,
      frameItems,
      drawCaseFeatureComposition,
      measuredTerminalSubtreeRectNow,
      measuredTreeLabelRectNow,
      replayPlaqueLayout,
      ensureFeatureRelationLayer,
      revealedItemIndices,
      drawPlaqueDependencyPath,
      resolveOverlayAnchor,
      markPreterminalLensNode,
      renderedBoundaryCutItems,
      boundFrame,
      markSubtreeLensNodes,
      acceptedLayerInHost,
      idiomChunkLayers,
      appendMarker
    });
    drawablePrimitives.forEach((primitive) => {
      /*
       * The Replay relation lens, uniform across every primitive type:
       * during a relation moment the played relation's marks (matched by
       * exact authored identity, including coalesced contributors) are
       * prominent and everything else visible stays present but quiet.
       */
      const planItem = frameItems[primitive.itemIndex];
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
        drawNativeBranchOverlay(primitive, planItem, host, emphasis);
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
        drawSplitAntecedence(primitive, planItem, host);
        return;
      }
      if (primitive.type === 'trajectory-path') {
        drawTrajectoryPath(primitive, planItem, host, emphasis);
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
          || planItem.kind === 'ellipsis-site' && planItem.ellipsisStyle === 'recoverability';
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
        drawGappingAlignment(primitive, planItem, host, emphasis);
        return;
      }
      if (primitive.type === 'quantifier-raising') {
        drawQuantifierRaising(primitive, planItem, host, emphasis);
        return;
      }
      if (primitive.type === 'operator-variable-binding') {
        drawOperatorVariableBinding(primitive, planItem, host, emphasis);
        return;
      }
      if (primitive.type === 'shape-path') {
        drawShapePath(primitive, planItem, host, emphasis);
        return;
      }
      if (primitive.type === 'path-node-ring') {
        drawPathNodeRing(primitive, planItem, emphasis);
        return;
      }
      if (primitive.type === 'domain-region') {
        drawDomainRegion(primitive, planItem, host, emphasis);
        return;
      }
      if (primitive.type === 'plaque') {
        drawPlaque(primitive, planItem, host, emphasis);
        return;
      }
      if (primitive.type === 'analysis-verdict') {
        drawAnalysisVerdict(primitive, planItem, host, emphasis);
        return;
      }
      if (primitive.type === 'text-badge') {
        drawTextBadge(primitive, planItem, host, emphasis);
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
        drawIdentityLens(primitive, planItem, host, emphasis);
        return;
      }
      if (primitive.type === 'leader') {
        // Plaque ownership is expressed by placement, without an added cross-tree leader.
        return;
      }
      if (primitive.type === 'segment') {
        fallbackPlacement.drawSegment(primitive, host);
        return;
      }
      if (primitive.type === 'domain-ellipse') {
        drawDomainEllipse(primitive, planItem, host, emphasis);
        return;
      }
      if (primitive.type === 'index-badge') {
        drawIndexBadge(primitive, planItem, host, emphasis);
        return;
      }
      if (primitive.type === 'fallback-mark') {
        fallbackPlacement.drawMark(primitive, host);
        return;
      }
      if (primitive.type === 'anchor-set-badge') {
        fallbackPlacement.drawBadge(primitive, host);
        return;
      }
      if (primitive.type === 'anchor-set-rail') {
        fallbackPlacement.drawRail(primitive, host);
      }
    });

    queueCopyDrawings({
      acceptedEnclosureRequests,
      deferredAcceptedRelationDraws,
      g,
      exactScreenTreeLabelRectNow,
      decorateRelationElement,
      acceptedPartialCopyStrikeRequests,
      measuredTreeLabelRectNow,
      acceptedDeletionTerminalStrikeRequests,
      resolveOverlayAnchor,
      measureGraphicsElementsInTreeSpace,
      acceptedParasiticGapCopyRequests,
      measuredShellBottom,
      measuredShellTop
    });
    /*
     * Resolve ghost lens states: for material shared by several ellipsis
     * claims, an active moment wins over neutral, which wins over quiet.
     * The presentation itself is the pure, tested law from the binder —
     * active silence glows without ever looking pronounced; quiet silence
     * recedes below its neutral opacity like every other quiet mark.
     */
    paintGhostLenses(g, ghostLensRequests);
  }

  return {
    overlayFitBounds,
    fitFallbackOverlays,
    finishFallbackPlacement,
    deferredAcceptedRelationDraws,
    identityForestLightFamilies
  };
}
