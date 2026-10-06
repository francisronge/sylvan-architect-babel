import type { DerivationStageRelation, SyntaxNode } from '../../types.ts';
import { readCategoryLabel } from '../categoryLabel.ts';
import { buildTier2SynonymIndex, relationRoleConcepts, normalizeTier2Synonym, isUnestablishedCovertMovementDescription } from './tier2Synonyms.ts';
import { isMovementIdentity, movementIdentityKind } from './movementIdentities.ts';

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
  /** Verified preceding containers remain context, not source occurrences. */
  priorContextKeys?: string[];
  /** Exact authored fields verified as structural context, not extra dependencies. */
  context?: Array<{ key: string; nodeId: string; kind: MovementContextKind }>;
}

type MovementContextKind = 'site' | 'head-host' | 'head-complex' | 'head-landing' | 'head-member';

const headCategory = (node: SyntaxNode): string => readCategoryLabel(node.label)?.head ?? '';
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
const isHeadComplex = (parent: SyntaxNode, landingId: string, previous: readonly SyntaxNode[] = []): boolean => {
  const landing = parent.children?.find(node => node.id === landingId);
  const siblings = (parent.children || []).filter(node => node.id !== landingId);
  if (readCategoryLabel(parent.label)?.kind !== 'head' || readCategoryLabel(landing?.label)?.kind !== 'head') return false;
  if (parent.children?.length === 1 && parent.children[0].id === landingId) {
    const landing = parent.children[0];
    return readCategoryLabel(landing.label)?.kind === 'head' && onlyExponents(landing);
  }
  if (siblings.length === 1 && readCategoryLabel(siblings[0].label)?.kind === 'head'
    && headCategory(siblings[0]) === headCategory(parent)) {
    // A previously built host remains the same head when another head adjoins;
    // its internal clitic or inflection structure need not be flat.
    if (onlyExponents(siblings[0])) return true;
    const containsLowerOccurrence = (node: SyntaxNode): boolean => Boolean(landing?.lineageId
      && node.id !== landing.id && node.lineageId === landing.lineageId)
      || Boolean(node.children?.some(containsLowerOccurrence));
    // A bare-labelled clause can also persist unchanged. When it contains the
    // lower occurrence, its identity does not establish a separate head host.
    return !containsLowerOccurrence(siblings[0])
      && JSON.stringify(uniqueNode(previous, siblings[0].id)) === JSON.stringify(siblings[0]);
  }
  const before = uniqueNode(previous, parent.id);
  // A retained inflectional head may acquire one moved member alongside several
  // already authored exponents. Exact ordered companions establish that landing.
  return siblings.length > 1 && readCategoryLabel(landing?.label)?.kind === 'head'
    && siblings.every(node => readCategoryLabel(node.label)?.kind === 'head')
    && Boolean(before && readCategoryLabel(before.label)?.kind === 'head'
      && headCategory(before) === headCategory(parent)
      && !uniqueNode(previous, landingId)
      && JSON.stringify(before.children) === JSON.stringify(siblings));
};

const isProjectedHead = (parent: SyntaxNode, target: SyntaxNode): boolean => {
  const targetCategory = readCategoryLabel(target.label), parentCategory = readCategoryLabel(parent.label);
  return parentCategory?.kind !== 'head' && targetCategory?.kind === 'head' && onlyExponents(target)
    && targetCategory.head === parentCategory?.head
    && (parent.children ?? []).filter(child => child.id !== target.id)
      .every(child => ['bar', 'phrase'].includes(readCategoryLabel(child.label)?.kind ?? ''));
};

type PriorSourcePosition = { node?: SyntaxNode; parent?: SyntaxNode };

// A nested head assembly retains a lexical host at each branching level.
// Merely having bare labels throughout a clause does not satisfy that shape.
const isHeadAssembly = (node: SyntaxNode): boolean => {
  if (readCategoryLabel(node.label)?.kind !== 'head') return false;
  const children = node.children ?? [];
  return children.every(isHeadAssembly) && (children.length < 2
    || children.some(child => !child.children?.length && headCategory(child) === headCategory(node)));
};

const hasAssembledMemberWitness = (source: SyntaxNode, sisters: readonly SyntaxNode[]): boolean => {
  if (!source.children?.length || !sisters.length || !isHeadAssembly(source)) return false;
  const nodes = (root: SyntaxNode): SyntaxNode[] => [root, ...(root.children ?? []).flatMap(nodes)];
  const members = (source.children ?? []).flatMap(nodes), lower = sisters.flatMap(nodes);
  return members.some(member => member.lineageId && member.lineageId !== source.lineageId
    && members.filter(other => other.lineageId === member.lineageId).length === 1
    && lower.some(witness => witness.id !== member.id && witness.lineageId === member.lineageId
      && readCategoryLabel(witness.label)?.kind === 'head' && headCategory(witness) === headCategory(member)));
};

const landingKind = (target: SyntaxNode, parent?: SyntaxNode, previous: readonly SyntaxNode[] = [],
  priorSource: PriorSourcePosition = {}): 'head' | 'phrasal' | undefined => {
  const shape = readCategoryLabel(target.label);
  const oldShape = readCategoryLabel(priorSource.node?.label), oldParent = readCategoryLabel(priorSource.parent?.label);
  // A flat receiving head also selects ordinary phrases. A branching bare
  // occurrence therefore needs its own head evidence, not just that sister:
  // explicit head notation/material or its preceding projected head slot.
  // Bare projections can establish that slot too. A prior member/lower-copy
  // pair proves an existing assembly even for an intransitive complement or a
  // nested head; otherwise the flat head needs a branching complement.
  const oldSisters = priorSource.parent?.children?.filter(child => child.id !== priorSource.node?.id) ?? [];
  const projectedSource = oldShape?.kind === 'head' && oldShape.head === oldParent?.head
    && (oldParent?.kind !== 'head'
      ? oldSisters.every(child => ['bar', 'phrase'].includes(readCategoryLabel(child.label)?.kind ?? ''))
      : Boolean(priorSource.node && (hasAssembledMemberWitness(priorSource.node, oldSisters)
        || onlyExponents(priorSource.node) && oldSisters.length
          && oldSisters.every(child => child.children?.length && headCategory(child) && headCategory(child) !== oldShape.head))));
  const headUnit = !target.children?.length || Boolean(target.word?.trim()) || shape?.compound
    || /^[A-Za-z][A-Za-z]*(?:_[A-Za-z][A-Za-z0-9_-]*)?(?:⁰|°|\^?0)(?:\s*(?:\[|:|\(|,)|$)/u.test(target.label) || projectedSource;
  if (headUnit && parent && (isHeadComplex(parent, target.id, previous) || isProjectedHead(parent, target))) return 'head';
  const parentCategory = readCategoryLabel(parent?.label);
  const specifier = parentCategory && parent?.children?.some(n => n.id !== target.id
    && headCategory(n) === parentCategory.head && !onlyExponents(n));
  if (target.children?.length || shape?.kind === 'phrase' || specifier) return 'phrasal';
};

/** Shared exact structural check for Tier 1 and recovered movement context. */
export const movementContextFailure = (
  forest: readonly SyntaxNode[], landingId: string, contextId: string, kind: MovementContextKind,
  previous: readonly SyntaxNode[] = []
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
  if (kind === 'site') return isParent ? undefined : 'not-the-immediate-landing-parent';
  if (!isHeadComplex(parent, landingId, previous)) return 'landing-is-not-in-a-supported-head-complex';
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
const genericRoles = new Set(['source', 'sources', 'origin', 'origins', 'from', 'target', 'targets', 'to', 'destination', 'destinations', 'landing', 'landings', 'landing site', 'landing sites', 'filler', 'fillers', 'operator', 'operators', 'head', 'heads', 'variable', 'variables', 'real gap', 'real gaps']);

// Recover occurrence identity from the anchored objects, never a shared descendant
// or the relation's title. The result is renderer evidence, not authored syntax.
export function recoverMovementEvidence(
  relation: DerivationStageRelation,
  forest: readonly SyntaxNode[],
  previous: readonly SyntaxNode[] = []
): MovementEvidenceResult {
  const fail = (code: string, reason: string): MovementEvidenceResult => ({ failure: code, diagnostics: [`${code}: ${reason}`] });
  if (isUnestablishedCovertMovementDescription(relation.relation))
    return fail('MOVEMENT_NOT_ESTABLISHED', 'The covert operation is denied or provisional; its endpoints do not establish an ordinary movement instead.');
  const index = (roots: readonly SyntaxNode[]) => {
    const nodes = new Map<string, SyntaxNode>();
    const parents = new Map<string, SyntaxNode>();
    const duplicates = new Set<string>();
    const visit = (n: SyntaxNode, parent?: SyntaxNode) => {
      if (nodes.has(n.id)) duplicates.add(n.id);
      nodes.set(n.id, n);
      if (parent) parents.set(n.id, parent);
      (n.children || []).forEach(c => visit(c, n));
    };
    roots.forEach(n => visit(n));
    return { nodes, parents, duplicates };
  };
  const current = index(forest);
  const prior = index(previous);
  const samePriorSlot = (sourceId: string, priorId: string): boolean => {
    const oldParent = prior.parents.get(priorId);
    const lowerParent = current.parents.get(sourceId);
    if (!oldParent || !lowerParent || prior.duplicates.has(oldParent.id) || current.duplicates.has(lowerParent.id)) return false;
    const slot = oldParent.children!.findIndex(n => n.id === priorId);
    if (slot !== lowerParent.children!.findIndex(n => n.id === sourceId)) return false;
    if (oldParent.id === lowerParent.id) return true;
    // Rebuilt projections may have fresh IDs. The unchanged ordered sisters
    // can still locate the source slot, without equating the parent identities.
    // Unary shells, surviving competing parents and changed sisters prove less.
    return !current.nodes.has(oldParent.id) && !prior.nodes.has(lowerParent.id)
      && oldParent.label === lowerParent.label
      && oldParent.children!.length > 1 && oldParent.children!.length === lowerParent.children!.length
      && oldParent.children!.every((sibling, i) => i === slot || (
        !prior.duplicates.has(sibling.id) && !current.duplicates.has(sibling.id)
        && JSON.stringify(sibling) === JSON.stringify(lowerParent.children![i])
      ));
  };
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
  // A source occurrence and its containing head complex are not two sources.
  // Keep only the occurrence when every other reference proves its exact complex.
  if (explicitPriorSources.length > 1) {
    const occurrences = explicitPriorSources.filter(id => explicitPriorSources.every(otherId => id === otherId
      || movementContextFailure(previous, id, otherId, 'head-complex') === undefined));
    if (occurrences.length === 1) explicitPriorSources = occurrences;
  }
  const contains = (n: SyntaxNode, id: string): boolean => n.id === id || (n.children || []).some(c => contains(c, id));
  let sources = pick('movement.source');
  const witnesses = pick('movement.witness');
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
  // A source clause may contain the moving occurrence. It is context only
  // when a separate lineage-matched pair proves the exact preceding source
  // slot. Another occurrence or an unrelated clause remains a competing source.
  const sourceClauseRole = (key: string): boolean => /^(?:(?:prior|movement) )?(?:source|lower|base|intermediate) (?:[a-z]+ )?clauses?$/.test(normalizeTier2Synonym(key));
  const sourceClausePresent = entries.some(e => sourceClauseRole(e.key))
    || Object.keys(relation.priorAnchors ?? {}).some(sourceClauseRole);
  const independentPairs = (sourceClausePresent ? [...new Set([...structuralPriorSources, ...anchored])] : []).flatMap(priorId => {
    const before = prior.nodes.get(priorId);
    if (!before?.lineageId || prior.duplicates.has(priorId)) return [];
    return anchored.filter(id => !current.duplicates.has(id) && current.nodes.get(id)?.lineageId === before.lineageId
      && samePriorSlot(id, priorId)).flatMap(sourceId => anchored.filter(targetId => {
      const target = current.nodes.get(targetId);
      return targetId !== sourceId && target?.lineageId === before.lineageId && !current.duplicates.has(targetId)
        && !contains(current.nodes.get(sourceId)!, targetId) && !contains(target, sourceId)
        && entries.some(e => e.ids.length === 1 && e.ids[0] === targetId && hasRole(e.key, 'movement.landing'))
        && landingKind(target, current.parents.get(targetId), previous, { node: before, parent: prior.parents.get(priorId) }) === 'phrasal';
    }).map(targetId => ({ priorId, sourceId, targetId })));
  });
  if (independentPairs.length === 1) {
    const pair = independentPairs[0], lineage = prior.nodes.get(pair.priorId)!.lineageId;
    const containingSource = (id: string, sourceId: string, indexed: ReturnType<typeof index>): boolean => {
      const container = indexed.nodes.get(id);
      return Boolean(container && id !== sourceId && !indexed.duplicates.has(id)
        && container.lineageId !== lineage && contains(container, sourceId));
    };
    explicitPriorSources = explicitPriorSources.filter(id => !containingSource(id, pair.priorId, prior)
      || Object.entries(relation.priorAnchors ?? {}).some(([key, value]) => hasRole(key, 'movement.source')
        && (Array.isArray(value) ? value : [value]).includes(id) && !sourceClauseRole(key)));
    structuralPriorSources = structuralPriorSources.filter(id => !containingSource(id, pair.priorId, prior));
    sources = sources.filter(id => !containingSource(id, pair.sourceId, current)
      || entries.some(e => hasRole(e.key, 'movement.source') && e.ids.includes(id) && !sourceClauseRole(e.key)));
    if (!sources.length) sources = witnesses;
  }
  const priorSources = explicitPriorSources.length ? explicitPriorSources : structuralPriorSources;
  const priorSource = priorSources.length === 1 ? priorSources[0] : undefined;
  // Moving an intact head assembly into an explicitly named receiving head
  // establishes its endpoints even when their authored field names are open.
  // Identity alone is insufficient: preserve every field and child, retain the
  // exact lower slot, and require a new, uniquely anchored adjunction landing.
  const hasPreservedHeadAdjunction = (): boolean => {
    const before = priorSource ? prior.nodes.get(priorSource) : undefined;
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
  const canBindStructuralEndpoints = isMovementIdentity(relation.relation) || explicitPriorSources.length === 1
    || structuralPriorSources.length === 1 && entries.some(e => e.key === 'landing' && e.ids.length === 1)
    || entries.some(e => !genericRoles.has(e.key) && ['movement.source', 'movement.witness', 'movement.landing'].some(concept => hasRole(e.key, concept)))
    || hasPreservedHeadAdjunction();
  // A named preceding complex fixes the moving unit. Its explicitly anchored
  // lexical member can describe the lower copy without becoming a competing
  // whole source. Every member must retain its exact position and lineage.
  if (explicitPriorSources.length === 1 && priorSource && sources.includes(priorSource)
    && samePriorSlot(priorSource, priorSource)) {
    const before = prior.nodes.get(priorSource), lower = current.nodes.get(priorSource);
    const sameMember = (id: string) => {
      if (!before || !lower || prior.duplicates.has(id) || current.duplicates.has(id)) return false;
      const path = (node: SyntaxNode, target: string): number[] | undefined => {
        if (node.id === target) return [];
        for (const [index, child] of (node.children ?? []).entries()) {
          const tail = path(child, target);
          if (tail) return [index, ...tail];
        }
      };
      const oldPath = path(before, id), newPath = path(lower, id);
      return Boolean(oldPath?.length && newPath?.length && JSON.stringify(oldPath) === JSON.stringify(newPath)
        && prior.nodes.get(id)?.lineageId && prior.nodes.get(id)?.lineageId === current.nodes.get(id)?.lineageId);
    };
    if (sources.every(id => id === priorSource || sameMember(id))) {
      sources.filter(id => id !== priorSource).forEach(id => sourceMembers.add(id));
      sources = [priorSource];
      structurallyBound = true;
    }
  }
  // In a successive step, only the anchored occurrence occupying this source's
  // preceding slot is its new lower witness. Older copies stay separate evidence.
  const onlyEarlierChainSources = sources.length > 0 && sources.every(id => id !== priorSource
    && current.nodes.get(id)?.lineageId === prior.nodes.get(priorSource ?? '')?.lineageId
    && JSON.stringify(current.nodes.get(id)) === JSON.stringify(prior.nodes.get(id))
    && samePriorSlot(id, id));
  if ((!sources.length || onlyEarlierChainSources) && priorSource && canBindStructuralEndpoints) {
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
      return Boolean(oldMember?.lineageId && member?.lineageId === oldMember.lineageId
        && lowerMember?.lineageId === oldMember.lineageId && !prior.duplicates.has(oldMember.id)
        && !current.duplicates.has(lowerMember.id)
        && headMemberPath(before, oldMember.id)?.length && headMemberPath(source, lowerMember.id)?.length);
    };
    // A phrase's target head may remain in place or project beside the landing.
    // Leave that field unclaimed after proving the phrase's lineage and exact
    // preceding slot; it establishes no additional movement endpoint.
    const isHeadParticipantRole = (key: string): boolean => key === 'target'
      || /^(?:movement )?(?:target|landing) (?:[a-z]+ )*head$/.test(key);
    const isPhrasalHeadParticipant = (occurrence: string, id: string): boolean => {
      const target = current.nodes.get(occurrence), head = current.nodes.get(id);
      const precedingId = prior.nodes.has(sources[0]) ? sources[0] : priorSource;
      const before = prior.nodes.get(precedingId ?? '');
      const projectsBesideLanding = (): boolean => {
        if (!head) return false;
        const parent = current.parents.get(occurrence);
        const category = headCategory(head);
        if (!parent || current.duplicates.has(parent.id) || parent.children?.length !== 2
          || headCategory(parent) !== category) return false;
        let projection = parent.children.find(child => child.id !== occurrence);
        while (projection && !current.duplicates.has(projection.id) && headCategory(projection) === category) {
          if (projection.id === id) return true;
          const spine = projection.children?.filter(child => headCategory(child) === category) ?? [];
          if (spine.length !== 1) return false;
          projection = spine[0];
        }
        return false;
      };
      const precedingHead = prior.nodes.get(id);
      return Boolean(target && head && targets.includes(occurrence)
        && !current.duplicates.has(id) && !prior.duplicates.has(id)
        && !current.duplicates.has(sources[0]) && !current.duplicates.has(occurrence)
        && before?.lineageId && before.lineageId === lineage && !prior.duplicates.has(before.id)
        && precedingId && samePriorSlot(sources[0], precedingId)
        && landingKind(target, current.parents.get(occurrence), previous, { node: before, parent: prior.parents.get(precedingId ?? '') }) === 'phrasal'
        && readCategoryLabel(head.label)?.kind === 'head' && !head.children?.length
        && head.lineageId !== lineage
        && (!precedingHead || sameAuthoredValue(precedingHead, head))
        && (precedingHead && samePriorSlot(id, id) || projectsBesideLanding())
        && entries.some(e => e.ids.length === 1 && e.ids[0] === id && isHeadParticipantRole(e.key))
        && entries.filter(e => e.ids.includes(id) && hasRole(e.key, 'movement.landing'))
          .every(e => e.ids.length === 1 && isHeadParticipantRole(e.key)));
    };
    const occurrences = anchored.filter(id => id !== sources[0] && lineage
      && current.nodes.get(id)?.lineageId === lineage).filter(occurrence => targets.every(id => id === occurrence
        || (targets.includes(occurrence) && current.nodes.has(id) && contains(current.nodes.get(id)!, occurrence))
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
  // Unfamiliar wording still needs explicit movement direction or an established
  // identity, plus exact anchored occurrences and a changed preceding source slot.
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
        if (!before || before.lineageId !== source.lineageId || prior.duplicates.has(priorId)
          || explicitPriorSources.some(id => id !== priorId)) continue;
        if (!samePriorSlot(sourceId, priorId)) continue;
        if (priorId === sourceId && prior.nodes.has(targetId)) continue;
        // An earlier copy retained in its exact slot is not a second landing
        // for this step. Keep it as authored evidence without letting it make
        // a unique, explicitly witnessed successive movement ambiguous.
        if (targetId !== priorId && samePriorSlot(targetId, targetId)
          && JSON.stringify(prior.nodes.get(targetId)) === JSON.stringify(target)) continue;
        const kind = landingKind(target, current.parents.get(targetId), previous, { node: before, parent: prior.parents.get(priorId) });
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
  const witnessId = witnesses[0] || sourceId;
  if (current.duplicates.has(witnessId)) return fail('MOVEMENT_ENDPOINTS_AMBIGUOUS', `Witness ${witnessId} occurs more than once.`);
  if (!contains(source, witnessId)) return fail('MOVEMENT_WITNESS_OUTSIDE_SOURCE', `${witnessId} is not within source ${sourceId}.`);
  const precedingId = prior.nodes.has(sourceId) ? sourceId : priorSource || targetId;
  const kind = landingKind(target, current.parents.get(targetId), previous,
    { node: prior.nodes.get(precedingId), parent: prior.parents.get(precedingId) });
  if (!kind) return fail('MOVEMENT_CONTEXT_UNRESOLVED', `The anchored structure does not establish a supported head or phrasal landing for ${targetId}.`);
  const priorCandidates = prior.nodes.has(sourceId) ? [sourceId]
    : [...new Set(priorSources.length ? priorSources : [targetId])];
  const priorSourceId = priorCandidates.length === 1 ? priorCandidates[0] : '';
  const before = prior.nodes.get(priorSourceId);
  if (!before || prior.duplicates.has(priorSourceId) || before.lineageId !== source.lineageId) {
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
    const contextKind: MovementContextKind | undefined = hasRole(e.key, 'movement.complex') ? 'head-complex'
      : hasRole(e.key, 'movement.host') ? ['landing head', 'receiving head'].includes(e.key) ? 'head-landing' : 'head-host'
      : e.key === 'host' || (hasRole(e.key, 'movement.landing') && !e.ids.includes(targetId))
        ? kind === 'head' && e.key !== 'landing site' ? 'head-landing' : 'site' : undefined;
    if (!contextKind) return;
    const reason = e.ids.length !== 1 ? 'context-needs-one-exact-node'
      : movementContextFailure(forest, targetId, e.ids[0], contextKind, previous);
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
      ...(context.length ? { context } : {})
    }
  };
}
