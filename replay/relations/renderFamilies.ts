/**
 * Registry-entry → finite render family mapping, per-family persistence,
 * full-array ownership, and the explicit exclusion list.
 *
 * The registry (`replay/relationDispatch/productionRegistry.js`) stays
 * renderer-neutral; this module owns what each resolved entry renders as and
 * how long its marks stay visible across Replay frames. Every relation
 * identity used by an active accepted Lab card has an entry here; the only
 * exclusions are inactive history and quarantined contract-gap machinery,
 * each with its reason.
 *
 * Persistence semantics (per Francis's rulings):
 * - Registered relation persistence is exact per-design metadata. Movement
 *   paths and structurally persistent results persist after introduction
 *   (`from-stage-onward`); declared replacement families
 *   (`replace-previous-instance`) replace their prior instance per frame.
 * - An UNREGISTERED fallback is stage-only (Francis, 12 September): its
 *   neutral marks show through the stage that authored the claim and leave
 *   the canvas afterwards. The claim remains in the record; nothing is
 *   discarded, it is simply not painted forever.
 * - Large-anchor badges/rails inherit their parent instance's compiled
 *   persistence; they never own an independent policy.
 */

import type { OutcomeConcept } from './outcomeResolver.ts';

export type RenderPersistence =
  | 'from-stage-onward'
  | 'stage-only'
  | 'replace-prior-stage'
  | 'replace-previous-instance';

export type ProductionTransitionKind =
  | 'movement'
  | 'pronunciation'
  | 'deletion'
  | 'rewrite'
  | 'fission'
  | 'rebracketing';

/** Finite compiler branches. Grouped identities share a branch and a style. */
export type ProductionFamilyKind =
  | 'trajectory'
  | 'operator-variable-binding'
  | 'occurrence-identity'
  | 'coindex'
  | 'control'
  | 'predication'
  | 'binding-domain'
  | 'split-antecedence'
  | 'parasitic-gap'
  | 'pair-merge'
  | 'shared-node'
  | 'argument-sharing'
  | 'idiom-chunks'
  | 'feature-plaque'
  | 'agreement-paths'
  | 'feature-sharing'
  | 'case-assignment'
  | 'dependent-case'
  | 'accord'
  | 'boundary-cuts'
  | 'phase-arc'
  | 'transfer-domain'
  | 'blocked-access'
  | 'anti-locality'
  | 'improper-movement'
  | 'blocked-extraction'
  | 'intervention'
  | 'analysis-judgment'
  | 'ellipsis-site'
  | 'copy-pronunciation'
  | 'partial-copy-deletion'
  | 'realization-plate'
  | 'vocabulary-insertion'
  | 'phrasal-spellout'
  | 'pf-correspondence'
  | 'fission'
  | 'impoverishment'
  | 'local-dislocation'
  | 'cyclic-linearization'
  | 'qr'
  | 'lf-reconstruction'
  | 'cooper-storage'
  | 'strong-npi'
  | 'focus-prominence'
  | 'f-projection'
  | 'theta-grid'
  | 'gapping-alignment';

export type ProductionRenderFamily = {
  family: ProductionFamilyKind;
  /** Authored outcome concepts this exact registered design may style. */
  acceptedOutcomeConcepts: readonly OutcomeConcept[];
  /**
   * Trajectory capability owned by this production entry. Most entries whose
   * value is present are trajectory families; a source-backed composite may
   * also own one trajectory alongside its other marks.
   */
  trajectoryKind?:
    | 'phrasal'
    | 'head'
    | 'lowering'
    | 'remnant'
    | 'roll-up'
    | 'smuggling'
    | 'atb'
    | 'sideward'
    | 'parasitic-gap';
  persistence: RenderPersistence;
  /** Replay tree changes this exact registered design may sequence. */
  transitionKinds?: readonly ProductionTransitionKind[];
  /** Agreement path mode, for the agreement-paths family only. */
  agreementMode?: 'multiple' | 'cyclic';
};

/** Literal slots read as one value by the native drawing, not model-facing restrictions. */
export const PRODUCTION_SCALAR_VALUE_KEYS: Partial<Record<ProductionFamilyKind, readonly string[]>> = {
  trajectory: ['phase'],
  'binding-domain': ['outcome'],
  'parasitic-gap': ['index', 'outcome'],
  'argument-sharing': ['role'],
  'agreement-paths': ['outcome', 'cycle'],
  'feature-sharing': ['feature', 'value'],
  'case-assignment': ['feature', 'value', 'case'],
  'dependent-case': ['probeLabel', 'goalLabel'],
  accord: ['feature', 'value', 'index'],
  'boundary-cuts': ['outcome'],
  'blocked-access': ['outcome'],
  'anti-locality': ['outcome'],
  'blocked-extraction': ['outcome'],
  intervention: ['outcome'],
  'analysis-judgment': ['outcome', 'judgment', 'label'],
  'strong-npi': ['feature'],
  'f-projection': ['feature', 'accent']
};

const persistent = (family: ProductionFamilyKind, extra: Partial<ProductionRenderFamily> = {}): ProductionRenderFamily => ({
  family,
  acceptedOutcomeConcepts: [],
  persistence: 'from-stage-onward',
  ...extra
});

export const PRODUCTION_RENDER_FAMILIES: Record<string, ProductionRenderFamily> = {
  'trajectory.phrasal': persistent('trajectory', { trajectoryKind: 'phrasal' }),
  'trajectory.a-movement': persistent('trajectory', { trajectoryKind: 'phrasal' }),
  'trajectory.scrambling': persistent('trajectory', { trajectoryKind: 'phrasal' }),
  'trajectory.head': persistent('trajectory', { trajectoryKind: 'head' }),
  'trajectory.lowering': persistent('trajectory', { trajectoryKind: 'lowering' }),
  'scope.operator-variable': persistent('operator-variable-binding'),
  'trajectory.remnant': persistent('trajectory', { trajectoryKind: 'remnant' }),
  'trajectory.roll-up': persistent('trajectory', { trajectoryKind: 'roll-up' }),
  'trajectory.smuggling': persistent('trajectory', { trajectoryKind: 'smuggling' }),
  'trajectory.across-the-board': persistent('trajectory', { trajectoryKind: 'atb' }),
  'trajectory.sideward': persistent('trajectory', { trajectoryKind: 'sideward' }),

  'identity.occurrences': persistent('occurrence-identity'),
  'coreference.coindex': persistent('coindex'),
  'control.dependency': persistent('control'),
  'predication.paths': persistent('predication'),
  'binding.domain': persistent('binding-domain', {
    acceptedOutcomeConcepts: [
      'licensed', 'successful', 'allowed', 'accepted', 'valid',
      'blocked', 'failed', 'illicit', 'rejected', 'unlicensed', 'impossible', 'violation'
    ]
  }),
  'split-antecedence.indices': persistent('split-antecedence'),
  'parasitic-gap.composition': persistent('parasitic-gap', {
    trajectoryKind: 'parasitic-gap',
    acceptedOutcomeConcepts: [
      'licensed', 'successful', 'allowed', 'accepted', 'valid',
      'blocked', 'failed', 'illicit', 'rejected', 'unlicensed', 'impossible', 'violation'
    ]
  }),

  'pair-merge.fork': persistent('pair-merge'),
  'multidominance.shared-node': persistent('shared-node'),
  'argument-sharing.domains': persistent('argument-sharing'),
  'idiom-chunks.domain': persistent('idiom-chunks'),

  'agree.plaque': persistent('feature-plaque'),
  'feature-bundle.plaque': {
    family: 'feature-plaque',
    acceptedOutcomeConcepts: [],
    persistence: 'replace-previous-instance'
  },
  'multiple-agree.fanout': persistent('agreement-paths', { agreementMode: 'multiple' }),
  'cyclic-agree.paths': persistent('agreement-paths', { agreementMode: 'cyclic' }),
  'feature-sharing.vines': persistent('feature-sharing'),
  'case-assignment.path': persistent('case-assignment'),
  'dependent-case.elbow': {
    family: 'dependent-case',
    acceptedOutcomeConcepts: [],
    persistence: 'replace-previous-instance'
  },
  'accord.link': persistent('accord'),

  'bounding-node.cuts': persistent('boundary-cuts', {
    acceptedOutcomeConcepts: [
      'blocked', 'failed', 'illicit', 'rejected', 'unlicensed', 'impossible', 'violation'
    ]
  }),
  'phase.arc': persistent('phase-arc'),
  'transfer.domain': persistent('transfer-domain'),
  'transfer.blocked-access': persistent('blocked-access', {
    acceptedOutcomeConcepts: [
      'blocked', 'failed', 'illicit', 'rejected', 'unlicensed', 'impossible', 'violation'
    ]
  }),
  'anti-locality.paths': persistent('anti-locality', {
    acceptedOutcomeConcepts: [
      'licensed', 'successful', 'allowed', 'accepted', 'valid',
      'blocked', 'failed', 'illicit', 'rejected', 'unlicensed', 'impossible', 'violation'
    ]
  }),
  'improper-movement.landing': persistent('improper-movement'),
  'blocked-extraction.diagnostic': persistent('blocked-extraction', {
    acceptedOutcomeConcepts: [
      'blocked', 'failed', 'illicit', 'rejected', 'unlicensed', 'impossible', 'violation'
    ]
  }),
  'intervention.blocked-path': persistent('intervention', {
    acceptedOutcomeConcepts: [
      'blocked', 'failed', 'illicit', 'rejected', 'unlicensed', 'impossible', 'violation'
    ]
  }),
  'analysis.illicit': persistent('analysis-judgment', {
    acceptedOutcomeConcepts: ['illicit']
  }),

  'ellipsis.ghosting': persistent('ellipsis-site', { transitionKinds: ['deletion'] }),
  'ellipsis.deletion': persistent('ellipsis-site', { transitionKinds: ['deletion'] }),
  'copy.multiple-pronunciation': persistent('copy-pronunciation'),
  'copy.partial-deletion': persistent('partial-copy-deletion', { transitionKinds: ['deletion'] }),

  'pf.realization': persistent('realization-plate', { transitionKinds: ['pronunciation'] }),
  'pf.vocabulary-insertion': persistent('vocabulary-insertion', { transitionKinds: ['pronunciation'] }),
  'pf.phrasal-spellout': persistent('phrasal-spellout', { transitionKinds: ['pronunciation'] }),
  'pf.correspondence': persistent('pf-correspondence'),
  'pf.fission': persistent('fission', { transitionKinds: ['fission'] }),
  'pf.impoverishment': persistent('impoverishment', { transitionKinds: ['rewrite'] }),
  'pf.local-dislocation': persistent('local-dislocation', { transitionKinds: ['rebracketing'] }),
  'pf.cyclic-linearization': persistent('cyclic-linearization'),

  'qr.covert': persistent('qr'),
  'lf.reconstruction': persistent('lf-reconstruction'),
  /* Cooper storage is one authored ledger state per derivation stage. */
  'cooper-storage.ledger': {
    family: 'cooper-storage',
    acceptedOutcomeConcepts: [],
    persistence: 'replace-prior-stage'
  },
  'accord.strong-npi': persistent('strong-npi'),

  'focus.prominence': persistent('focus-prominence'),
  'focus.f-projection': persistent('f-projection'),
  'theta.grid': persistent('theta-grid'),
  'gapping.alignment': persistent('gapping-alignment')
};

/**
 * Trajectory role vocabularies, shared with the replay link builder. The
 * witness rule: phrasal-shaped kinds require an authored witness terminal;
 * head-sized kinds relate terminals directly.
 */
export const TRAJECTORY_SOURCE_ROLES = [
  'lowerCopy', 'source', 'sources', 'from', 'variable', 'realGap', 'lower-occurrence'
] as const;
export const TRAJECTORY_TARGET_ROLES = [
  'pronouncedCopy', 'higherCopy', 'target', 'operator', 'filler', 'remnant', 'landing', 'to', 'landing-site'
] as const;
export const TRAJECTORY_WITNESS_ROLES = ['traceWitness', 'traceWitnesses', 'lowerWitness'] as const;

export const WITNESS_REQUIRED_TRAJECTORY_KINDS: ReadonlySet<string> = new Set([
  'phrasal', 'remnant', 'roll-up', 'smuggling', 'atb', 'sideward', 'parasitic-gap'
]);

/**
 * Full-array ownership, keyed by production registry entry id. An array role
 * listed here is rendered element-by-element by that entry's wired family, so
 * the large-array organizational marks must not double-mark it. Ownership is
 * a claim about PRODUCTION rendering: an entry may appear here only when its
 * family compiler genuinely renders every element of that role's array.
 */
export const FULL_ARRAY_OWNED_ROLES: Record<string, readonly string[]> = {
  /* One trajectory per positional source/witness pair. */
  'trajectory.across-the-board': ['sources', 'traceWitnesses'],
  /* One coindex badge per occurrence. */
  'identity.occurrences': ['occurrences'],
  /* One path-node ring per path node; one coindex badge per parasitic gap. */
  'parasitic-gap.composition': ['primaryPath', 'secondaryPath', 'parasiticGaps'],
  /* One routed curve per goal. */
  'multiple-agree.fanout': ['goals'],
  /* One vine per bearer. */
  'feature-sharing.vines': ['bearers'],
  /* One boundary cut per boundary node. */
  'bounding-node.cuts': ['boundary'],
  /* One host badge / candidate path per host; region members each drawn. */
  'improper-movement.landing': ['licensedLandingHosts', 'rejectedLandingHosts', 'forbiddenRegion'],
  /* One shared branch per parent. */
  'multidominance.shared-node': ['parents'],
  /* One domain oval per domain. */
  'argument-sharing.domains': ['domains'],
  /* One enclosure per occurrence. */
  'copy.multiple-pronunciation': ['occurrences'],
  /* One badge per antecedent. */
  'split-antecedence.indices': ['antecedents'],
  /* One ordinal badge per correlate and remnant. */
  'gapping.alignment': ['correlates', 'remnants'],
  /* One propagation hop per projection. */
  'focus.f-projection': ['projections'],
  /* One dotted path per predicate. */
  'predication.paths': ['predicates']
  /*
   * Deliberately NOT owned: Cooper storage (one scope plaque with verbatim
   * rows is not an element-by-element rendering of its node-anchored arrays),
   * Fission outputs, Local Dislocation sequences, and Cyclic Linearization
   * orders — all plaque-anchored. The accepted organizational policy applies
   * to their large arrays.
   */
};
