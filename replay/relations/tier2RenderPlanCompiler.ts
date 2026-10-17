import type { SyntaxNode } from '../../types.ts';
import { domainFacetPlan } from './domainPlan.ts';
import type { FacetPlanCompilers } from './facetPlanContext.ts';
import { featureFacetPlan } from './featurePlan.ts';
import { movementFacetPlan } from './movementPlan.ts';
import { pfFacetPlan } from './pfPlan.ts';
import { collectForest, stableChainKey } from './planSyntax.ts';
import type { RelationClaimDispatch, Tier2ResolvedFacet } from './relationClaims.ts';
import type { PlanDiagnostic, PlanRelationRef, RelationPlanItem } from './renderPlan.ts';
import { structuralFacetPlan } from './structuralPlan.ts';
import type { Tier2VisualPrimitiveName } from './tier2FacetTypes.ts';
import {
  currentWitnessNodeIdsFromFacetIdentity,
  identityAnchorBlock,
  outputKeys,
  ownReplacementGroup,
  predecessorReplacementGroup
} from './tier2PlanIdentity.ts';
import { authoredRows, currentIds, outcomeState, unique } from './tier2PlanValues.ts';

/**
 * Lower complete Tier-2 facets into the semantic plan items
 * already painted by production. This module never dispatches by relation
 * name and never reconstructs facet/output identities.
 */

type CompileTier2Input = {
  relationRef: PlanRelationRef;
  dispatch: RelationClaimDispatch;
  currentForest: readonly SyntaxNode[];
  priorForest?: readonly SyntaxNode[];
  /** Shared dependency-index allocator: one index per dependency, never a list position.
   * An authored index is shown where authored and governs the dependency's other stages. */
  dependencyIndexFor?: (key: string, authored?: string) => string;
  occurrenceIndexFor?: (family: string, ids: string[], authored?: string) => string;
  nextPhaseIsPrimary?: () => boolean;
  identityIndexFor?: (ids: string[], authored?: string) => string;
};

export type CompileTier2Result = {
  items: RelationPlanItem[];
  diagnostics: PlanDiagnostic[];
};

export const compileTier2RelationOutputs = ({
  relationRef,
  dispatch,
  currentForest,
  priorForest,
  dependencyIndexFor = (key, authored) => (authored?.trim() ? authored : key),
  occurrenceIndexFor = (family, ids, authored) => dependencyIndexFor(`${family}:${[...ids].sort().join('|')}`, authored),
  nextPhaseIsPrimary = () => true,
  identityIndexFor
}: CompileTier2Input): CompileTier2Result => {
  const nodes = collectForest(currentForest);
  // The same chain-aware key as exact-name drawings, so both share one index per dependency.
  const dependencyKey = (tag: string, ids: readonly string[]) => stableChainKey(tag, nodes, [...ids]);
  const priorNodeIds = new Set(collectForest(priorForest || []).keys());
  const diagnostics: PlanDiagnostic[] = dispatch.diagnostics.map((diagnostic) => ({
    stageIndex: relationRef.stageIndex,
    relationIndex: relationRef.relationIndex,
    relation: relationRef.relation,
    kind: diagnostic.kind === 'unrecovered-evidence' ? 'unrecovered-evidence' : 'tier2-collision',
    detail: `${diagnostic.kind}:${diagnostic.collision}:${diagnostic.facets.join(',')}`
  }));
  const items: RelationPlanItem[] = [];

  const base = (
    facet: Tier2ResolvedFacet,
    pieces: readonly Tier2VisualPrimitiveName[],
    familyId: string,
    part = 'main'
  ) => {
    const tier2OutputIdentities = outputKeys(facet, pieces);
    const tier2OutputPieces = facet.outputIdentities
      .filter(({ key }) => tier2OutputIdentities.includes(key))
      .map(({ piece }) => piece);
    const authoredPriorWitnessNodeIds = unique(
      Object.values(identityAnchorBlock(facet.facetIdentity, 'priorAnchors')).flat()
    );
    const priorAnchorBlockComplete = authoredPriorWitnessNodeIds.length > 0
      && authoredPriorWitnessNodeIds.every((id) => priorNodeIds.has(id));
    const predecessorGroup = predecessorReplacementGroup(
      facet,
      relationRef.stageIndex,
      priorAnchorBlockComplete
    );
    const priorWitnessNodeIds = priorAnchorBlockComplete
      ? authoredPriorWitnessNodeIds
      : [];
    const tier2WitnessNodeIds = currentWitnessNodeIdsFromFacetIdentity(
      facet.facetIdentity
    ).filter((id) => nodes.has(id));
    return {
      relationRef,
      familyId,
      appearsAtStage: relationRef.stageIndex,
      persistence: facet.recipe.persistence.kind === 'while-active'
        ? 'stage-only' as const
        : 'replace-previous-instance' as const,
      replacementGroup: ownReplacementGroup(facet, relationRef.stageIndex),
      ...(predecessorGroup ? { replacementPredecessorGroup: predecessorGroup } : {}),
      backward: priorWitnessNodeIds.length > 0,
      priorWitnessNodeIds,
      tier2WitnessNodeIds,
      tier2FacetId: facet.recipe.id,
      tier2ClaimIdentity: facet.facetIdentity,
      ...(facet.restates ? { restatesAssignment: facet.restates } : {}),
      tier2OutputIdentities,
      tier2OutputPieces,
      tier2RenderPart: part,
      claimTier: 2 as const
    };
  };

  const push = (item: RelationPlanItem) => items.push(item);
  const valid = (ids: readonly string[]) => ids.filter((id) => nodes.has(id));
  dispatch.facets.forEach((facet) => {
    const evidence = facet.evidence ?? dispatch.evidence;
    const one = (role: string) => valid(currentIds(evidence, role))[0] || '';
    const many = (role: string) => valid(currentIds(evidence, role));
    const state = outcomeState(facet);
    const facetId = facet.recipe.id;
    const rows = facet.evidence ? authoredRows(evidence) : authoredRows({
      ...evidence, authoredValues: evidence.authoredValues?.flatMap(entry => {
        const refs = facet.evaluation.consumedEvidence.filter(ref => ref.field === 'values' && ref.key === entry.key);
        if (!refs.length) return [];
        const indices = new Set(refs.flatMap(ref => ref.itemIndices ?? entry.items.map((_, index) => index)));
        return [{ ...entry, items: entry.items.filter((_, index) => indices.has(index)) }];
      })
    });
    const lower = facetPlanCompilers[facetId];
    if (lower) lower({
      one,
      facet,
      push,
      base,
      evidence,
      state,
      nodes,
      many,
      identityIndexFor,
      dependencyIndexFor,
      dependencyKey,
      occurrenceIndexFor,
      rows,
      nextPhaseIsPrimary,
      diagnostics,
      relationRef,
      facetId
    });
    else diagnostics.push({
      stageIndex: relationRef.stageIndex, relationIndex: relationRef.relationIndex,
      relation: relationRef.relation, kind: 'tier2-lowering-missing',
      detail: `complete Tier-2 facet ${facetId} has no Task 8 lowering`
    });
  });

  return { items, diagnostics };
};

const facetPlanCompilers = { ...movementFacetPlan, ...structuralFacetPlan, ...featureFacetPlan, ...domainFacetPlan, ...pfFacetPlan } satisfies FacetPlanCompilers;
