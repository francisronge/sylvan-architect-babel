import * as d3 from 'd3';
import { getNodeId } from '../../replay/displayIdentity.ts';
import {
  bindingDomainEllipse,
  bindingDomainPlaques,
  bindingDomainTreeRect
} from '../../replay/relations/bindingDomainGeometry.ts';
import {
  idiomDomainBracketPath,
  operatorBindingIndexPoint
} from '../../replay/relations/markGeometry.ts';
import type { PlaquePlacement } from '../../replay/relations/plaquePlacement.ts';
import { predicationPaths } from '../../replay/relations/predicationGeometry.ts';
import type { RelationRenderPlan } from '../../replay/relations/renderPlan.ts';
import { type HierNode } from '../../replay/types.ts';
import { type SyntaxNode } from '../../types.ts';
import type { DrawingLayer, RelationMeasurements } from './drawingContext.ts';
import { labelBelongsToNode } from './treeMeasurements.ts';
interface BindingRefinementsContext extends Pick<RelationMeasurements,
  | 'postFitNodeById'
  | 'measuredSubtreeRect'
  | 'unionRects'
  | 'measuredTerminalRect'
  | 'measuredShellRect'
  | 'measuredTerminalSubtreesRect'
  | 'measuredAcceptedAnchorRect'
  | 'measuredSubtreeLabelRects'
  | 'operatorVariableScopeHull'
  | 'operatorVariableScopeEnvelope'
  | 'measuredTreeLabelsRect'
> {
  relationRenderPlan: RelationRenderPlan | null;
  activeDerivationFrameIndex: number;
  replayPlaqueLayout: Map<number, PlaquePlacement>;
  visibleNodes: d3.HierarchyPointNode<SyntaxNode>[];
  measureCategoryText: (text: string) => number;
  g: DrawingLayer;
  treeMatrix: DOMMatrix;
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
}
export function createBindingRefinements({
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
  svg
}: BindingRefinementsContext) {
  const measuredPredicationRect = (nodeId: string) => {
    const structural = postFitNodeById.get(nodeId);
    const isPhrase = Boolean(structural && /P$/.test(String(structural.data.label || '')));
    if (isPhrase) return measuredSubtreeRect(nodeId);
    return unionRects(
      [measuredTerminalRect(nodeId), measuredShellRect(nodeId)]
        .filter((rect): rect is NonNullable<typeof rect> => Boolean(rect))
    );
  };
  const refineControlRelation = function refineControlRelation() {
    const layer = d3.select(this);
    const domain = layer.select<SVGRectElement>('.babel-control-domain');
    const path = layer.select<SVGPathElement>('.babel-control-dependency');
    const domainNodeId = domain.empty() ? '' : domain.attr('data-control-domain');
    const controllerNodeId = path.attr('data-control-controller');
    const controlleeNodeId = path.attr('data-control-controllee');
    const domainRect = domainNodeId ? measuredTerminalSubtreesRect([domainNodeId])
      || measuredSubtreeRect(domainNodeId) : null;
    const controllerRect = measuredAcceptedAnchorRect(controllerNodeId);
    const controlleeRect = measuredAcceptedAnchorRect(controlleeNodeId);
    if (!controllerRect || !controlleeRect || (domainNodeId && !domainRect)) return;
    const domainBox = domainRect ? {
      x: domainRect.x - 34,
      y: domainRect.y - 26,
      width: domainRect.width + 68,
      height: domainRect.height + 52
    } : null;
    if (domainBox) domain
      .attr('x', domainBox.x.toFixed(1))
      .attr('y', domainBox.y.toFixed(1))
      .attr('width', domainBox.width.toFixed(1))
      .attr('height', domainBox.height.toFixed(1))
      .attr('rx', 3)
      .attr('data-control-domain', null);
    const controller = {
      x: controllerRect.x + controllerRect.width / 2,
      y: controllerRect.y + controllerRect.height / 2
    };
    const controllee = {
      x: controlleeRect.x + controlleeRect.width / 2,
      y: controlleeRect.y + controlleeRect.height / 2
    };
    const dependencySource = {
      x: domainBox ? Math.max(domainBox.x + 12, Math.min(domainBox.x + domainBox.width - 12, controllee.x)) : controllee.x,
      y: domainBox ? domainBox.y : controlleeRect.y - 12
    };
    const elbowY = Math.max(
      controller.y + 128,
      Math.min(controllee.y - 92, controller.y + Math.abs(controllee.y - controller.y) * 0.58)
    );
    const controllerApproach = controllerRect.y + controllerRect.height + 40;
    path
      .attr('d', [
        `M ${dependencySource.x.toFixed(1)} ${dependencySource.y.toFixed(1)}`,
        `L ${dependencySource.x.toFixed(1)} ${elbowY.toFixed(1)}`,
        `L ${controller.x.toFixed(1)} ${elbowY.toFixed(1)}`,
        `L ${controller.x.toFixed(1)} ${controllerApproach.toFixed(1)}`
      ].join(' '))
      .attr('data-control-controller', null)
      .attr('data-control-controllee', null);
    layer.selectAll<SVGTextElement, unknown>('.babel-control-index')
      .each(function refineControlIndex() {
        const badge = d3.select(this);
        const rect = measuredAcceptedAnchorRect(badge.attr('data-control-anchor'));
        if (!rect) return;
        badge
          .attr('x', (rect.x + rect.width + 12).toFixed(1))
          .attr('y', (rect.y + rect.height / 2 + 30).toFixed(1))
          .attr('data-control-anchor', null);
      });
  };
  const refineBindingRelation = function refineBindingRelation() {
    const layer = d3.select(this);
    const domain = layer.select<SVGEllipseElement>('.babel-binding-domain');
    const domainId = domain.attr('data-binding-domain');
    const domainRect = measuredSubtreeRect(domainId);
    if (domainRect) {
      const domainNode = postFitNodeById.get(domainId);
      const plaques = bindingDomainPlaques(domainNode?.descendants().map(node => getNodeId(node as unknown as HierNode)) ?? [],
        relationRenderPlan?.frames[activeDerivationFrameIndex]?.items ?? [], replayPlaqueLayout);
      const members = new Set(domainNode?.descendants() ?? []);
      const excluded = visibleNodes.filter(node => !members.has(node)).flatMap(node => {
        const id = getNodeId(node as unknown as HierNode);
        const rect = measuredShellRect(id) || (!node.children?.length ? measuredTerminalRect(id) : null);
        const reserved = bindingDomainTreeRect([node as d3.HierarchyPointNode<SyntaxNode>], measureCategoryText);
        return [rect, reserved].filter((box): box is NonNullable<typeof rect> => Boolean(box));
      });
      // At a tiny fit scale Chromium can underreport a glyph's ink box.
      // Keep the normal font envelope so zoom cannot expose that clipped ink.
      const reserved = visibleNodes.filter(node => members.has(node)).flatMap(node =>
        bindingDomainTreeRect([node as d3.HierarchyPointNode<SyntaxNode>], measureCategoryText) ?? []);
      const ellipse = bindingDomainEllipse(domainRect, plaques, [...measuredSubtreeLabelRects(domainId), ...reserved], excluded);
      domain
        .attr('cx', ellipse.cx.toFixed(1))
        .attr('cy', ellipse.cy.toFixed(1))
        .attr('rx', ellipse.rx.toFixed(1))
        .attr('ry', ellipse.ry.toFixed(1))
        .attr('data-binding-domain', null);
    }
    layer.selectAll<SVGTextElement, unknown>('.babel-binding-index[data-binding-anchor]')
      .each(function refineBindingIndex() {
        const badge = d3.select(this);
        const rect = measuredAcceptedAnchorRect(badge.attr('data-binding-anchor'));
        if (!rect) return;
        badge
          .attr('x', (rect.x + rect.width + 12).toFixed(1))
          .attr('y', (rect.y + rect.height / 2 + 30).toFixed(1))
          .attr('data-binding-anchor', null);
      });
  };
  const refineCoreferenceIndex = function refineCoreferenceIndex() {
    const badge = d3.select(this);
    const rect = measuredAcceptedAnchorRect(badge.attr('data-coreference-anchor'));
    if (!rect) return;
    badge
      .attr('x', (rect.x + rect.width + 12).toFixed(1))
      .attr('y', (rect.y + rect.height / 2 + 30).toFixed(1))
      .attr('data-coreference-anchor', null);
  };
  const refinePredicationRelation = function refinePredicationRelation() {
    const layer = d3.select(this);
    const paths = layer.selectAll<SVGPathElement, unknown>('.babel-predication-path').nodes();
    const pairs = paths.map(path => ({
      fromNodeId: path.getAttribute('data-predicand') || '',
      toNodeId: path.getAttribute('data-predicate') || ''
    }));
    predicationPaths(pairs, measuredPredicationRect).forEach(({ pairIndex, points }) => {
      const path = paths[pairIndex];
      d3.select(path).attr('d', points.map((point, index) =>
        `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' '));
      layer.node()?.appendChild(path);
    });
  };
  const refineOperatorVariableBinding = function refineOperatorVariableBinding() {
    const host = d3.select(this);
    const operatorRect = measuredShellRect(host.attr('data-operator-variable-operator'));
    const variableNodeId = host.attr('data-operator-variable-variable');
    const witnessNodeId = host.attr('data-operator-variable-witness');
    const variableRect = (witnessNodeId ? measuredTerminalRect(witnessNodeId) : null)
      || measuredAcceptedAnchorRect(variableNodeId);
    if (!operatorRect || !variableRect) return;

    const rank = Number(host.attr('data-operator-variable-rank')) || 0;
    const scopeCount = Math.max(1, Number(host.attr('data-operator-variable-count')) || 1);
    const domainNodeId = host.attr('data-operator-variable-domain');
    const hull = domainNodeId ? operatorVariableScopeHull(domainNodeId, rank) : null;
    if (domainNodeId && !hull) return;
    if (hull) {
      host.select<SVGPathElement>('.babel-operator-variable-domain')
        .attr('d', operatorVariableScopeEnvelope(hull) || '');
    }

    const variableCenterX = variableRect.x + variableRect.width / 2;
    const operatorCenterX = operatorRect.x + operatorRect.width / 2;
    const direction = variableCenterX >= operatorCenterX ? 1 : -1;
    const fromX = variableRect.x + (direction > 0 ? variableRect.width + 5 : -5);
    const fromY = variableRect.y + variableRect.height * 0.58;
    const toX = operatorRect.x + (direction > 0 ? operatorRect.width + 5 : -5);
    const toY = operatorRect.y + operatorRect.height * 0.62;
    const hullXs = hull?.map((point) => point[0]) || [];
    const routeEdge = direction > 0
      ? Math.max(fromX, toX, ...hullXs)
      : Math.min(fromX, toX, ...hullXs);
    const routeX = routeEdge + direction * (38 + (scopeCount - rank - 1) * 18);
    host.select<SVGPathElement>('.babel-operator-variable-path')
      .attr('d', [
        `M ${fromX.toFixed(1)} ${fromY.toFixed(1)}`,
        `C ${routeX.toFixed(1)} ${fromY.toFixed(1)}, ${routeX.toFixed(1)} ${toY.toFixed(1)}, ${toX.toFixed(1)} ${toY.toFixed(1)}`
      ].join(' '));

    host.selectAll<SVGTextElement, unknown>('.babel-operator-variable-index')
      .each(function refineOperatorVariableIndex() {
        const index = d3.select(this);
        const role = index.attr('data-operator-variable-index-role') === 'operator' ? 'operator' : 'variable';
        const rect = role === 'operator'
          ? operatorRect
          : variableRect;
        const bounds = this.getBBox();
        const point = operatorBindingIndexPoint(rect,
          { y: bounds.y - Number(index.attr('y') || 0), height: bounds.height }, role, direction,
          role === 'operator' ? fromY : toY);
        index
          .attr('x', point.x.toFixed(1))
          .attr('y', point.y.toFixed(1));
      });
  };
  const refineQuantifierRaising = function refineQuantifierRaising() {
    const host = d3.select(this);
    const pronouncedRect = measuredShellRect(host.attr('data-qr-pronounced'));
    const lfRect = measuredShellRect(host.attr('data-qr-lf'));
    if (!pronouncedRect || !lfRect) return;

    const layer = host.select<SVGGElement>('.babel-lf-relation-layer');
    const domainNodeId = host.attr('data-qr-domain');
    if (domainNodeId) {
      const domainRect = measuredSubtreeRect(domainNodeId);
      if (!domainRect) return;
      layer.select<SVGRectElement>('.babel-lf-domain')
        .attr('x', (domainRect.x - 52).toFixed(1))
        .attr('y', (domainRect.y - 46).toFixed(1))
        .attr('width', (domainRect.width + 104).toFixed(1))
        .attr('height', (domainRect.height + 98).toFixed(1));
    }

    const pronouncedCenter = {
      x: pronouncedRect.x + pronouncedRect.width / 2,
      y: pronouncedRect.y + pronouncedRect.height / 2
    };
    const lfCenter = {
      x: lfRect.x + lfRect.width / 2,
      y: lfRect.y + lfRect.height / 2
    };
    const verticalGap = Math.max(100, Math.abs(pronouncedCenter.y - lfCenter.y) * 0.44);
    const elbowY = Math.min(pronouncedCenter.y - 86, lfCenter.y + verticalGap);
    layer.select<SVGPathElement>('.babel-lf-path-qr')
      .attr('d', [
        `M ${pronouncedCenter.x.toFixed(1)} ${(pronouncedRect.y - 12).toFixed(1)}`,
        `L ${pronouncedCenter.x.toFixed(1)} ${elbowY.toFixed(1)}`,
        `L ${lfCenter.x.toFixed(1)} ${elbowY.toFixed(1)}`,
        `L ${lfCenter.x.toFixed(1)} ${(lfRect.y + lfRect.height + 20).toFixed(1)}`
      ].join(' '));

    const indices = host.selectAll<SVGTextElement, unknown>('.babel-binding-index').nodes();
    [pronouncedRect, lfRect].forEach((rect, index) => {
      d3.select(indices[index])
        .attr('x', (rect.x + rect.width + 12).toFixed(1))
        .attr('y', (rect.y + rect.height / 2 + 30).toFixed(1));
    });
  };
  const refineGappingAlignment = function refineGappingAlignment() {
    const layer = d3.select(this);
    const host = d3.select(this.parentElement as SVGGElement);
    const antecedentRect = measuredShellRect(host.attr('data-gapping-antecedent'));
    const gapRect = measuredShellRect(host.attr('data-gapping-gap'));
    const treeRect = measuredTreeLabelsRect();
    const pairs = JSON.parse(host.attr('data-gapping-pairs') || '[]') as Array<{
      correlateNodeId: string;
      remnantNodeId: string;
      label: string;
    }>;
    if (!antecedentRect || !gapRect || !treeRect) return;
    const markerId = layer.select<SVGMarkerElement>('marker').attr('id');
    const correspondence = (
      path: d3.Selection<SVGPathElement, unknown, null, undefined>,
      source: { x: number; y: number; width: number; height: number },
      target: { x: number; y: number; width: number; height: number },
      laneY: number
    ) => {
      const start = {
        x: source.x + source.width / 2,
        y: source.y + source.height + 10
      };
      const end = {
        x: target.x + target.width / 2,
        y: target.y + target.height + 10
      };
      path
        .attr('marker-end', `url(#${markerId})`)
        .attr('d', [
          `M ${start.x.toFixed(1)} ${start.y.toFixed(1)}`,
          `C ${start.x.toFixed(1)} ${laneY.toFixed(1)}`,
          `${end.x.toFixed(1)} ${laneY.toFixed(1)}`,
          `${end.x.toFixed(1)} ${end.y.toFixed(1)}`
        ].join(' '));
    };
    const laneBase = treeRect.y + treeRect.height + 72;
    correspondence(
      layer.select<SVGPathElement>('.babel-gapping-correspondence-predicate'),
      antecedentRect,
      gapRect,
      laneBase
    );
    const pairPaths = layer.selectAll<SVGPathElement, unknown>('.babel-gapping-correspondence-pair').nodes();
    const indices = layer.selectAll<SVGTextElement, unknown>('.babel-gapping-index').nodes();
    pairs.forEach((pair, pairIndex) => {
      const correlateRect = measuredShellRect(pair.correlateNodeId);
      const remnantRect = measuredShellRect(pair.remnantNodeId);
      if (!correlateRect || !remnantRect || !pairPaths[pairIndex]) return;
      correspondence(
        d3.select(pairPaths[pairIndex]),
        correlateRect,
        remnantRect,
        laneBase + 44 + pairIndex * 38
      );
      d3.select(indices[pairIndex * 2])
        .attr('x', (correlateRect.x + correlateRect.width + 10).toFixed(1))
        .attr('y', (correlateRect.y + correlateRect.height * 0.78).toFixed(1));
      d3.select(indices[pairIndex * 2 + 1])
        .attr('x', (remnantRect.x + remnantRect.width + 10).toFixed(1))
        .attr('y', (remnantRect.y + remnantRect.height * 0.78).toFixed(1));
    });
  };
  const refineIdiomChunkRelation = function refineIdiomChunkRelation() {
    const layer = d3.select(this);
    const bracket = layer.select<SVGPathElement>('.babel-idiom-domain-bracket');
    const relationHost = this.closest('.vr-item');
    const stageIndex = relationHost?.getAttribute('data-vr-stage-index') || '';
    const relationIndex = relationHost?.getAttribute('data-vr-relation-index') || '';
    const domainRect = bracket.empty() ? null : measuredSubtreeRect(bracket.attr('data-idiom-domain'));

    const chunkElements = g.selectAll<SVGGElement, unknown>('.vr-idiom-chunk-anchor')
      .filter(function sameRelation() {
        const candidateHost = this.closest('.vr-item');
        return candidateHost?.getAttribute('data-vr-stage-index') === stageIndex
          && candidateHost?.getAttribute('data-vr-relation-index') === relationIndex;
      })
      .nodes();
    const terminalElements = new Set<SVGTextElement>();
    chunkElements.forEach((chunkElement) => {
      const chunkNode = postFitNodeById.get(chunkElement.getAttribute('data-idiom-chunk') || '');
      if (!chunkNode) return;
      const chunkIds = new Set(chunkNode.descendants().map((candidate) => getNodeId(candidate as unknown as HierNode)));
      g.selectAll<SVGTextElement, HierNode>('.terminal-label')
        .filter(function terminalBelongsToChunk(candidate) {
          const datumId = getNodeId(candidate);
          const terminalId = this.getAttribute('data-node-id') || '';
          return chunkIds.has(datumId)
            || chunkIds.has(terminalId)
            || [...chunkIds].some((chunkId) => labelBelongsToNode(this, String(chunkId)));
        })
        .nodes()
        .forEach((terminal) => terminalElements.add(terminal));
    });

    const inverse = treeMatrix.inverse();
    const chunksByLine = new Map<number, Array<{ x: number; y: number; width: number; height: number }>>();
    terminalElements.forEach((terminal) => {
      const rect = terminal.getBoundingClientRect();
      const topLeft = new DOMPoint(rect.left, rect.top).matrixTransform(inverse);
      const bottomRight = new DOMPoint(rect.right, rect.bottom).matrixTransform(inverse);
      const local = {
        x: topLeft.x,
        y: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y
      };
      const lineKey = Math.round((local.y + local.height / 2) / 12) * 12;
      chunksByLine.set(lineKey, [...(chunksByLine.get(lineKey) || []), local]);
    });
    chunksByLine.forEach((rects) => {
      const runs: Array<{ x: number; right: number; bottom: number }> = [];
      [...rects].sort((left, right) => left.x - right.x).forEach((rect) => {
        const right = rect.x + rect.width;
        const bottom = rect.y + rect.height;
        const previous = runs[runs.length - 1];
        if (previous && rect.x - previous.right <= 30) {
          previous.right = Math.max(previous.right, right);
          previous.bottom = Math.max(previous.bottom, bottom);
        } else {
          runs.push({ x: rect.x, right, bottom });
        }
      });
      runs.forEach((run) => {
        layer.insert('path', '.babel-idiom-domain-bracket')
          .attr('class', 'babel-idiom-chunk-underline')
          .attr('d', `M ${run.x.toFixed(1)} ${(run.bottom + 7).toFixed(1)} H ${run.right.toFixed(1)}`);
      });
    });

    if (!domainRect) return;
    const fittedSvgRect = svg.node()?.getBoundingClientRect();
    const viewportRight = fittedSvgRect
      ? new DOMPoint(fittedSvgRect.right - 12, fittedSvgRect.top).matrixTransform(inverse).x
      : undefined;
    const bracketPath = idiomDomainBracketPath(domainRect, viewportRight);
    if (bracketPath) bracket.attr('d', bracketPath);
  };
  return {
    refineControlRelation,
    refineBindingRelation,
    refineCoreferenceIndex,
    refinePredicationRelation,
    refineOperatorVariableBinding,
    refineQuantifierRaising,
    refineGappingAlignment,
    refineIdiomChunkRelation
  };
}
