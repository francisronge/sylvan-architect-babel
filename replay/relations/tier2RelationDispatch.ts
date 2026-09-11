/**
 * Claim-level renderer-tier dispatch for one authored relation envelope.
 *
 * A raw model relation is evidence, not the unit of tier ownership. Babel
 * extracts independent claims first, then gives each claim exactly one owner:
 * Tier 1 for a valid registered primary, Tier 2 for a complete structural
 * facet, or Tier 3 for an unrecoverable primary. Tier 2 never repairs the
 * generic twin of a malformed registered primary.
 */
import type {
  DerivationStageRelation,
  SyntaxNode
} from '../../types.ts';
import {
  dispatchRelation,
  findRelationRegistryEntry,
  productionRelationRegistry
} from '../relationDispatch/index.js';
import { resolveOutcomeLiteral } from './outcomeResolver.ts';
import { recoverMovementEvidence } from './movementEvidence.ts';
import { PRODUCTION_RENDER_FAMILIES } from './renderFamilies.ts';
import {
  TIER2_FACET_RECIPES,
  INDEPENDENT_TIER2_ANCHOR_ROLES,
  INDEPENDENT_TIER2_VALUE_ROLES,
  buildTier2FacetIdentity,
  buildTier2FacetOutputIdentities,
  evaluateTier2FacetRecipe,
  type Tier2AuthoredEvidenceEntry,
  type Tier2FacetEvidence,
  type Tier2FacetEvaluation,
  type Tier2FacetOutputIdentity,
  type Tier2FacetRecipe
} from './tier2FacetRecipes.ts';
import {
  buildTier2SynonymIndex,
  lookupTier2SynonymCandidates,
  normalizeTier2Synonym,
  type Tier2SynonymIndex,
  type Tier2SynonymScope
} from './tier2Synonyms.ts';

type Tier1Dispatch = ReturnType<typeof dispatchRelation>;

export type Tier2ResolvedFacet = {
  recipe: Tier2FacetRecipe;
  evaluation: Tier2FacetEvaluation;
  facetIdentity: string;
  outputIdentities: Tier2FacetOutputIdentity[];
  parentFacetIds: string[];
};

type Tier2EvaluatedFacet = Pick<Tier2ResolvedFacet, 'recipe' | 'evaluation'>;

export type Tier2CollisionDiagnostic = {
  kind: 'ambiguous-facets' | 'more-specific-facet' | 'contradictory-evidence' | 'unrecovered-evidence';
  collision: string;
  facets: string[];
  winner?: string;
};

type ClaimDispatchBase = {
  relationInstance: { stageIndex: number; relationIndex: number };
  authoredRelationName: string;
  tier1Dispatch: Tier1Dispatch;
  /** The same interpretation is used by drawing and Replay. */
  evidence: Tier2FacetEvidence;
  facetDiagnostics: Array<{ facetId: string; failures: string[] }>;
};

export type RecoveredEvidenceReference = {
  field: 'anchors' | 'priorAnchors' | 'values';
  key: string;
  itemIndices?: number[];
};

export type Tier1RecoveredClaim = {
  tier: 1;
  kind: 'registered-primary';
  canonicalClaimIdentity: string;
  registryEntryId: string;
  consumedEvidence: RecoveredEvidenceReference[];
};

export type Tier2RecoveredClaim = {
  tier: 2;
  kind: 'structural-facet';
  canonicalClaimIdentity: string;
  facet: Tier2ResolvedFacet;
  consumedEvidence: RecoveredEvidenceReference[];
};

export type Tier3RecoveredClaim = {
  tier: 3;
  kind: 'fallback-primary' | 'fallback-residual';
  canonicalClaimIdentity: string;
  reason:
    | 'registered-signature-incomplete'
    | 'no-complete-tier2-facet'
    | 'unconsumed-envelope-evidence';
  consumedEvidence: RecoveredEvidenceReference[];
};

export type RecoveredClaim =
  | Tier1RecoveredClaim
  | Tier2RecoveredClaim
  | Tier3RecoveredClaim;

export type RelationEvidenceCoverage = {
  /** Full authored context, not a claim reconstructed from leftover fields. */
  authoredRelation: DerivationStageRelation;
  fields: Array<{
    field: RecoveredEvidenceReference['field'];
    key: string;
    concepts: string[];
    recognizedBy: Array<{ claim: string; tier: 1 | 2; itemIndices: number[] }>;
    unrecoveredItemIndices: number[];
    unrecoveredEmptyField: boolean;
  }>;
};

export type RelationClaimDispatch = ClaimDispatchBase & {
  evidenceCoverage: RelationEvidenceCoverage;
  primaryClaim: Tier1RecoveredClaim | Tier3RecoveredClaim | null;
  claims: RecoveredClaim[];
  facets: Tier2ResolvedFacet[];
  diagnostics: Tier2CollisionDiagnostic[];
  /** The primary evidence after independent claim evidence is removed. */
  primaryRelation: DerivationStageRelation;
  /** Internal role lookup; original spelling remains in primaryRelation. */
  boundPrimaryRelation: DerivationStageRelation;
  residualRelation?: DerivationStageRelation;
};

export type ExclusiveRelationDispatchInput = {
  relation: DerivationStageRelation;
  stageIndex: number;
  relationIndex: number;
  currentForest: readonly SyntaxNode[];
  priorForest?: readonly SyntaxNode[];
  activeLens?: boolean;
  registry?: typeof productionRelationRegistry;
  synonymIndex?: Tier2SynonymIndex;
};

export type RelationClaimDispatchEntry = {
  relation: DerivationStageRelation;
  dispatch: RelationClaimDispatch;
};

export type ExclusiveRelationBatchDispatchInput = Omit<
  ExclusiveRelationDispatchInput,
  'relation' | 'relationIndex'
> & {
  relations: readonly DerivationStageRelation[];
};

const DEFAULT_SYNONYM_INDEX = buildTier2SynonymIndex();

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = canonicalize((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }
  return value;
};

const primaryClaimIdentity = (
  relation: DerivationStageRelation,
  registryEntryId?: string,
  kind: Tier1RecoveredClaim['kind'] | Tier3RecoveredClaim['kind'] = 'registered-primary'
): string => JSON.stringify(canonicalize({
  kind,
  identity: registryEntryId ?? normalizeTier2Synonym(relation.relation),
  anchors: relation.anchors ?? {},
  priorAnchors: relation.priorAnchors ?? null,
  values: relation.values ?? null
}));

const authoredEvidenceReferences = (
  relation: DerivationStageRelation
): RecoveredEvidenceReference[] => (
  (['anchors', 'priorAnchors', 'values'] as const).flatMap((field) =>
    Object.keys(relation[field] ?? {}).map((key) => ({
      field,
      key
    })))
);

const describeEvidenceCoverage = (
  relation: DerivationStageRelation,
  evidence: Tier2FacetEvidence,
  claims: readonly RecoveredClaim[],
  companions: readonly Tier2ResolvedFacet[],
  synonymIndex: Tier2SynonymIndex
): RelationEvidenceCoverage => {
  const owners = [
    ...claims.flatMap(claim => claim.tier === 3 ? [] : [{
      claim: claim.tier === 1 ? claim.registryEntryId : claim.facet.recipe.id,
      tier: claim.tier,
      references: claim.consumedEvidence
    }]),
    ...companions.map(facet => ({ claim: facet.recipe.id, tier: 2 as const, references: facet.evaluation.consumedEvidence }))
  ];
  const entries = { anchors: evidence.authoredCurrentAnchors, priorAnchors: evidence.authoredPriorAnchors, values: evidence.authoredValues };
  return {
    authoredRelation: relation,
    fields: authoredEvidenceReferences(relation).map(({ field, key }) => {
      const value = relation[field]![key];
      const indices = (Array.isArray(value) ? value : [value]).map((_, index) => index);
      const recognizedBy = owners.flatMap(owner => {
        const refs = owner.references.filter(ref => ref.field === field && ref.key === key);
        if (!refs.length) return [];
        const used = new Set(refs.flatMap(ref => ref.itemIndices ?? indices));
        return [{ claim: owner.claim, tier: owner.tier, itemIndices: indices.filter(index => used.has(index)) }];
      });
      return {
        field, key,
        concepts: [...new Set([
          ...(entries[field]?.find(entry => entry.key === key)?.concepts ?? []),
          ...lookupTier2SynonymCandidates(synonymIndex, field === 'values' ? 'value' : 'role', key)
        ])],
        recognizedBy,
        unrecoveredItemIndices: indices.filter(index => !recognizedBy.some(owner => owner.itemIndices.includes(index))),
        unrecoveredEmptyField: indices.length === 0 && recognizedBy.length === 0
      };
    })
  };
};

const removeConsumedEvidence = (
  relation: DerivationStageRelation,
  consumedEvidence: readonly RecoveredEvidenceReference[]
): DerivationStageRelation => {
  const retain = (
    field: RecoveredEvidenceReference['field'],
    block: Record<string, string | string[]> | undefined
  ): Record<string, string | string[]> => Object.fromEntries(
    Object.entries(block ?? {}).flatMap(([key, value]) => {
      const references = consumedEvidence.filter(ref => ref.field === field && ref.key === key);
      if (references.length === 0) return [[key, value]];
      if (references.some(ref => ref.itemIndices === undefined)) return [];
      const used = new Set(references.flatMap(ref => ref.itemIndices ?? []));
      const remaining = (Array.isArray(value) ? value : [value]).filter((_, index) => !used.has(index));
      return remaining.length ? [[key, Array.isArray(value) ? remaining : remaining[0]]] : [];
    })
  );
  const anchors = retain('anchors', relation.anchors);
  const priorAnchors = retain('priorAnchors', relation.priorAnchors);
  const values = retain('values', relation.values);
  return {
    relation: relation.relation,
    anchors,
    ...(Object.keys(priorAnchors).length > 0 ? { priorAnchors } : {}),
    ...(Object.keys(values).length > 0 ? { values } : {})
  };
};

const authoredItems = (value: string | string[]): string[] => (
  (Array.isArray(value) ? value : [value])
    .map((item) => String(item ?? ''))
);

const appendItems = (
  target: Record<string, string[]>,
  concept: string,
  items: readonly string[]
) => {
  target[concept] = [...(target[concept] ?? []), ...items];
};

const normalizeBlock = (
  block: Record<string, string | string[]> | undefined,
  scope: Tier2SynonymScope,
  synonymIndex: Tier2SynonymIndex
): {
  concepts: Record<string, string[]>;
  authored: Tier2AuthoredEvidenceEntry[];
} => {
  const normalized: Record<string, string[]> = {};
  const authored: Tier2AuthoredEvidenceEntry[] = [];
  const conceptBlocks = new Map<string, string[]>();
  Object.entries(block ?? {}).forEach(([authoredKey, value]) => {
    const items = authoredItems(value);
    const concepts = lookupTier2SynonymCandidates(synonymIndex, scope, authoredKey);
    const activeConcepts: string[] = [];
    const conceptItemIndices: Record<string, number[]> = {};
    concepts.forEach((concept) => {
      const conceptItems = scope === 'value' && concept === 'outcome'
        ? items.filter((item) => resolveOutcomeLiteral(item)?.concept)
        : scope === 'value' && concept === 'verdict'
          ? items.filter((item) => !resolveOutcomeLiteral(item)?.concept)
          : items;
      if (conceptItems.length === 0) {
        if (items.length === 0) activeConcepts.push(concept);
        return;
      }
      activeConcepts.push(concept);
      conceptItemIndices[concept] = items.flatMap((item, index) => conceptItems.includes(item) ? [index] : []);
      const blockIdentity = JSON.stringify(conceptItems);
      const previousBlocks = conceptBlocks.get(concept) ?? [];
      if (!previousBlocks.includes(blockIdentity)) {
        if (previousBlocks.length === 0 || (scope === 'role' ? INDEPENDENT_TIER2_ANCHOR_ROLES : INDEPENDENT_TIER2_VALUE_ROLES).has(concept)) {
          appendItems(normalized, concept, conceptItems);
        } else {
          normalized[concept] = [];
        }
      }
      conceptBlocks.set(concept, [...previousBlocks, blockIdentity]);
    });
    authored.push({
      key: authoredKey,
      concepts: activeConcepts,
      conceptItemIndices,
      items: [...items]
    });
  });
  return { concepts: normalized, authored };
};

export const buildTier2FacetEvidence = ({
  relation,
  currentForest,
  priorForest,
  activeLens,
  synonymIndex = DEFAULT_SYNONYM_INDEX
}: Omit<ExclusiveRelationDispatchInput, 'stageIndex' | 'relationIndex' | 'registry'>): Tier2FacetEvidence => {
  const currentAnchors = normalizeBlock(relation.anchors, 'role', synonymIndex);
  const priorAnchors = normalizeBlock(relation.priorAnchors, 'role', synonymIndex);
  const values = normalizeBlock(relation.values, 'value', synonymIndex);
  const realizationHost = currentAnchors.authored.some(entry =>
    ['supported tense', 'tense host', 'realization host'].includes(normalizeTier2Synonym(entry.key)));
  if (realizationHost) {
    values.authored.filter(entry => normalizeTier2Synonym(entry.key) === 'notation').forEach(entry => {
      entry.concepts = [...entry.concepts, 'pf.rows'];
      entry.conceptItemIndices = { ...entry.conceptItemIndices, 'pf.rows': entry.items.map((_, index) => index) };
      appendItems(values.concepts, 'pf.rows', entry.items);
    });
  }
  const { movement, diagnostics: movementDiagnostics } = recoverMovementEvidence(relation, currentForest, priorForest);
  if (movement) {
    currentAnchors.concepts['movement.source'] = [movement.sourceNodeId];
    currentAnchors.concepts['movement.witness'] = [movement.witnessNodeId];
    currentAnchors.concepts['movement.landing'] = [movement.targetNodeId];
    currentAnchors.authored.forEach(entry => {
      entry.concepts = entry.concepts.filter(c => !['movement.source', 'movement.witness', 'movement.landing'].includes(c));
      entry.concepts = [...entry.concepts, ...(movement.roles[normalizeTier2Synonym(entry.key)] || [])];
    });
  }
  return {
    movementDiagnostics,
    ...(movement ? { movement } : {}),
    currentAnchors: currentAnchors.concepts,
    authoredCurrentAnchors: currentAnchors.authored,
    ...(relation.priorAnchors
      ? {
          priorAnchors: priorAnchors.concepts,
          authoredPriorAnchors: priorAnchors.authored
        }
      : {}),
    values: values.concepts,
    authoredValues: values.authored,
    currentForest,
    ...(priorForest ? { priorForest } : {}),
    ...(activeLens === undefined ? {} : { activeLens })
  };
};

const evaluateClaims = (evidence: Tier2FacetEvidence): Tier2EvaluatedFacet[] => (
  TIER2_FACET_RECIPES
    .filter((recipe) => recipe.kind === 'claim')
    .map((recipe) => ({ recipe, evaluation: evaluateTier2FacetRecipe(recipe, evidence) }))
);

const resolveClaimCollisions = (
  completeClaims: readonly Tier2EvaluatedFacet[]
): { selected: Tier2EvaluatedFacet[]; diagnostics: Tier2CollisionDiagnostic[] } => {
  const initial = new Map<string, Tier2EvaluatedFacet>(
    completeClaims.map((facet) => [facet.recipe.id, facet])
  );
  const selected = new Map<string, Tier2EvaluatedFacet>(initial);
  const diagnostics: Tier2CollisionDiagnostic[] = [];

  const failClosed = (collision: string, facetIds: readonly string[]) => {
    const tied = facetIds.filter((id) => initial.has(id));
    if (tied.length < 2) return;
    tied.forEach((id) => selected.delete(id));
    diagnostics.push({ kind: 'ambiguous-facets', collision, facets: [...tied] });
  };

  const prefer = (collision: string, winner: string, loser: string) => {
    if (!selected.has(winner) || !selected.has(loser)) return;
    selected.delete(loser);
    diagnostics.push({
      kind: 'more-specific-facet',
      collision,
      facets: [winner, loser],
      winner
    });
  };

  /* Case and polarity evidence distinguish the specialized feature marks. */
  failClosed('specialized-feature-reading', ['dependent-case', 'accord']);
  prefer('dependent-case-or-generic-feature', 'dependent-case', 'feature.dependency');
  prefer('accord-or-generic-feature', 'accord', 'feature.dependency');
  prefer('cyclic-or-generic-feature', 'agreement.cycle', 'feature.dependency');
  prefer('transfer-owns-edge', 'transfer.domain', 'phase.edge');

  /* These ties have no structural discriminator in the current evidence. */
  failClosed('constituent-enclosure-reading', [
    'constituent.occurrence',
    'constituent.region'
  ]);
  failClosed('binding-or-operator-reading', ['binding.dependency', 'operator-binding']);
  /* Strict evidence supersets and outcome-specific marks own their channel. */
  prefer('carrier-or-ordinary-movement', 'movement.carrier', 'movement.path');

  return {
    selected: TIER2_FACET_RECIPES
      .map((recipe) => selected.get(recipe.id))
      .filter((facet): facet is Tier2EvaluatedFacet => Boolean(facet)),
    diagnostics
  };
};

const evaluateCompanions = (
  evidence: Tier2FacetEvidence,
  parentFacetComplete: boolean
): Tier2EvaluatedFacet[] => (
  TIER2_FACET_RECIPES
    .filter((recipe) => recipe.kind !== 'claim')
    .map((recipe) => ({
      recipe,
      evaluation: evaluateTier2FacetRecipe(recipe, {
        ...evidence,
        parentFacetComplete
      })
    }))
    .filter(({ evaluation }) => evaluation.complete)
);

const attachFacetIdentities = (
  facets: readonly Tier2EvaluatedFacet[],
  evidence: Tier2FacetEvidence,
  authoredStageIndex: number,
  parentFacets: readonly Tier2ResolvedFacet[] = []
): Tier2ResolvedFacet[] => {
  const parentFacetIds = parentFacets.map(({ recipe }) => recipe.id).sort();
  const parentFacetIdentities = parentFacets.map(({ facetIdentity }) => facetIdentity).sort();
  return facets.flatMap(({ recipe, evaluation }) => {
    const consumedEntries = (field: RecoveredEvidenceReference['field'], entries: readonly Tier2AuthoredEvidenceEntry[] = []) =>
      entries.flatMap(entry => {
        const refs = evaluation.consumedEvidence.filter(ref => ref.field === field && ref.key === entry.key);
        if (!refs.length) return [];
        if (refs.some(ref => ref.itemIndices === undefined)) return [entry];
        // Paired literal slots remain positional even when an optional blank
        // annotation is left in the residual rather than drawn. A same-name
        // values entry is such a slot list by the contract's pairing rule.
        const pairsByName = (evidence.authoredCurrentAnchors ?? []).some(anchor =>
          normalizeTier2Synonym(anchor.key) === normalizeTier2Synonym(entry.key));
        if (field === 'values' && recipe.checks.some(check => check.kind === 'paired-values'
          && (entry.concepts.includes(check.value) || pairsByName))) return [entry];
        const indices = new Set(refs.flatMap(ref => ref.itemIndices ?? []));
        return [{ ...entry, items: entry.items.filter((_, index) => indices.has(index)) }];
      });
    const facetEvidence: Tier2FacetEvidence = {
      ...evidence,
      authoredCurrentAnchors: consumedEntries('anchors', evidence.authoredCurrentAnchors),
      authoredPriorAnchors: consumedEntries('priorAnchors', evidence.authoredPriorAnchors),
      authoredValues: consumedEntries('values', evidence.authoredValues)
    };
    const identityInput = {
      recipe,
      evaluation,
      evidence: facetEvidence,
      authoredStageIndex,
      ...(parentFacetIdentities.length > 0 ? { parentFacetIdentities } : {})
    };
    const facetIdentity = buildTier2FacetIdentity(identityInput);
    if (!facetIdentity) return [];
    return [{
      recipe,
      evaluation,
      facetIdentity,
      outputIdentities: buildTier2FacetOutputIdentities(identityInput),
      parentFacetIds: [...parentFacetIds]
    }];
  });
};

export const dispatchRelationClaims = (
  input: ExclusiveRelationDispatchInput
): RelationClaimDispatch => {
  const {
    relation,
    stageIndex,
    relationIndex,
    currentForest,
    priorForest,
    activeLens,
    registry = productionRelationRegistry,
    synonymIndex = DEFAULT_SYNONYM_INDEX
  } = input;
  const authoredTier1Dispatch = dispatchRelation({
    registry,
    relation,
    stageIndex,
    relationIndex,
    currentForest,
    priorForest
  }) as Tier1Dispatch;
  const evidence = buildTier2FacetEvidence({
    relation,
    currentForest,
    priorForest,
    activeLens,
    synonymIndex
  });
  const registryEntry = findRelationRegistryEntry(registry, relation.relation);
  const declaredPrimaryAnchorKeys = new Set<string>(registryEntry
    ? [
        ...Object.keys(registryEntry.signature.anchors.required),
        ...Object.keys(registryEntry.signature.anchors.optional)
      ].map(normalizeTier2Synonym).concat(authoredTier1Dispatch.roleBindings
        .filter(binding => binding.field === 'anchors')
        .map(binding => normalizeTier2Synonym(binding.authoredRole)))
    : []);
  const declaredPrimaryAnchorConcepts = new Set<string>(registryEntry
    ? Object.entries({ ...registryEntry.signature.anchors.required, ...registryEntry.signature.anchors.optional } as Record<string, { concept?: string }>)
      .flatMap(([role, rule]) => rule.concept ? [rule.concept]
        : lookupTier2SynonymCandidates(synonymIndex, 'role', role))
    : []);
  const primaryAcceptsAdditionalAnchors = registryEntry?.signature.anchors.allowAdditional === true;
  const evaluations = evaluateClaims(evidence);
  const completeClaims = evaluations.filter(({ evaluation }) => evaluation.complete);
  const eligibleClaims = registryEntry
    ? completeClaims.filter(({ evaluation }) => {
        if (primaryAcceptsAdditionalAnchors) return false;
        const currentAnchorEvidence = evaluation.consumedEvidence.filter(
          ({ field }) => field === 'anchors'
        );
        return currentAnchorEvidence.length > 0 && currentAnchorEvidence.every(
          ({ key }) => (
            !declaredPrimaryAnchorKeys.has(normalizeTier2Synonym(key))
            && lookupTier2SynonymCandidates(synonymIndex, 'role', key).every(
              (concept) => !declaredPrimaryAnchorConcepts.has(concept)
            )
          )
        );
      })
    : completeClaims;
  const { selected, diagnostics } = resolveClaimCollisions(eligibleClaims);
  const licensed = evidence.currentAnchors['licensed.hosts'] ?? [];
  const rejected = evidence.currentAnchors['rejected.hosts'] ?? [];
  const conflictingHosts = licensed.filter(id => rejected.includes(id));
  if (conflictingHosts.length && !authoredTier1Dispatch.signatureIssues.some(issue => issue.kind === 'candidate-outcome-conflict')) diagnostics.push({ kind: 'contradictory-evidence',
    collision: `candidate-outcome-conflict:${[...new Set(conflictingHosts)].join(',')}`, facets: ['landing-candidates'] });
  const outcomes = evidence.values.outcome ?? [];
  if (!authoredTier1Dispatch.signatureIssues.some(issue => issue.kind === 'ambiguous-outcome-values')
    && new Set(outcomes.map(item => resolveOutcomeLiteral(item)?.concept).filter(Boolean)).size > 1) diagnostics.push({
    kind: 'contradictory-evidence', collision: 'outcome-conflict', facets: []
  });
  const tier2ClaimFacets = attachFacetIdentities(selected, evidence, stageIndex);
  const companions = attachFacetIdentities(
    evaluateCompanions(evidence, tier2ClaimFacets.length > 0),
    evidence,
    stageIndex,
    tier2ClaimFacets
  );
  const facets = [...tier2ClaimFacets, ...companions];
  const primaryUsesOutcome = registryEntry
    && PRODUCTION_RENDER_FAMILIES[registryEntry.id]?.acceptedOutcomeConcepts.length > 0;
  const independentlyConsumedEvidence = facets.flatMap(
    ({ evaluation }) => evaluation.consumedEvidence
  ).filter(ref => {
    if (!primaryUsesOutcome || ref.field !== 'values'
      || !lookupTier2SynonymCandidates(synonymIndex, 'value', ref.key).includes('outcome')) return true;
    const value = relation.values?.[ref.key];
    const items = Array.isArray(value) ? value : [value];
    return !items.some((literal, index) => (ref.itemIndices === undefined || ref.itemIndices.includes(index))
      && resolveOutcomeLiteral(literal)?.concept);
  });
  let primaryRelation = removeConsumedEvidence(relation, independentlyConsumedEvidence);
  const tier1Dispatch = registryEntry
    ? dispatchRelation({
        registry,
        relation: primaryRelation,
        stageIndex,
        relationIndex,
        currentForest,
        priorForest
      }) as Tier1Dispatch
    : authoredTier1Dispatch;
  const unownedAnchors = tier1Dispatch.outcome === 'resolved' && !primaryAcceptsAdditionalAnchors
    ? Object.keys(primaryRelation.anchors ?? {}).filter(key => !declaredPrimaryAnchorKeys.has(normalizeTier2Synonym(key))) : [];
  const residualRelation = unownedAnchors.length ? {
    relation: relation.relation,
    anchors: Object.fromEntries(unownedAnchors.map(key => [key, primaryRelation.anchors[key]]))
  } : undefined;
  if (residualRelation) {
    diagnostics.push({ kind: 'unrecovered-evidence', collision: `anchors:${unownedAnchors.join(',')}:preserved-in-tier3`, facets: [] });
    primaryRelation = removeConsumedEvidence(primaryRelation, unownedAnchors.map(key => ({ field: 'anchors', key })));
  }
  const base = {
    relationInstance: { stageIndex, relationIndex },
    authoredRelationName: String(relation.relation),
    evidence,
    tier1Dispatch,
    primaryRelation,
    boundPrimaryRelation: residualRelation ? { ...tier1Dispatch.boundRelation,
      anchors: Object.fromEntries(Object.entries(tier1Dispatch.boundRelation.anchors).filter(([key]) => !unownedAnchors.includes(key)))
    } : tier1Dispatch.boundRelation,
    facets,
    diagnostics
  };
  const tier2Claims: Tier2RecoveredClaim[] = tier2ClaimFacets.map((facet) => ({
    tier: 2,
    kind: 'structural-facet',
    canonicalClaimIdentity: facet.facetIdentity,
    facet,
    consumedEvidence: [...facet.evaluation.consumedEvidence]
  }));

  let primaryClaim: Tier1RecoveredClaim | Tier3RecoveredClaim | null;
  let claims: RecoveredClaim[];
  if (registryEntry && tier1Dispatch.outcome === 'resolved') {
    primaryClaim = {
      tier: 1,
      kind: 'registered-primary',
      canonicalClaimIdentity: primaryClaimIdentity(
        primaryRelation,
        registryEntry.id,
        'registered-primary'
      ),
      registryEntryId: registryEntry.id,
      consumedEvidence: authoredEvidenceReferences(primaryRelation).map(ref => {
        const original = relation[ref.field]![ref.key];
        const indices = (Array.isArray(original) ? original : [original]).map((_, index) => index);
        const removed = independentlyConsumedEvidence.filter(used => used.field === ref.field && used.key === ref.key);
        const remaining = indices.filter(index => !removed.some(used => used.itemIndices === undefined || used.itemIndices.includes(index)));
        return remaining.length === indices.length ? ref : { ...ref, itemIndices: remaining };
      })
    };
    claims = [primaryClaim, ...tier2Claims, ...(residualRelation ? [{
        tier: 3 as const, kind: 'fallback-residual' as const,
        canonicalClaimIdentity: primaryClaimIdentity(residualRelation, undefined, 'fallback-residual'),
        reason: 'unconsumed-envelope-evidence' as const,
        consumedEvidence: authoredEvidenceReferences(residualRelation)
      }] : [])];
  } else if (registryEntry) {
    primaryClaim = {
      tier: 3,
      kind: 'fallback-primary',
      canonicalClaimIdentity: primaryClaimIdentity(
        primaryRelation,
        registryEntry.id,
        'fallback-primary'
      ),
      reason: 'registered-signature-incomplete',
      consumedEvidence: authoredEvidenceReferences(primaryRelation)
    };
    claims = [primaryClaim, ...tier2Claims];
  } else if (tier2Claims.length > 0) {
    const residualEvidence = authoredEvidenceReferences(primaryRelation);
    if (residualEvidence.length > 0) {
      primaryClaim = {
        tier: 3,
        kind: 'fallback-residual',
        canonicalClaimIdentity: primaryClaimIdentity(
          primaryRelation,
          undefined,
          'fallback-residual'
        ),
        reason: 'unconsumed-envelope-evidence',
        consumedEvidence: residualEvidence
      };
      claims = [...tier2Claims, primaryClaim];
    } else {
      primaryClaim = null;
      claims = tier2Claims;
    }
  } else {
    primaryClaim = {
      tier: 3,
      kind: 'fallback-primary',
      canonicalClaimIdentity: primaryClaimIdentity(
        primaryRelation,
        undefined,
        'fallback-primary'
      ),
      reason: 'no-complete-tier2-facet',
      consumedEvidence: authoredEvidenceReferences(primaryRelation)
    };
    claims = [primaryClaim];
  }
  const evidenceCoverage = describeEvidenceCoverage(relation, evidence, claims, companions, synonymIndex);
  const unrecovered = evidenceCoverage.fields.filter(field => field.unrecoveredItemIndices.length || field.unrecoveredEmptyField);
  // Residual array positions refer to the original response, not the shorter
  // array left after other claims consumed individual items.
  claims.filter(claim => claim.tier === 3).forEach(claim => {
    claim.consumedEvidence = unrecovered.map(entry => {
      const original = relation[entry.field]![entry.key];
      const count = Array.isArray(original) ? original.length : 1;
      return { field: entry.field, key: entry.key,
        ...(entry.unrecoveredItemIndices.length === count ? {} : { itemIndices: entry.unrecoveredItemIndices }) };
    });
  });
  // Explain candidates connected to leftover evidence, not every failed rule.
  // A candidate failure does not establish the model's intended meaning.
  const facetDiagnostics = evaluations.filter(({ recipe, evaluation }) => !registryEntry && !evaluation.complete
    && unrecovered.some(field => field.field === 'values'
      ? recipe.values.some(requirement => field.concepts.includes(requirement.value))
      : recipe.anchors.some(requirement => field.concepts.includes(requirement.role)
        && (requirement.source === 'either' || requirement.source === (field.field === 'priorAnchors' ? 'prior' : 'current')))))
    .map(({ recipe, evaluation }) => ({ facetId: recipe.id, failures: evaluation.failures }));
  return {
    ...base,
    facetDiagnostics,
    primaryClaim,
    claims,
    evidenceCoverage,
    ...(residualRelation ? { residualRelation } : {})
  };
};

/**
 * Dispatch every authored relation independently. Visual coalescing happens
 * only after complete facet outputs exist; it never changes relation count,
 * tier selection, diagnostics, or Replay ownership.
 */
export const dispatchRelationClaimBatch = (
  input: ExclusiveRelationBatchDispatchInput
): RelationClaimDispatchEntry[] => {
  const {
    relations,
    stageIndex,
    currentForest,
    priorForest,
    activeLens,
    registry,
    synonymIndex
  } = input;
  return relations.map((relation, relationIndex) => ({
    relation,
    dispatch: dispatchRelationClaims({
      relation,
      stageIndex,
      relationIndex,
      currentForest,
      ...(priorForest ? { priorForest } : {}),
      ...(activeLens === undefined ? {} : { activeLens }),
      ...(registry ? { registry } : {}),
      ...(synonymIndex ? { synonymIndex } : {})
    })
  }));
};
