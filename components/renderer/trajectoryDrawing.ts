import * as d3 from 'd3';
import { type BoundPrimitive } from '../../replay/relations/boundGeometry.ts';
import {
  type RelationPlanItem,
  trajectorySourceNodeId
} from '../../replay/relations/renderPlan.ts';
import type { DrawingLayer, RelationEmphasis, RelationLayers } from './drawingContext.ts';
interface TrajectoryDrawingContext extends Pick<RelationLayers,
  | 'acceptedRootLayerBeforeNodes'
  | 'pairMergeLayers'
  | 'acceptedLayerInHost'
  | 'blockedExtractionLayers'
  | 'ensureTrajectoryRelationLayer'
  | 'trajectoryMarkerIds'
> {
  sampleNativeBranchOverlay: (targetNodeId: string) => { d: string; sourceNodeId: string; targetNodeId: string; } | null;
  markPreterminalLensNode: (nodeId: string, role: string) => void;
  clearMovedCopyClassForAnchors: (nodeIds: string[]) => void;
}
export function createTrajectoryDrawing({
  sampleNativeBranchOverlay,
  acceptedRootLayerBeforeNodes,
  pairMergeLayers,
  acceptedLayerInHost,
  blockedExtractionLayers,
  markPreterminalLensNode,
  clearMovedCopyClassForAnchors,
  ensureTrajectoryRelationLayer,
  trajectoryMarkerIds
}: TrajectoryDrawingContext) {

  const drawNativeBranchOverlay = (primitive: Extract<BoundPrimitive, { type: 'native-branch-overlay' }>, planItem: RelationPlanItem, host: DrawingLayer, emphasis: RelationEmphasis) => {
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
  };
  const drawTrajectoryPath = (primitive: Extract<BoundPrimitive, { type: 'trajectory-path' }>, planItem: RelationPlanItem, host: DrawingLayer, _emphasis: RelationEmphasis) => {
    /*
     * The compiled plan is the one semantic authority for authored
     * trajectories: every instance draws here, per-instance, with the
     * production movement styling and a deterministic fan for
     * coincident routes. The Lab movement overlay is gated off for
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
      .attr('data-trajectory-source-anchor', trajectoryPlanItem ? trajectorySourceNodeId(trajectoryPlanItem) : null)
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
      .attr('data-trajectory-bow', primitive.bowSide ? String(primitive.bowSide) : null)
      .attr(
        'marker-end',
        trajectoryPlanItem?.outcome === 'blocked' ? null : `url(#${primitive.trajectoryKind === 'smuggling'
          ? trajectoryMarkerIds.carrier
          : (usesBabelMovementCurve ? trajectoryMarkerIds.movement : trajectoryMarkerIds.open)})`
      )
      // Paint the bound route first; trajectoryRefinements attaches it to measured glyphs after fitting.
      .attr('d', primitive.d));
    return;
  };
  return { drawNativeBranchOverlay, drawTrajectoryPath };
}
