export type OrchardSourceKind = 'source figure' | 'adapted convention' | 'Babel composition' | 'source unverified';

export type OrchardSourceCitation = {
  kind: OrchardSourceKind;
  citation: string;
  location?: string;
  url?: string;
  note: string;
  related?: readonly { citation: string; location: string; url: string }[];
  image?: {
    path: string;
    alt: string;
    credit: string;
    licenseUrl: string;
  };
};

const figure = (citation: string, location: string, url: string, note: string): OrchardSourceCitation =>
  ({ kind: 'source figure', citation, location, url, note });
const adapted = (citation: string, location: string, url: string, note: string): OrchardSourceCitation =>
  ({ kind: 'adapted convention', citation, location, url, note });
const composed = (note: string, citation = 'Babel drawing'): OrchardSourceCitation =>
  ({ kind: 'Babel composition', citation, note });
const unverified = (note: string): OrchardSourceCitation =>
  ({ kind: 'source unverified', citation: 'No verified source figure', note });

// One entry for every public Orchard card. A source link identifies evidence
// for the named convention, not permission to reproduce that source's image.
// Only separately licensed images below are shipped. The local-only research
// capture map is separate and does not add third-party images to the release.
export const orchardSourceCitations: Readonly<Record<string, OrchardSourceCitation>> = {
  A1: composed('The curved phrasal trajectory and its Replay timing combine standard movement notation with Babel’s tree layout. No single source figure is claimed.'),
  A2: adapted('The Science of Syntax, Head Movement', 'Head-movement trees', 'https://opentext.ku.edu/syntax/chapter/head-movement/', 'The source establishes movement between heads. Babel routes the curve and animates the copies.'),
  A3: adapted('Gong, Postsyntactic Lowering and linear relations in Dagur noun phrases', 'Lowering derivations', 'https://www.glossa-journal.org/article/id/5422/', 'The source motivates downward, postsyntactic displacement; Babel draws the path on its own authored tree.'),
  B: {
    kind: 'Babel composition',
    citation: 'Forest light — original Babel drawing by Francis Ronge',
    location: 'Conceptual reference: Marcolli, Chomsky and Berwick, Mathematical Structure of Syntactic Merge, pages 80–82',
    url: 'https://www.its.caltech.edu/~matilde/MergeMCB-MITPress-LI.pdf#page=96',
    note: 'Francis Ronge designed the Forest light presentation for Babel. The cited work distinguishes a copied occurrence from an independently repeated object; its tree diagrams do not contain Forest light and are shown only as background for the linguistic identity claim.'
  },
  C: figure('Norvin Richards, Control (MIT 24.902)', 'Trees (8)–(9)', 'https://web.mit.edu/norvin/www/24.902/control.html', 'The original control/raising plate selected in Babel Reborn draws orthogonal dashed links, an arrow to the controller, and squared empty-position outlines. The left tree explicitly connects John with PRO; the right contrasts raising.'),
  C2: adapted('Paul Hagstrom, CAS LX 522 Syntax I: c-command and binding', 'Principle A and binding-domain slides', 'https://ling-blogs.bu.edu/lx522f12/files/2012/09/lx522f12-08-ccmd.pdf', 'The course source supports coindexing and domains. The former colored-circle image is unavailable, so the present circle must not be called an exact copy.'),
  C4: composed('Shared indices are a standard coreference notation. This particular line and fixture were composed for Babel; there is no one source figure to reproduce.'),
  C5: figure('Oliver Brownlow, Towards a Unified Analysis of the Syntax and Semantics of Copular Sentences', 'Figure 57', 'https://www.qmul.ac.uk/sllf/media/sllf-new/department-of-linguistics/documents/27%29-QMOPAL-Brownlow.pdf', 'The predication dependency is transferred to Babel’s own lexicalized tree.'),
  D: adapted('Elly van Gelderen, Historical Generative Syntax: What Diachronic Cycles Tell Us', '“Merge and AGREE” slide', 'https://www.slideserve.com/frayne/historical-generative-syntax-what-diachronic-cycles-tell-us-powerpoint-ppt-presentation', 'The original Agree reference selected in Babel Reborn puts bracketed unvalued φ-features on T and valued person/number features on the DP in one syntax tree. It supports anchored feature bundles, but does not establish the later rectangular plaque or its connector geometry. Those visual details still need an exact source if claimed as copied.'),
  D3: figure('Andrew Nevins, Multiple Agree with Clitics', 'Figure 61', 'https://faculty.georgetown.edu/rtk8/Nevins%202011%20multiple%20agree%20with%20clitics%20NLLT%20final%20version.pdf', 'One probe reaches two goals with unequal, directed curves.'),
  D4: figure('Stefan Keine and Bhamati Dash, Movement and Cyclic Agree', 'Figure 1', 'https://link.springer.com/content/pdf/10.1007/s11049-022-09538-1.pdf', 'The first and second Agree searches are ordered; Babel shows them in Replay.'),
  D5: figure('Stefan Keine, Phi-Feature Sharing', 'Figure 18', 'https://stefankeine.com/papers/feature-sharing.pdf', 'Undirected lines meet one shared feature, rather than several copied plaques.'),
  D6: figure('Mark Norris, Agreement in the Nominal Domain', 'Figure 37, page 18', 'https://babel.ucsc.edu/~hank/mrg.readings/norris.concord.qp.pdf', 'The solid Case path and dotted number/gender collection paths remain distinct.'),
  D7: {
    ...figure('Ethan Poole, Dependent-case assignment could be AGREE', 'Figure 10, page 8', 'https://www.glossa-journal.org/articles/10.16995/glossa.9894/', 'Two diagrams separate the unlocking step from later Case assignment.'),
    image: {
      path: 'assets/source-figures/poole-dependent-case-low.png',
      alt: 'Page 8 of Poole 2024, showing Figure 10 with two ordered dependent-case trees',
      credit: 'Ethan Poole (2024), page 8. Unmodified page image. CC BY 4.0.',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/'
    }
  },
  E1: adapted('CAS LX 522 Syntax I, Wh-islands', 'Slide 24', 'https://slideplayer.com/slide/5088479/', 'The crossing cuts mark authored bounding nodes. Babel applies the source convention to its complex-NP fixture.'),
  E2: adapted('Zhiyan Gao, How to draw an arc on a syntax tree with LaTeX', 'Phase and spell-out arcs', 'https://gaozhiyan.wordpress.com/2016/12/06/how-to-draw-an-arc/', 'An arc marks a named domain. Babel measures that arc against the current tree.'),
  E4: figure('Suzana Fong, Long Distance Agreement: How Phases Constrain Operations and How to Get Out of Them', 'Handout 3a, page 4', 'https://sznfng.github.io/files/agree_course/Selected_topics_in_syntactic_theory_4110_6110_Winter_2025_handout%203a.pdf', 'The phase arc, edge outline and subordinate Spell-Out domain are separate marks.'),
  E4b: figure('Suzana Fong, Long Distance Agreement: How Phases Constrain Operations and How to Get Out of Them', 'Handout 3a, page 4, second tree', 'https://sznfng.github.io/files/agree_course/Selected_topics_in_syntactic_theory_4110_6110_Winter_2025_handout%203a.pdf', 'The attempted access path crosses the transferred domain and is marked as blocked.'),
  E5: figure('Elise Newman, Middles and Anti-locality: A Generalized Approach', 'Pages 16 and 18', 'https://esnewman.github.io/elisenewman/EliseNewmanGenerals.pdf', 'Compare the too-short dashed trajectory with its licensed longer counterpart.'),
  E6: figure('Ethan Poole, Improper Case', 'Figures 51–52, page 371', 'https://link.springer.com/article/10.1007/s11049-022-09541-6', 'The source contrasts licensed higher landings with X-marked lower landing candidates.'),
  E7: composed('The overall illicit-analysis verdict is a Babel presentation of an authored judgment. No special source drawing is claimed.'),
  F: {
    ...adapted('Jason Merchant, Ellipsis', 'Example (56b), page 21', 'https://home.uchicago.edu/~merchant/pubs/merchant.ellipsis.pdf#page=21', 'Merchant draws an unpronounced constituent with its internal tree intact. A separate teaching slide shades an elided VP. Babel translates these two conventions into lower-opacity syntax; no source shows the exact opacity or Replay timing.'),
    related: [{ citation: 'Syntax III, VP ellipsis lecture', location: 'Shaded VP tree', url: 'https://www.slideserve.com/drea/syntax-iii-powerpoint-ppt-presentation' }]
  },
  F5: adapted('Tom Meadows and Qiuhao Charles Yan, The Syntax and Post-syntax of Verb Doubling in Mandarin Chinese', 'Figures 17 and 18, PDF page 6', 'https://www.lingref.com/cpp/wccfl/41/paper3774.pdf#page=6', 'The full page shows a moved copy in Figure 17 and selective deletion in Figure 18. The previous isolated deletion crop hid the movement step. Babel combines those sequential operations in its own Replay; it does not reproduce one published combined plate.'),
  G: adapted('Bosveld-de Smet and de Vries, Visualizing Non-subordination and Multidominance in Tree Diagrams', 'Multidominance diagrams', 'https://research.rug.nl/en/publications/visualizing-non-subordination-and-multidominance-in-tree-diagrams', 'The source supports a shared structural object; Babel chooses its own layout and connector routing.'),
  G3: figure('Hiraiwa and Bodomo, Object-Sharing as Symmetric Sharing: Evidence from Dagaare', 'Figure 19', 'https://www.lingref.com/cpp/wccfl/26/paper1678.pdf', 'The source’s ovals and object-sharing box inform the overlay. Babel does not copy its mother topology.'),
  H: {
    ...adapted('Yifan Yang, Quantified Exponence Constraints', 'Figure (11), boxed lexical and exponent representations', 'https://journals.linguisticsociety.org/proceedings/index.php/amphonology/article/download/4245/3870', 'Yang shows boxed feature-to-exponent representations, which are a visual precedent for a compact PF record. Goryczka separately shows insertion at tree terminals. Babel’s single plaque beside a tree combines those ideas; neither source has its exact form.'),
    related: [{ citation: 'Pamela Goryczka, A DM account of the -isc- augment', location: 'Example (3a), present indicative tree', url: 'https://www.ciscl.unisi.it/igg46/24/Goryczka.pdf' }]
  },
  H2B: figure('Pavel Caha and Marina Pantcheva, Tools in Nanosyntax', '“Phrasal Spell-Out” slide', 'https://glowlinguistics.org/37/pdf/caha-pantcheva-toolsho.pdf', 'The exponent attaches to a complete phrase shell rather than one terminal.'),
  H2C: adapted('Yifan Yang, Quantified Exponence Constraints', 'Figures 7a and 11', 'https://journals.linguisticsociety.org/proceedings/index.php/amphonology/article/download/4245/3870', 'The source maps several features to several exponents in a lexical representation. Babel places that mapping beside a syntax tree.'),
  H3: figure('Florian Breit, Welsh Mutation and Strict Modularity', 'Example (17), PDF page 50 (printed page 27)', 'https://discovery.ucl.ac.uk/id/eprint/10087726/1/Thesis%20%28colour%29.pdf#page=50', 'The source splits one clitic feature bundle into two. Babel translates that split into its own Replay drawing.'),
  H4: adapted('Heidi Harley and Rolf Noyer, Distributed Morphology', 'Example (13), impoverishment', 'https://heidiharley.com/heidiharley/wp-content/uploads/2016/09/HarleyAndNoyer1999.pdf', 'The delinking operation is sourced; Babel’s before-and-after plate is its own layout.'),
  H5: adapted('Gong, Postsyntactic Lowering and linear relations in Dagur noun phrases', 'Lowering and local-dislocation derivation', 'https://www.glossa-journal.org/article/id/5422/', 'The source motivates postsyntactic rebracketing. Babel draws it as a surface-order relation.'),
  H6: adapted('Danny Fox and David Pesetsky, Cyclic Linearization of Syntactic Structure', 'Example (2), PDF page 5; Scenarios 1–2', 'https://linguistics.berkeley.edu/~syntax-circle/syntax-group/spr06/foxpesetsky2005.pdf#page=5', 'Example (2) places four numbered horizontal movement paths beneath a linear string, below the page header “Cyclic Linearization of Syntactic Structure.” This supplies the numbered-path precedent missing from Orchard’s citation. The published figure does not contain Orchard’s single joined rail: Orchard joins its ordered anchors with dashed stems and badges, so that geometry is an adaptation rather than a literal copy. Scenarios 1–2 separately support the ORDERING plaque and its compatible/conflicting precedence statements.'),
  I1: figure('Huilei Wang, Quantifier Raising out of Mandarin relative clauses', 'Example (14), figure n', 'https://link.springer.com/article/10.1007/s11050-023-09202-3', 'This is the exact QR tree selected in Babel Reborn. It shows a dashed right-angled path from the lower object QP to its higher LF scope position, plus a separate lower type-driven QR path. The Orchard QR drawing follows that covert-path convention.'),
  I6: adapted('Eun-Jung Yoo, Cardinality Noun Phrases, Wh-Questions, and Scope Ambiguity', 'Example (25), PDF page 10', 'https://s-space.snu.ac.kr/bitstream/10371/86126/1/5.%202231212.pdf', 'The source’s QUANTS, RETRIEVED and QSTORE records inform Babel’s compact storage plate.'),
  I7: adapted('Frederick Hoyt, Negative Concord in Two Dialects of Arabic', 'Example (26), PDF page 10', 'https://fmhoyt.colliertech.org/Hoyt%2805%29_NegativeConcordInTwoDialectsOfArabic.pdf', 'The negative-concord dependency is sourced; the dashed routing is Babel’s translation.'),
  I8: adapted('Andreea Nicolae, Any Questions?', 'Examples (89)–(91), PDF page 124', 'https://semanticsarchive.net/Archive/TY3MjdiM/Nicolae-dissertation2013.pdf', 'The licensing configuration is sourced. Babel maps its operator and NPI anchors to the existing path vocabulary.'),
  I9: adapted('Michael Wagner, Focus and Givenness: A Unified Approach', 'Example (67), PDF page 31', 'https://semanticsarchive.net/Archive/GNmMjJlN/wagner10focus.pdf', 'The source shows focus projection; Babel places the propagation marks on authored nodes.'),
  I1b: adapted('Jonathan Baumann and colleagues, Introduction to Mathematics in Computer Science', 'Figure 2.32, page 45', 'https://vorkurs.cs.uni-saarland.de/ss22/dl/4/Book_Digital_Version.pdf#page=45', 'Figure 2.32 shows a formula syntax tree with active-scope hulls, variable-binding arrows, and shadowed inner scope. This is the confirmed visual source for the binding paths and hulls; Babel maps them onto a linguistic tree.'),
  I2: {
    ...adapted('Ethan Poole and Stefan Keine, Not all reconstruction effects are syntactic', 'Example (2), page 1678', 'https://doi.org/10.1007/s11049-023-09603-3', 'Example (2) supplies the interpreted-versus-neglected copy distinction, but it is a bracketed example rather than a syntax-tree drawing. The tree displayed below is a separate secondary illustration of copies at a phase edge; Babel’s LF emphasis is a composition, not a traced published image.'),
    related: [{ citation: 'Minimalist program, reconstruction at the vP phase edge', location: 'Illustrated syntax tree', url: 'https://en.wikipedia.org/wiki/Minimalist_program' }]
  },
  I4: {
    ...figure('Muriel Assmann, Daniel Büring, Izabela Jordanoska and Max Prüller, Towards a theory of morphosyntactic focus marking', 'Example (49), PDF page 33', 'https://pure.mpg.de/rest/items/item_3511337_2/component/file_3511338/content#page=33', 'The focused branch is strengthened and its sister is drawn as weak.'),
    image: {
      path: 'assets/source-figures/assmann-et-al-focus-marking-example-49.png',
      alt: 'Excerpt from Assmann and colleagues, example 49, showing a strong focus branch and dotted weak sister',
      credit: 'Assmann, Büring, Jordanoska and Prüller (2023), example (49). Cropped page excerpt. CC BY 4.0.',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/'
    }
  },
  J: adapted('CAS LX 522 Syntax I, Week 5b: Theta Theory', 'Slide 33', 'https://www.slideserve.com/rmilliner/cas-lx-522-syntax-i-powerpoint-ppt-presentation', 'The predicate/role/index grid is sourced; its color, typography and placement are Babel’s.'),
  K: adapted('Masako Maeda and Yoichi Miyamoto, Relativized Minimality and Form Copy in Japanese', 'Example (9b), printed page 187 (PDF page 195)', 'https://ling.cuhk.edu.hk/glowxiv/Proceedings_GLOWinAsia14th.pdf#page=195', 'The source draws a wh intervener between two positions of an attempted dependency and marks the blocked path with a star. The English fixture sentence appears in Shlonsky, Villata and Franck (2020), example (4). Babel applies the visual principle to that different tree; its dashed-X styling is not copied from either source.'),
  L1: adapted('Bartosz Wiland, Crossing and Nesting Paths', 'Example (62), printed page 20', 'https://repozytorium.amu.edu.pl/bitstreams/3084859d-3d2f-4357-bdcf-cd3992d18c4a/download', 'Example (62) actually draws two curved trajectories: first extraction of Y, then fronting of the remnant X. Example (65) gives a German VP-fronting sentence. Babel’s tree and route geometry are its own.'),
  L2: adapted('Ur Shlonsky, The form of Semitic noun phrases', 'Figure 39, pages 1482–1483', 'https://faculty.georgetown.edu/rtk8/Shlonsky%202004%20form%20of%20Semitic%20noun%20phrases%20Lingua.pdf', 'The ordered roll-up trajectories are sourced. Babel additionally shows complete lower copies.'),
  L3: adapted('Adriana Belletti, Notes on Passive Object Relatives', 'Example (7), PDF page 7', 'https://www.ciscl.unisi.it/doc/doc_pub/belletti09-notes_on_passives.pdf#page=7', 'Belletti diagrams the [V + DP/O] chunk moving past the external argument. Babel adds the shaded carrier stroke and its Replay sequence; those marks are not copied from the source.'),
  M1: {
    ...adapted('Colin Phillips, The Real-Time Status of Island Phenomena', 'Figure 4, printed page 815', 'https://www.colinphillips.net/wp-content/uploads/2014/08/phillips2006-islands.pdf', 'Phillips draws a primary path and a connected secondary path through a parasitic-gap configuration. The previous ordinary/parasitic-gap tree showed only the gap positions. The unheaded fork in Babel is a new composition of the two-path idea, not a mark present in Figure 4.'),
    related: [{ citation: 'Kvandervelden, Parasitic gap tree', location: 'Ordinary and parasitic gap positions', url: 'https://commons.wikimedia.org/wiki/File:Parasitic_gap_tree.png' }]
  },
  M2: adapted('Torr, Wide-Coverage Statistical Parsing with Minimalist Grammars', 'Figure 3.31', 'https://era.ed.ac.uk/server/api/core/bitstreams/762162ab-2460-4b50-abce-4a402f12d95c/content', 'The source supplies the across-the-board dependency. Babel draws one relation across its authored conjuncts.'),
  M3: adapted('Katja Barnickel, Deriving Asymmetric Coordination in German: A non-monotonic approach', 'Example (155), PDF page 90 (printed page 78)', 'https://home.uni-leipzig.de/muellerg/igra2/publikationen/Barnickel2017.pdf#page=90', 'The source shows eine Dompteuse moving from an additional workspace into the primary predicate. Babel’s cross-workspace arc is its own rendering, not a copied source mark.'),
  N1: adapted('Jason Ginsburg, Constraining Free Merge', 'Figure 4', 'https://bioling.psychopen.eu/index.php/bioling/article/download/14015/14015.pdf', 'The source draws an unheaded Pair-Merge arc. Babel transfers it to the shared fork in its tree contract.'),
  N2: figure('Yohei Oseki, Eliminating Pair-Merge', 'Figure 20', 'https://www.lingref.com/cpp/wccfl/32/paper3181.pdf', 'The source marks blocked extraction from the adjunct domain with a distinct diagnostic path.'),
  N3: figure('Byron Ahn, Mapping OUT-Argument Structure', 'Figure 94', 'https://www.byronahn.com/pub/Ahn-Mapping-OUT-Argument-Structure.pdf', 'Underlines identify chunks interpreted together; a side bracket marks their domain.'),
  O1B: {
    kind: 'Babel composition',
    citation: 'Tom Meadows and Qiuhao Charles Yan, The Syntax and Post-syntax of Verb Doubling in Mandarin Chinese',
    location: 'Figure 18, page 432',
    url: 'https://www.lingref.com/cpp/wccfl/41/paper3774.pdf',
    note: 'Figure 18 strikes a DP while retaining its surrounding tree; Merchant separately depicts an unpronounced constituent with internal syntax. Babel’s whole-subject-DP deletion sentence is a synthetic contrast fixture, not either published analysis.'
  },
  O2: figure('Colin Phillips, The Real-Time Status of Island Phenomena', 'Figure 4, PDF page 21', 'https://www.colinphillips.net/wp-content/uploads/2014/08/phillips2006-islands.pdf', 'The ordinary and parasitic paths use different source shapes.'),
  O5: {
    ...adapted('Anke Assmann, Case Stacking in Nanosyntax', 'Example (33), printed page 174 (PDF page 22)', 'https://www.philol.uni-leipzig.de/fileadmin/Fakult%C3%A4t_Philo/Linguistik/Forschung/LAB/LAB_92/LAB92_06_assmann.pdf#page=22', 'Assmann draws ordered K heads and movement of a containing KP, but no two-row plaque. Norris supplies a separate bracketed feature bundle. Babel combines these as a two-slot plaque. Neither image validates the synthetic DAT/NOM fixture; that fixture still needs a linguistically valid replacement.'),
    related: [{ citation: 'Mark Norris, Agreement in the Nominal Domain', location: 'Figure 37, bracketed K feature bundle', url: 'https://babel.ucsc.edu/~hank/mrg.readings/norris.concord.qp.pdf#page=18' }]
  },
  O6: {
    kind: 'source unverified',
    citation: 'Split-antecedence source drawing not yet identified',
    location: 'Visual precedent: Mikulová and colleagues, Semantic-pragmatic Annotations in the Prague Dependency Treebank, Figure 2, PDF page 4',
    url: 'https://aclanthology.org/2026.findings-acl.1060.pdf#page=4',
    note: 'The Prague figure uses colored reference links on a dependency tree, and Dillon and Johnson document the linguistic analysis. Neither establishes the Orchard drawing’s hollow shared origin and two constituency-tree links. Its exact visual source remains unverified; the absence of a match does not establish that Babel invented it.',
    related: [{ citation: 'Brian Dillon and Kyle Johnson, On Making Pronouns and Reflexives Compete', location: 'Examples (37)–(38), split-antecedence analysis', url: 'https://people.umass.edu/kbj/homepage/content/Aarhus.pdf' }]
  }
};
