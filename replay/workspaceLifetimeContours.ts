import { translateWorkspaceObstacles } from './workspaceObstacleTranslation.ts';
import { composeWorkspaceObstacleBuffer, type WorkspaceObstacleBuffer } from './workspaceObstacleBuffer.ts';
import { createWorkspaceContourPairPreparer, workspaceContourPairCollision, type WorkspaceContourPair } from './workspaceContourPairs.ts';
import { neutralWorkspaceAttachments } from './workspaceNeutralAttachments.ts';
import { workspaceReferenceRank } from './workspaceReferenceRank.ts';
import { preservesLockedWorkspaceGap, type WorkspaceLockedGapReference } from './workspaceLockedGapPreference.ts';
import { currentWorkspaceMovements } from './currentWorkspaceMovements.ts';
import { changesOwnedDisplayTerminal } from './workspaceDisplayTerminal.ts';
import { movementReceivingHosts, extractionReceivingHosts } from './workspaceReceivingHost.ts';
import { currentForkBranchesClear, currentForkBranchCollision } from './workspaceForkClearance.ts';
import { workspaceClearanceObstructions, type WorkspaceGapRequest, type WorkspaceClearanceObstruction } from './workspacePairedClearance.ts';
import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import type { PlaybackStep } from './replayCompiler.ts';
import { applyVizIds, getNodeId } from './displayIdentity.ts';
import { authoredDisplayWord } from './displayWordMaterial.ts';
import { treeInkObstacles, type TreeInkTextMeasure } from './treeInkGeometry.ts';
import { plaqueBranchObstacles, type PlaqueRect } from './relations/plaquePlacement.ts';
import { rigidMovementHosts } from './movementHostContinuity.ts';
import type { CategoryTextMeasure } from './categoryTextLayout.ts';
import type { PreparedTreeLabelRuns, TreeLabelMeasure } from './treeLabelRuns.ts';
type Node = d3.HierarchyPointNode<SyntaxNode>;
export type Point = {
  x: number;
  y: number;
};
type ContourSelection = ReadonlyMap<number, ReadonlyMap<string, Point>>;
type Composition = {
  inheritCurrentSlots?: boolean;
  preferred?: ContourSelection;
  baseline?: readonly ContourFrame[];
};
type CoordinateSnapshot = readonly (string | number | undefined)[];
export type LifetimeContour = {
  id: string;
  incarnation: number;
  first: number;
  last: number;
  members: ReadonlyMap<string, Point>;
  obstacles: readonly PlaqueRect[];
  children: readonly LifetimeContour[];
};
type Incarnation = {
  id: string;
  serial: number;
  first: number;
  last: number;
  signature: string;
  ownSignature: string;
  inheritedRows: Set<number>;
  node: Node;
  children: Incarnation[];
  ownInk: PlaqueRect[];
  currentRanks: Set<number>;
  latestCurrentRank?: number;
  shape?: LifetimeContour;
  fixedSlots?: ReadonlyMap<number, Point>;
  predecessor?: Incarnation;
  slotPredecessor?: Incarnation;
  stationaryWitnessPairs: readonly (readonly [string, string])[];
  birthNodes: Map<string, Incarnation>;
  beforeNodes: Map<string, Incarnation>;
  step: PlaybackStep;
  beforeHierarchy: Map<string, Node>;
  hierarchy: Map<string, Node>;
};
/** A locked later fork can request room at its nearest still-free earlier
 * incarnation. The caller may widen that earlier preference and revalidate the
 * complete plan; the failing current slots never move independently. */
export class WorkspaceContourClearanceError extends Error {
  readonly preference: WorkspaceGapRequest;
  readonly obstructions: readonly WorkspaceClearanceObstruction[];
  constructor(detail: string, preference: WorkspaceGapRequest, obstructions: readonly WorkspaceClearanceObstruction[] = []) {
    super(detail); this.name = 'WorkspaceContourClearanceError'; this.preference = preference; this.obstructions = obstructions;
  }
}
export type ContourFrame = {
  step: PlaybackStep;
  roots: readonly LifetimeContour[];
  nodes: ReadonlyMap<string, LifetimeContour>;
  displayTerminalChanges?: ReadonlySet<string>;
};
function connectedParentPath(id: string, root: string, hierarchy: ReadonlyMap<string, Node>): string[] | undefined {
  const path: string[] = [];
  for (let node = hierarchy.get(id); node && hierarchy.has(getNodeId(node)); node = node.parent ?? undefined) {
    const current = getNodeId(node);
    if (current === root) return path;
    if (node.parent && hierarchy.has(getNodeId(node.parent))) path.push(getNodeId(node.parent));
  }
}
/** A visible material subtree gets one intrinsic contour for its whole current
* lifetime. Parent ownership, forest size and future syntax do not select its
* internal spacing. Labels reserve their maximum actual footprint in that life. */
export function prepareWorkspaceLifetimeContours(steps: readonly PlaybackStep[], measureCategoryText?: CategoryTextMeasure, measureTreeInk?: TreeInkTextMeasure, treeLabelRuns?: PreparedTreeLabelRuns, measureTreeLabel?: TreeLabelMeasure, inkDirection: 'ltr' | 'rtl' = 'ltr', acceptedCoordinates?: ReadonlyMap<SyntaxNode, ReadonlyMap<string, Point>>, currentStageRanks?: ReadonlyMap<PlaybackStep, number>) {
  const prepareContourPair = createWorkspaceContourPairPreparer();
  let previous = new Map<string, Incarnation>(), previousHierarchy = new Map<string, Node>(), serial = 0;
  const frames: Array<{
    step: PlaybackStep;
    roots: Incarnation[];
    nodes: Map<string, Incarnation>;
    displayTerminalChanges: ReadonlySet<string>;
  }> = [];
  steps.forEach((step, index) => {
    if (!step.replayCanvasData)
      return;
    const root = d3.hierarchy(step.replayCanvasData);
    applyVizIds(root);
    const visible = new Set(step.replayVisibleNodeIds);
    const current = new Set<d3.HierarchyNode<SyntaxNode>>(root.descendants().filter(node => visible.has(getNodeId(node)) && !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace'));
    const hierarchy = new Map([...current].map(node => [getNodeId(node), node as Node]));
    const nodes = new Map<string, Incarnation>();
    const previousCanvas = index > 0 ? steps[index - 1].replayCanvasData : undefined;
    const beforePoints = previousCanvas && acceptedCoordinates?.get(previousCanvas), currentPoints = acceptedCoordinates?.get(step.replayCanvasData);
    // Snapshot actual boundary geometry once. Later preferred poses cannot turn
    // a previously moving lower occurrence into a mandatory stationary slot.
    const stationaryWitnessPairs: Array<readonly [string, string]> = [];
    if (beforePoints && currentPoints) for (const link of step.replayRelationLinks ?? []) {
      const source = link.priorSourceNodeId, witness = link.witnessNodeId;
      if (!source || !witness || source === witness) continue;
      const a = beforePoints.get(source), b = currentPoints.get(witness);
      if (a && b && [a.x, a.y, b.x, b.y].every(Number.isFinite) && Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6)
        stationaryWitnessPairs.push([source, witness]);
    }
    const visit = (raw: d3.HierarchyNode<SyntaxNode>): Incarnation => {
      const node = raw as Node;
      node.x = 0;
      node.y = 0;
      const id = getNodeId(node), children = (node.children ?? []).filter(child => current.has(child)).map(visit);
      const owner = node.parent && current.has(node.parent) ? node.parent.data : undefined;
      const word = authoredDisplayWord(node.data, owner);
      const ownSignature = JSON.stringify([word ?? node.data.label, word ?? node.data.word, node.data.silent]);
      const signature = JSON.stringify([word ?? node.data.label, word ?? node.data.word, node.data.silent, children.map(child => child.serial)]);
      const before = previous.get(id);
      const incarnation: Incarnation = before?.signature === signature ? before : { id, serial: serial++, first: index, last: index, signature, ownSignature, inheritedRows: before?.ownSignature === ownSignature ? before.inheritedRows : new Set(), node, children, ownInk: [], currentRanks: new Set(), predecessor: before, stationaryWitnessPairs, birthNodes: nodes, beforeNodes: previous, step, beforeHierarchy: previousHierarchy, hierarchy };
      // A new movement wrapper may name the preceding complete fork. Retain
      // its exact child slots, while keeping the two material lifetimes distinct.
      if (!before && node.parent && hierarchy.has(getNodeId(node.parent))) {
        const oldFork = previous.get(getNodeId(node.parent)), identity = step.replayKind === 'relation' && step.replayRelationIdentity;
        const key = identity && `${identity.stageIndex}:${identity.relationIndex}`;
        const currentSisters = (node.parent.children ?? []).filter(child => hierarchy.has(getNodeId(child)));
        const contains = (part: Incarnation, id: string): boolean => part.id === id || part.children.some(child => contains(child, id));
        if (oldFork && oldFork.node.data.label === node.data.label && oldFork.node.data.word === node.data.word && oldFork.node.data.silent === node.data.silent
          && oldFork.children.length === children.length && children.every((child, i) => child === oldFork.children[i])
          && currentSisters.length === 2 && currentWorkspaceMovements(step, previousHierarchy, hierarchy).some(link => key && link.authoredRelationKey === key
            && link.priorSourceNodeId && previous.has(link.priorSourceNodeId) && contains(oldFork, link.priorSourceNodeId)
            && link.witnessNodeId && contains(incarnation, link.witnessNodeId)
            && link.targetNodeId && link.witnessNodeId !== link.targetNodeId && currentSisters.some(sister => sister !== node && getNodeId(sister) === link.targetNodeId)))
          incarnation.slotPredecessor = oldFork;
      }
      incarnation.last = index;
      const currentRank = currentStageRanks?.get(step);
      if (currentRank !== undefined && Number.isFinite(currentRank) && currentRank > 0) {
        incarnation.currentRanks.add(currentRank);
        incarnation.latestCurrentRank = currentRank;
        // Existing reservations may carry a later current row into an earlier
        // incarnation. Certify that row only on this continuously retained
        // parent's complete current children, never through hidden scaffolding.
        const origin = currentPoints?.get(id);
        if (origin && children.length && children.length === (node.children?.length ?? 0)
          && children.every(child => {
            const point = currentPoints?.get(child.id);
            return point && Math.abs(point.y - origin.y - currentRank) <= 1e-6;
          })) incarnation.inheritedRows.add(currentRank);
      }
      const measured = treeInkObstacles([node], measureCategoryText, measureTreeInk, true, treeLabelRuns?.get(step.replayCanvasData!), measureTreeLabel);
      // Normalize upright RTL text into the same left-to-right solve space as syntax.
      const own = inkDirection === 'ltr' ? measured : measured.map(rect => ({ ...rect, x: -rect.x - rect.width,
        ...(rect.curve ? { curve: { source: { x: -rect.curve.source.x, y: rect.curve.source.y }, control1: { x: -rect.curve.control1.x, y: rect.curve.control1.y }, control2: { x: -rect.curve.control2.x, y: rect.curve.control2.y }, target: { x: -rect.curve.target.x, y: rect.curve.target.y } } } : {})
      }));
      for (const rect of own)
        if (!incarnation.ownInk.some(prior => JSON.stringify(prior) === JSON.stringify(rect)))
          incarnation.ownInk.push(rect);
      nodes.set(id, incarnation);
      return incarnation;
    };
    const roots = [...current].filter(node => !node.parent || !current.has(node.parent)).map(visit);
    const displayTerminalChanges = new Set([...hierarchy.keys()]
      .filter(id => changesOwnedDisplayTerminal(previousHierarchy, hierarchy, id)));
    frames.push({ step, roots, nodes, displayTerminalChanges });
    previous = nodes;
    previousHierarchy = hierarchy;
  });
  const contourCache = new Map<number, Map<string, LifetimeContour>>();
  const contourInk = new WeakMap<LifetimeContour, () => WorkspaceObstacleBuffer>();
  const ink = (contour: LifetimeContour) => contourInk.get(contour)!();
  const contourIdentities = new WeakMap<LifetimeContour, number>();
  let contourIdentity = 0;
  const identityOf = (contour: LifetimeContour) => {
    let identity = contourIdentities.get(contour);
    if (identity === undefined) contourIdentities.set(contour, identity = contourIdentity++);
    return identity;
  };
  const pairCache = new WeakMap<LifetimeContour, WeakMap<LifetimeContour, WorkspaceContourPair>>();
  function pair(left: LifetimeContour, right: LifetimeContour) {
    let rights = pairCache.get(left);
    if (!rights)
      pairCache.set(left, rights = new WeakMap());
    let result = rights.get(right);
    if (!result) {
      result = prepareContourPair(ink(left), ink(right));
      rights.set(right, result);
    }
    return result;
  }
  function pairCollision(left: LifetimeContour, right: LifetimeContour, dx: number) {
    return workspaceContourPairCollision(pair(left, right), dx);
  }
  function clearPair(left: LifetimeContour, right: LifetimeContour, dx: number) {
    const cached = pair(left, right), answer = cached.answers.get(dx);
    if (answer !== undefined)
      return answer;
    const result = pairCollision(left, right, dx) === undefined;
    cached.answers.set(dx, result);
    return result;
  }
  const parts = [...new Set(frames.flatMap(frame => [...frame.nodes.values()]))];
  const ownBottom = new Map(parts.map(part => [part, Math.max(0, ...part.ownInk.map(rect => rect.y + rect.height))]));
  const contourTops = new WeakMap<LifetimeContour, number>();
  const contourTop = (contour: LifetimeContour) => {
    const cached = contourTops.get(contour);
    if (cached !== undefined) return cached;
    let top = 0;
    const bounds = ink(contour).bounds;
    for (let index = 1; index < bounds.length; index += 4) top = Math.min(top, bounds[index]);
    contourTops.set(contour, top); return top;
  };
  const dependents = new Map<Incarnation, Set<Incarnation>>();
  for (const part of parts)
    for (const dependency of [...part.children, ...(part.predecessor ? [part.predecessor] : []), ...(part.slotPredecessor ? [part.slotPredecessor] : [])]) {
      let set = dependents.get(dependency);
      if (!set)
        dependents.set(dependency, set = new Set());
      set.add(part);
    }
  const topologyPairs = new Map<string, boolean>();
  const sameTopology = (a: Incarnation, b: Incarnation): boolean => {
    if (a === b) return true;
    const key = `${a.serial}:${b.serial}`, cached = topologyPairs.get(key);
    if (cached !== undefined) return cached;
    const same = a.id === b.id && a.children.length === b.children.length
      && a.children.every((child, index) => sameTopology(child, b.children[index]));
    topologyPairs.set(key, same); return same;
  };
  const parentId = (id: string, hierarchy: ReadonlyMap<string, Node>) => {
    const parent = hierarchy.get(id)?.parent; return parent && hierarchy.has(getNodeId(parent)) ? getNodeId(parent) : undefined;
  };
  const obstructionControls = (part: Incarnation, prior: Incarnation, contacts: readonly { childIndex: number; obstacle: PlaqueRect }[]): WorkspaceClearanceObstruction[] =>
    workspaceClearanceObstructions(part.children, prior.first, frames.length - 1, contacts.flatMap(contact => {
      const nodeId = contact.obstacle.terminalStemNodeId
        ?? contact.obstacle.connectorAttachment?.match(/^(.*):(category|terminal)$/)?.[1];
      return nodeId ? [{ childIndex: contact.childIndex, nodeId }] : [];
    }));
  // Clearance is measured on the composed fork. Its preference may still be
  // narrower because current child or incoming-branch ink already spread it.
  const measuredPreference = (prior: Incarnation, split: number, increase: number, side: WorkspaceGapRequest['side']): WorkspaceGapRequest => ({
    incarnation: prior.serial, split, increase, side,
    realizedGap: prior.shape!.members.get(prior.children[split].id)!.x - prior.shape!.members.get(prior.children[split - 1].id)!.x
  });
  const slotWitnessCache = new Map<Incarnation, readonly (readonly (readonly [string, string])[])[]>();
  // Ownership and topology are immutable within this preparation. Only the
  // witness coordinates change while the spacing search evaluates trials.
  const slotWitnesses = (part: Incarnation) => {
    const cached = slotWitnessCache.get(part);
    if (cached) return cached;
    const prepare = () => {
      const previous = part.predecessor ?? part.slotPredecessor;
      const priorParts = new Map<string, Incarnation>();
      const collect = (item: Incarnation) => { priorParts.set(item.id, item); for (const child of item.children)
        collect(child); };
      if (previous)
        collect(previous);
      const movements = currentWorkspaceMovements(part.step, part.beforeNodes, part.birthNodes);
      const landingIds = new Set<string>(rigidMovementHosts(part.step, part.beforeHierarchy, part.hierarchy, part.beforeHierarchy, part.hierarchy));
      const exclude = (item: Incarnation) => { landingIds.add(item.id); for (const child of item.children)
        exclude(child); };
      const topology = (nodes: ReadonlyMap<string, Incarnation>, hierarchy: ReadonlyMap<string, Node>) => ({
        has: (id: string) => nodes.has(id),
        parent: (id: string) => { const parent = hierarchy.get(id)?.parent; return parent && hierarchy.has(getNodeId(parent)) ? getNodeId(parent) : undefined; },
        children: (id: string) => nodes.get(id)?.children.map(child => child.id) ?? [],
        contains: (root: string, id: string): boolean => {
          for (let node = hierarchy.get(id); node && hierarchy.has(getNodeId(node)); node = node.parent ?? undefined) if (getNodeId(node) === root) return true;
          return false;
        }
      });
      for (const id of neutralWorkspaceAttachments(part.step,
        topology(part.beforeNodes, part.beforeHierarchy), topology(part.birthNodes, part.hierarchy),
        id => part.beforeNodes.get(id) === part.birthNodes.get(id))) landingIds.add(id);
      // Receiver ownership permits outer translation. Its retained interior
      // slots still constrain the newly composed shell.
      for (const id of extractionReceivingHosts(part.step, topology(part.beforeNodes, part.beforeHierarchy), topology(part.birthNodes, part.hierarchy)))
        landingIds.add(id);
      for (const id of movementReceivingHosts(part.step, topology(part.beforeNodes, part.beforeHierarchy), topology(part.birthNodes, part.hierarchy), id => {
        const before = part.beforeNodes.get(id), current = part.birthNodes.get(id);
        return !!before && !!current && sameTopology(before, current);
      })) landingIds.add(id);
      for (const link of movements) {
        exclude(part.birthNodes.get(link.targetNodeId!)!);
        if (part.beforeNodes.get(link.priorSourceNodeId!) !== part.birthNodes.get(link.witnessNodeId!))
          exclude(part.birthNodes.get(link.witnessNodeId!)!);
      }
      if (part.step.replayKind === 'micro' && ['Project', 'ExternalMerge'].includes(String(part.step.operation))) {
        const target = part.birthNodes.get(part.step.targetNodeId), sources = part.step.sourceNodeIds ?? [];
        const targetNode = part.hierarchy.get(part.step.targetNodeId);
        const parentId = (node: Node | undefined, nodes: ReadonlyMap<string, Node>) => node?.parent && nodes.has(getNodeId(node.parent)) ? getNodeId(node.parent) : undefined;
        if (target && targetNode && !part.beforeNodes.has(target.id) && sources.length === target.children.length
          && target.children.every(child => sources.includes(child.id) && part.beforeNodes.has(child.id))) {
          for (const child of target.children) {
            const previous = part.beforeNodes.get(child.id), oldNode = part.beforeHierarchy.get(child.id);
            if (previous !== child || !oldNode)
              continue;
            const oldOwner = parentId(oldNode, part.beforeHierarchy), newOwner = parentId(targetNode, part.hierarchy);
            if (oldOwner === undefined || oldOwner === newOwner)
              exclude(child);
          }
        }
      }
      return part.children.map(child => {
          const constraints: Array<readonly [string, string]> = [];
          const visit = (item: Incarnation) => {
            if (landingIds.has(item.id))
              return;
            const prior = priorParts.get(item.id);
            // Updating a category, word or silence does not grant a new
            // position when its current topology and parent are unchanged.
            const unowned = (node: Incarnation): boolean => !landingIds.has(node.id) && node.children.every(unowned);
            const fixedPoint = prior && unowned(item) && parentId(item.id, part.beforeHierarchy) === parentId(item.id, part.hierarchy)
              && (sameTopology(prior, item) || changesOwnedDisplayTerminal(part.beforeHierarchy, part.hierarchy, item.id));
            if (prior === item || fixedPoint) {
              constraints.push([item.id, item.id]);
              if (prior === item) return;
            }
            for (const nested of item.children)
              visit(nested);
          };
          visit(child);
          for (const link of movements) {
            const sourceId = link.priorSourceNodeId!, witnessId = link.witnessNodeId!;
            const sourceOwner = parentId(sourceId, part.beforeHierarchy), witnessOwner = parentId(witnessId, part.hierarchy);
            const oldOwner = sourceOwner && part.beforeNodes.get(sourceOwner), newOwner = witnessOwner && part.birthNodes.get(witnessOwner);
            // Preserve a distinct lower root only when the accepted boundary
            // already kept its source point. Its authored contour stays separate.
            const sameSlot = sourceId !== witnessId && part.stationaryWitnessPairs.some(([source, witness]) => source === sourceId && witness === witnessId)
              && oldOwner && newOwner && sourceOwner === witnessOwner
              && oldOwner.children.length === newOwner.children.length
              && oldOwner.children.every((child, i) => (child.id === sourceId ? witnessId : child.id) === newOwner.children[i].id);
            if (part.beforeNodes.get(sourceId) !== part.birthNodes.get(witnessId) && !sameSlot)
              continue;
            // A lower point can retain its slot inside its current shell. A
            // newly inserted owning ancestor may translate that whole shell;
            // do not carry the point equation across that changed boundary.
            const sourcePath = connectedParentPath(sourceId, previous!.id, part.beforeHierarchy);
            const witnessPath = connectedParentPath(witnessId, part.id, part.hierarchy);
            if (!sourcePath || !witnessPath || JSON.stringify(sourcePath) !== JSON.stringify(witnessPath)) continue;
            // Only this child can supply the current witness point.
            const contains = (node: Incarnation, id: string): boolean => node.id === id || node.children.some(child => contains(child, id));
            if (priorParts.has(sourceId) && contains(child, witnessId)) constraints.push([sourceId, witnessId]);
          }
          return constraints;
        });
    };
    const result = prepare();
    slotWitnessCache.set(part, result);
    return result;
  };
  let previousInputs = new Map<number, {
    selected: CoordinateSnapshot;
    preferred: CoordinateSnapshot;
  }>();
  let previousInheritance: boolean | undefined;
  const preferenceIds = new Map(parts.map(part => [part, [part.id, ...part.children.map(child => child.id)]]));
  // Re-read every consumed coordinate, including in-place Map edits. An
  // unchanged snapshot can be shared by the trial's immutable certificate.
  const selectedSnapshot = (points: ReadonlyMap<string, Point> | undefined, prior?: CoordinateSnapshot): CoordinateSnapshot => {
    if (!points) return prior?.length === 0 ? prior : [];
    if (prior?.length === 1 + points.size * 3 && prior[0] === points.size) {
      let index = 1, same = true;
      for (const [id, point] of points) {
        if (prior[index++] !== id || !Object.is(prior[index++], point.x) || !Object.is(prior[index++], point.y)) {
          same = false; break;
        }
      }
      if (same) return prior;
    }
    const result: Array<string | number> = [points.size];
    for (const [id, point] of points) result.push(id, point.x, point.y);
    return result;
  };
  const preferredSnapshot = (ids: readonly string[], points: ReadonlyMap<string, Point> | undefined, prior?: CoordinateSnapshot): CoordinateSnapshot => {
    if (prior?.length === ids.length * 3 && ids.every((id, index) => {
      const point = points?.get(id), start = index * 3;
      return prior[start] === id && Object.is(prior[start + 1], point?.x) && Object.is(prior[start + 2], point?.y);
    })) return prior;
    const result: Array<string | number | undefined> = [];
    for (const id of ids) { const point = points?.get(id); result.push(id, point?.x, point?.y); }
    return result;
  };
  const gapTopology = parts.map(part => ({ incarnation: part.serial, id: part.id, childIds: part.children.map(child => child.id),
    dependencies: [...part.children, ...(part.predecessor ? [part.predecessor] : []), ...(part.slotPredecessor ? [part.slotPredecessor] : [])].map(dependency => dependency.serial) }));
  const lockedGapReferences = new WeakMap<readonly ContourFrame[], WorkspaceLockedGapReference>();
  const lastFrames: Array<ContourFrame | undefined> = [];
  const compositionSnapshots = new Map<readonly ContourFrame[], {
    inputs: typeof previousInputs;
    inheritance: typeof previousInheritance;
    parts: Array<{ shape: LifetimeContour | undefined; fixedSlots: Incarnation['fixedSlots'] }>;
  }>();
  let completedFrames: readonly ContourFrame[] | undefined;
  function compose(selectedContours?: ContourSelection, composition?: Composition): ContourFrame[] {
    completedFrames = undefined;
    if (composition?.baseline) {
      const snapshot = compositionSnapshots.get(composition.baseline);
      if (!snapshot) throw Error('Workspace composition baseline was not retained.');
      previousInputs = snapshot.inputs;
      previousInheritance = snapshot.inheritance;
      parts.forEach((part, index) => {
        part.shape = snapshot.parts[index].shape;
        part.fixedSlots = snapshot.parts[index].fixedSlots;
      });
      composition.baseline.forEach((frame, index) => { lastFrames[index] = frame; });
    }
    const inputs = new Map<number, {
      selected: CoordinateSnapshot;
      preferred: CoordinateSnapshot;
    }>();
    const pending = parts.filter(part => {
      const selected = selectedContours?.get(part.serial), preferred = composition?.preferred?.get(part.serial);
      const prior = previousInputs.get(part.serial);
      const value = {
        selected: selectedSnapshot(selected, prior?.selected),
        preferred: preferredSnapshot(preferenceIds.get(part)!, preferred, prior?.preferred)
      };
      inputs.set(part.serial, value);
      return previousInheritance !== composition?.inheritCurrentSlots
        || prior?.selected !== value.selected || prior?.preferred !== value.preferred;
    });
    const invalid = new Set<Incarnation>();
    while (pending.length) {
      const part = pending.pop()!;
      if (invalid.has(part))
        continue;
      invalid.add(part);
      part.shape = undefined;
      part.fixedSlots = undefined;
      pending.push(...(dependents.get(part) ?? []));
    }
    previousInputs = inputs;
    previousInheritance = composition?.inheritCurrentSlots;
    function shape(part: Incarnation): LifetimeContour {
      if (part.shape)
        return part.shape;
      const children = part.children.map(shape), childInk: PlaqueRect[] = [];
      let members = new Map<string, Point>([[part.id, { x: 0, y: 0 }]]);
      let childSlots: readonly Point[] = [], childCenter = 0;
      const placeChildren = (slots: readonly Point[], center: number) => {
        childSlots = slots; childCenter = center;
        children.forEach((child, index) => {
          const origin = child.members.get(child.id)!, slot = slots[index];
          members.set(child.id, { x: origin.x + slot.x - center, y: origin.y + slot.y });
        });
      };
      const lower = ownBottom.get(part)!;
      let childTop = 0;
      for (const child of children) childTop = Math.min(childTop, contourTop(child));
      const rank = Math.max(220, lower - childTop + 16);
      const fixedSlots = new Map<number, Point>();
      part.fixedSlots = fixedSlots;
      const supplied = composition?.preferred?.get(part.serial);
      const completePreferred = composition?.inheritCurrentSlots && [part.id, ...children.map(child => child.id)].every(id => {
        const point = supplied?.get(id);
        return point && Number.isFinite(point.x) && Number.isFinite(point.y);
      });
      if (!completePreferred) {
        const anchors: number[] = [];
        for (const child of children) {
          const boxes = translateWorkspaceObstacles(child.obstacles, 0, rank);
          let x = anchors.length ? anchors.at(-1)! + 1 : 0;
          for (const a of childInk)
            for (const b of boxes)
              if (Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y))
                x = Math.max(x, a.x + a.width - b.x + 16);
          anchors.push(x);
          childInk.push(...translateWorkspaceObstacles(boxes, x, 0));
        }
        const center = anchors.length ? (anchors[0] + anchors.at(-1)!) / 2 : 0;
        placeChildren(anchors.map(x => ({ x, y: rank })), center);
      }
      if (composition?.inheritCurrentSlots && children.length) {
        const preferred = composition.preferred?.get(part.serial), preferredRoot = preferred?.get(part.id);
        const previous = part.predecessor ?? part.slotPredecessor, old = previous && shape(previous);
        const locked = fixedSlots;
        if (old) part.children.forEach((child, index) => {
          const chosen = children[index];
          const constraints = slotWitnesses(part)[index].map(([beforeId, currentId]) => {
            const before = old.members.get(beforeId)!, local = chosen.members.get(currentId)!;
            return { x: before.x - local.x, y: before.y - local.y };
          });
          if (constraints.length) {
            const first = constraints[0];
            if (constraints.some(point => Math.hypot(point.x - first.x, point.y - first.y) > 1e-6))
              throw Error(`Incompatible current slots ${part.serial}:${part.id}/${child.id}`);
            locked.set(index, first);
          }
        });
        const lockedRanks = [...locked.values()].map(point => point.y);
        const preferredRanks = part.children.map(child => preferred?.get(child.id)).filter(Boolean).map(point => point!.y - (preferredRoot?.y ?? 0));
        const childRank = lockedRanks.length && lockedRanks[0] > 0 ? lockedRanks[0]
          : workspaceReferenceRank(preferredRanks, part.currentRanks, part.latestCurrentRank, rank, preferredRanks.length === children.length, part.inheritedRows);
        if (lockedRanks.some(y => Math.abs(y - lockedRanks[0]) > 1e-6))
          throw Error(`Incompatible current ranks ${part.serial}:${part.id} ${JSON.stringify({ frame: part.first + 1, locked: [...locked], children: children.map(child => child.id), preferredRanks })}`);
        const separation = children.map(() => children.map(() => 0));
        for (let i = 0; i < children.length; i++)
          for (let j = i + 1; j < children.length; j++)
            separation[i][j] = pair(children[i], children[j]).separation;
        for (let distance = 2; distance < children.length; distance++)
          for (let i = 0; i + distance < children.length; i++) {
            const j = i + distance;
            for (let k = i + 1; k < j; k++)
              separation[i][j] = Math.max(separation[i][j], separation[i][k] + separation[k][j]);
          }
        const alignment = [...locked].map(([index, point]) => point.x - ((preferred?.get(children[index].id)?.x ?? NaN) - (preferredRoot?.x ?? 0)));
        const preferredShift = alignment.length && alignment.every(dx => Number.isFinite(dx) && Math.abs(dx - alignment[0]) <= 1e-6) ? alignment[0] : 0;
        const preferredSlots = children.map((child, index) => locked.get(index)?.x ?? ((preferred?.get(child.id)?.x ?? NaN) - (preferredRoot?.x ?? 0) + preferredShift));
        const clearAt = (slots: readonly number[]) => slots.every((value, index) => Number.isFinite(value) && (!index || value > slots[index - 1]))
          && children.every((left, i) => children.every((right, j) => j <= i || clearPair(left, right, slots[j] - slots[i])))
          && currentForkBranchesClear({ x: (slots[0] + slots.at(-1)!) / 2, y: 0 }, children.map((child, index) => ({ point: { x: slots[index], y: childRank }, obstacles: ink(child) })));
        const slots: number[] = clearAt(preferredSlots) ? preferredSlots : [];
        if (!slots.length)
          for (let i = 0; i < children.length; i++) {
            let low = -Infinity, high = Infinity;
            for (let j = 0; j < i; j++)
              low = Math.max(low, slots[j] + separation[j][i]);
            for (const [j, point] of locked)
              if (j > i)
                high = Math.min(high, point.x - separation[i][j]);
            const fixed = locked.get(i)?.x;
            if (low > high + 1e-6 || (fixed !== undefined && (fixed < low - 1e-6 || fixed > high + 1e-6))) {
              const detail = `Current slots cannot clear children ${part.serial}:${part.id} at frame ${part.first + 1}.`;
              const pairs = [...locked].flatMap(([left, a]) => [...locked].filter(([right]) => right > left)
                .map(([right, b]) => ({ left, right, increase: separation[left][right] - (b.x - a.x) })));
              const obstruction = pairs.filter(pair => pair.increase > 1e-6).sort((a, b) => b.increase - a.increase || a.left - b.left || a.right - b.right)[0];
              if (obstruction) for (let prior = part.predecessor; prior; prior = prior.predecessor) {
                if (prior.children.length !== part.children.length || prior.children.some((child, index) => child.id !== part.children[index].id)) break;
                if (!prior.fixedSlots) break;
                const fixed = [...prior.fixedSlots.keys()], split = obstruction.right;
                const leftFree = fixed.every(index => index >= split), rightFree = fixed.every(index => index < split);
                if (leftFree || rightFree) {
                  const contact = pairCollision(children[obstruction.left], children[obstruction.right], locked.get(obstruction.right)!.x - locked.get(obstruction.left)!.x);
                  throw new WorkspaceContourClearanceError(detail, measuredPreference(prior, split, obstruction.increase + 1e-6, leftFree && rightFree ? 'both' : leftFree ? 'left' : 'right'), contact ? obstructionControls(part, prior,
                      [{ childIndex: obstruction.left, obstacle: contact[0] }, { childIndex: obstruction.right, obstacle: contact[1] }]) : []);
                }
              }
              throw Error(detail);
            }
            const wanted = preferredSlots[i];
            slots[i] = fixed ?? Math.max(low, Math.min(high, Number.isFinite(wanted) ? wanted : members.get(children[i].id)!.x));
          }
        const center = (slots[0] + slots.at(-1)!) / 2;
        placeChildren(slots.map(x => ({ x, y: childRank })), center);
      }
      const forkClear = () => currentForkBranchesClear({ x: 0, y: 0 }, children.map(child => ({ point: members.get(child.id)!, obstacles: ink(child) })));
      const originalForkClear = forkClear();
      if (!originalForkClear) {
        if (fixedSlots.size > 1) {
          const detail = `Locked current fork branches cross child ink ${part.serial}:${part.id}`;
          // Current slots remain fixed. Reserve any missing fork clearance at
          // the nearest earlier incarnation where a whole side was still free.
          for (let prior = part.predecessor; prior; prior = prior.predecessor) {
            if (prior.children.length !== part.children.length || prior.children.some((child, index) => child.id !== part.children[index].id)) break;
            if (!prior.fixedSlots) break;
            const fixed = [...prior.fixedSlots.keys()];
            let request: WorkspaceContourClearanceError['preference'] | undefined;
            for (let split = 1; split < children.length; split++) {
              const leftFree = fixed.every(index => index >= split), rightFree = fixed.every(index => index < split);
              if (!leftFree && !rightFree) continue;
              const side = leftFree && rightFree ? 'both' : leftFree ? 'left' : 'right';
              const positions = (increase: number) => children.map((child, index) => {
                const point = members.get(child.id)!;
                const shift = side === 'both' ? (index < split ? -.5 : .5) : side === 'left' ? (index < split ? -1 : 0) : (index < split ? 0 : 1);
                return { x: point.x + shift * increase, y: point.y };
              });
              const clear = (increase: number) => {
                const points = positions(increase), center = (points[0].x + points.at(-1)!.x) / 2;
                return currentForkBranchesClear({ x: center, y: 0 }, children.map((child, index) => ({ point: points[index], obstacles: ink(child) })))
                  && children.every((left, i) => children.every((right, j) => j <= i || clearPair(left, right, points[j].x - points[i].x)));
              };
              let low = 0, high = Math.max(1, members.get(children.at(-1)!.id)!.x - members.get(children[0].id)!.x);
              for (let attempt = 0; attempt < 8 && !clear(high); attempt++) { low = high; high *= 2; }
              if (!clear(high)) continue;
              for (let attempt = 0; attempt < 20; attempt++) {
                const middle = (low + high) / 2;
                if (clear(middle)) high = middle; else low = middle;
              }
              if (!request || high < request.increase)
                request = measuredPreference(prior, split, high + 1e-6, side);
            }
            if (request) {
              const contact = currentForkBranchCollision({ x: 0, y: 0 }, children.map(child => ({ point: members.get(child.id)!, obstacles: ink(child) })));
              throw new WorkspaceContourClearanceError(detail, request, contact ? obstructionControls(part, prior, [contact]) : []);
            }
          }
          throw Error(detail);
        }
        const original = children.map(child => members.get(child.id)!);
        const lockedIndex = fixedSlots.keys().next().value;
        const pivot = lockedIndex === undefined ? 0 : original[lockedIndex].x;
        const positions = (factor: number) => original.map(point => ({ x: pivot + (point.x - pivot) * factor, y: point.y }));
        const clear = (points: readonly Point[]) => {
          const center = (points[0].x + points.at(-1)!.x) / 2;
          return currentForkBranchesClear({ x: center, y: 0 }, children.map((child, index) => ({ point: points[index], obstacles: ink(child) })))
            && children.every((left, i) => children.every((right, j) => j <= i || clearPair(left, right, points[j].x - points[i].x)));
        };
        let low = 1, high = 2;
        for (let attempt = 0; attempt < 8 && !clear(positions(high)); attempt++) { low = high; high *= 2; }
        if (!clear(positions(high))) throw Error(`Current fork branches cannot clear child ink ${part.serial}:${part.id}`);
        for (let attempt = 0; attempt < 20; attempt++) {
          const middle = (low + high) / 2;
          if (clear(positions(middle))) high = middle; else low = middle;
        }
        const points = positions(high), center = (points[0].x + points.at(-1)!.x) / 2;
        placeChildren(points, center);
      }
      const selected = selectedContours?.get(part.serial);
      let previousShapes = contourCache.get(part.serial);
      if (!previousShapes) contourCache.set(part.serial, previousShapes = new Map());
      const cachedShape = (key: string) => {
        const prior = previousShapes.get(key);
        if (prior) {
          previousShapes.delete(key);
          previousShapes.set(key, prior);
        }
        return prior;
      };
      // Immutable child contours and the original translation operands fully
      // determine ordinary members. Keep the center separate: reassociating
      // `point.x + slot.x - center` changes rounding in deep or distant trees.
      const scalar = (value: number) => Object.is(value, -0) ? '-0' : value;
      const compositionKey = !selected && Number.isFinite(childCenter)
        && childSlots.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))
        ? JSON.stringify(['composition', scalar(childCenter), ...children.map((child, index) =>
          [identityOf(child), scalar(childSlots[index].x), scalar(childSlots[index].y)])]) : undefined;
      const previousComposition = compositionKey && cachedShape(compositionKey);
      if (previousComposition) return part.shape = previousComposition;
      members = new Map([[part.id, { x: 0, y: 0 }]]);
      children.forEach((child, index) => { for (const [id, point] of child.members)
        members.set(id, { x: point.x + childSlots[index].x - childCenter, y: point.y + childSlots[index].y }); });
      if (selected) {
        const origin = selected.get(part.id);
        if (!origin || selected.size !== members.size || [...members.keys()].some(id => !selected.has(id)))
          throw Error(`Incomplete selected contour ${part.serial}:${part.id}`);
        for (const [id, point] of selected) {
          if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
            throw Error(`Nonfinite selected contour ${part.serial}:${part.id}`);
          members.set(id, { x: point.x - origin.x, y: point.y - origin.y });
        }
        let last = -Infinity, y: number | undefined;
        for (const child of children) {
          const point = members.get(child.id)!;
          if (point.y <= 0 || point.x <= last || (y !== undefined && Math.abs(point.y - y) > 1e-6))
            throw Error(`Invalid selected fork ${part.serial}:${part.id}`);
          last = point.x;
          y = point.y;
          for (const [id, local] of child.members) {
            const own = members.get(id)!;
            if (Math.hypot(own.x - point.x - local.x, own.y - point.y - local.y) > 1e-6)
              throw Error(`Selected contour changes child ${part.serial}:${part.id}/${child.id}`);
          }
        }
      }
      const geometryKey = compositionKey ?? JSON.stringify([...members]);
      const previousShape = compositionKey ? undefined : cachedShape(geometryKey);
      if (previousShape) {
        return part.shape = previousShape;
      }
      for (let i = 0; i < children.length; i++)
        for (let j = i + 1; j < children.length; j++)
          if (!clearPair(children[i], children[j], members.get(children[j].id)!.x - members.get(children[i].id)!.x))
            throw Error(`Selected contour overlaps children ${part.serial}:${part.id}`);
      // Expanding descendant members leaves the already checked child slots
      // unchanged. Selected coordinates or clearance expansion need a new check.
      if ((selected || !originalForkClear) && !forkClear()) throw Error(`Selected fork branches cross child ink ${part.serial}:${part.id}`);
      // Rejected searches retain scalar bounds without allocating a rectangle
      // per ancestor. Accepted-plan consumers keep the same ordered object API.
      let buffered: WorkspaceObstacleBuffer | undefined;
      const getInk = () => {
        if (!buffered) {
          const branches = part.children.flatMap(child =>
            plaqueBranchObstacles({ x: 0, y: 0 }, members.get(child.id)!, true));
          buffered = composeWorkspaceObstacleBuffer(part.ownInk, children.map(child => {
            const point = members.get(child.id)!;
            return { obstacles: ink(child), x: point.x, y: point.y };
          }), branches);
        }
        return buffered;
      };
      const result: LifetimeContour = { id: part.id, incarnation: part.serial, first: part.first, last: part.last, members,
        get obstacles() { return getInk().rectangles(); }, children };
      contourInk.set(result, getInk);
      previousShapes.set(geometryKey, result);
      if (previousShapes.size > 2)
        previousShapes.delete(previousShapes.keys().next().value!);
      return part.shape = result;
    }
    const result = frames.map((frame, index) => {
      const roots = frame.roots.map(shape), prior = lastFrames[index];
      // Resolving every current root above also resolves its current members.
      // Reuse only an exactly unchanged immutable frame; changed frames keep
      // fresh maps so an earlier accepted trial retains its own geometry.
      if (prior && roots.every((root, i) => root === prior.roots[i])
        && [...frame.nodes].every(([id, part]) => prior.nodes.get(id) === part.shape)) return prior;
      return lastFrames[index] = { step: frame.step, roots,
        nodes: new Map([...frame.nodes].map(([id, part]) => [id, part.shape!])),
        displayTerminalChanges: frame.displayTerminalChanges };
    });
    if (selectedContours === undefined && composition?.inheritCurrentSlots === true) {
      const locked = new Set(parts.filter(part => part.children.length > 1 && part.fixedSlots?.size === part.children.length
        && part.children.every((_, index) => {
          const point = part.fixedSlots?.get(index);
          return point && Number.isFinite(point.x) && Number.isFinite(point.y);
        })).map(part => part.serial));
      // inputs is a fresh value snapshot for this invocation. Later trials
      // replace it and the fixed-slot maps; neither can change this certificate.
      lockedGapReferences.set(result, { topology: gapTopology, inputs, locked });
    }
    completedFrames = result;
    return result;
  }
  return Object.assign(compose, {
    // Search alternatives share one accepted base. Restoring its immutable
    // certificates avoids undoing the preceding rejected alternative first.
    retainBaseline: (result: readonly ContourFrame[]) => {
      if (completedFrames !== result) throw Error('Only the completed workspace composition can be retained.');
      compositionSnapshots.set(result, { inputs: previousInputs, inheritance: previousInheritance,
        parts: parts.map(part => ({ shape: part.shape, fixedSlots: part.fixedSlots })) });
    },
    retainOnlyBaseline: (result: readonly ContourFrame[]) => {
      if (!compositionSnapshots.has(result)) throw Error('Workspace composition baseline was not retained.');
      for (const frames of compositionSnapshots.keys()) if (frames !== result) compositionSnapshots.delete(frames);
    },
    preservesLockedGap: (frames: readonly ContourFrame[], preferences: ContourSelection, control: { incarnation: number; split: number }) =>
      preservesLockedWorkspaceGap(lockedGapReferences.get(frames), preferences, control),
  });
}
export function buildWorkspaceLifetimeContours(steps: readonly PlaybackStep[], measureCategoryText?: CategoryTextMeasure, measureTreeInk?: TreeInkTextMeasure, treeLabelRuns?: PreparedTreeLabelRuns, measureTreeLabel?: TreeLabelMeasure, selectedContours?: ContourSelection, composition?: Composition): ContourFrame[] {
  return prepareWorkspaceLifetimeContours(steps, measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel)(selectedContours, composition);
}
/** Initial roots are packed at deterministic origins. The lifetime planner owns
* later rigid translations; these maps contain only currently visible syntax. */
export function workspaceLifetimeContourCoordinates(frames: readonly ContourFrame[]) {
  const result = new Map<SyntaxNode, Map<string, Point>>();
  for (const frame of frames) {
    const coordinates = new Map<string, Point>();
    let edge = 0;
    for (const root of frame.roots) {
      const left = Math.min(0, ...root.obstacles.map(rect => rect.x)), right = Math.max(0, ...root.obstacles.map(rect => rect.x + rect.width));
      const dx = edge - left;
      for (const [id, point] of root.members)
        coordinates.set(id, { x: point.x + dx, y: point.y });
      edge += right - left + 120;
    }
    result.set(frame.step.replayCanvasData!, coordinates);
  }
  return result;
}
/** Existing complete poses are candidates, not independent child choices. A
* caller selecting one must select its retained child contours coherently; the
* builder rejects a parent selection that would rescale any selected child. */
export function workspaceContourCandidates(frames: readonly ContourFrame[], references: ReadonlyMap<SyntaxNode, ReadonlyMap<string, Point>>) {
  const result = new Map<number, Array<{
    frame: number;
    positions: Map<string, Point>;
  }>>();
  frames.forEach((frame, index) => {
    const reference = references.get(frame.step.replayCanvasData!);
    if (!reference)
      return;
    for (const shape of frame.nodes.values()) {
      const origin = reference.get(shape.id);
      if (!origin || [...shape.members.keys()].some(id => !reference.has(id)))
        continue;
      const positions = new Map([...shape.members.keys()].map(id => { const point = reference.get(id)!; return [id, { x: point.x - origin.x, y: point.y - origin.y }]; }));
      const candidates = result.get(shape.incarnation) ?? [];
      if (!candidates.some(candidate => [...positions].every(([id, p]) => { const prior = candidate.positions.get(id)!; return Math.hypot(p.x - prior.x, p.y - prior.y) < 1e-6; })))
        candidates.push({ frame: index, positions });
      result.set(shape.incarnation, candidates);
    }
  });
  return result;
}
