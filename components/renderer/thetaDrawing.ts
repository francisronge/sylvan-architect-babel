import * as d3 from 'd3';
import { getNodeId } from '../../replay/displayIdentity.ts';
import { projectPlaqueLayout, thetaGridPredicateLabel } from '../../replay/relations/plaquePlacement.ts';
import {
  prepareThetaGridTextLayout
} from '../../replay/relations/plaqueTextLayout.ts';
import {
  planItemRelationRefs,
  type NodePlaquePlanItem,
  type RelationPlanItem
} from '../../replay/relations/renderPlan.ts';
import {
  thetaLabelBase,
  thetaLabelTarget,
  treeLabelIndexAttributes
} from '../../replay/treeLabelRuns.ts';
import { type HierNode } from '../../replay/types.ts';
import { type SyntaxNode } from '../../types.ts';
import { mergeIdentityOwners } from '../identityForestLight.ts';
import type { ClaimDrawing, DrawingLayer, RelationEmphasis } from './drawingContext.ts';

import { drawPlaqueText, withPlaqueTextMeasure } from './plaqueText.ts';

interface ThetaDrawingContext extends Pick<ClaimDrawing, 'relationLayerKey' | 'acceptedRelationDrawingKey' | 'queueAcceptedRelationDraw' | 'decorateRelationElement'> {
  scheduledAcceptedPfRelations: Set<string>;
  frameItems: RelationPlanItem[];
  g: DrawingLayer;
  resolveOverlayAnchor: (nodeId: string) => d3.HierarchyPointNode<SyntaxNode> | undefined;
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  replayPlaqueLayout: ReturnType<typeof projectPlaqueLayout>;
  identityTerminalOwners: Map<SVGElement, RelationPlanItem>;
  relationEmphasisForItem: (item: RelationPlanItem) => RelationEmphasis;
}

export function createThetaDrawing({
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
}: ThetaDrawingContext) {
  const scheduleAcceptedThetaGrid = (
    item: RelationPlanItem,
    emphasis: RelationEmphasis
  ) => {
    if (item.familyId !== 'theta.grid') return false;
    const key = relationLayerKey(item);
    const drawingKey = acceptedRelationDrawingKey(item);
    if (!scheduledAcceptedPfRelations.has(drawingKey)) {
      scheduledAcceptedPfRelations.add(drawingKey);
      queueAcceptedRelationDraw(item, emphasis, () => {
        const grid = frameItems.find((candidate): candidate is NodePlaquePlanItem =>
          candidate.kind === 'node-plaque' && candidate.plaqueStyle === 'theta-grid'
          && relationLayerKey(candidate) === key);
        if (!grid?.thetaRoles?.length) return;
        const root = g.node();
        const matrix = root?.getScreenCTM();
        if (!root || !matrix) return;
        const inverse = matrix.inverse();
        const localRect = (elements: SVGGraphicsElement[]) => {
          const points = elements.flatMap((element) => {
            const rect = element.getBoundingClientRect();
            if (!rect.width && !rect.height) return [];
            return [
              new DOMPoint(rect.left, rect.top).matrixTransform(inverse),
              new DOMPoint(rect.right, rect.top).matrixTransform(inverse),
              new DOMPoint(rect.right, rect.bottom).matrixTransform(inverse),
              new DOMPoint(rect.left, rect.bottom).matrixTransform(inverse)
            ];
          });
          if (points.length === 0) return null;
          const xs = points.map((point) => point.x);
          const ys = points.map((point) => point.y);
          return {
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys)
          };
        };
        const predicateId = grid.anchorNodeIds[0];
        const predicateAnchor = resolveOverlayAnchor(predicateId);
        if (!predicateAnchor) return;
        const predicateNodeIds = new Set(
          predicateAnchor.descendants().map((candidate) => getNodeId(candidate as unknown as HierNode))
        );
        const predicateElements = g.selectAll<SVGTextElement, HierNode>('.category-label, .terminal-label')
          .filter(function exactThetaPredicate(candidate) {
            const categoryId = this.getAttribute('data-category-node-id') || '';
            const terminalId = this.getAttribute('data-node-id') || '';
            return categoryId === predicateId
              || predicateNodeIds.has(getNodeId(candidate))
              || predicateNodeIds.has(terminalId);
          })
          .nodes();
        const predicateRect = localRect(predicateElements);
        if (!predicateRect) return;
        const treeRect = localRect(
          g.selectAll<SVGGraphicsElement, HierNode>('.category-label, .terminal-label').nodes()
        );
        if (!treeRect) return;

        const roleEntries = grid.thetaRoles.flatMap(({ nodeId, index, relationRefs }, columnIndex) => {
          const anchor = resolveOverlayAnchor(nodeId);
          const terminal = anchor?.leaves().at(-1);
          return nodeId && terminal
            ? [{
              columnIndex,
              relationRefs,
              index,
              nodeId,
              terminalId: getNodeId(terminal as unknown as HierNode)
            }]
            : [];
        });
        if (roleEntries.length === 0) return;
        const gridLayout = withPlaqueTextMeasure(svg, measureText =>
          prepareThetaGridTextLayout(thetaGridPredicateLabel(predicateAnchor), grid.thetaRoles, { measureText }));
        const layer = g.append('g')
          .attr('class', 'babel-theta-relation-layer')
          .attr('data-vr-stage-index', item.relationRef.stageIndex);
        const layerNode = layer.node();
        if (layerNode) {
          (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
        }
        const { width: plateWidth, height: plateHeight, predicateWidth: leftColumnWidth } = gridLayout;
        const plateOrigin = replayPlaqueLayout.get(frameItems.indexOf(grid));
        if (!plateOrigin) return;
        const plate = layer.append('g').attr('class', 'babel-theta-grid-plate');
        const chrome = plate.append('g').attr('class', 'babel-theta-grid-chrome');
        decorateRelationElement(chrome.node()!, grid, emphasis);
        chrome.append('rect')
          .attr('class', 'babel-theta-grid-shell')
          .attr('x', plateOrigin.x.toFixed(1))
          .attr('y', plateOrigin.y.toFixed(1))
          .attr('width', plateWidth.toFixed(1))
          .attr('height', plateHeight.toFixed(1))
          .attr('rx', 12);
        chrome.append('text')
          .attr('class', 'babel-theta-grid-title')
          .attr('x', (plateOrigin.x + 16).toFixed(1))
          .attr('y', (plateOrigin.y + 27).toFixed(1))
          .text('θ GRID');
        chrome.append('line')
          .attr('class', 'babel-theta-grid-rule')
          .attr('x1', (plateOrigin.x + 16).toFixed(1))
          .attr('x2', (plateOrigin.x + plateWidth - 16).toFixed(1))
          .attr('y1', (plateOrigin.y + 39).toFixed(1))
          .attr('y2', (plateOrigin.y + 39).toFixed(1));
        drawPlaqueText(chrome, gridLayout.predicate, 'babel-theta-grid-predicate', plateOrigin);
        chrome.append('line')
          .attr('class', 'babel-theta-grid-rule')
          .attr('x1', (plateOrigin.x + leftColumnWidth).toFixed(1))
          .attr('x2', (plateOrigin.x + leftColumnWidth).toFixed(1))
          .attr('y1', (plateOrigin.y + 47).toFixed(1))
          .attr('y2', (plateOrigin.y + plateHeight - 13).toFixed(1));
        roleEntries.forEach((role) => {
          const column = gridLayout.columns[role.columnIndex];
          const rowOwner = role.relationRefs?.length ? {
            ...grid, relationRef: role.relationRefs[0],
            composedRefs: role.relationRefs.slice(1), coalescedRefs: []
          } : grid;
          const row = plate.append('g').attr('class', 'babel-theta-grid-column');
          decorateRelationElement(row.node()!, rowOwner, null);
          const left = plateOrigin.x + column.left;
          if (role.columnIndex > 0) {
            row.append('line')
              .attr('class', 'babel-theta-grid-rule')
              .attr('x1', left.toFixed(1))
              .attr('x2', left.toFixed(1))
              .attr('y1', (plateOrigin.y + 47).toFixed(1))
              .attr('y2', (plateOrigin.y + plateHeight - 13).toFixed(1));
          }
          drawPlaqueText(row, column.label, 'babel-theta-grid-role', plateOrigin)
            .attr('text-anchor', 'middle');
          drawPlaqueText(row, column.index, 'babel-theta-grid-index babel-relation-index', plateOrigin)
            .attr('text-anchor', 'middle');

          const roleAnchor = resolveOverlayAnchor(role.nodeId);
          const labelTarget = thetaLabelTarget(roleAnchor, role.nodeId);
          const roleIsEntirelyTraces = labelTarget?.kind === 'category';
          const indexedLabel = roleIsEntirelyTraces
            ? g.selectAll<SVGTextElement, HierNode>('.category-label')
              .filter(function exactThetaTraceOccurrence() {
                return this.getAttribute('data-category-node-id') === role.nodeId;
              })
            : g.selectAll<SVGTextElement, HierNode>('.terminal-label')
              .filter(function exactThetaIndexTarget(candidate) {
                return getNodeId(candidate as unknown as HierNode) === role.terminalId
                  || this.getAttribute('data-node-id') === role.terminalId;
              });
          indexedLabel.each(function appendThetaIndex() {
            const label = d3.select(this);
            const identityIndices = label.selectAll<SVGTSpanElement, unknown>('.babel-identity-index').nodes();
            const baseLabel = thetaLabelBase(label.attr('data-identity-base-label'), label.attr('data-default-label'), this.textContent || '');
            label.text(baseLabel)
              .classed('babel-theta-indexed-label', true)
              .attr('data-theta-base-label', baseLabel);
            identityIndices.forEach(index => this.appendChild(index));
            const sharedIndex = identityIndices.find(index => index.textContent === role.index);
            const terminalIndex = sharedIndex ? d3.select(sharedIndex) : label.append('tspan')
              .attr('class', 'babel-theta-terminal-index babel-relation-index')
              .each(function applyThetaIndexStyle() {
                for (const [name, value] of Object.entries(treeLabelIndexAttributes(roleIsEntirelyTraces ? 'category' : 'terminal', 'theta'))) this.setAttribute(name, value);
              })
              .text(role.index || '');
            if (sharedIndex) {
              const previous = identityTerminalOwners.get(sharedIndex);
              const refs = mergeIdentityOwners(previous ? planItemRelationRefs(previous) : [], planItemRelationRefs(rowOwner));
              const owner = { ...rowOwner, relationRef: refs[0], composedRefs: refs.slice(1), coalescedRefs: [] };
              terminalIndex.classed('babel-theta-terminal-index', true);
              identityTerminalOwners.set(sharedIndex, owner);
              decorateRelationElement(sharedIndex, owner, relationEmphasisForItem(owner));
            } else decorateRelationElement(terminalIndex.node()!, rowOwner, null);
          });
        });
      });
    }
    return true;
  };
  return { scheduleAcceptedThetaGrid };
}
