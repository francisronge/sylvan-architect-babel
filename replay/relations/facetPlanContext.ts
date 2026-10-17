import type { SyntaxNode } from '../../types.ts';
import type { Tier2ResolvedFacet } from './relationClaims.ts';
import type { PlanDiagnostic, PlanItemBase, PlanRelationRef, RelationPlanItem } from './renderPlan.ts';
import type { Tier2FacetEvidence, Tier2FacetId, Tier2VisualPrimitiveName } from './tier2FacetTypes.ts';

/** A proved facet carries its evidence and identity into the same plan primitives
 * as registered claims. Family handlers do not select a tier or alter evidence. */
export type FacetPlanContext = {
  one: (role: string) => string;
  facet: Tier2ResolvedFacet;
  push: (item: RelationPlanItem) => void;
  base: (facet: Tier2ResolvedFacet, pieces: readonly Tier2VisualPrimitiveName[], familyId: string, part?: string) => PlanItemBase;
  evidence: Tier2FacetEvidence;
  state: "licensed" | "blocked" | "failed" | undefined;
  nodes: Map<string, SyntaxNode>;
  many: (role: string) => string[];
  identityIndexFor?: (ids: string[], authored?: string) => string;
  dependencyIndexFor: (key: string, authored?: string) => string;
  dependencyKey: (tag: string, ids: readonly string[]) => string;
  occurrenceIndexFor: (family: string, ids: string[], authored?: string) => string;
  rows: { label: string; value: string; }[];
  nextPhaseIsPrimary: () => boolean;
  diagnostics: PlanDiagnostic[];
  relationRef: PlanRelationRef;
  facetId: Tier2FacetId;
};
export type FacetPlanCompilers = Record<Tier2FacetId, (context: FacetPlanContext) => void>;
