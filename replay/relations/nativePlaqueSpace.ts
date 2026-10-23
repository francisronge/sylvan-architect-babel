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
import { boundingRect } from './rectGeometry.ts';
import type { RelationPlanItem } from './renderPlan.ts';

type Node = HierarchyPointNode<SyntaxNode>;

type NativePlaqueMeasures = {
  measureCategoryText?: CategoryTextMeasure;
  measureTreeInk?: TreeInkTextMeasure;
  labels?: ReadonlyMap<string, readonly TreeLabelRuns[]>;
  measureTreeLabel?: TreeLabelMeasure;
  measurePlaqueText?: PlaqueTextMeasure;
};

/** Fixed native plaques keep their geometry. Other plaques reserve their full
 * measured footprint, including the range of retained terminal/index variants. */
export function nativePlaqueObstacles(items: RelationPlanItem[], nodes: Node[], measures: NativePlaqueMeasures = {}): PlaqueRect[] {
  return nativePlaqueFootprints(items, nodes, measures).map(bounds =>
    ({ x: bounds.x - 6, y: bounds.y - 6, width: bounds.width + 12, height: bounds.height + 12, plaqueShell: true }));
}

/** Each fixed native plaque's measured footprint: the union of its boxes over the
 * retained label variants of its anchors. Allocation reserves it and the stage
 * camera fits it, so both read the same measured labels. */
export function nativePlaqueFootprints(items: RelationPlanItem[], nodes: Node[], {
  measureCategoryText, measureTreeInk, labels, measureTreeLabel, measurePlaqueText
}: NativePlaqueMeasures = {}): PlaqueRect[] {
  const fixed = items.filter(item => item.kind === 'undirected-link' && item.linkStyle === 'feature-sharing'
    || item.kind === 'directed-path' && item.pathStyle === 'dependent-case');
  if (!fixed.length) return [];
  const visible = new Set(nodes), byId = indexHierarchyNodesByIdAndAliases(nodes);
  // A label's own boxes depend only on its node, so the conservative fallback is
  // measured only for nodes that lack complete label metrics, when first needed.
  const sameId = new Map<string, Node[]>();
  for (const node of nodes) {
    const group = sameId.get(getNodeId(node));
    if (group) group.push(node); else sameId.set(getNodeId(node), [node]);
  }
  const fallbacks = new Map<string, Map<string, PlaqueRect[]>>();
  const fallbackFor = (id: string) => {
    let fallback = fallbacks.get(id);
    if (!fallback) {
      fallbacks.set(id, fallback = new Map());
      for (const box of treeInkObstacles(sameId.get(id) ?? [], measureCategoryText, measureTreeInk)) {
        if (!box.connectorAttachment) continue;
        const group = fallback.get(box.connectorAttachment) ?? [];
        group.push(box); fallback.set(box.connectorAttachment, group);
      }
    }
    return fallback;
  };
  const rectangles = (node: Node, kind: 'category' | 'terminal') => {
    const runs = labels?.get(getNodeId(node))?.filter(run => run.kind === kind) ?? [];
    const boxes = runs.map(run => measureTreeLabel?.(run));
    const complete = boxes.length > 0 && boxes.every((box): box is TreeLabelBounds => Boolean(box
      && [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0));
    return complete ? boxes.map(box => ({ ...box, x: node.x + box.x, y: node.y + box.y }))
      : fallbackFor(getNodeId(node)).get(`${getNodeId(node)}:${kind}`) ?? [];
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
    return (alternatives[0] ?? []).map((box, index) => boundingRect(alternatives.map(rects => rects[index] ?? box)));
  });
}
