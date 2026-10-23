import type { HierarchyPointNode } from 'd3';
import type { SyntaxNode } from '../../types.ts';
import type { CategoryTextMeasure } from '../categoryTextLayout.ts';
import { getNodeId } from '../displayIdentity.ts';
import { indexHierarchyNodesByIdAndAliases } from '../replayCanvas.ts';
import { treeInkObstacles, type TreeInkTextMeasure } from '../treeInkGeometry.ts';
import { controlDependencyRoute, controlDomainBox } from './markGeometry.ts';
import type { PlaqueRect } from './plaquePlacement.ts';
import { boundingRect } from './rectGeometry.ts';
import type { RelationPlanItem } from './renderPlan.ts';

type Node = HierarchyPointNode<SyntaxNode>;

/** Reserve each control dependency's painted elbow (markGeometry.ts,
 * controlDependencyRoute) before placing plaques, so a plaque never sits on its
 * dashed runs. The renderer draws the elbow from measured labels; this estimates
 * them from tree ink. Like a trajectory, each run keeps the full plaque gap. */
export function controlPlaqueObstacles(items: RelationPlanItem[], nodes: Node[], {
  measureCategoryText, measureTreeInk
}: { measureCategoryText?: CategoryTextMeasure; measureTreeInk?: TreeInkTextMeasure } = {}): PlaqueRect[] {
  const controls = items.filter(item => item.kind === 'directed-path' && item.familyId === 'control.dependency'
    && item.pathStyle === 'control');
  if (!controls.length) return [];
  const byId = indexHierarchyNodesByIdAndAliases(nodes), visible = new Set(nodes);
  const ink = new Map<string, PlaqueRect[]>();
  for (const box of treeInkObstacles(nodes, measureCategoryText, measureTreeInk)) {
    if (!box.connectorAttachment) continue;
    const group = ink.get(box.connectorAttachment) ?? [];
    group.push(box); ink.set(box.connectorAttachment, group);
  }
  const labels = (node: Node, kind: 'category' | 'terminal') => ink.get(`${getNodeId(node)}:${kind}`) ?? [];
  const subtree = (node: Node) => node.descendants().filter(child => visible.has(child));
  const union = (rects: PlaqueRect[]) => rects.length ? boundingRect(rects) : null;
  // bindingRefinements.ts measures the shell label, then the word, then the subtree.
  const anchorRect = (id: string) => {
    const node = byId.get(id);
    return node ? union(labels(node, 'category')) ?? union(labels(node, 'terminal'))
      ?? union(subtree(node).flatMap(child => [...labels(child, 'category'), ...labels(child, 'terminal')])) : null;
  };
  const obstacles: PlaqueRect[] = [];
  for (const item of controls) {
    if (item.kind !== 'directed-path') continue;
    const controller = anchorRect(item.fromNodeId), controllee = anchorRect(item.toNodeId);
    if (!controller || !controllee) continue;
    const domainItem = items.find(other => other.kind === 'domain-mark' && other.domainStyle === 'control-domain'
      && other.familyId === 'control.dependency' && other.relationRef.stageIndex === item.relationRef.stageIndex
      && other.relationRef.relationIndex === item.relationRef.relationIndex);
    const domainNode = domainItem?.kind === 'domain-mark' && domainItem.rootNodeId ? byId.get(domainItem.rootNodeId) : undefined;
    const domainWords = domainNode && union(subtree(domainNode).flatMap(child => labels(child, 'terminal')));
    const route = controlDependencyRoute(controller, controllee, domainWords ? controlDomainBox(domainWords) : null);
    route.slice(1).forEach((point, index) => {
      const from = route[index];
      obstacles.push({ x: Math.min(from.x, point.x) - 5, y: Math.min(from.y, point.y) - 5,
        width: Math.abs(point.x - from.x) + 10, height: Math.abs(point.y - from.y) + 10, trajectory: true });
    });
  }
  return obstacles;
}
