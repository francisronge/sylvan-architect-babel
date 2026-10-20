/** Derived Replay contracts shared by compilation, layout, and presentation. */
import type * as d3 from 'd3';
import type { ResolvedRelationAnchor, ResolvedRelationLink } from '../relationLinks.ts';
import type {
  DerivationOperation,
  DerivationStage,
  DerivationStageRelation,
  ReplayDetailBlock,
  SurfaceRealization,
  SyntaxNode
} from '../types.ts';
import type { RecoveredMovement } from './relations/movementEvidence.ts';


export type HierNode = d3.HierarchyNode<SyntaxNode>;

export type VisibleLink = d3.HierarchyLink<SyntaxNode>;


export interface PlaybackStep {
  operation: DerivationOperation;
  sourceKind?: 'microstep' | 'derivation-effect' | 'derived';
  trajectoryKind?: ResolvedRelationLink['trajectoryKind'];
  movementSerializationStatus?: 'complete' | 'underspecified' | 'incoherent';
  movementDiagnostics?: string[];
  sourceFrameIndex?: number;
  visualFrameIndex?: number;
  replayFrameIndex?: number;
  replayKind?: 'micro' | 'relation' | 'macro';
  /** Zero-based order within one authored stage, independent of display labels. */
  replayStageStepIndex?: number;
  /**
   * Exact authored identity of the relation this Replay moment plays.
   * Placement interleaves relation moments with structural construction,
   * so a count of played moments is NOT a reliable identity — consumers must
   * reveal and focus plan items from this exact identity.
   */
  replayRelationIdentity?: { stageIndex: number; relationIndex: number };
  /** Exact compiler-owned neutral rewrite witnesses; these do not establish a movement chain. */
  replayTreeTransition?: {
    relationKey: string;
    currentNodeIds: string[];
    priorNodeIds: string[];
    /** Compiler-proved retained material each new parent attaches; see `FallbackTreeTransitionOwnership`. */
    attachments?: Array<{ host: string; wrapper: string }>;
  };
  replayProgressLabel?: string;
  targetNodeId: string;
  targetLabel: string;
  sourceNodeIds?: string[];
  sourceLabels: string[];
  recipe?: string;
  workspaceAfter?: string[];
  detailBlocks?: ReplayDetailBlock[];
  stepId?: string;
  chainId?: string;
  note?: string;
  stageRecord?: string;
  replayCanvasData?: SyntaxNode | null;
  replayVisibleNodeIds?: string[];
  replayRelationLinks?: ResolvedRelationLink[];
  replayUsesFutureLayoutScaffold?: boolean;
  /** Retained occurrences whose new child attachment has not yet played. */
  replayPendingAttachmentNodeIds?: string[];
  preserveReplayStep?: boolean;
  replaySuppressAutoRevealNodeIds?: string[];
  replayRealizations?: SurfaceRealization[];
  /** Inspection evidence only; never add these messages to the authored Replay panel. */
  replayRealizationDiagnostics?: string[];
}


export interface ReplaySupportLine {
  label: string;
  value: string;
  scope?: 'previous';
  emptyList?: true;
  referenceStatus?: 'unavailable' | 'ambiguous';
  /** Same-name, same-position authored value paired with a current participant. */
  literal?: string;
}


export interface ReplayPanelContent {
  heading: string;
  supportLines: Array<ReplaySupportLine & { key: string }>;
  /** The original record, selected by identity rather than reconstructed from drawing links. */
  authoredRelation: DerivationStageRelation | null;
}


export interface MovementArrow {
  source: HierNode;
  /** The authored lower occurrence before display-endpoint resolution. */
  sourceOccurrence?: HierNode;
  target: HierNode;
  traceNode?: HierNode;
  step: number;
  index?: string | null;
  operation?: DerivationOperation;
  trajectoryKind?: ResolvedRelationLink['trajectoryKind'];
}


export interface ReplayDerivationMovementPayload {
  operation?: DerivationOperation;
  sourceNodeId?: string;
  landingNodeId?: string;
  targetNodeId?: string;
  hostNodeId?: string;
  traceNodeId?: string;
  chainId?: string;
  note?: string;
  serializationStatus?: 'complete' | 'underspecified' | 'incoherent';
  diagnostics?: string[];
}


export interface ReplayDerivationAnchor {
  role?: string;
  nodeId?: string;
  lineageId?: string;
  value?: string;
  text?: string;
  [key: string]: unknown;
}


export interface ReplayDerivationChange {
  statement?: string;
  anchors?: ReplayDerivationAnchor[];
  continuityIds?: string[];
  details?: Record<string, unknown>;
  [key: string]: unknown;
}


export interface ReplayDerivationAfterState {
  workspaceForest?: SyntaxNode[];
  reusePreviousWorkspace?: boolean;
  realizations?: SurfaceRealization[];
}


export interface ReplayDerivationFrame {
  frameId?: string;
  stepId?: string;
  statement?: string;
  stageRecord?: string;
  relations?: DerivationStage['relations'];
  after?: ReplayDerivationAfterState;
  change?: ReplayDerivationChange;
  workspaceForest: SyntaxNode[];
  operation?: DerivationOperation;
  recipe?: string;
  chainId?: string;
  movement?: ReplayDerivationMovementPayload | null;
}


export interface DerivationReplayPlanStep {
  registeredEntryId?: string;
  /** Exact evidence owned by the neutral primary, excluding recovered sibling claims. */
  neutralTransitionEvidence?: Pick<DerivationStageRelation, 'anchors' | 'priorAnchors'>;
  recoveredMovement?: RecoveredMovement & { drawTrajectory: boolean };
  /** Several proved sources may converge on one landing in this single moment. */
  recoveredMovements?: Array<RecoveredMovement & { drawTrajectory: boolean }>;
  /** Exact new landing owned by a claim whose preceding source state is unavailable. */
  unprovenNewLandingNodeId?: string;
  /** New occurrences a neutral claim relates to earlier occurrences of the same object; see `anchoredCopyDisplacement`. */
  anchoredCopyDisplacement?: { copies: Array<{ nodeId: string; earlierNodeId?: string }>; earlierNodeIds: string[] };
  /** The new parent a prior-witness claim names that only wrapped its one retained witness; ordinary construction builds it. See `priorWitnessWrapperNodeIds`. */
  witnessWrapperNodeIds?: string[];
  /** On a claim without a movement of its own: the occurrences the stage's recovered movements relate (their current
   * landing and lower-occurrence subtrees and the earlier source subtree). The claim's displacement is judged outside them. */
  movementOccurrenceNodeIds?: string[];
  preserveMovementLanding?: boolean;
  pronunciationNodeIds?: string[];
  movementDiagnostics?: string[];
  kind?: 'micro' | 'relation' | 'macro';
  stageIndex?: number;
  stageNumber?: number;
  stageStepNumber?: number;
  stageStepCount?: number;
  progressLabel?: string;
  relation?: string;
  anchors?: Record<string, unknown>;
  /** Authored previous-stage witnesses, verbatim when authored. */
  priorAnchors?: Record<string, string | string[]>;
  /** Authored literal payload, verbatim when authored. */
  values?: Record<string, string | string[]>;
  relationContractFailure?: DerivationStageRelation['relationContractFailure'];
  authoredRelationIndex?: number;
  resolvedAnchors?: ReplayResolvedRelationAnchor[];
  /** Authored anchors whose exact id is absent from this stage's workspace; reported, never repaired. */
  unresolvedAnchors?: ReplayUnresolvedRelationAnchor[];
  sourceNodeIds?: string[];
  targetNodeId?: string;
  stageRecord?: string;
}


export interface ReplayUnresolvedRelationAnchor {
  role: string;
  nodeId: string;
  authoredAnchorIndex: number;
  fieldPath: string;
}


export interface ReplayResolvedRelationAnchor extends ResolvedRelationAnchor {
  authoredAnchorIndex: number;
}


export interface ReplayAuthoredRelationLink extends ResolvedRelationLink {
  authoredRelationIndex: number;
  authoredRelationKey: string;
  endpointOrderProvenance?: 'authored-anchor-order' | 'registered-role-order' | 'recovered-movement';
  identityKey?: string;
  identityProvenance?: 'authored-shared-lineage';
  relationIndexProvenance: 'derived-presentation';
  /** Proven preceding occurrence, retained for the panel's movement source. */
  priorSourceNodeId?: string;
}


export interface DerivationReplayPlanStage {
  stageIndex: number;
  stageNumber: number;
  statement?: string;
  stageRecord?: string;
  relationSteps?: DerivationReplayPlanStep[];
  macroStep?: DerivationReplayPlanStep;
  realizations?: SurfaceRealization[];
}


export interface DerivationReplayPlan {
  stages?: DerivationReplayPlanStage[];
  steps?: DerivationReplayPlanStep[];
}
