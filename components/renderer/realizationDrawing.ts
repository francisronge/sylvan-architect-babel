import * as d3 from 'd3';
import {
  wrapPlaqueText
} from '../../replay/relations/plaqueTextLayout.ts';
import {
  type RelationPlanItem
} from '../../replay/relations/renderPlan.ts';
import { isCompactViewport } from '../../replay/rendererMetrics.ts';
import {
  isNullLike,
  resolveLeafSurface
} from '../../replay/replaySurfaceNotation.ts';
import { type HierNode } from '../../replay/types.ts';
import { type SyntaxNode } from '../../types.ts';
import { detachedPlaqueOrigin } from '../detachedPlaquePlacement.ts';
import { availableTreeViewport } from '../treeViewport.ts';
import { settledClientPoint } from './cameraState.ts';
import type { ClaimDrawing, DrawingLayer, RelationEmphasis, TreeMeasurements } from './drawingContext.ts';

import { withPlaqueTextMeasure } from './plaqueText.ts';

interface RealizationDrawingContext extends Pick<ClaimDrawing, 'acceptedRelationDrawingKey' | 'queueAcceptedRelationDraw'>, Pick<TreeMeasurements, 'exactScreenTreeLabelRectNow' | 'exactScreenTreeLabelRectForNodeIdsNow'> {
  markPreterminalLensNode: (nodeId: string, role: string) => void;
  scheduledAcceptedPfRelations: Set<string>;
  g: DrawingLayer;
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  containerWidth: number;
  /** The tree layer's screen matrix under the settled camera (`deferredTreeMatrix`). */
  deferredTreeMatrix: () => DOMMatrix | null;
  overlayNodeById: Map<string, d3.HierarchyPointNode<SyntaxNode>>;
  measureGraphicsElementsInTreeSpace: (elements: SVGGraphicsElement[]) => { x: number; y: number; width: number; height: number; } | null;
  uiBounds: { top: number; right: number; bottom: number; headerBottom: number; panelTop: number };
  containerRef: { current: HTMLDivElement | null };
}

export function createRealizationDrawing({
  markPreterminalLensNode,
  acceptedRelationDrawingKey,
  scheduledAcceptedPfRelations,
  queueAcceptedRelationDraw,
  g,
  svg,
  exactScreenTreeLabelRectNow,
  containerWidth,
  deferredTreeMatrix,
  overlayNodeById,
  measureGraphicsElementsInTreeSpace,
  uiBounds,
  exactScreenTreeLabelRectForNodeIdsNow,
  containerRef
}: RealizationDrawingContext) {
  const scheduleAcceptedPfRelation = (
    item: RelationPlanItem,
    emphasis: RelationEmphasis
  ) => {
    if (item.familyId === 'pf.realization' && item.kind === 'node-plaque') {
      const finalOutput = String(item.rows.at(-1)?.value || '').trim();
      if (finalOutput && !isNullLike(finalOutput)) {
        item.anchorNodeIds.forEach((nodeId) => markPreterminalLensNode(nodeId, 'pf-source'));
      }
      return false;
    }
    if (
      item.familyId !== 'pf.phrasal-spellout'
      && item.familyId !== 'pf.correspondence'
    ) return false;
    const drawingKey = acceptedRelationDrawingKey(item);
    if (!scheduledAcceptedPfRelations.has(drawingKey)) {
      scheduledAcceptedPfRelations.add(drawingKey);
      queueAcceptedRelationDraw(item, emphasis, () => {
        if (item.kind !== 'node-plaque') return;
        const root = g.node();
        // Deferred drawing can run during a camera transition. Place and size
        // the panel for the settled camera, then let it move with the tree.
        const matrix = deferredTreeMatrix();
        const svgRect = svg.node()?.getBoundingClientRect();
        if (!root || !matrix || !svgRect) return;
        const inverse = matrix.inverse();
        const toLocal = (clientX: number, clientY: number) => {
          const point = new DOMPoint(clientX, clientY).matrixTransform(inverse);
          return { x: point.x, y: point.y };
        };
        const viewportTopLeft = toLocal(svgRect.left + 12, svgRect.top + 12);
        const viewportBottomRight = toLocal(svgRect.right - 12, svgRect.bottom - 12);
        const viewport = {
          left: Math.min(viewportTopLeft.x, viewportBottomRight.x),
          right: Math.max(viewportTopLeft.x, viewportBottomRight.x),
          top: Math.min(viewportTopLeft.y, viewportBottomRight.y),
          bottom: Math.max(viewportTopLeft.y, viewportBottomRight.y)
        };
        const screenScale = Math.max(0.001, Math.hypot(matrix.a, matrix.b));
        const localPx = (pixels: number) => pixels / screenScale;
        const layer = g.append('g')
          .attr('class', 'babel-pf-relation-layer babel-pf-specialization-layer')
          .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
        const layerNode = layer.node();
        if (layerNode) {
          (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
        }

        if (item.familyId === 'pf.phrasal-spellout') {
          const phrase = item.anchorNodeIds[0];
          const categoryRect = phrase ? exactScreenTreeLabelRectNow(phrase, false) : null;
          const exponent = item.title || '';
          if (!categoryRect || !exponent) {
            layer.remove();
            return;
          }
          layer.append('text')
            .attr('class', 'babel-phrasal-spellout-label')
            .attr('x', (categoryRect.x + categoryRect.width + localPx(7)).toFixed(1))
            .attr('y', (categoryRect.y + categoryRect.height * 0.8).toFixed(1))
            .style('font-size', `${localPx(16)}px`)
            .style('stroke-width', `${localPx(3)}px`)
            .text(`=> ${exponent}`);
          return;
        }

        const anchor = item.anchorNodeIds[0];
        const anchorRect = anchor ? exactScreenTreeLabelRectNow(anchor, true) : null;
        const content = item.nativeContent;
        if (content?.kind !== 'correspondence') { layer.remove(); return; }
        const { sources, exponents, links: correspondence } = content;
        if (!anchorRect || sources.length === 0 || exponents.length === 0) {
          layer.remove();
          return;
        }
        const width = localPx(330);
        const height = localPx(150);
        const preferredX = anchorRect.x + anchorRect.width + localPx(52);
        const origin = {
          x: Math.max(viewport.left, Math.min(preferredX, viewport.right - width)),
          y: Math.max(
            viewport.top,
            Math.min(anchorRect.y + anchorRect.height / 2 - height / 2, viewport.bottom - height)
          )
        };
        layer.append('rect')
          .attr('class', 'babel-pf-correspondence-shell')
          .attr('x', origin.x.toFixed(1))
          .attr('y', origin.y.toFixed(1))
          .attr('width', width.toFixed(1))
          .attr('height', height.toFixed(1))
          .attr('rx', localPx(12).toFixed(1))
          .style('stroke-width', `${localPx(1.5)}px`);
        layer.append('text')
          .attr('class', 'babel-pf-correspondence-title')
          .attr('x', (origin.x + width / 2).toFixed(1))
          .attr('y', (origin.y + localPx(18)).toFixed(1))
          .attr('text-anchor', 'middle')
          .style('font-size', `${localPx(9)}px`)
          .text('LEXICAL REPRESENTATION');
        const positions = (labels: string[], y: number, sidePaddingPx: number) =>
          labels.map((label, index) => ({
            label,
            x: origin.x + localPx(sidePaddingPx)
              + (labels.length === 1
                ? (width - localPx(sidePaddingPx * 2)) / 2
                : index * (width - localPx(sidePaddingPx * 2)) / (labels.length - 1)),
            y
          }));
        const sourcePositions = positions(sources, origin.y + localPx(49), 38);
        const exponentPositions = positions(exponents, origin.y + localPx(128), 50);
        correspondence.forEach((link) => {
          const from = sourcePositions[link.sourceIndex];
          const to = exponentPositions[link.exponentIndex];
          if (!from || !to) return;
          layer.append('line')
            .attr('class', 'babel-pf-correspondence-link')
            .attr('x1', from.x.toFixed(1))
            .attr('y1', (from.y + localPx(9)).toFixed(1))
            .attr('x2', to.x.toFixed(1))
            .attr('y2', (to.y - localPx(18)).toFixed(1))
            .style('stroke-width', `${localPx(1.15)}px`);
        });
        const appendLabel = (
          className: string,
          label: string,
          point: { x: number; y: number },
          pixels: number
        ) => layer.append('text')
          .attr('class', className)
          .attr('x', point.x.toFixed(1))
          .attr('y', point.y.toFixed(1))
          .attr('text-anchor', 'middle')
          .style('font-size', `${localPx(pixels)}px`)
          .style('stroke-width', `${localPx(2.5)}px`)
          .text(label);
        sourcePositions.forEach((point) => {
          appendLabel('babel-pf-correspondence-source', point.label, point, 13);
        });
        exponentPositions.forEach((point) => {
          appendLabel('babel-pf-correspondence-exponent', point.label, point, 13);
        });
        const fittedLayer = layer.node();
        const svgNode = svg.node();
        const liveMatrix = root.getScreenCTM();
        if (fittedLayer && svgNode && liveMatrix && isCompactViewport(containerWidth)) {
          fitOverlayToCompactViewport(fittedLayer, svgNode.getBoundingClientRect(), liveMatrix, matrix);
        }
      });
    }
    return true;
  };
  const scheduleAcceptedPfMorphologyRelation = (
    item: RelationPlanItem,
    emphasis: RelationEmphasis
  ) => {
    if (
      item.familyId !== 'pf.fission'
      && item.familyId !== 'pf.impoverishment'
      && item.familyId !== 'pf.local-dislocation'
    ) return false;
    const drawingKey = acceptedRelationDrawingKey(item);
    if (!scheduledAcceptedPfRelations.has(drawingKey)) {
      scheduledAcceptedPfRelations.add(drawingKey);
      queueAcceptedRelationDraw(item, emphasis, () => {
        if (item.kind !== 'node-plaque') return;
        const root = g.node();
        // Deferred drawing can run during a camera transition. Place the
        // complete panel for the destination, then let it move with the tree.
        const matrix = deferredTreeMatrix();
        const svgRect = svg.node()?.getBoundingClientRect();
        if (!root || !matrix || !svgRect) return;
        const inverse = matrix.inverse();
        const toLocal = (clientX: number, clientY: number) =>
          new DOMPoint(clientX, clientY).matrixTransform(inverse);
        const viewportTopLeft = toLocal(svgRect.left + 12, svgRect.top + 12);
        const viewportBottomRight = toLocal(svgRect.right - 12, svgRect.bottom - 12);
        const viewport = {
          left: Math.min(viewportTopLeft.x, viewportBottomRight.x),
          top: Math.min(viewportTopLeft.y, viewportBottomRight.y),
          right: Math.max(viewportTopLeft.x, viewportBottomRight.x),
          bottom: Math.max(viewportTopLeft.y, viewportBottomRight.y)
        };
        const screenScale = Math.max(0.001, Math.hypot(matrix.a, matrix.b));
        const localPx = (pixels: number) => pixels / screenScale;
        const displayLabelForAnchor = (nodeId: string) => {
          const anchor = overlayNodeById.get(nodeId);
          if (!anchor) return nodeId;
          const surfaces = anchor.descendants()
            .filter((candidate) => (candidate.children || []).length === 0)
            .map((candidate) => resolveLeafSurface(candidate as unknown as HierNode).trim())
            .filter((surface) => surface && surface !== '∅' && !/^\[.*\]$/.test(surface));
          return surfaces.join(' ') || String(anchor.data.word || anchor.data.label || nodeId);
        };
        const layer = g.append('g')
          .attr('class', 'babel-pf-morphology-relation-layer')
          .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
        const layerNode = layer.node();
        if (layerNode) {
          (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
        }
        const appendText = (
          parent: DrawingLayer,
          className: string,
          x: number,
          y: number,
          content: string
        ) => parent.append('text')
          .attr('class', className)
          .attr('x', x.toFixed(1))
          .attr('y', y.toFixed(1))
          .text(content);
        const appendLine = (
          className: string,
          x1: number,
          y1: number,
          x2: number,
          y2: number
        ) => layer.append('line')
          .attr('class', className)
          .attr('x1', x1.toFixed(1))
          .attr('y1', y1.toFixed(1))
          .attr('x2', x2.toFixed(1))
          .attr('y2', y2.toFixed(1));
        const appendShell = (x: number, y: number, width: number, height: number) =>
          layer.append('rect')
            .attr('class', 'babel-pf-morphology-shell')
            .attr('x', x.toFixed(1))
            .attr('y', y.toFixed(1))
            .attr('width', width.toFixed(1))
            .attr('height', height.toFixed(1))
            .attr('rx', 8);
        const setScreenFont = <T extends SVGTextElement>(
          selection: d3.Selection<T, unknown, null, undefined>,
          pixels: number
        ) => selection.style('font-size', `${localPx(pixels)}px`);
        const setScreenStroke = <T extends SVGElement>(
          selection: d3.Selection<T, unknown, null, undefined>,
          pixels: number
        ) => selection.style('stroke-width', `${localPx(pixels)}px`);
        // Replay can contain several workspaces under an invisible root. Measure
        // the visible forest, without requiring a label on that wrapper.
        const rootRect = measureGraphicsElementsInTreeSpace(
          g.selectAll<SVGTextElement, HierNode>('.category-label, .terminal-label').nodes()
        );
        if (!rootRect) {
          layer.remove();
          return;
        }

        const clearPlaqueOrigin = (preferred: { x: number; y: number }, width: number, height: number) => {
          const safe = availableTreeViewport(svgRect.width, svgRect.height, uiBounds);
          const topLeft = toLocal(svgRect.left + safe.left, svgRect.top + safe.top);
          const bottomRight = toLocal(svgRect.left + safe.right, svgRect.top + safe.bottom);
          return detachedPlaqueOrigin({ ...preferred, width, height }, {
            left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y
          }, [rootRect], localPx(12)) ?? preferred;
        };

        if (item.familyId === 'pf.fission') {
          const content = item.nativeContent;
          if (content?.kind !== 'fission' || item.anchorNodeIds.length !== 2
            || !exactScreenTreeLabelRectForNodeIdsNow(item.anchorNodeIds)) {
            layer.remove();
            return;
          }
          const widthPx = 300;
          const bundles = withPlaqueTextMeasure(svg, measure =>
            [content.inputFeatures, ...content.outputFeatures].map(rows => rows.flatMap(row =>
              wrapPlaqueText(row, 70, text => measure(text, {
                fontFamily: '"JetBrains Mono", monospace', fontSize: 7, fontWeight: 800, letterSpacing: 0
              })))));
          const bundleRows = Math.max(...bundles.map(rows => rows.length));
          const heightPx = Math.max(112, 64 + (bundleRows - 1) * 10.5);
          const width = localPx(widthPx);
          const height = localPx(heightPx);
          // In the app the panel is drawn in the workspace's layer, outside the container.
          const replayPanelRect = (containerRef.current?.closest('[data-babel-workspace]') ?? containerRef.current)
            ?.querySelector<HTMLElement>('[data-babel-replay-panel="true"]')
            ?.getBoundingClientRect() || null;
          const preferredClientY = svgRect.top + 310;
          const maximumClientY = replayPanelRect
            ? replayPanelRect.top - heightPx - 12
            : preferredClientY;
          const originClientY = Math.max(
            svgRect.top + 12,
            Math.min(preferredClientY, maximumClientY)
          );
          const rightAnchoredOrigin = toLocal(
            svgRect.right - widthPx - 12,
            originClientY
          );
          const origin = clearPlaqueOrigin({
            x: Math.max(
              viewport.left,
              Math.min(rootRect.x + rootRect.width + localPx(32), rightAnchoredOrigin.x)
            ),
            y: rightAnchoredOrigin.y
          }, width, height);
          setScreenStroke(
            appendShell(origin.x, origin.y, width, height).attr('rx', localPx(8).toFixed(1)),
            1.5
          );
          setScreenFont(
            appendText(layer, 'babel-pf-morphology-title', origin.x + localPx(12), origin.y + localPx(15), 'FISSION'),
            9
          );
          setScreenStroke(
            appendLine(
              'babel-pf-morphology-rule',
              origin.x + localPx(12),
              origin.y + localPx(22),
              origin.x + width - localPx(12),
              origin.y + localPx(22)
            ),
            1
          );
          const drawBundle = (
            screenX: number,
            title: string,
            rows: string[],
            bundleWidthPx: number
          ) => {
            const x = origin.x + localPx(screenX);
            const group = layer.append('g').attr('class', 'babel-fission-bundle');
            setScreenStroke(
              group.append('rect')
                .attr('class', 'babel-fission-bundle-shell')
                .attr('x', x.toFixed(1))
                .attr('y', (origin.y + localPx(30)).toFixed(1))
                .attr('width', localPx(bundleWidthPx).toFixed(1))
                .attr('height', localPx(heightPx - 40).toFixed(1))
                .attr('rx', localPx(4).toFixed(1)),
              1
            );
            setScreenFont(
              appendText(group, 'babel-fission-bundle-title', x + localPx(6), origin.y + localPx(42), title),
              7
            );
            rows.forEach((row, index) => {
              setScreenFont(
                appendText(
                  group,
                  'babel-fission-bundle-row',
                  x + localPx(6),
                  origin.y + localPx(54 + index * 10.5),
                  row
                ),
                7
              );
            });
          };
          drawBundle(10, 'PRIOR TERMINAL', bundles[0], 82);
          setScreenFont(
            appendText(layer, 'babel-fission-arrow', origin.x + localPx(98), origin.y + localPx(72), '→'),
            14
          );
          drawBundle(
            112,
            displayLabelForAnchor(item.anchorNodeIds[0]),
            bundles[1],
            82
          );
          drawBundle(
            208,
            displayLabelForAnchor(item.anchorNodeIds[1]),
            bundles[2],
            82
          );
          return;
        }

        if (item.familyId === 'pf.impoverishment') {
          const content = item.nativeContent;
          if (content?.kind !== 'impoverishment' || !item.anchorNodeIds[0]) {
            layer.remove();
            return;
          }
          const { features, delinkIndex } = content;
          const width = 450;
          const height = Math.max(252, 120 + (features.length - 1) * 56);
          const origin = clearPlaqueOrigin({
            x: Math.max(viewport.left, Math.min(rootRect.x + rootRect.width + 48, viewport.right - width)),
            y: Math.max(
              viewport.top,
              Math.min(rootRect.y + rootRect.height / 2 - height / 2, viewport.bottom - height)
            )
          }, width, height);
          appendShell(origin.x, origin.y, width, height);
          appendText(layer, 'babel-pf-morphology-title', origin.x + 24, origin.y + 34, 'IMPOVERISHMENT');
          appendLine(
            'babel-pf-morphology-rule',
            origin.x + 24,
            origin.y + 50,
            origin.x + width - 24,
            origin.y + 50
          );
          const inputX = origin.x + 112;
          const firstY = origin.y + 88;
          const featureGap = 56;
          features.forEach((feature, index) => {
            const y = firstY + index * featureGap;
            appendText(layer, 'babel-impoverishment-feature', inputX, y, feature);
            if (index >= features.length - 1) return;
            const lineY1 = y + 10;
            const lineY2 = y + featureGap - 24;
            appendLine('babel-impoverishment-link', inputX, lineY1, inputX, lineY2);
            if (index !== delinkIndex) return;
            const crossY = (lineY1 + lineY2) / 2;
            appendLine('babel-impoverishment-cross', inputX - 15, crossY - 9, inputX + 15, crossY + 1);
            appendLine('babel-impoverishment-cross', inputX - 15, crossY + 2, inputX + 15, crossY + 12);
          });
          appendText(layer, 'babel-fission-arrow', origin.x + 230, origin.y + 147, '→');
          features.slice(0, delinkIndex + 1).forEach((feature, index) => {
            appendText(
              layer,
              'babel-impoverishment-feature babel-impoverishment-output',
              origin.x + 352,
              firstY + index * featureGap,
              feature
            );
          });
          return;
        }

        const labels = item.anchorNodeIds.map(displayLabelForAnchor);
        if (labels.length === 0) {
          layer.remove();
          return;
        }
        const content = item.nativeContent;
        if (content?.kind !== 'local-dislocation') {
          layer.remove();
          return;
        }
        const beforeSizes = content.beforeGroupSizes;
        const afterSizes = content.afterGroupSizes;
        const formatGroups = (sizes: number[]) => {
          let cursor = 0;
          const groups = sizes.flatMap((size) => {
            const group = labels.slice(cursor, cursor + size);
            cursor += size;
            if (group.length === 0) return [];
            const content = group.join(' · ');
            return [group.length > 1 ? `[ ${content} ]` : content];
          });
          if (cursor < labels.length) groups.push(...labels.slice(cursor));
          return groups.join(' · ');
        };
        const widthPx = 290;
        const heightPx = 66;
        const width = localPx(widthPx);
        const height = localPx(heightPx);
        const plaqueGap = localPx(14);
        let plaqueX = viewport.left + ((viewport.right - viewport.left) - width) / 2;
        plaqueX = Math.min(Math.max(plaqueX, viewport.left), viewport.right - width);
        let plaqueY = rootRect.y + rootRect.height + plaqueGap;
        if (plaqueY + height > viewport.bottom) {
          const besideX = rootRect.x + rootRect.width + plaqueGap;
          if (besideX + width <= viewport.right) {
            plaqueX = besideX;
            plaqueY = Math.max(
              viewport.top,
              Math.min(rootRect.y + rootRect.height - height, viewport.bottom - height)
            );
          } else {
            plaqueY = rootRect.y + rootRect.height + localPx(6);
          }
        }
        const origin = clearPlaqueOrigin({ x: plaqueX, y: plaqueY }, width, height);
        setScreenStroke(
          appendShell(origin.x, origin.y, width, height).attr('rx', localPx(8).toFixed(1)),
          1.5
        );
        setScreenFont(
          appendText(layer, 'babel-pf-morphology-title', origin.x + localPx(18), origin.y + localPx(15), 'LOCAL DISLOCATION'),
          11
        );
        setScreenStroke(
          appendLine(
            'babel-pf-morphology-rule',
            origin.x + localPx(18),
            origin.y + localPx(22),
            origin.x + width - localPx(18),
            origin.y + localPx(22)
          ),
          1
        );
        setScreenFont(
          appendText(layer, 'babel-pf-lane-label', origin.x + localPx(18), origin.y + localPx(40), 'BEFORE'),
          9
        );
        setScreenFont(
          appendText(layer, 'babel-pf-lane-expression', origin.x + localPx(78), origin.y + localPx(40), formatGroups(beforeSizes)),
          11
        );
        setScreenFont(
          appendText(layer, 'babel-pf-lane-label', origin.x + localPx(18), origin.y + localPx(58), 'AFTER'),
          9
        );
        setScreenFont(
          appendText(
            layer,
            'babel-pf-lane-expression babel-pf-lane-expression-current',
            origin.x + localPx(78),
            origin.y + localPx(58),
            formatGroups(afterSizes)
          ),
          11
        );
      });
    }
    return true;
  };
  return { scheduleAcceptedPfRelation, scheduleAcceptedPfMorphologyRelation };
}

/** Shrinks, then shifts, an overlay drawn directly in the tree layer so that it
 * lies inside the compact viewport once the camera settles. `live` and
 * `settled` are the tree layer's live and settled screen matrices: the overlay
 * is measured as painted and judged where it will be. */
export function fitOverlayToCompactViewport(layer: SVGGElement, viewport: DOMRect, live: DOMMatrix,
  settled: DOMMatrix, inset = 12) {
  const settle = settledClientPoint(live, settled);
  const settledRect = () => {
    const rect = layer.getBoundingClientRect();
    const start = settle(rect.left, rect.top);
    const end = settle(rect.right, rect.bottom);
    return {
      left: Math.min(start.x, end.x), right: Math.max(start.x, end.x),
      top: Math.min(start.y, end.y), bottom: Math.max(start.y, end.y)
    };
  };
  const availableWidth = Math.max(1, viewport.width - inset * 2);
  const availableHeight = Math.max(1, viewport.height - inset * 2);
  const initialRect = settledRect();
  const initialWidth = initialRect.right - initialRect.left;
  const initialHeight = initialRect.bottom - initialRect.top;
  if (initialWidth <= 0 || initialHeight <= 0) return;

  const fitScale = Math.min(1, availableWidth / initialWidth, availableHeight / initialHeight);
  const bounds = layer.getBBox();
  const pivotX = bounds.x + bounds.width / 2;
  const pivotY = bounds.y + bounds.height / 2;
  const scaleTransform = fitScale < 0.999
    ? `translate(${pivotX} ${pivotY}) scale(${fitScale}) translate(${-pivotX} ${-pivotY})`
    : '';
  layer.setAttribute('transform', scaleTransform);

  const fittedRect = settledRect();
  const left = viewport.left + inset;
  const right = viewport.right - inset;
  const top = viewport.top + inset;
  const bottom = viewport.bottom - inset;
  const screenDx = fittedRect.left < left
    ? left - fittedRect.left
    : fittedRect.right > right
      ? right - fittedRect.right
      : 0;
  const screenDy = fittedRect.top < top
    ? top - fittedRect.top
    : fittedRect.bottom > bottom
      ? bottom - fittedRect.bottom
      : 0;
  if (screenDx === 0 && screenDy === 0) return;

  const inverse = settled.inverse();
  const origin = new DOMPoint(0, 0).matrixTransform(inverse);
  const shifted = new DOMPoint(screenDx, screenDy).matrixTransform(inverse);
  const translateTransform = `translate(${shifted.x - origin.x} ${shifted.y - origin.y})`;
  layer.setAttribute('transform', `${translateTransform} ${scaleTransform}`.trim());
}
