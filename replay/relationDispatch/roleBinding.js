import { buildTier2FacetEvidence } from '../relations/relationEvidence.ts';
import { nativeThetaAssignments } from '../relations/compoundAssignments.ts';
import { buildTier2SynonymIndex, normalizeTier2Synonym, relationRoleConcepts } from '../relations/tier2Synonyms.ts';
import { movementContextFailure, recoverMovementEvidence } from '../relations/movementEvidence.ts';
import { authoredOutcomeLiterals, negativeClaimFailure, resolveOutcomeLiteral } from '../relations/outcomeResolver.ts';
import { PRODUCTION_RENDER_FAMILIES, PRODUCTION_SCALAR_VALUE_KEYS } from '../relations/renderFamilies.ts';

import { productionValueRules } from './productionRoleConcepts.js';

const items = value => Array.isArray(value) ? value : [value];
const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
const roleVocabulary = buildTier2SynonymIndex();

// Binding changes lookup keys only. Authored text, item order, cardinality and
// references stay intact; ambiguous meanings never select the first candidate.
export const bindRelationRoles = (relation, entry, currentForest, priorForest) => {
  const bindings = [];
  const issues = [];
  const bound = { ...relation };
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
      const concepts = field === 'values' ? [] : relationRoleConcepts(roleVocabulary, key,
        { anchors: relation[field], values: relation.values });
      const spelled = Object.keys(rules).filter(role => role === key
        || (rules[role].aliases && normalizeTier2Synonym(role) === spelling));
      const candidates = spelled.length ? spelled : Object.keys(rules).filter(role =>
        rules[role].aliases && (rules[role].aliases.some(alias => normalizeTier2Synonym(alias) === spelling)
          || concepts.includes(rules[role].concept)));
      return { spelled, candidates };
    };
    const record = Object.create(null);
    const assigned = [];
    for (const [authoredRole, value] of Object.entries(relation[field])) {
      const { spelled, candidates: meanings } = candidatesFor(authoredRole);
      let candidates = meanings;
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
  // this adds lookup slots, never another node or an authored field.
  if (entry.id.startsWith('trajectory.') && currentForest && issues.length === 0) {
    const { movement } = recoverMovementEvidence(relation, currentForest, priorForest);
    if (movement) {
      const rules = { ...entry.signature.anchors.required, ...entry.signature.anchors.optional };
      const requiredRoles = new Set([...Object.keys(entry.signature.anchors.required),
        ...entry.signature.anchors.requiredAny.flat(), ...entry.signature.anchors.requiredAlternatives.flat(2)]);
      for (const concept of ['movement.source', 'movement.witness', 'movement.landing']) {
        if (Object.keys(bound.anchors || {}).some(role => rules[role]?.concept === concept)) continue;
        const role = Object.keys(rules).find(key => requiredRoles.has(key) && rules[key].concept === concept);
        if (!role) continue;
        for (const [authoredRole, value] of Object.entries(relation.anchors || {})) {
          if (!movement.roles[normalizeTier2Synonym(authoredRole)]?.includes(concept)) continue;
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
        const reason = currentForest ? movementContextFailure(currentForest, landings[0], ids[0],
          role === 'complexHead' ? 'head-complex' : 'head-host') : 'workspace-required';
        if (reason) issues.push({ kind: 'head-context-unproven', field: 'anchors',
          role: bindings.find(binding => binding.field === 'anchors' && binding.role === role)?.authoredRole || role,
          nodeId: ids[0], landing: landings[0],
          reason });
      }
    }
  }
  if (entry.id === 'trajectory.head' && currentForest && issues.length === 0) {
    const { movement } = recoverMovementEvidence(relation, currentForest, priorForest);
    if (movement?.trajectoryKind === 'phrasal') issues.push({
      kind: 'movement-kind-conflict', reason: 'MOVEMENT_KIND_CONFLICT',
      registeredKind: 'head', structuralKind: movement.trajectoryKind,
      sourceNodeId: movement.sourceNodeId, targetNodeId: movement.targetNodeId
    });
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
  if (entry.id === 'theta.grid' && new Set(items(bound.anchors?.predicate ?? [])).size > 1 && !issues.length) {
    const result = currentForest && nativeThetaAssignments(buildTier2FacetEvidence({ relation, currentForest }));
    if (!result?.assignments) issues.push({ kind: 'theta-assignments-unproven', field: 'anchors',
      role: 'predicate', reason: result?.error || 'workspace-required' });
  }
  return { relation: bound, bindings, issues };
};
