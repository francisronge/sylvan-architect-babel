import * as d3 from 'd3';
import {
  type RelationPlanItem
} from '../../replay/relations/renderPlan.ts';
import type { ClaimDrawing, DrawingLayer, RelationEmphasis } from './drawingContext.ts';

interface RelationLayersContext extends Pick<ClaimDrawing, 'relationLayerKey' | 'decorateRelationElement'> {
  activeDerivationFrameIndex: number;
  g: DrawingLayer;
  overlay: DrawingLayer;
}
export function createRelationLayers({ activeDerivationFrameIndex, relationLayerKey, g, decorateRelationElement, overlay }: RelationLayersContext) {
  let trajectoryRelationLayer: DrawingLayer | null = null;
  const trajectoryMarkerIds = {
    open: `babel-trajectory-arrow-${activeDerivationFrameIndex}`,
    movement: `babel-production-arrow-${activeDerivationFrameIndex}`,
    carrier: `babel-carrier-arrow-${activeDerivationFrameIndex}`
  };
  const pairMergeLayers = new Map<string, DrawingLayer>();
  const controlRelationLayers = new Map<string, DrawingLayer>();
  const bindingRelationLayers = new Map<string, DrawingLayer>();
  const coindexRelationLayers = new Map<string, DrawingLayer>();
  const operatorVariableBindingLayers = new Map<string, DrawingLayer>();
  const operatorVariableSharedPathLayers = new Map<string, DrawingLayer>();
  const predicationRelationLayers = new Map<string, DrawingLayer>();
  let featureRelationLayer: DrawingLayer | null = null;
  let agreementCaseRelationLayer: DrawingLayer | null = null;
  const blockedExtractionLayers = new Map<string, DrawingLayer>();
  const idiomChunkLayers = new Map<string, DrawingLayer>();
  const parasiticGapIslandLayers = new Map<string, DrawingLayer>();
  const parasiticGapCoindexLayers = new Map<string, DrawingLayer>();
  const acceptedLayerInHost = (
    layers: Map<string, DrawingLayer>,
    item: RelationPlanItem,
    className: string,
    host: DrawingLayer
  ) => {
    const key = relationLayerKey(item);
    const existing = layers.get(key);
    if (existing) return existing;
    const layer = host.append('g').attr('class', className);
    layers.set(key, layer);
    return layer;
  };
  const acceptedRootLayerBeforeNodes = (
    layers: Map<string, DrawingLayer>,
    item: RelationPlanItem,
    emphasis: RelationEmphasis,
    className: string,
    ordersOwnedHosts = false
  ) => {
    const key = relationLayerKey(item);
    const existing = layers.get(key);
    if (existing) return existing;
    const root = g.node();
    const layerNode = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    layerNode.setAttribute('class', className);
    // A layer that only orders hosts carrying their own claims is not itself a
    // relation element, so emphasis dims each host once rather than the layer too.
    if (!ordersOwnedHosts) {
      decorateRelationElement(layerNode, item, emphasis);
      (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
      if (emphasis === 'quiet') layerNode.setAttribute('opacity', '0.3');
    }
    const firstNodeGroup = g.select<SVGGElement>('.node-group').node();
    if (root && firstNodeGroup?.parentNode === root) root.insertBefore(layerNode, firstNodeGroup);
    else root?.appendChild(layerNode);
    const layer = d3.select<SVGGElement, unknown>(layerNode);
    layers.set(key, layer);
    return layer;
  };
  const acceptedRootLayerAfterNodes = (
    layers: Map<string, DrawingLayer>,
    item: RelationPlanItem,
    emphasis: RelationEmphasis,
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
    emphasis: RelationEmphasis
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
    emphasis: RelationEmphasis
  ) => acceptedRootLayerBeforeNodes(
    parasiticGapIslandLayers,
    item,
    emphasis,
    'babel-island-relation-layer babel-pg-island-relation-layer'
  );
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
  return {
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
  };
}
