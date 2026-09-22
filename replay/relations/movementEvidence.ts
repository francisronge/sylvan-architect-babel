import type { DerivationStageRelation, SyntaxNode } from '../../types.ts';
import { categoryLabel as readCategoryLabel } from '../categoryLabel.ts';
import { buildTier2SynonymIndex, relationRoleConcepts, normalizeTier2Synonym } from './tier2Synonyms.ts';
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
  /** Exact authored fields verified as structural context, not extra dependencies. */
  context?: Array<{ key: string; nodeId: string; kind: MovementContextKind }>;
}

type MovementContextKind = 'site' | 'head-host' | 'head-complex' | 'head-landing';

const categoryLabel = (node: SyntaxNode) => readCategoryLabel(node.label).replace(/(?:\^?0|⁰)$/u, '');
const headCategory = (node: SyntaxNode): string => categoryLabel(node).replace(/:.*$/u, '').trim();
const onlyExponents = (node: SyntaxNode): boolean => !node.children?.length || node.children.every(child => !child.children?.length);
const isHeadComplex = (parent: SyntaxNode, landingId: string): boolean => {
  const siblings = (parent.children || []).filter(node => node.id !== landingId);
  if (/P$/.test(categoryLabel(parent)) || /[′'’]/.test(parent.label)) return false;
  if (parent.children?.length === 1 && parent.children[0].id === landingId) {
    const landing = parent.children[0];
    return !/P$/.test(categoryLabel(landing)) && !/[′'’]/.test(landing.label) && onlyExponents(landing);
  }
  return siblings.length === 1 && headCategory(siblings[0]) === headCategory(parent) && onlyExponents(siblings[0]);
};

const isProjectedHead = (parent: SyntaxNode, target: SyntaxNode): boolean => {
  const headCategory = categoryLabel(target);
  const projection = /[′'’]/u.test(parent.label) || /P$/u.test(categoryLabel(parent));
  return projection && !/[′'’]/u.test(target.label) && !/P$/u.test(headCategory) && onlyExponents(target)
    && headCategory === categoryLabel(parent).replace(/P$/u, '')
    && (parent.children ?? []).filter(child => child.id !== target.id)
      .every(child => /[′'’]/u.test(child.label) || /P$/u.test(categoryLabel(child)));
};

const landingKind = (target: SyntaxNode, parent?: SyntaxNode): 'head' | 'phrasal' | undefined => {
  if (parent && (isHeadComplex(parent, target.id) || isProjectedHead(parent, target))) return 'head';
  const projectionCategory = (node: SyntaxNode) => categoryLabel(node)
    .replace(/\s+\([^)]*\bprojection\b[^)]*\)$/u, '').replace(/P$/u, '');
  const specifier = parent?.children?.some(n => n.id !== target.id
    && projectionCategory(n) === projectionCategory(parent) && !onlyExponents(n));
  if (!onlyExponents(target) || /P$/.test(categoryLabel(target)) || specifier) return 'phrasal';
};

/** Shared exact structural check for Tier 1 and recovered movement context. */
export const movementContextFailure = (
  forest: readonly SyntaxNode[], landingId: string, contextId: string, kind: MovementContextKind
): string | undefined => {
  const nodes: SyntaxNode[] = [];
  const visit = (node: SyntaxNode) => { nodes.push(node); (node.children || []).forEach(visit); };
  forest.forEach(visit);
  const landing = nodes.filter(node => node.id === landingId);
  const context = nodes.filter(node => node.id === contextId);
  if (landing.length !== 1 || context.length !== 1) return 'landing-or-context-id-missing-or-ambiguous';
  const parents = nodes.filter(node => node.children?.includes(landing[0]));
  const parent = parents.length === 1 ? parents[0] : undefined;
  if (!parent || nodes.filter(node => node.id === parent.id).length !== 1) return 'landing-parent-missing-or-ambiguous';
  const isParent = parent === context[0];
  if (kind === 'site') return isParent ? undefined : 'not-the-immediate-landing-parent';
  if (!isHeadComplex(parent, landingId)) return 'landing-is-not-in-a-supported-head-complex';
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
const genericRoles = new Set(['source', 'origin', 'from', 'target', 'to', 'destination', 'landing', 'landing site', 'filler', 'operator', 'head', 'variable', 'real gap']);

// Recover occurrence identity from the anchored objects, never a shared descendant
// or the relation's title. The result is renderer evidence, not authored syntax.
export function recoverMovementEvidence(
  relation: DerivationStageRelation,
  forest: readonly SyntaxNode[],
  previous: readonly SyntaxNode[] = []
): MovementEvidenceResult {
  const fail = (code: string, reason: string): MovementEvidenceResult => ({ failure: code, diagnostics: [`${code}: ${reason}`] });
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
  let explicitPriorSources = [...new Set(Object.entries(relation.priorAnchors || {})
    .filter(([key]) => hasRole(key, 'movement.source'))
    .flatMap(([, value]) => Array.isArray(value) ? value : [value]))];
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
  let structurallyBound = false;
  const anchored = [...new Set(entries.filter(e => e.ids.length === 1).flatMap(e => e.ids))];
  // An explicit preceding source distinguishes this step from earlier copies
  // in the same chain. Unchanged earlier copies remain separate evidence.
  const structuralPriorSources = [...new Set(Object.values(relation.priorAnchors || {}).flat())].filter(id => {
    const node = prior.nodes.get(id);
    return node?.lineageId && !prior.duplicates.has(id) && anchored.some(currentId =>
      current.nodes.get(currentId)?.lineageId === node.lineageId && samePriorSlot(currentId, id));
  });
  const priorSources = explicitPriorSources.length ? explicitPriorSources : structuralPriorSources;
  const priorSource = priorSources.length === 1 ? priorSources[0] : undefined;
  const canBindStructuralEndpoints = isMovementIdentity(relation.relation) || explicitPriorSources.length === 1
    || entries.some(e => !genericRoles.has(e.key) && ['movement.source', 'movement.witness', 'movement.landing'].some(concept => hasRole(e.key, concept)));
  // In a successive step, only the anchored occurrence occupying this source's
  // preceding slot is its new lower witness. Older copies stay separate evidence.
  if (!sources.length && priorSource && canBindStructuralEndpoints) {
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
    const occurrences = anchored.filter(id => id !== sources[0] && lineage
      && current.nodes.get(id)?.lineageId === lineage).filter(occurrence => targets.every(id => id === occurrence
        || (targets.includes(occurrence) && current.nodes.has(id) && contains(current.nodes.get(id)!, occurrence))
        || movementContextFailure(forest, occurrence, id, 'site') === undefined
        || movementContextFailure(forest, occurrence, id, 'head-landing') === undefined));
    if (occurrences.length === 1) {
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
        const kind = landingKind(target, current.parents.get(targetId));
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
    && (hasRole(e.key, 'movement.landing') || hasRole(e.key, 'movement.source')));
  const sharedLineage = sources.some(sourceId => targets.some(targetId => {
    const source = current.nodes.get(sourceId);
    return source?.lineageId && source.lineageId === current.nodes.get(targetId)?.lineageId;
  }));
  if (!occurrenceRoles && !sharedLineage && !(witnesses.length && sources.length && targets.length)) {
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
  const kind = landingKind(target, current.parents.get(targetId));
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
    // A phrasal attractor is not the head-adjunction host of that phrase.
    if (kind === 'phrasal' && e.key === 'attracting head') return;
    const contextKind: MovementContextKind | undefined = hasRole(e.key, 'movement.complex') ? 'head-complex'
      : hasRole(e.key, 'movement.host') ? ['landing head', 'receiving head'].includes(e.key) ? 'head-landing' : 'head-host'
      : e.key === 'host' || (hasRole(e.key, 'movement.landing') && !e.ids.includes(targetId))
        ? kind === 'head' && e.key !== 'landing site' ? 'head-landing' : 'site' : undefined;
    if (!contextKind) return;
    const reason = e.ids.length !== 1 ? 'context-needs-one-exact-node'
      : movementContextFailure(forest, targetId, e.ids[0], contextKind);
    if (reason) diagnostics.push(`MOVEMENT_CONTEXT_UNPROVEN: anchors.${e.authoredKey} (${e.ids.join(', ')}) for landing ${targetId}: ${reason}. The authored field remains unresolved.`);
    else context.push({ key: e.authoredKey, nodeId: e.ids[0], kind: contextKind });
  });
  const priorAnchorKeys = Object.entries(relation.priorAnchors || {}).flatMap(([key, value]) => {
    const ids = Array.isArray(value) ? value : [value];
    if (ids.length !== 1 || prior.duplicates.has(ids[0])) return [];
    const node = prior.nodes.get(ids[0]);
    if (!node) return [];
    const verified = hasRole(key, 'movement.source') && node.id === priorSourceId
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
      ...(context.length ? { context } : {})
    }
  };
}
