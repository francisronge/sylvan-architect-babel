/**
 * Production render-plan compiler for authored visual relations.
 *
 * React-free and geometry-free: `DerivationStage[]` in, a typed
 * `RelationRenderPlan` out. Every relation instance dispatches through
 * the exact-identity production registry; registered entries compile to their
 * accepted finite render families, unregistered names take the accepted
 * topology-only fallback. Anchors resolve against the relation's own stage
 * forest; `priorAnchors` resolve only against the immediately preceding
 * authored stage. Anything that does not resolve fails closed with a
 * diagnostic — no substitute endpoint is ever chosen.
 *
 * Appearance and persistence: an item first appears at its authored stage and
 * never leaks backward. Registered families carry exact per-design
 * persistence metadata. A neutral fallback is stage-scoped; its authored record
 * remains available after its marks leave the canvas. Large-anchor organization
 * inherits its parent instance's persistence.
 *
 * Composition: every instance compiles (no first-instance sampling), ordering
 * is deterministic (layer order, then stage, then authored relation index).
 * There is no semantic conflict suppression: marks identical in every
 * semantic respect coalesce with all contributing instances retained in
 * `coalescedRefs`; distinct authored claims all survive and the geometry
 * binder routes them apart. Babel never judges two authored claims
 * incompatible merely because they share a visual channel.
 */
import type {
  DerivationStage,
  DerivationStageRelation,
  SyntaxNode
} from '../../types.ts';
import {
  findRelationRegistryEntry,
  productionRelationRegistry
} from '../relationDispatch/index.js';
import { fallbackDrawing, type FallbackDrawing } from './fallbackTopology.ts';
import {
  LARGE_ANCHOR_ARRAY_THRESHOLD,
  compileLargeAnchorSets,
  type LargeAnchorSet
} from './largeAnchorSets.ts';
import {
  FULL_ARRAY_OWNED_ROLES,
  PRODUCTION_RENDER_FAMILIES,
  TRAJECTORY_SOURCE_ROLES,
  TRAJECTORY_TARGET_ROLES,
  TRAJECTORY_WITNESS_ROLES,
  WITNESS_REQUIRED_TRAJECTORY_KINDS,
  type ProductionRenderFamily,
  type RenderPersistence
} from './renderFamilies.ts';
import {
  acceptedOutcomeConcept,
  authoredOutcomeLiterals,
  resolveOutcomeLiteral,
  type OutcomeConcept
} from './outcomeResolver.ts';
import { buildTier2FacetEvidence, dispatchRelationClaims, type RelationEvidenceCoverage } from './tier2RelationDispatch.ts';
import { compileTier2RelationOutputs } from './tier2RenderPlanCompiler.ts';
import { isWordlessCategoryLeaf } from '../replayCompiler.ts';
import { literalThetaRoles, prepareNativeFissionContent, tier2NativePlaqueRows, type Tier2VisualPrimitiveName } from './tier2FacetRecipes.ts';
import { nativeAncestorEdges, isNativeProjectionPath, prepareNativeDependentCaseStep, prepareNativeLinearizationContent, prepareNativePlaqueContent, type NativePlaqueContent } from './nativeDrawingContent.ts';

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

type PlanItemBase = {
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

/**
 * Endpoint attachment, explicit in the semantic plan: `terminal` endpoints
 * resolve to the visible materialized terminal inside the exact anchored
 * preterminal or witness subtree; `shell` endpoints resolve to the anchored
 * node itself. Head-sized trajectories run terminal-to-terminal;
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
  /**
   * Derived silent leaves that define the accepted remnant bracket's
   * departure footprint. Prior nested evacuation sources are excluded so a
   * different chain cannot pull the remnant path toward itself.
   */
  orthogonalDepartureNodeIds?: string[];
  sourceAttachment: TrajectoryEndpointAttachment;
  targetAttachment: TrajectoryEndpointAttachment;
};

/** A pending PF realization can leave the exact displayed head wordless. */
export const resolveDisplayedTrajectoryAttachments = (
  item: RelationPlanItem,
  nodeFor: (nodeId: string) => SyntaxNode | undefined
): RelationPlanItem => {
  if (item.kind !== 'trajectory') return item;
  const source = nodeFor(item.sourceNodeId);
  const target = nodeFor(item.targetNodeId);
  const sourceAttachment = item.sourceAttachment === 'terminal' && source && isWordlessCategoryLeaf(source)
    ? 'shell-bottom' : item.sourceAttachment;
  const targetAttachment = item.targetAttachment === 'terminal' && target && isWordlessCategoryLeaf(target)
    ? 'shell-bottom' : item.targetAttachment;
  return sourceAttachment === item.sourceAttachment && targetAttachment === item.targetAttachment
    ? item : { ...item, sourceAttachment, targetAttachment };
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
  /** Authored judgment only; absent when the model authored none. */
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
  rows: Array<{ label: string; value: string }>;
  thetaRoles?: Array<{ nodeId: string; label: string }>;
  nativeContent?: NativePlaqueContent;
  realizationRowKinds?: Array<'rewrite' | 'literal'>;
  /** Exact authored moment that introduces each row; null means the owner relation. */
  rowRefs?: Array<PlanRelationRef | null>;
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

/** Deterministic layer order: lower draws first (further back). */
const LAYER_ORDER: Record<RelationPlanItem['kind'], number> = {
  'domain-mark': 0,
  'binding-domain': 1,
  'ellipsis-site': 2,
  enclosure: 3,
  'strike-ghost': 4,
  'branch-emphasis': 5,
  'shared-node': 6,
  'path-status': 7,
  trajectory: 8,
  'fong-component': 9,
  'blocked-access-lane': 10,
  'directed-path': 11,
  'undirected-link': 12,
  'gapping-alignment': 12,
  'quantifier-raising': 12,
  'operator-variable-binding': 12,
  'parasitic-gap-copy': 12,
  'split-antecedence': 12,
  coindex: 13,
  'node-badges': 14,
  'analysis-verdict': 14,
  'node-plaque': 15,
  fallback: 16,
  'anchor-set': 17
};

const flattenAnchorIds = (value: string | string[] | undefined): string[] =>
  (Array.isArray(value) ? value : [value])
    .map((item) => String(item || ''))
    .filter((id) => Boolean(id.trim()));

const collectForest = (forest: SyntaxNode[] | undefined): Map<string, SyntaxNode> => {
  const nodes = new Map<string, SyntaxNode>();
  const walk = (node: SyntaxNode) => {
    const id = String(node.id || '');
    if (id) nodes.set(id, node);
    (Array.isArray(node.children) ? node.children : []).forEach(walk);
  };
  (Array.isArray(forest) ? forest : []).forEach(walk);
  return nodes;
};

/**
 * Only material the model itself authored as silent may take silence/ghost
 * styling. An ellipsis relation styles the already-authored silent
 * occurrence; it never makes an overt subtree silent.
 */
const collectAuthoredSilentSubtreeIds = (node?: SyntaxNode): string[] => {
  if (!node) return [];
  const ids: string[] = [];
  const walk = (current: SyntaxNode) => {
    const id = String(current.id || '');
    if (id && current.silent === true) ids.push(id);
    (Array.isArray(current.children) ? current.children : []).forEach(walk);
  };
  walk(node);
  return ids;
};

const collectSubtreeIds = (node?: SyntaxNode): string[] => {
  if (!node) return [];
  const ids: string[] = [];
  const walk = (current: SyntaxNode) => {
    const id = String(current.id || '');
    if (id) ids.push(id);
    (Array.isArray(current.children) ? current.children : []).forEach(walk);
  };
  walk(node);
  return ids;
};

const collectLexicalTerminalIds = (node?: SyntaxNode): string[] => {
  if (!node) return [];
  const ids: string[] = [];
  const walk = (current: SyntaxNode) => {
    const id = String(current.id || '');
    const children = current.children || [];
    const surface = String(current.word || (children.length === 0 ? current.label : '') || '').trim();
    if (id && children.length === 0 && surface) ids.push(id);
    children.forEach(walk);
  };
  walk(node);
  return ids;
};

const collectSubtreeLeafIds = (node?: SyntaxNode): string[] => {
  if (!node) return [];
  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length === 0) {
    const id = String(node.id || '');
    return id ? [id] : [];
  }
  return children.flatMap(collectSubtreeLeafIds);
};

const collectRemnantDepartureLeafIds = (
  root: SyntaxNode | undefined,
  excludedRoots: SyntaxNode[]
): string[] => {
  if (!root) return [];
  const excludedIds = new Set(excludedRoots.flatMap(collectSubtreeIds));
  const departureIds: string[] = [];
  const walk = (node: SyntaxNode) => {
    const children = Array.isArray(node.children) ? node.children : [];
    const id = String(node.id || '');
    if (
      children.length === 0
      && id
      && !excludedIds.has(id)
      && node.silent === true
      && String(node.label || '').trim() !== '∅'
    ) {
      departureIds.push(id);
    }
    children.forEach(walk);
  };
  walk(root);
  return departureIds;
};

const structuralLeafCount = (node?: SyntaxNode): number => {
  if (!node) return 0;
  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length === 0) return 1;
  return children.reduce((count, child) => count + structuralLeafCount(child), 0);
};

const firstRole = (
  anchors: Record<string, string | string[]>,
  roles: readonly string[]
): { role: string; nodeId: string } | null => {
  for (const role of roles) {
    const ids = flattenAnchorIds(anchors?.[role]);
    if (ids.length > 0) return { role, nodeId: ids[0] };
  }
  return null;
};

const scalarValue = (
  values: Record<string, string | string[]> | undefined,
  key: string,
  fallback = ''
): string => {
  if (key === 'outcome') {
    const items = authoredOutcomeLiterals(values);
    return items.length === 1 ? items[0] : fallback;
  }
  const value = values?.[key];
  return String(Array.isArray(value) ? value.length === 1 ? value[0] : fallback : value ?? fallback);
};

const SUBSCRIPT_GLYPHS: Readonly<Record<string, string>> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', p: 'ₚ'
};

const asSubscript = (value: string): string => Array.from(value)
  .map((character) => SUBSCRIPT_GLYPHS[character] || character)
  .join('');

const listValue = (
  values: Record<string, string | string[]> | undefined,
  key: string
): string[] => {
  const value = values?.[key];
  return (Array.isArray(value) ? value : [value])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
};

/** Verbatim `values` rows in authored order. Literals are never parsed. */
const verbatimRows = (
  values: Record<string, string | string[]> | undefined
): Array<{ label: string; value: string }> =>
  Object.entries(values || {}).flatMap(([label, value]) =>
    (Array.isArray(value) ? value : [value]).map((entryValue) => ({
      label,
      value: String(entryValue ?? '')
    })));




/** One vocabulary rule is one visual row, preserving both authored literals. */
const realizationRows = (
  values: Record<string, string | string[]> | undefined
): Array<{ label: string; value: string }> => {
  const rows = verbatimRows(values);
  const inputs = rows.filter((row) => row.label === 'input').map((row) => row.value);
  const outputs = rows.filter((row) => row.label === 'output').map((row) => row.value);
  return inputs.length === 1 && outputs.length === 1
    ? [{ label: inputs[0], value: outputs[0] }] : [];
};

const nativeRealizationContent = (values: PlanRelationRef['values']) => {
  const rewriteRows = realizationRows(values);
  const literals = verbatimRows(values).filter((row) => !rewriteRows.length || !['input', 'output'].includes(row.label));
  return {
    rows: [...rewriteRows, ...literals],
    realizationRowKinds: [...rewriteRows.map(() => 'rewrite' as const), ...literals.map(() => 'literal' as const)]
  };
};

/**
 * Lowering head/phrase split by anchored topology and authored roles, never a
 * category-name pattern.
 */
const loweringIsPhraseSized = (
  relation: DerivationStageRelation,
  nodes: Map<string, SyntaxNode>,
  sourceNodeId: string,
  targetNodeId: string
): boolean => {
  const dominatesInternalStructure = (nodeId: string): boolean => {
    const anchorNode = nodes.get(nodeId);
    return Boolean(anchorNode) && (anchorNode?.children || [])
      .some((child) => Array.isArray(child.children) && child.children.length > 0);
  };
  const authorsPhrasalRoles = TRAJECTORY_WITNESS_ROLES.some((role) => relation.anchors?.[role] !== undefined);
  return authorsPhrasalRoles
    || dominatesInternalStructure(sourceNodeId)
    || dominatesInternalStructure(targetNodeId);
};

/**
 * Resolve an authored outcome through the shared literal catalog, then apply
 * the registered family's explicit concept-to-visual-state mapping. The
 * concept remains distinct in the resolver; only this family-specific policy
 * decides that, for example, both `blocked` and `failed` earn a blocked path.
 */
const recognizedOutcome = <T extends string>(
  raw: string,
  family: ProductionRenderFamily,
  stateByConcept: Readonly<Partial<Record<OutcomeConcept, T>>>
): T | undefined => {
  const concept = acceptedOutcomeConcept(
    resolveOutcomeLiteral(raw),
    family.acceptedOutcomeConcepts
  );
  return concept ? stateByConcept[concept] : undefined;
};

const LICENSED_OR_BLOCKED_OUTCOME_STATES = {
  licensed: 'licensed',
  successful: 'licensed',
  allowed: 'licensed',
  accepted: 'licensed',
  valid: 'licensed',
  blocked: 'blocked',
  failed: 'blocked',
  illicit: 'blocked',
  rejected: 'blocked',
  unlicensed: 'blocked',
  impossible: 'blocked',
  violation: 'blocked'
} as const satisfies Readonly<Partial<Record<OutcomeConcept, 'licensed' | 'blocked'>>>;

const LICENSED_OR_FAILED_OUTCOME_STATES = {
  licensed: 'licensed',
  successful: 'licensed',
  allowed: 'licensed',
  accepted: 'licensed',
  valid: 'licensed',
  blocked: 'failed',
  failed: 'failed',
  illicit: 'failed',
  rejected: 'failed',
  unlicensed: 'failed',
  impossible: 'failed',
  violation: 'failed'
} as const satisfies Readonly<Partial<Record<OutcomeConcept, 'licensed' | 'failed'>>>;

const BLOCKED_OUTCOME_STATES = {
  blocked: 'blocked',
  failed: 'blocked',
  illicit: 'blocked',
  rejected: 'blocked',
  unlicensed: 'blocked',
  impossible: 'blocked',
  violation: 'blocked'
} as const satisfies Readonly<Partial<Record<OutcomeConcept, 'blocked'>>>;

const ILLICIT_OUTCOME_STATES = {
  illicit: 'illicit'
} as const satisfies Readonly<Partial<Record<OutcomeConcept, 'illicit'>>>;

export type CompilePlanOptions = {
  registry?: typeof productionRelationRegistry;
  families?: Record<string, ProductionRenderFamily>;
  activeLens?: boolean;
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
      || key === 'composedRefs'
      || key === 'coalescedRefs'
      || key === 'supersededAt'
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

export const compileRelationRenderPlan = (
  stages: DerivationStage[],
  options: CompilePlanOptions = {}
): RelationRenderPlan => {
  const registry = options.registry ?? productionRelationRegistry;
  const families = options.families ?? PRODUCTION_RENDER_FAMILIES;
  const stageList = Array.isArray(stages) ? stages : [];
  const stageDispatches = stageList.map((stage, stageIndex) => (stage.relations || []).map((relation, relationIndex) =>
    dispatchRelationClaims({
      registry, relation, stageIndex, relationIndex,
      currentForest: stage.workspaceForest || [],
      ...(stageIndex > 0 ? { priorForest: stageList[stageIndex - 1].workspaceForest || [] } : {}),
      ...(options.activeLens === undefined ? {} : { activeLens: options.activeLens })
    })));
  const companionAnchors = (stageIndex: number, relationIndex: number) => {
    const dispatch = stageDispatches[stageIndex][relationIndex];
    return dispatch.primaryClaim?.tier === 1 ? dispatch.boundPrimaryRelation.anchors : {};
  };
  // The combined curve has only one feature/value row. Other authored content
  // stays in Agree's full plaque instead of disappearing during composition.
  const canComposeCaseAgreement = (relation: DerivationStageRelation) =>
    Object.entries(relation.values || {}).every(([key, value]) =>
      ['feature', 'value'].includes(key) && (!Array.isArray(value) || value.length === 1));
  const diagnostics: PlanDiagnostic[] = [];
  const unregisteredCounts = new Map<string, number>();
  const items: RelationPlanItem[] = [];

  /*
   * Generated dependency indices. An authored index always wins upstream;
   * when the model connected two occurrences but supplied no index, Babel
   * labels that connection with a letter, i, j, k, allocated once per
   * dependency in order of first appearance and never from a list position.
   */
  const dependencyIndexByKey = new Map<string, string>();
  const dependencyIndexFor = (key: string): string => {
    if (!dependencyIndexByKey.has(key)) {
      const ordinal = dependencyIndexByKey.size;
      const conventionalIndices = 'ijklmnopqrstuvwxyz';
      dependencyIndexByKey.set(
        key,
        ordinal < conventionalIndices.length ? conventionalIndices[ordinal] : `i${ordinal + 1}`
      );
    }
    return dependencyIndexByKey.get(key)!;
  };
  const chainIndexFor = dependencyIndexFor;
  const qrIndexFor = dependencyIndexFor;
  let phaseArcOrdinal = 0;
  /**
   * Chain identity, tightened to what authored data proves:
   * - Primary: the shared authored `lineageId` of the anchored occurrences.
   *   A lineage-keyed chain keeps its identity as its occurrence list grows
   *   or is reordered, because the lineage — not the list — is the key.
   * - Fallback (no shared lineage): the family tag plus the sorted anchored
   *   participant set. This is stable under harmless anchor-array
   *   reordering, but a no-lineage chain that GROWS is a new participant
   *   set — the compiler cannot prove it is the same chain and does not
   *   pretend to. Unrelated no-lineage chains are never merged.
   * Display numerals are allocated in first-encounter order within one
   * compilation; identity keys are stable, but reordering relations or
   * stages can renumber which chain gets which numeral.
   */
  const stableChainKey = (
    tag: string,
    nodes: Map<string, SyntaxNode>,
    ids: string[]
  ): string => {
    const lineageSets = ids.map((id) => {
      const lineages = new Set<string>();
      const anchorNode = nodes.get(id);
      if (anchorNode) {
        const walk = (current: SyntaxNode) => {
          const lineageId = String(current.lineageId || '');
          if (lineageId) lineages.add(lineageId);
          (Array.isArray(current.children) ? current.children : []).forEach(walk);
        };
        walk(anchorNode);
      }
      return lineages;
    });
    const shared = lineageSets.length > 0
      ? Array.from(lineageSets[0])
        .filter((lineageId) => lineageSets.every((set) => set.has(lineageId)))
        .sort()
        .join('|')
      : '';
    return shared
      ? `lineage:${shared}`
      : `${tag}:${Array.from(new Set(ids)).sort().join(',')}`;
  };

  stageList.forEach((stage, stageIndex) => {
    const nodes = collectForest(stage?.workspaceForest);
    const priorNodes = stageIndex > 0
      ? collectForest(stageList[stageIndex - 1]?.workspaceForest)
      : null;
    const relations = Array.isArray(stage?.relations) ? stage.relations : [];
    /*
     * PF composition provenance: a VocabularyInsertion row joins a
     * PFRealization plate only when its own resolved target anchor is among
     * that package's explicitly authored targets. Multiple packages in one
     * stage stay separate; an insertion with no resolving target, or no
     * matching package, never contaminates another plate.
     */
    const stageNodeSetForPf = collectForest(stage?.workspaceForest);
    const pfPackages = relations.flatMap((candidate, candidateIndex) => {
      const candidateEntry = findRelationRegistryEntry(registry, candidate.relation);
      if (!candidateEntry || families[candidateEntry.id]?.family !== 'realization-plate') return [];
      const packageAnchors = companionAnchors(stageIndex, candidateIndex);
      if (!['root', 'verbalHead', 'tense', 'feature', 'exponent']
        .some((role) => packageAnchors[role] !== undefined)) return [];
      return [{
        relationIndex: candidateIndex,
        targets: new Set(Object.values(packageAnchors).flatMap(flattenAnchorIds))
      }];
    });
    const pfPackageIndices = new Set(pfPackages.map((pfPackage) => pfPackage.relationIndex));
    const vocabularyAssignments = new Map<number, number>();
    relations.forEach((candidate, candidateIndex) => {
      const candidateEntry = findRelationRegistryEntry(registry, candidate.relation);
      if (!candidateEntry) return;
      const candidateFamily = families[candidateEntry.id]?.family;
      const isVocabularyInsertion = candidateFamily === 'vocabulary-insertion'
        || (candidateFamily === 'realization-plate' && !pfPackageIndices.has(candidateIndex));
      if (!isVocabularyInsertion) return;
      const candidateAnchors = companionAnchors(stageIndex, candidateIndex);
      const viTarget = flattenAnchorIds(candidateAnchors.terminal || candidateAnchors.target)[0];
      if (!viTarget || !stageNodeSetForPf.has(viTarget)) return;
      /*
       * Ownership must be provable, never first-win: an insertion joins a
       * package only when exactly one package's authored anchors contain its
       * target. A target shared by several packages is ambiguous authored
       * data — the insertion keeps its own standalone plate and the
       * ambiguity is diagnosed instead of silently resolved.
       */
      const owningPackages = pfPackages.filter((pfPackage) => pfPackage.targets.has(viTarget));
      if (owningPackages.length === 1) {
        vocabularyAssignments.set(candidateIndex, owningPackages[0].relationIndex);
      } else if (owningPackages.length > 1) {
        diagnostics.push({
          stageIndex,
          relationIndex: candidateIndex,
          relation: candidate.relation,
          kind: 'ambiguous-package-ownership',
          detail: `insertion target ${viTarget} is anchored by ${owningPackages.length} PF packages `
            + `(relation indices ${owningPackages.map((pfPackage) => pfPackage.relationIndex).join(', ')}); `
            + 'the row stays standalone instead of joining the first package'
        });
      }
    });

    const pendingNeutralFallbacks: Array<() => void> = [];
    relations.forEach((relation, relationIndex) => {
      const relationRef: PlanRelationRef = {
        stageIndex,
        relationIndex,
        relation: relation.relation,
        anchors: relation.anchors,
        ...(relation.priorAnchors ? { priorAnchors: relation.priorAnchors } : {}),
        ...(relation.values ? { values: relation.values } : {})
      };
      const pushDiagnostic = (kind: PlanDiagnostic['kind'], detail: string) => {
        diagnostics.push({ stageIndex, relationIndex, relation: relation.relation, kind, detail });
      };

      /*
       * priorAnchors resolve only against the immediately preceding stage,
       * and the authored block proves something only as a WHOLE: a block
       * with any unresolved witness is retained verbatim in the relationRef
       * and diagnosed, but it draws no backward continuity cue and proves
       * no replacement continuity — a subset of a prior block never
       * silently stands in for the whole authored claim.
       */
      if (relation.priorAnchors) {
        if (!priorNodes) {
          pushDiagnostic(
            'prior-anchor-without-prior-stage',
            'priorAnchors authored at stage 0 have no preceding stage to resolve against'
          );
        } else {
          Object.entries(relation.priorAnchors).forEach(([role, value]) => {
            flattenAnchorIds(value).forEach((nodeId) => {
              if (!priorNodes.has(nodeId)) {
                pushDiagnostic(
                  'prior-anchor-unresolved',
                  `${role} -> ${nodeId} does not resolve in the preceding stage; the incomplete `
                    + 'block draws no backward cue and proves no continuity'
                );
              }
            });
          });
        }
      }

      const claimDispatch = stageDispatches[stageIndex][relationIndex];
      const unrecovered = claimDispatch.evidenceCoverage.fields.filter(field =>
        field.unrecoveredItemIndices.length || field.unrecoveredEmptyField);
      if (claimDispatch.claims.some(claim => claim.tier === 3)) {
        diagnostics.push({ stageIndex, relationIndex, relation: relation.relation,
          kind: 'claim-evidence',
          detail: unrecovered.map(field => `${field.field}.${field.key}: ${field.concepts.length
            ? 'candidate meanings exist, but no selected drawing accounts for this evidence'
            : 'no supported field meaning'}${field.unrecoveredEmptyField ? '; authored empty field' : `; original item indices ${field.unrecoveredItemIndices.join(',')}`}`).join('; ')
            || 'No complete supported claim. The original relation is retained.',
          evidenceCoverage: claimDispatch.evidenceCoverage,
          candidateFailures: claimDispatch.facetDiagnostics });
      }
      const primaryRelation = claimDispatch.primaryRelation;
      const primaryRelationRef: PlanRelationRef = {
        stageIndex,
        relationIndex,
        relation: primaryRelation.relation,
        anchors: primaryRelation.anchors,
        ...(primaryRelation.priorAnchors
          ? { priorAnchors: primaryRelation.priorAnchors }
          : {}),
        ...(primaryRelation.values ? { values: primaryRelation.values } : {})
      };
      const primaryPriorAnchorIds = Object.values(
        primaryRelation.priorAnchors ?? {}
      ).flatMap(flattenAnchorIds);
      const primaryPriorAnchorBlockComplete = primaryPriorAnchorIds.length > 0
        && Boolean(priorNodes)
        && primaryPriorAnchorIds.every((nodeId) => priorNodes!.has(nodeId));
      const primaryPriorWitnessNodeIds = primaryPriorAnchorBlockComplete
        ? primaryPriorAnchorIds
        : [];
      const primaryBackward = primaryPriorWitnessNodeIds.length > 0;

      if (claimDispatch.facets.length > 0) {
        const tier2 = compileTier2RelationOutputs({
          dependencyIndexFor,
          relationRef,
          dispatch: claimDispatch,
          currentForest: stage?.workspaceForest || [],
          ...(stageIndex > 0
            ? { priorForest: stageList[stageIndex - 1]?.workspaceForest || [] }
            : {})
        });
        items.push(...tier2.items);
        diagnostics.push(...tier2.diagnostics);
      } else {
        claimDispatch.diagnostics.forEach((diagnostic) => {
          diagnostics.push({
            stageIndex,
            relationIndex,
            relation: relation.relation,
            kind: diagnostic.kind === 'unrecovered-evidence' ? 'unrecovered-evidence' : 'tier2-collision',
            detail: `${diagnostic.kind}:${diagnostic.collision}:${diagnostic.facets.join(',')}`
          });
        });
      }

      if (claimDispatch.tier1Dispatch.outcome === 'unregistered') {
        unregisteredCounts.set(
          relation.relation,
          (unregisteredCounts.get(relation.relation) ?? 0) + 1
        );
        if (claimDispatch.facets.length > 0 && !claimDispatch.primaryClaim) return;
      }

      const dispatch = claimDispatch.tier1Dispatch as {
        outcome: 'unregistered' | 'signature-incomplete' | 'resolved';
        registryEntryId?: string;
        signatureIssues: Array<Record<string, unknown>>;
      };

      /**
       * Neutral, name-free presentation of resolved witnesses through the
       * accepted fallback topology. Used for unregistered names and for
       * preserving evidence a specialized branch cannot or may not consume.
       */
      const pushNeutralFallback = (
        anchorSource: Record<string, string | string[]>,
        includePriorCue: boolean,
        fallbackRelation: PlanRelationRef = primaryRelationRef,
        claimIdentity = claimDispatch.primaryClaim?.canonicalClaimIdentity
      ) => {
        const resolvedAnchors: Record<string, string | string[]> = {};
        const fallbackClaim = claimDispatch.claims.find(claim => claim.canonicalClaimIdentity === claimIdentity);
        const anchorContext = fallbackClaim?.tier === 3 ? fallbackClaim.contextAnchors : undefined;
        Object.entries(anchorContext || anchorSource || {}).forEach(([role, value]) => {
          const ids = flattenAnchorIds(value);
          const resolved = ids.filter((nodeId) => {
            if (nodes.has(nodeId)) return true;
            pushDiagnostic(
              'anchor-unresolved',
              `${role} -> ${nodeId} does not resolve in its stage; its fallback mark fails closed`
            );
            return false;
          });
          if (resolved.length === 0) return;
          resolvedAnchors[role] = Array.isArray(value) ? resolved : resolved[0];
        });
        // The badge number is the relation's authored position in its stage,
        // so it matches the panel's relation list. Names play no part.
        const instanceNumber = relationIndex + 1;
        const drawing = fallbackDrawing(
          {
            relation: relation.relation,
            anchors: resolvedAnchors,
            ...(includePriorCue && primaryPriorWitnessNodeIds.length > 0
              ? { priorAnchors: { resolved: primaryPriorWitnessNodeIds } }
              : {})
          },
          instanceNumber
        );
        items.push({
          kind: 'fallback',
          relationRef: fallbackRelation,
          appearsAtStage: stageIndex,
          // A neutral fallback marks a claim's moment. It shows through its
          // own stage and leaves the canvas afterwards; the claim itself
          // stays in the record and returns when that stage is replayed.
          persistence: 'stage-only',
          backward: includePriorCue && primaryBackward,
          priorWitnessNodeIds: includePriorCue ? primaryPriorWitnessNodeIds : [],
          drawing,
          claimTier: 3,
          ...(claimIdentity
            ? { canonicalClaimIdentity: claimIdentity }
            : {})
        });
      };

      if (claimDispatch.residualRelation) {
        const residualClaim = claimDispatch.claims.find(claim => claim.kind === 'fallback-residual');
        pushNeutralFallback(claimDispatch.residualRelation.anchors, false,
          { ...claimDispatch.residualRelation, stageIndex, relationIndex }, residualClaim?.canonicalClaimIdentity);
      }

      if (dispatch.outcome === 'unregistered') {
        pushNeutralFallback(claimDispatch.primaryRelation.anchors || {}, true);
        return;
      }

      if (dispatch.outcome === 'signature-incomplete') {
        pushDiagnostic(
          'signature-incomplete',
          dispatch.signatureIssues
            .map((issue) => {
              const roleDetail = issue.role
                ?? (Array.isArray(issue.roles) ? issue.roles.join('|') : '')
                ?? '';
              const countDetail = issue.minPresentItems === undefined
                ? ''
                : `>=${issue.minPresentItems}`;
              return `${issue.kind}:${issue.field ?? ''}:${roleDetail || countDetail}${issue.reason ? `:${issue.reason}` : ''}`;
            })
            .join(', ') || 'signature incomplete'
        );
        /*
         * Claim extraction has already removed independently complete Tier-2
         * evidence. Whatever remains is the named primary claim itself. A
         * malformed registered primary therefore stays Tier 3; the compiler
         * never repairs it by silently ignoring roles.
         */
        pushNeutralFallback(claimDispatch.primaryRelation.anchors || {}, true);
        return;
      }

      const familyId = String(dispatch.registryEntryId);
      const family = families[familyId];
      if (!family) {
        pushDiagnostic(
          'signature-incomplete',
          `registry entry ${familyId} has no production render family`
        );
        pushNeutralFallback(primaryRelation.anchors || {}, true);
        return;
      }
      /*
       * Replacement grouping. Replacement is licensed only when two states
       * provably belong to the same authored relation thread:
       * - a replace-previous-instance family threads by its complete
       *   authored participant set — a later instance over the same nodes is
       *   a restatement of the same claim and replaces it;
       * - a later instance whose authored `priorAnchors` name exactly an
       *   earlier instance's participants has authored its own continuity
       *   with that state, and replaces it even though its current
       *   participant set differs (a grown linearization domain).
       * An instance over a different participant set with no authored
       * continuity is an independent claim and both persist. Nothing global
       * to the family ever replaces across unrelated participants.
       */
      const participantSetKey = (source: Record<string, string | string[]> | undefined): string =>
        Array.from(new Set(
          Object.values(source || {}).flatMap(flattenAnchorIds)
        )).sort().join(',');
      const replacementThread = `${familyId}:participants:${participantSetKey(primaryRelation.anchors)}`;
      /*
       * Replacement continuity across changed participants requires PROOF:
       * only a complete prior-anchor block whose every authored witness
       * resolved in the immediately preceding stage may name a predecessor
       * thread. An incomplete block is authored data that failed to verify —
       * it is diagnosed and retained verbatim, but it never erases an
       * earlier claim.
       */
      const replacementPredecessor = family.persistence === 'replace-previous-instance'
        && primaryPriorAnchorBlockComplete
        ? `${familyId}:participants:${participantSetKey(primaryRelation.priorAnchors)}`
        : '';
      const base: PlanItemBase = {
        relationRef: primaryRelationRef,
        familyId,
        appearsAtStage: stageIndex,
        persistence: family.persistence,
        ...(family.persistence === 'replace-previous-instance'
          ? {
              replacementGroup: replacementThread,
              ...(replacementPredecessor
                ? { replacementPredecessorGroup: replacementPredecessor }
                : {})
            }
          : {}),
        backward: primaryBackward,
        priorWitnessNodeIds: primaryPriorWitnessNodeIds,
        claimTier: 1
      };

      const requireResolved = (role: string, nodeId: string): boolean => {
        if (nodeId && nodes.has(nodeId)) return true;
        pushDiagnostic(
          'anchor-unresolved',
          `${role} -> ${nodeId || '(missing)'} does not resolve in its stage; the mark fails closed`
        );
        return false;
      };
      const resolvedIds = (role: string, value: string | string[] | undefined): string[] =>
        flattenAnchorIds(value).filter((nodeId) => requireResolved(role, nodeId));
      const anchors = claimDispatch.boundPrimaryRelation.anchors || {};
      const values = claimDispatch.boundPrimaryRelation.values;
      const authoredValues = primaryRelation.values;

      const pushCompositeTrajectory = (trajectoryKind: 'phrasal' | 'head'): boolean => {
        const source = firstRole(anchors, TRAJECTORY_SOURCE_ROLES);
        const target = firstRole(anchors, TRAJECTORY_TARGET_ROLES);
        if (!source && !target) return false;
        if (!source || !target) {
          pushDiagnostic('endpoint-missing', `${relation.relation} movement requires one source and one landing anchor`);
          return true;
        }
        if (!requireResolved(source.role, source.nodeId)) return true;
        if (!requireResolved(target.role, target.nodeId)) return true;
        const witness = firstRole(anchors, TRAJECTORY_WITNESS_ROLES);
        if (trajectoryKind === 'phrasal' && !witness) {
          pushDiagnostic('witness-missing', `${relation.relation} movement requires an authored trace witness`);
          return true;
        }
        if (witness) {
          if (!requireResolved(witness.role, witness.nodeId)) return true;
          if (!collectSubtreeIds(nodes.get(source.nodeId)).includes(witness.nodeId)) {
            pushDiagnostic(
              'witness-outside-source',
              `${witness.role} -> ${witness.nodeId} is not inside ${source.role} -> ${source.nodeId}`
            );
            return true;
          }
        }
        const complexPhrase = trajectoryKind === 'phrasal'
          && structuralLeafCount(nodes.get(source.nodeId)) > 1;
        items.push({
          ...base,
          kind: 'trajectory',
          trajectoryKind,
          sourceNodeId: source.nodeId,
          targetNodeId: target.nodeId,
          ...(witness ? { witnessNodeId: witness.nodeId } : {}),
          sourceAttachment: complexPhrase || isWordlessCategoryLeaf(nodes.get(source.nodeId)!) ? 'shell-bottom' : 'terminal',
          targetAttachment: trajectoryKind === 'head' && !isWordlessCategoryLeaf(nodes.get(target.nodeId)!) ? 'terminal' : 'shell-bottom'
        });
        return true;
      };

      const specializedItemCountBefore = items.length;
      try {
        switch (family.family) {
        case 'operator-variable-binding': {
          const operator = flattenAnchorIds(anchors.operator)[0];
          const variable = flattenAnchorIds(anchors.variable)[0];
          const traceWitness = flattenAnchorIds(anchors.traceWitness)[0];
          const scopeDomain = flattenAnchorIds(anchors.scopeDomain || anchors.domain)[0];
          if (!requireResolved('operator', operator)) return;
          if (!requireResolved('variable', variable)) return;
          if (traceWitness && !requireResolved('traceWitness', traceWitness)) return;
          if (scopeDomain && !requireResolved('scopeDomain', scopeDomain)) return;
          if (traceWitness && !collectSubtreeIds(nodes.get(variable)).includes(traceWitness)) {
            pushDiagnostic(
              'witness-outside-source',
              `traceWitness -> ${traceWitness} is not inside variable -> ${variable}`
            );
            return;
          }
          items.push({
            ...base,
            kind: 'operator-variable-binding',
            operatorNodeId: operator,
            variableNodeId: variable,
            ...(traceWitness ? { traceWitnessNodeId: traceWitness } : {}),
            ...(scopeDomain ? {
              scopeDomainNodeId: scopeDomain,
              scopeMemberNodeIds: collectSubtreeIds(nodes.get(scopeDomain)),
              subtreeDerived: [{ field: 'scopeMemberNodeIds', rootNodeId: scopeDomain, mode: 'all' }]
            } : {}),
            index: chainIndexFor(stableChainKey('operator-variable', nodes, [operator, variable]))
          });
          return;
        }

        case 'trajectory': {
          if (family.trajectoryKind === 'atb') {
            const target = firstRole(anchors, TRAJECTORY_TARGET_ROLES);
            const sources = flattenAnchorIds(anchors.sources);
            const witnesses = flattenAnchorIds(anchors.traceWitnesses);
            if (!target || !requireResolved(target.role, target.nodeId)) return;
            if (sources.length === 0 || sources.length !== witnesses.length) {
              pushDiagnostic('endpoint-missing', 'ATB requires positionally paired sources and traceWitnesses');
              return;
            }
            sources.forEach((sourceNodeId, pairIndex) => {
              const witnessNodeId = witnesses[pairIndex];
              if (!requireResolved('sources', sourceNodeId)) return;
              if (!requireResolved('traceWitnesses', witnessNodeId)) return;
              const sourceSubtree = collectSubtreeIds(nodes.get(sourceNodeId));
              if (!sourceSubtree.includes(witnessNodeId)) {
                pushDiagnostic(
                  'witness-outside-source',
                  `traceWitnesses[${pairIndex}] -> ${witnessNodeId} is not inside sources[${pairIndex}]`
                );
                return;
              }
              items.push({
                ...base,
                kind: 'trajectory',
                trajectoryKind: 'atb',
                sourceNodeId,
                targetNodeId: target.nodeId,
                witnessNodeId,
                sourceAttachment: 'terminal',
                targetAttachment: 'shell'
              });
              items.push({
                ...base,
                kind: 'node-badges',
                badgeStyle: 'gap-notation',
                badges: [{
                  nodeId: sourceNodeId,
                  text: `t${asSubscript(typeof values?.index === 'string' ? values.index : 'i')}`,
                  shape: 'plain'
                }]
              });
            });
            return;
          }

          const source = firstRole(anchors, TRAJECTORY_SOURCE_ROLES);
          const target = firstRole(anchors, TRAJECTORY_TARGET_ROLES);
          if (!source || !target) {
            pushDiagnostic('endpoint-missing', 'trajectory requires one source-role and one target-role anchor');
            return;
          }
          if (!requireResolved(source.role, source.nodeId)) return;
          if (!requireResolved(target.role, target.nodeId)) return;

          let trajectoryKind = family.trajectoryKind as NonNullable<ProductionRenderFamily['trajectoryKind']>;
          if (
            familyId === 'trajectory.remnant'
            && scalarValue(values, 'phase') === 'evacuation'
          ) {
            trajectoryKind = 'phrasal';
          }
          if (
            familyId === 'trajectory.smuggling'
            && !anchors.passenger
            && !anchors.intervener
          ) {
            trajectoryKind = 'phrasal';
          }
          if (
            familyId === 'trajectory.sideward'
            && (stage.workspaceForest || []).length === 1
            && stageList.slice(0, stageIndex).some((priorStage) =>
              (priorStage.relations || []).some((priorRelation) =>
                priorRelation.relation === relation.relation
              )
            )
          ) {
            trajectoryKind = 'phrasal';
          }
          if (trajectoryKind === 'lowering'
            && loweringIsPhraseSized(claimDispatch.boundPrimaryRelation, nodes, source.nodeId, target.nodeId)) {
            trajectoryKind = 'phrasal';
          }

          const witness = firstRole(anchors, TRAJECTORY_WITNESS_ROLES);
          const witnessRequired = WITNESS_REQUIRED_TRAJECTORY_KINDS.has(trajectoryKind);
          if (witness) {
            if (!requireResolved(witness.role, witness.nodeId)) return;
            const sourceSubtree = collectSubtreeIds(nodes.get(source.nodeId));
            if (!sourceSubtree.includes(witness.nodeId)) {
              pushDiagnostic(
                'witness-outside-source',
                `${witness.role} -> ${witness.nodeId} is not the source occurrence or inside it`
              );
              return;
            }
          } else if (witnessRequired) {
            pushDiagnostic(
              'witness-missing',
              `${trajectoryKind} trajectories require an authored trace witness; none was authored`
            );
            return;
          }

          const headSized = trajectoryKind === 'head'
            || trajectoryKind === 'lowering';
          const sideward = trajectoryKind === 'sideward';
          const complexPhrase = !headSized && structuralLeafCount(nodes.get(source.nodeId)) > 1;
          items.push({
            ...base,
            kind: 'trajectory',
            trajectoryKind,
            sourceNodeId: source.nodeId,
            targetNodeId: target.nodeId,
            ...(witness ? { witnessNodeId: witness.nodeId } : {}),
            sourceAttachment: sideward
              ? 'shell-top'
              : complexPhrase || isWordlessCategoryLeaf(nodes.get(source.nodeId)!) ? 'shell-bottom' : 'terminal',
            targetAttachment: sideward
              ? 'shell-top'
              : headSized && !isWordlessCategoryLeaf(nodes.get(target.nodeId)!) ? 'terminal' : 'shell-bottom'
          });

          if (sideward) {
            items.push({
              ...base,
              kind: 'node-badges',
              badgeStyle: 'gap-notation',
              badges: [{
                nodeId: source.nodeId,
                text: `t${asSubscript(typeof values?.index === 'string' ? values.index : '1')}`,
                shape: 'plain'
              }]
            });
          }

          /*
           * Accepted auxiliary marks travel with their trajectory: the
           * remnant's landing is boxed, the smuggling carrier's lower chunk
           * is shaded.
           */
          if (trajectoryKind === 'remnant') {
            items.push({
              ...base,
              kind: 'enclosure',
              nodeId: target.nodeId,
              licence: 'remnant-landing'
            });
          }
          if (trajectoryKind === 'smuggling') {
            items.push({
              ...base,
              kind: 'enclosure',
              nodeId: source.nodeId,
              licence: 'carrier-chunk'
            });
          }
          return;
        }

        case 'occurrence-identity': {
          if (anchors.traceWitness && pushCompositeTrajectory('phrasal')) return;
          if (anchors.source && anchors.target && pushCompositeTrajectory('head')) return;
          const occurrenceIds = Object.values(anchors)
            .flatMap(flattenAnchorIds)
            .filter((nodeId, index, all) => all.indexOf(nodeId) === index)
            .filter((nodeId) => requireResolved('occurrences', nodeId));
          if (occurrenceIds.length < 2) return;
          items.push({
            ...base,
            kind: 'coindex',
            nodeIds: occurrenceIds,
            index: chainIndexFor(stableChainKey('identity', nodes, occurrenceIds))
          });
          return;
        }

        case 'coindex': {
          const nodeIds = Object.values(anchors)
            .flatMap(flattenAnchorIds)
            .filter((nodeId, index, all) => all.indexOf(nodeId) === index)
            .filter((nodeId) => requireResolved('anchors', nodeId));
          if (nodeIds.length < 2) return;
          items.push({
            ...base,
            kind: 'coindex',
            nodeIds,
            index: chainIndexFor(stableChainKey('coindex', nodes, nodeIds))
          });
          return;
        }

        case 'control': {
          const controller = flattenAnchorIds(anchors.controller)[0];
          const controllee = flattenAnchorIds(anchors.controllee)[0];
          const domain = flattenAnchorIds(anchors.domain)[0];
          if (!requireResolved('controller', controller)) return;
          if (!requireResolved('controllee', controllee)) return;
          if (!requireResolved('domain', domain)) return;
          const index = chainIndexFor(stableChainKey('control', nodes, [controller, controllee]));
          items.push({
            ...base,
            kind: 'domain-mark',
            rootNodeId: domain,
            memberNodeIds: collectSubtreeIds(nodes.get(domain)),
            subtreeDerived: [{ field: 'memberNodeIds', rootNodeId: domain, mode: 'all' }],
            domainStyle: 'control-domain'
          });
          items.push({
            ...base,
            kind: 'directed-path',
            fromNodeId: controller,
            toNodeId: controllee,
            pathStyle: 'control'
          });
          items.push({ ...base, kind: 'coindex', nodeIds: [controller, controllee], index });
          return;
        }

        case 'predication': {
          const predicand = flattenAnchorIds(anchors.predicand)[0];
          if (!requireResolved('predicand', predicand)) return;
          const predicates = [
            ...flattenAnchorIds(anchors.predicate),
            ...flattenAnchorIds(anchors.predicates)
          ].filter((nodeId) => requireResolved('predicate', nodeId));
          if (predicates.length === 0) return;
          items.push({
            ...base,
            kind: 'undirected-link',
            pairs: predicates.map((predicate) => ({ fromNodeId: predicand, toNodeId: predicate })),
            linkStyle: 'predication'
          });
          return;
        }

        case 'binding-domain': {
          const binder = flattenAnchorIds(anchors.binder)[0];
          const bound = flattenAnchorIds(anchors.bound)[0];
          const domain = flattenAnchorIds(anchors.domain)[0];
          if (!requireResolved('binder', binder)) return;
          if (!requireResolved('bound', bound)) return;
          if (!requireResolved('domain', domain)) return;
          const bindingOutcomeRaw = scalarValue(values, 'outcome');
          const bindingOutcome = recognizedOutcome(
            bindingOutcomeRaw,
            family,
            LICENSED_OR_FAILED_OUTCOME_STATES
          );
          if (bindingOutcomeRaw && !bindingOutcome) {
            pushDiagnostic('value-unrecognized', `outcome -> "${bindingOutcomeRaw}" is not a recognized Binding judgment`);
          }
          items.push({
            ...base,
            kind: 'binding-domain',
            binderNodeId: binder,
            boundNodeId: bound,
            domainNodeId: domain,
            domainMemberNodeIds: collectSubtreeIds(nodes.get(domain)),
            subtreeDerived: [{ field: 'domainMemberNodeIds', rootNodeId: domain, mode: 'all' }],
            ...(bindingOutcome ? { outcome: bindingOutcome } : {}),
            index: chainIndexFor(stableChainKey('binding', nodes, [binder, bound]))
          });
          return;
        }

        case 'split-antecedence': {
          const antecedents = resolvedIds('antecedents', anchors.antecedents);
          const dependent = flattenAnchorIds(anchors.dependent)[0];
          if (antecedents.length < 2 || !requireResolved('dependent', dependent)) return;
          items.push({
            ...base,
            kind: 'split-antecedence',
            antecedentNodeIds: antecedents,
            dependentNodeId: dependent
          });
          return;
        }

        case 'parasitic-gap': {
          const filler = flattenAnchorIds(anchors.filler || anchors.operator)[0];
          const realGap = flattenAnchorIds(anchors.realGap || anchors.gap)[0];
          const witness = flattenAnchorIds(anchors.traceWitness || anchors.lowerWitness)[0];
          const primaryPath = resolvedIds('primaryPath', anchors.primaryPath);
          const secondaryPath = resolvedIds('secondaryPath', anchors.secondaryPath);
          const parasitic = [
            ...flattenAnchorIds(anchors.parasiticGaps),
            ...flattenAnchorIds(anchors.parasiticGap)
          ].filter((nodeId, index, all) => all.indexOf(nodeId) === index);
          const fillerResolved = Boolean(filler && requireResolved('filler', filler));
          const realGapResolved = Boolean(realGap && requireResolved('realGap', realGap));
          const witnessResolved = Boolean(witness && requireResolved('traceWitness', witness));
          const resolvedParasitic = parasitic
            .filter((nodeId) => requireResolved('parasiticGap', nodeId));
          const parasiticFacetResolved = parasitic.length > 0
            && resolvedParasitic.length === parasitic.length;
          const movementFacetAuthored = Boolean(filler || realGap || witness);

          if (movementFacetAuthored) {
            if (!filler || !realGap) {
              pushDiagnostic(
                'endpoint-missing',
                'the ordinary parasitic-gap movement path requires one real gap and one filler'
              );
            } else if (fillerResolved && realGapResolved) {
              if (!witness) {
                pushDiagnostic(
                  'witness-missing',
                  'the ordinary parasitic-gap movement path requires an authored trace witness'
                );
              } else if (witnessResolved) {
                const realGapSubtree = collectSubtreeIds(nodes.get(realGap));
                if (!realGapSubtree.includes(witness)) {
                  pushDiagnostic(
                    'witness-outside-source',
                    `traceWitness -> ${witness} is not inside realGap -> ${realGap}`
                  );
                } else {
                  items.push({
                    ...base,
                    kind: 'trajectory',
                    trajectoryKind: 'parasitic-gap',
                    sourceNodeId: realGap,
                    targetNodeId: filler,
                    witnessNodeId: witness,
                    sourceAttachment: primaryPath.length > 0 || secondaryPath.length > 0
                      ? 'terminal'
                      : 'shell-bottom',
                    targetAttachment: 'shell-bottom'
                  });
                }
              }
            }
          }

          const usesPhillipsPathStatus = primaryPath.length > 0 || secondaryPath.length > 0;
          const drawsCopyFork = fillerResolved
            && realGapResolved
            && parasiticFacetResolved
            && !usesPhillipsPathStatus;
          if (drawsCopyFork) {
            items.push({
              ...base,
              kind: 'parasitic-gap-copy',
              contentNodeId: filler,
              ordinaryGapNodeId: realGap,
              parasiticGapNodeIds: resolvedParasitic
            });
          }

          const index = scalarValue(values, 'index') || 'i';
          const pushGapNotation = () => {
            const subscript = asSubscript(index);
            items.push({
              ...base,
              kind: 'node-badges',
              badgeStyle: 'gap-notation',
              badges: resolvedParasitic.map((nodeId) => ({
                nodeId,
                text: `pg${subscript}`,
                shape: 'plain' as const
              }))
            });
          };

          if (
            fillerResolved
            && realGapResolved
            && parasiticFacetResolved
            && usesPhillipsPathStatus
          ) {
            items.push({ ...base, kind: 'coindex', nodeIds: [filler], index });
          }
          if (parasiticFacetResolved && !drawsCopyFork) {
            pushGapNotation();
          }

          // The composition owns its path arrays outright, so every authored
          // path node renders even when only one of the two paths is present.
          // Phillips figure 4, plate-exact: circles enclose the primary path's
          // node labels, squares the secondary path's, and the blocked
          // finite-relative-clause edge takes the double slash.
          if (usesPhillipsPathStatus) {
            const blockedEdge = flattenAnchorIds(anchors.blockedEdge)[0];
            const resolvedBlockedEdge = blockedEdge && requireResolved('blockedEdge', blockedEdge)
              ? blockedEdge
              : '';
            const pathOutcomeRaw = scalarValue(values, 'outcome');
            const pathOutcome = recognizedOutcome(
              pathOutcomeRaw,
              family,
              LICENSED_OR_BLOCKED_OUTCOME_STATES
            );
            if (pathOutcomeRaw && !pathOutcome) {
              pushDiagnostic(
                'value-unrecognized',
                `outcome -> "${pathOutcomeRaw}" is not a recognized path-status judgment`
              );
            }
            items.push({
              ...base,
              kind: 'path-status',
              primaryNodeIds: primaryPath,
              secondaryNodeIds: secondaryPath,
              ...(resolvedBlockedEdge ? { blockedEdgeNodeId: resolvedBlockedEdge } : {}),
              ...(pathOutcome ? { outcome: pathOutcome } : {})
            });
          }
          return;
        }

        case 'pair-merge': {
          const member = flattenAnchorIds(anchors.pairMember || anchors.adjunct)[0];
          const host = flattenAnchorIds(anchors.host)[0];
          if (!requireResolved('pairMember', member)) return;
          if (!requireResolved('host', host)) return;
          items.push({
            ...base,
            kind: 'undirected-link',
            pairs: [{ fromNodeId: member, toNodeId: host }],
            linkStyle: 'pair-merge'
          });
          return;
        }

        case 'shared-node': {
          const parents = resolvedIds('parents', anchors.parents);
          const shared = flattenAnchorIds(anchors.shared)[0];
          if (parents.length < 2 || !requireResolved('shared', shared)) return;
          // The authored parent role is the claim. A tree-shaped serialization
          // need not already contain one of the extra dominance edges.
          items.push({ ...base, kind: 'shared-node', parentNodeIds: parents, sharedNodeId: shared });
          return;
        }

        case 'argument-sharing': {
          const domains = resolvedIds('domains', anchors.domains);
          const shared = flattenAnchorIds(anchors.shared)[0];
          if (domains.length < 2 || !requireResolved('shared', shared)) return;
          const role = scalarValue(values, 'role').trim().toUpperCase() || 'ARG';
          domains.forEach((domain) => {
            items.push({
              ...base,
              kind: 'domain-mark',
              rootNodeId: domain,
              sharedNodeId: shared,
              memberNodeIds: collectSubtreeIds(nodes.get(domain)),
              subtreeDerived: [{ field: 'memberNodeIds', rootNodeId: domain, mode: 'all' }],
              domainStyle: 'argument-domain'
            });
          });
          items.push({
            ...base,
            kind: 'node-badges',
            badgeStyle: 'shared-object',
            badges: [{ nodeId: shared, text: role, shape: 'plain' }]
          });
          return;
        }

        case 'idiom-chunks': {
          const domainRole = Object.keys(anchors)
            .find((role) => ['domain', 'interpretationDomain'].includes(role));
          const domain = domainRole ? flattenAnchorIds(anchors[domainRole])[0] : '';
          const chunks = Object.entries(anchors)
            .filter(([role]) => role !== domainRole)
            .flatMap(([, value]) => flattenAnchorIds(value))
            .filter((nodeId, index, all) => all.indexOf(nodeId) === index)
            .filter((nodeId) => requireResolved('chunk', nodeId));
          if (!requireResolved('domain', domain) || chunks.length < 2) return;
          items.push({
            ...base,
            kind: 'domain-mark',
            rootNodeId: domain,
            memberNodeIds: collectSubtreeIds(nodes.get(domain)),
            subtreeDerived: [{ field: 'memberNodeIds', rootNodeId: domain, mode: 'all' }],
            domainStyle: 'idiom'
          });
          items.push({
            ...base,
            kind: 'node-badges',
            badgeStyle: 'idiom-chunk',
            badges: chunks.map((nodeId) => ({ nodeId, text: '', shape: 'plain' as const }))
          });
          return;
        }

        case 'feature-plaque': {
          const anchorEntries = Object.entries(anchors);
          if (anchorEntries.length === 0) {
            pushDiagnostic('endpoint-missing', 'a feature plaque needs at least one participant anchor');
            return;
          }
          const [role, value] = anchorEntries[0];
          const participant = flattenAnchorIds(value)[0];
          if (!requireResolved(role, participant)) return;
          const rows = verbatimRows(values);
          if (familyId === 'agree.plaque') {
            const probe = flattenAnchorIds(anchors.probe)[0];
            const goal = flattenAnchorIds(anchors.goal)[0];
            const composedWithCase = canComposeCaseAgreement(relation) && relations.some((companion, companionIndex) => {
              const companionEntry = findRelationRegistryEntry(registry, companion.relation);
              return companionEntry?.id === 'case-assignment.path'
                && flattenAnchorIds(companionAnchors(stageIndex, companionIndex).bearer)[0] === probe;
            });
            // A Case composition already emits this Agree instance's own
            // dotted collection path, with the Agree relationRef preserved.
            // A second independent plaque would duplicate that same claim.
            if (composedWithCase) return;
            if (rows.length > 0) {
              const plaqueNodeId = probe || participant;
              if (!requireResolved(probe ? 'probe' : role, plaqueNodeId)) return;
              items.push({
                ...base,
                kind: 'node-plaque',
                anchorNodeIds: [plaqueNodeId],
                positionNodeIds: collectSubtreeLeafIds(nodes.get(plaqueNodeId)),
                plaqueStyle: 'feature',
                title: [String(nodes.get(plaqueNodeId)?.label || plaqueNodeId), probe ? 'probe' : role]
                  .filter(Boolean)
                  .join(' '),
                rows
              });
              return;
            }
            if (!requireResolved('goal', goal)) return;
            items.push({
              ...base,
              kind: 'node-badges',
              badgeStyle: 'agreement-goal',
              badges: [{ nodeId: goal, text: '', shape: 'plain' }]
            });
            return;
          }
          /*
           * The plaque exists to show authored feature rows (the accepted
           * Agree/FeatureBundle convention authors the rows on FeatureBundle,
           * with Agree often carrying only probe/goal). An instance with no
           * authored values draws no plaque — an empty box would be an
           * invented claim — and its resolved participants instead keep the
           * neutral topology-only presentation so the authored relation stays
           * visible without an invented connector semantics. The plaque never
           * takes its title from a role name; only authored values label it.
           */
          if (rows.length === 0) {
            pushNeutralFallback(anchors, false);
            return;
          }
          items.push({
            ...base,
            kind: 'node-plaque',
            anchorNodeIds: [participant],
            positionNodeIds: collectSubtreeLeafIds(nodes.get(participant)),
            plaqueStyle: 'feature',
            title: [String(nodes.get(participant)?.label || participant), role]
              .filter(Boolean)
              .join(' '),
            rows
          });
          return;
        }

        case 'agreement-paths': {
          const probe = flattenAnchorIds(anchors.probe)[0];
          if (!requireResolved('probe', probe)) return;
          if (family.agreementMode === 'multiple') {
            const goals = [
              ...flattenAnchorIds(anchors.goals),
              ...flattenAnchorIds(anchors.goal)
            ].filter((nodeId) => requireResolved('goals', nodeId));
            if (goals.length === 0) return;
            goals.forEach((goal) => {
              items.push({
                ...base,
                kind: 'directed-path',
                fromNodeId: probe,
                toNodeId: goal,
                pathStyle: 'agree-multiple',
                ...(scalarValue(values, 'outcome') ? { label: scalarValue(values, 'outcome') } : {})
              });
            });
            return;
          }
          const goal = flattenAnchorIds(anchors.goal || anchors.searchDomain)[0];
          if (!requireResolved('goal', goal)) return;
          // The cycle numeral is an authored claim; a relation's position in
          // the stage's relation list is not evidence of its cycle number, so
          // an unauthored cycle draws the path with no numeral at all.
          items.push({
            ...base,
            kind: 'directed-path',
            fromNodeId: probe,
            toNodeId: goal,
            pathStyle: 'agree-cyclic',
            ...(scalarValue(values, 'cycle') ? { label: scalarValue(values, 'cycle') } : {}),
            ...(scalarValue(values, 'outcome') ? { secondaryLabel: scalarValue(values, 'outcome') } : {})
          });
          return;
        }

        case 'feature-sharing': {
          const bearers = resolvedIds('bearers', anchors.bearers);
          if (bearers.length < 2) return;
          items.push({
            ...base,
            kind: 'undirected-link',
            pairs: bearers.slice(0, -1).map((bearer, index) => ({
              fromNodeId: bearer,
              toNodeId: bearers[index + 1]
            })),
            linkStyle: 'feature-sharing',
            ...(scalarValue(values, 'feature') || scalarValue(values, 'value')
              ? { label: [scalarValue(values, 'feature'), scalarValue(values, 'value')].filter(Boolean).join(': ') }
              : {})
          });
          return;
        }

        case 'case-assignment': {
          const assigner = flattenAnchorIds(anchors.assigner)[0];
          const bearer = flattenAnchorIds(anchors.bearer)[0];
          const probe = flattenAnchorIds(anchors.probe)[0];
          const goal = flattenAnchorIds(anchors.goal)[0];
          if (!assigner && probe && goal) {
            if (!requireResolved('probe', probe)) return;
            if (!requireResolved('goal', goal)) return;
            items.push({
              ...base,
              kind: 'directed-path',
              fromNodeId: probe,
              toNodeId: goal,
              pathStyle: 'case-agree',
              featureRow: { label: scalarValue(values, 'feature'), value: scalarValue(values, 'value') },
              ...(scalarValue(values, 'feature') || scalarValue(values, 'value')
                ? { label: [scalarValue(values, 'feature'), scalarValue(values, 'value')].filter(Boolean).join(': ') }
                : {})
            });
            return;
          }
          if (!assigner && bearer && verbatimRows(values).length > 0) {
            if (!requireResolved('bearer', bearer)) return;
            items.push({
              ...base,
              kind: 'node-plaque',
              anchorNodeIds: [bearer],
              positionNodeIds: collectSubtreeLeafIds(nodes.get(bearer)),
              plaqueStyle: 'feature',
              title: String(nodes.get(bearer)?.label || bearer),
              rows: verbatimRows(authoredValues)
            });
            return;
          }
          if (!requireResolved('assigner', assigner)) return;
          if (!requireResolved('bearer', bearer)) return;
          items.push({
            ...base,
            kind: 'directed-path',
            fromNodeId: assigner,
            toNodeId: bearer,
            pathStyle: 'case-assignment',
            featureRow: { label: scalarValue(values, 'feature'), value: scalarValue(values, 'value') || scalarValue(values, 'case') },
            ...(scalarValue(values, 'feature') || scalarValue(values, 'value')
              ? { label: [scalarValue(values, 'feature'), scalarValue(values, 'value')].filter(Boolean).join(': ') }
              : {})
          });
          /*
           * The accepted Case card composes the solid Case path with the
           * quieter dotted collection curves of the same-stage Agree
           * relations whose probe is this bearer. Each collection curve is
           * the COMPANION's mark: it carries the companion Agree instance's
           * own relationRef (so Replay reveals it at that Agree's relation
           * moment, never earlier) and the companion's family persistence —
           * only its dotted-collection styling comes from the Case
           * composition.
           */
          relations.forEach((companion, companionIndex) => {
            const companionEntry = findRelationRegistryEntry(registry, companion.relation);
            if (!companionEntry || families[companionEntry.id]?.family !== 'feature-plaque'
              || !canComposeCaseAgreement(companion)) return;
            const boundAnchors = companionAnchors(stageIndex, companionIndex);
            const companionProbe = flattenAnchorIds(boundAnchors.probe)[0];
            const companionGoal = flattenAnchorIds(boundAnchors.goal)[0];
            if (companionProbe !== bearer || !companionGoal || !nodes.has(companionGoal)) return;
            const companionFamily = families[companionEntry.id];
            items.push({
              relationRef: {
                stageIndex,
                relationIndex: companionIndex,
                relation: companion.relation,
                anchors: companion.anchors,
                ...(companion.priorAnchors ? { priorAnchors: companion.priorAnchors } : {}),
                ...(companion.values ? { values: companion.values } : {})
              },
              familyId: String(companionEntry.id),
              appearsAtStage: stageIndex,
              persistence: companionFamily.persistence,
              backward: false,
              priorWitnessNodeIds: [],
              kind: 'directed-path',
              fromNodeId: bearer,
              toNodeId: companionGoal,
              pathStyle: 'case-agree',
              featureRow: { label: scalarValue(companion.values, 'feature'), value: scalarValue(companion.values, 'value') },
              ...(scalarValue(companion.values, 'feature') || scalarValue(companion.values, 'value')
                ? { label: [scalarValue(companion.values, 'feature'), scalarValue(companion.values, 'value')].filter(Boolean).join(': ') }
                : {})
            });
          });
          return;
        }

        case 'dependent-case': {
          const probe = flattenAnchorIds(anchors.probe)[0];
          const goal = flattenAnchorIds(anchors.goal)[0];
          if (!requireResolved('probe', probe)) return;
          if (!requireResolved('goal', goal)) return;
          const dependentCaseStep = prepareNativeDependentCaseStep(values?.step);
          if (values?.step !== undefined && dependentCaseStep === undefined) {
            pushDiagnostic('illegal-configuration', 'DependentCase requires one explicit step value of 1 or 2; unknown, multiple or empty steps are not a native mode');
            pushNeutralFallback(anchors, false);
            return;
          }
          items.push({
            ...base,
            kind: 'directed-path',
            fromNodeId: probe,
            toNodeId: goal,
            pathStyle: 'dependent-case',
            ...(dependentCaseStep ? { dependentCaseStep } : {}),
            ...(scalarValue(values, 'probeLabel') ? { label: scalarValue(values, 'probeLabel') } : {}),
            ...(scalarValue(values, 'goalLabel') ? { secondaryLabel: scalarValue(values, 'goalLabel') } : {})
          });
          return;
        }

        case 'accord': {
          const source = flattenAnchorIds(anchors.source)[0];
          const goal = flattenAnchorIds(anchors.goal)[0];
          if (!requireResolved('source', source)) return;
          if (!requireResolved('goal', goal)) return;
          items.push({
            ...base,
            kind: 'directed-path',
            fromNodeId: source,
            toNodeId: goal,
            pathStyle: 'accord',
            featureRow: { label: scalarValue(values, 'feature'), value: scalarValue(values, 'value') },
            ...(scalarValue(values, 'index') ? { secondaryLabel: scalarValue(values, 'index') } : {}),
            ...(scalarValue(values, 'feature') || scalarValue(values, 'index') || scalarValue(values, 'value')
              ? { label: `${scalarValue(values, 'feature')}${scalarValue(values, 'index')}${scalarValue(values, 'value') ? `: ${scalarValue(values, 'value')}` : ''}` }
              : {})
          });
          return;
        }

        case 'boundary-cuts': {
          if (anchors.traceWitness && pushCompositeTrajectory('phrasal')) return;
          const domain = flattenAnchorIds(anchors.domain)[0];
          const boundary = resolvedIds('boundary', anchors.boundary);
          if (!requireResolved('domain', domain) || boundary.length === 0) return;
          const boundaryOutcomeRaw = scalarValue(values, 'outcome');
          const boundaryOutcome = recognizedOutcome(
            boundaryOutcomeRaw,
            family,
            BLOCKED_OUTCOME_STATES
          );
          if (boundaryOutcomeRaw && !boundaryOutcome) {
            pushDiagnostic(
              'value-unrecognized',
              `outcome -> "${boundaryOutcomeRaw}" is not a recognized BoundingNodeCrossing judgment`
            );
          }
          items.push({
            ...base,
            kind: 'node-badges',
            badgeStyle: 'boundary-cut',
            badges: boundary.map((nodeId) => ({ nodeId, text: '∥', shape: 'plain' as const }))
          });
          return;
        }

        case 'phase-arc': {
          const phase = flattenAnchorIds(anchors.phase)[0];
          if (!requireResolved('phase', phase)) return;
          const edge = flattenAnchorIds(anchors.edge)[0];
          if (edge && !requireResolved('edge', edge)) return;
          /*
           * A later authored TransferDomain elaborates this same Phase claim
           * with Fong's Phase/edge/SOD composition. The Phase relation still
           * owns the moment when its Phase arc and edge first appear; the
           * later Transfer relation adds only the SOD. This preserves one
           * genuine authored stage per operation without a duplicate plain
           * phase arc or an early transferred-domain mark.
           */
          const transferElaboratesPhase = Boolean(edge) && stageList.some((candidateStage, candidateStageIndex) => (
            candidateStageIndex >= stageIndex
            && (candidateStage.relations || []).some((candidate, candidateRelationIndex) => {
              const candidateEntry = findRelationRegistryEntry(registry, candidate.relation);
              return Boolean(candidateEntry)
                && families[candidateEntry!.id]?.family === 'transfer-domain'
                && flattenAnchorIds(companionAnchors(candidateStageIndex, candidateRelationIndex).phase)[0] === phase
                && flattenAnchorIds(companionAnchors(candidateStageIndex, candidateRelationIndex).edge)[0] === edge;
            })
          ));
          if (transferElaboratesPhase && edge) {
            items.push({
              ...base,
              kind: 'fong-component',
              headNodeId: phase,
              componentLabel: 'Phase'
            });
            items.push({
              ...base,
              kind: 'domain-mark',
              rootNodeId: edge,
              memberNodeIds: [edge],
              domainStyle: 'transfer-edge',
              label: 'Phase edge'
            });
            return;
          }
          const phasePrimary = phaseArcOrdinal === 0;
          phaseArcOrdinal += 1;
          items.push({
            ...base,
            kind: 'domain-mark',
            rootNodeId: phase,
            ...(edge ? { phaseEdgeNodeId: edge } : {}),
            phasePrimary,
            memberNodeIds: collectSubtreeIds(nodes.get(phase)),
            subtreeDerived: [{ field: 'memberNodeIds', rootNodeId: phase, mode: 'all' }],
            domainStyle: 'phase'
          });
          return;
        }

        case 'transfer-domain': {
          const phase = flattenAnchorIds(anchors.phase)[0];
          const edges = resolvedIds('edge', anchors.edge);
          const edge = edges[0];
          const spellOut = flattenAnchorIds(anchors.spellOutDomain || anchors.complement)[0];
          if (!requireResolved('phase', phase)) return;
          if (!requireResolved('edge', edge)) return;
          if (edges.length !== flattenAnchorIds(anchors.edge).length) return;
          if (spellOut && !requireResolved('spellOutDomain', spellOut)) return;
          /*
           * Fong Defs. 1–2, plate-exact: a tilted component arc labelled
           * Phase around the phase head, the rectangular Phase-edge outline
           * around the edge, and a second tilted component arc labelled SOD
           * around the spell-out domain head.
           */
          const phaseAlreadyAuthored = stageList.some((candidateStage, candidateStageIndex) => {
            if (candidateStageIndex > stageIndex) return false;
            return (candidateStage.relations || []).some((candidate, candidateRelationIndex) => {
              if (candidateStageIndex === stageIndex && candidateRelationIndex >= relationIndex) return false;
              const candidateEntry = findRelationRegistryEntry(registry, candidate.relation);
              return Boolean(candidateEntry)
                && ['phase-arc', 'transfer-domain'].includes(families[candidateEntry!.id]?.family)
                && flattenAnchorIds(companionAnchors(candidateStageIndex, candidateRelationIndex).phase)[0] === phase
                && flattenAnchorIds(companionAnchors(candidateStageIndex, candidateRelationIndex).edge)[0] === edge;
            });
          });
          if (!phaseAlreadyAuthored) {
            items.push({
              ...base,
              kind: 'fong-component',
              headNodeId: phase,
              componentLabel: 'Phase'
            });
          }
          edges.forEach((edgeNodeId) => {
            const edgeAlreadyAuthored = stageList.some((candidateStage, candidateStageIndex) =>
              candidateStageIndex <= stageIndex && (candidateStage.relations || []).some((candidate, candidateRelationIndex) => {
                if (candidateStageIndex === stageIndex && candidateRelationIndex >= relationIndex) return false;
                const candidateEntry = findRelationRegistryEntry(registry, candidate.relation);
                const bound = companionAnchors(candidateStageIndex, candidateRelationIndex);
                return Boolean(candidateEntry)
                  && ['phase-arc', 'transfer-domain'].includes(families[candidateEntry!.id]?.family)
                  && flattenAnchorIds(bound.phase)[0] === phase && flattenAnchorIds(bound.edge).includes(edgeNodeId);
              }));
            if (edgeAlreadyAuthored) return;
            items.push({
              ...base,
              kind: 'domain-mark',
              rootNodeId: edgeNodeId,
              memberNodeIds: [edgeNodeId],
              domainStyle: 'transfer-edge',
              label: 'Phase edge'
            });
          });
          if (spellOut) {
            items.push({
              ...base,
              kind: 'fong-component',
              headNodeId: spellOut,
              componentLabel: 'SOD'
            });
          }
          return;
        }

        case 'blocked-access': {
          const blockedAccessOutcomeRaw = scalarValue(values, 'outcome');
          if (
            blockedAccessOutcomeRaw
            && !recognizedOutcome(blockedAccessOutcomeRaw, family, BLOCKED_OUTCOME_STATES)
          ) {
            pushDiagnostic(
              'value-unrecognized',
              `outcome -> "${blockedAccessOutcomeRaw}" is not a recognized PostTransferAccess judgment`
            );
          }
          const phase = flattenAnchorIds(anchors.phase)[0];
          const edge = flattenAnchorIds(anchors.edge)[0];
          const source = flattenAnchorIds(anchors.source)[0];
          const target = flattenAnchorIds(anchors.target)[0];
          const domain = flattenAnchorIds(anchors.spellOutDomain || anchors.domain)[0];
          if (phase || edge) {
            if (!requireResolved('phase', phase)) return;
            if (!requireResolved('edge', edge)) return;
            const priorComposition = stageList.some((candidateStage, candidateStageIndex) => {
              if (candidateStageIndex > stageIndex) return false;
              return (candidateStage.relations || []).some((candidate, candidateRelationIndex) => {
                if (candidateStageIndex === stageIndex && candidateRelationIndex >= relationIndex) return false;
                const candidateEntry = findRelationRegistryEntry(registry, candidate.relation);
                return Boolean(candidateEntry)
                  && families[candidateEntry!.id]?.family === 'blocked-access'
                  && flattenAnchorIds(companionAnchors(candidateStageIndex, candidateRelationIndex).phase)[0] === phase
                  && flattenAnchorIds(companionAnchors(candidateStageIndex, candidateRelationIndex).edge)[0] === edge;
              });
            });
            if (!priorComposition) {
              items.push({ ...base, kind: 'fong-component', headNodeId: phase, componentLabel: 'Phase' });
              items.push({
                ...base,
                kind: 'domain-mark',
                rootNodeId: edge,
                memberNodeIds: [edge],
                domainStyle: 'transfer-edge',
                label: 'Phase edge'
              });
            }
            if (domain) {
              if (!requireResolved('spellOutDomain', domain)) return;
              items.push({ ...base, kind: 'fong-component', headNodeId: domain, componentLabel: 'SOD' });
            }
            return;
          }
          if (!requireResolved('source', source)) return;
          if (!requireResolved('target', target)) return;
          if (domain && !requireResolved('spellOutDomain', domain)) return;
          items.push({
            ...base,
            kind: 'blocked-access-lane',
            sourceNodeId: source,
            targetNodeId: target,
            domainMemberNodeIds: domain ? collectSubtreeIds(nodes.get(domain)) : [],
            ...(domain
              ? { subtreeDerived: [{ field: 'domainMemberNodeIds', rootNodeId: domain, mode: 'all' as const }] }
              : {})
          });
          return;
        }

        case 'anti-locality': {
          const source = flattenAnchorIds(anchors.source || anchors.lowerCopy)[0];
          const witness = flattenAnchorIds(anchors.traceWitness)[0];
          const landing = flattenAnchorIds(anchors.landing || anchors.pronouncedCopy)[0];
          if (!requireResolved('source', source)) return;
          if (!requireResolved('traceWitness', witness)) return;
          if (!requireResolved('landing', landing)) return;
          if (!collectSubtreeIds(nodes.get(source)).includes(witness)) {
            pushDiagnostic('witness-outside-source', `traceWitness -> ${witness} is not inside the source`);
            return;
          }
          const antiLocalityOutcomeRaw = scalarValue(values, 'outcome');
          const antiLocalityOutcome = recognizedOutcome(
            antiLocalityOutcomeRaw,
            family,
            LICENSED_OR_BLOCKED_OUTCOME_STATES
          );
          if (antiLocalityOutcomeRaw && !antiLocalityOutcome) {
            pushDiagnostic(
              'value-unrecognized',
              `outcome -> "${antiLocalityOutcomeRaw}" is not a recognized AntiLocality judgment; the path draws without a judgment mark`
            );
          }
          items.push({
            ...base,
            kind: 'directed-path',
            fromNodeId: source,
            toNodeId: landing,
            pathStyle: 'anti-locality',
            ...(antiLocalityOutcome ? { outcome: antiLocalityOutcome } : {})
          });
          const facilitator = flattenAnchorIds(anchors.facilitator)[0];
          if (facilitator && requireResolved('facilitator', facilitator)) {
            items.push({
              ...base,
              kind: 'node-badges',
              badgeStyle: 'facilitator',
              badges: [{ nodeId: facilitator, text: '', shape: 'plain' }]
            });
          }
          return;
        }

        case 'improper-movement': {
          if (anchors.lowerCopy && anchors.traceWitness && pushCompositeTrajectory('phrasal')) return;
          const source = flattenAnchorIds(anchors.source)[0];
          const witness = flattenAnchorIds(anchors.traceWitness)[0];
          const landing = flattenAnchorIds(anchors.licensedLanding)[0];
          if (!requireResolved('source', source)) return;
          if (!requireResolved('traceWitness', witness)) return;
          if (!requireResolved('licensedLanding', landing)) return;
          if (!collectSubtreeIds(nodes.get(source)).includes(witness)) {
            pushDiagnostic('witness-outside-source', `traceWitness -> ${witness} is not inside the source`);
            return;
          }
          const forbidden = resolvedIds('forbiddenRegion', anchors.forbiddenRegion);
          const licensedHosts = resolvedIds('licensedLandingHosts', anchors.licensedLandingHosts);
          const rejectedHosts = resolvedIds('rejectedLandingHosts', anchors.rejectedLandingHosts);
          if (rejectedHosts.some((nodeId) => nodeId === landing || licensedHosts.includes(nodeId))) {
            pushDiagnostic('illegal-configuration', 'The same candidate host is both licensed and rejected');
            pushNeutralFallback(primaryRelation.anchors, false);
            return;
          }
          if (forbidden.length > 0) {
            items.push({
              ...base,
              kind: 'domain-mark',
              memberNodeIds: forbidden,
              domainStyle: 'forbidden-region'
            });
          }
          items.push({
            ...base,
            kind: 'directed-path',
            fromNodeId: witness,
            toNodeId: landing,
            pathStyle: 'anti-locality',
            sourceOccurrenceNodeId: source,
            outcome: 'licensed'
          });
          // The accepted drawing shows the rejected candidate paths too, each
          // from the same witness into the forbidden region's host.
          [...licensedHosts.map((nodeId) => ({ nodeId, outcome: 'licensed' as const })),
            ...rejectedHosts.map((nodeId) => ({ nodeId, outcome: 'blocked' as const }))].forEach(({ nodeId, outcome }) => {
            items.push({
              ...base,
              kind: 'directed-path',
              fromNodeId: witness,
              toNodeId: nodeId,
              pathStyle: 'improper-candidate',
              sourceOccurrenceNodeId: source,
              outcome
            });
          });
          if (licensedHosts.length > 0 || rejectedHosts.length > 0) {
            items.push({
              ...base,
              kind: 'node-badges',
              badgeStyle: 'improper-hosts',
              badges: [
                ...licensedHosts.map((nodeId) => ({ nodeId, text: '✓', shape: 'plain' as const })),
                ...rejectedHosts.map((nodeId) => ({ nodeId, text: '✗', shape: 'plain' as const }))
              ]
            });
          }
          return;
        }

        case 'blocked-extraction': {
          const source = flattenAnchorIds(anchors.source || anchors.extractionSource)[0];
          const target = flattenAnchorIds(anchors.target || anchors.landingSite)[0];
          const domain = flattenAnchorIds(anchors.adjunctDomain || anchors.domain)[0];
          if (!requireResolved('source', source)) return;
          if (!requireResolved('target', target)) return;
          if (!requireResolved('domain', domain)) return;
          items.push({
            ...base,
            kind: 'domain-mark',
            rootNodeId: domain,
            memberNodeIds: collectSubtreeIds(nodes.get(domain)),
            subtreeDerived: [{ field: 'memberNodeIds', rootNodeId: domain, mode: 'all' }],
            domainStyle: 'adjunct-domain'
          });
          const blockedExtractionOutcomeRaw = scalarValue(values, 'outcome');
          const blockedExtractionOutcome = recognizedOutcome(
            blockedExtractionOutcomeRaw,
            family,
            BLOCKED_OUTCOME_STATES
          );
          if (blockedExtractionOutcomeRaw && !blockedExtractionOutcome) {
            pushDiagnostic(
              'value-unrecognized',
              `outcome -> "${blockedExtractionOutcomeRaw}" is not a recognized BlockedExtraction judgment; the path draws without a judgment mark`
            );
          }
          items.push({
            ...base,
            kind: 'directed-path',
            fromNodeId: source,
            toNodeId: target,
            pathStyle: 'blocked-extraction',
            ...(blockedExtractionOutcome ? { outcome: blockedExtractionOutcome } : {})
          });
          return;
        }

        case 'intervention': {
          if (anchors.lowerCopy && anchors.traceWitness && pushCompositeTrajectory('phrasal')) return;
          const probe = flattenAnchorIds(anchors.landing || anchors.probe)[0];
          const intervener = flattenAnchorIds(anchors.intervener)[0];
          const target = flattenAnchorIds(anchors.target)[0];
          if (!requireResolved('probe', probe)) return;
          if (!requireResolved('intervener', intervener)) return;
          if (!requireResolved('target', target)) return;
          const interventionOutcomeRaw = scalarValue(values, 'outcome');
          const interventionOutcome = recognizedOutcome(
            interventionOutcomeRaw,
            family,
            BLOCKED_OUTCOME_STATES
          );
          if (interventionOutcomeRaw && !interventionOutcome) {
            pushDiagnostic(
              'value-unrecognized',
              `outcome -> "${interventionOutcomeRaw}" is not a recognized Intervention judgment; the path draws without a judgment mark`
            );
          }
          items.push({
            ...base,
            kind: 'directed-path',
            fromNodeId: probe,
            toNodeId: target,
            pathStyle: 'intervention',
            ...(interventionOutcome ? { outcome: interventionOutcome } : {})
          });
          items.push({
            ...base,
            kind: 'node-badges',
            badgeStyle: 'intervener',
            badges: [{ nodeId: intervener, text: '', shape: 'plain' }]
          });
          return;
        }

        case 'analysis-judgment': {
          const analysis = flattenAnchorIds(anchors.analysis)[0];
          if (!requireResolved('analysis', analysis)) return;
          const outcomeRaw = scalarValue(values, 'outcome');
          if (outcomeRaw && !recognizedOutcome(outcomeRaw, family, ILLICIT_OUTCOME_STATES)) {
            pushDiagnostic(
              'value-unrecognized',
              `outcome -> "${outcomeRaw}" is not a recognized IllicitAnalysis judgment`
            );
          }
          const judgment = scalarValue(values, 'judgment');
          if (!judgment) {
            pushDiagnostic(
              'value-unrecognized',
              'judgment is required to draw an analysis-level judgment mark'
            );
            return;
          }
          const label = scalarValue(values, 'label');
          const canonicalClaimIdentity = JSON.stringify({
            kind: 'analysis-verdict',
            analysisNodeId: analysis,
            judgment,
            label: label || ''
          });
          items.push({
            ...base,
            kind: 'analysis-verdict',
            analysisNodeId: analysis,
            judgment,
            ...(label ? { label } : {}),
            claimTier: 1,
            canonicalClaimIdentity
          });
          return;
        }

        case 'ellipsis-site': {
          const site = flattenAnchorIds(anchors.site || anchors.domain)[0];
          const antecedent = flattenAnchorIds(anchors.antecedent)[0];
          if (!requireResolved('site', site)) return;
          if (antecedent && !requireResolved('antecedent', antecedent)) return;
          if (familyId === 'ellipsis.deletion') {
            const terminalNodeIds = collectLexicalTerminalIds(nodes.get(site));
            if (terminalNodeIds.length === 0) {
              pushDiagnostic(
                'endpoint-missing',
                `deletion domain -> ${site} contains no lexical terminal material to strike`
              );
              return;
            }
            items.push({
              ...base,
              kind: 'strike-ghost',
              strikeNodeIds: [site],
              ghostNodeIds: []
            });
            return;
          }
          items.push({
            ...base,
            kind: 'ellipsis-site',
            siteNodeId: site,
            ...(antecedent ? {
              antecedentNodeId: antecedent,
              antecedentSubtreeNodeIds: collectSubtreeIds(nodes.get(antecedent))
            } : {}),
            ghostNodeIds: collectAuthoredSilentSubtreeIds(nodes.get(site)),
            siteSubtreeNodeIds: collectSubtreeIds(nodes.get(site)),
            subtreeDerived: [
              { field: 'ghostNodeIds', rootNodeId: site, mode: 'authored-silent' },
              { field: 'siteSubtreeNodeIds', rootNodeId: site, mode: 'all' },
              ...(antecedent
                ? [{ field: 'antecedentSubtreeNodeIds', rootNodeId: antecedent, mode: 'all' as const }]
                : [])
            ]
          });
          return;
        }

        case 'copy-pronunciation': {
          const occurrences = [
            ...flattenAnchorIds(anchors.higherCopy),
            ...flattenAnchorIds(anchors.lowerCopy),
            ...flattenAnchorIds(anchors.occurrences)
          ].filter((nodeId, index, all) => all.indexOf(nodeId) === index)
            .filter((nodeId) => requireResolved('occurrences', nodeId));
          if (occurrences.length === 0) return;
          occurrences.forEach((nodeId) => {
            items.push({ ...base, kind: 'enclosure', nodeId, licence: 'copy-occurrence' });
          });
          return;
        }

        case 'partial-copy-deletion': {
          const deleted = flattenAnchorIds(anchors.deletedSubconstituent || anchors.deleted)[0];
          if (!requireResolved('deletedSubconstituent', deleted)) return;
          items.push({
            ...base,
            kind: 'strike-ghost',
            strikeNodeIds: [deleted],
            ghostNodeIds: collectSubtreeIds(nodes.get(deleted)),
            subtreeDerived: [{ field: 'ghostNodeIds', rootNodeId: deleted, mode: 'all' }]
          });
          return;
        }

        case 'realization-plate': {
          if (vocabularyAssignments.has(relationIndex)) return;
          const targets = Object.values(anchors)
            .flatMap(flattenAnchorIds)
            .filter((nodeId, index, all) => all.indexOf(nodeId) === index)
            .filter((nodeId) => requireResolved('target', nodeId));
          if (targets.length === 0) return;
          // Only this package's own validated insertions contribute rows, in
          // authored order.
          const packageCompanions = relations.flatMap((companion, companionIndex) =>
            vocabularyAssignments.get(companionIndex) === relationIndex
              ? [{ companion, companionIndex }]
              : []);
          const packageContents = packageCompanions.map(({ companion }) => nativeRealizationContent(companion.values));
          const packageRows = packageContents.flatMap((content) => content.rows);
          const packageRefs = packageCompanions.map(({ companion, companionIndex }) => ({
            stageIndex,
            relationIndex: companionIndex,
            relation: companion.relation,
            anchors: companion.anchors,
            ...(companion.priorAnchors ? { priorAnchors: companion.priorAnchors } : {}),
            ...(companion.values ? { values: companion.values } : {})
          }));
          const ownContent = nativeRealizationContent(values);
          const ownRows = ownContent.rows;
          items.push({
            ...base,
            kind: 'node-plaque',
            anchorNodeIds: targets,
            plaqueStyle: 'realization',
            rows: [...ownRows, ...packageRows],
            realizationRowKinds: [...ownContent.realizationRowKinds, ...packageContents.flatMap((content) => content.realizationRowKinds)],
            rowRefs: [...ownRows.map(() => null), ...packageContents.flatMap((content, index) => content.rows.map(() => packageRefs[index]))],
            composedRefs: packageRefs
          });
          return;
        }

        case 'vocabulary-insertion': {
          // An insertion consumed by its explicitly-targeted package carries
          // no separate plate; any other insertion keeps its own.
          if (vocabularyAssignments.has(relationIndex)) return;
          const target = flattenAnchorIds(anchors.terminal || anchors.target)[0];
          if (!requireResolved('terminal', target)) return;
          items.push({
            ...base,
            kind: 'node-plaque',
            anchorNodeIds: [target],
            plaqueStyle: 'realization',
            ...nativeRealizationContent(values),
            rowRefs: nativeRealizationContent(values).rows.map(() => relationRef)
          });
          return;
        }

        case 'phrasal-spellout': {
          const phrase = flattenAnchorIds(anchors.phrase || anchors.domain)[0];
          if (!requireResolved('phrase', phrase)) return;
          items.push({
            ...base,
            kind: 'node-plaque',
            anchorNodeIds: [phrase],
            plaqueStyle: 'spellout-label',
            title: scalarValue(values, 'exponent'),
            rows: verbatimRows(authoredValues)
          });
          return;
        }

        case 'pf-correspondence': {
          const anchor = flattenAnchorIds(anchors.word || anchors.terminal)[0];
          if (!requireResolved('word', anchor)) return;
          const correspondenceEvidence = buildTier2FacetEvidence({ relation: primaryRelation, currentForest: stage.workspaceForest || [] });
          const nativeContent = prepareNativePlaqueContent('correspondence', tier2NativePlaqueRows(correspondenceEvidence), [anchor]);
          if (!nativeContent) {
            pushDiagnostic('illegal-configuration', 'PF correspondence needs sources and exponents paired item by item');
            pushNeutralFallback(primaryRelation.anchors, false);
            return;
          }
          items.push({
            ...base,
            kind: 'node-plaque',
            anchorNodeIds: [anchor],
            plaqueStyle: 'correspondence',
            nativeContent,
            rows: verbatimRows(authoredValues)
          });
          return;
        }

        case 'fission': {
          const outputs = resolvedIds('outputs', anchors.outputs);
          if (outputs.length === 0) return;
          const fissionEvidence = buildTier2FacetEvidence({ relation: primaryRelation, currentForest: stage.workspaceForest || [],
            ...(stageIndex > 0 ? { priorForest: stageList[stageIndex - 1].workspaceForest } : {}) });
          const nativeContent = prepareNativeFissionContent(fissionEvidence);
          if (!nativeContent) {
            pushDiagnostic('illegal-configuration', 'Native fission requires exactly two outputs, the input features, and one feature bundle per output paired by name');
            pushNeutralFallback(primaryRelation.anchors, false);
            return;
          }
          items.push({
            ...base,
            kind: 'node-plaque',
            anchorNodeIds: outputs,
            plaqueStyle: 'fission',
            nativeContent,
            rows: verbatimRows(authoredValues)
          });
          return;
        }

        case 'impoverishment': {
          const terminal = flattenAnchorIds(anchors.terminal)[0];
          if (!requireResolved('terminal', terminal)) return;
          const nativeContent = prepareNativePlaqueContent('impoverishment', verbatimRows(values), [terminal]);
          if (!nativeContent) {
            pushDiagnostic('illegal-configuration', 'Native impoverishment requires an ordered hierarchy and one unambiguous delinking edge');
            pushNeutralFallback(primaryRelation.anchors, false);
            return;
          }
          items.push({
            ...base,
            kind: 'node-plaque',
            anchorNodeIds: [terminal],
            plaqueStyle: 'impoverishment',
            nativeContent,
            rows: verbatimRows(authoredValues)
          });
          return;
        }

        case 'local-dislocation': {
          const sequence = resolvedIds('sequence', anchors.sequence);
          if (sequence.length === 0) return;
          items.push({
            ...base,
            kind: 'node-plaque',
            anchorNodeIds: sequence,
            plaqueStyle: 'dislocation-lane',
            rows: verbatimRows(authoredValues)
          });
          return;
        }

        case 'cyclic-linearization': {
          const order = resolvedIds('order', anchors.order);
          if (order.length === 0) {
            pushDiagnostic(
              'endpoint-missing',
              'CyclicLinearization requires an ordering ledger'
            );
            return;
          }
          const evidence = buildTier2FacetEvidence({ relation: primaryRelation,
            currentForest: stage.workspaceForest,
            ...(stageIndex > 0 ? { priorForest: stageList[stageIndex - 1].workspaceForest } : {}) });
          const nativeContent = prepareNativeLinearizationContent(evidence);
          if (!nativeContent) {
            pushDiagnostic('illegal-configuration', 'CyclicLinearization has no complete, unambiguous prior/current comparison content');
            pushNeutralFallback(anchors, false);
            return;
          }
          items.push({
            ...base,
            kind: 'node-plaque',
            anchorNodeIds: order,
            plaqueStyle: 'linearization',
            nativeContent,
            ...(scalarValue(values, 'outcome') ? { title: scalarValue(values, 'outcome') } : {}),
            rows: verbatimRows(authoredValues)
          });
          return;
        }

        case 'qr': {
          const ellipsisSite = flattenAnchorIds(anchors.site)[0];
          if (ellipsisSite) {
            const antecedent = flattenAnchorIds(anchors.antecedent)[0];
            if (!requireResolved('site', ellipsisSite)) return;
            if (antecedent && !requireResolved('antecedent', antecedent)) return;
            items.push({
              ...base,
              kind: 'ellipsis-site',
              siteNodeId: ellipsisSite,
              ...(antecedent ? {
                antecedentNodeId: antecedent,
                antecedentSubtreeNodeIds: collectSubtreeIds(nodes.get(antecedent))
              } : {}),
              ghostNodeIds: collectAuthoredSilentSubtreeIds(nodes.get(ellipsisSite)),
              siteSubtreeNodeIds: collectSubtreeIds(nodes.get(ellipsisSite)),
              subtreeDerived: [
                { field: 'ghostNodeIds', rootNodeId: ellipsisSite, mode: 'authored-silent' },
                { field: 'siteSubtreeNodeIds', rootNodeId: ellipsisSite, mode: 'all' },
                ...(antecedent
                  ? [{ field: 'antecedentSubtreeNodeIds', rootNodeId: antecedent, mode: 'all' as const }]
                  : [])
              ]
            });
            return;
          }
          const pronounced = firstRole(anchors, ['pronouncedQP', 'source']);
          const lf = firstRole(anchors, ['lfQP', 'target']);
          if (!pronounced || !lf) {
            pushDiagnostic('endpoint-missing', 'QuantifierRaising requires pronounced and LF occurrence anchors');
            return;
          }
          if (!requireResolved(pronounced.role, pronounced.nodeId)) return;
          if (!requireResolved(lf.role, lf.nodeId)) return;
          const scopeDomain = flattenAnchorIds(anchors.scopeDomain || anchors.domain)[0];
          if (scopeDomain && !requireResolved('scopeDomain', scopeDomain)) return;
          items.push({
            ...base,
            kind: 'quantifier-raising',
            pronouncedNodeId: pronounced.nodeId,
            lfNodeId: lf.nodeId,
            ...(scopeDomain ? { scopeDomainNodeId: scopeDomain } : {}),
            index: qrIndexFor(stableChainKey('qr', nodes, [pronounced.nodeId, lf.nodeId]))
          });
          return;
        }

        case 'lf-reconstruction': {
          const neglected = flattenAnchorIds(anchors.neglectedCopy)[0];
          const interpreted = flattenAnchorIds(anchors.interpretedCopy)[0];
          if (!requireResolved('neglectedCopy', neglected)) return;
          if (!requireResolved('interpretedCopy', interpreted)) return;
          // The sourced convention links the copies by shared subscript alone:
          // strike/ghost on the neglected copy, retained interpreted copy, and
          // no connector of any kind.
          items.push({
            ...base,
            kind: 'strike-ghost',
            strikeNodeIds: [neglected],
            ghostNodeIds: collectSubtreeIds(nodes.get(neglected)),
            subtreeDerived: [{ field: 'ghostNodeIds', rootNodeId: neglected, mode: 'all' }]
          });
          items.push({
            ...base,
            kind: 'coindex',
            nodeIds: [neglected, interpreted],
            index: 'i'
          });
          return;
        }

        case 'cooper-storage': {
          const scope = flattenAnchorIds(anchors.scope)[0];
          if (!requireResolved('scope', scope)) return;
          const nativeContent = prepareNativePlaqueContent('cooper-storage', verbatimRows(values), [scope]);
          if (!nativeContent) {
            pushDiagnostic('illegal-configuration', 'Native storage requires explicit category, qstore, or retrieved rows');
            pushNeutralFallback(primaryRelation.anchors, false);
            return;
          }
          items.push({
            ...base,
            kind: 'node-plaque',
            anchorNodeIds: [scope],
            plaqueStyle: 'cooper-storage',
            nativeContent,
            rows: verbatimRows(authoredValues)
          });
          return;
        }

        case 'strong-npi': {
          const licensor = flattenAnchorIds(anchors.licensor)[0];
          const npi = flattenAnchorIds(anchors.npi)[0];
          const focusOperator = flattenAnchorIds(anchors.focusOperator)[0];
          const focusAssociate = flattenAnchorIds(anchors.focusAssociate)[0];
          if (!requireResolved('licensor', licensor)) return;
          if (!requireResolved('npi', npi)) return;
          if (Boolean(focusOperator) !== Boolean(focusAssociate)) {
            pushDiagnostic('endpoint-missing', 'focusOperator and focusAssociate must be authored together');
            return;
          }
          if (focusOperator && !requireResolved('focusOperator', focusOperator)) return;
          if (focusAssociate && !requireResolved('focusAssociate', focusAssociate)) return;
          items.push({
            ...base,
            kind: 'undirected-link',
            pairs: [
              { fromNodeId: licensor, toNodeId: npi },
              ...(focusOperator && focusAssociate
                ? [{ fromNodeId: focusOperator, toNodeId: focusAssociate }]
                : [])
            ],
            linkStyle: 'strong-npi',
            ...(scalarValue(values, 'feature') ? { label: scalarValue(values, 'feature') } : {})
          });
          return;
        }

        case 'focus-prominence': {
          const domain = flattenAnchorIds(anchors.domain)[0];
          const focus = flattenAnchorIds(anchors.focus)[0];
          const background = flattenAnchorIds(anchors.background)[0];
          if (!requireResolved('domain', domain)) return;
          if (!requireResolved('focus', focus)) return;
          if (!requireResolved('background', background)) return;
          const strongEdges = nativeAncestorEdges(nodes, domain, focus);
          const weakEdges = nativeAncestorEdges(nodes, domain, background);
          if (!strongEdges || !weakEdges || strongEdges.some((strong) => weakEdges.some((weak) =>
            strong.fromNodeId === weak.fromNodeId && strong.toNodeId === weak.toNodeId))) {
            pushDiagnostic('illegal-configuration', 'Focus and background require distinct native branches within the named domain');
            pushNeutralFallback(primaryRelation.anchors, false);
            return;
          }
          items.push({
            ...base,
            kind: 'branch-emphasis',
            focusNodeId: focus,
            strongEdges,
            weakEdges
          });
          return;
        }

        case 'f-projection': {
          const accentBearer = flattenAnchorIds(anchors.accentBearer)[0];
          const projections = resolvedIds('projections', anchors.projections);
          if (!requireResolved('accentBearer', accentBearer) || projections.length === 0) return;
          const hops = [accentBearer, ...projections];
          if (!isNativeProjectionPath(nodes, accentBearer, projections)) {
            pushDiagnostic('illegal-configuration', 'FProjection requires ordered ancestor hops between the exact authored nodes');
            pushNeutralFallback(primaryRelation.anchors, false);
            return;
          }
          hops.slice(0, -1).forEach((fromNodeId, index) => {
            items.push({
              ...base,
              kind: 'directed-path',
              fromNodeId,
              toNodeId: hops[index + 1],
              pathStyle: 'f-projection',
              projectionTargetAttachment: nodes.get(hops[index + 1])?.word
                && !(nodes.get(hops[index + 1])?.children || []).length ? 'terminal' : 'shell',
              ...(scalarValue(values, 'feature') ? { projectionFeature: scalarValue(values, 'feature') } : {}),
              ...(index === 0 && scalarValue(values, 'accent') ? { label: scalarValue(values, 'accent') } : {})
            });
          });
          return;
        }

        case 'theta-grid': {
          if (anchors.traceWitness && pushCompositeTrajectory('phrasal')) return;
          const predicate = flattenAnchorIds(anchors.predicate)[0];
          if (!requireResolved('predicate', predicate)) return;
          const roleEntries = Object.entries(anchors)
            .filter(([role]) => role.toLowerCase() !== 'predicate');
          const evidence = buildTier2FacetEvidence({ relation: primaryRelation, currentForest: stage.workspaceForest || [] });
          const explicitArguments = evidence.currentAnchors['theta.arguments'];
          const explicitRoles = explicitArguments?.length ? literalThetaRoles(evidence) : undefined;
          if (explicitArguments?.length && !explicitRoles) {
            pushDiagnostic('illegal-configuration', 'Theta arguments require exactly one authored role label per argument');
            pushNeutralFallback(primaryRelation.anchors, false);
            return;
          }
          const roleBadges = explicitRoles
            ? explicitRoles.map(({ nodeId, label }) => ({ nodeId, role: label }))
            : roleEntries.flatMap(([role, value]) => flattenAnchorIds(value)
            .filter((nodeId) => requireResolved(role, nodeId))
            .map((nodeId) => ({ role: role.charAt(0).toUpperCase() + role.slice(1), nodeId })));
          if (!roleBadges.length) {
            pushDiagnostic('illegal-configuration', 'A theta grid requires at least one authored role association');
            pushNeutralFallback(primaryRelation.anchors, false);
            return;
          }
          if (roleBadges.some(({ nodeId }) => !requireResolved('argument', nodeId))) return;
          items.push({
            ...base,
            kind: 'node-plaque',
            anchorNodeIds: [predicate],
            plaqueStyle: 'theta-grid',
            thetaRoles: roleBadges.map(({ role, nodeId }) => ({ nodeId, label: role })),
            rows: roleBadges.map(({ role }) => ({ label: role, value: '' }))
          });
          if (roleBadges.length > 0) {
            items.push({
              ...base,
              kind: 'node-badges',
              badgeStyle: 'theta-role',
              badges: roleBadges.map(({ nodeId }, index) => ({
                nodeId,
                text: String(index + 1),
                shape: 'plain' as const
              }))
            });
          }
          return;
        }

        case 'gapping-alignment': {
          const correlates = resolvedIds('correlates', anchors.correlates);
          const remnants = resolvedIds('remnants', anchors.remnants);
          if (correlates.length === 0 || correlates.length !== remnants.length) {
            pushDiagnostic('endpoint-missing', 'GappingAlignment requires positionally paired correlates and remnants');
            return;
          }
          // Labels pair with correlates only through a same-name values entry
          // of the same length, or one label for one correlate.
          const authoredCorrelateKey = Object.entries(primaryRelation.anchors || {})
            .find(([, value]) => JSON.stringify(flattenAnchorIds(value)) === JSON.stringify(correlates))?.[0];
          const sameNameLabels = authoredCorrelateKey ? listValue(values, authoredCorrelateKey) : [];
          const conceptLabels = listValue(values, 'labels');
          const labels = sameNameLabels.length === correlates.length
            ? sameNameLabels
            : (correlates.length === 1 && conceptLabels.length === 1 ? conceptLabels : []);
          items.push({
            ...base,
            kind: 'node-badges',
            badgeStyle: 'gapping-ordinal',
            badges: correlates.flatMap((nodeId, index) => {
              const label = labels[index] || String(index + 1);
              return [
                { nodeId, text: `-${label}`, shape: 'plain' as const },
                { nodeId: remnants[index], text: `=${label}`, shape: 'plain' as const }
              ];
            })
          });
          return;
        }

          default: {
            pushDiagnostic(
              'signature-incomplete',
              `family ${family.family} has no compiler branch`
            );
          }
        }
      } finally {
        const currentRelationAlreadyPresented = items.some((item) => {
          const refs = [
            ...planItemRelationRefs(item),
            ...(((item as { rowRefs?: Array<PlanRelationRef | null> }).rowRefs || [])
              .filter((ref): ref is PlanRelationRef => Boolean(ref)))
          ];
          return refs.some((ref) => (
            ref.stageIndex === stageIndex && ref.relationIndex === relationIndex
          ));
        });
        if (items.length === specializedItemCountBefore && !currentRelationAlreadyPresented) {
          pendingNeutralFallbacks.push(() => {
            const presentedAfterStageCompilation = items.some((item) => {
              const refs = [
                ...planItemRelationRefs(item),
                ...(((item as { rowRefs?: Array<PlanRelationRef | null> }).rowRefs || [])
                  .filter((ref): ref is PlanRelationRef => Boolean(ref)))
              ];
              return refs.some((ref) => (
                ref.stageIndex === stageIndex && ref.relationIndex === relationIndex
              ));
            });
            if (!presentedAfterStageCompilation) {
              pushNeutralFallback(relation.anchors || {}, true);
            }
          });
        }
      }
    });
    pendingNeutralFallbacks.forEach((presentFallbackIfStillNeeded) => {
      presentFallbackIfStillNeeded();
    });
  });

  /*
   * Large-anchor organization: additive, inheriting the parent instance's
   * compiled persistence. Full-array exemption derives from live production
   * ownership only.
   */
  const isFullArrayOwned = (relationName: string, role: string): boolean => {
    const ownedEntry = findRelationRegistryEntry(registry, relationName);
    if (!ownedEntry) return false;
    if (!families[ownedEntry.id]) return false;
    return (FULL_ARRAY_OWNED_ROLES[ownedEntry.id] || []).includes(role);
  };
  const largeSets = compileLargeAnchorSets(stageList, isFullArrayOwned);
  largeSets.diagnostics.forEach((detail) => {
    diagnostics.push({
      stageIndex: -1,
      relationIndex: -1,
      relation: '',
      kind: 'large-array-anchor-unresolved',
      detail
    });
  });
  largeSets.sets.forEach((set) => {
    const stage = stageList[set.stageIndex];
    const relations = Array.isArray(stage?.relations) ? stage.relations : [];
    const relationIndex = set.relationIndex;
    const parentRelation = relationIndex >= 0 ? relations[relationIndex] : undefined;
    const parentItem = items.find((item) =>
      item.relationRef.stageIndex === set.stageIndex
      && item.relationRef.relationIndex === relationIndex);
    const tier2OrganizationAlreadyCompiled = items.some((item) =>
      item.kind === 'anchor-set'
      && item.tier2FacetId === 'organization.large-anchor-set'
      && item.relationRef.stageIndex === set.stageIndex
      && item.relationRef.relationIndex === relationIndex);
    if (tier2OrganizationAlreadyCompiled) return;
    items.push({
      kind: 'anchor-set',
      relationRef: {
        stageIndex: set.stageIndex,
        relationIndex,
        relation: set.relation,
        anchors: parentRelation?.anchors ?? {},
        ...(parentRelation?.priorAnchors ? { priorAnchors: parentRelation.priorAnchors } : {}),
        ...(parentRelation?.values ? { values: parentRelation.values } : {})
      },
      appearsAtStage: set.stageIndex,
      persistence: parentItem?.persistence ?? 'stage-only',
      backward: parentItem?.backward ?? false,
      priorWitnessNodeIds: parentItem?.priorWitnessNodeIds ?? [],
      showBadges: parentItem?.kind !== 'fallback',
      badgeSize: parentItem?.familyId === 'pf.cyclic-linearization' ? 'compact' : 'standard',
      set
    });
  });

  /* Materialize into per-stage frames per persistence, before coalescing. */
  const stageCount = stageList.length;
  const frames = Array.from({ length: stageCount }, (_unused, stageIndex) => ({
    stageIndex,
    items: [] as RelationPlanItem[]
  }));
  /*
   * Vanished-anchor law: a persistent mark materializes into a later frame
   * only while every authored anchor that resolved at its authoring stage
   * still exists in that frame's forest. When an anchored node is gone, the
   * mark is NOT drawn there — never retargeted through lineage or a nearby
   * node — while its earlier Replay history keeps the correct mark, and a
   * structured diagnostic records the stage, relation, and missing anchors
   * for developers (the canvas itself shows nothing invented).
   */
  const stageNodeMaps = stageList.map((stage) => collectForest(stage?.workspaceForest));
  const stageNodeIdSets = stageNodeMaps.map((nodesById) => new Set(nodesById.keys()));
  const vanishedAnchorIds = (item: RelationPlanItem, frameIndex: number): string[] => {
    if (frameIndex === item.appearsAtStage) return [];
    const frameNodes = stageNodeIdSets[frameIndex];
    if (!frameNodes) return [];
    return planItemDependencyNodeIds(item).filter((nodeId) => !frameNodes.has(nodeId));
  };
  const reportedVanished = new Set<string>();
  const materializeIntoFrame = (
    item: RelationPlanItem,
    frameIndex: number,
    supersededAt?: PlanRelationRef
  ) => {
    const missing = vanishedAnchorIds(item, frameIndex);
    if (missing.length > 0) {
      const dedupeKey = [
        frameIndex,
        item.relationRef.stageIndex,
        item.relationRef.relationIndex,
        [...missing].sort().join(',')
      ].join('|');
      if (!reportedVanished.has(dedupeKey)) {
        reportedVanished.add(dedupeKey);
        diagnostics.push({
          stageIndex: frameIndex,
          relationIndex: item.relationRef.relationIndex,
          relation: item.relationRef.relation,
          kind: 'anchor-vanished',
          detail: `persistent mark from stage ${item.appearsAtStage + 1} is not drawn at stage `
            + `${frameIndex + 1}: anchored node(s) ${missing.join(', ')} no longer exist in this `
            + 'stage\'s forest; the mark keeps its earlier history and is never retargeted'
        });
      }
      return;
    }
    /*
     * Each frame owns its own item instance. Persistence used to push ONE
     * shared object into every licensed frame, so a later frame's
     * coalescing pass — which records contributing authored references on
     * the surviving item — leaked FUTURE references backward into earlier
     * frames through the shared object. A frame-local shallow copy makes
     * provenance frame-local: coalescing reassigns `coalescedRefs` on the
     * frame's own copy, and nested authored payloads stay shared read-only.
     *
     * Declared subtree-derived geometry refreshes from the CURRENT frame's
     * exact anchored root: a persistent Phase arc describes the domain as
     * it stands in the frame it draws in, never the authoring-stage
     * snapshot. The root itself is a dependency, so a vanished root fails
     * the mark closed above — this is refresh, never retargeting.
     */
    const frameLocal: RelationPlanItem = {
      ...item,
      ...(supersededAt ? { supersededAt } : {})
    };
    if (frameIndex > item.appearsAtStage && item.subtreeDerived) {
      const frameNodes = stageNodeMaps[frameIndex];
      item.subtreeDerived.forEach((declaration) => {
        const rootNode = frameNodes?.get(declaration.rootNodeId);
        (frameLocal as unknown as Record<string, unknown>)[declaration.field] =
          declaration.mode === 'authored-silent'
            ? collectAuthoredSilentSubtreeIds(rootNode)
            : collectSubtreeIds(rootNode);
      });
    }
    frames[frameIndex].items.push(frameLocal);
  };
  items.forEach((item) => {
    if (item.appearsAtStage >= stageCount) return;
    if (item.persistence === 'stage-only') {
      frames[item.appearsAtStage].items.push({ ...item });
      return;
    }
    if (item.persistence === 'replace-prior-stage') {
      for (let frameIndex = item.appearsAtStage; frameIndex < stageCount; frameIndex += 1) {
        const replacement = items.find((candidate) =>
          candidate.familyId === item.familyId
          && candidate.tier2FacetId === item.tier2FacetId
          && candidate.appearsAtStage > item.appearsAtStage
          && candidate.appearsAtStage <= frameIndex);
        if (replacement) {
          materializeIntoFrame(item, frameIndex, replacement.relationRef);
          break;
        }
        materializeIntoFrame(item, frameIndex);
      }
      return;
    }
    if (item.persistence === 'replace-previous-instance') {
      for (let frameIndex = item.appearsAtStage; frameIndex < stageCount; frameIndex += 1) {
        const replacement = items.find((candidate) =>
          candidate !== item
          && candidate.appearsAtStage > item.appearsAtStage
          && candidate.appearsAtStage <= frameIndex
          && (candidate.replacementGroup === item.replacementGroup
            || (Boolean(candidate.replacementPredecessorGroup)
              && candidate.replacementPredecessorGroup === item.replacementGroup)));
        if (replacement) {
          materializeIntoFrame(item, frameIndex, replacement.relationRef);
          break;
        }
        materializeIntoFrame(item, frameIndex);
      }
      return;
    }
    for (let frameIndex = item.appearsAtStage; frameIndex < stageCount; frameIndex += 1) {
      materializeIntoFrame(item, frameIndex);
    }
  });

  /*
   * Remnant paths depart from the footprint of the material vacated by that
   * movement, not from a nested object's earlier evacuation site. Derive that
   * footprint from the current frame's tree plus the other visible trajectory
   * sources. This remains renderer metadata: the model authors only the open
   * relation and its syntax-node anchors.
   */
  frames.forEach((frame, frameIndex) => {
    const nodes = stageNodeMaps[frameIndex];
    const trajectories = frame.items.filter(
      (item): item is TrajectoryPlanItem => item.kind === 'trajectory'
    );
    trajectories.forEach((trajectory) => {
      if (trajectory.trajectoryKind !== 'remnant') return;
      const sourceRoot = nodes?.get(trajectory.sourceNodeId);
      const sourceIds = new Set(collectSubtreeIds(sourceRoot));
      const nestedSources = trajectories
        .filter((candidate) => candidate !== trajectory)
        .map((candidate) => nodes?.get(candidate.sourceNodeId))
        .filter((candidate): candidate is SyntaxNode => Boolean(
          candidate?.id && sourceIds.has(String(candidate.id))
        ));
      trajectory.orthogonalDepartureNodeIds = collectRemnantDepartureLeafIds(
        sourceRoot,
        nestedSources
      );
    });
  });

  /*
   * Composition without semantic suppression. Babel never decides that two
   * authored linguistic claims are incompatible merely because they share a
   * visual channel: exactly identical marks are visually coalesced with every
   * contributing relation instance retained in `coalescedRefs`; distinct
   * marks all survive, and the geometry binder routes, offsets, or stacks
   * them apart. Replacement happens only through explicitly declared
   * replace-previous-instance family metadata, upstream of this pass.
   */
  /*
   * Two items may paint once only when they are the SAME COMPLETE semantic
   * claim: same registered render family and every meaning-bearing field —
   * anchors, antecedents, labels, values, outcomes, ghost/member sets, the
   * backward cue, all of it. Sharing a route or a site is not identity; an
   * ellipsis claim naming a different antecedent, or a coincident path from
   * a different family, is a distinct authored claim and must survive for
   * collision routing. The key is therefore the canonical serialization of
   * the whole item minus provenance bookkeeping (`relationRef`,
   * `coalescedRefs`) and the appearance stage — a persisted claim and an
   * identical later restatement still paint once in their co-visible frames.
   */
  const COALESCE_EXCLUDED_FIELDS = new Set([
    'relationRef',
    'composedRefs',
    'coalescedRefs',
    'appearsAtStage',
    'subtreeDerived',
    'positionNodeIds',
    'orthogonalDepartureNodeIds',
    'supersededAt'
  ]);
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((out, key) => {
          out[key] = canonicalize((value as Record<string, unknown>)[key]);
          return out;
        }, {});
    }
    return value;
  };
  const coalesceKeyOf = (item: RelationPlanItem): string => {
    if (item.canonicalClaimIdentity) {
      return JSON.stringify(canonicalize({
        canonicalClaimIdentity: item.canonicalClaimIdentity,
        renderPart: item.tier2RenderPart || 'main'
      }));
    }
    if ((item.tier2OutputIdentities || []).length > 0) {
      return JSON.stringify(canonicalize({
        tier2OutputIdentities: [...item.tier2OutputIdentities!].sort(),
        renderPart: item.tier2RenderPart || 'main'
      }));
    }
    const content: Record<string, unknown> = {};
    Object.entries(item).forEach(([field, value]) => {
      if (COALESCE_EXCLUDED_FIELDS.has(field)) return;
      content[field] = value;
    });
    /*
     * The authored claim itself is meaning-bearing even where a specialized
     * primitive copies none of it onto its own fields: the complete anchor
     * role/value structure, `priorAnchors`, and every authored value belong
     * to the key. Relation IDENTITY is the registered render family (already
     * part of the item content via `familyId`): two registered aliases of
     * one family making the otherwise-identical complete claim are one
     * claim, and either authored Replay moment can activate the one mark.
     * An UNREGISTERED relation has no registered family, so its normalized
     * authored name is its identity — open relations never collapse across
     * different authored names. Only the authored stage/relation coordinates
     * are provenance and stay excluded — a persisted claim and its identical
     * later restatement still paint once.
     */
    content.authoredClaim = {
      ...(item.familyId
        ? {}
        : { relation: String(item.relationRef.relation || '').trim() }),
      anchors: item.relationRef.anchors ?? {},
      priorAnchors: item.relationRef.priorAnchors ?? null,
      values: item.relationRef.values ?? null
    };
    return JSON.stringify(canonicalize(content));
  };
  frames.forEach((frame) => {
    const movementRoutes = new Set(frame.items.flatMap((item) => (
      item.kind === 'trajectory'
        ? [`${item.sourceNodeId}\u0000${item.targetNodeId}`]
        : []
    )));
    frame.items = frame.items.filter((item) => !(
      item.kind === 'directed-path'
      && item.pathStyle === 'blocked-extraction'
      && movementRoutes.has(`${item.fromNodeId}\u0000${item.toNodeId}`)
    ));
    frame.items.sort((left, right) => {
      const layer = LAYER_ORDER[left.kind] - LAYER_ORDER[right.kind];
      if (layer !== 0) return layer;
      if (
        left.canonicalClaimIdentity
        && left.canonicalClaimIdentity === right.canonicalClaimIdentity
      ) {
        const tier = (left.claimTier ?? 4) - (right.claimTier ?? 4);
        if (tier !== 0) return tier;
      }
      if (left.appearsAtStage !== right.appearsAtStage) {
        return left.appearsAtStage - right.appearsAtStage;
      }
      return left.relationRef.relationIndex - right.relationRef.relationIndex;
    });
    const coalescedItems: RelationPlanItem[] = [];
    const coalesceHolderIndices = new Map<string, number>();
    const mergeRelationRefs = (
      holder: RelationPlanItem,
      contributor: RelationPlanItem
    ) => {
      const holderRefs = planItemRelationRefs(holder);
      const additionalRefs = planItemRelationRefs(contributor).filter((ref) =>
        !holderRefs.some((existing) =>
          existing.stageIndex === ref.stageIndex
          && existing.relationIndex === ref.relationIndex));
      if (additionalRefs.length > 0) {
        holder.coalescedRefs = [...(holder.coalescedRefs || []), ...additionalRefs];
      }
    };
    frame.items.forEach((item) => {
      const key = coalesceKeyOf(item);
      const holderIndex = coalesceHolderIndices.get(key);
      if (holderIndex === undefined) {
        coalesceHolderIndices.set(key, coalescedItems.length);
        coalescedItems.push(item);
        return;
      }
      const holder = coalescedItems[holderIndex];
      if ((item.claimTier ?? 4) < (holder.claimTier ?? 4)) {
        mergeRelationRefs(item, holder);
        coalescedItems[holderIndex] = item;
        return;
      }
      mergeRelationRefs(holder, item);
    });
    frame.items = coalescedItems;
  });

  return {
    planVersion: 1,
    registryId: registry.registryId,
    registryVersion: registry.version,
    stageCount,
    frames,
    diagnostics,
    unregistered: Array.from(unregisteredCounts, ([relation, count]) => ({ relation, count }))
  };
};

/**
 * Replay-step timing: which of a frame's items are visible once
 * `introducedRelationCount` of the current stage's authored relations have
 * had their Replay relation moments. Items persisted from earlier stages are
 * always visible; a same-stage item appears only after its own relation's
 * moment — never merely because its anchors became visible during structural
 * microsteps. Pass `null` for the committed (non-replay) view, which shows
 * the complete frame.
 */
/**
 * Replay-step reveal by EXACT played identity. Playback may place relation
 * moments around structural construction in an order that differs from the
 * authored relation-array order, so a count of played moments is not an
 * identity; callers pass the set of authored relation indices whose moments
 * have actually played in this frame (null = the committed, non-animated
 * view). A coalesced mark reveals when any of its contributing authored
 * instances has played.
 */
export const visiblePlanFrameItems = (
  plan: RelationRenderPlan,
  frameIndex: number,
  playedRelationIndices: ReadonlySet<number> | null
): RelationPlanItem[] => {
  const frame = plan.frames[frameIndex];
  if (!frame) return [];
  if (playedRelationIndices === null) {
    return frame.items.filter((item) => !item.supersededAt);
  }
  return frame.items.filter((item) => {
    if (
      item.supersededAt?.stageIndex === frameIndex
      && playedRelationIndices.has(item.supersededAt.relationIndex)
    ) return false;
    return item.appearsAtStage < frameIndex
      || planItemRelationRefs(item).some((ref) =>
        ref.stageIndex === frameIndex && playedRelationIndices.has(ref.relationIndex));
  });
};

/** Whether this visible item represents the authored relation moment in focus. */
export const planItemOwnsRelationMoment = (
  item: RelationPlanItem,
  stageIndex: number,
  relationIndex: number
): boolean => planItemRelationRefs(item).some((ref) =>
  ref.stageIndex === stageIndex && ref.relationIndex === relationIndex);

export { LARGE_ANCHOR_ARRAY_THRESHOLD };
