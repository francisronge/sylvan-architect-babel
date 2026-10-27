import type { DerivationStageRelation, SyntaxNode } from '../../types.ts';
import { readCategoryLabel } from '../categoryLabel.ts';
import { type BareProjections, readBareProjections } from '../projectionStructure.ts';
import { isMovementIdentity, movementIdentityKind } from './movementIdentities.ts';
import {
  containsOccurrence as contains,
  indexMovementOccurrences,
  hasMovementPriorIdentity,
  sameMovementSourceSlot,
  retainedSourceContainer,
  sourceOccurrencePair,
  resolveMovementSourceAnchors
} from './movementSourceEvidence.ts';
import { hasUnestablishedCovertMovementOutcome } from './outcomeResolver.ts';
import {
  buildTier2SynonymIndex,
  isCovertMovementDescription,
  isUnestablishedCovertMovementDescription,
  normalizeTier2Synonym,
  relationRoleConcepts
} from './tier2Synonyms.ts';

export interface RecoveredMovement {
  /** The actual preceding occurrence; its ID may persist at either current endpoint. */
  priorSourceNodeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  witnessNodeId: string;
  trajectoryKind: 'head' | 'phrasal';
  transition: boolean;
  roles: Record<string, string[]>;
  /** Exact prior fields whose occurrences were verified for this movement. */
  priorAnchorKeys?: string[];
  /** Verified preceding containers or carried members remain context, not source occurrences. */
  priorContextKeys?: string[];
  /** Exact authored fields verified as structural context, not extra dependencies. */
  context?: Array<{ key: string; nodeId: string; kind: MovementContextKind }>;
  /** A head landing's enclosing complex when structure, not category notation,
   * proved the adjunction. Its labels cannot prove it again later, so landing
   * persistence takes the site from here. */
  structuralHeadComplexNodeId?: string;
}

type MovementContextKind = 'site' | 'head-host' | 'head-complex' | 'head-landing' | 'head-member';

const headCategory = (node: SyntaxNode): string => readCategoryLabel(node.label)?.head ?? '';
/** Whether two labels name the same head: a complex and its host, a head and
 * its projection, or two occurrences of one head. A compound label names each
 * member it bundles, in either order ("v+T", "T+v"), so a complex spelled by
 * its members still names its host; simple labels match exactly. */
const sharesHeadCategory = (left: SyntaxNode | undefined, right: SyntaxNode | undefined): boolean => {
  const members = readCategoryLabel(right?.label)?.members ?? [];
  return Boolean(readCategoryLabel(left?.label)?.members.some(member => members.includes(member)));
};
const sameAuthoredValue = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length
    && left.every((value, index) => sameAuthoredValue(value, right[index]));
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(right)) return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key =>
    Object.hasOwn(b, key) && sameAuthoredValue(a[key], b[key]));
};
const onlyExponents = (node: SyntaxNode): boolean => !node.children?.length || node.children.every(child => !child.children?.length);
const uniqueNode = (forest: readonly SyntaxNode[], id: string): SyntaxNode | undefined => {
  const matches: SyntaxNode[] = [];
  const visit = (node: SyntaxNode) => { if (node.id === id) matches.push(node); node.children?.forEach(visit); };
  forest.forEach(visit);
  return matches.length === 1 ? matches[0] : undefined;
};
const headMemberPath = (root: SyntaxNode, memberId: string): number[] | undefined => {
  if (readCategoryLabel(root.label)?.kind !== 'head') return;
  if (root.id === memberId) return [];
  for (const [index, child] of (root.children ?? []).entries()) {
    const tail = headMemberPath(child, memberId);
    if (tail) return [index, ...tail];
  }
};
const memberAtPath = (root: SyntaxNode, path: readonly number[]): SyntaxNode | undefined => {
  let member: SyntaxNode | undefined = root;
  for (const index of path) member = member?.children?.[index];
  return member;
};
export const readsAsProjection = (node: SyntaxNode): boolean => ['bar', 'phrase'].includes(readCategoryLabel(node.label)?.kind ?? '');
// Explicit zero-level notation, which may be followed by an annotation.
const HEAD_NOTATION = /^([A-Za-z\p{Script=Greek}]+)(?:_[A-Za-z][A-Za-z0-9_-]*)?(?:⁰|°|\^?0)(?:\s*(?:\[|:|\(|,)|$)/u;
const notatedHeads = (label?: string): string[] | undefined => {
  const shape = readCategoryLabel(label), notated = HEAD_NOTATION.exec(label ?? '')?.[1];
  return shape ? shape.kind === 'head' ? shape.members : undefined : notated ? [notated] : undefined;
};

/** Head adjunction read from structure when labels are prose, such as
 * "Honorific head: complex": a new parent holds only the landing and one
 * unchanged terminal host, in that host's exact preceding slot. When every
 * label reads as category notation, the notation decides instead; no label
 * may read as a projection, and explicit parent and host heads must share a
 * member.
 * A phrase can take the same shape beside a bare head, so callers also need
 * an explicitly anchored receiving head or complex. */
const adjoinsHostInPlace = (parent: SyntaxNode, landingId: string, workspaces?: MovementWorkspaces): boolean => {
  const landing = parent.children?.find(node => node.id === landingId);
  const siblings = (parent.children || []).filter(node => node.id !== landingId);
  if (!workspaces || !landing || siblings.length !== 1) return false;
  const host = siblings[0], { current, prior } = workspaces, before = prior.nodes.get(host.id);
  const involved = [parent, landing, host];
  const [parentHeads, hostHeads] = [notatedHeads(parent.label), notatedHeads(host.label)];
  return Boolean(before) && !host.children?.length && !prior.nodes.has(parent.id)
    && involved.some(node => !readCategoryLabel(node.label)) && !involved.some(readsAsProjection)
    && (!parentHeads || !hostHeads || parentHeads.some(head => hostHeads.includes(head)))
    && !(landing.lineageId && host.lineageId === landing.lineageId)
    && ![parent.id, host.id].some(id => current.duplicates.has(id) || prior.duplicates.has(id))
    && sameAuthoredValue(before, host) && sameMovementSourceSlot(current, prior, parent.id, host.id);
};

const isHeadComplex = (parent: SyntaxNode, landingId: string, previous: readonly SyntaxNode[] = []): boolean => {
  const landing = parent.children?.find(node => node.id === landingId);
  const siblings = (parent.children || []).filter(node => node.id !== landingId);
  const containsLowerOccurrence = (node: SyntaxNode): boolean => Boolean(landing?.lineageId
    && node.id !== landing.id && node.lineageId === landing.lineageId)
    || Boolean(node.children?.some(containsLowerOccurrence));
  // A complex may bear its host's word as its label ("helpen" over
  // [V helpen]), as projections of word-labelled heads do.
  const namesHost = siblings.length === 1 && !siblings[0].children?.length && Boolean(siblings[0].word?.trim())
    && String(parent.label ?? '').trim() === siblings[0].word!.trim();
  if (readCategoryLabel(parent.label)?.kind !== 'head' && !namesHost || readCategoryLabel(landing?.label)?.kind !== 'head') return false;
  if (parent.children?.length === 1 && parent.children[0].id === landingId) {
    const landing = parent.children[0];
    return readCategoryLabel(landing.label)?.kind === 'head' && onlyExponents(landing);
  }
  if (siblings.length === 1 && readCategoryLabel(siblings[0].label)?.kind === 'head'
    && (sharesHeadCategory(siblings[0], parent) || namesHost)) {
    // A previously built host remains the same head when another head adjoins;
    // its internal clitic or inflection structure need not be flat.
    if (onlyExponents(siblings[0])) return true;
    // A bare-labelled clause can also persist unchanged. When it contains the
    // lower occurrence, its identity does not establish a separate head host.
    return !containsLowerOccurrence(siblings[0])
      && JSON.stringify(uniqueNode(previous, siblings[0].id)) === JSON.stringify(siblings[0]);
  }
  const before = uniqueNode(previous, parent.id);
  // A retained head may acquire a moved member beside its unchanged authored
  // head contents. The receiver identity and ordered contents establish the
  // host without requiring those contents to repeat the receiver category.
  return siblings.length > 0 && readCategoryLabel(landing?.label)?.kind === 'head'
    && siblings.every(node => !['bar', 'phrase'].includes(readCategoryLabel(node.label)?.kind ?? '')
      && !node.children?.length && !containsLowerOccurrence(node))
    && Boolean(before && readCategoryLabel(before.label)?.kind === 'head'
      && sharesHeadCategory(before, parent)
      && sameAuthoredValue(before.children, siblings));
};

type MovementOccurrences = ReturnType<typeof indexMovementOccurrences>;
export type MovementWorkspaces = { current: MovementOccurrences; prior: MovementOccurrences };

const bareReaders = new WeakMap<MovementOccurrences, BareProjections | null>();
const bareProjectionsOf = (occurrences: MovementOccurrences): BareProjections | undefined => {
  if (!bareReaders.has(occurrences)) bareReaders.set(occurrences, readBareProjections(
    [...occurrences.nodes.values()].filter(node => !occurrences.parents.has(node.id))) ?? null);
  return bareReaders.get(occurrences) ?? undefined;
};
/** Bare labels (T for TP, T′ and T) leave the landing's level to structure.
 * A landing beside a branching projection of its parent's head, a specifier,
 * moved as a phrase; any other landing is left to the head evidence below.
 * X-bar notation states the level instead, so this reads nothing there. */
// A terminal spelling only its word, as X-bar writes under a head ("did").
const isWordTerminal = (node: SyntaxNode): boolean => !node.children?.length
  && Boolean(node.word?.trim()) && node.word!.trim() === String(node.label ?? '').trim();
const isBareSpecifier = (target: SyntaxNode, workspaces?: MovementWorkspaces): boolean => {
  const bare = workspaces && bareProjectionsOf(workspaces.current), parent = bare?.parent(target);
  if (!bare || !parent || workspaces!.current.nodes.get(target.id) !== target) return false;
  const sisters = (parent.children ?? []).filter(child => child !== target);
  return bare.maximal(target) && sisters.length === 1 && bare.projects(sisters[0], parent) && !bare.minimal(sisters[0]);
};
/** A one-word landing beside the head that projects its parent ([V buy what])
 * may have adjoined to that head or be its complement. Head adjunction leaves
 * the lower occurrence in the tree of the complex it forms; a landing whose
 * every other occurrence lies in another workspace moved sideward into this
 * one, and the head selected it as a phrase. */
const isSidewardComplement = (target: SyntaxNode, workspaces?: MovementWorkspaces): boolean => {
  const bare = workspaces && bareProjectionsOf(workspaces.current), parent = bare?.parent(target);
  const { current } = workspaces ?? {};
  if (!bare || !parent || !current || current.nodes.get(target.id) !== target || target.children?.length
    || !target.lineageId || current.duplicates.has(target.id)) return false;
  const sisters = (parent.children ?? []).filter(child => child !== target);
  if (sisters.length !== 1 || !bare.projects(sisters[0], parent) || !bare.minimal(sisters[0])) return false;
  let root = target;
  while (current.parents.get(root.id)) root = current.parents.get(root.id)!;
  const lower = [...current.nodes.values()].filter(node => node.lineageId === target.lineageId && node.id !== target.id);
  return lower.length > 0 && lower.every(node => !contains(root, node.id));
};

const isProjectedHead = (parent: SyntaxNode, target: SyntaxNode, before?: SyntaxNode,
  workspaces?: MovementWorkspaces): boolean => {
  const targetCategory = readCategoryLabel(target.label), parentCategory = readCategoryLabel(parent.label);
  if (targetCategory?.kind !== 'head' || !parentCategory || !sharesHeadCategory(target, parent)) return false;
  const sisters = (parent.children ?? []).filter(child => child.id !== target.id);
  if (parentCategory.kind !== 'head') return onlyExponents(target)
    && sisters.every(child => ['bar', 'phrase'].includes(readCategoryLabel(child.label)?.kind ?? ''));
  // Bare labels do not distinguish a projecting node from its lexical head.
  // A new matching parent is a head projection only when its other child is
  // the preceding complement, unchanged except for the proved lower occurrence.
  // The head carries its word itself or, in a forest written wholly in bare
  // labels, over a single terminal ("C" over "did").
  const preterminals = Boolean(workspaces && bareProjectionsOf(workspaces.current) && bareProjectionsOf(workspaces.prior));
  const lexical = (node: SyntaxNode) => !node.children?.length ? Boolean(node.word?.trim())
    : preterminals && node.children.length === 1 && isWordTerminal(node.children[0]);
  if (!workspaces || !before || parentCategory.compound || sisters.length !== 1
    || !lexical(target) || !lexical(before)
    || readCategoryLabel(before.label)?.kind !== 'head') return false;
  const { current, prior } = workspaces, complement = sisters[0];
  if (current.duplicates.has(parent.id) || current.duplicates.has(complement.id)
    || prior.nodes.has(parent.id) || prior.nodes.has(target.id) && target.id !== before.id
    || !complement.children?.length || prior.duplicates.has(complement.id)) return false;
  const oldComplement = prior.nodes.get(complement.id);
  if (!oldComplement || !contains(oldComplement, before.id)) return false;
  const complementIds: string[] = [];
  const collect = (node: SyntaxNode) => { complementIds.push(node.id); node.children?.forEach(collect); };
  collect(complement);
  const pair = sourceOccurrencePair(current, prior, before.id, [target.id, ...complementIds]);
  if (!pair || pair.landing.id !== target.id || !contains(complement, pair.source.id)) return false;
  // A constituent that left the complement in the same stage, with its lineage
  // now pronounced outside it, leaves its own lower occurrence in its slot.
  const movedOut = (node: SyntaxNode, old: SyntaxNode) => Boolean(old.lineageId) && node.lineageId === old.lineageId
    && !contains(node, pair.source.id)
    && [...current.nodes.values()].some(other => other.lineageId === old.lineageId && !contains(complement, other.id));
  const retained = (node: SyntaxNode, old: SyntaxNode): boolean => {
    if (node.id === pair.source.id && old.id === before.id) return true;
    if (movedOut(node, old)) return true;
    if (current.duplicates.has(node.id) || prior.duplicates.has(old.id)) return false;
    const { children = [], ...fields } = node, { children: oldChildren = [], ...oldFields } = old;
    return sameAuthoredValue(fields, oldFields) && children.length === oldChildren.length
      && children.every((child, index) => retained(child, oldChildren[index]));
  };
  return retained(complement, oldComplement);
};

type PriorSourcePosition = { node?: SyntaxNode; parent?: SyntaxNode };

// A nested head assembly retains a matching head host at each branching level.
// Merely having bare labels throughout a clause does not satisfy that shape.
export const isHeadAssembly = (node: SyntaxNode): boolean => {
  if (readCategoryLabel(node.label)?.kind !== 'head') return false;
  const children = node.children ?? [];
  return children.every(isHeadAssembly) && (children.length < 2
    || children.some(child => sharesHeadCategory(child, node)));
};

const hasAssembledMemberWitness = (source: SyntaxNode, sisters: readonly SyntaxNode[]): boolean => {
  if (!source.children?.length || !sisters.length || !isHeadAssembly(source)) return false;
  const nodes = (root: SyntaxNode): SyntaxNode[] => [root, ...(root.children ?? []).flatMap(nodes)];
  const members = (source.children ?? []).flatMap(nodes), lower = sisters.flatMap(nodes);
  return members.some(member => member.lineageId && member.lineageId !== source.lineageId
    && members.filter(other => other.lineageId === member.lineageId).length === 1
    && lower.some(witness => witness.id !== member.id && witness.lineageId === member.lineageId
      && readCategoryLabel(witness.label)?.kind === 'head' && sharesHeadCategory(witness, member)));
};

export const landingKind = (target: SyntaxNode, parent?: SyntaxNode, previous: readonly SyntaxNode[] = [],
  priorSource: PriorSourcePosition = {}, workspaces?: MovementWorkspaces,
  headContext = false, structuralHost = false): 'head' | 'phrasal' | undefined => {
  const shape = readCategoryLabel(target.label);
  const oldShape = readCategoryLabel(priorSource.node?.label), oldParent = readCategoryLabel(priorSource.parent?.label);
  // A flat receiving head also selects ordinary phrases. A branching bare
  // occurrence therefore needs its own head evidence, not just that sister:
  // explicit head notation/material or its preceding projected head slot.
  // Bare projections can establish that slot too. A prior member/lower-copy
  // pair proves an existing assembly even for an intransitive complement or a
  // nested head; otherwise the flat head needs a branching complement.
  const oldSisters = priorSource.parent?.children?.filter(child => child.id !== priorSource.node?.id) ?? [];
  const projectedSource = oldShape?.kind === 'head' && sharesHeadCategory(priorSource.node, priorSource.parent)
    && (oldParent?.kind !== 'head'
      ? oldSisters.every(child => ['bar', 'phrase'].includes(readCategoryLabel(child.label)?.kind ?? ''))
      : Boolean(priorSource.node && (hasAssembledMemberWitness(priorSource.node, oldSisters)
        || onlyExponents(priorSource.node) && oldSisters.length
          && oldSisters.every(child => child.children?.length && headCategory(child) && !sharesHeadCategory(child, priorSource.node)))));
  // Bare nominal phrases can share this assembly shape. Only an explicitly
  // anchored, verified receiving head licenses the additional head reading.
  const headUnit = !target.children?.length || Boolean(target.word?.trim()) || shape?.compound
    || Boolean(headContext && priorSource.node?.children?.length && sharesHeadCategory(priorSource.node, target)
      && isHeadAssembly(priorSource.node) && isHeadAssembly(target))
    || HEAD_NOTATION.test(target.label) || projectedSource;
  // An explicitly anchored receiving head or complex still proves adjunction.
  if (parent && (isBareSpecifier(target, workspaces)
    || !headContext && !structuralHost && isSidewardComplement(target, workspaces))) return 'phrasal';
  if (headUnit && parent && (isHeadComplex(parent, target.id, previous)
    || structuralHost && adjoinsHostInPlace(parent, target.id, workspaces)
    || isProjectedHead(parent, target, priorSource.node, workspaces))) return 'head';
  const specifier = parent?.children?.some(n => n.id !== target.id && projectsParent(n, parent) && !onlyExponents(n));
  if (target.children?.length || shape?.kind === 'phrase' || specifier) return 'phrasal';
};

/** Whether `node` is the daughter whose label its parent repeats: the same
 * head category or, for labels that are not category notation (a lexical
 * item, "洗" over "洗", or prose, "T-projection"), the same exact label. */
const projectsParent = (node: SyntaxNode, parent: SyntaxNode): boolean => {
  const category = readCategoryLabel(parent.label), text = String(parent.label ?? '').trim();
  return category ? headCategory(node) === category.head
    : Boolean(text) && !readCategoryLabel(node.label) && String(node.label ?? '').trim() === text;
};

/** Shared exact structural check for Tier 1 and recovered movement context. */
export const movementContextFailure = (
  forest: readonly SyntaxNode[], landingId: string, contextId: string, kind: MovementContextKind,
  previous: readonly SyntaxNode[] = [], sourceId?: string, hostWorkspaces?: MovementWorkspaces
): string | undefined => {
  const nodes: SyntaxNode[] = [];
  const visit = (node: SyntaxNode) => { nodes.push(node); (node.children || []).forEach(visit); };
  forest.forEach(visit);
  const landing = nodes.filter(node => node.id === landingId);
  const context = nodes.filter(node => node.id === contextId);
  if (landing.length !== 1 || context.length !== 1) return 'landing-or-context-id-missing-or-ambiguous';
  if (kind === 'head-member') return headMemberPath(landing[0], contextId)?.length
    ? undefined : 'not-a-contained-head-member';
  const parents = nodes.filter(node => node.children?.includes(landing[0]));
  const parent = parents.length === 1 ? parents[0] : undefined;
  if (!parent || nodes.filter(node => node.id === parent.id).length !== 1) return 'landing-parent-missing-or-ambiguous';
  const isParent = parent === context[0];
  if (kind === 'site') {
    // A phrase lands in its parent by merging with its one sister; either
    // names the landing site.
    if (isParent || parent.children?.length === 2 && context[0] !== landing[0] && parent.children.includes(context[0])) return;
    // A topic/edge shell may intervene between the moved occurrence and its
    // landing domain. Only the nearest common domain of the proved endpoints
    // establishes that context; an arbitrary containing ancestor does not.
    let domain: SyntaxNode | undefined = parent;
    if (sourceId && nodes.filter(node => node.id === sourceId).length === 1) {
      while (domain && !contains(domain, sourceId)) {
        if (nodes.filter(node => node.id === domain!.id).length !== 1) return 'landing-path-id-ambiguous';
        const ancestors = nodes.filter(node => node.children?.includes(domain!));
        domain = ancestors.length === 1 ? ancestors[0] : undefined;
      }
      if (domain === context[0]) return;
    }
    return 'not-the-immediate-landing-parent';
  }
  // Callers pass `hostWorkspaces` only for an explicitly anchored receiving
  // head or complex, which the prose-label structural reading requires.
  if (!isHeadComplex(parent, landingId, previous) && !adjoinsHostInPlace(parent, landingId, hostWorkspaces))
    return 'landing-is-not-in-a-supported-head-complex';
  const isHost = context[0] !== landing[0] && Boolean(parent.children?.includes(context[0]));
  const valid = kind === 'head-complex' ? isParent : kind === 'head-host' ? isHost : isParent || isHost;
  return valid ? undefined : 'not-the-landing-host-or-complex';
};

export interface MovementEvidenceResult {
  movement?: RecoveredMovement;
  /** Machine-readable refusal; consumers must not reinterpret diagnostic prose. */
  failure?: string;
  diagnostics: string[];
}

const vocabulary = buildTier2SynonymIndex();
const hasRole = (key: string, concept: string) => relationRoleConcepts(vocabulary, key).includes(concept);
/** The position an authored receiving-head or head-complex field must occupy
 * beside a head landing; a plain host may be either the host or the complex. */
const headContextKind = (key: string): MovementContextKind | undefined => hasRole(key, 'movement.complex') ? 'head-complex'
  : hasRole(key, 'movement.host') ? ['landing head', 'receiving head'].includes(key) ? 'head-landing' : 'head-host'
  : key === 'host' ? 'head-landing' : undefined;
const genericRoles = new Set(['source', 'sources', 'origin', 'origins', 'from', 'target', 'targets', 'to', 'destination', 'destinations', 'landing', 'landings', 'landing site', 'landing sites', 'filler', 'fillers', 'operator', 'operators', 'head', 'heads', 'variable', 'variables', 'real gap', 'real gaps']);
/** Whether an occurrence new in this stage sits inside a new occurrence of a
 * phrase that existed before under another lineage and already contained an
 * occurrence of this one: the occurrence moved with that phrase. */
const carriedInMovedPhrase = (current: MovementOccurrences, prior: MovementOccurrences, id: string): boolean => {
  const node = current.nodes.get(id);
  if (!node?.lineageId || prior.nodes.has(id) || current.duplicates.has(id)) return false;
  let container = current.parents.get(id);
  while (container && !container.lineageId) container = current.parents.get(container.id);
  if (!container?.lineageId || container.lineageId === node.lineageId || prior.nodes.has(container.id)
    || current.duplicates.has(container.id)) return false;
  const holdsLineage = (phrase: SyntaxNode): boolean => Boolean(phrase.children?.some(child =>
    child.lineageId === node.lineageId || holdsLineage(child)));
  return [...prior.nodes.values()].some(before => before.lineageId === container!.lineageId && holdsLineage(before));
};
const sourceContainerRole = (key: string): boolean => /^(?:(?:prior|movement) )?(?:source|lower|base|intermediate) (?:[a-z]+ )?(?:clauses?|phrases?|constituents?|objects?|[a-z]+p)$/u.test(normalizeTier2Synonym(key));
const sourceComplexRole = (key: string): boolean => /^(?:(?:prior|movement) )?(?:source|lower|base|intermediate) (?:head )?complex$/u.test(normalizeTier2Synonym(key));
const landingContainerRole = (key: string): boolean => /^(?:movement )?(?:landing|target|higher|upper) (?:[a-z]+ )?(?:clauses?|phrases?|domains?)$/u.test(key);

// Recover occurrence identity from the anchored objects, never a shared descendant
// or the relation's title. The result is renderer evidence, not authored syntax.
export function recoverMovementEvidence(
  relation: DerivationStageRelation,
  forest: readonly SyntaxNode[],
  previous: readonly SyntaxNode[] = []
): MovementEvidenceResult {
  const fail = (code: string, reason: string): MovementEvidenceResult => ({ failure: code, diagnostics: [`${code}: ${reason}`] });
  const covertDescription = isCovertMovementDescription(relation.relation);
  const covertOutcomeUnestablished = covertDescription && hasUnestablishedCovertMovementOutcome(relation.values);
  if (isUnestablishedCovertMovementDescription(relation.relation) || covertOutcomeUnestablished)
    return fail('MOVEMENT_NOT_ESTABLISHED', 'The covert operation is denied or provisional; its endpoints do not establish an ordinary movement instead.');
  const current = indexMovementOccurrences(forest), prior = indexMovementOccurrences(previous);
  const samePriorSlot = (sourceId: string, priorId: string): boolean =>
    sameMovementSourceSlot(current, prior, sourceId, priorId);
  const entries = Object.entries(relation.anchors || {}).map(([key, value]) => ({
    authoredKey: key, key: normalizeTier2Synonym(key), ids: Array.isArray(value) ? value : [value]
  }));
  const pick = (concept: string) => [...new Set(entries.filter(e => hasRole(e.key, concept)).flatMap(e => e.ids))];
  const anchored = [...new Set(entries.filter(e => e.ids.length === 1).flatMap(e => e.ids))];
  const priorCarrierKeys = new Set<string>();
  let explicitPriorSources = [...new Set(Object.entries(relation.priorAnchors || {})
    .filter(([key]) => hasRole(key, 'movement.source'))
    .flatMap(([, value]) => Array.isArray(value) ? value : [value]))];
  // A lineage-free head container can identify a uniquely authored moving
  // member. Its exact lower slot and member lineage prove the carrier; the
  // container itself never inherits that identity.
  if (explicitPriorSources.length === 1) {
    const containerId = explicitPriorSources[0], container = prior.nodes.get(containerId);
    if (container && !container.lineageId && !prior.duplicates.has(containerId)
      && !current.duplicates.has(containerId) && readCategoryLabel(container.label)?.kind === 'head') {
      const carriers = pick('movement.landing').flatMap(id => {
        const member = prior.nodes.get(id), landing = current.nodes.get(id);
        const path = headMemberPath(container, id);
        if (!path?.length || !member?.lineageId || !landing || landing.lineageId !== member.lineageId
          || prior.duplicates.has(id) || current.duplicates.has(id)) return [];
        const lower = anchored.filter(lowerId => lowerId !== id && !current.duplicates.has(lowerId)
          && current.nodes.get(lowerId)?.lineageId === member.lineageId && samePriorSlot(lowerId, id));
        return lower.length === 1 ? [{ priorId: id, lowerId: lower[0] }] : [];
      });
      if (carriers.length === 1) {
        explicitPriorSources = [carriers[0].priorId];
        Object.entries(relation.priorAnchors ?? {}).forEach(([key, value]) => {
          const ids = Array.isArray(value) ? value : [value];
          if (ids.length === 1 && ids[0] === containerId && hasRole(key, 'movement.source')) priorCarrierKeys.add(key);
        });
      }
    }
  }
  // Containment does not identify the moving unit: a member may leave its
  // complex, or the whole complex may carry that member. Choose the uniquely
  // witnessed root pair first, then verify every additional prior participant.
  if (explicitPriorSources.length > 1) {
    const pairs = new Map(explicitPriorSources.map(id => [id, sourceOccurrencePair(current, prior, id, anchored)]));
    const occurrences = explicitPriorSources.filter(id => {
      const pair = pairs.get(id), before = prior.nodes.get(id);
      if (!pair || !before) return false;
      return explicitPriorSources.every(otherId => {
        if (otherId === id) return true;
        const path = headMemberPath(before, otherId), member = prior.nodes.get(otherId);
        if (path?.length && member?.lineageId && !prior.duplicates.has(otherId)) {
          const carried = memberAtPath(pair.landing, path);
          return Boolean(carried && !current.duplicates.has(carried.id)
            && carried.lineageId === member.lineageId && headMemberPath(pair.landing, carried.id)?.length);
        }
        const fields = Object.entries(relation.priorAnchors ?? {}).filter(([key, value]) => hasRole(key, 'movement.source')
          && [value].flat().includes(otherId));
        return !pairs.get(otherId) && fields.every(([key]) => sourceContainerRole(key)
          ? retainedSourceContainer(current, prior, otherId, id, pair.source.id, true)
          : sourceComplexRole(key) && movementContextFailure(previous, id, otherId, 'head-complex') === undefined);
      });
    });
    if (occurrences.length === 1) {
      Object.entries(relation.priorAnchors ?? {}).forEach(([key, value]) => {
        const ids = Array.isArray(value) ? value : [value];
        if (ids.length === 1 && ids[0] !== occurrences[0] && explicitPriorSources.includes(ids[0])) priorCarrierKeys.add(key);
      });
      explicitPriorSources = occurrences;
    }
  }
  let sources = pick('movement.source');
  let witnesses = pick('movement.witness');
  if (!sources.length) sources = witnesses;
  let targets = pick('movement.landing');
  const sourceMembers = new Set<string>(), landingMembers = new Set<string>();
  const phrasalHeadParticipants = new Set<string>();
  let structurallyBound = false;
  // An explicit preceding source distinguishes this step from earlier copies
  // in the same chain. Unchanged earlier copies remain separate evidence.
  let structuralPriorSources = [...new Set(Object.values(relation.priorAnchors || {}).flat())].filter(id => {
    const node = prior.nodes.get(id);
    return node?.lineageId && !prior.duplicates.has(id) && anchored.some(currentId =>
      current.nodes.get(currentId)?.lineageId === node.lineageId && samePriorSlot(currentId, id));
  });
  // A source phrase may contain the moving occurrence. It is context only
  // when a separate lineage-matched pair proves the exact preceding source
  // slot. Another occurrence or an unrelated phrase remains a competing source.
  const sourceContainerPresent = entries.some(e => sourceContainerRole(e.key))
    || Object.keys(relation.priorAnchors ?? {}).some(sourceContainerRole);
  const candidatePairs = (sourceContainerPresent ? [...new Set([...structuralPriorSources, ...anchored])] : []).flatMap(priorId => {
    const before = prior.nodes.get(priorId);
    if (!before?.lineageId || prior.duplicates.has(priorId)) return [];
    return anchored.filter(id => !current.duplicates.has(id) && current.nodes.get(id)?.lineageId === before.lineageId
      && samePriorSlot(id, priorId)).flatMap(sourceId => anchored.filter(targetId => {
      const target = current.nodes.get(targetId);
      return targetId !== sourceId && target?.lineageId === before.lineageId && !current.duplicates.has(targetId)
        && !contains(current.nodes.get(sourceId)!, targetId) && !contains(target, sourceId)
        && entries.some(e => e.ids.length === 1 && (e.ids[0] === targetId && hasRole(e.key, 'movement.landing')
          || landingContainerRole(e.key) && movementContextFailure(forest, targetId, e.ids[0], 'site', previous, sourceId) === undefined))
        && Boolean(landingKind(target, current.parents.get(targetId), previous, { node: before, parent: prior.parents.get(priorId) }, { current, prior }));
    }).map(targetId => ({ priorId, sourceId, targetId })));
  });
  // When the landing kept its ID and a new occurrence holds its preceding slot,
  // an older copy of the chain kept unchanged in its own slot is chain context:
  // it does not compete with the landing's own preceding occurrence as the source.
  const independentPairs = candidatePairs.filter(pair => !(pair.sourceId === pair.priorId
    && sameAuthoredValue(current.nodes.get(pair.sourceId), prior.nodes.get(pair.priorId))
    && candidatePairs.some(other => other.targetId === pair.targetId && other.priorId === other.targetId
      && other.sourceId !== pair.sourceId && !prior.nodes.has(other.sourceId))));
  if (independentPairs.length === 1) {
    const pair = independentPairs[0], lineage = prior.nodes.get(pair.priorId)!.lineageId;
    const containingSource = (id: string, sourceId: string, indexed: ReturnType<typeof indexMovementOccurrences>): boolean => {
      const container = indexed.nodes.get(id);
      return Boolean(container && id !== sourceId && !indexed.duplicates.has(id)
        && container.lineageId !== lineage && contains(container, sourceId));
    };
    explicitPriorSources = explicitPriorSources.filter(id => !containingSource(id, pair.priorId, prior)
      || Object.entries(relation.priorAnchors ?? {}).some(([key, value]) => hasRole(key, 'movement.source')
        && (Array.isArray(value) ? value : [value]).includes(id) && !sourceContainerRole(key)));
    structuralPriorSources = structuralPriorSources.filter(id => !containingSource(id, pair.priorId, prior));
    sources = sources.filter(id => !containingSource(id, pair.sourceId, current)
      || entries.some(e => hasRole(e.key, 'movement.source') && e.ids.includes(id) && !sourceContainerRole(e.key)));
    if (!sources.length) sources = witnesses;
  }
  // Moving an intact head assembly into an explicitly named receiving head
  // establishes its endpoints even when their authored field names are open.
  // Identity alone is insufficient: preserve every field and child, retain the
  // exact lower slot, and require a new, uniquely anchored adjunction landing.
  const hasPreservedHeadAdjunction = (priorId: string): boolean => {
    const before = prior.nodes.get(priorId);
    if (!before?.lineageId || !before.children?.length || !isHeadAssembly(before)
      || prior.duplicates.has(before.id)
      || !Object.values(relation.priorAnchors ?? {}).some(value =>
        (Array.isArray(value) ? value.length === 1 && value[0] === before.id : value === before.id))) return false;
    const uniqueMembers = (node: SyntaxNode): boolean => !prior.duplicates.has(node.id)
      && !current.duplicates.has(node.id) && (node.children ?? []).every(uniqueMembers);
    if (!before.children.every(uniqueMembers)) return false;
    const lower = anchored.filter(id => !current.duplicates.has(id)
      && current.nodes.get(id)?.lineageId === before.lineageId && samePriorSlot(id, before.id));
    if (lower.length !== 1) return false;
    const keys = Object.keys(before).filter(key => key !== 'id').sort();
    const landings = anchored.filter(id => {
      const target = current.nodes.get(id);
      if (!target || id === lower[0] || prior.nodes.has(id) || current.duplicates.has(id)
        || target.lineageId !== before.lineageId
        || JSON.stringify(Object.keys(target).filter(key => key !== 'id').sort()) !== JSON.stringify(keys)
        || keys.some(key => !sameAuthoredValue(before[key as keyof SyntaxNode], target[key as keyof SyntaxNode]))) return false;
      return entries.some(entry => {
        if (entry.ids.length !== 1) return false;
        const kind: MovementContextKind | undefined = hasRole(entry.key, 'movement.complex') ? 'head-complex'
          : hasRole(entry.key, 'movement.host')
            ? ['landing head', 'receiving head'].includes(entry.key) ? 'head-landing' : 'head-host' : undefined;
        return kind !== undefined && movementContextFailure(forest, id, entry.ids[0], kind, previous) === undefined;
      });
    });
    return landings.length === 1;
  };
  // A carried head can occupy a matching slot inside a renamed moving
  // assembly. Only the intact whole-head proof may make it prior context;
  // unrelated or explicitly competing source claims still remain ambiguous.
  const assembledSources = structuralPriorSources.filter(hasPreservedHeadAdjunction);
  if (assembledSources.length === 1) {
    const assembly = prior.nodes.get(assembledSources[0])!;
    structuralPriorSources = structuralPriorSources.filter(id => id === assembly.id
      || !headMemberPath(assembly, id)?.length);
  }
  // Current root endpoints can establish their preceding assembly without a
  // redundant prior anchor. Every other named source must be a carried head
  // member in the same ordered position, not a competing moving occurrence.
  if (!explicitPriorSources.length && !structuralPriorSources.length && sources.length > 1) {
    structuralPriorSources = sources.filter(id => {
      const before = prior.nodes.get(id), pair = sourceOccurrencePair(current, prior, id, anchored);
      if (!before || !isHeadAssembly(before) || !pair || pair.source.id !== id
        || !targets.includes(pair.landing.id)
        || landingKind(pair.landing, current.parents.get(pair.landing.id), previous,
          { node: before, parent: prior.parents.get(id) }, { current, prior }) !== 'head') return false;
      return sources.every(memberId => {
        if (memberId === id) return true;
        const path = headMemberPath(before, memberId), lower = path && memberAtPath(pair.source, path);
        const upper = path && memberAtPath(pair.landing, path), member = prior.nodes.get(memberId);
        return Boolean(path?.length && member?.lineageId && lower?.id === memberId
          && !prior.duplicates.has(memberId) && !current.duplicates.has(memberId)
          && upper && !current.duplicates.has(upper.id)
          && headMemberPath(pair.source, memberId)?.length && headMemberPath(pair.landing, upper.id)?.length
          && lower.lineageId === member.lineageId && upper.lineageId === member.lineageId);
      });
    });
  }
  // A moved occurrence can keep its ID without a prior anchor. When a claimed
  // landing has left its preceding slot and one anchored same-lineage
  // occurrence new in this stage holds that slot, the landing's own preceding
  // occurrence is the prior source. Only a claim that already names a source
  // or witness qualifies; earlier unchanged copies cannot compete as landings.
  const retainedLandingSources = !explicitPriorSources.length && !structuralPriorSources.length && sources.length
    ? targets.filter(id => {
      const pair = sourceOccurrencePair(current, prior, id, anchored);
      return pair?.landing.id === id && !prior.nodes.has(pair.source.id);
    }) : [];
  const priorSources = explicitPriorSources.length ? explicitPriorSources
    : structuralPriorSources.length ? structuralPriorSources : retainedLandingSources;
  const priorSource = priorSources.length === 1 ? priorSources[0] : undefined;
  // In a successive step, only the anchored occurrence occupying this source's
  // preceding slot is its new lower witness. Older copies stay separate evidence.
  const isEarlierChainOccurrence = (id: string): boolean => Boolean(priorSource && id !== priorSource
    && !current.duplicates.has(id) && !prior.duplicates.has(id)
    && current.nodes.get(id)?.lineageId === prior.nodes.get(priorSource)?.lineageId
    && sameAuthoredValue(current.nodes.get(id), prior.nodes.get(id)) && samePriorSlot(id, id));
  // Several trace fields may cite unchanged earlier copies beside the step's
  // new lower witness. Those copies do not compete with it. Only a lineage the
  // preceding source already declares identifies them: at a first copy every
  // other trace remains a competing witness.
  const priorSourceLineage = priorSource ? prior.nodes.get(priorSource)?.lineageId : undefined;
  const stepWitnesses = priorSourceLineage ? witnesses.filter(id => !isEarlierChainOccurrence(id)) : witnesses;
  if (witnesses.length > 1 && stepWitnesses.length === 1) {
    if (sources === witnesses) sources = stepWitnesses;
    witnesses = stepWitnesses;
  }
  const sourcePair = priorSource ? sourceOccurrencePair(current, prior, priorSource, anchored) : undefined;
  // The landing kept its ID and one new occurrence holds its preceding slot:
  // the step is structurally proved whatever the lower field is called.
  const retainedLandingHop = Boolean(sourcePair && sourcePair.landing.id === priorSource
    && targets.includes(sourcePair.landing.id) && !prior.nodes.has(sourcePair.source.id));
  const sourceContainers = anchored.filter(id => entries.filter(entry => entry.ids.includes(id)
    && hasRole(entry.key, 'movement.source')).every(entry => sourceContainerRole(entry.key)));
  const sourceAnchors = sourcePair && priorSource
    ? resolveMovementSourceAnchors(current, prior, priorSource, sourcePair.source,
      anchored, sources, witnesses, sourceContainers) : undefined;
  if (sourcePair && sourceAnchors) {
    sources = [sourcePair.source.id];
    witnesses = sourceAnchors.witnesses;
    structurallyBound = true;
  }

  // An asserted covert operation permits structural endpoint recovery without
  // prescribed participant names. The checks below still require shared root
  // lineage, an exact preceding source slot and a distinct new landing.
  const canBindStructuralEndpoints = isMovementIdentity(relation.relation) || covertDescription
    || explicitPriorSources.length === 1
    || structuralPriorSources.length === 1 && entries.some(e => e.key === 'landing' && e.ids.length === 1)
    || entries.some(e => !genericRoles.has(e.key) && ['movement.source', 'movement.witness', 'movement.landing'].some(concept => hasRole(e.key, concept)))
    || Boolean(priorSource && hasPreservedHeadAdjunction(priorSource));
  // A proved preceding complex fixes the moving unit. Its explicitly anchored
  // lexical member can describe the lower copy without becoming a competing
  // whole source. Every member must retain its exact position and lineage.
  if (priorSource && sources.includes(priorSource)
    && samePriorSlot(priorSource, priorSource)) {
    const before = prior.nodes.get(priorSource), lower = current.nodes.get(priorSource);
    const sameMember = (id: string) => {
      if (!before || !lower || prior.duplicates.has(id) || current.duplicates.has(id)) return false;
      const oldPath = headMemberPath(before, id), newPath = headMemberPath(lower, id);
      return Boolean(oldPath?.length && newPath?.length && JSON.stringify(oldPath) === JSON.stringify(newPath)
        && prior.nodes.get(id)?.lineageId && prior.nodes.get(id)?.lineageId === current.nodes.get(id)?.lineageId);
    };
    if (sources.every(id => id === priorSource || sameMember(id))) {
      sources.filter(id => id !== priorSource).forEach(id => sourceMembers.add(id));
      sources = [priorSource];
      structurallyBound = true;
    }
  }
  const onlyEarlierChainSources = sources.length > 0 && sources.every(isEarlierChainOccurrence);
  if (priorSource && (!sources.length ? canBindStructuralEndpoints
    : onlyEarlierChainSources && (canBindStructuralEndpoints || retainedLandingHop))) {
    const lower = anchored.filter(id => current.nodes.get(id)?.lineageId
      && current.nodes.get(id)?.lineageId === prior.nodes.get(priorSource)?.lineageId && samePriorSlot(id, priorSource));
    if (lower.length === 1) {
      sources = lower;
      structurallyBound = true;
    }
  }
  // A preceding source can name the same current occurrence directly. Resolve
  // it before distinguishing the landing occurrence from its containing site.
  if (!sources.length && !entries.some(e => hasRole(e.key, 'movement.source') || hasRole(e.key, 'movement.witness'))
    && priorSource && samePriorSlot(priorSource, priorSource)) sources = [priorSource];
  if (priorSource && anchored.includes(priorSource) && samePriorSlot(priorSource, priorSource)
    && sources.every(id => id === priorSource || (current.nodes.get(id)?.lineageId === prior.nodes.get(priorSource)?.lineageId
      && prior.nodes.has(id) && JSON.stringify(current.nodes.get(id)) === JSON.stringify(prior.nodes.get(id))))) {
    sources = [priorSource];
    structurallyBound = true;
  }
  // An anchored landing site may name the immediate parent, while another
  // scalar field names the moved occurrence. Root identity and containment
  // distinguish them without interpreting that other field's spelling.
  if (sources.length === 1 && targets.length && entries.filter(e => hasRole(e.key, 'movement.landing'))
    .every(e => e.ids.length === 1)) {
    const lineage = current.nodes.get(sources[0])?.lineageId;
    const matchingLandingMember = (rootId: string, memberId: string): boolean => {
      const root = current.nodes.get(rootId), source = current.nodes.get(sources[0]);
      const before = prior.nodes.get(priorSource ?? '');
      if (!root || !source || !before || current.duplicates.has(rootId) || current.duplicates.has(memberId)
        || prior.duplicates.has(before.id) || !root.lineageId || root.lineageId !== before.lineageId) return false;
      const path = headMemberPath(root, memberId);
      if (!path?.length) return false;
      const oldMember = memberAtPath(before, path), lowerMember = memberAtPath(source, path);
      const member = current.nodes.get(memberId);
      const lowerMemberMatches = lowerMember?.lineageId === oldMember?.lineageId
        && lowerMember && !current.duplicates.has(lowerMember.id) && headMemberPath(source, lowerMember.id)?.length;
      // An authored trace can stand for the whole complex without copying its
      // internal heads. The exact prior root pair and unchanged carried member
      // then provide the evidence that a lower member copy would have supplied.
      const wholeHeadTrace = !source.children?.length && sourcePair?.source.id === source.id
        && sourcePair.landing.id === rootId && [before, source, root].every(node => readCategoryLabel(node.label)?.kind === 'head')
        && oldMember && member && sameAuthoredValue({ ...oldMember, id: member.id }, member);
      return Boolean(oldMember?.lineageId && member?.lineageId === oldMember.lineageId
        && !prior.duplicates.has(oldMember.id) && headMemberPath(before, oldMember.id)?.length
        && (lowerMemberMatches || wholeHeadTrace));
    };
    // A phrase's target head may remain in place or project beside the landing.
    // Leave that field unclaimed after proving the phrase's lineage and exact
    // preceding slot; it establishes no additional movement endpoint. A branching
    // head qualifies only as a complex that earlier head movement built, such as
    // T after verb raising: an adjoined member whose lineage also occurs outside
    // it, beside the retained host. Bare labels alone may spell a phrase.
    const isMovedHeadComplex = (complex: SyntaxNode): boolean => (complex.children ?? []).some(member =>
      Boolean(member.lineageId) && !current.duplicates.has(member.id)
      && [...current.nodes.values()].some(node => node.lineageId === member.lineageId && !contains(complex, node.id))
      && isHeadComplex(complex, member.id, previous));
    const isHeadParticipantRole = (key: string): boolean => key === 'target' || key === 'head'
      || /^(?:movement )?(?:target|landing|higher|upper|raised|moved) (?:[a-z]+ )*head$/.test(key);
    // The exact preceding root pair can identify an openly named landing even
    // when the directional field names its parent rather than the occurrence.
    const identifiesLanding = (id: string): boolean => targets.includes(id)
      || sourcePair?.source.id === sources[0] && sourcePair.landing.id === id;
    const isPhrasalHeadParticipant = (occurrence: string, id: string): boolean => {
      const target = current.nodes.get(occurrence), head = current.nodes.get(id);
      const precedingId = prior.nodes.has(sources[0]) ? sources[0] : priorSource;
      const before = prior.nodes.get(precedingId ?? '');
      const projectsBesideLanding = (): boolean => {
        if (!head) return false;
        const parent = current.parents.get(occurrence);
        if (!parent || current.duplicates.has(parent.id) || parent.children?.length !== 2
          || !sharesHeadCategory(parent, head)) return false;
        let projection = parent.children.find(child => child.id !== occurrence);
        while (projection && !current.duplicates.has(projection.id) && sharesHeadCategory(projection, head)) {
          if (projection.id === id) return true;
          const spine = projection.children?.filter(child => sharesHeadCategory(child, head)) ?? [];
          if (spine.length !== 1) return false;
          projection = spine[0];
        }
        return false;
      };
      const precedingHead = prior.nodes.get(id);
      const landingParent = current.parents.get(occurrence);
      return Boolean(target && head && identifiesLanding(occurrence)
        && !current.duplicates.has(id) && !prior.duplicates.has(id)
        && !current.duplicates.has(sources[0]) && !current.duplicates.has(occurrence)
        && before?.lineageId && before.lineageId === lineage && !prior.duplicates.has(before.id)
        && precedingId && samePriorSlot(sources[0], precedingId)
        && landingKind(target, current.parents.get(occurrence), previous, { node: before, parent: prior.parents.get(precedingId ?? '') }, { current, prior }) === 'phrasal'
        && readCategoryLabel(head.label)?.kind === 'head'
        && (!head.children?.length || isMovedHeadComplex(head) && !contains(head, sources[0]) && !contains(head, occurrence))
        && head.lineageId !== lineage
        && landingParent && contains(landingParent, id)
        && (!precedingHead || sameAuthoredValue(precedingHead, head))
        && (precedingHead && samePriorSlot(id, id) || projectsBesideLanding())
        && entries.some(e => e.ids.length === 1 && e.ids[0] === id && isHeadParticipantRole(e.key))
        && entries.filter(e => e.ids.includes(id) && hasRole(e.key, 'movement.landing'))
          .every(e => e.ids.length === 1 && isHeadParticipantRole(e.key)));
    };
    const occurrences = anchored.filter(id => id !== sources[0] && lineage
      && current.nodes.get(id)?.lineageId === lineage).filter(occurrence => targets.every(id => id === occurrence
        || (targets.includes(occurrence) && current.nodes.has(id) && contains(current.nodes.get(id)!, occurrence))
        || (sourcePair?.landing.id === occurrence && entries.filter(e => e.ids.includes(id)
          && hasRole(e.key, 'movement.landing')).every(e => landingContainerRole(e.key))
          && movementContextFailure(forest, occurrence, id, 'site', previous, sources[0]) === undefined)
        || (targets.includes(occurrence) && entries.some(e => e.key === 'operator' && e.ids[0] === id)
          && entries.some(e => e.ids[0] === occurrence && !genericRoles.has(e.key) && hasRole(e.key, 'movement.landing'))
          && contains(current.nodes.get(occurrence)!, id))
        || (targets.includes(occurrence) && matchingLandingMember(occurrence, id))
        || isPhrasalHeadParticipant(occurrence, id)
        || movementContextFailure(forest, occurrence, id, 'site', previous) === undefined
        || movementContextFailure(forest, occurrence, id, 'head-landing', previous) === undefined));
    if (occurrences.length === 1) {
      targets.filter(id => matchingLandingMember(occurrences[0], id)).forEach(id => landingMembers.add(id));
      entries.filter(e => e.ids.length === 1 && isHeadParticipantRole(e.key)
        && isPhrasalHeadParticipant(occurrences[0], e.ids[0])).forEach(e => phrasalHeadParticipants.add(e.authoredKey));
      structurallyBound ||= targets.length !== 1 || targets[0] !== occurrences[0];
      targets = occurrences;
    }
  }
  // An explicitly anchored receiving head or complex verified around a landing.
  const namesHeadContext = (landingId: string): boolean => entries.some(entry => entry.ids.length === 1
    && (hasRole(entry.key, 'movement.host') || hasRole(entry.key, 'movement.complex') || entry.key === 'host')
    && movementContextFailure(forest, landingId, entry.ids[0],
      hasRole(entry.key, 'movement.complex') ? 'head-complex' : 'head-landing', previous) === undefined);
  // The prose-label structural reading needs the receiving head or complex
  // named explicitly, in the role that the context check below verifies. A
  // phrasal attractor names no adjunction host.
  const namesStructuralHost = (landingId: string): boolean => entries.some(entry => {
    const contextKind = headContextKind(entry.key);
    return entry.ids.length === 1 && entry.key !== 'attracting head' && contextKind !== undefined
      && movementContextFailure(forest, landingId, entry.ids[0], contextKind, previous, undefined, { current, prior }) === undefined;
  });
  // Unfamiliar wording still needs explicit movement direction or an established
  // identity, plus exact anchored occurrences and a changed preceding source slot.
  // A landing's kind reads the same receiving-head evidence as a named landing's.
  if ((sources.length === 0 || targets.length === 0) && sources.length <= 1 && targets.length <= 1
    && witnesses.length <= 1 && explicitPriorSources.length <= 1
    && canBindStructuralEndpoints) {
    const pairs: Array<{ source: string; target: string }> = [];
    for (const sourceId of sources.length ? sources : anchored) {
      const source = current.nodes.get(sourceId);
      if (!source?.lineageId || current.duplicates.has(sourceId)) continue;
      for (const targetId of targets.length ? targets : anchored) {
        const target = current.nodes.get(targetId);
        if (!target || targetId === sourceId || current.duplicates.has(targetId)
          || target.lineageId !== source.lineageId || contains(source, targetId) || contains(target, sourceId)) continue;
        const priorId = prior.nodes.has(sourceId) ? sourceId : priorSource || targetId;
        const before = prior.nodes.get(priorId);
        if (!before || !hasMovementPriorIdentity(current, prior, sourceId, priorId)
          || explicitPriorSources.some(id => id !== priorId)) continue;
        if (!samePriorSlot(sourceId, priorId)) continue;
        if (priorId === sourceId && prior.nodes.has(targetId)) continue;
        // An earlier copy retained in its exact slot is not a second landing
        // for this step. Keep it as authored evidence without letting it make
        // a unique, explicitly witnessed successive movement ambiguous.
        if (targetId !== priorId && samePriorSlot(targetId, targetId)
          && JSON.stringify(prior.nodes.get(targetId)) === JSON.stringify(target)) continue;
        const kind = landingKind(target, current.parents.get(targetId), previous, { node: before, parent: prior.parents.get(priorId) },
          { current, prior }, namesHeadContext(targetId), namesStructuralHost(targetId));
        const expectedKind = movementIdentityKind(relation.relation);
        if (!kind || (expectedKind && expectedKind !== kind)) continue;
        pairs.push({ source: sourceId, target: targetId });
      }
    }
    if (pairs.length === 1) {
      sources = [pairs[0].source];
      targets = [pairs[0].target];
      structurallyBound = true;
    }
  }
  // A prior source that has not been structurally rebound must still name an
  // exact current occurrence; the identity and context checks below apply.
  if (!sources.length && !entries.some(e => hasRole(e.key, 'movement.source') || hasRole(e.key, 'movement.witness'))
    && priorSource && current.nodes.has(priorSource)) sources = [priorSource];
  // Generic roles such as head, source, or target also belong to nonmovement
  // relations. They alone are not evidence of a malformed movement claim.
  const occurrenceRoles = entries.some(e => !genericRoles.has(e.key)
    && !/^(?:movement )?(?:source|lower|base|intermediate|landing|target|higher|upper|raised|moved) (?:[a-z]+ )?clauses?$/.test(e.key)
    && (hasRole(e.key, 'movement.landing') || hasRole(e.key, 'movement.source')));
  const sharedLineage = sources.some(sourceId => targets.some(targetId => {
    const source = current.nodes.get(sourceId);
    return source?.lineageId && source.lineageId === current.nodes.get(targetId)?.lineageId;
  }));
  if (!occurrenceRoles && !sharedLineage && !(witnesses.length && sources.length && targets.length)
    && !isMovementIdentity(relation.relation) && !explicitPriorSources.length) {
    return { diagnostics: [] };
  }
  // Movement relates two occurrences of one lineage. A claim naming one end
  // alone, such as the thematic Source of an ablative phrase, none of whose
  // anchored occurrences shares its lineage with another occurrence, states
  // no movement, whatever its field names suggest.
  const hasOtherOccurrence = (id: string): boolean => {
    const lineage = current.nodes.get(id)?.lineageId;
    return Boolean(lineage) && [...current.nodes.values(), ...prior.nodes.values()]
      .some(node => node.id !== id && node.lineageId === lineage);
  };
  if ((!targets.length || !sources.length && !witnesses.length) && !isMovementIdentity(relation.relation)
    && !covertDescription && !explicitPriorSources.length && !entries.some(e => e.ids.some(hasOtherOccurrence))) {
    return { diagnostics: [] };
  }
  // Operator and variable also name the ends of an interpretive dependency.
  // When they are a claim's only endpoint words and the operator was carried
  // this stage inside a phrase that moved and contained it before, that
  // phrase's movement is the stage's displacement; this claim states the
  // dependency and proves no movement of its own.
  if (!occurrenceRoles && targets.length === 1 && !isMovementIdentity(relation.relation)
    && !explicitPriorSources.length && !Object.keys(relation.priorAnchors ?? {}).length
    && entries.filter(e => ['movement.source', 'movement.witness', 'movement.landing'].some(concept => hasRole(e.key, concept)))
      .every(e => hasRole(e.key, 'operator') || hasRole(e.key, 'variable'))
    && carriedInMovedPhrase(current, prior, targets[0])) {
    return { diagnostics: [] };
  }
  if (entries.some(e => e.ids.length !== 1 && ['movement.source', 'movement.witness', 'movement.landing']
    .some(concept => hasRole(e.key, concept)))
    || Object.entries(relation.priorAnchors || {}).some(([key, value]) => hasRole(key, 'movement.source')
      && Array.isArray(value) && value.length !== 1)) {
    return fail('MOVEMENT_ENDPOINTS_UNRESOLVED', 'Movement endpoint fields must each identify one occurrence; repeated list entries were not collapsed.');
  }
  if (sources.length !== 1 || targets.length !== 1 || witnesses.length > 1) {
    return fail('MOVEMENT_ENDPOINTS_UNRESOLVED', 'Movement needs one identifiable source occurrence and one landing occurrence; the authored roles are incomplete or ambiguous.');
  }
  const [sourceId] = sources;
  const [targetId] = targets;
  if (sourceId === targetId || [sourceId, targetId].some(id => current.duplicates.has(id))) {
    return fail('MOVEMENT_ENDPOINTS_AMBIGUOUS', `Source ${sourceId} and landing ${targetId} must identify distinct, unique occurrences.`);
  }
  const source = current.nodes.get(sourceId);
  const target = current.nodes.get(targetId);
  if (!source || !target) return fail('MOVEMENT_NODE_MISSING', `Cannot find ${!source ? sourceId : targetId} in the current workspace.`);
  if (!source.lineageId || source.lineageId !== target.lineageId) {
    return fail('MOVEMENT_LINEAGE_UNPROVEN', `${sourceId} and ${targetId} do not share an explicit root lineage. Shared descendants are not enough.`);
  }
  if (contains(source, targetId) || contains(target, sourceId)) return fail('MOVEMENT_ENDPOINT_CONTAINMENT', 'One endpoint contains the other; they do not identify two separate occurrences.');
  // An unchanged older foot may be cited alongside this hop. Only a unique
  // source-slot/landing pair can bind the new witness instead; the older foot
  // remains separate authored evidence.
  const olderWitness = witnesses.length === 1 && sourcePair?.source.id === sourceId
    && sourcePair.landing.id === targetId && isEarlierChainOccurrence(witnesses[0]);
  const witnessId = olderWitness ? sourceId : witnesses[0] || sourceId;
  if (current.duplicates.has(witnessId)) return fail('MOVEMENT_ENDPOINTS_AMBIGUOUS', `Witness ${witnessId} occurs more than once.`);
  if (!contains(source, witnessId)) return fail('MOVEMENT_WITNESS_OUTSIDE_SOURCE', `${witnessId} is not within source ${sourceId}.`);
  const precedingId = prior.nodes.has(sourceId) ? sourceId : priorSource || targetId;
  const headContext = namesHeadContext(targetId), structuralHost = namesStructuralHost(targetId);
  const kind = landingKind(target, current.parents.get(targetId), previous,
    { node: prior.nodes.get(precedingId), parent: prior.parents.get(precedingId) }, { current, prior },
    headContext, structuralHost);
  if (!kind) return fail('MOVEMENT_CONTEXT_UNRESOLVED', `The anchored structure does not establish a supported head or phrasal landing for ${targetId}.`);
  const landingParent = current.parents.get(targetId);
  const structuralHeadComplex = kind === 'head' && structuralHost && landingParent
    && adjoinsHostInPlace(landingParent, targetId, { current, prior }) ? landingParent.id : undefined;
  const priorCandidates = prior.nodes.has(sourceId) ? [sourceId]
    : [...new Set(priorSources.length ? priorSources : [targetId])];
  const priorSourceId = priorCandidates.length === 1 ? priorCandidates[0] : '';
  const before = prior.nodes.get(priorSourceId);
  if (!before || !hasMovementPriorIdentity(current, prior, sourceId, priorSourceId)) {
    return fail('MOVEMENT_PRIOR_SOURCE_UNPROVEN', `${sourceId} has no unique occurrence with matching lineage in the preceding stage.`);
  }
  if (explicitPriorSources.some(id => id !== priorSourceId)) {
    return fail('MOVEMENT_PRIOR_SOURCE_CONFLICT', `The prior source anchors do not identify ${priorSourceId}; the source was not replaced with a guessed occurrence.`);
  }
  if (priorSourceId !== sourceId) {
    // A fresh lower ID must occupy the exact prior structural slot. Shared
    // lineage alone cannot relocate an unrelated occurrence or guess a source.
    if (!samePriorSlot(sourceId, priorSourceId)) {
      return fail('MOVEMENT_PRIOR_POSITION_UNPROVEN', `${sourceId} does not occupy the preceding position of ${priorSourceId}.`);
    }
  }
  // A newly named occurrence replacing another member at its old position is
  // that member's lower witness. Connecting an earlier chain foot to it does
  // not establish a second movement or transfer ownership of its appearance.
  const retainedPriorSlot = (currentId: string, previousId: string): boolean => {
    if (!samePriorSlot(currentId, previousId)) return false;
    const currentParent = current.parents.get(currentId)!;
    const previousParent = prior.parents.get(previousId)!;
    // Matching sisters inside a renamed parent do not prove that the parent
    // stayed put: the whole head complex may itself have moved.
    return currentParent.id === previousParent.id || retainedPriorSlot(currentParent.id, previousParent.id);
  };
  if (!prior.nodes.has(targetId) && [...prior.nodes.values()].some(node =>
    node.id !== priorSourceId && node.lineageId === target.lineageId
    && !prior.duplicates.has(node.id)
    && retainedPriorSlot(targetId, node.id))) {
    return fail('MOVEMENT_TARGET_IS_LOWER_WITNESS', `${targetId} occupies another preceding occurrence's source position, not a new landing.`);
  }
  // A head position may already exist before it receives moved material.
  // New source-linked identity within that exact position proves filling;
  // a later pronunciation change alone does not create another movement.
  const lineages = (node?: SyntaxNode): Set<string> => {
    const result = new Set<string>();
    const visit = (n: SyntaxNode) => { if (n.lineageId) result.add(n.lineageId); n.children?.forEach(visit); };
    if (node) visit(node);
    return result;
  };
  const priorLanding = prior.nodes.get(targetId);
  const oldLandingLineages = lineages(priorLanding), sourceLineages = lineages(before);
  const fillsHeadPosition = kind === 'head' && priorLanding && [...lineages(target)]
    .some(lineage => sourceLineages.has(lineage) && !oldLandingLineages.has(lineage));
  const roles: Record<string, string[]> = {};
  const context: NonNullable<RecoveredMovement['context']> = [];
  const diagnostics: string[] = [];
  entries.forEach(e => {
    const concepts: string[] = [];
    if (e.ids.length === 1 && e.ids[0] === sourceId && (structurallyBound || hasRole(e.key, 'movement.source') || hasRole(e.key, 'movement.witness'))) concepts.push('movement.source');
    if (e.ids.length === 1 && e.ids[0] === witnessId && (structurallyBound || hasRole(e.key, 'movement.source') || hasRole(e.key, 'movement.witness'))) concepts.push('movement.witness');
    if (e.ids.length === 1 && e.ids[0] === targetId && (structurallyBound || hasRole(e.key, 'movement.landing'))) concepts.push('movement.landing');
    if (concepts.length) roles[e.key] = concepts;
    const endpoint = e.ids.length === 1 && (sourceMembers.has(e.ids[0]) ? sourceId
      : landingMembers.has(e.ids[0]) ? targetId : undefined);
    if (endpoint && movementContextFailure(forest, endpoint, e.ids[0], 'head-member', previous) === undefined) {
      context.push({ key: e.authoredKey, nodeId: e.ids[0], kind: 'head-member' });
      return;
    }
    // An operator inside the explicitly anchored landing is separate evidence,
    // not a claim that this operator is the landing's containing projection.
    if (e.key === 'operator' && e.ids.length === 1 && e.ids[0] !== targetId && contains(target, e.ids[0])) return;
    if (phrasalHeadParticipants.has(e.authoredKey)) return;
    // A phrasal attractor is not the head-adjunction host of that phrase.
    if (kind === 'phrasal' && e.key === 'attracting head') return;
    // A plain host is a phrase's landing site, but a head's host or complex.
    const landingField = e.key === 'host' || (hasRole(e.key, 'movement.landing') && !e.ids.includes(targetId));
    const contextKind: MovementContextKind | undefined = (e.key !== 'host' ? headContextKind(e.key) : undefined)
      ?? (landingField ? kind === 'head' && e.key !== 'landing site' ? 'head-landing' : 'site' : undefined);
    if (!contextKind) return;
    const reason = e.ids.length !== 1 ? 'context-needs-one-exact-node'
      : movementContextFailure(forest, targetId, e.ids[0], contextKind, previous,
        kind === 'phrasal' && landingContainerRole(e.key) ? sourceId : undefined,
        kind === 'head' && structuralHost ? { current, prior } : undefined);
    if (reason) diagnostics.push(`MOVEMENT_CONTEXT_UNPROVEN: anchors.${e.authoredKey} (${e.ids.join(', ')}) for landing ${targetId}: ${reason}. The authored field remains unresolved.`);
    else context.push({ key: e.authoredKey, nodeId: e.ids[0], kind: contextKind });
  });
  const priorAnchorKeys = Object.entries(relation.priorAnchors || {}).flatMap(([key, value]) => {
    const ids = Array.isArray(value) ? value : [value];
    if (ids.length !== 1 || prior.duplicates.has(ids[0])) return [];
    const node = prior.nodes.get(ids[0]);
    if (!node) return [];
    const verified = (hasRole(key, 'movement.source') || structurallyBound && samePriorSlot(sourceId, node.id)) && node.id === priorSourceId
      || hasRole(key, 'movement.landing') && node.id === targetId && node.lineageId === target.lineageId
      || hasRole(key, 'movement.witness') && contains(before, node.id)
        && (node.id === witnessId || Boolean(node.lineageId && node.lineageId === current.nodes.get(witnessId)?.lineageId));
    return verified ? [key] : [];
  });
  return {
    diagnostics,
    movement: {
      priorSourceNodeId: priorSourceId,
      sourceNodeId: sourceId, targetNodeId: targetId, witnessNodeId: witnessId,
      trajectoryKind: kind,
      transition: priorSourceId !== sourceId || !prior.nodes.has(targetId) || Boolean(fillsHeadPosition),
      roles,
      ...(priorAnchorKeys.length ? { priorAnchorKeys } : {}),
      ...(priorCarrierKeys.size ? { priorContextKeys: [...priorCarrierKeys] } : {}),
      ...(context.length ? { context } : {}),
      ...(structuralHeadComplex ? { structuralHeadComplexNodeId: structuralHeadComplex } : {})
    }
  };
}
