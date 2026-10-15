import type { SyntaxNode } from '../../types.ts';
import type { OutcomeConcept } from './outcomeResolver.ts';

export const TIER2_VISUAL_PRIMITIVE_NAMES = [
  'Movement curve',
  'Orthogonal movement',
  'Cross-workspace crest',
  'Carrier arrow',
  'Path states',
  'Gap label',
  'Coindex',
  'Lens emphasis',
  'Forest light',
  'Rectangular domain',
  'Control connector',
  'Elliptic domain',
  'Predication connector',
  'Path-node rings',
  'Copy fork',
  'Barrier cut',
  'Ghosting',
  'Correspondence curves',
  'Correspondence index',
  'Strike',
  'Constituent enclosure',
  'Gradient enclosure',
  'Branch overlay',
  'Shared branch',
  'Crossed domain ovals',
  'Label box',
  'Underline',
  'Domain bracket',
  'Plaque shell',
  'Feature vine',
  'Cycle badge',
  'Feature connectors',
  'Dependent-case elbow',
  'Accord connector',
  'Boxed index',
  'Phase arc',
  'Transfer arcs',
  'Overlay annotation',
  'Edge outline',
  'Access path',
  'Verdict glyph',
  'Verdict label',
  'Candidate rail',
  'Blocking cross',
  'Licensed check',
  'Intervention path',
  'Blocked extraction curve',
  'Prominence branches',
  'Projection hop',
  'Feature annotation',
  'Accent annotation',
  'Nested association curves',
  'Feature notation',
  'Ledger frame',
  'Covert path',
  'Scope domain',
  'Ranked scope hulls',
  'Variable-binding path',
  'Role grid',
  'PF plate frame',
  'PF plate rows',
  'Rewrite arrow',
  'Correspondence map',
  'Bundle shell',
  'Delinking mark',
  'State lanes',
  'Comparison column layout',
  'Anchor badge',
  'Anchor rail'
] as const;

export type Tier2VisualPrimitiveName = typeof TIER2_VISUAL_PRIMITIVE_NAMES[number];

export const TIER2_FACET_IDS = [
  'movement.path',
  'movement.carrier',
  'gap.notation',
  'identity.occurrences',
  'coreference.coindex',
  'presentation.lens',
  'control.dependency',
  'binding.dependency',
  'predication.dependency',
  'parasitic-gap.paths',
  'parasitic-gap.copy',
  'locality.boundary',
  'ellipsis.site',
  'correspondence.alignment',
  'deletion.site',
  'constituent.occurrence',
  'constituent.region',
  'pair-merge',
  'multidominance',
  'argument-sharing',
  'idiom.chunks',
  'plaque.structured',
  'feature-sharing',
  'agreement.cycle',
  'feature.dependency',
  'dependent-case',
  'accord',
  'phase.domain',
  'transfer.domain',
  'domain.annotation',
  'phase.edge',
  'transfer.access',
  'judgment.verdict',
  'landing-candidates',
  'judgment.blocked',
  'judgment.licensed',
  'intervention',
  'blocked-extraction',
  'focus.prominence',
  'focus.projection',
  'focus.association',
  'strong-npi',
  'polarity.licensing',
  'storage.ledger',
  'scope.movement',
  'operator-binding',
  'theta-grid',
  'pf.structured',
  'pf.rewrite',
  'pf.correspondence',
  'pf.fission',
  'pf.impoverishment',
  'pf.local-dislocation',
  'pf.linearization',
  'organization.large-anchor-set'
] as const;

export type Tier2FacetId = typeof TIER2_FACET_IDS[number];

export type Tier2FacetKind = 'claim' | 'presentation-companion' | 'organizational-companion';

export type Tier2AnchorSource = 'current' | 'prior' | 'either';

export type Tier2TransitionKind =
  | 'movement'
  | 'pronunciation'
  | 'deletion'
  | 'rewrite'
  | 'fission'
  | 'rebracketing';

export type Tier2FacetPersistence =
  | { kind: 'while-witnesses-resolve' }
  | { kind: 'while-active' }
  | { kind: 'inherit-parent' };

export type Tier2FacetReplacement =
  | {
    kind: 'authored-prior-continuity';
    priorStage: 'immediate';
    requireCompleteResolution: true;
  }
  | { kind: 'none' }
  | { kind: 'inherit-parent' };

export type Tier2OutputPersistence = 'inherit-facet' | 'while-active';

export type Tier2FacetOutputIdentityPolicy =
  // Occurrence evidence keeps the moment; persistent output keys may omit it.
  | { kind: 'complete-facet-evidence'; includeAuthoredMoment: true }
  | { kind: 'inherit-parent' };

export type Tier2AnchorRequirement = {
  role: string;
  source: Tier2AnchorSource;
  min: number;
  max?: number;
  optional?: boolean;
};

export type Tier2ValueRequirement = {
  value: string;
  min: number;
  max?: number;
  optional?: boolean;
  nonBlank?: boolean;
};

export type Tier2StructuralCheck =
  | { kind: 'explicit-coreference' }
  | { kind: 'explicit-role'; roles: readonly string[] }
  | { kind: 'distinct'; roles: readonly string[]; allowRepeatedWithinRole?: boolean }
  | { kind: 'contains'; containerRole: string; memberRole: string }
  | { kind: 'contains-authored-silent'; role: string }
  | { kind: 'authored-trace-or-gap'; role: string }
  | { kind: 'gap-or-silent-copy'; role: string; fillerRole: string }
  | { kind: 'shared-lineage'; roles: readonly string[] }
  | { kind: 'shared-root-lineage'; roles: readonly string[] }
  | { kind: 'separate-occurrences'; roles: readonly [string, string] }
  | { kind: 'movement-evidence' }
  | { kind: 'prior-source-consistency'; role: string }
  | { kind: 'paired-cardinality'; roles: readonly [string, string] }
  | { kind: 'multiple-parents'; role: string; minParents: number }
  | { kind: 'paired-values'; role: string; value: string; optional?: boolean }
  | { kind: 'projection-chain' }
  | { kind: 'transfer-configuration' }
  | { kind: 'feature-dependency' }
  | { kind: 'dependent-case-step' }
  | { kind: 'native-linearization' }
  | { kind: 'native-rewrite' }
  /** The sequence is regrouped between the prior and current trees without changing terminal order. */
  | { kind: 'rebracketing-configuration' }
  | { kind: 'explicit-npi' }
  | { kind: 'binding-domain-or-positive' }
  | { kind: 'movement-carrier' }
  | { kind: 'native-plaque'; style: 'fission' | 'impoverishment' | 'correspondence' | 'cooper-storage'; anchorRole: string }
  | { kind: 'shared-native-parent'; roles: readonly [string, string] }
  | { kind: 'siblings-within-domain'; leftRole: string; rightRole: string; domainRole: string }
  | { kind: 'native-parent-branch'; role: string }
  | { kind: 'value-token'; value: string; tokens: readonly string[] }
  | { kind: 'displayable-verdict'; maxCharacters: number }
  | { kind: 'accepted-outcome' }
  | { kind: 'negative-claim'; roles: readonly string[] }
  | { kind: 'active-lens' }
  | { kind: 'parent-facet-complete' }
  | { kind: 'large-array'; role: string; min: number };

export type Tier2OutputGate =
  | { kind: 'always' }
  | { kind: 'accepted-outcome' }
  | { kind: 'value-present'; value: string }
  | { kind: 'anchor-present'; role: string }
  | { kind: 'anchor-absent'; role: string }
  | { kind: 'active-lens' }
  | { kind: 'movement-geometry'; variant: 'curve' | 'orthogonal' | 'cross-workspace' };

export type Tier2FacetOutput = {
  piece: Tier2VisualPrimitiveName;
  gate: Tier2OutputGate;
  persistence: Tier2OutputPersistence;
};

export type Tier2TransitionRule = {
  kind: Tier2TransitionKind;
  evidence:
  | 'overt-movement-stage-difference'
  | 'covert-movement-stage-difference'
  | 'pronunciation-stage-difference'
  | 'deletion-stage-difference'
  | 'rewrite-stage-difference'
  | 'fission-stage-difference'
  | 'rebracketing-stage-difference';
};

export type Tier2FacetRecipe = {
  id: Tier2FacetId;
  kind: Tier2FacetKind;
  persistence: Tier2FacetPersistence;
  replacement: Tier2FacetReplacement;
  anchors: readonly Tier2AnchorRequirement[];
  /** At least one role in each group must satisfy its declared requirement. */
  requireAnyRoleGroups: readonly (readonly string[])[];
  values: readonly Tier2ValueRequirement[];
  acceptedOutcomeConcepts: readonly OutcomeConcept[];
  checks: readonly Tier2StructuralCheck[];
  outputs: readonly Tier2FacetOutput[];
  outputIdentity: Tier2FacetOutputIdentityPolicy;
  transitionRules: readonly Tier2TransitionRule[];
};

export type Tier2AuthoredEvidenceEntry = {
  key: string;
  concepts: readonly string[];
  items: readonly string[];
  conceptItemIndices?: Readonly<Record<string, readonly number[]>>;
};

export type Tier2FacetEvidence = {
  /** Current authored surface groups corroborate a joint literal PF owner. */
  currentRealizations?: readonly import('../../types.ts').SurfaceRealization[];
  /** Authored fields explicitly associated by an evidence scope, rather than
   * competing aliases for one role. Cardinality and structural checks still apply. */
  associatedAnchorKeys?: Record<string, string[]>;
  relationName?: string;
  /** Qualified properties on both explicit endpoints of a failed comparison. */
  comparedFeatureKeys?: readonly string[];
  movement?: import('./movementEvidence.ts').RecoveredMovement;
  movementDiagnostics?: string[];
  movementFailure?: string;
  /** Authored fields jointly attached by one exact current realization group. */
  realizationGroupAnchorKeys?: readonly string[];
  priorRealizationGroupAnchorKeys?: readonly string[];
  /** Separately authored positions proven to belong to one exact lineage. */
  occurrenceGroupAnchorKeys?: readonly string[];
  /** Literal role rows prove a remnant pairing but are not authored coindices. */
  correspondenceRoleWitnesses?: readonly Tier2AuthoredEvidenceEntry[];
  currentAnchors: Readonly<Record<string, readonly string[]>>;
  priorAnchors?: Readonly<Record<string, readonly string[]>>;
  values: Readonly<Record<string, readonly string[]>>;
  authoredCurrentAnchors?: readonly Tier2AuthoredEvidenceEntry[];
  authoredPriorAnchors?: readonly Tier2AuthoredEvidenceEntry[];
  authoredValues?: readonly Tier2AuthoredEvidenceEntry[];
  currentForest: readonly SyntaxNode[];
  priorForest?: readonly SyntaxNode[];
  activeLens?: boolean;
  parentFacetComplete?: boolean;
};

export type Tier2FacetEvaluation = {
  complete: boolean;
  failures: string[];
  outcomeConcept: OutcomeConcept | null;
  outputs: Tier2VisualPrimitiveName[];
  earnedTransitions: Tier2TransitionKind[];
  structuralWitness?: { branchParentNodeId?: string; projectionNodeIds?: string[] };
  consumedEvidence: Array<{
    field: 'anchors' | 'priorAnchors' | 'values';
    key: string;
    itemIndices?: number[];
  }>;
};
