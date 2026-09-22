/**
 * Complete Tier-2 facet recipes.
 *
 * Candidate role meanings must pass semantic and structural checks before
 * dispatch can consume their authored evidence. Relation names are not used.
 */
import type { SyntaxNode } from '../../types.ts';
import {
  resolveOutcomeLiteral,
  negativeClaimFailure,
  authoredOutcomeLiterals,
  type OutcomeConcept
} from './outcomeResolver.ts';
import { FEATURE_DIMENSION_KEYS, isExplicitTier2Role, normalizeTier2Synonym } from './tier2Synonyms.ts';
import { isNativeProjectionPath, prepareNativeDependentCaseStep, prepareNativeLinearizationContent, prepareNativePlaqueContent, type NativePlaqueContent } from './nativeDrawingContent.ts';

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
  'strong-npi',
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
  | { kind: 'explicit-role'; roles: readonly string[] }
  | { kind: 'distinct'; roles: readonly string[]; allowRepeatedWithinRole?: boolean }
  | { kind: 'contains'; containerRole: string; memberRole: string }
  | { kind: 'contains-authored-silent'; role: string }
  | { kind: 'authored-trace-or-gap'; role: string }
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
  /** The sequence is regrouped between the prior and current trees without changing terminal order. */
  | { kind: 'rebracketing-configuration' }
  | { kind: 'explicit-npi' }
  | { kind: 'movement-carrier' }
  | { kind: 'native-plaque'; style: 'fission' | 'impoverishment' | 'correspondence' | 'cooper-storage'; anchorRole: string }
  | { kind: 'shared-native-parent'; roles: readonly [string, string] }
  | { kind: 'siblings-within-domain'; leftRole: string; rightRole: string; domainRole: string }
  | { kind: 'native-parent-branch'; role: string }
  | { kind: 'value-token'; value: string; tokens: readonly string[] }
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

// Edge outlines are independent per node; organizational rails retain each
// authored role group. Neither drawing asserts one joint linguistic group.
export const INDEPENDENT_TIER2_ANCHOR_ROLES: ReadonlySet<string> = new Set(['phase.edge', 'large.anchor.array']);
// These are rows of content, not competing alternative bindings of one slot.
// Their owning recipe must still establish participants and any dependency.
export const INDEPENDENT_TIER2_VALUE_ROLES: ReadonlySet<string> = new Set(['plaque.rows', 'pf.rows']);

/** Distinct scalar dimensions form one bundle; alternative bundles do not. */
export const independentFeatureDimensions = (entries: readonly Pick<Tier2AuthoredEvidenceEntry, 'key' | 'items'>[]) =>
  entries.length > 0 && entries.every(entry => FEATURE_DIMENSION_KEYS.has(normalizeTier2Synonym(entry.key)) && entry.items.length === 1)
    && new Set(entries.map(entry => normalizeTier2Synonym(entry.key))).size === entries.length;

export type Tier2FacetEvidence = {
  movement?: import('./movementEvidence.ts').RecoveredMovement;
  movementDiagnostics?: string[];
  movementFailure?: string;
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

export const POSITIVE_OUTCOMES = [
  'licensed', 'successful', 'allowed', 'accepted', 'valid'
] as const satisfies readonly OutcomeConcept[];

const LOCAL_NEGATIVE_OUTCOMES = [
  'blocked', 'failed', 'illicit', 'rejected', 'unlicensed', 'impossible', 'violation'
] as const satisfies readonly OutcomeConcept[];

const LOCAL_OUTCOMES = [
  ...POSITIVE_OUTCOMES,
  ...LOCAL_NEGATIVE_OUTCOMES
] as const satisfies readonly OutcomeConcept[];

const current = (role: string, min = 1, max?: number): Tier2AnchorRequirement => ({
  role, source: 'current', min, ...(max === undefined ? {} : { max })
});
const optionalCurrent = (role: string, min = 1, max?: number): Tier2AnchorRequirement => ({
  ...current(role, min, max), optional: true
});
const prior = (role: string, min = 1, max?: number): Tier2AnchorRequirement => ({
  role, source: 'prior', min, ...(max === undefined ? {} : { max })
});
const either = (role: string, min = 1, max?: number): Tier2AnchorRequirement => ({
  role, source: 'either', min, ...(max === undefined ? {} : { max })
});
const value = (name: string, min = 1, max?: number): Tier2ValueRequirement => ({
  value: name, min, ...(max === undefined ? {} : { max })
});
const optionalValue = (name: string, min = 1, max?: number): Tier2ValueRequirement => ({
  ...value(name, min, max), optional: true
});
const output = (
  piece: Tier2VisualPrimitiveName,
  gate: Tier2OutputGate = { kind: 'always' },
  persistence: Tier2OutputPersistence = 'inherit-facet'
): Tier2FacetOutput => ({
  piece, gate, persistence
});

const defaultPersistenceFor = (kind: Tier2FacetKind): Tier2FacetPersistence => {
  if (kind === 'presentation-companion') return { kind: 'while-active' };
  if (kind === 'organizational-companion') return { kind: 'inherit-parent' };
  return { kind: 'while-witnesses-resolve' };
};

const defaultReplacementFor = (kind: Tier2FacetKind): Tier2FacetReplacement => {
  if (kind === 'presentation-companion') return { kind: 'none' };
  if (kind === 'organizational-companion') return { kind: 'inherit-parent' };
  return {
    kind: 'authored-prior-continuity',
    priorStage: 'immediate',
    requireCompleteResolution: true
  };
};

const defaultOutputIdentityFor = (kind: Tier2FacetKind): Tier2FacetOutputIdentityPolicy => (
  kind === 'claim'
    ? { kind: 'complete-facet-evidence', includeAuthoredMoment: true }
    : { kind: 'inherit-parent' }
);

const recipe = (
  id: Tier2FacetId,
  config: Omit<
    Tier2FacetRecipe,
    | 'id'
    | 'kind'
    | 'persistence'
    | 'replacement'
    | 'requireAnyRoleGroups'
    | 'acceptedOutcomeConcepts'
    | 'checks'
    | 'outputIdentity'
    | 'transitionRules'
  >
  & Partial<Pick<
    Tier2FacetRecipe,
    | 'kind'
    | 'persistence'
    | 'replacement'
    | 'requireAnyRoleGroups'
    | 'acceptedOutcomeConcepts'
    | 'checks'
    | 'outputIdentity'
    | 'transitionRules'
  >>
): Tier2FacetRecipe => {
  const kind = config.kind ?? 'claim';
  return {
    id,
    kind,
    persistence: config.persistence ?? defaultPersistenceFor(kind),
    replacement: config.replacement ?? defaultReplacementFor(kind),
    anchors: config.anchors,
    requireAnyRoleGroups: config.requireAnyRoleGroups ?? [],
    values: config.values,
    acceptedOutcomeConcepts: config.acceptedOutcomeConcepts ?? [],
    checks: config.checks ?? [],
    outputs: config.outputs,
    outputIdentity: config.outputIdentity ?? defaultOutputIdentityFor(kind),
    transitionRules: config.transitionRules ?? []
  };
};

export const TIER2_FACET_RECIPES: readonly Tier2FacetRecipe[] = [
  recipe('movement.path', {
    anchors: [current('movement.source', 1, 1), current('movement.witness', 1, 1), current('movement.landing', 1, 1)],
    values: [optionalValue('outcome', 1, 1), optionalValue('movement.route', 1, 1)],
    acceptedOutcomeConcepts: LOCAL_OUTCOMES,
    checks: [
      { kind: 'movement-evidence' },
      { kind: 'separate-occurrences', roles: ['movement.source', 'movement.landing'] },
      { kind: 'distinct', roles: ['movement.source', 'movement.landing'] },
      { kind: 'contains', containerRole: 'movement.source', memberRole: 'movement.witness' },
      { kind: 'shared-root-lineage', roles: ['movement.source', 'movement.landing'] }
    ],
    outputs: [
      output('Movement curve', { kind: 'movement-geometry', variant: 'curve' }),
      output('Orthogonal movement', { kind: 'movement-geometry', variant: 'orthogonal' }),
      output('Cross-workspace crest', { kind: 'movement-geometry', variant: 'cross-workspace' }),
      output('Path states', { kind: 'accepted-outcome' })
    ],
    transitionRules: [{ kind: 'movement', evidence: 'overt-movement-stage-difference' }]
  }),
  recipe('movement.carrier', {
    anchors: [
      current('movement.source', 1, 1),
      current('movement.witness', 1, 1),
      current('movement.landing', 1, 1),
      current('movement.carrier', 1, 1)
    ],
    values: [optionalValue('outcome', 1, 1)],
    acceptedOutcomeConcepts: LOCAL_OUTCOMES,
    checks: [
      { kind: 'movement-evidence' },
      { kind: 'separate-occurrences', roles: ['movement.source', 'movement.landing'] },
      { kind: 'contains', containerRole: 'movement.source', memberRole: 'movement.witness' },
      { kind: 'shared-root-lineage', roles: ['movement.source', 'movement.landing'] },
      { kind: 'movement-carrier' }
    ],
    outputs: [output('Carrier arrow')],
    transitionRules: [{ kind: 'movement', evidence: 'overt-movement-stage-difference' }]
  }),
  recipe('gap.notation', {
    anchors: [current('gap', 1)],
    values: [optionalValue('index'), optionalValue('label')],
    checks: [
      { kind: 'authored-trace-or-gap', role: 'gap' },
      { kind: 'paired-values', role: 'gap', value: 'index', optional: true },
      { kind: 'paired-values', role: 'gap', value: 'label', optional: true }
    ],
    outputs: [output('Gap label')]
  }),
  recipe('identity.occurrences', {
    anchors: [current('occurrences', 2)],
    values: [optionalValue('index', 1, 1)],
    checks: [{ kind: 'distinct', roles: ['occurrences'] }],
    outputs: [
      output('Coindex'),
      output('Forest light')
    ]
  }),
  recipe('presentation.lens', {
    kind: 'presentation-companion',
    anchors: [current('facet.anchors', 1)],
    values: [],
    checks: [{ kind: 'parent-facet-complete' }, { kind: 'active-lens' }],
    outputs: [output('Lens emphasis', { kind: 'active-lens' })]
  }),
  recipe('control.dependency', {
    anchors: [current('controller', 1, 1), current('controllee', 1, 1), optionalCurrent('domain', 1, 1)],
    values: [],
    checks: [{ kind: 'explicit-role', roles: ['controller', 'controllee'] },
      { kind: 'distinct', roles: ['controller', 'controllee'] },
      { kind: 'contains', containerRole: 'domain', memberRole: 'controllee' }],
    outputs: [output('Rectangular domain', { kind: 'anchor-present', role: 'domain' }), output('Control connector')]
  }),
  recipe('binding.dependency', {
    anchors: [current('binder', 1, 1), current('dependent', 1, 1), current('domain', 1, 1)],
    values: [optionalValue('outcome', 1, 1), optionalValue('index', 1, 1)],
    acceptedOutcomeConcepts: LOCAL_OUTCOMES,
    checks: [{ kind: 'explicit-role', roles: ['binder', 'dependent'] }, { kind: 'contains', containerRole: 'domain', memberRole: 'dependent' }],
    outputs: [output('Elliptic domain')]
  }),
  recipe('predication.dependency', {
    anchors: [current('predicand', 1, 1), current('predicate', 1)],
    values: [],
    checks: [{ kind: 'explicit-role', roles: ['predicand'] }, { kind: 'distinct', roles: ['predicand', 'predicate'] }],
    outputs: [output('Predication connector')]
  }),
  recipe('parasitic-gap.paths', {
    anchors: [current('primary.path', 2), current('secondary.path', 2)],
    values: [],
    outputs: [output('Path-node rings')]
  }),
  recipe('parasitic-gap.copy', {
    anchors: [current('filler', 1, 1), current('ordinary.gap', 1, 1), current('parasitic.gap', 1)],
    values: [],
    checks: [
      { kind: 'distinct', roles: ['filler', 'ordinary.gap', 'parasitic.gap'] },
      { kind: 'authored-trace-or-gap', role: 'ordinary.gap' },
      { kind: 'authored-trace-or-gap', role: 'parasitic.gap' }
    ],
    outputs: [output('Copy fork')]
  }),
  recipe('locality.boundary', {
    anchors: [current('domain', 1, 1), current('boundary', 1)],
    values: [optionalValue('outcome', 1, 1)],
    acceptedOutcomeConcepts: LOCAL_NEGATIVE_OUTCOMES,
    checks: [{ kind: 'contains', containerRole: 'domain', memberRole: 'boundary' }],
    outputs: [output('Barrier cut')]
  }),
  recipe('ellipsis.site', {
    anchors: [current('ellipsis.site', 1, 1)],
    values: [],
    checks: [{ kind: 'contains-authored-silent', role: 'ellipsis.site' }, { kind: 'explicit-role', roles: ['ellipsis.site'] }],
    outputs: [output('Ghosting')],
    transitionRules: [{ kind: 'deletion', evidence: 'deletion-stage-difference' }]
  }),
  recipe('correspondence.alignment', {
    anchors: [current('correspondence.source', 1), current('correspondence.target', 1)],
    values: [optionalValue('index')],
    checks: [
      { kind: 'paired-cardinality', roles: ['correspondence.source', 'correspondence.target'] },
      { kind: 'paired-values', role: 'correspondence.source', value: 'index', optional: true }
    ],
    outputs: [output('Correspondence curves'), output('Correspondence index', { kind: 'value-present', value: 'index' })]
  }),
  recipe('deletion.site', {
    anchors: [current('deleted.material', 1, 1)],
    values: [],
    outputs: [output('Strike')],
    transitionRules: [{ kind: 'deletion', evidence: 'deletion-stage-difference' }]
  }),
  recipe('constituent.occurrence', {
    anchors: [current('constituent', 1, 1)],
    values: [],
    outputs: [output('Constituent enclosure')]
  }),
  recipe('constituent.region', {
    anchors: [current('movement.carrier', 1, 1)],
    values: [],
    outputs: [output('Gradient enclosure')]
  }),
  recipe('pair-merge', {
    anchors: [current('host', 1, 1), current('pair.member', 1, 1)],
    values: [],
    checks: [
      { kind: 'distinct', roles: ['host', 'pair.member'] },
      { kind: 'shared-native-parent', roles: ['host', 'pair.member'] }
    ],
    outputs: [output('Branch overlay')]
  }),
  recipe('multidominance', {
    anchors: [current('parents', 2), current('shared', 1, 1)],
    values: [],
    checks: [{ kind: 'multiple-parents', role: 'shared', minParents: 2 }],
    outputs: [output('Shared branch')]
  }),
  recipe('argument-sharing', {
    anchors: [current('predicate.domains', 2), current('shared.argument', 1, 1)],
    values: [optionalValue('role.label', 1, 1)],
    checks: [{ kind: 'contains', containerRole: 'predicate.domains', memberRole: 'shared.argument' }],
    outputs: [output('Crossed domain ovals'), output('Label box', { kind: 'value-present', value: 'role.label' })]
  }),
  recipe('idiom.chunks', {
    anchors: [current('chunks', 2), optionalCurrent('interpretation.domain', 1, 1)],
    values: [],
    checks: [{ kind: 'explicit-role', roles: ['chunks', 'interpretation.domain'] },
      { kind: 'contains', containerRole: 'interpretation.domain', memberRole: 'chunks' }],
    outputs: [output('Underline'), output('Domain bracket', { kind: 'anchor-present', role: 'interpretation.domain' })]
  }),
  recipe('plaque.structured', {
    anchors: [current('plaque.anchor', 1)],
    values: [value('plaque.rows', 1)],
    outputs: [output('Plaque shell')]
  }),
  recipe('feature-sharing', {
    anchors: [current('feature.bearers', 2)],
    values: [value('feature.rows', 1)],
    outputs: [output('Feature vine')]
  }),
  recipe('agreement.cycle', {
    anchors: [current('probe', 1, 1), current('goal', 1)],
    values: [value('cycle', 1, 1), optionalValue('outcome', 1, 1)],
    checks: [{ kind: 'distinct', roles: ['probe', 'goal'], allowRepeatedWithinRole: true }, { kind: 'feature-dependency' }],
    acceptedOutcomeConcepts: [...POSITIVE_OUTCOMES, 'blocked', 'failed', 'rejected', 'unlicensed', 'impossible', 'violation'],
    outputs: [output('Cycle badge')]
  }),
  recipe('feature.dependency', {
    anchors: [current('feature.source', 1, 1), current('feature.target', 1)],
    values: [optionalValue('feature.rows'), optionalValue('case.literal'), optionalValue('outcome', 1, 1)],
    checks: [{ kind: 'distinct', roles: ['feature.source', 'feature.target'], allowRepeatedWithinRole: true }, { kind: 'feature-dependency' }],
    acceptedOutcomeConcepts: [...POSITIVE_OUTCOMES, 'blocked', 'failed', 'rejected', 'unlicensed', 'impossible', 'violation'],
    outputs: [output('Feature connectors')]
  }),
  recipe('dependent-case', {
    anchors: [current('probe', 1, 1), current('goal', 1, 1)],
    values: [value('feature.rows', 1), optionalValue('step', 1, 1)],
    checks: [
      { kind: 'value-token', value: 'feature.rows', tokens: ['dependent case', 'dependent case assignment'] },
      { kind: 'dependent-case-step' }
    ],
    outputs: [output('Dependent-case elbow')]
  }),
  recipe('accord', {
    anchors: [current('feature.source', 1, 1), current('goal', 1, 1)],
    values: [value('feature.rows', 1), { ...value('index', 1, 1), nonBlank: true }],
    checks: [{ kind: 'value-token', value: 'feature.rows', tokens: ['pol', 'polarity', 'polarity negative', 'polarity positive'] }],
    outputs: [output('Accord connector'), output('Boxed index')]
  }),
  recipe('phase.domain', {
    anchors: [current('phase', 1, 1)],
    values: [],
    outputs: [output('Phase arc')]
  }),
  recipe('transfer.domain', {
    anchors: [optionalCurrent('phase', 1, 1), optionalCurrent('phase.head', 1, 1), optionalCurrent('phase.edge', 1), current('transfer.domain', 1, 1)],
    values: [],
    checks: [{ kind: 'explicit-role', roles: ['transfer.domain'] }, { kind: 'transfer-configuration' }],
    outputs: [output('Transfer arcs')]
  }),
  recipe('domain.annotation', {
    anchors: [current('domain', 1, 1)],
    values: [value('label', 1, 1)],
    outputs: [output('Overlay annotation')]
  }),
  recipe('phase.edge', {
    anchors: [current('phase.edge', 1)],
    values: [],
    outputs: [output('Edge outline')]
  }),
  recipe('transfer.access', {
    anchors: [current('access.source', 1, 1), current('access.target', 1, 1), current('transfer.domain', 1, 1)],
    values: [optionalValue('outcome', 1, 1)],
    acceptedOutcomeConcepts: LOCAL_NEGATIVE_OUTCOMES,
    checks: [{ kind: 'negative-claim', roles: ['access.target'] }, { kind: 'contains', containerRole: 'transfer.domain', memberRole: 'access.target' }],
    outputs: [output('Access path')]
  }),
  recipe('judgment.verdict', {
    anchors: [current('analysis.anchor', 1, 1)],
    values: [value('verdict', 1, 1), optionalValue('label', 1, 1)],
    outputs: [
      output('Verdict glyph'),
      output('Verdict label', { kind: 'value-present', value: 'label' })
    ]
  }),
  recipe('landing-candidates', {
    anchors: [current('movement.witness', 1, 1), optionalCurrent('licensed.hosts', 1), optionalCurrent('rejected.hosts', 1)],
    requireAnyRoleGroups: [['licensed.hosts', 'rejected.hosts']],
    values: [optionalValue('outcome', 1, 1)],
    acceptedOutcomeConcepts: LOCAL_OUTCOMES,
    checks: [{ kind: 'distinct', roles: ['licensed.hosts', 'rejected.hosts'] }],
    outputs: [output('Candidate rail')]
  }),
  recipe('judgment.blocked', {
    anchors: [current('judged.anchor', 1, 1)],
    values: [value('outcome', 1, 1)],
    acceptedOutcomeConcepts: ['blocked'],
    checks: [{ kind: 'accepted-outcome' }],
    outputs: [output('Blocking cross', { kind: 'accepted-outcome' })]
  }),
  recipe('judgment.licensed', {
    anchors: [current('judged.anchor', 1, 1)],
    values: [value('outcome', 1, 1)],
    acceptedOutcomeConcepts: POSITIVE_OUTCOMES,
    checks: [{ kind: 'accepted-outcome' }],
    outputs: [output('Licensed check', { kind: 'accepted-outcome' })]
  }),
  recipe('intervention', {
    anchors: [current('intervention.target', 1, 1), current('intervention.landing', 1, 1), current('intervener', 1, 1)],
    values: [optionalValue('outcome', 1, 1)],
    acceptedOutcomeConcepts: LOCAL_NEGATIVE_OUTCOMES,
    checks: [{ kind: 'negative-claim', roles: ['intervener'] }, { kind: 'distinct', roles: ['intervention.target', 'intervention.landing', 'intervener'] }],
    outputs: [output('Intervention path')]
  }),
  recipe('blocked-extraction', {
    anchors: [current('extraction.source', 1, 1), current('extraction.target', 1, 1), current('adjunct.domain', 1, 1)],
    values: [optionalValue('outcome', 1, 1)],
    acceptedOutcomeConcepts: LOCAL_NEGATIVE_OUTCOMES,
    checks: [
      { kind: 'negative-claim', roles: ['adjunct.domain'] },
      { kind: 'contains', containerRole: 'adjunct.domain', memberRole: 'extraction.source' },
      { kind: 'native-parent-branch', role: 'adjunct.domain' }
    ],
    outputs: [
      output('Blocked extraction curve'),
      output('Branch overlay')
    ]
  }),
  recipe('focus.prominence', {
    anchors: [current('focus', 1, 1), current('background', 1, 1), current('domain', 1, 1)],
    values: [],
    checks: [{ kind: 'siblings-within-domain', leftRole: 'focus', rightRole: 'background', domainRole: 'domain' }],
    outputs: [output('Prominence branches')]
  }),
  recipe('focus.projection', {
    anchors: [current('accent.bearer', 1, 1), current('projection.nodes', 1)],
    values: [optionalValue('feature.label', 1, 1), optionalValue('accent.label', 1, 1)],
    checks: [{ kind: 'projection-chain' }],
    outputs: [
      output('Projection hop'),
      output('Feature annotation', { kind: 'value-present', value: 'feature.label' }),
      output('Accent annotation', { kind: 'value-present', value: 'accent.label' })
    ]
  }),
  recipe('strong-npi', {
    anchors: [current('licensor', 1, 1), current('licensee', 1, 1)],
    values: [optionalValue('feature.label', 1, 1)],
    checks: [{ kind: 'explicit-npi' }],
    outputs: [output('Nested association curves'), output('Feature notation', { kind: 'value-present', value: 'feature.label' })]
  }),
  recipe('storage.ledger', {
    anchors: [current('scope', 1, 1)],
    values: [optionalValue('storage.category', 1, 1), optionalValue('storage.qstore'), optionalValue('storage.retrieved')],
    checks: [{ kind: 'native-plaque', style: 'cooper-storage', anchorRole: 'scope' }],
    outputs: [output('Ledger frame')]
  }),
  recipe('scope.movement', {
    anchors: [current('scope.source', 1, 1), current('scope.landing', 1, 1), optionalCurrent('scope.domain', 1, 1)],
    values: [optionalValue('index', 1, 1)],
    checks: [
      { kind: 'explicit-role', roles: ['scope.source', 'scope.landing'] },
      { kind: 'distinct', roles: ['scope.source', 'scope.landing'] },
      { kind: 'shared-root-lineage', roles: ['scope.source', 'scope.landing'] },
      { kind: 'separate-occurrences', roles: ['scope.source', 'scope.landing'] },
      { kind: 'prior-source-consistency', role: 'scope.source' },
      { kind: 'contains', containerRole: 'scope.domain', memberRole: 'scope.landing' }
    ],
    outputs: [output('Covert path'), output('Scope domain', { kind: 'anchor-present', role: 'scope.domain' })],
    transitionRules: [{ kind: 'movement', evidence: 'covert-movement-stage-difference' }]
  }),
  recipe('operator-binding', {
    anchors: [current('operator', 1, 1), current('variable', 1, 1), optionalCurrent('scope.domain', 1, 1)],
    values: [optionalValue('index', 1, 1)],
    checks: [{ kind: 'explicit-role', roles: ['operator', 'variable'] }, { kind: 'distinct', roles: ['operator', 'variable'] }, { kind: 'contains', containerRole: 'scope.domain', memberRole: 'variable' }],
    outputs: [
      output('Ranked scope hulls', { kind: 'anchor-present', role: 'scope.domain' }),
      output('Variable-binding path')
    ]
  }),
  recipe('theta-grid', {
    anchors: [current('predicate', 1, 1), current('theta.arguments', 1)],
    values: [value('role.label', 1)],
    checks: [{ kind: 'paired-values', role: 'theta.arguments', value: 'role.label' }],
    outputs: [output('Role grid')]
  }),
  recipe('pf.structured', {
    anchors: [current('rewrite.output', 1)],
    values: [value('pf.rows', 1)],
    outputs: [output('PF plate frame'), output('PF plate rows')],
    transitionRules: [{ kind: 'pronunciation', evidence: 'pronunciation-stage-difference' }]
  }),
  recipe('pf.rewrite', {
    anchors: [either('rewrite.input', 1, 1), current('rewrite.output', 1, 1)],
    values: [value('rewrite.rows', 1)],
    outputs: [output('Rewrite arrow')],
    transitionRules: [
      { kind: 'pronunciation', evidence: 'pronunciation-stage-difference' },
      { kind: 'rewrite', evidence: 'rewrite-stage-difference' }
    ]
  }),
  recipe('pf.correspondence', {
    anchors: [current('terminal', 1, 1)],
    values: [value('pf.sources'), value('pf.exponents')],
    checks: [{ kind: 'native-plaque', style: 'correspondence', anchorRole: 'terminal' }],
    outputs: [output('Correspondence map')]
  }),
  recipe('pf.fission', {
    anchors: [prior('rewrite.input', 1, 1), current('rewrite.outputs', 2, 2)],
    values: [value('fission.input'), value('fission.output', 2, 2)],
    checks: [
      { kind: 'paired-values', role: 'rewrite.outputs', value: 'fission.output' },
      { kind: 'native-plaque', style: 'fission', anchorRole: 'rewrite.outputs' }
    ],
    outputs: [output('Bundle shell')],
    transitionRules: [{ kind: 'fission', evidence: 'fission-stage-difference' }]
  }),
  recipe('pf.impoverishment', {
    anchors: [current('terminal', 1, 1)],
    values: [value('feature.hierarchy', 2), value('delink.position', 1, 1)],
    checks: [{ kind: 'native-plaque', style: 'impoverishment', anchorRole: 'terminal' }],
    outputs: [output('Delinking mark')],
    transitionRules: [{ kind: 'rewrite', evidence: 'rewrite-stage-difference' }]
  }),
  recipe('pf.local-dislocation', {
    anchors: [current('sequence', 2)],
    values: [],
    checks: [{ kind: 'rebracketing-configuration' }],
    outputs: [output('State lanes')],
    transitionRules: [{ kind: 'rebracketing', evidence: 'rebracketing-stage-difference' }]
  }),
  recipe('pf.linearization', {
    anchors: [current('order', 1)],
    values: [],
    checks: [{ kind: 'native-linearization' }],
    outputs: [output('Comparison column layout')]
  }),
  recipe('organization.large-anchor-set', {
    kind: 'organizational-companion',
    anchors: [current('large.anchor.array', 5)],
    values: [],
    checks: [
      { kind: 'parent-facet-complete' },
      { kind: 'large-array', role: 'large.anchor.array', min: 5 }
    ],
    outputs: [output('Anchor badge'), output('Anchor rail')]
  })
];

export const TIER2_FACET_RECIPE_BY_ID = new Map(
  TIER2_FACET_RECIPES.map((entry) => [entry.id, entry])
);

export const TIER2_FACET_ACCEPTED_OUTCOME_CONCEPTS = Object.freeze(
  Object.fromEntries(
    TIER2_FACET_RECIPES
      .filter((entry) => entry.values.some((requirement) => requirement.value === 'outcome'))
      .map((entry) => [entry.id, entry.acceptedOutcomeConcepts])
  ) as Record<string, readonly OutcomeConcept[]>
);

type TreeIndex = {
  nodes: Map<string, SyntaxNode[]>;
  parentIds: Map<string, Set<string>>;
  workspaceIds: Map<string, Set<string>>;
};

const buildTreeIndex = (forest: readonly SyntaxNode[] | undefined): TreeIndex => {
  const index: TreeIndex = {
    nodes: new Map(),
    parentIds: new Map(),
    workspaceIds: new Map()
  };

  const visit = (node: SyntaxNode, parentId: string | null, workspaceId: string) => {
    const id = String(node.id || '');
    if (id) {
      const nodes = index.nodes.get(id) ?? [];
      nodes.push(node);
      index.nodes.set(id, nodes);
      const workspaces = index.workspaceIds.get(id) ?? new Set<string>();
      workspaces.add(workspaceId);
      index.workspaceIds.set(id, workspaces);
      if (parentId) {
        const parents = index.parentIds.get(id) ?? new Set<string>();
        parents.add(parentId);
        index.parentIds.set(id, parents);
      }
    }
    (Array.isArray(node.children) ? node.children : []).forEach((child) => visit(child, id || parentId, workspaceId));
  };

  (Array.isArray(forest) ? forest : []).forEach((root, rootIndex) => {
    const workspaceId = String(root.id || '') || `workspace:${rootIndex}`;
    visit(root, null, workspaceId);
  });
  return index;
};

/** Shared only during one evaluation; callers must rebuild after changing either forest. */
export const indexTier2Forests = (evidence: Pick<Tier2FacetEvidence, 'currentForest' | 'priorForest'>) => ({
  currentIndex: buildTreeIndex(evidence.currentForest),
  priorIndex: buildTreeIndex(evidence.priorForest)
});
export type Tier2ForestIndexes = ReturnType<typeof indexTier2Forests>;

const anchorIds = (
  evidence: Tier2FacetEvidence,
  role: string,
  source: Tier2AnchorSource = 'current'
): string[] => {
  const currentIds = [...(evidence.currentAnchors[role] ?? [])].map(String);
  const priorIds = [...(evidence.priorAnchors?.[role] ?? [])].map(String);
  if (source === 'current') return currentIds;
  if (source === 'prior') return priorIds;
  return [...new Set([...currentIds, ...priorIds])];
};

const valueLiterals = (evidence: Tier2FacetEvidence, valueName: string): string[] =>
  [...(evidence.values[valueName] ?? [])].map(String);

// Feature heads have known meanings; their values stay literal. Explanatory
// prose is context, not evidence for or against a specialized assertion.
const featureNotationStatus = (literal: string, tokens: readonly string[]): 'affirmative' | 'contradiction' | 'context' => {
  let notation = literal.normalize('NFKC').trim();
  const enclosure = notation.match(/^\[([^\[\]]*)\]$|^\(([^()]*)\)$/u);
  if (enclosure) notation = (enclosure[1] ?? enclosure[2]).trim();
  notation = notation.replace(/^([^():]+)\s*\(([^()]*)\)$/u, '$1:$2');
  const head = (text: string) => normalizeTier2Synonym(text).replace(/^u (pol|polarity)$/u, '$1');
  const denial = /^(?:no|not|non|without|none|absent|false|unassigned|unasserted)\b/u;
  const normalized = head(notation);
  if (tokens.includes(normalized)) return 'affirmative';
  const colon = notation.indexOf(':');
  if (colon >= 0) {
    const subject = head(notation.slice(0, colon));
    const payload = notation.slice(colon + 1).trim();
    const normalizedPayload = normalizeTier2Synonym(payload);
    if (subject === 'case' && tokens.includes('dependent case')) {
      if (normalizedPayload === 'dependent') return 'affirmative';
      if (/^(?:not|non) dependent$/u.test(normalizedPayload)) return 'contradiction';
    }
    if (tokens.includes(subject)) {
      if (denial.test(normalizedPayload)) return 'contradiction';
      return payload && !/^(?:unknown|unsupported)\b/u.test(normalizedPayload) ? 'affirmative' : 'context';
    }
  }
  const prefixed = normalized.match(/^(?:not|no|non|without)\s+(.+)$/u);
  if (prefixed && tokens.includes(head(prefixed[1].split(':')[0]))) return 'contradiction';
  const clause = normalized.match(/^(.+?)\s+(?:is\s+)?(not\b.*|absent|false|unassigned|unasserted)$/u);
  return clause && tokens.includes(head(clause[1])) ? 'contradiction' : 'context';
};

/**
 * Positional pairing is authored, never assumed. The contract says: a values
 * entry that lists one literal per item of an anchor entry carries the same
 * name and the same length. Only such an entry pairs by position. One anchor
 * item with one literal is unambiguous and pairs regardless of name. Any
 * other arrangement is not a pairing; the literals stay visible as residue.
 * Returns `[]` when no literals are authored, `undefined` when literals exist
 * but cannot be paired.
 */
export type PairedLiterals =
  | { status: 'paired' | 'none'; literals: string[] }
  /** Several normalized keys compete without an exact authored-name match. */
  | { status: 'ambiguous'; literals: string[] }
  /** A same-name values entry exists but its length differs from the anchor entry. */
  | { status: 'unequal'; literals: string[] }
  /** Literals exist under another name and more than one item is involved. */
  | { status: 'unpaired'; literals: string[] };

export const pairedLiteralsDetail = (
  evidence: Tier2FacetEvidence,
  role: string,
  valueConcept: string
): PairedLiterals => {
  const ids = anchorIds(evidence, role);
  const anchorEntries = (evidence.authoredCurrentAnchors ?? []).filter(entry =>
    entry.concepts.includes(role) && entry.items.length > 0);
  const candidates = anchorEntries.map(entry => sameNameValueEntries(evidence, entry));
  if (candidates.some(entries => entries.length > 1)) {
    return { status: 'ambiguous', literals: candidates.flatMap(entries => entries.flatMap(entry => [...entry.items])) };
  }
  const sameName = candidates.map(entries => entries[0])
    .map(entry => entry && sameNameEntryServes(entry, role, valueConcept) ? entry : undefined);
  if (anchorEntries.length > 0 && sameName.some(Boolean)) {
    if (sameName.every(entry => entry && entry.items.length === entry.anchorLength)) {
      const literals = sameName.flatMap(entry => [...entry!.items]);
      if (literals.length === ids.length) return { status: 'paired', literals };
    }
    return { status: 'unequal', literals: sameName.flatMap(entry => entry ? [...entry.items] : []) };
  }
  const literals = valueLiterals(evidence, valueConcept);
  if (literals.length === 0) return { status: 'none', literals };
  // With no anchors there is nothing to pair; the anchor requirement reports that.
  if (ids.length === 0 || (ids.length === 1 && literals.length === 1)) return { status: 'paired', literals };
  return { status: 'unpaired', literals };
};

export const pairedLiterals = (
  evidence: Tier2FacetEvidence,
  role: string,
  valueConcept: string
): string[] | undefined => {
  const detail = pairedLiteralsDetail(evidence, role, valueConcept);
  return detail.status === 'paired' || detail.status === 'none' ? detail.literals : undefined;
};

export const sameNameValueEntries = (
  evidence: Pick<Tier2FacetEvidence, 'authoredValues'>,
  anchorEntry: Tier2AuthoredEvidenceEntry
): (Tier2AuthoredEvidenceEntry & { anchorLength: number })[] => {
  const entries = evidence.authoredValues ?? [];
  const exact = entries.filter(candidate => candidate.key === anchorEntry.key);
  // A spelling-equivalent key may fill an absent slot, but cannot override an
  // exact authored pair or choose between competing fields by object order.
  const matches = exact.length ? exact : entries.filter(candidate =>
    normalizeTier2Synonym(candidate.key) === normalizeTier2Synonym(anchorEntry.key));
  return matches.map(entry => ({ ...entry, anchorLength: anchorEntry.items.length }));
};

/** Separate argument fields form an inventory when each names its own role
 * literals. Unpaired aliases still compete for one binding. */
export const independentThetaArgumentFields = (
  evidence: Pick<Tier2FacetEvidence, 'authoredCurrentAnchors' | 'authoredValues'>
): boolean => {
  const arguments_ = evidence.authoredCurrentAnchors?.filter(entry => entry.concepts.includes('theta.arguments')) ?? [];
  const ids = arguments_.flatMap(entry => [...entry.items]);
  return arguments_.length > 1
    && new Set(arguments_.map(entry => normalizeTier2Synonym(entry.key))).size === arguments_.length
    && new Set(ids).size === ids.length
    && arguments_.every(entry => {
      const values = sameNameValueEntries(evidence, entry);
      return entry.items.length > 0 && values.length === 1
        && values[0].items.length === entry.items.length
        && values[0].items.every(value => value.trim().length > 0);
    });
};

/** Every per-item literal concept a recipe pairs with this role, in recipe order. */
const pairedConceptsForRole = (role: string): string[] => {
  const concepts = TIER2_FACET_RECIPES.flatMap(recipe => recipe.checks.flatMap(check =>
    check.kind === 'paired-values' && check.role === role ? [check.value]
      : check.kind === 'feature-dependency' && role === 'feature.target' ? ['case.literal'] : []));
  return Array.from(new Set(concepts));
};

/**
 * One same-name entry carries one kind of literal. If its name also spells a
 * paired concept, it serves that concept; an opaque name serves the first
 * per-item concept a recipe pairs with the role.
 */
const sameNameEntryServes = (entry: Tier2AuthoredEvidenceEntry, role: string, valueConcept: string): boolean => {
  const paired = pairedConceptsForRole(role);
  const named = entry.concepts.filter(concept => paired.includes(concept));
  return named.length > 0 ? named.includes(valueConcept) : paired[0] === valueConcept;
};

const unpairedReason = (role: string, valueConcept: string, status: PairedLiterals['status']): string =>
  status === 'ambiguous'
    ? `${valueConcept} literals for ${role} have ambiguous normalized field names`
    : status === 'unequal'
    ? `${valueConcept} literals for ${role} use the anchor entry's name but not its length`
    : `${valueConcept} literals are not paired with ${role}: pairing needs a values entry with the same name and length as the anchor entry`;

export const literalThetaRoles = (evidence: Tier2FacetEvidence): Array<{ nodeId: string; label: string }> | undefined => {
  const arguments_ = anchorIds(evidence, 'theta.arguments');
  const labels = pairedLiterals(evidence, 'theta.arguments', 'role.label');
  if (!arguments_.length || !labels || arguments_.length !== labels.length || labels.some(label => !label.trim())) return undefined;
  return arguments_.map((nodeId, index) => ({ nodeId, label: labels[index] }));
};

/** The exact ThetaAssignment contract also permits its open anchor names as role labels. */
export function nativeThetaRoles(evidence: Tier2FacetEvidence): { roles: Array<{ nodeId: string; label: string }>; error?: never } | { roles?: never; error: string } {
  const explicitArguments = evidence.currentAnchors['theta.arguments'];
  const explicitRoles = explicitArguments?.length ? literalThetaRoles(evidence) : undefined;
  if (explicitArguments?.length && !explicitRoles) return { error: 'Theta arguments require exactly one authored role label per argument' };
  const roles = [...(explicitRoles ?? [])];
  for (const entry of evidence.authoredCurrentAnchors ?? []) {
    if (entry.key.toLowerCase() === 'predicate' || entry.concepts.some(concept =>
      ['predicate', 'predicate.context', 'theta.arguments'].includes(concept))) continue;
    const matches = sameNameValueEntries(evidence, entry);
    if (matches.length > 1 || (matches.length === 1 && (matches[0].items.length !== entry.items.length || matches[0].items.some(label => !label.trim())))) {
      return { error: 'Theta role literals require one unambiguous same-name value per argument' };
    }
    entry.items.forEach((nodeId, index) => roles.push({ nodeId,
      label: matches[0]?.items[index] ?? entry.key.charAt(0).toUpperCase() + entry.key.slice(1) }));
  }
  return roles.length ? { roles } : { error: 'A theta grid requires at least one authored role association' };
}

// Native plates require named groups. Only bound, consumed concepts get these
// internal field names; raw row labels remain available for literal display.
/**
 * Fission: two output terminals in anchors, one feature-bundle literal per
 * output paired by the same-name rule, and the input bundle as a list.
 */
export const prepareNativeFissionContent = (
  evidence: Tier2FacetEvidence
): Extract<NativePlaqueContent, { kind: 'fission' }> | undefined => {
  const outputs = anchorIds(evidence, 'rewrite.outputs');
  const bundles = pairedLiterals(evidence, 'rewrite.outputs', 'fission.output');
  const inputFeatures = valueLiterals(evidence, 'fission.input');
  if (outputs.length !== 2 || !bundles || bundles.length !== 2 || bundles.some(bundle => !bundle.trim()) || !inputFeatures.length) return;
  return { kind: 'fission', inputFeatures, outputFeatures: [[bundles[0]], [bundles[1]]] };
};

export const tier2NativePlaqueRows = (evidence: Tier2FacetEvidence): Array<{ label: string; value: string }> =>
  Object.entries({
    'feature.hierarchy': 'featureHierarchy', 'delink.position': 'delinkAfter',
    'pf.sources': 'sources', 'pf.exponents': 'exponents',
    'storage.category': 'category', 'storage.qstore': 'qstore', 'storage.retrieved': 'retrieved'
  }).flatMap(([concept, label]) => valueLiterals(evidence, concept).map(value => ({ label, value })));

const findNodes = (index: TreeIndex, ids: readonly string[]): SyntaxNode[] =>
  ids.flatMap((id) => index.nodes.get(id) ?? []);

const sharedRootLineage = (index: TreeIndex, ids: readonly string[]): string | undefined => {
  const lineages = ids.map(id => {
    const matches = index.nodes.get(id) ?? [];
    return matches.length === 1 ? matches[0].lineageId : undefined;
  });
  return lineages.length >= 2 && lineages.every(lineage => Boolean(lineage) && lineage === lineages[0])
    ? lineages[0] : undefined;
};

const descendantIds = (node: SyntaxNode): Set<string> => {
  const ids = new Set<string>();
  const visit = (currentNode: SyntaxNode) => {
    const id = String(currentNode.id || '');
    if (id) ids.add(id);
    (Array.isArray(currentNode.children) ? currentNode.children : []).forEach(visit);
  };
  visit(node);
  return ids;
};

const nodeContainsAny = (
  index: TreeIndex,
  containerIds: readonly string[],
  memberIds: readonly string[]
): boolean => memberIds.every((memberId) => containerIds.some((containerId) =>
  (index.nodes.get(containerId) ?? []).some((node) => descendantIds(node).has(memberId))
));

const subtreeNodes = (node: SyntaxNode): SyntaxNode[] => {
  const nodes: SyntaxNode[] = [];
  const visit = (currentNode: SyntaxNode) => {
    nodes.push(currentNode);
    (Array.isArray(currentNode.children) ? currentNode.children : []).forEach(visit);
  };
  visit(node);
  return nodes;
};

const subtreeLineages = (node: SyntaxNode): Set<string> => new Set(
  subtreeNodes(node).map((member) => String(member.lineageId || '')).filter(Boolean)
);

const sharesLineage = (index: TreeIndex, roleIdGroups: readonly string[][]): boolean => {
  const lineageGroups = roleIdGroups.map((ids) => new Set(
    findNodes(index, ids).flatMap((node) => [...subtreeLineages(node)])
  ));
  if (lineageGroups.some((group) => group.size === 0)) return false;
  return [...lineageGroups[0]].some((lineage) => lineageGroups.slice(1).every((group) => group.has(lineage)));
};

const hasAuthoredSilent = (index: TreeIndex, ids: readonly string[]): boolean =>
  findNodes(index, ids).some((node) => subtreeNodes(node).some((member) => member.silent === true));

const TRACE_SURFACE = /^(?:t(?:_[\p{L}\p{N}]+|[\d₀-₉ᵢⱼₖₗₘₙₒₚ]+)?|trace|gap)$/iu;

const isAuthoredTraceOrGap = (index: TreeIndex, ids: readonly string[]): boolean =>
  ids.every((id) => {
    const matches = index.nodes.get(id) ?? [];
    if (matches.length !== 1) return false;
    const node = matches[0];
    if ((node.children ?? []).length > 0) return false;
    return node.silent === true || TRACE_SURFACE.test(String(node.word || node.label || '').trim());
  });

const projectionChain = (evidence: Tier2FacetEvidence): string[] => {
  const accent = anchorIds(evidence, 'accent.bearer')[0];
  const projections = anchorIds(evidence, 'projection.nodes');
  return projections[0] === accent ? projections : [accent, ...projections];
};

const focusParent = (evidence: Tier2FacetEvidence, index: TreeIndex): string | undefined => {
  const left = anchorIds(evidence, 'focus')[0];
  const right = anchorIds(evidence, 'background')[0];
  if (!left || !right || left === right) return undefined;
  const parents = [...(index.parentIds.get(left) ?? [])].filter(parent =>
    index.parentIds.get(right)?.has(parent)
    && nodeContainsAny(index, anchorIds(evidence, 'domain'), [parent]));
  return parents.length === 1 ? parents[0] : undefined;
};

const roleRequirementIds = (
  evidence: Tier2FacetEvidence,
  requirement: Tier2AnchorRequirement
): string[] => anchorIds(evidence, requirement.role, requirement.source);

const requirementSatisfied = (
  evidence: Tier2FacetEvidence,
  requirement: Tier2AnchorRequirement,
  currentIndex: TreeIndex,
  priorIndex: TreeIndex
): boolean => {
  const ids = roleRequirementIds(evidence, requirement);
  if (requirement.optional && ids.length === 0) {
    const entries = requirement.source === 'prior' ? evidence.authoredPriorAnchors : evidence.authoredCurrentAnchors;
    return !entries?.some(entry => entry.concepts.includes(requirement.role));
  }
  if (ids.length < requirement.min) return false;
  if (requirement.max !== undefined && ids.length > requirement.max) return false;
  return ids.every((id) => {
    if (requirement.source === 'current') return currentIndex.nodes.has(id);
    if (requirement.source === 'prior') return priorIndex.nodes.has(id);
    return currentIndex.nodes.has(id) || priorIndex.nodes.has(id);
  });
};

const outcomeFor = (recipeEntry: Tier2FacetRecipe, evidence: Tier2FacetEvidence): OutcomeConcept | null => {
  const literal = valueLiterals(evidence, 'outcome')[0];
  if (!literal) return null;
  const concept = resolveOutcomeLiteral(literal)?.concept ?? null;
  return concept && recipeEntry.acceptedOutcomeConcepts.includes(concept) ? concept : null;
};

const evaluateStructuralCheck = (
  check: Tier2StructuralCheck,
  recipeEntry: Tier2FacetRecipe,
  evidence: Tier2FacetEvidence,
  currentIndex: TreeIndex,
  outcomeConcept: OutcomeConcept | null,
  priorIndex: TreeIndex = buildTreeIndex(evidence.priorForest)
): boolean | string => {
  const ids = (role: string) => anchorIds(evidence, role, 'current');
  switch (check.kind) {
    case 'negative-claim':
      return negativeClaimFailure(evidence.authoredValues
        ? authoredOutcomeLiterals(Object.fromEntries(evidence.authoredValues.map(entry => [entry.key, [...entry.items]])))
        : valueLiterals(evidence, 'outcome'),
        (evidence.authoredCurrentAnchors ?? []).filter(entry =>
          check.roles.some(role => entry.concepts.includes(role))).map(entry => entry.key)) ?? true;
    case 'explicit-role':
      return check.roles.some(role => ids(role).length > 0 && (evidence.authoredCurrentAnchors
        ? evidence.authoredCurrentAnchors.some(entry => entry.concepts.includes(role) && isExplicitTier2Role(role, entry.key))
        : true));
    case 'distinct': {
      const all = check.roles.flatMap(role => check.allowRepeatedWithinRole ? [...new Set(ids(role))] : ids(role));
      return all.length === new Set(all).size;
    }
    case 'contains':
      if (ids(check.containerRole).length === 0 && recipeEntry.anchors.some(r => r.role === check.containerRole && r.optional)) return true;
      if (recipeEntry.id === 'argument-sharing') return ids(check.containerRole).every(container =>
        nodeContainsAny(currentIndex, [container], ids(check.memberRole)));
      return nodeContainsAny(currentIndex, ids(check.containerRole), ids(check.memberRole));
    case 'contains-authored-silent':
      return hasAuthoredSilent(currentIndex, ids(check.role));
    case 'authored-trace-or-gap':
      return isAuthoredTraceOrGap(currentIndex, ids(check.role));
    case 'shared-lineage':
      return sharesLineage(currentIndex, check.roles.map(ids));
    case 'shared-root-lineage':
      return Boolean(sharedRootLineage(currentIndex, check.roles.flatMap(ids)));
    case 'movement-evidence':
      // A static drawing can be complete without a preceding stage. A rejected
      // occurrence, context or contradictory source cannot earn that drawing.
      return !evidence.movementFailure || evidence.movementFailure === 'MOVEMENT_PRIOR_SOURCE_UNPROVEN';
    case 'separate-occurrences': {
      const [source, target] = check.roles.map(ids);
      return [...source, ...target].every(id => currentIndex.nodes.get(id)?.length === 1)
        && !nodeContainsAny(currentIndex, source, target) && !nodeContainsAny(currentIndex, target, source);
    }
    case 'prior-source-consistency':
      return anchorIds(evidence, check.role, 'prior').every(id => ids(check.role).includes(id));
    case 'paired-cardinality':
      return ids(check.roles[0]).length === ids(check.roles[1]).length;
    case 'paired-values': {
      const detail = pairedLiteralsDetail(evidence, check.role, check.value);
      if (detail.status === 'unequal' || detail.status === 'ambiguous') return unpairedReason(check.role, check.value, detail.status);
      // An optional list under another name is context, left in the residue.
      if (detail.status === 'unpaired') return check.optional || unpairedReason(check.role, check.value, detail.status);
      if (detail.literals.length === 0) return Boolean(check.optional);
      return ids(check.role).length === detail.literals.length
        && (check.optional || detail.literals.every(literal => literal.trim().length > 0));
    }
    case 'multiple-parents':
      return new Set(ids('parents')).size === ids('parents').length
        && ids('parents').length >= check.minParents
        && ids(check.role).every(id => ids('parents').every(parent => currentIndex.parentIds.get(id)?.has(parent)));
    case 'shared-native-parent': {
      const leftParents = new Set(ids(check.roles[0]).flatMap((id) => [...(currentIndex.parentIds.get(id) ?? [])]));
      return ids(check.roles[1]).some((id) =>
        [...(currentIndex.parentIds.get(id) ?? [])].some((parentId) => leftParents.has(parentId)));
    }
    case 'siblings-within-domain': {
      return Boolean(focusParent(evidence, currentIndex));
    }
    case 'native-parent-branch':
      return ids(check.role).every((id) => (currentIndex.parentIds.get(id)?.size ?? 0) > 0);
    case 'value-token': {
      const statuses = valueLiterals(evidence, check.value).map(literal => featureNotationStatus(literal, check.tokens));
      return statuses.includes('affirmative') && !statuses.includes('contradiction');
    }
    case 'projection-chain': {
      const chain = projectionChain(evidence);
      const nodes = new Map([...currentIndex.nodes].flatMap(([id, matches]) => matches.length === 1 ? [[id, matches[0]] as const] : []));
      return isNativeProjectionPath(nodes, chain[0], chain.slice(1));
    }
    case 'transfer-configuration': {
      const domains = ids('transfer.domain');
      const edges = ids('phase.edge');
      const inside = edges.filter(edge => nodeContainsAny(currentIndex, domains, [edge]));
      if (inside.length) return `accessible edges ${inside.join(',')} are inside transferred domain ${domains.join(',')}`;
      if (ids('phase').length) return nodeContainsAny(currentIndex, ids('phase'), [...domains, ...edges, ...ids('phase.head')])
        || `phase ${ids('phase').join(',')} does not contain all authored domain, edge and head anchors`;
      const head = ids('phase.head')[0];
      if (!head) return true;
      const category = (id: string) => String(currentIndex.nodes.get(id)?.[0]?.label ?? '').replace(/[\u2032'\u2019]/gu, '').replace(/(.)P$/u, '$1');
      // The authored phase head can be inside a complex head. Follow only
      // its unambiguous same-category spine, never an arbitrary ancestor.
      const projections = new Set<string>();
      const visited = new Set<string>([head]);
      let child = head;
      let foundComplement = false;
      while (true) {
        const parents = [...(currentIndex.parentIds.get(child) ?? [])];
        if (parents.length !== 1) break;
        const parent = parents[0];
        if (visited.has(parent) || currentIndex.nodes.get(parent)?.length !== 1
          || !category(head) || category(parent) !== category(head)) break;
        const siblings = currentIndex.nodes.get(parent)![0].children ?? [];
        if (foundComplement && siblings.some(sibling => sibling.id !== child
          && String(sibling.label) === category(head))) break;
        visited.add(parent);
        if (domains.every(domain => domain !== child && currentIndex.parentIds.get(domain)?.has(parent))) foundComplement = true;
        if (foundComplement) projections.add(parent);
        child = parent;
      }
      if (!foundComplement) return `head ${head} has no unique same-category projection with domain ${domains.join(',')} as a separate child`;
      const outside = edges.filter(edge => ![...(currentIndex.parentIds.get(edge) ?? [])].some(parent => projections.has(parent)));
      return outside.length === 0 || `edges ${outside.join(',')} are not attached to the identified projections ${[...projections].join(',')}`;
    }
    case 'feature-dependency': {
      const caseDetail = pairedLiteralsDetail(evidence, 'feature.target', 'case.literal');
      if (caseDetail.status === 'unequal' || caseDetail.status === 'unpaired' || caseDetail.status === 'ambiguous') return unpairedReason('feature.target', 'case.literal', caseDetail.status);
      const caseValues = caseDetail.literals;
      if (caseValues.length) return caseValues.length === ids('feature.target').length && caseValues.every(literal => literal.trim().length > 0);
      if (valueLiterals(evidence, 'feature.rows').length) return true;
      const hasRole = (concept: string, specific: string, names: string[]) => (evidence.authoredCurrentAnchors ?? []).some(entry =>
        entry.concepts.includes(concept) && (entry.concepts.includes(specific) && isExplicitTier2Role(specific, entry.key)
          || names.includes(normalizeTier2Synonym(entry.key))));
      return hasRole('feature.source', 'probe', ['feature source', 'collector'])
        && hasRole('feature.target', 'goal', ['feature target']);
    }
    case 'native-linearization':
      return Boolean(prepareNativeLinearizationContent(evidence));
    case 'rebracketing-configuration':
      return rebracketingTransition(evidence, currentIndex, priorIndex)
        || 'the prior and current trees do not regroup the sequence with its order unchanged';
    case 'dependent-case-step': {
      const entries = evidence.authoredValues?.filter(entry => normalizeTier2Synonym(entry.key) === 'step');
      const literals = entries?.length ? entries.flatMap(entry => entry.items) : evidence.values.step;
      return literals === undefined || prepareNativeDependentCaseStep([...literals]) !== undefined;
    }
    case 'explicit-npi':
      return valueLiterals(evidence, 'feature.label').some(literal => normalizeTier2Synonym(literal) === 'strong npi');
    case 'movement-carrier':
      return ['movement.source', 'movement.landing'].some(role =>
        nodeContainsAny(currentIndex, ids('movement.carrier'), ids(role)));
    case 'native-plaque':
      return check.style === 'fission'
        ? Boolean(prepareNativeFissionContent(evidence))
        : Boolean(prepareNativePlaqueContent(check.style, tier2NativePlaqueRows(evidence), ids(check.anchorRole)));
    case 'accepted-outcome':
      return outcomeConcept !== null && recipeEntry.acceptedOutcomeConcepts.includes(outcomeConcept);
    case 'active-lens':
      return evidence.activeLens === true;
    case 'parent-facet-complete':
      return evidence.parentFacetComplete === true;
    case 'large-array':
      return ids(check.role).length >= check.min;
  }
};

const terminalSurfaces = (node: SyntaxNode): string[] => subtreeNodes(node)
  .filter((member) => !Array.isArray(member.children) || member.children.length === 0)
  .map((member) => String(member.word || '').trim());

const nodeShape = (node: SyntaxNode): string => {
  const children = Array.isArray(node.children) ? node.children : [];
  return `${node.label}[${children.map(nodeShape).join(',')}]`;
};

const previousMatch = (node: SyntaxNode, priorIndex: TreeIndex): SyntaxNode | null => {
  const id = String(node.id || '');
  const idMatches = id ? priorIndex.nodes.get(id) ?? [] : [];
  if (idMatches.length === 1) return idMatches[0];
  if (idMatches.length > 1) return null;
  const lineage = String(node.lineageId || '');
  if (!lineage) return null;
  const lineageMatches = [...priorIndex.nodes.values()].flat().filter((candidate) => (
    String(candidate.lineageId || '') === lineage
  ));
  return lineageMatches.length === 1 ? lineageMatches[0] : null;
};

const lineageOccurrenceCount = (index: TreeIndex, lineage: string): number =>
  [...index.nodes.values()].flat().filter((node) => String(node.lineageId || '') === lineage).length;

const landingAlreadyOccupiedSamePosition = (
  evidence: Tier2FacetEvidence,
  currentIndex: TreeIndex,
  priorIndex: TreeIndex,
  landingRole: string
): boolean => anchorIds(evidence, landingRole).some((id) => (
  priorIndex.nodes.has(id)
  && parentSignature(priorIndex, [id]) === parentSignature(currentIndex, [id])
  && [...(priorIndex.workspaceIds.get(id) ?? [])].sort().join('\u0000')
    === [...(currentIndex.workspaceIds.get(id) ?? [])].sort().join('\u0000')
));

const covertMovementTransition = (
  evidence: Tier2FacetEvidence,
  currentIndex: TreeIndex,
  priorIndex: TreeIndex
): boolean => {
  const sourceIds = anchorIds(evidence, 'scope.source');
  const lineage = sharedRootLineage(currentIndex, [...sourceIds, ...anchorIds(evidence, 'scope.landing')]);
  return Boolean(evidence.priorForest && lineage
    && lineageOccurrenceCount(currentIndex, lineage) > lineageOccurrenceCount(priorIndex, lineage)
    && !landingAlreadyOccupiedSamePosition(evidence, currentIndex, priorIndex, 'scope.landing')
    && findNodes(currentIndex, sourceIds).some(node => previousMatch(node, priorIndex)?.lineageId === lineage));
};

const pronunciationTransition = (
  evidence: Tier2FacetEvidence,
  currentIndex: TreeIndex,
  priorIndex: TreeIndex
): boolean => {
  if (!evidence.priorForest) return false;
  const candidates = [
    ...findNodes(currentIndex, anchorIds(evidence, 'plaque.anchor')),
    ...findNodes(currentIndex, anchorIds(evidence, 'rewrite.output'))
  ];
  return candidates.some((node) => {
    const before = previousMatch(node, priorIndex);
    return Boolean(
      before
      && nodeShape(before as SyntaxNode) === nodeShape(node)
      && terminalSurfaces(before as SyntaxNode).join('\u0000') !== terminalSurfaces(node).join('\u0000')
    );
  });
};

const deletionTransition = (
  recipeEntry: Tier2FacetRecipe,
  evidence: Tier2FacetEvidence,
  currentIndex: TreeIndex,
  priorIndex: TreeIndex
): boolean => {
  if (!evidence.priorForest) return false;
  const role = recipeEntry.id === 'ellipsis.site' ? 'ellipsis.site' : 'deleted.material';
  return findNodes(currentIndex, anchorIds(evidence, role)).some((node) => (
    subtreeNodes(node).some((member) => {
      const children = Array.isArray(member.children) ? member.children : [];
      if (children.length > 0 || member.silent !== true) return false;
      const before = previousMatch(member, priorIndex);
      if (!before) return false;
      const beforeChildren = Array.isArray(before.children) ? before.children : [];
      return beforeChildren.length === 0
        && before.silent !== true
        && Boolean(String(before.word || '').trim());
    })
  ));
};

const rewriteTransition = (
  evidence: Tier2FacetEvidence,
  currentIndex: TreeIndex,
  priorIndex: TreeIndex
): boolean => {
  if (!evidence.priorForest) return false;
  const currentNodes = [
    ...findNodes(currentIndex, anchorIds(evidence, 'rewrite.output')),
    ...findNodes(currentIndex, anchorIds(evidence, 'terminal'))
  ];
  if (currentNodes.some((node) => {
    const before = previousMatch(node, priorIndex);
    return Boolean(before && terminalSurfaces(before as SyntaxNode).join('\u0000') !== terminalSurfaces(node).join('\u0000'));
  })) return true;
  const priorInputIds = anchorIds(evidence, 'rewrite.input', 'prior');
  const currentOutputIds = anchorIds(evidence, 'rewrite.output');
  return priorInputIds.length > 0
    && priorInputIds.every((id) => priorIndex.nodes.has(id))
    && priorInputIds.every((id) => !currentIndex.nodes.has(id))
    && currentOutputIds.length > 0
    && currentOutputIds.every((id) => currentIndex.nodes.has(id))
    && currentOutputIds.every((id) => !priorIndex.nodes.has(id));
};

const fissionTransition = (
  evidence: Tier2FacetEvidence,
  currentIndex: TreeIndex,
  priorIndex: TreeIndex
): boolean => {
  const inputs = anchorIds(evidence, 'rewrite.input', 'prior');
  const outputs = anchorIds(evidence, 'rewrite.outputs');
  return Boolean(
    evidence.priorForest
    && inputs.length === 1
    && outputs.length >= 2
    && priorIndex.nodes.has(inputs[0])
    && outputs.every((id) => currentIndex.nodes.has(id))
    && !currentIndex.nodes.has(inputs[0])
  );
};

const terminalOrder = (forest: readonly SyntaxNode[] | undefined, sequence: ReadonlySet<string>): string[] => {
  const order: string[] = [];
  const visit = (node: SyntaxNode, withinSequence = false) => {
    const included = withinSequence || sequence.has(node.id);
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      const word = String(node.word || '').trim();
      if (included && word) order.push(JSON.stringify([node.id, word]));
      return;
    }
    children.forEach(child => visit(child, included));
  };
  (Array.isArray(forest) ? forest : []).forEach(node => visit(node));
  return order;
};

const parentSignature = (index: TreeIndex, ids: readonly string[]): string => ids
  .map((id) => `${id}:${[...(index.parentIds.get(id) ?? [])].sort().join(',')}`)
  .join('|');

const rebracketingTransition = (
  evidence: Tier2FacetEvidence,
  currentIndex: TreeIndex,
  priorIndex: TreeIndex
): boolean => {
  if (!evidence.priorForest) return false;
  const ids = anchorIds(evidence, 'sequence');
  const sequence = new Set(ids);
  return ids.length >= 2
    && ids.every(id => priorIndex.nodes.get(id)?.length === 1 && currentIndex.nodes.get(id)?.length === 1)
    && terminalOrder(evidence.priorForest, sequence).join('\u0000') === terminalOrder(evidence.currentForest, sequence).join('\u0000')
    && parentSignature(priorIndex, ids) !== parentSignature(currentIndex, ids);
};

const transitionEarned = (
  rule: Tier2TransitionRule,
  recipeEntry: Tier2FacetRecipe,
  evidence: Tier2FacetEvidence,
  currentIndex: TreeIndex,
  priorIndex: TreeIndex
): boolean => {
  switch (rule.evidence) {
    case 'overt-movement-stage-difference':
      return evidence.movement?.transition === true;
    case 'covert-movement-stage-difference':
      return covertMovementTransition(evidence, currentIndex, priorIndex);
    case 'pronunciation-stage-difference':
      return pronunciationTransition(evidence, currentIndex, priorIndex);
    case 'deletion-stage-difference':
      return deletionTransition(recipeEntry, evidence, currentIndex, priorIndex);
    case 'rewrite-stage-difference':
      return rewriteTransition(evidence, currentIndex, priorIndex);
    case 'fission-stage-difference':
      return fissionTransition(evidence, currentIndex, priorIndex);
    case 'rebracketing-stage-difference':
      return rebracketingTransition(evidence, currentIndex, priorIndex);
  }
};

const outputGatePasses = (
  gate: Tier2OutputGate,
  recipeEntry: Tier2FacetRecipe,
  evidence: Tier2FacetEvidence,
  currentIndex: TreeIndex,
  outcomeConcept: OutcomeConcept | null
): boolean => {
  switch (gate.kind) {
    case 'always':
      return true;
    case 'accepted-outcome':
      return outcomeConcept !== null && recipeEntry.acceptedOutcomeConcepts.includes(outcomeConcept);
    case 'value-present':
      return valueLiterals(evidence, gate.value).length > 0;
    case 'anchor-present':
      return anchorIds(evidence, gate.role).length > 0;
    case 'active-lens':
      return evidence.activeLens === true;
    case 'movement-geometry': {
      const sourceIds = anchorIds(evidence, 'movement.source');
      const landingIds = anchorIds(evidence, 'movement.landing');
      const sourceWorkspaces = new Set(sourceIds.flatMap((id) => [...(currentIndex.workspaceIds.get(id) ?? [])]));
      const landingWorkspaces = new Set(landingIds.flatMap((id) => [...(currentIndex.workspaceIds.get(id) ?? [])]));
      const crossWorkspace = [...sourceWorkspaces].every((workspace) => !landingWorkspaces.has(workspace));
      if (gate.variant === 'cross-workspace') return crossWorkspace;
      if (crossWorkspace) return false;
      const routeValues = valueLiterals(evidence, 'movement.route').map(normalizeTier2Synonym);
      const route = routeValues.includes('orthogonal') ? 'orthogonal' : 'curve';
      return gate.variant === route;
    }
  }
};

const consumedReference = (field: 'anchors' | 'priorAnchors' | 'values', entry: Tier2AuthoredEvidenceEntry, concept: string, itemIndices?: number[]) => {
  const indices = itemIndices ?? entry.conceptItemIndices?.[concept];
  return { field, key: entry.key,
    ...(indices && indices.length !== entry.items.length ? { itemIndices: [...indices] } : {}) };
};

export const evaluateTier2FacetRecipe = (
  recipeEntry: Tier2FacetRecipe,
  evidence: Tier2FacetEvidence,
  indexes: Tier2ForestIndexes = indexTier2Forests(evidence)
): Tier2FacetEvaluation => {
  const { currentIndex, priorIndex } = indexes;
  const failures: string[] = [];
  const ambiguousFields = new Set<string>();

  // Diagnose the original fields, including optional and prior evidence. An
  // ambiguous lookup must not masquerade as an absent optional field.
  for (const [field, entries, concepts] of [
    ['anchors', evidence.authoredCurrentAnchors, recipeEntry.anchors.filter(r => r.source !== 'prior').map(r => r.role)],
    ['priorAnchors', evidence.authoredPriorAnchors, recipeEntry.anchors.map(r => r.role)],
    ['values', evidence.authoredValues, recipeEntry.values.map(r => r.value)]
  ] as const) {
    for (const concept of new Set(concepts)) {
      if ((field === 'values' ? INDEPENDENT_TIER2_VALUE_ROLES : INDEPENDENT_TIER2_ANCHOR_ROLES).has(concept)) continue;
      const groups = entries?.filter(entry => entry.concepts.includes(concept)) ?? [];
      if (field === 'values' && concept === 'feature.rows' && independentFeatureDimensions(groups)) continue;
      if (field === 'anchors' && concept === 'theta.arguments' && independentThetaArgumentFields(evidence)) continue;
      const distinct = new Set(groups.map(entry => JSON.stringify(
        entry.conceptItemIndices?.[concept]?.map(index => entry.items[index]) ?? entry.items
      )));
      if (distinct.size > 1) {
        ambiguousFields.add(`${field}:${concept}`);
        failures.push(`ambiguous-group:${field}:${concept}:${groups.map(entry => entry.key).join('|')}`);
      }
    }
  }

  recipeEntry.anchors.forEach((requirement) => {
    if ((requirement.source !== 'prior' && ambiguousFields.has(`anchors:${requirement.role}`))
      || (requirement.source !== 'current' && ambiguousFields.has(`priorAnchors:${requirement.role}`))) return;
    if (!requirementSatisfied(evidence, requirement, currentIndex, priorIndex)) {
      const ids = roleRequirementIds(evidence, requirement);
      const index = requirement.source === 'prior' ? priorIndex : currentIndex;
      const missing = ids.filter(id => !index.nodes.has(id)
        && !(requirement.source === 'either' && priorIndex.nodes.has(id)));
      failures.push(`anchor:${requirement.source}:${requirement.role}:${missing.length
        ? `unresolved:${missing.join('|')}` : ids.length === 0
          ? 'missing-or-empty' : `cardinality:${ids.length},expected:${requirement.min}..${requirement.max ?? 'many'}`}`);
    }
  });

  recipeEntry.requireAnyRoleGroups.forEach((roles) => {
    const satisfied = roles.some((role) => {
      const requirement = recipeEntry.anchors.find((entry) => entry.role === role);
      return Boolean(requirement && requirementSatisfied(evidence, requirement, currentIndex, priorIndex)
        && roleRequirementIds(evidence, requirement).length > 0);
    });
    if (!satisfied) failures.push(`anchor-any:${roles.join('|')}`);
  });

  recipeEntry.values.forEach((requirement) => {
    if (ambiguousFields.has(`values:${requirement.value}`)) return;
    const pairing = recipeEntry.checks.find((check): check is Extract<Tier2StructuralCheck, { kind: 'paired-values' }> =>
      check.kind === 'paired-values' && check.value === requirement.value);
    const literals = (pairing && pairedLiterals(evidence, pairing.role, requirement.value)) || valueLiterals(evidence, requirement.value);
    if (requirement.optional && literals.length === 0
      && !evidence.authoredValues?.some(entry => entry.concepts.includes(requirement.value))) return;
    if (literals.length < requirement.min || (requirement.max !== undefined && literals.length > requirement.max)
      || (requirement.nonBlank && literals.some(literal => !literal.trim()))) {
      failures.push(`value:${requirement.value}`);
    }
  });

  const outcomeConcept = outcomeFor(recipeEntry, evidence);
  if (recipeEntry.values.some(requirement => requirement.value === 'outcome')
    && valueLiterals(evidence, 'outcome').length > 0 && !outcomeConcept) failures.push('value:outcome-not-accepted');
  recipeEntry.checks.forEach((check) => {
    if (ambiguousFields.size) return;
    const result = evaluateStructuralCheck(check, recipeEntry, evidence, currentIndex, outcomeConcept, priorIndex);
    if (result !== true) {
      failures.push(typeof result === 'string' ? `check:${check.kind}:${result}`
        : check.kind === 'prior-source-consistency'
        ? `priorAnchors:${check.role}:${anchorIds(evidence, check.role, 'prior').join('|')}:conflicts-with-current-source:${anchorIds(evidence, check.role).join('|')}`
        : check.kind === 'explicit-role'
        ? `meaning:${check.roles.join('|')}:${check.roles.some(role => anchorIds(evidence, role).length)
          ? 'only-contextual-role-aliases' : 'not-explicitly-authored'}`
        : `check:${check.kind}`);
    }
  });

  const complete = failures.length === 0;
  const consumedEvidence = complete
    ? [
        ...(['movement.path', 'movement.carrier'].includes(recipeEntry.id)
          ? (evidence.movement?.context || []).map(({ key }) => ({ field: 'anchors' as const, key })) : []),
        ...recipeEntry.anchors.flatMap((requirement) => {
          const entries = requirement.source === 'current'
            ? [
                { field: 'anchors' as const, entries: evidence.authoredCurrentAnchors ?? [] },
                /* Same-role prior anchors are replacement evidence for this claim. */
                { field: 'priorAnchors' as const, entries: ['movement.path', 'movement.carrier'].includes(recipeEntry.id)
                    ? (evidence.authoredPriorAnchors ?? []).filter(entry => evidence.movement?.priorAnchorKeys?.includes(entry.key))
                    : evidence.authoredPriorAnchors ?? [] }
              ]
            : requirement.source === 'prior'
              ? [{ field: 'priorAnchors' as const, entries: evidence.authoredPriorAnchors ?? [] }]
              : [
                  { field: 'anchors' as const, entries: evidence.authoredCurrentAnchors ?? [] },
                  { field: 'priorAnchors' as const, entries: evidence.authoredPriorAnchors ?? [] }
                ];
          return entries.flatMap(({ field, entries: authoredEntries }) =>
            authoredEntries
              .filter(({ concepts, items }) => (
                concepts.includes(requirement.role) && items.length > 0
              ))
              .map(entry => consumedReference(field, entry, requirement.role)));
        }),
        ...recipeEntry.checks.flatMap((check) => {
          if (check.kind !== 'paired-values' && check.kind !== 'feature-dependency') return [];
          const [role, valueConcept] = check.kind === 'paired-values'
            ? [check.role, check.value] : ['feature.target', 'case.literal'];
          return (evidence.authoredCurrentAnchors ?? [])
            .filter(entry => entry.concepts.includes(role) && entry.items.length > 0)
            .flatMap(entry => {
              const candidates = sameNameValueEntries(evidence, entry);
              const paired = candidates[0];
              if (candidates.length !== 1 || paired.items.length !== paired.anchorLength) return [];
              const optional = check.kind === 'paired-values' && Boolean(check.optional);
              const indices = paired.items.flatMap((item, index) => (!optional || item.trim().length > 0) ? [index] : []);
              return indices.length ? [consumedReference('values', paired, valueConcept, indices)] : [];
            });
        }),
        ...recipeEntry.values.flatMap((requirement) => (
          (evidence.authoredValues ?? [])
            .filter(({ concepts, items }) => (
              concepts.includes(requirement.value) && items.length > 0
            ))
            .flatMap(entry => {
              const tokenCheck = recipeEntry.checks.find((check): check is Extract<Tier2StructuralCheck, { kind: 'value-token' }> =>
                check.kind === 'value-token' && check.value === requirement.value);
              const optionalPair = recipeEntry.checks.some(check => check.kind === 'paired-values'
                && check.optional && check.value === requirement.value);
              const indices = (entry.conceptItemIndices?.[requirement.value] ?? entry.items.map((_, index) => index))
                .filter(index => (!tokenCheck || featureNotationStatus(entry.items[index], tokenCheck.tokens) === 'affirmative')
                  && (!optionalPair || entry.items[index].trim().length > 0));
              return indices.length ? [consumedReference('values', entry, requirement.value, indices)] : [];
            })
        ))
      ].filter((entry, index, entries) => entries.findIndex((candidate) => (
        candidate.field === entry.field && candidate.key === entry.key
      )) === index)
    : [];
  return {
    complete,
    failures,
    outcomeConcept,
    outputs: complete
      ? recipeEntry.outputs
          .filter((entry) => outputGatePasses(entry.gate, recipeEntry, evidence, currentIndex, outcomeConcept))
          .map((entry) => entry.piece)
      : [],
    earnedTransitions: complete
      ? recipeEntry.transitionRules
          .filter((rule) => transitionEarned(rule, recipeEntry, evidence, currentIndex, priorIndex))
          .map((rule) => rule.kind)
      : [],
    ...(complete && recipeEntry.id === 'focus.prominence' ? { structuralWitness: { branchParentNodeId: focusParent(evidence, currentIndex) } } : {}),
    ...(complete && recipeEntry.id === 'focus.projection' ? { structuralWitness: { projectionNodeIds: projectionChain(evidence) } } : {}),
    consumedEvidence
  };
};

export type Tier2FacetOutputIdentity = {
  piece: Tier2VisualPrimitiveName;
  key: string;
};

export type Tier2FacetOutputIdentityInput = {
  indexes?: Tier2ForestIndexes;
  recipe: Tier2FacetRecipe;
  evaluation: Tier2FacetEvaluation;
  evidence: Tier2FacetEvidence;
  authoredStageIndex: number;
  parentFacetIdentities?: readonly string[];
};

const canonicalizeIdentity = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalizeIdentity);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((canonical, key) => {
        canonical[key] = canonicalizeIdentity((value as Record<string, unknown>)[key]);
        return canonical;
      }, {});
  }
  return value;
};

const identityWitnesses = (
  index: TreeIndex,
  ids: readonly string[],
  includeWorkspace = true
): Array<{
  id: string;
  lineages: string[];
  workspaces?: string[];
}> => ids.map((id) => ({
  id,
  lineages: [...new Set((index.nodes.get(id) ?? [])
    .map((node) => String(node.lineageId || ''))
    .filter(Boolean))].sort(),
  ...(includeWorkspace ? { workspaces: [...(index.workspaceIds.get(id) ?? [])].sort() } : {})
}));

const appendIdentityItems = (
  target: Record<string, string[]>,
  key: string,
  items: readonly string[]
) => {
  target[key] = [...(target[key] ?? []), ...items];
};

const identityRoleBlock = (
  recipeEntry: Tier2FacetRecipe,
  anchors: Readonly<Record<string, readonly string[]>> | undefined,
  authoredEntries: readonly Tier2AuthoredEvidenceEntry[] | undefined,
  index: TreeIndex,
  includeWorkspace = true
): Record<string, ReturnType<typeof identityWitnesses>> => {
  if (!authoredEntries) {
    return Object.fromEntries(
      Object.entries(anchors ?? {})
        .map(([role, ids]) => [role, identityWitnesses(index, [...ids], includeWorkspace)])
        .filter(([, witnesses]) => witnesses.length > 0)
    );
  }

  const recipeRoles = new Set(recipeEntry.anchors.map(({ role }) => role));
  const normalized: Record<string, string[]> = {};
  authoredEntries.forEach(({ key, concepts, items }) => {
    const matchingRoles = concepts.filter((concept) => recipeRoles.has(concept));
    const identityRoles = matchingRoles.length > 0
      ? matchingRoles
      : (recipeEntry.kind === 'claim' ? [`literal:${key}`] : []);
    identityRoles.forEach((role) => appendIdentityItems(normalized, role, items));
  });
  return Object.fromEntries(
    Object.entries(normalized)
      .map(([role, ids]) => [role, identityWitnesses(index, ids, includeWorkspace)])
      .filter(([, witnesses]) => witnesses.length > 0)
  );
};

const identityValueBlock = (
  recipeEntry: Tier2FacetRecipe,
  evidence: Tier2FacetEvidence
): Record<string, string[]> => {
  if (!evidence.authoredValues) {
    return Object.fromEntries(
      Object.entries(evidence.values)
        .map(([valueName, literals]) => [valueName, [...literals]])
        .filter(([, literals]) => literals.length > 0)
    );
  }

  const recipeValues = new Set(recipeEntry.values.map(({ value }) => value));
  const normalized: Record<string, string[]> = {};
  evidence.authoredValues.forEach(({ key, concepts, items }) => {
    const matchingValues = concepts.filter((concept) => recipeValues.has(concept));
    const identityValues = matchingValues.length > 0
      ? matchingValues.map(value => INDEPENDENT_TIER2_VALUE_ROLES.has(value) ? `literal:${key}` : value)
      : (recipeEntry.kind === 'claim' ? [`literal:${key}`] : []);
    identityValues.forEach((value) => appendIdentityItems(normalized, value, items));
  });
  return normalized;
};

const buildFacetIdentity = ({
  recipe: recipeEntry,
  evaluation,
  evidence,
  authoredStageIndex,
  parentFacetIdentities,
  indexes = indexTier2Forests(evidence)
}: Tier2FacetOutputIdentityInput, persistent = false): string | null => {
  if (!evaluation.complete) return null;
  if (recipeEntry.outputIdentity.kind === 'inherit-parent') {
    const parents = [...new Set((parentFacetIdentities ?? [])
      .map((identity) => String(identity || '').trim())
      .filter(Boolean))].sort();
    if (parents.length === 0) return null;
    const { currentIndex, priorIndex } = indexes;
    return JSON.stringify(canonicalizeIdentity({
      facet: recipeEntry.id,
      parents,
      authoredMoment: authoredStageIndex,
      currentAnchors: identityRoleBlock(
        recipeEntry,
        evidence.currentAnchors,
        evidence.authoredCurrentAnchors,
        currentIndex
      ),
      priorAnchors: identityRoleBlock(
        recipeEntry,
        evidence.priorAnchors,
        evidence.authoredPriorAnchors,
        priorIndex
      ),
      values: identityValueBlock(recipeEntry, evidence),
      outcome: evaluation.outcomeConcept,
      transitions: evaluation.earnedTransitions
    }));
  }

  const { currentIndex, priorIndex } = indexes;
  return JSON.stringify(canonicalizeIdentity({
    facet: recipeEntry.id,
    authoredMoment: persistent ? null : authoredStageIndex,
    currentAnchors: identityRoleBlock(
      recipeEntry,
      evidence.currentAnchors,
      evidence.authoredCurrentAnchors,
      currentIndex,
      !persistent
    ),
    priorAnchors: identityRoleBlock(
      recipeEntry,
      evidence.priorAnchors,
      evidence.authoredPriorAnchors,
      priorIndex
    ),
    values: identityValueBlock(recipeEntry, evidence),
    outcome: evaluation.outcomeConcept,
    transitions: evaluation.earnedTransitions
  }));
};

export const buildTier2FacetIdentity = (input: Tier2FacetOutputIdentityInput): string | null =>
  buildFacetIdentity(input);

export const buildTier2FacetOutputIdentities = (
  input: Tier2FacetOutputIdentityInput
): Tier2FacetOutputIdentity[] => {
  // A current-state claim follows its exact occurrences as the workspace grows.
  // Operations and references to earlier states retain their authored moment.
  // Full facet identity still owns dispatch, dependencies and replacement.
  const persistent = input.recipe.kind === 'claim'
    && input.recipe.persistence.kind !== 'while-active'
    && input.recipe.transitionRules.length === 0
    // Conservatively retain timing even for prior evidence owned by a sibling facet.
    && !Object.values(input.evidence.priorAnchors ?? {}).some(ids => ids.length > 0);
  const facetIdentity = buildFacetIdentity(input, persistent);
  if (!facetIdentity) return [];
  return input.evaluation.outputs.map((piece) => {
    let pieceIdentity = facetIdentity;
    if (persistent && input.recipe.id === 'operator-binding' && piece === 'Variable-binding path') {
      // The domain owns the hull. Restating the same binding without that
      // optional domain does not introduce another operator-variable path.
      const binding = JSON.parse(facetIdentity);
      delete binding.currentAnchors['scope.domain'];
      pieceIdentity = JSON.stringify(canonicalizeIdentity(binding));
    }
    return { piece, key: JSON.stringify(canonicalizeIdentity({ facetIdentity: pieceIdentity, piece })) };
  });
};
