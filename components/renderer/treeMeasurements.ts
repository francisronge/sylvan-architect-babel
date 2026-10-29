import * as d3 from 'd3';
import { getNodeId, isReplayDisplayChild } from '../../replay/displayIdentity.ts';
import { resolveUniqueDisplayTerminal } from '../../replay/relations/trajectoryAttachment.ts';
import { categoryLineBaselineY, outlinedTreeLabelCell, SHELL_ATTACHMENT_CLEARANCE, TERMINAL_ATTACHMENT_Y, TRAJECTORY_ROUTES } from '../../replay/rendererMetrics.ts';
import { treeLabelIndexAttributes, type TreeLabelRuns } from '../../replay/treeLabelRuns.ts';
import { isDisplayTerminalNode } from '../../replay/replaySurfaceNotation.ts';
import { type HierNode } from '../../replay/types.ts';
import { type SyntaxNode } from '../../types.ts';
import type { DrawingLayer } from './drawingContext.ts';
export const labelBelongsToNode = (element: SVGGraphicsElement, id: string): boolean => {
  const node = d3.select<SVGGraphicsElement, HierNode>(element).datum();
  return element.getAttribute('data-category-node-id') === id
    || element.getAttribute('data-node-id') === id
    || Boolean(node?.data && (node.data.aliasIds?.includes(id) || isReplayDisplayChild(node.data, id)));
};
/** The category label that relation refinements measure as a node's shell. */
export const shellLabelElement = (g: DrawingLayer, nodeId: string) => g.selectAll<SVGTextElement, HierNode>('.category-label')
  .filter((candidate) => getNodeId(candidate) === nodeId)
  .node();
/** The label of the anchor's unique display terminal, or of the anchor itself. */
export const terminalLabelElement = (g: DrawingLayer, anchor: d3.HierarchyNode<SyntaxNode> | undefined, nodeId: string) => {
  const resolution = anchor
    ? resolveUniqueDisplayTerminal(anchor, (candidate) => candidate.children || [], (candidate) => isDisplayTerminalNode(candidate.data))
    : null;
  const terminalId = resolution?.terminal ? getNodeId(resolution.terminal as unknown as HierNode) : nodeId;
  return g.selectAll<SVGTextElement, HierNode>('.terminal-label')
    .filter(function exactMeasuredTerminal(candidate) {
      return getNodeId(candidate) === terminalId || this.getAttribute('data-node-id') === terminalId;
    })
    .node();
};
export const measureTreeGraphics = (
  g: DrawingLayer,
  elements: SVGGraphicsElement[],
  glyphBounds?: ReadonlyMap<SVGGraphicsElement, { x: number; y: number; width: number; height: number }>
): { x: number; y: number; width: number; height: number } | null => {
  const treeMatrix = g.node()?.getCTM();
  if (!treeMatrix || elements.length === 0) return null;
  const intoTreeSpace = treeMatrix.inverse();
  const points: DOMPoint[] = [];
  elements.forEach((element) => {
    const elementMatrix = element.getCTM();
    if (!elementMatrix) return;
    const box = glyphBounds?.get(element) ?? element.getBBox();
    if (!box.width && !box.height) return;
    [
      [box.x, box.y],
      [box.x + box.width, box.y],
      [box.x + box.width, box.y + box.height],
      [box.x, box.y + box.height]
    ].forEach(([x, y]) => {
      points.push(
        new DOMPoint(x, y)
          .matrixTransform(elementMatrix)
          .matrixTransform(intoTreeSpace)
      );
    });
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


/** Capture syntax glyphs before camera fitting. Native font hinting can change
 * getBBox at another zoom; one painted frame must retain its world geometry. */
export function createTreeGraphicsMeasure(g: DrawingLayer) {
  const glyphBounds = new Map<SVGGraphicsElement, { x: number; y: number; width: number; height: number }>();
  g.selectAll<SVGTextElement, unknown>('.category-label, .terminal-label').each(function () {
    const { x, y, width, height } = this.getBBox();
    glyphBounds.set(this, { x, y, width, height });
  });
  return (elements: SVGGraphicsElement[]) => measureTreeGraphics(g, elements, glyphBounds);
}

interface TreeMeasurementsContext {
  g: DrawingLayer;
  overlayNodeById: Map<string, d3.HierarchyPointNode<SyntaxNode>>;
  measureGraphicsElementsInTreeSpace: (elements: SVGGraphicsElement[]) => { x: number; y: number; width: number; height: number; } | null;
}
export function createTreeMeasurements({ g, overlayNodeById, measureGraphicsElementsInTreeSpace }: TreeMeasurementsContext) {
  const measuredShellBottom = (
    nodeId: string,
    fallback: d3.HierarchyPointNode<SyntaxNode>
  ): { x: number; y: number } => {
    const categoryLabel = g.selectAll<SVGTextElement, HierNode>('.category-label')
      .filter((candidate) => getNodeId(candidate) === nodeId)
      .node();
    const space = g.node();
    const matrix = space?.getScreenCTM();
    if (categoryLabel && matrix) {
      const rect = categoryLabel.getBoundingClientRect();
      if (rect.width || rect.height) {
        const point = new DOMPoint(rect.left + rect.width / 2, rect.bottom)
          .matrixTransform(matrix.inverse());
        return { x: point.x, y: point.y + SHELL_ATTACHMENT_CLEARANCE.bottom };
      }
    }
    return { x: fallback.x, y: fallback.y + SHELL_ATTACHMENT_CLEARANCE.bottom };
  };
  const measuredShellTop = (
    nodeId: string,
    fallback: d3.HierarchyPointNode<SyntaxNode>
  ): { x: number; y: number } => {
    const categoryLabel = g.selectAll<SVGTextElement, HierNode>('.category-label')
      .filter((candidate) => getNodeId(candidate) === nodeId)
      .node();
    const space = g.node();
    const matrix = space?.getScreenCTM();
    if (categoryLabel && matrix) {
      const rect = categoryLabel.getBoundingClientRect();
      if (rect.width || rect.height) {
        const point = new DOMPoint(rect.left + rect.width / 2, rect.top)
          .matrixTransform(matrix.inverse());
        return { x: point.x, y: point.y - SHELL_ATTACHMENT_CLEARANCE.top };
      }
    }
    return { x: fallback.x, y: fallback.y - SHELL_ATTACHMENT_CLEARANCE.top };
  };
  const measuredTerminalBottom = (
    terminal: d3.HierarchyPointNode<SyntaxNode>
  ): { x: number; y: number } => {
    const terminalId = getNodeId(terminal as unknown as HierNode);
    const terminalLabel = g.selectAll<SVGTextElement, HierNode>('.terminal-label')
      .filter(function exactTerminal(candidate) {
        return getNodeId(candidate) === terminalId
          || this.getAttribute('data-node-id') === terminalId;
      })
      .node();
    const space = g.node();
    const matrix = space?.getScreenCTM();
    if (terminalLabel && matrix) {
      const rect = terminalLabel.getBoundingClientRect();
      if (rect.width || rect.height) {
        const point = new DOMPoint(rect.left + rect.width / 2, rect.bottom)
          .matrixTransform(matrix.inverse());
        return { x: point.x, y: point.y + SHELL_ATTACHMENT_CLEARANCE.bottom };
      }
    }
    return { x: terminal.x, y: terminal.y + TERMINAL_ATTACHMENT_Y };
  };
  const measuredTreeTextTopY = (): number => {
    const space = g.node();
    const matrix = space?.getScreenCTM();
    if (!matrix) return TRAJECTORY_ROUTES.textTopFallbackY;
    const inverse = matrix.inverse();
    const tops = g.selectAll<SVGTextElement, HierNode>('.category-label, .terminal-label')
      .nodes()
      .map((label) => label.getBoundingClientRect())
      .filter((rect) => rect.width || rect.height)
      .map((rect) => new DOMPoint(rect.left, rect.top).matrixTransform(inverse).y);
    return d3.min(tops) ?? TRAJECTORY_ROUTES.textTopFallbackY;
  };
  /** Every painted category label and word, each in tree units. */
  const measuredTreeLabelRects = () => g.selectAll<SVGTextElement, HierNode>('.category-label, .terminal-label')
    .nodes()
    .map((label) => measureGraphicsElementsInTreeSpace([label]))
    .filter((rect): rect is { x: number; y: number; width: number; height: number } =>
      Boolean(rect && (rect.width || rect.height)));
  const measuredTerminalSubtreeRectNow = (nodeId: string) => {
    const anchor = overlayNodeById.get(nodeId);
    if (!anchor) return null;
    const subtreeIds = new Set(
      anchor.descendants().map((candidate) => getNodeId(candidate as unknown as HierNode))
    );
    const labels = g.selectAll<SVGTextElement, HierNode>('.terminal-label')
      .filter((candidate) => subtreeIds.has(getNodeId(candidate)))
      .nodes();
    return measureGraphicsElementsInTreeSpace(labels);
  };
  const measuredTreeLabelRectNow = (nodeId: string, subtree: boolean) => {
    const anchor = overlayNodeById.get(nodeId);
    if (!anchor) return null;
    const nodeIds = new Set(
      (subtree ? anchor.descendants() : [anchor])
        .map((candidate) => getNodeId(candidate as unknown as HierNode))
    );
    const labels = g.selectAll<SVGTextElement, HierNode>(
      subtree ? '.category-label, .terminal-label' : '.category-label'
    )
      .filter((candidate) => nodeIds.has(getNodeId(candidate)))
      .nodes();
    return measureGraphicsElementsInTreeSpace(labels);
  };
  const exactScreenTreeLabelRectNow = (nodeId: string, subtree: boolean) => {
    const anchor = subtree ? overlayNodeById.get(nodeId) : null;
    const nodeIds = new Set([
      nodeId,
      ...(anchor
        ? anchor.descendants().map((candidate) => getNodeId(candidate as unknown as HierNode))
        : [])
    ]);
    const labels = g.selectAll<SVGTextElement, HierNode>(
      subtree ? '.category-label, .terminal-label' : '.category-label'
    )
      .filter(function exactAuthoredNodeLabel() {
        return [...nodeIds].some((candidateId) =>
          labelBelongsToNode(this, candidateId));
      })
      .nodes();
    return measureScreenGraphics(g, labels);
  };
  const exactScreenDirectTreeLabelRectNow = (nodeId: string) => {
    const labels = g.selectAll<SVGTextElement, HierNode>('.category-label, .terminal-label')
      .filter(function exactAuthoredDirectNodeLabel() {
        return labelBelongsToNode(this, String(nodeId));
      })
      .nodes();
    return measureScreenGraphics(g, labels);
  };
  const exactScreenTreeLabelRectForNodeIdsNow = (nodeIds: string[]) => {
    const expandedNodeIds = new Set<string>();
    nodeIds.forEach((nodeId) => {
      expandedNodeIds.add(nodeId);
      overlayNodeById.get(nodeId)?.descendants().forEach((candidate) => {
        expandedNodeIds.add(getNodeId(candidate as unknown as HierNode));
      });
    });
    const labels = g.selectAll<SVGTextElement, HierNode>('.category-label, .terminal-label')
      .filter(function exactAuthoredSubtrees() {
        return [...expandedNodeIds].some((candidateId) =>
          labelBelongsToNode(this, candidateId));
      })
      .nodes();
    return measureScreenGraphics(g, labels);
  };
  return {
    measuredShellBottom,
    measuredShellTop,
    measuredTerminalBottom,
    measuredTreeTextTopY,
    measuredTreeLabelRects,
    measuredTerminalSubtreeRectNow,
    measuredTreeLabelRectNow,
    exactScreenTreeLabelRectNow,
    exactScreenDirectTreeLabelRectNow,
    exactScreenTreeLabelRectForNodeIdsNow
  };
}

/** Convert viewport glyph bounds back to the tree group after fitting or manual zoom. */
export function measureScreenGraphics(g: DrawingLayer, labels: SVGGraphicsElement[]) {
  const matrix = g.node()?.getScreenCTM();
  if (!matrix || labels.length === 0) return null;
  const inverse = matrix.inverse();
  const points: DOMPoint[] = [];
  labels.forEach((label) => {
    const rect = label.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    [
      [rect.left, rect.top],
      [rect.right, rect.top],
      [rect.right, rect.bottom],
      [rect.left, rect.bottom]
    ].forEach(([x, y]) => {
      points.push(new DOMPoint(x, y).matrixTransform(inverse));
    });
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
}

/** The glyph cells of every painted tree label, outlines included
 * (`outlinedTreeLabelCell`), in tree units: one per line of a wrapped category
 * label and one per index run after it; one for a word or an unwrapped label
 * with its indices. `visibleNodeIds` limits them to the step's painted syntax.
 * `runsFor` gives a node's labels as the step paints them once its relations
 * are drawn (`treeLabelRunsForStep` with relation indices); each such label is
 * measured from a hidden copy, so index letters added later already count.
 * Labels without runs are measured as they stand. Every copy is mounted
 * before any is measured, so the browser lays the tree out once. */
export function measurePaintedTreeLabelCells(g: DrawingLayer, visibleNodeIds: ReadonlySet<string> | null,
  runsFor?: (nodeId: string) => readonly TreeLabelRuns[] | undefined) {
  const namespace = 'http://www.w3.org/2000/svg';
  const labels: Array<{ label: SVGTextElement; kind: 'category' | 'terminal'; copy: boolean }> = [];
  g.selectAll<SVGTextElement, HierNode>('.node-group .category-label, .node-group .terminal-label').each(function () {
    const group = this.closest('.node-group');
    const nodeId = group?.getAttribute('data-node-group-id');
    if (!group || !nodeId || visibleNodeIds && !visibleNodeIds.has(nodeId) || group.getAttribute('opacity') === '0') return;
    const kind = this.classList.contains('category-label') ? 'category' : 'terminal';
    const run = runsFor?.(nodeId)?.find(candidate => candidate.kind === kind);
    if (!run) {
      labels.push({ label: this, kind, copy: false });
      return;
    }
    const label = this.cloneNode(false) as SVGTextElement;
    label.removeAttribute('class');
    label.removeAttribute('id');
    label.setAttribute('visibility', 'hidden');
    label.setAttribute('aria-hidden', 'true');
    if (run.lines) run.lines.forEach((line, index) => {
      const span = document.createElementNS(namespace, 'tspan');
      span.setAttribute('x', '0');
      span.setAttribute('y', String(categoryLineBaselineY(index, run.lines!.length)));
      span.textContent = line;
      label.appendChild(span);
    });
    else label.textContent = run.text;
    run.indices.forEach((index) => {
      const span = document.createElementNS(namespace, 'tspan');
      for (const [name, value] of Object.entries(treeLabelIndexAttributes(run.kind, index.mode))) span.setAttribute(name, value);
      span.textContent = index.text;
      label.appendChild(span);
    });
    group.appendChild(label);
    labels.push({ label, kind, copy: true });
  });
  try {
    return labels.flatMap(({ label, kind }) => {
      const spans = [...label.children].filter((child): child is SVGTSpanElement => child.tagName.toLowerCase() === 'tspan');
      const pieces: SVGGraphicsElement[] = kind === 'category' && spans.some(span => span.hasAttribute('y'))
        ? spans as unknown as SVGGraphicsElement[] : [label];
      return pieces.flatMap((piece) => {
        const cell = measureScreenGraphics(g, [piece]);
        return cell && (cell.width || cell.height) ? [outlinedTreeLabelCell(cell, kind)] : [];
      });
    });
  } finally {
    labels.forEach(({ label, copy }) => { if (copy) label.remove(); });
  }
}
