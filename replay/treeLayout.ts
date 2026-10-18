import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { applyVizIds, getNodeId } from './displayIdentity.ts';
import type { CategoryTextMeasure } from './categoryTextLayout.ts';
import type { TreeInkTextMeasure } from './treeInkGeometry.ts';
import type { PreparedTreeLabelRuns, TreeLabelMeasure } from './treeLabelRuns.ts';
import { prepareWorkspaceLifetimeContours, workspaceLifetimeContourCoordinates } from './workspaceLifetimeContours.ts';
import { TREE_ROW_HEIGHT, TREE_SIBLING_GAP } from './treeSpacing.ts';
import type { PlaybackStep } from './types.ts';

export type TreeDirection = 'ltr' | 'rtl';
export type TreeCoordinateReservation = Map<string, { x: number; y: number }>;

type TreeLayoutMeasurements = {
  measureCategoryText?: CategoryTextMeasure;
  measureTreeInk?: TreeInkTextMeasure;
  treeLabelRuns?: PreparedTreeLabelRuns;
  measureTreeLabel?: TreeLabelMeasure;
};

/** Tidy positions in which a bare leaf between two sisters also occupies the
 * rows below it, down to its sisters' deepest row. Otherwise a sister's deeper
 * descendant can sit in the leaf's column, and the leaf's branch reads as that
 * descendant's parent. The column is layout-only and is never painted.
 * Columns are granted shallowest first and add at most one placeholder per real
 * node; nested forks beyond that budget keep the ordinary tidy shape. */
function tidyTree(root: d3.HierarchyNode<SyntaxNode>): d3.HierarchyPointNode<SyntaxNode> {
  const layout = d3.tree<SyntaxNode>().nodeSize([TREE_SIBLING_GAP / 2.5, TREE_ROW_HEIGHT])
    .separation((a, b) => a.parent === b.parent ? 2.5 : 3.5);
  const deepest = new Map<d3.HierarchyNode<SyntaxNode>, number>(), columns = new Map<SyntaxNode, number>();
  // Future scaffolding neither creates such a fork nor deepens one.
  const syntax = (node: d3.HierarchyNode<SyntaxNode>) => (node.children ?? []).filter(child => !child.data.replayLayoutOnly);
  let budget = 0;
  root.eachAfter(node => {
    budget++;
    deepest.set(node, Math.max(node.depth, ...syntax(node).map(child => deepest.get(child)!)));
  });
  root.each(node => {
    const children = syntax(node);
    if (children.length < 3 || node.data.replayOrigin?.kind === 'workspace') return;
    const bottom = Math.max(...children.map(child => deepest.get(child)!));
    for (const child of children.slice(1, -1)) {
      const rows = bottom - child.depth;
      if (child.children?.length || rows <= 0 || rows > budget) continue;
      columns.set(child.data, rows);
      budget -= rows;
    }
  });
  if (!columns.size) return layout(root);
  const column = new WeakMap<SyntaxNode, SyntaxNode[]>();
  for (const [leaf, rows] of columns) {
    let below: SyntaxNode[] = [];
    for (let row = 0; row < rows; row++) {
      const part = { id: '', label: '' } as SyntaxNode;
      column.set(part, below);
      below = [part];
    }
    column.set(leaf, below);
  }
  const placed = new Map<SyntaxNode, { x: number; y: number }>();
  layout(d3.hierarchy(root.data, data => column.get(data) ?? data.children))
    .each(({ data, x, y }) => placed.set(data, { x, y }));
  root.each(node => Object.assign(node, placed.get(node.data)));
  return root as d3.HierarchyPointNode<SyntaxNode>;
}

/** Reflect coordinates, never child order or glyphs. All geometry binds after this layout. */
export function layoutSyntaxTree(root: d3.HierarchyNode<SyntaxNode>, size: [number, number], direction: TreeDirection = 'ltr',
  reservation?: ReadonlyMap<string, { x: number; y: number }>, visibleIds?: ReadonlySet<string>, measurements: TreeLayoutMeasurements = {}) {
  applyVizIds(root);
  const tree = tidyTree(root);
  tree.each(node => { node.x += size[0] / 2; });
  if (!reservation && (measurements.measureCategoryText || measurements.measureTreeInk
    || measurements.treeLabelRuns || measurements.measureTreeLabel)) {
    // A single current scene uses the same ink-aware contour packing as Replay.
    // There is no lookahead here: hidden scaffolding contributes no local shape.
    const step = { replayCanvasData: root.data, replayKind: 'macro', replayFrameIndex: 0,
      replayVisibleNodeIds: [...(visibleIds ?? tree.descendants().map(getNodeId))] } as PlaybackStep;
    const points = workspaceLifetimeContourCoordinates(
      prepareWorkspaceLifetimeContours([step], measurements.measureCategoryText,
        measurements.measureTreeInk, measurements.treeLabelRuns, measurements.measureTreeLabel, direction)()
    ).get(root.data)!;
    const xs = [...points.values()].map(point => point.x);
    const offset = xs.length ? size[0] / 2 - (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
    tree.each(node => {
      const point = points.get(getNodeId(node));
      if (point) { node.x = point.x + offset; node.y = point.y; }
    });
  }
  if (reservation) tree.each(node => {
    const position = reservation.get(getNodeId(node));
    if (position) { node.x = position.x; node.y = position.y; }
  });
  // A reservation places occurrences, never a future branch. Current parents
  // remain centered above their actual children as new structure appears.
  tree.eachAfter(node => {
    if (node.data.replayLayoutOnly || !node.children?.length || (visibleIds && !visibleIds.has(getNodeId(node)))) return;
    const current = node.children.filter(child => !child.data.replayLayoutOnly && (!visibleIds || visibleIds.has(getNodeId(child))));
    if (reservation && current.length) {
      const center = (current[0].x + current[current.length - 1].x) / 2;
      if (Math.abs(node.x - center) > 1e-8) node.x = center;
    }
    else if (current.length === 1 && current.length < node.children.length) node.x = current[0].x;
  });
  if (direction === 'rtl') tree.each(node => { node.x = size[0] - node.x; });
  return tree;
}
