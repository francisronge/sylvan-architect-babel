import type { Tier2ForestIndexes, TreeIndex } from './tier2EvidenceQueries.ts';
import {
  INDEPENDENT_TIER2_VALUE_ROLES,
  indexTier2Forests,
  literalThetaRoles,
  namedThetaInventory
} from './tier2EvidenceQueries.ts';
import type {
  Tier2AuthoredEvidenceEntry,
  Tier2FacetEvaluation,
  Tier2FacetEvidence,
  Tier2FacetRecipe,
  Tier2VisualPrimitiveName
} from './tier2FacetTypes.ts';
import { thematicRoleLabel } from './tier2Synonyms.ts';

export type Tier2FacetOutputIdentity = {
  piece: Tier2VisualPrimitiveName;
  key: string;
};

export type Tier2FacetOutputIdentityInput = {
  indexes?: Tier2ForestIndexes;
  recipe: Tier2FacetRecipe;
  evaluation: Tier2FacetEvaluation;
  evidence: Tier2FacetEvidence;
  authoredStageIndex: number;
  parentFacetIdentities?: readonly string[];
};

const canonicalizeIdentity = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalizeIdentity);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((canonical, key) => {
        canonical[key] = canonicalizeIdentity((value as Record<string, unknown>)[key]);
        return canonical;
      }, {});
  }
  return value;
};

const identityWitnesses = (
  index: TreeIndex,
  ids: readonly string[],
  includeWorkspace = true
): Array<{
  id: string;
  lineages: string[];
  workspaces?: string[];
}> => ids.map((id) => ({
  id,
  lineages: [...new Set((index.nodes.get(id) ?? [])
    .map((node) => String(node.lineageId || ''))
    .filter(Boolean))].sort(),
  ...(includeWorkspace ? { workspaces: [...(index.workspaceIds.get(id) ?? [])].sort() } : {})
}));

const appendIdentityItems = (
  target: Record<string, string[]>,
  key: string,
  items: readonly string[]
) => {
  target[key] = [...(target[key] ?? []), ...items];
};

const identityRoleBlock = (
  recipeEntry: Tier2FacetRecipe,
  anchors: Readonly<Record<string, readonly string[]>> | undefined,
  authoredEntries: readonly Tier2AuthoredEvidenceEntry[] | undefined,
  index: TreeIndex,
  includeWorkspace = true
): Record<string, ReturnType<typeof identityWitnesses>> => {
  if (!authoredEntries) {
    return Object.fromEntries(
      Object.entries(anchors ?? {})
        .map(([role, ids]) => [role, identityWitnesses(index, [...ids], includeWorkspace)])
        .filter(([, witnesses]) => witnesses.length > 0)
    );
  }

  const recipeRoles = new Set(recipeEntry.anchors.map(({ role }) => role));
  const normalized: Record<string, string[]> = {};
  authoredEntries.forEach(({ key, concepts, items }) => {
    const matchingRoles = concepts.filter((concept) => recipeRoles.has(concept));
    const identityRoles = matchingRoles.length > 0
      ? matchingRoles
      : (recipeEntry.kind === 'claim' ? [`literal:${key}`] : []);
    identityRoles.forEach((role) => appendIdentityItems(normalized, role, items));
  });
  return Object.fromEntries(
    Object.entries(normalized)
      .map(([role, ids]) => [role, identityWitnesses(index, ids, includeWorkspace)])
      .filter(([, witnesses]) => witnesses.length > 0)
  );
};

const identityValueBlock = (
  recipeEntry: Tier2FacetRecipe,
  evidence: Tier2FacetEvidence
): Record<string, string[]> => {
  if (!evidence.authoredValues) {
    return Object.fromEntries(
      Object.entries(evidence.values)
        .map(([valueName, literals]) => [valueName, [...literals]])
        .filter(([, literals]) => literals.length > 0)
    );
  }

  const recipeValues = new Set(recipeEntry.values.map(({ value }) => value));
  const normalized: Record<string, string[]> = {};
  evidence.authoredValues.forEach(({ key, concepts, items }) => {
    const matchingValues = concepts.filter((concept) => recipeValues.has(concept));
    const identityValues = matchingValues.length > 0
      ? matchingValues.map(value => INDEPENDENT_TIER2_VALUE_ROLES.has(value) || value === 'feature.rows' && evidence.comparedFeatureKeys?.includes(key) ? `literal:${key}` : value)
      : (recipeEntry.kind === 'claim' ? [`literal:${key}`] : []);
    identityValues.forEach((value) => appendIdentityItems(normalized, value, items));
  });
  if (recipeEntry.id === 'theta-grid' && (namedThetaInventory(evidence)
    || thematicRoleLabel(evidence.relationName).status === 'literal')) {
    normalized['role.label'] = literalThetaRoles(evidence)!.map(({ nodeId, label }) => JSON.stringify([nodeId, label]));
  }
  return normalized;
};

const buildFacetIdentity = ({
  recipe: recipeEntry,
  evaluation,
  evidence,
  authoredStageIndex,
  parentFacetIdentities,
  indexes = indexTier2Forests(evidence)
}: Tier2FacetOutputIdentityInput, persistent = false): string | null => {
  if (!evaluation.complete) return null;
  if (recipeEntry.outputIdentity.kind === 'inherit-parent') {
    const parents = [...new Set((parentFacetIdentities ?? [])
      .map((identity) => String(identity || '').trim())
      .filter(Boolean))].sort();
    if (parents.length === 0) return null;
    const { currentIndex, priorIndex } = indexes;
    return JSON.stringify(canonicalizeIdentity({
      facet: recipeEntry.id,
      parents,
      authoredMoment: authoredStageIndex,
      currentAnchors: identityRoleBlock(
        recipeEntry,
        evidence.currentAnchors,
        evidence.authoredCurrentAnchors,
        currentIndex
      ),
      priorAnchors: identityRoleBlock(
        recipeEntry,
        evidence.priorAnchors,
        evidence.authoredPriorAnchors,
        priorIndex
      ),
      values: identityValueBlock(recipeEntry, evidence),
      outcome: evaluation.outcomeConcept,
      transitions: evaluation.earnedTransitions
    }));
  }

  const { currentIndex, priorIndex } = indexes;
  return JSON.stringify(canonicalizeIdentity({
    facet: recipeEntry.id,
    authoredMoment: persistent ? null : authoredStageIndex,
    currentAnchors: identityRoleBlock(
      recipeEntry,
      evidence.currentAnchors,
      evidence.authoredCurrentAnchors,
      currentIndex,
      !persistent
    ),
    priorAnchors: identityRoleBlock(
      recipeEntry,
      evidence.priorAnchors,
      evidence.authoredPriorAnchors,
      priorIndex
    ),
    values: identityValueBlock(recipeEntry, evidence),
    outcome: evaluation.outcomeConcept,
    transitions: evaluation.earnedTransitions
  }));
};

export const buildTier2FacetIdentity = (input: Tier2FacetOutputIdentityInput): string | null =>
  buildFacetIdentity(input);

export const buildTier2FacetOutputIdentities = (
  input: Tier2FacetOutputIdentityInput
): Tier2FacetOutputIdentity[] => {
  // A current-state claim follows its exact occurrences as the workspace grows.
  // Operations and references to earlier states retain their authored moment.
  // Full facet identity still owns dispatch, dependencies and replacement.
  const persistent = input.recipe.kind === 'claim'
    && input.recipe.persistence.kind !== 'while-active'
    && input.recipe.transitionRules.length === 0
    // Conservatively retain timing even for prior evidence owned by a sibling facet.
    && !Object.values(input.evidence.priorAnchors ?? {}).some(ids => ids.length > 0);
  const facetIdentity = buildFacetIdentity(input, persistent);
  if (!facetIdentity) return [];
  return input.evaluation.outputs.map((piece) => {
    let pieceIdentity = facetIdentity;
    if (persistent && input.recipe.id === 'operator-binding' && piece === 'Variable-binding path') {
      // The domain owns the hull. Restating the same binding without that
      // optional domain does not introduce another operator-variable path.
      const binding = JSON.parse(facetIdentity);
      delete binding.currentAnchors['scope.domain'];
      pieceIdentity = JSON.stringify(canonicalizeIdentity(binding));
    }
    return { piece, key: JSON.stringify(canonicalizeIdentity({ facetIdentity: pieceIdentity, piece })) };
  });
};
