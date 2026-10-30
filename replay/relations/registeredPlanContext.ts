import type { DerivationStageRelation, SyntaxNode } from '../../types.ts';
import type { productionRelationRegistry } from '../relationDispatch/productionRegistry.js';
import type { RelationStage } from '../relationStages.ts';
import type { RelationClaimDispatch } from './relationClaims.ts';
import type { ProductionFamilyKind, ProductionRenderFamily } from './renderFamilies.ts';
import type {
  DirectedPathPlanItem,
  PlanDiagnostic,
  PlanItemBase,
  PlanRelationRef,
  RelationPlanItem
} from './renderPlan.ts';

/** One validated registered claim and its compilation services. Family handlers
 * emit geometry-free marks; stage orchestration retains ordering and fallback. */
export type RegisteredPlanContext = {
  claim: {
    anchors: Record<string, string | string[]>;
    base: PlanItemBase;
    family: ProductionRenderFamily;
    values: DerivationStageRelation['values'];
    familyId: string;
    relation: DerivationStageRelation;
    claimDispatch: RelationClaimDispatch;
    primaryRelation: DerivationStageRelation;
    relationIndex: number;
    authoredValues: DerivationStageRelation['values'];
    relationRef: PlanRelationRef;
  };
  workspace: {
    nodes: Map<string, SyntaxNode>;
    stage: RelationStage;
    stageList: RelationStage[];
    stageIndex: number;
    relations: DerivationStageRelation[];
  };
  lookup: {
    caseAgreementRow: (stageIndex: number, relationIndex: number) => { label: string; value: string; } | undefined;
    registry: typeof productionRelationRegistry;
    families: Record<string, ProductionRenderFamily>;
    companionAnchors: (stageIndex: number, relationIndex: number) => Record<string, string | string[]>;
    nextPhaseIsPrimary: () => boolean;
    vocabularyAssignments: Map<number, number>;
  };
  output: {
    requireResolved: (role: string, nodeId: string) => boolean;
    pushDiagnostic: (kind: PlanDiagnostic['kind'], detail: string) => void;
    items: RelationPlanItem[];
    dependencyIndexFor: (key: string, authored?: string) => string;
    pushCompositeTrajectory: (trajectoryKind: 'phrasal' | 'head') => boolean;
    pushNeutralFallback: (anchorSource: Record<string, string | string[]>, includePriorCue: boolean, fallbackRelation?: PlanRelationRef, claimIdentity?: string) => void;
    resolvedIds: (role: string, value: string | string[] | undefined) => string[];
    /** Adds a Case path a claim derives. Every one in this stage runs before any
     * agreement collection composes, so claim order cannot change the result. */
    beforeCaseCoalescence: (derive: () => void) => void;
    /** Completes agreement collections after all Case paths in this stage are known. */
    afterCaseCoalescence: (complete: (cases: DirectedPathPlanItem[]) => void) => void;
  };
};

export type RegisteredPlanCompilers = Record<ProductionFamilyKind, (context: RegisteredPlanContext) => void>;
