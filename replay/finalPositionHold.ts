import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import type { CategoryTextMeasure } from './categoryTextLayout.ts';
import { applyVizIds, getNodeId } from './displayIdentity.ts';
import { plaqueBranchObstacles, plaqueTreeObstacles } from './relations/plaquePlacement.ts';
import { layoutSyntaxTree, type TreeCoordinateReservation } from './treeLayout.ts';
import { TREE_ROW_HEIGHT } from './treeSpacing.ts';
import type { PlaybackStep } from './types.ts';

type Node = d3.HierarchyNode<SyntaxNode>;
type Point = { x: number; y: number };
type Reservations = ReadonlyMap<SyntaxNode, TreeCoordinateReservation>;
type Scene = {
  step: PlaybackStep;
  canvas: SyntaxNode;
  size: [number, number];
  root: Node;
  nodes: Map<string, Node>;
  visible: Set<string>;
  plan: TreeCoordinateReservation;
};
export type FinalHoldStatus = 'held' | 'held-with-clashes' | 'invalid' | 'incomplete';
const statuses = new WeakMap<readonly PlaybackStep[], FinalHoldStatus[]>();
/** How each final-position hold of these steps ended, for diagnostics. */
export const getFinalHoldStatuses = (steps: readonly PlaybackStep[]) => [...(statuses.get(steps) ?? [])];

// Clearance between separate workspaces, as separateWorkspaceContours measures it.
const WORKSPACE_CLEARANCE = 34;
const CUT_ROUNDS = 12;

const painted = (node: Node) => !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace';

/** Every Replay frame holds the positions of the completed derivation.
 *
 * The plan's completed frame is the anchor. Walking back through every frame of
 * every stage, an occurrence a later frame still paints under the same painted
 * parent chain keeps that later position. Material leaving a daughter slot (a
 * source before its movement, a form later replaced) keeps its own planned
 * shape, centred where the occurrence replacing it will stand; other material
 * the later frame no longer has is carried by its nearest held ancestor (or
 * descendant). Rows are one per branch (`rows`). A painted parent is centred
 * over its visible daughters. Existing syntax therefore never moves at a step
 * that does not relocate it, including across stage crossings.
 *
 * A held frame can stand material closer than its own stage's plan did: an
 * earlier, wider form beside its sisters, or a waiting workspace beside another.
 * Each clash opens a gap in the completed tree's leaf order between the two
 * (`clashes`), every frame is held again, and the completed frame keeps the
 * room, so a waiting workspace already stands clear at the place it will join.
 * The Canopy is laid out separately and keeps its own layout. Returns null when
 * a held frame is not a valid tree, so the caller keeps its plan. */
export function holdFinalPositions({ steps, sizes, planned, measureCategoryText }: {
  steps: readonly PlaybackStep[];
  sizes: ReadonlyMap<number, [number, number]>;
  planned: ReadonlyMap<number, Reservations>;
  measureCategoryText?: CategoryTextMeasure;
}): Map<number, Map<SyntaxNode, TreeCoordinateReservation>> | null {
  const record = (status: FinalHoldStatus) => {
    const list = statuses.get(steps) ?? [];
    list.push(status); statuses.set(steps, list);
  };
  const order = (step: PlaybackStep) => step.replayStageStepIndex ?? (step.replayKind === 'macro' ? Infinity : 0);
  const ordered = [...steps].filter(step => step.replayCanvasData && step.replayFrameIndex !== undefined)
    .sort((a, b) => a.replayFrameIndex! - b.replayFrameIndex! || order(a) - order(b));
  const scenes: Scene[] = [];
  for (const step of ordered) {
    const canvas = step.replayCanvasData!, size = sizes.get(step.replayFrameIndex!);
    const plan = planned.get(step.replayFrameIndex!)?.get(canvas);
    if (!size || !plan) { record('incomplete'); return null; }
    const root = d3.hierarchy(canvas); applyVizIds(root);
    const nodes = new Map(root.descendants().map(node => [getNodeId(node), node] as const));
    if ([...nodes.keys()].some(id => !plan.has(id))) { record('incomplete'); return null; }
    scenes.push({ step, canvas, size, root, nodes, visible: new Set(step.replayVisibleNodeIds ?? nodes.keys()), plan });
  }
  if (scenes.length < 2) return null;
  const final = scenes.at(-1)!;

  // The completed tree's leaf order: each painted node's span of visible leaves.
  const leafIndex = new Map<string, number>();
  final.root.eachBefore(node => {
    const id = getNodeId(node);
    if (!final.visible.has(id) || !painted(node)) return;
    if (!(node.children ?? []).some(child => painted(child) && final.visible.has(getNodeId(child)))) leafIndex.set(id, leafIndex.size);
  });
  const finalSpan = new Map<string, [number, number]>();
  final.root.eachAfter(node => {
    const own = leafIndex.get(getNodeId(node));
    const values = [...(own === undefined ? [] : [own]), ...(node.children ?? []).flatMap(child => finalSpan.get(getNodeId(child)) ?? [])];
    if (values.length) finalSpan.set(getNodeId(node), [Math.min(...values), Math.max(...values)]);
  });

  const centre = (scene: Scene, coordinates: Map<string, Point>) => {
    [...scene.root.descendants()].reverse().forEach(node => {
      if (!painted(node) || !scene.visible.has(getNodeId(node))) return;
      const children = (node.children ?? []).filter(child => !child.data.replayLayoutOnly && scene.visible.has(getNodeId(child)));
      if (!children.length) return;
      const first = coordinates.get(getNodeId(children[0]))!, last = coordinates.get(getNodeId(children.at(-1)!))!;
      const point = coordinates.get(getNodeId(node))!;
      coordinates.set(getNodeId(node), { x: (first.x + last.x) / 2, y: point.y });
    });
  };
  // The painted syntax a step owns, as Replay's motion rule assigns it: its
  // target and trajectory participants, syntax new in its frame or under a new
  // painted parent, everything below those and the ancestors above them.
  const ownedBy = (before: Scene, after: Scene) => {
    const shown = (scene: Scene, node: Node | null | undefined) => Boolean(node && painted(node) && scene.visible.has(getNodeId(node)));
    const parentOf = (scene: Scene, id: string) => {
      const parent = scene.nodes.get(id)?.parent;
      return shown(scene, parent) ? getNodeId(parent!) : null;
    };
    const step = after.step, identity = step.replayRelationIdentity;
    const key = identity && `${identity.stageIndex}:${identity.relationIndex}`;
    const seeds = [step.targetNodeId, ...(step.replayKind === 'relation' && key ? (step.replayRelationLinks ?? [])
      .filter(link => link.renderFamily === 'trajectory' && link.authoredRelationKey === key)
      .flatMap(link => [link.priorSourceNodeId, link.witnessNodeId, link.targetNodeId]) : [])]
      .filter((id): id is string => Boolean(id) && shown(after, after.nodes.get(id!)));
    after.nodes.forEach((node, id) => {
      if (!shown(after, node)) return;
      if (!shown(before, before.nodes.get(id)) || parentOf(before, id) !== parentOf(after, id)) seeds.push(id);
    });
    const owned = new Set<string>();
    for (const id of seeds) {
      const node = after.nodes.get(id)!;
      node.each(member => { if (shown(after, member)) owned.add(getNodeId(member)); });
      for (let parent = node.parent; parent && shown(after, parent); parent = parent.parent) owned.add(getNodeId(parent));
    }
    return owned;
  };
  // One row per branch. Each top-level subtree takes the vertical offset that
  // keeps the rows of the held occurrences the next step does not own, so a host
  // that a later parent is inserted above descends at that step, which owns it.
  // Among equally good offsets, the one most held occurrences agree on (as the
  // camera carry measures a crossing) is kept.
  const rows = (scene: Scene, coordinates: Map<string, Point>, kept: ReadonlySet<string>, owned: ReadonlySet<string>) => {
    const tops = scene.root.descendants().filter(node => painted(node) && (!node.parent || !painted(node.parent)));
    for (const top of tops) {
      const offsets: { offset: number; free: boolean }[] = [];
      top.each(node => {
        const id = getNodeId(node);
        if (painted(node) && kept.has(id)) offsets.push({ offset: coordinates.get(id)!.y - (node.depth - top.depth) * TREE_ROW_HEIGHT,
          free: owned.has(id) || !scene.visible.has(id) });
      });
      offsets.sort((a, b) => a.offset - b.offset);
      const median = offsets.length ? offsets[(offsets.length - 1) >> 1].offset : coordinates.get(getNodeId(top))!.y;
      const cost = (offset: number) => offsets.filter(entry => !entry.free && Math.abs(entry.offset - offset) > 1e-6).length;
      const y = [...new Set(offsets.map(entry => entry.offset))]
        .reduce((best, offset) => cost(offset) < cost(best) || cost(offset) === cost(best)
          && Math.abs(offset - median) < Math.abs(best - median) ? offset : best, median);
      top.each(node => {
        if (!painted(node) || node.ancestors().slice(0, node.depth - top.depth).some(ancestor => !painted(ancestor))) return;
        const point = coordinates.get(getNodeId(node))!;
        coordinates.set(getNodeId(node), { x: point.x, y: y + (node.depth - top.depth) * TREE_ROW_HEIGHT });
      });
    }
  };

  const holdAll = (cuts: ReadonlyMap<number, number>) => {
    const shiftAt = (index: number) => {
      let shift = 0;
      for (const [cut, gap] of cuts) if (cut <= index) shift += gap;
      return shift;
    };
    const last = new Map<string, Point>();
    final.root.each(node => {
      const id = getNodeId(node), point = final.plan.get(id)!;
      const span = finalSpan.get(id) ?? node.ancestors().map(ancestor => finalSpan.get(getNodeId(ancestor))).find(Boolean);
      last.set(id, { x: point.x + (span ? shiftAt(span[0]) : 0), y: point.y });
    });
    centre(final, last);
    const held: Map<string, Point>[] = new Array(scenes.length);
    // Each frame's completed-leaf spans: a held occurrence keeps its later span,
    // and material standing at a slot takes the span of the occurrence replacing it.
    const spans: Map<string, readonly [number, number]>[] = new Array(scenes.length);
    held[scenes.length - 1] = last;
    spans[scenes.length - 1] = finalSpan;
    for (let index = scenes.length - 2; index >= 0; index--) {
      const scene = scenes[index], next = scenes[index + 1], reference = held[index + 1];
      const relocated = new Set<string>();
      // Relocation is judged by the painted parent: hidden scaffolding above a
      // shown node relocates nothing that is shown.
      scene.nodes.forEach((node, id) => {
        const other = next.nodes.get(id);
        if (!other || node.data.replayLayoutOnly || other.data.replayLayoutOnly || !scene.visible.has(id)) return;
        const parent = node.ancestors().slice(1).find(ancestor => painted(ancestor) && scene.visible.has(getNodeId(ancestor)));
        if (parent && !other.ancestors().some(ancestor => getNodeId(ancestor) === getNodeId(parent)))
          node.each(descendant => relocated.add(getNodeId(descendant)));
      });
      const coordinates = new Map<string, Point>(), kept = new Set<string>();
      scene.nodes.forEach((node, id) => {
        const other = next.nodes.get(id);
        if (!other || relocated.has(id) || node.data.replayLayoutOnly || other.data.replayLayoutOnly) return;
        // Material that disappears in the next frame keeps no claim on its place there.
        if (scene.visible.has(id) && !next.visible.has(id)) return;
        coordinates.set(id, reference.get(id)!);
        kept.add(id);
      });
      // Material leaving a held parent's daughter slot stands where the
      // occurrence replacing it there (a lower copy, a new form) will stand.
      const slotOffsets = new Map<string, Point>(), replacements = new Map<string, string>();
      scene.nodes.forEach((node, id) => {
        const parent = node.parent, parentId = parent && getNodeId(parent);
        if (kept.has(id) || !parent || !parentId || !kept.has(parentId)) return;
        const siblings = parent.children!, later = next.nodes.get(parentId)!.children ?? [];
        const index = siblings.indexOf(node), replacement = later.length === siblings.length ? later[index] : undefined;
        const replacementId = replacement && getNodeId(replacement);
        if (!replacementId || replacementId === id || scene.nodes.has(replacementId) || !reference.has(replacementId)) return;
        const own = scene.plan.get(id)!, to = reference.get(replacementId)!;
        slotOffsets.set(id, { x: to.x - own.x, y: to.y - own.y });
        replacements.set(id, replacementId);
      });
      const later = spans[index + 1], current = new Map<string, readonly [number, number]>();
      scene.nodes.forEach((node, id) => {
        if (coordinates.has(id)) return;
        const own = scene.plan.get(id)!;
        const slot = node.ancestors().find(candidate => slotOffsets.has(getNodeId(candidate)));
        if (slot) {
          const offset = slotOffsets.get(getNodeId(slot))!, span = later.get(replacements.get(getNodeId(slot))!);
          coordinates.set(id, { x: own.x + offset.x, y: own.y + offset.y });
          if (span) current.set(id, span);
          return;
        }
        const attachment = node.ancestors().slice(1).find(candidate => kept.has(getNodeId(candidate)))
          ?? node.descendants().find(candidate => kept.has(getNodeId(candidate)));
        if (!attachment) { coordinates.set(id, own); return; }
        const from = scene.plan.get(getNodeId(attachment))!, to = coordinates.get(getNodeId(attachment))!;
        coordinates.set(id, { x: own.x + to.x - from.x, y: own.y + to.y - from.y });
      });
      rows(scene, coordinates, kept, ownedBy(scene, next));
      centre(scene, coordinates);
      held[index] = coordinates;
      for (const id of kept) if (later.has(id)) current.set(id, later.get(id)!);
      spans[index] = current;
    }
    return { held, spans };
  };

  const paint = (scene: Scene, coordinates: TreeCoordinateReservation) => {
    const root = d3.hierarchy(scene.canvas); applyVizIds(root);
    return layoutSyntaxTree(root, scene.size, 'ltr', coordinates, scene.visible).descendants()
      .filter(node => scene.visible.has(getNodeId(node)) && painted(node));
  };
  type Box = ReturnType<typeof plaqueTreeObstacles>[number];
  type PaintedNode = d3.HierarchyPointNode<SyntaxNode>;
  // How far `right` must move right for every box of `left` to stand `clearance`
  // clear of every box of `right` that shares its rows, or `floor` when that is
  // no more. `right` is sorted by x, so each left box stops at its first
  // row-sharing box or at the first box too far right to exceed the floor.
  const overlap = (left: readonly Box[], right: readonly Box[], clearance: number, floor: number) => {
    let gap = floor;
    for (const l of left) {
      const limit = l.x + l.width + clearance;
      for (const r of right) {
        if (limit - r.x <= gap) break;
        if (Math.min(l.y + l.height, r.y + r.height) <= Math.max(l.y, r.y)) continue;
        gap = limit - r.x;
        break;
      }
    }
    return gap;
  };
  // A node's own label and word boxes depend only on its data and position.
  const ownBoxes = new Map<SyntaxNode, readonly Box[]>();
  const boxesOf = (node: PaintedNode) => {
    let relative = ownBoxes.get(node.data);
    if (!relative) {
      const origin = { ...node, x: 0, y: 0 } as PaintedNode;
      ownBoxes.set(node.data, relative = plaqueTreeObstacles([Object.assign(Object.create(Object.getPrototypeOf(node)), origin)], measureCategoryText));
    }
    return relative.map(box => ({ ...box, x: box.x + node.x, y: box.y + node.y }));
  };
  // One painted frame's units: each painted subtree's boxes (sorted by x), its
  // completed-leaf span and its extreme shifts from the frame's own plan.
  type Unit = { boxes: Box[]; sorted: Box[]; span?: readonly [number, number]; x: number; minShift: number; maxShift: number; rowShift?: number };
  const frameUnits = (nodes: readonly PaintedNode[], leafSpans: ReadonlyMap<string, readonly [number, number]>, plan?: ReadonlyMap<string, PaintedNode>) => {
    const included = new Set(nodes), units = new Map<PaintedNode, Unit>();
    for (const node of [...nodes].sort((a, b) => b.depth - a.depth)) {
      const children = (node.children ?? []).filter(child => included.has(child));
      const own = boxesOf(node), id = getNodeId(node), reference = plan?.get(id);
      const shift = reference ? node.x - reference.x : 0, rows = reference ? node.y - reference.y : 0;
      let boxes = [...own], minShift = shift, maxShift = shift, rowShift: number | undefined = rows;
      const spans: (readonly [number, number])[] = [];
      if (!children.length && leafSpans.has(id)) spans.push(leafSpans.get(id)!);
      for (const child of children) {
        const part = units.get(child)!;
        boxes = boxes.concat(part.boxes, plaqueBranchObstacles(node, child));
        minShift = Math.min(minShift, part.minShift); maxShift = Math.max(maxShift, part.maxShift);
        if (part.rowShift === undefined || Math.abs(part.rowShift - rows) > 1e-6) rowShift = undefined;
        if (part.span) spans.push(part.span);
      }
      units.set(node, { boxes, sorted: [], x: node.x, minShift, maxShift, rowShift,
        span: spans.length ? [Math.min(...spans.map(span => span[0])), Math.max(...spans.map(span => span[1]))] : undefined });
    }
    const sorted = (unit: Unit) => unit.sorted.length || !unit.boxes.length ? unit.sorted : (unit.sorted = [...unit.boxes].sort((a, b) => a.x - b.x));
    return { units, included, sorted };
  };
  // Where a gap moves `right` away from `left` in the completed leaf order: at
  // any leaf after `left`'s last up to `right`'s first. A side the completed
  // tree does not place bounds nothing; `cut` is where a new gap opens.
  type Request = { from: number; to: number; cut: number; gap: number };
  const between = (left: Unit, right: Unit): Omit<Request, 'gap'> | undefined =>
    left.span && right.span ? (left.span[1] < right.span[0] ? { from: left.span[1] + 1, to: right.span[0], cut: right.span[0] } : undefined)
      : right.span ? { from: 0, to: right.span[0], cut: right.span[0] }
      : left.span ? { from: left.span[1] + 1, to: Infinity, cut: left.span[1] + 1 } : undefined;
  // Each frame's own plan, painted once, with the sister overlaps it allows.
  const planFrames = new WeakMap<Scene, ReturnType<typeof frameUnits> & { nodes: Map<string, PaintedNode>; allowed: Map<string, number> }>();
  const planFrame = (scene: Scene) => {
    let frame = planFrames.get(scene);
    if (!frame) {
      const units = frameUnits(paint(scene, scene.plan), new Map());
      planFrames.set(scene, frame = { ...units, nodes: new Map([...units.units.keys()].map(node => [getNodeId(node), node])), allowed: new Map() });
    }
    return frame;
  };
  // Clashes in one held frame, as gaps to open in the completed leaf order (the
  // leaf at which the gap opens, and its width). Separate workspaces keep the
  // workspace clearance, ordered as the completed tree orders them. Adjacent
  // sisters may stand no closer than their own frame's plan placed them; a pair
  // the hold shifted apart, or together on the same rows, cannot be closer.
  const clashes = (scene: Scene, coordinates: TreeCoordinateReservation, leafSpans: ReadonlyMap<string, readonly [number, number]>) => {
    const nodes = paint(scene, coordinates);
    const plan = planFrame(scene), planNodes = plan.nodes;
    const { units, included, sorted } = frameUnits(nodes, leafSpans, planNodes);
    const found: Request[] = [];
    const want = (place: Omit<Request, 'gap'> | undefined, gap: number) => {
      if (place && gap > 0.5) found.push({ ...place, gap });
    };
    const tops = nodes.filter(node => !node.parent || !included.has(node.parent));
    // A workspace waiting at a place inside another's span stands clear of the
    // host's material on either side of that place.
    const tucked = (host: PaintedNode, guest: Unit) => {
      const [lo, hi] = guest.span!, sides = [[] as Box[], [] as Box[]], ends = [-Infinity, Infinity];
      for (const member of host.descendants()) {
        const span = included.has(member) ? units.get(member)!.span : undefined;
        const side = span && (span[1] < lo ? 0 : span[0] > hi ? 1 : -1);
        if (side === undefined || side < 0) continue;
        sides[side].push(...boxesOf(member));
        if (member !== host && member.parent && units.get(member.parent)!.span
          && (side ? units.get(member.parent)!.span![0] > hi : units.get(member.parent)!.span![1] < lo))
          sides[side].push(...plaqueBranchObstacles(member.parent, member));
        ends[side] = side ? Math.min(ends[side], span![0]) : Math.max(ends[side], span![1]);
      }
      if (sides[0].length) want({ from: ends[0] + 1, to: lo, cut: lo }, overlap(sides[0], sorted(guest), WORKSPACE_CLEARANCE, 0));
      if (sides[1].length) want({ from: hi + 1, to: ends[1], cut: hi + 1 },
        overlap(guest.boxes, [...sides[1]].sort((a, b) => a.x - b.x), WORKSPACE_CLEARANCE, 0));
    };
    for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) {
      const a = units.get(tops[i])!, b = units.get(tops[j])!;
      if (a.span && b.span && a.span[1] >= b.span[0] && b.span[1] >= a.span[0]) {
        if (a.span[0] <= b.span[0] && b.span[1] <= a.span[1] && (a.span[0] < b.span[0] || b.span[1] < a.span[1])) tucked(tops[i], b);
        else if (b.span[0] <= a.span[0] && a.span[1] <= b.span[1] && (b.span[0] < a.span[0] || a.span[1] < b.span[1])) tucked(tops[j], a);
        continue;
      }
      const [left, right] = a.span && b.span ? (a.span[1] < b.span[0] ? [a, b] : [b, a])
        : a.span || b.span ? (a.x <= b.x ? [a, b] : [b, a]) : [];
      if (left && right) want(between(left, right), overlap(left.boxes, sorted(right), WORKSPACE_CLEARANCE, 0));
    }
    for (const node of nodes) {
      const children = (node.children ?? []).filter(child => included.has(child));
      for (let k = 1; k < children.length; k++) {
        const left = units.get(children[k - 1])!, right = units.get(children[k])!;
        if (left.rowShift !== undefined && right.rowShift !== undefined && Math.abs(left.rowShift - right.rowShift) <= 1e-6
          && left.maxShift <= right.minShift + 1e-6) continue;
        const pair = `${getNodeId(children[k - 1])} ${getNodeId(children[k])}`;
        let allowed = plan.allowed.get(pair);
        if (allowed === undefined) {
          const planLeft = planNodes.get(getNodeId(children[k - 1])), planRight = planNodes.get(getNodeId(children[k]));
          plan.allowed.set(pair, allowed = planLeft && planRight && planLeft.parent === planRight.parent
            ? overlap(plan.units.get(planLeft)!.boxes, plan.sorted(plan.units.get(planRight)!), 0, 0) : 0);
        }
        want(between(left, right), overlap(left.boxes, sorted(right), 0, allowed) - allowed);
      }
    }
    return found;
  };

  // Requests are met in order of their range's right end: a gap opened for one
  // already serves any later request whose range contains it. A cut whose own request did not
  // shrink after its gap opened cannot separate that pair (a piece the completed
  // tree does not place moves with neither side): its gap is withdrawn and the
  // cut is not opened again.
  const cuts = new Map<number, number>(), requested = new Map<number, number>(), withdrawn = new Set<number>();
  let result = holdAll(cuts), clear = false;
  for (let round = 0; round < CUT_ROUNDS; round++) {
    const requests = scenes.flatMap((scene, index) => clashes(scene, result.held[index], result.spans[index]))
      .filter(request => !withdrawn.has(request.cut));
    if (!requests.length) { clear = !withdrawn.size; break; }
    const largest = new Map<number, number>();
    for (const { cut, gap } of requests) largest.set(cut, Math.max(largest.get(cut) ?? 0, gap));
    for (const [cut, gap] of largest) {
      const previous = requested.get(cut);
      if (previous !== undefined && gap >= previous - 0.5 && cuts.has(cut)) {
        withdrawn.add(cut);
        cuts.delete(cut);
      }
      requested.set(cut, gap);
    }
    const opened = new Map<number, number>();
    for (const { from, to, cut, gap } of [...requests].filter(request => !withdrawn.has(request.cut))
      .sort((a, b) => a.to - b.to || a.cut - b.cut || b.gap - a.gap)) {
      let served = 0;
      for (const [at, width] of opened) if (at >= from && at <= to) served += width;
      if (gap - served > 0.5) opened.set(cut, (opened.get(cut) ?? 0) + gap - served);
    }
    for (const [cut, width] of opened) cuts.set(cut, (cuts.get(cut) ?? 0) + width);
    result = holdAll(cuts);
  }
  const valid = scenes.every((scene, index) => {
    const nodes = paint(scene, result.held[index]), included = new Set(nodes), occupied = new Set<string>();
    return nodes.every(node => {
      const key = `${node.x.toFixed(6)},${node.y.toFixed(6)}`;
      if (occupied.has(key)) return false;
      occupied.add(key);
      if (node.parent && included.has(node.parent) && node.y <= node.parent.y) return false;
      const children = (node.children ?? []).filter(child => included.has(child));
      return children.every((child, k) => !k || children[k - 1].x < child.x);
    });
  });
  if (!valid) { record('invalid'); return null; }
  record(clear ? 'held' : 'held-with-clashes');
  const byStage = new Map<number, Map<SyntaxNode, TreeCoordinateReservation>>();
  scenes.forEach((scene, index) => {
    const stage = scene.step.replayFrameIndex!;
    if (!byStage.has(stage)) byStage.set(stage, new Map());
    // A canvas shared by several steps keeps its latest held frame.
    byStage.get(stage)!.set(scene.canvas, result.held[index]);
  });
  return byStage;
}
