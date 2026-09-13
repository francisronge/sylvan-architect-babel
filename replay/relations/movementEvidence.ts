import type { DerivationStageRelation, SyntaxNode } from '../../types.ts';
import { buildTier2SynonymIndex, lookupTier2SynonymCandidates, normalizeTier2Synonym } from './tier2Synonyms.ts';

export interface RecoveredMovement {
  sourceNodeId: string;
  targetNodeId: string;
  witnessNodeId: string;
  trajectoryKind: 'head' | 'phrasal';
  transition: boolean;
  roles: Record<string, string[]>;
  /** Exact authored fields verified as structural context, not extra dependencies. */
  context?: Array<{ key: string; nodeId: string; kind: MovementContextKind }>;
}

type MovementContextKind = 'site' | 'head-host' | 'head-complex' | 'head-landing';

const categoryLabel = (node: SyntaxNode) => String(node.label || '').replace(/[′']/g, '').trim();
const onlyExponents = (node: SyntaxNode): boolean => !node.children?.length || node.children.every(child => !child.children?.length);
const isHeadComplex = (parent: SyntaxNode, landingId: string): boolean => {
  const siblings = (parent.children || []).filter(node => node.id !== landingId);
  return siblings.length === 1 && categoryLabel(siblings[0]) === categoryLabel(parent)
    && onlyExponents(siblings[0]) && !/P$/.test(categoryLabel(parent)) && !/[′'’]/.test(parent.label);
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
  diagnostics: string[];
}

const vocabulary = buildTier2SynonymIndex();
const hasRole = (key: string, concept: string) => lookupTier2SynonymCandidates(vocabulary, 'role', key).includes(concept);
const genericRoles = new Set(['source', 'origin', 'from', 'target', 'to', 'destination', 'landing', 'landing site', 'filler', 'operator', 'head', 'variable', 'real gap']);

// Recover occurrence identity from the anchored objects, never a shared descendant
// or the relation's title. The result is renderer evidence, not authored syntax.
export function recoverMovementEvidence(
  relation: DerivationStageRelation,
  forest: readonly SyntaxNode[],
  previous: readonly SyntaxNode[] = []
): MovementEvidenceResult {
  const fail = (code: string, reason: string): MovementEvidenceResult => ({ diagnostics: [`${code}: ${reason}`] });
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
  const entries = Object.entries(relation.anchors || {}).map(([key, value]) => ({
    authoredKey: key, key: normalizeTier2Synonym(key), ids: Array.isArray(value) ? value : [value]
  }));
  const pick = (concept: string) => [...new Set(entries.filter(e => hasRole(e.key, concept)).flatMap(e => e.ids))];
  const contains = (n: SyntaxNode, id: string): boolean => n.id === id || (n.children || []).some(c => contains(c, id));
  let sources = pick('movement.source');
  const witnesses = pick('movement.witness');
  if (!sources.length) sources = witnesses;
  let targets = pick('movement.landing');
  // A separately anchored enclosing landing site is not another occurrence.
  // Do not discard unrelated candidates or narrow an authored array this way.
  if (sources.length === 1 && targets.length > 1) {
    const lineage = current.nodes.get(sources[0])?.lineageId;
    const occurrences = targets.filter(id => lineage && current.nodes.get(id)?.lineageId === lineage);
    if (occurrences.length === 1 && targets.every(id => id === occurrences[0]
      || (current.nodes.has(id) && contains(current.nodes.get(id)!, occurrences[0])))
      && entries.filter(e => hasRole(e.key, 'movement.landing')).every(e => e.ids.length === 1)) {
      targets = occurrences;
    }
  }
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
  const before = prior.nodes.get(sourceId);
  if (!before || prior.duplicates.has(sourceId) || before.lineageId !== source.lineageId) {
    return fail('MOVEMENT_PRIOR_SOURCE_UNPROVEN', `${sourceId} has no unique occurrence with matching lineage in the preceding stage.`);
  }
  const explicitPriorSources = Object.entries(relation.priorAnchors || {})
    .filter(([key]) => hasRole(key, 'movement.source'))
    .flatMap(([, value]) => Array.isArray(value) ? value : [value]);
  if (explicitPriorSources.some(id => id !== sourceId)) {
    return fail('MOVEMENT_PRIOR_SOURCE_CONFLICT', `The prior source anchors do not identify ${sourceId}; the source was not replaced with a guessed occurrence.`);
  }
  const lower = current.nodes.get(witnessId);
  const silent = (n: SyntaxNode): boolean => n.silent === true || Boolean(n.children?.length && n.children.every(silent));
  if (!lower || !silent(lower)) return fail('MOVEMENT_LOWER_FORM_UNPROVEN', `${witnessId} is not an authored silent lower occurrence. No silence or trace was inferred.`);
  const parent = current.parents.get(targetId);
  if (!parent) return fail('MOVEMENT_CONTEXT_UNRESOLVED', `${targetId} has no enclosing structure that establishes the supported head or phrasal landing.`);
  const siblings = (parent.children || []).filter(n => n.id !== targetId);
  const complexHead = isHeadComplex(parent, targetId);
  const specifier = siblings.some(n => categoryLabel(n) === categoryLabel(parent) && !onlyExponents(n));
  const phrase = !onlyExponents(target) || /P$/.test(categoryLabel(target)) || specifier;
  if (!complexHead && !phrase) return fail('MOVEMENT_CONTEXT_UNRESOLVED', `The anchored structure does not establish a supported head or phrasal landing for ${targetId}.`);
  const roles: Record<string, string[]> = {};
  const context: NonNullable<RecoveredMovement['context']> = [];
  const diagnostics: string[] = [];
  entries.forEach(e => {
    const concepts: string[] = [];
    if (e.ids.length === 1 && e.ids[0] === sourceId && (hasRole(e.key, 'movement.source') || hasRole(e.key, 'movement.witness'))) concepts.push('movement.source');
    if (e.ids.length === 1 && e.ids[0] === witnessId && (hasRole(e.key, 'movement.source') || hasRole(e.key, 'movement.witness'))) concepts.push('movement.witness');
    if (e.ids.length === 1 && e.ids[0] === targetId && hasRole(e.key, 'movement.landing')) concepts.push('movement.landing');
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
  return {
    diagnostics,
    movement: {
      sourceNodeId: sourceId, targetNodeId: targetId, witnessNodeId: witnessId,
      trajectoryKind: complexHead ? 'head' : 'phrasal',
      transition: !prior.nodes.has(targetId) && (!silent(before)
        || [...prior.nodes.values()].filter(n => n.lineageId === source.lineageId).length === 1),
      roles,
      ...(context.length ? { context } : {})
    }
  };
}
