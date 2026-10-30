import * as d3 from 'd3';
import type { PlaquePlacement } from '../../replay/relations/plaquePlacement.ts';
import type { RelationRenderPlan } from '../../replay/relations/renderPlan.ts';
import type { TreeDirection } from '../../replay/treeLayout.ts';
import { type SyntaxNode } from '../../types.ts';
import { createBindingRefinements } from './bindingRefinements.ts';
import type { DrawingLayer } from './drawingContext.ts';
import { createPlaqueRefinements } from './plaqueRefinements.ts';
import { createRelationMeasurements } from './relationMeasurements.ts';
import { createTrajectoryRefinements } from './trajectoryRefinements.ts';

interface RelationGeometryContext {
  treeData: d3.HierarchyPointNode<SyntaxNode>;
  measureGraphicsElementsInTreeSpace: (elements: SVGGraphicsElement[]) => { x: number; y: number; width: number; height: number } | null;
  g: DrawingLayer;
  relationRenderPlan: RelationRenderPlan | null;
  activeDerivationFrameIndex: number;
  replayPlaqueLayout: Map<number, PlaquePlacement>;
  visibleNodes: d3.HierarchyPointNode<SyntaxNode>[];
  measureCategoryText: (text: string) => number;
  deferredAcceptedRelationDraws: (() => void)[];
  playedRelationIndices: Set<number> | null;
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  updateScreenStableText: (screenScale: number) => void;
  /** The tree layer's screen matrix under the settled camera (`deferredTreeMatrix`). */
  deferredTreeMatrix: () => DOMMatrix | null;
  treeDirection?: TreeDirection;
}
export function refineRelationGeometry({
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
  updateScreenStableText,
  deferredTreeMatrix,
  treeDirection = 'ltr'
}: RelationGeometryContext) {
  const treeSpace = g.node();
  // Refinement follows the fit, which paints the start of a camera transition.
  // Painted elements are measured with the live matrix; viewport clamps and
  // screen sizes use the settled one.
  const treeMatrix = treeSpace?.getScreenCTM();
  const settledTreeMatrix = deferredTreeMatrix();
  if (treeSpace && treeMatrix && settledTreeMatrix) {
    const {
      measuredSubtreeLabelRects,
      unionRects,
      measureRenderedElementsInTreeSpace,
      postFitNodeById,
      measuredShellRect,
      measuredTerminalRect,
      measuredSubtreeRect,
      operatorVariableScopeHull,
      operatorVariableScopeEnvelope,
      measuredTerminalSubtreesRect,
      measuredTreeLabelsRect,
      measuredAcceptedAnchorRect,
      measuredTrajectoryShellRect,
      measuredTrajectoryTerminalRect,
      measuredTrajectorySubtreeRect
    } = createRelationMeasurements({ treeData, g, measureGraphicsElementsInTreeSpace });
    const {
      refineControlRelation,
      refineBindingRelation,
      refineCoreferenceIndex,
      refinePredicationRelation,
      refineOperatorVariableBinding,
      refineQuantifierRaising,
      refineGappingAlignment,
      refineIdiomChunkRelation
    } = createBindingRefinements({
      postFitNodeById,
      measuredSubtreeRect,
      unionRects,
      measuredTerminalRect,
      measuredShellRect,
      measuredTerminalSubtreesRect,
      measuredAcceptedAnchorRect,
      relationRenderPlan,
      activeDerivationFrameIndex,
      replayPlaqueLayout,
      visibleNodes,
      measureCategoryText,
      measuredSubtreeLabelRects,
      operatorVariableScopeHull,
      operatorVariableScopeEnvelope,
      measuredTreeLabelsRect,
      g,
      treeMatrix,
      settledTreeMatrix,
      svg
    });
    const { refineSplitAntecedenceComposition, renderPfRealizationPlate, layoutAnalysisVerdicts } = createPlaqueRefinements({
      g,
      measuredTerminalSubtreesRect,
      playedRelationIndices,
      activeDerivationFrameIndex,
      unionRects,
      measuredShellRect,
      measuredTerminalRect,
      replayPlaqueLayout,
      svg,
      measuredTreeLabelsRect,
      measuredSubtreeRect,
      deferredTreeMatrix
    });
    const {
      refineAcrossTheBoardPaths,
      refinePhaseArc,
      refineBlockedExtractionPath,
      refineParasiticGapPath,
      refinePhillipsPathNode,
      refinePhillipsBlockedEdge,
      refineParasiticGapCoindex,
      refineSidewardPath,
      refineOrthogonalTrajectory,
      refinePhrasalPath,
      refineTerminalTrajectory,
      finalizeAcceptedTrajectoryPath
    } = createTrajectoryRefinements({
      measuredShellRect,
      measuredTerminalSubtreesRect,
      measuredSubtreeRect,
      measuredTrajectoryShellRect,
      measuredTrajectoryTerminalRect,
      g,
      measureRenderedElementsInTreeSpace,
      measuredTrajectorySubtreeRect,
      unionRects,
      laneTrajectoryPaths: () => laneTrajectoryPaths,
      direction: treeDirection
    });
    g.selectAll<SVGGElement, unknown>('.babel-control-relation-layer')
      .each(refineControlRelation);
    g.selectAll<SVGGElement, unknown>('.babel-binding-relation-layer')
      .each(refineBindingRelation);
    g.selectAll<SVGTextElement, unknown>('.babel-binding-index[data-coreference-anchor]')
      .each(refineCoreferenceIndex);

    g.selectAll<SVGGElement, unknown>('.babel-predication-relation-layer')
      .each(refinePredicationRelation);

    refineSplitAntecedenceComposition();
    deferredAcceptedRelationDraws.push(refineSplitAntecedenceComposition);
    g.selectAll<SVGPathElement, unknown>(
      '.babel-phase-arc-shadow[data-phase-node], .babel-phase-arc[data-phase-node]'
    ).each(refinePhaseArc);
    g.selectAll<SVGGElement, unknown>('.vr-item[data-operator-variable-operator]')
      .each(refineOperatorVariableBinding);
    g.selectAll<SVGGElement, unknown>('.vr-item[data-qr-pronounced]').each(refineQuantifierRaising);
    g.selectAll<SVGGElement, unknown>('.babel-gapping-alignment-layer').each(refineGappingAlignment);
    g.selectAll<SVGGElement, unknown>('.babel-pf-relation-layer').each(renderPfRealizationPlate);
    g.selectAll<SVGPathElement, unknown>('.babel-blocked-extraction-path').each(refineBlockedExtractionPath);

    const fittedSvgNode = svg.node();
    if (fittedSvgNode) {
      const liveScale = d3.zoomTransform(fittedSvgNode).k || 1;
      updateScreenStableText(liveScale);
      // Verdicts take the settled zoom: the live zoom times the settled-to-live screen scale.
      const settledScale = liveScale * Math.hypot(settledTreeMatrix.a, settledTreeMatrix.b)
        / Math.hypot(treeMatrix.a, treeMatrix.b);
      layoutAnalysisVerdicts(Number.isFinite(settledScale) && settledScale > 0 ? settledScale : liveScale);
    }
    g.selectAll<SVGGElement, unknown>('.babel-idiom-chunk-relation-layer').each(refineIdiomChunkRelation);
    g.selectAll<SVGPathElement, unknown>('.vr-trajectory-parasitic-gap').each(refineParasiticGapPath);
    g.selectAll<SVGGraphicsElement, unknown>('.babel-pg-path-node').each(refinePhillipsPathNode);
    g.selectAll<SVGGElement, unknown>('.babel-pg-island-relation-layer').each(refinePhillipsBlockedEdge);
    g.selectAll<SVGTextElement, unknown>('.babel-binding-index[data-coindex-anchor]').each(refineParasiticGapCoindex);
    refineAcrossTheBoardPaths();
    g.selectAll<SVGPathElement, unknown>('.vr-trajectory-sideward').each(refineSidewardPath);
    // Only remnant and smuggling paths run along a lane under the tree; head,
    // phrasal and roll-up paths do not take one, so they do not push it down.
    const laneTrajectoryPaths = g.selectAll<SVGPathElement, unknown>('.vr-trajectory-remnant, .vr-trajectory-smuggling').nodes();
    g.selectAll<SVGPathElement, unknown>(
      '.vr-trajectory-remnant, .vr-trajectory-roll-up, .vr-trajectory-smuggling'
    ).each(refineOrthogonalTrajectory);
    g.selectAll<SVGPathElement, unknown>('.vr-trajectory-phrasal').each(refinePhrasalPath);
    g.selectAll<SVGPathElement, unknown>(
      '.vr-trajectory-head, .vr-trajectory-lowering'
    ).each(refineTerminalTrajectory);
    g.selectAll<SVGPathElement, unknown>('.babel-trajectory-path[data-trajectory-source-attachment]')
      .each(finalizeAcceptedTrajectoryPath);
  }

}
