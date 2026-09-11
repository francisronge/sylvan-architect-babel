import type { DerivationStageRelation, SyntaxNode } from '../../types.ts';
import { buildTier2SynonymIndex, lookupTier2SynonymCandidates, normalizeTier2Synonym } from './tier2Synonyms.ts';

export interface RecoveredMovement {
  sourceNodeId: string;
  targetNodeId: string;
  witnessNodeId: string;
  trajectoryKind: 'head' | 'phrasal';
  transition: boolean;
  roles: Record<string, string[]>;
}

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
    key: normalizeTier2Synonym(key), ids: Array.isArray(value) ? value : [value]
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
  const label = (n: SyntaxNode) => String(n.label || '').replace(/[′']/g, '').trim();
  // A head's children are terminals; their words, silence or wordlessness are
  // authored facts, not a spelling test.
  const onlyExponents = (n: SyntaxNode): boolean => !n.children?.length || n.children.every(c => !c.children?.length);
  const complexHead = siblings.length === 1 && label(siblings[0]) === label(parent)
    && onlyExponents(siblings[0]) && !/P$/.test(label(parent)) && !/[′'’]/.test(parent.label);
  const specifier = siblings.some(n => label(n) === label(parent) && !onlyExponents(n));
  const phrase = !onlyExponents(target) || /P$/.test(label(target)) || specifier;
  if (!complexHead && !phrase) return fail('MOVEMENT_CONTEXT_UNRESOLVED', `The anchored structure does not establish a supported head or phrasal landing for ${targetId}.`);
  const roles: Record<string, string[]> = {};
  entries.forEach(e => {
    const concepts: string[] = [];
    if (e.ids.length === 1 && e.ids[0] === sourceId && (hasRole(e.key, 'movement.source') || hasRole(e.key, 'movement.witness'))) concepts.push('movement.source');
    if (e.ids.length === 1 && e.ids[0] === witnessId && (hasRole(e.key, 'movement.source') || hasRole(e.key, 'movement.witness'))) concepts.push('movement.witness');
    if (e.ids.length === 1 && e.ids[0] === targetId && hasRole(e.key, 'movement.landing')) concepts.push('movement.landing');
    if (concepts.length) roles[e.key] = concepts;
  });
  return {
    diagnostics: [],
    movement: {
      sourceNodeId: sourceId, targetNodeId: targetId, witnessNodeId: witnessId,
      trajectoryKind: complexHead ? 'head' : 'phrasal',
      transition: !prior.nodes.has(targetId) && (!silent(before)
        || [...prior.nodes.values()].filter(n => n.lineageId === source.lineageId).length === 1),
      roles
    }
  };
}
