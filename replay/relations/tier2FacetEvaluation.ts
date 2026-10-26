import { nominalConcordMembers } from './nominalConcord.ts';
import {
  establishesAssignment,
  relationAssertionFailure,
  relationLabelOutcome,
  resolveOutcomeLiteral,
  type OutcomeConcept
} from './outcomeResolver.ts';
import { ownedPFRewriteOutcomes, prepareRewriteRows } from './rewriteLiterals.ts';
import type { Tier2ForestIndexes, TreeIndex } from './tier2EvidenceQueries.ts';
import {
  anchorIds,
  featureNotationStatus,
  focusParent,
  INDEPENDENT_TIER2_ANCHOR_ROLES,
  INDEPENDENT_TIER2_VALUE_ROLES,
  independentFeatureDimensions,
  independentIdiomMemberFields,
  independentPriorThetaArgumentFields,
  independentThetaArgumentFields,
  independentThetaRoleValueFields,
  indexTier2Forests,
  negativeClaimEvidence,
  pairedLiterals,
  projectionChain,
  sameNameValueEntries,
  valueLiterals
} from './tier2EvidenceQueries.ts';
import type {
  Tier2AnchorRequirement,
  Tier2AuthoredEvidenceEntry,
  Tier2FacetEvaluation,
  Tier2FacetEvidence,
  Tier2FacetRecipe,
  Tier2OutputGate,
  Tier2StructuralCheck
} from './tier2FacetTypes.ts';
import { evaluateStructuralCheck } from './tier2StructuralChecks.ts';
import { isPredicationDescription, normalizeTier2Synonym } from './tier2Synonyms.ts';
import { transitionEarned } from './tier2Transitions.ts';

const roleRequirementIds = (
  evidence: Tier2FacetEvidence,
  requirement: Tier2AnchorRequirement
): string[] => anchorIds(evidence, requirement.role, requirement.source);

const requirementSatisfied = (
  evidence: Tier2FacetEvidence,
  requirement: Tier2AnchorRequirement,
  currentIndex: TreeIndex,
  priorIndex: TreeIndex
): boolean => {
  const ids = roleRequirementIds(evidence, requirement);
  if (requirement.optional && ids.length === 0) {
    const entries = requirement.source === 'prior' ? evidence.authoredPriorAnchors : evidence.authoredCurrentAnchors;
    return !entries?.some(entry => entry.concepts.includes(requirement.role));
  }
  if (ids.length < requirement.min) return false;
  if (requirement.max !== undefined && ids.length > requirement.max) return false;
  return ids.every((id) => {
    if (requirement.source === 'current') return currentIndex.nodes.has(id);
    if (requirement.source === 'prior') return priorIndex.nodes.has(id);
    return currentIndex.nodes.has(id) || priorIndex.nodes.has(id);
  });
};

const outcomeFor = (recipeEntry: Tier2FacetRecipe, evidence: Tier2FacetEvidence): OutcomeConcept | null => {
  const literal = valueLiterals(evidence, 'outcome')[0];
  let concept = literal ? resolveOutcomeLiteral(literal)?.concept : null;
  if (!literal) {
    if (['feature.dependency', 'agreement.cycle'].includes(recipeEntry.id))
      concept = relationLabelOutcome(evidence.relationName,
        valueLiterals(evidence, 'case.literal').length ? 'case' : 'agreement');
    else if (recipeEntry.id === 'binding.dependency') concept = relationLabelOutcome(evidence.relationName, 'binding');
    else if (recipeEntry.id === 'movement.path') concept = relationLabelOutcome(evidence.relationName, 'movement');
  }
  const check = recipeEntry.checks.find(check => check.kind === 'negative-claim');
  if (!concept && check?.kind === 'negative-claim') {
    const { outcomes, failure } = negativeClaimEvidence(evidence, check.roles);
    if (outcomes.length && !failure) concept = 'blocked';
  }
  return concept && recipeEntry.acceptedOutcomeConcepts.includes(concept) ? concept : null;
};

const outputGatePasses = (
  gate: Tier2OutputGate,
  recipeEntry: Tier2FacetRecipe,
  evidence: Tier2FacetEvidence,
  currentIndex: TreeIndex,
  outcomeConcept: OutcomeConcept | null
): boolean => {
  switch (gate.kind) {
    case 'always':
      return true;
    case 'accepted-outcome':
      return outcomeConcept !== null && recipeEntry.acceptedOutcomeConcepts.includes(outcomeConcept);
    case 'value-present':
      return valueLiterals(evidence, gate.value).length > 0;
    case 'anchor-present':
      return anchorIds(evidence, gate.role).length > 0;
    case 'anchor-absent':
      return anchorIds(evidence, gate.role).length === 0;
    case 'active-lens':
      return evidence.activeLens === true;
    case 'movement-geometry': {
      const sourceIds = anchorIds(evidence, 'movement.source');
      const landingIds = anchorIds(evidence, 'movement.landing');
      const sourceWorkspaces = new Set(sourceIds.flatMap((id) => [...(currentIndex.workspaceIds.get(id) ?? [])]));
      const landingWorkspaces = new Set(landingIds.flatMap((id) => [...(currentIndex.workspaceIds.get(id) ?? [])]));
      const crossWorkspace = [...sourceWorkspaces].every((workspace) => !landingWorkspaces.has(workspace));
      if (gate.variant === 'cross-workspace') return crossWorkspace;
      if (crossWorkspace) return false;
      const routeValues = valueLiterals(evidence, 'movement.route').map(normalizeTier2Synonym);
      const route = routeValues.includes('orthogonal') ? 'orthogonal' : 'curve';
      return gate.variant === route;
    }
  }
};

const consumedReference = (field: 'anchors' | 'priorAnchors' | 'values', entry: Tier2AuthoredEvidenceEntry, concept: string, itemIndices?: number[]) => {
  const indices = itemIndices ?? entry.conceptItemIndices?.[concept];
  return {
    field, key: entry.key,
    ...(indices && indices.length !== entry.items.length ? { itemIndices: [...indices] } : {})
  };
};

export const evaluateTier2FacetRecipe = (
  recipeEntry: Tier2FacetRecipe,
  evidence: Tier2FacetEvidence,
  indexes: Tier2ForestIndexes = indexTier2Forests(evidence)
): Tier2FacetEvaluation => {
  const { currentIndex, priorIndex } = indexes;
  const failures: string[] = [];
  const ambiguousFields = new Set<string>();
  if (recipeEntry.id === 'feature-sharing') {
    const assertionFailure = relationAssertionFailure(evidence.relationName, 'feature-sharing');
    if (assertionFailure) failures.push(`meaning:${assertionFailure}`);
  }
  if (recipeEntry.id === 'predication.dependency' && isPredicationDescription(evidence.relationName ?? '')) {
    if (!establishesAssignment(evidence)) failures.push('meaning:predication-not-established');
    const predicates = (evidence.authoredCurrentAnchors ?? []).filter(entry => entry.concepts.includes('predicate')
      || /^(?:predicated )?property$/u.test(normalizeTier2Synonym(entry.key)));
    if (predicates.length !== 1) failures.push('meaning:predication-owner-ambiguous');
  }

  // Diagnose the original fields, including optional and prior evidence. An
  // ambiguous lookup must not masquerade as an absent optional field.
  for (const [field, entries, concepts] of [
    ['anchors', evidence.authoredCurrentAnchors, recipeEntry.anchors.filter(r => r.source !== 'prior').map(r => r.role)],
    ['priorAnchors', evidence.authoredPriorAnchors, recipeEntry.anchors.map(r => r.role)],
    ['values', evidence.authoredValues, recipeEntry.values.map(r => r.value)]
  ] as const) {
    for (const concept of new Set(concepts)) {
      if ((field === 'values' ? INDEPENDENT_TIER2_VALUE_ROLES : INDEPENDENT_TIER2_ANCHOR_ROLES).has(concept)) continue;
      const groups = entries?.filter(entry => entry.concepts.includes(concept)) ?? [];
      const associated = field === 'anchors' ? evidence.associatedAnchorKeys?.[concept] : undefined;
      if (associated && associated.length === groups.length
        && groups.every(entry => associated.includes(entry.key))) continue;
      if (field === 'anchors' && concept === 'occurrences' && groups.every(entry => evidence.occurrenceGroupAnchorKeys?.includes(entry.key))) continue;
      if (field === 'values' && concept === 'feature.rows' && independentFeatureDimensions(groups)) continue;
      if (field === 'values' && concept === 'feature.rows' && groups.length > 1
        && groups.every(entry => evidence.comparedFeatureKeys?.includes(entry.key))) continue;
      if (field === 'values' && concept === 'role.label' && independentThetaRoleValueFields(evidence)) continue;
      if (field === 'values' && concept === 'rewrite.rows'
        && groups.some(entry => entry.concepts.includes('rewrite.input.literal'))
        && groups.some(entry => entry.concepts.includes('rewrite.output.literal'))
        && prepareRewriteRows(evidence, groups.flatMap(entry => entry.items.map(value => ({ label: entry.key, value }))))
          .realizationRowKinds.every(kind => kind === 'rewrite')) continue;
      if (field === 'anchors' && concept === 'theta.arguments' && independentThetaArgumentFields(evidence)) continue;
      if (field === 'priorAnchors' && concept === 'theta.arguments' && independentPriorThetaArgumentFields(evidence)) continue;
      if (field === 'anchors' && concept === 'feature.bearers' && nominalConcordMembers(evidence).length) continue;
      if (field === 'anchors' && concept === 'chunks' && independentIdiomMemberFields(evidence)) continue;
      if (field === 'anchors' && concept === 'rewrite.output' && groups.length
        && groups.every(entry => evidence.realizationGroupAnchorKeys?.includes(entry.key))) continue;
      if (field === 'priorAnchors' && concept === 'rewrite.output' && groups.length
        && groups.every(entry => evidence.priorRealizationGroupAnchorKeys?.includes(entry.key))) continue;
      const distinct = new Set(groups.map(entry => JSON.stringify(
        entry.conceptItemIndices?.[concept]?.map(index => entry.items[index]) ?? entry.items
      )));
      if (distinct.size > 1) {
        ambiguousFields.add(`${field}:${concept}`);
        failures.push(`ambiguous-group:${field}:${concept}:${groups.map(entry => entry.key).join('|')}`);
      }
    }
  }

  recipeEntry.anchors.forEach((requirement) => {
    if ((requirement.source !== 'prior' && ambiguousFields.has(`anchors:${requirement.role}`))
      || (requirement.source !== 'current' && ambiguousFields.has(`priorAnchors:${requirement.role}`))) return;
    if (!requirementSatisfied(evidence, requirement, currentIndex, priorIndex)) {
      const ids = roleRequirementIds(evidence, requirement);
      const index = requirement.source === 'prior' ? priorIndex : currentIndex;
      const missing = ids.filter(id => !index.nodes.has(id)
        && !(requirement.source === 'either' && priorIndex.nodes.has(id)));
      failures.push(`anchor:${requirement.source}:${requirement.role}:${missing.length
        ? `unresolved:${missing.join('|')}` : ids.length === 0
          ? 'missing-or-empty' : `cardinality:${ids.length},expected:${requirement.min}..${requirement.max ?? 'many'}`}`);
    }
  });

  recipeEntry.requireAnyRoleGroups.forEach((roles) => {
    const satisfied = roles.some((role) => {
      const requirement = recipeEntry.anchors.find((entry) => entry.role === role);
      return Boolean(requirement && requirementSatisfied(evidence, requirement, currentIndex, priorIndex)
        && roleRequirementIds(evidence, requirement).length > 0);
    });
    if (!satisfied) failures.push(`anchor-any:${roles.join('|')}`);
  });

  recipeEntry.values.forEach((requirement) => {
    if (ambiguousFields.has(`values:${requirement.value}`)) return;
    const pairing = recipeEntry.checks.find((check): check is Extract<Tier2StructuralCheck, { kind: 'paired-values' }> =>
      check.kind === 'paired-values' && check.value === requirement.value);
    const literals = (pairing && pairedLiterals(evidence, pairing.role, requirement.value)) || valueLiterals(evidence, requirement.value);
    if (requirement.optional && literals.length === 0
      && !evidence.authoredValues?.some(entry => entry.concepts.includes(requirement.value))) return;
    if (literals.length < requirement.min || (requirement.max !== undefined && literals.length > requirement.max)
      || (requirement.nonBlank && literals.some(literal => !literal.trim()))) {
      failures.push(`value:${requirement.value}`);
    }
  });

  const outcomeConcept = outcomeFor(recipeEntry, evidence);
  if (recipeEntry.values.some(requirement => requirement.value === 'outcome')
    && valueLiterals(evidence, 'outcome').length > 0 && !outcomeConcept) failures.push('value:outcome-not-accepted');
  recipeEntry.checks.forEach((check) => {
    if (ambiguousFields.size) return;
    const result = evaluateStructuralCheck(check, recipeEntry, evidence, currentIndex, outcomeConcept, priorIndex);
    if (result !== true) {
      failures.push(typeof result === 'string' ? `check:${check.kind}:${result}`
        : check.kind === 'prior-source-consistency'
          ? `priorAnchors:${check.role}:${anchorIds(evidence, check.role, 'prior').join('|')}:conflicts-with-current-source:${anchorIds(evidence, check.role).join('|')}`
          : check.kind === 'explicit-role'
            ? `meaning:${check.roles.join('|')}:${check.roles.some(role => anchorIds(evidence, role).length)
              ? 'only-contextual-role-aliases' : 'not-explicitly-authored'}`
            : `check:${check.kind}`);
    }
  });

  const complete = failures.length === 0;
  const consumedEvidence = complete
    ? [
      ...(['movement.path', 'movement.carrier'].includes(recipeEntry.id)
        ? (evidence.movement?.context || []).map(({ key }) => ({ field: 'anchors' as const, key })) : []),
      ...(['movement.path', 'movement.carrier'].includes(recipeEntry.id)
        ? (evidence.movement?.priorContextKeys || []).map(key => ({ field: 'priorAnchors' as const, key })) : []),
      ...(recipeEntry.id === 'correspondence.alignment' ? (evidence.correspondenceRoleWitnesses ?? [])
        .map(entry => ({ field: 'values' as const, key: entry.key, itemIndices: [0] })) : []),
      ...recipeEntry.anchors.flatMap((requirement) => {
        const entries = requirement.source === 'current'
          ? [
            { field: 'anchors' as const, entries: evidence.authoredCurrentAnchors ?? [] },
            /* Same-role prior anchors are replacement evidence for this claim. */
            {
              field: 'priorAnchors' as const, entries: ['movement.path', 'movement.carrier'].includes(recipeEntry.id)
                ? (evidence.authoredPriorAnchors ?? []).filter(entry => evidence.movement?.priorAnchorKeys?.includes(entry.key))
                : evidence.authoredPriorAnchors ?? []
            }
          ]
          : requirement.source === 'prior'
            ? [{ field: 'priorAnchors' as const, entries: evidence.authoredPriorAnchors ?? [] }]
            : [
              { field: 'anchors' as const, entries: evidence.authoredCurrentAnchors ?? [] },
              { field: 'priorAnchors' as const, entries: evidence.authoredPriorAnchors ?? [] }
            ];
        return entries.flatMap(({ field, entries: authoredEntries }) =>
          authoredEntries
            .filter(({ concepts, items }) => (
              concepts.includes(requirement.role) && items.length > 0
            ))
            .map(entry => consumedReference(field, entry, requirement.role)));
      }),
      ...recipeEntry.checks.flatMap((check) => {
        if (check.kind === 'native-rewrite') return ownedPFRewriteOutcomes(evidence)
          .map(entry => ({ field: 'values' as const, key: entry.key }));
        if (check.kind === 'rebracketing-configuration') return (evidence.authoredValues ?? [])
          .filter(entry => ['beforeGroupSizes', 'afterGroupSizes'].includes(entry.key))
          .map(entry => ({ field: 'values' as const, key: entry.key }));
        if (check.kind !== 'paired-values' && check.kind !== 'feature-dependency') return [];
        const [role, valueConcept] = check.kind === 'paired-values'
          ? [check.role, check.value] : ['feature.target', 'case.literal'];
        return (evidence.authoredCurrentAnchors ?? [])
          .filter(entry => entry.concepts.includes(role) && entry.items.length > 0)
          .flatMap(entry => {
            const candidates = sameNameValueEntries(evidence, entry, role);
            const paired = candidates[0];
            if (candidates.length !== 1 || paired.items.length !== paired.anchorLength) return [];
            const optional = check.kind === 'paired-values' && Boolean(check.optional);
            const indices = paired.items.flatMap((item, index) => (!optional || item.trim().length > 0) ? [index] : []);
            return indices.length ? [consumedReference('values', paired, valueConcept, indices)] : [];
          });
      }),
      ...recipeEntry.values.flatMap((requirement) => (
        (evidence.authoredValues ?? [])
          .filter(({ concepts, items }) => (
            concepts.includes(requirement.value) && items.length > 0
          ))
          .flatMap(entry => {
            const tokenCheck = recipeEntry.checks.find((check): check is Extract<Tier2StructuralCheck, { kind: 'value-token' }> =>
              check.kind === 'value-token' && check.value === requirement.value);
            const optionalPair = recipeEntry.checks.some(check => check.kind === 'paired-values'
              && check.optional && check.value === requirement.value);
            const indices = (entry.conceptItemIndices?.[requirement.value] ?? entry.items.map((_, index) => index))
              .filter(index => (!tokenCheck || featureNotationStatus(entry.items[index], tokenCheck.tokens) === 'affirmative')
                && (!optionalPair || entry.items[index].trim().length > 0));
            return indices.length ? [consumedReference('values', entry, requirement.value, indices)] : [];
          })
      ))
    ].filter((entry, index, entries) => entries.findIndex((candidate) => (
      candidate.field === entry.field && candidate.key === entry.key
    )) === index)
    : [];
  return {
    complete,
    failures,
    outcomeConcept,
    outputs: complete
      ? recipeEntry.outputs
        .filter((entry) => outputGatePasses(entry.gate, recipeEntry, evidence, currentIndex, outcomeConcept))
        .map((entry) => entry.piece)
      : [],
    earnedTransitions: complete
      ? recipeEntry.transitionRules
        .filter((rule) => transitionEarned(rule, recipeEntry, evidence, currentIndex, priorIndex))
        .map((rule) => rule.kind)
      : [],
    ...(complete && recipeEntry.id === 'focus.prominence' ? { structuralWitness: { branchParentNodeId: focusParent(evidence, currentIndex) } } : {}),
    ...(complete && recipeEntry.id === 'focus.projection' ? { structuralWitness: { projectionNodeIds: projectionChain(evidence) } } : {}),
    consumedEvidence
  };
};
