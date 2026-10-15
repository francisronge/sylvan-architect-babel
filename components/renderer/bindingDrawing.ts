import * as d3 from 'd3';
import { getNodeId } from '../../replay/displayIdentity.ts';
import {
  bindingDomainEllipse,
  bindingDomainPlaques,
  bindingDomainTreeRect
} from '../../replay/relations/bindingDomainGeometry.ts';
import { type BoundPrimitive } from '../../replay/relations/boundGeometry.ts';
import { projectPlaqueLayout } from '../../replay/relations/plaquePlacement.ts';
import {
  planItemRelationRefs,
  type RelationPlanItem
} from '../../replay/relations/renderPlan.ts';
import {
  identityIndexAction,
  identityLabelTarget,
  treeLabelIndexAttributes
} from '../../replay/treeLabelRuns.ts';
import { type HierNode } from '../../replay/types.ts';
import { type SyntaxNode } from '../../types.ts';
import { mergeIdentityOwners } from '../identityForestLight.ts';
import type { ClaimDrawing, DrawingLayer, RelationEmphasis, RelationLayers, TreeMeasurements } from './drawingContext.ts';
import { labelBelongsToNode } from './treeMeasurements.ts';
interface BindingDrawingContext extends Pick<RelationLayers,
  | 'acceptedRootLayerBeforeNodes'
  | 'operatorVariableBindingLayers'
  | 'operatorVariableSharedPathLayers'
  | 'acceptedRootLayerAfterNodes'
  | 'bindingRelationLayers'
  | 'ensureControlRelationLayer'
  | 'coindexRelationLayers'
  | 'acceptedLayerInHost'
  | 'parasiticGapCoindexLayers'
>, Pick<ClaimDrawing, 'decorateRelationElement' | 'relationLayerKey'>, Pick<TreeMeasurements, 'measuredTreeLabelRectNow' | 'measuredTerminalSubtreeRectNow'> {
  activeDerivationFrameIndex: number;
  overlay: DrawingLayer;
  operatorVariableScopeRankByItem: Map<number, number>;
  operatorVariableScopeItems: { item: Extract<RelationPlanItem, { kind: "operator-variable-binding"; }>; itemIndex: number; }[];
  focusedRelationMoment: { stageIndex: number; relationIndex: number; };
  relationEmphasisForItem: (item: RelationPlanItem) => RelationEmphasis;
  overlayNodeById: Map<string, d3.HierarchyPointNode<SyntaxNode>>;
  frameItems: RelationPlanItem[];
  replayPlaqueLayout: ReturnType<typeof projectPlaqueLayout>;
  visibleNodes: d3.HierarchyPointNode<SyntaxNode>[];
  measureCategoryText: (text: string) => number;
  resolveOverlayAnchor: (nodeId: string) => d3.HierarchyPointNode<SyntaxNode> | undefined;
  terminalAmbiguities: Map<string, number>;
  g: DrawingLayer;
  identityTerminalOwners: Map<SVGElement, RelationPlanItem>;
  identityForestLightFamilies: { occurrencePools: string[][]; emphasis: RelationEmphasis; item: RelationPlanItem; }[];
  markIdentityLensOccurrences: (nodeIds: string[]) => void;
  TARGET_EMERALD: string;
  appendMarker: (markX: number, markY: number, treeNotation?: boolean, stackIndex?: number) => DrawingLayer;
}
export function createBindingDrawing({ activeDerivationFrameIndex, overlay,
  operatorVariableScopeRankByItem,
  acceptedRootLayerBeforeNodes,
  operatorVariableBindingLayers,
  operatorVariableScopeItems,
  focusedRelationMoment,
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
  appendMarker
}: BindingDrawingContext) {

  const drawOperatorVariableBinding = (primitive: Extract<BoundPrimitive, { type: 'operator-variable-binding' }>, planItem: RelationPlanItem, host: DrawingLayer, _emphasis: RelationEmphasis) => {
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
    if (planItem.kind === 'operator-variable-binding' && planItem.bindingPathSuppressed) return;
    let pathHost = host;
    if (planItem.kind === 'operator-variable-binding' && planItem.bindingPathRefs) {
      const pathOwner = planItem.bindingPathRefs.find(ref =>
        ref.stageIndex === focusedRelationMoment?.stageIndex
        && ref.relationIndex === focusedRelationMoment?.relationIndex) ?? planItem.relationRef;
      const pathItem = {
        ...planItem, relationRef: pathOwner, composedRefs: [],
        coalescedRefs: planItem.bindingPathRefs.filter(ref =>
          ref.stageIndex !== pathOwner.stageIndex
          || ref.relationIndex !== pathOwner.relationIndex)
      };
      // The shared path can be active while the earlier domain is quiet.
      // Separate root groups prevent inherited opacity or hover leakage.
      pathHost = acceptedRootLayerBeforeNodes(operatorVariableSharedPathLayers,
        pathItem, relationEmphasisForItem(pathItem), 'babel-operator-variable-shared-path-layer');
      for (const attr of Array.from((host.node() as SVGGElement).attributes)) {
        if (attr.name.startsWith('data-operator-variable-')) pathHost.attr(attr.name, attr.value);
      }
    }
    const markerId = `babel-operator-variable-arrow-${planItem.relationRef.stageIndex}-${planItem.relationRef.relationIndex}`;
    const marker = pathHost.append('defs').append('marker')
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

    pathHost.append('path')
      .attr('class', 'babel-operator-variable-path')
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-opacity', 0.9)
      .attr('stroke-width', 1.2)
      .attr('stroke-linecap', 'round')
      .attr('marker-end', `url(#${markerId})`)
      .attr('vector-effect', 'non-scaling-stroke');
    ['operator', 'variable'].forEach((role) => {
      pathHost.append('text')
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
  };
  const drawQuantifierRaising = (primitive: Extract<BoundPrimitive, { type: 'quantifier-raising' }>, planItem: RelationPlanItem, host: DrawingLayer, _emphasis: RelationEmphasis) => {
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
  };
  const drawDomainEllipse = (primitive: Extract<BoundPrimitive, { type: 'domain-ellipse' }>, planItem: RelationPlanItem, host: DrawingLayer, emphasis: RelationEmphasis) => {
    if (planItem.familyId === 'binding.domain' && planItem.kind === 'binding-domain') {
      const domainRect = measuredTreeLabelRectNow(planItem.domainNodeId, true);
      const domainNode = overlayNodeById.get(planItem.domainNodeId);
      const plaques = bindingDomainPlaques(domainNode?.descendants().map(node => getNodeId(node as unknown as HierNode)) ?? [],
        frameItems, replayPlaqueLayout);
      const members = new Set(domainNode?.descendants() ?? []);
      const labelRects = (nodes: typeof visibleNodes) => nodes.flatMap(node => {
        const id = getNodeId(node as unknown as HierNode);
        const rect = measuredTreeLabelRectNow(id, false)
          || (!node.children?.length ? measuredTerminalSubtreeRectNow(id) : null);
        const reserved = bindingDomainTreeRect([node as d3.HierarchyPointNode<SyntaxNode>], measureCategoryText);
        return [rect, reserved].filter((box): box is NonNullable<typeof rect> => Boolean(box));
      });
      const ellipse = domainRect ? bindingDomainEllipse(domainRect, plaques,
        labelRects(visibleNodes.filter(node => members.has(node))),
        labelRects(visibleNodes.filter(node => !members.has(node)))) : primitive;
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
        .attr('cx', ellipse.cx)
        .attr('cy', ellipse.cy)
        .attr('rx', ellipse.rx)
        .attr('ry', ellipse.ry);
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
  };
  const drawIdentityLens = (primitive: Extract<BoundPrimitive, { type: 'identity-lens' }>, planItem: RelationPlanItem, _host: DrawingLayer, emphasis: RelationEmphasis) => {
    if (primitive.index) primitive.nodeIds.forEach((nodeId) => {
      const occurrence = resolveOverlayAnchor(nodeId);
      const labelTarget = identityLabelTarget(occurrence, nodeId);
      if (labelTarget?.ambiguityCount) terminalAmbiguities.set(nodeId, labelTarget.ambiguityCount);
      const terminal = labelTarget?.kind === 'terminal';
      const labelId = labelTarget?.labelId || nodeId;
      const labels = g.selectAll<SVGTextElement, HierNode>(terminal ? '.terminal-label' : '.category-label')
        .filter(function exactIdentityLabel() { return labelBelongsToNode(this, labelId); });
      if (labels.size() !== 1) return;
      labels.each(function appendIdentityIndex() {
        const label = d3.select(this);
        if (!label.attr('data-identity-base-label')) label.attr('data-identity-base-label', this.textContent || '');
        const existing = label.selectAll<SVGTSpanElement, unknown>('.babel-identity-index')
          .filter(function sameOwnedIndex() { return this.textContent === primitive.index; });
        const indexAction = identityIndexAction(this.textContent || '', existing.nodes().map(node => node.textContent || ''), primitive.index);
        const indexElement = existing.node() || (indexAction === 'inline' ? this : label.append('tspan')
          .attr('class', 'babel-identity-index babel-relation-index')
          .attr('data-identity-anchor', nodeId)
          .each(function applyIdentityIndexStyle() {
            for (const [name, value] of Object.entries(treeLabelIndexAttributes(terminal ? 'terminal' : 'category', 'identity'))) this.setAttribute(name, value);
          })
          .text(primitive.index).node());
        if (!indexElement) return;
        const previous = identityTerminalOwners.get(indexElement);
        const refs = mergeIdentityOwners(previous ? planItemRelationRefs(previous) : [], planItemRelationRefs(planItem));
        const owner = { ...planItem, relationRef: refs[0], composedRefs: refs.slice(1), coalescedRefs: [] };
        identityTerminalOwners.set(indexElement, owner);
        decorateRelationElement(indexElement, owner, relationEmphasisForItem(owner));
      });
    });
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
          const previous = identityTerminalOwners.get(this);
          const refs = mergeIdentityOwners(previous ? planItemRelationRefs(previous) : [], planItemRelationRefs(planItem));
          const item = { ...planItem, relationRef: refs[0], composedRefs: refs.slice(1), coalescedRefs: [] };
          identityTerminalOwners.set(this, item);
          decorateRelationElement(this, item, relationEmphasisForItem(item));
        });
    }
    markIdentityLensOccurrences(primitive.nodeIds);
    return;
  };
  const drawIndexBadge = (primitive: Extract<BoundPrimitive, { type: 'index-badge' }>, planItem: RelationPlanItem, host: DrawingLayer, emphasis: RelationEmphasis) => {
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
        .attr('data-coreference-node', primitive.nodeId)
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
  };
  const drawSplitAntecedence = (primitive: Extract<BoundPrimitive, { type: 'split-antecedence' }>, planItem: Extract<RelationPlanItem, { kind: 'split-antecedence' }>, host: DrawingLayer) => {

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
  };
  return {
    drawOperatorVariableBinding,
    drawQuantifierRaising,
    drawDomainEllipse,
    drawIdentityLens,
    drawIndexBadge,
    drawSplitAntecedence
  };
}
