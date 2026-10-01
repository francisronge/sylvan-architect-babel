import { buildTier2FacetEvidence } from './relationEvidence.ts';
export { buildTier2FacetEvidence } from './relationEvidence.ts';
import { createAssignmentContext, rememberAssignments, rememberAssignmentMovement, type AssignmentContext, type AssignmentScope } from './assignmentContinuity.ts';
import { nativeThetaAssignments } from './compoundAssignments.ts';
import { recoverRelationScopes } from './claimRecovery.ts';
import { typedThematicAssignment, typedInterpretiveRoles } from './thematicAssignment.ts';
import { typedFocusAssociation } from './focusAssociationEvidence.ts';
import { typedInterpretedBinding } from './interpretedBindingEvidence.ts';
import { nominalConcordMembers } from './nominalConcord.ts';
import { recoverParticipantProperties, recoverPairedCaseProperties, recoverNamedArgumentProperties } from './participantProperties.ts';
import { scopeEvidence } from './evidenceScopes.ts';
import { readCategoryLabel } from '../categoryLabel.ts';
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
  SurfaceRealization,
  SyntaxNode
} from '../../types.ts';
import {
  dispatchRelation,
  findRelationRegistryEntry,
  productionRelationRegistry
} from '../relationDispatch/index.js';
import { resolveOutcomeLiteral } from './outcomeResolver.ts';
import { PRODUCTION_RENDER_FAMILIES } from './renderFamilies.ts';
import {
  TIER2_FACET_RECIPES,
  POSITIVE_OUTCOMES,
  buildTier2FacetIdentity,
  buildTier2FacetOutputIdentities,
  evaluateTier2FacetRecipe,
  indexTier2Forests,
  type Tier2ForestIndexes,
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
  relationLabelClauses,
  type Tier2SynonymIndex
} from './tier2Synonyms.ts';

type Tier1Dispatch = ReturnType<typeof dispatchRelation>;

export type Tier2ResolvedFacet = {
  recipe: Tier2FacetRecipe;
  evaluation: Tier2FacetEvaluation;
  facetIdentity: string;
  outputIdentities: Tier2FacetOutputIdentity[];
  parentFacetIds: string[];
  evidence?: Tier2FacetEvidence;
  restates?: AssignmentScope['restates'];
};

type Tier2EvaluatedFacet = Pick<Tier2ResolvedFacet, 'recipe' | 'evaluation' | 'evidence' | 'restates'> & {
  origins?: AssignmentScope['origins'] & { priorAnchors?: Record<string, number[]> }
};

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
    | 'unconsumed-envelope-evidence'
    | 'malformed-authored-relation';
  consumedEvidence: RecoveredEvidenceReference[];
  /** Current participants of the authored relation, not an inferred extra dependency. */
  contextAnchors?: Record<string, string | string[]>;
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
  currentRealizations?: readonly SurfaceRealization[];
  priorRealizations?: readonly SurfaceRealization[];
  priorForest?: readonly SyntaxNode[];
  activeLens?: boolean;
  assignmentContext?: AssignmentContext;
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

const evaluateClaims = (evidence: Tier2FacetEvidence, indexes: Tier2ForestIndexes): Tier2EvaluatedFacet[] => (
  TIER2_FACET_RECIPES
    .filter((recipe) => recipe.kind === 'claim')
    .map((recipe) => ({ recipe, evaluation: evaluateTier2FacetRecipe(recipe, evidence, indexes) }))
);

const authoredEvidenceItems = (
  evidence: Tier2FacetEvidence,
  references: readonly RecoveredEvidenceReference[]
): string => JSON.stringify([...new Set(references.flatMap(ref => {
  const entries = ref.field === 'anchors' ? evidence.authoredCurrentAnchors
    : ref.field === 'priorAnchors' ? evidence.authoredPriorAnchors : evidence.authoredValues;
  const entry = entries?.find(candidate => candidate.key === ref.key);
  return (ref.itemIndices ?? entry?.items.map((_, index) => index) ?? [])
    .map(index => JSON.stringify([ref.field, ref.key, index]));
}))].sort());

const resolveClaimCollisions = (
  completeClaims: readonly Tier2EvaluatedFacet[],
  evidence: Tier2FacetEvidence
): { selected: Tier2EvaluatedFacet[]; diagnostics: Tier2CollisionDiagnostic[] } => {
  const initial = new Map<string, Tier2EvaluatedFacet>(
    completeClaims.map((facet) => [facet.recipe.id, facet])
  );
  const selected = new Map<string, Tier2EvaluatedFacet>(initial);
  const diagnostics: Tier2CollisionDiagnostic[] = [];

  const participants = (id: string): Set<string> => new Set(initial.get(id)?.evaluation.consumedEvidence
    .filter(ref => ref.field === 'anchors')
    .flatMap(ref => {
      const entry = evidence.authoredCurrentAnchors?.find(entry => entry.key === ref.key);
      return (ref.itemIndices ?? entry?.items.map((_, index) => index) ?? [])
        .flatMap(index => entry?.items[index] === undefined ? [] : [entry.items[index]]);
    }));
  const covers = (owner: string, other: string): boolean => {
    const owned = participants(owner);
    const compared = participants(other);
    if (owner === 'scope.movement' && other === 'movement.path' && evidence.movement) {
      // Both raw recipes use this one verified trajectory. A contained member
      // corroborates its carrier but does not establish an additional curve.
      return [evidence.movement.sourceNodeId, evidence.movement.targetNodeId]
        .every(id => owned.has(id) && compared.has(id));
    }
    return compared.size > 0 && [...compared].every(id => owned.has(id));
  };

  const failClosed = (collision: string, facetIds: readonly string[]) => {
    const tied = facetIds.filter((id) => initial.has(id));
    if (tied.length < 2 || !tied.every(id => covers(id, tied[0]) && covers(tied[0], id))) return;
    tied.forEach((id) => selected.delete(id));
    diagnostics.push({ kind: 'ambiguous-facets', collision, facets: [...tied] });
  };

  const prefer = (collision: string, winner: string, loser: string) => {
    if (!selected.has(winner) || !selected.has(loser) || !covers(winner, loser)) return;
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
  // A proven undirected nominal inventory has one drawing. A generic reading
  // of exactly those authored items must not add a second directed connector.
  if (initial.has('feature-sharing') && initial.has('feature.dependency')
    && !evidence.values['case.literal']?.length && nominalConcordMembers(evidence).length
    && authoredEvidenceItems(evidence, initial.get('feature-sharing')!.evaluation.consumedEvidence)
      === authoredEvidenceItems(evidence, initial.get('feature.dependency')!.evaluation.consumedEvidence))
    prefer('nominal-concord-or-generic-feature', 'feature-sharing', 'feature.dependency');
  prefer('transfer-owns-edge', 'transfer.domain', 'phase.edge');
  prefer('strong-npi-owns-licensing', 'strong-npi', 'polarity.licensing');
  prefer('intervention-owns-outcome', 'intervention', 'judgment.blocked');

  /* These ties have no structural discriminator in the current evidence. */
  failClosed('constituent-enclosure-reading', [
    'constituent.occurrence',
    'constituent.region'
  ]);
  failClosed('binding-or-operator-reading', ['binding.dependency', 'operator-binding']);
  /* Strict evidence supersets and outcome-specific marks own their channel. */
  prefer('carrier-or-ordinary-movement', 'movement.carrier', 'movement.path');
  prefer('covert-or-ordinary-movement', 'scope.movement', 'movement.path');

  return {
    selected: TIER2_FACET_RECIPES
      .map((recipe) => selected.get(recipe.id))
      .filter((facet): facet is Tier2EvaluatedFacet => Boolean(facet)),
    diagnostics
  };
};

const evaluateCompanions = (
  evidence: Tier2FacetEvidence,
  parentFacetComplete: boolean,
  indexes: Tier2ForestIndexes
): Tier2EvaluatedFacet[] => (
  TIER2_FACET_RECIPES
    .filter((recipe) => recipe.kind !== 'claim')
    .map((recipe) => ({
      recipe,
      evaluation: evaluateTier2FacetRecipe(recipe, {
        ...evidence,
        parentFacetComplete
      }, indexes)
    }))
    .filter(({ evaluation }) => evaluation.complete)
);

const attachFacetIdentities = (
  facets: readonly Tier2EvaluatedFacet[],
  evidence: Tier2FacetEvidence,
  authoredStageIndex: number,
  indexes: Tier2ForestIndexes,
  parentFacets: readonly Tier2ResolvedFacet[] = []
): Tier2ResolvedFacet[] => {
  const parentFacetIds = parentFacets.map(({ recipe }) => recipe.id).sort();
  const parentFacetIdentities = parentFacets.map(({ facetIdentity }) => facetIdentity).sort();
  return facets.flatMap(({ recipe, evaluation, evidence: scopedEvidence, origins, restates }) => {
    const sourceEvidence = scopedEvidence ?? evidence;
    const consumedEntries = (field: RecoveredEvidenceReference['field'], entries: readonly Tier2AuthoredEvidenceEntry[] = []) =>
      entries.flatMap(entry => {
        // Verified enclosure context is accounted for by the movement, but is
        // not another trajectory endpoint or part of its replacement identity.
        if (field === 'anchors' && ['movement.path', 'movement.carrier'].includes(recipe.id)
          && sourceEvidence.movement?.context?.some(context => context.key === entry.key)) return [];
        if (field === 'priorAnchors' && ['movement.path', 'movement.carrier'].includes(recipe.id)
          && sourceEvidence.movement?.priorContextKeys?.includes(entry.key)) return [];
        // A proved finite head is PF context, not a second plaque host or a
        // participant in the lexical realization's replacement identity.
        if (field === 'anchors' && recipe.id === 'pf.structured' && entry.concepts.includes('pf.context')) return [];
        const refs = evaluation.consumedEvidence.filter(ref => ref.field === field && ref.key === entry.key);
        if (!refs.length) return [];
        if (refs.some(ref => ref.itemIndices === undefined)) return [entry];
        // Paired literal slots remain positional even when an optional blank
        // annotation is left in the residual rather than drawn. A same-name
        // values entry is such a slot list by the contract's pairing rule.
        const pairsByName = (sourceEvidence.authoredCurrentAnchors ?? []).some(anchor =>
          normalizeTier2Synonym(anchor.key) === normalizeTier2Synonym(entry.key));
        if (field === 'values' && recipe.checks.some(check => check.kind === 'paired-values'
          && (entry.concepts.includes(check.value) || pairsByName))) return [entry];
        const indices = new Set(refs.flatMap(ref => ref.itemIndices ?? []));
        return [{ ...entry, items: entry.items.filter((_, index) => indices.has(index)) }];
      });
    const facetEvidence: Tier2FacetEvidence = {
      ...sourceEvidence,
      authoredCurrentAnchors: consumedEntries('anchors', sourceEvidence.authoredCurrentAnchors),
      authoredPriorAnchors: consumedEntries('priorAnchors', sourceEvidence.authoredPriorAnchors),
      authoredValues: consumedEntries('values', sourceEvidence.authoredValues)
    };
    const identityInput = {
      recipe,
      evaluation,
      evidence: facetEvidence,
      indexes,
      authoredStageIndex,
      ...(parentFacetIdentities.length > 0 ? { parentFacetIdentities } : {})
    };
    const facetIdentity = buildTier2FacetIdentity(identityInput);
    if (!facetIdentity) return [];
    return [{
      recipe,
      evaluation: origins ? { ...evaluation, consumedEvidence: evaluation.consumedEvidence.map(ref => {
        const indices = origins[ref.field]?.[ref.key] ?? [];
        return { ...ref, itemIndices: indices };
      }) } : evaluation,
      ...(scopedEvidence ? { evidence: scopedEvidence } : {}),
      ...(restates ? { restates } : {}),
      facetIdentity,
      outputIdentities: buildTier2FacetOutputIdentities(identityInput),
      parentFacetIds: [...parentFacetIds]
    }];
  });
};

/** A silent finite head can be context for an already proved lexical PF form.
 * It is not another realization host or an Agree/movement endpoint. Require
 * matching authored tense and a local V complement before retiring its residual. */
const ownFiniteTenseContext = (
  facets: readonly Tier2EvaluatedFacet[],
  evidence: Tier2FacetEvidence,
  indexes: Tier2ForestIndexes
): Tier2EvaluatedFacet[] => {
  const clauses = relationLabelClauses(evidence.relationName);
  if (clauses.length !== 1 || !/^(?:(?:matrix|embedded|verbal) )?finite tense licensing$/u.test(clauses[0])
    || evidence.authoredPriorAnchors?.length) return [...facets];
  const anchors = evidence.authoredCurrentAnchors ?? [], values = evidence.authoredValues ?? [];
  const heads = anchors.filter(entry => /^(?:inflection|inflectional head|finite head|finite inflection|tense head|licensor|licensing head)$/u.test(normalizeTier2Synonym(entry.key)));
  const verbs = anchors.filter(entry => /^(?:(?:lexical|inflected|inflected lexical) )?verb$/u.test(normalizeTier2Synonym(entry.key)));
  const tenses = values.filter(entry => normalizeTier2Synonym(entry.key) === 'tense');
  if ([heads, verbs, tenses].some(entries => entries.length !== 1 || entries[0].items.length !== 1)
    || values.filter(entry => entry.concepts.includes('outcome')).some(entry => entry.items.some(literal =>
      !POSITIVE_OUTCOMES.includes(resolveOutcomeLiteral(literal)?.concept as typeof POSITIVE_OUTCOMES[number])))) return [...facets];
  const [headEntry] = heads, [verbEntry] = verbs, [tenseEntry] = tenses;
  const headNodes = indexes.currentIndex.nodes.get(headEntry.items[0]);
  const verbNodes = indexes.currentIndex.nodes.get(verbEntry.items[0]);
  if (headNodes?.length !== 1 || verbNodes?.length !== 1 || headEntry.items[0] === verbEntry.items[0]) return [...facets];
  const head = headNodes[0], verb = verbNodes[0];
  const headShape = readCategoryLabel(head.label), verbShape = readCategoryLabel(verb.label);
  const annotations = (node: SyntaxNode) => [...node.label.matchAll(/\[([^\[\]]*)\]/gu)]
    .flatMap(match => match[1].split(/[,;]/u)).map(value => value.trim().normalize('NFKC').toLocaleLowerCase('en-US'));
  const tense = normalizeTier2Synonym(tenseEntry.items[0]);
  const headFeatures = annotations(head);
  const contradictsTense = (features: readonly string[]) => features.some(feature =>
    ['past', 'present', 'future'].includes(feature) && feature !== tense);
  if (!tense || headShape?.kind !== 'head' || headShape.compound || !['I', 'T', 'Infl'].includes(headShape.category)
    || head.silent !== true || head.word?.trim() || head.children?.length
    || !headFeatures.some(feature => feature === 'finite' || feature === '+finite') || !headFeatures.includes(tense) || contradictsTense(headFeatures)
    || verbShape?.kind !== 'head' || verbShape.compound || verbShape.category !== 'V'
    || verb.silent || verb.children?.length || !verb.word?.trim()) return [...facets];
  const forms = values.filter(entry => normalizeTier2Synonym(entry.key) === 'realization');
  const explicitForm = forms.length === 1 && forms[0].items.length === 1
    && /^(?:lexically )?inflected (.+?)(?:;|$)/iu.exec(forms[0].items[0].trim())?.[1].trim() === verb.word.trim();
  const verbFeatures = annotations(verb);
  if (forms.length && !explicitForm || contradictsTense(verbFeatures)
    || !verbFeatures.includes(tense) && !explicitForm) return [...facets];
  const parents = [...(indexes.currentIndex.parentIds.get(head.id) ?? [])];
  const parentNodes = parents.length === 1 ? indexes.currentIndex.nodes.get(parents[0]) : undefined;
  const parent = parentNodes?.length === 1 ? parentNodes[0] : undefined;
  const parentShape = readCategoryLabel(parent?.label);
  const complements = parent?.children?.filter(child => child.id !== head.id) ?? [];
  const containsLocalVerb = (node: SyntaxNode): boolean => node.id === verb.id
    || (!['CP', 'IP', 'TP'].includes(readCategoryLabel(node.label)?.category ?? '')
      && Boolean(node.children?.some(containsLocalVerb)));
  if (parentShape?.kind !== 'bar' || parentShape.compound || parentShape.category !== headShape.category
    || complements.length !== 1 || readCategoryLabel(complements[0].label)?.category !== 'VP'
    || !containsLocalVerb(complements[0])) return [...facets];
  const treatments = values.filter(entry => normalizeTier2Synonym(entry.key) === 'morphological treatment');
  if (treatments.length > 1 || treatments.some(entry => entry.items.length !== 1
    || !/^whole[- ]word lexical inflection(?: without (?:overt )?(?:V|verb)-to-(?:I|T|Infl) movement)?\.?$/iu.test(entry.items[0].trim()))) return [...facets];
  const owners = facets.filter(facet => facet.recipe.id === 'pf.structured' && facet.evaluation.complete
    && (facet.evidence ?? evidence).currentAnchors['rewrite.output']?.length === 1
    && (facet.evidence ?? evidence).currentAnchors['rewrite.output'][0] === verb.id
    && facet.evaluation.consumedEvidence.some(ref => ref.field === 'values' && ref.key === tenseEntry.key));
  if (owners.length !== 1) return [...facets];
  const owner = owners[0];
  const rows = values.flatMap(entry => {
    const refs = owner.evaluation.consumedEvidence.filter(ref => ref.field === 'values' && ref.key === entry.key);
    const indices = [...new Set(refs.flatMap(ref => (ref.itemIndices ?? entry.items.map((_, index) => index))
      .map(index => owner.origins?.values[entry.key]?.[index] ?? index)))];
    return treatments.includes(entry) ? [{ entry, concept: 'pf.rows' }]
      : indices.length ? [{ entry, indices, concept: 'pf.rows' }] : [];
  });
  const scope = scopeEvidence(evidence, 'pf.structured', [
    { entry: verbEntry, concept: 'rewrite.output' }, { entry: headEntry, concept: 'pf.context' }
  ], rows);
  const evaluation = evaluateTier2FacetRecipe(owner.recipe, scope.evidence, indexes);
  if (!evaluation.complete) return [...facets];
  evaluation.consumedEvidence.push({ field: 'anchors', key: headEntry.key, itemIndices: [0] });
  return facets.map(facet => facet === owner ? { ...owner, evidence: scope.evidence, origins: scope.origins, evaluation } : facet);
};

export const dispatchRelationClaims = (
  input: ExclusiveRelationDispatchInput
): RelationClaimDispatch => {
  const {
    relation,
    stageIndex,
    relationIndex,
    currentForest,
    currentRealizations,
    priorRealizations,
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
  const registryEntry = findRelationRegistryEntry(registry, relation.relation);
  const evidence = buildTier2FacetEvidence({
    relation,
    currentForest,
    ...(currentRealizations ? { currentRealizations } : {}),
    ...(priorRealizations ? { priorRealizations } : {}),
    priorForest,
    activeLens,
    synonymIndex
  });
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
  const indexes = indexTier2Forests(evidence);
  const evaluations = evaluateClaims(evidence, indexes);
  const thematic = typedThematicAssignment(evidence);
  const focusAssociation = typedFocusAssociation(evidence);
  const qualifiedDeletion = normalizeTier2Synonym(evidence.relationName) === 'coordinate gapping'
    && evidence.authoredCurrentAnchors?.some(entry => normalizeTier2Synonym(entry.key) === 'deleted verb')
    && evidence.authoredPriorAnchors?.some(entry => normalizeTier2Synonym(entry.key) === 'verb before deletion');
  const targetInventory = evidence.authoredCurrentAnchors?.some(entry => normalizeTier2Synonym(entry.key) === 'agreement targets')
    && evidence.authoredCurrentAnchors?.some(entry => normalizeTier2Synonym(entry.key) === 'controller');
  const checkedAttraction = evidence.authoredValues?.some(entry => entry.concepts.includes('feature.label'))
    && /\b(?:relative|interrogative) operator attraction$/u.test(normalizeTier2Synonym(evidence.relationName));
  const typedSurfaceCombination = evidence.authoredValues?.some(entry => normalizeTier2Synonym(entry.key) === 'surface combination')
    && /\b(?:realization|realisation)\b/u.test(normalizeTier2Synonym(evidence.relationName));
  const completeClaims = evaluations.filter(({ recipe, evaluation }) => evaluation.complete
    && !(qualifiedDeletion && ['ellipsis.site', 'correspondence.alignment'].includes(recipe.id))
    && !(recipe.id === 'feature.dependency' && checkedAttraction)
    && !(recipe.id === 'pf.structured' && typedSurfaceCombination)
    && !(recipe.id === 'feature.dependency' && targetInventory && evaluation.consumedEvidence.some(ref => ref.field === 'anchors'
      && /^(?:controller|agreement targets)$/u.test(normalizeTier2Synonym(ref.key))))
    && !(evidence.movementFailure === 'MOVEMENT_NOT_ESTABLISHED' && ['movement.path', 'movement.carrier', 'scope.movement'].includes(recipe.id))
    && !(recipe.id === 'theta-grid' && (thematic.applies && !thematic.scope || typedInterpretiveRoles(evidence)))
    && !(recipe.id === 'focus.association' && focusAssociation.applies)
    && !(recipe.id === 'operator-binding' && typedInterpretedBinding(evidence)));
  const eligibleClaims = registryEntry
    ? completeClaims.filter(({ evaluation }) => {
        if (primaryAcceptsAdditionalAnchors) return false;
        const currentAnchorEvidence = evaluation.consumedEvidence.filter(
          ({ field }) => field === 'anchors'
        );
        return currentAnchorEvidence.length > 0 && currentAnchorEvidence.every(
          ({ key }) => (
            !declaredPrimaryAnchorKeys.has(normalizeTier2Synonym(key))
            && [...(evidence.authoredCurrentAnchors?.find(entry => entry.key === key)?.concepts ?? []),
              ...lookupTier2SynonymCandidates(synonymIndex, 'role', key)].every(
              (concept) => !declaredPrimaryAnchorConcepts.has(concept)
            )
          )
        );
      })
    : completeClaims;
  const { selected, diagnostics } = resolveClaimCollisions(eligibleClaims, evidence);
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
  const continued: Tier2EvaluatedFacet[] = !registryEntry
    ? recoverRelationScopes(relation, evidence, input.assignmentContext).flatMap(scope => {
        // Historical continuity can corroborate a subset of a claim already
        // recovered from this record. Its identical authored items do not
        // establish another grid or connector in the same relation moment.
        const alreadyOwned = selected.some(facet => facet.recipe.id === scope.kind
          && (['anchors', 'values'] as const).every(field => Object.entries(scope.origins[field]).every(([key, indices]) =>
            indices.every(index => facet.evaluation.consumedEvidence.some(ref => ref.field === field && ref.key === key
              && (ref.itemIndices === undefined || ref.itemIndices.includes(index)))))));
        const sharedInventoryOwned = scope.kind === 'feature.dependency'
          && !evidence.values['case.literal']?.length && nominalConcordMembers(evidence).length > 0
          && selected.some(facet => facet.recipe.id === 'feature-sharing'
            && authoredEvidenceItems(evidence, facet.evaluation.consumedEvidence)
              === authoredEvidenceItems(evidence, (['anchors', 'values'] as const).flatMap(field =>
                Object.entries(scope.origins[field]).map(([key, itemIndices]) => ({ field, key, itemIndices })))));
        if (alreadyOwned || sharedInventoryOwned) return [];
        const recipe = TIER2_FACET_RECIPES.find(recipe => recipe.id === scope.kind)!;
        const evaluation = evaluateTier2FacetRecipe(recipe, scope.evidence, indexes);
        return evaluation.complete ? [{ recipe, evaluation, evidence: scope.evidence, origins: scope.origins,
          ...('restates' in scope ? { restates: scope.restates } : {}) }] : [];
      }) : [];
  // A generic connector is the same claim's incomplete view when a recovered
  // scope supplies rows for exactly its original endpoint fields and items.
  // Other fields, repeated entries and independent endpoints remain separate.
  for (let index = selected.length - 1; index >= 0; index -= 1) {
    const facet = selected[index];
    const rewriteScopes = continued.filter(scope => scope.recipe.id === 'pf.rewrite'
      && scope.evidence?.authoredValues?.some(entry => entry.concepts.includes('rewrite.input.literal')));
    const originalIndices = (ref: RecoveredEvidenceReference) => {
      const entries = ref.field === 'anchors' ? evidence.authoredCurrentAnchors
        : ref.field === 'priorAnchors' ? evidence.authoredPriorAnchors : evidence.authoredValues;
      const entry = entries?.find(entry => entry.key === ref.key);
      return ref.itemIndices ?? entry?.items.map((_, i) => i) ?? [];
    };
    const coversReference = (scope: Tier2EvaluatedFacet, ref: RecoveredEvidenceReference) => {
      const indices = originalIndices(ref);
      return indices.length > 0 && indices.every(index => scope.origins?.[ref.field]?.[ref.key]?.includes(index));
    };
    // Exact scoped interpretation can add a supported domain or literal to the
    // same pair. Its weaker generic projection is not an independent drawing.
    if (['operator-binding', 'theta-grid'].includes(facet.recipe.id) && continued.some(scope => scope.recipe.id === facet.recipe.id
      && scope.evidence && facet.evaluation.consumedEvidence.every(ref => coversReference(scope, ref))
      && scope.evaluation.consumedEvidence.some(ref => !facet.evaluation.consumedEvidence.some(original => original.field === ref.field && original.key === ref.key)))) {
      selected.splice(index, 1);
      continue;
    }
    // Property interpretations of the same columns are weaker than their
    // complete mapping. Remove only those owned items; sibling rows keep their
    // original plaque and indices even when they share its physical host.
    if (['pf.structured', 'plaque.structured'].includes(facet.recipe.id)) {
      const anchors = facet.evaluation.consumedEvidence.filter(ref => ref.field === 'anchors');
      const owners = rewriteScopes.filter(scope => {
        if (anchors.length > 0 && anchors.every(ref => coversReference(scope, ref))) return true;
        // A generic PF reading may put the same stem literal on its containing
        // morphological complex. Exact rewrite-column ownership still wins;
        // containment alone never consumes an independent whole-word row.
        if (facet.recipe.id !== 'pf.structured') return false;
        const hosts = (facet.evidence ?? evidence).currentAnchors['rewrite.output'] ?? [];
        const outputs = scope.evidence?.currentAnchors['rewrite.output'] ?? [];
        if (hosts.length !== 1 || outputs.length !== 1 || hosts[0] === outputs[0]) return false;
        const host = indexes.currentIndex.nodes.get(hosts[0]);
        const contains = (node: SyntaxNode): boolean => node.id === outputs[0] || Boolean(node.children?.some(contains));
        return host?.length === 1 && Boolean(host[0].children?.some(contains));
      });
      // One collective realization owns the same literal more completely than
      // its generic member-only property. Separate rows keep their first scope.
      if (facet.recipe.id === 'pf.structured') {
        const hosts = (facet.evidence ?? evidence).currentAnchors['rewrite.output'] ?? [];
        owners.push(...continued.filter(scope => {
          const outputs = scope.evidence?.currentAnchors['rewrite.output'] ?? [];
          return scope.recipe.id === 'pf.structured' && scope.evidence?.realizationGroupAnchorKeys?.length
            && (scope.evaluation.outcomeConcept ?? null) === (facet.evaluation.outcomeConcept ?? null)
            && outputs.length > hosts.length && hosts.length > 0 && hosts.every(id => outputs.includes(id));
        }));
      }
      const valueRefs = facet.evaluation.consumedEvidence.filter(ref => ref.field === 'values');
      if (owners.some(scope => valueRefs.some(ref => originalIndices(ref).some(i => scope.origins?.values[ref.key]?.includes(i))))) {
        const values = valueRefs.flatMap(ref => {
          const entry = evidence.authoredValues?.find(entry => entry.key === ref.key)!;
          const indices = originalIndices(ref).filter(i => !owners.some(scope => scope.origins?.values[ref.key]?.includes(i)));
          return indices.length ? [{ entry, indices, concept: facet.recipe.values[0].value }] : [];
        });
        selected.splice(index, 1);
        if (values.length) {
          const scope = scopeEvidence(evidence, facet.recipe.id, anchors.map(ref => ({
            entry: evidence.authoredCurrentAnchors!.find(entry => entry.key === ref.key)!,
            indices: originalIndices(ref), concept: facet.recipe.anchors[0].role
          })), values);
          const evaluation = evaluateTier2FacetRecipe(facet.recipe, scope.evidence, indexes);
          if (evaluation.complete) continued.push({ recipe: facet.recipe, evaluation, evidence: scope.evidence, origins: scope.origins });
        }
      }
      continue;
    }
    // One typed mapping row can corroborate a richer original input/output
    // pair. It does not own a second plaque for those same fields and items.
    if (facet.recipe.id === 'pf.rewrite') {
      const covered = rewriteScopes.some(scope =>
        ['rewrite.input', 'rewrite.output'].every(role =>
          JSON.stringify(scope.evidence!.currentAnchors[role]) === JSON.stringify(evidence.currentAnchors[role])
          && JSON.stringify(scope.evidence!.priorAnchors?.[role]) === JSON.stringify(evidence.priorAnchors?.[role]))
        && facet.evaluation.consumedEvidence.every(ref => coversReference(scope, ref)));
      if (covered) selected.splice(index, 1);
      continue;
    }
    if (['feature.dependency', 'feature-sharing'].includes(facet.recipe.id) && continued.some(scope => scope.recipe.id === facet.recipe.id
      && scope.evidence && facet.evaluation.outcomeConcept === scope.evaluation.outcomeConcept
      && (facet.recipe.id === 'feature-sharing'
        ? JSON.stringify(scope.evidence.currentAnchors['feature.bearers']?.slice().sort()) === JSON.stringify(facet.evaluation.consumedEvidence.filter(ref => ref.field === 'anchors').flatMap(ref => {
          const entry = evidence.authoredCurrentAnchors?.find(entry => entry.key === ref.key);
          return entry ? (ref.itemIndices ?? entry.items.map((_, i) => i)).map(i => entry.items[i]) : [];
        }).sort())
        : ['feature.source', 'feature.target'].every(role => JSON.stringify(scope.evidence!.currentAnchors[role]) === JSON.stringify(evidence.currentAnchors[role])))
      && facet.evaluation.consumedEvidence.every(ref => coversReference(scope, ref))
      && scope.evaluation.consumedEvidence.some(ref => !facet.evaluation.consumedEvidence.some(original => original.field === ref.field && original.key === ref.key)))) {
      selected.splice(index, 1);
      continue;
    }
    if (facet.recipe.id !== 'feature.dependency' || evidence.values['case.literal']?.length
      || evidence.values['feature.rows']?.length) continue;
    const anchors = facet.evaluation.consumedEvidence.filter(ref => ref.field === 'anchors');
    const covered = continued.some(scope => scope.recipe.id === facet.recipe.id
      && scope.evidence && ['feature.source', 'feature.target'].every(role =>
        JSON.stringify(scope.evidence!.currentAnchors[role]) === JSON.stringify(evidence.currentAnchors[role]))
      && anchors.every(ref => {
        const entry = evidence.authoredCurrentAnchors?.find(entry => entry.key === ref.key);
        const indices = ref.itemIndices ?? entry?.items.map((_, i) => i) ?? [];
        return JSON.stringify(indices) === JSON.stringify(scope.origins?.anchors[ref.key]);
      }));
    if (covered) selected.splice(index, 1);
  }
  const properties = !registryEntry ? [...recoverParticipantProperties(evidence), ...recoverNamedArgumentProperties(evidence)]
    : authoredTier1Dispatch.outcome !== 'resolved' ? recoverPairedCaseProperties(evidence) : [];
  // An explicitly named abstract tense head owns a checked tense property.
  // A generic PF reading of that same lone row is weaker carrier evidence.
  if (relationLabelClauses(evidence.relationName).includes('tense feature checking')) {
    const tenseScopes = properties.filter(scope => scope.kind === 'plaque.structured'
      && scope.evidence.authoredCurrentAnchors?.some(entry => normalizeTier2Synonym(entry.key) === 'tense head')
      && scope.evidence.authoredValues?.some(entry => normalizeTier2Synonym(entry.key) === 'tense'));
    for (let i = selected.length - 1; i >= 0; i--) {
      const facet = selected[i];
      const rows = facet.evaluation.consumedEvidence.filter(ref => ref.field === 'values');
      if (facet.recipe.id === 'pf.structured' && rows.length && rows.every(ref => normalizeTier2Synonym(ref.key) === 'tense'
        && tenseScopes.some(scope => scope.origins.values[ref.key]?.length))) selected.splice(i, 1);
    }
  }
  for (const scope of properties) {
    const owned = (key: string, indices: number[]) => indices.every(index =>
      [...selected, ...continued].some(facet => facet.evaluation.consumedEvidence.some(ref => {
        if (ref.field !== 'values' || ref.key !== key) return false;
        const origins = facet.origins?.values[key];
        const claimed = origins && (ref.itemIndices ? ref.itemIndices.map(i => origins[i]) : origins);
        return claimed ? claimed.includes(index) : !ref.itemIndices || ref.itemIndices.includes(index);
      })));
    const remaining = scope.evidence.authoredValues!.filter(entry => !owned(entry.key, scope.origins.values[entry.key]));
    if (!remaining.length) continue;
    scope.evidence.authoredValues = remaining;
    scope.evidence.values = Object.fromEntries([...new Set(remaining.flatMap(entry => entry.concepts))].map(concept =>
      [concept, remaining.filter(entry => entry.concepts.includes(concept)).flatMap(entry => entry.items)]));
    scope.origins.values = Object.fromEntries(remaining.map(entry => [entry.key, scope.origins.values[entry.key]]));
    const recipe = TIER2_FACET_RECIPES.find(recipe => recipe.id === scope.kind)!;
    const evaluation = evaluateTier2FacetRecipe(recipe, scope.evidence, indexes);
    if (evaluation.complete) continued.push({ recipe, evaluation, evidence: scope.evidence, origins: scope.origins });
  }
  const completedClaims = registryEntry ? [...selected, ...continued]
    : ownFiniteTenseContext([...selected, ...continued], evidence, indexes);
  const tier2ClaimFacets = [...new Map(attachFacetIdentities(completedClaims, evidence, stageIndex, indexes)
    .map(facet => [JSON.stringify([facet.facetIdentity, facet.evaluation.consumedEvidence]), facet])).values()];
  const companions = attachFacetIdentities(
    evaluateCompanions(evidence, tier2ClaimFacets.length > 0, indexes),
    evidence,
    stageIndex,
    indexes,
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
    return !items.some((literal, index) => (ref.itemIndices === undefined || (!ref.itemIndices || ref.itemIndices.includes(index)))
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
  const thetaContext = registryEntry?.id === 'theta.grid'
    ? new Set(evidence.authoredCurrentAnchors?.filter(entry => entry.concepts.includes('predicate.context')).map(entry => entry.key))
    : new Set<string>();
  const unownedAnchors = tier1Dispatch.outcome === 'resolved'
    ? Object.keys(primaryRelation.anchors ?? {}).filter(key => thetaContext.has(key)
      || !primaryAcceptsAdditionalAnchors && !declaredPrimaryAnchorKeys.has(normalizeTier2Synonym(key))) : [];
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
  if (relation.relationContractFailure) {
    const primaryClaim: Tier3RecoveredClaim = {
      tier: 3,
      kind: 'fallback-primary',
      canonicalClaimIdentity: primaryClaimIdentity(relation, registryEntry?.id, 'fallback-primary'),
      reason: 'malformed-authored-relation',
      consumedEvidence: authoredEvidenceReferences(relation)
    };
    return {
      ...base,
      facets: [],
      facetDiagnostics: [],
      primaryClaim,
      claims: [primaryClaim],
      evidenceCoverage: describeEvidenceCoverage(relation, evidence, [primaryClaim], [], synonymIndex)
    };
  }
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
    // A drawing can account for an anchor without exhausting every assertion
    // involving it. Keep current context beside remaining participants, excluding
    // verified enclosure fields already owned by movement. Value-only and
    // prior-only remainders do not acquire new current connectors.
    if (unrecovered.some(entry => entry.field === 'anchors' && entry.unrecoveredItemIndices.length)
      && evidenceCoverage.fields.some(entry => entry.field === 'anchors' && entry.recognizedBy.length)) {
      const verifiedContext = new Set((evidence.movement?.context || []).filter(context =>
        evidenceCoverage.fields.some(field => field.field === 'anchors' && field.key === context.key
          && field.recognizedBy.length && !field.unrecoveredItemIndices.length)).map(context => context.key));
      claim.contextAnchors = structuredClone(Object.fromEntries(Object.entries(relation.anchors)
        .filter(([key]) => !verifiedContext.has(key))));
      claim.canonicalClaimIdentity = primaryClaimIdentity(
        claim.kind === 'fallback-residual' && residualRelation ? residualRelation : primaryRelation,
        claim.kind === 'fallback-primary' ? registryEntry?.id : undefined,
        claim.kind,
        claim.contextAnchors
      );
    }
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
    currentRealizations,
    priorRealizations,
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
      ...(currentRealizations ? { currentRealizations } : {}),
      ...(priorRealizations ? { priorRealizations } : {}),
      ...(priorForest ? { priorForest } : {}),
      ...(activeLens === undefined ? {} : { activeLens }),
      ...(registry ? { registry } : {}),
      ...(synonymIndex ? { synonymIndex } : {})
    })
  }));
};

/** Earlier claims can clarify later restatements; later relations never justify earlier ones. */
export function dispatchStageRelations(stages: readonly { workspaceForest: SyntaxNode[]; relations: DerivationStageRelation[]; realizations?: SurfaceRealization[] }[],
  options: Pick<ExclusiveRelationDispatchInput, 'registry' | 'activeLens'> = {}): RelationClaimDispatch[][] {
  const assignmentContext = createAssignmentContext();
  return stages.map((stage, stageIndex) => stage.relations.map((relation, relationIndex) => {
    const dispatch = dispatchRelationClaims({ ...options, relation, stageIndex, relationIndex, assignmentContext,
      currentForest: stage.workspaceForest, currentRealizations: stage.realizations,
      priorRealizations: stages[stageIndex - 1]?.realizations, priorForest: stages[stageIndex - 1]?.workspaceForest });
    recoveredClaimMovements(dispatch).forEach(movement => rememberAssignmentMovement(assignmentContext, movement));
    if (dispatch.primaryClaim?.tier === 1) {
      const primary = buildTier2FacetEvidence({ relation: dispatch.boundPrimaryRelation, currentForest: stage.workspaceForest });
      if (dispatch.primaryClaim.registryEntryId === 'theta.grid') {
        for (const assignment of nativeThetaAssignments(primary).assignments ?? []) {
          rememberAssignments(assignmentContext, 'theta-grid', { ...primary, currentAnchors: { ...primary.currentAnchors, predicate: [assignment.predicate] } },
            { stageIndex, relationIndex }, assignment.roles);
        }
      }
      for (const facet of evaluateClaims(primary, indexTier2Forests(primary))) {
        if (facet.evaluation.complete) rememberAssignments(assignmentContext, facet.recipe.id, primary, { stageIndex, relationIndex });
      }
    }
    for (const facet of dispatch.facets) rememberAssignments(assignmentContext, facet.recipe.id, facet.evidence ?? dispatch.evidence, { stageIndex, relationIndex });
    return dispatch;
  }));
}

/** Every exact movement in a simultaneous claim contributes to continuation. */
export function recoveredClaimMovements(dispatch: Pick<RelationClaimDispatch, 'evidence' | 'facets'>) {
  const movements = [dispatch.evidence.movement, ...dispatch.facets.map(facet => facet.evidence?.movement)]
    .filter((movement): movement is NonNullable<typeof movement> => Boolean(movement));
  return [...new Map(movements.map(movement => [JSON.stringify([
    movement.priorSourceNodeId, movement.sourceNodeId, movement.targetNodeId
  ]), movement])).values()];
}
