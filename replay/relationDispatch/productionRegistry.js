import { createRelationRegistry } from './relationRegistry.js';
import { expandTier1RelationIdentities } from './tier1Aliases.js';
import { withProductionRoleVocabulary } from './productionRoleConcepts.js';

/**
 * The versioned production registry: every relation identity used by an
 * active accepted Lab card, with its real accepted role schema (version 15;
 * version 0 was born empty, version 1 carried the representative wiring).
 *
 * Identity matching is exact with declared case/whitespace folding only.
 * Render families and persistence live in
 * `replay/relations/renderFamilies.ts`, keyed by entry id, so this
 * registry stays renderer-neutral.
 *
 * The `wh-movement`, `auxiliary-head-movement`, and `phrasal-movement`
 * identities are declared observed identities from committed model-output
 * fixtures — declarations, not patterns.
 *
 * Signature philosophy: roles are exact where the accepted design fixes
 * them. Equivalent role wording is bound before those requirements are checked;
 * `allowAdditional` is used only for designs whose accepted contract
 * is genuinely open-rolled (FeatureBundle's single open participant role,
 * IdiomChunkCointerpretation's open chunk roles, ThetaAssignment's open
 * theta-role names, Identity's occurrence roles, PFRealization's open target
 * roles). `values` and `priorAnchors` are verbatim authored payload and stay
 * open everywhere.
 */

const scalar = { minItems: 1, maxItems: 1 };
const array = { minItems: 1, maxItems: null };
const pluralArray = { minItems: 2, maxItems: null };

/** Authored payload blocks are open and verbatim; the registry never closes them. */
const OPEN_BLOCK = { allowAdditional: true };

/** The endpoint role vocabulary trajectory relations author. */
const TRAJECTORY_ANCHOR_ROLES = {
  optional: {
    lowerCopy: scalar,
    source: scalar,
    from: scalar,
    variable: scalar,
    realGap: scalar,
    'lower-occurrence': scalar,
    pronouncedCopy: scalar,
    higherCopy: scalar,
    target: scalar,
    operator: scalar,
    filler: scalar,
    landing: scalar,
    to: scalar,
    'landing-site': scalar,
    traceWitness: scalar,
    lowerWitness: scalar
  },
  requiredAny: [
    ['lowerCopy', 'source', 'from', 'variable', 'realGap', 'lower-occurrence'],
    ['pronouncedCopy', 'higherCopy', 'target', 'operator', 'filler', 'landing', 'to', 'landing-site']
  ]
};

const entry = (id, identities, anchors, extra = {}) => ({
  id,
  version: '1',
  identities: expandTier1RelationIdentities(identities)
    .map((name) => ({ name, normalization: 'case-whitespace' })),
  signature: {
    anchors: withProductionRoleVocabulary(id, { ...anchors, allowContext: true }),
    priorAnchors: OPEN_BLOCK,
    values: OPEN_BLOCK
  },
  marks: [{
    id: `${id}.mark`,
    licenses: [{ field: 'relation' }]
  }],
  ...extra
});

const trajectoryEntry = (id, identities, { requireWitness = true } = {}) => entry(
  id,
  identities,
  {
    ...TRAJECTORY_ANCHOR_ROLES,
    requiredAny: [
      ...TRAJECTORY_ANCHOR_ROLES.requiredAny,
      ...(requireWitness ? [['traceWitness', 'lowerWitness']] : [])
    ]
  }
);

export const productionRelationRegistry = createRelationRegistry({
  registryId: 'babel.semantic-visual-grammar',
  version: '15',
  entries: [
    /* ------------------------------------------------- trajectories */
    trajectoryEntry('trajectory.phrasal', [
      'AbarMove', 'wh-movement', 'phrasal-movement'
    ]),
    trajectoryEntry('trajectory.a-movement', ['AMove']),
    trajectoryEntry('trajectory.scrambling', ['Scrambling']),
    entry('trajectory.head', ['HeadMove', 'auxiliary-head-movement'], {
      ...TRAJECTORY_ANCHOR_ROLES,
      optional: { ...TRAJECTORY_ANCHOR_ROLES.optional, hostHead: scalar, complexHead: scalar }
    }),
    trajectoryEntry('trajectory.lowering', ['Lowering'], { requireWitness: false }),
    entry('scope.operator-variable', ['OperatorVariableBinding'], {
      required: { operator: scalar, variable: scalar },
      optional: {
        traceWitness: scalar,
        scopeDomain: scalar,
        domain: scalar
      },
      equivalentRoles: [['scopeDomain', 'domain']]
    }),
    trajectoryEntry('trajectory.remnant', ['RemnantMovement']),
    trajectoryEntry('trajectory.roll-up', ['RollUpMovement']),
    entry('trajectory.smuggling', ['Smuggling'], {
      optional: {
        lowerCopy: scalar, source: scalar,
        traceWitness: scalar, lowerWitness: scalar,
        pronouncedCopy: scalar, higherCopy: scalar, target: scalar, landing: scalar,
        passenger: scalar, intervener: scalar
      },
      requiredAny: [
        ['lowerCopy', 'source'],
        ['pronouncedCopy', 'higherCopy', 'target', 'landing'],
        ['traceWitness', 'lowerWitness']
      ]
    }),
    entry('trajectory.across-the-board', ['AcrossTheBoardMovement'], {
      required: { sources: pluralArray, traceWitnesses: pluralArray },
      optional: { pronouncedCopy: scalar, target: scalar, landing: scalar },
      requiredAny: [['pronouncedCopy', 'target', 'landing']],
      sameLength: [['sources', 'traceWitnesses']]
    }),
    trajectoryEntry('trajectory.sideward', ['SidewardMovement']),

    /* ----------------------------------------- identity and reference */
    entry('identity.occurrences', ['Identity'], { minPresentItems: 2, allowAdditional: true }),
    entry('coreference.coindex', ['Coreference'], { minPresentItems: 2, allowAdditional: true }),
    entry('control.dependency', ['Control'], {
      required: { controller: scalar, controllee: scalar, domain: scalar }
    }),
    entry('predication.paths', ['Predication'], {
      required: { predicand: scalar },
      optional: { predicate: scalar, predicates: array },
      requiredAny: [['predicate', 'predicates']]
    }),
    entry('binding.domain', ['Binding'], {
      required: { binder: scalar, bound: scalar, domain: scalar }
    }),
    entry('split-antecedence.indices', ['SplitAntecedence'], {
      required: { antecedents: pluralArray, dependent: scalar }
    }),
    entry('parasitic-gap.composition', ['ParasiticGap'], {
      optional: {
        filler: scalar, operator: scalar,
        realGap: scalar, gap: scalar,
        traceWitness: scalar, lowerWitness: scalar,
        parasiticGap: scalar, parasiticGaps: array,
        primaryPath: array, secondaryPath: array,
        blockedEdge: scalar
      },
      requiredAlternatives: [
        [
          ['filler', 'operator'],
          ['realGap', 'gap'],
          ['traceWitness', 'lowerWitness']
        ],
        [['parasiticGap', 'parasiticGaps']],
        [['primaryPath', 'secondaryPath']]
      ]
    }),

    /* --------------------------------------------- structure building */
    entry('pair-merge.fork', ['PairMerge'], {
      required: { host: scalar },
      optional: { pairMember: scalar, adjunct: scalar },
      requiredAny: [['pairMember', 'adjunct']]
    }),
    entry('multidominance.shared-node', ['Multidominance'], {
      required: { parents: pluralArray, shared: scalar }
    }),
    entry('argument-sharing.domains', ['ArgumentSharing'], {
      required: { domains: pluralArray, shared: scalar }
    }),
    entry('idiom-chunks.domain', ['IdiomChunkCointerpretation'], {
      optional: { domain: scalar, interpretationDomain: scalar },
      requiredAny: [['domain', 'interpretationDomain']],
      minPresentItems: 3,
      allowAdditional: true
    }),

    /* -------------------------------------------- agreement and Case */
    entry('agree.plaque', ['Agree'], {
      required: { probe: scalar, goal: scalar }
    }),
    entry('feature-bundle.plaque', ['FeatureBundle'], {
      minPresentItems: 1,
      allowAdditional: true
    }),
    entry('multiple-agree.fanout', ['MultipleAgree'], {
      required: { probe: scalar },
      optional: { goals: array, goal: scalar },
      requiredAny: [['goals', 'goal']]
    }),
    entry('cyclic-agree.paths', ['CyclicAgree'], {
      required: { probe: scalar },
      optional: { goal: scalar, searchDomain: scalar },
      requiredAny: [['goal', 'searchDomain']]
    }),
    entry('feature-sharing.vines', ['FeatureSharing'], {
      required: { bearers: pluralArray }
    }),
    entry('case-assignment.path', ['CaseAssignment'], {
      required: { assigner: scalar, bearer: scalar }
    }),
    entry('dependent-case.elbow', ['DependentCase'], {
      required: { probe: scalar, goal: scalar }
    }),
    entry('accord.link', ['Accord'], {
      required: { source: scalar, goal: scalar },
      allowAdditional: true
    }),

    /* -------------------------------------------- locality and phases */
    entry('bounding-node.cuts', ['BoundingNodeCrossing'], {
      required: { domain: scalar, boundary: array }
    }),
    entry('phase.arc', ['Phase'], {
      required: { phase: scalar },
      optional: { edge: scalar }
    }),
    entry('transfer.domain', ['TransferDomain'], {
      required: { phase: scalar, edge: array },
      optional: { spellOutDomain: scalar, complement: scalar },
      requiredAny: [['spellOutDomain', 'complement']]
    }),
    entry('transfer.blocked-access', ['PostTransferAccess'], {
      required: { source: scalar, target: scalar },
      optional: { spellOutDomain: scalar, domain: scalar },
      requiredAny: [['spellOutDomain', 'domain']]
    }),
    entry('anti-locality.paths', ['AntiLocality'], {
      required: { source: scalar, traceWitness: scalar, landing: scalar },
      optional: { facilitator: scalar, lowerCopy: scalar, pronouncedCopy: scalar }
    }),
    entry('improper-movement.landing', ['ImproperMovement'], {
      required: { source: scalar, traceWitness: scalar, licensedLanding: scalar },
      optional: {
        licensedLandingHosts: array,
        rejectedLandingHosts: array,
        forbiddenRegion: array
      }
    }),
    entry('blocked-extraction.diagnostic', ['BlockedExtraction', 'AdjunctInaccessibility'], {
      optional: {
        source: scalar, extractionSource: scalar,
        target: scalar, landingSite: scalar,
        adjunctDomain: scalar, domain: scalar
      },
      requiredAny: [
        ['source', 'extractionSource'],
        ['target', 'landingSite'],
        ['adjunctDomain', 'domain']
      ]
    }),
    entry('intervention.blocked-path', ['Intervention'], {
      required: { intervener: scalar, target: scalar },
      optional: { landing: scalar, probe: scalar },
      requiredAny: [['landing', 'probe']]
    }),
    entry('analysis.illicit', ['IllicitAnalysis'], {
      required: { analysis: scalar }
    }),

    /* --------------------------------------------------- silence */
    entry('ellipsis.ghosting', ['Ellipsis', 'EllipsisRecoverability'], {
      optional: { antecedent: scalar, domain: scalar, site: scalar },
      requiredAny: [['domain', 'site']]
    }),
    entry('ellipsis.deletion', ['EllipsisDeletion'], {
      optional: { domain: scalar, site: scalar },
      requiredAny: [['domain', 'site']]
    }),
    entry('copy.multiple-pronunciation', ['CopyOccurrence', 'MultiplePronunciation'], {
      optional: {
        higherCopy: scalar,
        lowerCopy: scalar,
        occurrences: { minItems: 1, maxItems: null }
      },
      requiredAny: [['higherCopy', 'lowerCopy', 'occurrences']]
    }),
    entry('copy.partial-deletion', ['PartialCopyDeletion'], {
      optional: {
        deletedSubconstituent: scalar,
        deleted: scalar
      },
      requiredAny: [['deletedSubconstituent', 'deleted']]
    }),

    /* ------------------------------------------------ PF and morphology */
    entry('pf.realization', ['PFRealization'], {
      minPresentItems: 1,
      allowAdditional: true
    }),
    entry('pf.vocabulary-insertion', ['VocabularyInsertion'], {
      optional: { terminal: scalar, target: scalar, input: scalar, output: scalar },
      requiredAny: [['terminal', 'target']],
      allowAdditional: true
    }),
    entry('pf.phrasal-spellout', ['PhrasalSpellOut'], {
      optional: { phrase: scalar, domain: scalar, exponent: scalar },
      requiredAny: [['phrase', 'domain']]
    }),
    entry('pf.correspondence', ['ManyToManyCorrespondence'], {
      optional: { word: scalar, terminal: scalar, sources: array, exponents: array, correspondence: array },
      requiredAny: [['word', 'terminal']]
    }),
    entry('pf.fission', ['Fission'], {
      required: { outputs: array },
      optional: { input: scalar }
    }),
    entry('pf.impoverishment', ['Impoverishment'], {
      required: { terminal: scalar },
      optional: { featureHierarchy: array, delinkAfter: scalar }
    }),
    entry('pf.local-dislocation', ['LocalDislocation'], {
      required: { sequence: array }
    }),
    entry('pf.cyclic-linearization', ['CyclicLinearization'], {
      required: { order: array },
      optional: {
        edgePosition: scalar,
        conflictWitness: scalar
      }
    }),

    /* ----------------------------------------------------- LF and scope */
    entry('qr.covert', ['QuantifierRaising'], {
      optional: {
        pronouncedQP: scalar, source: scalar,
        lfQP: scalar, target: scalar,
        scopeDomain: scalar, domain: scalar
      },
      equivalentRoles: [['scopeDomain', 'domain']],
      requiredAny: [
        ['pronouncedQP', 'source'],
        ['lfQP', 'target']
      ]
    }),
    entry('lf.reconstruction', ['LFReconstruction'], {
      required: { neglectedCopy: scalar, interpretedCopy: scalar },
      optional: { binder: scalar }
    }),
    entry('cooper-storage.ledger', ['CooperStorage'], {
      required: { scope: scalar },
      optional: { quantifier: scalar, quantifiers: array, category: scalar, qstore: array, retrieved: array },
      allowAdditional: true
    }),
    entry('accord.strong-npi', ['StrongNPILicensing'], {
      required: { licensor: scalar, npi: scalar },
      optional: { focusOperator: scalar, focusAssociate: scalar },
      allOrNone: [['focusOperator', 'focusAssociate']]
    }),

    /* -------------------------------------------- information structure */
    entry('focus.prominence', ['FocusMarking'], {
      required: { focus: scalar, background: scalar, domain: scalar }
    }),
    entry('focus.f-projection', ['FProjection'], {
      required: { accentBearer: scalar, projections: array }
    }),
    entry('theta.grid', ['ThetaAssignment'], {
      required: { predicate: { ...scalar, aliases: ['assigner'], countDistinct: true } },
      allowAdditional: true
    }),
    entry('gapping.alignment', ['GappingAlignment'], {
      required: { correlates: array, remnants: array }
    })
  ]
});
