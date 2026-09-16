/**
 * FALLBACK PROTOTYPES — accepted design, disposable cards.
 *
 * The fallback DESIGN — the topology-only dispatch table and the P1A–P1F
 * drawings — is accepted (Francis, 2026-08-07) and promoted to production as
 * `replay/relations/fallbackTopology.ts`. The prototype cards below
 * remain disposable Lab research fixtures for visual judgment; they are not
 * production code and never ship.
 *
 * Corrected unknown-relation fallback: authored fixtures plus the pure,
 * topology-only dispatcher for the prototype drawings P1A–P1F.
 *
 * Topology dispatch never interprets the relation name, the role names, the node IDs,
 * or any gloss. It reads only structural facts of the authored instance —
 * how many scalar roles have a witness, how many array roles there are and how
 * long each is, the authored order inside each array, and whether the instance
 * authors `priorAnchors`. Every fixture below is a complete, model-authorable
 * Babel tree carrying a real linguistic analysis, and every relation name is
 * absent from the Lab's registered, unfrozen, and historical vocabularies, so
 * only the fallback presentation may draw it.
 *
 * The design is accepted; the cards themselves are not registry entries and
 * change no coverage counts.
 */
import type { SyntaxNode } from '../../types';
import type { LabRelation, LabStage } from './visual-relations-lab-adapter.ts';

const leaf = (
  id: string,
  label: string,
  word?: string,
  extra: Record<string, unknown> = {}
): SyntaxNode => ({
  id,
  label,
  ...(word ? { word } : {}),
  ...extra
});

const node = (
  id: string,
  label: string,
  children: SyntaxNode[],
  extra: Record<string, unknown> = {}
): SyntaxNode => ({
  id,
  label,
  children,
  ...extra
});

const nullHead = (id: string, category: string): SyntaxNode => node(id, category, [
  leaf(`${id}__null`, '∅', undefined, { silent: true })
]);

const stage = (
  statement: string,
  stageRecord: string,
  relations: LabRelation[],
  tree: SyntaxNode
): LabStage => ({ statement, stageRecord, relations, workspaceForest: [tree] });

/* ------------------------------------------------------------------ *
 * P1A — one current witness. Weather predicates take a non-thematic
 * subject: `It` fills Spec,TP without receiving a theta role (Chomsky
 * 1981). One anchor is all the analysis has.
 * ------------------------------------------------------------------ */

export const EXPLETIVE_TREE: SyntaxNode = node('tp_expl', 'TP', [
  node('dp_expl_it', 'DP', [
    leaf('d_expl_it', 'D', 'It', { tokenIndex: 0 })
  ]),
  node('tbar_expl', "T'", [
    nullHead('t_expl_past', 'T'),
    node('vp_expl', 'VP', [
      leaf('v_expl_rained', 'V', 'rained', { tokenIndex: 1 })
    ])
  ])
]);

export const EXPLETIVE_RELATION: LabRelation = {
  relation: 'NonThematicSubject',
  anchors: { expletive: 'dp_expl_it' }
};

/* ------------------------------------------------------------------ *
 * P1B + P3 — two current scalar witnesses. Principle B: the pronoun is
 * free in its local domain, so the co-argument subject is excluded as an
 * antecedent (Chomsky 1981; Lasnik 1976). Carries authored `values` so
 * the values rule is inspectable on a real card.
 * ------------------------------------------------------------------ */

export const DISJOINT_TREE: SyntaxNode = node('tp_disj', 'TP', [
  node('dp_disj_john', 'DP', [
    node('np_disj_john', 'NP', [
      leaf('n_disj_john', 'N', 'John', { tokenIndex: 0 })
    ])
  ]),
  node('tbar_disj', "T'", [
    nullHead('t_disj_past', 'T'),
    node('vp_disj', 'VP', [
      leaf('v_disj_saw', 'V', 'saw', { tokenIndex: 1 }),
      node('dp_disj_him', 'DP', [
        leaf('d_disj_him', 'D', 'him', { tokenIndex: 2 })
      ])
    ])
  ])
]);

export const DISJOINT_RELATION: LabRelation = {
  relation: 'DisjointReference',
  anchors: {
    excludedAntecedent: 'dp_disj_john',
    pronoun: 'dp_disj_him'
  },
  values: {
    principle: 'B',
    domain: 'local',
    interpretation: 'disjoint'
  }
};

/* ------------------------------------------------------------------ *
 * P1C + P2 — one scalar plus one authored array. German dative concord:
 * the verb assigns dative once and three nominal exponents realize it in
 * authored left-to-right order.
 * ------------------------------------------------------------------ */

export const CONCORD_TREE: SyntaxNode = node('tp_conc', 'TP', [
  node('dp_conc_ich', 'DP', [
    leaf('d_conc_ich', 'D', 'Ich', { tokenIndex: 0 })
  ]),
  node('tbar_conc', "T'", [
    nullHead('t_conc_pres', 'T'),
    node('vp_conc', 'VP', [
      leaf('v_conc_helfe', 'V', 'helfe', { tokenIndex: 1 }),
      node('dp_conc_mann', 'DP', [
        leaf('d_conc_diesem', 'D', 'diesem', { tokenIndex: 2 }),
        node('np_conc_mann', 'NP', [
          node('ap_conc_alten', 'AP', [
            leaf('a_conc_alten', 'A', 'alten', { tokenIndex: 3 })
          ]),
          node('np_conc_core', 'NP', [
            leaf('n_conc_mann', 'N', 'Mann', { tokenIndex: 4 })
          ])
        ])
      ])
    ])
  ])
]);

export const CONCORD_RELATION: LabRelation = {
  relation: 'DativeConcordExponence',
  anchors: {
    assigner: 'v_conc_helfe',
    exponents: ['d_conc_diesem', 'a_conc_alten', 'n_conc_mann']
  }
};

/* ------------------------------------------------------------------ *
 * P1D — two equal-length authored arrays. Respective readings pair the
 * conjuncts position by position (Gawron & Kehler 2004).
 * ------------------------------------------------------------------ */

export const RESPECTIVE_TREE: SyntaxNode = node('tp_resp', 'TP', [
  node('andp_resp_subj', '&P', [
    node('dp_resp_john', 'DP', [
      leaf('n_resp_john', 'N', 'John', { tokenIndex: 0 })
    ]),
    node('andbar_resp_subj', "&'", [
      leaf('and_resp_subj', '&', 'and', { tokenIndex: 1 }),
      node('dp_resp_mary', 'DP', [
        leaf('n_resp_mary', 'N', 'Mary', { tokenIndex: 2 })
      ])
    ])
  ]),
  node('tbar_resp', "T'", [
    nullHead('t_resp_past', 'T'),
    node('vp_resp_outer', 'VP', [
      node('vp_resp_core', 'VP', [
        leaf('v_resp_bought', 'V', 'bought', { tokenIndex: 3 }),
        node('andp_resp_obj', '&P', [
          node('dp_resp_book', 'DP', [
            leaf('d_resp_a1', 'D', 'a', { tokenIndex: 4 }),
            node('np_resp_book', 'NP', [
              leaf('n_resp_book', 'N', 'book', { tokenIndex: 5 })
            ])
          ]),
          node('andbar_resp_obj', "&'", [
            leaf('and_resp_obj', '&', 'and', { tokenIndex: 6 }),
            node('dp_resp_record', 'DP', [
              leaf('d_resp_a2', 'D', 'a', { tokenIndex: 7 }),
              node('np_resp_record', 'NP', [
                leaf('n_resp_record', 'N', 'record', { tokenIndex: 8 })
              ])
            ])
          ])
        ])
      ]),
      node('advp_resp', 'AdvP', [
        leaf('adv_resp', 'Adv', 'respectively', { tokenIndex: 9 })
      ])
    ])
  ])
]);

export const RESPECTIVE_RELATION: LabRelation = {
  relation: 'RespectivePairing',
  anchors: {
    subjectConjuncts: ['dp_resp_john', 'dp_resp_mary'],
    objectConjuncts: ['dp_resp_book', 'dp_resp_record']
  }
};

/* ------------------------------------------------------------------ *
 * P1E — closure. Weak crossover has three scalar participants (Postal
 * 1971; Wasow 1972): the operator, the offending pronoun, and the gap.
 * The analysis authors no pairing among them, so no connector is honest.
 * ------------------------------------------------------------------ */

const crossoverWho = (): SyntaxNode => node('dp_wco_who', 'DP', [
  leaf('d_wco_who', 'D', 'Who', { tokenIndex: 0 })
]);

const crossoverClause = (object: SyntaxNode): SyntaxNode =>
  node('cbar_wco', "C'", [
    leaf('c_wco_does', 'C', 'does', { tokenIndex: 1 }),
    node('tp_wco', 'TP', [
      node('dp_wco_mother', 'DP', [
        node('dp_wco_his', 'DP', [
          leaf('d_wco_his', 'D', 'his', { tokenIndex: 2 })
        ]),
        node('np_wco_mother', 'NP', [
          leaf('n_wco_mother', 'N', 'mother', { tokenIndex: 3 })
        ])
      ]),
      node('tbar_wco', "T'", [
        nullHead('t_wco_pres', 'T'),
        node('vp_wco', 'VP', [
          leaf('v_wco_love', 'V', 'love', { tokenIndex: 4 }),
          object
        ])
      ])
    ])
  ]);

export const CROSSOVER_TREE_BEFORE: SyntaxNode = crossoverClause(crossoverWho());

export const CROSSOVER_TREE: SyntaxNode = node('cp_wco', 'CP', [
  crossoverWho(),
  crossoverClause(node('dp_wco_gap', 'DP', [
    leaf('d_wco_gap', 'D', 't', { silent: true })
  ]))
]);

export const CROSSOVER_RELATION: LabRelation = {
  relation: 'WeakCrossoverConfiguration',
  anchors: {
    operator: 'dp_wco_who',
    offendingPronoun: 'dp_wco_his',
    rawObjectTrace: 'dp_wco_gap'
  },
  priorAnchors: { operator: 'dp_wco_who' }
};

/* ------------------------------------------------------------------ *
 * P1F — cross-stage. Spanish spurious se (Perlmutter 1971; Bonet 1991):
 * the dative clitic `le` is realized as `se` before a third-person
 * accusative clitic. The stage-N instance keeps two current witnesses
 * (so a connector is still licensed) and one previous-stage witness.
 * ------------------------------------------------------------------ */

const spuriousSeTree = (dativeSurface: string, dativeId: string): SyntaxNode =>
  node('tp_se', 'TP', [
    node('clp_se', 'ClP', [
      node('cl_se_dat', 'Cl', [
        leaf(dativeId, 'Cl', dativeSurface, { tokenIndex: 0 })
      ]),
      node('cl_se_acc', 'Cl', [
        leaf('cl_se_lo', 'Cl', 'lo', { tokenIndex: 1 })
      ])
    ]),
    node('tbar_se', "T'", [
      nullHead('t_se_past', 'T'),
      node('vp_se', 'VP', [
        leaf('v_se_di', 'V', 'di', { tokenIndex: 2 })
      ])
    ])
  ]);

export const SPURIOUS_SE_TREE_BEFORE: SyntaxNode = spuriousSeTree('le', 'cl_se_le');
export const SPURIOUS_SE_TREE_AFTER: SyntaxNode = spuriousSeTree('se', 'cl_se_se');

export const SPURIOUS_SE_RELATION: LabRelation = {
  relation: 'SpuriousSeExponence',
  anchors: {
    exponent: 'cl_se_se',
    conditioningClitic: 'cl_se_lo'
  },
  priorAnchors: {
    replacedDative: 'cl_se_le'
  }
};

/* ------------------------------------------------------------------ *
 * Topology-only dispatch
 * ------------------------------------------------------------------ */

export { fallbackDrawing } from '../../replay/relations/fallbackTopology.ts';
export type { FallbackFrameShape, FallbackInstanceMark, FallbackFanMark, FallbackLinkMark,
  FallbackTopologyRow, FallbackDrawing } from '../../replay/relations/fallbackTopology.ts';

/* ------------------------------------------------------------------ *
 * Prototype cards
 * ------------------------------------------------------------------ */

export type FallbackPrototypeId = 'p1a' | 'p1b' | 'p1c' | 'p1d' | 'p1e' | 'p1f-after';

export interface FallbackPrototypeCard {
  id: FallbackPrototypeId;
  title: string;
  status: string;
  sentence: string;
  data: SyntaxNode;
  derivationStages: LabStage[];
  /** Index of the stage whose relation this card demonstrates. */
  relationStageIndex: number;
  /** Frame this card is pinned to for deterministic visual inspection. */
  pinnedStageIndex: number;
}

const PROTOTYPE_STATUS = 'ACCEPTED DESIGN — production dispatch lives in replay/relations/fallbackTopology.ts; this card is a disposable research fixture, not production code.';

export const FALLBACK_PROTOTYPE_CARDS: FallbackPrototypeCard[] = [
  {
    id: 'p1a',
    title: 'P1A · ONE CURRENT WITNESS',
    status: `One authored witness, so the drawing is its authored role label and nothing else. Weather predicates take a non-thematic subject. ${PROTOTYPE_STATUS}`,
    sentence: 'It rained',
    data: EXPLETIVE_TREE,
    derivationStages: [
      stage(
        'The clause is assembled with an expletive subject.',
        'External Merge builds the expletive DP, the silent T head, and the VP into one TP.',
        [],
        EXPLETIVE_TREE
      ),
      stage(
        'The subject position is filled without a theta role.',
        'The expletive occupies the subject position without receiving a theta role.',
        [EXPLETIVE_RELATION],
        EXPLETIVE_TREE
      )
    ],
    relationStageIndex: 1,
    pinnedStageIndex: 1
  },
  {
    id: 'p1b',
    title: 'P1B + P3 · TWO CURRENT WITNESSES',
    status: `Two scalar roles license one quiet undirected connector in the lane below the terminals, plus authored role labels on both witnesses. Principle B excludes the local subject as an antecedent for the pronoun. Authored values stay in Replay and change no geometry. ${PROTOTYPE_STATUS}`,
    sentence: 'John saw him',
    data: DISJOINT_TREE,
    derivationStages: [
      stage(
        'The clause is fully assembled.',
        'External Merge builds John, the silent T head, and the VP saw him into one TP.',
        [],
        DISJOINT_TREE
      ),
      stage(
        'The local pronoun must be disjoint from the local subject.',
        'John is excluded as a local antecedent for him under Principle B.',
        [DISJOINT_RELATION],
        DISJOINT_TREE
      )
    ],
    relationStageIndex: 1,
    pinnedStageIndex: 1
  },
  {
    id: 'p1c',
    title: 'P1C + P2 · SCALAR PLUS AUTHORED ARRAY',
    status: `One scalar role and one array role license the association fan: thin plain lines from the single witness to each array witness, in authored order, with each authored role and bracketed list position. Dative is assigned once and realized on three nominal exponents. ${PROTOTYPE_STATUS}`,
    sentence: 'Ich helfe diesem alten Mann',
    data: CONCORD_TREE,
    derivationStages: [
      stage(
        'The clause is fully assembled.',
        'External Merge builds the subject, the silent T head, and the VP with its dative object into one TP.',
        [],
        CONCORD_TREE
      ),
      stage(
        'One dative assignment is realized across the nominal exponents.',
        'One dative assignment is realized on diesem, alten, and Mann in authored order.',
        [CONCORD_RELATION],
        CONCORD_TREE
      )
    ],
    relationStageIndex: 1,
    pinnedStageIndex: 1
  },
  {
    id: 'p1d',
    title: 'P1D · TWO EQUAL AUTHORED ARRAYS',
    status: `Two equal-length arrays pair by authored position: matching bracketed positions do the work, with the authored role names distinguishing the two lists. No connector, because lines here would cross the coordination branches. ${PROTOTYPE_STATUS}`,
    sentence: 'John and Mary bought a book and a record respectively',
    data: RESPECTIVE_TREE,
    derivationStages: [
      stage(
        'The coordinated clause is fully assembled.',
        'External Merge builds both coordinations, the silent T head, and the adverb into one TP.',
        [],
        RESPECTIVE_TREE
      ),
      stage(
        'The conjuncts are paired position by position.',
        'John pairs with a book, and Mary pairs with a record, in conjunct order.',
        [RESPECTIVE_RELATION],
        RESPECTIVE_TREE
      )
    ],
    relationStageIndex: 1,
    pinnedStageIndex: 1
  },
  {
    id: 'p1e',
    title: 'P1E · CLOSURE, NO HONEST PAIRING',
    status: `Three scalar roles: the authored data pairs no two of them, so the drawing marks every witness and stops. Nothing is connected and no pairing is invented. Weak crossover relates an operator, an offending pronoun, and a gap. ${PROTOTYPE_STATUS}`,
    sentence: 'Who does his mother love',
    data: CROSSOVER_TREE,
    derivationStages: [
      stage(
        'Who is base-generated as the object of love.',
        'The complete pronounced DP Who occupies the object position. No higher occurrence or trace exists yet.',
        [],
        CROSSOVER_TREE_BEFORE
      ),
      stage(
        'The operator, the pronoun, and the gap stand in a weak crossover configuration.',
        'The authored transformation places Who at the CP edge and leaves the raw literal t in object position. The fallback marks only the current relation witnesses.',
        [CROSSOVER_RELATION],
        CROSSOVER_TREE
      )
    ],
    relationStageIndex: 1,
    pinnedStageIndex: 1
  },
  {
    id: 'p1f-after',
    title: 'P1F · RELATION STAGE, WITH PREVIOUS-STAGE REFERENCE',
    status: `The relation stage earns the mark. Both current witnesses take their authored role labels; the previous witness is named in its existing Replay row with “previous stage”. The two-scalar connector remains, with no triangle or ghost node added to the tree. ${PROTOTYPE_STATUS}`,
    sentence: 'Se lo di',
    data: SPURIOUS_SE_TREE_AFTER,
    derivationStages: [
      stage(
        'The clitic cluster holds the dative and accusative clitics.',
        'External Merge builds the dative clitic le, the accusative clitic lo, and the verb into one TP.',
        [],
        SPURIOUS_SE_TREE_BEFORE
      ),
      stage(
        'The dative clitic is realized as se before the accusative clitic.',
        'The dative clitic le is realized as se before the accusative clitic lo.',
        [SPURIOUS_SE_RELATION],
        SPURIOUS_SE_TREE_AFTER
      )
    ],
    relationStageIndex: 1,
    pinnedStageIndex: 1
  }
];

/** Every authored instance the prototype set demonstrates, in card order. */
export const FALLBACK_PROTOTYPE_RELATIONS: LabRelation[] = [
  EXPLETIVE_RELATION,
  DISJOINT_RELATION,
  CONCORD_RELATION,
  RESPECTIVE_RELATION,
  CROSSOVER_RELATION,
  SPURIOUS_SE_RELATION
];
