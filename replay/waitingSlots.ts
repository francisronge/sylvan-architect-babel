import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import type { CategoryTextMeasure } from './categoryTextLayout.ts';
import { applyVizIds, getNodeId } from './displayIdentity.ts';
import type { TreeInkTextMeasure } from './treeInkGeometry.ts';
import type { PreparedTreeLabelRuns, TreeLabelMeasure } from './treeLabelRuns.ts';
import { layoutSyntaxTree, type TreeCoordinateReservation, type TreeDirection } from './treeLayout.ts';
import type { PlaybackStep } from './types.ts';
import { collisionAreas } from './workspaceComponentLifetime.ts';

type Reservations = ReadonlyMap<SyntaxNode, TreeCoordinateReservation>;

/** A slot may not add or enlarge any single ink overlap between two painted
 * nodes, internal pairs included; a resolved overlap cannot pay for a new one.
 * Maps are `collisionAreas` results for every painted pair of one frame. */
export function overlapsKept(before: ReadonlyMap<string, number>, after: ReadonlyMap<string, number>) {
  return [...after].every(([pair, area]) => area <= (before.get(pair) ?? 0) + 1e-6);
}
type Node = d3.HierarchyPointNode<SyntaxNode>;

/** A waiting workspace stands, from the first frame it is painted, where it will
 * attach. Each attachment (a painted root that gains a painted parent) fixes the
 * positions of its component in that frame. Every earlier frame in which those
 * members are painted only as detached pieces of that component, each painted
 * member under the parent it attaches with and no other syntax inside it, takes
 * those positions (raised by the row an inserted parent will add, see below); a later attachment of the same pieces
 * takes precedence. The rest of each frame is unchanged, so the coordinates must
 * share one origin across stages (see the stage alignment in stageCoordinates.ts).
 * A component keeps its planned frames when its slot would invalidate a branch or
 * add or enlarge any single ink overlap, internal pairs included, in any of them. With `withinStage`, a lifetime stops at its
 * attachment's stage boundary, for plans whose stages keep their own origins. */
export function reserveWaitingSlots({ steps, sizes, coordinates, direction, measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel, withinStage = false }: {
  steps: readonly PlaybackStep[];
  sizes: ReadonlyMap<number, [number, number]>;
  coordinates: Reservations;
  direction: TreeDirection;
  measureCategoryText?: CategoryTextMeasure;
  measureTreeInk?: TreeInkTextMeasure;
  treeLabelRuns?: PreparedTreeLabelRuns;
  measureTreeLabel?: TreeLabelMeasure;
  withinStage?: boolean;
}): Reservations {
  const scenes = steps.flatMap(step => {
    const canvas = step.replayCanvasData, size = sizes.get(step.replayFrameIndex!), points = canvas && coordinates.get(canvas);
    return canvas && size && points ? [{ step, canvas, size }] : [];
  });
  const output = new Map(coordinates);
  // Each canvas is painted once per version of its reservation.
  const painted = new Map<SyntaxNode, WeakMap<TreeCoordinateReservation, Map<string, Node>>>();
  const paint = (scene: typeof scenes[number]) => {
    const points = output.get(scene.canvas)!;
    let versions = painted.get(scene.canvas);
    if (!versions) painted.set(scene.canvas, versions = new WeakMap());
    let nodes = versions.get(points);
    if (!nodes) versions.set(points, nodes = layoutScene(scene, points));
    return nodes;
  };
  const layoutScene = (scene: typeof scenes[number], points: TreeCoordinateReservation) => {
    const root = d3.hierarchy(scene.canvas); applyVizIds(root);
    const visible = new Set<string>(scene.step.replayVisibleNodeIds ?? root.descendants().map(node => getNodeId(node)));
    return new Map<string, Node>(layoutSyntaxTree(root, scene.size, direction, points, visible).descendants()
      .filter(node => visible.has(getNodeId(node)) && !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace')
      .map(node => [getNodeId(node), node] as const));
  };
  const parentOf = (nodes: ReadonlyMap<string, Node>, id: string) => {
    const parent = nodes.get(id)?.parent;
    return parent && nodes.has(getNodeId(parent)) ? getNodeId(parent) : null;
  };
  const valid = (nodes: ReadonlyMap<string, Node>) => {
    const occupied = new Set<string>();
    for (const [id, node] of nodes) {
      const key = `${node.x.toFixed(6)},${node.y.toFixed(6)}`;
      if (occupied.has(key)) return false;
      occupied.add(key);
      const parent = parentOf(nodes, id);
      if (parent && nodes.get(parent)!.y >= node.y) return false;
      const children = (node.children ?? []).filter(child => nodes.has(getNodeId(child)));
      if (children.slice(1).some((child, index) => direction === 'rtl' ? children[index].x <= child.x : children[index].x >= child.x)) return false;
    }
    return true;
  };
  // Ink overlap of every painted pair, internal pairs included, per reservation version.
  const overlapCache = new WeakMap<TreeCoordinateReservation, Map<string, number>>();
  const overlaps = (scene: typeof scenes[number]) => {
    const points = output.get(scene.canvas)!;
    let pairs = overlapCache.get(points);
    if (!pairs) {
      const nodes = [...paint(scene).values()];
      overlapCache.set(points, pairs = collisionAreas(nodes, nodes, measureCategoryText,
        { measureTreeInk, measureTreeLabel, treeLabelRuns: treeLabelRuns?.get(scene.canvas) }));
    }
    return pairs;
  };
  const keepsOverlaps = overlapsKept;
  for (let attach = 1; attach < scenes.length; attach++) {
    const now = paint(scenes[attach]), before = paint(scenes[attach - 1]);
    for (const [id] of now) {
      if (!parentOf(now, id) || !before.has(id) || parentOf(before, id)) continue;
      const members = new Set<string>();
      for (const pending = [id]; pending.length;) {
        const member = pending.pop()!;
        members.add(member);
        pending.push(...(now.get(member)!.children ?? []).map(getNodeId).filter(child => now.has(child)));
      }
      const slot = output.get(scenes[attach].canvas)!;
      // A piece that attaches through a parent inserted above an existing host
      // waits at its final x beside that host's current row, and the insertion
      // lowers both together; branches keep one row until then.
      const parentId = parentOf(now, id)!, grand = parentOf(now, parentId);
      const host = before.has(parentId) || !grand ? undefined : [...now].find(([sister]) => sister !== id
        && parentOf(now, sister) === parentId && before.has(sister) && parentOf(before, sister) === grand)?.[1];
      const lift = host ? Math.min(0, before.get(getNodeId(host))!.y - host.y) : 0;
      const changes: { scene: typeof scenes[number]; ids: string[] }[] = [];
      for (let index = attach - 1; index >= 0; index--) {
        if (withinStage && scenes[index].step.replayFrameIndex !== scenes[attach].step.replayFrameIndex) break;
        const nodes = index === attach - 1 ? before : paint(scenes[index]);
        const present = [...members].filter(member => nodes.has(member));
        // The pieces keep the internal structure they attach with; only detached
        // parts still being built may lack their later parent.
        if (!present.length || present.some(member => {
          const parent = parentOf(nodes, member);
          return parent !== null && (member === id || parent !== parentOf(now, member))
            || (nodes.get(member)!.children ?? []).some(child => nodes.has(getNodeId(child)) && !members.has(getNodeId(child)));
        })) break;
        changes.push({ scene: scenes[index], ids: present });
      }
      const saved = new Map(changes.map(({ scene }) => [scene.canvas, output.get(scene.canvas)!]));
      const accepted = changes.every(({ scene, ids }) => {
        const original = overlaps(scene);
        const points = new Map(output.get(scene.canvas)!);
        // Right-to-left frames reflect x around their own stage width.
        const shift = direction === 'rtl' ? scene.size[0] - scenes[attach].size[0] : 0;
        for (const member of ids) points.set(member, { ...slot.get(member)!, x: slot.get(member)!.x + shift, y: slot.get(member)!.y + lift });
        output.set(scene.canvas, points);
        const placed = paint(scene);
        return valid(placed) && keepsOverlaps(original, overlaps(scene));
      });
      if (!accepted) for (const [canvas, points] of saved) output.set(canvas, points);
    }
  }
  return output;
}
