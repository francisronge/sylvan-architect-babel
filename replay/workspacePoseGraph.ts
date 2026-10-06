import { workspaceMotionOwnership, type WorkspaceMotionView } from './workspaceMotionOwnership.ts';
import type { ContourFrame, LifetimeContour, Point } from './workspaceLifetimeContours.ts';
type Topology = {
  parent: Map<string, string>;
  root: Map<string, LifetimeContour>;
};
type TemporalConstraint = {
  frame: number;
  id: string;
  beforeRoot: string;
  afterRoot: string;
  delta: Point;
};
type TemporalConflict = TemporalConstraint & {
  operation: string;
  kind: string;
  residual: Point;
  distance: number;
};
const EPS = 1e-6;
const point = (x = 0, y = 0): Point => ({ x, y });
const add = (a: Point, b: Point): Point => point(a.x + b.x, a.y + b.y);
const sub = (a: Point, b: Point): Point => point(a.x - b.x, a.y - b.y);
function topology(frame: ContourFrame): Topology {
  const parent = new Map<string, string>(), root = new Map<string, LifetimeContour>();
  const visit = (node: LifetimeContour, owner: LifetimeContour) => {
    root.set(node.id, owner);
    for (const child of node.children) {
      parent.set(child.id, node.id);
      visit(child, owner);
    }
  };
  frame.roots.forEach(node => visit(node, node));
  return { parent, root };
}
function motionView(frame: ContourFrame, topology: Topology): WorkspaceMotionView {
  return {
    ids: () => frame.nodes.keys(), has: id => frame.nodes.has(id), parent: id => topology.parent.get(id),
    children: id => frame.nodes.get(id)?.children.map(child => child.id) ?? [],
    contains: (root, id) => frame.nodes.get(root)?.members.has(id) ?? false,
    members: root => frame.nodes.get(root)?.members.keys() ?? []
  };
}
class Translations {
  parent: number[] = [];
  offset: Point[] = [];
  copy(): Translations {
    const copy = new Translations();
    copy.parent = [...this.parent];
    copy.offset = this.offset.map(value => ({ ...value }));
    return copy;
  }
  create(): number { const index = this.parent.length; this.parent.push(index); this.offset.push(point()); return index; }
  find(index: number): {
    group: number;
    offset: Point;
  } {
    if (this.parent[index] === index)
      return { group: index, offset: point() };
    const ancestor = this.find(this.parent[index]);
    this.offset[index] = add(this.offset[index], ancestor.offset);
    this.parent[index] = ancestor.group;
    return { group: ancestor.group, offset: this.offset[index] };
  }
  join(before: number, after: number, delta: Point): Point {
    const a = this.find(before), b = this.find(after);
    if (a.group === b.group)
      return sub(sub(b.offset, a.offset), delta);
    this.parent[b.group] = a.group;
    this.offset[b.group] = add(sub(a.offset, b.offset), delta);
    return point();
  }
}
export type WorkspacePoseGraph = {
  frames: readonly ContourFrame[];
  topologies: Topology[];
  variables: Map<string, number>[];
  union: Translations;
  conflicts: TemporalConflict[];
  constraints: TemporalConstraint[];
  owned: ReadonlySet<string>[];
};
/** Each variable translates a whole current connected tree. Exact unchanged
* witnesses constrain successive occurrences; contradictory witnesses reject
* the plan instead of choosing one by iteration order. */
export function rigidPoseGraph(frames: readonly ContourFrame[]): WorkspacePoseGraph {
  const union = new Translations(), topologies = frames.map(topology);
  const variables = frames.map(frame => new Map(frame.roots.map(root => [root.id, union.create()])));
  const conflicts: TemporalConflict[] = [], constraints: TemporalConstraint[] = [], canvases = new Map<object, number>();
  const owned: ReadonlySet<string>[] = frames.map(() => new Set());
  const topologyKeys = new WeakMap<LifetimeContour, string>();
  const topologyKey = (shape: LifetimeContour) => {
    let key = topologyKeys.get(shape);
    if (key)
      return key;
    const value = (part: LifetimeContour): unknown => [part.id, part.children.map(value)];
    key = JSON.stringify(value(shape));
    topologyKeys.set(shape, key);
    return key;
  };
  for (const [index, frame] of frames.entries()) {
    const previous = canvases.get(frame.step.replayCanvasData!);
    if (previous !== undefined)
      for (const root of frame.roots) {
        const before = frames[previous].nodes.get(root.id);
        if (before?.incarnation !== root.incarnation || !variables[previous].has(root.id))
          throw Error('Shared canvas changed visible component material.');
        union.join(variables[previous].get(root.id)!, variables[index].get(root.id)!, point());
      }
    else
      canvases.set(frame.step.replayCanvasData!, index);
  }
  for (let index = 1; index < frames.length; index++) {
    const previous = frames[index - 1], frame = frames[index], a = topologies[index - 1], b = topologies[index];
    const motion = workspaceMotionOwnership({
      step: frame.step, before: motionView(previous, a), current: motionView(frame, b),
      sameMaterial: id => previous.nodes.get(id)?.incarnation === frame.nodes.get(id)?.incarnation,
      sameTopology: id => topologyKey(previous.nodes.get(id)!) === topologyKey(frame.nodes.get(id)!),
      displayTerminalChange: id => frame.displayTerminalChanges?.has(id) ?? false
    });
    owned[index] = motion.owned;
    for (const id of motion.stationary) {
      const oldRoot = a.root.get(id)!, newRoot = b.root.get(id)!;
      const delta = sub(oldRoot.members.get(id)!, newRoot.members.get(id)!);
      const residual = union.join(variables[index - 1].get(oldRoot.id)!, variables[index].get(newRoot.id)!, delta);
      const constraint = { frame: index + 1, id, beforeRoot: oldRoot.id, afterRoot: newRoot.id, delta };
      constraints.push(constraint);
      const distance = Math.hypot(residual.x, residual.y);
      if (distance > EPS)
        conflicts.push({ ...constraint, operation: frame.step.operation, kind: frame.step.replayKind, residual, distance });
    }
  }
  return { frames, topologies, variables, union, conflicts, constraints, owned };
}
