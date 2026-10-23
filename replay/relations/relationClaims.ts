import type { DerivationStageRelation, SurfaceRealization, SyntaxNode } from '../../types.ts';
import type { productionRelationRegistry } from '../relationDispatch/productionRegistry.js';
import type { dispatchRelation } from '../relationDispatch/relationDispatch.js';
import type { AssignmentContext, AssignmentScope } from './assignmentContinuity.ts';
import type { ControlContext } from './controlEvidence.ts';
import type { RecoveredMovement } from './movementEvidence.ts';
import type { Tier2FacetOutputIdentity } from './tier2FacetIdentity.ts';
import type { Tier2FacetEvaluation, Tier2FacetEvidence, Tier2FacetRecipe } from './tier2FacetTypes.ts';
import type { Tier2SynonymIndex } from './tier2Synonyms.ts';

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

export type Tier2EvaluatedFacet = Pick<Tier2ResolvedFacet, 'recipe' | 'evaluation' | 'evidence' | 'restates'> & {
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
  /** Structure-only rules that earned this relation's claims; see structuralRecognition.ts. */
  structuralRules?: import('./structuralRecognition.ts').StructuralRuleId[];
  /** The structural movement a wholly neutral claim was upgraded with; see structuralMovement.ts. */
  structuralMovement?: RecoveredMovement;
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
  controlContext?: ControlContext;
  registry?: typeof productionRelationRegistry;
  synonymIndex?: Tier2SynonymIndex;
  /** Structure-only rules for an unregistered envelope that earned no claim; see structuralRecognition.ts. */
  structuralRules?: ReadonlySet<import('./structuralRecognition.ts').StructuralRuleId>;
  /** Structural movement for this claim; see structuralMovement.ts. */
  structuralMovement?: RecoveredMovement;
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
