import * as d3 from 'd3';
import { getNodeId } from '../../replay/displayIdentity.ts';
import { ghostLensPresentation } from '../../replay/relations/authoredSilence.ts';
import {
  type RelationPlanItem
} from '../../replay/relations/renderPlan.ts';
import { type HierNode } from '../../replay/types.ts';
import { type SyntaxNode } from '../../types.ts';
import type { ClaimDrawing, DrawingLayer, RelationEmphasis, TreeMeasurements } from './drawingContext.ts';
import { decorateRelationElement } from './relationOwnership.ts';
import { labelBelongsToNode } from './treeMeasurements.ts';
import { appendOverlayMarker } from './treeNotation.ts';

interface CopyDrawingsContext extends Pick<ClaimDrawing, 'decorateRelationElement'>, Pick<TreeMeasurements, 'exactScreenTreeLabelRectNow' | 'measuredTreeLabelRectNow' | 'measuredShellBottom' | 'measuredShellTop'> {
  acceptedEnclosureRequests: { nodeId: string; licence: "remnant-landing" | "carrier-chunk" | "copy-occurrence"; emphasis: RelationEmphasis; item: RelationPlanItem; }[];
  deferredAcceptedRelationDraws: (() => void)[];
  g: DrawingLayer;
  acceptedPartialCopyStrikeRequests: { nodeId: string; emphasis: RelationEmphasis; item: RelationPlanItem; }[];
  acceptedDeletionTerminalStrikeRequests: { domainNodeId: string; emphasis: RelationEmphasis; item: RelationPlanItem; }[];
  resolveOverlayAnchor: (nodeId: string) => d3.HierarchyPointNode<SyntaxNode> | undefined;
  measureGraphicsElementsInTreeSpace: (elements: SVGGraphicsElement[]) => { x: number; y: number; width: number; height: number; } | null;
  acceptedParasiticGapCopyRequests: { contentNodeId: string; ordinaryGapNodeId: string; parasiticGapNodeIds: string[]; emphasis: RelationEmphasis; item: RelationPlanItem; }[];
}
export function queueCopyDrawings({
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
}: CopyDrawingsContext) {
  const relationEmphasisRank = (state: RelationEmphasis): number =>
    state === 'active' ? 2 : state === null ? 1 : 0;
  if (acceptedEnclosureRequests.length > 0) {
    deferredAcceptedRelationDraws.push(() => {
      const requestByKey = new Map<string, {
        nodeId: string;
        licence: 'remnant-landing' | 'carrier-chunk' | 'copy-occurrence';
        emphasis: RelationEmphasis;
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
        const junction = appendOverlayMarker(layer, Number(fork.x.toFixed(1)), Number(fork.y.toFixed(1)));
        junction.append('circle')
          .attr('class', 'babel-pg-copy-ring-shadow')
          .attr('data-copy-fork-junction', 'true')
          .attr('cx', 0)
          .attr('cy', 0)
          .attr('r', 9);
        junction.append('circle')
          .attr('class', 'babel-pg-copy-ring')
          .attr('data-copy-fork-junction', 'true')
          .attr('cx', 0)
          .attr('cy', 0)
          .attr('r', 6.5);
        const firstNode = g.select<SVGGElement>('.node-group').node();
        if (firstNode && layerNode) g.node()?.insertBefore(layerNode, firstNode);
      });
    });
  }

}

/** Resolve shared authored-silence ink after all claims have registered their owners. */
export function paintGhostLenses(g: DrawingLayer, ghostLensRequests: Array<{
  nodeIds: string[];
  siteNodeIds: string[];
  antecedentNodeIds: string[];
  emphasis: RelationEmphasis;
  acceptedEllipsisStyle: boolean;
  item: RelationPlanItem;
}>) {
  const ghostEmphasisByNode = new Map<string, RelationEmphasis>();
  const acceptedEllipsisGhostNodes = new Set<string>();
  const acceptedEllipsisSiteNodes = new Set<string>();
  const acceptedEllipsisAntecedentNodes = new Set<string>();
  const ghostRank = (state: RelationEmphasis): number =>
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
        // A null filter removes the style.
        .style('filter', presentation.filter as string);
    }
  });
}
