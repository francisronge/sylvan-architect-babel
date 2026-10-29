import { NEGATIVE_PATH_OUTCOMES, POSITIVE_OUTCOMES, type OutcomeConcept } from './outcomeResolver.ts';
import type {
  Tier2AnchorRequirement,
  Tier2FacetId,
  Tier2FacetKind,
  Tier2FacetOutput,
  Tier2FacetOutputIdentityPolicy,
  Tier2FacetPersistence,
  Tier2FacetRecipe,
  Tier2FacetReplacement,
  Tier2OutputGate,
  Tier2OutputPersistence,
  Tier2ValueRequirement,
  Tier2VisualPrimitiveName
} from './tier2FacetTypes.ts';

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
    values: [{ ...optionalValue('index', 1, 1), nonBlank: true }],
    checks: [{ kind: 'distinct', roles: ['occurrences'] }],
    outputs: [
      output('Coindex'),
      output('Forest light')
    ]
  }),
  recipe('coreference.coindex', {
    anchors: [current('coreference.participants', 2, 2)],
    values: [{ ...optionalValue('index', 1, 1), nonBlank: true }],
    checks: [{ kind: 'distinct', roles: ['coreference.participants'] }, { kind: 'explicit-coreference' }],
    outputs: [output('Coindex')]
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
    values: [optionalValue('index', 1, 1)],
    checks: [{ kind: 'explicit-role', roles: ['controller', 'controllee'] },
    { kind: 'distinct', roles: ['controller', 'controllee'] },
    { kind: 'contains', containerRole: 'domain', memberRole: 'controllee' }],
    outputs: [output('Rectangular domain', { kind: 'anchor-present', role: 'domain' }), output('Control connector'), output('Coindex')]
  }),
  recipe('binding.dependency', {
    anchors: [current('binder', 1, 1), current('dependent', 1, 1), optionalCurrent('domain', 1, 1)],
    values: [optionalValue('outcome', 1, 1), optionalValue('index', 1, 1)],
    acceptedOutcomeConcepts: LOCAL_OUTCOMES,
    checks: [{ kind: 'explicit-role', roles: ['binder', 'dependent'] }, { kind: 'distinct', roles: ['binder', 'dependent'] }, { kind: 'binding-domain-or-positive' },
    { kind: 'contains', containerRole: 'domain', memberRole: 'dependent' }],
    outputs: [output('Elliptic domain', { kind: 'anchor-present', role: 'domain' }),
    output('Variable-binding path', { kind: 'anchor-absent', role: 'domain' })]
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
      { kind: 'gap-or-silent-copy', role: 'ordinary.gap', fillerRole: 'filler' },
      { kind: 'gap-or-silent-copy', role: 'parasitic.gap', fillerRole: 'filler' }
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
    checks: [{ kind: 'explicit-role', roles: ['shared.argument'] },
    { kind: 'distinct', roles: ['predicate.domains', 'shared.argument'] }],
    outputs: [output('Crossed domain ovals'), output('Label box', { kind: 'value-present', value: 'role.label' })]
  }),
  recipe('idiom.chunks', {
    anchors: [current('chunks', 2), optionalCurrent('interpretation.domain', 1, 1)],
    values: [],
    checks: [{ kind: 'explicit-role', roles: ['chunks', 'interpretation.domain'] }, { kind: 'distinct', roles: ['chunks'] },
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
    values: [value('feature.rows', 1), optionalValue('outcome', 1, 1)],
    acceptedOutcomeConcepts: POSITIVE_OUTCOMES,
    checks: [{ kind: 'distinct', roles: ['feature.bearers'] }],
    outputs: [output('Feature vine')]
  }),
  recipe('agreement.cycle', {
    anchors: [current('probe', 1, 1), current('goal', 1)],
    values: [value('cycle', 1, 1), optionalValue('outcome', 1, 1)],
    checks: [{ kind: 'distinct', roles: ['probe', 'goal'], allowRepeatedWithinRole: true }, { kind: 'feature-dependency' }],
    acceptedOutcomeConcepts: [...POSITIVE_OUTCOMES, ...NEGATIVE_PATH_OUTCOMES],
    outputs: [output('Cycle badge')]
  }),
  recipe('feature.dependency', {
    anchors: [current('feature.source', 1, 1), current('feature.target', 1)],
    values: [optionalValue('feature.rows'), optionalValue('case.literal'), optionalValue('feature.label', 1, 1), optionalValue('outcome', 1, 1)],
    checks: [{ kind: 'distinct', roles: ['feature.source', 'feature.target'], allowRepeatedWithinRole: true }, { kind: 'feature-dependency' }],
    acceptedOutcomeConcepts: [...POSITIVE_OUTCOMES, ...NEGATIVE_PATH_OUTCOMES],
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
    checks: [{ kind: 'explicit-role', roles: ['phase.edge'] }],
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
    checks: [{ kind: 'displayable-verdict', maxCharacters: 32 }],
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
    acceptedOutcomeConcepts: [...LOCAL_NEGATIVE_OUTCOMES, 'crashed'],
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
  recipe('focus.association', {
    anchors: [current('association.particle', 1, 1), current('association.associate', 1, 1)],
    values: [],
    checks: [{ kind: 'explicit-role', roles: ['association.particle', 'association.associate'] },
    { kind: 'distinct', roles: ['association.particle', 'association.associate'] }],
    outputs: [output('Nested association curves')]
  }),
  recipe('strong-npi', {
    anchors: [current('licensor', 1, 1), current('licensee', 1, 1)],
    values: [optionalValue('feature.label', 1, 1)],
    checks: [{ kind: 'explicit-npi' }],
    outputs: [output('Nested association curves'), output('Feature notation', { kind: 'value-present', value: 'feature.label' })]
  }),
  recipe('polarity.licensing', {
    anchors: [current('licensor', 1, 1), current('polarity.item', 1, 1)],
    values: [optionalValue('outcome', 1, 1)],
    acceptedOutcomeConcepts: POSITIVE_OUTCOMES,
    checks: [{ kind: 'explicit-role', roles: ['licensor', 'polarity.item'] },
    { kind: 'distinct', roles: ['licensor', 'polarity.item'] }],
    outputs: [output('Nested association curves')]
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
      { kind: 'contains', containerRole: 'scope.domain', memberRole: 'scope.source' }
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
    checks: [{ kind: 'native-rewrite' }],
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
