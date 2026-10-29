import type { Point, Rect } from './overlayGeometry.ts';
import type { PlaqueTextLayout, PlaqueTextLayoutOptions } from './plaqueTextLayout.ts';
import type { PlanRelationRef } from './renderPlan.ts';
import type { FallbackWordSpan } from './fallbackSpans.ts';
import type { TrajectoryBowSide } from '../rendererMetrics.ts';

export type BoundTrajectory = {
  type: 'trajectory-path';
  trajectoryKind: string;
  route: 'quadratic' | 'cubic' | 'orthogonal';
  /** Accepted plates that fit the ordinary tree before adding this path. */
  fitPolicy?: 'tree-first';
  from: Point;
  to: Point;
  /** Deterministic ordinal among trajectories sharing this route. */
  ordinal: number;
  /** The exact ready-to-draw movement path; the renderer draws it verbatim. */
  d: string;
  /** The quadratic's control point, for exact bounds computation. */
  control: Point;
  /** Second control point for the accepted sideward cubic arch. */
  control2?: Point;
  /** Inset start/end points actually used by the path. */
  start: Point;
  end: Point;
  /** Set when a steep quadratic bows: the side it bows to. */
  bowSide?: TrajectoryBowSide;
  itemIndex: number;
};

export type BoundIndexBadge = {
  type: 'index-badge';
  /** Accepted coindices annotate the already-fitted tree. */
  fitPolicy?: 'tree-first';
  nodeId: string;
  x: number;
  y: number;
  index: string;
  stackIndex: number;
  itemIndex: number;
};

/**
 * Identity lights the occurrence terminals and indexes their exact labels.
 * Its notation stays attached to those labels and adds no camera bounds.
 */
export type BoundIdentityLens = {
  type: 'identity-lens';
  nodeIds: string[];
  index: string;
  itemIndex: number;
};

export type BoundDomainEllipse = {
  type: 'domain-ellipse';
  /** Accepted binding/domain ellipses annotate the already-fitted tree. */
  fitPolicy?: 'tree-first';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  outcome: 'licensed' | 'failed';
  itemIndex: number;
};

export type BoundGhostSet = {
  type: 'ghost-set';
  nodeIds: string[];
  itemIndex: number;
};

export type BoundFallbackMark = {
  type: 'fallback-mark';
  role: string;
  text: string;
  textWidth: number;
  /** Measured ascent plus descent; absent when only conservative metrics are available. */
  textHeight?: number;
  /** Measured witness label including its local outline, when present. */
  labelRect: Rect;
  /** A bracketed connector's text (fallbackGeometry.ts, placeConnectorLabel):
   * `end` names one participant under its bracket, `relation` the relation
   * under the joining run. Either shows only with the connector's two witnesses. */
  connectorLabel?: 'end' | 'relation';
  connectorWitnesses?: [string, string];
  allocationOrder: number;
  nodeId: string;
  x: number;
  y: number;
  frame: 'circle' | 'box';
  /** 1-based array position numeral, or null for scalar witnesses. */
  numeral: number | null;
  instance: number;
  backward: boolean;
  stackIndex: number;
  itemIndex: number;
};

/**
 * A fallback connector with COMPLETE geometry. The accepted design draws two
 * distinct shapes and the contract preserves that distinction so the
 * renderer cannot collapse them:
 * - `counter-lane` (row 2, two scalar witnesses): a quiet undirected
 *   connector running along its allocated lane below the tree, where each
 *   participant has a bracket under the words it covers (`brackets`) and a run
 *   joins them; without measured words, short stems below each subtree;
 * - `direct` (row 3 fan spokes): a thin straight line from the hub's
 *   visible mark to the spoke's visible mark.
 * `d` is the ready-to-draw path; the
 * renderer draws exactly this path and adds nothing.
 */
export type BoundSegment = {
  type: 'segment';
  /** Exact participants required by this connector, independent of sibling badges. */
  witnessNodeIds: [string, string];
  route: 'counter-lane' | 'direct';
  d: string;
  from: Point;
  to: Point;
  /** Allocated lane for counter-lane connectors; null for direct spokes. */
  lane: number | null;
  /** The lane's actual Y, for downstream vertical allocation (counter-lane only):
   * a bracketed connector's joining run. */
  laneY?: number;
  /** A bracketed counter-lane connector's participants, in the order of `from`
   * and `to`, and once routed the levels it draws them at. */
  brackets?: FallbackBrackets;
  directed: false;
  itemIndex: number;
  /** Exact owned marks, including repeated occurrences under different roles. */
  fromMark?: number;
  toMark?: number;
};

/** One bracketed participant: the runs of words it covers, or for a participant
 * covering no painted word, a tick at its place in word order
 * (replay/relations/fallbackSpans.ts). */
export type FallbackBracketEnd = { nodeId: string; runs: Array<{ x1: number; x2: number }>; tick: number | null };

export type FallbackBrackets = {
  ends: [FallbackBracketEnd, FallbackBracketEnd];
  /** The end the other dominates, whose bracket stands nearer the words; null when neither does. */
  inner: 0 | 1 | null;
  /** Routed: each end's join x, its bracket level, and the joining level. */
  joins?: [number, number];
  levels?: [number, number];
  runY?: number;
};

export type BoundAnchorSetBadge = {
  type: 'anchor-set-badge';
  nodeId: string;
  x: number;
  y: number;
  numeral: number;
  stackIndex: number;
  badgeSize: 'standard' | 'compact';
  itemIndex: number;
};

export type BoundAnchorSetRail = {
  type: 'anchor-set-rail';
  x1: number;
  x2: number;
  lane: number;
  /** Final rail Y from the one vertical allocation law (set at finalize). */
  y: number;
  /** Exact marks owned by this relation; joins never search nearby SVG labels. */
  anchors: Array<BoundFallbackMark | BoundAnchorSetBadge>;
  itemIndex: number;
};

/**
 * A family-specific accepted shape: explicit path data plus its accepted
 * decorations, computed in this module from the pure mark geometry. The
 * renderer draws exactly what is declared here — it never restyles a family
 * from its name.
 */
export type BoundShapePath = {
  type: 'shape-path';
  /** Accepted label-measured paths annotate the already-fitted tree. */
  fitPolicy?: 'tree-first';
  shapeStyle: string;
  d: string;
  stroke: 'solid' | 'dashed' | 'dotted';
  arrowhead: boolean;
  arrowheadBoth?: boolean;
  /** Filled circular endpoints (dependent-Case / checking elbows). */
  endpointDots?: Point[];
  /** Accepted terminal decoration: bar cap, licensed check, or blocking ✗. */
  tip?: { kind: 'bar' | 'check' | 'cross'; d?: string; at: Point };
  originDot?: Point;
  label?: string;
  labelAt?: Point;
  badge?: { text: string; at: Point };
  blocked?: boolean;
  /**
   * Set when the collision router could not find a clearance route within
   * its budget; the mark keeps its least-obstructive route rather than
   * being suppressed, and this flag makes the compromise diagnosable.
   */
  routing?: 'constrained';
  itemIndex: number;
};

export type BoundDomainRegion = {
  type: 'domain-region';
  /** Accepted label-measured domains annotate the already-fitted tree. */
  fitPolicy?: 'tree-first';
  domainStyle: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  outcome?: 'licensed' | 'blocked';
  itemIndex: number;
};

/** A thin line from a plaque's anchor to the plaque placed in the gutter. */
export type BoundLeader = {
  type: 'leader';
  from: Point;
  to: Point;
  itemIndex: number;
};

export type BoundPlaque = {
  type: 'plaque';
  plaqueStyle: string;
  x: number;
  y: number;
  /** Local marker dimensions; the renderer uses the same values it was routed around. */
  width: number;
  height: number;
  /** Measured local text positions used by both bounds and SVG painting. */
  textLayout: PlaqueTextLayout;
  anchorPoints: Point[];
  title?: string;
  rows: Array<{ label: string; value: string }>;
  rowRefs?: Array<PlanRelationRef | null>;
  itemIndex: number;
};

export type BoundTextBadge = {
  type: 'text-badge';
  badgeStyle: string;
  nodeId: string;
  x: number;
  y: number;
  text: string;
  shape: 'circle' | 'square' | 'plain';
  stackIndex: number;
  /** The exact anchored occurrence already displays this notation; no extra glyph or slot is needed. */
  reuseExistingNotation?: true;
  outcome?: 'licensed' | 'blocked';
  itemIndex: number;
};

export type BoundAnalysisVerdict = {
  type: 'analysis-verdict';
  analysisNodeId: string;
  x: number;
  y: number;
  judgment: string;
  label?: string;
  itemIndex: number;
};

/** Source-backed gapping correspondence data. TreeVisualizer measures the
 * rendered shell labels after the ordinary tree fit, then applies the
 * accepted three-lane geometry without letting those lanes refit the tree. */
export type BoundGappingAlignment = {
  type: 'gapping-alignment';
  antecedentNodeId: string;
  gapNodeId: string;
  antecedent: Point;
  gap: Point;
  pairs: Array<{
    correlateNodeId: string;
    remnantNodeId: string;
    correlate: Point;
    remnant: Point;
    label: string;
  }>;
  itemIndex: number;
};

export type BoundQuantifierRaising = {
  type: 'quantifier-raising';
  pronouncedNodeId: string;
  lfNodeId: string;
  scopeDomainNodeId?: string;
  index: string;
  itemIndex: number;
};

/** TreeVisualizer measures the fitted labels and derives the seasonal scope
 * hull and binding curve without letting either refit the syntax tree. */
export type BoundOperatorVariableBinding = {
  type: 'operator-variable-binding';
  operatorNodeId: string;
  variableNodeId: string;
  traceWitnessNodeId?: string;
  scopeDomainNodeId?: string;
  index: string;
  itemIndex: number;
};

export type BoundParasiticGapCopy = {
  type: 'parasitic-gap-copy';
  contentNodeId: string;
  ordinaryGapNodeId: string;
  parasiticGapNodeIds: string[];
  itemIndex: number;
};

export type BoundSplitAntecedence = {
  type: 'split-antecedence';
  fitPolicy: 'tree-first';
  dependentNodeId: string;
  antecedentNodeIds: string[];
  origin: Point;
  links: Array<{
    antecedentNodeId: string;
    target: Point;
    d: string;
  }>;
  itemIndex: number;
};

export type BoundStrike = {
  type: 'strike';
  x1: number;
  x2: number;
  y: number;
  ghostNodeIds: string[];
  itemIndex: number;
};

export type BoundEnclosure = {
  type: 'enclosure';
  licence: string;
  x: number;
  y: number;
  width: number;
  height: number;
  itemIndex: number;
};

export type BoundBranchEmphasis = {
  type: 'branch-emphasis';
  strongEdges: Array<{ from: Point; to: Point }>;
  weakEdges: Array<{ from: Point; to: Point }>;
  itemIndex: number;
};

/** A post-fit overlay that follows one or more native tree branches. */
export type BoundNativeBranchOverlay = {
  type: 'native-branch-overlay';
  targetNodeIds: string[];
  requireSharedParent: boolean;
  variant: 'pair-merge' | 'adjunct-domain';
  itemIndex: number;
};

export type BoundSharedBranch = {
  type: 'shared-branch';
  from: Point;
  to: Point;
  itemIndex: number;
};

/**
 * A Phillips path-status node ring: the primary path's ellipse or the
 * secondary path's square, enclosing the node's own label position.
 */
export type BoundPathNodeRing = {
  type: 'path-node-ring';
  role: 'primary' | 'secondary';
  nodeId: string;
  ellipse?: { cx: number; cy: number; rx: number; ry: number };
  rect?: Rect;
  itemIndex: number;
};

export type BoundPrimitive =
  | BoundTrajectory
  | BoundIndexBadge
  | BoundIdentityLens
  | BoundDomainEllipse
  | BoundGhostSet
  | BoundFallbackMark
  | BoundSegment
  | BoundAnchorSetBadge
  | BoundAnchorSetRail
  | BoundShapePath
  | BoundPathNodeRing
  | BoundDomainRegion
  | BoundPlaque
  | BoundLeader
  | BoundTextBadge
  | BoundAnalysisVerdict
  | BoundGappingAlignment
  | BoundQuantifierRaising
  | BoundOperatorVariableBinding
  | BoundParasiticGapCopy
  | BoundSplitAntecedence
  | BoundStrike
  | BoundEnclosure
  | BoundBranchEmphasis
  | BoundNativeBranchOverlay
  | BoundSharedBranch;

export type BoundFrame = {
  stageIndex: number;
  primitives: BoundPrimitive[];
  failed: Array<{ itemIndex: number; nodeId: string; reason: string }>;
};

export type BindGeometryOptions = {
  /** Nominal label box, in tree units, centred on the node position. */
  labelWidth?: number;
  labelHeight?: number;
  badgeGap?: number;
  laneGap?: number;
  /** Counter-scale applied to screen-stable marker contents at bind time. */
  markerScale?: number;
  /** Actual SVG font measurement and available width, in marker-local units. */
  plaqueTextLayout?: PlaqueTextLayoutOptions;
  fallbackMeasurements?: FallbackMeasurements;
  /** The authored name of a relation, printed under a bracketed neutral connector's run. */
  relationNameFor?: (ref: PlanRelationRef) => string | undefined;
  /** Replay reveals neutral relations separately; static comparison plates may show them together. */
  separateFallbackMoments?: boolean;
  /** Full-frame allocation may include hidden owners; only revealed numerals can supply visible rail joins. */
  isItemRevealed?: (itemIndex: number) => boolean;
  /** Rendering supplies exact occurrence-text matching, including its existing subscript formatting. */
  hasExistingGapNotation?: (nodeId: string, text: string) => boolean;
  /**
   * Measured baseline Y for counter-lane fallback connectors (typically just
   * below the rendered terminal row). When absent, the binder derives it
   * from the connectors' own measured mark centers — never from semantic
   * guessing.
   */
  connectorBaselineY?: number;
  /**
   * Preferred base Y for large-array rails. The finalized base is
   * max(railBaseY, deepest allocated connector lane + safe gap) — ONE
   * deterministic vertical law owned here, so connectors and rails can
   * never overlap at any lane count.
   */
  railBaseY?: number;
  railLaneGap?: number;
  /** Measured clear ceiling for cross-workspace sideward arches. */
  trajectoryCeilingY?: number;
  /** Measured clear floor for drop-first orthogonal movement routes. */
  trajectoryFloorY?: number;
  /** Tree label boxes (categories and words) a bowed movement route keeps clear
   * of where it can; read only when a route bows. */
  trajectoryLabelBoxes?: () => readonly Rect[];
  /** Writing direction. Neutral role labels try the reading-direction side of
   * their node first, so right-to-left placement reflects left-to-right. */
  direction?: 'ltr' | 'rtl';
  /** What anchor-set badges must not cover, in tree units: every painted tree
   * label's glyph cells with their outline (`outlinedTreeLabelCell`), index
   * runs included, and the shells of displayed plaques. Without it badges keep
   * their nominal offset. */
  badgeObstacles?: readonly Rect[];
};

/**
 * Position provider contract. `attachment` distinguishes what the plan is
 * asking for:
 * - `'terminal'` — the visible materialized terminal inside the exact
 *   anchored preterminal/witness subtree (never an unrelated descendant);
 * - `'shell'` — the anchored node itself;
 * - `'shell-top'` — the measured top-centre of the anchored shell, including
 *   the accepted eight-unit cross-workspace clearance;
 * - `'shell-bottom'` — the measured bottom-centre of the anchored shell
 *   label, including the accepted six-unit path clearance;
 * - `'position'` (default) — the anchored node's own laid-out position, for
 *   badges and organizational marks.
 * Returning null fails the requesting mark closed; the binder never invents
 * a location.
 */
export type PlanPositionProvider = (
  nodeId: string,
  attachment?: 'terminal' | 'shell' | 'shell-top' | 'shell-bottom' | 'position' | 'parent'
) => Point | null;

export type FallbackMeasurements = {
  labels: Rect[];
  /** Reserved annotation bounds, including plaques not yet revealed in this stage. */
  obstacles?: Rect[];
  /** Only displayed ink cuts connector gaps; future reservations affect allocation only. */
  visibleLabels?: Rect[];
  visibleObstacles?: Rect[];
  labelFor: (nodeId: string) => Rect | null;
  subtreeFor: (nodeId: string) => Rect | null;
  /** The painted words a connector participant covers (fallbackSpans.ts);
   * without it connectors keep their stems below each subtree. */
  spanFor?: (nodeId: string) => FallbackWordSpan | null;
  /** The boxes the frame's painted parent→child branches span, from the
   * parent's point to the child's; brackets go below those over them, as
   * below the visible labels. */
  branches?: Rect[];
  bottom: number;
};

