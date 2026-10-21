import * as d3 from 'd3';
import { getNodeId } from '../../replay/displayIdentity.ts';
import {
  type DirectedPathPlanItem,
  type RelationPlanItem
} from '../../replay/relations/renderPlan.ts';
import { type HierNode } from '../../replay/types.ts';
import { type SyntaxNode } from '../../types.ts';
import type { ClaimDrawing, DrawingLayer, RelationEmphasis, TreeMeasurements } from './drawingContext.ts';

interface ScopeDrawingContext extends Pick<ClaimDrawing, 'relationLayerKey' | 'acceptedRelationDrawingKey' | 'queueAcceptedRelationDraw'>, Pick<TreeMeasurements, 'exactScreenTreeLabelRectNow'> {
  scheduledAcceptedPfRelations: Set<string>;
  g: DrawingLayer;
  overlayNodeById: Map<string, d3.HierarchyPointNode<SyntaxNode>>;
  labelBelongsToNode: (element: SVGGraphicsElement, id: string) => boolean;
  treeData: d3.HierarchyPointNode<SyntaxNode>;
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  containerWidth: number;
  markPreterminalLensNode: (nodeId: string, role: string) => void;
  frameItems: RelationPlanItem[];
  resolveOverlayAnchor: (nodeId: string) => d3.HierarchyPointNode<SyntaxNode> | undefined;
  isDisplayTerminalNode: (candidate: d3.HierarchyPointNode<SyntaxNode>) => boolean;
  markSubtreeLensNodes: (nodeId: string, role: string) => void;
}

export function createScopeDrawing({
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
  markPreterminalLensNode,
  frameItems,
  resolveOverlayAnchor,
  isDisplayTerminalNode,
  markSubtreeLensNodes
}: ScopeDrawingContext) {
  let scopeInformationPathLayer: DrawingLayer | null = null;
  let scopeInformationMarkLayer: DrawingLayer | null = null;
  const scheduleAcceptedScopeInformationRelation = (
    item: RelationPlanItem,
    emphasis: RelationEmphasis
  ) => {
    if (
      item.familyId !== 'cooper-storage.ledger'
      && item.familyId !== 'accord.link'
      && item.familyId !== 'accord.strong-npi'
      && item.familyId !== 'focus.f-projection'
    ) return false;
    if (item.familyId === 'accord.strong-npi') {
      if (item.kind !== 'undirected-link' || item.pairs.length !== 2) return false;
    }
    const key = relationLayerKey(item);
    const drawingKey = acceptedRelationDrawingKey(item);
    if (!scheduledAcceptedPfRelations.has(drawingKey)) {
      scheduledAcceptedPfRelations.add(drawingKey);
      queueAcceptedRelationDraw(item, emphasis, () => {
        const root = g.node();
        const matrix = root?.getScreenCTM();
        if (!root || !matrix) return;
        const inverse = matrix.inverse();
        const rectForElements = (elements: SVGGraphicsElement[]) => {
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
        const anchorElements = (nodeId: string, preferTerminal = false) => {
          const anchor = overlayNodeById.get(nodeId);
          const subtreeIds = new Set([
            nodeId,
            ...(anchor?.descendants().map((candidate) => getNodeId(candidate as unknown as HierNode)) || [])
          ]);
          const directTerminals = g.selectAll<SVGTextElement, HierNode>('.terminal-label')
            .filter(function exactScopeDirectTerminal() {
              return labelBelongsToNode(this, String(nodeId));
            })
            .nodes();
          if (preferTerminal && directTerminals.length > 0) return directTerminals;
          const subtreeTerminals = g.selectAll<SVGTextElement, HierNode>('.terminal-label')
            .filter(function exactScopeSubtreeTerminal() {
              return [...subtreeIds].some((candidateId) =>
                labelBelongsToNode(this, candidateId));
            })
            .nodes();
          if (preferTerminal && subtreeTerminals.length > 0) return subtreeTerminals;
          const categories = g.selectAll<SVGTextElement, HierNode>('.category-label')
            .filter(function exactScopeCategory() {
              return labelBelongsToNode(this, String(nodeId));
            })
            .nodes();
          if (categories.length > 0) return categories;
          const direct = g.selectAll<SVGTextElement, HierNode>('.category-label, .terminal-label')
            .filter(function exactScopeDirectLabel() {
              return labelBelongsToNode(this, String(nodeId));
            })
            .nodes();
          if (direct.length > 0) return direct;
          return g.selectAll<SVGTextElement, HierNode>('.category-label, .terminal-label')
            .filter(function exactScopeSubtreeLabel() {
              return [...subtreeIds].some((candidateId) =>
                labelBelongsToNode(this, candidateId));
            })
            .nodes();
        };
        const anchorRect = (nodeId: string, preferTerminal = false) =>
          rectForElements(anchorElements(nodeId, preferTerminal));
        const center = (rect: { x: number; y: number; width: number; height: number }) => ({
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2
        });
        const ensureLayers = () => {
          if (!scopeInformationPathLayer) {
            const pathNode = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            pathNode.setAttribute(
              'class',
              'babel-scope-information-relation-layer babel-scope-information-path-layer'
            );
            (pathNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
            const firstNodeGroup = g.select<SVGGElement>('.node-group').node();
            if (firstNodeGroup?.parentNode === root) root.insertBefore(pathNode, firstNodeGroup);
            else root.appendChild(pathNode);
            scopeInformationPathLayer = d3.select<SVGGElement, unknown>(pathNode);
          }
          if (!scopeInformationMarkLayer) {
            const markNode = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            markNode.setAttribute(
              'class',
              'babel-scope-information-relation-layer babel-scope-information-mark-layer'
            );
            (markNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
            root.appendChild(markNode);
            scopeInformationMarkLayer = d3.select<SVGGElement, unknown>(markNode);
          }
          return { path: scopeInformationPathLayer, mark: scopeInformationMarkLayer };
        };
        const { path: pathLayer, mark: markLayer } = ensureLayers();
        const quietOpacity = emphasis === 'quiet' ? 0.3 : null;
        const appendText = (
          className: string,
          x: number,
          y: number,
          value: string,
          anchor: 'start' | 'middle' | 'end' = 'start'
        ) => markLayer.append('text')
          .attr('class', className)
          .attr('x', x.toFixed(1))
          .attr('y', y.toFixed(1))
          .attr('text-anchor', anchor)
          .attr('opacity', quietOpacity)
          .text(value);
        const treeRect = exactScreenTreeLabelRectNow(
          getNodeId(treeData as unknown as HierNode),
          true
        );

        if (item.familyId === 'cooper-storage.ledger' && item.kind === 'node-plaque') {
          const content = item.nativeContent;
          if (content?.kind !== 'cooper-storage') return;
          const scope = item.anchorNodeIds[0];
          const rect = scope ? anchorRect(scope) : null;
          const svgRect = svg.node()?.getBoundingClientRect();
          if (!rect || !svgRect) return;
          const width = 420;
          const height = 12 + content.rows.length * 46;
          const preferredX = treeRect ? treeRect.x + treeRect.width + 54 : rect.x + rect.width + 54;
          const viewportRight = new DOMPoint(svgRect.right - 12, svgRect.top).matrixTransform(inverse).x;
          const x = containerWidth < 500
            ? Math.min(preferredX, viewportRight - width)
            : preferredX;
          const y = rect.y + rect.height / 2 - height / 2;
          pathLayer.append('path')
            .attr('class', 'babel-cooper-storage-connector')
            .attr('d', `M ${(rect.x + rect.width + 12).toFixed(1)} ${(rect.y + rect.height / 2).toFixed(1)} H ${(x - 14).toFixed(1)}`)
            .attr('opacity', quietOpacity);
          const plaque = markLayer.append('g')
            .attr('class', 'babel-cooper-storage-plaque')
            .attr('data-storage-stage', String(item.relationRef.stageIndex + 1))
            .attr('opacity', quietOpacity);
          plaque.append('path')
            .attr('class', 'babel-cooper-storage-bracket')
            .attr('d', `M ${x + 18} ${y} H ${x} V ${y + height} H ${x + 18}`);
          plaque.append('path')
            .attr('class', 'babel-cooper-storage-bracket')
            .attr('d', `M ${x + width - 18} ${y} H ${x + width} V ${y + height} H ${x + width - 18}`);
          content.rows.forEach(({ label, value }, index) => {
            plaque.append('text')
              .attr('class', 'babel-cooper-storage-key')
              .attr('x', (x + 34).toFixed(1))
              .attr('y', (y + 39 + index * 46).toFixed(1))
              .attr('text-anchor', 'start')
              .text(label);
            plaque.append('text')
              .attr('class', 'babel-cooper-storage-value')
              .attr('x', (x + 225).toFixed(1))
              .attr('y', (y + 39 + index * 46).toFixed(1))
              .attr('text-anchor', 'start')
              .attr('font-size', value.length > 13 ? '21' : null)
              .text(value);
          });
          return;
        }

        if (item.familyId === 'accord.link' && item.kind === 'directed-path') {
          const sourceId = item.fromNodeId;
          const goalId = item.toNodeId;
          const source = anchorRect(sourceId, true);
          const goal = anchorRect(goalId);
          if (!source || !goal) return;
          markPreterminalLensNode(sourceId, 'probe');
          const sourcePoint = center(source);
          const goalPoint = center(goal);
          const sourcePlaqueX = sourcePoint.x - 100;
          const goalPlaqueX = goalPoint.x - 58;
          const sourcePlaqueY = source.y + source.height + 58;
          const goalPlaqueY = goal.y + goal.height + 58;
          const markerId = `babel-accord-arrow-${item.relationRef.stageIndex}-${item.relationRef.relationIndex}`;
          const marker = pathLayer.append('defs').append('marker')
            .attr('id', markerId)
            .attr('viewBox', '0 0 10 10')
            .attr('refX', 8.5)
            .attr('refY', 5)
            .attr('markerUnits', 'userSpaceOnUse')
            .attr('markerWidth', 18)
            .attr('markerHeight', 18)
            .attr('orient', 'auto');
          marker.append('path').attr('class', 'babel-accord-arrowhead').attr('d', 'M 0 0 L 10 5 L 0 10 Z');
          const relationIndexValue = item.secondaryLabel || '';
          const feature = item.featureRow?.label || '';
          const value = item.featureRow?.value || '';
          const appendFeature = (x: number, y: number) => {
            markLayer.append('rect')
              .attr('class', 'babel-accord-index-box')
              .attr('x', x.toFixed(1))
              .attr('y', (y - 33).toFixed(1))
              .attr('width', 34)
              .attr('height', 34)
              .attr('opacity', quietOpacity);
            appendText(
              'babel-accord-index babel-relation-index',
              x + 17,
              y - 7,
              relationIndexValue,
              'middle'
            );
            appendText('babel-accord-feature', x + 41, y - 5, `[${feature} ${value}]`);
          };
          appendFeature(sourcePlaqueX, sourcePlaqueY);
          appendFeature(goalPlaqueX, goalPlaqueY);
          const start = { x: sourcePlaqueX + 17, y: sourcePlaqueY - 39 };
          const end = { x: goalPlaqueX + 17, y: goalPlaqueY - 39 };
          const riseY = Math.min(source.y, goal.y) - 34;
          pathLayer.append('path')
            .attr('class', 'babel-accord-path')
            .attr('marker-end', `url(#${markerId})`)
            .attr('d', [
              `M ${start.x.toFixed(1)} ${start.y.toFixed(1)}`,
              `L ${start.x.toFixed(1)} ${riseY.toFixed(1)}`,
              `L ${end.x.toFixed(1)} ${riseY.toFixed(1)}`,
              `L ${end.x.toFixed(1)} ${end.y.toFixed(1)}`
            ].join(' '))
            .attr('opacity', quietOpacity);
          return;
        }

        if (item.familyId === 'accord.strong-npi' && item.kind === 'undirected-link') {
          const [licensing, focus] = item.pairs;
          if (!licensing || !focus) return;
          const exhaustifierId = licensing.fromNodeId;
          const npiId = licensing.toNodeId;
          const onlyId = focus.fromNodeId;
          const associateId = focus.toNodeId;
          const exhaustifier = anchorRect(exhaustifierId);
          const npi = anchorRect(npiId, true);
          const only = anchorRect(onlyId, true);
          const associate = anchorRect(associateId, true);
          if (!exhaustifier || !npi || !only || !associate || !treeRect) return;
          markPreterminalLensNode(onlyId, 'focus-operator');
          const feature = item.label || '';
          const exhaustifierFeatureText = appendText(
            'babel-strong-npi-feature-mark',
            exhaustifier.x - 20,
            exhaustifier.y + exhaustifier.height + 62,
            `ℰxh[${feature}]`,
            'end'
          );
          const npiFeatureText = appendText(
            'babel-strong-npi-feature-mark',
            npi.x + npi.width + 24,
            npi.y + npi.height * 0.82,
            `NPI[${feature}]`
          );
          const focusFeatureText = appendText(
            'babel-strong-npi-focus-mark',
            associate.x + associate.width + 8,
            associate.y + associate.height * 0.82,
            'F'
          );
          const npiFeatureRect = rectForElements([npiFeatureText.node() as SVGGraphicsElement]);
          const focusFeatureRect = rectForElements([
            ...anchorElements(associateId, true),
            focusFeatureText.node() as SVGGraphicsElement
          ]);
          const exhaustifierFeatureRect = rectForElements([
            exhaustifierFeatureText.node() as SVGGraphicsElement
          ]);
          if (!npiFeatureRect || !focusFeatureRect || !exhaustifierFeatureRect) return;
          const outerStart = {
            x: exhaustifierFeatureRect.x + exhaustifierFeatureRect.width + 18,
            y: exhaustifierFeatureRect.y + exhaustifierFeatureRect.height * 0.62
          };
          const outerEnd = {
            x: npiFeatureRect.x + npiFeatureRect.width - 6,
            y: npiFeatureRect.y + npiFeatureRect.height + 38
          };
          const outerFloor = treeRect.y + treeRect.height + 150;
          const outerMiddleX = (outerStart.x + outerEnd.x) / 2;
          const outerApproachX = outerMiddleX + (outerEnd.x - outerMiddleX) * 0.62;
          pathLayer.append('path')
            .attr('class', 'babel-strong-npi-path babel-strong-npi-path-outer')
            .attr('d', [
              `M ${outerStart.x.toFixed(1)} ${outerStart.y.toFixed(1)}`,
              `C ${(outerStart.x - 180).toFixed(1)} ${(outerStart.y + 100).toFixed(1)}`,
              `${(outerStart.x - 130).toFixed(1)} ${outerFloor.toFixed(1)}`,
              `${outerMiddleX.toFixed(1)} ${outerFloor.toFixed(1)}`,
              `C ${outerApproachX.toFixed(1)} ${outerFloor.toFixed(1)}`,
              `${outerEnd.x.toFixed(1)} ${outerEnd.y.toFixed(1)}`,
              `${outerEnd.x.toFixed(1)} ${outerEnd.y.toFixed(1)}`
            ].join(' '))
            .attr('opacity', quietOpacity);
          const innerStart = { x: only.x - 18, y: only.y + only.height + 12 };
          const innerEnd = {
            x: focusFeatureRect.x + focusFeatureRect.width + 18,
            y: focusFeatureRect.y + focusFeatureRect.height * 0.62
          };
          const innerUnderY = focusFeatureRect.y + focusFeatureRect.height + 32;
          const innerFloor = Math.min(
            outerFloor - 54,
            Math.max(innerStart.y, innerEnd.y) + 118
          );
          const innerMiddleX = (innerStart.x + innerEnd.x) / 2;
          const innerApproachX = innerMiddleX + (innerEnd.x - innerMiddleX) * 0.58;
          pathLayer.append('path')
            .attr('class', 'babel-strong-npi-path babel-strong-npi-path-inner')
            .attr('d', [
              `M ${innerStart.x.toFixed(1)} ${innerStart.y.toFixed(1)}`,
              `C ${(innerStart.x - 105).toFixed(1)} ${(innerStart.y + 66).toFixed(1)}`,
              `${(innerStart.x - 70).toFixed(1)} ${innerFloor.toFixed(1)}`,
              `${innerMiddleX.toFixed(1)} ${innerFloor.toFixed(1)}`,
              `C ${innerApproachX.toFixed(1)} ${innerFloor.toFixed(1)}`,
              `${innerEnd.x.toFixed(1)} ${innerUnderY.toFixed(1)}`,
              `${innerEnd.x.toFixed(1)} ${innerEnd.y.toFixed(1)}`
            ].join(' '))
            .attr('opacity', quietOpacity);
          return;
        }

        if (item.familyId === 'focus.f-projection') {
          const hops = frameItems.filter((candidate): candidate is DirectedPathPlanItem =>
            candidate.kind === 'directed-path' && candidate.pathStyle === 'f-projection'
            && relationLayerKey(candidate) === key);
          if (!hops.length) return;
          const accentId = hops[0].fromNodeId;
          const projectionIds = hops.map((hop) => hop.toNodeId);
          const accentBearer = anchorRect(accentId, true);
          const projectionRects = projectionIds.flatMap((nodeId, index) => {
            const rect = anchorRect(nodeId, hops[index].projectionTargetAttachment === 'terminal');
            return rect ? [{ nodeId, rect }] : [];
          });
          if (!accentBearer || projectionRects.length !== projectionIds.length) return;
          markPreterminalLensNode(accentId, 'focus-target');
          const feature = hops[0].projectionFeature || '';
          appendText(
            'babel-f-projection-feature',
            accentBearer.x + accentBearer.width + 8,
            accentBearer.y + accentBearer.height * 0.82,
            feature
          );
          appendText(
            'babel-f-projection-accent',
            accentBearer.x + accentBearer.width / 2,
            accentBearer.y + accentBearer.height + 50,
            hops[0].label || '',
            'middle'
          );
          projectionRects.forEach(({ rect }) => {
            appendText(
              'babel-f-projection-feature',
              rect.x + rect.width + 7,
              rect.y + rect.height * 0.82,
              feature
            );
          });
          const markerId = `babel-f-projection-arrow-${item.relationRef.stageIndex}-${item.relationRef.relationIndex}`;
          const marker = pathLayer.append('defs').append('marker')
            .attr('id', markerId)
            .attr('viewBox', '0 0 10 10')
            .attr('refX', 8)
            .attr('refY', 5)
            .attr('markerWidth', 2.2)
            .attr('markerHeight', 2.2)
            .attr('orient', 'auto');
          marker.append('path')
            .attr('class', 'babel-f-projection-arrowhead')
            .attr('d', 'M 0 0 L 10 5 L 0 10 Z');
          const sequence = [accentBearer, ...projectionRects.map(({ rect }) => rect)];
          sequence.slice(0, -1).forEach((source, index) => {
            const target = sequence[index + 1];
            const start = { x: source.x + source.width * 0.45, y: source.y - 8 };
            const end = { x: target.x + target.width * 0.54, y: target.y + target.height + 8 };
            const bendY = (start.y + end.y) / 2;
            pathLayer.append('path')
              .attr('class', 'babel-f-projection-path')
              .attr('data-projection-from', hops[index].fromNodeId)
              .attr('data-projection-to', hops[index].toNodeId)
              .attr('marker-end', `url(#${markerId})`)
              .attr('d', [
                `M ${start.x.toFixed(1)} ${start.y.toFixed(1)}`,
                `C ${start.x.toFixed(1)} ${bendY.toFixed(1)}`,
                `${end.x.toFixed(1)} ${bendY.toFixed(1)}`,
                `${end.x.toFixed(1)} ${end.y.toFixed(1)}`
              ].join(' '))
              .attr('opacity', quietOpacity);
          });
        }
      });
    }
    return true;
  };
  const scheduleAcceptedFocusProminence = (
    item: RelationPlanItem,
    emphasis: RelationEmphasis
  ) => {
    if (item.familyId !== 'focus.prominence' || item.kind !== 'branch-emphasis') return false;
    const drawingKey = acceptedRelationDrawingKey(item);
    if (!scheduledAcceptedPfRelations.has(drawingKey)) {
      scheduledAcceptedPfRelations.add(drawingKey);
      queueAcceptedRelationDraw(item, emphasis, () => {
        const root = g.node();
        if (!root) return;
        const nativeBranchPath = (fromNodeId: string, toNodeId: string) => {
          const branch = g.selectAll<SVGPathElement, unknown>('.branch')
            .filter(function exactFocusBranch() {
              return this.getAttribute('data-source-node-id') === fromNodeId
                && this.getAttribute('data-target-node-id') === toNodeId;
            })
            .node();
          return branch?.getAttribute('d') || '';
        };
        const strongPaths = item.strongEdges.map((edge) => nativeBranchPath(
          edge.fromNodeId,
          edge.toNodeId
        ));
        const weakPaths = item.weakEdges.map((edge) => nativeBranchPath(
          edge.fromNodeId,
          edge.toNodeId
        ));
        if (strongPaths.some((path) => !path) || weakPaths.some((path) => !path)) return;

        const layerNode = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        layerNode.setAttribute('class', 'babel-focus-relation-layer');
        if (emphasis === 'quiet') layerNode.setAttribute('opacity', '0.3');
        (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
        const layer = d3.select<SVGGElement, unknown>(layerNode);
        const appendBranches = (paths: string[], kind: 'strong' | 'weak') => {
          paths.forEach((path) => {
            layer.append('path')
              .attr('class', 'babel-focus-branch-mask')
              .attr('d', path);
            layer.append('path')
              .attr('class', kind === 'strong'
                ? 'babel-focus-branch-strong'
                : 'babel-focus-branch-weak')
              .attr('d', path);
          });
        };
        appendBranches(weakPaths, 'weak');
        appendBranches(strongPaths, 'strong');
        const firstNodeGroup = g.select<SVGGElement>('.node-group').node();
        if (firstNodeGroup?.parentNode === root) root.insertBefore(layerNode, firstNodeGroup);
        else root.appendChild(layerNode);

        const focusNodeId = item.focusNodeId || '';
        const focusAnchor = resolveOverlayAnchor(focusNodeId);
        const focusTerminals = focusAnchor?.descendants()
          .filter((candidate) => isDisplayTerminalNode(candidate)) || [];
        if (focusTerminals.length > 1) markSubtreeLensNodes(focusNodeId, 'focus-target');
      });
    }
    return true;
  };
  return { scheduleAcceptedScopeInformationRelation, scheduleAcceptedFocusProminence };
}
