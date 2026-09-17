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

const categoryLabel = (node: SyntaxNode) => readCategoryLabel(node.label);
const onlyExponents = (node: SyntaxNode): boolean => !node.children?.length || node.children.every(child => !child.children?.length);
const isHeadComplex = (parent: SyntaxNode, landingId: string): boolean => {
  const siblings = (parent.children || []).filter(node => node.id !== landingId);
  return siblings.length === 1 && categoryLabel(siblings[0]) === categoryLabel(parent)
    && onlyExponents(siblings[0]) && !/P$/.test(categoryLabel(parent)) && !/[′'’]/.test(parent.label);
};

const landingKind = (target: SyntaxNode, parent?: SyntaxNode): 'head' | 'phrasal' | undefined => {
  if (parent && isHeadComplex(parent, target.id)) return 'head';
  const specifier = parent?.children?.some(n => n.id !== target.id
    && categoryLabel(n) === categoryLabel(parent) && !onlyExponents(n));
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
  const explicitPriorSources = [...new Set(Object.entries(relation.priorAnchors || {})
    .filter(([key]) => hasRole(key, 'movement.source'))
    .flatMap(([, value]) => Array.isArray(value) ? value : [value]))];
  const contains = (n: SyntaxNode, id: string): boolean => n.id === id || (n.children || []).some(c => contains(c, id));
  let sources = pick('movement.source');
  const witnesses = pick('movement.witness');
  if (!sources.length) sources = witnesses;
  let targets = pick('movement.landing');
  let structurallyBound = false;
  const anchored = [...new Set(entries.filter(e => e.ids.length === 1).flatMap(e => e.ids))];
  // An explicit preceding source distinguishes this step from earlier copies
  // in the same chain. Unchanged earlier copies remain separate evidence.
  const priorSource = explicitPriorSources.length === 1 ? explicitPriorSources[0] : undefined;
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
      && current.nodes.get(id)?.lineageId === lineage);
    if (occurrences.length === 1 && targets.every(id => id === occurrences[0]
      || (targets.includes(occurrences[0]) && current.nodes.has(id) && contains(current.nodes.get(id)!, occurrences[0]))
      || movementContextFailure(forest, occurrences[0], id, 'site') === undefined)) {
      structurallyBound ||= targets.length !== 1 || targets[0] !== occurrences[0];
      targets = occurrences;
    }
  }
  // Unfamiliar wording still needs explicit movement direction or an established
  // identity, plus exact anchored occurrences and a changed preceding source slot.
  if ((sources.length === 0 || targets.length === 0) && sources.length <= 1 && targets.length <= 1
    && witnesses.length <= 1 && explicitPriorSources.length <= 1
    && (isMovementIdentity(relation.relation) || priorSource)) {
    const pairs: Array<{ source: string; target: string }> = [];
    for (const sourceId of sources.length ? sources : anchored) {
      const source = current.nodes.get(sourceId);
      if (!source?.lineageId || current.duplicates.has(sourceId)) continue;
      for (const targetId of targets.length ? targets : anchored) {
        const target = current.nodes.get(targetId);
        if (!target || targetId === sourceId || current.duplicates.has(targetId)
          || target.lineageId !== source.lineageId || contains(source, targetId) || contains(target, sourceId)) continue;
        const priorId = prior.nodes.has(sourceId) ? sourceId : explicitPriorSources[0] || targetId;
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
    : [...new Set(explicitPriorSources.length ? explicitPriorSources : [targetId])];
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
  const roles: Record<string, string[]> = {};
  const context: NonNullable<RecoveredMovement['context']> = [];
  const diagnostics: string[] = [];
  entries.forEach(e => {
    const concepts: string[] = [];
    if (e.ids.length === 1 && e.ids[0] === sourceId && (structurallyBound || hasRole(e.key, 'movement.source') || hasRole(e.key, 'movement.witness'))) concepts.push('movement.source');
    if (e.ids.length === 1 && e.ids[0] === witnessId && (structurallyBound || hasRole(e.key, 'movement.source') || hasRole(e.key, 'movement.witness'))) concepts.push('movement.witness');
    if (e.ids.length === 1 && e.ids[0] === targetId && (structurallyBound || hasRole(e.key, 'movement.landing'))) concepts.push('movement.landing');
    if (concepts.length) roles[e.key] = concepts;
    const kind: MovementContextKind | undefined = hasRole(e.key, 'movement.complex') ? 'head-complex'
      : hasRole(e.key, 'movement.host') ? ['landing head', 'receiving head'].includes(e.key) ? 'head-landing' : 'head-host'
      : e.key === 'host' || (hasRole(e.key, 'movement.landing') && !e.ids.includes(targetId)) ? 'site' : undefined;
    if (!kind) return;
    const reason = e.ids.length !== 1 ? 'context-needs-one-exact-node'
      : movementContextFailure(forest, targetId, e.ids[0], kind);
    if (reason) diagnostics.push(`MOVEMENT_CONTEXT_UNPROVEN: anchors.${e.authoredKey} (${e.ids.join(', ')}) for landing ${targetId}: ${reason}. The authored field remains unresolved.`);
    else context.push({ key: e.authoredKey, nodeId: e.ids[0], kind });
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
      transition: priorSourceId !== sourceId || !prior.nodes.has(targetId),
      roles,
      ...(priorAnchorKeys.length ? { priorAnchorKeys } : {}),
      ...(context.length ? { context } : {})
    }
  };
}
