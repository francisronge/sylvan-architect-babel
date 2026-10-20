/**
 * Structural movement: displacements read from consecutive completed stages,
 * and the authored relation of each stage that owns one.
 *
 * Detection reads only ids, parents, child slots, workspace roots, lineageId
 * and category notation. Relation names and anchor role names play no part;
 * a claim owns a displacement only by anchoring its occurrences. The prompt
 * contract (one of the two occurrences keeps its id; distinct positions of
 * one object share lineageId) makes each configuration below readable one
 * way. Anything else is a refusal and stays with the existing recognizers.
 *
 * Replay consults it whenever `structuralMovementEnabled()` holds; see
 * `STRUCTURAL_MOVEMENT` for the off-switch.
 */
import type { DerivationStageRelation, SyntaxNode } from '../../types.ts';
import { readCategoryLabel } from '../categoryLabel.ts';
import { productionRelationRegistry } from '../relationDispatch/productionRegistry.js';
import { findRelationRegistryEntry } from '../relationDispatch/relationRegistry.js';
import { isHeadAssembly, landingKind, readsAsProjection, recoverMovementEvidence, type RecoveredMovement } from './movementEvidence.ts';
import { containsOccurrence, indexMovementOccurrences, sameMovementSourceSlot } from './movementSourceEvidence.ts';
import { hasUnestablishedCovertMovementOutcome } from './outcomeResolver.ts';
import { PRODUCTION_RENDER_FAMILIES } from './renderFamilies.ts';
import { isUnestablishedCovertMovementDescription, normalizeTier2Synonym } from './tier2Synonyms.ts';

/** Off-switch for structural movement recognition in every runtime. With it
 * false, Replay, render plans and dispatch are those of wording-only
 * recognition. */
const STRUCTURAL_MOVEMENT = true;

/** The single read of the switch. In Node, `BABEL_STRUCTURAL_MOVEMENT=0` or
 * `=1` overrides the constant for comparison runs; browsers have no
 * `process` and follow the constant. */
const structuralMovementEnabled = (): boolean => {
  const setting = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.BABEL_STRUCTURAL_MOVEMENT?.trim();
  return setting === '0' ? false : setting === '1' ? true : STRUCTURAL_MOVEMENT;
};

export interface StructuralDisplacement {
  /** Which occurrence kept its id across the stage boundary. */
  identity: 'landing-kept' | 'lower-kept' | 'both-renamed';
  lineageId: string;
  /** The occurrence before movement, in the preceding stage. */
  priorSourceNodeId: string;
  /** The lower occurrence in the current stage. */
  sourceNodeId: string;
  /** The landing in the current stage. */
  targetNodeId: string;
  /** Undefined when neither head nor phrasal context reads one way. */
  trajectoryKind?: 'head' | 'phrasal';
  /** The landing's parent contains the lower occurrence. */
  commands: boolean;
  crossWorkspace: boolean;
}

export interface StructuralRefusal {
  lineageId: string;
  reason: string;
  nodeIds: string[];
  /** Occurrences new in this stage among `nodeIds`. */
  freshNodeIds: string[];
}

/** Earlier displacements of the derivation: each newer occurrence id maps to
 * the occurrence it was displaced from, so copies of one chain are ordered. */
export type StructuralChainLinks = ReadonlyMap<string, string>;

type Occurrences = ReturnType<typeof indexMovementOccurrences>;

const parentContains = (index: Occurrences, id: string, other: string): boolean => {
  const parent = index.parents.get(id);
  return Boolean(parent && containsOccurrence(parent, other));
};

const rootIndices = (forest: readonly SyntaxNode[]) => {
  const roots = new Map<string, number>();
  const visit = (node: SyntaxNode, root: number) => { roots.set(node.id ?? '', root); node.children?.forEach(child => visit(child, root)); };
  forest.forEach((node, index) => visit(node, index));
  return roots;
};

const terminalYield = (node: SyntaxNode): string[] => node.children?.length
  ? node.children.flatMap(terminalYield) : String(node.word ?? '').trim() ? [String(node.word).trim().normalize('NFC').toLocaleLowerCase()] : [];
const category = (node: SyntaxNode): string => readCategoryLabel(node.label)?.category ?? String(node.label ?? '').trim();

/** Material is category plus terminal yield. Ids, lineage, silence, feature
 * annotations, letter case and token addresses belong to an occurrence. */
const sameMaterial = (left: SyntaxNode, right: SyntaxNode): boolean => category(left) === category(right)
  && JSON.stringify(terminalYield(left)) === JSON.stringify(terminalYield(right));

const unchangedSubtree = (left: SyntaxNode, right: SyntaxNode): boolean => JSON.stringify(left) === JSON.stringify(right);
const headCategory = (node?: SyntaxNode): string => readCategoryLabel(node?.label)?.head ?? '';
const headLike = (node: SyntaxNode): boolean => !node.children?.length || isHeadAssembly(node);


/** Head adjunction read from structure: a new parent holds only the landing
 * and one unchanged head host. The host stood in that parent's exact slot, or
 * was a lone object while the moving unit left the head position of its own
 * projection. Both are terminals or head assemblies, and none of the three
 * reads as a phrase or bar projection. The landing needs head evidence of its
 * own: a terminal left the head position of its own projection, and a
 * branching landing holds a member that earlier head movement left a lower
 * occurrence of, outside both occurrences of this step. */
const adjoinsHead = (current: Occurrences, prior: Occurrences, landingId: string, lowerId: string, priorSourceId: string): boolean => {
  const parent = current.parents.get(landingId), landing = current.nodes.get(landingId)!;
  if (!parent?.id || prior.nodes.has(parent.id) || current.duplicates.has(parent.id) || parent.children?.length !== 2) return false;
  const host = parent.children.find(child => child.id !== landingId)!, before = prior.nodes.get(host.id ?? '');
  if (!before || prior.duplicates.has(host.id!) || current.duplicates.has(host.id!) || !unchangedSubtree(before, host)
    || [parent, host, landing].some(readsAsProjection)
    || landing.lineageId && host.lineageId === landing.lineageId || !headLike(host) || !headLike(landing)) return false;
  if (landing.children?.length) {
    const members: SyntaxNode[] = [];
    const collect = (node: SyntaxNode) => node.children?.forEach(child => { members.push(child); collect(child); });
    collect(landing);
    const lower = current.nodes.get(lowerId)!;
    const carriesMovedHead = members.some(member => member.lineageId && [...current.nodes.values()].some(node => node.id !== member.id
      && node.lineageId === member.lineageId && !containsOccurrence(landing, node.id!) && !containsOccurrence(lower, node.id!)));
    if (!carriesMovedHead) return false;
  }
  const source = prior.nodes.get(priorSourceId), sourceParent = prior.parents.get(priorSourceId);
  // A terminal landing is a head only if it left the head position of its own
  // projection; a phrase can take the same shape beside a bare head.
  const leftHeadPosition = Boolean(source && sourceParent) && headLike(source!)
    && Boolean(headCategory(source)) && headCategory(source) === headCategory(sourceParent);
  if (!landing.children?.length && !leftHeadPosition) return false;
  if (sameMovementSourceSlot(current, prior, parent.id, host.id!)) return true;
  return !prior.parents.has(host.id!) && leftHeadPosition
    && Boolean(sourceParent!.children?.some(sister => sister.id !== priorSourceId && sister.children?.length));
};

/** A landing context the existing reader leaves open is read from the
 * landing's parent: inside a phrase or bar projection the landing is a
 * phrase. A head or prose-labelled parent stays unread. */
const phraseParent = (current: Occurrences, landingId: string): boolean => {
  const parent = current.parents.get(landingId);
  return Boolean(parent && !current.duplicates.has(parent.id ?? '') && readsAsProjection(parent));
};

/** Every displacement of one stage boundary. Each lineage is read on its own:
 * its occurrences that persist by id, and those new in this stage. */
export const readStageDisplacements = (
  previousForest: readonly SyntaxNode[] = [],
  currentForest: readonly SyntaxNode[] = [],
  links: StructuralChainLinks = new Map()
): { displacements: StructuralDisplacement[]; refusals: StructuralRefusal[] } => {
  const displacements: StructuralDisplacement[] = [], refusals: StructuralRefusal[] = [];
  if (!previousForest.length) return { displacements, refusals };
  const current = indexMovementOccurrences(currentForest), prior = indexMovementOccurrences(previousForest);
  const currentRoots = rootIndices(currentForest);
  const lineages = new Map<string, string[]>();
  current.nodes.forEach((node, id) => {
    if (node.lineageId) lineages.set(node.lineageId, [...(lineages.get(node.lineageId) ?? []), id]);
  });
  // Whether `id` descends from `other` through earlier displacements.
  const follows = (id: string, other: string): boolean => {
    for (let step = links.get(id), guard = 0; step !== undefined && guard < 1000; step = links.get(step), guard++)
      if (step === other) return true;
    return false;
  };
  for (const [lineageId, ids] of lineages) {
    const refuse = (reason: string, nodeIds: string[]) => refusals.push({ lineageId, reason, nodeIds,
      freshNodeIds: nodeIds.filter(id => !prior.nodes.has(id)) });
    if (ids.some(id => current.duplicates.has(id))) { refuse('duplicate-current-id', ids); continue; }
    const declared = [...prior.nodes.values()].filter(node => node.lineageId === lineageId).map(node => node.id!);
    // A lineage may be declared as its first copy is made: the persisting id
    // carries identity, provided no earlier object already holds the lineage.
    const earlier = declared.length ? declared
      : ids.filter(id => prior.nodes.has(id) && prior.nodes.get(id)!.lineageId === undefined);
    if (!earlier.length) continue;
    if (earlier.some(id => prior.duplicates.has(id))) { refuse('duplicate-prior-id', earlier); continue; }
    // Only the outermost occurrences of a lineage are occurrences of the
    // object; a node of the same lineage inside another is its part.
    const fresh = ids.filter(id => !prior.nodes.has(id)).filter((id, _, all) => !all.some(other =>
      other !== id && containsOccurrence(current.nodes.get(other)!, id)));
    if (!fresh.length) continue;
    const persisting = earlier.filter(id => current.nodes.has(id));
    const moved = persisting.filter(id => prior.parents.has(id) && !sameMovementSourceSlot(current, prior, id, id));
    const stayed = persisting.filter(id => sameMovementSourceSlot(current, prior, id, id));
    const removed = earlier.filter(id => !current.nodes.has(id));
    const occupantOf = (priorId: string) => fresh.filter(id => sameMovementSourceSlot(current, prior, id, priorId));
    let reading: Pick<StructuralDisplacement, 'identity' | 'priorSourceNodeId' | 'sourceNodeId' | 'targetNodeId'> | undefined;
    if (moved.length === 1) {
      // The landing kept its id; the new occurrence in its old slot is the lower one.
      const [landing] = moved, occupants = occupantOf(landing);
      if (occupants.length !== 1) { refuse('moved-without-lower-occurrence-in-slot', [landing, ...fresh]); continue; }
      if (fresh.length > 1) { refuse('several-new-occurrences', [landing, ...fresh]); continue; }
      reading = { identity: 'landing-kept', priorSourceNodeId: landing, sourceNodeId: occupants[0], targetNodeId: landing };
    } else if (moved.length > 1) {
      refuse('several-moved-occurrences', moved); continue;
    } else if (fresh.length === 1) {
      // The lower occurrence kept its id and slot. It is the source when the
      // new occurrence repeats its preceding material, or when it is itself
      // rewritten in place in this stage; lineage over different material
      // establishes identity only.
      const [landing] = fresh;
      const material = stayed.filter(id => sameMaterial(current.nodes.get(landing)!, prior.nodes.get(id)!)
        || !unchangedSubtree(prior.nodes.get(id)!, current.nodes.get(id)!));
      // A chain grows from its newest copy. A candidate that another follows
      // through the derivation's earlier displacements, or that another
      // commands, is an older copy. Several newest copies are the lower
      // occurrences of one shared landing, as in across-the-board movement,
      // and are read together, never singly.
      const older = (id: string) => material.some(other => other !== id && (follows(other, id) || parentContains(prior, other, id)));
      const candidates = material.filter(id => !older(id));
      if (candidates.length > 1) { refuse('shared-landing', [landing, ...candidates]); continue; }
      if (candidates.length !== 1) {
        refuse(material.length ? 'several-candidate-sources' : stayed.length ? 'lineage-only-new-material' : 'no-persisting-source', [landing, ...stayed]);
        continue;
      }
      reading = { identity: 'lower-kept', priorSourceNodeId: candidates[0], sourceNodeId: candidates[0], targetNodeId: landing };
    } else if (fresh.length === 2 && removed.length === 1 && stayed.every(id => unchangedSubtree(prior.nodes.get(id)!, current.nodes.get(id)!))) {
      // Neither kept its id: one new occurrence holds the removed one's slot.
      const occupants = occupantOf(removed[0]);
      if (occupants.length !== 1) { refuse('renamed-without-lower-occurrence-in-slot', [removed[0], ...fresh]); continue; }
      const landing = fresh.find(id => id !== occupants[0])!;
      reading = { identity: 'both-renamed', priorSourceNodeId: removed[0], sourceNodeId: occupants[0], targetNodeId: landing };
    } else {
      refuse('several-new-occurrences', [...persisting, ...fresh]); continue;
    }
    const source = current.nodes.get(reading.sourceNodeId)!, target = current.nodes.get(reading.targetNodeId)!;
    if (containsOccurrence(source, target.id!) || containsOccurrence(target, source.id!)) {
      refuse('nested-occurrences', [source.id!, target.id!]); continue;
    }
    const before = prior.nodes.get(reading.priorSourceNodeId)!;
    const commands = parentContains(current, target.id!, source.id!);
    const read = adjoinsHead(current, prior, target.id!, source.id!, before.id!) ? 'head'
      : landingKind(target, current.parents.get(target.id!), previousForest,
        { node: before, parent: prior.parents.get(before.id!) }, { current, prior })
      ?? (phraseParent(current, target.id!) ? 'phrasal' : undefined);
    // Branching alone does not make a phrase: a complex head branches too. A
    // branching landing not notated as a projection reads as phrasal only
    // inside a projection or merged with an object containing its source.
    const kind = read === 'phrasal' && target.children?.length && !readsAsProjection(target)
      && !commands && !phraseParent(current, target.id!) ? undefined : read;
    displacements.push({
      ...reading, lineageId,
      ...(kind ? { trajectoryKind: kind } : {}),
      commands,
      crossWorkspace: currentRoots.get(source.id!) !== currentRoots.get(target.id!)
    });
  }
  // A part of a moving phrase travels with it: a displacement or refusal
  // inside another displacement's landing or lower occurrence is not its own.
  const within = (id: string, outer: StructuralDisplacement) => [outer.targetNodeId, outer.sourceNodeId]
    .some(container => container !== id && containsOccurrence(current.nodes.get(container)!, id));
  return {
    displacements: displacements.filter(inner => !displacements.some(outer => outer !== inner && within(inner.targetNodeId, outer))),
    refusals: refusals.filter(refusal => !refusal.freshNodeIds.length
      || !displacements.some(outer => refusal.freshNodeIds.every(id => within(id, outer))))
  };
};

const anchorIds = (block?: Record<string, string | string[]>): string[] =>
  Object.values(block ?? {}).flatMap(value => Array.isArray(value) ? value : [value]).map(String);

export interface StructuralClaimReading {
  /** Displacements whose landing and source this claim both anchors. */
  named: number[];
  /** Displacements this claim anchors at one end only. */
  touched: number[];
}

/** A claim names a displacement when it anchors its landing, and its lower
 * occurrence or the preceding source. Anchoring one end only is how Case,
 * agreement or binding claims mention a moved phrase. */
export const readClaimEnds = (relation: DerivationStageRelation, displacements: readonly StructuralDisplacement[]): StructuralClaimReading => {
  const currentIds = new Set(anchorIds(relation.anchors)), priorIds = new Set(anchorIds(relation.priorAnchors));
  const named: number[] = [], touched: number[] = [];
  displacements.forEach((displacement, index) => {
    const landing = currentIds.has(displacement.targetNodeId);
    const source = currentIds.has(displacement.sourceNodeId) || priorIds.has(displacement.priorSourceNodeId);
    if (landing && source) named.push(index);
    else if (landing || source) touched.push(index);
  });
  return { named, touched };
};

export interface StructuralStageOwnership {
  displacements: StructuralDisplacement[];
  refusals: StructuralRefusal[];
  claims: StructuralClaimReading[];
  /** relation index -> owned displacement index */
  owners: Map<number, number>;
  /** relation index -> why its earliest naming claim stays neutral */
  neutral: Map<number, string>;
}

/** A registered relation that is not a movement keeps its exact Tier-1 family. */
const registeredNonMovement = (relation: DerivationStageRelation): boolean => {
  const entry = findRelationRegistryEntry(productionRelationRegistry, String(relation.relation ?? '').trim());
  return Boolean(entry && !PRODUCTION_RENDER_FAMILIES[entry.id]?.trajectoryKind);
};

const anchorLists = (block?: Record<string, string | string[]>): string[][] =>
  Object.values(block ?? {}).map(value => (Array.isArray(value) ? value : [value]).map(String));

/** Whether the owning claim's own anchors read the displacement more than one
 * way. Every anchor must name one current (or, in `priorAnchors`, one
 * preceding) node, no list may repeat one, and no anchored object may change
 * its lineage. Besides older copies of the chain, the claim may name no other
 * occurrence of the moving lineage, a list holding an endpoint holds only parts
 * of the chain, and when the claim names preceding participants, the preceding
 * source is among them. Names play no part. */
const claimReadsOtherwise = (relation: DerivationStageRelation, displacement: StructuralDisplacement,
  current: Occurrences, prior: Occurrences, links: StructuralChainLinks): string | undefined => {
  const currentLists = anchorLists(relation.anchors), priorLists = anchorLists(relation.priorAnchors);
  const unresolved = (index: Occurrences, id: string) => !index.nodes.has(id) || index.duplicates.has(id);
  if (currentLists.flat().some(id => unresolved(current, id)) || priorLists.flat().some(id => unresolved(prior, id)))
    return 'unresolved-anchor';
  if ([...currentLists, ...priorLists].some(ids => new Set(ids).size !== ids.length)) return 'repeated-anchor';
  // An anchored object that changes its lineage across the boundary contradicts occurrence identity.
  if (currentLists.flat().some(id => prior.nodes.has(id) && !prior.duplicates.has(id)
    && (prior.nodes.get(id)!.lineageId ?? '') !== (current.nodes.get(id)!.lineageId ?? '')
    && prior.nodes.get(id)!.lineageId !== undefined)) return 'anchor-changes-lineage';
  const { lineageId, sourceNodeId, targetNodeId, priorSourceNodeId } = displacement;
  const within = (index: Occurrences, id: string, containers: string[]) =>
    containers.some(container => container === id || containsOccurrence(index.nodes.get(container)!, id));
  // An older copy of the chain, unchanged in its slot, is context: an earlier
  // displacement made it, or it shares the landing's category. Another object
  // given the lineage, or a second preceding source, is not.
  const chained = new Set([...links.keys(), ...links.values()]);
  const olderCopy = (id: string) => prior.nodes.has(id) && unchangedSubtree(prior.nodes.get(id)!, current.nodes.get(id)!)
    && sameMovementSourceSlot(current, prior, id, id)
    && (chained.has(id) || category(current.nodes.get(id)!) === category(current.nodes.get(targetNodeId)!));
  if (currentLists.flat().some(id => current.nodes.get(id)!.lineageId === lineageId
      && !within(current, id, [sourceNodeId, targetNodeId]) && !olderCopy(id))
    || priorLists.flat().some(id => prior.nodes.get(id)!.lineageId === lineageId && !within(prior, id, [priorSourceNodeId])))
    return 'names-another-occurrence';
  // A list that holds an endpoint alongside an unrelated object treats both alike.
  const endpointPart = (id: string) => id === targetNodeId || within(current, id, [sourceNodeId]) || olderCopy(id);
  if (currentLists.some(ids => ids.length > 1 && ids.some(id => id === targetNodeId || id === sourceNodeId)
    && !ids.every(endpointPart))) return 'endpoint-in-mixed-list';
  if (priorLists.length && !priorLists.flat().includes(priorSourceNodeId)) return 'prior-anchors-omit-source';
  return undefined;
};

/** The earliest claim of the stage that names a displacement at both ends owns
 * it. A claim naming several displacements, a displacement into another
 * workspace (sideward movement or parallel construction), a displacement whose
 * landing context reads neither head nor phrasal, a registered non-movement
 * relation, a claim that denies the movement or asserts an unestablished
 * outcome, and a claim whose anchors read otherwise stay neutral. */
export const readStageStructuralOwnership = (
  relations: readonly DerivationStageRelation[],
  previousForest: readonly SyntaxNode[] = [],
  currentForest: readonly SyntaxNode[] = [],
  links: StructuralChainLinks = new Map()
): StructuralStageOwnership => {
  const { displacements, refusals } = readStageDisplacements(previousForest, currentForest, links);
  const claims = relations.map(relation => readClaimEnds(relation, displacements));
  const current = indexMovementOccurrences(currentForest), prior = indexMovementOccurrences(previousForest);
  const owners = new Map<number, number>(), neutral = new Map<number, string>();
  displacements.forEach((displacement, index) => {
    const owner = claims.findIndex(claim => claim.named.includes(index));
    if (owner < 0) return;
    const relation = relations[owner];
    const reason = claims[owner].named.length > 1 ? 'names-several-displacements'
      : displacement.crossWorkspace ? 'cross-workspace'
      : !displacement.trajectoryKind ? 'landing-context-unread'
      : registeredNonMovement(relation) ? 'registered-non-movement'
      : isUnestablishedCovertMovementDescription(String(relation.relation ?? ''))
        || hasUnestablishedCovertMovementOutcome(relation.values) ? 'unestablished-outcome'
      : claimReadsOtherwise(relation, displacement, current, prior, links);
    if (reason) neutral.set(owner, reason);
    else owners.set(owner, index);
  });
  return { displacements, refusals, claims, owners, neutral };
};

/** Stage-by-stage ownership for a whole derivation. Each stage's displacements
 * order the copies that later stages read: the landing follows its lower
 * occurrence, and a new lower occurrence takes over its slot's predecessor. */
export const readDerivationStructuralMovement = (
  stages: readonly { workspaceForest?: SyntaxNode[]; relations?: DerivationStageRelation[] }[]
): StructuralStageOwnership[] => {
  const links = new Map<string, string>();
  return stages.map((stage, index) => {
    const ownership = readStageStructuralOwnership(stage.relations ?? [],
      index ? stages[index - 1].workspaceForest ?? [] : [], stage.workspaceForest ?? [], links);
    ownership.displacements.forEach(({ priorSourceNodeId, sourceNodeId, targetNodeId }) => {
      const before = links.get(priorSourceNodeId);
      if (sourceNodeId !== priorSourceNodeId) {
        if (before !== undefined) links.set(sourceNodeId, before);
        else links.delete(sourceNodeId);
      }
      links.set(targetNodeId, sourceNodeId);
    });
    return ownership;
  });
};

/** The owned displacement as the shared movement evidence. Endpoint fields are
 * the authored entries anchoring only those occurrences; every other field
 * keeps its authored meaning. A uniquely anchored strict descendant of the
 * lower occurrence, such as its trace terminal, is the witness. */
export const structuralRecoveredMovement = (
  relation: DerivationStageRelation,
  displacement: StructuralDisplacement,
  currentForest: readonly SyntaxNode[],
  normalizeKey: (key: string) => string
): RecoveredMovement => {
  const { sourceNodeId, targetNodeId } = displacement;
  const current = indexMovementOccurrences(currentForest);
  const entries = Object.entries(relation.anchors ?? {}).map(([key, value]) => ({ key, ids: (Array.isArray(value) ? value : [value]).map(String) }));
  const lower = current.nodes.get(sourceNodeId)!;
  const inside = [...new Set(entries.flatMap(entry => entry.ids))].filter(id => id !== sourceNodeId
    && !current.duplicates.has(id) && containsOccurrence(lower, id));
  const witnessNodeId = inside.length === 1 ? inside[0] : sourceNodeId;
  const roles: Record<string, string[]> = {};
  entries.forEach(entry => {
    const concepts = [...new Set(entry.ids.flatMap(id => id === targetNodeId ? ['movement.landing']
      : id === sourceNodeId ? ['movement.source', ...(witnessNodeId === sourceNodeId ? ['movement.witness'] : [])]
      : id === witnessNodeId ? ['movement.witness'] : []))];
    if (entry.ids.length && concepts.length && entry.ids.every(id => [sourceNodeId, targetNodeId, witnessNodeId].includes(id)))
      roles[normalizeKey(entry.key)] = concepts;
  });
  const priorAnchorKeys = Object.entries(relation.priorAnchors ?? {}).flatMap(([key, value]) => {
    const ids = (Array.isArray(value) ? value : [value]).map(String);
    return ids.length === 1 && ids[0] === displacement.priorSourceNodeId ? [key] : [];
  });
  return {
    priorSourceNodeId: displacement.priorSourceNodeId,
    sourceNodeId, targetNodeId, witnessNodeId,
    trajectoryKind: displacement.trajectoryKind!,
    transition: true,
    roles,
    ...(priorAnchorKeys.length ? { priorAnchorKeys } : {})
  };
};

export interface StructuralStageMovement {
  /** Relation index -> the displacement its anchors prove, for a claim whose
   * wording proves no movement and whose displacement no worded claim of the
   * stage already recovers. Dispatch applies it only to a claim that wording
   * leaves wholly neutral. */
  movements: Map<number, RecoveredMovement>;
}

/** The structural reading Replay consults, or undefined while the switch is
 * off. Wording only breaks ties: when several claims name one
 * displacement and one of them already recovers it, that claim keeps it. */
export const readStructuralMovementForStages = (
  stages: readonly { workspaceForest?: SyntaxNode[]; relations?: DerivationStageRelation[] }[]
): StructuralStageMovement[] | undefined => {
  if (!structuralMovementEnabled()) return undefined;
  return readDerivationStructuralMovement(stages).map((ownership, stageIndex) => {
    const relations = stages[stageIndex].relations ?? [];
    const currentForest = stages[stageIndex].workspaceForest ?? [], priorForest = stageIndex ? stages[stageIndex - 1].workspaceForest ?? [] : [];
    const worded = relations.map(relation => recoverMovementEvidence(relation, currentForest, priorForest).movement);
    const wordedPairs = new Set(worded.flatMap(movement => movement ? [`${movement.sourceNodeId}\u0000${movement.targetNodeId}`] : []));
    const current = indexMovementOccurrences(currentForest);
    // A worded movement landing inside the displaced phrase or its lower
    // occurrence keeps its own moment, so that displacement stays neutral.
    const wordedLandings = worded.flatMap(movement => movement ? [movement.targetNodeId] : []);
    const holdsWordedLanding = (displacement: StructuralDisplacement) => [displacement.targetNodeId, displacement.sourceNodeId]
      .some(id => wordedLandings.some(landing => landing !== id && containsOccurrence(current.nodes.get(id)!, landing)));
    const movements = new Map<number, RecoveredMovement>();
    ownership.owners.forEach((displacementIndex, relationIndex) => {
      const displacement = ownership.displacements[displacementIndex];
      if (worded[relationIndex] || wordedPairs.has(`${displacement.sourceNodeId}\u0000${displacement.targetNodeId}`)
        || holdsWordedLanding(displacement)) return;
      movements.set(relationIndex, structuralRecoveredMovement(relations[relationIndex], displacement, currentForest, normalizeTier2Synonym));
    });
    return { movements };
  });
};
