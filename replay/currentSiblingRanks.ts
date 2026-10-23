import type * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { getNodeId } from './displayIdentity.ts';
import { visibleComponentNodes } from './visibleComponent.ts';
import type { TreeCoordinateReservation } from './treeLayout.ts';

type Scene = {
  nodes: ReadonlyMap<string, d3.HierarchyPointNode<SyntaxNode>>;
  visible: ReadonlySet<string>;
};
const isSyntax = (node: d3.HierarchyPointNode<SyntaxNode>) =>
  !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace';
const syntaxParent = (node: d3.HierarchyPointNode<SyntaxNode>) => {
  let ancestor = node.parent;
  while (ancestor && !isSyntax(ancestor)) ancestor = ancestor.parent;
  return ancestor ?? undefined;
};
/** Whether a future node's nearest syntax ancestors, below `parentId`, are all
 * unseen and at least one exists: `parentId` is a strict, non-immediate syntax
 * ancestor of `node` with no current ancestor between them. Walks only as far
 * as the answer requires. */
const awaitsUnseenWrapper = (node: d3.HierarchyPointNode<SyntaxNode>, parentId: string, visible: ReadonlySet<string>) => {
  let between = 0;
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (!isSyntax(ancestor)) continue;
    const id = getNodeId(ancestor);
    if (id === parentId) return between > 0;
    if (visible.has(id)) return false;
    between++;
  }
  return false;
};

/** An unbuilt wrapper cannot deepen just one current daughter. Retain the
 * unaffected sister's rank and translate the wrapped subtree as a unit. Both
 * stage-local and cross-stage reservations must preserve this current fork. */
export function retainCurrentSiblingRanks(current: Scene & { coordinates: TreeCoordinateReservation },
  future: Scene, retained: ReadonlyMap<string, { x: number; y: number }> = new Map(),
  relocated: ReadonlySet<string> = new Set()): void {
  const { coordinates } = current;
  const visibleNodes = new Map([...current.nodes].filter(([id]) => current.visible.has(id)));
  current.nodes.forEach(parent => {
    if (parent.data.replayLayoutOnly || parent.data.replayOrigin?.kind === 'workspace'
      || !current.visible.has(getNodeId(parent))) return;
    const children = (parent.children ?? []).filter(child =>
      !child.data.replayLayoutOnly && current.visible.has(getNodeId(child)));
    const sister = children.find(child => {
      const other = future.nodes.get(getNodeId(child));
      return other && syntaxParent(other) && getNodeId(syntaxParent(other)!) === getNodeId(parent);
    });
    if (!sister) return;
    const rank = (retained.get(getNodeId(sister)) ?? coordinates.get(getNodeId(sister)))!.y;
    for (const child of children) {
      const other = future.nodes.get(getNodeId(child));
      if (!other || relocated.has(getNodeId(child))) continue;
      if (!awaitsUnseenWrapper(other, getNodeId(parent), current.visible)) continue;
      const delta = rank - coordinates.get(getNodeId(child))!.y;
      for (const descendant of visibleComponentNodes(child, visibleNodes)) {
        const id = getNodeId(descendant), point = coordinates.get(id);
        if (point) coordinates.set(id, { ...point, y: point.y + delta });
      }
    }
  });
}

type CurrentScene = Scene & { coordinates: TreeCoordinateReservation };
type PointNode = d3.HierarchyPointNode<SyntaxNode>;

const visibleChildren = (node: PointNode, scene: Scene) => (node.children ?? []).filter(child =>
  !child.data.replayLayoutOnly && scene.visible.has(getNodeId(child)));

/** Current edges whose parent's visible daughters will each later receive an
 * unseen wrapper between them and that parent: a unary edge, or every edge of
 * a fork that no daughter keeps as its own parent (a fork with such a daughter
 * belongs to retainCurrentSiblingRanks). `unary` limits the result to the
 * former. */
const edgesAwaitingInsertion = (current: Scene, future: Scene, unary = false): Array<{ parent: PointNode; child: PointNode }> => {
  const edges: Array<{ parent: PointNode; child: PointNode }> = [];
  current.nodes.forEach(parent => {
    if (parent.data.replayLayoutOnly || parent.data.replayOrigin?.kind === 'workspace'
      || !current.visible.has(getNodeId(parent))) return;
    const children = visibleChildren(parent, current);
    if (!children.length || unary && children.length !== 1) return;
    if (!children.every(child => {
      const other = future.nodes.get(getNodeId(child));
      return other && awaitsUnseenWrapper(other, getNodeId(parent), current.visible);
    })) return;
    for (const child of children) edges.push({ parent, child });
  });
  return edges;
};

/** A current parent's daughters stand one native row below it until the unseen
 * wrapper above them is inserted; the wrapper's row is reserved but never
 * drawn as a longer branch. By default the daughters keep the current rank and
 * drop a row at the insertion. With `lowerSmallerAbove` (for the steps of one
 * stage, whose final layout is fixed), a fork whose waiting daughters carry
 * more visible syntax than the rest of their tree instead lowers that rest:
 * the smaller side rises at the insertion and the larger keeps its final row.
 * Apply this after contour reservation: changing a rank must not change the
 * contour solver's coordinate lifetimes or the completed tree's width. */
export function retainCurrentDaughterRanks(current: CurrentScene, future: Scene,
  { lowerSmallerAbove = false }: { lowerSmallerAbove?: boolean } = {}): void {
  const { coordinates } = current;
  const visibleNodes = new Map([...current.nodes].filter(([id]) => current.visible.has(id)));
  const shift = (nodes: Iterable<PointNode>, delta: number) => {
    for (const node of nodes) {
      const id = getNodeId(node), point = coordinates.get(id);
      if (point) coordinates.set(id, { ...point, y: point.y + delta });
    }
  };
  const forks = new Map<PointNode, PointNode[]>();
  for (const { parent, child } of edgesAwaitingInsertion(current, future))
    forks.set(parent, [...(forks.get(parent) ?? []), child]);
  forks.forEach((children, parent) => {
    const deltas = children.map(child => {
      const gap = child.y - parent.y;
      return Number.isFinite(gap) && gap > 0
        ? coordinates.get(getNodeId(parent))!.y + gap - coordinates.get(getNodeId(child))!.y : 0;
    });
    if (lowerSmallerAbove && children.length > 1 && deltas.every(delta => Math.abs(delta - deltas[0]) < 1e-8 && delta < -1e-8)) {
      const below = new Set(children.flatMap(child => visibleComponentNodes(child, visibleNodes)));
      let top = parent;
      for (let up = syntaxParent(top); up && current.visible.has(getNodeId(up)); up = syntaxParent(up)) top = up;
      const above = visibleComponentNodes(top, visibleNodes).filter(node => !below.has(node));
      if (above.length < below.size) { shift(above, -deltas[0]); return; }
    }
    children.forEach((child, index) => {
      if (deltas[index] < -1e-8) shift(visibleComponentNodes(child, visibleNodes), deltas[index]);
    });
  });
}

/** Cross-stage reservations copy each member's future row back through its
 * lifetime, so a current unary parent would otherwise wait at the height it
 * needs after later insertions and show a stretched branch. When that parent
 * and every visible ancestor above it are unary, lower the whole spine to one
 * native row above its child: lexical material keeps its reserved slot and the
 * spine rises one row at each authored insertion. A spine with a fork above it
 * cannot move, nor can a fork itself, so their daughters keep the current rank
 * instead. */
export function retainCurrentUnaryRows(current: CurrentScene, future: Scene): void {
  const { coordinates } = current;
  const visibleParent = (node: PointNode) => {
    const parent = syntaxParent(node);
    return parent && current.visible.has(getNodeId(parent)) ? parent : undefined;
  };
  edgesAwaitingInsertion(current, future, true).reverse().forEach(({ parent, child }) => {
    const spine = [parent];
    for (let up = visibleParent(parent); up; up = visibleParent(up)) {
      if (visibleChildren(up, current).length !== 1) return;
      spine.push(up);
    }
    const gap = child.y - parent.y;
    const parentPoint = coordinates.get(getNodeId(parent))!, childPoint = coordinates.get(getNodeId(child))!;
    const delta = childPoint.y - gap - parentPoint.y;
    if (!Number.isFinite(gap) || gap <= 0 || delta <= 1e-8) return;
    for (const node of spine) {
      const point = coordinates.get(getNodeId(node));
      if (point) coordinates.set(getNodeId(node), { ...point, y: point.y + delta });
    }
  });
  retainCurrentDaughterRanks(current, future);
}
