import type { DerivationStage, SyntaxNode } from '../../types.ts';
import {
  findRelationRegistryEntry,
  productionRelationRegistry
} from '../../replay/relationDispatch/index.js';
import {
  MIN_CROSSING_SEPARATION,
  allocateSpanLanes,
  bindCrossingDependencyPath,
  containingEllipse,
  convexHull,
  edgeAt,
  ellipseContainsRect,
  enclosureRect,
  findBoundaryCrossings,
  findBoundaryExit,
  orientPathFromOrigin,
  orthogonalTrajectory,
  orthogonalTrajectoryPoints,
  isOrthogonalPath,
  planAnchorSetLayout,
  polygonArea,
  polygonContainsPoint,
  rectCorners,
  rectsOverlap,
  trajectoryControlY
} from './visual-relations-geometry.ts';

export {
  MIN_CROSSING_SEPARATION,
  allocateSpanLanes,
  bindCrossingDependencyPath,
  containingEllipse,
  convexHull,
  edgeAt,
  ellipseContainsRect,
  enclosureRect,
  findBoundaryCrossings,
  findBoundaryExit,
  orientPathFromOrigin,
  orthogonalTrajectory,
  orthogonalTrajectoryPoints,
  isOrthogonalPath,
  planAnchorSetLayout,
  polygonArea,
  polygonContainsPoint,
  rectCorners,
  rectsOverlap,
  trajectoryControlY
};
export type {
  AnchorSetBadge,
  AnchorSetLayout,
  AnchorSetLayoutInput,
  AnchorSetRail,
  Point,
  Rect
} from './visual-relations-geometry.ts';

type OpenRecord = Record<string, any>;

const INDEX_SEQUENCE = ['i', 'j', 'k', 'l', 'm', 'n', 'p'];

/**
 * The lab and production renderer share the same relation contract:
 * `relation`, `anchors`, and optional `values` and `priorAnchors` inside each
 * stage's `relations` array. `toRendererStages` preserves that contract.
 */
export type LabRelation = {
  relation: string;
  anchors: Record<string, string | string[]>;
  priorAnchors?: Record<string, string | string[]>;
  values?: Record<string, string | string[]>;
};

export type LabStage = {
  statement: string;
  stageRecord: string;
  relations: LabRelation[];
  workspaceForest: SyntaxNode[];
};

export type LabContractIssue = {
  stageIndex: number;
  relation: string;
  kind:
    | 'anchor_unresolved'
    | 'prior_anchor_unresolved'
    | 'prior_anchor_without_prior_stage'
    | 'anchor_blocks_empty'
    | 'value_type'
    | 'value_empty_array'
    | 'value_matches_node_id';
  detail: string;
};

/**
 * Recognized relation names, exact strings only. VR §3 permits case and
 * whitespace folding and nothing else: no regex, no substring matching, no
 * similarity. An unlisted name never matches, partially or otherwise.
 */
export const RECOGNIZED_RELATIONS = {
  trajectory: [
    'AbarMove', 'AMove', 'HeadMove', 'Lowering',
    'RemnantMovement', 'RollUpMovement', 'Scrambling', 'Smuggling',
    'AcrossTheBoardMovement', 'CyclicLinearization'
  ],
  operatorVariableBinding: ['OperatorVariableBinding'],
  parasiticGap: ['ParasiticGap'],
  splitAntecedence: ['SplitAntecedence'],
  identity: ['Identity'],
  control: ['Control'],
  predication: ['Predication'],
  pairMerge: ['PairMerge'],
  blockedExtraction: ['AdjunctInaccessibility', 'BlockedExtraction'],
  idiomChunk: ['IdiomChunkCointerpretation'],
  binding: ['Binding'],
  coreference: ['Coreference'],
  featureBundle: ['FeatureBundle'],
  agree: ['Agree'],
  multipleAgree: ['MultipleAgree'],
  cyclicAgree: ['CyclicAgree'],
  featureSharing: ['FeatureSharing'],
  caseAssignment: ['CaseAssignment'],
  dependentCase: ['DependentCase'],
  boundingNodeCrossing: ['BoundingNodeCrossing'],
  phase: ['Phase'],
  transferDomain: ['TransferDomain'],
  postTransferAccess: ['PostTransferAccess'],
  antiLocality: ['AntiLocality'],
  improperMovement: ['ImproperMovement'],
  ellipsis: ['Ellipsis', 'EllipsisRecoverability'],
  ellipsisDeletion: ['EllipsisDeletion'],
  multiplePronunciation: ['MultiplePronunciation', 'CopyOccurrence'],
  partialCopyDeletion: ['PartialCopyDeletion'],
  multidominance: ['Multidominance'],
  argumentSharing: ['ArgumentSharing'],
  pfRealization: ['PFRealization'],
  vocabularyInsertion: ['VocabularyInsertion'],
  phrasalSpellOut: ['PhrasalSpellOut'],
  pfCorrespondence: ['ManyToManyCorrespondence'],
  fission: ['Fission'],
  impoverishment: ['Impoverishment'],
  localDislocation: ['LocalDislocation'],
  cyclicLinearization: ['CyclicLinearization'],
  quantifierRaising: ['QuantifierRaising'],
  reconstruction: ['LFReconstruction'],
  focusMarking: ['FocusMarking'],
  cooperStorage: ['CooperStorage'],
  accord: ['Accord'],
  strongNpiLicensing: ['StrongNPILicensing'],
  fProjection: ['FProjection'],
  theta: ['ThetaAssignment'],
  intervention: ['Intervention']
} as const;

/**
 * Active relation designs, keyed by the complete drawing rather than by
 * relation name. These are not atomic visual primitives: one design may
 * compose several primitives and configure their geometry differently.
 *
 * A relation can license more than one drawing through different generic anchor
 * shapes. Coverage is measured per design, not per relation name.
 */
export const ACTIVE_VISUAL_DESIGNS: Record<
  string,
  { label: string; relations: string[] }
> = {
  phrasalTrajectory: {
    label: 'Phrasal trajectory',
    /*
     * Ordinary movement of a phrase, drawn as the sweeping curve. Scrambling
     * belongs here: the evacuation step of a remnant derivation is movement of
     * an ordinary DP, and only the step the figure calls remnant movement gets
     * the bracket and the enclosure.
     */
    relations: ['AbarMove', 'AMove', 'Scrambling']
  },
  /*
   * Both relations use the directed-path primitive with terminal endpoint
   * geometry. `HeadMove` normally points upward; head-sized `Lowering` points
   * downward. Phrase-to-phrase Lowering is reclassified from its anchored
   * topology and takes phrasal endpoint rules.
   */
  headTrajectory: {
    label: 'Head-sized terminal trajectory',
    relations: ['HeadMove', 'Lowering']
  },
  occurrenceIdentity: { label: 'Occurrence identity pool', relations: ['Identity'] },
  controlDependency: { label: 'Control dependency and domain', relations: ['Control'] },
  predicationDependency: {
    label: 'Dotted predicand-predicate paths',
    relations: ['Predication']
  },
  pairMergeFork: {
    label: 'Dotted Pair-Merge fork',
    relations: ['PairMerge']
  },
  blockedAdjunctExtraction: {
    label: 'Transferred adjunct and blocked extraction',
    relations: ['AdjunctInaccessibility', 'BlockedExtraction']
  },
  idiomChunkDomain: {
    label: 'Underlined idiom chunks and interpretation bracket',
    relations: ['IdiomChunkCointerpretation']
  },
  bindingDomain: { label: 'Binding domain and coindex', relations: ['Binding'] },
  plainCoindex: { label: 'Plain coindex', relations: ['Coreference'] },
  operatorVariableComposition: {
    label: 'Nested scope domains, binding paths, and shared indices',
    relations: ['OperatorVariableBinding']
  },
  parasiticGapCoindex: {
    label: 'Filler and gap coindexation',
    relations: ['ParasiticGap']
  },
  convergentTrajectory: {
    label: 'Convergent movement trajectories',
    relations: ['AcrossTheBoardMovement']
  },
  crossWorkspaceTrajectory: {
    label: 'Cross-workspace movement trajectory',
    relations: ['SidewardMovement']
  },
  featurePlaque: {
    label: 'Node-attached feature plaque',
    relations: ['Agree', 'FeatureBundle', 'CaseAssignment']
  },
  multipleAgreeFanout: {
    label: 'Directed one-probe fan-out',
    relations: ['MultipleAgree']
  },
  cyclicAgreePaths: {
    label: 'Ordered numbered probing paths',
    relations: ['CyclicAgree']
  },
  featureSharingVines: {
    label: 'Undirected shared-feature vines',
    relations: ['FeatureSharing']
  },
  caseAssignmentPath: {
    label: 'Solid Case path with dotted feature collection',
    relations: ['CaseAssignment']
  },
  dependentCaseElbow: {
    label: 'Circular-ended dependent-Case elbow',
    relations: ['DependentCase']
  },
  boundingNodeCuts: { label: 'Bounding-node cuts', relations: ['BoundingNodeCrossing'] },
  phaseArc: {
    label: 'Phase domain arc',
    relations: ['Phase', 'TransferDomain', 'PostTransferAccess']
  },
  transferPicComposition: {
    label: 'Phase, edge, transferred complement and blocked access',
    relations: ['TransferDomain', 'PostTransferAccess']
  },
  antiLocalityComparison: {
    label: 'Matched too-short and licensed movement paths',
    relations: ['AntiLocality']
  },
  improperLandingDomain: {
    label: 'Forbidden landing region and movement candidates',
    relations: ['ImproperMovement']
  },
  ellipsisGhost: {
    label: 'Ellipsis ghosting',
    relations: ['Ellipsis', 'EllipsisRecoverability']
  },
  partialCopyDeletionComposition: {
    label: 'Independently authored copy enclosure plus selective PF strike',
    relations: ['CopyOccurrence', 'PartialCopyDeletion']
  },
  sharedNode: { label: 'Shared-node overlay', relations: ['Multidominance'] },
  argumentSharingDomains: {
    label: 'Overlapping predicate domains with shared-object badge',
    relations: ['ArgumentSharing']
  },
  realizationPlate: { label: 'PF realization plate', relations: ['PFRealization'] },
  cyclicLinearizationLedger: {
    label: 'Movement trajectory plus cyclic ordering ledger',
    relations: ['CyclicLinearization']
  },
  covertTrajectory: {
    label: 'Covert scope trajectory',
    relations: ['QuantifierRaising']
  },
  lfInterpretation: {
    label: 'LF interpretation marking',
    relations: ['LFReconstruction']
  },
  focusProminence: { label: 'Focus branch prominence', relations: ['FocusMarking'] },
  thetaGrid: { label: 'Theta grid', relations: ['ThetaAssignment'] },
  blockedPath: { label: 'Blocked-path diagnostic', relations: ['Intervention'] },
  /*
   * Two drawings, each genuinely shared. Grouping is by drawing, as everywhere
   * else in this registry: the rectangle is one mark used at opposite ends of a
   * chain, and the bracket is one geometry used by the three movement types
   * whose sources draw it that way. Their *licensing* stays distinct in the
   * lens — a remnant landing and a carrier chunk are different claims — which is
   * what must not be flattened.
   *
   * Scrambling is deliberately absent from both. Listing it here would say the
   * evacuation and the fronting are drawn alike, which is the reading the
   * remnant card exists to rule out.
   */
  constituentEnclosure: {
    label: 'Constituent enclosure',
    relations: ['RemnantMovement', 'Smuggling']
  },
  orthogonalBracket: {
    label: 'Orthogonal movement bracket',
    relations: ['RollUpMovement', 'RemnantMovement', 'Smuggling']
  }
};

/**
 * Source-backed first contexts that are drawn in the Lab but have not passed
 * the two-context generalization gate. Keeping them out of
 * `ACTIVE_VISUAL_DESIGNS` is intentional: a successful first card licenses a
 * concrete recipe, not a frozen dispatcher family.
 */
export const SOURCE_BACKED_UNFROZEN_DESIGNS: Record<
  string,
  { label: string; relations: string[] }
> = {
  phrasalSpellOutLabel: {
    label: 'Phrase-shell spell-out label',
    relations: ['PhrasalSpellOut']
  },
  manyToManyPfCorrespondence: {
    label: 'Node-anchored PF correspondence plate',
    relations: ['ManyToManyCorrespondence']
  },
  fissionFeatureSplit: {
    label: 'One feature bundle split into two output bundles',
    relations: ['Fission']
  },
  impoverishmentDelinking: {
    label: 'Feature geometry with one delinked dependency',
    relations: ['Impoverishment']
  },
  localDislocationLane: {
    label: 'Before-and-after PF adjacency lane',
    relations: ['LocalDislocation']
  },
  cooperStorageLedger: {
    label: 'Staged qstore and retrieval plaques',
    relations: ['CooperStorage']
  },
  negativeConcordAccord: {
    label: 'Indexed polarity features plus directed Accord connector',
    relations: ['Accord']
  },
  strongNpiPathContainment: {
    label: 'Nested Exhaustifier and focus-association dependencies',
    relations: ['StrongNPILicensing']
  },
  fProjectionPropagation: {
    label: 'Accent mark and upward F-projection paths',
    relations: ['FProjection']
  },
  splitAntecedenceIndices: {
    label: 'Separate antecedent indices summed on one dependent',
    relations: ['SplitAntecedence']
  },
  gappingAlignmentPlate: {
    label: 'Predicate and ordered correlate-remnant correspondences',
    relations: ['GappingAlignment']
  },
  parasiticIslandPathStatus: {
    label: 'Primary and secondary path nodes with blocked-edge status',
    relations: ['ParasiticGap']
  },
  sluicingComposition: {
    label: 'Wh movement and ellipsis ghosting as explicit claims',
    relations: ['AbarMove', 'Ellipsis']
  }
};

/**
 * Which drawing a trajectory relation gets, and which anchor roles are its two
 * endpoints. Production draws none of these today: the compiler purge removed
 * the inference that used to, and the authored-relation renderers are not built
 * yet, so the lab draws its own.
 */
const TRAJECTORY_KINDS: Record<string, string> = {
  abarmove: 'phrasal',
  /*
   * A-movement is phrasal movement too: same drawing, same shell endpoints and
   * same witness requirement. It gets its own exact name because raising to
   * subject is not an A-bar dependency, and naming it `AbarMove` would put a
   * false claim in the record for the sake of reusing a renderer.
   */
  amove: 'phrasal',
  headmove: 'head',
  lowering: 'lowering',
  /*
   * Three phrasal movements whose sources draw them differently. Remnant
   * movement is an ordinary phrasal step whose landing is boxed; roll-up and
   * smuggling are drawn with the orthogonal bracket their figures use, and
   * smuggling's is the heavier stroke Belletti gives the carrier.
   */
  remnantmovement: 'remnant',
  rollupmovement: 'roll-up',
  /*
   * The evacuation step of a remnant derivation is ordinary phrasal movement of
   * a DP, and it is drawn that way. Only the step the figure calls remnant
   * movement gets the remnant's own bracket and enclosure; giving both the same
   * mark would say the two operations are the same kind of thing, which is
   * exactly what the derivation is about denying.
   */
  scrambling: 'phrasal',
  smuggling: 'smuggling',
  identity: 'phrasal',
  boundingnodecrossing: 'phrasal',
  impropermovement: 'phrasal',
  ellipsislicensing: 'phrasal',
  thetaassignment: 'phrasal',
  intervention: 'phrasal',
  orderedcasestacking: 'phrasal',
  acrosstheboardmovement: 'atb',
  parasiticgap: 'parasitic-gap',
  remnantescape: 'phrasal',
  cycliclinearization: 'phrasal'
};

const TRAJECTORY_FROM_ROLES = ['lowerCopy', 'source', 'variable', 'realGap', 'from'];

/**
 * A phrasal trajectory is structurally a relation between phrase occurrences,
 * but its visible departure is the trace terminal inside the source occurrence.
 * The relation therefore names both the source phrase and the exact witness the
 * curve leaves. Its landing remains the target phrase shell.
 *
 * This fails closed. A phrasal or A-bar trajectory without a resolvable authored
 * witness draws nothing at all, because falling back to the source phrase's shell
 * would silently draw the wrong endpoint. Head movement and head-sized lowering
 * relate heads directly and need no separate witness.
 */
const TRAJECTORY_WITNESS_ROLES = ['traceWitness', 'lowerWitness'];

/** Trajectory kinds whose geometry requires an explicit authored trace witness. */
const WITNESS_REQUIRED_KINDS = new Set([
  'phrasal', 'phrasal-lowering', 'remnant', 'roll-up',
  'scrambling', 'smuggling', 'atb', 'sideward', 'parasitic-gap'
]);

/** Which drawing family an exact relation name dispatches to. */
export const trajectoryKindForRelation = (relation: string): string =>
  TRAJECTORY_KINDS[foldRelationName(relation)] || 'phrasal';

export const trajectoryRequiresWitness = (kind: string): boolean =>
  WITNESS_REQUIRED_KINDS.has(kind);

/**
 * Kinds whose landing endpoint meets the phrase shell rather than a word.
 * Operator-variable binding is deliberately absent: the current source-backed
 * Semantic operator-variable binding is compiled by its own production
 * family and never enters this movement endpoint classification.
 */
const SHELL_ANCHORED_KINDS = new Set([
  'phrasal', 'phrasal-lowering', 'remnant', 'roll-up',
  'scrambling', 'smuggling', 'atb', 'sideward', 'parasitic-gap'
]);

export const trajectoryMeetsPhraseShell = (kind: string): boolean =>
  SHELL_ANCHORED_KINDS.has(kind);

/** Kinds the sources draw with axis-aligned segments rather than a curve. */
const ORTHOGONAL_KINDS = new Set(['remnant', 'roll-up', 'smuggling']);

export const trajectoryIsOrthogonal = (kind: string): boolean =>
  ORTHOGONAL_KINDS.has(kind);

/*
 * Two orthogonal lane policies, read off the sources. Shlonsky's roll-up paths
 * leave sideways at the occurrence's own level and then rise — no initial
 * downward leg, and nothing sits in their way because each lane runs through
 * the gap its own movement opened. Everything else routes below the drawn
 * tree: Bošković aligns the remnant's rise through the empty margin under the
 * boxed landing, and Belletti's thick carrier runs under the whole structure.
 * Crossing branches with a straight lane is not an option the sources use.
 */
const ACROSS_THEN_UP_KINDS = new Set(['roll-up']);

export const trajectoryRunsAcrossThenUp = (kind: string): boolean =>
  ACROSS_THEN_UP_KINDS.has(kind);

export type WitnessResolution =
  | { ok: true; witnessId: string }
  | { ok: false; reason: string };

/**
 * Resolve the trace witness a phrasal trajectory leaves from.
 *
 * The witness has to be one unambiguous node that the authored lower copy
 * actually contains, so the drawing cannot silently start somewhere the
 * analysis never pointed at. Arrays, missing roles, unresolvable ids and nodes
 * outside the lower copy are all refused rather than repaired.
 */
export const resolveTraceWitness = (
  anchors: Record<string, string | string[]> | undefined,
  lowerCopyId: string,
  lowerCopySubtreeIds: readonly string[]
): WitnessResolution => {
  const roles = TRAJECTORY_WITNESS_ROLES.filter((role) => anchors?.[role] !== undefined);
  if (roles.length === 0) return { ok: false, reason: 'no authored trace witness' };
  if (roles.length > 1) return { ok: false, reason: 'more than one witness role authored' };

  const raw = anchors?.[roles[0]];
  if (Array.isArray(raw)) return { ok: false, reason: 'trace witness must be a single node, not an array' };
  const witnessId = String(raw ?? '').trim();
  if (!witnessId) return { ok: false, reason: 'trace witness is empty' };
  if (!lowerCopyId) return { ok: false, reason: 'no authored lower copy to contain the witness' };
  /*
   * An empty subtree means the authored lower copy itself does not resolve in
   * the tree. Accepting the witness on its own here would let a drawing start
   * from a node the analysis never placed.
   */
  if (lowerCopySubtreeIds.length === 0) {
    return { ok: false, reason: 'the authored lower copy does not resolve in the tree' };
  }
  if (!lowerCopySubtreeIds.includes(witnessId)) {
    return { ok: false, reason: 'trace witness is not the lower copy or inside it' };
  }
  return { ok: true, witnessId };
};
const TRAJECTORY_TO_ROLES = [
  'pronouncedCopy', 'higherCopy', 'target', 'operator', 'filler', 'remnant', 'landing', 'to'
];

const foldRelationName = (value: string): string => String(value ?? '').trim().toLowerCase();

const walkTree = (root: SyntaxNode, visit: (node: SyntaxNode) => void) => {
  visit(root);
  (Array.isArray(root.children) ? root.children : []).forEach((child) => walkTree(child, visit));
};

/**
 * Silent terminal witnesses that belong to a remnant's vacated source.
 *
 * A prior evacuation can leave its own lower source inside the remnant source.
 * That nested subtree is a different chain and must not pull the remnant
 * bracket toward it. The selection is structural, so it works without fixed
 * categories, node ids, words, or lineage names.
 */
export const remnantDepartureTraceIds = (
  root: SyntaxNode,
  nestedTrajectorySources: SyntaxNode[] = []
): string[] => {
  const rootIds = new Set<string>();
  walkTree(root, (node) => {
    if (node.id) rootIds.add(node.id);
  });

  const excludedIds = new Set<string>();
  nestedTrajectorySources
    .filter((source) => source.id && rootIds.has(source.id))
    .forEach((source) => walkTree(source, (node) => {
      if (node.id) excludedIds.add(node.id);
    }));

  const traces: string[] = [];
  walkTree(root, (node) => {
    if ((node.children || []).length > 0 || node.silent !== true || node.label === '∅') return;
    if (node.id && !excludedIds.has(node.id)) traces.push(node.id);
  });
  return traces;
};

const collectNodes = (forest: SyntaxNode[]): Map<string, SyntaxNode> => {
  const nodes = new Map<string, SyntaxNode>();
  forest.forEach((root) => walkTree(root, (node) => {
    const id = String(node.id || '').trim();
    if (id) nodes.set(id, node);
  }));
  return nodes;
};

const collectSubtreeIds = (node?: SyntaxNode): string[] => {
  if (!node) return [];
  const ids: string[] = [];
  walkTree(node, (current) => {
    const id = String(current.id || '').trim();
    if (id) ids.push(id);
  });
  return ids;
};

const collectSubtreeLeafIds = (node?: SyntaxNode): string[] => {
  if (!node) return [];
  const ids: string[] = [];
  walkTree(node, (current) => {
    if (Array.isArray(current.children) && current.children.length > 0) return;
    const id = String(current.id || '').trim();
    if (id) ids.push(id);
  });
  return ids;
};

const flattenAnchorIds = (value: string | string[] | undefined): string[] =>
  (Array.isArray(value) ? value : [value])
    .map((item) => String(item || '').trim())
    .filter(Boolean);

const getStageForest = (stages: LabStage[], fallbackTree: SyntaxNode): SyntaxNode[] => {
  const finalStage = stages[stages.length - 1];
  return Array.isArray(finalStage?.workspaceForest) && finalStage.workspaceForest.length > 0
    ? finalStage.workspaceForest
    : [fallbackTree];
};

const getStageRelations = (stage: LabStage): LabRelation[] =>
  Array.isArray(stage?.relations) ? stage.relations : [];

const getRelations = (stages: LabStage[]): LabRelation[] =>
  stages.flatMap(getStageRelations);

/**
 * Exact-match dispatch. Returns every matching instance, not just the first:
 * a stage may author the same relation more than once, and silently rendering
 * one of them is the defect this replaces.
 */
export const matchRelations = (stages: LabStage[], names: readonly string[]): LabRelation[] => {
  const wanted = new Set(names.map(foldRelationName));
  return getRelations(stages).filter((relation) => wanted.has(foldRelationName(relation.relation)));
};

/** Authored names that no active entry claims. */
export const unregisteredRelationNames = (stages: LabStage[]): string[] => {
  const unregistered = new Set<string>();
  getRelations(stages).forEach((relation) => {
    const authoredName = String(relation.relation);
    if (!findRelationRegistryEntry(productionRelationRegistry, authoredName)) {
      unregistered.add(authoredName);
    }
  });
  return Array.from(unregistered).sort();
};

/**
 * Large authored anchor arrays: the deterministic Lab layout policy.
 *
 * A model may author a relation whose anchor role carries an unusually long
 * array — a deep chain, a many-parent sharing structure, a many-controller
 * dependency. The lens shapes above are sized to their sources and would
 * degrade at that scale, so any role whose array reaches
 * `LARGE_ANCHOR_ARRAY_THRESHOLD` compiles to an ordered anchor-set plan
 * instead of being truncated, first-element-sampled, or overwritten.
 *
 * The plan preserves exactly what was authored: relation-instance order within
 * the stage, role order within the relation, and array order within the role.
 * Repeated instances of one relation in one stage each get their own set.
 * Anchors are resolved against their own stage's forest; an anchor that does
 * not resolve is kept in the plan marked unresolved and reported as a contract
 * diagnostic — its mark fails closed rather than guessing an endpoint. No
 * semantics are inferred from the relation name and no semantic connector is
 * drawn for an open relation merely because its array is large: the rendered
 * marks are ordered participation badges and organizational role rails only.
 */
export const LARGE_ANCHOR_ARRAY_THRESHOLD = 5;

/**
 * Role arrays an active source-backed design already renders in full, keyed by
 * exact folded relation name. The Phillips island composition draws every node
 * of both paths with the sourced circle/square convention, so the general
 * anchor-set plan stepping in as well would double-mark the same nodes. Exact
 * names only, per VR §3 — this is a registry, not an inference.
 */
const ANCHOR_SET_EXEMPT_ROLES: Record<string, readonly string[]> = {
  parasiticgap: ['primaryPath', 'secondaryPath']
};

export type LargeAnchorSet = {
  relation: string;
  stageIndex: number;
  /** Exact authored relation position within the stage. */
  relationIndex: number;
  /** Order of this instance among same-named relations in its stage. */
  instanceIndex: number;
  roles: Array<{
    role: string;
    /** Order of the role within the authored anchors object. */
    roleIndex: number;
    /** Whether this role's array met the threshold. */
    large: boolean;
    anchors: Array<{ nodeId: string; arrayIndex: number; resolved: boolean }>;
  }>;
};

export const compileLargeAnchorSets = (
  stages: LabStage[],
  fallbackTree: SyntaxNode
): { sets: LargeAnchorSet[]; diagnostics: string[] } => {
  const sets: LargeAnchorSet[] = [];
  const diagnostics: string[] = [];

  stages.forEach((stageEntry, stageIndex) => {
    const forest = Array.isArray(stageEntry.workspaceForest) && stageEntry.workspaceForest.length > 0
      ? stageEntry.workspaceForest
      : [fallbackTree];
    const stageNodes = collectNodes(forest);
    const instanceCounts = new Map<string, number>();

    getStageRelations(stageEntry).forEach((relation, relationIndex) => {
      const folded = foldRelationName(relation.relation);
      const instanceIndex = instanceCounts.get(folded) ?? 0;
      instanceCounts.set(folded, instanceIndex + 1);

      const exemptRoles = ANCHOR_SET_EXEMPT_ROLES[folded] || [];
      const roles = Object.entries(relation.anchors || {}).map(([role, value], roleIndex) => {
        const ids = flattenAnchorIds(value);
        const large = ids.length >= LARGE_ANCHOR_ARRAY_THRESHOLD
          && !exemptRoles.includes(role);
        return {
          role,
          roleIndex,
          large,
          anchors: ids.map((nodeId, arrayIndex) => ({
            nodeId,
            arrayIndex,
            resolved: stageNodes.has(nodeId)
          }))
        };
      });

      if (!roles.some((roleGroup) => roleGroup.large)) return;
      roles.forEach((roleGroup) => {
        if (!roleGroup.large) return;
        roleGroup.anchors.forEach((anchor) => {
          if (anchor.resolved) return;
          diagnostics.push(
            `${relation.relation}: ${roleGroup.role}[${anchor.arrayIndex}] -> ${anchor.nodeId} `
            + `does not resolve in stage ${stageIndex}; its mark fails closed`
          );
        });
      });
      sets.push({ relation: relation.relation, stageIndex, relationIndex, instanceIndex, roles });
    });
  });

  return { sets, diagnostics };
};

/** Maps lab stages down to the shape the production TreeVisualizer consumes. */
export const toRendererStages = (stages: LabStage[]): DerivationStage[] =>
  stages.map((stage) => ({
    statement: stage.statement,
    stageRecord: stage.stageRecord,
    relations: getStageRelations(stage).map((relation) => ({
      relation: relation.relation,
      anchors: relation.anchors,
      ...(relation.priorAnchors ? { priorAnchors: relation.priorAnchors } : {}),
      ...(relation.values ? { values: relation.values } : {})
    })),
    workspaceForest: stage.workspaceForest
  }));

const sharedLineageKey = (nodes: Map<string, SyntaxNode>, ids: string[]): string => {
  const lineageSets = ids.map((id) => {
    const lineages = new Set<string>();
    const node = nodes.get(id);
    if (node) walkTree(node, (current) => {
      const lineageId = String(current.lineageId || '').trim();
      if (lineageId) lineages.add(lineageId);
    });
    return lineages;
  });
  if (lineageSets.length === 0) return '';
  return Array.from(lineageSets[0])
    .filter((lineageId) => lineageSets.every((set) => set.has(lineageId)))
    .sort()
    .join('|');
};

/**
 * Anchor-resolution check, per stage rather than against the final forest:
 * `anchors` resolve in their own stage, `priorAnchors` in the immediately
 * preceding one.
 */
export const validateCurrentStageRelationAnchors = (
  stages: LabStage[],
  fallbackTree: SyntaxNode
) => {
  const invalid: Array<{ relation: string; role: string; value: string }> = [];
  stages.forEach((stage, stageIndex) => {
    const forest = Array.isArray(stage.workspaceForest) && stage.workspaceForest.length > 0
      ? stage.workspaceForest
      : [fallbackTree];
    const nodes = collectNodes(forest);
    const priorStage = stages[stageIndex - 1];
    const priorNodes = priorStage
      ? collectNodes(
          Array.isArray(priorStage.workspaceForest) && priorStage.workspaceForest.length > 0
            ? priorStage.workspaceForest
            : [fallbackTree]
        )
      : new Map<string, SyntaxNode>();

    getStageRelations(stage).forEach((relation) => {
      Object.entries(relation.anchors || {}).forEach(([role, value]) => {
        flattenAnchorIds(value).forEach((nodeId) => {
          if (!nodes.has(nodeId)) invalid.push({ relation: relation.relation, role, value: nodeId });
        });
      });
      Object.entries(relation.priorAnchors || {}).forEach(([role, value]) => {
        flattenAnchorIds(value).forEach((nodeId) => {
          if (!priorNodes.has(nodeId)) invalid.push({ relation: relation.relation, role, value: nodeId });
        });
      });
    });
  });
  return { valid: invalid.length === 0, invalid };
};

/**
 * Full contract check: anchor resolution plus the strict `values` rules and the
 * `priorAnchors` stage rule.
 */
export const validateLabRelations = (
  stages: LabStage[],
  fallbackTree: SyntaxNode
): { valid: boolean; issues: LabContractIssue[] } => {
  const issues: LabContractIssue[] = [];
  const allNodeIds = new Set<string>();
  stages.forEach((stage) => {
    const forest = Array.isArray(stage.workspaceForest) && stage.workspaceForest.length > 0
      ? stage.workspaceForest
      : [fallbackTree];
    collectNodes(forest).forEach((_node, id) => allNodeIds.add(id));
  });

  stages.forEach((stage, stageIndex) => {
    const forest = Array.isArray(stage.workspaceForest) && stage.workspaceForest.length > 0
      ? stage.workspaceForest
      : [fallbackTree];
    const nodes = collectNodes(forest);
    const priorStage = stages[stageIndex - 1];
    const priorNodes = priorStage
      ? collectNodes(
          Array.isArray(priorStage.workspaceForest) && priorStage.workspaceForest.length > 0
            ? priorStage.workspaceForest
            : [fallbackTree]
        )
      : null;

    getStageRelations(stage).forEach((relation) => {
      const anchorRoles = Object.keys(relation.anchors || {});
      const priorRoles = Object.keys(relation.priorAnchors || {});
      if (anchorRoles.length === 0 && priorRoles.length === 0) {
        issues.push({
          stageIndex,
          relation: relation.relation,
          kind: 'anchor_blocks_empty',
          detail: 'at least one of anchors or priorAnchors must be non-empty'
        });
      }

      Object.entries(relation.anchors || {}).forEach(([role, value]) => {
        flattenAnchorIds(value).forEach((nodeId) => {
          if (!nodes.has(nodeId)) {
            issues.push({
              stageIndex,
              relation: relation.relation,
              kind: 'anchor_unresolved',
              detail: `${role} -> ${nodeId}`
            });
          }
        });
      });

      if (priorRoles.length > 0 && !priorStage) {
        issues.push({
          stageIndex,
          relation: relation.relation,
          kind: 'prior_anchor_without_prior_stage',
          detail: 'priorAnchors is meaningful only at stage index >= 1'
        });
      }
      Object.entries(relation.priorAnchors || {}).forEach(([role, value]) => {
        flattenAnchorIds(value).forEach((nodeId) => {
          if (priorNodes && !priorNodes.has(nodeId)) {
            issues.push({
              stageIndex,
              relation: relation.relation,
              kind: 'prior_anchor_unresolved',
              detail: `${role} -> ${nodeId}`
            });
          }
        });
      });

      Object.entries(relation.values || {}).forEach(([key, value]) => {
        const entries = Array.isArray(value) ? value : [value];
        if (Array.isArray(value) && value.length === 0) {
          issues.push({
            stageIndex,
            relation: relation.relation,
            kind: 'value_empty_array',
            detail: key
          });
          return;
        }
        entries.forEach((entry) => {
          if (typeof entry !== 'string') {
            issues.push({
              stageIndex,
              relation: relation.relation,
              kind: 'value_type',
              detail: `${key} received ${entry === null ? 'null' : typeof entry}`
            });
            return;
          }
          if (allNodeIds.has(entry)) {
            issues.push({
              stageIndex,
              relation: relation.relation,
              kind: 'value_matches_node_id',
              detail: `${key} -> ${entry}`
            });
          }
        });
      });
    });
  });

  return { valid: issues.length === 0, issues };
};

export const deriveLineageDisplayIndices = (
  stages: LabStage[],
  fallbackTree: SyntaxNode
): Record<string, string> => {
  const forest = getStageForest(stages, fallbackTree);
  const nodes = collectNodes(forest);
  const indices: Record<string, string> = {};
  const indexByLineage = new Map<string, string>();
  let nextIndex = 0;

  getRelations(stages).forEach((relation) => {
    const ids = Object.values(relation.anchors || {}).flatMap(flattenAnchorIds);
    const relationLineage = sharedLineageKey(nodes, ids);
    const key = relationLineage || `relation:${relation.relation}:${ids.join('|')}`;
    if (!indexByLineage.has(key)) {
      indexByLineage.set(key, INDEX_SEQUENCE[nextIndex] || String(nextIndex + 1));
      nextIndex += 1;
    }
    const index = indexByLineage.get(key)!;
    ids.forEach((id) => { indices[id] = index; });
  });

  return indices;
};

/** Verbatim `values` rows. Literals are displayed as authored, never parsed. */
const valueRows = (values?: Record<string, string | string[]>) =>
  Object.entries(values || {}).flatMap(([label, value]) =>
    (Array.isArray(value) ? value : [value]).map((entry) => ({ label, value: entry })));

export const hydrateLabLensFromCurrentContract = (
  stages: LabStage[],
  fallbackTree: SyntaxNode,
  fallbackLens?: OpenRecord
): OpenRecord | undefined => {
  const relations = getRelations(stages);
  if (!fallbackLens && relations.length === 0) return undefined;
  const forest = getStageForest(stages, fallbackTree);
  const nodes = collectNodes(forest);
  const indices = deriveLineageDisplayIndices(stages, fallbackTree);
  const diagnostics: string[] = [];
  const lens: OpenRecord = fallbackLens ? { ...fallbackLens } : {
    label: 'Relation lens',
    defaultActive: true,
    nodes: []
  };
  const trajectoryIsExplicitlyConfigured = Boolean(fallbackLens)
    && Object.prototype.hasOwnProperty.call(fallbackLens, 'trajectory');

  /** Singular lens shapes carry one instance; extras are reported, never dropped in silence. */
  const single = (matches: LabRelation[], entry: string): LabRelation | undefined => {
    if (matches.length > 1) {
      diagnostics.push(`${entry}: ${matches.length} instances authored, lens shape renders the first`);
    }
    return matches[0];
  };

  /** Verbatim authored `values` readers, shared by every relation branch below. */
  const scalarValue = (
    relation: LabRelation,
    key: string,
    fallback = ''
  ): string => {
    const value = relation.values?.[key];
    return String(Array.isArray(value) ? value[0] || fallback : value || fallback);
  };

  const listValue = (relation: LabRelation, key: string): string[] => {
    const value = relation.values?.[key];
    return (Array.isArray(value) ? value : [value])
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  };

  /**
   * Movement paths. Every authored trajectory becomes one drawing; the endpoint
   * roles are read from the relation rather than assumed by position.
   */
  /*
   * Chain numbers, shared by every relation that names a chain. Movement takes
   * its number here; an Identity family with no path takes the same number for
   * the same lineage, so the two Identity cards read alike.
   */
  const chainNumbers = new Map<string, number>();
  const chainNumberFor = (ids: string[], scope: Map<string, SyntaxNode> = nodes): string => {
    const key = sharedLineageKey(scope, ids) || ids.join('|');
    if (!chainNumbers.has(key)) chainNumbers.set(key, chainNumbers.size + 1);
    return String(chainNumbers.get(key));
  };

  /* Exact authored identity for stage-scoped and relation-moment drawings. */
  const relationStageIndex = new Map<LabRelation, number>();
  const authoredRelationIndex = new Map<LabRelation, number>();
  stages.forEach((stageEntry, stageIndex) => {
    getStageRelations(stageEntry).forEach((relation, relationIndexInStage) => {
      relationStageIndex.set(relation, stageIndex);
      authoredRelationIndex.set(relation, relationIndexInStage);
    });
  });

  const trajectories = matchRelations(stages, RECOGNIZED_RELATIONS.trajectory);
  if (trajectories.length > 0 && !trajectoryIsExplicitlyConfigured) {
    const endpoint = (relation: LabRelation, roles: string[]): string => {
      const role = roles.find((candidate) => flattenAnchorIds(relation.anchors?.[candidate]).length > 0);
      return role ? flattenAnchorIds(relation.anchors[role])[0] : '';
    };
    /**
     * Two different index conventions, and they are not interchangeable.
     * Movement leaves a trace, and a trace carries a numbered subscript, one
     * number per chain. Operator-variable binding is not movement: it uses the
     * letter index of variable binding on both ends. Lowering leaves no trace,
     * so it carries no index at all.
     */
    /*
     * Anchors resolve against the stage that authored them.
     *
     * A card whose stages carry their own trees can name a node that only
     * exists in one of them — an occurrence a later step removes. Judging every
     * relation against the last stage's forest would silently drop the earlier
     * step's drawing, so each relation is checked where it was written.
     */
    const stageNodesFor = new Map<LabRelation, Map<string, SyntaxNode>>();
    stages.forEach((stageEntry) => {
      const stageForest = Array.isArray(stageEntry?.workspaceForest) && stageEntry.workspaceForest.length > 0
        ? stageEntry.workspaceForest
        : forest;
      const stageNodes = collectNodes(stageForest);
      getStageRelations(stageEntry).forEach((relation) => stageNodesFor.set(relation, stageNodes));
    });

    const drawn = trajectories.flatMap((relation) => {
      const nodesHere = stageNodesFor.get(relation) || nodes;
      const to = endpoint(relation, TRAJECTORY_TO_ROLES);
      let kind = TRAJECTORY_KINDS[foldRelationName(relation.relation)] || 'phrasal';
      const foldedRelation = foldRelationName(relation.relation);
      if (
        foldedRelation === 'remnantmovement'
        && scalarValue(relation, 'phase') === 'evacuation'
      ) {
        kind = 'phrasal';
      }
      if (
        foldedRelation === 'identity'
        && !TRAJECTORY_WITNESS_ROLES.some((role) => relation.anchors?.[role] !== undefined)
      ) {
        kind = 'head';
      }
      if (
        foldedRelation === 'smuggling'
        && !relation.anchors?.passenger
        && !relation.anchors?.intervener
      ) {
        kind = 'phrasal';
      }
      if (foldedRelation === 'sidewardmovement') {
        const relationStage = relationStageIndex.get(relation) ?? 0;
        const stageForest = stages[relationStage]?.workspaceForest || [];
        const appearedEarlier = stages.slice(0, relationStage).some((priorStage) =>
          getStageRelations(priorStage).some((priorRelation) =>
            foldRelationName(priorRelation.relation) === foldedRelation
          )
        );
        if (stageForest.length === 1 && appearedEarlier) kind = 'phrasal';
      }

      /*
       * Across-the-board movement is one dependency with one landing and more
       * than one lower gap. The authored arrays stay paired by position and
       * compile to one path per source. Treating them as separate relations
       * would lose the source figure's central claim that the landing is shared.
       */
      if (kind === 'atb') {
        const sources = flattenAnchorIds(relation.anchors.sources);
        const witnesses = flattenAnchorIds(relation.anchors.traceWitnesses);
        if (!to || sources.length === 0 || sources.length !== witnesses.length) return [];
        const index = indices[to] || indices[sources[0]] || 'i';
        return sources.flatMap((from, sourceIndex) => {
          const witness = witnesses[sourceIndex];
          const sourceIds = collectSubtreeIds(nodesHere.get(from));
          if (!sourceIds.includes(witness)) return [];
          return [{
            relation,
            path: {
              from,
              to,
              kind,
              relation: relation.relation,
              index,
              fromWitness: witness
            }
          }];
        });
      }

      const from = endpoint(relation, TRAJECTORY_FROM_ROLES);
      if (!from || !to) return [];
      /*
       * Lowering is directional, not inherently head-sized, and the head/phrase
       * split is read off the anchored topology and authored roles, never off a
       * category-name pattern. A head-sized endpoint dominates no internal
       * structure beyond its own leaves — a terminal, a preterminal, or a
       * complex head built by adjunction all qualify. If either authored
       * endpoint dominates deeper structure, or the relation authors the
       * phrasal copy/witness roles, the same open relation takes phrasal
       * endpoint rules and must name the trace terminal it leaves.
       */
      if (kind === 'lowering') {
        const dominatesInternalStructure = (nodeId: string): boolean => {
          const anchorNode = nodesHere.get(nodeId);
          return Boolean(anchorNode) && (anchorNode?.children || [])
            .some((child) => Array.isArray(child.children) && child.children.length > 0);
        };
        const authorsPhrasalRoles = ['lowerCopy', 'pronouncedCopy', 'landing']
          .some((role) => relation.anchors?.[role] !== undefined)
          || TRAJECTORY_WITNESS_ROLES.some((role) => relation.anchors?.[role] !== undefined);
        if (authorsPhrasalRoles || dominatesInternalStructure(from) || dominatesInternalStructure(to)) {
          kind = 'phrasal-lowering';
        }
      }
      const index = kind === 'lowering' ? '' : chainNumberFor([from, to], nodesHere);

      /*
       * Strict witness resolution, not first-id-wins. An array, a second
       * witness role, an id the tree does not contain, or a node outside the
       * authored source occurrence are all refusals: the drawing would otherwise start
       * somewhere the analysis never pointed at. Kinds that need no witness are
       * still refused if they author one that does not resolve, because a
       * broken anchor is a disagreement between tree and relation either way.
       */
      const resolvedWitness = resolveTraceWitness(
        relation.anchors,
        from,
        collectSubtreeIds(nodesHere.get(from))
      );
      const witnessAuthored = TRAJECTORY_WITNESS_ROLES
        .some((role) => relation.anchors?.[role] !== undefined);
      if (trajectoryRequiresWitness(kind) && resolvedWitness.ok !== true) return [];
      if (witnessAuthored && resolvedWitness.ok !== true) return [];
      const witness = resolvedWitness.ok === true ? resolvedWitness.witnessId : '';
      return [{
        relation,
        path: {
          from,
          to,
          kind,
          relation: relation.relation,
          index,
          ...(witness ? { fromWitness: witness } : {})
        }
      }];
    });
    if (drawn.length > 0) {
      lens.trajectory = drawn.map((entry) => entry.path);
      /*
       * Which authored stage each drawing belongs to, parallel to `trajectory`
       * rather than folded into it: a card may use this to show one event per
       * Replay stage the way a source's panels do, and every other consumer of
       * the path objects stays untouched.
       *
       * Derived from the same survivors as the drawings, so a refused relation
       * cannot shift every later stage number by one.
       */
      lens.trajectoryStages = drawn.map((entry) => relationStageIndex.get(entry.relation) ?? 0);
      lens.trajectoryRelationIndices = drawn.map((entry) => authoredRelationIndex.get(entry.relation) ?? 0);
    }
  }

  /*
   * Constituent enclosures. Two relations draw a rectangle, and they mean
   * different things by it, so the licence travels with the mark rather than
   * being inferred later:
   *
   *   remnant-landing — the remnant, boxed where it lands, which is what makes
   *     it legible as a constituent that moved with a gap already inside it;
   *   carrier-chunk  — the carrier at its *lower* occurrence, shaded, which is
   *     what shows the passenger riding inside it past the intervener.
   *
   * Same rectangle, opposite ends of the chain. Flattening them into one box
   * relation would lose which occurrence the source is pointing at.
   */
  const enclosures: Array<{
    node: string;
    licence: string;
    nodes: string[];
    stage?: number;
    relationIndex?: number;
  }> = [];
  matchRelations(stages, ['RemnantMovement']).forEach((relation) => {
    if (scalarValue(relation, 'phase') === 'evacuation') return;
    const landing = flattenAnchorIds(relation.anchors.pronouncedCopy)[0]
      || flattenAnchorIds(relation.anchors.landing)[0];
    if (!landing || !nodes.has(landing)) return;
    enclosures.push({
      node: landing,
      licence: 'remnant-landing',
      nodes: collectSubtreeIds(nodes.get(landing)),
      stage: relationStageIndex.get(relation) ?? 0,
      relationIndex: authoredRelationIndex.get(relation) ?? 0
    });
  });
  matchRelations(stages, ['Smuggling']).forEach((relation) => {
    const carrier = flattenAnchorIds(relation.anchors.lowerCopy)[0];
    if (!carrier || !nodes.has(carrier)) return;
    enclosures.push({
      node: carrier,
      licence: 'carrier-chunk',
      nodes: collectSubtreeIds(nodes.get(carrier)),
      stage: relationStageIndex.get(relation) ?? 0,
      relationIndex: authoredRelationIndex.get(relation) ?? 0
    });
  });
  matchRelations(stages, RECOGNIZED_RELATIONS.multiplePronunciation).forEach((relation) => {
    const occurrences = [
      ...flattenAnchorIds(relation.anchors.higherCopy),
      ...flattenAnchorIds(relation.anchors.lowerCopy),
      ...flattenAnchorIds(relation.anchors.occurrences)
    ].filter((id, index, all) => id && all.indexOf(id) === index && nodes.has(id));
    occurrences.forEach((occurrence) => enclosures.push({
      node: occurrence,
      licence: 'copy-occurrence',
      nodes: collectSubtreeIds(nodes.get(occurrence)),
      stage: relationStageIndex.get(relation) ?? 0,
      relationIndex: authoredRelationIndex.get(relation) ?? 0
    }));
  });
  if (enclosures.length > 0) lens.enclosures = enclosures;

  /*
   * Copy chains with no arrow of their own.
   *
   * A derivation can assume a movement it does not draw — Bošković's figure
   * takes V-to-v for granted and shows only a lower verb trace. Babel already
   * has everything needed to present that: one lineage, one pronounced
   * occurrence, the rest silent. So every such family on a card that authors
   * movement gets a chain number and its silent occurrences read as copies,
   * without inventing a second arrow the source never draws.
   */
  /*
   * Copy chains are presented on any card whose analysis is about structure
   * rather than about recoverable silence. Ellipsis and LF reconstruction show
   * their silent material on purpose — that is the whole claim — so a card
   * authoring either keeps its words; everywhere else a silent occurrence of a
   * chain reads as a copy, drawn arrow or not.
   */
  const showsRecoverableSilence = matchRelations(stages, [
    ...RECOGNIZED_RELATIONS.ellipsis,
    ...RECOGNIZED_RELATIONS.reconstruction,
    ...RECOGNIZED_RELATIONS.quantifierRaising,
    ...RECOGNIZED_RELATIONS.identity
  ]).length > 0;
  /*
   * Without a drawn movement only head chains are presented as copies. A head
   * that has raised leaves an occurrence no analysis disputes, and printing the
   * word twice reads as saying it twice. Silent phrases are a different matter:
   * PRO is a pronoun rather than a trace, and a covert quantifier landing is the
   * quantifier, so neither may be quietly turned into one.
   */
  const headOnlyChains = !lens.trajectory?.length;
  const isHead = (node: SyntaxNode | undefined): boolean =>
    Boolean(node) && !/(?:P|')$/.test(String(node?.label || ''));
  if (!showsRecoverableSilence) {
    const drawnChains = new Set(
      ((lens.trajectory || []) as Array<{ from: string; to: string }>)
        .flatMap((path) => [path.from, path.to])
        .map((id) => String(nodes.get(id)?.lineageId || '').trim())
        .filter(Boolean)
    );
    /*
     * Material inside a drawn chain's own occurrences is not a separate chain.
     * A word swept along inside a moved constituent is silent *because* that
     * constituent moved, so its gap appears exactly when the arrow does — and
     * the arrow's own copy presentation already covers it. Treating it as an
     * independent assumed chain would make it read as a trace in panels drawn
     * before the movement it depends on.
     */
    const drawnMaterial = new Set(
      ((lens.trajectory || []) as Array<{ from: string; to: string }>)
        .flatMap((path) => [path.from, path.to])
        .flatMap((id) => (nodes.has(id) ? collectSubtreeIds(nodes.get(id)) : []))
    );
    const families = new Map<string, SyntaxNode[]>();
    forest.forEach((root) => walkTree(root, (current) => {
      const lineage = String(current.lineageId || '').trim();
      if (!lineage || drawnChains.has(lineage)) return;
      if (current.id && drawnMaterial.has(current.id)) return;
      families.set(lineage, [...(families.get(lineage) || []), current]);
    }));
    const copyChains: Array<{ nodes: string[]; index: string }> = [];
    families.forEach((members, lineage) => {
      const silent = members.filter((member) => member.silent === true);
      const pronounced = members.filter((member) => member.silent !== true);
      if (silent.length === 0 || pronounced.length !== 1) return;
      if (headOnlyChains && !members.every(isHead)) return;
      copyChains.push({
        index: chainNumberFor(members.map((member) => member.id).filter(Boolean) as string[]),
        nodes: silent.map((member) => member.id).filter(Boolean) as string[]
      });
      void lineage;
    });
    if (copyChains.length > 0) lens.copyChains = copyChains;
  }

  const control = single(matchRelations(stages, RECOGNIZED_RELATIONS.control), 'Control');
  if (control) {
    const controller = flattenAnchorIds(control.anchors.controller)[0];
    const controllee = flattenAnchorIds(control.anchors.controllee)[0];
    const domain = flattenAnchorIds(control.anchors.domain)[0];
    lens.control = {
      controller,
      controllee,
      domain,
      domainNodes: collectSubtreeIds(nodes.get(domain)),
      index: indices[controller] || indices[controllee] || 'i',
      stage: relationStageIndex.get(control) ?? 0
    };
  }

  /*
   * Predication is an undirected interpretive relation, not movement and not
   * Control. A single authored predicand may name one predicate or an ordered
   * list of predicates; the latter is the common-subject shape in Enfield's
   * resultative source. Each pair becomes one dotted path.
   */
  const predications = matchRelations(stages, RECOGNIZED_RELATIONS.predication);
  const predicationLinks = predications.flatMap((relation) => {
    const predicand = flattenAnchorIds(relation.anchors.predicand)[0];
    const predicates = [
      ...flattenAnchorIds(relation.anchors.predicate),
      ...flattenAnchorIds(relation.anchors.predicates)
    ];
    if (!predicand || predicates.length === 0) return [];
    return predicates.map((predicate) => ({
      predicand,
      predicate,
      stage: relationStageIndex.get(relation) ?? 0
    }));
  });
  if (predicationLinks.length > 0) {
    lens.predication = { links: predicationLinks };
    lens.label = fallbackLens?.label || 'Predication lens';
    lens.defaultActive = true;
  }

  /*
   * Pair Merge leaves the ordinary dominance tree alone. Its branch overlay
   * follows both arms from the shared parent to the pair member and its host.
   */
  const pairMerges = matchRelations(stages, RECOGNIZED_RELATIONS.pairMerge);
  const pairMergeLinks = pairMerges.flatMap((relation) => {
    const pairMember = flattenAnchorIds(
      relation.anchors.pairMember || relation.anchors.adjunct
    )[0];
    const host = flattenAnchorIds(relation.anchors.host)[0];
    return pairMember && host ? [{ pairMember, host }] : [];
  });
  if (pairMergeLinks.length > 0) {
    lens.pairMerge = { links: pairMergeLinks };
    lens.label = fallbackLens?.label || 'Pair-Merge lens';
    lens.defaultActive = true;
  }

  /*
   * Oseki's Adjunct Condition plate does not show successful movement. It
   * shows the transferred adjunct's dashed attachment plus one explicitly
   * blocked, double-ended extraction diagnostic.
   */
  const blockedExtractions = matchRelations(
    stages,
    RECOGNIZED_RELATIONS.blockedExtraction
  );
  const blockedExtractionPaths = blockedExtractions.flatMap((relation) => {
    const source = flattenAnchorIds(
      relation.anchors.source || relation.anchors.extractionSource
    )[0];
    const target = flattenAnchorIds(
      relation.anchors.target || relation.anchors.landingSite
    )[0];
    const domain = flattenAnchorIds(
      relation.anchors.adjunctDomain || relation.anchors.domain
    )[0];
    const authoredLabel = relation.values?.label;
    const label = String(
      Array.isArray(authoredLabel)
        ? authoredLabel[0] || '* extraction'
        : authoredLabel || '* extraction'
    );
    return source && target && domain ? [{ source, target, domain, label }] : [];
  });
  if (blockedExtractionPaths.length > 0) {
    lens.blockedExtraction = { paths: blockedExtractionPaths };
    lens.label = fallbackLens?.label || 'Blocked extraction lens';
    lens.defaultActive = true;
  }

  /*
   * Idiom chunks are authored as open anchor roles. `domain` names the
   * interpretation domain; every other anchor role contributes one chunk.
   * This permits both an explicit `chunks` array and semantically named roles
   * such as `predicateChunk` and `argumentChunk`.
   */
  const idiomChunks = matchRelations(stages, RECOGNIZED_RELATIONS.idiomChunk);
  const idiomChunkRelations = idiomChunks.flatMap((relation) => {
    const domainRole = Object.keys(relation.anchors || {})
      .find((role) => ['domain', 'interpretationDomain'].includes(role));
    const domain = domainRole
      ? flattenAnchorIds(relation.anchors[domainRole])[0]
      : '';
    const chunks = Object.entries(relation.anchors || {})
      .filter(([role]) => role !== domainRole)
      .flatMap(([, value]) => flattenAnchorIds(value))
      .filter((id, index, all) => id && all.indexOf(id) === index);
    return domain && chunks.length >= 2 ? [{ domain, chunks }] : [];
  });
  if (idiomChunkRelations.length > 0) {
    lens.idiomChunks = { relations: idiomChunkRelations };
    lens.label = fallbackLens?.label || 'Idiom interpretation lens';
    lens.defaultActive = true;
  }

  const binding = single(matchRelations(stages, RECOGNIZED_RELATIONS.binding), 'Binding');
  if (binding) {
    const binder = flattenAnchorIds(binding.anchors.binder)[0];
    const bound = flattenAnchorIds(binding.anchors.bound)[0];
    const domain = flattenAnchorIds(binding.anchors.domain)[0];
    const domainNodes = collectSubtreeIds(nodes.get(domain));
    /*
     * The licensed/failed contrast is an authored fact, never a containment
     * inference. The source slides print the coindex on both ends in the
     * licensed and the failed configuration alike; what differs is whether the
     * bound element falls inside the drawn domain, and the card records the
     * judgment itself in `values.outcome`.
     */
    lens.binding = {
      ...(fallbackLens?.binding || {}),
      binder,
      bound,
      domain,
      domainNodes,
      index: indices[binder] || indices[bound] || 'i',
      outcome: scalarValue(binding, 'outcome', 'licensed') === 'failed' ? 'failed' : 'licensed',
      stage: relationStageIndex.get(binding) ?? 0
    };
  }

  /*
   * Quantifier raising co-indexes its two occurrences.
   *
   * The controlling plate writes the relation as `[every book]ᵢ [TP … tᵢ]`: the
   * dashed path says the quantifier moved covertly, and the shared subscript
   * says which quantifier the raised one is. Without the index the drawing shows
   * two quantifier phrases and leaves the reader to guess they are one.
   */
  const raising = single(
    matchRelations(stages, RECOGNIZED_RELATIONS.quantifierRaising).filter((relation) =>
      Boolean(relation.anchors?.pronouncedQP || relation.anchors?.source)
      && Boolean(relation.anchors?.lfQP || relation.anchors?.target)
    ),
    'QuantifierRaising'
  );
  if (raising) {
    const pair = [
      flattenAnchorIds(raising.anchors.pronouncedQP || raising.anchors.source)[0],
      flattenAnchorIds(raising.anchors.lfQP || raising.anchors.target)[0]
    ].filter((id) => id && nodes.has(id));
    if (pair.length === 2) {
      lens.coindex = [{
        nodes: pair,
        index: pair.map((id) => indices[id]).find(Boolean) || 'i',
        stage: relationStageIndex.get(raising) ?? 0,
        relationIndex: authoredRelationIndex.get(raising) ?? 0
      }];
    }
  }

  const coreference = single(matchRelations(stages, RECOGNIZED_RELATIONS.coreference), 'Coreference');
  if (coreference) {
    const ids = Object.values(coreference.anchors).flatMap(flattenAnchorIds);
    lens.coindex = [{
      nodes: ids,
      index: ids.map((id) => indices[id]).find(Boolean) || 'i',
      stage: relationStageIndex.get(coreference) ?? 0,
      relationIndex: authoredRelationIndex.get(coreference) ?? 0
    }];
    lens.label = fallbackLens?.label || 'Coreference lens';
    lens.defaultActive = true;
  }

  /* Production owns both the ordinary movement path and the source-backed
   * semantic copy fork. The Lab adapter retains only the Phillips path-status lens. */
  const parasiticGap = single(
    matchRelations(stages, RECOGNIZED_RELATIONS.parasiticGap),
    'ParasiticGap'
  );
  if (parasiticGap) {
    const filler = flattenAnchorIds(parasiticGap.anchors.filler)[0]
      || flattenAnchorIds(parasiticGap.anchors.operator)[0];
    const realGap = flattenAnchorIds(parasiticGap.anchors.realGap)[0]
      || flattenAnchorIds(parasiticGap.anchors.gap)[0];
    const parasitic = [
      ...flattenAnchorIds(parasiticGap.anchors.parasiticGaps),
      ...flattenAnchorIds(parasiticGap.anchors.parasiticGap)
    ].filter((id, index, all) => id && all.indexOf(id) === index && nodes.has(id));
    if (filler && realGap && parasitic.length > 0) {
      lens.label = fallbackLens?.label || 'Parasitic gap lens';
      lens.defaultActive = true;
    }

    const primaryPath = flattenAnchorIds(parasiticGap.anchors.primaryPath)
      .filter((id) => nodes.has(id));
    const secondaryPath = flattenAnchorIds(parasiticGap.anchors.secondaryPath)
      .filter((id) => nodes.has(id));
    const blockedEdge = flattenAnchorIds(parasiticGap.anchors.blockedEdge)[0];
    if (primaryPath.length > 0 && secondaryPath.length > 0) {
      const rawOutcome = parasiticGap.values?.outcome;
      const outcome = String(Array.isArray(rawOutcome) ? rawOutcome[0] : rawOutcome || 'licensed');
      lens.parasiticGapIsland = {
        primaryPath,
        secondaryPath,
        ...(blockedEdge && nodes.has(blockedEdge) ? { blockedEdge } : {}),
        outcome: outcome === 'blocked' ? 'blocked' : 'licensed'
      };
    }
  }

  // SplitAntecedence belongs wholly to the production renderer. The legacy
  // lens must not recreate the retired 1, 2, 1⊕2 badge design.

  const identity = single(
    matchRelations(stages, RECOGNIZED_RELATIONS.identity).filter((relation) =>
      Boolean(relation.anchors?.occurrences)
      || (
        !TRAJECTORY_WITNESS_ROLES.some((role) => relation.anchors?.[role] !== undefined)
        && !(relation.anchors?.source && relation.anchors?.target)
      )
    ),
    'Identity'
  );
  if (identity) {
    const occurrenceIds = Object.values(identity.anchors).flatMap(flattenAnchorIds);
    const family = sharedLineageKey(nodes, occurrenceIds) || `identity:${occurrenceIds.join('|')}`;
    lens.pools = occurrenceIds.map((id, occurrenceIndex) => ({
      id: `identity-occurrence-${occurrenceIndex + 1}`,
      family,
      nodes: collectSubtreeLeafIds(nodes.get(id))
    }));
    /*
     * The occurrences carry the chain's number even when no path is drawn. A
     * chain with a trajectory gets its subscripts from that drawing; an
     * Identity relation on its own has none, which left the passive card's
     * traces as a bare `t` while the A-bar card's read `t₁`. The number is the
     * one this relation's lineage already resolved to, not a new count.
     */
    lens.occurrenceIndex = {
      index: chainNumberFor(occurrenceIds),
      nodes: occurrenceIds.flatMap((id) => collectSubtreeLeafIds(nodes.get(id)))
    };
  }

  /**
   * Node-attached feature plaques (inventory G11). Each bundle is one relation
   * instance: its single anchor role names the participant, its `values` keys
   * become the plaque rows verbatim. Placement stays lab styling.
   */
  const featureBundles = [
    ...matchRelations(stages, RECOGNIZED_RELATIONS.featureBundle),
    ...matchRelations(stages, RECOGNIZED_RELATIONS.agree)
      .filter((relation) => !relation.anchors?.probe && Object.keys(relation.values || {}).length > 0)
  ];
  if (featureBundles.length > 0) {
    const placements: Record<string, string> = fallbackLens?.featurePlacement || {};
    lens.featureValuation = {
      annotations: [
        ...featureBundles.flatMap((relation) => {
        const [role, value] = Object.entries(relation.anchors || {})[0] || [];
        const anchor = flattenAnchorIds(value as string | string[])[0];
        if (!anchor) return [];
        const anchorNode = nodes.get(anchor);
        const label = String(anchorNode?.label || anchorNode?.word || anchor);
        const leafIds = collectSubtreeLeafIds(anchorNode);
        return [{
          anchor,
          ...(leafIds.length > 0 ? { anchorNodes: leafIds } : {}),
          title: [label, role].filter(Boolean).join(' '),
          placement: placements[anchor] || 'below-anchor',
          rows: valueRows(relation.values),
          stage: relationStageIndex.get(relation) ?? 0,
          relationIndex: authoredRelationIndex.get(relation) ?? 0
        }];
        })
      ]
    };
  }

  /**
   * Source-backed agreement and Case overlays. These remain separate from
   * movement trajectories: their arrowheads, routing, endpoints, and stage
   * semantics come from the agreement/Case figures rather than from copies.
   */
  const multipleAgrees = matchRelations(stages, RECOGNIZED_RELATIONS.multipleAgree);
  if (multipleAgrees.length > 0) {
    lens.agreementPaths = {
      mode: 'multiple',
      paths: multipleAgrees.flatMap((relation) => {
        const probe = flattenAnchorIds(relation.anchors.probe)[0];
        const goals = flattenAnchorIds(relation.anchors.goals || relation.anchors.goal);
        if (!probe || goals.length === 0) return [];
        return goals.map((goal) => ({
          from: probe,
          to: goal,
          stage: relationStageIndex.get(relation) ?? 0,
          relationIndex: authoredRelationIndex.get(relation) ?? 0,
          outcome: scalarValue(relation, 'outcome')
        }));
      })
    };
  }

  const cyclicAgrees = matchRelations(stages, RECOGNIZED_RELATIONS.cyclicAgree);
  if (cyclicAgrees.length > 0) {
    lens.agreementPaths = {
      mode: 'cyclic',
      paths: cyclicAgrees.flatMap((relation, relationIndex) => {
        const from = flattenAnchorIds(relation.anchors.probe)[0];
        const to = flattenAnchorIds(
          relation.anchors.goal || relation.anchors.searchDomain
        )[0];
        if (!from || !to) return [];
        return [{
          from,
          to,
          stage: relationStageIndex.get(relation) ?? 0,
          relationIndex: authoredRelationIndex.get(relation) ?? 0,
          cycle: scalarValue(relation, 'cycle', String(relationIndex + 1)),
          outcome: scalarValue(relation, 'outcome')
        }];
      })
    };
  }

  const featureSharing = single(
    matchRelations(stages, RECOGNIZED_RELATIONS.featureSharing),
    'FeatureSharing'
  );
  if (featureSharing) {
    lens.featureSharing = {
      bearers: flattenAnchorIds(featureSharing.anchors.bearers),
      feature: scalarValue(featureSharing, 'feature', 'feature'),
      value: scalarValue(featureSharing, 'value', '□'),
      stage: relationStageIndex.get(featureSharing) ?? 0,
      relationIndex: authoredRelationIndex.get(featureSharing) ?? 0
    };
  }

  const caseAssignments = matchRelations(stages, RECOGNIZED_RELATIONS.caseAssignment);
  const caseAssignment = single(
    caseAssignments.filter((relation) => relation.anchors?.assigner && relation.anchors?.bearer),
    'CaseAssignment'
  );
  if (caseAssignment) {
    const bearer = flattenAnchorIds(caseAssignment.anchors.bearer)[0];
    const relatedAgrees = [
      ...matchRelations(stages, RECOGNIZED_RELATIONS.agree),
      ...caseAssignments.filter((relation) => relation !== caseAssignment)
    ]
      .filter((relation) => flattenAnchorIds(relation.anchors.probe)[0] === bearer);
    lens.caseAssignment = {
      assigner: flattenAnchorIds(caseAssignment.anchors.assigner)[0],
      bearer,
      feature: scalarValue(caseAssignment, 'feature', 'Case'),
      value: scalarValue(caseAssignment, 'value'),
      stage: relationStageIndex.get(caseAssignment) ?? 0,
      relationIndex: authoredRelationIndex.get(caseAssignment) ?? 0,
      agreePaths: relatedAgrees.flatMap((relation) => {
        const source = flattenAnchorIds(relation.anchors.goal)[0];
        if (!source) return [];
        return [{
          source,
          feature: scalarValue(relation, 'feature', 'feature'),
          value: scalarValue(relation, 'value'),
          stage: relationStageIndex.get(relation) ?? 0,
          relationIndex: authoredRelationIndex.get(relation) ?? 0
        }];
      })
    };
  }

  const dependentCases = matchRelations(stages, RECOGNIZED_RELATIONS.dependentCase);
  if (dependentCases.length > 0) {
    lens.dependentCase = {
      paths: dependentCases.flatMap((relation, relationIndex) => {
        const probe = flattenAnchorIds(relation.anchors.probe)[0];
        const goal = flattenAnchorIds(relation.anchors.goal)[0];
        if (!probe || !goal) return [];
        return [{
          probe,
          goal,
          stage: relationStageIndex.get(relation) ?? 0,
          relationIndex: authoredRelationIndex.get(relation) ?? 0,
          step: scalarValue(relation, 'step', String(relationIndex + 1)),
          value: scalarValue(relation, 'Case', '□'),
          probeLabel: scalarValue(relation, 'probeLabel', '[*φ*]'),
          goalLabel: scalarValue(relation, 'goalLabel', '[CASE: □]')
        }];
      })
    };
  }

  /**
   * Bounding-node crossing. The authored boundary anchors identify which nodes
   * the dependency crosses; no category is assumed, so IP, TP, NP and CP are
   * all equally valid boundaries depending on the authored analysis.
   */
  const crossing = single(
    matchRelations(stages, RECOGNIZED_RELATIONS.boundingNodeCrossing),
    'BoundingNodeCrossing'
  );
  if (crossing) {
    /*
     * The origin of the crossed dependency comes from the phrasal trajectory in
     * the same stage, so relevance can be checked: a boundary only counts if it
     * actually contains where the dependency starts.
     */
    const crossedTrajectory = matchRelations(stages, RECOGNIZED_RELATIONS.trajectory)
      .find((relation) => TRAJECTORY_KINDS[foldRelationName(relation.relation)] === 'phrasal');
    const originWitness = crossedTrajectory
      ? flattenAnchorIds(
          crossedTrajectory.anchors.traceWitness || crossedTrajectory.anchors.lowerWitness
        )[0]
      : undefined;
    lens.boundingNodeCrossing = {
      domain: flattenAnchorIds(crossing.anchors.domain)[0],
      boundaryNodes: flattenAnchorIds(crossing.anchors.boundary),
      stage: relationStageIndex.get(crossing) ?? 0,
      relationIndex: authoredRelationIndex.get(crossing) ?? 0,
      ...(originWitness ? { originWitness } : {})
    };
  }

  const phases = [
    ...matchRelations(stages, RECOGNIZED_RELATIONS.phase),
    ...matchRelations(stages, RECOGNIZED_RELATIONS.transferDomain)
      .filter((relation) => relation.anchors?.phase && relation.anchors?.edge
        && !relation.anchors?.spellOutDomain && !relation.anchors?.complement),
    ...matchRelations(stages, RECOGNIZED_RELATIONS.postTransferAccess)
      .filter((relation) => relation.anchors?.phase && relation.anchors?.edge
        && !relation.anchors?.spellOutDomain && !relation.anchors?.complement)
  ];
  if (phases.length > 0) {
    lens.phase = {
      boundaries: phases.map((relation, index) => ({
        node: flattenAnchorIds(relation.anchors.phase)[0],
        edge: flattenAnchorIds(relation.anchors.edge)[0],
        primary: index === 0,
        stage: relationStageIndex.get(relation) ?? 0,
        relationIndex: authoredRelationIndex.get(relation) ?? 0
      }))
    };
  }

  const transfers = [
    ...matchRelations(stages, RECOGNIZED_RELATIONS.transferDomain),
    ...matchRelations(stages, RECOGNIZED_RELATIONS.postTransferAccess)
  ].filter((relation) => Boolean(relation.anchors?.spellOutDomain || relation.anchors?.complement)
    && !relation.anchors?.source && !relation.anchors?.target);
  const transferAccess = matchRelations(stages, RECOGNIZED_RELATIONS.postTransferAccess)
    .filter((relation) => relation.anchors?.source && relation.anchors?.target);
  if (transfers.length > 0 || transferAccess.length > 0) {
    lens.transferPic = {
      domains: transfers.map((relation) => ({
        phase: flattenAnchorIds(relation.anchors.phase)[0],
        edge: flattenAnchorIds(relation.anchors.edge)[0],
        spellOutDomain: flattenAnchorIds(
          relation.anchors.spellOutDomain || relation.anchors.complement
        )[0],
        stage: relationStageIndex.get(relation) ?? 0,
        relationIndex: authoredRelationIndex.get(relation) ?? 0
      })),
      accessAttempts: transferAccess.map((relation) => ({
        source: flattenAnchorIds(relation.anchors.source)[0],
        target: flattenAnchorIds(relation.anchors.target)[0],
        spellOutDomain: flattenAnchorIds(
          relation.anchors.spellOutDomain || relation.anchors.domain
        )[0],
        stage: relationStageIndex.get(relation) ?? 0,
        relationIndex: authoredRelationIndex.get(relation) ?? 0
      }))
    };
  }

  const antiLocality = matchRelations(stages, RECOGNIZED_RELATIONS.antiLocality);
  if (antiLocality.length > 0) {
    lens.antiLocality = {
      paths: antiLocality.map((relation) => ({
        source: flattenAnchorIds(relation.anchors.source || relation.anchors.lowerCopy)[0],
        traceWitness: flattenAnchorIds(relation.anchors.traceWitness)[0],
        landing: flattenAnchorIds(relation.anchors.landing || relation.anchors.pronouncedCopy)[0],
        facilitator: flattenAnchorIds(relation.anchors.facilitator)[0],
        outcome: scalarValue(relation, 'outcome', 'blocked') === 'licensed'
          ? 'licensed'
          : 'blocked',
        stage: relationStageIndex.get(relation) ?? 0,
        relationIndex: authoredRelationIndex.get(relation) ?? 0
      }))
    };
  }

  const improper = single(
    matchRelations(stages, RECOGNIZED_RELATIONS.improperMovement)
      .filter((relation) => relation.anchors?.forbiddenRegion || relation.anchors?.rejectedLandingHosts),
    'ImproperMovement'
  );
  if (improper) {
    lens.improperMovement = {
      source: flattenAnchorIds(improper.anchors.source)[0],
      traceWitness: flattenAnchorIds(improper.anchors.traceWitness)[0],
      licensedLanding: flattenAnchorIds(improper.anchors.licensedLanding)[0],
      licensedLandingHosts: flattenAnchorIds(improper.anchors.licensedLandingHosts),
      rejectedLandingHosts: flattenAnchorIds(improper.anchors.rejectedLandingHosts),
      forbiddenRegion: flattenAnchorIds(improper.anchors.forbiddenRegion),
      stage: relationStageIndex.get(improper) ?? 0,
      relationIndex: authoredRelationIndex.get(improper) ?? 0
    };
  }

  const ellipsis = single(
    matchRelations(stages, RECOGNIZED_RELATIONS.ellipsis)
      .filter((relation) => relation.anchors?.antecedent && relation.anchors?.site),
    'EllipsisRecoverability'
  );
  if (ellipsis) {
    const antecedent = flattenAnchorIds(ellipsis.anchors.antecedent)[0];
    const site = flattenAnchorIds(ellipsis.anchors.site)[0];
    lens.ellipsisRecoverability = {
      antecedent,
      site,
      stage: relationStageIndex.get(ellipsis) ?? 0,
      relationIndex: authoredRelationIndex.get(ellipsis) ?? 0
    };
  }

  const ellipsisDeletion = single(
    matchRelations(stages, RECOGNIZED_RELATIONS.ellipsisDeletion)
      .filter((relation) => Boolean(
        flattenAnchorIds(
          relation.anchors.domain || relation.anchors.site || relation.anchors.gap
        )[0]
      )),
    'EllipsisDeletion'
  );
  if (ellipsisDeletion) {
    lens.label = fallbackLens?.label || 'Deletion lens';
    lens.defaultActive = true;
  }
  const partialCopyDeletion = single(
    matchRelations(stages, RECOGNIZED_RELATIONS.partialCopyDeletion)
      .filter((relation) => Boolean(
        flattenAnchorIds(
          relation.anchors.deletedSubconstituent || relation.anchors.deleted
        )[0]
      )),
    'PartialCopyDeletion'
  );
  if (partialCopyDeletion) {
    const deleted = flattenAnchorIds(
      partialCopyDeletion.anchors.deletedSubconstituent || partialCopyDeletion.anchors.deleted
    )[0];
    if (deleted && nodes.has(deleted)) {
      lens.partialCopyDeletion = {
        deleted,
        stage: relationStageIndex.get(partialCopyDeletion) ?? 0,
        relationIndex: authoredRelationIndex.get(partialCopyDeletion) ?? 0
      };
    }
  }

  const multidominance = single(
    matchRelations(stages, RECOGNIZED_RELATIONS.multidominance),
    'Multidominance'
  );
  if (multidominance) {
    lens.multidominance = {
      parents: flattenAnchorIds(multidominance.anchors.parents),
      shared: flattenAnchorIds(multidominance.anchors.shared)[0],
      stage: relationStageIndex.get(multidominance) ?? 0,
      relationIndex: authoredRelationIndex.get(multidominance) ?? 0
    };
  }

  const argumentSharing = single(
    matchRelations(stages, RECOGNIZED_RELATIONS.argumentSharing),
    'ArgumentSharing'
  );
  if (argumentSharing) {
    lens.argumentSharing = {
      domains: flattenAnchorIds(argumentSharing.anchors.domains),
      shared: flattenAnchorIds(argumentSharing.anchors.shared)[0],
      role: scalarValue(argumentSharing, 'role', 'ARG').toUpperCase(),
      stage: relationStageIndex.get(argumentSharing) ?? 0,
      relationIndex: authoredRelationIndex.get(argumentSharing) ?? 0
    };
  }

  /**
   * PF realization plate. The package relation supplies the first authored
   * mapping and highlighted targets; each Vocabulary Insertion instance adds
   * one later row. This mirrors the production plate one relation moment at a
   * time instead of opening an empty package before the first insertion.
   */
  const pfRelations = matchRelations(stages, RECOGNIZED_RELATIONS.pfRealization);
  const pfPackage = single(
    pfRelations.filter((relation) => ['root', 'verbalHead', 'tense', 'feature', 'exponent']
      .some((role) => relation.anchors?.[role] !== undefined)),
    'PFRealization'
  );
  const insertions = [
    ...pfRelations.filter((relation) => relation !== pfPackage),
    ...matchRelations(stages, RECOGNIZED_RELATIONS.vocabularyInsertion)
  ];
  if (pfPackage && insertions.length > 0) {
    const targetNodes = Array.from(new Set(
      Object.values(pfPackage.anchors || {}).flatMap(flattenAnchorIds)
    ));
    const plateRows = [pfPackage, ...insertions].filter((relation) => {
      const input = relation.values?.input;
      const output = relation.values?.output;
      return Boolean(String(Array.isArray(input) ? input.join(' ') : input || '').trim())
        || Boolean(String(Array.isArray(output) ? output.join(' ') : output || '').trim());
    });
    lens.pfRealization = {
      targetNodes,
      stage: relationStageIndex.get(pfPackage) ?? 0,
      relationIndex: authoredRelationIndex.get(pfPackage) ?? 0,
      rows: plateRows.map((relation, index, rows) => {
        const input = relation.values?.input;
        const output = relation.values?.output;
        return {
          input: String(Array.isArray(input) ? input.join(' ') : input || ''),
          output: String(Array.isArray(output) ? output.join(' ') : output || ''),
          stage: relationStageIndex.get(relation) ?? 0,
          relationIndex: authoredRelationIndex.get(relation) ?? index,
          ...(index === rows.length - 1 ? { final: true } : {})
        };
      })
    };
  }

  const phrasalSpellOut = single(
    matchRelations(stages, RECOGNIZED_RELATIONS.phrasalSpellOut),
    'PhrasalSpellOut'
  );
  if (phrasalSpellOut) {
    const phrase = flattenAnchorIds(
      phrasalSpellOut.anchors.phrase || phrasalSpellOut.anchors.domain
    )[0];
    if (phrase && nodes.has(phrase)) {
      lens.phrasalSpellOut = {
        phrase,
        exponent: scalarValue(phrasalSpellOut, 'exponent'),
        stage: relationStageIndex.get(phrasalSpellOut) ?? 0,
        relationIndex: authoredRelationIndex.get(phrasalSpellOut) ?? 0
      };
    }
  }

  const pfCorrespondence = single(
    matchRelations(stages, RECOGNIZED_RELATIONS.pfCorrespondence),
    'ManyToManyCorrespondence'
  );
  if (pfCorrespondence) {
    const anchor = flattenAnchorIds(
      pfCorrespondence.anchors.word || pfCorrespondence.anchors.terminal
    )[0];
    const correspondence = listValue(pfCorrespondence, 'correspondence')
      .flatMap((entry) => {
        const separator = entry.indexOf('=>');
        if (separator < 1 || separator >= entry.length - 2) return [];
        return [{
          source: entry.slice(0, separator).trim(),
          exponent: entry.slice(separator + 2).trim()
        }];
      });
    if (anchor && nodes.has(anchor)) {
      lens.pfCorrespondence = {
        anchor,
        sources: listValue(pfCorrespondence, 'sources'),
        exponents: listValue(pfCorrespondence, 'exponents'),
        correspondence,
        stage: relationStageIndex.get(pfCorrespondence) ?? 0,
        relationIndex: authoredRelationIndex.get(pfCorrespondence) ?? 0
      };
    }
  }

  const fission = single(matchRelations(stages, RECOGNIZED_RELATIONS.fission), 'Fission');
  if (fission) {
    lens.fission = {
      inputAnchor: flattenAnchorIds(
        fission.priorAnchors?.input || fission.anchors.input
      )[0],
      outputAnchors: flattenAnchorIds(fission.anchors.outputs),
      inputFeatures: listValue(fission, 'inputFeatures'),
      outputFeatures: [
        listValue(fission, 'outputOneFeatures'),
        listValue(fission, 'outputTwoFeatures')
      ],
      stage: relationStageIndex.get(fission) ?? 0,
      relationIndex: authoredRelationIndex.get(fission) ?? 0
    };
  }

  const impoverishment = single(
    matchRelations(stages, RECOGNIZED_RELATIONS.impoverishment),
    'Impoverishment'
  );
  if (impoverishment) {
    lens.impoverishment = {
      anchor: flattenAnchorIds(impoverishment.anchors.terminal)[0],
      features: listValue(impoverishment, 'featureHierarchy'),
      delinkAfter: scalarValue(impoverishment, 'delinkAfter'),
      stage: relationStageIndex.get(impoverishment) ?? 0,
      relationIndex: authoredRelationIndex.get(impoverishment) ?? 0
    };
  }

  const localDislocation = single(
    matchRelations(stages, RECOGNIZED_RELATIONS.localDislocation),
    'LocalDislocation'
  );
  if (localDislocation) {
    lens.localDislocation = {
      sequence: flattenAnchorIds(localDislocation.anchors.sequence),
      beforeGroupSizes: listValue(localDislocation, 'beforeGroupSizes')
        .map(Number)
        .filter((value) => Number.isInteger(value) && value > 0),
      afterGroupSizes: listValue(localDislocation, 'afterGroupSizes')
        .map(Number)
        .filter((value) => Number.isInteger(value) && value > 0),
      stage: relationStageIndex.get(localDislocation) ?? 0,
      relationIndex: authoredRelationIndex.get(localDislocation) ?? 0
    };
  }

  const cyclicLinearization = single(
    matchRelations(stages, RECOGNIZED_RELATIONS.cyclicLinearization)
      .filter((relation) => flattenAnchorIds(relation.anchors.order).length > 0),
    'CyclicLinearization'
  );
  if (cyclicLinearization) {
    lens.cyclicLinearization = {
      priorOrder: flattenAnchorIds(cyclicLinearization.priorAnchors?.order),
      currentOrder: flattenAnchorIds(cyclicLinearization.anchors.order),
      outcome: scalarValue(cyclicLinearization, 'outcome') === 'conflict'
        ? 'conflict'
        : 'licensed',
      stage: relationStageIndex.get(cyclicLinearization) ?? 0,
      relationIndex: authoredRelationIndex.get(cyclicLinearization) ?? 0
    };
  }

  const qr = single(
    matchRelations(stages, RECOGNIZED_RELATIONS.quantifierRaising).filter((relation) =>
      Boolean(relation.anchors?.pronouncedQP || relation.anchors?.source)
      && Boolean(relation.anchors?.lfQP || relation.anchors?.target)
    ),
    'QuantifierRaising'
  );
  if (qr) {
    const from = flattenAnchorIds(qr.anchors.pronouncedQP || qr.anchors.source)[0];
    const to = flattenAnchorIds(qr.anchors.lfQP || qr.anchors.target)[0];
    const domain = flattenAnchorIds(qr.anchors.scopeDomain || qr.anchors.domain)[0];
    lens.lf = {
      ...(fallbackLens?.lf || {}),
      domains: domain ? [{ node: domain, kind: 'scope' }] : [],
      paths: [{ from, to, kind: 'qr', elbow: true, arrow: true }],
      stage: relationStageIndex.get(qr) ?? 0,
      relationIndex: authoredRelationIndex.get(qr) ?? 0
    };
  }

  const reconstruction = single(
    matchRelations(stages, RECOGNIZED_RELATIONS.reconstruction),
    'LFReconstruction'
  );
  if (reconstruction) {
    /*
     * LF roles are read explicitly. `pronouncedCopy` is a PF fact and
     * `reconstructedCopy` names a position, so neither may stand in for what the
     * analysis interprets; the card authors `interpretedCopy` and
     * `neglectedCopy` directly.
     *
     * The sourced convention (Poole & Keine ex. 2) links the two copies by a
     * shared subscript alone: the neglected copy is struck, the interpreted
     * copy is retained, and no connector of any kind runs between them. The
     * dashed QR-styled path this branch once drew was an invented mark, so the
     * relation now compiles to the strike/ghost treatment plus one coindex.
     */
    const interpreted = flattenAnchorIds(reconstruction.anchors.interpretedCopy)[0];
    const neglected = flattenAnchorIds(reconstruction.anchors.neglectedCopy)[0];
    if (interpreted && neglected) {
      lens.lf = {
        ...(fallbackLens?.lf || {}),
        strikeNodes: [neglected],
        ghostNodes: collectSubtreeIds(nodes.get(neglected)),
        stage: relationStageIndex.get(reconstruction) ?? 0,
        relationIndex: authoredRelationIndex.get(reconstruction) ?? 0
      };
      lens.coindex = [
        ...(lens.coindex || []),
        {
          nodes: [neglected, interpreted],
          index: indices[neglected] || indices[interpreted] || 'i',
          stage: relationStageIndex.get(reconstruction) ?? 0,
          relationIndex: authoredRelationIndex.get(reconstruction) ?? 0
        }
      ];
    }
  }

  const focus = single(matchRelations(stages, RECOGNIZED_RELATIONS.focusMarking), 'FocusMarking');
  if (focus) {
    const domain = flattenAnchorIds(focus.anchors.domain)[0];
    lens.focus = {
      strongEdges: [{ from: domain, to: flattenAnchorIds(focus.anchors.focus)[0] }],
      weakEdges: [{ from: domain, to: flattenAnchorIds(focus.anchors.background)[0] }],
      stage: relationStageIndex.get(focus) ?? 0,
      relationIndex: authoredRelationIndex.get(focus) ?? 0
    };
  }

  const cooperStorage = matchRelations(stages, RECOGNIZED_RELATIONS.cooperStorage);
  if (cooperStorage.length > 0) {
    lens.cooperStorage = {
      states: cooperStorage.map((relation) => ({
        anchor: flattenAnchorIds(relation.anchors.scope)[0],
        category: scalarValue(relation, 'category', 'S'),
        qstore: listValue(relation, 'qstore'),
        retrieved: listValue(relation, 'retrieved'),
        stage: relationStageIndex.get(relation) ?? 0,
        relationIndex: authoredRelationIndex.get(relation) ?? 0
      })).sort((left, right) => left.stage - right.stage)
    };
  }

  const accords = matchRelations(stages, RECOGNIZED_RELATIONS.accord);
  if (accords.length > 0) {
    lens.accord = {
      links: accords.map((relation) => ({
        source: flattenAnchorIds(relation.anchors.source)[0],
        goal: flattenAnchorIds(relation.anchors.goal)[0],
        index: scalarValue(relation, 'index', '1'),
        feature: scalarValue(relation, 'feature', 'POL'),
        value: scalarValue(relation, 'value', '−'),
        stage: relationStageIndex.get(relation) ?? 0,
        relationIndex: authoredRelationIndex.get(relation) ?? 0
      }))
    };
  }

  const strongNpi = single(
    matchRelations(stages, RECOGNIZED_RELATIONS.strongNpiLicensing),
    'StrongNPILicensing'
  );
  if (strongNpi) {
    const focusOperator = flattenAnchorIds(strongNpi.anchors.focusOperator)[0];
    const focusAssociate = flattenAnchorIds(strongNpi.anchors.focusAssociate)[0];
    lens.strongNpiLicensing = {
      licensor: flattenAnchorIds(strongNpi.anchors.licensor)[0],
      npi: flattenAnchorIds(strongNpi.anchors.npi)[0],
      ...(focusOperator && focusAssociate ? { focusOperator, focusAssociate } : {}),
      feature: scalarValue(strongNpi, 'feature', 'D'),
      stage: relationStageIndex.get(strongNpi) ?? 0,
      relationIndex: authoredRelationIndex.get(strongNpi) ?? 0
    };
  }

  const fProjection = single(
    matchRelations(stages, RECOGNIZED_RELATIONS.fProjection),
    'FProjection'
  );
  if (fProjection) {
    lens.fProjection = {
      accentBearer: flattenAnchorIds(fProjection.anchors.accentBearer)[0],
      projections: flattenAnchorIds(fProjection.anchors.projections),
      accent: scalarValue(fProjection, 'accent', 'H*'),
      feature: scalarValue(fProjection, 'feature', 'F'),
      stage: relationStageIndex.get(fProjection) ?? 0,
      relationIndex: authoredRelationIndex.get(fProjection) ?? 0
    };
  }

  const theta = single(
    matchRelations(stages, RECOGNIZED_RELATIONS.theta).filter((relation) => relation.anchors?.predicate),
    'ThetaAssignment'
  );
  if (theta) {
    const predicate = flattenAnchorIds(theta.anchors.predicate)[0];
    const roleEntries = Object.entries(theta.anchors)
      .filter(([role]) => role.toLowerCase() !== 'predicate');
    lens.theta = {
      predicate,
      predicateLabel: String(nodes.get(predicate)?.word || nodes.get(predicate)?.label || 'predicate'),
      stage: relationStageIndex.get(theta) ?? 0,
      relationIndex: authoredRelationIndex.get(theta) ?? 0,
      roles: roleEntries.map(([role, value], index) => {
        const anchorIds = flattenAnchorIds(value);
        return {
          role: role.charAt(0).toUpperCase() + role.slice(1),
          anchor: anchorIds[0],
          anchorNodes: collectSubtreeLeafIds(nodes.get(anchorIds[0])),
          index: INDEX_SEQUENCE[index] || String(index + 1),
          indexTarget: collectSubtreeLeafIds(nodes.get(anchorIds[0])).at(-1) || anchorIds[0]
        };
      })
    };
  }

  const intervention = single(
    matchRelations(stages, RECOGNIZED_RELATIONS.intervention)
      .filter((relation) => relation.anchors?.intervener && relation.anchors?.target),
    'Intervention'
  );
  if (intervention) {
    lens.intervention = {
      probe: flattenAnchorIds(intervention.anchors.landing || intervention.anchors.probe)[0],
      intervener: flattenAnchorIds(intervention.anchors.intervener)[0],
      target: flattenAnchorIds(intervention.anchors.target)[0],
      stage: relationStageIndex.get(intervention) ?? 0,
      relationIndex: authoredRelationIndex.get(intervention) ?? 0
    };
  }

  /*
   * Large authored anchor arrays compile to the ordered anchor-set plan. This
   * is additive: whatever the relation's own design draws still draws, and the
   * plan contributes the ordered participation badges and role rails that keep
   * an unusually long array legible without truncation or guessing.
   */
  const largeAnchorSets = compileLargeAnchorSets(stages, fallbackTree);
  if (largeAnchorSets.sets.length > 0) {
    lens.anchorSets = largeAnchorSets.sets;
    diagnostics.push(...largeAnchorSets.diagnostics);
  }

  /*
   * The Lab's optional node emphasis is presentation, but it still belongs to
   * an authored relation moment. Bind every highlighted node to the exact
   * relations that name it; a presentation-only node with no direct anchor
   * waits for the first authored relation instead of leaking during lexical
   * construction.
   */
  const relationRefs = relations.map((relation) => ({
    stage: relationStageIndex.get(relation) ?? 0,
    relationIndex: authoredRelationIndex.get(relation) ?? 0,
    anchorIds: [
      ...Object.values(relation.anchors || {}).flatMap(flattenAnchorIds),
      ...Object.values(relation.priorAnchors || {}).flatMap(flattenAnchorIds)
    ]
  }));
  if (relationRefs.length > 0) {
    lens.relationRefs = relationRefs.map(({ stage, relationIndex }) => ({ stage, relationIndex }));
    if (Array.isArray(lens.nodes)) {
      lens.nodes = lens.nodes.map((node: OpenRecord) => {
        const directRefs = relationRefs.filter((ref) => ref.anchorIds.includes(String(node.id || '')));
        const refs = directRefs.length > 0 ? directRefs : relationRefs;
        return {
          ...node,
          relationRefs: refs.map(({ stage, relationIndex }) => ({ stage, relationIndex }))
        };
      });
    }
  }

  if (diagnostics.length > 0) lens.diagnostics = diagnostics;

  return lens;
};
