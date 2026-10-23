import * as d3 from 'd3';
import { getNodeId } from '../../replay/displayIdentity.ts';
import { type BoundPrimitive } from '../../replay/relations/boundGeometry.ts';
import {
  collectionAssignment,
  collectionPlaque
} from '../../replay/relations/featureComposition.ts';
import {
  blockingCrossSegments,
  dependentCaseStatePlaques,
  featureSharingPlaqueRect,
  featureSharingVinePaths,
  fongComponentArcPath,
  fongComponentLabelPoint,
  phaseArcPath,
  transferAccessLanePath,
  vineConvergence
} from '../../replay/relations/markGeometry.ts';
import {
  prepareSharedFeatureTextLayout
} from '../../replay/relations/plaqueTextLayout.ts';
import {
  planItemRelationRefs,
  type RelationPlanItem
} from '../../replay/relations/renderPlan.ts';
import {
  isNullLike,
  resolveLeafSurface
} from '../../replay/replaySurfaceNotation.ts';
import { isPronouncedHierLeaf } from '../../replay/syntaxForest.ts';
import { type HierNode } from '../../replay/types.ts';
import { type SyntaxNode } from '../../types.ts';
import type { ClaimDrawing, DrawingLayer, RelationEmphasis, RelationLayers, TreeMeasurements } from './drawingContext.ts';
import { drawPlaqueText, withPlaqueTextMeasure } from './plaqueText.ts';
interface ShapeDrawingContext extends Pick<ClaimDrawing, 'queueAcceptedRelationDraw' | 'decorateRelationElement'>, Pick<RelationLayers,
  | 'ensureAgreementCaseRelationLayer'
  | 'ensureControlRelationLayer'
  | 'acceptedRootLayerAfterNodes'
  | 'predicationRelationLayers'
  | 'acceptedLayerInHost'
  | 'blockedExtractionLayers'
  | 'idiomChunkLayers'
  | 'acceptedIslandLayer'
>, Pick<TreeMeasurements, 'measuredTreeLabelRectNow' | 'measuredTerminalSubtreeRectNow'> {
  ensureDomainLocalityLayers: () => { background: DrawingLayer; foreground: DrawingLayer; markerId: string; };
  activeDerivationFrameIndex: number;
  frameItems: RelationPlanItem[];
  treeData: d3.HierarchyPointNode<SyntaxNode>;
  renderedFeatureSharingItems: Set<number>;
  markPreterminalLensNode: (nodeId: string, role: string) => void;
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  drawCaseFeatureComposition: (assignmentIndex: number) => void;
  drawPlaqueDependencyPath: (layer: DrawingLayer, item: Extract<RelationPlanItem, { kind: "directed-path"; }>, d: string, reveal?: boolean, failureCue?: string[] | false) => void;
  overlay: DrawingLayer;
  resolveOverlayAnchor: (nodeId: string) => d3.HierarchyPointNode<SyntaxNode> | undefined;
  appendMarker: (markX: number, markY: number, treeNotation?: boolean, stackIndex?: number) => DrawingLayer;
}
export function createShapeDrawing({
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
}: ShapeDrawingContext) {
  let phaseRelationLayer: DrawingLayer | null = null;
  const drawShapePath = (primitive: Extract<BoundPrimitive, { type: 'shape-path' }>, planItem: RelationPlanItem, host: DrawingLayer, emphasis: RelationEmphasis) => {
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
        // A null position appends, as insert(type) does.
        const beforeEdgeLabel = (phase ? '.babel-transfer-edge-label' : null) as string | undefined;
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
        blockingCrossSegments(cross).forEach(({ x1, y1, x2, y2 }) => {
          foreground.append('line')
            .attr('class', 'babel-domain-locality-x-shadow')
            .attr('x1', x1.toFixed(1))
            .attr('y1', y1.toFixed(1))
            .attr('x2', x2.toFixed(1))
            .attr('y2', y2.toFixed(1))
            .attr('opacity', opacity);
          foreground.append('line')
            .attr('class', 'babel-domain-locality-x')
            .attr('x1', x1.toFixed(1))
            .attr('y1', y1.toFixed(1))
            .attr('x2', x2.toFixed(1))
            .attr('y2', y2.toFixed(1))
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
              .text(/^\d+$/.test(cycle) ? `C${cycle}` : cycle);
            if (pathItem.secondaryLabel) badge.append('text')
              .attr('class', 'babel-agree-outcome')
              .attr('x', (badgePoint.x + 38).toFixed(1))
              .attr('y', (badgePoint.y + 6).toFixed(1))
              .style('font-size', '18px')
              .text(pathItem.secondaryLabel);
            if (cycle !== '1' && previousCyclicPath?.parentNode === layer.node()) {
              layer.node()?.insertBefore(directed.node()!, previousCyclicPath);
              layer.node()?.insertBefore(badge.node()!, previousCyclicPath);
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
        const vinePaths = featureSharingVinePaths(bearerRects.map(({ rect }) => ({
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height + 22
        })), convergence, bearerRects.map(({ rect }) => rect));
        vinePaths.forEach(path => {
          layer.append('path')
            .attr('class', 'babel-feature-sharing-vine')
            .attr('opacity', opacity)
            .attr('d', path);
        });
        const content = withPlaqueTextMeasure(svg, measureText => ({
          layout: prepareSharedFeatureTextLayout(sharingItem.label, measureText),
          rect: featureSharingPlaqueRect(bearerRects.map(entry => entry.rect), sharingItem.label, measureText)
        }));
        const { x: plaqueX, y: plaqueY, width: plaqueWidth, height: plaqueHeight } = content.rect;
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
        drawPlaqueText(plaque, content.layout.row, 'babel-feature-text', { x: plaqueX, y: plaqueY });
      });
      return;
    }

    if (primitive.shapeStyle === 'case-assignment'
      || primitive.shapeStyle === 'case-agree') {
      queueAcceptedRelationDraw(planItem, emphasis, () => {
        if (planItem.kind !== 'directed-path') return;
        const assignmentIndex = planItem.pathStyle === 'case-assignment'
          ? primitive.itemIndex : collectionAssignment(frameItems, planItem);
        if (assignmentIndex !== undefined) {
          drawCaseFeatureComposition(assignmentIndex);
          return;
        }
        if (collectionPlaque(frameItems, planItem)) return;
        const layer = ensureAgreementCaseRelationLayer();
        drawPlaqueDependencyPath(layer, planItem, primitive.d);
        const target = acceptedAnchorRect(planItem.toNodeId);
        const row = planItem.featureRow;
        if (target && (row?.label || row?.value || planItem.label)) {
          layer.append('text').attr('class', 'babel-feature-text')
            .attr('x', target.x).attr('y', target.y + target.height + 36)
            .text(row ? [row.label, row.value].filter(Boolean).join(': ') : planItem.label || '');
        }
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
          && isPronouncedHierLeaf(edgeTerminal as unknown as HierNode)
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
        // A domain without a root leaves the attribute unset.
        .attr('data-extraction-domain', (domainItem?.kind === 'domain-mark' ? domainItem.rootNodeId : '') as string)
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
  };
  const drawPathNodeRing = (primitive: Extract<BoundPrimitive, { type: 'path-node-ring' }>, planItem: RelationPlanItem, emphasis: RelationEmphasis) => {

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
  };
  return { drawShapePath, drawPathNodeRing };
}
