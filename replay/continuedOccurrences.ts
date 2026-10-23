/** Preceding occurrences that a stage authors again under a new id. */
import type { ResolvedRelationLink } from '../relationLinks.ts';
import type { SyntaxNode } from '../types.ts';
import { getMovementLandingNodeId } from './authoredFrames.ts';
import type { ReplayIdentityContext } from './displayIdentity.ts';
import { isMoveLikeOperation } from './movementLinks.ts';
import {
  getRelationAllAnchorNodeIds,
  getRelationSourceNodeIds,
  getRelationTargetNodeId,
  relationAnchorNodeIds
} from './relationAnchors.ts';
import { isRegisteredTrajectoryRelation } from './relations/movementIdentities.ts';
import { lexicalLeafIdUnderOwner } from './replayCanvas.ts';
import {
  collectSyntaxSubtreeNodeIds,
  type ExactForestNodeLocation,
  findExactNodeByIdInForest,
  indexExactForestNodeLocations
} from './syntaxForest.ts';
import { relationOwnsNonMovementTreeTransition, resolveFallbackTreeTransitionOwnership } from './treeTransitions.ts';
import type { DerivationReplayPlanStep, PlaybackStep, ReplayDerivationFrame } from './types.ts';

const ownContent = (node: SyntaxNode): string => JSON.stringify([String(node.label || '').trim(), String(node.word || '').trim(),
  node.silent === true, String(node.lineageId || '')]);

/**
 * Pairs each dissolved preceding node with the new node that structurally
 * continues it, as `previous id -> current id`. Construction then treats the
 * pair as one occurrence, exactly as if the stage had kept the id: only the
 * genuinely new material is built, in place.
 *
 * A new node continues a dissolved one when it has the same own content
 * (category, word, silence, lineage), occupies the same slot (the same child
 * position under the continuing parent, or a root that stays a root or gains
 * a genuinely new parent), and keeps every preceding daughter, or that
 * daughter's continuation, in order, with at most one new node inserted
 * directly above one of them. A pair survives only while every pair it relies
 * on holds and each of its nodes has exactly one candidate partner; anything
 * else fails closed to ordinary construction. Nothing touching the owned
 * material (what a relation of the stage moves or rewrites) pairs; it is read
 * only when some candidate pair exists.
 */
export function continuedOccurrences(
  previousForest: readonly SyntaxNode[],
  currentForest: readonly SyntaxNode[],
  ownedNodeIds: () => ReadonlySet<string>
): Map<string, string> {
  const previous = indexExactForestNodeLocations(previousForest as SyntaxNode[]);
  const current = indexExactForestNodeLocations(currentForest as SyntaxNode[]);
  const fresh = new Map<string, string[]>();
  for (const [id, location] of current) {
    if (!location || previous.has(id) || !location.node.children?.length) continue;
    const key = ownContent(location.node);
    fresh.set(key, [...(fresh.get(key) ?? []), id]);
  }
  let pairs: Array<[string, string]> = [];
  for (const [id, location] of previous) {
    if (!location || current.has(id) || !location.node.children?.length) continue;
    for (const candidate of fresh.get(ownContent(location.node)) ?? [])
      if (current.get(candidate)!.node.children!.length === location.node.children.length) pairs.push([id, candidate]);
  }
  if (!pairs.length) return new Map();
  const owned = ownedNodeIds(), touches = (location: ExactForestNodeLocation | null | undefined) =>
    collectSyntaxSubtreeNodeIds(location!.node).some(id => owned.has(id));
  pairs = pairs.filter(([from, to]) => !touches(previous.get(from)) && !touches(current.get(to)));
  for (;;) {
    const partners = new Map<string, string[]>(), continued = new Set(pairs.map(([, id]) => id));
    pairs.forEach(([from, to]) => {
      partners.set(from, [...(partners.get(from) ?? []), to]);
      partners.set(to, [...(partners.get(to) ?? []), from]);
    });
    const continues = (oldId: string, node: SyntaxNode | null): boolean => Boolean(oldId && node?.id) && (node!.id === oldId
      ? Boolean(previous.get(oldId) && current.get(oldId))
      : Boolean(partners.get(oldId)?.includes(node!.id)));
    const genuinelyNew = (node: SyntaxNode | null): boolean => Boolean(node?.id && current.get(node.id)
      && !previous.has(node.id) && !continued.has(node.id));
    const consistent = ([from, to]: [string, string]): boolean => {
      const before = previous.get(from)!, after = current.get(to)!;
      let insertions = 0;
      const daughters = before.node.children!.every((daughter, index) => {
        const child = after.node.children![index];
        if (continues(daughter.id, child)) return true;
        insertions += 1;
        return genuinelyNew(child) && Boolean(child.children?.some(grandchild => continues(daughter.id, grandchild)));
      });
      if (!daughters || insertions > 1) return false;
      if (!before.parent) return !after.parent || genuinelyNew(after.parent);
      return continues(before.parentId, after.parent) && before.childIndex === after.childIndex
        && before.parent.children!.length === after.parent!.children!.length;
    };
    const consistentPairs = pairs.filter(consistent);
    const kept = consistentPairs.length < pairs.length ? consistentPairs
      : pairs.filter(([from, to]) => partners.get(from)!.length === 1 && partners.get(to)!.length === 1);
    if (kept.length === pairs.length) break;
    pairs = kept;
  }
  return new Map(pairs);
}

/** The preceding forest with each continued occurrence under its current id. */
export function renameContinuedOccurrences(forest: readonly SyntaxNode[], continuations: ReadonlyMap<string, string>): SyntaxNode[] {
  if (!continuations.size) return forest as SyntaxNode[];
  const rename = (node: SyntaxNode): SyntaxNode => ({
    ...node,
    ...(node.id && continuations.has(node.id) ? { id: continuations.get(node.id) } : {}),
    ...(node.children ? { children: node.children.map(rename) } : {})
  });
  return forest.map(rename);
}

/** Lexical display leaves of `canvas` whose owner continues a preceding
 * occurrence, as `previous display id -> current display id`: the same word
 * under the continued owner, so construction keeps it rather than selecting it
 * again. */
export function continuedLexicalLeafIds(
  canvas: SyntaxNode | null | undefined,
  continuations: ReadonlyMap<string, string>,
  identity: ReplayIdentityContext
): Map<string, string> {
  const leaves = new Map<string, string>();
  if (!canvas || !continuations.size) return leaves;
  const continuedFrom = new Map(Array.from(continuations, ([from, to]) => [to, from]));
  const visit = (node: SyntaxNode) => {
    const from = node.replayOrigin?.kind === 'lexical' ? continuedFrom.get(node.replayOrigin.ownerId ?? '') : undefined;
    const previous = from && node.id ? lexicalLeafIdUnderOwner(node, from, identity) : undefined;
    if (previous && previous !== node.id) leaves.set(previous, node.id!);
    node.children?.forEach(visit);
  };
  visit(canvas);
  return leaves;
}

/** Material that a relation of the stage moves, copies or rewrites. Its own
 * rules place it, so no occurrence touching it continues a predecessor. */
function relationOwnedNodeIds(
  frame: ReplayDerivationFrame,
  relations: readonly DerivationReplayPlanStep[],
  previousForest: SyntaxNode[],
  currentForest: SyntaxNode[]
): Set<string> {
  const owned = new Set<string>();
  const add = (ids: Iterable<string | undefined>) => { for (const id of ids) if (id) owned.add(id); };
  for (const relation of relations) {
    if (relation.recoveredMovement || relation.recoveredMovements?.length || relation.unprovenNewLandingNodeId
      || relation.anchoredCopyDisplacement || isRegisteredTrajectoryRelation(relation.relation, relation.anchors)) {
      add([...getRelationAllAnchorNodeIds(relation), ...relationAnchorNodeIds(relation.anchors),
        ...relationAnchorNodeIds(relation.priorAnchors), getRelationTargetNodeId(relation), ...getRelationSourceNodeIds(relation)]);
      for (const movement of relation.recoveredMovements ?? [relation.recoveredMovement])
        if (movement) add([movement.priorSourceNodeId, movement.sourceNodeId, movement.targetNodeId, movement.witnessNodeId]);
    }
    const ownership = resolveFallbackTreeTransitionOwnership(relation, previousForest, currentForest);
    if (ownership) add([...ownership.currentNodeIds, ...ownership.priorNodeIds, ...(ownership.hostNodeIds ?? [])]);
    if (relationOwnsNonMovementTreeTransition(relation, previousForest, currentForest))
      add(ownership?.currentNodeIds ?? getRelationAllAnchorNodeIds(relation)
        .flatMap(id => collectSyntaxSubtreeNodeIds(findExactNodeByIdInForest(currentForest, id))));
  }
  for (const relation of frame.relations ?? [])
    if (isRegisteredTrajectoryRelation(relation?.relation, relation?.anchors))
      add([...relationAnchorNodeIds(relation.anchors), ...relationAnchorNodeIds(relation.priorAnchors)]);
  return owned;
}

/** The continuations a stage authors over its preceding stage. A stage that
 * encodes movement in its own payload has none; movement rules own it. */
export function stageContinuedOccurrences(
  frames: readonly ReplayDerivationFrame[],
  index: number,
  relations: readonly DerivationReplayPlanStep[]
): Map<string, string> {
  const frame = frames[index], previousForest = frames[index - 1]?.workspaceForest;
  if (!frame || !Array.isArray(previousForest) || !Array.isArray(frame.workspaceForest)) return new Map();
  if (isMoveLikeOperation(frame.movement?.operation || frame.operation) || getMovementLandingNodeId(frame.movement)
    || frame.movement?.sourceNodeId || frame.movement?.traceNodeId || frame.chainId) return new Map();
  return continuedOccurrences(previousForest, frame.workspaceForest,
    () => relationOwnedNodeIds(frame, relations, previousForest, frame.workspaceForest));
}

const linkNodeIds = (link: ResolvedRelationLink): string[] => [link.sourceNodeId, link.targetNodeId, link.witnessNodeId,
  link.priorSourceNodeId, link.sourcePhraseId, ...(link.anchors ?? []).map(anchor => anchor.nodeId)]
  .filter((id): id is string => Boolean(id));

/**
 * Replay paints a continued occurrence as one node. In each stage before its
 * rename it is displayed under the id that continues it (through any later
 * renames), keeping its authored id as an alias, so layout, camera and the
 * painted frames meet the same node on both sides of the rename. Relation
 * claims keep their authored anchors and reach it through that alias, as they
 * reach lexical display terminals. A stage keeps its authored ids where the
 * display id is already in use there, or where a trajectory or claimed tree
 * transition names the occurrence, whose identity stays exact. A lexical
 * display leaf is named after its owner, so it is displayed under the id the
 * same leaf has beneath the occurrence that continues its owner.
 */
export function displayContinuedOccurrences(
  steps: PlaybackStep[],
  frames: readonly ReplayDerivationFrame[],
  continuedInto: (index: number) => ReadonlyMap<string, string>,
  identity: ReplayIdentityContext
): PlaybackStep[] {
  if (!frames.some((_, index) => continuedInto(index).size)) return steps;
  const byStage = new Map<number, PlaybackStep[]>();
  steps.forEach(step => byStage.set(step.replayFrameIndex ?? -1, [...(byStage.get(step.replayFrameIndex ?? -1) ?? []), step]));
  const displays: Map<string, string>[] = frames.map(() => new Map());
  const painted = (stage: number) => {
    const ids = new Set<string>(), lexical = new Map<string, SyntaxNode>();
    const visit = (node: SyntaxNode) => {
      if (node.id) ids.add(node.id);
      if (node.id && node.replayOrigin?.kind === 'lexical' && node.replayOrigin.ownerId) lexical.set(node.id, node);
      node.children?.forEach(visit);
    };
    (byStage.get(stage) ?? []).forEach(step => { if (step.replayCanvasData) visit(step.replayCanvasData); });
    return { ids, lexical };
  };
  let following = painted(frames.length - 1);
  for (let stage = frames.length - 2; stage >= 0; stage--) {
    const here = indexExactForestNodeLocations(frames[stage].workspaceForest || []);
    const next = indexExactForestNodeLocations(frames[stage + 1].workspaceForest || []);
    const continued = continuedInto(stage + 1), stageSteps = byStage.get(stage) ?? [];
    const current = painted(stage), used = new Set<string>([...here.keys(), ...current.ids]), exact = new Set<string>();
    for (const step of stageSteps) {
      (step.replayRelationLinks ?? []).filter(link => link.renderFamily === 'trajectory').flatMap(linkNodeIds).forEach(id => exact.add(id));
      [...(step.replayTreeTransition?.currentNodeIds ?? []), ...(step.replayTreeTransition?.priorNodeIds ?? [])].forEach(id => exact.add(id));
    }
    const successorOf = (id: string) => {
      const location = here.get(id);
      // A continuation names the occurrence's successor even when its id stays on a new segment above it.
      return !location ? undefined : continued.has(id) ? continued.get(id) : next.get(id) ? id : undefined;
    };
    const display = (id: string, successor: string | undefined) => {
      const shown = successor && (displays[stage + 1].get(successor) ?? successor);
      if (shown && shown !== id && !used.has(shown) && !exact.has(id)) displays[stage].set(id, shown);
    };
    for (const id of here.keys()) display(id, successorOf(id));
    for (const [id, leaf] of current.lexical) {
      const owner = successorOf(leaf.replayOrigin!.ownerId!), successor = owner && lexicalLeafIdUnderOwner(leaf, owner, identity);
      if (!exact.has(leaf.replayOrigin!.authoredId ?? '')) display(id, successor && following.ids.has(successor) ? successor : undefined);
    }
    following = current;
  }
  const renamed = (display: ReadonlyMap<string, string>) => (id: string) => display.get(id) ?? id;
  const renameNode = (display: ReadonlyMap<string, string>) => {
    const visit = (node: SyntaxNode): SyntaxNode => {
      const shown = node.id ? display.get(node.id) : undefined, owner = node.replayOrigin?.ownerId;
      return {
        ...node,
        ...(shown ? { id: shown, aliasIds: [...new Set([...(node.aliasIds ?? []), node.id!])] } : {}),
        ...(owner && display.has(owner) ? { replayOrigin: { ...node.replayOrigin!, ownerId: display.get(owner) } } : {}),
        ...(node.children ? { children: node.children.map(visit) } : {})
      };
    };
    return visit;
  };
  return steps.map(step => {
    const display = displays[step.replayFrameIndex ?? -1];
    if (!display?.size) return step;
    const rename = renamed(display);
    return {
      ...step,
      targetNodeId: rename(step.targetNodeId),
      ...(step.sourceNodeIds ? { sourceNodeIds: step.sourceNodeIds.map(rename) } : {}),
      ...(step.replayCanvasData ? { replayCanvasData: renameNode(display)(step.replayCanvasData) } : {}),
      ...(step.replayVisibleNodeIds ? { replayVisibleNodeIds: step.replayVisibleNodeIds.map(rename) } : {}),
      ...(step.replayPendingAttachmentNodeIds ? { replayPendingAttachmentNodeIds: step.replayPendingAttachmentNodeIds.map(rename) } : {}),
      ...(step.replaySuppressAutoRevealNodeIds ? { replaySuppressAutoRevealNodeIds: step.replaySuppressAutoRevealNodeIds.map(rename) } : {}),
      ...(step.replayRealizations ? { replayRealizations: step.replayRealizations.map(group => ({ ...group, nodeIds: group.nodeIds.map(rename) })) } : {}),
      ...(step.replayRelationLinks ? { replayRelationLinks: step.replayRelationLinks.map(link => ({
        ...link,
        ...(link.sourceNodeId ? { sourceNodeId: rename(link.sourceNodeId) } : {}),
        ...(link.targetNodeId ? { targetNodeId: rename(link.targetNodeId) } : {}),
        ...(link.witnessNodeId ? { witnessNodeId: rename(link.witnessNodeId) } : {}),
        ...(link.sourcePhraseId ? { sourcePhraseId: rename(link.sourcePhraseId) } : {}),
        ...(link.anchors ? { anchors: link.anchors.map(anchor => anchor.nodeId ? { ...anchor, nodeId: rename(anchor.nodeId) } : anchor) } : {})
      })) } : {})
    };
  });
}
