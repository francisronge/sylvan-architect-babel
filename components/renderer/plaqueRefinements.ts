import * as d3 from 'd3';
import {
  splitAntecedenceLinkPath
} from '../../replay/relations/markGeometry.ts';
import {
  analysisVerdictCompoundOrigin,
  analysisVerdictInitialLocalScale,
  planAnalysisVerdictRows,
  type AnalysisVerdictAnchor
} from '../../replay/relations/overlayGeometry.ts';
import type { PlaquePlacement } from '../../replay/relations/plaquePlacement.ts';
import {
  preparePfPlaqueTextLayout,
  reservePlaqueViewport
} from '../../replay/relations/plaqueTextLayout.ts';
import { appendPlaqueContent } from '../plaqueViewport.ts';
import type { DrawingLayer, RelationMeasurements } from './drawingContext.ts';
import { drawPlaqueText, withPlaqueTextMeasure } from './plaqueText.ts';
interface PlaqueRefinementsContext extends Pick<RelationMeasurements,
  | 'measuredTerminalSubtreesRect'
  | 'unionRects'
  | 'measuredShellRect'
  | 'measuredTerminalRect'
  | 'measuredTreeLabelsRect'
  | 'measuredSubtreeRect'
> {
  g: DrawingLayer;
  playedRelationIndices: Set<number> | null;
  activeDerivationFrameIndex: number;
  replayPlaqueLayout: Map<number, PlaquePlacement>;
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  /** The tree layer's screen matrix under the settled camera (`deferredTreeMatrix`). */
  deferredTreeMatrix: () => DOMMatrix | null;
}
export function createPlaqueRefinements({
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
}: PlaqueRefinementsContext) {
  // Screen-sized pieces, sized once for the settled camera, then scaled with the tree.
  const refineSplitAntecedenceComposition = () => {
    const matrix = deferredTreeMatrix();
    if (!matrix) return;
    const screenScale = Math.hypot(matrix.a, matrix.b);
    if (!Number.isFinite(screenScale) || screenScale <= 0) return;
    const size = 10 / screenScale;
    g.selectAll<SVGRectElement, unknown>('.babel-split-antecedence-origin')
      .each(function refineSplitAntecedenceCompositionItem() {
        const origin = d3.select(this);
        const rawX = Number(origin.attr('data-split-antecedence-origin-x'));
        const rawY = Number(origin.attr('data-split-antecedence-origin-y'));
        if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return;
        const correctedOrigin = {
          x: rawX,
          y: rawY - 6 + 9 / screenScale
        };
        origin
          .attr('x', (correctedOrigin.x - size / 2).toFixed(1))
          .attr('y', (correctedOrigin.y - size / 2).toFixed(1))
          .attr('width', size.toFixed(1))
          .attr('height', size.toFixed(1));
        const relationHost = d3.select(this.parentElement);
        relationHost.selectAll<SVGPathElement, unknown>(
          '.babel-split-antecedence-path-shadow, .babel-split-antecedence-path'
        ).each(function refineSplitAntecedencePath() {
          const path = d3.select(this);
          const rawTargetX = Number(path.attr('data-split-antecedence-target-x'));
          const rawTargetY = Number(path.attr('data-split-antecedence-target-y'));
          const linkIndex = Number(path.attr('data-split-antecedence-link-index'));
          const linkCount = Number(path.attr('data-split-antecedence-link-count'));
          if (
            !Number.isFinite(rawTargetX)
            || !Number.isFinite(rawTargetY)
            || !Number.isFinite(linkIndex)
            || !Number.isFinite(linkCount)
          ) return;
          path.attr('d', splitAntecedenceLinkPath(
            correctedOrigin,
            {
              x: rawTargetX,
              y: rawTargetY - 6 + 13 / screenScale
            },
            linkIndex,
            linkCount,
            screenScale
          ));
        });
      });
  };
  const renderPfRealizationPlate = function renderPfRealizationPlate() {
    const layer = d3.select(this);
    const targetNodeIds = JSON.parse(layer.attr('data-pf-targets') || '[]') as string[];
    const allRows = JSON.parse(layer.attr('data-pf-rows') || '[]') as Array<{ label: string; value: string }>;
    const rowKinds = JSON.parse(layer.attr('data-pf-row-kinds') || '[]') as Array<'rewrite' | 'literal'>;
    const rowRefs = JSON.parse(layer.attr('data-pf-row-refs') || '[]') as Array<{
      stageIndex: number;
      relationIndex: number;
    } | null>;
    const visibleRows = allRows.flatMap((row, rowIndex) => {
      const ref = rowRefs[rowIndex];
      const visible = playedRelationIndices === null
        || !ref
        || ref.stageIndex < activeDerivationFrameIndex
        || (ref.stageIndex === activeDerivationFrameIndex && playedRelationIndices.has(ref.relationIndex));
      return visible ? [{ ...row, rowIndex, kind: rowKinds[rowIndex], isFinal: rowIndex === allRows.length - 1 }] : [];
    });
    const finalOutput = rowKinds.at(-1) === 'rewrite' ? allRows.at(-1)?.value || '' : '';
    const isZeroRealization = finalOutput === '∅' && allRows.length === 1;
    const targetRect = isZeroRealization
      ? measuredTerminalSubtreesRect(targetNodeIds)
      : unionRects(targetNodeIds.flatMap((nodeId) => {
        const shell = measuredShellRect(nodeId);
        const terminal = measuredTerminalRect(nodeId);
        return [shell, terminal].filter((rect): rect is NonNullable<typeof rect> => Boolean(rect));
      }));
    if (!targetRect) return;

    const origin = replayPlaqueLayout.get(Number(layer.attr('data-plaque-item-index')));
    if (!origin) return;
    const layout = reservePlaqueViewport(withPlaqueTextMeasure(svg, measureText =>
      preparePfPlaqueTextLayout(visibleRows, { isZeroRealization, measureText })), origin.scrollHeight);
    const { width: plateWidth, height: plateHeight } = layout;
    const platePadX = 26;
    layer.attr('data-plaque-location', origin.location).attr('data-plaque-domain', origin.domainId);

    layer.append('rect')
      .attr('class', 'babel-pf-plate-shell')
      .attr('data-vr-hit-area', 'true')
      .attr('x', origin.x.toFixed(1))
      .attr('y', origin.y.toFixed(1))
      .attr('width', plateWidth.toFixed(1))
      .attr('height', plateHeight.toFixed(1))
      .attr('rx', 8);
    const content = appendPlaqueContent(layer, layout, origin);
    drawPlaqueText(content, layout.title, 'babel-pf-plate-title', origin);
    const appendRule = (y: number) => content.append('line')
      .attr('class', 'babel-pf-plate-rule')
      .attr('x1', (origin.x + platePadX).toFixed(1))
      .attr('x2', (origin.x + plateWidth - platePadX).toFixed(1))
      .attr('y1', y.toFixed(1))
      .attr('y2', y.toFixed(1));
    appendRule(origin.y + layout.titleRuleY);
    layout.rows.forEach(row => {
      const rowGroup = content.append('g').attr('data-plaque-row-index', row.rowIndex);
      if (row.ruleY !== undefined) appendRule(origin.y + row.ruleY);
      row.parts.forEach(part => {
        const className = part.kind === 'arrow' ? 'babel-pf-plate-arrow'
          : `babel-pf-plate-text${part.kind === 'output' ? ' babel-pf-plate-output' : ''}`;
        drawPlaqueText(rowGroup, part.block,
          `${className}${row.isFinal && part.kind !== 'arrow' ? ' babel-pf-plate-text-final' : ''}`, origin);
      });
    });
    layer
      .attr('data-pf-targets', null)
      .attr('data-pf-rows', null)
      .attr('data-pf-row-kinds', null)
      .attr('data-pf-row-refs', null);
  };
  const layoutAnalysisVerdicts = (initialCameraScale: number) => {
    const treeRect = measuredTreeLabelsRect();
    if (!treeRect) return;
    const analysisVerdicts = g.selectAll<SVGGElement, unknown>('.babel-analysis-verdict');
    const entries = planAnalysisVerdictRows<AnalysisVerdictAnchor & { node: SVGGElement }>(
      analysisVerdicts.nodes().flatMap((node, order) => {
        const verdict = d3.select(node);
        const analysisNodeId = verdict.attr('data-analysis-verdict-anchor');
        const anchorRect = measuredSubtreeRect(analysisNodeId);
        if (!anchorRect) return [];
        return [{
          node,
          order,
          analysisNodeId,
          desiredY: anchorRect.y + anchorRect.height / 2
        }];
      }),
      34 / Math.max(0.001, initialCameraScale || 1)
    );
    entries.forEach(({ node, y }) => {
      const verdict = d3.select(node);
      const localScale = analysisVerdictInitialLocalScale(
        initialCameraScale, verdict.select('.babel-analysis-judgment').text()
      );
      const compound = verdict.select<SVGTextElement>('.babel-analysis-verdict-text');
      const compoundNode = compound.node();
      if (!compoundNode) return;
      const compoundRect = compoundNode.getBBox();
      const scaledCompoundRect = {
        x: compoundRect.x * localScale,
        y: compoundRect.y * localScale,
        width: compoundRect.width * localScale,
        height: compoundRect.height * localScale
      };
      const origin = analysisVerdictCompoundOrigin(
        treeRect,
        scaledCompoundRect,
        y,
        5 / Math.max(0.001, initialCameraScale || 1)
      );
      verdict.attr(
        'transform',
        `translate(${origin.x.toFixed(1)},${origin.y.toFixed(1)}) scale(${localScale.toFixed(6)})`
      );
    });
  };
  return { refineSplitAntecedenceComposition, renderPfRealizationPlate, layoutAnalysisVerdicts };
}
