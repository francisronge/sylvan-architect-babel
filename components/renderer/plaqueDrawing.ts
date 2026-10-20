import * as d3 from 'd3';
import { getNodeId } from '../../replay/displayIdentity.ts';
import type { BoundFrame } from '../../replay/relations/boundGeometry.ts';
import { type BoundPrimitive } from '../../replay/relations/boundGeometry.ts';
import {
  collectionPlaque,
  featurePlaqueAssignment,
  featureRowKey,
  pathFeatureRow
} from '../../replay/relations/featureComposition.ts';
import {
  blockingCrossSegments,
  checkMarkPath
} from '../../replay/relations/markGeometry.ts';
import {
  featureCollectionPlaquePath
} from '../../replay/relations/overlayGeometry.ts';
import { projectPlaqueLayout } from '../../replay/relations/plaquePlacement.ts';
import {
  reservePlaqueViewport
} from '../../replay/relations/plaqueTextLayout.ts';
import {
  type RelationPlanItem
} from '../../replay/relations/renderPlan.ts';
import {
  isDisplayTraceLabel,
  resolveLeafSurface
} from '../../replay/replaySurfaceNotation.ts';
import { type HierNode } from '../../replay/types.ts';
import { type SyntaxNode } from '../../types.ts';
import { coalesceCollectionPaths, collectionPathAttachment } from '../collectionPaths.ts';
import { appendPlaqueContent } from '../plaqueViewport.ts';
import type { ClaimDrawing, DrawingLayer, RelationEmphasis, RelationLayers, TreeMeasurements } from './drawingContext.ts';
import { drawPlaqueText } from './plaqueText.ts';
interface PlaqueDrawingContext extends Pick<ClaimDrawing, 'queueAcceptedRelationDraw'>, Pick<RelationLayers, 'ensureFeatureRelationLayer' | 'acceptedLayerInHost' | 'idiomChunkLayers' | 'parasiticGapCoindexLayers'>, Pick<TreeMeasurements, 'measuredTerminalSubtreeRectNow' | 'measuredTreeLabelRectNow'> {
  g: DrawingLayer;
  frameItems: RelationPlanItem[];
  drawCaseFeatureComposition: (assignmentIndex: number) => void;
  replayPlaqueLayout: ReturnType<typeof projectPlaqueLayout>;
  revealedItemIndices: Set<number>;
  drawPlaqueDependencyPath: (layer: DrawingLayer, item: Extract<RelationPlanItem, { kind: "directed-path"; }>, d: string, reveal?: boolean, failureCue?: string[] | false) => void;
  resolveOverlayAnchor: (nodeId: string) => d3.HierarchyPointNode<SyntaxNode> | undefined;
  markPreterminalLensNode: (nodeId: string, role: string) => void;
  renderedBoundaryCutItems: Set<number>;
  boundFrame: BoundFrame;
  markSubtreeLensNodes: (nodeId: string, role: string) => void;
  appendMarker: (markX: number, markY: number, treeNotation?: boolean, stackIndex?: number) => DrawingLayer;
}
export function createPlaqueDrawing({
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
  parasiticGapCoindexLayers,
  appendMarker
}: PlaqueDrawingContext) {

  const drawPlaque = (primitive: Extract<BoundPrimitive, { type: 'plaque' }>, planItem: RelationPlanItem, host: DrawingLayer, emphasis: RelationEmphasis) => {
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
        const assignmentIndex = featurePlaqueAssignment(frameItems, primitive.itemIndex);
        if (assignmentIndex !== undefined) {
          drawCaseFeatureComposition(assignmentIndex);
          return;
        }
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
        const collections = frameItems.flatMap((candidate, candidateIndex) => {
          if (candidate.kind !== 'directed-path' || candidate.pathStyle !== 'case-agree'
            || !revealedItemIndices.has(candidateIndex)
            || collectionPlaque(frameItems, candidate)?.index !== primitive.itemIndex) return [];
          const rowIndex = primitive.rows.findIndex(row => featureRowKey(row) === featureRowKey(pathFeatureRow(candidate)));
          const row = layout.rows.find(row => row.rowIndex === rowIndex);
          const sourceRect = measuredTreeLabelRectNow(candidate.toNodeId, false)
            || measuredTerminalSubtreeRectNow(candidate.toNodeId);
          if (!row?.lines.length || !sourceRect) return [];
          const first = row.lines[0], last = row.lines[row.lines.length - 1];
          const rowY = origin.y + (first.y - first.ascent + last.y + last.descent) / 2;
          const attachment = collectionPathAttachment(origin, candidate);
          return [{
            item: candidate, d: featureCollectionPlaquePath({ ...origin, width: plaqueWidth, height: plaqueHeight },
              rowY, sourceRect, 0, attachment?.edge, attachment?.portX)
          }];
        });
        coalesceCollectionPaths(collections).forEach(({ item, d, failureCue }) => {
          drawPlaqueDependencyPath(layer, item, d, true, failureCue);
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
  };
  const drawTextBadge = (primitive: Extract<BoundPrimitive, { type: 'text-badge' }>, planItem: RelationPlanItem, host: DrawingLayer, emphasis: RelationEmphasis) => {
    if (primitive.badgeStyle === 'local-judgment') {
      const marker = host.append('g')
        .attr('class', 'babel-local-judgment')
        .attr('data-judgment-anchor', primitive.nodeId)
        // Without an outcome, d3 leaves the attribute unset.
        .attr('data-judgment-outcome', primitive.outcome as string)
        .attr('transform', `translate(${primitive.x},${primitive.y})`);
      if (primitive.outcome === 'blocked') {
        blockingCrossSegments({ x: 0, y: 0 }).forEach(({ x1, y1, x2, y2 }) => {
          for (const className of ['babel-domain-locality-x-shadow', 'babel-domain-locality-x']) {
            marker.append('line').attr('class', className)
              .attr('x1', x1).attr('y1', y1).attr('x2', x2).attr('y2', y2);
          }
        });
      } else if (primitive.outcome === 'licensed') {
        for (const className of ['babel-domain-locality-check-shadow', 'babel-domain-locality-check']) {
          marker.append('path').attr('class', className).attr('d', checkMarkPath({ x: 0, y: 0 }, 13));
        }
      }
      return;
    }
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
  };
  const drawAnalysisVerdict = (primitive: Extract<BoundPrimitive, { type: 'analysis-verdict' }>, _planItem: RelationPlanItem, host: DrawingLayer, _emphasis: RelationEmphasis) => {
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
  };
  return { drawPlaque, drawTextBadge, drawAnalysisVerdict };
}
