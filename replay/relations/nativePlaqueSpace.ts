import type { HierarchyPointNode } from 'd3';
import type { SyntaxNode } from '../../types.ts';
import type { CategoryTextMeasure } from '../categoryTextLayout.ts';
import { getNodeId } from '../displayIdentity.ts';
import { indexHierarchyNodesByIdAndAliases } from '../replayCanvas.ts';
import { isDisplayTerminalNode } from '../replaySurfaceNotation.ts';
import { treeInkObstacles, type TreeInkTextMeasure } from '../treeInkGeometry.ts';
import type { TreeLabelBounds, TreeLabelMeasure, TreeLabelRuns } from '../treeLabelRuns.ts';
import { dependentCaseStatePlaques } from './markGeometry.ts';
import { nativeRelationPlaqueRects, type PlaqueRect } from './plaquePlacement.ts';
import type { PlaqueTextMeasure } from './plaqueTextLayout.ts';
import type { RelationPlanItem } from './renderPlan.ts';

type Node = HierarchyPointNode<SyntaxNode>;

/** Fixed native plaques keep their geometry. Other plaques reserve their full
 * measured footprint, including the range of retained terminal/index variants. */
export function nativePlaqueObstacles(items: RelationPlanItem[], nodes: Node[], {
  measureCategoryText, measureTreeInk, labels, measureTreeLabel, measurePlaqueText
}: {
  measureCategoryText?: CategoryTextMeasure;
  measureTreeInk?: TreeInkTextMeasure;
  labels?: ReadonlyMap<string, readonly TreeLabelRuns[]>;
  measureTreeLabel?: TreeLabelMeasure;
  measurePlaqueText?: PlaqueTextMeasure;
} = {}): PlaqueRect[] {
  const fixed = items.filter(item => item.kind === 'undirected-link' && item.linkStyle === 'feature-sharing'
    || item.kind === 'directed-path' && item.pathStyle === 'dependent-case');
  if (!fixed.length) return [];
  const visible = new Set(nodes), byId = indexHierarchyNodesByIdAndAliases(nodes);
  const fallback = new Map<string, PlaqueRect[]>();
  for (const box of treeInkObstacles(nodes, measureCategoryText, measureTreeInk)) {
    if (!box.connectorAttachment) continue;
    const group = fallback.get(box.connectorAttachment) ?? [];
    group.push(box); fallback.set(box.connectorAttachment, group);
  }
  const rectangles = (node: Node, kind: 'category' | 'terminal') => {
    const runs = labels?.get(getNodeId(node))?.filter(run => run.kind === kind) ?? [];
    const boxes = runs.map(run => measureTreeLabel?.(run));
    const complete = boxes.length > 0 && boxes.every((box): box is TreeLabelBounds => Boolean(box
      && [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0));
    return complete ? boxes.map(box => ({ ...box, x: node.x + box.x, y: node.y + box.y }))
      : fallback.get(`${getNodeId(node)}:${kind}`) ?? [];
  };
  const anchors = new Map<string, [PlaqueRect, PlaqueRect] | null>();
  const anchor = (id: string, terminal: boolean) => {
    const key = `${id}:${terminal}`;
    if (anchors.has(key)) return anchors.get(key)!;
    const node = byId.get(id);
    if (!node) return null;
    const leaves = terminal ? node.descendants().filter(child => visible.has(child) && isDisplayTerminalNode(child.data)) : [];
    const groups = (leaves.length ? leaves : [node]).map(child => rectangles(child, leaves.length ? 'terminal' : 'category'));
    if (groups.some(group => !group.length)) { anchors.set(key, null); return null; }
    const edge = (maximum: boolean) => {
      const select = maximum ? Math.max : Math.min;
      const left = Math.min(...groups.map(group => select(...group.map(box => box.x))));
      const right = Math.max(...groups.map(group => select(...group.map(box => box.x + box.width))));
      const top = Math.min(...groups.map(group => select(...group.map(box => box.y))));
      const bottom = Math.max(...groups.map(group => select(...group.map(box => box.y + box.height))));
      return { x: left, y: top, width: right - left, height: bottom - top };
    };
    const result: [PlaqueRect, PlaqueRect] = [edge(false), edge(true)];
    anchors.set(key, result); return result;
  };
  return fixed.flatMap(item => {
    let alternatives: PlaqueRect[][];
    if (item.kind === 'directed-path') {
      const probe = anchor(item.fromNodeId, true), goal = anchor(item.toNodeId, true);
      const probeCategory = anchor(item.fromNodeId, false), goalCategory = anchor(item.toNodeId, false);
      if (!probe || !goal || !probeCategory || !goalCategory) return [];
      const centre = (box: PlaqueRect) => box.y + box.height / 2;
      // Independent label variants may reverse which category is higher.
      const orders = [
        ...(centre(probeCategory[0]) <= centre(goalCategory[1]) ? [true] : []),
        ...(centre(probeCategory[1]) > centre(goalCategory[0]) ? [false] : [])
      ];
      alternatives = probe.flatMap(source => goal.flatMap(target => orders.map(higher => Object.values(
        dependentCaseStatePlaques(source, target, item.label ?? '', item.secondaryLabel ?? '',
          item.dependentCaseStep ?? '2', higher)
      ))));
    } else {
      alternatives = [0, 1].map(edge => nativeRelationPlaqueRects([item],
        (id, terminal) => anchor(id, terminal)?.[edge] ?? null, measurePlaqueText));
    }
    return (alternatives[0] ?? []).map((box, index) => {
      const boxes = alternatives.map(rects => rects[index] ?? box);
      const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y));
      return { x: x - 6, y: y - 6,
        width: Math.max(...boxes.map(box => box.x + box.width)) - x + 12,
        height: Math.max(...boxes.map(box => box.y + box.height)) - y + 12, plaqueShell: true };
    });
  });
}
