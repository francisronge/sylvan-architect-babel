/**
 * Replay construction kernel.
 *
 * Each stage's frames are a pure function of the preceding completed stage P,
 * the current completed stage C, the stage's relations and the movement
 * recognition already attached to them (`recoveredMovement(s)`, neutral rewrite
 * ownership). In every frame each authored node shows its P or C content and
 * its P or C daughters; a slot may already show its C replacement, or a
 * carrier, a node C places between the node and that daughter. A new
 * preterminal may show only its word (selected, not yet projected). So every
 * displayed node has an authored daughter count: no unary chain, partial parent
 * or extra daughter that neither stage authors.
 *
 * A step applies one closed change (`close`): whole switches, slot switches,
 * carriers, content switches and removals of preceding nodes, grown until the
 * result is again such a forest. A construction micro-step owns one target; a
 * relation moment owns what its movement or displacing rewrite changes plus the
 * smallest new parents that take over material from it. Movements claim before
 * other relations. Moments play in authored order: one that changes syntax as
 * soon as it can (cyclically), others after construction; a moment may wait for
 * a later one that introduces syntax it needs. Labels, words and relation names
 * enter only through equality.
 */
import * as d3 from 'd3';
import type { DerivationOperation, SyntaxNode } from '../types.ts';
import type { ResolvedRelationLink } from '../relationLinks.ts';
import { authoredWord, isPronouncedLeaf } from '../server/babelParser/nodePronunciation.js';
import { getFrameStageRecordText } from './authoredFrames.ts';
import type { ReplayCompilation } from './compilationContext.ts';
import { constructionAttachmentUpdates, hasConstructionWrapperInsertions } from './constructionAttachments.ts';
import { renameContinuedOccurrences } from './continuedOccurrences.ts';
import { applyVizIds, getNodeId } from './displayIdentity.ts';
import { buildResolvedLinkTraceIndexMap, resolveTraceIndexFromNodeContext } from './movementIndices.ts';
import { isResolvedMovementLink } from './movementLinks.ts';
import { buildReplayProgressLabel, buildStructuralReplayFallback, getReplayPlanStage } from './playbackFormatting.ts';
import { getRelationAllAnchorNodeIds, getRelationSourceNodeIds, getRelationTargetNodeId, relationAnchorNodeIds } from './relationAnchors.ts';
import { orderRelationMoments } from './relationMomentOrder.ts';
import { buildDerivationReplaySnapshot, buildRenderableDerivationCanvasData, buildVisibleSyntaxSnapshotFromHierarchy, isSyntheticWorkspaceRootNode } from './replayCanvas.ts';
import { hasDeterminerNominalComplement, maybeLowercaseSentenceInitialFunctionSurface } from './replayCasing.ts';
import { getReplayNodeCategoryFromCanvas, getReplayNodeDisplayFromCanvas, getReplayNodeOvertYieldFromCanvas } from './replayNodeDescription.ts';
import { buildRelationReplayBlocks } from './replayPanel.ts';
import { mergeReplayDetailBlocks } from './replayPanelFormatting.ts';
import { extractMovementIndex, formatTraceSurfaceForDisplayValue, isTraceLike, resolveLeafSurface, shouldExpandPreterminalLeaf } from './replaySurfaceNotation.ts';
import type { ReplayStageContext } from './stageContext.ts';
import { forestCanUseCurrentMaterialLayoutScaffold } from './stageLayout.ts';
import { planStageRelations, type RelationPlacement } from './stageRelationPlan.ts';
import { cloneSyntaxTree, collectPronouncedLeafNodeIdsInOrder, collectSyntaxSubtreeNodeIds, findExactNodeByIdInForest, findExactNodesByIdInForest, findNodeByIdInForest,
  isNotationLeaf, normalizeToken, replayEffectiveSilence, resolvedRelationLinkKey, resolveNodeLabel } from './syntaxForest.ts';
import { registeredTrajectoryDisplayKind } from './relations/movementIdentities.ts';
import { buildAnchoredTreeTransitionForest, buildPreMovementStructuralForest, keptIdLandingNodeIds, movementLandingGroups, movementLandingWrapper,
  newReceivingHeadNodeIds, receivingHeadMaterialNodeId, resolveFallbackTreeTransitionOwnership } from './treeTransitions.ts';
import type { PlaybackStep } from './types.ts';

type Rank = (parent: d3.HierarchyNode<SyntaxNode>, child: d3.HierarchyNode<SyntaxNode>, childIndex: number) => number;
/** Post-order over the visible nodes, sisters by rank (ties by daughter index); workspace roots are not steps. */
const buildBottomUpSequence = (root: d3.HierarchyNode<SyntaxNode>, visibleIds: Set<string>, rank: Rank): d3.HierarchyNode<SyntaxNode>[] => {
  const sequence: d3.HierarchyNode<SyntaxNode>[] = [];
  const visit = (node: d3.HierarchyNode<SyntaxNode>) => {
    const workspace = isSyntheticWorkspaceRootNode(node);
    if (!workspace && !visibleIds.has(getNodeId(node))) return;
    (node.children || []).filter(child => visibleIds.has(getNodeId(child))).map((child, index) => ({ child, index, rank: rank(node, child, index) }))
      .sort((left, right) => left.rank === right.rank ? left.index - right.index : left.rank - right.rank).forEach(({ child }) => visit(child));
    if (!workspace) sequence.push(node);
  };
  visit(root);
  return sequence;
};

type Info = { node: SyntaxNode; kids: string[]; parent: string | null; order: number };
type Stage = Map<string, Info>;

/** Every node of a forest by id, or null when an id repeats (not comparable). */
const indexForest = (forest: readonly SyntaxNode[], rename?: ReadonlyMap<string, string>): Stage | null => {
  const out: Stage = new Map();
  let order = 0, ok = true;
  const id = (node: SyntaxNode) => rename?.get(node.id) ?? node.id;
  const visit = (node: SyntaxNode, parent: string | null) => {
    if (!node?.id || out.has(id(node))) { ok = false; return; }
    out.set(id(node), { node, kids: (node.children ?? []).map(id), parent, order: order++ });
    (node.children ?? []).forEach(child => visit(child, id(node)));
  };
  forest.forEach(root => visit(root, null));
  return ok ? out : null;
};

const ownKey = (node: SyntaxNode): string => {
  const { children: _children, id: _id, ...own } = node;
  return JSON.stringify(Object.keys(own).sort().map(key => [key, (own as Record<string, unknown>)[key]]));
};
const sameList = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((id, i) => id === right[i]);

/** How one C node differs from its P state. */
type Diff = { node: string; isNew: boolean; content: boolean; slots: number[] | null };

/**
 * A displayed node: content and daughters from P or C. A slot may show another
 * occupant: a P slot its C occupant, or either a carrier, a node C puts strictly
 * between this node and the occupant the carrier wraps (a head that a later
 * moment's complex will enclose). Carriers keep the authored daughter count.
 */
type Shown = { content: 'P' | 'C'; kids: 'P' | 'C'; slots: ReadonlyMap<number, string>; word?: true };
type Frame = Map<string, Shown>;

/** A change is a set of keys: `w:id` whole switch, `s:id:i` slot to its C occupant,
 * `k:id:i:c` slot carried by c, `c:id` content, `d:id` removal. */
type Keys = Set<string>;

class StageEdit {
  readonly diffs = new Map<string, Diff>();
  readonly prev: Stage; readonly cur: Stage;
  constructor(prev: Stage, cur: Stage) {
    this.prev = prev; this.cur = cur;
    for (const [id, info] of cur) {
      const before = prev.get(id);
      if (!before) { this.diffs.set(id, { node: id, isNew: true, content: true, slots: null }); continue; }
      const content = ownKey(before.node) !== ownKey(info.node);
      const differing = info.kids.flatMap((k, i) => before.kids[i] === k ? [] : [i]);
      if (!content && !differing.length && before.kids.length === info.kids.length) continue;
      const replaceable = before.kids.length === info.kids.length && differing.every(i => this.replaces(id, i));
      this.diffs.set(id, { node: id, isNew: false, content, slots: replaceable ? differing : null });
    }
  }
  /** Whether C's daughter in slot i of `id` replaces P's there, with neither elsewhere in the other list. */
  replaces(id: string, i: number): boolean {
    const before = this.prev.get(id)?.kids, after = this.cur.get(id)?.kids;
    return Boolean(before && after && before.length === after.length && before[i] !== after[i]
      && !after.includes(before[i]) && !before.includes(after[i]));
  }
  /** Whether C puts `c` strictly between `q` and `k`. */
  between(q: string, c: string, k: string): boolean {
    if (c === k || !this.cur.has(k)) return false;
    let below = false;
    for (let at = this.cur.get(k)!.parent; at; at = this.cur.get(at)?.parent ?? null) { if (at === c) below = true; else if (at === q) return below; }
    return false;
  }
  /** Whether C puts `k` beneath `c`. */
  within(c: string, k: string): boolean {
    for (let at = this.cur.get(k)?.parent ?? null; at; at = this.cur.get(at)?.parent ?? null) if (at === c) return true;
    return false;
  }
  /** Whether a node needs a whole switch (new, or daughters not slot-replaceable). */
  reshaped(id: string): boolean { const diff = this.diffs.get(id); return Boolean(diff && (diff.isNew || !diff.slots)); }
  base(shown: Shown, id: string): string[] { return (shown.kids === 'P' ? this.prev : this.cur).get(id)!.kids; }
  kidsOf(frame: Frame, id: string): string[] {
    const shown = frame.get(id);
    if (!shown || shown.word) return [];
    return this.base(shown, id).map((k, i) => shown.slots.get(i) ?? k);
  }
  /** A node fully in its C state. */
  done(frame: Frame, id: string): boolean {
    const shown = frame.get(id), diff = this.diffs.get(id);
    if (!shown || shown.word || !this.cur.has(id)) return false;
    if (diff?.content && shown.content !== 'C') return false;
    return sameList(this.kidsOf(frame, id), this.cur.get(id)!.kids);
  }
  /** A node shown with its C content and C daughters, though a carrier may still stand in a slot. */
  built(frame: Frame, id: string): boolean {
    const shown = frame.get(id);
    return Boolean(shown && !shown.word && this.cur.has(id) && shown.kids === 'C' && (shown.content === 'C' || !this.diffs.get(id)?.content));
  }
  parents(frame: Frame): Map<string, string> {
    const out = new Map<string, string>();
    for (const id of frame.keys()) for (const k of this.kidsOf(frame, id)) out.set(k, id);
    return out;
  }
  apply(frame: Frame, keys: Keys): Frame | null {
    const next: Frame = new Map(frame);
    const parsed = [...keys].map(change => change.split('\u0000'));
    for (const [kind, id] of parsed) {
      if (kind === 'd') next.delete(id);
      else if (kind === 'w') next.set(id, { content: 'C', kids: 'C', slots: new Map() });
    }
    for (const [kind, id, slot, carrier] of parsed) {
      const shown = next.get(id);
      if (kind === 'c') { if (!shown) return null; next.set(id, { ...shown, content: 'C' }); }
      if ((kind === 's' || kind === 'k') && shown && !(kind === 'k' && keys.has(key('s', id, Number(slot))))) {
        const slots = new Map(shown.slots), i = Number(slot), occupant = kind === 's' ? this.cur.get(id)!.kids[i] : carrier;
        if (this.base(shown, id)[i] === occupant) slots.delete(i); else slots.set(i, occupant);
        next.set(id, { ...shown, slots });
      }
    }
    // Each node once; every daughter present and more than its word.
    const seen = new Set<string>();
    for (const id of next.keys()) for (const k of this.kidsOf(next, id)) {
      const shown = next.get(k);
      if (!shown || shown.word || seen.has(k)) return null;
      seen.add(k);
    }
    for (const [id, shown] of next) if (!shown.word && (shown.kids === 'P' || shown.slots.size) && this.done(next, id))
      next.set(id, { content: 'C', kids: 'C', slots: new Map() });
    return next;
  }
}

const key = (kind: string, id: string, slot?: number) => [kind, id, ...(slot === undefined ? [] : [String(slot)])].join('\u0000');
const carrierKey = (id: string, slot: number, carrier: string) => [key('k', id, slot), carrier].join('\u0000');

type Owners = Map<string, number>;
type Mode = { relation?: number; forced?: boolean; planning?: { seeds: Set<string>; foreign: (k: string) => boolean };
  /** A relation moment leaves this unowned construction to its own step, which plays first. */
  constructionFirst?: (id: string) => boolean };

/**
 * The smallest change containing the seed keys after which the frame is again
 * a forest of authored states, or the id that blocks it. A construction step
 * switches only construction-owned material and needs its daughters built; a
 * relation moment switches what it owns (absorbing unowned construction a
 * cascade forces on it) and may keep a daughter in its preceding state.
 * Planning computes a relation's edit on the stage's first frame.
 */
function close(edit: StageEdit, frame: Frame, owners: Owners, seeds: Iterable<string>, mode: Mode): { keys: Keys } | string {
  const { prev, cur } = edit, parents = edit.parents(frame), keys: Keys = new Set(), queue: string[] = [];
  let blocker = '';
  const block = (id: string) => { blocker ||= id; return false; };
  const mayTake = (k: string, id: string): boolean => {
    if (mode.forced || mode.planning) return true;
    const owner = owners.get(k);
    if (mode.relation === undefined) return owner === undefined || block(id);
    if (owner === undefined) {
      if (k.startsWith('w\u0000') && mode.constructionFirst?.(id)) return block(id);
      return true;
    }
    return owner === mode.relation || block(id);
  };
  const add = (k: string, id: string): boolean => {
    if (keys.has(k)) return true;
    // Planning leaves another relation's change to that relation; this one then depends on it.
    if (mode.planning?.foreign(k)) return true;
    if (!mayTake(k, id)) return false;
    keys.add(k); queue.push(k);
    return true;
  };
  const whole = (id: string) => keys.has(key('w', id));
  const dissolving = (id: string) => keys.has(key('d', id));
  const switchWhole = (id: string): boolean => {
    if (!cur.has(id)) return dissolve(id);
    if (edit.built(frame, id)) return true;
    return add(key('w', id), id);
  };
  const dissolve = (id: string): boolean => frame.has(id) ? add(key('d', id), id) : true;
  /** `k` must stand under `parent`: its current parent lets go of it. */
  const release = (k: string, parent: string | null): boolean => {
    const q = parents.get(k);
    return !q || q === parent || letGo(q, k, parent);
  };
  /** `q` stops showing daughter `k`: its slot carries `claimer` or its C occupant, or `q` switches whole or dissolves. */
  const letGo = (q: string, k: string, claimer: string | null = null): boolean => {
    if (whole(q) || dissolving(q)) return true;
    if (!cur.has(q)) return dissolve(q);
    const shown = frame.get(q), slot = edit.kidsOf(frame, q).indexOf(k), occupant = cur.get(q)!.kids[slot];
    if (slot >= 0 && claimer && (shown?.kids === 'C' || edit.replaces(q, slot))) {
      if (claimer === occupant) return add(key('s', q, slot), q);
      if (edit.between(q, claimer, k) && !cur.get(q)!.kids.includes(claimer)) return add(carrierKey(q, slot, claimer), q);
    }
    if (slot >= 0 && shown?.kids === 'P' && edit.replaces(q, slot)) return add(key('s', q, slot), q);
    // A new daughter that takes over a preceding daughter can stand in its slot while the parent
    // keeps its preceding count; the parent's own merge adds its other new daughters.
    if (slot >= 0 && claimer && shown?.kids === 'P' && cur.get(q)!.kids.includes(claimer) && edit.within(claimer, k))
      return add(carrierKey(q, slot, claimer), q);
    return switchWhole(q);
  };
  /** `k` must be shown, as a daughter of `parent`, after the change. */
  const need = (k: string, parent: string): boolean => {
    if (whole(k)) return true;
    const shown = frame.get(k);
    if (!shown || shown.word) {
      if (mode.planning) {
        // Planning adds a new daughter only as the smallest parent taking over material this edit releases.
        if (!mode.planning.seeds.has(key('w', k)) && !takesOver(k, parent)) return true;
        return switchWhole(k);
      }
      if (mode.forced || (mode.relation !== undefined && owners.get(key('w', k)) === mode.relation)) return switchWhole(k);
      // A daughter a later moment completes may be carried by the one present node of it that moment encloses;
      // a daughter later construction completes, by the node this step builds inside it.
      const owned = owners.has(key('w', k)), carrier = owned || mode.relation === undefined ? carrierOf(k, parent) : undefined;
      const slot = cur.get(parent)!.kids.indexOf(k);
      return carrier && whole(parent) && (owned || whole(carrier)) ? add(carrierKey(parent, slot, carrier), parent) && release(carrier, parent) : block(k);
    }
    if (mode.relation === undefined && !mode.forced && !mode.planning && edit.reshaped(k) && !edit.built(frame, k) && owners.get(key('w', k)) === undefined)
      return block(k);
    if (mode.relation !== undefined && owners.get(key('w', k)) === mode.relation && !edit.built(frame, k) && !switchWhole(k)) return false;
    return release(k, parent);
  };
  /** The single highest present node under `k` in C, if `k` itself is not shown. */
  const carrierOf = (k: string, parent: string): string | undefined => {
    const tops: string[] = [];
    const visit = (id: string) => { const shown = frame.get(id); if (shown && !shown.word || whole(id)) tops.push(id); else cur.get(id)?.kids.forEach(visit); };
    cur.get(k)?.kids.forEach(visit);
    // A node still standing elsewhere (a head that the later moment moves in) cannot carry the slot.
    const free = tops.length > 1 ? tops.filter(top => !parents.has(top) || parents.get(top) === parent) : tops;
    return free.length === 1 ? free[0] : undefined;
  };
  const takesOver = (k: string, parent: string): boolean => {
    const before = prev.get(parent);
    if (before && !before.kids.length) return true; // a receiving head's new inner head
    return cur.get(k)!.kids.some(g => {
      const q = parents.get(g);
      return Boolean(q) && (q === parent || whole(q!) || dissolving(q!)
        || [...keys].some(x => x.startsWith(key('s', q!) + '\u0000') || x.startsWith(key('k', q!) + '\u0000')));
    });
  };
  /** A node that lost its parent goes where C puts it, or leaves with what dissolves. */
  const settle = (k: string): boolean => {
    if (!cur.has(k)) return dissolve(k);
    const p = cur.get(k)!.parent;
    if (!p) return true;
    if (whole(p)) return true;
    const slot = cur.get(p)!.kids.indexOf(k);
    if (frame.get(p)?.kids === 'P' && edit.replaces(p, slot)) return add(key('s', p, slot), p);
    return switchWhole(p);
  };
  for (const seed of seeds) {
    const [kind, id] = seed.split('\u0000');
    if (kind === 'w' ? !switchWhole(id) : kind === 'd' ? !dissolve(id) : !add(seed, id)) return blocker || id;
  }
  const lost: string[] = [];
  for (;;) {
    while (queue.length) {
      const k = queue.shift()!, [kind, id, slot] = k.split('\u0000');
      if (kind === 'w') {
        for (const daughter of cur.get(id)!.kids) if (!need(daughter, id)) return blocker || daughter;
        edit.kidsOf(frame, id).filter(daughter => !cur.get(id)!.kids.includes(daughter)).forEach(daughter => lost.push(daughter));
      } else if (kind === 's') {
        const i = Number(slot), daughter = cur.get(id)!.kids[i];
        if (!need(daughter, id)) return blocker || daughter;
        lost.push(edit.kidsOf(frame, id)[i]);
      } else if (kind === 'd') {
        const q = parents.get(id);
        if (q && !letGo(q, id)) return blocker || q;
        edit.kidsOf(frame, id).forEach(daughter => lost.push(daughter));
      }
    }
    const placed = new Set<string>();
    for (const k of keys) {
      const [kind, id, slot] = k.split('\u0000');
      if (kind === 'w') cur.get(id)!.kids.forEach(daughter => placed.add(daughter));
      if (kind === 's') placed.add(cur.get(id)!.kids[Number(slot)]);
      if (kind === 'k') placed.add(k.split('\u0000')[3]);
    }
    const open = lost.splice(0).filter(k => !placed.has(k) && !dissolving(k));
    if (!open.length) break;
    for (const k of open) if (!settle(k)) return blocker || k;
  }
  return { keys };
}

type Unit = { id: string; word: boolean };

const heldCache = new WeakMap<object, Map<number, Set<string>>>();
/**
 * Unary root projections held back until the movement that fills them, by
 * stage: a root x[k] authored over its one carried daughter in earlier stages
 * that a later stage's movement turns into x[landing, k]. From the stage that
 * first authors x[k] it is not shown (k stays a root), so x appears with its
 * landing at the movement's moment. Not when a relation of those stages, or an
 * earlier one of the movement's stage, names x. Frames still show only
 * authored shapes; Replay simply reads those stages without the shell.
 */
function heldRootProjections(compilation: ReplayCompilation): Map<number, Set<string>> {
  if (heldCache.has(compilation)) return heldCache.get(compilation)!;
  const { frames, replayPlan, resolveFrameRelations } = compilation, held = new Map<number, Set<string>>();
  const relationsOf = (index: number) => getReplayPlanStage(replayPlan, index) ? resolveFrameRelations(index) : [];
  const names = (relation: ReturnType<typeof relationsOf>[number], id: string) => [...getRelationAllAnchorNodeIds(relation),
    ...relationAnchorNodeIds(relation.priorAnchors), getRelationTargetNodeId(relation), ...getRelationSourceNodeIds(relation)].includes(id);
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1].workspaceForest ?? [], current = frames[index].workspaceForest ?? [], relations = relationsOf(index);
    relations.forEach((relation, relationIndex) => {
      const movement = relation.recoveredMovement;
      const ownership = movement?.transition ? null : resolveFallbackTreeTransitionOwnership(relation, previous, current);
      if (!(movement?.transition && movement.trajectoryKind === 'phrasal') && !ownership) return;
      for (const parent of current) {
        const before = previous.find(root => root.id === parent.id);
        if (!parent.id || parent.word || parent.children?.length !== 2 || before?.children?.length !== 1) continue;
        const carried = before.children[0].id, landing = parent.children.find(child => child.id !== carried);
        if (!landing?.id || !parent.children.some(child => child.id === carried)) continue;
        const owns = movement?.transition ? movement.targetNodeId === landing.id
          : Boolean(landing.children?.length && ownership?.currentNodeIds.has(landing.id) && ownership.priorNodeIds.has(landing.id)
            && findExactNodesByIdInForest(previous, landing.id).length === 1 && findExactNodesByIdInForest(current, landing.id).length === 1);
        if (!owns) continue;
        let first = index - 1;
        while (first > 0) {
          const earlier = frames[first - 1].workspaceForest?.find(root => root.id === parent.id);
          if (earlier?.children?.length !== 1 || earlier.children[0].id !== carried) break;
          first -= 1;
        }
        const preceding = [...Array.from({ length: index - first }, (_, i) => relationsOf(first + i)).flat(), ...relations.slice(0, relationIndex)];
        if (preceding.some(candidate => names(candidate, parent.id))) continue;
        for (let stage = first; stage < index; stage += 1) held.set(stage, new Set([...(held.get(stage) ?? []), parent.id]));
      }
    });
  }
  heldCache.set(compilation, held);
  return held;
}

/** A forest read without its held root projections: each held root is replaced by its one daughter. */
const withoutHeld = (forest: readonly SyntaxNode[], held: ReadonlySet<string> | undefined): SyntaxNode[] => !held?.size ? forest as SyntaxNode[]
  : forest.flatMap(root => held.has(root.id) && root.children?.length === 1 ? [root.children[0]] : [root]);

/**
 * Adjunction keeps the adjoined-to node's id on the new upper segment: P has
 * x[a, b], C has x[y[a, b], z] with y new and of x's own content. y is then the
 * occurrence that P showed as x, and C's x is new. Movement material is left
 * to the movement rules.
 */
function adjunctionContinuations(previous: readonly SyntaxNode[], current: readonly SyntaxNode[], moved: ReadonlySet<string>): Map<string, string> {
  const prev = indexForest(previous), cur = indexForest(current), out = new Map<string, string>();
  if (!prev || !cur) return out;
  for (const [x, after] of cur) {
    const before = prev.get(x);
    if (!before || !before.kids.length || moved.has(x) || (before.parent !== null && before.parent !== after.parent) || ownKey(before.node) !== ownKey(after.node)) continue;
    const category = (node: SyntaxNode) => JSON.stringify([String(node.label ?? '').trim(), String(node.word ?? '').trim(), node.silent === true]);
    const segments = after.kids.filter(y => !prev.has(y) && !moved.has(y) && category(cur.get(y)!.node) === category(before.node) && sameList(cur.get(y)!.kids, before.kids));
    if (segments.length === 1 && after.kids.length > 1) out.set(x, segments[0]);
  }
  return out;
}

/**
 * A preceding subtree the stage keeps unchanged under new ids continues as that subtree: same labels, words (up to
 * case and Unicode form) and silence throughout, at least two pronounced words, the only such subtree in each stage, its preceding root gone
 * and none of its nodes kept or moved. Each preceding node continues as the node in its place.
 */
function renamedSubtreeContinuations(previous: readonly SyntaxNode[], current: readonly SyntaxNode[], moved: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>(), interned = new Map<string, number>();
  const shapes = (forest: readonly SyntaxNode[]) => {
    const byShape = new Map<number, SyntaxNode[]>(), ids = new Set<string>();
    const visit = (node: SyntaxNode): { shape: number; words: number } => {
      ids.add(node.id);
      const kids = (node.children ?? []).map(visit);
      const words = kids.length ? kids.reduce((sum, kid) => sum + kid.words, 0) : isPronouncedLeaf(node) ? 1 : 0;
      const text = JSON.stringify([String(node.label ?? '').trim().toUpperCase(), normalizeToken(authoredWord(node)), node.silent === true, kids.map(kid => kid.shape)]);
      if (!interned.has(text)) interned.set(text, interned.size);
      const shape = interned.get(text)!;
      if (words >= 2) byShape.set(shape, [...(byShape.get(shape) ?? []), node]);
      return { shape, words };
    };
    forest.forEach(visit);
    return { byShape, ids };
  };
  const before = shapes(previous), after = shapes(current);
  const pair = (from: SyntaxNode, to: SyntaxNode) => { out.set(from.id, to.id); (from.children ?? []).forEach((child, i) => pair(child, to.children![i])); };
  const subtreeIds = (node: SyntaxNode): string[] => [node.id, ...(node.children ?? []).flatMap(subtreeIds)];
  for (const [shape, [from, ...others]] of before.byShape) {
    const matches = after.byShape.get(shape) ?? [];
    if (others.length || matches.length !== 1) continue;
    const fromIds = subtreeIds(from), toIds = subtreeIds(matches[0]);
    if (fromIds.some(id => after.ids.has(id) || moved.has(id)) || toIds.some(id => before.ids.has(id) || moved.has(id))) continue;
    if (fromIds.some(id => out.has(id))) continue;
    pair(from, matches[0]);
  }
  return out;
}

const continuationCache = new WeakMap<object, Map<number, Map<string, string>>>();
/** The stage's continuations of its preceding stage, `previous id -> current id`: renamed subtrees and nodes, and adjunction segments. */
export function kernelContinuations(compilation: ReplayCompilation, index: number): Map<string, string> {
  if (!continuationCache.has(compilation)) continuationCache.set(compilation, new Map());
  const cache = continuationCache.get(compilation)!;
  if (!cache.has(index)) {
    const renamed = compilation.continuedOccurrenceIds(index);
    const relations = index > 0 && compilation.replayPlan ? compilation.resolveFrameRelations(index) : [];
    // A movement's endpoints and the parent its landing joins belong to the movement rules.
    const landingParent = (id: string) => {
      let parent: string | undefined;
      const visit = (node: SyntaxNode) => node.children?.forEach(child => { if (child.id === id) parent = node.id; visit(child); });
      (compilation.frames[index].workspaceForest ?? []).forEach(visit);
      return parent;
    };
    const moved = new Set(relations.flatMap(relation => (relation.recoveredMovements ?? [relation.recoveredMovement]).flatMap(m => m
      ? [m.priorSourceNodeId, m.sourceNodeId, m.targetNodeId, landingParent(m.targetNodeId) ?? ''] : [])));
    const adjoined = index > 0 ? adjunctionContinuations(compilation.frames[index - 1].workspaceForest ?? [], compilation.frames[index].workspaceForest ?? [], moved) : new Map();
    const retained = index > 0 ? renamedSubtreeContinuations(compilation.frames[index - 1].workspaceForest ?? [], compilation.frames[index].workspaceForest ?? [], moved) : new Map();
    cache.set(index, new Map([...retained, ...adjoined, ...renamed]));
  }
  return cache.get(index)!;
}

/** Builds one stage's steps, or null when its forests are not comparable by id. */
export function buildKernelStageSteps(compilation: ReplayCompilation, stage: ReplayStageContext): PlaybackStep[] {
  const { frames, identity, plannedStageCount, sentenceInitialSurface } = compilation;
  const { index, plannedStage, frameRelationSteps, fallbackTransitionOwnership, workspaceRoots, previousFrameWorkspaceRoots,
    frameHasNonMovementTreeTransition, nonMovementTreeTransitionRelationIndexes, nonMovementTransitionNodeIds,
    authoredPreviousRelationRelationLinks, frameSemanticStep, frameStageRecordBlocks, frame, structuralWorkspaceRoots,
    buildFrameLayoutScaffold, frameReplaySnapshot, futureLayoutScaffold, structuralLayoutScaffold } = stage;
  const continued = kernelContinuations(compilation, index);
  const held = heldRootProjections(compilation);
  type Snap = { canvasData: SyntaxNode; visibleNodeIds: string[]; relationLinks: PlaybackStep['replayRelationLinks']; usesScaffold?: boolean };
  const completedSnap: Snap = { canvasData: frameReplaySnapshot.canvasData, visibleNodeIds: frameReplaySnapshot.visibleNodeIds,
    relationLinks: frameReplaySnapshot.relationLinks, usesScaffold: Boolean(futureLayoutScaffold) };
  const stageRecord = (snap: Snap, stepCount: number): PlaybackStep => ({
    ...frameSemanticStep, operation: 'StageRecord' as DerivationOperation, replayKind: 'macro',
    detailBlocks: mergeReplayDetailBlocks(frameStageRecordBlocks), note: undefined,
    recipe: String(plannedStage?.statement || '').trim() || frameSemanticStep.recipe || `Stage ${plannedStage?.stageNumber ?? index + 1}`,
    replayCanvasData: snap.canvasData, replayVisibleNodeIds: snap.visibleNodeIds.filter(id => !held.get(index)?.has(id)), replayRelationLinks: snap.relationLinks,
    replayUsesFutureLayoutScaffold: snap.usesScaffold,
    replayProgressLabel: buildReplayProgressLabel(plannedStage, plannedStageCount, stepCount, stepCount)
  });
  const prev = indexForest(withoutHeld(previousFrameWorkspaceRoots, held.get(index - 1)), continued);
  const cur = indexForest(withoutHeld(workspaceRoots, held.get(index)));
  // An id used at two places leaves no stage edit to derive: the stage shows only as completed.
  if (!prev || !cur) return [stageRecord(completedSnap, 1)];
  const edit = new StageEdit(prev, cur);
  const placements = planStageRelations(compilation, stage);
  const { relationPlacements, singleRelationLinksByIndex, getMovementCreatedLandingHostNodeIds, getMovementCreatedLandingHostPaths,
    getMovementPiedPipedNodeIds, transitionHostNodeIds } = placements;
  const subtree = (forest: Stage, id: string): string[] => forest.has(id) ? [id, ...forest.get(id)!.kids.flatMap(k => subtree(forest, k))] : [];
  const prevId = (id: string) => continued.get(id) ?? id;
  const changedKeys = (id: string): string[] => {
    const diff = edit.diffs.get(id);
    return !diff ? [] : edit.reshaped(id) ? [key('w', id)] : [...(diff.content ? [key('c', id)] : []), ...diff.slots!.map(i => key('s', id, i))];
  };
  /** The change that puts `id` under its C parent: always for a movement landing, otherwise only under preceding syntax. */
  const place = (id: string, landing = false): string[] => {
    const p = cur.get(id)?.parent;
    if (!p || !edit.diffs.has(p) || (!landing && !prev.has(p))) return [];
    const slot = cur.get(p)!.kids.indexOf(id);
    // A new node taking over a preceding daughter of a kept parent stands in that daughter's slot;
    // the parent's own merge adds its other new daughters.
    if (edit.reshaped(p) && prev.has(p) && !prev.has(id) && prev.get(p)!.kids.filter(k => edit.within(id, k)).length === 1
      && cur.get(p)!.kids.some(k => k !== id && !prev.has(k))) return [];
    return edit.reshaped(p) ? [key('w', p)] : edit.replaces(p, slot) ? [key('s', p, slot)] : [];
  };
  const structuralIndex = indexForest(structuralWorkspaceRoots);
  const frame0: Frame = new Map([...prev.keys()].map(id => [id, { content: 'P' as const, kids: 'P' as const, slots: new Map<number, string>() }]));
  const placementOf = new Map(relationPlacements.map(placement => [placement.relationIndex, placement]));
  // Relation edits on the stage's first frame. A proved movement owns its landing, its lower
  // occurrence, the new parents attaching the landing to existing syntax, the phrase it
  // pied-pipes and a receiving head's new inner head; a neutral claim owns a rewrite only
  // when it displaces preceding material, with the new parents it attaches.
  // Whether a claim displaces material the stage had: it names an earlier occurrence the stage
  // removes, changes or re-parents, or a new occurrence whose lineage's earlier one is displaced.
  // Only such a claim may introduce new syntax at its own moment; otherwise construction builds it.
  const authoredPrev = indexForest(previousFrameWorkspaceRoots), authoredCur = indexForest(workspaceRoots);
  const subtreeKey = (forest: Stage, id: string): string => {
    const info = forest.get(id);
    return info ? `${ownKey(info.node)}(${info.kids.map(k => subtreeKey(forest, k)).join(',')})` : '';
  };
  const claimDisplaces = (relation: (typeof frameRelationSteps)[number]): boolean => {
    if (!authoredPrev || !authoredCur) return true;
    const named = [...relationAnchorNodeIds(relation.anchors as Record<string, string | string[]>), ...relationAnchorNodeIds(relation.priorAnchors)];
    const displaced = (id: string) => {
      const was = authoredPrev.get(id), now = authoredCur.get(id);
      return !now || subtreeKey(authoredPrev, id) !== subtreeKey(authoredCur, id) || Boolean(was!.parent) && was!.parent !== now.parent;
    };
    if (named.some(id => authoredPrev.has(id) && displaced(id))) return true;
    const lineages = new Set(named.filter(id => !authoredPrev.has(id)).map(id => authoredCur.get(id)?.node.lineageId).filter(Boolean));
    return [...authoredPrev].some(([id, info]) => lineages.has(info.node.lineageId) && displaced(id));
  };
  // A head-adjunction complex: the landing's parent holds, beside it, host heads only (no phrase).
  const hostedComplex = (landing: string): boolean => {
    const complex = cur.get(landing)?.parent, kids = complex ? cur.get(complex)!.kids.filter(id => id !== landing) : [];
    return kids.length > 0 && kids.every(id => cur.get(id)!.kids.every(k => !cur.get(k)!.kids.length));
  };
  // Each movement's own landing parent, when new in the stage.
  const landingParentOf = new Map<string, number>();
  frameRelationSteps.forEach((relation, relationIndex) => (relation.recoveredMovements ?? [relation.recoveredMovement]).forEach(m => {
    const parent = m?.transition ? cur.get(m.targetNodeId)?.parent : undefined;
    if (parent && !prev.has(parent) && !landingParentOf.has(parent)) landingParentOf.set(parent, relationIndex);
  }));
  const relationSeeds = frameRelationSteps.flatMap((relation, relationIndex) => {
    const seeds = new Set<string>(), placement = placementOf.get(relationIndex);
    const whole = (id: string) => { changedKeys(id).forEach(k => seeds.add(k)); place(id).forEach(k => seeds.add(k)); };
    const movements = (relation.recoveredMovements ?? [relation.recoveredMovement]).filter(m => m?.transition);
    for (const m of movements) {
      [m!.targetNodeId, m!.sourceNodeId].forEach(id => { subtree(cur, id).flatMap(changedKeys).forEach(k => seeds.add(k)); place(id, id === m!.targetNodeId).forEach(k => seeds.add(k)); });
      subtree(prev, prevId(m!.priorSourceNodeId)).filter(id => !cur.has(id)).forEach(id => seeds.add(key('d', id)));
      newReceivingHeadNodeIds(m, previousFrameWorkspaceRoots, workspaceRoots).forEach(whole);
    }
    // A landing path stops being this movement's at another movement's own landing parent: that
    // movement builds it, and this moment carries its slot meanwhile.
    // A head moves into a host head that is already merged: beyond its own complex, the parents
    // above a head landing are ordinary construction, which builds them first around the host head.
    // (A complex with a host head of its own, beside the moved head; a complex that is only the moved
    // head's new shell arrives with its parents as before.)
    const hosted = (m: (typeof movements)[number]) => hostedComplex(m!.targetNodeId);
    const complexes = new Set(movements.filter(m => m!.trajectoryKind === 'head').map(m => cur.get(m!.targetNodeId)?.parent));
    const headOnly = movements.every(m => m!.trajectoryKind === 'head' && hosted(m));
    if (placement && movements.length) [...getMovementCreatedLandingHostNodeIds(placement).filter(id => (landingParentOf.get(id) ?? relationIndex) === relationIndex
      && (!headOnly || complexes.has(id))), ...getMovementPiedPipedNodeIds(placement)].forEach(whole);
    // A trajectory claim without a proved movement still introduces, at its moment, the new material at its
    // endpoints that the stage's construction forest lacks, with its landing's new parents (as today).
    if (!movements.length && placement && (placement.renderableTrajectory || placement.ownsPhrasalTreeTransition)) {
      const constructionIds = new Set(structuralIndex ? structuralIndex.keys() : []);
      [...placement.authoredTargetNodeIds, ...placement.sourceNodeIds].flatMap(id => subtree(cur, id)).filter(id => !constructionIds.has(id) && !prev.has(id))
        .forEach(id => { changedKeys(id).forEach(k => seeds.add(k)); place(id, true).forEach(k => seeds.add(k)); });
      [...getMovementCreatedLandingHostNodeIds(placement), ...getMovementPiedPipedNodeIds(placement)].forEach(whole);
    }
    // An unproven landing (its source not in the preceding stage) still appears at its own moment.
    if (!movements.length && relation.unprovenNewLandingNodeId && cur.has(relation.unprovenNewLandingNodeId) && claimDisplaces(relation)) {
      subtree(cur, relation.unprovenNewLandingNodeId).flatMap(changedKeys).forEach(k => seeds.add(k));
      place(relation.unprovenNewLandingNodeId, true).forEach(k => seeds.add(k));
    }
    const ownership = movements.length ? undefined : fallbackTransitionOwnership.get(relationIndex);
    const displaces = (id: string) => prev.has(prevId(id)) && (!cur.has(prevId(id)) || edit.diffs.has(prevId(id)) || cur.get(prevId(id))!.parent !== prev.get(prevId(id))!.parent);
    const transitionOwned = frameHasNonMovementTreeTransition && nonMovementTreeTransitionRelationIndexes.has(relationIndex);
    if (!ownership && transitionOwned && !movements.length)
      [...(nonMovementTransitionNodeIds.get(relationIndex) ?? [])].filter(id => cur.has(id) && !prev.has(id)).forEach(whole);
    if (ownership && ([...ownership.priorNodeIds].some(displaces) || transitionOwned)) {
      [...ownership.currentNodeIds, ...(ownership.hostNodeIds ?? [])].forEach(whole);
      ownership.priorNodeIds.forEach(id => subtree(prev, prevId(id)).filter(d => !cur.has(d)).forEach(d => seeds.add(key('d', d))));
    }
    if (!movements.length && !ownership && relation.anchoredCopyDisplacement) {
      relation.anchoredCopyDisplacement.copies.forEach(copy => subtree(cur, copy.nodeId).forEach(whole));
      relation.anchoredCopyDisplacement.earlierNodeIds.forEach(id => cur.has(prevId(id)) ? changedKeys(prevId(id)).forEach(k => seeds.add(k)) : seeds.add(key('d', prevId(id))));
    }
    return seeds.size ? [{ relation: relationIndex, movement: movements.length > 0, seeds }] : [];
  }).sort((a, b) => Number(b.movement) - Number(a.movement) || a.relation - b.relation);
  // Proved movements claim first, then the other claims: each takes the changes it names that
  // no earlier claimant took, and its closed edit takes the smallest new parents (or a receiving
  // head's inner head) it needs. Later claims about the same material only observe it.
  const owners: Owners = new Map();
  for (const movement of [true, false]) {
    const claimants = relationSeeds.filter(entry => entry.movement === movement);
    claimants.forEach(({ relation, seeds }) => seeds.forEach(k => { if (!owners.has(k)) owners.set(k, relation); }));
    for (const { relation } of claimants) {
      const own = new Set([...owners].filter(([, owner]) => owner === relation).map(([k]) => k));
      const closed = close(edit, frame0, owners, own, { relation, planning: { seeds: own, foreign: k => owners.has(k) && owners.get(k) !== relation } });
      // A carried slot is a step's transient means, not a change any relation owns.
      if (typeof closed !== 'string') closed.keys.forEach(k => { if (!owners.has(k) && !k.startsWith('k\u0000')) owners.set(k, relation); });
    }
  }
  // As today, the other daughters of the parents a landing creates are its prerequisites: ordinary
  // construction builds them before the moment, and a carrier holds the host's slot meanwhile.
  for (const placement of relationPlacements) {
    const hosts = new Set(getMovementCreatedLandingHostNodeIds(placement));
    const moved = new Set([...placement.authoredTargetNodeIds, ...getMovementPiedPipedNodeIds(placement), ...hosts]);
    const endpoints = new Set([...placement.authoredTargetNodeIds, ...placement.sourceNodeIds, ...(placement.relation.recoveredMovements ?? [placement.relation.recoveredMovement])
      .flatMap(m => m ? [m.sourceNodeId, m.targetNodeId] : [])].flatMap(id => subtree(cur, id)));
    const material = new Set([...hosts].flatMap(id => cur.get(id)?.kids ?? []).filter(id => !moved.has(id))
      .flatMap(id => subtree(cur, id)).filter(id => !endpoints.has(id)));
    owners.forEach((owner, k) => {
      const [kind, id] = k.split('\u0000');
      if (owner === placement.relationIndex && kind === 'w' && material.has(id) && !prev.has(id)) owners.delete(k);
    });
  }
  // A content change nothing else owns belongs to the relation voicing the
  // node (pronouncing it or an ancestor, else naming it), or else to the
  // stage's first step.
  const voicing = (id: string): number | undefined => {
    const lineage: string[] = [];
    for (let at: string | null | undefined = id; at; at = cur.get(at)?.parent) lineage.push(at);
    const pronouncer = frameRelationSteps.findIndex(relation => relation.pronunciationNodeIds?.some(nodeId => lineage.includes(nodeId)));
    if (pronouncer >= 0) return pronouncer;
    const namer = frameRelationSteps.findIndex(relation => [...relationAnchorNodeIds(relation.anchors as Record<string, string | string[]>),
      ...relationAnchorNodeIds(relation.priorAnchors)].includes(id));
    return namer >= 0 ? namer : undefined;
  };
  let frameState: Frame = new Map(frame0);
  for (const [id, diff] of edit.diffs) {
    if (diff.isNew || !diff.content || edit.reshaped(id) || owners.has(key('c', id))) continue;
    const owner = voicing(id);
    if (owner !== undefined) owners.set(key('c', id), owner);
    else frameState = edit.apply(frameState, new Set([key('c', id)])) ?? frameState;
  }
  const authoredIndex = (placement: RelationPlacement) => Number.isInteger(placement.relation.authoredRelationIndex)
    ? placement.relation.authoredRelationIndex! : placement.relationIndex;

  // Construction: every unowned whole switch, bottom-up with just-in-time sister ranks (below),
  // ties by daughter index. Selection order is free; only Merge is constrained.
  // A node that only loses daughters builds nothing; the Stage Record removes them.
  const onlyLoses = (id: string) => prev.has(id) && cur.get(id)!.kids.length < prev.get(id)!.kids.length
    && cur.get(id)!.kids.every(k => prev.get(id)!.kids.includes(k));
  const constructs = (id: string) => edit.reshaped(id) && !owners.has(key('w', id)) && !onlyLoses(id);
  let units: Unit[] = [];
  const structuralCanvas = cloneSyntaxTree(buildRenderableDerivationCanvasData(structuralWorkspaceRoots, identity));
  if (structuralCanvas) {
    const hierarchy = d3.hierarchy<SyntaxNode>(structuralCanvas);
    applyVizIds(hierarchy);
    const all = new Set<string>(hierarchy.descendants().map(node => getNodeId(node)));
    // Just in time: the daughter with more construction still to do is built first, so the other
    // is built right before the merge that uses it. Structure alone decides; labels never do.
    const authoredOf = (node: d3.HierarchyNode<SyntaxNode>) => { const origin = node.data.replayOrigin;
      return origin?.kind === 'word' ? String(origin.ownerId) : origin?.kind === 'lexical' ? String(origin.authoredId) : String(node.data.id); };
    const work = new Map<d3.HierarchyNode<SyntaxNode>, number>();
    hierarchy.eachAfter(node => work.set(node, (node.children ?? []).reduce((sum, child) => sum + work.get(child)!, 0)
      + (cur.has(authoredOf(node)) && (constructs(authoredOf(node)) || !prev.has(authoredOf(node))) ? 1 : 0)));
    // Pieces already waiting on screen (preceding roots this stage attaches) wait until every subtree
    // around them is done, so a subtree holding several of them goes first (shortest per piece first);
    // otherwise the longer construction goes first. This orders sisters to minimise waiting (Smith's rule).
    const waiting = new Map<d3.HierarchyNode<SyntaxNode>, number>();
    hierarchy.eachAfter(node => waiting.set(node, (node.children ?? []).reduce((sum, child) => sum + waiting.get(child)!, 0)
      + (prev.get(authoredOf(node))?.parent === null && cur.get(authoredOf(node))?.parent ? 1 : 0)));
    const rank = (parent: d3.HierarchyNode<SyntaxNode>, child: d3.HierarchyNode<SyntaxNode>, childIndex: number) => {
      if (parent.data.replayOrigin?.kind === 'workspace') return childIndex;
      const p = work.get(child)!, w = waiting.get(child)!;
      return (w >= 2 ? p / (w - 1) : w === 1 ? 1e6 + p : 2e6 - p) + childIndex / 1000;
    };
    for (const node of buildBottomUpSequence(hierarchy, all, rank)) {
      const origin = node.data.replayOrigin, word = origin?.kind === 'word';
      const id = word ? String(origin!.ownerId) : origin?.kind === 'lexical' ? String(origin.authoredId) : String(node.data.id);
      if (!cur.has(id) || !constructs(id)) continue;
      if (units.some(unit => unit.id === id && unit.word === word)) continue;
      if (word) { if (!prev.has(id) && !cur.get(id)!.kids.length) units.push({ id, word: true }); }
      else units.push({ id, word: false });
    }
  }
  // Construction that forest lacks (what its movements withhold) follows in C's own bottom-up order.
  const after = (id: string) => {
    cur.get(id)!.kids.forEach(after);
    if (!constructs(id) || units.some(unit => unit.id === id && !unit.word)) return;
    if (!prev.has(id) && !cur.get(id)!.kids.length && shouldExpandPreterminalLeaf(cur.get(id)!.node) && !units.some(unit => unit.id === id))
      units.push({ id, word: true });
    units.push({ id, word: false });
  };
  [...cur].filter(([, info]) => !info.parent).forEach(([id]) => after(id));
  // As today, when the stage's movements create one new landing host, the construction that
  // movement needs (the host's other daughters, its sources and its other anchors) comes first.
  const landingHosts = [...new Set(relationPlacements.flatMap(placement => getMovementCreatedLandingHostPaths(placement).map(path => path.at(-1)!)))];
  const prerequisite = new Set<string>();
  if (landingHosts.length === 1) {
    const host = landingHosts[0];
    const hostPlacements = relationPlacements.filter(placement => getMovementCreatedLandingHostPaths(placement).some(path => path.at(-1) === host));
    const hostIds = new Set(hostPlacements.flatMap(getMovementCreatedLandingHostNodeIds));
    const targets = new Set(hostPlacements.flatMap(placement => [...placement.authoredTargetNodeIds, ...getMovementPiedPipedNodeIds(placement)]));
    const addSubtree = (id: string) => subtree(cur, id).forEach(at => prerequisite.add(at));
    [...hostIds].flatMap(id => cur.get(id)?.kids ?? []).filter(id => !targets.has(id) && !hostIds.has(id)).forEach(addSubtree);
    hostPlacements.forEach(placement => {
      placement.sourceNodeIds.forEach(addSubtree);
      getRelationAllAnchorNodeIds(placement.relation).filter(id => cur.has(id) && !targets.has(id) && !placement.sourceNodeIds.includes(id)
        && !subtree(cur, id).some(at => hostIds.has(at))).forEach(addSubtree);
    });
    units = [...units.filter(unit => prerequisite.has(unit.id)), ...units.filter(unit => !prerequisite.has(unit.id))];
  }

  // Moment order: authored, except that a relation needing syntax a later relation introduces
  // plays after it (`orderRelationMoments`). A relation needs its anchors (a movement, its
  // source and landing), the other daughters of the parents its landing creates, and a
  // landing parent that construction builds.
  const available0 = new Set(prev.keys());
  const producer = (id: string): number | undefined => {
    if (available0.has(id)) return undefined;
    const owner = owners.get(key('w', id));
    return owner === undefined ? undefined : owner;
  };
  /** The relation whose moment gives a preceding node a daughter it lacked, when one does. */
  const reshaper = (id: string): number | undefined => available0.has(id) && edit.reshaped(id)
    && cur.get(id)!.kids.some(k => !prev.get(id)!.kids.includes(k)) ? owners.get(key('w', id)) : undefined;
  const unitOf = (id: string) => units.find(unit => unit.id === id && !unit.word);
  // Construction waits for the daughters a node has before the stage's movements (today's
  // construction forest); a daughter a later moment completes is carried meanwhile.
  const structural = structuralIndex;
  const constructionKids = (id: string): string[] => (structural?.get(id) ?? cur.get(id))?.kids ?? [];
  const required = (placement: RelationPlacement): string[] => {
    const hostIds = new Set(getMovementCreatedLandingHostNodeIds(placement));
    const prerequisites = [...hostIds].flatMap(id => cur.get(id)?.kids ?? []).filter(id => !placement.authoredTargetNodeIds.includes(id) && !hostIds.has(id));
    [...transitionHostNodeIds].filter(([, owner]) => owner === placement.relationIndex).flatMap(([hostId]) => cur.get(hostId)?.kids ?? [])
      .forEach(id => prerequisites.push(id));
    if (placement.renderableTrajectory || placement.ownsPhrasalTreeTransition)
      placement.authoredTargetNodeIds.map(id => cur.get(id)?.parent).filter((id): id is string => Boolean(id && unitOf(id) && !hostIds.has(id)))
        .forEach(id => prerequisites.push(id));
    // A head moves into a host head already merged with its complement: the host complex's parent,
    // when construction builds it, comes first.
    // A host head the preceding stage had already merged needs no new merge.
    const mergedBefore = (landing: string) => (cur.get(cur.get(landing)?.parent ?? '')?.kids ?? []).filter(id => id !== landing)
      .every(host => Boolean(prev.get(prevId(host))?.parent));
    (placement.relation.recoveredMovements ?? [placement.relation.recoveredMovement]).filter(m => m?.transition && m.trajectoryKind === 'head'
      && hostedComplex(m.targetNodeId) && !mergedBefore(m.targetNodeId))
      .map(m => {
        // The host's merge may sit above another movement's landing parent (a clitic's T complex).
        let at = cur.get(cur.get(m!.targetNodeId)?.parent ?? '')?.parent;
        while (at && !unitOf(at) && producer(at) !== undefined && producer(at) !== placement.relationIndex) at = cur.get(at)?.parent;
        return at;
      }).filter((id): id is string => Boolean(id && unitOf(id)))
      .forEach(id => prerequisites.push(id));
    return [...placement.relationAnchorNodeIds, ...prerequisites].filter(id => producer(id) !== placement.relationIndex);
  };
  const producingRelations = (id: string, visiting = new Set<string>()): number[] => {
    const owner = producer(id) ?? (visiting.size ? undefined : reshaper(id));
    if (owner !== undefined) return [owner];
    if (!unitOf(id) || visiting.has(id)) return [];
    visiting.add(id);
    const out = constructionKids(id).flatMap(k => producingRelations(k, visiting));
    visiting.delete(id);
    return out;
  };
  const landingParentOwners = (placement: RelationPlacement): number[] => placement.renderableTrajectory || placement.ownsPhrasalTreeTransition
    ? placement.authoredTargetNodeIds.map(id => cur.get(id)?.parent).filter((id): id is string => Boolean(id) && !available0.has(id!))
      .flatMap(id => producer(id) ?? []) : [];
  const momentPlacements = relationPlacements;
  // A movement's other current anchors are context: its moment neither waits for them nor builds
  // them early.
  const contextOf = (placement: RelationPlacement) => placement.renderableTrajectory || placement.ownsPhrasalTreeTransition
    ? [...new Set(relationAnchorNodeIds(placement.relation.anchors))].filter(id => !placement.relationAnchorNodeIds.includes(id) && cur.has(id)) : [];
  // A head moves into its host before any phrasal landing above that host: a phrasal movement whose
  // landing joins a parent dominating another movement's head complex waits for that head movement.
  const headComplexOf = new Map<number, string[]>(momentPlacements.map(placement => [placement.relationIndex,
    (placement.relation.recoveredMovements ?? [placement.relation.recoveredMovement]).filter(m => m?.transition && m.trajectoryKind === 'head')
      .map(m => cur.get(m!.targetNodeId)?.parent ?? '').filter(Boolean)]));
  const headsBelowLanding = (placement: RelationPlacement): number[] => {
    const phrasal = (placement.relation.recoveredMovements ?? [placement.relation.recoveredMovement]).filter(m => m?.transition && m.trajectoryKind === 'phrasal');
    const above = new Set(phrasal.flatMap(m => subtree(cur, cur.get(m!.targetNodeId)?.parent ?? '')));
    // Unless the head movement itself names this movement's landing, which it then needs on screen.
    const landings = new Set(phrasal.flatMap(m => subtree(cur, m!.targetNodeId)));
    return [...headComplexOf].filter(([other, complexes]) => other !== placement.relationIndex && complexes.some(id => above.has(id))
      && !relationAnchorNodeIds(placementOf.get(other)!.relation.anchors as Record<string, string | string[]>).some(id => landings.has(id))).map(([other]) => other);
  };
  const momentOrder = orderRelationMoments(momentPlacements.map(placement => placement.relationIndex), new Map(momentPlacements.map(placement =>
    [placement.relationIndex, new Set([...required(placement).flatMap(id => producingRelations(id)), ...landingParentOwners(placement),
      ...headsBelowLanding(placement)])])));
  const momentPosition = new Map(momentOrder.map((relationIndex, position) => [relationIndex, position]));
  const playsAfter = (relationIndex: number, ownerIndex: number) => momentPosition.has(relationIndex) && momentPosition.has(ownerIndex)
    ? momentPosition.get(relationIndex)! > momentPosition.get(ownerIndex)! : relationIndex > ownerIndex;
  // Where each moment is offered: a relation without a created landing host after construction;
  // with the stage's single landing host, once its prerequisites are built; otherwise before
  // the first construction that encloses its landing host.
  const insertion = (placement: RelationPlacement): number => {
    const hosts = getMovementCreatedLandingHostPaths(placement).map(path => path.at(-1)!);
    if (!hosts.length) return units.length;
    if (landingHosts.length === 1) {
      const first = units.findIndex(unit => !prerequisite.has(unit.id));
      return first >= 0 ? first : units.length;
    }
    const first = units.findIndex(unit => hosts.some(host => subtree(cur, unit.id).includes(host)));
    return first >= 0 ? first : units.length;
  };
  const offered = momentPlacements.map(placement => ({ placement, at: insertion(placement) }))
    .sort((a, b) => a.at - b.at || momentPosition.get(a.placement.relationIndex)! - momentPosition.get(b.placement.relationIndex)!);

  const played: number[] = [];
  const steps: PlaybackStep[] = [];
  const diagnostics = new Map<number, string[]>();
  const diagnose = (relationIndex: number, message: string) => diagnostics.set(relationIndex, [...(diagnostics.get(relationIndex) ?? []), message]);
  const ownedBy = (relationIndex: number) => [...owners].filter(([k, owner]) => owner === relationIndex && !satisfied(k)).map(([k]) => k);
  const satisfied = (k: string): boolean => {
    const [kind, id, slot] = k.split('\u0000'), shown = frameState.get(id);
    if (kind === 'd') return !shown;
    if (!shown || shown.word) return false;
    if (kind === 'w') return edit.built(frameState, id);
    if (kind === 'c') return shown.content === 'C';
    const occupant = edit.kidsOf(frameState, id)[Number(slot)];
    return occupant === cur.get(id)!.kids[Number(slot)] || (kind === 'k' && occupant === k.split('\u0000')[3]);
  };
  const isBuilt = (id: string) => cur.has(id) ? edit.built(frameState, id) || (!edit.reshaped(id) && frameState.has(id) && !frameState.get(id)!.word) : false;
  const linksFor = (): ResolvedRelationLink[] => {
    const links = [...authoredPreviousRelationRelationLinks], seen = new Set(links.map(resolvedRelationLinkKey));
    [...played].sort((a, b) => a - b).forEach(relationIndex => (singleRelationLinksByIndex.get(relationIndex) ?? []).forEach(link => {
      const linkKey = resolvedRelationLinkKey(link);
      if (!seen.has(linkKey)) { seen.add(linkKey); links.push(link); }
    }));
    return links;
  };
  const forestOf = (state: Frame, kidsOf: (id: string) => string[] = id => edit.kidsOf(state, id)): SyntaxNode[] => {
    const claimed = new Set([...state.keys()].flatMap(kidsOf));
    const rank = (id: string): number => Math.min(...[id, ...kidsOf(id)].map(at => cur.get(at)?.order ?? 1e6 + (prev.get(at)?.order ?? 0)));
    const build = (id: string): SyntaxNode => {
      const shown = state.get(id)!, info = shown.content === 'P' ? prev.get(id)! : cur.get(id)!;
      const { children: _children, ...own } = info.node;
      const node: SyntaxNode = { ...own, id } as SyntaxNode;
      const kids = kidsOf(id);
      if (kids.length) node.children = kids.map(build);
      return node;
    };
    return [...state.keys()].filter(id => !claimed.has(id)).sort((a, b) => rank(a) - rank(b)).map(build);
  };
  // The layout topology of a frame, as today's canvases carry it: the completed stage with the
  // unplayed moments' landings withheld and their sources and rewritten material in their
  // preceding form. Its not yet shown part is hidden layout context; the frame's own shapes
  // override it (`snapshot`).
  const keptIdLandings = new Map([...fallbackTransitionOwnership].map(([relationIndex, ownership]) =>
    [relationIndex, keptIdLandingNodeIds(ownership, previousFrameWorkspaceRoots, workspaceRoots)]));
  const keptIdMovementLandings = new Map(frameRelationSteps.map((relation, relationIndex) => [relationIndex,
    (relation.recoveredMovements ?? [relation.recoveredMovement]).filter(movement => movement?.transition
      && movement.priorSourceNodeId === movement.targetNodeId).map(movement => movement!.targetNodeId)]));
  const topologies = new Map<string, SyntaxNode[]>();
  // Ordinary construction as today counts it: each construction target and its retained daughters.
  const ordinary = new Set(units.filter(unit => !unit.word).flatMap(unit => [unit.id, ...cur.get(unit.id)!.kids.filter(k => prev.has(k))]));
  const topologyOf = (state: Frame): SyntaxNode[] => {
    const active = new Set(played);
    const constructed = [...state.keys()].filter(id => ordinary.has(id));
    const phase = JSON.stringify([[...active].sort((a, b) => a - b), frameHasNonMovementTreeTransition ? constructed.sort() : []]);
    const cached = topologies.get(phase);
    if (cached) return cached;
    const activeFallback = frameRelationSteps.filter((_relation, relationIndex) => active.has(relationIndex) && fallbackTransitionOwnership.has(relationIndex));
    const activeMovements = frameRelationSteps.filter((relation, relationIndex) => active.has(relationIndex) && relation.recoveredMovement?.transition);
    const registeredActive = [...active].some(relationIndex => nonMovementTreeTransitionRelationIndexes.has(relationIndex) && !fallbackTransitionOwnership.has(relationIndex));
    const activeTargets = new Set(relationPlacements.filter(placement => active.has(placement.relationIndex))
      .filter(placement => placement.renderableTrajectory || placement.ownsPhrasalTreeTransition).flatMap(placement => placement.authoredTargetNodeIds).filter(Boolean));
    const pendingMovementNodeIds = new Set(frameRelationSteps.flatMap((relation, relationIndex) => active.has(relationIndex) || !relation.recoveredMovement?.transition ? []
      : (relation.recoveredMovements ?? [relation.recoveredMovement]).flatMap(movement => [
        ...collectSyntaxSubtreeNodeIds(findExactNodeByIdInForest(previousFrameWorkspaceRoots, movement!.priorSourceNodeId)),
        ...[movement!.sourceNodeId, movement!.targetNodeId].flatMap(id => collectSyntaxSubtreeNodeIds(findExactNodeByIdInForest(workspaceRoots, id)))])));
    const transitionForest = !frameHasNonMovementTreeTransition || registeredActive ? workspaceRoots : buildAnchoredTreeTransitionForest({
      previousForest: previousFrameWorkspaceRoots, currentForest: workspaceRoots, activeRelations: [...activeFallback, ...activeMovements],
      constructedNodeIds: new Set(constructed), withheldNodeIds: pendingMovementNodeIds,
      pendingKeptIdLandingNodeIds: new Set([...keptIdLandings, ...keptIdMovementLandings].flatMap(([relationIndex, ids]) => active.has(relationIndex) ? [] : ids)),
      attachedNodeIds: new Set([...fallbackTransitionOwnership].flatMap(([relationIndex, ownership]) => active.has(relationIndex) ? (ownership.attachments ?? []).map(a => a.host) : []))
    });
    const forest = buildPreMovementStructuralForest(transitionForest, frameRelationSteps.flatMap((relation, relationIndex) => active.has(relationIndex) ? []
      : movementLandingGroups(relation).flatMap(group => {
        const targetId = group.recoveredMovement?.targetNodeId || placementOf.get(relationIndex)?.authoredTargetNodeIds[0];
        if (!activeTargets.has(targetId || '')) return [group];
        return group.recoveredMovement?.transition ? [{ ...group, preserveMovementLanding: true }] : [];
      })), previousFrameWorkspaceRoots, workspaceRoots);
    relationPlacements.filter(placement => !active.has(placement.relationIndex)).forEach(placement => {
      placement.authoredTargetNodeIds.filter(targetId => !activeTargets.has(targetId)).forEach(targetId => {
        const kind = (placement.relation.recoveredMovements?.find(movement => movement.targetNodeId === targetId) ?? placement.relation.recoveredMovement)?.trajectoryKind
          || registeredTrajectoryDisplayKind(placement.relationLabel, placement.relation.resolvedAnchors);
        if (kind !== 'phrasal') return;
        const wrapper = movementLandingWrapper(workspaceRoots, previousFrameWorkspaceRoots, targetId);
        if (!wrapper) return;
        const parent = findNodeByIdInForest(forest, wrapper.parentId), wrapped = parent?.children?.find(child => child.id === wrapper.wrapperId);
        if (parent && wrapped) parent.children = wrapped.children || [];
      });
    });
    topologies.set(phase, forest);
    return forest;
  };
  const attachmentParents = constructionAttachmentUpdates(renameContinuedOccurrences(previousFrameWorkspaceRoots, continued), structuralWorkspaceRoots);
  const attachmentContinuity = attachmentParents.size > 0 || hasConstructionWrapperInsertions(renameContinuedOccurrences(previousFrameWorkspaceRoots, continued), structuralWorkspaceRoots);
  // As today, steps of a stage whose construction holds attachments say so; a moment keeps the preceding step's account.
  const pendingAttachments = (state: Frame, moment = false): string[] | undefined => moment
    ? steps.length ? steps.at(-1)!.replayPendingAttachmentNodeIds : attachmentContinuity && [...edit.diffs.keys()].some(id => edit.reshaped(id)) ? [...attachmentParents].filter(id => !edit.built(state, id)) : undefined
    : attachmentContinuity ? [...attachmentParents].filter(id => !edit.built(state, id)) : undefined;
  /** The step's canvas: its frame inside its layout topology, every shown node with its shown daughters. */
  // A separately established pronunciation waits for its own moment: until the relation that
  // pronounces a head movement's landing (or a receiving head) plays, it shows its preceding
  // word, and a copied phrase shows its earlier occurrence's pronunciation.
  const pronunciationPatches = (): Map<string, Record<string, unknown>> => {
    const active = new Set(played), patches = new Map<string, Record<string, unknown>>();
    const pending = (owner: number, matches: (relation: (typeof frameRelationSteps)[number]) => boolean) => {
      const realization = frameRelationSteps.findIndex((relation, relationIndex) => playsAfter(relationIndex, owner) && matches(relation));
      return realization >= 0 && !active.has(realization);
    };
    // A word a later relation pronounces (the node or an ancestor) waits for it.
    const pronouncedLater = (owner: number, id: string) => {
      const named = new Set([id]);
      for (let parent = cur.get(id)?.parent; parent; parent = cur.get(parent)?.parent) named.add(parent);
      return pending(owner, candidate => Boolean(candidate.pronunciationNodeIds?.some(named.has, named)));
    };
    // A phrasal landing arrives with its current labels and its preceding words until those relations.
    frameRelationSteps.forEach((relation, movementIndex) => (relation.recoveredMovements ?? [relation.recoveredMovement]).forEach(movement => {
      if (!movement?.transition || movement.trajectoryKind !== 'phrasal' || !active.has(movementIndex)) return;
      const walk = (node: SyntaxNode, prior: SyntaxNode | undefined): void => {
        if (!prior) return;
        if (!node.children?.length) {
          if (!prior.children?.length && (prior.word !== node.word || prior.tokenIndex !== node.tokenIndex) && pronouncedLater(movementIndex, node.id))
            patches.set(node.id, { ...patches.get(node.id), word: prior.word, tokenIndex: prior.tokenIndex });
          return;
        }
        if (prior.children?.length === node.children.length) node.children.forEach((child, i) => walk(child, prior.children![i]));
      };
      const landing = findExactNodeByIdInForest(workspaceRoots, movement.targetNodeId);
      if (landing) walk(landing, findExactNodeByIdInForest(previousFrameWorkspaceRoots, movement.priorSourceNodeId) ?? undefined);
    }));
    frameRelationSteps.forEach((relation, movementIndex) => (relation.recoveredMovements ?? [relation.recoveredMovement]).forEach(movement => {
      if (!movement?.transition || movement.trajectoryKind !== 'head' || !active.has(movementIndex)) return;
      const receivingId = receivingHeadMaterialNodeId(movement, previousFrameWorkspaceRoots, workspaceRoots);
      [movement.targetNodeId, ...(receivingId ? [receivingId] : [])].forEach(nodeId => {
        if (!pending(movementIndex, candidate => Boolean(candidate.pronunciationNodeIds?.includes(nodeId)))) return;
        const prior = findExactNodeByIdInForest(previousFrameWorkspaceRoots, nodeId === receivingId ? nodeId : movement.priorSourceNodeId);
        const current = findExactNodeByIdInForest(workspaceRoots, nodeId);
        if (!prior || !current || prior.children?.length || nodeId !== receivingId && current.children?.length) return;
        if (prior.word === current.word && prior.tokenIndex === current.tokenIndex) return;
        patches.set(nodeId, { ...patches.get(nodeId), word: prior.word, tokenIndex: prior.tokenIndex });
      });
    }));
    fallbackTransitionOwnership.forEach((ownership, relationIndex) => {
      if (!active.has(relationIndex)) return;
      const retain = (nodeId: string, priorNodeId: string | null) => {
        const waiting = (id: string) => {
          const named = new Set([id]);
          for (let parent = cur.get(id)?.parent; parent; parent = cur.get(parent)?.parent) named.add(parent);
          return pending(relationIndex, candidate => Boolean(candidate.pronunciationNodeIds?.some(named.has, named)));
        };
        const walk = (node: SyntaxNode, prior: SyntaxNode | null): void => {
          const terminal = !node.children?.length, exact = prior && Boolean(prior.children?.length) !== terminal ? prior : null;
          if (waiting(node.id)) patches.set(node.id, { ...patches.get(node.id), ...Object.fromEntries((terminal ? ['word', 'tokenIndex', 'silent'] : ['silent'])
            .map(field => [field, exact ? (exact as unknown as Record<string, unknown>)[field] : undefined])) });
          const aligned = exact && exact.children?.length === node.children?.length ? exact.children! : null;
          (node.children || []).forEach((child, childIndex) => walk(child, aligned ? aligned[childIndex] : null));
        };
        const node = findExactNodeByIdInForest(workspaceRoots, nodeId);
        if (node) walk(node, priorNodeId === null ? null : findExactNodeByIdInForest(previousFrameWorkspaceRoots, priorNodeId) ?? null);
      };
      ownership.copyPairs?.forEach(pair => retain(pair.targetNodeId, pair.priorSourceNodeId));
      ownership.ambiguousCopyNodeIds?.forEach(nodeId => retain(nodeId, null));
    });
    return patches;
  };
  const snapshot = (state: Frame, moment = false) => {
    const topology = indexForest(topologyOf(state)) ?? new Map<string, Info>();
    const shownKids = (id: string) => edit.kidsOf(state, id);
    // The topology, changed only where the frame's own edges differ: a shown daughter stands under
    // its shown parent, in the frame's order, and keeps no other shown parent. Hidden material stays
    // where the topology has it, so the layout reserves its place as today.
    const canvasKids = new Map<string, string[]>([...topology].map(([id, info]) => [id, [...info.kids]]));
    const canvasParent = new Map<string, string>();
    canvasKids.forEach((kids, id) => kids.forEach(k => canvasParent.set(k, id)));
    const detach = (k: string) => {
      const parent = canvasParent.get(k);
      if (parent) canvasKids.set(parent, canvasKids.get(parent)!.filter(other => other !== k));
      canvasParent.delete(k);
    };
    for (const [id, shown] of state) {
      if (!canvasKids.has(id)) canvasKids.set(id, []);
      if (shown.word) continue;
      const desired = shownKids(id);
      // While construction holds attachments, a shown parent keeps exactly its shown daughters (as
      // today's attachment-preserving canvases do); its other material waits as separate workspaces.
      for (const k of canvasKids.get(id)!) if (attachmentContinuity ? !desired.includes(k) : state.has(k) && !state.get(k)!.word && !desired.includes(k)) detach(k);
      desired.forEach((k, position) => {
        if (canvasParent.get(k) === id) return;
        // A carried daughter takes the place of the hidden node between: that node waits as a
        // separate hidden workspace, never hidden beneath a shown parent.
        let between = canvasParent.get(k);
        while (between && canvasParent.get(between) !== id && canvasParent.has(between) && !state.has(between)) between = canvasParent.get(between);
        const replaced = between && canvasParent.get(between) === id && !state.has(between) ? between : undefined;
        detach(k);
        const list = canvasKids.get(id)!;
        if (replaced) { list.splice(list.indexOf(replaced), 1, k); canvasParent.delete(replaced); canvasParent.set(k, id); return; }
        const next = desired.slice(position + 1).find(other => list.includes(other));
        list.splice(next === undefined ? list.length : list.indexOf(next), 0, k);
        canvasParent.set(k, id);
      });
    }
    const kidsOf = (id: string): string[] => canvasKids.get(id) ?? [];
    const nodeOf = (id: string): SyntaxNode => {
      const shown = state.get(id);
      return shown && !shown.word ? (shown.content === 'P' ? prev.get(id)! : cur.get(id)!).node : (topology.get(id) ?? cur.get(id) ?? prev.get(id))!.node;
    };
    const ids = new Set([...topology.keys(), ...state.keys()]);
    const claimed = new Set(canvasParent.keys());
    const rank = (id: string): number => topology.get(id)?.order ?? Math.min(...[id, ...kidsOf(id)].map(at => topology.get(at)?.order ?? 1e6 + (cur.get(at)?.order ?? prev.get(at)?.order ?? 0)));
    const patches = pronunciationPatches();
    // Before its movement a source keeps its preceding pronunciation, including the silence it
    // inherited there, under an ancestor the stage has already given its current silence.
    const pendingSources = new Set(frameRelationSteps.flatMap((relation, relationIndex) => played.includes(relationIndex) ? []
      : (relation.recoveredMovements ?? [relation.recoveredMovement]).flatMap(m => m?.transition ? [prevId(m.priorSourceNodeId)] : [])));
    const precedingSilence = (id: string): boolean => {
      const path: SyntaxNode[] = [];
      for (let at = prev.get(id)?.parent; at; at = prev.get(at)?.parent ?? null) path.push(prev.get(at)!.node);
      return path.reverse().reduce((silent, node) => replayEffectiveSilence(node, silent), false);
    };
    const build = (id: string, inherited = false): SyntaxNode => {
      const { children: _children, ...own } = nodeOf(id);
      const node: SyntaxNode = { ...own, id } as SyntaxNode;
      const patch = patches.get(id);
      if (patch) for (const [field, value] of Object.entries(patch)) {
        if (value === undefined) delete (node as unknown as Record<string, unknown>)[field];
        else (node as unknown as Record<string, unknown>)[field] = value;
      }
      if (pendingSources.has(id) && state.get(id)?.content === 'P' && precedingSilence(id) !== inherited)
        (node as SyntaxNode & { replayPriorInheritedSilence?: boolean }).replayPriorInheritedSilence = precedingSilence(id);
      const kids = kidsOf(id), silent = replayEffectiveSilence(node, inherited);
      if (kids.length) node.children = kids.map(kid => build(kid, silent));
      return node;
    };
    const canvasForest = [...ids].filter(id => !claimed.has(id)).sort((a, b) => rank(a) - rank(b)).map(id => build(id));
    const pending = pendingAttachments(state, moment);
    // As today: a stage without relation transitions reuses its construction scaffold where the
    // frame fits it; otherwise the scaffold is grafted from the frame's own material.
    const scaffold = relationPlacements.length || placements.relationLayoutNodeIds.length || placements.frameHasTreeTransition
      ? buildFrameLayoutScaffold(canvasForest, new Set(pending ?? []))
      : structuralLayoutScaffold && forestCanUseCurrentMaterialLayoutScaffold(canvasForest, structuralLayoutScaffold, attachmentContinuity ? new Set(pending ?? []) : undefined)
        ? structuralLayoutScaffold : undefined;
    const authoredIds = new Set<string>();
    const visit = (node: SyntaxNode) => { authoredIds.add(node.id); node.children?.forEach(visit); };
    canvasForest.forEach(visit);
    const wordOnly = new Set([...state].filter(([, shown]) => shown.word).map(([id]) => id));
    const requested = new Set<string>();
    const ofCanvas = cloneSyntaxTree(buildRenderableDerivationCanvasData(canvasForest, identity));
    const mark = (node: SyntaxNode) => {
      const origin = node.replayOrigin;
      const authored = origin?.kind === 'lexical' ? String(origin.authoredId) : origin?.kind === 'word' ? String(origin.ownerId) : node.id;
      if (origin?.kind === 'word' ? state.has(authored) : state.has(authored) && !wordOnly.has(authored)) requested.add(node.id);
      node.children?.forEach(mark);
    };
    if (ofCanvas) mark(ofCanvas);
    const snap = buildDerivationReplaySnapshot({ forest: canvasForest, activeFrameIndex: index, relationLinks: linksFor(), visibleNodeIds: requested,
      layoutNodeIds: authoredIds, derivationFrames: frames, layoutScaffoldForest: scaffold, identity });
    return { ...snap, usesScaffold: Boolean(scaffold), pending, visibleNodeIds: snap.visibleNodeIds.filter(id => requested.has(id) || !wordOnlyLeafOwner(snap.canvasData, id, wordOnly)) };
  };
  const hierarchyOf = (canvas: SyntaxNode | null | undefined) => {
    if (!canvas) return null;
    const hierarchy = d3.hierarchy<SyntaxNode>(canvas);
    applyVizIds(hierarchy);
    return hierarchy;
  };
  const traceIndexByNodeId = buildResolvedLinkTraceIndexMap(workspaceRoots, authoredPreviousRelationRelationLinks, index);
  const labelOf = (node: d3.HierarchyNode<SyntaxNode>): string => {
    const surface = resolveLeafSurface(node);
    if (isPronouncedLeaf(node.data) || !isTraceLike(surface)) return resolveNodeLabel(node);
    return formatTraceSurfaceForDisplayValue(surface, resolveTraceIndexFromNodeContext(node, traceIndexByNodeId) || extractMovementIndex(surface));
  };
  const canvasNode = (hierarchy: d3.HierarchyNode<SyntaxNode> | null, id: string, word = false) => hierarchy?.descendants().find(node => word
    ? node.data.replayOrigin?.kind === 'word' && node.data.replayOrigin.ownerId === id
    : node.data.id === id || (node.data.replayOrigin?.kind === 'lexical' && node.data.replayOrigin.authoredId === id)) ?? null;
  const emitMicro = (unit: Unit, next: Frame, forced: boolean) => {
    const snap = snapshot(next), hierarchy = hierarchyOf(snap.canvasData);
    // A preterminal's own word is the projection's source; a word as its own leaf is selected.
    const lexicalLeaf = !unit.word && !cur.get(unit.id)!.kids.length && !shouldExpandPreterminalLeaf(cur.get(unit.id)!.node);
    const node = unit.word ? canvasNode(hierarchy, unit.id, true) : canvasNode(hierarchy, unit.id);
    if (!node) return;
    const visible = new Set(snap.visibleNodeIds);
    const childNodes = (node.children ?? []).filter(child => !child.data.replayLayoutOnly);
    const operation: DerivationOperation = !childNodes.length ? 'LexicalSelect' : childNodes.length === 1 ? 'Project' : 'ExternalMerge';
    const visibleLeaves = collectPronouncedLeafNodeIdsInOrder(buildVisibleSyntaxSnapshotFromHierarchy({ root: hierarchy!, visibleNodeIds: visible, identity }));
    const lower = (surface: string) => maybeLowercaseSentenceInitialFunctionSurface({ surface, sentenceInitialSurface, nodeId: getNodeId(node),
      parentLabel: String(node.parent?.data?.label || '').trim(), visibleOvertLeafIds: visibleLeaves,
      hasNominalComplement: hasDeterminerNominalComplement(node.parent?.data, node.parent?.parent?.data), isWorkspaceForest: forestOf(next).length > 1 });
    const rawTarget = labelOf(node), surface = resolveLeafSurface(node);
    const targetLabel = !childNodes.length && !isNotationLeaf(node.data) ? lower(rawTarget) : rawTarget;
    const sourceLabels = childNodes.length ? childNodes.map(labelOf).filter(Boolean)
      : [isNotationLeaf(node.data) && isTraceLike(surface) ? targetLabel : lower(String(node.data.word || targetLabel || '').trim())].filter(Boolean);
    void lexicalLeaf;
    steps.push({
      operation, sourceKind: 'microstep', sourceFrameIndex: index, visualFrameIndex: index,
      targetNodeId: getNodeId(node), targetLabel, sourceNodeIds: childNodes.map(child => getNodeId(child)), sourceLabels,
      recipe: buildStructuralReplayFallback(operation, targetLabel, sourceLabels),
      replayFrameIndex: index, replayCanvasData: snap.canvasData, replayVisibleNodeIds: snap.visibleNodeIds, replayRelationLinks: snap.relationLinks,
      replayUsesFutureLayoutScaffold: snap.usesScaffold, replayPendingAttachmentNodeIds: snap.pending,
      replayKind: 'micro',
      ...(forced ? { movementDiagnostics: ['REPLAY_KERNEL_FORCED: this construction step needed more than its own target'] } : {})
    });
  };
  const emitRelation = (placement: RelationPlacement) => {
    const snap = snapshot(frameState, true), neutral = fallbackTransitionOwnership.get(placement.relationIndex);
    const canvas = snap.canvasData;
    const describe = (id: string) => getReplayNodeOvertYieldFromCanvas(canvas, id) || getReplayNodeDisplayFromCanvas(canvas, id) || getReplayNodeCategoryFromCanvas(canvas, id);
    const target = placement.authoredTargetNodeIds[0] || placement.relationAnchorNodeIds[0] || frameSemanticStep.targetNodeId;
    const sources = placement.renderableTrajectory ? placement.sourceNodeIds : placement.relationAnchorNodeIds.filter(id => id !== target);
    const relations = [placement];
    const relationDiagnostics = relations.flatMap(entry => [...(entry.relation.movementDiagnostics ?? []), ...(diagnostics.get(entry.relationIndex) ?? [])]);
    steps.push({
      ...frameSemanticStep,
      ...(neutral ? { replayTreeTransition: {
        relationKey: `${index}:${authoredIndex(placement)}`, currentNodeIds: [...neutral.currentNodeIds], priorNodeIds: [...neutral.priorNodeIds],
        ...(neutral.attachments?.some(a => a.retained) ? { attachments: neutral.attachments.filter(a => a.retained).map(({ host, wrapper }) => ({ host, wrapper })) } : {})
      } } : {}),
      operation: placement.relationLabel as DerivationOperation, replayKind: 'relation',
      replayRelationIdentity: { stageIndex: index, relationIndex: authoredIndex(placement) },
      targetNodeId: target || frameSemanticStep.targetNodeId, targetLabel: describe(target) || placement.relationLabel,
      sourceNodeIds: sources.length ? sources : frameSemanticStep.sourceNodeIds,
      sourceLabels: sources.map(describe).filter(Boolean),
      recipe: placement.relationLabel,
      movementDiagnostics: relationDiagnostics.length || placement.relation.movementDiagnostics ? relationDiagnostics : undefined,
      note: undefined, preserveReplayStep: true, stageRecord: getFrameStageRecordText(frame, plannedStage),
      detailBlocks: mergeReplayDetailBlocks(buildRelationReplayBlocks(relations.map(entry => entry.relation), canvas),
        relations.some(entry => entry.relation.relationContractFailure) ? [{ title: 'Relation diagnostic', lines: relations
          .flatMap(entry => entry.relation.relationContractFailure?.issues.map(issue => issue.message) ?? []) }] : undefined),
      replayCanvasData: canvas, replayVisibleNodeIds: snap.visibleNodeIds, replayRelationLinks: snap.relationLinks,
      replayUsesFutureLayoutScaffold: snap.usesScaffold, replayPendingAttachmentNodeIds: snap.pending
    });
  };

  // The schedule, as today's: construction in order, each moment offered at its insertion point
  // and played in moment order; what a step or moment needs is built (or played) first.
  const emittedUnits = new Set<Unit>(), visitingUnits = new Set<Unit>();
  let nextMoment = 0, latestAuthored = -1;
  const unitDone = (unit: Unit) => unit.word ? frameState.has(unit.id) : edit.built(frameState, unit.id);
  /** Makes `id` available, or returns it when it cannot be yet. */
  const isAvailable = (id: string) => {
    const unit = unitOf(id), owner = producer(id);
    return owner !== undefined ? played.includes(owner) : unit ? unitDone(unit) : true;
  };
  const ensure = (id: string, forRelation?: number): string[] => {
    if (!cur.has(id)) return [];
    const unit = unitOf(id), reshapedBy = forRelation === undefined ? undefined : reshaper(id);
    // A relation needing a preceding node a moment reshapes needs that moment's current form.
    if (reshapedBy !== undefined && reshapedBy !== forRelation && !played.includes(reshapedBy)) {
      if (!playsAfter(forRelation!, reshapedBy)) return [id];
      emitMomentsThrough(reshapedBy);
      return [];
    }
    // Retaining an occurrence does not establish its new daughters: those wait for its construction.
    if (available0.has(id) && (!unit || unitDone(unit))) return [];
    const owner = producer(id);
    if (owner !== undefined && played.includes(owner)) return [];
    // Material the moment being prepared brings itself: construction before it carries that slot.
    if (owner !== undefined && owner === forRelation) return [];
    if (owner !== undefined) {
      if (forRelation !== undefined && !playsAfter(forRelation, owner)) return [id];
      emitMomentsThrough(owner);
      return isBuilt(id) ? [] : [id];
    }
    return unit ? emitUnit(unit, forRelation) : [];
  };
  // A movement can complete an existing phrase: its landing joins a parent the stage already had,
  // which contains its source (a specifier landing). A merge taking that phrase as a daughter
  // builds forward on the completed phrase, so it waits for the movement's moment, unless the
  // movement needs the merge's output, and only when every relation still to play up to the
  // movement relates material inside the phrase (authored order holds otherwise).
  const landingCompletions = new Map<string, number[]>();
  momentPlacements.filter(placement => placement.renderableTrajectory || placement.ownsPhrasalTreeTransition).forEach(placement =>
    placement.authoredTargetNodeIds.map(id => cur.get(id)?.parent).forEach(parent => {
      if (parent && available0.has(parent) && producer(parent) === undefined && placement.sourceNodeIds.some(source => subtree(cur, parent).includes(source)))
        landingCompletions.set(parent, [...new Set([...(landingCompletions.get(parent) ?? []), placement.relationIndex])]);
    }));
  const completingMoments = (unit: Unit, forRelation?: number): number[] => unit.word ? [] : constructionKids(unit.id).flatMap(phrase =>
    (landingCompletions.get(phrase) ?? []).filter(relation => !required(placementOf.get(relation)!).some(id => subtree(cur, id).includes(unit.id))
      && (forRelation === undefined || playsAfter(forRelation, relation))
      && momentOrder.slice(nextMoment, (momentPosition.get(relation) ?? -1) + 1)
        .every(other => placementOf.get(other)!.relationAnchorNodeIds.every(id => subtree(cur, phrase).includes(id)))));
  const emitUnit = (unit: Unit, forRelation?: number): string[] => {
    if (emittedUnits.has(unit) || unitDone(unit)) { emittedUnits.add(unit); return []; }
    if (visitingUnits.has(unit)) return [unit.id];
    visitingUnits.add(unit);
    completingMoments(unit, forRelation).forEach(relation => emitMomentsThrough(relation));
    const wordUnit = !unit.word ? units.find(other => other.word && other.id === unit.id) : undefined;
    const missing = [...(wordUnit ? emitUnit(wordUnit, forRelation) : []), ...(unit.word ? [] : constructionKids(unit.id).flatMap(k => ensure(k, forRelation)))];
    visitingUnits.delete(unit);
    if (missing.length) return missing;
    // A moment its daughters needed may have built it meanwhile.
    if (unitDone(unit)) { emittedUnits.add(unit); return []; }
    if (unit.word) {
      const next: Frame = new Map(frameState);
      next.set(unit.id, { content: 'C', kids: 'C', slots: new Map(), word: true });
      emitMicro(unit, next, false); frameState = next; emittedUnits.add(unit); return [];
    }
    // A node that replaces a kept parent's daughter swaps into that slot when it is built.
    const parent = cur.get(unit.id)!.parent, slot = parent ? cur.get(parent)!.kids.indexOf(unit.id) : -1;
    const swaps = parent && frameState.has(parent) && edit.diffs.get(parent)?.slots?.includes(slot) && !owners.has(key('s', parent, slot))
      ? [key('s', parent, slot)] : [];
    let closed = close(edit, frameState, owners, [key('w', unit.id), ...swaps], {});
    if (typeof closed === 'string' && swaps.length) closed = close(edit, frameState, owners, [key('w', unit.id)], {});
    const next = typeof closed === 'string' ? null : edit.apply(frameState, closed.keys);
    if (!next) return [typeof closed === 'string' ? closed : unit.id];
    emitMicro(unit, next, false); frameState = next; emittedUnits.add(unit);
    return [];
  };
  const momentDue = (through: number) => nextMoment < momentOrder.length && (nextMoment <= through
    || visitingUnits.size === 0 && momentOrder[nextMoment] < latestAuthored);
  const emitMomentsThrough = (relationIndex: number) => {
    const through = momentPosition.get(relationIndex) ?? -1;
    while (momentDue(through)) {
      const relation = momentOrder[nextMoment++], placement = placementOf.get(relation)!;
      latestAuthored = Math.max(latestAuthored, relation);
      const missing = [...new Set(required(placement).flatMap(id => ensure(id, relation)))];
      if (missing.length) diagnose(relation, `RELATION_TIMING_CONFLICT: Stage ${index + 1}, relation ${authoredIndex(placement) + 1} (${placement.relationLabel}) requires ${missing.map(id => {
        const owner = producer(id);
        return owner === undefined ? `${id} before its structural prerequisites are available`
          : `${id} before relation ${(frameRelationSteps[owner].authoredRelationIndex ?? owner) + 1} (${frameRelationSteps[owner].relation}) introduces it`;
      }).join('; ')}. No Replay order provides it first, so authored relation order is kept; unavailable structure is not introduced early.`);
      // Construction the moment needs and does not own is built first, never at the moment.
      const constructionFirst = (id: string) => Boolean(unitOf(id)) && !unitDone(unitOf(id)!);
      let closed = close(edit, frameState, owners, ownedBy(relation), { relation, constructionFirst });
      for (let guard = 0; typeof closed === 'string' && guard < units.length; guard += 1) {
        const blocking = unitOf(closed);
        if (!blocking || unitDone(blocking) || emitUnit(blocking, relation).length) break;
        closed = close(edit, frameState, owners, ownedBy(relation), { relation, constructionFirst });
      }
      if (typeof closed === 'string') closed = close(edit, frameState, owners, ownedBy(relation), { relation });
      if (typeof closed === 'string') closed = close(edit, frameState, owners, ownedBy(relation), { relation, forced: true });
      const next = typeof closed === 'string' ? null : edit.apply(frameState, closed.keys);
      if (next) frameState = next;
      played.push(relation);
      // A proved movement stands independently of its contextual anchors: context no moment has
      // introduced yet is reported, not waited for or built early.
      const absent = contextOf(placement).filter(id => !missing.includes(id) && !isAvailable(id));
      if (absent.length) diagnose(relation, `RELATION_TIMING_CONFLICT: Stage ${index + 1}, relation ${authoredIndex(placement) + 1} (${placement.relationLabel}) has unavailable authored context: ${absent.map(id => {
        const owner = producer(id);
        return owner === undefined ? `${id} before its structural prerequisites are available`
          : `${id} before relation ${(frameRelationSteps[owner].authoredRelationIndex ?? owner) + 1} (${frameRelationSteps[owner].relation}) introduces it`;
      }).join('; ')}. Its proven movement keeps its moment; unavailable context is not introduced early.`);
      emitRelation(placement);
    }
  };
  for (let at = 0; at <= units.length; at += 1) {
    offered.filter(entry => entry.at === at).forEach(entry => emitMomentsThrough(entry.placement.relationIndex));
    if (at >= units.length) continue;
    emitUnit(units[at]);
    emitMomentsThrough(-1);
  }
  // Construction a moment held back follows; anything still blocked is forced.
  for (const unit of units) if (!unitDone(unit)) {
    if (emitUnit(unit).length && !unitDone(unit)) {
      const closed = close(edit, frameState, owners, [key('w', unit.id)], { forced: true });
      const next = typeof closed === 'string' ? null : edit.apply(frameState, closed.keys);
      if (next) { emitMicro(unit, next, true); frameState = next; }
    }
  }
  // The completed stage. A removal nothing owned settles here.
  const completed: Frame = new Map([...cur.keys()].map(id => [id, { content: 'C' as const, kids: 'C' as const, slots: new Map<number, string>() }]));
  const same = frameState.size === completed.size && [...completed.keys()].every(id => edit.done(frameState, id));
  const last = steps.at(-1);
  const finalSnap: Snap = fallbackTransitionOwnership.size > 0 || !same || !last ? completedSnap
    : { canvasData: last.replayCanvasData!, visibleNodeIds: last.replayVisibleNodeIds!, relationLinks: last.replayRelationLinks!, usesScaffold: last.replayUsesFutureLayoutScaffold };
  const stepCount = steps.length + 1;
  return [
    ...steps.map((step, position) => ({ ...step, replayProgressLabel: buildReplayProgressLabel(plannedStage, plannedStageCount, position + 1, stepCount) })),
    stageRecord(finalSnap, stepCount)
  ];
}

/** Whether `id` is the hidden preterminal owner of a word shown alone. */
function wordOnlyLeafOwner(canvas: SyntaxNode | null | undefined, id: string, wordOnly: ReadonlySet<string>): boolean {
  void canvas;
  return wordOnly.has(id);
}

/**
 * Relation links persist: each step carries every link played so far whose endpoints its canvas
 * holds, in the order they were first played. Visibility stays the frame's own.
 */
export function carryRelationLinks(steps: PlaybackStep[]): PlaybackStep[] {
  const active: ResolvedRelationLink[] = [], keys = new Set<string>();
  return steps.map(step => {
    (step.replayRelationLinks ?? []).forEach(link => {
      const linkKey = resolvedRelationLinkKey(link);
      if (linkKey && !keys.has(linkKey)) { keys.add(linkKey); active.push(link); }
    });
    const canvas = step.replayCanvasData;
    if (!canvas) return step;
    const ids = new Set<string>();
    const visit = (node: SyntaxNode) => { ids.add(String(node.id || '')); (node.aliasIds ?? []).forEach(alias => ids.add(String(alias))); node.children?.forEach(visit); };
    visit(canvas);
    const carried = active.filter(link => {
      if (isResolvedMovementLink(link) && (link.sourceNodeId || link.targetNodeId))
        return Boolean(link.sourceNodeId && link.targetNodeId && ids.has(String(link.sourceNodeId)) && ids.has(String(link.targetNodeId)));
      const anchors = (link.anchors ?? []).map(anchor => String(anchor?.nodeId || '')).filter(Boolean);
      return anchors.length > 0 && anchors.every(id => ids.has(id));
    });
    return carried.length ? { ...step, replayRelationLinks: carried } : step;
  });
}
