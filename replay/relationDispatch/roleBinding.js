import { buildTier2FacetEvidence } from '../relations/relationEvidence.ts';
import { nativeThetaAssignments } from '../relations/compoundAssignments.ts';
import { buildTier2SynonymIndex, normalizeTier2Synonym, relationRoleConcepts } from '../relations/tier2Synonyms.ts';
import { movementContextFailure, recoverMovementEvidence } from '../relations/movementEvidence.ts';
import { authoredOutcomeLiterals, hasUnestablishedCovertMovementOutcome, negativeClaimFailure, resolveOutcomeLiteral } from '../relations/outcomeResolver.ts';
import { PRODUCTION_RENDER_FAMILIES, PRODUCTION_SCALAR_VALUE_KEYS } from '../relations/renderFamilies.ts';

import { productionValueRules } from './productionRoleConcepts.js';

const items = value => Array.isArray(value) ? value : [value];
const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
const roleVocabulary = buildTier2SynonymIndex();
const MOVEMENT_ENDPOINTS = new Set(['movement.source', 'movement.witness', 'movement.landing']);
/** The slot concept each proved movement endpoint fills in a registered
 * design that draws a displacement: a trajectory's own endpoints, or the lower
 * and raised occurrences of the covert QR path. */
const PROVED_ENDPOINT_SLOTS = entryId => entryId.startsWith('trajectory.')
  ? { 'movement.source': 'movement.source', 'movement.witness': 'movement.witness', 'movement.landing': 'movement.landing' }
  : entryId === 'qr.covert' ? { 'movement.source': 'scope.source', 'movement.landing': 'scope.landing' } : undefined;
/** The head-context role a node holds beside a head landing: the host head it
 * adjoins to, or the complex the adjunction forms. */
const headContextSlot = (currentForest, priorForest, landingId, nodeId) =>
  movementContextFailure(currentForest, landingId, nodeId, 'head-host', priorForest) === undefined ? 'hostHead'
    : movementContextFailure(currentForest, landingId, nodeId, 'head-complex', priorForest) === undefined ? 'complexHead'
      : undefined;

// Binding changes lookup keys only. `vocabulary` is the claim's synonym index,
// which a saved Jev reading (`replay/relations/jev.ts`) may extend for its own keys. Authored text, item order, cardinality and
// references stay intact; ambiguous meanings never select the first candidate.
export const bindRelationRoles = (relation, entry, currentForest, priorForest, structuralMovement = undefined,
  vocabulary = roleVocabulary) => {
  const bindings = [];
  const issues = [];
  const bound = { ...relation };
  // A structural movement stands in only where wording proves none.
  const endpointSlots = PROVED_ENDPOINT_SLOTS(entry.id);
  const movement = endpointSlots && currentForest
    ? recoverMovementEvidence(relation, currentForest, priorForest).movement ?? structuralMovement : undefined;
  // Structure, not spelling, decides which of several directional fields names
  // the moving occurrence. When the tree proves another field to be that
  // endpoint, an openly named field it verifies as the occurrence's host,
  // complex, site or carried member is context and does not compete for the
  // slot; so is one whose node contains that proven endpoint, such as the
  // clause it leaves or lands in. A registered role name keeps its declared
  // slot unless the movement evidence verifies its node as the proven
  // landing's site, host or complex.
  const structuralContext = new Set((movement?.context ?? [])
    .filter(({ key }) => !movement.roles[normalizeTier2Synonym(key)]?.length).map(({ key }) => key));
  // Only these contexts describe where the landing went; a carried head member
  // does not.
  const landingContext = new Set((movement?.context ?? []).filter(({ key, kind }) => structuralContext.has(key)
    && kind !== 'head-member').map(({ key }) => key));
  const forestNodes = [];
  if (movement) currentForest.forEach(function visit(node) { forestNodes.push(node); (node.children || []).forEach(visit); });
  const provenEndpointId = concept => concept === 'movement.source' ? movement?.sourceNodeId
    : concept === 'movement.witness' ? movement?.witnessNodeId : concept === 'movement.landing' ? movement?.targetNodeId : undefined;
  const containsProvenEndpoint = (value, concept) => {
    const ids = items(value), endpoint = provenEndpointId(concept);
    const nodes = ids.length === 1 ? forestNodes.filter(node => node.id === ids[0]) : [];
    if (!endpoint || nodes.length !== 1 || nodes[0].id === endpoint) return false;
    const holds = node => (node.children || []).some(child => child.id === endpoint || holds(child));
    return holds(nodes[0]);
  };
  for (const field of ['anchors', 'priorAnchors', 'values']) {
    const signature = entry.signature[field];
    const rules = { ...(field === 'values' && entry.signature.anchors.allowContext ? productionValueRules(entry.id) : {}),
      ...signature.required, ...signature.optional };
    if (!isRecord(relation[field]) || !Object.values(rules).some(rule => rule.aliases)) continue;
    const groups = [...signature.requiredAny, ...signature.requiredAlternatives.flat(), ...signature.equivalentRoles];
    const sameSlot = (a, b) => a === b || (rules[a]?.concept && rules[a].concept === rules[b]?.concept
      && groups.some(group => group.includes(a) && group.includes(b)));
    const candidatesFor = key => {
      const spelling = normalizeTier2Synonym(key);
      const concepts = field === 'values' ? [] : relationRoleConcepts(vocabulary, key,
        { anchors: relation[field], values: relation.values, forest: field === 'priorAnchors' ? priorForest : currentForest });
      const spelled = Object.keys(rules).filter(role => role === key
        || (rules[role].aliases && normalizeTier2Synonym(role) === spelling));
      // A proven origin inside an independently named goal is context, even
      // though its open role spelling is also a probe alias elsewhere.
      if (!spelled.length && concepts.includes('feature.origin-context')) return { spelled, candidates: [] };
      const candidates = spelled.length ? spelled : Object.keys(rules).filter(role =>
        rules[role].aliases && (rules[role].aliases.some(alias => normalizeTier2Synonym(alias) === spelling)
          || concepts.includes(rules[role].concept)));
      return { spelled, candidates };
    };
    // A field that only reads as an endpoint slot the tree proves another field
    // to fill, whatever that field is called; structural recovery below binds
    // the proven field to the slot. Any other field reading as that slot still
    // competes for it, so the claim stays as malformed as it was authored.
    // A registered role name is context only as a landing word whose node is
    // the proven landing's verified site, host or complex; a carried member or
    // a node containing the endpoint is not enough for it.
    const proven = (authoredRole, concept) => movement.roles[normalizeTier2Synonym(authoredRole)]?.includes(concept);
    const contextFor = (authoredRole, value, concept) => !proven(authoredRole, concept)
      && (candidatesFor(authoredRole).spelled.length
        ? concept === 'movement.landing' && landingContext.has(authoredRole)
        : structuralContext.has(authoredRole) || containsProvenEndpoint(value, concept));
    const contextBesideProvenEndpoint = (authoredRole, value, concept) => MOVEMENT_ENDPOINTS.has(concept)
      && contextFor(authoredRole, value, concept)
      && Object.keys(relation[field]).some(other => other !== authoredRole && proven(other, concept))
      && Object.entries(relation[field]).every(([other, otherValue]) => other === authoredRole || proven(other, concept)
        || contextFor(other, otherValue, concept)
        || !candidatesFor(other).candidates.some(role => rules[role].concept === concept));
    const record = Object.create(null);
    const assigned = [];
    for (const [authoredRole, value] of Object.entries(relation[field])) {
      const { spelled, candidates: meanings } = candidatesFor(authoredRole);
      // In head-movement terminology a registered landing word such as
      // `target` can name the head the moved head adjoins to. When the tree
      // proves another field, whatever it is called, to be the landing and this
      // field's node to be that landing's host or head complex, it binds as
      // that context role and is checked as one below; it never becomes a
      // second landing.
      const headContextRole = field === 'anchors' && entry.id === 'trajectory.head' && spelled.length
        && structuralContext.has(authoredRole) && items(value).length === 1
        && spelled.every(role => rules[role].concept === 'movement.landing')
        && Object.keys(relation[field]).some(other => other !== authoredRole && proven(other, 'movement.landing'))
        ? headContextSlot(currentForest, priorForest, movement.targetNodeId, items(value)[0]) : undefined;
      // Context beside a proven endpoint keeps its authored field. A registered
      // role name would still read as the slot there, so the bound claim omits
      // it; the authored relation keeps it.
      if (!headContextRole && field === 'anchors' && movement && meanings.length
        && meanings.every(role => contextBesideProvenEndpoint(authoredRole, value, rules[role].concept))) {
        if (!spelled.length) record[authoredRole] = value;
        continue;
      }
      let candidates = headContextRole ? [headContextRole] : meanings;
      if (candidates.length > 1) {
        const arityMatches = candidates.filter(role => items(value).length >= rules[role].minItems
          && (rules[role].maxItems === null || items(value).length <= rules[role].maxItems));
        if (arityMatches.length) candidates = arityMatches;
      }
      // Open slots may use these words for independent participants. A synonym
      // must not overwrite that evidence or compete with an explicit slot.
      if (field !== 'values' && signature.allowAdditional && !spelled.length && candidates.length) {
        const ambiguous = !candidates.every(role => sameSlot(role, candidates[0]));
        const competing = Object.entries(relation[field]).some(([other, otherValue]) => other !== authoredRole
          && JSON.stringify(items(otherValue)) !== JSON.stringify(items(value))
          && candidatesFor(other).candidates.some(role => candidates.some(candidate => sameSlot(role, candidate))));
        if (ambiguous || competing) {
          record[authoredRole] = value;
          continue;
        }
      }
      if (candidates.length > 1 && !candidates.every(role => sameSlot(role, candidates[0]))) {
        issues.push({ kind: 'ambiguous-role-binding', field, role: authoredRole, candidates });
        record[authoredRole] = value;
        continue;
      }
      const role = candidates[0] || authoredRole;
      if (candidates.length) {
        const conflict = assigned.find(previous => sameSlot(previous.role, role)
          && JSON.stringify(items(previous.value)) !== JSON.stringify(items(value)));
        if (conflict) issues.push({ kind: 'conflicting-role-bindings', field,
          roles: [conflict.authoredRole, authoredRole], references: [conflict.value, value] });
        assigned.push({ role, authoredRole, value });
        bindings.push({ field, authoredRole, role, ...(rules[role].concept ? { concept: rules[role].concept } : {}) });
      }
      record[role] = value;
    }
    bound[field] = { ...record };
  }

  // Structural recovery binds existing authored occurrences before the unchanged
  // signature is checked. One lower occurrence may fill both source and witness;
  // this adds lookup slots, never another node or an authored field. Covert QR
  // reads the same proof: its lower and raised occurrences are the movement's
  // source and landing, so open participant names need no new aliases.
  if (endpointSlots && currentForest && issues.length === 0) {
    if (movement) {
      const rules = { ...entry.signature.anchors.required, ...entry.signature.anchors.optional };
      const requiredRoles = new Set([...Object.keys(entry.signature.anchors.required),
        ...entry.signature.anchors.requiredAny.flat(), ...entry.signature.anchors.requiredAlternatives.flat(2)]);
      for (const [endpoint, concept] of Object.entries(endpointSlots)) {
        if (Object.keys(bound.anchors || {}).some(role => rules[role]?.concept === concept)) continue;
        const role = Object.keys(rules).find(key => requiredRoles.has(key) && rules[key].concept === concept);
        if (!role) continue;
        for (const [authoredRole, value] of Object.entries(relation.anchors || {})) {
          if (!movement.roles[normalizeTier2Synonym(authoredRole)]?.includes(endpoint)) continue;
          bound.anchors[role] = value;
          if (!Object.hasOwn(rules, authoredRole)) delete bound.anchors[authoredRole];
          bindings.push({ field: 'anchors', authoredRole, role, concept });
        }
      }
    }
  }

  // A bare "head" can name the host instead of the moved occurrence. Only
  // shared root identity can establish that it is an equivalent landing role.
  const genericHead = bindings.find(binding => binding.field === 'anchors'
    && binding.concept === 'movement.landing' && normalizeTier2Synonym(binding.authoredRole) === 'head');
  if (genericHead && issues.length === 0) {
    const sources = bindings.filter(binding => binding.field === 'anchors' && binding.concept === 'movement.source')
      .flatMap(binding => items(bound.anchors[binding.role]));
    const targets = items(bound.anchors[genericHead.role]);
    const nodes = [];
    const visit = node => { nodes.push(node); (node.children || []).forEach(visit); };
    (currentForest || []).forEach(visit);
    const uniqueNode = id => nodes.filter(node => node.id === id);
    const source = [...new Set(sources)].length === 1 ? uniqueNode(sources[0]) : [];
    const target = targets.length === 1 ? uniqueNode(targets[0]) : [];
    if (source.length !== 1 || target.length !== 1 || source[0].id === target[0].id
      || !source[0].lineageId || source[0].lineageId !== target[0].lineageId) {
      issues.push({ kind: 'movement-landing-unproven', field: 'anchors', role: genericHead.authoredRole,
        reason: 'head-does-not-identify-a-unique-occurrence-with-the-source-root-lineage' });
    }
  }

  // Extra head-context anchors are accepted only as the actual host and complex
  // of the named landing, never as arbitrary additional participants.
  if (entry.id === 'trajectory.head' && isRecord(bound.anchors)) {
    const anchors = bound.anchors;
    const contextRoles = ['hostHead', 'complexHead'].filter(role => Object.hasOwn(anchors, role));
    if (contextRoles.length && issues.length === 0) {
      const roles = { ...entry.signature.anchors.required, ...entry.signature.anchors.optional };
      const landings = [...new Set(Object.keys(anchors).filter(role => roles[role]?.concept === 'movement.landing').flatMap(role => items(anchors[role])))];
      for (const role of contextRoles) {
        const ids = items(anchors[role]);
        if (ids.length !== 1 || landings.length !== 1) continue;
        const authoredRole = bindings.find(binding => binding.field === 'anchors' && binding.role === role)?.authoredRole || role;
        const landingContext = ['landing head', 'receiving head'].includes(normalizeTier2Synonym(authoredRole));
        const reason = currentForest ? movementContextFailure(currentForest, landings[0], ids[0],
          role === 'complexHead' ? 'head-complex' : landingContext ? 'head-landing' : 'head-host', priorForest) : 'workspace-required';
        if (reason) issues.push({ kind: 'head-context-unproven', field: 'anchors',
          role: authoredRole,
          nodeId: ids[0], landing: landings[0],
          reason });
      }
    }
  }
  if (entry.id === 'trajectory.head' && currentForest && issues.length === 0) {
    if (movement?.trajectoryKind === 'phrasal') issues.push({
      kind: 'movement-kind-conflict', reason: 'MOVEMENT_KIND_CONFLICT',
      registeredKind: 'head', structuralKind: movement.trajectoryKind,
      sourceNodeId: movement.sourceNodeId, targetNodeId: movement.targetNodeId
    });
  }
  if (entry.id === 'qr.covert' && hasUnestablishedCovertMovementOutcome(relation.values)) {
    issues.push({ kind: 'covert-movement-not-established', field: 'values',
      reason: 'The QR primitive requires an established dependency; the authored outcome denies or defers it.' });
  }
  if (entry.signature.anchors.allowContext) {
    const family = PRODUCTION_RENDER_FAMILIES[entry.id]?.family;
    for (const key of PRODUCTION_SCALAR_VALUE_KEYS[family] || []) {
      const literals = key === 'outcome' ? authoredOutcomeLiterals(relation.values)
        : bound.values?.[key] === undefined ? [] : items(bound.values[key]);
      if (literals.length > 1) issues.push({ kind: 'drawing-value-cardinality', field: 'values', role: key,
        observedItems: literals.length, maxItems: 1, offendingValue: literals,
        reason: 'This drawing has one literal slot; no item was selected from the authored list.' });
    }
    const outcomeLiterals = authoredOutcomeLiterals(relation.values);
    const outcomes = outcomeLiterals.map(value => resolveOutcomeLiteral(value)?.concept).filter(Boolean);
    if (new Set(outcomes).size > 1) issues.push({ kind: 'ambiguous-outcome-values', field: 'values', outcomes });
    const blockingRole = { 'transfer.blocked-access': 'target', 'intervention.blocked-path': 'intervener' }[entry.id];
    if (blockingRole) {
      const roles = bindings.filter(binding => binding.field === 'anchors' && binding.role === blockingRole)
        .map(binding => binding.authoredRole);
      const reason = negativeClaimFailure(outcomeLiterals, roles);
      if (reason) issues.push({ kind: 'negative-claim-unproven', field: 'values', reason,
        roles, literals: outcomeLiterals });
    }
    if (entry.id === 'improper-movement.landing') {
      const hosts = concept => bindings.filter(binding => binding.field === 'anchors' && binding.concept === concept)
        .flatMap(binding => items(relation.anchors[binding.authoredRole]));
      const rejected = hosts('rejected.hosts');
      const conflicts = hosts('licensed.hosts').filter(id => rejected.includes(id));
      if (conflicts.length) issues.push({ kind: 'candidate-outcome-conflict', field: 'anchors', nodeIds: [...new Set(conflicts)] });
    }
  }
  if (entry.id === 'theta.grid' && !issues.length) {
    const result = nativeThetaAssignments(buildTier2FacetEvidence({ relation: bound, currentForest: currentForest ?? [] }));
    if (!result.assignments) issues.push({ kind: 'theta-assignments-unproven', field: 'anchors',
      role: 'predicate', reason: result.error });
    else if (currentForest) {
      const counts = new Map();
      const visit = node => { counts.set(node.id, (counts.get(node.id) ?? 0) + 1); node.children?.forEach(visit); };
      currentForest.forEach(visit);
      const ids = result.assignments.flatMap(assignment => [assignment.predicate, ...assignment.roles.map(role => role.nodeId)]);
      if (ids.some(id => counts.get(id) !== 1)) issues.push({ kind: 'theta-assignments-unproven', field: 'anchors',
        role: 'predicate', reason: 'Assignment participants must resolve to unique current occurrences.' });
    }
  }
  return { relation: bound, bindings, issues };
};
