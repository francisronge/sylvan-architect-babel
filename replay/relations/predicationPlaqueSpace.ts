import type { HierarchyPointNode } from 'd3';
import type { SyntaxNode } from '../../types.ts';
import type { CategoryTextMeasure } from '../categoryTextLayout.ts';
import { getNodeId } from '../displayIdentity.ts';
import { indexHierarchyNodesByIdAndAliases } from '../replayCanvas.ts';
import { isDisplayTerminalNode } from '../replaySurfaceNotation.ts';
import { treeInkObstacles, type TreeInkTextMeasure } from '../treeInkGeometry.ts';
import type { TreeLabelBounds, TreeLabelMeasure, TreeLabelRuns } from '../treeLabelRuns.ts';
import type { Rect } from './overlayGeometry.ts';
import { predicationPaths } from './predicationGeometry.ts';
import type { RelationPlanItem } from './renderPlan.ts';
import { resolveUniqueDisplayTerminal } from './trajectoryAttachment.ts';

type Node = HierarchyPointNode<SyntaxNode>;
type LabelEnvelope = {
  leftMin: number; leftMax: number; rightMin: number; rightMax: number;
  top: number; bottomMin: number; bottomMax: number;
};

/** Reserve existing predication ink. Text variants widen the reservation, never
 * the connector; missing metrics retain the conservative syntax envelope. */
export function predicationPlaqueObstacles(items: RelationPlanItem[], nodes: Node[], {
  measureCategoryText, measureTreeInk, labels, measureTreeLabel
}: {
  measureCategoryText?: CategoryTextMeasure;
  measureTreeInk?: TreeInkTextMeasure;
  labels?: ReadonlyMap<string, readonly TreeLabelRuns[]>;
  measureTreeLabel?: TreeLabelMeasure;
} = {}): Rect[] {
  const predications = items.filter(item => item.kind === 'undirected-link' && item.linkStyle === 'predication');
  if (!predications.length) return [];
  const byId = indexHierarchyNodesByIdAndAliases(nodes), visible = new Set(nodes);
  const fallback = new Map<string, Rect[]>();
  for (const box of treeInkObstacles(nodes, measureCategoryText, measureTreeInk)) {
    if (!box.connectorAttachment) continue;
    const group = fallback.get(box.connectorAttachment) ?? [];
    group.push(box); fallback.set(box.connectorAttachment, group);
  }
  const labelEnvelopes = new Map<string, LabelEnvelope>();
  for (const node of nodes) for (const kind of ['category', 'terminal'] as const) {
    const id = getNodeId(node), key = `${id}:${kind}`, old = fallback.get(key);
    if (!old?.length) continue;
    const runs = labels?.get(id)?.filter(run => run.kind === kind) ?? [];
    const measured = runs.map(run => measureTreeLabel?.(run));
    const complete = measured.length > 0 && measured.every((box): box is TreeLabelBounds => Boolean(box
      && [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0));
    const boxes = complete ? measured.map(box => ({ ...box, x: node.x + box.x, y: node.y + box.y })) : old;
    const left = Math.min(...boxes.map(box => box.x)), right = Math.max(...boxes.map(box => box.x + box.width));
    const top = Math.min(...boxes.map(box => box.y)), bottom = Math.max(...boxes.map(box => box.y + box.height));
    labelEnvelopes.set(key, {
      leftMin: left, rightMax: right, top, bottomMax: bottom,
      leftMax: complete ? Math.max(...boxes.map(box => box.x)) : right,
      rightMin: complete ? Math.min(...boxes.map(box => box.x + box.width)) : left,
      bottomMin: complete ? Math.min(...boxes.map(box => box.y + box.height)) : top
    });
  }
  const anchors = new Map<string, { rect: Rect; centerMin: number; centerMax: number; bottomRange: number }>();
  const anchor = (id: string) => {
    const cached = anchors.get(id);
    if (cached) return cached;
    const node = byId.get(id);
    if (!node) return null;
    const own = (node: Node, kind: string) => labelEnvelopes.get(`${getNodeId(node)}:${kind}`);
    const parts = /P$/.test(String(node.data.label || ''))
      ? node.descendants().filter(child => visible.has(child)).flatMap(child => [own(child, 'category'), own(child, 'terminal')])
      : [own(node, 'category'), own(resolveUniqueDisplayTerminal(node, child => child.children || [],
        child => isDisplayTerminalNode(child.data)).terminal ?? node, 'terminal')];
    const boxes = parts.filter((box): box is LabelEnvelope => Boolean(box));
    if (!boxes.length) return null;
    const x = Math.min(...boxes.map(box => box.leftMin)), y = Math.min(...boxes.map(box => box.top));
    const right = Math.max(...boxes.map(box => box.rightMax)), bottom = Math.max(...boxes.map(box => box.bottomMax));
    const value = { rect: { x, y, width: right - x, height: bottom - y },
      centerMin: (x + Math.max(...boxes.map(box => box.rightMin))) / 2,
      centerMax: (Math.min(...boxes.map(box => box.leftMax)) + right) / 2,
      bottomRange: bottom - Math.max(...boxes.map(box => box.bottomMin)) };
    anchors.set(id, value);
    return value;
  };
  const obstacles: Rect[] = [];
  const reserve = (left: number, right: number, top: number, bottom: number) => obstacles.push({
    x: left - 5, y: top - 5, width: right - left + 10, height: bottom - top + 10
  });
  for (const item of predications) {
    if (item.kind !== 'undirected-link') continue;
    const paths = predicationPaths(item.pairs, id => anchor(id)?.rect ?? null);
    const laneRange = Math.max(0, ...item.pairs.flatMap(pair =>
      [anchor(pair.fromNodeId)?.bottomRange ?? 0, anchor(pair.toNodeId)?.bottomRange ?? 0]));
    // A text variant can swap equally close predicates. Reserve their existing
    // lane band, including source offsets, without choosing a new drawing order.
    const groups = new Map<string, { leftOffset: number; rightOffset: number; top: number; bottom: number }>();
    for (const { pairIndex, points: [source, turn] } of paths) {
      const id = item.pairs[pairIndex].fromNodeId, from = anchor(id)!;
      const offset = source.x - (from.rect.x + from.rect.width / 2), previous = groups.get(id);
      groups.set(id, { leftOffset: Math.min(previous?.leftOffset ?? offset, offset),
        rightOffset: Math.max(previous?.rightOffset ?? offset, offset),
        top: Math.min(previous?.top ?? turn.y, turn.y), bottom: Math.max(previous?.bottom ?? turn.y, turn.y) });
    }
    for (const { pairIndex, points: [source, , , target] } of paths) {
      const pair = item.pairs[pairIndex], from = anchor(pair.fromNodeId)!, to = anchor(pair.toNodeId)!;
      const group = groups.get(pair.fromNodeId)!;
      const left = from.centerMin + group.leftOffset, right = from.centerMax + group.rightOffset;
      reserve(left, right, Math.min(source.y - from.bottomRange, group.top - laneRange), Math.max(source.y, group.bottom));
      reserve(Math.min(left, to.centerMin), Math.max(right, to.centerMax), group.top - laneRange, group.bottom);
      reserve(to.centerMin, to.centerMax, Math.min(target.y - to.bottomRange, group.top - laneRange), Math.max(target.y, group.bottom));
    }
  }
  return obstacles;
}
