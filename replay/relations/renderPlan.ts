/** Compiled relation data and exact ownership/lifetime rules. No claim recognition or geometry. */
import type { SyntaxNode } from '../../types.ts';
import { headTrajectoryAttachment, terminalTrajectoryAttachment } from './trajectoryAttachment.ts';
import type { FallbackDrawing } from './fallbackTopology.ts';
import type { LargeAnchorSet } from './largeAnchorSets.ts';
import type { NativePlaqueContent } from './nativeDrawingContent.ts';
import type { RelationEvidenceCoverage } from './relationClaims.ts';
import type { ProductionRenderFamily, RenderPersistence } from './renderFamilies.ts';
import type { Tier2VisualPrimitiveName } from './tier2FacetTypes.ts';


export type PlanRelationRef = {
  stageIndex: number;
  relationIndex: number;
  relation: string;
  anchors: Record<string, string | string[]>;
  priorAnchors?: Record<string, string | string[]>;
  values?: Record<string, string | string[]>;
};


export type PlanDiagnostic = {
  stageIndex: number;
  relationIndex: number;
  relation: string;
  kind:
    | 'anchor-unresolved'
    | 'prior-anchor-unresolved'
    | 'prior-anchor-without-prior-stage'
    | 'witness-missing'
    | 'witness-outside-source'
    | 'signature-incomplete'
    | 'endpoint-missing'
    | 'illegal-configuration'
    | 'value-unrecognized'
    | 'large-array-anchor-unresolved'
    | 'ambiguous-package-ownership'
    | 'anchor-vanished'
    | 'tier2-collision'
    | 'tier2-evidence'
    | 'claim-evidence'
    | 'unrecovered-evidence'
    | 'tier2-lowering-missing';
  detail: string;
  evidenceCoverage?: RelationEvidenceCoverage;
  candidateFailures?: Array<{ facetId: string; failures: string[] }>;
};


export type PlanItemBase = {
  relationRef: PlanRelationRef;
  /** Registry entry id; absent only on fallback and anchor-set items. */
  familyId?: string;
  appearsAtStage: number;
  persistence: RenderPersistence;
  /** Replacement grouping key for replace-previous-instance families. */
  replacementGroup?: string;
  /**
   * The thread key of the earlier state this instance authored itself as
   * continuing (via `priorAnchors`); proves replacement across differing
   * participant sets.
   */
  replacementPredecessorGroup?: string;
  /**
   * The exact later relation moment that replaces this state. The previous
   * state remains visible until that moment plays, then yields atomically.
   */
  supersededAt?: PlanRelationRef;
  /** Exact lower-occurrence replacements proven by later movement, applied at their own moments. */
  occurrenceTransfers?: Array<{ fromNodeId: string; toNodeId: string; stageIndex: number; relationIndex: number }>;
  /** True when the instance authors resolved previous-stage witnesses. */
  backward: boolean;
  /** Resolved previous-stage witness node ids, in authored order. */
  priorWitnessNodeIds: string[];
  /** Resolved current witnesses required by an attached Tier-2 output identity. */
  tier2WitnessNodeIds?: string[];
  /**
   * Fields whose contents are SUBTREE SNAPSHOTS derived from an anchored
   * root — presentation geometry, not authored dependencies. Persistence
   * refreshes each declared field from the CURRENT frame's exact root at
   * materialization (never lineage retargeting), and the dependency law
   * excludes exactly these declared fields. Direct authored arrays (e.g.
   * Improper Movement's forbiddenRegion and Transfer's edge carry NO
   * declaration and stay hard dependencies.
   */
  subtreeDerived?: Array<{ field: string; rootNodeId: string; mode: 'all' | 'authored-silent' }>;
  /**
   * Relation instances whose identical mark was visually coalesced into this
   * one. Every contributing authored instance is retained here — coalescing
   * merges pixels, never provenance.
   */
  coalescedRefs?: PlanRelationRef[];
  /**
   * Distinct authored relations intentionally presented by this one
   * composite mark. Unlike coalescedRefs these are not duplicate claims;
   * each keeps its own Replay moment and can focus the shared mark.
   */
  composedRefs?: PlanRelationRef[];
  /**
   * Complete output identities attached by exclusive Tier-2 dispatch. The
   * renderer consumes these verbatim for visual coalescing; it never rebuilds
   * identity from plan geometry or relation names.
   */
  tier2OutputIdentities?: string[];
  tier2OutputPieces?: Tier2VisualPrimitiveName[];
  tier2FacetId?: string;
  /** Groups inseparable pieces of one claim, including several claims in one relation. */
  tier2ClaimIdentity?: string;
  /** An unchanged assignment proven from this earlier authored claim. */
  restatesAssignment?: { stageIndex: number; relationIndex: number };
  /** Deterministic renderer subdivision of one composite visual piece. */
  tier2RenderPart?: string;
  /** One recovered semantic claim has exactly one winning tier owner. */
  claimTier?: 1 | 2 | 3;
  /** Tier-neutral identity used only to coalesce equivalent recovered claims. */
  canonicalClaimIdentity?: string;
};


export const planItemRelationRefs = (item: RelationPlanItem): PlanRelationRef[] => [
  item.relationRef,
  ...(item.composedRefs || []),
  ...(item.coalescedRefs || [])
];


/** Coalescing keeps every authored stage available to same-stage composition. */
export const planItemsShareAuthoredStage = (left: RelationPlanItem, right: RelationPlanItem): boolean =>
  planItemRelationRefs(left).some(a => planItemRelationRefs(right).some(b => a.stageIndex === b.stageIndex));


/**
 * Endpoint attachment, explicit in the semantic plan: `terminal` endpoints
 * resolve to the visible materialized terminal inside the exact anchored
 * preterminal or witness subtree; `shell` endpoints resolve to the anchored
 * node itself. Head-sized trajectories retain their terminal attachment;
 * earlier landings stay at the retained occurrence after subsequent movement;
 * phrase-sized trajectories run trace-terminal-to-phrase-shell. The
 * source-backed ParasiticGap composition meets the measured lower edge of
 * both phrase-shell labels, matching the accepted plate.
 */
export type TrajectoryEndpointAttachment = 'terminal' | 'shell' | 'shell-top' | 'shell-bottom';


export type TrajectoryPlanItem = PlanItemBase & {
  kind: 'trajectory';
  outcome?: 'licensed' | 'blocked';
  trajectoryKind: NonNullable<ProductionRenderFamily['trajectoryKind']>;
  sourceNodeId: string;
  targetNodeId: string;
  witnessNodeId?: string;
  /** Exact displayed departure when a nested witness is a category, not a terminal. */
  sourceAttachmentNodeId?: string;
  /**
   * Derived silent leaves that define the accepted remnant bracket's
   * departure footprint. Prior nested evacuation sources are excluded so a
   * different chain cannot pull the remnant path toward itself.
   */
  orthogonalDepartureNodeIds?: string[];
  sourceAttachment: TrajectoryEndpointAttachment;
  targetAttachment: TrajectoryEndpointAttachment;
  /** A head-adjunction landing stays at its syntactic position when its contents move again. */
  headLandingSite?: {
    nodeId: string;
    transfers: Array<{ nodeId: string; stageIndex: number; relationIndex: number }>;
  };
};

export const trajectorySourceNodeId = (item: TrajectoryPlanItem): string =>
  item.sourceAttachmentNodeId || (item.sourceAttachment === 'terminal'
    ? item.witnessNodeId || item.sourceNodeId : item.sourceNodeId);


/** Rewrite only derived geometry references. Authored evidence and claim ownership stay verbatim. */
export const remapPlanOccurrence = (item: RelationPlanItem, from: string, to: string): RelationPlanItem => {
  const excluded = new Set(['relationRef', 'relationRefs', 'composedRefs', 'coalescedRefs', 'supersededAt',
    'occurrenceTransfers', 'headLandingSite', 'priorWitnessNodeIds']);
  const visit = (value: unknown, key: string): unknown => {
    if (excluded.has(key)) return value;
    if (Array.isArray(value)) return value.map(entry => visit(entry, key));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .map(([childKey, childValue]) => [childKey, visit(childValue, childKey)]));
    return typeof value === 'string' && value === from && (/nodeids?$/iu.test(key) || key === 'witness') ? to : value;
  };
  return visit(item, '') as RelationPlanItem;
};


/** Bind exact occurrence replacements and pending terminal attachments at this Replay moment. */
export const resolveDisplayedTrajectoryAttachments = (
  item: RelationPlanItem,
  nodeFor: (nodeId: string) => SyntaxNode | undefined,
  moment?: { stageIndex: number; playedRelationIndices: ReadonlySet<number> | null }
): RelationPlanItem => {
  if (moment && item.occurrenceTransfers?.length) {
    for (const transfer of [...item.occurrenceTransfers].reverse()) {
      if (transfer.stageIndex > moment.stageIndex || transfer.stageIndex === moment.stageIndex
        && moment.playedRelationIndices !== null && !moment.playedRelationIndices.has(transfer.relationIndex)) {
        item = remapPlanOccurrence(item, transfer.toNodeId, transfer.fromNodeId);
      }
    }
  }
  if (item.kind !== 'trajectory') return item;
  if (item.headLandingSite) {
    const transfers = item.headLandingSite.transfers.filter(transfer => !moment
      || transfer.stageIndex < moment.stageIndex
      || (transfer.stageIndex === moment.stageIndex
        && (moment.playedRelationIndices === null || moment.playedRelationIndices.has(transfer.relationIndex))));
    const retainedLanding = transfers.at(-1);
    if (retainedLanding) item = { ...item, targetNodeId: retainedLanding.nodeId };
  }
  const sourceNodeId = trajectorySourceNodeId(item);
  const source = nodeFor(sourceNodeId);
  const target = nodeFor(item.targetNodeId);
  const sourceAttachment = item.sourceAttachment === 'terminal' && source
    ? terminalTrajectoryAttachment(source) : item.sourceAttachment;
  const targetAttachment = item.targetAttachment === 'terminal' && target
    ? (item.trajectoryKind === 'head' ? headTrajectoryAttachment(target) : terminalTrajectoryAttachment(target))
    : item.targetAttachment;
  return sourceAttachment === item.sourceAttachment && targetAttachment === item.targetAttachment
    ? item : { ...item, sourceAttachment, targetAttachment,
      ...(sourceAttachment !== item.sourceAttachment && sourceNodeId !== item.sourceNodeId
        ? { sourceAttachmentNodeId: sourceNodeId } : {}) };
};


export type CoindexPlanItem = PlanItemBase & {
  kind: 'coindex';
  nodeIds: string[];
  index: string;
};


export type BindingDomainPlanItem = PlanItemBase & {
  kind: 'binding-domain';
  binderNodeId: string;
  boundNodeId: string;
  domainNodeId: string;
  domainMemberNodeIds: string[];
  /** Authored judgment only; absent when the model authored none. */
  outcome?: 'licensed' | 'failed';
  index: string;
};


export type EllipsisSitePlanItem = PlanItemBase & {
  kind: 'ellipsis-site';
  /** Visual variant carried by the primitive instead of inferred from its relation family. */
  ellipsisStyle?: 'recoverability';
  siteNodeId: string;
  antecedentNodeId?: string;
  antecedentSubtreeNodeIds?: string[];
  /** Only material the model authored silent ghosts. */
  ghostNodeIds: string[];
  /** The whole site subtree, for domain-region marks like the tall slash. */
  siteSubtreeNodeIds: string[];
};


export type DirectedPathStyle =
  | 'control'
  | 'agree-multiple'
  | 'agree-cyclic'
  | 'case-assignment'
  | 'case-agree'
  | 'dependent-case'
  | 'accord'
  | 'anti-locality'
  | 'blocked-access'
  | 'blocked-extraction'
  | 'intervention'
  | 'f-projection'
  | 'improper-candidate'
  | 'covert-qr';


export type DirectedPathPlanItem = PlanItemBase & {
  kind: 'directed-path';
  fromNodeId: string;
  toNodeId: string;
  pathStyle: DirectedPathStyle;
  label?: string;
  secondaryLabel?: string;
  featureRow?: { label: string; value: string };
  projectionFeature?: string;
  projectionTargetAttachment?: 'terminal' | 'shell';
  sourceOccurrenceNodeId?: string;
  dependentCaseStep?: string;
  outcome?: 'licensed' | 'blocked';
};


export type UndirectedLinkStyle =
  | 'predication'
  | 'feature-sharing'
  | 'pair-merge'
  | 'strong-npi'
  | 'gapping-pair';


export type UndirectedLinkPlanItem = PlanItemBase & {
  kind: 'undirected-link';
  pairs: Array<{ fromNodeId: string; toNodeId: string; label?: string }>;
  linkStyle: UndirectedLinkStyle;
  label?: string;
};


export type DomainMarkStyle =
  | 'phase'
  | 'transfer-edge'
  | 'adjunct-domain'
  | 'idiom'
  | 'forbidden-region'
  | 'scope'
  | 'argument-domain'
  | 'control-domain';


/** Fong's Transfer/PIC tilted component arc around one component head. */
export type FongComponentPlanItem = PlanItemBase & {
  kind: 'fong-component';
  headNodeId: string;
  componentLabel: 'Phase' | 'SOD';
};


/** The blocked post-Transfer access attempt: dashed lane under the domain. */
export type BlockedAccessLanePlanItem = PlanItemBase & {
  kind: 'blocked-access-lane';
  sourceNodeId: string;
  targetNodeId: string;
  domainMemberNodeIds: string[];
};


/** Phillips island path-status: path-following circles/squares plus the
 * double-slashed blocked edge. */
export type PathStatusPlanItem = PlanItemBase & {
  kind: 'path-status';
  primaryNodeIds: string[];
  secondaryNodeIds: string[];
  blockedEdgeNodeId?: string;
  
  outcome?: 'licensed' | 'blocked';
};


export type DomainMarkPlanItem = PlanItemBase & {
  kind: 'domain-mark';
  rootNodeId?: string;
  /** Argument-sharing geometry owns its anchor independently of an optional role label. */
  sharedNodeId?: string;
  /** Phase-only: the authored edge controls the accepted arc span. */
  phaseEdgeNodeId?: string;
  /** Phase-only: the first authored boundary uses the primary arc preset. */
  phasePrimary?: boolean;
  memberNodeIds: string[];
  domainStyle: DomainMarkStyle;
  label?: string;
  outcome?: 'licensed' | 'blocked';
};


export type NodePlaqueStyle =
  | 'feature'
  | 'realization'
  | 'correspondence'
  | 'cooper-storage'
  | 'linearization'
  | 'dislocation-lane'
  | 'theta-grid'
  | 'fission'
  | 'impoverishment'
  | 'spellout-label';


export type NodePlaquePlanItem = PlanItemBase & {
  kind: 'node-plaque';
  anchorNodeIds: string[];
  /** Derived terminal descendants used only to position an accepted feature plaque. */
  positionNodeIds?: string[];
  plaqueStyle: NodePlaqueStyle;
  title?: string;
  /** This heading describes an anchored node; it is not an authored value. */
  anchorDerivedTitle?: true;
  rows: Array<{ label: string; value: string }>;
  /** Same-moment feature bundles retain the claim identity of every contributing row. */
  featureRowClaims?: string[][];
  thetaRoles?: Array<{ nodeId: string; label: string; index?: string; relationRefs?: PlanRelationRef[] }>;
  nativeContent?: NativePlaqueContent;
  realizationRowKinds?: Array<'rewrite' | 'literal'>;
  /** Exact authored moment that introduces each row; null means the owner relation. */
  rowRefs?: Array<PlanRelationRef | null>;
  /** The authored realization group this plate shows (realizationDisplay.ts). It is
   * revealed while Replay holds the group active, never by its relation reference. */
  realization?: PlanRealization;
};


/** One moment of a stage: an authored relation's moment, or none (`relationIndex: null`) when
 * no moment of the stage shows it; the mark then appears from the next stage on. */
export type PlanStageMoment = { stageIndex: number; relationIndex: number | null };

/** The reference of a realization plate no relation moment shows (a stage without relation
 * moments); no authored relation has this index, so no relation moment focuses it. */
export const UNOWNED_RELATION_INDEX = -1;

export type PlanRealization = {
  nodeIds: string[];
  tokenIndices: number[];
  /** Where Replay makes the group active (realizationReplay.ts). */
  activatedAt: PlanStageMoment;
  /** Where a later change of the same input replaces or removes it. */
  retiredAt?: PlanStageMoment;
};


export type NodeBadgeStyle =
  | 'agreement-goal'
  | 'gap-notation'
  | 'path-status'
  | 'shared-object'
  | 'idiom-chunk'
  | 'boundary-cut'
  | 'improper-hosts'
  | 'phase-edge'
  | 'theta-role'
  | 'intervener'
  | 'facilitator'
  | 'local-judgment'
  | 'gapping-ordinal';


export type NodeBadgesPlanItem = PlanItemBase & {
  kind: 'node-badges';
  badges: Array<{ nodeId: string; text: string; shape: 'circle' | 'square' | 'plain' }>;
  badgeStyle: NodeBadgeStyle;
  outcome?: 'licensed' | 'blocked';
};


/** One anchored analysis verdict. The glyph and its optional authored label
 * are inseparable, so neither can attach to an unrelated verdict in layout. */
export type AnalysisVerdictPlanItem = PlanItemBase & {
  kind: 'analysis-verdict';
  analysisNodeId: string;
  judgment: string;
  label?: string;
};


/** Split antecedence uses the source's asymmetric coreference convention:
 * one dependent origin and one directed link to each authored antecedent. */
export type SplitAntecedencePlanItem = PlanItemBase & {
  kind: 'split-antecedence';
  antecedentNodeIds: string[];
  dependentNodeId: string;
};


/** The accepted gapping plate: one predicate correspondence plus ordered
 * correlate/remnant correspondences and their authored labels. */
export type GappingAlignmentPlanItem = PlanItemBase & {
  kind: 'gapping-alignment';
  antecedentNodeId: string;
  gapNodeId: string;
  pairs: Array<{
    correlateNodeId: string;
    remnantNodeId: string;
    label: string;
  }>;
};


/** The accepted QR composition: one scope domain, one covert elbow path,
 * and one shared index on the pronounced and LF occurrences. */
export type QuantifierRaisingPlanItem = PlanItemBase & {
  kind: 'quantifier-raising';
  pronouncedNodeId: string;
  lfNodeId: string;
  scopeDomainNodeId?: string;
  index: string;
};


/** Operator-variable binding is a semantic composition, not movement: one
 * optional scope domain, one binding path, and one shared relation index. */
export type OperatorVariableBindingPlanItem = PlanItemBase & {
  kind: 'operator-variable-binding';
  operatorNodeId: string;
  variableNodeId: string;
  traceWitnessNodeId?: string;
  scopeDomainNodeId?: string;
  scopeMemberNodeIds?: string[];
  index: string;
  /** Shared path owners; the optional domain retains this item's own owners. */
  bindingPathRefs?: PlanRelationRef[];
  /** Another co-visible item draws this exact binding path and its indices. */
  bindingPathSuppressed?: boolean;
};


/** A source-backed semantic copy fork: one filler-content input, one open
 * junction, and unheaded outputs to the ordinary and parasitic gap sites. */
export type ParasiticGapCopyPlanItem = PlanItemBase & {
  kind: 'parasitic-gap-copy';
  contentNodeId: string;
  ordinaryGapNodeId: string;
  parasiticGapNodeIds: string[];
};


export type StrikeGhostPlanItem = PlanItemBase & {
  kind: 'strike-ghost';
  strikeNodeIds: string[];
  ghostNodeIds: string[];
};


export type EnclosurePlanItem = PlanItemBase & {
  kind: 'enclosure';
  nodeId: string;
  licence: 'remnant-landing' | 'carrier-chunk' | 'copy-occurrence';
};


export type BranchEmphasisPlanItem = PlanItemBase & {
  kind: 'branch-emphasis';
  focusNodeId?: string;
  strongEdges: Array<{ fromNodeId: string; toNodeId: string }>;
  weakEdges: Array<{ fromNodeId: string; toNodeId: string }>;
};


export type SharedNodePlanItem = PlanItemBase & {
  kind: 'shared-node';
  parentNodeIds: string[];
  sharedNodeId: string;
};


export type FallbackPlanItem = PlanItemBase & {
  kind: 'fallback';
  drawing: FallbackDrawing;
};


export type AnchorSetPlanItem = PlanItemBase & {
  kind: 'anchor-set';
  set: LargeAnchorSet;
  /** Fallback already numbers its own witnesses; in that case add only the rail. */
  showBadges: boolean;
  badgeSize: 'standard' | 'compact';
  /** Exact claims whose already-materialized entries this organization follows. */
  organizationOwners?: string[];
  /** Mixed visible sets preserve supported entries and each owner's badge size. */
  badgeEntries?: Array<{ roleIndex: number; arrayIndex: number; badgeSize?: 'standard' | 'compact' }>;
};


export type RelationPlanItem =
  | TrajectoryPlanItem
  | CoindexPlanItem
  | BindingDomainPlanItem
  | EllipsisSitePlanItem
  | DirectedPathPlanItem
  | UndirectedLinkPlanItem
  | DomainMarkPlanItem
  | FongComponentPlanItem
  | BlockedAccessLanePlanItem
  | PathStatusPlanItem
  | NodePlaquePlanItem
  | NodeBadgesPlanItem
  | AnalysisVerdictPlanItem
  | SplitAntecedencePlanItem
  | GappingAlignmentPlanItem
  | QuantifierRaisingPlanItem
  | OperatorVariableBindingPlanItem
  | ParasiticGapCopyPlanItem
  | StrikeGhostPlanItem
  | EnclosurePlanItem
  | BranchEmphasisPlanItem
  | SharedNodePlanItem
  | FallbackPlanItem
  | AnchorSetPlanItem;


export type RelationRenderPlan = {
  planVersion: 1;
  registryId: string;
  registryVersion: string;
  stageCount: number;
  /** One frame per derivation stage; items in deterministic layer order. */
  frames: Array<{ stageIndex: number; items: RelationPlanItem[] }>;
  diagnostics: PlanDiagnostic[];
  unregistered: Array<{ relation: string; count: number }>;
};


  /**
 * The single dependency law shared by compiler persistence and geometry
 * binding: every node id the item's complete authored claim requires.
 * A mark's persistence is validated against the node ids THAT MARK
 * actually depends on, never the relation's complete authored anchor set:
 * an extra open role vanishing must not veto a valid specialized core.
 * What counts as derived is DECLARED PER ITEM via `subtreeDerived` —
 * never inferred from a field's name: an Improper Movement forbidden
 * region stores authored members in the same field a Phase arc stores a
 * subtree snapshot in, and only the item knows which it holds. Prior
 * witnesses are provenance for the backward cue, resolved against the
 * PRECEDING stage, and are never current-frame dependencies.
 */
export const planItemDependencyNodeIds = (item: RelationPlanItem): string[] => {
  const ids = new Set<string>();
  const derivedFields = new Set(
    (item.subtreeDerived || []).map((declaration) => declaration.field)
  );
  /*
   * Every refresh ROOT is itself a hard current-frame dependency: the
   * derived field contents and the declaration metadata are excluded from
   * walking, but the anchored root the geometry derives from must exist
   * in every frame the mark draws in — and it is not guaranteed to be
   * duplicated in another `*NodeId` field (blocked-access lanes carry
   * their transfer domain only here).
   */
  (item.subtreeDerived || []).forEach((declaration) => {
    const rootNodeId = String(declaration.rootNodeId || '');
    if (rootNodeId) ids.add(rootNodeId);
  });
  (item.tier2WitnessNodeIds || []).forEach((nodeId) => {
    const normalizedNodeId = String(nodeId || '');
    if (normalizedNodeId) ids.add(normalizedNodeId);
  });
  const walk = (value: unknown, key: string) => {
    if (
      key === 'relationRef'
      || key === 'relationRefs'
      || key === 'composedRefs'
      || key === 'coalescedRefs'
      || key === 'supersededAt'
      || key === 'headLandingSite'
      || key === 'occurrenceTransfers'
      || key === 'subtreeDerived'
      || key === 'positionNodeIds'
      || key === 'priorWitnessNodeIds'
      || key === 'tier2WitnessNodeIds'
      || derivedFields.has(key)
    ) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => walk(entry, key));
      return;
    }
    if (value && typeof value === 'object') {
      Object.entries(value as Record<string, unknown>).forEach(([childKey, childValue]) =>
        walk(childValue, childKey));
      return;
    }
    if (typeof value === 'string' && value && (/nodeids?$/i.test(key) || key === 'witness')) {
      ids.add(value);
    }
  };
  if (item.kind === 'anchor-set') {
    /*
     * A legacy anchor-set rail draws ONLY the roles flagged `large`; the stored
     * non-large roles are provenance the drawing never uses, so their
     * anchors are not this mark's dependencies. A vanished scalar
     * annotation must not take a valid five-member rail with it. And
     * persistence is governed by anchors that RESOLVED at the authoring
     * stage: a member that never resolved already failed closed there
     * (with its `large-array-anchor-unresolved` diagnostic and no
     * geometry), so its continued absence is not a newly vanished
     * dependency — the unchanged partial rail persists exactly as it
     * rendered. Tier-2 output identities declare their complete authored
     * witness set separately above and therefore retain the stronger facet
     * persistence contract.
     */
    item.set.roles
      .filter((roleGroup) => roleGroup.large)
      .forEach((roleGroup) => roleGroup.anchors.forEach((anchor) => {
        if (!anchor.resolved) return;
        const nodeId = String(anchor.nodeId || '');
        if (nodeId) ids.add(nodeId);
      }));
    return Array.from(ids);
  }
  Object.entries(item).forEach(([key, value]) => walk(value, key));
  return Array.from(ids);
};


/**
 * Replay-step reveal by EXACT played identity. Playback may place relation
 * moments around structural construction in an order that differs from the
 * authored relation-array order, so a count of played moments is not an
 * identity; callers pass the set of authored relation indices whose moments
 * have actually played in this frame (null = the committed, non-animated
 * view). Neutral marks require the exact current relation moment, including
 * any coalesced owner. All items remain in the plan for stable layout reservation.
 */
export const isPlanItemRevealed = (
  item: RelationPlanItem,
  frameIndex: number,
  playedRelationIndices: ReadonlySet<number> | null,
  activeRelationIndex: number | null = null
): boolean => {
  if (item.kind === 'node-plaque' && item.realization) {
    const reached = ({ stageIndex, relationIndex }: PlanStageMoment) => stageIndex < frameIndex
      || stageIndex === frameIndex && (playedRelationIndices === null
        || relationIndex !== null && playedRelationIndices.has(relationIndex));
    const { activatedAt, retiredAt } = item.realization;
    return reached(activatedAt) && !(retiredAt && reached(retiredAt));
  }
  if (playedRelationIndices === null) return !item.supersededAt;
  if (item.supersededAt?.stageIndex === frameIndex
    && playedRelationIndices.has(item.supersededAt.relationIndex)) return false;
  if (item.persistence === 'relation-only') return activeRelationIndex !== null
    && playedRelationIndices.has(activeRelationIndex)
    && planItemOwnsRelationMoment(item, frameIndex, activeRelationIndex);
  return item.appearsAtStage < frameIndex || planItemRelationRefs(item).some(ref =>
    ref.stageIndex === frameIndex && playedRelationIndices.has(ref.relationIndex));
};


/** Whether this visible item represents the authored relation moment in focus. */
export const planItemOwnsRelationMoment = (
  item: RelationPlanItem,
  stageIndex: number,
  relationIndex: number
): boolean => planItemRelationRefs(item).some((ref) =>
  ref.stageIndex === stageIndex && ref.relationIndex === relationIndex);
