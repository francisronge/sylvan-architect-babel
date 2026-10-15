import type { DerivationStageRelation } from '../../types.ts';
import type {
  RecoveredClaim,
  RecoveredEvidenceReference,
  RelationEvidenceCoverage,
  Tier1RecoveredClaim,
  Tier2ResolvedFacet,
  Tier3RecoveredClaim
} from './relationClaims.ts';
import type { Tier2FacetEvidence } from './tier2FacetTypes.ts';
import { lookupTier2SynonymCandidates, normalizeTier2Synonym, type Tier2SynonymIndex } from './tier2Synonyms.ts';

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

export const primaryClaimIdentity = (
  relation: DerivationStageRelation,
  registryEntryId?: string,
  kind: Tier1RecoveredClaim['kind'] | Tier3RecoveredClaim['kind'] = 'registered-primary',
  contextAnchors?: Record<string, string | string[]>
): string => JSON.stringify(canonicalize({
  kind,
  identity: registryEntryId ?? normalizeTier2Synonym(relation.relation),
  anchors: relation.anchors ?? {},
  priorAnchors: relation.priorAnchors ?? null,
  values: relation.values ?? null,
  ...(contextAnchors ? { contextAnchors } : {})
}));

export const authoredEvidenceReferences = (
  relation: DerivationStageRelation
): RecoveredEvidenceReference[] => (
  (['anchors', 'priorAnchors', 'values'] as const).flatMap((field) =>
    Object.keys(relation[field] ?? {}).map((key) => ({
      field,
      key
    })))
);

export const describeEvidenceCoverage = (
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

export const removeConsumedEvidence = (
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

export const authoredEvidenceItems = (
  evidence: Tier2FacetEvidence,
  references: readonly RecoveredEvidenceReference[]
): string => JSON.stringify([...new Set(references.flatMap(ref => {
  const entries = ref.field === 'anchors' ? evidence.authoredCurrentAnchors
    : ref.field === 'priorAnchors' ? evidence.authoredPriorAnchors : evidence.authoredValues;
  const entry = entries?.find(candidate => candidate.key === ref.key);
  return (ref.itemIndices ?? entry?.items.map((_, index) => index) ?? [])
    .map(index => JSON.stringify([ref.field, ref.key, index]));
}))].sort());
