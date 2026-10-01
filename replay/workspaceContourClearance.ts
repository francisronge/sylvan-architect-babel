import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import type { TreeCoordinateReservation } from './treeLayout.ts';
import { getNodeId, applyVizIds } from './displayIdentity.ts';
import { plaqueTreeObstacles } from './relations/plaquePlacement.ts';

type Scene = {
  canvas: SyntaxNode;
  nodes: Map<string, d3.HierarchyPointNode<SyntaxNode>>;
  visible: Set<string>;
  coordinates: TreeCoordinateReservation;
};

/** Translate independent components as units using clearance throughout the stage.
 * A common final component proves membership; ambiguous attachments keep their layout. */
export function separateWorkspaceContours<T extends Scene>(scenes: T[]): T[] {
  const root = [...scenes[0].nodes.values()][0];
  if (root.data.replayOrigin?.kind !== 'workspace' || !root.children || root.children.length < 2) return scenes;
  const groups = root.children.filter(node => !node.data.replayLayoutOnly);
  const membership = new Map(groups.flatMap((node, index) => node.descendants().map(node => [getNodeId(node), index] as const)));
  const constraints = new Map<string, number>();
  for (const scene of scenes) {
    const tree = d3.hierarchy(scene.canvas); applyVizIds(tree);
    const positioned = tree as d3.HierarchyPointNode<SyntaxNode>;
    positioned.each(node => {
      const point = scene.coordinates.get(getNodeId(node));
      if (point) { node.x = point.x; node.y = point.y; }
    });
    const visible = new Set(positioned.descendants().filter(node => scene.visible.has(getNodeId(node)) && !node.data.replayLayoutOnly));
    const components = positioned.descendants().filter(node => visible.has(node) && !visible.has(node.parent!));
    const boxes = groups.map(() => [] as ReturnType<typeof plaqueTreeObstacles>);
    for (const component of components) {
      const members = component.descendants().filter(node => visible.has(node));
      const owners = new Set(members.map(node => membership.get(getNodeId(node))).filter(owner => owner !== undefined));
      if (owners.size !== 1) return scenes;
      const owner = [...owners][0];
      members.forEach(node => membership.set(getNodeId(node), owner));
      boxes[owner].push(...plaqueTreeObstacles(members));
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      let gap = 0;
      for (const a of boxes[i]) for (const b of boxes[j]) {
        if (Math.min(a.y + a.height, b.y + b.height) <= Math.max(a.y, b.y)) continue;
        gap = Math.max(gap, a.x + a.width + 34 - b.x);
      }
      if (gap > 0) constraints.set(`${i},${j}`, Math.max(constraints.get(`${i},${j}`) ?? 0, gap));
    }
  }
  if (!constraints.size) return scenes;
  const shifts = groups.map(() => 0);
  for (let j = 1; j < groups.length; j++) for (let i = 0; i < j; i++) {
    shifts[j] = Math.max(shifts[j], shifts[i] + (constraints.get(`${i},${j}`) ?? 0));
  }
  // One translation per component keeps every native branch and earlier reveal intact.
  return scenes.map(scene => ({ ...scene, coordinates: new Map([...scene.coordinates].map(([id, point]) =>
    [id, { ...point, x: point.x + (shifts[membership.get(id) ?? -1] ?? 0) }])) }));
}
